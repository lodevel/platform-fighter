import { describe, it, expect, beforeEach } from 'vitest';
import type { CharacterInput } from '../characters/Character';
import type { MatchConfig, PlayerSlot } from '../types';
import {
  InputCaptureBuffer,
  NEUTRAL_INPUT,
  type CapturedFrame,
  type RecordedCharacterInput,
} from './InputCaptureBuffer';
import { serializeReplay } from './ReplayFile';
import type { ReplayFile } from './replayTypes';
import { ReplayPlaybackController } from './ReplayPlaybackController';

/**
 * AC 30201 Sub-AC 1 — replay playback controller.
 *
 * Coverage map:
 *
 *   • Construction — IDLE phase, no replay loaded.
 *   • load() — validates the replay shape, transitions IDLE → LOADED,
 *     parks cursor at first recorded frame.
 *   • start() — LOADED → PLAYING; idempotent in PLAYING; rejects from
 *     IDLE; empty timeline goes straight to FINISHED.
 *   • sampleFrame() / samplePlayer() — random-access lookup matches
 *     the recorded inputs byte-for-byte; null on missing frames.
 *   • advance() — cursor-walk read, post-increments, returns null past
 *     the end, transitions to FINISHED.
 *   • seek() — moves the cursor; in-range returns to PLAYING; out-of-
 *     range goes to FINISHED.
 *   • reset() — drops state, returns to IDLE so a subsequent load can
 *     run.
 *   • Integration — feeds a recorder's serialised buffer back into a
 *     new buffer with byte-equal inputs.
 *   • Determinism — playback is a pure function of (replay, cursor).
 */

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
 * Build a recorded `ReplayFile` by feeding a sequence into a real
 * `InputCaptureBuffer` and serialising — exactly the way the recorder
 * produces files. Keeps the tests honest: a bug that breaks recorder /
 * playback symmetry would show up here.
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

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('ReplayPlaybackController — construction', () => {
  it('starts in IDLE with no replay loaded', () => {
    const c = new ReplayPlaybackController();
    expect(c.getPhase()).toBe('idle');
    expect(c.isLoaded()).toBe(false);
    expect(c.isPlaying()).toBe(false);
    expect(c.isFinished()).toBe(false);
    expect(c.getReplay()).toBeNull();
    expect(c.getMatchConfig()).toBeNull();
    expect(c.getRngSeed()).toBeNull();
    expect(c.getPlayerCount()).toBe(0);
    expect(c.getFrameCount()).toBe(0);
    expect(c.getFirstFrame()).toBeNull();
    expect(c.getLastFrame()).toBeNull();
    expect(c.getCurrentFrame()).toBe(0);
    expect(c.getEntries()).toEqual([]);
  });

  it('exposes a status snapshot in IDLE', () => {
    const c = new ReplayPlaybackController();
    const status = c.getStatus();
    expect(status.phase).toBe('idle');
    expect(status.frameCount).toBe(0);
    expect(status.firstFrame).toBeNull();
    expect(status.lastFrame).toBeNull();
    expect(status.currentFrame).toBe(0);
    expect(status.isPlaying).toBe(false);
    expect(status.isFinished).toBe(false);
  });

  it('returns a frozen status snapshot', () => {
    const c = new ReplayPlaybackController();
    expect(Object.isFrozen(c.getStatus())).toBe(true);
  });

  it('accepts a replay in the constructor', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }, { moveX: 0, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: true }, { moveX: -1, moveY: 0, jump: false }],
    ]);
    const c = new ReplayPlaybackController({ replay });
    expect(c.getPhase()).toBe('loaded');
    expect(c.getFrameCount()).toBe(2);
  });

  it('respects startFrame override in constructor', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: true }],
      [2, { moveX: -1, moveY: 0, jump: false }],
    ]);
    const c = new ReplayPlaybackController({ replay, startFrame: 2 });
    expect(c.getCurrentFrame()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// load()
// ---------------------------------------------------------------------------

describe('ReplayPlaybackController — load', () => {
  let c: ReplayPlaybackController;

  beforeEach(() => {
    c = new ReplayPlaybackController();
  });

  it('transitions IDLE → LOADED', () => {
    const replay = makeReplay([[0, { moveX: 1, moveY: 0, jump: false }]]);
    c.load(replay);
    expect(c.getPhase()).toBe('loaded');
    expect(c.isLoaded()).toBe(true);
  });

  it('parks the cursor at the first recorded frame', () => {
    const replay = makeReplay([
      [10, { moveX: 1, moveY: 0, jump: false }],
      [11, { moveX: 0, moveY: 0, jump: false }],
      [12, { moveX: -1, moveY: 0, jump: true }],
    ]);
    c.load(replay);
    expect(c.getCurrentFrame()).toBe(10);
    expect(c.getFirstFrame()).toBe(10);
    expect(c.getLastFrame()).toBe(12);
    expect(c.getFrameCount()).toBe(3);
  });

  it('exposes match config + seed for match-init bootstrap', () => {
    const replay = makeReplay([[0, { moveX: 0, moveY: 0, jump: false }]]);
    c.load(replay);
    const cfg = c.getMatchConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.stageId).toBe('flatlands');
    expect(cfg!.players).toHaveLength(2);
    // Seed is `>>> 0`-clamped by the serialiser; the controller exposes
    // whatever the file carries.
    expect(c.getRngSeed()).toBe(0xc0ffee);
  });

  it('exposes the loaded replay file', () => {
    const replay = makeReplay([[0, { moveX: 0, moveY: 0, jump: false }]]);
    c.load(replay);
    expect(c.getReplay()).toBe(replay);
  });

  it('exposes the player count', () => {
    const replay = makeReplay([[0, { moveX: 0, moveY: 0, jump: false }]], 1);
    c.load(replay);
    expect(c.getPlayerCount()).toBe(1);
  });

  it('refuses to load while not IDLE', () => {
    const replay = makeReplay([[0, { moveX: 0, moveY: 0, jump: false }]]);
    c.load(replay);
    expect(() => c.load(replay)).toThrow(/cannot load while phase is/);
  });

  it('rejects null replay', () => {
    expect(() => c.load(null as unknown as ReplayFile)).toThrow(
      /must be a non-null object/,
    );
  });

  it('rejects replay missing inputTimeline.entries', () => {
    const broken = {
      inputTimeline: { playerCount: 2, entries: 'not-an-array' as unknown },
    } as unknown as ReplayFile;
    expect(() => c.load(broken)).toThrow(/entries must be an array/);
  });

  it('rejects replay with non-integer playerCount', () => {
    const broken = {
      inputTimeline: { playerCount: 2.5, entries: [] },
    } as unknown as ReplayFile;
    expect(() => c.load(broken)).toThrow(/playerCount/);
  });

  it('rejects replay with playerCount out of 1..4 range', () => {
    const broken5 = {
      inputTimeline: { playerCount: 5, entries: [] },
    } as unknown as ReplayFile;
    expect(() => c.load(broken5)).toThrow(/playerCount/);
    const broken0 = {
      inputTimeline: { playerCount: 0, entries: [] },
    } as unknown as ReplayFile;
    expect(() => c.load(broken0)).toThrow(/playerCount/);
  });

  it('rejects timeline entries that are not objects', () => {
    const broken = {
      inputTimeline: {
        playerCount: 1,
        entries: ['nope' as unknown],
      },
    } as unknown as ReplayFile;
    expect(() => c.load(broken)).toThrow(/malformed timeline entry/);
  });

  it('propagates buffer monotonic-frame validation errors', () => {
    // A hand-edited file with frames out of order should be rejected.
    const broken = {
      inputTimeline: {
        playerCount: 1,
        entries: [
          { frame: 5, inputs: [{ moveX: 0, moveY: 0, jump: false }] },
          { frame: 3, inputs: [{ moveX: 0, moveY: 0, jump: false }] }, // rewind
        ],
      },
    } as unknown as ReplayFile;
    expect(() => c.load(broken)).toThrow(/monotonic/);
  });

  it('rejects negative startFrame', () => {
    const replay = makeReplay([[0, { moveX: 0, moveY: 0, jump: false }]]);
    expect(() => c.load(replay, -1)).toThrow(/non-negative/);
  });

  it('handles empty timeline (firstFrame / lastFrame are null)', () => {
    const replay = makeReplay([]);
    c.load(replay);
    expect(c.getPhase()).toBe('loaded');
    expect(c.getFirstFrame()).toBeNull();
    expect(c.getLastFrame()).toBeNull();
    expect(c.getFrameCount()).toBe(0);
    expect(c.getCurrentFrame()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// start()
// ---------------------------------------------------------------------------

describe('ReplayPlaybackController — start', () => {
  it('transitions LOADED → PLAYING', () => {
    const replay = makeReplay([[0, { moveX: 1, moveY: 0, jump: false }]]);
    const c = new ReplayPlaybackController({ replay });
    c.start();
    expect(c.getPhase()).toBe('playing');
    expect(c.isPlaying()).toBe(true);
  });

  it('is idempotent in PLAYING', () => {
    const replay = makeReplay([[0, { moveX: 1, moveY: 0, jump: false }]]);
    const c = new ReplayPlaybackController({ replay });
    c.start();
    expect(() => c.start()).not.toThrow();
    expect(c.getPhase()).toBe('playing');
  });

  it('rejects start from IDLE', () => {
    const c = new ReplayPlaybackController();
    expect(() => c.start()).toThrow(/cannot start from phase 'idle'/);
  });

  it('rejects start from FINISHED (caller must seek/reset first)', () => {
    const replay = makeReplay([[0, { moveX: 1, moveY: 0, jump: false }]]);
    const c = new ReplayPlaybackController({ replay });
    c.stop();
    expect(c.getPhase()).toBe('finished');
    expect(() => c.start()).toThrow(/cannot start from phase 'finished'/);
  });

  it('empty timeline starts directly in FINISHED', () => {
    const replay = makeReplay([]);
    const c = new ReplayPlaybackController({ replay });
    c.start();
    expect(c.getPhase()).toBe('finished');
    expect(c.isFinished()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sampleFrame / samplePlayer — random access
// ---------------------------------------------------------------------------

describe('ReplayPlaybackController — sampleFrame', () => {
  it('returns the recorded inputs for a captured frame', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }, { moveX: -1, moveY: 0, jump: true }],
      [1, { moveX: 0, moveY: 0, jump: true, attack: true }, { moveX: 0, moveY: 0, jump: false }],
    ]);
    const c = new ReplayPlaybackController({ replay });

    const f0 = c.sampleFrame(0)!;
    expect(f0).toHaveLength(2);
    expect(f0[0]).toEqual({
      moveX: 1, moveY: 0,
      jump: false,
      attack: false,
      dropThrough: false,
    });
    expect(f0[1]).toEqual({
      moveX: -1, moveY: 0,
      jump: true,
      attack: false,
      dropThrough: false,
    });

    const f1 = c.sampleFrame(1)!;
    expect(f1[0]).toEqual({
      moveX: 0, moveY: 0,
      jump: true,
      attack: true,
      dropThrough: false,
    });
  });

  it('returns null for frames not in the timeline', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [10, { moveX: 0, moveY: 0, jump: true }],
    ]);
    const c = new ReplayPlaybackController({ replay });
    expect(c.sampleFrame(5)).toBeNull();
    expect(c.sampleFrame(100)).toBeNull();
    expect(c.sampleFrame(-1)).toBeNull();
  });

  it('returns null when nothing is loaded', () => {
    const c = new ReplayPlaybackController();
    expect(c.sampleFrame(0)).toBeNull();
  });

  it('does not advance the cursor', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: false }],
    ]);
    const c = new ReplayPlaybackController({ replay });
    expect(c.getCurrentFrame()).toBe(0);
    c.sampleFrame(1);
    c.sampleFrame(0);
    expect(c.getCurrentFrame()).toBe(0);
  });
});

describe('ReplayPlaybackController — samplePlayer', () => {
  it('returns a single player slot for a captured frame', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }, { moveX: -1, moveY: 0, jump: true }],
    ]);
    const c = new ReplayPlaybackController({ replay });
    expect(c.samplePlayer(0, 0)!.moveX).toBe(1);
    expect(c.samplePlayer(0, 1)!.jump).toBe(true);
  });

  it('returns null for missing frame or out-of-range slot', () => {
    const replay = makeReplay([[0, { moveX: 1, moveY: 0, jump: false }]], 2);
    const c = new ReplayPlaybackController({ replay });
    expect(c.samplePlayer(99, 0)).toBeNull();
    // Slot 2 doesn't exist in a 2P replay; same convention as
    // InputCaptureBuffer.getPlayerInput.
    expect(c.samplePlayer(0, 2 as unknown as 0 | 1)).toBeNull();
  });

  it('returns null when nothing is loaded', () => {
    const c = new ReplayPlaybackController();
    expect(c.samplePlayer(0, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// advance() — cursor-walk feed
// ---------------------------------------------------------------------------

describe('ReplayPlaybackController — advance', () => {
  it('returns the inputs for the cursor frame and post-increments', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }, { moveX: -1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: true }, { moveX: 0, moveY: 0, jump: false }],
      [2, { moveX: -1, moveY: 0, jump: false }, { moveX: 1, moveY: 0, jump: true }],
    ]);
    const c = new ReplayPlaybackController({ replay });
    c.start();

    const a = c.advance()!;
    expect(c.getCurrentFrame()).toBe(1);
    expect(a[0]!.moveX).toBe(1);
    expect(a[1]!.moveX).toBe(-1);

    const b = c.advance()!;
    expect(c.getCurrentFrame()).toBe(2);
    expect(b[0]!.jump).toBe(true);
    expect(b[1]!.jump).toBe(false);

    const cInputs = c.advance()!;
    expect(cInputs[0]!.moveX).toBe(-1);
    expect(cInputs[1]!.jump).toBe(true);
  });

  it('transitions to FINISHED after reading the last frame', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: false }],
    ]);
    const c = new ReplayPlaybackController({ replay });
    c.start();
    c.advance(); // frame 0 → cursor=1, still PLAYING
    expect(c.getPhase()).toBe('playing');
    c.advance(); // frame 1 (last) → cursor=2, FINISHED
    expect(c.getPhase()).toBe('finished');
    expect(c.isFinished()).toBe(true);
  });

  it('rejects advance from non-PLAYING phases', () => {
    const c = new ReplayPlaybackController();
    expect(() => c.advance()).toThrow(/not playing/);

    const replay = makeReplay([[0, { moveX: 1, moveY: 0, jump: false }]]);
    c.load(replay);
    expect(() => c.advance()).toThrow(/not playing/); // LOADED, not PLAYING

    c.start();
    c.advance();
    expect(() => c.advance()).toThrow(/not playing/); // FINISHED
  });

  it('returns null for cursor frames not in the timeline (sparse gap)', () => {
    // The buffer permits non-contiguous frames; advance walks the
    // cursor by 1 each call regardless. Frames between the recorded
    // ones return null — caller treats as "no input recorded".
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [3, { moveX: 0, moveY: 0, jump: true }],
    ]);
    const c = new ReplayPlaybackController({ replay });
    c.start();
    expect(c.advance()).not.toBeNull(); // 0
    expect(c.advance()).toBeNull(); // 1 — gap
    expect(c.advance()).toBeNull(); // 2 — gap
    expect(c.advance()).not.toBeNull(); // 3 — last; transitions to FINISHED
    expect(c.getPhase()).toBe('finished');
  });
});

// ---------------------------------------------------------------------------
// seek() — VCR scrubbing primitive
// ---------------------------------------------------------------------------

describe('ReplayPlaybackController — seek', () => {
  it('moves the cursor to the requested frame', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: false }],
      [2, { moveX: -1, moveY: 0, jump: false }],
    ]);
    const c = new ReplayPlaybackController({ replay });
    c.start();
    c.seek(2);
    expect(c.getCurrentFrame()).toBe(2);
    expect(c.getPhase()).toBe('playing');
  });

  it('returns FINISHED → PLAYING when seeking back into the timeline', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: false }],
    ]);
    const c = new ReplayPlaybackController({ replay });
    c.start();
    c.advance();
    c.advance();
    expect(c.getPhase()).toBe('finished');
    c.seek(0);
    expect(c.getPhase()).toBe('playing');
    expect(c.getCurrentFrame()).toBe(0);
  });

  it('seeking past lastFrame transitions to FINISHED', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: false }],
    ]);
    const c = new ReplayPlaybackController({ replay });
    c.start();
    c.seek(99);
    expect(c.getPhase()).toBe('finished');
    expect(c.getCurrentFrame()).toBe(99);
  });

  it('rejects seek while IDLE', () => {
    const c = new ReplayPlaybackController();
    expect(() => c.seek(0)).toThrow(/nothing loaded/);
  });

  it('rejects negative or non-integer frames', () => {
    const replay = makeReplay([[0, { moveX: 1, moveY: 0, jump: false }]]);
    const c = new ReplayPlaybackController({ replay });
    expect(() => c.seek(-1)).toThrow(/non-negative/);
    expect(() => c.seek(1.5)).toThrow(/non-negative integer/);
    expect(() => c.seek(Number.NaN)).toThrow(/non-negative integer/);
  });

  it('seek into an empty timeline lands in FINISHED', () => {
    const replay = makeReplay([]);
    const c = new ReplayPlaybackController({ replay });
    c.seek(0);
    expect(c.getPhase()).toBe('finished');
  });
});

// ---------------------------------------------------------------------------
// stop()
// ---------------------------------------------------------------------------

describe('ReplayPlaybackController — stop', () => {
  it('transitions any non-IDLE phase to FINISHED', () => {
    const replay = makeReplay([[0, { moveX: 1, moveY: 0, jump: false }]]);
    const c = new ReplayPlaybackController({ replay });
    c.stop();
    expect(c.getPhase()).toBe('finished');
  });

  it('is a no-op while IDLE', () => {
    const c = new ReplayPlaybackController();
    c.stop();
    expect(c.getPhase()).toBe('idle');
  });

  it('is idempotent in FINISHED', () => {
    const replay = makeReplay([[0, { moveX: 1, moveY: 0, jump: false }]]);
    const c = new ReplayPlaybackController({ replay });
    c.stop();
    c.stop();
    expect(c.getPhase()).toBe('finished');
  });
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe('ReplayPlaybackController — reset', () => {
  it('returns to IDLE and drops state', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: false }],
    ]);
    const c = new ReplayPlaybackController({ replay });
    c.start();
    c.advance();
    c.reset();
    expect(c.getPhase()).toBe('idle');
    expect(c.getReplay()).toBeNull();
    expect(c.getCurrentFrame()).toBe(0);
    expect(c.getFirstFrame()).toBeNull();
    expect(c.getLastFrame()).toBeNull();
    expect(c.getFrameCount()).toBe(0);
  });

  it('allows a new load after reset', () => {
    const a = makeReplay([[0, { moveX: 1, moveY: 0, jump: false }]]);
    const b = makeReplay([
      [0, { moveX: 0, moveY: 0, jump: false }],
      [1, { moveX: -1, moveY: 0, jump: true }],
    ]);
    const c = new ReplayPlaybackController({ replay: a });
    c.start();
    c.reset();
    c.load(b);
    expect(c.getPhase()).toBe('loaded');
    expect(c.getFrameCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Integration with the recorder
// ---------------------------------------------------------------------------

describe('ReplayPlaybackController — recorder/playback symmetry', () => {
  it('inputs fed back through advance() are byte-equal to what was recorded', () => {
    // Construct a "recorded" sequence by hand, then prove the playback
    // controller emits the exact same RecordedCharacterInput shape.
    const sequence: Array<[number, CharacterInput, CharacterInput]> = [
      [0, { moveX: 0, moveY: 0, jump: false }, { moveX: 0, moveY: 0, jump: false }],
      [1, { moveX: 1, moveY: 0, jump: true }, { moveX: -1, moveY: 0, jump: false }],
      [
        2,
        { moveX: 1, moveY: 0, jump: false, attack: true },
        { moveX: 0, moveY: 0, jump: false },
      ],
      [
        3,
        { moveX: 0, moveY: 0, jump: false, dropThrough: true },
        { moveX: 1, moveY: 0, jump: true },
      ],
    ];

    const recorder = new InputCaptureBuffer({ playerCount: 2 });
    for (const [frame, p1, p2] of sequence) {
      recorder.captureFrame(frame, [p1, p2]);
    }
    const replay = serializeReplay({
      matchConfig: makeMatchConfig(),
      capturedFrames: recorder.getEntries(),
      recordedAt: new Date('2026-04-30T12:00:00.000Z'),
    });

    const playback = new ReplayPlaybackController({ replay });
    playback.start();

    for (const [frame, , ] of sequence) {
      const inputs = playback.advance()!;
      const recorded = recorder.getFrame(frame)!;
      // Compare as plain objects so frozen-vs-frozen identity doesn't
      // confuse the matcher.
      expect(inputs.map((x) => ({ ...x }))).toEqual(
        recorded.inputs.map((x) => ({ ...x })),
      );
    }
  });

  it('feeds inputs to a mock simulator frame-by-frame in cursor order', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }, { moveX: -1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: true }, { moveX: 0, moveY: 0, jump: false }],
      [2, { moveX: -1, moveY: 0, jump: false }, { moveX: 1, moveY: 0, jump: true }],
    ]);

    // Mock simulator: collects every input it sees per slot. Replaces
    // the live input source — no keyboard / gamepad / AI involvement.
    const seenP1: RecordedCharacterInput[] = [];
    const seenP2: RecordedCharacterInput[] = [];
    const fighters = [
      { applyInput: (i: RecordedCharacterInput) => seenP1.push(i) },
      { applyInput: (i: RecordedCharacterInput) => seenP2.push(i) },
    ];

    const c = new ReplayPlaybackController({ replay });
    c.start();
    while (c.isPlaying()) {
      const inputs = c.advance();
      if (inputs === null) continue;
      for (let i = 0; i < inputs.length; i += 1) {
        fighters[i]!.applyInput(inputs[i]!);
      }
    }

    expect(seenP1).toHaveLength(3);
    expect(seenP2).toHaveLength(3);
    expect(seenP1.map((x) => x.moveX)).toEqual([1, 0, -1]);
    expect(seenP1.map((x) => x.jump)).toEqual([false, true, false]);
    expect(seenP2.map((x) => x.moveX)).toEqual([-1, 0, 1]);
    expect(seenP2.map((x) => x.jump)).toEqual([false, false, true]);
  });

  it('preserves NEUTRAL_INPUT for slots the recorder captured as undefined', () => {
    // The recorder collapses an undefined slot input to NEUTRAL_INPUT.
    // The playback controller must round-trip that exactly — otherwise
    // an "eliminated player" frame would diverge from the original.
    const buffer = new InputCaptureBuffer({ playerCount: 2 });
    buffer.captureFrame(0, [{ moveX: 1, moveY: 0, jump: true, attack: true }, undefined]);
    buffer.captureFrame(1, [undefined, { moveX: -1, moveY: 0, jump: false }]);
    const replay = serializeReplay({
      matchConfig: makeMatchConfig(),
      capturedFrames: buffer.getEntries(),
    });

    const c = new ReplayPlaybackController({ replay });
    c.start();
    const f0 = c.advance()!;
    const f1 = c.advance()!;
    expect({ ...f0[1] }).toEqual(NEUTRAL_INPUT);
    expect({ ...f1[0] }).toEqual(NEUTRAL_INPUT);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('ReplayPlaybackController — determinism', () => {
  it('two controllers loaded from the same replay produce identical frame streams', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }, { moveX: -1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: true }, { moveX: 0, moveY: 0, jump: true }],
      [2, { moveX: -1, moveY: 0, jump: false }, { moveX: 1, moveY: 0, jump: false }],
      [3, { moveX: 0, moveY: 0, jump: false }, { moveX: 0, moveY: 0, jump: false }],
    ]);

    const a = new ReplayPlaybackController({ replay });
    const b = new ReplayPlaybackController({ replay });
    a.start();
    b.start();

    const aStream: RecordedCharacterInput[][] = [];
    const bStream: RecordedCharacterInput[][] = [];
    while (a.isPlaying() && b.isPlaying()) {
      const aFrame = a.advance();
      const bFrame = b.advance();
      if (aFrame === null || bFrame === null) break;
      aStream.push(aFrame.map((x) => ({ ...x })));
      bStream.push(bFrame.map((x) => ({ ...x })));
    }

    expect(aStream).toEqual(bStream);
    // Both controllers should land in FINISHED at exactly the same frame.
    expect(a.getCurrentFrame()).toBe(b.getCurrentFrame());
    expect(a.getPhase()).toBe('finished');
    expect(b.getPhase()).toBe('finished');
  });

  it('seek() + advance() reproduce the same inputs as a fresh playback', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [1, { moveX: 0, moveY: 0, jump: true }],
      [2, { moveX: -1, moveY: 0, jump: false }],
    ]);

    // Fresh playback from frame 1 onwards.
    const fresh = new ReplayPlaybackController({ replay, startFrame: 1 });
    fresh.start();
    const freshStream: RecordedCharacterInput[][] = [];
    while (fresh.isPlaying()) {
      const f = fresh.advance();
      if (f === null) break;
      freshStream.push(f.map((x) => ({ ...x })));
    }

    // Same controller, walked to the end then rewound via seek().
    const rewound = new ReplayPlaybackController({ replay });
    rewound.start();
    while (rewound.isPlaying()) rewound.advance();
    rewound.seek(1);
    const rewoundStream: RecordedCharacterInput[][] = [];
    while (rewound.isPlaying()) {
      const f = rewound.advance();
      if (f === null) break;
      rewoundStream.push(f.map((x) => ({ ...x })));
    }

    expect(freshStream).toEqual(rewoundStream);
  });
});

// ---------------------------------------------------------------------------
// getEntries — iteration view
// ---------------------------------------------------------------------------

describe('ReplayPlaybackController — getEntries', () => {
  it('exposes every captured frame in order', () => {
    const replay = makeReplay([
      [0, { moveX: 1, moveY: 0, jump: false }],
      [5, { moveX: 0, moveY: 0, jump: true }],
      [10, { moveX: -1, moveY: 0, jump: false }],
    ]);
    const c = new ReplayPlaybackController({ replay });
    const entries: ReadonlyArray<CapturedFrame> = c.getEntries();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.frame)).toEqual([0, 5, 10]);
  });

  it('returns an empty array while IDLE', () => {
    const c = new ReplayPlaybackController();
    expect(c.getEntries()).toEqual([]);
  });
});
