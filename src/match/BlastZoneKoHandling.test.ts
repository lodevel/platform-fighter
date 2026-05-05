/**
 * Sub-AC 4 of AC 6 — KO handling on blast zone crossing.
 *
 * AC 6 of the seed reads:
 *
 *     "Damage system uses %-based knockback scaling with blast zone
 *      KOs on all 4 sides."
 *
 * Sub-AC 4 narrows that to the specific lifecycle that fires the moment
 * a fighter actually crosses the blast zone:
 *
 *     "Implement KO handling on blast zone crossing — life decrement,
 *      respawn or elimination, damage % reset."
 *
 * The headline KO lifecycle test ({@link KoLifecycle.test.ts}) already
 * exercises the StockTracker × BlastZoneWatcher × BlastZonePositionWatcher
 * × MatchEndDetector wiring, but its harness uses a position-only
 * `FakeBody` — it cannot prove the third contract point ("damage %
 * reset") because the fixture has no damage field to mutate.
 *
 * This file closes that gap. The harness here pairs the same StockTracker
 * + watcher modules with a `RespawnHandler` driving a recording target
 * that DOES carry a damage% field, so we can assert the three contract
 * points of Sub-AC 4 of AC 6 in a single end-to-end scenario:
 *
 *   1. **Life decrement** — a blast-zone crossing decrements the
 *      fighter's stocks by exactly 1 the frame they cross.
 *   2. **Respawn OR elimination** — when stocks remain the fighter is
 *      teleported back to its spawn point with the configured
 *      invincibility window; when stocks reach zero the fighter is
 *      eliminated and no respawn fires.
 *   3. **Damage % reset** — every respawn drives `setDamagePercent(0)`
 *      so the fighter re-enters the fight with a fresh meter, clearing
 *      whatever percent they accumulated before the KO.
 *
 * The KO handling pipeline is deliberately split across three modules
 * (StockTracker = state, BlastZone*Watcher = detection, RespawnHandler
 * = side-effects) so each piece is unit-testable on its own. This file
 * is the contract-level proof that the pieces compose into the AC's
 * single-sentence requirement.
 */

import { describe, it, expect } from 'vitest';
import { StockTracker } from './StockTracker';
import {
  BlastZonePositionWatcher,
  type PositionedBody,
} from './BlastZonePositionWatcher';
import {
  BlastZoneWatcher,
  type BlastZoneCollisionEvent,
  type MinimalBody,
} from './BlastZoneWatcher';
import { RespawnHandler, type RespawnTarget } from './RespawnHandler';
import { BLAST_ZONE_LABELS } from '../stages/StageRenderer';
import type { BlastZone } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BLAST_ZONE: BlastZone = Object.freeze({
  left: -100,
  right: 100,
  top: -50,
  bottom: 50,
});

interface DamageBody extends MinimalBody, PositionedBody {
  position: { x: number; y: number };
  label: string;
}

interface DamageTargetState {
  /** Fighter's current damage percent. Starts at the value seeded in the test. */
  damagePercent: number;
  /** Last applied position from setPosition(...). */
  position: { x: number; y: number };
  /** Last applied invincibility frames from setInvincibility(...). */
  invincibilityFrames: number;
  /** Last applied facing direction from setFacing(...). */
  facing: 1 | -1;
}

function makeDamageTarget(initialDamage: number): {
  target: RespawnTarget;
  state: DamageTargetState;
} {
  const state: DamageTargetState = {
    damagePercent: initialDamage,
    position: { x: 9999, y: 9999 },
    invincibilityFrames: 0,
    facing: 1,
  };
  const target: RespawnTarget = {
    setPosition(x, y) {
      state.position = { x, y };
    },
    setDamagePercent(p) {
      state.damagePercent = p;
    },
    setInvincibility(f) {
      state.invincibilityFrames = f;
    },
    setFacing(f) {
      state.facing = f;
    },
  };
  return { target, state };
}

interface KoHarness {
  readonly tracker: StockTracker;
  readonly collisionWatcher: BlastZoneWatcher;
  readonly positionWatcher: BlastZonePositionWatcher;
  readonly respawnHandler: RespawnHandler;
  readonly bodies: ReadonlyArray<DamageBody>;
  readonly states: ReadonlyArray<DamageTargetState>;
  readonly spawnPoints: ReadonlyArray<{ x: number; y: number }>;
  /** Move + position-scan + drain respawns — one fixed step. */
  readonly step: (frame: number) => void;
  /** Fire a fake top-edge collision pair for `playerIndex`. */
  readonly fireCollisionKO: (playerIndex: number) => void;
}

function makeHarness(options?: {
  readonly playerCount?: number;
  readonly stockCount?: number;
  readonly initialDamage?: number;
  readonly invincibilityFrames?: number;
  readonly respawnDelayFrames?: number;
}): KoHarness {
  const playerCount = options?.playerCount ?? 2;
  const initialDamage = options?.initialDamage ?? 0;
  const tracker = new StockTracker({
    playerCount,
    stockCount: options?.stockCount,
    invincibilityFrames: options?.invincibilityFrames,
    respawnDelayFrames: options?.respawnDelayFrames,
  });
  const respawnHandler = new RespawnHandler();
  const bodies: DamageBody[] = [];
  const states: DamageTargetState[] = [];
  const spawnPoints: Array<{ x: number; y: number }> = [];

  const collisionWatcher = new BlastZoneWatcher((playerIndex) => {
    tracker.loseStock(playerIndex, 0);
  });
  const positionWatcher = new BlastZonePositionWatcher(BLAST_ZONE, (event) => {
    tracker.loseStock(event.playerIndex, event.frame);
  });

  for (let i = 0; i < playerCount; i += 1) {
    const spawnX = (i - (playerCount - 1) / 2) * 30;
    const spawnY = 0;
    spawnPoints.push({ x: spawnX, y: spawnY });
    const body: DamageBody = { label: 'character.body', position: { x: spawnX, y: spawnY } };
    bodies.push(body);
    collisionWatcher.registerPlayer(i, body);
    positionWatcher.registerPlayer(i, body);
    const { target, state } = makeDamageTarget(initialDamage);
    states.push(state);
    respawnHandler.registerSlot(
      {
        playerIndex: i,
        spawnX,
        spawnY,
        faceOnSpawn: i % 2 === 0 ? 1 : -1,
      },
      target,
    );
  }

  // Re-arm the position-watch latch after every respawn so the fighter
  // can KO again on a subsequent crossing — mirrors the MatchScene wiring.
  respawnHandler.onRespawn((event) => {
    positionWatcher.clearOutOfBounds(event.playerIndex);
    // Move the fake body back to the spawn point so the position scan
    // sees an in-bounds fighter on the next tick. (RespawnHandler.applyRespawns
    // mutates the RespawnTarget, not the position-scan body — a real
    // Character ties them together; the fake doesn't.)
    const sp = spawnPoints[event.playerIndex];
    const body = bodies[event.playerIndex];
    if (sp && body) {
      body.position.x = sp.x;
      body.position.y = sp.y;
    }
  });

  const step = (frame: number): void => {
    positionWatcher.update(frame);
    const ready = tracker.consumePendingRespawns(frame);
    respawnHandler.applyRespawns(ready, frame);
    respawnHandler.update(frame);
    // Eliminated cleanup mirrors the scene.
    for (let i = 0; i < playerCount; i += 1) {
      if (tracker.isEliminated(i)) {
        if (collisionWatcher.isRegistered(i)) collisionWatcher.unregisterPlayer(i);
        if (positionWatcher.isRegistered(i)) positionWatcher.unregisterPlayer(i);
      }
    }
  };

  const fireCollisionKO = (playerIndex: number): void => {
    const body = bodies[playerIndex];
    if (!body) return;
    const event: BlastZoneCollisionEvent = {
      pairs: [{ bodyA: body, bodyB: { label: BLAST_ZONE_LABELS.top } }],
    };
    collisionWatcher.handleCollisionStart(event);
  };

  return {
    tracker,
    collisionWatcher,
    positionWatcher,
    respawnHandler,
    bodies,
    states,
    spawnPoints,
    step,
    fireCollisionKO,
  };
}

// ---------------------------------------------------------------------------
// Sub-AC 4 of AC 6 — contract: life decrement on blast zone crossing
// ---------------------------------------------------------------------------

describe('Sub-AC 4 of AC 6 — life decrement on blast zone crossing', () => {
  it('a single position-based crossing decrements stocks by exactly 1', () => {
    // Non-zero respawn delay so the post-step state still shows
    // the slot as "respawning" (otherwise the same-step drain hides it).
    const h = makeHarness({ stockCount: 3, respawnDelayFrames: 30 });

    h.bodies[0]!.position.y = -200; // past top blast zone
    h.step(5);

    expect(h.tracker.getStocks(0)).toBe(2);
    expect(h.tracker.isRespawning(0)).toBe(true);
    expect(h.tracker.isEliminated(0)).toBe(false);
    // No spillover into other slots.
    expect(h.tracker.getStocks(1)).toBe(3);
  });

  it('a collision-based crossing decrements stocks by exactly 1', () => {
    const h = makeHarness({ stockCount: 3, respawnDelayFrames: 30 });
    h.fireCollisionKO(1);
    expect(h.tracker.getStocks(1)).toBe(2);
    expect(h.tracker.isRespawning(1)).toBe(true);
    expect(h.tracker.getStocks(0)).toBe(3);
  });

  it('decrement is idempotent across BOTH KO sources on the same KO', () => {
    // The headline determinism property — even if BOTH the collision
    // watcher AND the position watcher fire on the same frame for the
    // same fighter, exactly ONE stock is deducted.
    const h = makeHarness({ stockCount: 3, respawnDelayFrames: 30 });
    h.bodies[0]!.position.y = -200;
    h.fireCollisionKO(0); // collision: 3→2
    h.positionWatcher.update(0); // position: already-respawning → no-op
    expect(h.tracker.getStocks(0)).toBe(2);
  });

  it('crossing each of the 4 blast zone edges decrements stocks once', () => {
    // Sub-AC 4 of AC 6 inherits "blast zone KOs on all 4 sides" from
    // Sub-AC 3 — make sure the decrement contract holds for every edge,
    // not just the top.
    const sides: Array<{ name: string; pos: { x: number; y: number } }> = [
      { name: 'top', pos: { x: 0, y: -200 } },
      { name: 'bottom', pos: { x: 0, y: 200 } },
      { name: 'left', pos: { x: -200, y: 0 } },
      { name: 'right', pos: { x: 200, y: 0 } },
    ];
    let frame = 0;
    for (const side of sides) {
      const h = makeHarness({ stockCount: 3, respawnDelayFrames: 30 });
      h.bodies[0]!.position.x = side.pos.x;
      h.bodies[0]!.position.y = side.pos.y;
      h.step(frame);
      expect(h.tracker.getStocks(0), `edge=${side.name}`).toBe(2);
      expect(h.tracker.isRespawning(0), `edge=${side.name}`).toBe(true);
      frame += 1;
    }
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 4 of AC 6 — contract: respawn OR elimination
// ---------------------------------------------------------------------------

describe('Sub-AC 4 of AC 6 — respawn or elimination', () => {
  it('crossing with stocks remaining respawns at the registered spawn point', () => {
    const h = makeHarness({
      stockCount: 3,
      respawnDelayFrames: 0,
      invincibilityFrames: 90,
    });
    expect(h.tracker.getStocks(0)).toBe(3);

    h.bodies[0]!.position.y = -200;
    h.step(0);

    // Respawned in-place: stocks decremented but NOT eliminated, the
    // RespawnHandler ran the full state-reset (position teleport +
    // invincibility window).
    expect(h.tracker.getStocks(0)).toBe(2);
    expect(h.tracker.isEliminated(0)).toBe(false);
    expect(h.tracker.isRespawning(0)).toBe(false); // drained this same step
    expect(h.states[0]!.position).toEqual(h.spawnPoints[0]);
    expect(h.states[0]!.invincibilityFrames).toBe(90);
    // Position-watcher latch was cleared via the side-effect hook so a
    // subsequent crossing fires fresh.
    expect(h.positionWatcher.isRegistered(0)).toBe(true);
  });

  it('crossing with last stock eliminates instead of respawning', () => {
    const h = makeHarness({
      stockCount: 1,
      respawnDelayFrames: 0,
      invincibilityFrames: 90,
      // Seed the target with a non-default position / invincibility so we
      // can prove "no respawn ran" by their sentinel values.
      initialDamage: 75,
    });

    // Capture the baseline target state — proves the elimination path
    // does NOT mutate the target (no setPosition / setInvincibility /
    // setDamagePercent calls fire when there's no respawn to run).
    const baseline = { ...h.states[0]! };

    h.bodies[0]!.position.y = -200;
    h.step(10);

    expect(h.tracker.getStocks(0)).toBe(0);
    expect(h.tracker.isEliminated(0)).toBe(true);
    expect(h.tracker.isRespawning(0)).toBe(false);
    // Eliminated → no respawn was applied → target was untouched.
    expect(h.states[0]!.position).toEqual(baseline.position);
    expect(h.states[0]!.invincibilityFrames).toBe(baseline.invincibilityFrames);
    expect(h.states[0]!.damagePercent).toBe(baseline.damagePercent);
    // Watchers dropped the corpse so a drift-past doesn't fire phantom KOs.
    expect(h.collisionWatcher.isRegistered(0)).toBe(false);
    expect(h.positionWatcher.isRegistered(0)).toBe(false);
  });

  it('after a respawn, the same fighter can KO again — the latch was cleared', () => {
    const h = makeHarness({ stockCount: 3, respawnDelayFrames: 0 });

    // First KO + respawn.
    h.bodies[0]!.position.y = -200;
    h.step(0);
    expect(h.tracker.getStocks(0)).toBe(2);
    // Side-effect hook teleported the fake body back to its spawn point.
    expect(h.bodies[0]!.position).toEqual(h.spawnPoints[0]);

    // Second KO some frames later — latch was cleared on respawn so the
    // crossing scan re-fires.
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
// Sub-AC 4 of AC 6 — contract: damage % reset
// ---------------------------------------------------------------------------

describe('Sub-AC 4 of AC 6 — damage % reset on respawn', () => {
  it('a respawn after a crossing forces damage% to 0', () => {
    // Seed each fighter with 87% — a typical "kill range" damage value.
    const h = makeHarness({
      stockCount: 3,
      respawnDelayFrames: 0,
      initialDamage: 87,
    });
    expect(h.states[0]!.damagePercent).toBe(87);

    h.bodies[0]!.position.y = -200;
    h.step(0);

    // The respawn pipeline drove setDamagePercent(0) — the meter is
    // fresh, exactly per Sub-AC 4 of AC 6's third contract point.
    expect(h.states[0]!.damagePercent).toBe(0);
  });

  it('damage % reset re-runs on every respawn, not just the first', () => {
    // Three KOs against a 4-stock match — two respawns should both
    // reset damage. Re-seed the target's damage to 50 between KOs so
    // we can prove each reset hit zero.
    const h = makeHarness({
      stockCount: 4,
      respawnDelayFrames: 0,
      initialDamage: 30,
    });

    h.bodies[0]!.position.y = -200;
    h.step(0);
    expect(h.states[0]!.damagePercent).toBe(0);
    expect(h.tracker.getStocks(0)).toBe(3);

    // Simulate damage being dealt between KOs (a real hitbox callback
    // would mutate the live Character; the fake target lets us write
    // the field directly).
    h.states[0]!.damagePercent = 50;
    h.bodies[0]!.position.y = -200;
    h.step(60);
    expect(h.states[0]!.damagePercent).toBe(0);
    expect(h.tracker.getStocks(0)).toBe(2);

    h.states[0]!.damagePercent = 120;
    h.bodies[0]!.position.y = -200;
    h.step(120);
    expect(h.states[0]!.damagePercent).toBe(0);
    expect(h.tracker.getStocks(0)).toBe(1);
  });

  it('elimination does NOT reset damage% (no respawn ever ran)', () => {
    // Sub-AC 4 of AC 6 contract is "damage % reset on respawn" — when
    // a fighter is eliminated instead, no respawn fires, so the damage
    // meter freezes at its last value (it's only a visual artefact at
    // that point — the eliminated fighter no longer participates).
    const h = makeHarness({
      stockCount: 1,
      respawnDelayFrames: 0,
      initialDamage: 200,
    });

    h.bodies[0]!.position.y = -200;
    h.step(0);

    expect(h.tracker.isEliminated(0)).toBe(true);
    // Damage meter untouched — the elimination path is "no respawn".
    expect(h.states[0]!.damagePercent).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 4 of AC 6 — combined contract proof
// ---------------------------------------------------------------------------

describe('Sub-AC 4 of AC 6 — combined contract over a full match', () => {
  it('all three contract points hold over a 4-stock match end-to-end', () => {
    // Single scenario that walks the full Sub-AC 4 of AC 6 contract:
    //   • blast-zone crossings fire life-decrement (4→3→2→1→0)
    //   • respawns fire while stocks remain (with damage% → 0)
    //   • elimination fires on the final crossing (no respawn)
    const h = makeHarness({
      playerCount: 2,
      stockCount: 4,
      respawnDelayFrames: 0,
      invincibilityFrames: 60,
      initialDamage: 99,
    });

    // KO #1: stock 4→3, respawn, damage 99→0.
    h.bodies[0]!.position.y = -200;
    h.step(0);
    expect(h.tracker.getStocks(0)).toBe(3);
    expect(h.states[0]!.damagePercent).toBe(0);
    expect(h.states[0]!.position).toEqual(h.spawnPoints[0]);
    expect(h.states[0]!.invincibilityFrames).toBe(60);

    // KO #2: re-seed damage, stock 3→2, respawn, damage → 0 again.
    h.states[0]!.damagePercent = 70;
    h.bodies[0]!.position.x = -200; // left edge this time
    h.step(60);
    expect(h.tracker.getStocks(0)).toBe(2);
    expect(h.states[0]!.damagePercent).toBe(0);

    // KO #3: stock 2→1, respawn, damage reset.
    h.states[0]!.damagePercent = 110;
    h.bodies[0]!.position.x = 200; // right edge
    h.step(120);
    expect(h.tracker.getStocks(0)).toBe(1);
    expect(h.states[0]!.damagePercent).toBe(0);

    // KO #4: stock 1→0 → ELIMINATION. No respawn fires; damage frozen.
    h.states[0]!.damagePercent = 145;
    h.bodies[0]!.position.y = 200; // bottom edge
    h.step(180);
    expect(h.tracker.getStocks(0)).toBe(0);
    expect(h.tracker.isEliminated(0)).toBe(true);
    expect(h.states[0]!.damagePercent).toBe(145);
    // Watchers dropped the corpse — Sub-AC 4 of AC 6 's "respawn or
    // elimination" branch landed cleanly on elimination.
    expect(h.collisionWatcher.isRegistered(0)).toBe(false);
    expect(h.positionWatcher.isRegistered(0)).toBe(false);

    // The other fighter is untouched — proves the pipeline is per-slot.
    expect(h.tracker.getStocks(1)).toBe(4);
    expect(h.tracker.isEliminated(1)).toBe(false);
  });

  it('contract is deterministic — replaying the same KO log produces identical state', () => {
    // The whole point of the deterministic engine: replaying the same
    // crossing sequence twice must produce byte-identical stock counts,
    // damage values, and respawn positions. This is the gate the M4
    // replay system depends on — if Sub-AC 4 of AC 6 desyncs across
    // replays, the whole replay system is unsound.
    type KoEvent = {
      readonly slot: number;
      readonly edge: 'top' | 'bottom' | 'left' | 'right';
      readonly preDamage: number;
      readonly frame: number;
    };
    const log: ReadonlyArray<KoEvent> = [
      { slot: 0, edge: 'top', preDamage: 60, frame: 0 },
      { slot: 1, edge: 'right', preDamage: 80, frame: 30 },
      { slot: 0, edge: 'left', preDamage: 110, frame: 90 },
      { slot: 0, edge: 'bottom', preDamage: 200, frame: 150 },
    ];

    const replay = (): {
      readonly stocks: ReadonlyArray<number>;
      readonly eliminated: ReadonlyArray<boolean>;
      readonly damages: ReadonlyArray<number>;
    } => {
      const h = makeHarness({
        playerCount: 2,
        stockCount: 3,
        respawnDelayFrames: 0,
        invincibilityFrames: 60,
      });
      const edgePos = (edge: KoEvent['edge']): { x: number; y: number } => {
        switch (edge) {
          case 'top':
            return { x: 0, y: -200 };
          case 'bottom':
            return { x: 0, y: 200 };
          case 'left':
            return { x: -200, y: 0 };
          case 'right':
            return { x: 200, y: 0 };
        }
      };
      for (const ev of log) {
        h.states[ev.slot]!.damagePercent = ev.preDamage;
        const pos = edgePos(ev.edge);
        h.bodies[ev.slot]!.position.x = pos.x;
        h.bodies[ev.slot]!.position.y = pos.y;
        h.step(ev.frame);
      }
      return {
        stocks: [0, 1].map((i) => h.tracker.getStocks(i)),
        eliminated: [0, 1].map((i) => h.tracker.isEliminated(i)),
        damages: [0, 1].map((i) => h.states[i]!.damagePercent),
      };
    };

    const a = replay();
    const b = replay();
    const c = replay();
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    // And spot-check the actual values so a regression that breaks BOTH
    // runs identically still fails this test.
    expect(a.stocks).toEqual([0, 2]);
    expect(a.eliminated).toEqual([true, false]);
    // Slot 0 is eliminated — its damage is frozen at the value it had
    // RIGHT BEFORE the final KO step (which never ran a respawn). Slot 1
    // respawned once with damage → 0 and was never re-seeded after, so
    // it sits at 0%.
    expect(a.damages).toEqual([200, 0]);
  });
});
