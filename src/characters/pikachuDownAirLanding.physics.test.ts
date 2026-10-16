import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, CHARACTER_LABEL, type CharacterInput } from './Character';
import { registerFighterAttack } from './attackRegistration';
import type { AerialMove } from './aerialSchema';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import type { HitInfo } from './combat';
import { applyCharacterMoveOverrides, createCharacterById } from './characterFactory';
import { parseCharacterDataFile, serializeCharacterDataSpec, type CharacterDataSpec } from './characterSerializer';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };

import { buildPikachuDownAirWithAuthoredHurtboxes, PIKACHU_DOWN_AIR_AUTHORED_HURTBOX_POSES } from './pikachuDownAirHurtboxes';
import { selectSimulationAttackFrame } from './simulationSpriteAnimation';
import type { AttackMoveWithAnimation } from './moveSchema';

function fixture(move: AerialMove, facing: 1 | -1 = 1, targetX = 30, savedSpec?: CharacterDataSpec) {
  const engine = Engine.create(); engine.gravity.y = 0;
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
    const body = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, body); return body;
  } }, world: { on(name: string, fn: any) { Events.on(engine, names[name] ?? name, fn); },
    off(name: string, fn: any) { Events.off(engine, names[name] ?? name, fn); },
    remove(body: any) { Composite.remove(engine.world, body); } } } };
  const options = { spawnX: 0, spawnY: 0, width: 40, height: 50,
    fallAccel: 0, maxFallSpeed: 3, softLandingFrames: 0, hardLandingFrames: 0 };
  const ch = savedSpec ? createCharacterById(scene, savedSpec.id, options) : new Character(scene, { id: 'donkeykong', ...options });
  if (savedSpec) applyCharacterMoveOverrides(ch, savedSpec);
  else registerFighterAttack(ch, move);
  ch.setFacing(facing);
  const target = Bodies.rectangle(1000, 0, 1, 1, { isStatic: true, isSensor: true, label: CHARACTER_LABEL,
    plugin: { characterId: 'target' }, collisionFilter: { category: COLLISION_CATEGORIES.CHARACTER } });
  Composite.add(engine.world, target);
  const contacts: { hit: HitInfo; moveId?: string; frame?: number }[] = [];
  const handler = new HitboxDamageHandler((index, hit) => {
    if (index !== 1) return { confirmed: false };
    contacts.push({ hit, moveId: ch.getActiveAttack()?.move.id, frame: ch.getActiveAttack()?.framesElapsed });
    return { confirmed: true };
  });
  handler.registerPlayer(0, ch.body); handler.registerPlayer(1, target);
  handler.setGroundedLookup(() => true);
  handler.setFacingLookup(index => index === 0 ? ch.getFacing() : 1);
  handler.setHurtboxLookup(index => index === 0 ? ch.getActiveHurtboxes()
    : [{ id: 'probe', offsetX: 0, offsetY: 0, width: 1, height: 1 }]);
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
  const step = (input = neutral) => {
    ch.applyInput(input);
    stepCharacterPhysics({ characters: [ch], bodies: Composite.allBodies(engine.world), gravity: engine.gravity,
      body: Body, deltaMs: 1000 / 60, stepWorld: dt => {
        Engine.update(engine, dt); handler.sampleHurtboxContacts(Composite.allBodies(engine.world));
      } });
  };
  const probe = (x = targetX) => Body.setPosition(target, { x: ch.getPosition().x + x * facing, y: ch.getPosition().y + 5 });
  const landAt = (elapsed: number, beforeContact?: () => void) => {
    step({ ...neutral, attackHeavy:true, attackStickY:1 });
    for (let frame = 1; frame < elapsed; frame++) step();
    beforeContact?.();
    const position = ch.getPosition();
    const floor = Bodies.rectangle(position.x, position.y + 37, 2000, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
      collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } });
    Composite.add(engine.world, floor);
    Body.setVelocity(ch.body, { x: 0, y: 3 });
    step();
    expect(ch.isGrounded()).toBe(true);
    probe();
  };
  return { ch, step, landAt, contacts, probe, engine, target };
}

/** Staged real-floor contact checks; zero-gravity pre-touchdown fixture is
 * not Pikachu native movement or generated-art qualification. */
describe('Pikachu down-air explicit drawing/hurtbox landing clock',()=>{
  for(const saved of [false,true])for(const facing of [1,-1] as const){
    it(`lands through down-stick input and freezes/resumes saved${saved}/facing${facing}`,()=>{
      const move=buildPikachuDownAirWithAuthoredHurtboxes();
      const data=saved?parseCharacterDataFile(JSON.parse(JSON.stringify({...serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong')),moves:{dair:move}}))):undefined;
      const {ch,step,landAt,contacts,engine}=fixture(move,facing,30,data);
      landAt(16);const airborne=ch.getActiveAttack()!;
      expect(airborne.move.id).toBe('pikachu.down-air');
      expect(selectSimulationAttackFrame(airborne.move,airborne.framesElapsed,22,'dair')).toBe(7);
      const sensor=airborne.hitboxBody;step();
      expect(Composite.allBodies(engine.world)).not.toContain(sensor);
      expect(ch.getActiveAttack()).toMatchObject({move:{id:'pikachu.down-air-landing'},framesElapsed:0});
      expect(contacts).toMatchObject([{hit:{damage:4},frame:0}]);
      const firstBoxes=ch.getActiveHurtboxes();
      expect(firstBoxes).toEqual(PIKACHU_DOWN_AIR_AUTHORED_HURTBOX_POSES.find(row=>row.action==='down-air-landing'&&row.pose==='impact-one')!.hurtboxes);
      ch.armAttackerHitlag(3);
      for(let i=0;i<3;i++){step();expect(ch.getActiveAttack()!.framesElapsed).toBe(0);expect(ch.getCooldownRemaining()).toBe(22);expect(ch.getActiveHurtboxes()).toEqual(firstBoxes);expect(selectSimulationAttackFrame(ch.getActiveAttack()!.move,0,7)).toBe(0);}
      step();expect(ch.getActiveAttack()!.framesElapsed).toBe(1);expect(selectSimulationAttackFrame(ch.getActiveAttack()!.move,1,7)).toBe(1);
      step();expect(ch.getActiveAttack()!.hitboxBody).toBeNull();expect(selectSimulationAttackFrame(ch.getActiveAttack()!.move,2,7)).toBe(2);
      for(let e=3;e<=21;e++){step();expect(ch.getActiveAttack()!.framesElapsed).toBe(e);expect(ch.canAttack()).toBe(false);}
      expect(contacts).toHaveLength(1);step();expect(ch.getActiveAttack()).toBeNull();expect(ch.canAttack()).toBe(true);expect(ch.getActiveHurtboxes()).toHaveLength(1);
      ch.destroy();Engine.clear(engine);Composite.clear(engine.world,false);
    });
  }
  it('round-trips nested landing drawing windows and rejects incomplete coverage',()=>{
    const move=buildPikachuDownAirWithAuthoredHurtboxes();
    const base={...serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong')),moves:{dair:move}};
    const loaded=parseCharacterDataFile(JSON.parse(JSON.stringify(base)));
    // JSON canonicalizes signed zero and omitted optional values.
    expect(loaded.moves!.dair!.landingAttack).toEqual(JSON.parse(JSON.stringify(move.landingAttack)));
    const landing=move.landingAttack as AttackMoveWithAnimation;
    expect(()=>parseCharacterDataFile({...base,moves:{dair:{...move,landingAttack:{...landing,animation:{...landing.animation,frameWindows:landing.animation!.frameWindows!.slice(0,-1)}}}}})).toThrow('landingAttack.animation.frameWindows');
  });
});
