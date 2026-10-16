import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Character, CHARACTER_LABEL, type CharacterInput } from './Character';
import { PIKACHU_JAB, pikachuSourceHits } from './pikachuSourceMoves';
import { PIKACHU_NATIVE_ATTACKS } from './pikachuAttackData';
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

/** A partial action preparation fixture, deliberately outside the playable roster. */
function fixture(facing: 1 | -1, targetX: number) {
  const engine = Engine.create();
  const eventNames: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
    const body = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, body); return body;
  } }, world: { on(name: string, fn: any) { Events.on(engine, eventNames[name] ?? name, fn); },
    off(name: string, fn: any) { Events.off(engine, eventNames[name] ?? name, fn); },
    remove(body: any) { Composite.remove(engine.world, body); } } } };
  // Existing ID supplies the fixture's shared physics defaults, never Volt's kit.
  const attacker = new Character(scene, { id: 'pikachu', spawnX: 0, spawnY: 0, width: 40, height: 50 });
  registerFighterAttack(attacker, PIKACHU_JAB);
  const target = Bodies.rectangle(targetX * facing, 10, 1, 1, { isStatic: true, isSensor: true,
    label: CHARACTER_LABEL, plugin: { characterId: 'target' }, collisionFilter: { category: COLLISION_CATEGORIES.CHARACTER } });
  const floor = Bodies.rectangle(0, 35, 2000, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } });
  Composite.add(engine.world, [target, floor]);
  const contacts: { hit: HitInfo; region?: number }[] = [];
  const handler = new HitboxDamageHandler((index, hit, context) => {
    if (index !== 1) return { confirmed: false };
    contacts.push({ hit, region: context.collisionHitId }); return { confirmed: true };
  });
  handler.registerPlayer(0, attacker.body); handler.registerPlayer(1, target);
  handler.setGroundedLookup(() => true);
  handler.setFacingLookup(index => index === 0 ? attacker.getFacing() : 1);
  handler.setHurtboxLookup(index => index === 0 ? attacker.getActiveHurtboxes()
    : [{ id: 'probe', offsetX: 0, offsetY: 0, width: 1, height: 1 }]);
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
  const step = (input: CharacterInput = neutral) => {
    attacker.applyInput(input);
    stepCharacterPhysics({ characters: [attacker], bodies: Composite.allBodies(engine.world), gravity: engine.gravity,
      body: Body, deltaMs: 1000 / 60, stepWorld: dt => {
        Engine.update(engine, dt); handler.sampleHurtboxContacts(Composite.allBodies(engine.world));
      } });
  };
  for (let i = 0; i < 12; i++) step();
  attacker.setFacing(facing);
  return { attacker, step, contacts };
}

describe('Pikachu source preparation, separate from complete fighter acceptance', () => {
  it('preserves every captured native field in all 145 compiled regions', () => {
    const capture = JSON.parse(readFileSync(new URL('../../docs/review/2026-10-06/pikachu-character/sources/native-attacks.json', import.meta.url), 'utf8'));
    let count = 0;
    for (const [motion, rows] of Object.entries(PIKACHU_NATIVE_ATTACKS)) {
      const source = capture.motions[motion].functions.find((fn: any) => fn.name.startsWith('game_') && fn.attacks.length);
      expect(rows).toEqual(source.attacks); count += rows.length;
    }
    expect(count).toBe(145);
  });
  it('retains gaps and the down-smash finisher omitted by UFD active text', () => {
    expect(pikachuSourceHits('pikachu/AttackLw4', 10)).toEqual([]);
    expect(pikachuSourceHits('pikachu/AttackLw4', 22)).toEqual([]);
    expect(pikachuSourceHits('pikachu/AttackLw4', 23)).toMatchObject([{ id: 0, damage: 3 }]);
    expect(pikachuSourceHits('pikachu/AttackLw4', 24)).toEqual([]);
  });
  it('refuses unsupplied posed bone transforms', () => {
    expect(() => pikachuSourceHits('pikachu/AttackS3', 6)).toThrow('Missing posed Pikachu bone');
    expect(() => pikachuSourceHits('pikachu/AttackAirB', 4)).toThrow('Missing posed Pikachu bone');
  });
  it.each([1, -1] as const)('routes source regional priority and a capsule edge miss through real Matter contact facing %s', facing => {
    for (const [x, damage, region] of [[36, 1.4, 0], [65, 1, 2], [83, undefined, undefined]] as const) {
      const { step, contacts } = fixture(facing, x);
      step({ ...neutral, attack: true }); expect(contacts).toHaveLength(0);
      step(); step(); step();
      if (damage === undefined) expect(contacts).toHaveLength(0);
      else { expect(contacts).toHaveLength(1); expect(contacts[0]).toMatchObject({ region, hit: { damage } }); }
    }
  });
  it('restarts the same sourced jab at frame7 without an invented later stage', () => {
    const { attacker, step, contacts } = fixture(1, 36);
    step({ ...neutral, attack: true });
    for (let i = 0; i < 5; i++) step();
    expect(attacker.getActiveAttack()?.framesElapsed).toBe(5);
    step({ ...neutral, attack: true });
    expect(attacker.getActiveAttack()).toMatchObject({ move: { id: 'pikachu.jab' }, framesElapsed: 0 });
    step(); step();
    expect(contacts).toHaveLength(2);
  });
});
