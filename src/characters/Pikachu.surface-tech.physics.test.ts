import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
import {Pikachu} from './Pikachu';
import {type CharacterInput} from './Character';
import {stepCharacterPhysics} from './stepCharacterPhysics';
import {createPikachuSpecialMoves} from './pikachuSpecialMoves';
import {registerFighterAttack} from './attackRegistration';
import {COLLISION_CATEGORIES} from '../engine/collisionCategories';

const require=createRequire(import.meta.url);
const Engine=require('../physics/matter/source/lib/core/Engine.js'),Events=require('../physics/matter/source/lib/core/Events.js'),Bodies=require('../physics/matter/source/lib/factory/Bodies.js'),Body=require('../physics/matter/source/lib/body/Body.js'),Composite=require('../physics/matter/source/lib/body/Composite.js');
const neutral:CharacterInput={moveX:0,moveY:0,jump:false};
type Kind='wall'|'ceiling'|'floor';

function fixture(kind:Kind,side:1|-1,facing:1|-1){
 const engine=Engine.create(),names:Record<string,string>={collisionstart:'collisionStart',collisionactive:'collisionActive',collisionend:'collisionEnd'};
 const scene:any={matter:{body:Body,add:{rectangle(x:number,y:number,w:number,h:number,options:object){const b=Bodies.rectangle(x,y,w,h,options);Composite.add(engine.world,b);return b;}},world:{on(name:string,fn:(...args:any[])=>void){Events.on(engine,names[name]??name,fn);},off(name:string,fn:(...args:any[])=>void){Events.off(engine,names[name]??name,fn);},remove(b:any){Composite.remove(engine.world,b);}}}};
 const actor=new Pikachu(scene,{spawnX:0,spawnY:0});actor.setFacing(facing);
 for(const move of Object.values(createPikachuSpecialMoves()))registerFighterAttack(actor,move);
 const options={isStatic:true,label:'platform.solid',collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}};
 const surface=kind==='wall'?Bodies.rectangle(side*60,0,20,1000,options):kind==='ceiling'?Bodies.rectangle(0,-65,1000,20,options):Bodies.rectangle(0,65,1000,20,options);
 Composite.add(engine.world,surface);
 const step=(input:CharacterInput=neutral)=>{actor.applyInput(input);stepCharacterPhysics({characters:[actor],bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:1000/60,stepWorld:dt=>Engine.update(engine,dt)});};
 const livePair=()=>[...(actor as any).contactPairs.values()].find((pair:any)=>(pair.bodyA===surface||pair.bodyB===surface)&&pair.isActive!==false);
 const launch=()=>actor.applyHit({damage:1,knockback:{x:kind==='wall'?8:0,y:kind==='ceiling'?-8:kind==='floor'?8:0,scaling:0},facing:side,hitlagMultiplier:1});
 const reachContact=(input:CharacterInput=neutral)=>{for(let n=0;n<80&&!livePair();n++)step(input);expect(livePair()).toBeDefined();};
 const state=()=>{const s=actor.getPikachuSurfaceTechPresentationState();if(!s)throw new Error('Expected installed surface-tech owner');return s;};
 const enter=()=>{launch();reachContact();step({...neutral,shield:true});expect(state().kind).toBe(kind);return state();};
 const advanceTo=(age:number)=>{while(state().framesElapsed<age)step();};
 const addFloor=()=>{const p=actor.getPosition();const floor=Bodies.rectangle(p.x,p.y+35,1000,20,options);Composite.add(engine.world,floor);return floor;};
 const dispose=()=>{actor.destroy();Engine.clear(engine);Composite.clear(engine.world,false);};
 return{actor,surface,step,launch,reachContact,state,enter,advanceTo,addFloor,dispose};
}

const contacts:Array<{kind:'wall'|'ceiling';side:1|-1;facing:1|-1}>=[
 ...([1,-1] as const).flatMap(side=>([1,-1] as const).map(facing=>({kind:'wall' as const,side,facing}))),
 ...([1,-1] as const).map(facing=>({kind:'ceiling' as const,side:1 as const,facing}))
];

describe('Installed Pikachu wall/ceiling tech from genuine Matter contacts',()=>{
 it.each(contacts)('runs $kind side$side face$facing with its own source body/protection and exact exit',({kind,side,facing})=>{
  const f=fixture(kind,side,facing);
  try{
   const entered=f.enter(),initial=f.actor.getPosition();
   expect(entered.framesElapsed).toBe(0);expect(f.actor.isGrounded()).toBe(false);expect(f.actor.isTumbling()).toBe(false);
   const duration=kind==='wall'?25:27;
   for(let age=0;age<duration;age++){
    expect(f.state().framesElapsed).toBe(age);expect(f.actor.getActiveHurtboxes()).toHaveLength(12);
    expect(f.actor.isInvincible()).toBe(age<(kind==='wall'?20:17));
    expect(f.actor.body.ignoreGravity??false).toBe(kind==='ceiling');
    if(age<duration-1)f.step({...neutral,attack:true});
   }
   if(kind==='ceiling'){
    const actual=f.actor.getPosition().y-initial.y;
    // Tiny source recoil initially remains in the live ceiling contact.
    // Keep its observed solver loss, without an absolute root catch-up.
    expect(Math.abs(actual-22.24249839782715)).toBeLessThanOrEqual(.1);
   }
   f.step();expect(f.actor.getPikachuSurfaceTechPresentationState()).toBeNull();expect(f.actor.body.ignoreGravity??false).toBe(false);
  }finally{f.dispose();}
 });

 it.each((['wall','ceiling'] as const).flatMap(kind=>(['held','expired','mask0','sensor','stale'] as const).map(variant=>({kind,variant}))))('rejects $kind $variant despite real preceding contact',({kind,variant})=>{
  const f=fixture(kind,1,1);
  try{
   if(variant==='held')f.step({...neutral,shield:true});
   f.launch();
   // Ultimate's 11-frame tech window (paused in hitlag) must lapse before contact:
   // hold the launched body at its start (with its launch velocity) until the press has expired.
   if(variant==='expired'){const start=f.actor.getPosition();f.step({...neutral,shield:true});
    let launched:{x:number;y:number}|null=null;
    while((f.actor as any).techBufferRemaining>0){if(!launched&&!f.actor.isInHitlag())launched=f.actor.getVelocity();
     Body.setPosition(f.actor.body,start);if(launched)Body.setVelocity(f.actor.body,launched);f.step();}
    expect(f.actor.isTechLockedOut()).toBe(true);}
   f.reachContact(variant==='held'?{...neutral,shield:true}:neutral);
   if(variant==='mask0')f.surface.collisionFilter.mask=0;
   if(variant==='sensor')f.surface.isSensor=true;
   if(variant==='stale')Body.setPosition(f.surface,{x:f.surface.position.x+2000,y:f.surface.position.y});
   f.step({...neutral,shield:true});expect(f.actor.getPikachuSurfaceTechPresentationState()).toBeNull();
  }finally{f.dispose();}
 });

 it.each([1,-1] as const)('keeps a real floor contact in the ground-tech owner, facing%s',facing=>{
  const f=fixture('floor',1,facing);
  try{f.launch();f.reachContact();expect(f.actor.isGrounded()).toBe(true);f.step({...neutral,shield:true});expect(f.actor.getPikachuSurfaceTechPresentationState()).toBeNull();expect(f.actor.getPikachuGroundRecoveryPresentationState()?.sheet).toBe('tech');}finally{f.dispose();}
 });

 it.each(['wall','ceiling'] as const)('freezes %s source age, then resumes the correct kinetic owner',kind=>{
  const f=fixture(kind,1,1);
  try{
   f.enter();f.advanceTo(8);const frozen=f.actor.getPosition();f.actor.armAttackerHitlag(3);
   for(let n=0;n<2;n++){f.step();expect(f.state().framesElapsed).toBe(8);expect(f.actor.getPosition()).toEqual(frozen);}
   f.step();expect(f.actor.getHitlagRemaining()).toBe(0);expect(f.state().framesElapsed).toBe(8);
   if(kind==='wall'){expect(f.actor.getVelocity().x).toBeCloseTo(-2.5,8);expect(f.actor.getPosition().x-frozen.x).toBeCloseTo(-2.5,8);}
   else {expect(f.actor.getVelocity().y).toBe(0);expect(Math.abs(f.actor.getPosition().y-frozen.y)).toBeLessThanOrEqual(.1);}
   f.step();expect(f.state().framesElapsed).toBe(9);expect(f.actor.body.ignoreGravity??false).toBe(kind==='ceiling');
  }finally{f.dispose();}
 });

 it.each(['wall','ceiling'] as const)('retires %s and restores ordinary gravity when vulnerable damage arrives',kind=>{
  const f=fixture(kind,1,1);
  try{f.enter();f.advanceTo(kind==='wall'?20:17);expect(f.actor.isInvincible()).toBe(false);f.actor.applyHit({damage:1,knockback:{x:0,y:0,scaling:0},facing:1,hitlagMultiplier:1});expect(f.actor.getPikachuSurfaceTechPresentationState()).toBeNull();expect(f.actor.body.ignoreGravity??false).toBe(false);}finally{f.dispose();}
 });

 it.each(['wall','ceiling'] as const)('retires %s on genuine floor support and accepts a fresh ground jump',kind=>{
  const f=fixture(kind,1,1);
  try{f.enter();f.advanceTo(8);f.addFloor();f.step();expect(f.actor.isGrounded()).toBe(true);f.step();expect(f.actor.getPikachuSurfaceTechPresentationState()).toBeNull();expect(f.actor.body.ignoreGravity??false).toBe(false);for(let n=0;n<10&&f.actor.getLandingPresentationState();n++)f.step();expect(f.actor.getLandingPresentationState()).toBeNull();f.step({...neutral,jump:true});expect(f.actor.getJumpsquatRemaining()).toBeGreaterThan(0);}finally{f.dispose();}
 });

 it.each(['wall','ceiling'] as const)('allows fresh normal aerial input on the first free %s step',kind=>{
  const f=fixture(kind,1,1);
  try{const duration=f.enter().duration;f.advanceTo(duration-1);f.step({...neutral,jump:true});expect(f.actor.getPikachuSurfaceTechPresentationState()).toBeNull();expect(f.actor.body.ignoreGravity??false).toBe(false);expect(f.actor.getJumpPresentationState()?.kind).toBe('air');expect(f.actor.getVelocity().y).toBeLessThan(-10);}finally{f.dispose();}
 });
});
