/**
 * AC 10102 Sub-AC 2 — "Build Stage 2 with its collision geometry,
 * spawn points, and stage-specific hazard behavior wired into match
 * mode."
 *
 * Stage 2 in this codebase is the `WIND_STAGE` — the second hazard
 * stage in the canonical 4-stage roster (lava → wind → crumbling →
 * moving-platform). Sub-AC 1 covered Stage 1 (lava); this Sub-AC
 * extends the same end-to-end wiring contract to the wind stage.
 *
 * What the AC text demands, mapped to test groups below:
 *
 *   • Collision geometry — `WIND_STAGE.platforms` carries a solid
 *     ground anchor, pass-through floats, and explicit `behavior`
 *     fields so the `StageRenderer` knows what to instantiate. The
 *     geometry must fit inside the design viewport and the blast zone
 *     must enclose the viewport so KOs can fire on all four sides.
 *
 *   • Spawn points — four spawn points (one per match slot), all
 *     strictly above the solid ground so fighters drop in safely, all
 *     inside the design width.
 *
 *   • Stage-specific hazard behavior — two `'wind'`-typed `StageHazard`
 *     records (one for the leftward gust, one for the rightward gust)
 *     that translate 1-to-1 into runtime `WindZoneHazard` entities,
 *     phase-offset by half a cycle so when the leftward gust is at
 *     apex the rightward gust is at trough (and vice versa) — the
 *     "always-safe-side" recoverability property.
 *
 *   • Wired into match mode — the canonical MatchScene resolution path
 *     (`MatchConfig.stageId === 'wind'` → `getStage('wind')`) returns
 *     the registered `WIND_STAGE`, the renderer-free wiring composes
 *     into the `WindForceController` pipeline that applies the per-
 *     frame gust force to overlapping fighters, and the menu surfaces
 *     the entry so a player can actually pick it.
 *
 * Why a Phaser-free integration test (mirrors stage1MatchModeWiring):
 *
 *   • Determinism. The controller / hazard / force chain is pure data —
 *     identical event streams produce identical force orderings across
 *     runs. Pulling Phaser into the loop would cost determinism for no
 *     incremental coverage (the Phaser side is exercised by
 *     `WindHazardRenderer.test.ts` against a mock scene if/when one
 *     lands).
 *
 *   • Speed. The full chain runs in milliseconds under plain Node, so
 *     a regression in any sub-system (registry, hazard schema,
 *     controller resolution) trips this test before the slower
 *     MatchScene boot test catches it.
 */

import { describe, it, expect } from 'vitest';
import {
  WIND_STAGE,
  WIND_STAGE_DEFAULTS,
  STAGES,
  STAGE_DESIGN_HEIGHT,
  STAGE_DESIGN_WIDTH,
  getStage,
} from './stageDefinitions';
import { createWindHazardFromStageHazard } from '../entities/WindZoneHazard';
import { getPlatformBehavior } from './platformBehavior';
import {
  WindZoneHazard,
  WIND_DEFAULTS,
  type WindForceVector,
} from '../entities/WindZoneHazard';
import {
  WindForceController,
  WIND_HAZARD_LABEL_PREFIX,
  type WindMinimalBody,
} from '../match/WindForceController';
import { BUILT_IN_STAGE_ENTRIES } from '../scenes/stageSelect';
import type { StageHazard } from '../types';

// ---------------------------------------------------------------------------
// Helpers — mirror the production `WindHazardRenderer` translation from
// `StageHazard` (authoring schema) to `WindZoneHazard` (runtime entity)
// so the integration walks the exact same data path the live MatchScene
// boot would.
// ---------------------------------------------------------------------------

function makeBody(label: string): WindMinimalBody {
  return { label };
}

// ---------------------------------------------------------------------------
// Test groups
// ---------------------------------------------------------------------------

describe('AC 10102 Sub-AC 2 — Stage 2 (wind) collision geometry', () => {
  it("registers Stage 2 in the canonical STAGES registry under id 'wind'", () => {
    // Match-mode resolution path 1 of 3: MatchScene's `getStage(id)`
    // call has to find Stage 2 in the registry by its canonical id.
    expect(WIND_STAGE.id).toBe('wind');
    expect(STAGES['wind']).toBe(WIND_STAGE);
    expect(getStage('wind')).toBe(WIND_STAGE);
  });

  it('carries a solid ground anchor and at least one pass-through float', () => {
    const platforms = WIND_STAGE.platforms;
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
    for (const p of WIND_STAGE.platforms) {
      expect(p.behavior).toBeDefined();
      expect(['solid', 'pass-through', 'moving']).toContain(p.behavior);
      // Stable IDs are required for replay snapshots to address each
      // platform across snapshot boundaries.
      expect(typeof p.id).toBe('string');
      expect((p.id ?? '').length).toBeGreaterThan(0);
    }
    const ids = WIND_STAGE.platforms.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('fits every platform inside the design viewport', () => {
    for (const p of WIND_STAGE.platforms) {
      expect(p.x - p.width / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width / 2).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
      expect(p.y - p.height / 2).toBeGreaterThanOrEqual(0);
      expect(p.y + p.height / 2).toBeLessThanOrEqual(STAGE_DESIGN_HEIGHT);
    }
  });

  it('encloses the entire design viewport inside the blast zone (4-side KO contract)', () => {
    const z = WIND_STAGE.blastZone;
    expect(z.left).toBeLessThan(0);
    expect(z.right).toBeGreaterThan(STAGE_DESIGN_WIDTH);
    expect(z.top).toBeLessThan(0);
    expect(z.bottom).toBeGreaterThan(STAGE_DESIGN_HEIGHT);
  });
});

describe('AC 10102 Sub-AC 2 — Stage 2 spawn points', () => {
  it('exposes exactly four spawn points (one per match slot)', () => {
    expect(WIND_STAGE.spawnPoints.length).toBe(4);
  });

  it('places every spawn strictly above the central solid ground', () => {
    const ground = WIND_STAGE.platforms.find(
      (p) => getPlatformBehavior(p) === 'solid',
    )!;
    const groundTop = ground.y - ground.height / 2;
    for (const sp of WIND_STAGE.spawnPoints) {
      // Smaller y == higher on screen → strictly above the platform top.
      expect(sp.y).toBeLessThan(groundTop);
    }
  });

  it('keeps every spawn inside the design width so fighters do not spawn off-stage', () => {
    for (const sp of WIND_STAGE.spawnPoints) {
      expect(sp.x).toBeGreaterThanOrEqual(0);
      expect(sp.x).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
    }
  });

  it('produces unique spawn coordinates so fighters do not stack on top of each other', () => {
    const keys = WIND_STAGE.spawnPoints.map((sp) => `${sp.x},${sp.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('AC 10102 Sub-AC 2 — Stage 2 stage-specific hazard records', () => {
  it("declares two 'wind'-typed hazards (one leftward, one rightward)", () => {
    const wind = WIND_STAGE.hazards.filter((h) => h.type === 'wind');
    expect(wind.length).toBe(2);
    const ids = wind.map((h) => h.id).sort();
    expect(ids).toEqual(['wind-leftward', 'wind-rightward']);
  });

  it('phase-offsets the two zones by half a cycle (always-safe-side contract)', () => {
    const left = WIND_STAGE.hazards.find((h) => h.id === 'wind-leftward')!;
    const right = WIND_STAGE.hazards.find((h) => h.id === 'wind-rightward')!;
    expect(left.cycleFrames).toBe(WIND_STAGE_DEFAULTS.windCycleFrames);
    expect(right.cycleFrames).toBe(WIND_STAGE_DEFAULTS.windCycleFrames);
    expect(left.phaseFrames).toBe(0);
    expect(right.phaseFrames).toBe(
      Math.round(0.5 * WIND_STAGE_DEFAULTS.windCycleFrames),
    );
  });

  it('uses matching peak-force magnitudes so the two zones balance across the cycle', () => {
    // The "always-safe-side" property comes from combining matching
    // peak magnitudes with a half-cycle phase offset: the cosine sign
    // on each zone flips at every half-cycle so the pair naturally
    // pushes in opposite directions at every active frame (and quiets
    // simultaneously around the cycle's ¼ / ¾ marks). See the
    // worked-example comment block in `createWindStage`.
    const left = WIND_STAGE.hazards.find((h) => h.id === 'wind-leftward')!;
    const right = WIND_STAGE.hazards.find((h) => h.id === 'wind-rightward')!;
    expect(left.forceX).toBeDefined();
    expect(right.forceX).toBeDefined();
    expect(Math.abs(left.forceX!)).toBeCloseTo(
      WIND_STAGE_DEFAULTS.windPeakForceX,
      6,
    );
    expect(Math.abs(right.forceX!)).toBeCloseTo(
      WIND_STAGE_DEFAULTS.windPeakForceX,
      6,
    );
  });

  it('exposes every tunable timing parameter so the runtime entity is fully driven by the authoring record', () => {
    for (const h of WIND_STAGE.hazards) {
      expect(h.cycleFrames).toBe(WIND_STAGE_DEFAULTS.windCycleFrames);
      expect(h.activeThreshold).toBe(WIND_STAGE_DEFAULTS.windActiveThreshold);
      expect(h.width).toBe(WIND_STAGE_DEFAULTS.windZoneWidth);
      expect(h.height).toBe(WIND_STAGE_DEFAULTS.windZoneHeight);
      // forceX magnitude matches the canonical peak from defaults.
      expect(Math.abs(h.forceX ?? 0)).toBeCloseTo(
        WIND_STAGE_DEFAULTS.windPeakForceX,
        6,
      );
    }
  });

  it('positions both zones inside the design viewport above the central ground', () => {
    const ground = WIND_STAGE.platforms.find(
      (p) => getPlatformBehavior(p) === 'solid',
    )!;
    const groundTop = ground.y - ground.height / 2;
    for (const h of WIND_STAGE.hazards) {
      const top = h.y - h.height / 2;
      const bottom = h.y + h.height / 2;
      expect(top).toBeGreaterThanOrEqual(0);
      expect(bottom).toBeLessThanOrEqual(STAGE_DESIGN_HEIGHT);
      // Wind zones live in the airborne corridor — their centre Y is
      // above the ground top so a fighter on the floor isn't shoved
      // off-stage just by standing.
      expect(h.y).toBeLessThan(groundTop);
    }
  });
});

describe('AC 10102 Sub-AC 2 — Stage 2 wired into match mode end-to-end', () => {
  it('is selectable from the StageSelectScene roster (player-facing entry point)', () => {
    // Match-mode resolution path 2 of 3: the menu has to surface
    // Stage 2 to the player as a choice. `BUILT_IN_STAGE_ENTRIES` is
    // the data-driven list `StageSelectScene` walks; if Stage 2 isn't
    // here, the menu can't fire `MatchConfig.stageId = 'wind'`.
    const entry = BUILT_IN_STAGE_ENTRIES.find((e) => e.id === WIND_STAGE.id);
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe('built-in');
    expect(entry?.displayName).toBe('WIND');
    // Subtitle calls out the directional gust theme so a player
    // glancing at the menu knows what kind of hazard to expect.
    expect(entry?.subtitle.toLowerCase()).toMatch(/gust|wind|push|off-stage/);
  });

  it('translates every authored hazard record 1-to-1 into a runtime WindZoneHazard entity', () => {
    // Match-mode resolution path 3 of 3: `WindHazardRenderer` builds
    // one runtime entity per `'wind'`-typed `StageHazard` in
    // declaration order. We don't pull the renderer here (it lights
    // up Phaser); we walk the same translation manually so we can
    // assert the bridge preserves every tunable.
    const hazardRecords = WIND_STAGE.hazards.filter((h) => h.type === 'wind');
    const entities = hazardRecords.map((h) =>
      createWindHazardFromStageHazard(h),
    );
    expect(entities.length).toBe(hazardRecords.length);
    for (let i = 0; i < hazardRecords.length; i += 1) {
      const h = hazardRecords[i]!;
      const e = entities[i]!;
      expect(e.getId()).toBe(h.id);
      expect(e.getX()).toBe(h.x);
      expect(e.getY()).toBe(h.y);
      expect(e.getWidth()).toBe(h.width);
      expect(e.getHeight()).toBe(h.height);
      expect(e.getCycleFrames()).toBe(h.cycleFrames);
      expect(e.getPhaseFrames()).toBe(h.phaseFrames);
      expect(e.getActiveThreshold()).toBe(h.activeThreshold);
      // The peak force *retains its sign* through the bridge, so the
      // direction is preserved — the integration test below relies on
      // this (leftward zone pushes left at its apex, rightward zone
      // pushes right at its apex).
      expect(e.getPeakForceX()).toBe(h.forceX);
    }
  });

  it('produces an always-safe-side window: across a full cycle the two zones never both push in the same direction at active magnitude', () => {
    // The phase-offset + opposite-sign contract is what makes recovery
    // survivable. Walk a full cycle and assert at every frame the two
    // active forces (when both are active) point in opposite directions
    // — i.e. their sum has magnitude smaller than either alone, so a
    // fighter knocked toward one blast zone has a counter-gust working
    // in their favour somewhere in the cycle.
    const recordL = WIND_STAGE.hazards.find((h) => h.id === 'wind-leftward')!;
    const recordR = WIND_STAGE.hazards.find((h) => h.id === 'wind-rightward')!;
    const left = createWindHazardFromStageHazard(recordL);
    const right = createWindHazardFromStageHazard(recordR);
    const cycleFrames = left.getCycleFrames();
    let bothActiveAndSameSign = 0;
    let atLeastOneInactive = 0;
    for (let f = 0; f < cycleFrames; f += 1) {
      const lActive = left.isActive();
      const rActive = right.isActive();
      const lForce = left.getCurrentForce().x;
      const rForce = right.getCurrentForce().x;
      if (lActive && rActive) {
        // Both active simultaneously — invalid same-sign push iff the
        // forces have the same sign (both pushing left or both
        // pushing right), which would break recoverability.
        if (Math.sign(lForce) === Math.sign(rForce) && lForce !== 0) {
          bothActiveAndSameSign += 1;
        }
      }
      if (!lActive || !rActive) atLeastOneInactive += 1;
      left.tick();
      right.tick();
    }
    // With a 0.5 phase offset the zones are *never* simultaneously at
    // peak in the same direction. Half-cycle staggering combined with
    // opposite sign guarantees one of these holds every frame:
    //   1. At least one zone is below its active threshold, OR
    //   2. Both are active but in opposite directions (cancelling).
    expect(bothActiveAndSameSign).toBe(0);
    expect(atLeastOneInactive).toBeGreaterThan(0);
  });

  it('applies a deterministic per-frame force pulse via the WindForceController → fighter-velocity pipeline (the canonical match-mode wiring)', () => {
    // This is the headline "wired into match mode" assertion. We wire
    // up the same chain `MatchScene` does — minus Phaser — and drive
    // a fighter into ACTIVE wind. The controller must fire on every
    // tick the wind is active, and must emit force vectors whose
    // magnitude/direction match the zone's `getCurrentForce()`.
    const forceLog: Array<{
      playerIndex: number;
      hazardId: string;
      force: WindForceVector;
    }> = [];

    const recordL = WIND_STAGE.hazards.find((h) => h.id === 'wind-leftward')!;
    // Build the zone with `phaseFrames = cycleFrames / 2 = 180`. With
    // the `wind-leftward` record's authored peakForceX < 0 and
    // cosine(2π × 180/360) = -1, the current force at frame 0 is
    // `peakForceX × -1 = +|peakForceX|` — the gust has flipped to
    // blow rightward at apex. That gives us a fully-active starting
    // state without trying to slip the entity past the active
    // threshold in the test setup.
    const apexHazard = new WindZoneHazard({
      id: recordL.id,
      x: recordL.x,
      y: recordL.y,
      width: recordL.width,
      height: recordL.height,
      peakForceX: recordL.forceX,
      peakForceY: recordL.forceY ?? 0,
      cycleFrames: recordL.cycleFrames,
      phaseFrames: Math.round((recordL.cycleFrames ?? 360) / 2),
      activeThreshold: recordL.activeThreshold,
    });

    const controller = new WindForceController(
      (playerIndex, hazardId, force) => {
        forceLog.push({ playerIndex, hazardId, force });
      },
    );

    const playerBody = makeBody('character.body');
    const windBody = makeBody(`${WIND_HAZARD_LABEL_PREFIX}${apexHazard.getId()}`);

    controller.registerPlayer(0, playerBody);
    controller.registerHazard(apexHazard, windBody);

    // Pre-conditions: the hazard is active at frame 0 (cosine == -1).
    expect(apexHazard.isActive()).toBe(true);
    expect(forceLog).toEqual([]);

    // Drive a `collisionstart` (player enters wind) and tick once.
    controller.handleCollisionStart({
      pairs: [{ bodyA: playerBody, bodyB: windBody }],
    });
    controller.tick();

    // Exactly one force callback fires — wind is continuous: every
    // active tick yields one push.
    expect(forceLog.length).toBe(1);
    expect(forceLog[0]!.playerIndex).toBe(0);
    expect(forceLog[0]!.hazardId).toBe('wind-leftward');
    // The force vector matches what the entity reports.
    const expectedForce = apexHazard.getCurrentForce();
    expect(forceLog[0]!.force.x).toBeCloseTo(expectedForce.x, 9);
    expect(forceLog[0]!.force.y).toBeCloseTo(expectedForce.y, 9);
    // Direction sanity: at this phase the cosine == -1, so the force
    // has the opposite sign of the authored peak. The leftward zone
    // with negative `peakForceX` therefore pushes RIGHT at this
    // moment — proving the gust reverses across the cycle.
    expect(forceLog[0]!.force.x).toBeGreaterThan(0);

    // Continuity contract: a sustained overlap fires every active
    // tick. Tick three more times and confirm three more callbacks
    // (no de-dup like the lava watcher's "fired" guard).
    forceLog.length = 0;
    apexHazard.tick();
    controller.tick();
    apexHazard.tick();
    controller.tick();
    apexHazard.tick();
    controller.tick();
    expect(forceLog.length).toBe(3);
    for (const entry of forceLog) {
      expect(entry.playerIndex).toBe(0);
      expect(entry.hazardId).toBe('wind-leftward');
    }

    // Inactive contract: advance the cycle until cosine < threshold,
    // then a tick emits no callback.
    forceLog.length = 0;
    // Reset to a quiet position — phase = cycleFrames/4 → cosine = 0
    // → wind quiet.
    apexHazard.reset(Math.round((recordL.cycleFrames ?? 360) / 4));
    expect(apexHazard.isActive()).toBe(false);
    controller.tick();
    expect(forceLog.length).toBe(0);

    // Leaving the body drops the overlap so a future tick — even an
    // active one — emits nothing until a new collisionstart re-arms.
    forceLog.length = 0;
    apexHazard.reset(Math.round((recordL.cycleFrames ?? 360) / 2));
    expect(apexHazard.isActive()).toBe(true);
    controller.handleCollisionEnd({
      pairs: [{ bodyA: playerBody, bodyB: windBody }],
    });
    controller.tick();
    expect(forceLog.length).toBe(0);
  });

  it('respects player elimination — unregistering a slot drops it from the force pipeline', () => {
    // Match-mode contract: when a player is eliminated, MatchScene
    // unregisters them from every collision adapter. Wind has to honour
    // that — no force ticks for an unregistered slot, even if the
    // overlap was still tracked.
    const forceLog: Array<{ playerIndex: number; force: WindForceVector }> = [];
    const recordL = WIND_STAGE.hazards.find((h) => h.id === 'wind-leftward')!;
    const hazard = new WindZoneHazard({
      id: recordL.id,
      x: recordL.x,
      y: recordL.y,
      width: recordL.width,
      height: recordL.height,
      peakForceX: recordL.forceX,
      cycleFrames: recordL.cycleFrames,
      phaseFrames: Math.round((recordL.cycleFrames ?? 360) / 2),
      activeThreshold: recordL.activeThreshold,
    });
    const controller = new WindForceController((playerIndex, _hid, force) => {
      forceLog.push({ playerIndex, force });
    });

    const body0 = makeBody('p0.body');
    const body1 = makeBody('p1.body');
    const wb = makeBody(`${WIND_HAZARD_LABEL_PREFIX}${hazard.getId()}`);
    controller.registerPlayer(0, body0);
    controller.registerPlayer(1, body1);
    controller.registerHazard(hazard, wb);
    controller.handleCollisionStart({
      pairs: [
        { bodyA: body0, bodyB: wb },
        { bodyA: body1, bodyB: wb },
      ],
    });

    controller.tick();
    expect(forceLog.length).toBe(2);
    expect(forceLog.map((e) => e.playerIndex).sort()).toEqual([0, 1]);

    // Eliminate slot 0.
    forceLog.length = 0;
    controller.unregisterPlayer(0);
    controller.tick();
    expect(forceLog.length).toBe(1);
    expect(forceLog[0]!.playerIndex).toBe(1);
  });

  it('keeps Stage 2 hazard behavior deterministic across runs (replay safety)', () => {
    // The seed mandates a deterministic engine where a recorded match
    // replays byte-for-byte. Replay determinism for hazards reduces
    // to: "given the same frame counter, every public observable
    // produces the same output." We assert that on a 2-cycle window
    // covering both zones, all observables match between two
    // independently-constructed entities.
    const recordA = WIND_STAGE.hazards.find((h) => h.id === 'wind-leftward')!;
    const recordB = WIND_STAGE.hazards.find((h) => h.id === 'wind-rightward')!;

    const buildPair = () => ({
      a: createWindHazardFromStageHazard(recordA),
      b: createWindHazardFromStageHazard(recordB),
    });

    const run1 = buildPair();
    const run2 = buildPair();
    const totalFrames = run1.a.getCycleFrames() * 2;
    for (let f = 0; f < totalFrames; f += 1) {
      expect(run2.a.getCurrentForce().x).toBe(run1.a.getCurrentForce().x);
      expect(run2.b.getCurrentForce().x).toBe(run1.b.getCurrentForce().x);
      expect(run2.a.isActive()).toBe(run1.a.isActive());
      expect(run2.b.isActive()).toBe(run1.b.isActive());
      run1.a.tick();
      run1.b.tick();
      run2.a.tick();
      run2.b.tick();
    }
  });

  it('snapshots and restores byte-perfectly through the replay state-snapshot system', () => {
    // M4 hybrid replay: every entity that holds mutable state must
    // serialise/restore via `toState()`/`fromState()` so the VCR
    // scrub can rewind to any frame and resync the wind to the exact
    // pixel.
    const record = WIND_STAGE.hazards.find((h) => h.id === 'wind-rightward')!;
    const original = createWindHazardFromStageHazard(record);
    // Tick a non-zero offset.
    for (let i = 0; i < 47; i += 1) original.tick();
    const snapshot = original.toState();

    const restored = createWindHazardFromStageHazard(record);
    restored.fromState(snapshot);

    // Future observables are identical for the next full cycle.
    for (let i = 0; i < original.getCycleFrames(); i += 1) {
      expect(restored.getCurrentForce().x).toBe(original.getCurrentForce().x);
      expect(restored.isActive()).toBe(original.isActive());
      original.tick();
      restored.tick();
    }
  });
});

describe('AC 10102 Sub-AC 2 — defaults match across the renderer ↔ entity bridge', () => {
  it('createWindHazardFromStageHazard falls back to WIND_DEFAULTS when authoring fields are omitted', () => {
    // Defensive: a stage authored without the optional `forceX` /
    // `activeThreshold` (e.g. an old saved custom stage) still
    // produces a functional hazard via the canonical defaults. The
    // M3 builder relies on this so a wind piece with default tuning
    // round-trips cleanly.
    const minimalRecord: StageHazard = {
      type: 'wind',
      id: 'wind-bare',
      x: 960,
      y: 540,
      width: 800,
      height: 200,
      // Intentionally omit cycleFrames, phaseFrames, forceX, forceY,
      // activeThreshold — the bridge must fall back to defaults.
    };
    const e = createWindHazardFromStageHazard(minimalRecord);
    expect(e.getCycleFrames()).toBe(WIND_DEFAULTS.cycleFrames);
    expect(e.getPhaseFrames()).toBe(0);
    expect(e.getPeakForceX()).toBe(WIND_DEFAULTS.peakForceX);
    expect(e.getPeakForceY()).toBe(WIND_DEFAULTS.peakForceY);
    expect(e.getActiveThreshold()).toBe(WIND_DEFAULTS.activeThreshold);
  });

  it('rejects mismatched hazard types so a programmer mistake surfaces immediately', () => {
    expect(() =>
      createWindHazardFromStageHazard({
        type: 'lava',
        id: 'lava-bad',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      } as StageHazard),
    ).toThrow(/wind/);
  });
});
