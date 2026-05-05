/**
 * In-match FPS counter overlay — Sub-AC 3 of AC 3.
 *
 * Pinned to the top-left of the viewport, the overlay renders a single
 * monospace line that displays:
 *
 *   • Render FPS — the rolling-average rate at which Phaser is firing
 *     its render loop. Sourced from `Phaser.Game.loop.actualFps` (which
 *     is itself smoothed). Painted green / yellow / red depending on
 *     whether the rate is meeting the 60 FPS target — see
 *     {@link fpsHealthColor}.
 *
 *   • Simulation tick rate — the rolling-average rate at which the
 *     deterministic fixed-timestep `GameLoop` is advancing the world.
 *     Computed by {@link TickRateMeter} over a 500 ms window so the
 *     readout doesn't flicker between integers each rAF cycle. In a
 *     healthy match this should sit at exactly 60 Hz; if it diverges
 *     from the render rate, the simulation is either falling behind
 *     (frame budget exceeded) or running catch-up steps (tab regained
 *     focus after backgrounding).
 *
 *   • Target FPS — the configured 60 FPS lock from
 *     `GAME_CONFIG.targetFps`. Helps a bug reporter screenshot the
 *     overlay and immediately see what the gameplay budget is.
 *
 * Why this is a separate component (not just two more `add.text` lines
 * inlined into MatchScene):
 *
 *   • Reusable — every gameplay scene (MatchScene, the M3 stage-builder
 *     preview, the M4 replay player) wants the same overlay. A shared
 *     module avoids three near-duplicate copies drifting out of sync.
 *   • Testable — the Phaser-touching class hides behind a narrow scene
 *     shim so the unit suite can mock it without booting jsdom; pure
 *     formatting + the rolling window meter live in `fpsCounterFormat`.
 *   • Single source of the 60-FPS contract — the colour ramp is the
 *     only place we encode "below this threshold = bug report"; updating
 *     the threshold updates every overlay at once.
 *
 * Determinism note: this overlay reads wall-clock timestamps and
 * Phaser's smoothed FPS — both inherently non-deterministic. That's
 * fine because the overlay is render-only: it has zero feedback into
 * gameplay state. Replays still produce identical *gameplay* frames;
 * the overlay's text just reflects the host machine's render cadence.
 */

import type Phaser from 'phaser';
import { GAME_CONFIG } from '../engine/constants';
import {
  TickRateMeter,
  colorIntToHexString,
  fpsHealthColor,
  formatFpsLine,
} from './fpsCounterFormat';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FpsCounterOptions {
  /** Distance in px from the left edge of the viewport. Default 12. */
  readonly leftMargin?: number;
  /** Distance in px from the top edge of the viewport. Default 12. */
  readonly topMargin?: number;
  /** Font size of the overlay text in px. Default 14. */
  readonly fontSize?: number;
  /**
   * Window size for the simulation tick-rate meter, in milliseconds.
   * Defaults to 500 ms — responsive without flickering. Exposed mostly
   * for the unit suite; production scenes accept the default.
   */
  readonly tickRateWindowMs?: number;
  /**
   * Target FPS shown on the overlay. Defaults to the engine's configured
   * `GAME_CONFIG.targetFps` (60). Exposed so a future debug menu can
   * temporarily render against a different target.
   */
  readonly targetFps?: number;
  /**
   * Render depth — large enough to beat every gameplay layer. Defaults
   * to 10000 (well above the damage HUD's 1000) so the overlay never
   * disappears behind a freshly-spawned text object.
   */
  readonly depth?: number;
}

// ---------------------------------------------------------------------------
// Internal — minimal scene shape so tests can mock without Phaser
// ---------------------------------------------------------------------------

interface FpsTextLike {
  setText(value: string): FpsTextLike;
  setColor(color: string): FpsTextLike;
  setOrigin(x: number, y?: number): FpsTextLike;
  setScrollFactor(x: number, y?: number): FpsTextLike;
  setPosition(x: number, y: number): FpsTextLike;
  setDepth(depth: number): FpsTextLike;
  destroy(): void;
  text: string;
}

interface FpsGameLike {
  loop: { actualFps: number };
}

interface FpsSceneLike {
  game: FpsGameLike;
  scale: { gameSize: { width: number; height: number } };
  add: {
    text(
      x: number,
      y: number,
      content: string,
      style: Record<string, unknown>,
    ): FpsTextLike;
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS: Required<Omit<FpsCounterOptions, 'targetFps'>> = {
  leftMargin: 12,
  topMargin: 12,
  fontSize: 14,
  tickRateWindowMs: 500,
  depth: 10000,
};

// ---------------------------------------------------------------------------
// FpsCounter
// ---------------------------------------------------------------------------

/**
 * Top-left FPS overlay. One instance per gameplay scene; created in
 * `create()` and updated once per render frame from the scene's render
 * hook. Lifecycle:
 *
 *   const fps = new FpsCounter(scene);
 *   // every fixed step, after the engine reports how many steps it ran:
 *   fps.recordSimSteps(stepsThisTick);
 *   // every render frame:
 *   fps.update();
 *   // teardown:
 *   fps.destroy();
 */
export class FpsCounter {
  private readonly scene: FpsSceneLike;
  private readonly options: Required<Omit<FpsCounterOptions, 'targetFps'>>;
  private readonly targetFps: number;
  private readonly text: FpsTextLike;
  private readonly tickMeter: TickRateMeter;

  /** Last formatted line, cached so identical frames skip `setText`. */
  private lastRenderedText = '';
  /** Last paint colour, cached so unchanged bands skip `setColor`. */
  private lastRenderedColor = -1;
  /** Set true on `destroy()` so a stray late `update()` is a no-op. */
  private destroyed = false;

  /**
   * Wall-clock provider. Pulled out as a constructor argument so the
   * unit suite can drive the meter with a synthetic clock; production
   * callers leave it as the default and we read `performance.now()`.
   */
  private readonly nowFn: () => number;

  constructor(
    scene: Phaser.Scene | FpsSceneLike,
    options: FpsCounterOptions = {},
    nowFn: () => number = defaultNow,
  ) {
    this.scene = scene as unknown as FpsSceneLike;
    this.options = { ...DEFAULTS, ...stripUndefined(omitTargetFps(options)) };
    this.targetFps = options.targetFps ?? GAME_CONFIG.targetFps;
    this.nowFn = nowFn;
    this.tickMeter = new TickRateMeter({
      windowMs: this.options.tickRateWindowMs,
    });

    // Create the overlay text in its initial "—" state. The very first
    // `update()` call replaces these with live readings.
    const initialLine = formatFpsLine(Number.NaN, 0, this.targetFps);
    const initialColor = fpsHealthColor(Number.NaN);
    this.text = this.scene.add
      .text(this.options.leftMargin, this.options.topMargin, initialLine, {
        fontFamily: 'monospace',
        fontSize: `${this.options.fontSize}px`,
        color: colorIntToHexString(initialColor),
      })
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setDepth(this.options.depth);
    this.lastRenderedText = initialLine;
    this.lastRenderedColor = initialColor;
  }

  // -------------------------------------------------------------------------
  // Per-fixed-step input
  // -------------------------------------------------------------------------

  /**
   * Tell the overlay how many simulation steps just ran in the most
   * recent outer tick. Called from the scene's `update()` after
   * `physicsEngine.advance(...)` returns — its return value is the
   * number of steps the loop executed for that tick.
   *
   * Idempotent on `steps === 0` (no samples recorded). Late calls
   * after `destroy()` are no-ops.
   */
  recordSimSteps(steps: number): void {
    if (this.destroyed) return;
    this.tickMeter.recordSteps(steps, this.nowFn());
  }

  // -------------------------------------------------------------------------
  // Per-render-frame update
  // -------------------------------------------------------------------------

  /**
   * Refresh the overlay's text + colour from the current render-FPS
   * and the rolling simulation tick rate. Idempotent — calling with an
   * unchanged set of values is a no-op (no `setText` work).
   */
  update(): void {
    if (this.destroyed) return;

    const renderFps = this.scene.game.loop.actualFps;
    const simHz = this.tickMeter.getRateHz(this.nowFn());
    const line = formatFpsLine(renderFps, simHz, this.targetFps);
    const color = fpsHealthColor(renderFps);

    if (line !== this.lastRenderedText) {
      this.text.setText(line);
      this.lastRenderedText = line;
    }
    if (color !== this.lastRenderedColor) {
      this.text.setColor(colorIntToHexString(color));
      this.lastRenderedColor = color;
    }
  }

  // -------------------------------------------------------------------------
  // Public accessors
  // -------------------------------------------------------------------------

  /**
   * Read-only handle to the underlying text object — useful for tests
   * and for debug overlays that want to layer additional info next to
   * it. Do NOT mutate via this handle in production code.
   */
  getText(): FpsTextLike {
    return this.text;
  }

  /**
   * Latest computed simulation tick rate in Hz. Reads the rolling
   * window without re-rendering — the Replay/scene tests use this to
   * assert the overlay's view of "is the engine ticking at 60 Hz".
   */
  getSimHz(): number {
    if (this.destroyed) return 0;
    return this.tickMeter.getRateHz(this.nowFn());
  }

  /**
   * The configured target FPS. Tests pin this so a future config refactor
   * doesn't silently change what the overlay reports.
   */
  getTargetFps(): number {
    return this.targetFps;
  }

  /**
   * Latest one-shot render-FPS reading. Reads `Phaser.Game.loop.actualFps`
   * directly so a stale cache can't lie about the host's render rate.
   */
  getRenderFps(): number {
    if (this.destroyed) return 0;
    return this.scene.game.loop.actualFps;
  }

  /**
   * The current formatted overlay line. Mostly for tests; production
   * code reads from the underlying `getText().text`.
   */
  getCurrentLine(): string {
    return this.lastRenderedText;
  }

  /**
   * Sample-count snapshot — exposed for the test suite's assertions on
   * the rolling window's eviction behaviour.
   */
  getTickMeterSampleCount(): number {
    return this.tickMeter.size();
  }

  // -------------------------------------------------------------------------
  // Lifecycle helpers
  // -------------------------------------------------------------------------

  /**
   * Re-position the overlay (e.g. after a viewport resize). Cheap;
   * MatchScene can hook this to `scale.on('resize')` if responsive
   * layout becomes a concern later.
   */
  relayout(): void {
    if (this.destroyed) return;
    this.text.setPosition(this.options.leftMargin, this.options.topMargin);
  }

  /**
   * Returns the overlay to a clean state — drops every recorded
   * tick-rate sample and clears the text cache so a new match starts
   * with no carryover from the previous one. Render rate keeps reading
   * directly from Phaser.
   */
  reset(): void {
    if (this.destroyed) return;
    this.tickMeter.reset();
    const initialLine = formatFpsLine(Number.NaN, 0, this.targetFps);
    const initialColor = fpsHealthColor(Number.NaN);
    this.text.setText(initialLine);
    this.text.setColor(colorIntToHexString(initialColor));
    this.lastRenderedText = initialLine;
    this.lastRenderedColor = initialColor;
  }

  /**
   * Destroy the overlay's text object. Idempotent so MatchScene's
   * SHUTDOWN handler can call it without a "did we already destroy?"
   * flag elsewhere.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.text.destroy();
    this.tickMeter.reset();
    this.lastRenderedText = '';
    this.lastRenderedColor = -1;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultNow(): number {
  // `performance` may be undefined in the worker / Node test paths, so
  // fall back to `Date.now()` for environments without it.
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    const v = obj[key];
    if (v !== undefined) {
      out[key] = v;
    }
  }
  return out;
}

function omitTargetFps(opts: FpsCounterOptions): Omit<FpsCounterOptions, 'targetFps'> {
  // Manual destructure so we don't need a non-null assertion / cast.
  const {
    leftMargin,
    topMargin,
    fontSize,
    tickRateWindowMs,
    depth,
  } = opts;
  return {
    leftMargin,
    topMargin,
    fontSize,
    tickRateWindowMs,
    depth,
  };
}

// ---------------------------------------------------------------------------
// Re-exports kept here so `FpsCounter` consumers don't need a deep import
// ---------------------------------------------------------------------------

export {
  TickRateMeter,
  formatFpsLine,
  formatRate,
  fpsHealthColor,
  FPS_HEALTH_RAMP,
  colorIntToHexString as fpsCounterColorIntToHexString,
} from './fpsCounterFormat';
export type { TickRateMeterOptions } from './fpsCounterFormat';
