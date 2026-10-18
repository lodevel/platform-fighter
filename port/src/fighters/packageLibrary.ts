import * as THREE from 'three';
import { manifestAssetUrl } from '../../../src/assets/manifest';
import { packageMemory } from '../../../character/package/memory';
import type { CharacterPackage, PageId } from '../../../character/package/types';
import { validatePackage } from '../../../character/package/validate';
import { decodeIndexedPng } from '../../../character/render/indexedPng';
import { costumePalette } from '../../../character/render/palette';
import type { IndexedPage } from '../engine/sprites/spriteLayer';
import { packageAssetPath, SHIPPED_PACKAGES } from './packageIndex';

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
}

interface Entry {
  refs: number;
  readonly abort: AbortController;
  readonly ready: Promise<LoadedPackage>;
  loaded: LoadedPackage | null;
  progress: { done: number; total: number };
  readonly listeners: Set<(done: number, total: number) => void>;
  unload?: ReturnType<typeof setTimeout>;
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
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly url: (id: string, file: string) => string;
  private readonly revision: (id: string) => string | undefined;
  private readonly graceMs: number;
  private readonly fetch: NonNullable<PackageLibraryOptions['fetch']>;
  private readonly concurrency: number;

  constructor(options: PackageLibraryOptions = {}) {
    this.url = options.url ?? ((id, file) => manifestAssetUrl(packageAssetPath(id, file)));
    this.revision = options.revision ?? (() => undefined);
    this.graceMs = options.graceMs ?? 3000;
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.concurrency = options.concurrency ?? 6;
  }

  /** Upload resident and future pages to `renderer` as soon as they decode instead of at first draw. */
  attachRenderer(renderer: THREE.WebGLRenderer): void {
    if (this.renderer === renderer) return;
    this.renderer = renderer;
    for (const entry of this.entries.values()) if (entry.loaded) this.upload(entry.loaded);
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

  diagnostics() {
    const rows = [...this.entries].map(([id, entry]) => ({ id, refs: entry.refs, loading: !entry.loaded, unloading: entry.unload !== undefined,
      progress: { ...entry.progress },
      ...(entry.loaded ? { revision: entry.loaded.pkg.revision, pages: entry.loaded.pages.size, costumes: entry.loaded.costumes,
        gpuBytes: entry.loaded.gpuBytes, estimatedGpuBytes: packageMemory(entry.loaded.pkg).gpuBytes } : {}) }));
    return { packages: rows, gpuBytes: rows.reduce((sum, row) => sum + (row.gpuBytes ?? 0), 0) };
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

  private upload(loaded: LoadedPackage): void {
    if (!this.renderer) return;
    this.renderer.initTexture(loaded.palette);
    for (const page of loaded.pages.values()) this.renderer.initTexture(page.texture);
  }

  private load(id: string): Entry {
    const abort = new AbortController(), signal = abort.signal;
    const entry: Entry = { refs: 0, abort, loaded: null, progress: { done: 0, total: 0 }, listeners: new Set(),
      ready: null as unknown as Promise<LoadedPackage> };
    const report = (done: number, total: number) => {
      entry.progress = { done, total };
      entry.listeners.forEach(listener => listener(done, total));
    };
    const created: THREE.Texture[] = [];
    const work = async (): Promise<LoadedPackage> => {
      const response = await this.fetch(this.url(id, 'character.json'), { signal });
      if (!response.ok) throw new Error(`${id}: character.json: HTTP ${response.status}`);
      const pkg = await response.json() as CharacterPackage;
      const problems = validatePackage(pkg);
      if (problems.length) throw new Error(`${id}: invalid character package: ${problems.slice(0, 3).join('; ')}`);
      const pinned = this.revision(id);
      if (pinned !== undefined && pkg.revision !== pinned) throw new Error(`${id}: package revision ${pkg.revision} is not the pinned ${pinned}`);
      const pageIds = Object.keys(pkg.pages);
      const unindexed = pageIds.find(page => pkg.pages[page]!.format !== 'indexed');
      if (unindexed) throw new Error(`${id}: page ${unindexed} is not indexed`);
      const palette = paletteTexture(pkg);
      created.push(palette);
      const pages = new Map<PageId, IndexedPage>();
      let next = 0;
      report(0, pageIds.length);
      await Promise.all(Array.from({ length: Math.min(this.concurrency, pageIds.length) }, async () => {
        while (next < pageIds.length) {
          if (signal.aborted) throw cancelled();
          const pageId = pageIds[next++]!, page = pkg.pages[pageId]!;
          const file = await this.fetch(this.url(id, page.file), { signal });
          if (!file.ok) throw new Error(`${id}: ${page.file}: HTTP ${file.status}`);
          const image = await decodeIndexedPng(new Uint8Array(await file.arrayBuffer()));
          if (signal.aborted) throw cancelled();
          if (image.width !== page.width || image.height !== page.height)
            throw new Error(`${id}: ${page.file} is ${image.width}×${image.height}, the package says ${page.width}×${page.height}`);
          const texture = indexedPageTexture(image.width, image.height, image.data);
          created.push(texture);
          this.renderer?.initTexture(texture);
          pages.set(pageId, { texture, width: image.width, height: image.height });
          report(pages.size, pageIds.length);
        }
      }));
      if (signal.aborted) throw cancelled();
      this.renderer?.initTexture(palette);
      const costumes = palette.image.height;
      let gpuBytes = PALETTE_WIDTH * costumes * 4;
      for (const page of pages.values()) gpuBytes += page.width * page.height;
      return { pkg, pages, palette, costumes, gpuBytes };
    };
    (entry as { ready: Promise<LoadedPackage> }).ready = work().then(loaded => {
      entry.loaded = loaded;
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

function dispose(loaded: LoadedPackage): void {
  loaded.palette.dispose();
  for (const page of loaded.pages.values()) page.texture.dispose();
}

/** The library the game uses: shipped packages under the asset root, pinned to their indexed revisions. */
export const packageLibrary = new PackageLibrary({ revision: id => SHIPPED_PACKAGES.packages[id]?.revision });
