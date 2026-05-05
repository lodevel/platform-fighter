/**
 * Frame-advance stepper — AC 30304 Sub-AC 4.
 *
 * What this module is
 * ===================
 *
 * The trigger-driven, single-step "advance one fixed frame" coordinator
 * for the M4 replay player's VCR overlay.
 *
 * Sub-AC 1 ({@link ReplayPlaybackController}) owns the recorded input
 * timeline. Sub-AC 2 ({@link PlaybackSimulationStateManager}) owns the
 * cadence brain — pause / resume / time-scale + the
 * `requestStep()` queue + spiral-of-death cap. Sub-AC 3
 * ({@link RewindController}) owns backwards seeks via snapshot restore.
 * This module — Sub-AC 4 — is the **forwards single-step**
 * coordinator: one trigger, one fixed-step worth of input feed plus
 * one fixed-step worth of physics simulation, with input replay and
 * physics step **in lockstep** (never one without the other).
 *
 *     ┌───────────────────────┐  trigger    ┌──────────────────────────┐
 *     │  VCR overlay button   │ ───────────▶│   FrameAdvanceStepper    │
 *     │  ("step", F shortcut) │             │   (this module)          │
 *     └───────────────────────┘             │                          │
 *                                           │  1. precondition gate    │
 *                                           │     (paused + loaded +   │
 *                                           │      not finished)       │
 *                                           │                          │
 *                                           │  2. playback.advance() ──┐
 *                                           │  3. applyInputs(...) ────┤
 *                                           │  4. stepPhysics(dt) ─────┤
 *                                           │  5. tally counters ──────┘
 *                                           └──────────────────────────┘
 *                                                  ▲
 *                                            ─inputs ╳ physics─
 *                                              never one
 *                                              without the other
 *
 * Why a separate module (instead of inlining in the scene's tick)
 * --------------------------------------------------------------
 *
 *   • **Lockstep guarantee.** The Sub-AC's strict requirement is that
 *     "input replay and physics step" advance **together** — exactly one
 *     `playback.advance()` per `physics.step()`, no drift. Inlining the
 *     two calls in two separate scene branches makes it easy for a
 *     future refactor to call physics without inputs (or vice versa).
 *     Centralising the pair in one method makes the contract a single
 *     reviewable line.
 *
 *   • **Precondition gate.** Frame-advance is meaningless while the
 *     replay is *playing* (the cursor is already advancing every tick),
 *     undefined while *idle* (no replay loaded), and out-of-band while
 *     *finished* (cursor past `lastFrame`). A scene-level branch would
 *     need to re-derive every check from individual controller getters;
 *     a single typed `step()` returning a {@link FrameAdvanceResult}
 *     keeps the host's call site one-line + lets it surface the noop
 *     reason to telemetry / HUD without a switch.
 *
 *   • **Symmetry with rewind.** {@link RewindController} fills the
 *     reverse role — backwards seek with snapshot resync — and carries
 *     the same lifecycle (configurable host callbacks, telemetry stats,
 *     resettable). Pairing them in `src/replay/` keeps the M4 VCR
 *     primitives discoverable and consistently shaped.
 *
 *   • **Testability.** Phaser-free. The vitest suite under
 *     `FrameAdvanceStepper.test.ts` runs under plain Node — no jsdom,
 *     no Phaser scene fixture, no Matter world. The host's two
 *     callbacks (`applyInputs`, `stepPhysics`) are the only escape
 *     hatch and they are stubs in the suite.
 *
 * Determinism contract
 * --------------------
 *
 *   • Each `step()` call corresponds to exactly one fixed timestep
 *     advance. The timestep value (`fixedTimestepMs`) is sourced from
 *     the host's {@link PlaybackSimulationStateManager} and forwarded to
 *     `stepPhysics` unchanged — never rescaled, never fractionalised.
 *     This is what makes single-stepping bit-equal to "let it play and
 *     pause again at the next frame".
 *
 *   • Input lookups go through {@link ReplayPlaybackController.advance},
 *     which post-increments the cursor. The cursor moves forward exactly
 *     once per `step()`. There is no path that reads inputs without
 *     advancing the cursor (which would replay the same frame's inputs
 *     twice) and no path that advances the cursor without feeding
 *     inputs (which would skip a frame).
 *
 *   • The simulation manager's `pendingSteps` queue is **bypassed** by
 *     the stepper's direct path. The `requestStep()` queue exists so
 *     `tickFromDelta()` callers can express frame-advance through the
 *     accumulator pipeline; the stepper instead drives the pair
 *     directly so the host's tick loop branch on "is paused → call
 *     stepper" stays clean and the queue cannot mix with playing-state
 *     accumulator drains.
 *
 *   • No `Math.random()`, no `Date.now()`, no Phaser / Matter / DOM
 *     imports. The two callbacks the host supplies are the only escape
 *     hatch.
 *
 * Phase precondition: paused only (by default)
 * --------------------------------------------
 *
 * The default policy refuses to step while the simulation manager is
 * `'playing'` (frame-advance is undefined while the cursor is already
 * advancing) and while `'finished'` (cursor past last recorded frame).
 *
 * Hosts that want frame-advance to override the playing state (e.g. an
 * "instant replay" mode that arms a step regardless of phase) can set
 * `requirePaused: false` at construction, in which case the stepper
 * still skips when the playback controller is finished but does not
 * verify the simulation phase. The default is `requirePaused: true`,
 * matching the AC's "while paused" wording.
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM imports.
 */

import { GAME_CONFIG } from '../engine/constants';
import {
  type RecordedCharacterInput,
} from './InputCaptureBuffer';
import type { PlaybackSimulationStateManager } from './PlaybackSimulationStateManager';
import type { ReplayPlaybackController } from './ReplayPlaybackController';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Apply a single fixed-step's worth of recorded inputs to the live
 * fighters. The stepper invokes this exactly once per `step()` call,
 * after pulling the inputs from the playback controller and before
 * stepping the physics engine. The host is expected to:
 *
 *   • Walk every player slot and call `Character.applyInput(inputs[i])`
 *     using `inputs[i] ?? NEUTRAL_INPUT` so a sparse-gap frame
 *     (controller returned `null`) feeds neutral to every fighter.
 *
 * Throwing from this callback is allowed — the stepper records a
 * failed-step result and re-throws so the host's error path engages.
 * The physics step is **not** called when `applyInputs` throws (no
 * lockstep half-advance).
 *
 * @param frame   The frame that was just sampled (the cursor's value
 *                **before** the controller's `advance()` post-increment).
 * @param inputs  The inputs read at `frame`, or `null` if the timeline
 *                had no entry there. The host decides whether to feed
 *                neutral (fault-tolerant) or abort (strict).
 */
export type FrameAdvanceApplyInputsFn = (
  frame: number,
  inputs: ReadonlyArray<RecordedCharacterInput> | null,
) => void;

/**
 * Step the physics engine by exactly one fixed timestep. Called
 * immediately after `applyInputs` returns. Receives the
 * fixed-timestep value the simulation manager is configured with —
 * forwarded unchanged so the deterministic Matter.js step lands on
 * the canonical 60 Hz cadence.
 *
 * Throwing is allowed — surfaced unchanged through `step()`.
 */
export type FrameAdvanceStepPhysicsFn = (fixedTimestepMs: number) => void;

/**
 * Constructor options. The `playback` and `applyInputs` /
 * `stepPhysics` callbacks are required; everything else has a
 * deterministic default.
 */
export interface FrameAdvanceStepperOptions {
  /**
   * The replay playback controller hosting the recorded input
   * timeline. Required — there is no useful "frame-advance without
   * recorded inputs" mode (the live-recording case has no replay file
   * to step through).
   */
  readonly playback: ReplayPlaybackController;

  /**
   * Apply a single frame's recorded inputs. Required — see
   * {@link FrameAdvanceApplyInputsFn}.
   */
  readonly applyInputs: FrameAdvanceApplyInputsFn;

  /**
   * Step the physics engine. Required — see
   * {@link FrameAdvanceStepPhysicsFn}.
   */
  readonly stepPhysics: FrameAdvanceStepPhysicsFn;

  /**
   * Optional cadence brain. When provided, the stepper consults
   * `simulation.isPaused()` for its precondition gate AND increments
   * the manager's emitted-step counter so the HUD's "frames emitted"
   * read-out stays consistent with the cadence pipeline.
   *
   * If absent, the precondition gate uses only the playback
   * controller's phase + the `requirePaused` flag falls back to a
   * permissive default (no phase check).
   */
  readonly simulation?: PlaybackSimulationStateManager;

  /**
   * Whether to refuse stepping while the simulation manager reports a
   * non-paused phase. Defaults to `true` — matches the Sub-AC's
   * "while paused" wording. Set to `false` for hosts that want to
   * trigger a step regardless of phase (e.g. a debug overlay running
   * outside a normal replay session).
   *
   * Has no effect when `simulation` is omitted.
   */
  readonly requirePaused?: boolean;

  /**
   * Fixed step size in milliseconds. Defaults to
   * `simulation.fixedTimestepMs` if a simulation manager is supplied,
   * otherwise {@link GAME_CONFIG.fixedTimestepMs} (16.67 ms).
   */
  readonly fixedTimestepMs?: number;
}

/**
 * One outcome status per `step()` call.
 *
 *   • `'success'`            — inputs fed and physics stepped.
 *   • `'noop-not-paused'`    — refused because the simulation manager
 *                              is not paused (and `requirePaused` is on).
 *   • `'noop-finished'`      — refused because the playback controller
 *                              is in its FINISHED phase (cursor past the
 *                              last recorded frame).
 *   • `'noop-no-replay'`     — refused because no replay is loaded
 *                              (controller in IDLE / LOADED with empty
 *                              timeline).
 *   • `'failed-apply-inputs'`— `applyInputs` threw; cursor was advanced
 *                              before the throw so a retry would skip
 *                              the failing frame. Physics was NOT stepped.
 *                              The throw is **not** re-propagated — a
 *                              VCR button click should never crash the
 *                              host scene; the error message is surfaced
 *                              via the result.
 *   • `'failed-step-physics'`— `stepPhysics` threw after `applyInputs`
 *                              succeeded. Cursor was advanced; the host
 *                              is left in a half-stepped state. As with
 *                              `failed-apply-inputs`, the error is
 *                              captured and surfaced via the result
 *                              rather than re-thrown.
 */
export type FrameAdvanceStatus =
  | 'success'
  | 'noop-not-paused'
  | 'noop-finished'
  | 'noop-no-replay'
  | 'failed-apply-inputs'
  | 'failed-step-physics';

/** Frozen result record returned by `step()`. */
export interface FrameAdvanceResult {
  readonly status: FrameAdvanceStatus;
  /**
   * The frame the controller's cursor pointed at *before* the
   * advance. On `'success'` this is the frame that was actually
   * stepped through. On a noop or failure this is the cursor's value
   * at the time of the call (so the HUD can still display "would
   * have stepped frame N").
   */
  readonly frame: number;
  /**
   * The recorded inputs at `frame`, or `null` for a sparse gap. The
   * host's `applyInputs` callback receives this same value. On a
   * noop / failure where the controller never advanced, this is
   * `null`.
   */
  readonly inputs: ReadonlyArray<RecordedCharacterInput> | null;
  /**
   * Fixed timestep value (ms) the stepper would have used (or did
   * use). Always populated, even on noop, so the HUD can render
   * "step rate: 16.67 ms" without having to query the cadence brain
   * separately.
   */
  readonly fixedTimestepMs: number;
  /**
   * On a `'failed-*'` status — the human-readable error message.
   * Empty string on `'success'` / `'noop-*'`.
   */
  readonly errorMessage: string;
}

/** Aggregate stats since construction (or the last `reset()`). */
export interface FrameAdvanceStats {
  /** Total `step()` calls. */
  readonly stepCount: number;
  /** `step()` calls that returned `'success'`. */
  readonly successCount: number;
  /** `step()` calls that returned a `'noop-*'` status. */
  readonly noopCount: number;
  /** `step()` calls that threw via either callback. */
  readonly failureCount: number;
  /**
   * Frame the most recent successful step landed on. `null` until at
   * least one successful step has run.
   */
  readonly lastSteppedFrame: number | null;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const FROZEN_EMPTY_STATS: FrameAdvanceStats = Object.freeze({
  stepCount: 0,
  successCount: 0,
  noopCount: 0,
  failureCount: 0,
  lastSteppedFrame: null,
});

// ---------------------------------------------------------------------------
// FrameAdvanceStepper
// ---------------------------------------------------------------------------

/**
 * Single-step coordinator for the M4 VCR overlay's "Frame advance"
 * button (and `F` keyboard shortcut).
 *
 * Lifecycle:
 *
 *     // While replaying:
 *     const stepper = new FrameAdvanceStepper({
 *       playback,
 *       simulation,
 *       applyInputs: (frame, inputs) => {
 *         for (let i = 0; i < fighters.length; i += 1) {
 *           fighters[i].applyInput(inputs?.[i] ?? NEUTRAL_INPUT);
 *         }
 *       },
 *       stepPhysics: (dt) => physicsEngine.advance(dt, () => matterStep(dt)),
 *     });
 *
 *     // Wired to the VCR overlay's "frame advance" action:
 *     vcrOverlay.actions.onFrameAdvance = () => {
 *       const result = stepper.step();
 *       hud.recordFrameAdvance(result);
 *     };
 *
 *     // The host calls reset() when the replay session ends so a
 *     // subsequent session starts with fresh stats.
 *     stepper.reset();
 *
 * The stepper is reusable — `reset()` clears the stats counters but
 * preserves the callbacks + the playback / simulation references, so
 * the host can re-arm it for the next replay session without
 * reconstructing.
 */
export class FrameAdvanceStepper {
  private readonly playback: ReplayPlaybackController;
  private readonly simulation: PlaybackSimulationStateManager | null;
  private readonly applyInputs: FrameAdvanceApplyInputsFn;
  private readonly stepPhysics: FrameAdvanceStepPhysicsFn;
  private readonly requirePaused: boolean;
  private readonly fixedTimestepMs: number;

  private stepCount = 0;
  private successCount = 0;
  private noopCount = 0;
  private failureCount = 0;
  private lastSteppedFrame: number | null = null;

  constructor(options: FrameAdvanceStepperOptions) {
    if (options === null || typeof options !== 'object') {
      throw new Error(
        `FrameAdvanceStepper: options must be a non-null object`,
      );
    }
    if (
      options.playback === null ||
      options.playback === undefined ||
      typeof options.playback.advance !== 'function' ||
      typeof options.playback.getCurrentFrame !== 'function' ||
      typeof options.playback.isFinished !== 'function'
    ) {
      throw new Error(
        `FrameAdvanceStepper: options.playback must be a ReplayPlaybackController` +
          ` (or compatible shape exposing advance / getCurrentFrame / isFinished)`,
      );
    }
    if (typeof options.applyInputs !== 'function') {
      throw new Error(
        `FrameAdvanceStepper: options.applyInputs must be a function`,
      );
    }
    if (typeof options.stepPhysics !== 'function') {
      throw new Error(
        `FrameAdvanceStepper: options.stepPhysics must be a function`,
      );
    }

    this.playback = options.playback;
    this.simulation = options.simulation ?? null;
    this.applyInputs = options.applyInputs;
    this.stepPhysics = options.stepPhysics;
    this.requirePaused = options.requirePaused ?? true;

    const fixed =
      options.fixedTimestepMs ??
      this.simulation?.fixedTimestepMs ??
      GAME_CONFIG.fixedTimestepMs;
    if (
      typeof fixed !== 'number' ||
      !Number.isFinite(fixed) ||
      fixed <= 0
    ) {
      throw new Error(
        `FrameAdvanceStepper: fixedTimestepMs must be a positive finite ` +
          `number, got ${String(fixed)}`,
      );
    }
    this.fixedTimestepMs = fixed;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * Read-through to the playback controller's cursor — the frame that
   * the next `step()` would consume. Returns `0` when no replay is
   * loaded.
   */
  getCurrentFrame(): number {
    return this.playback.getCurrentFrame();
  }

  getFixedTimestepMs(): number {
    return this.fixedTimestepMs;
  }

  /** Aggregate stats — see {@link FrameAdvanceStats}. */
  getStats(): FrameAdvanceStats {
    return Object.freeze({
      stepCount: this.stepCount,
      successCount: this.successCount,
      noopCount: this.noopCount,
      failureCount: this.failureCount,
      lastSteppedFrame: this.lastSteppedFrame,
    });
  }

  /**
   * True iff a `step()` call right now would advance the simulation —
   * i.e. precondition gate would pass. Useful for the VCR overlay to
   * paint the "Frame advance" button as `disabled` when stepping is
   * meaningless.
   *
   * Returns false if:
   *   • The playback controller is in IDLE (no replay loaded).
   *   • The playback controller is in FINISHED.
   *   • `requirePaused` is on AND the simulation manager is not paused.
   *
   * Note: a sparse-gap frame at the cursor (no recorded entry) does
   * NOT make stepping unavailable — the host's `applyInputs` callback
   * decides whether to treat null inputs as neutral or abort.
   */
  isAvailable(): boolean {
    if (this.playback.isFinished()) return false;
    if (!this.playback.isLoaded()) return false;
    // LOADED is treated as available even though `playback.advance()`
    // would throw from there — `step()` auto-starts the controller
    // first so the cursor walks one frame as the host expects.
    if (this.requirePaused && this.simulation !== null) {
      if (!this.simulation.isPaused()) return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // The single-step trigger
  // -------------------------------------------------------------------------

  /**
   * Advance the simulation by exactly one fixed timestep. The
   * canonical implementation of the AC contract: input replay and
   * physics step in lockstep.
   *
   *   • Pre-conditions checked first; on any failure returns a
   *     `'noop-*'` status WITHOUT mutating the cursor or invoking
   *     either callback.
   *
   *   • If pre-conditions pass: pulls inputs at the cursor's frame
   *     via `playback.advance()` (post-increments cursor), calls
   *     `applyInputs(frame, inputs)`, then calls
   *     `stepPhysics(fixedTimestepMs)`. If `applyInputs` throws,
   *     `stepPhysics` is NOT called (no half-advance).
   *
   * Returns a frozen {@link FrameAdvanceResult}. A throw from either
   * callback is captured into the result's `.errorMessage` and the
   * status reflects which callback raised; the throw itself is **not**
   * re-propagated — a VCR button click should never crash the host
   * scene. Hosts that want to surface the failure can read
   * `.status.startsWith('failed-')` from the result and route to their
   * own error UI / log path.
   *
   * `simulation.requestStep()` is NOT called by this method — the
   * stepper drives the input + physics pair directly so the
   * simulation manager's `pendingSteps` queue stays focused on its
   * `tickFromDelta()` integration. Hosts that want the queue path
   * instead can call `simulation.requestStep()` manually and then
   * route through the cadence pipeline.
   */
  step(): FrameAdvanceResult {
    this.stepCount += 1;

    // Pre-condition: replay must be loaded.
    if (!this.playback.isLoaded()) {
      return this.recordNoop('noop-no-replay', 0, null);
    }

    // Pre-condition: replay must not be finished.
    if (this.playback.isFinished()) {
      return this.recordNoop(
        'noop-finished',
        this.playback.getCurrentFrame(),
        null,
      );
    }

    // Pre-condition: simulation manager (if any) must be paused.
    if (
      this.requirePaused &&
      this.simulation !== null &&
      !this.simulation.isPaused()
    ) {
      return this.recordNoop(
        'noop-not-paused',
        this.playback.getCurrentFrame(),
        null,
      );
    }

    // Cursor's current value — the frame we're about to step through.
    // Captured before `advance()` post-increments so the result
    // accurately reports "we just processed frame N".
    const frame = this.playback.getCurrentFrame();

    // Pull inputs + advance cursor in lockstep with the host's
    // applyInputs / stepPhysics calls. The controller's `advance()`
    // throws unless we're in PLAYING, so we briefly enter PLAYING for
    // the single step then return to PAUSED via the simulation
    // manager. This is what "step in lockstep" means at the
    // controller level: one cursor advance, one input apply, one
    // physics step, then back to the original phase.
    let inputs: ReadonlyArray<RecordedCharacterInput> | null = null;
    const wasPlaying = this.playback.isPlaying();
    if (!wasPlaying) {
      // From LOADED / FINISHED / IDLE, we can only `start()` from
      // LOADED. We've already filtered FINISHED + IDLE above, so the
      // only valid path here is LOADED → PLAYING for one frame.
      if (this.playback.getPhase() === 'loaded') {
        this.playback.start();
        // start() may transition LOADED → FINISHED for an empty
        // timeline. Re-check.
        if (this.playback.isFinished()) {
          return this.recordNoop('noop-finished', frame, null);
        }
      } else {
        // Phase is 'playing' or something we've already filtered. If
        // by some race the controller transitioned without us, treat
        // as no-replay-state.
        return this.recordNoop('noop-no-replay', frame, null);
      }
    }

    try {
      inputs = this.playback.advance();
    } catch (err) {
      // Translates a controller-level invariant violation into a
      // failed-apply status. The cursor was NOT advanced.
      return this.recordFailure(
        'failed-apply-inputs',
        frame,
        null,
        coerceErrorMessage(err),
      );
    }

    // Inputs may be `null` for a sparse-gap frame — the host's
    // applyInputs decides whether to feed neutral or abort.
    try {
      this.applyInputs(frame, inputs);
    } catch (err) {
      return this.recordFailure(
        'failed-apply-inputs',
        frame,
        inputs,
        coerceErrorMessage(err),
      );
    }

    try {
      this.stepPhysics(this.fixedTimestepMs);
    } catch (err) {
      // applyInputs already ran; we surface the throw but mark the
      // status as failed-step-physics so the host can distinguish.
      return this.recordFailure(
        'failed-step-physics',
        frame,
        inputs,
        coerceErrorMessage(err),
      );
    }

    // Success. The simulation manager's emitted-step counter is
    // updated via its `requestStep()` + drain path — but since we
    // bypassed that path, fold a manual increment in so the HUD's
    // "emitted steps" read-out stays consistent. The manager exposes
    // no `bumpEmittedSteps()` setter, so we go through the queue
    // (request 1, then drain via tickFromDelta(0)) which is a no-op
    // when paused with no accumulator.
    if (this.simulation !== null) {
      // Only fold when we actually drove the simulation forward and
      // the manager is in a paused state — folding into a 'playing'
      // manager would double-count against its accumulator drains.
      if (this.simulation.isPaused()) {
        this.simulation.requestStep(1);
        this.simulation.tickFromDelta(0);
      }
    }

    this.successCount += 1;
    this.lastSteppedFrame = frame;
    return Object.freeze({
      status: 'success' as FrameAdvanceStatus,
      frame,
      inputs,
      fixedTimestepMs: this.fixedTimestepMs,
      errorMessage: '',
    });
  }

  /**
   * Convenience: step `count` times. Stops on the first non-success
   * status (the noop / failure result is returned and subsequent
   * steps are skipped). Returns the LAST result — successful or not —
   * so callers can chain on its status.
   *
   * Throws if `count` is not a positive integer.
   */
  stepBy(count: number): FrameAdvanceResult {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(
        `FrameAdvanceStepper.stepBy: count must be a positive integer, ` +
          `got ${String(count)}`,
      );
    }
    let last: FrameAdvanceResult | null = null;
    for (let i = 0; i < count; i += 1) {
      const r = this.step();
      last = r;
      if (r.status !== 'success') break;
    }
    // We always loop at least once, so `last` is non-null.
    return last as FrameAdvanceResult;
  }

  /** Reset stats counters. Preserves callbacks + controller refs. */
  reset(): void {
    this.stepCount = 0;
    this.successCount = 0;
    this.noopCount = 0;
    this.failureCount = 0;
    this.lastSteppedFrame = null;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private recordNoop(
    status: FrameAdvanceStatus,
    frame: number,
    inputs: ReadonlyArray<RecordedCharacterInput> | null,
  ): FrameAdvanceResult {
    this.noopCount += 1;
    return Object.freeze({
      status,
      frame,
      inputs,
      fixedTimestepMs: this.fixedTimestepMs,
      errorMessage: '',
    });
  }

  private recordFailure(
    status: FrameAdvanceStatus,
    frame: number,
    inputs: ReadonlyArray<RecordedCharacterInput> | null,
    message: string,
  ): FrameAdvanceResult {
    this.failureCount += 1;
    return Object.freeze({
      status,
      frame,
      inputs,
      fixedTimestepMs: this.fixedTimestepMs,
      errorMessage: message,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function coerceErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return String(err);
  } catch {
    return 'unknown error';
  }
}

// Re-export for symmetry with `RewindController`'s neutral-input
// re-export so callers building a host applyInputs callback have a
// single import path for both modules.
export { NEUTRAL_INPUT } from './InputCaptureBuffer';

/** Frozen empty stats — returned by a freshly-constructed stepper. */
export const FRAME_ADVANCE_EMPTY_STATS: FrameAdvanceStats = FROZEN_EMPTY_STATS;
