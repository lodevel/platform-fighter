import { describe, it, expect } from 'vitest';
import {
  PeriodicPlatform,
  PERIODIC_PLATFORM_DEFAULTS,
  type PeriodicPlatformOptions,
} from './PeriodicPlatform';

/**
 * Sub-AC 3 of AC 10 — disappearing/reappearing platform on a fixed
 * periodic timer cycle with telegraphed warning states.
 *
 * What this suite locks down:
 *
 *   1. Construction validates geometry, per-phase durations, and the
 *      phaseOffset so callers can't author an unphysical or undriveable
 *      platform.
 *   2. The lifecycle is purely *time-driven* — no `onSteppedOn()`,
 *      no triggers; every transition is a pure function of the cycle
 *      position and the configured durations.
 *   3. Both transitions are **telegraphed**: a `warnDisappear` phase
 *      precedes vanishing while the platform stays solid, and a
 *      `warnAppear` phase precedes reappearing while the platform stays
 *      *non*-solid (so fighters can't be teleported into a body that
 *      is still ghosting in).
 *   4. Phase boundaries fire at the *exact* configured frame —
 *      `solidDuration`, `warnDisappearDuration`, `goneDuration`,
 *      `warnAppearDuration`.
 *   5. The cycle wraps cleanly with no off-by-one drift across many
 *      laps. `cyclePos` and `frame` advance in lockstep until cyclePos
 *      hits cycleLength and wraps back to 0.
 *   6. `phaseOffset` lets two platforms with identical configs run out
 *      of phase — e.g. one solid while the other is gone.
 *   7. Render hints (`alpha`, `blinkNorm`, `outlineNorm`, `solid`,
 *      `warning`) follow the documented curves in each phase.
 *   8. Snapshot/restore round-trips byte-perfect — `fromState(toState())`
 *      yields identical phase + observable state. This is the property
 *      the M4 replay VCR relies on.
 *   9. Determinism — identical input sequences produce identical
 *      observable state across instances.
 */

const baseOpts: PeriodicPlatformOptions = {
  x: 960,
  y: 600,
  width: 240,
  height: 32,
};

// ---------------------------------------------------------------------------
// Construction / validation
// ---------------------------------------------------------------------------

describe('PeriodicPlatform — construction & validation', () => {
  it('builds with sensible defaults', () => {
    const p = new PeriodicPlatform(baseOpts);
    expect(p.getSolidDuration()).toBe(
      PERIODIC_PLATFORM_DEFAULTS.solidDuration,
    );
    expect(p.getWarnDisappearDuration()).toBe(
      PERIODIC_PLATFORM_DEFAULTS.warnDisappearDuration,
    );
    expect(p.getGoneDuration()).toBe(PERIODIC_PLATFORM_DEFAULTS.goneDuration);
    expect(p.getWarnAppearDuration()).toBe(
      PERIODIC_PLATFORM_DEFAULTS.warnAppearDuration,
    );
    expect(p.getCycleLength()).toBe(
      PERIODIC_PLATFORM_DEFAULTS.solidDuration +
        PERIODIC_PLATFORM_DEFAULTS.warnDisappearDuration +
        PERIODIC_PLATFORM_DEFAULTS.goneDuration +
        PERIODIC_PLATFORM_DEFAULTS.warnAppearDuration,
    );
    expect(p.getId()).toBe('periodic');
    expect(p.getPhase()).toBe('solid');
    expect(p.getCyclePos()).toBe(0);
    expect(p.getPhaseOffset()).toBe(0);
    expect(p.getFrame()).toBe(0);
  });

  it('uses an explicit id when provided', () => {
    const p = new PeriodicPlatform({ ...baseOpts, id: 'phase-left' });
    expect(p.getId()).toBe('phase-left');
  });

  it('exposes the static AABB geometry', () => {
    const p = new PeriodicPlatform({
      ...baseOpts,
      x: 100,
      y: 200,
      width: 50,
      height: 12,
    });
    const b = p.getBounds();
    expect(b).toEqual({ x: 100, y: 200, width: 50, height: 12 });
    expect(p.getX()).toBe(100);
    expect(p.getY()).toBe(200);
    expect(p.getWidth()).toBe(50);
    expect(p.getHeight()).toBe(12);
  });

  it.each([
    ['width 0', { width: 0 }],
    ['width negative', { width: -1 }],
    ['height 0', { height: 0 }],
    ['height negative', { height: -1 }],
  ])('rejects bad geometry (%s)', (_label, override) => {
    expect(
      () => new PeriodicPlatform({ ...baseOpts, ...override }),
    ).toThrow();
  });

  it.each([
    ['x non-finite', { x: NaN }],
    ['y non-finite', { y: Infinity }],
  ])('rejects non-finite coordinates (%s)', (_label, override) => {
    expect(
      () => new PeriodicPlatform({ ...baseOpts, ...override }),
    ).toThrow(/finite/);
  });

  it.each([
    ['solidDuration <= 0', { solidDuration: 0 }],
    ['solidDuration negative', { solidDuration: -10 }],
    ['solidDuration fractional', { solidDuration: 12.5 }],
  ])('rejects bad solidDuration (%s)', (_label, override) => {
    expect(
      () => new PeriodicPlatform({ ...baseOpts, ...override }),
    ).toThrow(/solidDuration/);
  });

  it.each([
    ['warnDisappearDuration <= 0', { warnDisappearDuration: 0 }],
    ['warnDisappearDuration fractional', { warnDisappearDuration: 1.5 }],
  ])('rejects bad warnDisappearDuration (%s)', (_label, override) => {
    expect(
      () => new PeriodicPlatform({ ...baseOpts, ...override }),
    ).toThrow(/warnDisappearDuration/);
  });

  it.each([
    ['goneDuration <= 0', { goneDuration: 0 }],
    ['goneDuration fractional', { goneDuration: 99.5 }],
  ])('rejects bad goneDuration (%s)', (_label, override) => {
    expect(
      () => new PeriodicPlatform({ ...baseOpts, ...override }),
    ).toThrow(/goneDuration/);
  });

  it.each([
    ['warnAppearDuration <= 0', { warnAppearDuration: 0 }],
    ['warnAppearDuration fractional', { warnAppearDuration: 0.25 }],
  ])('rejects bad warnAppearDuration (%s)', (_label, override) => {
    expect(
      () => new PeriodicPlatform({ ...baseOpts, ...override }),
    ).toThrow(/warnAppearDuration/);
  });

  it.each([
    ['phaseOffset negative', { phaseOffset: -1 }],
    ['phaseOffset fractional', { phaseOffset: 1.5 }],
  ])('rejects bad phaseOffset (%s)', (_label, override) => {
    expect(
      () => new PeriodicPlatform({ ...baseOpts, ...override }),
    ).toThrow(/phaseOffset/);
  });

  it('accepts and reduces a phaseOffset larger than cycle length', () => {
    const p = new PeriodicPlatform({
      ...baseOpts,
      solidDuration: 10,
      warnDisappearDuration: 5,
      goneDuration: 10,
      warnAppearDuration: 5,
      phaseOffset: 33, // cycle = 30; 33 % 30 = 3
    });
    expect(p.getCycleLength()).toBe(30);
    expect(p.getPhaseOffset()).toBe(3);
    expect(p.getCyclePos()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle state machine — purely time-driven
// ---------------------------------------------------------------------------

describe('PeriodicPlatform — lifecycle state machine', () => {
  it('starts in solid, fully collidable, no warning', () => {
    const p = new PeriodicPlatform(baseOpts);
    expect(p.getPhase()).toBe('solid');
    expect(p.isSolid()).toBe(true);
    expect(p.isVisible()).toBe(true);
    expect(p.isWarning()).toBe(false);
    expect(p.isWarningDisappear()).toBe(false);
    expect(p.isWarningAppear()).toBe(false);
  });

  it('transitions solid → warnDisappear precisely at solidDuration', () => {
    const p = new PeriodicPlatform({
      ...baseOpts,
      solidDuration: 10,
      warnDisappearDuration: 5,
      goneDuration: 10,
      warnAppearDuration: 5,
    });
    // 9 ticks: still solid.
    for (let i = 0; i < 9; i++) p.tick();
    expect(p.getPhase()).toBe('solid');
    expect(p.isSolid()).toBe(true);
    expect(p.getFramesUntilNextTransition()).toBe(1);

    // 10th tick: enter warnDisappear.
    p.tick();
    expect(p.getPhase()).toBe('warnDisappear');
    expect(p.isSolid()).toBe(true); // still collidable during warning
    expect(p.isWarningDisappear()).toBe(true);
    expect(p.isWarning()).toBe(true);
  });

  it('transitions warnDisappear → gone precisely at warnDisappearDuration', () => {
    const p = new PeriodicPlatform({
      ...baseOpts,
      solidDuration: 10,
      warnDisappearDuration: 5,
      goneDuration: 10,
      warnAppearDuration: 5,
    });
    for (let i = 0; i < 10; i++) p.tick(); // -> warnDisappear
    expect(p.getPhase()).toBe('warnDisappear');
    for (let i = 0; i < 4; i++) p.tick();
    expect(p.getPhase()).toBe('warnDisappear');
    p.tick();
    expect(p.getPhase()).toBe('gone');
    expect(p.isSolid()).toBe(false);
    expect(p.isVisible()).toBe(false);
  });

  it('transitions gone → warnAppear precisely at goneDuration', () => {
    const p = new PeriodicPlatform({
      ...baseOpts,
      solidDuration: 10,
      warnDisappearDuration: 5,
      goneDuration: 10,
      warnAppearDuration: 5,
    });
    for (let i = 0; i < 15; i++) p.tick(); // -> gone
    expect(p.getPhase()).toBe('gone');
    for (let i = 0; i < 9; i++) p.tick();
    expect(p.getPhase()).toBe('gone');
    p.tick();
    expect(p.getPhase()).toBe('warnAppear');
    // Crucial: still NOT solid during the appearance warning.
    expect(p.isSolid()).toBe(false);
    expect(p.isVisible()).toBe(true); // ghost is visible
    expect(p.isWarningAppear()).toBe(true);
    expect(p.isWarning()).toBe(true);
  });

  it('transitions warnAppear → solid precisely at warnAppearDuration (cycle wraps)', () => {
    const p = new PeriodicPlatform({
      ...baseOpts,
      solidDuration: 10,
      warnDisappearDuration: 5,
      goneDuration: 10,
      warnAppearDuration: 5,
    });
    for (let i = 0; i < 25; i++) p.tick(); // -> warnAppear
    expect(p.getPhase()).toBe('warnAppear');
    for (let i = 0; i < 4; i++) p.tick();
    expect(p.getPhase()).toBe('warnAppear');
    p.tick();
    // Cycle wraps: back to solid.
    expect(p.getPhase()).toBe('solid');
    expect(p.isSolid()).toBe(true);
    expect(p.getCyclePos()).toBe(0);
    // Absolute frame keeps counting up — does not wrap.
    expect(p.getFrame()).toBe(30);
  });

  it('runs many full cycles without drift (deterministic timing)', () => {
    const p = new PeriodicPlatform({
      ...baseOpts,
      solidDuration: 7,
      warnDisappearDuration: 3,
      goneDuration: 11,
      warnAppearDuration: 5,
    });
    const cycle = 7 + 3 + 11 + 5; // 26 frames
    expect(p.getCycleLength()).toBe(cycle);
    for (let lap = 0; lap < 100; lap++) {
      for (let i = 0; i < cycle; i++) p.tick();
      expect(p.getPhase()).toBe('solid');
      expect(p.getCyclePos()).toBe(0);
      expect(p.getFrame()).toBe((lap + 1) * cycle);
    }
  });
});

// ---------------------------------------------------------------------------
// Solidity & warning telegraphing — the core contract
// ---------------------------------------------------------------------------

describe('PeriodicPlatform — solidity & warning telegraphs', () => {
  it('is solid throughout the disappearance warning (telegraphed-while-solid)', () => {
    const p = new PeriodicPlatform({
      ...baseOpts,
      solidDuration: 5,
      warnDisappearDuration: 8,
      goneDuration: 5,
      warnAppearDuration: 3,
    });
    for (let i = 0; i < 5; i++) p.tick(); // -> warnDisappear
    expect(p.getPhase()).toBe('warnDisappear');
    for (let i = 0; i < 8; i++) {
      // For all 8 frames of warnDisappear the platform must still be solid.
      expect(p.isSolid()).toBe(true);
      expect(p.isWarning()).toBe(true);
      if (i < 7) p.tick();
    }
    p.tick();
    // Now we've fully consumed the warning — gone.
    expect(p.getPhase()).toBe('gone');
    expect(p.isSolid()).toBe(false);
  });

  it('is NOT solid throughout the reappearance warning (telegraphed-before-solid)', () => {
    const p = new PeriodicPlatform({
      ...baseOpts,
      solidDuration: 3,
      warnDisappearDuration: 3,
      goneDuration: 3,
      warnAppearDuration: 6,
    });
    for (let i = 0; i < 9; i++) p.tick(); // -> warnAppear
    expect(p.getPhase()).toBe('warnAppear');
    for (let i = 0; i < 6; i++) {
      // Throughout warnAppear the platform must remain non-solid so a
      // fighter cannot be teleported into a body that is still
      // materialising under them.
      expect(p.isSolid()).toBe(false);
      expect(p.isWarning()).toBe(true);
      if (i < 5) p.tick();
    }
    p.tick();
    expect(p.getPhase()).toBe('solid');
    expect(p.isSolid()).toBe(true);
  });

  it('getFramesUntilWarnDisappear counts down then wraps each cycle', () => {
    const p = new PeriodicPlatform({
      ...baseOpts,
      solidDuration: 10,
      warnDisappearDuration: 5,
      goneDuration: 10,
      warnAppearDuration: 5,
    });
    // cycleLength = 30. Start at cyclePos=0 → 10 frames until warnDisappear.
    expect(p.getFramesUntilWarnDisappear()).toBe(10);
    p.tick();
    expect(p.getFramesUntilWarnDisappear()).toBe(9);
    for (let i = 0; i < 9; i++) p.tick();
    // Now in warnDisappear → already-warning ⇒ 0.
    expect(p.getPhase()).toBe('warnDisappear');
    expect(p.getFramesUntilWarnDisappear()).toBe(0);
    // Walk past the warning into gone (cyclePos=15).
    for (let i = 0; i < 5; i++) p.tick();
    expect(p.getPhase()).toBe('gone');
    expect(p.getCyclePos()).toBe(15);
    // From cyclePos=15: walk 15 frames forward to wrap to 0, then 10
    // more frames to reach the next warnDisappear at cyclePos=10. So 25.
    expect(p.getFramesUntilWarnDisappear()).toBe(25);
  });

  it('getFramesUntilSolid is 0 in solid and otherwise counts down to next cycle start', () => {
    const p = new PeriodicPlatform({
      ...baseOpts,
      solidDuration: 10,
      warnDisappearDuration: 5,
      goneDuration: 10,
      warnAppearDuration: 5,
    });
    // In solid:
    expect(p.getFramesUntilSolid()).toBe(0);
    // Step 1 frame into solid — still solid, still 0:
    p.tick();
    expect(p.getFramesUntilSolid()).toBe(0);
    // Step into warnDisappear (cyclePos=10) — wraps to cyclePos=0 in 20.
    for (let i = 0; i < 9; i++) p.tick();
    expect(p.getCyclePos()).toBe(10);
    expect(p.getPhase()).toBe('warnDisappear');
    expect(p.getFramesUntilSolid()).toBe(20);
    // Walk all the way to cyclePos = 25 (start of warnAppear):
    for (let i = 0; i < 15; i++) p.tick();
    expect(p.getCyclePos()).toBe(25);
    expect(p.getPhase()).toBe('warnAppear');
    expect(p.getFramesUntilSolid()).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Phase offset — out-of-phase platforms
// ---------------------------------------------------------------------------

describe('PeriodicPlatform — phase offset', () => {
  it('starts at the offset cycle position', () => {
    const p = new PeriodicPlatform({
      ...baseOpts,
      solidDuration: 10,
      warnDisappearDuration: 5,
      goneDuration: 10,
      warnAppearDuration: 5,
      phaseOffset: 15, // start in `gone`
    });
    expect(p.getCyclePos()).toBe(15);
    expect(p.getPhase()).toBe('gone');
    expect(p.isSolid()).toBe(false);
  });

  it('can place two platforms half a cycle out of phase', () => {
    const cycle = 30;
    const a = new PeriodicPlatform({
      ...baseOpts,
      solidDuration: 10,
      warnDisappearDuration: 5,
      goneDuration: 10,
      warnAppearDuration: 5,
    });
    const b = new PeriodicPlatform({
      ...baseOpts,
      id: 'phase-b',
      solidDuration: 10,
      warnDisappearDuration: 5,
      goneDuration: 10,
      warnAppearDuration: 5,
      phaseOffset: cycle / 2,
    });
    expect(a.getPhase()).toBe('solid');
    expect(b.getPhase()).toBe('gone');
    // Walk forward and verify they meet "the other one is solid" each cycle.
    for (let i = 0; i < cycle; i++) {
      a.tick();
      b.tick();
    }
    // After one full cycle they're back to where they started.
    expect(a.getPhase()).toBe('solid');
    expect(b.getPhase()).toBe('gone');
  });

  it('reset returns to the original offset (not 0)', () => {
    const p = new PeriodicPlatform({
      ...baseOpts,
      solidDuration: 10,
      warnDisappearDuration: 5,
      goneDuration: 10,
      warnAppearDuration: 5,
      phaseOffset: 7,
    });
    for (let i = 0; i < 100; i++) p.tick();
    p.reset();
    expect(p.getCyclePos()).toBe(7);
    expect(p.getFrame()).toBe(0);
    expect(p.getPhase()).toBe('solid');
  });
});

// ---------------------------------------------------------------------------
// Render hints
// ---------------------------------------------------------------------------

describe('PeriodicPlatform — render hints', () => {
  it('solid renders fully opaque, no warning, collidable', () => {
    const p = new PeriodicPlatform(baseOpts);
    const r = p.getRenderState();
    expect(r.alpha).toBe(1);
    expect(r.blinkNorm).toBe(0);
    expect(r.outlineNorm).toBe(0);
    expect(r.solid).toBe(true);
    expect(r.warning).toBe(false);
  });

  it('warnDisappear renders opaque with blink crescendoing 0 → 1, still solid', () => {
    const p = new PeriodicPlatform({
      ...baseOpts,
      solidDuration: 1,
      warnDisappearDuration: 10,
      goneDuration: 1,
      warnAppearDuration: 1,
    });
    p.tick(); // -> warnDisappear, frame 0 of warnDisappear
    const start = p.getRenderState();
    expect(p.getPhase()).toBe('warnDisappear');
    expect(start.alpha).toBe(1);
    expect(start.blinkNorm).toBeCloseTo(0, 6);
    expect(start.solid).toBe(true);
    expect(start.warning).toBe(true);

    for (let i = 0; i < 5; i++) p.tick();
    const mid = p.getRenderState();
    expect(mid.alpha).toBe(1);
    expect(mid.blinkNorm).toBeCloseTo(0.5, 6);
    expect(mid.solid).toBe(true);

    for (let i = 0; i < 4; i++) p.tick();
    const lateWarn = p.getRenderState();
    expect(p.getPhase()).toBe('warnDisappear');
    expect(lateWarn.blinkNorm).toBeCloseTo(9 / 10, 6);
  });

  it('gone renders alpha 0, no blink, no outline, not solid', () => {
    const p = new PeriodicPlatform({
      ...baseOpts,
      solidDuration: 1,
      warnDisappearDuration: 1,
      goneDuration: 5,
      warnAppearDuration: 1,
    });
    p.tick(); // warnDisappear
    p.tick(); // gone
    const r = p.getRenderState();
    expect(p.getPhase()).toBe('gone');
    expect(r.alpha).toBe(0);
    expect(r.blinkNorm).toBe(0);
    expect(r.outlineNorm).toBe(0);
    expect(r.solid).toBe(false);
    expect(r.warning).toBe(false);
  });

  it('warnAppear ramps alpha & outline 0 → 1, blink decays 1 → 0, NOT solid', () => {
    const p = new PeriodicPlatform({
      ...baseOpts,
      solidDuration: 1,
      warnDisappearDuration: 1,
      goneDuration: 1,
      warnAppearDuration: 10,
    });
    for (let i = 0; i < 3; i++) p.tick(); // -> warnAppear
    expect(p.getPhase()).toBe('warnAppear');
    const start = p.getRenderState();
    expect(start.alpha).toBeCloseTo(0, 6);
    expect(start.outlineNorm).toBeCloseTo(0, 6);
    expect(start.blinkNorm).toBeCloseTo(1, 6);
    expect(start.solid).toBe(false);
    expect(start.warning).toBe(true);

    for (let i = 0; i < 5; i++) p.tick();
    const mid = p.getRenderState();
    expect(mid.alpha).toBeCloseTo(0.5, 6);
    expect(mid.outlineNorm).toBeCloseTo(0.5, 6);
    expect(mid.blinkNorm).toBeCloseTo(0.5, 6);
    expect(mid.solid).toBe(false);

    for (let i = 0; i < 4; i++) p.tick();
    expect(p.getPhase()).toBe('warnAppear');
    const late = p.getRenderState();
    expect(late.alpha).toBeCloseTo(9 / 10, 6);
    expect(late.outlineNorm).toBeCloseTo(9 / 10, 6);
    expect(late.solid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

describe('PeriodicPlatform — reset', () => {
  it('reset returns the platform to phaseOffset and zeroes the absolute frame', () => {
    const p = new PeriodicPlatform({ ...baseOpts, phaseOffset: 0 });
    for (let i = 0; i < 999; i++) p.tick();
    p.reset();
    expect(p.getPhase()).toBe('solid');
    expect(p.getCyclePos()).toBe(0);
    expect(p.getFrame()).toBe(0);
    expect(p.isSolid()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Snapshot / restore (replay)
// ---------------------------------------------------------------------------

describe('PeriodicPlatform — replay snapshot/restore', () => {
  it('toState/fromState round-trips cycle position and frame counter', () => {
    const p = new PeriodicPlatform(baseOpts);
    for (let i = 0; i < 137; i++) p.tick();
    const s = p.toState();
    const q = new PeriodicPlatform(baseOpts);
    q.fromState(s);
    expect(q.getCyclePos()).toBe(p.getCyclePos());
    expect(q.getFrame()).toBe(p.getFrame());
    expect(q.getPhase()).toBe(p.getPhase());
    expect(q.getRenderState()).toEqual(p.getRenderState());
  });

  it('after restoring, future ticks produce identical observables to the original', () => {
    const a = new PeriodicPlatform(baseOpts);
    for (let i = 0; i < 53; i++) a.tick();
    const b = new PeriodicPlatform(baseOpts);
    b.fromState(a.toState());
    for (let i = 0; i < 1000; i++) {
      a.tick();
      b.tick();
      expect(b.getPhase()).toBe(a.getPhase());
      expect(b.getCyclePos()).toBe(a.getCyclePos());
      expect(b.getFrame()).toBe(a.getFrame());
    }
  });

  it('rejects null / non-finite / negative state', () => {
    const p = new PeriodicPlatform(baseOpts);
    // @ts-expect-error — defensive runtime check
    expect(() => p.fromState(null)).toThrow();
    expect(() =>
      p.fromState({ cyclePos: NaN, frame: 0 }),
    ).toThrow(/finite/);
    expect(() =>
      p.fromState({ cyclePos: 0, frame: Infinity }),
    ).toThrow(/finite/);
    expect(() =>
      p.fromState({ cyclePos: -1, frame: 0 }),
    ).toThrow(/≥ 0/);
    expect(() =>
      p.fromState({ cyclePos: 0, frame: -1 }),
    ).toThrow(/≥ 0/);
  });

  it('reduces an out-of-range cyclePos modulo cycleLength on restore', () => {
    const p = new PeriodicPlatform({
      ...baseOpts,
      solidDuration: 10,
      warnDisappearDuration: 5,
      goneDuration: 10,
      warnAppearDuration: 5,
    });
    // Cycle = 30. Restore with cyclePos = 35 → should wrap to 5.
    p.fromState({ cyclePos: 35, frame: 35 });
    expect(p.getCyclePos()).toBe(5);
    expect(p.getPhase()).toBe('solid');
  });
});

// ---------------------------------------------------------------------------
// Determinism — two instances driven identically produce identical state
// ---------------------------------------------------------------------------

describe('PeriodicPlatform — determinism', () => {
  it('two instances with identical configs and tick counts produce identical observables', () => {
    const opts: PeriodicPlatformOptions = {
      ...baseOpts,
      solidDuration: 17,
      warnDisappearDuration: 11,
      goneDuration: 23,
      warnAppearDuration: 7,
      phaseOffset: 13,
    };
    const a = new PeriodicPlatform(opts);
    const b = new PeriodicPlatform(opts);
    for (let i = 0; i < 5_000; i++) {
      a.tick();
      b.tick();
      expect(b.getPhase()).toBe(a.getPhase());
      expect(b.getCyclePos()).toBe(a.getCyclePos());
      expect(b.isSolid()).toBe(a.isSolid());
      expect(b.getRenderState()).toEqual(a.getRenderState());
    }
  });
});
