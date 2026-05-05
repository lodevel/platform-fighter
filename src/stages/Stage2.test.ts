/**
 * AC 20103 Sub-AC 3 — Stage 2 module integrity tests.
 *
 * Three contracts the new `stages/Stage2.ts` module is required to
 * uphold:
 *
 *   1. Identity — `STAGE_2_ID` is `'wind'`, `STAGE_2` is reference-equal
 *      to the `WIND_STAGE` already shipped in `stageDefinitions.ts`,
 *      and `STAGE_2_DEFAULTS` is reference-equal to the underlying
 *      `WIND_STAGE_DEFAULTS`. This guarantees the AC-required
 *      `Stage2.ts` file does not split Stage 2's authoring constants
 *      across two parallel definitions.
 *
 *   2. Geometry + hazard mechanics — the Stage 2 layout exposes the
 *      same geometry + hazards the seed mandates: a solid ground anchor
 *      with pass-through floats, four spawn points strictly above the
 *      ground, a blast zone enclosing the design viewport, and two
 *      `'wind'`-typed hazards phase-offset by half a cycle so the
 *      always-safe-side property holds at every active frame.
 *
 *   3. Registered with the stage loader — `STAGES['wind']` resolves to
 *      `STAGE_2`, `getStage('wind')` returns the same reference, and
 *      the explicit `assertStage2RegisteredWithLoader()` boot helper
 *      passes without throwing. The accompanying
 *      `Stage2RegistrationError` is a typed `Error` subclass so a
 *      caller can `instanceof`-catch a registry mismatch.
 *
 * Phaser-free by design — every check operates on the pure data
 * record so the suite runs under plain Node and stays in lock-step
 * with the determinism contract the seed mandates for stage data.
 */

import { describe, it, expect } from 'vitest';
import {
  STAGE_2,
  STAGE_2_DEFAULTS,
  STAGE_2_DISPLAY_INFO,
  STAGE_2_ID,
  STAGE_2_LOADER_BINDING,
  Stage2RegistrationError,
  assertStage2RegisteredWithLoader,
  createStage2,
} from './Stage2';
import {
  STAGES,
  STAGE_DESIGN_HEIGHT,
  STAGE_DESIGN_WIDTH,
  WIND_STAGE,
  WIND_STAGE_DEFAULTS,
  getStage,
} from './stageDefinitions';
import { getPlatformBehavior } from './platformBehavior';

// ---------------------------------------------------------------------------
// 1. Identity contract
// ---------------------------------------------------------------------------

describe('AC 20103 Sub-AC 3 — Stage2 identity', () => {
  it("exposes STAGE_2_ID === 'wind' (canonical registry key)", () => {
    expect(STAGE_2_ID).toBe('wind');
  });

  it('STAGE_2 is reference-equal to WIND_STAGE (single source of truth)', () => {
    expect(STAGE_2).toBe(WIND_STAGE);
  });

  it('STAGE_2_DEFAULTS is reference-equal to WIND_STAGE_DEFAULTS', () => {
    expect(STAGE_2_DEFAULTS).toBe(WIND_STAGE_DEFAULTS);
  });

  it('STAGE_2_DISPLAY_INFO mirrors the menu entry the stage select scene surfaces', () => {
    expect(STAGE_2_DISPLAY_INFO.id).toBe(STAGE_2_ID);
    expect(STAGE_2_DISPLAY_INFO.displayName).toBe('WIND');
    // Subtitle calls out the directional-gust theme so a player
    // glancing at the menu knows what kind of hazard to expect.
    expect(STAGE_2_DISPLAY_INFO.subtitle.toLowerCase()).toMatch(
      /gust|wind|push|off-stage/,
    );
  });

  it('STAGE_2_LOADER_BINDING returns the (id, layout) tuple a future iterable loader can consume', () => {
    const [id, layout] = STAGE_2_LOADER_BINDING;
    expect(id).toBe(STAGE_2_ID);
    expect(layout).toBe(STAGE_2);
  });

  it('createStage2() with no options reproduces the canonical layout id', () => {
    const built = createStage2();
    expect(built.id).toBe(STAGE_2_ID);
    expect(built.platforms.length).toBe(STAGE_2.platforms.length);
    expect(built.hazards.length).toBe(STAGE_2.hazards.length);
    expect(built.spawnPoints.length).toBe(STAGE_2.spawnPoints.length);
  });

  it('createStage2() forwards options to the underlying wind-stage factory', () => {
    // A non-default cycle length proves the option is plumbed through
    // (and not swallowed by a mistaken `createStage2(): StageLayout`
    // wrapper that ignores `options`).
    const slow = createStage2({ windCycleFrames: 600 });
    for (const h of slow.hazards) {
      expect(h.cycleFrames).toBe(600);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Geometry + hazard mechanics contract
// ---------------------------------------------------------------------------

describe('AC 20103 Sub-AC 3 — Stage2 geometry + hazard mechanics', () => {
  it('declares an explicit behavior + stable id on every platform (replay-snapshot contract)', () => {
    for (const p of STAGE_2.platforms) {
      expect(p.behavior).toBeDefined();
      expect(['solid', 'pass-through', 'moving']).toContain(p.behavior);
      expect(typeof p.id).toBe('string');
      expect((p.id ?? '').length).toBeGreaterThan(0);
    }
    const ids = STAGE_2.platforms.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has at least one solid ground anchor and at least one pass-through float', () => {
    const solid = STAGE_2.platforms.filter(
      (p) => getPlatformBehavior(p) === 'solid',
    );
    const floats = STAGE_2.platforms.filter(
      (p) => getPlatformBehavior(p) === 'pass-through',
    );
    expect(solid.length).toBeGreaterThanOrEqual(1);
    expect(floats.length).toBeGreaterThanOrEqual(1);
  });

  it('fits every platform inside the design viewport', () => {
    for (const p of STAGE_2.platforms) {
      expect(p.x - p.width / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width / 2).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
      expect(p.y - p.height / 2).toBeGreaterThanOrEqual(0);
      expect(p.y + p.height / 2).toBeLessThanOrEqual(STAGE_DESIGN_HEIGHT);
    }
  });

  it('encloses the entire design viewport inside the blast zone (4-side KO contract)', () => {
    const z = STAGE_2.blastZone;
    expect(z.left).toBeLessThan(0);
    expect(z.right).toBeGreaterThan(STAGE_DESIGN_WIDTH);
    expect(z.top).toBeLessThan(0);
    expect(z.bottom).toBeGreaterThan(STAGE_DESIGN_HEIGHT);
  });

  it('exposes exactly four spawn points strictly above the central ground', () => {
    expect(STAGE_2.spawnPoints.length).toBe(4);
    const ground = STAGE_2.platforms.find(
      (p) => getPlatformBehavior(p) === 'solid',
    )!;
    const groundTop = ground.y - ground.height / 2;
    for (const sp of STAGE_2.spawnPoints) {
      expect(sp.y).toBeLessThan(groundTop);
      expect(sp.x).toBeGreaterThanOrEqual(0);
      expect(sp.x).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
    }
    // Unique coordinates so fighters do not stack at spawn.
    const keys = STAGE_2.spawnPoints.map((sp) => `${sp.x},${sp.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("declares two 'wind'-typed hazards (one per directional zone) with the canonical IDs", () => {
    const wind = STAGE_2.hazards.filter((h) => h.type === 'wind');
    expect(wind.length).toBe(2);
    const ids = wind.map((h) => h.id).sort();
    expect(ids).toEqual(['wind-leftward', 'wind-rightward']);
  });

  it('phase-offsets the two zones by half a cycle (always-safe-side contract)', () => {
    const left = STAGE_2.hazards.find((h) => h.id === 'wind-leftward')!;
    const right = STAGE_2.hazards.find((h) => h.id === 'wind-rightward')!;
    expect(left.cycleFrames).toBe(STAGE_2_DEFAULTS.windCycleFrames);
    expect(right.cycleFrames).toBe(STAGE_2_DEFAULTS.windCycleFrames);
    expect(left.phaseFrames).toBe(0);
    expect(right.phaseFrames).toBe(
      Math.round(0.5 * STAGE_2_DEFAULTS.windCycleFrames),
    );
  });

  it('uses matching peak-force magnitudes on both zones so the cycle balances across frames', () => {
    const left = STAGE_2.hazards.find((h) => h.id === 'wind-leftward')!;
    const right = STAGE_2.hazards.find((h) => h.id === 'wind-rightward')!;
    expect(left.forceX).toBeDefined();
    expect(right.forceX).toBeDefined();
    expect(Math.abs(left.forceX!)).toBeCloseTo(
      STAGE_2_DEFAULTS.windPeakForceX,
      6,
    );
    expect(Math.abs(right.forceX!)).toBeCloseTo(
      STAGE_2_DEFAULTS.windPeakForceX,
      6,
    );
  });

  it('positions both wind zones inside the design viewport, above the central ground', () => {
    const ground = STAGE_2.platforms.find(
      (p) => getPlatformBehavior(p) === 'solid',
    )!;
    const groundTop = ground.y - ground.height / 2;
    for (const h of STAGE_2.hazards) {
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

  it('exposes every tunable timing parameter on every hazard so the runtime entity is fully driven by the authoring record', () => {
    for (const h of STAGE_2.hazards) {
      expect(h.cycleFrames).toBe(STAGE_2_DEFAULTS.windCycleFrames);
      expect(h.activeThreshold).toBe(STAGE_2_DEFAULTS.windActiveThreshold);
      expect(h.width).toBe(STAGE_2_DEFAULTS.windZoneWidth);
      expect(h.height).toBe(STAGE_2_DEFAULTS.windZoneHeight);
      expect(Math.abs(h.forceX ?? 0)).toBeCloseTo(
        STAGE_2_DEFAULTS.windPeakForceX,
        6,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Stage-loader registration contract
// ---------------------------------------------------------------------------

describe('AC 20103 Sub-AC 3 — Stage2 registered with the stage loader', () => {
  it("STAGES['wind'] resolves to the same reference as STAGE_2", () => {
    expect(STAGES[STAGE_2_ID]).toBe(STAGE_2);
  });

  it("getStage('wind') returns the same reference (loader resolution path)", () => {
    expect(getStage(STAGE_2_ID)).toBe(STAGE_2);
  });

  it('assertStage2RegisteredWithLoader() returns STAGE_2 without throwing on the canonical registry', () => {
    expect(() => assertStage2RegisteredWithLoader()).not.toThrow();
    expect(assertStage2RegisteredWithLoader()).toBe(STAGE_2);
  });

  it('Stage2RegistrationError is an Error subclass with a stable name (catchable by callers)', () => {
    const e = new Stage2RegistrationError('boom');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(Stage2RegistrationError);
    expect(e.name).toBe('Stage2RegistrationError');
    expect(e.message).toBe('boom');
  });
});
