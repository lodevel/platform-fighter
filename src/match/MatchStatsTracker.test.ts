import { describe, it, expect } from 'vitest';
import {
  DEFAULT_KO_ATTRIBUTION_WINDOW_FRAMES,
  MatchStatsTracker,
} from './MatchStatsTracker';

/**
 * MatchStatsTracker test suite — Sub-AC 1 of AC 16.
 *
 * Locks down the deterministic ledger contract for the three headline
 * post-match metrics required by the seed:
 *
 *   1. KOs per player, with last-attacker attribution within a
 *      configurable frame window.
 *   2. Damage dealt per player (accumulator), with self-damage and
 *      negative-damage guards.
 *   3. Survival frames per player, latched on elimination or finalize,
 *      computed live for still-alive players when a `currentFrame` is
 *      supplied.
 *
 * Every test runs under plain Node — no Phaser, no Matter, no
 * `Math.random`. The tracker is the canonical deterministic source of
 * truth the (M4) replay tooling and (this-AC) results scene both read.
 */

// ---------------------------------------------------------------------------
// Defaults & construction
// ---------------------------------------------------------------------------

describe('MatchStatsTracker — defaults', () => {
  it('default attribution window is 3 seconds at 60 Hz', () => {
    expect(DEFAULT_KO_ATTRIBUTION_WINDOW_FRAMES).toBe(180);
  });
});

describe('MatchStatsTracker — construction', () => {
  it('starts every counter at zero', () => {
    const t = new MatchStatsTracker({ playerCount: 4 });
    for (let i = 0; i < 4; i += 1) {
      const s = t.getStats(i);
      expect(s.kos).toBe(0);
      expect(s.deaths).toBe(0);
      expect(s.damageDealt).toBe(0);
      expect(s.damageTaken).toBe(0);
      expect(s.survivalFrames).toBe(0);
      expect(s.eliminated).toBe(false);
    }
  });

  it('rejects playerCount < 1, > 4, or non-integer', () => {
    expect(() => new MatchStatsTracker({ playerCount: 0 })).toThrow();
    expect(() => new MatchStatsTracker({ playerCount: 5 })).toThrow();
    expect(() => new MatchStatsTracker({ playerCount: -1 })).toThrow();
    expect(() => new MatchStatsTracker({ playerCount: 2.5 })).toThrow();
    expect(() => new MatchStatsTracker({ playerCount: NaN })).toThrow();
  });

  it('floor-clamps matchStartFrame to a non-negative integer', () => {
    const a = new MatchStatsTracker({ playerCount: 2, matchStartFrame: -5 });
    expect(a.matchStartFrame).toBe(0);
    const b = new MatchStatsTracker({ playerCount: 2, matchStartFrame: 7.9 });
    expect(b.matchStartFrame).toBe(7);
  });

  it('floor-clamps koAttributionWindowFrames to a non-negative integer', () => {
    const a = new MatchStatsTracker({
      playerCount: 2,
      koAttributionWindowFrames: -3,
    });
    expect(a.koAttributionWindowFrames).toBe(0);
    const b = new MatchStatsTracker({
      playerCount: 2,
      koAttributionWindowFrames: 60.7,
    });
    expect(b.koAttributionWindowFrames).toBe(60);
  });

  it('throws when reading a slot out of range', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    expect(() => t.getStats(-1)).toThrow();
    expect(() => t.getStats(2)).toThrow();
    expect(() => t.getStats(1.5)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// recordDamage
// ---------------------------------------------------------------------------

describe('MatchStatsTracker — recordDamage', () => {
  it('accumulates damageDealt on the attacker and damageTaken on the target', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    t.recordDamage(0, 1, 8, 30);
    t.recordDamage(0, 1, 12, 60);
    expect(t.getStats(0).damageDealt).toBe(20);
    expect(t.getStats(1).damageTaken).toBe(20);
    // Symmetric: target deals zero, attacker takes zero.
    expect(t.getStats(0).damageTaken).toBe(0);
    expect(t.getStats(1).damageDealt).toBe(0);
  });

  it('keeps separate ledgers per (attacker, target) pair', () => {
    const t = new MatchStatsTracker({ playerCount: 4 });
    t.recordDamage(0, 1, 5, 10);
    t.recordDamage(2, 1, 7, 20);
    t.recordDamage(0, 3, 11, 30);
    expect(t.getStats(0).damageDealt).toBe(16);
    expect(t.getStats(2).damageDealt).toBe(7);
    expect(t.getStats(1).damageTaken).toBe(12);
    expect(t.getStats(3).damageTaken).toBe(11);
  });

  it('ignores self-damage', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    t.recordDamage(0, 0, 25, 10);
    expect(t.getStats(0).damageDealt).toBe(0);
    expect(t.getStats(0).damageTaken).toBe(0);
  });

  it('clamps negative damage to zero (does not decrement counters)', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    t.recordDamage(0, 1, 10, 10);
    t.recordDamage(0, 1, -5, 20);
    expect(t.getStats(0).damageDealt).toBe(10);
    expect(t.getStats(1).damageTaken).toBe(10);
  });

  it('ignores non-finite damage', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    t.recordDamage(0, 1, Number.NaN, 10);
    t.recordDamage(0, 1, Number.POSITIVE_INFINITY, 20);
    expect(t.getStats(0).damageDealt).toBe(0);
    expect(t.getStats(1).damageTaken).toBe(0);
  });

  it('zero-damage hits do not earn KO attribution', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    t.recordDamage(0, 1, 0, 10);
    expect(t.getLastAttacker(1)).toBeNull();
    t.recordStockLoss(1, 20);
    expect(t.getStats(0).kos).toBe(0);
  });

  it('floats are accepted on the damage input (mirrors HitInfo.damage: number)', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    t.recordDamage(0, 1, 3.5, 0);
    t.recordDamage(0, 1, 1.25, 1);
    expect(t.getStats(0).damageDealt).toBeCloseTo(4.75);
    expect(t.getStats(1).damageTaken).toBeCloseTo(4.75);
  });

  it('throws on out-of-range slot indices', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    expect(() => t.recordDamage(-1, 1, 5, 0)).toThrow();
    expect(() => t.recordDamage(0, 5, 5, 0)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// KO attribution
// ---------------------------------------------------------------------------

describe('MatchStatsTracker — KO attribution', () => {
  it('credits the most recent attacker within the window', () => {
    const t = new MatchStatsTracker({
      playerCount: 2,
      koAttributionWindowFrames: 180,
    });
    t.recordDamage(0, 1, 50, 100);
    t.recordStockLoss(1, 150); // 50 frames after hit — within window
    expect(t.getStats(0).kos).toBe(1);
    expect(t.getStats(1).kos).toBe(0);
    expect(t.getStats(1).deaths).toBe(1);
  });

  it('does not credit when the last hit is beyond the window', () => {
    const t = new MatchStatsTracker({
      playerCount: 2,
      koAttributionWindowFrames: 60,
    });
    t.recordDamage(0, 1, 50, 100);
    t.recordStockLoss(1, 200); // 100 frames later — beyond window
    expect(t.getStats(0).kos).toBe(0);
    expect(t.getStats(1).deaths).toBe(1);
  });

  it('credits exactly at the window edge', () => {
    const t = new MatchStatsTracker({
      playerCount: 2,
      koAttributionWindowFrames: 60,
    });
    t.recordDamage(0, 1, 30, 100);
    t.recordStockLoss(1, 160); // exactly 60 frames later
    expect(t.getStats(0).kos).toBe(1);
  });

  it('clears the credit after a stock loss (no double-attribution)', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    t.recordDamage(0, 1, 30, 10);
    t.recordStockLoss(1, 20);
    expect(t.getStats(0).kos).toBe(1);
    // No fresh hit — second stock loss is a self-destruct.
    t.recordStockLoss(1, 30);
    expect(t.getStats(0).kos).toBe(1); // unchanged
    expect(t.getStats(1).deaths).toBe(2);
  });

  it('most-recent attacker wins (overwrites earlier credit)', () => {
    const t = new MatchStatsTracker({ playerCount: 4 });
    t.recordDamage(0, 1, 5, 10);
    t.recordDamage(2, 1, 5, 20); // p2 jumps in last → owns the credit
    t.recordStockLoss(1, 30);
    expect(t.getStats(0).kos).toBe(0);
    expect(t.getStats(2).kos).toBe(1);
  });

  it('stock loss with no prior hit credits no one (clean self-destruct)', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    t.recordStockLoss(0, 50);
    expect(t.getStats(0).deaths).toBe(1);
    expect(t.getStats(1).kos).toBe(0);
  });

  it('clearing happens even when the credit was beyond-window', () => {
    // A stale credit is dropped on stock loss so a *next* fresh hit
    // can earn its own credit.
    const t = new MatchStatsTracker({
      playerCount: 2,
      koAttributionWindowFrames: 30,
    });
    t.recordDamage(0, 1, 5, 10);
    t.recordStockLoss(1, 100); // beyond window — no credit
    expect(t.getStats(0).kos).toBe(0);
    // Now a fresh hit then a stock loss within window → counts.
    t.recordDamage(0, 1, 5, 200);
    t.recordStockLoss(1, 220);
    expect(t.getStats(0).kos).toBe(1);
  });

  it('out-of-order frame on stock loss does not credit (defensive)', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    t.recordDamage(0, 1, 5, 100);
    // Stock loss reported on an earlier frame (clock glitch / replay
    // resync) — elapsed is negative; we don't credit.
    t.recordStockLoss(1, 50);
    expect(t.getStats(0).kos).toBe(0);
  });

  it('zero-window mode requires same-frame hit to credit', () => {
    const t = new MatchStatsTracker({
      playerCount: 2,
      koAttributionWindowFrames: 0,
    });
    t.recordDamage(0, 1, 5, 100);
    t.recordStockLoss(1, 100);
    expect(t.getStats(0).kos).toBe(1);
    // Re-arm with a same-frame hit + stock loss on the next frame:
    t.recordDamage(0, 1, 5, 200);
    t.recordStockLoss(1, 201);
    expect(t.getStats(0).kos).toBe(1); // unchanged — out of window
  });
});

// ---------------------------------------------------------------------------
// Survival frames & elimination
// ---------------------------------------------------------------------------

describe('MatchStatsTracker — survival frames', () => {
  it('returns live survival when currentFrame is provided and player is alive', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    expect(t.getStats(0, 0).survivalFrames).toBe(0);
    expect(t.getStats(0, 60).survivalFrames).toBe(60);
    expect(t.getStats(0, 600).survivalFrames).toBe(600);
  });

  it('respects matchStartFrame anchor', () => {
    const t = new MatchStatsTracker({ playerCount: 2, matchStartFrame: 100 });
    expect(t.getStats(0, 100).survivalFrames).toBe(0);
    expect(t.getStats(0, 250).survivalFrames).toBe(150);
  });

  it('clamps to zero when currentFrame is before matchStartFrame', () => {
    const t = new MatchStatsTracker({ playerCount: 2, matchStartFrame: 100 });
    expect(t.getStats(0, 50).survivalFrames).toBe(0);
  });

  it('returns 0 for live players when no currentFrame is provided', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    expect(t.getStats(0).survivalFrames).toBe(0);
  });

  it('latches survival frames on elimination', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    t.recordElimination(0, 300);
    // Even querying with a much later frame, the latched value sticks.
    expect(t.getStats(0, 9999).survivalFrames).toBe(300);
    expect(t.getStats(0).survivalFrames).toBe(300);
    expect(t.getStats(0).eliminated).toBe(true);
  });

  it('latches elimination relative to matchStartFrame', () => {
    const t = new MatchStatsTracker({ playerCount: 2, matchStartFrame: 100 });
    t.recordElimination(0, 250);
    expect(t.getStats(0).survivalFrames).toBe(150);
  });

  it('elimination is idempotent — second call does not shift the latched frame', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    t.recordElimination(0, 300);
    t.recordElimination(0, 9999);
    expect(t.getStats(0).survivalFrames).toBe(300);
  });

  it('clamps survival to zero if elimination frame precedes match start', () => {
    const t = new MatchStatsTracker({ playerCount: 2, matchStartFrame: 100 });
    t.recordElimination(0, 50);
    expect(t.getStats(0).survivalFrames).toBe(0);
    expect(t.getStats(0).eliminated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// finalize
// ---------------------------------------------------------------------------

describe('MatchStatsTracker — finalize', () => {
  it('latches survival frames for every still-alive player', () => {
    const t = new MatchStatsTracker({ playerCount: 4 });
    t.recordElimination(0, 100); // eliminated
    t.recordElimination(2, 250); // eliminated
    t.finalize(500);
    // Eliminated keep their original frames.
    expect(t.getStats(0).survivalFrames).toBe(100);
    expect(t.getStats(2).survivalFrames).toBe(250);
    // Still-alive players latch at finalize frame.
    expect(t.getStats(1).survivalFrames).toBe(500);
    expect(t.getStats(3).survivalFrames).toBe(500);
    // Live currentFrame queries should NOT keep advancing.
    expect(t.getStats(1, 9999).survivalFrames).toBe(500);
  });

  it('flips isFinalized() and exposes the finalize frame', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    expect(t.isFinalized()).toBe(false);
    expect(t.getFinalizedFrame()).toBe(-1);
    t.finalize(420);
    expect(t.isFinalized()).toBe(true);
    expect(t.getFinalizedFrame()).toBe(420);
  });

  it('is idempotent — second finalize does not shift latched values', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    t.finalize(100);
    t.finalize(9999);
    expect(t.getFinalizedFrame()).toBe(100);
    expect(t.getStats(0).survivalFrames).toBe(100);
  });

  it('eliminated-after-finalize is still respected as latched', () => {
    // Theoretically the scene shouldn't deliver a stock loss after
    // finalize, but defensively: a late elimination doesn't bump the
    // already-latched survival frames lower or higher.
    const t = new MatchStatsTracker({ playerCount: 2 });
    t.finalize(500);
    expect(t.getStats(0).survivalFrames).toBe(500);
    t.recordElimination(0, 600);
    // Latched survival comes from finalize, not the late elimination —
    // recordElimination's idempotency guard preserves the earlier value.
    expect(t.getStats(0).survivalFrames).toBe(500);
    expect(t.getStats(0).eliminated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getAllStats & getLastAttacker
// ---------------------------------------------------------------------------

describe('MatchStatsTracker — getAllStats', () => {
  it('returns one snapshot per slot, in slot order', () => {
    const t = new MatchStatsTracker({ playerCount: 3 });
    t.recordDamage(0, 1, 7, 10);
    t.recordDamage(2, 1, 3, 20);
    const all = t.getAllStats(60);
    expect(all.length).toBe(3);
    expect(all[0]!.damageDealt).toBe(7);
    expect(all[1]!.damageTaken).toBe(10);
    expect(all[2]!.damageDealt).toBe(3);
    expect(all[0]!.survivalFrames).toBe(60);
  });

  it('returns a frozen array (immutable contract)', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    const all = t.getAllStats();
    expect(Object.isFrozen(all)).toBe(true);
  });
});

describe('MatchStatsTracker — getLastAttacker', () => {
  it('returns null when nobody has hit the target', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    expect(t.getLastAttacker(0)).toBeNull();
  });

  it('returns the most recent attacker after a hit', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    t.recordDamage(1, 0, 5, 10);
    expect(t.getLastAttacker(0)).toBe(1);
  });

  it('returns null after a stock loss clears the credit', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    t.recordDamage(1, 0, 5, 10);
    t.recordStockLoss(0, 20);
    expect(t.getLastAttacker(0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe('MatchStatsTracker — reset', () => {
  it('zeros every counter and clears every credit', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    t.recordDamage(0, 1, 25, 10);
    t.recordStockLoss(1, 20);
    t.recordElimination(1, 20);
    t.finalize(60);
    t.reset();
    for (let i = 0; i < 2; i += 1) {
      const s = t.getStats(i, 100);
      expect(s.kos).toBe(0);
      expect(s.deaths).toBe(0);
      expect(s.damageDealt).toBe(0);
      expect(s.damageTaken).toBe(0);
      expect(s.survivalFrames).toBe(100); // live again
      expect(s.eliminated).toBe(false);
    }
    expect(t.isFinalized()).toBe(false);
    expect(t.getLastAttacker(0)).toBeNull();
    expect(t.getLastAttacker(1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('MatchStatsTracker — determinism', () => {
  it('replaying the same event log produces identical stats', () => {
    type Event =
      | { kind: 'dmg'; a: number; t: number; d: number; f: number }
      | { kind: 'stock'; t: number; f: number }
      | { kind: 'elim'; t: number; f: number }
      | { kind: 'final'; f: number };

    const events: Event[] = [
      { kind: 'dmg', a: 0, t: 1, d: 8, f: 10 },
      { kind: 'dmg', a: 1, t: 0, d: 3, f: 20 },
      { kind: 'dmg', a: 0, t: 1, d: 12, f: 35 },
      { kind: 'stock', t: 1, f: 40 },
      { kind: 'dmg', a: 1, t: 0, d: 18, f: 100 },
      { kind: 'stock', t: 0, f: 110 },
      { kind: 'elim', t: 0, f: 110 },
      { kind: 'final', f: 200 },
    ];

    function run(): ReadonlyArray<unknown> {
      const t = new MatchStatsTracker({ playerCount: 2 });
      for (const ev of events) {
        if (ev.kind === 'dmg') t.recordDamage(ev.a, ev.t, ev.d, ev.f);
        else if (ev.kind === 'stock') t.recordStockLoss(ev.t, ev.f);
        else if (ev.kind === 'elim') t.recordElimination(ev.t, ev.f);
        else t.finalize(ev.f);
      }
      // Strip the `Object.freeze` wrapper for easy structural compare.
      return JSON.parse(JSON.stringify(t.getAllStats()));
    }

    expect(run()).toEqual(run());
  });

  it('mid-match snapshot is a pure function of (events, currentFrame)', () => {
    function snapshot(currentFrame: number): unknown {
      const t = new MatchStatsTracker({ playerCount: 2 });
      t.recordDamage(0, 1, 7, 10);
      t.recordDamage(0, 1, 5, 50);
      t.recordStockLoss(1, 60);
      return JSON.parse(JSON.stringify(t.getAllStats(currentFrame)));
    }
    expect(snapshot(120)).toEqual(snapshot(120));
  });
});

// ---------------------------------------------------------------------------
// Integration smoke — realistic 2-player match
// ---------------------------------------------------------------------------

describe('MatchStatsTracker — integration smoke', () => {
  it('records a realistic 2-player match end-to-end', () => {
    const t = new MatchStatsTracker({ playerCount: 2 });
    // Frame 30: P0 jabs P1 for 4 %.
    t.recordDamage(0, 1, 4, 30);
    // Frame 60: P1 jabs P0 for 6 %.
    t.recordDamage(1, 0, 6, 60);
    // Frame 120: P0 smashes P1 for 18 % then KOs them at frame 130.
    t.recordDamage(0, 1, 18, 120);
    t.recordStockLoss(1, 130);
    // Frame 250: P1 KOs P0 (28 % hit then stock loss within 60 frames).
    t.recordDamage(1, 0, 28, 250);
    t.recordStockLoss(0, 280);
    // Frame 410: P0 self-destructs (no recent hit on P0 within window).
    t.recordStockLoss(0, 410);
    // Frame 520: P1 self-destructs (final stock).
    t.recordStockLoss(1, 520);
    t.recordElimination(1, 520);
    t.finalize(620);

    const [a, b] = t.getAllStats();
    // P0 dealt 4 + 18 = 22 %, took 6 + 28 = 34 %, scored 1 KO, died 2x.
    expect(a!.damageDealt).toBe(22);
    expect(a!.damageTaken).toBe(34);
    expect(a!.kos).toBe(1);
    expect(a!.deaths).toBe(2);
    // P1 dealt 6 + 28 = 34 %, took 4 + 18 = 22 %, scored 1 KO, died 2x.
    expect(b!.damageDealt).toBe(34);
    expect(b!.damageTaken).toBe(22);
    expect(b!.kos).toBe(1);
    expect(b!.deaths).toBe(2);
    // Survival: P0 not eliminated → finalized at 620; P1 eliminated at 520.
    expect(a!.eliminated).toBe(false);
    expect(a!.survivalFrames).toBe(620);
    expect(b!.eliminated).toBe(true);
    expect(b!.survivalFrames).toBe(520);
  });
});
