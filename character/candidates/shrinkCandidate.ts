/**
 * Phase 3 candidate: drawings stored at the size a match shows them, optionally reduced
 * to one palette per character.
 *   npx tsx character/candidates/shrinkCandidate.ts <id> [--zoom 1.4] [--final-zoom 2.8] [--colors 256] [--packages dir]
 * Reads <packages>/<id> and writes, beside it:
 *   <id>~small            every drawing shrunk to <zoom> screen px per design px on a
 *                         1080p screen (<final-zoom> for drawings only Finals show), BC7 priced;
 *   <id>~small-c<n>       the same, reduced to one palette of <n> entries (transparent included,
 *                         at most 256) on indexed pages: one byte per pixel on the GPU.
 * Node only; no game code.
 */
import type { Drawing, DrawingId } from '../package/types';
import { readCandidateSource, writeCandidate } from './output';
import { encodeIndexed, fitPalette, paletteColors, quantize } from './palette';
import { crop, packDrawings, readPage } from './pixels';
import { shrink } from './resample';
import type { PNG } from 'pngjs';

const input = readCandidateSource('shrinkCandidate.ts <id> [--zoom 1.4] [--final-zoom 2.8] [--colors 256] [--packages dir]');
const zoom = Number(input.option('--zoom') ?? 1.4), finalZoom = Number(input.option('--final-zoom') ?? 2.8);
const colors = (input.option('--colors') ?? '256').split(',').map(Number);
if (colors.some(n => !(n >= 2 && n <= 256))) throw new Error('--colors must be between 2 and 256');
const IMPORTER = { name: 'shrink candidate', version: '2' };
const isFinal = (action: string) => action.includes('final') && !action.includes('victim');

// A drawing shown by any ordinary action is stored for the ordinary zoom.
const ordinary = new Set<DrawingId>();
for (const [name, action] of Object.entries(input.pkg.actions))
  if (!isFinal(name)) for (const w of action.drawings.windows) ordinary.add(w.drawing);

const shrunk = new Map<DrawingId, { image: PNG; drawing: Drawing }>();
for (const [pageId, page] of Object.entries(input.pkg.pages)) {
  const png = readPage(input.dir, page);
  for (const [id, drawing] of Object.entries(input.pkg.drawings)) {
    if (drawing.page !== pageId) continue;
    const [, , w, h] = drawing.rect, factor = Math.min(1, (ordinary.has(id) ? zoom : finalZoom) * drawing.scale);
    const width = Math.max(1, Math.round(w * factor)), height = Math.max(1, Math.round(h * factor));
    shrunk.set(id, { image: shrink(crop(png, drawing.rect), width, height),
      drawing: { ...drawing, scale: drawing.scale * w / width, anchor: [drawing.anchor[0] * width / w, drawing.anchor[1] * height / h] } });
  }
}
const resized = { ...input.pkg, drawings: Object.fromEntries([...shrunk].map(([id, s]) => [id, s.drawing])) };
const settings = { zoom, finalZoom };

await writeCandidate(input, 'small', IMPORTER, settings, dir => packDrawings(resized, dir, id => shrunk.get(id)!.image));
for (const size of colors) {
  const palette = fitPalette([...shrunk.values()].map(s => s.image), size);
  await writeCandidate(input, `small-c${size}`, IMPORTER, { ...settings, colors: size },
    dir => ({ ...packDrawings(resized, dir, id => quantize(shrunk.get(id)!.image, palette), { format: 'indexed', encode: encodeIndexed }),
      palette: paletteColors(palette) }));
}
