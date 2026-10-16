import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, type CharacterInput } from '../characters/Character';
import type { StageLayout, StagePlatform } from '../types';
import { BaseStage } from './BaseStage';
import { FLAT_STAGE } from './stageDefinitions';
import { computeMovingPlatformOffset } from './platformVisualState';
import type { PlatformRider } from './platformMotion';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, jump: false };

function movingPlatform(overrides: Partial<StagePlatform> = {}): StagePlatform {
  return {
    id: 'lift', x: 600, y: 600, width: 320, height: 24,
    passThrough: false, behavior: 'moving',
    motion: { waypoints: [{ x: 0, y: 0 }, { x: 120, y: 0 }], cycleFrames: 120 },
    ...overrides,
  };
}

function runtime(platform = movingPlatform(), width = 1920, height = 1080) {
  const engine = Engine.create();
  const eventNames: Record<string, string> = { collisionstart: 'collisionStart', collisionend: 'collisionEnd' };
  const scene: any = {
    scale: { gameSize: { width, height } },
    matter: {
      body: Body,
      add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
        const body = Bodies.rectangle(x, y, w, h, options);
        Composite.add(engine.world, body);
        return body;
      } },
      world: {
        on(event: string, listener: (...args: any[]) => void) { Events.on(engine, eventNames[event] ?? event, listener); },
        off(event: string, listener: (...args: any[]) => void) { Events.off(engine, eventNames[event] ?? event, listener); },
        remove(body: any) { Composite.remove(engine.world, body); },
      },
    },
    add: { rectangle(x: number, y: number, width: number, height: number, color: number, alpha = 1) {
      return {
        x, y, width, height, fillColor: color, alpha, visible: true,
        setStrokeStyle() { return this; }, setDepth() { return this; },
        setFillStyle(next: number, nextAlpha?: number) { this.fillColor = next; this.alpha = nextAlpha ?? this.alpha; return this; },
        destroy() {},
      };
    } },
  };
  const layout: StageLayout = { ...FLAT_STAGE, platforms: [platform] };
  const stage = new BaseStage(scene, layout, { viewportSize: { width, height }, skipBlastZoneBodies: true });
  const surface = stage.bodies.platformBodies[0]!;
  const fighter = new Character(scene, {
    id: 'donkeykong', spawnX: surface.position.x, spawnY: surface.bounds.min.y - 33,
  });
  const physics = (input = NEUTRAL) => {
    fighter.applyInput(input);
    Engine.update(engine, 1000 / 60);
    fighter.applyPostPhysicsVelocityConstraints();
  };
  // Establish a genuine Matter support pair, including collision slop.
  for (let i = 0; i < 12; i += 1) physics();
  return {
    stage, fighter, surface, physics,
    step(frame: number, rider: Partial<PlatformRider> = {}, input = NEUTRAL) {
      stage.updatePlatforms(frame, [{ body: fighter.body, ...rider }]);
      physics(input);
    },
  };
}

describe('moving platforms in the live Matter pipeline', () => {
  it.each([
    { name: 'horizontal', end: { x: 120, y: 0 } },
    { name: 'vertical', end: { x: 0, y: 120 } },
    { name: 'diagonal', end: { x: 120, y: -60 } },
  ])('carries a standing rider through a full $name cycle without imparting duplicate velocity', ({ end }) => {
    const platform = movingPlatform({ motion: { waypoints: [{ x: 0, y: 0 }, end], cycleFrames: 120 } });
    const { fighter, surface, step } = runtime(platform);
    expect(fighter.isGrounded()).toBe(true);
    const startRelativeX = fighter.body.position.x - surface.position.x;
    const settledFootGap = fighter.body.bounds.max.y - surface.bounds.min.y;
    for (let frame = 1; frame <= 120; frame += 1) {
      step(frame);
      const offset = computeMovingPlatformOffset(platform.motion!, frame);
      expect(surface.position.x).toBeCloseTo(platform.x + offset.x, 6);
      expect(surface.position.y).toBeCloseTo(platform.y + offset.y, 6);
      expect(fighter.body.position.x - surface.position.x).toBeCloseTo(startRelativeX, 4);
      // Matter's padded bounds include its subpixel support slop; motion
      // must preserve that settled contact, not require an exact zero gap.
      expect(fighter.body.bounds.max.y - surface.bounds.min.y).toBeCloseTo(settledFootGap, 4);
      expect(Math.abs(fighter.body.velocity.x)).toBeLessThan(0.001);
    }
  });

  it('detaches a jumping fighter and never carries rising, dropping, frozen or masked riders', () => {
    for (const exclusion of ['rising', 'drop', 'frozen', 'crumble', 'mask'] as const) {
      const { stage, fighter, surface } = runtime(movingPlatform({ passThrough: true }));
      const startX = fighter.body.position.x;
      if (exclusion === 'rising') Body.setVelocity(fighter.body, { x: 0, y: -5 });
      if (exclusion === 'crumble') surface.collisionFilter.mask = 0;
      if (exclusion === 'mask') surface.collisionFilter.mask = 1 << 29;
      const mask = surface.collisionFilter.mask;
      stage.updatePlatforms(1, [{
        body: fighter.body, canRide: exclusion !== 'frozen', dropThrough: exclusion === 'drop',
      }]);
      expect(surface.position.x).toBe(602);
      expect(fighter.body.position.x).toBe(startX);
      expect(surface.collisionFilter.mask).toBe(mask);
    }
    const { fighter, surface, step } = runtime();
    for (let frame = 1; frame <= 4; frame += 1) step(frame, {}, { ...NEUTRAL, jump: true });
    expect(fighter.body.velocity.y).toBeLessThan(0);
    const x = fighter.body.position.x;
    step(5, {}, { ...NEUTRAL, jump: true });
    expect(surface.position.x).toBe(610);
    expect(fighter.body.position.x).toBeCloseTo(x);
  });

  it('uses one scaled position for phased motion and ledges', () => {
    const platform = movingPlatform({ motion: {
      waypoints: [{ x: 0, y: 0 }, { x: 100, y: -50 }], cycleFrames: 100, phaseFrames: 25,
    } });
    const { stage, surface, step } = runtime(platform, 1280, 720);
    expect(surface.position.x).toBeCloseTo(650 * 2 / 3);
    expect(surface.position.y).toBeCloseTo(575 * 2 / 3);
    step(30);
    const position = { ...surface.position };
    expect(surface.position).toEqual(position);
    expect(stage.getLedgeCandidates()).toEqual([
      { platformId: 'lift', side: 'left', x: surface.bounds.min.x, y: surface.bounds.min.y },
      { platformId: 'lift', side: 'right', x: surface.bounds.max.x, y: surface.bounds.min.y },
    ]);
    surface.collisionFilter.mask = 0;
    expect(stage.getLedgeCandidates()).toEqual([]);
  });

  it('is deterministic across duplicate physics-frame notifications', () => {
    const a = runtime();
    const b = runtime();
    for (let frame = 1; frame <= 90; frame += 1) {
      a.step(frame);
      b.step(frame);
      b.stage.updatePlatforms(frame, [{ body: b.fighter.body }]);
      expect(b.surface.position).toEqual(a.surface.position);
      expect(b.fighter.getPosition()).toEqual(a.fighter.getPosition());
      expect(b.fighter.getVelocity()).toEqual(a.fighter.getVelocity());
    }
  });
});
