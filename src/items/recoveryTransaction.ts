import type {RecoverySpec,EatingState,HealingState} from './itemHealing';
export interface RecoveryEatingState extends EatingState {readonly entryFrame:number;readonly facing:1|-1;readonly spec:RecoverySpec;readonly entityGeneration:number|null;readonly actorGeneration:number;}
/** Actual recovery transaction, separate from temporary presentation tails.
 * The scene validates its live entity before committing healing/removal once. */
export interface RecoveryTransactionEvent {
  readonly itemId:number;readonly entityGeneration:number|null;readonly actorGeneration:number;
  readonly entryFrame:number;readonly kind:'consume'|'drop'|'discard';readonly spec:RecoverySpec;readonly amount:number;
}
function integer(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;}
export function validRecoverySpec(value:unknown):value is RecoverySpec {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const row=value as RecoverySpec;
  if(Object.keys(row).length!==5||Object.keys(row).some(key=>!['amount','mode','delayFrames','pointsPerFrame','eat'].includes(key)))return false;
  return typeof row.amount==='number'&&Number.isFinite(row.amount)&&row.amount>0&&
    (row.mode==='instant'||row.mode==='gradual')&&integer(row.delayFrames)&&
    typeof row.pointsPerFrame==='number'&&Number.isFinite(row.pointsPerFrame)&&row.pointsPerFrame>=0&&
    (row.mode!=='gradual'||row.pointsPerFrame>0)&&typeof row.eat==='boolean';
}
export function recoveryTransactionAccepted(event:RecoveryTransactionEvent,live:{
  readonly playerIndex:number;readonly actorGeneration:number;readonly itemId:number;readonly entityGeneration:number;
  readonly heldByPlayer:number|null;readonly despawned:boolean;readonly recovery:RecoverySpec|undefined;
}):boolean {
  if(!event||!integer(event.itemId)||!integer(event.entityGeneration)||!integer(event.actorGeneration)||!integer(event.entryFrame)||
    !['consume','drop','discard'].includes(event.kind)||!validRecoverySpec(event.spec)||!validRecoverySpec(live.recovery)||
    event.actorGeneration!==live.actorGeneration||event.itemId!==live.itemId||event.entityGeneration!==live.entityGeneration||
    live.despawned||live.heldByPlayer!==live.playerIndex||!Number.isFinite(event.amount)||event.amount<0)return false;
  const keys=['amount','mode','delayFrames','pointsPerFrame','eat'] as const;
  if(keys.some(key=>event.spec[key]!==live.recovery![key]))return false;
  return event.kind==='consume'?event.amount===live.recovery.amount:event.amount===0;
}
export function parseRecoveryTransactionEvent(value:unknown):RecoveryTransactionEvent {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Recovery transaction event must be an object');
  const row=value as Record<string,unknown>,keys=['itemId','entityGeneration','actorGeneration','entryFrame','kind','spec','amount'];
  if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key))||!integer(row.itemId)||
    row.entityGeneration!==null&&!integer(row.entityGeneration)||!integer(row.actorGeneration)||!integer(row.entryFrame)||
    !['consume','drop','discard'].includes(row.kind as string)||!validRecoverySpec(row.spec)||
    typeof row.amount!=='number'||!Number.isFinite(row.amount)||row.amount<0||
    (row.kind==='consume'?row.amount!==row.spec.amount:row.amount!==0))throw new TypeError('Malformed recovery transaction event');
  return Object.freeze({...row,spec:Object.freeze({...row.spec})}) as unknown as RecoveryTransactionEvent;
}
export function parseRecoveryEatingState(value:unknown,generation:number,consumeAge:number):RecoveryEatingState|null {
  if(value===null||value===undefined)return null;
  if(typeof value!=='object'||Array.isArray(value))throw new TypeError('Eating checkpoint must be an object');
  const row=value as Record<string,unknown>,keys=['itemId','amount','age','walking','consumed','entryFrame','facing','spec','entityGeneration','actorGeneration'];
  if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key))||!integer(row.itemId)||!integer(row.age)||
    !integer(row.entryFrame)||row.actorGeneration!==generation||row.entityGeneration!==null&&!integer(row.entityGeneration)||
    row.facing!==1&&row.facing!==-1||typeof row.walking!=='boolean'||typeof row.consumed!=='boolean'||
    !validRecoverySpec(row.spec)||!row.spec.eat||row.amount!==row.spec.amount||row.age>=(row.walking?11:9)||row.consumed!==(row.age>=consumeAge))
    throw new TypeError('Malformed eating transaction checkpoint');
  return Object.freeze({...row,spec:Object.freeze({...row.spec})}) as unknown as RecoveryEatingState;
}
export function parseRecoveryHealingState(value:unknown):HealingState|null {
  if(value===null||value===undefined)return null;
  if(typeof value!=='object'||Array.isArray(value))throw new TypeError('Healing checkpoint must be an object');
  const row=value as Record<string,unknown>;
  if(Object.keys(row).length!==3||!integer(row.delay)||typeof row.remaining!=='number'||!Number.isFinite(row.remaining)||row.remaining<=0||
    typeof row.rate!=='number'||!Number.isFinite(row.rate)||row.rate<=0)throw new TypeError('Malformed healing budget checkpoint');
  return Object.freeze({remaining:row.remaining,delay:row.delay,rate:row.rate});
}
