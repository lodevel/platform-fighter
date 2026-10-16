import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import {CHARACTER_IDS} from '../types';
import {DonkeyKong, DONKEYKONG_GRAB} from './DonkeyKong';
import {Pikachu, PIKACHU_GRAB} from './Pikachu';
import {getDefaultCaptureAttachmentCalibration, CAPTURE_ATTACHMENT_DEFAULT_REVIEW_PINS} from './captureAttachmentDefaultData';
import {selectCaptureAttachmentAnchor} from './captureAttachmentCalibration';
import {createCharacterById, applyCharacterMoveOverrides} from './characterFactory';
import {getAuthorableCharacterSpec} from './authorableCharacterRegistry';
import {parseCharacterDataFile, serializeCharacterDataSpec} from './characterSerializer';
import {ASSET_KEYS} from '../assets/manifest';

const reviewDir='docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art/ordinary-grip-anchor-review-01';
// Pikachu captured_hit (ordinary-damage) anchors, same derivation as the captured ones (rework 2026-10-11 remaining gaps).
const capturedHitDir='docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/install/remaining-gaps/pikachu-captured-hit-anchor';
// DK as a capture recipient (carried by a DK carrier / pummelled): captured + captured_hit anchors and floor, same method.
const dkRecipientDir='docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/install/remaining-gaps/dk-recipient-anchor';
// extras2: DK's own cargo_recipient_* drawings (native Hip anchors), appended to the candidate-01 rows.
const dkCargoRecipientDir='docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/install/extras2';
const primary=(name:string,dir=reviewDir):any=>JSON.parse(readFileSync(resolve(dir,name),'utf8'));
// The parser stamps each row with the file's sample basis (one-based native frame when the file omits it).
const withRowBasis=(raw:any)=>({...raw,anchors:raw.anchors.map((row:any)=>({...row,sourceSampleBasis:raw.sourceSampleBasis??'one-based-native-frame'}))});
const expected=(id:string)=>{
  // DK's captor grips stay in frames.json (no default grips); the default carries DK's own recipient anchors and floor.
  if(id==='donkeykong')return withRowBasis(primary('dk-recipient-target-calibration-with-floor-candidate-02.json',dkCargoRecipientDir));
  return id==='pikachu'?withRowBasis(primary('pikachu-ordinary-target-calibration-with-floor-candidate-03.json',capturedHitDir)):null;
};
function scene():any{return {matter:{add:{rectangle:(x:number,y:number,_w:number,_h:number,opts:object)=>({position:{x,y},velocity:{x:0,y:0},...opts})},body:{setInertia:vi.fn(),setVelocity:vi.fn(),setPosition:vi.fn()},world:{on:vi.fn(),off:vi.fn(),remove:vi.fn()}}};}
const options={spawnX:0,spawnY:0};

describe('APP15 isolated stock and saved calibration route; reviewed target 2D only',()=>{
  it('pins recipient-own floor and keeps DK identity free of duplicate clip grip rows',()=>{
    // Pin = sha256 of pikachu-ordinary-target-calibration-with-floor-candidate-03.json (candidate-02 + captured_hit rows).
    expect(CAPTURE_ATTACHMENT_DEFAULT_REVIEW_PINS.pikachuOwnAnchorFloorSha256).toBe('2abea3630a0329a338d3baea645b1b2117477d4f182d1d062924fd9778dd1b9a');
    expect(getDefaultCaptureAttachmentCalibration('donkeykong')).toEqual(expected('donkeykong'));
    expect(getDefaultCaptureAttachmentCalibration('donkeykong')?.grips).toBeUndefined();
    // Pin = sha256 of dk-recipient-target-calibration-with-floor-candidate-02.json (install/extras2): candidate-01 (5 held captured + 4 captured_hit)
    // + 31 cargo_recipient_* drawings.
    expect(CAPTURE_ATTACHMENT_DEFAULT_REVIEW_PINS.dkOwnAnchorFloorSha256).toBe('2abf50e4a03e3fe4f697673726bedb250e4622b61cb61c5c41cd15c76664733e');
    expect(getDefaultCaptureAttachmentCalibration('donkeykong')?.profileKey).toBe('dk-ordinary-grab-target-v1');
    expect(getDefaultCaptureAttachmentCalibration('donkeykong')?.anchors).toHaveLength(40);
    expect(getDefaultCaptureAttachmentCalibration('donkeykong')?.supportingFloor).toMatchObject({recipientReviewedBottom:42,clearance:.55});
    expect(getDefaultCaptureAttachmentCalibration('pikachu')).toEqual(expected('pikachu'));
    // 4 captured (ordinary-held) + 4 captured_hit (ordinary-damage) drawings.
    expect(getDefaultCaptureAttachmentCalibration('pikachu')?.anchors).toHaveLength(8);
  });
  it('direct constructors enable DK ordinary attachment and supply PK own anchors without opting PK captor in',()=>{
    const dk=new DonkeyKong(scene(),options),pk=new Pikachu(scene(),options);
    try{
      expect(dk.getGrabSpec()?.attachmentPolicy).toBe('pose-anchors-beta-v1');
      expect(dk.getCaptureAttachmentCalibration()).toEqual(expected('donkeykong'));
      expect(pk.getGrabSpec()).toEqual(PIKACHU_GRAB);
      expect(pk.getGrabSpec()?.attachmentPolicy).toBeUndefined();
      expect(pk.getCaptureAttachmentCalibration()).toEqual(expected('pikachu'));
      expect(dk.getTuning()).toMatchObject({width:60,height:84});expect(pk.getTuning()).toMatchObject({width:40,height:50});
    }finally{dk.destroy();pk.destroy();}
  });
  it.each(CHARACTER_IDS)('normal factory and untouched saved Lab clone retain own defaults for %s',id=>{
    const stock=createCharacterById(scene(),id,options);
    const original=getAuthorableCharacterSpec(id);
    const file=serializeCharacterDataSpec(original);
    const saved=parseCharacterDataFile(JSON.parse(JSON.stringify(file)));
    const clone=createCharacterById(scene(),id,{...options,...saved.body,...saved.movement});
    try{
      applyCharacterMoveOverrides(clone,saved);
      expect(stock.getCaptureAttachmentCalibration()).toEqual(expected(id));
      expect(clone.getCaptureAttachmentCalibration()).toEqual(expected(id));
      expect(saved.captureAttachmentCalibration??null).toEqual(expected(id));
      expect(clone.getGrabSpec()).toEqual(stock.getGrabSpec());
      expect(clone.getTuning()).toEqual(stock.getTuning());
      expect(saved.moves).toEqual(JSON.parse(JSON.stringify(original.moves)));
      if(id==='donkeykong')expect(saved.moves?.grab?.attachmentPolicy).toBe('pose-anchors-beta-v1');
      else expect(saved.moves?.grab?.attachmentPolicy).toBeUndefined();
    }finally{stock.destroy();clone.destroy();}
  });
  it('an authored movement edit saves all moves, source clocks and default calibration unchanged',()=>{
    const base=getAuthorableCharacterSpec('donkeykong');
    const locomotion=base.movement.locomotion;
    if(!locomotion||locomotion.walkMaxSpeed===undefined)throw new Error('DK default lacks reviewed walk speed');
    const changed={...base,movement:{...base.movement,locomotion:{...locomotion,walkMaxSpeed:locomotion.walkMaxSpeed+.01}}};
    const saved=parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(changed))));
    expect(saved.captureAttachmentCalibration).toEqual(expected('donkeykong'));
    expect(saved.moves).toEqual(base.moves);
    expect(saved.moves?.grab).toEqual(DONKEYKONG_GRAB);
    expect(saved.moves?.grab).toMatchObject({throwClock:'native-sample-one',pummel:{motionFrames:7},cargo:{entryMotionFrames:24}});
    expect(saved.movement.locomotion?.walkMaxSpeed).toBe(changed.movement.locomotion.walkMaxSpeed);
  });
  it('each constructor and exported default receives defensive own data',()=>{
    const a=getDefaultCaptureAttachmentCalibration('pikachu')!,b=getDefaultCaptureAttachmentCalibration('pikachu')!;
    expect(a).not.toBe(b);expect(a.anchors![0]!.point).not.toBe(b.anchors![0]!.point);
    const pk=new Pikachu(scene(),options);
    try{const own=pk.getCaptureAttachmentCalibration()!;const revised={...own,revision:'authored-custom'};pk.setCaptureAttachmentCalibration(revised);
      expect(pk.getCaptureAttachmentCalibration()?.revision).toBe('authored-custom');
      expect(getDefaultCaptureAttachmentCalibration('pikachu')).toEqual(expected('pikachu'));
    }finally{pk.destroy();}
  });
  it('an explicit saved calibration overrides constructor defaults even without authored moves',()=>{
    const pk=createCharacterById(scene(),'pikachu',options);
    const custom={...getDefaultCaptureAttachmentCalibration('pikachu')!,revision:'saved-explicit-override'};
    try{
      applyCharacterMoveOverrides(pk,{...getAuthorableCharacterSpec('pikachu'),moves:undefined,captureAttachmentCalibration:custom});
      expect(pk.getCaptureAttachmentCalibration()).toEqual(custom);
      expect(pk.getGrabSpec()).toEqual(PIKACHU_GRAB);
      expect(getDefaultCaptureAttachmentCalibration('pikachu')).toEqual(expected('pikachu'));
    }finally{pk.destroy();}
  });
  it('unsupported contexts and changed recipient dimensions remain explicit gaps; cargo reuses the held anchor',()=>{
    const pk=getDefaultCaptureAttachmentCalibration('pikachu')!,dk=getDefaultCaptureAttachmentCalibration('donkeykong')!;
    expect(selectCaptureAttachmentAnchor(pk,{context:'ordinary-throw',poseKey:'captured',artFrameIndex:0,nativeSample:null,dimensions:{width:40,height:50}})).toEqual({status:'missing'});
    // A carried recipient is held in the same drawing while carried and through the cargo throw until its release:
    // without cargo rows it uses its held anchor.
    for(const context of ['cargo-held','cargo-throw'] as const)
      expect(selectCaptureAttachmentAnchor(pk,{context,poseKey:'captured',artFrameIndex:0,nativeSample:null,dimensions:{width:40,height:50}}))
        .toMatchObject({status:'explicit',anchor:{poseKey:'captured',artFrameIndex:0,context:'ordinary-held'}});
    // DK drawings carry their native sample (selectPackedDrawing); a null sample is not one of DK's selectors.
    expect(selectCaptureAttachmentAnchor(dk,{context:'ordinary-held',poseKey:'captured',artFrameIndex:0,nativeSample:null,dimensions:{width:60,height:84}})).toEqual({status:'invalid',reason:'missing-or-duplicate-explicit-recipient-anchor'});
    expect(selectCaptureAttachmentAnchor(dk,{context:'ordinary-throw',poseKey:'captured',artFrameIndex:0,nativeSample:1,dimensions:{width:60,height:84}})).toEqual({status:'missing'});
    expect(selectCaptureAttachmentAnchor(pk,{context:'ordinary-held',poseKey:'captured',artFrameIndex:0,nativeSample:null,dimensions:{width:60,height:84}})).toEqual({status:'invalid',reason:'explicit-recipient-anchor-dimension-mismatch'});
  });
  it('pummel hits: every captured_hit drawing has its own ordinary-damage anchor; the held anchors are unchanged',()=>{
    const pk=getDefaultCaptureAttachmentCalibration('pikachu')!,size={width:40,height:50};
    const derived=primary('proposal.json',capturedHitDir).recipientProposals as {artFrameIndex:number;point:{x:number;y:number}}[];
    for(const artFrameIndex of [0,1,2,3]){
      expect(selectCaptureAttachmentAnchor(pk,{context:'ordinary-damage',poseKey:'captured_hit',artFrameIndex,nativeSample:null,dimensions:size}))
        .toEqual({status:'explicit',anchor:expect.objectContaining({poseKey:'captured_hit',context:'ordinary-damage',artFrameIndex,
          point:derived.find(r=>r.artFrameIndex===artFrameIndex)!.point,provenance:'authored-reviewed-target'})});
      const held=primary('pikachu-ordinary-target-calibration-with-floor-candidate-02.json').anchors[artFrameIndex];
      expect(selectCaptureAttachmentAnchor(pk,{context:'ordinary-held',poseKey:'captured',artFrameIndex,nativeSample:null,dimensions:size}))
        .toEqual({status:'explicit',anchor:{...held,sourceSampleBasis:'one-based-native-frame'}});
    }
    // The damage context is only selected with the captured_hit body (captureAttachmentContextFromBody): another pose there is a gap.
    expect(selectCaptureAttachmentAnchor(pk,{context:'ordinary-damage',poseKey:'captured',artFrameIndex:0,nativeSample:null,dimensions:size}))
      .toEqual({status:'invalid',reason:'missing-or-duplicate-explicit-recipient-anchor'});
  });
  it('DK recipient: every held captured drawing (also carried and cargo-thrown) and captured_hit drawing resolves its own anchor',()=>{
    const dk=getDefaultCaptureAttachmentCalibration('donkeykong')!,size={width:60,height:84};
    const derived=primary('proposal.json',dkRecipientDir).recipientProposals as {poseKey:string;artFrameIndex:number;nativeSample:number;point:{x:number;y:number}}[];
    const native={captured:[1,9,17,24,32],captured_hit:[1,7,14,20]} as const;
    for(const [poseKey,samples] of Object.entries(native))samples.forEach((nativeSample,artFrameIndex)=>{
      const point=derived.find(r=>r.poseKey===poseKey&&r.artFrameIndex===artFrameIndex)!.point;
      const contexts=poseKey==='captured'?(['ordinary-held','cargo-held','cargo-throw'] as const):(['ordinary-damage'] as const);
      for(const context of contexts)
        expect(selectCaptureAttachmentAnchor(dk,{context,poseKey,artFrameIndex,nativeSample,dimensions:size}))
          .toEqual({status:'explicit',anchor:expect.objectContaining({poseKey,artFrameIndex,nativeSample,point,
            context:poseKey==='captured'?'ordinary-held':'ordinary-damage',profileKey:'dk-ordinary-grab-target-v1',provenance:'authored-reviewed-target'})});
    });
  });
  it('DK cargo recipient: every cargo_recipient_* drawing resolves its own Hip anchor in its cargo context; captured keeps its held rows',()=>{
    const dk=getDefaultCaptureAttachmentCalibration('donkeykong')!,size={width:60,height:84};
    const derived=primary('proposal.json',dkCargoRecipientDir).recipientProposals as {poseKey:string;context:string;artFrameIndex:number;nativeSample:number;point:{x:number;y:number}}[];
    expect(derived).toHaveLength(31);
    for(const r of derived)
      expect(selectCaptureAttachmentAnchor(dk,{context:r.context as 'cargo-held'|'cargo-throw',poseKey:r.poseKey,artFrameIndex:r.artFrameIndex,nativeSample:r.nativeSample,dimensions:size}))
        .toEqual({status:'explicit',anchor:expect.objectContaining({poseKey:r.poseKey,context:r.context,point:r.point,provenance:'authored-reviewed-target'})});
    expect(selectCaptureAttachmentAnchor(dk,{context:'cargo-held',poseKey:'captured',artFrameIndex:0,nativeSample:1,dimensions:size}))
      .toMatchObject({status:'explicit',anchor:{poseKey:'captured',context:'ordinary-held'}});
  });
  it('reserves the legacy key without duplicate asset identifiers',()=>{
    expect(ASSET_KEYS.charDonkeykongReviewLegacyGrab).toBe('char.donkeykong.review_legacy_grab');
    const keys=Object.values(ASSET_KEYS);expect(new Set(keys).size).toBe(keys.length);
  });
});
