/**
 * Replay file schema — dedicated type definitions (AC 30001 Sub-AC 1).
 *
 * What this module is
 * ===================
 *
 * The single, dedicated home for the *serializable* replay data
 * structures used by the M4 hybrid replay system. Anything that
 * persists to / reads from disk (or IndexedDB / localStorage / a file
 * download) is shaped by an interface declared here.
 *
 * The companion module `./ReplayFile.ts` consumes these types to
 * implement the (de)serialisation, validation, and round-trip helpers.
 * That separation matters because:
 *
 *   • Tooling (the M4 replay browser, the snapshot resync layer in a
 *     later sub-AC, headless determinism harnesses) can `import type`
 *     the replay schema without pulling in the validator / writer code.
 *   • The Seed's "code architecture" evaluation principle calls for
 *     clean separation of concerns. The schema is the contract; the
 *     serialiser is one consumer of that contract.
 *   • Future format work (binary encoding, RLE timelines, cross-version
 *     migration) can live next to the type declarations without
 *     bloating the writer module.
 *
 * Schema overview
 * ---------------
 *
 *   • Per-frame input format — {@link RecordedCharacterInput} describes
 *     the closed shape every player slot's input takes for a single
 *     fixed physics frame. Re-exported from the runtime
 *     `InputCaptureBuffer` so the on-disk record and the in-memory
 *     buffer share one source of truth.
 *
 *   • RNG seed — carried at two levels: top-level
 *     {@link ReplayFile.rngSeed} and inside
 *     {@link ReplayFile.matchConfig}.rngSeed. The two MUST agree; the
 *     deserialiser rejects mismatches as a corrupt file. Stored as an
 *     unsigned 32-bit integer so it round-trips through JSON without
 *     precision loss (the same domain `MatchRng` uses).
 *
 *   • Match metadata — {@link ReplayMetadata} carries the diagnostic /
 *     housekeeping fields the Seed AC calls out:
 *       - characters: indirectly via `matchConfig.players[].characterId`
 *         (the canonical source — the metadata block does not duplicate
 *         it), with the duration and player count carried inline so a
 *         replay browser can preview a file without parsing the full
 *         match config.
 *       - stage: indirectly via `matchConfig.stageId` (same rationale).
 *       - timestamp: {@link ReplayMetadata.recordedAt} — ISO 8601 string,
 *         captured at write time, never read by gameplay simulation.
 *       - version: {@link ReplayFile.version} — monotonically-increasing
 *         schema version integer, distinct from
 *         {@link ReplayMetadata.engineVersion} which captures the
 *         producing engine's `package.json` version.
 *
 * Determinism contract
 * --------------------
 *
 * The schema is designed so a replay file is a *complete* description
 * of one match's deterministic inputs:
 *
 *   1. `matchConfig` reproduces the lobby state (mode, stocks,
 *      stage, every PlayerSlot's character / palette / input type).
 *   2. `rngSeed` reproduces the deterministic RNG every gameplay
 *      subsystem reads through `MatchRng`.
 *   3. `inputTimeline` reproduces every fixed-frame `CharacterInput` in
 *      capture order with monotonic frame numbers.
 *
 * Given those three, the replay player drives `Character.applyInput`
 * frame-by-frame to recreate the original match bit-for-bit.
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM imports — this module is unit-testable
 * under plain Node (vitest) and reusable from headless replay tooling.
 */

import type { MatchConfig } from '../types';
import type {
  CapturedFrame,
  RecordedCharacterInput,
} from './InputCaptureBuffer';
import type { ItemSpawnEvent } from './ItemSpawnEventLog';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Magic identifier embedded in every replay file so the deserialiser
 * can reject a JSON document that happens to share field names with a
 * replay (e.g. a savegame, a network message). Stable forever — never
 * change this string; future format work bumps {@link REPLAY_FORMAT_VERSION}
 * instead.
 */
export const REPLAY_FORMAT_MAGIC = 'platform-fighter-replay' as const;

/**
 * Current on-disk schema version. Increment when adding fields older
 * deserialisers cannot safely ignore. Today's writer always emits this
 * version; the reader refuses any other value rather than guessing.
 *
 * Version history:
 *   • v0 — early dev-build, missing `metadata.engineVersion` and
 *     `metadata.notes`. Migrated to v1 by `migrateV0ToV1`.
 *   • v1 — first shipped format. Carries match config, RNG seed,
 *     metadata, and per-frame input timeline.
 *   • v2 — adds {@link ReplayFile.itemSpawnEvents} so a match's item
 *     spawns (type, position, tick) round-trip through the file
 *     format and a replay-of-an-items-on match reproduces every
 *     spawn deterministically. Migrated from v1 by `migrateV1ToV2`,
 *     which backfills an empty `itemSpawnEvents` array (v1 replays
 *     predate the items framework so the empty default is correct).
 */
export const REPLAY_FORMAT_VERSION = 3 as const;

/**
 * Recommended file extension for saved replays. The serialiser does not
 * write to disk itself (browsers do that via `Blob` + download), but
 * the file picker / save dialog should pre-fill this so users don't end
 * up with `.txt` files they can't open.
 */
export const REPLAY_FILE_EXTENSION = '.replay.json' as const;

// ---------------------------------------------------------------------------
// Per-frame input format — re-exported from the runtime buffer so the
// on-disk schema and the in-memory log share one source of truth.
// ---------------------------------------------------------------------------

export type {
  /**
   * Normalised, fully-closed per-frame input record. Mirrors
   * `CharacterInput` exactly so a replay player can pass it straight
   * into `Character.applyInput` without an adapter step.
   */
  RecordedCharacterInput,
  /**
   * Runtime in-memory shape of one captured frame. The on-disk mirror
   * is {@link SerializedCapturedFrame}, which is identical except that
   * it is intentionally JSON-safe (no `Object.freeze` requirement on
   * disk — the deserialiser re-applies freezing on read).
   */
  CapturedFrame,
} from './InputCaptureBuffer';

// ---------------------------------------------------------------------------
// Per-spawn item event format — re-exported from the runtime log so the
// on-disk schema and the in-memory log share one source of truth.
// ---------------------------------------------------------------------------

export type {
  /**
   * One item-spawn event entry. Carries the AC-mandated
   * `(type, position, tick)` triple plus a diagnostic `anchorIndex`.
   * Re-exported from {@link ./ItemSpawnEventLog} so consumers that
   * `import type` the replay schema get the spawn-event shape from a
   * single canonical source.
   */
  ItemSpawnEvent,
} from './ItemSpawnEventLog';

// ---------------------------------------------------------------------------
// Schema — metadata
// ---------------------------------------------------------------------------

/**
 * Diagnostic / housekeeping metadata. None of these fields affect
 * gameplay determinism — they exist so the replay browser can sort by
 * recording date, the replay player can warn on engine-version
 * mismatch, and replay files have stable identifiers for sharing.
 *
 * The Seed AC calls for "characters, stage, timestamp, version" as
 * match metadata. `characters` and `stage` are deliberately NOT
 * duplicated here — they live on {@link ReplayFile.matchConfig} as the
 * single source of truth (so a replay browser surfacing a roster /
 * stage cannot disagree with the simulation). `timestamp` is
 * {@link ReplayMetadata.recordedAt}; `version` is the schema-level
 * {@link ReplayFile.version}, with this struct's `engineVersion`
 * providing the additional diagnostic of *which* engine build wrote
 * the file.
 */
export interface ReplayMetadata {
  /**
   * ISO 8601 timestamp of when the replay was recorded. Captured at
   * serialise time from a caller-supplied `Date` (defaulting to "now")
   * so the gameplay simulation never reads the wall clock.
   */
  readonly recordedAt: string;

  /**
   * Total number of fixed-timestep frames in the input timeline. Equals
   * `lastCapturedFrame + 1` for a non-empty buffer, or `0` for an empty
   * one. Useful for the replay browser preview ("3:42 long") without
   * having to decode the whole timeline.
   */
  readonly durationFrames: number;

  /**
   * Fixed-step physics interval the simulation ran at when this replay
   * was captured. The replay player refuses playback if the live
   * engine runs a different step (different physics → different match).
   */
  readonly fixedTimestepMs: number;

  /**
   * Number of player slots active in the recorded match. Mirrors
   * `matchConfig.players.length`; carried separately so the timeline
   * decoder can validate frame width without unpacking matchConfig
   * first.
   */
  readonly playerCount: number;

  /**
   * `package.json` version string of the engine that produced the
   * replay. The replay player surfaces this in the UI; it does not by
   * default refuse playback on mismatch (semver-major bumps would be
   * the trigger if so). Distinct from {@link ReplayFile.version},
   * which is the schema-level integer.
   */
  readonly engineVersion: string;

  /**
   * Caller-supplied free-form description (match name, "exhibition:
   * Wolf vs Cat", etc.). Empty string if not supplied. Limited to 1024
   * characters to keep the replay header bounded.
   */
  readonly notes: string;
}

// ---------------------------------------------------------------------------
// Schema — input timeline
// ---------------------------------------------------------------------------

/**
 * One captured frame as it appears on disk. Mirrors
 * {@link CapturedFrame} but is intentionally a JSON-safe object — the
 * runtime buffer applies `Object.freeze`, the file format does not
 * require it (the deserialiser re-applies freezing when it parses).
 */
export interface SerializedCapturedFrame {
  /** Deterministic 60 Hz frame index, monotonically increasing. */
  readonly frame: number;
  /**
   * Per-player input for this frame. Length is exactly the
   * {@link ReplayInputTimeline.playerCount}. Slot ordering matches
   * `matchConfig.players` (i.e. `inputs[0]` is `players[0]`).
   */
  readonly inputs: ReadonlyArray<RecordedCharacterInput>;
}

/**
 * The full input log as it appears on disk. Wrapped in its own object
 * (rather than a bare array) so future timeline encodings (RLE, column
 * store, binary) can land in a backward-compatible way: a future
 * version may add an `encoding: 'rle'` discriminator alongside
 * `entries`.
 */
export interface ReplayInputTimeline {
  /**
   * Number of player slots each `entries[i].inputs` array must
   * contain. Carried inside the timeline (in addition to
   * `metadata.playerCount`) so a partial / corrupted file is rejected
   * by the timeline validator without needing access to metadata.
   */
  readonly playerCount: number;

  /**
   * Per-frame input snapshots in capture order. Frames are strictly
   * monotonic — duplicates and rewinds are rejected on read so a
   * hand-edited file cannot silently break replay determinism.
   */
  readonly entries: ReadonlyArray<SerializedCapturedFrame>;
}

// ---------------------------------------------------------------------------
// Schema — top-level replay file
// ---------------------------------------------------------------------------

/**
 * A complete replay file. JSON-safe — no class instances, no `Date`s,
 * no `Map`s. Persist with `JSON.stringify(file)` (or
 * `serializeReplayToString` from `./ReplayFile`).
 *
 * Field order in this interface is the writer's emit order. The reader
 * does not depend on key order — `JSON.parse` is order-independent —
 * but keeping the writer's order stable makes diffs of two saved
 * replays readable.
 */
export interface ReplayFile {
  /** Magic identifier — always {@link REPLAY_FORMAT_MAGIC}. */
  readonly format: typeof REPLAY_FORMAT_MAGIC;

  /**
   * Schema version — always {@link REPLAY_FORMAT_VERSION} for today's
   * writer. Distinct from {@link ReplayMetadata.engineVersion}: this
   * field tracks the *file format*, the metadata field tracks the
   * *engine build* that produced the file.
   */
  readonly version: typeof REPLAY_FORMAT_VERSION;

  /** Diagnostic / housekeeping fields. See {@link ReplayMetadata}. */
  readonly metadata: ReplayMetadata;

  /**
   * The match settings that produced this replay (mode, stocks,
   * stage, players, seed). Reconstructing the live match starts by
   * feeding this straight into `initialiseMatchRngFromConfig` and the
   * gameplay scene's match-init path.
   *
   * This is also the canonical home for the AC's "characters" and
   * "stage" metadata — `matchConfig.players[].characterId` and
   * `matchConfig.stageId` respectively. The schema deliberately does
   * not duplicate them in {@link ReplayMetadata} so the simulation
   * reconstruction and any UI preview cannot disagree.
   */
  readonly matchConfig: MatchConfig;

  /**
   * The deterministic seed every gameplay subsystem reads from via
   * `MatchRng`. Carried at the top level (in addition to
   * `matchConfig.rngSeed`) so the loader can validate the two agree —
   * any divergence is treated as a corrupt file. Stored as an
   * unsigned 32-bit integer so the value survives JSON round-trip
   * without precision loss.
   */
  readonly rngSeed: number;

  /** Per-frame input log. See {@link ReplayInputTimeline}. */
  readonly inputTimeline: ReplayInputTimeline;

  /**
   * Item-spawn event log — T3 items framework, AC 17.
   *
   * Append-only, frame-keyed list of every item that physically
   * appeared on the stage during the recorded match. Each entry
   * carries the AC-mandated **(type, position, tick)** triple so a
   * replay player can:
   *
   *   1. Reconstruct every spawn deterministically when re-feeding
   *      the {@link inputTimeline} into the live simulation; and
   *   2. Cross-check live spawn events fired during playback against
   *      the recorded log, surfacing any divergence the
   *      desync-recovery pipeline can flag.
   *
   * Frames are non-decreasing (multiple items may legitimately spawn
   * on the same fixed-step tick under a future burst-spawn mode).
   * Empty array is the canonical default for matches with items
   * disabled (frequency `'off'` / no anchors / pre-items v1 replays
   * that loaded through the v1 → v2 migration).
   */
  readonly itemSpawnEvents: ReadonlyArray<ItemSpawnEvent>;
}
