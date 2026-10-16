import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';
import { Character, CHARACTER_LABEL, type CharacterInput } from './Character';
import { buildPikachuJabWithAuthoredHurtboxes, PIKACHU_JAB_AUTHORED_HURTBOX_POSES } from './pikachuJabHurtboxes';
import { selectSimulationAttackFrame } from './simulationSpriteAnimation';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { serializeCharacterDataSpec, parseCharacterDataFile } from './characterSerializer';
import { createCharacterById, applyCharacterMoveOverrides } from './characterFactory';

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
function fixture(facing: 1 | -1, targetX: number, saved = false) {
  const engine = Engine.create();
  const eventNames: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
    const body = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, body); return body;
  } }, world: { on(name: string, fn: any) { Events.on(engine, eventNames[name] ?? name, fn); },
    off(name: string, fn: any) { Events.off(engine, eventNames[name] ?? name, fn); },
    remove(body: any) { Composite.remove(engine.world, body); } } } };
  // An existing ID supplies the fixture's shared physics defaults; the jab under test is registered on top.
  const options = {spawnX:0,spawnY:0,width:40,height:50};
  const move = buildPikachuJabWithAuthoredHurtboxes();
  const attacker = saved ? createCharacterById(scene, 'pikachu', options) : new Character(scene, {id:'pikachu',...options});
  if(saved)applyCharacterMoveOverrides(attacker,parseCharacterDataFile(JSON.parse(JSON.stringify({...serializeCharacterDataSpec(getAuthorableCharacterSpec('pikachu')),moves:{jab:move}}))));
  else registerFighterAttack(attacker,move);
  const target = Bodies.rectangle(targetX * facing, 10, 1, 1, { isStatic: true, isSensor: true,
    label: CHARACTER_LABEL, plugin: { characterId: 'target' }, collisionFilter: { category: COLLISION_CATEGORIES.CHARACTER } });
  const floor = Bodies.rectangle(0, 35, 2000, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } });
  Composite.add(engine.world, [target, floor]);
  const contacts: { hit: HitInfo; region?: number; elapsed?: number }[] = [];
  const handler = new HitboxDamageHandler((index, hit, context) => {
    if (index !== 1) return { confirmed: false };
    contacts.push({ hit, region: context.collisionHitId, elapsed:attacker.getActiveAttack()?.framesElapsed }); return { confirmed: true };
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

describe('Pikachu authored jab timeline through real shared physics and saved routing', () => {
  for(const saved of [false,true])for(const facing of [1,-1] as const)for(const [x,damage,region] of [[36,1.4,0],[54,1.2,1],[77,1,2],[82,undefined,undefined]] as const){
    it(`checks all17steps, regional contact, clear and drawing holds ${saved}/${facing}/${x}`,()=>{
      const {attacker,step,contacts}=fixture(facing,x,saved);
      step({...neutral,attack:true});
      for(let elapsed=0;elapsed<17;elapsed++){
        const active=attacker.getActiveAttack()!;expect(active.move.id).toBe('pikachu.jab');expect(active.framesElapsed).toBe(elapsed);
        const pose=PIKACHU_JAB_AUTHORED_HURTBOX_POSES.find(row=>elapsed>=row.startElapsed && elapsed<row.endElapsed)!;
        expect(selectSimulationAttackFrame(active.move,elapsed,9,'jab')).toBe(PIKACHU_JAB_AUTHORED_HURTBOX_POSES.indexOf(pose));
        expect(attacker.getActiveHurtboxes()).toEqual(pose.hurtboxes);
        expect(active.hitboxBody!==null).toBe(elapsed>=1 && elapsed<3);
        expect(attacker.isGrounded()).toBe(true);step();
      }
      expect(attacker.getActiveAttack()).toBeNull();
      if(damage===undefined)expect(contacts).toEqual([]);
      else{expect(contacts).toHaveLength(1);expect(contacts[0]).toMatchObject({region,elapsed:1,hit:{damage}});}
    });
  }
  for(const saved of [false,true])for(const facing of [1,-1] as const){
    it(`preserves source drawing/contact during hit-stop and restarts the same jab ${saved}/${facing}`,()=>{
      const {attacker,step,contacts}=fixture(facing,36,saved);step({...neutral,attack:true});step();step();
      const before=attacker.getActiveAttack()!;expect(before.framesElapsed).toBe(2);const receiving=attacker.getActiveHurtboxes();
      attacker.armAttackerHitlag(3);for(let i=0;i<3;i++){step();expect(attacker.getActiveAttack()?.framesElapsed).toBe(2);expect(attacker.getActiveHurtboxes()).toEqual(receiving);}
      step();expect(attacker.getActiveAttack()?.framesElapsed).toBe(3);expect(attacker.getActiveAttack()?.hitboxBody).toBeNull();
      step();step();step({...neutral,attack:true});expect(attacker.getActiveAttack()).toMatchObject({move:{id:'pikachu.jab'},framesElapsed:0});
      step();step();expect(contacts).toHaveLength(2);
    });
  }
});
