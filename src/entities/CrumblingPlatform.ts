/**
 * `CrumblingPlatform` — timer-based drop-and-respawn stage hazard
 * (Sub-AC 1 of AC 10, M2 hazard stages).
 *
 * Lives in `entities/` alongside `Fighter` and `LavaHazard` because it
 * is a per-frame runtime actor whose state participates in the
 * deterministic match simulation. Like `LavaHazard`, this entity owns
 * **no Phaser objects** — it is the pure-data driver that decides:
 *
 *   • which lifecycle phase the platform is currently in,
 *   • whether the platform is presently *solid* (collidable + visible),
 *   • how visually shaky / faded the platform should appear (so the
 *     renderer can drive a wobble + alpha-fade adapter), and
 *   • what frame the next phase transition fires on (so the replay
 *     state-snapshot system can serialise the entity exactly).
 *
 * Why a Phaser-free entity (mirroring `Rng`, `BlastZoneWatcher`,
 * `MatchEndDetector`, `LavaHazard`):
 *
 *   • **Determinism.** The Seed mandates a fixed-timestep engine where
 *     replays reproduce identical state given identical inputs.
 *     Crumble timing is a pure function of the integer frame counter
 *     and the configured delays — no `Date.now()`, no `Math.random()`,
 *     no Phaser tween easing. The state-snapshot replay system can
 *     serialise just the lifecycle phase + the frame-of-last-transition
 *     and rehydrate the platform exactly.
 *
 *   • **Headless tests.** Vitest under plain Node can drive
 *     `tick()` / `onSteppedOn()` / `isSolid()` / `getRenderState()`
 *     for thousands of iterations to lock down the lifecycle contract
 *     without Phaser / jsdom — same approach as `LocalInputHandler.test.ts`,
 *     `BlastZoneWatcher.test.ts`, and `LavaHazard.test.ts`.
 *
 *   • **Reusable.** The stage builder's preview, the AI pathfinding
 *     ("don't path onto a platform whose `framesUntilFall` is too low"),
 *     the replay scrubber's "rewind to frame N", and the runtime
 *     renderer all read the same entity. Bundling Matter into this
 *     file would force every reader to pull Phaser into its import
 *     graph.
 *
 * Lifecycle contract (the bit Sub-AC 1 actually nails down):
 *
 *   ┌──────────┐  onSteppedOn()  ┌────────────┐  triggerDelay frames
 *   │  intact  │ ───────────────▶│  triggered │ ────────────────────┐
 *   └──────────┘                  └────────────┘                    │
 *        ▲                                                          ▼
 *        │  respawnDelay frames    ┌──────────┐  fallDuration frames┌──────────┐
 *        └─── ────── ────── ───── ─│   gone   │◀────── ────── ──────│  falling │
 *                                  └──────────┘                     └──────────┘
 *
 *   • `intact`     — solid, collidable, full visual integrity.
 *   • `triggered`  — solid + collidable but visibly shaking. A countdown
 *                    of `triggerDelay` frames runs before the platform
 *                    transitions to `falling`. Subsequent `onSteppedOn()`
 *                    calls during this phase are *no-ops* — the
 *                    countdown can't be cancelled or restarted, which
 *                    keeps the lifecycle deterministic regardless of
 *                    how many fighters bounce on the platform.
 *   • `falling`    — no longer collidable; the renderer drops it with
 *                    gravity + fade. The phase lasts `fallDuration`
 *                    frames purely so the *visual* drop can play out
 *                    without immediately respawning. Gameplay-wise the
 *                    platform is already gone (not solid).
 *   • `gone`       — invisible, not collidable. After `respawnDelay`
 *                    frames the platform returns to `intact`.
 *
 * The platform is **solid** only in `intact` and `triggered` phases —
 * matching Smash-style "you have a moment of warning, then the floor
 * drops out from under you".
 *
 * Snapshot/restore:
 *
 *   • `toState()` returns the lifecycle phase + the frame the current
 *     phase started — those are the only mutable bits on the entity.
 *     Everything else (delays, geometry) is immutable configuration.
 *
 *   • `fromState(s)` restores from a snapshot. Combined with the
 *     state-snapshot interval (`GAME_CONFIG.snapshotIntervalFrames =
 *     300`), this lets the M4 replay VCR scrub to any frame and resync
 *     the platform exactly.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Lifecycle phases a crumbling platform can be in. See file header for
 * the state diagram and per-phase semantics.
 */
export type CrumblingPhase = 'intact' | 'triggered' | 'falling' | 'gone';

/**
 * Construction options for a `CrumblingPlatform`. All distances are in
 * **design-space pixels** (1920×1080) so the renderer can apply the
 * uniform stage scale at draw time and keep the entity Phaser-free.
 */
export interface CrumblingPlatformOptions {
  /** Stable identifier — used for replay diffing and HUD labels. Defaults to `'crumble'`. */
  readonly id?: string;
  /** Centre X of the platform (design pixels). */
  readonly x: number;
  /** Centre Y of the platform (design pixels). */
  readonly y: number;
  /** Width of the platform (design pixels). */
  readonly width: number;
  /** Height of the platform (design pixels). */
  readonly height: number;
  /**
   * Frames between `onSteppedOn()` and the platform falling away. Must
   * be a positive integer. Default `60` (~1 s @ 60 fps) so the player
   * gets one full second of audible/visual warning.
   */
  readonly triggerDelay?: number;
  /**
   * Frames the *visual* fall plays before the platform fully disappears
   * (transitions from `falling` → `gone`). Gameplay-wise the platform
   * is non-solid the moment it enters `falling`; this delay only exists
   * so the renderer's drop-and-fade tween has time to read. Default
   * `30` frames (~0.5 s @ 60 fps).
   */
  readonly fallDuration?: number;
  /**
   * Frames between `gone` and respawning back to `intact`. Default
   * `120` (~2 s @ 60 fps) so the platform offers a meaningful tactical
   * gap rather than feeling like an unbreakable solid.
   */
  readonly respawnDelay?: number;
}

/**
 * Snapshot used by the replay state-snapshot system. Captures only the
 * mutable bits — the lifecycle phase and the frame on which it began.
 * Combined with the immutable config and the global frame counter, this
 * uniquely determines every future observable on the entity.
 */
export interface CrumblingPlatformState {
  readonly phase: CrumblingPhase;
  /** The frame this phase began on (relative to the entity's own counter). */
  readonly phaseStartFrame: number;
  /** The internal frame counter — used to drive elapsed-time queries. */
  readonly frame: number;
}

/** Axis-aligned bounds of the platform. Constant — geometry is immutable. */
export interface CrumblingBounds {
  /** Centre X (design pixels). */
  readonly x: number;
  /** Centre Y (design pixels). */
  readonly y: number;
  /** Width (design pixels). */
  readonly width: number;
  /** Height (design pixels). */
  readonly height: number;
}

/**
 * Render hints — values the platform renderer reads each frame to drive
 * the visual presentation. Computed purely from lifecycle phase and
 * elapsed-frames-in-phase so two instances with identical state always
 * produce identical render hints.
 *
 *   • `alpha`        — opacity in [0..1]. Always 1 in `intact` /
 *                      `triggered`; falls linearly through `falling`
 *                      from 1 → 0; 0 in `gone`.
 *   • `wobbleNorm`   — shake intensity in [0..1]. 0 in `intact`,
 *                      ramps from 0 → 1 across `triggered` (so the
 *                      wobble *crescendos* into the fall — a common
 *                      Smash visual cue), 1 throughout `falling`,
 *                      0 in `gone`.
 *   • `dropOffset`   — visual Y-offset in **design pixels** the
 *                      renderer adds to the platform sprite during
 *                      the falling phase (positive = down). 0 outside
 *                      `falling`. Renderer-only — does NOT shift the
 *                      collision body, which is removed altogether
 *                      when not solid.
 */
export interface CrumblingRenderState {
  readonly alpha: number;
  readonly wobbleNorm: number;
  readonly dropOffset: number;
}

// ---------------------------------------------------------------------------
// Defaults / public constants
// ---------------------------------------------------------------------------

/**
 * Tunable defaults for crumbling platforms. Exported so unit tests, the
 * stage builder UI, and balance docs can reference the canonical values
 * without duplicating magic numbers.
 */
export const CRUMBLE_DEFAULTS = {
  /** ~1 s @ 60 fps — warning window between step-on and fall. */
  triggerDelay: 60,
  /** ~0.5 s @ 60 fps — visual drop duration. */
  fallDuration: 30,
  /** ~2 s @ 60 fps — gap before the platform respawns. */
  respawnDelay: 120,
  /**
   * Pixels the renderer drops the sprite by at the *end* of the
   * falling phase. Tuned so the platform leaves the visible area for
   * a typical stage layout. Renderer can override per-stage if needed.
   */
  fallPixels: 240,
} as const;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Timer-based crumbling platform — owns no Phaser objects, drives all
 * downstream renderer/collision behaviour from a lifecycle state
 * machine clocked by a single integer frame counter. See file header
 * for the design rationale and state diagram.
 */
export class CrumblingPlatform {
  private readonly _id: string;
  private readonly _x: number;
  private readonly _y: number;
  private readonly _width: number;
  private readonly _height: number;
  private readonly _triggerDelay: number;
  private readonly _fallDuration: number;
  private readonly _respawnDelay: number;

  /**
   * Mutable lifecycle phase. Transitions are gated by the phase-start
   * frame and the configured delays; see `tick()` and `onSteppedOn()`.
   */
  private _phase: CrumblingPhase = 'intact';

  /**
   * Frame the current phase began on. Subtracting this from `_frame`
   * yields the elapsed-frames-in-phase, which drives every observable
   * (`isSolid`, `getRenderState`, `framesUntilFall`, etc.).
   */
  private _phaseStartFrame = 0;

  /**
   * Mutable frame counter — advances by 1 per `tick()`. Stored as an
   * integer; never wraps (a 32-bit signed int affords ~414 days at
   * 60 fps, far longer than any plausible match/replay).
   */
  private _frame = 0;

  constructor(opts: CrumblingPlatformOptions) {
    // ---- Validate geometry ------------------------------------------------
    if (!Number.isFinite(opts.x) || !Number.isFinite(opts.y)) {
      throw new Error(
        `CrumblingPlatform: x and y must be finite (got x=${opts.x}, y=${opts.y}).`,
      );
    }
    if (!(opts.width > 0)) {
      throw new Error(
        `CrumblingPlatform: width must be > 0, got ${opts.width}.`,
      );
    }
    if (!(opts.height > 0)) {
      throw new Error(
        `CrumblingPlatform: height must be > 0, got ${opts.height}.`,
      );
    }

    // ---- Validate delays --------------------------------------------------
    const triggerDelay = opts.triggerDelay ?? CRUMBLE_DEFAULTS.triggerDelay;
    if (!Number.isInteger(triggerDelay) || triggerDelay < 1) {
      throw new Error(
        `CrumblingPlatform: triggerDelay must be a positive integer (got ${triggerDelay}).`,
      );
    }
    const fallDuration = opts.fallDuration ?? CRUMBLE_DEFAULTS.fallDuration;
    if (!Number.isInteger(fallDuration) || fallDuration < 1) {
      throw new Error(
        `CrumblingPlatform: fallDuration must be a positive integer (got ${fallDuration}).`,
      );
    }
    const respawnDelay = opts.respawnDelay ?? CRUMBLE_DEFAULTS.respawnDelay;
    if (!Number.isInteger(respawnDelay) || respawnDelay < 1) {
      throw new Error(
        `CrumblingPlatform: respawnDelay must be a positive integer (got ${respawnDelay}).`,
      );
    }

    this._id = opts.id ?? 'crumble';
    this._x = opts.x;
    this._y = opts.y;
    this._width = opts.width;
    this._height = opts.height;
    this._triggerDelay = triggerDelay;
    this._fallDuration = fallDuration;
    this._respawnDelay = respawnDelay;
  }

  // ---- Identity / immutable config ---------------------------------------

  /** Stable id — useful for replay diffing and HUD labels. */
  getId(): string {
    return this._id;
  }

  /** Centre X (design pixels). */
  getX(): number {
    return this._x;
  }

  /** Centre Y (design pixels). */
  getY(): number {
    return this._y;
  }

  /** Width (design pixels). */
  getWidth(): number {
    return this._width;
  }

  /** Height (design pixels). */
  getHeight(): number {
    return this._height;
  }

  /** Frames between step-on and the platform falling. */
  getTriggerDelay(): number {
    return this._triggerDelay;
  }

  /** Frames the visual fall plays before the platform disappears. */
  getFallDuration(): number {
    return this._fallDuration;
  }

  /** Frames between gone and respawning. */
  getRespawnDelay(): number {
    return this._respawnDelay;
  }

  /**
   * Static AABB bounds of the platform. The geometry never changes;
   * only solidity does. Renderers / collision adapters consume this
   * unmodified (when the platform is solid) and ignore it otherwise.
   */
  getBounds(): CrumblingBounds {
    return {
      x: this._x,
      y: this._y,
      width: this._width,
      height: this._height,
    };
  }

  // ---- Time / lifecycle --------------------------------------------------

  /** Advance one fixed timestep. */
  tick(): void {
    // Step the global frame counter first, then evaluate transitions
    // against the *new* counter. This keeps `framesUntilFall(N) === 0`
    // and `phase === 'falling'` at the same observable frame, rather
    // than splitting the transition across a frame boundary.
    this._frame += 1;
    this._evaluateTransitions();
  }

  /**
   * Notify the platform a fighter just stepped on it. Behaviour by
   * phase:
   *
   *   • `intact`    — transitions to `triggered`, starting the
   *                   `triggerDelay` countdown.
   *   • `triggered` — no-op. The countdown can't be cancelled or
   *                   restarted by repeated steps; this is what makes
   *                   the lifecycle deterministic regardless of how
   *                   many fighters touch the platform during the
   *                   warning window.
   *   • `falling`   — no-op. Already past the point of return.
   *   • `gone`      — no-op. Not collidable; this call shouldn't
   *                   happen anyway, but we guard against it so
   *                   collision-adapter bugs can't desync state.
   *
   * Returns `true` iff the call actually transitioned the platform
   * (i.e. `intact` → `triggered`). Useful for SFX/VFX hooks that only
   * want to fire on the *first* step in the warning window.
   */
  onSteppedOn(): boolean {
    if (this._phase !== 'intact') return false;
    this._phase = 'triggered';
    this._phaseStartFrame = this._frame;
    return true;
  }

  /**
   * Reset the platform back to `intact` at frame 0. Useful for tests
   * and for the match-restart flow (the M2 stage definition rebuilds
   * the runtime model from scratch, but a `reset()` also exists for
   * tests and future-proofing).
   */
  reset(): void {
    this._phase = 'intact';
    this._phaseStartFrame = 0;
    this._frame = 0;
  }

  /** Current internal frame counter. */
  getFrame(): number {
    return this._frame;
  }

  /** Current lifecycle phase. */
  getPhase(): CrumblingPhase {
    return this._phase;
  }

  /** Frame the current phase began on. */
  getPhaseStartFrame(): number {
    return this._phaseStartFrame;
  }

  /** Elapsed frames since the current phase began. Always ≥ 0. */
  getFramesInPhase(): number {
    return this._frame - this._phaseStartFrame;
  }

  /**
   * Frames remaining until the next automatic phase transition.
   * Returns `Infinity` for the `intact` phase (no timer running) so
   * AI heuristics can compare with `<` safely.
   */
  getFramesUntilNextTransition(): number {
    switch (this._phase) {
      case 'intact':
        return Infinity;
      case 'triggered':
        return Math.max(
          0,
          this._triggerDelay - this.getFramesInPhase(),
        );
      case 'falling':
        return Math.max(
          0,
          this._fallDuration - this.getFramesInPhase(),
        );
      case 'gone':
        return Math.max(
          0,
          this._respawnDelay - this.getFramesInPhase(),
        );
    }
  }

  /**
   * True while the platform is collidable + visible. By design this is
   * `intact` *or* `triggered` — fighters can keep using the platform
   * during the warning window, which is the whole point of having a
   * warning window.
   */
  isSolid(): boolean {
    return this._phase === 'intact' || this._phase === 'triggered';
  }

  /** True iff the platform is currently visible to the renderer. */
  isVisible(): boolean {
    return this._phase !== 'gone';
  }

  /** True iff the warning-window countdown is currently running. */
  isTriggered(): boolean {
    return this._phase === 'triggered';
  }

  /** True iff the platform has fallen and not yet respawned. */
  hasFallen(): boolean {
    return this._phase === 'falling' || this._phase === 'gone';
  }

  // ---- Render hints ------------------------------------------------------

  /**
   * Returns the renderer-facing visual state. Pure function of the
   * lifecycle phase + elapsed-frames-in-phase; computed each call so
   * snapshot/restore works without any cached intermediate state.
   *
   * See the {@link CrumblingRenderState} JSDoc for per-field semantics.
   */
  getRenderState(): CrumblingRenderState {
    const elapsed = this.getFramesInPhase();
    switch (this._phase) {
      case 'intact':
        return { alpha: 1, wobbleNorm: 0, dropOffset: 0 };
      case 'triggered': {
        // Wobble crescendos linearly from 0 → 1 across the warning
        // window, so the visual + audio cue intensifies as the drop
        // approaches. Clamp because elapsed could equal triggerDelay
        // exactly on the transition frame.
        const t = Math.min(1, elapsed / this._triggerDelay);
        return { alpha: 1, wobbleNorm: t, dropOffset: 0 };
      }
      case 'falling': {
        // Linear drop + fade. Mirrors classic Smash crumble visuals:
        // the platform sinks while fading to transparent.
        const t = Math.min(1, elapsed / this._fallDuration);
        return {
          alpha: 1 - t,
          wobbleNorm: 1,
          dropOffset: t * CRUMBLE_DEFAULTS.fallPixels,
        };
      }
      case 'gone':
        return { alpha: 0, wobbleNorm: 0, dropOffset: 0 };
    }
  }

  // ---- Snapshot / restore (replay system) -------------------------------

  /**
   * Replay snapshot. Captures the lifecycle phase, the frame the phase
   * began on, and the current frame counter — together these uniquely
   * determine every future observable.
   */
  toState(): CrumblingPlatformState {
    return {
      phase: this._phase,
      phaseStartFrame: this._phaseStartFrame,
      frame: this._frame,
    };
  }

  /**
   * Restore from snapshot. Validates the phase and the frame ordering
   * (`phaseStartFrame ≤ frame`) so a corrupted replay can't put the
   * entity into an impossible state.
   */
  fromState(state: CrumblingPlatformState): void {
    if (!state) {
      throw new Error('CrumblingPlatform.fromState: state must not be null.');
    }
    if (
      state.phase !== 'intact' &&
      state.phase !== 'triggered' &&
      state.phase !== 'falling' &&
      state.phase !== 'gone'
    ) {
      throw new Error(
        `CrumblingPlatform.fromState: unknown phase '${state.phase}'.`,
      );
    }
    if (
      !Number.isFinite(state.frame) ||
      !Number.isFinite(state.phaseStartFrame)
    ) {
      throw new Error(
        `CrumblingPlatform.fromState: frame and phaseStartFrame must be finite ` +
          `(got frame=${state.frame}, phaseStartFrame=${state.phaseStartFrame}).`,
      );
    }
    if (state.phaseStartFrame > state.frame) {
      throw new Error(
        `CrumblingPlatform.fromState: phaseStartFrame (${state.phaseStartFrame}) ` +
          `must be <= frame (${state.frame}).`,
      );
    }
    this._phase = state.phase;
    this._phaseStartFrame = Math.floor(state.phaseStartFrame);
    this._frame = Math.floor(state.frame);
  }

  // ---- Internal helpers --------------------------------------------------

  /**
   * Evaluate whether the current phase has elapsed long enough to
   * transition to the next. Called at the end of `tick()`. The chain
   * `triggered → falling → gone → intact` may all fire in a single
   * tick if a snapshot or pathological config makes the elapsed
   * counter much larger than the configured delays — we fold the
   * transitions into a `while` loop so the entity converges to the
   * correct phase without dropping frames of progress.
   */
  private _evaluateTransitions(): void {
    // Use a bounded loop just for safety — at most one full lap
    // (`triggered → falling → gone → intact`) ever needs to fire from
    // a single tick of normal play; the cap keeps us correct under
    // adversarial configs / restored snapshots without risking an
    // infinite loop.
    for (let safety = 0; safety < 4; safety++) {
      const elapsed = this.getFramesInPhase();
      switch (this._phase) {
        case 'intact':
          // No timer in intact; only `onSteppedOn()` advances out.
          return;
        case 'triggered':
          if (elapsed >= this._triggerDelay) {
            this._phase = 'falling';
            this._phaseStartFrame += this._triggerDelay;
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
