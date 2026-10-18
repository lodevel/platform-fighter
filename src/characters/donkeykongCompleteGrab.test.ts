import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {SimulationAnimationSnapshot} from './simulationSpriteAnimation';
import type {PackedBodyClip} from './packedBodyPresentation';
import {getCompleteDonkeyKongStandingGrabTimeline,selectCompleteDonkeyKongStandingGrab} from './donkeykongCompleteGrab';
import {applyDonkeyKongPairedCatchGeometry} from './donkeykongCatchCollisionPose';
import type {AttackCollisionHit} from './attacks';

const catalog=vi.hoisted(()=>({animations:{} as Record<string,unknown>}));
// The fixture is the whole of DK's data: its pose tracks and (empty) sheets.
vi.mock('../../assets/characters/donkeykong/gameplay.json',()=>({default:catalog}));
vi.mock('../../assets/characters/donkeykong/frames.json',()=>({default:catalog}));
import {packedBodyCandidate,resolvePackedBodyAction,selectPackedBodyReceiving,
  getPackedCatchCollisionPose,getPackedBodyDrawing} from './packedBodyPresentation';

// Independent pinned standing plan: source ages0/3/6/7/8/9/10/23/32/37,
// CATCH[7,10), first actionability38. Synthetic pixels/geometry are unaccepted.
const ages=[0,3,6,7,8,9,10,23,32,37];
const capsule=(id:number)=>({start:{x:20+id,y:7},end:{x:60+id,y:7},radius:2+id});
function full():PackedBodyClip {
  return {frameCount:10,bodyCentreFromRootY:-42,
    pairedGrabTimeline:{variant:'standing',startupFrames:7,activeFrames:3,recoveryFrames:28,reviewedInputs:true,bodyReviewKey:'synthetic-review-only'},
    frameWindows:ages.map((age,i)=>({startFrame:age,endFrame:ages[i+1]??38,artFrameIndex:i})),
    hurtboxPoses:ages.map((age,i)=>({artFrameIndex:i,nativeSample:age+1,hurtboxes:[
      {id:`synthetic.core.${i}`,offsetX:i+1,offsetY:0,width:4,height:4,
        capsule:{start:{x:i+1,y:0},end:{x:i+1,y:0},radius:2}}]})),
    catchCollisionPoses:ages.map((age,i)=>({artFrameIndex:i,nativeSample:age+1,
      regions:age>=7&&age<10?[0,1].map(id=>({id,capsule:capsule(id)})):[]}))};
}
function pilot():PackedBodyClip {
  return {frameCount:1,bodyCentreFromRootY:-42,
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
    packedBody:{clock:null,committed:null,crouchPhase:null,turnBrake:null,itemCue:null,airDodgeDirection:{x:0,y:0},fastFall:false},
    ledgeHang:{name:'idle',active:null},dodge:{name:'idle',active:null},locomotion:{name:'standing',framesElapsed:0},
  } as unknown as SimulationAnimationSnapshot;
}
beforeEach(()=>{for(const key of Object.keys(catalog.animations))delete catalog.animations[key];
  catalog.animations.grab=full();catalog.animations.review_pilot_standing_grab_contact=pilot();});

describe('complete reviewed-input standing drawing selector; no full-action qualification',()=>{
  it.each([1,-1] as const)('drawing/receiving/CATCH use one source sample bothface%s',face=>{
    for(const [phase,phaseAge,sourceAge,art,native] of [
      ['whiffStartup',0,0,0,1],['whiffStartup',6,6,2,7],['whiffActive',0,7,3,8],
      ['whiffActive',1,8,4,9],['whiffActive',2,9,5,10],['whiffRecovery',0,10,6,11],
      ['whiffRecovery',27,37,9,38]] as const){
      const s=snapshot(phase,phaseAge,face),before=JSON.stringify(s),body=resolvePackedBodyAction(s);
      expect(body).toMatchObject({state:'grab',frame:sourceAge,directArtFrame:art,facing:face});
      expect(selectPackedBodyReceiving(s)?.[0]?.id).toBe(`synthetic.core.${art}`);
      const selected=getPackedCatchCollisionPose(s);
      if(phase==='whiffActive')expect(selected).toMatchObject({sheet:'grab',sourceGameplayAge:sourceAge,artFrameIndex:art,
        nativeSample:native,pose:{facing:face},providedRegionIds:[0,1],fallbackReason:null});
      else expect(selected).toBeNull();
      expect(JSON.stringify(s)).toBe(before);
    }
  });
  it('uses canonical complete active7 before old same-age contact pilot and retires at38',()=>{
    expect(resolvePackedBodyAction(snapshot('whiffActive',0))?.sheets).toEqual(['grab']);
    expect(getPackedBodyDrawing('donkeykong','grab',38)).toBeNull();
    expect(selectCompleteDonkeyKongStandingGrab(full(),{variant:'standing',phase:'whiffRecovery',phaseFramesElapsed:28,
      spec:{startupFrames:7,activeFrames:3,whiffRecoveryFrames:28}})).toBeNull();
  });
  it('edits startup/recovery clocks per phase without changing source active/clear selection',()=>{
    const spec={startupFrames:3,activeFrames:3,whiffRecoveryFrames:56};
    expect(resolvePackedBodyAction(snapshot('whiffStartup',1,1,spec))).toMatchObject({frame:2,directArtFrame:0});
    expect(resolvePackedBodyAction(snapshot('whiffStartup',2,1,spec))).toMatchObject({frame:4,directArtFrame:1});
    for(let age=0;age<3;age++)expect(getPackedCatchCollisionPose(snapshot('whiffActive',age,1,spec)))
      .toMatchObject({sourceGameplayAge:7+age,nativeSample:8+age,artFrameIndex:3+age});
    expect(resolvePackedBodyAction(snapshot('whiffRecovery',0,1,spec))).toMatchObject({frame:10,directArtFrame:6});
    expect(resolvePackedBodyAction(snapshot('whiffRecovery',55,1,spec))).toMatchObject({frame:37,directArtFrame:9});
    expect(getPackedCatchCollisionPose(snapshot('whiffRecovery',0,1,spec))).toBeNull();
  });
  it('selects a longer active phase within the three source samples only',()=>{
    const spec={startupFrames:7,activeFrames:6,whiffRecoveryFrames:28};
    expect(Array.from({length:6},(_,age)=>getPackedCatchCollisionPose(snapshot('whiffActive',age,1,spec))?.nativeSample))
      .toEqual([8,8,9,9,10,10]);
  });
  it('frozen repeated reads preserve phase and metadata snapshots without advancing any counter',()=>{
    const s={...snapshot('whiffActive',1),frozen:true},before=JSON.stringify(s);
    expect(resolvePackedBodyAction(s)).toEqual(resolvePackedBodyAction(s));
    expect(getPackedCatchCollisionPose(s)).toEqual(getPackedCatchCollisionPose(s));
    expect(JSON.stringify(s)).toBe(before);
  });
  it.each(['holding','throwing','idle','cooldown'])('does not retain full whiff art after capture/exit%s',phase=>{
    const s=snapshot(phase,0);
    expect(packedBodyCandidate(s)?.sheet).not.toBe('grab');
    expect(getPackedCatchCollisionPose(s)).toBeNull();
  });
  it('replaces geometry only; current source masks/categories/IDs remain authoritative',()=>{
    const source:readonly AttackCollisionHit[]=[{id:0,situation:'ground',targetCategory:'fighter',capsule:capsule(0)},
      {id:1,situation:'air',targetCategory:'fighter',capsule:capsule(1)}];
    const pose=getPackedCatchCollisionPose(snapshot('whiffActive',0))?.pose;
    expect(pose).not.toBeNull();if(!pose)throw new Error('synthetic active pose missing');
    const result=applyDonkeyKongPairedCatchGeometry(source,pose,1)!;
    expect(result.map(({capsule:_capsule,...rules})=>rules)).toEqual([
      {id:0,situation:'ground',targetCategory:'fighter'},{id:1,situation:'air',targetCategory:'fighter'}]);
    expect(applyDonkeyKongPairedCatchGeometry([{...source[0]!,id:9},source[1]!],pose,1)).toBeNull();
  });
});

describe('complete full clip guards preserve existing contact pilot/legacy routes',()=>{
  it.each([
    (f:PackedBodyClip)=>({...f,pairedGrabTimeline:undefined}),
    (f:PackedBodyClip)=>({...f,pairedGrabTimeline:{...f.pairedGrabTimeline,reviewedInputs:false}}),
    (f:PackedBodyClip)=>({...f,pairedGrabTimeline:{...f.pairedGrabTimeline,bodyReviewKey:' '}}),
    (f:PackedBodyClip)=>({...f,frameWindows:f.frameWindows?.slice(1)}),
    (f:PackedBodyClip)=>({...f,hurtboxPoses:f.hurtboxPoses?.slice(1)}),
    (f:PackedBodyClip)=>({...f,catchCollisionPoses:f.catchCollisionPoses?.slice(1)}),
    (f:PackedBodyClip)=>({...f,frameWindows:f.frameWindows?.map((w,i)=>i===9?{...w,endFrame:39}:w)}),
    (f:PackedBodyClip)=>({...f,hurtboxPoses:f.hurtboxPoses?.map((w,i)=>i===3?{...w,nativeSample:9}:w)}),
    (f:PackedBodyClip)=>({...f,catchCollisionPoses:f.catchCollisionPoses?.map((w,i)=>i===6?{...w,regions:[{id:0,capsule:capsule(0)}]}:w)}),
  ])('missing/unreviewed/malformed complete metadata falls back without source suppression',corrupt=>{
    const bad=corrupt(full());catalog.animations.grab=bad;
    expect(getCompleteDonkeyKongStandingGrabTimeline(bad)).toBeNull();
    expect(resolvePackedBodyAction(snapshot('whiffActive',0))).toMatchObject({state:'review_pilot_standing_grab_contact'});
    expect(getPackedCatchCollisionPose(snapshot('whiffActive',0))).toMatchObject({sheet:'review_pilot_standing_grab_contact',fallbackReason:null});
  });
  it('malformed marked canonical data is ignored outside pilot age instead of throwing or opting into CATCH',()=>{
    const f=full();catalog.animations.grab={...f,hurtboxPoses:[null,...(f.hurtboxPoses??[]).slice(1)]};
    expect(()=>resolvePackedBodyAction(snapshot('whiffStartup',0))).not.toThrow();
    expect(resolvePackedBodyAction(snapshot('whiffStartup',0))).toBeNull();
    expect(getPackedCatchCollisionPose(snapshot('whiffActive',1))).toMatchObject({optedIn:false,pose:null,fallbackReason:'missing-clip-metadata'});
  });
  it('rejects nonfinite receiving/capsules and missing one of the two native source IDs',()=>{
    const f=full();
    const badReceiving={...f,hurtboxPoses:f.hurtboxPoses?.map((w,i)=>i===3?{...w,hurtboxes:[{id:'bad',offsetX:NaN,offsetY:0,width:4,height:4}]}:w)};
    expect(getCompleteDonkeyKongStandingGrabTimeline(badReceiving)).toBeNull();
    const badCatch={...f,catchCollisionPoses:f.catchCollisionPoses?.map((w,i)=>i===3?{...w,regions:[{id:0,capsule:capsule(0)},{id:9,capsule:capsule(1)}]}:w)};
    expect(getCompleteDonkeyKongStandingGrabTimeline(badCatch)).toBeNull();
  });
});
