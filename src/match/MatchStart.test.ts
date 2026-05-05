import { describe, it, expect } from 'vitest';
import {
  initialiseMatch,
  buildMatchStartMetadata,
  DEFAULT_FIXED_TIMESTEP_MS,
  UNKNOWN_ENGINE_VERSION,
  type MatchStartContext,
} from './MatchStart';
import { MatchRng } from './MatchRng';
import type { MatchConfig, PlayerSlot } from '../types';

/**
 * AC 30003 Sub-AC 3 — unified match-start capture tests.
 *
 * `initialiseMatch` is the single capture point for every "decided at
 * match start" value: the deterministic RNG seed (and the live
 * `MatchRng` built from it), the canonical frozen `MatchConfig`, and
 * the metadata snapshot the replay structure carries.
 *
 * These tests lock down:
 *   • Seed capture from `MatchConfig.rngSeed` with fallback resolution.
 *   • Seed wiring into RNG initialization — the returned `rng` is the
 *     `MatchRng` that subsystems will read from.
 *   • Metadata population — characters, stage, timestamp, version,
 *     player count, fixed-step interval — all sourced from one place.
 *   • Deterministic re-execution: identical inputs → identical
 *     `seed`, RNG sequence, frozen `matchConfig`, and metadata
 *     (modulo `startedAt`, which is wall-clock).
 *   • Defensive validation — bad matchConfig is rejected at match
 *     start rather than at save time.
 *   • Replay-symmetric reconstruction — a recorded `seed` reconstructs
 *     a `MatchRng` with the same stream sequences as the original.
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
    inputType:
      i === 0 ? 'keyboard_p1' : i === 1 ? 'keyboard_p2' : 'ai',
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

const FIXED_DATE_ISO = '2026-04-30T12:00:00.000Z';
const fixedNow = (): Date => new Date(FIXED_DATE_ISO);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('MatchStart constants', () => {
  it('exposes the engine default fixed timestep (60 Hz)', () => {
    expect(DEFAULT_FIXED_TIMESTEP_MS).toBeCloseTo(1000 / 60, 6);
  });

  it('exposes a recognisable unknown-engine-version sentinel', () => {
    expect(UNKNOWN_ENGINE_VERSION).toBe('0.0.0-unknown');
  });
});

// ---------------------------------------------------------------------------
// initialiseMatch — seed capture + RNG wiring
// ---------------------------------------------------------------------------

describe('initialiseMatch — seed capture', () => {
  it('captures the seed verbatim from matchConfig.rngSeed', () => {
    const ctx = initialiseMatch({
      matchConfig: makeMatchConfig({ rngSeed: 0x1234 }),
      nowFactory: fixedNow,
    });
    expect(ctx.seed).toBe(0x1234);
  });

  it('builds a MatchRng seeded with the captured seed', () => {
    const ctx = initialiseMatch({
      matchConfig: makeMatchConfig({ rngSeed: 0xc0ffee }),
      nowFactory: fixedNow,
    });
    expect(ctx.rng).toBeInstanceOf(MatchRng);
    expect(ctx.rng.getSeed()).toBe(0xc0ffee);
  });

  it('the canonical seed is identical across context.seed, ctx.rng.getSeed(), and ctx.matchConfig.rngSeed', () => {
    const ctx = initialiseMatch({
      matchConfig: makeMatchConfig({ rngSeed: 0xfeedface }),
      nowFactory: fixedNow,
    });
    expect(ctx.seed).toBe(ctx.rng.getSeed());
    expect(ctx.seed).toBe(ctx.matchConfig.rngSeed);
  });

  it('clamps a negative or oversized seed to unsigned 32-bit and propagates it everywhere', () => {
    const ctx = initialiseMatch({
      matchConfig: makeMatchConfig({ rngSeed: -1 }),
      nowFactory: fixedNow,
    });
    expect(ctx.seed).toBe(0xffffffff);
    expect(ctx.rng.getSeed()).toBe(0xffffffff);
    expect(ctx.matchConfig.rngSeed).toBe(0xffffffff);
  });

  it('falls back to fallbackSeed when matchConfig.rngSeed is non-finite', () => {
    const ctx = initialiseMatch({
      matchConfig: makeMatchConfig({ rngSeed: NaN }),
      fallbackSeed: 0xabcd,
      nowFactory: fixedNow,
    });
    expect(ctx.seed).toBe(0xabcd);
    expect(ctx.matchConfig.rngSeed).toBe(0xabcd);
  });

  it('falls back to 0 when no fallbackSeed is provided and the config seed is non-finite', () => {
    const ctx = initialiseMatch({
      matchConfig: makeMatchConfig({ rngSeed: Infinity }),
      nowFactory: fixedNow,
    });
    expect(ctx.seed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// initialiseMatch — RNG initialization wiring
// ---------------------------------------------------------------------------

describe('initialiseMatch — RNG initialization', () => {
  it('two calls with the same seed produce identical root sequences', () => {
    const a = initialiseMatch({
      matchConfig: makeMatchConfig({ rngSeed: 0xabc }),
      nowFactory: fixedNow,
    });
    const b = initialiseMatch({
      matchConfig: makeMatchConfig({ rngSeed: 0xabc }),
      nowFactory: fixedNow,
    });
    const aSeq = Array.from({ length: 8 }, () => a.rng.next());
    const bSeq = Array.from({ length: 8 }, () => b.rng.next());
    expect(aSeq).toEqual(bSeq);
  });

  it('two calls with the same seed produce identical AI / hazard substream sequences', () => {
    const a = initialiseMatch({
      matchConfig: makeMatchConfig({ rngSeed: 0x10101 }),
      nowFactory: fixedNow,
    });
    const b = initialiseMatch({
      matchConfig: makeMatchConfig({ rngSeed: 0x10101 }),
      nowFactory: fixedNow,
    });
    const aAi = Array.from({ length: 5 }, () => a.rng.stream('ai').next());
    const bAi = Array.from({ length: 5 }, () => b.rng.stream('ai').next());
    const aHazard = Array.from({ length: 5 }, () =>
      a.rng.stream('hazard').next(),
    );
    const bHazard = Array.from({ length: 5 }, () =>
      b.rng.stream('hazard').next(),
    );
    expect(aAi).toEqual(bAi);
    expect(aHazard).toEqual(bHazard);
  });

  it('replay reconstruction: a stream sequence reproduces given only the captured seed', () => {
    const original = initialiseMatch({
      matchConfig: makeMatchConfig({ rngSeed: 0x42 }),
      nowFactory: fixedNow,
    });
    const aiOriginal = Array.from({ length: 6 }, () =>
      original.rng.stream('ai').next(),
    );

    // Replay player has only the captured seed. Reconstruct with a
    // bare-minimum config carrying that seed.
    const replayed = initialiseMatch({
      matchConfig: makeMatchConfig({ rngSeed: original.seed }),
      nowFactory: fixedNow,
    });
    const aiReplayed = Array.from({ length: 6 }, () =>
      replayed.rng.stream('ai').next(),
    );
    expect(aiReplayed).toEqual(aiOriginal);
  });
});

// ---------------------------------------------------------------------------
// initialiseMatch — metadata population
// ---------------------------------------------------------------------------

describe('initialiseMatch — metadata population', () => {
  it('populates the timestamp from the supplied nowFactory exactly once', () => {
    let calls = 0;
    const nowFactory = (): Date => {
      calls += 1;
      return new Date(FIXED_DATE_ISO);
    };
    const ctx = initialiseMatch({
      matchConfig: makeMatchConfig(),
      nowFactory,
    });
    expect(ctx.metadata.startedAt).toBe(FIXED_DATE_ISO);
    expect(calls).toBe(1);
  });

  it('populates characterIds in slot order from matchConfig.players', () => {
    const config = makeMatchConfig({ players: makePlayerSlots(4) });
    const ctx = initialiseMatch({
      matchConfig: config,
      nowFactory: fixedNow,
    });
    expect(ctx.metadata.characterIds).toEqual(['wolf', 'cat', 'owl', 'bear']);
  });

  it('populates stageId from matchConfig.stageId', () => {
    const ctx = initialiseMatch({
      matchConfig: makeMatchConfig({ stageId: 'volcano' }),
      nowFactory: fixedNow,
    });
    expect(ctx.metadata.stageId).toBe('volcano');
  });

  it('populates playerCount from matchConfig.players.length', () => {
    const ctx = initialiseMatch({
      matchConfig: makeMatchConfig({ players: makePlayerSlots(3) }),
      nowFactory: fixedNow,
    });
    expect(ctx.metadata.playerCount).toBe(3);
  });

  it('populates fixedTimestepMs from options, defaulting to 60 Hz', () => {
    const def = initialiseMatch({
      matchConfig: makeMatchConfig(),
      nowFactory: fixedNow,
    });
    expect(def.metadata.fixedTimestepMs).toBeCloseTo(1000 / 60, 6);

    const custom = initialiseMatch({
      matchConfig: makeMatchConfig(),
      fixedTimestepMs: 1000 / 120,
      nowFactory: fixedNow,
    });
    expect(custom.metadata.fixedTimestepMs).toBeCloseTo(1000 / 120, 6);
  });

  it('rejects non-positive / non-finite fixedTimestepMs and falls back to 60 Hz', () => {
    const cases: Array<number> = [0, -1, NaN, Infinity];
    for (const bad of cases) {
      const ctx = initialiseMatch({
        matchConfig: makeMatchConfig(),
        fixedTimestepMs: bad,
        nowFactory: fixedNow,
      });
      expect(ctx.metadata.fixedTimestepMs).toBeCloseTo(1000 / 60, 6);
    }
  });

  it('populates engineVersion from options, defaulting to the unknown sentinel', () => {
    const def = initialiseMatch({
      matchConfig: makeMatchConfig(),
      nowFactory: fixedNow,
    });
    expect(def.metadata.engineVersion).toBe(UNKNOWN_ENGINE_VERSION);

    const custom = initialiseMatch({
      matchConfig: makeMatchConfig(),
      engineVersion: '0.4.2',
      nowFactory: fixedNow,
    });
    expect(custom.metadata.engineVersion).toBe('0.4.2');
  });

  it('rejects empty engineVersion and falls back to the unknown sentinel', () => {
    const ctx = initialiseMatch({
      matchConfig: makeMatchConfig(),
      engineVersion: '',
      nowFactory: fixedNow,
    });
    expect(ctx.metadata.engineVersion).toBe(UNKNOWN_ENGINE_VERSION);
  });
});

// ---------------------------------------------------------------------------
// initialiseMatch — canonical, frozen MatchConfig
// ---------------------------------------------------------------------------

describe('initialiseMatch — frozen matchConfig', () => {
  it('does not mutate the source matchConfig', () => {
    const source = makeMatchConfig({ rngSeed: -1 });
    const sourceSnapshot = JSON.parse(JSON.stringify(source));
    initialiseMatch({ matchConfig: source, nowFactory: fixedNow });
    expect(source).toEqual(sourceSnapshot);
  });

  it('returns a frozen matchConfig with a frozen players array and frozen slots', () => {
    const ctx = initialiseMatch({
      matchConfig: makeMatchConfig(),
      nowFactory: fixedNow,
    });
    expect(Object.isFrozen(ctx.matchConfig)).toBe(true);
    expect(Object.isFrozen(ctx.matchConfig.players)).toBe(true);
    for (const slot of ctx.matchConfig.players) {
      expect(Object.isFrozen(slot)).toBe(true);
    }
  });

  it('preserves optional timeLimitSeconds when supplied', () => {
    const ctx = initialiseMatch({
      matchConfig: makeMatchConfig({
        mode: 'time',
        timeLimitSeconds: 180,
      }),
      nowFactory: fixedNow,
    });
    expect(ctx.matchConfig.mode).toBe('time');
    expect(ctx.matchConfig.timeLimitSeconds).toBe(180);
  });

  it('preserves optional aiDifficulty per slot', () => {
    const players = makePlayerSlots(3); // slot 3 has aiDifficulty 'easy'
    const ctx = initialiseMatch({
      matchConfig: makeMatchConfig({ players }),
      nowFactory: fixedNow,
    });
    expect(ctx.matchConfig.players[2]!.aiDifficulty).toBe('easy');
    expect(ctx.matchConfig.players[0]!.aiDifficulty).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// initialiseMatch — input validation
// ---------------------------------------------------------------------------

describe('initialiseMatch — input validation', () => {
  it('throws when matchConfig is missing', () => {
    expect(() =>
      // @ts-expect-error — exercising the runtime guard
      initialiseMatch({ nowFactory: fixedNow }),
    ).toThrow(/matchConfig/);
  });

  it('throws when matchConfig.players is empty', () => {
    expect(() =>
      initialiseMatch({
        matchConfig: makeMatchConfig({ players: [] }),
        nowFactory: fixedNow,
      }),
    ).toThrow(/1\.\.4 entries/);
  });

  it('throws when matchConfig.players exceeds 4 entries', () => {
    expect(() =>
      initialiseMatch({
        matchConfig: makeMatchConfig({
          players: [
            ...makePlayerSlots(4),
            // Smuggle a 5th slot past the typed PlayerSlot helper to
            // simulate corrupt input.
            {
              index: 4,
              characterId: 'wolf',
              paletteIndex: 0,
              inputType: 'ai',
              aiDifficulty: 'easy',
            } as PlayerSlot,
          ],
        }),
        nowFactory: fixedNow,
      }),
    ).toThrow(/1\.\.4 entries/);
  });

  it('throws when matchConfig.stageId is empty', () => {
    expect(() =>
      initialiseMatch({
        matchConfig: makeMatchConfig({ stageId: '' }),
        nowFactory: fixedNow,
      }),
    ).toThrow(/stageId/);
  });
});

// ---------------------------------------------------------------------------
// Determinism end-to-end
// ---------------------------------------------------------------------------

describe('initialiseMatch — determinism', () => {
  it('two calls with identical inputs produce identical seed, matchConfig, and (modulo startedAt) metadata', () => {
    const config = makeMatchConfig({ rngSeed: 0x9876, players: makePlayerSlots(3) });
    const a = initialiseMatch({
      matchConfig: config,
      engineVersion: '0.1.0',
      fixedTimestepMs: 1000 / 60,
      nowFactory: fixedNow,
    });
    const b = initialiseMatch({
      matchConfig: config,
      engineVersion: '0.1.0',
      fixedTimestepMs: 1000 / 60,
      nowFactory: fixedNow,
    });
    expect(a.seed).toBe(b.seed);
    expect(a.matchConfig).toEqual(b.matchConfig);
    expect(a.metadata).toEqual(b.metadata);
  });

  it('returns a frozen MatchStartContext', () => {
    const ctx = initialiseMatch({
      matchConfig: makeMatchConfig(),
      nowFactory: fixedNow,
    });
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.metadata)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildMatchStartMetadata — standalone
// ---------------------------------------------------------------------------

describe('buildMatchStartMetadata', () => {
  it('produces the same metadata fields as initialiseMatch', () => {
    const config = makeMatchConfig();
    const ctx = initialiseMatch({
      matchConfig: config,
      engineVersion: '0.2.0',
      nowFactory: fixedNow,
    });
    const standalone = buildMatchStartMetadata({
      matchConfig: ctx.matchConfig,
      engineVersion: '0.2.0',
      nowFactory: fixedNow,
    });
    expect(standalone).toEqual(ctx.metadata);
  });

  it('throws when matchConfig is missing', () => {
    expect(() =>
      // @ts-expect-error — exercising the runtime guard
      buildMatchStartMetadata({ nowFactory: fixedNow }),
    ).toThrow(/matchConfig/);
  });

  it('throws when matchConfig.players is empty', () => {
    expect(() =>
      buildMatchStartMetadata({
        matchConfig: makeMatchConfig({ players: [] }),
        nowFactory: fixedNow,
      }),
    ).toThrow(/1\.\.4 entries/);
  });
});

// ---------------------------------------------------------------------------
// Replay-structure integration — metadata is suitable for replay header
// ---------------------------------------------------------------------------

describe('initialiseMatch — replay structure integration', () => {
  it('metadata fields line up 1:1 with the inputs ReplayMetadata expects (minus durationFrames + notes)', () => {
    const ctx: MatchStartContext = initialiseMatch({
      matchConfig: makeMatchConfig(),
      engineVersion: '0.3.1',
      fixedTimestepMs: 1000 / 60,
      nowFactory: fixedNow,
    });
    // The match-start metadata's fields are exactly what flows into
    // the ReplayMetadata block — `recordedAt`/`startedAt`,
    // `playerCount`, `engineVersion`, `fixedTimestepMs`. The two
    // additional ReplayMetadata fields (`durationFrames`, `notes`)
    // are only known at save time; they're not the responsibility of
    // the match-start helper.
    expect(typeof ctx.metadata.startedAt).toBe('string');
    expect(Date.parse(ctx.metadata.startedAt)).not.toBeNaN();
    expect(ctx.metadata.playerCount).toBe(2);
    expect(ctx.metadata.engineVersion).toBe('0.3.1');
    expect(ctx.metadata.fixedTimestepMs).toBeCloseTo(1000 / 60, 6);
    expect(ctx.metadata.stageId).toBe('flatlands');
    expect(ctx.metadata.characterIds).toEqual(['wolf', 'cat']);
  });

  it('matchConfig is suitable for direct use in serializeReplay (seed survives JSON round-trip)', () => {
    const ctx = initialiseMatch({
      matchConfig: makeMatchConfig({ rngSeed: 0xc0ffee }),
      nowFactory: fixedNow,
    });
    const roundTripped = JSON.parse(
      JSON.stringify(ctx.matchConfig),
    ) as MatchConfig;
    expect(roundTripped.rngSeed).toBe(0xc0ffee);
    expect(roundTripped.stageId).toBe('flatlands');
    expect(roundTripped.players.length).toBe(2);
  });
});
