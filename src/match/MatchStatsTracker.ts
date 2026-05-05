/**
 * Match-stats tracker — Sub-AC 1 of AC 16.
 *
 * Phaser-free, deterministic, replay-safe per-player statistics ledger
 * for an active match. Tracks the three headline metrics the seed's
 * `gameSession.post-match stats` ontology entry calls out
 * ("KOs/damage/survival time per player"):
 *
 *   1. **KOs per player** — credit awarded to the *last attacker* who
 *      damaged the target within a configurable attribution window.
 *      Self-destructs (target lost a stock with no recent attacker on
 *      record) are not credited to anybody — no phantom KOs in the
 *      results screen.
 *
 *   2. **Damage dealt per player** — running sum of every `damage`
 *      value the player has inflicted on opponents. Self-damage is
 *      ignored (HitboxDamageHandler already suppresses self-hits, but
 *      we mirror the rule defensively here so a future test fixture
 *      can't sneak a self-hit through and inflate the number).
 *
 *   3. **Survival frames per player** — frame count from the configured
 *      `matchStartFrame` to the player's elimination (or to the match-
 *      end frame, for survivors). Stored in the deterministic 60 Hz
 *      frame domain so the results screen can format it as `frames /
 *      60` seconds without any wall-clock involvement.
 *
 * Why a separate Phaser-free module:
 *
 *   • Determinism. Every state mutation is a pure function of (current
 *     state, event, frame). No `Math.random()`, no wall-clock reads,
 *     no Phaser timers. Replays driving identical hit / stock-loss
 *     event streams produce byte-identical stats.
 *
 *   • Testable under plain Node. The full transition matrix (record
 *     damage, attribute KO, lose-last-stock, finalize, mid-match
 *     query) is exercised in {@link MatchStatsTracker.test.ts} with
 *     no scene fixture.
 *
 *   • Reusable. The (this-AC) results scene reads the snapshot for
 *     "WOLF: 4 KOs, 240 % dealt, 1:42 survived". The (already-shipped)
 *     replay tooling can call `getAllStats(currentFrame)` to populate
 *     the post-match stats tab without duplicating attribution logic.
 *     One source of truth.
 *
 * Wiring shape (deferred to a later sub-AC, but documented here so the
 * scene-side integration is unambiguous):
 *
 *   const stats = new MatchStatsTracker({ playerCount: 2 });
 *   // …in the HitboxDamageHandler callback:
 *   stats.recordDamage(attackerIndex, targetIndex, hit.damage, frame);
 *   // …in the StockTracker / blast-zone callback:
 *   const ev = stockTracker.loseStock(playerIndex, frame);
 *   stats.recordStockLoss(playerIndex, frame);
 *   if (ev.eliminated) stats.recordElimination(playerIndex, frame);
 *   // …on entering MatchEndDetector ENDING phase:
 *   stats.finalize(frame);
 *   // …results scene:
 *   const snapshots = stats.getAllStats();
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MatchStatsTrackerOptions {
  /** Number of player slots tracked (1–4). */
  readonly playerCount: number;
  /**
   * Frame on which the match started — survival frames are measured
   * relative to this anchor. Defaults to 0 (the canonical "match begins
   * at frame 0" convention used by the rest of the engine).
   */
  readonly matchStartFrame?: number;
  /**
   * Maximum number of 60 Hz frames between a hit and a subsequent stock
   * loss for the hit's attacker to still earn KO credit. A self-destruct
   * (running off the stage with no recent attacker) doesn't credit
   * anyone. Defaults to 180 frames (3 s) — long enough that a
   * launch-into-blast-zone sequence still credits the attacker, short
   * enough that a stale earlier hit doesn't steal credit from a clean
   * suicide.
   */
  readonly koAttributionWindowFrames?: number;
}

/**
 * Per-player stats snapshot. Returned by `getStats` and `getAllStats`.
 * All fields are non-negative integers (damage is always passed in as
 * a non-negative number; we floor-store internally for display purity
 * but accept floats on input for compatibility with the existing
 * `HitInfo.damage: number` contract).
 */
export interface PlayerMatchStats {
  /** Number of KOs this player scored on opponents. */
  readonly kos: number;
  /** Number of stocks this player has lost. */
  readonly deaths: number;
  /**
   * Sum of `damage` values this player has inflicted on opponents.
   * Self-damage is ignored. Mirrors the `HitInfo.damage` units the
   * combat module emits (percent points).
   */
  readonly damageDealt: number;
  /** Sum of `damage` values this player has received from opponents. */
  readonly damageTaken: number;
  /**
   * Number of 60 Hz frames the player has survived. Counts from
   * `matchStartFrame` to either the player's elimination frame or the
   * match-end frame (whichever came first). For mid-match queries
   * with `currentFrame`, the value is computed live for still-alive
   * players.
   */
  readonly survivalFrames: number;
  /** True iff the player has been eliminated (zero stocks remaining). */
  readonly eliminated: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default attribution window. 180 frames (3 s) at 60 Hz — long enough
 * to credit the attacker for a launch-into-blast-zone sequence, short
 * enough that a stale poke 5 seconds before a clean self-destruct
 * doesn't steal credit.
 */
export const DEFAULT_KO_ATTRIBUTION_WINDOW_FRAMES = 180;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface AttackerCredit {
  /** Slot index of the attacker eligible for KO credit. */
  readonly attackerIndex: number;
  /** Frame on which the credit-eligible hit landed. */
  readonly frame: number;
}

// ---------------------------------------------------------------------------
// MatchStatsTracker
// ---------------------------------------------------------------------------

export class MatchStatsTracker {
  readonly playerCount: number;
  readonly matchStartFrame: number;
  readonly koAttributionWindowFrames: number;

  // Per-player accumulators. Parallel arrays so we can reset all at
  // once with a fixed-size loop (cheap, deterministic, no Map churn).
  private readonly kos: number[];
  private readonly deaths: number[];
  private readonly damageDealt: number[];
  private readonly damageTaken: number[];
  /** -1 means "not eliminated" (still alive or match still going). */
  private readonly eliminationFrames: number[];
  /** Latched survival window — set on elimination or finalize. -1 means "still running". */
  private readonly survivalFramesLatched: number[];
  /** Per-target last-attacker credit. `null` = no eligible credit. */
  private readonly lastAttacker: Array<AttackerCredit | null>;

  /** Frame at which `finalize()` was called; -1 while match still active. */
  private finalizedFrame = -1;

  constructor(options: MatchStatsTrackerOptions) {
    if (
      !Number.isFinite(options.playerCount) ||
      options.playerCount < 1 ||
      options.playerCount > 4 ||
      Math.floor(options.playerCount) !== options.playerCount
    ) {
      throw new Error(
        `MatchStatsTracker: playerCount must be an integer in [1, 4], got ${options.playerCount}`,
      );
    }
    this.playerCount = options.playerCount;
    this.matchStartFrame = Math.max(
      0,
      Math.floor(options.matchStartFrame ?? 0),
    );
    this.koAttributionWindowFrames = Math.max(
      0,
      Math.floor(
        options.koAttributionWindowFrames ?? DEFAULT_KO_ATTRIBUTION_WINDOW_FRAMES,
      ),
    );

    this.kos = new Array(this.playerCount).fill(0);
    this.deaths = new Array(this.playerCount).fill(0);
    this.damageDealt = new Array(this.playerCount).fill(0);
    this.damageTaken = new Array(this.playerCount).fill(0);
    this.eliminationFrames = new Array(this.playerCount).fill(-1);
    this.survivalFramesLatched = new Array(this.playerCount).fill(-1);
    this.lastAttacker = new Array(this.playerCount).fill(null);
  }

  // -------------------------------------------------------------------------
  // Mutators
  // -------------------------------------------------------------------------

  /**
   * Record a hit landing on `targetIndex` from `attackerIndex` for
   * `damage` percent points on `frame`.
   *
   * Side effects:
   *   • `damageDealt[attackerIndex]` += damage.
   *   • `damageTaken[targetIndex]` += damage.
   *   • `lastAttacker[targetIndex]` = (attackerIndex, frame). A
   *     subsequent stock loss on the target within
   *     `koAttributionWindowFrames` will award the KO to the attacker.
   *
   * Guards:
   *   • Self-damage (`attackerIndex === targetIndex`) is silently
   *     ignored. The HitboxDamageHandler already suppresses self-hits,
   *     but mirroring the rule here is a cheap defensive backstop.
   *   • Negative or non-finite `damage` is clamped to 0 so a bug in a
   *     move definition can't decrement an opponent's damageTaken.
   *   • `frame` is floor-clamped to ≥ 0; the caller normally passes
   *     `physicsEngine.getFrame()` which is always a non-negative
   *     integer, but a fractional / negative value won't crash the
   *     ledger.
   *   • Indices are bounds-checked; a bad slot throws (the caller has
   *     a wiring bug).
   */
  recordDamage(
    attackerIndex: number,
    targetIndex: number,
    damage: number,
    frame: number,
  ): void {
    this.assertSlot(attackerIndex);
    this.assertSlot(targetIndex);

    if (attackerIndex === targetIndex) return;

    const safeDamage =
      Number.isFinite(damage) && damage > 0 ? damage : 0;
    const safeFrame = Math.max(0, Math.floor(frame));

    if (safeDamage === 0) {
      // No-op — we don't even update the last-attacker credit because
      // a zero-damage "hit" shouldn't earn KO attribution.
      return;
    }

    this.damageDealt[attackerIndex] = this.damageDealt[attackerIndex]! + safeDamage;
    this.damageTaken[targetIndex] = this.damageTaken[targetIndex]! + safeDamage;
    this.lastAttacker[targetIndex] = {
      attackerIndex,
      frame: safeFrame,
    };
  }

  /**
   * Record that `targetIndex` has lost a stock on `frame`. Increments
   * the death counter and — if a recent attacker is on file — credits
   * the KO to that attacker.
   *
   * Attribution rule:
   *   • If `lastAttacker[targetIndex]` is set AND
   *     `frame - lastAttacker.frame <= koAttributionWindowFrames`,
   *     credit the KO to that attacker.
   *   • Otherwise: no KO credit (counts as a self-destruct).
   *   • The last-attacker slot is *cleared* either way; a subsequent
   *     stock loss requires a fresh hit to earn credit.
   *
   * Stock-loss accounting is independent of elimination: a player who
   * loses their final stock should be reported via this method first
   * (to bump `deaths` and credit the KO) and then, if they are now
   * eliminated, via `recordElimination` (to latch their survival
   * frames). The caller's `StockTracker.loseStock` already returns an
   * `eliminated` flag — drive both calls from that single event.
   */
  recordStockLoss(targetIndex: number, frame: number): void {
    this.assertSlot(targetIndex);
    const safeFrame = Math.max(0, Math.floor(frame));

    this.deaths[targetIndex] = this.deaths[targetIndex]! + 1;

    const credit = this.lastAttacker[targetIndex];
    if (credit) {
      const elapsed = safeFrame - credit.frame;
      if (elapsed >= 0 && elapsed <= this.koAttributionWindowFrames) {
        this.kos[credit.attackerIndex] = this.kos[credit.attackerIndex]! + 1;
      }
      this.lastAttacker[targetIndex] = null;
    }
  }

  /**
   * Mark `targetIndex` as eliminated on `frame`. Latches their survival
   * window — every subsequent `getStats` call returns the same frame
   * count for that player.
   *
   * Idempotent: a second `recordElimination` for the same slot is a
   * no-op. The caller (driven by `StockTracker.loseStock`'s
   * `eliminated: true` payload) shouldn't double-fire, but a duplicate
   * call won't shift the latched frame.
   */
  recordElimination(targetIndex: number, frame: number): void {
    this.assertSlot(targetIndex);
    if (this.eliminationFrames[targetIndex]! >= 0) return;

    const safeFrame = Math.max(0, Math.floor(frame));
    this.eliminationFrames[targetIndex] = safeFrame;
    // If survival was already latched (typical path: finalize ran first
    // because the scene called it on entering MatchEndDetector ENDING),
    // preserve that earlier value — a late elimination only flips the
    // `eliminated` flag, it doesn't extend or shorten the survival
    // window the player saw on the results screen.
    if (this.survivalFramesLatched[targetIndex]! < 0) {
      this.survivalFramesLatched[targetIndex] = Math.max(
        0,
        safeFrame - this.matchStartFrame,
      );
    }
  }

  /**
   * Latch survival frames for every still-alive player. Called by the
   * scene the moment `MatchEndDetector` enters its ENDING phase so the
   * results screen reads a frozen value (no off-by-one between the
   * "GAME!" banner and the stats tab).
   *
   * Idempotent: a second `finalize` after the first one stores nothing.
   * Players who were eliminated *before* finalize keep their original
   * elimination frame (their survival was latched at elimination, not
   * at finalize).
   */
  finalize(frame: number): void {
    if (this.finalizedFrame >= 0) return;
    const safeFrame = Math.max(0, Math.floor(frame));
    this.finalizedFrame = safeFrame;
    for (let i = 0; i < this.playerCount; i += 1) {
      if (this.survivalFramesLatched[i]! < 0) {
        this.survivalFramesLatched[i] = Math.max(
          0,
          safeFrame - this.matchStartFrame,
        );
      }
    }
  }

  /**
   * Drop every accumulator back to zero and forget every credit. Used
   * by the rematch flow and replay rewind; mirrors `StockTracker.reset`
   * so a single `restart()` call returns the whole match-state stack
   * to a clean slate.
   */
  reset(): void {
    for (let i = 0; i < this.playerCount; i += 1) {
      this.kos[i] = 0;
      this.deaths[i] = 0;
      this.damageDealt[i] = 0;
      this.damageTaken[i] = 0;
      this.eliminationFrames[i] = -1;
      this.survivalFramesLatched[i] = -1;
      this.lastAttacker[i] = null;
    }
    this.finalizedFrame = -1;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * Snapshot of `playerIndex`'s stats. Pass `currentFrame` to get a
   * live survival count for still-alive players; omit it to read the
   * latched value (which is `0` for still-alive players whose survival
   * hasn't been finalized yet — useful for headless / replay tooling
   * that doesn't carry a frame counter).
   */
  getStats(playerIndex: number, currentFrame?: number): PlayerMatchStats {
    this.assertSlot(playerIndex);
    return {
      kos: this.kos[playerIndex]!,
      deaths: this.deaths[playerIndex]!,
      damageDealt: this.damageDealt[playerIndex]!,
      damageTaken: this.damageTaken[playerIndex]!,
      survivalFrames: this.computeSurvivalFrames(playerIndex, currentFrame),
      eliminated: this.eliminationFrames[playerIndex]! >= 0,
    };
  }

  /**
   * Snapshot of every player's stats, in slot order. Returns a fresh
   * frozen array on every call — safe to pass to immutable consumers
   * (the results scene, replay metadata).
   */
  getAllStats(currentFrame?: number): ReadonlyArray<PlayerMatchStats> {
    const out: PlayerMatchStats[] = [];
    for (let i = 0; i < this.playerCount; i += 1) {
      out.push(this.getStats(i, currentFrame));
    }
    return Object.freeze(out);
  }

  /**
   * Slot index of the attacker currently eligible to earn KO credit
   * for `targetIndex`, or `null` if none. Useful for HUD overlays that
   * want to highlight "you're the last person who hit them" in the
   * replay scrubber.
   */
  getLastAttacker(targetIndex: number): number | null {
    this.assertSlot(targetIndex);
    const credit = this.lastAttacker[targetIndex];
    return credit ? credit.attackerIndex : null;
  }

  /** True iff `finalize()` has been called. */
  isFinalized(): boolean {
    return this.finalizedFrame >= 0;
  }

  /** Frame the match was finalized on, or -1 if still running. */
  getFinalizedFrame(): number {
    return this.finalizedFrame;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private computeSurvivalFrames(
    playerIndex: number,
    currentFrame: number | undefined,
  ): number {
    const latched = this.survivalFramesLatched[playerIndex]!;
    if (latched >= 0) return latched;
    if (typeof currentFrame !== 'number' || !Number.isFinite(currentFrame)) {
      return 0;
    }
    const safeFrame = Math.max(0, Math.floor(currentFrame));
    return Math.max(0, safeFrame - this.matchStartFrame);
  }

  private assertSlot(playerIndex: number): void {
    if (
      !Number.isInteger(playerIndex) ||
      playerIndex < 0 ||
      playerIndex >= this.playerCount
    ) {
      throw new Error(
        `MatchStatsTracker: playerIndex ${playerIndex} out of range [0, ${this.playerCount})`,
      );
    }
  }
}
