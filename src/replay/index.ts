/**
 * Replay module.
 *
 * Hybrid replay: per-frame input log + full-state snapshots every
 * 300 frames. VCR controls (play / pause / step / scrub / speed)
 * land in M4.
 *
 * AC 30001 Sub-AC 1: {@link replayTypes} (re-exported below) is the
 * dedicated home for the serializable replay schema — constants,
 * per-frame input format, top-level `ReplayFile` shape, metadata
 * fields. Validator and writer code lives in `./ReplayFile`; pure
 * consumers can `import type` the schema without pulling in the
 * (de)serialiser.
 *
 * AC 30002 Sub-AC 2: {@link InputCaptureBuffer} is the deterministic
 * core that records every active player's `CharacterInput` snapshot
 * every fixed physics frame, keyed by frame number. The match scene
 * captures into this buffer once per fixed step; the (later-AC) M4
 * replay player feeds it back into the live `Character.applyInput`
 * pipeline to reproduce a fight bit-for-bit.
 *
 * AC 30003 Sub-AC 3: {@link serializeReplay} / {@link deserializeReplay}
 * — the on-disk schema (`ReplayFile`) and JSON round-trip helpers that
 * persist a finished match (config + RNG seed + input timeline +
 * metadata) to a saveable file. The replay player feeds the parsed
 * `ReplayFile` straight into `initialiseMatchRngFromConfig` and an
 * `InputCaptureBuffer` to reconstruct the fight bit-for-bit.
 */

export {
  InputCaptureBuffer,
  NEUTRAL_INPUT,
} from './InputCaptureBuffer';
export type {
  CapturedFrame,
  InputCaptureBufferOptions,
  PlayerIndex,
  RecordedCharacterInput,
} from './InputCaptureBuffer';

export {
  REPLAY_FORMAT_MAGIC,
  REPLAY_FORMAT_VERSION,
  REPLAY_FILE_EXTENSION,
  ReplayFileError,
  serializeReplay,
  serializeReplayToString,
  deserializeReplay,
  deserializeReplayFromString,
} from './ReplayFile';
export type {
  ReplayFile,
  ReplayMetadata,
  ReplayInputTimeline,
  SerializedCapturedFrame,
  SerializeReplayOptions,
} from './ReplayFile';

// AC 30103 Sub-AC 3 — schema versioning + migration handlers.
//
// The replay loader now walks older payloads through a registered
// migration chain before validation. Consumers (the M4 replay menu,
// headless tooling) can introspect the chain via these exports without
// pulling in the parser code.
export {
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
export type {
  ReplayMigration,
  ReplayVersionStatus,
  ReplayVersionUnsupportedKind,
} from './replayMigrations';

export {
  RecordingController,
  DEFAULT_REPLAY_FILE_NAME,
} from './RecordingController';
export type {
  RecordingPhase,
  StartRecordingOptions,
  RecordingControllerOptions,
  RecordingStatus,
} from './RecordingController';

// AC 30201 Sub-AC 1 — replay playback controller.
//
// The mirror image of `RecordingController`: loads a deserialised
// `ReplayFile` and feeds its input timeline back into the deterministic
// match simulator one fixed frame at a time, replacing the live
// keyboard / gamepad / AI input source. Random-access lookups
// (`sampleFrame` / `samplePlayer`) and cursor walks (`advance` / `seek`)
// are both supported so later sub-ACs (VCR pause / step / scrub /
// speed) can plug into the same lifecycle.
export {
  ReplayPlaybackController,
} from './ReplayPlaybackController';
export type {
  ReplayPlaybackPhase,
  ReplayPlaybackOptions,
  ReplayPlaybackStatus,
} from './ReplayPlaybackController';

// AC 30302 Sub-AC 2 — playback simulation state manager.
//
// The cadence brain that sits one layer above `ReplayPlaybackController`
// and decides *when* the next recorded frame should be fed: pause /
// resume, slow-motion at configurable rates (0.25x / 0.5x), fast-
// forward (2.0x), and explicit single-frame-advance step requests. The
// replay scene's per-rAF tick converts wall-clock dt into an integer
// count of fixed simulation steps via `tickFromDelta()` without ever
// rescaling the fixed timestep itself, preserving deterministic
// physics state across rate changes.
export {
  PlaybackSimulationStateManager,
  PLAYBACK_TIME_SCALE,
  PLAYBACK_TIME_SCALE_ORDER,
  MIN_PLAYBACK_TIME_SCALE,
  MAX_PLAYBACK_TIME_SCALE,
} from './PlaybackSimulationStateManager';
export type {
  PlaybackSimulationPhase,
  PlaybackSimulationStateOptions,
  PlaybackSimulationStatus,
  PlaybackTimeScalePreset,
} from './PlaybackSimulationStateManager';

export {
  REPLAY_MIME_TYPE,
  DownloadReplayUnsupportedError,
  downloadReplayFile,
} from './downloadReplay';
export type {
  DownloadReplayOptions,
  DownloadReplayResult,
} from './downloadReplay';

// AC 30101 Sub-AC 1 — replay persistence layer + IndexedDB wrapper.
//
// `ReplayStorage` is the shared interface; `openReplayStorage` is the
// runtime-probing factory; `IndexedDBReplayStorage` is the primary
// browser-backed implementation. Higher-level UI (the replay menu landing
// later in M4) imports straight from `./replay` without having to know
// which backend file the type lives in.
export {
  ReplayStorageError,
  ReplayStorageQuotaExceededError,
  ReplayNotFoundError,
  ReplayCorruptedError,
  MemoryReplayStorage,
  openReplayStorage,
  utf8ByteLength,
  serializeReplayForStorage,
  buildStoredReplayMetadata,
  validateReplayForWrite,
  computeReplayPayloadChecksum,
  assertReplayPayloadIntegrity,
  defaultIdFactory,
  isQuotaExceededError,
} from './ReplayStorage';

// AC 30104 Sub-AC 4 — replay integrity checksum.
//
// Pure deterministic hash + verification helpers + the integrity error
// type. Re-exported here so consumers (the replay menu, headless
// diagnostics tools) can import the integrity primitives alongside the
// storage primitives without touching the dedicated module directly.
export {
  CHECKSUM_ALGORITHM,
  CHECKSUM_HEX_LENGTH,
  ReplayIntegrityError,
  computeReplayChecksum,
  verifyReplayChecksum,
  isReplayChecksumValid,
  isWellFormedChecksum,
} from './replayChecksum';
export type { ReplayChecksumAlgorithm } from './replayChecksum';

// AC 30304 Sub-AC 4 — frame-advance stepper.
//
// Single-step coordinator for the M4 VCR overlay's "Frame advance"
// button (and `F` keyboard shortcut). One trigger advances the
// simulation by exactly one fixed timestep, with input replay and
// physics step in lockstep — `playback.advance()` (consume inputs +
// post-increment cursor) and the host's `stepPhysics(fixedTimestepMs)`
// callback are paired in a single atomic operation, so the cursor
// never drifts past the simulator (or vice versa) by even one frame.
// Default policy refuses to step while the
// `PlaybackSimulationStateManager` is in its 'playing' phase — frame-
// advance is meaningless while the cursor is already advancing every
// tick — and refuses past the end of the replay.
export {
  FrameAdvanceStepper,
  FRAME_ADVANCE_EMPTY_STATS,
} from './FrameAdvanceStepper';
export type {
  FrameAdvanceApplyInputsFn,
  FrameAdvanceStepPhysicsFn,
  FrameAdvanceStepperOptions,
  FrameAdvanceResult,
  FrameAdvanceStatus,
  FrameAdvanceStats,
} from './FrameAdvanceStepper';

// AC 30303 Sub-AC 3 — rewind controller (snapshot restore + input re-sim).
//
// The backwards-seek brain of the M4 replay player. Combines a sparse
// list of state snapshots (every 300 frames per the hybrid replay
// architecture) with the per-frame input timeline produced by
// `InputCaptureBuffer` to seek to an arbitrary target frame
// deterministically: pick the latest snapshot ≤ target, restore via the
// host's callback, then re-feed the input timeline forward to the
// target via the host's `simulateStep` callback. Two rewinds to the
// same target produce bit-identical simulator state.
export {
  RewindController,
  NEUTRAL_INPUT as REWIND_NEUTRAL_INPUT,
} from './RewindController';
export type {
  RewindSnapshot,
  RewindControllerOptions,
  RewindResult,
  RewindStats,
  RewindInputSource,
  RestoreSnapshotFn,
  SimulateStepFn,
} from './RewindController';

// AC 30202 Sub-AC 2 — match-state checksum + playback divergence verifier.
//
// `stateChecksum` is the pure hash function that produces a 16-char
// hex digest of an in-memory match state snapshot (positions,
// velocities, damage, stocks, ...). It runs at the recorder's snapshot
// pins (every 300 frames per the hybrid replay architecture) and again
// during playback. `PlaybackChecksumVerifier` consumes the recorded
// pin list and the live per-step snapshots, computes the live hash,
// compares against the recorded hash, and logs frame-level divergence
// points so the M4 replay menu can surface "this replay desyncs at
// frame N" without halting playback.
export {
  STATE_CHECKSUM_ALGORITHM,
  STATE_CHECKSUM_HEX_LENGTH,
  StateChecksumError,
  buildStateChecksumRecord,
  computeStateChecksum,
  isWellFormedStateChecksumRecord,
  serializeStateForChecksum,
} from './stateChecksum';
export type {
  MatchStateSnapshot,
  StateChecksumAlgorithm,
  StateChecksumRecord,
  StateFighterSnapshot,
} from './stateChecksum';

export {
  PlaybackChecksumVerifier,
  formatDivergenceMessage,
} from './PlaybackChecksumVerifier';
export type {
  DivergenceEntry,
  DivergenceLogger,
  PlaybackChecksumVerifierOptions,
  VerificationOutcome,
  VerificationResult,
  VerifierStats,
} from './PlaybackChecksumVerifier';

// AC 30203 Sub-AC 3 — desync recovery + reporting controller.
//
// `DesyncRecoveryController` sits one layer above
// `PlaybackChecksumVerifier`: it ingests the verifier's per-frame
// `VerificationResult` outputs and applies a configurable
// `DesyncTolerancePolicy` to decide whether playback should halt or
// continue. The structured `DesyncReport` it accumulates is the data
// contract the M4 desync overlay (`ui/DesyncReportOverlay.ts`)
// renders.
export { DesyncRecoveryController } from './DesyncRecoveryController';
export type {
  DesyncTolerancePolicy,
  DesyncRecoveryDecision,
  DesyncReport,
  DesyncReportStatus,
  DesyncReportVerdict,
  DesyncDiffSummaryEntry,
  DesyncRecoveryControllerOptions,
} from './DesyncRecoveryController';
export type {
  ReplayStorage,
  ReplayStorageId,
  ReplayStorageBackend,
  ReplayStorageOptions,
  OpenReplayStorageOptions,
  ReplayStorageStats,
  SaveReplayOptions,
  StoredReplay,
  StoredReplayMetadata,
} from './ReplayStorage';

export {
  IndexedDBReplayStorage,
  IDB_DB_NAME,
  IDB_DB_VERSION,
  IDB_STORE_REPLAYS,
  IDB_STORE_METADATA,
} from './IndexedDBReplayStorage';

export {
  LocalStorageReplayStorage,
  LS_DEFAULT_PREFIX,
  LS_INDEX_SUFFIX,
  LS_META_SUFFIX,
  LS_DATA_SUFFIX,
} from './LocalStorageReplayStorage';

// AC 30102 Sub-AC 2 — high-level CRUD façade.
//
// `ReplayLibrary` is the user-facing service the M4 replay menu and
// post-match "Save Replay" button talk to. Wraps `openReplayStorage` to
// expose exactly the four CRUD methods named in the AC (`save`, `load`,
// `list`, `delete`) and quietly falls back from IndexedDB to localStorage
// when the browser refuses to open IDB.
export { ReplayLibrary } from './ReplayLibrary';
export type {
  ReplayLibraryOptions,
  ReplayLibraryStats,
} from './ReplayLibrary';
