import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { encodeIndexed, fitPalette, paletteColors, quantize } from './palette';

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
    const indices = quantize(png, palette), entry = (i: number) => indices.data[i * 4]!;
    expect([0, 1, 2].map(i => paletteColors(palette)[entry(i)])).toEqual(['#c81e1eff', '#1ec81eff', '#1e1ec8ff']);
    expect([...indices.data.slice(12)]).toEqual([0, 0, 0, 0]);
  });
  it('encodes indices as a greyscale PNG that reads back to the same values', () => {
    const indices = quantize(image([[200, 30, 30, 255], [0, 0, 0, 0]]), [[0, 0, 0, 0], [200, 30, 30, 255]]);
    const back = PNG.sync.read(encodeIndexed(indices));
    expect([back.data[0], back.data[4]]).toEqual([1, 0]);
  });
  it('merges colours when the palette is smaller', () => {
    const png = image([[100, 100, 100, 255], [104, 104, 104, 255], [250, 250, 250, 255]]);
    const palette = fitPalette([png], 3), out = quantize(png, palette);
    expect(out.data[0]).toBe(out.data[4]);
    expect(paletteColors(palette)[out.data[8]!]).toBe('#fafafaff');
  });
});
