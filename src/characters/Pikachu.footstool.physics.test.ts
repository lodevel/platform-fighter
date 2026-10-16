import {createRequire} from 'node:module';
import {describe,expect,it} from 'vitest';
import {Pikachu} from './Pikachu';
import {DonkeyKong} from './DonkeyKong';
import {DONKEYKONG_FOOTSTOOL_PARAMETERS} from './donkeykongFootstool';
import {type CharacterInput} from './Character';
import {resolvePikachuFootstools} from './pikachuFootstool';
import {stepCharacterPhysics} from './stepCharacterPhysics';
import {PLATFORM_LABELS} from '../stages/stageBodies';
import {COLLISION_CATEGORIES} from '../engine/collisionCategories';

const require=createRequire(import.meta.url);
const Engine=require('../physics/matter/source/lib/core/Engine.js');
const Events=require('../physics/matter/source/lib/core/Events.js');
const Bodies=require('../physics/matter/source/lib/factory/Bodies.js');
const Body=require('../physics/matter/source/lib/body/Body.js');
const Composite=require('../physics/matter/source/lib/body/Composite.js');
const neutral:CharacterInput={moveX:0,moveY:0,jump:false};

function fixture(grounded=false,pikachuRecipient=false){
 const engine=Engine.create();
 const names:Record<string,string>={collisionstart:'collisionStart',collisionactive:'collisionActive',collisionend:'collisionEnd'};
 const scene:any={matter:{body:Body,add:{rectangle(x:number,y:number,w:number,h:number,options:object){const b=Bodies.rectangle(x,y,w,h,options);Composite.add(engine.world,b);return b;}},world:{on(event:string,fn:(...args:any[])=>void){Events.on(engine,names[event]??event,fn);},off(event:string,fn:(...args:any[])=>void){Events.off(engine,names[event]??event,fn);},remove(body:any){Composite.remove(engine.world,body);}}}};
 const jumper=new Pikachu(scene,{spawnX:0,spawnY:-100});
 const target=pikachuRecipient ? new Pikachu(scene,{spawnX:0,spawnY:0}) : new DonkeyKong(scene,{spawnX:0,spawnY:0});let frame=0;
 if(grounded)Composite.add(engine.world,Bodies.rectangle(0,60,3000,20,{isStatic:true,label:PLATFORM_LABELS.solid,collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}));
 const step=(j:CharacterInput=neutral,t:CharacterInput=neutral)=>{
  frame++;const participants=[jumper.getFootstoolParticipant(1,j),target.getFootstoolParticipant(2,t)];
  const contacts=resolvePikachuFootstools(participants);
  for(const c of contacts){jumper.queueFootstoolJump();if(!c.phantom)target.applyFootstoolRecipient(c.groundedRecipient,frame);}
  jumper.applyInput(j,frame);target.applyInput(t,frame);
  stepCharacterPhysics({characters:[jumper,target],bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:1000/60,stepWorld:dt=>Engine.update(engine,dt)});
  return contacts;
 };
 const align=()=>{const head=target.getFootstoolParticipant(2,neutral).head;Body.setPosition(jumper.body,{x:head.x,y:head.top-30});Body.setVelocity(jumper.body,{x:0,y:1});};
 return{jumper,target,step,align};
}

describe('Pikachu beta footstool pre-input head contact with real Matter bodies',()=>{
 it.each([1,-1] as const)('emits the source-start decorative cue once at a fixed world origin, freezes hitlag and expires independently of recipient37, facing%s',facing=>{
  const f=fixture(false,true);f.target.setFacing(facing);f.align();const origin=f.target.getPosition();
  expect(f.step({...neutral,jump:true})).toHaveLength(1);
  const start=f.target.getPikachuFootstoolVisuals();
  expect(start).toEqual([{kind:'footstoolStep',x:origin.x+25*facing,y:origin.y-5,age:0}]);
  f.target.armAttackerHitlag(3);
  for(let n=0;n<3;n++){f.step({...neutral,jump:true});expect(f.target.getPikachuFootstoolVisuals()).toEqual(start);}
  for(let age=1;age<6;age++){f.step({...neutral,jump:true});expect(f.target.getPikachuFootstoolVisuals()).toEqual([{...start[0],age}]);}
  f.step({...neutral,jump:true});expect(f.target.getPikachuFootstoolVisuals()).toEqual([]);
  for(let age=7;age<30;age++){f.step({...neutral,jump:true});expect(f.target.getPikachuFootstoolVisuals()).toEqual([]);}
  expect(f.target.getFootstoolRecipientPresentationState()).not.toBeNull();
 });
 it('retires the decorative footstool cue on real vulnerable damage, capture and round reset',()=>{
  for(const interruption of ['damage','capture','reset','destroy']){
   const f=fixture(false,true);f.align();f.step({...neutral,jump:true});expect(f.target.getPikachuFootstoolVisuals()).toHaveLength(1);
   if(interruption==='damage')f.target.applyHit({damage:1,facing:1,hitlagMultiplier:0,knockback:{x:1,y:-1,scaling:0}});
   else if(interruption==='capture')f.target.applyGrabbed(f.jumper);
   else if(interruption==='reset')f.target.resetForRound(0,0);
   else f.target.destroy();
   expect(f.target.getPikachuFootstoolVisuals()).toEqual([]);
  }
 });
 it('bounces with an exhausted air-jump budget and suppresses a fresh victim action in the same step',()=>{
  const f=fixture();f.step({...neutral,jump:true});f.step();f.step({...neutral,jump:true});f.step();
  expect(f.jumper.getJumpsUsed()).toBe(2);f.align();const contacts=f.step({...neutral,jump:true},{...neutral,jump:true});
  expect(contacts).toHaveLength(1);expect(f.jumper.getJumpsUsed()).toBe(2);
  expect(f.jumper.getPikachuAuxiliaryAirPresentationState()?.sheet).toBe('footstool_jump');
  expect(f.jumper.getVelocity().y).toBeLessThan(-f.jumper.getTuning().jumpImpulse*1.2);
  expect(f.target.getFootstoolRecipientPresentationState()?.framesElapsed).toBe(0);
  expect(f.target.getJumpsUsed()).toBe(0);expect(f.target.canAttack()).toBe(false);
  expect(f.target.getVelocity().y).toBeGreaterThan(0);
  for(let age=1;age<DONKEYKONG_FOOTSTOOL_PARAMETERS.airRecipientRecoveryFrames;age++){f.step({...neutral,jump:true});expect(f.target.getFootstoolRecipientPresentationState()?.framesElapsed).toBe(age);expect(f.target.canAttack()).toBe(false);}
  f.step();expect(f.target.getFootstoolRecipientPresentationState()).toBeNull();expect(f.target.canAttack()).toBe(true);
 });
 it('cuts a released footstool to the explicit mini multiplier and held input cannot repeat contact',()=>{
  const f=fixture();f.align();f.step({...neutral,jump:true});const full=f.jumper.getVelocity().y;
  f.step();expect(f.jumper.getVelocity().y).toBeGreaterThan(full+2);
  expect(f.jumper.getVelocity().y).toBeGreaterThanOrEqual(-f.jumper.getTuning().jumpImpulse*.7);
  const held=fixture();held.align();held.step({...neutral,jump:true});held.align();
  expect(held.step({...neutral,jump:true})).toHaveLength(0);
 });
 it('leaves an attacking recipient and its velocity intact for a phantom footstool',()=>{
  const f=fixture();f.target.applyInput({...neutral,attack:true});expect(f.target.getActiveAttack()).not.toBeNull();
  f.align();const attack=f.target.getActiveAttack(),contacts=f.step({...neutral,jump:true});
  expect(contacts[0]?.phantom).toBe(true);expect(f.target.getActiveAttack()?.move).toBe(attack?.move);expect(f.target.getActiveAttack()?.framesElapsed).toBe(attack!.framesElapsed+1);
  expect(f.target.getFootstoolRecipientPresentationState()).toBeNull();expect(f.target.getDamagePercent()).toBe(0);
 });
 it('rejects rising movement and a horizontal near miss through actual head geometry',()=>{
  for(const miss of ['rising','side']){const f=fixture();f.align();
   if(miss==='rising')Body.setVelocity(f.jumper.body,{x:0,y:-1});else Body.setPosition(f.jumper.body,{x:f.jumper.getPosition().x+16,y:f.jumper.getPosition().y});
   expect(f.step({...neutral,jump:true})).toHaveLength(0);expect(f.target.getFootstoolRecipientPresentationState()).toBeNull();
  }
 });
 it('uses a separate nine-step grounded reaction without lifting the recipient',()=>{
  const f=fixture(true);for(let n=0;n<20;n++)f.step();expect(f.target.isGrounded()).toBe(true);f.align();
  const y=f.target.getPosition().y;f.step({...neutral,jump:true});expect(f.target.getFootstoolRecipientPresentationState()?.grounded).toBe(true);
  // Tolerance covers the one-step Matter contact resolution of the jumper's weight into the recipient's head (sub-pixel sink, never a lift).
  for(let age=1;age<9;age++){f.step();expect(f.target.canAttack()).toBe(false);expect(Math.abs(f.target.getPosition().y-y)).toBeLessThan(.1);}
  f.step();expect(f.target.canAttack()).toBe(true);expect(f.target.getFootstoolRecipientPresentationState()).toBeNull();
 });
});
