import type { JumpTakeoffParameters } from './jumpTakeoffVelocity';
/** Published ordinary air-control equation with native DK coefficients.
 * Evidence: mechanics/movement-source-research.json and native fighter export.
 * This helper is not a launch/hitstun, special, cargo or item kinetic solver.
 * Native common control-energy setup/update body remains unavailable.
 */
export const DONKEYKONG_AIR_MOVEMENT_PARAMETERS = Object.freeze({
  accelerationMultiplier: .05, accelerationAdd: .01, stableSpeed: 1.208, neutralBrake: .015,
});
/** Native DK jump_speed_x / jump_speed_x_mul / jump_speed_x_max (fighter_param
 * floats 11-13, mechanics/sources/native-fighter-donkey-context.json). */
export const DONKEYKONG_JUMP_TAKEOFF_PARAMETERS: JumpTakeoffParameters = Object.freeze({
  jumpSpeedX: .95, jumpSpeedXMul: .8, jumpSpeedXMax: 1.6,
});
export function stepDonkeyKongAirVelocity(input: {
  readonly velocityX: number; readonly stickX: number; readonly frozen?: boolean;
}): number {
  if (!Number.isFinite(input.velocityX) || !Number.isFinite(input.stickX) || Math.abs(input.stickX) > 1)
    throw new RangeError('DK air control requires finite velocity and stick in [-1,1]');
  if (input.frozen) return input.velocityX;
  const p = DONKEYKONG_AIR_MOVEMENT_PARAMETERS;
  if (input.stickX === 0) {
    const brake = p.neutralBrake * 5;
    return input.velocityX > 0 ? Math.max(0, input.velocityX - brake)
      : Math.min(0, input.velocityX + brake);
  }
  const direction = Math.sign(input.stickX), maximum = p.stableSpeed * 5;
  // Above the stable speed (a running takeoff, a wall jump) same-direction
  // control adds nothing and air_brake_x relaxes the excess toward the cap,
  // never snapping or dropping below it. Opposite control accelerates as usual.
  if (direction * input.velocityX >= maximum) {
    const relaxed = Math.abs(input.velocityX) - p.neutralBrake * 5;
    return direction * Math.max(maximum, relaxed);
  }
  const acceleration = (p.accelerationAdd + Math.abs(input.stickX) * p.accelerationMultiplier) * 5;
  return direction > 0 ? Math.min(maximum, input.velocityX + acceleration)
    : Math.max(-maximum, input.velocityX - acceleration);
}
