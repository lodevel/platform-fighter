import * as THREE from 'three';
import { manifestAssetUrl } from '../../../src/assets/manifest';
import { packageMemory } from '../../../character/package/memory';
import type { CharacterPackage, PageId } from '../../../character/package/types';
import { validatePackage } from '../../../character/package/validate';
import type { IndexedImage } from '../../../character/render/indexedPng';
import { costumePalette } from '../../../character/render/palette';
import type { IndexedPage } from '../engine/sprites/spriteLayer';
import { packageAssetPath, SHIPPED_PACKAGES } from './packageIndex';
import { createPageDecoder } from './pageDecoder';

/**
 * Texel bytes uploaded to the attached renderer per animation frame (at least one texture).
 * Edge measured 15–19 ms of blocked uploads for four pages (1.6 MB) in one frame.
 */
const UPLOAD_BYTES_PER_FRAME = 512 * 1024;

/** Palette textures are this many entries wide, whatever the package uses. */
export const PALETTE_WIDTH = 256;

/** A character package resident on the GPU: one R8 texture per indexed page and one palette texture. */
export interface LoadedPackage {
  readonly pkg: CharacterPackage;
  readonly pages: ReadonlyMap<PageId, IndexedPage>;
  /** Straight RGBA, PALETTE_WIDTH × costumes, row N = costume N (`costumePalette`). */
  readonly palette: THREE.DataTexture;
  readonly costumes: number;
  /** Texel bytes handed to the GPU: one per page pixel plus four per palette entry per costume. */
  readonly gpuBytes: number;
}

export interface PackageLease {
  readonly id: string;
  /** Rejects when loading fails or this lease's signal aborts first. */
  readonly ready: Promise<LoadedPackage>;
  /** Idempotent. The package unloads after the grace period once no lease holds it. */
  release(): void;
}

export interface AcquireOptions {
  /** Aborting releases the lease. */
  readonly signal?: AbortSignal;
  /** Pages loaded so far; called at once with the current count. */
  readonly progress?: (done: number, total: number) => void;
}

export interface PackageLibraryOptions {
  /** URL of `file` (relative to the package directory) of package `id`. */
  readonly url?: (id: string, file: string) => string;
  /** The revision a package must have (the pinned profile revision); undefined accepts any. */
  readonly revision?: (id: string) => string | undefined;
  /** How long an unused package stays resident, so a quick re-select or rematch does not reload it. */
  readonly graceMs?: number;
  readonly fetch?: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  /** Pages fetched and decoded at once. */
  readonly concurrency?: number;
  /** Indexed PNG → one byte per pixel (default: on workers when the platform has them). */
  readonly decode?: (bytes: Uint8Array<ArrayBuffer>) => Promise<IndexedImage>;
}

interface Entry {
  refs: number;
  readonly abort: AbortController;
  readonly ready: Promise<LoadedPackage>;
  /** The validated character.json, shared with `borrow` while the pages load. */
  readonly description: Promise<CharacterPackage>;
  loaded: LoadedPackage | null;
  progress: { done: number; total: number };
  readonly listeners: Set<(done: number, total: number) => void>;
  unload?: ReturnType<typeof setTimeout>;
  /** `performance.now()` when loading started and finished. */
  readonly started: number;
  finished?: number;
}

/** A package drawn once (menu art): resident, or only the pages asked for. */
export interface BorrowedPackage {
  readonly loaded: LoadedPackage;
  /** Idempotent. Disposes the pages loaded for this borrow; a resident package stays. */
  release(): void;
}

const cancelled = () => new Error('Character package loading cancelled');

/** The costume row a palette index selects, wrapped to the package's costumes like `costumeShifts`. */
export function costumeRow(loaded: Pick<LoadedPackage, 'costumes'>, index: number): number {
  const n = loaded.costumes;
  return Number.isFinite(index) ? ((Math.trunc(index) % n) + n) % n : 0;
}

/** One byte per pixel, sampled exactly (the palette shader filters). */
export function indexedPageTexture(width: number, height: number, data: Uint8Array<ArrayBuffer>): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Every costume of the package as one row of straight RGBA entries. */
export function paletteTexture(pkg: CharacterPackage): THREE.DataTexture {
  const rows = Math.max(1, pkg.costumes?.list.length ?? 0), data = new Uint8Array(PALETTE_WIDTH * rows * 4);
  for (let row = 0; row < rows; row++) data.set(costumePalette(pkg, row).subarray(0, PALETTE_WIDTH * 4), row * PALETTE_WIDTH * 4);
  const texture = new THREE.DataTexture(data, PALETTE_WIDTH, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Character packages shared by everyone who shows a fighter: menus, previews and matches.
 * Each holder takes a lease; the first lease loads the package (fetch, validate, decode
 * indexed pages, create textures, upload when a renderer is attached), the last release
 * disposes it after a grace period. The decoded page bytes stay as the textures' CPU copy
 * (one byte per pixel) so a lost context can upload again.
 */
export class PackageLibrary {
  private readonly entries = new Map<string, Entry>();
  /** Whole-package loads started, for checking that holders share them. */
  private loads = 0;
  private renderer: THREE.WebGLRenderer | null = null;
  /** Textures waiting for upload to the attached renderer, about UPLOAD_BYTES_PER_FRAME per animation frame. */
  private readonly uploads = new Set<THREE.Texture>();
  private uploadScheduled = false;
  private readonly url: (id: string, file: string) => string;
  private readonly revision: (id: string) => string | undefined;
  private readonly graceMs: number;
  private readonly fetch: NonNullable<PackageLibraryOptions['fetch']>;
  private readonly concurrency: number;
  private readonly decode: NonNullable<PackageLibraryOptions['decode']>;

  constructor(options: PackageLibraryOptions = {}) {
    this.url = options.url ?? ((id, file) => manifestAssetUrl(packageAssetPath(id, file)));
    this.revision = options.revision ?? (() => undefined);
    this.graceMs = options.graceMs ?? 3000;
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.concurrency = options.concurrency ?? 6;
    this.decode = options.decode ?? createPageDecoder();
  }

  /** Upload resident and future pages to `renderer` in the background instead of at first draw. */
  attachRenderer(renderer: THREE.WebGLRenderer): void {
    if (this.renderer === renderer) return;
    this.renderer = renderer;
    for (const entry of this.entries.values()) if (entry.loaded) textures(entry.loaded).forEach(texture => this.upload(texture));
  }

  acquire(id: string, options: AcquireOptions = {}): PackageLease {
    let entry = this.entries.get(id);
    if (!entry) { entry = this.load(id); this.entries.set(id, entry); }
    const held = entry;
    held.refs++;
    clearTimeout(held.unload);
    held.unload = undefined;
    const progress = options.progress;
    if (progress) { held.listeners.add(progress); progress(held.progress.done, held.progress.total); }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (progress) held.listeners.delete(progress);
      options.signal?.removeEventListener('abort', release);
      if (--held.refs === 0) this.scheduleUnload(id, held);
    };
    const signal = options.signal;
    if (signal?.aborted) release();
    else signal?.addEventListener('abort', release, { once: true });
    const ready = !signal ? held.ready : new Promise<LoadedPackage>((resolve, reject) => {
      if (signal.aborted) { reject(cancelled()); return; }
      signal.addEventListener('abort', () => reject(cancelled()), { once: true });
      held.ready.then(resolve, reject);
    });
    return { id, ready, release };
  }

  /** The package if it is loaded; never starts loading. */
  resident(id: string): LoadedPackage | undefined { return this.entries.get(id)?.loaded ?? undefined; }

  /**
   * For one drawing (menu art): the resident package, held until release, or else its
   * description and only `pages(pkg)`, so a portrait never loads a whole fighter.
   */
  async borrow(id: string, pages: (pkg: CharacterPackage) => readonly PageId[]): Promise<BorrowedPackage> {
    if (this.resident(id)) {
      const lease = this.acquire(id);
      return { loaded: await lease.ready, release: lease.release };
    }
    const never = new AbortController().signal, created: THREE.Texture[] = [];
    try {
      const pkg = await (this.entries.get(id)?.description ?? this.describe(id, never));
      // Menu art is composed on the CPU (`indexedPixels`), so these pages are never uploaded.
      const loaded = await this.decodePages(id, pkg, [...new Set(pages(pkg))], never, created, false);
      let released = false;
      return { loaded, release: () => { if (!released) { released = true; dispose(loaded); } } };
    } catch (error) {
      created.forEach(texture => texture.dispose());
      throw error;
    }
  }

  diagnostics() {
    const rows = [...this.entries].map(([id, entry]) => ({ id, refs: entry.refs, loading: !entry.loaded, unloading: entry.unload !== undefined,
      progress: { ...entry.progress }, loadMs: (entry.finished ?? performance.now()) - entry.started,
      ...(entry.loaded ? { revision: entry.loaded.pkg.revision, pages: entry.loaded.pages.size, costumes: entry.loaded.costumes,
        gpuBytes: entry.loaded.gpuBytes, estimatedGpuBytes: packageMemory(entry.loaded.pkg).gpuBytes } : {}) }));
    // The decoded bytes stay in the page and palette textures as their CPU copy, so the
    // same amount is resident in the page (`cpuBytes`) and handed to the GPU (`gpuBytes`).
    const gpuBytes = rows.reduce((sum, row) => sum + (row.gpuBytes ?? 0), 0);
    return { packages: rows, loads: this.loads, gpuBytes, cpuBytes: gpuBytes };
  }

  private scheduleUnload(id: string, entry: Entry): void {
    const unload = () => {
      if (entry.refs > 0 || this.entries.get(id) !== entry) return;
      this.entries.delete(id);
      entry.abort.abort();
      if (entry.loaded) dispose(entry.loaded);
    };
    if (this.graceMs <= 0) unload();
    else entry.unload = setTimeout(unload, this.graceMs);
  }

  /**
   * Queue `texture` for the attached renderer. Uploads are spread over animation frames so a
   * menu never spends a frame on a burst of pages; a page drawn before its turn uploads then.
   */
  private upload(texture: THREE.Texture): void {
    if (!this.renderer) return;
    this.uploads.add(texture);
    texture.addEventListener('dispose', () => this.uploads.delete(texture));
    if (this.uploadScheduled) return;
    this.uploadScheduled = true;
    const frame = globalThis.requestAnimationFrame ?? ((callback: () => void) => setTimeout(callback, 0));
    const flush = () => {
      this.flushUploads(UPLOAD_BYTES_PER_FRAME);
      if (this.uploads.size) frame(flush);
      else this.uploadScheduled = false;
    };
    frame(flush);
  }

  /** Upload queued textures now, up to about `budget` texel bytes (all by default: a match's loading screen). */
  flushUploads(budget = Infinity): void {
    let spent = 0;
    for (const texture of this.uploads) {
      if (spent >= budget) break;
      this.uploads.delete(texture);
      this.renderer?.initTexture(texture);
      const image = texture.image as { data: ArrayLike<number> };
      spent += image.data.length;
    }
  }

  /** Fetch, validate and pin-check a package's description. */
  private async describe(id: string, signal: AbortSignal): Promise<CharacterPackage> {
    const response = await this.fetch(this.url(id, 'character.json'), { signal });
    if (!response.ok) throw new Error(`${id}: character.json: HTTP ${response.status}`);
    const pkg = await response.json() as CharacterPackage;
    const problems = validatePackage(pkg);
    if (problems.length) throw new Error(`${id}: invalid character package: ${problems.slice(0, 3).join('; ')}`);
    const pinned = this.revision(id);
    if (pinned !== undefined && pkg.revision !== pinned) throw new Error(`${id}: package revision ${pkg.revision} is not the pinned ${pinned}`);
    const unindexed = Object.keys(pkg.pages).find(page => pkg.pages[page]!.format !== 'indexed');
    if (unindexed) throw new Error(`${id}: page ${unindexed} is not indexed`);
    return pkg;
  }

  /** Decode `pageIds` of `pkg` into textures, queued for the attached renderer when `upload`. */
  private async decodePages(id: string, pkg: CharacterPackage, pageIds: readonly PageId[], signal: AbortSignal,
    created: THREE.Texture[], upload: boolean, report?: (done: number, total: number) => void): Promise<LoadedPackage> {
    const palette = paletteTexture(pkg);
    created.push(palette);
    const pages = new Map<PageId, IndexedPage>();
    let next = 0;
    report?.(0, pageIds.length);
    await Promise.all(Array.from({ length: Math.min(this.concurrency, pageIds.length) }, async () => {
      while (next < pageIds.length) {
        if (signal.aborted) throw cancelled();
        const pageId = pageIds[next++]!, page = pkg.pages[pageId]!;
        const file = await this.fetch(this.url(id, page.file), { signal });
        if (!file.ok) throw new Error(`${id}: ${page.file}: HTTP ${file.status}`);
        const image = await this.decode(new Uint8Array(await file.arrayBuffer()));
        if (signal.aborted) throw cancelled();
        if (image.width !== page.width || image.height !== page.height)
          throw new Error(`${id}: ${page.file} is ${image.width}×${image.height}, the package says ${page.width}×${page.height}`);
        const texture = indexedPageTexture(image.width, image.height, image.data);
        created.push(texture);
        if (upload) this.upload(texture);
        pages.set(pageId, { texture, width: image.width, height: image.height });
        report?.(pages.size, pageIds.length);
      }
    }));
    if (signal.aborted) throw cancelled();
    if (upload) this.upload(palette);
    const costumes = palette.image.height;
    let gpuBytes = PALETTE_WIDTH * costumes * 4;
    for (const page of pages.values()) gpuBytes += page.width * page.height;
    return { pkg, pages, palette, costumes, gpuBytes };
  }

  private load(id: string): Entry {
    this.loads++;
    const abort = new AbortController(), signal = abort.signal;
    const description = this.describe(id, signal);
    description.catch(() => undefined);
    const entry: Entry = { refs: 0, abort, description, loaded: null, progress: { done: 0, total: 0 }, listeners: new Set(),
      started: performance.now(), ready: null as unknown as Promise<LoadedPackage> };
    const report = (done: number, total: number) => {
      entry.progress = { done, total };
      entry.listeners.forEach(listener => listener(done, total));
    };
    const created: THREE.Texture[] = [];
    const work = async () => {
      const pkg = await description;
      return this.decodePages(id, pkg, Object.keys(pkg.pages), signal, created, true, report);
    };
    (entry as { ready: Promise<LoadedPackage> }).ready = work().then(loaded => {
      entry.loaded = loaded;
      entry.finished = performance.now();
      return loaded;
    }, (error: unknown) => {
      created.forEach(texture => texture.dispose());
      // A later acquire starts again rather than inheriting the failure.
      if (this.entries.get(id) === entry) this.entries.delete(id);
      clearTimeout(entry.unload);
      throw error;
    });
    // Holders observe failures through their own lease.
    entry.ready.catch(() => undefined);
    return entry;
  }
}

function textures(loaded: LoadedPackage): THREE.Texture[] {
  return [loaded.palette, ...[...loaded.pages.values()].map(page => page.texture)];
}

function dispose(loaded: LoadedPackage): void {
  textures(loaded).forEach(texture => texture.dispose());
}

/** The library the game uses: shipped packages under the asset root, pinned to their indexed revisions. */
export const packageLibrary = new PackageLibrary({ revision: id => SHIPPED_PACKAGES.packages[id]?.revision });
