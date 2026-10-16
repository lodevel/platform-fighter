import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Link } from './Link';
import type { CharacterInput } from './Character';
import type { HitInfo } from './combat';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { GAME_CONFIG } from '../engine/constants';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const LONG_FALL_HIT: HitInfo = {
  damage: 1, knockback: { x: 12, y: 0, scaling: 0 }, facing: 1, minHitstunFrames: 40,
};

function world(options: { gravity?: number; ignoreGravity?: boolean } = {}) {
  const engine = Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = options.gravity ?? GAME_CONFIG.gravity;
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
  const ch = new Link(scene, { spawnX: 0, spawnY: 0 });
  const body = ch.body as typeof ch.body & { ignoreGravity?: boolean };
  body.ignoreGravity = options.ignoreGravity ?? false;
  const step = (input: CharacterInput = NEUTRAL) => {
    ch.applyInput(input);
    const gravityDeltaY = body.ignoreGravity || body.isStatic || body.isSleeping ? 0
      : engine.gravity.y * engine.gravity.scale * GAME_CONFIG.fixedTimestepMs ** 2;
    Engine.update(engine, GAME_CONFIG.fixedTimestepMs);
    ch.applyPostPhysicsVelocityConstraints(gravityDeltaY);
  };
  const finishHitstun = () => {
    for (let frame = 0; frame < 300 && (ch.getHitlagRemaining() > 0 || ch.isInHitstun()); frame++) step();
    expect(ch.getHitlagRemaining()).toBe(0);
    expect(ch.getHitstunRemaining()).toBe(0);
  };
  const hitThroughStun = (hit: HitInfo = LONG_FALL_HIT) => {
    ch.applyHit(hit);
    finishHitstun();
  };
  const ceiling = () => {
    const pos = ch.getPosition();
    const roof = Bodies.rectangle(pos.x, pos.y - ch.getTuning().height / 2 - 11, 2000, 20, {
      isStatic: true, label: PLATFORM_LABELS.solid,
      collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
    });
    Composite.add(engine.world, roof);
    return roof;
  };
  return { ch, scene, engine, step, hitThroughStun, finishHitstun, ceiling };
}

function matchBody(reference: ReturnType<typeof world>, source: ReturnType<typeof world>) {
  Body.setPosition(reference.ch.body, source.ch.getPosition());
  Body.setVelocity(reference.ch.body, source.ch.getVelocity());
}

function expectSameVelocity(actual: ReturnType<typeof world>, reference: ReturnType<typeof world>) {
  expect(actual.ch.getVelocity().x).toBeCloseTo(reference.ch.getVelocity().x, 8);
  expect(actual.ch.getVelocity().y).toBeCloseTo(reference.ch.getVelocity().y, 8);
}

describe('Character launch recovery through real Matter integration', () => {
  it.each([
    { name: 'downward launch', hit: { ...LONG_FALL_HIT, knockback: { x: 0, y: 20, scaling: 0 } } },
    { name: 'downward velocity carry', hit: { ...LONG_FALL_HIT, velocityCarry: { x: 0, y: 12 } } },
  ])('caps only accumulated gravity while preserving $name', ({ hit }) => {
    const falling = world();
    const vacuum = world({ gravity: 0 });
    falling.hitThroughStun(hit);
    vacuum.hitThroughStun(hit);
    const retainedMotion = vacuum.ch.getVelocity().y;
    const cap = falling.ch.getTuning().maxFallSpeed;
    expect(retainedMotion).toBeGreaterThan(0);
    expect(falling.ch.getVelocity().y).toBeGreaterThan(retainedMotion + cap);
    falling.step();
    expect(falling.ch.getVelocity().y).toBeCloseTo(retainedMotion + cap, 8);
  });

  it('preserves wind added after the final stunned physics step while removing only the queued gravity excess', () => {
    const { ch, step, hitThroughStun } = world();
    hitThroughStun();
    const velocity = ch.getVelocity();
    const wind = 4;
    expect(velocity.y).toBeGreaterThan(ch.getTuning().maxFallSpeed);
    Body.setVelocity(ch.body, { x: velocity.x, y: velocity.y + wind });
    step();
    expect(ch.getVelocity().y).toBeCloseTo(ch.getTuning().maxFallSpeed + wind, 8);
  });

  it.each([
    { name: 'world gravity disabled', options: { gravity: 0 } },
    { name: 'body ignoring gravity', options: { ignoreGravity: true } },
  ])('$name does not invent a recovery correction', ({ options }) => {
    const recovering = world(options);
    const reference = world(options);
    recovering.hitThroughStun({ ...LONG_FALL_HIT, knockback: { x: 0, y: 20, scaling: 0 } });
    matchBody(reference, recovering);
    recovering.step();
    reference.step();
    expectSameVelocity(recovering, reference);
  });

  it.each(['jump', 'directional dodge'] as const)('a fresh %s owns its velocity before and after Matter', action => {
    const recovering = world();
    const reference = world();
    recovering.hitThroughStun();
    matchBody(reference, recovering);
    const input = action === 'jump' ? { ...NEUTRAL, jump: true }
      : { ...NEUTRAL, moveX: 1, moveY: -1, dodge: true };
    recovering.step(input);
    reference.step(input);
    if (action === 'jump') expect(recovering.ch.getJumpsUsed()).toBe(1);
    else expect(recovering.ch.isDodging()).toBe(true);
    expectSameVelocity(recovering, reference);
    recovering.step();
    reference.step();
    expectSameVelocity(recovering, reference);
  });

  it.each(['incoming hit', 'capture', 'round reset'] as const)('%s clears a queued gravity correction', interruption => {
    const recovering = world();
    const reference = world();
    recovering.hitThroughStun();
    matchBody(reference, recovering);
    if (interruption === 'incoming hit') {
      const nextHit: HitInfo = { damage: 1, knockback: { x: 0, y: -5, scaling: 0 }, facing: 1 };
      for (const fixture of [recovering, reference]) {
        fixture.ch.applyHit(nextHit);
        fixture.finishHitstun();
      }
    } else if (interruption === 'capture') {
      for (const fixture of [recovering, reference]) {
        const grabber = new Link(fixture.scene, { spawnX: 5000, spawnY: 0 });
        fixture.ch.applyGrabbed(grabber);
        fixture.step();
        fixture.ch.releaseFromGrab();
      }
    } else {
      recovering.ch.resetForRound(0, -500);
      reference.ch.resetForRound(0, -500);
    }
    recovering.step();
    reference.step();
    expectSameVelocity(recovering, reference);
  });

  it('accounts for a ceiling contact on the final stunned physics step before computing recovery', () => {
    const { ch, engine, step, ceiling } = world();
    ch.applyHit(LONG_FALL_HIT);
    for (let frame = 0; frame < 300 && (ch.getHitlagRemaining() > 0 || ch.getHitstunRemaining() > 1); frame++) step();
    expect(ch.getHitstunRemaining()).toBe(1);
    const roof = ceiling();
    Body.setVelocity(ch.body, { x: ch.getVelocity().x, y: -4 });
    step();
    expect(ch.getHitstunRemaining()).toBe(0);
    expect(engine.pairs.list.some((pair: any) => pair.isActive &&
      (pair.bodyA === roof || pair.bodyB === roof) &&
      pair.collision.normal.y * (pair.bodyA === ch.body ? 1 : -1) > 0.5)).toBe(true);
    step();
    expect(ch.getVelocity().y).toBeGreaterThanOrEqual(-1e-8);
    expect(ch.getVelocity().y).toBeLessThanOrEqual(ch.getTuning().maxFallSpeed + 1e-8);
  });
});
