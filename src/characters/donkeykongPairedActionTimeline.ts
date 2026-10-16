import type { AttackMove } from './attacks';

export interface DonkeyKongPairedTimelineClip {
  readonly frameCount:number;
  readonly pairedActionTimeline?:{readonly endFrame:number};
  readonly frameWindows?:readonly {startFrame:number;endFrame:number|null;artFrameIndex:number}[];
  readonly hurtboxPoses?:readonly {artFrameIndex:number;nativeSample:number;hurtboxes:readonly unknown[]}[];
  readonly attackCollisionPoses?:readonly {artFrameIndex:number;nativeSample:number;collisionHits:readonly {id:number}[]}[];
}
export interface DonkeyKongPairedTimeline {
  readonly startup:number;readonly active:number;readonly recovery:number;readonly endFrame:number;
}

/** This marker proves paired data coverage, never art or match acceptance. */
export function getDonkeyKongPairedTimeline(clip:DonkeyKongPairedTimelineClip):DonkeyKongPairedTimeline|null {
  const marker=clip.pairedActionTimeline;if(!marker)return null;
  const fail=(reason:string):never=>{throw new Error(`Invalid DK paired action timeline: ${reason}`);};
  if(!Number.isInteger(marker.endFrame)||marker.endFrame<=0||!Number.isInteger(clip.frameCount)||clip.frameCount<=0)fail('extent');
  const windows=clip.frameWindows,receiving=clip.hurtboxPoses,attacks=clip.attackCollisionPoses;
  if(!windows||windows.length!==clip.frameCount||receiving?.length!==clip.frameCount||attacks?.length!==clip.frameCount)fail('cell pairing');
  let previous=0,activeStart:number|null=null,activeEnd:number|null=null,recoveryStarted=false;
  const indices=new Set<number>();
  for(const w of windows!){
    if(w.startFrame!==previous||w.endFrame===null||!Number.isInteger(w.endFrame)||w.endFrame<=w.startFrame||
      !Number.isInteger(w.artFrameIndex)||w.artFrameIndex<0||w.artFrameIndex>=clip.frameCount||indices.has(w.artFrameIndex))fail('drawing windows');
    indices.add(w.artFrameIndex);previous=w.endFrame!;
    const rs=receiving!.filter(p=>p.artFrameIndex===w.artFrameIndex),as=attacks!.filter(p=>p.artFrameIndex===w.artFrameIndex);
    if(rs.length!==1||as.length!==1||!rs[0]!.hurtboxes.length||!Number.isFinite(rs[0]!.nativeSample)||
      rs[0]!.nativeSample!==as[0]!.nativeSample)fail('native sample pairing');
    const ids=as[0]!.collisionHits.map(h=>h.id);
    if(ids.some(id=>!Number.isInteger(id)||id<0)||new Set(ids).size!==ids.length)fail('attack IDs');
    if(ids.length){
      if(recoveryStarted)fail('active geometry after recovery');
      activeStart??=w.startFrame;activeEnd=w.endFrame;
    }else if(activeEnd!==null)recoveryStarted=true;
  }
  if(previous!==marker.endFrame||activeStart===null||activeEnd===null)fail('complete phase coverage');
  return {startup:activeStart!,active:activeEnd!-activeStart!,recovery:marker.endFrame-activeEnd!,endFrame:marker.endFrame};
}

/** Stock clocks are exact. Lab phase edits use an explicit authored resampling
 * within their corresponding source spans, keeping recovery out of strikes. */
export function mapDonkeyKongPairedActionAge(clip:DonkeyKongPairedTimelineClip,
  move:Pick<AttackMove,'startupFrames'|'activeFrames'|'recoveryFrames'>,elapsed:number):number|null {
  const source=getDonkeyKongPairedTimeline(clip);if(!source)return null;
  const actual=[move.startupFrames,move.activeFrames,move.recoveryFrames];
  if(!Number.isFinite(elapsed)||elapsed<0||actual.some(n=>!Number.isInteger(n)||n<0))throw new Error('Invalid DK authored action phase clock');
  const total=actual.reduce((a,b)=>a+b,0);if(elapsed>=total)return null;
  const spans=[source.startup,source.active,source.recovery];let actualStart=0,sourceStart=0;
  for(let phase=0;phase<3;phase++){
    const duration=actual[phase]!,span=spans[phase]!;
    if(elapsed<actualStart+duration){
      if(span===0)throw new Error('DK authored phase has no paired source samples');
      return sourceStart+(elapsed-actualStart)*span/duration;
    }
    actualStart+=duration;sourceStart+=span;
  }
  return null;
}
