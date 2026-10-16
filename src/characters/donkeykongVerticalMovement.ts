/** Ordinary DK vertical motion. Evidence: mechanics/ordinary-vertical-source-contract.json.
 * Native heights/gravity and the published mini/air impulse formula are sourced.
 * Full hop's first-four-step linear curve is authored: native initial speed and
 * acceleration consumers are unavailable. It fits initial height18.7 and total34
 * using ordinary gravity after four steps; its discrete peak error is <.001px.
 * Velocities use screen Y (positive downward), at five world pixels/native unit.
 * Caller owns phase age, interruptions and excludes native launch/special energies.
 */
export const DONKEYKONG_VERTICAL_PARAMETERS = Object.freeze({
  worldUnitsPerNativeUnit: 5,
  gravityNative: .085,
  fullHopHeightNative: 34,
  fullHopInitialHeightNative: 18.7,
  fullHopInitialSteps: 4,
  miniHopHeightNative: 17.3,
  airJumpHeightNative: 35.5,
  fallSpeedNative: 1.63,
  fastFallSpeedNative: 2.608,
  excessFallBrakeNative: .015,
});
const p = DONKEYKONG_VERTICAL_PARAMETERS;
const gravity = p.gravityNative * p.worldUnitsPerNativeUnit;

/** Published 0F impulse; the first physics step subtracts g before movement.
 * Do not pass the observed1F value through another gravity dose. */
function ballisticImpulse(heightNative: number): number {
  return (Math.sqrt(2 * p.gravityNative * heightNative) + p.gravityNative / 2)
    * p.worldUnitsPerNativeUnit;
}
export const DONKEYKONG_MINI_HOP_IMPULSE = ballisticImpulse(p.miniHopHeightNative);
export const DONKEYKONG_AIR_JUMP_IMPULSE = ballisticImpulse(p.airJumpHeightNative);

const fullHopTailVelocity = ballisticImpulse(p.fullHopHeightNative - p.fullHopInitialHeightNative);
// For four linear prescribed displacements d1..d4, sum=4*d4+6*deceleration.
// d4 is the ballistic tail's0F velocity, so step5 continues with ordinary g.
const initialDeceleration = (p.fullHopInitialHeightNative * p.worldUnitsPerNativeUnit
  - p.fullHopInitialSteps * fullHopTailVelocity) / 6;
export interface DonkeyKongOrdinaryVerticalProfile {
  readonly totalGravity: number;
  /** Four signed post-physics displacements, indexed by unfrozen phase age0..3.
   * These are selected calibration, never native velocity samples. */
  readonly fullHopStepVelocitiesY: readonly number[];
}
export const DONKEYKONG_ORDINARY_VERTICAL_PROFILE: DonkeyKongOrdinaryVerticalProfile = Object.freeze({
  totalGravity: gravity,
  fullHopStepVelocitiesY: Object.freeze(Array.from({ length: p.fullHopInitialSteps }, (_, i) =>
    -(fullHopTailVelocity + (p.fullHopInitialSteps - 1 - i) * initialDeceleration))),
});
/** Ordinary velocity the body carries out of the opening after `consumedSteps`
 * prescribed displacements: the0F speed whose ordinary-gravity rise covers the
 * rest of the uninterrupted hop (same convention as `ballisticImpulse`). An
 * owner that interrupts the opening inherits this, never a calibrated sample.
 * Once every sample is consumed the last one already is the ballistic tail. */
export function donkeyKongFullHopCarriedVelocityY(profile: DonkeyKongOrdinaryVerticalProfile,
  consumedSteps: number): number {
  const samples = profile.fullHopStepVelocitiesY, g = profile.totalGravity, tail = samples[samples.length - 1]!;
  if (consumedSteps >= samples.length || !(g > 0)) return tail;
  const tailRise = Math.max(0, -tail - g / 2) ** 2 / (2 * g);
  const remainingRise = samples.slice(consumedSteps).reduce((rise, sample) => rise - sample, tailRise);
  return -(Math.sqrt(2 * g * Math.max(0, remainingRise)) + g / 2);
}
export const DONKEYKONG_FALL_SPEED =p.fallSpeedNative * p.worldUnitsPerNativeUnit;
export const DONKEYKONG_FAST_FALL_SPEED = p.fastFallSpeedNative * p.worldUnitsPerNativeUnit;

/** Full-footstool's accelerated native basis remains unrecovered. Keep this
 * separately named legacy calibration rather than multiplying the new large
 * first full-hop step by the sourced tread multiplier. Carry's common JUMP
 * kinetic uses the selected ordinary full/mini profile, an explicit adapter. */
export const DONKEYKONG_FOOTSTOOL_BETA_JUMP_BASIS = 14.305555555555552;

export function stepDonkeyKongOrdinaryVertical(input: {
  readonly velocityY: number;
  readonly fullHopStep?: number | null;
  readonly fastFall?: boolean;
  readonly relaxExcessFall?: boolean;
  readonly frozen?: boolean;
}): number {
  if (!Number.isFinite(input.velocityY)) throw new RangeError('DK vertical velocity must be finite');
  if (input.fullHopStep !== undefined && input.fullHopStep !== null
    && (!Number.isInteger(input.fullHopStep) || input.fullHopStep < 0)) {
    throw new RangeError('DK full-hop age must be a nonnegative integer');
  }
  if (input.frozen) return input.velocityY;
  const prescribed = input.fullHopStep === undefined || input.fullHopStep === null ? undefined
    : DONKEYKONG_ORDINARY_VERTICAL_PROFILE.fullHopStepVelocitiesY[input.fullHopStep];
  if (prescribed !== undefined) return prescribed;
  // Neutral air dodge and aerial item throws relax existing excess fall speed.
  // This phase replaces ordinary gravity and does not reset to terminal at once.
  if (input.relaxExcessFall && input.velocityY > DONKEYKONG_FALL_SPEED) {
    return Math.max(DONKEYKONG_FALL_SPEED,
      input.velocityY - p.excessFallBrakeNative * p.worldUnitsPerNativeUnit);
  }
  if (input.fastFall) return DONKEYKONG_FAST_FALL_SPEED;
  return Math.min(DONKEYKONG_FALL_SPEED, input.velocityY + gravity);
}

/** Matter adds this world's gravity after prepare. Subtract it exactly once
 * from the desired post-physics velocity; shared launch/special owners bypass. */
export function donkeyKongVerticalPrePhysicsVelocity(postPhysicsVelocityY: number,
  worldGravityDoseY: number): number {
  if (!Number.isFinite(postPhysicsVelocityY) || !Number.isFinite(worldGravityDoseY)) {
    throw new RangeError('DK physics adapter requires finite velocity and gravity');
  }
  return postPhysicsVelocityY - worldGravityDoseY;
}
