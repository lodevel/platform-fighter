import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findAssetEntry, type SpritesheetAssetEntry } from '../../../../src/assets/manifest';
import { TextureStore } from './textureStore';

const LISTED = 'char.link.a01turn', UNLISTED = 'char.link.a00waititem', ITEM = 'item.food.Turkey.sprite';
const entry = findAssetEntry(LISTED) as SpritesheetAssetEntry;
const [atlasW, atlasH] = entry.atlas!;
const padded = (n: number) => Math.ceil(n / 4) * 4;
const INDEX = { schema: 'compressed-sheets/1', sheets: { 'animations/a01turn.png': {
  url: 'compressed/animations/a01turn.ktx2', width: padded(atlasW), height: padded(atlasH), sourceWidth: atlasW, sourceHeight: atlasH } } };
/** The WebGL extension surface KTX2Loader.detectSupport reads: BC7 only. */
const bc7Renderer = { extensions: { has: (name: string) => name === 'EXT_texture_compression_bptc' } } as unknown as THREE.WebGLRenderer;

const spyKtx2 = () => vi.spyOn(KTX2Loader.prototype, 'loadAsync');
const fakeFetch = (response: { ok: boolean; status: number; json: () => Promise<unknown> }) => vi.fn(async () => response);
let fetchIndex: ReturnType<typeof fakeFetch>, ktx2: ReturnType<typeof spyKtx2>;
beforeEach(() => {
  vi.spyOn(THREE.ImageBitmapLoader.prototype, 'loadAsync')
    .mockImplementation(async () => ({ width: 64, height: 32, close: vi.fn() }) as unknown as ImageBitmap);
  ktx2 = spyKtx2().mockImplementation(async () => {
    const w = padded(atlasW), h = padded(atlasH);
    return new THREE.CompressedTexture([{ data: new Uint8Array(w * h), width: w, height: h }], w, h, THREE.RGBA_BPTC_Format);
  });
  fetchIndex = fakeFetch({ ok: true, status: 200, json: async () => INDEX });
  vi.stubGlobal('fetch', fetchIndex);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function compressedStore(): TextureStore {
  const store = new TextureStore();
  store.attachRenderer(bc7Renderer);
  store.setTextureQuality('compressed');
  return store;
}

describe('texture quality', () => {
  it('defaults to full PNG sheets without reading any compressed index', async () => {
    const store = new TextureStore();
    expect(store.textureQuality).toBe('full');
    expect(store.compressedSupport()).toBeNull();
    const sheet = await store.load(LISTED);
    expect(sheet.width).toBe(atlasW);
    expect(fetchIndex).not.toHaveBeenCalled();
    expect(store.diagnostics()).toMatchObject({ textureQuality: 'full', fallbacks: {},
      resident: [{ key: LISTED, format: 'rgba8', textureBytes: 64 * 32 * 4, rgbaBytes: 64 * 32 * 4 }] });
  });

  it('reports the GPU formats the transcoder can target', () => {
    const store = new TextureStore();
    store.attachRenderer(bc7Renderer);
    expect(store.compressedSupport()).toEqual({ native: true, formats: ['bptc'] });
    store.attachRenderer({ extensions: { has: () => false } } as unknown as THREE.WebGLRenderer);
    expect(store.compressedSupport()).toEqual({ native: false, formats: [] });
  });

  it('releases the transcoder workers once compressed loading has been idle for a second', async () => {
    const dispose = vi.spyOn(KTX2Loader.prototype, 'dispose').mockReturnThis();
    vi.useFakeTimers();
    try {
      const store = compressedStore();
      await store.load(LISTED);
      vi.advanceTimersByTime(999);
      expect(dispose).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(dispose).toHaveBeenCalledOnce();
      expect(store.compressedSupport()).toEqual({ native: true, formats: ['bptc'] });
    } finally { vi.useRealTimers(); }
  });

  it('loads listed character sheets as KTX2 with padded UV dimensions and the manifest layout', async () => {
    const store = compressedStore();
    const sheet = await store.load(LISTED);
    expect(ktx2).toHaveBeenCalledWith('/characters/link/compressed/animations/a01turn.ktx2');
    expect(sheet.texture).toBeInstanceOf(THREE.CompressedTexture);
    expect(sheet.texture).toMatchObject({ flipY: false, premultiplyAlpha: false, minFilter: THREE.LinearFilter, generateMipmaps: false });
    expect([sheet.width, sheet.height]).toEqual([padded(atlasW), padded(atlasH)]);
    expect(sheet).toMatchObject({ frameWidth: entry.frameWidth, frameHeight: entry.frameHeight, trims: entry.trims, frameCount: entry.trims!.length });
    const bytes = padded(atlasW) * padded(atlasH);
    expect(store.diagnostics()).toMatchObject({ textureQuality: 'compressed', textureBytes: bytes,
      resident: [{ key: LISTED, format: 'bc7', textureBytes: bytes, rgbaBytes: bytes * 4 }] });
  });

  it('falls back to PNG for unlisted sheets, never compresses other assets, and fetches each index once', async () => {
    const store = compressedStore();
    await Promise.all([store.load(LISTED), store.load(UNLISTED), store.load(ITEM)]);
    expect(fetchIndex).toHaveBeenCalledOnce();
    expect(fetchIndex).toHaveBeenCalledWith('/characters/link/compressed/index.json');
    expect(ktx2).toHaveBeenCalledOnce();
    expect(store.resident(UNLISTED)!.texture).not.toBeInstanceOf(THREE.CompressedTexture);
    expect(store.resident(ITEM)!.texture).not.toBeInstanceOf(THREE.CompressedTexture);
    expect(store.diagnostics().fallbacks).toEqual({ [UNLISTED]: 'animations/a00waititem.png is not in the compressed index' });
  });

  it('records a missing index or failed transcode per sheet with one warning per fighter', async () => {
    fetchIndex.mockImplementation(async () => ({ ok: false, status: 404, json: async () => null }));
    const store = compressedStore();
    await Promise.all([store.load(LISTED), store.load(UNLISTED)]);
    expect(store.diagnostics().fallbacks).toEqual({ [LISTED]: '/characters/link/compressed/index.json: HTTP 404',
      [UNLISTED]: '/characters/link/compressed/index.json: HTTP 404' });
    expect(vi.mocked(console.warn).mock.calls.filter(([text]) => String(text).startsWith('Compressed textures'))).toHaveLength(1);

    fetchIndex.mockImplementation(async () => ({ ok: true, status: 200, json: async () => INDEX }));
    ktx2.mockRejectedValueOnce(new Error('transcoder unavailable'));
    const retry = compressedStore();
    expect((await retry.load(LISTED)).texture).not.toBeInstanceOf(THREE.CompressedTexture);
    expect(retry.diagnostics().fallbacks).toEqual({ [LISTED]: 'transcoder unavailable' });
    expect(retry.diagnostics().failures).toEqual({});
  });

  it('falls back without a renderer to pick transcoder targets', async () => {
    const store = new TextureStore();
    store.setTextureQuality('compressed');
    await store.load(LISTED);
    expect(store.diagnostics().fallbacks).toEqual({ [LISTED]: 'no renderer attached' });
    expect(fetchIndex).not.toHaveBeenCalled();
  });

  it('switching quality releases only character sheets of the other quality', async () => {
    const store = compressedStore();
    const compressed = await store.load(LISTED), fallback = await store.load(UNLISTED), item = await store.load(ITEM);
    const disposed = vi.fn(); compressed.texture.addEventListener('dispose', disposed);
    store.setTextureQuality('full');
    expect(disposed).toHaveBeenCalledOnce();
    expect((compressed.texture as THREE.CompressedTexture).mipmaps).toEqual([]);
    expect(store.resident(LISTED)).toBeUndefined();
    expect(store.resident(UNLISTED)).toBe(fallback);
    expect(store.resident(ITEM)).toBe(item);
    expect(store.diagnostics().fallbacks).toEqual({});

    const png = await store.load(LISTED);
    const close = (png.texture.image as { close: ReturnType<typeof vi.fn> }).close;
    store.setTextureQuality('compressed');
    expect(close).toHaveBeenCalledOnce();
    expect(store.resident(UNLISTED)).toBeUndefined();
    expect(store.resident(ITEM)).toBe(item);
    expect((await store.load(LISTED)).texture).toBeInstanceOf(THREE.CompressedTexture);
  });

  it('reloads a sheet whose load finished after the quality changed', async () => {
    const store = compressedStore();
    const loading = store.load(LISTED);
    store.setTextureQuality('full');
    const sheet = await loading;
    expect(sheet.texture).not.toBeInstanceOf(THREE.CompressedTexture);
    expect(store.resident(LISTED)).toBe(sheet);
    expect(store.diagnostics().pending).toEqual([]);
  });
});
