/**
 * Pure pixel-level palette remap — no I/O, no PNG codec.
 *
 * --------------------------------------------------------------------
 * Purpose
 * --------------------------------------------------------------------
 *
 * Sub-AC 2 of AC 10202 — the deterministic transform half of the
 * palette-swap script. Given a flat RGBA pixel buffer (the canonical
 * spritesheet) and a {@link ParsedVariant} (one of the 8 entries from a
 * character's palette JSON), produce a new RGBA buffer where every
 * pixel matching `variant.mappings[slot].source` is rewritten to
 * `variant.mappings[slot].target`.
 *
 * Pixels that match no slot are copied through unchanged. **Alpha is
 * always preserved** — palette swaps are colour-only, so transparent
 * edges and shared neutrals (black outlines, white highlights when not
 * declared as a slot) survive every variant.
 *
 * The transform is split out from the PNG codec and the file I/O so:
 *
 *   1. Unit tests can drive it with a 4-pixel buffer and assert the
 *      exact byte output, without faking PNG headers.
 *
 *   2. The same transform can later run in the browser against a
 *      `Uint8ClampedArray` from a `<canvas>` `getImageData()` call —
 *      e.g. an in-game palette preview — without re-implementing it.
 *
 *   3. Determinism is provably trivial: same input bytes + same variant
 *      → same output bytes, byte-for-byte. Property tested below.
 *
 * --------------------------------------------------------------------
 * Pixel format
 * --------------------------------------------------------------------
 *
 * The buffer layout matches what `pngjs` emits for an 8-bit/RGBA PNG:
 * a flat `Uint8Array` (or `Buffer`) of length `width * height * 4`,
 * with channels packed as `[R, G, B, A, R, G, B, A, …]` row-major.
 *
 * Match comparison is **per-channel exact** on R/G/B; the source pixel
 * art is flat-colour with no anti-aliasing (per `palette.schema.json`
 * authoring rules), so an exact compare is correct and fast. A
 * tolerance/ε mode is intentionally NOT in scope here — that belongs
 * to the runtime shader where AA edges may exist.
 */

import type {
  ParsedVariant,
  PaletteSlot,
  Rgb24,
} from './paletteDefinition.js';
import { PALETTE_SLOTS } from './paletteDefinition.js';

/**
 * Internal compiled lookup: an array of `[r, g, b, tr, tg, tb]` tuples
 * (one per declared slot mapping) plus a byte-keyed quick-reject set.
 *
 * Compiling the variant once and reusing it across every pixel means
 * the inner loop is a tight 3-iteration linear scan with no string ops
 * or object allocations. On a 1024×1024 atlas (~1 M pixels) that
 * matters.
 */
interface CompiledRemap {
  readonly entries: ReadonlyArray<{
    readonly slot: PaletteSlot;
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly tr: number;
    readonly tg: number;
    readonly tb: number;
    /** Number of pixels actually rewritten — diagnostic only. */
    rewrittenPixelCount: number;
  }>;
  /**
   * `Set<packedRgb>` of source colours; packed RGB
   * (0xRRGGBB) is the cheap single-int key.
   *
   * Used as a fast pre-check: if the pixel's packed RGB is not in
   * this set, skip the linear scan entirely. For real spritesheets
   * the vast majority of pixels are either transparent or unmatched
   * neutrals, so the early-out dominates the runtime.
   */
  readonly sourcePackedSet: Set<number>;
}

function compileVariant(variant: ParsedVariant): CompiledRemap {
  const entries = variant.mappings.map((m) => ({
    slot: m.slot,
    r: (m.source >> 16) & 0xff,
    g: (m.source >> 8) & 0xff,
    b: m.source & 0xff,
    tr: (m.target >> 16) & 0xff,
    tg: (m.target >> 8) & 0xff,
    tb: m.target & 0xff,
    rewrittenPixelCount: 0,
  }));
  const set = new Set<number>();
  for (const e of entries) {
    set.add(((e.r << 16) | (e.g << 8) | e.b) >>> 0);
  }
  return { entries, sourcePackedSet: set };
}

/**
 * Result of one palette swap, returned alongside the new buffer for
 * diagnostics / smoke tests. The CLI surfaces this as
 * `wolf #4 Royal: 38421 body, 9211 accent, 1402 highlight pixels`.
 */
export interface PaletteSwapStats {
  readonly variantIndex: number;
  readonly variantName: string;
  readonly totalPixels: number;
  /** Pixels rewritten per slot, keyed by slot name. */
  readonly perSlot: Readonly<Record<PaletteSlot, number>>;
  /** Pixels that matched no slot and were copied through verbatim. */
  readonly passThroughPixels: number;
  /** Pixels with alpha == 0 (skipped — fully transparent). */
  readonly transparentPixels: number;
  /** Whether this variant is the canonical (variant 0) identity swap. */
  readonly isCanonical: boolean;
}

/**
 * Apply a single palette variant to a source RGBA pixel buffer.
 *
 * Returns a brand-new buffer (the source is not mutated) plus a stats
 * record. Pure / deterministic.
 */
export function applyPaletteVariant(
  sourcePixels: Uint8Array,
  width: number,
  height: number,
  variant: ParsedVariant,
): { readonly pixels: Uint8Array; readonly stats: PaletteSwapStats } {
  const expectedLength = width * height * 4;
  if (sourcePixels.length !== expectedLength) {
    throw new Error(
      `applyPaletteVariant: pixel buffer length ${sourcePixels.length} ` +
        `does not match ${width}×${height}×4 = ${expectedLength}`,
    );
  }

  const out = new Uint8Array(sourcePixels.length);
  out.set(sourcePixels);

  const compiled = compileVariant(variant);

  const totalPixels = width * height;
  let passThrough = 0;
  let transparent = 0;

  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3]!;
    if (a === 0) {
      // Fully transparent — leave alone, do not even pretend to match.
      transparent++;
      continue;
    }
    const r = out[i]!;
    const g = out[i + 1]!;
    const b = out[i + 2]!;
    const packed = ((r << 16) | (g << 8) | b) >>> 0;

    if (!compiled.sourcePackedSet.has(packed)) {
      passThrough++;
      continue;
    }

    let matched = false;
    for (const e of compiled.entries) {
      if (e.r === r && e.g === g && e.b === b) {
        out[i] = e.tr;
        out[i + 1] = e.tg;
        out[i + 2] = e.tb;
        // Alpha preserved — out[i+3] already = a.
        e.rewrittenPixelCount++;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Defensive: the packed-set hit but no slot matched — only
      // possible if two slots share an `r,g,b` triple, which the
      // schema forbids on the canonical pass.
      passThrough++;
    }
  }

  const perSlot = {} as Record<PaletteSlot, number>;
  for (const slot of PALETTE_SLOTS) {
    const e = compiled.entries.find((x) => x.slot === slot);
    perSlot[slot] = e ? e.rewrittenPixelCount : 0;
  }

  const stats: PaletteSwapStats = Object.freeze({
    variantIndex: variant.index,
    variantName: variant.name,
    totalPixels,
    perSlot: Object.freeze(perSlot),
    passThroughPixels: passThrough,
    transparentPixels: transparent,
    isCanonical: variant.isCanonical,
  });

  return { pixels: out, stats };
}

/**
 * Decode an RGBA pixel at offset `i` (in bytes) into a packed
 * 24-bit `Rgb24` (alpha discarded). Helper used by tests and by the
 * CLI's stats reporter.
 */
export function readPackedRgb(buf: Uint8Array, i: number): Rgb24 {
  return (((buf[i]! << 16) | (buf[i + 1]! << 8) | buf[i + 2]!) >>> 0);
}
