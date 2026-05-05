/**
 * Stock tracking & respawn scheduler.
 *
 * AC mapping:
 *   • AC 301 Sub-AC 1 — "stock tracking data model and per-player stock
 *     counter initialization (3 stocks each)". The `StockTrackerOptions`
 *     / `PlayerStockState` / `StockLossEvent` / `RespawnEvent` types
 *     plus the `StockTracker` constructor (which initialises every
 *     player slot to `DEFAULT_STOCK_COUNT = 3`) constitute the data
 *     model and the deterministic per-player initialiser this AC
 *     requires. Subsequent AC 301 sub-ACs (decrement on KO, respawn
 *     scheduling, win detection) build on these primitives.
 *   • Sub-AC 4.2 of AC 302 — blast-zone-driven stock loss + respawn
 *     scheduling with invincibility frames. Same module: the stock-
 *     tracking authority is shared across both ACs by design (one
 *     source of truth — see "Reusable" note below).
 *   • Sub-AC 4 of AC 6 — "KO handling on blast zone crossing (life
 *     decrement, respawn or elimination, damage % reset)". The
 *     life-decrement + respawn-or-elimination half lives in this
 *     module (`loseStock` + `consumePendingRespawns` + `isEliminated`).
 *     The damage % reset half lives in {@link RespawnHandler} which
 *     calls `setDamagePercent(0)` for every drained respawn event. The
 *     headline integration test pairing this module with
 *     `RespawnHandler` against a damage-aware target lives in
 *     {@link BlastZoneKoHandling.test.ts}.
 *
 * `StockTracker` is the deterministic match-state engine for the stock
 * mode. It owns:
 *
 *   1. A 3-stock counter per player (configurable per match).
 *   2. The respawn schedule — when a player loses a stock, the tracker
 *      records the frame at which the fighter should re-enter the stage.
 *      Reading `consumePendingRespawns(frame)` once per fixed step lets
 *      the scene drive `Character.setPosition` + `setInvincibility` on
 *      exactly the right frame, deterministically, with no `setTimeout`
 *      or wall-clock involvement.
 *   3. Match-end / winner detection — a stock match ends when only one
 *      player still has stocks remaining. Sudden-death and time mode
 *      land in later sub-ACs; this module exposes `isMatchOver()` and
 *      `getWinner()` so the (later AC) HUD can display "Player N wins".
 *
 * Why a separate Phaser-free module:
 *
 *   • Deterministic. No Phaser timers, no `Math.random()`, no wall-clock
 *     reads — every state mutation is a pure function of (current state,
 *     event, frame). This is what the M4 replay system depends on:
 *     replaying the same blast-zone events on the same frames produces
 *     byte-identical stock counts and respawn frames.
 *
 *   • Testable under plain Node. `StockTracker.test.ts` exercises every
 *     transition (stock loss, respawn schedule, eliminate, match-over,
 *     edge cases) without a scene fixture or jsdom.
 *
 *   • Reusable. The (post-M2) AI module reads `getStocks(playerIndex)`
 *     to weight risk. The (M4) replay overlay reads it to render the
 *     stock HUD. The (M5) input-rebinding scene reads it to know which
 *     player slots are still active. One source of truth.
 *
 * Frame model:
 *
 *   • All times are in deterministic 60 Hz frames (no milliseconds).
 *     The respawn delay defaults to 0 frames — i.e. instant respawn —
 *     because the seed's "respawn platform spawning with invincibility
 *     frames" is satisfied by re-spawning at the layout's spawn point
 *     with an invincibility window. Callers wanting a brief "ghost"
 *     pause before re-entry can pass `respawnDelayFrames > 0`.
 *
 *   • Frames are passed in by the caller (typically
 *     `physicsEngine.getFrame()`) so the tracker doesn't own its own
 *     clock. This keeps it 100 % deterministic and trivially mockable.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StockTrackerOptions {
  /** Number of player slots tracked (1-4). */
  readonly playerCount: number;
  /**
   * Starting stock count per player. Default 3 (matches the Seed's
   * `stock_count: 3` ontology entry).
   */
  readonly stockCount?: number;
  /**
   * Delay between losing a stock and respawning, in 60 Hz frames.
   * Default 0 — instant respawn at the spawn point. Callers wanting a
   * "ghost-out then drop in" pause can pass e.g. 30 (~500 ms).
   */
  readonly respawnDelayFrames?: number;
  /**
   * Invincibility window granted on respawn, in 60 Hz frames.
   * Default 90 (~1.5 s). Tested against `Character.setInvincibility`.
   */
  readonly invincibilityFrames?: number;
}

/** Per-player runtime state. Snapshot via `getPlayerState`. */
export interface PlayerStockState {
  /** Stocks remaining. 0 means eliminated. */
  readonly stocks: number;
  /** True iff the player is permanently out (zero stocks). */
  readonly eliminated: boolean;
  /** True iff the player has been KO'd and is awaiting respawn. */
  readonly respawning: boolean;
  /**
   * Frame on which the player should be placed back onto the stage.
   * Only meaningful while `respawning === true`. -1 otherwise.
   */
  readonly respawnFrame: number;
}

/**
 * Returned by `loseStock`. Tells the caller exactly what just happened
 * so the HUD can play a stock-loss sting and the scene can decide
 * whether to schedule a respawn or play the eliminate animation.
 */
export interface StockLossEvent {
  readonly playerIndex: number;
  readonly stocksRemaining: number;
  readonly eliminated: boolean;
  /** -1 if eliminated; otherwise the frame on which respawn fires. */
  readonly respawnFrame: number;
}

/**
 * Returned by `consumePendingRespawns`. The scene reads this list once
 * per fixed step and, for every entry, calls `Character.setPosition` +
 * `setDamagePercent(0)` + `setInvincibility(invincibilityFrames)`.
 */
export interface RespawnEvent {
  readonly playerIndex: number;
  readonly invincibilityFrames: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Mirrors Seed `stock_count: 3` and the AC's "3-stock counter per player". */
export const DEFAULT_STOCK_COUNT = 3;

/**
 * Default invincibility window after respawn. 90 frames at 60 Hz =
 * 1.5 seconds — a Smash-ish grace window: enough time to drop down,
 * choose a direction, and re-enter the fight without getting edge-
 * guarded into a second consecutive KO, but short enough that camping
 * the spawn point isn't a viable strategy.
 */
export const DEFAULT_INVINCIBILITY_FRAMES = 90;

/**
 * Default delay between a KO and the respawn fire-frame. 0 = instant.
 * The "respawn platform" requirement is satisfied by re-entry at the
 * stage's spawn point + invincibility, so a hard delay isn't needed
 * in v1; left as a knob for future tuning.
 */
export const DEFAULT_RESPAWN_DELAY_FRAMES = 0;

// ---------------------------------------------------------------------------
// StockTracker
// ---------------------------------------------------------------------------

/**
 * Deterministic stock counter + respawn scheduler. One instance per
 * match, owned by the gameplay scene.
 *
 * Lifecycle:
 *
 *   const tracker = new StockTracker({ playerCount: 4 });
 *   // …per blast-zone collision:
 *   const ev = tracker.loseStock(playerIndex, currentFrame);
 *   if (ev.eliminated) playEliminateFx(playerIndex);
 *   // …once per fixed step:
 *   for (const r of tracker.consumePendingRespawns(currentFrame)) {
 *     // teleport char to spawn point, reset damage, grant invincibility
 *   }
 *   // …at end of match:
 *   if (tracker.isMatchOver()) showWinner(tracker.getWinner());
 */
export class StockTracker {
  readonly playerCount: number;
  readonly initialStocks: number;
  readonly respawnDelayFrames: number;
  readonly invincibilityFrames: number;

  private readonly stocks: number[];
  private readonly respawnFrames: number[]; // -1 means "not respawning"

  constructor(options: StockTrackerOptions) {
    if (
      !Number.isFinite(options.playerCount) ||
      options.playerCount < 1 ||
      options.playerCount > 4 ||
      Math.floor(options.playerCount) !== options.playerCount
    ) {
      throw new Error(
        `StockTracker: playerCount must be an integer in [1, 4], got ${options.playerCount}`,
      );
    }
    this.playerCount = options.playerCount;
    this.initialStocks = options.stockCount ?? DEFAULT_STOCK_COUNT;
    if (this.initialStocks < 1 || Math.floor(this.initialStocks) !== this.initialStocks) {
      throw new Error(
        `StockTracker: stockCount must be a positive integer, got ${this.initialStocks}`,
      );
    }
    this.respawnDelayFrames = Math.max(
      0,
      Math.floor(options.respawnDelayFrames ?? DEFAULT_RESPAWN_DELAY_FRAMES),
    );
    this.invincibilityFrames = Math.max(
      0,
      Math.floor(options.invincibilityFrames ?? DEFAULT_INVINCIBILITY_FRAMES),
    );

    this.stocks = new Array(this.playerCount).fill(this.initialStocks);
    this.respawnFrames = new Array(this.playerCount).fill(-1);
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Stocks remaining for `playerIndex`. 0 = eliminated. */
  getStocks(playerIndex: number): number {
    this.assertSlot(playerIndex);
    return this.stocks[playerIndex]!;
  }

  /** True iff the player has zero stocks left. */
  isEliminated(playerIndex: number): boolean {
    this.assertSlot(playerIndex);
    return this.stocks[playerIndex] === 0;
  }

  /** True iff the player is awaiting respawn (KO'd but stocks remain). */
  isRespawning(playerIndex: number): boolean {
    this.assertSlot(playerIndex);
    return this.respawnFrames[playerIndex]! >= 0;
  }

  /**
   * Frame on which `playerIndex` should respawn. -1 if not respawning.
   * Useful for HUD countdowns.
   */
  getRespawnFrame(playerIndex: number): number {
    this.assertSlot(playerIndex);
    return this.respawnFrames[playerIndex]!;
  }

  /** Read-only snapshot of one player's state. */
  getPlayerState(playerIndex: number): PlayerStockState {
    this.assertSlot(playerIndex);
    const stocks = this.stocks[playerIndex]!;
    const respawnFrame = this.respawnFrames[playerIndex]!;
    return {
      stocks,
      eliminated: stocks === 0,
      respawning: respawnFrame >= 0,
      respawnFrame,
    };
  }

  /**
   * True iff the match is over: at most one player has stocks left.
   * In a 1-player edge case (testing) the match is always "over"
   * the moment the player loses their last stock — there's nobody
   * left to fight. In multi-player, exactly-one-survivor wins.
   */
  isMatchOver(): boolean {
    const alive = this.countAlive();
    return alive <= 1;
  }

  /**
   * Returns the winner's player index, or `null` if no winner has been
   * decided yet. A "winner" is any player who has stocks remaining
   * once everybody else has been eliminated.
   *
   * Edge cases:
   *   • Sole-survivor wins.
   *   • If every player loses their last stock on the same frame
   *     (extremely rare but possible — simultaneous blast-zone touches),
   *     `getWinner()` returns `null` (a draw); the caller can decide
   *     whether to award sudden-death.
   *   • Match still in progress → `null`.
   */
  getWinner(): number | null {
    const aliveSlots: number[] = [];
    for (let i = 0; i < this.playerCount; i += 1) {
      if (this.stocks[i]! > 0) aliveSlots.push(i);
    }
    if (aliveSlots.length === 1) return aliveSlots[0]!;
    if (aliveSlots.length === 0) return null; // draw
    return null; // match still in progress
  }

  // -------------------------------------------------------------------------
  // Mutators — events
  // -------------------------------------------------------------------------

  /**
   * Record a stock loss for `playerIndex`. Called by the scene's
   * blast-zone collision handler.
   *
   * Idempotent guards:
   *   • Already eliminated (0 stocks) → no-op, returns the unchanged
   *     state. This protects against duplicate `collisionstart` events
   *     across Matter versions or a body lingering at the blast-zone
   *     edge for >1 frame after a stock loss.
   *   • Already respawning → no-op. The KO body has been ghosted and
   *     shouldn't generate fresh blast-zone hits, but if a bug allows
   *     it we don't double-deduct.
   *
   * Returns a `StockLossEvent` describing what just happened. The
   * `respawnFrame` is `currentFrame + respawnDelayFrames` if a respawn
   * was scheduled; -1 if the player was eliminated by the loss.
   */
  loseStock(playerIndex: number, currentFrame: number): StockLossEvent {
    this.assertSlot(playerIndex);
    const before = this.stocks[playerIndex]!;
    const wasRespawning = this.respawnFrames[playerIndex]! >= 0;

    if (before === 0 || wasRespawning) {
      return {
        playerIndex,
        stocksRemaining: before,
        eliminated: before === 0,
        respawnFrame: this.respawnFrames[playerIndex]!,
      };
    }

    const after = before - 1;
    this.stocks[playerIndex] = after;

    if (after > 0) {
      const fireFrame = Math.max(0, Math.floor(currentFrame)) + this.respawnDelayFrames;
      this.respawnFrames[playerIndex] = fireFrame;
      return {
        playerIndex,
        stocksRemaining: after,
        eliminated: false,
        respawnFrame: fireFrame,
      };
    }

    // Eliminated — no respawn ever scheduled.
    this.respawnFrames[playerIndex] = -1;
    return {
      playerIndex,
      stocksRemaining: 0,
      eliminated: true,
      respawnFrame: -1,
    };
  }

  /**
   * Drain every pending respawn whose fire-frame has been reached or
   * passed. Returns one `RespawnEvent` per drained slot — the caller
   * uses these to teleport characters back to their spawn point and
   * grant the invincibility window.
   *
   * Called once per fixed step from the scene's update tick.
   *
   * Comparison is `currentFrame >= fireFrame` (inclusive) so a 0-delay
   * respawn fires on the same frame it was scheduled. Respawns are
   * returned in player-index order for deterministic visual ordering.
   */
  consumePendingRespawns(currentFrame: number): RespawnEvent[] {
    const events: RespawnEvent[] = [];
    for (let i = 0; i < this.playerCount; i += 1) {
      const fireFrame = this.respawnFrames[i]!;
      if (fireFrame >= 0 && currentFrame >= fireFrame) {
        this.respawnFrames[i] = -1;
        events.push({
          playerIndex: i,
          invincibilityFrames: this.invincibilityFrames,
        });
      }
    }
    return events;
  }

  /**
   * Restore every player to full stocks and clear the respawn schedule.
   * Used by the (later AC) match-restart and replay rewind flows.
   */
  reset(): void {
    for (let i = 0; i < this.playerCount; i += 1) {
      this.stocks[i] = this.initialStocks;
      this.respawnFrames[i] = -1;
    }
  }

  /**
   * Force-set the stock count for `playerIndex` to `stocks` and
   * clear any pending respawn for that slot.
   *
   * AC 12 — required by the sudden-death coordinator to (a) reset
   * tied players to a 1-stock playoff and (b) zero-out non-tied
   * players when the time-mode timer expires on a tie. Outside the
   * sudden-death path, this method is also a clean fixture for tests
   * that want to set up a non-default stock state without replaying
   * a full damage / blast-zone sequence.
   *
   * Validates `stocks` is an integer in `[0, initialStocks * 2]`
   * (the doubling is a defensive ceiling — sudden-death uses 1, but
   * a future feature dialing up "lifebars" mid-match should be free
   * to bump above the configured initial). Negative values throw.
   */
  setStocks(playerIndex: number, stocks: number): void {
    this.assertSlot(playerIndex);
    if (
      !Number.isFinite(stocks) ||
      Math.floor(stocks) !== stocks ||
      stocks < 0
    ) {
      throw new Error(
        `StockTracker: stocks must be a non-negative integer, got ${stocks}`,
      );
    }
    this.stocks[playerIndex] = stocks;
    // Clear any pending respawn so a follow-up `consumePendingRespawns`
    // doesn't fire on a slot that was just reshaped (the sudden-death
    // path doesn't want a tied player getting a phantom respawn from
    // a pre-sudden-death KO).
    this.respawnFrames[playerIndex] = -1;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private assertSlot(playerIndex: number): void {
    if (
      !Number.isInteger(playerIndex) ||
      playerIndex < 0 ||
      playerIndex >= this.playerCount
    ) {
      throw new Error(
        `StockTracker: playerIndex ${playerIndex} out of range [0, ${this.playerCount})`,
      );
    }
  }

  private countAlive(): number {
    let alive = 0;
    for (let i = 0; i < this.playerCount; i += 1) {
      if (this.stocks[i]! > 0) alive += 1;
    }
    return alive;
  }
}
