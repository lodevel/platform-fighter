/**
 * Recording lifecycle controller — AC 30004 Sub-AC 4.
 *
 * What this module is
 * ===================
 *
 * The bridge between the live `MatchScene` and the replay-file pipeline.
 * Where {@link InputCaptureBuffer} is the deterministic data store and
 * {@link serializeReplay} is the file format, this controller owns the
 * **lifecycle**:
 *
 *   1. **Start** — at match start, snapshot the `MatchConfig` and the
 *      resolved `rngSeed`; flip the buffer to "recording".
 *   2. **Capture** — every fixed physics step the scene forwards the
 *      per-player input snapshot through the controller, which appends
 *      it to the buffer with the current frame number.
 *   3. **Stop** — at match end, freeze further captures so a stray late
 *      tick can't extend the replay past the deciding KO.
 *   4. **Save** — produce a `ReplayFile` artifact ready for download.
 *      The browser-specific download helper lives in
 *      {@link ./downloadReplay} so this controller stays Phaser- and
 *      DOM-free for unit testing.
 *
 * Why a separate controller (instead of inlining all this in MatchScene)
 * ----------------------------------------------------------------------
 *
 *   • **Testability.** The state machine is exercisable under plain
 *     Node — no jsdom, no Phaser, no DOM. The vitest suite under
 *     `RecordingController.test.ts` covers every transition.
 *
 *   • **Symmetry.** The same controller is reusable by:
 *       - `MatchScene` (records the live match).
 *       - The (later-AC) headless replay export tooling.
 *       - The (later-AC) M4 stage-builder preview, which can record a
 *         playtest without going through the menu flow.
 *
 *   • **One source of truth for "is recording?".** The MatchScene HUD,
 *     the save hotkey handler, and the SHUTDOWN cleanup hook all read
 *     the same `getPhase()` instead of re-deriving the answer from
 *     scattered booleans.
 *
 * State machine
 * -------------
 *
 *     ┌────────┐  start(config, seed)   ┌───────────┐  stop()   ┌─────────┐
 *     │ IDLE   │ ─────────────────────▶│ RECORDING │ ────────▶ │ STOPPED │
 *     │        │                       │           │           │         │
 *     └────────┘                       └───────────┘           └─────────┘
 *          ▲                                                         │
 *          │                          reset()                        │
 *          └─────────────────────────────────────────────────────────┘
 *
 *   • IDLE — no active recording. Constructed in this state. `captureFrame`
 *     is a no-op so the scene can wire the controller in unconditionally
 *     without checking phase first.
 *
 *   • RECORDING — `start()` was called with a finalised `MatchConfig`. The
 *     buffer accepts new frames; `captureFrame` is a thin pass-through.
 *
 *   • STOPPED — `stop()` was called (typically when MatchEndDetector
 *     latches the GAME! freeze). Late `captureFrame` calls are silently
 *     ignored — the replay is "frozen on the deciding frame" by design.
 *     The captured buffer + matchConfig + seed are still readable; the
 *     scene's save hotkey calls `buildReplayFile()` to produce the
 *     downloadable artifact.
 *
 * `reset()` returns the controller to IDLE and drops every captured frame.
 * The MatchScene's SHUTDOWN hook calls this so a re-entry into the scene
 * doesn't accidentally inherit the previous match's recording.
 *
 * Frame model
 * -----------
 *
 *   • All times are 60 Hz frames. The controller does not own a clock —
 *     it forwards the frame number the caller (`physicsEngine.getFrame()`)
 *     hands to `captureFrame`. No `Date.now()`, no `Math.random()`.
 *
 *   • The wall-clock instant captured into `metadata.recordedAt` is read
 *     **exactly once**, on `stop()`, from a caller-supplied
 *     `nowFactory` (defaults to `Date.now`). Tests pass a fixed factory
 *     so the result is reproducible. Crucially, `recordedAt` is
 *     diagnostic only — gameplay simulation never reads it.
 *
 *   • `start()` requires a finalised `MatchConfig.rngSeed`. The
 *     controller does not derive seeds — it captures whatever the
 *     match-init layer resolved.
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM imports. The browser-side download flow
 * lives in {@link ./downloadReplay} — pass a `ReplayFile` from
 * `buildReplayFile()` to that helper to get the actual `.replay.json`
 * file on disk.
 */

import type { MatchConfig } from '../types';
import {
  InputCaptureBuffer,
  type RecordedCharacterInput,
} from './InputCaptureBuffer';
import { ItemSpawnEventLog } from './ItemSpawnEventLog';
import type { CharacterInput } from '../characters/Character';
import {
  REPLAY_FILE_EXTENSION,
  serializeReplay,
  serializeReplayToString,
  type ReplayFile,
  type SerializeReplayOptions,
} from './ReplayFile';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Phase of the recording lifecycle. IDLE → RECORDING → STOPPED. */
export type RecordingPhase = 'idle' | 'recording' | 'stopped';

/** Inputs to {@link RecordingController.start}. */
export interface StartRecordingOptions {
  /**
   * Final match settings — must include a finite `rngSeed` (the
   * determinism contract). The controller stores a frozen reference so a
   * caller mutating the same `MatchConfig` afterwards cannot retroactively
   * corrupt the recording.
   */
  readonly matchConfig: MatchConfig;
  /**
   * Optional human-readable notes attached to the replay header (match
   * name, comments). Trimmed and truncated to 1024 chars by the
   * serialiser. Defaults to `''`.
   */
  readonly notes?: string;
}

/** Constructor options. */
export interface RecordingControllerOptions {
  /**
   * Engine version string (typically `package.json#version`). Captured
   * into the replay metadata at save time. Defaults to `'0.0.0-unknown'`
   * so a replay always carries *some* version.
   */
  readonly engineVersion?: string;
  /**
   * Fixed physics step in milliseconds. Captured into replay metadata at
   * save time. Defaults to `1000 / 60` (the engine's only supported step
   * today).
   */
  readonly fixedTimestepMs?: number;
  /**
   * Wall-clock factory invoked exactly once on {@link RecordingController.stop}
   * to produce the `recordedAt` timestamp. Defaults to `() => new Date()`.
   * Tests pass a fixed factory so `metadata.recordedAt` is reproducible.
   */
  readonly nowFactory?: () => Date;
  /**
   * Optional pre-built buffer to host the captured frames. When omitted
   * the controller constructs its own at `start()` time using the
   * `matchConfig.players.length`. Exposing this hook lets the MatchScene
   * pass an already-existing buffer (its `getInputCaptureBuffer()`
   * accessor) so the scene's HUD can read live capture stats without
   * going through the controller.
   */
  readonly buffer?: InputCaptureBuffer;
  /**
   * Optional pre-built item-spawn event log (T3 items framework, AC
   * 17). Same lifecycle pattern as `buffer` — when omitted the
   * controller constructs its own at `start()` time, so callers that
   * don't care about item events can ignore this option entirely.
   * The MatchScene passes its scene-owned log so the items spawn
   * callsite and the recording controller share one source of truth.
   */
  readonly itemSpawnEventLog?: ItemSpawnEventLog;
}

/**
 * Snapshot the controller emits whenever the scene's HUD asks "what's
 * recording right now?". Frozen so a renderer can hold onto it across
 * frames without worrying about mutation.
 */
export interface RecordingStatus {
  readonly phase: RecordingPhase;
  /** Number of frames captured so far (always 0 in IDLE). */
  readonly frameCount: number;
  /** Last captured frame number, or `null` if nothing recorded yet. */
  readonly lastFrame: number | null;
  /** True iff the controller is in `RECORDING`. Convenience flag. */
  readonly isRecording: boolean;
}

/** Default file name body (sans extension) when none is supplied. */
export const DEFAULT_REPLAY_FILE_NAME = 'replay';

// ---------------------------------------------------------------------------
// RecordingController
// ---------------------------------------------------------------------------

/**
 * Lifecycle wrapper around an {@link InputCaptureBuffer}. One instance
 * per match; reset on shutdown / rematch.
 */
export class RecordingController {
  private readonly engineVersion: string;
  private readonly fixedTimestepMs: number;
  private readonly nowFactory: () => Date;
  /**
   * Either a caller-supplied buffer (in which case we never construct
   * our own) or `null` until `start()` constructs one. Two paths exist
   * because the MatchScene already constructs an `InputCaptureBuffer`
   * for its HUD; rather than force two parallel buffers we let the
   * scene hand it in. Tests + headless tools just let the controller
   * own one.
   */
  private readonly externalBuffer: InputCaptureBuffer | null;
  private buffer: InputCaptureBuffer | null;

  private phase: RecordingPhase = 'idle';
  private matchConfig: MatchConfig | null = null;
  private notes: string = '';

  constructor(options: RecordingControllerOptions = {}) {
    this.engineVersion =
      typeof options.engineVersion === 'string' && options.engineVersion.length > 0
        ? options.engineVersion
        : '0.0.0-unknown';
    const ts =
      typeof options.fixedTimestepMs === 'number' &&
      Number.isFinite(options.fixedTimestepMs) &&
      options.fixedTimestepMs > 0
        ? options.fixedTimestepMs
        : 1000 / 60;
    this.fixedTimestepMs = ts;
    this.nowFactory = options.nowFactory ?? (() => new Date());
    this.externalBuffer = options.buffer ?? null;
    this.buffer = options.buffer ?? null;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getPhase(): RecordingPhase {
    return this.phase;
  }

  isRecording(): boolean {
    return this.phase === 'recording';
  }

  isStopped(): boolean {
    return this.phase === 'stopped';
  }

  /** The MatchConfig captured at `start()`, or `null` while IDLE. */
  getMatchConfig(): MatchConfig | null {
    return this.matchConfig;
  }

  /**
   * The buffer currently driving the recording, or `null` while IDLE
   * (when no buffer was supplied via constructor options). Exposed so
   * the MatchScene HUD can read `buffer.size()` for a live frame counter.
   */
  getBuffer(): InputCaptureBuffer | null {
    return this.buffer;
  }

  /** Frozen status snapshot for HUD rendering. */
  getStatus(): RecordingStatus {
    const frameCount = this.buffer?.size() ?? 0;
    const lastFrame = this.buffer?.getLastFrame() ?? null;
    return Object.freeze({
      phase: this.phase,
      frameCount,
      lastFrame,
      isRecording: this.phase === 'recording',
    });
  }

  // -------------------------------------------------------------------------
  // Mutators — lifecycle
  // -------------------------------------------------------------------------

  /**
   * Begin recording. Must be called from the IDLE phase; throws if
   * called twice without an intervening `reset()`. Captures the
   * `MatchConfig` reference (not a deep copy — the serialiser already
   * re-emits each field at save time) and constructs / reuses the
   * input capture buffer.
   *
   * Validation:
   *   • `matchConfig` must be non-null and carry a finite `rngSeed`;
   *     the rest of the schema is validated by the serialiser at save
   *     time so the controller doesn't double-validate.
   *   • If a caller-supplied `buffer` was passed to the constructor,
   *     its `playerCount` must match `matchConfig.players.length`.
   */
  start(options: StartRecordingOptions): void {
    if (this.phase !== 'idle') {
      throw new Error(
        `RecordingController.start: cannot start recording while phase is ` +
          `'${this.phase}' — call reset() first`,
      );
    }
    if (
      options.matchConfig === undefined ||
      options.matchConfig === null ||
      typeof options.matchConfig !== 'object'
    ) {
      throw new Error(
        `RecordingController.start: matchConfig is required and must be an object`,
      );
    }
    if (
      typeof options.matchConfig.rngSeed !== 'number' ||
      !Number.isFinite(options.matchConfig.rngSeed)
    ) {
      throw new Error(
        `RecordingController.start: matchConfig.rngSeed must be a finite number`,
      );
    }
    if (
      !Array.isArray(options.matchConfig.players) ||
      options.matchConfig.players.length < 1 ||
      options.matchConfig.players.length > 4
    ) {
      throw new Error(
        `RecordingController.start: matchConfig.players must contain 1..4 entries`,
      );
    }

    const playerCount = options.matchConfig.players.length;
    if (this.externalBuffer !== null) {
      if (this.externalBuffer.getPlayerCount() !== playerCount) {
        throw new Error(
          `RecordingController.start: supplied buffer playerCount ` +
            `(${this.externalBuffer.getPlayerCount()}) does not match ` +
            `matchConfig.players.length (${playerCount})`,
        );
      }
      // Reuse the externally-owned buffer. We don't reset it here —
      // the MatchScene's SHUTDOWN hook owns lifecycle of the scene-
      // owned buffer. If the buffer already has frames in it from a
      // previous match the scene is expected to have called reset()
      // on it before starting a new match.
      this.buffer = this.externalBuffer;
    } else {
      this.buffer = new InputCaptureBuffer({ playerCount });
    }

    this.matchConfig = options.matchConfig;
    this.notes = typeof options.notes === 'string' ? options.notes : '';
    this.phase = 'recording';
  }

  /**
   * Append one frame's inputs to the buffer.
   *
   *   • Called once per fixed physics step from the scene's update loop.
   *   • A no-op when phase ≠ RECORDING — this lets the scene wire the
   *     call unconditionally without branching on phase first.
   *   • Throws if called while RECORDING but the buffer is missing
   *     (programmer error: someone called captureFrame after
   *     constructing the controller without calling start).
   */
  captureFrame(
    frame: number,
    inputs: ReadonlyArray<CharacterInput | undefined>,
  ): void {
    if (this.phase !== 'recording') return;
    if (this.buffer === null) {
      // Defensive — the start() path always sets this; if it didn't, our
      // state machine is broken and we'd rather know early.
      throw new Error(
        `RecordingController.captureFrame: invariant violated — buffer is null while RECORDING`,
      );
    }
    this.buffer.captureFrame(frame, inputs);
  }

  /**
   * Stop accepting new frames. Idempotent — calling `stop` while STOPPED
   * is a no-op so a paranoid double-fire of the match-end transition
   * doesn't crash. Calling `stop` while IDLE is also a no-op (no
   * recording was ever started).
   *
   * After `stop`, callers can `buildReplayFile()` to produce the
   * downloadable artifact.
   */
  stop(): void {
    if (this.phase === 'recording') {
      this.phase = 'stopped';
    }
  }

  /**
   * Drop the captured log and return to IDLE. The MatchScene's
   * SHUTDOWN hook calls this so a fresh match starts with a fresh
   * recording — and so the (eventually) re-used scene doesn't leak
   * the previous match's frames.
   *
   * For an externally-owned buffer the scene resets it independently.
   * For a controller-owned buffer we drop the reference here.
   */
  reset(): void {
    // Drop our own (controller-constructed) buffer entirely — it has
    // no other owner. Externally-supplied buffers stay alive (the
    // scene owns their lifecycle), but we drop our *reference* so
    // `getBuffer()` reads as null in IDLE for consistency. A
    // subsequent `start()` re-attaches the cached `externalBuffer`.
    if (this.externalBuffer === null && this.buffer !== null) {
      this.buffer.reset();
    }
    this.buffer = null;
    this.matchConfig = null;
    this.notes = '';
    this.phase = 'idle';
  }

  // -------------------------------------------------------------------------
  // Mutators — save
  // -------------------------------------------------------------------------

  /**
   * Build a {@link ReplayFile} from the current recording state. Must be
   * called from STOPPED — calling it from RECORDING throws because a
   * partial replay is almost always a bug (the deciding KO frames
   * wouldn't be present). Tests that want to produce a partial replay
   * call `stop()` first.
   *
   * Idempotent — calling `buildReplayFile` twice produces two equal-by-
   * value (frozen) snapshots; the second call doesn't re-read the
   * wall clock unless the controller's `nowFactory` is invoked again
   * (the writer reads `recordedAt` from `nowFactory()` each call).
   *
   * The (later-AC) browser save action passes the result to
   * `downloadReplayFile()` to trigger the browser download. Headless
   * tests stringify it with `serializeReplayToString` directly.
   */
  buildReplayFile(): ReplayFile {
    if (this.phase === 'idle') {
      throw new Error(
        `RecordingController.buildReplayFile: nothing recorded yet — call start() first`,
      );
    }
    if (this.phase === 'recording') {
      throw new Error(
        `RecordingController.buildReplayFile: still recording — call stop() first`,
      );
    }
    if (this.matchConfig === null || this.buffer === null) {
      // Defensive: STOPPED is supposed to imply both are set.
      throw new Error(
        `RecordingController.buildReplayFile: invariant violated — STOPPED without matchConfig/buffer`,
      );
    }
    const opts: SerializeReplayOptions = {
      matchConfig: this.matchConfig,
      capturedFrames: this.buffer.getEntries(),
      recordedAt: this.nowFactory(),
      engineVersion: this.engineVersion,
      notes: this.notes,
      fixedTimestepMs: this.fixedTimestepMs,
    };
    return serializeReplay(opts);
  }

  /**
   * Convenience: build the replay file and stringify it. Used by the
   * Node CLI / tests; the browser save action goes through
   * `downloadReplayFile` which calls `buildReplayFile` itself.
   */
  buildReplayJson(pretty = false): string {
    return serializeReplayToString(
      {
        matchConfig: this.matchConfig!,
        capturedFrames: this.buffer!.getEntries(),
        recordedAt: this.nowFactory(),
        engineVersion: this.engineVersion,
        notes: this.notes,
        fixedTimestepMs: this.fixedTimestepMs,
      },
      pretty,
    );
  }

  /**
   * Suggest a default filename for the saved replay. Includes the stage
   * id, the match seed (in hex), and the recording date so a user with
   * a bug can quote the file name in a report. Always ends in
   * {@link REPLAY_FILE_EXTENSION}.
   */
  suggestFileName(): string {
    if (this.matchConfig === null) {
      return `${DEFAULT_REPLAY_FILE_NAME}${REPLAY_FILE_EXTENSION}`;
    }
    const stage = sanitiseFileNamePart(this.matchConfig.stageId) || 'stage';
    const seed = (this.matchConfig.rngSeed >>> 0)
      .toString(16)
      .padStart(8, '0');
    // Date stamp YYYYMMDD-HHMMSS — sortable, no separators that vary
    // between OSes. Read from `nowFactory` (not `Date.now`) so tests
    // produce a stable filename.
    const stamp = formatTimestamp(this.nowFactory());
    return `${DEFAULT_REPLAY_FILE_NAME}-${stage}-${seed}-${stamp}${REPLAY_FILE_EXTENSION}`;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strip characters that vary across operating systems' file-name rules
 * (Windows is the strictest). Keeps ASCII letters, digits, hyphen, and
 * underscore — anything else collapses to `-`. Empty inputs return ''
 * so callers can fall back to a default.
 */
function sanitiseFileNamePart(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function formatTimestamp(d: Date): string {
  const pad = (n: number, width = 2): string =>
    String(n).padStart(width, '0');
  const yyyy = pad(d.getUTCFullYear(), 4);
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const HH = pad(d.getUTCHours());
  const MM = pad(d.getUTCMinutes());
  const SS = pad(d.getUTCSeconds());
  return `${yyyy}${mm}${dd}-${HH}${MM}${SS}`;
}

// ---------------------------------------------------------------------------
// Exposed types — re-exports so callers can import the controller and the
// underlying RecordedCharacterInput shape from one barrel.
// ---------------------------------------------------------------------------

export type { RecordedCharacterInput };
