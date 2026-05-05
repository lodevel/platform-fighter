/**
 * Playback simulation state manager — AC 30302 Sub-AC 2.
 *
 * What this module is
 * ===================
 *
 * The cadence brain of the M4 replay player. Where
 * {@link ./ReplayPlaybackController} owns the recorded input timeline
 * and feeds frames into the simulator one at a time, *this* module
 * decides **how often** those frames should be fed during playback —
 * pausing, resuming, slow-motion at a configurable rate (0.25x, 0.5x),
 * fast-forward (>1.0x), and explicit single-frame-advance ("step")
 * commands all flow through here.
 *
 *     ┌──────────────────┐    deltaMs     ┌────────────────────────┐
 *     │  Replay scene    │ ──────────────▶│ PlaybackSimulationState│
 *     │  (rAF tick)      │                │ Manager  (this module) │
 *     │                  │                │                        │
 *     │                  │   tick count   │ • pause / resume       │
 *     │                  │ ◀──────────────│ • setTimeScale(0.25)   │
 *     │                  │                │ • requestStep()        │
 *     │                  │                │ • fixed-step accumulate│
 *     │  for (1..N)      │                └────────────────────────┘
 *     │    playback.advance()
 *     │    physics.step(fixedTimestepMs)
 *     │  end
 *     └──────────────────┘
 *
 * Why a separate module (instead of bolting time-scale onto the controller)
 * ------------------------------------------------------------------------
 *
 *   • **Determinism contract.** The replay controller is *bit-exact* —
 *     re-feeding the same input timeline through the same physics
 *     engine reproduces the original match. To preserve that, time
 *     scaling must be expressed as "advance N integer fixed steps",
 *     never as "advance with a smaller dt". This module is the gatekeeper:
 *     it accepts wall-clock deltas, scales them, accumulates them, and
 *     emits an integer count of fixed steps per tick. The recorded
 *     `Character.applyInput` calls never see a fractional dt and the
 *     physics step never runs at a non-canonical timestep.
 *
 *   • **Pause is "drop dt"**. Pausing simply discards the wall-clock
 *     delta on each tick — the accumulator never grows, no fixed step
 *     is ever emitted, the replay cursor never advances, the physics
 *     engine never steps. When the player resumes, the manager picks
 *     up exactly where it left off, with no fractional drift, because
 *     the accumulator was frozen rather than continuing to grow during
 *     the pause.
 *
 *   • **Frame-advance is "force one step"**. The VCR overlay's "step"
 *     button calls `requestStep()`. The next `tickFromDelta()` call
 *     emits exactly one fixed step regardless of accumulator state /
 *     pause flag / time-scale. Multiple step requests stack into a
 *     queue so a player who clicks the step button five times in a
 *     row gets five frames advanced over the next five ticks.
 *
 *   • **Time-scale is a multiplier on incoming dt**. A 0.25x rate
 *     multiplies every wall-clock delta by 0.25 before adding to the
 *     accumulator. The accumulator threshold (one fixed step) is
 *     unchanged, so the host runs *one quarter* as many physics steps
 *     per wall-clock second — the simulation appears in slow-motion.
 *     Conversely a 2.0x rate doubles the dt so two physics steps fire
 *     per wall-clock frame.
 *
 *   • **Reusability.** Same primitive is useful for the M3 stage
 *     builder's "test play with slow-motion" mode, post-match instant
 *     replays, and any future "ghost replay" overlay — none of which
 *     need to rebuild the accumulator + queue logic.
 *
 * State machine
 * -------------
 *
 *     ┌────────┐  resume()       ┌──────────┐   markFinished()  ┌──────────┐
 *     │ PAUSED │ ───────────────▶│ PLAYING  │ ─────────────────▶│ FINISHED │
 *     │        │ ◀───────────────│          │ ◀─────────────────│          │
 *     └────────┘  pause()        └──────────┘   resume()         └──────────┘
 *         ▲                            │
 *         │            reset()         │
 *         └────────────────────────────┘
 *
 *   • PAUSED — the manager swallows incoming dt without growing the
 *     accumulator. `tickFromDelta()` returns 0 unless a `requestStep()`
 *     is queued (in which case it emits exactly one tick — the
 *     frame-advance path).
 *
 *   • PLAYING — the manager scales incoming dt by `timeScale` and
 *     accumulates. When the accumulator exceeds the fixed timestep,
 *     `tickFromDelta()` emits one or more fixed steps (capped by
 *     `maxStepsPerTick` to prevent runaway after a long tab-background).
 *
 *   • FINISHED — playback exhausted (the host called `markFinished()`
 *     after the playback controller transitioned to its FINISHED phase).
 *     `tickFromDelta()` returns 0 in this phase. Step requests are
 *     ignored (you cannot frame-advance past the end of the replay —
 *     the controller would refuse to advance anyway).
 *
 * `reset()` returns the manager to PAUSED with a fresh accumulator and
 * the queue cleared. The replay menu calls this when the user opens a
 * new replay.
 *
 * Determinism contract
 * --------------------
 *
 *   • The manager produces an integer count of fixed steps per call.
 *     The host applies *exactly* that many `playback.advance()` +
 *     `physics.step(fixedTimestepMs)` pairs. The fixed timestep value
 *     is never rescaled.
 *
 *   • Accumulator + dt + scale arithmetic is pure floating-point but
 *     produces the same integer step counts given the same input
 *     sequence on every run. Running the same replay at 0.25x produces
 *     the same physics state as running it at 1.0x — only the wall-
 *     clock cadence differs.
 *
 *   • No `Math.random()`, no `Date.now()`, no Phaser / Matter / DOM
 *     imports. The accumulator's only input is the host-supplied
 *     deltaMs, which the host obtains from its rAF callback and feeds
 *     in unchanged.
 *
 *   • An anti-spiral-of-death cap (`maxStepsPerTick`, default 8) bounds
 *     the maximum number of steps emitted in a single call to prevent
 *     a long tab-background followed by a resume from blasting through
 *     hundreds of fixed steps in one rAF (which would freeze the
 *     browser, not corrupt determinism — but the symptom looks
 *     identical to the player). The dropped time is silently discarded;
 *     a real replay session cannot be paused mid-flight by the OS for
 *     long enough for this to materially affect the visible playback.
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM imports. The vitest suite under
 * `PlaybackSimulationStateManager.test.ts` exercises every transition
 * under plain Node.
 */

import { GAME_CONFIG } from '../engine/constants';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * High-level lifecycle phase of the playback simulator.
 *
 *   • `paused` — wall-clock dt is discarded; emits ticks only via
 *     queued step requests.
 *   • `playing` — wall-clock dt is scaled + accumulated; emits one or
 *     more fixed-step ticks per tick depending on accumulator level.
 *   • `finished` — playback exhausted; emits no ticks.
 */
export type PlaybackSimulationPhase = 'paused' | 'playing' | 'finished';

/**
 * Allowed time-scale presets the VCR overlay binds to. The manager
 * itself accepts any positive finite scale via {@link
 * PlaybackSimulationStateManager.setTimeScale}, but exposing the
 * canonical four lets the UI render a stable ramp without having to
 * hard-code the literals in two places.
 */
export const PLAYBACK_TIME_SCALE = {
  /** Quarter speed — the canonical "slow-motion" rate per the Seed. */
  QUARTER: 0.25,
  /** Half speed — the canonical "half" rate per the Seed. */
  HALF: 0.5,
  /** Real-time. */
  NORMAL: 1.0,
  /** Double speed — the canonical "fast-forward" rate. */
  DOUBLE: 2.0,
} as const;

/** Type of a canonical preset. Tests use this for ramp coverage. */
export type PlaybackTimeScalePreset =
  (typeof PLAYBACK_TIME_SCALE)[keyof typeof PLAYBACK_TIME_SCALE];

/** Stable left-to-right order for the rate-toggle UI. */
export const PLAYBACK_TIME_SCALE_ORDER: ReadonlyArray<PlaybackTimeScalePreset> =
  Object.freeze([
    PLAYBACK_TIME_SCALE.QUARTER,
    PLAYBACK_TIME_SCALE.HALF,
    PLAYBACK_TIME_SCALE.NORMAL,
    PLAYBACK_TIME_SCALE.DOUBLE,
  ]);

/** Minimum allowed time scale. Smaller values would risk integer overflow
 *  on the accumulator side (a quartile of a microsecond per second) and
 *  there is no UI use case for finer scales. */
export const MIN_PLAYBACK_TIME_SCALE = 0.05;

/**
 * Maximum allowed time scale. Larger values would routinely trip the
 * spiral-of-death cap on every call, defeating the purpose. The VCR
 * overlay's fast-forward preset sits well inside this.
 */
export const MAX_PLAYBACK_TIME_SCALE = 8.0;

/** Constructor options. */
export interface PlaybackSimulationStateOptions {
  /**
   * Fixed step size in milliseconds. Defaults to
   * {@link GAME_CONFIG.fixedTimestepMs}. The manager treats this as
   * opaque: it never rescales the value, only counts how many of these
   * steps fit in the accumulator on each call.
   */
  readonly fixedTimestepMs?: number;
  /**
   * Hard cap on the number of fixed steps emitted in a single
   * `tickFromDelta()` call. Prevents the spiral of death after a long
   * pause / tab-background / OS sleep. Defaults to 8.
   */
  readonly maxStepsPerTick?: number;
  /**
   * Initial phase. Defaults to `'paused'` so the host can `resume()`
   * once the underlying playback controller has loaded its replay.
   */
  readonly initialPhase?: PlaybackSimulationPhase;
  /**
   * Initial time scale. Defaults to `1.0`. Must be a positive finite
   * number in `[MIN_PLAYBACK_TIME_SCALE, MAX_PLAYBACK_TIME_SCALE]`.
   */
  readonly initialTimeScale?: number;
}

/**
 * Frozen status snapshot — the VCR overlay reads this once per render
 * frame to drive its play/pause/rate read-out.
 */
export interface PlaybackSimulationStatus {
  readonly phase: PlaybackSimulationPhase;
  readonly timeScale: number;
  readonly accumulatorMs: number;
  readonly pendingSteps: number;
  /** Convenience — true iff `phase === 'playing'`. */
  readonly isPlaying: boolean;
  /** Convenience — true iff `phase === 'paused'`. */
  readonly isPaused: boolean;
  /** Convenience — true iff `phase === 'finished'`. */
  readonly isFinished: boolean;
  /**
   * Frame counter — incremented once per fixed step the manager has
   * ever emitted. Mirrors the playback cursor's tick rate; the host
   * may ignore it if it already tracks frames on the controller side.
   */
  readonly emittedSteps: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_STEPS_PER_TICK = 8;

// ---------------------------------------------------------------------------
// Internal validation helpers
// ---------------------------------------------------------------------------

function validateTimeScale(scale: number, label: string): void {
  if (typeof scale !== 'number' || !Number.isFinite(scale)) {
    throw new Error(
      `PlaybackSimulationStateManager.${label}: timeScale must be a finite ` +
        `number, got ${String(scale)}`,
    );
  }
  if (scale < MIN_PLAYBACK_TIME_SCALE || scale > MAX_PLAYBACK_TIME_SCALE) {
    throw new Error(
      `PlaybackSimulationStateManager.${label}: timeScale ${scale} out of ` +
        `range [${MIN_PLAYBACK_TIME_SCALE}, ${MAX_PLAYBACK_TIME_SCALE}]`,
    );
  }
}

function validatePhase(
  phase: PlaybackSimulationPhase,
  label: string,
): void {
  if (
    phase !== 'paused' &&
    phase !== 'playing' &&
    phase !== 'finished'
  ) {
    throw new Error(
      `PlaybackSimulationStateManager.${label}: unknown phase ` +
        `'${String(phase)}'`,
    );
  }
}

// ---------------------------------------------------------------------------
// PlaybackSimulationStateManager
// ---------------------------------------------------------------------------

/**
 * Cadence controller for the M4 replay player.
 *
 * Lifecycle:
 *
 *     const sim = new PlaybackSimulationStateManager();
 *     sim.resume();                          // start playing at 1.0x
 *
 *     // every render frame:
 *     const steps = sim.tickFromDelta(deltaMs);
 *     for (let i = 0; i < steps; i += 1) {
 *       const inputs = playback.advance();
 *       if (inputs !== null) feedPlayers(inputs);
 *       physics.step(sim.fixedTimestepMs);
 *     }
 *     if (playback.isFinished()) sim.markFinished();
 *
 * Slow-motion:
 *
 *     sim.setTimeScale(PLAYBACK_TIME_SCALE.QUARTER);  // 0.25x
 *
 * Frame-advance while paused:
 *
 *     sim.pause();
 *     sim.requestStep();             // queues exactly one fixed step
 *     sim.tickFromDelta(16.67);      // → 1
 *     sim.tickFromDelta(16.67);      // → 0 (queue empty, still paused)
 */
export class PlaybackSimulationStateManager {
  /** Fixed step size in ms (16.67 by default). Treated as opaque. */
  readonly fixedTimestepMs: number;

  /** Hard cap on emitted steps per `tickFromDelta()`. */
  readonly maxStepsPerTick: number;

  private phase: PlaybackSimulationPhase;
  private timeScale: number;
  private accumulatorMs = 0;
  private pendingSteps = 0;
  private emittedSteps = 0;

  constructor(options: PlaybackSimulationStateOptions = {}) {
    const fixed =
      options.fixedTimestepMs ?? GAME_CONFIG.fixedTimestepMs;
    if (typeof fixed !== 'number' || !Number.isFinite(fixed) || fixed <= 0) {
      throw new Error(
        `PlaybackSimulationStateManager: fixedTimestepMs must be a positive ` +
          `finite number, got ${String(fixed)}`,
      );
    }
    const maxSteps = options.maxStepsPerTick ?? DEFAULT_MAX_STEPS_PER_TICK;
    if (
      !Number.isInteger(maxSteps) ||
      maxSteps < 1
    ) {
      throw new Error(
        `PlaybackSimulationStateManager: maxStepsPerTick must be a ` +
          `positive integer, got ${String(maxSteps)}`,
      );
    }

    this.fixedTimestepMs = fixed;
    this.maxStepsPerTick = maxSteps;

    const initialPhase = options.initialPhase ?? 'paused';
    validatePhase(initialPhase, 'constructor');
    this.phase = initialPhase;

    const initialScale = options.initialTimeScale ?? 1.0;
    validateTimeScale(initialScale, 'constructor');
    this.timeScale = initialScale;
  }

  // -------------------------------------------------------------------------
  // Lifecycle — pause / resume / finished / reset
  // -------------------------------------------------------------------------

  /**
   * Pause playback. Idempotent in PAUSED. Refuses from FINISHED — the
   * caller should `reset()` first if they want to re-arm a finished
   * replay (typically by re-loading or seeking via the controller).
   */
  pause(): void {
    if (this.phase === 'paused') return;
    if (this.phase === 'finished') {
      // No-op — pausing a finished replay is meaningless. We do not
      // throw because the VCR overlay may dispatch the click before
      // its UI has noticed the FINISHED transition; silently ignoring
      // keeps the click → no-op contract intuitive.
      return;
    }
    this.phase = 'paused';
    // Drop accumulated wall-clock slack so resume picks up at a clean
    // boundary — otherwise the resume would emit an extra step
    // immediately if the accumulator had been within ε of the
    // threshold when pause was called.
    this.accumulatorMs = 0;
  }

  /**
   * Resume playback. Idempotent in PLAYING. Refuses from FINISHED —
   * the caller is expected to navigate the playback cursor (via
   * `controller.seek(0)`) first, then call `reset()` here so the
   * accumulator restarts cleanly.
   */
  resume(): void {
    if (this.phase === 'playing') return;
    if (this.phase === 'finished') {
      return;
    }
    this.phase = 'playing';
    // Accumulator stays at 0 — resume from a known clean boundary.
  }

  /**
   * Toggle PAUSED ↔ PLAYING. The Space-bar handler in the VCR overlay
   * binds to this. No-op while FINISHED.
   */
  togglePause(): void {
    if (this.phase === 'paused') {
      this.resume();
    } else if (this.phase === 'playing') {
      this.pause();
    }
  }

  /**
   * Mark playback as finished. The host calls this once the underlying
   * playback controller transitions to its own FINISHED phase. After
   * this, `tickFromDelta()` returns 0 even with queued steps.
   *
   * Idempotent.
   */
  markFinished(): void {
    this.phase = 'finished';
    this.accumulatorMs = 0;
    // Do NOT clear pendingSteps here — the host can call reset() to
    // start over. Keeping the pendingSteps count visible for the HUD
    // status snapshot is a soft contract; tests assert it stays.
  }

  /**
   * Hard reset: PAUSED, scale = 1.0, accumulator = 0, queue cleared,
   * emitted-steps counter cleared. The replay menu calls this when
   * loading a new replay.
   */
  reset(): void {
    this.phase = 'paused';
    this.timeScale = 1.0;
    this.accumulatorMs = 0;
    this.pendingSteps = 0;
    this.emittedSteps = 0;
  }

  // -------------------------------------------------------------------------
  // Time scaling
  // -------------------------------------------------------------------------

  /**
   * Set the playback time-scale (multiplier on incoming dt).
   *
   *   • 1.0  — real-time (default).
   *   • 0.5  — half speed (slow-motion).
   *   • 0.25 — quarter speed.
   *   • 2.0  — double speed (fast-forward).
   *
   * Allowed range is `[MIN_PLAYBACK_TIME_SCALE, MAX_PLAYBACK_TIME_SCALE]`
   * — values outside throw rather than silently clamping so a UI bug
   * shows up immediately.
   *
   * Setting a scale during PLAYING does **not** flush the accumulator —
   * any partially-accumulated dt at the previous scale carries over. A
   * caller that wants a clean boundary on rate change can call
   * `resetAccumulator()` afterwards.
   */
  setTimeScale(scale: number): void {
    validateTimeScale(scale, 'setTimeScale');
    this.timeScale = scale;
  }

  /** Read the current time scale. */
  getTimeScale(): number {
    return this.timeScale;
  }

  /**
   * Cycle through the canonical preset ramp
   * (`PLAYBACK_TIME_SCALE_ORDER`) — used by the VCR overlay's
   * "slow-motion" button when bound to a multi-rate cycle. After
   * `2.0x` cycles back to `0.25x`. If the current scale is not in
   * the canonical ramp the next call lands on `0.25x`.
   */
  cycleTimeScale(): number {
    const idx = PLAYBACK_TIME_SCALE_ORDER.findIndex(
      (s) => Math.abs(s - this.timeScale) < 1e-9,
    );
    const next =
      idx === -1
        ? PLAYBACK_TIME_SCALE_ORDER[0]!
        : PLAYBACK_TIME_SCALE_ORDER[
            (idx + 1) % PLAYBACK_TIME_SCALE_ORDER.length
          ]!;
    this.timeScale = next;
    return next;
  }

  /**
   * Convenience — toggle between `1.0x` and `0.25x`. Mirrors the
   * VCR overlay's default "slow-motion toggle" button which only
   * binds two states. Returns the new scale.
   */
  toggleSlowMotion(): number {
    const target =
      Math.abs(this.timeScale - PLAYBACK_TIME_SCALE.NORMAL) < 1e-9
        ? PLAYBACK_TIME_SCALE.QUARTER
        : PLAYBACK_TIME_SCALE.NORMAL;
    this.timeScale = target;
    return target;
  }

  /** True iff `timeScale` is at one of the slow-motion presets (<1.0). */
  isSlowMotion(): boolean {
    return this.timeScale < PLAYBACK_TIME_SCALE.NORMAL - 1e-9;
  }

  // -------------------------------------------------------------------------
  // Frame-advance — explicit single-step requests
  // -------------------------------------------------------------------------

  /**
   * Queue one (or `count`) fixed-step ticks to fire on the next
   * `tickFromDelta()` calls. Stacks across calls; the queue drains
   * one entry per emitted step.
   *
   * Frame-advance is independent of the pause flag — the canonical use
   * case is "pause, then click step five times". It is also independent
   * of the time scale (a step is always exactly one fixed timestep).
   *
   * No-op while FINISHED.
   */
  requestStep(count: number = 1): void {
    if (this.phase === 'finished') return;
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(
        `PlaybackSimulationStateManager.requestStep: count must be a ` +
          `positive integer, got ${String(count)}`,
      );
    }
    this.pendingSteps += count;
  }

  /** Drop any queued frame-advance requests. */
  clearPendingSteps(): void {
    this.pendingSteps = 0;
  }

  /** Number of frame-advance requests still queued. */
  getPendingSteps(): number {
    return this.pendingSteps;
  }

  // -------------------------------------------------------------------------
  // Accumulator control
  // -------------------------------------------------------------------------

  /**
   * Drop the residual wall-clock slack. Useful after a manual
   * `setTimeScale` if the caller wants the next emitted step to land
   * on a clean boundary instead of inheriting whatever fraction had
   * accumulated under the previous rate.
   */
  resetAccumulator(): void {
    this.accumulatorMs = 0;
  }

  /** Residual accumulator in ms (un-emitted scaled wall-clock time). */
  getAccumulatorMs(): number {
    return this.accumulatorMs;
  }

  // -------------------------------------------------------------------------
  // Tick — convert wall-clock dt into integer fixed-step count
  // -------------------------------------------------------------------------

  /**
   * Advance the manager by one wall-clock delta and return the number
   * of fixed simulation steps the host should emit on this tick.
   *
   * Rules:
   *
   *   • While FINISHED — always returns 0. The host should stop calling
   *     `playback.advance()` and `physics.step()`.
   *
   *   • While PAUSED:
   *       - Wall-clock dt is dropped (accumulator does not grow).
   *       - If `pendingSteps > 0`, one step is dequeued and returned
   *         (capped by `maxStepsPerTick`).
   *       - Returns 0 otherwise.
   *
   *   • While PLAYING:
   *       - dt is multiplied by `timeScale` and added to the
   *         accumulator.
   *       - The accumulator is clamped to `fixedTimestepMs *
   *         maxStepsPerTick` to prevent spiral-of-death after a long
   *         tab background.
   *       - As many fixed steps as fit are emitted (capped by
   *         `maxStepsPerTick`), each subtracting `fixedTimestepMs` from
   *         the accumulator.
   *       - Any queued frame-advance requests are added on top of the
   *         scaled count, also capped by `maxStepsPerTick`.
   *
   * Negative or non-finite deltas are clamped to 0 rather than throwing
   * — the rAF callback has occasionally been observed to fire with
   * pathological values during devtools long-pause; clamping keeps the
   * simulator from rewinding.
   *
   * Returns: the number of fixed steps the host should run before the
   * next render. Always a non-negative integer ≤ `maxStepsPerTick`.
   */
  tickFromDelta(deltaMs: number): number {
    if (this.phase === 'finished') return 0;

    // Defensive — coerce pathological deltas to zero. This is a
    // determinism-friendly choice: a NaN dt during one rAF must not
    // cause a missed step on the next.
    let dt: number;
    if (typeof deltaMs !== 'number' || !Number.isFinite(deltaMs) || deltaMs < 0) {
      dt = 0;
    } else {
      dt = deltaMs;
    }

    let steps = 0;

    if (this.phase === 'playing') {
      this.accumulatorMs += dt * this.timeScale;

      // Spiral-of-death cap.
      const maxAccum = this.fixedTimestepMs * this.maxStepsPerTick;
      if (this.accumulatorMs > maxAccum) {
        this.accumulatorMs = maxAccum;
      }

      // Tiny epsilon handles floating-point drift from `1000/60` being
      // a non-terminating binary fraction — same trick as
      // {@link GameLoop.tick}.
      const EPS = 1e-9;
      while (
        this.accumulatorMs + EPS >= this.fixedTimestepMs &&
        steps < this.maxStepsPerTick
      ) {
        this.accumulatorMs -= this.fixedTimestepMs;
        steps += 1;
      }
      if (this.accumulatorMs < 0) this.accumulatorMs = 0;
    }

    // Frame-advance queue — applies in BOTH paused and playing phases.
    // Fold remaining cap budget into draining the queue.
    if (this.pendingSteps > 0) {
      const room = this.maxStepsPerTick - steps;
      const drained = Math.min(this.pendingSteps, Math.max(0, room));
      this.pendingSteps -= drained;
      steps += drained;
    }

    this.emittedSteps += steps;
    return steps;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getPhase(): PlaybackSimulationPhase {
    return this.phase;
  }

  isPaused(): boolean {
    return this.phase === 'paused';
  }

  isPlaying(): boolean {
    return this.phase === 'playing';
  }

  isFinished(): boolean {
    return this.phase === 'finished';
  }

  /** Total number of fixed steps emitted across the lifetime of this manager. */
  getEmittedSteps(): number {
    return this.emittedSteps;
  }

  /** Frozen status snapshot for HUD rendering. */
  getStatus(): PlaybackSimulationStatus {
    return Object.freeze({
      phase: this.phase,
      timeScale: this.timeScale,
      accumulatorMs: this.accumulatorMs,
      pendingSteps: this.pendingSteps,
      isPlaying: this.phase === 'playing',
      isPaused: this.phase === 'paused',
      isFinished: this.phase === 'finished',
      emittedSteps: this.emittedSteps,
    });
  }
}
