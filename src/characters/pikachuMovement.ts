import type { FighterMovementProfile } from './movesetContract';
import { PIKACHU_UFD_STATS as S, PIKACHU_REFERENCE_PIXELS_PER_UNIT as U } from './pikachuUfdStats';
import { ULTIMATE_LEDGE_REGRAB_PENALTIES } from './ledgeHangState';

/** Velocity solving the repository's discrete rise sum, without copying another
 * fighter's impulse. This is a project integrator calibration to source height,
 * not the native game's jump energy implementation. */
function impulseForHeight(height: number, acceleration: number): number {
  const steps = Math.floor((Math.sqrt(1 + 8 * height / acceleration) - 1) / 2) + 1;
  return height / steps + acceleration * (steps + 1) / 2;
}
const matterGravity = 1000 / 3600;
const nativeGravity = S.gravity * U;
// Calibrated in the live MatchScene against the source full-hop53 / fastfall37
// return clocks while solving the exact177.5px apex. This is authored Matter
// rising acceleration, separate from source falling gravity0.095u/frame².
const fullHopGravity = 0.75;
const fullHopImpulse = impulseForHeight(S.fullHopHeight * U, fullHopGravity);
const shortHopImpulse = impulseForHeight(S.shortHopHeight * U, nativeGravity);

/** Source action/protection intervals: one-based inclusive [a,b] -> [a-1,b).
 * Slide distances and reversal remain reviewed shared-engine calibrations;
 * directional air-dodge travel and timing-dependent landing lag remain gaps.
 * UFD neutral air dodge50 selected over calculator54; disagreement retained.
 */
export const PIKACHU_MOVEMENT_PROFILE: FighterMovementProfile = Object.freeze({
  // Pinned native motion-list extra: cancel is first actionable and xlu_end
  // is exclusive in the one-based source convention. Floor/ledge attack
  // technical pages independently corroborate this conversion. Common hang,
  // distance and takeoff policies remain separate source/status dependencies.
  ledge: Object.freeze({ catchFrames: 19, ...ULTIMATE_LEDGE_REGRAB_PENALTIES,
    attackProtectionFramesByGrab: Object.freeze([25, 20, 12, 0]),
    climbFrames: 32, getupIframes: 31,
    rollFrames: 49, rollIframes: 26, jumpIframes: 12,
    // The sourced ledge attack already carries its full-body status capsule.
    attackIframes: 0 }),
  locomotion: Object.freeze({ walkMaxSpeed: S.walkSpeed * U,
    initialDashSpeed: S.initialDashSpeed * U, initialDashInstantStart: true,
    dashDanceWindowFrames: S.dashFrames, jumpsquatKeepsFacing: true }),
  dodge: Object.freeze({
    spot: Object.freeze({ activeFrames: 16, iframeStartFrame: 2, iframeFrames: 14,
      recoveryFrames: 8, cooldownFrames: 0, slideSpeed: 0 }),
    roll: Object.freeze({ activeFrames: 14, iframeStartFrame: 3, iframeFrames: 11,
      recoveryFrames: 14, cooldownFrames: 0, slideSpeed: 10, reverseFacingFrame: 19 }),
    // Fully stale ends: SmashWiki Roll / Air dodge "Fully stale" columns for Pikachu —
    // back roll 8-13, neutral air 5-24, directional 5-18 (forward roll / spot keep their end).
    backwardRoll: Object.freeze({ activeFrames: 15, iframeStartFrame: 3, iframeFrames: 12,
      recoveryFrames: 18, cooldownFrames: 0, slideSpeed: 10, fullyStaleIframeEndFrame: 13 }),
    air: Object.freeze({ activeFrames: 26, iframeStartFrame: 1, iframeFrames: 25,
      recoveryFrames: 24, cooldownFrames: 0, slideSpeed: 0, fullyStaleIframeEndFrame: 24 }),
    directionalAir: Object.freeze({ activeFrames: 19, iframeStartFrame: 1, iframeFrames: 18,
      recoveryFrames: 66, cooldownFrames: 0, slideSpeed: 0, fullyStaleIframeEndFrame: 18 }),
    directionalAirUpRecoveryFrames: 90, directionalAirDownRecoveryFrames: 50,
    directionalAirUpDiagonalRecoveryFrames: 78, directionalAirDownDiagonalRecoveryFrames: 57,
  }),
  maxRunSpeed: S.runSpeed * U, maxAirSpeed: S.airSpeed * U,
  groundAccel: 0.88, airAccel: S.airAccelerationMax * U,
  groundDamping: 0.8, airDamping: 0.96,
  jumpImpulse: fullHopImpulse, shortHopImpulse,
  riseAccel: fullHopGravity - matterGravity,
  shortHopRiseAccel: nativeGravity - matterGravity,
  airJumpImpulse: impulseForHeight(S.airJumpHeight * U, nativeGravity),
  airJumpRiseAccel: nativeGravity - matterGravity,
  softLandingFrames: S.softLandingFrames, hardLandingFrames: S.hardLandingFrames,
  hardLandingSpeedFrames: 4, airDodgeLandingFrames: 10,
  directionalAirDodgeLandingFrames: 19,
  maxJumps: 2, mass: 7.9, referenceWeight: S.weight,
  referenceLaunch: Object.freeze({ gravity: S.gravity, fallSpeed: S.fallSpeed,
    verticalGravity: 0.068544, verticalFallSpeed: 1.8 }),
  fallAccel: nativeGravity - matterGravity,
  maxFallSpeed: S.fallSpeed * U, fastFallSpeed: S.fastFallSpeed * U,
  jumpCutFactor: shortHopImpulse / fullHopImpulse,
});
