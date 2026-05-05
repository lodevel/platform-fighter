/**
 * `WindZoneHazard` — directional force-field stage hazard for the WIND
 * stage (AC 10102 Sub-AC 2 — "Build Stage 2 with its collision geometry,
 * spawn points, and stage-specific hazard behavior wired into match
 * mode").
 *
 * Sibling of {@link LavaHazard}: same Phaser-free, deterministic,
 * frame-counter-driven design, but instead of a vertical column whose
 * `height` oscillates, this entity owns a directional **force vector**
 * whose magnitude oscillates over a fixed cycle. While a fighter
 * overlaps the wind zone's AABB, the {@link WindForceController}
 * applies the entity's `getCurrentForce()` to the fighter's body each
 * fixed step — pushing them off-stage on the gust apex and dragging
 * them back the other way half a cycle later.
 *
 * Why a Phaser-free entity (mirroring `LavaHazard`):
 *
 *   • **Determinism.** Every observable is a pure function of the
 *     integer frame counter and the immutable per-hazard configuration
 *     (peak force, cycle length, phase offset, AABB bounds). No
 *     `Math.random()`, no `Date.now()`, no Phaser tweens. Two replays
 *     driving identical inputs produce byte-identical force outputs.
 *
 *   • **Headless tests.** The deterministic core can be exercised
 *     under plain Node/Vitest without Matter.js or Phaser, mirroring
 *     `LavaHazard.test.ts`.
 *
 *   • **Reusable.** The stage builder preview, AI pathfinding ("avoid
 *     the wind zone when forceX is pushing me toward a blast zone"),
 *     and the runtime force-application controller all read the same
 *     entity. Bundling Matter into this file would force every reader
 *     to pull Phaser into its import graph.
 *
 * Oscillation contract:
 *
 *   • One **cycle** is `cycleFrames` long. Cycle position is computed
 *     in fixed-point integer frames so floating-point drift can never
 *     desync the replay.
 *
 *   • The force magnitude follows a smooth cosine curve:
 *       force(t) = peakForce × cos(2π × (frame + phaseFrames) / cycle)
 *     Phase 0 → peak gust in the authored direction; phase 0.5 → peak
 *     gust in the reversed direction; phase 0.25/0.75 → quiet (force
 *     near zero). The curve is C¹ (no derivative discontinuities) so
 *     fighters glide rather than snap between gusts.
 *
 *   • An `activeThreshold` (cycle-fraction, 0..1) classifies the wind
 *     as "active" — i.e. the force magnitude is high enough to push
 *     fighters meaningfully. Below the threshold the gust is gentle
 *     and the {@link WindForceController} applies no force, matching
 *     the lava hazard's active-state gating model so the two hazards
 *     share one tested control flow.
 *
 *   • A configurable `phaseFrames` offset lets two wind zones on the
 *     same stage stagger — zone A at apex while zone B is at trough,
 *     so a fighter knocked off either side has a predictable safe
 *     window during the recovery. The unit tests lock down phase
 *     symmetry exactly as `LavaHazard.test.ts` locks down its
 *     "always-safe-side" property.
 *
 * Snapshot/restore:
 *
 *   • `toState()` returns just the frame counter — that is the *only*
 *     mutable state on the entity, by design. Everything else is
 *     immutable configuration.
 *
 *   • `fromState(s)` restores from a snapshot. Combined with the
 *     state-snapshot interval (`GAME_CONFIG.snapshotIntervalFrames =
 *     300`), this lets the M4 replay VCR scrub to any frame and
 *     resync the wind to the exact pixel.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Construction options for a `WindZoneHazard`. All distances are in
 * **design-space pixels** (1920×1080) and force magnitudes in
 * **px/frame²** so the renderer can apply uniform stage scale at draw
 * time and the entity stays Phaser-free.
 */
export interface WindZoneHazardOptions {
  /** Stable identifier — used for replay diffing and HUD labels. Defaults to `'wind'`. */
  readonly id?: string;
  /** Centre X of the wind zone (design pixels). */
  readonly x: number;
  /** Centre Y of the wind zone (design pixels). */
  readonly y: number;
  /** Width of the wind zone AABB (design pixels). Must be > 0. */
  readonly width: number;
  /** Height of the wind zone AABB (design pixels). Must be > 0. */
  readonly height: number;
  /**
   * Peak horizontal force at cycle apex (design px / frame²). Sign
   * carries direction — negative blows toward -X (leftward), positive
   * blows toward +X (rightward). Optional; defaults to
   * `WIND_DEFAULTS.peakForceX`.
   */
  readonly peakForceX?: number;
  /**
   * Peak vertical force at cycle apex (design px / frame²). Sign
   * convention: negative pushes upward (toward -Y in screen space),
   * positive pushes downward. Optional; defaults to `0` (horizontal
   * gust only).
   */
  readonly peakForceY?: number;
  /**
   * Total cycle length in frames (one full gust forward + reverse).
   * Default `360` (~6 s @ 60 fps). Must be a positive integer ≥ 2 —
   * anything smaller cannot represent both a forward and a reverse
   * gust.
   */
  readonly cycleFrames?: number;
  /**
   * Initial phase offset in frames. The hazard starts at cycle
   * position `phaseFrames % cycleFrames`. Default `0`. Negative values
   * are normalised modulo `cycleFrames`.
   */
  readonly phaseFrames?: number;
  /**
   * Cycle-position cosine-magnitude (0..1) above which the wind is
   * "active" (applies meaningful force). Below the threshold the
   * gust is gentle and {@link WindForceController} applies no force.
   * Default `WIND_DEFAULTS.activeThreshold` (0.5).
   */
  readonly activeThreshold?: number;
}

/** Snapshot used by the replay state-snapshot system. */
export interface WindZoneHazardState {
  readonly frame: number;
}

/** Axis-aligned bounds of the wind zone — geometry is immutable. */
export interface WindZoneBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Currently-applied force vector (per fixed step). */
export interface WindForceVector {
  readonly x: number;
  readonly y: number;
}

// ---------------------------------------------------------------------------
// Defaults / public constants
// ---------------------------------------------------------------------------

/**
 * Tunable defaults for wind zones. Exported so unit tests, the stage
 * builder UI, and balance docs can reference the canonical values
 * without duplicating magic numbers. The peak force is tuned to push
 * an airborne fighter several pixels per frame at apex without making
 * recovery impossible — equivalent to ~10 px/s² real movement at
 * 60 Hz, modulated by the 0..1 cosine.
 */
export const WIND_DEFAULTS = {
  /** ~6 s @ 60 fps — one full forward + reverse gust. */
  cycleFrames: 360,
  /**
   * Default peak horizontal force — px/frame². Tuned so an airborne
   * fighter's velocity shifts measurably (a few px/s) at apex but the
   * stage is still recoverable. Matches the seed's "tactical
   * recovery" pacing.
   */
  peakForceX: 0.45,
  /** Default peak vertical force (gusts are horizontal-only by default). */
  peakForceY: 0,
  /** Cycle-fraction above which the wind is "active". */
  activeThreshold: 0.5,
} as const;

/**
 * Phase classification used by the renderer (visual tint), AI (avoid
 * vs. ride), and force application (apply vs. ignore).
 *
 *   - `'quiet'`        — magnitude < activeThreshold; gust is gentle,
 *                        no force applied.
 *   - `'forward'`      — gust at meaningful magnitude in the authored
 *                        direction (cosine > +threshold).
 *   - `'reverse'`      — gust at meaningful magnitude in the reversed
 *                        direction (cosine < -threshold).
 */
export type WindPhase = 'quiet' | 'forward' | 'reverse';

// ---------------------------------------------------------------------------
// Pure helpers — exported so unit tests can lock down the curve shape
// without instantiating a `WindZoneHazard`.
// ---------------------------------------------------------------------------

/**
 * Cycle-cosine in [-1, +1]. A pure function of the integer frame and
 * cycle length. Used by both the runtime entity and the test suite so
 * the curve is the single source of truth.
 */
export function windCycleCosine(frame: number, cycleFrames: number): number {
  if (!Number.isFinite(frame) || !Number.isFinite(cycleFrames)) {
    throw new Error(
      `windCycleCosine: frame and cycleFrames must be finite numbers ` +
        `(got frame=${frame}, cycleFrames=${cycleFrames}).`,
    );
  }
  if (cycleFrames < 2) {
    throw new Error(
      `windCycleCosine: cycleFrames must be >= 2, got ${cycleFrames}.`,
    );
  }
  const period = Math.floor(cycleFrames);
  let pos = Math.floor(frame) % period;
  if (pos < 0) pos += period;
  return Math.cos((2 * Math.PI * pos) / period);
}

// ---------------------------------------------------------------------------
// Authoring-record → runtime-entity bridge
// ---------------------------------------------------------------------------

/**
 * Minimal shape of the `StageHazard` authoring record this entity
 * accepts. Mirrors the public `StageHazard` interface (`src/types`)
 * but typed locally so the entity stays Phaser-free without picking
 * up a cycle through `types ⇄ entities ⇄ types`.
 */
export interface WindStageHazardLike {
  readonly type: string;
  readonly id?: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly cycleFrames?: number;
  readonly phaseFrames?: number;
  readonly forceX?: number;
  readonly forceY?: number;
  readonly activeThreshold?: number;
}

/**
 * Convert a `StageHazard` authoring record (wind type) into a runtime
 * {@link WindZoneHazard} entity, applying canonical {@link WIND_DEFAULTS}
 * fallbacks for any optional field omitted by the record. Phaser-free
 * so the integration test (which runs under plain Node) can drive the
 * exact same translation path the live renderer uses.
 *
 * Throws on a non-wind `StageHazard.type` so a programmer mistake
 * surfaces as a clear error rather than a silent no-op.
 */
export function createWindHazardFromStageHazard(
  stageHazard: WindStageHazardLike,
): WindZoneHazard {
  if (stageHazard.type !== 'wind') {
    throw new Error(
      `createWindHazardFromStageHazard: hazard.type must be 'wind', got '${stageHazard.type}'.`,
    );
  }
  return new WindZoneHazard({
    id: stageHazard.id ?? 'wind',
    x: stageHazard.x,
    y: stageHazard.y,
    width: stageHazard.width,
    height: stageHazard.height,
    peakForceX: stageHazard.forceX ?? WIND_DEFAULTS.peakForceX,
    peakForceY: stageHazard.forceY ?? WIND_DEFAULTS.peakForceY,
    cycleFrames: stageHazard.cycleFrames ?? WIND_DEFAULTS.cycleFrames,
    phaseFrames: stageHazard.phaseFrames ?? 0,
    activeThreshold:
      stageHazard.activeThreshold ?? WIND_DEFAULTS.activeThreshold,
  });
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Periodic directional wind hazard — owns no Phaser objects, drives
 * all downstream renderer/force behaviour from a single integer frame
 * counter. See file header for the design rationale.
 */
export class WindZoneHazard {
  private readonly _id: string;
  private readonly _x: number;
  private readonly _y: number;
  private readonly _width: number;
  private readonly _height: number;
  private readonly _peakForceX: number;
  private readonly _peakForceY: number;
  private readonly _cycleFrames: number;
  private readonly _phaseFrames: number;
  private readonly _activeThreshold: number;

  /**
   * Mutable frame counter — the only piece of state on the entity.
   * Wrapped modulo `cycleFrames` after every tick so it stays a small
   * integer across very long matches / replays.
   */
  private _frame = 0;

  constructor(opts: WindZoneHazardOptions) {
    // ---- Validate geometry ------------------------------------------------
    if (!Number.isFinite(opts.x) || !Number.isFinite(opts.y)) {
      throw new Error(
        `WindZoneHazard: x and y must be finite (got x=${opts.x}, y=${opts.y}).`,
      );
    }
    if (!(opts.width > 0)) {
      throw new Error(
        `WindZoneHazard: width must be > 0, got ${opts.width}.`,
      );
    }
    if (!(opts.height > 0)) {
      throw new Error(
        `WindZoneHazard: height must be > 0, got ${opts.height}.`,
      );
    }

    // ---- Validate force vector --------------------------------------------
    const peakForceX = opts.peakForceX ?? WIND_DEFAULTS.peakForceX;
    if (!Number.isFinite(peakForceX)) {
      throw new Error(
        `WindZoneHazard: peakForceX must be finite, got ${peakForceX}.`,
      );
    }
    const peakForceY = opts.peakForceY ?? WIND_DEFAULTS.peakForceY;
    if (!Number.isFinite(peakForceY)) {
      throw new Error(
        `WindZoneHazard: peakForceY must be finite, got ${peakForceY}.`,
      );
    }

    // ---- Validate cycle ---------------------------------------------------
    const cycleFrames = opts.cycleFrames ?? WIND_DEFAULTS.cycleFrames;
    if (!Number.isInteger(cycleFrames) || cycleFrames < 2) {
      throw new Error(
        `WindZoneHazard: cycleFrames must be an integer >= 2 (got ${cycleFrames}).`,
      );
    }

    // ---- Validate threshold ----------------------------------------------
    const activeThreshold =
      opts.activeThreshold ?? WIND_DEFAULTS.activeThreshold;
    if (
      !Number.isFinite(activeThreshold) ||
      activeThreshold < 0 ||
      activeThreshold > 1
    ) {
      throw new Error(
        `WindZoneHazard: activeThreshold must be in [0, 1] (got ${activeThreshold}).`,
      );
    }

    this._id = opts.id ?? 'wind';
    this._x = opts.x;
    this._y = opts.y;
    this._width = opts.width;
    this._height = opts.height;
    this._peakForceX = peakForceX;
    this._peakForceY = peakForceY;
    this._cycleFrames = cycleFrames;
    // Normalise the initial phase offset modulo cycleFrames so a caller
    // can pass any integer (positive, negative, larger than the cycle)
    // without worrying about wrap-around.
    const rawPhase = Math.floor(opts.phaseFrames ?? 0) % cycleFrames;
    this._phaseFrames = rawPhase < 0 ? rawPhase + cycleFrames : rawPhase;
    this._activeThreshold = activeThreshold;
  }

  // ---- Identity / immutable config ---------------------------------------

  getId(): string {
    return this._id;
  }
  getX(): number {
    return this._x;
  }
  getY(): number {
    return this._y;
  }
  getWidth(): number {
    return this._width;
  }
  getHeight(): number {
    return this._height;
  }
  getPeakForceX(): number {
    return this._peakForceX;
  }
  getPeakForceY(): number {
    return this._peakForceY;
  }
  getCycleFrames(): number {
    return this._cycleFrames;
  }
  getPhaseFrames(): number {
    return this._phaseFrames;
  }
  getActiveThreshold(): number {
    return this._activeThreshold;
  }

  /** Static AABB of the wind zone — geometry is immutable. */
  getBounds(): WindZoneBounds {
    return {
      x: this._x,
      y: this._y,
      width: this._width,
      height: this._height,
    };
  }

  // ---- Time / phase ------------------------------------------------------

  /** Advance one fixed timestep. Wraps at `cycleFrames` to stay tiny. */
  tick(): void {
    this._frame = (this._frame + 1) % this._cycleFrames;
  }

  /**
   * Reset the frame counter. Defaults to 0; callers can pass any
   * integer (including a snapshot frame number) — the value is
   * normalised modulo `cycleFrames`.
   */
  reset(toFrame: number = 0): void {
    if (!Number.isFinite(toFrame)) {
      throw new Error(
        `WindZoneHazard.reset: toFrame must be finite, got ${toFrame}.`,
      );
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
   * Cosine value in [-1, +1] for the current cycle position. Includes
   * the phase offset so two zones with different `phaseFrames` are out
   * of phase even at frame 0.
   */
  getCosine(): number {
    return windCycleCosine(this._frame + this._phaseFrames, this._cycleFrames);
  }

  /**
   * Currently-applied force vector (per fixed step). Equal to
   * `(peakForce × cosine, peakForce × cosine)` — the cosine carries
   * sign so the force naturally reverses every half-cycle.
   */
  getCurrentForce(): WindForceVector {
    const c = this.getCosine();
    return { x: this._peakForceX * c, y: this._peakForceY * c };
  }

  /**
   * Phase classification — see {@link WindPhase}. Quiet windows are
   * useful for AI heuristics that decide when to attempt recovery, and
   * for the renderer to know when to dim the gust visuals.
   */
  getPhase(): WindPhase {
    const c = this.getCosine();
    if (Math.abs(c) < this._activeThreshold) return 'quiet';
    return c > 0 ? 'forward' : 'reverse';
  }

  /**
   * True iff the wind is currently active (cosine magnitude meets the
   * threshold). The {@link WindForceController} reads this to decide
   * whether to apply force this frame.
   */
  isActive(): boolean {
    return Math.abs(this.getCosine()) >= this._activeThreshold;
  }

  // ---- Snapshot / restore (replay system) -------------------------------

  /** Snapshot for the replay state-snapshot system. */
  toState(): WindZoneHazardState {
    return { frame: this._frame };
  }

  /**
   * Restore from snapshot. Reduces `frame` modulo `cycleFrames` so a
   * corrupted replay can't put the entity into an impossible state
   * (the modular reduction is *defensive*, not a feature — a clean
   * snapshot will always already be in range).
   */
  fromState(state: WindZoneHazardState): void {
    if (!state) {
      throw new Error('WindZoneHazard.fromState: state must not be null.');
    }
    if (!Number.isFinite(state.frame)) {
      throw new Error(
        `WindZoneHazard.fromState: frame must be finite (got ${state.frame}).`,
      );
    }
    if (state.frame < 0) {
      throw new Error(
        `WindZoneHazard.fromState: frame must be >= 0 (got ${state.frame}).`,
      );
    }
    this._frame = Math.floor(state.frame) % this._cycleFrames;
  }
}
