/**
 * The angle (degrees) a Phaser game object reports after `setAngle(degrees)`:
 * Phaser wraps degrees to [-180, 180), stores radians wrapped to [-π, π) and
 * converts back on read. The ordinary-projectile checkpoint has always
 * recorded that read-back value, so the simulation records it the same way
 * without a game object (bit-identical, Phaser's own arithmetic).
 */
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function wrap(value: number, min: number, max: number): number {
  const range = max - min;
  return min + ((((value - min) % range) + range) % range);
}

export function displayAngleDegrees(degrees: number): number {
  const rotation = wrap(wrap(degrees, -180, 180) * DEG_TO_RAD, -Math.PI, Math.PI);
  return wrap(rotation * RAD_TO_DEG, -180, 180);
}
