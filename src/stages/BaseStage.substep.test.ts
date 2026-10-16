import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { BaseStage } from './BaseStage';
import { FLAT_STAGE, STAGE_DESIGN_HEIGHT, STAGE_DESIGN_WIDTH } from './stageDefinitions';
import { COLLISION_CATEGORIES, COLLISION_MASKS } from '../engine/collisionCategories';
import { GAME_CONFIG } from '../engine/constants';
import type { StageLayout } from '../types';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');

function fixture(startX: number, speedX: number) {
  const engine = Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = 0;
  const player = Bodies.rectangle(startX, 450, 10, 10, {
    label: 'fighter', frictionAir: 0,
    collisionFilter: { category: COLLISION_CATEGORIES.CHARACTER, mask: COLLISION_MASKS.CHARACTER },
  });
  Composite.add(engine.world, player);
  Body.setVelocity(player, { x: speedX, y: 0 });

  // Only rendering is stubbed. BaseStage constructs the actual hazard entities,
  // sensor bodies, LavaCollisionWatcher and WindForceController.
  const rectangleVisual = () => ({
    setStrokeStyle() { return this; }, setDepth() { return this; },
    setPosition() { return this; }, setSize() { return this; },
    setFillStyle() { return this; }, setVisible() { return this; }, destroy() {},
  });
  const scene: any = {
    scale: { gameSize: { width: STAGE_DESIGN_WIDTH, height: STAGE_DESIGN_HEIGHT } },
    add: { rectangle: rectangleVisual },
    matter: {
      body: Body,
      add: {
        rectangle(x: number, y: number, width: number, height: number, options: object) {
          const body = Bodies.rectangle(x, y, width, height, options);
          Composite.add(engine.world, body);
          return body;
        },
      },
      world: { remove(body: object) { Composite.remove(engine.world, body); } },
    },
  };
  const layout: StageLayout = {
    ...FLAT_STAGE, id: 'lava-substep-test', platforms: [],
    hazards: [
      { type: 'lava', id: 'pool', x: 500, y: 500, width: 60, height: 100,
        cycleFrames: 1200, phaseFrames: 599, activeThreshold: 0.5 },
      { type: 'wind', id: 'gust', x: 500, y: 450, width: 400, height: 200,
        cycleFrames: 1200, forceX: 2, forceY: 0, activeThreshold: 0.5 },
    ],
  };
  const kos: Array<{ playerIndex: number; hazardId: string; frame: number }> = [];
  const winds: Array<{ playerIndex: number; hazardId: string; frame: number; x: number; y: number }> = [];
  const stage = new BaseStage(scene, layout, {
    skipBlastZoneBodies: true,
    onLavaKo: (playerIndex, hazardId, frame) => kos.push({ playerIndex, hazardId, frame }),
    onWindForce: (playerIndex, hazardId, force, frame) => {
      winds.push({ playerIndex, hazardId, frame, ...force });
      Body.setVelocity(player, { x: player.velocity.x + force.x, y: player.velocity.y + force.y });
    },
  });
  stage.registerPlayer(0, player);
  Events.on(engine, 'collisionStart', (event: any) => stage.handleCollisionStart(event));
  Events.on(engine, 'collisionEnd', (event: any) => stage.handleCollisionEnd(event));
  const overlapsLava = () => engine.pairs.list.some((pair: any) => pair.isActive
    && (pair.bodyA === stage.hazards.lava[0]!.body || pair.bodyB === stage.hazards.lava[0]!.body)
    && (pair.bodyA === player || pair.bodyB === player));
  const segment = () => Engine.update(engine, GAME_CONFIG.fixedTimestepMs / 3);
  const destroy = () => { stage.destroy(); Engine.clear(engine); };
  return { stage, player, kos, winds, segment, overlapsLava, destroy };
}

describe('BaseStage hazard observations during subdivided physics', () => {
  it('catches a transient lava crossing before the outer-frame overlap disappears', () => {
    const f = fixture(400, 240); // Three 80-pixel segments cross the 470..530 lava pool.
    try {
      const frame = 73;
      f.stage.tickHazards(frame);
      const hazardState = f.stage.hazards.lava[0]!.entity.toState();
      expect(f.stage.hazards.lava[0]!.entity.isActive()).toBe(true);

      f.segment();
      expect(f.player.position.x).toBeCloseTo(480, 8);
      expect(f.overlapsLava()).toBe(true);
      expect(f.kos).toEqual([]); // Collision tracking alone has not drained the KO.
      f.stage.applyLavaEffects(frame);
      expect(f.kos).toEqual([{ playerIndex: 0, hazardId: 'pool', frame }]);
      expect(f.winds).toEqual([]);

      f.segment();
      f.stage.applyLavaEffects(frame);
      f.segment();
      f.stage.applyLavaEffects(frame);
      expect(f.player.position.x).toBeCloseTo(640, 8);
      expect(f.overlapsLava()).toBe(false);
      expect(f.kos).toHaveLength(1);
      expect(f.winds).toEqual([]);
      expect(f.stage.hazards.lava[0]!.entity.toState()).toEqual(hazardState);

      f.stage.applyHazardEffects(frame);
      expect(f.kos).toHaveLength(1);
      expect(f.winds).toHaveLength(1);
      expect(f.winds[0]).toMatchObject({ playerIndex: 0, hazardId: 'gust', frame });
      expect(f.player.velocity.x).toBeCloseTo(240 + 2 * Math.cos(2 * Math.PI / 1200), 8);
    } finally { f.destroy(); }
  });

  it('deduplicates persistent lava overlap while wind and hazard clocks keep their outer cadence', () => {
    const f = fixture(480, 30); // Remains in lava through all three segments.
    try {
      const frame = 91;
      f.stage.tickHazards(frame);
      const lavaState = f.stage.hazards.lava[0]!.entity.toState();
      const windState = f.stage.hazards.wind[0]!.entity.toState();
      for (let segment = 0; segment < 3; segment++) {
        f.segment();
        expect(f.overlapsLava()).toBe(true);
        f.stage.applyLavaEffects(frame);
        expect(f.kos).toEqual([{ playerIndex: 0, hazardId: 'pool', frame }]);
        expect(f.winds).toEqual([]);
      }
      f.stage.applyHazardEffects(frame);
      expect(f.kos).toHaveLength(1);
      expect(f.winds).toHaveLength(1);
      expect(f.player.velocity.x).toBeCloseTo(30 + 2 * Math.cos(2 * Math.PI / 1200), 8);
      expect(f.stage.hazards.lava[0]!.entity.toState()).toEqual(lavaState);
      expect(f.stage.hazards.wind[0]!.entity.toState()).toEqual(windState);

      // A continuing overlap on the next outer frame gets another wind impulse,
      // but neither another KO nor three extra hazard-clock advances.
      Body.setVelocity(f.player, { x: 0, y: 0 });
      f.stage.tickHazards(frame + 1);
      for (let segment = 0; segment < 3; segment++) {
        f.segment();
        f.stage.applyLavaEffects(frame + 1);
      }
      expect(f.winds).toHaveLength(1);
      f.stage.applyHazardEffects(frame + 1);
      expect(f.kos).toHaveLength(1);
      expect(f.winds.map(wind => wind.frame)).toEqual([frame, frame + 1]);
      expect(f.player.velocity.x).toBeCloseTo(2 * Math.cos(4 * Math.PI / 1200), 8);
    } finally { f.destroy(); }
  });
});
