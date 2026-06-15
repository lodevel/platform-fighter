import { describe, it, expect } from 'vitest';
import type { CharacterInput } from '../characters/Character';
import type { MatchConfig, PlayerSlot } from '../types';
import {
  InputCaptureBuffer,
  type RecordedCharacterInput,
} from './InputCaptureBuffer';
import { serializeReplay } from './ReplayFile';
import type { ReplayFile } from './replayTypes';
import { ReplayPlaybackController } from './ReplayPlaybackController';
import { PlaybackSimulationStateManager } from './PlaybackSimulationStateManager';
import { FrameAdvanceStepper } from './FrameAdvanceStepper';

/**
 * AC 30304 Sub-AC 4 — frame-advance stepper.
 *
 * Coverage map:
 *
 *   • Construction validates required callbacks + options.
 *   • step() refuses without a loaded replay.
 *   • step() refuses while playing (default `requirePaused: true`).
 *   • step() refuses past the end of the replay.
 *   • step() with `requirePaused: false` advances regardless of phase.
 *   • Single trigger advances cursor by exactly one frame.
 *   • Single trigger calls `applyInputs` and `stepPhysics` exactly once
 *     each, in lockstep order (apply before step).
 *   • Multiple triggers walk the timeline frame-by-frame with the
 *     recorded inputs flowing through unchanged.
 *   • Sparse-gap frames yield `null` inputs to the host without
 *     blocking the cursor.
 *   • `applyInputs` throw → `stepPhysics` is NOT called; status is
 *     `failed-apply-inputs`; the throw is captured (not re-propagated).
 *   • `stepPhysics` throw → status is `failed-step-physics`; the throw
 *     is captured.
 *   • Stats counters track success / noop / failure / lastSteppedFrame.
 *   • `reset()` zeroes stats but preserves callbacks.
 *   • `stepBy(n)` walks n frames and stops on first non-success.
 *   • Lockstep: cursor advances exactly one per `applyInputs` call —
 *     no double-feed and no skipped frames across N steps.
 *   • Determinism: two steppers driven through the same replay produce
 *     identical input + frame sequences.
 *   • Integration: stepper folds into the simulation manager's
 *     emittedSteps counter so the HUD read-out stays consistent.
 */

const FIXED_TIMESTEP_MS = 1000 / 60;

// ---------------------------------------------------------------------------
// Fixtures
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

/**
 * Build a `ReplayFile` from a sequence of `[frame, p1Input, p2Input?]`
 * triples. Uses a real `InputCaptureBuffer` + `serializeReplay` so the
 * fixture exercises the same recorder path the real game uses.
 */
function makeReplay(
  sequence: ReadonlyArray<readonly [number, CharacterInput, CharacterInput?]>,
  playerCount: number = 2,
): ReplayFile {
  const buffer = new InputCaptureBuffer({ playerCount });
  for (const [frame, p1, p2] of sequence) {
    const inputs: CharacterInput[] = [p1];
    if (playerCount >= 2) inputs.push(p2 ?? { moveX: 0, moveY: 0, jump: false });
    buffer.captureFrame(frame, inputs);
  }
  return serializeReplay({
    matchConfig: makeMatchConfig({
      players: makePlayerSlots(playerCount),
    }),
    capturedFrames: buffer.getEntries(),
    recordedAt: new Date('2026-04-30T12:00:00.000Z'),
    engineVersion: '0.0.0-test',
  });
}

interface RecordedCall {
  readonly frame: number;
  readonly inputs: ReadonlyArray<RecordedCharacterInput> | null;
}

interface PhysicsCall {
  readonly fixedTimestepMs: number;
  /**
   * Sequence ordinal — bumped whenever applyInputs OR stepPhysics is
   * called. Used by lockstep tests to assert apply runs before step
   * for every iteration.
   */
  readonly seq: number;
}

interface Spy {
  applyInputsCalls: RecordedCall[];
  stepPhysicsCalls: PhysicsCall[];
  callOrder: Array<'apply' | 'step'>;
  /** Bumped on every call (apply or step) so we can interleave-check. */
  seq: number;
  applyInputsImpl?: (
    frame: number,
    inputs: ReadonlyArray<RecordedCharacterInput> | null,
  ) => void;
  stepPhysicsImpl?: (fixedTimestepMs: number) => void;
}

function makeSpy(): Spy {
  const spy: Spy = {
    applyInputsCalls: [],
    stepPhysicsCalls: [],
    callOrder: [],
    seq: 0,
  };
  return spy;
}

function makeStepper(
  replay: ReplayFile,
  spy: Spy,
  options: {
    simulation?: PlaybackSimulationStateManager;
    requirePaused?: boolean;
    autoStart?: boolean;
  } = {},
): {
  stepper: FrameAdvanceStepper;
  playback: ReplayPlaybackController;
  simulation: PlaybackSimulationStateManager;
} {
  const playback = new ReplayPlaybackController({ replay });
  const simulation =
    options.simulation ??
    new PlaybackSimulationStateManager({ initialPhase: 'paused' });
  if (options.autoStart !== false) {
    playback.start();
  }
  const stepper = new FrameAdvanceStepper({
    playback,
    simulation,
    applyInputs: (frame, inputs) => {
      spy.seq += 1;
      spy.applyInputsCalls.push({ frame, inputs });
      spy.callOrder.push('apply');
      if (spy.applyInputsImpl) spy.applyInputsImpl(frame, inputs);
    },
    stepPhysics: (dt) => {
      spy.seq += 1;
      spy.stepPhysicsCalls.push({ fixedTimestepMs: dt, seq: spy.seq });
      spy.callOrder.push('step');
      if (spy.stepPhysicsImpl) spy.stepPhysicsImpl(dt);
    },
    ...(options.requirePaused !== undefined
      ? { requirePaused: options.requirePaused }
      : {}),
  });
  return { stepper, playback, simulation };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('FrameAdvanceStepper — construction', () => {
  it('rejects missing options', () => {
    expect(
      () => new FrameAdvanceStepper(null as never),
    ).toThrow(/options must be a non-null object/);
  });

  it('rejects missing playback controller', () => {
    expect(
      () =>
        new FrameAdvanceStepper({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          playback: undefined as any,
          applyInputs: () => {},
          stepPhysics: () => {},
        }),
    ).toThrow(/options.playback/);
  });

  it('rejects missing applyInputs', () => {
    const playback = new ReplayPlaybackController({
      replay: makeReplay([[0, { moveX: 0, moveY: 0, jump: false }]]),
    });
    expect(
      () =>
        new FrameAdvanceStepper({
          playback,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          applyInputs: undefined as any,
          stepPhysics: () => {},
        }),
    ).toThrow(/applyInputs/);
  });

  it('rejects missing stepPhysics', () => {
    const playback = new ReplayPlaybackController({
      replay: makeReplay([[0, { moveX: 0, moveY: 0, jump: false }]]),
    });
    expect(
      () =>
        new FrameAdvanceStepper({
          playback,
          applyInputs: () => {},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stepPhysics: undefined as any,
        }),
    ).toThrow(/stepPhysics/);
  });

  it('rejects invalid fixedTimestepMs override', () => {
    const playback = new ReplayPlaybackController({
      replay: makeReplay([[0, { moveX: 0, moveY: 0, jump: false }]]),
    });
    expect(
      () =>
        new FrameAdvanceStepper({
          playback,
          applyInputs: () => {},
          stepPhysics: () => {},
          fixedTimestepMs: 0,
        }),
    ).toThrow(/fixedTimestepMs/);
    expect(
      () =>
        new FrameAdvanceStepper({
          playback,
          applyInputs: () => {},
          stepPhysics: () => {},
          fixedTimestepMs: -1,
        }),
    ).toThrow(/fixedTimestepMs/);
  });

  it('exposes default fixedTimestepMs from simulation manager', () => {
    const replay = makeReplay([[0, { moveX: 0, moveY: 0, jump: false }]]);
    const sim = new PlaybackSimulationStateManager({
      fixedTimestepMs: 20,
    });
    const playback = new ReplayPlaybackController({ replay });
    const stepper = new FrameAdvanceStepper({
      playback,
      simulation: sim,
      applyInputs: () => {},
      stepPhysics: () => {},
    });
    expect(stepper.getFixedTimestepMs()).toBe(20);
  });

  it('falls back to GAME_CONFIG when no simulation supplied', () => {
    const playback = new ReplayPlaybackController({
      replay: makeReplay([[0, { moveX: 0, moveY: 0, jump: false }]]),
    });
    const stepper = new FrameAdvanceStepper({
      playback,
      applyInputs: () => {},
      stepPhysics: () => {},
    });
    expect(stepper.getFixedTimestepMs()).toBeCloseTo(FIXED_TIMESTEP_MS);
  });
});

// ---------------------------------------------------------------------------
// Pre-condition gate
// ---------------------------------------------------------------------------

describe('FrameAdvanceStepper — pre-condition gate', () => {
  it('returns noop-no-replay when controller is IDLE', () => {
    const playback = new ReplayPlaybackController();
    const sim = new PlaybackSimulationStateManager({ initialPhase: 'paused' });
    const stepper = new FrameAdvanceStepper({
      playback,
      simulation: sim,
      applyInputs: () => {},
      stepPhysics: () => {},
    });
    const r = stepper.step();
    expect(r.status).toBe('noop-no-replay');
    expect(stepper.isAvailable()).toBe(false);
    expect(stepper.getStats().noopCount).toBe(1);
  });

  it('returns noop-not-paused while simulation is playing', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: true }],
    ]);
    const spy = makeSpy();
    const sim = new PlaybackSimulationStateManager({
      initialPhase: 'playing',
    });
    const { stepper } = makeStepper(replay, spy, { simulation: sim });
    const r = stepper.step();
    expect(r.status).toBe('noop-not-paused');
    expect(spy.applyInputsCalls).toHaveLength(0);
    expect(spy.stepPhysicsCalls).toHaveLength(0);
    expect(stepper.isAvailable()).toBe(false);
  });

  it('returns noop-finished after exhausting the timeline', () => {
    const replay = makeReplay([[0, { moveX: 0, moveY: 0, jump: false }]]);
    const spy = makeSpy();
    const { stepper, playback } = makeStepper(replay, spy);
    // Walk the only frame.
    const first = stepper.step();
    expect(first.status).toBe('success');
    expect(playback.isFinished()).toBe(true);

    // Now we're past the end.
    const second = stepper.step();
    expect(second.status).toBe('noop-finished');
    expect(stepper.isAvailable()).toBe(false);
  });

  it('with requirePaused=false advances even while playing', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: true }],
    ]);
    const spy = makeSpy();
    const sim = new PlaybackSimulationStateManager({ initialPhase: 'playing' });
    const { stepper } = makeStepper(replay, spy, {
      simulation: sim,
      requirePaused: false,
    });
    const r = stepper.step();
    expect(r.status).toBe('success');
    expect(spy.applyInputsCalls).toHaveLength(1);
    expect(spy.stepPhysicsCalls).toHaveLength(1);
  });

  it('without simulation manager always passes the phase gate', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: -1, moveY: 0, jump: false }],
    ]);
    const spy = makeSpy();
    const playback = new ReplayPlaybackController({ replay });
    playback.start();
    const stepper = new FrameAdvanceStepper({
      playback,
      applyInputs: (frame, inputs) => {
        spy.seq += 1;
        spy.applyInputsCalls.push({ frame, inputs });
        spy.callOrder.push('apply');
      },
      stepPhysics: (dt) => {
        spy.seq += 1;
        spy.stepPhysicsCalls.push({ fixedTimestepMs: dt, seq: spy.seq });
        spy.callOrder.push('step');
      },
    });
    const r = stepper.step();
    expect(r.status).toBe('success');
    expect(stepper.isAvailable()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Single-step semantics
// ---------------------------------------------------------------------------

describe('FrameAdvanceStepper — single-step semantics', () => {
  it('one trigger advances cursor by exactly one frame', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: true }],
      [2, { moveX: -1, moveY: 0, jump: false }],
    ]);
    const spy = makeSpy();
    const { stepper, playback } = makeStepper(replay, spy);
    expect(playback.getCurrentFrame()).toBe(0);

    const r = stepper.step();
    expect(r.status).toBe('success');
    expect(r.frame).toBe(0);
    expect(playback.getCurrentFrame()).toBe(1);
  });

  it('calls applyInputs then stepPhysics in lockstep', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: true }],
    ]);
    const spy = makeSpy();
    const { stepper } = makeStepper(replay, spy);
    stepper.step();

    expect(spy.applyInputsCalls).toHaveLength(1);
    expect(spy.stepPhysicsCalls).toHaveLength(1);
    expect(spy.callOrder).toEqual(['apply', 'step']);
  });

  it('forwards the recorded inputs unchanged to applyInputs', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false, attack: true }],
    ]);
    const spy = makeSpy();
    const { stepper } = makeStepper(replay, spy);
    stepper.step();

    const call = spy.applyInputsCalls[0]!;
    expect(call.frame).toBe(0);
    expect(call.inputs).not.toBeNull();
    expect(call.inputs![0]!.moveX).toBe(1);
    expect(call.inputs![0]!.attack).toBe(true);
  });

  it('forwards the configured fixedTimestepMs to stepPhysics', () => {
    const replay = makeReplay([[0, { moveX: 0, moveY: 0, jump: false }]]);
    const spy = makeSpy();
    const { stepper } = makeStepper(replay, spy);
    stepper.step();
    expect(spy.stepPhysicsCalls[0]!.fixedTimestepMs).toBeCloseTo(
      FIXED_TIMESTEP_MS,
    );
  });

  it('result.fixedTimestepMs matches the configured value', () => {
    const replay = makeReplay([[0, { moveX: 0, moveY: 0, jump: false }]]);
    const spy = makeSpy();
    const { stepper } = makeStepper(replay, spy);
    const r = stepper.step();
    expect(r.fixedTimestepMs).toBeCloseTo(FIXED_TIMESTEP_MS);
  });

  it('null inputs flow through to applyInputs on a sparse-gap frame', () => {
    // Sparse timeline: frame 0 then frame 5 (gap at 1..4).
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [5, { moveX: -1, moveY: 0, jump: false }],
    ]);
    const spy = makeSpy();
    const { stepper, playback } = makeStepper(replay, spy);
    // First step consumes frame 0 fine.
    stepper.step();
    expect(spy.applyInputsCalls[0]!.inputs).not.toBeNull();
    expect(playback.getCurrentFrame()).toBe(1);

    // Second step: cursor at 1 — sparse gap.
    stepper.step();
    expect(spy.applyInputsCalls[1]!.frame).toBe(1);
    expect(spy.applyInputsCalls[1]!.inputs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Multi-step lockstep walk
// ---------------------------------------------------------------------------

describe('FrameAdvanceStepper — lockstep walk', () => {
  it('walks N frames in lockstep with one apply + one step per trigger', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: true }],
      [2, { moveX: -1, moveY: 0, jump: false }],
      [3, { moveX: 0, moveY: 0, jump: false, attack: true }],
    ]);
    const spy = makeSpy();
    const { stepper } = makeStepper(replay, spy);

    for (let i = 0; i < 4; i += 1) {
      const r = stepper.step();
      expect(r.status).toBe('success');
      expect(r.frame).toBe(i);
    }

    // Exactly four apply + step pairs, in interleaved order.
    expect(spy.applyInputsCalls.map((c) => c.frame)).toEqual([0, 1, 2, 3]);
    expect(spy.stepPhysicsCalls).toHaveLength(4);
    expect(spy.callOrder).toEqual([
      'apply',
      'step',
      'apply',
      'step',
      'apply',
      'step',
      'apply',
      'step',
    ]);
  });

  it('stepBy(n) walks n frames and stops on first non-success', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: true }],
    ]);
    const spy = makeSpy();
    const { stepper } = makeStepper(replay, spy);
    const last = stepper.stepBy(5);
    // 2 successes then noop-finished — last result reflects the noop.
    expect(last.status).toBe('noop-finished');
    expect(spy.applyInputsCalls).toHaveLength(2);
    expect(spy.stepPhysicsCalls).toHaveLength(2);
    expect(stepper.getStats().successCount).toBe(2);
    expect(stepper.getStats().noopCount).toBe(1);
  });

  it('stepBy rejects non-positive counts', () => {
    const replay = makeReplay([[0, { moveX: 0, moveY: 0, jump: false }]]);
    const spy = makeSpy();
    const { stepper } = makeStepper(replay, spy);
    expect(() => stepper.stepBy(0)).toThrow(/positive integer/);
    expect(() => stepper.stepBy(-1)).toThrow(/positive integer/);
    expect(() => stepper.stepBy(1.5)).toThrow(/positive integer/);
  });

  it('cursor never advances without a paired applyInputs call', () => {
    const replay = makeReplay([
      [0, { moveX: 0, moveY: 0, jump: false }],
      [1, { moveX: 1, moveY: 0, jump: false }],
      [2, { moveX: 0, moveY: 0, jump: false }],
    ]);
    const spy = makeSpy();
    const { stepper, playback } = makeStepper(replay, spy);

    // Snapshot the cursor before / after each step and assert the
    // applyInputs / stepPhysics counts grew in lockstep.
    let beforeCursor = playback.getCurrentFrame();
    for (let i = 0; i < 3; i += 1) {
      const beforeApplies = spy.applyInputsCalls.length;
      const beforeSteps = spy.stepPhysicsCalls.length;
      stepper.step();
      expect(playback.getCurrentFrame()).toBe(beforeCursor + 1);
      expect(spy.applyInputsCalls.length).toBe(beforeApplies + 1);
      expect(spy.stepPhysicsCalls.length).toBe(beforeSteps + 1);
      beforeCursor = playback.getCurrentFrame();
    }
  });
});

// ---------------------------------------------------------------------------
// Failure paths
// ---------------------------------------------------------------------------

describe('FrameAdvanceStepper — failure handling', () => {
  it('applyInputs throw → stepPhysics is NOT called, status is failed-apply-inputs', () => {
    const replay = makeReplay([[0, { moveX: 1, moveY: 0, jump: false }]]);
    const spy = makeSpy();
    spy.applyInputsImpl = () => {
      throw new Error('boom-apply');
    };
    const { stepper } = makeStepper(replay, spy);
    const r = stepper.step();

    expect(r.status).toBe('failed-apply-inputs');
    expect(r.errorMessage).toMatch(/boom-apply/);
    // applyInputs ran (throwing counts as called); stepPhysics did NOT.
    expect(spy.applyInputsCalls).toHaveLength(1);
    expect(spy.stepPhysicsCalls).toHaveLength(0);
    expect(stepper.getStats().failureCount).toBe(1);
  });

  it('stepPhysics throw → status is failed-step-physics, error captured', () => {
    const replay = makeReplay([[0, { moveX: 1, moveY: 0, jump: false }]]);
    const spy = makeSpy();
    spy.stepPhysicsImpl = () => {
      throw new Error('boom-step');
    };
    const { stepper } = makeStepper(replay, spy);
    const r = stepper.step();

    expect(r.status).toBe('failed-step-physics');
    expect(r.errorMessage).toMatch(/boom-step/);
    expect(spy.applyInputsCalls).toHaveLength(1);
    expect(spy.stepPhysicsCalls).toHaveLength(1);
    expect(stepper.getStats().failureCount).toBe(1);
  });

  it('does NOT re-propagate callback throws (button click safety)', () => {
    const replay = makeReplay([[0, { moveX: 1, moveY: 0, jump: false }]]);
    const spy = makeSpy();
    spy.applyInputsImpl = () => {
      throw new Error('boom');
    };
    const { stepper } = makeStepper(replay, spy);
    // Should not throw — error captured into result.
    expect(() => stepper.step()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Stats + reset
// ---------------------------------------------------------------------------

describe('FrameAdvanceStepper — stats', () => {
  it('tracks success / noop / failure counts and lastSteppedFrame', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: false }],
    ]);
    const spy = makeSpy();
    const { stepper } = makeStepper(replay, spy);

    expect(stepper.getStats()).toMatchObject({
      stepCount: 0,
      successCount: 0,
      noopCount: 0,
      failureCount: 0,
      lastSteppedFrame: null,
    });

    stepper.step(); // success → frame 0
    stepper.step(); // success → frame 1 (now finished)
    stepper.step(); // noop-finished

    const stats = stepper.getStats();
    expect(stats.stepCount).toBe(3);
    expect(stats.successCount).toBe(2);
    expect(stats.noopCount).toBe(1);
    expect(stats.failureCount).toBe(0);
    expect(stats.lastSteppedFrame).toBe(1);
  });

  it('reset() zeroes stats but preserves callbacks', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: false }],
    ]);
    const spy = makeSpy();
    const { stepper } = makeStepper(replay, spy);

    stepper.step();
    expect(stepper.getStats().successCount).toBe(1);

    stepper.reset();
    expect(stepper.getStats()).toMatchObject({
      stepCount: 0,
      successCount: 0,
      noopCount: 0,
      failureCount: 0,
      lastSteppedFrame: null,
    });

    // Callbacks still wired:
    stepper.step();
    expect(spy.applyInputsCalls).toHaveLength(2);
  });

  it('returned result is frozen', () => {
    const replay = makeReplay([[0, { moveX: 0, moveY: 0, jump: false }]]);
    const spy = makeSpy();
    const { stepper } = makeStepper(replay, spy);
    const r = stepper.step();
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('returned stats record is frozen', () => {
    const replay = makeReplay([[0, { moveX: 0, moveY: 0, jump: false }]]);
    const spy = makeSpy();
    const { stepper } = makeStepper(replay, spy);
    expect(Object.isFrozen(stepper.getStats())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Empty timeline edge case
// ---------------------------------------------------------------------------

describe('FrameAdvanceStepper — empty timeline', () => {
  it('returns noop-finished on a zero-frame replay', () => {
    const replay = makeReplay([], 2);
    const spy = makeSpy();
    const { stepper } = makeStepper(replay, spy);
    const r = stepper.step();
    expect(r.status).toBe('noop-finished');
    expect(spy.applyInputsCalls).toHaveLength(0);
    expect(spy.stepPhysicsCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('FrameAdvanceStepper — determinism', () => {
  it('two steppers driven through the same replay produce identical traces', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: true }],
      [2, { moveX: -1, moveY: 0, jump: false }],
      [3, { moveX: 0, moveY: 0, jump: false, attack: true }],
      [4, { moveX: 1, moveY: 0, jump: false }],
    ]);

    const spyA = makeSpy();
    const { stepper: stepperA } = makeStepper(replay, spyA);
    const spyB = makeSpy();
    const { stepper: stepperB } = makeStepper(replay, spyB);

    for (let i = 0; i < 5; i += 1) {
      stepperA.step();
      stepperB.step();
    }

    expect(spyA.applyInputsCalls.length).toBe(spyB.applyInputsCalls.length);
    for (let i = 0; i < spyA.applyInputsCalls.length; i += 1) {
      const a = spyA.applyInputsCalls[i]!;
      const b = spyB.applyInputsCalls[i]!;
      expect(a.frame).toBe(b.frame);
      expect(a.inputs).toEqual(b.inputs);
    }
    expect(spyA.stepPhysicsCalls.length).toBe(spyB.stepPhysicsCalls.length);
  });
});

// ---------------------------------------------------------------------------
// Integration with PlaybackSimulationStateManager
// ---------------------------------------------------------------------------

describe('FrameAdvanceStepper — simulation manager integration', () => {
  it('folds successful steps into emittedSteps when paused', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: true }],
      [2, { moveX: -1, moveY: 0, jump: false }],
    ]);
    const spy = makeSpy();
    const sim = new PlaybackSimulationStateManager({ initialPhase: 'paused' });
    const { stepper } = makeStepper(replay, spy, { simulation: sim });

    expect(sim.getEmittedSteps()).toBe(0);
    stepper.step();
    expect(sim.getEmittedSteps()).toBe(1);
    stepper.step();
    expect(sim.getEmittedSteps()).toBe(2);
  });

  it('does not fold emitted-steps when not paused (requirePaused=false)', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: true }],
    ]);
    const spy = makeSpy();
    const sim = new PlaybackSimulationStateManager({ initialPhase: 'playing' });
    const { stepper } = makeStepper(replay, spy, {
      simulation: sim,
      requirePaused: false,
    });

    const beforeEmitted = sim.getEmittedSteps();
    const r = stepper.step();
    expect(r.status).toBe('success');
    // Manager was 'playing', so the stepper did NOT fold via the
    // requestStep+drain path (that would double-count once the manager
    // also ticks accumulator-driven steps). Emitted-steps stays
    // unchanged from the stepper's perspective.
    expect(sim.getEmittedSteps()).toBe(beforeEmitted);
  });

  it('full canonical VCR flow: pause, step F times, unpause, resume', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: true }],
      [2, { moveX: -1, moveY: 0, jump: false }],
      [3, { moveX: 0, moveY: 0, jump: false }],
    ]);
    const spy = makeSpy();
    const sim = new PlaybackSimulationStateManager({ initialPhase: 'paused' });
    const { stepper, playback } = makeStepper(replay, spy, { simulation: sim });

    // Frame-advance two frames while paused.
    stepper.step();
    stepper.step();
    expect(playback.getCurrentFrame()).toBe(2);
    expect(spy.applyInputsCalls).toHaveLength(2);
    expect(spy.stepPhysicsCalls).toHaveLength(2);

    // Resume — frame-advance becomes a noop (until paused again).
    sim.resume();
    expect(stepper.isAvailable()).toBe(false);
    const r = stepper.step();
    expect(r.status).toBe('noop-not-paused');
    expect(spy.applyInputsCalls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Stepping from LOADED (auto-start)
// ---------------------------------------------------------------------------

describe('FrameAdvanceStepper — auto-start from LOADED', () => {
  it('auto-starts the controller if it has not been started yet', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: true }],
    ]);
    const spy = makeSpy();
    // autoStart=false — controller stays in LOADED until first step.
    const { stepper, playback } = makeStepper(replay, spy, {
      autoStart: false,
    });
    expect(playback.getPhase()).toBe('loaded');

    const r = stepper.step();
    expect(r.status).toBe('success');
    expect(playback.getPhase()).toBe('playing');
    expect(playback.getCurrentFrame()).toBe(1);
  });
});
