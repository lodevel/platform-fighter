/**
 * Phaser-free formatting + sliding-window helpers for the in-match FPS
 * overlay (Sub-AC 3 of AC 3).
 *
 * The FPS counter shows two distinct rates:
 *
 *   1. Render FPS — the rate at which Phaser's outer rAF loop is firing.
 *      This is what most players think of as "FPS"; it answers "is my
 *      machine drawing at 60 frames per second?". We read it directly
 *      from `Phaser.Game.loop.actualFps`, which is itself a rolling
 *      average so we don't need to smooth it ourselves.
 *
 *   2. Simulation tick rate — the rate at which the deterministic fixed-
 *      timestep loop is *advancing the world*. Because the simulation is
 *      driven by an accumulator (see `GameLoop.tick`), the number of
 *      gameplay updates per second can in principle decouple from the
 *      render rate (e.g. if rAF backgrounds the tab and bursts a catch-up
 *      run). In normal operation it should sit at exactly 60 — that's
 *      part of what "60 FPS rendering performance verified" means: not
 *      just that we draw at 60, but that we *simulate* at 60.
 *
 * The pure logic lives here so the unit suite can exercise the rolling-
 * window math without booting Phaser:
 *
 *   • {@link TickRateMeter} — fixed-window step counter that converts
 *     "N steps in M ms" into a steps-per-second figure.
 *   • {@link formatFpsLine} — turns the two numeric rates plus a target
 *     into the canonical overlay string.
 *   • {@link fpsHealthColor} — colour the FPS readout so a glance
 *     reveals whether the game is hitting the 60 FPS target.
 */

/**
 * Threshold colour ramp for the render-FPS readout.
 *
 *   ≥ 58 fps → green   (healthy — within 60 FPS budget)
 *   ≥ 50 fps → yellow  (mild dip — investigate but not critical)
 *   < 50 fps → red     (failing the 60 FPS target — performance bug)
 *
 * The thresholds intentionally leave a 2-frame fudge factor at the top
 * because Phaser's `actualFps` is a rolling average and rarely lands on
 * an exact 60.
 */
export const FPS_HEALTH_RAMP: ReadonlyArray<{
  readonly minFps: number;
  readonly color: number;
}> = [
  { minFps: 58, color: 0x6cf0c2 }, // green — meeting target
  { minFps: 50, color: 0xffe066 }, // yellow — mild dip
  { minFps: 0, color: 0xff6b6b }, // red — failing target
];

/**
 * Pick a tint for the FPS readout based on its health threshold band.
 *
 * Walks {@link FPS_HEALTH_RAMP} (3 entries — O(1)) and returns the first
 * band whose `minFps` is `<= fps`. NaN / negative / non-finite inputs
 * fall through to the red band so the overlay never displays an
 * undefined tint.
 */
export function fpsHealthColor(fps: number): number {
  if (!Number.isFinite(fps) || fps < 0) {
    return FPS_HEALTH_RAMP[FPS_HEALTH_RAMP.length - 1]!.color;
  }
  for (const entry of FPS_HEALTH_RAMP) {
    if (fps >= entry.minFps) {
      return entry.color;
    }
  }
  return FPS_HEALTH_RAMP[FPS_HEALTH_RAMP.length - 1]!.color;
}

/**
 * Phaser uses `'#rrggbb'` for `Text` colours. Mirrors the helper in
 * `damageHudFormat.ts` (kept local to avoid a cyclic export tangle).
 */
export function colorIntToHexString(value: number): string {
  if (!Number.isFinite(value)) return '#000000';
  const clamped = Math.max(0, Math.min(0xffffff, Math.trunc(value)));
  return `#${clamped.toString(16).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Line formatter
// ---------------------------------------------------------------------------

/**
 * Format the FPS / tick-rate / target trio into the canonical overlay
 * line. Output format:
 *
 *   "FPS 60 | SIM 60 Hz | target 60"
 *
 * NaN / Infinity / negative values are rendered as "—" so a transient
 * read-failure (e.g. before Phaser has measured a single rAF cycle)
 * doesn't paint garbage.
 */
export function formatFpsLine(
  renderFps: number,
  simHz: number,
  targetFps: number,
): string {
  return (
    `FPS ${formatRate(renderFps)} | ` +
    `SIM ${formatRate(simHz)} Hz | ` +
    `target ${formatRate(targetFps)}`
  );
}

/**
 * Format a single rate value for the overlay. Truncates fractional
 * digits so a 59.4 fps reading doesn't flicker between two characters
 * each frame.
 */
export function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate < 0) return '—';
  return `${Math.round(rate)}`;
}

// ---------------------------------------------------------------------------
// TickRateMeter — pure rolling-window step counter
// ---------------------------------------------------------------------------

export interface TickRateMeterOptions {
  /**
   * Window size in milliseconds. The meter reports "steps observed in
   * the last N ms × (1000 / N)". 500 ms is responsive enough to catch a
   * 1-frame hitch but long enough that a single dropped step doesn't
   * collapse the readout to half-rate. Defaults to 500 ms.
   */
  readonly windowMs?: number;
}

const DEFAULT_TICK_RATE_WINDOW_MS = 500;

/**
 * Sliding-window step counter that converts "N simulation steps in M
 * milliseconds of wall clock" into a steps-per-second figure for the
 * FPS overlay. Pure — no globals, no `performance.now()` reads — so the
 * unit suite can drive it with a synthetic clock.
 *
 * Usage from MatchScene:
 *
 *   const meter = new TickRateMeter();
 *   // every render frame:
 *   meter.recordSteps(stepsThisTick, performance.now());
 *   const simHz = meter.getRateHz(performance.now());
 *
 * The meter records timestamps for each individual step (not per outer
 * tick) so a tick that ran 4 catch-up steps still feeds the rolling
 * window correctly. Internally, expired samples are evicted on every
 * `recordSteps` / `getRateHz` call so memory stays bounded by the
 * window size × max steps-per-second.
 */
export class TickRateMeter {
  readonly windowMs: number;

  /**
   * Wall-clock timestamps of recent simulation steps, oldest first.
   * Pruned on every read/write to drop entries older than `windowMs`.
   */
  private readonly samples: number[] = [];

  constructor(options: TickRateMeterOptions = {}) {
    const windowMs = options.windowMs ?? DEFAULT_TICK_RATE_WINDOW_MS;
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new Error(
        `TickRateMeter: windowMs must be a positive finite number, got ${windowMs}`,
      );
    }
    this.windowMs = windowMs;
  }

  /**
   * Record `steps` simulation steps that all happened around `nowMs`.
   *
   * The caller passes the number of steps that ran in the most recent
   * outer tick (typically 0, 1, or 2 — but the spiral-of-death cap in
   * `GameLoop` allows up to 8) and the current wall-clock timestamp.
   * The meter stores one sample per step so the rolling window reflects
   * each individual physics advance.
   */
  recordSteps(steps: number, nowMs: number): void {
    if (!Number.isFinite(nowMs)) return;
    const safeSteps = Number.isFinite(steps) && steps > 0 ? Math.floor(steps) : 0;
    for (let i = 0; i < safeSteps; i += 1) {
      this.samples.push(nowMs);
    }
    this.evictOlderThan(nowMs - this.windowMs);
  }

  /**
   * Compute the current rate in Hz (steps per second). Returns 0 if no
   * steps have been observed yet — the overlay's `formatRate` paints
   * "0" rather than "—" in that case so the difference is visible.
   *
   * The rate is normalised to a full second so a partial window doesn't
   * over-report — e.g. 8 steps in the most recent 100 ms reports 80 Hz,
   * not "8 steps".
   */
  getRateHz(nowMs: number): number {
    if (!Number.isFinite(nowMs)) return 0;
    this.evictOlderThan(nowMs - this.windowMs);
    if (this.samples.length === 0) return 0;
    return this.samples.length * (1000 / this.windowMs);
  }

  /** Number of samples currently in the rolling window. */
  size(): number {
    return this.samples.length;
  }

  /** Drop every sample so the next read starts a clean window. */
  reset(): void {
    this.samples.length = 0;
  }

  private evictOlderThan(cutoffMs: number): void {
    // Samples are appended in non-decreasing order so we can short-
    // circuit the eviction by walking from the front.
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop]! < cutoffMs) {
      drop += 1;
    }
    if (drop > 0) {
      this.samples.splice(0, drop);
    }
  }
}
