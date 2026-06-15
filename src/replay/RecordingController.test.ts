import { describe, it, expect, beforeEach } from 'vitest';
import type { MatchConfig, PlayerSlot } from '../types';
import {
  InputCaptureBuffer,
  NEUTRAL_INPUT,
} from './InputCaptureBuffer';
import {
  RecordingController,
  DEFAULT_REPLAY_FILE_NAME,
} from './RecordingController';
import {
  REPLAY_FORMAT_MAGIC,
  REPLAY_FORMAT_VERSION,
  REPLAY_FILE_EXTENSION,
  deserializeReplayFromString,
  ReplayFileError,
} from './ReplayFile';

/**
 * AC 30004 Sub-AC 4 — recording lifecycle controller.
 *
 * Coverage map:
 *
 *   • Construction — IDLE phase, no buffer until start.
 *   • start() — validates matchConfig, transitions to RECORDING,
 *     constructs the buffer, accepts notes.
 *   • captureFrame() — pass-through while recording, no-op otherwise.
 *   • stop() — transitions RECORDING → STOPPED, idempotent.
 *   • buildReplayFile() — produces a valid ReplayFile from STOPPED;
 *     rejects from IDLE / RECORDING.
 *   • reset() — returns to IDLE, drops state.
 *   • External buffer — re-uses caller-supplied buffer instead of
 *     constructing one; rejects on player-count mismatch.
 *   • suggestFileName() — sortable, sanitised, ends with extension.
 *   • Round-trip — serialised file deserialises back to equal data.
 *   • Determinism — fixed nowFactory produces stable replay metadata.
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

function makeFixedNow(): () => Date {
  return () => new Date('2026-04-30T12:00:00.000Z');
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('RecordingController — construction', () => {
  it('starts in IDLE with no buffer', () => {
    const c = new RecordingController();
    expect(c.getPhase()).toBe('idle');
    expect(c.isRecording()).toBe(false);
    expect(c.isStopped()).toBe(false);
    expect(c.getMatchConfig()).toBeNull();
    expect(c.getBuffer()).toBeNull();
  });

  it('exposes a status snapshot in IDLE', () => {
    const c = new RecordingController();
    const status = c.getStatus();
    expect(status.phase).toBe('idle');
    expect(status.frameCount).toBe(0);
    expect(status.lastFrame).toBeNull();
    expect(status.isRecording).toBe(false);
  });

  it('captureFrame is a no-op while IDLE', () => {
    const c = new RecordingController();
    expect(() =>
      c.captureFrame(0, [
        { moveX: 1, moveY: 0, jump: false, attack: false, dropThrough: false },
      ]),
    ).not.toThrow();
    expect(c.getStatus().frameCount).toBe(0);
  });

  it('stop is a no-op while IDLE', () => {
    const c = new RecordingController();
    expect(() => c.stop()).not.toThrow();
    expect(c.getPhase()).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

describe('RecordingController — start', () => {
  let c: RecordingController;
  beforeEach(() => {
    c = new RecordingController();
  });

  it('transitions IDLE → RECORDING', () => {
    c.start({ matchConfig: makeMatchConfig() });
    expect(c.getPhase()).toBe('recording');
    expect(c.isRecording()).toBe(true);
  });

  it('constructs an internal buffer sized to the player count', () => {
    c.start({ matchConfig: makeMatchConfig({ players: makePlayerSlots(4) }) });
    const buf = c.getBuffer();
    expect(buf).not.toBeNull();
    expect(buf!.getPlayerCount()).toBe(4);
  });

  it('captures the supplied MatchConfig reference', () => {
    const cfg = makeMatchConfig();
    c.start({ matchConfig: cfg });
    expect(c.getMatchConfig()).toBe(cfg);
  });

  it('rejects calling start twice without reset', () => {
    c.start({ matchConfig: makeMatchConfig() });
    expect(() =>
      c.start({ matchConfig: makeMatchConfig() }),
    ).toThrow(/cannot start recording while phase is/);
  });

  it('rejects null/undefined matchConfig', () => {
    expect(() =>
      c.start({ matchConfig: null as unknown as MatchConfig }),
    ).toThrow(/matchConfig is required/);
  });

  it('rejects non-finite rngSeed', () => {
    const broken = { ...makeMatchConfig(), rngSeed: NaN };
    expect(() => c.start({ matchConfig: broken })).toThrow(
      /rngSeed must be a finite number/,
    );
  });

  it('rejects empty player list', () => {
    const broken = { ...makeMatchConfig(), players: [] };
    expect(() => c.start({ matchConfig: broken })).toThrow(
      /players must contain 1..4 entries/,
    );
  });

  it('rejects too-many players', () => {
    const broken = {
      ...makeMatchConfig(),
      players: makePlayerSlots(4).concat(makePlayerSlots(1)),
    };
    expect(() => c.start({ matchConfig: broken })).toThrow(
      /players must contain 1..4 entries/,
    );
  });
});

// ---------------------------------------------------------------------------
// captureFrame
// ---------------------------------------------------------------------------

describe('RecordingController — captureFrame', () => {
  it('forwards inputs to the underlying buffer while RECORDING', () => {
    const c = new RecordingController();
    c.start({ matchConfig: makeMatchConfig() });
    c.captureFrame(0, [
      { moveX: 1, moveY: 0, jump: false, attack: false, dropThrough: false },
      { moveX: -1, moveY: 0, jump: true, attack: true, dropThrough: false },
    ]);
    c.captureFrame(1, [
      { moveX: 0, moveY: 0, jump: false, attack: false, dropThrough: false },
      { moveX: 0, moveY: 0, jump: false, attack: false, dropThrough: false },
    ]);
    const buf = c.getBuffer()!;
    expect(buf.size()).toBe(2);
    expect(buf.getLastFrame()).toBe(1);
  });

  it('treats undefined slot inputs as NEUTRAL_INPUT', () => {
    const c = new RecordingController();
    c.start({ matchConfig: makeMatchConfig() });
    c.captureFrame(0, [
      undefined,
      { moveX: 1, moveY: 0, jump: false, attack: false, dropThrough: false },
    ]);
    const captured = c.getBuffer()!.getFrame(0)!;
    expect(captured.inputs[0]).toEqual(NEUTRAL_INPUT);
    expect(captured.inputs[1]!.moveX).toBe(1);
  });

  it('is a no-op once stopped', () => {
    const c = new RecordingController();
    c.start({ matchConfig: makeMatchConfig() });
    c.captureFrame(0, [
      { moveX: 0, moveY: 0, jump: false, attack: false, dropThrough: false },
      { moveX: 0, moveY: 0, jump: false, attack: false, dropThrough: false },
    ]);
    c.stop();
    c.captureFrame(1, [
      { moveX: 1, moveY: 0, jump: false, attack: false, dropThrough: false },
      { moveX: 1, moveY: 0, jump: false, attack: false, dropThrough: false },
    ]);
    expect(c.getBuffer()!.size()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

describe('RecordingController — stop', () => {
  it('transitions RECORDING → STOPPED', () => {
    const c = new RecordingController();
    c.start({ matchConfig: makeMatchConfig() });
    c.stop();
    expect(c.getPhase()).toBe('stopped');
    expect(c.isStopped()).toBe(true);
    expect(c.isRecording()).toBe(false);
  });

  it('is idempotent — second stop is a no-op', () => {
    const c = new RecordingController();
    c.start({ matchConfig: makeMatchConfig() });
    c.stop();
    expect(() => c.stop()).not.toThrow();
    expect(c.getPhase()).toBe('stopped');
  });
});

// ---------------------------------------------------------------------------
// buildReplayFile
// ---------------------------------------------------------------------------

describe('RecordingController — buildReplayFile', () => {
  it('refuses to build from IDLE', () => {
    const c = new RecordingController();
    expect(() => c.buildReplayFile()).toThrow(/nothing recorded yet/);
  });

  it('refuses to build while RECORDING', () => {
    const c = new RecordingController();
    c.start({ matchConfig: makeMatchConfig() });
    expect(() => c.buildReplayFile()).toThrow(/still recording — call stop/);
  });

  it('builds a valid ReplayFile from STOPPED', () => {
    const c = new RecordingController({
      engineVersion: '1.2.3',
      nowFactory: makeFixedNow(),
    });
    c.start({ matchConfig: makeMatchConfig(), notes: 'best of three' });
    c.captureFrame(0, [
      { moveX: 1, moveY: 0, jump: false, attack: false, dropThrough: false },
      { moveX: 0, moveY: 0, jump: false, attack: false, dropThrough: false },
    ]);
    c.captureFrame(1, [
      { moveX: 0, moveY: 0, jump: true, attack: false, dropThrough: false },
      { moveX: 0, moveY: 0, jump: false, attack: true, dropThrough: false },
    ]);
    c.stop();
    const file = c.buildReplayFile();
    expect(file.format).toBe(REPLAY_FORMAT_MAGIC);
    expect(file.version).toBe(REPLAY_FORMAT_VERSION);
    expect(file.metadata.engineVersion).toBe('1.2.3');
    expect(file.metadata.notes).toBe('best of three');
    expect(file.metadata.recordedAt).toBe('2026-04-30T12:00:00.000Z');
    expect(file.metadata.durationFrames).toBe(2);
    expect(file.metadata.playerCount).toBe(2);
    expect(file.metadata.fixedTimestepMs).toBeCloseTo(1000 / 60, 6);
    expect(file.rngSeed).toBe(0xc0ffee);
    expect(file.matchConfig.rngSeed).toBe(0xc0ffee);
    expect(file.inputTimeline.entries.length).toBe(2);
    expect(file.inputTimeline.entries[0]!.inputs[0]!.moveX).toBe(1);
    expect(file.inputTimeline.entries[1]!.inputs[1]!.attack).toBe(true);
  });

  it('round-trips through the deserialiser', () => {
    const c = new RecordingController({ nowFactory: makeFixedNow() });
    c.start({ matchConfig: makeMatchConfig() });
    for (let f = 0; f < 5; f += 1) {
      c.captureFrame(f, [
        { moveX: f / 10, jump: false, attack: false, dropThrough: false },
        { moveX: -f / 10, jump: true, attack: false, dropThrough: false },
      ]);
    }
    c.stop();
    const json = c.buildReplayJson();
    const round = deserializeReplayFromString(json);
    expect(round.metadata.durationFrames).toBe(5);
    expect(round.inputTimeline.entries.length).toBe(5);
    expect(round.inputTimeline.entries[2]!.inputs[0]!.moveX).toBeCloseTo(0.2);
    expect(round.inputTimeline.entries[4]!.inputs[1]!.jump).toBe(true);
  });

  it('respects custom fixedTimestepMs', () => {
    const c = new RecordingController({
      fixedTimestepMs: 1000 / 30,
      nowFactory: makeFixedNow(),
    });
    c.start({ matchConfig: makeMatchConfig() });
    c.stop();
    expect(c.buildReplayFile().metadata.fixedTimestepMs).toBeCloseTo(1000 / 30, 6);
  });

  it('handles empty timelines (durationFrames === 0)', () => {
    const c = new RecordingController({ nowFactory: makeFixedNow() });
    c.start({ matchConfig: makeMatchConfig() });
    c.stop();
    const file = c.buildReplayFile();
    expect(file.metadata.durationFrames).toBe(0);
    expect(file.inputTimeline.entries.length).toBe(0);
  });

  it('seed clamps to unsigned 32-bit', () => {
    const c = new RecordingController({ nowFactory: makeFixedNow() });
    c.start({ matchConfig: makeMatchConfig({ rngSeed: -1 }) });
    c.stop();
    const file = c.buildReplayFile();
    expect(file.rngSeed).toBe(0xffffffff);
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe('RecordingController — reset', () => {
  it('returns the controller to IDLE and drops the buffer', () => {
    const c = new RecordingController();
    c.start({ matchConfig: makeMatchConfig() });
    c.captureFrame(0, [
      { moveX: 0, moveY: 0, jump: false, attack: false, dropThrough: false },
      { moveX: 0, moveY: 0, jump: false, attack: false, dropThrough: false },
    ]);
    c.reset();
    expect(c.getPhase()).toBe('idle');
    expect(c.getMatchConfig()).toBeNull();
    expect(c.getBuffer()).toBeNull();
  });

  it('allows starting a new recording after reset', () => {
    const c = new RecordingController();
    c.start({ matchConfig: makeMatchConfig() });
    c.stop();
    c.reset();
    expect(() => c.start({ matchConfig: makeMatchConfig() })).not.toThrow();
    expect(c.getPhase()).toBe('recording');
  });

  it('preserves an externally-supplied buffer (caller owns reset)', () => {
    const buf = new InputCaptureBuffer({ playerCount: 2 });
    const c = new RecordingController({ buffer: buf });
    c.start({ matchConfig: makeMatchConfig() });
    c.captureFrame(0, [
      { moveX: 0, moveY: 0, jump: false, attack: false, dropThrough: false },
      { moveX: 0, moveY: 0, jump: false, attack: false, dropThrough: false },
    ]);
    c.reset();
    // The external buffer is the same instance; the caller is
    // responsible for calling `buf.reset()` separately.
    expect(c.getBuffer()).toBeNull();
    expect(buf.size()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// External buffer
// ---------------------------------------------------------------------------

describe('RecordingController — external buffer', () => {
  it('reuses a caller-supplied buffer', () => {
    const buf = new InputCaptureBuffer({ playerCount: 2 });
    const c = new RecordingController({ buffer: buf });
    c.start({ matchConfig: makeMatchConfig() });
    expect(c.getBuffer()).toBe(buf);
  });

  it('rejects a buffer whose playerCount does not match the matchConfig', () => {
    const buf = new InputCaptureBuffer({ playerCount: 3 });
    const c = new RecordingController({ buffer: buf });
    expect(() =>
      c.start({ matchConfig: makeMatchConfig({ players: makePlayerSlots(2) }) }),
    ).toThrow(/buffer playerCount/);
  });
});

// ---------------------------------------------------------------------------
// suggestFileName
// ---------------------------------------------------------------------------

describe('RecordingController — suggestFileName', () => {
  it('falls back to a default when IDLE', () => {
    const c = new RecordingController();
    expect(c.suggestFileName()).toBe(
      `${DEFAULT_REPLAY_FILE_NAME}${REPLAY_FILE_EXTENSION}`,
    );
  });

  it('encodes stage, seed, and timestamp', () => {
    const c = new RecordingController({ nowFactory: makeFixedNow() });
    c.start({
      matchConfig: makeMatchConfig({
        stageId: 'flat-island',
        rngSeed: 0xdeadbeef,
      }),
    });
    const name = c.suggestFileName();
    expect(name).toMatch(/^replay-flat-island-deadbeef-20260430-120000\.replay\.json$/);
    expect(name.endsWith(REPLAY_FILE_EXTENSION)).toBe(true);
  });

  it('sanitises stage ids for cross-OS file safety', () => {
    const c = new RecordingController({ nowFactory: makeFixedNow() });
    c.start({
      matchConfig: makeMatchConfig({
        stageId: 'invalid/stage:name?',
      }),
    });
    const name = c.suggestFileName();
    expect(name).not.toContain('/');
    expect(name).not.toContain(':');
    expect(name).not.toContain('?');
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('RecordingController — determinism', () => {
  it('two recordings of the same inputs produce equal replay files', () => {
    const make = (): string => {
      const c = new RecordingController({
        engineVersion: '1.0.0',
        nowFactory: makeFixedNow(),
      });
      c.start({ matchConfig: makeMatchConfig() });
      for (let f = 0; f < 10; f += 1) {
        c.captureFrame(f, [
          { moveX: f / 10, jump: f % 2 === 0, attack: false, dropThrough: false },
          { moveX: -f / 10, jump: false, attack: f % 3 === 0, dropThrough: false },
        ]);
      }
      c.stop();
      return c.buildReplayJson();
    };
    expect(make()).toBe(make());
  });
});

// ---------------------------------------------------------------------------
// Surface — does the controller export the right things?
// ---------------------------------------------------------------------------

describe('RecordingController — surface', () => {
  it('re-exports a ReplayFile shape compatible with deserialise', () => {
    const c = new RecordingController({ nowFactory: makeFixedNow() });
    c.start({ matchConfig: makeMatchConfig() });
    c.captureFrame(0, [
      { moveX: 0, moveY: 0, jump: false, attack: false, dropThrough: false },
      { moveX: 0, moveY: 0, jump: false, attack: false, dropThrough: false },
    ]);
    c.stop();
    const json = c.buildReplayJson();
    expect(() => deserializeReplayFromString(json)).not.toThrow();
  });

  it('refuses to deserialise garbage even after a successful build', () => {
    expect(() => deserializeReplayFromString('not-json')).toThrow(ReplayFileError);
  });
});
