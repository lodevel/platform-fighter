import {createRequire} from 'node:module';
import {describe,expect,it,vi} from 'vitest';
import {DonkeyKong} from './DonkeyKong';
import {computeKnockback,type HitInfo} from './combat';
const require=createRequire(import.meta.url);
const Bodies=require('../physics/matter/source/lib/factory/Bodies.js');
const Body=require('../physics/matter/source/lib/body/Body.js');
function fixture(){
 const scene={matter:{add:{rectangle:Bodies.rectangle},body:Body,world:{on(){},off(){},remove(){}}}};
 const dk=new DonkeyKong(scene as any,{spawnX:300,spawnY:200});
 vi.spyOn(dk,'isGrounded').mockReturnValue(true);let frame=0;
 const tick=(input:{moveX?:number;moveY?:number}={})=>dk.applyInput({moveX:0,jump:false,...input},++frame);
 for(let i=0;i<10;i++)tick();dk.syncDonkeyKongHeavyItem(true);
 return{dk,tick,frame:()=>frame};
}
const packet=(kb:number,extra:Partial<HitInfo>={}):HitInfo=>({damage:3,hitlagMultiplier:1,facing:1,
 nativeCollisionAttribute:'collision_attr_normal',nativeForceReaction:false,
 knockback:{x:1,y:-1,scaling:0,reference:{angle:45,base:kb,growth:0}},...extra});
describe('source-scoped heavy carry resistance through Character; rawKB*.4 conversion is calibrated',()=>{
 it.each(['collision_attr_normal','collision_attr_elec','collision_attr_rush','collision_attr_bury'])('retains source carry on supported %s below80KB without creating launch/bury',attribute=>{
  const {dk}=fixture();const carry=dk.getDonkeyKongHeavyCarryState();
  const result=dk.applyHitDetailed(packet(79,{nativeCollisionAttribute:attribute,
   ...(attribute==='collision_attr_bury'?{statusEffect:'bury' as const}:{})}));
  expect(result).toMatchObject({outcome:'landed',damageApplied:3,reactionResisted:true});
  expect(result.heavyItemDrop).toBeUndefined();expect(result.knockback.magnitude).toBe(0);
  expect(dk.getDonkeyKongHeavyCarryState()).toEqual(carry);expect(dk.isInHitlag()).toBe(true);
  expect(dk.getHitstunRemaining()).toBe(0);expect(dk.getBuriedPresentationState()).toBeNull();
 });
 it('strict80KB boundary drops carry and leaves queued launch intact through Scene syncfalse',()=>{
  const {dk,tick}=fixture();const result=dk.applyHitDetailed(packet(80));
  expect(result).toMatchObject({outcome:'landed',damageApplied:3,heavyItemDrop:{reason:'threshold',referenceKnockback:80}});
  expect(result.reactionResisted).toBeUndefined();dk.syncDonkeyKongHeavyItem(false);
  for(let i=0;i<30&&dk.isInHitlag();i++)tick();
  expect(dk.getVelocity().x).toBeGreaterThan(0);expect(dk.getHitstunRemaining()).toBeGreaterThan(0);
 });
 it.each(['collision_attr_sleep','collision_attr_sleep_ex'])('sleep exception %s launches below threshold even with unknown force',attribute=>{
  const {dk}=fixture();expect(dk.applyHitDetailed(packet(1,{nativeCollisionAttribute:attribute,nativeForceReaction:undefined})))
   .toMatchObject({outcome:'landed',heavyItemDrop:{reason:'sleep',referenceKnockback:1}});
 });
 it('explicit forced reaction launches a weak electric contact',()=>{
  const {dk}=fixture();expect(dk.applyHitDetailed(packet(1,{nativeCollisionAttribute:'collision_attr_elec',nativeForceReaction:true})))
   .toMatchObject({heavyItemDrop:{reason:'forced-reaction',referenceKnockback:1}});
 });
 it.each([{nativeForceReaction:undefined},{nativeCollisionAttribute:undefined},{nativeCollisionAttribute:'collision_attr_future'},
  {knockback:{x:1,y:-1,scaling:0}}])('unsupported packet preserves authored reaction without a sourced loss signal %j',extra=>{
  const {dk}=fixture();const result=dk.applyHitDetailed(packet(1,extra));
  expect(result.outcome).toBe('landed');expect(result.damageApplied).toBe(3);
  expect(result.reactionResisted).toBeUndefined();expect(result.heavyItemDrop).toBeUndefined();
  expect(result.knockback.magnitude).toBeGreaterThan(0);
 });
 it('weight100 bury preview classifies before bury state and post-hit damage is counted once',()=>{
  const {dk}=fixture();dk.setDamagePercent(90);
  const hit=packet(30,{damage:10,statusEffect:'bury',nativeCollisionAttribute:'collision_attr_bury',
   knockback:{x:1,y:-1,scaling:0,reference:{angle:45,base:30,growth:50}}});
  const at100=computeKnockback(hit,100,dk.getTuning().mass,{referenceWeight:100,grounded:true}).referenceKnockback!;
  const normal=computeKnockback(hit,100,dk.getTuning().mass,{referenceWeight:dk.getTuning().referenceWeight,grounded:true}).referenceKnockback!;
  expect(at100).toBeGreaterThanOrEqual(80);expect(normal).toBeLessThan(80);
  expect(dk.applyHitDetailed(hit)).toMatchObject({damageApplied:10,heavyItemDrop:{reason:'threshold',referenceKnockback:at100}});
  expect(dk.getDamagePercent()).toBe(100);
 });
 it('direct applyHit shares classification and frozen carry preserves entry velocity/facing',()=>{
  const {dk,tick}=fixture();dk.setFacing(-1);Body.setVelocity((dk as any).body,{x:2,y:0});
  expect(dk.applyHit(packet(20)).magnitude).toBe(0);
  const carry=dk.getDonkeyKongHeavyCarryState(),position=dk.getPosition();let pulse=0;
  while(dk.isInHitlag()){tick({moveX:++pulse%2?1:-1,moveY:1});
   expect(dk.getDonkeyKongHeavyCarryState()).toEqual(carry);expect(dk.getPosition()).toEqual(position);}
  expect(dk.getFacing()).toBe(-1);expect(dk.getVelocity().x).toBe(2);
 });
 it('protection wins and resets the prior per-hit drop signal before early return',()=>{
  const {dk}=fixture();expect(dk.applyHitDetailed(packet(80)).heavyItemDrop?.reason).toBe('threshold');
  dk.setInvincibility(5);const protectedHit=dk.applyHitDetailed(packet(80));
  expect(protectedHit.damageApplied).toBe(0);expect(protectedHit.heavyItemDrop).toBeUndefined();
  expect(protectedHit.reactionResisted).toBeUndefined();
 });
 it('pickup/throw commitments never borrow carry armor, and per-hit signals do not leak across reset',()=>{
  const {dk,frame}=fixture();expect(dk.beginDonkeyKongHeavyItemAction('throw-forward-ordinary',frame()+1,1)).toBe(true);
  const throwHit=dk.applyHitDetailed(packet(1));expect(throwHit.reactionResisted).toBeUndefined();expect(throwHit.heavyItemDrop).toBeUndefined();
  dk.resetForRound(300,200);const next=dk.applyHitDetailed(packet(1));expect(next.reactionResisted).toBeUndefined();expect(next.heavyItemDrop).toBeUndefined();
 });
});
