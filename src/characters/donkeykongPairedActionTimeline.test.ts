import { describe, expect, it } from 'vitest';
import metadata from '../../assets/characters/donkeykong/gameplay.json';
import type { AttackMove } from './attacks';
import type { SimulationAnimationSnapshot } from './simulationSpriteAnimation';
import { getDonkeyKongPairedTimeline, mapDonkeyKongPairedActionAge, type DonkeyKongPairedTimelineClip } from './donkeykongPairedActionTimeline';
import { getPackedAttackCollisionPose, getPackedBodyDrawing, resolvePackedBodyAction, resolvePackedPairedMoveDrawing, selectPackedBodyReceiving } from './packedBodyPresentation';
import { applyDonkeyKongPairedAttackGeometry } from './donkeykongAttackCollisionPose';
import { inspectMoveFrame } from '../characterBuilder/moveFramePreview';

const clip=metadata.animations.jab as DonkeyKongPairedTimelineClip;
const move:AttackMove={id:'donkeykong.jab',type:'jab',damage:4,knockback:{x:1,y:-1,scaling:0},
  startupFrames:4,activeFrames:2,recoveryFrames:18,cooldownFrames:0,
  hitbox:{offsetX:20,offsetY:0,width:4,height:4}};
const snapshot=(attack:AttackMove,age:number,facing:1|-1=1)=>({
  characterId:'donkeykong',facing,grounded:true,
  packedBody:{surfaceTech:null,committed:null,heavyItem:null,itemCue:null,clock:null},
  ledgeHang:{active:null},dodge:{active:null},activeAttack:{move:attack,framesElapsed:age,facing},
} as unknown as SimulationAnimationSnapshot);

describe('DK complete paired jab clocks',()=>{
  it('keeps every stock age exact and retires at the independent24-step source extent',()=>{
    expect(getDonkeyKongPairedTimeline(clip)).toEqual({startup:4,active:2,recovery:18,endFrame:24});
    for(let age=0;age<24;age++)expect(mapDonkeyKongPairedActionAge(clip,move,age)).toBe(age);
    expect(mapDonkeyKongPairedActionAge(clip,move,24)).toBeNull();
    expect(getPackedBodyDrawing('donkeykong','jab',24)).toBeNull();
  });
  it.each([1,-1] as const)('canonical drawing, receiving and attack replace the old pilot together facing%s',facing=>{
    const expectedFrames=[0,0,0,0,1,2,3,3,3,3,3,4,4,4,4,4,4,5,5,5,5,5,6,6];
    for(let age=0;age<24;age++){
      const s=snapshot(move,age,facing),action=resolvePackedBodyAction(s),attack=getPackedAttackCollisionPose(s);
      expect(action?.sheets).toEqual(['jab']);expect(action?.directArtFrame).toBe(expectedFrames[age]);
      const drawing=getPackedBodyDrawing('donkeykong','jab',age)!;
      expect(selectPackedBodyReceiving(s)).toEqual(drawing.hurtboxes);
      expect(attack?.artFrameIndex).toBe(expectedFrames[age]);expect(attack?.nativeSample).toBe(drawing.nativeSample);
      expect(attack?.gameplayAge).toBe(age);expect(attack?.sourceActionAge).toBe(age);
      expect(attack?.collisionHits.map(h=>h.id)).toEqual(age===4||age===5?[0,1,2,3]:[]);
    }
  });
  it.each([1,-1] as const)('resamples authored phases without recovery strike leakage facing%s',facing=>{
    const custom={...move,startupFrames:8,activeFrames:4,recoveryFrames:9};
    const sourceAges=[0,.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,8,10,12,14,16,18,20,22];
    for(let age=0;age<21;age++){
      const sourceAge=mapDonkeyKongPairedActionAge(clip,custom,age)!;
      expect(sourceAge).toBe(sourceAges[age]);
      const s=snapshot(custom,age,facing),drawing=getPackedBodyDrawing('donkeykong','jab',sourceAge)!,attack=getPackedAttackCollisionPose(s);
      expect(resolvePackedBodyAction(s)?.directArtFrame).toBe(drawing.artFrameIndex);
      expect(selectPackedBodyReceiving(s)).toEqual(drawing.hurtboxes);
      expect(attack?.nativeSample).toBe(drawing.nativeSample);expect(attack?.sourceActionAge).toBe(sourceAge);
      expect(attack?.gameplayAge).toBe(age);
      expect(attack?.collisionHits.map(h=>h.id)).toEqual(age>=8&&age<12?[0,1,2,3]:[]);
    }
    expect(resolvePackedBodyAction(snapshot(custom,21,facing))).toBeNull();
  });
  it('allows zero startup/recovery and maps the single active step into a valid strike sample',()=>{
    expect(mapDonkeyKongPairedActionAge(clip,{startupFrames:0,activeFrames:1,recoveryFrames:0},0)).toBe(4);
    expect(mapDonkeyKongPairedActionAge(clip,{startupFrames:0,activeFrames:1,recoveryFrames:0},1)).toBeNull();
  });
  it('shares the Editor sample and geometry while retaining custom source damage/flags',()=>{
    const custom={...move,startupFrames:8,activeFrames:4,recoveryFrames:9,
      collisionHits:[0,1,2,3].map(id=>({id,damage:12,direct:false,tripChance:.4,
        capsule:{start:{x:20,y:0},end:{x:20,y:0},radius:2}}))};
    for(let age=0;age<21;age++){
      const editor=resolvePackedPairedMoveDrawing('donkeykong',custom,age)!,runtime=getPackedAttackCollisionPose(snapshot(custom,age))!;
      expect(editor.artFrameIndex).toBe(runtime.artFrameIndex);expect(editor.nativeSample).toBe(runtime.nativeSample);
      const live=inspectMoveFrame(custom,age).collisionHits;
      const overlay=applyDonkeyKongPairedAttackGeometry(live,runtime);
      expect(overlay.map(h=>({id:h.id,capsule:h.capsule}))).toEqual(runtime.collisionHits);
      for(const hit of overlay){expect(hit.damage).toBe(12);expect(hit.direct).toBe(false);expect(hit.tripChance).toBe(.4);}
    }
  });
  it('preserves a fractional source age in the last cell of a longer authored recovery',()=>{
    const custom={...move,recoveryFrames:36};
    const editor=resolvePackedPairedMoveDrawing('donkeykong',custom,41)!,runtime=getPackedAttackCollisionPose(snapshot(custom,41))!;
    expect(editor.sourceActionAge).toBe(23.5);expect(editor.localFrame).toBe(23.5);
    expect(editor.artFrameIndex).toBe(6);expect(editor.nativeSample).toBe(23);
    expect(runtime.sourceActionAge).toBe(23.5);expect(runtime.gameplayAge).toBe(41);expect(runtime.collisionHits).toEqual([]);
  });
  it('keeps absent full coverage as a gap and rejects a corrupted paired clock',()=>{
    expect(getDonkeyKongPairedTimeline({...clip,pairedActionTimeline:undefined})).toBeNull();
    const altered=()=>structuredClone(clip) as {frameWindows:Array<{startFrame:number;endFrame:number;artFrameIndex:number}>;
      hurtboxPoses:Array<{artFrameIndex:number;nativeSample:number;hurtboxes:unknown[]}>;
      attackCollisionPoses:Array<{artFrameIndex:number;nativeSample:number;collisionHits:Array<{id:number}>}>}&DonkeyKongPairedTimelineClip;
    const gap=altered();gap.frameWindows[4]!.startFrame=7;expect(()=>getDonkeyKongPairedTimeline(gap)).toThrow('drawing windows');
    const wrong=altered();wrong.hurtboxPoses[2]!.nativeSample=5;expect(()=>getDonkeyKongPairedTimeline(wrong)).toThrow('native sample pairing');
    const leak=altered();leak.attackCollisionPoses[6]!.collisionHits=[{id:0}];expect(()=>getDonkeyKongPairedTimeline(leak)).toThrow('active geometry after recovery');
  });
});
