import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { HitboxDamageHandler } from './HitboxDamageHandler';
import { AttackContactLedger } from './AttackContactLedger';
import { spawnHitbox, despawnHitbox, type AttackMove } from '../characters/attacks';
import type { PhysicsHost } from '../physics/PhysicsWorld';
import { CHARACTER_LABEL } from '../characters/Character';
import { pikachuNormalFrame } from '../characters/pikachuNormalMoves';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');

/** Exact source regions/interval3, explicit authored actor-elapsed clock.
 * This proves execution of that policy, not native hit-stop clock parity. */
function fixture(facing: 1 | -1, reject?: (target: number, frame: number) => boolean) {
  const engine = Engine.create(); engine.gravity.y = 0;
  const scene = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
    const body = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, body); return body;
  } }, world: { remove(body: any) { Composite.remove(engine.world, body); } } } } as unknown as PhysicsHost;
  const target = (x: number, y: number) => Bodies.rectangle(x * facing, y, 1, 1, { isStatic: true, isSensor: true,
    label: CHARACTER_LABEL, plugin: { characterId: 'target' }, collisionFilter: { category: COLLISION_CATEGORIES.CHARACTER } });
  const first = target(45, 17.5), second = target(300, -22.5);
  Composite.add(engine.world, [first, second]);
  const hits: { target: number; frame: number; damage: number; region?: number }[] = [];
  const attempts: { target: number; frame: number }[] = [];
  let clock = 0, sensor: MatterJS.BodyType | null = null;
  const identity = {}, finishIdentity = {};
  const handler = new HitboxDamageHandler((target, hit, context) => {
    attempts.push({ target, frame: clock });
    if (reject?.(target, clock)) return { confirmed: false };
    hits.push({ target, frame: clock, damage: hit.damage, region: context.collisionHitId });
    return { confirmed: true };
  });
  handler.registerPlayer(1, first); handler.registerPlayer(2, second);
  handler.setGroundedLookup(() => false);
  handler.setHurtboxLookup(() => [{ id: 'probe', offsetX: 0, offsetY: 0, width: 1, height: 1 }]);
  handler.setRehitClockLookup(() => clock);
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
  const sample = () => { Engine.update(engine, 1000 / 60); handler.sampleHurtboxContacts(Composite.allBodies(engine.world)); };
  const step = (frame: number, secondPresent = false, actionIdentity = identity) => {
    clock = frame;
    if (sensor) { handler.forgetHitbox(sensor); despawnHitbox(scene, sensor); sensor = null; }
    Body.setPosition(second, { x: (secondPresent ? 45 : 300) * facing, y: -22.5 });
    const source = pikachuNormalFrame('forward-air', frame);
    if (source.collisionHits.length) {
      const collisionHits = source.collisionHits.map(hit => ({ ...hit,
        ...(source.perTargetRehitFrames ? { rehitFrames: source.perTargetRehitFrames } : {}) }));
      const move: AttackMove = { id: 'pikachu.fair-policy-fixture', type: 'aerial', damage: collisionHits[0]!.damage!,
        knockback: collisionHits[0]!.knockback!, hitbox: { offsetX: 50, offsetY: 0, width: 100, height: 100 },
        collisionHits, startupFrames: 0, activeFrames: 1, recoveryFrames: 0, cooldownFrames: 0 };
      sensor = spawnHitbox(scene, { id: 'fixture', bodyId: 999999, position: { x: 0, y: 0 } }, move, facing);
      sensor.plugin.hitGroup = frame === 26 ? finishIdentity : actionIdentity;
    }
    sample();
  };
  return { handler, hits, attempts, step, sample, sensor: () => sensor, clock: () => clock, newAction: () => ({}) };
}

describe('Explicit per-target re-hit clock policy through actual Matter sensors', () => {
  it.each([1, -1] as const)('has five links, clear gap and separate finisher, with independently late target, facing %s', facing => {
    const world = fixture(facing);
    for (let elapsed = 0; elapsed < 41; elapsed++) world.step(elapsed, elapsed >= 11);
    const first = world.hits.filter(hit => hit.target === 1);
    const second = world.hits.filter(hit => hit.target === 2);
    expect(first.map(hit => hit.frame)).toEqual([10, 13, 16, 19, 22, 26]);
    expect(second.map(hit => hit.frame)).toEqual([11, 14, 17, 20, 23, 26]);
    expect(first.slice(0, 5).map(hit => hit.damage)).toEqual([1.3, 1.3, 1.3, 1.3, 1.3]);
    expect(second.slice(0, 5).every(hit => hit.region === 1)).toBe(true);
    expect(first.at(-1)?.damage).toBe(4.8);
    expect(world.hits.some(hit => hit.frame === 25 || hit.frame >= 27)).toBe(false);
  });
  it('survives sensor replacement and physical substeps with a frozen gameplay clock', () => {
    const world = fixture(1);
    world.step(10);
    for (let substep = 0; substep < 20; substep++) world.sample();
    world.step(10); world.step(11); world.step(12);
    expect(world.hits.map(hit => hit.frame)).toEqual([10]);
    world.step(13); expect(world.hits.map(hit => hit.frame)).toEqual([10, 13]);
    world.step(13); expect(world.hits).toHaveLength(2);
  });
  it('rejected first and eligible repeat contacts do not start or renew cooldown', () => {
    const world = fixture(1, (target, frame) => target === 1 && (frame === 10 || frame === 14));
    for (let elapsed = 10; elapsed < 25; elapsed++) world.step(elapsed);
    expect(world.hits.map(hit => hit.frame)).toEqual([11, 15, 18, 21, 24]);
    expect(world.attempts.some(hit => hit.frame === 14)).toBe(true);
  });
  it('a new action identity can hit immediately while earlier action cooldown remains live', () => {
    const world = fixture(1); world.step(10); world.step(11, false, world.newAction());
    expect(world.hits.map(hit => hit.frame)).toEqual([10, 11]);
  });
  it('requires an explicitly injected gameplay clock for repeating regions', () => {
    const world = fixture(1); world.handler.setRehitClockLookup(null);
    expect(() => world.step(10)).toThrow('requires an explicit non-negative gameplay clock');
  });
  it('supplies the actual live sensor so a caller can reject stale ownership', () => {
    const world = fixture(1);
    const sensors: unknown[] = [];
    world.handler.setRehitClockLookup((owner, sensor) => {
      expect(owner).toBe(999999);
      expect(sensor).toBe(world.sensor());
      sensors.push(sensor);
      return world.clock();
    });
    world.step(10); const original = world.sensor(); world.step(13);
    expect(world.sensor()).not.toBe(original);
    expect(sensors).toContain(original);
    expect(sensors).toContain(world.sensor());
    world.handler.setRehitClockLookup((_owner, sensor) => sensor === original ? world.clock() : null);
    expect(() => world.step(16)).toThrow('requires an explicit non-negative gameplay clock');
    expect(world.hits.map(hit => hit.frame)).toEqual([10, 13]);
  });
  it('retains permanent confirmation for ordinary swings and resets deterministic history', () => {
    const ledger = new AttackContactLedger(), group = {};
    ledger.confirm(group, 1); expect(ledger.canConfirm(group, 1)).toBe(false);
    expect(ledger.canConfirm(group, 2)).toBe(true);
    ledger.reset(); expect(ledger.canConfirm(group, 1)).toBe(true);
    ledger.confirm(group, 1, 3, 10);
    expect(() => ledger.canConfirm(group, 1, 3, 9)).toThrow('moved backward');
    ledger.forget(group); expect(ledger.canConfirm(group, 1, 3, 0)).toBe(true);
  });
});
