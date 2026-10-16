/** STAGED for src/characters/linkBow.ts; source-only volley selection.
 * Fresh Ultimate Link/Neutral_special technical Wiki capture. This leaf does
 * not implement startup/rate/cancel, article contact/settlement or target anatomy.
 */
export const LINK_BOW_SOURCE_PARAMETERS = Object.freeze({
  nominalScalingChargeFrames: 60,
  fullTransitionChargeFrames: 36,
  fullHoldMaximumFrames: 180,
  releaseFirstArrowFrame: 1,
  doubleArrowDelayFrames: 3,
  releaseInterruptibleFrame: 30,
  releaseAnimationFrames: 51,
  arrowLifetimeFrames: 46,
  unchargedSpeedNative: 2.6,
  fullyChargedSpeedNative: 10,
  secondArrowSpeedMultiplier: .9,
  doubleArrowDamageMultiplier: .8,
  firingAngleDegrees: 2.5,
  secondArrowAngleDegrees: 2.3,
  gravityNative: .054,
  stuckSingleFrames: 180,
  stuckDoubleFirstFrames: 120,
  stuckDoubleSecondFrames: 30,
  opponentHeadLodgedFrames: 5,
  opponentOtherLodgedFrames: 30,
  minimumStickAngleDegrees: 9,
});

/** chargeFrames is source CHARGE residency, never total button-held duration.
 * Selected public36→FULL is distinct from native body STEP_HOLD, which now has
 * a captured conditional counter clamp to60. Exact public/native entry clock
 * normalization remains separate from either fact.
 */
export function linkBowCharge(chargeFrames: number): {chargeFrames: number; full: boolean; ratio: number} {
  if (!Number.isInteger(chargeFrames) || chargeFrames < 0) throw new RangeError('Link bow charge frames must be a nonnegative integer');
  const charge = chargeFrames;
  const full = charge >= LINK_BOW_SOURCE_PARAMETERS.fullTransitionChargeFrames;
  return {chargeFrames: charge, full, ratio: full ? 1 : charge / LINK_BOW_SOURCE_PARAMETERS.nominalScalingChargeFrames};
}

export interface LinkArrowLaunchPlan {
  /** Release-clock age0 is the public first arrow frame1. */
  readonly releaseAge: number;
  readonly arrowIndex: 0 | 1;
  readonly damage: number;
  readonly speedNative: number;
  readonly firingAngleDegrees: number;
  readonly gravityNative: number;
  readonly lifetimeFrames: number;
  readonly stuckLifetimeFrames: number;
  readonly radiusNative: number;
  readonly referenceKnockback: {readonly angle: number; readonly base: number; readonly growth: number; readonly fixed: number};
  readonly hitlagMultiplier: number;
  readonly sdiMultiplier:1;readonly shieldDamageAdd:0;readonly rehitFrames:0;
  readonly setoff:'on';readonly lrCheck:'forward';readonly situation:'ground-air';
  readonly targetCategory:'all';readonly absorbable:false;readonly friendlyFire:false;
  readonly reflectable: true;
  readonly direct: false;
}

/** A picked-up arrow is a source double volley, not a1.5damage approximation.
 * Selected primary caller resolves ambiguous Wiki antecedent: interpolate
 * float4→12, apply FULL multiplier1 and DOUBLE multiplier.8, then convert once
 * to integer attack power. Prior nested Wiki interpretation is historical.
 * Native patch/decompiler/accessor/float precision parity remains separate.
 * Only the second arrow receives the source .9speed multiplier.
 */
export function selectLinkBowVolley(chargeFrames: number, hasPickedUpArrow: boolean): readonly LinkArrowLaunchPlan[] {
  const charge = linkBowCharge(chargeFrames), parameters = LINK_BOW_SOURCE_PARAMETERS;
  const damage = Math.floor((4 + 8 * charge.ratio) *
    (hasPickedUpArrow ? parameters.doubleArrowDamageMultiplier : 1));
  const speed = parameters.unchargedSpeedNative +
    (parameters.fullyChargedSpeedNative - parameters.unchargedSpeedNative) * charge.ratio;
  // Native361 is explicitly the Wiki single/double Projectile hitbox angle;
  // it is unrelated to the physical firing elevation2.5/2.3degrees above.
  const knockback = Object.freeze({angle: 361, base: hasPickedUpArrow ? 25 : 10,
    growth: hasPickedUpArrow ? 110 : 71, fixed: 0});
  const first: LinkArrowLaunchPlan = Object.freeze({releaseAge: 0, arrowIndex: 0, damage,
    speedNative: speed, firingAngleDegrees: parameters.firingAngleDegrees,
    gravityNative: parameters.gravityNative, lifetimeFrames: parameters.arrowLifetimeFrames,
    stuckLifetimeFrames: hasPickedUpArrow ? parameters.stuckDoubleFirstFrames : parameters.stuckSingleFrames,
    radiusNative: 1.35, referenceKnockback: knockback, hitlagMultiplier: .8,sdiMultiplier:1,
    shieldDamageAdd:0,rehitFrames:0,setoff:'on',lrCheck:'forward',situation:'ground-air',
    targetCategory:'all',absorbable:false,friendlyFire:false,reflectable: true, direct: false});
  if (!hasPickedUpArrow) return Object.freeze([first]);
  const second: LinkArrowLaunchPlan = Object.freeze({...first, releaseAge: parameters.doubleArrowDelayFrames,
    arrowIndex: 1, speedNative: speed * parameters.secondArrowSpeedMultiplier,
    firingAngleDegrees: parameters.secondArrowAngleDegrees, stuckLifetimeFrames: parameters.stuckDoubleSecondFrames});
  return Object.freeze([first, second]);
}

/** Thrown stuck-arrow item packet, separate from generated bow projectiles.
 * Receiving box lengths and native units are retained; article runtime supplies
 * actual source speed/geometry and owns reflection/shield/impact retirement.
 */
export const LINK_THROWN_ARROW_SOURCE = Object.freeze({
  baseDamage: 1, damageAdd: -.4, speedDamageMultiplier: .8,
  throwSpeedMultiplier: 1, gravityNative: .053, terminalFallSpeedNative: 2.3,
  airBrakeNative: .0025, groundBrakeNative: .03, lifetimeFrames: 40,
  collisionHalfSizeNative: Object.freeze({x: 3.5, y: 3}),
  pickupSizeNative: Object.freeze({x: 7, y: 6}),
  radiusNative: 1.35, referenceKnockback: Object.freeze({angle: 361, base: 10, growth: 66, fixed: 0}),
  hitlagMultiplier: 1, disappearsOnTerrainOrTarget: true, disappearsWhenShielded: true,
});
