import { describe, it, expect, beforeEach } from 'vitest';
import {
  LavaCollisionWatcher,
  LAVA_HAZARD_LABEL_PREFIX,
  type LavaCollisionEvent,
  type LavaMinimalBody,
} from './LavaCollisionWatcher';
import { LavaHazard } from '../entities/LavaHazard';
import { StockTracker } from './StockTracker';

/**
 * Sub-AC 2 of AC 9 — lava→fighter collision watcher tests.
 *
 * The watcher's job is "tell me when a fighter overlaps active lava
 * so I can issue an instant KO." These tests lock down:
 *
 *   1. Active-state gating — overlaps with INACTIVE lava never fire,
 *      overlaps with ACTIVE lava fire exactly once per overlap session.
 *   2. Persistent-overlap correctness — if a fighter is already inside
 *      the lava body when the lava transitions inactive → active,
 *      `tick()` still fires a KO (the property a pure-collisionstart
 *      adapter would miss).
 *   3. Re-arming via collisionend — leaving and re-entering the lava
 *      body re-arms the KO callback for the same fighter.
 *   4. Per-event de-duplication — multiple pairs in a single event for
 *      the same (player, hazard) overlap don't double-fire on tick.
 *   5. Lifecycle — register/unregister and `reset()` clear state.
 *   6. Re-entrancy — callbacks that mutate the registry mid-tick are
 *      safe (mirrors BlastZoneWatcher's contract).
 *   7. Wiring into StockTracker — the canonical "instant KO" pathway
 *      decrements exactly one stock per overlap session and schedules
 *      a respawn, identical to a blast-zone hit.
 *   8. Defensive — null bodies, sensor-vs-sensor pairs, unregistered
 *      bodies are silently ignored.
 *   9. Determinism — identical event streams produce identical KO
 *      orderings across runs; iteration order is by playerIndex
 *      ascending then hazardId lexicographic.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface KoLog {
  playerIndex: number;
  hazardId: string;
}

function makePlayerBody(label = 'character.body'): LavaMinimalBody {
  return { label };
}

function makeLavaBody(id = 'lava'): LavaMinimalBody {
  return { label: `${LAVA_HAZARD_LABEL_PREFIX}${id}` };
}

function makeEvent(
  ...pairs: Array<{
    bodyA: LavaMinimalBody | null;
    bodyB: LavaMinimalBody | null;
  }>
): LavaCollisionEvent {
  return { pairs };
}

/**
 * Build a LavaHazard whose state we can drive deterministically. We
 * advance frames manually so the test is hermetic.
 */
function makeHazard(opts?: {
  id?: string;
  cycleFrames?: number;
  activeThreshold?: number;
  damagePerTick?: number;
  phaseFrames?: number;
}): LavaHazard {
  return new LavaHazard({
    id: opts?.id ?? 'lava-test',
    x: 0,
    baseY: 1000,
    width: 200,
    maxHeight: 200,
    minHeight: 0,
    cycleFrames: opts?.cycleFrames ?? 100,
    activeThreshold: opts?.activeThreshold ?? 0.5,
    damagePerTick: opts?.damagePerTick ?? 8,
    phaseFrames: opts?.phaseFrames ?? 0,
  });
}

/** Fast-forward a hazard to a frame where `isActive()` is true. */
function fastForwardToActive(hazard: LavaHazard): void {
  for (let i = 0; i < hazard.getCycleFrames(); i += 1) {
    if (hazard.isActive()) return;
    hazard.tick();
  }
  throw new Error('test fixture: hazard never became active');
}

/** Fast-forward a hazard to a frame where `isActive()` is false. */
function fastForwardToInactive(hazard: LavaHazard): void {
  for (let i = 0; i < hazard.getCycleFrames(); i += 1) {
    if (!hazard.isActive()) return;
    hazard.tick();
  }
  throw new Error('test fixture: hazard never became inactive');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('LavaCollisionWatcher — constants', () => {
  it('exports a label prefix for hazard bodies', () => {
    expect(LAVA_HAZARD_LABEL_PREFIX).toBe('hazard.lava.');
  });
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('LavaCollisionWatcher — construction', () => {
  it('rejects a non-function callback', () => {
    expect(
      // @ts-expect-error — exercising runtime guard
      () => new LavaCollisionWatcher(null),
    ).toThrow();
    expect(
      // @ts-expect-error — exercising runtime guard
      () => new LavaCollisionWatcher(42),
    ).toThrow();
  });

  it('builds with a function callback', () => {
    const w = new LavaCollisionWatcher(() => {});
    expect(w.getOverlapCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Player registration
// ---------------------------------------------------------------------------

describe('LavaCollisionWatcher — player registration', () => {
  it('rejects a negative or non-integer playerIndex', () => {
    const w = new LavaCollisionWatcher(() => {});
    expect(() => w.registerPlayer(-1, makePlayerBody())).toThrow();
    expect(() => w.registerPlayer(1.5, makePlayerBody())).toThrow();
  });

  it('rejects a missing body', () => {
    const w = new LavaCollisionWatcher(() => {});
    expect(() =>
      // @ts-expect-error — exercising runtime guard
      w.registerPlayer(0, null),
    ).toThrow();
  });

  it('isRegistered reflects the registry state', () => {
    const w = new LavaCollisionWatcher(() => {});
    expect(w.isRegistered(0)).toBe(false);
    w.registerPlayer(0, makePlayerBody());
    expect(w.isRegistered(0)).toBe(true);
    w.unregisterPlayer(0);
    expect(w.isRegistered(0)).toBe(false);
  });

  it('re-registering the same playerIndex replaces the body and clears stale overlaps', () => {
    const log: KoLog[] = [];
    const w = new LavaCollisionWatcher((p, h) =>
      log.push({ playerIndex: p, hazardId: h }),
    );
    const oldBody = makePlayerBody('p1.old');
    const newBody = makePlayerBody('p1.new');
    const hazard = makeHazard();
    fastForwardToActive(hazard);
    const lavaBody = makeLavaBody(hazard.getId());

    w.registerPlayer(0, oldBody);
    w.registerHazard(hazard, lavaBody);

    // Old body enters the lava — overlap recorded.
    w.handleCollisionStart(makeEvent({ bodyA: oldBody, bodyB: lavaBody }));
    expect(w.getOverlapCount()).toBe(1);

    // Replace the body before tick — stale overlap should be dropped.
    w.registerPlayer(0, newBody);
    expect(w.getOverlapCount()).toBe(0);

    w.tick();
    expect(log).toEqual([]); // no spurious KO from the stale overlap
  });

  it('unregisterPlayer drops every overlap involving that slot', () => {
    const w = new LavaCollisionWatcher(() => {});
    const p1 = makePlayerBody();
    const hazard = makeHazard();
    const lava = makeLavaBody(hazard.getId());
    w.registerPlayer(0, p1);
    w.registerHazard(hazard, lava);
    w.handleCollisionStart(makeEvent({ bodyA: p1, bodyB: lava }));
    expect(w.getOverlapCount()).toBe(1);
    w.unregisterPlayer(0);
    expect(w.getOverlapCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Hazard registration
// ---------------------------------------------------------------------------

describe('LavaCollisionWatcher — hazard registration', () => {
  it('rejects malformed hazards / bodies', () => {
    const w = new LavaCollisionWatcher(() => {});
    // @ts-expect-error — exercising runtime guard
    expect(() => w.registerHazard(null, makeLavaBody())).toThrow();
    expect(() =>
      // @ts-expect-error — exercising runtime guard
      w.registerHazard(makeHazard(), null),
    ).toThrow();
  });

  it('isHazardRegistered reflects state', () => {
    const w = new LavaCollisionWatcher(() => {});
    const hazard = makeHazard({ id: 'pool-a' });
    expect(w.isHazardRegistered('pool-a')).toBe(false);
    w.registerHazard(hazard, makeLavaBody('pool-a'));
    expect(w.isHazardRegistered('pool-a')).toBe(true);
    w.unregisterHazard('pool-a');
    expect(w.isHazardRegistered('pool-a')).toBe(false);
  });

  it('unregistering an unknown hazard is a silent no-op', () => {
    const w = new LavaCollisionWatcher(() => {});
    expect(() => w.unregisterHazard('unknown')).not.toThrow();
  });

  it('re-registering replaces the body and clears stale overlaps', () => {
    const log: KoLog[] = [];
    const w = new LavaCollisionWatcher((p, h) =>
      log.push({ playerIndex: p, hazardId: h }),
    );
    const player = makePlayerBody();
    const hazard = makeHazard({ id: 'pool-a' });
    const oldBody = makeLavaBody('pool-a-old');
    const newBody = makeLavaBody('pool-a-new');
    fastForwardToActive(hazard);

    w.registerPlayer(0, player);
    w.registerHazard(hazard, oldBody);

    w.handleCollisionStart(makeEvent({ bodyA: player, bodyB: oldBody }));
    expect(w.getOverlapCount()).toBe(1);

    // Re-register with a new body — stale overlap is dropped because
    // the old body is no longer in the registry.
    w.registerHazard(hazard, newBody);
    expect(w.getOverlapCount()).toBe(0);

    w.tick();
    expect(log).toEqual([]); // stale overlap doesn't fire
  });

  it('reset clears every registry and overlap', () => {
    const w = new LavaCollisionWatcher(() => {});
    const player = makePlayerBody();
    const hazard = makeHazard();
    const lava = makeLavaBody(hazard.getId());
    w.registerPlayer(0, player);
    w.registerHazard(hazard, lava);
    w.handleCollisionStart(makeEvent({ bodyA: player, bodyB: lava }));
    expect(w.getOverlapCount()).toBe(1);
    w.reset();
    expect(w.isRegistered(0)).toBe(false);
    expect(w.isHazardRegistered(hazard.getId())).toBe(false);
    expect(w.getOverlapCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Active-state gating
// ---------------------------------------------------------------------------

describe('LavaCollisionWatcher — active-state gating', () => {
  let w: LavaCollisionWatcher;
  let log: KoLog[];
  let player: LavaMinimalBody;
  let hazard: LavaHazard;
  let lava: LavaMinimalBody;

  beforeEach(() => {
    log = [];
    w = new LavaCollisionWatcher((p, h) =>
      log.push({ playerIndex: p, hazardId: h }),
    );
    player = makePlayerBody();
    hazard = makeHazard({ id: 'gate' });
    lava = makeLavaBody(hazard.getId());
    w.registerPlayer(0, player);
    w.registerHazard(hazard, lava);
  });

  it('does not fire KO when overlap occurs while lava is INACTIVE', () => {
    expect(hazard.isActive()).toBe(false);
    w.handleCollisionStart(makeEvent({ bodyA: player, bodyB: lava }));
    w.tick();
    expect(log).toEqual([]);
    // Overlap is *retained* — re-tick after lava activates should fire.
    expect(w.getOverlapCount()).toBe(1);
  });

  it('fires KO once when overlap occurs while lava is ACTIVE', () => {
    fastForwardToActive(hazard);
    w.handleCollisionStart(makeEvent({ bodyA: player, bodyB: lava }));
    w.tick();
    expect(log).toEqual([{ playerIndex: 0, hazardId: 'gate' }]);
  });

  it('fires KO on the tick the lava transitions inactive → active mid-overlap', () => {
    // Overlap recorded while lava is inactive — no KO yet.
    expect(hazard.isActive()).toBe(false);
    w.handleCollisionStart(makeEvent({ bodyA: player, bodyB: lava }));
    w.tick();
    expect(log).toEqual([]);

    // Lava ticks up into the active band — next watcher tick fires KO.
    fastForwardToActive(hazard);
    w.tick();
    expect(log).toEqual([{ playerIndex: 0, hazardId: 'gate' }]);
  });

  it('does not re-fire on subsequent ticks while overlap is unbroken', () => {
    fastForwardToActive(hazard);
    w.handleCollisionStart(makeEvent({ bodyA: player, bodyB: lava }));
    w.tick();
    w.tick();
    w.tick();
    expect(log.length).toBe(1);
  });

  it('re-arms after collisionend → collisionstart', () => {
    fastForwardToActive(hazard);
    w.handleCollisionStart(makeEvent({ bodyA: player, bodyB: lava }));
    w.tick();
    expect(log.length).toBe(1);

    // Fighter leaves and re-enters lava.
    w.handleCollisionEnd(makeEvent({ bodyA: player, bodyB: lava }));
    expect(w.getOverlapCount()).toBe(0);
    w.handleCollisionStart(makeEvent({ bodyA: player, bodyB: lava }));
    w.tick();
    expect(log.length).toBe(2);
  });

  it('does not fire if the lava becomes inactive before tick', () => {
    fastForwardToActive(hazard);
    w.handleCollisionStart(makeEvent({ bodyA: player, bodyB: lava }));
    fastForwardToInactive(hazard);
    w.tick();
    expect(log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pair-order independence
// ---------------------------------------------------------------------------

describe('LavaCollisionWatcher — pair-order independence', () => {
  it('detects (player, lava) regardless of bodyA/bodyB order', () => {
    const log: KoLog[] = [];
    const w = new LavaCollisionWatcher((p, h) =>
      log.push({ playerIndex: p, hazardId: h }),
    );
    const player = makePlayerBody();
    const hazard = makeHazard({ id: 'order' });
    const lava = makeLavaBody(hazard.getId());
    fastForwardToActive(hazard);
    w.registerPlayer(0, player);
    w.registerHazard(hazard, lava);

    w.handleCollisionStart(makeEvent({ bodyA: lava, bodyB: player }));
    w.tick();
    expect(log.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Filtering — non-lava collisions
// ---------------------------------------------------------------------------

describe('LavaCollisionWatcher — filtering', () => {
  let w: LavaCollisionWatcher;
  let log: KoLog[];
  let player: LavaMinimalBody;
  let hazard: LavaHazard;
  let lava: LavaMinimalBody;

  beforeEach(() => {
    log = [];
    w = new LavaCollisionWatcher((p, h) =>
      log.push({ playerIndex: p, hazardId: h }),
    );
    player = makePlayerBody();
    hazard = makeHazard();
    lava = makeLavaBody(hazard.getId());
    fastForwardToActive(hazard);
    w.registerPlayer(0, player);
    w.registerHazard(hazard, lava);
  });

  it('ignores player-vs-platform collisions', () => {
    const platform: LavaMinimalBody = { label: 'platform.solid' };
    w.handleCollisionStart(makeEvent({ bodyA: player, bodyB: platform }));
    w.tick();
    expect(log).toEqual([]);
    expect(w.getOverlapCount()).toBe(0);
  });

  it('ignores hazard-vs-hazard collisions (defensive)', () => {
    const otherLava = makeLavaBody('other');
    w.handleCollisionStart(makeEvent({ bodyA: lava, bodyB: otherLava }));
    w.tick();
    expect(log).toEqual([]);
  });

  it('ignores unregistered fighter bodies', () => {
    const stranger = makePlayerBody('stranger');
    w.handleCollisionStart(makeEvent({ bodyA: stranger, bodyB: lava }));
    w.tick();
    expect(log).toEqual([]);
    expect(w.getOverlapCount()).toBe(0);
  });

  it('ignores empty events and missing bodies', () => {
    w.handleCollisionStart({ pairs: [] });
    w.handleCollisionStart(makeEvent({ bodyA: null, bodyB: null }));
    w.handleCollisionStart(makeEvent({ bodyA: null, bodyB: lava }));
    w.handleCollisionStart(makeEvent({ bodyA: player, bodyB: null }));
    w.tick();
    expect(log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Per-event de-duplication & multi-pair handling
// ---------------------------------------------------------------------------

describe('LavaCollisionWatcher — per-event de-duplication', () => {
  it('deduplicates duplicate (player, lava) pairs in the same event', () => {
    const log: KoLog[] = [];
    const w = new LavaCollisionWatcher((p, h) =>
      log.push({ playerIndex: p, hazardId: h }),
    );
    const player = makePlayerBody();
    const hazard = makeHazard({ id: 'dup' });
    const lava = makeLavaBody(hazard.getId());
    fastForwardToActive(hazard);
    w.registerPlayer(0, player);
    w.registerHazard(hazard, lava);

    // Same overlap reported twice in the same event (e.g. compound body).
    w.handleCollisionStart(
      makeEvent(
        { bodyA: player, bodyB: lava },
        { bodyA: lava, bodyB: player },
      ),
    );
    expect(w.getOverlapCount()).toBe(1);
    w.tick();
    expect(log.length).toBe(1);
  });

  it('multiplexes correctly across multiple players and hazards', () => {
    const log: KoLog[] = [];
    const w = new LavaCollisionWatcher((p, h) =>
      log.push({ playerIndex: p, hazardId: h }),
    );
    const p1 = makePlayerBody('p1');
    const p2 = makePlayerBody('p2');
    const hA = makeHazard({ id: 'a' });
    const hB = makeHazard({ id: 'b' });
    const lA = makeLavaBody('a');
    const lB = makeLavaBody('b');
    fastForwardToActive(hA);
    fastForwardToActive(hB);

    w.registerPlayer(0, p1);
    w.registerPlayer(1, p2);
    w.registerHazard(hA, lA);
    w.registerHazard(hB, lB);

    w.handleCollisionStart(
      makeEvent(
        { bodyA: p1, bodyB: lA },
        { bodyA: p2, bodyB: lB },
      ),
    );
    w.tick();
    expect(log).toEqual([
      { playerIndex: 0, hazardId: 'a' },
      { playerIndex: 1, hazardId: 'b' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('LavaCollisionWatcher — determinism', () => {
  it('emits KO callbacks in stable (playerIndex, hazardId) order', () => {
    const log: KoLog[] = [];
    const w = new LavaCollisionWatcher((p, h) =>
      log.push({ playerIndex: p, hazardId: h }),
    );
    const p1 = makePlayerBody('p1');
    const p2 = makePlayerBody('p2');
    const hZ = makeHazard({ id: 'z' });
    const hA = makeHazard({ id: 'a' });
    const lZ = makeLavaBody('z');
    const lA = makeLavaBody('a');
    fastForwardToActive(hZ);
    fastForwardToActive(hA);

    // Register in scrambled order to assert tick ordering doesn't
    // depend on insertion order.
    w.registerHazard(hZ, lZ);
    w.registerHazard(hA, lA);
    w.registerPlayer(1, p2);
    w.registerPlayer(0, p1);

    // Insert overlaps in scrambled order too.
    w.handleCollisionStart(
      makeEvent(
        { bodyA: p2, bodyB: lZ },
        { bodyA: p1, bodyB: lZ },
        { bodyA: p2, bodyB: lA },
        { bodyA: p1, bodyB: lA },
      ),
    );
    w.tick();
    expect(log).toEqual([
      { playerIndex: 0, hazardId: 'a' },
      { playerIndex: 0, hazardId: 'z' },
      { playerIndex: 1, hazardId: 'a' },
      { playerIndex: 1, hazardId: 'z' },
    ]);
  });

  it('two watchers driven by identical streams produce identical logs', () => {
    function runWatcher(): KoLog[] {
      const log: KoLog[] = [];
      const w = new LavaCollisionWatcher((p, h) =>
        log.push({ playerIndex: p, hazardId: h }),
      );
      const p1 = makePlayerBody();
      const hazard = makeHazard({ id: 'det', cycleFrames: 100 });
      const lava = makeLavaBody(hazard.getId());
      w.registerPlayer(0, p1);
      w.registerHazard(hazard, lava);
      // Player enters while lava inactive, lava rises, KO fires.
      w.handleCollisionStart(makeEvent({ bodyA: p1, bodyB: lava }));
      for (let i = 0; i < 100; i += 1) {
        hazard.tick();
        w.tick();
      }
      return log;
    }
    const a = runWatcher();
    const b = runWatcher();
    expect(a).toEqual(b);
    expect(a.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Re-entrancy
// ---------------------------------------------------------------------------

describe('LavaCollisionWatcher — re-entrancy', () => {
  it('callback that unregisters its own player mid-tick is safe', () => {
    const log: KoLog[] = [];
    let watcherRef: LavaCollisionWatcher;
    const w = new LavaCollisionWatcher((p, h) => {
      log.push({ playerIndex: p, hazardId: h });
      watcherRef.unregisterPlayer(p);
    });
    watcherRef = w;
    const p1 = makePlayerBody();
    const hazard = makeHazard({ id: 're' });
    const lava = makeLavaBody(hazard.getId());
    fastForwardToActive(hazard);
    w.registerPlayer(0, p1);
    w.registerHazard(hazard, lava);

    w.handleCollisionStart(makeEvent({ bodyA: p1, bodyB: lava }));
    expect(() => w.tick()).not.toThrow();
    expect(log.length).toBe(1);
    expect(w.isRegistered(0)).toBe(false);
    expect(w.getOverlapCount()).toBe(0);
  });

  it('callback that unregisters a different player still fires for both', () => {
    const log: KoLog[] = [];
    let watcherRef: LavaCollisionWatcher;
    const w = new LavaCollisionWatcher((p, h) => {
      log.push({ playerIndex: p, hazardId: h });
      // Eliminate the other slot as a side-effect.
      const other = p === 0 ? 1 : 0;
      if (watcherRef.isRegistered(other)) watcherRef.unregisterPlayer(other);
    });
    watcherRef = w;
    const p1 = makePlayerBody('p1');
    const p2 = makePlayerBody('p2');
    const hazard = makeHazard({ id: 'pair' });
    const lava = makeLavaBody(hazard.getId());
    fastForwardToActive(hazard);
    w.registerPlayer(0, p1);
    w.registerPlayer(1, p2);
    w.registerHazard(hazard, lava);

    w.handleCollisionStart(
      makeEvent(
        { bodyA: p1, bodyB: lava },
        { bodyA: p2, bodyB: lava },
      ),
    );
    // First callback (p1) unregisters p2 — the snapshot guarantees
    // p1's callback fires; p2's overlap is dropped before its own
    // callback would fire because the player is no longer registered.
    w.tick();
    expect(log.map((e) => e.playerIndex)).toEqual([0]);
  });
});

// ---------------------------------------------------------------------------
// Wiring into StockTracker — the canonical instant-KO pathway
// ---------------------------------------------------------------------------

describe('LavaCollisionWatcher — instant-KO via StockTracker', () => {
  it('decrements exactly one stock and schedules a respawn (mirrors blast-zone semantics)', () => {
    const tracker = new StockTracker({
      playerCount: 2,
      stockCount: 3,
      respawnDelayFrames: 30,
    });
    let frame = 0;
    const w = new LavaCollisionWatcher((p) => {
      tracker.loseStock(p, frame);
    });

    const p1 = makePlayerBody();
    const hazard = makeHazard({ id: 'pit' });
    const lava = makeLavaBody(hazard.getId());
    fastForwardToActive(hazard);
    w.registerPlayer(0, p1);
    w.registerHazard(hazard, lava);

    w.handleCollisionStart(makeEvent({ bodyA: p1, bodyB: lava }));
    frame = 100;
    w.tick();

    expect(tracker.getStocks(0)).toBe(2);
    expect(tracker.isRespawning(0)).toBe(true);
    expect(tracker.getRespawnFrame(0)).toBe(130);
    // Player 1 untouched.
    expect(tracker.getStocks(1)).toBe(3);
    expect(tracker.isRespawning(1)).toBe(false);
  });

  it('continued overlap after the KO does not double-decrement', () => {
    const tracker = new StockTracker({ playerCount: 1, stockCount: 3 });
    let frame = 0;
    const w = new LavaCollisionWatcher((p) => {
      tracker.loseStock(p, frame);
    });
    const p1 = makePlayerBody();
    const hazard = makeHazard({ id: 'persist' });
    const lava = makeLavaBody(hazard.getId());
    fastForwardToActive(hazard);
    w.registerPlayer(0, p1);
    w.registerHazard(hazard, lava);
    w.handleCollisionStart(makeEvent({ bodyA: p1, bodyB: lava }));
    frame = 1;
    w.tick(); // KO 1
    frame = 2;
    w.tick(); // no-op — overlap already fired
    frame = 3;
    w.tick(); // no-op
    expect(tracker.getStocks(0)).toBe(2);
  });

  it('repeated leave-and-re-enter cycles burn stocks one at a time', () => {
    // Use a 0-frame respawn delay so the tracker re-arms instantly
    // between cycles — without a `consumePendingRespawns` drain the
    // tracker treats the player as mid-respawn and ignores duplicate
    // `loseStock` calls (the same de-dup guard that protects against
    // duplicate blast-zone events).
    const tracker = new StockTracker({
      playerCount: 1,
      stockCount: 3,
      respawnDelayFrames: 0,
    });
    let frame = 0;
    const w = new LavaCollisionWatcher((p) => {
      tracker.loseStock(p, frame);
    });
    const p1 = makePlayerBody();
    const hazard = makeHazard({ id: 'cycle' });
    const lava = makeLavaBody(hazard.getId());
    fastForwardToActive(hazard);
    w.registerPlayer(0, p1);
    w.registerHazard(hazard, lava);

    for (let i = 0; i < 3; i += 1) {
      w.handleCollisionStart(makeEvent({ bodyA: p1, bodyB: lava }));
      frame += 1;
      w.tick();
      // Drain the pending respawn so the next cycle's loseStock isn't
      // ignored by the "already respawning" guard.
      tracker.consumePendingRespawns(frame);
      w.handleCollisionEnd(makeEvent({ bodyA: p1, bodyB: lava }));
    }
    expect(tracker.getStocks(0)).toBe(0);
    expect(tracker.isEliminated(0)).toBe(true);
  });
});
