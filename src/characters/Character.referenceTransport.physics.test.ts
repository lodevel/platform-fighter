import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Link, LINK_TILT } from './Link';
import type { CharacterInput } from './Character';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { GAME_CONFIG } from '../engine/constants';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { stepCharacterPhysics } from './stepCharacterPhysics';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
type Vector = { x: number; y: number };

function fixture() {
  const engine = Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = GAME_CONFIG.gravity;
  const names: Record<string, string> = {
    collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd',
  };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, width: number, height: number, settings: object) {
      const body = Bodies.rectangle(x, y, width, height, settings);
      Composite.add(engine.world, body);
      return body;
    },
  }, world: {
    on(event: string, fn: (...args: any[]) => void) { Events.on(engine, names[event] ?? event, fn); },
    off(event: string, fn: (...args: any[]) => void) { Events.off(engine, names[event] ?? event, fn); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const launched = new Link(scene, { spawnX: 0, spawnY: 0 });
  const characters = [launched];
  const addOrdinary = () => {
    const character = new Link(scene, { spawnX: 1000, spawnY: 0 });
    characters.push(character);
    return character;
  };
  const physics = (afterSubstep?: () => void) => stepCharacterPhysics({
    characters, bodies: Composite.allBodies(engine.world), gravity: engine.gravity,
    body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
    stepWorld: delta => Engine.update(engine, delta),
    afterSubstep,
  });
  const frame = () => {
    for (const character of characters) character.applyInput(NEUTRAL);
    physics();
  };
  const queueLaunch = (velocityCarry?: Vector) => {
    launched.setDamagePercent(100);
    const result = launched.applyHit({ damage: LINK_TILT.damage, knockback: LINK_TILT.knockback, facing: 1,
      ...(velocityCarry ? { velocityCarry } : {}),
    });
    for (let i = 0; i < 100 && launched.getHitlagRemaining() > 1; i++) frame();
    expect(launched.getHitlagRemaining()).toBe(1);
    return result;
  };
  return { engine, launched, addOrdinary, queueLaunch, frame, physics };
}

function expectVector(actual: Vector, expected: Vector, label: string) {
  expect(actual.x, `${label} x`).toBeCloseTo(expected.x, 8);
  expect(actual.y, `${label} y`).toBeCloseTo(expected.y, 8);
}

describe('Reference transport at collision and hitlag boundaries', () => {
  it('exposes canonical velocities for both the launched fighter and an ordinary attacker inside collisionStart', () => {
    const world = fixture();
    const launch = world.queueLaunch();
    const ordinary = world.addOrdinary();
    Body.setVelocity(ordinary.body, { x: 4, y: -2 });
    world.launched.applyInput(NEUTRAL);
    ordinary.applyInput(NEUTRAL);
    expect(world.launched.getReferencePhysicsStep()!.ticks).toBeGreaterThan(1);
    const before = ordinary.getVelocity();
    const expectedOrdinary = {
      x: before.x,
      y: before.y + world.engine.gravity.y * world.engine.gravity.scale * GAME_CONFIG.fixedTimestepMs ** 2,
    };
    const sensor = Bodies.rectangle(launch.vector.x, launch.vector.y, 4, 4, {
      isStatic: true, isSensor: true, label: 'velocity-observation',
      collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
    });
    Composite.add(world.engine.world, sensor);
    const observations: Array<{ launched: Vector; ordinary: Vector }> = [];
    Events.on(world.engine, 'collisionStart', ({ pairs }: { pairs: any[] }) => {
      if (pairs.some(pair => (pair.bodyA === sensor || pair.bodyB === sensor) &&
          (pair.bodyA === world.launched.body || pair.bodyB === world.launched.body))) {
        observations.push({ launched: world.launched.getVelocity(), ordinary: ordinary.getVelocity() });
        ordinary.armAttackerHitlag(4);
      }
    });
    world.physics();
    expect(observations).toHaveLength(1);
    expectVector(observations[0]!.launched, launch.vector, 'launched collision velocity');
    expectVector(observations[0]!.ordinary, expectedOrdinary, 'ordinary collision velocity');
    expect(ordinary.getHitlagRemaining()).toBe(4);
  });

  it('resumes the next compressed launch group after outgoing hitlag without repeating or double-decaying it', () => {
    const paused = fixture();
    const continuous = fixture();
    for (const world of [paused, continuous]) {
      world.queueLaunch();
      world.frame();
      for (let i = 0; i < 4; i++) world.frame();
      expect(world.launched.getHitstunRemaining()).toBeGreaterThan(20);
      expect(world.launched.getReferencePhysicsStep()!.ticks).toBeGreaterThan(1);
    }
    const frozenPosition = paused.launched.getPosition();
    const frozenHitstun = paused.launched.getHitstunRemaining();
    paused.launched.armAttackerHitlag(4);
    for (let i = 0; i < 3; i++) {
      paused.frame();
      expectVector(paused.launched.getPosition(), frozenPosition, `freeze ${i}`);
      expect(paused.launched.getHitstunRemaining()).toBe(frozenHitstun);
    }
    for (let i = 0; i < 12; i++) {
      paused.frame();
      continuous.frame();
      expectVector(paused.launched.getPosition(), continuous.launched.getPosition(), `resume position ${i}`);
      expectVector(paused.launched.getVelocity(), continuous.launched.getVelocity(), `resume velocity ${i}`);
      expect(paused.launched.getHitstunRemaining()).toBe(continuous.launched.getHitstunRemaining());
    }
  });

  it('continues reference launch decay when the body ignores natural gravity', () => {
    const world = fixture();
    world.launched.body.ignoreGravity = true;
    const launch = world.queueLaunch();
    const magnitude = Math.hypot(launch.vector.x, launch.vector.y);
    let ordinaryTicks = 0;
    let displacementScale = 0;
    for (let frame = 0; frame < 9; frame++) {
      world.launched.applyInput(NEUTRAL);
      const ticks = world.launched.getReferencePhysicsStep()!.ticks;
      for (let tick = 0; tick < ticks; tick++) {
        displacementScale += Math.max(0, 1 - ordinaryTicks * 0.255 / magnitude);
        ordinaryTicks += 1;
      }
      world.physics();
      const velocityScale = Math.max(0, 1 - (ordinaryTicks - 1) * 0.255 / magnitude);
      expectVector(world.launched.getVelocity(), {
        x: launch.vector.x * velocityScale,
        y: launch.vector.y * velocityScale,
      }, `gravity-disabled velocity ${frame}`);
      expectVector(world.launched.getPosition(), {
        x: launch.vector.x * displacementScale,
        y: launch.vector.y * displacementScale,
      }, `gravity-disabled position ${frame}`);
    }
    expect(ordinaryTicks).toBeGreaterThan(9);
  });

  it('keeps a ceiling-canceled normal at zero while retaining tangential carried velocity', () => {
    const blockedVelocities: Vector[] = [];
    for (const carryX of [0, 3]) {
      const world = fixture();
      world.queueLaunch({ x: carryX, y: 4 });
      const roof = Bodies.rectangle(0, -world.launched.getTuning().height / 2 - 14, 4000, 20, {
        isStatic: true, friction: 0, frictionStatic: 0, label: PLATFORM_LABELS.solid,
        collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
      });
      Composite.add(world.engine.world, roof);
      world.launched.applyInput(NEUTRAL);
      expect(world.launched.getReferencePhysicsStep()!.ticks).toBeGreaterThan(1);
      const firstBlockedVelocity: Vector[] = [];
      world.physics(() => {
        if (firstBlockedVelocity.length > 0) return;
        const blocked = world.engine.pairs.list.some((pair: any) => pair.isActive &&
          (pair.bodyA === roof || pair.bodyB === roof) &&
          (pair.bodyA === world.launched.body || pair.bodyB === world.launched.body));
        if (blocked) firstBlockedVelocity.push(world.launched.getVelocity());
      });
      expect(firstBlockedVelocity).toHaveLength(1);
      // The solver stops TOTAL normal motion. Unscaling reference transport
      // must not recreate carry.y * (1 - 1 / groupSize) after cancellation.
      expect(firstBlockedVelocity[0]!.y).toBeCloseTo(0, 8);
      blockedVelocities.push(firstBlockedVelocity[0]!);
    }
    // Compare identical real contacts so their small shared tangential solver
    // impulse does not obscure whether the full extra carry survives.
    expect(blockedVelocities[1]!.x - blockedVelocities[0]!.x).toBeCloseTo(3, 8);
  });
});
