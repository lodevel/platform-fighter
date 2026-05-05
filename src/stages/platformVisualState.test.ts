import { describe, it, expect } from 'vitest';
import {
  computePlatformVisualState,
  computeMovingPlatformOffset,
  PLATFORM_VISUAL_TINTS,
  PLATFORM_WOBBLE_MAX_PX,
  type PlatformVisualInput,
} from './platformVisualState';
import type { CrumblingRenderState } from '../entities/CrumblingPlatform';
import type { MultiStageCrumblingRenderState } from '../entities/MultiStageCrumblingPlatform';
import type { PeriodicRenderState } from '../entities/PeriodicPlatform';
import type { MovingPlatformMotion } from '../types';

/**
 * Sub-AC 4 of AC 90304 — wire Phaser visual states (sprite/tint/animation
 * transitions) to reflect each platform behavior's active state at
 * runtime.
 *
 * These tests lock down:
 *
 *   1. The canonical tint palette is frozen and exposes one entry per
 *      (behavior × runtime-state) pair documented in the contract.
 *   2. Pure base behaviors:
 *      • `solid` resolves to the slate base tint when active and the
 *        desaturated dark tint when inactive.
 *      • `pass-through` switches to the cyan dropping tint while a
 *        fighter is mid-drop-through.
 *      • `moving` reads as the purple kinematic tint, plus its
 *        kinematic position offset on `dropOffsetX/Y`.
 *   3. Hazard overlays compose correctly:
 *      • Crumbling (intact / triggered / falling / gone) drives alpha,
 *        wobble, drop offset, and the amber warning overlay.
 *      • Multi-stage crumble: shake/crack/break sub-stages each pick
 *        the right overlay tint (amber for warning, red for fragile)
 *        and shrink `scaleX` during crack/break.
 *      • Periodic warnDisappear: fill+overlay style with yellow tint.
 *      • Periodic warnAppear: outline-only ghost mode with intensity
 *        ramping with `outlineNorm`.
 *   4. Moving platform offset:
 *      • Linear / sine easing produce different mid-cycle positions.
 *      • Ping-pong wraps back to start at end of cycle.
 *      • Loop teleports back to first waypoint at end of cycle.
 *      • Phase offset shifts the cycle correctly.
 *   5. Wobble determinism: identical frame counters always produce
 *      identical wobble offsets — required for replay byte-equivalence.
 *   6. Visibility short-circuits when alpha is zero (gone phase).
 */

const baseInput = (
  partial: Partial<PlatformVisualInput> = {},
): PlatformVisualInput => ({
  behavior: 'solid',
  ...partial,
});

const linearMotion = (
  override: Partial<MovingPlatformMotion> = {},
): MovingPlatformMotion => ({
  waypoints: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  cycleFrames: 60,
  ...override,
});

// ---------------------------------------------------------------------------
// (1) Tint palette
// ---------------------------------------------------------------------------

describe('PLATFORM_VISUAL_TINTS — frozen canonical palette', () => {
  it('exposes one entry per behavior × runtime-state pair', () => {
    expect(PLATFORM_VISUAL_TINTS.solid.active).toBeTypeOf('number');
    expect(PLATFORM_VISUAL_TINTS.solid.inactive).toBeTypeOf('number');
    expect(PLATFORM_VISUAL_TINTS.passThrough.active).toBeTypeOf('number');
    expect(PLATFORM_VISUAL_TINTS.passThrough.inactive).toBeTypeOf('number');
    expect(PLATFORM_VISUAL_TINTS.passThrough.dropping).toBeTypeOf('number');
    expect(PLATFORM_VISUAL_TINTS.moving.active).toBeTypeOf('number');
    expect(PLATFORM_VISUAL_TINTS.moving.inactive).toBeTypeOf('number');
    expect(PLATFORM_VISUAL_TINTS.crumble.warning).toBeTypeOf('number');
    expect(PLATFORM_VISUAL_TINTS.crumble.fragile).toBeTypeOf('number');
    expect(PLATFORM_VISUAL_TINTS.periodic.warning).toBeTypeOf('number');
  });

  it('is frozen so callers cannot mutate the canonical palette', () => {
    expect(Object.isFrozen(PLATFORM_VISUAL_TINTS)).toBe(true);
    expect(Object.isFrozen(PLATFORM_VISUAL_TINTS.solid)).toBe(true);
    expect(Object.isFrozen(PLATFORM_VISUAL_TINTS.passThrough)).toBe(true);
    expect(Object.isFrozen(PLATFORM_VISUAL_TINTS.moving)).toBe(true);
  });

  it('uses distinct colours for each (behavior × state) so the player can read them apart', () => {
    const all = [
      PLATFORM_VISUAL_TINTS.solid.active,
      PLATFORM_VISUAL_TINTS.solid.inactive,
      PLATFORM_VISUAL_TINTS.passThrough.active,
      PLATFORM_VISUAL_TINTS.passThrough.inactive,
      PLATFORM_VISUAL_TINTS.passThrough.dropping,
      PLATFORM_VISUAL_TINTS.moving.active,
      PLATFORM_VISUAL_TINTS.moving.inactive,
      PLATFORM_VISUAL_TINTS.crumble.warning,
      PLATFORM_VISUAL_TINTS.crumble.fragile,
      PLATFORM_VISUAL_TINTS.periodic.warning,
    ];
    const unique = new Set(all);
    expect(unique.size).toBe(all.length);
  });
});

// ---------------------------------------------------------------------------
// (2) Pure base behaviors — solid / pass-through / moving
// ---------------------------------------------------------------------------

describe('computePlatformVisualState — base behaviors', () => {
  it('solid + active: slate tint, fully visible, fill outline mode', () => {
    const s = computePlatformVisualState(baseInput({ behavior: 'solid' }));
    expect(s.visible).toBe(true);
    expect(s.alpha).toBe(1);
    expect(s.tint).toBe(PLATFORM_VISUAL_TINTS.solid.active);
    expect(s.baseTint).toBe(PLATFORM_VISUAL_TINTS.solid.active);
    expect(s.outlineMode).toBe('fill');
    expect(s.solidActive).toBe(true);
    expect(s.warning).toBe(false);
    expect(s.tintBlend).toBe(0);
    expect(s.scaleX).toBe(1);
    expect(s.scaleY).toBe(1);
  });

  it('solid + isSolid:false → desaturated dark tint, still visible, marked non-solid', () => {
    const s = computePlatformVisualState(
      baseInput({ behavior: 'solid', isSolid: false }),
    );
    expect(s.tint).toBe(PLATFORM_VISUAL_TINTS.solid.inactive);
    expect(s.solidActive).toBe(false);
  });

  it('pass-through + not dropping: brighter slate tint', () => {
    const s = computePlatformVisualState(
      baseInput({ behavior: 'pass-through' }),
    );
    expect(s.tint).toBe(PLATFORM_VISUAL_TINTS.passThrough.active);
  });

  it('pass-through + dropping: cyan dropping tint (visual confirmation of drop input)', () => {
    const s = computePlatformVisualState(
      baseInput({ behavior: 'pass-through', dropping: true }),
    );
    expect(s.tint).toBe(PLATFORM_VISUAL_TINTS.passThrough.dropping);
  });

  it('pass-through + isSolid:false: desaturated tint regardless of dropping', () => {
    const a = computePlatformVisualState(
      baseInput({ behavior: 'pass-through', isSolid: false }),
    );
    const b = computePlatformVisualState(
      baseInput({ behavior: 'pass-through', isSolid: false, dropping: true }),
    );
    expect(a.tint).toBe(PLATFORM_VISUAL_TINTS.passThrough.inactive);
    expect(b.tint).toBe(PLATFORM_VISUAL_TINTS.passThrough.inactive);
  });

  it('moving + active: purple kinematic tint', () => {
    const s = computePlatformVisualState(
      baseInput({ behavior: 'moving', motion: linearMotion(), frame: 0 }),
    );
    expect(s.tint).toBe(PLATFORM_VISUAL_TINTS.moving.active);
  });

  it('moving without motion config: still resolves base tint (renderer guards)', () => {
    const s = computePlatformVisualState(baseInput({ behavior: 'moving' }));
    expect(s.tint).toBe(PLATFORM_VISUAL_TINTS.moving.active);
    // No motion: drop offset is zero.
    expect(s.dropOffsetX).toBe(0);
    expect(s.dropOffsetY).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (3) Hazard overlays — crumbling / multi-stage / periodic
// ---------------------------------------------------------------------------

describe('computePlatformVisualState — crumbling overlay', () => {
  const intact: CrumblingRenderState = {
    alpha: 1,
    wobbleNorm: 0,
    dropOffset: 0,
  };
  const triggered: CrumblingRenderState = {
    alpha: 1,
    wobbleNorm: 0.5,
    dropOffset: 0,
  };
  const falling: CrumblingRenderState = {
    alpha: 0.4,
    wobbleNorm: 1,
    dropOffset: 96,
  };
  const gone: CrumblingRenderState = {
    alpha: 0,
    wobbleNorm: 0,
    dropOffset: 0,
  };

  it('intact phase: no overlay, no wobble, no drop', () => {
    const s = computePlatformVisualState(
      baseInput({ behavior: 'solid', crumble: intact }),
    );
    expect(s.alpha).toBe(1);
    expect(s.tint).toBe(PLATFORM_VISUAL_TINTS.solid.active);
    expect(s.tintBlend).toBe(0);
    expect(s.warning).toBe(false);
    expect(s.outlineMode).toBe('fill');
    expect(s.dropOffsetY).toBe(0);
  });

  it('triggered phase: amber warning blend, wobble jitter applied, fill+overlay mode', () => {
    const s = computePlatformVisualState(
      baseInput({ behavior: 'solid', crumble: triggered, frame: 7 }),
    );
    expect(s.warning).toBe(true);
    expect(s.outlineMode).toBe('fill+overlay');
    expect(s.tintBlend).toBe(0.5);
    expect(s.overlayTint).toBe(PLATFORM_VISUAL_TINTS.crumble.warning);
    // Tint is somewhere between base and overlay — strictly between.
    expect(s.tint).not.toBe(s.baseTint);
    expect(s.tint).not.toBe(s.overlayTint);
    // Wobble jitter is non-zero at non-zero intensity.
    expect(Math.abs(s.wobbleOffsetX) + Math.abs(s.wobbleOffsetY)).toBeGreaterThan(0);
  });

  it('falling phase: alpha < 1, drop offset applied to dropOffsetY, marked non-solid', () => {
    const s = computePlatformVisualState(
      baseInput({ behavior: 'solid', crumble: falling }),
    );
    expect(s.alpha).toBe(0.4);
    expect(s.dropOffsetY).toBe(96);
    expect(s.solidActive).toBe(false);
    expect(s.visible).toBe(true);
  });

  it('gone phase: alpha 0 forces visible:false', () => {
    const s = computePlatformVisualState(
      baseInput({ behavior: 'solid', crumble: gone }),
    );
    expect(s.alpha).toBe(0);
    expect(s.visible).toBe(false);
  });
});

describe('computePlatformVisualState — multi-stage crumbling overlay', () => {
  it('shake sub-stage: amber warning (no cracks yet), wobble ramp', () => {
    const shake: MultiStageCrumblingRenderState = {
      alpha: 1,
      wobbleNorm: 0.33,
      crackLevel: 0,
      chunkLevel: 0,
      dropOffset: 0,
      boundsScale: 1,
      fragile: false,
    };
    const s = computePlatformVisualState(
      baseInput({ behavior: 'solid', multiStageCrumble: shake, frame: 1 }),
    );
    expect(s.warning).toBe(true);
    expect(s.overlayTint).toBe(PLATFORM_VISUAL_TINTS.crumble.warning);
    expect(s.outlineMode).toBe('fill+overlay');
    expect(s.tintBlend).toBe(0.33);
    expect(s.scaleX).toBe(1);
  });

  it('crack sub-stage: amber warning, scaleX shrinks below 1', () => {
    const crack: MultiStageCrumblingRenderState = {
      alpha: 1,
      wobbleNorm: 0.66,
      crackLevel: 0.5,
      chunkLevel: 0,
      dropOffset: 0,
      boundsScale: 0.96,
      fragile: false,
    };
    const s = computePlatformVisualState(
      baseInput({ behavior: 'solid', multiStageCrumble: crack, frame: 2 }),
    );
    expect(s.overlayTint).toBe(PLATFORM_VISUAL_TINTS.crumble.warning);
    expect(s.scaleX).toBe(0.96);
    // tintBlend tracks max(wobbleNorm, crackLevel) = 0.66
    expect(s.tintBlend).toBe(0.66);
  });

  it('break sub-stage: bright red fragile overlay, scaleX shrinks further', () => {
    const breakState: MultiStageCrumblingRenderState = {
      alpha: 1,
      wobbleNorm: 1,
      crackLevel: 1,
      chunkLevel: 0.5,
      dropOffset: 0,
      boundsScale: 0.81,
      fragile: true,
    };
    const s = computePlatformVisualState(
      baseInput({
        behavior: 'solid',
        multiStageCrumble: breakState,
        frame: 3,
      }),
    );
    expect(s.overlayTint).toBe(PLATFORM_VISUAL_TINTS.crumble.fragile);
    expect(s.scaleX).toBe(0.81);
    expect(s.tintBlend).toBe(1); // max(crackLevel=1, chunkLevel=0.5) = 1
  });

  it('falling sub-phase: alpha < 1, marked non-solid', () => {
    const falling: MultiStageCrumblingRenderState = {
      alpha: 0.4,
      wobbleNorm: 1,
      crackLevel: 1,
      chunkLevel: 1,
      dropOffset: 96,
      boundsScale: 0,
      fragile: false,
    };
    const s = computePlatformVisualState(
      baseInput({ behavior: 'solid', multiStageCrumble: falling, frame: 4 }),
    );
    expect(s.alpha).toBe(0.4);
    expect(s.dropOffsetY).toBe(96);
    expect(s.solidActive).toBe(false);
  });

  it('gone phase: alpha 0 → invisible', () => {
    const gone: MultiStageCrumblingRenderState = {
      alpha: 0,
      wobbleNorm: 0,
      crackLevel: 0,
      chunkLevel: 0,
      dropOffset: 0,
      boundsScale: 0,
      fragile: false,
    };
    const s = computePlatformVisualState(
      baseInput({ behavior: 'solid', multiStageCrumble: gone }),
    );
    expect(s.visible).toBe(false);
  });
});

describe('computePlatformVisualState — periodic overlay', () => {
  it('solid phase: full alpha, no warning, fill mode', () => {
    const solid: PeriodicRenderState = {
      alpha: 1,
      blinkNorm: 0,
      outlineNorm: 0,
      solid: true,
      warning: false,
    };
    const s = computePlatformVisualState(
      baseInput({ behavior: 'pass-through', periodic: solid }),
    );
    expect(s.warning).toBe(false);
    expect(s.outlineMode).toBe('fill');
    expect(s.solidActive).toBe(true);
  });

  it('warnDisappear: yellow warning overlay, still solid, fill+overlay mode', () => {
    const warn: PeriodicRenderState = {
      alpha: 1,
      blinkNorm: 0.7,
      outlineNorm: 0,
      solid: true,
      warning: true,
    };
    const s = computePlatformVisualState(
      baseInput({ behavior: 'pass-through', periodic: warn }),
    );
    expect(s.warning).toBe(true);
    expect(s.outlineMode).toBe('fill+overlay');
    expect(s.overlayTint).toBe(PLATFORM_VISUAL_TINTS.periodic.warning);
    expect(s.tintBlend).toBe(0.7);
    expect(s.solidActive).toBe(true);
  });

  it('warnAppear: ghost outline mode, intensity ramps with outlineNorm', () => {
    const ghost: PeriodicRenderState = {
      alpha: 0.4,
      blinkNorm: 0.6,
      outlineNorm: 0.4,
      solid: false,
      warning: true,
    };
    const s = computePlatformVisualState(
      baseInput({ behavior: 'pass-through', periodic: ghost }),
    );
    expect(s.outlineMode).toBe('ghost');
    expect(s.outlineIntensity).toBe(0.4);
    expect(s.solidActive).toBe(false);
    expect(s.warning).toBe(true);
  });

  it('gone phase: alpha 0, outline 0 → invisible', () => {
    const gone: PeriodicRenderState = {
      alpha: 0,
      blinkNorm: 0,
      outlineNorm: 0,
      solid: false,
      warning: false,
    };
    const s = computePlatformVisualState(
      baseInput({ behavior: 'pass-through', periodic: gone }),
    );
    expect(s.visible).toBe(false);
    expect(s.solidActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (4) Moving platform offset
// ---------------------------------------------------------------------------

describe('computeMovingPlatformOffset — kinematic motion', () => {
  it('frame 0 of ping-pong sits at first waypoint (origin)', () => {
    const m = linearMotion();
    const o = computeMovingPlatformOffset(m, 0);
    expect(o.x).toBe(0);
    expect(o.y).toBe(0);
  });

  it('frame at quarter-cycle of ping-pong sits at half the segment', () => {
    // ping-pong: cycle = 60, segCount = 1, doubled length = 2.
    // pathT = (15/60) * 2 = 0.5 → halfway from waypoint 0 to waypoint 1.
    const m = linearMotion();
    const o = computeMovingPlatformOffset(m, 15);
    expect(o.x).toBeCloseTo(50, 5);
    expect(o.y).toBe(0);
  });

  it('frame at mid-cycle of ping-pong sits at the second waypoint (apex)', () => {
    // pathT = (30/60) * 2 = 1 → exactly waypoint 1.
    const m = linearMotion();
    const o = computeMovingPlatformOffset(m, 30);
    expect(o.x).toBeCloseTo(100, 5);
    expect(o.y).toBe(0);
  });

  it('frame at three-quarter cycle of ping-pong is on the way back', () => {
    // pathT = (45/60) * 2 = 1.5 → folded back to 2 - 1.5 = 0.5 → halfway.
    const m = linearMotion();
    const o = computeMovingPlatformOffset(m, 45);
    expect(o.x).toBeCloseTo(50, 5);
  });

  it('end-of-cycle of ping-pong returns to first waypoint (smooth wrap)', () => {
    const m = linearMotion();
    const oStart = computeMovingPlatformOffset(m, 0);
    const oEnd = computeMovingPlatformOffset(m, 60);
    // Frame 60 wraps modulo cycleFrames(60) to 0.
    expect(oEnd.x).toBeCloseTo(oStart.x, 5);
    expect(oEnd.y).toBeCloseTo(oStart.y, 5);
  });

  it('loop mode: end of cycle teleports back to first waypoint (wraps via modulo)', () => {
    const m = linearMotion({ mode: 'loop' });
    // pathT = (59/60) * 1 ≈ 0.983 → near waypoint 1.
    const o = computeMovingPlatformOffset(m, 59);
    expect(o.x).toBeCloseTo(98.333, 2);
    // Frame 60 wraps to 0 → back at first waypoint.
    const oWrap = computeMovingPlatformOffset(m, 60);
    expect(oWrap.x).toBe(0);
  });

  it('phase offset shifts the cycle correctly', () => {
    const m = linearMotion({ phaseFrames: 30 });
    // With phase=30, frame=0 behaves like frame=30 in the unphased cycle.
    expect(computeMovingPlatformOffset(m, 0)).toEqual(
      computeMovingPlatformOffset(linearMotion(), 30),
    );
  });

  it('sine easing produces a smoother mid-segment than linear', () => {
    const linear = linearMotion();
    const sine = linearMotion({ easing: 'sine' });
    // At a quarter-segment the sine eased value is < linear (it slows
    // at the segment ends).
    const linearPos = computeMovingPlatformOffset(linear, 7);
    const sinePos = computeMovingPlatformOffset(sine, 7);
    expect(sinePos.x).toBeLessThan(linearPos.x);
  });

  it('multi-waypoint path: traverses each segment in order', () => {
    const m: MovingPlatformMotion = {
      waypoints: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      cycleFrames: 80,
      mode: 'loop',
    };
    // segCount = 2, cycleFrames = 80. Halfway through cycle (frame 40)
    // → pathT = (40/80) * 2 = 1.0 → exactly second waypoint.
    const o = computeMovingPlatformOffset(m, 40);
    expect(o.x).toBeCloseTo(100, 5);
    expect(o.y).toBeCloseTo(0, 5);
  });

  it('handles negative frames via modulo wrap', () => {
    const m = linearMotion();
    // Frame -60 is one full cycle backwards → equivalent to frame 0.
    const o = computeMovingPlatformOffset(m, -60);
    expect(o.x).toBeCloseTo(0, 5);
  });

  it('degenerate single-waypoint motion returns zero offset (defensive)', () => {
    const m = {
      waypoints: [{ x: 50, y: 50 }],
      cycleFrames: 60,
    } as unknown as MovingPlatformMotion;
    const o = computeMovingPlatformOffset(m, 30);
    expect(o).toEqual({ x: 0, y: 0 });
  });

  it('moving platform offset feeds dropOffsetX/Y on visual state', () => {
    const motion = linearMotion({
      waypoints: [
        { x: 0, y: 0 },
        { x: 80, y: 40 },
      ],
    });
    const s = computePlatformVisualState(
      baseInput({ behavior: 'moving', motion, frame: 30 }),
    );
    // pathT = (30/60) * 2 = 1 → at second waypoint exactly.
    expect(s.dropOffsetX).toBeCloseTo(80, 5);
    expect(s.dropOffsetY).toBeCloseTo(40, 5);
  });
});

// ---------------------------------------------------------------------------
// (5) Wobble determinism
// ---------------------------------------------------------------------------

describe('wobble jitter determinism (replay byte-equivalence)', () => {
  it('identical inputs always produce identical wobble offsets', () => {
    const triggered: CrumblingRenderState = {
      alpha: 1,
      wobbleNorm: 0.8,
      dropOffset: 0,
    };
    const a = computePlatformVisualState(
      baseInput({ behavior: 'solid', crumble: triggered, frame: 12345 }),
    );
    const b = computePlatformVisualState(
      baseInput({ behavior: 'solid', crumble: triggered, frame: 12345 }),
    );
    expect(a.wobbleOffsetX).toBe(b.wobbleOffsetX);
    expect(a.wobbleOffsetY).toBe(b.wobbleOffsetY);
  });

  it('different frames produce different jitter patterns', () => {
    const triggered: CrumblingRenderState = {
      alpha: 1,
      wobbleNorm: 1,
      dropOffset: 0,
    };
    const seen = new Set<string>();
    for (let f = 0; f < 50; f++) {
      const s = computePlatformVisualState(
        baseInput({ behavior: 'solid', crumble: triggered, frame: f }),
      );
      seen.add(`${s.wobbleOffsetX.toFixed(4)}:${s.wobbleOffsetY.toFixed(4)}`);
    }
    // 50 distinct frames should produce mostly-distinct jitter
    // patterns (allow at most a handful of coincidences from the
    // hash space).
    expect(seen.size).toBeGreaterThan(45);
  });

  it('wobble amplitude scales with intensity and is bounded', () => {
    const lo: CrumblingRenderState = { alpha: 1, wobbleNorm: 0.1, dropOffset: 0 };
    const hi: CrumblingRenderState = { alpha: 1, wobbleNorm: 1.0, dropOffset: 0 };
    const sLo = computePlatformVisualState(
      baseInput({ behavior: 'solid', crumble: lo, frame: 17 }),
    );
    const sHi = computePlatformVisualState(
      baseInput({ behavior: 'solid', crumble: hi, frame: 17 }),
    );
    // Same hash, different intensity scaling → magnitudes ratio is ~10.
    const magLo = Math.abs(sLo.wobbleOffsetX);
    const magHi = Math.abs(sHi.wobbleOffsetX);
    expect(magHi).toBeGreaterThan(magLo);
    expect(magHi).toBeLessThanOrEqual(PLATFORM_WOBBLE_MAX_PX + 1e-9);
  });

  it('zero intensity collapses jitter to exact zero', () => {
    const intact: CrumblingRenderState = {
      alpha: 1,
      wobbleNorm: 0,
      dropOffset: 0,
    };
    const s = computePlatformVisualState(
      baseInput({ behavior: 'solid', crumble: intact, frame: 99 }),
    );
    expect(s.wobbleOffsetX).toBe(0);
    expect(s.wobbleOffsetY).toBe(0);
  });

  it('non-finite frame collapses to deterministic zero-frame jitter', () => {
    const triggered: CrumblingRenderState = {
      alpha: 1,
      wobbleNorm: 0.5,
      dropOffset: 0,
    };
    const a = computePlatformVisualState(
      baseInput({ behavior: 'solid', crumble: triggered, frame: NaN }),
    );
    const b = computePlatformVisualState(
      baseInput({ behavior: 'solid', crumble: triggered, frame: 0 }),
    );
    expect(a.wobbleOffsetX).toBe(b.wobbleOffsetX);
    expect(a.wobbleOffsetY).toBe(b.wobbleOffsetY);
  });
});

// ---------------------------------------------------------------------------
// (6) Visibility short-circuits
// ---------------------------------------------------------------------------

describe('visibility short-circuits at zero alpha', () => {
  it('crumble gone: visible:false', () => {
    const gone: CrumblingRenderState = {
      alpha: 0,
      wobbleNorm: 0,
      dropOffset: 0,
    };
    const s = computePlatformVisualState(
      baseInput({ behavior: 'solid', crumble: gone }),
    );
    expect(s.visible).toBe(false);
  });

  it('multi-stage gone: visible:false', () => {
    const gone: MultiStageCrumblingRenderState = {
      alpha: 0,
      wobbleNorm: 0,
      crackLevel: 0,
      chunkLevel: 0,
      dropOffset: 0,
      boundsScale: 0,
      fragile: false,
    };
    const s = computePlatformVisualState(
      baseInput({ behavior: 'solid', multiStageCrumble: gone }),
    );
    expect(s.visible).toBe(false);
  });

  it('periodic gone: visible:false (no outline either)', () => {
    const gone: PeriodicRenderState = {
      alpha: 0,
      blinkNorm: 0,
      outlineNorm: 0,
      solid: false,
      warning: false,
    };
    const s = computePlatformVisualState(
      baseInput({ behavior: 'pass-through', periodic: gone }),
    );
    expect(s.visible).toBe(false);
  });

  it('periodic warnAppear with outline > 0: still visible (ghost)', () => {
    const ghost: PeriodicRenderState = {
      alpha: 0.2,
      blinkNorm: 0.8,
      outlineNorm: 0.2,
      solid: false,
      warning: true,
    };
    const s = computePlatformVisualState(
      baseInput({ behavior: 'pass-through', periodic: ghost }),
    );
    expect(s.visible).toBe(true);
  });
});
