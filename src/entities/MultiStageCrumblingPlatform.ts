/**
 * `MultiStageCrumblingPlatform` — degradation variant of the timer-based
 * crumbling platform (Sub-AC 2 of AC 10, M2 hazard stages).
 *
 * Sibling of {@link CrumblingPlatform}: the baseline crumbler has a
 * *single* warning phase (`triggered`) where the platform simply
 * wobbles, then drops. This variant subdivides that warning window into
 * three named sub-stages — **shake → crack → break** — each with its
 * own visual signature *and* a measurable collision degradation, so the
 * platform announces its imminent failure not just visually (cracks,
 * chunks) but *physically* (shrinking effective bounds, a `fragile`
 * flag the AI / physics adapter can read).
 *
 * Why a separate entity rather than a flag on `CrumblingPlatform`:
 *
 *   • **Clear contract.** The baseline platform's render hints are
 *     `{ alpha, wobbleNorm, dropOffset }` — adding three more (cracks,
 *     chunks, collision scale) and four more lifecycle phases would
 *     blow out the original entity's API surface. A variant keeps both
 *     contracts crisp and lets the M2 stage data choose which flavour
 *     a particular platform uses.
 *   • **Replay snapshot stability.** The replay system serialises every
 *     hazard's snapshot shape; the multi-stage variant's snapshot is a
 *     superset of the baseline's, but treating it as a *separate type*
 *     means an old replay can't accidentally rehydrate into the wrong
 *     entity.
 *   • **Determinism preserved.** All timing, all visuals, and all
 *     collision changes are pure functions of the integer frame
 *     counter and the configured per-sub-stage durations. No
 *     `Math.random()`, no `Date.now()`, no Phaser tweens. Replay-safe.
 *
 * Lifecycle (linear; no cancellation paths):
 *
 *   ┌────────┐ onSteppedOn ┌────────┐ shakeDuration ┌────────┐
 *   │ intact │────────────▶│ shake  │──────────────▶│ crack  │
 *   └────────┘              └────────┘                └────────┘
 *        ▲                                                │
 *        │ respawnDelay                                  │ crackDuration
 *        │                                                ▼
 *   ┌────────┐ fallDuration ┌──────────┐ breakDuration ┌────────┐
 *   │  gone  │◀─────────────│ falling  │◀──────────────│ break  │
 *   └────────┘              └──────────┘                └────────┘
 *
 *   • **intact**  — full bounds, full alpha, no cracks, no chunks.
 *                   Solid + visible. Steppable.
 *   • **shake**   — full bounds, wobble crescendos 0 → 1, no cracks
 *                   yet. Solid + visible. The classic "this floor is
 *                   shaking" cue.
 *   • **crack**   — bounds shrink slightly (chips around the edges),
 *                   wobble continues, crack overlay grows 0 → 1.
 *                   Solid (degraded) + visible. The physical "cracks
 *                   are forming" stage.
 *   • **break**   — bounds shrink further (chunks falling off), crack
 *                   overlay maxed, chunk overlay grows 0 → 1, fragile
 *                   flag flips on. Solid (heavily degraded) + visible.
 *                   The "this is about to fail" stage.
 *   • **falling** — no longer collidable. Renderer drops + fades the
 *                   sprite so the visual transition reads as "the
 *                   floor gave out".
 *   • **gone**    — invisible, not collidable. Respawn timer running.
 *
 * Snapshot/restore is byte-perfect — phase + per-phase frame counters
 * are the only mutable state. Combined with the immutable per-stage
 * durations and bounds, two instances driven by identical inputs
 * produce identical observable state on every frame.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Lifecycle phase. Linear progression with one feedback loop
 * (`gone → intact`). See file header for per-phase semantics.
 */
export type MultiStagePhase =
  | 'intact'
  | 'shake'
  | 'crack'
  | 'break'
  | 'falling'
  | 'gone';

/**
 * Construction options. All distances in **design-space pixels**
 * (1920×1080) so the renderer can apply uniform stage scale at draw
 * time and the entity stays Phaser-free.
 */
export interface MultiStageCrumblingPlatformOptions {
  /** Stable id — used for replay diffing and HUD labels. Defaults to `'multi-crumble'`. */
  readonly id?: string;
  /** Centre X of the platform (design pixels). */
  readonly x: number;
  /** Centre Y of the platform (design pixels). */
  readonly y: number;
  /** Width of the platform (design pixels). Must be > 0. */
  readonly width: number;
  /** Height of the platform (design pixels). Must be > 0. */
  readonly height: number;
  /** Frames the `shake` sub-stage lasts. Default 30 (~0.5s @ 60 fps). */
  readonly shakeDuration?: number;
  /** Frames the `crack` sub-stage lasts. Default 30 (~0.5s @ 60 fps). */
  readonly crackDuration?: number;
  /** Frames the `break` sub-stage lasts. Default 30 (~0.5s @ 60 fps). */
  readonly breakDuration?: number;
  /** Frames the visual fall plays before fully disappearing. Default 30. */
  readonly fallDuration?: number;
  /** Frames between `gone` and respawn. Default 120 (~2s @ 60 fps). */
  readonly respawnDelay?: number;
  /**
   * Width-scale at the *end* of the `crack` sub-stage. The collision
   * footprint linearly interpolates from 1.0 (intact) to this value
   * across `crack`. Default 0.92 (small chips around the edges).
   */
  readonly crackBoundsScale?: number;
  /**
   * Width-scale at the *end* of the `break` sub-stage. Bounds linearly
   * interpolate from `crackBoundsScale` to this value across `break`.
   * Default 0.7 (visible chunks gone). Must be ≤ `crackBoundsScale`.
   */
  readonly breakBoundsScale?: number;
}

/**
 * Replay snapshot. `phase` plus the absolute frame the phase began on
 * plus the absolute frame counter is enough to reproduce every
 * observable; immutable config does the rest.
 */
export interface MultiStageCrumblingState {
  readonly phase: MultiStagePhase;
  readonly phaseStartFrame: number;
  readonly frame: number;
}

/** Static (intact) AABB. Geometry is immutable; only effective bounds shrink during degradation. */
export interface MultiStageBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Renderer-facing visual + collision hints. All values are pure
 * functions of phase + elapsed-frames-in-phase, so two snapshots with
 * identical state produce identical hints.
 *
 *   • `alpha`         — opacity in [0..1]. 1 in intact/shake/crack,
 *                       1 in `break` (sprite stays solid until it
 *                       drops), fades 1 → 0 across `falling`, 0 in
 *                       `gone`.
 *   • `wobbleNorm`    — shake intensity in [0..1]. 0 in intact, ramps
 *                       linearly across the *combined* shake+crack+break
 *                       window so the visual cue keeps escalating
 *                       through every degradation sub-stage. 1 during
 *                       `falling`. 0 in `gone`.
 *   • `crackLevel`    — crack overlay intensity in [0..1]. 0 through
 *                       `shake`. Ramps 0 → 1 across `crack`. Stays 1
 *                       through `break` and `falling`. 0 in `gone`.
 *   • `chunkLevel`    — chunks-falling-off intensity in [0..1]. 0
 *                       through `shake` and `crack`. Ramps 0 → 1
 *                       across `break`. Stays 1 through `falling`.
 *                       0 in `gone`.
 *   • `dropOffset`    — visual Y-offset (design pixels). 0 outside
 *                       `falling`. Linearly increases from 0 to
 *                       {@link MULTI_STAGE_CRUMBLE_DEFAULTS.fallPixels}
 *                       across `falling`.
 *   • `boundsScale`   — current collision-bounds width-scale relative
 *                       to the intact bounds. 1 in intact/shake; ramps
 *                       1 → `crackBoundsScale` across `crack`; ramps
 *                       further to `breakBoundsScale` across `break`;
 *                       0 in falling/gone (no collision).
 *   • `fragile`       — true iff the platform is in the `break`
 *                       sub-stage. AI heuristics and audio adapters
 *                       can use this to flag "imminent failure".
 */
export interface MultiStageCrumblingRenderState {
  readonly alpha: number;
  readonly wobbleNorm: number;
  readonly crackLevel: number;
  readonly chunkLevel: number;
  readonly dropOffset: number;
  readonly boundsScale: number;
  readonly fragile: boolean;
}

// ---------------------------------------------------------------------------
// Defaults / public constants
// ---------------------------------------------------------------------------

/**
 * Tunable defaults. Exported so unit tests, the stage builder UI, and
 * balance docs can reference the canonical values without duplicating
 * magic numbers.
 *
 * Total warning window with defaults: 30 + 30 + 30 = 90 frames (~1.5s).
 * That's longer than the baseline `CrumblingPlatform`'s 60-frame
 * warning — this variant trades a bit more "telegraphing" for a much
 * richer visual + collision arc.
 */
export const MULTI_STAGE_CRUMBLE_DEFAULTS = {
  /** ~0.5s @ 60 fps — wobble buildup before cracks appear. */
  shakeDuration: 30,
  /** ~0.5s @ 60 fps — visible cracks form, edges chip away. */
  crackDuration: 30,
  /** ~0.5s @ 60 fps — chunks fall off, fragile flag on. */
  breakDuration: 30,
  /** ~0.5s @ 60 fps — visual drop animation. */
  fallDuration: 30,
  /** ~2s @ 60 fps — respawn gap. */
  respawnDelay: 120,
  /** Bounds at end of `crack`: 92 % of intact width (small chips). */
  crackBoundsScale: 0.92,
  /** Bounds at end of `break`: 70 % of intact width (heavy chunks gone). */
  breakBoundsScale: 0.7,
  /** Pixels the renderer drops the sprite by at the *end* of `falling`. */
  fallPixels: 240,
} as const;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Multi-stage crumbling platform — Phaser-free, deterministic, with
 * explicit shake → crack → break degradation visible both to the
 * renderer (overlay levels, alpha, wobble) and to the collision
 * adapter (shrinking effective bounds, fragile flag).
 *
 * See file header for the lifecycle diagram and design rationale.
 */
export class MultiStageCrumblingPlatform {
  private readonly _id: string;
  private readonly _x: number;
  private readonly _y: number;
  private readonly _width: number;
  private readonly _height: number;
  private readonly _shakeDuration: number;
  private readonly _crackDuration: number;
  private readonly _breakDuration: number;
  private readonly _fallDuration: number;
  private readonly _respawnDelay: number;
  private readonly _crackBoundsScale: number;
  private readonly _breakBoundsScale: number;

  private _phase: MultiStagePhase = 'intact';
  private _phaseStartFrame = 0;
  private _frame = 0;

  constructor(opts: MultiStageCrumblingPlatformOptions) {
    // ---- Validate geometry ------------------------------------------------
    if (!Number.isFinite(opts.x) || !Number.isFinite(opts.y)) {
      throw new Error(
        `MultiStageCrumblingPlatform: x and y must be finite (got x=${opts.x}, y=${opts.y}).`,
      );
    }
    if (!(opts.width > 0)) {
      throw new Error(
        `MultiStageCrumblingPlatform: width must be > 0, got ${opts.width}.`,
      );
    }
    if (!(opts.height > 0)) {
      throw new Error(
        `MultiStageCrumblingPlatform: height must be > 0, got ${opts.height}.`,
      );
    }

    // ---- Validate sub-stage durations ------------------------------------
    const shakeDuration =
      opts.shakeDuration ?? MULTI_STAGE_CRUMBLE_DEFAULTS.shakeDuration;
    if (!Number.isInteger(shakeDuration) || shakeDuration < 1) {
      throw new Error(
        `MultiStageCrumblingPlatform: shakeDuration must be a positive integer (got ${shakeDuration}).`,
      );
    }
    const crackDuration =
      opts.crackDuration ?? MULTI_STAGE_CRUMBLE_DEFAULTS.crackDuration;
    if (!Number.isInteger(crackDuration) || crackDuration < 1) {
      throw new Error(
        `MultiStageCrumblingPlatform: crackDuration must be a positive integer (got ${crackDuration}).`,
      );
    }
    const breakDuration =
      opts.breakDuration ?? MULTI_STAGE_CRUMBLE_DEFAULTS.breakDuration;
    if (!Number.isInteger(breakDuration) || breakDuration < 1) {
      throw new Error(
        `MultiStageCrumblingPlatform: breakDuration must be a positive integer (got ${breakDuration}).`,
      );
    }
    const fallDuration =
      opts.fallDuration ?? MULTI_STAGE_CRUMBLE_DEFAULTS.fallDuration;
    if (!Number.isInteger(fallDuration) || fallDuration < 1) {
      throw new Error(
        `MultiStageCrumblingPlatform: fallDuration must be a positive integer (got ${fallDuration}).`,
      );
    }
    const respawnDelay =
      opts.respawnDelay ?? MULTI_STAGE_CRUMBLE_DEFAULTS.respawnDelay;
    if (!Number.isInteger(respawnDelay) || respawnDelay < 1) {
      throw new Error(
        `MultiStageCrumblingPlatform: respawnDelay must be a positive integer (got ${respawnDelay}).`,
      );
    }

    // ---- Validate bounds-scale knobs ------------------------------------
    const crackBoundsScale =
      opts.crackBoundsScale ?? MULTI_STAGE_CRUMBLE_DEFAULTS.crackBoundsScale;
    if (
      !Number.isFinite(crackBoundsScale) ||
      crackBoundsScale <= 0 ||
      crackBoundsScale > 1
    ) {
      throw new Error(
        `MultiStageCrumblingPlatform: crackBoundsScale must be in (0, 1] (got ${crackBoundsScale}).`,
      );
    }
    const breakBoundsScale =
      opts.breakBoundsScale ?? MULTI_STAGE_CRUMBLE_DEFAULTS.breakBoundsScale;
    if (
      !Number.isFinite(breakBoundsScale) ||
      breakBoundsScale <= 0 ||
      breakBoundsScale > 1
    ) {
      throw new Error(
        `MultiStageCrumblingPlatform: breakBoundsScale must be in (0, 1] (got ${breakBoundsScale}).`,
      );
    }
    if (breakBoundsScale > crackBoundsScale) {
      throw new Error(
        `MultiStageCrumblingPlatform: breakBoundsScale (${breakBoundsScale}) must be ≤ crackBoundsScale (${crackBoundsScale}) — collision must monotonically degrade.`,
      );
    }

    this._id = opts.id ?? 'multi-crumble';
    this._x = opts.x;
    this._y = opts.y;
    this._width = opts.width;
    this._height = opts.height;
    this._shakeDuration = shakeDuration;
    this._crackDuration = crackDuration;
    this._breakDuration = breakDuration;
    this._fallDuration = fallDuration;
    this._respawnDelay = respawnDelay;
    this._crackBoundsScale = crackBoundsScale;
    this._breakBoundsScale = breakBoundsScale;
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
  getShakeDuration(): number {
    return this._shakeDuration;
  }
  getCrackDuration(): number {
    return this._crackDuration;
  }
  getBreakDuration(): number {
    return this._breakDuration;
  }
  getFallDuration(): number {
    return this._fallDuration;
  }
  getRespawnDelay(): number {
    return this._respawnDelay;
  }
  getCrackBoundsScale(): number {
    return this._crackBoundsScale;
  }
  getBreakBoundsScale(): number {
    return this._breakBoundsScale;
  }

  /**
   * Sum of `shake + crack + break` — the total warning window before
   * the platform actually drops. Useful for AI heuristics ("how long
   * until this floor goes?") and replay diff readouts.
   */
  getTotalWarningDuration(): number {
    return this._shakeDuration + this._crackDuration + this._breakDuration;
  }

  /**
   * Static intact AABB. Geometry never changes; the *effective* bounds
   * shrink during degradation — see {@link getEffectiveBounds}.
   */
  getBounds(): MultiStageBounds {
    return {
      x: this._x,
      y: this._y,
      width: this._width,
      height: this._height,
    };
  }

  /**
   * Currently collidable AABB. Width is `intactWidth × boundsScale`,
   * centred on the original X. Height never changes (the platform
   * crumbles laterally — the top stays at the same height for fighter
   * landings until the moment it drops). Returns `null` when the
   * platform has no collision (`falling` / `gone`) — callers should
   * treat null as "skip collision this frame".
   */
  getEffectiveBounds(): MultiStageBounds | null {
    if (!this.isSolid()) return null;
    const scale = this._currentBoundsScale();
    return {
      x: this._x,
      y: this._y,
      width: this._width * scale,
      height: this._height,
    };
  }

  // ---- Time / lifecycle --------------------------------------------------

  /** Advance one fixed timestep. */
  tick(): void {
    this._frame += 1;
    this._evaluateTransitions();
  }

  /**
   * Notify the platform a fighter just stepped on it. Only valid in
   * `intact` — once the cascade starts it can't be cancelled or
   * restarted, which is what makes the timing deterministic.
   *
   * Returns `true` iff the call actually transitioned `intact → shake`.
   */
  onSteppedOn(): boolean {
    if (this._phase !== 'intact') return false;
    this._phase = 'shake';
    this._phaseStartFrame = this._frame;
    return true;
  }

  /** Reset to `intact` at frame 0. */
  reset(): void {
    this._phase = 'intact';
    this._phaseStartFrame = 0;
    this._frame = 0;
  }

  getFrame(): number {
    return this._frame;
  }
  getPhase(): MultiStagePhase {
    return this._phase;
  }
  getPhaseStartFrame(): number {
    return this._phaseStartFrame;
  }
  getFramesInPhase(): number {
    return this._frame - this._phaseStartFrame;
  }

  /**
   * Frames remaining until the next automatic transition. Returns
   * `Infinity` for `intact` (only `onSteppedOn()` advances out).
   */
  getFramesUntilNextTransition(): number {
    switch (this._phase) {
      case 'intact':
        return Infinity;
      case 'shake':
        return Math.max(0, this._shakeDuration - this.getFramesInPhase());
      case 'crack':
        return Math.max(0, this._crackDuration - this.getFramesInPhase());
      case 'break':
        return Math.max(0, this._breakDuration - this.getFramesInPhase());
      case 'falling':
        return Math.max(0, this._fallDuration - this.getFramesInPhase());
      case 'gone':
        return Math.max(0, this._respawnDelay - this.getFramesInPhase());
    }
  }

  /**
   * Frames until the platform actually drops — the sum of however much
   * is left of the current sub-stage plus any *later* warning
   * sub-stages still ahead. Useful for AI heuristics that need a single
   * "danger countdown" number regardless of where in the warning we
   * currently are. Returns `Infinity` outside the warning window.
   */
  getFramesUntilFall(): number {
    switch (this._phase) {
      case 'intact':
      case 'falling':
      case 'gone':
        return Infinity;
      case 'shake': {
        const left = this._shakeDuration - this.getFramesInPhase();
        return left + this._crackDuration + this._breakDuration;
      }
      case 'crack': {
        const left = this._crackDuration - this.getFramesInPhase();
        return left + this._breakDuration;
      }
      case 'break':
        return this._breakDuration - this.getFramesInPhase();
    }
  }

  /** True while the platform is collidable. Solid through the entire warning window. */
  isSolid(): boolean {
    return (
      this._phase === 'intact' ||
      this._phase === 'shake' ||
      this._phase === 'crack' ||
      this._phase === 'break'
    );
  }

  /** True iff the platform is visible to the renderer. */
  isVisible(): boolean {
    return this._phase !== 'gone';
  }

  /** True iff any warning sub-stage is currently running. */
  isDegrading(): boolean {
    return (
      this._phase === 'shake' ||
      this._phase === 'crack' ||
      this._phase === 'break'
    );
  }

  /** True iff the platform is in the `break` sub-stage (imminent failure). */
  isFragile(): boolean {
    return this._phase === 'break';
  }

  /** True iff the platform has fallen and not yet respawned. */
  hasFallen(): boolean {
    return this._phase === 'falling' || this._phase === 'gone';
  }

  // ---- Render hints ------------------------------------------------------

  /**
   * Renderer + physics-adapter facing visual & collision hints. Pure
   * function of phase + elapsed-frames-in-phase. See
   * {@link MultiStageCrumblingRenderState} for per-field semantics.
   */
  getRenderState(): MultiStageCrumblingRenderState {
    const elapsed = this.getFramesInPhase();
    switch (this._phase) {
      case 'intact':
        return {
          alpha: 1,
          wobbleNorm: 0,
          crackLevel: 0,
          chunkLevel: 0,
          dropOffset: 0,
          boundsScale: 1,
          fragile: false,
        };
      case 'shake': {
        // Wobble grows from 0 across the entire warning window. In
        // shake we cover the first 1/3 of that ramp.
        const total = this.getTotalWarningDuration();
        const wobble = Math.min(1, elapsed / total);
        return {
          alpha: 1,
          wobbleNorm: wobble,
          crackLevel: 0,
          chunkLevel: 0,
          dropOffset: 0,
          boundsScale: 1,
          fragile: false,
        };
      }
      case 'crack': {
        const total = this.getTotalWarningDuration();
        const wobble = Math.min(
          1,
          (this._shakeDuration + elapsed) / total,
        );
        const crackT = Math.min(1, elapsed / this._crackDuration);
        const boundsScale = 1 - (1 - this._crackBoundsScale) * crackT;
        return {
          alpha: 1,
          wobbleNorm: wobble,
          crackLevel: crackT,
          chunkLevel: 0,
          dropOffset: 0,
          boundsScale,
          fragile: false,
        };
      }
      case 'break': {
        const total = this.getTotalWarningDuration();
        const wobble = Math.min(
          1,
          (this._shakeDuration + this._crackDuration + elapsed) / total,
        );
        const breakT = Math.min(1, elapsed / this._breakDuration);
        const boundsScale =
          this._crackBoundsScale -
          (this._crackBoundsScale - this._breakBoundsScale) * breakT;
        return {
          alpha: 1,
          wobbleNorm: wobble,
          crackLevel: 1,
          chunkLevel: breakT,
          dropOffset: 0,
          boundsScale,
          fragile: true,
        };
      }
      case 'falling': {
        const t = Math.min(1, elapsed / this._fallDuration);
        return {
          alpha: 1 - t,
          wobbleNorm: 1,
          crackLevel: 1,
          chunkLevel: 1,
          dropOffset: t * MULTI_STAGE_CRUMBLE_DEFAULTS.fallPixels,
          boundsScale: 0,
          fragile: false,
        };
      }
      case 'gone':
        return {
          alpha: 0,
          wobbleNorm: 0,
          crackLevel: 0,
          chunkLevel: 0,
          dropOffset: 0,
          boundsScale: 0,
          fragile: false,
        };
    }
  }

  // ---- Snapshot / restore (replay system) -------------------------------

  toState(): MultiStageCrumblingState {
    return {
      phase: this._phase,
      phaseStartFrame: this._phaseStartFrame,
      frame: this._frame,
    };
  }

  fromState(state: MultiStageCrumblingState): void {
    if (!state) {
      throw new Error(
        'MultiStageCrumblingPlatform.fromState: state must not be null.',
      );
    }
    if (
      state.phase !== 'intact' &&
      state.phase !== 'shake' &&
      state.phase !== 'crack' &&
      state.phase !== 'break' &&
      state.phase !== 'falling' &&
      state.phase !== 'gone'
    ) {
      throw new Error(
        `MultiStageCrumblingPlatform.fromState: unknown phase '${state.phase}'.`,
      );
    }
    if (
      !Number.isFinite(state.frame) ||
      !Number.isFinite(state.phaseStartFrame)
    ) {
      throw new Error(
        `MultiStageCrumblingPlatform.fromState: frame and phaseStartFrame must be finite ` +
          `(got frame=${state.frame}, phaseStartFrame=${state.phaseStartFrame}).`,
      );
    }
    if (state.phaseStartFrame > state.frame) {
      throw new Error(
        `MultiStageCrumblingPlatform.fromState: phaseStartFrame (${state.phaseStartFrame}) ` +
          `must be <= frame (${state.frame}).`,
      );
    }
    this._phase = state.phase;
    this._phaseStartFrame = Math.floor(state.phaseStartFrame);
    this._frame = Math.floor(state.frame);
  }

  // ---- Internal helpers --------------------------------------------------

  /** Current effective bounds-scale factor. Pure function of phase + elapsed. */
  private _currentBoundsScale(): number {
    const elapsed = this.getFramesInPhase();
    switch (this._phase) {
      case 'intact':
      case 'shake':
        return 1;
      case 'crack': {
        const t = Math.min(1, elapsed / this._crackDuration);
        return 1 - (1 - this._crackBoundsScale) * t;
      }
      case 'break': {
        const t = Math.min(1, elapsed / this._breakDuration);
        return (
          this._crackBoundsScale -
          (this._crackBoundsScale - this._breakBoundsScale) * t
        );
      }
      case 'falling':
      case 'gone':
        return 0;
    }
  }

  /**
   * Drive lifecycle transitions until the entity stops needing to
   * advance. The cascade `shake → crack → break → falling → gone →
   * intact` may all fire in a single tick under restored snapshots or
   * pathological configs; the bounded `for` loop folds that into a
   * single tick without dropping frames of progress.
   */
  private _evaluateTransitions(): void {
    // At most one full lap (5 transitions) ever needs to fire from a
    // single tick under normal play; the cap keeps us correct under
    // adversarial input without risking an infinite loop.
    for (let safety = 0; safety < 6; safety++) {
      const elapsed = this.getFramesInPhase();
      switch (this._phase) {
        case 'intact':
          return;
        case 'shake':
          if (elapsed >= this._shakeDuration) {
            this._phase = 'crack';
            this._phaseStartFrame += this._shakeDuration;
            continue;
          }
          return;
        case 'crack':
          if (elapsed >= this._crackDuration) {
            this._phase = 'break';
            this._phaseStartFrame += this._crackDuration;
            continue;
          }
          return;
        case 'break':
          if (elapsed >= this._breakDuration) {
            this._phase = 'falling';
            this._phaseStartFrame += this._breakDuration;
            continue;
          }
          return;
        case 'falling':
          if (elapsed >= this._fallDuration) {
            this._phase = 'gone';
            this._phaseStartFrame += this._fallDuration;
            continue;
          }
          return;
        case 'gone':
          if (elapsed >= this._respawnDelay) {
            this._phase = 'intact';
            this._phaseStartFrame += this._respawnDelay;
            continue;
          }
          return;
      }
    }
  }
}
