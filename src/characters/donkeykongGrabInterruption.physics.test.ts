import {createRequire} from 'node:module';
import {describe,expect,it} from 'vitest';
import {DonkeyKong,DONKEYKONG_GRAB} from './DonkeyKong';
import {Pikachu} from './Pikachu';
import type {Character,CharacterInput} from './Character';
import type {KnockbackResult} from './combat';
import {stepCharacterPhysics} from './stepCharacterPhysics';
import {HitboxDamageHandler} from '../match/HitboxDamageHandler';
import {COLLISION_CATEGORIES} from '../engine/collisionCategories';
import {PLATFORM_LABELS} from '../stages/stageBodies';
import {GAME_CONFIG} from '../engine/constants';
const require=createRequire(import.meta.url);
const Engine=require('../physics/matter/source/lib/core/Engine.js'),Events=require('../physics/matter/source/lib/core/Events.js'),Bodies=require('../physics/matter/source/lib/factory/Bodies.js'),Body=require('../physics/matter/source/lib/body/Body.js'),Composite=require('../physics/matter/source/lib/body/Composite.js');
function fixture(facing:1|-1=1,profile:'source'|'legacy-dk'|'pikachu'='source'){
 const engine=Engine.create();engine.gravity.y=GAME_CONFIG.gravity;
 const names:Record<string,string>={collisionstart:'collisionStart',collisionactive:'collisionActive',collisionend:'collisionEnd'};
 const scene:any={matter:{body:Body,add:{rectangle(x:number,y:number,w:number,h:number,o:object){const b=Bodies.rectangle(x,y,w,h,o);Composite.add(engine.world,b);return b;}},world:{on(n:string,f:any){Events.on(engine,names[n]??n,f);},off(n:string,f:any){Events.off(engine,names[n]??n,f);},remove(b:any){Composite.remove(engine.world,b);}}}};
 const target:Character=profile==='pikachu'?new Pikachu(scene,{spawnX:0,spawnY:17}):new DonkeyKong(scene,{spawnX:0,spawnY:0});
 if(profile==='legacy-dk')target.setGrabSpec({...DONKEYKONG_GRAB,attachmentPolicy:undefined});
 const other=new DonkeyKong(scene,{spawnX:500*facing,spawnY:0});
 Composite.add(engine.world,Bodies.rectangle(0,52,2400,20,{isStatic:true,label:PLATFORM_LABELS.solid,collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}));
 const fighters=[target,other],applications:Array<{index:number;outcome:string;damage:number;knockback:KnockbackResult}>=[];
 const handler=new HitboxDamageHandler((index,hit,context)=>{if(context.kind==='grab'){target.resolveGrabConnect(other);return{confirmed:other.getGrabbedBy()===target};}const result=fighters[index]!.applyHitDetailed(hit);applications.push({index,outcome:result.outcome,damage:result.damageApplied,knockback:result.knockback});return{confirmed:result.outcome==='landed'};});
 handler.registerPlayer(0,target.body);handler.registerPlayer(1,other.body);handler.setFacingLookup(i=>fighters[i]!.getFacing());handler.setGroundedLookup(i=>fighters[i]!.isGrounded());handler.setHurtboxLookup(i=>fighters[i]!.getActiveHurtboxes());
 for(const n of ['collisionStart','collisionActive'])Events.on(engine,n,(e:any)=>handler.handleCollisionStart(e));
 let frame=0;const tick=(input:Partial<CharacterInput>={})=>{target.applyInput({moveX:0,jump:false,...input},++frame);other.applyInput({moveX:0,jump:false},frame);stepCharacterPhysics({characters:fighters,bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:GAME_CONFIG.fixedTimestepMs,stepWorld:d=>Engine.update(engine,d)});handler.sampleHurtboxContacts(Composite.allBodies(engine.world));};
 for(const f of fighters)f.setInvincibility(0);for(let n=0;n<20;n++)tick();expect(target.isGrounded()).toBe(true);target.setFacing(facing);
 const sensors=()=>Composite.allBodies(engine.world).filter((b:any)=>b.plugin?.kind==='grab'&&b.plugin.ownerBodyId===target.body.id);
 const enter=(age:number)=>{tick({grab:true});for(let n=0;n<age;n++)tick();};
 const pulse=(zeroStun=false)=>{const hb=target.getActiveHurtboxes()[0]!;const q=hb.capsule?.start??{x:hb.offsetX,y:hb.offsetY};const p=target.getPosition();const b=Bodies.rectangle(p.x+q.x*target.getFacing(),p.y+q.y,1,1,{label:'hitbox.attack',isSensor:true,ignoreGravity:true,collisionFilter:{category:COLLISION_CATEGORIES.HITBOX,mask:COLLISION_CATEGORIES.CHARACTER},plugin:{ownerId:'donkeykong',ownerBodyId:other.body.id,moveId:'fixture.dk-source-grab-interruption',attackKind:'ground',damage:2,facing,hitlagMultiplier:1,...(zeroStun?{tripChance:1}:{}),knockback:zeroStun?{x:0,y:0,scaling:0,reference:{base:0,growth:0,angle:0}}:{x:0,y:-1,scaling:0},hitbox:{offsetX:0,offsetY:0,width:1,height:1},collisionHits:[{id:0,capsule:{start:{x:0,y:0},end:{x:0,y:0},radius:.5}}]}});Composite.add(engine.world,b);tick();Composite.remove(engine.world,b);return applications.filter(a=>a.index===0).at(-1)!;};
 const clean=()=>{for(const f of fighters)f.destroy();Engine.clear(engine);Composite.clear(engine.world,false);};return{target,other,tick,enter,pulse,sensors,applications,clean};
}
describe('Opted DK source whiff interruption through original Matter contact handler',()=>{
 for(const facing of [1,-1] as const)for(const age of [0,7,10])it(`positive hitstun cancels source age${age} face${facing}, never resumes and accepts a new grab`,()=>{
  const f=fixture(facing);try{f.enter(age);expect(f.target.getGrabPresentationState()?.framesElapsed).toBe(age);const result=f.pulse();expect(result.outcome).toBe('landed');expect(result.damage).toBe(2);expect(result.knockback.hitstunFrames).toBeGreaterThan(0);expect(f.target.getGrabState().name).toBe('idle');expect(f.target.getGrabPresentationState()).toBeNull();expect(f.sensors()).toHaveLength(0);expect(f.target.getDonkeyKongCatchCollisionDiagnostic()).toBeNull();expect(f.target.getActiveHurtboxes().some(h=>h.id.startsWith('donkeykong.grab.'))).toBe(false);
   for(let n=0;n<45;n++){f.tick();expect(f.sensors()).toHaveLength(0);expect(f.target.getGrabPresentationState()).toBeNull();}
   expect(f.target.isInHitstun()).toBe(false);f.tick({grab:true});expect(f.target.getGrabPresentationState()).toMatchObject({variant:'standing',framesElapsed:0});
  }finally{f.clean();}
 });
 for(const facing of [1,-1] as const)for(const kind of ['protected','zero-stun-trip'] as const)it(`${kind} normal contact retains whiff ownership face${facing}`,()=>{
  const f=fixture(facing);try{f.enter(7);if(kind==='protected')f.target.setInvincibility(8);if(kind==='zero-stun-trip')f.target.setTripRandomSource(()=>0);const before=f.target.getGrabState();const r=f.pulse(kind==='zero-stun-trip');expect(r.outcome).toBe(kind==='protected'?'invincible':'landed');expect(r.knockback.hitstunFrames).toBe(0);if(kind==='zero-stun-trip')expect(r.knockback.tripped).toBe(true);expect(f.target.getGrabState().name).toBe(before.name);expect(f.sensors()).toHaveLength(1);}finally{f.clean();}
 });
 it.each(['legacy-dk','pikachu'] as const)('%s remains outside the DK policy opt-in',profile=>{
  const f=fixture(1,profile);try{f.enter(0);const r=f.pulse();expect(r.outcome).toBe('landed');expect(r.knockback.hitstunFrames).toBeGreaterThan(0);expect(f.target.getGrabState().name).toBe('whiffStartup');}finally{f.clean();}
 });
 it.each(['dash','pivot'] as const)('interrupting %s clears latched variant before a fresh standing entry',variant=>{
  const f=fixture();try{for(let n=0;n<26;n++)f.tick({moveX:1});f.tick({grab:true,moveX:variant==='pivot'?-1:1});expect(f.target.getGrabPresentationState()?.variant).toBe(variant);const r=f.pulse();expect(r.outcome).toBe('landed');expect(r.knockback.hitstunFrames).toBeGreaterThan(0);for(let n=0;n<45;n++)f.tick();f.tick({grab:true});expect(f.target.getGrabPresentationState()).toMatchObject({variant:'standing',framesElapsed:0});}finally{f.clean();}
 });
});
