/**
 * Items framework module barrel (T3, AC 10).
 *
 * Houses the Smash-style items / weapons subsystem: pickup, drop,
 * throw, spawn manager, replay-RNG seeding, the Ultimate items, and the item-aware AI hooks. Each file inside
 * `src/items/` is intentionally Phaser-free where possible so the
 * tuning + scheduling logic stays unit-testable under plain Node and
 * reusable from headless replay tooling.
 */

export {
  ITEM_FREQUENCIES,
  ITEM_SPAWN_FREQUENCY_TABLE,
  MAX_ITEMS_ON_FIELD_HARD_LIMIT,
  MAX_ITEMS_ON_FIELD_BY_FREQUENCY,
  ITEM_SPAWN_DROP_HEIGHT_PX,
  resolveItemFrequency,
  getItemSpawnInterval,
  getItemSpawnPosition,
  getMaxItemsOnField,
  assertItemSpawnSettingsInvariants,
} from './itemSpawnSettings';
export type { ItemSpawnInterval } from './itemSpawnSettings';

export {
  ItemSpawnManager,
  ITEM_SPAWN_RNG_STREAM,
} from './ItemSpawnManager';
export type {
  ItemSpawnRequest,
  ItemSpawnManagerOptions,
  ItemSpawnManagerState,
} from './ItemSpawnManager';

// Item lifecycle states + broken-state transition (T3, AC 16 Sub-AC 1).
// Phaser-free pure module — owns the "is this item pickable / held /
// broken / despawned?" question and the visual-hints mapping. The
// concrete Bat / RayGun / Bomb subclasses (later sub-ACs) compose
// their per-category state with an {@link ItemLifecycleSnapshot} from
// this module so the framework stays open-closed: a hypothetical 4th
// item type lands as a new subclass file without editing this module.
export {
  ITEM_BROKEN_ALPHA,
  ITEM_LIFECYCLE_STATES,
  canBePickedUp,
  computeItemVisualHints,
  isBroken,
  isDespawned,
  isHeld,
  transitionToBroken,
} from './itemLifecycle';
export type {
  ItemLifecycleSnapshot,
  ItemLifecycleState,
  ItemVisualHints,
  TransitionResult,
  TransitionToBrokenInput,
} from './itemLifecycle';

// Item definition contract (v2: per-input uses, ammo, visual descriptor).
export type {
  ItemClass,
  ItemDefinition,
  ItemUseInput,
  ItemUseTable,
  ItemVisual,
  HeldItemHandle,
} from './ItemDefinition';
export { itemUseMoves, itemUsesFor, isItemUseMove } from './ItemDefinition';
export { resolveItemInput } from './resolveItemInput';
export type { ItemInputDecision, ItemInputPattern } from './resolveItemInput';
export { ITEM_CATALOG,ITEM_SPAWN_TABLE, enabledCatalogEntries,enabledSpawnItems, pickSpawnItem, isBatteringItemMove,
  isOrdinaryItemDefinition,smashBallSwitchEnabled } from './itemCatalog';
export type { ItemSwitch } from './itemCatalog';

export { HOME_RUN_BAT_DEFINITION } from './HomeRunBat';
export { BEAM_SWORD_DEFINITION } from './BeamSword';
export { STAR_ROD_DEFINITION, STAR_ROD_STAR } from './StarRod';
export { itemMotionClip, itemChargeClip } from './itemMotionClips';
export { HAMMER_DEFINITION, GOLDEN_HAMMER_DEFINITION, HAMMER_HEAD_DEFINITION } from './Hammer';
export { RAY_GUN_DEFINITION, RAY_GUN_SHOT } from './RayGun';
export { SUPER_SCOPE_DEFINITION, SUPER_SCOPE_STAGES } from './SuperScope';
export { FIRE_FLOWER_DEFINITION, FIRE_FLOWER_FLAME } from './FireFlower';
export { startShooting, stepShooting, shootingMotion, scopeStageFor } from './itemShooting';
export type { ShootingSpec, ShootingState, ShootingClips } from './itemShooting';
export { BOB_OMB_DEFINITION, BOB_OMB_SPEC, BOB_OMB_EXPLOSION, stepBobOmb, bobOmbFlashing, itemExplosionHit } from './BobOmb';
export type { BobOmbSpec, BobOmbState, ItemExplosionSpec } from './BobOmb';
export { BANANA_PEEL_DEFINITION, bananaSlipHit } from './BananaPeel';
export { CRATE_DEFINITION } from './Crate';
export { BARREL_DEFINITION, BARREL_THROW_PROFILE } from './Barrel';
export { CAPSULE_DEFINITION, CAPSULE_THROW_PROFILE, CAPSULE_THROW_DAMAGE, CAPSULE_EXPLOSION_DAMAGE } from './Capsule';
export { ITEM_CONTAINER_RNG_STREAM, beginContainer, containerBreakOutcome, eligibleContainerContents,
  containerBreaksOnImpact, stepContainerRoll } from './itemContainer';
export type { ContainerSpec, ContainerState, ContainerRollingSpec, ContainerRollingState,
  ContainerBreakDraws, ContainerBreakOutcome } from './itemContainer';
export {FOOD_DEFINITION,FOOD_VARIANTS,FOOD_HEAL_AMOUNTS,foodDefinition} from './Food';
export {HEART_CONTAINER_DEFINITION} from './HeartContainer';
export {MAXIM_TOMATO_DEFINITION} from './MaximTomato';
export {beginEating,stepEating,beginHealing,stepHealing} from './itemHealing';
export type {EatingState,HealingState,RecoverySpec} from './itemHealing';

// Runtime classes.
export { ItemEntity } from './ItemEntity';
export { ItemRegistry } from './ItemRegistry';
export { Inventory } from './Inventory';
