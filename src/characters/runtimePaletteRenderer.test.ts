import { describe, it, expect, beforeEach } from 'vitest';
import {
  RuntimePaletteRenderer,
  configureDefaultRuntimePaletteRenderer,
  getDefaultRuntimePaletteRenderer,
  paintFighterPalette,
  resetDefaultRuntimePaletteRenderer,
  asPaletteSwapTarget,
  type RuntimePaletteGame,
  type RuntimePaletteTargets,
} from './runtimePaletteRenderer';
import {
  PALETTE_SWAP_PIPELINE_KEY,
  PALETTE_SWAP_UNIFORM_COUNT,
  PALETTE_SWAP_UNIFORM_SOURCE,
  PALETTE_SWAP_UNIFORM_TARGET,
  PALETTE_SWAP_UNIFORM_TOLERANCE,
  type PaletteShaderPipelineManager,
  type PaletteShaderTarget,
} from './paletteSwapShader';
import {
  CAT_PALETTES,
  WOLF_PALETTES,
  OWL_PALETTES,
  BEAR_PALETTES,
  PALETTES_PER_CHARACTER,
} from './palettes';
import type { CharacterId, PlayerSlot } from '../types';

/**
 * AC 20302 Sub-AC 2 — "Implement a runtime palette-swap
 * renderer/shader that applies a selected palette to a character
 * sprite for preview and in-game use."
 *
 * The contract these tests lock down:
 *
 *   1. A `RuntimePaletteRenderer` paints rectangle (body / facing
 *      mark) AND sprite targets in one `paint()` call, using
 *      `applyPaletteSwap` for the rectangle pipeline and the shader
 *      (or tint fallback) for the sprite pipeline.
 *
 *   2. Repeated paints with the same slot are short-circuited via a
 *      per-key cache so the steady-state per-frame call is a single
 *      `paletteSwapEqual` compare with zero paint operations.
 *
 *   3. The WebGL pipeline is lazy-installed exactly once on first
 *      use, and a renderer constructed without a game / factory
 *      always falls through to the tint path.
 *
 *   4. A target group missing a sprite paints rectangle-only
 *      without errors (preview tile path); a target group missing
 *      rectangles paints sprite-only without errors (atlas-only
 *      future path).
 *
 *   5. A `PlayerSlot` flows through the renderer producing exactly
 *      the same final colour record as a raw
 *      `(playerIndex, characterId, paletteIndex)` tuple.
 *
 *   6. The render path is determinism-preserving — same slot always
 *      yields the same visible colour assignments, byte-for-byte,
 *      across every `(characterId, paletteIndex)` in the legal grid.
 *
 *   7. The module-scope default renderer is reconfigurable and the
 *      reset helper drops the cache so tests don't bleed between
 *      cases.
 */

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface MockRectTarget {
  setFillStyleCalls: Array<{ color: number; alpha?: number }>;
  setStrokeStyleCalls: Array<{ width: number; color: number; alpha?: number }>;
  setFillStyle(color: number, alpha?: number): MockRectTarget;
  setStrokeStyle(width: number, color: number, alpha?: number): MockRectTarget;
}

function createMockRect(): MockRectTarget {
  const r: MockRectTarget = {
    setFillStyleCalls: [],
    setStrokeStyleCalls: [],
    setFillStyle(color: number, alpha?: number): MockRectTarget {
      r.setFillStyleCalls.push({ color, alpha });
      return r;
    },
    setStrokeStyle(width: number, color: number, alpha?: number): MockRectTarget {
      r.setStrokeStyleCalls.push({ width, color, alpha });
      return r;
    },
  };
  return r;
}

interface MockTriangle {
  setFillStyleCalls: Array<{ color: number; alpha?: number }>;
  setFillStyle(color: number, alpha?: number): MockTriangle;
}

function createMockTriangle(): MockTriangle {
  const t: MockTriangle = {
    setFillStyleCalls: [],
    setFillStyle(color: number, alpha?: number): MockTriangle {
      t.setFillStyleCalls.push({ color, alpha });
      return t;
    },
  };
  return t;
}

interface PipelineSprite extends PaletteShaderTarget {
  setPipelineCalls: string[];
  setPipelineDataCalls: Array<{ key: string; value: unknown }>;
  setTintCalls: number[];
  clearTintCalls: number;
  setPipeline(name: string): PipelineSprite;
  setPipelineData(key: string, value: unknown): PipelineSprite;
  setTint(color: number): PipelineSprite;
  clearTint(): PipelineSprite;
}

function createPipelineSprite(): PipelineSprite {
  const s: PipelineSprite = {
    setPipelineCalls: [],
    setPipelineDataCalls: [],
    setTintCalls: [],
    clearTintCalls: 0,
    setPipeline(name: string): PipelineSprite {
      s.setPipelineCalls.push(name);
      return s;
    },
    setPipelineData(key: string, value: unknown): PipelineSprite {
      s.setPipelineDataCalls.push({ key, value });
      return s;
    },
    setTint(color: number): PipelineSprite {
      s.setTintCalls.push(color);
      return s;
    },
    clearTint(): PipelineSprite {
      s.clearTintCalls += 1;
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

interface MockGame extends RuntimePaletteGame {
  pipelinesAdded: Array<{ key: string; instance: unknown }>;
  pipelinesHas: string[];
}

function createMockGame(opts: {
  preInstalled?: boolean;
  noManager?: boolean;
} = {}): MockGame {
  const registry = new Map<string, unknown>();
  if (opts.preInstalled) registry.set(PALETTE_SWAP_PIPELINE_KEY, { pre: true });

  const manager: PaletteShaderPipelineManager | undefined = opts.noManager
    ? undefined
    : {
        has(key: string): boolean {
          (game as MockGame).pipelinesHas.push(key);
          return registry.has(key);
        },
        add(key: string, instance: unknown): unknown {
          (game as MockGame).pipelinesAdded.push({ key, instance });
          registry.set(key, instance);
          return instance;
        },
      };

  const game: MockGame = {
    pipelinesAdded: [],
    pipelinesHas: [],
    renderer: { pipelines: manager },
  };
  return game;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('RuntimePaletteRenderer construction', () => {
  it('constructs without a game and reports pipelineInstalled = false', () => {
    const r = new RuntimePaletteRenderer();
    expect(r.isPipelineInstalled()).toBe(false);
  });

  it('does not attempt pipeline install until first paint', () => {
    const game = createMockGame();
    new RuntimePaletteRenderer(game, () => ({}));
    expect(game.pipelinesAdded).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rectangle pipeline (preview / placeholder path)
// ---------------------------------------------------------------------------

describe('RuntimePaletteRenderer — rectangle (preview / placeholder) targets', () => {
  it('paints body fill + stroke and facing mark fill from the palette', () => {
    const r = new RuntimePaletteRenderer();
    const body = createMockRect();
    const facingMark = createMockTriangle();
    const targets: RuntimePaletteTargets = { body, facingMark };

    const result = r.paint('preview-1', targets, {
      index: 1,
      characterId: 'wolf',
      paletteIndex: 1,
    });

    expect(body.setFillStyleCalls).toEqual([
      { color: WOLF_PALETTES[1]!.primaryColor, alpha: 1 },
    ]);
    expect(body.setStrokeStyleCalls).toEqual([
      { width: 2, color: WOLF_PALETTES[1]!.accentColor, alpha: 1 },
    ]);
    expect(facingMark.setFillStyleCalls).toEqual([
      { color: WOLF_PALETTES[1]!.accentColor, alpha: 1 },
    ]);
    expect(result.swap.primaryColor).toBe(WOLF_PALETTES[1]!.primaryColor);
    expect(result.spritePath).toBe('none');
    expect(result.ops.fills).toBe(2);
    expect(result.ops.strokes).toBe(1);
  });

  it('skips the rectangle pipeline when no rectangle targets are passed', () => {
    const r = new RuntimePaletteRenderer();
    const sprite = createTintOnlySprite();
    const result = r.paint(
      'sprite-1',
      { sprite },
      { index: 1, characterId: 'cat', paletteIndex: 4 },
    );
    expect(result.ops.fills).toBe(0);
    expect(result.ops.strokes).toBe(0);
    // Tint fallback fires for the sprite (no pipeline installed).
    expect(sprite.setTintCalls).toEqual([CAT_PALETTES[4]!.primaryColor]);
    expect(result.spritePath).toBe('tint');
  });

  it('forwards alpha + stroke options to the rectangle painter', () => {
    const r = new RuntimePaletteRenderer();
    const body = createMockRect();
    r.paint(
      'preview-1',
      { body },
      { index: 1, characterId: 'wolf', paletteIndex: 0 },
      { bodyFillAlpha: 0.35, bodyStrokeAlpha: 0.5, strokeWidth: 4 },
    );
    expect(body.setFillStyleCalls).toEqual([
      { color: WOLF_PALETTES[0]!.primaryColor, alpha: 0.35 },
    ]);
    expect(body.setStrokeStyleCalls).toEqual([
      { width: 4, color: WOLF_PALETTES[0]!.accentColor, alpha: 0.5 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Shader pipeline (in-game sprite path)
// ---------------------------------------------------------------------------

describe('RuntimePaletteRenderer — shader pipeline (in-game sprite) targets', () => {
  it('routes a pipeline-capable sprite through setPipeline + uniform upload when WebGL available', () => {
    const game = createMockGame();
    const r = new RuntimePaletteRenderer(game, () => ({ id: 'fake-pipeline' }));
    const sprite = createPipelineSprite();
    const result = r.paint(
      'fighter-1',
      { sprite },
      { index: 1, characterId: 'wolf', paletteIndex: 1 },
    );
    expect(r.isPipelineInstalled()).toBe(true);
    expect(sprite.setPipelineCalls).toEqual([PALETTE_SWAP_PIPELINE_KEY]);
    const dataKeys = sprite.setPipelineDataCalls.map((c) => c.key);
    expect(dataKeys).toEqual([
      PALETTE_SWAP_UNIFORM_SOURCE,
      PALETTE_SWAP_UNIFORM_TARGET,
      PALETTE_SWAP_UNIFORM_TOLERANCE,
      PALETTE_SWAP_UNIFORM_COUNT,
    ]);
    expect(result.spritePath).toBe('pipeline');
    expect(result.ops.pipelineApplied).toBe(1);
  });

  it('falls back to setTint when no pipeline factory is configured', () => {
    const r = new RuntimePaletteRenderer();
    const sprite = createTintOnlySprite();
    const result = r.paint(
      'fighter-1',
      { sprite },
      { index: 1, characterId: 'cat', paletteIndex: 2 },
    );
    expect(result.spritePath).toBe('tint');
    expect(sprite.setTintCalls).toEqual([CAT_PALETTES[2]!.primaryColor]);
    expect(result.ops.pipelineApplied).toBe(0);
  });

  it('falls back to setTint when the game has no pipeline manager (canvas renderer)', () => {
    const game = createMockGame({ noManager: true });
    const r = new RuntimePaletteRenderer(game, () => ({}));
    const sprite = createTintOnlySprite();
    const result = r.paint(
      'fighter-1',
      { sprite },
      { index: 1, characterId: 'cat', paletteIndex: 2 },
    );
    expect(r.isPipelineInstalled()).toBe(false);
    expect(result.spritePath).toBe('tint');
    expect(sprite.setTintCalls).toEqual([CAT_PALETTES[2]!.primaryColor]);
  });

  it('returns spritePath = "none" when sprite exposes neither setPipeline nor setTint', () => {
    const r = new RuntimePaletteRenderer();
    const result = r.paint(
      'fighter-1',
      { sprite: {} as PaletteShaderTarget },
      { index: 1, characterId: 'wolf', paletteIndex: 0 },
    );
    expect(result.spritePath).toBe('none');
  });

  it('forwards shaderTolerance into the remap descriptor', () => {
    const r = new RuntimePaletteRenderer();
    const sprite = createTintOnlySprite();
    const result = r.paint(
      'fighter-1',
      { sprite },
      { index: 1, characterId: 'wolf', paletteIndex: 1 },
      { shaderTolerance: 0.07 },
    );
    expect(result.remap.tolerance).toBe(0.07);
  });
});

// ---------------------------------------------------------------------------
// Lazy pipeline install
// ---------------------------------------------------------------------------

describe('RuntimePaletteRenderer — lazy pipeline install', () => {
  it('attempts the install exactly once on first paint, then re-uses the result', () => {
    const game = createMockGame();
    let factoryCalls = 0;
    const r = new RuntimePaletteRenderer(game, () => {
      factoryCalls += 1;
      return { id: factoryCalls };
    });

    const sprite = createPipelineSprite();
    r.paint(
      'fighter-1',
      { sprite },
      { index: 1, characterId: 'wolf', paletteIndex: 0 },
    );
    r.paint(
      'fighter-2',
      { sprite },
      { index: 1, characterId: 'wolf', paletteIndex: 1 },
    );
    expect(factoryCalls).toBe(1);
    expect(game.pipelinesAdded).toHaveLength(1);
  });

  it('skips re-installing when the manager already has the pipeline registered', () => {
    const game = createMockGame({ preInstalled: true });
    const r = new RuntimePaletteRenderer(game, () => ({ id: 'new' }));
    const sprite = createPipelineSprite();
    r.paint(
      'fighter-1',
      { sprite },
      { index: 1, characterId: 'wolf', paletteIndex: 0 },
    );
    expect(r.isPipelineInstalled()).toBe(false);
    expect(game.pipelinesAdded).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cache short-circuit
// ---------------------------------------------------------------------------

describe('RuntimePaletteRenderer — per-key cache', () => {
  it('short-circuits the second paint when the swap is unchanged', () => {
    const r = new RuntimePaletteRenderer();
    const body = createMockRect();
    const facingMark = createMockTriangle();
    const sprite = createTintOnlySprite();

    r.paint(
      'fighter-1',
      { body, facingMark, sprite },
      { index: 1, characterId: 'wolf', paletteIndex: 1 },
    );
    expect(body.setFillStyleCalls).toHaveLength(1);
    expect(facingMark.setFillStyleCalls).toHaveLength(1);
    expect(sprite.setTintCalls).toHaveLength(1);

    const second = r.paint(
      'fighter-1',
      { body, facingMark, sprite },
      { index: 1, characterId: 'wolf', paletteIndex: 1 },
    );
    expect(second.ops.cacheHits).toBe(1);
    expect(second.ops.fills).toBe(0);
    expect(body.setFillStyleCalls).toHaveLength(1); // unchanged
    expect(facingMark.setFillStyleCalls).toHaveLength(1);
    expect(sprite.setTintCalls).toHaveLength(1);
  });

  it('repaints when the slot palette index changes', () => {
    const r = new RuntimePaletteRenderer();
    const body = createMockRect();
    r.paint(
      'fighter-1',
      { body },
      { index: 1, characterId: 'wolf', paletteIndex: 0 },
    );
    r.paint(
      'fighter-1',
      { body },
      { index: 1, characterId: 'wolf', paletteIndex: 3 },
    );
    expect(body.setFillStyleCalls).toEqual([
      { color: WOLF_PALETTES[0]!.primaryColor, alpha: 1 },
      { color: WOLF_PALETTES[3]!.primaryColor, alpha: 1 },
    ]);
  });

  it('different cache keys do not share state', () => {
    const r = new RuntimePaletteRenderer();
    const body1 = createMockRect();
    const body2 = createMockRect();
    r.paint(
      'preview-1',
      { body: body1 },
      { index: 1, characterId: 'wolf', paletteIndex: 1 },
    );
    r.paint(
      'preview-2',
      { body: body2 },
      { index: 2, characterId: 'cat', paletteIndex: 2 },
    );
    expect(body1.setFillStyleCalls).toEqual([
      { color: WOLF_PALETTES[1]!.primaryColor, alpha: 1 },
    ]);
    expect(body2.setFillStyleCalls).toEqual([
      { color: CAT_PALETTES[2]!.primaryColor, alpha: 1 },
    ]);
  });

  it('resetCache forces a re-paint on the next call', () => {
    const r = new RuntimePaletteRenderer();
    const body = createMockRect();
    r.paint(
      'fighter-1',
      { body },
      { index: 1, characterId: 'wolf', paletteIndex: 1 },
    );
    r.resetCache();
    r.paint(
      'fighter-1',
      { body },
      { index: 1, characterId: 'wolf', paletteIndex: 1 },
    );
    expect(body.setFillStyleCalls).toHaveLength(2);
  });

  it('invalidateCacheKey only drops the named slot', () => {
    const r = new RuntimePaletteRenderer();
    const body1 = createMockRect();
    const body2 = createMockRect();
    r.paint('a', { body: body1 }, { index: 1, characterId: 'wolf', paletteIndex: 0 });
    r.paint('b', { body: body2 }, { index: 2, characterId: 'cat', paletteIndex: 0 });
    r.invalidateCacheKey('a');
    r.paint('a', { body: body1 }, { index: 1, characterId: 'wolf', paletteIndex: 0 });
    r.paint('b', { body: body2 }, { index: 2, characterId: 'cat', paletteIndex: 0 });
    expect(body1.setFillStyleCalls).toHaveLength(2); // re-painted after invalidation
    expect(body2.setFillStyleCalls).toHaveLength(1); // unchanged
  });
});

// ---------------------------------------------------------------------------
// PlayerSlot input
// ---------------------------------------------------------------------------

describe('RuntimePaletteRenderer — PlayerSlot input', () => {
  it('a full PlayerSlot produces the same swap as a (playerIndex, characterId, paletteIndex) tuple', () => {
    const slot: PlayerSlot = Object.freeze({
      index: 3,
      characterId: 'cat',
      paletteIndex: 5,
      inputType: 'gamepad',
    });
    const r = new RuntimePaletteRenderer();
    const body = createMockRect();
    const slotResult = r.paint('a', { body }, slot);
    const body2 = createMockRect();
    const tupleResult = r.paint('b', { body: body2 }, {
      index: 3,
      characterId: 'cat',
      paletteIndex: 5,
    });
    expect(slotResult.swap).toEqual(tupleResult.swap);
  });

  it('an out-of-range paletteIndex on a PlayerSlot still produces a valid swap', () => {
    const slot: PlayerSlot = Object.freeze({
      index: 1,
      characterId: 'wolf',
      paletteIndex: 12, // wraps to 12 % 8 = 4
      inputType: 'keyboard_p1',
    });
    const r = new RuntimePaletteRenderer();
    const body = createMockRect();
    const result = r.paint('a', { body }, slot);
    expect(result.swap.paletteIndex).toBe(4);
    expect(result.swap.primaryColor).toBe(WOLF_PALETTES[4]!.primaryColor);
  });
});

// ---------------------------------------------------------------------------
// One-shot paintFighterPalette helper
// ---------------------------------------------------------------------------

describe('paintFighterPalette one-shot', () => {
  it('paints rectangle + sprite in one call', () => {
    const body = createMockRect();
    const sprite = createTintOnlySprite();
    const result = paintFighterPalette(
      { body, sprite },
      { index: 1, characterId: 'cat', paletteIndex: 3 },
    );
    expect(body.setFillStyleCalls).toHaveLength(1);
    expect(sprite.setTintCalls).toEqual([CAT_PALETTES[3]!.primaryColor]);
    expect(result.spritePath).toBe('tint');
  });
});

// ---------------------------------------------------------------------------
// Module-scope default renderer
// ---------------------------------------------------------------------------

describe('module-scope default renderer', () => {
  beforeEach(() => {
    resetDefaultRuntimePaletteRenderer();
  });

  it('returns the same instance on repeated getDefault*() calls', () => {
    const a = getDefaultRuntimePaletteRenderer();
    const b = getDefaultRuntimePaletteRenderer();
    expect(a).toBe(b);
  });

  it('configureDefault* swaps in a new instance', () => {
    const initial = getDefaultRuntimePaletteRenderer();
    const game = createMockGame();
    const reconfigured = configureDefaultRuntimePaletteRenderer(game, () => ({}));
    expect(reconfigured).not.toBe(initial);
    expect(getDefaultRuntimePaletteRenderer()).toBe(reconfigured);
  });

  it('reset drops the singleton so the next get returns a fresh one', () => {
    const a = getDefaultRuntimePaletteRenderer();
    resetDefaultRuntimePaletteRenderer();
    const b = getDefaultRuntimePaletteRenderer();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// asPaletteSwapTarget
// ---------------------------------------------------------------------------

describe('asPaletteSwapTarget', () => {
  it('forwards setFillStyle / setStrokeStyle / setTint / clearTint with bound `this`', () => {
    const obj = {
      _fill: 0,
      _stroke: 0,
      _tint: 0,
      _clear: 0,
      setFillStyle(c: number, _a?: number) {
        this._fill = c;
      },
      setStrokeStyle(_w: number, c: number, _a?: number) {
        this._stroke = c;
      },
      setTint(c: number) {
        this._tint = c;
      },
      clearTint() {
        this._clear += 1;
      },
    };
    const target = asPaletteSwapTarget(obj);
    target.setFillStyle?.(0xabcdef);
    target.setStrokeStyle?.(2, 0x123456);
    target.setTint?.(0x7f7f7f);
    target.clearTint?.();
    expect(obj._fill).toBe(0xabcdef);
    expect(obj._stroke).toBe(0x123456);
    expect(obj._tint).toBe(0x7f7f7f);
    expect(obj._clear).toBe(1);
  });

  it('omits methods the source object does not expose', () => {
    const obj = {
      setTint(_c: number) {
        // tint-only mock
      },
    };
    const target = asPaletteSwapTarget(obj);
    expect(target.setFillStyle).toBeUndefined();
    expect(target.setStrokeStyle).toBeUndefined();
    expect(target.setTint).toBeDefined();
    expect(target.clearTint).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// End-to-end determinism — every (id, paletteIndex) in the legal grid
// ---------------------------------------------------------------------------

describe('end-to-end determinism — full palette grid', () => {
  const ids: ReadonlyArray<CharacterId> = ['wolf', 'cat', 'owl', 'bear'];
  const ladders = {
    wolf: WOLF_PALETTES,
    cat: CAT_PALETTES,
    owl: OWL_PALETTES,
    bear: BEAR_PALETTES,
  } as const;

  it('every (id, paletteIndex) paints the rect with the exact (primary, accent) pair from the table', () => {
    const r = new RuntimePaletteRenderer();
    for (const id of ids) {
      const ladder = ladders[id];
      for (let i = 0; i < PALETTES_PER_CHARACTER; i++) {
        const body = createMockRect();
        const facingMark = createMockTriangle();
        r.paint(
          `${id}-${i}`,
          { body, facingMark },
          { index: 1, characterId: id, paletteIndex: i },
        );
        expect(body.setFillStyleCalls).toEqual([
          { color: ladder[i]!.primaryColor, alpha: 1 },
        ]);
        expect(body.setStrokeStyleCalls).toEqual([
          { width: 2, color: ladder[i]!.accentColor, alpha: 1 },
        ]);
        expect(facingMark.setFillStyleCalls).toEqual([
          { color: ladder[i]!.accentColor, alpha: 1 },
        ]);
      }
    }
  });

  it('every (id, paletteIndex) tints the sprite with the body slot target', () => {
    const r = new RuntimePaletteRenderer();
    for (const id of ids) {
      const ladder = ladders[id];
      for (let i = 0; i < PALETTES_PER_CHARACTER; i++) {
        const sprite = createTintOnlySprite();
        const result = r.paint(
          `${id}-${i}-sprite`,
          { sprite },
          { index: 1, characterId: id, paletteIndex: i },
        );
        expect(result.spritePath).toBe('tint');
        expect(sprite.setTintCalls).toEqual([ladder[i]!.primaryColor]);
      }
    }
  });

  it('two renderers given the same input sequence produce the same paint operations', () => {
    const ra = new RuntimePaletteRenderer();
    const rb = new RuntimePaletteRenderer();
    const sequence: ReadonlyArray<{
      key: string;
      slot: { index: 1 | 2 | 3 | 4; characterId: CharacterId; paletteIndex: number };
    }> = [
      { key: 'a', slot: { index: 1, characterId: 'wolf', paletteIndex: 0 } },
      { key: 'b', slot: { index: 2, characterId: 'cat', paletteIndex: 1 } },
      { key: 'c', slot: { index: 3, characterId: 'owl', paletteIndex: 2 } },
      { key: 'd', slot: { index: 4, characterId: 'bear', paletteIndex: 3 } },
      { key: 'a', slot: { index: 1, characterId: 'wolf', paletteIndex: 0 } }, // cache hit
    ];
    const opsA: Array<{ fills: number; strokes: number; tints: number; cacheHits: number }> = [];
    const opsB: Array<{ fills: number; strokes: number; tints: number; cacheHits: number }> = [];
    for (const step of sequence) {
      const ba = createMockRect();
      const bb = createMockRect();
      const ra_result = ra.paint(step.key, { body: ba }, step.slot);
      const rb_result = rb.paint(step.key, { body: bb }, step.slot);
      opsA.push({
        fills: ra_result.ops.fills,
        strokes: ra_result.ops.strokes,
        tints: ra_result.ops.tints,
        cacheHits: ra_result.ops.cacheHits,
      });
      opsB.push({
        fills: rb_result.ops.fills,
        strokes: rb_result.ops.strokes,
        tints: rb_result.ops.tints,
        cacheHits: rb_result.ops.cacheHits,
      });
    }
    expect(opsA).toEqual(opsB);
  });
});
