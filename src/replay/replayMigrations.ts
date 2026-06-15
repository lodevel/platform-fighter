/**
 * Replay schema versioning + migration handlers — AC 30103 Sub-AC 3.
 *
 * What this module is
 * ===================
 *
 * The forward-compatibility layer for the M4 hybrid replay system. The
 * replay file format carries a monotonically-increasing
 * {@link REPLAY_FORMAT_VERSION} integer; this module owns the rules for
 * how that integer is interpreted at load time:
 *
 *   • What range of versions can be loaded at all
 *     ({@link MIN_MIGRATABLE_REPLAY_VERSION} ↔ {@link CURRENT_REPLAY_FORMAT_VERSION}).
 *   • The chain of one-step migration handlers that walk an older payload
 *     up to the current schema (each step transforms version `N`'s on-disk
 *     shape into version `N+1`'s).
 *   • The compatibility-check helpers callers use *before* attempting a
 *     load — `isCompatibleReplayVersion`, `describeReplayVersionStatus`,
 *     and the dedicated error types thrown when a file is too old to
 *     migrate or too new for this build.
 *
 * Why this lives in its own module
 * --------------------------------
 *
 *   • The Seed's "code architecture" evaluation principle calls for
 *     clean separation of concerns. Versioning policy is a contract; the
 *     parser ({@link ./ReplayFile}) is a consumer of that contract.
 *   • Future format work (adding fields, reshaping the timeline, switching
 *     to a binary encoding) lands here as a new
 *     {@link ReplayMigration} entry without bloating the parser.
 *   • Headless tooling (the M4 replay browser preview, automated
 *     regression harnesses, the snapshot-resync layer landing in a later
 *     sub-AC) can `import type` the migration types and `import` the
 *     compatibility check without pulling in the validator code.
 *
 * Where it sits in the load pipeline
 * ----------------------------------
 *
 *   raw JSON ──► JSON.parse ──► { ...obj, version: N } ──┐
 *                                                        │
 *                                                        ▼
 *                                       ┌────────────────────────────┐
 *                                       │  migrateReplayPayload(...) │  ◄── this module
 *                                       └────────────────────────────┘
 *                                                        │
 *                                                        ▼
 *                                       ┌────────────────────────────┐
 *                                       │  deserializeReplay(parsed) │  (./ReplayFile)
 *                                       └────────────────────────────┘
 *                                                        │
 *                                                        ▼
 *                                                 frozen ReplayFile
 *
 * The migration step runs *before* the strict per-field parser so that
 * older payloads are reshaped into the current schema first, and then
 * validated by the same validator the live writer's output goes through.
 * This means we never carry per-version branches in the parser — the
 * parser only ever sees today's schema.
 *
 * Determinism
 * -----------
 *
 * Migrations are pure functions of their input payload. They never read
 * `Date.now()`, `Math.random()`, or any global state — every default
 * value baked in is a literal constant. This means a v0 replay run
 * through `migrateReplayPayload` yields the same v1 payload regardless
 * of when or where the migration runs, which the determinism contract
 * for replay playback requires.
 *
 * Example registered migration: v0 → v1
 * -------------------------------------
 *
 * Version 0 was an early dev-build format that lacked the diagnostic
 * `metadata.engineVersion` and `metadata.notes` fields the v1 reader
 * requires. The v0 → v1 migration adds them with deterministic defaults
 * (`'0.0.0-pre-release'` and `''` respectively) so a v0 file loads under
 * today's schema without losing its match data.
 *
 * Today's writer always emits {@link CURRENT_REPLAY_FORMAT_VERSION} (= 1).
 * The v0 → v1 migration exists primarily to prove the migration framework
 * works end-to-end and to give the replay menu a path to load any v0
 * test fixtures that may still exist; future format bumps register
 * additional one-step migrations next to it.
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM imports — this module is unit-testable under
 * plain Node (vitest) and reusable from headless replay tooling.
 */

import {
  REPLAY_FORMAT_MAGIC,
  REPLAY_FORMAT_VERSION,
} from './replayTypes';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The schema version this build *writes* and natively *reads*. Re-export
 * of {@link REPLAY_FORMAT_VERSION} pinned to a stable name from this
 * module so consumers that only care about versioning policy don't have
 * to import from `./replayTypes` as well.
 *
 * Typed as `number` (not the literal `1`) so future bumps don't cascade
 * a wave of "literal type comparison" warnings into versioning logic
 * that intentionally treats the value as an open integer.
 */
export const CURRENT_REPLAY_FORMAT_VERSION: number = REPLAY_FORMAT_VERSION;

/**
 * The oldest schema version this build can migrate forward into the
 * current schema. Older files are rejected at load time with a
 * {@link ReplayVersionUnsupportedError} whose `kind === 'tooOld'` —
 * versions below this point either had no shipped readers or differ from
 * v1 in ways no migration can express.
 *
 * Today this is `0` because the registered v0 → v1 migration is enough
 * to walk every still-readable historical format up to the current one.
 * If a future build retires a migration step (e.g. binary v2 cannot be
 * back-derived from textual v0), bump this constant and surface a clear
 * error in the replay menu rather than silently losing data.
 *
 * Typed as `number` for the same reason as
 * {@link CURRENT_REPLAY_FORMAT_VERSION} — the policy is "the value of
 * this integer", not "this specific literal".
 */
export const MIN_MIGRATABLE_REPLAY_VERSION: number = 0;

/**
 * Convenience: the ordered list of intermediate versions that a payload
 * may pass through during migration to the current schema. Useful for
 * the replay menu to show "migrating v0 → v1 → v2…" progress when a
 * future chain grows long. Always strictly monotonic.
 */
export const MIGRATABLE_REPLAY_VERSIONS: ReadonlyArray<number> = Object.freeze(
  // [0, 1, …, current] — built once at module load.
  Array.from(
    { length: CURRENT_REPLAY_FORMAT_VERSION - MIN_MIGRATABLE_REPLAY_VERSION + 1 },
    (_, i) => MIN_MIGRATABLE_REPLAY_VERSION + i,
  ),
);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Discriminator on {@link ReplayVersionUnsupportedError} explaining
 * *why* the version is unsupported. Surfacing this lets the replay menu
 * show different copy:
 *
 *   • `tooOld` — "This replay was recorded by a much older build and
 *     can no longer be loaded."
 *   • `tooNew` — "This replay was recorded by a newer build of the game.
 *     Update to the latest version to load it."
 *   • `notAnInteger` — "This file's version field is corrupt."
 */
export type ReplayVersionUnsupportedKind = 'tooOld' | 'tooNew' | 'notAnInteger';

/**
 * Thrown by {@link migrateReplayPayload} when a payload's version cannot
 * be reconciled with the current schema:
 *
 *   • The version is below {@link MIN_MIGRATABLE_REPLAY_VERSION}
 *     (`kind === 'tooOld'`) — no registered migration can produce a v1
 *     payload from it.
 *   • The version is above {@link CURRENT_REPLAY_FORMAT_VERSION}
 *     (`kind === 'tooNew'`) — this build doesn't know what fields the
 *     payload carries; loading would risk silently dropping data.
 *   • The version is not a finite non-negative integer
 *     (`kind === 'notAnInteger'`) — the file is corrupt.
 *
 * Distinct subclass (extends `Error` directly rather than ReplayFileError
 * — which lives in `./ReplayFile` and would create a cyclic import)
 * so callers can `catch (e) { if (e instanceof ReplayVersionUnsupportedError)
 * showUpgradeToast() }` without sniffing message strings. The parser in
 * `./ReplayFile` re-throws this class unchanged so consumers see the
 * same error type either way.
 */
export class ReplayVersionUnsupportedError extends Error {
  readonly kind: ReplayVersionUnsupportedKind;
  readonly fileVersion: unknown;
  readonly currentVersion: number;
  readonly minVersion: number;

  constructor(
    kind: ReplayVersionUnsupportedKind,
    fileVersion: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ReplayVersionUnsupportedError';
    this.kind = kind;
    this.fileVersion = fileVersion;
    this.currentVersion = CURRENT_REPLAY_FORMAT_VERSION;
    this.minVersion = MIN_MIGRATABLE_REPLAY_VERSION;
  }
}

/**
 * Thrown when a registered migration handler itself fails on a specific
 * payload — e.g. a v0 file that's missing a field the v0 → v1 handler
 * expected to be present. Distinct from
 * {@link ReplayVersionUnsupportedError} because the *version* was
 * supported in principle; it's the *contents* that broke.
 */
export class ReplayMigrationError extends Error {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly cause: unknown;

  constructor(fromVersion: number, toVersion: number, message: string, cause?: unknown) {
    super(message);
    this.name = 'ReplayMigrationError';
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
 *     depends on a v0 file producing the same v1 bytes regardless of
 *     when or where the migration runs.
 *   • MUST tolerate missing-but-defaultable fields (the whole reason
 *     a migration exists) but should throw {@link ReplayMigrationError}
 *     on inputs that cannot possibly be valid for the source version
 *     (e.g. a v0 file missing its input timeline).
 *   • SHOULD prefer "additive" reshapes (add a default field) over
 *     destructive ones (drop a field). The schema versioning contract
 *     is forward-compatible upgrades, not lossy down-converts.
 */
export interface ReplayMigration {
  /** The source schema version this handler reads. */
  readonly from: number;
  /** The destination schema version — always `from + 1`. */
  readonly to: number;
  /**
   * Human-readable summary surfaced by
   * {@link describeReplayVersionStatus} when the menu shows a "this
   * file will be upgraded" notice. Stable, never user-visible localised.
   */
  readonly description: string;
  /**
   * Pure transform from a version-`from` payload to a version-`to`
   * payload. Returned object MUST set `version: to`. May return a new
   * object or mutate-and-return — the caller treats the result as
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
 * predated the diagnostic `metadata.engineVersion` and `metadata.notes`
 * fields. The v1 reader requires both to be present (see
 * `./ReplayFile.parseMetadata`); the migration adds them with the same
 * fallback values the v1 writer applies when its caller doesn't supply
 * them. Every other field is identical between v0 and v1 — the format
 * magic, RNG seed, match config, and input timeline shape are unchanged
 * — so the migration is a metadata-only patch.
 */
const migrateV0ToV1: ReplayMigration = Object.freeze({
  from: 0,
  to: 1,
  description: 'v0 → v1: backfill metadata.engineVersion + metadata.notes',
  migrate(payload: Record<string, unknown>): Record<string, unknown> {
    if (payload['version'] !== 0) {
      throw new ReplayMigrationError(
        0,
        1,
        `migrateV0ToV1: expected version 0, got ${JSON.stringify(payload['version'])}`,
      );
    }
    const metadataIn = payload['metadata'];
    if (
      metadataIn === null ||
      metadataIn === undefined ||
      typeof metadataIn !== 'object' ||
      Array.isArray(metadataIn)
    ) {
      throw new ReplayMigrationError(
        0,
        1,
        `migrateV0ToV1: payload.metadata must be an object, got ${describeJsonType(
          metadataIn,
        )}`,
      );
    }
    const md = metadataIn as Record<string, unknown>;
    const next: Record<string, unknown> = { ...payload };
    next['version'] = 1;
    next['metadata'] = {
      ...md,
      engineVersion:
        typeof md['engineVersion'] === 'string'
          ? md['engineVersion']
          : '0.0.0-pre-release',
      notes: typeof md['notes'] === 'string' ? md['notes'] : '',
    };
    return next;
  },
});

/**
 * v1 → v2 migration. Version 1 was the first shipped replay format and
 * pre-dated the T3 items framework (AC 17). The v2 reader requires an
 * `itemSpawnEvents` top-level array (see
 * `./ReplayFile.parseItemSpawnEvents`); the migration backfills it with
 * an empty array, which is the canonical default for any v1 match —
 * v1 replays were authored before items could even spawn, so the
 * empty list is byte-correct, not just safe.
 *
 * Determinism note: the migration is a pure additive patch — every
 * other field round-trips unchanged — so a v1 replay that used to play
 * back deterministically on the v1 reader now plays back identically
 * through the v2 reader (no item spawns to reproduce, no input
 * timeline changes).
 */
const migrateV1ToV2: ReplayMigration = Object.freeze({
  from: 1,
  to: 2,
  description: 'v1 → v2: backfill itemSpawnEvents (empty for pre-items matches)',
  migrate(payload: Record<string, unknown>): Record<string, unknown> {
    if (payload['version'] !== 1) {
      throw new ReplayMigrationError(
        1,
        2,
        `migrateV1ToV2: expected version 1, got ${JSON.stringify(payload['version'])}`,
      );
    }
    const next: Record<string, unknown> = { ...payload };
    next['version'] = 2;
    // Hand-authored v1 fixtures occasionally already carry an
    // `itemSpawnEvents: []` (the field name is forward-compat); preserve
    // it if present and well-shaped, otherwise default to []. Anything
    // non-empty in a v1 payload is treated as caller intent and passed
    // through to the v2 parser, which validates each entry.
    const existing = payload['itemSpawnEvents'];
    next['itemSpawnEvents'] = Array.isArray(existing) ? existing : [];
    return next;
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
 * mis-loading replay files.
 */
/**
 * v2 → v3 migration. Version 3 adds the vertical stick channel
 * (`moveY`) to every recorded input — the Smash-feel pack's fast-fall
 * (and the up/down item-throw direction) read it, so the capture
 * pipeline must carry it for live-vs-replay parity. v2 replays were
 * recorded before any consumer of the channel existed, so backfilling
 * `moveY: 0` is byte-correct: playback reproduces exactly the
 * no-vertical-input behaviour those matches actually had.
 */
const migrateV2ToV3: ReplayMigration = Object.freeze({
  from: 2,
  to: 3,
  description: 'v2 → v3: backfill inputTimeline moveY (0 for pre-fast-fall matches)',
  migrate(payload: Record<string, unknown>): Record<string, unknown> {
    if (payload['version'] !== 2) {
      throw new ReplayMigrationError(
        2,
        3,
        `migrateV2ToV3: expected version 2, got ${JSON.stringify(payload['version'])}`,
      );
    }
    const next: Record<string, unknown> = { ...payload };
    next['version'] = 3;
    const timeline = payload['inputTimeline'];
    if (timeline !== null && typeof timeline === 'object') {
      const t = timeline as Record<string, unknown>;
      const entries = t['entries'];
      if (Array.isArray(entries)) {
        next['inputTimeline'] = {
          ...t,
          entries: entries.map((entry) => {
            if (entry === null || typeof entry !== 'object') return entry;
            const e = entry as Record<string, unknown>;
            const inputs = e['inputs'];
            if (!Array.isArray(inputs)) return entry;
            return {
              ...e,
              inputs: inputs.map((input) => {
                if (input === null || typeof input !== 'object') return input;
                const i = input as Record<string, unknown>;
                // Preserve a forward-compat moveY a hand-authored
                // fixture may already carry; default 0 otherwise.
                return { moveY: 0, ...i };
              }),
            };
          }),
        };
      }
    }
    return next;
  },
});

export const REPLAY_MIGRATIONS: ReadonlyArray<ReplayMigration> = Object.freeze([
  migrateV0ToV1,
  migrateV1ToV2,
  migrateV2ToV3,
]);

// Self-check at module load. The chain is small enough today that this
// runs in microseconds; the assertion guards against a future
// developer registering an out-of-order or non-contiguous migration.
assertMigrationChainWellFormed(REPLAY_MIGRATIONS);

// ---------------------------------------------------------------------------
// Public API — compatibility checks
// ---------------------------------------------------------------------------

/**
 * Returns `true` iff a payload claiming `version === v` can be loaded
 * by this build (either natively, when `v === CURRENT_REPLAY_FORMAT_VERSION`,
 * or via a registered migration chain).
 *
 * Pure check — does not parse or validate the payload itself; the parser
 * re-runs strict validation after migration. Cheap enough to call from
 * the replay menu's "Open" button to enable / disable the action with a
 * tooltip explaining why an old / future version can't be loaded.
 */
export function isCompatibleReplayVersion(v: unknown): boolean {
  return (
    typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= MIN_MIGRATABLE_REPLAY_VERSION &&
    v <= CURRENT_REPLAY_FORMAT_VERSION
  );
}

/**
 * Status returned by {@link describeReplayVersionStatus}. Lets the UI
 * branch on a discriminator instead of sniffing message strings.
 */
export type ReplayVersionStatus =
  | { readonly kind: 'current'; readonly version: number }
  | {
      readonly kind: 'migratable';
      readonly version: number;
      readonly steps: ReadonlyArray<ReplayMigration>;
    }
  | {
      readonly kind: 'unsupported';
      readonly version: unknown;
      readonly reason: ReplayVersionUnsupportedKind;
      readonly currentVersion: number;
      readonly minVersion: number;
    };

/**
 * Classifies an arbitrary `version` value. The replay menu uses this to
 * decide "load directly" vs "load with upgrade notice" vs "show
 * incompatible badge" without trying to parse the file first.
 */
export function describeReplayVersionStatus(version: unknown): ReplayVersionStatus {
  if (
    typeof version !== 'number' ||
    !Number.isFinite(version) ||
    !Number.isInteger(version)
  ) {
    return Object.freeze({
      kind: 'unsupported' as const,
      version,
      reason: 'notAnInteger' as const,
      currentVersion: CURRENT_REPLAY_FORMAT_VERSION,
      minVersion: MIN_MIGRATABLE_REPLAY_VERSION,
    });
  }
  if (version === CURRENT_REPLAY_FORMAT_VERSION) {
    return Object.freeze({ kind: 'current' as const, version });
  }
  if (version > CURRENT_REPLAY_FORMAT_VERSION) {
    return Object.freeze({
      kind: 'unsupported' as const,
      version,
      reason: 'tooNew' as const,
      currentVersion: CURRENT_REPLAY_FORMAT_VERSION,
      minVersion: MIN_MIGRATABLE_REPLAY_VERSION,
    });
  }
  if (version < MIN_MIGRATABLE_REPLAY_VERSION) {
    return Object.freeze({
      kind: 'unsupported' as const,
      version,
      reason: 'tooOld' as const,
      currentVersion: CURRENT_REPLAY_FORMAT_VERSION,
      minVersion: MIN_MIGRATABLE_REPLAY_VERSION,
    });
  }
  // version is in [MIN, CURRENT) — chain the steps that take us up.
  const steps = REPLAY_MIGRATIONS.filter(
    (m) => m.from >= version && m.from < CURRENT_REPLAY_FORMAT_VERSION,
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
 * `version` matches {@link CURRENT_REPLAY_FORMAT_VERSION}, returning the
 * upgraded payload. Throws:
 *
 *   • {@link ReplayVersionUnsupportedError} if the version is missing,
 *     non-integer, below {@link MIN_MIGRATABLE_REPLAY_VERSION}, or above
 *     {@link CURRENT_REPLAY_FORMAT_VERSION}. The error's `kind` field
 *     distinguishes the three cases.
 *   • {@link ReplayMigrationError} if a registered step throws while
 *     processing the payload (the underlying error is exposed on
 *     `cause`).
 *
 * Does NOT validate the resulting payload's per-field shape — the
 * downstream parser (`deserializeReplay`) does that, intentionally.
 * This separation keeps the migration framework concerned only with
 * version reconciliation; per-field validation lives in one place.
 *
 * Format magic is checked here as a cheap sanity guard so callers that
 * forget to call `deserializeReplay` afterwards still get an error on
 * "this isn't a replay file" rather than running migrations against
 * arbitrary JSON.
 */
export function migrateReplayPayload(
  rawPayload: unknown,
): Record<string, unknown> {
  if (
    rawPayload === null ||
    rawPayload === undefined ||
    typeof rawPayload !== 'object' ||
    Array.isArray(rawPayload)
  ) {
    throw new ReplayVersionUnsupportedError(
      'notAnInteger',
      undefined,
      `migrateReplayPayload: expected a JSON object, got ${describeJsonType(
        rawPayload,
      )}`,
    );
  }
  const payload = rawPayload as Record<string, unknown>;

  // Guard against migrating arbitrary JSON. This is intentionally
  // permissive about absence — only reject on an explicit *wrong* magic.
  // (A missing `format` will still fail the downstream parser.)
  const magic = payload['format'];
  if (magic !== undefined && magic !== REPLAY_FORMAT_MAGIC) {
    throw new ReplayVersionUnsupportedError(
      'notAnInteger',
      payload['version'],
      `migrateReplayPayload: refusing to migrate non-replay payload — ` +
        `format magic ${JSON.stringify(magic)} does not match expected ` +
        `${JSON.stringify(REPLAY_FORMAT_MAGIC)}`,
    );
  }

  const version = payload['version'];
  const status = describeReplayVersionStatus(version);
  if (status.kind === 'unsupported') {
    throw buildVersionUnsupportedError(status);
  }
  if (status.kind === 'current') {
    return payload;
  }

  // Walk the migration steps in order. The `describeReplayVersionStatus`
  // result already filtered to the steps we need; double-check
  // consecutive `from`/`to` advancement so a future bug in the registry
  // surfaces here rather than producing a half-migrated payload.
  let current = payload;
  let expectedFrom = status.version;
  for (const step of status.steps) {
    if (step.from !== expectedFrom) {
      throw new ReplayMigrationError(
        step.from,
        step.to,
        `migrateReplayPayload: registered migration chain is broken — ` +
          `expected step from version ${expectedFrom}, got step from ${step.from}`,
      );
    }
    let next: Record<string, unknown>;
    try {
      next = step.migrate(current);
    } catch (err) {
      if (err instanceof ReplayMigrationError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new ReplayMigrationError(
        step.from,
        step.to,
        `migrateReplayPayload: migration ${step.from} → ${step.to} threw: ${msg}`,
        err,
      );
    }
    if (next['version'] !== step.to) {
      throw new ReplayMigrationError(
        step.from,
        step.to,
        `migrateReplayPayload: migration ${step.from} → ${step.to} did not ` +
          `set version to ${step.to}, got ${JSON.stringify(next['version'])}`,
      );
    }
    current = next;
    expectedFrom = step.to;
  }
  if (expectedFrom !== CURRENT_REPLAY_FORMAT_VERSION) {
    throw new ReplayMigrationError(
      status.version,
      CURRENT_REPLAY_FORMAT_VERSION,
      `migrateReplayPayload: migration chain stopped at version ` +
        `${expectedFrom}, expected ${CURRENT_REPLAY_FORMAT_VERSION}`,
    );
  }
  return current;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildVersionUnsupportedError(
  status: Extract<ReplayVersionStatus, { kind: 'unsupported' }>,
): ReplayVersionUnsupportedError {
  switch (status.reason) {
    case 'notAnInteger':
      return new ReplayVersionUnsupportedError(
        'notAnInteger',
        status.version,
        `Replay file version field is not a finite integer — got ` +
          `${JSON.stringify(status.version)}`,
      );
    case 'tooNew':
      return new ReplayVersionUnsupportedError(
        'tooNew',
        status.version,
        `Replay file is from a newer build of the game (version ` +
          `${String(status.version)}); this build reads version ` +
          `${CURRENT_REPLAY_FORMAT_VERSION}`,
      );
    case 'tooOld':
      return new ReplayVersionUnsupportedError(
        'tooOld',
        status.version,
        `Replay file is from a build older than this loader can ` +
          `migrate (version ${String(status.version)}); the oldest ` +
          `supported version is ${MIN_MIGRATABLE_REPLAY_VERSION}`,
      );
  }
}

function assertMigrationChainWellFormed(
  chain: ReadonlyArray<ReplayMigration>,
): void {
  if (chain.length === 0) {
    // Empty chain is fine — happens when CURRENT === MIN.
    if (CURRENT_REPLAY_FORMAT_VERSION !== MIN_MIGRATABLE_REPLAY_VERSION) {
      throw new Error(
        `replayMigrations: empty migration chain but ` +
          `MIN_MIGRATABLE_REPLAY_VERSION (${MIN_MIGRATABLE_REPLAY_VERSION}) ` +
          `does not equal CURRENT_REPLAY_FORMAT_VERSION (${CURRENT_REPLAY_FORMAT_VERSION})`,
      );
    }
    return;
  }
  if (chain[0]!.from !== MIN_MIGRATABLE_REPLAY_VERSION) {
    throw new Error(
      `replayMigrations: first migration starts at version ${chain[0]!.from}, ` +
        `expected MIN_MIGRATABLE_REPLAY_VERSION (${MIN_MIGRATABLE_REPLAY_VERSION})`,
    );
  }
  for (let i = 0; i < chain.length; i += 1) {
    const step = chain[i]!;
    if (step.to !== step.from + 1) {
      throw new Error(
        `replayMigrations: migration[${i}] step is not single-version ` +
          `(from=${step.from}, to=${step.to}) — every step must advance by 1`,
      );
    }
    if (i > 0 && chain[i - 1]!.to !== step.from) {
      throw new Error(
        `replayMigrations: migration chain has a gap between ` +
          `migration[${i - 1}] (to=${chain[i - 1]!.to}) and ` +
          `migration[${i}] (from=${step.from})`,
      );
    }
  }
  const last = chain[chain.length - 1]!;
  if (last.to !== CURRENT_REPLAY_FORMAT_VERSION) {
    throw new Error(
      `replayMigrations: last migration ends at version ${last.to}, ` +
        `expected CURRENT_REPLAY_FORMAT_VERSION (${CURRENT_REPLAY_FORMAT_VERSION})`,
    );
  }
}

function describeJsonType(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
