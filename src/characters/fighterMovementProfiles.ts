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
  fallAccel: 0.3, // mid-cast descent — committal but not lead-footed
  maxFallSpeed: 11.0,
  fastFallSpeed: 17.5, // ≈ 1.6× — Smash-standard fast-fall ratio
  jumpCutFactor: 0.4, // early release clips the rise to 40% impulse
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
  fallAccel: 0.38, // fastest faller in the cast — Fox-style hit-and-run
  maxFallSpeed: 12.5,
  fastFallSpeed: 20.0, // 1.6× — rushdown wants to be back on the deck NOW
  jumpCutFactor: 0.35, // tightest short hop in the cast
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
  fallAccel: 0.16, // floatiest descent in the cast — Jigglypuff-zone drift
  maxFallSpeed: 8.5, // low terminal velocity = long, controllable falls
  fastFallSpeed: 13.5, // ~1.6× — fast-fall still matters for a floaty
  jumpCutFactor: 0.45,
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
  fallAccel: 0.34, // heavy = drops like a stone once committed
  maxFallSpeed: 12.0,
  fastFallSpeed: 18.0, // 1.5× — grapplers chase landings, not juggles
  jumpCutFactor: 0.5, // least jump control — committed arcs
});

/**
 * Blaze — rushdown archetype (Captain Falcon-inspired). The cast's
 * "fast heavy": near-Cat ground speed on a Wolf-class mass so he
 * sprints into range, lands a heavy hit, and survives the trade.
 * Pays for it with the steepest descent in the cast — high `fallAccel`
 * + high `maxFallSpeed` means off-stage mistakes are unforgiving.
 */
export const BLAZE_MOVEMENT_PROFILE: FighterMovementProfile = Object.freeze({
  maxRunSpeed: 9.0, // ≈ 540 px/s — second-fastest, behind Cat (10)
  groundAccel: 0.8,
  airAccel: 0.35,
  groundDamping: 0.8,
  airDamping: 0.95,
  jumpImpulse: 13.0, // ≈ 780 px/s upward
  maxJumps: 2,
  mass: 14, // heavy for his speed class — between Wolf (16) and Cat (8)
  fallAccel: 0.4, // steepest gravity in the cast — fast-faller identity
  maxFallSpeed: 12.5,
  fastFallSpeed: 20.0, // 1.6× — rushdown wants to be back on the deck NOW
  jumpCutFactor: 0.38, // tight short hop for dash-in aerial pressure
});

/**
 * Puff — balloon archetype (Jigglypuff-inspired). Floatiest fighter by
 * a wide margin: five jumps, near-zero fall acceleration, the lowest
 * terminal velocity, and the strongest air acceleration in the cast.
 * Trades all of it for the lightest mass (launches earliest) and the
 * slowest ground game.
 */
export const PUFF_MOVEMENT_PROFILE: FighterMovementProfile = Object.freeze({
  maxRunSpeed: 5.0, // ≈ 300 px/s — slowest ground speed in the cast
  groundAccel: 0.45,
  airAccel: 0.6, // best air-control in the cast — the air IS her stage
  groundDamping: 0.8,
  airDamping: 0.98,
  jumpImpulse: 10.5, // short hops — height comes from jump COUNT
  maxJumps: 5, // five jumps: the canonical balloon recovery
  mass: 6, // lightest in the cast — dies earliest off a clean hit
  fallAccel: 0.08, // barely falls — half of Owl's already-floaty 0.16
  maxFallSpeed: 6.5, // lowest terminal velocity in the cast
  fastFallSpeed: 10.5, // ~1.6× — fast-fall opt-in keeps landings honest
  jumpCutFactor: 0.55,
});

/**
 * Aegis — sword-spacing archetype (Marth-inspired). Mid stats across
 * the board: real run speed, standard double jump, mid mass. The
 * identity lives in the moveset (tip sweet-spots on every normal —
 * see `Aegis.ts`), not the movement profile, so the profile stays
 * deliberately unexceptional.
 */
export const AEGIS_MOVEMENT_PROFILE: FighterMovementProfile = Object.freeze({
  maxRunSpeed: 8.0, // ≈ 480 px/s — the cast's baseline tempo
  groundAccel: 0.7,
  airAccel: 0.4,
  groundDamping: 0.8,
  airDamping: 0.96,
  jumpImpulse: 13.0, // ≈ 780 px/s upward
  maxJumps: 2,
  mass: 11, // mid-weight — between Owl (10) and Wolf (16)
  fallAccel: 0.28, // slightly under Wolf — graceful but committed arcs
  maxFallSpeed: 10.5,
  fastFallSpeed: 17.0, // ~1.6× — Smash-standard fast-fall ratio
  jumpCutFactor: 0.42,
});

/**
 * Volt — combo-rushdown archetype (Pikachu-inspired). The cast's tiny
 * speedster: highest run speed shipped (9.5, edging past Cat's 10 only
 * because Cat keeps the ground-accel crown), near-lightest mass (7 —
 * heavier only than Puff's 6) and a fast-faller fall line so he can
 * weave in, rattle off low-knockback multi-hits, and drop back to the
 * deck. Dies early; wins with speed + combos.
 */
export const VOLT_MOVEMENT_PROFILE: FighterMovementProfile = Object.freeze({
  maxRunSpeed: 9.5, // ≈ 570 px/s — second only to Cat (10)
  groundAccel: 0.82,
  airAccel: 0.46,
  groundDamping: 0.82,
  airDamping: 0.97,
  jumpImpulse: 13.0, // ≈ 780 px/s upward
  maxJumps: 2,
  mass: 7, // featherweight — only Puff (6) is lighter
  fallAccel: 0.37, // fast-faller — hit-and-run, back on the deck NOW
  maxFallSpeed: 12.0,
  fastFallSpeed: 19.5, // ~1.6× — Smash-standard fast-fall ratio
  jumpCutFactor: 0.36, // tight short hop for short-hop aerial pressure
});

/**
 * Nova — zoner archetype (Samus-inspired). Mid-heavy mass (13) and a
 * deliberately slow run (6.8 — between Owl 6.5 and Wolf 7.5) so she
 * controls space with ranged tools rather than chasing. Mid fall
 * shaping: she's not a fast-faller (her game is staying out, not diving
 * in) but heavy enough to survive the trades a slow zoner inevitably
 * eats.
 */
export const NOVA_MOVEMENT_PROFILE: FighterMovementProfile = Object.freeze({
  maxRunSpeed: 6.8, // ≈ 408 px/s — slow, the zoner wants distance not closure
  groundAccel: 0.58,
  airAccel: 0.4,
  groundDamping: 0.79,
  airDamping: 0.96,
  jumpImpulse: 12.5, // ≈ 750 px/s upward
  maxJumps: 2,
  mass: 13, // mid-heavy — between Aegis (11) and Blaze (14)
  fallAccel: 0.27, // mid descent — neither floaty nor a fast-faller
  maxFallSpeed: 10.5,
  fastFallSpeed: 16.5, // ~1.6× — Smash-standard fast-fall ratio
  jumpCutFactor: 0.43,
});

/**
 * Bruno — balanced all-rounder archetype (Mario-inspired). The cast's
 * "everyman" baseline: middleweight mass (11), real-but-unremarkable
 * run (8.0, the cast's baseline tempo, same as Aegis), standard double
 * jump, mid fall shaping. Nothing here is exceptional by design — the
 * identity is reliability across the whole stat line.
 */
export const BRUNO_MOVEMENT_PROFILE: FighterMovementProfile = Object.freeze({
  maxRunSpeed: 8.0, // ≈ 480 px/s — the cast's baseline tempo
  groundAccel: 0.7,
  airAccel: 0.42,
  groundDamping: 0.8,
  airDamping: 0.96,
  jumpImpulse: 13.0, // ≈ 780 px/s upward
  maxJumps: 2,
  mass: 11, // middleweight — the baseline the rest of the cast is read against
  fallAccel: 0.29, // mid descent — graceful but committed arcs
  maxFallSpeed: 11.0,
  fastFallSpeed: 17.5, // ~1.6× — Smash-standard fast-fall ratio
  jumpCutFactor: 0.42,
});

/**
 * Link — projectile-swordsman zoner archetype (Zelda-inspired). Medium
 * across the board: run 7.8 (between Wolf 7.5 and Aegis 8.0), mass 12
 * (squarely middleweight), mid fall shaping. The identity lives in the
 * projectile-wall kit (arrow / boomerang / bomb) + sword normals, not
 * the movement profile, so the profile stays deliberately unexceptional
 * — distinct from Nova (the slower, heavier pure-cannon zoner).
 */
export const LINK_MOVEMENT_PROFILE: FighterMovementProfile = Object.freeze({
  maxRunSpeed: 7.8, // ≈ 468 px/s — medium, between Wolf (7.5) and Aegis (8.0)
  groundAccel: 0.66,
  airAccel: 0.4,
  groundDamping: 0.8,
  airDamping: 0.96,
  jumpImpulse: 13.0, // ≈ 780 px/s upward
  maxJumps: 2,
  mass: 12, // middleweight — between Aegis (11) and Nova (13)
  fallAccel: 0.3, // mid descent — committed but not a fast-faller
  maxFallSpeed: 11.0,
  fastFallSpeed: 17.5, // ~1.6× — Smash-standard fast-fall ratio
  jumpCutFactor: 0.42,
});

/**
 * Kirby — multi-jump inhale puffball archetype. Light mass (7 — second-
 * lightest, just above Puff's 6) and a slow run (5.5) but a FOUR-jump
 * multi-jump and a near-floaty fall (0.10 — second only to Puff's 0.08),
 * so the air is his stage. Deliberately one notch below Puff on every
 * float axis (4 jumps vs 5, mass 7 vs 6, fall 0.10 vs 0.08): Puff keeps
 * the cast's float SUPERLATIVES, while Kirby's identity lives in the kit
 * — a close-range INHALE grappler with a heavy STONE plummet — not in
 * out-floating the balloon.
 */
export const KIRBY_MOVEMENT_PROFILE: FighterMovementProfile = Object.freeze({
  maxRunSpeed: 5.5, // ≈ 330 px/s — slow; the puffball commits in the air
  groundAccel: 0.5,
  airAccel: 0.5, // strong air-control — the multi-jump wants directional reach
  groundDamping: 0.8,
  airDamping: 0.97,
  jumpImpulse: 11.0, // short hops — height comes from jump COUNT
  maxJumps: 4, // multi-jump — above the cast's standard 2, below Puff's 5
  mass: 7, // second-lightest — just above Puff (6), ties Volt
  fallAccel: 0.1, // floaty — second only to Puff (0.08)
  maxFallSpeed: 7.0,
  fastFallSpeed: 11.5, // ~1.6× — fast-fall opt-in keeps landings honest
  jumpCutFactor: 0.5,
});

/**
 * Donkey Kong — mobile heavyweight bruiser archetype. Heavy mass (18 —
 * between Wolf's 16 and Bear's 20) but, unlike Bear (the slow immovable
 * grappler wall, run 6.0 / air-control 0.25), DK is MOBILE: a real run
 * speed (8.0, the cast baseline) and usable air control (0.34) let the
 * big ape chase and approach. The identity is heavyweight HITS delivered
 * WITH mobility — the heavy who keeps up — so the profile pairs Bear-
 * adjacent mass with mid-cast tempo, deliberately the opposite trade
 * from Bear's slow-but-unmovable line.
 */
export const DONKEYKONG_MOVEMENT_PROFILE: FighterMovementProfile = Object.freeze({
  maxRunSpeed: 8.0, // ≈ 480 px/s — cast baseline; fast for a heavyweight
  groundAccel: 0.68,
  airAccel: 0.34, // usable air-control — well above Bear's 0.25
  groundDamping: 0.79,
  airDamping: 0.95,
  jumpImpulse: 12.5, // ≈ 750 px/s upward
  maxJumps: 2,
  mass: 18, // heavy — between Wolf (16) and Bear (20)
  fallAccel: 0.32, // drops with weight, but not a lead-footed plummet
  maxFallSpeed: 12.0,
  fastFallSpeed: 18.0, // ~1.55× — heavyweights chase landings
  jumpCutFactor: 0.44,
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
  blaze: BLAZE_MOVEMENT_PROFILE,
  puff: PUFF_MOVEMENT_PROFILE,
  aegis: AEGIS_MOVEMENT_PROFILE,
  volt: VOLT_MOVEMENT_PROFILE,
  nova: NOVA_MOVEMENT_PROFILE,
  bruno: BRUNO_MOVEMENT_PROFILE,
  link: LINK_MOVEMENT_PROFILE,
  kirby: KIRBY_MOVEMENT_PROFILE,
  donkeykong: DONKEYKONG_MOVEMENT_PROFILE,
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
