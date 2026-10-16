/** DK-only running/braking adapter. Native scalar declarations are pinned in
 * mechanics/sources/native-fighter-donkey-context.json. Running's additive
 * rule and constant braking are published experimental research, retained in
 * mechanics/movement-source-research.json; native controller update/setup
 * bodies are unavailable. Walking is deliberately outside this adapter.
 */
export const DONKEYKONG_GROUND_MOVEMENT_PARAMETERS = Object.freeze({
  runAccelerationMultiplier: 0.07337,
  runAccelerationAdd: 0.044,
  runSpeedMaximum: 1.873,
  groundBrake: 0.123,
});

export interface DonkeyKongGroundMovementInput {
  readonly velocityX: number;
  readonly stickX: number;
  readonly phase: 'run' | 'brake';
  readonly frozen?: boolean;
}

function approach(value: number, target: number, amount: number): number {
  return value < target ? Math.min(target, value + amount)
    : Math.max(target, value - amount);
}

/** Caller owns initial dash, run-turn legality, attack/landing interruption,
 * and analog deadzone. A nonzero run stick receives sign*(add+abs(stick)*mul),
 * scaled at five pixels/native unit. Signed symmetry and exact cap crossing
 * are explicit 2D adapters to the published positive-speed equation.
 * Same-direction overspeed decelerates by traction instead of snapping to
 * run maximum. Brake/neutral approaches zero without reversing direction.
 * Disable any second generic damping for the velocity this returns.
 */
export function stepDonkeyKongGroundVelocity(input: DonkeyKongGroundMovementInput): number {
  if (!Number.isFinite(input.velocityX) || !Number.isFinite(input.stickX)
    || Math.abs(input.stickX) > 1) {
    throw new RangeError('DK movement requires finite velocity and stick in [-1,1]');
  }
  if (input.frozen) return input.velocityX;
  const p = DONKEYKONG_GROUND_MOVEMENT_PARAMETERS;
  if (input.phase === 'brake' || input.stickX === 0) {
    return approach(input.velocityX, 0, p.groundBrake * 5);
  }
  const direction = Math.sign(input.stickX);
  const target = direction * p.runSpeedMaximum * 5;
  if (direction * input.velocityX > p.runSpeedMaximum * 5) {
    return approach(input.velocityX, target, p.groundBrake * 5);
  }
  const acceleration = (p.runAccelerationAdd
    + Math.abs(input.stickX) * p.runAccelerationMultiplier) * 5;
  return approach(input.velocityX, target, acceleration);
}
