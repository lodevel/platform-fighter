import {mapDonkeyKongGrabDrawingAge,type DonkeyKongGrabDrawingClock,type DonkeyKongGrabTimeline} from './donkeykongGrabTimeline';

/** Explicit reviewed body-input opt-in; it does not qualify runtime or whole action. */
export interface DonkeyKongReviewedGrabTimeline extends DonkeyKongGrabTimeline {
  readonly reviewedInputs:true;
  readonly bodyReviewKey:string;
}
// Pinned minimal complete standing plan. Image delays have no gameplay authority.
export const DONKEYKONG_STANDING_GRAB_SAMPLE_AGES=Object.freeze([0,3,6,7,8,9,10,23,32,37]);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
function capsule(v:unknown):boolean {
  if(!object(v)||!object(v.start)||!object(v.end)||!finite(v.start.x)||!finite(v.start.y)||
    !finite(v.end.x)||!finite(v.end.y)||!finite(v.radius)||v.radius<=0)return false;
  return [Math.min(v.start.x,v.end.x)-v.radius,Math.max(v.start.x,v.end.x)+v.radius,
    Math.min(v.start.y,v.end.y)-v.radius,Math.max(v.start.y,v.end.y)+v.radius,
    Math.abs(v.start.x-v.end.x)+2*v.radius,Math.abs(v.start.y-v.end.y)+2*v.radius].every(Number.isFinite);
}
function receiving(v:unknown):boolean {
  if(!Array.isArray(v)||!v.length)return false;
  const ids=new Set<string>();
  for(const h of v){
    if(!object(h)||typeof h.id!=='string'||!h.id.trim()||ids.has(h.id)||
      !finite(h.offsetX)||!finite(h.offsetY)||!finite(h.width)||h.width<=0||!finite(h.height)||h.height<=0||
      (h.capsule!==undefined&&!capsule(h.capsule))||
      (h.intangible!==undefined&&typeof h.intangible!=='boolean'))return false;
    ids.add(h.id);
  }
  return true;
}
/** Old canonical grab has no paired CATCH rows. Their presence requires the
 * complete reviewed-input marker even when a malformed packet omits it. */
export function isCompleteStandingGrabCandidate(clip:unknown):boolean {
  return object(clip)&&(clip.pairedGrabTimeline!==undefined||clip.catchCollisionPoses!==undefined);
}
/** Missing/partial/malformed full clips fail closed to existing pilot/legacy. */
export function getCompleteDonkeyKongStandingGrabTimeline(clip:unknown):DonkeyKongReviewedGrabTimeline|null {
  if(!object(clip)||!object(clip.pairedGrabTimeline))return null;
  const t=clip.pairedGrabTimeline;
  if(t.variant!=='standing'||t.startupFrames!==7||t.activeFrames!==3||t.recoveryFrames!==28||
    t.reviewedInputs!==true||typeof t.bodyReviewKey!=='string'||!t.bodyReviewKey.trim())return null;
  if(!integer(clip.frameWidth,1)||!integer(clip.frameHeight,1)||clip.frameCount!==10||
    !Array.isArray(clip.root)||clip.root.length!==2||!finite(clip.root[0])||!finite(clip.root[1])||
    clip.root[0]<0||clip.root[0]>clip.frameWidth||clip.root[1]<0||clip.root[1]>clip.frameHeight||
    !finite(clip.scaleToWorld)||clip.scaleToWorld<=0||!finite(clip.bodyCentreFromRootY)||
    (clip.loopDuration!==undefined&&clip.loopDuration!==null))return null;
  const windows=clip.frameWindows,poses=clip.hurtboxPoses,catches=clip.catchCollisionPoses;
  if(!Array.isArray(windows)||windows.length!==10||!Array.isArray(poses)||poses.length!==10||
    !Array.isArray(catches)||catches.length!==10)return null;
  let previous=0;const cells=new Set<number>();
  for(let i=0;i<windows.length;i++){
    const w=windows[i];
    if(!object(w)||!integer(w.startFrame)||w.startFrame!==previous||w.startFrame!==DONKEYKONG_STANDING_GRAB_SAMPLE_AGES[i]||
      !integer(w.endFrame,1)||w.endFrame<=previous||!integer(w.artFrameIndex)||w.artFrameIndex>=10||cells.has(w.artFrameIndex))return null;
    cells.add(w.artFrameIndex);previous=w.endFrame;
    const rs=poses.filter(p=>object(p)&&p.artFrameIndex===w.artFrameIndex),cs=catches.filter(p=>object(p)&&p.artFrameIndex===w.artFrameIndex);
    if(rs.length!==1||cs.length!==1)return null;
    const r=rs[0],c=cs[0];
    if(!object(r)||!object(c)||r.nativeSample!==w.startFrame+1||c.nativeSample!==r.nativeSample||
      !receiving(r.hurtboxes)||!Array.isArray(c.regions))return null;
    const active=w.startFrame>=7&&w.startFrame<10;
    if(active){
      if(w.endFrame!==w.startFrame+1||c.regions.length!==2)return null;
      const ids=new Set<number>();
      for(const region of c.regions){
        if(!object(region)||!integer(region.id)||ids.has(region.id)||!capsule(region.capsule))return null;
        ids.add(region.id);
      }
      if(!ids.has(0)||!ids.has(1))return null;
    }else if(c.regions.length!==0)return null;
  }
  if(previous!==38)return null;
  return {variant:'standing',startupFrames:7,activeFrames:3,recoveryFrames:28,reviewedInputs:true,bodyReviewKey:t.bodyReviewKey};
}
export function selectCompleteDonkeyKongStandingGrab(clip:unknown,clock:DonkeyKongGrabDrawingClock) {
  const timeline=getCompleteDonkeyKongStandingGrabTimeline(clip);if(!timeline)return null;
  const sourceAge=mapDonkeyKongGrabDrawingAge(timeline,clock);if(sourceAge===null)return null;
  // Already validated complete typed rows above, including no null/sparse entries.
  const data=clip as {frameWindows:readonly{startFrame:number;endFrame:number;artFrameIndex:number}[];
    hurtboxPoses:readonly{artFrameIndex:number;nativeSample:number}[]};
  const window=data.frameWindows.find(w=>w.startFrame<=sourceAge&&sourceAge<w.endFrame)!;
  const pose=data.hurtboxPoses.find(p=>p.artFrameIndex===window.artFrameIndex)!;
  return {sheet:'grab' as const,sourceAge,artFrameIndex:window.artFrameIndex,nativeSample:pose.nativeSample};
}
