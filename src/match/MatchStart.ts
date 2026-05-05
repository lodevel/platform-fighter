/**
 * Unified match-start capture — AC 30003 Sub-AC 3.
 *
 * What this module is
 * ===================
 *
 * The single canonical entry point a gameplay scene (or a replay
 * player, or a headless determinism harness) calls **once at match
 * start** to:
 *
 *   1. **Capture the deterministic match seed** from the resolved
 *      `MatchConfig.rngSeed` (or a caller-supplied fallback when no
 *      explicit seed was forwarded).
 *   2. **Wire the seed into the game's RNG initialization** by building
 *      the live `MatchRng` every gameplay subsystem (AI, hazards,
 *      particles, …) reads from.
 *   3. **Populate the match metadata snapshot** the replay structure
 *      will carry — characters, stage, timestamp, engine version,
 *      fixed-step interval, player count.
 *   4. **Re-emit a normalised, frozen `MatchConfig`** with the seed
 *      `>>> 0`-clamped so the replay header's `matchConfig.rngSeed`
 *      always matches the live `MatchRng.getSeed()` exactly.
 *
 * The returned {@link MatchStartContext} is a complete, immutable
 * snapshot of "what was decided when this match began." It is
 * designed so callers can pass it directly into:
 *
 *   • The match-scoped subsystems (`context.rng` is the `MatchRng`).
 *   • The recording controller (`context.matchConfig` is the canonical
 *     finalised config to record against).
 *   • The replay structure writer (`context.metadata` carries every
 *     diagnostic field {@link ReplayMetadata} expects, derived from
 *     the same single source of truth).
 *
 * Where it sits
 * -------------
 *
 *     MatchScene.create(data)
 *           │
 *           ▼
 *     initialiseMatch(opts)  ◄── this module
 *           │
 *           ├─ context.rng         → AI, hazards, particles
 *           ├─ context.matchConfig → RecordingController.start
 *           └─ context.metadata    → ReplayMetadata at save time
 *
 * Why a separate helper
 * ---------------------
 *
 *   • **Single source of truth.** The seed used by the live RNG, the
 *     seed written to `matchConfig.rngSeed`, and the seed surfaced via
 *     `context.seed` are the *same number*, computed once. There is
 *     no path that produces a divergent triplet.
 *
 *   • **Replay-symmetric.** The replay player calls the same helper
 *     with the parsed `ReplayFile.matchConfig` to reconstruct an
 *     identical `MatchRng`. Determinism is therefore a property of one
 *     entry point rather than something every call site has to honour.
 *
 *   • **Phaser-free / DOM-free.** No `Date.now()` directly, no Phaser
 *     registry access — the wall-clock instant is read exactly once
 *     from a caller-supplied `nowFactory` (defaults to `() => new Date()`)
 *     so tests pin the timestamp to a fixed value.
 *
 * Determinism contract
 * --------------------
 *
 * Given the same `matchConfig` and `fallbackSeed`, two calls produce:
 *
 *   • The same `seed` (the resolved + clamped unsigned 32-bit value).
 *   • Two `MatchRng` instances that emit identical sequences from any
 *     stream label (`stream('ai')`, `stream('hazard')`, …).
 *   • Identical `metadata.characterIds`, `metadata.stageId`,
 *     `metadata.playerCount`, `metadata.fixedTimestepMs`,
 *     `metadata.engineVersion` (everything except `metadata.startedAt`,
 *     which is a wall-clock value injected via `nowFactory`).
 *   • Identical `matchConfig` (frozen, with seed clamped).
 *
 * The wall-clock `metadata.startedAt` is *diagnostic only* — it is
 * never read by gameplay simulation, and it is not used to seed RNG.
 * Two replays of the same recording will simulate identically even
 * though they were started at different real times.
 */

import type { MatchConfig, PlayerSlot } from '../types';
import { MatchRng } from './MatchRng';
import {
  initialiseMatchRngFromConfig,
  type MatchRngInitResult,
} from './MatchInit';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Engine's only supported fixed physics step today (60 Hz). Mirrors the
 * default in `RecordingController` and `serializeReplay`. Exposed as a
 * named constant so callers that want to assert on it (e.g. the replay
 * player refusing playback when `fixedTimestepMs` differs) can compare
 * against the same single source.
 */
export const DEFAULT_FIXED_TIMESTEP_MS = 1000 / 60;

/**
 * Fallback `engineVersion` string emitted when the caller does not
 * forward a `package.json#version`. Distinct from `'unknown'` /
 * `'0.0.0'` so a replay header that ended up with this value is
 * obviously the "no version was wired" case rather than a coincidence.
 */
export const UNKNOWN_ENGINE_VERSION = '0.0.0-unknown';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-match metadata snapshot captured at match start. This is the
 * **inputs to the replay structure's metadata block** — it is *not*
 * the on-disk `ReplayMetadata` shape (which adds `notes` and
 * `durationFrames`, both of which are only known at *save* time, not
 * at start time).
 *
 * The fields here are exactly the ones the Seed AC for replay
 * metadata calls out — characters, stage, timestamp, version — plus
 * the fields the simulation-reconstruction layer needs to validate a
 * replay is being played on a compatible engine (`fixedTimestepMs`,
 * `playerCount`).
 */
export interface MatchStartMetadata {
  /**
   * ISO 8601 wall-clock instant the match started. Captured from the
   * caller-supplied `nowFactory` exactly once. Diagnostic only —
   * gameplay never reads it.
   */
  readonly startedAt: string;

  /**
   * The character chosen for each player slot, in slot order. Mirrors
   * `matchConfig.players[i].characterId`. Surfaced as its own array so
   * the replay browser / debug HUD can render "Wolf vs Cat" without
   * unpacking the whole match config.
   */
  readonly characterIds: ReadonlyArray<string>;

  /**
   * The stage the match was played on. Mirrors `matchConfig.stageId`.
   * Hoisted out of the match config for the same reason — surfaceable
   * without parsing the whole config.
   */
  readonly stageId: string;

  /**
   * Number of player slots active in the match. Equals
   * `matchConfig.players.length`. Carried separately so a downstream
   * timeline validator (e.g. `inputTimeline.entries[i].inputs.length`)
   * can sanity-check frame width without unpacking matchConfig first.
   */
  readonly playerCount: number;

  /**
   * The fixed physics step the simulation will run at. Captured here
   * (rather than read from a global at save time) so a future engine
   * with multiple supported steps cannot retroactively change the
   * value the simulation actually used.
   */
  readonly fixedTimestepMs: number;

  /**
   * `package.json#version` of the engine that started the match.
   * Defaults to {@link UNKNOWN_ENGINE_VERSION} when no value is forwarded.
   */
  readonly engineVersion: string;
}

/**
 * Complete result of `initialiseMatch`. Frozen, JSON-safe shape so the
 * caller can stash a single object on the scene / registry / test
 * fixture and read every "what did we decide at match start?" field
 * from one place.
 */
export interface MatchStartContext {
  /**
   * The deterministic match seed, clamped to unsigned 32-bit. Always
   * equal to `rng.getSeed()` and `matchConfig.rngSeed`.
   */
  readonly seed: number;

  /**
   * The live `MatchRng` instance every gameplay subsystem reads from.
   * Construct named substreams via `rng.stream('ai')` etc. so two
   * subsystems do not share PRNG state.
   */
  readonly rng: MatchRng;

  /**
   * Frozen, normalised `MatchConfig` — same shape as the caller's
   * input, but with `rngSeed` `>>> 0`-clamped so any downstream
   * validator (`serializeReplay`, replay-browser display) reads the
   * canonical value. The original config object is *not* mutated.
   */
  readonly matchConfig: MatchConfig;

  /**
   * The match-start metadata snapshot. Pass this through to the replay
   * writer at save time as the source of every `ReplayMetadata` field
   * other than `notes` (caller-supplied) and `durationFrames` (only
   * known after the buffer finalises).
   */
  readonly metadata: MatchStartMetadata;
}

/**
 * Inputs to {@link initialiseMatch}.
 */
export interface InitialiseMatchOptions {
  /**
   * The `MatchConfig` produced by the menu / replay player. Required —
   * the seed and metadata both descend from this object. The provided
   * config is *not* mutated; the helper builds a new frozen mirror.
   */
  readonly matchConfig: MatchConfig;

  /**
   * Engine-default seed used when `matchConfig.rngSeed` is non-finite.
   * Typically `GAME_CONFIG.defaultRngSeed` or the boot-scene RNG seed.
   * Defaults to `0` (Mulberry32 handles the all-zeros seed deterministically).
   */
  readonly fallbackSeed?: number;

  /**
   * `package.json#version` of the engine. Captured into
   * `metadata.engineVersion`. Defaults to {@link UNKNOWN_ENGINE_VERSION}.
   */
  readonly engineVersion?: string;

  /**
   * Fixed physics step interval the match will simulate at. Captured
   * into `metadata.fixedTimestepMs`. Defaults to {@link DEFAULT_FIXED_TIMESTEP_MS}.
   */
  readonly fixedTimestepMs?: number;

  /**
   * Wall-clock factory invoked exactly once to produce
   * `metadata.startedAt`. Defaults to `() => new Date()`. Tests pass
   * a fixed factory so the timestamp is reproducible.
   */
  readonly nowFactory?: () => Date;
}

// ---------------------------------------------------------------------------
// initialiseMatch
// ---------------------------------------------------------------------------

/**
 * Capture the seed + metadata snapshot for a starting match.
 *
 * This is the single point that ties "the seed the simulation runs at"
 * to "the seed the replay header records" to "the seed every gameplay
 * subsystem pulls a stream from." Calling it twice with the same
 * `matchConfig` + `fallbackSeed` produces deterministic, byte-equal
 * `seed`, `rng` sequences, `matchConfig`, and (modulo `startedAt`)
 * `metadata`.
 *
 * Validation:
 *
 *   • `matchConfig` must be a non-null object.
 *   • `matchConfig.players` must contain 1..4 entries (the Seed's
 *     local-multi cap). The serialiser later applies the same check;
 *     we mirror it here so callers get a coherent error at *match
 *     start* rather than at save time.
 *
 * Returns a frozen {@link MatchStartContext}. The `matchConfig` and
 * `metadata` fields are themselves frozen (deep-frozen for the two
 * arrays inside).
 */
export function initialiseMatch(
  options: InitialiseMatchOptions,
): MatchStartContext {
  validateInitialiseMatchInputs(options);

  const fallbackSeed = resolveFallbackSeed(options.fallbackSeed);
  const fixedTimestepMs = resolveFixedTimestep(options.fixedTimestepMs);
  const engineVersion = resolveEngineVersion(options.engineVersion);
  const nowFactory = options.nowFactory ?? defaultNowFactory;

  // Step 1 — capture the seed + build the live MatchRng. Delegated to
  // the existing AC 30001 helper so resolution-order rules stay in one
  // place.
  const init: MatchRngInitResult = initialiseMatchRngFromConfig(
    options.matchConfig,
    fallbackSeed,
  );

  // Step 2 — re-emit the matchConfig with the resolved seed so the
  // replay header's matchConfig.rngSeed matches the live MatchRng.
  // We re-emit field-by-field (rather than `{ ...config }`) so a typo'd
  // extra field on the runtime MatchConfig cannot silently leak into
  // the canonical match-start config.
  const normalisedConfig = freezeMatchConfig(options.matchConfig, init.seed);

  // Step 3 — build the metadata snapshot. The startedAt timestamp is
  // captured *here*, exactly once — no other code path in the helper
  // touches the wall clock.
  const metadata = buildMatchStartMetadata({
    matchConfig: normalisedConfig,
    fixedTimestepMs,
    engineVersion,
    nowFactory,
  });

  return Object.freeze({
    seed: init.seed,
    rng: init.rng,
    matchConfig: normalisedConfig,
    metadata,
  });
}

/**
 * Build just the metadata snapshot. Exposed for callers that already
 * built a `MatchRng` separately (the existing `MatchScene` path) but
 * still want the consolidated metadata block — typically for the
 * replay header.
 *
 * Calling this is equivalent to `initialiseMatch(...).metadata`
 * provided the same inputs are forwarded; we re-export it to avoid
 * forcing callers to throw away an already-constructed RNG.
 */
export function buildMatchStartMetadata(options: {
  readonly matchConfig: MatchConfig;
  readonly fixedTimestepMs?: number;
  readonly engineVersion?: string;
  readonly nowFactory?: () => Date;
}): MatchStartMetadata {
  if (
    options.matchConfig === undefined ||
    options.matchConfig === null ||
    typeof options.matchConfig !== 'object'
  ) {
    throw new Error(
      'buildMatchStartMetadata: matchConfig is required and must be an object',
    );
  }
  if (
    !Array.isArray(options.matchConfig.players) ||
    options.matchConfig.players.length < 1 ||
    options.matchConfig.players.length > 4
  ) {
    throw new Error(
      'buildMatchStartMetadata: matchConfig.players must contain 1..4 entries',
    );
  }
  const fixedTimestepMs = resolveFixedTimestep(options.fixedTimestepMs);
  const engineVersion = resolveEngineVersion(options.engineVersion);
  const nowFactory = options.nowFactory ?? defaultNowFactory;

  const characterIds = Object.freeze(
    options.matchConfig.players.map((slot) => String(slot.characterId)),
  );
  const startedAt = nowFactory().toISOString();

  return Object.freeze({
    startedAt,
    characterIds,
    stageId: options.matchConfig.stageId,
    playerCount: options.matchConfig.players.length,
    fixedTimestepMs,
    engineVersion,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function validateInitialiseMatchInputs(options: InitialiseMatchOptions): void {
  if (options === undefined || options === null || typeof options !== 'object') {
    throw new Error('initialiseMatch: options is required and must be an object');
  }
  if (
    options.matchConfig === undefined ||
    options.matchConfig === null ||
    typeof options.matchConfig !== 'object'
  ) {
    throw new Error('initialiseMatch: matchConfig is required and must be an object');
  }
  if (
    !Array.isArray(options.matchConfig.players) ||
    options.matchConfig.players.length < 1 ||
    options.matchConfig.players.length > 4
  ) {
    throw new Error(
      'initialiseMatch: matchConfig.players must contain 1..4 entries',
    );
  }
  if (
    typeof options.matchConfig.stageId !== 'string' ||
    options.matchConfig.stageId.length === 0
  ) {
    throw new Error(
      'initialiseMatch: matchConfig.stageId must be a non-empty string',
    );
  }
}

function resolveFallbackSeed(raw: number | undefined): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw >>> 0;
  return 0;
}

function resolveFixedTimestep(raw: number | undefined): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_FIXED_TIMESTEP_MS;
}

function resolveEngineVersion(raw: string | undefined): string {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return UNKNOWN_ENGINE_VERSION;
}

function defaultNowFactory(): Date {
  return new Date();
}

/**
 * Re-emit a `MatchConfig` field-by-field with the resolved seed,
 * deeply frozen. We do this rather than `{ ...config, rngSeed }` so:
 *   • An unexpected runtime field on the source config cannot leak
 *     into the canonical match-start config.
 *   • Deeply nested structures (the players array + each PlayerSlot)
 *     are frozen too, so a downstream consumer cannot accidentally
 *     mutate the captured snapshot.
 */
function freezeMatchConfig(source: MatchConfig, resolvedSeed: number): MatchConfig {
  const players = Object.freeze(
    source.players.map((slot) =>
      Object.freeze({
        index: slot.index,
        characterId: slot.characterId,
        paletteIndex: slot.paletteIndex,
        inputType: slot.inputType,
        ...(slot.aiDifficulty !== undefined
          ? { aiDifficulty: slot.aiDifficulty }
          : {}),
      }),
    ),
  ) as ReadonlyArray<PlayerSlot>;
  return Object.freeze({
    mode: source.mode,
    stockCount: source.stockCount,
    ...(source.timeLimitSeconds !== undefined
      ? { timeLimitSeconds: source.timeLimitSeconds }
      : {}),
    stageId: source.stageId,
    players,
    rngSeed: resolvedSeed,
  });
}
