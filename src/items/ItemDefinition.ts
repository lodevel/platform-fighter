/**
 * Item definition contract (Ultimate items, phase 1).
 *
 * One frozen {@link ItemDefinition} per item type, pure data. A held item
 * changes a fighter's attacks only through {@link ItemDefinition.uses}: a
 * table from the Ultimate item-use inputs to the move the holder runs
 * through the ordinary attack / charge / projectile pipeline. The single
 * input→use decision is {@link import('./resolveItemInput').resolveItemInput};
 * `Character` consults it, nothing else installs per-item callbacks.
 *
 * Rules (docs/review/2026-10-11/ultimate-items/spec/universal-rules.json):
 *   • shooting items fire on the neutral attack and neutral aerial and keep the legs moving
 *     (`attackInput.shootingFire` / `shootingMovement`): their {@link ItemDefinition.shooting} session, not a use
 *     move; an empty one is thrown on that press (`emptyShootingItem`);
 *   • battering items replace neutral attack, forward tilt, dash attack and
 *     forward smash (`attackInput.battering`); other tilts, smashes and
 *     aerials are SOURCE_SILENT, so the fighter's own moves run;
 *   • a battering forward smash is charged through the existing smash-charge
 *     path when its move carries `charge` (the Home-Run Bat's does not);
 *   • any other smash input with an item is a smash throw
 *     (`attackInput.smashAttacksThrowItem`), and every throw, drop and catch
 *     runs through the shared planner (`itemActions.ts`, `itemCatch.ts`);
 *   • a throwing item (Bob-omb, Banana Peel) is simply thrown by the attack button
 *     (`attackInput.throwingItemAttackButton`): no swing, the press is a planner throw.
 *
 * Phaser-free and deterministic: no Phaser / Matter / DOM imports.
 */

import type { AttackMove } from '../characters/attacks';
import type { ItemSocketAxis } from '../characters/heldItemSocket';
import type { CharacterId } from '../types';
import type { NativeItemThrowProfile } from './nativeItemThrow';
import type { ShootingSpec } from './itemShooting';
import type { ItemAction } from './itemActions';
import type { ContainerSpec } from './itemContainer';
import type { BobOmbSpec, ItemExplosionSpec } from './BobOmb';
import type { HammerSpec,HammerState } from './Hammer';
import type {RecoverySpec} from './itemHealing';
import type {FoodVariant} from './Food';

/** Ultimate item classes present in the engine so far (spec engine-gap.md §5.1). */
export type ItemClass = 'battering' | 'shooting' | 'throwing' | 'container' | 'locked' | 'recovery';

/**
 * Item-use inputs. The four battering swipes, plus `aerial` (any aerial
 * attack press) which only the remaining test items still declare until their
 * own batch replaces them; no Ultimate battering item uses it.
 */
export type ItemUseInput = 'jab' | 'ftilt' | 'dashAttack' | 'fsmash' | 'aerial';

/** Move the holder runs for each declared input. Absent input = native move. */
export type ItemUseTable = Readonly<Partial<Record<ItemUseInput, AttackMove>>>;

// ---------------------------------------------------------------------------
// Visual descriptor
// ---------------------------------------------------------------------------

/**
 * How MatchScene draws the item: one sprite, bottom at the item root when on
 * the ground, at the hand anchor when held. Angles are Phaser degrees authored
 * facing right (0 = pointing up, 90 = pointing forward); the held container is
 * mirrored for a left-facing holder. `swingArc` is swept over startup + active
 * of any of the item's own uses (absent: the item stays at `restAngle`).
 */
export interface ItemVisual {
  readonly spriteKey: string;
  readonly width: number;
  readonly height: number;
  readonly restAngle: number;
  readonly swingArc?: readonly [from: number, to: number];
  /** Native socket axis the sprite's long axis follows (heldItemSocket.ts): 'y' blades / bats / rods and the
   * shoulder-held Super Scope (default), 'z' the Ray Gun barrel and the Fire Flower's head. */
  readonly socketAxis?: ItemSocketAxis;
}

// ---------------------------------------------------------------------------
// Held-item handle (what Character sees)
// ---------------------------------------------------------------------------

/**
 * The held item as the holder's attack dispatch sees it. {@link ItemEntity}
 * implements it: `canUse` gates the uses (ammo, lifecycle) and `noteUse` is
 * the one place a use is counted.
 */
export interface HeldItemHandle {
  readonly definition: Pick<ItemDefinition, 'uses' | 'usesByFighter' | 'itemClass' | 'heavy' | 'visual' | 'shooting' | 'hammer' | 'generated'>;
  canUse(): boolean;
  noteUse(frame: number, position: { readonly x: number; readonly y: number }): void;
  /** Pay `cost` ammo for a shot; false = not enough left (nothing is fired). */
  spendShot(cost?: number): boolean;
  getAmmo(): number | null;
  getHammerState?(): HammerState | null;
  setHammerState?(state: HammerState): void;
}

// ---------------------------------------------------------------------------
// Item definition
// ---------------------------------------------------------------------------

export interface ItemDefinition {
  /** Intrinsic generated objects are separate from the ordinary switch and
   * weighted spawn table. Ownership/lifetime live in their actual consumers. */
  readonly generated?: { readonly kind: 'link-arrow'; readonly vanishesOnImpact: true }
    | { readonly kind:'link-remote-bomb';readonly vanishesOnImpact:false };
  /** Stable id used by the replay spawn log. */
  readonly type: string;
  readonly itemClass: ItemClass;
  /** Acquisition traits; light holdable items are the default. */
  readonly holdable?: boolean;
  readonly heavy?: boolean;
  /** Explicit source eligibility for container loot; absent ordinary items
   * retain their existing eligibility. Standalone resources opt out. */
  readonly containerEligible?:boolean;
  readonly recovery?:RecoverySpec;
  readonly foodVariant?:FoodVariant;
  /** Thrown-item packet and flight (Ultimate formula; `ultimateItemThrowProfile`). */
  readonly throwProfile: NativeItemThrowProfile;
  /** Per-item thrown-hit rules beyond the shared formula (throwing items). */
  readonly thrownHit?: ThrownHitRules;
  /** Bob-omb: fuse, walking and explosion (BobOmb.ts). */
  readonly bobOmb?: BobOmbSpec;
  /** Blast of an item that explodes on command rather than by the Bob-omb rules (Link's Remote Bomb). */
  readonly explosion?: ItemExplosionSpec;
  readonly hammer?: HammerSpec;
  readonly container?: ContainerSpec;
  /** Banana Peel: a grounded opponent touching the lying item slips (soft trip); the placer never does. */
  readonly slipsOnContact?: true;
  /** A free item that attacks send flying as a thrown item of the hitter (SmashWiki Link (SSBU), Remote Bomb:
   * "can be knocked back by attacks, which also causes it to damage opponents in range"). */
  readonly launchedByAttacks?: true;
  /** Slips and / or throws before the item disappears (SmashWiki Banana Peel, Ultimate: 2). Absent = no count. */
  readonly durability?: number;
  readonly pickupBounds?: { readonly offsetX: number; readonly offsetY: number; readonly width: number; readonly height: number };
  /**
   * Uses before the item breaks (shots, swings), or a shooting item's ammo / fuel (Ray Gun shots, Super Scope
   * units, Fire Flower frames). Absent = unlimited: SmashWiki states no break count for Ultimate battering items.
   */
  readonly ammo?: number;
  /**
   * Only shots spend ammo (`AttackMove.itemShot`, or a {@link shooting} session's shots and fuel). An empty battering
   * item keeps its swings (SmashWiki Star Rod); an empty shooting item is thrown on its fire press (SmashWiki Item).
   * Absent: every started use spends one and the last use breaks the item.
   */
  readonly ammoSpentOnShot?: true;
  /** Shooting items: the fire session their fire press starts (itemShooting.ts). */
  readonly shooting?: ShootingSpec;
  /** Frames an unpicked grounded item lives (authored; Ultimate value SOURCE_SILENT). */
  readonly ttlFrames: number;
  /** Frames a broken item's debris stays visible. */
  readonly brokenDespawnFrames: number;
  /** Per-input item uses; registered on the holder at pickup. */
  readonly uses?: ItemUseTable;
  /** Per-fighter replacements of single uses (native per-fighter data, e.g. a reflector box). */
  readonly usesByFighter?: Readonly<Partial<Record<CharacterId, ItemUseTable>>>;
  readonly visual?: ItemVisual;
}

/**
 * Thrown-hit rules of one item. SmashWiki lists Ultimate thrown damage per throw kind for some items
 * (Bob-omb, Banana Peel); that table replaces the speed formula for the listed throws.
 */
export interface ThrownHitRules {
  readonly damageByAction: Readonly<Partial<Record<ItemAction, number>>>;
  /** Launch of a downward throw (Bob-omb: meteor smash when thrown downward). */
  readonly downKnockback?: NativeItemThrowProfile['knockback'];
  /** A grounded target is slipped (native game_Throw collision_attr_slip on COLLISION_SITUATION_MASK_G). */
  readonly slipGrounded?: true;
}

/** The use table a given fighter runs: the item's uses with that fighter's replacements. */
export function itemUsesFor(def: Pick<ItemDefinition, 'uses' | 'usesByFighter'>, fighterId: CharacterId): ItemUseTable | undefined {
  const own = def.usesByFighter?.[fighterId];
  return own ? { ...def.uses, ...own } : def.uses;
}

/** Every distinct move an item's uses run for a fighter (registered on the holder at pickup). */
export function itemUseMoves(def: Pick<ItemDefinition, 'uses' | 'usesByFighter'>, fighterId: CharacterId): AttackMove[] {
  return [...new Set(Object.values(itemUsesFor(def, fighterId) ?? {}))];
}

/** True iff `moveId` is one of this item's own use moves (any fighter's variant). */
export function isItemUseMove(def: Pick<ItemDefinition, 'uses' | 'usesByFighter'>, moveId: string): boolean {
  return [def.uses, ...Object.values(def.usesByFighter ?? {})].some(table =>
    Object.values(table ?? {}).some(move => move.id === moveId));
}
