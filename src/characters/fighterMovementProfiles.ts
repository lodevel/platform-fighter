/**
 * Per-fighter movement profile data — Sub-AC 2.2 of the T2 refactor track.
 *
 * Holds the canonical {@link FighterMovementProfile} value for every
 * registered fighter (`wolf`, `cat`, `owl`, `bear`) in ONE pure-data
 * leaf module. The Seed's per-fighter refactor calls for each subclass
 * to OWN its movement profile (speed, jump, air control, gravity, mass),
 * with the shared {@link Character} base class no longer holding a
 * generic one-size-fits-all default. To make that work without a
 * circular import — `Character.ts` cannot import from `Wolf.ts` because
 * `Wolf extends Character`, and the class-extension TDZ would fault on
 * module load — the profile data lives in this leaf module.
 *
 * # Ownership and re-export pattern
 *
 * Each per-fighter file (`Wolf.ts`, `Cat.ts`, `Owl.ts`, `Bear.ts`)
 * imports its profile from here and **re-exports it** under the existing
 * public name (`WOLF_MOVEMENT_PROFILE`, etc.). That re-export is
 * deliberate: the per-fighter file remains the natural API surface a
 * consumer reaches for ("look up Wolf's stats? import from `Wolf.ts`"),
 * while the architectural source of truth — the literal data — lives in
 * one leaf module that nobody else can fork. The two-level split keeps
 * both invariants honest:
 *
 *   1. Per-fighter ownership: changing Wolf's air control means editing
 *      `WOLF_MOVEMENT_PROFILE` here (which the Wolf file re-exports);
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

// ---------------------------------------------------------------------------
// Per-fighter movement profile constants
// ---------------------------------------------------------------------------

/**
 * Wolf — bruiser archetype. Slower top speed and committal recovery
 * traded for heavier mass (resists knockback) and a baseline jump
 * impulse. Mirrors the values previously inlined into `WOLF_TUNING`
 * before Sub-AC 2.2 of the T2 refactor.
 */
export const WOLF_MOVEMENT_PROFILE: FighterMovementProfile = Object.freeze({
  maxRunSpeed: 7.5, // ≈ 450 px/s
  groundAccel: 0.65,
  airAccel: 0.3,
  groundDamping: 0.78,
  airDamping: 0.95,
  jumpImpulse: 12.5, // ≈ 750 px/s upward
  maxJumps: 2,
  mass: 16, // heavier than the previous shared default of 12
});

/**
 * Cat — ninja archetype. Highest top speed, snappiest accel, lightest
 * mass; pays for it by being knocked back further at the same percent.
 */
export const CAT_MOVEMENT_PROFILE: FighterMovementProfile = Object.freeze({
  maxRunSpeed: 10.0, // ≈ 600 px/s
  groundAccel: 0.85,
  airAccel: 0.45,
  groundDamping: 0.82, // slightly stickier deceleration helps tight footsies
  airDamping: 0.97,
  jumpImpulse: 13.5, // ≈ 810 px/s upward
  maxJumps: 2,
  mass: 8, // lighter than the previous shared default of 12
});

/**
 * Owl — floaty mage archetype. Slow top speed but the strongest
 * air-control in the cast (highest `airAccel`) so directional changes
 * mid-jump are cheap. Mass sits between Cat (8) and Wolf (16).
 */
export const OWL_MOVEMENT_PROFILE: FighterMovementProfile = Object.freeze({
  maxRunSpeed: 6.5, // ≈ 390 px/s
  groundAccel: 0.55,
  airAccel: 0.55, // best air-control in the cast
  groundDamping: 0.8,
  airDamping: 0.97,
  jumpImpulse: 13.0, // ≈ 780 px/s upward
  maxJumps: 2,
  mass: 10, // between Cat (8) and Wolf (16)
});

/**
 * Bear — grappler archetype. Slowest top speed, worst air-control
 * (committed jumps), heaviest mass. Resists knockback hardest.
 */
export const BEAR_MOVEMENT_PROFILE: FighterMovementProfile = Object.freeze({
  maxRunSpeed: 6.0, // ≈ 360 px/s — slowest in the M2 cut
  groundAccel: 0.5,
  airAccel: 0.25, // worst air-control in the cast
  groundDamping: 0.74,
  airDamping: 0.93,
  jumpImpulse: 11.5, // ≈ 690 px/s upward — shortest hop in the cast
  maxJumps: 2,
  mass: 20, // heaviest in the cast
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
  wolf: WOLF_MOVEMENT_PROFILE,
  cat: CAT_MOVEMENT_PROFILE,
  owl: OWL_MOVEMENT_PROFILE,
  bear: BEAR_MOVEMENT_PROFILE,
});

/**
 * Look up the per-fighter movement profile by character id.
 *
 * Used by the {@link Character} base class to resolve a fighter's
 * movement values at construction time without holding any movement
 * defaults on the base class itself. Per-fighter subclasses
 * (`Wolf` / `Cat` / `Owl` / `Bear`) still pass their tuning through
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
