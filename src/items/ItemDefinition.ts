/**
 * Item definition contract — T3 items framework, AC 10-20.
 *
 * The Seed's `itemEntity` ontology calls out a category, durability,
 * TTL, declared slot overrides, and a throw behaviour. This module
 * declares the canonical {@link ItemDefinition} shape every concrete
 * item subclass (Bat, RayGun, Bomb, plus a hypothetical 4th item) ships
 * a frozen instance of.
 *
 * Open-closed extensibility (Seed `extensibility_invariant` exit)
 * --------------------------------------------------------------
 *
 *   • New items land as new files. Each file exports a frozen
 *     {@link ItemDefinition} value plus the per-slot
 *     {@link SlotOverrideFactory} callbacks; nothing else in the
 *     framework needs to change. Adding a 4th item type therefore
 *     requires zero edits to the spawn manager, pickup, item-base, or
 *     inventory framework.
 *
 *   • Slot overrides are declared by name from the
 *     {@link AttackMovesetSlotName} taxonomy — no per-category special
 *     cases. A bat declares `['jab', 'tilt', 'smash']` overrides; a
 *     ray gun declares `['neutralSpecial']`; a bomb declares
 *     `['neutralSpecial']` for the throw-fire path. The dispatcher
 *     reads the same {@link AttackMovesetSlotName} → callback map for
 *     every category.
 *
 * Determinism (Seed `determinism_intact` exit)
 * --------------------------------------------
 *
 * Every {@link ItemDefinition} is frozen pure data. The
 * {@link SlotOverrideFactory} callbacks are pure functions of their
 * inputs and the per-item runtime state — they perform no
 * `Math.random()`, no wall-clock reads. Two simulations driven by the
 * same input stream produce identical item interactions tick-for-tick.
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM imports. Item subclasses that need a
 * Matter body for collision (the bat's swing hitbox, the bomb's
 * explosion radius) wire the Phaser side via the runtime
 * {@link ItemEntity} layer; the definition itself is pure data.
 */

import type { AttackMove } from '../characters/attacks';
import type { AttackMovesetSlotName } from '../characters/movesetContract';

// ---------------------------------------------------------------------------
// Item categories
// ---------------------------------------------------------------------------

/**
 * The 4 canonical item categories the Seed's `itemCategory` ontology
 * names. Used by the AI bot's item-priority logic and by the debug HUD;
 * the dispatcher itself reads {@link ItemDefinition.slotOverrides} not
 * the category.
 */
export type ItemCategory =
  | 'melee-weapon'
  | 'ranged-weapon'
  | 'throwable'
  | 'effect-consumable';

/**
 * Frozen list of every category in canonical authoring order. Iteration
 * convenience for tests, debug HUD, and AI priority tuning.
 */
export const ITEM_CATEGORIES: ReadonlyArray<ItemCategory> = Object.freeze([
  'melee-weapon',
  'ranged-weapon',
  'throwable',
  'effect-consumable',
]);

// ---------------------------------------------------------------------------
// Throw behaviour
// ---------------------------------------------------------------------------

/**
 * Throw direction the input layer resolved from the holder's stick at
 * the throw-press frame. Mirrors the canonical Smash idiom — a holder
 * with no direction held drops the item in place; a holder with a
 * direction throws it Smash-style.
 *
 *   • `'forward'` — direction matches the holder's facing.
 *   • `'back'` — opposite the holder's facing.
 *   • `'up'` — vertical up.
 *   • `'down'` — vertical down.
 *   • `'drop'` — no direction held; drop in place.
 */
export type ThrowDirection = 'forward' | 'back' | 'up' | 'down' | 'drop';

/**
 * Per-throw-direction launch impulse declaration. The runtime applies
 * `(velocityX * facing, velocityY)` to the released item body so an
 * authored "forward throw at 12 px/step" lands the item the same
 * distance regardless of whether the holder was facing left or right.
 */
export interface ThrowVector {
  readonly velocityX: number;
  readonly velocityY: number;
}

/**
 * Full per-direction throw table. Every direction is required so the
 * item never falls through to a runtime null-check.
 */
export interface ThrowBehavior {
  readonly forward: ThrowVector;
  readonly back: ThrowVector;
  readonly up: ThrowVector;
  readonly down: ThrowVector;
  readonly drop: ThrowVector;
  /**
   * If true, the item explodes / is consumed on impact after a throw.
   * The Bomb sets this to true; Bat and RayGun set it to false (they
   * land grounded after a throw, fully usable).
   */
  readonly consumeOnImpact: boolean;
}

// ---------------------------------------------------------------------------
// Slot override factory
// ---------------------------------------------------------------------------

/**
 * Runtime context handed to a {@link SlotOverrideFactory}. The factory
 * builds a slot-press callback closed over both the holder fighter and
 * the live item runtime state — the callback can spawn hitboxes off the
 * holder, decrement the item's durability, schedule a break event, and
 * so on.
 *
 * The context is intentionally minimal — concrete items extend it via
 * closure capture (e.g. the bat captures its own runtime `Bat` object
 * to read / decrement durability without the framework knowing the
 * shape). This keeps the framework category-agnostic.
 */
export interface SlotOverrideContext {
  /**
   * The holder fighter. Typed as `unknown` here so the
   * {@link ItemDefinition} type stays Phaser-free; concrete item
   * subclasses cast to {@link Character} at the moment they wire
   * a hitbox spawn.
   */
  readonly holder: unknown;
  /** Current frame index for cooldown / durability bookkeeping. */
  readonly frame: number;
  /**
   * Read the held item entity's runtime state — durability, ammo, etc.
   * Typed as `unknown` for the same Phaser-free reason as `holder`;
   * the override callback narrows when it consumes the value.
   */
  readonly itemEntity: unknown;
}

/**
 * A factory that produces the per-slot press callback an item installs
 * via {@link Character.setSlotOverride}. The factory runs once at
 * pickup time; the produced callback runs every time the slot's input
 * fires while the item is held.
 *
 * The callback returns `boolean` — `true` consumes the press (the
 * override fired), `false` declines (e.g. ray gun out of ammo, bomb
 * already thrown) and the fighter's native slot move runs as a
 * fallback.
 */
export type SlotOverrideFactory = (
  ctx: SlotOverrideContext,
) => () => boolean;

// ---------------------------------------------------------------------------
// Item definition
// ---------------------------------------------------------------------------

/**
 * Frozen per-item-type declaration. One value per concrete item
 * subclass; the framework reads off this contract uniformly so
 * adding a 4th item type requires only authoring a new definition
 * file.
 *
 * Required fields:
 *
 *   • `type` — short stable id used by the replay log
 *     ({@link ItemSpawnEvent.type}) and AI item-priority lookup.
 *
 *   • `category` — taxonomy bucket; AI uses it for
 *     attack-vs-throw / ranged-priority decisions.
 *
 *   • `maxDurability` — initial uses-remaining (5 for the bat, 6 for
 *     the ray gun, 1 for the bomb). The slot-override callback
 *     decrements this each fire and returns `false` when it reaches
 *     zero, triggering the broken transition.
 *
 *   • `ttlFrames` — frames an unpicked grounded item lives before
 *     despawning. Tuned per category; melee weapons stick around
 *     longer, throwables / consumables expire sooner.
 *
 *   • `brokenDespawnFrames` — frames a broken item's debris stays
 *     visible before despawning. Short by design — the player needs
 *     to read "spent" then the entity reclaims.
 *
 *   • `slotOverrides` — array of {@link AttackMovesetSlotName} the item
 *     replaces while held. Bat replaces `['jab', 'tilt', 'smash']`;
 *     ray gun replaces `['neutralSpecial']`; bomb replaces
 *     `['neutralSpecial']` (its press throws the bomb, which then
 *     explodes on impact). The pickup module reads this list and
 *     installs the per-slot factory output via
 *     {@link Character.setSlotOverride}.
 *
 *   • `buildSlotOverride` — factory that produces the per-slot press
 *     callback. Same factory for every slot the item replaces (the
 *     bat's swing fires from jab/tilt/smash with the same callback);
 *     a future item that wants per-slot variation can branch on the
 *     `slot` arg.
 *
 *   • `throwBehavior` — direction-aware throw vector table.
 */
export interface ItemDefinition {
  readonly type: string;
  readonly category: ItemCategory;
  readonly maxDurability: number;
  readonly ttlFrames: number;
  readonly brokenDespawnFrames: number;
  readonly slotOverrides: ReadonlyArray<AttackMovesetSlotName>;
  readonly buildSlotOverride: (
    slot: AttackMovesetSlotName,
    ctx: SlotOverrideContext,
  ) => () => boolean;
  readonly throwBehavior: ThrowBehavior;
  /**
   * Optional moves this item registers on the holder at pickup time
   * via `Character.addAttack`. The slot-override callback then fires
   * one of these via `attemptAttack(move.id)` so a held-item swing
   * runs through the canonical startup/active/recovery + hitbox
   * pipeline. Items with no moves (or that drive their effect
   * through `throwBehavior` only) leave this empty.
   */
  readonly attackMoves?: ReadonlyArray<AttackMove>;
}
