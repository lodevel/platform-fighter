import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { packageMemory } from '../../../character/package/memory';
import type { CharacterPackage } from '../../../character/package/types';
import { SAMPLE } from '../../../character/testing/samplePackage';
import { packageAssetPath, SHIPPED_PACKAGES } from './packageIndex';
import { costumeRow, PackageLibrary, PALETTE_WIDTH, type PackageLibraryOptions } from './packageLibrary';

const PKG: CharacterPackage = { ...SAMPLE, revision: 'r1', palette: ['#00000000', '#704023ff', '#ffffffff'],
  pages: { p0: { ...SAMPLE.pages.p0!, format: 'indexed' } } };
const PAGE = PNG.sync.write({ width: 64, height: 32, data: Buffer.from(Array.from({ length: 64 * 32 }, (_, i) => i % 3)) } as PNG,
  { colorType: 0, inputColorType: 0, inputHasAlpha: false });

/** Serves PKG; `gate` holds page responses until it resolves. */
function server(pkg: CharacterPackage = PKG) {
  let open!: () => void;
  const gate = new Promise<void>(resolve => { open = resolve; });
  const calls: string[] = [], signals: AbortSignal[] = [];
  const fetch: PackageLibraryOptions['fetch'] = async (url, { signal }) => {
    calls.push(url); signals.push(signal);
    if (url.endsWith('character.json')) return new Response(JSON.stringify(pkg));
    await gate;
    if (signal.aborted) throw new Error('aborted');
    return new Response(new Uint8Array(PAGE));
  };
  return { fetch, calls, signals, open };
}

const library = (options: PackageLibraryOptions) => new PackageLibrary({ url: (id, file) => `${id}/${file}`, graceMs: 0, ...options });

afterEach(() => { vi.useRealTimers(); });

describe('PackageLibrary', () => {
  it('decodes indexed pages to one byte per pixel and one palette row per costume', async () => {
    const { fetch, open } = server();
    open();
    const progress = vi.fn();
    const loaded = await library({ fetch }).acquire('sample', { progress }).ready;
    const page = loaded.pages.get('p0')!, texture = page.texture as THREE.DataTexture;
    expect([page.width, page.height, texture.format, texture.type, texture.minFilter, texture.magFilter, texture.unpackAlignment, texture.generateMipmaps])
      .toEqual([64, 32, THREE.RedFormat, THREE.UnsignedByteType, THREE.NearestFilter, THREE.NearestFilter, 1, false]);
    expect([...(texture.image.data as Uint8Array).subarray(0, 6)]).toEqual([0, 1, 2, 0, 1, 2]);
    expect([loaded.palette.image.width, loaded.palette.image.height, loaded.costumes]).toEqual([PALETTE_WIDTH, 2, 2]);
    const rows = loaded.palette.image.data as Uint8Array, entry = (row: number, i: number) => [...rows.subarray((row * PALETTE_WIDTH + i) * 4, (row * PALETTE_WIDTH + i) * 4 + 4)];
    expect(entry(0, 1)).toEqual([0x70, 0x40, 0x23, 255]);
    expect(entry(1, 1)).not.toEqual(entry(0, 1));
    expect(entry(1, 2)).toEqual([255, 255, 255, 255]);
    expect(loaded.gpuBytes).toBe(packageMemory(loaded.pkg).gpuBytes + PALETTE_WIDTH * 2 * 4);
    expect(progress).toHaveBeenLastCalledWith(1, 1);
    expect([costumeRow(loaded, 3), costumeRow(loaded, -1)]).toEqual([1, 1]);
  });

  it('shares one load between holders and unloads after the grace period once nobody holds it', async () => {
    vi.useFakeTimers();
    const { fetch, calls, open } = server();
    open();
    const packages = library({ fetch, graceMs: 1000 });
    const a = packages.acquire('sample'), b = packages.acquire('sample');
    const loaded = await a.ready;
    expect(await b.ready).toBe(loaded);
    expect(calls.filter(url => url.endsWith('character.json'))).toHaveLength(1);
    const disposed = vi.fn();
    loaded.pages.get('p0')!.texture.addEventListener('dispose', disposed);
    a.release(); a.release();
    b.release();
    vi.advanceTimersByTime(999);
    // Taken again within the grace period: still resident, nothing fetched again.
    const c = packages.acquire('sample');
    expect(await c.ready).toBe(loaded);
    c.release();
    vi.advanceTimersByTime(1000);
    expect(disposed).toHaveBeenCalledOnce();
    expect(packages.resident('sample')).toBeUndefined();
    expect(packages.diagnostics().packages).toEqual([]);
  });

  it('cancels a load when its only holder aborts, disposing what it made', async () => {
    const { fetch, signals, open } = server();
    const abort = new AbortController(), packages = library({ fetch });
    const lease = packages.acquire('sample', { signal: abort.signal });
    await vi.waitFor(() => expect(signals.length).toBe(2));
    abort.abort();
    open();
    await expect(lease.ready).rejects.toThrow(/cancelled/);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(packages.resident('sample')).toBeUndefined();
  });

  it('rejects a package that is invalid or not the pinned revision, and retries on the next acquire', async () => {
    const { fetch, open } = server();
    open();
    await expect(library({ fetch, revision: () => 'other' }).acquire('sample').ready).rejects.toThrow(/not the pinned other/);
    const broken = server({ ...PKG, pages: { p0: { ...PKG.pages.p0!, format: undefined } } });
    broken.open();
    await expect(library({ fetch: broken.fetch }).acquire('sample').ready).rejects.toThrow(/not indexed/);
    let fail = true;
    const flaky: PackageLibraryOptions['fetch'] = async (url, init) => {
      if (fail) { fail = false; return new Response('', { status: 404 }); }
      return fetch!(url, init);
    };
    const packages = library({ fetch: flaky, graceMs: 1000 });
    await expect(packages.acquire('sample').ready).rejects.toThrow(/HTTP 404/);
    await expect(packages.acquire('sample').ready).resolves.toMatchObject({ costumes: 2 });
  });

  it('lends a resident package for one drawing, or loads only the pages asked for and disposes them', async () => {
    const { fetch, calls, open } = server({ ...PKG, pages: { ...PKG.pages, p1: { ...PKG.pages.p0!, file: 'pages/p1.png' } },
      drawings: { ...PKG.drawings, 'idle/1': { ...PKG.drawings['idle/1']!, page: 'p1' } } });
    open();
    const packages = library({ fetch });
    const partial = await packages.borrow('sample', () => ['p1']);
    expect([...partial.loaded.pages.keys()]).toEqual(['p1']);
    expect(calls.filter(url => url.endsWith('.png'))).toEqual(['sample/pages/p1.png']);
    expect(packages.diagnostics().packages).toEqual([]);
    const disposed = vi.fn();
    partial.loaded.pages.get('p1')!.texture.addEventListener('dispose', disposed);
    partial.release(); partial.release();
    expect(disposed).toHaveBeenCalledOnce();

    const lease = packages.acquire('sample'), loaded = await lease.ready;
    const lent = await packages.borrow('sample', () => ['p1']);
    expect(lent.loaded).toBe(loaded);
    lease.release();
    // The borrow holds the package until it is returned.
    expect(packages.resident('sample')).toBe(loaded);
    lent.release();
    expect(packages.resident('sample')).toBeUndefined();
  });

  it('borrows from a package that is still loading without fetching its description again', async () => {
    const { fetch, calls, open } = server();
    const packages = library({ fetch });
    const lease = packages.acquire('sample'), borrowed = packages.borrow('sample', () => ['p0']);
    open();
    (await borrowed).release();
    await lease.ready;
    expect(calls.filter(url => url.endsWith('character.json'))).toHaveLength(1);
    lease.release();
  });

  it('spreads uploads to the attached renderer over frames, all at once on request', async () => {
    vi.useFakeTimers();
    const { fetch, open } = server();
    open();
    const uploaded: THREE.Texture[] = [], packages = library({ fetch });
    packages.attachRenderer({ initTexture: (texture: THREE.Texture) => uploaded.push(texture) } as unknown as THREE.WebGLRenderer);
    const lease = packages.acquire('sample'), loaded = await lease.ready;
    expect(uploaded).toEqual([]);
    packages.flushUploads(1);
    expect(uploaded).toEqual([loaded.pages.get('p0')!.texture]);
    packages.flushUploads();
    expect(uploaded).toEqual([loaded.pages.get('p0')!.texture, loaded.palette]);
    vi.runAllTimers();
    expect(uploaded).toHaveLength(2);
    lease.release();
  });

  it('reports how long a load took and the resident bytes', async () => {
    const { fetch, open } = server();
    open();
    const packages = library({ fetch, graceMs: 1000 });
    const lease = packages.acquire('sample'), loaded = await lease.ready;
    const [row] = packages.diagnostics().packages;
    expect(row).toMatchObject({ id: 'sample', refs: 1, loading: false, gpuBytes: loaded.gpuBytes });
    expect(row!.loadMs).toBeGreaterThanOrEqual(0);
    expect(packages.diagnostics()).toMatchObject({ gpuBytes: loaded.gpuBytes, cpuBytes: loaded.gpuBytes });
    lease.release();
  });

  it('loads every shipped package at its indexed revision and size', async () => {
    const root = path.resolve(import.meta.dirname, '../../../assets');
    const fetch: PackageLibraryOptions['fetch'] = async url => new Response(new Uint8Array(readFileSync(path.join(root, url))));
    const packages = new PackageLibrary({ url: packageAssetPath, fetch, graceMs: 0, revision: id => SHIPPED_PACKAGES.packages[id]?.revision });
    for (const [id, entry] of Object.entries(SHIPPED_PACKAGES.packages)) {
      const lease = packages.acquire(id), loaded = await lease.ready;
      expect([loaded.pkg.revision, loaded.pages.size]).toEqual([entry.revision, entry.pages]);
      expect(loaded.gpuBytes).toBe(entry.gpuBytes + PALETTE_WIDTH * loaded.costumes * 4);
      lease.release();
    }
  }, 60_000);
});
