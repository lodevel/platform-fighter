/** Candidate only: project-defined target anchor calibration, not native constraints.
 * Pure spatial solve. No release/damage/input/source-clock or body mutation.
 * The caller must collect a single live snapshot and revalidate before commit.
 */
export type AttachmentVector = Readonly<{ x: number; y: number }>;
export type AttachmentFacing = 1 | -1;
export type AttachmentContext = 'ordinary-held' | 'ordinary-damage' | 'ordinary-throw'
  | 'cargo-held' | 'cargo-throw';
export type AttachmentDimensions = Readonly<{ width: number; height: number }>;
export type AttachmentProvenance = 'authored-reviewed-target' | 'physical-centre-beta';
export type AttachmentFacingPolicy = 'preserve-recipient' | 'same-as-captor-drawing'
  | 'opposite-captor-drawing';
export type AttachmentOcclusion = 'legacy-order' | 'recipient-front' | 'recipient-back';
export type AttachmentSampleBasis = 'zero-based-native-index' | 'one-based-native-frame' | 'authored-cargo-recipe-index';
export interface AttachmentAuthoredPoseIdentity {readonly recipeId:string;readonly recipeSha256:string;readonly sampleIndex:number;}

export interface CaptureAttachmentAnchor {
  readonly poseKey: string;
  readonly profileKey: string;
  readonly dimensions: AttachmentDimensions;
  readonly artFrameIndex: number;
  readonly nativeSample: number | null;
  readonly sourceSampleBasis?: AttachmentSampleBasis;
  readonly authoredPoseIdentity?: AttachmentAuthoredPoseIdentity;
  readonly point: AttachmentVector;
  readonly provenance: AttachmentProvenance;
}
export interface CaptureAttachmentGrip extends CaptureAttachmentAnchor {
  readonly context: AttachmentContext;
  readonly facingPolicy: AttachmentFacingPolicy;
  readonly occlusion: AttachmentOcclusion;
}
export interface CaptureAttachmentRequest {
  readonly enabled: boolean;
  readonly active: boolean;
  readonly reciprocal: boolean;
  readonly context: AttachmentContext;
  readonly currentContext: AttachmentContext;
  readonly captorBodyId: number;
  readonly recipientBodyId: number;
  readonly liveCaptorBodyId: number;
  readonly liveRecipientBodyId: number;
  /** Body identities of the coordinator's single live participant snapshot. */
  readonly liveBodyIds: readonly number[];
  readonly captureId: number;
  readonly currentCaptureId: number;
  readonly expectedCaptorReset: number;
  readonly currentCaptorReset: number;
  readonly expectedRecipientReset: number;
  readonly currentRecipientReset: number;
  readonly captorSolvedCentre: AttachmentVector;
  readonly captorDrawingFacing: AttachmentFacing;
  readonly recipientCapturedFacing: AttachmentFacing;
  readonly captorPoseKey: string;
  readonly captorProfileKey: string;
  readonly captorDimensions: AttachmentDimensions;
  readonly recipientPoseKey: string;
  readonly recipientProfileKey: string;
  readonly recipientDimensions: AttachmentDimensions;
  readonly captorArtFrameIndex: number;
  readonly captorNativeSample: number | null;
  readonly captorSourceSampleBasis?: AttachmentSampleBasis;
  readonly captorAuthoredPoseIdentity?: AttachmentAuthoredPoseIdentity;
  readonly recipientArtFrameIndex: number;
  readonly recipientNativeSample: number | null;
  readonly recipientSourceSampleBasis?: AttachmentSampleBasis;
  readonly recipientAuthoredPoseIdentity?: AttachmentAuthoredPoseIdentity;
  readonly grip?: CaptureAttachmentGrip;
  readonly anchor?: CaptureAttachmentAnchor;
  /** All four fields required together; supporting floor was separately reviewed. */
  readonly floorY?: number;
  readonly recipientReviewedBottom?: number;
  readonly clearance?: number;
  readonly floorReviewKey?: string;
}
export type AttachmentInactiveReason = 'disabled' | 'inactive-link' | 'nonreciprocal-link'
  | 'invalid-live-identity' | 'self-link' | 'duplicate-live-body-id' | 'stale-body-link'
  | 'stale-capture' | 'stale-reset' | 'context-mismatch';
export type AttachmentFallbackReason = 'missing-captor-grip' | 'missing-recipient-anchor'
  | 'invalid-live-pose' | 'invalid-captor-grip' | 'invalid-recipient-anchor'
  | 'invalid-facing' | 'invalid-solved-centre' | 'pose-or-profile-mismatch'
  | 'incomplete-floor-review' | 'invalid-floor-review' | 'nonfinite-solution';

export interface ExactCaptureAttachmentSolution {
  readonly recipientCentre: AttachmentVector;
  readonly recipientFacing: AttachmentFacing;
  readonly gripWorld: AttachmentVector;
  readonly anchorWorld: AttachmentVector;
  readonly residualWorld: AttachmentVector;
  readonly residualDistance: number;
}
export type CaptureAttachmentStageResult = Readonly<{
  status: 'unconstrained'; recipientCentre: AttachmentVector; anchorWorld: AttachmentVector;
  correctionWorld: AttachmentVector; residualWorld: AttachmentVector; residualDistance: number;
}> | Readonly<{
  status: 'reviewed-floor'; reviewKey: string; corrected: boolean;
  recipientCentre: AttachmentVector; anchorWorld: AttachmentVector;
  correctionWorld: AttachmentVector; residualWorld: AttachmentVector; residualDistance: number;
}>;
export type CaptureAttachmentResult = Readonly<{ status: 'inactive'; reason: AttachmentInactiveReason }>
  | Readonly<{ status: 'fallback'; mode: 'legacy-fixed-centre'; reason: AttachmentFallbackReason }>
  | Readonly<{
    status: 'paired'; context: AttachmentContext; captureId: number;
    captorBodyId: number; recipientBodyId: number;
    exact: ExactCaptureAttachmentSolution; stage: CaptureAttachmentStageResult;
    occlusion: AttachmentOcclusion;
    /** Defensive selected-pose snapshot, not merely equal world-space algebra. */
    selection: Readonly<{grip:CaptureAttachmentGrip;anchor:CaptureAttachmentAnchor;captorDrawingFacing:AttachmentFacing;recipientPoseFacing:AttachmentFacing;captorResetGeneration:number;recipientResetGeneration:number}>;
    provenance: Readonly<{
      captor: AttachmentProvenance; recipient: AttachmentProvenance;
      containsPhysicalCentreCalibration: boolean;
      spatialPolicy: 'project-target-anchor-calibration';
      /** Algebraic alignment cannot qualify the pixels or a native grip. */
      visibleGripAcceptance: 'not-established-by-solver'; nativeConstraintParity: false;
    }>;
  }>;

const CONTEXTS: readonly string[] = ['ordinary-held', 'ordinary-damage', 'ordinary-throw', 'cargo-held', 'cargo-throw'];
const FACING_POLICIES: readonly string[] = ['preserve-recipient', 'same-as-captor-drawing', 'opposite-captor-drawing'];
const OCCLUSIONS: readonly string[] = ['legacy-order', 'recipient-front', 'recipient-back'];
const key = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const integer = (v: unknown, minimum = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= minimum;
const face = (v: unknown): v is AttachmentFacing => v === 1 || v === -1;
const vector = (v: unknown): v is AttachmentVector => !!v && typeof v === 'object'
  && Number.isFinite((v as AttachmentVector).x) && Number.isFinite((v as AttachmentVector).y);
const dimensions = (v: unknown): v is AttachmentDimensions => !!v && typeof v === 'object'
  && Number.isFinite((v as AttachmentDimensions).width) && (v as AttachmentDimensions).width > 0
  && Number.isFinite((v as AttachmentDimensions).height) && (v as AttachmentDimensions).height > 0;
export function validAttachmentAuthoredPoseIdentity(v:unknown):v is AttachmentAuthoredPoseIdentity {
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const row=v as Record<string,unknown>;
  return Object.keys(row).length===3&&key(row.recipeId)&&typeof row.recipeSha256==='string'&&/^[a-f0-9]{64}$/.test(row.recipeSha256)&&integer(row.sampleIndex);
}
export function sameAttachmentAuthoredPoseIdentity(a:AttachmentAuthoredPoseIdentity|undefined,b:AttachmentAuthoredPoseIdentity|undefined):boolean {
  return a===undefined&&b===undefined||!!a&&!!b&&a.recipeId===b.recipeId&&a.recipeSha256===b.recipeSha256&&a.sampleIndex===b.sampleIndex;
}
const basis = (v: unknown): boolean => v === undefined || v === 'zero-based-native-index' || v === 'one-based-native-frame' || v==='authored-cargo-recipe-index';
const sample = (v: unknown, sourceBasis?: AttachmentSampleBasis, authoredIdentity?:AttachmentAuthoredPoseIdentity): v is number | null =>
  basis(sourceBasis) && (sourceBasis==='authored-cargo-recipe-index'?v===null&&validAttachmentAuthoredPoseIdentity(authoredIdentity):
    authoredIdentity===undefined&&(v === null || integer(v, sourceBasis === 'zero-based-native-index' ? 0 : 1)));
const context = (v: unknown): v is AttachmentContext => typeof v === 'string' && CONTEXTS.includes(v);
function validAnchor(a: CaptureAttachmentAnchor): boolean {
  return !!a && key(a.poseKey) && key(a.profileKey) && dimensions(a.dimensions)
    && integer(a.artFrameIndex) && sample(a.nativeSample, a.sourceSampleBasis,a.authoredPoseIdentity) && vector(a.point)
    && (a.provenance === 'authored-reviewed-target' || a.provenance === 'physical-centre-beta')
    // A named physical-centre adapter is exactly the origin, never a disguised grip.
    && (a.provenance !== 'physical-centre-beta' || (a.point.x === 0 && a.point.y === 0));
}
function matchingPose(a: CaptureAttachmentAnchor, pose: string, profile: string,
  size: AttachmentDimensions, art: number, native: number | null, sourceBasis?: AttachmentSampleBasis, authoredIdentity?:AttachmentAuthoredPoseIdentity): boolean {
  return a.poseKey === pose && a.profileKey === profile && a.artFrameIndex === art
    && a.nativeSample === native && (a.sourceSampleBasis ?? 'one-based-native-frame') === (sourceBasis ?? 'one-based-native-frame')
    && sameAttachmentAuthoredPoseIdentity(a.authoredPoseIdentity,authoredIdentity)
    && a.dimensions.width === size.width && a.dimensions.height === size.height;
}
const fallback = (reason: AttachmentFallbackReason): CaptureAttachmentResult =>
  ({ status: 'fallback', mode: 'legacy-fixed-centre', reason });
const inactive = (reason: AttachmentInactiveReason): CaptureAttachmentResult => ({ status: 'inactive', reason });

export function resolveDonkeyKongCaptureAttachment(q: CaptureAttachmentRequest): CaptureAttachmentResult {
  if (q.enabled !== true) return inactive('disabled');
  if (q.active !== true) return inactive('inactive-link');
  if (q.reciprocal !== true) return inactive('nonreciprocal-link');
  const ids = [q.captorBodyId, q.recipientBodyId, q.liveCaptorBodyId, q.liveRecipientBodyId,
    q.expectedCaptorReset, q.currentCaptorReset, q.expectedRecipientReset, q.currentRecipientReset];
  if (!ids.every(v => integer(v)) || !integer(q.captureId, 1) || !integer(q.currentCaptureId, 1)
    || !Array.isArray(q.liveBodyIds) || !Array.from(q.liveBodyIds).every(v => integer(v))) return inactive('invalid-live-identity');
  if (q.captorBodyId === q.recipientBodyId) return inactive('self-link');
  if (new Set(q.liveBodyIds).size !== q.liveBodyIds.length) return inactive('duplicate-live-body-id');
  if (q.captorBodyId !== q.liveCaptorBodyId || q.recipientBodyId !== q.liveRecipientBodyId
    || !q.liveBodyIds.includes(q.liveCaptorBodyId) || !q.liveBodyIds.includes(q.liveRecipientBodyId)) return inactive('stale-body-link');
  if (q.captureId !== q.currentCaptureId) return inactive('stale-capture');
  if (q.expectedCaptorReset !== q.currentCaptorReset || q.expectedRecipientReset !== q.currentRecipientReset)
    return inactive('stale-reset');
  if (!context(q.context) || q.context !== q.currentContext) return inactive('context-mismatch');
  if (!vector(q.captorSolvedCentre)) return fallback('invalid-solved-centre');
  if (!face(q.captorDrawingFacing) || !face(q.recipientCapturedFacing)) return fallback('invalid-facing');
  if (![q.captorPoseKey, q.captorProfileKey, q.recipientPoseKey, q.recipientProfileKey].every(key)
    || !dimensions(q.captorDimensions) || !dimensions(q.recipientDimensions)
    || !integer(q.captorArtFrameIndex) || !integer(q.recipientArtFrameIndex)
    || !sample(q.captorNativeSample, q.captorSourceSampleBasis,q.captorAuthoredPoseIdentity) || !sample(q.recipientNativeSample, q.recipientSourceSampleBasis,q.recipientAuthoredPoseIdentity)) return fallback('invalid-live-pose');

  // Validate a requested stage tuple even when anchor metadata is missing.
  const floorKeys = ['floorY', 'recipientReviewedBottom', 'clearance', 'floorReviewKey'] as const;
  const hasFloor = floorKeys.some(k => k in q);
  if (hasFloor && !floorKeys.every(k => Object.prototype.hasOwnProperty.call(q, k))) return fallback('incomplete-floor-review');
  if (hasFloor && (!Number.isFinite(q.floorY) || !Number.isFinite(q.recipientReviewedBottom)
    || !Number.isFinite(q.clearance) || (q.clearance as number) < 0 || !key(q.floorReviewKey))) return fallback('invalid-floor-review');

  const g = q.grip, a = q.anchor;
  if (!g) return fallback('missing-captor-grip');
  if (!a) return fallback('missing-recipient-anchor');
  if (!validAnchor(g) || !context(g.context) || !FACING_POLICIES.includes(g.facingPolicy)
    || !OCCLUSIONS.includes(g.occlusion)) return fallback('invalid-captor-grip');
  if (!validAnchor(a)) return fallback('invalid-recipient-anchor');
  if (g.context !== q.context) return inactive('context-mismatch');
  if (!matchingPose(g, q.captorPoseKey, q.captorProfileKey, q.captorDimensions, q.captorArtFrameIndex, q.captorNativeSample, q.captorSourceSampleBasis,q.captorAuthoredPoseIdentity)
    || !matchingPose(a, q.recipientPoseKey, q.recipientProfileKey, q.recipientDimensions, q.recipientArtFrameIndex, q.recipientNativeSample, q.recipientSourceSampleBasis,q.recipientAuthoredPoseIdentity))
    return fallback('pose-or-profile-mismatch');

  const recipientFacing: AttachmentFacing = g.facingPolicy === 'preserve-recipient' ? q.recipientCapturedFacing
    : g.facingPolicy === 'same-as-captor-drawing' ? q.captorDrawingFacing : q.captorDrawingFacing === 1 ? -1 : 1;
  const gripWorld = { x: q.captorSolvedCentre.x + g.point.x * q.captorDrawingFacing, y: q.captorSolvedCentre.y + g.point.y };
  const desired = { x: gripWorld.x - a.point.x * recipientFacing, y: gripWorld.y - a.point.y };
  const exactAnchor = { x: desired.x + a.point.x * recipientFacing, y: desired.y + a.point.y };
  const exactResidual = { x: exactAnchor.x - gripWorld.x, y: exactAnchor.y - gripWorld.y };
  const exact: ExactCaptureAttachmentSolution = { recipientCentre: desired, recipientFacing, gripWorld,
    anchorWorld: exactAnchor, residualWorld: exactResidual, residualDistance: Math.hypot(exactResidual.x, exactResidual.y) };
  const centre = { ...desired };
  if (hasFloor) centre.y = Math.min(centre.y, (q.floorY as number) - (q.recipientReviewedBottom as number) - (q.clearance as number));
  const actualAnchor = { x: centre.x + a.point.x * recipientFacing, y: centre.y + a.point.y };
  const correction = { x: centre.x - desired.x, y: centre.y - desired.y };
  const residual = { x: actualAnchor.x - gripWorld.x, y: actualAnchor.y - gripWorld.y };
  if (![gripWorld, desired, exactAnchor, exactResidual, centre, actualAnchor, correction, residual].every(vector)
    || !Number.isFinite(exact.residualDistance) || !Number.isFinite(Math.hypot(residual.x, residual.y))) return fallback('nonfinite-solution');
  const stageFields = { recipientCentre: centre, anchorWorld: actualAnchor, correctionWorld: correction,
    residualWorld: residual, residualDistance: Math.hypot(residual.x, residual.y) };
  const stage: CaptureAttachmentStageResult = hasFloor
    ? { status: 'reviewed-floor', reviewKey: q.floorReviewKey as string, corrected: correction.x !== 0 || correction.y !== 0, ...stageFields }
    : { status: 'unconstrained', ...stageFields };
  return { status: 'paired', context: q.context, captureId: q.captureId, captorBodyId: q.captorBodyId,
    recipientBodyId: q.recipientBodyId, exact, stage, occlusion: g.occlusion,
    selection:{captorResetGeneration:q.currentCaptorReset,recipientResetGeneration:q.currentRecipientReset,captorDrawingFacing:q.captorDrawingFacing,recipientPoseFacing:q.recipientCapturedFacing,grip:{...g,dimensions:{...g.dimensions},point:{...g.point},...(g.authoredPoseIdentity?{authoredPoseIdentity:{...g.authoredPoseIdentity}}:{})},anchor:{...a,dimensions:{...a.dimensions},point:{...a.point},...(a.authoredPoseIdentity?{authoredPoseIdentity:{...a.authoredPoseIdentity}}:{})}},
    provenance: { captor: g.provenance, recipient: a.provenance,
      containsPhysicalCentreCalibration: g.provenance === 'physical-centre-beta' || a.provenance === 'physical-centre-beta',
      spatialPolicy: 'project-target-anchor-calibration', visibleGripAcceptance: 'not-established-by-solver', nativeConstraintParity: false } };
}
