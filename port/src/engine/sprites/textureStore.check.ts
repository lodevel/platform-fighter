import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextureStore } from './textureStore';

afterEach(() => { vi.restoreAllMocks(); });

describe('match texture lifetime', () => {
  it('releases old fighter GPU textures and decoded bitmaps, while retaining selected fighter and idle menu cards', async () => {
    const bitmaps: { width: number; height: number; close: ReturnType<typeof vi.fn> }[] = [];
    vi.spyOn(THREE.ImageBitmapLoader.prototype, 'loadAsync').mockImplementation(async () => {
      const bitmap = { width: 512, height: 512, close: vi.fn() }; bitmaps.push(bitmap);
      return bitmap as unknown as ImageBitmap;
    });
    const store = new TextureStore();
    const old = await store.load('char.link.d04final'), idle = await store.load('char.link.idle');
    await store.load('char.pikachu.idle');
    const disposed = vi.fn(); old.texture.addEventListener('dispose', disposed);
    store.retainMatchFighters(['pikachu']);
    expect(store.resident('char.link.d04final')).toBeUndefined();
    expect(store.resident('char.link.idle')).toBe(idle);
    expect(disposed).toHaveBeenCalledOnce();
    expect(bitmaps[0]!.close).toHaveBeenCalledOnce();
    expect(bitmaps[1]!.close).not.toHaveBeenCalled();
    expect(store.diagnostics().rgbaBytes).toBe(2 * 512 * 512 * 4);
  });

  it('does not resurrect an obsolete in-flight fighter texture after roster changes', async () => {
    let finish!: (bitmap: ImageBitmap) => void;
    vi.spyOn(THREE.ImageBitmapLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const store = new TextureStore(), loading = store.load('char.link.d04final');
    store.retainMatchFighters(['pikachu']);
    const close = vi.fn(); finish({ width: 512, height: 512, close } as unknown as ImageBitmap);
    await loading;
    expect(store.resident('char.link.d04final')).toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
    expect(store.diagnostics().pending).toEqual([]);
  });

  it('records a failed decode and permits an explicit preload retry', async () => {
    const loader = vi.spyOn(THREE.ImageBitmapLoader.prototype, 'loadAsync')
      .mockRejectedValueOnce(new Error('decode failed')).mockResolvedValue({ width: 512, height: 512 } as ImageBitmap);
    const store = new TextureStore();
    await expect(store.load('char.link.idle')).rejects.toThrow('decode failed');
    expect(store.get('char.link.idle')).toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(store.diagnostics().failures).toEqual({ 'char.link.idle': 'decode failed' });
    await store.load('char.link.idle');
    expect(store.diagnostics().failures).toEqual({});
  });
});
