import { describe, it, expect } from 'vitest';
import { StockTracker } from './StockTracker';
import { MatchStatsTracker } from './MatchStatsTracker';
import {
  DEFAULT_ENDING_DURATION_FRAMES,
  MatchEndDetector,
} from './MatchEndDetector';

/**
 * Sub-AC 4.3 of AC 303: match-end detection & results-flow state machine.
 *
 * `MatchEndDetector` sits on top of `StockTracker` and answers three
 * questions the gameplay scene needs:
 *
 *   1. Has the match ended? (last-player-standing or draw)
 *   2. Are we still in the "GAME!" freeze, or ready to switch scenes?
 *   3. What payload do I hand the results scene?
 *
 * These tests lock down:
 *
 *   • Default freeze duration is the canonical 3 seconds.
 *   • State machine transitions ACTIVE → ENDING → READY at the right
 *     frames; 0-frame freeze short-circuits to READY immediately.
 *   • Result payload is snapshotted on entry to ENDING so a late stock
 *     event can't mutate what the player sees.
 *   • `consumeShouldTransition()` fires exactly once across the whole
 *     match — no double-start.
 *   • Player-name fallbacks behave; stage name is optional.
 *   • `reset()` returns to ACTIVE for rematch / replay rewind.
 *   • Determinism — replaying the same event log produces identical
 *     payloads.
 */

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe('MatchEndDetector — defaults', () => {
  it('default ending duration is 3 seconds at 60 Hz', () => {
    expect(DEFAULT_ENDING_DURATION_FRAMES).toBe(180);
  });
});

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

describe('MatchEndDetector — state machine', () => {
  it('starts in ACTIVE with no payload', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    const d = new MatchEndDetector(t);
    expect(d.getPhase()).toBe('active');
    expect(d.isMatchOver()).toBe(false);
    expect(d.getEndFrame()).toBe(-1);
    expect(d.getResultPayload()).toBeNull();
    expect(d.consumeShouldTransition()).toBe(false);
  });

  it('does not advance while the match is in progress', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 3 });
    const d = new MatchEndDetector(t);
    for (let f = 0; f < 100; f += 1) {
      d.update(f);
    }
    expect(d.getPhase()).toBe('active');
  });

  it('enters ENDING the same frame the tracker reports match-over', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    const d = new MatchEndDetector(t, { endingDurationFrames: 60 });
    // Frame 7: player 1 loses last stock → match over.
    t.loseStock(1, 7);
    d.update(7);
    expect(d.getPhase()).toBe('ending');
    expect(d.getEndFrame()).toBe(7);
    expect(d.isMatchOver()).toBe(true);
    // Payload snapshotted now.
    const payload = d.getResultPayload();
    expect(payload).not.toBeNull();
    expect(payload!.winnerIndex).toBe(0);
    expect(payload!.endFrame).toBe(7);
  });

  it('advances ENDING → READY after endingDurationFrames frames', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    const d = new MatchEndDetector(t, { endingDurationFrames: 60 });
    t.loseStock(1, 100);
    d.update(100);
    expect(d.getPhase()).toBe('ending');
    // 59 frames in — still ending.
    d.update(159);
    expect(d.getPhase()).toBe('ending');
    expect(d.getRemainingEndingFrames(159)).toBe(1);
    // 60th frame — flip to READY.
    d.update(160);
    expect(d.getPhase()).toBe('ready');
    expect(d.getRemainingEndingFrames(160)).toBe(0);
  });

  it('0-frame freeze short-circuits ENDING straight to READY', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    const d = new MatchEndDetector(t, { endingDurationFrames: 0 });
    t.loseStock(1, 50);
    d.update(50);
    expect(d.getPhase()).toBe('ready');
  });

  it('READY is terminal — further updates do not regress', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    const d = new MatchEndDetector(t, { endingDurationFrames: 0 });
    t.loseStock(1, 0);
    d.update(0);
    d.update(1000);
    expect(d.getPhase()).toBe('ready');
  });

  it('getRemainingEndingFrames is -1 while ACTIVE', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 3 });
    const d = new MatchEndDetector(t);
    expect(d.getRemainingEndingFrames(50)).toBe(-1);
  });

  it('floor-clamps fractional / negative frames defensively', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    const d = new MatchEndDetector(t, { endingDurationFrames: 30 });
    t.loseStock(1, 100);
    d.update(100.7);
    expect(d.getEndFrame()).toBe(100);
    // Negative frame — clamped to 0; still in ENDING because 0-100 < 30.
    d.update(-50);
    expect(d.getPhase()).toBe('ending');
  });
});

// ---------------------------------------------------------------------------
// consumeShouldTransition
// ---------------------------------------------------------------------------

describe('MatchEndDetector — consumeShouldTransition', () => {
  it('fires exactly once on entry to READY', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    const d = new MatchEndDetector(t, { endingDurationFrames: 0 });
    t.loseStock(1, 0);
    d.update(0);
    expect(d.consumeShouldTransition()).toBe(true);
    expect(d.consumeShouldTransition()).toBe(false);
    expect(d.consumeShouldTransition()).toBe(false);
  });

  it('does not fire while still in ENDING', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    const d = new MatchEndDetector(t, { endingDurationFrames: 60 });
    t.loseStock(1, 0);
    d.update(0);
    expect(d.consumeShouldTransition()).toBe(false);
    d.update(30);
    expect(d.consumeShouldTransition()).toBe(false);
  });

  it('does not fire while ACTIVE', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 3 });
    const d = new MatchEndDetector(t);
    d.update(0);
    expect(d.consumeShouldTransition()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Result payload
// ---------------------------------------------------------------------------

describe('MatchEndDetector — result payload', () => {
  it('snapshots the winner on entry to ENDING', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    const d = new MatchEndDetector(t, {
      endingDurationFrames: 60,
      playerNames: ['Wolf', 'Cat'],
      stageName: 'Flat Stage',
    });
    t.loseStock(1, 42);
    d.update(42);
    const payload = d.getResultPayload()!;
    expect(payload.winnerIndex).toBe(0);
    expect(payload.winnerName).toBe('Wolf');
    expect(payload.playerNames).toEqual(['Wolf', 'Cat']);
    expect(payload.finalStocks).toEqual([1, 0]);
    expect(payload.endFrame).toBe(42);
    expect(payload.stageName).toBe('Flat Stage');
  });

  it('returns winnerIndex=null with winnerName=null on a draw', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    const d = new MatchEndDetector(t, { endingDurationFrames: 0 });
    t.loseStock(0, 10);
    t.loseStock(1, 10);
    d.update(10);
    const payload = d.getResultPayload()!;
    expect(payload.winnerIndex).toBeNull();
    expect(payload.winnerName).toBeNull();
    expect(payload.finalStocks).toEqual([0, 0]);
  });

  it('falls back to "Player N+1" when names are not provided', () => {
    const t = new StockTracker({ playerCount: 4, stockCount: 1 });
    const d = new MatchEndDetector(t, { endingDurationFrames: 0 });
    t.loseStock(1, 0);
    t.loseStock(2, 0);
    t.loseStock(3, 0);
    d.update(0);
    const payload = d.getResultPayload()!;
    expect(payload.playerNames).toEqual([
      'Player 1',
      'Player 2',
      'Player 3',
      'Player 4',
    ]);
    expect(payload.winnerName).toBe('Player 1');
  });

  it('partial player-name list is filled in with fallbacks', () => {
    const t = new StockTracker({ playerCount: 4, stockCount: 1 });
    const d = new MatchEndDetector(t, {
      endingDurationFrames: 0,
      playerNames: ['Wolf'],
    });
    t.loseStock(1, 0);
    t.loseStock(2, 0);
    t.loseStock(3, 0);
    d.update(0);
    const payload = d.getResultPayload()!;
    expect(payload.playerNames).toEqual([
      'Wolf',
      'Player 2',
      'Player 3',
      'Player 4',
    ]);
  });

  it('stageName is null when not configured', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    const d = new MatchEndDetector(t, { endingDurationFrames: 0 });
    t.loseStock(1, 0);
    d.update(0);
    expect(d.getResultPayload()!.stageName).toBeNull();
  });

  it('payload is frozen (post-end stock events do not mutate it)', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    const d = new MatchEndDetector(t, {
      endingDurationFrames: 60,
      playerNames: ['Wolf', 'Cat'],
    });
    t.loseStock(1, 0);
    d.update(0);
    const payload = d.getResultPayload()!;
    expect(payload.winnerIndex).toBe(0);
    // Late event — tracker absorbs it (already eliminated), but the
    // payload must not change.
    t.loseStock(1, 30);
    expect(d.getResultPayload()).toBe(payload);
    expect(payload.winnerIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Reset (rematch / replay rewind)
// ---------------------------------------------------------------------------

describe('MatchEndDetector — reset', () => {
  it('returns to ACTIVE and clears the payload', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    const d = new MatchEndDetector(t, { endingDurationFrames: 0 });
    t.loseStock(1, 0);
    d.update(0);
    expect(d.getPhase()).toBe('ready');
    d.reset();
    expect(d.getPhase()).toBe('active');
    expect(d.getEndFrame()).toBe(-1);
    expect(d.getResultPayload()).toBeNull();
    expect(d.consumeShouldTransition()).toBe(false);
  });

  it('after reset + tracker.reset, a fresh match-over is detected again', () => {
    const t = new StockTracker({ playerCount: 2, stockCount: 1 });
    const d = new MatchEndDetector(t, { endingDurationFrames: 0 });
    t.loseStock(1, 0);
    d.update(0);
    d.reset();
    t.reset();

    // Fresh match — P0 takes the loss this time.
    t.loseStock(0, 100);
    d.update(100);
    const payload = d.getResultPayload()!;
    expect(payload.winnerIndex).toBe(1);
    expect(payload.endFrame).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 3 of AC 16 — stats-tracker wire to the result payload
// ---------------------------------------------------------------------------

/**
 * Sub-AC 3 of AC 16 ("Wire match-end trigger to transition from gameplay to
 * the stats screen, passing the collected statistics data") asserts:
 *
 *   • When a `MatchStatsTracker` is supplied via
 *     `MatchEndDetectorOptions.statsTracker`, the detector reads its
 *     per-player snapshot at the canonical match-end frame and surfaces
 *     it on the result payload's `playerStats` field — i.e. the data
 *     `MatchScene` hands to `ResultsScene` via
 *     `scene.start('ResultsScene', payload)`.
 *
 *   • When no tracker is supplied (legacy callers, headless utilities,
 *     direct dev navigation), `playerStats` is `null` so the renderer's
 *     gate (`if (this.payload.playerStats)`) cleanly skips the stats
 *     panel without crashing.
 *
 *   • The detector calls `tracker.finalize(endFrame)` on entry to
 *     ENDING so still-alive players' survival counters latch on the
 *     match-end frame even if the scene queries the tracker later.
 *
 *   • The snapshot is frozen at ENDING-entry — late `recordDamage` /
 *     `recordStockLoss` calls (e.g. a corpse blast-zone hit on the
 *     same physics step) do not mutate what the player sees on the
 *     results screen.
 *
 *   • Slot order matches `playerNames` / `finalStocks`, so the
 *     renderer can iterate one index range across all three arrays.
 */
describe('MatchEndDetector — stats-tracker wire (Sub-AC 3 of AC 16)', () => {
  it('snapshots playerStats from the supplied MatchStatsTracker on entry to ENDING', () => {
    const tracker = new StockTracker({ playerCount: 2, stockCount: 1 });
    const stats = new MatchStatsTracker({
      playerCount: 2,
      matchStartFrame: 0,
    });

    // Player 0 lands a 30% hit on player 1, then KOs them.
    stats.recordDamage(0, 1, 30, 100);
    tracker.loseStock(1, 100);
    stats.recordStockLoss(1, 100);
    stats.recordElimination(1, 100);

    const detector = new MatchEndDetector(tracker, {
      endingDurationFrames: 60,
      playerNames: ['Wolf', 'Cat'],
      statsTracker: stats,
    });
    detector.update(100);

    const payload = detector.getResultPayload();
    expect(payload).not.toBeNull();
    expect(payload!.playerStats).not.toBeNull();
    expect(payload!.playerStats).toHaveLength(2);

    // Slot 0 (winner): 1 KO, 30% dealt, 0 damage taken, alive at end.
    expect(payload!.playerStats![0]).toMatchObject({
      kos: 1,
      deaths: 0,
      damageDealt: 30,
      damageTaken: 0,
      eliminated: false,
    });
    // Slot 1 (loser): 0 KOs, 30% taken, eliminated at frame 100.
    expect(payload!.playerStats![1]).toMatchObject({
      kos: 0,
      deaths: 1,
      damageDealt: 0,
      damageTaken: 30,
      eliminated: true,
    });

    // Slot order must match the canonical playerNames / finalStocks order
    // so the renderer can index all three arrays in a single forEach.
    expect(payload!.playerNames).toEqual(['Wolf', 'Cat']);
    expect(payload!.finalStocks).toEqual([1, 0]);
  });

  it('omits playerStats (null) when no statsTracker is supplied', () => {
    // Legacy / headless callers must keep working — the detector
    // tolerates a missing tracker by setting `playerStats: null`.
    const tracker = new StockTracker({ playerCount: 2, stockCount: 1 });
    const detector = new MatchEndDetector(tracker, {
      endingDurationFrames: 0,
    });
    tracker.loseStock(1, 50);
    detector.update(50);

    const payload = detector.getResultPayload();
    expect(payload).not.toBeNull();
    expect(payload!.playerStats).toBeNull();
  });

  it('finalises the stats tracker on the canonical match-end frame', () => {
    // Survival frames for still-alive players must latch on the frame
    // the detector enters ENDING — not later, when the results scene
    // happens to query. Otherwise a slow renderer would inflate the
    // numbers shown on screen.
    const tracker = new StockTracker({ playerCount: 2, stockCount: 1 });
    const stats = new MatchStatsTracker({
      playerCount: 2,
      matchStartFrame: 0,
    });

    const detector = new MatchEndDetector(tracker, {
      endingDurationFrames: 0,
      statsTracker: stats,
    });

    expect(stats.isFinalized()).toBe(false);
    tracker.loseStock(1, 600);
    detector.update(600);

    expect(stats.isFinalized()).toBe(true);
    expect(stats.getFinalizedFrame()).toBe(600);
    // The winner's survival frames should be exactly 600 — match start
    // (0) → end frame (600) at 60 Hz = 10 seconds.
    const payload = detector.getResultPayload();
    expect(payload!.playerStats![0]!.survivalFrames).toBe(600);
  });

  it('freezes playerStats — late damage / stock events do not mutate the payload', () => {
    // Mirrors the existing "payload is frozen" guard from the winner
    // block, but exercises the stats arm of the snapshot. A corpse
    // blast-zone hit firing on the same physics step the detector
    // enters ENDING must not retroactively change the results screen.
    const tracker = new StockTracker({ playerCount: 2, stockCount: 1 });
    const stats = new MatchStatsTracker({
      playerCount: 2,
      matchStartFrame: 0,
    });

    stats.recordDamage(0, 1, 50, 100);
    tracker.loseStock(1, 100);
    stats.recordStockLoss(1, 100);
    stats.recordElimination(1, 100);

    const detector = new MatchEndDetector(tracker, {
      endingDurationFrames: 60,
      playerNames: ['Wolf', 'Cat'],
      statsTracker: stats,
    });
    detector.update(100);

    const payload = detector.getResultPayload()!;
    const beforeStats = payload.playerStats!;
    expect(beforeStats[0]!.damageDealt).toBe(50);

    // Late event — a stray corpse hit lands after ENDING was entered.
    // The tracker absorbs it (it's still a live ledger), but the
    // detector's payload reference must remain pointing at the original
    // frozen snapshot from frame 100.
    stats.recordDamage(0, 1, 999, 130);

    const afterPayload = detector.getResultPayload();
    expect(afterPayload).toBe(payload); // identity preserved
    expect(afterPayload!.playerStats).toBe(beforeStats); // identity preserved
    expect(afterPayload!.playerStats![0]!.damageDealt).toBe(50);
  });

  it('idempotent finalize — pre-finalised tracker still produces a payload', () => {
    // The Sub-AC 3 docstring on the option says: "if the caller already
    // finalized the tracker for some other reason, finalize is
    // idempotent so it's still safe." This pins that behaviour: the
    // detector must produce a payload identical (in survival frames)
    // to one where the tracker was finalised by the detector itself.
    const tracker = new StockTracker({ playerCount: 2, stockCount: 1 });
    const stats = new MatchStatsTracker({
      playerCount: 2,
      matchStartFrame: 0,
    });
    // External actor finalises early — detector should not double-latch.
    stats.finalize(42);

    tracker.loseStock(1, 300);
    const detector = new MatchEndDetector(tracker, {
      endingDurationFrames: 0,
      statsTracker: stats,
    });
    detector.update(300);

    const payload = detector.getResultPayload();
    expect(payload!.playerStats).not.toBeNull();
    // Survival frames for slot 0 latched at 42 (from the external
    // finalize), not at 300 — the second finalize is a no-op.
    expect(payload!.playerStats![0]!.survivalFrames).toBe(42);
  });

  it('readme: the result payload is the contract for ResultsScene', () => {
    // Static surface guard — `MatchScene.ts` calls
    // `scene.start('ResultsScene', detector.getResultPayload())`.
    // The fields the results scene reads (winnerIndex, winnerName,
    // playerNames, finalStocks, stageName, endFrame, playerStats)
    // must all be present on the payload at ENDING-entry, even when
    // some are `null`.
    const tracker = new StockTracker({ playerCount: 2, stockCount: 1 });
    const stats = new MatchStatsTracker({
      playerCount: 2,
      matchStartFrame: 0,
    });
    tracker.loseStock(1, 0);
    const detector = new MatchEndDetector(tracker, {
      endingDurationFrames: 0,
      playerNames: ['Wolf', 'Cat'],
      stageName: 'Flat Stage',
      statsTracker: stats,
    });
    detector.update(0);

    const payload = detector.getResultPayload()!;
    expect(payload).toMatchObject({
      winnerIndex: 0,
      winnerName: 'Wolf',
      playerNames: ['Wolf', 'Cat'],
      stageName: 'Flat Stage',
      endFrame: 0,
    });
    // Stocks + stats are arrays at the canonical slot order.
    expect(Array.isArray(payload.finalStocks)).toBe(true);
    expect(Array.isArray(payload.playerStats)).toBe(true);
    expect(payload.playerStats!).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 3 of AC 16 — MatchScene transition wiring (static-text contract)
// ---------------------------------------------------------------------------

/**
 * Pins the *static* contract that `MatchScene` invokes the detector and
 * hands its payload to the results scene exactly once per match. Booting
 * the live Phaser scene from vitest pulls in browser globals; we instead
 * read `MatchScene.ts` as text and assert the wires are present.
 *
 * The behavioural side of this contract is covered above — that the
 * detector's payload contains the per-player stats. The two together
 * pin Sub-AC 3 end-to-end: the detector produces the stats-bearing
 * payload, and the gameplay scene consumes it on transition.
 */
describe('MatchScene → ResultsScene transition wire (Sub-AC 3 of AC 16)', () => {
  it('constructs MatchEndDetector with the MatchStatsTracker as statsTracker option', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.join(here, '..', 'scenes', 'MatchScene.ts'),
      'utf8',
    );
    // Detector built with the stats tracker as the `statsTracker` option.
    expect(src).toMatch(/new MatchEndDetector\(/);
    expect(src).toMatch(/statsTracker:\s*this\.matchStatsTracker/);
  });

  it('ticks the detector each fixed step and starts ResultsScene with the payload', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.join(here, '..', 'scenes', 'MatchScene.ts'),
      'utf8',
    );
    // Per-step tick.
    expect(src).toMatch(/this\.matchEndDetector\.update\(/);
    // One-shot transition guard.
    expect(src).toMatch(/this\.matchEndDetector\.consumeShouldTransition\(\)/);
    // Payload read from the detector.
    expect(src).toMatch(/this\.matchEndDetector\.getResultPayload\(\)/);
    // Scene transition with the payload (and a defensive `?? undefined`
    // for the null-payload path so Phaser doesn't choke on it).
    expect(src).toMatch(
      /scene\.start\(['"]ResultsScene['"],\s*payload\s*\?\?\s*undefined\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// Determinism gate
// ---------------------------------------------------------------------------

describe('MatchEndDetector — determinism', () => {
  it('replaying the same event log lands on the same end-frame & payload', () => {
    type Event =
      | { type: 'lose'; player: number; frame: number }
      | { type: 'tick'; frame: number };

    const log: Event[] = [
      { type: 'tick', frame: 0 },
      { type: 'lose', player: 0, frame: 30 },
      { type: 'tick', frame: 30 },
      { type: 'lose', player: 2, frame: 90 },
      { type: 'tick', frame: 90 },
      { type: 'lose', player: 3, frame: 150 },
      { type: 'tick', frame: 150 },
      { type: 'tick', frame: 200 },
      { type: 'tick', frame: 330 }, // 180 frames after end → READY
    ];

    const replay = (): {
      phase: string;
      endFrame: number;
      payload: unknown;
    } => {
      const t = new StockTracker({ playerCount: 4, stockCount: 1 });
      const d = new MatchEndDetector(t, {
        playerNames: ['Wolf', 'Cat', 'Owl', 'Bear'],
        stageName: 'Flat Stage',
      });
      for (const e of log) {
        if (e.type === 'lose') t.loseStock(e.player, e.frame);
        else d.update(e.frame);
      }
      return {
        phase: d.getPhase(),
        endFrame: d.getEndFrame(),
        payload: d.getResultPayload(),
      };
    };

    const a = replay();
    const b = replay();
    const c = replay();
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a.phase).toBe('ready');
    expect(a.endFrame).toBe(150);
  });
});
