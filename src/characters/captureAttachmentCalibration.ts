import type { CaptureAttachmentAnchor, CaptureAttachmentGrip, AttachmentContext } from './donkeykongCaptureAttachment';
import {validAttachmentAuthoredPoseIdentity,sameAttachmentAuthoredPoseIdentity} from './donkeykongCaptureAttachment';

/** Runtime-only authored data; transporting it never accepts art/native constraints. */
export interface CaptureAttachmentCalibration {
  readonly sourceSampleBasis?:import('./donkeykongCaptureAttachment').AttachmentSampleBasis;
  readonly profileKey: string;
  readonly revision: string;
  readonly grips?: readonly CaptureAttachmentGrip[];
  readonly anchors?: readonly (CaptureAttachmentAnchor & { readonly context: AttachmentContext })[];
  /** Explicit origin-only adapter; no implicit recipient-centre default. */
  readonly physicalCentreContexts?: readonly AttachmentContext[];
  readonly supportingFloor?: Readonly<{ reviewKey: string; recipientReviewedBottom: number; clearance: number }>;
}
const contexts: readonly string[] = ['ordinary-held','ordinary-damage','ordinary-throw','cargo-held','cargo-throw'];
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const key = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const integer = (v: unknown, min=0) => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
export function parseCaptureAttachmentCalibration(raw: unknown, label: string): CaptureAttachmentCalibration {
  const fail = (field: string): never => { throw new Error(`${label}.${field}: invalid capture attachment calibration`); };
  if (!object(raw) || !key(raw.profileKey) || !key(raw.revision)) return fail('profile');
  if(raw.sourceSampleBasis!==undefined&&raw.sourceSampleBasis!=='zero-based-native-index'&&raw.sourceSampleBasis!=='one-based-native-frame'&&raw.sourceSampleBasis!=='authored-cargo-recipe-index')return fail('sourceSampleBasis');
  for (const kind of ['grips', 'anchors'] as const) {
    const rows = raw[kind];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) return fail(kind);
    const selectors = new Set<string>();
    for (const row of rows) {
      if (object(row) && row.sourceSampleBasis !== undefined && row.sourceSampleBasis !== (raw.sourceSampleBasis ?? 'one-based-native-frame'))
        return fail(`${kind}.sourceSampleBasis`);
      if (!object(row) || !key(row.poseKey) || row.profileKey !== raw.profileKey || !object(row.dimensions)
        || typeof row.dimensions.width !== 'number' || !Number.isFinite(row.dimensions.width) || row.dimensions.width <= 0
        || typeof row.dimensions.height !== 'number' || !Number.isFinite(row.dimensions.height) || row.dimensions.height <= 0
        || !integer(row.artFrameIndex) || !(raw.sourceSampleBasis==='authored-cargo-recipe-index'?
          row.nativeSample===null&&validAttachmentAuthoredPoseIdentity(row.authoredPoseIdentity):
          row.authoredPoseIdentity===undefined&&(row.nativeSample === null || integer(row.nativeSample,raw.sourceSampleBasis==='zero-based-native-index'?0:1)))
        || !object(row.point) || typeof row.point.x !== 'number' || typeof row.point.y !== 'number'
        || !Number.isFinite(row.point.x) || !Number.isFinite(row.point.y)
        || (typeof row.context !== 'string' || !contexts.includes(row.context))
        || (typeof row.provenance !== 'string' || !['authored-reviewed-target','physical-centre-beta'].includes(row.provenance))) return fail(kind);
      if (row.provenance === 'physical-centre-beta' && (row.point.x !== 0 || row.point.y !== 0)) return fail(`${kind}.origin`);
      if (kind === 'grips' && ((typeof row.facingPolicy !== 'string' || !['preserve-recipient','same-as-captor-drawing','opposite-captor-drawing'].includes(row.facingPolicy))
        || (typeof row.occlusion !== 'string' || !['legacy-order','recipient-front','recipient-back'].includes(row.occlusion)))) return fail(`${kind}.policy`);
      const selector = JSON.stringify([row.context,row.poseKey,row.artFrameIndex,row.nativeSample,row.authoredPoseIdentity]);
      if (selectors.has(selector)) return fail(`${kind}.duplicate-selector`);
      selectors.add(selector);
    }
  }
  if (raw.physicalCentreContexts !== undefined && (!Array.isArray(raw.physicalCentreContexts)
    || Array.from(raw.physicalCentreContexts).some(c => typeof c !== 'string' || !contexts.includes(c))
    || new Set(raw.physicalCentreContexts).size !== raw.physicalCentreContexts.length)) return fail('physicalCentreContexts');
  if(raw.sourceSampleBasis==='authored-cargo-recipe-index'&&raw.physicalCentreContexts!==undefined)return fail('authoredPhysicalCentreFallback');
  if (raw.supportingFloor !== undefined) {
    const f=raw.supportingFloor;
    if (!object(f) || !key(f.reviewKey) || typeof f.recipientReviewedBottom !== 'number' || !Number.isFinite(f.recipientReviewedBottom)
      || typeof f.clearance !== 'number' || !Number.isFinite(f.clearance) || f.clearance < 0) return fail('supportingFloor');
  }
  // Defensive owned copy: no caller mutation can silently revise accepted selectors.
  const parsed = JSON.parse(JSON.stringify(raw)) as CaptureAttachmentCalibration;
  return {...parsed,
    ...(parsed.grips ? {grips:parsed.grips.map(row=>({...row,sourceSampleBasis:parsed.sourceSampleBasis ?? 'one-based-native-frame'}))} : {}),
    ...(parsed.anchors ? {anchors:parsed.anchors.map(row=>({...row,sourceSampleBasis:parsed.sourceSampleBasis ?? 'one-based-native-frame'}))} : {})};
}

/** Reads the existing selected body phase. Its authored display duration is
 * owned by resolveSimulationAction, not a new native damage timer here.
 */
export function captureAttachmentContextFromBody(cargo:boolean, throwing:boolean,
  selectedRecipientBodyState:string):AttachmentContext {
  if(cargo)return throwing?'cargo-throw':'cargo-held';
  if(throwing)return 'ordinary-throw';
  return selectedRecipientBodyState==='captured_hit'?'ordinary-damage':'ordinary-held';
}
export type CaptureAttachmentAnchorSelection =
  | {status:'explicit'|'physical-centre';anchor:CaptureAttachmentAnchor & {context:AttachmentContext}}
  | {status:'missing'} | {status:'invalid';reason:string};
export function selectCaptureAttachmentAnchor(calibration:CaptureAttachmentCalibration|null,
  pose:{context:AttachmentContext;poseKey:string;artFrameIndex:number|undefined;nativeSample:number|null;
    authoredPoseIdentity?:import('./donkeykongCaptureAttachment').AttachmentAuthoredPoseIdentity;
    dimensions:{width:number;height:number}}):CaptureAttachmentAnchorSelection {
  if(!calibration)return {status:'missing'};
  let data:CaptureAttachmentCalibration;
  try{data=parseCaptureAttachmentCalibration(calibration,'liveAttachmentCalibration');}
  catch{return {status:'invalid',reason:'invalid-explicit-attachment-calibration'};}
  // A configured explicit context may never be masked by the origin adapter:
  // a missing current sample, malformed or duplicate row remains a coverage gap.
  // An anchor marks where the recipient's own drawing is held, so a carried
  // recipient without cargo rows uses its held rows for the same drawing,
  // while carried and through a cargo throw until its release.
  const rows=(context:AttachmentContext)=>(data.anchors??[]).filter(row=>row.context===context);
  const carried=pose.context==='cargo-held'||pose.context==='cargo-throw';
  // A carried recipient drawn with its own cargo rows (DK's cargo_recipient_* drawings) resolves those; any other pose keeps its held rows.
  const ownRows=rows(pose.context).some(row=>row.poseKey===pose.poseKey);
  const explicit=ownRows||!carried?rows(pose.context):rows('ordinary-held');
  if(explicit.length){
    const matches=explicit.filter(row=>row.poseKey===pose.poseKey&&row.artFrameIndex===pose.artFrameIndex&&row.nativeSample===pose.nativeSample&&
      sameAttachmentAuthoredPoseIdentity(row.authoredPoseIdentity,pose.authoredPoseIdentity));
    if(matches.length!==1)return {status:'invalid',reason:'missing-or-duplicate-explicit-recipient-anchor'};
    const row=matches[0]!;
    if(row.dimensions.width!==pose.dimensions.width||row.dimensions.height!==pose.dimensions.height)
      return {status:'invalid',reason:'explicit-recipient-anchor-dimension-mismatch'};
    return {status:'explicit',anchor:row};
  }
  if(!data.physicalCentreContexts?.includes(pose.context))return {status:'missing'};
  return {status:'physical-centre',anchor:{poseKey:pose.poseKey,profileKey:data.profileKey,context:pose.context,
    dimensions:{...pose.dimensions},artFrameIndex:pose.artFrameIndex??0,nativeSample:pose.nativeSample,
    sourceSampleBasis:data.sourceSampleBasis ?? 'one-based-native-frame',
    point:{x:0,y:0},provenance:'physical-centre-beta'}};
}
