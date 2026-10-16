import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, CHARACTER_LABEL, type CharacterInput } from './Character';
import { buildPikachuNormalMove, type PikachuNormalId } from './pikachuNormalMoves';
import { registerFighterAttack } from './attackRegistration';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import type { HitInfo } from './combat';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };

/** Real contact probes for source preparations, outside the playable roster.
 * The one-pixel stationary target confirms timing/identity/geometry only;
 * it does not stand in for Pikachu's unprovided art, hurtboxes or launch physics. */
function fixture(id: PikachuNormalId, facing: 1 | -1, targetX: number, targetY: number) {
  const engine = Engine.create();
  const eventNames: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
    const body = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, body); return body;
  } }, world: { on(name: string, fn: any) { Events.on(engine, eventNames[name] ?? name, fn); },
    off(name: string, fn: any) { Events.off(engine, eventNames[name] ?? name, fn); },
    remove(body: any) { Composite.remove(engine.world, body); } } } };
  const attacker = new Character(scene, { id: 'donkeykong', spawnX: 0, spawnY: 0, width: 40, height: 50 });
  const move = buildPikachuNormalMove(id);
  registerFighterAttack(attacker, move);
  const target = Bodies.rectangle(targetX * facing, targetY, 1, 1, { isStatic: true, isSensor: true,
    label: CHARACTER_LABEL, plugin: { characterId: 'target' }, collisionFilter: { category: COLLISION_CATEGORIES.CHARACTER } });
  const floor = Bodies.rectangle(0, 35, 2000, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } });
  Composite.add(engine.world, [target, floor]);
  let elapsed = -1;
  const contacts: { hit: HitInfo; elapsed: number; region?: number }[] = [];
  const handler = new HitboxDamageHandler((index, hit, context) => {
    if (index !== 1) return { confirmed: false };
    contacts.push({ hit, elapsed, region: context.collisionHitId }); return { confirmed: true };
  });
  handler.registerPlayer(0, attacker.body); handler.registerPlayer(1, target);
  handler.setGroundedLookup(() => true);
  handler.setFacingLookup(index => index === 0 ? attacker.getFacing() : 1);
  handler.setHurtboxLookup(index => index === 0 ? attacker.getActiveHurtboxes()
    : [{ id: 'probe', offsetX: 0, offsetY: 0, width: 1, height: 1 }]);
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
  const step = () => {
    attacker.applyInput(neutral);
    elapsed = attacker.getActiveAttack()?.framesElapsed ?? -1;
    stepCharacterPhysics({ characters: [attacker], bodies: Composite.allBodies(engine.world), gravity: engine.gravity,
      body: Body, deltaMs: 1000 / 60, stepWorld: dt => {
        Engine.update(engine, dt); handler.sampleHurtboxContacts(Composite.allBodies(engine.world));
      } });
  };
  for (let i = 0; i < 12; i++) step();
  attacker.setFacing(facing);
  expect(attacker.attemptAttack(move.id)).toBe(true);
  const run = (frames: number) => { for (let i = 0; i < frames; i++) step(); };
  return { attacker, run, contacts };
}

describe('Pikachu normal preparation through real Matter contacts', () => {
  it.each([1, -1] as const)('keeps forward smash one strike across continuous moving replacements, facing %s', facing => {
    const { contacts, run, attacker } = fixture('forward-smash', facing, 90, -10);
    run(53);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ hit: { damage: 18 }, region: 0 });
    run(1);
    expect(attacker.getActiveAttack()).toBeNull();
  });

  it.each([1, -1] as const)('uses late forward-smash geometry and rejects a beyond-edge target, facing %s', facing => {
    const late = fixture('forward-smash', facing, 120, -10);
    late.run(53);
    expect(late.contacts).toHaveLength(1);
    expect(late.contacts[0]).toMatchObject({ hit: { damage: 12 }, region: 0 });
    const miss = fixture('forward-smash', facing, 150, -10);
    miss.run(53);
    expect(miss.contacts).toHaveLength(0);
  });

  it.each([1, -1] as const)('allows six down-smash strikes only after native clears, facing %s', facing => {
    const { contacts, run } = fixture('down-smash', facing, 40, 0);
    run(65);
    expect(contacts.map(contact => contact.hit.damage)).toEqual([2, 2, 2, 2, 2, 3]);
    const offsets = contacts.map(contact => contact.elapsed - contacts[0]!.elapsed);
    expect(offsets).toEqual([0, 3, 6, 9, 12, 15]);
  });
});
