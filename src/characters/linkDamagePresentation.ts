/** Actual flinch -> captured motion adapter. Pinned thresholds are hitstun
 * frames, never percent. Native MotionKindSub height/repeat-RNG and roll entry
 * remain unrecovered; the anatomical/equality/boundary adapters are explicit. */
import type {SourceDamagePresentationReceipt} from './sourceDamagePresentationReceipt';
export type LinkDamageHeight='hi'|'n'|'lw';
const HIGH=new Set(['head','neck']);
const LOW=new Set(['thigh-L','shin-L','foot-L','thigh-R','shin-R','foot-R']);
const MIDDLE=new Set(['torso','upper-arm-L','forearm-L','hand-L','palm-L','upper-arm-R','forearm-R','hand-R','palm-R']);
/** Current paired anatomy uses an exact semantic stem plus a numeric primitive
 * ordinal. The ordinal distinguishes surfaces, never their voting weight.
 * Unknown/cosmetic names stay unknown; no broad head/foot prefix inference. */
export function linkReceivingRegionIdHeight(id:string):LinkDamageHeight|null {
  const match=/^(.+)-(0|[1-9][0-9]*)$/.exec(id);
  const stem=match&&Number.isSafeInteger(Number(match[2]))?match[1]!:id;
  if(stem==='head-contour'||HIGH.has(stem))return 'hi';
  if(LOW.has(stem))return 'lw';
  return MIDDLE.has(stem)?'n':null;
}
export function linkActualReceivingHeight(receipt:SourceDamagePresentationReceipt):
  {readonly height:LinkDamageHeight;readonly producer:'source-equal-root-override'|'unanimous-anatomical-region'|'mixed-or-unavailable-neutral'} {
  const context=receipt.attackHeightContext;
  // Public evidence says approximately equal height but supplies no tolerance.
  // Exact source-ROOT equality is our conservative adapter, not its native test.
  if(receipt.nativeAttackHeight&&context&&context.attackerRootY===context.victimRootY)
    return {height:receipt.nativeAttackHeight==='high'?'hi':'lw',producer:'source-equal-root-override'};
  const heights=new Set<LinkDamageHeight>();let unknown=false;
  for(const region of receipt.receivingRegions??[]) {
    const height=linkReceivingRegionIdHeight(region.id);
    if(height===null)unknown=true;else heights.add(height);
  }
  // Preserve every actual overlap; array order and outgoing capsule midpoint
  // never select a victim band. Cross-band contact uses an authored neutral.
  return !unknown&&heights.size===1?{height:[...heights][0]!,producer:'unanimous-anatomical-region'}:
    {height:'n',producer:'mixed-or-unavailable-neutral'};
}
export function selectLinkDamagePresentation(receipt:SourceDamagePresentationReceipt|null,
  observation:{readonly localStop?:boolean;readonly nativeLaunchAngleRadians:number|null}):
  {readonly motion:string;readonly rawAge:number;readonly facing:1|-1;readonly terminal:true;
    readonly heightProducer:ReturnType<typeof linkActualReceivingHeight>['producer']}|null {
  if(!receipt)return null;
  if(observation.localStop!==undefined&&typeof observation.localStop!=='boolean'||observation.nativeLaunchAngleRadians!==null&&
    !Number.isFinite(observation.nativeLaunchAngleRadians))throw new TypeError('Malformed actual damage selector observation');
  const height=linkActualReceivingHeight(receipt),tier=receipt.initialHitstunFrames>=21?3:receipt.initialHitstunFrames>=15?2:1;
  let motion:string;
  // A generic stop (including the compatibility localStop observation) cannot
  // admit electrical art. Only this accepted victim-flinch owns its clock.
  const electric=receipt.electric&&receipt.ownElectricStop;
  if(electric)motion='damage_elec';
  else if(receipt.tumbleAtAdmission) {
    const angle=observation.nativeLaunchAngleRadians;
    const normalized=angle===null?null:angle>=0&&angle<2*Math.PI?angle:((angle%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
    // Meteor inclusive range is a selected adapter from annotated parameters
    // and a primary mod IS_SPIKE hook, not full vanilla motion-caller proof.
    motion=normalized!==null&&normalized>=230*Math.PI/180&&normalized<=310*Math.PI/180?'damage_fly_meteor':
      normalized!==null&&normalized>1.22173&&normalized<1.91986?'damage_fly_top':`damage_fly_${height.height}`;
  } else motion=receipt.groundedAtEntry?`damage_${height.height}_${tier}`:`damage_air_${tier}`;
  return Object.freeze({motion,rawAge:electric?receipt.electricStopFramesElapsed:receipt.framesElapsed,
    facing:receipt.entryFacing,terminal:true,heightProducer:height.producer});
}
