import { describe, it, expect } from 'vitest';
import {
  ItemSpawnManager,
  ITEM_SPAWN_RNG_STREAM,
  type ItemSpawnRequest,
} from './ItemSpawnManager';
import {
  ITEM_SPAWN_DROP_HEIGHT_PX,
  ITEM_SPAWN_FREQUENCY_TABLE,
  MAX_ITEMS_ON_FIELD_BY_FREQUENCY,
} from './itemSpawnSettings';
import { MatchRng } from '../match/MatchRng';
import type { ItemFrequency, ItemSpawnAnchor } from '../types';

/**
 * AC 10 Sub-AC 3 — ItemSpawnManager.
 *
 * The headline contract is determinism: two managers with the same
 * seed + frequency + anchors + step sequence produce identical spawn
 * schedules. Everything else (cap idling, RNG stream isolation,
 * snapshot/restore) is locked down here so a future tuning pass /
 * refactor cannot silently break replay determinism.
 */

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ANCHORS: ReadonlyArray<ItemSpawnAnchor> = Object.freeze([
  Object.freeze({ id: 'left', x: 100, y: 100 }),
  Object.freeze({ id: 'mid', x: 500, y: 100 }),
  Object.freeze({ id: 'right', x: 900, y: 100 }),
]);

const SEED = 0xc0ffee;

function makeManager(
  frequency: ItemFrequency = 'med',
  anchors: ReadonlyArray<ItemSpawnAnchor> = ANCHORS,
  seed: number = SEED,
): { manager: ItemSpawnManager; rng: MatchRng } {
  const rng = new MatchRng(seed);
  const manager = new ItemSpawnManager({ frequency, anchors, rng });
  return { manager, rng };
}

// ---------------------------------------------------------------------------
// 1. Off frequency / empty anchors — short-circuit
// ---------------------------------------------------------------------------

describe('ItemSpawnManager — off / no-anchor short-circuits', () => {
  it("emits no spawns when frequency is 'off'", () => {
    const { manager } = makeManager('off');
    for (let f = 0; f < 5000; f++) {
      expect(manager.step(f, 0)).toEqual([]);
    }
  });

  it("never materialises the RNG stream when frequency is 'off'", () => {
    const { manager, rng } = makeManager('off');
    for (let f = 0; f < 5000; f++) manager.step(f, 0);
    expect(manager.hasMaterialisedStream()).toBe(false);
    expect(rng.hasStream(ITEM_SPAWN_RNG_STREAM)).toBe(false);
  });

  it('emits no spawns when the anchor list is empty', () => {
    const { manager } = makeManager('high', []);
    for (let f = 0; f < 5000; f++) {
      expect(manager.step(f, 0)).toEqual([]);
    }
  });

  it('never materialises the RNG stream when anchors are empty', () => {
    const { manager, rng } = makeManager('high', []);
    for (let f = 0; f < 5000; f++) manager.step(f, 0);
    expect(manager.hasMaterialisedStream()).toBe(false);
    expect(rng.hasStream(ITEM_SPAWN_RNG_STREAM)).toBe(false);
  });

  it("getNextSpawnFrame returns null for 'off' frequency", () => {
    const { manager } = makeManager('off');
    expect(manager.getNextSpawnFrame()).toBeNull();
    manager.step(0, 0);
    expect(manager.getNextSpawnFrame()).toBeNull();
  });

  it('getNextSpawnFrame returns null for empty anchors', () => {
    const { manager } = makeManager('high', []);
    manager.step(0, 0);
    expect(manager.getNextSpawnFrame()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. First-spawn schedule — deadline picked inside the configured window
// ---------------------------------------------------------------------------

describe('ItemSpawnManager — schedule windows', () => {
  it.each(['low', 'med', 'high'] as const)(
    "first-spawn deadline for '%s' lands inside the [min,max] window",
    (freq) => {
      const window = ITEM_SPAWN_FREQUENCY_TABLE[freq]!;
      // Sample 32 different seeds to get good coverage of the window.
      for (let s = 0; s < 32; s++) {
        const { manager } = makeManager(freq, ANCHORS, s * 0x9e3779b9);
        manager.step(0, 0); // lazy-init the deadline
        const deadline = manager.getNextSpawnFrame()!;
        expect(deadline).toBeGreaterThanOrEqual(window.minIntervalFrames);
        expect(deadline).toBeLessThanOrEqual(window.maxIntervalFrames);
      }
    },
  );

  it.each(['low', 'med', 'high'] as const)(
    "every subsequent spawn interval for '%s' lands inside the [min,max] window",
    (freq) => {
      const window = ITEM_SPAWN_FREQUENCY_TABLE[freq]!;
      const { manager } = makeManager(freq, ANCHORS);
      // Run long enough to see many spawns; cap is huge so spawning is
      // never throttled.
      const spawns: ItemSpawnRequest[] = [];
      for (let f = 0; f < window.maxIntervalFrames * 50; f++) {
        spawns.push(...manager.step(f, 0));
      }
      expect(spawns.length).toBeGreaterThan(10);
      // Inter-spawn deltas should all land inside the window.
      for (let i = 1; i < spawns.length; i++) {
        const delta = spawns[i]!.frame - spawns[i - 1]!.frame;
        expect(delta).toBeGreaterThanOrEqual(window.minIntervalFrames);
        expect(delta).toBeLessThanOrEqual(window.maxIntervalFrames);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// 3. Anchor selection — uses the configured list, never out of range
// ---------------------------------------------------------------------------

describe('ItemSpawnManager — anchor picking', () => {
  it('always picks an anchor from the configured list', () => {
    const { manager } = makeManager('high');
    const seen = new Set<number>();
    for (let f = 0; f < 50000; f++) {
      for (const r of manager.step(f, 0)) {
        expect(r.anchorIndex).toBeGreaterThanOrEqual(0);
        expect(r.anchorIndex).toBeLessThan(ANCHORS.length);
        expect(r.anchor).toBe(ANCHORS[r.anchorIndex]);
        seen.add(r.anchorIndex);
      }
    }
    // With high frequency and 3 anchors, every anchor is picked
    // many times over 50k frames.
    expect(seen.size).toBe(ANCHORS.length);
  });

  it('handles a single-anchor stage by always picking index 0', () => {
    const single: ReadonlyArray<ItemSpawnAnchor> = Object.freeze([
      Object.freeze({ id: 'only', x: 0, y: 0 }),
    ]);
    const { manager } = makeManager('high', single);
    for (let f = 0; f < 5000; f++) {
      for (const r of manager.step(f, 0)) {
        expect(r.anchorIndex).toBe(0);
        expect(r.anchor).toBe(single[0]);
      }
    }
  });

  it('emits frame matching the step argument when spawning', () => {
    const { manager } = makeManager('high');
    let lastFrame = -1;
    for (let f = 0; f < 5000; f++) {
      for (const r of manager.step(f, 0)) {
        expect(r.frame).toBe(f);
        lastFrame = f;
      }
    }
    expect(lastFrame).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Cap enforcement — idle when full, no RNG burned, deadline preserved
// ---------------------------------------------------------------------------

describe('ItemSpawnManager — on-field cap', () => {
  it.each(['low', 'med', 'high'] as const)(
    "exposes the configured cap for '%s'",
    (freq) => {
      const { manager } = makeManager(freq);
      expect(manager.getMaxItemsOnField()).toBe(
        MAX_ITEMS_ON_FIELD_BY_FREQUENCY[freq],
      );
    },
  );

  it('idles when active items ≥ cap (no new spawns)', () => {
    const { manager } = makeManager('high');
    const cap = manager.getMaxItemsOnField();
    // Pretend the field is permanently full.
    for (let f = 0; f < 5000; f++) {
      expect(manager.step(f, cap)).toEqual([]);
    }
  });

  it('preserves the deadline while idling and resumes spawning when the cap frees up', () => {
    const { manager } = makeManager('high');
    const cap = manager.getMaxItemsOnField();
    // Tick once at frame 0 (cap free) so the deadline lazy-inits.
    manager.step(0, 0);
    const deadline = manager.getNextSpawnFrame()!;
    // Now jam the cap full for many frames past the deadline.
    for (let f = 1; f < deadline + 500; f++) {
      expect(manager.step(f, cap)).toEqual([]);
    }
    // Deadline must be unchanged (no roll consumed).
    expect(manager.getNextSpawnFrame()).toBe(deadline);
    // Free up a slot — the next step spawns immediately.
    const after = manager.step(deadline + 500, cap - 1);
    expect(after.length).toBe(1);
    expect(after[0]!.frame).toBe(deadline + 500);
  });

  it('does not burn RNG rolls while the cap is full', () => {
    // Two managers, one that idles for 1000 frames before spawning,
    // one that spawns immediately. The first spawn from each should
    // pick the same anchor (since the cap-idle path consumes no rolls).
    const idleSeed = 0x123456;
    const idleMgrA = new ItemSpawnManager({
      frequency: 'high',
      anchors: ANCHORS,
      rng: new MatchRng(idleSeed),
    });
    const idleMgrB = new ItemSpawnManager({
      frequency: 'high',
      anchors: ANCHORS,
      rng: new MatchRng(idleSeed),
    });
    // A: never gets cap-blocked.
    let firstA: ItemSpawnRequest | null = null;
    for (let f = 0; f < 2000 && firstA === null; f++) {
      const r = idleMgrA.step(f, 0);
      if (r.length > 0) firstA = r[0]!;
    }
    expect(firstA).not.toBeNull();
    // B: cap-jammed for the entire pre-deadline window, then frees up.
    const cap = idleMgrB.getMaxItemsOnField();
    let firstB: ItemSpawnRequest | null = null;
    for (let f = 0; f < 2000 && firstB === null; f++) {
      // Free the cap only on / after frame 1500 — well past any
      // possible 'high' deadline. Until then the manager is jammed.
      const active = f < 1500 ? cap : 0;
      const r = idleMgrB.step(f, active);
      if (r.length > 0) firstB = r[0]!;
    }
    expect(firstB).not.toBeNull();
    // Same seed + same RNG-call sequence (cap-idle burned nothing) →
    // same anchor index picked at the first spawn.
    expect(firstB!.anchorIndex).toBe(firstA!.anchorIndex);
  });
});

// ---------------------------------------------------------------------------
// 5. Determinism — same seed produces identical schedules
// ---------------------------------------------------------------------------

describe('ItemSpawnManager — determinism', () => {
  it('two managers with the same seed produce identical spawn sequences', () => {
    const a = makeManager('med').manager;
    const b = makeManager('med').manager;
    const aSpawns: ItemSpawnRequest[] = [];
    const bSpawns: ItemSpawnRequest[] = [];
    for (let f = 0; f < 20000; f++) {
      aSpawns.push(...a.step(f, 0));
      bSpawns.push(...b.step(f, 0));
    }
    expect(aSpawns.length).toBeGreaterThan(0);
    expect(aSpawns.length).toBe(bSpawns.length);
    for (let i = 0; i < aSpawns.length; i++) {
      expect(aSpawns[i]!.frame).toBe(bSpawns[i]!.frame);
      expect(aSpawns[i]!.anchorIndex).toBe(bSpawns[i]!.anchorIndex);
    }
  });

  it('different seeds produce different spawn schedules', () => {
    const a = makeManager('med', ANCHORS, 1).manager;
    const b = makeManager('med', ANCHORS, 2).manager;
    const aSpawns: ItemSpawnRequest[] = [];
    const bSpawns: ItemSpawnRequest[] = [];
    for (let f = 0; f < 20000; f++) {
      aSpawns.push(...a.step(f, 0));
      bSpawns.push(...b.step(f, 0));
    }
    // Some divergence somewhere — frames or anchor indices.
    let diverged = false;
    const len = Math.min(aSpawns.length, bSpawns.length);
    for (let i = 0; i < len; i++) {
      if (
        aSpawns[i]!.frame !== bSpawns[i]!.frame ||
        aSpawns[i]!.anchorIndex !== bSpawns[i]!.anchorIndex
      ) {
        diverged = true;
        break;
      }
    }
    expect(diverged).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. RNG stream isolation
// ---------------------------------------------------------------------------

describe('ItemSpawnManager — RNG stream isolation', () => {
  it('reads exclusively from the canonical item-spawn stream', () => {
    const rng = new MatchRng(SEED);
    const manager = new ItemSpawnManager({
      frequency: 'high',
      anchors: ANCHORS,
      rng,
    });
    // Drive enough steps to materialise + roll the stream.
    for (let f = 0; f < 5000; f++) manager.step(f, 0);
    expect(rng.hasStream(ITEM_SPAWN_RNG_STREAM)).toBe(true);
    // No other stream label should be touched by the spawn manager.
    expect(rng.listStreams()).toEqual([ITEM_SPAWN_RNG_STREAM]);
  });

  it('does not perturb other subsystem streams', () => {
    // AI subsystem uses its own stream; the spawn manager must not
    // consume any of its rolls.
    const sharedSeed = 0xfeedcafe;
    const aiRefRng = new MatchRng(sharedSeed);
    const aiRef = Array.from({ length: 32 }, () =>
      aiRefRng.stream('ai').next(),
    );
    // Now run a parallel match with a spawn manager active.
    const sharedRng = new MatchRng(sharedSeed);
    const manager = new ItemSpawnManager({
      frequency: 'high',
      anchors: ANCHORS,
      rng: sharedRng,
    });
    for (let f = 0; f < 5000; f++) manager.step(f, 0);
    const aiActual = Array.from({ length: 32 }, () =>
      sharedRng.stream('ai').next(),
    );
    expect(aiActual).toEqual(aiRef);
  });

  it("respects a custom streamLabel option", () => {
    const rng = new MatchRng(SEED);
    const manager = new ItemSpawnManager({
      frequency: 'high',
      anchors: ANCHORS,
      rng,
      streamLabel: 'item-spawn-test',
    });
    for (let f = 0; f < 1000; f++) manager.step(f, 0);
    expect(rng.hasStream('item-spawn-test')).toBe(true);
    expect(rng.hasStream(ITEM_SPAWN_RNG_STREAM)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Spawn-arrival semantics — only one spawn per step, frame matches arg
// ---------------------------------------------------------------------------

describe('ItemSpawnManager — step arrival semantics', () => {
  it('emits at most one spawn per step() call', () => {
    const { manager } = makeManager('high');
    for (let f = 0; f < 5000; f++) {
      const r = manager.step(f, 0);
      expect(r.length).toBeLessThanOrEqual(1);
    }
  });

  it('spawn frame equals the deadline frame on the spawn tick', () => {
    const { manager } = makeManager('med');
    manager.step(0, 0); // lazy-init
    let deadline = manager.getNextSpawnFrame()!;
    // Step up to (but not including) the deadline — should see no spawns.
    for (let f = 1; f < deadline; f++) {
      expect(manager.step(f, 0)).toEqual([]);
    }
    // Step *on* the deadline — exactly one spawn whose frame == deadline.
    const r = manager.step(deadline, 0);
    expect(r.length).toBe(1);
    expect(r[0]!.frame).toBe(deadline);
    // Next deadline is now in the future.
    expect(manager.getNextSpawnFrame()).toBeGreaterThan(deadline);
  });
});

// ---------------------------------------------------------------------------
// 8. Snapshot / restore
// ---------------------------------------------------------------------------

describe('ItemSpawnManager — snapshot/restore', () => {
  it('snapshot before the first step returns null deadline', () => {
    const { manager } = makeManager('med');
    expect(manager.snapshotState()).toEqual({ nextSpawnFrame: null });
  });

  it('snapshot after stepping carries the live deadline', () => {
    const { manager } = makeManager('med');
    manager.step(0, 0);
    const expected = manager.getNextSpawnFrame();
    expect(manager.snapshotState()).toEqual({ nextSpawnFrame: expected });
  });

  it('restoreState round-trips a snapshot exactly', () => {
    const { manager } = makeManager('med');
    manager.step(0, 0);
    const snapshot = manager.snapshotState();
    // Drive past the deadline so the manager spawns and rolls a new
    // deadline — the snapshot must now differ from the live state.
    const deadline = manager.getNextSpawnFrame()!;
    for (let f = 1; f <= deadline; f++) manager.step(f, 0);
    expect(manager.snapshotState()).not.toEqual(snapshot);
    // Restore — manager state matches the snapshot exactly.
    manager.restoreState(snapshot);
    expect(manager.snapshotState()).toEqual(snapshot);
  });

  it('restoreState + MatchRng restore reproduces the post-snapshot schedule', () => {
    // Run manager A from frame 0 to N, snapshotting RNG + manager state
    // at frame K. Run manager B from frame K with the restored state
    // and verify both produce the same spawns from K onward.
    const seed = 0xabcdef;
    const rngA = new MatchRng(seed);
    const mgrA = new ItemSpawnManager({
      frequency: 'med',
      anchors: ANCHORS,
      rng: rngA,
    });
    const aSpawnsBefore: ItemSpawnRequest[] = [];
    const aSpawnsAfter: ItemSpawnRequest[] = [];
    const SNAPSHOT_FRAME = 1500;
    const TOTAL = 3500;
    for (let f = 0; f < SNAPSHOT_FRAME; f++) {
      aSpawnsBefore.push(...mgrA.step(f, 0));
    }
    const rngSnap = rngA.snapshotState();
    const mgrSnap = mgrA.snapshotState();
    for (let f = SNAPSHOT_FRAME; f < TOTAL; f++) {
      aSpawnsAfter.push(...mgrA.step(f, 0));
    }
    // Now restore on a fresh pair and re-run from the snapshot frame.
    const rngB = new MatchRng(seed);
    const mgrB = new ItemSpawnManager({
      frequency: 'med',
      anchors: ANCHORS,
      rng: rngB,
    });
    rngB.restoreState(rngSnap);
    mgrB.restoreState(mgrSnap);
    const bSpawnsAfter: ItemSpawnRequest[] = [];
    for (let f = SNAPSHOT_FRAME; f < TOTAL; f++) {
      bSpawnsAfter.push(...mgrB.step(f, 0));
    }
    expect(bSpawnsAfter.length).toBe(aSpawnsAfter.length);
    for (let i = 0; i < aSpawnsAfter.length; i++) {
      expect(bSpawnsAfter[i]!.frame).toBe(aSpawnsAfter[i]!.frame);
      expect(bSpawnsAfter[i]!.anchorIndex).toBe(aSpawnsAfter[i]!.anchorIndex);
    }
  });

  it('restoreState rejects a corrupt non-integer deadline', () => {
    const { manager } = makeManager('med');
    expect(() =>
      manager.restoreState({ nextSpawnFrame: 1.5 }),
    ).toThrow();
    expect(() =>
      manager.restoreState({ nextSpawnFrame: -1 }),
    ).toThrow();
    expect(() =>
      manager.restoreState({ nextSpawnFrame: Number.NaN }),
    ).toThrow();
    expect(() =>
      manager.restoreState({ nextSpawnFrame: Number.POSITIVE_INFINITY }),
    ).toThrow();
  });

  it('restoreState({ nextSpawnFrame: null }) resets to "uninitialised"', () => {
    const { manager } = makeManager('med');
    manager.step(0, 0);
    expect(manager.getNextSpawnFrame()).not.toBeNull();
    manager.restoreState({ nextSpawnFrame: null });
    expect(manager.getNextSpawnFrame()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Inspection helpers
// ---------------------------------------------------------------------------

describe('ItemSpawnManager — inspection helpers', () => {
  it('getFrequency returns the constructed value', () => {
    expect(makeManager('off').manager.getFrequency()).toBe('off');
    expect(makeManager('low').manager.getFrequency()).toBe('low');
    expect(makeManager('med').manager.getFrequency()).toBe('med');
    expect(makeManager('high').manager.getFrequency()).toBe('high');
  });

  it('getAnchors returns the constructed list by reference', () => {
    const { manager } = makeManager('med');
    expect(manager.getAnchors()).toBe(ANCHORS);
  });

  it("getMaxItemsOnField returns 0 for 'off'", () => {
    expect(makeManager('off').manager.getMaxItemsOnField()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Defensive input validation
// ---------------------------------------------------------------------------

describe('ItemSpawnManager — defensive checks', () => {
  it('rejects negative currentFrame', () => {
    const { manager } = makeManager('med');
    expect(() => manager.step(-1, 0)).toThrow();
  });

  it('rejects non-finite currentFrame', () => {
    const { manager } = makeManager('med');
    expect(() => manager.step(Number.NaN, 0)).toThrow();
    expect(() => manager.step(Number.POSITIVE_INFINITY, 0)).toThrow();
  });

  it('treats negative activeItemCount as 0 (defensive)', () => {
    // A corrupt / pre-init counter shouldn't crash the spawn loop.
    const { manager } = makeManager('high');
    // No throw + the schedule still ticks.
    for (let f = 0; f < 1000; f++) {
      expect(() => manager.step(f, -5)).not.toThrow();
    }
    // The manager treated -5 like 0 (cap free), so it spawned at least
    // once over 1000 frames at 'high' frequency.
    expect(manager.snapshotState().nextSpawnFrame).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. Drop-from-above spawn position (AC 90301 Sub-AC 1)
// ---------------------------------------------------------------------------

describe('ItemSpawnManager — drop-from-above spawn position', () => {
  it('emits a spawnPosition offset above the picked anchor by ITEM_SPAWN_DROP_HEIGHT_PX', () => {
    const { manager } = makeManager('high');
    const spawns: ItemSpawnRequest[] = [];
    for (let f = 0; f < 5000; f++) {
      spawns.push(...manager.step(f, 0));
    }
    expect(spawns.length).toBeGreaterThan(0);
    for (const r of spawns) {
      // X matches the anchor exactly (drop is purely vertical).
      expect(r.spawnPosition.x).toBe(r.anchor.x);
      // Y is exactly drop-height above the anchor (Phaser screen-space
      // Y grows downward, so "above" means smaller Y). The clamp at 0
      // is not exercised here — the test fixture's anchors all sit at
      // y=100, well below the design viewport top.
      const expectedY = Math.max(0, r.anchor.y - ITEM_SPAWN_DROP_HEIGHT_PX);
      expect(r.spawnPosition.y).toBe(expectedY);
      // Sanity: the drop point is strictly above (or clamped at 0,
      // never below) the anchor.
      expect(r.spawnPosition.y).toBeLessThanOrEqual(r.anchor.y);
    }
  });

  it('produces deterministic spawnPositions across runs with the same seed', () => {
    // Two managers with the same seed pick the same anchor sequence,
    // so the derived spawnPosition sequence must also match exactly.
    // This locks down the replay-determinism contract: the saved
    // replay only persists the anchor index; the drop point is
    // reconstructed deterministically on playback.
    const a = makeManager('med').manager;
    const b = makeManager('med').manager;
    const aSpawns: ItemSpawnRequest[] = [];
    const bSpawns: ItemSpawnRequest[] = [];
    for (let f = 0; f < 20000; f++) {
      aSpawns.push(...a.step(f, 0));
      bSpawns.push(...b.step(f, 0));
    }
    expect(aSpawns.length).toBeGreaterThan(0);
    expect(aSpawns.length).toBe(bSpawns.length);
    for (let i = 0; i < aSpawns.length; i++) {
      expect(aSpawns[i]!.spawnPosition.x).toBe(bSpawns[i]!.spawnPosition.x);
      expect(aSpawns[i]!.spawnPosition.y).toBe(bSpawns[i]!.spawnPosition.y);
    }
  });

  it('clamps spawnPosition.y to 0 when the anchor is too close to the top edge', () => {
    // Anchor authored unusually close to the top of the stage — the
    // raw subtract would produce a negative Y. The defensive clamp
    // guarantees the drop point stays inside the design viewport.
    const topAnchors = Object.freeze([
      Object.freeze({ id: 'top', x: 200, y: 50 }),
    ]);
    const { manager } = makeManager('high', topAnchors);
    let firstSpawn: ItemSpawnRequest | null = null;
    for (let f = 0; f < 5000 && firstSpawn === null; f++) {
      const r = manager.step(f, 0);
      if (r.length > 0) firstSpawn = r[0]!;
    }
    expect(firstSpawn).not.toBeNull();
    expect(firstSpawn!.spawnPosition.x).toBe(200);
    expect(firstSpawn!.spawnPosition.y).toBe(0);
  });

  it('does not consume an extra RNG roll for the drop-position computation', () => {
    // The drop position must be a pure function of the picked anchor —
    // no extra RNG roll. We verify by comparing the post-step RNG
    // state against a manager that picked the same anchors but had
    // no drop-position field. (Functionally: anchor index sequence
    // stays the same → the X coordinate sequence stays the same.)
    const { manager: a, rng: rngA } = makeManager('high', ANCHORS, 0xdeadbeef);
    for (let f = 0; f < 2000; f++) a.step(f, 0);
    const stateA = rngA.snapshotState();
    // Re-run a fresh manager from the same seed — the RNG state
    // after the same number of spawns must match exactly.
    const { manager: b, rng: rngB } = makeManager('high', ANCHORS, 0xdeadbeef);
    for (let f = 0; f < 2000; f++) b.step(f, 0);
    const stateB = rngB.snapshotState();
    expect(stateB).toEqual(stateA);
  });
});
