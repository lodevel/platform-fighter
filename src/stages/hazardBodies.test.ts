import { describe, expect, it } from 'vitest';
import { COLLISION_CATEGORIES, COLLISION_MASKS } from '../engine/collisionCategories';
import { createLavaHazardFromStageHazard } from '../entities/LavaHazard';
import { createWindHazardFromStageHazard } from '../entities/WindZoneHazard';
import { createMatterPhysicsWorld } from '../physics/matterPhysicsWorld';
import {
  MIN_LAVA_SENSOR_HEIGHT_DESIGN_PX,
  createLavaHazardBody,
  createWindHazardBody,
  syncLavaHazardBody,
  syncWindHazardBody,
} from './hazardBodies';
import { computeStageViewportTransform } from './stageViewport';

// The hazard bodies on the game's own Phaser-free Matter world: no Phaser scene.
const lavaRecord = { type: 'lava', id: 'pool', x: 960, y: 1000, width: 800, height: 200, cycleFrames: 120 } as const;
const windRecord = { type: 'wind', id: 'gust', x: 600, y: 400, width: 300, height: 500, forceX: -0.4, cycleFrames: 90 } as const;

describe('hazard bodies (Phaser-free)', () => {
  it('creates the lava sensor where the entity is, with the watcher label and HAZARD filter', () => {
    const physics = createMatterPhysicsWorld();
    const lava = createLavaHazardFromStageHazard(lavaRecord);
    const t = computeStageViewportTransform({ width: 1280, height: 720 });
    const body = createLavaHazardBody(physics, lava, t);
    const h = Math.max(MIN_LAVA_SENSOR_HEIGHT_DESIGN_PX, lava.getBounds().height);
    expect(body.label).toBe('hazard.lava.pool');
    expect(body.isSensor && body.isStatic).toBe(true);
    expect(body.collisionFilter.category).toBe(COLLISION_CATEGORIES.HAZARD);
    expect(body.position.x).toBeCloseTo(t.offsetX + 960 * t.viewportScale, 9);
    expect(body.position.y).toBeCloseTo(t.offsetY + (1000 - h / 2) * t.viewportScale, 9);
    expect(physics.world.getAllBodies()).toContain(body);
  });

  it('follows the lava height step by step and masks the sensor only while inactive', () => {
    const physics = createMatterPhysicsWorld();
    const lava = createLavaHazardFromStageHazard(lavaRecord);
    const t = computeStageViewportTransform({ width: 1920, height: 1080 });
    const body = createLavaHazardBody(physics, lava, t);
    const seen = new Set<boolean>();
    for (let frame = 0; frame < 120; frame++) {
      lava.tick();
      const g = syncLavaHazardBody(body, lava, t);
      const bounds = lava.getBounds();
      expect(g.heightDesign).toBe(Math.max(MIN_LAVA_SENSOR_HEIGHT_DESIGN_PX, bounds.height));
      // The four vertices are written in place: top edge at the lava surface.
      expect(body.vertices![0]!.y).toBeCloseTo(1000 - g.heightDesign, 9);
      expect(body.vertices![2]!.y).toBeCloseTo(1000, 9);
      expect(body.collisionFilter.mask).toBe(lava.isActive() ? COLLISION_MASKS.HAZARD : 0);
      seen.add(lava.isActive());
    }
    expect(seen).toEqual(new Set([true, false]));
  });

  it('creates and syncs the wind sensor from the zone bounds', () => {
    const physics = createMatterPhysicsWorld();
    const wind = createWindHazardFromStageHazard(windRecord);
    const t = computeStageViewportTransform({ width: 1920, height: 1080 });
    const body = createWindHazardBody(physics, wind, t);
    expect(body.label).toBe('hazard.wind.gust');
    expect([body.position.x, body.position.y]).toEqual([600, 400]);
    const seen = new Set<boolean>();
    for (let frame = 0; frame < 90; frame++) {
      wind.tick();
      const g = syncWindHazardBody(body, wind, t);
      expect([g.width, g.height]).toEqual([300, 500]);
      expect(body.collisionFilter.mask).toBe(wind.isActive() ? COLLISION_MASKS.HAZARD : 0);
      seen.add(wind.isActive());
    }
    expect(seen.size).toBe(2);
  });
});
