import {createRequire} from 'node:module';
import {describe,expect,it} from 'vitest';
import {DonkeyKong,DONKEYKONG_GRAB} from './DonkeyKong';
import {Pikachu} from './Pikachu';
import {Character} from './Character';
import {coordinateCaptureAttachments} from './captureAttachmentCoordinator';
import {applyCharacterMoveOverrides} from './characterFactory';
import {getAuthorableCharacterSpec} from './authorableCharacterRegistry';
import {parseCharacterDataFile,serializeCharacterDataSpec} from './characterSerializer';
import dkMetadata from '../../assets/characters/donkeykong/gameplay.json';
import type {CaptureAttachmentCalibration} from './captureAttachmentCalibration';
// The stock DK calibration now also carries DK's own recipient anchors/floor (rework remaining gaps, dk-recipient-anchor).
import {getDefaultCaptureAttachmentCalibration} from './captureAttachmentDefaultData';
import type {CharacterInput} from './Character';
import {stepCharacterPhysics} from './stepCharacterPhysics';
import {HitboxDamageHandler} from '../match/HitboxDamageHandler';
import {GAME_CONFIG} from '../engine/constants';
import {COLLISION_CATEGORIES} from '../engine/collisionCategories';
import {PLATFORM_LABELS} from '../stages/stageBodies';
import {packedBodyCandidate} from './packedBodyPresentation';
import {captureSimulationAnimation} from './simulationSpriteAnimation';
const require=createRequire(import.meta.url),Engine=require('../physics/matter/source/lib/core/Engine.js'),Events=require('../physics/matter/source/lib/core/Events.js'),Bodies=require('../physics/matter/source/lib/factory/Bodies.js'),Body=require('../physics/matter/source/lib/body/Body.js'),Composite=require('../physics/matter/source/lib/body/Composite.js');
function fixture(facing:1|-1=1,recipient:'small'|'large'='large',captor:'dk'|'pk'|'generic'='dk'){
 // In-memory authored fixture paired metadata only; no file/asset mutation and no invented stock grip.
 const animations=dkMetadata.animations as unknown as Record<string,any>,keys=['grab_pull','grab_hold','captured'];
 const old=keys.map(k=>[k,animations[k]] as const);
 for(const k of keys)animations[k]={frameWidth:384,frameHeight:256,frameCount:1,root:[128,208],scaleToWorld:5/6.5,bodyCentreFromRootY:-42,
 frameWindows:[{startFrame:0,endFrame:null,artFrameIndex:0}],hurtboxPoses:[{artFrameIndex:0,nativeSample:1,hurtboxes:[{id:'synthetic-body',offsetX:0,offsetY:0,width:60,height:84}]}]};
 const engine=Engine.create();engine.gravity.y=GAME_CONFIG.gravity;
 const names:Record<string,string>={collisionstart:'collisionStart',collisionactive:'collisionActive',collisionend:'collisionEnd'};
 const scene:any={matter:{body:Body,add:{rectangle(x:number,y:number,w:number,h:number,o:object){const b=Bodies.rectangle(x,y,w,h,o);Composite.add(engine.world,b);return b;}},world:{on(n:string,f:any){Events.on(engine,names[n]??n,f);},off(n:string,f:any){Events.off(engine,names[n]??n,f);},remove(b:any){Composite.remove(engine.world,b);}}}};
 const dk=captor==='dk'?new DonkeyKong(scene,{spawnX:0,spawnY:0}):captor==='pk'?new Pikachu(scene,{spawnX:0,spawnY:17}):new Character(scene,{id:'link',spawnX:0,spawnY:0,width:60,height:84});
 const victim=recipient==='small'?new Pikachu(scene,{spawnX:55*facing,spawnY:17}):new DonkeyKong(scene,{spawnX:55*facing,spawnY:0});
 dk.setGrabSpec({...DONKEYKONG_GRAB,attachmentPolicy:'pose-anchors-beta-v1'});dk.setFacing(facing);victim.setFacing((-facing) as 1|-1);
 Composite.add(engine.world,Bodies.rectangle(0,52,2400,20,{isStatic:true,label:PLATFORM_LABELS.solid,collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}));
 const fighters=[dk,victim],contacts:any[]=[],samples:any[]=[];let pairedEnabled=false;
 const handler=new HitboxDamageHandler((index,hit,context)=>{if(context.kind==='grab'){dk.resolveGrabConnect(victim);const confirmed=victim.getGrabbedBy()===dk;contacts.push({kind:'grab',confirmed});return{confirmed};}const result=fighters[index]!.applyHitDetailed(hit);contacts.push({kind:'damage',index,hit,result});return{confirmed:result.outcome==='landed'};});
 handler.registerPlayer(0,dk.body);handler.registerPlayer(1,victim.body);handler.setFacingLookup(i=>fighters[i]!.getFacing());handler.setGroundedLookup(i=>fighters[i]!.isGrounded());handler.setHurtboxLookup(i=>fighters[i]!.getActiveHurtboxes());
 for(const n of ['collisionStart','collisionActive'])Events.on(engine,n,(e:any)=>handler.handleCollisionStart(e));
 let frame=0;const tick=(input:Partial<CharacterInput>={})=>{dk.applyInput({moveX:0,jump:false,...input},++frame);victim.applyInput({moveX:0,jump:false},frame);stepCharacterPhysics({characters:fighters,bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:GAME_CONFIG.fixedTimestepMs,stepWorld:d=>Engine.update(engine,d),afterSubstep:()=>{if(pairedEnabled)coordinateCaptureAttachments(fighters);samples.push({captor:dk.getPosition(),target:victim.getPosition(),diagnostic:dk.getCaptureAttachmentDiagnostic()});handler.sampleHurtboxContacts(Composite.allBodies(engine.world));}});};
 dk.setInvincibility(0);victim.setInvincibility(0);for(let n=0;n<20;n++)tick();expect(dk.isGrounded()).toBe(true);dk.setFacing(facing);
 const capture=()=>{tick({grab:true});for(let n=0;n<18&&!victim.isGrabbed();n++)tick();expect(victim.getGrabbedBy()).toBe(dk);expect(contacts.some(c=>c.kind==='grab'&&c.confirmed)).toBe(true);};
 const cargo=()=>{capture();tick({attack:true,moveX:facing});expect(dk.getGrabState()).toMatchObject({name:'holding',active:{cargo:true,cargoStartupRemaining:16}});expect(dk.getPackedBodyState().cargoEntry?.framesElapsed).toBe(0);};
 const candidate=()=>packedBodyCandidate(captureSimulationAnimation(dk,0,false));
 const clean=()=>{dk.destroy();victim.destroy();Engine.clear(engine);Composite.clear(engine.world,false);for(const [k,v] of old){if(v===undefined)delete animations[k];else animations[k]=v;}};return{dk,victim,tick,capture,cargo,candidate,clean,contacts,samples,scene,fighters,engine,enable:()=>{pairedEnabled=true;}};
}

// Synthetic target calibration only. Read current selectors; never force a capture, body state or solver result.
function install(f:ReturnType<typeof fixture>,point={x:7,y:12}) {
 const context='ordinary-held' as const;
 const own=(f.dk as any).getCaptureAttachmentPose(context),other=(f.victim as any).getCaptureAttachmentPose(context);
 const descriptor=(p:any,profileKey:string)=>({poseKey:p.poseKey,profileKey,dimensions:p.dimensions,artFrameIndex:p.artFrameIndex,nativeSample:p.nativeSample,provenance:'authored-reviewed-target' as const});
 const captor:CaptureAttachmentCalibration={profileKey:'synthetic-captor',revision:'one',grips:[{...descriptor(own,'synthetic-captor'),context,point:{x:30,y:-20},facingPolicy:'preserve-recipient',occlusion:'legacy-order'}]};
 const recipient:CaptureAttachmentCalibration={profileKey:'synthetic-recipient',revision:'one',anchors:[{...descriptor(other,'synthetic-recipient'),context,point}],supportingFloor:{reviewKey:'synthetic-flat-floor',recipientReviewedBottom:f.victim.getTuning().height/2,clearance:.5}};
 f.dk.setCaptureAttachmentCalibration(captor);f.victim.setCaptureAttachmentCalibration(recipient);f.enable();return{captor,recipient};
}
function result(f:ReturnType<typeof fixture>) {const r=f.dk.getCaptureAttachmentDiagnostic();expect(r?.status).toBe('paired');if(!r||r.status!=='paired')throw new Error(JSON.stringify(r));return r;}
function expectSolved(f:ReturnType<typeof fixture>,face:1|-1,anchor={x:7,y:12}) {
 const c=f.dk.getPosition(),r=result(f),h=f.victim.getTuning().height;
 const expected={x:c.x+30*face-anchor.x*(-face),y:Math.min(c.y-20-anchor.y,42-h/2-.5)};
 expect(f.victim.getPosition().x).toBeCloseTo(expected.x,8);expect(f.victim.getPosition().y).toBeCloseTo(expected.y,8);
 expect(r.exact.gripWorld.x).toBeCloseTo(c.x+30*face,8);expect(r.exact.gripWorld.y).toBeCloseTo(c.y-20,8);
 expect(r.provenance.nativeConstraintParity).toBe(false);expect(r.provenance.visibleGripAcceptance).toBe('not-established-by-solver');
}
describe('isolated APP15 actual Character/Matter attachment candidate; synthetic anchors, no art parity',()=>{
 it.each([1,-1] as const)('solves unequal recipient-owned small and large anchors before original sampler face%s',face=>{
  for(const size of ['small','large'] as const){const f=fixture(face,size);try{f.capture();install(f);const before=f.dk.getGrabState().active?.framesElapsed;coordinateCaptureAttachments(f.fighters);expectSolved(f,face);expect(f.dk.getGrabState().active?.framesElapsed).toBe(before);f.tick();expectSolved(f,face);expect(f.samples.at(-1)?.target).toEqual(f.victim.getPosition());expect(f.contacts.filter(c=>c.kind==='grab'&&c.confirmed)).toHaveLength(1);}finally{f.clean();}}
 });
 it.each(['pk','generic'] as const)('same authored policy on %s captor stays legacy, not DK merely by flag',captor=>{
  const f=fixture(1,'large',captor);try{f.capture();install(f);coordinateCaptureAttachments(f.fighters);expect(f.dk.getCaptureAttachmentLink()).toBeNull();expect(f.dk.getCaptureAttachmentDiagnostic()?.status).not.toBe('paired');expect(f.victim.getGrabbedBy()).toBe(f.dk);}finally{f.clean();}
 });
 it('missing metadata and omitted policy keep actual original hold offsets',()=>{
  const f=fixture();try{f.capture();coordinateCaptureAttachments(f.fighters);expect(f.dk.getCaptureAttachmentDiagnostic()?.status).not.toBe('paired');f.dk.setGrabSpec({...DONKEYKONG_GRAB,attachmentPolicy:undefined});install(f);f.tick();expect(f.dk.getCaptureAttachmentLink()).toBeNull();expect(f.victim.getPosition().x-f.dk.getPosition().x).toBeCloseTo(DONKEYKONG_GRAB.hitbox.offsetX,5);}finally{f.clean();}
 });
 it.each([1,-1] as const)('frozen owner follows solved moving root without extra clock ticks face%s',face=>{
  const f=fixture(face,'small');try{f.capture();install(f);coordinateCaptureAttachments(f.fighters);f.dk.armAttackerHitlag(3);f.victim.armAttackerHitlag(3);const age=f.dk.getGrabState().active?.framesElapsed;for(let n=0;n<3;n++){Body.setPosition(f.dk.body,{x:f.dk.body.position.x+2*face,y:f.dk.body.position.y});f.tick();expectSolved(f,face);expect(f.dk.getGrabState().active?.framesElapsed).toBe(age);}f.tick();expectSolved(f,face);expect(f.dk.getGrabState().active?.framesElapsed).toBe((age??0)+1);}finally{f.clean();}
 });
 it.each(['reset','teleport','release','destroy'] as const)('collected old link cannot commit after target %s',kind=>{
  const f=fixture();try{f.capture();install(f);const link=f.dk.getCaptureAttachmentLink()!,r=f.dk.resolveCaptureAttachmentCandidate(f.fighters.map(c=>c.body.id),f.dk.getPosition());expect(r?.status).toBe('paired');if(!r||r.status!=='paired')throw new Error('candidate missing');if(kind==='reset')f.victim.resetForRound(400,-100);else if(kind==='teleport')f.victim.setPosition(400,-100);else if(kind==='release')f.victim.releaseFromGrab('external');else f.victim.destroy();const position=f.victim.getPosition();expect(f.dk.commitCaptureAttachmentCandidate(link,r)).toBe(false);expect(f.victim.getPosition()).toEqual(position);}finally{f.clean();}
 });
 it.each(['captor','recipient'] as const)('revision update on %s invalidates collected solve',side=>{
  const f=fixture();try{f.capture();const profiles=install(f);const link=f.dk.getCaptureAttachmentLink()!,r=f.dk.resolveCaptureAttachmentCandidate(f.fighters.map(c=>c.body.id),f.dk.getPosition());if(!r||r.status!=='paired')throw new Error(JSON.stringify(r));const c=side==='captor'?f.dk:f.victim,p=side==='captor'?profiles.captor:profiles.recipient;c.setCaptureAttachmentCalibration({...p,revision:'two'});const before=f.victim.getPosition();expect(f.dk.commitCaptureAttachmentCandidate(link,r)).toBe(false);expect(f.victim.getPosition()).toEqual(before);}finally{f.clean();}
 });
 it('recipient dimension mismatch and stage rejection restore only same live legacy link',()=>{
  const f=fixture();try{f.capture();const p=install(f);coordinateCaptureAttachments(f.fighters);expectSolved(f,1);f.victim.setCaptureAttachmentCalibration({...p.recipient,anchors:p.recipient.anchors?.map(a=>({...a,dimensions:{width:999,height:84}}))});coordinateCaptureAttachments(f.fighters);expect(f.dk.getCaptureAttachmentDiagnostic()?.status).toBe('fallback');expect(f.victim.getPosition().x-f.dk.getPosition().x).toBeCloseTo(DONKEYKONG_GRAB.hitbox.offsetX,8);f.victim.setCaptureAttachmentCalibration(p.recipient);coordinateCaptureAttachments(f.fighters);expectSolved(f,1);coordinateCaptureAttachments(f.fighters,()=>false);expect(f.dk.getCaptureAttachmentDiagnostic()).toMatchObject({status:'fallback',reason:'stage-placement-not-supported'});expect(f.victim.getPosition().x-f.dk.getPosition().x).toBeCloseTo(DONKEYKONG_GRAB.hitbox.offsetX,8);}finally{f.clean();}
 });
 it('duplicate participant identities cannot be paired',()=>{
  const f=fixture();try{f.capture();install(f);coordinateCaptureAttachments([f.dk,f.victim,f.victim]);expect(f.dk.getCaptureAttachmentDiagnostic()).toMatchObject({status:'inactive',reason:'duplicate-live-body-id'});}finally{f.clean();}
 });
 it('actual reference-accelerated outsider forces multiple solved samplers without final legacy repin',()=>{
  const f=fixture(1,'small'),other=new DonkeyKong(f.scene,{spawnX:700,spawnY:-400});try{f.capture();install(f);coordinateCaptureAttachments(f.fighters);f.fighters.push(other);other.setInvincibility(0);const hit=other.applyHitDetailed({damage:1,hitlagMultiplier:0,facing:1,knockback:{x:1,y:-1,scaling:0,reference:{base:160,growth:0,angle:70}}});expect(hit.outcome).toBe('landed');other.applyInput({moveX:0,jump:false},777);expect(other.getReferencePhysicsStep()?.ticks).toBeGreaterThan(1);const before=f.samples.length;f.tick();expect(f.samples.length-before).toBeGreaterThan(1);expectSolved(f,1);for(const sample of f.samples.slice(before)){expect(sample.target.x-sample.captor.x).toBeCloseTo(37,8);expect(sample.target.y-sample.captor.y).toBeCloseTo(-32,8);}expect(f.victim.getDamagePercent()).toBe(0);}finally{other.destroy();f.clean();}
 });
 it('disabling policy after paired bypass restores same reciprocal link without detaching',()=>{
  const f=fixture();try{f.capture();install(f);coordinateCaptureAttachments(f.fighters);expectSolved(f,1);f.dk.setGrabSpec({...DONKEYKONG_GRAB,attachmentPolicy:undefined});expect(f.victim.getGrabbedBy()).toBe(f.dk);coordinateCaptureAttachments(f.fighters);expect(f.victim.getPosition().x-f.dk.getPosition().x).toBeCloseTo(DONKEYKONG_GRAB.hitbox.offsetX,8);expect(f.victim.getGrabbedBy()).toBe(f.dk);}finally{f.clean();}
 });
 it('changed drawing facing with zero-X anchors rejects stale same-geometry commit',()=>{
 const f=fixture();try{f.capture();const p=install(f,{x:0,y:12});f.dk.setCaptureAttachmentCalibration({...p.captor,grips:p.captor.grips?.map(g=>({...g,point:{x:0,y:-20}}))});const link=f.dk.getCaptureAttachmentLink()!,r=f.dk.resolveCaptureAttachmentCandidate(f.fighters.map(c=>c.body.id),f.dk.getPosition());if(!r||r.status!=='paired')throw new Error(JSON.stringify(r));f.dk.setFacing(-1);const fresh=f.dk.resolveCaptureAttachmentCandidate(f.fighters.map(c=>c.body.id),f.dk.getPosition());if(!fresh||fresh.status!=='paired')throw new Error(JSON.stringify(fresh));expect(r.exact.recipientCentre).toEqual(fresh.exact.recipientCentre);expect(r.selection.captorDrawingFacing).toBe(1);expect(fresh.selection.captorDrawingFacing).toBe(-1);expect(f.dk.commitCaptureAttachmentCandidate(link,r)).toBe(false);}finally{f.clean();}
 });
 it('live binding API is side-effect-free and rejects metadata revision and release',()=>{
 const f=fixture();try{f.capture();const p=install(f);coordinateCaptureAttachments(f.fighters);const r=result(f),before={diagnostic:f.dk.getCaptureAttachmentDiagnostic(),position:f.victim.getPosition(),clock:f.dk.getGrabState(),capture:f.victim.getCapturePresentationState(),percent:f.victim.getDamagePercent()};expect(f.dk.isCaptureAttachmentResultCurrent(r)).toBe(true);expect(f.dk.getCaptureAttachmentDiagnostic()).toBe(before.diagnostic);expect(f.dk.getGrabState()).toEqual(before.clock);expect(f.victim.getCapturePresentationState()).toEqual(before.capture);expect(f.victim.getPosition()).toEqual(before.position);expect(f.victim.getDamagePercent()).toBe(before.percent);f.victim.setCaptureAttachmentCalibration({...p.recipient,revision:'two'});expect(f.dk.isCaptureAttachmentResultCurrent(r)).toBe(false);f.victim.setCaptureAttachmentCalibration(p.recipient);expect(f.dk.isCaptureAttachmentResultCurrent(r)).toBe(true);f.victim.releaseFromGrab('external');expect(f.dk.isCaptureAttachmentResultCurrent(r)).toBe(false);}finally{f.clean();}
 });
 it('readonly binding rejects changed render order and reset generations without altering diagnostics',()=>{
 const f=fixture();try{f.capture();install(f);coordinateCaptureAttachments(f.fighters);const r=result(f),diagnostic=f.dk.getCaptureAttachmentDiagnostic();expect(f.dk.isCaptureAttachmentResultCurrent({...r,occlusion:'recipient-front'})).toBe(false);for(const key of ['captorResetGeneration','recipientResetGeneration'] as const)expect(f.dk.isCaptureAttachmentResultCurrent({...r,selection:{...r.selection,[key]:r.selection[key]+1}})).toBe(false);expect(f.dk.getCaptureAttachmentDiagnostic()).toBe(diagnostic);expect(f.dk.isCaptureAttachmentResultCurrent(r)).toBe(true);}finally{f.clean();}
 });
 it('wrong captor clone cannot commit another DK capture token',()=>{
  const f=fixture();const other=new DonkeyKong(f.scene,{spawnX:500,spawnY:0});try{f.capture();install(f);const link=f.dk.getCaptureAttachmentLink()!,r=f.dk.resolveCaptureAttachmentCandidate(f.fighters.map(c=>c.body.id),f.dk.getPosition());if(!r||r.status!=='paired')throw new Error(JSON.stringify(r));other.setGrabSpec({...DONKEYKONG_GRAB,attachmentPolicy:'pose-anchors-beta-v1'});const before=f.victim.getPosition();expect(other.id).toBe(f.dk.id);expect(other.body.id).not.toBe(f.dk.body.id);expect(other.commitCaptureAttachmentCandidate(link,r)).toBe(false);expect(f.victim.getPosition()).toEqual(before);}finally{other.destroy();f.clean();}
 });
 it('floor envelope correction remains a separate residual, never accepted grip displacement',()=>{
  const f=fixture();try{f.capture();const p=install(f,{x:7,y:-100});coordinateCaptureAttachments(f.fighters);const r=result(f);expect(r.exact.recipientCentre.y).toBeGreaterThan(42);expect(r.stage.status).toBe('reviewed-floor');expect(r.stage.recipientCentre.y).toBeCloseTo(-.5,8);expect(r.stage.residualDistance).toBeGreaterThan(50);expect(r.provenance.visibleGripAcceptance).toBe('not-established-by-solver');expect(f.victim.getPosition()).toEqual(r.stage.recipientCentre);f.victim.setCaptureAttachmentCalibration({...p.recipient,supportingFloor:undefined});coordinateCaptureAttachments(f.fighters);expect(f.dk.getCaptureAttachmentDiagnostic()).toMatchObject({status:'fallback',reason:'missing-flat-support-or-recipient-floor-review'});}finally{f.clean();}
 });
 it.each(['duplicate','malformed','sparse','bad-array','bad-descriptor'] as const)('raw paired clip %s grip metadata fails closed without moving/detaching recipient',kind=>{
  const f=fixture();try{f.capture();const p=install(f);const clip=(dkMetadata.animations as unknown as Record<string,any>).grab_pull;clip.captureGripPoses=kind==='duplicate'?[p.captor.grips![0]]:kind==='sparse'?new Array(1):kind==='bad-array'?{}:kind==='bad-descriptor'?[{...p.captor.grips![0],point:{x:NaN,y:0}}]:[null];const before=f.victim.getPosition();expect(()=>coordinateCaptureAttachments(f.fighters)).not.toThrow();expect(f.dk.getCaptureAttachmentDiagnostic()?.status).not.toBe('paired');expect(f.victim.getPosition()).toEqual(before);expect(f.victim.getGrabbedBy()).toBe(f.dk);}finally{f.clean();}
 });
 it('schema, serializer and no-moves factory carry explicit calibration while preserving reviewed stock identity',()=>{
  const f=fixture();try{const stock=getAuthorableCharacterSpec('donkeykong');const calibration:CaptureAttachmentCalibration={profileKey:'transport-owned',revision:'one',physicalCentreContexts:['ordinary-held']};const authored={...stock,captureAttachmentCalibration:calibration,moves:{...stock.moves,grab:{...DONKEYKONG_GRAB,attachmentPolicy:'pose-anchors-beta-v1' as const}}};const parsed=parseCharacterDataFile(serializeCharacterDataSpec(authored));const round=parseCharacterDataFile(serializeCharacterDataSpec(parsed));expect(round).toEqual(parsed);expect(round.moves?.grab?.attachmentPolicy).toBe('pose-anchors-beta-v1');applyCharacterMoveOverrides(f.dk,{...round,moves:undefined});expect(f.dk.getCaptureAttachmentCalibration()).toEqual(calibration);expect(stock.captureAttachmentCalibration).toEqual(getDefaultCaptureAttachmentCalibration('donkeykong'));expect(stock.captureAttachmentCalibration?.profileKey).toBe('dk-ordinary-grab-target-v1');expect(()=>parseCharacterDataFile({...serializeCharacterDataSpec(authored),captureAttachmentCalibration:{...calibration,revision:''}})).toThrow();expect(()=>parseCharacterDataFile({...serializeCharacterDataSpec(authored),moves:{grab:{...DONKEYKONG_GRAB,attachmentPolicy:'native'}}})).toThrow();}finally{f.clean();}
 });
});
