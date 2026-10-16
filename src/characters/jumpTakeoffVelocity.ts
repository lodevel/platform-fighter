/** Ground-jump takeoff horizontal speed parameters, in native units per frame
 * (Smash Ultimate fighter_param jump_speed_x / jump_speed_x_mul / jump_speed_x_max).
 * Their Brawl attribute analogues sit in the same order: "jump x init vel"
 * (stick term), "jump x vel ground mult" (ground-momentum term) and
 * "jump x init term vel" (cap). */
export interface JumpTakeoffParameters {
  readonly jumpSpeedX: number;
  readonly jumpSpeedXMul: number;
  readonly jumpSpeedXMax: number;
}

/** Horizontal velocity on the takeoff step of a grounded jump (full or short
 * hop, forward or back), in world px/step:
 *   stick * jumpSpeedX + groundSpeed * jumpSpeedXMul, clamped to +-jumpSpeedXMax.
 * `groundVelocityX` is world px/step; `pixelsPerUnit` converts native units. */
export function groundJumpTakeoffVelocityX(
  params: JumpTakeoffParameters, groundVelocityX: number, stickX: number, pixelsPerUnit: number,
): number {
  const native = stickX * params.jumpSpeedX + groundVelocityX / pixelsPerUnit * params.jumpSpeedXMul;
  return Math.max(-params.jumpSpeedXMax, Math.min(params.jumpSpeedXMax, native)) * pixelsPerUnit;
}
