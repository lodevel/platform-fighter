import {createRequire} from 'node:module';
import {describe,expect,it} from 'vitest';
import {type CharacterInput} from './Character';
import {Pikachu} from './Pikachu';
import {createPikachuSpecialMoves} from './pikachuSpecialMoves';
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
 const actor=new Pikachu(scene,{spawnX,spawnY:0});
 for(const move of Object.values(createPikachuSpecialMoves()))registerFighterAttack(actor,move);
 if(grounded)Composite.add(engine.world,Bodies.rectangle(0,35,4000,20,{isStatic:true,label:PLATFORM_LABELS.solid,collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}));
 const prepare=(input:CharacterInput=neutral)=>actor.applyInput(input);
 const physics=()=>stepCharacterPhysics({characters:[actor],bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:1000/60,stepWorld:dt=>Engine.update(engine,dt)});
 const step=(input:CharacterInput=neutral)=>{prepare(input);physics();};
 if(grounded)for(let n=0;n<8;n++)step();
 return{actor,step,prepare,physics,addWall(side:1|-1){const p=actor.getPosition();const wall=Bodies.rectangle(p.x+side*29,p.y,20,400,{isStatic:true,label:PLATFORM_LABELS.solid,collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}});Composite.add(engine.world,wall);return wall;},armAtContact(){let armed=false;Events.on(engine,'collisionActive',()=>{if(!armed){armed=true;actor.armAttackerHitlag(8);}});}};
}

describe('Pikachu ordinary beta wall bounce from real solid side contact',()=>{
 it.each([1,-1]as const)('leaves side%s with exhausted airjump budget unchanged and paired sourcebody',side=>{
  const f=fixture(false);f.step({...neutral,jump:true});f.step();f.step({...neutral,jump:true});expect(f.actor.getJumpsUsed()).toBe(2);
  f.addWall(side);f.step();expect(f.actor.isGrounded()).toBe(false);const before=f.actor.getPosition();
  f.step({...neutral,jump:true});expect(f.actor.getJumpsUsed()).toBe(2);expect(f.actor.getPikachuAuxiliaryAirPresentationState()).toEqual({sheet:'wall_jump',framesElapsed:0,facing:-side});
  expect(f.actor.getFacing()).toBe(-side);expect((f.actor.getPosition().x-before.x)*-side).toBeGreaterThan(6);
  expect(f.actor.getVelocity().y).toBeLessThan(-12);expect(f.actor.getActiveHurtboxes()).toHaveLength(12);
  for(let n=1;n<15;n++){f.step({...neutral,jump:true});expect(f.actor.getPikachuAuxiliaryAirPresentationState()?.framesElapsed).toBe(n);expect(f.actor.getJumpsUsed()).toBe(2);}
  f.step({...neutral,special:true});expect(f.actor.getActiveAttack()?.move.id).toBe('pikachu.neutral_special');expect(f.actor.getPikachuAuxiliaryAirPresentationState()).toBeNull();
 });
 it.each([1,-1]as const)('accepts a fresh outward stick edge at side%s without ordinary airjump',side=>{
  const f=fixture(false);f.addWall(side);f.step();const budget=f.actor.getJumpsUsed();f.step({...neutral,moveX:-side});expect(f.actor.getPikachuAuxiliaryAirPresentationState()?.sheet).toBe('wall_jump');expect(f.actor.getJumpsUsed()).toBe(budget);
 });
 it('keeps ordinary exhausted-jump behavior without any side contact',()=>{
  const f=fixture(false);f.step({...neutral,jump:true});f.step();f.step({...neutral,jump:true});f.step();f.step({...neutral,jump:true});expect(f.actor.getPikachuAuxiliaryAirPresentationState()).toBeNull();expect(f.actor.getJumpsUsed()).toBe(2);
 });
});
