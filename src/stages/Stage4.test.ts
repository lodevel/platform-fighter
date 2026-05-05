/**
 * AC 20105 Sub-AC 5 — Stage 4 module integrity tests.
 *
 * Three contracts the new `stages/Stage4.ts` module is required to
 * uphold:
 *
 *   1. Identity — `STAGE_4_ID` is `'moving-platform'`, `STAGE_4` is
 *      reference-equal to the `MOVING_PLATFORM_STAGE` already shipped in
 *      `stageDefinitions.ts`, and `STAGE_4_DEFAULTS` is reference-equal
 *      to the underlying `MOVING_PLATFORM_STAGE_DEFAULTS`. This guarantees
 *      the AC-required `Stage4.ts` file does not split Stage 4's
 *      authoring constants across two parallel definitions.
 *
 *   2. Geometry + hazard mechanics — the Stage 4 layout exposes the
 *      same geometry + hazard topology the seed mandates: two solid
 *      edge anchors flanking a wide pit, two `behavior: 'moving'`
 *      kinematic carriers (one horizontal, one vertical, half a cycle
 *      apart), one `behavior: 'pass-through'` top safety platform,
 *      four spawn points strictly above the solid edges, a blast zone
 *      enclosing the design viewport, and an empty `hazards` array
 *      (the carriers' kinematics live on the platform records
 *      themselves, not in `layout.hazards`). All three behavior types
 *      appear simultaneously — the canonical "all schema types"
 *      built-in stage.
 *
 *   3. Registered with the stage loader — `STAGES['moving-platform']`
 *      resolves to `STAGE_4`, `getStage('moving-platform')` returns the
 *      same reference, and the explicit `assertStage4RegisteredWithLoader()`
 *      boot helper passes without throwing. The accompanying
 *      `Stage4RegistrationError` is a typed `Error` subclass so a
 *      caller can `instanceof`-catch a registry mismatch.
 *
 * Phaser-free by design — every check operates on the pure data
 * record so the suite runs under plain Node and stays in lock-step
 * with the determinism contract the seed mandates for stage data.
 */

import { describe, it, expect } from 'vitest';
import {
  STAGE_4,
  STAGE_4_DEFAULTS,
  STAGE_4_DISPLAY_INFO,
  STAGE_4_ID,
  STAGE_4_LOADER_BINDING,
  Stage4RegistrationError,
  assertStage4RegisteredWithLoader,
  createStage4,
} from './Stage4';
import {
  MOVING_PLATFORM_STAGE,
  MOVING_PLATFORM_STAGE_DEFAULTS,
  STAGES,
  STAGE_DESIGN_HEIGHT,
  STAGE_DESIGN_WIDTH,
  getStage,
} from './stageDefinitions';
import { getPlatformBehavior } from './platformBehavior';

// ---------------------------------------------------------------------------
// 1. Identity contract
// ---------------------------------------------------------------------------

describe('AC 20105 Sub-AC 5 — Stage4 identity', () => {
  it("exposes STAGE_4_ID === 'moving-platform' (canonical registry key)", () => {
    expect(STAGE_4_ID).toBe('moving-platform');
  });

  it('STAGE_4 is reference-equal to MOVING_PLATFORM_STAGE (single source of truth)', () => {
    expect(STAGE_4).toBe(MOVING_PLATFORM_STAGE);
  });

  it('STAGE_4_DEFAULTS is reference-equal to MOVING_PLATFORM_STAGE_DEFAULTS', () => {
    expect(STAGE_4_DEFAULTS).toBe(MOVING_PLATFORM_STAGE_DEFAULTS);
  });

  it('STAGE_4_DISPLAY_INFO mirrors the menu entry the stage select scene surfaces', () => {
    expect(STAGE_4_DISPLAY_INFO.id).toBe(STAGE_4_ID);
    expect(STAGE_4_DISPLAY_INFO.displayName).toBe('MOVING PLATFORM');
    // Subtitle calls out the ferry / platform theme so a player glancing
    // at the menu knows what kind of hazard to expect. Mirrors the exact
    // phrasing on `BUILT_IN_STAGE_ENTRIES`.
    expect(STAGE_4_DISPLAY_INFO.subtitle.toLowerCase()).toMatch(
      /ferr|platform|pit|carry|carriage|across/,
    );
  });

  it('STAGE_4_LOADER_BINDING returns the (id, layout) tuple a future iterable loader can consume', () => {
    const [id, layout] = STAGE_4_LOADER_BINDING;
    expect(id).toBe(STAGE_4_ID);
    expect(layout).toBe(STAGE_4);
  });

  it('createStage4() with no options reproduces the canonical layout id', () => {
    const built = createStage4();
    expect(built.id).toBe(STAGE_4_ID);
    expect(built.platforms.length).toBe(STAGE_4.platforms.length);
    expect(built.hazards.length).toBe(STAGE_4.hazards.length);
    expect(built.spawnPoints.length).toBe(STAGE_4.spawnPoints.length);
  });

  it('createStage4() forwards options to the underlying moving-platform-stage factory', () => {
    // A non-default horizontal cycle proves the option is plumbed
    // through (and not swallowed by a mistaken `createStage4(): StageLayout`
    // wrapper that ignores `options`).
    const fast = createStage4({ horizontalCycleFrames: 120 });
    const horizontal = fast.platforms.find((p) => p.id === 'moving-horizontal')!;
    expect(horizontal).toBeDefined();
    expect(horizontal.motion!.cycleFrames).toBe(120);
  });

  it('createStage4({ omitTopPlatform: true }) drops the safety platform', () => {
    // The omit-top variant is useful for tests that want to exercise
    // pure pit topology with no safety net.
    const bare = createStage4({ omitTopPlatform: true });
    const ids = bare.platforms.map((p) => p.id ?? '');
    expect(ids).not.toContain('moving-top-platform');
    // The two edges + two carriers must still be present.
    expect(ids).toContain('moving-edge-left');
    expect(ids).toContain('moving-edge-right');
    expect(ids).toContain('moving-horizontal');
    expect(ids).toContain('moving-vertical');
  });
});

// ---------------------------------------------------------------------------
// 2. Geometry + hazard mechanics contract
// ---------------------------------------------------------------------------

describe('AC 20105 Sub-AC 5 — Stage4 geometry + hazard mechanics', () => {
  it('declares an explicit behavior + stable id on every platform (replay-snapshot contract)', () => {
    for (const p of STAGE_4.platforms) {
      expect(p.behavior).toBeDefined();
      expect(['solid', 'pass-through', 'moving']).toContain(p.behavior);
      expect(typeof p.id).toBe('string');
      expect((p.id ?? '').length).toBeGreaterThan(0);
    }
    const ids = STAGE_4.platforms.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exercises ALL THREE behavior types (solid + pass-through + moving) in one layout', () => {
    // Stage 4 is the only built-in stage that simultaneously exercises
    // all three platform behavior types. Pin the contract here.
    const seen = new Set<string>();
    for (const p of STAGE_4.platforms) {
      seen.add(getPlatformBehavior(p));
    }
    expect(seen.has('solid')).toBe(true);
    expect(seen.has('pass-through')).toBe(true);
    expect(seen.has('moving')).toBe(true);
  });

  it('has at least two solid edge anchors and at least two moving carriers', () => {
    const solid = STAGE_4.platforms.filter(
      (p) => getPlatformBehavior(p) === 'solid',
    );
    const moving = STAGE_4.platforms.filter(
      (p) => getPlatformBehavior(p) === 'moving',
    );
    // Two solid edges flank the pit so fighters always have stable
    // ground regardless of carrier position.
    expect(solid.length).toBeGreaterThanOrEqual(2);
    // Two kinematic carriers ferry fighters across the pit + offer a
    // staggered vertical recovery route — the defining hazard pair.
    expect(moving.length).toBeGreaterThanOrEqual(2);
  });

  it('exposes the canonical moving-edge-* / moving-* platform IDs', () => {
    // The renderer + replay snapshot system look up platforms by these
    // stable IDs. If they ever drift (typo, rename, missing entry) the
    // motion engine silently leaves a carrier without a matching binder
    // and the player gets a non-moving "stuck" carriage. Pin the IDs
    // here.
    const ids = STAGE_4.platforms.map((p) => p.id ?? '');
    expect(ids).toContain('moving-edge-left');
    expect(ids).toContain('moving-edge-right');
    expect(ids).toContain('moving-horizontal');
    expect(ids).toContain('moving-vertical');
    expect(ids).toContain('moving-top-platform');
  });

  it('declares both edges as solid, both carriers as moving, and the safety platform as pass-through', () => {
    const expected: ReadonlyArray<readonly [string, string]> = [
      ['moving-edge-left', 'solid'],
      ['moving-edge-right', 'solid'],
      ['moving-horizontal', 'moving'],
      ['moving-vertical', 'moving'],
      ['moving-top-platform', 'pass-through'],
    ];
    for (const [id, behavior] of expected) {
      const p = STAGE_4.platforms.find((q) => q.id === id);
      expect(p, `platform '${id}' missing`).toBeDefined();
      expect(getPlatformBehavior(p!)).toBe(behavior);
    }
  });

  it('attaches a motion record to every moving carrier (kinematic schema contract)', () => {
    const carriers = STAGE_4.platforms.filter(
      (p) => getPlatformBehavior(p) === 'moving',
    );
    expect(carriers.length).toBeGreaterThanOrEqual(2);
    for (const c of carriers) {
      expect(c.motion).toBeDefined();
      expect(c.motion!.waypoints.length).toBeGreaterThanOrEqual(2);
      expect(Number.isInteger(c.motion!.cycleFrames)).toBe(true);
      expect(c.motion!.cycleFrames).toBeGreaterThanOrEqual(2);
    }
  });

  it('fits every platform inside the design viewport (at base / un-offset position)', () => {
    for (const p of STAGE_4.platforms) {
      expect(p.x - p.width / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width / 2).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
      expect(p.y - p.height / 2).toBeGreaterThanOrEqual(0);
      expect(p.y + p.height / 2).toBeLessThanOrEqual(STAGE_DESIGN_HEIGHT);
    }
  });

  it('encloses the entire design viewport inside the blast zone (4-side KO contract)', () => {
    const z = STAGE_4.blastZone;
    expect(z.left).toBeLessThan(0);
    expect(z.right).toBeGreaterThan(STAGE_DESIGN_WIDTH);
    expect(z.top).toBeLessThan(0);
    expect(z.bottom).toBeGreaterThan(STAGE_DESIGN_HEIGHT);
  });

  it('exposes exactly four spawn points strictly above some solid edge', () => {
    expect(STAGE_4.spawnPoints.length).toBe(4);
    const solids = STAGE_4.platforms.filter(
      (p) => getPlatformBehavior(p) === 'solid',
    );
    expect(solids.length).toBeGreaterThanOrEqual(2);
    for (const sp of STAGE_4.spawnPoints) {
      const aboveSomeEdge = solids.some((edge) => {
        const top = edge.y - edge.height / 2;
        const left = edge.x - edge.width / 2;
        const right = edge.x + edge.width / 2;
        return sp.y < top && sp.x >= left && sp.x <= right;
      });
      expect(
        aboveSomeEdge,
        `spawn (${sp.x}, ${sp.y}) is not above any solid edge`,
      ).toBe(true);
      expect(sp.x).toBeGreaterThanOrEqual(0);
      expect(sp.x).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
    }
    // Unique coordinates so fighters do not stack at spawn.
    const keys = STAGE_4.spawnPoints.map((sp) => `${sp.x},${sp.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("declares NO entries in `layout.hazards` (the carriers ARE the hazard, declared on the platforms array)", () => {
    // Intentional design choice: lava + wind own a `StageHazard`
    // record because they're geometry-distinct from any platform;
    // moving carriers ARE platforms, so the M3 stage builder
    // serializes them through the `platforms` array. The runtime
    // layer composes `computeMovingPlatformOffset(motion, frame)`
    // each fixed step from the platform's own `motion` field.
    expect(STAGE_4.hazards).toEqual([]);
  });

  it('separates the two edges by a wide pit (moving carriers ferry across)', () => {
    // The whole point of the stage is the gap between the two solid
    // edges. If the layout ever collapses the gap (or worse, lets the
    // edges overlap) the carriers' purpose evaporates. Pin the
    // separation so a future tweak that breaks it trips this test.
    const left = STAGE_4.platforms.find((p) => p.id === 'moving-edge-left')!;
    const right = STAGE_4.platforms.find((p) => p.id === 'moving-edge-right')!;
    const leftRight = left.x + left.width / 2;
    const rightLeft = right.x - right.width / 2;
    expect(rightLeft - leftRight).toBeGreaterThan(0);
    const horizontal = STAGE_4.platforms.find(
      (p) => p.id === 'moving-horizontal',
    )!;
    expect(rightLeft - leftRight).toBeGreaterThan(horizontal.width);
  });

  it('staggers the two carriers by half a cycle (always-safe-ride contract)', () => {
    const horizontal = STAGE_4.platforms.find(
      (p) => p.id === 'moving-horizontal',
    )!;
    const vertical = STAGE_4.platforms.find((p) => p.id === 'moving-vertical')!;
    expect(horizontal.motion!.phaseFrames).toBe(0);
    expect(vertical.motion!.phaseFrames).toBe(
      Math.round(STAGE_4_DEFAULTS.verticalCycleFrames / 2),
    );
  });

  it('sends the horizontal carrier on a pure-X path and the vertical carrier on a pure-Y path', () => {
    // Axis-distinct recovery routes — horizontal ferries across the
    // pit, vertical rises and falls. If their axes ever crossed the
    // recovery puzzle would lose its identity.
    const horizontal = STAGE_4.platforms.find(
      (p) => p.id === 'moving-horizontal',
    )!;
    const vertical = STAGE_4.platforms.find((p) => p.id === 'moving-vertical')!;
    const hSecond = horizontal.motion!.waypoints[1]!;
    expect(hSecond.x).not.toBe(0);
    expect(hSecond.y).toBe(0);
    const vSecond = vertical.motion!.waypoints[1]!;
    expect(vSecond.x).toBe(0);
    expect(vSecond.y).not.toBe(0);
    // Vertical carrier travels upward (negative Y).
    expect(vSecond.y).toBeLessThan(0);
  });

  it('uses the canonical default edge dimensions (single source of truth check)', () => {
    const leftEdge = STAGE_4.platforms.find((p) => p.id === 'moving-edge-left')!;
    expect(leftEdge.width).toBe(STAGE_4_DEFAULTS.edgeWidth);
    expect(leftEdge.height).toBe(STAGE_4_DEFAULTS.edgeHeight);
    const rightEdge = STAGE_4.platforms.find(
      (p) => p.id === 'moving-edge-right',
    )!;
    expect(rightEdge.width).toBe(STAGE_4_DEFAULTS.edgeWidth);
    expect(rightEdge.height).toBe(STAGE_4_DEFAULTS.edgeHeight);
  });

  it('uses the canonical default carrier dimensions on every moving platform', () => {
    const carriers = STAGE_4.platforms.filter(
      (p) => getPlatformBehavior(p) === 'moving',
    );
    for (const c of carriers) {
      expect(c.width).toBe(STAGE_4_DEFAULTS.movingWidth);
      expect(c.height).toBe(STAGE_4_DEFAULTS.movingHeight);
    }
  });

  it('uses the canonical default cycle frames on the two carriers', () => {
    const horizontal = STAGE_4.platforms.find(
      (p) => p.id === 'moving-horizontal',
    )!;
    const vertical = STAGE_4.platforms.find((p) => p.id === 'moving-vertical')!;
    expect(horizontal.motion!.cycleFrames).toBe(
      STAGE_4_DEFAULTS.horizontalCycleFrames,
    );
    expect(vertical.motion!.cycleFrames).toBe(
      STAGE_4_DEFAULTS.verticalCycleFrames,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Stage-loader registration contract
// ---------------------------------------------------------------------------

describe('AC 20105 Sub-AC 5 — Stage4 registered with the stage loader', () => {
  it("STAGES['moving-platform'] resolves to the same reference as STAGE_4", () => {
    expect(STAGES[STAGE_4_ID]).toBe(STAGE_4);
  });

  it("getStage('moving-platform') returns the same reference (loader resolution path)", () => {
    expect(getStage(STAGE_4_ID)).toBe(STAGE_4);
  });

  it('assertStage4RegisteredWithLoader() returns STAGE_4 without throwing on the canonical registry', () => {
    expect(() => assertStage4RegisteredWithLoader()).not.toThrow();
    expect(assertStage4RegisteredWithLoader()).toBe(STAGE_4);
  });

  it('Stage4RegistrationError is an Error subclass with a stable name (catchable by callers)', () => {
    const e = new Stage4RegistrationError('boom');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(Stage4RegistrationError);
    expect(e.name).toBe('Stage4RegistrationError');
    expect(e.message).toBe('boom');
  });
});
