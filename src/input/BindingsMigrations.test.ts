import { describe, expect, it } from 'vitest';
import {
  BINDINGS_MIGRATIONS,
  BindingsMigrationError,
  BindingsVersionUnsupportedError,
  CURRENT_BINDINGS_SCHEMA_VERSION,
  MIGRATABLE_BINDINGS_VERSIONS,
  MIN_MIGRATABLE_BINDINGS_VERSION,
  describeBindingsVersionStatus,
  detectBindingsPayloadVersion,
  detectVersionOnParsedPayload,
  isCompatibleBindingsVersion,
  loadBindingsWithMigrationOrDefaults,
  migrateBindingsPayload,
  migrationAwareDeserializeBindingsSnapshot,
  migrationAwareDeserializePlayerBindings,
  safeMigrateBindingsJson,
  safeMigrateParsedBindings,
} from './BindingsMigrations';
import {
  BINDINGS_SCHEMA_VERSION,
  serializeBindingsSnapshot,
  serializePlayerBindings,
} from './InputBindingsSerializer';
import { DEFAULT_PLAYER_BINDINGS } from './InputBindingsStore';
import type {
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';

/**
 * AC 40003 Sub-AC 3 — schema migration system for player input bindings.
 *
 * Locks down:
 *
 *   1. Constants — CURRENT / MIN agree with the serializer's schema
 *      version, and the migratable-versions list is monotonic and
 *      contiguous.
 *   2. Chain integrity — every registered migration advances the
 *      version by exactly 1, the chain begins at MIN and ends at
 *      CURRENT, and no gaps exist.
 *   3. Version detection — JSON parse failures, non-object roots, and
 *      missing / non-integer schemaVersion fields are reported with the
 *      right `reason` discriminator.
 *   4. Compatibility check — versions inside [MIN, CURRENT] return true,
 *      everything else returns false; non-integers and non-numbers
 *      return false too.
 *   5. Status describer — current / migratable / unsupported branches
 *      yield the right shape, with `tooOld` / `tooNew` /
 *      `notAnInteger` reasons.
 *   6. Migration walker — current-version blobs pass through, older
 *      blobs walk through the chain, out-of-window versions raise
 *      typed errors, and a step that throws raises a wrapped
 *      BindingsMigrationError.
 *   7. v0 → v1 migration — both flat-snapshot and flat-single-player
 *      v0 shapes upgrade into the canonical envelope.
 *   8. Safe migration — every throw path becomes a typed Result; a
 *      non-JSON string returns a `notAnInteger` reason rather than
 *      raising.
 *   9. Migration-aware deserializers — current-version blobs round-trip
 *      losslessly, v0 blobs upgrade and validate, structurally invalid
 *      blobs surface as `invalidContent`.
 *  10. Load-or-defaults — missing / corrupt / migration-failed inputs
 *      all funnel into the same defaults fall-back with the right
 *      `source` and `fallbackReason`.
 */

// ---------------------------------------------------------------------------
// Constants + chain shape
// ---------------------------------------------------------------------------

describe('BindingsMigrations — constants', () => {
  it('CURRENT_BINDINGS_SCHEMA_VERSION matches the serializer', () => {
    expect(CURRENT_BINDINGS_SCHEMA_VERSION).toBe(BINDINGS_SCHEMA_VERSION);
  });

  it('MIN_MIGRATABLE_BINDINGS_VERSION is non-negative and ≤ CURRENT', () => {
    expect(MIN_MIGRATABLE_BINDINGS_VERSION).toBeGreaterThanOrEqual(0);
    expect(MIN_MIGRATABLE_BINDINGS_VERSION).toBeLessThanOrEqual(
      CURRENT_BINDINGS_SCHEMA_VERSION,
    );
  });

  it('MIGRATABLE_BINDINGS_VERSIONS is a contiguous monotonic list', () => {
    expect(MIGRATABLE_BINDINGS_VERSIONS.length).toBe(
      CURRENT_BINDINGS_SCHEMA_VERSION - MIN_MIGRATABLE_BINDINGS_VERSION + 1,
    );
    for (let i = 0; i < MIGRATABLE_BINDINGS_VERSIONS.length; i += 1) {
      expect(MIGRATABLE_BINDINGS_VERSIONS[i]).toBe(MIN_MIGRATABLE_BINDINGS_VERSION + i);
    }
  });

  it('MIGRATABLE_BINDINGS_VERSIONS is frozen', () => {
    expect(Object.isFrozen(MIGRATABLE_BINDINGS_VERSIONS)).toBe(true);
  });
});

describe('BindingsMigrations — chain integrity', () => {
  it('every registered migration advances the version by exactly 1', () => {
    for (const step of BINDINGS_MIGRATIONS) {
      expect(step.to).toBe(step.from + 1);
    }
  });

  it('chain begins at MIN and ends at CURRENT', () => {
    if (BINDINGS_MIGRATIONS.length > 0) {
      expect(BINDINGS_MIGRATIONS[0]!.from).toBe(MIN_MIGRATABLE_BINDINGS_VERSION);
      expect(BINDINGS_MIGRATIONS[BINDINGS_MIGRATIONS.length - 1]!.to).toBe(
        CURRENT_BINDINGS_SCHEMA_VERSION,
      );
    } else {
      expect(MIN_MIGRATABLE_BINDINGS_VERSION).toBe(CURRENT_BINDINGS_SCHEMA_VERSION);
    }
  });

  it('chain has no gaps between consecutive migrations', () => {
    for (let i = 1; i < BINDINGS_MIGRATIONS.length; i += 1) {
      expect(BINDINGS_MIGRATIONS[i]!.from).toBe(BINDINGS_MIGRATIONS[i - 1]!.to);
    }
  });

  it('registered chain is frozen against mutation', () => {
    expect(Object.isFrozen(BINDINGS_MIGRATIONS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Version detection
// ---------------------------------------------------------------------------

describe('detectBindingsPayloadVersion', () => {
  it('reads schemaVersion from a valid envelope', () => {
    const json = serializeBindingsSnapshot(DEFAULT_PLAYER_BINDINGS);
    const result = detectBindingsPayloadVersion(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version).toBe(CURRENT_BINDINGS_SCHEMA_VERSION);
      expect(result.raw).toMatchObject({ schemaVersion: CURRENT_BINDINGS_SCHEMA_VERSION });
    }
  });

  it('returns notAnInteger reason for non-JSON input', () => {
    const result = detectBindingsPayloadVersion('not json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('notAnInteger');
      expect(result.error).toMatch(/not valid JSON/);
    }
  });

  it('rejects payloads where the top level is not an object', () => {
    expect(detectBindingsPayloadVersion('[]').ok).toBe(false);
    expect(detectBindingsPayloadVersion('null').ok).toBe(false);
    expect(detectBindingsPayloadVersion('"hello"').ok).toBe(false);
    expect(detectBindingsPayloadVersion('42').ok).toBe(false);
  });

  it('rejects missing / non-integer schemaVersion', () => {
    expect(detectBindingsPayloadVersion('{}').ok).toBe(false);
    expect(detectBindingsPayloadVersion('{"schemaVersion":"1"}').ok).toBe(false);
    expect(detectBindingsPayloadVersion('{"schemaVersion":1.5}').ok).toBe(false);
    expect(detectBindingsPayloadVersion('{"schemaVersion":NaN}').ok).toBe(false);
  });

  it('detectVersionOnParsedPayload accepts a pre-parsed object', () => {
    const result = detectVersionOnParsedPayload({
      schemaVersion: 1,
      kind: 'bindingsSnapshot',
      data: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Compatibility checks
// ---------------------------------------------------------------------------

describe('isCompatibleBindingsVersion', () => {
  it('returns true for the current version', () => {
    expect(isCompatibleBindingsVersion(CURRENT_BINDINGS_SCHEMA_VERSION)).toBe(true);
  });

  it('returns true for every version in [MIN, CURRENT]', () => {
    for (const v of MIGRATABLE_BINDINGS_VERSIONS) {
      expect(isCompatibleBindingsVersion(v)).toBe(true);
    }
  });

  it('returns false for too-old / too-new / non-integer values', () => {
    expect(isCompatibleBindingsVersion(MIN_MIGRATABLE_BINDINGS_VERSION - 1)).toBe(false);
    expect(isCompatibleBindingsVersion(CURRENT_BINDINGS_SCHEMA_VERSION + 1)).toBe(false);
    expect(isCompatibleBindingsVersion('1' as unknown as number)).toBe(false);
    expect(isCompatibleBindingsVersion(1.5)).toBe(false);
    expect(isCompatibleBindingsVersion(NaN)).toBe(false);
    expect(isCompatibleBindingsVersion(undefined)).toBe(false);
  });
});

describe('describeBindingsVersionStatus', () => {
  it('returns kind=current for the build version', () => {
    const status = describeBindingsVersionStatus(CURRENT_BINDINGS_SCHEMA_VERSION);
    expect(status.kind).toBe('current');
  });

  it('returns kind=migratable for older but in-window versions', () => {
    if (MIN_MIGRATABLE_BINDINGS_VERSION === CURRENT_BINDINGS_SCHEMA_VERSION) {
      // No migratable versions on this build — skip.
      return;
    }
    const status = describeBindingsVersionStatus(MIN_MIGRATABLE_BINDINGS_VERSION);
    expect(status.kind).toBe('migratable');
    if (status.kind === 'migratable') {
      expect(status.steps.length).toBeGreaterThanOrEqual(1);
      // Steps must walk from the supplied version to current.
      expect(status.steps[0]!.from).toBe(MIN_MIGRATABLE_BINDINGS_VERSION);
      expect(status.steps[status.steps.length - 1]!.to).toBe(CURRENT_BINDINGS_SCHEMA_VERSION);
    }
  });

  it('returns kind=unsupported with reason=tooOld for sub-MIN versions', () => {
    const status = describeBindingsVersionStatus(MIN_MIGRATABLE_BINDINGS_VERSION - 1);
    expect(status.kind).toBe('unsupported');
    if (status.kind === 'unsupported') {
      expect(status.reason).toBe('tooOld');
    }
  });

  it('returns kind=unsupported with reason=tooNew for above-CURRENT versions', () => {
    const status = describeBindingsVersionStatus(CURRENT_BINDINGS_SCHEMA_VERSION + 1);
    expect(status.kind).toBe('unsupported');
    if (status.kind === 'unsupported') {
      expect(status.reason).toBe('tooNew');
    }
  });

  it('returns kind=unsupported with reason=notAnInteger for non-integer inputs', () => {
    expect(describeBindingsVersionStatus('1' as unknown).kind).toBe('unsupported');
    expect(describeBindingsVersionStatus(NaN).kind).toBe('unsupported');
    expect(describeBindingsVersionStatus(undefined).kind).toBe('unsupported');
    const status = describeBindingsVersionStatus(undefined);
    if (status.kind === 'unsupported') {
      expect(status.reason).toBe('notAnInteger');
    }
  });
});

// ---------------------------------------------------------------------------
// Migration walker — current-version pass-through and out-of-window errors
// ---------------------------------------------------------------------------

describe('migrateBindingsPayload', () => {
  it('passes a current-version payload through unchanged', () => {
    const payload = {
      schemaVersion: CURRENT_BINDINGS_SCHEMA_VERSION,
      kind: 'bindingsSnapshot',
      data: {},
    };
    const out = migrateBindingsPayload(payload);
    expect(out.schemaVersion).toBe(CURRENT_BINDINGS_SCHEMA_VERSION);
  });

  it('throws BindingsVersionUnsupportedError on tooOld payloads', () => {
    expect(() =>
      migrateBindingsPayload({
        schemaVersion: MIN_MIGRATABLE_BINDINGS_VERSION - 1,
        data: {},
      }),
    ).toThrowError(BindingsVersionUnsupportedError);
    try {
      migrateBindingsPayload({
        schemaVersion: MIN_MIGRATABLE_BINDINGS_VERSION - 1,
        data: {},
      });
    } catch (err) {
      expect(err).toBeInstanceOf(BindingsVersionUnsupportedError);
      if (err instanceof BindingsVersionUnsupportedError) {
        expect(err.kind).toBe('tooOld');
      }
    }
  });

  it('throws BindingsVersionUnsupportedError on tooNew payloads', () => {
    try {
      migrateBindingsPayload({
        schemaVersion: CURRENT_BINDINGS_SCHEMA_VERSION + 5,
        data: {},
      });
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BindingsVersionUnsupportedError);
      if (err instanceof BindingsVersionUnsupportedError) {
        expect(err.kind).toBe('tooNew');
      }
    }
  });

  it('throws BindingsVersionUnsupportedError on non-integer schemaVersion', () => {
    try {
      migrateBindingsPayload({ schemaVersion: 'one', data: {} });
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BindingsVersionUnsupportedError);
      if (err instanceof BindingsVersionUnsupportedError) {
        expect(err.kind).toBe('notAnInteger');
      }
    }
  });

  it('throws BindingsVersionUnsupportedError on non-object input', () => {
    expect(() => migrateBindingsPayload(null)).toThrowError(BindingsVersionUnsupportedError);
    expect(() => migrateBindingsPayload([])).toThrowError(BindingsVersionUnsupportedError);
    expect(() => migrateBindingsPayload('hello')).toThrowError(BindingsVersionUnsupportedError);
  });
});

// ---------------------------------------------------------------------------
// v0 → v1 migration (the registered example handler)
// ---------------------------------------------------------------------------

describe('v0 → v1 bindings migration', () => {
  it('upgrades a flat v0 snapshot into the canonical envelope', () => {
    // Build a minimal v0 snapshot that mirrors the v1 default but in
    // the legacy shape (no `kind` discriminator, body keyed under
    // `slots`, schemaVersion=0).
    const slots: Record<string, PlayerBindings> = {};
    const indices: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
    for (const slot of indices) {
      slots[String(slot)] = DEFAULT_PLAYER_BINDINGS[slot];
    }
    const v0 = { schemaVersion: 0, slots };

    const out = migrateBindingsPayload(v0);
    expect(out.schemaVersion).toBe(1);
    expect(out.kind).toBe('bindingsSnapshot');
    expect(out.data).toMatchObject({
      '1': DEFAULT_PLAYER_BINDINGS[1],
      '2': DEFAULT_PLAYER_BINDINGS[2],
      '3': DEFAULT_PLAYER_BINDINGS[3],
      '4': DEFAULT_PLAYER_BINDINGS[4],
    });
  });

  it('upgrades a flat v0 single-player blob into the canonical envelope', () => {
    const v0 = {
      schemaVersion: 0,
      playerIndex: 1,
      bindings: DEFAULT_PLAYER_BINDINGS[1].bindings,
    };
    const out = migrateBindingsPayload(v0);
    expect(out.schemaVersion).toBe(1);
    expect(out.kind).toBe('playerBindings');
    expect((out.data as Record<string, unknown>)['playerIndex']).toBe(1);
    expect((out.data as Record<string, unknown>)['bindings']).toEqual(
      DEFAULT_PLAYER_BINDINGS[1].bindings,
    );
  });

  it('throws BindingsMigrationError on a v0 blob with neither slots nor playerIndex', () => {
    try {
      migrateBindingsPayload({ schemaVersion: 0 });
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BindingsMigrationError);
      if (err instanceof BindingsMigrationError) {
        expect(err.fromVersion).toBe(0);
        expect(err.toVersion).toBe(1);
      }
    }
  });

  it('throws BindingsMigrationError when a v0 blob has slots: array', () => {
    try {
      migrateBindingsPayload({ schemaVersion: 0, slots: [] });
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BindingsMigrationError);
    }
  });
});

// ---------------------------------------------------------------------------
// Safe migration wrappers (Result-style)
// ---------------------------------------------------------------------------

describe('safeMigrateBindingsJson', () => {
  it('returns ok=true with no migratedFrom for current-version JSON', () => {
    const json = serializeBindingsSnapshot(DEFAULT_PLAYER_BINDINGS);
    const result = safeMigrateBindingsJson(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migratedFrom).toBeUndefined();
    }
  });

  it('returns ok=true with migratedFrom=0 for a v0 snapshot', () => {
    const v0 = { schemaVersion: 0, slots: {} as Record<string, PlayerBindings> };
    const indices: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
    for (const slot of indices) {
      (v0.slots as Record<string, PlayerBindings>)[String(slot)] = DEFAULT_PLAYER_BINDINGS[slot];
    }
    const result = safeMigrateBindingsJson(JSON.stringify(v0));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migratedFrom).toBe(0);
    }
  });

  it('returns ok=false with reason=notAnInteger for non-JSON input', () => {
    const result = safeMigrateBindingsJson('this is not json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('notAnInteger');
    }
  });

  it('returns ok=false with reason=tooOld / tooNew for out-of-window versions', () => {
    const tooOld = safeMigrateBindingsJson(
      JSON.stringify({ schemaVersion: MIN_MIGRATABLE_BINDINGS_VERSION - 1 }),
    );
    expect(tooOld.ok).toBe(false);
    if (!tooOld.ok) expect(tooOld.reason).toBe('tooOld');

    const tooNew = safeMigrateBindingsJson(
      JSON.stringify({ schemaVersion: CURRENT_BINDINGS_SCHEMA_VERSION + 9 }),
    );
    expect(tooNew.ok).toBe(false);
    if (!tooNew.ok) expect(tooNew.reason).toBe('tooNew');
  });

  it('returns ok=false with reason=migrationFailed when a step throws', () => {
    // Drop the marker fields so the v0 → v1 step can't determine which
    // legacy shape this is — the migration handler raises
    // BindingsMigrationError, which the safe wrapper translates into
    // reason: 'migrationFailed'.
    const result = safeMigrateBindingsJson(JSON.stringify({ schemaVersion: 0 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('migrationFailed');
    }
  });

  it('safeMigrateParsedBindings mirrors the JSON-string variant', () => {
    const parsed = JSON.parse(serializeBindingsSnapshot(DEFAULT_PLAYER_BINDINGS));
    const result = safeMigrateParsedBindings(parsed);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Migration-aware deserializers (load-path integration)
// ---------------------------------------------------------------------------

describe('migrationAwareDeserializeBindingsSnapshot', () => {
  it('round-trips a current-version snapshot with no migration', () => {
    const json = serializeBindingsSnapshot(DEFAULT_PLAYER_BINDINGS);
    const result = migrationAwareDeserializeBindingsSnapshot(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[1]).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
      expect(result.value[2]).toEqual(DEFAULT_PLAYER_BINDINGS[2]);
      expect(result.value[3]).toEqual(DEFAULT_PLAYER_BINDINGS[3]);
      expect(result.value[4]).toEqual(DEFAULT_PLAYER_BINDINGS[4]);
      expect(result.migratedFrom).toBeUndefined();
    }
  });

  it('upgrades a v0 snapshot blob and validates the result', () => {
    const slots: Record<string, PlayerBindings> = {};
    const indices: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
    for (const slot of indices) {
      slots[String(slot)] = DEFAULT_PLAYER_BINDINGS[slot];
    }
    const v0 = JSON.stringify({ schemaVersion: 0, slots });
    const result = migrationAwareDeserializeBindingsSnapshot(v0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migratedFrom).toBe(0);
      expect(result.value[1]).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
    }
  });

  it('returns reason=invalidContent when the post-migration body fails strict validation', () => {
    // Slot 1 is structurally bad: keyCode -1 is rejected by the
    // strict validator in InputBindingsStore.assertValidPlayerBindings.
    const slots = {
      '1': {
        playerIndex: 1,
        bindings: {
          left: [{ kind: 'keyboard', keyCode: -1 }],
          right: [],
          up: [],
          down: [],
          jump: [],
          attack: [],
          special: [],
          shield: [],
          grab: [],
          taunt: [],
        },
      },
      '2': DEFAULT_PLAYER_BINDINGS[2],
      '3': DEFAULT_PLAYER_BINDINGS[3],
      '4': DEFAULT_PLAYER_BINDINGS[4],
    };
    const v0 = JSON.stringify({ schemaVersion: 0, slots });
    const result = migrationAwareDeserializeBindingsSnapshot(v0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalidContent');
    }
  });

  it('returns reason=tooOld for ancient versions', () => {
    const result = migrationAwareDeserializeBindingsSnapshot(
      JSON.stringify({ schemaVersion: MIN_MIGRATABLE_BINDINGS_VERSION - 1 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('tooOld');
  });
});

describe('migrationAwareDeserializePlayerBindings', () => {
  it('round-trips a current-version single-player envelope', () => {
    const json = serializePlayerBindings(DEFAULT_PLAYER_BINDINGS[1]);
    const result = migrationAwareDeserializePlayerBindings(json, 1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
    }
  });

  it('upgrades a v0 single-player blob', () => {
    const v0 = JSON.stringify({
      schemaVersion: 0,
      playerIndex: 2,
      bindings: DEFAULT_PLAYER_BINDINGS[2].bindings,
    });
    const result = migrationAwareDeserializePlayerBindings(v0, 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migratedFrom).toBe(0);
      expect(result.value.playerIndex).toBe(2);
    }
  });

  it('rejects a v0 blob whose playerIndex disagrees with the expected slot', () => {
    const v0 = JSON.stringify({
      schemaVersion: 0,
      playerIndex: 3,
      bindings: DEFAULT_PLAYER_BINDINGS[3].bindings,
    });
    const result = migrationAwareDeserializePlayerBindings(v0, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalidContent');
    }
  });
});

// ---------------------------------------------------------------------------
// Load-or-defaults helper (the boot-path entry point)
// ---------------------------------------------------------------------------

describe('loadBindingsWithMigrationOrDefaults', () => {
  const defaults: Record<PlayerBindingsIndex, PlayerBindings> = {
    1: DEFAULT_PLAYER_BINDINGS[1],
    2: DEFAULT_PLAYER_BINDINGS[2],
    3: DEFAULT_PLAYER_BINDINGS[3],
    4: DEFAULT_PLAYER_BINDINGS[4],
  };

  it('returns source=defaults / fallbackReason=missing when JSON is null', () => {
    const result = loadBindingsWithMigrationOrDefaults(null, defaults);
    expect(result.source).toBe('defaults');
    expect(result.fallbackReason).toBe('missing');
    expect(result.bindings).toEqual(defaults);
  });

  it('returns source=storage for a current-version blob', () => {
    const result = loadBindingsWithMigrationOrDefaults(
      serializeBindingsSnapshot(DEFAULT_PLAYER_BINDINGS),
      defaults,
    );
    expect(result.source).toBe('storage');
    expect(result.bindings[1]).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
  });

  it('returns source=migrated with migratedFrom set for a v0 blob', () => {
    const slots: Record<string, PlayerBindings> = {};
    const indices: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
    for (const slot of indices) {
      slots[String(slot)] = DEFAULT_PLAYER_BINDINGS[slot];
    }
    const v0 = JSON.stringify({ schemaVersion: 0, slots });
    const result = loadBindingsWithMigrationOrDefaults(v0, defaults);
    expect(result.source).toBe('migrated');
    expect(result.migratedFrom).toBe(0);
  });

  it('falls back to defaults with fallbackReason=tooOld for ancient blobs', () => {
    const json = JSON.stringify({ schemaVersion: MIN_MIGRATABLE_BINDINGS_VERSION - 1 });
    const result = loadBindingsWithMigrationOrDefaults(json, defaults);
    expect(result.source).toBe('defaults');
    expect(result.fallbackReason).toBe('tooOld');
    expect(result.bindings).toEqual(defaults);
  });

  it('falls back to defaults with fallbackReason=tooNew for future blobs', () => {
    const json = JSON.stringify({ schemaVersion: CURRENT_BINDINGS_SCHEMA_VERSION + 7 });
    const result = loadBindingsWithMigrationOrDefaults(json, defaults);
    expect(result.source).toBe('defaults');
    expect(result.fallbackReason).toBe('tooNew');
  });

  it('falls back to defaults with fallbackReason=migrationFailed when a step throws', () => {
    const result = loadBindingsWithMigrationOrDefaults(
      JSON.stringify({ schemaVersion: 0 }),
      defaults,
    );
    expect(result.source).toBe('defaults');
    expect(result.fallbackReason).toBe('migrationFailed');
  });

  it('falls back to defaults with fallbackReason=notAnInteger for junk JSON', () => {
    const result = loadBindingsWithMigrationOrDefaults('not json', defaults);
    expect(result.source).toBe('defaults');
    expect(result.fallbackReason).toBe('notAnInteger');
  });
});

// ---------------------------------------------------------------------------
// Determinism — same input produces same output regardless of when it runs
// ---------------------------------------------------------------------------

describe('BindingsMigrations — determinism', () => {
  it('a v0 → v1 migration produces byte-identical output across runs', () => {
    const slots: Record<string, PlayerBindings> = {};
    const indices: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
    for (const slot of indices) {
      slots[String(slot)] = DEFAULT_PLAYER_BINDINGS[slot];
    }
    const v0 = { schemaVersion: 0, slots };
    const a = JSON.stringify(migrateBindingsPayload(v0));
    const b = JSON.stringify(migrateBindingsPayload(JSON.parse(JSON.stringify(v0))));
    expect(a).toBe(b);
  });
});
