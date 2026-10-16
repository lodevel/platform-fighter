import {
  PIKACHU_AUXILIARY_SOURCE_PARAMETERS,
  pikachuAuxiliaryBodyEndExclusive,
  selectPikachuAuxiliaryBody,
} from './pikachuAuxiliaryBody';

/** Source drawings/Trans are pinned; one native sample per fixed step is beta.
 * The common cliff-jump selector, launch energy and attachment are not sourced.
 * Flight length is presentation only: the owner must allow ordinary air cancels.
 */
export interface PikachuLedgeJump {
  readonly phase: 'start' | 'flight';
  readonly framesElapsed: number;
  readonly facing: 1 | -1;
}

// Absolute projected Trans in the reviewed g02cliffjump1.nuanmb, SHA
// 6da23a26d7898fcb6c206eee328d6b54c67e92c19cd4c3185c3e3f8e5185fce6.
// Auxiliary poses contain delta from this entry; adding it recovers raw Trans.
const SOURCE_START_ENTRY = Object.freeze({x: -8.999999761581421, y: 50.236501693725586});

export function beginPikachuLedgeJump(facing: 1 | -1): PikachuLedgeJump {
  return {phase: 'start', framesElapsed: 0, facing};
}

export function advancePikachuLedgeJump(state: PikachuLedgeJump): PikachuLedgeJump | null {
  const sheet = state.phase === 'start' ? 'ledge_jump_start' : 'ledge_jump';
  const next = state.framesElapsed + 1;
  if (next < (pikachuAuxiliaryBodyEndExclusive(sheet) ?? 0)) return {...state, framesElapsed: next};
  return state.phase === 'start' ? {...state, phase: 'flight', framesElapsed: 0} : null;
}

/** One-based source protection [1,13) covers all twelve start drawings. */
export function pikachuLedgeJumpProtected(state: PikachuLedgeJump): boolean {
  return state.phase === 'start' && state.framesElapsed >= 0 && state.framesElapsed < 12;
}

export function selectPikachuLedgeJumpBody(state: PikachuLedgeJump) {
  const sheet = state.phase === 'start' ? 'ledge_jump_start' : 'ledge_jump';
  const pose = selectPikachuAuxiliaryBody(sheet, state.framesElapsed);
  return pose ? {...pose, sheet} : null;
}

/** Physical body-centre offset from the live corner, with the reviewed
 * standing foot basis. Apply facing once to X; never shift only the sprite.
 * Body half height must come from geometry, not velocity-expanded bounds.
 */
export function pikachuLedgeJumpStartOffset(nativeAge: number, bodyHalfHeight: number) {
  if (!Number.isFinite(bodyHalfHeight) || bodyHalfHeight <= 0) throw new RangeError('Body half height must be positive');
  const pose = selectPikachuAuxiliaryBody('ledge_jump_start', nativeAge);
  return pose ? {
    x: SOURCE_START_ENTRY.x + pose.sourceRootDelta.x,
    y: SOURCE_START_ENTRY.y + pose.sourceRootDelta.y - bodyHalfHeight,
  } : null;
}

export const PIKACHU_LEDGE_JUMP_SOURCE_TRAVEL = Object.freeze({
  speedX: PIKACHU_AUXILIARY_SOURCE_PARAMETERS.cliffJumpSpeedX *
    PIKACHU_AUXILIARY_SOURCE_PARAMETERS.referencePixelsPerUnit,
  height: PIKACHU_AUXILIARY_SOURCE_PARAMETERS.cliffJumpHeight *
    PIKACHU_AUXILIARY_SOURCE_PARAMETERS.referencePixelsPerUnit,
});

/** Explicit beta calibration of the repository's discrete ordinary rise sum.
 * Input gravity is the actual world dose PLUS ordinary rising acceleration.
 * The owner applies that rise dose on the first flight step as well as later
 * steps. This preserves the sourced height without claiming native kinetics.
 */
export function pikachuLedgeJumpBetaImpulse(risingAcceleration: number): number {
  if (!Number.isFinite(risingAcceleration) || risingAcceleration <= 0) throw new RangeError('Rising acceleration must be positive');
  const height = PIKACHU_LEDGE_JUMP_SOURCE_TRAVEL.height;
  const steps = Math.floor((Math.sqrt(1 + 8 * height / risingAcceleration) - 1) / 2) + 1;
  return height / steps + risingAcceleration * (steps + 1) / 2;
}
