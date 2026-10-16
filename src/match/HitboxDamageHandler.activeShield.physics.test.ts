/** Prepared exact shielding/poke contact fixtures; execution belongs to final gate. */
import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
import {HitboxDamageHandler,type HitContext} from './HitboxDamageHandler';
import {spawnHitbox,type AttackMove} from '../characters/attacks';
import {CHARACTER_LABEL} from '../characters/Character';
import {COLLISION_CATEGORIES} from '../engine/collisionCategories';
const require=createRequire(import.meta.url),Engine=require('../physics/matter/source/lib/core/Engine.js'),
  Bodies=require('../physics/matter/source/lib/factory/Bodies.js'),Body=require('../physics/matter/source/lib/body/Body.js'),
  Composite=require('../physics/matter/source/lib/body/Composite.js');
function contact(x:number,facing:1|-1,capsule:boolean,unblockable=false,receiving=true){
  const engine=Engine.create();engine.gravity.y=0;const calls:HitContext[]=[],handler=new HitboxDamageHandler((_player,_hit,context)=>{calls.push(context);return{confirmed:true};});
  handler.setHurtboxLookup(receiving?()=>[{id:'actual-torso',offsetX:0,offsetY:0,width:6,height:6,
    capsule:{start:{x:0,y:0},end:{x:0,y:0},radius:3}}]:null);
  handler.setActiveShieldLookup(()=>({actorGeneration:4,centre:{x:30*facing,y:0},radius:10}));handler.setFacingLookup(()=>facing);
  const scene:any={matter:{body:Body,add:{rectangle:(px:number,py:number,width:number,height:number,options:object)=>{
    const body=Bodies.rectangle(px,py,width,height,options);Composite.add(engine.world,body);return body;
  }},world:{remove:(body:unknown)=>Composite.remove(engine.world,body)}}};
  const move:AttackMove={id:'real-narrowphase-shield-fixture',type:'jab',damage:5,knockback:{x:1,y:0,scaling:0},
    startupFrames:0,activeFrames:3,recoveryFrames:1,cooldownFrames:0,hitbox:{offsetX:x,offsetY:0,width:2,height:2},
    ...(unblockable?{unblockable:true}:{}),...(capsule?{collisionHits:[{id:0,capsule:{start:{x,y:0},end:{x,y:0},radius:1},...(unblockable?{unblockable:true}:{})}]}:{})};
  const sensor=spawnHitbox(scene,{id:'attacker',bodyId:-1,position:{x:0,y:0}},move,facing),
    target=Bodies.rectangle(0,0,1,1,{isStatic:true,label:CHARACTER_LABEL,plugin:{characterId:'receiver',sourceReceivingRequired:true},
      collisionFilter:{category:COLLISION_CATEGORIES.CHARACTER}});
  Composite.add(engine.world,target);handler.registerPlayer(0,target);
  Engine.update(engine,1000/60);handler.sampleHurtboxContacts(Composite.allBodies(engine.world));
  handler.handleCollisionStart({pairs:[{bodyA:sensor,bodyB:target}]},true);
  Engine.clear(engine);Composite.clear(engine.world,false);return calls;
}
describe('active source shield circle versus actual posed receiving',()=>{
  it.each([1,-1] as const)('finds outside-movement-body shield contacts once in both shape paths, facing%s',facing=>{
    for(const capsule of [true,false]){const calls=contact(40,facing,capsule);expect(calls).toHaveLength(1);
      expect(calls[0]!.activeShieldReceipt).toEqual({actorGeneration:4,centre:{x:30*facing,y:0},radius:10});
      expect(calls[0]!.receivingRegions).toEqual([]);}
  });
  it.each([1,-1] as const)('leaves actual torso contact outside the shifted bubble as a poke, facing%s',facing=>{
    const calls=contact(0,facing,true);expect(calls).toHaveLength(1);expect(calls[0]!.activeShieldReceipt).toBeUndefined();
    expect(calls[0]!.receivingRegions?.[0]?.id).toBe('actual-torso');
  });
  it('does not expand unblockable reach to the bubble or invent missing fresh receiving',()=>{
    expect(contact(40,1,true,true)).toEqual([]);expect(contact(40,1,false,true)).toEqual([]);
    expect(contact(40,1,true,false,false)).toEqual([]);
  });
});
