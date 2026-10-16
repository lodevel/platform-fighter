import {createRequire} from 'node:module';
import {describe,expect,it} from 'vitest';
import {Character,type CharacterInput} from './Character';
import {createPikachuSpecialMoves} from './pikachuSpecialMoves';
import {PIKACHU_MOVEMENT_PROFILE} from './pikachuMovement';
import {registerFighterAttack} from './attackRegistration';
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

function fixture(grounded:boolean,spawnX=0){
 const engine=Engine.create();
 const names:Record<string,string>={collisionstart:'collisionStart',collisionactive:'collisionActive',collisionend:'collisionEnd'};
 const scene:any={matter:{body:Body,add:{rectangle(x:number,y:number,w:number,h:number,options:object){const b=Bodies.rectangle(x,y,w,h,options);Composite.add(engine.world,b);return b;}},world:{on(event:string,fn:(...args:any[])=>void){Events.on(engine,names[event]??event,fn);},off(event:string,fn:(...args:any[])=>void){Events.off(engine,names[event]??event,fn);},remove(body:any){Composite.remove(engine.world,body);}}}};
 const actor=new Character(scene,{id:'pikachu',spawnX,spawnY:0,width:40,height:50,...PIKACHU_MOVEMENT_PROFILE});
 for(const move of Object.values(createPikachuSpecialMoves()))registerFighterAttack(actor,move);
 if(grounded)Composite.add(engine.world,Bodies.rectangle(0,35,1000,20,{isStatic:true,label:PLATFORM_LABELS.solid,collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}));
 const prepare=(input:CharacterInput=neutral)=>actor.applyInput(input);
 const physics=()=>stepCharacterPhysics({characters:[actor],bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:1000/60,stepWorld:dt=>Engine.update(engine,dt)});
 const step=(input:CharacterInput=neutral)=>{prepare(input);physics();};
 if(grounded)for(let n=0;n<8;n++)step();
 return{actor,step,prepare,physics,armAtContact(){let armed=false;Events.on(engine,'collisionActive',()=>{if(!armed){armed=true;actor.armAttackerHitlag(8);}});}};
}

describe('Pikachu source-body turn/brake beta phases on real Matter floor',()=>{
 it.each([1,-1]as const)('distinguishes initial dash reversal and run reversal, facing%s',facing=>{
  for(const kind of ['dash_turn','run_turn']as const){
   const f=fixture(true);f.actor.setFacing(facing);f.step({...neutral,moveX:facing});
   if(kind==='run_turn')for(let n=0;n<30&&f.actor.getLocomotionStateName()!=='run';n++)f.step({...neutral,moveX:facing});
   f.step({...neutral,moveX:-facing});const entry=f.actor.getPikachuTurnBrakePresentationState()!;
   expect(entry.sheet).toBe(kind);expect(entry.framesElapsed).toBe(0);expect(entry.facing).toBe(facing);expect(f.actor.getFacing()).toBe(-facing);
   const frozen=f.actor.getPikachuTurnBrakePresentationState();for(let n=0;n<10;n++)f.actor.getAnimationSnapshot();expect(f.actor.getPikachuTurnBrakePresentationState()).toEqual(frozen);
   for(let age=1;age<entry.duration;age++){f.step({...neutral,moveX:-facing});expect(f.actor.getPikachuTurnBrakePresentationState()?.framesElapsed).toBe(age);expect(f.actor.isGrounded()).toBe(true);}
   f.step({...neutral,moveX:-facing});expect(f.actor.getPikachuTurnBrakePresentationState()).toBeNull();expect(f.actor.getFacing()).toBe(-facing);
   f.step({...neutral,moveX:-facing});expect(f.actor.getPikachuTurnBrakePresentationState()).toBeNull();
  }
 });
 it.each([1,-1]as const)('uses both actual run half-cycle brake variants independently of facing%s',facing=>{
  for(const phase of [0,13]){
   const f=fixture(true,-150*facing);f.actor.setFacing(facing);f.step({...neutral,moveX:facing});
   for(let n=0;n<30&&f.actor.getLocomotionStateName()!=='run';n++)f.step({...neutral,moveX:facing});
   for(let n=0;n<phase;n++)f.step({...neutral,moveX:facing});const before=f.actor.getVelocity().x;
   f.step();expect(f.actor.getPikachuTurnBrakePresentationState()?.sheet).toBe(phase===0?'run_brake':'run_brake_left');
   expect(Math.abs(f.actor.getVelocity().x)).toBeLessThan(Math.abs(before));expect(f.actor.getFacing()).toBe(facing);
   for(let n=1;n<20;n++)f.step();expect(f.actor.getPikachuTurnBrakePresentationState()?.framesElapsed).toBe(19);
   f.step();expect(f.actor.getPikachuTurnBrakePresentationState()).toBeNull();
  }
 });
 it.each([1,-1]as const)('a real jump interrupts turn without stale orientation or restarted phase%s',facing=>{
  const f=fixture(true);f.actor.setFacing(facing);f.step({...neutral,moveX:facing});f.step({...neutral,moveX:-facing});
  expect(f.actor.getPikachuTurnBrakePresentationState()?.sheet).toBe('dash_turn');f.step({...neutral,jump:true});
  expect(f.actor.getPikachuTurnBrakePresentationState()).toBeNull();expect(f.actor.getJumpsquatRemaining()).toBeGreaterThan(0);
  for(let n=0;n<4;n++)f.step({...neutral,jump:true});expect(f.actor.isGrounded()).toBe(false);expect(f.actor.getPikachuTurnBrakePresentationState()).toBeNull();
 });
});

describe('Pikachu actual supported collision-frame hitlag anchor',()=>{
 it('retains solved floor height when freeze is armed before the position solver',()=>{
  const f=fixture(true);f.armAtContact();f.step();const anchor=f.actor.getPosition();
  expect(anchor.y).toBeLessThan(.051);expect(f.actor.getHitlagRemaining()).toBeGreaterThan(0);
  for(let n=0;n<6;n++){f.step();expect(f.actor.getPosition().y).toBeCloseTo(anchor.y,5);}
 });
});
