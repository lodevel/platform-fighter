import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Character, type CharacterInput } from './Character';
import { Pikachu } from './Pikachu';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { validateLedgeRootMotion } from './ledgeRootMotionSchema';
const require=createRequire(import.meta.url);
const Engine=require('../physics/matter/source/lib/core/Engine.js');
const Events=require('../physics/matter/source/lib/core/Events.js');
const Bodies=require('../physics/matter/source/lib/factory/Bodies.js');
const Body=require('../physics/matter/source/lib/body/Body.js');
const Composite=require('../physics/matter/source/lib/body/Composite.js');
const source=JSON.parse(readFileSync('docs/review/2026-10-06/pikachu-character/sources/ledge-attack-exact-root-trajectory.json','utf8')) as {frames:{nativeSample:number;sourceProjectedTrans:{x:number;y:number}}[]};
const expected=source.frames.filter(f=>f.nativeSample<=54);
const neutral:CharacterInput={moveX:0,jump:false};
function fixture(facing:1|-1, obstacle=false){
 const engine=Engine.create();const names:Record<string,string>={collisionstart:'collisionStart',collisionactive:'collisionActive',collisionend:'collisionEnd'};
 const scene:any={matter:{body:Body,add:{rectangle(x:number,y:number,w:number,h:number,o:object){const b=Bodies.rectangle(x,y,w,h,o);Composite.add(engine.world,b);return b;}},world:{on(n:string,f:any){Events.on(engine,names[n]??n,f);},off(n:string,f:any){Events.off(engine,names[n]??n,f);},remove(b:any){Composite.remove(engine.world,b);}}}};
 const corner={platformId:'fixture-floor',side:facing===1?'left' as const:'right' as const,x:facing===1?-150:150,y:90};
 const floor=Bodies.rectangle(0,100,300,20,{isStatic:true,label:PLATFORM_LABELS.solid,plugin:{platformId:corner.platformId},collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}});Composite.add(engine.world,floor);
 const actor=new Pikachu(scene,{spawnX:corner.x-12*facing,spawnY:95});actor.setFacing(facing);Body.setVelocity(actor.body,{x:0,y:1});actor.setLedgeCandidates([corner]);
 const friend=new Character(scene,{id:'donkeykong',spawnX:0,spawnY:65,width:40,height:50});
 if(obstacle)Composite.add(engine.world,Bodies.rectangle(corner.x+65*facing,20,20,180,{isStatic:true,label:PLATFORM_LABELS.solid,plugin:{platformId:'other-wall'},collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}));
 const step=(input=neutral)=>{actor.applyInput(input);friend.applyInput(neutral);stepCharacterPhysics({characters:[actor,friend],bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:1000/60,stepWorld:dt=>Engine.update(engine,dt)});};
 for(let i=0;i<25;i++)step();expect(actor.getLedgeHangState().name).toBe('hanging');

 step({...neutral,attack:true});expect(actor.getActiveAttack()?.move.id).toBe('pikachu.ledgeAttack');
 return {actor,friend,step,corner,floor,engine};
}
describe('source-guided ledge attack attachment in real Matter',()=>{
 it.each([1,-1] as const)('climbs exact source path and restores actual floor support %s',facing=>{
  const {actor,friend,step,corner,floor}=fixture(facing);
  for(let age=0;age<55;age++){
   if(age>0)step();const point=expected[age]!.sourceProjectedTrans;
   expect(actor.getActiveAttack()?.framesElapsed).toBe(age);
   // Once ordinary floor collision resumes, Matter's contact slop may
   // shift the solved root; the attached source segment remains exact.
   expect(Math.abs(actor.getPosition().x-(corner.x+point.x*facing))).toBeLessThan(actor.getLedgeAttackRootMotionState()?.attached ? 1e-5 : .05);
   expect(actor.getPosition().y).toBeCloseTo(corner.y-25+point.y,0);
   if(age>=19)expect(actor.getLedgeAttackRootMotionState()?.attached).toBe(false);
   expect(floor.isSensor).toBe(false);expect(friend.getPosition().y).toBeLessThan(66);
   expect(actor.getActiveHurtboxes()).toHaveLength(12);
  }
  expect(actor.isGrounded()).toBe(true);step();expect(actor.getActiveAttack()).toBeNull();expect(actor.getLedgeAttackRootMotionState()).toBeNull();
 });
 it.each([1,-1] as const)('only skips its supporting collider, leaving a different wall solid %s',facing=>{
  const {actor,step,corner}=fixture(facing,true);let maximum=-Infinity;
  for(let age=0;age<55;age++){if(age>0)step();maximum=Math.max(maximum,(actor.getPosition().x-corner.x)*facing);}
  expect(maximum).toBeLessThan(35.2);expect(maximum).toBeGreaterThan(20);expect(actor.isGrounded()).toBe(true);
 });
 it('freezes source age and root during actual hitlag without replaying a displacement',()=>{
  const {actor,step,corner}=fixture(1);for(let i=0;i<10;i++)step();const position=actor.getPosition();actor.armAttackerHitlag(4);
  for(let i=0;i<4;i++){step();expect(actor.getActiveAttack()?.framesElapsed).toBe(10);expect(actor.getPosition().x).toBeCloseTo(position.x);expect(actor.getPosition().y).toBeCloseTo(position.y);}
  step();expect(actor.getActiveAttack()?.framesElapsed).toBe(11);expect(actor.getPosition().y).toBeCloseTo(corner.y-25+expected[11]!.sourceProjectedTrans.y,0);
 });
 it('landed hit, capture and reset retire the attachment immediately',()=>{
  const {actor,step}=fixture(1);for(let i=0;i<28;i++)step();actor.applyHit({damage:3,facing:1,hitlagMultiplier:0,knockback:{x:3,y:-3,scaling:0}});expect(actor.getLedgeAttackRootMotionState()).toBeNull();
  const second=fixture(-1);for(let i=0;i<28;i++)second.step();second.actor.applyGrabbed(second.friend);expect(second.actor.getLedgeAttackRootMotionState()).toBeNull();
  const third=fixture(1);third.actor.resetForRound(0,65);expect(third.actor.getLedgeAttackRootMotionState()).toBeNull();third.step();expect(third.actor.isGrounded()).toBe(true);
 });
 it('rejects sparse/nonfinite ledge tracks instead of interpolating or extending the action',()=>{
  expect(()=>validateLedgeRootMotion([{x:0,y:0}],55)).toThrow();expect(()=>validateLedgeRootMotion([{x:Infinity,y:0}],1)).toThrow();
 });
});
