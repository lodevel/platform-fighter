import {createRequire} from 'node:module';
import {describe,expect,it} from 'vitest';
import {TRIP_OPTION_LOCK_FRAMES,type CharacterInput} from './Character';
import {Pikachu} from './Pikachu';
import {selectPikachuAuxiliaryBody} from './pikachuAuxiliaryBody';
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
 return{actor,step,prepare,physics,armAtContact(){let armed=false;Events.on(engine,'collisionActive',()=>{if(!armed){armed=true;actor.armAttackerHitlag(8);}});}};
}

describe('Pikachu real-floor source-guided neutral and roll wakeups',()=>{
 it.each([1,-1]as const)('keeps a grounded source clock and receiving while locking actual requests, facing%s',facing=>{
  for(const roll of [0,1,-1]){
   const f=fixture(true);f.actor.setFacing(facing);f.actor.applyTrip();
   // SmashWiki Lucario (SSBU)/Floor getups (trip): getup options only "right after 39 frames" of a hard trip.
   for(let i=1;i<TRIP_OPTION_LOCK_FRAMES;i++)f.step();
   f.step(roll?{...neutral,moveX:roll*facing}:{...neutral,jump:true});
   const entry=f.actor.getPikachuGroundRecoveryPresentationState()!;
   expect(entry.sheet).toBe(roll===0?'getup':roll===1?'getup_roll':'getup_roll_back');
   expect(entry.duration).toBe(roll===0?30:36);expect(entry.framesElapsed).toBe(0);
   const initial=f.actor.getPosition();
   for(let age=0;age<entry.duration;age++){
    const current=f.actor.getPikachuGroundRecoveryPresentationState()!;
    expect(f.actor.canAttack()).toBe(false);
    expect(current.framesElapsed).toBe(age);expect(current.facing).toBe(facing);expect(f.actor.isGrounded()).toBe(true);
    const source=selectPikachuAuxiliaryBody(current.sheet,age)!;
    expect(f.actor.getPosition().x).toBeCloseTo(initial.x+source.sourceRootDelta.x*facing,4);
    const receiving=f.actor.getActiveHurtboxes();expect(receiving).toHaveLength(12);
    expect(receiving.every(h=>h.intangible===true)).toBe(age+1<entry.protectionEnd);
    if(age===5){const before=f.actor.getPikachuGroundRecoveryPresentationState();f.actor.armAttackerHitlag(4);for(let n=0;n<4;n++){f.step({...neutral,attack:true,special:true,jump:true});expect(f.actor.getPikachuGroundRecoveryPresentationState()).toEqual(before);}}
    if(age+1<entry.duration){f.step(age===entry.duration-3?neutral:{...neutral,attack:true,special:true,jump:true});expect(f.actor.getActiveAttack()).toBeNull();expect(f.actor.getJumpsquatRemaining()).toBe(0);}
   }
   f.step();expect(f.actor.getPikachuGroundRecoveryPresentationState()).toBeNull();expect(f.actor.getJumpsquatRemaining()).toBe(0);expect(f.actor.canAttack()).toBe(true);
   f.step({...neutral,attack:true});expect(f.actor.getActiveAttack()?.move.id).toBe('pikachu.jab');
  }
 });
});
