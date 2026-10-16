import {createRequire} from 'node:module';
import {describe,expect,it,vi} from 'vitest';
import {DonkeyKong,DONKEYKONG_DTILT} from './DonkeyKong';
import {resolveDonkeyKongProtectionClock} from './donkeykongPairedProtectionClock';
import type {AttackMove} from './attacks';
const require=createRequire(import.meta.url),Bodies=require('../physics/matter/source/lib/factory/Bodies.js'),Body=require('../physics/matter/source/lib/body/Body.js');
function fixture(move:AttackMove,facing:1|-1){
 const scene={matter:{add:{rectangle:Bodies.rectangle},body:Body,world:{on(){},off(){},remove(){}}}};
 const dk=new DonkeyKong(scene as any,{spawnX:300,spawnY:200});vi.spyOn(dk,'isGrounded').mockReturnValue(true);dk.addAttack(move);
 let frame=0;const tick=(input={})=>dk.applyInput({moveX:0,jump:false,...input},++frame);
 for(let i=0;i<10;i++)tick();dk.setFacing(facing);
 // The real input route ages down beyond its smash flick window.
 for(let i=0;i<8;i++)tick({moveY:1});tick({moveY:1,attack:true});expect(dk.getActiveAttack()?.move.id).toBe('donkeykong.dtilt');expect(dk.getActiveAttack()?.framesElapsed).toBe(0);
 const advance=(age:number)=>{while(dk.getActiveAttack()!.framesElapsed<age)tick({moveY:1});};
 return{dk,tick,advance};
}
describe('Character paired protection input/interruption clocks; fixture does not integrate the world',()=>{
 it.each([1,-1] as const)('whole-source direct damage and capture queries use canonical age under retiming face%s',facing=>{
  const move={...DONKEYKONG_DTILT,startupFrames:10,activeFrames:4,recoveryFrames:8,
   protectionWindows:[{startFrame:4,endFrame:7,regions:['*']}]};
  const {dk,advance}=fixture(move,facing);advance(7);expect(dk.isInvincible()).toBe(false);expect(dk.isCaptureProtected()).toBe(false);
  advance(8);expect(dk.isInvincible()).toBe(true);expect(dk.isCaptureProtected()).toBe(true);
  const blocked=dk.applyHitDetailed({damage:3,hitlagMultiplier:0,facing:1,knockback:{x:1,y:-1,scaling:0}});
  expect(blocked.outcome).toBe('intangible');expect(blocked.damageApplied).toBe(0);expect(dk.getActiveAttack()?.framesElapsed).toBe(8);
  advance(14);expect(dk.isInvincible()).toBe(false);expect(dk.isCaptureProtected()).toBe(false);
  expect(dk.applyHitDetailed({damage:3,hitlagMultiplier:0,facing:1,knockback:{x:1,y:-1,scaling:0}}).damageApplied).toBe(3);
  expect(dk.getActiveAttack()).toBeNull();expect(dk.isInvincible()).toBe(false);
 });
 it.each([1,-1] as const)('regional source window freezes then clears at source7 without palm/head protection face%s',facing=>{
  const move={...DONKEYKONG_DTILT,startupFrames:10,activeFrames:4,recoveryFrames:8};const {dk,tick,advance}=fixture(move,facing);advance(13);
  const boxes=dk.getActiveHurtboxes();expect(boxes.some(h=>h.intangible)).toBe(true);expect(boxes.filter(h=>h.intangible).every(h=>h.region==='arml'||h.region==='shoulderl')).toBe(true);
  expect(boxes.filter(h=>h.region==='head'||h.region==='handl').every(h=>!h.intangible)).toBe(true);expect(dk.isInvincible()).toBe(false);expect(dk.isCaptureProtected()).toBe(false);
  dk.armAttackerHitlag(4);for(let i=0;i<4;i++){tick();expect(dk.getActiveAttack()?.framesElapsed).toBe(13);expect(dk.getActiveHurtboxes()).toEqual(boxes);expect(resolveDonkeyKongProtectionClock(move,dk.getActiveAttack()!.framesElapsed).age).toBe(6.5);}
  tick();expect(dk.getActiveAttack()?.framesElapsed).toBe(14);expect(dk.getActiveHurtboxes().every(h=>!h.intangible)).toBe(true);
  dk.resetForRound(300,200);expect(dk.getActiveAttack()).toBeNull();expect(dk.getActiveHurtboxes().every(h=>!h.intangible)).toBe(true);expect(dk.isInvincible()).toBe(false);
 });
});
