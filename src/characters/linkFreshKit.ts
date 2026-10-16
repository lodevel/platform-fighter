/** Fresh registry exports only. LegacyLink owns the historical authored kit. */
import type { AerialMove } from './aerialSchema';
import type { FighterContract,FighterMoveset } from './movesetContract';
import {buildFreshLinkRecoveryAttack,LINK_RECOVERY_ATTACK_IDS,type LinkRecoveryAttackId} from './linkFreshRecoveryAttacks';
import type {AttackMoveWithAnimation} from './moveSchema';
import type { TauntSet } from './tauntSchema';
import { FRESH_LINK_NORMALS as normals } from './linkFreshNormals';
import { FRESH_LINK_MOVEMENT_PROFILE } from './linkFreshMovement';
import { FRESH_LINK_GRAB } from './linkFreshGrab';
import { SHIELD_DEFAULTS } from './shieldState';
import { DODGE_DEFAULTS } from './dodgeState';
import { FRESH_LINK_NEUTRAL_SPECIAL,FRESH_LINK_SIDE_SPECIAL,FRESH_LINK_UP_SPECIAL,FRESH_LINK_DOWN_SPECIAL } from './linkFreshSpecials';
export const LINK_MOVEMENT_PROFILE=FRESH_LINK_MOVEMENT_PROFILE;
export const LINK_TUNING={...LINK_MOVEMENT_PROFILE,width:46,height:72,chamfer:8};
/** Appeals: native cancel 50 (interruptible from action age 49); presentation runs to each clip's end. */
export const LINK_TAUNTS:TauntSet=Object.freeze({up:Object.freeze({cancelAfterFrames:49,presentationFrames:91}),
  side:Object.freeze({cancelAfterFrames:49,presentationFrames:89}),down:Object.freeze({cancelAfterFrames:49,presentationFrames:85})});
export const LINK_JAB=normals['link.jab'],LINK_JAB2=normals['link.jab2'],LINK_JAB3=normals['link.jab3'];
export const LINK_TILT=normals['link.tilt'],LINK_UTILT=normals['link.utilt'],LINK_DTILT=normals['link.dtilt'];
export const LINK_DASHATTACK=normals['link.dashAttack'];
export const LINK_SMASH=normals['link.smash'],LINK_SMASH2=normals['link.smash2'];
export const LINK_USMASH=normals['link.usmash'],LINK_DSMASH=normals['link.dsmash'];
export const LINK_NAIR=normals['link.nair'] as AerialMove,LINK_FAIR=normals['link.fair'] as AerialMove;
export const LINK_BAIR=normals['link.bair'] as AerialMove,LINK_UAIR=normals['link.uair'] as AerialMove,LINK_DAIR=normals['link.dair'] as AerialMove;
export const LINK_NEUTRAL_SPECIAL=FRESH_LINK_NEUTRAL_SPECIAL,LINK_SIDE_SPECIAL=FRESH_LINK_SIDE_SPECIAL;
export const LINK_UP_SPECIAL=FRESH_LINK_UP_SPECIAL,LINK_DOWN_SPECIAL=FRESH_LINK_DOWN_SPECIAL;
export const LINK_GRAB=FRESH_LINK_GRAB;
export const LINK_MOVESET:FighterMoveset=Object.freeze({jab:LINK_JAB,tilt:LINK_TILT,smash:LINK_SMASH,fair:LINK_FAIR,
  neutralSpecial:LINK_NEUTRAL_SPECIAL,sideSpecial:LINK_SIDE_SPECIAL,upSpecial:LINK_UP_SPECIAL,downSpecial:LINK_DOWN_SPECIAL,
  shield:SHIELD_DEFAULTS,dodge:DODGE_DEFAULTS});
export const LINK_FIGHTER_CONTRACT:FighterContract=Object.freeze({id:'link',moveset:LINK_MOVESET,movementProfile:LINK_MOVEMENT_PROFILE});

export const FRESH_LINK_RECOVERY_ATTACKS:Readonly<Record<LinkRecoveryAttackId,AttackMoveWithAnimation>>=Object.freeze(Object.fromEntries(
  LINK_RECOVERY_ATTACK_IDS.map(id=>[id,buildFreshLinkRecoveryAttack(id)])) as Record<LinkRecoveryAttackId,AttackMoveWithAnimation>);
// Named slot exports (authorableCharacterRegistry reads <ID>_<SLOT>).
export const LINK_GETUP_ATTACK=FRESH_LINK_RECOVERY_ATTACKS['link.getupAttack'],
  LINK_GETUP_ATTACK_FACE_DOWN=FRESH_LINK_RECOVERY_ATTACKS['link.getupAttackFaceDown'],
  LINK_TRIP_ATTACK=FRESH_LINK_RECOVERY_ATTACKS['link.tripAttack'],LINK_LEDGE_ATTACK=FRESH_LINK_RECOVERY_ATTACKS['link.ledgeAttack'];
