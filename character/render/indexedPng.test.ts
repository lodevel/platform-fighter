import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { decodeIndexedPng } from './indexedPng';

function greyscalePng(width: number, height: number, value: (x: number, y: number) => number, filterType?: number): Uint8Array {
  const data = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = value(x, y);
  return PNG.sync.write({ width, height, data } as PNG, { colorType: 0, inputColorType: 0, inputHasAlpha: false, ...(filterType === undefined ? {} : { filterType }) });
}

describe('decodeIndexedPng', () => {
  it('returns every index exactly, whatever row filter the encoder chose', async () => {
    const value = (x: number, y: number) => (x * 37 + y * 11 + (x * y) % 7) & 255;
    for (const filterType of [undefined, 0, 1, 2, 3, 4]) {
      const image = await decodeIndexedPng(greyscalePng(29, 17, value, filterType));
      expect([image.width, image.height]).toEqual([29, 17]);
      expect(image.data.length).toBe(29 * 17);
      expect([...image.data]).toEqual(Array.from({ length: 29 * 17 }, (_, i) => value(i % 29, Math.floor(i / 29))));
    }
  });

  it('rejects colour images and non-PNG data', async () => {
    const rgba = PNG.sync.write({ width: 2, height: 2, data: Buffer.alloc(16) } as PNG);
    await expect(decodeIndexedPng(rgba)).rejects.toThrow(/greyscale/);
    await expect(decodeIndexedPng(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a PNG/);
  });
});
