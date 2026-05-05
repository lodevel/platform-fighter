import { describe, it, expect, expectTypeOf } from 'vitest';
import type { MatchConfig } from '../types';
import {
  REPLAY_FILE_EXTENSION,
  REPLAY_FORMAT_MAGIC,
  REPLAY_FORMAT_VERSION,
} from './replayTypes';
import type {
  CapturedFrame,
  RecordedCharacterInput,
  ReplayFile,
  ReplayInputTimeline,
  ReplayMetadata,
  SerializedCapturedFrame,
} from './replayTypes';

/**
 * AC 30001 Sub-AC 1 — replay schema (constants + types) lives in a
 * dedicated `./replayTypes` module so consumers (M4 replay browser,
 * snapshot resync, headless tooling) can import the contract without
 * pulling in the validator / writer code in `./ReplayFile`.
 *
 * These tests pin down:
 *
 *   • The three schema-level constants (magic, version, extension)
 *     have their stable values and stable literal types.
 *   • The dedicated module re-exports the per-frame input format
 *     (`RecordedCharacterInput`, `CapturedFrame`) shared with the
 *     runtime `InputCaptureBuffer` so on-disk and in-memory
 *     representations cannot drift.
 *   • The full top-level `ReplayFile` shape — including the RNG seed
 *     field and every match-metadata field the AC calls out
 *     (timestamp, version, plus characters/stage by way of
 *     `matchConfig`) — accepts a structurally valid literal under
 *     TypeScript's structural typing.
 */
describe('replayTypes — schema constants', () => {
  it('REPLAY_FORMAT_MAGIC is the stable platform-fighter-replay tag', () => {
    expect(REPLAY_FORMAT_MAGIC).toBe('platform-fighter-replay');
    // Literal type is preserved so `ReplayFile.format` can be the
    // `typeof REPLAY_FORMAT_MAGIC` discriminator.
    expectTypeOf(REPLAY_FORMAT_MAGIC).toEqualTypeOf<'platform-fighter-replay'>();
  });

  it('REPLAY_FORMAT_VERSION is the integer 2 for today\'s writer', () => {
    expect(REPLAY_FORMAT_VERSION).toBe(2);
    expectTypeOf(REPLAY_FORMAT_VERSION).toEqualTypeOf<2>();
  });

  it('REPLAY_FILE_EXTENSION is the .replay.json suffix', () => {
    expect(REPLAY_FILE_EXTENSION).toBe('.replay.json');
    expectTypeOf(REPLAY_FILE_EXTENSION).toEqualTypeOf<'.replay.json'>();
  });
});

describe('replayTypes — per-frame input format', () => {
  it('RecordedCharacterInput is the closed { moveX, jump, attack, dropThrough } shape', () => {
    const input: RecordedCharacterInput = {
      moveX: 0.75,
      jump: false,
      attack: true,
      dropThrough: false,
    };
    // Compile-time keys check — adding/removing a field would fail
    // type-check, which is the determinism guard the AC requires.
    const keys: ReadonlyArray<keyof RecordedCharacterInput> = [
      'moveX',
      'jump',
      'attack',
      'dropThrough',
    ];
    expect(keys.every((k) => k in input)).toBe(true);
  });

  it('CapturedFrame pairs a frame index with a per-player input array', () => {
    const frame: CapturedFrame = {
      frame: 42,
      inputs: [
        { moveX: 0, jump: false, attack: false, dropThrough: false },
        { moveX: -1, jump: true, attack: false, dropThrough: false },
      ],
    };
    expect(frame.frame).toBe(42);
    expect(frame.inputs).toHaveLength(2);
  });
});

describe('replayTypes — top-level schema', () => {
  it('ReplayFile literal accepts the full schema contract', () => {
    const matchConfig: MatchConfig = {
      mode: 'stocks',
      stockCount: 3,
      stageId: 'flat-stage',
      players: [
        {
          index: 1,
          characterId: 'wolf',
          paletteIndex: 0,
          inputType: 'keyboard_p1',
        },
        {
          index: 2,
          characterId: 'cat',
          paletteIndex: 1,
          inputType: 'keyboard_p2',
        },
      ],
      rngSeed: 0xdeadbeef,
    };

    const metadata: ReplayMetadata = {
      recordedAt: '2026-01-01T00:00:00.000Z',
      durationFrames: 0,
      fixedTimestepMs: 1000 / 60,
      playerCount: 2,
      engineVersion: '0.1.0',
      notes: '',
    };

    const inputTimeline: ReplayInputTimeline = {
      playerCount: 2,
      entries: [],
    };

    const replay: ReplayFile = {
      format: REPLAY_FORMAT_MAGIC,
      version: REPLAY_FORMAT_VERSION,
      metadata,
      matchConfig,
      rngSeed: matchConfig.rngSeed,
      inputTimeline,
      itemSpawnEvents: [],
    };

    // RNG seed field present at the top level (AC requirement).
    expect(replay.rngSeed).toBe(0xdeadbeef);
    // Metadata timestamp + version present (AC requirement).
    expect(replay.metadata.recordedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(replay.version).toBe(REPLAY_FORMAT_VERSION);
    // Characters + stage are addressable via matchConfig (the
    // canonical home — the schema deliberately doesn't duplicate them
    // in `metadata`).
    expect(replay.matchConfig.players.map((p) => p.characterId)).toEqual([
      'wolf',
      'cat',
    ]);
    expect(replay.matchConfig.stageId).toBe('flat-stage');
  });

  it('SerializedCapturedFrame mirrors the CapturedFrame shape on disk', () => {
    const onDisk: SerializedCapturedFrame = {
      frame: 0,
      inputs: [{ moveX: 0, jump: false, attack: false, dropThrough: false }],
    };
    // `SerializedCapturedFrame.inputs` is the per-frame input format
    // re-exported from this module — assignability proves the on-disk
    // and in-memory shapes share one source of truth.
    const inMemory: ReadonlyArray<RecordedCharacterInput> = onDisk.inputs;
    expect(inMemory[0]?.moveX).toBe(0);
  });
});
