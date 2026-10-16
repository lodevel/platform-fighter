import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { HitboxDamageHandler, type HitContext } from './HitboxDamageHandler';
import { spawnHitbox, type AttackMove } from '../characters/attacks';
import { CHARACTER_LABEL } from '../characters/Character';
import type { HitInfo } from '../characters/combat';
import type { Hurtbox } from '../characters/moveSchema';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import type { CollisionCapsule } from '../characters/capsuleGeometry';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const horizontal: CollisionCapsule = { start: { x: -10, y: 0 }, end: { x: 10, y: 0 }, radius: 2 };
const hurt = (capsule = horizontal, extra: Partial<Hurtbox> = {}): Hurtbox => ({
  id: 'authored-capsule', offsetX: 0, offsetY: 0, width: 50, height: 50, capsule, ...extra,
});

function attack(x: number, y: number, source = true): AttackMove {
  return { id: 'capsule-fixture', type: 'jab', damage: 10, knockback: { x: 1, y: -1, scaling: 0 },
    hitbox: { offsetX: x, offsetY: y, width: 0.5, height: 0.5 },
    startupFrames: 0, activeFrames: 4, recoveryFrames: 1, cooldownFrames: 0,
    ...(source ? { collisionHits: [{ id: 0, capsule: { start: { x, y }, end: { x, y }, radius: 0.25 } }] } : {}),
  };
}

function contact(move: AttackMove, hurtboxes: readonly Hurtbox[], options: {
  defenderFacing?: 1 | -1; attackerFacing?: 1 | -1; tinyBody?: boolean; rejectFirst?: boolean;
} = {}) {
  const engine = Engine.create(); engine.gravity.y = 0;
  const calls: { hit: HitInfo; context: HitContext }[] = [];
  let broadphasePairs = 0;
  const handler = new HitboxDamageHandler((_index, hit, context) => {
    calls.push({ hit, context }); return { confirmed: !options.rejectFirst || calls.length > 1 };
  });
  handler.setHurtboxLookup(() => hurtboxes);
  handler.setFacingLookup(() => options.defenderFacing ?? 1);
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, width: number, height: number, settings: object) {
      const body = Bodies.rectangle(x, y, width, height, settings); Composite.add(engine.world, body); return body;
    },
  }, world: { remove(body: unknown) { Composite.remove(engine.world, body); } } } };
  const sensor = spawnHitbox(scene, { id: 'fixture', bodyId: -1, position: { x: 0, y: 0 } }, move, options.attackerFacing ?? 1);
  const target = Bodies.rectangle(0, 0, options.tinyBody ? 1 : 50, options.tinyBody ? 1 : 50,
    { isStatic: true, label: CHARACTER_LABEL, plugin: { characterId: 'defender' },
      collisionFilter: { category: COLLISION_CATEGORIES.CHARACTER } });
  Composite.add(engine.world, target); handler.registerPlayer(0, target);
  const deliver = (event: any) => { broadphasePairs += event.pairs.length; handler.handleCollisionStart(event); };
  Events.on(engine, 'collisionStart', deliver); Events.on(engine, 'collisionActive', deliver);
  for (let step = 0; step < 4; step++) {
    Engine.update(engine, 1000 / 60); handler.sampleHurtboxContacts(Composite.allBodies(engine.world));
  }
  const result = { calls, broadphasePairs, sensorBounds: { ...sensor.bounds } };
  Engine.clear(engine); Composite.clear(engine.world, false); return result;
}

describe('explicit posed capsule hurtboxes through real Matter/live contact', () => {
  it.each([true, false])('rejects actual broadphase corner false positive with sourceCapsule=%s', source => {
    const result = contact(attack(12, 2, source), [hurt()]);
    expect(result.broadphasePairs).toBeGreaterThan(0);
    expect(result.calls).toEqual([]);
  });

  it.each([true, false])('confirms genuine rounded-end contact only once with sourceCapsule=%s', source => {
    const result = contact(attack(11.5, 1.5, source), [hurt()]);
    expect(result.broadphasePairs).toBeGreaterThan(0);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]!.hit.damage).toBe(10);
  });

  it.each([1, -1] as const)('hits a rotated extended limb in defender facing%s with a tiny movement body', defenderFacing => {
    const capsule = { start: { x: 30, y: -10 }, end: { x: 40, y: 0 }, radius: 2 };
    for (const attackerFacing of [1, -1] as const) {
      const worldX = 35 * defenderFacing;
      const result = contact(attack(worldX * attackerFacing, -5), [hurt(capsule, { width: 1, height: 1 })],
        { defenderFacing, attackerFacing, tinyBody: true });
      expect(result.broadphasePairs).toBe(0);
      expect(result.calls).toHaveLength(1);
      const miss = contact(attack(worldX * attackerFacing, 0), [hurt(capsule, { width: 1, height: 1 })],
        { defenderFacing, attackerFacing, tinyBody: true });
      expect(miss.calls).toEqual([]);
    }
  });

  it('uses exact capsule contact before source region priority and damage scaling', () => {
    const move = { ...attack(12, 2), collisionHits: [
      { id: 0, damage: 100, capsule: { start: { x: 12, y: 2 }, end: { x: 12, y: 2 }, radius: 0.25 } },
      { id: 1, damage: 8, capsule: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 0.25 } },
    ] };
    const result = contact(move, [hurt(horizontal, { damageMultiplier: 1.5 })]);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toMatchObject({ hit: { damage: 12 }, context: { collisionHitId: 1 } });
  });

  it('protects an intangible capsule and ignores it when a separate tangible region qualifies', () => {
    expect(contact(attack(0, 0), [hurt(horizontal, { intangible: true })]).calls).toEqual([]);
    const move = { ...attack(0, 0), collisionHits: [
      { id: 0, damage: 100, capsule: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 0.25 } },
      { id: 1, damage: 8, capsule: { start: { x: 30, y: 0 }, end: { x: 30, y: 0 }, radius: 0.25 } },
    ] };
    const result = contact(move, [hurt(horizontal, { intangible: true }), hurt(
      { start: { x: 30, y: 0 }, end: { x: 30, y: 0 }, radius: 1 }, { id: 'tangible' })]);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toMatchObject({ hit: { damage: 8 }, context: { collisionHitId: 1 } });
  });

  it('leaves rejected exact capsule contact eligible without repeated confirmed damage', () => {
    const result = contact(attack(0, 0), [hurt()], { rejectFirst: true });
    expect(result.calls).toHaveLength(2);
  });

  it('tests sweet-spot rectangles against capsule geometry instead of the broad enclosing rectangle', () => {
    const move = { ...attack(0, 0, false), hitbox: { offsetX: 0, offsetY: 0, width: 50, height: 50 },
      sweetSpot: { hitbox: { offsetX: 12, offsetY: 2, width: 0.5, height: 0.5 }, damageMultiplier: 2 } };
    expect(contact(move, [hurt()]).calls[0]!.hit.damage).toBe(10);
    const genuine = { ...move, sweetSpot: { ...move.sweetSpot, hitbox: { offsetX: 11.5, offsetY: 1.5, width: 0.5, height: 0.5 } } };
    expect(contact(genuine, [hurt()]).calls[0]!.hit.damage).toBe(20);
  });
});
