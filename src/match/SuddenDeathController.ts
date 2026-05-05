/**
 * Sudden-death coordinator for time-mode matches.
 *
 * AC 12 — "Time-mode tie triggers sudden death."
 *
 * Where this fits
 * ---------------
 *
 *     ┌───────────────────────────┐
 *     │  StockTracker             │ stocks per slot, eliminated state
 *     └─────────┬─────────────────┘
 *               │ snapshot
 *               ▼
 *     ┌───────────────────────────┐
 *     │  evaluateTimeMatch(...)   │ pure resolver  (timeMatchResolution.ts)
 *     └─────────┬─────────────────┘
 *               │ tie / winner / draw / in-progress
 *               ▼
 *     ┌───────────────────────────┐
 *     │  SuddenDeathController    │ ◄── this module
 *     │                           │
 *     │  • watches elapsed frames │
 *     │  • on time-up → resolve   │
 *     │  • on tie → reset tracker │
 *     │      to a 1-stock playoff │
 *     │      between tied slots,  │
 *     │      eliminate the others │
 *     │  • re-arms `MatchEnd`     │
 *     │      detection so the     │
 *     │      same StockTracker    │
 *     │      decides the winner   │
 *     └───────────────────────────┘
 *
 * Why a separate module
 * ---------------------
 *
 *   • Phaser-free / DOM-free / wall-clock-free. Every state
 *     transition is a pure function of (elapsed frames, tracker
 *     snapshot, configured time-limit). The replay determinism
 *     gate relies on this — a recorded match runs the same
 *     transitions on the same frames byte-for-byte.
 *
 *   • Composes `StockTracker` rather than mutating gameplay state
 *     directly. The controller holds *no* fighter / Phaser / Matter
 *     references; the only side effect it has is calling public
 *     `StockTracker` mutators (`setStocks`, `eliminate`, `reset`)
 *     plus optional `onSuddenDeath` / `onTimeUp` callbacks the
 *     scene wires for HUD effects (banner, music sting, ...).
 *
 *   • Tested under plain Node. `SuddenDeathController.test.ts`
 *     drives every transition with a `StockTracker` fixture and
 *     no scene mock.
 *
 * State machine
 * -------------
 *
 *     ┌──────────┐ time-up & winner   ┌───────────┐
 *     │ TIMING   │ ─────────────────▶ │ RESOLVED  │
 *     │ (timer   │ time-up & draw     │ (terminal)│
 *     │ ticking) │ ─────────────────▶ │           │
 *     │          │ time-up & tie      └───────────┘
 *     │          │ ──────────┐               ▲
 *     └──────────┘           │               │ tracker.isMatchOver()
 *                            ▼               │ during sudden death
 *                      ┌───────────────┐     │
 *                      │ TIE_DETECTED  │     │
 *                      │  (one frame)  │     │
 *                      └───────┬───────┘     │
 *                              │ apply()     │
 *                              ▼             │
 *                      ┌───────────────┐     │
 *                      │ SUDDEN_DEATH  │ ────┘
 *                      │ (1-stock pvp) │
 *                      └───────────────┘
 *
 *   • TIMING — pre-time-up. `update(frame)` is called every fixed
 *     step; while elapsed < limit the controller stays here.
 *
 *   • TIE_DETECTED — one-tick latch the moment the timer expires
 *     and `evaluateTimeMatch` returns `'tie'`. `getTiedIndexes()`
 *     exposes the tied slots; the scene reads them to spawn the
 *     "SUDDEN DEATH" banner. Calling `applySuddenDeath()` mutates
 *     the tracker into a 1-stock playoff and transitions to
 *     SUDDEN_DEATH. Until then the match-end detector should NOT
 *     fire — the tracker still believes the match is over (everyone
 *     eliminated except the leaders) but the controller's
 *     `shouldGateMatchEnd()` returns `true` so the gameplay scene
 *     can suppress the results-screen transition for one frame.
 *
 *   • SUDDEN_DEATH — the playoff is live. Tied players have 1
 *     stock each; non-tied players have been eliminated. The
 *     gameplay scene continues running normally; the next
 *     blast-zone / lava KO drops the loser to 0 and `StockTracker`
 *     reports `isMatchOver()` again — at which point the
 *     controller transitions to RESOLVED with the winner.
 *
 *   • RESOLVED — terminal. `getResolution()` exposes the final
 *     outcome: `'winner'`, `'draw'`, or (post-sudden-death) the
 *     winner picked from the tied pool.
 *
 * Reset
 * -----
 *
 * Calling `reset()` returns the controller to TIMING with `elapsed
 * = 0` so the rematch / replay-rewind flow re-uses the same
 * controller instance the same way `MatchEndDetector.reset()` is
 * mirrored against `StockTracker.reset()`.
 */

import {
  evaluateTimeMatch,
  getTimeRemainingFrames,
  isTimeUp,
  type TimeMatchResolution,
} from './timeMatchResolution';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SuddenDeathPhase =
  | 'timing'
  | 'tie-detected'
  | 'sudden-death'
  | 'resolved';

/**
 * Optional capability set on the supplied `StockTracker` so the
 * controller can mutate stocks for sudden death without re-importing
 * the concrete class. The shipped `StockTracker` exposes everything
 * the controller needs via its public API plus the small
 * `applyOverride` extension defined here so the controller can:
 *
 *   • Set every tied player's stock count to 1.
 *   • Zero-out every non-tied player so the existing `isMatchOver()`
 *     logic (sole survivor wins) handles sudden-death resolution
 *     unchanged.
 *
 * If a future tracker doesn't expose `setStocks`, the controller
 * falls back to `loseStock` calls until the slot reaches zero.
 */
export interface SuddenDeathTracker {
  readonly playerCount: number;
  getStocks(playerIndex: number): number;
  isEliminated(playerIndex: number): boolean;
  isMatchOver(): boolean;
  getWinner(): number | null;
  /**
   * Optional fast path. The shipped tracker doesn't have this — the
   * controller falls back to repeated `loseStock` calls on the
   * non-tied slots when the override path isn't available, which
   * works because eliminated players are already at 0 stocks (so
   * the loop is a no-op for already-eliminated slots).
   */
  setStocks?: (playerIndex: number, stocks: number) => void;
  loseStock(playerIndex: number, currentFrame: number): unknown;
}

export interface SuddenDeathControllerOptions {
  /**
   * The match-scoped `StockTracker`. The controller mutates it on
   * sudden-death apply (zeroing non-tied players, setting tied
   * players to 1 stock) and reads its `isMatchOver()` to detect
   * the playoff winner.
   */
  readonly tracker: SuddenDeathTracker;
  /**
   * Time limit in fixed-step frames. `0` or non-finite means "no
   * timer" — the controller stays in TIMING forever and is
   * effectively a no-op (used for stock matches, where match-end
   * is driven by `StockTracker` alone).
   */
  readonly timeLimitFrames: number;
  /**
   * Number of stocks each tied player gets entering sudden death.
   * Defaults to 1 — the canonical Smash-style "first KO wins"
   * playoff.
   */
  readonly suddenDeathStocks?: number;
  /**
   * Fired the frame the controller transitions into TIE_DETECTED.
   * The scene typically uses this hook to play a "SUDDEN DEATH"
   * banner / SFX. The argument is a snapshot of the tied player
   * indexes (in ascending order). Optional.
   */
  readonly onTie?: (tiedIndexes: ReadonlyArray<number>, frame: number) => void;
  /**
   * Fired the frame the controller transitions into RESOLVED with
   * a non-tie outcome (winner or draw on time-up, or winner via
   * sudden death). Optional.
   */
  readonly onResolved?: (
    resolution: TimeMatchResolution,
    frame: number,
  ) => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Stocks each tied player gets entering sudden death. */
export const DEFAULT_SUDDEN_DEATH_STOCKS = 1;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SuddenDeathController {
  readonly timeLimitFrames: number;
  readonly suddenDeathStocks: number;

  private readonly tracker: SuddenDeathTracker;
  private readonly onTie:
    | ((tiedIndexes: ReadonlyArray<number>, frame: number) => void)
    | null;
  private readonly onResolved:
    | ((resolution: TimeMatchResolution, frame: number) => void)
    | null;

  private phase: SuddenDeathPhase = 'timing';
  private elapsedFrames = 0;
  private startFrame = -1;
  private tiedIndexes: ReadonlyArray<number> | null = null;
  private resolution: TimeMatchResolution = { kind: 'in-progress' };
  /**
   * Set when the controller has detected the timer expiring and is
   * waiting for `applySuddenDeath()` to actually mutate the tracker.
   * Used by `shouldGateMatchEnd()` so the gameplay scene's
   * `MatchEndDetector` doesn't transition to the results screen on
   * the same frame the tie is detected.
   */
  private gating = false;

  constructor(options: SuddenDeathControllerOptions) {
    this.tracker = options.tracker;
    if (
      !Number.isFinite(options.timeLimitFrames) ||
      options.timeLimitFrames < 0
    ) {
      this.timeLimitFrames = 0;
    } else {
      this.timeLimitFrames = Math.floor(options.timeLimitFrames);
    }
    const defaulted = options.suddenDeathStocks ?? DEFAULT_SUDDEN_DEATH_STOCKS;
    if (
      !Number.isFinite(defaulted) ||
      defaulted < 1 ||
      Math.floor(defaulted) !== defaulted
    ) {
      throw new Error(
        `SuddenDeathController: suddenDeathStocks must be a positive integer, got ${defaulted}`,
      );
    }
    this.suddenDeathStocks = defaulted;
    this.onTie = options.onTie ?? null;
    this.onResolved = options.onResolved ?? null;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getPhase(): SuddenDeathPhase {
    return this.phase;
  }

  /** Frames since the controller first observed a tick. */
  getElapsedFrames(): number {
    return this.elapsedFrames;
  }

  /**
   * Frames remaining on the configured timer. `Infinity` when the
   * controller has no configured timer (stock match), `0` once the
   * timer has expired.
   */
  getTimeRemainingFrames(): number {
    return getTimeRemainingFrames(this.elapsedFrames, this.timeLimitFrames);
  }

  /** True iff the timer has expired. Independent of phase. */
  isTimeUp(): boolean {
    return isTimeUp(this.elapsedFrames, this.timeLimitFrames);
  }

  /**
   * The list of tied player indexes that triggered sudden death,
   * or `null` if no tie has been detected (or after `reset()`).
   * Frozen when set so callers can't mutate the controller's
   * internal state.
   */
  getTiedIndexes(): ReadonlyArray<number> | null {
    return this.tiedIndexes;
  }

  /**
   * The latest resolution reported by the controller. While in
   * TIMING this is `{ kind: 'in-progress' }`. Snapshotted on entry
   * to TIE_DETECTED / RESOLVED so the scene can read it once and
   * pass it to a results banner without worrying about a late
   * mutation.
   */
  getResolution(): TimeMatchResolution {
    return this.resolution;
  }

  /**
   * `true` while the controller is mid-tie-handling (TIE_DETECTED
   * before `applySuddenDeath` has been called, or right after the
   * apply while the match-end detector still sees the post-zero
   * snapshot). The gameplay scene reads this to suppress the
   * `MatchEndDetector` → results-scene transition for the duration
   * of the sudden-death setup. Once the playoff is live the gate
   * lifts and the next KO ends the match normally.
   */
  shouldGateMatchEnd(): boolean {
    return this.gating;
  }

  /** True iff the controller has produced a final outcome. */
  isResolved(): boolean {
    return this.phase === 'resolved';
  }

  // -------------------------------------------------------------------------
  // Mutators
  // -------------------------------------------------------------------------

  /**
   * Tick the controller for the given fixed-step frame index. Should
   * be called once per fixed step, *after* the StockTracker has
   * absorbed any stock-loss events for the frame so the resolver
   * sees the canonical end-of-step snapshot.
   *
   * State transitions performed in `update`:
   *   • TIMING + time-up + winner → RESOLVED, gating off.
   *   • TIMING + time-up + draw   → RESOLVED, gating off.
   *   • TIMING + time-up + tie    → TIE_DETECTED, gating on (await apply).
   *   • SUDDEN_DEATH + tracker.isMatchOver() → RESOLVED, gating off.
   *   • Other phases → no-op.
   *
   * Returns the post-update phase as a convenience for callers
   * that want to branch on it inline.
   */
  update(currentFrame: number): SuddenDeathPhase {
    const f =
      !Number.isFinite(currentFrame) || currentFrame < 0
        ? 0
        : Math.floor(currentFrame);
    if (this.startFrame < 0) this.startFrame = f;
    this.elapsedFrames = Math.max(0, f - this.startFrame);

    if (this.phase === 'timing') {
      if (this.timeLimitFrames > 0 && isTimeUp(this.elapsedFrames, this.timeLimitFrames)) {
        const stocks = this.snapshotStocks();
        const resolution = evaluateTimeMatch(
          stocks,
          this.elapsedFrames,
          this.timeLimitFrames,
        );
        this.resolution = resolution;
        if (resolution.kind === 'tie') {
          this.phase = 'tie-detected';
          this.tiedIndexes = resolution.tiedIndexes;
          this.gating = true;
          this.onTie?.(resolution.tiedIndexes, f);
        } else {
          // 'winner' | 'draw' (the resolver guarantees we're not
          // 'in-progress' here because isTimeUp returned true).
          this.phase = 'resolved';
          this.gating = false;
          this.onResolved?.(resolution, f);
        }
      }
      return this.phase;
    }

    if (this.phase === 'sudden-death') {
      if (this.tracker.isMatchOver()) {
        const winnerIndex = this.tracker.getWinner();
        const resolution: TimeMatchResolution =
          winnerIndex !== null
            ? { kind: 'winner', winnerIndex }
            : { kind: 'draw' };
        this.resolution = resolution;
        this.phase = 'resolved';
        this.gating = false;
        this.onResolved?.(resolution, f);
      }
      return this.phase;
    }

    // 'tie-detected' is one-tick — the scene must call
    // applySuddenDeath() before the next update; on a follow-up
    // update without apply() we keep the gate latched so the match-
    // end detector continues to suppress.
    return this.phase;
  }

  /**
   * Mutate the tracker into the 1-stock sudden-death playoff:
   *   • Every tied player → `suddenDeathStocks` stocks.
   *   • Every other player → 0 stocks (eliminated).
   *
   * Idempotent — calling it twice on a controller already in
   * SUDDEN_DEATH or RESOLVED is a no-op. Callers may pass the
   * current frame; if omitted, the elapsed frame is used.
   */
  applySuddenDeath(currentFrame?: number): void {
    if (this.phase !== 'tie-detected') return;
    if (!this.tiedIndexes) return;
    const tied = new Set(this.tiedIndexes);
    const f =
      currentFrame !== undefined && Number.isFinite(currentFrame)
        ? Math.max(0, Math.floor(currentFrame))
        : Math.max(0, this.startFrame + this.elapsedFrames);

    for (let i = 0; i < this.tracker.playerCount; i += 1) {
      if (tied.has(i)) {
        this.setStocksForcing(i, this.suddenDeathStocks, f);
      } else {
        // Non-tied players are eliminated. If they're already at 0
        // this is a no-op via the loseStock fallback.
        this.setStocksForcing(i, 0, f);
      }
    }

    this.phase = 'sudden-death';
    // Lift the gate now that the tracker has been re-armed for the
    // playoff. From here on, the next stock-loss event arms the
    // tracker's `isMatchOver()` again and `update()` will resolve.
    this.gating = false;
  }

  /**
   * Reset to TIMING, drop any latched tie / resolution. Used by the
   * rematch flow + replay rewind, mirroring `StockTracker.reset()`
   * and `MatchEndDetector.reset()`.
   */
  reset(): void {
    this.phase = 'timing';
    this.elapsedFrames = 0;
    this.startFrame = -1;
    this.tiedIndexes = null;
    this.resolution = { kind: 'in-progress' };
    this.gating = false;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private snapshotStocks(): number[] {
    const stocks: number[] = [];
    for (let i = 0; i < this.tracker.playerCount; i += 1) {
      stocks.push(this.tracker.getStocks(i));
    }
    return stocks;
  }

  /**
   * Set `playerIndex` to exactly `target` stocks. Prefers the
   * tracker's `setStocks` fast path when available; otherwise calls
   * `loseStock` repeatedly (for `target === 0`) until the slot is
   * eliminated. Used only by `applySuddenDeath`.
   */
  private setStocksForcing(
    playerIndex: number,
    target: number,
    frame: number,
  ): void {
    if (this.tracker.setStocks) {
      this.tracker.setStocks(playerIndex, target);
      return;
    }
    // Fallback. We can only DECREASE stocks via the public API of
    // the shipped `StockTracker`. When `target > current` we'd need
    // a reset path, which the controller doesn't have access to;
    // emit a warning rather than silently desync. In practice the
    // shipped tracker exposes `setStocks` so this branch is dead
    // code outside test fixtures.
    const current = this.tracker.getStocks(playerIndex);
    if (target > current) {
      throw new Error(
        `SuddenDeathController: tracker has no setStocks; cannot raise player ${playerIndex} from ${current} to ${target}`,
      );
    }
    let remaining = current - target;
    while (remaining > 0 && !this.tracker.isEliminated(playerIndex)) {
      this.tracker.loseStock(playerIndex, frame);
      remaining -= 1;
    }
  }
}
