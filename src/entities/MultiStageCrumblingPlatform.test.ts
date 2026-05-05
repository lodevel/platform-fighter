import { describe, it, expect } from 'vitest';
import {
  MultiStageCrumblingPlatform,
  MULTI_STAGE_CRUMBLE_DEFAULTS,
  type MultiStageCrumblingPlatformOptions,
} from './MultiStageCrumblingPlatform';

/**
 * Sub-AC 2 of AC 10 — multi-stage crumbling platform variant.
 *
 * What this suite locks down:
 *
 *   1. Construction validates geometry, all sub-stage durations, and
 *      the bounds-scale knobs (including the monotonic-degradation
 *      invariant `breakBoundsScale ≤ crackBoundsScale`).
 *   2. Lifecycle fires `intact → shake → crack → break → falling →
 *      gone → intact` at exactly the configured frame boundaries.
 *   3. Solidity (`isSolid`) stays true through *every* warning
 *      sub-stage and flips off precisely on the `break → falling`
 *      transition.
 *   4. `isFragile()` is true exactly during the `break` sub-stage —
 *      the AI / physics adapter relies on this contract.
 *   5. `onSteppedOn()` is idempotent during any non-intact phase.
 *   6. Effective collision bounds *monotonically* shrink across the
 *      degradation arc and become null in `falling` / `gone`. This is
 *      what "collision degradation" actually means at runtime.
 *   7. Render hints (`crackLevel`, `chunkLevel`, `wobbleNorm`,
 *      `boundsScale`, `fragile`) follow the documented curves in
 *      every sub-stage.
 *   8. Snapshot/restore round-trips byte-perfect across all six
 *      lifecycle phases.
 *   9. Determinism — two instances driven by identical inputs produce
 *      identical observable state on every frame, including all
 *      render hints and effective bounds.
 *  10. `getFramesUntilFall()` correctly aggregates remaining warning
 *      sub-stages from any starting phase.
 */

const baseOpts: MultiStageCrumblingPlatformOptions = {
  x: 960,
  y: 800,
  width: 200,
  height: 32,
};

// ---------------------------------------------------------------------------
// Construction / validation
// ---------------------------------------------------------------------------

describe('MultiStageCrumblingPlatform — construction & validation', () => {
  it('builds with sensible defaults from MULTI_STAGE_CRUMBLE_DEFAULTS', () => {
    const p = new MultiStageCrumblingPlatform(baseOpts);
    expect(p.getShakeDuration()).toBe(MULTI_STAGE_CRUMBLE_DEFAULTS.shakeDuration);
    expect(p.getCrackDuration()).toBe(MULTI_STAGE_CRUMBLE_DEFAULTS.crackDuration);
    expect(p.getBreakDuration()).toBe(MULTI_STAGE_CRUMBLE_DEFAULTS.breakDuration);
    expect(p.getFallDuration()).toBe(MULTI_STAGE_CRUMBLE_DEFAULTS.fallDuration);
    expect(p.getRespawnDelay()).toBe(MULTI_STAGE_CRUMBLE_DEFAULTS.respawnDelay);
    expect(p.getCrackBoundsScale()).toBe(
      MULTI_STAGE_CRUMBLE_DEFAULTS.crackBoundsScale,
    );
    expect(p.getBreakBoundsScale()).toBe(
      MULTI_STAGE_CRUMBLE_DEFAULTS.breakBoundsScale,
    );
    expect(p.getId()).toBe('multi-crumble');
    expect(p.getPhase()).toBe('intact');
  });

  it('uses an explicit id when provided', () => {
    const p = new MultiStageCrumblingPlatform({ ...baseOpts, id: 'mc-left' });
    expect(p.getId()).toBe('mc-left');
  });

  it('exposes the static intact AABB geometry unchanged', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      x: 100,
      y: 200,
      width: 50,
      height: 12,
    });
    const b = p.getBounds();
    expect(b).toEqual({ x: 100, y: 200, width: 50, height: 12 });
  });

  it('reports the total warning duration as shake + crack + break', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      shakeDuration: 7,
      crackDuration: 11,
      breakDuration: 13,
    });
    expect(p.getTotalWarningDuration()).toBe(31);
  });

  it.each([
    ['width', { width: 0 }],
    ['width', { width: -1 }],
    ['height', { height: 0 }],
    ['height', { height: -1 }],
  ])('rejects bad geometry (%s)', (_label, override) => {
    expect(
      () => new MultiStageCrumblingPlatform({ ...baseOpts, ...override }),
    ).toThrow();
  });

  it.each([
    ['x non-finite', { x: NaN }],
    ['y non-finite', { y: Infinity }],
  ])('rejects non-finite coordinates (%s)', (_label, override) => {
    expect(
      () => new MultiStageCrumblingPlatform({ ...baseOpts, ...override }),
    ).toThrow(/finite/);
  });

  it.each([
    ['shakeDuration <= 0', { shakeDuration: 0 }],
    ['shakeDuration negative', { shakeDuration: -10 }],
    ['shakeDuration fractional', { shakeDuration: 12.5 }],
  ])('rejects bad shakeDuration (%s)', (_label, override) => {
    expect(
      () => new MultiStageCrumblingPlatform({ ...baseOpts, ...override }),
    ).toThrow(/shakeDuration/);
  });

  it.each([
    ['crackDuration <= 0', { crackDuration: 0 }],
    ['crackDuration fractional', { crackDuration: 5.5 }],
  ])('rejects bad crackDuration (%s)', (_label, override) => {
    expect(
      () => new MultiStageCrumblingPlatform({ ...baseOpts, ...override }),
    ).toThrow(/crackDuration/);
  });

  it.each([
    ['breakDuration <= 0', { breakDuration: 0 }],
    ['breakDuration fractional', { breakDuration: 1.1 }],
  ])('rejects bad breakDuration (%s)', (_label, override) => {
    expect(
      () => new MultiStageCrumblingPlatform({ ...baseOpts, ...override }),
    ).toThrow(/breakDuration/);
  });

  it.each([
    ['fallDuration <= 0', { fallDuration: 0 }],
    ['fallDuration fractional', { fallDuration: 2.5 }],
  ])('rejects bad fallDuration (%s)', (_label, override) => {
    expect(
      () => new MultiStageCrumblingPlatform({ ...baseOpts, ...override }),
    ).toThrow(/fallDuration/);
  });

  it.each([
    ['respawnDelay <= 0', { respawnDelay: 0 }],
    ['respawnDelay fractional', { respawnDelay: 99.5 }],
  ])('rejects bad respawnDelay (%s)', (_label, override) => {
    expect(
      () => new MultiStageCrumblingPlatform({ ...baseOpts, ...override }),
    ).toThrow(/respawnDelay/);
  });

  it.each([
    ['crackBoundsScale = 0', { crackBoundsScale: 0 }],
    ['crackBoundsScale > 1', { crackBoundsScale: 1.1 }],
    ['crackBoundsScale negative', { crackBoundsScale: -0.5 }],
    ['crackBoundsScale NaN', { crackBoundsScale: NaN }],
  ])('rejects bad crackBoundsScale (%s)', (_label, override) => {
    expect(
      () => new MultiStageCrumblingPlatform({ ...baseOpts, ...override }),
    ).toThrow(/crackBoundsScale/);
  });

  it.each([
    ['breakBoundsScale = 0', { breakBoundsScale: 0 }],
    ['breakBoundsScale > 1', { breakBoundsScale: 1.5 }],
  ])('rejects bad breakBoundsScale (%s)', (_label, override) => {
    expect(
      () => new MultiStageCrumblingPlatform({ ...baseOpts, ...override }),
    ).toThrow(/breakBoundsScale/);
  });

  it('rejects breakBoundsScale > crackBoundsScale (collision must monotonically degrade)', () => {
    expect(
      () =>
        new MultiStageCrumblingPlatform({
          ...baseOpts,
          crackBoundsScale: 0.7,
          breakBoundsScale: 0.9,
        }),
    ).toThrow(/monotonically/);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle state machine
// ---------------------------------------------------------------------------

describe('MultiStageCrumblingPlatform — lifecycle state machine', () => {
  it('starts in intact, solid, visible, no countdown running', () => {
    const p = new MultiStageCrumblingPlatform(baseOpts);
    expect(p.getPhase()).toBe('intact');
    expect(p.isSolid()).toBe(true);
    expect(p.isVisible()).toBe(true);
    expect(p.isDegrading()).toBe(false);
    expect(p.isFragile()).toBe(false);
    expect(p.hasFallen()).toBe(false);
    expect(p.getFramesUntilNextTransition()).toBe(Infinity);
    expect(p.getFramesUntilFall()).toBe(Infinity);
  });

  it('onSteppedOn advances intact → shake', () => {
    const p = new MultiStageCrumblingPlatform({ ...baseOpts, shakeDuration: 30 });
    expect(p.onSteppedOn()).toBe(true);
    expect(p.getPhase()).toBe('shake');
    expect(p.isSolid()).toBe(true);
    expect(p.isDegrading()).toBe(true);
    expect(p.isFragile()).toBe(false);
  });

  it('progresses shake → crack → break → falling at exact frame boundaries', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      shakeDuration: 10,
      crackDuration: 15,
      breakDuration: 20,
    });
    p.onSteppedOn();

    // 10 ticks → end of shake → entering crack.
    for (let i = 0; i < 9; i++) p.tick();
    expect(p.getPhase()).toBe('shake');
    p.tick();
    expect(p.getPhase()).toBe('crack');
    expect(p.isSolid()).toBe(true);
    expect(p.isFragile()).toBe(false);

    // 15 more ticks → end of crack → entering break.
    for (let i = 0; i < 14; i++) p.tick();
    expect(p.getPhase()).toBe('crack');
    p.tick();
    expect(p.getPhase()).toBe('break');
    expect(p.isSolid()).toBe(true); // crucially still solid in break
    expect(p.isFragile()).toBe(true);

    // 20 more ticks → end of break → entering falling. Solidity flips here.
    for (let i = 0; i < 19; i++) p.tick();
    expect(p.getPhase()).toBe('break');
    expect(p.isSolid()).toBe(true);
    p.tick();
    expect(p.getPhase()).toBe('falling');
    expect(p.isSolid()).toBe(false);
    expect(p.isFragile()).toBe(false);
  });

  it('disappears (gone) precisely at fallDuration frames after falling', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      shakeDuration: 1,
      crackDuration: 1,
      breakDuration: 1,
      fallDuration: 10,
    });
    p.onSteppedOn();
    // 3 ticks gets through shake/crack/break; one more enters falling.
    for (let i = 0; i < 3; i++) p.tick();
    expect(p.getPhase()).toBe('falling');
    for (let i = 0; i < 9; i++) p.tick();
    expect(p.getPhase()).toBe('falling');
    p.tick();
    expect(p.getPhase()).toBe('gone');
    expect(p.isVisible()).toBe(false);
    expect(p.hasFallen()).toBe(true);
  });

  it('respawns (gone → intact) precisely at respawnDelay frames', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      shakeDuration: 1,
      crackDuration: 1,
      breakDuration: 1,
      fallDuration: 1,
      respawnDelay: 12,
    });
    p.onSteppedOn();
    // 4 ticks through warning + falling → gone.
    for (let i = 0; i < 4; i++) p.tick();
    expect(p.getPhase()).toBe('gone');
    for (let i = 0; i < 11; i++) p.tick();
    expect(p.getPhase()).toBe('gone');
    p.tick();
    expect(p.getPhase()).toBe('intact');
    expect(p.isSolid()).toBe(true);
  });

  it('completes a full cycle and is steppable again post-respawn', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      shakeDuration: 2,
      crackDuration: 2,
      breakDuration: 2,
      fallDuration: 2,
      respawnDelay: 2,
    });
    p.onSteppedOn();
    for (let i = 0; i < 10; i++) p.tick(); // back to intact
    expect(p.getPhase()).toBe('intact');
    expect(p.onSteppedOn()).toBe(true);
    expect(p.getPhase()).toBe('shake');
  });

  it('runs many full cycles without drift', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      shakeDuration: 3,
      crackDuration: 5,
      breakDuration: 7,
      fallDuration: 11,
      respawnDelay: 13,
    });
    const cycle = 3 + 5 + 7 + 11 + 13; // 39 frames per lap
    let totalFramesElapsed = 0;
    for (let lap = 0; lap < 25; lap++) {
      p.onSteppedOn();
      for (let i = 0; i < cycle; i++) p.tick();
      totalFramesElapsed += cycle;
      expect(p.getPhase()).toBe('intact');
      expect(p.getFrame()).toBe(totalFramesElapsed);
    }
  });

  it('getFramesUntilFall aggregates remaining warning sub-stages', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      shakeDuration: 10,
      crackDuration: 20,
      breakDuration: 30,
    });
    expect(p.getFramesUntilFall()).toBe(Infinity);

    p.onSteppedOn(); // shake @ frame 0
    expect(p.getFramesUntilFall()).toBe(60);

    for (let i = 0; i < 5; i++) p.tick(); // mid-shake
    expect(p.getFramesUntilFall()).toBe(55);

    for (let i = 0; i < 5; i++) p.tick(); // entering crack
    expect(p.getPhase()).toBe('crack');
    expect(p.getFramesUntilFall()).toBe(50);

    for (let i = 0; i < 20; i++) p.tick(); // entering break
    expect(p.getPhase()).toBe('break');
    expect(p.getFramesUntilFall()).toBe(30);

    for (let i = 0; i < 30; i++) p.tick(); // falling
    expect(p.getPhase()).toBe('falling');
    expect(p.getFramesUntilFall()).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// onSteppedOn idempotence
// ---------------------------------------------------------------------------

describe('MultiStageCrumblingPlatform — onSteppedOn idempotence', () => {
  it('repeated step-on during shake/crack/break is a no-op', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      shakeDuration: 10,
      crackDuration: 10,
      breakDuration: 10,
    });
    p.onSteppedOn();
    for (let i = 0; i < 3; i++) p.tick();
    expect(p.onSteppedOn()).toBe(false);
    expect(p.getFramesUntilNextTransition()).toBe(7); // not reset

    for (let i = 0; i < 8; i++) p.tick(); // crack
    expect(p.getPhase()).toBe('crack');
    expect(p.onSteppedOn()).toBe(false);

    for (let i = 0; i < 10; i++) p.tick(); // break
    expect(p.getPhase()).toBe('break');
    expect(p.onSteppedOn()).toBe(false);
  });

  it('returns false in falling and gone too', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      shakeDuration: 1,
      crackDuration: 1,
      breakDuration: 1,
      fallDuration: 5,
      respawnDelay: 100,
    });
    p.onSteppedOn();
    for (let i = 0; i < 3; i++) p.tick();
    expect(p.getPhase()).toBe('falling');
    expect(p.onSteppedOn()).toBe(false);

    for (let i = 0; i < 5; i++) p.tick();
    expect(p.getPhase()).toBe('gone');
    expect(p.onSteppedOn()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Effective bounds — collision degradation
// ---------------------------------------------------------------------------

describe('MultiStageCrumblingPlatform — effective collision bounds', () => {
  it('returns full bounds in intact and shake', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      width: 200,
      shakeDuration: 30,
      crackDuration: 30,
      breakDuration: 30,
    });
    expect(p.getEffectiveBounds()).toEqual({ x: 960, y: 800, width: 200, height: 32 });

    p.onSteppedOn();
    expect(p.getEffectiveBounds()?.width).toBeCloseTo(200, 6);
    for (let i = 0; i < 29; i++) p.tick();
    // Still in shake on the very last frame; bounds still 200.
    expect(p.getPhase()).toBe('shake');
    expect(p.getEffectiveBounds()?.width).toBeCloseTo(200, 6);
  });

  it('shrinks bounds linearly across crack', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      width: 200,
      shakeDuration: 1,
      crackDuration: 10,
      breakDuration: 10,
      crackBoundsScale: 0.9,
      breakBoundsScale: 0.5,
    });
    p.onSteppedOn();
    p.tick(); // -> crack frame 0
    expect(p.getPhase()).toBe('crack');
    expect(p.getEffectiveBounds()?.width).toBeCloseTo(200, 6);

    for (let i = 0; i < 5; i++) p.tick(); // halfway through crack
    // 50% progress: width scale = 1 - (1 - 0.9) * 0.5 = 0.95
    expect(p.getEffectiveBounds()?.width).toBeCloseTo(200 * 0.95, 6);

    for (let i = 0; i < 5; i++) p.tick(); // entering break
    expect(p.getPhase()).toBe('break');
    expect(p.getEffectiveBounds()?.width).toBeCloseTo(200 * 0.9, 6);
  });

  it('shrinks bounds further across break (down to breakBoundsScale)', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      width: 200,
      shakeDuration: 1,
      crackDuration: 1,
      breakDuration: 10,
      crackBoundsScale: 0.9,
      breakBoundsScale: 0.5,
    });
    p.onSteppedOn();
    p.tick(); // crack
    p.tick(); // break frame 0
    expect(p.getPhase()).toBe('break');
    expect(p.getEffectiveBounds()?.width).toBeCloseTo(200 * 0.9, 6);

    for (let i = 0; i < 5; i++) p.tick(); // halfway through break
    // 50% from 0.9 → 0.5: scale = 0.7
    expect(p.getEffectiveBounds()?.width).toBeCloseTo(200 * 0.7, 6);

    for (let i = 0; i < 4; i++) p.tick(); // last frame of break
    expect(p.getPhase()).toBe('break');
    expect(p.getEffectiveBounds()?.width).toBeCloseTo(200 * 0.54, 6);
    p.tick();
    // Now we entered falling — no collision.
    expect(p.getPhase()).toBe('falling');
    expect(p.getEffectiveBounds()).toBeNull();
  });

  it('returns null bounds in falling and gone', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      shakeDuration: 1,
      crackDuration: 1,
      breakDuration: 1,
      fallDuration: 5,
      respawnDelay: 5,
    });
    p.onSteppedOn();
    for (let i = 0; i < 3; i++) p.tick();
    expect(p.getPhase()).toBe('falling');
    expect(p.getEffectiveBounds()).toBeNull();
    for (let i = 0; i < 5; i++) p.tick();
    expect(p.getPhase()).toBe('gone');
    expect(p.getEffectiveBounds()).toBeNull();
  });

  it('effective bounds height is constant — degradation is lateral only', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      width: 200,
      height: 32,
      shakeDuration: 1,
      crackDuration: 4,
      breakDuration: 4,
    });
    p.onSteppedOn();
    p.tick();
    for (let i = 0; i < 8; i++) {
      const b = p.getEffectiveBounds();
      expect(b?.height).toBe(32);
      expect(b?.x).toBe(960); // centred
      expect(b?.y).toBe(800);
      p.tick();
    }
  });

  it('bounds-scale never increases across the warning arc (monotonic)', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      width: 200,
      shakeDuration: 5,
      crackDuration: 7,
      breakDuration: 9,
      crackBoundsScale: 0.85,
      breakBoundsScale: 0.55,
    });
    p.onSteppedOn();
    let prevScale = 1;
    for (let i = 0; i < 5 + 7 + 9; i++) {
      const r = p.getRenderState();
      expect(r.boundsScale).toBeLessThanOrEqual(prevScale + 1e-9);
      prevScale = r.boundsScale;
      p.tick();
    }
    // After the full warning we're in falling — boundsScale flips to 0.
    expect(p.getPhase()).toBe('falling');
    expect(p.getRenderState().boundsScale).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Render hints
// ---------------------------------------------------------------------------

describe('MultiStageCrumblingPlatform — render hints', () => {
  it('intact: full alpha, zero everything else', () => {
    const r = new MultiStageCrumblingPlatform(baseOpts).getRenderState();
    expect(r).toEqual({
      alpha: 1,
      wobbleNorm: 0,
      crackLevel: 0,
      chunkLevel: 0,
      dropOffset: 0,
      boundsScale: 1,
      fragile: false,
    });
  });

  it('shake: wobble grows, no cracks/chunks yet, full bounds', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      shakeDuration: 30,
      crackDuration: 30,
      breakDuration: 30,
    });
    p.onSteppedOn();
    const r0 = p.getRenderState();
    expect(r0.alpha).toBe(1);
    expect(r0.wobbleNorm).toBeCloseTo(0, 6);
    expect(r0.crackLevel).toBe(0);
    expect(r0.chunkLevel).toBe(0);
    expect(r0.boundsScale).toBe(1);
    expect(r0.fragile).toBe(false);

    for (let i = 0; i < 15; i++) p.tick();
    const rMid = p.getRenderState();
    // Wobble at 15 / 90 = 1/6
    expect(rMid.wobbleNorm).toBeCloseTo(15 / 90, 6);
    expect(rMid.crackLevel).toBe(0);
    expect(rMid.chunkLevel).toBe(0);
  });

  it('crack: wobble continues, crackLevel ramps 0→1, bounds shrink', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      shakeDuration: 10,
      crackDuration: 20,
      breakDuration: 30,
      crackBoundsScale: 0.9,
    });
    p.onSteppedOn();
    for (let i = 0; i < 10; i++) p.tick(); // entering crack
    const r0 = p.getRenderState();
    expect(p.getPhase()).toBe('crack');
    expect(r0.crackLevel).toBeCloseTo(0, 6);
    expect(r0.chunkLevel).toBe(0);
    expect(r0.boundsScale).toBeCloseTo(1, 6);
    expect(r0.fragile).toBe(false);

    for (let i = 0; i < 10; i++) p.tick(); // mid-crack
    const rMid = p.getRenderState();
    expect(rMid.crackLevel).toBeCloseTo(0.5, 6);
    expect(rMid.boundsScale).toBeCloseTo(1 - 0.1 * 0.5, 6);
    // Wobble at (10 + 10) / 60 = 1/3
    expect(rMid.wobbleNorm).toBeCloseTo((10 + 10) / 60, 6);
  });

  it('break: crack saturated, chunkLevel ramps 0→1, fragile=true', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      shakeDuration: 5,
      crackDuration: 5,
      breakDuration: 20,
    });
    p.onSteppedOn();
    for (let i = 0; i < 10; i++) p.tick();
    expect(p.getPhase()).toBe('break');
    const r0 = p.getRenderState();
    expect(r0.crackLevel).toBe(1);
    expect(r0.chunkLevel).toBeCloseTo(0, 6);
    expect(r0.fragile).toBe(true);
    expect(r0.alpha).toBe(1);

    for (let i = 0; i < 10; i++) p.tick();
    const rMid = p.getRenderState();
    expect(rMid.chunkLevel).toBeCloseTo(0.5, 6);
    expect(rMid.fragile).toBe(true);
  });

  it('falling: alpha fades 1→0, dropOffset grows 0→fallPixels, fragile=false', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      shakeDuration: 1,
      crackDuration: 1,
      breakDuration: 1,
      fallDuration: 10,
    });
    p.onSteppedOn();
    for (let i = 0; i < 3; i++) p.tick();
    expect(p.getPhase()).toBe('falling');
    const start = p.getRenderState();
    expect(start.alpha).toBeCloseTo(1, 6);
    expect(start.dropOffset).toBeCloseTo(0, 6);
    expect(start.fragile).toBe(false);
    expect(start.boundsScale).toBe(0);

    for (let i = 0; i < 5; i++) p.tick();
    const mid = p.getRenderState();
    expect(mid.alpha).toBeCloseTo(0.5, 6);
    expect(mid.dropOffset).toBeCloseTo(
      0.5 * MULTI_STAGE_CRUMBLE_DEFAULTS.fallPixels,
      6,
    );
  });

  it('gone: alpha 0, every other hint quiescent', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      shakeDuration: 1,
      crackDuration: 1,
      breakDuration: 1,
      fallDuration: 1,
      respawnDelay: 30,
    });
    p.onSteppedOn();
    for (let i = 0; i < 4; i++) p.tick();
    expect(p.getPhase()).toBe('gone');
    expect(p.getRenderState()).toEqual({
      alpha: 0,
      wobbleNorm: 0,
      crackLevel: 0,
      chunkLevel: 0,
      dropOffset: 0,
      boundsScale: 0,
      fragile: false,
    });
  });

  it('crackLevel and chunkLevel monotonically increase across the warning arc', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      shakeDuration: 5,
      crackDuration: 7,
      breakDuration: 9,
    });
    p.onSteppedOn();
    let prevCrack = 0;
    let prevChunk = 0;
    for (let i = 0; i < 5 + 7 + 9; i++) {
      const r = p.getRenderState();
      expect(r.crackLevel).toBeGreaterThanOrEqual(prevCrack - 1e-9);
      expect(r.chunkLevel).toBeGreaterThanOrEqual(prevChunk - 1e-9);
      prevCrack = r.crackLevel;
      prevChunk = r.chunkLevel;
      p.tick();
    }
    // After warning we're in falling — both levels saturate.
    const r = p.getRenderState();
    expect(r.crackLevel).toBe(1);
    expect(r.chunkLevel).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

describe('MultiStageCrumblingPlatform — reset', () => {
  it('reset returns the platform to intact at frame 0', () => {
    const p = new MultiStageCrumblingPlatform(baseOpts);
    p.onSteppedOn();
    for (let i = 0; i < 200; i++) p.tick();
    p.reset();
    expect(p.getPhase()).toBe('intact');
    expect(p.getFrame()).toBe(0);
    expect(p.getPhaseStartFrame()).toBe(0);
    expect(p.isSolid()).toBe(true);
    expect(p.getEffectiveBounds()?.width).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Snapshot / restore (replay)
// ---------------------------------------------------------------------------

describe('MultiStageCrumblingPlatform — replay snapshot/restore', () => {
  it('toState/fromState round-trips phase, frame, and phaseStartFrame', () => {
    const p = new MultiStageCrumblingPlatform({
      ...baseOpts,
      shakeDuration: 10,
      crackDuration: 10,
      breakDuration: 10,
    });
    p.onSteppedOn();
    for (let i = 0; i < 17; i++) p.tick();

    const snap = p.toState();
    const phaseBefore = p.getPhase();
    const renderBefore = p.getRenderState();
    const untilBefore = p.getFramesUntilNextTransition();

    for (let i = 0; i < 100; i++) p.tick();
    expect(p.getPhase()).not.toBe(phaseBefore);

    p.fromState(snap);
    expect(p.getPhase()).toBe(phaseBefore);
    expect(p.getFrame()).toBe(snap.frame);
    expect(p.getFramesUntilNextTransition()).toBe(untilBefore);

    const renderAfter = p.getRenderState();
    expect(renderAfter.alpha).toBeCloseTo(renderBefore.alpha, 10);
    expect(renderAfter.wobbleNorm).toBeCloseTo(renderBefore.wobbleNorm, 10);
    expect(renderAfter.crackLevel).toBeCloseTo(renderBefore.crackLevel, 10);
    expect(renderAfter.chunkLevel).toBeCloseTo(renderBefore.chunkLevel, 10);
    expect(renderAfter.dropOffset).toBeCloseTo(renderBefore.dropOffset, 10);
    expect(renderAfter.boundsScale).toBeCloseTo(renderBefore.boundsScale, 10);
    expect(renderAfter.fragile).toBe(renderBefore.fragile);
  });

  it('rejects malformed snapshots', () => {
    const p = new MultiStageCrumblingPlatform(baseOpts);
    // @ts-expect-error — exercising runtime guard
    expect(() => p.fromState(null)).toThrow();
    expect(() =>
      // @ts-expect-error — invalid phase string at runtime
      p.fromState({ phase: 'collapsed', frame: 0, phaseStartFrame: 0 }),
    ).toThrow();
    expect(() =>
      p.fromState({ phase: 'intact', frame: NaN, phaseStartFrame: 0 }),
    ).toThrow(/finite/);
    expect(() =>
      p.fromState({ phase: 'intact', frame: 0, phaseStartFrame: 5 }),
    ).toThrow(/phaseStartFrame/);
  });

  it('restores correctly from each lifecycle phase', () => {
    const opts: MultiStageCrumblingPlatformOptions = {
      ...baseOpts,
      shakeDuration: 4,
      crackDuration: 4,
      breakDuration: 4,
      fallDuration: 4,
      respawnDelay: 4,
    };
    const phasePoints: { ticks: number; expected: string }[] = [
      { ticks: 0, expected: 'shake' },
      { ticks: 4, expected: 'crack' },
      { ticks: 8, expected: 'break' },
      { ticks: 12, expected: 'falling' },
      { ticks: 16, expected: 'gone' },
      { ticks: 20, expected: 'intact' },
    ];
    for (const point of phasePoints) {
      const p = new MultiStageCrumblingPlatform(opts);
      p.onSteppedOn();
      for (let i = 0; i < point.ticks; i++) p.tick();
      const snap = p.toState();
      expect(p.getPhase()).toBe(point.expected);

      const fresh = new MultiStageCrumblingPlatform(opts);
      fresh.fromState(snap);
      expect(fresh.getPhase()).toBe(point.expected);
      expect(fresh.getFrame()).toBe(snap.frame);
      expect(fresh.getFramesUntilNextTransition()).toBe(
        p.getFramesUntilNextTransition(),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('MultiStageCrumblingPlatform — determinism', () => {
  it('two instances driven through identical inputs produce identical state every frame', () => {
    const opts: MultiStageCrumblingPlatformOptions = {
      ...baseOpts,
      shakeDuration: 11,
      crackDuration: 13,
      breakDuration: 17,
      fallDuration: 19,
      respawnDelay: 23,
    };
    const a = new MultiStageCrumblingPlatform(opts);
    const b = new MultiStageCrumblingPlatform(opts);

    const stepFrames = new Set([0, 200, 350]);
    for (let f = 0; f < 500; f++) {
      if (stepFrames.has(f)) {
        expect(a.onSteppedOn()).toBe(b.onSteppedOn());
      }
      expect(a.getPhase()).toBe(b.getPhase());
      expect(a.isSolid()).toBe(b.isSolid());
      expect(a.isFragile()).toBe(b.isFragile());
      expect(a.getFramesUntilNextTransition()).toBe(
        b.getFramesUntilNextTransition(),
      );

      const ra = a.getRenderState();
      const rb = b.getRenderState();
      expect(ra.alpha).toBe(rb.alpha);
      expect(ra.wobbleNorm).toBe(rb.wobbleNorm);
      expect(ra.crackLevel).toBe(rb.crackLevel);
      expect(ra.chunkLevel).toBe(rb.chunkLevel);
      expect(ra.dropOffset).toBe(rb.dropOffset);
      expect(ra.boundsScale).toBe(rb.boundsScale);
      expect(ra.fragile).toBe(rb.fragile);

      const ba = a.getEffectiveBounds();
      const bb = b.getEffectiveBounds();
      expect(ba === null).toBe(bb === null);
      if (ba && bb) {
        expect(ba.width).toBe(bb.width);
        expect(ba.height).toBe(bb.height);
        expect(ba.x).toBe(bb.x);
        expect(ba.y).toBe(bb.y);
      }

      a.tick();
      b.tick();
    }
  });

  it('phase trace from identical input is reproducible', () => {
    const opts: MultiStageCrumblingPlatformOptions = {
      ...baseOpts,
      shakeDuration: 6,
      crackDuration: 6,
      breakDuration: 6,
      fallDuration: 6,
      respawnDelay: 6,
    };
    const trace = (): string[] => {
      const p = new MultiStageCrumblingPlatform(opts);
      const out: string[] = [];
      p.onSteppedOn();
      for (let i = 0; i < 60; i++) {
        out.push(p.getPhase());
        p.tick();
      }
      return out;
    };
    expect(trace()).toEqual(trace());
  });
});
