/** Paired Final drawing/receiving/outgoing selection. Missing new artwork
 * remains an explicit missing profile, never a source-qualified alias. */
import donkey from '../../../assets/characters/donkeykong/frames.json';
import pikachu from '../../../assets/characters/pikachu/frames.json';
import link from '../../../assets/characters/link/frames.json';
import type {LinkAttachment,LinkHeadContact} from '../../characters/linkBodyProfileValidation';
import type { Hurtbox } from '../../characters/moveSchema';
import type { AttackCollisionHit } from '../../characters/attacks';
import { packedBodyProfile, selectPackedDrawing } from '../../characters/packedBodyPresentation';
import type { CharacterId } from '../../types';
import {parseFinalFxPoints,type FinalFxPoint} from '../../finalSmash/finalFxProfiles';
interface FinalClip {
  readonly coordinateOrigin?: 'actorSourceRoot';
  /** Raw0-based native index vs1-based source frame label, never inferred
   * from fighter identity. Drawing ages always remain zero-based elapsed. */
  readonly sourceSampleBasis?: 'zero-based-native-index' | 'one-based-native-frame';
  readonly frameCount: number; readonly sourceDrawingCount?:number; readonly frameWidth: number; readonly frameHeight: number;
  readonly root?: readonly number[]; readonly scaleToWorld?: number; readonly bodyCentreFromRootY?: number;
  readonly nativeSampleIndices?: readonly number[]; readonly loopDuration?: number | null;
  readonly frameWindows?: readonly { startFrame: number; endFrame: number | null; artFrameIndex: number }[];
  readonly hurtboxPoses?: readonly { artFrameIndex: number; nativeSample: number; hurtboxes: readonly Hurtbox[];
    /** Reviewed cranial tissue TOP in the same unmirrored SOURCE ROOT basis. */
    headContact?:LinkHeadContact }[];
  readonly attackCollisionPoses?: readonly { artFrameIndex: number; nativeSample: number;
    collisionHits: readonly Pick<AttackCollisionHit, 'id' | 'capsule'>[] }[];
  /** Shared final_dash drawing has distinct Dash/Attack/AttackFinish packets;
   * geometry is selected by source role, never by an assumed common radius. */
  readonly attackCollisionPosesByRole?: Readonly<Record<string, readonly { artFrameIndex: number;
    nativeSample: number; collisionHits: readonly Pick<AttackCollisionHit, 'id' | 'capsule'>[] }[]>>;
  readonly sourceRenderPoses?:readonly {artFrameIndex:number;nativeSample:number;originX:number;originY:number;render?:{sheet:string;frameIndex:number}}[];
  readonly sourceAttachmentPoses?:readonly {artFrameIndex:number;nativeSample:number;attachments:readonly LinkAttachment[]}[];
  readonly sourceEffectPointPoses?:readonly {artFrameIndex:number;nativeSample:number;points:readonly FinalFxPoint[]}[];
  readonly sourceRootDelta?: readonly { x: number; y: number }[];
}
const clips = { donkeykong: donkey.animations, pikachu: pikachu.animations, link: link.animations } as unknown as
  Readonly<Record<string, Readonly<Record<string, FinalClip>>>>;
const validated = new WeakSet<object>();
function validateNewFinalClip(clip: FinalClip, path: string,fighter:string): void {
  if (validated.has(clip)) return;
  const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value);
  const fail=(field:string):never=>{throw new Error(`Malformed new Final profile ${path}.${field}`);};
  if (!Number.isSafeInteger(clip.frameCount)||clip.frameCount<1) fail('frameCount');
  const drawingCount=clip.sourceDrawingCount??clip.frameCount;
  if(!Number.isSafeInteger(drawingCount)||drawingCount<1)fail('sourceDrawingCount');
  if (![clip.frameWidth,clip.frameHeight,clip.scaleToWorld].every(v=>finite(v)&&Number(v)>0)) fail('dimensions/scale');
  if (!Array.isArray(clip.root)||clip.root.length!==2||!clip.root.every(finite)||!finite(clip.bodyCentreFromRootY)) fail('root/bodyCentre');
  if(clip.sourceSampleBasis!=='zero-based-native-index'&&clip.sourceSampleBasis!=='one-based-native-frame')fail('sourceSampleBasis');
  const minimumSample=clip.sourceSampleBasis==='zero-based-native-index'?0:1;
  const samples=clip.nativeSampleIndices;
  if (!samples?.length && !clip.frameWindows?.length) fail('native drawing clock');
  if(samples&&(samples.length!==drawingCount||samples.some((v,i)=>!Number.isSafeInteger(v)||v<minimumSample||(i>0&&v<=samples[i-1]!))))fail('nativeSampleIndices');
  if (clip.loopDuration!=null&&(!finite(clip.loopDuration)||clip.loopDuration<=0))fail('loopDuration');
  const checkCapsule=(value:unknown)=>{
    const c=value as {start?:{x?:unknown;y?:unknown};end?:{x?:unknown;y?:unknown};radius?:unknown}|null;
    if(!c||![c.start?.x,c.start?.y,c.end?.x,c.end?.y,c.radius].every(finite)||Number(c.radius)<0)fail('capsule');
  };
  if (!clip.hurtboxPoses?.length)fail('posed receiving');
  for(const row of clip.hurtboxPoses!){
    if(row.headContact!==undefined){const contact=row.headContact,point=contact?.point;
      if(!contact||typeof contact!=='object'||Array.isArray(contact)||Object.keys(contact).length!==2||
        !Object.hasOwn(contact,'point')||!Object.hasOwn(contact,'reviewKey')||!point||typeof point!=='object'||Array.isArray(point)||
        Object.keys(point).length!==2||!Object.hasOwn(point,'x')||!Object.hasOwn(point,'y')||
        ![point.x,point.y].every(finite)||typeof contact.reviewKey!=='string'||!contact.reviewKey.trim())fail('headContact');
    }
    if(!Number.isInteger(row.artFrameIndex)||row.artFrameIndex<0||row.artFrameIndex>=drawingCount||!Number.isSafeInteger(row.nativeSample)||row.nativeSample<minimumSample)fail('receiving drawing');
    if (!Array.isArray(row.hurtboxes)||!row.hurtboxes.length)fail('receiving shapes');
    for(const h of row.hurtboxes){
      if(![h.offsetX,h.offsetY,h.width,h.height].every(finite)||h.width<0||h.height<0)fail('receiving metrics');
      if(h.damageMultiplier!==undefined&&(!finite(h.damageMultiplier)||h.damageMultiplier<0))fail('receiving multiplier');
      if(h.capsule)checkCapsule(h.capsule);
    }
  }
  if(clip.hurtboxPoses!.length!==drawingCount||new Set(clip.hurtboxPoses!.map(r=>r.artFrameIndex)).size!==drawingCount)fail('receiving coverage');
  const outgoing=[...(clip.attackCollisionPoses??[]),...Object.values(clip.attackCollisionPosesByRole??{}).flat()];
  for(const row of outgoing){
    if(!Number.isInteger(row.artFrameIndex)||row.artFrameIndex<0||row.artFrameIndex>=drawingCount||!Number.isSafeInteger(row.nativeSample)||row.nativeSample<minimumSample)fail('outgoing drawing');
    for(const hit of row.collisionHits){if(!Number.isInteger(hit.id)||hit.id<0)fail('outgoing id');checkCapsule(hit.capsule);}
  }
  for(const row of clip.sourceAttachmentPoses??[]){
    if(!Number.isInteger(row.artFrameIndex)||row.artFrameIndex<0||row.artFrameIndex>=drawingCount||!Number.isSafeInteger(row.nativeSample)||row.nativeSample<minimumSample)fail('attachment drawing');
    const receiving=clip.hurtboxPoses!.find(r=>r.artFrameIndex===row.artFrameIndex);
    if(!receiving||receiving.nativeSample!==row.nativeSample||!Array.isArray(row.attachments))fail('paired attachment');
    const roles=new Set<string>();for(const a of row.attachments){
      if(!a||!['item','sword','shield','bow','ancient-bow','arrow-release','ancient-arrow-release','boomerang-release','bomb-root','parasail-root','capture-anchor','waist'].includes(a.role)||roles.has(a.role)||
        ![a.point?.x,a.point?.y].every(finite)||
        (a.angleDegrees===undefined?!['item','waist','bomb-root','capture-anchor'].includes(a.role):!finite(a.angleDegrees)))fail('attachment role/point');roles.add(a.role);
      if(a.axisDirections!==undefined){if(!a.axisDirections||typeof a.axisDirections!=='object'||Array.isArray(a.axisDirections)||!Object.keys(a.axisDirections).length)fail('empty item axes');
        for(const [axis,dir]of Object.entries(a.axisDirections)){if(!['y','z'].includes(axis)||!dir||!finite(dir.angleDegrees)||!finite(dir.inPlaneLength)||dir.inPlaneLength<0||dir.inPlaneLength>1+1e-6)fail('item axes');}}
    }
  }
  if(new Set((clip.sourceAttachmentPoses??[]).map(r=>r.artFrameIndex)).size!==(clip.sourceAttachmentPoses?.length??0))fail('duplicate attachment drawing');
  if(clip.sourceEffectPointPoses!==undefined){
    if(!Array.isArray(clip.sourceEffectPointPoses)||new Set(clip.sourceEffectPointPoses.map(row=>row.artFrameIndex)).size!==clip.sourceEffectPointPoses.length)fail('effect point rows');
    for(const row of clip.sourceEffectPointPoses){const receiving=clip.hurtboxPoses!.find(r=>r.artFrameIndex===row.artFrameIndex);
      if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==3||
        !['artFrameIndex','nativeSample','points'].every(key=>Object.hasOwn(row,key))||!receiving||row.nativeSample!==receiving.nativeSample)fail('paired effect point drawing');
      parseFinalFxPoints(row.points,`${path}.sourceEffectPointPoses[${row.artFrameIndex}]`);
    }
  }
  if(clip.sourceRenderPoses!==undefined){
    if(!Array.isArray(clip.sourceRenderPoses))fail('render origins array');
    if(clip.sourceRenderPoses.length!==drawingCount||new Set(clip.sourceRenderPoses.map(r=>r.artFrameIndex)).size!==drawingCount)fail('render origins coverage');
    for(const row of clip.sourceRenderPoses){const receiving=clip.hurtboxPoses!.find(r=>r.artFrameIndex===row.artFrameIndex);
      if(!Number.isSafeInteger(row.artFrameIndex)||!receiving||receiving.nativeSample!==row.nativeSample||![row.originX,row.originY].every(finite))fail('paired render origin');
      if(row.render!==undefined){const r=row.render;
        if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).length!==2||typeof r.sheet!=='string'||!r.sheet||!Number.isSafeInteger(r.frameIndex)||r.frameIndex<0)fail('render page address');
        const page=clips[fighter]?.[r.sheet];if(!page||!Number.isSafeInteger(page.frameCount)||page.frameCount<1||r.frameIndex>=page.frameCount||
          page.frameWidth!==clip.frameWidth||page.frameHeight!==clip.frameHeight)fail('render page metrics/frame');
      }else if(row.artFrameIndex>=clip.frameCount)fail('missing render page address');
    }
  }
  if(drawingCount>clip.frameCount&&!clip.sourceRenderPoses)fail('paged drawing render addresses');
  if(!clip.sourceRootDelta?.length||clip.sourceRootDelta.some(p=>!finite(p.x)||!finite(p.y)))fail('sourceRootDelta');
  const requiredAges=Math.max(0,...(clip.frameWindows??[]).map(w=>w.endFrame??w.startFrame+1),
    ...(samples??[]).map(n=>n+(clip.sourceSampleBasis==='one-based-native-frame'?0:1)));
  if(clip.sourceRootDelta!.some(p=>p.x!==0||p.y!==0)&&clip.sourceRootDelta!.length<Math.ceil(requiredAges))fail('undersampled moving root displacement');
  if(clip.sourceRootDelta![0]!.x!==0||clip.sourceRootDelta![0]!.y!==0)fail('entry root displacement');
  if(clip.loopDuration&&clip.sourceRootDelta!.some(p=>p.x!==0||p.y!==0))fail('loop must be in place');
  validated.add(clip);
}
export function sampleFinalBodyPose(fighter: string, sheet: string, age: number, packetRole?: string) {
  const clip = clips[fighter]?.[sheet];
  if (!clip || !sheet.startsWith('final') || clip.coordinateOrigin !== 'actorSourceRoot') return null;
  validateNewFinalClip(clip,`${fighter}/${sheet}`,fighter);
  let index = 0, sample = 1;
  if (packedBodyProfile(fighter as CharacterId) && clip.sourceSampleBasis === 'one-based-native-frame' && !clip.frameWindows?.length) {
    const drawing = selectPackedDrawing(fighter as CharacterId, sheet, age); if (!drawing) return null;
    index = drawing.artFrameIndex; sample = drawing.nativeSample;
  } else if (clip.frameWindows?.length) {
    const local = clip.loopDuration ? age % clip.loopDuration : age;
    const drawing = clip.frameWindows.find(w => w.startFrame <= local && (w.endFrame === null || local < w.endFrame));
    if (!drawing) return null; index = drawing.artFrameIndex;
    sample = clip.hurtboxPoses?.find(row => row.artFrameIndex === index)?.nativeSample ?? 0;
  } else if (clip.nativeSampleIndices?.length) {
    const frame = (clip.loopDuration ? age % clip.loopDuration : age) + (clip.sourceSampleBasis === 'one-based-native-frame' ? 1 : 0);
    clip.nativeSampleIndices.forEach((native, i) => { if (native <= frame) index = i; });
    sample = clip.nativeSampleIndices[index]!;
  } else return null;
  const receiving = clip.hurtboxPoses?.find(row => row.artFrameIndex === index);
  if (!receiving) return null;
  if (receiving.nativeSample !== sample) throw new Error(`Final ${fighter}/${sheet} receiving drawing mismatch`);
  const rows = packetRole && clip.attackCollisionPosesByRole
    ? clip.attackCollisionPosesByRole[packetRole] : clip.attackCollisionPoses;
  const outgoing = rows?.find(row => row.artFrameIndex === index);
  if (outgoing && outgoing.nativeSample !== sample) throw new Error(`Final ${fighter}/${sheet} outgoing drawing mismatch`);
  const localAge = clip.loopDuration ? age % clip.loopDuration : age;
  const rootDelta = clip.sourceRootDelta?.[Math.min(Math.floor(localAge), clip.sourceRootDelta.length - 1)];
  if (!rootDelta) return null; // no invented zero displacement for a source-owned pose
  const attached=clip.sourceAttachmentPoses?.find(row=>row.artFrameIndex===index);
  if(attached&&attached.nativeSample!==sample)throw new Error(`Final ${fighter}/${sheet} attachment drawing mismatch`);
  const render=clip.sourceRenderPoses?.find(row=>row.artFrameIndex===index);
  const effectPoints=clip.sourceEffectPointPoses?.find(row=>row.artFrameIndex===index)?.points??[];
  return { attachments:attached?.attachments??[],headContact:receiving.headContact,effectPoints,sheet:render?.render?.sheet??sheet,index:render?.render?.frameIndex??index,sourceDrawingIndex:index,sample, receiving: receiving.hurtboxes, outgoing: outgoing?.collisionHits ?? [], rootDelta,
    originX: render?.originX??clip.root![0]! / clip.frameWidth, originY: render?.originY??clip.root![1]! / clip.frameHeight,
    scaleToWorld: clip.scaleToWorld!, bodyCentreFromRootY: clip.bodyCentreFromRootY! };
}
