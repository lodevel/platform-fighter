import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { fitPalette, indexBits, quantize } from './palette';

const image = (pixels: number[][]) => {
  const png = new PNG({ width: pixels.length, height: 1 });
  pixels.forEach((p, i) => png.data.set(p, i * 4));
  return png;
};

describe('palette', () => {
  it('keeps a few exact colours exactly and transparency as entry 0', () => {
    const png = image([[200, 30, 30, 255], [30, 200, 30, 255], [30, 30, 200, 255], [9, 9, 9, 3]]);
    const palette = fitPalette([png], 4);
    expect(palette[0]).toEqual([0, 0, 0, 0]);
    expect([...quantize(png, palette).data]).toEqual([200, 30, 30, 255, 30, 200, 30, 255, 30, 30, 200, 255, 0, 0, 0, 0]);
  });
  it('merges colours when the palette is smaller', () => {
    const png = image([[100, 100, 100, 255], [104, 104, 104, 255], [250, 250, 250, 255]]);
    const out = quantize(png, fitPalette([png], 3));
    expect(out.data[0]).toBe(out.data[4]);
    expect(out.data[8]).toBe(250);
  });
  it('counts index bits', () => expect([16, 17, 32].map(indexBits)).toEqual([4, 5, 5]));
});
