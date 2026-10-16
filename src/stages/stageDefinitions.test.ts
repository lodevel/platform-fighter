import { describe, it, expect } from 'vitest';
import {
  FLAT_STAGE,
  FLAT_STAGE_DEFAULTS,
  LAVA_STAGE,
  LAVA_STAGE_DEFAULTS,
  WIND_STAGE,
  WIND_STAGE_DEFAULTS,
  CRUMBLING_STAGE,
  CRUMBLING_STAGE_DEFAULTS,
  MOVING_PLATFORM_STAGE,
  MOVING_PLATFORM_STAGE_DEFAULTS,
  INFERNO_STAGE,
  STAGES,
  STAGE_DESIGN_WIDTH,
  STAGE_DESIGN_HEIGHT,
  createFlatStage,
  createLavaStage,
  createWindStage,
  createCrumblingStage,
  createMovingPlatformStage,
  getStage,
} from './stageDefinitions';
import {
  getPlatformBehavior,
  validateStagePlatform,
} from './platformBehavior';

/**
 * The flat stage is the only built-in stage in M1. Tests here lock
 * down the layout invariants that the renderer + character controller
 * depend on:
 *   - There is at least one solid ground platform and at least one
 *     pass-through floating platform (the AC literally requires both).
 *   - Every platform fits inside the design viewport.
 *   - Default surfaces and blast distances use the fighter-data scale.
 *   - The blast zone encloses playable geometry, including custom floors.
 *   - Spawn points sit above the highest non-pass-through platform so
 *     characters always drop onto solid ground.
 *   - Up to 4 spawn points exist (matches `GAME_CONFIG.maxPlayers`).
 */
describe('FLAT_STAGE — flat stage layout invariants', () => {
  it('widens the floor and side spacing while retaining reference vertical geometry', () => {
    // Independent expected coordinates from the extracted Battlefield LVD,
    // plus the explicit gameplay calibration (1180 px floor, 100 px side spread).
    const ground = FLAT_STAGE.platforms.find((p) => !p.passThrough)!;
    const groundTop = ground.y - ground.height / 2;
    expect(ground.width).toBe(1180);
    expect(groundTop).toBe(930);
    expect(ground.height).toBe(80); // Project collider depth, not the LVD shape.

    const floats = FLAT_STAGE.platforms.filter((p) => p.passThrough);
    expect(floats).toHaveLength(3);
    const expectedSurfaces = [
      { x: 960 + ((-59.422 + -24.789) / 2) * 5 - 100, height: 24.119 * 5 },
      { x: 960 + ((24.789 + 59.42199) / 2) * 5 + 100, height: 24.119 * 5 },
      { x: 960, height: 47.189003 * 5 },
    ];
    for (const [index, platform] of floats.entries()) {
      const surface = expectedSurfaces[index]!;
      expect(platform.x).toBeCloseTo(surface.x, 3);
      expect(platform.width).toBeCloseTo(34.633 * 5, 3);
      expect(groundTop - (platform.y - platform.height / 2)).toBeCloseTo(
        surface.height,
        3,
      );
      expect(platform.height).toBe(24); // Project pass-through collider thickness.
    }
  });

  it('retains Battlefield offstage margins and vertical blast distances', () => {
    const ground = FLAT_STAGE.platforms.find((p) => !p.passThrough)!;
    const groundTop = ground.y - ground.height / 2;
    const z = FLAT_STAGE.blastZone;
    expect(ground.x - ground.width / 2 - z.left).toBe(160 * 5);
    expect(z.right - ground.x - ground.width / 2).toBe(160 * 5);
    expect(groundTop - z.top).toBe(192 * 5);
    expect(z.bottom - groundTop).toBe(140 * 5);
    expect(z.right - z.left).toBe(2780);
    expect(z.top).toBe(-30);
  });

  it('has both a solid ground platform and floating pass-through platforms', () => {
    const solid = FLAT_STAGE.platforms.filter((p) => !p.passThrough);
    const floats = FLAT_STAGE.platforms.filter((p) => p.passThrough);
    expect(solid.length).toBeGreaterThanOrEqual(1);
    expect(floats.length).toBeGreaterThanOrEqual(1);
  });

  it('places all platforms inside the design viewport', () => {
    for (const p of FLAT_STAGE.platforms) {
      const left = p.x - p.width / 2;
      const right = p.x + p.width / 2;
      const top = p.y - p.height / 2;
      const bottom = p.y + p.height / 2;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(bottom).toBeLessThanOrEqual(STAGE_DESIGN_HEIGHT);
    }
  });

  it('positions floating platforms strictly above the ground platform', () => {
    const ground = FLAT_STAGE.platforms.find((p) => !p.passThrough);
    const floats = FLAT_STAGE.platforms.filter((p) => p.passThrough);
    expect(ground).toBeDefined();
    if (!ground) return;
    const groundTop = ground.y - ground.height / 2;
    for (const f of floats) {
      const floatBottom = f.y + f.height / 2;
      expect(floatBottom).toBeLessThan(groundTop);
    }
  });

  it('encloses the entire design viewport inside the blast zone', () => {
    const z = FLAT_STAGE.blastZone;
    expect(z.left).toBeLessThan(0);
    expect(z.right).toBeGreaterThan(STAGE_DESIGN_WIDTH);
    expect(z.top).toBeLessThan(0);
    expect(z.bottom).toBeGreaterThan(STAGE_DESIGN_HEIGHT);
  });

  it('provides spawn points above the ground for up to 4 players', () => {
    expect(FLAT_STAGE.spawnPoints.length).toBeGreaterThanOrEqual(1);
    expect(FLAT_STAGE.spawnPoints.length).toBeLessThanOrEqual(4);

    const ground = FLAT_STAGE.platforms.find((p) => !p.passThrough);
    expect(ground).toBeDefined();
    if (!ground) return;
    const groundTop = ground.y - ground.height / 2;

    for (const sp of FLAT_STAGE.spawnPoints) {
      // Spawn above all surfaces and over solid ground. Viewport-based
      // quarter points would be offstage on the narrower default floor.
      expect(sp.y).toBeLessThan(groundTop);
      expect(sp.x).toBeGreaterThan(ground.x - ground.width / 2);
      expect(sp.x).toBeLessThan(ground.x + ground.width / 2);
      for (const platform of FLAT_STAGE.platforms) {
        expect(sp.y).toBeLessThan(platform.y - platform.height / 2);
      }
    }
  });

  it('starts with no hazards (M1 baseline; hazard stages land in M2)', () => {
    expect(FLAT_STAGE.hazards).toEqual([]);
  });
});

describe('createFlatStage() — Sub-AC 1: configurable flat ground geometry', () => {
  it('produces a layout matching FLAT_STAGE when called with no options', () => {
    const stage = createFlatStage();
    // Same shape as the canonical default — confirms FLAT_STAGE itself
    // is just a `createFlatStage()` call so the factory and the constant
    // can never drift apart.
    expect(stage.id).toBe(FLAT_STAGE.id);
    expect(stage.platforms.length).toBe(FLAT_STAGE.platforms.length);
    expect(stage.spawnPoints.length).toBe(FLAT_STAGE.spawnPoints.length);
    expect(stage.blastZone).toEqual(FLAT_STAGE.blastZone);
    // Ground platform dimensions should match the default constants.
    const ground = stage.platforms.find((p) => !p.passThrough)!;
    expect(ground.width).toBe(FLAT_STAGE_DEFAULTS.groundWidth);
    expect(ground.height).toBe(FLAT_STAGE_DEFAULTS.groundHeight);
  });

  it('honours custom ground width and height', () => {
    const stage = createFlatStage({
      id: 'flat-wide',
      groundWidth: 1800,
      groundHeight: 60,
    });
    expect(stage.id).toBe('flat-wide');
    const ground = stage.platforms.find((p) => !p.passThrough)!;
    expect(ground.width).toBe(1800);
    expect(ground.height).toBe(60);
    // Ground stays centred horizontally regardless of the chosen width.
    expect(ground.x).toBe(STAGE_DESIGN_WIDTH / 2);
  });

  it('repositions the ground vertically when groundBottomInset is overridden', () => {
    const customInset = 200;
    const stage = createFlatStage({ groundBottomInset: customInset });
    const ground = stage.platforms.find((p) => !p.passThrough)!;
    expect(ground.y).toBe(STAGE_DESIGN_HEIGHT - customInset);
  });

  it('omits floating platforms when omitFloatingPlatforms is true', () => {
    const stage = createFlatStage({ omitFloatingPlatforms: true });
    // Just the one solid ground platform — no pass-through floats.
    expect(stage.platforms.length).toBe(1);
    expect(stage.platforms[0]!.passThrough).toBe(false);
  });

  it.each([
    { groundWidth: 280, groundHeight: 40, groundBottomInset: 200 },
    { groundWidth: 1800, groundHeight: 120, groundBottomInset: 200 },
    { groundWidth: 4000, groundHeight: 1000, groundBottomInset: 1200 },
    { groundWidth: 800, groundHeight: 80, groundBottomInset: -400 },
  ])('encloses custom geometry and spawn points for %j', (options) => {
    const stage = createFlatStage(options);
    const z = stage.blastZone;
    const ground = stage.platforms.find((p) => !p.passThrough)!;
    const groundTop = ground.y - ground.height / 2;
    for (const platform of stage.platforms) {
      expect(platform.x - platform.width / 2).toBeGreaterThan(z.left);
      expect(platform.x + platform.width / 2).toBeLessThan(z.right);
      expect(platform.y - platform.height / 2).toBeGreaterThan(z.top);
      expect(platform.y + platform.height / 2).toBeLessThan(z.bottom);
    }
    for (const spawn of stage.spawnPoints) {
      expect(spawn.x).toBeGreaterThan(ground.x - ground.width / 2);
      expect(spawn.x).toBeLessThan(ground.x + ground.width / 2);
      expect(spawn.y).toBeGreaterThan(z.top);
      for (const platform of stage.platforms) {
        expect(spawn.y).toBeLessThan(platform.y - platform.height / 2);
      }
    }
    expect(groundTop - z.top).toBe(960);
    expect(ground.x - ground.width / 2 - z.left).toBeGreaterThanOrEqual(800);
    expect(z.right - (ground.x + ground.width / 2)).toBeGreaterThanOrEqual(800);
  });

  it('preserves surface heights, item hover and blast distances when the floor moves', () => {
    const custom = createFlatStage({ groundHeight: 120, groundBottomInset: 200 });
    const ground = custom.platforms.find((p) => !p.passThrough)!;
    const groundTop = ground.y - ground.height / 2;
    const defaultTop = 930;
    const translation = groundTop - defaultTop;
    for (const [index, platform] of custom.platforms.entries()) {
      if (!platform.passThrough) continue;
      expect(platform.y - FLAT_STAGE.platforms[index]!.y).toBe(translation);
    }
    for (const [index, anchor] of custom.itemSpawnAnchors!.entries()) {
      const platform = custom.platforms[index]!;
      expect(platform.y - platform.height / 2 - anchor.y).toBe(60);
    }
    expect(custom.blastZone.top - FLAT_STAGE.blastZone.top).toBe(translation);
    expect(custom.blastZone.bottom - FLAT_STAGE.blastZone.bottom).toBe(translation);
  });

  it('expands side bounds for wide floors while preserving ledge-to-blast distance', () => {
    const stage = createFlatStage({ groundWidth: 4000 });
    expect(stage.blastZone.left).toBe(960 - 2000 - 800);
    expect(stage.blastZone.right).toBe(960 + 2000 + 800);
  });

  it('places spawn points strictly above the configured ground', () => {
    const stage = createFlatStage({ groundHeight: 120 });
    const ground = stage.platforms.find((p) => !p.passThrough)!;
    const groundTop = ground.y - ground.height / 2;
    for (const sp of stage.spawnPoints) {
      expect(sp.y).toBeLessThan(groundTop);
    }
  });

  it('throws a clear error when ground dimensions are non-positive', () => {
    expect(() => createFlatStage({ groundWidth: 0 })).toThrow(/groundWidth/);
    expect(() => createFlatStage({ groundHeight: -10 })).toThrow(/groundHeight/);
  });

  it('rejects non-finite ground geometry instead of producing unusable blast bounds', () => {
    expect(() => createFlatStage({ groundWidth: NaN })).toThrow(/groundWidth/);
    expect(() => createFlatStage({ groundHeight: Infinity })).toThrow(/groundHeight/);
    expect(() => createFlatStage({ groundBottomInset: Infinity })).toThrow(/groundBottomInset/);
  });
});

describe('STAGES registry', () => {
  it('contains the flat stage keyed by id', () => {
    expect(STAGES[FLAT_STAGE.id]).toBe(FLAT_STAGE);
  });

  it('contains the lava hazard stage keyed by id (Sub-AC 3 of AC 9)', () => {
    expect(STAGES[LAVA_STAGE.id]).toBe(LAVA_STAGE);
  });

  it('getStage() returns the matching layout for a known id', () => {
    expect(getStage(FLAT_STAGE.id)).toBe(FLAT_STAGE);
    expect(getStage(LAVA_STAGE.id)).toBe(LAVA_STAGE);
  });

  it('getStage() throws a clear error for an unknown id', () => {
    expect(() => getStage('does-not-exist')).toThrow(/Unknown stage id/);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 3 of AC 9: lava hazard stage configuration
// ---------------------------------------------------------------------------
describe('LAVA_STAGE — hazard stage layout invariants (Sub-AC 3 of AC 9)', () => {
  it('has solid ground + at least one pass-through floating platform', () => {
    const solid = LAVA_STAGE.platforms.filter((p) => !p.passThrough);
    const floats = LAVA_STAGE.platforms.filter((p) => p.passThrough);
    expect(solid.length).toBeGreaterThanOrEqual(1);
    expect(floats.length).toBeGreaterThanOrEqual(1);
  });

  it('lists exactly two lava hazards by default — one in each pit', () => {
    const lava = LAVA_STAGE.hazards.filter((h) => h.type === 'lava');
    expect(lava.length).toBe(2);
    const ids = lava.map((h) => h.id).sort();
    expect(ids).toEqual(['lava-left', 'lava-right']);
  });

  it('places the two lava pools on opposite sides of the centred ground platform', () => {
    const lava = LAVA_STAGE.hazards.filter((h) => h.type === 'lava');
    const ground = LAVA_STAGE.platforms.find((p) => !p.passThrough)!;
    const groundLeft = ground.x - ground.width / 2;
    const groundRight = ground.x + ground.width / 2;
    const left = lava.find((h) => h.id === 'lava-left')!;
    const right = lava.find((h) => h.id === 'lava-right')!;
    expect(left.x).toBeLessThan(groundLeft);
    expect(right.x).toBeGreaterThan(groundRight);
  });

  it('configures the two lava pools out of phase by half a cycle', () => {
    const left = LAVA_STAGE.hazards.find((h) => h.id === 'lava-left')!;
    const right = LAVA_STAGE.hazards.find((h) => h.id === 'lava-right')!;
    expect(left.cycleFrames).toBe(LAVA_STAGE_DEFAULTS.lavaCycleFrames);
    expect(right.cycleFrames).toBe(LAVA_STAGE_DEFAULTS.lavaCycleFrames);
    expect(left.phaseFrames).toBe(0);
    // Default phase offset is 0.5 → exactly half a cycle.
    expect(right.phaseFrames).toBe(
      Math.round(0.5 * LAVA_STAGE_DEFAULTS.lavaCycleFrames),
    );
  });

  it('exposes the full tunable timing surface on every hazard record', () => {
    for (const h of LAVA_STAGE.hazards) {
      // Geometry
      expect(h.x).toBeGreaterThan(0);
      expect(h.width).toBe(LAVA_STAGE_DEFAULTS.lavaPoolWidth);
      expect(h.height).toBe(LAVA_STAGE_DEFAULTS.lavaMaxHeight);
      // Tunable timing — required for Sub-AC 3 acceptance
      expect(h.cycleFrames).toBe(LAVA_STAGE_DEFAULTS.lavaCycleFrames);
      expect(h.activeThreshold).toBe(LAVA_STAGE_DEFAULTS.lavaActiveThreshold);
      expect(h.damagePerTick).toBe(LAVA_STAGE_DEFAULTS.lavaDamagePerTick);
      expect(h.minHeight).toBe(LAVA_STAGE_DEFAULTS.lavaMinHeight);
      expect(h.id).toMatch(/^lava-/);
    }
  });

  it('keeps lava base Y at the bottom of the design viewport', () => {
    for (const h of LAVA_STAGE.hazards) {
      // baseY is the resting *bottom* edge — should sit at or below
      // the design viewport bottom so the lava grows upward.
      expect(h.y).toBeGreaterThanOrEqual(STAGE_DESIGN_HEIGHT - 1);
    }
  });

  it('encloses the design viewport inside the blast zone', () => {
    const z = LAVA_STAGE.blastZone;
    expect(z.left).toBeLessThan(0);
    expect(z.right).toBeGreaterThan(STAGE_DESIGN_WIDTH);
    expect(z.top).toBeLessThan(0);
    expect(z.bottom).toBeGreaterThan(STAGE_DESIGN_HEIGHT);
  });

  it('places spawn points strictly above the ground platform', () => {
    const ground = LAVA_STAGE.platforms.find((p) => !p.passThrough)!;
    const groundTop = ground.y - ground.height / 2;
    expect(LAVA_STAGE.spawnPoints.length).toBeGreaterThanOrEqual(2);
    for (const sp of LAVA_STAGE.spawnPoints) {
      expect(sp.y).toBeLessThan(groundTop);
    }
  });
});

describe('createLavaStage() — Sub-AC 3 tunable timing parameters', () => {
  it('produces a layout matching LAVA_STAGE when called with no options', () => {
    const stage = createLavaStage();
    expect(stage.id).toBe(LAVA_STAGE.id);
    expect(stage.platforms.length).toBe(LAVA_STAGE.platforms.length);
    expect(stage.hazards.length).toBe(LAVA_STAGE.hazards.length);
    expect(stage.blastZone).toEqual(LAVA_STAGE.blastZone);
  });

  it('passes lavaCycleFrames into every hazard record', () => {
    const stage = createLavaStage({ lavaCycleFrames: 1200 });
    for (const h of stage.hazards) {
      expect(h.cycleFrames).toBe(1200);
    }
  });

  it('passes lavaActiveThreshold + lavaDamagePerTick into every hazard record', () => {
    const stage = createLavaStage({
      lavaActiveThreshold: 0.7,
      lavaDamagePerTick: 25,
    });
    for (const h of stage.hazards) {
      expect(h.activeThreshold).toBe(0.7);
      expect(h.damagePerTick).toBe(25);
    }
  });

  it('honours lavaPhaseOffsetFraction for the right pool', () => {
    const stage = createLavaStage({
      lavaCycleFrames: 200,
      lavaPhaseOffsetFraction: 0.25,
    });
    const right = stage.hazards.find((h) => h.id === 'lava-right')!;
    expect(right.phaseFrames).toBe(50); // 0.25 * 200
  });

  it('produces independent lava pool widths and heights via lavaPoolWidth / lavaMaxHeight', () => {
    const stage = createLavaStage({ lavaPoolWidth: 500, lavaMaxHeight: 320 });
    for (const h of stage.hazards) {
      expect(h.width).toBe(500);
      expect(h.height).toBe(320);
    }
  });

  it('omits lava hazards when omitLavaHazards is true', () => {
    const stage = createLavaStage({ omitLavaHazards: true });
    expect(stage.hazards).toEqual([]);
    // Platforms still exist — the layout is otherwise unchanged.
    expect(stage.platforms.length).toBeGreaterThanOrEqual(1);
  });

  it('still encloses the design viewport in the blast zone for custom layouts', () => {
    const stage = createLavaStage({
      groundWidth: 800,
      lavaPoolWidth: 200,
    });
    const z = stage.blastZone;
    expect(z.left).toBeLessThan(0);
    expect(z.right).toBeGreaterThan(STAGE_DESIGN_WIDTH);
  });

  it('rejects bad geometry or timing inputs with a clear error', () => {
    expect(() => createLavaStage({ groundWidth: 0 })).toThrow(/groundWidth/);
    expect(() => createLavaStage({ lavaPoolWidth: -1 })).toThrow(
      /lavaPoolWidth/,
    );
    expect(() => createLavaStage({ lavaMaxHeight: 0 })).toThrow(
      /lavaMaxHeight/,
    );
    expect(() => createLavaStage({ lavaCycleFrames: 1 })).toThrow(
      /lavaCycleFrames/,
    );
    expect(() => createLavaStage({ lavaCycleFrames: 60.5 })).toThrow(
      /lavaCycleFrames/,
    );
    expect(() => createLavaStage({ lavaPhaseOffsetFraction: -0.1 })).toThrow(
      /lavaPhaseOffsetFraction/,
    );
    expect(() => createLavaStage({ lavaPhaseOffsetFraction: 1 })).toThrow(
      /lavaPhaseOffsetFraction/,
    );
    expect(() => createLavaStage({ lavaActiveThreshold: -0.1 })).toThrow(
      /lavaActiveThreshold/,
    );
    expect(() => createLavaStage({ lavaActiveThreshold: 1.1 })).toThrow(
      /lavaActiveThreshold/,
    );
    expect(() => createLavaStage({ lavaDamagePerTick: -1 })).toThrow(
      /lavaDamagePerTick/,
    );
    expect(() =>
      createLavaStage({ lavaMinHeight: 200, lavaMaxHeight: 200 }),
    ).toThrow(/lavaMinHeight/);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 2 of AC 90302: the four hazard stages declare platforms using the
// new schema (explicit `behavior` field) with appropriate behavior
// assignments. These tests pin the schema contract: every platform on
// every hazard stage must declare an explicit behavior, and the
// moving-platform stage must include at least one `behavior: 'moving'`
// platform with a valid motion record.
// ---------------------------------------------------------------------------

const HAZARD_STAGES = [
  ['LAVA_STAGE', LAVA_STAGE],
  ['WIND_STAGE', WIND_STAGE],
  ['CRUMBLING_STAGE', CRUMBLING_STAGE],
  ['MOVING_PLATFORM_STAGE', MOVING_PLATFORM_STAGE],
] as const;

describe('Sub-AC 2 of AC 90302 — four hazard stages declare platforms with explicit behavior', () => {
  it('exposes exactly four hazard stages alongside the M1 flat stage', () => {
    expect(STAGES[FLAT_STAGE.id]).toBe(FLAT_STAGE);
    expect(STAGES[LAVA_STAGE.id]).toBe(LAVA_STAGE);
    expect(STAGES[WIND_STAGE.id]).toBe(WIND_STAGE);
    expect(STAGES[CRUMBLING_STAGE.id]).toBe(CRUMBLING_STAGE);
    expect(STAGES[MOVING_PLATFORM_STAGE.id]).toBe(MOVING_PLATFORM_STAGE);
    expect(STAGES[INFERNO_STAGE.id]).toBe(INFERNO_STAGE);
    // Six entries total: flat + four hazard stages + the Inferno.
    expect(Object.keys(STAGES).length).toBe(6);
  });

  for (const [name, stage] of HAZARD_STAGES) {
    describe(`${name}`, () => {
      it('declares an explicit behavior on every platform', () => {
        expect(stage.platforms.length).toBeGreaterThan(0);
        for (const p of stage.platforms) {
          // Sub-AC 2: every platform on every hazard stage now sets the
          // canonical `behavior` field — no more relying on the legacy
          // boolean as the implicit source of truth.
          expect(p.behavior).toBeDefined();
          expect(['solid', 'pass-through', 'moving']).toContain(
            p.behavior,
          );
          // Legacy field stays in lock-step so existing readers keep
          // working unchanged.
          if (p.behavior === 'solid') expect(p.passThrough).toBe(false);
          if (p.behavior === 'pass-through') expect(p.passThrough).toBe(true);
          // The renderer / replay tooling resolves to the same answer
          // regardless of which field they read.
          expect(getPlatformBehavior(p)).toBe(p.behavior);
        }
      });

      it('passes the cross-field validator on every platform', () => {
        for (const p of stage.platforms) {
          expect(() =>
            validateStagePlatform(p, `${name}.${p.id ?? '?'}`),
          ).not.toThrow();
        }
      });

      it('gives every platform a stable id (required for replay snapshots)', () => {
        const ids = stage.platforms.map((p) => p.id);
        for (const pid of ids) {
          expect(pid).toBeDefined();
          expect(typeof pid).toBe('string');
          expect((pid as string).length).toBeGreaterThan(0);
        }
        // Ids are unique within a single stage.
        expect(new Set(ids).size).toBe(ids.length);
      });

      it('has a solid ground-anchor platform', () => {
        const solid = stage.platforms.filter(
          (p) => getPlatformBehavior(p) === 'solid',
        );
        expect(solid.length).toBeGreaterThanOrEqual(1);
      });
    });
  }
});

describe('WIND_STAGE — wind hazard stage layout invariants', () => {
  it('lists exactly two wind hazards by default — opposing gusts', () => {
    const wind = WIND_STAGE.hazards.filter((h) => h.type === 'wind');
    expect(wind.length).toBe(2);
    const ids = wind.map((h) => h.id).sort();
    expect(ids).toEqual(['wind-leftward', 'wind-rightward']);
  });

  it('configures the two wind zones out of phase by half a cycle', () => {
    const left = WIND_STAGE.hazards.find((h) => h.id === 'wind-leftward')!;
    const right = WIND_STAGE.hazards.find((h) => h.id === 'wind-rightward')!;
    expect(left.cycleFrames).toBe(WIND_STAGE_DEFAULTS.windCycleFrames);
    expect(right.cycleFrames).toBe(WIND_STAGE_DEFAULTS.windCycleFrames);
    expect(left.phaseFrames).toBe(0);
    expect(right.phaseFrames).toBe(
      Math.round(0.5 * WIND_STAGE_DEFAULTS.windCycleFrames),
    );
  });

  it('encloses the design viewport inside the blast zone', () => {
    const z = WIND_STAGE.blastZone;
    expect(z.left).toBeLessThan(0);
    expect(z.right).toBeGreaterThan(STAGE_DESIGN_WIDTH);
    expect(z.top).toBeLessThan(0);
    expect(z.bottom).toBeGreaterThan(STAGE_DESIGN_HEIGHT);
  });

  it('places spawn points strictly above the ground platform', () => {
    const ground = WIND_STAGE.platforms.find(
      (p) => getPlatformBehavior(p) === 'solid',
    )!;
    const groundTop = ground.y - ground.height / 2;
    for (const sp of WIND_STAGE.spawnPoints) {
      expect(sp.y).toBeLessThan(groundTop);
    }
  });

  it('omits wind hazards when omitWindHazards is true', () => {
    const stage = createWindStage({ omitWindHazards: true });
    expect(stage.hazards).toEqual([]);
  });

  it('rejects non-integer or below-2 windCycleFrames', () => {
    expect(() => createWindStage({ windCycleFrames: 1 })).toThrow(
      /windCycleFrames/,
    );
    expect(() => createWindStage({ windCycleFrames: 60.5 })).toThrow(
      /windCycleFrames/,
    );
  });
});

describe('CRUMBLING_STAGE — crumbling-platform stage layout invariants', () => {
  it('declares the central anchor as solid and the floats as pass-through', () => {
    const ground = CRUMBLING_STAGE.platforms.find(
      (p) => p.id === 'crumble-ground',
    )!;
    expect(getPlatformBehavior(ground)).toBe('solid');
    const crumblers = CRUMBLING_STAGE.platforms.filter((p) =>
      (p.id ?? '').startsWith('crumble-') && p.id !== 'crumble-ground',
    );
    expect(crumblers.length).toBeGreaterThanOrEqual(2);
    for (const c of crumblers) {
      expect(getPlatformBehavior(c)).toBe('pass-through');
    }
  });

  it('omits crumbling floats when omitCrumblingFloats is true', () => {
    const stage = createCrumblingStage({ omitCrumblingFloats: true });
    // Only the central solid anchor remains.
    expect(stage.platforms.length).toBe(1);
    expect(stage.platforms[0]!.id).toBe('crumble-ground');
  });

  it('keeps the canonical default ground id and dimensions', () => {
    const ground = CRUMBLING_STAGE.platforms.find(
      (p) => p.id === 'crumble-ground',
    )!;
    expect(ground.width).toBe(CRUMBLING_STAGE_DEFAULTS.groundWidth);
    expect(ground.height).toBe(CRUMBLING_STAGE_DEFAULTS.groundHeight);
  });

  it('rejects non-positive ground dimensions', () => {
    expect(() => createCrumblingStage({ groundWidth: 0 })).toThrow(
      /groundWidth/,
    );
    expect(() => createCrumblingStage({ groundHeight: -10 })).toThrow(
      /groundHeight/,
    );
  });
});

describe('MOVING_PLATFORM_STAGE — moving-platform stage uses behavior: moving', () => {
  it('includes at least one platform with behavior "moving" and a valid motion record', () => {
    const moving = MOVING_PLATFORM_STAGE.platforms.filter(
      (p) => getPlatformBehavior(p) === 'moving',
    );
    expect(moving.length).toBeGreaterThanOrEqual(1);
    for (const p of moving) {
      expect(p.motion).toBeDefined();
      expect(p.motion!.waypoints.length).toBeGreaterThanOrEqual(2);
      expect(Number.isInteger(p.motion!.cycleFrames)).toBe(true);
      expect(p.motion!.cycleFrames).toBeGreaterThanOrEqual(2);
    }
  });

  it('exposes both a horizontal and a vertical mover by id', () => {
    const ids = MOVING_PLATFORM_STAGE.platforms.map((p) => p.id);
    expect(ids).toContain('moving-horizontal');
    expect(ids).toContain('moving-vertical');
  });

  it('staggers the two moving platforms by half a cycle (vertical phase = cycle/2)', () => {
    const v = MOVING_PLATFORM_STAGE.platforms.find(
      (p) => p.id === 'moving-vertical',
    )!;
    expect(v.motion).toBeDefined();
    expect(v.motion!.phaseFrames).toBe(
      Math.round(MOVING_PLATFORM_STAGE_DEFAULTS.verticalCycleFrames / 2),
    );
  });

  it('passes validateStagePlatform on every platform (cross-field invariants)', () => {
    for (const p of MOVING_PLATFORM_STAGE.platforms) {
      expect(() =>
        validateStagePlatform(p, `MOVING_PLATFORM_STAGE.${p.id ?? '?'}`),
      ).not.toThrow();
    }
  });

  it('rejects non-integer or below-2 horizontalCycleFrames', () => {
    expect(() =>
      createMovingPlatformStage({ horizontalCycleFrames: 1 }),
    ).toThrow(/horizontalCycleFrames/);
    expect(() =>
      createMovingPlatformStage({ horizontalCycleFrames: 60.5 }),
    ).toThrow(/horizontalCycleFrames/);
  });

  it('rejects non-integer or below-2 verticalCycleFrames', () => {
    expect(() =>
      createMovingPlatformStage({ verticalCycleFrames: 1 }),
    ).toThrow(/verticalCycleFrames/);
    expect(() =>
      createMovingPlatformStage({ verticalCycleFrames: 60.5 }),
    ).toThrow(/verticalCycleFrames/);
  });

  it('omits the top safety platform when omitTopPlatform is true', () => {
    const stage = createMovingPlatformStage({ omitTopPlatform: true });
    const topIds = stage.platforms
      .map((p) => p.id ?? '')
      .filter((id) => id === 'moving-top-platform');
    expect(topIds.length).toBe(0);
  });
});
