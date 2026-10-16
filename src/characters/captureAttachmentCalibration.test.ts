import { describe, expect, it } from 'vitest';
import { parseCaptureAttachmentCalibration, selectCaptureAttachmentAnchor, captureAttachmentContextFromBody,
  type CaptureAttachmentCalibration } from './captureAttachmentCalibration';

const calibration = () => ({ profileKey:'synthetic-owned-profile',revision:'candidate-v1',
  grips:[{poseKey:'grab_hold',profileKey:'synthetic-owned-profile',dimensions:{width:60,height:84},
    artFrameIndex:0,nativeSample:1,point:{x:30,y:-20},provenance:'authored-reviewed-target',context:'ordinary-held',
    facingPolicy:'preserve-recipient',occlusion:'legacy-order'}],
  physicalCentreContexts:['ordinary-held'],
  supportingFloor:{reviewKey:'synthetic-floor-envelope',recipientReviewedBottom:20,clearance:.5} });

describe('candidate authored attachment transport validation (no art qualification)',()=>{
  it('owns a defensive copy so caller mutation cannot silently revise accepted selector data',()=>{
    const raw=calibration(),parsed=parseCaptureAttachmentCalibration(raw,'fixture');
    raw.grips[0]!.point.x=999;
    expect(parsed.grips?.[0]?.point.x).toBe(30);
    expect(parsed.physicalCentreContexts).toEqual(['ordinary-held']);
  });
  it('roundtrips a separately labelled physical-centre-only recipient without inventing a visible anchor',()=>{
    const raw={profileKey:'recipient-runtime-centre',revision:'candidate-v1',physicalCentreContexts:['ordinary-held']};
    expect(parseCaptureAttachmentCalibration(JSON.parse(JSON.stringify(raw)),'fixture')).toEqual(raw);
    expect(parseCaptureAttachmentCalibration(raw,'fixture').anchors).toBeUndefined();
  });
  it.each([{profileKey:''},{revision:' '},{physicalCentreContexts:['ordinary-held','ordinary-held']},
    {physicalCentreContexts:['base-dx-girl']},{supportingFloor:{reviewKey:'x',clearance:.5}},
    {supportingFloor:{reviewKey:'',recipientReviewedBottom:20,clearance:.5}},
    {supportingFloor:{reviewKey:'x',recipientReviewedBottom:Infinity,clearance:.5}}])
  ('rejects malformed owned calibration %j',patch=>{
    expect(()=>parseCaptureAttachmentCalibration({...calibration(),...patch},'fixture')).toThrow();
  });
  it('rejects duplicate selectors and descriptor profile mismatch',()=>{
    const raw=calibration();
    expect(()=>parseCaptureAttachmentCalibration({...raw,grips:[...raw.grips,...raw.grips]},'fixture')).toThrow();
    expect(()=>parseCaptureAttachmentCalibration({...raw,grips:[{...raw.grips[0]!,profileKey:'other'}]},'fixture')).toThrow();
  });
  it('rejects disguised nonorigin physical-centre rows and unknown native provenance',()=>{
    const raw=calibration();
    for(const provenance of ['physical-centre-beta','native-parity'])
      expect(()=>parseCaptureAttachmentCalibration({...raw,grips:[{...raw.grips[0]!,provenance}]},'fixture')).toThrow();
  });
  it('rejects sparse physical-centre context arrays rather than skipping a hole',()=>{
    const sparse:string[]=['ordinary-held'];sparse.length=2;
    expect(()=>parseCaptureAttachmentCalibration({...calibration(),physicalCentreContexts:sparse},'fixture')).toThrow();
  });
  it.each(['context','provenance','facingPolicy','occlusion'])('rejects nonstring %s without coercing user code',field=>{
    const words:Record<string,string>={context:'ordinary-held',provenance:'authored-reviewed-target',
      facingPolicy:'preserve-recipient',occlusion:'legacy-order'};
    let invoked=false;
    const value={toString(){invoked=true;return words[field]!;}};
    const raw=calibration();
    expect(()=>parseCaptureAttachmentCalibration({...raw,grips:[{...raw.grips[0]!,[field]:value}]},'fixture')).toThrow();
    expect(invoked).toBe(false);
  });
  it('uses the selected body lifecycle instead of starting a separate twenty-step damage timer',()=>{
    expect(captureAttachmentContextFromBody(false,false,'captured_hit')).toBe('ordinary-damage');
    expect(captureAttachmentContextFromBody(false,false,'captured')).toBe('ordinary-held');
    expect(captureAttachmentContextFromBody(false,true,'captured_hit')).toBe('ordinary-throw');
    expect(captureAttachmentContextFromBody(true,false,'captured_hit')).toBe('cargo-held');
    expect(captureAttachmentContextFromBody(true,true,'captured')).toBe('cargo-throw');
  });
  it('never launders a missing/duplicate/malformed explicit current anchor through configured physical centre',()=>{
    const raw=calibration(),anchor={...raw.grips[0]!},pose={context:'ordinary-held' as const,poseKey:'grab_hold',
      artFrameIndex:0,nativeSample:1,dimensions:{width:60,height:84}};
    const valid=parseCaptureAttachmentCalibration({...raw,anchors:[anchor]},'fixture');
    expect(selectCaptureAttachmentAnchor(valid,pose).status).toBe('explicit');
    expect(selectCaptureAttachmentAnchor(valid,{...pose,artFrameIndex:1})).toEqual({status:'invalid',reason:'missing-or-duplicate-explicit-recipient-anchor'});
    expect(selectCaptureAttachmentAnchor(valid,{...pose,dimensions:{width:32,height:40}})).toEqual({status:'invalid',reason:'explicit-recipient-anchor-dimension-mismatch'});
    const duplicate={...valid,anchors:[anchor,anchor]} as unknown as CaptureAttachmentCalibration;
    expect(selectCaptureAttachmentAnchor(duplicate,pose)).toEqual({status:'invalid',reason:'invalid-explicit-attachment-calibration'});
    const malformed={...valid,anchors:[{...anchor,point:{x:NaN,y:0}}]} as unknown as CaptureAttachmentCalibration;
    expect(selectCaptureAttachmentAnchor(malformed,pose)).toEqual({status:'invalid',reason:'invalid-explicit-attachment-calibration'});
    expect(selectCaptureAttachmentAnchor(parseCaptureAttachmentCalibration(raw,'fixture'),pose).status).toBe('physical-centre');
  });
});
