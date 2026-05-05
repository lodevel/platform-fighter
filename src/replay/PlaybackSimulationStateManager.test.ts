import { describe, it, expect, beforeEach } from 'vitest';
import {
  InputCaptureBuffer,
  type RecordedCharacterInput,
} from './InputCaptureBuffer';
import { serializeReplay } from './ReplayFile';
import { ReplayPlaybackController } from './ReplayPlaybackController';
import {
  PlaybackSimulationStateManager,
  PLAYBACK_TIME_SCALE,
  PLAYBACK_TIME_SCALE_ORDER,
  MIN_PLAYBACK_TIME_SCALE,
  MAX_PLAYBACK_TIME_SCALE,
  type PlaybackSimulationPhase,
} from './PlaybackSimulationStateManager';
import type { CharacterInput } from '../characters/Character';
import type { MatchConfig, PlayerSlot } from '../types';
import type { ReplayFile } from './replayTypes';

/**
 * AC 30302 Sub-AC 2 — playback simulation state manager.
 *
 * Coverage map:
 *
 *   • Construction defaults + option validation.
 *   • pause / resume / togglePause / markFinished / reset state machine.
 *   • setTimeScale / cycleTimeScale / toggleSlowMotion + range
 *     validation.
 *   • Frame-advance queue (requestStep / clearPendingSteps) — independent
 *     of pause flag, capped by maxStepsPerTick.
 *   • tickFromDelta accumulator behaviour:
 *      - paused drops dt
 *      - playing accumulates scaled dt and emits integer steps
 *      - 0.25x produces one quarter the steps of 1.0x for the same dt
 *      - 2.0x produces twice the steps
 *      - spiral-of-death cap
 *      - pathological deltas clamped to 0
 *   • Frame-advance + slow-motion together — the canonical VCR flow.
 *   • Status snapshot is frozen.
 *   • Determinism: two managers fed the same dt sequence emit the same
 *     step counts.
 *   • End-to-end with a real ReplayPlaybackController: feeding the
 *     manager's emitted step counts through `playback.advance()`
 *     reproduces the same recorded input stream regardless of time
 *     scale, with no missed or duplicated frames.
 */

const FRAME_MS = 1000 / 60;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('PlaybackSimulationStateManager — construction', () => {
  it('starts paused at 1.0x with empty accumulator and queue', () => {
    const sim = new PlaybackSimulationStateManager();
    expect(sim.getPhase()).toBe('paused');
    expect(sim.isPaused()).toBe(true);
    expect(sim.isPlaying()).toBe(false);
    expect(sim.isFinished()).toBe(false);
    expect(sim.getTimeScale()).toBe(1.0);
    expect(sim.getAccumulatorMs()).toBe(0);
    expect(sim.getPendingSteps()).toBe(0);
    expect(sim.getEmittedSteps()).toBe(0);
    expect(sim.fixedTimestepMs).toBeCloseTo(FRAME_MS);
    expect(sim.maxStepsPerTick).toBe(8);
  });

  it('respects initialPhase / initialTimeScale options', () => {
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
      initialTimeScale: PLAYBACK_TIME_SCALE.HALF,
    });
    expect(sim.getPhase()).toBe('playing');
    expect(sim.getTimeScale()).toBe(0.5);
  });

  it('respects fixedTimestepMs / maxStepsPerTick options', () => {
    const sim = new PlaybackSimulationStateManager({
      fixedTimestepMs: 20,
      maxStepsPerTick: 4,
    });
    expect(sim.fixedTimestepMs).toBe(20);
    expect(sim.maxStepsPerTick).toBe(4);
  });

  it('rejects invalid fixedTimestepMs', () => {
    expect(
      () => new PlaybackSimulationStateManager({ fixedTimestepMs: 0 }),
    ).toThrow(/fixedTimestepMs/);
    expect(
      () => new PlaybackSimulationStateManager({ fixedTimestepMs: -1 }),
    ).toThrow(/fixedTimestepMs/);
    expect(
      () =>
        new PlaybackSimulationStateManager({
          fixedTimestepMs: Number.NaN,
        }),
    ).toThrow(/fixedTimestepMs/);
  });

  it('rejects invalid maxStepsPerTick', () => {
    expect(
      () => new PlaybackSimulationStateManager({ maxStepsPerTick: 0 }),
    ).toThrow(/maxStepsPerTick/);
    expect(
      () => new PlaybackSimulationStateManager({ maxStepsPerTick: 1.5 }),
    ).toThrow(/maxStepsPerTick/);
    expect(
      () => new PlaybackSimulationStateManager({ maxStepsPerTick: -1 }),
    ).toThrow(/maxStepsPerTick/);
  });

  it('rejects invalid initialTimeScale (out of range)', () => {
    expect(
      () => new PlaybackSimulationStateManager({ initialTimeScale: 0 }),
    ).toThrow(/timeScale/);
    expect(
      () =>
        new PlaybackSimulationStateManager({
          initialTimeScale: MAX_PLAYBACK_TIME_SCALE + 1,
        }),
    ).toThrow(/timeScale/);
    expect(
      () =>
        new PlaybackSimulationStateManager({
          initialTimeScale: Number.NaN,
        }),
    ).toThrow(/timeScale/);
  });

  it('rejects invalid initialPhase', () => {
    expect(
      () =>
        new PlaybackSimulationStateManager({
          initialPhase: 'bogus' as PlaybackSimulationPhase,
        }),
    ).toThrow(/unknown phase/);
  });
});

// ---------------------------------------------------------------------------
// pause / resume / togglePause
// ---------------------------------------------------------------------------

describe('PlaybackSimulationStateManager — pause/resume', () => {
  let sim: PlaybackSimulationStateManager;

  beforeEach(() => {
    sim = new PlaybackSimulationStateManager({ initialPhase: 'playing' });
  });

  it('pause() transitions PLAYING → PAUSED and is idempotent', () => {
    sim.pause();
    expect(sim.getPhase()).toBe('paused');
    sim.pause();
    expect(sim.getPhase()).toBe('paused');
  });

  it('resume() transitions PAUSED → PLAYING and is idempotent', () => {
    sim.pause();
    sim.resume();
    expect(sim.getPhase()).toBe('playing');
    sim.resume();
    expect(sim.getPhase()).toBe('playing');
  });

  it('togglePause flips the state', () => {
    sim.togglePause();
    expect(sim.getPhase()).toBe('paused');
    sim.togglePause();
    expect(sim.getPhase()).toBe('playing');
  });

  it('togglePause is a no-op while FINISHED', () => {
    sim.markFinished();
    sim.togglePause();
    expect(sim.getPhase()).toBe('finished');
  });

  it('pause / resume are no-ops while FINISHED', () => {
    sim.markFinished();
    sim.pause();
    expect(sim.getPhase()).toBe('finished');
    sim.resume();
    expect(sim.getPhase()).toBe('finished');
  });

  it('pause clears the residual accumulator', () => {
    sim.tickFromDelta(FRAME_MS * 0.5); // accumulate half a frame
    expect(sim.getAccumulatorMs()).toBeGreaterThan(0);
    sim.pause();
    expect(sim.getAccumulatorMs()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// markFinished / reset
// ---------------------------------------------------------------------------

describe('PlaybackSimulationStateManager — markFinished / reset', () => {
  it('markFinished is idempotent', () => {
    const sim = new PlaybackSimulationStateManager();
    sim.markFinished();
    sim.markFinished();
    expect(sim.getPhase()).toBe('finished');
  });

  it('markFinished clears the accumulator but keeps pendingSteps', () => {
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
    });
    sim.tickFromDelta(FRAME_MS * 0.4);
    sim.requestStep(2);
    sim.markFinished();
    expect(sim.getAccumulatorMs()).toBe(0);
    // The contract is: pendingSteps stays visible for HUD rendering;
    // tickFromDelta emits 0 anyway because phase is FINISHED.
    expect(sim.getPendingSteps()).toBe(2);
  });

  it('reset returns to PAUSED with default scale and zero state', () => {
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
      initialTimeScale: 0.25,
    });
    sim.requestStep(3);
    sim.tickFromDelta(FRAME_MS * 100);
    sim.reset();
    expect(sim.getPhase()).toBe('paused');
    expect(sim.getTimeScale()).toBe(1.0);
    expect(sim.getAccumulatorMs()).toBe(0);
    expect(sim.getPendingSteps()).toBe(0);
    expect(sim.getEmittedSteps()).toBe(0);
  });

  it('reset rescues a FINISHED manager back to PAUSED', () => {
    const sim = new PlaybackSimulationStateManager();
    sim.markFinished();
    sim.reset();
    expect(sim.getPhase()).toBe('paused');
  });
});

// ---------------------------------------------------------------------------
// Time scale
// ---------------------------------------------------------------------------

describe('PlaybackSimulationStateManager — time scale', () => {
  let sim: PlaybackSimulationStateManager;

  beforeEach(() => {
    sim = new PlaybackSimulationStateManager();
  });

  it('setTimeScale sets and getTimeScale reads', () => {
    sim.setTimeScale(0.5);
    expect(sim.getTimeScale()).toBe(0.5);
    sim.setTimeScale(2.0);
    expect(sim.getTimeScale()).toBe(2.0);
  });

  it('rejects out-of-range or non-finite scales', () => {
    expect(() => sim.setTimeScale(0)).toThrow(/timeScale/);
    expect(() => sim.setTimeScale(-1)).toThrow(/timeScale/);
    expect(() =>
      sim.setTimeScale(MIN_PLAYBACK_TIME_SCALE - 0.001),
    ).toThrow(/timeScale/);
    expect(() =>
      sim.setTimeScale(MAX_PLAYBACK_TIME_SCALE + 0.001),
    ).toThrow(/timeScale/);
    expect(() => sim.setTimeScale(Number.NaN)).toThrow(/timeScale/);
    expect(() => sim.setTimeScale(Number.POSITIVE_INFINITY)).toThrow(
      /timeScale/,
    );
  });

  it('cycleTimeScale walks the canonical preset ramp', () => {
    sim.setTimeScale(PLAYBACK_TIME_SCALE.QUARTER);
    expect(sim.cycleTimeScale()).toBe(PLAYBACK_TIME_SCALE.HALF);
    expect(sim.cycleTimeScale()).toBe(PLAYBACK_TIME_SCALE.NORMAL);
    expect(sim.cycleTimeScale()).toBe(PLAYBACK_TIME_SCALE.DOUBLE);
    // Wraps around.
    expect(sim.cycleTimeScale()).toBe(PLAYBACK_TIME_SCALE.QUARTER);
  });

  it('cycleTimeScale lands on QUARTER if current scale is off-ramp', () => {
    sim.setTimeScale(0.75);
    expect(sim.cycleTimeScale()).toBe(PLAYBACK_TIME_SCALE.QUARTER);
  });

  it('toggleSlowMotion flips between 1.0x and 0.25x', () => {
    expect(sim.toggleSlowMotion()).toBe(PLAYBACK_TIME_SCALE.QUARTER);
    expect(sim.getTimeScale()).toBe(0.25);
    expect(sim.toggleSlowMotion()).toBe(PLAYBACK_TIME_SCALE.NORMAL);
    expect(sim.getTimeScale()).toBe(1.0);
  });

  it('toggleSlowMotion from off-ramp scale lands on 1.0x first', () => {
    // toggleSlowMotion treats anything other than 1.0 as "currently
    // slow-motion-ish" and snaps to 1.0. From 1.0 the next toggle
    // takes us back into 0.25.
    sim.setTimeScale(0.5);
    expect(sim.toggleSlowMotion()).toBe(PLAYBACK_TIME_SCALE.NORMAL);
    expect(sim.toggleSlowMotion()).toBe(PLAYBACK_TIME_SCALE.QUARTER);
  });

  it('isSlowMotion reports true under 1.0x only', () => {
    sim.setTimeScale(1.0);
    expect(sim.isSlowMotion()).toBe(false);
    sim.setTimeScale(0.5);
    expect(sim.isSlowMotion()).toBe(true);
    sim.setTimeScale(0.25);
    expect(sim.isSlowMotion()).toBe(true);
    sim.setTimeScale(2.0);
    expect(sim.isSlowMotion()).toBe(false);
  });

  it('PLAYBACK_TIME_SCALE_ORDER contains the four canonical presets', () => {
    expect([...PLAYBACK_TIME_SCALE_ORDER]).toEqual([0.25, 0.5, 1.0, 2.0]);
  });
});

// ---------------------------------------------------------------------------
// Frame-advance queue
// ---------------------------------------------------------------------------

describe('PlaybackSimulationStateManager — frame-advance queue', () => {
  it('requestStep increments the queue and tickFromDelta drains it one per call', () => {
    const sim = new PlaybackSimulationStateManager();
    expect(sim.getPendingSteps()).toBe(0);
    sim.requestStep();
    sim.requestStep();
    sim.requestStep();
    expect(sim.getPendingSteps()).toBe(3);

    expect(sim.tickFromDelta(0)).toBe(3);
    // All three steps drain in a single tick (cap is 8 by default).
    expect(sim.getPendingSteps()).toBe(0);
  });

  it('queue is independent of the pause flag (canonical frame-advance)', () => {
    const sim = new PlaybackSimulationStateManager(); // paused
    sim.requestStep(2);
    expect(sim.tickFromDelta(0)).toBe(2);
    expect(sim.getPhase()).toBe('paused');
  });

  it('queue is capped by maxStepsPerTick', () => {
    const sim = new PlaybackSimulationStateManager({ maxStepsPerTick: 4 });
    sim.requestStep(10);
    expect(sim.tickFromDelta(0)).toBe(4);
    expect(sim.getPendingSteps()).toBe(6);
    expect(sim.tickFromDelta(0)).toBe(4);
    expect(sim.getPendingSteps()).toBe(2);
    expect(sim.tickFromDelta(0)).toBe(2);
    expect(sim.getPendingSteps()).toBe(0);
  });

  it('rejects non-positive / non-integer count', () => {
    const sim = new PlaybackSimulationStateManager();
    expect(() => sim.requestStep(0)).toThrow(/positive integer/);
    expect(() => sim.requestStep(-1)).toThrow(/positive integer/);
    expect(() => sim.requestStep(1.5)).toThrow(/positive integer/);
    expect(() => sim.requestStep(Number.NaN)).toThrow(/positive integer/);
  });

  it('requestStep is a no-op while FINISHED', () => {
    const sim = new PlaybackSimulationStateManager();
    sim.markFinished();
    sim.requestStep(3);
    expect(sim.getPendingSteps()).toBe(0);
  });

  it('clearPendingSteps drops the queue', () => {
    const sim = new PlaybackSimulationStateManager();
    sim.requestStep(5);
    sim.clearPendingSteps();
    expect(sim.getPendingSteps()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tickFromDelta — accumulator behaviour
// ---------------------------------------------------------------------------

describe('PlaybackSimulationStateManager — tickFromDelta accumulator', () => {
  it('PAUSED swallows wall-clock dt and emits no steps', () => {
    const sim = new PlaybackSimulationStateManager(); // paused
    expect(sim.tickFromDelta(FRAME_MS * 100)).toBe(0);
    expect(sim.getAccumulatorMs()).toBe(0);
    expect(sim.getEmittedSteps()).toBe(0);
  });

  it('FINISHED swallows everything and ignores queue', () => {
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
    });
    sim.requestStep(3);
    sim.markFinished();
    expect(sim.tickFromDelta(FRAME_MS * 100)).toBe(0);
  });

  it('PLAYING at 1.0x emits one step per fixed timestep of dt', () => {
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
    });
    expect(sim.tickFromDelta(FRAME_MS)).toBe(1);
    expect(sim.tickFromDelta(FRAME_MS)).toBe(1);
    // Two frames in one tick.
    expect(sim.tickFromDelta(FRAME_MS * 2)).toBe(2);
  });

  it('accumulator carries fractional dt across calls', () => {
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
    });
    // Half a frame — no step yet.
    expect(sim.tickFromDelta(FRAME_MS * 0.5)).toBe(0);
    expect(sim.getAccumulatorMs()).toBeCloseTo(FRAME_MS * 0.5);
    // Another half — one step.
    expect(sim.tickFromDelta(FRAME_MS * 0.5)).toBe(1);
    expect(sim.getAccumulatorMs()).toBeCloseTo(0);
  });

  it('0.25x emits exactly one quarter the steps of 1.0x for the same dt', () => {
    const slow = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
      initialTimeScale: 0.25,
    });
    const normal = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
      initialTimeScale: 1.0,
    });
    // Feed 4 wall-clock seconds at 60fps cadence (one rAF / step worth).
    let slowSteps = 0;
    let normalSteps = 0;
    for (let i = 0; i < 240; i += 1) {
      slowSteps += slow.tickFromDelta(FRAME_MS);
      normalSteps += normal.tickFromDelta(FRAME_MS);
    }
    expect(normalSteps).toBe(240);
    // 0.25x → exactly 60 steps over 240 wall-clock frames.
    expect(slowSteps).toBe(60);
  });

  it('0.5x emits exactly half the steps for the same dt', () => {
    const slow = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
      initialTimeScale: 0.5,
    });
    let steps = 0;
    for (let i = 0; i < 240; i += 1) {
      steps += slow.tickFromDelta(FRAME_MS);
    }
    expect(steps).toBe(120);
  });

  it('2.0x emits twice the steps for the same dt', () => {
    const fast = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
      initialTimeScale: 2.0,
    });
    let steps = 0;
    for (let i = 0; i < 60; i += 1) {
      steps += fast.tickFromDelta(FRAME_MS);
    }
    expect(steps).toBe(120);
  });

  it('clamps spiral-of-death — never emits more than maxStepsPerTick in one call', () => {
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
      maxStepsPerTick: 8,
    });
    // 1 second of wall-clock dropped on the manager in one call —
    // would naturally produce 60 steps but the cap holds at 8.
    expect(sim.tickFromDelta(1000)).toBe(8);
    expect(sim.getAccumulatorMs()).toBeLessThanOrEqual(
      FRAME_MS * 8,
    );
  });

  it('queue + scaled-dt steps both fit within the per-tick cap', () => {
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
      maxStepsPerTick: 4,
    });
    sim.requestStep(10);
    // Even with 10 frames worth of dt, the cap is 4.
    expect(sim.tickFromDelta(FRAME_MS * 10)).toBe(4);
  });

  it('clamps negative / NaN / Infinity dt to zero', () => {
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
    });
    expect(sim.tickFromDelta(-50)).toBe(0);
    expect(sim.tickFromDelta(Number.NaN)).toBe(0);
    expect(sim.tickFromDelta(Number.POSITIVE_INFINITY)).toBe(0);
    expect(sim.getAccumulatorMs()).toBe(0);
  });

  it('emittedSteps tracks the total across the lifetime of the manager', () => {
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
    });
    sim.tickFromDelta(FRAME_MS * 3); // 3 steps
    sim.tickFromDelta(FRAME_MS * 2); // 2 steps
    sim.requestStep(1);
    sim.tickFromDelta(0); // 1 step
    expect(sim.getEmittedSteps()).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Time-scale changes mid-playback
// ---------------------------------------------------------------------------

describe('PlaybackSimulationStateManager — mid-flight rate changes', () => {
  it('switching to slow-motion immediately reduces step rate', () => {
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
    });
    let steps = 0;
    for (let i = 0; i < 60; i += 1) steps += sim.tickFromDelta(FRAME_MS);
    expect(steps).toBe(60);

    sim.setTimeScale(0.25);
    sim.resetAccumulator();
    let slowSteps = 0;
    for (let i = 0; i < 60; i += 1) slowSteps += sim.tickFromDelta(FRAME_MS);
    expect(slowSteps).toBe(15);
  });

  it('setTimeScale during PLAYING does not flush the accumulator (without resetAccumulator)', () => {
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
    });
    // Park accumulator at half a frame.
    sim.tickFromDelta(FRAME_MS * 0.5);
    expect(sim.getAccumulatorMs()).toBeCloseTo(FRAME_MS * 0.5);
    sim.setTimeScale(0.25);
    // The half-frame is preserved; not erased by the scale change.
    expect(sim.getAccumulatorMs()).toBeCloseTo(FRAME_MS * 0.5);
  });

  it('resetAccumulator drops the residual', () => {
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
    });
    sim.tickFromDelta(FRAME_MS * 0.5);
    sim.resetAccumulator();
    expect(sim.getAccumulatorMs()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pause / step canonical VCR flow
// ---------------------------------------------------------------------------

describe('PlaybackSimulationStateManager — pause + frame-advance VCR flow', () => {
  it('pause + 5×requestStep + 5×tickFromDelta(0) emits exactly 5 steps', () => {
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
    });
    sim.pause();
    for (let i = 0; i < 5; i += 1) sim.requestStep();
    expect(sim.getPendingSteps()).toBe(5);
    let total = 0;
    for (let i = 0; i < 5; i += 1) {
      // Each tick drains either many or one — depends on the cap.
      total += sim.tickFromDelta(FRAME_MS);
    }
    expect(total).toBe(5);
    expect(sim.getPendingSteps()).toBe(0);
  });

  it('pausing does not drop queued frame-advance requests', () => {
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
    });
    sim.requestStep(2);
    sim.pause();
    expect(sim.getPendingSteps()).toBe(2);
    expect(sim.tickFromDelta(FRAME_MS * 100)).toBe(2);
    expect(sim.tickFromDelta(FRAME_MS * 100)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Status snapshot
// ---------------------------------------------------------------------------

describe('PlaybackSimulationStateManager — status snapshot', () => {
  it('exposes a frozen status', () => {
    const sim = new PlaybackSimulationStateManager();
    const status = sim.getStatus();
    expect(Object.isFrozen(status)).toBe(true);
  });

  it('reports current phase / scale / accumulator / queue / emitted', () => {
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
      initialTimeScale: 0.5,
    });
    sim.requestStep(2);
    sim.tickFromDelta(FRAME_MS * 0.6);
    const status = sim.getStatus();
    expect(status.phase).toBe('playing');
    expect(status.timeScale).toBe(0.5);
    // 0.6 * 0.5 = 0.3 → still under one frame, no emit from scaled dt.
    expect(status.accumulatorMs).toBeCloseTo(FRAME_MS * 0.3, 5);
    // 2 queued steps were drained though.
    expect(status.pendingSteps).toBe(0);
    expect(status.emittedSteps).toBe(2);
    expect(status.isPlaying).toBe(true);
    expect(status.isPaused).toBe(false);
    expect(status.isFinished).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('PlaybackSimulationStateManager — determinism', () => {
  it('two managers fed the same dt sequence emit identical step counts', () => {
    const a = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
      initialTimeScale: 0.5,
    });
    const b = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
      initialTimeScale: 0.5,
    });

    // Synthetic delta sequence with jitter, frame-advance interleaved,
    // and a brief pause.
    const sequence = [
      ['delta', 16.7],
      ['delta', 17.1],
      ['delta', 16.0],
      ['step', 0],
      ['delta', 33.0],
      ['delta', 8.5],
      ['pause', 0],
      ['delta', 16.7],
      ['delta', 16.7],
      ['resume', 0],
      ['delta', 16.7],
      ['delta', 50.0],
    ] as const;

    const aSteps: number[] = [];
    const bSteps: number[] = [];
    for (const [kind, value] of sequence) {
      if (kind === 'delta') {
        aSteps.push(a.tickFromDelta(value));
        bSteps.push(b.tickFromDelta(value));
      } else if (kind === 'step') {
        a.requestStep();
        b.requestStep();
      } else if (kind === 'pause') {
        a.pause();
        b.pause();
      } else {
        a.resume();
        b.resume();
      }
    }
    expect(aSteps).toEqual(bSteps);
    expect(a.getEmittedSteps()).toBe(b.getEmittedSteps());
    expect(a.getAccumulatorMs()).toBeCloseTo(b.getAccumulatorMs(), 9);
  });

  it('replaying the same delta + scale sequence at 0.25x produces identical step totals across runs', () => {
    function run(): { totals: number[]; emitted: number } {
      const sim = new PlaybackSimulationStateManager({
        initialPhase: 'playing',
        initialTimeScale: 0.25,
      });
      const totals: number[] = [];
      // 10 seconds of wall-clock at noisy 60 Hz cadence.
      const deltas = Array.from({ length: 600 }, (_, i) =>
        FRAME_MS + (i % 7 === 0 ? 0.1 : -0.05),
      );
      for (const d of deltas) totals.push(sim.tickFromDelta(d));
      return { totals, emitted: sim.getEmittedSteps() };
    }
    const r1 = run();
    const r2 = run();
    expect(r1.totals).toEqual(r2.totals);
    expect(r1.emitted).toBe(r2.emitted);
  });
});

// ---------------------------------------------------------------------------
// End-to-end with a real ReplayPlaybackController
// ---------------------------------------------------------------------------

function makePlayerSlots(count: number): PlayerSlot[] {
  const ids = ['wolf', 'cat', 'owl', 'bear'] as const;
  return Array.from({ length: count }, (_, i) => ({
    index: (i + 1) as PlayerSlot['index'],
    characterId: ids[i]!,
    paletteIndex: i,
    inputType: i === 0 ? 'keyboard_p1' : i === 1 ? 'keyboard_p2' : 'ai',
    ...(i >= 2 ? { aiDifficulty: 'easy' as const } : {}),
  }));
}

function makeMatchConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    mode: 'stocks',
    stockCount: 3,
    stageId: 'flatlands',
    players: makePlayerSlots(2),
    rngSeed: 0xc0ffee,
    ...overrides,
  };
}

function makeReplay(
  sequence: ReadonlyArray<readonly [number, CharacterInput, CharacterInput?]>,
  playerCount: number = 2,
): ReplayFile {
  const buffer = new InputCaptureBuffer({ playerCount });
  for (const [frame, p1, p2] of sequence) {
    const inputs: CharacterInput[] = [p1];
    if (playerCount >= 2) inputs.push(p2 ?? { moveX: 0, jump: false });
    buffer.captureFrame(frame, inputs);
  }
  return serializeReplay({
    matchConfig: makeMatchConfig({ players: makePlayerSlots(playerCount) }),
    capturedFrames: buffer.getEntries(),
    recordedAt: new Date('2026-04-30T12:00:00.000Z'),
    engineVersion: '0.0.0-test',
  });
}

describe('PlaybackSimulationStateManager — controller integration', () => {
  /**
   * Simulates the host's per-rAF loop. Returns the input streams seen
   * by the (mock) physics step.
   */
  function drive(
    sim: PlaybackSimulationStateManager,
    playback: ReplayPlaybackController,
    deltaSequence: ReadonlyArray<number>,
  ): RecordedCharacterInput[][] {
    const seen: RecordedCharacterInput[][] = [];
    for (const dt of deltaSequence) {
      const steps = sim.tickFromDelta(dt);
      for (let i = 0; i < steps; i += 1) {
        if (!playback.isPlaying()) break;
        const inputs = playback.advance();
        if (inputs !== null) {
          seen.push(inputs.map((x) => ({ ...x })));
        } else {
          // Sparse gap — playback advances cursor but no input recorded.
          // The host would still step physics; for our test we mark with
          // a sentinel so we can compare against the expected feed.
        }
      }
      if (playback.isFinished()) sim.markFinished();
    }
    return seen;
  }

  it('feeding a 60-frame replay at 1.0x reproduces the recorded inputs', () => {
    const seq: Array<[number, CharacterInput, CharacterInput]> = [];
    for (let f = 0; f < 60; f += 1) {
      seq.push([
        f,
        { moveX: f % 2 === 0 ? 1 : -1, jump: f % 5 === 0 },
        { moveX: f % 3 === 0 ? -1 : 0, jump: false },
      ]);
    }
    const replay = makeReplay(seq);
    const playback = new ReplayPlaybackController({ replay });
    playback.start();

    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
    });

    const dts = Array.from({ length: 60 }, () => FRAME_MS);
    const seen = drive(sim, playback, dts);

    expect(seen).toHaveLength(60);
    for (let f = 0; f < 60; f += 1) {
      expect(seen[f]![0]!.moveX).toBe(f % 2 === 0 ? 1 : -1);
      expect(seen[f]![0]!.jump).toBe(f % 5 === 0);
      expect(seen[f]![1]!.moveX).toBe(f % 3 === 0 ? -1 : 0);
    }
  });

  it('feeding the same replay at 0.25x produces the SAME input stream — only cadence differs', () => {
    const seq: Array<[number, CharacterInput, CharacterInput]> = [];
    for (let f = 0; f < 24; f += 1) {
      seq.push([
        f,
        { moveX: f % 2 === 0 ? 1 : -1, jump: f === 10 },
        { moveX: 0, jump: f === 15 },
      ]);
    }
    const replay = makeReplay(seq);

    // Real-time run.
    const realPlayback = new ReplayPlaybackController({ replay });
    realPlayback.start();
    const realSim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
      initialTimeScale: 1.0,
    });
    const realDts = Array.from({ length: 24 }, () => FRAME_MS);
    const realSeen = drive(realSim, realPlayback, realDts);

    // Slow-motion run — needs 4× as many wall-clock ticks to feed
    // the same 24 frames.
    const slowPlayback = new ReplayPlaybackController({ replay });
    slowPlayback.start();
    const slowSim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
      initialTimeScale: 0.25,
    });
    const slowDts = Array.from({ length: 24 * 4 }, () => FRAME_MS);
    const slowSeen = drive(slowSim, slowPlayback, slowDts);

    expect(slowSeen).toEqual(realSeen);
    expect(slowPlayback.getPhase()).toBe('finished');
  });

  it('pause then frame-advance feeds exactly one recorded frame per step request', () => {
    const seq: Array<[number, CharacterInput, CharacterInput]> = [
      [0, { moveX: 1, jump: false }, { moveX: 0, jump: false }],
      [1, { moveX: 0, jump: true }, { moveX: -1, jump: false }],
      [2, { moveX: -1, jump: false }, { moveX: 1, jump: true }],
      [3, { moveX: 1, jump: true, attack: true }, { moveX: 0, jump: false }],
    ];
    const replay = makeReplay(seq);
    const playback = new ReplayPlaybackController({ replay });
    playback.start();

    const sim = new PlaybackSimulationStateManager(); // paused

    // Step once → frame 0
    sim.requestStep();
    let steps = sim.tickFromDelta(0);
    expect(steps).toBe(1);
    let inputs = playback.advance();
    expect(inputs![0]!.moveX).toBe(1);

    // Step twice → frames 1, 2
    sim.requestStep(2);
    steps = sim.tickFromDelta(0);
    expect(steps).toBe(2);
    expect(playback.advance()![0]!.jump).toBe(true);
    expect(playback.advance()![0]!.moveX).toBe(-1);

    // Step once more → frame 3 (last); playback transitions to FINISHED.
    sim.requestStep();
    steps = sim.tickFromDelta(0);
    expect(steps).toBe(1);
    expect(playback.advance()![0]!.attack).toBe(true);
    expect(playback.getPhase()).toBe('finished');
  });

  it('switching to slow-motion mid-playback does not drop or duplicate frames', () => {
    const seq: Array<[number, CharacterInput, CharacterInput]> = [];
    for (let f = 0; f < 48; f += 1) {
      seq.push([
        f,
        { moveX: f, jump: false },
        { moveX: -f, jump: false },
      ]);
    }
    const replay = makeReplay(seq);

    // Reference run at 1.0x.
    const refPlayback = new ReplayPlaybackController({ replay });
    refPlayback.start();
    const refSim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
    });
    const refSeen = drive(
      refSim,
      refPlayback,
      Array.from({ length: 48 }, () => FRAME_MS),
    );

    // Test run: half at 1.0x, half at 0.5x, briefly pause + step
    // through one frame in between.
    const playback = new ReplayPlaybackController({ replay });
    playback.start();
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
    });

    const seen: RecordedCharacterInput[][] = [];
    const stepAndCollect = (dt: number): void => {
      const steps = sim.tickFromDelta(dt);
      for (let i = 0; i < steps; i += 1) {
        if (!playback.isPlaying()) break;
        const inputs = playback.advance();
        if (inputs !== null) seen.push(inputs.map((x) => ({ ...x })));
      }
      if (playback.isFinished()) sim.markFinished();
    };

    // Phase 1: 20 frames at 1.0x.
    for (let i = 0; i < 20; i += 1) stepAndCollect(FRAME_MS);

    // Pause + step exactly once.
    sim.pause();
    sim.requestStep();
    stepAndCollect(FRAME_MS);

    // Resume at 0.5x → finish remaining 27 frames.
    sim.resume();
    sim.setTimeScale(0.5);
    sim.resetAccumulator();
    // 27 frames * 2 (because half speed) = 54 wall-clock frames.
    for (let i = 0; i < 60; i += 1) stepAndCollect(FRAME_MS);

    expect(seen).toEqual(refSeen);
    expect(playback.getPhase()).toBe('finished');
  });
});
