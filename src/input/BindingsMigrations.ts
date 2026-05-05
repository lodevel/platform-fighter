/**
 * Bindings schema migration framework — AC 40003 Sub-AC 3.
 *
 * What this module is
 * ===================
 *
 * The forward-compatibility layer for the M5 input-rebinding settings
 * format. The rebinding system writes a versioned envelope to
 * `localStorage` and embeds the same shape inside every replay file so
 * recorded matches replay against the binding table that was active when
 * they were recorded. As the schema evolves — new logical actions, new
 * device families (arcade sticks, MIDI), new fields on existing bindings
 * (vibration, alternate dead-zones) — the on-disk version integer must
 * keep older blobs loadable until the player explicitly opts to discard
 * them. Without this module, every schema bump would either:
 *
 *   • Silently corrupt older saves (the old data deserialises into a
 *     half-shaped object that the validator rejects late, leaving a
 *     player unable to jump on next boot), or
 *   • Hard-reject the blob and stomp the player's customisations with
 *     defaults, on every breaking change.
 *
 * The migration framework solves both: a v0 blob is *upgraded* into a
 * v1 blob through one or more pure transform functions before the strict
 * validator ever sees it. If a migration step fails (genuinely broken
 * data, not just an old shape), the load path falls back to defaults
 * with a clear error code so the boot sequence never crashes and the
 * settings UI can offer "Restore from corrupted save" affordances.
 *
 * This module mirrors the design of `replay/replayMigrations.ts` (which
 * shipped earlier as AC 30103 Sub-AC 3 for the M4 replay format). The
 * two systems are intentionally parallel — schema migration is a
 * load-time concern, not a domain-specific one — but kept as separate
 * modules because the registries differ and a future binary replay
 * format would diverge from the JSON-only bindings format.
 *
 * Where it sits in the load pipeline
 * ----------------------------------
 *
 *   raw JSON ──► JSON.parse ──► { schemaVersion: N, kind, data } ──┐
 *                                                                   │
 *                                                                   ▼
 *                                       ┌────────────────────────────────┐
 *                                       │  migrateBindingsPayload(...)   │  ◄── this module
 *                                       └────────────────────────────────┘
 *                                                                   │
 *                                                                   ▼
 *                                       ┌────────────────────────────────┐
 *                                       │  deserialize{Player,Snapshot}  │  (./InputBindingsSerializer)
 *                                       └────────────────────────────────┘
 *                                                                   │
 *                                                                   ▼
 *                                       ┌────────────────────────────────┐
 *                                       │  loadBindingsSnapshotOrDefaults│  (./BindingsStorage)
 *                                       └────────────────────────────────┘
 *                                                                   │
 *                                                                   ▼
 *                                              PlayerBindings × 4 (or defaults)
 *
 * The migration step is a *pre-validator* — it reshapes a payload into
 * the current schema, then the strict validator runs as before. This
 * keeps per-version branches out of the validator (which only ever sees
 * today's schema) and out of the runtime store (which only ever sees a
 * fully-validated table).
 *
 * Determinism
 * -----------
 *
 * Migrations are pure functions of their input payload. They never read
 * `Date.now()`, `Math.random()`, or any global state — every default
 * value baked in is a literal constant. A v0 blob run through the
 * migration produces the same v1 blob regardless of when or where the
 * migration runs, which the determinism contract for replays requires
 * (replays embed a binding snapshot; if the snapshot's bytes were
 * environment-dependent, the replay's checksum would vary across
 * machines).
 *
 * Strict TypeScript
 * -----------------
 *
 * The codebase compiles under `strict + noUncheckedIndexedAccess`. Every
 * field read inside a migration handler must therefore handle the
 * `unknown` type defensively — handlers receive a `Record<string,
 * unknown>` (i.e. raw `JSON.parse` output) and produce a same-typed
 * result. The downstream validator does the per-field type narrowing
 * once, after the chain has run.
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM imports — this module is unit-testable under
 * plain Node (vitest) and reusable from headless settings tooling (e.g.
 * a future "import settings from another player's profile JSON" CLI).
 */

import {
  BINDINGS_SCHEMA_VERSION,
  deserializeBindingsSnapshot,
  deserializePlayerBindings,
  type DeserializeResult,
} from './InputBindingsSerializer';
import type {
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The schema version this build *writes* and natively *reads*. Re-export
 * of {@link BINDINGS_SCHEMA_VERSION} pinned to a stable name from this
 * module so consumers that only care about migration policy don't have
 * to import from `./InputBindingsSerializer` as well.
 *
 * Typed as `number` (not the literal `1`) so future bumps don't cascade
 * a wave of "literal type comparison" warnings into versioning logic
 * that intentionally treats the value as an open integer.
 */
export const CURRENT_BINDINGS_SCHEMA_VERSION: number = BINDINGS_SCHEMA_VERSION;

/**
 * The oldest schema version this build can migrate forward into the
 * current schema. Older blobs are rejected at load time with a
 * {@link BindingsVersionUnsupportedError} whose `kind === 'tooOld'` —
 * versions below this point either had no shipped readers or differ
 * from v1 in ways no migration can express.
 *
 * Today this is `0` because the registered v0 → v1 migration is enough
 * to walk every still-readable historical format up to the current one.
 * If a future build retires a migration step (e.g. binary v2 cannot be
 * back-derived from textual v0), bump this constant and surface a
 * clear error in the settings UI rather than silently losing data.
 *
 * Typed as `number` for the same reason as
 * {@link CURRENT_BINDINGS_SCHEMA_VERSION} — the policy is "the value of
 * this integer", not "this specific literal".
 */
export const MIN_MIGRATABLE_BINDINGS_VERSION: number = 0;

/**
 * Convenience: the ordered list of intermediate versions that a payload
 * may pass through during migration to the current schema. Useful for
 * the settings UI to show "migrating v0 → v1 → v2…" progress when a
 * future chain grows long. Always strictly monotonic.
 */
export const MIGRATABLE_BINDINGS_VERSIONS: ReadonlyArray<number> = Object.freeze(
  Array.from(
    { length: CURRENT_BINDINGS_SCHEMA_VERSION - MIN_MIGRATABLE_BINDINGS_VERSION + 1 },
    (_, i) => MIN_MIGRATABLE_BINDINGS_VERSION + i,
  ),
);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Discriminator on {@link BindingsVersionUnsupportedError} explaining
 * *why* the version is unsupported. Surfacing this lets the settings UI
 * show different copy:
 *
 *   • `tooOld` — "These settings were written by a much older build and
 *     can no longer be loaded. Reset to defaults?"
 *   • `tooNew` — "These settings were written by a newer build of the
 *     game. Update to load them."
 *   • `notAnInteger` — "The settings file's version field is corrupt."
 */
export type BindingsVersionUnsupportedKind = 'tooOld' | 'tooNew' | 'notAnInteger';

/**
 * Thrown by {@link migrateBindingsPayload} when a payload's version
 * cannot be reconciled with the current schema:
 *
 *   • The version is below {@link MIN_MIGRATABLE_BINDINGS_VERSION}
 *     (`kind === 'tooOld'`) — no registered migration can produce a
 *     current-version payload from it.
 *   • The version is above {@link CURRENT_BINDINGS_SCHEMA_VERSION}
 *     (`kind === 'tooNew'`) — this build doesn't know what fields the
 *     payload carries; loading would risk silently dropping data.
 *   • The version is not a finite non-negative integer
 *     (`kind === 'notAnInteger'`) — the file is corrupt.
 *
 * Distinct subclass (extends `Error` directly rather than reusing the
 * serializer's plain throw) so callers can `catch (e) { if (e instanceof
 * BindingsVersionUnsupportedError) showResetToast() }` without sniffing
 * message strings.
 */
export class BindingsVersionUnsupportedError extends Error {
  readonly kind: BindingsVersionUnsupportedKind;
  readonly fileVersion: unknown;
  readonly currentVersion: number;
  readonly minVersion: number;

  constructor(
    kind: BindingsVersionUnsupportedKind,
    fileVersion: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'BindingsVersionUnsupportedError';
    this.kind = kind;
    this.fileVersion = fileVersion;
    this.currentVersion = CURRENT_BINDINGS_SCHEMA_VERSION;
    this.minVersion = MIN_MIGRATABLE_BINDINGS_VERSION;
  }
}

/**
 * Thrown when a registered migration handler itself fails on a specific
 * payload — e.g. a v0 blob whose `data` field is missing all four slots
 * the v0 → v1 handler expects to be present. Distinct from
 * {@link BindingsVersionUnsupportedError} because the *version* was
 * supported in principle; it's the *contents* that broke.
 */
export class BindingsMigrationError extends Error {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly cause: unknown;

  constructor(fromVersion: number, toVersion: number, message: string, cause?: unknown) {
    super(message);
    this.name = 'BindingsMigrationError';
    this.fromVersion = fromVersion;
    this.toVersion = toVersion;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Migration handler shape
// ---------------------------------------------------------------------------

/**
 * One step in the migration chain. Always advances the version by
 * exactly one (`to === from + 1`) so the chain is strictly linear and
 * the registry order is `from`-ascending. Each step receives a *parsed*
 * JSON object (not a string) and returns a parsed object whose shape
 * matches version `to` of the schema.
 *
 * Migrations:
 *   • MUST be pure functions of their input — no global reads, no
 *     wall-clock, no RNG. The whole determinism contract for replays
 *     depends on a v0 blob producing the same v1 bytes regardless of
 *     when or where the migration runs.
 *   • MUST tolerate missing-but-defaultable fields (the whole reason a
 *     migration exists) but should throw {@link BindingsMigrationError}
 *     on inputs that cannot possibly be valid for the source version
 *     (e.g. a v0 blob missing all four player slots).
 *   • SHOULD prefer "additive" reshapes (add a default field) over
 *     destructive ones (drop a field). The schema versioning contract
 *     is forward-compatible upgrades, not lossy down-converts.
 */
export interface BindingsMigration {
  /** The source schema version this handler reads. */
  readonly from: number;
  /** The destination schema version — always `from + 1`. */
  readonly to: number;
  /**
   * Human-readable summary surfaced by
   * {@link describeBindingsVersionStatus} when the UI shows a "this
   * file will be upgraded" notice. Stable, never user-visible localised.
   */
  readonly description: string;
  /**
   * Pure transform from a version-`from` payload to a version-`to`
   * payload. Returned object MUST set `schemaVersion: to`. May return a
   * new object or mutate-and-return — the caller treats the result as
   * owned by the migration step (the loader does not freeze it; the
   * downstream parser produces the frozen result).
   */
  migrate(payload: Record<string, unknown>): Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Registered migrations
// ---------------------------------------------------------------------------

/**
 * v0 → v1 migration. Version 0 was an early dev-build format that
 * predated the canonical envelope and used a flat `Record<slot,
 * PlayerBindings>` blob without a `kind` discriminator or the explicit
 * `schemaVersion` integer. The v1 reader requires the envelope shape;
 * the migration wraps the v0 body inside a `bindingsSnapshot` envelope
 * so a v0 blob loads under today's schema without losing its slot
 * customisations. Single-slot v0 blobs (rebinding-UI exports) are
 * wrapped as `playerBindings` envelopes.
 *
 * Every other field is identical between v0 and v1 — the per-slot
 * `playerIndex`, the action map, and the per-binding shapes are
 * unchanged — so the migration is an envelope-only patch. The strict
 * validator catches genuinely-malformed v0 blobs (missing slots, bad
 * keyCodes) on the post-migration validation pass.
 */
const migrateV0ToV1: BindingsMigration = Object.freeze({
  from: 0,
  to: 1,
  description: 'v0 → v1: wrap legacy flat body inside the schemaVersion/kind envelope',
  migrate(payload: Record<string, unknown>): Record<string, unknown> {
    if (payload['schemaVersion'] !== 0) {
      throw new BindingsMigrationError(
        0,
        1,
        `migrateV0ToV1: expected schemaVersion 0, got ${JSON.stringify(payload['schemaVersion'])}`,
      );
    }
    // v0 stored either:
    //   • a flat snapshot:   { schemaVersion: 0, slots: { '1': {...}, '2': {...}, ... } }
    //   • a flat per-player: { schemaVersion: 0, slot: 1, bindings: {...}, playerIndex: 1 }
    // The migration detects which by presence of `slots` (snapshot) vs
    // `playerIndex` (single-player). Either way the body is repackaged
    // under the canonical { schemaVersion, kind, data } envelope.
    if (payload['slots'] !== undefined) {
      const slots = payload['slots'];
      if (
        slots === null ||
        typeof slots !== 'object' ||
        Array.isArray(slots)
      ) {
        throw new BindingsMigrationError(
          0,
          1,
          `migrateV0ToV1: payload.slots must be an object, got ${describeJsonType(slots)}`,
        );
      }
      return {
        schemaVersion: 1,
        kind: 'bindingsSnapshot',
        data: slots,
      };
    }
    if (payload['playerIndex'] !== undefined && payload['bindings'] !== undefined) {
      return {
        schemaVersion: 1,
        kind: 'playerBindings',
        data: {
          playerIndex: payload['playerIndex'],
          bindings: payload['bindings'],
        },
      };
    }
    throw new BindingsMigrationError(
      0,
      1,
      `migrateV0ToV1: payload has neither 'slots' (snapshot) nor 'playerIndex'+'bindings' (single-player); ` +
        `cannot determine v0 shape`,
    );
  },
});

/**
 * The full ordered chain of registered one-step migrations. Strictly
 * `from`-ascending, with `to[i] === from[i+1]` so the migrator can walk
 * the array linearly. Frozen so a misbehaving caller cannot inject a
 * side-effect by mutating the registry.
 *
 * Add new migrations here in version order. The framework asserts that
 * the chain is well-formed at module load (see
 * {@link assertMigrationChainWellFormed} below) so a typo'd `from`/`to`
 * pair fails fast with a clear stack trace rather than silently
 * mis-loading settings blobs.
 */
export const BINDINGS_MIGRATIONS: ReadonlyArray<BindingsMigration> = Object.freeze([
  migrateV0ToV1,
]);

// Self-check at module load. The chain is small enough today that this
// runs in microseconds; the assertion guards against a future developer
// registering an out-of-order or non-contiguous migration.
assertMigrationChainWellFormed(BINDINGS_MIGRATIONS);

// ---------------------------------------------------------------------------
// Public API — version detection
// ---------------------------------------------------------------------------

/**
 * Result returned by {@link detectBindingsPayloadVersion}. The
 * discriminated `ok` flag forces consumers to handle the failure case
 * — a corrupted JSON blob cannot silently propagate as `undefined`.
 */
export type BindingsVersionDetection =
  | { readonly ok: true; readonly version: number; readonly raw: Record<string, unknown> }
  | { readonly ok: false; readonly reason: BindingsVersionUnsupportedKind; readonly error: string };

/**
 * Parse a JSON string and report its declared `schemaVersion`. Used by:
 *
 *   • {@link migrateBindingsPayload} as its first step.
 *   • The settings UI's "Inspect import" affordance — tells the user
 *     "this file is v0; we will upgrade it on import" before any
 *     mutation happens.
 *   • Tests, to assert that a fixture's declared version matches what
 *     the writer was supposed to emit.
 *
 * Returns a discriminated result so callers don't have to wrap the call
 * in `try` / `catch`. The `error` string names the specific failure
 * (not-JSON, not-an-object, missing field, non-integer field) for log
 * surfaces; the `reason` discriminator is what the UI branches on.
 */
export function detectBindingsPayloadVersion(json: string): BindingsVersionDetection {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      ok: false,
      reason: 'notAnInteger',
      error: `BindingsMigrations: input is not valid JSON (${(err as Error).message}).`,
    };
  }
  return detectVersionOnParsedPayload(parsed);
}

/**
 * Companion to {@link detectBindingsPayloadVersion} for callers that
 * already have the parsed object in hand (e.g. the migration walker
 * itself, or a test fixture that wants to skip the JSON round-trip).
 */
export function detectVersionOnParsedPayload(parsed: unknown): BindingsVersionDetection {
  if (parsed === null || parsed === undefined || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      reason: 'notAnInteger',
      error: `BindingsMigrations: payload must be a JSON object, got ${describeJsonType(parsed)}.`,
    };
  }
  const obj = parsed as Record<string, unknown>;
  const v = obj['schemaVersion'];
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) {
    return {
      ok: false,
      reason: 'notAnInteger',
      error: `BindingsMigrations: schemaVersion must be a finite integer, got ${JSON.stringify(v)}.`,
    };
  }
  return { ok: true, version: v, raw: obj };
}

// ---------------------------------------------------------------------------
// Public API — compatibility checks
// ---------------------------------------------------------------------------

/**
 * Returns `true` iff a payload claiming `schemaVersion === v` can be
 * loaded by this build (either natively, when `v ===
 * CURRENT_BINDINGS_SCHEMA_VERSION`, or via a registered migration
 * chain).
 *
 * Pure check — does not parse or validate the payload itself; the
 * deserializer re-runs strict validation after migration. Cheap enough
 * to call from the settings UI's "Import" button to enable / disable
 * the action with a tooltip explaining why an old / future version
 * can't be loaded.
 */
export function isCompatibleBindingsVersion(v: unknown): boolean {
  return (
    typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= MIN_MIGRATABLE_BINDINGS_VERSION &&
    v <= CURRENT_BINDINGS_SCHEMA_VERSION
  );
}

/**
 * Status returned by {@link describeBindingsVersionStatus}. Lets the UI
 * branch on a discriminator instead of sniffing message strings.
 */
export type BindingsVersionStatus =
  | { readonly kind: 'current'; readonly version: number }
  | {
      readonly kind: 'migratable';
      readonly version: number;
      readonly steps: ReadonlyArray<BindingsMigration>;
    }
  | {
      readonly kind: 'unsupported';
      readonly version: unknown;
      readonly reason: BindingsVersionUnsupportedKind;
      readonly currentVersion: number;
      readonly minVersion: number;
    };

/**
 * Classifies an arbitrary `version` value. The settings UI uses this to
 * decide "load directly" vs "load with upgrade notice" vs "show
 * incompatible badge" without trying to parse the file first.
 */
export function describeBindingsVersionStatus(version: unknown): BindingsVersionStatus {
  if (
    typeof version !== 'number' ||
    !Number.isFinite(version) ||
    !Number.isInteger(version)
  ) {
    return Object.freeze({
      kind: 'unsupported' as const,
      version,
      reason: 'notAnInteger' as const,
      currentVersion: CURRENT_BINDINGS_SCHEMA_VERSION,
      minVersion: MIN_MIGRATABLE_BINDINGS_VERSION,
    });
  }
  if (version === CURRENT_BINDINGS_SCHEMA_VERSION) {
    return Object.freeze({ kind: 'current' as const, version });
  }
  if (version > CURRENT_BINDINGS_SCHEMA_VERSION) {
    return Object.freeze({
      kind: 'unsupported' as const,
      version,
      reason: 'tooNew' as const,
      currentVersion: CURRENT_BINDINGS_SCHEMA_VERSION,
      minVersion: MIN_MIGRATABLE_BINDINGS_VERSION,
    });
  }
  if (version < MIN_MIGRATABLE_BINDINGS_VERSION) {
    return Object.freeze({
      kind: 'unsupported' as const,
      version,
      reason: 'tooOld' as const,
      currentVersion: CURRENT_BINDINGS_SCHEMA_VERSION,
      minVersion: MIN_MIGRATABLE_BINDINGS_VERSION,
    });
  }
  // version is in [MIN, CURRENT) — chain the steps that take us up.
  const steps = BINDINGS_MIGRATIONS.filter(
    (m) => m.from >= version && m.from < CURRENT_BINDINGS_SCHEMA_VERSION,
  );
  return Object.freeze({
    kind: 'migratable' as const,
    version,
    steps: Object.freeze(steps),
  });
}

// ---------------------------------------------------------------------------
// Public API — migration
// ---------------------------------------------------------------------------

/**
 * Walks `payload` through the registered migration chain until its
 * `schemaVersion` matches {@link CURRENT_BINDINGS_SCHEMA_VERSION},
 * returning the upgraded payload as a string ready for the strict
 * deserializer. Throws:
 *
 *   • {@link BindingsVersionUnsupportedError} if the version is
 *     missing, non-integer, below {@link MIN_MIGRATABLE_BINDINGS_VERSION},
 *     or above {@link CURRENT_BINDINGS_SCHEMA_VERSION}. The error's
 *     `kind` field distinguishes the three cases.
 *   • {@link BindingsMigrationError} if a registered step throws while
 *     processing the payload (the underlying error is exposed on
 *     `cause`).
 *
 * Does NOT validate the resulting payload's per-field shape — the
 * downstream parser (`deserializePlayerBindings` /
 * `deserializeBindingsSnapshot`) does that, intentionally. This
 * separation keeps the migration framework concerned only with version
 * reconciliation; per-field validation lives in one place.
 */
export function migrateBindingsPayload(rawPayload: unknown): Record<string, unknown> {
  const detection = detectVersionOnParsedPayload(rawPayload);
  if (!detection.ok) {
    throw new BindingsVersionUnsupportedError(
      detection.reason,
      // best-effort: expose the offending value for log surfaces.
      typeof rawPayload === 'object' && rawPayload !== null
        ? (rawPayload as Record<string, unknown>)['schemaVersion']
        : undefined,
      detection.error,
    );
  }
  const status = describeBindingsVersionStatus(detection.version);
  if (status.kind === 'unsupported') {
    throw buildVersionUnsupportedError(status);
  }
  if (status.kind === 'current') {
    return detection.raw;
  }
  // Walk the migration steps in order. The
  // `describeBindingsVersionStatus` result already filtered to the
  // steps we need; double-check consecutive `from`/`to` advancement so
  // a future bug in the registry surfaces here rather than producing a
  // half-migrated payload.
  let current: Record<string, unknown> = detection.raw;
  let expectedFrom = detection.version;
  for (const step of status.steps) {
    if (step.from !== expectedFrom) {
      throw new BindingsMigrationError(
        step.from,
        step.to,
        `migrateBindingsPayload: registered migration chain is broken — ` +
          `expected step from version ${expectedFrom}, got step from ${step.from}`,
      );
    }
    let next: Record<string, unknown>;
    try {
      next = step.migrate(current);
    } catch (err) {
      if (err instanceof BindingsMigrationError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new BindingsMigrationError(
        step.from,
        step.to,
        `migrateBindingsPayload: migration ${step.from} → ${step.to} threw: ${msg}`,
        err,
      );
    }
    if (next['schemaVersion'] !== step.to) {
      throw new BindingsMigrationError(
        step.from,
        step.to,
        `migrateBindingsPayload: migration ${step.from} → ${step.to} did not ` +
          `set schemaVersion to ${step.to}, got ${JSON.stringify(next['schemaVersion'])}`,
      );
    }
    current = next;
    expectedFrom = step.to;
  }
  if (expectedFrom !== CURRENT_BINDINGS_SCHEMA_VERSION) {
    throw new BindingsMigrationError(
      detection.version,
      CURRENT_BINDINGS_SCHEMA_VERSION,
      `migrateBindingsPayload: migration chain stopped at version ` +
        `${expectedFrom}, expected ${CURRENT_BINDINGS_SCHEMA_VERSION}`,
    );
  }
  return current;
}

/**
 * Result type for {@link safeMigrateBindingsJson}. The discriminator
 * forces consumers to handle the `false` branch — a corrupted blob
 * cannot silently propagate as `undefined`.
 *
 * The `reason` field (when `ok: false`) carries the same vocabulary as
 * {@link BindingsVersionUnsupportedKind} extended with `'migrationFailed'`
 * for content errors a chain step raised. The settings boot path branches
 * on this when deciding whether to evict the bad blob (`migrationFailed`
 * usually means "we should keep the file in place for the user to
 * inspect", while `tooOld` means "this is dead data, safe to clear on
 * next save").
 */
export type SafeMigrationResult =
  | { readonly ok: true; readonly raw: Record<string, unknown>; readonly migratedFrom?: number }
  | {
      readonly ok: false;
      readonly reason: BindingsVersionUnsupportedKind | 'migrationFailed';
      readonly error: string;
    };

/**
 * Non-throwing wrapper around {@link migrateBindingsPayload} that takes
 * a JSON string (the wire format the storage layer holds). Used by the
 * load path where a malformed or out-of-range blob must fall back to
 * defaults rather than crash the boot sequence.
 *
 *   • `ok: true, raw` — payload is up-to-date or successfully migrated.
 *     `migratedFrom` is the original version (omitted when the blob was
 *     already current).
 *   • `ok: false, reason: 'tooOld'` — version below
 *     {@link MIN_MIGRATABLE_BINDINGS_VERSION}.
 *   • `ok: false, reason: 'tooNew'` — version above the current build's
 *     schema; consumer should advise the user to upgrade.
 *   • `ok: false, reason: 'notAnInteger'` — input is not parseable JSON
 *     or the `schemaVersion` field is missing / non-integer.
 *   • `ok: false, reason: 'migrationFailed'` — a registered step threw
 *     on this specific payload (data was structurally invalid for the
 *     source version).
 */
export function safeMigrateBindingsJson(json: string): SafeMigrationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      ok: false,
      reason: 'notAnInteger',
      error: `BindingsMigrations: input is not valid JSON (${(err as Error).message}).`,
    };
  }
  return safeMigrateParsedBindings(parsed);
}

/**
 * Companion to {@link safeMigrateBindingsJson} for callers that already
 * have a parsed object (no point re-stringifying just to re-parse).
 */
export function safeMigrateParsedBindings(parsed: unknown): SafeMigrationResult {
  const detection = detectVersionOnParsedPayload(parsed);
  if (!detection.ok) {
    return { ok: false, reason: detection.reason, error: detection.error };
  }
  const originalVersion = detection.version;
  try {
    const migrated = migrateBindingsPayload(parsed);
    if (originalVersion === CURRENT_BINDINGS_SCHEMA_VERSION) {
      return { ok: true, raw: migrated };
    }
    return { ok: true, raw: migrated, migratedFrom: originalVersion };
  } catch (err) {
    if (err instanceof BindingsVersionUnsupportedError) {
      return { ok: false, reason: err.kind, error: err.message };
    }
    if (err instanceof BindingsMigrationError) {
      return { ok: false, reason: 'migrationFailed', error: err.message };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'migrationFailed', error: msg };
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildVersionUnsupportedError(
  status: Extract<BindingsVersionStatus, { kind: 'unsupported' }>,
): BindingsVersionUnsupportedError {
  switch (status.reason) {
    case 'notAnInteger':
      return new BindingsVersionUnsupportedError(
        'notAnInteger',
        status.version,
        `Bindings file schemaVersion is not a finite integer — got ` +
          `${JSON.stringify(status.version)}`,
      );
    case 'tooNew':
      return new BindingsVersionUnsupportedError(
        'tooNew',
        status.version,
        `Bindings file is from a newer build of the game (schemaVersion ` +
          `${String(status.version)}); this build reads schemaVersion ` +
          `${CURRENT_BINDINGS_SCHEMA_VERSION}`,
      );
    case 'tooOld':
      return new BindingsVersionUnsupportedError(
        'tooOld',
        status.version,
        `Bindings file is from a build older than this loader can ` +
          `migrate (schemaVersion ${String(status.version)}); the oldest ` +
          `supported version is ${MIN_MIGRATABLE_BINDINGS_VERSION}`,
      );
  }
}

function assertMigrationChainWellFormed(
  chain: ReadonlyArray<BindingsMigration>,
): void {
  if (chain.length === 0) {
    // Empty chain is fine — happens when CURRENT === MIN.
    if (CURRENT_BINDINGS_SCHEMA_VERSION !== MIN_MIGRATABLE_BINDINGS_VERSION) {
      throw new Error(
        `BindingsMigrations: empty migration chain but ` +
          `MIN_MIGRATABLE_BINDINGS_VERSION (${MIN_MIGRATABLE_BINDINGS_VERSION}) ` +
          `does not equal CURRENT_BINDINGS_SCHEMA_VERSION (${CURRENT_BINDINGS_SCHEMA_VERSION})`,
      );
    }
    return;
  }
  if (chain[0]!.from !== MIN_MIGRATABLE_BINDINGS_VERSION) {
    throw new Error(
      `BindingsMigrations: first migration starts at version ${chain[0]!.from}, ` +
        `expected MIN_MIGRATABLE_BINDINGS_VERSION (${MIN_MIGRATABLE_BINDINGS_VERSION})`,
    );
  }
  for (let i = 0; i < chain.length; i += 1) {
    const step = chain[i]!;
    if (step.to !== step.from + 1) {
      throw new Error(
        `BindingsMigrations: migration[${i}] step is not single-version ` +
          `(from=${step.from}, to=${step.to}) — every step must advance by 1`,
      );
    }
    if (i > 0 && chain[i - 1]!.to !== step.from) {
      throw new Error(
        `BindingsMigrations: migration chain has a gap between ` +
          `migration[${i - 1}] (to=${chain[i - 1]!.to}) and ` +
          `migration[${i}] (from=${step.from})`,
      );
    }
  }
  const last = chain[chain.length - 1]!;
  if (last.to !== CURRENT_BINDINGS_SCHEMA_VERSION) {
    throw new Error(
      `BindingsMigrations: last migration ends at version ${last.to}, ` +
        `expected CURRENT_BINDINGS_SCHEMA_VERSION (${CURRENT_BINDINGS_SCHEMA_VERSION})`,
    );
  }
}

function describeJsonType(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// ---------------------------------------------------------------------------
// Public API — migration-aware deserialisation (load path integration)
// ---------------------------------------------------------------------------

/**
 * Result returned by the migration-aware deserialisers. Extends the
 * plain {@link DeserializeResult} with a `migratedFrom` field so the
 * settings UI can surface "we just upgraded your save from v0 → v1"
 * after a successful load. Absence of `migratedFrom` means the blob was
 * already at the current schema version.
 */
export type MigrationAwareDeserializeResult<T> =
  | { readonly ok: true; readonly value: T; readonly migratedFrom?: number }
  | {
      readonly ok: false;
      readonly reason: BindingsVersionUnsupportedKind | 'migrationFailed' | 'invalidContent';
      readonly error: string;
    };

/**
 * Migration-aware variant of `deserializePlayerBindings`. Walks the
 * payload through the migration chain first, then delegates to the
 * strict deserializer for per-field validation. This is the function
 * the settings boot path and rebinding-UI "Import" action call — it
 * makes a v0 export load identically to a v1 export from the player's
 * perspective, while still catching genuinely-malformed blobs.
 *
 * Failure semantics:
 *
 *   • `tooOld` / `tooNew` — version is outside the supported window.
 *     The settings UI should show a "this file is from a different
 *     build" message rather than silently overwriting the save.
 *   • `notAnInteger` — the file's `schemaVersion` is missing or junk;
 *     the file is not a recognisable bindings save.
 *   • `migrationFailed` — a registered step threw; the data was
 *     structurally invalid for its declared source version.
 *   • `invalidContent` — migration succeeded but the strict validator
 *     rejected the upgraded payload (e.g. the v0 blob declared the
 *     right shape but had a `keyCode: -1` that the v1 validator won't
 *     accept). The blob is corrupt; defaults are the only safe fallback.
 */
export function migrationAwareDeserializePlayerBindings(
  json: string,
  expectedSlot?: PlayerBindingsIndex,
): MigrationAwareDeserializeResult<PlayerBindings> {
  const migration = safeMigrateBindingsJson(json);
  if (!migration.ok) {
    return { ok: false, reason: migration.reason, error: migration.error };
  }
  // Re-stringify the migrated payload and pipe through the strict
  // deserializer. Re-stringifying is intentional: the strict path
  // expects a JSON string, and going back through `JSON.stringify` lets
  // us reuse its battle-tested envelope checks without duplicating
  // them in this module.
  let upgradedJson: string;
  try {
    upgradedJson = JSON.stringify(migration.raw);
  } catch (err) {
    return {
      ok: false,
      reason: 'migrationFailed',
      error: `migrationAwareDeserializePlayerBindings: post-migration payload could not be re-stringified — ${(err as Error).message}`,
    };
  }
  try {
    const value = deserializePlayerBindings(upgradedJson, expectedSlot);
    return migration.migratedFrom !== undefined
      ? { ok: true, value, migratedFrom: migration.migratedFrom }
      : { ok: true, value };
  } catch (err) {
    return {
      ok: false,
      reason: 'invalidContent',
      error: (err as Error).message,
    };
  }
}

/**
 * Migration-aware variant of `deserializeBindingsSnapshot`. Same
 * contract as {@link migrationAwareDeserializePlayerBindings}, but for
 * the four-slot snapshot envelope used by the global settings layer.
 * This is the function {@link BindingsStorage.loadBindingsSnapshot}
 * delegates to so a v0 snapshot loaded from `localStorage` is upgraded
 * before per-slot validation runs.
 */
export function migrationAwareDeserializeBindingsSnapshot(
  json: string,
): MigrationAwareDeserializeResult<Record<PlayerBindingsIndex, PlayerBindings>> {
  const migration = safeMigrateBindingsJson(json);
  if (!migration.ok) {
    return { ok: false, reason: migration.reason, error: migration.error };
  }
  let upgradedJson: string;
  try {
    upgradedJson = JSON.stringify(migration.raw);
  } catch (err) {
    return {
      ok: false,
      reason: 'migrationFailed',
      error: `migrationAwareDeserializeBindingsSnapshot: post-migration payload could not be re-stringified — ${(err as Error).message}`,
    };
  }
  try {
    const value = deserializeBindingsSnapshot(upgradedJson);
    return migration.migratedFrom !== undefined
      ? { ok: true, value, migratedFrom: migration.migratedFrom }
      : { ok: true, value };
  } catch (err) {
    return {
      ok: false,
      reason: 'invalidContent',
      error: (err as Error).message,
    };
  }
}

/**
 * Convenience wrapper that funnels every load failure into the same
 * fall-back path: returns the supplied `defaults` (a frozen
 * {@link DEFAULT_PLAYER_BINDINGS}-shaped record) when migration or
 * validation fails for any reason. Used by
 * {@link BindingsStorage.loadBindingsSnapshotOrDefaults} so the boot
 * sequence never has to branch on the failure code — it just gets a
 * usable bindings table back, with `source` describing what happened.
 *
 * The `source` field exposes the four observable outcomes:
 *
 *   • `'storage'`         — blob already at current schema; loaded as-is.
 *   • `'migrated'`        — blob was at an older schema; migrated then
 *                           loaded. `migratedFrom` carries the original
 *                           version so the UI can show "upgraded from v0".
 *   • `'defaults'`        — no blob present, or a fall-back path fired.
 *                           `fallbackReason` / `fallbackError` describe
 *                           why so the UI can offer "Restore from
 *                           corrupted save" affordances when sensible.
 */
export function loadBindingsWithMigrationOrDefaults(
  json: string | null,
  defaults: Record<PlayerBindingsIndex, PlayerBindings>,
): {
  readonly bindings: Record<PlayerBindingsIndex, PlayerBindings>;
  readonly source: 'storage' | 'migrated' | 'defaults';
  readonly migratedFrom?: number;
  readonly fallbackReason?:
    | BindingsVersionUnsupportedKind
    | 'migrationFailed'
    | 'invalidContent'
    | 'missing';
  readonly fallbackError?: string;
} {
  if (json === null) {
    return {
      bindings: defaults,
      source: 'defaults',
      fallbackReason: 'missing',
      fallbackError: 'No bindings blob to load.',
    };
  }
  const result = migrationAwareDeserializeBindingsSnapshot(json);
  if (result.ok) {
    if (result.migratedFrom !== undefined) {
      return {
        bindings: result.value,
        source: 'migrated',
        migratedFrom: result.migratedFrom,
      };
    }
    return { bindings: result.value, source: 'storage' };
  }
  return {
    bindings: defaults,
    source: 'defaults',
    fallbackReason: result.reason,
    fallbackError: result.error,
  };
}

// Re-export the strict result alias so consumers that only `import` from
// this module still have access to the canonical result shape used by
// the migration-aware variants.
export type { DeserializeResult };
