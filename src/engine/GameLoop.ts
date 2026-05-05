/**
 * Deterministic fixed-timestep game loop (engine core).
 *
 * Implements Glenn Fiedler's "Fix Your Timestep" accumulator pattern:
 *
 *   - `update(dtMs)` runs in fixed 16.67 ms (1/60 s) increments. The number
 *     of update calls per tick is whatever the accumulator demands, so
 *     gameplay logic always sees the same step regardless of frame rate.
 *
 *   - `render(alpha)` runs exactly once per outer tick, on every browser
 *     rAF. The `alpha` value in [0, 1) is the fractional position between
 *     the previous and next physics step — renderers can lerp transforms
 *     for smooth motion without breaking deterministic gameplay.
 *
 * Why this matters for the platform fighter:
 *
 *   1. Replays must produce identical frames given identical inputs. A
 *      variable-step physics tick would diverge across machines.
 *   2. Hit-detection and knockback formulas are frame-indexed; they need
 *      a guaranteed 60 Hz cadence even if the GPU is throttled.
 *   3. Decoupling render from update lets us hit 60 FPS visually while
 *      still pinning the simulation to a fixed step.
 *
 * The loop is engine-pure: it imports nothing from Phaser or Matter, so
 * it is trivial to unit-test under vitest (jsdom not required).
 */

import { GAME_CONFIG } from './constants';

/** Function signature for the per-step gameplay update. */
export type UpdateFn = (dtMs: number, frame: number) => void;

/**
 * Function signature for the render hook.
 *
 * `alpha` ∈ [0, 1): fractional position between the previous physics step
 * and the next. Use it to interpolate sprite transforms for smooth motion
 * (e.g. `renderX = prevX + (currX - prevX) * alpha`).
 */
export type RenderFn = (alpha: number, frame: number) => void;

export interface GameLoopOptions {
  /** Fixed step size in milliseconds. Defaults to GAME_CONFIG.fixedTimestepMs. */
  readonly fixedTimestepMs?: number;
  /**
   * Maximum number of update steps allowed in a single `tick()` call.
   * Prevents the spiral-of-death after a long pause / tab backgrounding.
   * Defaults to 8 (≈ 133 ms of catch-up).
   */
  readonly maxStepsPerTick?: number;
}

/**
 * Engine-core fixed-timestep loop.
 *
 * Usage:
 *
 *   const loop = new GameLoop();
 *   // Inside Phaser's update(time, delta):
 *   loop.tick(delta, (dt, frame) => stepPhysicsAndGameplay(dt),
 *                     (alpha, frame) => renderInterpolated(alpha));
 *
 * Or drive it from a wall-clock timestamp:
 *
 *   loop.tickFromTimestamp(performance.now(), update, render);
 */
export class GameLoop {
  /** Fixed step size in milliseconds (16.67 ms at 60 Hz by default). */
  readonly fixedTimestepMs: number;

  /** Hard cap on update steps per outer tick. */
  readonly maxStepsPerTick: number;

  private accumulatorMs = 0;
  private currentFrame = 0;
  private paused = false;
  private lastTimestampMs: number | null = null;
  /**
   * Cached interpolation alpha for the most recent tick. Exposed via
   * `getAlpha()` so renderers that don't receive it directly (e.g. when
   * driven outside the `tick()` callback) can still query it.
   */
  private lastAlpha = 0;

  constructor(options: GameLoopOptions = {}) {
    this.fixedTimestepMs = options.fixedTimestepMs ?? GAME_CONFIG.fixedTimestepMs;
    this.maxStepsPerTick = options.maxStepsPerTick ?? 8;
  }

  /**
   * Advance the loop using a wall-clock delta in milliseconds.
   *
   * Calls `update` zero or more times (in fixed steps) until the
   * accumulator drops below the fixed timestep, then calls `render`
   * exactly once with the residual `alpha`.
   *
   * Returns the number of fixed update steps executed this tick.
   */
  tick(deltaMs: number, update: UpdateFn, render?: RenderFn): number {
    if (this.paused) {
      // Still call render so the screen can refresh while paused — but
      // freeze the simulation by skipping the accumulator entirely.
      if (render) render(this.lastAlpha, this.currentFrame);
      return 0;
    }

    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      // Defensive: clamp pathological deltas to zero rather than rewinding.
      deltaMs = 0;
    }

    this.accumulatorMs += deltaMs;

    // Spiral-of-death cap.
    const maxAccum = this.fixedTimestepMs * this.maxStepsPerTick;
    if (this.accumulatorMs > maxAccum) {
      this.accumulatorMs = maxAccum;
    }

    let steps = 0;
    // Tiny epsilon handles floating-point drift from `1000/60` being a
    // non-terminating binary fraction: without it, an accumulator that
    // should equal exactly N fixed steps can come up short by ~2e-15 ms
    // after repeated subtractions, dropping a step every few seconds.
    const EPS = 1e-9;
    while (
      this.accumulatorMs + EPS >= this.fixedTimestepMs &&
      steps < this.maxStepsPerTick
    ) {
      update(this.fixedTimestepMs, this.currentFrame);
      this.currentFrame += 1;
      this.accumulatorMs -= this.fixedTimestepMs;
      steps += 1;
    }

    // Clamp residual drift below ε to a clean zero so alpha stays in
    // [0, 1) without flickering tiny-negative values.
    if (this.accumulatorMs < 0) this.accumulatorMs = 0;

    // Render with interpolation alpha — the leftover fraction of a step
    // that hasn't been simulated yet.
    this.lastAlpha = this.accumulatorMs / this.fixedTimestepMs;
    if (render) render(this.lastAlpha, this.currentFrame);

    return steps;
  }

  /**
   * Convenience wrapper that derives delta from a monotonic timestamp
   * (e.g. `performance.now()` or rAF's argument). The first call
   * establishes the baseline and produces zero update steps.
   */
  tickFromTimestamp(nowMs: number, update: UpdateFn, render?: RenderFn): number {
    if (this.lastTimestampMs === null) {
      this.lastTimestampMs = nowMs;
      // Render baseline frame so caller sees something on screen.
      if (render) render(0, this.currentFrame);
      return 0;
    }
    const delta = nowMs - this.lastTimestampMs;
    this.lastTimestampMs = nowMs;
    return this.tick(delta, update, render);
  }

  /** Current simulation frame index (monotonically increasing). */
  getFrame(): number {
    return this.currentFrame;
  }

  /** Last computed interpolation alpha in [0, 1). */
  getAlpha(): number {
    return this.lastAlpha;
  }

  /** Residual accumulator (un-simulated wall-clock time) in milliseconds. */
  getAccumulatorMs(): number {
    return this.accumulatorMs;
  }

  /** Pause the simulation. Render is still called so the canvas stays live. */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    // Drop any accumulated wall-clock slack — otherwise the resume tick
    // would fast-forward by however long we were paused.
    this.accumulatorMs = 0;
    this.lastTimestampMs = null;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Reset the loop to a clean state. Used between matches, on replay
   * scrub-to-start, and after a hot reload during development.
   */
  reset(): void {
    this.accumulatorMs = 0;
    this.currentFrame = 0;
    this.paused = false;
    this.lastTimestampMs = null;
    this.lastAlpha = 0;
  }

  /**
   * Force the loop to a specific frame. Used by the replay system when
   * scrubbing to a state snapshot.
   */
  setFrame(frame: number): void {
    this.currentFrame = Math.max(0, Math.floor(frame));
    this.accumulatorMs = 0;
    this.lastAlpha = 0;
  }
}
