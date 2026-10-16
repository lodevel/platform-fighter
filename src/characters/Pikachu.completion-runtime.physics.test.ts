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
 return{actor,step,prepare,physics};
}

describe('Pikachu Quick END retains the grounded source SUM speed',()=>{
 it.each([1,-1]as const)('preserves completed physical velocity at grounded END entry facing%s',facing=>{
  const f=fixture(true);f.actor.setFacing(facing);f.step({...neutral,special:true,moveY:-1});
  for(let n=0;n<18;n++)f.step({...neutral,moveX:facing});
  const before=f.actor.getPikachuSpecialState()!;
  expect(before.frame).toBe(18);expect(f.actor.isGrounded()).toBe(true);
  const completed=f.actor.getVelocity();expect(Math.abs(completed.x-facing*55)).toBeLessThan(.03);
  f.prepare();const end=f.actor.getPikachuSpecialState()!;
  expect(end.frame).toBe(19);expect(end.quickEndGrounded).toBe(true);expect(end.gravity).toBeNull();
  expect(f.actor.getVelocity().x).toBeCloseTo(completed.x,6);
  // Observe the reset before the next physical integration can apply its
  // own floor friction; this is source field consumption, not native brake proof.
  f.physics();const after=f.actor.getVelocity();f.prepare();
  expect(f.actor.getVelocity().x).toBeCloseTo(after.x*PIKACHU_MOVEMENT_PROFILE.groundDamping,6);
 });
 it.each([1,-1]as const)('beta STOP recovers on the actual standard-size floor facing%s',facing=>{
  const f=fixture(true,-250*facing);f.actor.setFacing(facing);
  f.step({...neutral,special:true,moveY:-1});
  for(let n=1;n<=52;n++){
   f.step({...neutral,moveX:facing});
   if(n===19)expect(f.actor.getPikachuSpecialState()?.quickEndGrounded).toBe(true);
   expect(f.actor.isGrounded()).toBe(true);
   expect(Math.abs(f.actor.getPosition().x)).toBeLessThan(475);
  }
  expect(f.actor.getPikachuSpecialState(),JSON.stringify(f.actor.getPikachuSpecialState())).toBeNull();expect(f.actor.isHelpless()).toBe(false);
  expect(Math.abs(f.actor.getVelocity().x)).toBeLessThan(.1);expect(f.actor.canAttack()).toBe(true);
  for(let n=0;n<100;n++)f.step();
  expect(f.actor.isGrounded()).toBe(true);expect(Math.abs(f.actor.getPosition().x)).toBeLessThan(475);
 });
 it.each([1,-1]as const)('retains the independent airborne END speed reset facing%s',facing=>{
  const f=fixture(false);f.actor.setFacing(facing);f.step({...neutral,special:true,moveY:-1});
  for(let n=0;n<18;n++)f.step({...neutral,moveX:facing});
  expect(f.actor.getVelocity().x).toBeCloseTo(facing*55,6);f.step();
  const end=f.actor.getPikachuSpecialState()!;expect(end.quickEndGrounded).toBe(false);expect(end.velocity.x).toBe(0);expect(end.velocity.y).toBe(0);expect(end.gravity).toBe(0);
 });
});
