/**
 * AC 20104 Sub-AC 4 — Stage 3 module integrity tests.
 *
 * Three contracts the new `stages/Stage3.ts` module is required to
 * uphold:
 *
 *   1. Identity — `STAGE_3_ID` is `'crumbling'`, `STAGE_3` is
 *      reference-equal to the `CRUMBLING_STAGE` already shipped in
 *      `stageDefinitions.ts`, and `STAGE_3_DEFAULTS` is reference-equal
 *      to the underlying `CRUMBLING_STAGE_DEFAULTS`. This guarantees
 *      the AC-required `Stage3.ts` file does not split Stage 3's
 *      authoring constants across two parallel definitions.
 *
 *   2. Geometry + hazard mechanics — the Stage 3 layout exposes the
 *      same geometry + hazard topology the seed mandates: a slim solid
 *      ground anchor with four pass-through *crumbling* floats arranged
 *      in two rows (lower and upper), four spawn points strictly above
 *      the central ground, a blast zone enclosing the design viewport,
 *      and an empty `hazards` array (the crumble lifecycle lives on
 *      the platform records themselves, not in `layout.hazards`).
 *
 *   3. Registered with the stage loader — `STAGES['crumbling']`
 *      resolves to `STAGE_3`, `getStage('crumbling')` returns the same
 *      reference, and the explicit `assertStage3RegisteredWithLoader()`
 *      boot helper passes without throwing. The accompanying
 *      `Stage3RegistrationError` is a typed `Error` subclass so a
 *      caller can `instanceof`-catch a registry mismatch.
 *
 * Phaser-free by design — every check operates on the pure data
 * record so the suite runs under plain Node and stays in lock-step
 * with the determinism contract the seed mandates for stage data.
 */

import { describe, it, expect } from 'vitest';
import {
  STAGE_3,
  STAGE_3_DEFAULTS,
  STAGE_3_DISPLAY_INFO,
  STAGE_3_ID,
  STAGE_3_LOADER_BINDING,
  Stage3RegistrationError,
  assertStage3RegisteredWithLoader,
  createStage3,
} from './Stage3';
import {
  CRUMBLING_STAGE,
  CRUMBLING_STAGE_DEFAULTS,
  STAGES,
  STAGE_DESIGN_HEIGHT,
  STAGE_DESIGN_WIDTH,
  getStage,
} from './stageDefinitions';
import { getPlatformBehavior } from './platformBehavior';

// ---------------------------------------------------------------------------
// 1. Identity contract
// ---------------------------------------------------------------------------

describe('AC 20104 Sub-AC 4 — Stage3 identity', () => {
  it("exposes STAGE_3_ID === 'crumbling' (canonical registry key)", () => {
    expect(STAGE_3_ID).toBe('crumbling');
  });

  it('STAGE_3 is reference-equal to CRUMBLING_STAGE (single source of truth)', () => {
    expect(STAGE_3).toBe(CRUMBLING_STAGE);
  });

  it('STAGE_3_DEFAULTS is reference-equal to CRUMBLING_STAGE_DEFAULTS', () => {
    expect(STAGE_3_DEFAULTS).toBe(CRUMBLING_STAGE_DEFAULTS);
  });

  it('STAGE_3_DISPLAY_INFO mirrors the menu entry the stage select scene surfaces', () => {
    expect(STAGE_3_DISPLAY_INFO.id).toBe(STAGE_3_ID);
    expect(STAGE_3_DISPLAY_INFO.displayName).toBe('CRUMBLING');
    // Subtitle calls out the step-on-trigger / falling-floor theme so
    // a player glancing at the menu knows what kind of hazard to
    // expect. Mirrors the exact phrasing on `BUILT_IN_STAGE_ENTRIES`.
    expect(STAGE_3_DISPLAY_INFO.subtitle.toLowerCase()).toMatch(
      /floor|crumb|step|fall/,
    );
  });

  it('STAGE_3_LOADER_BINDING returns the (id, layout) tuple a future iterable loader can consume', () => {
    const [id, layout] = STAGE_3_LOADER_BINDING;
    expect(id).toBe(STAGE_3_ID);
    expect(layout).toBe(STAGE_3);
  });

  it('createStage3() with no options reproduces the canonical layout id', () => {
    const built = createStage3();
    expect(built.id).toBe(STAGE_3_ID);
    expect(built.platforms.length).toBe(STAGE_3.platforms.length);
    expect(built.hazards.length).toBe(STAGE_3.hazards.length);
    expect(built.spawnPoints.length).toBe(STAGE_3.spawnPoints.length);
  });

  it('createStage3() forwards options to the underlying crumbling-stage factory', () => {
    // A non-default ground width proves the option is plumbed through
    // (and not swallowed by a mistaken `createStage3(): StageLayout`
    // wrapper that ignores `options`).
    const wide = createStage3({ groundWidth: 1200 });
    const ground = wide.platforms.find((p) => p.id === 'crumble-ground')!;
    expect(ground).toBeDefined();
    expect(ground.width).toBe(1200);
  });

  it('createStage3({ omitCrumblingFloats: true }) yields a bare ground topology', () => {
    // The bare-ground variant is useful for tests that want to
    // exercise the central anchor without any crumble lifecycle.
    const bare = createStage3({ omitCrumblingFloats: true });
    expect(bare.platforms.length).toBe(1);
    expect(bare.platforms[0]?.id).toBe('crumble-ground');
  });
});

// ---------------------------------------------------------------------------
// 2. Geometry + hazard mechanics contract
// ---------------------------------------------------------------------------

describe('AC 20104 Sub-AC 4 — Stage3 geometry + hazard mechanics', () => {
  it('declares an explicit behavior + stable id on every platform (replay-snapshot contract)', () => {
    for (const p of STAGE_3.platforms) {
      expect(p.behavior).toBeDefined();
      expect(['solid', 'pass-through', 'moving']).toContain(p.behavior);
      expect(typeof p.id).toBe('string');
      expect((p.id ?? '').length).toBeGreaterThan(0);
    }
    const ids = STAGE_3.platforms.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has at least one solid ground anchor and at least four pass-through crumbling floats', () => {
    const solid = STAGE_3.platforms.filter(
      (p) => getPlatformBehavior(p) === 'solid',
    );
    const floats = STAGE_3.platforms.filter(
      (p) => getPlatformBehavior(p) === 'pass-through',
    );
    expect(solid.length).toBeGreaterThanOrEqual(1);
    // Stage 3's defining feature: four crumbling floats in a 2-row
    // layout. Anything less and the recovery puzzle disintegrates.
    expect(floats.length).toBeGreaterThanOrEqual(4);
  });

  it('exposes the canonical crumble-* platform IDs (ground + 4 floats)', () => {
    // The runtime crumble adapter looks up entities by these stable
    // IDs. If they ever drift (typo, rename, missing entry) the
    // adapter silently leaves a platform without lifecycle behaviour
    // and the player gets a non-falling "crumbler". Pin the IDs here.
    const ids = STAGE_3.platforms.map((p) => p.id ?? '');
    expect(ids).toContain('crumble-ground');
    expect(ids).toContain('crumble-lower-left');
    expect(ids).toContain('crumble-lower-right');
    expect(ids).toContain('crumble-upper-left');
    expect(ids).toContain('crumble-upper-right');
  });

  it('declares the central anchor as solid and every other crumble-* platform as pass-through', () => {
    const ground = STAGE_3.platforms.find((p) => p.id === 'crumble-ground')!;
    expect(getPlatformBehavior(ground)).toBe('solid');
    const crumblers = STAGE_3.platforms.filter(
      (p) =>
        (p.id ?? '').startsWith('crumble-') && p.id !== 'crumble-ground',
    );
    expect(crumblers.length).toBeGreaterThanOrEqual(4);
    for (const c of crumblers) {
      expect(getPlatformBehavior(c)).toBe('pass-through');
    }
  });

  it('fits every platform inside the design viewport', () => {
    for (const p of STAGE_3.platforms) {
      expect(p.x - p.width / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width / 2).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
      expect(p.y - p.height / 2).toBeGreaterThanOrEqual(0);
      expect(p.y + p.height / 2).toBeLessThanOrEqual(STAGE_DESIGN_HEIGHT);
    }
  });

  it('encloses the entire design viewport inside the blast zone (4-side KO contract)', () => {
    const z = STAGE_3.blastZone;
    expect(z.left).toBeLessThan(0);
    expect(z.right).toBeGreaterThan(STAGE_DESIGN_WIDTH);
    expect(z.top).toBeLessThan(0);
    expect(z.bottom).toBeGreaterThan(STAGE_DESIGN_HEIGHT);
  });

  it('exposes exactly four spawn points strictly above the central ground', () => {
    expect(STAGE_3.spawnPoints.length).toBe(4);
    const ground = STAGE_3.platforms.find(
      (p) => getPlatformBehavior(p) === 'solid',
    )!;
    const groundTop = ground.y - ground.height / 2;
    for (const sp of STAGE_3.spawnPoints) {
      expect(sp.y).toBeLessThan(groundTop);
      expect(sp.x).toBeGreaterThanOrEqual(0);
      expect(sp.x).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
    }
    // Unique coordinates so fighters do not stack at spawn.
    const keys = STAGE_3.spawnPoints.map((sp) => `${sp.x},${sp.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("declares NO entries in `layout.hazards` (the crumble lifecycle lives on the platforms themselves)", () => {
    // Intentional design choice: lava + wind own a `StageHazard`
    // record because they're geometry-distinct from any platform;
    // crumblers ARE platforms, so the M3 stage builder serializes
    // them through the `platforms` array. The runtime layer attaches
    // a `CrumblingPlatform` entity per platform `id` at match start.
    expect(STAGE_3.hazards).toEqual([]);
  });

  it('places the upper crumble row strictly above the lower crumble row (recovery topology)', () => {
    // The lower row is the "easy hop" path; the upper row is the
    // "recovery route" further out. If their vertical ordering ever
    // flipped the recovery topology would invert and the level
    // playtests would all break.
    const lowerLeft = STAGE_3.platforms.find(
      (p) => p.id === 'crumble-lower-left',
    )!;
    const upperLeft = STAGE_3.platforms.find(
      (p) => p.id === 'crumble-upper-left',
    )!;
    const lowerRight = STAGE_3.platforms.find(
      (p) => p.id === 'crumble-lower-right',
    )!;
    const upperRight = STAGE_3.platforms.find(
      (p) => p.id === 'crumble-upper-right',
    )!;
    // Smaller y == higher on screen.
    expect(upperLeft.y).toBeLessThan(lowerLeft.y);
    expect(upperRight.y).toBeLessThan(lowerRight.y);
  });

  it('mirrors the lower / upper row horizontally across the screen centre', () => {
    // Symmetry contract — the crumble layout is the same on the left
    // and the right so neither side has a recovery advantage.
    const cx = STAGE_DESIGN_WIDTH / 2;
    const lowerLeft = STAGE_3.platforms.find(
      (p) => p.id === 'crumble-lower-left',
    )!;
    const lowerRight = STAGE_3.platforms.find(
      (p) => p.id === 'crumble-lower-right',
    )!;
    const upperLeft = STAGE_3.platforms.find(
      (p) => p.id === 'crumble-upper-left',
    )!;
    const upperRight = STAGE_3.platforms.find(
      (p) => p.id === 'crumble-upper-right',
    )!;
    expect(cx - lowerLeft.x).toBeCloseTo(lowerRight.x - cx, 6);
    expect(cx - upperLeft.x).toBeCloseTo(upperRight.x - cx, 6);
    // Lower row sits inside the upper row (the upper row is the
    // outer / recovery row by design).
    expect(Math.abs(cx - lowerLeft.x)).toBeLessThan(
      Math.abs(cx - upperLeft.x),
    );
    expect(Math.abs(cx - lowerRight.x)).toBeLessThan(
      Math.abs(cx - upperRight.x),
    );
  });

  it('uses the canonical default ground dimensions (single source of truth check)', () => {
    const ground = STAGE_3.platforms.find((p) => p.id === 'crumble-ground')!;
    expect(ground.width).toBe(STAGE_3_DEFAULTS.groundWidth);
    expect(ground.height).toBe(STAGE_3_DEFAULTS.groundHeight);
  });

  it('uses the canonical default float dimensions on every crumbling float', () => {
    const crumblers = STAGE_3.platforms.filter(
      (p) =>
        (p.id ?? '').startsWith('crumble-') && p.id !== 'crumble-ground',
    );
    for (const c of crumblers) {
      expect(c.width).toBe(STAGE_3_DEFAULTS.floatWidth);
      expect(c.height).toBe(STAGE_3_DEFAULTS.floatHeight);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Stage-loader registration contract
// ---------------------------------------------------------------------------

describe('AC 20104 Sub-AC 4 — Stage3 registered with the stage loader', () => {
  it("STAGES['crumbling'] resolves to the same reference as STAGE_3", () => {
    expect(STAGES[STAGE_3_ID]).toBe(STAGE_3);
  });

  it("getStage('crumbling') returns the same reference (loader resolution path)", () => {
    expect(getStage(STAGE_3_ID)).toBe(STAGE_3);
  });

  it('assertStage3RegisteredWithLoader() returns STAGE_3 without throwing on the canonical registry', () => {
    expect(() => assertStage3RegisteredWithLoader()).not.toThrow();
    expect(assertStage3RegisteredWithLoader()).toBe(STAGE_3);
  });

  it('Stage3RegistrationError is an Error subclass with a stable name (catchable by callers)', () => {
    const e = new Stage3RegistrationError('boom');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(Stage3RegistrationError);
    expect(e.name).toBe('Stage3RegistrationError');
    expect(e.message).toBe('boom');
  });
});
