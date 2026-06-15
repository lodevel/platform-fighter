import { describe, it, expect } from 'vitest';
import type { MatchConfig, PlayerSlot } from '../types';
import {
  REPLAY_FORMAT_MAGIC,
  REPLAY_FORMAT_VERSION,
  ReplayFileError,
  serializeReplay,
  deserializeReplay,
} from './ReplayFile';
import {
  CURRENT_REPLAY_FORMAT_VERSION,
  MIN_MIGRATABLE_REPLAY_VERSION,
  MIGRATABLE_REPLAY_VERSIONS,
  REPLAY_MIGRATIONS,
  ReplayVersionUnsupportedError,
  ReplayMigrationError,
  isCompatibleReplayVersion,
  describeReplayVersionStatus,
  migrateReplayPayload,
} from './replayMigrations';

/**
 * AC 30103 Sub-AC 3 — replay schema versioning + migration handlers.
 *
 * Coverage map:
 *
 *   • Public constants — MIN ≤ CURRENT, the chain is well-formed,
 *     CURRENT_REPLAY_FORMAT_VERSION matches REPLAY_FORMAT_VERSION.
 *   • isCompatibleReplayVersion — accepts the supported range,
 *     rejects everything else (including non-integers and floats).
 *   • describeReplayVersionStatus — discriminator covers all four
 *     branches (current, migratable, tooNew, tooOld, notAnInteger).
 *   • migrateReplayPayload — happy paths (current passes through,
 *     v0 walks to v1) and every error class
 *     (ReplayVersionUnsupportedError {tooOld, tooNew, notAnInteger},
 *     ReplayMigrationError on bad payloads).
 *   • Integration with deserializeReplay — a v0 payload round-trips
 *     through the loader; a too-new payload throws the same
 *     ReplayFileError class as other schema errors.
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
 * Build a synthetic v0 payload — a v1 file with `version: 0` and no
 * `metadata.engineVersion` / `metadata.notes` fields, mirroring the
 * pre-release format the v0 → v1 migration upgrades. We construct it
 * from a freshly-serialised v1 file and strip the extra fields so the
 * test fixture cannot drift from the real schema.
 */
function makeV0Payload(): Record<string, unknown> {
  const v1 = serializeReplay({
    matchConfig: makeMatchConfig(),
    capturedFrames: [],
    recordedAt: new Date('2026-04-30T12:00:00.000Z'),
    engineVersion: '0.1.0', // will be stripped to simulate v0
    notes: 'unit test v0',  // will be stripped to simulate v0
  });
  // JSON-clone so we can mutate freely.
  const clone = JSON.parse(JSON.stringify(v1)) as Record<string, unknown>;
  clone['version'] = 0;
  const md = clone['metadata'] as Record<string, unknown>;
  delete md['engineVersion'];
  delete md['notes'];
  return clone;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('replayMigrations — public constants', () => {
  it('CURRENT_REPLAY_FORMAT_VERSION matches REPLAY_FORMAT_VERSION', () => {
    expect(CURRENT_REPLAY_FORMAT_VERSION).toBe(REPLAY_FORMAT_VERSION);
  });

  it('MIN_MIGRATABLE_REPLAY_VERSION is non-negative and ≤ CURRENT', () => {
    expect(Number.isInteger(MIN_MIGRATABLE_REPLAY_VERSION)).toBe(true);
    expect(MIN_MIGRATABLE_REPLAY_VERSION).toBeGreaterThanOrEqual(0);
    expect(MIN_MIGRATABLE_REPLAY_VERSION).toBeLessThanOrEqual(
      CURRENT_REPLAY_FORMAT_VERSION,
    );
  });

  it('MIGRATABLE_REPLAY_VERSIONS spans MIN..CURRENT inclusive', () => {
    expect(MIGRATABLE_REPLAY_VERSIONS[0]).toBe(MIN_MIGRATABLE_REPLAY_VERSION);
    expect(
      MIGRATABLE_REPLAY_VERSIONS[MIGRATABLE_REPLAY_VERSIONS.length - 1],
    ).toBe(CURRENT_REPLAY_FORMAT_VERSION);
    // Strictly monotonic, integer-valued.
    for (let i = 1; i < MIGRATABLE_REPLAY_VERSIONS.length; i += 1) {
      expect(MIGRATABLE_REPLAY_VERSIONS[i]).toBe(
        MIGRATABLE_REPLAY_VERSIONS[i - 1]! + 1,
      );
    }
  });

  it('REPLAY_MIGRATIONS chain is contiguous and ascends MIN → CURRENT', () => {
    expect(REPLAY_MIGRATIONS.length).toBe(
      CURRENT_REPLAY_FORMAT_VERSION - MIN_MIGRATABLE_REPLAY_VERSION,
    );
    if (REPLAY_MIGRATIONS.length > 0) {
      expect(REPLAY_MIGRATIONS[0]!.from).toBe(MIN_MIGRATABLE_REPLAY_VERSION);
      expect(REPLAY_MIGRATIONS[REPLAY_MIGRATIONS.length - 1]!.to).toBe(
        CURRENT_REPLAY_FORMAT_VERSION,
      );
      for (let i = 0; i < REPLAY_MIGRATIONS.length; i += 1) {
        const step = REPLAY_MIGRATIONS[i]!;
        expect(step.to).toBe(step.from + 1);
        expect(typeof step.description).toBe('string');
        expect(step.description.length).toBeGreaterThan(0);
        if (i > 0) {
          expect(REPLAY_MIGRATIONS[i - 1]!.to).toBe(step.from);
        }
      }
    }
  });

  it('REPLAY_MIGRATIONS array is frozen', () => {
    expect(Object.isFrozen(REPLAY_MIGRATIONS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isCompatibleReplayVersion
// ---------------------------------------------------------------------------

describe('isCompatibleReplayVersion', () => {
  it('accepts every integer in [MIN, CURRENT]', () => {
    for (
      let v = MIN_MIGRATABLE_REPLAY_VERSION;
      v <= CURRENT_REPLAY_FORMAT_VERSION;
      v += 1
    ) {
      expect(isCompatibleReplayVersion(v)).toBe(true);
    }
  });

  it('rejects below MIN', () => {
    expect(isCompatibleReplayVersion(MIN_MIGRATABLE_REPLAY_VERSION - 1)).toBe(false);
  });

  it('rejects above CURRENT', () => {
    expect(isCompatibleReplayVersion(CURRENT_REPLAY_FORMAT_VERSION + 1)).toBe(false);
    expect(isCompatibleReplayVersion(999)).toBe(false);
  });

  it('rejects non-integer numbers', () => {
    expect(isCompatibleReplayVersion(0.5)).toBe(false);
    expect(isCompatibleReplayVersion(1.0001)).toBe(false);
    expect(isCompatibleReplayVersion(Number.NaN)).toBe(false);
    expect(isCompatibleReplayVersion(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('rejects non-numbers', () => {
    expect(isCompatibleReplayVersion('1' as unknown as number)).toBe(false);
    expect(isCompatibleReplayVersion(null)).toBe(false);
    expect(isCompatibleReplayVersion(undefined)).toBe(false);
    expect(isCompatibleReplayVersion({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// describeReplayVersionStatus
// ---------------------------------------------------------------------------

describe('describeReplayVersionStatus', () => {
  it('reports "current" for CURRENT_REPLAY_FORMAT_VERSION', () => {
    const status = describeReplayVersionStatus(CURRENT_REPLAY_FORMAT_VERSION);
    expect(status.kind).toBe('current');
    if (status.kind === 'current') {
      expect(status.version).toBe(CURRENT_REPLAY_FORMAT_VERSION);
    }
  });

  it('reports "migratable" with the right step count for MIN', () => {
    if (MIN_MIGRATABLE_REPLAY_VERSION === CURRENT_REPLAY_FORMAT_VERSION) {
      // Build only ships one version — skip.
      return;
    }
    const status = describeReplayVersionStatus(MIN_MIGRATABLE_REPLAY_VERSION);
    expect(status.kind).toBe('migratable');
    if (status.kind === 'migratable') {
      expect(status.steps.length).toBe(
        CURRENT_REPLAY_FORMAT_VERSION - MIN_MIGRATABLE_REPLAY_VERSION,
      );
      expect(status.steps[0]!.from).toBe(MIN_MIGRATABLE_REPLAY_VERSION);
      expect(status.steps[status.steps.length - 1]!.to).toBe(
        CURRENT_REPLAY_FORMAT_VERSION,
      );
    }
  });

  it('reports "tooNew" for versions above CURRENT', () => {
    const status = describeReplayVersionStatus(CURRENT_REPLAY_FORMAT_VERSION + 5);
    expect(status.kind).toBe('unsupported');
    if (status.kind === 'unsupported') {
      expect(status.reason).toBe('tooNew');
      expect(status.currentVersion).toBe(CURRENT_REPLAY_FORMAT_VERSION);
      expect(status.minVersion).toBe(MIN_MIGRATABLE_REPLAY_VERSION);
    }
  });

  it('reports "tooOld" for versions below MIN', () => {
    const status = describeReplayVersionStatus(MIN_MIGRATABLE_REPLAY_VERSION - 1);
    expect(status.kind).toBe('unsupported');
    if (status.kind === 'unsupported') {
      expect(status.reason).toBe('tooOld');
    }
  });

  it('reports "notAnInteger" for floats / non-numbers / NaN', () => {
    for (const bad of [0.5, Number.NaN, Number.POSITIVE_INFINITY, '1', null, undefined, {}]) {
      const status = describeReplayVersionStatus(bad);
      expect(status.kind).toBe('unsupported');
      if (status.kind === 'unsupported') {
        expect(status.reason).toBe('notAnInteger');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// migrateReplayPayload — happy paths
// ---------------------------------------------------------------------------

describe('migrateReplayPayload — happy path', () => {
  it('returns a current-version payload unchanged', () => {
    const v1 = serializeReplay({
      matchConfig: makeMatchConfig(),
      capturedFrames: [],
      recordedAt: new Date('2026-04-30T12:00:00.000Z'),
    });
    const cloned = JSON.parse(JSON.stringify(v1));
    const out = migrateReplayPayload(cloned);
    expect(out['version']).toBe(CURRENT_REPLAY_FORMAT_VERSION);
    // Pass-through equality for everything except possibly identity.
    expect(out).toEqual(cloned);
  });

  it('walks a v0 payload up to the current schema (v0 → v1 migration)', () => {
    const v0 = makeV0Payload();
    const upgraded = migrateReplayPayload(v0);
    expect(upgraded['version']).toBe(CURRENT_REPLAY_FORMAT_VERSION);
    const md = upgraded['metadata'] as Record<string, unknown>;
    expect(md['engineVersion']).toBe('0.0.0-pre-release');
    expect(md['notes']).toBe('');
    // Other fields must survive the migration unchanged.
    expect(upgraded['rngSeed']).toBe(v0['rngSeed']);
    expect(upgraded['matchConfig']).toEqual(v0['matchConfig']);
    expect(upgraded['inputTimeline']).toEqual(v0['inputTimeline']);
  });

  it('does not mutate the input payload (immutable transform)', () => {
    const v0 = makeV0Payload();
    const before = JSON.stringify(v0);
    migrateReplayPayload(v0);
    expect(JSON.stringify(v0)).toBe(before);
  });

  it('migration is deterministic — same input yields same output', () => {
    const a = migrateReplayPayload(makeV0Payload());
    const b = migrateReplayPayload(makeV0Payload());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('preserves caller-supplied engineVersion / notes when present in v0', () => {
    const v0 = makeV0Payload();
    const md = v0['metadata'] as Record<string, unknown>;
    md['engineVersion'] = '0.0.5-dev';
    md['notes'] = 'a v0 file with notes already filled in';
    const upgraded = migrateReplayPayload(v0);
    const upMd = upgraded['metadata'] as Record<string, unknown>;
    expect(upMd['engineVersion']).toBe('0.0.5-dev');
    expect(upMd['notes']).toBe('a v0 file with notes already filled in');
  });
});

// ---------------------------------------------------------------------------
// migrateReplayPayload — error cases
// ---------------------------------------------------------------------------

describe('migrateReplayPayload — invalid inputs', () => {
  it('throws ReplayVersionUnsupportedError {notAnInteger} for null', () => {
    try {
      migrateReplayPayload(null);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ReplayVersionUnsupportedError);
      if (err instanceof ReplayVersionUnsupportedError) {
        expect(err.kind).toBe('notAnInteger');
      }
    }
  });

  it('throws for arrays / non-objects', () => {
    expect(() => migrateReplayPayload([])).toThrow(ReplayVersionUnsupportedError);
    expect(() => migrateReplayPayload('hello')).toThrow(ReplayVersionUnsupportedError);
    expect(() => migrateReplayPayload(42)).toThrow(ReplayVersionUnsupportedError);
  });

  it('throws when the format magic does not match (refuses to migrate non-replay)', () => {
    const bogus = { format: 'something-else', version: 1 };
    expect(() => migrateReplayPayload(bogus)).toThrow(
      /format magic/,
    );
    expect(() => migrateReplayPayload(bogus)).toThrow(
      ReplayVersionUnsupportedError,
    );
  });

  it('tolerates a missing format magic (downstream parser will catch it)', () => {
    // Migration should not blow up just because a payload omits `format`;
    // the parser produces the canonical "format magic mismatch" error.
    const v0 = makeV0Payload();
    delete (v0 as Record<string, unknown>)['format'];
    const upgraded = migrateReplayPayload(v0);
    expect(upgraded['version']).toBe(CURRENT_REPLAY_FORMAT_VERSION);
  });

  it('throws ReplayVersionUnsupportedError {tooNew} for a future version', () => {
    const futuristic = {
      format: REPLAY_FORMAT_MAGIC,
      version: CURRENT_REPLAY_FORMAT_VERSION + 1,
    };
    try {
      migrateReplayPayload(futuristic);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ReplayVersionUnsupportedError);
      if (err instanceof ReplayVersionUnsupportedError) {
        expect(err.kind).toBe('tooNew');
        expect(err.fileVersion).toBe(CURRENT_REPLAY_FORMAT_VERSION + 1);
        expect(err.currentVersion).toBe(CURRENT_REPLAY_FORMAT_VERSION);
        expect(err.minVersion).toBe(MIN_MIGRATABLE_REPLAY_VERSION);
        expect(err.message).toMatch(/newer build/);
      }
    }
  });

  it('throws ReplayVersionUnsupportedError {tooOld} for a pre-MIN version', () => {
    if (MIN_MIGRATABLE_REPLAY_VERSION === 0) {
      // Can't construct a "too old" version without going negative,
      // which the integer guard catches as `notAnInteger`. Substitute
      // -1 — the guard correctly classifies it as "tooOld" because the
      // integer test uses Number.isInteger which accepts negatives.
      const tooOld = { format: REPLAY_FORMAT_MAGIC, version: -1 };
      try {
        migrateReplayPayload(tooOld);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ReplayVersionUnsupportedError);
        if (err instanceof ReplayVersionUnsupportedError) {
          expect(err.kind).toBe('tooOld');
        }
      }
    } else {
      const tooOld = {
        format: REPLAY_FORMAT_MAGIC,
        version: MIN_MIGRATABLE_REPLAY_VERSION - 1,
      };
      expect(() => migrateReplayPayload(tooOld)).toThrow(ReplayVersionUnsupportedError);
    }
  });

  it('throws {notAnInteger} for non-integer / non-number versions', () => {
    for (const badVersion of [0.5, Number.NaN, '1', null, undefined]) {
      try {
        migrateReplayPayload({ format: REPLAY_FORMAT_MAGIC, version: badVersion });
        throw new Error(
          `expected throw for version ${JSON.stringify(badVersion)}`,
        );
      } catch (err) {
        expect(err).toBeInstanceOf(ReplayVersionUnsupportedError);
        if (err instanceof ReplayVersionUnsupportedError) {
          expect(err.kind).toBe('notAnInteger');
        }
      }
    }
  });

  it('throws ReplayMigrationError when v0 → v1 sees a non-object metadata', () => {
    const v0 = makeV0Payload();
    (v0 as Record<string, unknown>)['metadata'] = null;
    try {
      migrateReplayPayload(v0);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ReplayMigrationError);
      if (err instanceof ReplayMigrationError) {
        expect(err.fromVersion).toBe(0);
        expect(err.toVersion).toBe(1);
      }
    }
  });

  it('error classes have stable names for instanceof / catch', () => {
    expect(new ReplayVersionUnsupportedError('tooNew', 999, 'msg').name).toBe(
      'ReplayVersionUnsupportedError',
    );
    expect(new ReplayMigrationError(0, 1, 'msg').name).toBe(
      'ReplayMigrationError',
    );
  });
});

// ---------------------------------------------------------------------------
// Integration with deserializeReplay
// ---------------------------------------------------------------------------

describe('deserializeReplay — integration with migrations', () => {
  it('loads a v0 payload via the migration chain and validates it as v1', () => {
    const v0 = makeV0Payload();
    const file = deserializeReplay(v0);
    expect(file.version).toBe(CURRENT_REPLAY_FORMAT_VERSION);
    expect(file.metadata.engineVersion).toBe('0.0.0-pre-release');
    expect(file.metadata.notes).toBe('');
    expect(file.matchConfig.rngSeed).toBe(0xc0ffee);
  });

  it('a future-version payload throws ReplayFileError with a clear message', () => {
    const futuristic = {
      format: REPLAY_FORMAT_MAGIC,
      version: CURRENT_REPLAY_FORMAT_VERSION + 1,
    };
    try {
      deserializeReplay(futuristic);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ReplayFileError);
      if (err instanceof Error) {
        // Error message surfaces the version-unsupported reason.
        expect(err.message).toMatch(/version unsupported/);
        expect(err.message).toMatch(/newer build/);
      }
    }
  });

  it('a too-old payload throws ReplayFileError, not a raw migration error', () => {
    if (MIN_MIGRATABLE_REPLAY_VERSION === 0) {
      const tooOld = { format: REPLAY_FORMAT_MAGIC, version: -1 };
      expect(() => deserializeReplay(tooOld)).toThrow(ReplayFileError);
    } else {
      const tooOld = {
        format: REPLAY_FORMAT_MAGIC,
        version: MIN_MIGRATABLE_REPLAY_VERSION - 1,
      };
      expect(() => deserializeReplay(tooOld)).toThrow(ReplayFileError);
    }
  });

  it('format-magic mismatch is still rejected with the canonical message', () => {
    const bogus = {
      format: 'something-else',
      version: CURRENT_REPLAY_FORMAT_VERSION,
    };
    expect(() => deserializeReplay(bogus)).toThrow(/format magic/);
  });

  it('a v0 round-trip preserves the input timeline byte-for-byte', () => {
    // Build a v1 file with a non-trivial timeline, downgrade to v0,
    // re-deserialise — the timeline must survive the migration.
    const v1 = serializeReplay({
      matchConfig: makeMatchConfig({ players: makePlayerSlots(2) }),
      capturedFrames: [
        {
          frame: 0,
          inputs: [
            { moveX: 1, moveY: 0, jump: true, attack: false, dropThrough: false },
            { moveX: -0.5, moveY: 0, jump: false, attack: true, dropThrough: false },
          ],
        },
        {
          frame: 1,
          inputs: [
            { moveX: 0, moveY: 0, jump: false, attack: false, dropThrough: true },
            { moveX: 0, moveY: 0, jump: false, attack: false, dropThrough: false },
          ],
        },
      ],
      recordedAt: new Date('2026-04-30T12:00:00.000Z'),
    });
    const v0 = JSON.parse(JSON.stringify(v1)) as Record<string, unknown>;
    v0['version'] = 0;
    const md = v0['metadata'] as Record<string, unknown>;
    delete md['engineVersion'];
    delete md['notes'];

    const reloaded = deserializeReplay(v0);
    expect(reloaded.inputTimeline.entries).toHaveLength(2);
    expect(reloaded.inputTimeline.entries[0]!.inputs[0]!.moveX).toBe(1);
    expect(reloaded.inputTimeline.entries[1]!.inputs[0]!.dropThrough).toBe(true);
  });
});
