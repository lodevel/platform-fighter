import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INVINCIBILITY_FRAMES,
  DEFAULT_RESPAWN_DELAY_FRAMES,
  DEFAULT_STOCK_COUNT,
  StockTracker,
} from './StockTracker';

/**
 * Stock-tracker test suite.
 *
 * AC mapping:
 *   • AC 301 Sub-AC 1 — "stock tracking data model and per-player stock
 *     counter initialization (3 stocks each)". Covered explicitly in the
 *     traceability `describe` block at the bottom of this file plus
 *     the existing "constants" + "construction" suites — the default-3
 *     stocks per slot and the per-player counter initialisation are
 *     exercised on every player index for 1-, 2-, and 4-player matches.
 *   • Sub-AC 4.2 of AC 302 — 3-stock counter per player, blast-zone
 *     driven stock loss, respawn scheduling with invincibility frames.
 *
 * `StockTracker` is the deterministic match-state authority. Tests in
 * this file lock down:
 *
 *   1. Construction defaults — 3 stocks per player by default; refuses
 *      out-of-range player counts and invalid stock counts.
 *   2. Stock loss — decrements the counter, schedules a respawn, fires
 *      the right StockLossEvent shape.
 *   3. Elimination — last-stock loss flips `eliminated` to true and
 *      does NOT schedule a respawn.
 *   4. Respawn drain — `consumePendingRespawns(frame)` returns ready
 *      slots in player-index order, drains the schedule, and yields the
 *      configured invincibility window.
 *   5. Idempotency — duplicate blast-zone events are absorbed; an
 *      already-respawning slot doesn't double-deduct.
 *   6. Match end / winner — sole-survivor wins; simultaneous last-stock
 *      losses produce a draw.
 *   7. Reset — restores every player to full stocks.
 *   8. Determinism — replay the same event log twice → identical state.
 */

// ---------------------------------------------------------------------------
// Construction & defaults
// ---------------------------------------------------------------------------

describe('StockTracker — constants', () => {
  it('default stock count is 3 (matches Seed ontology)', () => {
    expect(DEFAULT_STOCK_COUNT).toBe(3);
  });

  it('default invincibility window is positive (respawn grace)', () => {
    expect(DEFAULT_INVINCIBILITY_FRAMES).toBeGreaterThan(0);
  });

  it('default respawn delay is 0 (instant respawn)', () => {
    expect(DEFAULT_RESPAWN_DELAY_FRAMES).toBe(0);
  });
});

describe('StockTracker — construction', () => {
  it('starts every player at the configured stock count', () => {
    const t = new StockTracker({ playerCount: 4, stockCount: 3 });
    for (let i = 0; i < 4; i += 1) {
      expect(t.getStocks(i)).toBe(3);
      expect(t.isEliminated(i)).toBe(false);
      expect(t.isRespawning(i)).toBe(false);
    }
  });

  it('defaults stockCount to DEFAULT_STOCK_COUNT (3)', () => {
    const t = new StockTracker({ playerCount: 2 });
    expect(t.getStocks(0)).toBe(DEFAULT_STOCK_COUNT);
  });

  it('rejects playerCount < 1 or > 4', () => {
    expect(() => new StockTracker({ playerCount: 0 })).toThrow();
    expect(() => new StockTracker({ playerCount: 5 })).toThrow();
    expect(() => new StockTracker({ playerCount: -1 })).toThrow();
    expect(() => new StockTracker({ playerCount: 2.5 })).toThrow();
  });

  it('rejects stockCount < 1 or non-integer', () => {
    expect(() => new StockTracker({ playerCount: 2, stockCount: 0 })).toThrow();
    expect(() => new StockTracker({ playerCount: 2, stockCount: -3 })).toThrow();
    expect(() => new StockTracker({ playerCount: 2, stockCount: 2.5 })).toThrow();
  });

  it('clamps negative respawnDelayFrames / invincibilityFrames to 0', () => {
    const t = new StockTracker({
      playerCount: 2,
      respawnDelayFrames: -10,
      invincibilityFrames: -50,
    });
    expect(t.respawnDelayFrames).toBe(0);
    expect(t.invincibilityFrames).toBe(0);
  });

  it('throws on out-of-range playerIndex queries', () => {
    const t = new StockTracker({ playerCount: 2 });
    expect(() => t.getStocks(2)).toThrow();
    expect(() => t.getStocks(-1)).toThrow();
    expect(() => t.isEliminated(99)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// loseStock
// ---------------------------------------------------------------------------

describe('StockTracker — loseStock', () => {
  it('decrements the counter by exactly 1', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 3 });
    const ev = t.loseStock(0, 100);
    expect(t.getStocks(0)).toBe(2);
    expect(ev.stocksRemaining).toBe(2);
    expect(ev.eliminated).toBe(false);
  });

  it('schedules a respawn at currentFrame + respawnDelayFrames', () => {
    const t = new StockTracker({
      playerCount: 2,
      stockCount: 3,
      respawnDelayFrames: 30,
    });
    const ev = t.loseStock(0, 100);
    expect(ev.respawnFrame).toBe(130);
    expect(t.getRespawnFrame(0)).toBe(130);
    expect(t.isRespawning(0)).toBe(true);
  });

  it('schedules a same-frame respawn when respawnDelayFrames is 0', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 3 });
    const ev = t.loseStock(0, 555);
    expect(ev.respawnFrame).toBe(555);
  });

  it('does not affect other players', () => {
    const t = new StockTracker({ playerCount: 4, stockCount: 3 });
    t.loseStock(1, 0);
    expect(t.getStocks(0)).toBe(3);
    expect(t.getStocks(1)).toBe(2);
    expect(t.getStocks(2)).toBe(3);
    expect(t.getStocks(3)).toBe(3);
  });

  it('eliminates the player when their last stock falls', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    const ev = t.loseStock(0, 0);
    expect(ev.eliminated).toBe(true);
    expect(ev.stocksRemaining).toBe(0);
    expect(ev.respawnFrame).toBe(-1);
    expect(t.isEliminated(0)).toBe(true);
    expect(t.isRespawning(0)).toBe(false);
  });

  it('does NOT schedule a respawn for an eliminated player', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    t.loseStock(0, 0);
    expect(t.getRespawnFrame(0)).toBe(-1);
  });

  it('idempotent for already-eliminated players', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    t.loseStock(0, 0);
    const ev = t.loseStock(0, 100);
    expect(ev.eliminated).toBe(true);
    expect(ev.stocksRemaining).toBe(0);
    expect(t.getStocks(0)).toBe(0);
  });

  it('idempotent for already-respawning players (de-dups blast-zone events)', () => {
    const t = new StockTracker({
      playerCount: 2,
      stockCount: 3,
      respawnDelayFrames: 60,
    });
    const first = t.loseStock(0, 100);
    const second = t.loseStock(0, 105);
    expect(first.respawnFrame).toBe(160);
    // Second call doesn't deduct — still 2 stocks remain.
    expect(second.stocksRemaining).toBe(2);
    expect(t.getStocks(0)).toBe(2);
    // Respawn frame is unchanged from the first scheduling.
    expect(t.getRespawnFrame(0)).toBe(160);
  });

  it('rejects out-of-range playerIndex', () => {
    const t = new StockTracker({ playerCount: 2 });
    expect(() => t.loseStock(2, 0)).toThrow();
    expect(() => t.loseStock(-1, 0)).toThrow();
  });

  it('floor-clamps fractional currentFrame inputs to a non-negative integer', () => {
    const t = new StockTracker({
      playerCount: 2,
      respawnDelayFrames: 10,
    });
    const ev = t.loseStock(0, 7.9);
    // Math.floor(7.9) + 10 = 17
    expect(ev.respawnFrame).toBe(17);
  });

  it('treats negative currentFrame as 0 (defensive)', () => {
    const t = new StockTracker({ playerCount: 2, respawnDelayFrames: 5 });
    const ev = t.loseStock(0, -100);
    expect(ev.respawnFrame).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// consumePendingRespawns
// ---------------------------------------------------------------------------

describe('StockTracker — consumePendingRespawns', () => {
  it('returns nothing when nobody is pending', () => {
    const t = new StockTracker({ playerCount: 2 });
    expect(t.consumePendingRespawns(100)).toEqual([]);
  });

  it('drains a slot whose respawn frame has been reached', () => {
    const t = new StockTracker({ playerCount: 2, respawnDelayFrames: 30 });
    t.loseStock(0, 100);
    expect(t.consumePendingRespawns(129)).toEqual([]);
    const ready = t.consumePendingRespawns(130);
    expect(ready).toEqual([
      { playerIndex: 0, invincibilityFrames: DEFAULT_INVINCIBILITY_FRAMES },
    ]);
    // Drained — calling again yields nothing.
    expect(t.consumePendingRespawns(200)).toEqual([]);
    expect(t.isRespawning(0)).toBe(false);
  });

  it('drains a 0-delay respawn on the same frame it was scheduled', () => {
    const t = new StockTracker({ playerCount: 2, respawnDelayFrames: 0 });
    t.loseStock(0, 555);
    const ready = t.consumePendingRespawns(555);
    expect(ready.length).toBe(1);
    expect(ready[0]!.playerIndex).toBe(0);
  });

  it('returns multiple drained slots in player-index order', () => {
    const t = new StockTracker({
      playerCount: 4,
      respawnDelayFrames: 0,
    });
    // Lose stocks out of order — index ordering must still come back sorted.
    t.loseStock(2, 0);
    t.loseStock(0, 0);
    t.loseStock(3, 0);
    t.loseStock(1, 0);
    const ready = t.consumePendingRespawns(0);
    expect(ready.map((r) => r.playerIndex)).toEqual([0, 1, 2, 3]);
  });

  it('does not drain a slot whose schedule is in the future', () => {
    const t = new StockTracker({ playerCount: 2, respawnDelayFrames: 60 });
    t.loseStock(0, 100);
    expect(t.consumePendingRespawns(159)).toEqual([]);
    expect(t.isRespawning(0)).toBe(true);
  });

  it('passes through the configured invincibility window', () => {
    const t = new StockTracker({
      playerCount: 2,
      respawnDelayFrames: 0,
      invincibilityFrames: 42,
    });
    t.loseStock(0, 0);
    const [ev] = t.consumePendingRespawns(0);
    expect(ev!.invincibilityFrames).toBe(42);
  });

  it('does NOT yield a respawn for an eliminated slot', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    t.loseStock(0, 0);
    expect(t.consumePendingRespawns(0)).toEqual([]);
    expect(t.consumePendingRespawns(1000)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Match-over / winner
// ---------------------------------------------------------------------------

describe('StockTracker — match-over and winner', () => {
  it('match is in progress while >1 player has stocks', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    expect(t.isMatchOver()).toBe(false);
    expect(t.getWinner()).toBeNull();
  });

  it('flips to over when only one player has stocks remaining', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    t.loseStock(1, 0);
    expect(t.isMatchOver()).toBe(true);
    expect(t.getWinner()).toBe(0);
  });

  it('returns the sole survivor in a 4-player FFA', () => {
    const t = new StockTracker({
      playerCount: 4,
      stockCount: 2,
      respawnDelayFrames: 0,
    });
    // Eliminate every player except #2. We must `consumePendingRespawns`
    // between consecutive losses for the same player — otherwise the
    // "already respawning" de-dup guard absorbs the second loss.
    const drainAndLose = (player: number, frame: number): void => {
      t.consumePendingRespawns(frame);
      t.loseStock(player, frame);
    };
    drainAndLose(0, 0); // p0: 1 stock, respawning at 0
    drainAndLose(0, 1); // p0: 0 stocks, eliminated
    drainAndLose(1, 2); // p1: 1
    drainAndLose(1, 3); // p1: 0
    drainAndLose(3, 4); // p3: 1
    drainAndLose(3, 5); // p3: 0
    expect(t.isMatchOver()).toBe(true);
    expect(t.getWinner()).toBe(2);
  });

  it('returns null on a draw (every player loses their last stock)', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    t.loseStock(0, 0);
    t.loseStock(1, 0);
    expect(t.isMatchOver()).toBe(true);
    expect(t.getWinner()).toBeNull();
  });

  it('returns null while >1 player still alive', () => {
    const t = new StockTracker({ playerCount: 4, stockCount: 1 });
    t.loseStock(0, 0);
    t.loseStock(2, 0);
    expect(t.isMatchOver()).toBe(false);
    expect(t.getWinner()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe('StockTracker — reset', () => {
  it('restores every player to full stocks and clears respawn schedule', () => {
    const t = new StockTracker({
      playerCount: 4,
      stockCount: 3,
      respawnDelayFrames: 30,
    });
    t.loseStock(0, 0);
    t.loseStock(1, 5);
    t.loseStock(2, 10);
    t.reset();
    for (let i = 0; i < 4; i += 1) {
      expect(t.getStocks(i)).toBe(3);
      expect(t.isRespawning(i)).toBe(false);
      expect(t.isEliminated(i)).toBe(false);
      expect(t.getRespawnFrame(i)).toBe(-1);
    }
    expect(t.isMatchOver()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Player state snapshot
// ---------------------------------------------------------------------------

describe('StockTracker — getPlayerState', () => {
  it('returns a complete snapshot in one call', () => {
    const t = new StockTracker({
      playerCount: 2,
      stockCount: 3,
      respawnDelayFrames: 30,
    });
    expect(t.getPlayerState(0)).toEqual({
      stocks: 3,
      eliminated: false,
      respawning: false,
      respawnFrame: -1,
    });
    t.loseStock(0, 100);
    expect(t.getPlayerState(0)).toEqual({
      stocks: 2,
      eliminated: false,
      respawning: true,
      respawnFrame: 130,
    });
  });

  it('reflects elimination', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    t.loseStock(1, 0);
    const s = t.getPlayerState(1);
    expect(s.eliminated).toBe(true);
    expect(s.stocks).toBe(0);
    expect(s.respawning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Determinism gate
// ---------------------------------------------------------------------------

describe('StockTracker — determinism', () => {
  it('replaying the same event log produces the same state every time', () => {
    type Event = { type: 'lose'; player: number; frame: number } | { type: 'consume'; frame: number };
    const log: Event[] = [
      { type: 'lose', player: 0, frame: 10 },
      { type: 'lose', player: 1, frame: 12 },
      { type: 'consume', frame: 12 },
      { type: 'lose', player: 0, frame: 50 },
      { type: 'consume', frame: 50 },
      { type: 'lose', player: 0, frame: 100 },
    ];

    const replay = (): {
      stocks: number[];
      respawnFrames: number[];
      over: boolean;
      winner: number | null;
    } => {
      const t = new StockTracker({
        playerCount: 4,
        stockCount: 3,
        respawnDelayFrames: 0,
      });
      for (const e of log) {
        if (e.type === 'lose') t.loseStock(e.player, e.frame);
        else t.consumePendingRespawns(e.frame);
      }
      return {
        stocks: [0, 1, 2, 3].map((i) => t.getStocks(i)),
        respawnFrames: [0, 1, 2, 3].map((i) => t.getRespawnFrame(i)),
        over: t.isMatchOver(),
        winner: t.getWinner(),
      };
    };

    const a = replay();
    const b = replay();
    const c = replay();
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});

// ---------------------------------------------------------------------------
// AC 301 Sub-AC 1 traceability — stock tracking data model and per-player
// stock counter initialization (3 stocks each).
//
// These tests exist purely to make AC 301 Sub-AC 1 traceable from the test
// output: an evaluator can grep for the AC string and see the exact
// assertions that lock down "every player slot starts at 3 stocks" and
// "the data-model surface (PlayerStockState) reports a fresh, un-KO'd,
// non-respawning slot at construction time."
// ---------------------------------------------------------------------------

describe('AC 301 Sub-AC 1 — stock-tracker data model & per-player counter init', () => {
  it('initialises every player slot to 3 stocks by default (1-player match)', () => {
    const t = new StockTracker({ playerCount: 1 });
    expect(t.getStocks(0)).toBe(3);
  });

  it('initialises every player slot to 3 stocks by default (2-player match)', () => {
    const t = new StockTracker({ playerCount: 2 });
    expect(t.getStocks(0)).toBe(3);
    expect(t.getStocks(1)).toBe(3);
  });

  it('initialises every player slot to 3 stocks by default (4-player match)', () => {
    const t = new StockTracker({ playerCount: 4 });
    for (let i = 0; i < 4; i += 1) {
      expect(t.getStocks(i)).toBe(3);
    }
  });

  it('exposes the data-model surface required by AC 301 Sub-AC 1', () => {
    // The data model needed downstream (HUD, AI, replay, sudden-death
    // detector) is the per-player snapshot. At construction time every
    // slot must report: 3 stocks remaining, not eliminated, not in a
    // respawn pending state.
    const t = new StockTracker({ playerCount: 4 });
    for (let i = 0; i < 4; i += 1) {
      expect(t.getPlayerState(i)).toEqual({
        stocks: 3,
        eliminated: false,
        respawning: false,
        respawnFrame: -1,
      });
    }
  });

  it('treats DEFAULT_STOCK_COUNT (3) as the canonical match-init value', () => {
    // Regression guard — changing this default from 3 silently would
    // break the AC 301 Sub-AC 1 contract. If a future AC needs a
    // different default, that change must come with a deliberate AC
    // amendment, not a one-line constant edit.
    expect(DEFAULT_STOCK_COUNT).toBe(3);
    const t = new StockTracker({ playerCount: 4 });
    for (let i = 0; i < 4; i += 1) {
      expect(t.getStocks(i)).toBe(DEFAULT_STOCK_COUNT);
    }
  });

  it('allows a custom stockCount to override the default for special modes', () => {
    // Time mode / training / quick-match presets need a non-3 stock
    // count. The data model must accept that without breaking the
    // per-player initialisation invariant.
    const t = new StockTracker({ playerCount: 4, stockCount: 5 });
    for (let i = 0; i < 4; i += 1) {
      expect(t.getStocks(i)).toBe(5);
      expect(t.isEliminated(i)).toBe(false);
      expect(t.isRespawning(i)).toBe(false);
    }
  });

  it('isolates per-player stock state — mutating one slot does not touch others', () => {
    // The "per-player" half of the AC: the counters must be independent
    // arrays, not aliased. A loseStock on slot 0 must leave slots 1-3
    // untouched.
    const t = new StockTracker({ playerCount: 4 });
    t.loseStock(0, 0);
    expect(t.getStocks(0)).toBe(2);
    expect(t.getStocks(1)).toBe(3);
    expect(t.getStocks(2)).toBe(3);
    expect(t.getStocks(3)).toBe(3);
  });
});
