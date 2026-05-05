import { describe, it, expect } from 'vitest';
import {
  applyPaletteSwap,
  resolvePaletteSwap,
  paletteSwapForSlot,
  paletteSwapForCharacter,
  paletteSwapEqual,
  paletteColorToCss,
  DEFAULT_PALETTE_STROKE_WIDTH,
  type FighterPaletteTargets,
  type PaletteSwap,
} from './PaletteSwapRenderer';
import {
  CAT_PALETTES,
  WOLF_PALETTES,
  OWL_PALETTES,
  BEAR_PALETTES,
  PALETTES_PER_CHARACTER,
} from './palettes';
import type { PlayerSlot } from '../types';

/**
 * AC 13 Sub-AC 3 — "Implement runtime palette swap rendering using
 * Phaser tint/shader on character sprites based on assigned player
 * slot."
 *
 * The contract these tests lock down:
 *
 *   1. `resolvePaletteSwap` is a pure deterministic projection of
 *      `(playerIndex, characterId, paletteIndex)` onto the colour
 *      record. Same inputs → byte-identical outputs.
 *   2. Every characterId × paletteIndex combo in the legal grid
 *      (4 × 8 = 32) yields the exact colours from `palettes.ts`.
 *   3. Out-of-range / negative / non-finite paletteIndex values wrap
 *      cleanly so the renderer never crashes on stale slot data.
 *   4. `applyPaletteSwap` calls `setFillStyle` with the primary
 *      colour on the body, `setStrokeStyle` with the accent colour,
 *      and `setFillStyle`/`setTint` with the accent colour on the
 *      facing mark — and skips methods the target doesn't expose.
 *   5. The same swap painted on a sprite (which has only `setTint`)
 *      works without errors and produces a `setTint` call with the
 *      primary colour.
 *   6. `paletteSwapEqual` correctly distinguishes records that differ
 *      in any field.
 */

// ---------------------------------------------------------------------------
// Mock target helpers — duck-typed Phaser GameObjects
// ---------------------------------------------------------------------------

interface MockShapeTarget {
  fillCalls: Array<{ color: number; alpha: number | undefined }>;
  strokeCalls: Array<{ width: number; color: number; alpha: number | undefined }>;
  tintCalls: number[];
  clearTintCalls: number;
  setFillStyle(color: number, alpha?: number): MockShapeTarget;
  setStrokeStyle(width: number, color: number, alpha?: number): MockShapeTarget;
}

function createMockShape(): MockShapeTarget {
  const target: MockShapeTarget = {
    fillCalls: [],
    strokeCalls: [],
    tintCalls: [],
    clearTintCalls: 0,
    setFillStyle(color: number, alpha?: number): MockShapeTarget {
      target.fillCalls.push({ color, alpha });
      return target;
    },
    setStrokeStyle(width: number, color: number, alpha?: number): MockShapeTarget {
      target.strokeCalls.push({ width, color, alpha });
      return target;
    },
  };
  return target;
}

interface MockSpriteTarget {
  tintCalls: number[];
  clearTintCalls: number;
  setTint(color: number): MockSpriteTarget;
  clearTint(): MockSpriteTarget;
}

function createMockSprite(): MockSpriteTarget {
  const target: MockSpriteTarget = {
    tintCalls: [],
    clearTintCalls: 0,
    setTint(color: number): MockSpriteTarget {
      target.tintCalls.push(color);
      return target;
    },
    clearTint(): MockSpriteTarget {
      target.clearTintCalls += 1;
      return target;
    },
  };
  return target;
}

// ---------------------------------------------------------------------------
// resolvePaletteSwap — pure projection
// ---------------------------------------------------------------------------

describe('resolvePaletteSwap — AC 13 Sub-AC 3 pure projection', () => {
  it('resolves Wolf palette 0 to the canonical wolf-red record', () => {
    const swap = resolvePaletteSwap({
      index: 1,
      characterId: 'wolf',
      paletteIndex: 0,
    });
    expect(swap.playerIndex).toBe(1);
    expect(swap.characterId).toBe('wolf');
    expect(swap.paletteIndex).toBe(0);
    expect(swap.primaryColor).toBe(WOLF_PALETTES[0]!.primaryColor);
    expect(swap.accentColor).toBe(WOLF_PALETTES[0]!.accentColor);
    expect(swap.labelColor).toBe(WOLF_PALETTES[0]!.labelColor);
    expect(swap.displayName).toBe(WOLF_PALETTES[0]!.displayName);
  });

  it('resolves Cat palette 7 (the ninja-black "Shadow") correctly', () => {
    const swap = resolvePaletteSwap({
      index: 4,
      characterId: 'cat',
      paletteIndex: 7,
    });
    expect(swap.playerIndex).toBe(4);
    expect(swap.characterId).toBe('cat');
    expect(swap.paletteIndex).toBe(7);
    expect(swap.primaryColor).toBe(CAT_PALETTES[7]!.primaryColor);
    expect(swap.displayName).toBe('Shadow');
  });

  it('produces deterministic output — two calls with identical inputs return equal records', () => {
    const a = resolvePaletteSwap({ index: 2, characterId: 'owl', paletteIndex: 3 });
    const b = resolvePaletteSwap({ index: 2, characterId: 'owl', paletteIndex: 3 });
    expect(paletteSwapEqual(a, b)).toBe(true);
    expect(a.primaryColor).toBe(b.primaryColor);
    expect(a.displayName).toBe(b.displayName);
  });

  it('returns a frozen record — accidental writes throw under strict mode', () => {
    const swap = resolvePaletteSwap({ index: 1, characterId: 'wolf', paletteIndex: 0 });
    expect(Object.isFrozen(swap)).toBe(true);
  });

  it.each([
    ['wolf', WOLF_PALETTES] as const,
    ['cat', CAT_PALETTES] as const,
    ['owl', OWL_PALETTES] as const,
    ['bear', BEAR_PALETTES] as const,
  ])('exhaustively maps every paletteIndex 0..7 for %s', (id, ladder) => {
    for (let i = 0; i < PALETTES_PER_CHARACTER; i++) {
      const swap = resolvePaletteSwap({
        index: 1,
        characterId: id,
        paletteIndex: i,
      });
      expect(swap.paletteIndex).toBe(i);
      expect(swap.primaryColor).toBe(ladder[i]!.primaryColor);
      expect(swap.accentColor).toBe(ladder[i]!.accentColor);
      expect(swap.labelColor).toBe(ladder[i]!.labelColor);
    }
  });

  it('wraps an out-of-range paletteIndex modulo 8 (8 → 0, 9 → 1, …)', () => {
    const wrapEight = resolvePaletteSwap({
      index: 1,
      characterId: 'wolf',
      paletteIndex: 8,
    });
    const wrapNine = resolvePaletteSwap({
      index: 1,
      characterId: 'wolf',
      paletteIndex: 9,
    });
    expect(wrapEight.paletteIndex).toBe(0);
    expect(wrapNine.paletteIndex).toBe(1);
    expect(wrapEight.primaryColor).toBe(WOLF_PALETTES[0]!.primaryColor);
    expect(wrapNine.primaryColor).toBe(WOLF_PALETTES[1]!.primaryColor);
  });

  it('survives non-finite paletteIndex without crashing (falls back to 0)', () => {
    const nan = resolvePaletteSwap({
      index: 1,
      characterId: 'cat',
      paletteIndex: Number.NaN,
    });
    const inf = resolvePaletteSwap({
      index: 1,
      characterId: 'cat',
      paletteIndex: Number.POSITIVE_INFINITY,
    });
    expect(nan.paletteIndex).toBe(0);
    expect(inf.paletteIndex).toBe(0);
    expect(nan.primaryColor).toBe(CAT_PALETTES[0]!.primaryColor);
  });

  it('handles negative paletteIndex by wrapping into [0, 8)', () => {
    const swap = resolvePaletteSwap({
      index: 3,
      characterId: 'bear',
      paletteIndex: -1,
    });
    expect(swap.paletteIndex).toBe(7);
    expect(swap.primaryColor).toBe(BEAR_PALETTES[7]!.primaryColor);
  });
});

// ---------------------------------------------------------------------------
// paletteSwapForSlot — typed convenience over PlayerSlot
// ---------------------------------------------------------------------------

describe('paletteSwapForSlot — accepts a full PlayerSlot', () => {
  it('reads characterId + paletteIndex straight off the slot', () => {
    const slot: PlayerSlot = Object.freeze({
      index: 2,
      characterId: 'cat',
      paletteIndex: 3,
      inputType: 'keyboard_p2',
    });
    const swap = paletteSwapForSlot(slot);
    expect(swap.playerIndex).toBe(2);
    expect(swap.characterId).toBe('cat');
    expect(swap.paletteIndex).toBe(3);
    expect(swap.primaryColor).toBe(CAT_PALETTES[3]!.primaryColor);
  });

  it('paletteSwapForCharacter is the tuple-shorthand equivalent', () => {
    const a = paletteSwapForCharacter(2, 'cat', 3);
    const b = paletteSwapForSlot({
      index: 2,
      characterId: 'cat',
      paletteIndex: 3,
      inputType: 'keyboard_p2',
    });
    expect(paletteSwapEqual(a, b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// paletteSwapEqual — structural equality
// ---------------------------------------------------------------------------

describe('paletteSwapEqual', () => {
  const base = resolvePaletteSwap({
    index: 1,
    characterId: 'wolf',
    paletteIndex: 0,
  });

  it('returns true for two records resolved from the same slot data', () => {
    const other = resolvePaletteSwap({
      index: 1,
      characterId: 'wolf',
      paletteIndex: 0,
    });
    expect(paletteSwapEqual(base, other)).toBe(true);
  });

  it('returns false when the playerIndex differs', () => {
    const other = resolvePaletteSwap({
      index: 2,
      characterId: 'wolf',
      paletteIndex: 0,
    });
    expect(paletteSwapEqual(base, other)).toBe(false);
  });

  it('returns false when the paletteIndex differs', () => {
    const other = resolvePaletteSwap({
      index: 1,
      characterId: 'wolf',
      paletteIndex: 1,
    });
    expect(paletteSwapEqual(base, other)).toBe(false);
  });

  it('returns false when the characterId differs', () => {
    const other = resolvePaletteSwap({
      index: 1,
      characterId: 'cat',
      paletteIndex: 0,
    });
    expect(paletteSwapEqual(base, other)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyPaletteSwap — paint dispatch
// ---------------------------------------------------------------------------

describe('applyPaletteSwap — Phaser paint dispatch', () => {
  it('paints body fill with primary colour and stroke with accent colour', () => {
    const body = createMockShape();
    const swap = resolvePaletteSwap({
      index: 1,
      characterId: 'wolf',
      paletteIndex: 1,
    });
    const result = applyPaletteSwap({ body }, swap);
    expect(body.fillCalls).toHaveLength(1);
    expect(body.fillCalls[0]!.color).toBe(WOLF_PALETTES[1]!.primaryColor);
    expect(body.fillCalls[0]!.alpha).toBe(1);
    expect(body.strokeCalls).toHaveLength(1);
    expect(body.strokeCalls[0]!.color).toBe(WOLF_PALETTES[1]!.accentColor);
    expect(body.strokeCalls[0]!.width).toBe(DEFAULT_PALETTE_STROKE_WIDTH);
    expect(body.strokeCalls[0]!.alpha).toBe(1);
    expect(result.fills).toBe(1);
    expect(result.strokes).toBe(1);
    expect(result.tints).toBe(0);
  });

  it('paints facing mark with accent colour fill', () => {
    const facingMark = createMockShape();
    const swap = resolvePaletteSwap({
      index: 1,
      characterId: 'cat',
      paletteIndex: 2,
    });
    const result = applyPaletteSwap({ facingMark }, swap);
    expect(facingMark.fillCalls).toHaveLength(1);
    expect(facingMark.fillCalls[0]!.color).toBe(CAT_PALETTES[2]!.accentColor);
    // Facing marks are flat triangles with no stroke in the M1 scaffold.
    expect(facingMark.strokeCalls).toHaveLength(0);
    expect(result.fills).toBe(1);
  });

  it('paints body + facingMark together in one call', () => {
    const body = createMockShape();
    const facingMark = createMockShape();
    const swap = resolvePaletteSwap({
      index: 3,
      characterId: 'cat',
      paletteIndex: 5,
    });
    const result = applyPaletteSwap({ body, facingMark }, swap);
    expect(body.fillCalls[0]!.color).toBe(CAT_PALETTES[5]!.primaryColor);
    expect(body.strokeCalls[0]!.color).toBe(CAT_PALETTES[5]!.accentColor);
    expect(facingMark.fillCalls[0]!.color).toBe(CAT_PALETTES[5]!.accentColor);
    expect(result.fills).toBe(2);
    expect(result.strokes).toBe(1);
    expect(result.tints).toBe(0);
  });

  it('routes a sprite-shaped target through setTint with the primary colour', () => {
    const sprite = createMockSprite();
    const swap = resolvePaletteSwap({
      index: 2,
      characterId: 'wolf',
      paletteIndex: 4,
    });
    const targets: FighterPaletteTargets = { body: sprite };
    const result = applyPaletteSwap(targets, swap);
    expect(sprite.tintCalls).toHaveLength(1);
    expect(sprite.tintCalls[0]).toBe(WOLF_PALETTES[4]!.primaryColor);
    // clearTint runs before setTint when present so a stale tint can't bleed
    // into the new palette.
    expect(sprite.clearTintCalls).toBe(1);
    expect(result.tints).toBe(1);
    expect(result.fills).toBe(0);
    expect(result.strokes).toBe(0);
  });

  it('clearExistingTint=false skips the pre-paint clearTint call', () => {
    const sprite = createMockSprite();
    const swap = resolvePaletteSwap({
      index: 1,
      characterId: 'wolf',
      paletteIndex: 0,
    });
    applyPaletteSwap({ body: sprite }, swap, { clearExistingTint: false });
    expect(sprite.clearTintCalls).toBe(0);
    expect(sprite.tintCalls).toHaveLength(1);
  });

  it('honours alpha overrides on the body fill / stroke', () => {
    const body = createMockShape();
    const swap = resolvePaletteSwap({
      index: 1,
      characterId: 'wolf',
      paletteIndex: 0,
    });
    applyPaletteSwap({ body }, swap, {
      bodyFillAlpha: 0.4,
      bodyStrokeAlpha: 0.6,
      strokeWidth: 5,
    });
    expect(body.fillCalls[0]!.alpha).toBe(0.4);
    expect(body.strokeCalls[0]!.alpha).toBe(0.6);
    expect(body.strokeCalls[0]!.width).toBe(5);
  });

  it('paints an aux sprite with the primary colour tint', () => {
    const auxSprite = createMockSprite();
    const swap = resolvePaletteSwap({
      index: 1,
      characterId: 'cat',
      paletteIndex: 3,
    });
    const result = applyPaletteSwap({ auxSprite }, swap);
    expect(auxSprite.tintCalls[0]).toBe(CAT_PALETTES[3]!.primaryColor);
    expect(result.tints).toBe(1);
  });

  it('skips targets that lack the relevant methods (no crash)', () => {
    const result = applyPaletteSwap(
      { body: {}, facingMark: {} },
      resolvePaletteSwap({ index: 1, characterId: 'wolf', paletteIndex: 0 }),
    );
    expect(result).toEqual({ fills: 0, strokes: 0, tints: 0 });
  });

  it('idempotent — painting twice produces the same end state on the target', () => {
    const body = createMockShape();
    const swap = resolvePaletteSwap({
      index: 1,
      characterId: 'wolf',
      paletteIndex: 2,
    });
    applyPaletteSwap({ body }, swap);
    applyPaletteSwap({ body }, swap);
    // Both calls landed; the most recent call's colour is the live one.
    expect(body.fillCalls).toHaveLength(2);
    expect(body.strokeCalls).toHaveLength(2);
    expect(body.fillCalls[0]).toEqual(body.fillCalls[1]);
    expect(body.strokeCalls[0]).toEqual(body.strokeCalls[1]);
  });

  it('does not call any setter when targets is empty', () => {
    const swap: PaletteSwap = resolvePaletteSwap({
      index: 1,
      characterId: 'wolf',
      paletteIndex: 0,
    });
    const result = applyPaletteSwap({}, swap);
    expect(result).toEqual({ fills: 0, strokes: 0, tints: 0 });
  });
});

// ---------------------------------------------------------------------------
// paletteColorToCss
// ---------------------------------------------------------------------------

describe('paletteColorToCss', () => {
  it('formats a 24-bit colour as #rrggbb lowercase', () => {
    expect(paletteColorToCss(0xc24a4a)).toBe('#c24a4a');
    expect(paletteColorToCss(0x000000)).toBe('#000000');
    expect(paletteColorToCss(0xffffff)).toBe('#ffffff');
  });

  it('left-pads short colours with leading zeros', () => {
    expect(paletteColorToCss(0x00ff00)).toBe('#00ff00');
    expect(paletteColorToCss(0x0000ff)).toBe('#0000ff');
    expect(paletteColorToCss(0x000001)).toBe('#000001');
  });

  it('clamps out-of-range values into the legal 24-bit range', () => {
    expect(paletteColorToCss(-1)).toBe('#000000');
    expect(paletteColorToCss(0x1000000)).toBe('#ffffff');
  });

  it('floors non-integer colour values', () => {
    expect(paletteColorToCss(0xc24a4a + 0.7)).toBe('#c24a4a');
  });
});
