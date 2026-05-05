import { describe, it, expect } from 'vitest';
import { GameLoop } from './GameLoop';
import { GAME_CONFIG } from './constants';

const FIXED = GAME_CONFIG.fixedTimestepMs; // 16.666… ms

describe('GameLoop — deterministic fixed-timestep accumulator', () => {
  it('uses 16.67ms (1/60s) as the default fixed step', () => {
    const loop = new GameLoop();
    expect(loop.fixedTimestepMs).toBeCloseTo(1000 / 60, 6);
  });

  it('runs zero update steps when delta is shorter than the fixed step', () => {
    const loop = new GameLoop();
    let updates = 0;
    let renders = 0;
    loop.tick(
      FIXED * 0.5,
      () => {
        updates += 1;
      },
      () => {
        renders += 1;
      },
    );
    expect(updates).toBe(0);
    // Render is decoupled — it always fires once per tick.
    expect(renders).toBe(1);
    // Alpha = leftover fraction in the accumulator.
    expect(loop.getAlpha()).toBeCloseTo(0.5, 5);
  });

  it('runs exactly one update step per fixed-step worth of delta', () => {
    const loop = new GameLoop();
    let updates = 0;
    loop.tick(FIXED, () => {
      updates += 1;
    });
    expect(updates).toBe(1);
    expect(loop.getFrame()).toBe(1);
    expect(loop.getAlpha()).toBeCloseTo(0, 5);
  });

  it('runs N update steps when delta covers N fixed steps', () => {
    const loop = new GameLoop();
    let updates = 0;
    loop.tick(FIXED * 4, () => {
      updates += 1;
    });
    expect(updates).toBe(4);
    expect(loop.getFrame()).toBe(4);
  });

  it('decouples render from update — render fires once per tick regardless of update count', () => {
    const loop = new GameLoop();
    let updates = 0;
    let renders = 0;
    // 10 ticks with random-ish deltas.
    const deltas = [5, 8, 20, 40, 60, 1, 17, 17, 17, 100];
    for (const d of deltas) {
      loop.tick(
        d,
        () => {
          updates += 1;
        },
        () => {
          renders += 1;
        },
      );
    }
    expect(renders).toBe(deltas.length);
    // Total simulated time should be ~ sum of deltas (minus residual accumulator),
    // and updates × FIXED should equal sum(deltas) − accumulator.
    const totalDelta = deltas.reduce((a, b) => a + b, 0);
    const simulated = updates * FIXED;
    expect(simulated + loop.getAccumulatorMs()).toBeCloseTo(totalDelta, 5);
  });

  it('produces identical frame counts for identical input sequences (determinism)', () => {
    const a = new GameLoop();
    const b = new GameLoop();
    const deltas = [16, 17, 16, 17, 100, 5, 60, 33];
    for (const d of deltas) {
      a.tick(d, () => undefined);
      b.tick(d, () => undefined);
    }
    expect(a.getFrame()).toBe(b.getFrame());
    expect(a.getAccumulatorMs()).toBe(b.getAccumulatorMs());
    expect(a.getAlpha()).toBe(b.getAlpha());
  });

  it('caps update steps to avoid spiral-of-death after a long pause', () => {
    const loop = new GameLoop({ maxStepsPerTick: 8 });
    let updates = 0;
    // Pretend the tab was backgrounded for 10 seconds.
    loop.tick(10_000, () => {
      updates += 1;
    });
    expect(updates).toBeLessThanOrEqual(8);
  });

  it('clamps negative or NaN deltas to zero rather than rewinding', () => {
    const loop = new GameLoop();
    loop.tick(-1000, () => {
      throw new Error('update should not run on negative delta');
    });
    loop.tick(Number.NaN, () => {
      throw new Error('update should not run on NaN delta');
    });
    expect(loop.getFrame()).toBe(0);
  });

  it('pause freezes simulation but still calls render', () => {
    const loop = new GameLoop();
    let updates = 0;
    let renders = 0;
    loop.pause();
    loop.tick(
      FIXED * 5,
      () => {
        updates += 1;
      },
      () => {
        renders += 1;
      },
    );
    expect(updates).toBe(0);
    expect(renders).toBe(1);
    expect(loop.getFrame()).toBe(0);
  });

  it('resume drops accumulated wall-clock slack so we do not fast-forward', () => {
    const loop = new GameLoop();
    loop.pause();
    loop.tick(FIXED * 100, () => undefined);
    loop.resume();
    let updates = 0;
    loop.tick(FIXED, () => {
      updates += 1;
    });
    // Should run exactly one step — the pre-pause backlog must be discarded.
    expect(updates).toBe(1);
  });

  it('reset() restores a clean state', () => {
    const loop = new GameLoop();
    loop.tick(FIXED * 3.5, () => undefined);
    expect(loop.getFrame()).toBeGreaterThan(0);
    loop.reset();
    expect(loop.getFrame()).toBe(0);
    expect(loop.getAccumulatorMs()).toBe(0);
    expect(loop.getAlpha()).toBe(0);
    expect(loop.isPaused()).toBe(false);
  });

  it('setFrame() seeks the loop (used by replay snapshot resync)', () => {
    const loop = new GameLoop();
    loop.setFrame(300);
    expect(loop.getFrame()).toBe(300);
    expect(loop.getAccumulatorMs()).toBe(0);
  });

  it('tickFromTimestamp produces zero updates on the first call (baseline)', () => {
    const loop = new GameLoop();
    let updates = 0;
    loop.tickFromTimestamp(1000, () => {
      updates += 1;
    });
    expect(updates).toBe(0);
    // Second call computes delta from the baseline.
    loop.tickFromTimestamp(1000 + FIXED * 3, () => {
      updates += 1;
    });
    expect(updates).toBe(3);
  });

  it('alpha is in [0, 1) after each tick', () => {
    const loop = new GameLoop();
    const deltas = [1, 5, 16, 16.6, 16.7, 17, 33, 100, 0.1];
    for (const d of deltas) {
      loop.tick(d, () => undefined);
      const a = loop.getAlpha();
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });
});
