import {createRequire} from 'node:module';
import {describe,expect,it} from 'vitest';
import {DonkeyKong,DONKEYKONG_GRAB} from './DonkeyKong';
import {Pikachu} from './Pikachu';
import {coordinateCaptureAttachments,captureAttachmentLinkIdentity,isNewCaptureAttachmentLink} from './captureAttachmentCoordinator';
import type {CharacterInput,Character} from './Character';
import {stepCharacterPhysics} from './stepCharacterPhysics';
import {HitboxDamageHandler} from '../match/HitboxDamageHandler';
import {GAME_CONFIG} from '../engine/constants';
import {COLLISION_CATEGORIES} from '../engine/collisionCategories';
import {PLATFORM_LABELS} from '../stages/stageBodies';
import {packedBodyCandidate} from './packedBodyPresentation';
import {captureSimulationAnimation} from './simulationSpriteAnimation';
import {CaptureAttachmentDepthAdapter} from './captureAttachmentDepth';
const require=createRequire(import.meta.url),Engine=require('../physics/matter/source/lib/core/Engine.js'),Events=require('../physics/matter/source/lib/core/Events.js'),Bodies=require('../physics/matter/source/lib/factory/Bodies.js'),Body=require('../physics/matter/source/lib/body/Body.js'),Composite=require('../physics/matter/source/lib/body/Composite.js');
function fixture(facing:1|-1=1,slot:1|2=1,mode:'stock'|'no-policy'|'unsupported'='stock'){
 const engine=Engine.create();engine.gravity.y=GAME_CONFIG.gravity;
 const names:Record<string,string>={collisionstart:'collisionStart',collisionactive:'collisionActive',collisionend:'collisionEnd'};
 const scene:any={matter:{body:Body,add:{rectangle(x:number,y:number,w:number,h:number,o:object){const b=Bodies.rectangle(x,y,w,h,o);Composite.add(engine.world,b);return b;}},world:{on(n:string,f:any){Events.on(engine,names[n]??n,f);},off(n:string,f:any){Events.off(engine,names[n]??n,f);},remove(b:any){Composite.remove(engine.world,b);}}}};
 const dk=new DonkeyKong(scene,{spawnX:0,spawnY:0});
 const victim=new Pikachu(scene,{spawnX:55*facing,spawnY:17});
 const reviewedCalibration=victim.getCaptureAttachmentCalibration();
 dk.setFacing(facing);victim.setFacing((-facing) as 1|-1);
 if(mode==='no-policy')dk.setGrabSpec({...DONKEYKONG_GRAB,attachmentPolicy:undefined});
 if(mode==='unsupported')victim.setCaptureAttachmentCalibration(null);
 Composite.add(engine.world,Bodies.rectangle(0,52,2400,20,{isStatic:true,label:PLATFORM_LABELS.solid,collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}));
 const fighters:Character[]=slot===1?[dk,victim]:[victim,dk],contacts:any[]=[],samples:any[]=[],births:any[]=[];let frame=0,commits=0;
 const originalCommit=dk.commitCaptureAttachmentCandidate.bind(dk);dk.commitCaptureAttachmentCandidate=(...args)=>{commits++;return originalCommit(...args);};
 const handler=new HitboxDamageHandler((index,hit,context)=>{if(context.kind==='grab'){dk.resolveGrabConnect(victim);const confirmed=victim.getGrabbedBy()===dk;contacts.push({kind:'grab',confirmed});return{confirmed};}const result=fighters[index]!.applyHitDetailed(hit);contacts.push({kind:'damage',index,hit,result});return{confirmed:result.outcome==='landed'};});
 fighters.forEach((c,i)=>handler.registerPlayer(i,c.body));handler.setFacingLookup(i=>fighters[i]!.getFacing());handler.setGroundedLookup(i=>fighters[i]!.isGrounded());handler.setHurtboxLookup(i=>fighters[i]!.getActiveHurtboxes());
 for(const n of ['collisionStart','collisionActive'])Events.on(engine,n,(e:any)=>handler.handleCollisionStart(e));
 const tick=(input:Partial<CharacterInput>={})=>{dk.applyInput({moveX:0,jump:false,...input},++frame);victim.applyInput({moveX:0,jump:false},frame);stepCharacterPhysics({characters:fighters,bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:GAME_CONFIG.fixedTimestepMs,stepWorld:d=>Engine.update(engine,d),afterSubstep:()=>{coordinateCaptureAttachments(fighters);const before=dk.getGrabState().name,linksBefore=new Map(fighters.map(c=>[c,captureAttachmentLinkIdentity(c,c.getCaptureAttachmentLink())] as const));handler.sampleHurtboxContacts(Composite.allBodies(engine.world));
 coordinateCaptureAttachments(fighters,undefined,(c,link)=>link!==null&&c.getGrabState().name==='holding'&&c.getGrabState().active?.framesElapsed===0&&isNewCaptureAttachmentLink(linksBefore.get(c)??null,c,link));
 const snapshot={captor:dk.getPosition(),target:victim.getPosition(),diagnostic:dk.getCaptureAttachmentDiagnostic(),age:dk.getGrabState().active?.framesElapsed,commits};samples.push(snapshot);if(before!=='holding'&&dk.getGrabState().name==='holding')births.push(snapshot);}});};
 dk.setInvincibility(0);victim.setInvincibility(0);for(let n=0;n<20;n++)tick();expect(dk.isGrounded()).toBe(true);dk.setFacing(facing);
 const capture=()=>{tick({grab:true});for(let n=0;n<18&&!victim.isGrabbed();n++)tick();expect(victim.getGrabbedBy()).toBe(dk);expect(contacts.some(c=>c.kind==='grab'&&c.confirmed)).toBe(true);};
 const cargo=()=>{capture();tick({attack:true,moveX:facing});expect(dk.getGrabState()).toMatchObject({name:'holding',active:{cargo:true,cargoStartupRemaining:16}});expect(dk.getPackedBodyState().cargoEntry?.framesElapsed).toBe(0);};
 const candidate=()=>packedBodyCandidate(captureSimulationAnimation(dk,0,false));
 const clean=()=>{dk.destroy();victim.destroy();Engine.clear(engine);Composite.clear(engine.world,false);};return{reviewedCalibration,dk,victim,tick,capture,cargo,candidate,clean,contacts,samples,births,scene,fighters,engine,restage:()=>{Body.setPosition(dk.body,{x:0,y:0});Body.setPosition(victim.body,{x:55*facing,y:17});Body.setVelocity(dk.body,{x:0,y:0});Body.setVelocity(victim.body,{x:0,y:0});dk.setFacing(facing);victim.setFacing((-facing) as 1|-1);},get commits(){return commits;}};
}


describe('actual source CATCH birth prepared for same-tick authored attachment rendering',()=>{
 it.each([1,-1] as const)('stock DK to PK birth resolves original Matter sampler both slots face%s',face=>{
  for(const slot of [1,2] as const){const f=fixture(face,slot);try{
   f.capture();expect(f.births).toHaveLength(1);const birth=f.births[0];
   expect(birth.age).toBe(0);expect(birth.diagnostic?.status).toBe('paired');
   const r=f.dk.getCaptureAttachmentDiagnostic();if(!r||r.status!=='paired')throw new Error(JSON.stringify(r));
   expect(f.dk.isCaptureAttachmentResultCurrent(r)).toBe(true);
   expect(f.victim.getPosition().x).toBeCloseTo(r.stage.recipientCentre.x,10);expect(f.victim.getPosition().y).toBeCloseTo(r.stage.recipientCentre.y,10);
   expect(r.selection.grip.poseKey).toBe('grab_pull');
   expect(r.selection.anchor.profileKey).toContain('pikachu');
   expect(f.contacts.filter(c=>c.kind==='grab'&&c.confirmed)).toHaveLength(1);
   const capSurface={depth:slot as number,setDepth(d:number){this.depth=d;}},targetSurface={depth:3-slot,setDepth(d:number){this.depth=d;}};
   const link=f.dk.getCaptureAttachmentLink()!;
   const depth=new CaptureAttachmentDepthAdapter();expect(depth.update([{captor:capSurface,recipient:targetSurface,captorCharacterId:f.dk.id,attachmentPolicy:f.dk.getGrabSpec()?.attachmentPolicy,result:r,live:{active:true,reciprocal:f.victim.getGrabbedBy()===f.dk,context:link.context,captureId:link.captureId,captorBodyId:f.dk.body.id,recipientBodyId:f.victim.body.id,captorReset:link.captorReset,recipientReset:link.recipientReset,currentCaptorReset:link.captorReset,currentRecipientReset:link.recipientReset},isCurrent:()=>f.dk.isCaptureAttachmentResultCurrent(r)}])[0]?.status).toBe('applied');
   expect(targetSurface.depth).toBeLessThan(capSurface.depth);
   const committed=f.commits;f.tick();expect(f.commits-committed).toBe(1);
   expect(f.dk.getGrabState().active?.framesElapsed).toBe(1);
   depth.restore();
  }finally{f.clean();}}
 });
 it.each(['no-policy','unsupported'] as const)('actual source capture %s keeps legacy/fallback path and clocks',mode=>{
  const f=fixture(1,1,mode);try{f.capture();expect(f.births).toHaveLength(1);expect(f.dk.getGrabState().active?.framesElapsed).toBe(0);expect(f.dk.getCaptureAttachmentDiagnostic()?.status).not.toBe('paired');expect(f.commits).toBe(0);expect(f.victim.getGrabbedBy()).toBe(f.dk);}finally{f.clean();}
 });
 it.each([1,-1] as const)('real release and second capture replaces retained paired/fallback diagnostic face%s',face=>{
  for(const initial of ['stock','unsupported'] as const){const f=fixture(face,1,initial);try{
   const reviewed=f.reviewedCalibration,resets=[f.dk.getPositionResetGeneration(),f.victim.getPositionResetGeneration()];
   f.capture();const firstLink=f.dk.getCaptureAttachmentLink()!;const old=f.dk.getCaptureAttachmentDiagnostic();expect(old).not.toBeNull();
   expect(old?.status).toBe(initial==='stock'?'paired':'fallback');
   for(let n=0;n<120&&f.victim.isGrabbed();n++)f.tick();
   expect(f.victim.isGrabbed()).toBe(false);const released=f.dk.getCaptureAttachmentDiagnostic();
   expect(released?.status).toBe(initial==='stock'?'paired':'fallback');
   // Stationary post-release placement fixture; actual physics, immunity, hitlag and
   // recovery clocks age normally. No reset or capture-state injection.
   for(let n=0;n<100;n++){f.restage();f.tick();}
   expect(f.dk.getCaptureAttachmentDiagnostic()).toBe(released);
   if(initial==='unsupported')f.victim.setCaptureAttachmentCalibration(reviewed);f.restage();for(let n=0;n<5;n++)f.tick();
   expect(f.dk.getGrabState().name).toBe('idle');expect(f.victim.isGrounded()).toBe(true);
   f.capture();expect(f.births).toHaveLength(2);const fresh=f.dk.getCaptureAttachmentDiagnostic();
   expect(f.dk.getGrabState().active?.framesElapsed).toBe(0);expect(fresh?.status).toBe('paired');
   if(!fresh||fresh.status!=='paired')throw new Error(JSON.stringify(fresh));
   expect(f.dk.isCaptureAttachmentResultCurrent(fresh)).toBe(true);
   expect(fresh.captureId).toBeGreaterThan(firstLink.captureId);
   expect([f.dk.getPositionResetGeneration(),f.victim.getPositionResetGeneration()]).toEqual(resets);
   expect(f.contacts.filter(c=>c.kind==='grab'&&c.confirmed)).toHaveLength(2);
  }finally{f.clean();}}
 });

});
