/**
 * `PeriodicPlatform` — disappearing/reappearing platform on a fixed
 * periodic timer cycle with telegraphed warning states (Sub-AC 3 of
 * AC 10, M2 hazard stages).
 *
 * Sibling of {@link CrumblingPlatform} and
 * {@link MultiStageCrumblingPlatform}. The two crumblers are *event-
 * driven*: they sit there inert until a fighter steps on them, at which
 * point a one-shot countdown plays out and the platform fades away. By
 * contrast, this entity runs on a **purely time-driven cycle** — it
 * disappears and reappears on a steady metronome regardless of whether
 * anyone is touching it. This is the "phasing" / "blinking" platform
 * archetype that the Seed's M2 hazard stages need to round out the
 * roster of dynamic platforms (alongside lava, crumblers, moving
 * platforms, and wind zones).
 *
 * Why a separate entity rather than a flag on `CrumblingPlatform`:
 *
 *   • **Different driver.** `CrumblingPlatform` is *triggered by
 *     `onSteppedOn()`* and runs a one-shot pipeline. `PeriodicPlatform`
 *     is driven by the integer frame counter alone — there is no
 *     `onSteppedOn()` and no triggering. Folding both behaviours into
 *     one class would force every reader to disambiguate which mode
 *     it's in via runtime flags.
 *
 *   • **Symmetric warning windows.** Crumblers warn only before
 *     disappearing (the platform was solid and is about to drop). A
 *     periodic platform must *also* warn before reappearing, otherwise
 *     a fighter can be unfairly punished by a platform that materialises
 *     under (or worse, *inside*) them with no visual cue. The two-sided
 *     warning model is its own contract worth naming separately.
 *
 *   • **Replay snapshot stability.** The replay system serialises every
 *     hazard's snapshot; treating this as a distinct type means an old
 *     replay can't accidentally rehydrate into the wrong entity.
 *
 *   • **Determinism preserved.** All timing and visuals are pure
 *     functions of the integer frame counter and the configured cycle
 *     durations. No `Math.random()`, no `Date.now()`, no Phaser tweens.
 *     Two instances driven by identical inputs produce identical state
 *     on every frame — exactly what the M4 replay VCR needs.
 *
 * Lifecycle (purely periodic — no input transitions):
 *
 *   ┌────────┐ solidDuration  ┌────────────────┐ warnDisappear  ┌────────┐
 *   │ solid  │───────────────▶│ warnDisappear  │───────────────▶│  gone  │
 *   └────────┘                 │  Duration      │                └────────┘
 *        ▲                     └────────────────┘                     │
 *        │                                                            │
 *        │ warnAppearDuration  ┌────────────────┐ goneDuration       │
 *        └─────────────────────│  warnAppear    │◀───────────────────┘
 *                              └────────────────┘
 *
 *   • **solid**         — fully present, fully collidable, fully visible.
 *                         Alpha 1, no warning effect.
 *   • **warnDisappear** — still solid + visible, but the renderer drives
 *                         a *blink/flicker* (intensity ramps 0 → 1) as
 *                         the disappearance approaches. This is the
 *                         classic Smash-style "the floor is about to
 *                         vanish" telegraph. The platform is still
 *                         collidable so fighters keep using it during
 *                         the warning — but the visual cue is
 *                         unambiguous.
 *   • **gone**          — invisible, not collidable. Alpha 0.
 *   • **warnAppear**    — *not* yet collidable, but the renderer ghosts
 *                         in an outline (intensity ramps 0 → 1) so
 *                         fighters and AI can plan around the imminent
 *                         materialisation. Crucially, the platform
 *                         remains non-solid throughout `warnAppear` so
 *                         no fighter can be teleported into a body that
 *                         pops in around them — an extremely common
 *                         source of unfairness in this archetype if the
 *                         appearance is *not* telegraphed.
 *
 * The platform is **solid** in `solid` and `warnDisappear` only —
 * matching the principle of "warn while still solid before disappearing,
 * warn while still non-solid before reappearing". Both sides of the
 * cycle are telegraphed so the player is never blindsided.
 *
 * Cycle phase offset:
 *
 *   • Constructor accepts `phaseOffset` (frames). The platform's
 *     internal cycle counter advances from `phaseOffset % cycleLength`
 *     on frame 0, so two periodic platforms on the same stage can be
 *     placed *out of phase* with each other — one solid while the other
 *     is gone — without any runtime coordination. This is essential for
 *     stages built around "alternating phasing platforms" puzzles.
 *
 * Snapshot/restore is byte-perfect: the only mutable state is the cycle
 * counter; combined with the immutable per-phase durations and bounds,
 * any restored snapshot reproduces the exact same future observables.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Lifecycle phase. Purely periodic — there are no external transitions.
 * See file header for per-phase semantics.
 */
export type PeriodicPhase = 'solid' | 'warnDisappear' | 'gone' | 'warnAppear';

/**
 * Construction options. All distances in **design-space pixels**
 * (1920×1080) so the renderer can apply uniform stage scale at draw
 * time and the entity stays Phaser-free.
 */
export interface PeriodicPlatformOptions {
  /** Stable id — used for replay diffing and HUD labels. Defaults to `'periodic'`. */
  readonly id?: string;
  /** Centre X of the platform (design pixels). */
  readonly x: number;
  /** Centre Y of the platform (design pixels). */
  readonly y: number;
  /** Width of the platform (design pixels). Must be > 0. */
  readonly width: number;
  /** Height of the platform (design pixels). Must be > 0. */
  readonly height: number;
  /**
   * Frames the platform spends in the fully-`solid` phase per cycle.
   * Default 180 (~3 s @ 60 fps).
   */
  readonly solidDuration?: number;
  /**
   * Frames the disappearance-warning blink phase lasts before the
   * platform vanishes. The platform stays collidable during this phase.
   * Default 60 (~1 s @ 60 fps).
   */
  readonly warnDisappearDuration?: number;
  /**
   * Frames the platform spends in the fully-`gone` phase per cycle.
   * Default 180 (~3 s @ 60 fps).
   */
  readonly goneDuration?: number;
  /**
   * Frames the reappearance-warning ghost phase lasts before the
   * platform becomes solid again. The platform stays *non-collidable*
   * during this phase so fighters can't accidentally land on a sprite
   * that is still ghosting in. Default 60 (~1 s @ 60 fps).
   */
  readonly warnAppearDuration?: number;
  /**
   * Frames to offset the cycle on construction — so two platforms with
   * identical configs can be placed out of phase by passing different
   * offsets (e.g. one half a cycle behind the other). Will be reduced
   * modulo the cycle length at construction time, so any non-negative
   * integer is accepted. Default 0.
   */
  readonly phaseOffset?: number;
}

/**
 * Replay snapshot. The cycle counter is the only mutable state — the
 * phase, frames-in-phase, and all visual hints are pure functions of
 * `cyclePos` and the immutable durations.
 */
export interface PeriodicPlatformState {
  /** Position within the cycle, in `[0, cycleLength)`. Always an integer. */
  readonly cyclePos: number;
  /** Internal absolute frame counter — useful for replay diff readouts. */
  readonly frame: number;
}

/** Static AABB. Geometry is immutable; only solidity changes per phase. */
export interface PeriodicBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Renderer-facing visual hints. All values are pure functions of the
 * cycle position and the configured per-phase durations.
 *
 *   • `alpha`         — opacity in [0..1].
 *                       1 in `solid`, 1 in `warnDisappear` (the platform
 *                       stays opaque while flickering — the blink itself
 *                       is the cue, not a fade), 0 in `gone`, ramps
 *                       0 → 1 across `warnAppear` (the ghost
 *                       materialises).
 *   • `blinkNorm`     — telegraph intensity in [0..1]. 0 in `solid`,
 *                       ramps 0 → 1 across `warnDisappear` (the blink
 *                       quickens and brightens as the disappearance
 *                       approaches), 0 in `gone`, ramps 1 → 0 across
 *                       `warnAppear` (the ghost stabilises into the
 *                       solid form).
 *   • `outlineNorm`   — outline-only ghost intensity in [0..1]. 0 except
 *                       during `warnAppear`, where it ramps 0 → 1 in
 *                       parallel with alpha. Useful for renderers that
 *                       want to draw a distinct outline-only style
 *                       during the materialisation, separate from the
 *                       full-alpha blend curve.
 *   • `solid`         — physics-adapter convenience. True iff the
 *                       platform is currently collidable
 *                       (`solid` or `warnDisappear` only).
 *   • `warning`       — true iff *either* warning sub-phase is currently
 *                       active. Audio adapters can use this to drive a
 *                       continuous warning loop that crosses both
 *                       transitions.
 */
export interface PeriodicRenderState {
  readonly alpha: number;
  readonly blinkNorm: number;
  readonly outlineNorm: number;
  readonly solid: boolean;
  readonly warning: boolean;
}

// ---------------------------------------------------------------------------
// Defaults / public constants
// ---------------------------------------------------------------------------

/**
 * Tunable defaults. Exported so unit tests, the stage builder UI, and
 * balance docs can reference the canonical values without duplicating
 * magic numbers.
 *
 * Total cycle with defaults: 180 + 60 + 180 + 60 = 480 frames (8 s @
 * 60 fps). That feels right for a stage hazard — long enough to play a
 * meaningful exchange on the platform but short enough that pacing
 * stays interesting.
 */
export const PERIODIC_PLATFORM_DEFAULTS = {
  /** ~3 s @ 60 fps — fully present and stable. */
  solidDuration: 180,
  /** ~1 s @ 60 fps — disappearance warning (blink, still collidable). */
  warnDisappearDuration: 60,
  /** ~3 s @ 60 fps — fully gone, non-collidable. */
  goneDuration: 180,
  /** ~1 s @ 60 fps — reappearance warning (ghost, non-collidable). */
  warnAppearDuration: 60,
} as const;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Disappearing / reappearing platform on a fixed periodic timer cycle.
 * Phaser-free, deterministic, and snapshot-friendly. See file header
 * for the design rationale and lifecycle diagram.
 */
export class PeriodicPlatform {
  private readonly _id: string;
  private readonly _x: number;
  private readonly _y: number;
  private readonly _width: number;
  private readonly _height: number;
  private readonly _solidDuration: number;
  private readonly _warnDisappearDuration: number;
  private readonly _goneDuration: number;
  private readonly _warnAppearDuration: number;
  private readonly _cycleLength: number;
  private readonly _phaseOffset: number;

  /**
   * Position within the current cycle, in `[0, cycleLength)`. Stored as
   * an integer that increments by 1 per `tick()` and wraps at
   * `cycleLength`. Combined with the immutable durations this uniquely
   * determines every observable.
   */
  private _cyclePos: number;

  /**
   * Mutable absolute frame counter — strictly increasing across the
   * lifetime of the entity. Useful for replay diff readouts and for
   * AI heuristics that want to know "how long has this match been
   * running" without consulting the global match clock. Distinct from
   * `_cyclePos`, which wraps.
   */
  private _frame = 0;

  constructor(opts: PeriodicPlatformOptions) {
    // ---- Validate geometry ------------------------------------------------
    if (!Number.isFinite(opts.x) || !Number.isFinite(opts.y)) {
      throw new Error(
        `PeriodicPlatform: x and y must be finite (got x=${opts.x}, y=${opts.y}).`,
      );
    }
    if (!(opts.width > 0)) {
      throw new Error(
        `PeriodicPlatform: width must be > 0, got ${opts.width}.`,
      );
    }
    if (!(opts.height > 0)) {
      throw new Error(
        `PeriodicPlatform: height must be > 0, got ${opts.height}.`,
      );
    }

    // ---- Validate per-phase durations ------------------------------------
    const solidDuration =
      opts.solidDuration ?? PERIODIC_PLATFORM_DEFAULTS.solidDuration;
    if (!Number.isInteger(solidDuration) || solidDuration < 1) {
      throw new Error(
        `PeriodicPlatform: solidDuration must be a positive integer (got ${solidDuration}).`,
      );
    }
    const warnDisappearDuration =
      opts.warnDisappearDuration ??
      PERIODIC_PLATFORM_DEFAULTS.warnDisappearDuration;
    if (
      !Number.isInteger(warnDisappearDuration) ||
      warnDisappearDuration < 1
    ) {
      throw new Error(
        `PeriodicPlatform: warnDisappearDuration must be a positive integer (got ${warnDisappearDuration}).`,
      );
    }
    const goneDuration =
      opts.goneDuration ?? PERIODIC_PLATFORM_DEFAULTS.goneDuration;
    if (!Number.isInteger(goneDuration) || goneDuration < 1) {
      throw new Error(
        `PeriodicPlatform: goneDuration must be a positive integer (got ${goneDuration}).`,
      );
    }
    const warnAppearDuration =
      opts.warnAppearDuration ??
      PERIODIC_PLATFORM_DEFAULTS.warnAppearDuration;
    if (!Number.isInteger(warnAppearDuration) || warnAppearDuration < 1) {
      throw new Error(
        `PeriodicPlatform: warnAppearDuration must be a positive integer (got ${warnAppearDuration}).`,
      );
    }

    const cycleLength =
      solidDuration +
      warnDisappearDuration +
      goneDuration +
      warnAppearDuration;

    // ---- Validate phase offset -------------------------------------------
    const rawPhaseOffset = opts.phaseOffset ?? 0;
    if (!Number.isInteger(rawPhaseOffset) || rawPhaseOffset < 0) {
      throw new Error(
        `PeriodicPlatform: phaseOffset must be a non-negative integer (got ${rawPhaseOffset}).`,
      );
    }
    // Reduce modulo cycle so a "half cycle behind" is just spelled with
    // the natural integer rather than forcing every call site to do the
    // mod themselves.
    const phaseOffset = rawPhaseOffset % cycleLength;

    this._id = opts.id ?? 'periodic';
    this._x = opts.x;
    this._y = opts.y;
    this._width = opts.width;
    this._height = opts.height;
    this._solidDuration = solidDuration;
    this._warnDisappearDuration = warnDisappearDuration;
    this._goneDuration = goneDuration;
    this._warnAppearDuration = warnAppearDuration;
    this._cycleLength = cycleLength;
    this._phaseOffset = phaseOffset;
    this._cyclePos = phaseOffset;
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
  getSolidDuration(): number {
    return this._solidDuration;
  }
  getWarnDisappearDuration(): number {
    return this._warnDisappearDuration;
  }
  getGoneDuration(): number {
    return this._goneDuration;
  }
  getWarnAppearDuration(): number {
    return this._warnAppearDuration;
  }
  /** Total frames in one cycle — sum of the four phase durations. */
  getCycleLength(): number {
    return this._cycleLength;
  }
  /** Initial cycle offset (already reduced modulo `cycleLength`). */
  getPhaseOffset(): number {
    return this._phaseOffset;
  }

  /**
   * Static AABB. Geometry is immutable — only solidity changes per phase.
   */
  getBounds(): PeriodicBounds {
    return {
      x: this._x,
      y: this._y,
      width: this._width,
      height: this._height,
    };
  }

  // ---- Time / lifecycle --------------------------------------------------

  /**
   * Advance one fixed timestep. Increments the absolute frame counter
   * and the wrapping cycle counter. Phase + every observable are pure
   * functions of the new cycle position and the immutable durations.
   */
  tick(): void {
    this._frame += 1;
    this._cyclePos += 1;
    if (this._cyclePos >= this._cycleLength) {
      this._cyclePos -= this._cycleLength;
    }
  }

  /**
   * Reset the cycle back to its starting offset and zero the absolute
   * frame counter. Useful for tests and for the match-restart flow.
   */
  reset(): void {
    this._cyclePos = this._phaseOffset;
    this._frame = 0;
  }

  /** Absolute frame counter (strictly increasing). */
  getFrame(): number {
    return this._frame;
  }

  /** Position within the current cycle, in `[0, cycleLength)`. */
  getCyclePos(): number {
    return this._cyclePos;
  }

  /** Current lifecycle phase. Pure function of `cyclePos` + durations. */
  getPhase(): PeriodicPhase {
    return this._phaseAt(this._cyclePos);
  }

  /**
   * Frames remaining in the current phase before it transitions to the
   * next. Always ≥ 1 (the transition itself happens *on* the next
   * `tick()` call when the elapsed counter would equal the phase
   * duration). Never `Infinity` — every phase in this entity is timed.
   */
  getFramesUntilNextTransition(): number {
    const { phaseStart, phaseDuration } = this._phaseInfo(this._cyclePos);
    const elapsed = this._cyclePos - phaseStart;
    return phaseDuration - elapsed;
  }

  /**
   * Frames remaining until the platform next transitions out of `solid`
   * (i.e. starts the disappearance warning). Returns 0 if the warning
   * is already running, and the appropriate non-negative integer
   * otherwise. Useful for AI heuristics ("how long can I rely on this
   * platform?").
   */
  getFramesUntilWarnDisappear(): number {
    const phase = this.getPhase();
    if (phase === 'warnDisappear') return 0;
    // Frames from cycle position 0 to start of warnDisappear is
    // `solidDuration`. Walk forward to that target through the cycle.
    const target = this._solidDuration;
    let delta = target - this._cyclePos;
    if (delta < 0) delta += this._cycleLength;
    return delta;
  }

  /**
   * Frames until the platform next becomes fully solid again — i.e. the
   * `warnAppear → solid` transition. Returns 0 if the platform is
   * already in `solid`, and the appropriate non-negative integer
   * otherwise. Useful for AI / fighter-pathfinding heuristics ("how
   * long until I can land here?").
   */
  getFramesUntilSolid(): number {
    if (this.getPhase() === 'solid') return 0;
    // The 'solid' phase starts at cycle position 0. Walk forward to
    // the next 0 through the wrapping cycle.
    if (this._cyclePos === 0) return 0;
    return this._cycleLength - this._cyclePos;
  }

  /**
   * True while the platform is collidable — i.e. `solid` or
   * `warnDisappear`. Crucially **false** during `warnAppear` so a
   * fighter can't be teleported into a body that is still materialising.
   */
  isSolid(): boolean {
    const p = this.getPhase();
    return p === 'solid' || p === 'warnDisappear';
  }

  /** True iff the platform is visible to the renderer in any form. */
  isVisible(): boolean {
    // Even during `warnAppear` the renderer draws a ghost / outline,
    // so the platform is "visible" in the broad sense — only `gone`
    // is fully invisible.
    return this.getPhase() !== 'gone';
  }

  /** True iff either warning sub-phase is currently running. */
  isWarning(): boolean {
    const p = this.getPhase();
    return p === 'warnDisappear' || p === 'warnAppear';
  }

  /** True iff the platform is currently telegraphing imminent disappearance. */
  isWarningDisappear(): boolean {
    return this.getPhase() === 'warnDisappear';
  }

  /** True iff the platform is currently telegraphing imminent reappearance. */
  isWarningAppear(): boolean {
    return this.getPhase() === 'warnAppear';
  }

  // ---- Render hints ------------------------------------------------------

  /**
   * Renderer-facing visual + collision hints. Pure function of cycle
   * position + immutable durations. See {@link PeriodicRenderState}
   * for per-field semantics.
   */
  getRenderState(): PeriodicRenderState {
    const { phaseStart, phaseDuration } = this._phaseInfo(this._cyclePos);
    const elapsed = this._cyclePos - phaseStart;
    const phase = this._phaseAt(this._cyclePos);
    switch (phase) {
      case 'solid':
        return {
          alpha: 1,
          blinkNorm: 0,
          outlineNorm: 0,
          solid: true,
          warning: false,
        };
      case 'warnDisappear': {
        // Blink intensifies linearly across the warning window. We
        // clamp at 1 to absorb the boundary tick where elapsed could
        // briefly equal phaseDuration on the transition frame.
        const t = Math.min(1, elapsed / phaseDuration);
        return {
          alpha: 1,
          blinkNorm: t,
          outlineNorm: 0,
          solid: true,
          warning: true,
        };
      }
      case 'gone':
        return {
          alpha: 0,
          blinkNorm: 0,
          outlineNorm: 0,
          solid: false,
          warning: false,
        };
      case 'warnAppear': {
        // Ghost materialises linearly across the warning window. Alpha
        // and outline both ramp 0 → 1 in parallel; the renderer can
        // pick one or both as its visual style. blinkNorm decays
        // 1 → 0 so audio adapters that drive a single warning loop
        // across both transitions can taper out smoothly.
        const t = Math.min(1, elapsed / phaseDuration);
        return {
          alpha: t,
          blinkNorm: 1 - t,
          outlineNorm: t,
          solid: false,
          warning: true,
        };
      }
    }
  }

  // ---- Snapshot / restore (replay system) -------------------------------

  /**
   * Replay snapshot. Captures the cycle position and the absolute frame
   * counter — together these uniquely determine every future observable
   * given the immutable per-phase durations and bounds.
   */
  toState(): PeriodicPlatformState {
    return {
      cyclePos: this._cyclePos,
      frame: this._frame,
    };
  }

  /**
   * Restore from snapshot. Validates that `cyclePos` is a finite
   * non-negative integer and reduces it modulo `cycleLength` so a
   * corrupted replay can't put the entity into an impossible state
   * (the modular reduction is *defensive*, not a feature — a clean
   * snapshot will always already be in range).
   */
  fromState(state: PeriodicPlatformState): void {
    if (!state) {
      throw new Error('PeriodicPlatform.fromState: state must not be null.');
    }
    if (!Number.isFinite(state.cyclePos) || !Number.isFinite(state.frame)) {
      throw new Error(
        `PeriodicPlatform.fromState: cyclePos and frame must be finite ` +
          `(got cyclePos=${state.cyclePos}, frame=${state.frame}).`,
      );
    }
    if (state.cyclePos < 0 || state.frame < 0) {
      throw new Error(
        `PeriodicPlatform.fromState: cyclePos and frame must be ≥ 0 ` +
          `(got cyclePos=${state.cyclePos}, frame=${state.frame}).`,
      );
    }
    const intCyclePos = Math.floor(state.cyclePos);
    const intFrame = Math.floor(state.frame);
    this._cyclePos = intCyclePos % this._cycleLength;
    this._frame = intFrame;
  }

  // ---- Internal helpers --------------------------------------------------

  /**
   * Map a cycle position to its phase. The cycle is laid out in this
   * order, with phase boundaries at cumulative offsets:
   *
   *   solid          — [0,                                  solidDuration)
   *   warnDisappear  — [solidDuration,                      solidDuration + warnDisappearDuration)
   *   gone           — [solidDuration + warnDisappearDuration,
   *                     solidDuration + warnDisappearDuration + goneDuration)
   *   warnAppear     — [solidDuration + warnDisappearDuration + goneDuration,
   *                     cycleLength)
   *
   * Pure function of position + immutable durations — no I/O, no
   * branching on entity state.
   */
  private _phaseAt(pos: number): PeriodicPhase {
    if (pos < this._solidDuration) return 'solid';
    if (pos < this._solidDuration + this._warnDisappearDuration) {
      return 'warnDisappear';
    }
    if (
      pos <
      this._solidDuration + this._warnDisappearDuration + this._goneDuration
    ) {
      return 'gone';
    }
    return 'warnAppear';
  }

  /**
   * Return the start position and duration of the phase that contains
   * `pos`. Used by `getRenderState` and `getFramesUntilNextTransition`
   * so they share a single source of truth on phase layout with
   * `_phaseAt`.
   */
  private _phaseInfo(pos: number): {
    phaseStart: number;
    phaseDuration: number;
  } {
    if (pos < this._solidDuration) {
      return { phaseStart: 0, phaseDuration: this._solidDuration };
    }
    if (pos < this._solidDuration + this._warnDisappearDuration) {
      return {
        phaseStart: this._solidDuration,
        phaseDuration: this._warnDisappearDuration,
      };
    }
    if (
      pos <
      this._solidDuration + this._warnDisappearDuration + this._goneDuration
    ) {
      return {
        phaseStart: this._solidDuration + this._warnDisappearDuration,
        phaseDuration: this._goneDuration,
      };
    }
    return {
      phaseStart:
        this._solidDuration +
        this._warnDisappearDuration +
        this._goneDuration,
      phaseDuration: this._warnAppearDuration,
    };
  }
}
