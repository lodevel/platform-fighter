import { describe, it, expect } from 'vitest';
import {
  PALETTE_SLOT_ORDER,
  PALETTE_SWAP_PIPELINE_KEY,
  PALETTE_SWAP_UNIFORM_SOURCE,
  PALETTE_SWAP_UNIFORM_TARGET,
  PALETTE_SWAP_UNIFORM_TOLERANCE,
  PALETTE_SWAP_UNIFORM_COUNT,
  applyPaletteSwapPipeline,
  applyPaletteSwapTintFallback,
  applyPaletteSwapToSprite,
  buildPaletteRemap,
  buildPaletteRemapForSlot,
  buildPipelineUniforms,
  colorToVec3,
  colorWithinTolerance,
  createPaletteSwapShaderSource,
  getCharacterSourcePalette,
  installPaletteSwapPipeline,
  paletteRemapEqual,
  remapImageData,
  remapImageDataInPlace,
  remapPixel,
  vec3ToColor,
  type PaletteShaderGame,
  type PaletteShaderPipelineManager,
  type PaletteShaderTarget,
  type PaletteSwapRemap,
} from './paletteSwapShader';
import {
  paletteSwapForCharacter,
  paletteSwapForSlot,
} from './PaletteSwapRenderer';
import {
  CAT_PALETTES,
  WOLF_PALETTES,
  OWL_PALETTES,
  BEAR_PALETTES,
  PALETTES_PER_CHARACTER,
} from './palettes';
import type { CharacterId, PlayerSlot } from '../types';

/**
 * AC 10301 Sub-AC 1 — "Implement palette swap shader/tint system
 * module supporting per-character color remapping."
 *
 * The contract these tests lock down:
 *
 *   1. The slot order is exactly `body, accent, highlight` and the
 *      per-character source palette mirrors the canonical (palette 0)
 *      record from `palettes.ts`.
 *   2. `buildPaletteRemap` projects a `PaletteSwap` onto an ordered
 *      list of `(slot, source, target)` triples — pure, deterministic,
 *      frozen.
 *   3. `remapPixel` substitutes the first matching source slot's
 *      target, returns the input unchanged when no slot matches, and
 *      handles out-of-range / non-finite inputs without crashing.
 *   4. `remapImageData` walks an RGBA buffer and preserves alpha;
 *      `remapImageDataInPlace` mutates and returns the same buffer.
 *   5. The shader source generator emits a deterministic GLSL string
 *      whose uniform identifiers match the published constants and
 *      whose loop bound matches `numSlots`.
 *   6. The Phaser pipeline installer is idempotent on a manager that
 *      reports `has(key) === true`, registers via `add(key, instance)`
 *      otherwise, and gracefully no-ops on a renderer-less game.
 *   7. `applyPaletteSwapToSprite` chooses the pipeline path on a
 *      sprite that exposes `setPipeline`, falls back to tint on a
 *      sprite that only exposes `setTint`, and returns `'none'` on a
 *      sprite that exposes neither.
 *   8. `buildPipelineUniforms` produces normalised `[r, g, b]` triples
 *      matching the GLSL `vec3` layout the shader expects.
 *   9. `colorToVec3` / `vec3ToColor` round-trip without drift for
 *      every canonical palette colour.
 *  10. `colorWithinTolerance` honours zero-tolerance exact match and
 *      non-zero per-channel float tolerance.
 *  11. End-to-end: a `PlayerSlot` flows through `buildPaletteRemapForSlot`
 *      and then through `remapPixel` to produce the swapped colours
 *      for every `(characterId, paletteIndex)` in the legal grid.
 */

// ---------------------------------------------------------------------------
// Mock Phaser surfaces
// ---------------------------------------------------------------------------

interface MockPipelineManager extends PaletteShaderPipelineManager {
  registered: Map<string, unknown>;
  hasCalls: string[];
  addCalls: Array<{ key: string; instance: unknown }>;
  has(key: string): boolean;
  add(key: string, instance: unknown): unknown;
}

function createMockPipelineManager(): MockPipelineManager {
  const m: MockPipelineManager = {
    registered: new Map(),
    hasCalls: [],
    addCalls: [],
    has(key: string): boolean {
      m.hasCalls.push(key);
      return m.registered.has(key);
    },
    add(key: string, instance: unknown): unknown {
      m.addCalls.push({ key, instance });
      m.registered.set(key, instance);
      return instance;
    },
  };
  return m;
}

interface MockSprite extends PaletteShaderTarget {
  setPipelineCalls: string[];
  setPipelineDataCalls: Array<{ key: string; value: unknown }>;
  setTintCalls: number[];
  clearTintCalls: number;
  resetPipelineCalls: number;
  setPipeline(name: string): MockSprite;
  setPipelineData(key: string, value: unknown): MockSprite;
  setTint(color: number): MockSprite;
  clearTint(): MockSprite;
  resetPipeline(): MockSprite;
}

function createMockSprite(): MockSprite {
  const s: MockSprite = {
    setPipelineCalls: [],
    setPipelineDataCalls: [],
    setTintCalls: [],
    clearTintCalls: 0,
    resetPipelineCalls: 0,
    setPipeline(name: string): MockSprite {
      s.setPipelineCalls.push(name);
      return s;
    },
    setPipelineData(key: string, value: unknown): MockSprite {
      s.setPipelineDataCalls.push({ key, value });
      return s;
    },
    setTint(color: number): MockSprite {
      s.setTintCalls.push(color);
      return s;
    },
    clearTint(): MockSprite {
      s.clearTintCalls += 1;
      return s;
    },
    resetPipeline(): MockSprite {
      s.resetPipelineCalls += 1;
      return s;
    },
  };
  return s;
}

interface TintOnlySprite extends PaletteShaderTarget {
  setTintCalls: number[];
  clearTintCalls: number;
  setTint(color: number): TintOnlySprite;
  clearTint(): TintOnlySprite;
}

function createTintOnlySprite(): TintOnlySprite {
  const s: TintOnlySprite = {
    setTintCalls: [],
    clearTintCalls: 0,
    setTint(color: number): TintOnlySprite {
      s.setTintCalls.push(color);
      return s;
    },
    clearTint(): TintOnlySprite {
      s.clearTintCalls += 1;
      return s;
    },
  };
  return s;
}

// ---------------------------------------------------------------------------
// PALETTE_SLOT_ORDER constant
// ---------------------------------------------------------------------------

describe('PALETTE_SLOT_ORDER', () => {
  it('exposes exactly three slots in the documented order', () => {
    expect(PALETTE_SLOT_ORDER).toEqual(['body', 'accent', 'highlight']);
  });

  it('is frozen so consumers cannot mutate the iteration order', () => {
    expect(Object.isFrozen(PALETTE_SLOT_ORDER)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getCharacterSourcePalette
// ---------------------------------------------------------------------------

describe('getCharacterSourcePalette', () => {
  it.each<[CharacterId, ReadonlyArray<{ primaryColor: number; accentColor: number; labelColor: number }>]>([
    ['wolf', WOLF_PALETTES],
    ['cat', CAT_PALETTES],
    ['owl', OWL_PALETTES],
    ['bear', BEAR_PALETTES],
  ])('mirrors the canonical (palette 0) entry for %s', (id, ladder) => {
    const source = getCharacterSourcePalette(id);
    expect(source.characterId).toBe(id);
    expect(source.body).toBe(ladder[0]!.primaryColor);
    expect(source.accent).toBe(ladder[0]!.accentColor);
    expect(source.highlight).toBe(ladder[0]!.labelColor);
  });

  it('returns a frozen record', () => {
    const source = getCharacterSourcePalette('wolf');
    expect(Object.isFrozen(source)).toBe(true);
  });

  it('is deterministic — two calls with the same id return equal records', () => {
    const a = getCharacterSourcePalette('cat');
    const b = getCharacterSourcePalette('cat');
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// buildPaletteRemap
// ---------------------------------------------------------------------------

describe('buildPaletteRemap', () => {
  it('emits one entry per slot in PALETTE_SLOT_ORDER', () => {
    const swap = paletteSwapForCharacter(1, 'wolf', 0);
    const remap = buildPaletteRemap(swap);
    expect(remap.entries).toHaveLength(PALETTE_SLOT_ORDER.length);
    expect(remap.entries.map((e) => e.slot)).toEqual([
      'body',
      'accent',
      'highlight',
    ]);
  });

  it('echoes characterId + paletteIndex from the swap', () => {
    const swap = paletteSwapForCharacter(2, 'cat', 5);
    const remap = buildPaletteRemap(swap);
    expect(remap.characterId).toBe('cat');
    expect(remap.paletteIndex).toBe(5);
  });

  it('the body / accent / highlight entries map source canonical colours to swap targets', () => {
    const swap = paletteSwapForCharacter(1, 'wolf', 1); // cobalt
    const remap = buildPaletteRemap(swap);

    const body = remap.entries[0]!;
    expect(body.slot).toBe('body');
    expect(body.source).toBe(WOLF_PALETTES[0]!.primaryColor); // canonical wolf red
    expect(body.target).toBe(WOLF_PALETTES[1]!.primaryColor); // cobalt blue

    const accent = remap.entries[1]!;
    expect(accent.slot).toBe('accent');
    expect(accent.source).toBe(WOLF_PALETTES[0]!.accentColor);
    expect(accent.target).toBe(WOLF_PALETTES[1]!.accentColor);

    const highlight = remap.entries[2]!;
    expect(highlight.slot).toBe('highlight');
    expect(highlight.source).toBe(WOLF_PALETTES[0]!.labelColor);
    expect(highlight.target).toBe(WOLF_PALETTES[1]!.labelColor);
  });

  it('palette 0 produces a no-op remap (source === target on every slot)', () => {
    const swap = paletteSwapForCharacter(1, 'wolf', 0);
    const remap = buildPaletteRemap(swap);
    for (const entry of remap.entries) {
      expect(entry.source).toBe(entry.target);
    }
  });

  it('returns a frozen record + frozen entries', () => {
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 0));
    expect(Object.isFrozen(remap)).toBe(true);
    expect(Object.isFrozen(remap.entries)).toBe(true);
    for (const entry of remap.entries) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });

  it('defaults tolerance to 0', () => {
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 0));
    expect(remap.tolerance).toBe(0);
  });

  it('accepts an explicit tolerance and clamps into [0, 1]', () => {
    const swap = paletteSwapForCharacter(1, 'wolf', 0);
    expect(buildPaletteRemap(swap, { tolerance: 0.1 }).tolerance).toBe(0.1);
    expect(buildPaletteRemap(swap, { tolerance: -1 }).tolerance).toBe(0);
    expect(buildPaletteRemap(swap, { tolerance: 5 }).tolerance).toBe(1);
    expect(buildPaletteRemap(swap, { tolerance: Number.NaN }).tolerance).toBe(0);
  });

  it.each<[CharacterId]>([['wolf'], ['cat'], ['owl'], ['bear']])(
    'exhaustively covers all 8 palettes for %s',
    (id) => {
      for (let i = 0; i < PALETTES_PER_CHARACTER; i++) {
        const remap = buildPaletteRemap(paletteSwapForCharacter(1, id, i));
        expect(remap.entries).toHaveLength(3);
        expect(remap.paletteIndex).toBe(i);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// buildPaletteRemapForSlot
// ---------------------------------------------------------------------------

describe('buildPaletteRemapForSlot', () => {
  it('reads characterId + paletteIndex straight off the slot', () => {
    const slot: PlayerSlot = Object.freeze({
      index: 3,
      characterId: 'cat',
      paletteIndex: 2,
      inputType: 'gamepad',
    });
    const remap = buildPaletteRemapForSlot(slot);
    const direct = buildPaletteRemap(paletteSwapForSlot(slot));
    expect(remap).toEqual(direct);
  });

  it('forwards tolerance options', () => {
    const slot: PlayerSlot = Object.freeze({
      index: 1,
      characterId: 'wolf',
      paletteIndex: 0,
      inputType: 'keyboard_p1',
    });
    const remap = buildPaletteRemapForSlot(slot, { tolerance: 0.25 });
    expect(remap.tolerance).toBe(0.25);
  });
});

// ---------------------------------------------------------------------------
// paletteRemapEqual
// ---------------------------------------------------------------------------

describe('paletteRemapEqual', () => {
  it('returns true for two remaps built from the same swap', () => {
    const swap = paletteSwapForCharacter(1, 'wolf', 0);
    const a = buildPaletteRemap(swap);
    const b = buildPaletteRemap(swap);
    expect(paletteRemapEqual(a, b)).toBe(true);
  });

  it('returns false when characterId differs', () => {
    expect(
      paletteRemapEqual(
        buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 0)),
        buildPaletteRemap(paletteSwapForCharacter(1, 'cat', 0)),
      ),
    ).toBe(false);
  });

  it('returns false when paletteIndex differs', () => {
    expect(
      paletteRemapEqual(
        buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 0)),
        buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 1)),
      ),
    ).toBe(false);
  });

  it('returns false when tolerance differs', () => {
    const swap = paletteSwapForCharacter(1, 'wolf', 0);
    expect(
      paletteRemapEqual(
        buildPaletteRemap(swap, { tolerance: 0 }),
        buildPaletteRemap(swap, { tolerance: 0.1 }),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// remapPixel
// ---------------------------------------------------------------------------

describe('remapPixel', () => {
  it('substitutes a pixel that exactly matches the body source', () => {
    const swap = paletteSwapForCharacter(1, 'wolf', 1); // cobalt
    const remap = buildPaletteRemap(swap);
    const wolfRed = WOLF_PALETTES[0]!.primaryColor;
    const cobaltBlue = WOLF_PALETTES[1]!.primaryColor;
    expect(remapPixel(wolfRed, remap)).toBe(cobaltBlue);
  });

  it('substitutes the accent source', () => {
    const swap = paletteSwapForCharacter(1, 'wolf', 2);
    const remap = buildPaletteRemap(swap);
    const wolfAccent = WOLF_PALETTES[0]!.accentColor;
    expect(remapPixel(wolfAccent, remap)).toBe(WOLF_PALETTES[2]!.accentColor);
  });

  it('substitutes the highlight source', () => {
    const swap = paletteSwapForCharacter(1, 'cat', 3);
    const remap = buildPaletteRemap(swap);
    const catHighlight = CAT_PALETTES[0]!.labelColor;
    expect(remapPixel(catHighlight, remap)).toBe(CAT_PALETTES[3]!.labelColor);
  });

  it('passes through pixels that do not match any source slot', () => {
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 1));
    // Pure black is not in Wolf's source palette → pass through.
    expect(remapPixel(0x000000, remap)).toBe(0x000000);
    // Pure white likewise.
    expect(remapPixel(0xffffff, remap)).toBe(0xffffff);
    // A random off-palette green.
    expect(remapPixel(0x00ff7e, remap)).toBe(0x00ff7e);
  });

  it('palette 0 (canonical) is a no-op for every input', () => {
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 0));
    for (const pixel of [
      0x000000,
      0xffffff,
      WOLF_PALETTES[0]!.primaryColor,
      WOLF_PALETTES[0]!.accentColor,
      WOLF_PALETTES[0]!.labelColor,
      0x123456,
    ]) {
      expect(remapPixel(pixel, remap)).toBe(pixel);
    }
  });

  it('clamps non-finite / negative pixel values into the legal 24-bit range', () => {
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 1));
    expect(remapPixel(Number.NaN, remap)).toBe(0x000000);
    expect(remapPixel(-1, remap)).toBe(0x000000);
    expect(remapPixel(0x1000000, remap)).toBe(0xffffff);
  });

  it('exact-match short circuit: tolerance=0 ignores near-misses', () => {
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 1));
    const wolfRed = WOLF_PALETTES[0]!.primaryColor;
    // One channel off by 1 → no match under tolerance 0.
    expect(remapPixel(wolfRed + 1, remap)).toBe(wolfRed + 1);
  });

  it('non-zero tolerance matches near-misses within the band', () => {
    const swap = paletteSwapForCharacter(1, 'wolf', 1);
    const remap = buildPaletteRemap(swap, { tolerance: 0.05 });
    const wolfRed = WOLF_PALETTES[0]!.primaryColor;
    // Off by 8/255 ≈ 0.031 — within ±0.05.
    const nearMiss =
      ((((wolfRed >> 16) & 0xff) + 8) << 16) |
      ((((wolfRed >> 8) & 0xff) - 4) << 8) |
      ((wolfRed & 0xff) + 2);
    expect(remapPixel(nearMiss, remap)).toBe(WOLF_PALETTES[1]!.primaryColor);
  });

  it('returns the FIRST matching slot when multiple slots could match', () => {
    // Synthesise a pathological remap where body and accent share the same source.
    const remap: PaletteSwapRemap = Object.freeze({
      characterId: 'wolf',
      paletteIndex: 0,
      tolerance: 0,
      entries: Object.freeze([
        Object.freeze({ slot: 'body', source: 0xabcdef, target: 0x111111 }),
        Object.freeze({ slot: 'accent', source: 0xabcdef, target: 0x222222 }),
        Object.freeze({ slot: 'highlight', source: 0xabcdef, target: 0x333333 }),
      ]),
    }) as PaletteSwapRemap;
    expect(remapPixel(0xabcdef, remap)).toBe(0x111111);
  });
});

// ---------------------------------------------------------------------------
// remapImageData
// ---------------------------------------------------------------------------

describe('remapImageData', () => {
  it('walks an RGBA buffer and remaps body / accent / highlight pixels', () => {
    const swap = paletteSwapForCharacter(1, 'wolf', 1);
    const remap = buildPaletteRemap(swap);

    const wolfBody = WOLF_PALETTES[0]!.primaryColor;
    const cobaltBody = WOLF_PALETTES[1]!.primaryColor;

    // Synthesise a 2x1 RGBA image: body pixel + transparent off-palette pixel.
    const pixels = new Uint8ClampedArray([
      (wolfBody >> 16) & 0xff, (wolfBody >> 8) & 0xff, wolfBody & 0xff, 255, // body, opaque
      0, 255, 0, 0,                                                          // off-palette, transparent
    ]);
    const out = remapImageData(pixels, remap);

    // Body pixel remapped, alpha preserved.
    expect(out[0]).toBe((cobaltBody >> 16) & 0xff);
    expect(out[1]).toBe((cobaltBody >> 8) & 0xff);
    expect(out[2]).toBe(cobaltBody & 0xff);
    expect(out[3]).toBe(255);

    // Off-palette pixel passed through, alpha preserved.
    expect(out[4]).toBe(0);
    expect(out[5]).toBe(255);
    expect(out[6]).toBe(0);
    expect(out[7]).toBe(0);
  });

  it('throws on a buffer length that is not a multiple of 4', () => {
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 0));
    expect(() => remapImageData(new Uint8ClampedArray(7), remap)).toThrow(
      /multiple of 4/i,
    );
  });

  it('returns a new buffer (does not mutate the input)', () => {
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 1));
    const wolfBody = WOLF_PALETTES[0]!.primaryColor;
    const pixels = new Uint8ClampedArray([
      (wolfBody >> 16) & 0xff,
      (wolfBody >> 8) & 0xff,
      wolfBody & 0xff,
      255,
    ]);
    const before = Array.from(pixels);
    remapImageData(pixels, remap);
    expect(Array.from(pixels)).toEqual(before);
  });

  it('handles a multi-pixel buffer with mixed slot matches', () => {
    const swap = paletteSwapForCharacter(1, 'cat', 7); // shadow
    const remap = buildPaletteRemap(swap);
    const catBody = CAT_PALETTES[0]!.primaryColor;
    const catAccent = CAT_PALETTES[0]!.accentColor;
    const catHighlight = CAT_PALETTES[0]!.labelColor;
    const shadowBody = CAT_PALETTES[7]!.primaryColor;
    const shadowAccent = CAT_PALETTES[7]!.accentColor;
    const shadowHighlight = CAT_PALETTES[7]!.labelColor;

    const pixels = new Uint8ClampedArray([
      (catBody >> 16) & 0xff,
      (catBody >> 8) & 0xff,
      catBody & 0xff,
      255,
      (catAccent >> 16) & 0xff,
      (catAccent >> 8) & 0xff,
      catAccent & 0xff,
      255,
      (catHighlight >> 16) & 0xff,
      (catHighlight >> 8) & 0xff,
      catHighlight & 0xff,
      255,
    ]);
    const out = remapImageData(pixels, remap);
    expect((out[0]! << 16) | (out[1]! << 8) | out[2]!).toBe(shadowBody);
    expect((out[4]! << 16) | (out[5]! << 8) | out[6]!).toBe(shadowAccent);
    expect((out[8]! << 16) | (out[9]! << 8) | out[10]!).toBe(shadowHighlight);
  });
});

// ---------------------------------------------------------------------------
// remapImageDataInPlace
// ---------------------------------------------------------------------------

describe('remapImageDataInPlace', () => {
  it('mutates the input buffer and returns the same reference', () => {
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 1));
    const wolfBody = WOLF_PALETTES[0]!.primaryColor;
    const cobaltBody = WOLF_PALETTES[1]!.primaryColor;
    const pixels = new Uint8ClampedArray([
      (wolfBody >> 16) & 0xff,
      (wolfBody >> 8) & 0xff,
      wolfBody & 0xff,
      255,
    ]);
    const ret = remapImageDataInPlace(pixels, remap);
    expect(ret).toBe(pixels);
    expect(pixels[0]).toBe((cobaltBody >> 16) & 0xff);
    expect(pixels[3]).toBe(255);
  });

  it('throws on buffer length that is not a multiple of 4', () => {
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 0));
    expect(() => remapImageDataInPlace(new Uint8ClampedArray(5), remap)).toThrow(
      /multiple of 4/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Shader source generator
// ---------------------------------------------------------------------------

describe('createPaletteSwapShaderSource', () => {
  it('emits a string that mentions every published uniform name', () => {
    const src = createPaletteSwapShaderSource();
    expect(src).toContain(PALETTE_SWAP_UNIFORM_SOURCE);
    expect(src).toContain(PALETTE_SWAP_UNIFORM_TARGET);
    expect(src).toContain(PALETTE_SWAP_UNIFORM_TOLERANCE);
    expect(src).toContain(PALETTE_SWAP_UNIFORM_COUNT);
  });

  it('emits an array sized for the default slot count (3)', () => {
    const src = createPaletteSwapShaderSource();
    expect(src).toContain(`vec3 ${PALETTE_SWAP_UNIFORM_SOURCE}[3]`);
    expect(src).toContain(`vec3 ${PALETTE_SWAP_UNIFORM_TARGET}[3]`);
  });

  it('honours an explicit numSlots argument', () => {
    const src = createPaletteSwapShaderSource({ numSlots: 5 });
    expect(src).toContain(`vec3 ${PALETTE_SWAP_UNIFORM_SOURCE}[5]`);
    expect(src).toContain('for (int i = 0; i < 5;');
  });

  it('declares uMainSampler so it can read the source texture', () => {
    expect(createPaletteSwapShaderSource()).toContain('uniform sampler2D uMainSampler');
  });

  it('uses outTexCoord for the varying so it composes with Phaser pipelines', () => {
    expect(createPaletteSwapShaderSource()).toContain('varying vec2 outTexCoord');
  });

  it('writes gl_FragColor preserving the source alpha', () => {
    const src = createPaletteSwapShaderSource();
    expect(src).toContain('gl_FragColor = vec4(result, texel.a);');
  });

  it('is deterministic — two calls with the same args return identical strings', () => {
    expect(createPaletteSwapShaderSource()).toBe(createPaletteSwapShaderSource());
    expect(createPaletteSwapShaderSource({ numSlots: 4 })).toBe(
      createPaletteSwapShaderSource({ numSlots: 4 }),
    );
  });

  it('rejects non-positive / non-integer numSlots', () => {
    expect(() => createPaletteSwapShaderSource({ numSlots: 0 })).toThrow();
    expect(() => createPaletteSwapShaderSource({ numSlots: -1 })).toThrow();
    expect(() => createPaletteSwapShaderSource({ numSlots: 1.5 })).toThrow();
    expect(() => createPaletteSwapShaderSource({ numSlots: Number.NaN })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// installPaletteSwapPipeline
// ---------------------------------------------------------------------------

describe('installPaletteSwapPipeline', () => {
  it('registers the pipeline under PALETTE_SWAP_PIPELINE_KEY', () => {
    const manager = createMockPipelineManager();
    const game: PaletteShaderGame = { renderer: { pipelines: manager } };
    const pipelineInstance = { id: 'fake-pipeline' };
    const added = installPaletteSwapPipeline(game, () => pipelineInstance);
    expect(added).toBe(true);
    expect(manager.addCalls).toEqual([
      { key: PALETTE_SWAP_PIPELINE_KEY, instance: pipelineInstance },
    ]);
    expect(manager.registered.get(PALETTE_SWAP_PIPELINE_KEY)).toBe(pipelineInstance);
  });

  it('is idempotent when the pipeline is already registered', () => {
    const manager = createMockPipelineManager();
    manager.registered.set(PALETTE_SWAP_PIPELINE_KEY, { id: 'existing' });
    const game: PaletteShaderGame = { renderer: { pipelines: manager } };
    const added = installPaletteSwapPipeline(game, () => ({ id: 'new' }));
    expect(added).toBe(false);
    expect(manager.addCalls).toEqual([]);
    expect(manager.registered.get(PALETTE_SWAP_PIPELINE_KEY)).toEqual({
      id: 'existing',
    });
  });

  it('returns false on a renderer-less game (no WebGL → canvas fallback)', () => {
    const game: PaletteShaderGame = { renderer: undefined };
    let factoryCalled = false;
    const added = installPaletteSwapPipeline(game, () => {
      factoryCalled = true;
      return {};
    });
    expect(added).toBe(false);
    expect(factoryCalled).toBe(false);
  });

  it('returns false on a renderer that has no pipeline manager', () => {
    const game: PaletteShaderGame = { renderer: { pipelines: undefined } };
    const added = installPaletteSwapPipeline(game, () => ({}));
    expect(added).toBe(false);
  });

  it('handles a manager without a `has` method by always registering', () => {
    const calls: Array<{ key: string; instance: unknown }> = [];
    const manager: PaletteShaderPipelineManager = {
      add(key, instance) {
        calls.push({ key, instance });
        return instance;
      },
    };
    const game: PaletteShaderGame = { renderer: { pipelines: manager } };
    const added = installPaletteSwapPipeline(game, () => ({ id: 'fresh' }));
    expect(added).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// applyPaletteSwapPipeline
// ---------------------------------------------------------------------------

describe('applyPaletteSwapPipeline', () => {
  it('routes a sprite through setPipeline + setPipelineData with the uniform snapshot', () => {
    const sprite = createMockSprite();
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 1));
    const used = applyPaletteSwapPipeline(sprite, remap);
    expect(used).toBe(true);
    expect(sprite.setPipelineCalls).toEqual([PALETTE_SWAP_PIPELINE_KEY]);
    const dataKeys = sprite.setPipelineDataCalls.map((c) => c.key);
    expect(dataKeys).toEqual([
      PALETTE_SWAP_UNIFORM_SOURCE,
      PALETTE_SWAP_UNIFORM_TARGET,
      PALETTE_SWAP_UNIFORM_TOLERANCE,
      PALETTE_SWAP_UNIFORM_COUNT,
    ]);
  });

  it('uploads source colours as normalised vec3 triples', () => {
    const sprite = createMockSprite();
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 1));
    applyPaletteSwapPipeline(sprite, remap);
    const sourceCall = sprite.setPipelineDataCalls.find(
      (c) => c.key === PALETTE_SWAP_UNIFORM_SOURCE,
    )!;
    expect(sourceCall.value).toEqual(buildPipelineUniforms(remap).source);
  });

  it('uploads target colours as normalised vec3 triples', () => {
    const sprite = createMockSprite();
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'cat', 4));
    applyPaletteSwapPipeline(sprite, remap);
    const targetCall = sprite.setPipelineDataCalls.find(
      (c) => c.key === PALETTE_SWAP_UNIFORM_TARGET,
    )!;
    expect(targetCall.value).toEqual(buildPipelineUniforms(remap).target);
  });

  it('returns false when the sprite does not expose setPipeline', () => {
    const tintOnly = createTintOnlySprite();
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 0));
    const used = applyPaletteSwapPipeline(tintOnly, remap);
    expect(used).toBe(false);
  });

  it('idempotent — re-applying the same remap produces matching uniform calls', () => {
    const sprite = createMockSprite();
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 0));
    applyPaletteSwapPipeline(sprite, remap);
    const firstCalls = [...sprite.setPipelineDataCalls];
    sprite.setPipelineDataCalls.length = 0;
    applyPaletteSwapPipeline(sprite, remap);
    const secondCalls = [...sprite.setPipelineDataCalls];
    expect(secondCalls).toEqual(firstCalls);
  });
});

// ---------------------------------------------------------------------------
// applyPaletteSwapTintFallback
// ---------------------------------------------------------------------------

describe('applyPaletteSwapTintFallback', () => {
  it('clears + sets tint to the body slot target colour', () => {
    const sprite = createTintOnlySprite();
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 1));
    const used = applyPaletteSwapTintFallback(sprite, remap);
    expect(used).toBe(true);
    expect(sprite.clearTintCalls).toBe(1);
    expect(sprite.setTintCalls).toEqual([WOLF_PALETTES[1]!.primaryColor]);
  });

  it('returns false when the sprite has no setTint method', () => {
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 0));
    const used = applyPaletteSwapTintFallback({}, remap);
    expect(used).toBe(false);
  });

  it('skips clearTint when the sprite does not expose it', () => {
    const calls: number[] = [];
    const sprite: PaletteShaderTarget = {
      setTint(c: number) {
        calls.push(c);
      },
    };
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 1));
    expect(applyPaletteSwapTintFallback(sprite, remap)).toBe(true);
    expect(calls).toEqual([WOLF_PALETTES[1]!.primaryColor]);
  });
});

// ---------------------------------------------------------------------------
// applyPaletteSwapToSprite
// ---------------------------------------------------------------------------

describe('applyPaletteSwapToSprite', () => {
  it('chooses the pipeline path on a sprite that exposes setPipeline', () => {
    const sprite = createMockSprite();
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 1));
    expect(applyPaletteSwapToSprite(sprite, remap)).toBe('pipeline');
    expect(sprite.setPipelineCalls).toEqual([PALETTE_SWAP_PIPELINE_KEY]);
    expect(sprite.setTintCalls).toEqual([]);
  });

  it('falls back to tint when only setTint is exposed', () => {
    const sprite = createTintOnlySprite();
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 1));
    expect(applyPaletteSwapToSprite(sprite, remap)).toBe('tint');
    expect(sprite.setTintCalls).toEqual([WOLF_PALETTES[1]!.primaryColor]);
  });

  it('returns "none" when neither path is available', () => {
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 0));
    expect(applyPaletteSwapToSprite({}, remap)).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// buildPipelineUniforms
// ---------------------------------------------------------------------------

describe('buildPipelineUniforms', () => {
  it('produces normalised vec3 triples for source and target', () => {
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 1));
    const u = buildPipelineUniforms(remap);
    expect(u.source).toHaveLength(3);
    expect(u.target).toHaveLength(3);
    for (const triple of [...u.source, ...u.target]) {
      expect(triple).toHaveLength(3);
      for (const ch of triple) {
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(1);
      }
    }
  });

  it('forwards tolerance and slotCount', () => {
    const remap = buildPaletteRemap(
      paletteSwapForCharacter(1, 'wolf', 1),
      { tolerance: 0.07 },
    );
    const u = buildPipelineUniforms(remap);
    expect(u.tolerance).toBe(0.07);
    expect(u.slotCount).toBe(3);
  });

  it('returns a frozen snapshot', () => {
    const remap = buildPaletteRemap(paletteSwapForCharacter(1, 'wolf', 0));
    const u = buildPipelineUniforms(remap);
    expect(Object.isFrozen(u)).toBe(true);
    expect(Object.isFrozen(u.source)).toBe(true);
    expect(Object.isFrozen(u.target)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// colorToVec3 / vec3ToColor
// ---------------------------------------------------------------------------

describe('colorToVec3 / vec3ToColor', () => {
  it('round-trips every canonical palette colour', () => {
    const ladders = [WOLF_PALETTES, CAT_PALETTES, OWL_PALETTES, BEAR_PALETTES];
    for (const ladder of ladders) {
      for (const palette of ladder) {
        for (const color of [
          palette.primaryColor,
          palette.accentColor,
          palette.labelColor,
        ]) {
          expect(vec3ToColor(colorToVec3(color))).toBe(color);
        }
      }
    }
  });

  it('clamps out-of-range inputs', () => {
    expect(colorToVec3(-1)).toEqual([0, 0, 0]);
    expect(colorToVec3(0x1000000)).toEqual([1, 1, 1]);
    expect(colorToVec3(Number.NaN)).toEqual([0, 0, 0]);
  });

  it('clamps non-finite vec components in vec3ToColor', () => {
    expect(vec3ToColor([Number.NaN, 0.5, 0.5])).toBe(0x008080);
  });
});

// ---------------------------------------------------------------------------
// colorWithinTolerance
// ---------------------------------------------------------------------------

describe('colorWithinTolerance', () => {
  it('returns true on exact match with zero tolerance', () => {
    expect(colorWithinTolerance(0xabcdef, 0xabcdef, 0)).toBe(true);
  });

  it('returns false on any mismatch with zero tolerance', () => {
    expect(colorWithinTolerance(0xabcdef, 0xabcdee, 0)).toBe(false);
  });

  it('returns true within per-channel tolerance band', () => {
    const a = 0x808080;
    // ±4/255 ≈ 0.0157 — within 0.05 tolerance.
    const b = 0x848484;
    expect(colorWithinTolerance(a, b, 0.05)).toBe(true);
  });

  it('returns false outside per-channel tolerance band', () => {
    const a = 0x000000;
    const b = 0x202020; // 32/255 ≈ 0.125 > 0.1
    expect(colorWithinTolerance(a, b, 0.1)).toBe(false);
  });

  it('clamps tolerance into [0, 1] before comparing', () => {
    // tolerance > 1 collapses into "always within" for any 24-bit pixel.
    expect(colorWithinTolerance(0x000000, 0xffffff, 5)).toBe(true);
    // tolerance < 0 collapses to exact match.
    expect(colorWithinTolerance(0xabcdef, 0xabcdef, -1)).toBe(true);
    expect(colorWithinTolerance(0xabcdef, 0xabcdee, -1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: every (characterId, paletteIndex) in the legal grid
// ---------------------------------------------------------------------------

describe('end-to-end — palette grid coverage', () => {
  const ids: ReadonlyArray<CharacterId> = ['wolf', 'cat', 'owl', 'bear'];
  const ladders = {
    wolf: WOLF_PALETTES,
    cat: CAT_PALETTES,
    owl: OWL_PALETTES,
    bear: BEAR_PALETTES,
  } as const;

  it('every (id, paletteIndex) builds a remap that round-trips body / accent / highlight', () => {
    for (const id of ids) {
      const ladder = ladders[id];
      for (let i = 0; i < PALETTES_PER_CHARACTER; i++) {
        const remap = buildPaletteRemap(paletteSwapForCharacter(1, id, i));
        const palette = ladder[i]!;
        // Source colours always come from palette 0 (canonical).
        const canonical = ladder[0]!;
        expect(remapPixel(canonical.primaryColor, remap)).toBe(palette.primaryColor);
        expect(remapPixel(canonical.accentColor, remap)).toBe(palette.accentColor);
        expect(remapPixel(canonical.labelColor, remap)).toBe(palette.labelColor);
      }
    }
  });

  it('end-to-end: a PlayerSlot drives applyPaletteSwapToSprite onto a tint-only sprite with the palette body colour', () => {
    const slot: PlayerSlot = Object.freeze({
      index: 2,
      characterId: 'cat',
      paletteIndex: 4,
      inputType: 'gamepad',
    });
    const sprite = createTintOnlySprite();
    const remap = buildPaletteRemapForSlot(slot);
    const path = applyPaletteSwapToSprite(sprite, remap);
    expect(path).toBe('tint');
    expect(sprite.setTintCalls).toEqual([CAT_PALETTES[4]!.primaryColor]);
  });
});
