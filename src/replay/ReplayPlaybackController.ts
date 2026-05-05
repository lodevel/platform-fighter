/**
 * Replay playback controller — AC 30201 Sub-AC 1.
 *
 * What this module is
 * ===================
 *
 * The mirror image of {@link ./RecordingController}. Where the recording
 * controller siphons live `CharacterInput` snapshots into an
 * {@link InputCaptureBuffer} once per fixed physics step, the *playback*
 * controller hosts a previously-saved {@link ReplayFile} and **feeds the
 * recorded inputs back into the deterministic match simulator one
 * fixed frame at a time**, replacing the live keyboard / gamepad / AI
 * input source for the duration of replay.
 *
 * It is the bridge between an on-disk `.replay.json` and the gameplay
 * scene's per-step `Character.applyInput` call.
 *
 *     ┌────────────┐      load(replay)      ┌─────────────┐
 *     │   IDLE     │ ─────────────────────▶ │   LOADED    │
 *     │            │                        │ (cursor at  │
 *     └────────────┘                        │  firstFrame)│
 *           ▲                               └──────┬──────┘
 *           │                                      │ start()
 *           │                                      ▼
 *           │                               ┌─────────────┐
 *           │                               │   PLAYING   │
 *           │     reset()                   │             │
 *           │                               └──────┬──────┘
 *           │                                      │ exhausts last frame
 *           │                                      ▼
 *           │                               ┌─────────────┐
 *           └────────────────────────────── │  FINISHED   │
 *                                           └─────────────┘
 *
 * Why a controller (instead of inlining lookups in MatchScene)
 * ------------------------------------------------------------
 *
 *   • **Symmetry with recording.** The match scene already calls into a
 *     {@link RecordingController} every fixed step. A matching playback
 *     controller is the obvious replacement when the scene's `mode` is
 *     `'replay'` instead of `'live'`. Both controllers expose
 *     `getMatchConfig()` / `getRngSeed()` so the scene's match-init path
 *     doesn't need to branch on which one it has.
 *
 *   • **Future-proof for VCR controls.** The Seed's M4 milestone calls
 *     for play / pause / step / scrub / speed. Sub-AC 1 (this module)
 *     lands the core load + frame-by-frame feed. Later sub-ACs (pause,
 *     rate control, scrubbing) plug into the same lifecycle —
 *     `pause()`/`resume()` toggle PLAYING ↔ PAUSED, `seek(frame)`
 *     teleports the cursor for scrubbing — without rewriting the
 *     loader. The state-machine slots and cursor primitives are
 *     present today; later sub-ACs only need to wire transitions.
 *
 *   • **Testability.** Phaser-free. The vitest suite under
 *     `ReplayPlaybackController.test.ts` runs under plain Node — no
 *     jsdom, no scene fixture.
 *
 * Determinism contract
 * --------------------
 *
 * Re-feeding a replay must reproduce the original match bit-for-bit.
 * To preserve that:
 *
 *   • Inputs are stored in an {@link InputCaptureBuffer}, the same
 *     primitive the recorder uses. Round-tripping through the buffer
 *     re-applies its closed-shape normalisation and frozen-entry
 *     guarantees, so a replay loaded from a hand-edited file can't
 *     smuggle a `null` `attack` flag through to `Character.applyInput`.
 *
 *   • The cursor advances strictly monotonically under `advance()`.
 *     Backward seeks via `seek()` are explicit and recorded as a phase
 *     transition (a backward seek out of `'finished'` returns to
 *     `'playing'`).
 *
 *   • No wall-clock reads, no `Math.random()`, no Phaser / DOM imports.
 *     The cursor is a plain integer; the buffer-backed input store is
 *     the same one the recorder produces.
 *
 *   • `sampleFrame(frame)` is byte-equal to the recorder's
 *     `getInputCaptureBuffer().getFrame(frame).inputs` reading the
 *     original buffer. The replay player drives the same simulation
 *     with the same inputs, so the deterministic engine produces the
 *     same physics state.
 *
 * Frame model
 * -----------
 *
 *   • All times are 60 Hz integer frames. Frames in a recorded
 *     timeline are strictly monotonic but need not be contiguous —
 *     {@link InputCaptureBuffer} explicitly allows gaps. The controller
 *     treats a missing frame as "no recorded input for that step";
 *     `sampleFrame(missing)` returns `null` so the caller can decide
 *     between "treat as neutral" (fault-tolerant playback) and "abort"
 *     (strict-determinism mode).
 *
 *   • The cursor starts at the first recorded frame (or `0` when the
 *     timeline is empty). `advance()` reads the inputs at the cursor
 *     and *then* moves the cursor forward one. When the cursor moves
 *     past the last recorded frame the controller transitions to
 *     `'finished'`.
 *
 *   • Empty timelines are valid (a zero-frame replay rejects nothing
 *     out of the box, but `advance()` immediately reports finished so
 *     the scene's match-end detector takes over).
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM imports. The actual file IO (loading a
 * `.replay.json` blob, parsing it through `deserializeReplay`) is the
 * caller's responsibility — typically the M4 replay menu, the headless
 * determinism harness, or a unit test fixture.
 */

import type { CharacterInput } from '../characters/Character';
import type { MatchConfig } from '../types';
import {
  InputCaptureBuffer,
  type CapturedFrame,
  type PlayerIndex,
  type RecordedCharacterInput,
} from './InputCaptureBuffer';
import type { ReplayFile } from './replayTypes';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Lifecycle phase of the playback controller. Compare the recorder's
 * `'idle' | 'recording' | 'stopped'` chain — this one is
 * `IDLE → LOADED → PLAYING → FINISHED`.
 *
 *   • IDLE — constructed (or freshly `reset()`-ed) but no replay loaded.
 *     Most query / mutation methods throw or return null in this phase.
 *   • LOADED — `load()` succeeded; the cursor is parked at the first
 *     recorded frame and the match-init layer can read
 *     `getMatchConfig()` / `getRngSeed()` to bootstrap the simulation.
 *     `start()` transitions LOADED → PLAYING.
 *   • PLAYING — frames are being fed via `advance()` / `sampleFrame()`.
 *     The scene's per-fixed-step loop calls into the controller in this
 *     phase. Auto-transitions to FINISHED once the cursor passes the
 *     last recorded frame.
 *   • FINISHED — the cursor is past `lastFrame`; further `advance()`
 *     calls return null. `seek()` to an in-range frame returns to
 *     PLAYING (later VCR sub-ACs use this for rewind).
 */
export type ReplayPlaybackPhase =
  | 'idle'
  | 'loaded'
  | 'playing'
  | 'finished';

/** Constructor / `load()` options. */
export interface ReplayPlaybackOptions {
  /**
   * Optional pre-deserialised replay to load immediately at construction.
   * When omitted the controller starts in IDLE — call `load()` later.
   */
  readonly replay?: ReplayFile;
  /**
   * Optional starting cursor position. Defaults to the first recorded
   * frame in `replay.inputTimeline.entries` (or `0` for an empty timeline).
   * Useful for tests that want to drop into the middle of a replay
   * without going through `seek()`.
   */
  readonly startFrame?: number;
}

/**
 * Frozen status snapshot, mirroring `RecordingController.getStatus()`.
 * The HUD / replay menu reads this once per render frame instead of
 * pulling individual fields.
 */
export interface ReplayPlaybackStatus {
  readonly phase: ReplayPlaybackPhase;
  /** Total number of recorded frames in the loaded timeline. */
  readonly frameCount: number;
  /** First recorded frame's number, or `null` when no replay is loaded. */
  readonly firstFrame: number | null;
  /** Last recorded frame's number, or `null` when no replay is loaded. */
  readonly lastFrame: number | null;
  /** The cursor's current frame. Always `0` when IDLE. */
  readonly currentFrame: number;
  /** Convenience flag — true iff `phase === 'playing'`. */
  readonly isPlaying: boolean;
  /** Convenience flag — true iff `phase === 'finished'`. */
  readonly isFinished: boolean;
}

// ---------------------------------------------------------------------------
// ReplayPlaybackController
// ---------------------------------------------------------------------------

/**
 * Plays back a previously-recorded {@link ReplayFile} by feeding its
 * input timeline back into the deterministic match simulator. One
 * instance per replay session; `reset()` returns it to IDLE so a
 * subsequent replay can be loaded without reconstructing.
 *
 * Lifecycle:
 *
 *   const c = new ReplayPlaybackController({ replay });
 *   // (or: const c = new ReplayPlaybackController(); c.load(replay);)
 *   c.start();
 *   while (!c.isFinished()) {
 *     const inputs = c.advance();
 *     if (inputs === null) break;
 *     for (let i = 0; i < inputs.length; i += 1) {
 *       fighters[i].applyInput(inputs[i]);
 *     }
 *     world.step(fixedTimestepMs);
 *   }
 */
export class ReplayPlaybackController {
  private phase: ReplayPlaybackPhase = 'idle';

  /**
   * The loaded replay, or null while IDLE. Held by reference (no deep
   * copy) — the file is supposed to be immutable. The serialiser /
   * deserialiser already produces a fresh object graph, so a caller
   * mutating the source after `load()` is misuse the controller does
   * not defend against.
   */
  private replay: ReplayFile | null = null;

  /**
   * Re-hydrated input store. We feed the timeline through an
   * {@link InputCaptureBuffer} (rather than walking
   * `replay.inputTimeline.entries` directly) for two reasons:
   *
   *   1. The buffer's monotonic-frame validation catches a
   *      hand-edited file with shuffled / duplicate frames at load time
   *      rather than at `advance()` time.
   *   2. The buffer's normalisation re-freezes every entry into the
   *      closed `RecordedCharacterInput` shape, so a deserialised file
   *      that managed to slip a `null` `attack` flag through schema
   *      validation gets coerced to `false` here — never reaches
   *      `Character.applyInput`.
   *
   * This makes playback inputs byte-identical to the buffer the
   * recorder produced, which is what the determinism contract
   * promises.
   */
  private buffer: InputCaptureBuffer | null = null;

  /** First recorded frame number, or `-1` while IDLE. */
  private firstFrame: number = -1;

  /**
   * Last recorded frame number, or `-1` while IDLE / for an empty
   * timeline. Cached on `load()` so `advance()` can detect end-of-
   * replay in O(1) without re-querying the buffer.
   */
  private lastFrame: number = -1;

  /**
   * Cursor — the next frame `advance()` will read from. Starts at
   * `firstFrame` after `load()`; `seek()` jumps it; `advance()`
   * post-increments it.
   */
  private currentFrame: number = 0;

  constructor(options: ReplayPlaybackOptions = {}) {
    if (options.replay !== undefined) {
      this.load(options.replay, options.startFrame);
    }
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * Load a deserialised {@link ReplayFile} into the controller.
   *
   * Validation:
   *   • Refuses to load while not IDLE — call `reset()` first. This
   *     guards against the menu silently overwriting an in-flight
   *     playback session.
   *   • The replay must be an object with an `inputTimeline.entries`
   *     array and a 1..4 `inputTimeline.playerCount`. Full schema
   *     validation lives in `deserializeReplay`; the controller only
   *     re-checks the fields it directly consumes so a caller that
   *     hand-built a `ReplayFile` (e.g. a test) gets a clear error
   *     rather than a deep stack trace from the buffer.
   *
   * On success the controller transitions to LOADED and the cursor is
   * parked at `startFrame` (defaulting to `firstFrame` from the
   * timeline). Call `start()` next to enter PLAYING.
   *
   * @param replay      Pre-deserialised replay file (typically the
   *                    output of `deserializeReplayFromString`).
   * @param startFrame  Optional cursor override; defaults to the
   *                    timeline's first recorded frame.
   */
  load(replay: ReplayFile, startFrame?: number): void {
    if (this.phase !== 'idle') {
      throw new Error(
        `ReplayPlaybackController.load: cannot load while phase is ` +
          `'${this.phase}' — call reset() first`,
      );
    }
    if (replay === null || typeof replay !== 'object') {
      throw new Error(
        `ReplayPlaybackController.load: replay must be a non-null object`,
      );
    }
    const timeline = replay.inputTimeline;
    if (
      timeline === null ||
      typeof timeline !== 'object' ||
      !Array.isArray(timeline.entries)
    ) {
      throw new Error(
        `ReplayPlaybackController.load: replay.inputTimeline.entries must be ` +
          `an array`,
      );
    }
    if (
      typeof timeline.playerCount !== 'number' ||
      !Number.isInteger(timeline.playerCount) ||
      timeline.playerCount < 1 ||
      timeline.playerCount > 4
    ) {
      throw new Error(
        `ReplayPlaybackController.load: replay.inputTimeline.playerCount ` +
          `must be an integer 1..4, got ${String(timeline.playerCount)}`,
      );
    }

    // Re-hydrate the timeline through an InputCaptureBuffer so the
    // monotonic-frame invariant is validated and every entry is
    // re-frozen into the closed RecordedCharacterInput shape. The
    // buffer's `captureFrame(frame, inputs)` accepts `CharacterInput`
    // (a superset of RecordedCharacterInput), so the
    // serialised-frame `inputs` array passes through unmodified
    // semantically — only field defaults and freezing are re-applied.
    const buffer = new InputCaptureBuffer({
      playerCount: timeline.playerCount,
    });
    for (const entry of timeline.entries) {
      if (
        entry === null ||
        typeof entry !== 'object' ||
        !Array.isArray(entry.inputs)
      ) {
        throw new Error(
          `ReplayPlaybackController.load: malformed timeline entry — every ` +
            `entry must have an inputs array`,
        );
      }
      // Defer to InputCaptureBuffer for monotonic / player-count
      // validation. A bad timeline throws here.
      buffer.captureFrame(
        entry.frame,
        entry.inputs as ReadonlyArray<CharacterInput>,
      );
    }

    this.replay = replay;
    this.buffer = buffer;

    if (timeline.entries.length === 0) {
      // Empty timeline: parked at frame 0 by convention but no inputs
      // available. `advance()` will go straight to FINISHED.
      this.firstFrame = -1;
      this.lastFrame = -1;
      this.currentFrame = 0;
    } else {
      this.firstFrame = timeline.entries[0]!.frame;
      this.lastFrame = timeline.entries[timeline.entries.length - 1]!.frame;
      this.currentFrame =
        startFrame !== undefined ? startFrame : this.firstFrame;
    }

    if (startFrame !== undefined) {
      if (!Number.isInteger(startFrame) || startFrame < 0) {
        throw new Error(
          `ReplayPlaybackController.load: startFrame must be a non-negative ` +
            `integer, got ${String(startFrame)}`,
        );
      }
    }

    this.phase = 'loaded';
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Transition LOADED → PLAYING. Idempotent in PLAYING (no-op). Throws
   * from IDLE (no replay loaded) or FINISHED (callers should `seek()`
   * back to a valid frame first, or `reset()` then re-load).
   */
  start(): void {
    if (this.phase === 'playing') return;
    if (this.phase !== 'loaded') {
      throw new Error(
        `ReplayPlaybackController.start: cannot start from phase ` +
          `'${this.phase}' — load() a replay first`,
      );
    }
    // An empty timeline starts directly into 'finished' — there is no
    // input to feed and the scene's match-end detector should take over
    // immediately.
    if (this.lastFrame === -1) {
      this.phase = 'finished';
      return;
    }
    this.phase = 'playing';
  }

  /**
   * Force-end playback. Idempotent — safe to call from any phase.
   * Used by the M4 replay menu's "stop" button. After `stop()` the
   * controller stays in FINISHED until `reset()` is called.
   */
  stop(): void {
    if (this.phase === 'idle') return;
    this.phase = 'finished';
  }

  /**
   * Drop the loaded replay and return to IDLE. Mirrors
   * `RecordingController.reset()` — the replay menu calls this after
   * the user closes a playback session so re-entry doesn't leak the
   * previous replay's cursor.
   */
  reset(): void {
    this.replay = null;
    if (this.buffer !== null) {
      this.buffer.reset();
      this.buffer = null;
    }
    this.firstFrame = -1;
    this.lastFrame = -1;
    this.currentFrame = 0;
    this.phase = 'idle';
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getPhase(): ReplayPlaybackPhase {
    return this.phase;
  }

  isLoaded(): boolean {
    return this.phase !== 'idle';
  }

  isPlaying(): boolean {
    return this.phase === 'playing';
  }

  isFinished(): boolean {
    return this.phase === 'finished';
  }

  /**
   * The loaded replay file, or null while IDLE. The match-init layer
   * reads `getReplay().matchConfig` / `getReplay().rngSeed` to
   * reconstruct the lobby state and seed the deterministic RNG.
   */
  getReplay(): ReplayFile | null {
    return this.replay;
  }

  /**
   * Convenience accessor for the replay's `MatchConfig`. The match
   * scene's data payload uses this to bootstrap the simulation.
   * Returns null while IDLE.
   */
  getMatchConfig(): MatchConfig | null {
    return this.replay?.matchConfig ?? null;
  }

  /**
   * Convenience accessor for the replay's RNG seed. Returns null
   * while IDLE. The match scene feeds this through
   * `initialiseMatchRngFromConfig` exactly as a live match does.
   */
  getRngSeed(): number | null {
    return this.replay?.rngSeed ?? null;
  }

  /**
   * Number of player slots in the loaded replay. Returns 0 while
   * IDLE. Mirrors the `InputCaptureBuffer.getPlayerCount()` shape.
   */
  getPlayerCount(): number {
    return this.buffer?.getPlayerCount() ?? 0;
  }

  /** Total number of recorded frames. Zero while IDLE / empty timeline. */
  getFrameCount(): number {
    return this.buffer?.size() ?? 0;
  }

  /** First recorded frame's index, or null while IDLE / empty timeline. */
  getFirstFrame(): number | null {
    return this.firstFrame === -1 ? null : this.firstFrame;
  }

  /** Last recorded frame's index, or null while IDLE / empty timeline. */
  getLastFrame(): number | null {
    return this.lastFrame === -1 ? null : this.lastFrame;
  }

  /**
   * Current cursor — the next frame `advance()` will read. Returns 0
   * while IDLE.
   */
  getCurrentFrame(): number {
    return this.currentFrame;
  }

  /** Frozen status snapshot for HUD rendering. */
  getStatus(): ReplayPlaybackStatus {
    return Object.freeze({
      phase: this.phase,
      frameCount: this.getFrameCount(),
      firstFrame: this.getFirstFrame(),
      lastFrame: this.getLastFrame(),
      currentFrame: this.currentFrame,
      isPlaying: this.phase === 'playing',
      isFinished: this.phase === 'finished',
    });
  }

  // -------------------------------------------------------------------------
  // Frame feed — random access (for VCR scrubbing) + cursor walk
  // -------------------------------------------------------------------------

  /**
   * Random-access lookup of every player's input for a specific frame.
   * Returns null if that frame was never captured (out-of-range or a
   * sparse gap in the timeline). The array's length equals
   * `getPlayerCount()`; slot ordering matches `matchConfig.players`.
   *
   * The match scene's per-step update reads through this method during
   * playback:
   *
   *   const inputs = playback.sampleFrame(physicsEngine.getFrame());
   *   if (inputs !== null) {
   *     for (let i = 0; i < inputs.length; i += 1) {
   *       fighters[i].applyInput(inputs[i]);
   *     }
   *   }
   *
   * The cursor is **not** moved by this method — it is purely a
   * lookup. Use `advance()` if you want cursor-walk semantics.
   */
  sampleFrame(frame: number): ReadonlyArray<RecordedCharacterInput> | null {
    if (this.buffer === null) return null;
    const captured = this.buffer.getFrame(frame);
    return captured ? captured.inputs : null;
  }

  /**
   * Random-access lookup of a single player's input for a specific
   * frame. Returns null for missing frames or out-of-range player
   * indices — the caller should treat the same way as
   * `InputCaptureBuffer.getPlayerInput()` (i.e. fall back to neutral
   * if you want fault-tolerant playback).
   */
  samplePlayer(
    frame: number,
    playerIndex: PlayerIndex,
  ): RecordedCharacterInput | null {
    if (this.buffer === null) return null;
    return this.buffer.getPlayerInput(frame, playerIndex);
  }

  /**
   * Cursor-walk read: returns the inputs for the cursor's current
   * frame and post-increments the cursor. Auto-transitions to
   * FINISHED when the cursor moves past the last recorded frame.
   *
   *   • Returns the input array for the current frame, or null if the
   *     cursor is past `lastFrame` / the timeline has no entry at the
   *     cursor's position.
   *   • Throws when called outside PLAYING — defensive against the
   *     scene forgetting to call `start()` after `load()`. The scene
   *     can guard with `isPlaying()` if it wires the call
   *     unconditionally into a generic update loop.
   *
   * Frame-by-frame example (one fixed step):
   *
   *   if (playback.isPlaying()) {
   *     const inputs = playback.advance();
   *     if (inputs !== null) {
   *       for (let i = 0; i < inputs.length; i += 1) {
   *         fighters[i].applyInput(inputs[i]);
   *       }
   *     }
   *   }
   *   world.step(fixedTimestepMs);
   */
  advance(): ReadonlyArray<RecordedCharacterInput> | null {
    if (this.phase !== 'playing') {
      throw new Error(
        `ReplayPlaybackController.advance: not playing (phase=` +
          `'${this.phase}') — call start() first`,
      );
    }
    if (this.buffer === null) {
      // Defensive — PLAYING with no buffer means our state machine is
      // broken. Better to know early than silently feed nulls.
      throw new Error(
        `ReplayPlaybackController.advance: invariant violated — buffer is ` +
          `null while PLAYING`,
      );
    }

    const inputs = this.sampleFrame(this.currentFrame);
    const reachedEnd = this.currentFrame >= this.lastFrame;
    this.currentFrame += 1;
    if (reachedEnd) {
      this.phase = 'finished';
    }
    return inputs;
  }

  /**
   * Move the cursor to a specific frame. Used by the M4 VCR scrubber.
   * Validation:
   *   • Must be a non-negative integer.
   *   • Refuses while IDLE — there's nothing to seek into.
   *
   * Phase semantics:
   *   • A seek to `[firstFrame, lastFrame]` inclusive lands in PLAYING
   *     (so a seek from FINISHED back into the middle of the replay
   *     resumes playback — this is what the rewind button needs).
   *   • A seek past `lastFrame` lands in FINISHED.
   *   • A seek to a frame the timeline doesn't directly contain
   *     (sparse gap) is allowed — the cursor sits at the requested
   *     frame and `sampleFrame` will return null for it; the scene
   *     should treat that as "no input for this step" the same way
   *     {@link InputCaptureBuffer} treats a captured `undefined` slot
   *     (neutral). This matches how the recorder behaves when the
   *     scene chose to skip a frame.
   */
  seek(frame: number): void {
    if (this.phase === 'idle') {
      throw new Error(
        `ReplayPlaybackController.seek: nothing loaded — call load() first`,
      );
    }
    if (!Number.isInteger(frame) || frame < 0) {
      throw new Error(
        `ReplayPlaybackController.seek: frame must be a non-negative integer, ` +
          `got ${String(frame)}`,
      );
    }
    this.currentFrame = frame;
    if (this.lastFrame === -1) {
      // Empty timeline: any seek lands in FINISHED.
      this.phase = 'finished';
      return;
    }
    if (frame > this.lastFrame) {
      this.phase = 'finished';
    } else {
      // Re-enter PLAYING from FINISHED / LOADED so subsequent
      // `advance()` calls work.
      this.phase = 'playing';
    }
  }

  // -------------------------------------------------------------------------
  // Iteration
  // -------------------------------------------------------------------------

  /**
   * Direct view of every captured frame in the loaded replay. Returns
   * an empty array when IDLE. The replay menu uses this to pre-render
   * the scrub bar's tick marks; the snapshot-resync layer (later
   * sub-AC) uses it to find every 300th frame.
   */
  getEntries(): ReadonlyArray<CapturedFrame> {
    return this.buffer?.getEntries() ?? [];
  }
}
