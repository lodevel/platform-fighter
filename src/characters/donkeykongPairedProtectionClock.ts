import metadata from '../../assets/characters/donkeykong/frames.json';
import type { AttackMove } from './attacks';
import type { Hurtbox } from './moveSchema';
import { attackMoveToSheets } from './spriteAnimationDriver';
import { getDonkeyKongPairedTimeline, mapDonkeyKongPairedActionAge,
  type DonkeyKongPairedTimelineClip } from './donkeykongPairedActionTimeline';
import { applyRegionalProtection } from './regionalProtection';

type ProtectionMove = Pick<AttackMove,'id'|'type'|'sheetVariant'|'startupFrames'|'activeFrames'|'recoveryFrames'|'protectionWindows'>;
const clips=metadata.animations as unknown as Record<string,DonkeyKongPairedTimelineClip>;

/** The source namespace and explicit complete-pair marker establish this
 * animation clock domain. A fallback or review-only pilot cannot establish it.
 * Keep the first canonical selector identical to the body drawing consumer. */
export function getDonkeyKongPairedProtectionTimeline(move:{readonly id?:string;readonly type?:string;readonly sheetVariant?:string;readonly aerialDirection?:string}) {
  if(!move.id?.startsWith('donkeykong.'))return null;
  const sheet=attackMoveToSheets(move)[0],clip=sheet===undefined?undefined:clips[sheet];
  if(!clip?.pairedActionTimeline)return null;
  const timeline=getDonkeyKongPairedTimeline(clip)!;
  return{sheet:sheet!,clip,timeline};
}

/** Persisted protection windows on complete paired moves are source-animation
 * coordinates, including authored edits. Custom gameplay phases resample that
 * same continuous age; their shorter total must not truncate a source window.
 * Other actions retain gameplay coordinates. null age means a retired pair. */
export function resolveDonkeyKongProtectionClock(move:ProtectionMove,elapsed:number):{
  readonly domain:'paired-source'|'gameplay';readonly age:number|null;readonly endFrame:number;
} {
  const paired=getDonkeyKongPairedProtectionTimeline(move);
  return paired?{domain:'paired-source',age:mapDonkeyKongPairedActionAge(paired.clip,move,elapsed),endFrame:paired.timeline.endFrame}
    :{domain:'gameplay',age:elapsed,endFrame:move.startupFrames+move.activeFrames+move.recoveryFrames};
}

export function applyDonkeyKongMoveProtection(boxes:readonly Hurtbox[],move:ProtectionMove|null,elapsed:number):readonly Hurtbox[] {
  if(!move)return boxes;
  const clock=resolveDonkeyKongProtectionClock(move,elapsed);
  return clock.age===null?boxes:applyRegionalProtection(boxes,move,clock.age);
}
