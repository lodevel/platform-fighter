/**
 * Replay file schema + (de)serialisation — AC 30003 Sub-AC 3.
 *
 * What this module is
 * ===================
 *
 * The on-disk / on-wire format the M4 hybrid replay system reads and
 * writes. Given:
 *
 *   • a finalised `MatchConfig` (the menu / replay-player chose mode,
 *     stocks, stage, players, seed);
 *   • the per-frame `InputCaptureBuffer` log captured during a played
 *     match;
 *   • optional metadata the recorder wants to attach (notes, an
 *     explicit `recordedAt`, etc.);
 *
 * `serializeReplay()` produces a plain, JSON-safe `ReplayFile` object
 * (and `serializeReplayToString()` produces the string a save dialog
 * writes to disk). `deserializeReplay()` / `deserializeReplayFromString()`
 * round-trip them back into the exact same `ReplayFile`.
 *
 * Where it sits in the replay architecture
 * ----------------------------------------
 *
 *   gameplay scene
 *     │
 *     ├─ MatchInit ─────► MatchRng (seed captured at match start)
 *     │
 *     └─ InputCaptureBuffer (per-frame inputs, deterministic)
 *                                      │
 *                                      ▼
 *                       ┌──────────────────────────────┐
 *                       │  ReplayFile.serializeReplay  │  ◄── this module
 *                       └──────────────────────────────┘
 *                                      │
 *                                      ▼
 *                              .replay.json (saved)
 *                                      │
 *                                      ▼
 *                       ┌──────────────────────────────┐
 *                       │ ReplayFile.deserializeReplay │  ◄── this module
 *                       └──────────────────────────────┘
 *                                      │
 *                                      ▼
 *                       initialiseMatchRngFromConfig  +  InputCaptureBuffer.captureFrame replay
 *
 * The Sub-AC 4 VCR player and the Sub-AC 5 snapshot-resync layer both
 * sit downstream of this module — they consume the `ReplayFile` shape
 * `serializeReplay` produces.
 *
 * Schema versioning
 * -----------------
 *
 * Every replay carries:
 *
 *   • {@link REPLAY_FORMAT_MAGIC} — a fixed string that lets the loader
 *     reject "this is some other JSON file" before it tries to interpret
 *     the rest as a replay.
 *   • {@link REPLAY_FORMAT_VERSION} — a monotonically-increasing integer.
 *     The deserialiser refuses to load an unknown version rather than
 *     guess; future versions add new fields and bump this number.
 *
 * Determinism guarantees
 * ----------------------
 *
 *   • The input timeline is preserved bit-for-bit. The serialiser does
 *     not requantise `moveX` (gamepad analog values round-trip exactly)
 *     and does not collapse "neutral" frames — if the buffer captured
 *     frame N, the file contains frame N. Frame ordering is enforced
 *     monotonic on both write and read so a hand-edited file cannot
 *     silently corrupt a match.
 *   • The RNG seed is `>>> 0`-clamped to an unsigned 32-bit integer (the
 *     same domain `MatchRng` enforces) so a replay seed survives JSON
 *     round-trip without precision loss.
 *   • Metadata that affects determinism (`fixedTimestepMs`,
 *     `playerCount`, `engineVersion`) is captured at write time and the
 *     reader exposes it untouched. The downstream replay player decides
 *     whether to refuse playback when these mismatch the live engine.
 *   • `recordedAt` is captured as an ISO 8601 string. It does NOT enter
 *     gameplay — it's diagnostic only — so the wall-clock dependency at
 *     write time does not leak into match determinism.
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM imports. This module is unit-testable under
 * plain Node (vitest) and can be reused by the headless replay tooling
 * the M4 milestone introduces.
 */

import type { MatchConfig, MatchMode, PlayerSlot } from '../types';
import type {
  CapturedFrame,
  RecordedCharacterInput,
} from './InputCaptureBuffer';
import type { ItemSpawnEvent } from './ItemSpawnEventLog';
import {
  REPLAY_FORMAT_MAGIC,
  REPLAY_FORMAT_VERSION,
} from './replayTypes';
import type {
  ReplayFile,
  ReplayInputTimeline,
  ReplayMetadata,
  SerializedCapturedFrame,
} from './replayTypes';
import {
  CURRENT_REPLAY_FORMAT_VERSION,
  ReplayVersionUnsupportedError,
  migrateReplayPayload,
} from './replayMigrations';

// ---------------------------------------------------------------------------
// Schema re-exports
// ---------------------------------------------------------------------------
//
// The serializable replay schema (constants + types) lives in the
// dedicated `./replayTypes` module so consumers that only need the
// shape — the M4 replay browser, headless determinism harnesses, the
// snapshot resync layer landing in a later sub-AC — can `import type`
// without pulling in the validator / writer code below. We re-export
// the same surface here so existing call sites that import from
// `./ReplayFile` (and the `./index` barrel) keep working unchanged.

export {
  REPLAY_FORMAT_MAGIC,
  REPLAY_FORMAT_VERSION,
  REPLAY_FILE_EXTENSION,
} from './replayTypes';
export type {
  ReplayFile,
  ReplayInputTimeline,
  ReplayMetadata,
  SerializedCapturedFrame,
} from './replayTypes';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when (de)serialisation fails. Distinct subclass so callers can
 * `catch (e) { if (e instanceof ReplayFileError) ... }` to distinguish
 * "this isn't a replay file we can read" from generic runtime errors.
 */
export class ReplayFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayFileError';
  }
}

// ---------------------------------------------------------------------------
// Serialise
// ---------------------------------------------------------------------------

/**
 * Inputs to {@link serializeReplay}. The recorded match's `MatchConfig`
 * and the `InputCaptureBuffer.getEntries()` result are the two required
 * arguments; everything else is optional and defaults to a sensible
 * "now / no notes / package version" value.
 */
export interface SerializeReplayOptions {
  /** The match settings that produced the captured frames. */
  readonly matchConfig: MatchConfig;
  /**
   * The captured input log, exactly as `InputCaptureBuffer.getEntries()`
   * returned it. The serialiser validates that every entry's `inputs`
   * length matches `matchConfig.players.length` and that frames are
   * strictly monotonic.
   */
  readonly capturedFrames: ReadonlyArray<CapturedFrame>;
  /**
   * Item-spawn event log — T3 items framework, AC 17. Pass exactly
   * what `ItemSpawnEventLog.getEntries()` returned. The serialiser
   * validates each event (frame non-negative integer; type non-empty
   * string; x / y finite numbers; anchorIndex integer >= -1) and
   * enforces non-decreasing frame ordering. Optional — defaults to an
   * empty array for matches with items disabled (frequency `'off'`,
   * no anchors, or any pre-items code path that doesn't have a log
   * to forward yet).
   */
  readonly itemSpawnEvents?: ReadonlyArray<ItemSpawnEvent>;
  /**
   * Wall-clock instant the recording finished. Captured into
   * `metadata.recordedAt` as an ISO 8601 string. Optional — defaults to
   * `new Date()` at serialise time. Pass an explicit `Date` (or a fixed
   * one in tests) to keep the serialiser pure.
   */
  readonly recordedAt?: Date;
  /**
   * Engine version string (typically `package.json#version`). Captured
   * into `metadata.engineVersion`. Optional — defaults to
   * `'0.0.0-unknown'` so a replay always carries *some* version even if
   * the caller forgot to wire the package metadata.
   */
  readonly engineVersion?: string;
  /**
   * Caller-supplied free-form notes (match name, comments). Trimmed and
   * truncated to 1024 characters. Optional — defaults to `''`.
   */
  readonly notes?: string;
  /**
   * Fixed-step physics interval the simulation ran at. Captured into
   * `metadata.fixedTimestepMs`. Optional — defaults to `1000 / 60`
   * (the engine's only supported step today).
   */
  readonly fixedTimestepMs?: number;
}

/**
 * Build a {@link ReplayFile} from a finished match. Throws
 * {@link ReplayFileError} on malformed input — the same error class the
 * deserialiser throws — so a caller's "save replay" handler can catch
 * one type and report it.
 *
 * Validation performed:
 *
 *   • `matchConfig` must be non-null and must include a finite, non-
 *     negative integer `rngSeed` (the determinism contract requires it).
 *   • `matchConfig.players` must be 1..4 long (the Seed's local-multi
 *     cap).
 *   • Every `capturedFrames[i].inputs.length` must equal the player
 *     count.
 *   • `capturedFrames` must be strictly monotonic by `frame`.
 *   • `notes` is trimmed and silently truncated to 1024 chars.
 */
export function serializeReplay(options: SerializeReplayOptions): ReplayFile {
  validateMatchConfigForWrite(options.matchConfig);

  const playerCount = options.matchConfig.players.length;
  const entries = freezeCapturedFramesForWrite(
    options.capturedFrames,
    playerCount,
  );
  // Item spawn events are optional on input — most callers (tests,
  // legacy code paths, items-disabled matches) pass nothing. Default
  // to an empty array, validated identically to a non-empty one so
  // the writer's contract stays the same shape regardless.
  const itemSpawnEvents = freezeItemSpawnEventsForWrite(
    options.itemSpawnEvents ?? [],
  );

  const recordedAt = (options.recordedAt ?? new Date()).toISOString();
  const fixedTimestepMs =
    typeof options.fixedTimestepMs === 'number' &&
    Number.isFinite(options.fixedTimestepMs) &&
    options.fixedTimestepMs > 0
      ? options.fixedTimestepMs
      : 1000 / 60;
  const engineVersion =
    typeof options.engineVersion === 'string' && options.engineVersion.length > 0
      ? options.engineVersion
      : '0.0.0-unknown';
  const notes = clampNotes(options.notes ?? '');

  // Duration in frames = (last captured frame + 1) for non-empty logs,
  // 0 otherwise. Using "+1" rather than "entries.length" is correct
  // because the buffer permits non-contiguous monotonic frames (e.g.
  // skipped frames during a paused recording).
  const lastEntry = entries[entries.length - 1];
  const durationFrames = lastEntry === undefined ? 0 : lastEntry.frame + 1;

  // `>>> 0`-clamp the seed at the top level so the file's `rngSeed` is
  // the canonical unsigned-32 form even if the caller passed a negative
  // or huge number.
  const rngSeed = options.matchConfig.rngSeed >>> 0;

  // Re-emit `matchConfig` field-by-field so the file format is
  // independent of any extra fields the runtime `MatchConfig` may grow
  // in future. Same reason we don't `JSON.stringify(matchConfig)`
  // directly — a typo'd extra field at runtime would silently leak into
  // every saved replay.
  const matchConfig: MatchConfig = freezeMatchConfigForWrite(
    options.matchConfig,
    rngSeed,
  );

  return Object.freeze({
    format: REPLAY_FORMAT_MAGIC,
    version: REPLAY_FORMAT_VERSION,
    metadata: Object.freeze({
      recordedAt,
      durationFrames,
      fixedTimestepMs,
      playerCount,
      engineVersion,
      notes,
    }),
    matchConfig,
    rngSeed,
    inputTimeline: Object.freeze({
      playerCount,
      entries,
    }),
    itemSpawnEvents,
  });
}

/**
 * Convenience: serialise + `JSON.stringify` in one call. Pass `pretty`
 * to emit two-space-indented JSON for human-readable diffs (the default
 * is compact JSON that minimises file size on disk).
 */
export function serializeReplayToString(
  options: SerializeReplayOptions,
  pretty = false,
): string {
  return JSON.stringify(serializeReplay(options), null, pretty ? 2 : 0);
}

// ---------------------------------------------------------------------------
// Deserialise
// ---------------------------------------------------------------------------

/**
 * Parse a `ReplayFile` from an arbitrary JS value (typically the output
 * of `JSON.parse`). Throws {@link ReplayFileError} with a descriptive
 * message on any schema violation:
 *
 *   • Wrong type (non-object, array, null);
 *   • Missing or wrong-typed required fields;
 *   • Unknown `format` magic / unsupported `version`;
 *   • Mismatch between top-level `rngSeed` and `matchConfig.rngSeed`;
 *   • Mismatch between `metadata.playerCount` and
 *     `matchConfig.players.length` / `inputTimeline.playerCount`;
 *   • Non-monotonic frames or wrong-width `inputs` arrays in the
 *     timeline.
 *
 * The returned `ReplayFile` is a fully-frozen mirror of the input shape
 * (the same shape `serializeReplay` produces), so callers cannot
 * accidentally mutate replay data after loading it.
 */
export function deserializeReplay(raw: unknown): ReplayFile {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ReplayFileError(
      `Replay file must be a JSON object — got ${describeJsonType(raw)}`,
    );
  }
  const initial = raw as Record<string, unknown>;

  if (initial['format'] !== REPLAY_FORMAT_MAGIC) {
    throw new ReplayFileError(
      `Replay file format magic mismatch — expected "${REPLAY_FORMAT_MAGIC}", ` +
        `got ${JSON.stringify(initial['format'])}`,
    );
  }

  // Run the version-compatibility / migration pass (AC 30103 Sub-AC 3)
  // *before* per-field validation so older payloads are reshaped into
  // the current schema first and then validated by the same pipeline as
  // freshly-written replays. Migration errors surface as
  // {@link ReplayVersionUnsupportedError} (or
  // {@link ReplayMigrationError}); we re-throw them as
  // {@link ReplayFileError} so the public deserializer's contract
  // ("throws ReplayFileError on schema violation") is preserved while
  // still preserving the original error class via `cause` for callers
  // that want to discriminate.
  let obj: Record<string, unknown>;
  try {
    obj = migrateReplayPayload(initial);
  } catch (err) {
    if (err instanceof ReplayVersionUnsupportedError) {
      throw new ReplayFileError(
        `Replay file schema version unsupported — ${err.message}`,
      );
    }
    if (err instanceof Error) {
      throw new ReplayFileError(
        `Replay file migration failed — ${err.message}`,
      );
    }
    throw err;
  }

  // After migration, the payload's `version` MUST match the version
  // this build natively parses. The strict equality check is kept so a
  // mis-registered migration that returned the wrong version still
  // surfaces as a clear error here rather than mis-parsing fields.
  if (obj['version'] !== CURRENT_REPLAY_FORMAT_VERSION) {
    throw new ReplayFileError(
      `Replay file schema version unsupported — this build reads version ` +
        `${REPLAY_FORMAT_VERSION}, post-migration payload is version ${JSON.stringify(
          obj['version'],
        )}`,
    );
  }

  const metadata = parseMetadata(obj['metadata']);
  const matchConfig = parseMatchConfig(obj['matchConfig']);
  const rngSeed = parseRngSeed(obj['rngSeed']);

  if (rngSeed !== matchConfig.rngSeed) {
    throw new ReplayFileError(
      `Replay file rngSeed (${rngSeed}) disagrees with ` +
        `matchConfig.rngSeed (${matchConfig.rngSeed}) — file is corrupt`,
    );
  }
  if (metadata.playerCount !== matchConfig.players.length) {
    throw new ReplayFileError(
      `Replay metadata.playerCount (${metadata.playerCount}) disagrees with ` +
        `matchConfig.players.length (${matchConfig.players.length})`,
    );
  }

  const inputTimeline = parseInputTimeline(
    obj['inputTimeline'],
    matchConfig.players.length,
  );
  if (inputTimeline.playerCount !== metadata.playerCount) {
    throw new ReplayFileError(
      `Replay inputTimeline.playerCount (${inputTimeline.playerCount}) ` +
        `disagrees with metadata.playerCount (${metadata.playerCount})`,
    );
  }

  // T3 items framework, AC 17 — item-spawn event log. Migrated v1
  // payloads always carry an empty array via `migrateV1ToV2`; native
  // v2 writers carry whatever the items-framework emitted.
  const itemSpawnEvents = parseItemSpawnEvents(obj['itemSpawnEvents']);
  // Cross-check duration. We tolerate metadata.durationFrames === 0 when
  // the timeline is empty, matching the writer's contract.
  const lastFrame =
    inputTimeline.entries.length === 0
      ? -1
      : inputTimeline.entries[inputTimeline.entries.length - 1]!.frame;
  const expectedDuration = lastFrame === -1 ? 0 : lastFrame + 1;
  if (metadata.durationFrames !== expectedDuration) {
    throw new ReplayFileError(
      `Replay metadata.durationFrames (${metadata.durationFrames}) does not ` +
        `match the timeline (last frame ${lastFrame}, expected ` +
        `${expectedDuration})`,
    );
  }

  return Object.freeze({
    format: REPLAY_FORMAT_MAGIC,
    version: REPLAY_FORMAT_VERSION,
    metadata,
    matchConfig,
    rngSeed,
    inputTimeline,
    itemSpawnEvents,
  });
}

/**
 * Convenience: `JSON.parse` + `deserializeReplay` in one call. Catches
 * `JSON.parse` errors and re-throws them as {@link ReplayFileError} so
 * the caller only has to handle one error type.
 */
export function deserializeReplayFromString(text: string): ReplayFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ReplayFileError(
      `Replay file is not valid JSON: ${msg}`,
    );
  }
  return deserializeReplay(parsed);
}

// ---------------------------------------------------------------------------
// Internal — write-side validators
// ---------------------------------------------------------------------------

function validateMatchConfigForWrite(config: MatchConfig | undefined | null): void {
  if (config === undefined || config === null || typeof config !== 'object') {
    throw new ReplayFileError(
      `serializeReplay: matchConfig is required and must be an object`,
    );
  }
  if (config.mode !== 'stocks' && config.mode !== 'time') {
    throw new ReplayFileError(
      `serializeReplay: matchConfig.mode must be 'stocks' | 'time', got ` +
        `${JSON.stringify(config.mode)}`,
    );
  }
  if (
    !Number.isInteger(config.stockCount) ||
    config.stockCount < 0 ||
    config.stockCount > 99
  ) {
    throw new ReplayFileError(
      `serializeReplay: matchConfig.stockCount must be an integer in [0, 99], ` +
        `got ${config.stockCount}`,
    );
  }
  if (typeof config.stageId !== 'string' || config.stageId.length === 0) {
    throw new ReplayFileError(
      `serializeReplay: matchConfig.stageId must be a non-empty string`,
    );
  }
  if (
    typeof config.rngSeed !== 'number' ||
    !Number.isFinite(config.rngSeed)
  ) {
    throw new ReplayFileError(
      `serializeReplay: matchConfig.rngSeed must be a finite number, got ` +
        `${String(config.rngSeed)}`,
    );
  }
  if (
    !Array.isArray(config.players) ||
    config.players.length < 1 ||
    config.players.length > 4
  ) {
    throw new ReplayFileError(
      `serializeReplay: matchConfig.players must contain 1..4 entries, got ` +
        `${Array.isArray(config.players) ? config.players.length : 'not an array'}`,
    );
  }
  for (let i = 0; i < config.players.length; i += 1) {
    validatePlayerSlotForWrite(config.players[i] as PlayerSlot, i);
  }
}

function validatePlayerSlotForWrite(slot: PlayerSlot, idx: number): void {
  if (slot === undefined || slot === null || typeof slot !== 'object') {
    throw new ReplayFileError(
      `serializeReplay: matchConfig.players[${idx}] must be an object`,
    );
  }
  if (slot.index !== 1 && slot.index !== 2 && slot.index !== 3 && slot.index !== 4) {
    throw new ReplayFileError(
      `serializeReplay: matchConfig.players[${idx}].index must be 1..4, got ` +
        `${slot.index}`,
    );
  }
  if (typeof slot.characterId !== 'string' || slot.characterId.length === 0) {
    throw new ReplayFileError(
      `serializeReplay: matchConfig.players[${idx}].characterId must be a ` +
        `non-empty string`,
    );
  }
  if (
    !Number.isInteger(slot.paletteIndex) ||
    slot.paletteIndex < 0 ||
    slot.paletteIndex > 7
  ) {
    throw new ReplayFileError(
      `serializeReplay: matchConfig.players[${idx}].paletteIndex must be ` +
        `0..7, got ${slot.paletteIndex}`,
    );
  }
  if (typeof slot.inputType !== 'string' || slot.inputType.length === 0) {
    throw new ReplayFileError(
      `serializeReplay: matchConfig.players[${idx}].inputType must be a ` +
        `non-empty string`,
    );
  }
}

function freezeCapturedFramesForWrite(
  frames: ReadonlyArray<CapturedFrame>,
  playerCount: number,
): ReadonlyArray<SerializedCapturedFrame> {
  if (!Array.isArray(frames)) {
    throw new ReplayFileError(
      `serializeReplay: capturedFrames must be an array`,
    );
  }
  const out: SerializedCapturedFrame[] = new Array(frames.length);
  let prev = -1;
  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i]!;
    if (!Number.isInteger(f.frame) || f.frame < 0) {
      throw new ReplayFileError(
        `serializeReplay: capturedFrames[${i}].frame must be a non-negative ` +
          `integer, got ${String(f.frame)}`,
      );
    }
    if (f.frame <= prev) {
      throw new ReplayFileError(
        `serializeReplay: capturedFrames[${i}].frame (${f.frame}) is not ` +
          `strictly greater than previous frame (${prev}) — frames must be ` +
          `monotonic`,
      );
    }
    if (!Array.isArray(f.inputs) || f.inputs.length !== playerCount) {
      throw new ReplayFileError(
        `serializeReplay: capturedFrames[${i}].inputs must contain exactly ` +
          `${playerCount} entries, got ${
            Array.isArray(f.inputs) ? f.inputs.length : 'not an array'
          }`,
      );
    }
    const inputs: RecordedCharacterInput[] = new Array(playerCount);
    for (let p = 0; p < playerCount; p += 1) {
      inputs[p] = canonicaliseInputForWrite(f.inputs[p]!, i, p);
    }
    out[i] = Object.freeze({
      frame: f.frame,
      inputs: Object.freeze(inputs),
    });
    prev = f.frame;
  }
  return Object.freeze(out);
}

function canonicaliseInputForWrite(
  input: RecordedCharacterInput,
  frameIdx: number,
  playerIdx: number,
): RecordedCharacterInput {
  if (input === undefined || input === null || typeof input !== 'object') {
    throw new ReplayFileError(
      `serializeReplay: capturedFrames[${frameIdx}].inputs[${playerIdx}] ` +
        `must be an object`,
    );
  }
  if (
    typeof input.moveX !== 'number' ||
    !Number.isFinite(input.moveX) ||
    input.moveX < -1 ||
    input.moveX > 1
  ) {
    throw new ReplayFileError(
      `serializeReplay: capturedFrames[${frameIdx}].inputs[${playerIdx}].moveX ` +
        `must be a finite number in [-1, 1], got ${String(input.moveX)}`,
    );
  }
  if (
    typeof input.moveY !== 'number' ||
    !Number.isFinite(input.moveY) ||
    input.moveY < -1 ||
    input.moveY > 1
  ) {
    throw new ReplayFileError(
      `serializeReplay: capturedFrames[${frameIdx}].inputs[${playerIdx}].moveY ` +
        `must be a finite number in [-1, 1], got ${String(input.moveY)}`,
    );
  }
  if (typeof input.jump !== 'boolean') {
    throw new ReplayFileError(
      `serializeReplay: capturedFrames[${frameIdx}].inputs[${playerIdx}].jump ` +
        `must be a boolean`,
    );
  }
  if (typeof input.attack !== 'boolean') {
    throw new ReplayFileError(
      `serializeReplay: capturedFrames[${frameIdx}].inputs[${playerIdx}].attack ` +
        `must be a boolean`,
    );
  }
  if (typeof input.dropThrough !== 'boolean') {
    throw new ReplayFileError(
      `serializeReplay: capturedFrames[${frameIdx}].inputs[${playerIdx}].dropThrough ` +
        `must be a boolean`,
    );
  }
  return Object.freeze({
    moveX: input.moveX,
    moveY: input.moveY,
    jump: input.jump,
    attack: input.attack,
    dropThrough: input.dropThrough,
  });
}

function freezeMatchConfigForWrite(
  config: MatchConfig,
  rngSeed: number,
): MatchConfig {
  const players = Object.freeze(
    config.players.map((slot) =>
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
    mode: config.mode,
    stockCount: config.stockCount,
    ...(config.timeLimitSeconds !== undefined
      ? { timeLimitSeconds: config.timeLimitSeconds }
      : {}),
    stageId: config.stageId,
    players,
    rngSeed,
  });
}

function clampNotes(notes: string): string {
  if (typeof notes !== 'string') return '';
  // Trim leading/trailing whitespace; truncate to keep the header
  // bounded. 1024 chars is generous for a replay name + comment but
  // small enough that it cannot bloat the file header into the MB range.
  const trimmed = notes.trim();
  return trimmed.length > 1024 ? trimmed.slice(0, 1024) : trimmed;
}

// ---------------------------------------------------------------------------
// Internal — read-side parsers
// ---------------------------------------------------------------------------

function parseMetadata(raw: unknown): ReplayMetadata {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ReplayFileError(
      `Replay metadata must be an object — got ${describeJsonType(raw)}`,
    );
  }
  const m = raw as Record<string, unknown>;

  if (typeof m['recordedAt'] !== 'string' || m['recordedAt'].length === 0) {
    throw new ReplayFileError(
      `Replay metadata.recordedAt must be a non-empty ISO 8601 string`,
    );
  }
  const recordedAt = m['recordedAt'];
  if (Number.isNaN(Date.parse(recordedAt))) {
    throw new ReplayFileError(
      `Replay metadata.recordedAt is not a parseable date: ` +
        `${JSON.stringify(recordedAt)}`,
    );
  }

  const durationFrames = m['durationFrames'];
  if (
    typeof durationFrames !== 'number' ||
    !Number.isInteger(durationFrames) ||
    durationFrames < 0
  ) {
    throw new ReplayFileError(
      `Replay metadata.durationFrames must be a non-negative integer`,
    );
  }

  const fixedTimestepMs = m['fixedTimestepMs'];
  if (
    typeof fixedTimestepMs !== 'number' ||
    !Number.isFinite(fixedTimestepMs) ||
    fixedTimestepMs <= 0
  ) {
    throw new ReplayFileError(
      `Replay metadata.fixedTimestepMs must be a positive finite number`,
    );
  }

  const playerCount = m['playerCount'];
  if (
    typeof playerCount !== 'number' ||
    !Number.isInteger(playerCount) ||
    playerCount < 1 ||
    playerCount > 4
  ) {
    throw new ReplayFileError(
      `Replay metadata.playerCount must be an integer in [1, 4]`,
    );
  }

  if (typeof m['engineVersion'] !== 'string') {
    throw new ReplayFileError(
      `Replay metadata.engineVersion must be a string`,
    );
  }

  if (typeof m['notes'] !== 'string') {
    throw new ReplayFileError(
      `Replay metadata.notes must be a string`,
    );
  }

  return Object.freeze({
    recordedAt,
    durationFrames,
    fixedTimestepMs,
    playerCount,
    engineVersion: m['engineVersion'],
    notes: m['notes'],
  });
}

function parseMatchConfig(raw: unknown): MatchConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ReplayFileError(
      `Replay matchConfig must be an object — got ${describeJsonType(raw)}`,
    );
  }
  const c = raw as Record<string, unknown>;

  const mode = c['mode'];
  if (mode !== 'stocks' && mode !== 'time') {
    throw new ReplayFileError(
      `Replay matchConfig.mode must be 'stocks' | 'time', got ` +
        `${JSON.stringify(mode)}`,
    );
  }

  const stockCount = c['stockCount'];
  if (
    typeof stockCount !== 'number' ||
    !Number.isInteger(stockCount) ||
    stockCount < 0 ||
    stockCount > 99
  ) {
    throw new ReplayFileError(
      `Replay matchConfig.stockCount must be an integer in [0, 99]`,
    );
  }

  let timeLimitSeconds: number | undefined;
  if (c['timeLimitSeconds'] !== undefined) {
    const t = c['timeLimitSeconds'];
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) {
      throw new ReplayFileError(
        `Replay matchConfig.timeLimitSeconds must be a non-negative finite ` +
          `number when present`,
      );
    }
    timeLimitSeconds = t;
  }

  if (typeof c['stageId'] !== 'string' || c['stageId'].length === 0) {
    throw new ReplayFileError(
      `Replay matchConfig.stageId must be a non-empty string`,
    );
  }

  if (
    !Array.isArray(c['players']) ||
    (c['players'] as unknown[]).length < 1 ||
    (c['players'] as unknown[]).length > 4
  ) {
    throw new ReplayFileError(
      `Replay matchConfig.players must contain 1..4 entries`,
    );
  }
  const playersRaw = c['players'] as unknown[];
  const players: PlayerSlot[] = new Array(playersRaw.length);
  for (let i = 0; i < playersRaw.length; i += 1) {
    players[i] = parsePlayerSlot(playersRaw[i], i);
  }

  const rngSeed = parseRngSeed(c['rngSeed']);

  const built: MatchConfig = {
    mode: mode as MatchMode,
    stockCount,
    ...(timeLimitSeconds !== undefined ? { timeLimitSeconds } : {}),
    stageId: c['stageId'],
    players: Object.freeze(players),
    rngSeed,
  };
  return Object.freeze(built);
}

function parsePlayerSlot(raw: unknown, idx: number): PlayerSlot {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ReplayFileError(
      `Replay matchConfig.players[${idx}] must be an object`,
    );
  }
  const s = raw as Record<string, unknown>;
  const index = s['index'];
  if (index !== 1 && index !== 2 && index !== 3 && index !== 4) {
    throw new ReplayFileError(
      `Replay matchConfig.players[${idx}].index must be 1..4`,
    );
  }
  if (typeof s['characterId'] !== 'string' || s['characterId'].length === 0) {
    throw new ReplayFileError(
      `Replay matchConfig.players[${idx}].characterId must be a non-empty string`,
    );
  }
  const paletteIndex = s['paletteIndex'];
  if (
    typeof paletteIndex !== 'number' ||
    !Number.isInteger(paletteIndex) ||
    paletteIndex < 0 ||
    paletteIndex > 7
  ) {
    throw new ReplayFileError(
      `Replay matchConfig.players[${idx}].paletteIndex must be 0..7`,
    );
  }
  if (typeof s['inputType'] !== 'string' || s['inputType'].length === 0) {
    throw new ReplayFileError(
      `Replay matchConfig.players[${idx}].inputType must be a non-empty string`,
    );
  }
  let aiDifficulty: PlayerSlot['aiDifficulty'];
  if (s['aiDifficulty'] !== undefined) {
    const d = s['aiDifficulty'];
    if (d !== 'easy' && d !== 'medium' && d !== 'hard') {
      throw new ReplayFileError(
        `Replay matchConfig.players[${idx}].aiDifficulty must be ` +
          `'easy' | 'medium' | 'hard' when present`,
      );
    }
    aiDifficulty = d;
  }
  return Object.freeze({
    index,
    characterId: s['characterId'] as PlayerSlot['characterId'],
    paletteIndex,
    inputType: s['inputType'] as PlayerSlot['inputType'],
    ...(aiDifficulty !== undefined ? { aiDifficulty } : {}),
  });
}

function parseRngSeed(raw: unknown): number {
  if (
    typeof raw !== 'number' ||
    !Number.isFinite(raw) ||
    !Number.isInteger(raw) ||
    raw < 0 ||
    raw > 0xffffffff
  ) {
    throw new ReplayFileError(
      `Replay rngSeed must be an integer in [0, 0xffffffff], got ` +
        `${String(raw)}`,
    );
  }
  return raw >>> 0;
}

function parseInputTimeline(
  raw: unknown,
  expectedPlayerCount: number,
): ReplayInputTimeline {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ReplayFileError(
      `Replay inputTimeline must be an object — got ${describeJsonType(raw)}`,
    );
  }
  const t = raw as Record<string, unknown>;
  const playerCount = t['playerCount'];
  if (
    typeof playerCount !== 'number' ||
    !Number.isInteger(playerCount) ||
    playerCount < 1 ||
    playerCount > 4
  ) {
    throw new ReplayFileError(
      `Replay inputTimeline.playerCount must be an integer in [1, 4]`,
    );
  }
  if (playerCount !== expectedPlayerCount) {
    throw new ReplayFileError(
      `Replay inputTimeline.playerCount (${playerCount}) does not match ` +
        `matchConfig.players.length (${expectedPlayerCount})`,
    );
  }

  if (!Array.isArray(t['entries'])) {
    throw new ReplayFileError(
      `Replay inputTimeline.entries must be an array`,
    );
  }
  const entriesRaw = t['entries'] as unknown[];
  const entries: SerializedCapturedFrame[] = new Array(entriesRaw.length);
  let prev = -1;
  for (let i = 0; i < entriesRaw.length; i += 1) {
    const e = entriesRaw[i];
    if (e === null || typeof e !== 'object' || Array.isArray(e)) {
      throw new ReplayFileError(
        `Replay inputTimeline.entries[${i}] must be an object`,
      );
    }
    const obj = e as Record<string, unknown>;
    const frame = obj['frame'];
    if (typeof frame !== 'number' || !Number.isInteger(frame) || frame < 0) {
      throw new ReplayFileError(
        `Replay inputTimeline.entries[${i}].frame must be a non-negative ` +
          `integer`,
      );
    }
    if (frame <= prev) {
      throw new ReplayFileError(
        `Replay inputTimeline.entries[${i}].frame (${frame}) is not strictly ` +
          `greater than previous frame (${prev}) — frames must be monotonic`,
      );
    }
    if (!Array.isArray(obj['inputs']) ||
        (obj['inputs'] as unknown[]).length !== playerCount) {
      throw new ReplayFileError(
        `Replay inputTimeline.entries[${i}].inputs must contain exactly ` +
          `${playerCount} entries`,
      );
    }
    const inputsRaw = obj['inputs'] as unknown[];
    const inputs: RecordedCharacterInput[] = new Array(playerCount);
    for (let p = 0; p < playerCount; p += 1) {
      inputs[p] = parseRecordedInput(inputsRaw[p], i, p);
    }
    entries[i] = Object.freeze({
      frame,
      inputs: Object.freeze(inputs),
    });
    prev = frame;
  }

  return Object.freeze({
    playerCount,
    entries: Object.freeze(entries),
  });
}

function parseRecordedInput(
  raw: unknown,
  frameIdx: number,
  playerIdx: number,
): RecordedCharacterInput {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ReplayFileError(
      `Replay inputTimeline.entries[${frameIdx}].inputs[${playerIdx}] must ` +
        `be an object`,
    );
  }
  const i = raw as Record<string, unknown>;
  const moveX = i['moveX'];
  if (
    typeof moveX !== 'number' ||
    !Number.isFinite(moveX) ||
    moveX < -1 ||
    moveX > 1
  ) {
    throw new ReplayFileError(
      `Replay inputTimeline.entries[${frameIdx}].inputs[${playerIdx}].moveX ` +
        `must be a finite number in [-1, 1]`,
    );
  }
  const moveY = i['moveY'];
  if (
    typeof moveY !== 'number' ||
    !Number.isFinite(moveY) ||
    moveY < -1 ||
    moveY > 1
  ) {
    throw new ReplayFileError(
      `Replay inputTimeline.entries[${frameIdx}].inputs[${playerIdx}].moveY ` +
        `must be a finite number in [-1, 1]`,
    );
  }
  const jump = i['jump'];
  if (typeof jump !== 'boolean') {
    throw new ReplayFileError(
      `Replay inputTimeline.entries[${frameIdx}].inputs[${playerIdx}].jump ` +
        `must be a boolean`,
    );
  }
  const attack = i['attack'];
  if (typeof attack !== 'boolean') {
    throw new ReplayFileError(
      `Replay inputTimeline.entries[${frameIdx}].inputs[${playerIdx}].attack ` +
        `must be a boolean`,
    );
  }
  const dropThrough = i['dropThrough'];
  if (typeof dropThrough !== 'boolean') {
    throw new ReplayFileError(
      `Replay inputTimeline.entries[${frameIdx}].inputs[${playerIdx}].dropThrough ` +
        `must be a boolean`,
    );
  }
  return Object.freeze({
    moveX,
    moveY,
    jump,
    attack,
    dropThrough,
  });
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function describeJsonType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// ---------------------------------------------------------------------------
// Item-spawn event helpers (T3 items framework, AC 17)
// ---------------------------------------------------------------------------

/**
 * Validate + freeze a list of item-spawn events for the writer. Every
 * field is re-emitted explicitly (not spread from the input) so a
 * caller passing a wider object cannot smuggle unknown keys into the
 * replay file. Frame ordering is enforced **non-decreasing** — same
 * frame is allowed (a future burst-spawn mode emits multiple per
 * tick), but a frame below the previous one is rejected as a corrupt
 * log that would silently break replay determinism.
 */
function freezeItemSpawnEventsForWrite(
  events: ReadonlyArray<ItemSpawnEvent>,
): ReadonlyArray<ItemSpawnEvent> {
  if (!Array.isArray(events)) {
    throw new ReplayFileError(
      `serializeReplay: itemSpawnEvents must be an array`,
    );
  }
  const out: ItemSpawnEvent[] = new Array(events.length);
  let prev = -1;
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    if (e === undefined || e === null || typeof e !== 'object') {
      throw new ReplayFileError(
        `serializeReplay: itemSpawnEvents[${i}] must be an object`,
      );
    }
    if (!Number.isInteger(e.frame) || e.frame < 0) {
      throw new ReplayFileError(
        `serializeReplay: itemSpawnEvents[${i}].frame must be a ` +
          `non-negative integer, got ${String(e.frame)}`,
      );
    }
    if (e.frame < prev) {
      throw new ReplayFileError(
        `serializeReplay: itemSpawnEvents[${i}].frame (${e.frame}) is ` +
          `below previous frame (${prev}) — events must be non-decreasing`,
      );
    }
    if (typeof e.type !== 'string' || e.type.length === 0) {
      throw new ReplayFileError(
        `serializeReplay: itemSpawnEvents[${i}].type must be a non-empty string`,
      );
    }
    if (typeof e.x !== 'number' || !Number.isFinite(e.x)) {
      throw new ReplayFileError(
        `serializeReplay: itemSpawnEvents[${i}].x must be a finite number`,
      );
    }
    if (typeof e.y !== 'number' || !Number.isFinite(e.y)) {
      throw new ReplayFileError(
        `serializeReplay: itemSpawnEvents[${i}].y must be a finite number`,
      );
    }
    if (!Number.isInteger(e.anchorIndex) || e.anchorIndex < -1) {
      throw new ReplayFileError(
        `serializeReplay: itemSpawnEvents[${i}].anchorIndex must be an ` +
          `integer >= -1, got ${String(e.anchorIndex)}`,
      );
    }
    out[i] = Object.freeze({
      frame: e.frame,
      type: e.type,
      x: e.x,
      y: e.y,
      anchorIndex: e.anchorIndex,
    }) as ItemSpawnEvent;
    prev = e.frame;
  }
  return Object.freeze(out);
}

/**
 * Parse the on-disk `itemSpawnEvents` array. Identical validation
 * shape to {@link freezeItemSpawnEventsForWrite} but framed in
 * deserialise vocabulary so the error messages quote "Replay
 * itemSpawnEvents[N]…" — easier to track down a bad event in a saved
 * file than a writer-side error mid-test would be.
 *
 * Tolerates the field being absent (`undefined`) by returning an empty
 * frozen array. The caller's contract is that v2 files always have the
 * field; this leniency exists so a v1 → v2 migration that forgot to
 * add the array still loads, surfacing as an empty events list rather
 * than a crash. The migration in `replayMigrations.ts` always
 * backfills the field, so this branch is purely defensive.
 */
function parseItemSpawnEvents(raw: unknown): ReadonlyArray<ItemSpawnEvent> {
  if (raw === undefined || raw === null) {
    // Permissive default — see docstring above.
    return Object.freeze([]) as ReadonlyArray<ItemSpawnEvent>;
  }
  if (!Array.isArray(raw)) {
    throw new ReplayFileError(
      `Replay itemSpawnEvents must be an array — got ${describeJsonType(raw)}`,
    );
  }
  const out: ItemSpawnEvent[] = new Array(raw.length);
  let prev = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const r = raw[i];
    if (r === null || typeof r !== 'object' || Array.isArray(r)) {
      throw new ReplayFileError(
        `Replay itemSpawnEvents[${i}] must be an object`,
      );
    }
    const o = r as Record<string, unknown>;
    const frame = o['frame'];
    if (typeof frame !== 'number' || !Number.isInteger(frame) || frame < 0) {
      throw new ReplayFileError(
        `Replay itemSpawnEvents[${i}].frame must be a non-negative integer`,
      );
    }
    if (frame < prev) {
      throw new ReplayFileError(
        `Replay itemSpawnEvents[${i}].frame (${frame}) is below previous ` +
          `frame (${prev}) — events must be non-decreasing`,
      );
    }
    const type = o['type'];
    if (typeof type !== 'string' || type.length === 0) {
      throw new ReplayFileError(
        `Replay itemSpawnEvents[${i}].type must be a non-empty string`,
      );
    }
    const x = o['x'];
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      throw new ReplayFileError(
        `Replay itemSpawnEvents[${i}].x must be a finite number`,
      );
    }
    const y = o['y'];
    if (typeof y !== 'number' || !Number.isFinite(y)) {
      throw new ReplayFileError(
        `Replay itemSpawnEvents[${i}].y must be a finite number`,
      );
    }
    const anchorIndex = o['anchorIndex'];
    if (
      typeof anchorIndex !== 'number' ||
      !Number.isInteger(anchorIndex) ||
      anchorIndex < -1
    ) {
      throw new ReplayFileError(
        `Replay itemSpawnEvents[${i}].anchorIndex must be an integer >= -1`,
      );
    }
    out[i] = Object.freeze({
      frame,
      type,
      x,
      y,
      anchorIndex,
    }) as ItemSpawnEvent;
    prev = frame;
  }
  return Object.freeze(out);
}
