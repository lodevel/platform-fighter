import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { shrink } from './resample';

const image = (width: number, height: number, pixels: number[][]) => {
  const png = new PNG({ width, height });
  pixels.forEach((p, i) => png.data.set(p, i * 4));
  return png;
};

describe('shrink', () => {
  it('averages areas in premultiplied space, so transparent pixels keep the colour', () => {
    const out = shrink(image(2, 2, [[255, 0, 0, 255], [0, 0, 0, 0], [0, 0, 255, 255], [0, 0, 0, 0]]), 1, 1);
    expect([...out.data]).toEqual([128, 0, 128, 128]);
  });
  it('weights partly covered source pixels', () => {
    const out = shrink(image(3, 1, [[0, 0, 0, 255], [255, 255, 255, 255], [255, 255, 255, 255]]), 2, 1);
    expect([...out.data]).toEqual([85, 85, 85, 255, 255, 255, 255, 255]);
  });
});
