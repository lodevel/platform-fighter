import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { HitboxDamageHandler, type HitContext } from './HitboxDamageHandler';
import { spawnHitbox, type AttackMove } from '../characters/attacks';
import { LINK_JAB, LINK_JAB2, LINK_JAB3, LINK_FAIR, LINK_DTILT } from '../characters/Link';
import { resolveAttackHitWindow } from '../characters/attackHitWindows';
import { CHARACTER_LABEL } from '../characters/Character';
import type { HitInfo } from '../characters/combat';
import type { Hurtbox } from '../characters/moveSchema';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');

/** The move as the first source hit window resolves it: the shipped Link kit authors its capsules per window. */
const firstWindow = (move: AttackMove): AttackMove => resolveAttackHitWindow(move, move, move.hitWindows![0]!);
const JAB = firstWindow(LINK_JAB), JAB2 = firstWindow(LINK_JAB2), JAB3 = firstWindow(LINK_JAB3);
const DTILT = firstWindow(LINK_DTILT), FAIR = firstWindow(LINK_FAIR);

/** Tiny controlled hurtboxes isolate source regions; these are geometry tests,
 * not a claim that a normal fighter's full body fits inside each small region. */
function contact(move: AttackMove, positions: Array<{ x: number; y: number }>, options: {
  facing?: 1 | -1; targetFacing?: 1 | -1; grounded?: boolean; hurtboxes?: readonly Hurtbox[]; rejectFirst?: boolean;
  movementWidth?: number; sampleHurtboxes?: boolean;
} = {}) {
  const engine = Engine.create(); engine.gravity.y = 0;
  const hits: Array<{ target: number; hit: HitInfo; context: HitContext }> = [];
  let collisionPairs = 0;
  const handler = new HitboxDamageHandler((target, hit, context) => {
    hits.push({ target, hit, context });
    return { confirmed: !options.rejectFirst || hits.length > 1 };
  });
  handler.setGroundedLookup(() => options.grounded ?? false);
  handler.setFacingLookup(() => options.targetFacing ?? 1);
  if (options.hurtboxes) handler.setHurtboxLookup(() => options.hurtboxes!);
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, w: number, h: number, settings: object) {
      const body = Bodies.rectangle(x, y, w, h, settings); Composite.add(engine.world, body); return body;
    },
  }, world: { remove(body: unknown) { Composite.remove(engine.world, body); } } } };
  const sensor = spawnHitbox(scene, { id: 'link', bodyId: -1, position: { x: 0, y: 0 } }, move, options.facing ?? 1);
  const targets = positions.map((position, index) => {
    const body = Bodies.rectangle(position.x, position.y, options.movementWidth ?? (options.hurtboxes ? 220 : 1), 1,
      { isStatic: true, label: CHARACTER_LABEL, plugin: { characterId: 'target' },
        collisionFilter: { category: COLLISION_CATEGORIES.CHARACTER } });
    Composite.add(engine.world, body); handler.registerPlayer(index, body); return body;
  });
  const deliver = (event: any) => { collisionPairs += event.pairs.length; handler.handleCollisionStart(event); };
  Events.on(engine, 'collisionStart', deliver); Events.on(engine, 'collisionActive', deliver);
  for (let i = 0; i < 3; i++) {
    Engine.update(engine, 1000 / 60);
    if (options.sampleHurtboxes) handler.sampleHurtboxContacts(Composite.allBodies(engine.world));
  }
  const data = { hits, collisionPairs, sensorBounds: { ...sensor.bounds }, targetCount: targets.length };
  Engine.clear(engine); Composite.clear(engine.world, false); return data;
}

describe('source collision records through actual Matter overlap delivery', () => {
  it('hits an extended limb outside the movement body without repeating the hit', () => {
    const result = contact(JAB, [{ x: 0, y: -4 }], { movementWidth: 1, sampleHurtboxes: true, hurtboxes: [
      { id: 'extended-limb', offsetX: 94, offsetY: 0, width: 1, height: 1 },
    ] });
    expect(result.collisionPairs).toBe(0);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.context.collisionHitId).toBe(2);
  });
  it('rejects a hurtbox capsule-corner candidate outside the movement body', () => {
    const result = contact(JAB, [{ x: 0, y: -4 }], { movementWidth: 1, sampleHurtboxes: true, hurtboxes: [
      { id: 'extended-limb', offsetX: 98.8, offsetY: 8.8, width: 0.1, height: 0.1 },
    ] });
    expect(result.collisionPairs).toBe(0);
    expect(result.hits).toEqual([]);
  });
  it('cannot hit an intangible extended limb', () => {
    const result = contact(JAB, [{ x: 0, y: -4 }], { movementWidth: 1, sampleHurtboxes: true, hurtboxes: [
      { id: 'extended-limb', offsetX: 94, offsetY: 0, width: 1, height: 1, intangible: true },
    ] });
    expect(result.collisionPairs).toBe(0);
    expect(result.hits).toEqual([]);
  });
  it('mirrors an extended limb outside the movement body', () => {
    const result = contact(JAB, [{ x: 188, y: -4 }], { targetFacing: -1, movementWidth: 1, sampleHurtboxes: true, hurtboxes: [
      { id: 'extended-limb', offsetX: 94, offsetY: 0, width: 1, height: 1 },
    ] });
    expect(result.collisionPairs).toBe(0);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.context.collisionHitId).toBe(2);
  });
  it('does not hit the empty space opposite a left-facing offset hurtbox', () => {
    const result = contact(JAB, [{ x: 0, y: -4 }], { targetFacing: -1, hurtboxes: [
      { id: 'extended-limb', offsetX: 94, offsetY: 0, width: 1, height: 1 },
    ] });
    expect(result.collisionPairs).toBeGreaterThan(0);
    expect(result.hits).toEqual([]);
  });
  it('hits the actual left-facing limb and selects its source region', () => {
    const result = contact(JAB, [{ x: 188, y: -4 }], { targetFacing: -1, hurtboxes: [
      { id: 'extended-limb', offsetX: 94, offsetY: 0, width: 1, height: 1 },
    ] });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.context.collisionHitId).toBe(2);
  });
  it.each([JAB, JAB2])('$id selects an inner hit on overlap and its inward tip for another target', move => {
    const outer = move.id === LINK_JAB.id ? 94 : 104;
    const result = contact(move, [{ x: 45, y: -4 }, { x: outer, y: -4 }], { grounded: true });
    expect(result.collisionPairs).toBeGreaterThan(2);
    expect(result.hits).toHaveLength(2);
    expect(result.hits.find(row => row.target === 0)!).toMatchObject({ context: { collisionHitId: 0 },
      hit: { damage: 3, knockback: { reference: { base: 25, growth: 25, angle: 361 } } } });
    expect(result.hits.find(row => row.target === 1)!).toMatchObject({ context: { collisionHitId: 2 },
      hit: { damage: 3, knockback: { reference: { base: 20, growth: 15, angle: 180 } } } });
  });
  it('rejects the broadphase-only spherical corner without consuming a hit', () => {
    const result = contact(JAB3, [{ x: 119.9, y: 19.9 }]);
    expect(result.collisionPairs).toBeGreaterThan(0);
    expect(result.hits).toEqual([]);
  });
  it('mirrors capsule positions and inward launch axis consistently', () => {
    const result = contact(JAB, [{ x: -94, y: -4 }], { facing: -1 });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ context: { collisionHitId: 2 }, hit: { facing: -1,
      knockback: { reference: { angle: 180 } }, hitlagMultiplier: 1.6, sdiMultiplier: 1 } });
  });
  it('an intangible inner hurtbox cannot steal priority from a tangible tip contact', () => {
    const result = contact(JAB, [{ x: 0, y: -4 }], { hurtboxes: [
      { id: 'inner', offsetX: 45, offsetY: 0, width: 1, height: 1, intangible: true },
      { id: 'outer', offsetX: 94, offsetY: 0, width: 1, height: 1, damageMultiplier: 1.5 },
    ] });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ context: { collisionHitId: 2 }, hit: { damage: 4.5 } });
  });
  it('a rejected callback leaves the same selected source record eligible on the next overlap', () => {
    const result = contact(JAB, [{ x: 94, y: -4 }], { rejectFirst: true });
    expect(result.hits).toHaveLength(2);
    expect(result.hits.map(row => row.context.collisionHitId)).toEqual([2, 2]);
  });
  it.each([
    { x: 100, grounded: true, id: 0, reference: { base: 31, growth: 28, angle: 43, setWeight: true } },
    { x: 60, grounded: true, id: 2, reference: { base: 33, growth: 30, angle: 47, setWeight: true } },
    { x: 10, grounded: true, id: 4, reference: { base: 33, growth: 28, angle: 47, setWeight: true } },
    { x: 10, grounded: false, id: 5, reference: { base: 26, growth: 26, angle: 38, setWeight: true } },
  ])('fair source $id overrides legacy carry and launch data', ({ x, grounded, id, reference }) => {
    const result = contact(FAIR, [{ x, y: -21.5 }], { grounded });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ context: { collisionHitId: id },
      hit: { damage: 8, hitlagMultiplier: 0.8, knockback: { reference } } });
    expect(result.hits[0]!.hit.velocityCarry).toBeUndefined();
  });
  it('fair airborne outer region carries its authored autolink launch', () => {
    const result = contact(FAIR, [{ x: 100, y: -21.5 }]);
    expect(result.hits[0]).toMatchObject({ context: { collisionHitId: 1 },
      hit: { knockback: { reference: { base: 25, growth: 30, angle: 367, setWeight: true } } } });
  });
  it('diagonal down tilt rejects its off-axis broadphase corner', () => {
    const result = contact(DTILT, [{ x: 55, y: 20 }, { x: 95, y: 2 }]);
    expect(result.collisionPairs).toBeGreaterThan(1);
    expect(result.hits.map(row => row.target)).toEqual([0]);
  });
});


describe('native metadata on actual selected collision sensors',()=>{
  it.each([false,true,undefined])('keeps selected force %s and never inherits parent metadata',force=>{
    const region={id:0,capsule:{start:{x:0,y:0},end:{x:0,y:0},radius:4},
      ...(force===undefined?{}:{nativeCollisionAttribute:'collision_attr_elec',nativeForceReaction:force})};
    const move={...JAB,nativeCollisionAttribute:'collision_attr_normal',nativeForceReaction:false,
      collisionHits:[region]};
    const result=contact(move,[{x:0,y:0}]);expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.hit.nativeForceReaction).toBe(force);
    expect(result.hits[0]!.hit.nativeCollisionAttribute).toBe(force===undefined?undefined:'collision_attr_elec');
  });
});


it('a selected window inherits capsule/rules but cannot borrow previous per-ID native armor metadata',()=>{
  const capsule={start:{x:0,y:0},end:{x:0,y:0},radius:4};
  const source={...JAB,nativeCollisionAttribute:'collision_attr_normal',nativeForceReaction:false,
    collisionHits:[{id:0,capsule,damage:6,direct:false,tripChance:.4,nativeCollisionAttribute:'collision_attr_elec',nativeForceReaction:false}]};
  const selected=resolveAttackHitWindow(source,source,{startFrame:3,endFrame:4});
  const result=contact(selected,[{x:0,y:0}]);expect(result.hits).toHaveLength(1);
  expect(result.hits[0]!.hit).toMatchObject({damage:6,direct:false,tripChance:.4});
  expect(result.hits[0]!.hit.nativeCollisionAttribute).toBeUndefined();
  expect(result.hits[0]!.hit.nativeForceReaction).toBeUndefined();
  expect(selected.collisionHits![0]!.capsule).toEqual(capsule);
  expect(source.collisionHits[0]!.nativeCollisionAttribute).toBe('collision_attr_elec');
});
