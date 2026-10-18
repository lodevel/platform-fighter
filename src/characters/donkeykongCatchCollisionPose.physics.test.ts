import {createRequire} from 'node:module';
import {describe,expect,it,vi} from 'vitest';
import {STALE_FRESH_MULTIPLIER} from './combat';
import type {PackedBodyClip} from './packedBodyPresentation';
const control=vi.hoisted(()=>({mode:'valid' as 'valid'|'unopted'|'missing'|'empty'|'invalid'|'wide-window'|'drawing-mismatch'}));
// Test-only paired art metadata. No shipping metadata or source timing is edited.
vi.mock('../../assets/characters/donkeykong/gameplay.json',async importOriginal=>{
 const original=await importOriginal<{default:{animations:Record<string,PackedBodyClip>}}>();
 const animations={...original.default.animations};
 // This suite specifically proves one-age pilot fallback, independent of full-grab installation.
 animations.grab={...original.default.animations.review_legacy_grab!};
 for(const [sheet,sample,sign,age] of [['review_pilot_standing_grab_contact',8,1,7],['review_pilot_dash_grab_contact',11,1,10],['review_pilot_pivot_grab_contact',12,-1,11]] as const){
  animations[sheet]={frameCount:1,get frameWindows(){return [{startFrame:age,endFrame:age+(control.mode==='wide-window'?2:1),artFrameIndex:0}];},
   get hurtboxPoses(){return [{artFrameIndex:0,nativeSample:sample+(control.mode==='drawing-mismatch'?1:0),hurtboxes:[{id:'fixture-bust',region:'bust',offsetX:0,offsetY:0,width:50,height:80,capsule:{start:{x:0,y:-15},end:{x:0,y:15},radius:25}}]}];},
   get catchCollisionPoses(){
    if(control.mode==='unopted')return undefined;
    if(control.mode==='missing')return [];
    return [{artFrameIndex:0,nativeSample:sample,regions:control.mode==='empty'?[]:[0,1].map(id=>({id,capsule:{start:{x:200*sign,y:0},end:{x:240*sign,y:0},radius:control.mode==='invalid'?NaN:8}}))}];
   }};
 }
 return {default:{...original.default,animations}};
});
import {DonkeyKong} from './DonkeyKong';
import type {CharacterInput} from './Character';
import {stepCharacterPhysics} from './stepCharacterPhysics';
import {HitboxDamageHandler} from '../match/HitboxDamageHandler';
import {packedBodyCandidate,resolvePackedBodyAction} from './packedBodyPresentation';
import {captureSimulationAnimation} from './simulationSpriteAnimation';
import {GAME_CONFIG} from '../engine/constants';
import {COLLISION_CATEGORIES} from '../engine/collisionCategories';
import {PLATFORM_LABELS} from '../stages/stageBodies';
const require=createRequire(import.meta.url),Engine=require('../physics/matter/source/lib/core/Engine.js'),Events=require('../physics/matter/source/lib/core/Events.js'),Bodies=require('../physics/matter/source/lib/factory/Bodies.js'),Body=require('../physics/matter/source/lib/body/Body.js'),Composite=require('../physics/matter/source/lib/body/Composite.js');
function fixture(facing:1|-1=1,targetX=1000){
 const engine=Engine.create();engine.gravity.y=GAME_CONFIG.gravity;
 const names:Record<string,string>={collisionstart:'collisionStart',collisionactive:'collisionActive',collisionend:'collisionEnd'};
 const scene:any={matter:{body:Body,add:{rectangle(x:number,y:number,w:number,h:number,o:object){const b=Bodies.rectangle(x,y,w,h,o);Composite.add(engine.world,b);return b;}},world:{on(n:string,f:any){Events.on(engine,names[n]??n,f);},off(n:string,f:any){Events.off(engine,names[n]??n,f);},remove(b:any){Composite.remove(engine.world,b);}}}};
 const dk=new DonkeyKong(scene,{spawnX:0,spawnY:0}),victim=new DonkeyKong(scene,{spawnX:targetX*facing,spawnY:0});
 Composite.add(engine.world,Bodies.rectangle(0,52,4000,20,{isStatic:true,label:PLATFORM_LABELS.solid,collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}));
 const fighters=[dk,victim],contacts:any[]=[],prePhysicsSamples:any[]=[];let contactPhase:'input'|'collision-event'|'completed-sampler'='input';
 const handler=new HitboxDamageHandler((index,_hit,context)=>{
  if(context.kind!=='grab'||index!==1)return{confirmed:false};
  const before={contactPhase,age:dk.getGrabPresentationState()?.framesElapsed,diagnostic:dk.getDonkeyKongCatchCollisionDiagnostic(),targetPosition:{...victim.body.position}};
  dk.resolveGrabConnect(victim);const confirmed=victim.getGrabbedBy()===dk;contacts.push({...before,confirmed});return{confirmed};
 });
 handler.registerPlayer(0,dk.body);handler.registerPlayer(1,victim.body);handler.setFacingLookup(i=>fighters[i]!.getFacing());handler.setGroundedLookup(i=>fighters[i]!.isGrounded());handler.setHurtboxLookup(i=>fighters[i]!.getActiveHurtboxes());
 for(const n of ['collisionStart','collisionActive'])Events.on(engine,n,(e:any)=>{const prior=contactPhase;contactPhase='collision-event';try{handler.handleCollisionStart(e);}finally{contactPhase=prior;}});
 let frame=0;
 const physics=()=>{stepCharacterPhysics({characters:fighters,bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:GAME_CONFIG.fixedTimestepMs,stepWorld:d=>Engine.update(engine,d)});contactPhase='completed-sampler';try{handler.sampleHurtboxContacts(Composite.allBodies(engine.world));}finally{contactPhase='input';}};
 const tick=(input:Partial<CharacterInput>={})=>{dk.applyInput({moveX:0,jump:false,...input},++frame);victim.applyInput({moveX:0,jump:false},frame);
  prePhysicsSamples.push({age:dk.getGrabPresentationState()?.framesElapsed,sensors:Composite.allBodies(engine.world).filter((b:any)=>b.plugin?.kind==='grab').map((b:any)=>({id:b.id,postPhysicsContactOnly:b.plugin.postPhysicsContactOnly,ownerAnchoredContact:b.plugin.ownerAnchoredContact,hits:structuredClone(b.plugin.collisionHits)}))});physics();};
 dk.setInvincibility(0);victim.setInvincibility(0);for(let n=0;n<20;n++)tick();expect(dk.isGrounded()).toBe(true);expect(victim.isGrounded()).toBe(true);dk.setFacing(facing);victim.setFacing((-facing) as 1|-1);
 const sensors=()=>Composite.allBodies(engine.world).filter((b:any)=>b.plugin?.kind==='grab');
 const start=(variant:'standing'|'dash'|'pivot'='standing')=>{
  if(variant!=='standing')Body.setVelocity(dk.body,{x:10.45*facing,y:0});
  tick({grab:true,moveX:variant==='pivot'?-facing:0});for(let n=0;n<16&&dk.getGrabState().name!=='whiffActive'&&!victim.isGrabbed();n++)tick();};
 const clean=()=>{dk.destroy();victim.destroy();Engine.clear(engine);Composite.clear(engine.world,false);};
 const snapshot=()=>captureSimulationAnimation(dk,0,false);
 return{dk,victim,tick,physics,start,sensors,contacts,clean,snapshot,prePhysicsSamples};
}
describe('DK opt-in CATCH through real Character/Matter/normal capture resolver; synthetic art only',()=>{
 it.each([1,-1] as const)('paired capsule captures beyond movement body/source reach exactly at source age7 face%s',facing=>{
  control.mode='valid';const f=fixture(facing,220);try{f.start();expect(f.victim.getGrabbedBy()).toBe(f.dk);expect(f.contacts).toHaveLength(1);
   expect(f.contacts[0]).toMatchObject({age:7,confirmed:true,contactPhase:'completed-sampler',diagnostic:{reason:null,sourceRegionIds:[0,1],providedRegionIds:[0,1]}});
   expect(f.sensors()).toHaveLength(0);expect(f.dk.getDonkeyKongCatchCollisionDiagnostic()).toBeNull();
   // Accepted contact still enters the APP13 source pummel clock/freeze path.
   f.tick({attack:true});expect(f.dk.getPackedBodyState().pummel?.framesElapsed).toBe(0);f.tick();expect(f.dk.getPackedBodyState().pummel?.framesElapsed).toBe(1);expect(f.victim.getDamagePercent()).toBeCloseTo(1.6*STALE_FRESH_MULTIPLIER,10);
   for(let n=0;n<15;n++){f.tick();expect(f.dk.getPackedBodyState().pummel?.framesElapsed).toBe(1);expect(f.victim.getDamagePercent()).toBeCloseTo(1.6*STALE_FRESH_MULTIPLIER,10);}
  }finally{f.clean();}
 });
 it.each([1,-1] as const)('first activeage7 posed CATCH misses legacy-only near55; retirementage8 restores capture face%s',facing=>{
  control.mode='valid';const f=fixture(facing,55);try{
   f.start();expect(f.dk.getGrabPresentationState()?.framesElapsed).toBe(7);expect(f.victim.isGrabbed()).toBe(false);expect(f.contacts).toHaveLength(0);
   const sensor=f.sensors()[0]!;expect(sensor).toBeDefined();expect(sensor.plugin.postPhysicsContactOnly).toBe(true);expect(sensor.plugin.ownerAnchoredContact).toBe(true);
   expect(sensor.plugin.collisionHits[0].capsule.start.x).toBe(200);expect(sensor.position.x).toBeCloseTo(f.dk.body.position.x+220*facing,8);
   expect(f.dk.getDonkeyKongCatchCollisionDiagnostic()).toMatchObject({sourceGeometryRestored:false,reason:null});
   const born=f.prePhysicsSamples.find(s=>s.age===7&&s.sensors.length);expect(born?.sensors[0]).toMatchObject({id:sensor.id,postPhysicsContactOnly:true,ownerAnchoredContact:true,hits:[{id:0,capsule:{start:{x:200}}},{id:1,capsule:{start:{x:200}}}]});
   f.tick();expect(f.victim.getGrabbedBy()).toBe(f.dk);expect(f.contacts).toHaveLength(1);
   expect(f.contacts[0]).toMatchObject({age:8,confirmed:true,contactPhase:'completed-sampler',diagnostic:{reason:'missing-clip-metadata',sourceGeometryRestored:true,sourceRegionIds:[0,1]}});
   expect(f.sensors()).toHaveLength(0);
  }finally{f.clean();}
 });
 it.each([1,-1] as const)('actual dash/pivot variant selector keeps source ages and one drawing mirror face%s',facing=>{
  control.mode='valid';for(const variant of ['dash','pivot'] as const){const f=fixture(facing);try{
   f.start(variant);const actor=variant==='pivot'?-facing:facing;
   expect(f.dk.getGrabPresentationState()).toMatchObject({variant,framesElapsed:variant==='pivot'?11:10});
   expect(f.dk.getFacing()).toBe(actor);const sensor=f.sensors()[0]!;expect(sensor).toBeDefined();
   expect(sensor.plugin.facing).toBe(actor);expect(sensor.position.x).toBeCloseTo(f.dk.body.position.x+220*actor,8);
   expect(sensor.plugin.collisionHits.map((h:any)=>({id:h.id,situation:h.situation}))).toEqual([{id:0,situation:'ground'},{id:1,situation:'air'}]);
   expect(f.dk.getDonkeyKongCatchCollisionDiagnostic()).toMatchObject({sheet:variant==='pivot'?'review_pilot_pivot_grab_contact':'review_pilot_dash_grab_contact',sourceGameplayAge:variant==='pivot'?11:10,reason:null});
  }finally{f.clean();}}
 });
 it.each(['wide-window','drawing-mismatch'] as const)('%s never promotes a partial pilot over a legacy age',mode=>{
  control.mode=mode;const f=fixture();try{f.start();expect(packedBodyCandidate(f.snapshot())).toMatchObject({sheet:'grab',age:7});
   expect(f.dk.getDonkeyKongCatchCollisionDiagnostic()).toBeNull();expect(f.sensors()[0]?.plugin.ownerAnchoredContact).toBeUndefined();
  }finally{f.clean();}
 });
 it.each(['unopted','missing','empty','invalid'] as const)('%s cannot create extended catch or suppress source capture',mode=>{
  control.mode=mode;const far=fixture(1,220);try{far.start();expect(far.victim.isGrabbed()).toBe(false);expect(far.dk.getGrabState().name).toBe('whiffActive');expect(far.contacts).toHaveLength(0);
   expect(far.dk.getDonkeyKongCatchCollisionDiagnostic()?.sourceGeometryRestored??mode==='unopted').toBe(true);
  }finally{far.clean();}
  const near=fixture(1,55);try{near.start();expect(near.victim.getGrabbedBy()).toBe(near.dk);expect(near.contacts.filter(c=>c.confirmed)).toHaveLength(1);}finally{near.clean();}
 });
 it.each([1,-1] as const)('invalid/empty first active rows capture near55 through guarded source fallback face%s',facing=>{
  for(const mode of ['invalid','empty'] as const){control.mode=mode;const f=fixture(facing,55);try{
   f.start();expect(f.victim.getGrabbedBy()).toBe(f.dk);expect(f.contacts).toHaveLength(1);
   expect(f.contacts[0]).toMatchObject({age:7,confirmed:true,contactPhase:'completed-sampler',diagnostic:{sourceGeometryRestored:true,reason:mode==='empty'?'empty-active-row':'invalid-capsule'}});
  }finally{f.clean();}}
 });
 it.each([1,-1] as const)('same active sensor restores source bounds and follows solved owner across frozen steps face%s',facing=>{
  control.mode='valid';const f=fixture(facing);try{f.start();const sensor=f.sensors()[0]!;expect(sensor).toBeDefined();const id=sensor.id;
   expect(f.dk.getDonkeyKongCatchCollisionDiagnostic()).toMatchObject({reason:null,sourceGameplayAge:7});
   expect(packedBodyCandidate(f.snapshot())).toMatchObject({sheet:'review_pilot_standing_grab_contact',age:7});expect(resolvePackedBodyAction(f.snapshot())?.sheets).toEqual(['review_pilot_standing_grab_contact']);
   Body.setPosition(f.dk.body,{x:80*facing,y:f.dk.body.position.y});f.physics();expect(sensor.position.x).toBeCloseTo(f.dk.body.position.x+220*facing,8);expect(Math.abs(f.dk.body.position.x)).toBeGreaterThan(70);
   control.mode='empty';f.dk.armAttackerHitlag(2);f.tick();const sourceHits=sensor.plugin.collisionHits;
   expect(f.dk.getDonkeyKongCatchCollisionDiagnostic()).toMatchObject({sourceGameplayAge:7,reason:'empty-active-row'});
   const sourceOffset=sensor.plugin.hitbox.offsetX;f.physics();
   expect(sensor.id).toBe(id);expect(sensor.position.x).toBeCloseTo(f.dk.body.position.x+sourceOffset*facing,8);expect(sensor.plugin.collisionHits).toBe(sourceHits);
   f.tick();expect(f.dk.getGrabPresentationState()?.framesElapsed).toBe(7);f.tick();expect(f.dk.getGrabPresentationState()?.framesElapsed).toBe(8);expect(f.sensors()[0]?.id).toBe(id);
   expect(packedBodyCandidate(f.snapshot())).toMatchObject({sheet:'grab',age:8});expect(f.dk.getDonkeyKongCatchCollisionDiagnostic()).toMatchObject({reason:'missing-clip-metadata',sourceGeometryRestored:true});expect(sensor.plugin.collisionHits).toBe(sourceHits);
   f.tick();expect(f.dk.getGrabPresentationState()?.framesElapsed).toBe(9);f.tick();expect(f.dk.getGrabState().name).toBe('whiffRecovery');expect(f.sensors()).toHaveLength(0);expect(f.dk.getDonkeyKongCatchCollisionDiagnostic()).toBeNull();
  }finally{f.clean();}
 });
 it.each(['teleport','reset','destroy'] as const)('%s retires an owned sensor and diagnostics; next capture gets a fresh owner',action=>{
  control.mode='valid';const f=fixture();try{f.start();const old=f.sensors()[0]!.id;
   if(action==='destroy')f.dk.destroy();else if(action==='reset')f.dk.resetForRound(0,0);else f.dk.setPosition(0,0);
   expect(f.sensors()).toHaveLength(0);expect(f.dk.getDonkeyKongCatchCollisionDiagnostic()).toBeNull();
   if(action!=='destroy'){for(let n=0;n<20;n++)f.tick();f.start();expect(f.sensors()[0]?.id).not.toBe(old);expect(f.dk.getDonkeyKongCatchCollisionDiagnostic()?.reason).toBeNull();}
  }finally{f.clean();}
 });
});
