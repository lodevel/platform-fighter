/**
 * AC 10101 Sub-AC 1 — "Build Stage 1 with its collision geometry,
 * spawn points, and stage-specific hazard behavior wired into match
 * mode."
 *
 * Stage 1 in this codebase is the `LAVA_STAGE` — the first hazard stage
 * in the canonical 4-stage roster (lava → wind → crumbling →
 * moving-platform) and the first non-flat entry the menu surfaces in
 * `BUILT_IN_STAGE_ENTRIES`. M1 had only the FLAT stage; Sub-AC 1 of the
 * 4-hazard-stage AC is the "wire the first hazard stage end-to-end"
 * milestone.
 *
 * What the AC text demands, mapped to test groups below:
 *
 *   • Collision geometry — `LAVA_STAGE.platforms` carries a solid ground
 *     anchor, pass-through floats, and explicit `behavior` fields so the
 *     `StageRenderer` knows what to instantiate. The geometry must fit
 *     inside the design viewport and the blast zone must enclose the
 *     viewport so KOs can fire on all four sides.
 *
 *   • Spawn points — four spawn points (one per match slot), all
 *     strictly above the solid ground so fighters drop in safely, all
 *     inside the design width.
 *
 *   • Stage-specific hazard behavior — two `'lava'`-typed `StageHazard`
 *     records that translate 1-to-1 into runtime `LavaHazard` entities,
 *     phase-offset by half a cycle so one pool is at trough while the
 *     other is at apex (the always-safe-side property the seed leans
 *     on for recoverability).
 *
 *   • Wired into match mode — the canonical MatchScene resolution path
 *     (`MatchConfig.stageId === 'lava'` → `getStage('lava')`) returns
 *     the registered `LAVA_STAGE`, the renderer-free wiring composes
 *     into the `LavaCollisionWatcher` pipeline that issues an instant
 *     KO via `StockTracker.loseStock`, and the menu surfaces the entry
 *     so a player can actually pick it.
 *
 * Why a Phaser-free integration test:
 *
 *   • Determinism. The watcher / tracker / hazard chain is pure data —
 *     identical event streams produce identical KO orderings across
 *     runs. Pulling Phaser into the loop would cost determinism for no
 *     incremental coverage (the Phaser side is exercised by
 *     `LavaHazardRenderer.test.ts` against a mock scene).
 *
 *   • Speed. The full chain runs in milliseconds under plain Node, so a
 *     regression in any sub-system (registry, hazard schema, watcher
 *     event resolution) trips this test before the slower MatchScene
 *     boot test catches it.
 */

import { describe, it, expect } from 'vitest';
import {
  LAVA_STAGE,
  LAVA_STAGE_DEFAULTS,
  STAGES,
  STAGE_DESIGN_HEIGHT,
  STAGE_DESIGN_WIDTH,
  getStage,
} from './stageDefinitions';
import { getPlatformBehavior } from './platformBehavior';
import {
  LavaHazard,
  type LavaHazardOptions,
} from '../entities/LavaHazard';
import {
  LavaCollisionWatcher,
  LAVA_HAZARD_LABEL_PREFIX,
  type LavaMinimalBody,
} from '../match/LavaCollisionWatcher';
import { StockTracker, DEFAULT_STOCK_COUNT } from '../match/StockTracker';
import { BUILT_IN_STAGE_ENTRIES } from '../scenes/stageSelect';
import type { StageHazard } from '../types';

// ---------------------------------------------------------------------------
// Helpers — mirror the production `LavaHazardRenderer` translation from
// `StageHazard` (authoring schema) to `LavaHazard` (runtime entity) so
// the integration walks the exact same data path the live MatchScene
// boot would.
// ---------------------------------------------------------------------------

function lavaOptionsFromStageHazard(h: StageHazard): LavaHazardOptions {
  return {
    id: h.id,
    x: h.x,
    baseY: h.y,
    width: h.width,
    minHeight: h.minHeight,
    maxHeight: h.height,
    cycleFrames: h.cycleFrames,
    phaseFrames: h.phaseFrames,
    damagePerTick: h.damagePerTick,
    activeThreshold: h.activeThreshold,
  };
}

function makeBody(label: string): LavaMinimalBody {
  return { label };
}

// ---------------------------------------------------------------------------
// Test groups
// ---------------------------------------------------------------------------

describe('AC 10101 Sub-AC 1 — Stage 1 (lava) collision geometry', () => {
  it("registers Stage 1 in the canonical STAGES registry under id 'lava'", () => {
    // Match-mode resolution path 1 of 3: MatchScene's `getStage(id)`
    // call has to find Stage 1 in the registry by its canonical id.
    expect(LAVA_STAGE.id).toBe('lava');
    expect(STAGES['lava']).toBe(LAVA_STAGE);
    expect(getStage('lava')).toBe(LAVA_STAGE);
  });

  it('carries a solid ground anchor and at least one pass-through float', () => {
    const platforms = LAVA_STAGE.platforms;
    const solid = platforms.filter(
      (p) => getPlatformBehavior(p) === 'solid',
    );
    const floats = platforms.filter(
      (p) => getPlatformBehavior(p) === 'pass-through',
    );
    expect(solid.length).toBeGreaterThanOrEqual(1);
    expect(floats.length).toBeGreaterThanOrEqual(1);
  });

  it('declares an explicit behavior on every platform (new schema)', () => {
    // Sub-AC 2 of AC 90302 contract — every platform on a hazard stage
    // carries the canonical `behavior` field so the renderer + replay
    // tooling read one source of truth instead of falling back to the
    // legacy `passThrough` boolean.
    for (const p of LAVA_STAGE.platforms) {
      expect(p.behavior).toBeDefined();
      expect(['solid', 'pass-through', 'moving']).toContain(p.behavior);
      // Stable IDs are required for replay snapshots to address each
      // platform across snapshot boundaries.
      expect(typeof p.id).toBe('string');
      expect((p.id ?? '').length).toBeGreaterThan(0);
    }
    const ids = LAVA_STAGE.platforms.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('fits every platform inside the design viewport', () => {
    for (const p of LAVA_STAGE.platforms) {
      expect(p.x - p.width / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width / 2).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
      expect(p.y - p.height / 2).toBeGreaterThanOrEqual(0);
      expect(p.y + p.height / 2).toBeLessThanOrEqual(STAGE_DESIGN_HEIGHT);
    }
  });

  it('encloses the entire design viewport inside the blast zone (4-side KO contract)', () => {
    const z = LAVA_STAGE.blastZone;
    expect(z.left).toBeLessThan(0);
    expect(z.right).toBeGreaterThan(STAGE_DESIGN_WIDTH);
    expect(z.top).toBeLessThan(0);
    expect(z.bottom).toBeGreaterThan(STAGE_DESIGN_HEIGHT);
  });
});

describe('AC 10101 Sub-AC 1 — Stage 1 spawn points', () => {
  it('exposes exactly four spawn points (one per match slot)', () => {
    expect(LAVA_STAGE.spawnPoints.length).toBe(4);
  });

  it('places every spawn strictly above the central solid ground', () => {
    const ground = LAVA_STAGE.platforms.find(
      (p) => getPlatformBehavior(p) === 'solid',
    )!;
    const groundTop = ground.y - ground.height / 2;
    for (const sp of LAVA_STAGE.spawnPoints) {
      // Smaller y == higher on screen → strictly above the platform top.
      expect(sp.y).toBeLessThan(groundTop);
    }
  });

  it('keeps every spawn inside the design width so fighters do not spawn off-stage', () => {
    for (const sp of LAVA_STAGE.spawnPoints) {
      expect(sp.x).toBeGreaterThanOrEqual(0);
      expect(sp.x).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
    }
  });

  it('produces unique spawn coordinates so fighters do not stack on top of each other', () => {
    const keys = LAVA_STAGE.spawnPoints.map((sp) => `${sp.x},${sp.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('AC 10101 Sub-AC 1 — Stage 1 stage-specific hazard records', () => {
  it("declares two 'lava'-typed hazards (one in each side pit)", () => {
    const lava = LAVA_STAGE.hazards.filter((h) => h.type === 'lava');
    expect(lava.length).toBe(2);
    const ids = lava.map((h) => h.id).sort();
    expect(ids).toEqual(['lava-left', 'lava-right']);
  });

  it('phase-offsets the two pools by half a cycle (always-safe-side contract)', () => {
    const left = LAVA_STAGE.hazards.find((h) => h.id === 'lava-left')!;
    const right = LAVA_STAGE.hazards.find((h) => h.id === 'lava-right')!;
    expect(left.cycleFrames).toBe(LAVA_STAGE_DEFAULTS.lavaCycleFrames);
    expect(right.cycleFrames).toBe(LAVA_STAGE_DEFAULTS.lavaCycleFrames);
    expect(left.phaseFrames).toBe(0);
    expect(right.phaseFrames).toBe(
      Math.round(0.5 * LAVA_STAGE_DEFAULTS.lavaCycleFrames),
    );
  });

  it('exposes every tunable timing parameter on every hazard so the runtime entity is fully driven by the authoring record', () => {
    for (const h of LAVA_STAGE.hazards) {
      expect(h.cycleFrames).toBe(LAVA_STAGE_DEFAULTS.lavaCycleFrames);
      expect(h.activeThreshold).toBe(
        LAVA_STAGE_DEFAULTS.lavaActiveThreshold,
      );
      expect(h.damagePerTick).toBe(LAVA_STAGE_DEFAULTS.lavaDamagePerTick);
      expect(h.minHeight).toBe(LAVA_STAGE_DEFAULTS.lavaMinHeight);
      expect(h.width).toBe(LAVA_STAGE_DEFAULTS.lavaPoolWidth);
      expect(h.height).toBe(LAVA_STAGE_DEFAULTS.lavaMaxHeight);
    }
  });

  it('positions each pool in the opposite side pit relative to the central ground', () => {
    const ground = LAVA_STAGE.platforms.find(
      (p) => getPlatformBehavior(p) === 'solid',
    )!;
    const groundLeft = ground.x - ground.width / 2;
    const groundRight = ground.x + ground.width / 2;
    const left = LAVA_STAGE.hazards.find((h) => h.id === 'lava-left')!;
    const right = LAVA_STAGE.hazards.find((h) => h.id === 'lava-right')!;
    expect(left.x).toBeLessThan(groundLeft);
    expect(right.x).toBeGreaterThan(groundRight);
  });
});

describe('AC 10101 Sub-AC 1 — Stage 1 wired into match mode end-to-end', () => {
  it('is selectable from the StageSelectScene roster (player-facing entry point)', () => {
    // Match-mode resolution path 2 of 3: the menu has to surface
    // Stage 1 to the player as a choice. `BUILT_IN_STAGE_ENTRIES` is
    // the data-driven list `StageSelectScene` walks; if Stage 1 isn't
    // here, the menu can't fire `MatchConfig.stageId = 'lava'`.
    const entry = BUILT_IN_STAGE_ENTRIES.find((e) => e.id === LAVA_STAGE.id);
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe('built-in');
    expect(entry?.displayName).toBe('LAVA');
    // Subtitle calls out the lethal-instant-KO property so a player
    // glancing at the menu knows what kind of hazard to expect.
    expect(entry?.subtitle.toLowerCase()).toContain('instant ko');
  });

  it('translates every authored hazard record 1-to-1 into a runtime LavaHazard entity', () => {
    // Match-mode resolution path 3 of 3: `LavaHazardRenderer` builds
    // one runtime entity per `'lava'`-typed `StageHazard` in
    // declaration order. We don't pull the renderer here (it lights
    // up Phaser); we walk the same translation manually so we can
    // assert the bridge preserves every tunable.
    const hazardRecords = LAVA_STAGE.hazards.filter(
      (h) => h.type === 'lava',
    );
    const entities = hazardRecords.map(
      (h) => new LavaHazard(lavaOptionsFromStageHazard(h)),
    );
    expect(entities.length).toBe(hazardRecords.length);
    for (let i = 0; i < hazardRecords.length; i += 1) {
      const h = hazardRecords[i]!;
      const e = entities[i]!;
      expect(e.getId()).toBe(h.id);
      expect(e.getX()).toBe(h.x);
      expect(e.getBaseY()).toBe(h.y);
      expect(e.getWidth()).toBe(h.width);
      expect(e.getMaxHeight()).toBe(h.height);
      expect(e.getMinHeight()).toBe(h.minHeight);
      expect(e.getCycleFrames()).toBe(h.cycleFrames);
      expect(e.getPhaseFrames()).toBe(h.phaseFrames);
      expect(e.getActiveThreshold()).toBe(h.activeThreshold);
    }
  });

  it('produces an always-safe-side window: never both pools active on the same frame', () => {
    // The phase-offset contract is what makes recovery survivable.
    // Walk a full cycle and assert at every frame at least one pool
    // is inactive — i.e. a fighter knocked off either side has a
    // platforming route to the centre.
    const left = new LavaHazard(
      lavaOptionsFromStageHazard(
        LAVA_STAGE.hazards.find((h) => h.id === 'lava-left')!,
      ),
    );
    const right = new LavaHazard(
      lavaOptionsFromStageHazard(
        LAVA_STAGE.hazards.find((h) => h.id === 'lava-right')!,
      ),
    );
    const cycleFrames = left.getCycleFrames();
    let bothActiveCount = 0;
    let leastOneInactiveCount = 0;
    for (let f = 0; f < cycleFrames; f += 1) {
      const lActive = left.isActive();
      const rActive = right.isActive();
      if (lActive && rActive) bothActiveCount += 1;
      if (!lActive || !rActive) leastOneInactiveCount += 1;
      left.tick();
      right.tick();
    }
    // Stage 1's "always-safe-side" property: across the entire cycle,
    // at every frame at least one pool is inactive.
    expect(leastOneInactiveCount).toBe(cycleFrames);
    expect(bothActiveCount).toBe(0);
  });

  it('issues a deterministic instant-KO via the LavaCollisionWatcher → StockTracker pipeline (the canonical match-mode wiring)', () => {
    // This is the headline "wired into match mode" assertion. We
    // wire up the same chain `MatchScene` does — minus Phaser — and
    // drive a fighter into ACTIVE lava. The watcher must fire, the
    // tracker must decrement exactly one stock, and the lifecycle
    // (overlap dedup + re-arm) must hold.
    const koLog: Array<{ playerIndex: number; hazardId: string }> = [];
    const tracker = new StockTracker({
      playerCount: 4,
      stockCount: DEFAULT_STOCK_COUNT,
    });
    const watcher = new LavaCollisionWatcher((playerIndex, hazardId) => {
      koLog.push({ playerIndex, hazardId });
      tracker.loseStock(playerIndex, /* frame */ 0);
    });

    // Build a `LavaHazard` whose phase puts it AT APEX on frame 0 so
    // we can deterministically assert "active lava → instant KO" on
    // the very first tick. We pass `phaseFrames = cycleFrames / 2` to
    // anchor the cycle position at 0.5 (apex), independent of the
    // canonical lava-left record's authored phase.
    const lavaSrc = LAVA_STAGE.hazards.find((h) => h.id === 'lava-left')!;
    // `StageHazard.cycleFrames` is optional in the schema (lava is the
    // only hazard type that uses it today, but the field is shared).
    // The lava-left record always sets it — assert + capture so the
    // typechecker can narrow.
    const cycleFrames = lavaSrc.cycleFrames;
    expect(cycleFrames).toBeDefined();
    const apexHazard = new LavaHazard({
      ...lavaOptionsFromStageHazard(lavaSrc),
      phaseFrames: Math.round((cycleFrames ?? 600) / 2),
    });

    const playerBody = makeBody('character.body');
    const lavaBody = makeBody(`${LAVA_HAZARD_LABEL_PREFIX}${apexHazard.getId()}`);

    watcher.registerPlayer(0, playerBody);
    watcher.registerHazard(apexHazard, lavaBody);

    // Assert pre-conditions: hazard is active, tracker has full stocks.
    expect(apexHazard.isActive()).toBe(true);
    expect(tracker.getStocks(0)).toBe(DEFAULT_STOCK_COUNT);

    // Drive a `collisionstart` (player enters lava) and tick once —
    // mirroring MatchScene's per-step "fan world events into watcher,
    // then watcher.tick() after the physics step" loop.
    watcher.handleCollisionStart({
      pairs: [{ bodyA: playerBody, bodyB: lavaBody }],
    });
    watcher.tick();

    // Assertions: exactly one KO callback fired, tracker decremented
    // exactly one stock, KO is attributed to the right hazard id.
    expect(koLog).toEqual([{ playerIndex: 0, hazardId: 'lava-left' }]);
    expect(tracker.getStocks(0)).toBe(DEFAULT_STOCK_COUNT - 1);

    // Re-arm contract: a continuing overlap must NOT re-fire each tick
    // (that would burn every stock in 3 frames). The fighter has to
    // leave and re-enter the lava body to re-arm.
    watcher.tick();
    watcher.tick();
    expect(koLog.length).toBe(1);
    expect(tracker.getStocks(0)).toBe(DEFAULT_STOCK_COUNT - 1);

    // Leaving and re-entering the body re-arms the watcher. Drain the
    // tracker's pending respawn first — `loseStock` is a no-op while a
    // slot is mid-respawn (mirrors the production MatchScene loop where
    // `consumePendingRespawns` is called once per fixed step before the
    // next KO has a chance to fire). Without this drain, the second
    // `tracker.loseStock` would early-out on `wasRespawning === true`
    // and the stock count would stay at 2 even though the watcher
    // legitimately fired a second KO.
    const drained = tracker.consumePendingRespawns(/* frame */ 0);
    expect(drained.length).toBe(1);
    watcher.handleCollisionEnd({
      pairs: [{ bodyA: playerBody, bodyB: lavaBody }],
    });
    watcher.handleCollisionStart({
      pairs: [{ bodyA: playerBody, bodyB: lavaBody }],
    });
    watcher.tick();
    expect(koLog.length).toBe(2);
    expect(tracker.getStocks(0)).toBe(DEFAULT_STOCK_COUNT - 2);
  });

  it('keeps Stage 1 hazard behavior deterministic across runs (replay safety)', () => {
    // The seed mandates a deterministic engine where a recorded match
    // replays byte-for-byte. Replay determinism for hazards reduces
    // to: "given the same frame counter, every public observable
    // produces the same output." We assert that on a 2-cycle window
    // covering both pools, all observables match between two
    // independently-constructed entities.
    const recordA = LAVA_STAGE.hazards.find((h) => h.id === 'lava-left')!;
    const recordB = LAVA_STAGE.hazards.find((h) => h.id === 'lava-right')!;

    const buildPair = () => ({
      a: new LavaHazard(lavaOptionsFromStageHazard(recordA)),
      b: new LavaHazard(lavaOptionsFromStageHazard(recordB)),
    });

    const run1 = buildPair();
    const run2 = buildPair();
    const totalFrames = run1.a.getCycleFrames() * 2;
    for (let f = 0; f < totalFrames; f += 1) {
      expect(run2.a.getCurrentHeight()).toBe(run1.a.getCurrentHeight());
      expect(run2.b.getCurrentHeight()).toBe(run1.b.getCurrentHeight());
      expect(run2.a.isActive()).toBe(run1.a.isActive());
      expect(run2.b.isActive()).toBe(run1.b.isActive());
      run1.a.tick();
      run1.b.tick();
      run2.a.tick();
      run2.b.tick();
    }
  });
});
