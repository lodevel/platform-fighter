"""Stage exact source-age selectors/root deltas; never installs or qualifies consumers."""
from pathlib import Path
import json,hashlib,sys,yaml
from PIL import Image,ImageDraw
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from pikachu_native_pose import PikachuNativePose,MOTIONS
ROOT=Path(__file__).resolve().parent.parent
B=ROOT/'docs/review/2026-10-06/pikachu-character'
OUT=B/'art/completion-states-family-audit'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
audit=json.loads((OUT/'existing-family-audit.json').read_text())
assert audit['actualImagesReviewed']
frames=json.loads((ROOT/'assets/characters/pikachu/frames.json').read_text())
contract=json.loads((B/'sources/state-runtime-clock-contract.json').read_text())
motionList=yaml.safe_load((B/'sources/motion-list.yml').read_text())['list']
sources=[B/'sources/full-body-native-review/tiled-receiving'/f for f in ['ledge-getup-candidates.json','reactions-misc-candidates.json']]
receiving=[(p,r) for p in sources for r in json.loads(p.read_text())['rows']]
profiles={};provenance=[]
for row in audit['rows']:
 sheet=row['sheet'];clip=frames['animations'][sheet]
 assert sha(ROOT/'assets/characters/pikachu'/clip['strip'])==row['stripSha256']
 action=next(a for a in contract['actions'] if a['sheet']==sheet)
 pose=PikachuNativePose(MOTIONS/(action['sourceMotion']+'.nuanmb'))
 path=[]
 for frame in range(int(pose.animation.final_frame_index)+1):
  point=pose.matrices(frame,['Trans'])['Trans']@np.array([0,0,0,1])
  path.append({'x':float(point[2])*5,'y':-float(point[1])*5})
 origin=path[0];deltas=[{'x':p['x']-origin['x'],'y':p['y']-origin['y']} for p in path]
 drawings=[];gallery=Image.new('RGBA',(512*len(clip['sourceCells']),640),'#e4e3df');atlas=Image.open(ROOT/'assets/characters/pikachu'/clip['strip']).convert('RGBA')
 for window in action['nativeWindows']:
  i=window['artFrameIndex'];sample=clip['nativeSampleIndices'][i]
  receivingPath,candidate=next((p,r) for p,r in receiving if r['sheet']==sheet and r['artFrameIndex']==i)
  assert candidate['nativeSample']==sample and len(candidate['hurtboxes'])==12
  drawings.append({'start':window['nativeStart'],'end':window['nativeEnd'],'artFrameIndex':i,'nativeSample':sample,'hurtboxes':candidate['hurtboxes']})
  col,cellrow=clip['sourceCells'][i];w,h=clip['frameWidth'],clip['frameHeight'];body=atlas.crop((col*w,cellrow*h,(col+1)*w,(cellrow+1)*h));panel=Image.new('RGBA',(512,640),'#e4e3df');panel.alpha_composite(body);draw=ImageDraw.Draw(panel)
  for box in candidate['hurtboxes']:
   c=box['capsule'];points=[(256+p['x']/(70/150),416+(p['y']-25)/(70/150)) for p in [c['start'],c['end']]];radius=c['radius']/(70/150)
   for x,y in points:draw.ellipse((x-radius,y-radius,x+radius,y+radius),outline='#13798b',width=2)
   draw.line(points,fill='#13798b',width=2)
  draw.line((0,416,512,416),fill='red');draw.text((8,15),f'{sheet}/{i} native{sample}',fill='black');gallery.alpha_composite(panel,(512*i,0))
 gallery.save(OUT/(sheet+'-paired-source-review.png'))
 extra=motionList[action['motionListEntries'][0]]['extra'];sourceStatus={'cancelFrame':extra['cancel_frame'] or None,'intangibilityStartFrame':extra['xlu_start'] or None,'intangibilityEndExclusive':extra['xlu_end'] or None}
 profiles[sheet]={'endExclusive':int(pose.animation.final_frame_index)+1,'drawings':drawings,'sourceRootDelta':deltas,'sourceStatus':sourceStatus,'sourceLoop':action['nativeLoopFlag'],'loopFrames':int(pose.animation.final_frame_index) if action['nativeLoopFlag'] else None}
 provenance.append({'sheet':sheet,'motion':pose.provenance(),'stripSha256':row['stripSha256'],'sourceStatus':sourceStatus,'sourceRootEntry':origin,'sourceRootLast':path[-1],'sourceRootDeltaBounds':{'x':[min(p['x'] for p in deltas),max(p['x'] for p in deltas)],'y':[min(p['y'] for p in deltas),max(p['y'] for p in deltas)]},'receivingSources':{str(p.relative_to(ROOT)):sha(p) for p,r in receiving if r['sheet']==sheet},'review':str((OUT/(sheet+'-paired-source-review.png')).relative_to(ROOT))})
header='''/** Accepted source art selected by an explicit authored native-age clock.
 * This pure contract owns no input, gameplay commitment, immunity or physics.
 * Caller maps action age to native age and freezes that clock in pause/hitlag.
 * Source-root delta is BODY CENTRE world space, X for facing-right; apply facing
 * once in the physical owner. Sparse drawing receiving excludes source Trans.
 * Common native status rates/selectors remain unknown. Wall-jump art comes
 * from passive-wall-jump; entry comes from match-entry, not native Rebirth.
 * Provenance: art/completion-states-family-audit/auxiliary-source-contract.json.
 */
import type { Hurtbox } from './moveSchema';
type SourceCapsule = Hurtbox & { readonly capsule: NonNullable<Hurtbox['capsule']> };
export interface PikachuAuxiliarySourceStatus {
  /** First actionable source cancel frame; null means common status unresolved. */
  readonly cancelFrame: number | null;
  /** Source one-based inclusive start / exclusive end; null means absent extra. */
  readonly intangibilityStartFrame: number | null;
  readonly intangibilityEndExclusive: number | null;
}
interface SourceProfile {
  readonly endExclusive: number;
  readonly drawings: readonly { readonly start: number; readonly end: number;
    readonly artFrameIndex: number; readonly nativeSample: number;
    readonly hurtboxes: readonly SourceCapsule[] }[];
  readonly sourceRootDelta: readonly { readonly x: number; readonly y: number }[];
  readonly sourceStatus: PikachuAuxiliarySourceStatus;
  readonly sourceLoop: boolean;
  readonly loopFrames: number | null;
}
'''
body='const profiles: Readonly<Record<string, SourceProfile>> = '+json.dumps(profiles,separators=(',',':'))+';\n'
footer='export type PikachuAuxiliaryBodySheet = '+' | '.join(repr(k) for k in profiles)+';\n'+'''
export interface PikachuAuxiliaryBodyPose {
  readonly artFrameIndex: number;
  readonly nativeSample: number;
  readonly sourceRootDelta: { readonly x: number; readonly y: number };
  readonly hurtboxes: readonly SourceCapsule[];
}
export function selectPikachuAuxiliaryBody(sheet: string, nativeAge: number): PikachuAuxiliaryBodyPose | null {
  if (!Object.prototype.hasOwnProperty.call(profiles, sheet) || !Number.isFinite(nativeAge) || nativeAge < 0) return null;
  const profile = profiles[sheet as PikachuAuxiliaryBodySheet];
  if (!profile) return null;
  const age = profile.loopFrames ? nativeAge % profile.loopFrames : nativeAge;
  if (age >= profile.endExclusive) return null;
  const drawing = profile.drawings.find(row => row.start <= age && age < row.end);
  const delta = profile.sourceRootDelta[Math.floor(age)];
  if (!drawing || !delta) return null;
  return { artFrameIndex: drawing.artFrameIndex, nativeSample: drawing.nativeSample,
    sourceRootDelta: delta, hurtboxes: drawing.hurtboxes };
}
export function pikachuAuxiliaryBodyEndExclusive(sheet: string): number | null {
  return Object.prototype.hasOwnProperty.call(profiles, sheet) ? profiles[sheet]?.endExclusive ?? null : null;
}
export function pikachuAuxiliarySourceStatus(sheet: string): PikachuAuxiliarySourceStatus | null {
  return Object.prototype.hasOwnProperty.call(profiles, sheet) ? profiles[sheet]?.sourceStatus ?? null : null;
}
/** Native loop endpoint stays in source pack but is excluded from playback. */
export function pikachuAuxiliaryBodyLoopFrames(sheet: string): number | null {
  return Object.prototype.hasOwnProperty.call(profiles, sheet) ? profiles[sheet]?.loopFrames ?? null : null;
}
/** Captured fighter parameters in native units; multiply spatial values by
 * referencePixelsPerUnit only in the engine owner. Common status conditions,
 * kinetic integration and footstool impulse basis remain authored choices. */
export const PIKACHU_AUXILIARY_SOURCE_PARAMETERS = Object.freeze({
  referencePixelsPerUnit: 5, wallJumpEnabled: true,
  passiveWallJumpSpeedX: 1.3, passiveWallJumpSpeedY: 2.6,
  wallJumpEnableSpeedX: 0.2, passiveWallSpeedX: 0.5, passiveCeilingSpeedX: 0.8,
  footstoolJumpSpeedYMultiplier: 1.3, footstoolMiniJumpSpeedYMultiplier: 0.7,
  footstoolFallRecoveryFrames: 37, footstoolRangeOffsetY: 1,
  footstoolRangeWidth: 6, footstoolRangeHeight: 6,
  footstoolRangeAdditionalWidth: 2, footstoolRangeAdditionalHeight: 2,
  cliffJumpSpeedX: 0.6, cliffJumpHeight: 37.75,
});
'''
(OUT/'pikachuAuxiliaryBody.ts').write_text(header+body+footer)
(OUT/'auxiliary-source-contract.json').write_text(json.dumps({'state':'staged exact source contract; actual consumer qualification pending','leafSha256':sha(OUT/'pikachuAuxiliaryBody.ts'),'framesReadSha256':sha(ROOT/'assets/characters/pikachu/frames.json'),'parameterSourceSha256':sha(B/'sources/native-fighter-pikachu.json'),'motionListSha256':sha(B/'sources/motion-list.yml'),'profiles':provenance,'limits':['Source sample age is explicitly authored beta presentation, not native common status parity.','Source endpoint drawings retained and selectable for one native-age unit; caller decides terminal hold/action commitment separately.','Source-root deltas are optional physical-owner inputs; no cosmetic floor lift.','Cancel0 is represented by null; it is never an instantaneous action. Source cancel fields and resource end are separate.']},indent=2)+'\n')
print(json.dumps({'stagedFamilies':len(profiles),'drawings':sum(len(p['drawings']) for p in profiles.values()),'leaf':str(OUT/'pikachuAuxiliaryBody.ts')}))
