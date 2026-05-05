/**
 * `LavaHazard` — periodic rise/fall stage hazard (Sub-AC 1 of AC 9).
 *
 * Lives in `entities/` alongside `Fighter` because — like Fighter — it
 * is a per-frame runtime actor whose state participates in the
 * deterministic match simulation. Unlike Fighter it owns *no* Phaser
 * objects: this entity is the **pure-data driver** that decides where
 * the lava surface is, whether the lava is currently lethal, and how
 * much damage it deals per tick. The Phaser body + sprite + tween
 * adapter (Sub-AC 4 of AC 9) reads from this entity each fixed step
 * and translates that into Matter sensor reposition + visual
 * fill-height updates.
 *
 * Why a Phaser-free entity (mirroring `Rng`, `BlastZoneWatcher`,
 * `MatchEndDetector`):
 *
 *   • **Determinism.** The Seed mandates a fixed-timestep engine where
 *     replays reproduce identical state given identical inputs. Lava
 *     position is a pure function of the integer frame counter — no
 *     `Date.now()`, no `Math.random()`, no Phaser tween easing. The
 *     state-snapshot replay system can serialise just the frame
 *     counter and rehydrate the hazard exactly.
 *
 *   • **Headless tests.** Vitest under plain Node can drive
 *     `tick()` / `getCurrentHeight()` / `isActive()` for thousands of
 *     iterations to lock down the oscillation contract — no Phaser /
 *     jsdom required, just like `LocalInputHandler.test.ts` and
 *     `BlastZoneWatcher.test.ts` already do.
 *
 *   • **Reusable.** The stage builder's preview, the AI pathfinding
 *     ("avoid lava when isActive"), the replay scrubber's "rewind to
 *     frame N", and the runtime renderer all read the same entity.
 *     Bundling Matter into this file would force every reader to
 *     pull Phaser into its import graph.
 *
 * Oscillation contract (the bit Sub-AC 1 actually nails down):
 *
 *   • One **cycle** is `cycleFrames` long. Cycle position is computed
 *     in fixed-point integer frames so floating-point drift can never
 *     desync the replay.
 *
 *   • The lava surface follows a smooth cosine wave between
 *     `minHeight` (fully receded) at cycle position 0 and `maxHeight`
 *     (apex / lethal) at cycle position 0.5, returning to `minHeight`
 *     at cycle position 1. Smooth (C¹) so the renderer doesn't snap
 *     between frames — Smash-style lava reads as molten, not robotic.
 *
 *   • An `activeThreshold` (height-fraction of max, default 0.55)
 *     classifies the lava as "active" — i.e. the surface is high
 *     enough to damage fighters who overlap it. Below the threshold
 *     the lava is inert and characters can stand on the floor where
 *     the hazard sits without taking damage. This matches the
 *     "rising/falling, instant KO" pattern called out in the Seed
 *     ontology.
 *
 *   • A configurable `phaseFrames` offset lets two pools of lava on
 *     the same stage alternate — pool A rises while pool B falls,
 *     so the stage always offers a safe spot. The unit tests lock
 *     down phase-offset symmetry.
 *
 * Snapshot/restore:
 *
 *   • `toState()` returns just the frame counter — that is the *only*
 *     mutable state on the entity, by design. Everything else
 *     (`cycleFrames`, `phaseFrames`, geometry) is immutable
 *     configuration.
 *
 *   • `fromState(s)` restores from a snapshot. Combined with the
 *     state-snapshot interval (`GAME_CONFIG.snapshotIntervalFrames =
 *     300`), this lets the M4 replay VCR scrub to any frame and
 *     resync the lava to the exact pixel.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Construction options for a `LavaHazard`. All distances are in
 * **design-space pixels** (1920×1080) so the renderer can apply the
 * uniform stage scale at draw time and keep the entity Phaser-free.
 */
export interface LavaHazardOptions {
  /** Stable identifier — used for replay diffing and HUD labels. Defaults to `'lava'`. */
  readonly id?: string;
  /** Centre X of the lava column (design pixels). */
  readonly x: number;
  /**
   * Y of the lava's **resting bottom edge** (design pixels). The lava
   * grows *upward* from this baseline — i.e. `surfaceY = baseY -
   * currentHeight`. Authoring in terms of the resting bottom edge
   * means stage builders can drop a lava pool on top of any platform
   * surface without doing per-pool math.
   */
  readonly baseY: number;
  /** Width of the lava column (design pixels). */
  readonly width: number;
  /** Minimum (resting) height in design pixels. Default `0` — fully receded. */
  readonly minHeight?: number;
  /** Maximum (apex) height in design pixels. Required: how far the lava rises at peak. */
  readonly maxHeight: number;
  /**
   * Total cycle length in frames (one full rise + fall). Default `600`
   * (~10 s @ 60 fps). Must be a positive integer ≥ 2 — anything smaller
   * cannot represent both a rise and a fall.
   */
  readonly cycleFrames?: number;
  /**
   * Initial phase offset in frames. The hazard starts at cycle position
   * `phaseFrames % cycleFrames`. Default `0`. Negative values are
   * normalised modulo `cycleFrames`.
   */
  readonly phaseFrames?: number;
  /**
   * Damage in `%` applied per active-tick when a fighter overlaps the
   * lava body. Sub-AC 2 wires this into the collision handler; Sub-AC
   * 1 just exposes the value. Default `LAVA_DEFAULTS.damagePerTick`.
   */
  readonly damagePerTick?: number;
  /**
   * Cycle-position height fraction (0..1) above which the lava is
   * "active" (lethal). At apex (`heightNorm === 1`) the lava is always
   * active; below this threshold it is inert. Default
   * `LAVA_DEFAULTS.activeThreshold` (0.55) — i.e. the lava is lethal
   * for the upper ~half of its rise/fall window.
   */
  readonly activeThreshold?: number;
}

/**
 * Snapshot used by the replay state-snapshot system. The frame counter
 * is the *only* mutable state on the entity, so a single integer is
 * sufficient to reproduce the hazard pixel-perfect on rewind.
 */
export interface LavaHazardState {
  readonly frame: number;
}

/** Axis-aligned bounds of the *currently occupied* lava body. */
export interface LavaBounds {
  /** Centre X (design pixels). */
  readonly x: number;
  /** Centre Y (design pixels). */
  readonly y: number;
  /** Width (design pixels). */
  readonly width: number;
  /** Height (design pixels). Equal to `getCurrentHeight()`. */
  readonly height: number;
}

// ---------------------------------------------------------------------------
// Defaults / public constants
// ---------------------------------------------------------------------------

/**
 * Tunable defaults for lava hazards. Exported so unit tests, the stage
 * builder UI, and balance docs can reference the canonical values
 * without duplicating magic numbers.
 */
export const LAVA_DEFAULTS = {
  /** ~10 s @ 60 fps — one full rise + fall cycle. */
  cycleFrames: 600,
  /** Lava fully recedes at trough by default. */
  minHeight: 0,
  /** Damage % per active-tick — tuned to ~8% per overlap frame so a stuck fighter racks up percent fast. */
  damagePerTick: 8,
  /** Above this height-fraction the lava is "active" (lethal). */
  activeThreshold: 0.55,
} as const;

/**
 * Phase classification used by the renderer (tint), the AI (avoid),
 * and the damage system (apply).
 *
 *   - `'low_hold'`     — at or below `minHeight + ε`; lava effectively
 *                        gone, characters can cross safely.
 *   - `'rising'`       — phase < 0.5, height increasing.
 *   - `'falling'`      — phase ≥ 0.5, height decreasing.
 *   - `'high_hold'`    — at or near apex; reserved for future
 *                        piecewise hazards (Sub-AC 1 cosine never
 *                        plateaus, but the enum is shared).
 */
export type LavaPhase = 'low_hold' | 'rising' | 'falling' | 'high_hold';

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Math helper — returns the cycle's height normalised to [0..1] for a
 * given integer frame and cycle length. Uses a smooth cosine so the
 * lava surface has no derivative discontinuities, and clamps the
 * cycle position into integer frames so the result is identical across
 * runs given the same frame counter.
 *
 * Pure / exported so unit tests can lock down the curve shape without
 * instantiating a `LavaHazard`.
 */
export function lavaHeightNorm(frame: number, cycleFrames: number): number {
  if (!Number.isFinite(frame) || !Number.isFinite(cycleFrames)) {
    throw new Error(
      `lavaHeightNorm: frame and cycleFrames must be finite numbers ` +
        `(got frame=${frame}, cycleFrames=${cycleFrames}).`,
    );
  }
  if (cycleFrames < 2) {
    throw new Error(
      `lavaHeightNorm: cycleFrames must be >= 2 to model rise+fall, got ${cycleFrames}.`,
    );
  }
  // Normalise into [0, cycleFrames) using floor-mod so negative phase
  // offsets behave correctly (`-1 % 600 === -1` in JS, which is wrong
  // for periodic phase).
  const period = Math.floor(cycleFrames);
  let pos = Math.floor(frame) % period;
  if (pos < 0) pos += period;
  // Cosine wave: 0 → 0, period/2 → 1, period → 0.
  // Use (1 - cos(2π t / period)) / 2 ∈ [0, 1].
  const t = pos / period;
  return (1 - Math.cos(2 * Math.PI * t)) / 2;
}

/**
 * Periodic rise/fall lava hazard — owns no Phaser objects, drives all
 * downstream renderer/collision behaviour from a single integer frame
 * counter. See file header for the design rationale.
 */
export class LavaHazard {
  private readonly _id: string;
  private readonly _x: number;
  private readonly _baseY: number;
  private readonly _width: number;
  private readonly _minHeight: number;
  private readonly _maxHeight: number;
  private readonly _cycleFrames: number;
  private readonly _phaseFrames: number;
  private readonly _damagePerTick: number;
  private readonly _activeThreshold: number;

  /**
   * Mutable frame counter — the only piece of state on the entity.
   * Advances by 1 per `tick()`; serialised in `toState()`; restored
   * by `fromState()`. Stored as an integer so modulo arithmetic stays
   * exact across millions of frames (replays of long matches).
   */
  private _frame = 0;

  constructor(opts: LavaHazardOptions) {
    // ---- Validate geometry ------------------------------------------------
    if (!Number.isFinite(opts.x) || !Number.isFinite(opts.baseY)) {
      throw new Error(
        `LavaHazard: x and baseY must be finite (got x=${opts.x}, baseY=${opts.baseY}).`,
      );
    }
    if (!(opts.width > 0)) {
      throw new Error(`LavaHazard: width must be > 0, got ${opts.width}.`);
    }
    if (!(opts.maxHeight > 0)) {
      throw new Error(
        `LavaHazard: maxHeight must be > 0, got ${opts.maxHeight}.`,
      );
    }
    const minHeight = opts.minHeight ?? LAVA_DEFAULTS.minHeight;
    if (minHeight < 0) {
      throw new Error(
        `LavaHazard: minHeight must be >= 0, got ${minHeight}.`,
      );
    }
    if (minHeight >= opts.maxHeight) {
      throw new Error(
        `LavaHazard: minHeight (${minHeight}) must be < maxHeight (${opts.maxHeight}).`,
      );
    }

    // ---- Validate cycle ---------------------------------------------------
    const cycleFrames = opts.cycleFrames ?? LAVA_DEFAULTS.cycleFrames;
    if (!Number.isInteger(cycleFrames) || cycleFrames < 2) {
      throw new Error(
        `LavaHazard: cycleFrames must be an integer >= 2 (got ${cycleFrames}).`,
      );
    }

    // ---- Validate damage / threshold -------------------------------------
    const damagePerTick = opts.damagePerTick ?? LAVA_DEFAULTS.damagePerTick;
    if (damagePerTick < 0 || !Number.isFinite(damagePerTick)) {
      throw new Error(
        `LavaHazard: damagePerTick must be a finite, non-negative number (got ${damagePerTick}).`,
      );
    }
    const activeThreshold =
      opts.activeThreshold ?? LAVA_DEFAULTS.activeThreshold;
    if (activeThreshold < 0 || activeThreshold > 1) {
      throw new Error(
        `LavaHazard: activeThreshold must be in [0, 1] (got ${activeThreshold}).`,
      );
    }

    this._id = opts.id ?? 'lava';
    this._x = opts.x;
    this._baseY = opts.baseY;
    this._width = opts.width;
    this._minHeight = minHeight;
    this._maxHeight = opts.maxHeight;
    this._cycleFrames = cycleFrames;
    // Normalise the initial phase offset modulo cycleFrames so a caller
    // can pass any integer (positive, negative, larger than the cycle)
    // without worrying about wrap-around.
    const rawPhase = Math.floor(opts.phaseFrames ?? 0) % cycleFrames;
    this._phaseFrames = rawPhase < 0 ? rawPhase + cycleFrames : rawPhase;
    this._damagePerTick = damagePerTick;
    this._activeThreshold = activeThreshold;
  }

  // ---- Identity / immutable config ---------------------------------------

  /** Stable id — useful for replay diffing and HUD labels. */
  getId(): string {
    return this._id;
  }

  /** Total cycle length in frames. */
  getCycleFrames(): number {
    return this._cycleFrames;
  }

  /** Initial phase offset (already normalised into [0, cycleFrames)). */
  getPhaseFrames(): number {
    return this._phaseFrames;
  }

  /** Resting bottom edge Y (design pixels). */
  getBaseY(): number {
    return this._baseY;
  }

  /** Centre X (design pixels). */
  getX(): number {
    return this._x;
  }

  /** Width (design pixels). */
  getWidth(): number {
    return this._width;
  }

  /** Minimum / resting height (design pixels). */
  getMinHeight(): number {
    return this._minHeight;
  }

  /** Maximum / apex height (design pixels). */
  getMaxHeight(): number {
    return this._maxHeight;
  }

  /** Cycle-fraction threshold (0..1) above which the lava is active. */
  getActiveThreshold(): number {
    return this._activeThreshold;
  }

  // ---- Time / phase ------------------------------------------------------

  /** Advance one fixed timestep. */
  tick(): void {
    // Wrap before overflowing 32-bit precision. The modulo is cheap
    // and guarantees `_frame` stays a small integer across very long
    // matches / replays. We pre-modulo by `cycleFrames` so callers
    // observing `getFrame()` always see a value in [0, cycleFrames).
    this._frame = (this._frame + 1) % this._cycleFrames;
  }

  /**
   * Reset the frame counter. Defaults to 0; callers can pass any
   * integer (including a snapshot frame number) — the value is
   * normalised modulo `cycleFrames`. Useful for tests and for the
   * replay system's "rewind to frame N" path.
   */
  reset(toFrame: number = 0): void {
    if (!Number.isFinite(toFrame)) {
      throw new Error(`LavaHazard.reset: toFrame must be finite, got ${toFrame}.`);
    }
    let pos = Math.floor(toFrame) % this._cycleFrames;
    if (pos < 0) pos += this._cycleFrames;
    this._frame = pos;
  }

  /** Current internal frame counter (already wrapped into [0, cycleFrames)). */
  getFrame(): number {
    return this._frame;
  }

  /**
   * Cycle position in [0, 1) — frame 0 is at 0, frame `cycleFrames/2`
   * is at 0.5 (apex), frame `cycleFrames - 1` is just shy of 1.
   * Includes the phase offset so two pools with different
   * `phaseFrames` are out of phase even at frame 0.
   */
  getCyclePhase(): number {
    const cf = this._cycleFrames;
    let pos = (this._frame + this._phaseFrames) % cf;
    if (pos < 0) pos += cf;
    return pos / cf;
  }

  /**
   * Normalised height in [0, 1] using the smooth cosine wave. Pure
   * function of the current frame + phase offset.
   */
  getHeightNorm(): number {
    return lavaHeightNorm(this._frame + this._phaseFrames, this._cycleFrames);
  }

  /**
   * Current lava height in design pixels. Linearly interpolates
   * between `minHeight` and `maxHeight` using `getHeightNorm()`.
   */
  getCurrentHeight(): number {
    const norm = this.getHeightNorm();
    return this._minHeight + norm * (this._maxHeight - this._minHeight);
  }

  /**
   * Current Y of the lava surface (top edge) in design pixels. The
   * surface descends as height grows (Phaser convention: y grows
   * down), so `surfaceY = baseY - currentHeight`.
   */
  getSurfaceY(): number {
    return this._baseY - this.getCurrentHeight();
  }

  /**
   * Bounding box of the *currently occupied* lava body. The bounds'
   * `height` matches `getCurrentHeight()`, and the `y` is the
   * vertical centre — i.e. `baseY - height/2`. Renderers and damage
   * checks consume these bounds directly.
   */
  getBounds(): LavaBounds {
    const h = this.getCurrentHeight();
    return {
      x: this._x,
      y: this._baseY - h / 2,
      width: this._width,
      height: h,
    };
  }

  /** True while the cycle phase is in the rising half (phase < 0.5). */
  isRising(): boolean {
    return this.getCyclePhase() < 0.5;
  }

  /** True while the cycle phase is in the falling half (phase ≥ 0.5). */
  isFalling(): boolean {
    return !this.isRising();
  }

  /**
   * True when the lava is currently lethal — i.e. the normalised
   * height is at or above `activeThreshold`. Renderers tint the
   * surface bright red here; the damage handler only applies damage
   * when this returns `true`.
   */
  isActive(): boolean {
    return this.getHeightNorm() >= this._activeThreshold;
  }

  /**
   * Damage to apply per overlapping tick. Returns `0` when the lava
   * is not active so collision handlers can blindly call this without
   * an extra `isActive()` guard. Returns `damagePerTick` otherwise.
   */
  getDamagePerTick(): number {
    return this.isActive() ? this._damagePerTick : 0;
  }

  /**
   * Coarse phase classification — useful for renderer tinting and
   * AI heuristics. The cosine wave never truly *holds*, so we
   * pick narrow bands at the extrema (within 5% of trough/apex)
   * for `low_hold` / `high_hold`, falling back to `rising`/
   * `falling` for the rest of the cycle.
   */
  getPhase(): LavaPhase {
    const norm = this.getHeightNorm();
    if (norm <= 0.05) return 'low_hold';
    if (norm >= 0.95) return 'high_hold';
    return this.isRising() ? 'rising' : 'falling';
  }

  // ---- Snapshot / restore (replay system) -------------------------------

  /** Replay snapshot — only the frame counter is mutable. */
  toState(): LavaHazardState {
    return { frame: this._frame };
  }

  /** Restore from snapshot. Frame is normalised modulo `cycleFrames`. */
  fromState(state: LavaHazardState): void {
    if (!state || !Number.isFinite(state.frame)) {
      throw new Error(
        `LavaHazard.fromState: state.frame must be a finite number (got ${state?.frame}).`,
      );
    }
    let pos = Math.floor(state.frame) % this._cycleFrames;
    if (pos < 0) pos += this._cycleFrames;
    this._frame = pos;
  }
}
