/**
 * Thin wrapper around `pngjs` so the rest of the script never imports
 * the codec directly.
 *
 * Two reasons to isolate the codec here:
 *
 *   1. The pure remap in `paletteSwap.ts` should stay codec-free so it
 *      can run unmodified in the browser against `<canvas>` image data.
 *      Imports keep that boundary obvious.
 *
 *   2. Swapping `pngjs` for another encoder later (e.g. `sharp` if we
 *      hit a perf wall on 4 × 8 × 1024² pixels) only touches this file.
 *
 * `pngjs` is pure JavaScript, has no native deps (so it doesn't bloat
 * the dev install or the bundle), and emits / consumes the exact same
 * `[R,G,B,A,…]` row-major layout the remapper expects when we set
 * `colorType: 6` (RGBA, 8-bit).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA pixel buffer, length = width * height * 4. */
  readonly pixels: Uint8Array;
}

/**
 * Decode a PNG file from disk into RGBA pixels.
 *
 * Forces 8-bit RGBA output regardless of the source bit depth /
 * palette format so downstream code sees one canonical layout. PNGs
 * authored with indexed-colour palettes are still common in
 * pixel-art packs, and we need them in straight RGBA.
 */
export async function decodePngFile(path: string): Promise<DecodedImage> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`decodePngFile: cannot read ${path}: ${cause}`);
  }
  return decodePngBuffer(bytes, path);
}

/**
 * Decode an in-memory PNG buffer into RGBA pixels. Split out so unit
 * tests can drive the codec without touching the filesystem.
 */
export function decodePngBuffer(
  bytes: Buffer,
  whereForErrors = '<buffer>',
): DecodedImage {
  let png: PNG;
  try {
    png = PNG.sync.read(bytes);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`decodePngFile: ${whereForErrors} is not a valid PNG: ${cause}`);
  }
  // `pngjs` always returns 8-bit RGBA in `.data` regardless of source
  // bit depth, but assert the shape so a future codec swap fails loud.
  const expected = png.width * png.height * 4;
  if (png.data.length !== expected) {
    throw new Error(
      `decodePngFile: ${whereForErrors} decoded to ${png.data.length} ` +
        `bytes, expected ${expected} for ${png.width}×${png.height} RGBA`,
    );
  }
  // Copy into a plain Uint8Array — `png.data` is a Node Buffer subclass
  // but the rest of the script types against Uint8Array for portability.
  const pixels = new Uint8Array(png.data.length);
  pixels.set(png.data);
  return { width: png.width, height: png.height, pixels };
}

/**
 * Encode an RGBA pixel buffer back to PNG bytes. Pure — no I/O.
 */
export function encodePngBuffer(
  pixels: Uint8Array,
  width: number,
  height: number,
): Buffer {
  const expected = width * height * 4;
  if (pixels.length !== expected) {
    throw new Error(
      `encodePngBuffer: pixel buffer length ${pixels.length} does not ` +
        `match ${width}×${height}×4 = ${expected}`,
    );
  }
  const png = new PNG({
    width,
    height,
    colorType: 6, // RGBA
    bitDepth: 8,
    inputHasAlpha: true,
  });
  // `png.data` is a Buffer; copy our pixels into it.
  png.data = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  return PNG.sync.write(png);
}

/**
 * Encode + write a PNG file to disk.
 */
export async function writePngFile(
  path: string,
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<void> {
  const bytes = encodePngBuffer(pixels, width, height);
  await writeFile(path, bytes);
}
