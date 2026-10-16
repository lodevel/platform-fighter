import {parseAttackHeightMetadata,type AttackHeightSourceReceipt} from './attackHeightMetadata';
/** Actual accepted-contact observations. This leaf does not select an art
 * band/tier or pretend that common receiving thresholds were recovered. */
export interface SourceDamagePresentationReceipt {
  readonly eventSerial:number;readonly generation:number;readonly entryFrame:number;readonly lastAdvancedFrame:number;
  readonly framesElapsed:number;readonly entryFacing:1|-1;readonly groundedAtEntry:boolean;
  readonly ownElectricStop:boolean;readonly electricStopFramesElapsed:number;readonly electricStopLastAdvancedFrame:number;
  readonly damageApplied:number;readonly postHitPercent:number;readonly initialHitstunFrames:number;readonly initialStatusHitstunFrames:number;readonly tumbleAtAdmission:boolean;readonly referenceKnockback:number|null;
  readonly launchVelocity:{readonly x:number;readonly y:number};readonly nativeCollisionAttribute:string|null;readonly nativeLaunchAngleRadians:number|null;
  readonly nativeAttackHeight:'low'|'high'|null;readonly nativeAttackHeightSource:AttackHeightSourceReceipt|null;
  readonly attackHeightContext:{readonly attackerRootY:number;readonly victimRootY:number}|null;
  readonly receivingRegions:readonly {readonly id:string;readonly centreWorld:{readonly x:number;readonly y:number}}[]|null;
  readonly electric:boolean;readonly sourceContactCapsuleWorld:{readonly start:{readonly x:number;readonly y:number};readonly end:{readonly x:number;readonly y:number};readonly radius:number}|null;
}
export function parseSourceDamagePresentationReceipt(value:unknown):SourceDamagePresentationReceipt|null {
  if(value===null||value===undefined)return null;
  if(typeof value!=='object'||Array.isArray(value))throw new TypeError('Malformed actual damage presentation receipt');
  const r=value as SourceDamagePresentationReceipt;
  for(const key of ['eventSerial','generation','entryFrame','lastAdvancedFrame','framesElapsed','initialHitstunFrames','initialStatusHitstunFrames','electricStopFramesElapsed','electricStopLastAdvancedFrame']as const)
    if(!Number.isSafeInteger(r[key])||r[key]<0)throw new TypeError(`Malformed damage receipt ${key}`);
  if(typeof r.ownElectricStop!=='boolean'||r.electricStopFramesElapsed>70||r.electricStopLastAdvancedFrame<r.entryFrame||
    r.ownElectricStop&&!r.electric||!r.ownElectricStop&&r.electricStopFramesElapsed!==0)throw new TypeError('Malformed owned electric stop clock');
  if(r.lastAdvancedFrame<r.entryFrame||![1,-1].includes(r.entryFacing)||typeof r.groundedAtEntry!=='boolean'||typeof r.electric!=='boolean'||typeof r.tumbleAtAdmission!=='boolean'||
    ![r.damageApplied,r.postHitPercent,r.launchVelocity?.x,r.launchVelocity?.y].every(v=>typeof v==='number'&&Number.isFinite(v))||
    r.damageApplied<0||r.postHitPercent<0||r.referenceKnockback!==null&&(!Number.isFinite(r.referenceKnockback)||r.referenceKnockback<0)||
    r.nativeCollisionAttribute!==null&&typeof r.nativeCollisionAttribute!=='string'||r.nativeLaunchAngleRadians!==null&&!Number.isFinite(r.nativeLaunchAngleRadians))throw new TypeError('Malformed damage receipt observations');
  if(r.receivingRegions!==null&&(!Array.isArray(r.receivingRegions)||r.receivingRegions.some(region=>!region||typeof region.id!=='string'||!region.id||
    ![region.centreWorld?.x,region.centreWorld?.y].every(v=>typeof v==='number'&&Number.isFinite(v)))))throw new TypeError('Malformed actual touched receiving regions');
  if(r.nativeAttackHeight!==null&&r.nativeAttackHeight!=='low'&&r.nativeAttackHeight!=='high')throw new TypeError('Malformed source attack height receipt');
  const height=parseAttackHeightMetadata({nativeAttackHeight:r.nativeAttackHeight??undefined,nativeAttackHeightSource:r.nativeAttackHeightSource??undefined},'damageReceipt');
  if(r.nativeAttackHeightSource===undefined)throw new TypeError('Missing nullable attack height source');
  const heightContext=r.attackHeightContext;
  if(heightContext!==null&&(!heightContext||![heightContext.attackerRootY,heightContext.victimRootY].every(v=>typeof v==='number'&&Number.isFinite(v))))throw new TypeError('Malformed actual root-height context');
  const c=r.sourceContactCapsuleWorld;
  if(c!==null&&(typeof c!=='object'||Array.isArray(c)||![c?.start?.x,c?.start?.y,c?.end?.x,c?.end?.y,c?.radius].every(v=>typeof v==='number'&&Number.isFinite(v))||c.radius<0))
    throw new TypeError('Malformed actual contact capsule receipt');
  return Object.freeze({...r,nativeAttackHeight:height.nativeAttackHeight??null,nativeAttackHeightSource:height.nativeAttackHeightSource??null,attackHeightContext:heightContext?Object.freeze({...heightContext}):null,receivingRegions:r.receivingRegions?Object.freeze(r.receivingRegions.map(region=>Object.freeze({...region,centreWorld:Object.freeze({...region.centreWorld})}))):null,launchVelocity:Object.freeze({...r.launchVelocity}),sourceContactCapsuleWorld:c?
    Object.freeze({...c,start:Object.freeze({...c.start}),end:Object.freeze({...c.end})}):null});
}
