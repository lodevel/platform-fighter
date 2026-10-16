import {createRequire} from 'node:module';
import {describe,expect,it,vi} from 'vitest';
import {DonkeyKong} from './DonkeyKong';
const require=createRequire(import.meta.url);
const Bodies=require('../physics/matter/source/lib/factory/Bodies.js');
const Body=require('../physics/matter/source/lib/body/Body.js');
function fixture(){
 const scene={matter:{add:{rectangle:Bodies.rectangle},body:Body,world:{on(){},off(){},remove(){}}}};
 const dk=new DonkeyKong(scene as any,{spawnX:300,spawnY:200});
 const ground=vi.spyOn(dk,'isGrounded').mockReturnValue(true);let frame=0;
 const tick=(input={})=>dk.applyInput({moveX:0,jump:false,...input},++frame);
 for(let i=0;i<10;i++)tick();
 return{dk,ground,tick,begin:(action:Parameters<DonkeyKong['beginDonkeyKongHeavyItemAction']>[0],facing?:1|-1)=>dk.beginDonkeyKongHeavyItemAction(action,frame+1,facing)};
}
describe('DK heavy Character consumers; selected action rates and common kinetics remain authored',()=>{
 it('reserves pickup until native5 and emits once across real hitlag, never starting a fighter grab',()=>{
  const {dk,tick,begin}=fixture();expect(begin('pickup')).toBe(true);tick({grab:true});
  expect(dk.getGrabState().name).toBe('idle');expect(dk.getDonkeyKongHeavyItemActionState()?.framesElapsed).toBe(0);
  dk.armAttackerHitlag(3);for(let i=0;i<3;i++){tick();expect(dk.drainDonkeyKongHeavyItemActionEvents()).toEqual([]);}
  for(let i=1;i<4;i++){tick();expect(dk.drainDonkeyKongHeavyItemActionEvents()).toEqual([]);}
  tick();expect(dk.drainDonkeyKongHeavyItemActionEvents().map(e=>[e.kind,e.plan.sourceEventFrame])).toEqual([['pickup',5]]);
  expect(dk.drainDonkeyKongHeavyItemActionEvents()).toEqual([]);
 });
 it('heavy back release precedes same-native20 reversal, preserving entry basis and both facings',()=>{
  for(const facing of [1,-1] as const){
   const {dk,tick,begin}=fixture();dk.setFacing(facing);dk.syncDonkeyKongHeavyItem(true);
   expect(begin('throw-back-ordinary',facing)).toBe(true);tick();
   for(let age=1;age<19;age++){tick();expect(dk.drainDonkeyKongHeavyItemActionEvents()).toEqual([]);expect(dk.getFacing()).toBe(facing);}
   tick();const events=dk.drainDonkeyKongHeavyItemActionEvents();
   expect(events.map(e=>[e.kind,e.facing,e.entryFacing])).toEqual([['release',facing,facing],['reverse-facing',-facing,facing]]);
   expect(dk.getFacing()).toBe(-facing);expect(dk.getPackedBodyState().heavyItem?.age).toBe(19);
  }
 });
 it('permits held aerial heavy throws and rejects airborne pickup without a ground resource',()=>{
  const {dk,ground,begin}=fixture();ground.mockReturnValue(false);expect(begin('pickup')).toBe(false);
  dk.syncDonkeyKongHeavyItem(true);expect(begin('throw-up-strong')).toBe(true);
 });
 it('heavy carry forbids dash/ordinary attacks/defense/airjump while retaining the held object',()=>{
  const {dk,tick,ground}=fixture();dk.syncDonkeyKongHeavyItem(true);
  for(let i=0;i<25;i++)tick({moveX:1,attack:true,special:true,shield:true,dodge:true,appeal:true});
  expect(dk.getDonkeyKongHeavyCarryState()?.phase).toBe('walk');expect(dk.getLocomotionStateName()).not.toBe('run');
  // SmashWiki DK Forward throw: heavy-item carry walks at DK's walk speed × 1.1 (6.825 × 1.1).
  expect(dk.getVelocity().x).toBeLessThanOrEqual(6.825*1.1+1e-9);expect(dk.getActiveAttack()).toBeNull();expect(dk.getShieldState().name).toBe('idle');
  ground.mockReturnValue(false);tick();const jumpsUsed=dk.getJumpsUsed();tick({jump:true});
  // This input-only fixture does not integrate Matter gravity. Verify that
  // no air-jump impulse/resource/action was introduced, rather than claim fall.
  expect(dk.getVelocity().y).toBeGreaterThanOrEqual(0);expect(dk.getJumpsUsed()).toBe(jumpsUsed);
  expect(dk.getJumpPresentationState()).toBeNull();expect(dk.getDonkeyKongHeavyCarryState()?.phase).toBe('fall');
 });
 it('turn gates throws before its third unfrozen callback, then opens in the new facing',()=>{
  const {dk,tick,begin}=fixture();dk.setFacing(1);dk.syncDonkeyKongHeavyItem(true);tick({moveX:-1});
  expect(dk.getDonkeyKongHeavyCarryState()?.phase).toBe('turn');expect(begin('throw-forward-ordinary')).toBe(false);
  tick({moveX:-1});tick({moveX:-1});expect(dk.getFacing()).toBe(1);expect(begin('throw-forward-ordinary')).toBe(false);
  tick({moveX:-1});expect(dk.getFacing()).toBe(-1);expect(begin('throw-forward-ordinary')).toBe(true);
 });
 it('owns six-step heavy jumpsquat, mini release and eighteen-step landing gate',()=>{
  const {dk,tick,ground,begin}=fixture();dk.syncDonkeyKongHeavyItem(true);tick({jump:true});
  expect(dk.getDonkeyKongHeavyCarryState()?.phase).toBe('jump-squat');
  for(let age=1;age<6;age++){tick();expect(dk.getDonkeyKongHeavyCarryState()?.phase).toBe('jump-squat');}
  tick();expect(dk.getDonkeyKongHeavyCarryState()?.phase).toBe('jump');expect(dk.getVelocity().y).toBeLessThan(-1);
  ground.mockReturnValue(false);for(let i=0;i<26;i++)tick();expect(dk.getDonkeyKongHeavyCarryState()?.phase).toBe('fall');
  ground.mockReturnValue(true);tick();expect(dk.getDonkeyKongHeavyCarryState()?.phase).toBe('landing');
  for(let age=1;age<18;age++){expect(begin('throw-down-ordinary')).toBe(false);tick();}
  expect(begin('throw-down-ordinary')).toBe(false);tick();expect(dk.getDonkeyKongHeavyCarryState()?.phase).toBe('wait');expect(begin('throw-down-ordinary')).toBe(true);
 });
 it('pre-callback damage and floor loss interrupt pickup without a release event; reset clears carry',()=>{
  const a=fixture();expect(a.begin('pickup')).toBe(true);a.tick();
  a.dk.applyHit({damage:1,hitlagMultiplier:0,facing:1,knockback:{x:1,y:-1,scaling:0}});
  expect(a.dk.getDonkeyKongHeavyItemActionState()).toBeNull();expect(a.dk.drainDonkeyKongHeavyItemActionEvents()).toEqual([]);
  const b=fixture();expect(b.begin('pickup')).toBe(true);b.ground.mockReturnValue(false);b.tick();expect(b.dk.getDonkeyKongHeavyItemActionState()).toBeNull();
  const c=fixture();c.dk.syncDonkeyKongHeavyItem(true);c.tick();c.dk.resetForRound(300,200);expect(c.dk.getDonkeyKongHeavyCarryState()).toBeNull();expect(c.dk.getPackedBodyState().heavyItem).toBeNull();
 });
 it('opts ordinary item reference launch into0.8 without rewriting source base/growth or unaffected hits',()=>{
  const hit={damage:15,hitlagMultiplier:0,facing:1 as const,knockback:{x:1,y:-1,scaling:0,reference:{angle:45,base:30,growth:80}}};
  const normal=fixture(),item=fixture();
  const baseline=normal.dk.applyHit(hit);const reduced=item.dk.applyHit({...hit,referenceKnockbackMultiplier:.8});
  expect(baseline.referenceKnockback).toBeGreaterThan(0);expect(reduced.referenceKnockback).toBeCloseTo(baseline.referenceKnockback!*.8,9);
  expect(item.dk.getDamagePercent()).toBe(normal.dk.getDamagePercent());expect(hit.knockback.reference).toEqual({angle:45,base:30,growth:80});
 });
});
