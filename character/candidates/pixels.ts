import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { CharacterPackage, Drawing, DrawingId, Page, PageId } from '../package/types';

/** Design pixels per cell of a drawing signature. */
const CELL = 4;
/** Transparent pixels kept around each drawing on a packed page, so filtering never bleeds. */
const PADDING = 2;

/**
 * A drawing reduced to a coarse grid in design space, its root at the origin:
 * premultiplied RGBA averaged per CELL × CELL design pixels.
 */
export interface Signature { readonly x0: number; readonly y0: number; readonly w: number; readonly h: number; readonly rgba: Float32Array }

export function readPage(dir: string, page: Page): PNG {
  return PNG.sync.read(readFileSync(path.join(dir, page.file)));
}

export function signature(page: PNG, drawing: Drawing): Signature {
  const [rx, ry, rw, rh] = drawing.rect, [ax, ay] = drawing.anchor, s = drawing.scale;
  const x0 = Math.floor(-ax * s / CELL), y0 = Math.floor(-ay * s / CELL);
  const w = Math.floor((rw - ax) * s / CELL) - x0 + 1, h = Math.floor((rh - ay) * s / CELL) - y0 + 1;
  const sums = new Float32Array(w * h * 4), area = (CELL / s) ** 2;
  for (let y = 0; y < rh; y++) {
    const cy = Math.floor((y - ay) * s / CELL) - y0;
    for (let x = 0; x < rw; x++) {
      const i = ((ry + y) * page.width + rx + x) * 4, a = page.data[i + 3]! / 255;
      if (a === 0) continue;
      const c = (cy * w + Math.floor((x - ax) * s / CELL) - x0) * 4;
      for (let k = 0; k < 3; k++) sums[c + k] = sums[c + k]! + page.data[i + k]! / 255 * a;
      sums[c + 3] = sums[c + 3]! + a;
    }
  }
  for (let i = 0; i < sums.length; i++) sums[i] = Math.min(1, sums[i]! / area);
  return { x0, y0, w, h, rgba: sums };
}

/**
 * How different two drawings look placed at the same root: the mean absolute
 * difference of premultiplied RGBA over the cells either one covers, 0..1.
 */
export function signatureDiff(a: Signature, b: Signature): number {
  const x0 = Math.min(a.x0, b.x0), y0 = Math.min(a.y0, b.y0);
  const x1 = Math.max(a.x0 + a.w, b.x0 + b.w), y1 = Math.max(a.y0 + a.h, b.y0 + b.h);
  const at = (s: Signature, x: number, y: number, k: number) =>
    x < s.x0 || y < s.y0 || x >= s.x0 + s.w || y >= s.y0 + s.h ? 0 : s.rgba[((y - s.y0) * s.w + x - s.x0) * 4 + k]!;
  let total = 0, covered = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (at(a, x, y, 3) < 0.02 && at(b, x, y, 3) < 0.02) continue;
    covered++;
    for (let k = 0; k < 4; k++) total += Math.abs(at(a, x, y, k) - at(b, x, y, k));
  }
  return covered ? total / (covered * 4) : 0;
}

/**
 * Writes the drawings kept by `pkg` onto fresh pages, one per source page, shelf-packed
 * in near-square pages, and returns the package pointing at them. Drawing ids stay.
 */
export function repack(pkg: CharacterPackage, sourceDir: string, outDir: string): CharacterPackage {
  let cached: [PageId, PNG] | undefined;
  return packDrawings(pkg, outDir, (_id, drawing) => {
    if (cached?.[0] !== drawing.page) cached = [drawing.page, readPage(sourceDir, pkg.pages[drawing.page]!)];
    return crop(cached[1], drawing.rect);
  });
}

/**
 * Packs one image per drawing of `pkg` (given by `image`, asked page by page) onto
 * fresh pages grouped like the source pages, and returns the package pointing at them.
 * Each drawing keeps its fields except `rect`, which becomes the image's place.
 */
export function packDrawings(pkg: CharacterPackage, outDir: string, image: (id: DrawingId, drawing: Drawing) => PNG): CharacterPackage {
  const byPage = new Map<PageId, DrawingId[]>();
  for (const [id, drawing] of Object.entries(pkg.drawings)) byPage.set(drawing.page, [...(byPage.get(drawing.page) ?? []), id]);
  const pages: Record<PageId, Page> = {}, drawings: Record<DrawingId, Drawing> = {};
  for (const [pageId, ids] of [...byPage].sort(([a], [b]) => a.localeCompare(b))) {
    const images = new Map(ids.map(id => [id, image(id, pkg.drawings[id]!)]));
    const sized = ids.map(id => ({ id, w: images.get(id)!.width + PADDING * 2, h: images.get(id)!.height + PADDING * 2 }))
      .sort((a, b) => b.h - a.h || a.id.localeCompare(b.id));
    const placed = smallestShelfPacking(sized), width = align(Math.max(...placed.map(d => d.x + d.w)));
    const out = new PNG({ width, height: align(Math.max(...placed.map(d => d.y + d.h))) });
    for (const d of placed) {
      const png = images.get(d.id)!;
      PNG.bitblt(png, out, 0, 0, png.width, png.height, d.x + PADDING, d.y + PADDING);
      drawings[d.id] = { ...pkg.drawings[d.id]!, rect: [d.x + PADDING, d.y + PADDING, png.width, png.height] };
    }
    const file = `pages/${pageId}.png`, bytes = PNG.sync.write(out);
    writeFileSync(path.join(outDir, file), bytes);
    pages[pageId] = { file, width: out.width, height: out.height, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  return { ...pkg, pages, drawings };
}

/** A drawing's rectangle cut out of its page. */
export function crop(page: PNG, [x, y, w, h]: readonly [number, number, number, number]): PNG {
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(page, out, x, y, w, h, 0, 0);
  return out;
}

/**
 * Shelf packing (rows of drawings sorted by height) at the page width, among a range
 * around the square, that gives the smallest page.
 */
function smallestShelfPacking<D extends { readonly w: number; readonly h: number }>(sized: readonly D[]): (D & { x: number; y: number })[] {
  const area = sized.reduce((sum, d) => sum + d.w * d.h, 0), widest = Math.max(...sized.map(d => d.w));
  let best: (D & { x: number; y: number })[] = [], bestArea = Infinity;
  for (let f = 0.8; f <= 2.5; f += 0.05) {
    const width = Math.max(widest, Math.ceil(Math.sqrt(area) * f));
    let x = 0, y = 0, row = 0;
    const placed = sized.map(d => {
      if (x + d.w > width) { x = 0; y += row; row = 0; }
      const at = { ...d, x, y };
      x += d.w; row = Math.max(row, d.h);
      return at;
    });
    const pageArea = align(Math.max(...placed.map(d => d.x + d.w))) * align(y + row);
    if (pageArea < bestArea) { best = placed; bestArea = pageArea; }
  }
  return best;
}

/** Rounded up to whole 4×4 blocks, as BC7 stores them. */
const align = (n: number) => Math.ceil(n / 4) * 4;
