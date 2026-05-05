/**
 * Sub-AC 4.3 of AC 302/303 — match-end detection & results-flow state machine.
 *
 * `MatchEndDetector` owns the transition between "active match" and "show
 * the results screen." It is a small, deterministic, Phaser-free state
 * machine the gameplay scene ticks once per fixed step. By isolating
 * the transition logic here we get three things:
 *
 *   1. **Determinism.** All transitions are pure functions of (current
 *      state, frame, tracker snapshot). No wall-clock reads, no
 *      `setTimeout`, no Phaser timers. The replay system (M4) replays
 *      identical inputs over identical frames and lands on identical
 *      result frames byte-for-byte.
 *
 *   2. **Testability.** The state machine has zero Phaser, Matter, or DOM
 *      surface area. We exercise every transition under plain Node with
 *      a `StockTracker` fixture — no jsdom, no Phaser headless.
 *
 *   3. **Composability.** The replay overlay (M4) and the AI module (M2+)
 *      both want "is the match over yet, and how long ago did it end?"
 *      One module, one source of truth.
 *
 * State machine:
 *
 *     ┌──────────┐  isMatchOver()  ┌──────────┐  +endingDuration   ┌────────┐
 *     │ ACTIVE   │ ──────────────▶ │ ENDING   │ ─────────────────▶ │ READY  │
 *     │ (fight)  │                 │ ("GAME!"│                    │ go to  │
 *     │          │                 │ banner) │                    │ results│
 *     └──────────┘                 └──────────┘                    └────────┘
 *                                          │
 *                                          ▼ consumeShouldTransition()
 *                                    scene.start('ResultsScene', payload)
 *
 *   • ACTIVE — match in progress. The detector's `update(frame)` returns
 *     `false` for "should transition" and the scene runs gameplay
 *     normally.
 *
 *   • ENDING — the tracker has just reported `isMatchOver()`. The
 *     detector latches the **end frame** (what frame was it when we
 *     entered ENDING?) and the **winner snapshot** (so a late stock
 *     event can't mutate it). The scene typically pauses inputs, freezes
 *     fighters, and renders the "GAME!" banner. After
 *     `endingDurationFrames` more fixed steps, the detector reports
 *     "ready to transition."
 *
 *   • READY — the scene reads `consumeShouldTransition()` once,
 *     `getResultPayload()` to get the data for the results scene, and
 *     calls `scene.start('ResultsScene', payload)`. The detector's
 *     own state stays in READY; calling `consumeShouldTransition()`
 *     again returns `false` so the scene can't double-transition on a
 *     reentrant tick.
 *
 * Lifecycle:
 *
 *   const detector = new MatchEndDetector(stockTracker, {
 *     endingDurationFrames: 180,            // 3 seconds of "GAME!" banner
 *     playerNames: ['Wolf', 'Cat'],         // shown on the results screen
 *   });
 *   // …once per fixed step:
 *   detector.update(physicsEngine.getFrame());
 *   if (detector.consumeShouldTransition()) {
 *     scene.scene.start('ResultsScene', detector.getResultPayload());
 *   }
 *
 * Frame model:
 *
 *   • All times are 60 Hz frames. `endingDurationFrames` defaults to 180
 *     (3 s) — the Smash-style "GAME!" beat.
 *
 *   • Transition fires on `currentFrame >= endFrame + endingDurationFrames`
 *     (inclusive lower bound), so a 0-duration freeze transitions on the
 *     very same frame the match ended (used by tests that don't want a
 *     hold).
 *
 *   • Calling `update` with a non-monotonic frame is harmless — the
 *     detector compares against the cached `endFrame`, never the
 *     previous tick's frame.
 */

import type { StockTracker } from './StockTracker';
import type { MatchStatsTracker, PlayerMatchStats } from './MatchStatsTracker';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Phase of the match from the detector's point of view. */
export type MatchEndPhase = 'active' | 'ending' | 'ready';

export interface MatchEndDetectorOptions {
  /**
   * How many fixed-step frames the "GAME!" banner stays on screen
   * after the match flips over before the scene transitions. Default 180
   * (3 s @ 60 Hz). Pass 0 to transition immediately on match-over (used
   * in tests).
   */
  readonly endingDurationFrames?: number;
  /**
   * Human-readable display names per player slot (index → name). Used by
   * the results scene to render "WOLF WINS" instead of "PLAYER 1 WINS".
   * Optional — when omitted, the results scene falls back to
   * `Player N+1`.
   */
  readonly playerNames?: ReadonlyArray<string>;
  /**
   * Optional human-readable stage label (e.g. "Flat Stage"). Echoed onto
   * the results screen.
   */
  readonly stageName?: string;
  /**
   * Sub-AC 2 of AC 16 — optional reference to the match-wide
   * `MatchStatsTracker`. When present, the detector snapshots
   * per-player stats (KOs, damage dealt, survival frames, …) on entry
   * to ENDING and surfaces them on the result payload so the
   * `ResultsScene` can render the post-match stats panel without
   * reaching back into the match scene's state.
   *
   * Optional so legacy callers (existing tests, headless utilities)
   * keep working — the field on the payload is `null` when no tracker
   * was supplied. The detector also calls `tracker.finalize(endFrame)`
   * before reading the snapshot so still-alive players' survival
   * frames are latched on the canonical match-end frame; if the
   * caller already finalized the tracker for some other reason,
   * `MatchStatsTracker.finalize` is idempotent so it's still safe.
   */
  readonly statsTracker?: MatchStatsTracker;
}

/**
 * Snapshot the detector hands to the results scene the moment it asks
 * to transition. Frozen on entry to ENDING so a stray late event can't
 * change what the player sees.
 */
export interface MatchResultPayload {
  /** Sole-survivor's player slot, or `null` for a draw. */
  readonly winnerIndex: number | null;
  /** Display name for the winner, or `null` for a draw / unknown. */
  readonly winnerName: string | null;
  /** Per-player stocks remaining at match-end. */
  readonly finalStocks: ReadonlyArray<number>;
  /** Per-player display names (fallback `Player N+1` if not provided). */
  readonly playerNames: ReadonlyArray<string>;
  /** Frame index on which the match ended (i.e. enterEnding fired). */
  readonly endFrame: number;
  /** Stage name echoed from options — `null` when not configured. */
  readonly stageName: string | null;
  /**
   * Sub-AC 2 of AC 16 — frozen per-player snapshot of the headline
   * post-match metrics (KOs, damage dealt/taken, survival frames,
   * elimination flag) at the moment the detector entered ENDING.
   * `null` when no `MatchStatsTracker` was supplied via
   * `MatchEndDetectorOptions.statsTracker`.
   *
   * Slot order matches `playerNames` / `finalStocks`. The
   * `survivalFrames` field is in the deterministic 60 Hz frame domain
   * — convert to seconds with `frames / 60`. The `ResultsScene`
   * consumes this directly to render the stats panel.
   */
  readonly playerStats: ReadonlyArray<PlayerMatchStats> | null;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default duration of the "GAME!" hold before transitioning to the
 * results scene. 180 frames at 60 Hz = 3 seconds — long enough that
 * the player registers the freeze, short enough not to drag.
 */
export const DEFAULT_ENDING_DURATION_FRAMES = 180;

// ---------------------------------------------------------------------------
// MatchEndDetector
// ---------------------------------------------------------------------------

export class MatchEndDetector {
  readonly endingDurationFrames: number;
  private readonly tracker: StockTracker;
  private readonly statsTracker: MatchStatsTracker | null;
  private readonly playerNames: ReadonlyArray<string>;
  private readonly stageName: string | null;

  private phase: MatchEndPhase = 'active';
  private endFrame = -1;
  private payload: MatchResultPayload | null = null;
  /**
   * Latched on entry to READY; cleared by `consumeShouldTransition()`
   * the first time it's read. Prevents the scene from double-starting
   * the results scene on reentrant ticks.
   */
  private pendingTransition = false;

  constructor(tracker: StockTracker, options: MatchEndDetectorOptions = {}) {
    this.tracker = tracker;
    this.statsTracker = options.statsTracker ?? null;
    this.endingDurationFrames = Math.max(
      0,
      Math.floor(options.endingDurationFrames ?? DEFAULT_ENDING_DURATION_FRAMES),
    );
    // Capture exactly `playerCount` names; pad with the canonical
    // "Player N" fallback so the results payload always has a name per
    // slot (no `undefined` in the renderer's template).
    const provided = options.playerNames ?? [];
    const names: string[] = [];
    for (let i = 0; i < tracker.playerCount; i += 1) {
      const candidate = provided[i];
      names.push(
        typeof candidate === 'string' && candidate.length > 0
          ? candidate
          : `Player ${i + 1}`,
      );
    }
    this.playerNames = Object.freeze(names);
    this.stageName =
      typeof options.stageName === 'string' && options.stageName.length > 0
        ? options.stageName
        : null;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Current phase. ACTIVE → ENDING → READY. */
  getPhase(): MatchEndPhase {
    return this.phase;
  }

  /** True iff the match has ended (phase is ENDING or READY). */
  isMatchOver(): boolean {
    return this.phase !== 'active';
  }

  /**
   * Frame on which the detector latched the match-over event. -1 while
   * still ACTIVE. Useful for the HUD to fade out the gameplay layer
   * relative to "match-over time."
   */
  getEndFrame(): number {
    return this.endFrame;
  }

  /**
   * Frames remaining in the ENDING phase. Returns 0 once the ENDING
   * window has elapsed (i.e. phase is READY) and -1 while ACTIVE so
   * callers can branch on "we haven't even started ending yet."
   */
  getRemainingEndingFrames(currentFrame: number): number {
    if (this.phase === 'active') return -1;
    const elapsed = Math.max(0, Math.floor(currentFrame) - this.endFrame);
    return Math.max(0, this.endingDurationFrames - elapsed);
  }

  /**
   * The result payload (winner, names, stocks). `null` until the
   * detector enters ENDING. Idempotent — same instance returned across
   * calls; safe to read every render frame for HUD purposes.
   */
  getResultPayload(): MatchResultPayload | null {
    return this.payload;
  }

  // -------------------------------------------------------------------------
  // Mutators
  // -------------------------------------------------------------------------

  /**
   * Tick the state machine for the given frame. Should be called once
   * per fixed step *after* `StockTracker` has consumed any pending
   * stock-loss / respawn events for this step, so the tracker reports
   * its end-of-step truth.
   *
   * Returns the phase post-update; mostly informational since
   * `consumeShouldTransition()` and `getResultPayload()` are the
   * primary read APIs.
   */
  update(currentFrame: number): MatchEndPhase {
    const f = Math.max(0, Math.floor(currentFrame));
    if (this.phase === 'active') {
      if (this.tracker.isMatchOver()) {
        this.enterEnding(f);
        // 0-frame freeze transitions immediately so headless/unit tests
        // don't have to advance the clock just to see the payload.
        if (this.endingDurationFrames === 0) this.enterReady();
      }
      return this.phase;
    }

    if (this.phase === 'ending') {
      if (f - this.endFrame >= this.endingDurationFrames) {
        this.enterReady();
      }
      return this.phase;
    }

    // READY — terminal until reset.
    return this.phase;
  }

  /**
   * Returns `true` exactly once when the detector first enters READY,
   * then `false` on every subsequent call. The scene reads this and
   * calls `scene.start('ResultsScene', detector.getResultPayload())`.
   * Calling it on a non-READY detector returns `false`.
   */
  consumeShouldTransition(): boolean {
    if (this.phase === 'ready' && this.pendingTransition) {
      this.pendingTransition = false;
      return true;
    }
    return false;
  }

  /**
   * Reset to ACTIVE and drop the latched payload. Used by the rematch
   * flow and by replay rewind; mirrors `StockTracker.reset` so a single
   * `restart()` call on the scene returns both modules to a fresh state.
   */
  reset(): void {
    this.phase = 'active';
    this.endFrame = -1;
    this.payload = null;
    this.pendingTransition = false;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private enterEnding(frame: number): void {
    this.phase = 'ending';
    this.endFrame = frame;
    // Snapshot the result NOW so a post-end stray `loseStock` (e.g.
    // a corpse body lingering at the blast zone) can't change the
    // payload the player sees on the results screen.
    const winnerIndex = this.tracker.getWinner();
    const finalStocks: number[] = [];
    for (let i = 0; i < this.tracker.playerCount; i += 1) {
      finalStocks.push(this.tracker.getStocks(i));
    }
    const winnerName =
      winnerIndex !== null && this.playerNames[winnerIndex]
        ? this.playerNames[winnerIndex]!
        : null;

    // Sub-AC 2 of AC 16 — finalize the stats tracker on the canonical
    // match-end frame so still-alive players' survival counters latch
    // here instead of drifting if the scene happens to query later.
    // `finalize` is idempotent so a caller that already called it
    // (e.g. via the rematch flow) is not penalized.
    let playerStats: ReadonlyArray<PlayerMatchStats> | null = null;
    if (this.statsTracker) {
      this.statsTracker.finalize(frame);
      playerStats = this.statsTracker.getAllStats(frame);
    }

    this.payload = Object.freeze({
      winnerIndex,
      winnerName,
      finalStocks: Object.freeze([...finalStocks]),
      playerNames: this.playerNames,
      endFrame: frame,
      stageName: this.stageName,
      playerStats,
    });
  }

  private enterReady(): void {
    this.phase = 'ready';
    this.pendingTransition = true;
  }
}
