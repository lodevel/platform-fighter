/**
 * Frame layout of a character sheet, Phaser-free so the game, the port and
 * tests read one implementation.
 *
 * A sheet is either a uniform grid (`frameWidth` x `frameHeight` cells) or
 * tight-packed: `atlas` is the image size and `trims[i]` is
 * `[x, y, w, h, dx, dy]`, the drawing's rect in the image and its offset
 * inside the logical `frameWidth` x `frameHeight` cell (written by
 * `tools/fighter-pack.py --layout tight`).
 */

/** `[x, y, w, h, dx, dy]`: rect in the atlas image, offset in the logical cell. */
export type FrameTrim = readonly [x: number, y: number, w: number, h: number, dx: number, dy: number];

/** The layout fields of a sheet, shared by manifest entries and loaded textures. */
export interface SheetLayout {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly frameCount: number;
  readonly margin?: number;
  readonly spacing?: number;
  /** Grid sheets: cells per row of the loaded image (see {@link gridCells}). */
  readonly columns?: number;
  readonly atlas?: readonly [number, number];
  readonly trims?: readonly FrameTrim[];
}

/** A drawing's rectangle in the image, and where it sits in its logical cell. */
export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly dx: number;
  readonly dy: number;
}

/** Phaser's spritesheet parser: row-major grid of whole frames. */
export function gridCells(sheet: SheetLayout, imageWidth: number, imageHeight: number): { columns: number; rows: number } {
  const margin = sheet.margin ?? 0, spacing = sheet.spacing ?? 0;
  return {
    columns: Math.floor((imageWidth - margin + spacing) / (sheet.frameWidth + spacing)),
    rows: Math.floor((imageHeight - margin + spacing) / (sheet.frameHeight + spacing)),
  };
}

/** The rect of drawing `i`: its trim, or the whole grid cell (offset 0,0). */
export function frameRect(sheet: SheetLayout, i: number): FrameRect {
  const trim = sheet.trims?.[i];
  if (trim) return { x: trim[0], y: trim[1], w: trim[2], h: trim[3], dx: trim[4], dy: trim[5] };
  if (sheet.trims) throw new RangeError(`Frame ${i} is outside the ${sheet.trims.length} packed drawings`);
  if (!sheet.columns) throw new Error('A grid sheet needs its column count to place a frame');
  const margin = sheet.margin ?? 0, spacing = sheet.spacing ?? 0;
  return {
    x: margin + (i % sheet.columns) * (sheet.frameWidth + spacing),
    y: margin + Math.floor(i / sheet.columns) * (sheet.frameHeight + spacing),
    w: sheet.frameWidth, h: sheet.frameHeight, dx: 0, dy: 0,
  };
}

/** The `atlas`/`trims` of a frames.json clip when it is tight-packed, else nothing (grid). */
export function packedLayoutOf(clip: object): Pick<SheetLayout, 'atlas' | 'trims'> {
  const { atlas, trims } = clip as { atlas?: SheetLayout['atlas']; trims?: SheetLayout['trims'] };
  return atlas && trims ? { atlas, trims } : {};
}

interface PhaserAtlasFrame {
  readonly frame: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly rotated: false;
  readonly trimmed: true;
  readonly spriteSourceSize: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly sourceSize: { readonly w: number; readonly h: number };
}

/**
 * Phaser's trimmed JSON-hash for `load.atlas(key, url, json)`. Frames are
 * named "0".."n-1" so `setFrame(i)` and frame numbers keep working, and
 * Phaser's own parser handles origin, flip and crop against the logical cell
 * (`realWidth` x `realHeight` = `frameWidth` x `frameHeight`).
 */
export function phaserAtlasJson(sheet: SheetLayout): {
  frames: Record<string, PhaserAtlasFrame>;
  meta: { size: { w: number; h: number } };
} {
  if (!sheet.trims || !sheet.atlas) throw new Error('phaserAtlasJson needs a sheet with atlas and trims');
  const frames: Record<string, PhaserAtlasFrame> = {};
  sheet.trims.forEach((_, i) => {
    const r = frameRect(sheet, i);
    frames[String(i)] = {
      frame: { x: r.x, y: r.y, w: r.w, h: r.h }, rotated: false, trimmed: true,
      spriteSourceSize: { x: r.dx, y: r.dy, w: r.w, h: r.h },
      sourceSize: { w: sheet.frameWidth, h: sheet.frameHeight },
    };
  });
  return { frames, meta: { size: { w: sheet.atlas[0], h: sheet.atlas[1] } } };
}
