/**
 * Uniform 10-slot fighter moveset contract — Sub-AC 1 of the per-fighter
 * refactor track (T2).
 *
 * The Seed's `movesetSlot` ontology pins the canonical 10 named combat
 * slots every fighter must expose:
 *
 *     jab, tilt, smash,
 *     fair,
 *     shield, dodge,
 *     neutralSpecial, sideSpecial, upSpecial, downSpecial.
 *
 * After the per-fighter refactor (subsequent sub-ACs of AC 1 land here)
 * each concrete fighter (Wolf, Cat, Owl, Bear) declares its full
 * 10-slot kit + a per-fighter movement profile DIRECTLY on the
 * subclass — no attack-implementation code remains in the shared
 * {@link Character} base. This module is the data contract those
 * declarations satisfy. Defining the contract in a dedicated, Phaser-
 * /Matter-free module:
 *
 *   1. Locks the slot taxonomy as a single source of truth — typos
 *      ('neutral_special' vs 'neutralSpecial', 'fair' vs 'forwardAerial')
 *      are rejected at the type level, not at runtime.
 *   2. Lets unit tests assert the contract is uniform across the cast
 *      without instantiating four Matter scenes — every fighter exposes
 *      the same 10 keys with the same value shapes.
 *   3. Lets the (later sub-AC) item framework declare its slot overrides
 *      ({@link MovesetSlotOverride}) against the same canonical slot
 *      names — the slotOverride concept in the Seed's ontology slots in
 *      via the {@link AttackMovesetSlotName} union with no per-category
 *      special cases (open-closed for items).
 *   4. Lets the AI bot decision framework, the replay tooling, the
 *      damage-HUD legend, and the (later sub-AC) move-editor surface
 *      iterate the canonical slot list once instead of restating it.
 *
 * # Slot taxonomy
 *
 * The 10 slots split into two functional groups:
 *
 *   • **Attack slots** (8) — each carries an authored
 *     `AttackMoveWithAnimation` record that drives the per-frame
 *     hitbox state machine (startup → active → recovery → done):
 *
 *         jab, tilt, smash, fair,
 *         neutralSpecial, sideSpecial, upSpecial, downSpecial.
 *
 *   • **Defensive slots** (2) — each carries a tuning record consumed
 *     by the corresponding pure state machine (`shieldState.ts` /
 *     `dodgeState.ts`) — not an attack:
 *
 *         shield, dodge.
 *
 * Why one contract for both groups: from the *fighter* perspective the
 * defensive slots are first-class behaviours the player commits to via
 * the input layer (shield button → enter shield state; dodge button →
 * enter dodge state). They are NOT attack moves, but they ARE part of
 * the per-fighter moveset surface — the Seed's ontology calls them out
 * as slots in the same enumeration as the attack slots. Treating both
 * uniformly lets a slot-iterating consumer (debug HUD, replay
 * legend, AI predictor) walk the same shape regardless of which slot
 * it's looking at.
 *
 * # Backwards compatibility
 *
 * The existing per-character `*_MOVES` arrays in `roster.ts` ship 10
 * attack records each (jab, tilt, smash, nair, fair, bair, 4 specials).
 * That registration shape is **not deprecated** — `nair` / `bair` slots
 * remain valid extensions to a fighter's authored kit, but they sit
 * OUTSIDE the canonical 10-slot uniform contract this module declares.
 * The Seed's contract is the *minimum* surface every fighter must
 * expose; extra slots remain compatible.
 *
 * Practically: this module declares the interface; subsequent sub-ACs
 * of the T2 refactor track wire each fighter's existing authored
 * records into a {@link FighterMoveset} value (using the same constants
 * already exported from `Wolf.ts` / `Cat.ts` / `Owl.ts` / `Bear.ts`),
 * extract the attack-implementation code from `Character.ts` into the
 * per-fighter classes, and lock the slot contract under
 * {@link assertFighterMoveset} test invariants. **No existing behaviour
 * changes during AC 1 Sub-AC 1** — this file is purely additive.
 *
 * # Determinism
 *
 * Every export here is pure data or a pure function — no
 * `Math.random()`, no `Date.now()`, no Phaser / Matter side effects.
 * Importing this module produces the same bytes on every boot, which
 * is the property the replay system requires.
 */

import type { CharacterId } from '../types';
import type { AttackMoveWithAnimation } from './moveSchema';
import type { AerialMove } from './aerialSchema';
import type { NeutralSpecialMove } from './specialSchema';
import type { SideSpecialMove } from './sideSpecialSchema';
import type { UpSpecialMove } from './upSpecialSchema';
import type { DownSpecialMove } from './downSpecialSchema';
import type { ShieldTuning, ResolvedShieldTuning } from './shieldState';
import type { DodgeTuning, ResolvedDodgeTuning } from './dodgeState';

// ---------------------------------------------------------------------------
// Slot-name unions and ordered lists
// ---------------------------------------------------------------------------

/**
 * The 8 *attack* moveset slot names. Each carries an
 * {@link AttackMoveWithAnimation} record at the corresponding key on
 * {@link FighterMoveset}.
 *
 * Order in this union and in {@link ATTACK_MOVESET_SLOT_NAMES} is the
 * canonical authoring / iteration order — grounded triplet first, then
 * the forward aerial, then the four specials in `neutral / side / up /
 * down` direction order so a consumer iterating "every attack slot"
 * walks the kit in a stable, ergonomic sequence.
 */
export type AttackMovesetSlotName =
  | 'jab'
  | 'tilt'
  | 'smash'
  | 'fair'
  | 'neutralSpecial'
  | 'sideSpecial'
  | 'upSpecial'
  | 'downSpecial';

/**
 * The 2 *defensive* moveset slot names. Each carries a tuning record
 * (shield / dodge) consumed by the corresponding pure state machine —
 * NOT an attack move. See module JSDoc for why both groups share one
 * contract.
 */
export type DefensiveMovesetSlotName = 'shield' | 'dodge';

/**
 * The full 10-slot uniform contract — every fighter must satisfy this
 * surface after the T2 refactor. Compose of {@link AttackMovesetSlotName}
 * and {@link DefensiveMovesetSlotName}.
 */
export type MovesetSlotName = AttackMovesetSlotName | DefensiveMovesetSlotName;

/**
 * Canonical category bucket for a slot — `'attack'` for the eight slots
 * carrying an `AttackMoveWithAnimation`, `'defensive'` for the two
 * defensive tunings. Surfaced as a named type so AI / replay / HUD
 * consumers can branch on category without re-deriving the
 * partitioning.
 */
export type MovesetSlotCategory = 'attack' | 'defensive';

/**
 * Frozen ordered list of every attack slot. Iteration walks the
 * canonical authoring order (jab → tilt → smash → fair → 4 specials).
 *
 * Length is exactly 8 — verified by an exhaustive type-level
 * assertion in {@link assertAttackSlotCount}.
 */
export const ATTACK_MOVESET_SLOT_NAMES: ReadonlyArray<AttackMovesetSlotName> =
  Object.freeze([
    'jab',
    'tilt',
    'smash',
    'fair',
    'neutralSpecial',
    'sideSpecial',
    'upSpecial',
    'downSpecial',
  ]);

/**
 * Frozen ordered list of every defensive slot. Length is exactly 2 —
 * shield then dodge in the canonical authoring order.
 */
export const DEFENSIVE_MOVESET_SLOT_NAMES: ReadonlyArray<DefensiveMovesetSlotName> =
  Object.freeze(['shield', 'dodge']);

// ---------------------------------------------------------------------------
// Extended attack slots — post-M2 character architecture pass.
//
// The Seed's original M2 contract pinned exactly 10 slots: the 8 attack
// slots above plus shield + dodge. The post-M2 character architecture
// pass introduced *directional* lights and a fuller aerial kit so each
// character can express the canonical Smash-style direction-aware
// moveset:
//
//     Ground lights:  jab          — no direction (already in core)
//                     sideLight    — L/R mirrored (new)
//                     upLight      — stick up (new)
//                     downLight    — stick down (new)
//
//     Aerials:        fair         — forward/back mirrored (already in core)
//                     nair         — neutral aerial (new)
//                     uair         — up aerial (new)
//                     dair         — down aerial (new)
//
// All 6 of these slots are *optional* — a fighter can ship the original
// 10-slot kit (jab + tilt + smash + fair + 4 specials + shield + dodge)
// or opt into any subset of the extended kit. The runtime routes
// directional input to the extended slot when present and falls back
// to the core slot otherwise (`tilt` / `smash` for grounded directional
// lights, `fair` for non-forward aerials).
//
// Tilt/smash collapse into a single chargeable light slot per
// direction via `chargeSchema.ts` — tap = tilt-feel, hold = smash-feel.
// The `tilt` and `smash` slots remain in the core contract for
// back-compat with the existing roster; new characters can omit them
// in favour of chargeable directional lights.
// ---------------------------------------------------------------------------

/** Names of the 6 *extended* attack slots — optional add-ons to the core 10. */
export type ExtendedAttackMovesetSlotName =
  | 'sideLight'
  | 'upLight'
  | 'downLight'
  | 'nair'
  | 'uair'
  | 'dair';

/**
 * Frozen ordered list of every extended attack slot. Length is exactly
 * 6. The order mirrors the input-routing order: directional lights
 * first (side/up/down), then directional aerials (n/u/d).
 */
export const EXTENDED_ATTACK_MOVESET_SLOT_NAMES: ReadonlyArray<ExtendedAttackMovesetSlotName> =
  Object.freeze([
    'sideLight',
    'upLight',
    'downLight',
    'nair',
    'uair',
    'dair',
  ]);

/** Count of extended attack slots. Locked at 6. */
export const EXTENDED_ATTACK_MOVESET_SLOT_COUNT = 6 as const;

/**
 * Frozen ordered list of every slot name in the canonical 10-slot
 * contract. Concatenation of {@link ATTACK_MOVESET_SLOT_NAMES} (8) and
 * {@link DEFENSIVE_MOVESET_SLOT_NAMES} (2) — total length is always 10.
 *
 * Consumers iterate this constant to walk every slot uniformly:
 *
 *     for (const slot of MOVESET_SLOT_NAMES) {
 *       const cat = getMovesetSlotCategory(slot);
 *       // ...
 *     }
 */
export const MOVESET_SLOT_NAMES: ReadonlyArray<MovesetSlotName> = Object.freeze([
  ...ATTACK_MOVESET_SLOT_NAMES,
  ...DEFENSIVE_MOVESET_SLOT_NAMES,
]);

/**
 * Canonical slot count constant. Locked at 10 to mirror the Seed's
 * `movesetSlot` ontology. Used by tests and asserts so a future change
 * that adds an 11th slot name to the union surfaces immediately.
 */
export const MOVESET_SLOT_COUNT = 10 as const;

// ---------------------------------------------------------------------------
// Per-slot value shapes
// ---------------------------------------------------------------------------

/**
 * Type-level lookup mapping each {@link AttackMovesetSlotName} to the
 * concrete value shape carried at that slot on {@link FighterMoveset}.
 *
 *   • `jab` / `tilt` / `smash` — a grounded normal carried as an
 *     `AttackMoveWithAnimation` (the same shape `Wolf.ts` /
 *     `Cat.ts` / `Owl.ts` / `Bear.ts` already export for these moves).
 *   • `fair` — a forward aerial carried as the richer {@link AerialMove}
 *     shape (extends `AttackMoveWithAnimation` with
 *     `aerialDirection: 'forward'`, landing-lag, auto-cancel windows).
 *   • Specials — the discriminated-union move shape from each direction's
 *     schema, narrowed to the matching `*Move` union.
 *
 * Lifting the per-slot value type into a mapped record means
 * downstream consumers (item slot overrides, balance tooling, AI
 * predictors) can declare strongly-typed signatures without restating
 * the shape per slot.
 */
export interface AttackMovesetSlotValue {
  readonly jab: AttackMoveWithAnimation;
  readonly tilt: AttackMoveWithAnimation;
  readonly smash: AttackMoveWithAnimation;
  readonly fair: AerialMove;
  readonly neutralSpecial: NeutralSpecialMove;
  readonly sideSpecial: SideSpecialMove;
  readonly upSpecial: UpSpecialMove;
  readonly downSpecial: DownSpecialMove;
}

/**
 * Type-level lookup mapping each {@link DefensiveMovesetSlotName} to the
 * concrete tuning record carried at that slot on {@link FighterMoveset}.
 *
 * The defensive slots carry the {@link ResolvedShieldTuning} /
 * {@link ResolvedDodgeTuning} shapes (fully-defaulted, no optional
 * fields) so a slot consumer never needs to optional-chain through
 * tuning. A fighter authoring partial overrides supplies the optional
 * {@link ShieldTuning} / {@link DodgeTuning} shape and the existing
 * `resolveShieldTuning` / `resolveDodgeTuning` helpers fold them into
 * the resolved value.
 */
export interface DefensiveMovesetSlotValue {
  readonly shield: ResolvedShieldTuning;
  readonly dodge: ResolvedDodgeTuning;
}

/**
 * Type-level lookup mapping each
 * {@link ExtendedAttackMovesetSlotName} to its value shape. Every
 * field is OPTIONAL — a fighter can declare any subset of the 6
 * extended slots, or none.
 *
 *   • `sideLight` / `upLight` / `downLight` — directional grounded
 *     lights, carried as `AttackMoveWithAnimation`. The runtime
 *     prefers these over `tilt` / `smash` when present; the
 *     stick-direction-on-light-press routing in `moveResolver.ts`
 *     dispatches to whichever is present.
 *   • `nair` / `uair` / `dair` — neutral / up / down aerials, carried
 *     as `AerialMove` (same shape as the core `fair` slot).
 */
export interface ExtendedAttackMovesetSlotValue {
  readonly sideLight?: AttackMoveWithAnimation;
  readonly upLight?: AttackMoveWithAnimation;
  readonly downLight?: AttackMoveWithAnimation;
  readonly nair?: AerialMove;
  readonly uair?: AerialMove;
  readonly dair?: AerialMove;
}

/**
 * Full per-fighter moveset contract.
 *
 *   • The 10-slot CORE — every fighter must declare these (jab + tilt
 *     + smash + fair + 4 specials + shield + dodge). Locked under
 *     `MOVESET_SLOT_COUNT === 10` and `assertFighterMoveset`.
 *   • The 6-slot EXTENDED kit — optional. Lets a fighter opt into
 *     directional grounded lights (`sideLight`, `upLight`, `downLight`)
 *     and a fuller aerial set (`nair`, `uair`, `dair`). The runtime
 *     routes stick-directional input to the extended slot when
 *     present and falls back to the core slot otherwise.
 *
 * The interface is structured as the union of the three value shapes
 * so a caller `myFighter.moveset.fair` is typed `AerialMove`,
 * `myFighter.moveset.shield` is typed `ResolvedShieldTuning`, and
 * `myFighter.moveset.uair` is typed `AerialMove | undefined` — no
 * runtime narrowing required.
 */
export interface FighterMoveset
  extends AttackMovesetSlotValue,
    DefensiveMovesetSlotValue,
    ExtendedAttackMovesetSlotValue {}

// ---------------------------------------------------------------------------
// Movement profile
// ---------------------------------------------------------------------------

/**
 * Per-fighter movement profile. After the T2 refactor each fighter
 * owns its movement parameters directly (instead of inheriting them
 * from a one-size-fits-all `Character` base default), so this shape
 * surfaces the per-fighter declarations in one record the runtime
 * consumes.
 *
 * The Seed's ontology calls out movementProfile as carrying "jump
 * height and mid-air jump count"; we declare those plus the related
 * top-speed / accel / damping / mass parameters that already live on
 * {@link CharacterTuning} so a single profile record fully describes
 * how a fighter moves through the world. Body geometry (`width` /
 * `height` / `chamfer`) stays on the character tuning record because
 * it's hurtbox / collision data rather than a "movement" concern.
 *
 * Determinism: every value is a finite number, frozen at module load.
 * Identical movement profiles always produce identical physics
 * trajectories — the property the replay system requires.
 */
export interface FighterMovementProfile {
  /** Top horizontal speed in px per fixed step (8 ≈ 480 px/s). */
  readonly maxRunSpeed: number;
  /** Horizontal accel applied per step while grounded. */
  readonly groundAccel: number;
  /** Horizontal accel applied per step while airborne. */
  readonly airAccel: number;
  /**
   * Multiplier applied to horizontal velocity each grounded step when
   * no horizontal input is given. 1 = no decel, 0 = full stop.
   */
  readonly groundDamping: number;
  /** Multiplier applied to horizontal velocity each airborne step. */
  readonly airDamping: number;
  /**
   * Initial upward velocity (px per step) on a jump press. The Seed's
   * "jump height" maps to this impulse — height = impulse² / (2g) under
   * the engine's constant-gravity model.
   */
  readonly jumpImpulse: number;
  /**
   * Total jumps available between landings. The Seed's
   * "mid-air jump count" is `maxJumps - 1` (one ground jump + N midair
   * jumps).
   */
  readonly maxJumps: number;
  /**
   * Mass override; lets heavier fighters resist knockback more.
   * Combined with the percent-scaling rule in `combat.ts` to compute
   * realised launch velocity.
   */
  readonly mass: number;
}

// ---------------------------------------------------------------------------
// Top-level fighter contract
// ---------------------------------------------------------------------------

/**
 * Full per-fighter declaration: identity + moveset + movement profile.
 * Every concrete fighter (Wolf, Cat, Owl, Bear) exposes one frozen
 * instance of this shape after the T2 refactor.
 *
 * Integration with {@link Character}:
 *   • The base class consumes a `FighterContract` (or the equivalent
 *     `moveset` / `movementProfile` slots) at construction time, but
 *     owns NO attack-implementation code — every attack lives in the
 *     concrete fighter class.
 *   • The runtime per-frame tick reads `moveset.shield` /
 *     `moveset.dodge` to drive the defensive state machines.
 *   • The input dispatcher resolves `(input, fighter)` into a
 *     `MovesetSlotName` and looks the move up via the {@link FighterMoveset}.
 *
 * NOTE: this Sub-AC declares the contract surface only. Wiring each
 * fighter into a `FighterContract` value, plumbing the contract into
 * `Character`, and extracting the per-fighter attack code lands in
 * subsequent sub-ACs of the T2 refactor track. The interface is
 * stable from the moment this module ships.
 */
export interface FighterContract {
  /** Stable character id — matches the `CharacterId` union. */
  readonly id: CharacterId;
  /** The 10-slot uniform moveset declaration. */
  readonly moveset: FighterMoveset;
  /** Per-fighter movement parameters (jump height, mid-air jumps, …). */
  readonly movementProfile: FighterMovementProfile;
}

// ---------------------------------------------------------------------------
// Slot overrides — extension point for the T3 item framework
// ---------------------------------------------------------------------------

/**
 * Temporary replacement an item declares for a fighter's
 * {@link AttackMovesetSlotName} slot while the item is held. The Seed's
 * ontology calls this `slotOverride`; we surface it here on the
 * contract module so the (later sub-AC) item framework declares
 * overrides through one canonical type — no per-item-category special
 * cases.
 *
 * Why attack slots only: items replace ATTACK behaviours, not the
 * defensive shield / dodge state machines. The shield button never
 * "fires the bat's swing"; it always raises the shield. Constraining
 * the slot field to {@link AttackMovesetSlotName} encodes that rule at
 * the type level — an item author who tries to override
 * `'shield'` gets a TypeScript error.
 *
 * The override carries an `AttackMoveWithAnimation` (the broadest
 * attack-shape — every more-specific aerial / special record extends
 * it) so an item can substitute for any attack slot uniformly. An item
 * author who wants the override to satisfy a more specific shape
 * (e.g. ship a `fair` override that's a real `AerialMove` with
 * landing-lag fields) can declare a more-specific override type
 * locally; the contract here is the LOWEST common ground for the
 * runtime resolver.
 *
 * Open-closed extensibility: adding a hypothetical 4th item kind
 * requires only authoring its move record; the resolver, the inventory
 * framework, and the spawn manager never know which item provided
 * the override — they read off this stable contract.
 */
export interface MovesetSlotOverride {
  /** Which slot this override replaces. */
  readonly slot: AttackMovesetSlotName;
  /** The replacement move data — same shape every fighter slot uses. */
  readonly move: AttackMoveWithAnimation;
}

// ---------------------------------------------------------------------------
// Slot category / type-guard helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Frozen lookup of slot → category. Pure data table; encodes the
 * 8-attack / 2-defensive partitioning declared by the slot-name unions.
 */
const SLOT_CATEGORY: Readonly<Record<MovesetSlotName, MovesetSlotCategory>> =
  Object.freeze({
    jab: 'attack',
    tilt: 'attack',
    smash: 'attack',
    fair: 'attack',
    neutralSpecial: 'attack',
    sideSpecial: 'attack',
    upSpecial: 'attack',
    downSpecial: 'attack',
    shield: 'defensive',
    dodge: 'defensive',
  });

/**
 * Read a slot's category bucket. Pure projection; identical inputs
 * always return the same category.
 */
export function getMovesetSlotCategory(
  slot: MovesetSlotName,
): MovesetSlotCategory {
  return SLOT_CATEGORY[slot];
}

/**
 * Type-guard narrowing a {@link MovesetSlotName} to the
 * {@link AttackMovesetSlotName} subset. Used by the T3 item framework
 * (`item.slotOverrides[].slot satisfies AttackMovesetSlotName`) and by
 * tests that iterate the full slot list and want to branch on
 * category.
 */
export function isAttackMovesetSlot(
  slot: MovesetSlotName,
): slot is AttackMovesetSlotName {
  return SLOT_CATEGORY[slot] === 'attack';
}

/**
 * Type-guard narrowing a {@link MovesetSlotName} to the
 * {@link DefensiveMovesetSlotName} subset. Mirrors
 * {@link isAttackMovesetSlot}.
 */
export function isDefensiveMovesetSlot(
  slot: MovesetSlotName,
): slot is DefensiveMovesetSlotName {
  return SLOT_CATEGORY[slot] === 'defensive';
}

/**
 * Predicate — true iff `value` is a recognised slot name. Useful when
 * the caller has a `string` (e.g. read off a replay log header or a
 * URL query param) and wants to gate-keep before passing it as a
 * {@link MovesetSlotName}.
 */
export function isMovesetSlotName(value: string): value is MovesetSlotName {
  return Object.prototype.hasOwnProperty.call(SLOT_CATEGORY, value);
}

// ---------------------------------------------------------------------------
// Moveset accessors (pure)
// ---------------------------------------------------------------------------

/**
 * Read a single slot value off a {@link FighterMoveset}. Pure
 * projection; preserves the slot's value type via the conditional
 * lookup. Returns the runtime move/tuning the fighter has declared
 * for the requested slot.
 *
 *     const jab = getMovesetSlot(fighter.moveset, 'jab');     // AttackMoveWithAnimation
 *     const fair = getMovesetSlot(fighter.moveset, 'fair');   // AerialMove
 *     const shield = getMovesetSlot(fighter.moveset, 'shield'); // ResolvedShieldTuning
 *
 * The compiler narrows the return type from the slot literal — no
 * `as` cast, no runtime branching.
 */
export function getMovesetSlot<S extends MovesetSlotName>(
  moveset: FighterMoveset,
  slot: S,
): FighterMoveset[S] {
  return moveset[slot];
}

/**
 * Read every attack-slot move off a {@link FighterMoveset} in the
 * canonical {@link ATTACK_MOVESET_SLOT_NAMES} order. Pure / frozen
 * iteration order — used by:
 *
 *   • Balance-pass tooling — sort moves by `getFrameData(m).startup`,
 *     filter "every move with active <= 3", etc.
 *   • The damage-HUD legend — render the eight attack slots in a
 *     stable column order.
 *   • The (later sub-AC) move-editor authoring UI — bind eight `<input>`
 *     groups to a frozen list.
 */
export function listAttackMoves(
  moveset: FighterMoveset,
): ReadonlyArray<AttackMoveWithAnimation> {
  return ATTACK_MOVESET_SLOT_NAMES.map((slot) => moveset[slot]);
}

/**
 * Walk every slot in the canonical 10-slot order and visit it via the
 * supplied callback. The callback receives `(slot, value, category)`
 * triples; the value type is narrowed by the slot literal so the
 * callback can branch on category without re-deriving the partition.
 *
 * Pure — does not mutate the moveset, makes no side-effecting calls of
 * its own. Side effects come exclusively from the user-supplied
 * callback.
 */
export function forEachMovesetSlot(
  moveset: FighterMoveset,
  visit: (
    slot: MovesetSlotName,
    value: FighterMoveset[MovesetSlotName],
    category: MovesetSlotCategory,
  ) => void,
): void {
  for (const slot of MOVESET_SLOT_NAMES) {
    visit(slot, moveset[slot], SLOT_CATEGORY[slot]);
  }
}

// ---------------------------------------------------------------------------
// Contract assertions (test helpers)
// ---------------------------------------------------------------------------

/**
 * Type-level guarantee that {@link ATTACK_MOVESET_SLOT_NAMES} is
 * exhaustive over the {@link AttackMovesetSlotName} union. If a
 * future patch adds a 9th attack slot to the union without appending
 * it to the array, this constant fails to compile — surfacing the
 * mismatch at the type level.
 *
 * Implementation: index the literal array's element type into the
 * union; if every union member is present, the difference type is
 * `never`, otherwise it's the missing literal(s). The annotation
 * forces TS to evaluate the difference at module load.
 */
type _AttackSlotsExhaustive = Exclude<
  AttackMovesetSlotName,
  (typeof ATTACK_MOVESET_SLOT_NAMES)[number]
>;
// `never` here means the array IS exhaustive. Deliberately referenced
// via `void` so TypeScript's `noUnusedLocals` is satisfied; the real
// purpose is to fail at *compile* time if `_AttackSlotsExhaustive` ever
// stops being `never`.
const _attackSlotsExhaustive: _AttackSlotsExhaustive extends never ? true : false =
  true;
void _attackSlotsExhaustive;

type _DefensiveSlotsExhaustive = Exclude<
  DefensiveMovesetSlotName,
  (typeof DEFENSIVE_MOVESET_SLOT_NAMES)[number]
>;
const _defensiveSlotsExhaustive:
  _DefensiveSlotsExhaustive extends never ? true : false = true;
void _defensiveSlotsExhaustive;

type _SlotsExhaustive = Exclude<MovesetSlotName, (typeof MOVESET_SLOT_NAMES)[number]>;
const _slotsExhaustive: _SlotsExhaustive extends never ? true : false = true;
void _slotsExhaustive;

/**
 * Runtime invariant — `ATTACK_MOVESET_SLOT_NAMES` is exactly 8 entries.
 * Surfaces a future drift (e.g. a sub-AC accidentally appends a 9th
 * attack slot literal to the array but forgets to update the canonical
 * count) at module load instead of inside a far-away test.
 */
export function assertAttackSlotCount(): void {
  if (ATTACK_MOVESET_SLOT_NAMES.length !== 8) {
    throw new Error(
      `movesetContract: expected 8 attack slots, found ${ATTACK_MOVESET_SLOT_NAMES.length}`,
    );
  }
}

/**
 * Runtime invariant — `DEFENSIVE_MOVESET_SLOT_NAMES` is exactly 2
 * entries.
 */
export function assertDefensiveSlotCount(): void {
  if (DEFENSIVE_MOVESET_SLOT_NAMES.length !== 2) {
    throw new Error(
      `movesetContract: expected 2 defensive slots, found ${DEFENSIVE_MOVESET_SLOT_NAMES.length}`,
    );
  }
}

/**
 * Runtime invariant — `MOVESET_SLOT_NAMES` is exactly
 * {@link MOVESET_SLOT_COUNT} (10) entries. Locks the Seed-mandated
 * 10-slot canonical contract count.
 */
export function assertMovesetSlotCount(): void {
  if (MOVESET_SLOT_NAMES.length !== MOVESET_SLOT_COUNT) {
    throw new Error(
      `movesetContract: expected ${MOVESET_SLOT_COUNT} slots, found ${MOVESET_SLOT_NAMES.length}`,
    );
  }
}

/**
 * Validate a candidate {@link FighterMoveset} value at runtime. Throws
 * with a descriptive message if any required slot is missing, an
 * attack slot's `type` mismatches the slot's authoring contract
 * (e.g. a record at `'jab'` whose `type !== 'jab'`), or a special
 * slot's `type` mismatches its direction-specific tag.
 *
 * Pure-data validation — never touches Phaser / Matter. Tests in
 * `movesetContract.test.ts` exercise the negative paths.
 *
 * The slot/type pairs locked here:
 *
 *   jab            → move.type === 'jab'
 *   tilt           → move.type === 'tilt'
 *   smash          → move.type === 'smash'
 *   fair           → move.type === 'aerial' && move.aerialDirection === 'forward'
 *   neutralSpecial → move.type === 'special'
 *   sideSpecial    → move.type === 'sideSpecial'
 *   upSpecial      → move.type === 'upSpecial'
 *   downSpecial    → move.type === 'downSpecial'
 *
 * Defensive slots have no `type` discriminant — we simply assert the
 * tuning value is a non-null object. Deeper validation (shield health
 * sane, dodge variants well-formed) lives in `shieldState.ts` /
 * `dodgeState.ts` resolvers; the contract layer trusts those validators
 * upstream.
 */
export function assertFighterMoveset(
  characterId: CharacterId,
  moveset: FighterMoveset,
): void {
  const expectAttackType = (slot: AttackMovesetSlotName, expected: string) => {
    const move = moveset[slot];
    if (!move || typeof move !== 'object') {
      throw new Error(
        `movesetContract[${characterId}]: missing or invalid value at slot '${slot}'`,
      );
    }
    if (move.type !== expected) {
      throw new Error(
        `movesetContract[${characterId}]: slot '${slot}' expected move.type === '${expected}', got '${move.type}'`,
      );
    }
  };

  expectAttackType('jab', 'jab');
  expectAttackType('tilt', 'tilt');
  expectAttackType('smash', 'smash');

  // fair: aerial move with forward direction
  const fair = moveset.fair;
  if (!fair || fair.type !== 'aerial') {
    throw new Error(
      `movesetContract[${characterId}]: slot 'fair' expected move.type === 'aerial', got '${fair?.type}'`,
    );
  }
  if (fair.aerialDirection !== 'forward') {
    throw new Error(
      `movesetContract[${characterId}]: slot 'fair' expected aerialDirection === 'forward', got '${fair.aerialDirection}'`,
    );
  }

  expectAttackType('neutralSpecial', 'special');
  expectAttackType('sideSpecial', 'sideSpecial');
  expectAttackType('upSpecial', 'upSpecial');
  expectAttackType('downSpecial', 'downSpecial');

  for (const slot of DEFENSIVE_MOVESET_SLOT_NAMES) {
    const value = moveset[slot];
    if (!value || typeof value !== 'object') {
      throw new Error(
        `movesetContract[${characterId}]: missing or invalid tuning at slot '${slot}'`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel for consumers
// ---------------------------------------------------------------------------

/**
 * Convenience re-export of the optional tuning shapes the
 * {@link FighterMoveset} resolves from. A fighter author supplies
 * `Partial<ShieldTuning>` / `Partial<DodgeTuning>` overrides to the
 * `Character` constructor; the runtime resolves them into the fully-
 * defaulted shapes carried on `FighterMoveset`.
 */
export type { ShieldTuning, ResolvedShieldTuning, DodgeTuning, ResolvedDodgeTuning };
