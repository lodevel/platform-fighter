import { describe, expect, it } from 'vitest';
import { Character, type CharacterInput } from './Character';
import { createRequire } from 'node:module';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { registerFighterAttack } from './attackRegistration';
import { validateTauntSet, type TauntSet } from './tauntSchema';
const require = createRequire(import.meta.url);
const Engine=require('../physics/matter/source/lib/core/Engine.js');
const Events=require('../physics/matter/source/lib/core/Events.js');
const Bodies=require('../physics/matter/source/lib/factory/Bodies.js');
const Body=require('../physics/matter/source/lib/body/Body.js');
const Composite=require('../physics/matter/source/lib/body/Composite.js');
const neutral:CharacterInput={moveX:0,jump:false};
const specs:TauntSet={up:{cancelAfterFrames:49,presentationFrames:78},side:{cancelAfterFrames:49,presentationFrames:71},down:{cancelAfterFrames:49,presentationFrames:75}};
function fixture(optIn=true) {
 const engine=Engine.create();
 const names:Record<string,string>={collisionstart:'collisionStart',collisionactive:'collisionActive',collisionend:'collisionEnd'};
 const scene:any={matter:{body:Body,add:{rectangle(x:number,y:number,w:number,h:number,o:object){const b=Bodies.rectangle(x,y,w,h,o);Composite.add(engine.world,b);return b;}},world:{on(n:string,f:any){Events.on(engine,names[n]??n,f);},off(n:string,f:any){Events.off(engine,names[n]??n,f);},remove(b:any){Composite.remove(engine.world,b);}}}};
 const actor=new Character(scene,{id:'donkeykong',spawnX:0,spawnY:0,width:40,height:50});
 Composite.add(engine.world,Bodies.rectangle(0,35,3000,20,{isStatic:true,label:PLATFORM_LABELS.solid,collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}));
 const step=(input=neutral)=>{actor.applyInput(input);Engine.update(engine,1000/60);actor.applyPostPhysicsVelocityConstraints();};
 for(let i=0;i<12;i++)step();
 registerFighterAttack(actor,{id:'fixture.jab',type:'jab',damage:3,knockback:{x:1,y:-1,scaling:0},startupFrames:1,activeFrames:2,recoveryFrames:2,cooldownFrames:0,hitbox:{offsetX:25,offsetY:0,width:20,height:20}});
 if(optIn)actor.setTauntSpec(specs);
 return {actor,step,scene};
}
describe('source-gated observed taunts',()=>{
 it.each([{kind:'up',y:-1,total:78},{kind:'side',y:0,total:71},{kind:'down',y:1,total:75}] as const)('plays $kind without extending cancel50 commitment',({kind,y,total})=>{
  const {actor,step}=fixture();step({...neutral,appeal:true,moveY:y});
  const {entryFrame}=actor.getTauntPresentationState()!;expect(Number.isInteger(entryFrame)).toBe(true);
  expect(actor.getTauntPresentationState()).toEqual({kind,framesElapsed:0,facing:1,cancellable:false,entryFrame});
  expect(actor.isGrounded()).toBe(true);expect(actor.getVelocity().x).toBe(0);
  expect(actor.getOrdinaryPresentationState()).toBeNull();
  for(let age=1;age<total;age++){step();expect(actor.getTauntPresentationState()).toEqual({kind,framesElapsed:age,facing:1,cancellable:age>=49,entryFrame});}
  step();expect(actor.getTauntPresentationState()).toBeNull();
 });
 it('blocks early controls and permits new movement at actual age49',()=>{
  const {actor,step}=fixture();step({...neutral,appeal:true});
  for(let i=1;i<=48;i++)step({...neutral,moveX:1,attack:true,jump:true});
  expect(actor.getTauntPresentationState()?.framesElapsed).toBe(48);expect(actor.isAttacking()).toBe(false);expect(actor.isGrounded()).toBe(true);expect(actor.getVelocity().x).toBe(0);
  step({...neutral,moveX:1});expect(actor.getTauntPresentationState()).toBeNull();expect(actor.getVelocity().x).toBeGreaterThan(0);
 });
 it('permits a fresh real attack on first cancellable age49',()=>{
  const {actor,step}=fixture();step({...neutral,appeal:true});for(let i=1;i<=48;i++)step();
  expect(actor.attemptAttack('fixture.jab')).toBe(false);step({...neutral,attack:true});
  expect(actor.getTauntPresentationState()).toBeNull();expect(actor.getActiveAttack()?.move.id).toBe('fixture.jab');
 });
 it('freezes observed age during hitlag and absent simulation steps',()=>{
  const {actor,step}=fixture();step({...neutral,appeal:true});for(let i=0;i<5;i++)step();
  actor.armAttackerHitlag(4);const before=actor.getPosition();
  for(let i=0;i<4;i++){step();expect(actor.getTauntPresentationState()?.framesElapsed).toBe(5);expect(actor.getPosition().x).toBeCloseTo(before.x);}
  for(let i=0;i<10;i++)expect(actor.getTauntPresentationState()?.framesElapsed).toBe(5);
  step();expect(actor.getTauntPresentationState()?.framesElapsed).toBe(6);
 });
 it('retains entry facing and does not restart from held appeal after natural exit',()=>{
  const {actor,step}=fixture();actor.setFacing(-1);step({...neutral,appeal:true});
  for(let i=0;i<80;i++)step({...neutral,appeal:true});expect(actor.getTauntPresentationState()).toBeNull();
  step();step({...neutral,appeal:true});expect(actor.getTauntPresentationState()?.facing).toBe(-1);
 });
 it('rejects airborne entry and retires immediately on real support loss',()=>{
  const {actor,step}=fixture();actor.setPosition(0,-200);step({...neutral,appeal:true});expect(actor.getTauntPresentationState()).toBeNull();
  actor.resetForRound(0,0);for(let i=0;i<12;i++)step();step({...neutral,appeal:true});expect(actor.getTauntPresentationState()).not.toBeNull();
  actor.setPosition(0,-200);step();expect(actor.getTauntPresentationState()).toBeNull();
 });
 it('interrupts on actual landed damage, capture and round reset',()=>{
  const {actor,step,scene}=fixture();step({...neutral,appeal:true});actor.applyHit({damage:3,facing:1,knockback:{x:1,y:0,scaling:0}});expect(actor.getTauntPresentationState()).toBeNull();
  actor.resetForRound(0,0);for(let i=0;i<12;i++)step();step({...neutral,appeal:true});
  const other=new Character(scene,{id:'pikachu',spawnX:100,spawnY:0});actor.applyGrabbed(other);expect(actor.getTauntPresentationState()).toBeNull();
  actor.resetForRound(0,0);for(let i=0;i<12;i++)step();step({...neutral,appeal:true});actor.resetForRound(0,0);expect(actor.getTauntPresentationState()).toBeNull();
 });
 it('a fighter without taunt data ignores appeal',()=>{const {actor,step}=fixture(false);step({...neutral,appeal:true});expect(actor.getTauntPresentationState()).toBeNull();});
 it.each([0,-1,1.5,Infinity,NaN])('rejects invalid cancellation duration%s',cancelAfterFrames=>{expect(()=>validateTauntSet({...specs,up:{cancelAfterFrames,presentationFrames:78}})).toThrow();});
});
