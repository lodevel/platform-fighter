import { createDodgeState } from '../dodgeState';
import { createGrabState } from '../grabState';
import { createLedgeHangState } from '../ledgeHangState';
import { createShieldState } from '../shieldState';
import type { SimulationAnimationSnapshot } from '../simulationSpriteAnimation';

/** A standing fighter's animation snapshot for presentation tests; `patch` sets what differs. */
export function animationSnapshot(characterId: 'donkeykong' | 'pikachu' | 'link', patch: Partial<SimulationAnimationSnapshot> = {}): SimulationAnimationSnapshot {
  return {
    characterId, assetCharacterId: characterId, facing: 1, destroyed: false, activeAttack: null, pikachuSpecial: null,
    finalVictimSelection: null, finalVictimPose: null, finalSmash: null,
    packedBody: { clock: null, committed: null, crouchPhase: null, turnBrake: null, itemCue: null, airDodgeDirection: { x: 0, y: 0 }, fastFall: false }, buriedPresentation: null,
    hitstunRemaining: 0, hitlagRemaining: 0, shield: createShieldState(), dodge: createDodgeState(), ledgeHang: createLedgeHangState(),
    chargingMove: null, chargeHeldFrames: 0, landingRecoveryRemaining: 0, frame: 0, frozen: false,
    grounded: true, velocityX: 0, velocityY: 0, crouching: false, jumpsquatRemaining: 0, grabbed: false,
    grab: createGrabState(), grabSpec: null, locomotion: { name: 'standing', facing: 1, framesElapsed: 0, dashFacing: 1 },
    jumpPresentation: null, throwPresentation: null, landingPresentation: null, grabPresentation: null, ordinaryPresentation: null, clankPresentation: null,
    turnBrakePresentation: null, groundRecoveryPresentation: null, auxiliaryAirPresentation: null, footstoolRecipientPresentation: null,
    respawnPresentation: null, itemPresentation: null, itemShooting: null, ledgeJumpPresentation: null, surfaceTechPresentation: null,
    grabReleasePresentation: null, crouchPresentation: null, reactionPresentation: null, shieldPresentation: null, capturePresentation: null,
    tauntPresentation: null, jumpsUsed: 0, helpless: false, shieldReleaseRemaining: 0, shieldStunRemaining: 0, shieldParrying: false,
    ledgeCatchFrames: 0, ledgeCatchMotionRates: [], ...patch,
  };
}
