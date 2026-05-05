import { describe, it, expect } from 'vitest';
import {
  createPlatformVisualBinder,
  PLATFORM_GHOST_STROKE_WIDTH,
  PLATFORM_OVERLAY_STROKE_WIDTH,
  type BindablePlatformVisual,
} from './PlatformVisualBinder';
import {
  computePlatformVisualState,
  PLATFORM_VISUAL_TINTS,
} from './platformVisualState';
import type { CrumblingRenderState } from '../entities/CrumblingPlatform';
import type { PeriodicRenderState } from '../entities/PeriodicPlatform';

/**
 * Sub-AC 4 of AC 90304 — wire Phaser visual states to platform
 * behavior runtime states. These tests cover the binder layer (the
 * Phaser-free pure logic is locked down by `platformVisualState.test.ts`).
 *
 * The binder mutates a {@link BindablePlatformVisual} in place each
 * frame. We drive it with a plain object that satisfies the structural
 * shape — no Phaser import needed in the test runtime, mirroring the
 * `platformCollisionToggle.test.ts` pattern.
 *
 * Locked-down contract:
 *
 *   1. `apply()` writes the live `(x, y, width, height, alpha,
 *      visible, fillColor)` from the (state, base*) pair every frame.
 *   2. Outline modes flip the stroke style correctly:
 *      • `'fill'`         — strokeAlpha = 0 (no outline)
 *      • `'fill+overlay'` — thick stroke in overlay tint, full alpha
 *      • `'ghost'`        — thin stroke, alpha = `outlineIntensity`
 *   3. `apply()` returns true iff at least one observable changed
 *      (so callers can short-circuit dirty-region work).
 *   4. `reset()` reverts the GameObject to its base values.
 *   5. Mutating `target.baseX/Y/Width/Height` re-bases subsequent
 *      `apply()` calls — supports stage-builder repositioning.
 *   6. Optional `setStrokeStyle` / `setFillStyle` helpers are called
 *      when present.
 *   7. The binder integrates correctly with `computePlatformVisualState`
 *      for crumble / periodic / moving runtime states.
 */

interface MockTarget extends BindablePlatformVisual {
  setFillStyleCalls: Array<{ color: number; alpha: number | undefined }>;
  setStrokeStyleCalls: Array<{
    width: number;
    color: number;
    alpha: number | undefined;
  }>;
}

function makeTarget(overrides: Partial<BindablePlatformVisual> = {}): MockTarget {
  const t: MockTarget = {
    baseX: 100,
    baseY: 200,
    baseWidth: 80,
    baseHeight: 20,
    x: 100,
    y: 200,
    width: 80,
    height: 20,
    alpha: 1,
    visible: true,
    fillColor: 0x000000,
    strokeColor: undefined,
    strokeAlpha: undefined,
    setFillStyleCalls: [],
    setStrokeStyleCalls: [],
    setFillStyle(color: number, alpha?: number) {
      t.setFillStyleCalls.push({ color, alpha });
      t.fillColor = color;
      return t;
    },
    setStrokeStyle(width: number, color: number, alpha?: number) {
      t.setStrokeStyleCalls.push({ width, color, alpha });
      t.strokeColor = color;
      t.strokeAlpha = alpha;
      return t;
    },
    ...overrides,
  };
  return t;
}

// ---------------------------------------------------------------------------
// (1) Basic apply() writes
// ---------------------------------------------------------------------------

describe('createPlatformVisualBinder.apply — basic visual writes', () => {
  it('writes fill, position, size, alpha, visibility from a solid state', () => {
    const target = makeTarget();
    const binder = createPlatformVisualBinder(target);

    const state = computePlatformVisualState({ behavior: 'solid' });
    binder.apply(state);

    expect(target.x).toBe(100); // base + 0 dropOffset + 0 wobble
    expect(target.y).toBe(200);
    expect(target.width).toBe(80);
    expect(target.height).toBe(20);
    expect(target.alpha).toBe(1);
    expect(target.visible).toBe(true);
    // Fill colour written through setFillStyle (preferred path).
    expect(target.setFillStyleCalls.length).toBe(1);
    expect(target.setFillStyleCalls[0]!.color).toBe(
      PLATFORM_VISUAL_TINTS.solid.active,
    );
    expect(target.fillColor).toBe(PLATFORM_VISUAL_TINTS.solid.active);
  });

  it('falls back to direct fillColor write when setFillStyle is absent', () => {
    const target = makeTarget();
    delete (target as Partial<BindablePlatformVisual>).setFillStyle;
    const binder = createPlatformVisualBinder(target);

    const state = computePlatformVisualState({ behavior: 'pass-through' });
    binder.apply(state);

    expect(target.fillColor).toBe(PLATFORM_VISUAL_TINTS.passThrough.active);
    expect(target.setFillStyleCalls.length).toBe(0);
  });

  it('returns true when something changed, false when state is unchanged', () => {
    const target = makeTarget();
    const binder = createPlatformVisualBinder(target);
    const state = computePlatformVisualState({ behavior: 'solid' });

    expect(binder.apply(state)).toBe(true);
    // Re-apply identical state — nothing should change.
    expect(binder.apply(state)).toBe(false);
  });

  it('applies dropOffset + wobble offset on top of base position', () => {
    const target = makeTarget();
    const binder = createPlatformVisualBinder(target);
    const triggered: CrumblingRenderState = {
      alpha: 1,
      wobbleNorm: 0.5,
      dropOffset: 30,
    };
    const state = computePlatformVisualState({
      behavior: 'solid',
      crumble: triggered,
      frame: 7,
    });
    binder.apply(state);
    // The dropOffset goes onto y; wobble adds a deterministic jitter.
    expect(target.y).toBe(200 + 30 + state.wobbleOffsetY);
    expect(target.x).toBe(100 + state.wobbleOffsetX);
  });

  it('applies scaleX to width (multi-stage shrinking bounds)', () => {
    const target = makeTarget();
    const binder = createPlatformVisualBinder(target);
    const state = computePlatformVisualState({
      behavior: 'solid',
      multiStageCrumble: {
        alpha: 1,
        wobbleNorm: 0.7,
        crackLevel: 1,
        chunkLevel: 0.5,
        dropOffset: 0,
        boundsScale: 0.81,
        fragile: true,
      },
      frame: 11,
    });
    binder.apply(state);
    expect(target.width).toBeCloseTo(80 * 0.81, 5);
    expect(target.height).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// (2) Outline modes
// ---------------------------------------------------------------------------

describe('createPlatformVisualBinder.apply — outline modes', () => {
  it("'fill' mode: strokeAlpha cleared to 0", () => {
    const target = makeTarget();
    const binder = createPlatformVisualBinder(target);
    const state = computePlatformVisualState({ behavior: 'solid' });
    binder.apply(state);
    expect(target.strokeAlpha).toBe(0);
    expect(target.setStrokeStyleCalls.length).toBeGreaterThanOrEqual(1);
    expect(target.setStrokeStyleCalls[0]!.width).toBe(0);
  });

  it("'fill+overlay' mode (crumble triggered): thick stroke, overlay tint, full alpha", () => {
    const target = makeTarget();
    const binder = createPlatformVisualBinder(target);
    const triggered: CrumblingRenderState = {
      alpha: 1,
      wobbleNorm: 0.5,
      dropOffset: 0,
    };
    const state = computePlatformVisualState({
      behavior: 'solid',
      crumble: triggered,
      frame: 1,
    });
    binder.apply(state);
    expect(target.strokeColor).toBe(PLATFORM_VISUAL_TINTS.crumble.warning);
    expect(target.strokeAlpha).toBe(1);
    const last = target.setStrokeStyleCalls.at(-1);
    expect(last!.width).toBe(PLATFORM_OVERLAY_STROKE_WIDTH);
  });

  it("'ghost' mode (periodic warnAppear): thin stroke, alpha = outlineIntensity", () => {
    const target = makeTarget();
    const binder = createPlatformVisualBinder(target);
    const ghost: PeriodicRenderState = {
      alpha: 0.4,
      blinkNorm: 0.6,
      outlineNorm: 0.4,
      solid: false,
      warning: true,
    };
    const state = computePlatformVisualState({
      behavior: 'pass-through',
      periodic: ghost,
    });
    binder.apply(state);
    expect(target.strokeColor).toBe(PLATFORM_VISUAL_TINTS.periodic.warning);
    expect(target.strokeAlpha).toBe(0.4);
    const last = target.setStrokeStyleCalls.at(-1);
    expect(last!.width).toBe(PLATFORM_GHOST_STROKE_WIDTH);
  });

  it('ghost intensity ramps each frame within the same mode', () => {
    const target = makeTarget();
    const binder = createPlatformVisualBinder(target);

    const ghostA: PeriodicRenderState = {
      alpha: 0.2,
      blinkNorm: 0.8,
      outlineNorm: 0.2,
      solid: false,
      warning: true,
    };
    const ghostB: PeriodicRenderState = {
      alpha: 0.6,
      blinkNorm: 0.4,
      outlineNorm: 0.6,
      solid: false,
      warning: true,
    };

    binder.apply(
      computePlatformVisualState({
        behavior: 'pass-through',
        periodic: ghostA,
      }),
    );
    expect(target.strokeAlpha).toBe(0.2);

    // Second apply — same mode but different intensity. Binder should
    // re-apply the stroke style each frame so the ghost smoothly fades
    // in rather than locking to the first frame's intensity.
    const changed = binder.apply(
      computePlatformVisualState({
        behavior: 'pass-through',
        periodic: ghostB,
      }),
    );
    expect(changed).toBe(true);
    expect(target.strokeAlpha).toBe(0.6);
  });

  it('mode transitions flip the stroke style', () => {
    const target = makeTarget();
    const binder = createPlatformVisualBinder(target);

    // Frame 0: solid (fill mode).
    binder.apply(computePlatformVisualState({ behavior: 'solid' }));
    const fillCalls = target.setStrokeStyleCalls.length;

    // Frame 1: triggered crumble (fill+overlay mode).
    binder.apply(
      computePlatformVisualState({
        behavior: 'solid',
        crumble: { alpha: 1, wobbleNorm: 0.5, dropOffset: 0 },
        frame: 1,
      }),
    );
    expect(target.setStrokeStyleCalls.length).toBe(fillCalls + 1);
    expect(target.strokeAlpha).toBe(1);

    // Frame 2: gone (back to fill mode, but invisible).
    binder.apply(
      computePlatformVisualState({
        behavior: 'solid',
        crumble: { alpha: 0, wobbleNorm: 0, dropOffset: 0 },
      }),
    );
    expect(target.visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (3) reset()
// ---------------------------------------------------------------------------

describe('createPlatformVisualBinder.reset', () => {
  it('reverts the GameObject to its base values', () => {
    const target = makeTarget();
    const binder = createPlatformVisualBinder(target);

    const triggered: CrumblingRenderState = {
      alpha: 0.4,
      wobbleNorm: 1,
      dropOffset: 50,
    };
    binder.apply(
      computePlatformVisualState({
        behavior: 'solid',
        crumble: triggered,
        frame: 5,
      }),
    );
    expect(target.alpha).toBe(0.4);
    expect(target.y).not.toBe(target.baseY);

    binder.reset();
    expect(target.x).toBe(target.baseX);
    expect(target.y).toBe(target.baseY);
    expect(target.width).toBe(target.baseWidth);
    expect(target.height).toBe(target.baseHeight);
    expect(target.alpha).toBe(1);
    expect(target.visible).toBe(true);
  });

  it('a re-applied state after reset is treated as a fresh tint write', () => {
    const target = makeTarget();
    const binder = createPlatformVisualBinder(target);
    binder.apply(computePlatformVisualState({ behavior: 'solid' }));
    const before = target.setFillStyleCalls.length;
    binder.reset();
    binder.apply(computePlatformVisualState({ behavior: 'solid' }));
    // The cached `lastTint` is cleared by reset(), so the next apply
    // re-issues the fill write even though the colour is identical to
    // before reset.
    expect(target.setFillStyleCalls.length).toBeGreaterThan(before);
  });
});

// ---------------------------------------------------------------------------
// (4) Re-basing
// ---------------------------------------------------------------------------

describe('createPlatformVisualBinder — base position re-bind', () => {
  it('updating baseX/Y re-bases subsequent apply() calls', () => {
    const target = makeTarget();
    const binder = createPlatformVisualBinder(target);
    binder.apply(computePlatformVisualState({ behavior: 'solid' }));
    expect(target.x).toBe(100);

    target.baseX = 500;
    target.baseY = 700;
    binder.apply(computePlatformVisualState({ behavior: 'solid' }));
    expect(target.x).toBe(500);
    expect(target.y).toBe(700);
  });

  it('updating baseWidth/Height re-bases the size scale', () => {
    const target = makeTarget();
    const binder = createPlatformVisualBinder(target);
    target.baseWidth = 200;
    target.baseHeight = 40;
    binder.apply(
      computePlatformVisualState({
        behavior: 'solid',
        multiStageCrumble: {
          alpha: 1,
          wobbleNorm: 1,
          crackLevel: 1,
          chunkLevel: 1,
          dropOffset: 0,
          boundsScale: 0.5,
          fragile: true,
        },
        frame: 0,
      }),
    );
    expect(target.width).toBeCloseTo(200 * 0.5, 5);
    expect(target.height).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// (5) Integration: full lifecycle through the binder
// ---------------------------------------------------------------------------

describe('Sub-AC 4 integration: full crumble lifecycle through the binder', () => {
  it('intact → triggered → falling → gone produces visible state transitions', () => {
    const target = makeTarget();
    const binder = createPlatformVisualBinder(target);

    // Intact
    binder.apply(
      computePlatformVisualState({
        behavior: 'solid',
        crumble: { alpha: 1, wobbleNorm: 0, dropOffset: 0 },
      }),
    );
    expect(target.fillColor).toBe(PLATFORM_VISUAL_TINTS.solid.active);
    expect(target.alpha).toBe(1);
    expect(target.visible).toBe(true);

    // Triggered (mid warning)
    binder.apply(
      computePlatformVisualState({
        behavior: 'solid',
        crumble: { alpha: 1, wobbleNorm: 0.5, dropOffset: 0 },
        frame: 1,
      }),
    );
    expect(target.strokeColor).toBe(PLATFORM_VISUAL_TINTS.crumble.warning);
    expect(target.fillColor).not.toBe(PLATFORM_VISUAL_TINTS.solid.active); // blended

    // Falling (alpha < 1, drop offset)
    binder.apply(
      computePlatformVisualState({
        behavior: 'solid',
        crumble: { alpha: 0.3, wobbleNorm: 1, dropOffset: 100 },
        frame: 2,
      }),
    );
    expect(target.alpha).toBe(0.3);
    expect(target.y).toBeGreaterThan(target.baseY); // dropped down

    // Gone — invisible
    binder.apply(
      computePlatformVisualState({
        behavior: 'solid',
        crumble: { alpha: 0, wobbleNorm: 0, dropOffset: 0 },
      }),
    );
    expect(target.visible).toBe(false);
  });

  it('moving platform: per-frame x/y track the kinematic motion offset', () => {
    const target = makeTarget();
    const binder = createPlatformVisualBinder(target);
    const motion = {
      waypoints: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      cycleFrames: 60,
    };

    // Frame 0 — at origin (waypoint 0).
    binder.apply(
      computePlatformVisualState({ behavior: 'moving', motion, frame: 0 }),
    );
    expect(target.x).toBe(target.baseX); // 0 offset

    // Frame 30 — at second waypoint (offset 200).
    binder.apply(
      computePlatformVisualState({ behavior: 'moving', motion, frame: 30 }),
    );
    expect(target.x).toBeCloseTo(target.baseX + 200, 5);
  });

  it('pass-through dropping: cyan tint applied while drop is in flight', () => {
    const target = makeTarget();
    const binder = createPlatformVisualBinder(target);

    // Not dropping
    binder.apply(
      computePlatformVisualState({ behavior: 'pass-through', dropping: false }),
    );
    expect(target.fillColor).toBe(PLATFORM_VISUAL_TINTS.passThrough.active);

    // Dropping
    binder.apply(
      computePlatformVisualState({ behavior: 'pass-through', dropping: true }),
    );
    expect(target.fillColor).toBe(PLATFORM_VISUAL_TINTS.passThrough.dropping);

    // Drop ends — back to active tint
    binder.apply(
      computePlatformVisualState({ behavior: 'pass-through', dropping: false }),
    );
    expect(target.fillColor).toBe(PLATFORM_VISUAL_TINTS.passThrough.active);
  });
});
