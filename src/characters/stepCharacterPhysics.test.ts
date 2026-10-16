import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { Character } from './Character';
import { stepCharacterPhysics } from './stepCharacterPhysics';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const DT = 1000 / 60;

function world() {
  const engine = Engine.create();
  engine.gravity.x = 0.2;
  engine.gravity.y = 1.3;
  return engine;
}

function ordinaryBody(engine: any, options: Record<string, unknown> = {}) {
  const body = Bodies.rectangle(1000, 1000, 20, 30, {
    frictionAir: 0.035, collisionFilter: { mask: 0 }, ...options,
  }) as MatterJS.BodyType;
  Body.setVelocity(body, { x: 4.25, y: -2.5 });
  Body.setAngularVelocity(body, 0.03);
  body.force.x = 0.002;
  body.force.y = -0.001;
  body.torque = 0.0003;
  Composite.add(engine.world, body);
  return body;
}

/** A controlled energy owner; the coordinator is tested against real Matter. */
function referenceCharacter(engine: any, ticks: number, x = 0, collidable = false) {
  const body = Bodies.rectangle(x, 0, 20, 20, {
    frictionAir: 0, friction: 0, collisionFilter: { mask: collidable ? 0xffffffff : 0 },
  }) as MatterJS.BodyType;
  Composite.add(engine.world, body);
  const token = {};
  let active = true;
  let energy = { x: 8, y: 0 };
  let transportOffset: { x: number; y: number } | null = null;
  const calls = { prepare: [] as Array<[number, boolean]>, begin: [] as number[], end: 0,
    substep: 0, post: [] as number[] };
  Body.setVelocity(body, energy);
  const character = {
    body,
    getReferencePhysicsStep: () => active ? { token, ticks } : null,
    preparePhysicsStep(gravity: number, additional = false) {
      calls.prepare.push([gravity, additional]);
      const previous = energy;
      if (additional) energy = { x: energy.x - 1, y: energy.y + 0.5 };
      Body.setVelocity(body, {
        x: body.velocity.x + energy.x - previous.x,
        y: body.velocity.y + energy.y - previous.y - gravity,
      });
    },
    beginReferenceTransport(multiplier: number) {
      calls.begin.push(multiplier);
      transportOffset = { x: energy.x * (multiplier - 1), y: energy.y * (multiplier - 1) };
      Body.setVelocity(body, {
        x: body.velocity.x + transportOffset.x,
        y: body.velocity.y + transportOffset.y,
      });
    },
    endReferenceTransport() {
      calls.end += 1;
      if (transportOffset !== null && active) {
        Body.setVelocity(body, {
          x: body.velocity.x - transportOffset.x,
          y: body.velocity.y - transportOffset.y,
        });
      }
      transportOffset = null;
    },
    applyPhysicsSubstepConstraints() { calls.substep += 1; },
    applyPostPhysicsVelocityConstraints(gravity: number) { calls.post.push(gravity); },
  } as unknown as Character;
  return { character, body, calls,
    cancel() { active = false; },
    setEnergy(vector: { x: number; y: number }) { energy = vector; Body.setVelocity(body, vector); },
  };
}

function step(engine: any, characters: readonly Character[], afterSubstep?: () => void) {
  const deltas: number[] = [];
  stepCharacterPhysics({ characters, bodies: Composite.allBodies(engine.world), gravity: engine.gravity,
    body: Body, deltaMs: DT, afterSubstep,
    stepWorld(delta) { deltas.push(delta); Engine.update(engine, delta); },
  });
  return deltas;
}

function expectSameBody(actual: MatterJS.BodyType, expected: MatterJS.BodyType) {
  for (const axis of ['x', 'y'] as const) {
    expect(actual.position[axis], `position ${axis}`).toBeCloseTo(expected.position[axis], 9);
    expect(actual.velocity[axis], `velocity ${axis}`).toBeCloseTo(expected.velocity[axis], 9);
  }
  expect(actual.angle).toBeCloseTo(expected.angle, 9);
  expect(actual.angularVelocity).toBeCloseTo(expected.angularVelocity, 9);
}

describe('stepCharacterPhysics', () => {
  it('keeps the original single-step path when no fighter has compressed ticks', () => {
    const engine = world();
    const reference = referenceCharacter(engine, 1);
    let observations = 0;
    expect(step(engine, [reference.character], () => { observations += 1; })).toEqual([DT]);
    expect(reference.calls.prepare).toHaveLength(1);
    expect(reference.calls.prepare[0]?.[1]).toBe(false);
    expect(reference.calls.begin).toEqual([]);
    expect(reference.calls.substep).toBe(0);
    expect(reference.calls.post).toHaveLength(1);
    expect(observations).toBe(1);
    expect(engine.timing.timestamp).toBe(DT);
  });

  it('uses the union of two- and three-tick boundaries without accelerating residual motion', () => {
    const engine = world();
    engine.gravity.x = 0;
    const two = referenceCharacter(engine, 2);
    const three = referenceCharacter(engine, 3, 100);
    for (const fixture of [two, three]) Body.setVelocity(fixture.body, { x: 10, y: 0 });
    const observations: Array<[number, number]> = [];
    const deltas = step(engine, [two.character, three.character], () => {
      observations.push([two.body.velocity.x, three.body.velocity.x]);
    });
    expect(deltas).toHaveLength(4);
    for (let i = 0; i < deltas.length; i++) {
      expect(deltas[i]).toBeCloseTo(DT * [1 / 3, 1 / 6, 1 / 6, 1 / 3][i]!, 10);
    }
    // Independent sums: (8 + 7) / (8 + 7 + 6), plus 2 residual pixels.
    expect(two.body.position.x).toBeCloseTo(17, 9);
    expect(three.body.position.x - 100).toBeCloseTo(23, 9);
    expect(two.body.position.y).toBeCloseTo(0.5, 9);
    expect(three.body.position.y).toBeCloseTo(1.5, 9);
    const expectedObservations = [[10, 10], [10, 9], [9, 9], [9, 8]];
    expect(observations).toHaveLength(expectedObservations.length);
    for (let i = 0; i < observations.length; i++) {
      expect(observations[i]![0]).toBeCloseTo(expectedObservations[i]![0]!, 9);
      expect(observations[i]![1]).toBeCloseTo(expectedObservations[i]![1]!, 9);
    }
    expect(two.calls.prepare.filter(([, additional]) => additional)).toHaveLength(1);
    expect(three.calls.prepare.filter(([, additional]) => additional)).toHaveLength(2);
    expect(two.calls.post).toHaveLength(1);
    expect(three.calls.post).toHaveLength(1);
    expect(engine.timing.timestamp).toBeCloseTo(DT, 10);
  });

  it.each([
    { name: 'ordinary', options: {} },
    { name: 'ignoring gravity', options: { ignoreGravity: true } },
    { name: 'sleeping', options: { isSleeping: true } },
    { name: 'static', options: { isStatic: true } },
    { name: 'custom time scale', options: { timeScale: 0.65 } },
  ])('preserves an unrelated $name body\'s full-frame position, velocity, force and friction', ({ options }) => {
    const subdivided = world();
    const single = world();
    const reference = referenceCharacter(subdivided, 3);
    const actual = ordinaryBody(subdivided, options);
    const expected = ordinaryBody(single, options);
    const frictionBefore = actual.frictionAir;
    const gravityBefore = { ...subdivided.gravity };
    step(subdivided, [reference.character]);
    Engine.update(single, DT);
    expectSameBody(actual, expected);
    expect(actual.force).toEqual(expected.force);
    expect(actual.torque).toBe(expected.torque);
    expect(actual.frictionAir).toBe(frictionBefore);
    expect(actual.timeScale).toBe(expected.timeScale);
    expect(subdivided.gravity).toEqual(gravityBefore);
    // Returning to a normal outer frame must not inherit the substep duration.
    Engine.update(subdivided, DT);
    Engine.update(single, DT);
    expectSameBody(actual, expected);
  });

  it('stops advancing and transporting an invalidated launch during the remaining outer frame', () => {
    const engine = world();
    engine.gravity.x = 0;
    const reference = referenceCharacter(engine, 3);
    let observed = 0;
    step(engine, [reference.character], () => {
      if (observed++ === 0) {
        reference.cancel();
        Body.setVelocity(reference.body, { x: 3, y: 0 });
      }
    });
    expect(reference.calls.prepare).toHaveLength(1);
    expect(reference.calls.begin).toEqual([3]);
    expect(reference.body.position.x).toBeCloseTo(10, 9); // 8, then 3 × 2/3.
    expect(reference.body.velocity.x).toBeCloseTo(3, 9);
    expect(reference.calls.substep).toBe(3);
    expect(reference.calls.post).toHaveLength(1);
  });

  it('observes a real wall contact before the grouped endpoint and abandons further launch ticks', () => {
    const engine = world();
    engine.gravity.x = 0;
    const reference = referenceCharacter(engine, 3, 0, true);
    reference.setEnergy({ x: 30, y: 0 });
    const wall = Bodies.rectangle(40, 0, 10, 1000, { isStatic: true });
    Composite.add(engine.world, wall);
    let contacts = 0;
    Events.on(engine, 'collisionStart', ({ pairs }: { pairs: any[] }) => {
      if (pairs.some(pair => (pair.bodyA === wall || pair.bodyB === wall) &&
          (pair.bodyA === reference.body || pair.bodyB === reference.body))) {
        contacts += 1;
        reference.cancel();
        Body.setVelocity(reference.body, { x: 0, y: 0 });
      }
    });
    step(engine, [reference.character]);
    expect(contacts).toBe(1);
    expect(reference.body.position.x).toBeLessThan(30);
    expect(reference.calls.prepare).toHaveLength(1);
    expect(reference.calls.begin).toEqual([3]);
  });

  it('defers newly queued forces until the next outer frame', () => {
    const engine = world();
    const single = world();
    const reference = referenceCharacter(engine, 3);
    const actual = ordinaryBody(engine);
    const expected = ordinaryBody(single);
    let observations = 0;
    step(engine, [reference.character], () => {
      if (observations++ === 0) {
        actual.force.x = 0.007;
        actual.torque = 0.0008;
      }
    });
    Engine.update(single, DT);
    expectSameBody(actual, expected);
    expect(actual.force.x).toBe(0.007);
    expect(actual.force.y).toBe(0);
    expect(actual.torque).toBe(0.0008);
  });

  it('restores transport velocity and temporary world/body settings if a physics step throws', () => {
    const engine = world();
    const reference = referenceCharacter(engine, 3);
    const ordinary = ordinaryBody(engine);
    const gravityBefore = { ...engine.gravity };
    const frictionBefore = ordinary.frictionAir;
    expect(() => stepCharacterPhysics({
      characters: [reference.character], bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: DT,
      stepWorld() { throw new Error('physics failed'); },
    })).toThrow('physics failed');
    expect(reference.calls.begin).toEqual([3]);
    expect(reference.calls.end).toBe(1);
    expect(engine.gravity).toEqual(gravityBefore);
    expect(ordinary.frictionAir).toBe(frictionBefore);
    expect(reference.body.velocity.x).toBeCloseTo(8 + gravityBefore.x * gravityBefore.scale * DT ** 2, 9);
  });
});
