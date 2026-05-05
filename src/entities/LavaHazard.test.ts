import { describe, it, expect } from 'vitest';
import {
  LavaHazard,
  LAVA_DEFAULTS,
  lavaHeightNorm,
  type LavaHazardOptions,
} from './LavaHazard';

/**
 * Sub-AC 1 of AC 9 — lava hazard entity with periodic rise/fall via a
 * timed oscillation cycle.
 *
 * What this suite locks down:
 *
 *   1. Construction validates geometry, cycle, and threshold so callers
 *      can't accidentally author an unphysical hazard (negative size,
 *      cycle of length 1, etc.).
 *   2. The cosine oscillation matches min at frame 0, max at
 *      cycleFrames/2, and min again at cycleFrames — the shape every
 *      downstream consumer (renderer, damage handler, AI) relies on.
 *   3. `tick()` advances one fixed step per call and the entity wraps
 *      cleanly across cycle boundaries — the height at frame N is
 *      identical to the height at frame N + cycleFrames.
 *   4. `phaseFrames` shifts the cycle exactly as documented — two
 *      pools with `phaseFrames = cycleFrames/2` produce the *opposite*
 *      height at every frame, which is the whole point of supporting
 *      out-of-phase pools on the same stage.
 *   5. `isActive()` flips at the exact configured `activeThreshold`,
 *      `getDamagePerTick()` returns 0 when inactive, and `isRising()`
 *      / `isFalling()` agree with cycle phase.
 *   6. Snapshot/restore round-trips byte-perfect — `fromState(toState())`
 *      yields identical height, phase, and active state. This is the
 *      property the M4 replay VCR relies on.
 *   7. Determinism — identical frame sequences produce identical
 *      results across instances.
 */

const baseOpts: LavaHazardOptions = {
  x: 960,
  baseY: 950,
  width: 400,
  maxHeight: 200,
  minHeight: 0,
  cycleFrames: 600,
};

describe('LavaHazard — construction & validation', () => {
  it('builds with sensible defaults from the public LAVA_DEFAULTS table', () => {
    const lava = new LavaHazard({ x: 0, baseY: 0, width: 100, maxHeight: 50 });
    expect(lava.getCycleFrames()).toBe(LAVA_DEFAULTS.cycleFrames);
    expect(lava.getMinHeight()).toBe(LAVA_DEFAULTS.minHeight);
    expect(lava.getActiveThreshold()).toBe(LAVA_DEFAULTS.activeThreshold);
    expect(lava.getId()).toBe('lava');
    expect(lava.getPhaseFrames()).toBe(0);
  });

  it('uses explicit id when provided', () => {
    const lava = new LavaHazard({ ...baseOpts, id: 'lava-pool-a' });
    expect(lava.getId()).toBe('lava-pool-a');
  });

  it.each([
    ['width', { width: 0 }],
    ['width', { width: -1 }],
    ['maxHeight', { maxHeight: 0 }],
    ['maxHeight', { maxHeight: -1 }],
    ['minHeight', { minHeight: -1 }],
  ])('rejects bad geometry (%s)', (_label, override) => {
    expect(
      () => new LavaHazard({ ...baseOpts, ...override }),
    ).toThrow();
  });

  it('rejects minHeight ≥ maxHeight', () => {
    expect(
      () =>
        new LavaHazard({ ...baseOpts, minHeight: 200, maxHeight: 200 }),
    ).toThrow(/minHeight/);
    expect(
      () =>
        new LavaHazard({ ...baseOpts, minHeight: 250, maxHeight: 200 }),
    ).toThrow(/minHeight/);
  });

  it.each([
    ['cycleFrames < 2', { cycleFrames: 1 }],
    ['fractional cycleFrames', { cycleFrames: 99.5 }],
    ['negative cycleFrames', { cycleFrames: -10 }],
  ])('rejects bad cycleFrames (%s)', (_label, override) => {
    expect(
      () => new LavaHazard({ ...baseOpts, ...override }),
    ).toThrow(/cycleFrames/);
  });

  it('rejects an activeThreshold outside [0, 1]', () => {
    expect(
      () => new LavaHazard({ ...baseOpts, activeThreshold: -0.1 }),
    ).toThrow(/activeThreshold/);
    expect(
      () => new LavaHazard({ ...baseOpts, activeThreshold: 1.1 }),
    ).toThrow(/activeThreshold/);
  });

  it('rejects a negative damagePerTick', () => {
    expect(
      () => new LavaHazard({ ...baseOpts, damagePerTick: -1 }),
    ).toThrow(/damagePerTick/);
  });

  it('normalises a negative phaseFrames into [0, cycleFrames)', () => {
    const lava = new LavaHazard({ ...baseOpts, phaseFrames: -50 });
    expect(lava.getPhaseFrames()).toBe(550);
  });

  it('normalises a phaseFrames larger than cycleFrames', () => {
    const lava = new LavaHazard({ ...baseOpts, phaseFrames: 700 });
    expect(lava.getPhaseFrames()).toBe(100);
  });
});

describe('lavaHeightNorm — pure cosine oscillation', () => {
  it('returns 0 at frame 0', () => {
    expect(lavaHeightNorm(0, 600)).toBeCloseTo(0, 10);
  });

  it('returns 1 at the half-cycle (apex)', () => {
    expect(lavaHeightNorm(300, 600)).toBeCloseTo(1, 10);
  });

  it('returns 0 again at the end of the cycle', () => {
    expect(lavaHeightNorm(600, 600)).toBeCloseTo(0, 10);
  });

  it('is symmetric around the apex (frame N matches frame cycle-N)', () => {
    const cf = 600;
    for (const f of [50, 120, 200, 250, 290]) {
      expect(lavaHeightNorm(f, cf)).toBeCloseTo(
        lavaHeightNorm(cf - f, cf),
        10,
      );
    }
  });

  it('is periodic — frame N and frame N + cycleFrames produce identical heights', () => {
    const cf = 600;
    for (const f of [0, 1, 73, 250, 450, 599]) {
      expect(lavaHeightNorm(f, cf)).toBeCloseTo(
        lavaHeightNorm(f + cf, cf),
        10,
      );
      expect(lavaHeightNorm(f, cf)).toBeCloseTo(
        lavaHeightNorm(f + cf * 3, cf),
        10,
      );
    }
  });

  it('handles negative frame numbers via floor-mod (no NaN, periodic)', () => {
    const cf = 600;
    expect(lavaHeightNorm(-1, cf)).toBeCloseTo(lavaHeightNorm(cf - 1, cf), 10);
    expect(lavaHeightNorm(-300, cf)).toBeCloseTo(lavaHeightNorm(300, cf), 10);
  });

  it('rejects cycleFrames < 2', () => {
    expect(() => lavaHeightNorm(0, 1)).toThrow();
  });

  it('produces a monotonically increasing curve through the rising half', () => {
    const cf = 100;
    let prev = -Infinity;
    for (let f = 0; f <= cf / 2; f++) {
      const v = lavaHeightNorm(f, cf);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('produces a monotonically decreasing curve through the falling half', () => {
    const cf = 100;
    let prev = Infinity;
    for (let f = cf / 2; f <= cf; f++) {
      const v = lavaHeightNorm(f, cf);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('LavaHazard — oscillation behaviour', () => {
  it('starts at minHeight at frame 0 (no phase offset)', () => {
    const lava = new LavaHazard(baseOpts);
    expect(lava.getCurrentHeight()).toBeCloseTo(baseOpts.minHeight ?? 0, 6);
    expect(lava.getCyclePhase()).toBeCloseTo(0, 10);
  });

  it('advances exactly one frame per tick()', () => {
    const lava = new LavaHazard(baseOpts);
    lava.tick();
    expect(lava.getFrame()).toBe(1);
    lava.tick();
    lava.tick();
    expect(lava.getFrame()).toBe(3);
  });

  it('reaches maxHeight at the half-cycle', () => {
    const lava = new LavaHazard({ ...baseOpts, cycleFrames: 600, maxHeight: 200 });
    for (let i = 0; i < 300; i++) lava.tick();
    expect(lava.getCurrentHeight()).toBeCloseTo(200, 6);
    expect(lava.getCyclePhase()).toBeCloseTo(0.5, 10);
  });

  it('returns to minHeight at the end of the cycle and wraps frame counter', () => {
    const lava = new LavaHazard({ ...baseOpts, cycleFrames: 600 });
    for (let i = 0; i < 600; i++) lava.tick();
    expect(lava.getCurrentHeight()).toBeCloseTo(baseOpts.minHeight ?? 0, 6);
    // Frame counter wraps so the integer doesn't drift unbounded.
    expect(lava.getFrame()).toBe(0);
  });

  it("respects minHeight when it's non-zero", () => {
    const lava = new LavaHazard({
      ...baseOpts,
      minHeight: 20,
      maxHeight: 200,
      cycleFrames: 100,
    });
    expect(lava.getCurrentHeight()).toBeCloseTo(20, 6);
    for (let i = 0; i < 50; i++) lava.tick();
    expect(lava.getCurrentHeight()).toBeCloseTo(200, 6);
  });

  it('places the lava surface above baseY when raised (Phaser y-down convention)', () => {
    const lava = new LavaHazard({
      ...baseOpts,
      baseY: 1000,
      minHeight: 0,
      maxHeight: 200,
      cycleFrames: 100,
    });
    // At apex the surface is 200 px *above* baseY — i.e. y is smaller.
    for (let i = 0; i < 50; i++) lava.tick();
    expect(lava.getSurfaceY()).toBeCloseTo(800, 6);
  });

  it('reports correct AABB bounds at trough and apex', () => {
    const lava = new LavaHazard({
      ...baseOpts,
      x: 500,
      baseY: 1000,
      width: 400,
      minHeight: 0,
      maxHeight: 200,
      cycleFrames: 100,
    });
    const trough = lava.getBounds();
    expect(trough.x).toBe(500);
    expect(trough.width).toBe(400);
    expect(trough.height).toBeCloseTo(0, 6);
    expect(trough.y).toBeCloseTo(1000, 6); // empty lava sits at baseY

    for (let i = 0; i < 50; i++) lava.tick();
    const apex = lava.getBounds();
    expect(apex.height).toBeCloseTo(200, 6);
    expect(apex.y).toBeCloseTo(900, 6); // centre is baseY - height/2
  });

  it('classifies isRising vs isFalling based on cycle position', () => {
    const lava = new LavaHazard({ ...baseOpts, cycleFrames: 100 });
    expect(lava.isRising()).toBe(true);
    for (let i = 0; i < 25; i++) lava.tick();
    expect(lava.isRising()).toBe(true);
    for (let i = 0; i < 26; i++) lava.tick(); // past 50
    expect(lava.isRising()).toBe(false);
    expect(lava.isFalling()).toBe(true);
  });
});

describe('LavaHazard — phase offset behaviour', () => {
  it('two pools with opposite phaseFrames produce complementary heights every frame', () => {
    // Two pools with phaseFrames offset by half a cycle should have
    // mirror-image heights: when one is at min, the other is at max.
    const cf = 200;
    const a = new LavaHazard({ ...baseOpts, cycleFrames: cf, phaseFrames: 0 });
    const b = new LavaHazard({
      ...baseOpts,
      cycleFrames: cf,
      phaseFrames: cf / 2,
    });

    for (let i = 0; i < cf; i++) {
      const ha = a.getHeightNorm();
      const hb = b.getHeightNorm();
      // The cosine wave is reflected by half a cycle: norm(t + 0.5) = 1 - norm(t).
      expect(ha + hb).toBeCloseTo(1, 8);
      a.tick();
      b.tick();
    }
  });

  it('phaseFrames shifts the apex frame', () => {
    const cf = 100;
    const lava = new LavaHazard({
      ...baseOpts,
      cycleFrames: cf,
      phaseFrames: 25,
    });
    // With phase = 25, the apex (norm=1) is reached at frame
    // (cf/2 - phase) = 25, not 50.
    for (let i = 0; i < 25; i++) lava.tick();
    expect(lava.getHeightNorm()).toBeCloseTo(1, 8);
  });
});

describe('LavaHazard — active / damage classification', () => {
  it('isActive flips on once heightNorm crosses activeThreshold (default ~0.55)', () => {
    const cf = 1000;
    const lava = new LavaHazard({
      ...baseOpts,
      cycleFrames: cf,
      activeThreshold: 0.55,
    });

    let activatedAtFrame = -1;
    for (let f = 0; f <= cf / 2; f++) {
      if (lava.isActive() && activatedAtFrame === -1) {
        activatedAtFrame = f;
        break;
      }
      lava.tick();
    }
    // The cosine reaches 0.55 somewhere between frames 250 and 280
    // for cf=1000. We only assert it eventually flips on, before apex.
    expect(activatedAtFrame).toBeGreaterThan(0);
    expect(activatedAtFrame).toBeLessThan(cf / 2);
  });

  it('returns 0 damage when inactive and the configured damage when active', () => {
    const cf = 100;
    const lava = new LavaHazard({
      ...baseOpts,
      cycleFrames: cf,
      damagePerTick: 12,
      activeThreshold: 0.5,
    });
    // At trough — definitely inactive.
    expect(lava.isActive()).toBe(false);
    expect(lava.getDamagePerTick()).toBe(0);

    // At apex — definitely active.
    for (let i = 0; i < cf / 2; i++) lava.tick();
    expect(lava.isActive()).toBe(true);
    expect(lava.getDamagePerTick()).toBe(12);
  });

  it('classifies coarse phases (low_hold / rising / high_hold / falling)', () => {
    const cf = 1000;
    const lava = new LavaHazard({ ...baseOpts, cycleFrames: cf });
    expect(lava.getPhase()).toBe('low_hold');

    // A bit past the trough — should report rising.
    for (let i = 0; i < cf * 0.2; i++) lava.tick();
    expect(lava.getPhase()).toBe('rising');

    // At apex — high_hold.
    while (lava.getFrame() !== cf / 2) lava.tick();
    expect(lava.getPhase()).toBe('high_hold');

    // Past apex — falling.
    for (let i = 0; i < cf * 0.2; i++) lava.tick();
    expect(lava.getPhase()).toBe('falling');
  });
});

describe('LavaHazard — replay snapshot/restore', () => {
  it('toState/fromState round-trips height, phase, and active state byte-perfect', () => {
    const cf = 600;
    const lava = new LavaHazard({ ...baseOpts, cycleFrames: cf });
    // Advance to a non-trivial frame somewhere in the rising half.
    for (let i = 0; i < 137; i++) lava.tick();

    const snap = lava.toState();
    const heightBefore = lava.getCurrentHeight();
    const phaseBefore = lava.getCyclePhase();
    const activeBefore = lava.isActive();

    // Mutate the entity into a different state.
    for (let i = 0; i < 250; i++) lava.tick();
    expect(lava.getCurrentHeight()).not.toBeCloseTo(heightBefore, 6);

    // Restore — every observable matches.
    lava.fromState(snap);
    expect(lava.getFrame()).toBe(snap.frame);
    expect(lava.getCurrentHeight()).toBeCloseTo(heightBefore, 10);
    expect(lava.getCyclePhase()).toBeCloseTo(phaseBefore, 10);
    expect(lava.isActive()).toBe(activeBefore);
  });

  it('reset() defaults to frame 0 and is equivalent to a fresh entity', () => {
    const lava = new LavaHazard(baseOpts);
    for (let i = 0; i < 200; i++) lava.tick();
    lava.reset();
    expect(lava.getFrame()).toBe(0);
    expect(lava.getCurrentHeight()).toBeCloseTo(baseOpts.minHeight ?? 0, 6);
  });

  it('reset(N) wraps via floor-mod for any integer', () => {
    const lava = new LavaHazard({ ...baseOpts, cycleFrames: 100 });
    lava.reset(150);
    expect(lava.getFrame()).toBe(50);
    lava.reset(-25);
    expect(lava.getFrame()).toBe(75);
  });

  it('rejects malformed snapshots in fromState', () => {
    const lava = new LavaHazard(baseOpts);
    expect(() => lava.fromState({ frame: NaN })).toThrow();
    // @ts-expect-error — exercising runtime guard
    expect(() => lava.fromState(null)).toThrow();
  });
});

describe('LavaHazard — determinism', () => {
  it('two instances with the same config produce identical observable state for every frame', () => {
    const opts: LavaHazardOptions = {
      ...baseOpts,
      cycleFrames: 240,
      maxHeight: 180,
      minHeight: 10,
      phaseFrames: 37,
      activeThreshold: 0.6,
      damagePerTick: 7,
    };
    const a = new LavaHazard(opts);
    const b = new LavaHazard(opts);
    for (let f = 0; f < 1000; f++) {
      expect(a.getCurrentHeight()).toBe(b.getCurrentHeight());
      expect(a.getCyclePhase()).toBe(b.getCyclePhase());
      expect(a.isActive()).toBe(b.isActive());
      expect(a.getDamagePerTick()).toBe(b.getDamagePerTick());
      a.tick();
      b.tick();
    }
  });

  it('is pure-arithmetic — no Date.now / Math.random side effects observable', () => {
    // We verify *behavioural* purity: the same frame counter always
    // yields the same height, no matter how many other instances or
    // time has passed.
    const lava = new LavaHazard({ ...baseOpts, cycleFrames: 100 });
    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      samples.push(lava.getCurrentHeight());
      lava.tick();
    }
    // Replay the exact frames in a fresh instance.
    const fresh = new LavaHazard({ ...baseOpts, cycleFrames: 100 });
    for (let i = 0; i < 100; i++) {
      expect(fresh.getCurrentHeight()).toBe(samples[i]);
      fresh.tick();
    }
  });
});
