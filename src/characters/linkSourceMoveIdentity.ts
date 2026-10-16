/** Saved/tuned IDs own input and combat receipts. This separate lineage owns
 * source pose selection; names never imply a source action. */
import type { AttackMove } from './attacks';
import type {LinkRecoveryAttackId} from './linkFreshRecoveryAttacks';
import { LINK_NORMAL_RULES,type LinkNormalId } from './linkNormalRules';
export type LinkSourceMoveId=LinkNormalId|LinkRecoveryAttackId|'link.neutral_special'|'link.side_special'|'link.up_special'|'link.down_special';
const RECOVERIES=new Set<string>(['link.getupAttack','link.getupAttackFaceDown','link.tripAttack','link.ledgeAttack']);
const SPECIALS=new Set<string>(['link.neutral_special','link.side_special','link.up_special','link.down_special']);
export function parseLinkSourcePoseId(value:unknown,path='sourcePoseId'):LinkSourceMoveId {
  if(typeof value!=='string'||!value.trim()||!Object.hasOwn(LINK_NORMAL_RULES,value)&&!SPECIALS.has(value)&&!RECOVERIES.has(value))
    throw new TypeError(`${path} must identify an explicit supported fresh Link source action`);
  return value as LinkSourceMoveId;
}
export function linkSourceNormalId(move:AttackMove):LinkNormalId|null {
  const id=move.sourcePoseId;
  if(!id||!Object.hasOwn(LINK_NORMAL_RULES,id)||move.sourceRuntimeOwned)return null;
  const name=id.slice(5),type=['nair','fair','bair','uair','dair'].includes(name)?'aerial':
    name.includes('smash')?'smash':name.startsWith('jab')?'jab':'tilt';
  return move.type===type?id as LinkNormalId:null;
}
export function linkSourceIntrinsicId(move:AttackMove):LinkSourceMoveId|null {
  if(move.sourceRuntimeOwned!==true||!move.sourcePoseId||!SPECIALS.has(move.sourcePoseId))return null;
  const expected=move.sourcePoseId==='link.neutral_special'?'special':move.sourcePoseId==='link.side_special'?'sideSpecial':
    move.sourcePoseId==='link.up_special'?'upSpecial':'downSpecial';
  return move.type===expected?move.sourcePoseId as LinkSourceMoveId:null;
}

export function linkSourceRecoveryId(move:AttackMove):LinkRecoveryAttackId|null {
  return move.type==='tilt'&&!move.sourceRuntimeOwned&&move.sourcePoseId&&RECOVERIES.has(move.sourcePoseId)?move.sourcePoseId as LinkRecoveryAttackId:null;
}
