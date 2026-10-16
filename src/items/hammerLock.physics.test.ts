import {describe,expect,it} from 'vitest';
import {DonkeyKong} from '../characters/DonkeyKong';
import {Pikachu} from '../characters/Pikachu';
import {itemPhysicsFixture,NEUTRAL_INPUT as neutral} from './itemPhysicsFixture';
import {ItemEntity} from './ItemEntity';
import {HAMMER_DEFINITION,GOLDEN_HAMMER_DEFINITION} from './Hammer';
import {selectPikachuAuxiliaryBody} from '../characters/pikachuAuxiliaryBody';
import {getPackedBodyDrawing} from '../characters/packedBodyPresentation';
import {hammerHit} from './Hammer';
import {computeHitlag} from '../characters/combat';

it('routes Pikachu Hammer drawings with their paired native receiving capsules',()=>{
 const f=itemPhysicsFixture(Pikachu,HAMMER_DEFINITION);f.bat.startHammer(.5);f.step();
 const action=f.actor.getPikachuItemPresentationState();
 expect(action?.sheet).toBe('item_hammer_wait');
 for(const sheet of ['item_hammer_wait','item_hammer_move','item_hammer_jump']){
  for(const [age,artFrameIndex] of [[0,0],[8,1],[15,2],[16,0]] as const){
   const pose=selectPikachuAuxiliaryBody(sheet,age);
   expect(pose?.artFrameIndex).toBe(artFrameIndex);expect(pose?.hurtboxes).toHaveLength(12);
  }
 }
});

it('pairs all DK Hammer body windows and receiving to the loop clock',()=>{
 for(const sheet of ['item_hammer_wait','item_hammer_move','item_hammer_jump']){
  for(const [age,artFrameIndex] of [[0,0],[8,1],[15,2],[16,0]] as const){
   const drawing=getPackedBodyDrawing('donkeykong',sheet,age);
   expect(drawing?.artFrameIndex).toBe(artFrameIndex);
   expect(drawing?.hurtboxes.length).toBeGreaterThan(14);
  }
 }
});

describe.each([DonkeyKong,Pikachu])('%s hammer controls in Matter',Fighter=>{
 it('revival platform is intangible, then dismount grants the fighter respawn policy',()=>{
  const f=itemPhysicsFixture(Fighter,HAMMER_DEFINITION);f.inventory.detachWithoutDrop();
  f.actor.beginRevivalPlatform();expect(f.actor.isOnRevivalPlatform()).toBe(true);
  expect(f.actor.getActiveHurtboxes().every(h=>h.intangible)).toBe(true);
  expect(f.actor.isSourceInvincible()).toBe(false);
  expect(f.actor.applyHitDetailed(hammerHit(GOLDEN_HAMMER_DEFINITION.hammer!,1)).outcome).toBe('intangible');
  expect(f.actor.getDamagePercent()).toBe(0);expect(f.actor.getHitlagRemaining()).toBe(0);
  f.step({...neutral,moveX:1});expect(f.actor.isOnRevivalPlatform()).toBe(false);
  if(Fighter===Pikachu){
   expect(f.actor.isSourceInvincible()).toBe(true);
   expect(f.actor.applyHitDetailed(hammerHit(GOLDEN_HAMMER_DEFINITION.hammer!,1)).outcome).toBe('invulnerable');
  }
 });
 it('invincible contact freezes once, then allows ten real motion steps before the next contact',()=>{
  const definition={...GOLDEN_HAMMER_DEFINITION,hammer:{...GOLDEN_HAMMER_DEFINITION.hammer!,growthFrames:0}};
  const f=itemPhysicsFixture(Fighter,definition),target=itemPhysicsFixture(Pikachu,HAMMER_DEFINITION);
  f.bat.startHammer(.5);target.inventory.detachWithoutDrop();target.actor.setInvincibility(600,'invincible');
  const hit=hammerHit(definition.hammer,1);expect(target.actor.applyHitDetailed(hit).outcome).toBe('invulnerable');
  expect(target.actor.getDamagePercent()).toBe(0);expect(target.actor.getHitlagRemaining()).toBe(0);
  f.step({...neutral,jump:true});for(let i=0;i<15;i++)f.step();
  f.bat.confirmHammerContact(1);
  const age=f.bat.getHammerState()!.motionElapsed,y=f.actor.getPosition().y;
  const freeze=computeHitlag({damage:hit.damage,targetPercent:0,multiplier:hit.hitlagMultiplier,players:2});
  expect(freeze).toBeGreaterThan(10);f.actor.armAttackerHitlag(freeze);
  while(f.actor.getHitlagRemaining()>1){f.step();expect(f.actor.getPosition().y).toBeCloseTo(y,3);}
  f.step();const resumedY=f.actor.getPosition().y;
  expect(f.bat.getHammerState()!.motionElapsed).toBe(age);
  expect(f.bat.canHammerContact(1)).toBe(false);
  for(let i=0;i<9;i++){f.step();expect(f.bat.canHammerContact(1)).toBe(false);}
  expect(f.actor.getPosition().y).not.toBeCloseTo(resumedY,2);
  f.step();expect(f.bat.canHammerContact(1)).toBe(true);
  expect(f.bat.getHammerState()!.motionElapsed).toBe(age+10);
 });
 it('walks with full digital input and rejects every offensive/defensive/drop route',()=>{
  const f=itemPhysicsFixture(Fighter,HAMMER_DEFINITION);f.bat.startHammer(.5);
  for(let i=0;i<20;i++)f.step({...neutral,moveX:1,attack:true,attackHeavy:true,special:true,shield:true,dodge:true,grab:true,appeal:true});
  expect(f.actor.getPosition().x).toBeGreaterThan(0);
  expect(['initialDash','run']).not.toContain(f.actor.getLocomotionStateName());
  expect(f.actor.getActiveAttack()).toBeNull();expect(f.actor.getItemActionState()).toBeNull();
  expect(f.actor.getShieldState().name).toBe('idle');expect(f.inventory.drop(40,{x:0,y:0})).toBeNull();
  expect(f.inventory.isHolding()).toBe(true);
 });
 it('allows ground jump, then rejects an airborne jump and specials',()=>{
  const f=itemPhysicsFixture(Fighter,HAMMER_DEFINITION);f.bat.startHammer(.5);
  f.step({...neutral,jump:true});for(let i=0;i<10;i++)f.step();
  expect(f.actor.isGrounded()).toBe(false);const used=f.actor.getJumpsUsed();
  f.step({...neutral,jump:true,special:true,attack:true});expect(f.actor.getJumpsUsed()).toBe(used);
  expect(f.actor.getActiveAttack()).toBeNull();
 });
 it('Golden repeated taps float without spending air jumps; expiry restores controls',()=>{
  const f=itemPhysicsFixture(Fighter,{...GOLDEN_HAMMER_DEFINITION,hammer:{...GOLDEN_HAMMER_DEFINITION.hammer!,growthFrames:0}});f.bat.startHammer(.5);
  f.step({...neutral,jump:true});for(let i=0;i<15;i++)f.step();
  const used=f.actor.getJumpsUsed();f.step({...neutral,jump:true});expect(f.actor.body.velocity.y).toBeLessThan(0);
  expect(f.actor.getJumpsUsed()).toBe(used);
  // Holding jump does not repeatedly restore the float impulse; a new tap does.
  for(let i=0;i<10;i++)f.step({...neutral,jump:true});
  expect(f.actor.body.velocity.y).toBeGreaterThan(-2);
  f.step();f.step({...neutral,jump:true});expect(f.actor.body.velocity.y).toBeLessThan(0);
  // Lifetime expiry is observed, without manual detachment (scene removes the spent item next).
  while(f.bat.getHammerState()!.elapsed<920)f.step();
  expect(f.actor.isHammerLocked()).toBe(false);expect(f.actor.getEquippedItem()).toBeNull();
  f.step();f.step({...neutral,attack:true});expect(f.actor.getActiveAttack()).not.toBeNull();
 });
 it('acquisition cancels an existing attack while preserving shield health',()=>{
  const f=itemPhysicsFixture(Fighter,HAMMER_DEFINITION);f.inventory.detachWithoutDrop();
  f.actor.setShieldState({...f.actor.getShieldState(),health:17});
  f.step({...neutral,attack:true});expect(f.actor.getActiveAttack()).not.toBeNull();
  const hammer=new ItemEntity(2,HAMMER_DEFINITION,20,f.actor.getPosition());hammer.markGrounded(20,f.actor.getPosition());
  const health=f.actor.getShieldState().health;
  expect(f.inventory.pickup(hammer,21,0,f.actor.getPosition())).toBe(true);
  expect(f.actor.getActiveAttack()).toBeNull();expect(f.actor.getShieldState().health).toBe(health);
 });
 it('hitstun interrupts swings while lifetime continues and reset removes the lock',()=>{
  const f=itemPhysicsFixture(Fighter,HAMMER_DEFINITION);f.bat.startHammer(.5);
  f.actor.applyHitDetailed({damage:10,knockback:{x:8,y:-5,scaling:.1},facing:1});
  while(f.actor.isInHitlag())f.step();
  expect(f.actor.getHitstunRemaining()).toBeGreaterThan(0);
  expect(f.actor.getHammerPresentation()).toBeNull();
  const age=f.bat.getHammerState()!.elapsed;f.step();expect(f.bat.getHammerState()!.elapsed).toBe(age+1);
  expect(f.actor.getActiveAttack()).toBeNull();
  f.actor.resetForRound(0,0);expect(f.actor.isHammerLocked()).toBe(false);
  f.step({...neutral,attack:true});expect(f.actor.getActiveAttack()).not.toBeNull();
 });
});
