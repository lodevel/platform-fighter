import { describe, expect, it } from 'vitest';
import { resolveDonkeyKongCaptureAttachment, type CaptureAttachmentRequest,
  type CaptureAttachmentResult, type AttachmentFacing } from './donkeykongCaptureAttachment';

/** Synthetic target-space fixtures with independently chosen anchors, not art acceptance. */
function fixture(): CaptureAttachmentRequest {
  return {
    enabled: true, active: true, reciprocal: true, context: 'ordinary-held', currentContext: 'ordinary-held',
    captorBodyId: 12, recipientBodyId: 48, liveCaptorBodyId: 12, liveRecipientBodyId: 48,
    liveBodyIds: [12, 48, 83], captureId: 3, currentCaptureId: 3,
    expectedCaptorReset: 2, currentCaptorReset: 2, expectedRecipientReset: 4, currentRecipientReset: 4,
    captorSolvedCentre: { x: 100, y: 200 }, captorDrawingFacing: 1, recipientCapturedFacing: -1,
    captorPoseKey: 'dk.catch.pose8', captorProfileKey: 'dk.review-profile-v1', captorDimensions: { width: 60, height: 84 },
    recipientPoseKey: 'pk.held.pose1', recipientProfileKey: 'pk.ordinary-profile-v1', recipientDimensions: { width: 32, height: 40 },
    captorArtFrameIndex: 2, captorNativeSample: 8, recipientArtFrameIndex: 0, recipientNativeSample: null,
    grip: { poseKey: 'dk.catch.pose8', profileKey: 'dk.review-profile-v1', dimensions: { width: 60, height: 84 },
      artFrameIndex: 2, nativeSample: 8, point: { x: 30, y: -20 }, provenance: 'authored-reviewed-target',
      context: 'ordinary-held', facingPolicy: 'preserve-recipient', occlusion: 'legacy-order' },
    anchor: { poseKey: 'pk.held.pose1', profileKey: 'pk.ordinary-profile-v1', dimensions: { width: 32, height: 40 },
      artFrameIndex: 0, nativeSample: null, point: { x: 7, y: 12 }, provenance: 'authored-reviewed-target' },
  };
}
function corrupt(patch: Record<string, unknown>): CaptureAttachmentRequest {
  return { ...fixture(), ...patch } as unknown as CaptureAttachmentRequest;
}
function paired(q: CaptureAttachmentRequest): Extract<CaptureAttachmentResult, { status: 'paired' }> {
  const r = resolveDonkeyKongCaptureAttachment(q);
  if (r.status !== 'paired') throw new Error(`Expected paired synthetic fixture, received ${r.status}:${r.reason}`);
  return r;
}
const expectedInactive = (reason: string) => ({ status: 'inactive', reason });
const expectedFallback = (reason: string) => ({ status: 'fallback', mode: 'legacy-fixed-centre', reason });

describe('candidate DK target attachment algebra, separate from source constraints', () => {
  it('solves different captor and recipient anchors without treating either as body centre', () => {
    const r = paired(fixture());
    // World grip = (130,180); own anchor is (-7,+12) in captured face -1.
    expect(r.exact.gripWorld).toEqual({ x: 130, y: 180 });
    expect(r.exact.recipientCentre).toEqual({ x: 137, y: 168 });
    expect(r.exact.anchorWorld).toEqual({ x: 130, y: 180 });
    expect(r.exact.residualDistance).toBe(0);
    expect(r.stage.status).toBe('unconstrained');
    expect(r.stage.correctionWorld).toEqual({ x: 0, y: 0 });
  });
  it.each([1, -1] as const)('reflects both anchor x coordinates once when both actor facings reverse (%s)', face => {
    const q = fixture();
    const r = paired({ ...q, captorSolvedCentre: { x: 0, y: 200 }, captorDrawingFacing: face,
      recipientCapturedFacing: (face === 1 ? -1 : 1) as AttachmentFacing });
    expect(r.exact.gripWorld).toEqual({ x: face === 1 ? 30 : -30, y: 180 });
    expect(r.exact.recipientCentre).toEqual({ x: face === 1 ? 37 : -37, y: 168 });
    expect(r.exact.residualWorld).toEqual({ x: 0, y: 0 });
  });
  it('uses pivot drawing face -actorFace once, never a second negative-native reflection', () => {
    const q = fixture();
    const r = paired({ ...q, captorDrawingFacing: -1, recipientCapturedFacing: 1 });
    // Actor face +1, drawing face -1 already supplied; world grip70, own +7 => centre63.
    expect(r.exact.gripWorld).toEqual({ x: 70, y: 180 });
    expect(r.exact.recipientCentre).toEqual({ x: 63, y: 168 });
  });
  it.each([
    ['same-as-captor-drawing', 1, 123], ['opposite-captor-drawing', -1, 137],
    ['preserve-recipient', -1, 137],
  ] as const)('consumes explicit facing policy %s rather than size or source chooser', (policy, facing, centreX) => {
    const q = fixture();
    if (!q.grip) throw new Error('fixture grip absent');
    const r = paired({ ...q, grip: { ...q.grip, facingPolicy: policy } });
    expect(r.exact.recipientFacing).toBe(facing);
    expect(r.exact.recipientCentre.x).toBe(centreX);
  });
  it('moves only by solved captor displacement and accommodates a separately keyed larger recipient anchor', () => {
    const q = fixture();
    if (!q.anchor) throw new Error('fixture anchor absent');
    const large = paired({ ...q, recipientProfileKey: 'large-target-v2', recipientDimensions: { width: 80, height: 110 },
      anchor: { ...q.anchor, profileKey: 'large-target-v2', dimensions: { width: 80, height: 110 }, point: { x: -4, y: -9 } } });
    expect(large.exact.recipientCentre).toEqual({ x: 126, y: 189 });
    const moved = paired({ ...q, captorSolvedCentre: { x: 105.179, y: 202 } });
    expect(moved.exact.recipientCentre.x).toBeCloseTo(142.179, 9);
    expect(moved.exact.recipientCentre.y).toBe(170);
  });
  it('does not mutate snapshots or manufacture source clocks/damage/release state', () => {
    const q = fixture();
    const before = JSON.stringify(q);
    Object.freeze(q.captorSolvedCentre);
    Object.freeze(q);
    const r = paired(q);
    expect(JSON.stringify(q)).toBe(before);
    expect(r).not.toHaveProperty('damage');
    expect(r).not.toHaveProperty('framesElapsed');
    expect(r).not.toHaveProperty('release');
  });
});

describe('candidate capture identity and lifecycle gate', () => {
  it.each([
    [{ enabled: false }, 'disabled'], [{ active: false }, 'inactive-link'],
    [{ reciprocal: false }, 'nonreciprocal-link'], [{ currentCaptureId: 4 }, 'stale-capture'],
    [{ currentCaptorReset: 3 }, 'stale-reset'], [{ currentRecipientReset: 5 }, 'stale-reset'],
    [{ liveCaptorBodyId: 83 }, 'stale-body-link'], [{ liveRecipientBodyId: 83 }, 'stale-body-link'],
    [{ liveBodyIds: [12, 83] }, 'stale-body-link'], [{ liveBodyIds: [12, 48, 48] }, 'duplicate-live-body-id'],
    [{ recipientBodyId: 12, liveRecipientBodyId: 12 }, 'self-link'],
    [{ currentContext: 'cargo-held' }, 'context-mismatch'], [{ context: 'unknown' }, 'context-mismatch'],
  ] as const)('rejects inactive or stale link %j', (patch, reason) => {
    expect(resolveDonkeyKongCaptureAttachment(corrupt(patch))).toEqual(expectedInactive(reason));
  });
  it.each(['captorBodyId', 'recipientBodyId', 'liveCaptorBodyId', 'liveRecipientBodyId',
    'captureId', 'currentCaptureId', 'expectedCaptorReset', 'currentCaptorReset',
    'expectedRecipientReset', 'currentRecipientReset'])('validates integer finite live identity %s', field => {
    for (const bad of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '12'])
      expect(resolveDonkeyKongCaptureAttachment(corrupt({ [field]: bad }))).toEqual(expectedInactive('invalid-live-identity'));
  });
  it('allows Matter body zero and reset zero but requires positive capture sequence', () => {
    expect(resolveDonkeyKongCaptureAttachment(corrupt({ captureId: 0, currentCaptureId: 0 })))
      .toEqual(expectedInactive('invalid-live-identity'));
    const r = paired({ ...fixture(), captorBodyId: 0, liveCaptorBodyId: 0, liveBodyIds: [0, 48],
      expectedCaptorReset: 0, currentCaptorReset: 0 });
    expect(r.captorBodyId).toBe(0);
  });
  it('rejects malformed/sparse live participant identities, never treating holes as a valid snapshot', () => {
    const sparse: number[] = [12, 48];
    sparse.length = 3;
    for (const liveBodyIds of [undefined, null, [12, 48, NaN], [12, 48, '83'], sparse])
      expect(resolveDonkeyKongCaptureAttachment(corrupt({ liveBodyIds }))).toEqual(expectedInactive('invalid-live-identity'));
  });
  it('keeps a valid metadata context mismatch inactive rather than following a different lifecycle', () => {
    const q = fixture();
    if (!q.grip) throw new Error('fixture grip absent');
    expect(resolveDonkeyKongCaptureAttachment({ ...q, grip: { ...q.grip, context: 'cargo-held' } }))
      .toEqual(expectedInactive('context-mismatch'));
  });
});

describe('candidate safe legacy fallback for missing or malformed pose metadata', () => {
  it.each([['grip', 'missing-captor-grip'], ['anchor', 'missing-recipient-anchor']] as const)
  ('reports missing %s without returning paired coordinates', (field, reason) => {
    expect(resolveDonkeyKongCaptureAttachment(corrupt({ [field]: undefined }))).toEqual(expectedFallback(reason));
  });
  it.each(['captorPoseKey', 'captorProfileKey', 'recipientPoseKey', 'recipientProfileKey'])
  ('rejects empty or nonstring live descriptor key %s', field => {
    for (const bad of ['', '  ', undefined, null, Infinity, 12])
      expect(resolveDonkeyKongCaptureAttachment(corrupt({ [field]: bad }))).toEqual(expectedFallback('invalid-live-pose'));
  });
  it.each(['captorArtFrameIndex', 'recipientArtFrameIndex', 'captorNativeSample', 'recipientNativeSample'])
  ('rejects malformed frame/sample %s', field => {
    for (const bad of [-1, .5, NaN, Infinity, '8'])
      expect(resolveDonkeyKongCaptureAttachment(corrupt({ [field]: bad }))).toEqual(expectedFallback('invalid-live-pose'));
    if (field.endsWith('NativeSample'))
      expect(resolveDonkeyKongCaptureAttachment(corrupt({ [field]: 0 }))).toEqual(expectedFallback('invalid-live-pose'));
  });
  it.each(['grip', 'anchor'] as const)('validates all %s descriptor fields before pairing', field => {
    const q = fixture(), original = q[field];
    const reason = field === 'grip' ? 'invalid-captor-grip' : 'invalid-recipient-anchor';
    const badPatches = [{ poseKey: '' }, { profileKey: ' ' }, { poseKey: 3 }, { artFrameIndex: -.1 },
      { nativeSample: 0 }, { nativeSample: undefined }, { point: { x: NaN, y: 0 } }, { point: null },
      { dimensions: { width: 0, height: 40 } }, { dimensions: { width: 32, height: Infinity } },
      { provenance: 'native' }];
    for (const patch of badPatches)
      expect(resolveDonkeyKongCaptureAttachment(corrupt({ [field]: { ...original, ...patch } })))
        .toEqual(expectedFallback(reason));
  });
  it('rejects invalid facing policies and occlusion instead of coercing to a valid default', () => {
    const q = fixture();
    for (const policy of ['', 'unknown', undefined])
      expect(resolveDonkeyKongCaptureAttachment(corrupt({ grip: { ...q.grip, facingPolicy: policy } })))
        .toEqual(expectedFallback('invalid-captor-grip'));
    expect(resolveDonkeyKongCaptureAttachment(corrupt({ grip: { ...q.grip, occlusion: 'unknown' } })))
      .toEqual(expectedFallback('invalid-captor-grip'));
    for (const facing of [0, 2, NaN, '1']) {
      expect(resolveDonkeyKongCaptureAttachment(corrupt({ captorDrawingFacing: facing }))).toEqual(expectedFallback('invalid-facing'));
      expect(resolveDonkeyKongCaptureAttachment(corrupt({ recipientCapturedFacing: facing }))).toEqual(expectedFallback('invalid-facing'));
    }
  });
  it.each(['grip', 'anchor'] as const)('requires exact %s pose/profile/dimensions/art/native binding', field => {
    const q = fixture(), original = q[field];
    for (const patch of [{ poseKey: 'other' }, { profileKey: 'other' }, { artFrameIndex: 9 },
      { nativeSample: 99 }, { dimensions: { width: 1, height: 1 } }])
      expect(resolveDonkeyKongCaptureAttachment(corrupt({ [field]: { ...original, ...patch } })))
        .toEqual(expectedFallback('pose-or-profile-mismatch'));
  });
  it('rejects malformed live dimensions even when descriptors themselves are valid', () => {
    for (const field of ['captorDimensions', 'recipientDimensions'])
      for (const size of [undefined, { width: 0, height: 10 }, { width: 1, height: NaN }])
        expect(resolveDonkeyKongCaptureAttachment(corrupt({ [field]: size }))).toEqual(expectedFallback('invalid-live-pose'));
  });
  it('rejects invalid solved root and arithmetic overflow instead of returning nonfinite positions', () => {
    expect(resolveDonkeyKongCaptureAttachment(corrupt({ captorSolvedCentre: { x: Infinity, y: 0 } })))
      .toEqual(expectedFallback('invalid-solved-centre'));
    const q = fixture();
    expect(resolveDonkeyKongCaptureAttachment(corrupt({ captorSolvedCentre: { x: Number.MAX_VALUE, y: 0 },
      grip: { ...q.grip, point: { x: Number.MAX_VALUE, y: 0 } } }))).toEqual(expectedFallback('nonfinite-solution'));
  });
});

describe('candidate supporting floor correction and explicit calibration provenance', () => {
  it('retains exact grip solution while exposing a nonzero floor correction and residual separately', () => {
    const r = paired({ ...fixture(), floorY: 180, recipientReviewedBottom: 20, clearance: .5, floorReviewKey: 'review.floor-A' });
    expect(r.exact.recipientCentre).toEqual({ x: 137, y: 168 });
    expect(r.exact.residualDistance).toBe(0);
    expect(r.stage.status).toBe('reviewed-floor');
    if (r.stage.status !== 'reviewed-floor') throw new Error('floor discriminant absent');
    expect(r.stage.corrected).toBe(true);
    expect(r.stage.recipientCentre).toEqual({ x: 137, y: 159.5 });
    expect(r.stage.anchorWorld).toEqual({ x: 130, y: 171.5 });
    expect(r.stage.correctionWorld).toEqual({ x: 0, y: -8.5 });
    expect(r.stage.residualWorld).toEqual({ x: 0, y: -8.5 });
    expect(r.stage.residualDistance).toBe(8.5);
  });
  it('does not move a floor-clear recipient or present floor review as grip acceptance', () => {
    const r = paired({ ...fixture(), floorY: 300, recipientReviewedBottom: 20, clearance: 0, floorReviewKey: 'review.floor-A' });
    expect(r.stage.recipientCentre).toEqual({ x: 137, y: 168 });
    if (r.stage.status !== 'reviewed-floor') throw new Error('floor discriminant absent');
    expect(r.stage.corrected).toBe(false);
    expect(r.provenance.visibleGripAcceptance).toBe('not-established-by-solver');
  });
  it.each(['floorY', 'recipientReviewedBottom', 'clearance', 'floorReviewKey'])
  ('rejects partial supporting-floor tuple containing %s, even when metadata is missing', field => {
    const value = field === 'floorReviewKey' ? 'review.floor-A' : 1;
    expect(resolveDonkeyKongCaptureAttachment(corrupt({ [field]: value }))).toEqual(expectedFallback('incomplete-floor-review'));
    expect(resolveDonkeyKongCaptureAttachment(corrupt({ [field]: undefined, grip: undefined })))
      .toEqual(expectedFallback('incomplete-floor-review'));
  });
  it('rejects nonfinite/empty complete floor tuples and missing-value fields rather than ignoring them', () => {
    const tuple = { floorY: 180, recipientReviewedBottom: 20, clearance: .5, floorReviewKey: 'review.floor-A' };
    for (const patch of [{ floorY: NaN }, { floorY: undefined }, { recipientReviewedBottom: Infinity },
      { clearance: -.1 }, { clearance: NaN }, { floorReviewKey: '' }, { floorReviewKey: '  ' }])
      expect(resolveDonkeyKongCaptureAttachment(corrupt({ ...tuple, ...patch }))).toEqual(expectedFallback('invalid-floor-review'));
  });
  it('marks explicit physical-centre adapters as calibration even with zero residual', () => {
    const q = fixture();
    if (!q.anchor) throw new Error('fixture anchor absent');
    const r = paired({ ...q, anchor: { ...q.anchor, point: { x: 0, y: 0 }, provenance: 'physical-centre-beta' } });
    expect(r.exact.recipientCentre).toEqual({ x: 130, y: 180 });
    expect(r.exact.residualDistance).toBe(0);
    expect(r.provenance).toMatchObject({ recipient: 'physical-centre-beta', containsPhysicalCentreCalibration: true,
      visibleGripAcceptance: 'not-established-by-solver', nativeConstraintParity: false });
  });
  it('rejects a nonzero point labelled physical-centre instead of laundering a grip as the origin', () => {
    const q = fixture();
    expect(resolveDonkeyKongCaptureAttachment(corrupt({ anchor: { ...q.anchor, provenance: 'physical-centre-beta' } })))
      .toEqual(expectedFallback('invalid-recipient-anchor'));
    expect(paired(q).provenance.containsPhysicalCentreCalibration).toBe(false);
  });
});

// Commit freshness must carry metadata/faces, beyond coincident anchor algebra.
describe('candidate selected descriptor freshness snapshot',()=>{
 it('captures deep descriptor values and both selected faces without aliasing input',()=>{const q=fixture(),r=paired(q);expect(r.selection).toEqual({grip:q.grip,anchor:q.anchor,captorDrawingFacing:1,recipientPoseFacing:-1,captorResetGeneration:2,recipientResetGeneration:4});(q.grip!.point as {x:number}).x=999;(q.anchor!.dimensions as {width:number}).width=999;expect(r.selection.grip.point.x).toBe(30);expect(r.selection.anchor.dimensions.width).toBe(32);});
 it('zero-X anchors retain different selected faces even when geometry stays equal',()=>{const base=fixture(),q={...base,grip:{...base.grip!,point:{x:0,y:-20}},anchor:{...base.anchor!,point:{x:0,y:12}}};const a=paired(q),b=paired({...q,captorDrawingFacing:-1});expect(a.exact.recipientCentre).toEqual(b.exact.recipientCentre);expect(a.selection.captorDrawingFacing).not.toBe(b.selection.captorDrawingFacing);const c=paired({...q,recipientCapturedFacing:1});expect(a.exact.recipientCentre).toEqual(c.exact.recipientCentre);expect(a.selection.recipientPoseFacing).not.toBe(c.selection.recipientPoseFacing);});
});
