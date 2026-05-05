import { describe, it, expect } from 'vitest';
import type { MatchConfig, PlayerSlot } from '../types';
import { InputCaptureBuffer } from './InputCaptureBuffer';
import {
  REPLAY_FORMAT_MAGIC,
  REPLAY_FORMAT_VERSION,
  REPLAY_FILE_EXTENSION,
  ReplayFileError,
  serializeReplay,
  serializeReplayToString,
  deserializeReplay,
  deserializeReplayFromString,
  type ReplayFile,
} from './ReplayFile';

/**
 * AC 30003 Sub-AC 3 — replay file schema + (de)serialisation.
 *
 * Coverage map:
 *
 *   • Constants — magic / version / extension are stable.
 *   • serializeReplay
 *       - happy path (full match config, multi-frame timeline)
 *       - empty timeline (no frames captured yet)
 *       - includes metadata fields with defaults and overrides
 *       - rejects malformed `MatchConfig` (mode, stockCount, players, seed,
 *         player slot fields)
 *       - rejects malformed `capturedFrames` (non-monotonic frames,
 *         wrong-width inputs, non-finite moveX, non-boolean flags)
 *       - clamps the seed to unsigned 32-bit
 *       - truncates / trims notes
 *   • deserializeReplay
 *       - round-trip equality with the writer
 *       - rejects non-object / array / null inputs
 *       - rejects bad magic / unknown version
 *       - rejects mismatched cross-fields (rngSeed, playerCount,
 *         durationFrames)
 *       - rejects bad frame timeline (non-monotonic, wrong width)
 *   • End-to-end — feed an `InputCaptureBuffer` into the writer, parse
 *     back, replay the buffer's `getEntries()` shape exactly.
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

function makeFixedDate(): Date {
  return new Date('2026-04-30T12:00:00.000Z');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('ReplayFile constants', () => {
  it('exposes the magic identifier', () => {
    expect(REPLAY_FORMAT_MAGIC).toBe('platform-fighter-replay');
  });

  it('exposes a numeric schema version', () => {
    expect(REPLAY_FORMAT_VERSION).toBe(2);
  });

  it('exposes the recommended file extension', () => {
    expect(REPLAY_FILE_EXTENSION).toBe('.replay.json');
  });
});

// ---------------------------------------------------------------------------
// serializeReplay — happy paths
// ---------------------------------------------------------------------------

describe('serializeReplay — happy path', () => {
  it('writes a complete replay file with a multi-frame timeline', () => {
    const config = makeMatchConfig();
    const buf = new InputCaptureBuffer({ playerCount: 2 });
    buf.captureFrame(0, [
      { moveX: 1, jump: true, attack: false },
      { moveX: -1, jump: false, attack: true },
    ]);
    buf.captureFrame(1, [
      { moveX: 0, jump: false },
      { moveX: 0, jump: false, dropThrough: true },
    ]);
    buf.captureFrame(2, [
      { moveX: -1, jump: true, attack: true },
      { moveX: 1, jump: true },
    ]);

    const file = serializeReplay({
      matchConfig: config,
      capturedFrames: buf.getEntries(),
      recordedAt: makeFixedDate(),
      engineVersion: '0.1.0',
      notes: 'Wolf vs Cat exhibition',
    });

    expect(file.format).toBe(REPLAY_FORMAT_MAGIC);
    expect(file.version).toBe(REPLAY_FORMAT_VERSION);

    expect(file.metadata.recordedAt).toBe('2026-04-30T12:00:00.000Z');
    expect(file.metadata.durationFrames).toBe(3); // last frame 2 + 1
    expect(file.metadata.fixedTimestepMs).toBeCloseTo(1000 / 60);
    expect(file.metadata.playerCount).toBe(2);
    expect(file.metadata.engineVersion).toBe('0.1.0');
    expect(file.metadata.notes).toBe('Wolf vs Cat exhibition');

    expect(file.matchConfig.mode).toBe('stocks');
    expect(file.matchConfig.stockCount).toBe(3);
    expect(file.matchConfig.stageId).toBe('flatlands');
    expect(file.matchConfig.players).toHaveLength(2);
    expect(file.matchConfig.rngSeed).toBe(0xc0ffee);

    expect(file.rngSeed).toBe(0xc0ffee);
    expect(file.inputTimeline.playerCount).toBe(2);
    expect(file.inputTimeline.entries).toHaveLength(3);
    expect(file.inputTimeline.entries[0]!.frame).toBe(0);
    expect(file.inputTimeline.entries[0]!.inputs[0]).toEqual({
      moveX: 1, jump: true, attack: false, dropThrough: false,
    });
    expect(file.inputTimeline.entries[2]!.inputs[1]).toEqual({
      moveX: 1, jump: true, attack: false, dropThrough: false,
    });
  });

  it('handles a 4-player FFA timeline', () => {
    const config = makeMatchConfig({ players: makePlayerSlots(4) });
    const buf = new InputCaptureBuffer({ playerCount: 4 });
    buf.captureFrame(0, [
      { moveX: 1, jump: false },
      { moveX: -1, jump: true },
      { moveX: 0, jump: false, attack: true },
      { moveX: 0, jump: false, dropThrough: true },
    ]);

    const file = serializeReplay({
      matchConfig: config,
      capturedFrames: buf.getEntries(),
    });
    expect(file.metadata.playerCount).toBe(4);
    expect(file.inputTimeline.playerCount).toBe(4);
    expect(file.inputTimeline.entries[0]!.inputs).toHaveLength(4);
  });

  it('serialises an empty timeline (no captured frames)', () => {
    const file = serializeReplay({
      matchConfig: makeMatchConfig(),
      capturedFrames: [],
      recordedAt: makeFixedDate(),
    });
    expect(file.metadata.durationFrames).toBe(0);
    expect(file.inputTimeline.entries).toHaveLength(0);
  });

  it('captures non-contiguous monotonic frames verbatim', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    buf.captureFrame(10, [{ moveX: 1, jump: false }]);
    buf.captureFrame(50, [{ moveX: -1, jump: true }]);
    buf.captureFrame(300, [{ moveX: 0, jump: false }]);

    const file = serializeReplay({
      matchConfig: makeMatchConfig({ players: makePlayerSlots(1) }),
      capturedFrames: buf.getEntries(),
    });
    expect(file.inputTimeline.entries.map((e) => e.frame)).toEqual([10, 50, 300]);
    expect(file.metadata.durationFrames).toBe(301); // last + 1
  });

  it('preserves analog moveX exactly (no requantisation)', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    buf.captureFrame(0, [{ moveX: 0.42, jump: false }]);
    buf.captureFrame(1, [{ moveX: -0.7314, jump: false }]);

    const file = serializeReplay({
      matchConfig: makeMatchConfig({ players: makePlayerSlots(1) }),
      capturedFrames: buf.getEntries(),
    });
    expect(file.inputTimeline.entries[0]!.inputs[0]!.moveX).toBe(0.42);
    expect(file.inputTimeline.entries[1]!.inputs[0]!.moveX).toBe(-0.7314);
  });

  it('clamps the rng seed to unsigned 32-bit', () => {
    const file = serializeReplay({
      matchConfig: makeMatchConfig({ rngSeed: -1 }),
      capturedFrames: [],
    });
    expect(file.rngSeed).toBe(0xffffffff);
    expect(file.matchConfig.rngSeed).toBe(0xffffffff);
  });
});

// ---------------------------------------------------------------------------
// serializeReplay — defaults
// ---------------------------------------------------------------------------

describe('serializeReplay — metadata defaults', () => {
  it('defaults engineVersion when not supplied', () => {
    const file = serializeReplay({
      matchConfig: makeMatchConfig(),
      capturedFrames: [],
      recordedAt: makeFixedDate(),
    });
    expect(file.metadata.engineVersion).toBe('0.0.0-unknown');
  });

  it('defaults notes to an empty string', () => {
    const file = serializeReplay({
      matchConfig: makeMatchConfig(),
      capturedFrames: [],
      recordedAt: makeFixedDate(),
    });
    expect(file.metadata.notes).toBe('');
  });

  it('defaults fixedTimestepMs to 1000/60 when not supplied', () => {
    const file = serializeReplay({
      matchConfig: makeMatchConfig(),
      capturedFrames: [],
      recordedAt: makeFixedDate(),
    });
    expect(file.metadata.fixedTimestepMs).toBeCloseTo(1000 / 60, 6);
  });

  it('respects an explicit fixedTimestepMs override', () => {
    const file = serializeReplay({
      matchConfig: makeMatchConfig(),
      capturedFrames: [],
      recordedAt: makeFixedDate(),
      fixedTimestepMs: 1000 / 120,
    });
    expect(file.metadata.fixedTimestepMs).toBeCloseTo(1000 / 120, 6);
  });

  it('captures recordedAt as an ISO 8601 string when defaulted', () => {
    const before = Date.now();
    const file = serializeReplay({
      matchConfig: makeMatchConfig(),
      capturedFrames: [],
    });
    const after = Date.now();
    const t = Date.parse(file.metadata.recordedAt);
    expect(Number.isNaN(t)).toBe(false);
    expect(t).toBeGreaterThanOrEqual(before - 1);
    expect(t).toBeLessThanOrEqual(after + 1);
  });

  it('trims and clamps long notes', () => {
    const long = '   ' + 'x'.repeat(2000) + '   ';
    const file = serializeReplay({
      matchConfig: makeMatchConfig(),
      capturedFrames: [],
      recordedAt: makeFixedDate(),
      notes: long,
    });
    expect(file.metadata.notes.length).toBe(1024);
    expect(file.metadata.notes.startsWith('xxxx')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// serializeReplay — validation
// ---------------------------------------------------------------------------

describe('serializeReplay — validation rejects malformed inputs', () => {
  it('rejects null matchConfig', () => {
    expect(() =>
      serializeReplay({
        matchConfig: null as unknown as MatchConfig,
        capturedFrames: [],
      }),
    ).toThrow(ReplayFileError);
  });

  it('rejects unknown match mode', () => {
    expect(() =>
      serializeReplay({
        matchConfig: makeMatchConfig({ mode: 'coins' as unknown as 'stocks' }),
        capturedFrames: [],
      }),
    ).toThrow(/mode/);
  });

  it('rejects negative stockCount', () => {
    expect(() =>
      serializeReplay({
        matchConfig: makeMatchConfig({ stockCount: -1 }),
        capturedFrames: [],
      }),
    ).toThrow(/stockCount/);
  });

  it('rejects empty stageId', () => {
    expect(() =>
      serializeReplay({
        matchConfig: makeMatchConfig({ stageId: '' }),
        capturedFrames: [],
      }),
    ).toThrow(/stageId/);
  });

  it('rejects non-finite rngSeed', () => {
    expect(() =>
      serializeReplay({
        matchConfig: makeMatchConfig({ rngSeed: Number.NaN }),
        capturedFrames: [],
      }),
    ).toThrow(/rngSeed/);
  });

  it('rejects an empty player roster', () => {
    expect(() =>
      serializeReplay({
        matchConfig: makeMatchConfig({ players: [] }),
        capturedFrames: [],
      }),
    ).toThrow(/players/);
  });

  it('rejects more than 4 players', () => {
    const players = [...makePlayerSlots(4), {
      index: 1, characterId: 'wolf', paletteIndex: 0, inputType: 'ai',
    } as PlayerSlot];
    expect(() =>
      serializeReplay({
        matchConfig: makeMatchConfig({ players }),
        capturedFrames: [],
      }),
    ).toThrow(/1\.\.4/);
  });

  it('rejects bad palette index on a player slot', () => {
    const players = makePlayerSlots(2);
    const bad = { ...players[1]!, paletteIndex: 10 };
    expect(() =>
      serializeReplay({
        matchConfig: makeMatchConfig({ players: [players[0]!, bad] }),
        capturedFrames: [],
      }),
    ).toThrow(/paletteIndex/);
  });

  it('rejects non-monotonic capturedFrames', () => {
    expect(() =>
      serializeReplay({
        matchConfig: makeMatchConfig({ players: makePlayerSlots(1) }),
        capturedFrames: [
          { frame: 5, inputs: [{ moveX: 0, jump: false, attack: false, dropThrough: false }] },
          { frame: 5, inputs: [{ moveX: 0, jump: false, attack: false, dropThrough: false }] },
        ],
      }),
    ).toThrow(/monotonic/);
  });

  it('rejects negative frame numbers in capturedFrames', () => {
    expect(() =>
      serializeReplay({
        matchConfig: makeMatchConfig({ players: makePlayerSlots(1) }),
        capturedFrames: [
          { frame: -1, inputs: [{ moveX: 0, jump: false, attack: false, dropThrough: false }] },
        ],
      }),
    ).toThrow(/non-negative/);
  });

  it('rejects wrong-width per-frame inputs', () => {
    expect(() =>
      serializeReplay({
        matchConfig: makeMatchConfig(), // 2 players
        capturedFrames: [
          {
            frame: 0,
            inputs: [{ moveX: 0, jump: false, attack: false, dropThrough: false }],
          },
        ],
      }),
    ).toThrow(/exactly 2/);
  });

  it('rejects non-finite moveX in capturedFrames', () => {
    expect(() =>
      serializeReplay({
        matchConfig: makeMatchConfig({ players: makePlayerSlots(1) }),
        capturedFrames: [
          {
            frame: 0,
            inputs: [{ moveX: Number.POSITIVE_INFINITY, jump: false, attack: false, dropThrough: false }],
          },
        ],
      }),
    ).toThrow(/moveX/);
  });

  it('rejects non-boolean jump in capturedFrames', () => {
    expect(() =>
      serializeReplay({
        matchConfig: makeMatchConfig({ players: makePlayerSlots(1) }),
        capturedFrames: [
          {
            frame: 0,
            inputs: [{ moveX: 0, jump: 'yes' as unknown as boolean, attack: false, dropThrough: false }],
          },
        ],
      }),
    ).toThrow(/jump/);
  });
});

// ---------------------------------------------------------------------------
// deserializeReplay — round trip
// ---------------------------------------------------------------------------

describe('deserializeReplay — round-trip equality', () => {
  it('round-trips a non-empty timeline through JSON', () => {
    const config = makeMatchConfig({ players: makePlayerSlots(3) });
    const buf = new InputCaptureBuffer({ playerCount: 3 });
    buf.captureFrame(0, [
      { moveX: 1, jump: false, attack: false },
      { moveX: -1, jump: true },
      { moveX: 0.5, jump: false, attack: true, dropThrough: false },
    ]);
    buf.captureFrame(2, [
      { moveX: 0, jump: false, dropThrough: true },
      { moveX: 0, jump: false },
      { moveX: -0.25, jump: true },
    ]);

    const original = serializeReplay({
      matchConfig: config,
      capturedFrames: buf.getEntries(),
      recordedAt: makeFixedDate(),
      engineVersion: '0.1.0',
      notes: 'round trip',
    });

    const json = JSON.stringify(original);
    const reparsed = deserializeReplay(JSON.parse(json));

    // Plain-object equality (frozen reference identity differs).
    const stripFreeze = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
    expect(stripFreeze(reparsed)).toEqual(stripFreeze(original));
  });

  it('round-trips an empty timeline', () => {
    const original = serializeReplay({
      matchConfig: makeMatchConfig(),
      capturedFrames: [],
      recordedAt: makeFixedDate(),
    });
    const reparsed = deserializeReplay(JSON.parse(JSON.stringify(original)));
    expect(reparsed.metadata.durationFrames).toBe(0);
    expect(reparsed.inputTimeline.entries).toHaveLength(0);
  });

  it('round-trips through serializeReplayToString / deserializeReplayFromString', () => {
    const config = makeMatchConfig({ players: makePlayerSlots(2) });
    const buf = new InputCaptureBuffer({ playerCount: 2 });
    buf.captureFrame(0, [
      { moveX: 0.5, jump: true, attack: false },
      { moveX: -0.5, jump: false, attack: true },
    ]);

    const text = serializeReplayToString(
      { matchConfig: config, capturedFrames: buf.getEntries(), recordedAt: makeFixedDate() },
    );
    expect(typeof text).toBe('string');
    const reparsed = deserializeReplayFromString(text);
    expect(reparsed.inputTimeline.entries[0]!.inputs[0]!.moveX).toBe(0.5);
    expect(reparsed.inputTimeline.entries[0]!.inputs[1]!.attack).toBe(true);
  });

  it('emits human-readable JSON when pretty=true', () => {
    const text = serializeReplayToString(
      {
        matchConfig: makeMatchConfig(),
        capturedFrames: [],
        recordedAt: makeFixedDate(),
      },
      true,
    );
    expect(text).toContain('\n');
    expect(text).toContain('  '); // two-space indent
  });

  it('preserves the optional aiDifficulty field on player slots', () => {
    const players = makePlayerSlots(3); // P3 has aiDifficulty: 'easy'
    const file = serializeReplay({
      matchConfig: makeMatchConfig({ players }),
      capturedFrames: [],
      recordedAt: makeFixedDate(),
    });
    const reparsed = deserializeReplay(JSON.parse(JSON.stringify(file)));
    expect(reparsed.matchConfig.players[2]!.aiDifficulty).toBe('easy');
  });

  it('preserves an optional timeLimitSeconds on a time-mode match', () => {
    const file = serializeReplay({
      matchConfig: makeMatchConfig({
        mode: 'time',
        stockCount: 0,
        timeLimitSeconds: 180,
      }),
      capturedFrames: [],
      recordedAt: makeFixedDate(),
    });
    const reparsed = deserializeReplay(JSON.parse(JSON.stringify(file)));
    expect(reparsed.matchConfig.mode).toBe('time');
    expect(reparsed.matchConfig.timeLimitSeconds).toBe(180);
  });
});

// ---------------------------------------------------------------------------
// deserializeReplay — error cases
// ---------------------------------------------------------------------------

describe('deserializeReplay — invalid inputs', () => {
  it('rejects null', () => {
    expect(() => deserializeReplay(null)).toThrow(ReplayFileError);
  });

  it('rejects an array (not a replay object)', () => {
    expect(() => deserializeReplay([])).toThrow(/object/);
  });

  it('rejects unknown format magic', () => {
    expect(() =>
      deserializeReplay({
        format: 'something-else',
        version: 1,
        metadata: {},
        matchConfig: {},
        rngSeed: 0,
        inputTimeline: { playerCount: 1, entries: [] },
      }),
    ).toThrow(/format magic/);
  });

  it('rejects an unsupported version', () => {
    expect(() =>
      deserializeReplay({
        format: REPLAY_FORMAT_MAGIC,
        version: 999,
      }),
    ).toThrow(/version unsupported/);
  });

  it('rejects bad metadata.recordedAt', () => {
    const file = serializeReplay({
      matchConfig: makeMatchConfig(),
      capturedFrames: [],
      recordedAt: makeFixedDate(),
    });
    const broken = JSON.parse(JSON.stringify(file));
    broken.metadata.recordedAt = 'not a date at all';
    expect(() => deserializeReplay(broken)).toThrow(/recordedAt/);
  });

  it('rejects mismatched rngSeed vs matchConfig.rngSeed', () => {
    const file = serializeReplay({
      matchConfig: makeMatchConfig(),
      capturedFrames: [],
      recordedAt: makeFixedDate(),
    });
    const broken = JSON.parse(JSON.stringify(file));
    broken.rngSeed = broken.matchConfig.rngSeed + 1;
    expect(() => deserializeReplay(broken)).toThrow(/disagrees/);
  });

  it('rejects mismatched playerCount in metadata vs matchConfig', () => {
    const file = serializeReplay({
      matchConfig: makeMatchConfig({ players: makePlayerSlots(2) }),
      capturedFrames: [],
      recordedAt: makeFixedDate(),
    });
    const broken = JSON.parse(JSON.stringify(file));
    broken.metadata.playerCount = 3;
    expect(() => deserializeReplay(broken)).toThrow(/playerCount/);
  });

  it('rejects mismatched playerCount in metadata vs inputTimeline', () => {
    const file = serializeReplay({
      matchConfig: makeMatchConfig({ players: makePlayerSlots(2) }),
      capturedFrames: [],
      recordedAt: makeFixedDate(),
    });
    const broken = JSON.parse(JSON.stringify(file));
    broken.inputTimeline.playerCount = 3;
    expect(() => deserializeReplay(broken)).toThrow(/playerCount/);
  });

  it('rejects mismatched durationFrames', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    buf.captureFrame(0, [{ moveX: 0, jump: false }]);
    buf.captureFrame(1, [{ moveX: 0, jump: false }]);
    const file = serializeReplay({
      matchConfig: makeMatchConfig({ players: makePlayerSlots(1) }),
      capturedFrames: buf.getEntries(),
      recordedAt: makeFixedDate(),
    });
    const broken = JSON.parse(JSON.stringify(file));
    broken.metadata.durationFrames = 99;
    expect(() => deserializeReplay(broken)).toThrow(/durationFrames/);
  });

  it('rejects non-monotonic frames in the timeline', () => {
    const file = serializeReplay({
      matchConfig: makeMatchConfig({ players: makePlayerSlots(1) }),
      capturedFrames: [],
      recordedAt: makeFixedDate(),
    });
    const broken = JSON.parse(JSON.stringify(file));
    broken.inputTimeline.entries = [
      {
        frame: 5,
        inputs: [{ moveX: 0, jump: false, attack: false, dropThrough: false }],
      },
      {
        frame: 5, // duplicate — must be rejected
        inputs: [{ moveX: 0, jump: false, attack: false, dropThrough: false }],
      },
    ];
    broken.metadata.durationFrames = 6;
    expect(() => deserializeReplay(broken)).toThrow(/monotonic/);
  });

  it('rejects wrong-width inputs arrays in the timeline', () => {
    const file = serializeReplay({
      matchConfig: makeMatchConfig({ players: makePlayerSlots(2) }),
      capturedFrames: [],
      recordedAt: makeFixedDate(),
    });
    const broken = JSON.parse(JSON.stringify(file));
    broken.inputTimeline.entries = [
      {
        frame: 0,
        inputs: [{ moveX: 0, jump: false, attack: false, dropThrough: false }],
      },
    ];
    broken.metadata.durationFrames = 1;
    expect(() => deserializeReplay(broken)).toThrow(/exactly 2/);
  });

  it('rejects bad rngSeed (negative)', () => {
    const file = serializeReplay({
      matchConfig: makeMatchConfig(),
      capturedFrames: [],
      recordedAt: makeFixedDate(),
    });
    const broken = JSON.parse(JSON.stringify(file));
    broken.rngSeed = -1;
    broken.matchConfig.rngSeed = -1;
    expect(() => deserializeReplay(broken)).toThrow(/rngSeed/);
  });

  it('rejects malformed JSON via deserializeReplayFromString', () => {
    expect(() => deserializeReplayFromString('{not json')).toThrow(
      /not valid JSON/,
    );
  });
});

// ---------------------------------------------------------------------------
// End-to-end — buffer → file → buffer-shape
// ---------------------------------------------------------------------------

describe('ReplayFile end-to-end', () => {
  it('preserves an InputCaptureBuffer exactly across save / load', () => {
    const buf = new InputCaptureBuffer({ playerCount: 2 });
    const sequence: Array<[number, { moveX: number; jump: boolean; attack?: boolean; dropThrough?: boolean }, { moveX: number; jump: boolean; attack?: boolean; dropThrough?: boolean }]> = [
      [0, { moveX: 0, jump: false }, { moveX: 0, jump: false }],
      [1, { moveX: 1, jump: true }, { moveX: -1, jump: false }],
      [2, { moveX: 1, jump: false, attack: true }, { moveX: 0, jump: false }],
      [3, { moveX: 0, jump: false, dropThrough: true }, { moveX: 1, jump: true }],
      [10, { moveX: -0.5, jump: false }, { moveX: 0.5, jump: true, attack: true }],
    ];
    for (const [frame, p1, p2] of sequence) {
      buf.captureFrame(frame, [p1, p2]);
    }
    const config = makeMatchConfig();

    const text = serializeReplayToString(
      {
        matchConfig: config,
        capturedFrames: buf.getEntries(),
        recordedAt: makeFixedDate(),
        engineVersion: '0.1.0',
        notes: 'e2e',
      },
      true,
    );
    const file: ReplayFile = deserializeReplayFromString(text);

    // Cross-check every captured frame survived bit-for-bit.
    expect(file.inputTimeline.entries).toHaveLength(buf.size());
    const live = buf.getEntries();
    for (let i = 0; i < live.length; i += 1) {
      expect(file.inputTimeline.entries[i]!.frame).toBe(live[i]!.frame);
      for (let p = 0; p < 2; p += 1) {
        expect({ ...file.inputTimeline.entries[i]!.inputs[p]! }).toEqual({
          ...live[i]!.inputs[p]!,
        });
      }
    }
    // The file's seed is the canonical seed the replay player will
    // hand back to `initialiseMatchRngFromConfig`.
    expect(file.rngSeed).toBe(config.rngSeed);
  });

  it('two consecutive serialises of the same buffer are byte-identical (modulo recordedAt)', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    buf.captureFrame(0, [{ moveX: 1, jump: true, attack: true, dropThrough: false }]);
    buf.captureFrame(1, [{ moveX: -1, jump: false, attack: false, dropThrough: true }]);

    const opts = {
      matchConfig: makeMatchConfig({ players: makePlayerSlots(1) }),
      capturedFrames: buf.getEntries(),
      recordedAt: makeFixedDate(), // pin so the two writes are equal
      engineVersion: '0.1.0',
      notes: 'determinism',
    };
    const a = serializeReplayToString(opts);
    const b = serializeReplayToString(opts);
    expect(a).toBe(b);
  });
});
