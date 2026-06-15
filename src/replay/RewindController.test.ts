import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CharacterInput } from '../characters/Character';
import type { MatchConfig, PlayerSlot } from '../types';
import {
  InputCaptureBuffer,
  NEUTRAL_INPUT,
  type RecordedCharacterInput,
} from './InputCaptureBuffer';
import { ReplayPlaybackController } from './ReplayPlaybackController';
import { serializeReplay } from './ReplayFile';
import {
  RewindController,
  type RewindInputSource,
  type RewindSnapshot,
} from './RewindController';

/**
 * AC 30303 Sub-AC 3 — RewindController.
 *
 * Coverage map:
 *
 *   • Construction validation (callbacks required, snapshots monotonic,
 *     interval / cap parameters validated).
 *   • Snapshot management — addSnapshot enforces monotonic frame order;
 *     findSnapshotForFrame is correct upper-bound binary search.
 *   • Rewind happy path — exact-snapshot landing, mid-interval rewinds
 *     correctly re-simulate the (snapshot, target] range.
 *   • Determinism contract — two rewinds to the same target produce
 *     bit-identical simulator state; two RewindControllers fed the same
 *     inputs produce the same state.
 *   • Sparse timelines — sampleFrame returning null is forwarded to
 *     simulateStep unchanged (host's choice on neutral fallback).
 *   • Failure modes — restoreSnapshot throws abort before any
 *     simulateStep; simulateStep throws aborts at the failing frame.
 *   • Cap enforcement — rewinds requiring more than the cap throw before
 *     restoring.
 *   • Integration with InputCaptureBuffer and ReplayPlaybackController.
 *   • End-to-end determinism: a recorded counter-simulator's "rewind to
 *     frame T" reaches the exact same counter value the original walk
 *     reached at T.
 */

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * A toy deterministic simulator for the controller's tests. Models a
 * single integer state that increments by `inputs[0].moveX + 1` each
 * frame the simulator is stepped. Snapshotting captures the integer;
 * restoring sets it. Two simulators fed the same input sequence
 * starting from the same state produce identical outputs — exactly the
 * contract a deterministic Matter.js + frame-counter physics engine
 * provides.
 */
class ToySimulator {
  state: number;
  private readonly initial: number;
  /** Per-frame audit trail — used to prove re-simulation is deterministic. */
  readonly history: Array<{ frame: number; state: number }>;

  constructor(initial: number = 0) {
    this.state = initial;
    this.initial = initial;
    this.history = [];
  }

  step(frame: number, inputs: ReadonlyArray<RecordedCharacterInput> | null) {
    // moveX values in [-1, 1] mapped to a +/-1 / +0 step so we can prove
    // re-simulation honours the recorded inputs. A null lookup (sparse
    // gap in the timeline) treats every player as neutral.
    const moveX = inputs?.[0]?.moveX ?? 0;
    const delta = moveX === 0 ? 1 : moveX > 0 ? 2 : 0;
    this.state += delta;
    this.history.push({ frame, state: this.state });
  }

  snapshot(): { frame: number; state: number } {
    return { frame: 0, state: this.state };
  }

  restore(state: number) {
    this.state = state;
  }

  reset() {
    this.state = this.initial;
    this.history.length = 0;
  }
}

/**
 * Build a synthetic input timeline with deterministic per-frame
 * `moveX` values. Frame N gets `moveX = sin(N) > 0 ? 1 : -1` — a stable
 * but non-trivial sequence that exercises both delta directions.
 */
function buildDeterministicTimeline(
  totalFrames: number,
  playerCount: number = 1,
): InputCaptureBuffer {
  const buffer = new InputCaptureBuffer({ playerCount });
  for (let f = 0; f < totalFrames; f += 1) {
    // Pure-arithmetic deterministic alternation: avoid Math.sin to
    // sidestep IEEE-754 rounding differences across JS engines.
    const moveX = (f * 7 + 3) % 5 < 2 ? 1 : -1;
    const inputs: CharacterInput[] = [{ moveX, jump: false, attack: false }];
    for (let p = 1; p < playerCount; p += 1) {
      inputs.push({ moveX: 0, moveY: 0, jump: false, attack: false });
    }
    buffer.captureFrame(f, inputs);
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('RewindController — construction', () => {
  it('constructs with required callbacks and a buffer input source', () => {
    const buffer = new InputCaptureBuffer({ playerCount: 1 });
    const sim = new ToySimulator();
    const controller = new RewindController({
      inputSource: buffer,
      restoreSnapshot: (s) => sim.restore(s.state as number),
      simulateStep: (f, i) => sim.step(f, i),
    });
    expect(controller.getSnapshotCount()).toBe(0);
    expect(controller.getSnapshots()).toEqual([]);
    expect(controller.getSnapshotIntervalFrames()).toBe(300);
    expect(controller.getMaxSimulatedFramesPerRewind()).toBe(1500);
  });

  it('accepts a structural RewindInputSource (not just buffer/playback)', () => {
    const synthetic: RewindInputSource = {
      sampleFrame: () => null,
      getPlayerCount: () => 1,
    };
    const sim = new ToySimulator();
    const controller = new RewindController({
      inputSource: synthetic,
      restoreSnapshot: (s) => sim.restore(s.state as number),
      simulateStep: (f, i) => sim.step(f, i),
    });
    expect(controller).toBeDefined();
  });

  it('rejects an inputSource missing required methods', () => {
    const sim = new ToySimulator();
    expect(
      () =>
        new RewindController({
          inputSource: {} as RewindInputSource,
          restoreSnapshot: (s) => sim.restore(s.state as number),
          simulateStep: (f, i) => sim.step(f, i),
        }),
    ).toThrow(/sampleFrame.*getPlayerCount/);
  });

  it('throws when restoreSnapshot is not a function', () => {
    const buffer = new InputCaptureBuffer({ playerCount: 1 });
    expect(
      () =>
        new RewindController({
          inputSource: buffer,
          // @ts-expect-error — runtime validation of bad input
          restoreSnapshot: 'not a function',
          simulateStep: () => {},
        }),
    ).toThrow(/restoreSnapshot/);
  });

  it('throws when simulateStep is not a function', () => {
    const buffer = new InputCaptureBuffer({ playerCount: 1 });
    expect(
      () =>
        new RewindController({
          inputSource: buffer,
          restoreSnapshot: () => {},
          // @ts-expect-error — runtime validation of bad input
          simulateStep: null,
        }),
    ).toThrow(/simulateStep/);
  });

  it('throws when inputSource is missing', () => {
    expect(
      () =>
        new RewindController({
          // @ts-expect-error — runtime validation of bad input
          inputSource: undefined,
          restoreSnapshot: () => {},
          simulateStep: () => {},
        }),
    ).toThrow(/inputSource/);
  });

  it('rejects non-positive snapshotIntervalFrames', () => {
    const buffer = new InputCaptureBuffer({ playerCount: 1 });
    expect(
      () =>
        new RewindController({
          inputSource: buffer,
          restoreSnapshot: () => {},
          simulateStep: () => {},
          snapshotIntervalFrames: 0,
        }),
    ).toThrow(/snapshotIntervalFrames/);
    expect(
      () =>
        new RewindController({
          inputSource: buffer,
          restoreSnapshot: () => {},
          simulateStep: () => {},
          snapshotIntervalFrames: -1,
        }),
    ).toThrow(/snapshotIntervalFrames/);
    expect(
      () =>
        new RewindController({
          inputSource: buffer,
          restoreSnapshot: () => {},
          simulateStep: () => {},
          snapshotIntervalFrames: 1.5,
        }),
    ).toThrow(/snapshotIntervalFrames/);
  });

  it('rejects non-positive maxSimulatedFramesPerRewind', () => {
    const buffer = new InputCaptureBuffer({ playerCount: 1 });
    expect(
      () =>
        new RewindController({
          inputSource: buffer,
          restoreSnapshot: () => {},
          simulateStep: () => {},
          maxSimulatedFramesPerRewind: 0,
        }),
    ).toThrow(/maxSimulatedFramesPerRewind/);
  });

  it('bulk-loads snapshots passed via options.snapshots', () => {
    const buffer = new InputCaptureBuffer({ playerCount: 1 });
    const controller = new RewindController({
      inputSource: buffer,
      restoreSnapshot: () => {},
      simulateStep: () => {},
      snapshots: [
        { frame: 0, state: 0 },
        { frame: 300, state: 100 },
        { frame: 600, state: 250 },
      ],
    });
    expect(controller.getSnapshotCount()).toBe(3);
    expect(controller.getSnapshots()[0]!.frame).toBe(0);
    expect(controller.getSnapshots()[2]!.frame).toBe(600);
  });

  it('rejects out-of-order bulk snapshots', () => {
    const buffer = new InputCaptureBuffer({ playerCount: 1 });
    expect(
      () =>
        new RewindController({
          inputSource: buffer,
          restoreSnapshot: () => {},
          simulateStep: () => {},
          snapshots: [
            { frame: 300, state: 100 },
            { frame: 0, state: 0 },
          ],
        }),
    ).toThrow(/monotonic/);
  });
});

// ---------------------------------------------------------------------------
// Snapshot management
// ---------------------------------------------------------------------------

describe('RewindController — snapshot management', () => {
  let buffer: InputCaptureBuffer;
  let sim: ToySimulator;
  let controller: RewindController<number>;

  beforeEach(() => {
    buffer = new InputCaptureBuffer({ playerCount: 1 });
    sim = new ToySimulator();
    controller = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: (s) => sim.restore(s.state),
      simulateStep: (f, i) => sim.step(f, i),
    });
  });

  it('addSnapshot enforces strict monotonic frame ordering', () => {
    controller.addSnapshot({ frame: 0, state: 0 });
    controller.addSnapshot({ frame: 300, state: 50 });

    expect(() => controller.addSnapshot({ frame: 300, state: 99 })).toThrow(
      /monotonic/,
    );
    expect(() => controller.addSnapshot({ frame: 100, state: 99 })).toThrow(
      /monotonic/,
    );
    // After a rejected addSnapshot, the count is unchanged.
    expect(controller.getSnapshotCount()).toBe(2);
  });

  it('rejects malformed snapshots', () => {
    expect(() => controller.addSnapshot(null as unknown as RewindSnapshot<number>)).toThrow(
      /non-null/,
    );
    expect(() =>
      controller.addSnapshot({ frame: -1, state: 0 } as RewindSnapshot<number>),
    ).toThrow(/non-negative/);
    expect(() =>
      controller.addSnapshot({ frame: 1.5, state: 0 } as RewindSnapshot<number>),
    ).toThrow(/integer/);
    expect(() =>
      controller.addSnapshot({ frame: 0, state: undefined } as unknown as RewindSnapshot<number>),
    ).toThrow(/state/);
  });

  it('warns (does not throw) on a snapshot gap > 2× interval', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    controller.addSnapshot({ frame: 0, state: 0 });
    // Default interval is 300; gap of 700 > 2× 300 should warn.
    controller.addSnapshot({ frame: 700, state: 1 });
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0]![0]).toMatch(/large gap/);
    warn.mockRestore();
  });

  it('does not warn on normal-cadence snapshots', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    controller.addSnapshot({ frame: 0, state: 0 });
    controller.addSnapshot({ frame: 300, state: 1 });
    controller.addSnapshot({ frame: 600, state: 2 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('findSnapshotForFrame returns the latest snapshot ≤ targetFrame', () => {
    controller.addSnapshot({ frame: 0, state: 100 });
    controller.addSnapshot({ frame: 300, state: 200 });
    controller.addSnapshot({ frame: 600, state: 300 });

    expect(controller.findSnapshotForFrame(0)).toMatchObject({ frame: 0 });
    expect(controller.findSnapshotForFrame(150)).toMatchObject({ frame: 0 });
    expect(controller.findSnapshotForFrame(300)).toMatchObject({ frame: 300 });
    expect(controller.findSnapshotForFrame(450)).toMatchObject({ frame: 300 });
    expect(controller.findSnapshotForFrame(600)).toMatchObject({ frame: 600 });
    expect(controller.findSnapshotForFrame(9999)).toMatchObject({ frame: 600 });
  });

  it('findSnapshotForFrame returns null when no snapshot is at or before target', () => {
    expect(controller.findSnapshotForFrame(100)).toBeNull();
    controller.addSnapshot({ frame: 50, state: 0 });
    expect(controller.findSnapshotForFrame(0)).toBeNull();
    expect(controller.findSnapshotForFrame(49)).toBeNull();
    expect(controller.findSnapshotForFrame(50)).toMatchObject({ frame: 50 });
  });

  it('findSnapshotForFrame validates targetFrame', () => {
    expect(() => controller.findSnapshotForFrame(-1)).toThrow(/non-negative/);
    expect(() => controller.findSnapshotForFrame(1.5)).toThrow(/integer/);
  });
});

// ---------------------------------------------------------------------------
// Rewind happy path — re-simulation correctness
// ---------------------------------------------------------------------------

describe('RewindController — rewind correctness', () => {
  it('rewinds to an exact snapshot frame with zero re-simulation', () => {
    const buffer = buildDeterministicTimeline(1000, 1);
    const sim = new ToySimulator();
    const controller = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: (s) => sim.restore(s.state),
      simulateStep: (f, i) => sim.step(f, i),
    });
    controller.addSnapshot({ frame: 0, state: 0 });
    controller.addSnapshot({ frame: 300, state: 12345 });

    const result = controller.rewindTo(300);
    expect(result.status).toBe('success');
    expect(result.simulatedFrames).toBe(0);
    expect(result.haltedAtFrame).toBe(300);
    expect(result.restoredFrom?.frame).toBe(300);
    expect(sim.state).toBe(12345);
  });

  it('rewinds to a mid-interval frame by re-simulating from snapshot', () => {
    const buffer = buildDeterministicTimeline(1000, 1);
    const sim = new ToySimulator();
    const controller = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: (s) => sim.restore(s.state),
      simulateStep: (f, i) => sim.step(f, i),
    });

    // Walk the simulator forward to 600, capturing snapshots at 0/300/600.
    controller.addSnapshot({ frame: 0, state: 0 });
    for (let f = 1; f <= 300; f += 1) {
      sim.step(f, buffer.getFrame(f)?.inputs ?? null);
    }
    const stateAt300 = sim.state;
    controller.addSnapshot({ frame: 300, state: stateAt300 });
    for (let f = 301; f <= 600; f += 1) {
      sim.step(f, buffer.getFrame(f)?.inputs ?? null);
    }
    const stateAt600 = sim.state;
    controller.addSnapshot({ frame: 600, state: stateAt600 });

    // Now corrupt the simulator state so a successful rewind has to
    // truly restore + re-simulate.
    sim.state = -99999;

    // Rewind to frame 420 — expect snapshot at 300, re-simulate 120
    // frames forward.
    const result = controller.rewindTo(420);
    expect(result.status).toBe('success');
    expect(result.restoredFrom?.frame).toBe(300);
    expect(result.simulatedFrames).toBe(120);

    // Compute the expected state independently with a fresh simulator:
    // it should match the corrupted-then-restored simulator exactly.
    const oracle = new ToySimulator();
    oracle.restore(stateAt300);
    for (let f = 301; f <= 420; f += 1) {
      oracle.step(f, buffer.getFrame(f)?.inputs ?? null);
    }
    expect(sim.state).toBe(oracle.state);
  });

  it('rewinds to frame 0 when there is a frame-0 snapshot', () => {
    const buffer = buildDeterministicTimeline(50, 1);
    const sim = new ToySimulator(0);
    const controller = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: (s) => sim.restore(s.state),
      simulateStep: (f, i) => sim.step(f, i),
    });
    controller.addSnapshot({ frame: 0, state: 0 });

    // Walk forward.
    for (let f = 1; f <= 30; f += 1) sim.step(f, buffer.getFrame(f)?.inputs ?? null);
    expect(sim.state).not.toBe(0);

    const result = controller.rewindTo(0);
    expect(result.status).toBe('success');
    expect(result.simulatedFrames).toBe(0);
    expect(sim.state).toBe(0);
  });

  it('rewinds across multiple intervals — picks the nearest snapshot', () => {
    const buffer = buildDeterministicTimeline(2000, 1);
    const sim = new ToySimulator();
    const controller = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: (s) => sim.restore(s.state),
      simulateStep: (f, i) => sim.step(f, i),
    });

    // Capture snapshots at 0, 300, 600, 900, 1200, 1500.
    const snapshotStates: Map<number, number> = new Map();
    controller.addSnapshot({ frame: 0, state: 0 });
    snapshotStates.set(0, 0);
    for (let snapFrame = 300; snapFrame <= 1500; snapFrame += 300) {
      const lastFrame =
        sim.history.length === 0
          ? 0
          : sim.history[sim.history.length - 1]!.frame;
      for (let f = lastFrame + 1; f <= snapFrame; f += 1) {
        sim.step(f, buffer.getFrame(f)?.inputs ?? null);
      }
      controller.addSnapshot({ frame: snapFrame, state: sim.state });
      snapshotStates.set(snapFrame, sim.state);
    }

    // Now rewind to 1450 — should pick snapshot 1200, re-simulate 250.
    sim.state = 1234567;
    const r1 = controller.rewindTo(1450);
    expect(r1.status).toBe('success');
    expect(r1.restoredFrom?.frame).toBe(1200);
    expect(r1.simulatedFrames).toBe(250);

    // Now rewind to 750 — should pick snapshot 600, re-simulate 150.
    sim.state = 999;
    const r2 = controller.rewindTo(750);
    expect(r2.status).toBe('success');
    expect(r2.restoredFrom?.frame).toBe(600);
    expect(r2.simulatedFrames).toBe(150);

    // The state at frame 750 must equal what an oracle simulator
    // produces walking 0 → 750 from scratch.
    const oracle = new ToySimulator();
    for (let f = 1; f <= 750; f += 1) oracle.step(f, buffer.getFrame(f)?.inputs ?? null);
    expect(sim.state).toBe(oracle.state);
  });
});

// ---------------------------------------------------------------------------
// Determinism contract
// ---------------------------------------------------------------------------

describe('RewindController — determinism', () => {
  it('two rewinds to the same target produce bit-identical state', () => {
    const buffer = buildDeterministicTimeline(800, 1);
    const sim = new ToySimulator();
    const controller = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: (s) => sim.restore(s.state),
      simulateStep: (f, i) => sim.step(f, i),
    });

    controller.addSnapshot({ frame: 0, state: 0 });
    for (let f = 1; f <= 600; f += 1) sim.step(f, buffer.getFrame(f)?.inputs ?? null);
    controller.addSnapshot({ frame: 600, state: sim.state });

    // Walk past 600 to dirty the simulator.
    for (let f = 601; f <= 750; f += 1) sim.step(f, buffer.getFrame(f)?.inputs ?? null);
    const dirtyState = sim.state;

    // First rewind.
    controller.rewindTo(700);
    const stateA = sim.state;

    // Dirty again.
    sim.state = dirtyState + 999;

    // Second rewind to the same target.
    controller.rewindTo(700);
    const stateB = sim.state;

    expect(stateA).toBe(stateB);
  });

  it('two RewindControllers with the same inputs produce the same state', () => {
    const buffer = buildDeterministicTimeline(500, 1);

    const simA = new ToySimulator();
    const ctrlA = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: (s) => simA.restore(s.state),
      simulateStep: (f, i) => simA.step(f, i),
    });
    ctrlA.addSnapshot({ frame: 0, state: 0 });

    const simB = new ToySimulator();
    const ctrlB = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: (s) => simB.restore(s.state),
      simulateStep: (f, i) => simB.step(f, i),
    });
    ctrlB.addSnapshot({ frame: 0, state: 0 });

    ctrlA.rewindTo(400);
    ctrlB.rewindTo(400);

    expect(simA.state).toBe(simB.state);
    expect(simA.history).toEqual(simB.history);
  });

  it('rewind-then-walk-forward equals walk-forward from genesis', () => {
    const buffer = buildDeterministicTimeline(400, 1);

    // Oracle: walk 0 → 350 from scratch.
    const oracle = new ToySimulator();
    for (let f = 1; f <= 350; f += 1) oracle.step(f, buffer.getFrame(f)?.inputs ?? null);
    const oracleState = oracle.state;

    // Subject: walk 0 → 200, snapshot, walk to 300, rewind to 200, walk to 350.
    const sim = new ToySimulator();
    const controller = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: (s) => sim.restore(s.state),
      simulateStep: (f, i) => sim.step(f, i),
    });
    controller.addSnapshot({ frame: 0, state: 0 });
    for (let f = 1; f <= 200; f += 1) sim.step(f, buffer.getFrame(f)?.inputs ?? null);
    controller.addSnapshot({ frame: 200, state: sim.state });
    for (let f = 201; f <= 300; f += 1) sim.step(f, buffer.getFrame(f)?.inputs ?? null);
    controller.rewindTo(200);
    expect(sim.state).toBe(controller.getSnapshots()[1]!.state);
    // Walk forward via the controller's simulator (matches the live
    // host's behaviour after seeking the playback cursor and resuming).
    for (let f = 201; f <= 350; f += 1) sim.step(f, buffer.getFrame(f)?.inputs ?? null);

    expect(sim.state).toBe(oracleState);
  });
});

// ---------------------------------------------------------------------------
// Sparse timeline handling
// ---------------------------------------------------------------------------

describe('RewindController — sparse timeline', () => {
  it('forwards null sampleFrame results unchanged to simulateStep', () => {
    const calls: Array<{ frame: number; inputs: unknown }> = [];
    const synthetic: RewindInputSource = {
      sampleFrame: (frame) => (frame % 2 === 0 ? null : [NEUTRAL_INPUT]),
      getPlayerCount: () => 1,
    };
    const sim = new ToySimulator();
    const controller = new RewindController<number>({
      inputSource: synthetic,
      restoreSnapshot: (s) => sim.restore(s.state),
      simulateStep: (frame, inputs) => {
        calls.push({ frame, inputs });
        sim.step(frame, inputs);
      },
    });
    controller.addSnapshot({ frame: 0, state: 0 });
    controller.rewindTo(4);

    expect(calls).toEqual([
      { frame: 1, inputs: [NEUTRAL_INPUT] },
      { frame: 2, inputs: null },
      { frame: 3, inputs: [NEUTRAL_INPUT] },
      { frame: 4, inputs: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Failure modes
// ---------------------------------------------------------------------------

describe('RewindController — failures', () => {
  it('rejects a target with no enclosing snapshot', () => {
    const buffer = buildDeterministicTimeline(50, 1);
    const sim = new ToySimulator();
    const controller = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: (s) => sim.restore(s.state),
      simulateStep: (f, i) => sim.step(f, i),
    });
    expect(() => controller.rewindTo(10)).toThrow(/no snapshot/);

    controller.addSnapshot({ frame: 30, state: 99 });
    expect(() => controller.rewindTo(10)).toThrow(/no snapshot/);
    // 30 itself works.
    expect(controller.rewindTo(30).status).toBe('success');
  });

  it('rejects negative / non-integer target frames', () => {
    const buffer = new InputCaptureBuffer({ playerCount: 1 });
    const sim = new ToySimulator();
    const controller = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: (s) => sim.restore(s.state),
      simulateStep: (f, i) => sim.step(f, i),
    });
    controller.addSnapshot({ frame: 0, state: 0 });
    expect(() => controller.rewindTo(-1)).toThrow(/non-negative/);
    expect(() => controller.rewindTo(1.5)).toThrow(/integer/);
  });

  it('throws if rewind would re-simulate more than the cap', () => {
    const buffer = buildDeterministicTimeline(2000, 1);
    const sim = new ToySimulator();
    const controller = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: (s) => sim.restore(s.state),
      simulateStep: (f, i) => sim.step(f, i),
      maxSimulatedFramesPerRewind: 100,
    });
    controller.addSnapshot({ frame: 0, state: 0 });
    expect(() => controller.rewindTo(500)).toThrow(/exceeding the cap/);
    // The cap throw fires BEFORE restore, so the simulator stays clean.
    expect(sim.state).toBe(0);
  });

  it('failed restoreSnapshot throws and is reported as failure', () => {
    const buffer = buildDeterministicTimeline(50, 1);
    const sim = new ToySimulator();
    const restoreErr = new Error('synthetic restore failure');
    const controller = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: () => {
        throw restoreErr;
      },
      simulateStep: (f, i) => sim.step(f, i),
    });
    controller.addSnapshot({ frame: 0, state: 0 });

    expect(() => controller.rewindTo(20)).toThrow(/synthetic restore failure/);
    expect(controller.getStats().failureCount).toBe(1);
    expect(controller.getStats().rewindCount).toBe(1);
  });

  it('failed simulateStep aborts at the failing frame', () => {
    const buffer = buildDeterministicTimeline(50, 1);
    const sim = new ToySimulator();
    const stepErr = new Error('synthetic step failure');
    const controller = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: (s) => sim.restore(s.state),
      simulateStep: (frame) => {
        if (frame === 5) throw stepErr;
        sim.step(frame, null);
      },
    });
    controller.addSnapshot({ frame: 0, state: 0 });
    expect(() => controller.rewindTo(20)).toThrow(/synthetic step failure/);
    // Stats reflect a failed rewind at frame 5.
    expect(controller.getStats().failureCount).toBe(1);
    // Frames 1..4 successfully ran before the failure.
    expect(sim.history.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Stats and reset
// ---------------------------------------------------------------------------

describe('RewindController — stats and reset', () => {
  it('tracks rewindCount and totalSimulatedFrames across calls', () => {
    const buffer = buildDeterministicTimeline(800, 1);
    const sim = new ToySimulator();
    const controller = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: (s) => sim.restore(s.state),
      simulateStep: (f, i) => sim.step(f, i),
    });
    controller.addSnapshot({ frame: 0, state: 0 });
    for (let f = 1; f <= 600; f += 1) sim.step(f, buffer.getFrame(f)?.inputs ?? null);
    controller.addSnapshot({ frame: 600, state: sim.state });

    controller.rewindTo(700); // 100 frames re-simulated
    controller.rewindTo(650); // 50  frames re-simulated
    controller.rewindTo(600); // 0   frames (exact-snapshot hit)

    const stats = controller.getStats();
    expect(stats.rewindCount).toBe(3);
    expect(stats.totalSimulatedFrames).toBe(150);
    expect(stats.exactSnapshotHits).toBe(1);
    expect(stats.failureCount).toBe(0);
  });

  it('reset clears snapshots and counters but preserves callbacks', () => {
    const buffer = buildDeterministicTimeline(50, 1);
    const sim = new ToySimulator();
    const controller = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: (s) => sim.restore(s.state),
      simulateStep: (f, i) => sim.step(f, i),
    });
    controller.addSnapshot({ frame: 0, state: 0 });
    controller.rewindTo(10);

    expect(controller.getSnapshotCount()).toBe(1);
    expect(controller.getStats().rewindCount).toBe(1);

    controller.reset();

    expect(controller.getSnapshotCount()).toBe(0);
    expect(controller.getStats()).toEqual({
      rewindCount: 0,
      totalSimulatedFrames: 0,
      exactSnapshotHits: 0,
      failureCount: 0,
    });

    // Callbacks still functional — re-arm and rewind again.
    controller.addSnapshot({ frame: 0, state: 42 });
    sim.state = 999;
    controller.rewindTo(0);
    expect(sim.state).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Integration with InputCaptureBuffer and ReplayPlaybackController
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

describe('RewindController — integration with replay primitives', () => {
  it('rewinds correctly when the input source is an InputCaptureBuffer', () => {
    const buffer = buildDeterministicTimeline(500, 1);
    const sim = new ToySimulator();
    const controller = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: (s) => sim.restore(s.state),
      simulateStep: (f, i) => sim.step(f, i),
    });
    controller.addSnapshot({ frame: 0, state: 0 });
    controller.rewindTo(250);

    const oracle = new ToySimulator();
    for (let f = 1; f <= 250; f += 1) oracle.step(f, buffer.getFrame(f)?.inputs ?? null);
    expect(sim.state).toBe(oracle.state);
  });

  it('rewinds correctly when the input source is a ReplayPlaybackController', () => {
    // Build a replay file from a recorded buffer.
    const buffer = new InputCaptureBuffer({ playerCount: 1 });
    for (let f = 0; f < 400; f += 1) {
      const moveX = (f % 3) - 1; // -1, 0, 1, -1, 0, 1, ...
      buffer.captureFrame(f, [{ moveX, jump: false, attack: false }]);
    }
    const replay = serializeReplay({
      matchConfig: makeMatchConfig({
        rngSeed: 0xdeadbeef,
        players: [makePlayerSlots(1)[0]!],
      }),
      capturedFrames: buffer.getEntries(),
    });

    const playback = new ReplayPlaybackController({ replay });
    const sim = new ToySimulator();
    const controller = new RewindController<number>({
      inputSource: playback,
      restoreSnapshot: (s) => sim.restore(s.state),
      simulateStep: (f, i) => sim.step(f, i),
    });
    controller.addSnapshot({ frame: 0, state: 0 });

    // Rewind to frame 200.
    controller.rewindTo(200);

    // Oracle: walk a fresh simulator forward through the same buffer.
    const oracle = new ToySimulator();
    for (let f = 1; f <= 200; f += 1) {
      const captured = buffer.getFrame(f);
      oracle.step(f, captured ? captured.inputs : null);
    }
    expect(sim.state).toBe(oracle.state);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: VCR-style sequence of rewinds at arbitrary timestamps
// ---------------------------------------------------------------------------

describe('RewindController — VCR scrub sequence', () => {
  it('a sequence of arbitrary backward seeks all converge with the oracle', () => {
    const buffer = buildDeterministicTimeline(1500, 1);
    const sim = new ToySimulator();
    const controller = new RewindController<number>({
      inputSource: buffer,
      restoreSnapshot: (s) => sim.restore(s.state),
      simulateStep: (f, i) => sim.step(f, i),
    });

    // Seed a snapshot at every 300-frame boundary while walking forward.
    controller.addSnapshot({ frame: 0, state: 0 });
    for (let f = 1; f <= 1200; f += 1) {
      sim.step(f, buffer.getFrame(f)?.inputs ?? null);
      if (f % 300 === 0) controller.addSnapshot({ frame: f, state: sim.state });
    }

    // Now scrub: backward to 1100 (uses snap 900), backward to 50 (uses snap 0),
    // backward to 700 (uses snap 600), backward to 350 (uses snap 300).
    const targets = [1100, 50, 700, 350];
    for (const target of targets) {
      controller.rewindTo(target);
      const oracle = new ToySimulator();
      for (let f = 1; f <= target; f += 1) {
        oracle.step(f, buffer.getFrame(f)?.inputs ?? null);
      }
      expect(sim.state).toBe(oracle.state);
    }
  });
});
