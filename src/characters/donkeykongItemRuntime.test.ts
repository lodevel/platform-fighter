import {createRequire} from 'node:module';
import {describe,expect,it,vi} from 'vitest';
import {DonkeyKong} from './DonkeyKong';
import {beginSurfaceTech} from './surfaceTech';
import {SURFACE_TECH_PROFILES} from './surfaceTechProfiles';

const require=createRequire(import.meta.url);
const Bodies=require('../physics/matter/source/lib/factory/Bodies.js');
const Body=require('../physics/matter/source/lib/body/Body.js');
function fighter(){
 const scene={matter:{add:{rectangle:Bodies.rectangle},body:Body,world:{on(){},off(){},remove(){}}}};
 const dk=new DonkeyKong(scene as any,{spawnX:300,spawnY:200});
 const ground=vi.spyOn(dk,'isGrounded').mockReturnValue(true);
 // Settle the genuine input-side touchdown through ten real fixture input steps (1–10) before
 // requesting an item; new-spawn landing recovery must still gate requests.
 for(let frame=1;frame<=10;frame++)dk.applyInput({moveX:0,jump:false},frame);
 return{dk,ground,begin:(action:Parameters<DonkeyKong['beginItemAction']>[0],frame:number,facing?:1|-1)=>dk.beginItemAction(action,frame+10,facing),tick:(frame:number,input={})=>dk.applyInput({moveX:0,jump:false,...input},frame+10)};
}

describe('DK item Character clock and ownership boundaries (no match qualification)',()=>{
 it('pickup commits once at native2/age1 and retains full standing7-step action',()=>{
  const {dk,tick,begin}=fighter();expect(begin('pickup-standing',1)).toBe(true);
  tick(1,{grab:true});expect(dk.drainItemActionEvents()).toEqual([]);
  expect(dk.getGrabState().name).toBe('idle');expect(dk.canAttack()).toBe(false);
  tick(2);expect(dk.drainItemActionEvents().map(e=>e.kind)).toEqual(['pickup']);
  expect(dk.drainItemActionEvents()).toEqual([]);
  for(let frame=3;frame<=7;frame++){tick(frame);expect(dk.getItemActionState()).not.toBeNull();expect(dk.drainItemActionEvents()).toEqual([]);}
  tick(8);expect(dk.getItemActionState()).toBeNull();
 });
 it('back throw reverses at native11 and releases at14 using immutable entry facing',()=>{
  const {dk,tick,begin}=fighter();dk.setFacing(1);
  expect(begin('throw-ground-back-ordinary',1,1)).toBe(true);
  const events=[];
  for(let frame=1;frame<=14;frame++){tick(frame,{moveX:-1,attack:true});events.push(...dk.drainItemActionEvents().map(e=>({frame,...e})));expect(dk.getActiveAttack()).toBeNull();}
  expect(events.map(e=>[e.frame,e.kind,e.facing,e.entryFacing])).toEqual([[11,'reverse-facing',-1,1],[14,'release',-1,1]]);
  expect(dk.getFacing()).toBe(-1);expect(dk.getItemActionState()?.framesElapsed).toBe(13);
 });
 it('real hitlag pauses pickup callback and source age, then resumes without duplicate',()=>{
  const {dk,tick,begin}=fighter();expect(begin('pickup-standing',1)).toBe(true);tick(1);
  dk.armAttackerHitlag(4);for(let frame=2;frame<=5;frame++){tick(frame);expect(dk.getItemActionState()?.framesElapsed).toBe(0);expect(dk.drainItemActionEvents()).toEqual([]);}
  tick(6);expect(dk.drainItemActionEvents().map(e=>e.kind)).toEqual(['pickup']);
 });
 it('pre-event damage and loss of ground support retire reservation without release',()=>{
  const {dk,tick,begin}=fighter();expect(begin('throw-ground-forward-ordinary',1)).toBe(true);tick(1);expect(dk.getItemActionState()).not.toBeNull();
  dk.applyHit({damage:1,hitlagMultiplier:0,facing:1,knockback:{x:1,y:-1,scaling:0}});
  expect(dk.getItemActionState()).toBeNull();expect(dk.drainItemActionEvents()).toEqual([]);
  const other=fighter();expect(other.begin('pickup-standing',1)).toBe(true);expect(other.dk.getItemActionState()).not.toBeNull();other.ground.mockReturnValue(false);other.tick(1);
  expect(other.dk.getItemActionState()).toBeNull();expect(other.dk.drainItemActionEvents()).toEqual([]);
 });
 it('air Zdrop emits once and suppresses same-step fighter grab',()=>{
  const {dk,tick,ground,begin}=fighter();ground.mockReturnValue(false);
  expect(begin('air-z-drop',1)).toBe(true);tick(1,{grab:true});
  expect(dk.getGrabState().name).toBe('idle');expect(dk.drainItemActionEvents().map(e=>e.kind)).toEqual(['release']);
  tick(2,{grab:true});expect(dk.drainItemActionEvents()).toEqual([]);
 });
 it('only completed aerial timelines emit immutable once-only exit receipts, not release or interruption',()=>{
  const {dk,tick,ground,begin}=fighter();ground.mockReturnValue(false);
  expect(begin('throw-air-forward-ordinary',1,-1)).toBe(true);
  for(let frame=1;frame<=24;frame++){
   tick(frame);dk.drainItemActionEvents();
   expect(dk.drainItemActionCompletions()).toEqual([]);
  }
  tick(25);const completed=dk.drainItemActionCompletions();
  expect(completed).toHaveLength(1);expect(completed[0]).toMatchObject({entryFacing:-1,entryFrame:11,exitFrame:35,plan:{action:'throw-air-forward-ordinary',durationFrames:24}});
  expect(Object.isFrozen(completed[0])).toBe(true);expect(Object.isFrozen(completed[0]!.plan)).toBe(true);
  expect(dk.drainItemActionCompletions()).toEqual([]);
  const interrupted=fighter();interrupted.ground.mockReturnValue(false);
  expect(interrupted.begin('throw-air-forward-ordinary',1)).toBe(true);interrupted.tick(1);
  interrupted.ground.mockReturnValue(true);interrupted.tick(2);
  expect(interrupted.dk.getItemActionState()).toBeNull();expect(interrupted.dk.drainItemActionCompletions()).toEqual([]);
 });
 it('wall-tech-jump entry blocks items, actionable drawing permits catch and retires on a new throw',()=>{
  const {dk,ground,begin}=fighter();ground.mockReturnValue(false);
  const entry=beginSurfaceTech('wall-jump',1,1,SURFACE_TECH_PROFILES.donkeykong);
  (dk as any).surfaceTech=entry;
  expect(dk.getItemThrowContext('forward')).toBeNull();expect(dk.getItemCatchContext()).toBeNull();
  (dk as any).surfaceTech={...entry,framesElapsed:1};
  expect(dk.getItemCatchContext()).toMatchObject({context:'air-stationary',externallyBlocked:false});
  dk.equipItem({definition:{itemClass:'battering'},canUse:()=>true,noteUse:()=>{},spendShot:()=>false,getAmmo:()=>null});expect(dk.getPackedBodyState().surfaceTech).not.toBeNull();
  expect(begin('throw-air-forward-ordinary',1)).toBe(true);expect(dk.getPackedBodyState().surfaceTech).toBeNull();
 });
 it('source motionless air Zdrop preserves actionable wall-tech-jump body',()=>{
  const {dk,ground,begin}=fighter();ground.mockReturnValue(false);
  (dk as any).surfaceTech={...beginSurfaceTech('wall-jump',1,1,SURFACE_TECH_PROFILES.donkeykong),framesElapsed:1};
  dk.equipItem({definition:{itemClass:'battering'},canUse:()=>true,noteUse:()=>{},spendShot:()=>false,getAmmo:()=>null});expect(begin('air-z-drop',1)).toBe(true);
  expect(dk.getPackedBodyState().surfaceTech).not.toBeNull();
 });
});
