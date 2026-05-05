/**
 * Sub-AC 3 of AC 60203 — KO lifecycle integration test.
 *
 * This file is the "headline" integration test for the KO → stock →
 * respawn → game-over chain. While each module
 * ({@link StockTracker}, {@link BlastZoneWatcher},
 * {@link BlastZonePositionWatcher}, {@link MatchEndDetector}) has its
 * own unit-test suite locking down behaviour in isolation, the AC's
 * acceptance language is end-to-end:
 *
 *     "Implement stock/life decrement logic and fighter respawn
 *      handling triggered by KO events, including game-over detection
 *      when a fighter's stocks reach zero."
 *
 * To prove that *contract* — not just the parts — this suite wires the
 * four modules together exactly the way `MatchScene` does and exercises
 * the pipeline through a sequence of fake KO events. The fixtures stay
 * Phaser-/Matter-free so the integration runs under plain Node, just
 * like the rest of `match/`.
 *
 * What we lock down:
 *
 *   1. **Decrement on KO.** A position-based KO fires `loseStock` once,
 *      stocks go from 3 → 2, and the slot enters respawning state.
 *   2. **Idempotent KO sources.** When BOTH a collision-stream KO
 *      (`BlastZoneWatcher`) and a position-scan KO
 *      (`BlastZonePositionWatcher`) fire on the same frame for the
 *      same fighter — the StockTracker absorbs the duplicate so stocks
 *      decrement by exactly 1 per KO, never 2.
 *   3. **Respawn pipeline.** `consumePendingRespawns(frame)` fires once
 *      per scheduled respawn, re-emits the right `invincibilityFrames`
 *      window, and clears the position-watch out-of-bounds latch so
 *      the fighter can KO again.
 *   4. **Elimination on zero stocks.** A 1-stock fighter who KOs once
 *      flips `isEliminated` to true, no respawn is scheduled, and the
 *      fighter no longer responds to fresh KO events.
 *   5. **Game-over.** When all-but-one fighter has been eliminated, the
 *      `MatchEndDetector` flips to ENDING that very frame, latches a
 *      result payload, and (after the configured ending hold) reports
 *      `consumeShouldTransition() === true` exactly once.
 *   6. **Determinism.** The same KO event log replayed twice produces
 *      identical state, identical end-frame, identical payload —
 *      the gate the M4 replay system depends on.
 */

import { describe, it, expect } from 'vitest';
import { StockTracker, DEFAULT_INVINCIBILITY_FRAMES } from './StockTracker';
import {
  BlastZoneWatcher,
  type BlastZoneCollisionEvent,
  type MinimalBody,
} from './BlastZoneWatcher';
import {
  BlastZonePositionWatcher,
  type PositionedBody,
} from './BlastZonePositionWatcher';
import { MatchEndDetector, DEFAULT_ENDING_DURATION_FRAMES } from './MatchEndDetector';
import { BLAST_ZONE_LABELS } from '../stages/StageRenderer';
import type { BlastZone } from '../types';

// ---------------------------------------------------------------------------
// Fixtures — modelled after the MatchScene wiring
// ---------------------------------------------------------------------------

const FLAT_ZONE: BlastZone = Object.freeze({
  left: -100,
  right: 100,
  top: -50,
  bottom: 50,
});

interface FakeBody extends MinimalBody, PositionedBody {
  position: { x: number; y: number };
  label: string;
}

function makeFighter(x: number, y: number): FakeBody {
  // Mirrors `Character.body` — both watchers can read from the same body.
  return { label: 'character.body', position: { x, y } };
}

/**
 * The integration harness: same modules MatchScene wires together.
 * Constructed once per test so each test starts from a pristine match.
 */
interface MatchHarness {
  readonly tracker: StockTracker;
  readonly collisionWatcher: BlastZoneWatcher;
  readonly positionWatcher: BlastZonePositionWatcher;
  readonly endDetector: MatchEndDetector;
  readonly bodies: ReadonlyArray<FakeBody>;
  /** Move + position-scan + tick the detector — one fixed step. */
  readonly step: (frame: number) => void;
  /** Fire a fake collision-pair event for `playerIndex` crossing the top edge. */
  readonly fireCollisionKO: (playerIndex: number) => void;
}

function makeHarness(options?: {
  readonly playerCount?: number;
  readonly stockCount?: number;
  readonly endingDurationFrames?: number;
  readonly playerNames?: ReadonlyArray<string>;
  readonly invincibilityFrames?: number;
  readonly respawnDelayFrames?: number;
  /**
   * Optional respawn handler — called for every drained respawn on
   * each step. Default: teleport the fighter back to a safe spawn
   * point in-bounds and clear the position watcher's latch.
   */
  readonly onRespawn?: (playerIndex: number, body: FakeBody) => void;
}): MatchHarness {
  const playerCount = options?.playerCount ?? 2;
  const tracker = new StockTracker({
    playerCount,
    stockCount: options?.stockCount,
    invincibilityFrames: options?.invincibilityFrames,
    respawnDelayFrames: options?.respawnDelayFrames,
  });
  const collisionWatcher = new BlastZoneWatcher((playerIndex) => {
    tracker.loseStock(playerIndex, 0); // frame is replaced on real call below
  });
  const positionWatcher = new BlastZonePositionWatcher(FLAT_ZONE, (event) => {
    tracker.loseStock(event.playerIndex, event.frame);
  });
  const bodies: FakeBody[] = [];
  for (let i = 0; i < playerCount; i += 1) {
    // Spawn each body at a distinct safe in-bounds position.
    const x = (i - (playerCount - 1) / 2) * 30;
    const body = makeFighter(x, 0);
    bodies.push(body);
    collisionWatcher.registerPlayer(i, body);
    positionWatcher.registerPlayer(i, body);
  }
  const endDetector = new MatchEndDetector(tracker, {
    endingDurationFrames:
      options?.endingDurationFrames ?? DEFAULT_ENDING_DURATION_FRAMES,
    playerNames: options?.playerNames,
  });

  const respawn =
    options?.onRespawn ??
    ((_playerIndex, body) => {
      // Default respawn: move back to centre of stage in-bounds.
      body.position.x = 0;
      body.position.y = 0;
    });

  const step = (frame: number): void => {
    // Replicates the MatchScene step order: position scan → drain respawns
    // → tick detector. Collision events (if any) fire BEFORE this — we
    // expose a separate helper for them.
    positionWatcher.update(frame);
    const ready = tracker.consumePendingRespawns(frame);
    for (const ev of ready) {
      const body = bodies[ev.playerIndex];
      if (body) {
        respawn(ev.playerIndex, body);
        // Re-arm the position-scan latch — the fighter is back in-bounds.
        positionWatcher.clearOutOfBounds(ev.playerIndex);
      }
      // Eliminated slots wouldn't appear here (consumePendingRespawns
      // never yields one), but if a final-stock KO has been processed
      // we drop the corpse from both watchers like MatchScene does.
    }
    // Eliminated cleanup — match the scene's "unregister phantom corpses"
    // behaviour so a KO'd corpse drifting past the blast zone doesn't
    // re-trigger.
    for (let i = 0; i < playerCount; i += 1) {
      if (tracker.isEliminated(i)) {
        if (collisionWatcher.isRegistered(i)) collisionWatcher.unregisterPlayer(i);
        if (positionWatcher.isRegistered(i)) positionWatcher.unregisterPlayer(i);
      }
    }
    endDetector.update(frame);
  };

  const fireCollisionKO = (playerIndex: number): void => {
    const body = bodies[playerIndex];
    if (!body) return;
    const event: BlastZoneCollisionEvent = {
      pairs: [
        { bodyA: body, bodyB: { label: BLAST_ZONE_LABELS.top } },
      ],
    };
    collisionWatcher.handleCollisionStart(event);
  };

  return {
    tracker,
    collisionWatcher,
    positionWatcher,
    endDetector,
    bodies,
    step,
    fireCollisionKO,
  };
}

// ---------------------------------------------------------------------------
// 1. Decrement on KO
// ---------------------------------------------------------------------------

describe('KO lifecycle — stock decrement', () => {
  it('a single position-based KO decrements stocks by exactly 1', () => {
    // Use a non-zero respawn delay so the post-step state still shows
    // the slot in `respawning` — at the default 0-delay the slot is
    // drained in the same step it was scheduled (covered separately
    // in the "respawn pipeline" suite).
    const h = makeHarness({ stockCount: 3, respawnDelayFrames: 30 });
    expect(h.tracker.getStocks(0)).toBe(3);

    // Frame 5: P0 launched off the top blast zone.
    h.bodies[0]!.position.y = -200;
    h.step(5);

    expect(h.tracker.getStocks(0)).toBe(2);
    expect(h.tracker.isRespawning(0)).toBe(true);
    expect(h.tracker.isEliminated(0)).toBe(false);
    // Other slots untouched.
    expect(h.tracker.getStocks(1)).toBe(3);
  });

  it('a collision-based KO decrements stocks by exactly 1', () => {
    // Same reasoning — non-zero respawn delay keeps the slot in
    // `respawning` between the KO and the next drain.
    const h = makeHarness({ stockCount: 3, respawnDelayFrames: 30 });
    h.fireCollisionKO(1);
    expect(h.tracker.getStocks(1)).toBe(2);
    expect(h.tracker.isRespawning(1)).toBe(true);
    expect(h.tracker.getStocks(0)).toBe(3);
  });

  it('decrement is idempotent across BOTH KO sources on the same KO', () => {
    // The headline determinism property: even if the collision watcher
    // AND the position watcher both fire for the same fighter on the
    // same frame, the StockTracker only deducts ONE stock. This is what
    // protects against tunnelling-flag-plus-collision-event double-KOs.
    //
    // We delay the respawn so the assertion reads the post-KO state
    // before the drain. Then we exercise both sources in either order.
    const h = makeHarness({ stockCount: 3, respawnDelayFrames: 30 });

    // Move P0 past the top boundary so position-scan would fire, then
    // ALSO send a collision KO for the same slot.
    h.bodies[0]!.position.y = -200;
    h.fireCollisionKO(0); // → loseStock(0, 0): stocks 3→2, respawning
    // Position scan in the same step — already-respawning, no double-deduct.
    h.positionWatcher.update(0);

    expect(h.tracker.getStocks(0)).toBe(2);
    expect(h.tracker.isRespawning(0)).toBe(true);

    // And the reverse order — position-scan first, collision second —
    // also produces a single decrement.
    const h2 = makeHarness({ stockCount: 3, respawnDelayFrames: 30 });
    h2.bodies[0]!.position.y = -200;
    h2.positionWatcher.update(0); // → loseStock(0, 0): stocks 3→2, respawning
    h2.fireCollisionKO(0); // already-respawning → no-op
    expect(h2.tracker.getStocks(0)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Respawn pipeline
// ---------------------------------------------------------------------------

describe('KO lifecycle — respawn pipeline', () => {
  it('drains a 0-delay respawn on the same frame the KO happened', () => {
    let respawnedAt = -1;
    const h = makeHarness({
      respawnDelayFrames: 0,
      onRespawn: (i, body) => {
        if (i === 0) {
          respawnedAt = body.position.y; // sentinel — we'll re-zero it
          body.position.x = 0;
          body.position.y = 0;
        }
      },
    });

    h.bodies[0]!.position.y = -200;
    h.step(7);

    expect(h.tracker.getStocks(0)).toBe(2);
    expect(h.tracker.isRespawning(0)).toBe(false); // drained this same step
    expect(h.bodies[0]!.position).toEqual({ x: 0, y: 0 });
    // The respawn handler saw the off-stage Y coordinate before its
    // teleport — proves the drain ran AFTER the KO scan.
    expect(respawnedAt).toBe(-200);
  });

  it('respects respawnDelayFrames before draining', () => {
    const h = makeHarness({ respawnDelayFrames: 30 });
    h.bodies[0]!.position.y = -200;
    h.step(0);

    expect(h.tracker.getStocks(0)).toBe(2);
    // 29 frames — still respawning.
    h.step(29);
    expect(h.tracker.isRespawning(0)).toBe(true);
    // 30th frame — drained.
    h.step(30);
    expect(h.tracker.isRespawning(0)).toBe(false);
  });

  it('grants the configured invincibility window on respawn', () => {
    const observed: Array<{ playerIndex: number; iframes: number }> = [];
    const h = makeHarness({
      invincibilityFrames: 42,
      respawnDelayFrames: 0,
      onRespawn: (_playerIndex, body) => {
        body.position.x = 0;
        body.position.y = 0;
      },
    });
    // Hook the tracker's drain ourselves so we can read invincibilityFrames.
    // (The default harness step already drains; here we just read what
    // the tracker's RespawnEvent emitted.)
    h.bodies[0]!.position.y = -200;
    h.positionWatcher.update(0); // → loseStock
    const ready = h.tracker.consumePendingRespawns(0);
    for (const ev of ready) {
      observed.push({ playerIndex: ev.playerIndex, iframes: ev.invincibilityFrames });
    }
    expect(observed).toEqual([{ playerIndex: 0, iframes: 42 }]);
  });

  it('default invincibility window is the canonical 90-frame grace', () => {
    // Locks the constant against accidental drift across milestones.
    expect(DEFAULT_INVINCIBILITY_FRAMES).toBe(90);
    const h = makeHarness({ respawnDelayFrames: 0 });
    h.bodies[0]!.position.y = -200;
    h.positionWatcher.update(0);
    const [ev] = h.tracker.consumePendingRespawns(0);
    expect(ev!.invincibilityFrames).toBe(90);
  });

  it('a respawned fighter can KO again on a subsequent frame', () => {
    // Proves the position-watcher latch is cleared on respawn so the
    // SAME fighter dying twice produces TWO stock losses.
    const h = makeHarness({ stockCount: 3, respawnDelayFrames: 0 });
    // First KO.
    h.bodies[0]!.position.y = -200;
    h.step(0); // stock 3→2, respawn fires, position reset to (0,0)
    expect(h.tracker.getStocks(0)).toBe(2);
    expect(h.bodies[0]!.position).toEqual({ x: 0, y: 0 });

    // Second KO some frames later.
    h.bodies[0]!.position.y = -200;
    h.step(60);
    expect(h.tracker.getStocks(0)).toBe(1);

    // Third KO eliminates.
    h.bodies[0]!.position.y = -200;
    h.step(120);
    expect(h.tracker.getStocks(0)).toBe(0);
    expect(h.tracker.isEliminated(0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Elimination on zero stocks
// ---------------------------------------------------------------------------

describe('KO lifecycle — elimination', () => {
  it('1-stock fighter who KOs is eliminated, not respawned', () => {
    const h = makeHarness({ stockCount: 1 });
    h.bodies[0]!.position.y = -200;
    h.step(10);

    expect(h.tracker.getStocks(0)).toBe(0);
    expect(h.tracker.isEliminated(0)).toBe(true);
    expect(h.tracker.isRespawning(0)).toBe(false);
    expect(h.tracker.getRespawnFrame(0)).toBe(-1);
  });

  it('eliminated fighter is unregistered from both watchers', () => {
    const h = makeHarness({ stockCount: 1 });
    h.bodies[0]!.position.y = -200;
    h.step(0);
    expect(h.collisionWatcher.isRegistered(0)).toBe(false);
    expect(h.positionWatcher.isRegistered(0)).toBe(false);
  });

  it('further KO events for the eliminated slot are absorbed (no negative stocks)', () => {
    const h = makeHarness({ stockCount: 1, playerCount: 2 });
    h.bodies[0]!.position.y = -200;
    h.step(0);
    expect(h.tracker.getStocks(0)).toBe(0);

    // Try every KO source — none of them should affect the corpse.
    h.fireCollisionKO(0); // unregistered — no-op
    h.bodies[0]!.position.y = -300; // still off-screen
    h.step(60); // unregistered from position watcher too — no-op

    expect(h.tracker.getStocks(0)).toBe(0);
    expect(h.tracker.isEliminated(0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Game-over detection
// ---------------------------------------------------------------------------

describe('KO lifecycle — game-over detection', () => {
  it('flips to ENDING the frame the last opponent loses their last stock', () => {
    const h = makeHarness({
      playerCount: 2,
      stockCount: 1,
      endingDurationFrames: 60,
      playerNames: ['Wolf', 'Cat'],
    });
    expect(h.endDetector.getPhase()).toBe('active');

    // P1 takes the loss → P0 sole survivor.
    h.bodies[1]!.position.y = -200;
    h.step(11);

    expect(h.tracker.isMatchOver()).toBe(true);
    expect(h.endDetector.getPhase()).toBe('ending');
    expect(h.endDetector.getEndFrame()).toBe(11);
    const payload = h.endDetector.getResultPayload()!;
    expect(payload.winnerIndex).toBe(0);
    expect(payload.winnerName).toBe('Wolf');
    expect(payload.finalStocks).toEqual([1, 0]);
  });

  it('drives ENDING → READY after the configured ending duration', () => {
    const h = makeHarness({
      playerCount: 2,
      stockCount: 1,
      endingDurationFrames: 60,
    });
    h.bodies[1]!.position.y = -200;
    h.step(0);
    expect(h.endDetector.getPhase()).toBe('ending');

    // Tick through the freeze without firing fresh KOs. Bodies stay
    // wherever they fell.
    for (let f = 1; f <= 59; f += 1) h.step(f);
    expect(h.endDetector.getPhase()).toBe('ending');

    h.step(60);
    expect(h.endDetector.getPhase()).toBe('ready');
    expect(h.endDetector.consumeShouldTransition()).toBe(true);
    // Idempotent — calling again returns false.
    expect(h.endDetector.consumeShouldTransition()).toBe(false);
  });

  it('full 4-player FFA — last fighter standing wins', () => {
    const h = makeHarness({
      playerCount: 4,
      stockCount: 1,
      endingDurationFrames: 0,
      playerNames: ['Wolf', 'Cat', 'Owl', 'Bear'],
    });
    // KO P0, P1, P3 in sequence — P2 should win.
    h.bodies[0]!.position.y = -200;
    h.step(0);
    expect(h.tracker.isMatchOver()).toBe(false);

    h.bodies[1]!.position.y = -200;
    h.step(1);
    expect(h.tracker.isMatchOver()).toBe(false);

    h.bodies[3]!.position.y = -200;
    h.step(2);
    expect(h.tracker.isMatchOver()).toBe(true);

    expect(h.endDetector.getPhase()).toBe('ready');
    const payload = h.endDetector.getResultPayload()!;
    expect(payload.winnerIndex).toBe(2);
    expect(payload.winnerName).toBe('Owl');
    expect(payload.finalStocks).toEqual([0, 0, 1, 0]);
  });

  it('simultaneous final-stock KOs produce a draw payload', () => {
    const h = makeHarness({
      playerCount: 2,
      stockCount: 1,
      endingDurationFrames: 0,
    });
    // Both fighters cross the blast zone the same frame.
    h.bodies[0]!.position.y = -200;
    h.bodies[1]!.position.y = -200;
    h.step(50);

    expect(h.tracker.isMatchOver()).toBe(true);
    expect(h.endDetector.getPhase()).toBe('ready');
    const payload = h.endDetector.getResultPayload()!;
    expect(payload.winnerIndex).toBeNull();
    expect(payload.winnerName).toBeNull();
    expect(payload.finalStocks).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------------------
// 5. Determinism gate
// ---------------------------------------------------------------------------

describe('KO lifecycle — determinism', () => {
  it('replaying the same KO log twice produces byte-identical state', () => {
    type Event =
      | { type: 'ko-position'; playerIndex: number; frame: number }
      | { type: 'ko-collision'; playerIndex: number; frame: number }
      | { type: 'tick'; frame: number };

    const log: Event[] = [
      { type: 'tick', frame: 0 },
      { type: 'ko-position', playerIndex: 0, frame: 30 },
      { type: 'tick', frame: 30 },
      // Both watchers fire for the same fighter — must absorb one.
      { type: 'ko-collision', playerIndex: 1, frame: 60 },
      { type: 'ko-position', playerIndex: 1, frame: 60 },
      { type: 'tick', frame: 60 },
      { type: 'ko-position', playerIndex: 0, frame: 120 },
      { type: 'tick', frame: 120 },
      { type: 'ko-position', playerIndex: 0, frame: 200 }, // eliminate p0
      { type: 'tick', frame: 200 },
      { type: 'tick', frame: 380 }, // 180 frames after end → READY
    ];

    const replay = (): {
      stocks: number[];
      eliminated: boolean[];
      phase: string;
      endFrame: number;
      winner: number | null;
      finalStocks: ReadonlyArray<number> | null;
    } => {
      const h = makeHarness({
        playerCount: 2,
        stockCount: 3,
        playerNames: ['Wolf', 'Cat'],
      });
      for (const ev of log) {
        if (ev.type === 'ko-position') {
          h.bodies[ev.playerIndex]!.position.y = -200;
        } else if (ev.type === 'ko-collision') {
          h.fireCollisionKO(ev.playerIndex);
        } else {
          h.step(ev.frame);
        }
      }
      const payload = h.endDetector.getResultPayload();
      return {
        stocks: [0, 1].map((i) => h.tracker.getStocks(i)),
        eliminated: [0, 1].map((i) => h.tracker.isEliminated(i)),
        phase: h.endDetector.getPhase(),
        endFrame: h.endDetector.getEndFrame(),
        winner: payload?.winnerIndex ?? null,
        finalStocks: payload?.finalStocks ?? null,
      };
    };

    const a = replay();
    const b = replay();
    const c = replay();
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a.phase).toBe('ready');
    expect(a.winner).toBe(1);
    expect(a.finalStocks).toEqual([0, 2]);
  });
});
