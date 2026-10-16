import { PIKACHU_MOVEMENT_PROFILE } from './pikachuMovement';
/**
 * Per-fighter movement profile data — Sub-AC 2.2 of the T2 refactor track.
 *
 * Holds the canonical {@link FighterMovementProfile} value for every
 * registered fighter in ONE pure-data
 * leaf module. The Seed's per-fighter refactor calls for each subclass
 * to OWN its movement profile (speed, jump, air control, gravity, mass),
 * with the shared {@link Character} base class no longer holding a
 * generic one-size-fits-all default. To make that work without a
 * circular import — `Character.ts` cannot import from `DonkeyKong.ts`
 * because `DonkeyKong extends Character`, and the class-extension TDZ would fault on
 * module load — the profile data lives in this leaf module.
 *
 * # Ownership and re-export pattern
 *
 * Each per-fighter file (`DonkeyKong.ts`, …) imports its profile from
 * here and **re-exports it** under the existing public name
 * (`DONKEYKONG_MOVEMENT_PROFILE`, etc.). That re-export is
 * deliberate: the per-fighter file remains the natural API surface a
 * consumer reaches for ("look up DK's stats? import from `DonkeyKong.ts`"),
 * while the architectural source of truth — the literal data — lives in
 * one leaf module that nobody else can fork. The two-level split keeps
 * both invariants honest:
 *
 *   1. Per-fighter ownership: changing DK's air control means editing
 *      `DONKEYKONG_MOVEMENT_PROFILE` here (which DonkeyKong.ts re-exports);
 *      no movement-default lives on `Character`.
 *   2. No circular imports: `Character.ts` imports
 *      {@link getFighterMovementProfile} from this leaf module, which
 *      depends only on the {@link FighterMovementProfile} type and the
 *      {@link CharacterId} union — neither of which transitively loads
 *      a per-fighter class.
 *
 * # Determinism
 *
 * Every value is a finite, frozen literal. Importing this module
 * produces the same bytes on every boot, which the deterministic
 * fixed-step simulation and replay system require: identical movement
 * profiles always integrate to identical trajectories.
 */

import type { CharacterId } from '../types';
import type { FighterMovementProfile } from './movesetContract';
import { FRESH_LINK_MOVEMENT_PROFILE as LINK_MOVEMENT_PROFILE } from './linkFreshMovement';
import { DONKEYKONG_UFD_STATS, DONKEYKONG_REFERENCE_PIXELS_PER_UNIT } from './donkeykongUfdStats';
import { ULTIMATE_LEDGE_REGRAB_PENALTIES, ULTIMATE_LEDGE_OPTION_INTANGIBILITY_SCALE_BY_GRAB } from './ledgeHangState';
import {DONKEYKONG_ORDINARY_VERTICAL_PROFILE,DONKEYKONG_MINI_HOP_IMPULSE,DONKEYKONG_AIR_JUMP_IMPULSE} from './donkeykongVerticalMovement';

// ---------------------------------------------------------------------------
// Per-fighter movement profile constants
// ---------------------------------------------------------------------------

/** Link's single profile lives in its own leaf module (like Pikachu's); re-exported here. */
export { LINK_MOVEMENT_PROFILE };

/**
 * Donkey Kong — mobile heavyweight bruiser archetype: heavy mass with a
 * real run speed and usable air control, so the big ape can chase and
 * approach. The identity is heavyweight HITS delivered WITH mobility.
 */
export const DONKEYKONG_MOVEMENT_PROFILE: FighterMovementProfile = Object.freeze({
  // Current UFD stats, selected over conflicting historical motion-list roll49.
  // catchFrames: g01cliffcatch first actionable frame 20 (one-based) -> 19 steps, the Pikachu convention; shows the ledge_catch clip.
  // Regrab penalties (SmashWiki Edge): 6 grabs before landing, catch slowdown from the 3rd
  // grab, getup-option intangibility ×0.8 / ×0.5 / none after the 1st / 2nd / 3rd regrab.
  // Ledge attack (SmashWiki DK/Edge_attack): intangible 1–25, 1–20 (2nd grab), 1–12 (3rd), none
  // from the 4th; the sourced CliffAttack carries that whole-body window, so attackIframes is 0.
  ledge: Object.freeze({catchFrames: 19, climbFrames: 34, getupIframes: 33, rollFrames: 45,
    rollIframes: 28, attackIframes: 0, jumpIframes: 12, ...ULTIMATE_LEDGE_REGRAB_PENALTIES,
    optionIntangibilityScaleByGrab: ULTIMATE_LEDGE_OPTION_INTANGIBILITY_SCALE_BY_GRAB,
    attackProtectionFramesByGrab: Object.freeze([25, 20, 12, 0])}),
  // Ground locomotion — UFD stats converted at 5 px per unit
  // (docs/review/2026-09-25/donkeykong-character/README.md).
  locomotion: Object.freeze({
    walkMaxSpeed: DONKEYKONG_UFD_STATS.walkSpeed * DONKEYKONG_REFERENCE_PIXELS_PER_UNIT,
    initialDashSpeed: DONKEYKONG_UFD_STATS.initialDashSpeed * DONKEYKONG_REFERENCE_PIXELS_PER_UNIT,
    initialDashInstantStart: true,
    dashDanceWindowFrames: DONKEYKONG_UFD_STATS.dashFrames,
    // Ultimate: no turn in jumpsquat; stick away from facing = back jump (jump_b).
    jumpsquatKeepsFacing: true,
    // Run speed inherits maxRunSpeed. Pivot dash (UFD 17) is the dash_turn's
    // run eligibility in donkeykongTurnBrake.ts.
  }),
  // https://ultimateframedata.com/donkey_kong "Dodges / Rolls" (2026-09-25).
  // Frame 1 is elapsed step 0; intangible [a, b] → iframeStartFrame a − 1,
  // iframeFrames b − a + 1; activeFrames b; recovery = total − b.
  dodge: Object.freeze({
    // Spot dodge: 26 total (21 with cancel), intangible 3–17.
    spot: Object.freeze({ activeFrames: 17, iframeStartFrame: 2, iframeFrames: 15,
      recoveryFrames: 9, cooldownFrames: 0, slideSpeed: 0 }),
    // Forward roll: 30 total, intangible 4–15. Slide speed and the facing
    // reversal frame are project calibration shared with Link.
    // Fully stale ends (fullyStaleIframeEndFrame): SmashWiki Roll / Air dodge
    // "Fully stale" columns for DK — fwd roll 8-14, back roll 9-14, neutral air
    // 7-29, directional 7-21 (the universal start delay is in dodgeState.ts).
    roll: Object.freeze({ activeFrames: 15, iframeStartFrame: 3, iframeFrames: 12,
      recoveryFrames: 15, cooldownFrames: 0, slideSpeed: 10, reverseFacingFrame: 19, fullyStaleIframeEndFrame: 14 }),
    // Backward roll: 35 total, intangible 5–16.
    backwardRoll: Object.freeze({ activeFrames: 16, iframeStartFrame: 4, iframeFrames: 12,
      recoveryFrames: 19, cooldownFrames: 0, slideSpeed: 10, fullyStaleIframeEndFrame: 14 }),
    // Neutral air dodge: 48 total, intangible 4–32.
    air: Object.freeze({ activeFrames: 32, iframeStartFrame: 3, iframeFrames: 29,
      recoveryFrames: 16, cooldownFrames: 0, slideSpeed: 0, fullyStaleIframeEndFrame: 29 }),
    // Directional air dodge: intangible 4–22; totals 82 side / 66 down /
    // 73 diagonal-down / 88 diagonal-up / 109 up.
    directionalAir: Object.freeze({ activeFrames: 22, iframeStartFrame: 3, iframeFrames: 19,
      recoveryFrames: 60, cooldownFrames: 0, slideSpeed: 0, fullyStaleIframeEndFrame: 21 }),
    directionalAirUpRecoveryFrames: 87,
    directionalAirDownRecoveryFrames: 44,
    directionalAirUpDiagonalRecoveryFrames: 66,
    directionalAirDownDiagonalRecoveryFrames: 51,
  }),
  maxRunSpeed: DONKEYKONG_UFD_STATS.runSpeed * DONKEYKONG_REFERENCE_PIXELS_PER_UNIT, // 9.365
  maxAirSpeed: DONKEYKONG_UFD_STATS.airSpeed * DONKEYKONG_REFERENCE_PIXELS_PER_UNIT, // 6.04
  groundAccel: 0.68, // engine approximation; Ultimate ground acceleration is not modelled
  airAccel: DONKEYKONG_UFD_STATS.airAccelerationMax * DONKEYKONG_REFERENCE_PIXELS_PER_UNIT, // 0.3
  groundDamping: 0.79,
  airDamping: 0.95,
  // Ordinary DK replaces the actual world dose with total native .425.
  // Full hop uses an authored four-step opening constrained by published
  // first-four rise93.5 and total height170; native initial acceleration is
  // unrecovered. Mini/air0F impulses use the published ballistic formula.
  donkeykongOrdinaryVertical:DONKEYKONG_ORDINARY_VERTICAL_PROFILE,
  jumpImpulse: -DONKEYKONG_ORDINARY_VERTICAL_PROFILE.fullHopStepVelocitiesY[0]!,
  shortHopImpulse: DONKEYKONG_MINI_HOP_IMPULSE,
  // Legacy extra-acceleration fields remain for separately owned common
  // dodge adapters; ordinary DK bypasses them, so they are not total gravity.
  riseAccel: 0.3,
  shortHopRiseAccel: 0.1472222222222222, // 0.425 − 0.2778 world
  airJumpImpulse: DONKEYKONG_AIR_JUMP_IMPULSE,
  airJumpRiseAccel: 0.1472222222222222,
  softLandingFrames: DONKEYKONG_UFD_STATS.softLandingFrames,
  hardLandingFrames: DONKEYKONG_UFD_STATS.hardLandingFrames,
  // Terminal-speed duration is a project calibration (same as Link).
  hardLandingSpeedFrames: 4,
  // https://ultimateframedata.com/donkey_kong: neutral air-dodge landing lag 10;
  // directional 11–19, larger the earlier DK lands (SmashWiki Air dodge;
  // interpolated over the dodge's progress like the native status' lerp of
  // motion frame / end frame).
  airDodgeLandingFrames: 10,
  directionalAirDodgeLandingFrames: 19,
  directionalAirDodgeLateLandingFrames: 11,
  maxJumps: 2,
  mass: 18, // legacy engine mass (heavy); launches use referenceWeight
  referenceWeight: DONKEYKONG_UFD_STATS.weight, // 127
  referenceLaunch: Object.freeze({ gravity: 0.085, fallSpeed: 1.63,
    verticalGravity: 0.084672, verticalFallSpeed: 1.8 }),
  fallAccel: 0.3,
  maxFallSpeed: DONKEYKONG_UFD_STATS.fallSpeed * DONKEYKONG_REFERENCE_PIXELS_PER_UNIT, // 8.15
  fastFallSpeed: DONKEYKONG_UFD_STATS.fastFallSpeed * DONKEYKONG_REFERENCE_PIXELS_PER_UNIT, // 13.04
  jumpCutFactor: DONKEYKONG_MINI_HOP_IMPULSE / -DONKEYKONG_ORDINARY_VERTICAL_PROFILE.fullHopStepVelocitiesY[0]!,
});

// ---------------------------------------------------------------------------
// Per-id lookup
// ---------------------------------------------------------------------------

/**
 * Frozen indexed lookup of {@link CharacterId} → {@link FighterMovementProfile}.
 * Exhaustive over the {@link CharacterId} union — adding a new fighter
 * id to the union without populating this map surfaces as a TypeScript
 * error at compile time (the `Record<CharacterId, …>` type forces every
 * id literal to be present).
 */
export const FIGHTER_MOVEMENT_PROFILES: Readonly<
  Record<CharacterId, FighterMovementProfile>
> = Object.freeze({
  link: LINK_MOVEMENT_PROFILE,
  donkeykong: DONKEYKONG_MOVEMENT_PROFILE,
  pikachu: PIKACHU_MOVEMENT_PROFILE,
});

/**
 * Look up the per-fighter movement profile by character id.
 *
 * Used by the {@link Character} base class to resolve a fighter's
 * movement values at construction time without holding any movement
 * defaults on the base class itself. Per-fighter subclasses
 * still pass their tuning through
 * `super({ ...TUNING, ...options })` so the spread merge applies a
 * per-fighter profile on top of the registry lookup; both paths end
 * with the same numbers because the per-fighter `*_TUNING` records
 * compose from the same `*_MOVEMENT_PROFILE` constants exported here.
 */
export function getFighterMovementProfile(
  id: CharacterId,
): FighterMovementProfile {
  return FIGHTER_MOVEMENT_PROFILES[id];
}
