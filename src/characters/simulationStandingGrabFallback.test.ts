import {describe,expect,it,vi} from 'vitest';
import {resolveSimulationAction,createSimulationSpriteAnimationDriver,type SimulationAnimationSnapshot} from './simulationSpriteAnimation';
import type {PackedBodyClip} from './packedBodyPresentation';

const catalog=vi.hoisted(()=>({animations:{} as Record<string,unknown>}));
vi.mock('../../assets/characters/donkeykong/frames.json',()=>({default:catalog}));
import {packedBodyCandidate,resolvePackedBodyAction} from './packedBodyPresentation';

// Independent pinned standing plan: source ages0/3/6/7/8/9/10/23/32/37,
// CATCH[7,10), first actionability38. Synthetic pixels/geometry are unaccepted.
const ages=[0,3,6,7,8,9,10,23,32,37];
const capsule=(id:number)=>({start:{x:20+id,y:7},end:{x:60+id,y:7},radius:2+id});
function full():PackedBodyClip {
  return {frameWidth:384,frameHeight:256,frameCount:10,root:[128,208],scaleToWorld:5/6.5,bodyCentreFromRootY:-42,
    pairedGrabTimeline:{variant:'standing',startupFrames:7,activeFrames:3,recoveryFrames:28,reviewedInputs:true,bodyReviewKey:'synthetic-review-only'},
    frameWindows:ages.map((age,i)=>({startFrame:age,endFrame:ages[i+1]??38,artFrameIndex:i})),
    hurtboxPoses:ages.map((age,i)=>({artFrameIndex:i,nativeSample:age+1,hurtboxes:[
      {id:`synthetic.core.${i}`,offsetX:i+1,offsetY:0,width:4,height:4,
        capsule:{start:{x:i+1,y:0},end:{x:i+1,y:0},radius:2}}]})),
    catchCollisionPoses:ages.map((age,i)=>({artFrameIndex:i,nativeSample:age+1,
      regions:age>=7&&age<10?[0,1].map(id=>({id,capsule:capsule(id)})):[]}))};
}
function pilot():PackedBodyClip {
  return {frameWidth:384,frameHeight:256,frameCount:1,root:[128,208],scaleToWorld:5/6.5,bodyCentreFromRootY:-42,
    frameWindows:[{startFrame:7,endFrame:8,artFrameIndex:0}],
    hurtboxPoses:[{artFrameIndex:0,nativeSample:8,hurtboxes:[{id:'synthetic.pilot',offsetX:1,offsetY:0,width:4,height:4}]}],
    catchCollisionPoses:[{artFrameIndex:0,nativeSample:8,regions:[0,1].map(id=>({id,capsule:capsule(id)}))}]};
}
function snapshot(phase:string,phaseAge:number,facing:1|-1=1,
  spec={startupFrames:7,activeFrames:3,whiffRecoveryFrames:28}):SimulationAnimationSnapshot {
  const totalAge=phase==='whiffActive'?spec.startupFrames+phaseAge:phase==='whiffRecovery'?spec.startupFrames+spec.activeFrames+phaseAge:phaseAge;
  return {characterId:'donkeykong',facing,grabbed:false,grounded:true,frozen:false,
    grab:{name:phase,active:phase==='idle'?null:{framesElapsed:phaseAge,pummelCooldownRemaining:0,throwDirection:null},cooldownRemaining:0},
    grabSpec:{...spec,hitbox:{offsetX:20,offsetY:7,width:50,height:30}},
    grabPresentation:phase==='idle'?null:{variant:'standing',framesElapsed:totalAge,facing},
    hitstunRemaining:0,hitlagRemaining:0,shield:{name:'idle',active:null},activeAttack:null,chargingMove:null,
    packedBody:{clock:null,committed:null,crouchPhase:null,turnBrake:null,itemCue:null,airDodgeDirection:{x:0,y:0},fastFall:false},
    ledgeHang:{name:'idle',active:null},dodge:{name:'idle',active:null},locomotion:{name:'standing',framesElapsed:0},
  } as unknown as SimulationAnimationSnapshot;
}

describe('complete standing canonical must not become dash/pivot generic fallback',()=>{
 it('leaves unmarked DK and Pikachu fallback selection unchanged',()=>{
  const base=snapshot('whiffActive',1,1,{startupFrames:10,activeFrames:3,whiffRecoveryFrames:28});
  const dk={...base,grabPresentation:{...base.grabPresentation!,variant:'dash' as const}};
  const pk={...dk,characterId:'pikachu' as const};
  catalog.animations.grab={frameWidth:384,frameHeight:256,frameCount:7};
  expect(resolveSimulationAction(dk).sheets).toContain('grab');
  const pkBefore=resolveSimulationAction(pk);
  catalog.animations.grab=full();
  expect(resolveSimulationAction(pk)).toEqual(pkBefore);
 });

 it.each(['dash','pivot'] as const)('renderer excludes full standing outside reviewed%s pilot',variant=>{
  catalog.animations.grab=full();catalog.animations.review_legacy_grab={frameCount:7};
  const pilotAge=variant==='dash'?10:11,pilotSheet=variant==='dash'?'review_pilot_dash_grab_contact':'review_pilot_pivot_grab_contact';
  const p=pilot();catalog.animations[pilotSheet]={...p,frameWindows:[{startFrame:pilotAge,endFrame:pilotAge+1,artFrameIndex:0}],hurtboxPoses:p.hurtboxPoses?.map(r=>({...r,nativeSample:pilotAge+1})),catchCollisionPoses:p.catchCollisionPoses?.map(r=>({...r,nativeSample:pilotAge+1}))};
  for(const face of [1,-1] as const){
   const base=snapshot('whiffActive',1,face,{startupFrames:pilotAge,activeFrames:3,whiffRecoveryFrames:28});
   const s={...base,grabPresentation:{...base.grabPresentation!,variant}};
   expect(packedBodyCandidate(s)).toMatchObject({sheet:variant==='dash'?'dash_grab':'pivot_grab'});
   expect(resolvePackedBodyAction(s)).toBeNull(); // Missing drawing resolution was already safe.
   const action=resolveSimulationAction(s);
   expect(action.sheets).not.toContain('grab');
   expect(action.sheets).toEqual(['review_legacy_grab','attack','idle']); // Initial generic fallback violated this by source inspection.
   const animations=new Map(['grab','review_legacy_grab','attack','idle',pilotSheet].map(sheet=>{const key=`donkeykong.${sheet}.anim`;return[key,{key,frames:Array.from({length:sheet==='grab'?10:1},(_,index)=>({index,textureFrame:index}))}];}));
   const anims={currentAnim:null as {key:string}|null,currentFrame:null as unknown,pause:vi.fn(),setCurrentFrame:vi.fn((frame:unknown)=>{anims.currentFrame=frame;})};
   const sprite={anims,play:vi.fn((key:string)=>{anims.currentAnim={key};})};
   const driver=createSimulationSpriteAnimationDriver(()=>s,sprite as unknown as SimulationSpriteSurface,
    {exists:(key:string)=>animations.has(key),get:(key:string)=>animations.get(key)} as unknown as SimulationAnimationCatalog);
   expect(driver.tick()?.key).toBe('donkeykong.review_legacy_grab.anim');
   const absentLegacyCatalog={exists:(key:string)=>key!=='donkeykong.review_legacy_grab.anim'&&animations.has(key),get:(key:string)=>animations.get(key)};
   const absentDriver=createSimulationSpriteAnimationDriver(()=>s,sprite as unknown as SimulationSpriteSurface,absentLegacyCatalog as unknown as SimulationAnimationCatalog);
   expect(absentDriver.tick()?.key).toBe('donkeykong.attack.anim');
   const atPilot={...s,grab:{...s.grab,active:{...s.grab.active!,framesElapsed:0}},grabPresentation:{...s.grabPresentation!,framesElapsed:pilotAge}};
   expect(resolveSimulationAction(atPilot)).toMatchObject({sheets:[pilotSheet],directArtFrame:0,facing:variant==='pivot'?-face:face});
  }
 });
});

import type {SimulationSpriteSurface,SimulationAnimationCatalog} from './simulationSpriteAnimation';
