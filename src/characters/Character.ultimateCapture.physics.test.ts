import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
import {Character,type CharacterInput} from './Character';
import {STALE_FRESH_MULTIPLIER} from './combat';
import type {GrabSpec} from './grabSchema';
import {HitboxDamageHandler} from '../match/HitboxDamageHandler';
import {PLATFORM_LABELS} from '../stages/stageBodies';
import {COLLISION_CATEGORIES} from '../engine/collisionCategories';
import {stepCharacterPhysics} from './stepCharacterPhysics';
const require=createRequire(import.meta.url);
const Engine=require('../physics/matter/source/lib/core/Engine.js');
const Events=require('../physics/matter/source/lib/core/Events.js');
const Bodies=require('../physics/matter/source/lib/factory/Bodies.js');
const Body=require('../physics/matter/source/lib/body/Body.js');
const Composite=require('../physics/matter/source/lib/body/Composite.js');
const neutral:CharacterInput={moveX:0,jump:false};
function fixture(percent=0, source=true, reverse=false, airTarget=false){
 const engine=Engine.create();const names:Record<string,string>={collisionstart:'collisionStart',collisionactive:'collisionActive',collisionend:'collisionEnd'};
 const scene:any={matter:{body:Body,add:{rectangle(x:number,y:number,w:number,h:number,o:object){const b=Bodies.rectangle(x,y,w,h,o);Composite.add(engine.world,b);return b;}},world:{on(n:string,f:any){Events.on(engine,names[n]??n,f);},off(n:string,f:any){Events.off(engine,names[n]??n,f);},remove(b:any){Composite.remove(engine.world,b);}}}};
 const captor=new Character(scene,{id:'pikachu',spawnX:0,spawnY:0,width:40,height:50});
 const target=new Character(scene,{id:'donkeykong',spawnX:35,spawnY:airTarget?-200:0,width:40,height:50});target.addDamage(percent);
 const release={damage:2,animationFrames:3,recoveryFrames:2,hitlagMultiplier:0,knockback:{x:1,y:-2,scaling:0}};
 const spec:GrabSpec={id:'capture.fixture',ultimateCapture:source,startupFrames:1,activeFrames:4,whiffRecoveryFrames:1,hitbox:{offsetX:35,offsetY:airTarget?-100:0,width:50,height:airTarget?300:50},holdFramesMax:90,throwRecoveryFrames:2,pummel:{damage:1,cooldownFrames:2,hitlagFrames:3},throws:{forward:release,back:release,up:release,down:release}};captor.setGrabSpec(spec);
 Composite.add(engine.world,Bodies.rectangle(0,35,2000,20,{isStatic:true,label:PLATFORM_LABELS.solid,collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}));
 const handler=new HitboxDamageHandler((index,_hit,context)=>{if(context.kind==='grab'){captor.resolveGrabConnect(index===1?target:captor);return {confirmed:target.isGrabbed()};}return {confirmed:false};});handler.registerPlayer(0,captor.body);handler.registerPlayer(1,target.body);Events.on(engine,'collisionStart',(event:any)=>handler.handleCollisionStart(event));Events.on(engine,'collisionActive',(event:any)=>handler.handleCollisionStart(event));
 let frame=0;const step=(a=neutral,b=neutral)=>{frame++;if(reverse){target.applyInput(b,frame);captor.applyInput(a,frame);}else{captor.applyInput(a,frame);target.applyInput(b,frame);}stepCharacterPhysics({characters:[captor,target],bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:1000/60,stepWorld:dt=>Engine.update(engine,dt)});};
 for(let i=0;i<15;i++)step();step({...neutral,grab:true});for(let i=0;i<5&&!target.isGrabbed();i++)step();expect(target.isGrabbed()).toBe(true);
 return {captor,target,step};
}
describe('source opt-in ordinary capture through real Matter',()=>{
 it.each([false,true])('latches entry percent and releases both roles on29 observed steps regardless input order %s',reverse=>{
  const {captor,target,step}=fixture(22.2,true,reverse);expect(captor.getCaptureBudgetState()?.initialFrames).toBe(127);target.addDamage(40);expect(captor.getCaptureBudgetState()?.initialFrames).toBe(127);
  for(let i=1;i<127;i++){step();expect(target.isGrabbed()).toBe(true);}step();expect(target.isGrabbed()).toBe(false);
  expect(captor.getGrabReleasePresentationState()?.framesElapsed).toBe(0);expect(target.getGrabReleasePresentationState()?.framesElapsed).toBe(0);
  for(let age=1;age<29;age++){step();expect(captor.getGrabReleasePresentationState()?.framesElapsed).toBe(age);expect(target.getGrabReleasePresentationState()?.framesElapsed).toBe(age);expect(captor.canAttack()).toBe(false);expect(target.canAttack()).toBe(false);}
  step();expect(captor.getGrabReleasePresentationState()).toBeNull();expect(target.getGrabReleasePresentationState()).toBeNull();expect(captor.canAttack()).toBe(true);expect(target.canAttack()).toBe(true);
 });
 it.each([false,true])('air captive receives the same29 release lock without a fabricated release arc %s',reverse=>{
  const {captor,target,step}=fixture(0,true,reverse,true);for(let i=0;i<90;i++)step();
  expect(target.getGrabReleasePresentationState()?.groundedAtEntry).toBe(false);expect(captor.getGrabReleasePresentationState()?.groundedAtEntry).toBe(true);
  for(let age=1;age<29;age++){step();expect(target.getGrabReleasePresentationState()?.framesElapsed).toBe(age);expect(captor.getGrabReleasePresentationState()?.framesElapsed).toBe(age);}
  step();expect(target.getGrabReleasePresentationState()).toBeNull();expect(captor.getGrabReleasePresentationState()).toBeNull();
 });
 it('continuous cardinal mashing reaches19 elapsed steps rather than clamping remaining forever',()=>{
  const {captor,target,step}=fixture();const directions=[{moveX:1},{moveX:0,moveY:1},{moveX:-1},{moveX:0,moveY:-1}];
  for(let age=1;age<19;age++){step(neutral,{...neutral,...directions[(age-1)%4]});expect(target.isGrabbed()).toBe(true);expect(captor.getCaptureBudgetState()?.totalFrames).toBeGreaterThanOrEqual(19);}
  step();expect(target.isGrabbed()).toBe(false);expect(target.getCapturePresentationState()?.event.releaseReason).toBe('hold-expired');expect(target.getPostReleaseGrabImmunityRemaining()).toBe(60);
 });
 it('captive hitlag freezes budget age and discards frozen press rather than queuing it',()=>{
  const {captor,target,step}=fixture();for(let i=0;i<8;i++)step();const age=captor.getCaptureBudgetState()?.framesElapsed;
  captor.armAttackerHitlag(4);target.armAttackerHitlag(4);for(let i=0;i<4;i++)step(neutral,{...neutral,jump:true});expect(captor.getCaptureBudgetState()?.framesElapsed).toBe(age);expect(captor.getCaptureBudgetState()?.reduction).toBe(0);
  step(neutral,{...neutral,jump:true});expect(captor.getCaptureBudgetState()?.reduction).toBe(0);step();step(neutral,{...neutral,jump:true});expect(captor.getCaptureBudgetState()?.reduction).toBe(14.4);
 });
 it('throw transition cannot be escaped by later mashing and preserves throw followthrough',()=>{
  const {captor,target,step}=fixture();step({...neutral,moveX:1});expect(captor.getGrabState().name).toBe('throwing');expect(captor.getCaptureBudgetState()).toBeNull();for(let i=0;i<3;i++)step(neutral,{...neutral,moveX:-1,jump:true});expect(target.isGrabbed()).toBe(false);expect(target.getPostReleaseGrabImmunityRemaining()).toBe(60);expect(target.getGrabReleasePresentationState()).toBeNull();expect(target.getDamagePercent()).toBeCloseTo(2*STALE_FRESH_MULTIPLIER,10);
 });
 it('60-step regrab immunity blocks direct captures while ordinary damage remains eligible',()=>{
  const {captor,target,step}=fixture();for(let i=0;i<90;i++)step();expect(target.getPostReleaseGrabImmunityRemaining()).toBe(60);
  target.applyGrabbed(captor);expect(target.isGrabbed()).toBe(false);
  expect(target.applyHitDetailed({damage:3,facing:1,hitlagMultiplier:0,knockback:{x:0,y:0,scaling:0}}).outcome).toBe('landed');expect(target.getDamagePercent()).toBe(3);expect(target.getGrabReleasePresentationState()).toBeNull();
  for(let age=1;age<60;age++){step();expect(target.isCaptureProtected()).toBe(true);}step();expect(target.getPostReleaseGrabImmunityRemaining()).toBe(0);target.applyGrabbed(captor);expect(target.isGrabbed()).toBe(true);
 });
 it('a persistent real grab sensor stays unconfirmed through immunity and connects when60 expires',()=>{
  const {captor,target,step}=fixture();for(let i=0;i<90;i++)step();for(let i=0;i<29;i++)step();
  captor.setGrabSpec({...captor.getGrabSpec()!,activeFrames:100});step({...neutral,grab:true});
  for(let age=31;age<60;age++){step();expect(target.isGrabbed()).toBe(false);}
  expect(target.getPostReleaseGrabImmunityRemaining()).toBe(1);step();expect(target.isGrabbed()).toBe(true);
 });
 it('actual pummel damage and stop do not recalculate the capture-entry budget',()=>{
  const {captor,target,step}=fixture(10);step({...neutral,attack:true});expect(target.getDamagePercent()).toBeCloseTo(10+STALE_FRESH_MULTIPLIER,10);expect(captor.getCaptureBudgetState()?.initialFrames).toBe(107);
  for(let i=0;i<5;i++)step();expect(captor.getCaptureBudgetState()?.initialFrames).toBe(107);expect(target.isGrabbed()).toBe(true);
 });
 it('legacy capture remains flat90 without source release lock or regrab immunity',()=>{
  const {captor,target,step}=fixture(100,false);expect(captor.getCaptureBudgetState()).toBeNull();for(let i=0;i<90;i++)step();expect(target.isGrabbed()).toBe(false);expect(target.getGrabReleasePresentationState()).toBeNull();expect(target.getPostReleaseGrabImmunityRemaining()).toBe(0);
 });
 it('round reset retires release status and grab-only immunity',()=>{const {captor,target,step}=fixture();for(let i=0;i<90;i++)step();target.resetForRound(30,0);captor.resetForRound(0,0);expect(target.getGrabReleasePresentationState()).toBeNull();expect(target.getPostReleaseGrabImmunityRemaining()).toBe(0);expect(captor.getCaptureBudgetState()).toBeNull();});
});
