/** Fighter gravity parameters in reference/game units, before pixel conversion. */
export interface ReferenceLaunchProfile {
  readonly gravity: number;
  readonly fallSpeed: number;
  readonly verticalGravity: number;
  readonly verticalFallSpeed: number;
}

const PIXELS_PER_REFERENCE_UNIT = 5;
const VERTICAL_ANGLE_MIN = 1.22173;
const VERTICAL_ANGLE_MAX = 1.91986;

/**
 * Select the vertical-launch gravity branch from the pre-DI launch vector.
 * Screen Y points downward. Facing is separate in the reference calculation,
 * so normalize horizontal mirroring before testing its 70–110 degree window.
 * Source: SSBU-Calculator/js/knockback.js, Knockback.calculate (damageflytop).
 * https://github.com/rubendal/SSBU-Calculator/blob/master/js/knockback.js
 */
export function isVerticalReferenceLaunch(
  vector: { readonly x: number; readonly y: number },
  tumble: boolean,
): boolean {
  if (!tumble || !Number.isFinite(vector.x) || !Number.isFinite(vector.y)) return false;
  const angle = Math.atan2(-vector.y, Math.abs(vector.x));
  return angle >= VERTICAL_ANGLE_MIN && angle <= VERTICAL_ANGLE_MAX;
}

/**
 * Upward pixel velocity added to a tumbling nonvertical launch before DI.
 * The source permits a negative boost for gravity below 0.075; do not clamp it.
 * Set-weight hitboxes suppress this initial boost, not subsequent natural gravity.
 * Source: SSBU-Calculator/js/knockback.js, Knockback.calculate (add_gravity_speed).
 */
export function referenceGravityBoost(
  profile: ReferenceLaunchProfile,
  vertical: boolean,
  tumble: boolean,
  setWeight = false,
): number {
  if (!tumble || vertical || setWeight || !Number.isFinite(profile.gravity)) return 0;
  return 5 * (profile.gravity - 0.075) * PIXELS_PER_REFERENCE_UNIT;
}

/**
 * Advance only the natural-gravity component (positive down, in pixels).
 * Launch velocity, control motion, wind and carried velocity are separate.
 * Vertical launches use their own gravity/cap while stunned, then approach
 * ordinary terminal speed gradually when their component remains above it.
 * The caller owns whether to advance on this step (hitlag pauses this clock).
 * Source: SSBU-Calculator/js/knockback.js, Distance gravity branch.
 */
export function stepReferenceGravity(
  currentY: number,
  profile: ReferenceLaunchProfile,
  vertical: boolean,
  hitstun: boolean,
): number {
  const current = Number.isFinite(currentY) ? Math.max(0, currentY) : 0;
  const gravity = (vertical && hitstun ? profile.verticalGravity : profile.gravity)
    * PIXELS_PER_REFERENCE_UNIT;
  const terminal = (vertical && hitstun ? profile.verticalFallSpeed : profile.fallSpeed)
    * PIXELS_PER_REFERENCE_UNIT;
  if (vertical && !hitstun && current > terminal) {
    return Math.max(terminal, current - gravity);
  }
  return Math.min(terminal, current + gravity);
}
