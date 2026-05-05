/**
 * Items framework module barrel (T3, AC 10).
 *
 * Houses the Smash-style items / weapons subsystem: pickup, drop,
 * throw, spawn manager, replay-RNG seeding, reference items (bat, ray
 * gun, bomb), and the item-aware AI hooks. Each file inside
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

// T3 — item definition contract (open-closed extension point: a 4th
// item type is a new subclass file with one frozen ItemDefinition).
export type {
  ItemCategory,
  ItemDefinition,
  ThrowBehavior,
  ThrowDirection,
  ThrowVector,
  SlotOverrideContext,
  SlotOverrideFactory,
} from './ItemDefinition';
export { ITEM_CATEGORIES } from './ItemDefinition';

// Reference items.
export { BAT_DEFINITION } from './Bat';
export { RAY_GUN_DEFINITION } from './RayGun';
export { BOMB_DEFINITION } from './Bomb';

// Runtime classes.
export { ItemEntity } from './ItemEntity';
export { ItemRegistry } from './ItemRegistry';
export { Inventory } from './Inventory';
export {
  PickupController,
  DEFAULT_PICKUP_RADIUS_PX,
} from './PickupController';
export type { PickupControllerOptions } from './PickupController';
export {
  ThrowController,
  resolveThrowDirection,
  resolveThrowImpulse,
} from './ThrowController';
export type { ThrowResult } from './ThrowController';
