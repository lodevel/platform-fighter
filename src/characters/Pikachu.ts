/** Dedicated Ultimate Pikachu kit. Reviewed source move records are shared with
 * the acceptance fixtures; this class never inherits Volt's approximate kit.
 * Geometry and common-physics adaptations remain separately identified in
 * docs/review/2026-10-06/pikachu-character/integration.
 */
import type { PhysicsHost } from '../physics/PhysicsWorld';
import {getDefaultCaptureAttachmentCalibration} from './captureAttachmentDefaultData';
import { ContractFighter } from './contractFighter';
import type { CharacterTuning } from './Character';
import { registerFighterAttack } from './attackRegistration';
import type { AttackMove } from './attacks';
import type { AttackMoveWithAnimation, Hurtbox } from './moveSchema';
import type { FighterContract, FighterMoveset } from './movesetContract';
import { SHIELD_DEFAULTS } from './shieldState';
import { resolveDodgeTuning } from './dodgeState';
import { PIKACHU_MOVEMENT_PROFILE } from './pikachuMovement';
import { buildPikachuJabWithAuthoredHurtboxes } from './pikachuJabHurtboxes';
import { buildPikachuForwardTiltWithAuthoredHurtboxes } from './pikachuForwardTiltHurtboxes';
import { buildPikachuAngledTiltWithAuthoredHurtboxes } from './pikachuAngledTiltHurtboxes';
import { selectPikachuSmashChargeHurtboxes, type PikachuSmashChargeAction } from './pikachuChargeHurtboxes';
import { selectPikachuReviewedStateReceiving } from './pikachuStatePresentation';
import { captureSimulationAnimation } from './simulationSpriteAnimation';
import { buildPikachuVerticalTiltWithAuthoredHurtboxes } from './pikachuVerticalTiltHurtboxes';
import { buildPikachuDashAttackWithAuthoredHurtboxes } from './pikachuDashAttackHurtboxes';
import { buildPikachuSmashWithAuthoredHurtboxes } from './pikachuSmashHurtboxes';
import { buildPikachuNeutralAirWithAuthoredHurtboxes } from './pikachuNeutralAirHurtboxes';
import { buildPikachuFairWithAuthoredHurtboxes, PIKACHU_FAIR_AUTHORED_HURTBOX_POSES } from './pikachuFairHurtboxes';
import { buildPikachuBackAirWithAuthoredHurtboxes } from './pikachuBackAirHurtboxes';
import { buildPikachuUpAirWithAuthoredHurtboxes } from './pikachuUpAirHurtboxes';
import { buildPikachuDownAirWithAuthoredHurtboxes } from './pikachuDownAirHurtboxes';
import { buildPikachuGrab } from './pikachuGrab';
import { PIKACHU_TAUNTS } from './pikachuTaunts';
import { PIKACHU_NEUTRAL_SPECIAL, PIKACHU_SIDE_SPECIAL, PIKACHU_UP_SPECIAL, PIKACHU_DOWN_SPECIAL } from './pikachuSpecialMoves';
import { PIKACHU_GETUP_ATTACK, PIKACHU_GETUP_ATTACK_FACE_DOWN, PIKACHU_TRIP_ATTACK, PIKACHU_LEDGE_ATTACK } from './pikachuRecoveryAttacks';
import { ULTIMATE_SMASH_MAX_HOLD_FRAMES } from './chargeSchema';
export { PIKACHU_TAUNTS, PIKACHU_MOVEMENT_PROFILE, PIKACHU_NEUTRAL_SPECIAL, PIKACHU_SIDE_SPECIAL, PIKACHU_UP_SPECIAL, PIKACHU_DOWN_SPECIAL,
  PIKACHU_GETUP_ATTACK, PIKACHU_GETUP_ATTACK_FACE_DOWN, PIKACHU_TRIP_ATTACK, PIKACHU_LEDGE_ATTACK };

export const PIKACHU_TUNING: Required<Omit<CharacterTuning, 'shield' | 'dodge' | 'ledge' | 'ledgeDetection' | 'locomotion' | 'referenceWeight' | 'referenceLaunch'>> & Pick<CharacterTuning, 'referenceWeight' | 'referenceLaunch'> = {
  ...PIKACHU_MOVEMENT_PROFILE, width: 40, height: 50, chamfer: 8,
};
export const PIKACHU_JAB = buildPikachuJabWithAuthoredHurtboxes();
/** Independent neutral/up/down strips share source contact clocks, with
 * their reviewed pose windows and receiving fits preserved per variant. */
export const PIKACHU_TILT: AttackMoveWithAnimation = { ...buildPikachuForwardTiltWithAuthoredHurtboxes(),
  angledVariants: { up: buildPikachuAngledTiltWithAuthoredHurtboxes('up'),
    down: buildPikachuAngledTiltWithAuthoredHurtboxes('down') } };
export const PIKACHU_UTILT = buildPikachuVerticalTiltWithAuthoredHurtboxes('up-tilt');
export const PIKACHU_DTILT = buildPikachuVerticalTiltWithAuthoredHurtboxes('down-tilt');
export const PIKACHU_DASHATTACK = buildPikachuDashAttackWithAuthoredHurtboxes();
function smash(action: 'forward-smash' | 'up-smash' | 'down-smash'): AttackMoveWithAnimation {
  const move = buildPikachuSmashWithAuthoredHurtboxes(action);
  return { ...move, charge: { ...move.charge!, maxHoldFrames: ULTIMATE_SMASH_MAX_HOLD_FRAMES } };
}
export const PIKACHU_SMASH = smash('forward-smash');
export const PIKACHU_USMASH = smash('up-smash');
export const PIKACHU_DSMASH = smash('down-smash');
export const PIKACHU_NAIR = buildPikachuNeutralAirWithAuthoredHurtboxes();
const fair = buildPikachuFairWithAuthoredHurtboxes();
const fairPoses = PIKACHU_FAIR_AUTHORED_HURTBOX_POSES;
const fairStartup = fairPoses.filter(row => row.startElapsed < fair.startupFrames).length;
const fairActive = fairPoses.filter(row => row.startElapsed >= fair.startupFrames && row.startElapsed < fair.startupFrames + fair.activeFrames).length;
export const PIKACHU_FAIR = { ...fair, animation: { startupFrames: fairStartup, activeFrames: fairActive,
  recoveryFrames: fairPoses.length - fairStartup - fairActive,
  frameWindows: fairPoses.map((row, artFrameIndex) => ({ startFrame: row.startElapsed, endFrame: row.endElapsed, artFrameIndex })) } };
export const PIKACHU_BAIR = buildPikachuBackAirWithAuthoredHurtboxes();
export const PIKACHU_UAIR = buildPikachuUpAirWithAuthoredHurtboxes();
export const PIKACHU_DAIR = buildPikachuDownAirWithAuthoredHurtboxes();
/** Published Ultimate capture lifecycle is source-opted separately from the
 * retained shared fallback/momentum policy. Native common release arc and
 * input arbitration remain explicit adapters; attack records stay Pikachu's. */
export const PIKACHU_GRAB = Object.freeze({ ...buildPikachuGrab({ holdFramesMax: 90,
  escapeRecoveryFrames: 24, dashMomentumRetain: 0.5 }), ultimateCapture: true });
export const PIKACHU_MOVES: readonly AttackMove[] = Object.freeze([
  PIKACHU_JAB, PIKACHU_TILT, PIKACHU_SMASH, PIKACHU_NAIR, PIKACHU_FAIR, PIKACHU_BAIR,
  PIKACHU_UAIR, PIKACHU_DAIR, PIKACHU_UTILT, PIKACHU_USMASH, PIKACHU_DTILT,
  PIKACHU_DSMASH, PIKACHU_DASHATTACK, PIKACHU_NEUTRAL_SPECIAL, PIKACHU_SIDE_SPECIAL,
  PIKACHU_UP_SPECIAL, PIKACHU_DOWN_SPECIAL, PIKACHU_GETUP_ATTACK,
  PIKACHU_GETUP_ATTACK_FACE_DOWN, PIKACHU_TRIP_ATTACK, PIKACHU_LEDGE_ATTACK,
]);
export const PIKACHU_MOVESET: FighterMoveset = Object.freeze({
  jab: PIKACHU_JAB, tilt: PIKACHU_TILT, smash: PIKACHU_SMASH,
  fair: PIKACHU_FAIR, nair: PIKACHU_NAIR, uair: PIKACHU_UAIR, dair: PIKACHU_DAIR,
  upLight: PIKACHU_UTILT, downLight: PIKACHU_DTILT,
  neutralSpecial: PIKACHU_NEUTRAL_SPECIAL, sideSpecial: PIKACHU_SIDE_SPECIAL,
  upSpecial: PIKACHU_UP_SPECIAL, downSpecial: PIKACHU_DOWN_SPECIAL,
  shield: SHIELD_DEFAULTS, dodge: resolveDodgeTuning(PIKACHU_MOVEMENT_PROFILE.dodge),
});
export const PIKACHU_FIGHTER_CONTRACT: FighterContract = Object.freeze({
  id: 'pikachu', moveset: PIKACHU_MOVESET, movementProfile: PIKACHU_MOVEMENT_PROFILE,
});
export interface PikachuOptions extends CharacterTuning { readonly spawnX: number; readonly spawnY: number; readonly slotIndex?: number }
export class Pikachu extends ContractFighter {
  readonly moveset = PIKACHU_MOVESET;
  readonly movementProfile = PIKACHU_MOVEMENT_PROFILE;
  readonly contract = PIKACHU_FIGHTER_CONTRACT;
  override setRespawnInvincibility(frames: number): void {
    this.setInvincibility(frames, 'invincible');
  }
  /** Pikachu's posed receiving; Character.getActiveHurtboxes still sinks it while buried. */
  protected override unsunkActiveHurtboxes(): readonly Hurtbox[] {
    if (this.getAttackClankPresentationState()) return super.unsunkActiveHurtboxes();
    const charge = this.getAnimationActionState();
    const move = charge.chargingMove as AttackMoveWithAnimation | null;
    if (move?.type === 'smash' && move.chargeStartFrame !== undefined &&
      (charge.chargeStartupElapsed ?? 0) >= move.chargeStartFrame) {
      const action = move.id.slice('pikachu.'.length) as PikachuSmashChargeAction;
      const posed = selectPikachuSmashChargeHurtboxes(action, charge.chargeHeldFrames);
      if (posed) return posed;
    }
    if (!this.getActiveAttack() && !charge.chargingMove) {
      // Resolve defensive/reaction/capture precedence once, exactly as the
      // rendered body does. A falling tumble can also satisfy the ordinary
      // fall getter; that lower-priority pose must not hide tumble receiving.
      const posed = selectPikachuReviewedStateReceiving(captureSimulationAnimation(this, 0, false));
      if (posed) return posed;
    }
    return super.unsunkActiveHurtboxes();
  }
  constructor(scene: PhysicsHost, options: PikachuOptions) {
    super(scene, { id: 'pikachu', ...PIKACHU_TUNING, ...options });
    for (const move of PIKACHU_MOVES) registerFighterAttack(this, move);
    this.setLightAttack(PIKACHU_JAB.id); this.setTiltAttack(PIKACHU_TILT.id); this.setHeavyAttack(PIKACHU_SMASH.id);
    this.setUpTilt(PIKACHU_UTILT.id); this.setDownTilt(PIKACHU_DTILT.id);
    this.setUpSmash(PIKACHU_USMASH.id); this.setDownSmash(PIKACHU_DSMASH.id);
    this.setDashAttack(PIKACHU_DASHATTACK.id); this.setGrabSpec(PIKACHU_GRAB);
    this.setCaptureAttachmentCalibration(getDefaultCaptureAttachmentCalibration('pikachu'));
    this.setTauntSpec(PIKACHU_TAUNTS);
  }
}
