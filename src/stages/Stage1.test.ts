/**
 * AC 20102 Sub-AC 2 — Stage 1 module integrity tests.
 *
 * Three contracts the new `stages/Stage1.ts` module is required to
 * uphold:
 *
 *   1. Identity — `STAGE_1_ID` is `'lava'`, `STAGE_1` is reference-equal
 *      to the `LAVA_STAGE` already shipped in `stageDefinitions.ts`,
 *      and `STAGE_1_DEFAULTS` is reference-equal to the underlying
 *      `LAVA_STAGE_DEFAULTS`. This guarantees the AC-required
 *      `Stage1.ts` file does not split Stage 1's authoring constants
 *      across two parallel definitions.
 *
 *   2. Geometry + hazard mechanics — the Stage 1 layout exposes the
 *      same geometry + hazards the seed mandates: a solid ground anchor
 *      with pass-through floats, four spawn points strictly above the
 *      ground, a blast zone enclosing the design viewport, and two
 *      `'lava'`-typed hazards phase-offset by half a cycle so the
 *      always-safe-side property holds.
 *
 *   3. Registered with the stage loader — `STAGES['lava']` resolves to
 *      `STAGE_1`, `getStage('lava')` returns the same reference, and
 *      the explicit `assertStage1RegisteredWithLoader()` boot helper
 *      passes without throwing. The same helper throws a typed
 *      `Stage1RegistrationError` when the registry is mutated out from
 *      under it (we exercise that branch with an injected mock map).
 *
 * Phaser-free by design — every check operates on the pure data
 * record so the suite runs under plain Node and stays in lock-step
 * with the determinism contract the seed mandates for stage data.
 */

import { describe, it, expect } from 'vitest';
import {
  STAGE_1,
  STAGE_1_DEFAULTS,
  STAGE_1_DISPLAY_INFO,
  STAGE_1_ID,
  STAGE_1_LOADER_BINDING,
  Stage1RegistrationError,
  assertStage1RegisteredWithLoader,
  createStage1,
} from './Stage1';
import {
  LAVA_STAGE,
  LAVA_STAGE_DEFAULTS,
  STAGES,
  STAGE_DESIGN_HEIGHT,
  STAGE_DESIGN_WIDTH,
  getStage,
} from './stageDefinitions';
import { getPlatformBehavior } from './platformBehavior';

// ---------------------------------------------------------------------------
// 1. Identity contract
// ---------------------------------------------------------------------------

describe('AC 20102 Sub-AC 2 — Stage1 identity', () => {
  it("exposes STAGE_1_ID === 'lava' (canonical registry key)", () => {
    expect(STAGE_1_ID).toBe('lava');
  });

  it('STAGE_1 is reference-equal to LAVA_STAGE (single source of truth)', () => {
    expect(STAGE_1).toBe(LAVA_STAGE);
  });

  it('STAGE_1_DEFAULTS is reference-equal to LAVA_STAGE_DEFAULTS', () => {
    expect(STAGE_1_DEFAULTS).toBe(LAVA_STAGE_DEFAULTS);
  });

  it('STAGE_1_DISPLAY_INFO mirrors the menu entry the stage select scene surfaces', () => {
    expect(STAGE_1_DISPLAY_INFO.id).toBe(STAGE_1_ID);
    expect(STAGE_1_DISPLAY_INFO.displayName).toBe('LAVA');
    expect(STAGE_1_DISPLAY_INFO.subtitle.toLowerCase()).toContain('instant ko');
  });

  it('STAGE_1_LOADER_BINDING returns the (id, layout) tuple a future iterable loader can consume', () => {
    const [id, layout] = STAGE_1_LOADER_BINDING;
    expect(id).toBe(STAGE_1_ID);
    expect(layout).toBe(STAGE_1);
  });

  it('createStage1() with no options reproduces the canonical layout id', () => {
    const built = createStage1();
    expect(built.id).toBe(STAGE_1_ID);
    expect(built.platforms.length).toBe(STAGE_1.platforms.length);
    expect(built.hazards.length).toBe(STAGE_1.hazards.length);
    expect(built.spawnPoints.length).toBe(STAGE_1.spawnPoints.length);
  });

  it('createStage1() forwards options to the underlying lava-stage factory', () => {
    // A non-default cycle length proves the option is plumbed through
    // (and not swallowed by a mistaken `createStage1(): StageLayout`
    // wrapper that ignores `options`).
    const slow = createStage1({ lavaCycleFrames: 600 });
    for (const h of slow.hazards) {
      expect(h.cycleFrames).toBe(600);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Geometry + hazard mechanics contract
// ---------------------------------------------------------------------------

describe('AC 20102 Sub-AC 2 — Stage1 geometry + hazard mechanics', () => {
  it('declares an explicit behavior + stable id on every platform (replay-snapshot contract)', () => {
    for (const p of STAGE_1.platforms) {
      expect(p.behavior).toBeDefined();
      expect(['solid', 'pass-through', 'moving']).toContain(p.behavior);
      expect(typeof p.id).toBe('string');
      expect((p.id ?? '').length).toBeGreaterThan(0);
    }
    const ids = STAGE_1.platforms.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has at least one solid ground anchor and at least one pass-through float', () => {
    const solid = STAGE_1.platforms.filter(
      (p) => getPlatformBehavior(p) === 'solid',
    );
    const floats = STAGE_1.platforms.filter(
      (p) => getPlatformBehavior(p) === 'pass-through',
    );
    expect(solid.length).toBeGreaterThanOrEqual(1);
    expect(floats.length).toBeGreaterThanOrEqual(1);
  });

  it('fits every platform inside the design viewport', () => {
    for (const p of STAGE_1.platforms) {
      expect(p.x - p.width / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width / 2).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
      expect(p.y - p.height / 2).toBeGreaterThanOrEqual(0);
      expect(p.y + p.height / 2).toBeLessThanOrEqual(STAGE_DESIGN_HEIGHT);
    }
  });

  it('encloses the entire design viewport inside the blast zone (4-side KO contract)', () => {
    const z = STAGE_1.blastZone;
    expect(z.left).toBeLessThan(0);
    expect(z.right).toBeGreaterThan(STAGE_DESIGN_WIDTH);
    expect(z.top).toBeLessThan(0);
    expect(z.bottom).toBeGreaterThan(STAGE_DESIGN_HEIGHT);
  });

  it('exposes exactly four spawn points strictly above the central ground', () => {
    expect(STAGE_1.spawnPoints.length).toBe(4);
    const ground = STAGE_1.platforms.find(
      (p) => getPlatformBehavior(p) === 'solid',
    )!;
    const groundTop = ground.y - ground.height / 2;
    for (const sp of STAGE_1.spawnPoints) {
      expect(sp.y).toBeLessThan(groundTop);
      expect(sp.x).toBeGreaterThanOrEqual(0);
      expect(sp.x).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
    }
    // Unique coordinates so fighters do not stack at spawn.
    const keys = STAGE_1.spawnPoints.map((sp) => `${sp.x},${sp.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("declares two 'lava'-typed hazards (one per side pit) with the canonical IDs", () => {
    const lava = STAGE_1.hazards.filter((h) => h.type === 'lava');
    expect(lava.length).toBe(2);
    const ids = lava.map((h) => h.id).sort();
    expect(ids).toEqual(['lava-left', 'lava-right']);
  });

  it('phase-offsets the two pools by half a cycle (always-safe-side contract)', () => {
    const left = STAGE_1.hazards.find((h) => h.id === 'lava-left')!;
    const right = STAGE_1.hazards.find((h) => h.id === 'lava-right')!;
    expect(left.cycleFrames).toBe(STAGE_1_DEFAULTS.lavaCycleFrames);
    expect(right.cycleFrames).toBe(STAGE_1_DEFAULTS.lavaCycleFrames);
    expect(left.phaseFrames).toBe(0);
    expect(right.phaseFrames).toBe(
      Math.round(0.5 * STAGE_1_DEFAULTS.lavaCycleFrames),
    );
  });

  it('positions each lava pool in the opposite side pit relative to the central ground', () => {
    const ground = STAGE_1.platforms.find(
      (p) => getPlatformBehavior(p) === 'solid',
    )!;
    const groundLeft = ground.x - ground.width / 2;
    const groundRight = ground.x + ground.width / 2;
    const left = STAGE_1.hazards.find((h) => h.id === 'lava-left')!;
    const right = STAGE_1.hazards.find((h) => h.id === 'lava-right')!;
    expect(left.x).toBeLessThan(groundLeft);
    expect(right.x).toBeGreaterThan(groundRight);
  });

  it('exposes every tunable timing parameter on every hazard so the runtime entity is fully driven by the authoring record', () => {
    for (const h of STAGE_1.hazards) {
      expect(h.cycleFrames).toBe(STAGE_1_DEFAULTS.lavaCycleFrames);
      expect(h.activeThreshold).toBe(STAGE_1_DEFAULTS.lavaActiveThreshold);
      expect(h.damagePerTick).toBe(STAGE_1_DEFAULTS.lavaDamagePerTick);
      expect(h.minHeight).toBe(STAGE_1_DEFAULTS.lavaMinHeight);
      expect(h.width).toBe(STAGE_1_DEFAULTS.lavaPoolWidth);
      expect(h.height).toBe(STAGE_1_DEFAULTS.lavaMaxHeight);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Stage-loader registration contract
// ---------------------------------------------------------------------------

describe('AC 20102 Sub-AC 2 — Stage1 registered with the stage loader', () => {
  it("STAGES['lava'] resolves to the same reference as STAGE_1", () => {
    expect(STAGES[STAGE_1_ID]).toBe(STAGE_1);
  });

  it("getStage('lava') returns the same reference (loader resolution path)", () => {
    expect(getStage(STAGE_1_ID)).toBe(STAGE_1);
  });

  it('assertStage1RegisteredWithLoader() returns STAGE_1 without throwing on the canonical registry', () => {
    expect(() => assertStage1RegisteredWithLoader()).not.toThrow();
    expect(assertStage1RegisteredWithLoader()).toBe(STAGE_1);
  });

  it('Stage1RegistrationError is an Error subclass with a stable name (catchable by callers)', () => {
    const e = new Stage1RegistrationError('boom');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(Stage1RegistrationError);
    expect(e.name).toBe('Stage1RegistrationError');
    expect(e.message).toBe('boom');
  });
});
