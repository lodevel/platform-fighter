/** Shared live/UI authoring adapter. Source packets, clear gaps and native
 * capsules stay owned by the current source phase (linkFreshSpin); current
 * authored geometry and values then apply.
 * Ground context maps its envelope onto the descriptor's aerial envelope for
 * authored window lookup. Charge-hold time is deliberately outside that map. */
import type {AttackMove,AttackCollisionHit,AttackHitWindow} from './attacks';
import type {LinkSpinState} from './linkSpinController';
import {linkSpinSourceState,linkSpinTiming,linkSpinActiveAdmission} from './linkSpinTiming';
import {linkSelectedSpinPhase} from './linkFreshSpin';
import {FRESH_LINK_UP_SPECIAL} from './linkFreshSpecials';
import {linkPacketHit} from './linkAttackData';
import {selectLinkIntrinsicAuthoringMetadata,tuneIntrinsicPacketDamage,type LinkIntrinsicAuthoringMove} from './linkIntrinsicAuthoring';
import {computeChargedDamageFromSpec} from './chargeSchema';

export interface LinkSpinContactSelection {
  readonly phase:NonNullable<ReturnType<typeof linkSelectedSpinPhase>>;
  readonly authoringAge:number;readonly windowIndex:number;readonly facingMultiplier:1|-1;
  readonly strike:string;readonly resolvedMove:AttackMove;
  /** [] is a harmless authored interval (or an authored rectangle). */
  readonly collisionHits:readonly AttackCollisionHit[];
  readonly rectangle:AttackMove['hitbox']|null;
  readonly geometryOwner:'source'|'window-capsules'|'window-rectangle'|'global-capsules'|'global-rectangle';
}
export function linkSpinAuthoringAge(state:LinkSpinState,move:AttackMove):number {
  const t=linkSpinTiming(move);
  if(state.phase==='air')return state.age;
  if(state.phase!=='ground-release')return -1;
  return state.age<t.groundReleaseStartup?t.airStartup*state.age/Math.max(1,t.groundReleaseStartup):
    state.age<t.groundReleaseStartup+t.groundActive?t.airStartup+
      (state.age-t.groundReleaseStartup)*t.airActive/Math.max(1,t.groundActive):
      t.airStartup+t.airActive+state.age-t.groundReleaseStartup-t.groundActive;
}
const FLAG_KEYS=['direct','reflectable','absorbable','hitlagMultiplier','sdiMultiplier','shieldDamage',
  'nativeCollisionAttribute','nativeForceReaction','electricCollision','minHitstunFrames','tripChance','setoff',
  'launchDirection','groundedKnockback','shieldSetoffMultiplier',
  'nativeAttackHeight','nativeAttackHeightSource','statusEffect','airborneVelocityCarry'] as const;
function windowFlags(window:AttackHitWindow|undefined):Partial<AttackCollisionHit> {
  const result:Partial<AttackCollisionHit>={};
  if(window)for(const key of FLAG_KEYS)if(window[key]!==undefined)Object.assign(result,{[key]:window[key]});
  return result;
}
export function selectLinkSpinContact(state:LinkSpinState|null,move:AttackMove):LinkSpinContactSelection|null {
  if(!state||!linkSpinActiveAdmission(state,move))return null;
  const phase=linkSelectedSpinPhase(linkSpinSourceState(state,move));if(!phase)return null;
  const authoringAge=linkSpinAuthoringAge(state,move),windowIndex=move.hitWindows?.findIndex(w=>
    w.startFrame<=authoringAge&&authoringAge<w.endFrame)??-1;
  if(move.hitWindows!==undefined&&windowIndex<0)return null;
  const window=move.hitWindows?.[windowIndex],current=move as LinkIntrinsicAuthoringMove;
  const metadata=selectLinkIntrinsicAuthoringMetadata(current,FRESH_LINK_UP_SPECIAL,state.chargeFrames),
    flags={...metadata.flags,...windowFlags(window)};
  const charge=current.chargedProjectile?.charge??current.charge;
  // Per-ID damage is an absolute uncharged packet override. Per-window damage
  // overrides the move's uncharged amplitude; source regional strength remains.
  // The current charge law is applied once after that authoring precedence.
  const chargeFactor=charge?computeChargedDamageFromSpec(charge,state.chargeFrames)/
    (move.damage>0?move.damage:FRESH_LINK_UP_SPECIAL.damage):state.damageMultiplier;
  const rule=(id:number)=>{
    const packet=phase.packets.find(p=>p.id===id)??phase.packets[0]!;
    const damage=window?.damage===undefined?tuneIntrinsicPacketDamage(packet.damage,current,FRESH_LINK_UP_SPECIAL,
      {heldFrames:state.chargeFrames,sourceChargeMultiplier:state.damageMultiplier}):
      packet.damage*window.damage/FRESH_LINK_UP_SPECIAL.damage*chargeFactor;
    return {...linkPacketHit(packet),...flags,damage,
      ...(window?.knockback?{knockback:window.knockback}:metadata.authoredKnockback?{knockback:metadata.authoredKnockback}:{})};
  };
  let geometryOwner:LinkSpinContactSelection['geometryOwner']='source',rectangle:AttackMove['hitbox']|null=null,
    supplied:readonly AttackCollisionHit[]|undefined;
  if(window?.collisionHits!==undefined){geometryOwner='window-capsules';supplied=window.collisionHits;}
  else if(window?.hitbox!==undefined){geometryOwner='window-rectangle';rectangle=window.hitbox;}
  else if(move.collisionHits!==undefined){geometryOwner='global-capsules';supplied=move.collisionHits;}
  else if(metadata.authoredGeometry?.hitbox){geometryOwner='global-rectangle';rectangle=metadata.authoredGeometry.hitbox;}
  const {id:_primaryPacketId,...primary}=rule(phase.packets[0]!.id),resolvedMove:AttackMove={...move,...primary,
    ...(rectangle?{hitbox:rectangle}:{}),collisionHits:undefined};
  const collisionHits:readonly AttackCollisionHit[]=rectangle?[]:supplied?
    Object.freeze(supplied.map(hit=>Object.freeze({...rule(hit.id),...hit,...(hit.damage===undefined?{}:{damage:hit.damage*chargeFactor})}))):
    Object.freeze(phase.geometry.map(hit=>Object.freeze({...rule(hit.id),capsule:hit.capsule})));
  return Object.freeze({phase,authoringAge,windowIndex,facingMultiplier:window?.facing??1,
    strike:window?.group??phase.strike,resolvedMove,collisionHits,rectangle,geometryOwner});
}
