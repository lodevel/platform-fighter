/** STAGED for src/characters/linkBoomerang.ts.
 * Fresh Ultimate technical Side_special capture, revision1840696. This leaf
 * retains phase packets and entry branches; article motion/clock consumers,
 * ownership transfer, source throw flick admission and anatomy remain separate.
 */
export type LinkBoomerangThrowKind = 'tilt' | 'smash';
export type LinkBoomerangContactPhase = 'clean' | 'late' | 'return';

export const LINK_BOOMERANG_SOURCE = Object.freeze({
  throwReleaseFrame: 27,
  successfulThrowFAF: 46,
  failedGroundThrowFAF: 60,
  failedAirThrowFAF: 46,
  throwAnimationFrames: 63,
  catchFAF: 10,
  catchAnimationFrames: 31,
  stickAngleSensitivity: .1,
  maximumVerticalDeviationDegrees: 26,
  initialSpeedNative: Object.freeze({tilt: 2.4, smash: 3.1}),
  rotationDegrees: Object.freeze({tilt: 22, smash: 26}),
  decelerationNative: .047,
  minimumSpeedNative: .3,
  turningDistanceNative: Object.freeze({tilt: 16, smash: 24}),
  returnMaximumSpeedNative: 3,
  returnAngleStepDegrees: .75,
  floorThroughAngleDifferenceDegrees: 30,
  minimumGroundBounceAngleDegrees: 16,
  downwardGroundCollisionRangeNative: -.5,
  /** Retain both: exact native lifetime counter-to-public-step consumer missing. */
  publicLifetimeFrames: Object.freeze({tilt: 125, smash: 167}),
  codedLifetimeFrames: Object.freeze({tilt: 129, smash: 171}),
  smashOutgoingDamageMultiplier: 1.2,
  clash: Object.freeze({lifetimeFrames: 60, horizontalSpeedNative: -.15,
    verticalSpeedNative: 1.25, gravityNative: .09, terminalFallSpeedNative: 1.4,
    rotationMultiplier: .2}),
});

/** Public one-based action windows retained as reference, not imposed on a
 * reflected/bounced article's actual phase without the native status mapping. */
export const LINK_BOOMERANG_REFERENCE_WINDOWS = Object.freeze({
  tilt: Object.freeze({clean: Object.freeze([27,36] as const), late: Object.freeze([37,71] as const), return: Object.freeze([72,151] as const)}),
  smash: Object.freeze({clean: Object.freeze([27,36] as const), late: Object.freeze([37,86] as const), return: Object.freeze([87,192] as const)}),
});

const PHASE_PACKETS = Object.freeze({
  clean: Object.freeze({damage: 8, shieldDamageAdd: -4, radiusNative: 4,
    referenceKnockback: Object.freeze({angle: 70, base: 80, growth: 40, fixed: 0})}),
  late: Object.freeze({damage: 6, shieldDamageAdd: -3, radiusNative: 3.6,
    referenceKnockback: Object.freeze({angle: 65, base: 60, growth: 40, fixed: 0})}),
  return: Object.freeze({damage: 3, shieldDamageAdd: -1.5, radiusNative: 3.6,
    referenceKnockback: Object.freeze({angle: 70, base: 50, growth: 40, fixed: 0})}),
});

/** Caller supplies the actual source-owned article phase. Smash affects only
 * outgoing damage; native shield-damage additions remain separate, with their
 * modifier consumer explicitly pending instead of inferred from half-damage.
 */
export function linkBoomerangContact(phase: LinkBoomerangContactPhase, kind: LinkBoomerangThrowKind) {
  const packet = PHASE_PACKETS[phase];
  return Object.freeze({...packet,
    damage: packet.damage * (kind==='smash'&&phase!=='return'?LINK_BOOMERANG_SOURCE.smashOutgoingDamageMultiplier:1),
    hitlagMultiplier: 1,sdiMultiplier:1,rehitFrames:0,setoff:'on' as const,lrCheck:'speed' as const,
    situation:'ground-air' as const,targetCategory:'all' as const,absorbable:false as const,
    friendlyFire:false as const,reflectable: true as const, direct: false as const});
}

/** Existing article makes the source blank/failed branch, not a duplicate
 * projectile. Catch animation is permitted only when otherwise uncommitted;
 * catch always retires the article's outgoing contact before that presentation.
 */
export function linkBoomerangEntry(hasOwnerArticle: boolean, grounded: boolean) {
  return hasOwnerArticle
    ? Object.freeze({kind:'failed' as const,generate:false,
        FAF:grounded?LINK_BOOMERANG_SOURCE.failedGroundThrowFAF:LINK_BOOMERANG_SOURCE.failedAirThrowFAF})
    : Object.freeze({kind:'throw' as const,generate:true,FAF:LINK_BOOMERANG_SOURCE.successfulThrowFAF});
}
export function linkBoomerangCatch(otherwiseUncommitted: boolean) {
  return Object.freeze({retireArticleContact:true,playCatchAnimation:otherwiseUncommitted,
    FAF:otherwiseUncommitted?LINK_BOOMERANG_SOURCE.catchFAF:null});
}
