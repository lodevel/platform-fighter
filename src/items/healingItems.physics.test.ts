import {describe,it,expect} from 'vitest';
import {DonkeyKong} from '../characters/DonkeyKong';
import {Pikachu} from '../characters/Pikachu';
import {itemPhysicsFixture,NEUTRAL_INPUT} from './itemPhysicsFixture';
import {RAY_GUN_DEFINITION} from './RayGun';
import {foodDefinition} from './Food';
import {HEART_CONTAINER_DEFINITION} from './HeartContainer';
import {MAXIM_TOMATO_DEFINITION} from './MaximTomato';
import {selectPikachuAuxiliaryBody} from '../characters/pikachuAuxiliaryBody';
import {getPackedBodyDrawing} from '../characters/packedBodyPresentation';

/** One scene step: advance, then commit consume events the way MatchScene does after validating them. */
type Fixture=ReturnType<typeof itemPhysicsFixture>;
function stepWithRecovery(f:Fixture,input?:Parameters<Fixture['step']>[0]){
 f.step(input);const events=f.actor.drainRecoveryEvents();
 for(const event of events)if(event.kind==='consume')f.actor.applyValidatedItemRecovery(event.spec,event);
 return events;
}
const brief=(events:ReturnType<Fixture['actor']['drainRecoveryEvents']>)=>events.map(({itemId,kind})=>({itemId,kind}));

describe.each([DonkeyKong,Pikachu])('%s recovery in a Matter match',Fighter=>{
 it('eats while carrying a loaded weapon and restores attacks at native cancel',()=>{
  const f=itemPhysicsFixture(Fighter,RAY_GUN_DEFINITION);f.actor.setDamagePercent(30);
  expect(f.actor.beginItemRecovery(14,foodDefinition('Bread').recovery!,21)).toBe(true);
  const events=stepWithRecovery(f,{...NEUTRAL_INPUT,attack:true,special:true,shield:true,jump:true});
  expect(f.actor.getRecoveryPresentation()?.sheet).toBe('item_light_eat');
  expect(f.actor.getActiveAttack()).toBeNull();expect(f.actor.getJumpsquatRemaining()).toBe(0);
  expect(f.inventory.getHeldItem()).toBe(f.bat);expect(f.bat.getAmmo()).toBe(16);
  for(let n=0;n<9;n++)events.push(...stepWithRecovery(f));
  expect(f.actor.getDamagePercent()).toBe(20);expect(f.actor.getEatingState()).toBeNull();
  expect(brief(events)).toEqual([{itemId:14,kind:'consume'}]);
  f.step({...NEUTRAL_INPUT,attack:true});expect(f.actor.getItemShootingState()).not.toBeNull();
 });
 it('walk eat owns the body until frame11 while the feet keep moving',()=>{
  const f=itemPhysicsFixture(Fighter,RAY_GUN_DEFINITION);const x=f.actor.getPosition().x;
  expect(f.actor.beginItemRecovery(3,foodDefinition('Apple').recovery!,21,true)).toBe(true);
  for(let n=0;n<11;n++)f.step({...NEUTRAL_INPUT,moveX:1,attack:true});
  expect(f.actor.getPosition().x).toBeGreaterThan(x);expect(f.actor.getActiveAttack()).toBeNull();
  expect(f.actor.getItemShootingState()).toBeNull();expect(f.actor.getRecoveryPresentation()?.sheet).toBe('item_light_walk_eat');
  f.step();expect(f.actor.getRecoveryPresentation()).toBeNull();
 });
 it('flinching before consume drops food without healing or replacing the weapon',()=>{
  const f=itemPhysicsFixture(Fighter,RAY_GUN_DEFINITION);f.actor.setDamagePercent(30);
  f.actor.beginItemRecovery(7,foodDefinition('Bread').recovery!,21);f.step();
  f.actor.applyHit({damage:5,knockback:{x:1,y:-2,scaling:0},facing:1,hitlagMultiplier:0});
  expect(f.actor.getDamagePercent()).toBe(35);expect(f.actor.getEatingState()).toBeNull();
  expect(brief(f.actor.drainRecoveryEvents())).toEqual([{itemId:7,kind:'drop'}]);
  for(let n=0;n<25;n++)f.step();expect(f.actor.getDamagePercent()).toBe(35);
  expect(f.inventory.getHeldItem()).toBe(f.bat);
 });
 it('tomato50point gradual recovery with incoming20 leaves70 from100',()=>{
  const f=itemPhysicsFixture(Fighter,RAY_GUN_DEFINITION);f.actor.setDamagePercent(100);
  f.actor.beginItemRecovery(9,MAXIM_TOMATO_DEFINITION.recovery!,21);for(let n=0;n<16;n++)stepWithRecovery(f);
  const remaining=f.actor.getHealingState()!.remaining;
  f.actor.applyHit({damage:20,knockback:{x:1,y:-2,scaling:0},facing:1,hitlagMultiplier:0});
  expect(f.actor.getHealingState()!.remaining).toBe(remaining);
  for(let n=0;n<120;n++)stepWithRecovery(f);
  expect(f.actor.getDamagePercent()).toBe(70);expect(f.actor.getHealingState()).toBeNull();
  expect(f.actor.beginItemRecovery(12,HEART_CONTAINER_DEFINITION.recovery!,200)).toBe(true);
  expect(f.actor.getEatingState()).toBeNull();stepWithRecovery(f);
  // The scene commits the validated transaction after the step, so healing ticks from the next step.
  expect(f.actor.getDamagePercent()).toBe(70);stepWithRecovery(f);expect(f.actor.getDamagePercent()).toBe(69);
 });
 it('hitlag freezes both healing and eat state, and round reset clears the budget',()=>{
  const f=itemPhysicsFixture(Fighter,RAY_GUN_DEFINITION);f.actor.setDamagePercent(200);
  f.actor.beginItemRecovery(9,HEART_CONTAINER_DEFINITION.recovery!,21);f.step();
  f.actor.armAttackerHitlag(5);const percent=f.actor.getDamagePercent(),state=f.actor.getHealingState();
  for(let n=0;n<5;n++)f.step();expect(f.actor.getDamagePercent()).toBe(percent);expect(f.actor.getHealingState()).toEqual(state);
  f.actor.resetForRound(0,0);expect(f.actor.getHealingState()).toBeNull();
 });
});

it('eat pose selection pairs visible body and receiving at every sample, both actors',()=>{
 for(const [sheet,last] of [['item_light_eat',9],['item_light_walk_eat',11]] as const){
  const samples=sheet==='item_light_eat'?[0,4,8]:[0,5,10];
  for(let i=0;i<samples.length;i++){
   const pk=selectPikachuAuxiliaryBody(sheet,samples[i]!);expect(pk?.artFrameIndex).toBe(i);expect(pk?.hurtboxes).toHaveLength(12);
   const dk=getPackedBodyDrawing('donkeykong',sheet,samples[i]!);expect(dk?.artFrameIndex).toBe(i);expect(dk?.hurtboxes.length).toBeGreaterThan(14);
  }
  expect(selectPikachuAuxiliaryBody(sheet,last)).toBeNull();
 }
});
