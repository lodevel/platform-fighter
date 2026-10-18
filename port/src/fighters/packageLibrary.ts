import * as THREE from 'three';
import { manifestAssetUrl } from '../../../src/assets/manifest';
import { packageMemory } from '../../../character/package/memory';
import type { CharacterPackage, PageId } from '../../../character/package/types';
import type { IndexedImage } from '../../../character/render/indexedPng';
import type { IndexedPage } from '../engine/sprites/spriteLayer';
import { createPackageDecoder, type PackageDecoder } from './packageDecoder';
import { PALETTE_WIDTH, type PackageDescription } from './packageDescription';
import { packageAssetPath, SHIPPED_PACKAGES } from './packageIndex';

/**
 * Texel bytes uploaded to the attached renderer per animation frame (at least one texture).
 * Edge measured 15–19 ms of blocked uploads for four pages (1.6 MB) in one frame.
 */
const UPLOAD_BYTES_PER_FRAME = 512 * 1024;

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
  /** Parses character.json and decodes pages (default: on workers when the platform has them). */
  readonly decoder?: PackageDecoder;
}

interface Entry {
  refs: number;
  readonly abort: AbortController;
  /** Settles once the package is loaded and, after a lost context, decoded again. */
  ready: Promise<LoadedPackage>;
  /** The validated character.json, shared with `borrow` while the pages load. */
  readonly description: Promise<PackageDescription>;
  /** Every page decoded so far: all of them once loaded. */
  readonly pages: Map<PageId, IndexedPage>;
  loaded: LoadedPackage | null;
  progress: { done: number; total: number };
  readonly listeners: Set<(done: number, total: number) => void>;
  unload?: ReturnType<typeof setTimeout>;
  /** While nobody holds a loading package, its next pages wait on this; a new holder or the unload resumes them. */
  paused?: { readonly until: Promise<void>; resume(): void };
  /** `performance.now()` when loading started and finished. */
  readonly started: number;
  finished?: number;
}

/** A package drawn once on the CPU (menu art): its description and only the pages asked for. */
export interface BorrowedPackage {
  readonly loaded: LoadedPackage;
  /** Idempotent. Disposes this borrow's pages. */
  release(): void;
}

const cancelled = () => new Error('Character package loading cancelled');

/** The costume row a palette index selects, wrapped to the package's costumes like `costumeShifts`. */
export function costumeRow(loaded: Pick<LoadedPackage, 'costumes'>, index: number): number {
  const n = loaded.costumes;
  return Number.isFinite(index) ? ((Math.trunc(index) % n) + n) % n : 0;
}

/** A texture's CPU bytes; null once the GPU holds the only copy. */
function pixels(texture: THREE.Texture): Uint8Array | null {
  return (texture.image as { data: Uint8Array | null }).data;
}

/** After its upload the GPU holds a page's only copy: its bytes are dropped (a lost context decodes them again). */
function releasePixels(texture: THREE.Texture): void {
  const { width, height } = texture.image as { width: number; height: number };
  texture.image = { data: null, width, height };
  // A re-created GPU texture (lost context, other renderer) is allocated but left empty until refilled.
  texture.source.dataReady = false;
}

function fillPixels(texture: THREE.Texture, image: IndexedImage): void {
  texture.image = image;
  texture.source.dataReady = true;
  texture.needsUpdate = true;
}

/** One byte per pixel, sampled exactly (the palette shader filters). Uploading drops the CPU copy. */
export function indexedPageTexture(image: IndexedImage): THREE.DataTexture {
  const texture = new THREE.DataTexture(image.data, image.width, image.height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.onUpdate = () => releasePixels(texture);
  texture.needsUpdate = true;
  return texture;
}

/** Every costume as one row of straight RGBA entries. Kept on the CPU too (a few KiB) for menu art. */
function paletteTexture({ palette, costumes }: PackageDescription): THREE.DataTexture {
  const texture = new THREE.DataTexture(palette, PALETTE_WIDTH, costumes, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function packageOf(description: PackageDescription, pages: ReadonlyMap<PageId, IndexedPage>): LoadedPackage {
  const { pkg, costumes } = description;
  let gpuBytes = PALETTE_WIDTH * costumes * 4;
  for (const page of pages.values()) gpuBytes += page.width * page.height;
  return { pkg, pages, palette: paletteTexture(description), costumes, gpuBytes };
}

/**
 * Runs `task` over `items`, `concurrency` at a time, each next item after `wait` (when it
 * returns a promise); stops when `signal` aborts.
 */
async function inParallel<T>(items: readonly T[], concurrency: number, signal: AbortSignal, task: (item: T) => Promise<void>,
  wait?: () => Promise<void> | undefined): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      await wait?.();
      if (signal.aborted) throw cancelled();
      if (next >= items.length) return;
      await task(items[next++]!);
    }
  }));
}

/**
 * Character packages shared by everyone who shows a fighter: menus, previews and matches.
 * Each holder takes a lease; the first lease loads the package (fetch, then parse, validate
 * and decode indexed pages on workers, create textures, upload when a renderer is attached).
 * A package nobody holds stops loading pages and is disposed after a grace period. Once a
 * page is uploaded the GPU holds its only copy; a restored context or another renderer gets
 * the pages decoded again.
 */
export class PackageLibrary {
  private readonly entries = new Map<string, Entry>();
  /** Whole-package loads started, for checking that holders share them. */
  private loads = 0;
  /** Pages decoded again after a lost context. */
  private restoredPages = 0;
  private renderer: THREE.WebGLRenderer | null = null;
  /** Textures waiting for upload to the attached renderer, about UPLOAD_BYTES_PER_FRAME per animation frame. */
  private readonly uploads = new Set<THREE.Texture>();
  private uploadScheduled = false;
  private readonly forgetUpload = ({ target }: { target: THREE.Texture }) => { this.uploads.delete(target); };
  private readonly url: (id: string, file: string) => string;
  private readonly revision: (id: string) => string | undefined;
  private readonly graceMs: number;
  private readonly fetch: NonNullable<PackageLibraryOptions['fetch']>;
  private readonly concurrency: number;
  private readonly decoder: PackageDecoder;

  constructor(options: PackageLibraryOptions = {}) {
    this.url = options.url ?? ((id, file) => manifestAssetUrl(packageAssetPath(id, file)));
    this.revision = options.revision ?? (() => undefined);
    this.graceMs = options.graceMs ?? 3000;
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.concurrency = options.concurrency ?? 6;
    this.decoder = options.decoder ?? createPackageDecoder();
  }

  /**
   * Upload resident and future pages to `renderer` in the background instead of at first draw.
   * When its context is restored, pages are decoded and uploaded again.
   */
  attachRenderer(renderer: THREE.WebGLRenderer): void {
    if (this.renderer === renderer) return;
    this.renderer = renderer;
    renderer.domElement?.addEventListener('webglcontextrestored', () => { if (this.renderer === renderer) this.reupload(); });
    this.reupload();
  }

  acquire(id: string, options: AcquireOptions = {}): PackageLease {
    let entry = this.entries.get(id);
    if (!entry) { entry = this.load(id); this.entries.set(id, entry); }
    const held = entry;
    held.refs++;
    clearTimeout(held.unload);
    held.unload = undefined;
    held.paused?.resume();
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
   * For one drawing on the CPU (menu art): the package's description (shared with a loaded or
   * loading package) and only `pages(pkg)`, decoded with their bytes, so a portrait never loads
   * a whole fighter and never reads back from the GPU.
   */
  async borrow(id: string, pages: (pkg: CharacterPackage) => readonly PageId[]): Promise<BorrowedPackage> {
    const never = new AbortController().signal, decoded = new Map<PageId, IndexedPage>();
    try {
      const description = await (this.entries.get(id)?.description ?? this.describe(id, never));
      await this.decodePages(id, description.pkg, [...new Set(pages(description.pkg))], decoded, never, false);
      const loaded = packageOf(description, decoded);
      let released = false;
      return { loaded, release: () => { if (!released) { released = true; dispose(loaded); } } };
    } catch (error) {
      decoded.forEach(page => page.texture.dispose());
      throw error;
    }
  }

  diagnostics() {
    const rows = [...this.entries].map(([id, entry]) => ({ id, refs: entry.refs, loading: !entry.loaded, paused: Boolean(entry.paused),
      unloading: entry.unload !== undefined, progress: { ...entry.progress }, loadMs: (entry.finished ?? performance.now()) - entry.started,
      ...(entry.loaded ? { revision: entry.loaded.pkg.revision, pages: entry.loaded.pages.size, costumes: entry.loaded.costumes,
        gpuBytes: entry.loaded.gpuBytes, estimatedGpuBytes: packageMemory(entry.loaded.pkg).gpuBytes } : {}) }));
    // Page bytes stay on the CPU only until uploaded; palettes (a few KiB) stay for menu art.
    let cpuBytes = 0;
    for (const entry of this.entries.values()) {
      for (const page of entry.pages.values()) cpuBytes += pixels(page.texture)?.byteLength ?? 0;
      if (entry.loaded) cpuBytes += pixels(entry.loaded.palette)?.byteLength ?? 0;
    }
    const gpuBytes = rows.reduce((sum, row) => sum + (row.gpuBytes ?? 0), 0);
    return { packages: rows, loads: this.loads, restoredPages: this.restoredPages, gpuBytes, cpuBytes, pendingUploads: this.uploads.size };
  }

  private scheduleUnload(id: string, entry: Entry): void {
    const unload = () => {
      if (entry.refs > 0 || this.entries.get(id) !== entry) return;
      this.entries.delete(id);
      entry.abort.abort();
      entry.paused?.resume();
      disposeEntry(entry);
    };
    if (this.graceMs <= 0) unload();
    else entry.unload = setTimeout(unload, this.graceMs);
  }

  /**
   * Queue `texture` for the attached renderer. Uploads are spread over animation frames so a
   * menu never spends a frame on a burst of pages; a page drawn before its turn uploads then.
   */
  private upload(texture: THREE.Texture): void {
    if (!this.renderer || this.uploads.has(texture)) return;
    this.uploads.add(texture);
    texture.addEventListener('dispose', this.forgetUpload);
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
      spent += pixels(texture)?.byteLength ?? 0;
      this.renderer?.initTexture(texture);
    }
  }

  /**
   * Upload every package to the attached renderer again (a restored context or a new renderer):
   * pages whose bytes were dropped are fetched and decoded first. Leases taken meanwhile wait.
   */
  private reupload(): void {
    for (const [id, entry] of this.entries) {
      const signal = entry.abort.signal;
      const work = entry.description.then(({ pkg }) => {
        const dropped = [...entry.pages].filter(([, page]) => !pixels(page.texture));
        return inParallel(dropped, this.concurrency, signal, async ([pageId, page]) => {
          fillPixels(page.texture, await this.fetchPage(id, pkg, pageId, signal));
          this.restoredPages++;
          this.upload(page.texture);
        });
      });
      // The pages decoded before now with their bytes kept are queued as they are.
      entry.pages.forEach(page => { if (pixels(page.texture)) this.upload(page.texture); });
      if (entry.loaded) this.upload(entry.loaded.palette);
      entry.ready = this.settle(id, entry, Promise.all([entry.ready, work]).then(([loaded]) => loaded));
    }
  }

  /** Fetch and pin-check a package's description; parsing and validation run on the decoder. */
  private async describe(id: string, signal: AbortSignal): Promise<PackageDescription> {
    const response = await this.fetch(this.url(id, 'character.json'), { signal });
    if (!response.ok) throw new Error(`${id}: character.json: HTTP ${response.status}`);
    return this.decoder.describe(id, new Uint8Array(await response.arrayBuffer()), this.revision(id));
  }

  /** Fetch and decode page `pageId` of `pkg`, checking its size. */
  private async fetchPage(id: string, pkg: CharacterPackage, pageId: PageId, signal: AbortSignal): Promise<IndexedImage> {
    const page = pkg.pages[pageId]!;
    const file = await this.fetch(this.url(id, page.file), { signal });
    if (!file.ok) throw new Error(`${id}: ${page.file}: HTTP ${file.status}`);
    const image = await this.decoder.page(new Uint8Array(await file.arrayBuffer()));
    if (signal.aborted) throw cancelled();
    if (image.width !== page.width || image.height !== page.height)
      throw new Error(`${id}: ${page.file} is ${image.width}×${image.height}, the package says ${page.width}×${page.height}`);
    return image;
  }

  /** Decode `pageIds` of `pkg` into `into`, queued for the attached renderer when `upload`. */
  private async decodePages(id: string, pkg: CharacterPackage, pageIds: readonly PageId[], into: Map<PageId, IndexedPage>,
    signal: AbortSignal, upload: boolean, report?: (done: number, total: number) => void, wait?: () => Promise<void> | undefined): Promise<void> {
    report?.(into.size, pageIds.length);
    await inParallel(pageIds, this.concurrency, signal, async pageId => {
      const image = await this.fetchPage(id, pkg, pageId, signal), texture = indexedPageTexture(image);
      into.set(pageId, { texture, width: image.width, height: image.height });
      if (upload) this.upload(texture);
      report?.(into.size, pageIds.length);
    }, wait);
  }

  /** `work`, or on failure the entry disposed and forgotten: a later acquire starts again rather than inheriting the failure. */
  private settle(id: string, entry: Entry, work: Promise<LoadedPackage>): Promise<LoadedPackage> {
    const ready = work.catch((error: unknown) => {
      disposeEntry(entry);
      if (this.entries.get(id) === entry) this.entries.delete(id);
      clearTimeout(entry.unload);
      throw error;
    });
    // Holders observe failures through their own lease.
    ready.catch(() => undefined);
    return ready;
  }

  private load(id: string): Entry {
    this.loads++;
    const abort = new AbortController(), signal = abort.signal;
    const description = this.describe(id, signal);
    description.catch(() => undefined);
    const entry: Entry = { refs: 0, abort, description, pages: new Map(), loaded: null, progress: { done: 0, total: 0 }, listeners: new Set(),
      started: performance.now(), ready: null as unknown as Promise<LoadedPackage> };
    const report = (done: number, total: number) => {
      entry.progress = { done, total };
      entry.listeners.forEach(listener => listener(done, total));
    };
    const whileHeld = () => entry.refs > 0 ? undefined : (entry.paused ??= pause(entry)).until;
    entry.ready = this.settle(id, entry, (async () => {
      const described = await description;
      await this.decodePages(id, described.pkg, Object.keys(described.pkg.pages), entry.pages, signal, true, report, whileHeld);
      const loaded = packageOf(described, entry.pages);
      this.upload(loaded.palette);
      entry.loaded = loaded;
      entry.finished = performance.now();
      return loaded;
    })());
    return entry;
  }
}

/** A gate that opens when `entry` is held again or unloaded. */
function pause(entry: Entry): NonNullable<Entry['paused']> {
  let open!: () => void;
  const until = new Promise<void>(resolve => { open = resolve; });
  return { until, resume: () => { entry.paused = undefined; open(); } };
}

function dispose(loaded: LoadedPackage): void {
  loaded.palette.dispose();
  loaded.pages.forEach(page => page.texture.dispose());
}

/** Idempotent. */
function disposeEntry(entry: Entry): void {
  entry.pages.forEach(page => page.texture.dispose());
  entry.pages.clear();
  entry.loaded?.palette.dispose();
}

/** The library the game uses: shipped packages under the asset root, pinned to their indexed revisions. */
export const packageLibrary = new PackageLibrary({ revision: id => SHIPPED_PACKAGES.packages[id]?.revision });
