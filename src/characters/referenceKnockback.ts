/** Damage-based or fixed knockback, using Smash reference units. */
export interface ReferenceKnockbackSpec {
  /** Base knockback, added after the weight-dependent growth term. */
  readonly base: number;
  /** Knockback growth percentage (82 means 82%). */
  readonly growth: number;
  /** Degrees above forward; 361 is Sakurai, 366/367 are contextual autolink codes. */
  readonly angle: number;
  /** Nonzero selects the weight-based fixed-KB formula, independent of damage/percent. */
  readonly fixed?: number;
  /** Use weight 100 and suppress the initial gravity boost, retaining normal gravity. */
  readonly setWeight?: boolean;
  /** Extra ordinary reaction frames, added after hitstun calculation without changing tumble. */
  readonly additionalHitstunFrames?: number;
}

export interface ReferenceKnockbackResult {
  /** Resolved source angle before LR/DI/gravity folding; contextual autolink remains unknown. */
  readonly nativeLaunchAngleRadians:number|null;
  readonly vector: { readonly x: number; readonly y: number };
  readonly magnitude: number;
  /** Screen-space radians, after facing has mirrored the horizontal axis. */
  readonly angle: number;
  readonly hitstunFrames: number;
  readonly referenceKnockback: number;
  readonly launchDecayPerFrame: number;
  readonly tumble: boolean;
}

/** Local spatial conversion shared with the fighter movement calibration. */
export const REFERENCE_KNOCKBACK_PIXELS_PER_UNIT = 5;
export const REFERENCE_LAUNCH_DECAY_PER_FRAME = 0.051 * REFERENCE_KNOCKBACK_PIXELS_PER_UNIT;

function nonnegativeFinite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

export function isFixedReferenceKnockback(spec: ReferenceKnockbackSpec | undefined): boolean {
  return spec?.fixed !== undefined && Number.isFinite(spec.fixed) && spec.fixed > 0;
}

function resolveAngle(angle: number, knockback: number, grounded: boolean): number {
  // Grounded autolink and context-free math retain the previous 80-degree
  // calibration, also used by diagnostic applyHit calls lacking contact
  // context. Character replaces airborne release transport from contact
  // metadata; reference magnitude and reaction frames remain independent.
  if (angle === 366 || angle === 367) return 80;
  if (angle === 361) {
    // Preserve the reference's airborne radian constant rather than rounding it.
    if (!grounded) return 0.663225 * 180 / Math.PI;
    if (knockback < 60) return 0;
    if (knockback >= 88) return 38;
    return Math.min((knockback - 60) * 38 / 28 + 1, 38);
  }
  return Number.isFinite(angle) ? ((angle % 360) + 360) % 360 : 0;
}

/**
 * Ordinary, non-windbox launch before DI, using an already accumulated percent.
 * The move's damage participates in growth; it is not added to percent again.
 * Reference weight is a fighter stat, independent of the Matter collision mass.
 *
 * Formula, hitstun, speed and decay:
 * https://github.com/rubendal/SSBU-Calculator/blob/master/js/formulas.js
 * Angle-zero launch correction and tumble:
 * https://github.com/rubendal/SSBU-Calculator/blob/master/js/knockback.js
 *
 * `multiplier` carries explicit launch modifiers (e.g. crouch reduction).
 * Fixed knockback ignores damage/percent and attacker rage/staling; callers
 * must not fold those attacker modifiers into a fixed record. Character adds gravity
 * boost, groups hitstun ticks, and applies DI/LSI when hitlag ends; this helper
 * returns the ordinary, uninfluenced result used to select those rules.
 */
export function computeReferenceKnockback(
  spec: ReferenceKnockbackSpec,
  postHitPercent: number,
  moveDamage: number,
  targetWeight = 100,
  facing: 1 | -1 = 1,
  grounded = false,
  multiplier = 1,
): ReferenceKnockbackResult {
  // Percent follows the game's existing [0, 999] damage-meter contract.
  const percent = Number.isNaN(postHitPercent) ? 0 : Math.min(999, Math.max(0, postHitPercent));
  const damage = nonnegativeFinite(moveDamage);
  const weight = spec.setWeight === true ? 100
    : Number.isFinite(targetWeight) && targetWeight > 0 ? targetWeight : 100;
  const growth = nonnegativeFinite(spec.growth) / 100;
  const base = nonnegativeFinite(spec.base);
  const modifier = nonnegativeFinite(multiplier, 1);
  const weightedGrowth = (isFixedReferenceKnockback(spec) ? 1 + spec.fixed! / 2
    : percent / 10 + percent * damage / 20) * 1.4 * 200 / (weight + 100);
  const referenceKnockback = nonnegativeFinite(((weightedGrowth + 18) * growth + base) * modifier);
  let launchAngle = resolveAngle(spec.angle, referenceKnockback, grounded);
  let groundedZeroAngle = grounded && launchAngle === 0;
  if ((launchAngle === 0 || launchAngle === 180) && referenceKnockback >= 120) {
    launchAngle = 32;
    groundedZeroAngle = false;
  }
  const radians = launchAngle * Math.PI / 180;
  const magnitude = referenceKnockback * 0.03 * REFERENCE_KNOCKBACK_PIXELS_PER_UNIT
    * (groundedZeroAngle ? 0.8 : 1);
  const vx = magnitude * Math.cos(radians) * facing;
  const vy = -magnitude * Math.sin(radians);
  const vector = { x: vx === 0 ? 0 : vx, y: vy === 0 ? 0 : vy };
  const ordinaryHitstun = Math.floor(Math.max(5, referenceKnockback * 0.4)) - 1;
  const hitstunFrames = ordinaryHitstun + Math.trunc(nonnegativeFinite(spec.additionalHitstunFrames ?? 0));
  return {
    // SmashWiki Autolink_angle: grounded 367 "always uses an angle of 80°", so it
    // reports that real launch angle; 366 and airborne 367 are contextual.
    nativeLaunchAngleRadians:spec.angle===366||spec.angle===367&&!grounded?null:radians,
    vector,
    magnitude,
    angle: magnitude === 0 ? 0 : Math.atan2(vector.y, vector.x),
    hitstunFrames,
    referenceKnockback,
    launchDecayPerFrame: REFERENCE_LAUNCH_DECAY_PER_FRAME,
    tumble: ordinaryHitstun + 1 >= 32,
  };
}
