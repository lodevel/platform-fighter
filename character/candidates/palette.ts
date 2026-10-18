import { PNG } from 'pngjs';

/** Premultiplied RGBA, 0..255. Entry 0 is always transparent. */
export type Palette = readonly (readonly [number, number, number, number])[];

/** Pixels whose alpha is below this become the transparent entry. */
const CLEAR = 8;

/**
 * A palette of `size` entries (transparent included) fitted to the images' visible
 * pixels by k-means in premultiplied RGBA, from an evenly spaced sample. Deterministic.
 */
export function fitPalette(images: readonly PNG[], size: number, samples = 300_000): Palette {
  const visible = images.reduce((n, png) => n + countVisible(png), 0), every = Math.max(1, Math.floor(visible / samples));
  const points: number[][] = [];
  let seen = 0;
  for (const png of images) for (let i = 0; i < png.width * png.height; i++)
    if (png.data[i * 4 + 3]! >= CLEAR && seen++ % every === 0) points.push(premultiplied(png.data, i));
  const centres = seedCentres(points, size - 1);
  for (let round = 0; round < 24; round++) {
    const sums = centres.map(() => [0, 0, 0, 0, 0]);
    for (const p of points) { const s = sums[nearest(centres, p)]!; for (let k = 0; k < 4; k++) s[k]! += p[k]!; s[4]! += 1; }
    sums.forEach((s, c) => { if (s[4]) centres[c] = s.slice(0, 4).map(v => v / s[4]!); });
  }
  return [[0, 0, 0, 0], ...centres.map(c => c.map(Math.round) as [number, number, number, number])];
}

/**
 * The image as palette indices: every pixel becomes its nearest entry, stored in R, G and
 * B, with alpha 255 (0 for the transparent entry) so packing pads with entry 0.
 */
export function quantize(image: PNG, palette: Palette): PNG {
  const out = new PNG({ width: image.width, height: image.height }), cache = new Map<number, number>();
  const visible = palette.slice(1).map(e => [...e]);
  for (let i = 0; i < image.width * image.height; i++) {
    const d = image.data, key = d.readUInt32BE(i * 4);
    let index = cache.get(key);
    if (index === undefined) {
      index = d[i * 4 + 3]! < CLEAR ? 0 : 1 + nearest(visible, premultiplied(d, i));
      cache.set(key, index);
    }
    out.data.fill(index, i * 4, i * 4 + 3); out.data[i * 4 + 3] = index ? 255 : 0;
  }
  return out;
}

/** The palette as the package stores it: `#rrggbbaa`, straight alpha. */
export const paletteColors = (palette: Palette): string[] => palette.map(([r, g, b, a]) =>
  '#' + [a ? r * 255 / a : 0, a ? g * 255 / a : 0, a ? b * 255 / a : 0, a].map(c => Math.round(Math.min(255, c)).toString(16).padStart(2, '0')).join(''));

/** An index image (from `quantize`) as a greyscale PNG, the file format of an indexed page. */
export function encodeIndexed(page: PNG): Buffer {
  const grey = Buffer.alloc(page.width * page.height);
  for (let i = 0; i < grey.length; i++) grey[i] = page.data[i * 4]!;
  return PNG.sync.write({ width: page.width, height: page.height, data: grey } as PNG, { colorType: 0, inputColorType: 0, inputHasAlpha: false });
}

const premultiplied = (data: Buffer, i: number): number[] => {
  const a = data[i * 4 + 3]!;
  return [data[i * 4]! * a / 255, data[i * 4 + 1]! * a / 255, data[i * 4 + 2]! * a / 255, a];
};

const countVisible = (png: PNG) => { let n = 0; for (let i = 3; i < png.data.length; i += 4) if (png.data[i]! >= CLEAR) n++; return n; };

function nearest(centres: readonly (readonly number[])[], p: readonly number[]): number {
  let best = 0, bestDistance = Infinity;
  centres.forEach((c, i) => {
    const d = (c[0]! - p[0]!) ** 2 + (c[1]! - p[1]!) ** 2 + (c[2]! - p[2]!) ** 2 + (c[3]! - p[3]!) ** 2;
    if (d < bestDistance) { best = i; bestDistance = d; }
  });
  return best;
}

/** k-means++ seeding with a fixed pseudo-random sequence. */
function seedCentres(points: readonly number[][], count: number): number[][] {
  let state = 1;
  const random = () => (state = (state * 48271) % 2147483647) / 2147483647;
  const centres = [points[Math.floor(random() * points.length)]!.slice()];
  const distance = points.map(p => sq(p, centres[0]!));
  while (centres.length < Math.min(count, points.length)) {
    let target = random() * distance.reduce((a, b) => a + b, 0), i = 0;
    while (i < points.length - 1 && (target -= distance[i]!) > 0) i++;
    centres.push(points[i]!.slice());
    points.forEach((p, j) => { distance[j] = Math.min(distance[j]!, sq(p, centres.at(-1)!)); });
  }
  return centres;
}

const sq = (a: readonly number[], b: readonly number[]) => a.reduce((s, v, k) => s + (v - b[k]!) ** 2, 0);
