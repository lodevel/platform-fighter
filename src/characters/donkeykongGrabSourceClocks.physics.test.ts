import {createRequire} from 'node:module';
import {describe,expect,it} from 'vitest';
import {DonkeyKong,DONKEYKONG_GRAB} from './DonkeyKong';
import type {CharacterInput} from './Character';
import {stepCharacterPhysics} from './stepCharacterPhysics';
import {HitboxDamageHandler} from '../match/HitboxDamageHandler';
import {STALE_FACTORS,STALE_FRESH_MULTIPLIER} from './combat';
import {GAME_CONFIG} from '../engine/constants';
import {COLLISION_CATEGORIES} from '../engine/collisionCategories';
import {PLATFORM_LABELS} from '../stages/stageBodies';
import {packedBodyCandidate} from './packedBodyPresentation';
import {captureSimulationAnimation} from './simulationSpriteAnimation';
const require=createRequire(import.meta.url),Engine=require('../physics/matter/source/lib/core/Engine.js'),Events=require('../physics/matter/source/lib/core/Events.js'),Bodies=require('../physics/matter/source/lib/factory/Bodies.js'),Body=require('../physics/matter/source/lib/body/Body.js'),Composite=require('../physics/matter/source/lib/body/Composite.js');
function fixture(facing:1|-1=1){
 const engine=Engine.create();engine.gravity.y=GAME_CONFIG.gravity;
 const names:Record<string,string>={collisionstart:'collisionStart',collisionactive:'collisionActive',collisionend:'collisionEnd'};
 const scene:any={matter:{body:Body,add:{rectangle(x:number,y:number,w:number,h:number,o:object){const b=Bodies.rectangle(x,y,w,h,o);Composite.add(engine.world,b);return b;}},world:{on(n:string,f:any){Events.on(engine,names[n]??n,f);},off(n:string,f:any){Events.off(engine,names[n]??n,f);},remove(b:any){Composite.remove(engine.world,b);}}}};
 const dk=new DonkeyKong(scene,{spawnX:0,spawnY:0}),victim=new DonkeyKong(scene,{spawnX:55*facing,spawnY:0});dk.setFacing(facing);victim.setFacing((-facing) as 1|-1);
 Composite.add(engine.world,Bodies.rectangle(0,52,2400,20,{isStatic:true,label:PLATFORM_LABELS.solid,collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}));
 const fighters=[dk,victim],contacts:any[]=[];
 const handler=new HitboxDamageHandler((index,hit,context)=>{if(context.kind==='grab'){dk.resolveGrabConnect(victim);const confirmed=victim.getGrabbedBy()===dk;contacts.push({kind:'grab',confirmed});return{confirmed};}const result=fighters[index]!.applyHitDetailed(hit);contacts.push({kind:'damage',index,hit,result});return{confirmed:result.outcome==='landed'};});
 handler.registerPlayer(0,dk.body);handler.registerPlayer(1,victim.body);handler.setFacingLookup(i=>fighters[i]!.getFacing());handler.setGroundedLookup(i=>fighters[i]!.isGrounded());handler.setHurtboxLookup(i=>fighters[i]!.getActiveHurtboxes());
 for(const n of ['collisionStart','collisionActive'])Events.on(engine,n,(e:any)=>handler.handleCollisionStart(e));
 let frame=0;const tick=(input:Partial<CharacterInput>={})=>{dk.applyInput({moveX:0,jump:false,...input},++frame);victim.applyInput({moveX:0,jump:false},frame);stepCharacterPhysics({characters:fighters,bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:GAME_CONFIG.fixedTimestepMs,stepWorld:d=>Engine.update(engine,d)});handler.sampleHurtboxContacts(Composite.allBodies(engine.world));};
 dk.setInvincibility(0);victim.setInvincibility(0);for(let n=0;n<20;n++)tick();expect(dk.isGrounded()).toBe(true);dk.setFacing(facing);
 const capture=()=>{tick({grab:true});for(let n=0;n<18&&!victim.isGrabbed();n++)tick();expect(victim.getGrabbedBy()).toBe(dk);expect(contacts.some(c=>c.kind==='grab'&&c.confirmed)).toBe(true);};
 const cargo=()=>{capture();tick({attack:true,moveX:facing});expect(dk.getGrabState()).toMatchObject({name:'holding',active:{cargo:true,cargoStartupRemaining:16}});expect(dk.getPackedBodyState().cargoEntry?.framesElapsed).toBe(0);};
 const candidate=()=>packedBodyCandidate(captureSimulationAnimation(dk,0,false));
 const clean=()=>{dk.destroy();victim.destroy();Engine.clear(engine);Composite.clear(engine.world,false);};return{dk,victim,tick,capture,cargo,candidate,clean};
}
describe('DK opted grab clocks with normal Matter grab sensor; no native attachment parity',()=>{
 it.each([1,-1] as const)('pummel born0/contact1/freeze15/damage-once/held7 and cooldown1 accepted edge face%s',facing=>{
  const f=fixture(facing);try{f.capture();f.tick({attack:true});expect(f.dk.getPackedBodyState().pummel).toMatchObject({framesElapsed:0,facing});expect(f.victim.getDamagePercent()).toBe(0);
   f.tick();expect(f.victim.getDamagePercent()).toBeCloseTo(1.6*STALE_FRESH_MULTIPLIER,10);expect(f.dk.getPackedBodyState().pummel?.framesElapsed).toBe(1);expect(f.dk.getGrabState().active?.pummelCooldownRemaining).toBe(6);
   for(let n=0;n<15;n++){f.tick();expect(f.dk.getPackedBodyState().pummel?.framesElapsed).toBe(1);expect(f.victim.getDamagePercent()).toBeCloseTo(1.6*STALE_FRESH_MULTIPLIER,10);}
   for(let age=2;age<=6;age++){f.tick();expect(f.dk.getPackedBodyState().pummel?.framesElapsed).toBe(age);}
   expect(f.dk.getGrabState().active?.pummelCooldownRemaining).toBe(1);f.tick({attack:true});expect(f.dk.getPackedBodyState().pummel?.framesElapsed).toBe(0);expect(f.dk.getGrabState().active?.pummelCooldownRemaining).toBe(21);f.tick();expect(f.victim.getDamagePercent()).toBeCloseTo(1.6*(STALE_FRESH_MULTIPLIER+1-STALE_FACTORS[0]),10);
  }finally{f.clean();}
 });
 it('pummel ends into explicit held age0, never repeats grab_pull from low total holding age',()=>{
  const f=fixture();try{f.capture();f.tick({attack:true});f.tick();for(let n=0;n<15+6;n++)f.tick();expect(f.dk.getPackedBodyState().pummel).toBeNull();
   // The pummel clip's remaining drawings play out over the hold (its tail), then the hold starts at its own drawing 0.
   for(let age=7;age<17;age++){expect(f.candidate()).toMatchObject({sheet:'pummel',age});f.tick();}
   expect(f.candidate()?.sheet).toBe('grab_hold');expect(f.dk.getPackedBodyState().clock).toMatchObject({sheet:'grab_hold',framesElapsed:0});}finally{f.clean();}
 });
 it.each([1,-1] as const)('cargo eligibility16 vs bodytail23/hold24 with no new lock face%s',facing=>{
  const f=fixture(facing);try{f.cargo();for(let age=1;age<=23;age++){f.tick();expect(f.candidate()).toMatchObject({sheet:'fthrow',age});if(age===16)expect(f.dk.getGrabState().active?.cargoStartupRemaining).toBe(0);}
   expect(f.victim.isGrabbed()).toBe(true);f.tick();expect(f.dk.getPackedBodyState().cargoEntry).toBeNull();
   // The entry clip's last drawing (native 25) plays as its tail, then the carry starts at its own drawing 0.
   expect(f.candidate()).toMatchObject({sheet:'fthrow',age:24});f.tick();expect(f.candidate()?.sheet).toBe('cargo_hold');expect(f.dk.getPackedBodyState().clock).toMatchObject({sheet:'cargo_hold',framesElapsed:0});
  }finally{f.clean();}
 });
 it('fresh cargo throw16 is rejected without buffering, separate fresh18 is accepted',()=>{
  const f=fixture();try{f.cargo();for(let age=1;age<=15;age++)f.tick();f.tick({attack:true,moveY:-1});expect(f.dk.getGrabState().name).toBe('holding');expect(f.dk.getPackedBodyState().cargoEntry?.framesElapsed).toBe(16);f.tick();f.tick({attack:true,moveY:-1});expect(f.dk.getGrabState()).toMatchObject({name:'throwing',active:{throwDirection:'up',framesElapsed:0}});expect(f.dk.getPackedBodyState().cargoEntry).toBeNull();}finally{f.clean();}
 });
 it('first fresh cargo throw at17 is accepted after neutral eligibility drain16',()=>{
  const f=fixture();try{f.cargo();for(let age=1;age<=16;age++)f.tick();expect(f.dk.getGrabState().active?.cargoStartupRemaining).toBe(0);f.tick({attack:true,moveY:-1});expect(f.dk.getGrabState()).toMatchObject({name:'throwing',active:{throwDirection:'up',framesElapsed:0}});expect(f.dk.getPackedBodyState().cargoEntry).toBeNull();}finally{f.clean();}
 });
 it('frozen cargo tail ignores unaccepted movement through final freeze-drain, then actual walk retires it',()=>{
  const f=fixture();try{f.cargo();for(let age=1;age<=17;age++)f.tick();f.dk.armAttackerHitlag(3);for(let n=0;n<3;n++){f.tick({moveX:1});expect(f.dk.getPackedBodyState().cargoEntry?.framesElapsed).toBe(17);}f.tick({moveX:1});expect(f.dk.getPackedBodyState().cargoEntry).toBeNull();}finally{f.clean();}
 });
 it.each(['teleport','reset','release'] as const)('cargo target %s invalidates inherited tail immediately and never resumes',kind=>{
  const f=fixture();try{f.cargo();for(let n=0;n<18;n++)f.tick();if(kind==='teleport')f.victim.setPosition(1000,-100);else if(kind==='reset')f.victim.resetForRound(1000,-100);else f.victim.releaseFromGrab('external');expect(f.dk.getPackedBodyState().cargoEntry).toBeNull();f.tick();expect(f.dk.getPackedBodyState().cargoEntry).toBeNull();}finally{f.clean();}
 });
 it.each(['walk','jump'] as const)('accepted cargo %s at16 retires tail without extending startup',action=>{
  const f=fixture();try{f.cargo();for(let age=1;age<=15;age++)f.tick();f.tick(action==='walk'?{moveX:1}:{jump:true});expect(f.dk.getGrabState().active?.cargoStartupRemaining).toBe(0);expect(f.dk.getPackedBodyState().cargoEntry).toBeNull();if(action==='jump')expect(f.dk.getJumpsquatRemaining()).toBeGreaterThan(0);}finally{f.clean();}
 });
 it('rejected post-release-protected capture does not interrupt an owned pending pummel',()=>{
  const f=fixture();try{f.capture();f.tick({attack:true});(f.dk as any).postReleaseGrabImmunity={remaining:1,lastFrame:-1};f.dk.applyGrabbed(f.victim);expect(f.dk.isGrabbed()).toBe(false);expect(f.dk.getPackedBodyState().pummel?.framesElapsed).toBe(0);f.tick();expect(f.victim.getDamagePercent()).toBeCloseTo(1.6*STALE_FRESH_MULTIPLIER,10);}finally{f.clean();}
 });
 it.each(['teleport','reset','release'] as const)('target %s invalidates source body/damage ownership before regrab',kind=>{
  const f=fixture();try{f.capture();f.tick({attack:true});if(kind==='teleport')f.victim.setPosition(1000,-100);else if(kind==='reset')f.victim.resetForRound(1000,-100);else f.victim.releaseFromGrab('external');expect(f.dk.getPackedBodyState().pummel).toBeNull();f.tick();expect(f.victim.getDamagePercent()).toBe(0);}finally{f.clean();}
 });
 it.each([1,-1] as const)('cargo aerial selection/root samples survive landing and released recovery face%s',facing=>{
  const f=fixture(facing);try{
   const airRows=Array.from({length:44},(_,i)=>i*.1),groundRows=Array.from({length:44},(_,i)=>i*.2);
   f.dk.setGrabSpec({...DONKEYKONG_GRAB,cargo:{...DONKEYKONG_GRAB.cargo!,throws:{...DONKEYKONG_GRAB.cargo!.throws,down:{...DONKEYKONG_GRAB.cargo!.throws.down,rootMotionX:groundRows}},airThrows:{...DONKEYKONG_GRAB.cargo!.airThrows!,down:{...DONKEYKONG_GRAB.cargo!.airThrows!.down,rootMotionX:airRows}}}});
   f.cargo();for(let n=0;n<17;n++)f.tick();Body.setPosition(f.dk.body,{x:0,y:-250});Body.setVelocity(f.dk.body,{x:0,y:0});f.tick();f.tick();expect(f.dk.isGrounded()).toBe(false);
   f.tick({attack:true,moveY:1});expect(f.dk.getThrowPresentationState()).toMatchObject({cargo:true,airborne:true,framesElapsed:0});
   Body.setPosition(f.dk.body,{x:0,y:0});Body.setVelocity(f.dk.body,{x:0,y:0});for(let age=1;age<16;age++)f.tick();expect(f.dk.isGrounded()).toBe(true);
   f.tick();expect(f.victim.isGrabbed()).toBe(false);expect(f.dk.getThrowPresentationState()).toMatchObject({cargo:true,airborne:true,framesElapsed:16,phase:'recovery',facing});
   // Explicit authored root samples are a regression fixture, not native motion parity.
   expect((f.dk as any).getAuthoredThrowRootMotion()).toMatchObject({samples:airRows,frame:16,facing});f.tick();expect((f.dk as any).getAuthoredThrowRootMotion()).toMatchObject({samples:airRows,frame:17,facing});
  }finally{f.clean();}
 });
 it.each([1,-1] as const)('actual back throw releases age14, reverses once and keeps recovery to39 face%s',facing=>{
  const f=fixture(facing);try{f.capture();f.tick({attack:true,moveX:-facing});expect(f.dk.getThrowPresentationState()).toMatchObject({direction:'back',framesElapsed:0,facing});
   for(let age=1;age<14;age++){f.tick();expect(f.victim.isGrabbed()).toBe(true);}
   f.tick();expect(f.victim.isGrabbed()).toBe(false);expect(f.victim.getDamagePercent()).toBeCloseTo(DONKEYKONG_GRAB.throws.back.damage*STALE_FRESH_MULTIPLIER,10);expect(f.dk.getFacing()).toBe(-facing);expect(f.dk.getThrowPresentationState()).toMatchObject({framesElapsed:14,phase:'recovery',facing});
   for(let age=15;age<39;age++){f.tick();expect(f.dk.getThrowPresentationState()?.framesElapsed).toBe(age);expect(f.dk.getFacing()).toBe(-facing);}
   f.tick();expect(f.dk.getGrabState().name).toBe('idle');expect(f.dk.getThrowPresentationState()).toBeNull();
  }finally{f.clean();}
 });
});
