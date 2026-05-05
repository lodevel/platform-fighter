/**
 * Runtime per-item entity state — T3 items framework, AC 10-19.
 *
 * Pairs an {@link ItemDefinition} (frozen authoring data) with the
 * per-instance mutable state every live item carries: lifecycle snapshot,
 * durability, position / velocity, throw-after impact tracking. The
 * entity is the single source of truth for "this specific bat / ray
 * gun / bomb on the stage right now" — Phaser sprite refs and Matter
 * bodies are attached as opaque handles so this module stays Phaser-
 * free and unit-testable.
 *
 * Determinism contract
 * --------------------
 *
 * Every state mutation is a pure function of (current snapshot,
 * current frame, supplied event). No `Math.random()`, no wall-clock
 * reads — the runtime drives every transition through method calls
 * the test harness can replay deterministically.
 */

import type { ItemDefinition } from './ItemDefinition';
import {
  type ItemLifecycleSnapshot,
  transitionToBroken,
} from './itemLifecycle';

/**
 * Mutable per-item runtime state. One instance per spawned item; the
 * {@link ItemRegistry} owns the array of live entities.
 */
export class ItemEntity {
  /** Stable monotonic id; assigned by the {@link ItemRegistry} on spawn. */
  readonly id: number;

  /** Frozen per-type declaration (Bat/RayGun/Bomb). */
  readonly definition: ItemDefinition;

  /**
   * Current lifecycle snapshot. Updated by transition methods below.
   * Frozen at every transition so callers can stash references for
   * replay capture without worrying about retroactive mutation.
   */
  private snapshot: ItemLifecycleSnapshot;

  /**
   * Remaining uses before the item breaks. Starts at
   * `definition.maxDurability` and decrements on each successful
   * use; reaching zero schedules the {@link ItemEntity.markBroken}
   * transition.
   */
  private durabilityRemaining: number;

  /**
   * Frame the item entered the world. Used by the TTL despawn check
   * (`frame - spawnedAtFrame >= ttlFrames` ⇒ despawn an unpicked
   * grounded item).
   */
  readonly spawnedAtFrame: number;

  /**
   * Optional Phaser/Matter handle the runtime attaches at spawn time
   * (sprite + body). Typed `unknown` so this module stays Phaser-free;
   * the Phaser integration layer casts as needed.
   */
  attachedRender: unknown = null;

  constructor(
    id: number,
    definition: ItemDefinition,
    spawnedAtFrame: number,
    spawnPosition: { readonly x: number; readonly y: number },
  ) {
    this.id = id;
    this.definition = definition;
    this.spawnedAtFrame = spawnedAtFrame;
    this.durabilityRemaining = definition.maxDurability;
    this.snapshot = Object.freeze({
      state: 'falling' as const,
      holderPlayerIndex: null,
      position: Object.freeze({ x: spawnPosition.x, y: spawnPosition.y }),
      stateEnteredFrame: spawnedAtFrame,
    });
  }

  // -------------------------------------------------------------------------
  // Read-only accessors
  // -------------------------------------------------------------------------

  getSnapshot(): ItemLifecycleSnapshot {
    return this.snapshot;
  }

  getDurability(): number {
    return this.durabilityRemaining;
  }

  /** True iff the item is still pickable (lifecycle === 'grounded'). */
  isPickable(): boolean {
    return this.snapshot.state === 'grounded';
  }

  isHeld(): boolean {
    return this.snapshot.state === 'held';
  }

  isBroken(): boolean {
    return this.snapshot.state === 'broken';
  }

  isDespawned(): boolean {
    return this.snapshot.state === 'despawned';
  }

  getPosition(): { readonly x: number; readonly y: number } {
    return this.snapshot.position;
  }

  getHolderPlayerIndex(): number | null {
    return this.snapshot.holderPlayerIndex;
  }

  // -------------------------------------------------------------------------
  // Lifecycle transitions
  // -------------------------------------------------------------------------

  /**
   * Transition `falling → grounded` once the item lands on the floor.
   * Caller (Phaser physics layer) detects ground contact and calls
   * this; the runtime stamps the entry frame.
   */
  markGrounded(currentFrame: number, position: { x: number; y: number }): void {
    if (this.snapshot.state !== 'falling') return;
    this.snapshot = Object.freeze({
      state: 'grounded' as const,
      holderPlayerIndex: null,
      position: Object.freeze({ x: position.x, y: position.y }),
      stateEnteredFrame: currentFrame,
    });
  }

  /** Transition `grounded → held` on pickup. */
  markHeld(currentFrame: number, holderPlayerIndex: number, holderPos: { x: number; y: number }): void {
    if (this.snapshot.state !== 'grounded') return;
    this.snapshot = Object.freeze({
      state: 'held' as const,
      holderPlayerIndex,
      position: Object.freeze({ x: holderPos.x, y: holderPos.y }),
      stateEnteredFrame: currentFrame,
    });
  }

  /** Update the held item's position (tracks the holder's hand each tick). */
  updateHeldPosition(holderPos: { x: number; y: number }): void {
    if (this.snapshot.state !== 'held') return;
    this.snapshot = Object.freeze({
      state: 'held' as const,
      holderPlayerIndex: this.snapshot.holderPlayerIndex,
      position: Object.freeze({ x: holderPos.x, y: holderPos.y }),
      stateEnteredFrame: this.snapshot.stateEnteredFrame,
    });
  }

  /**
   * Transition `held → grounded` on intact drop (e.g. holder
   * voluntarily drops, gets KO'd while holding, or the item is thrown
   * with the `'drop'` direction).
   */
  markDropped(currentFrame: number, dropPosition: { x: number; y: number }): void {
    if (this.snapshot.state !== 'held') return;
    this.snapshot = Object.freeze({
      state: 'grounded' as const,
      holderPlayerIndex: null,
      position: Object.freeze({ x: dropPosition.x, y: dropPosition.y }),
      stateEnteredFrame: currentFrame,
    });
  }

  /**
   * Decrement the durability counter. Returns `true` when durability
   * remains (the use was nominal); returns `false` when this use just
   * exhausted the last charge — the caller is expected to call
   * {@link markBroken} on the same frame to drop inert.
   */
  consumeDurability(): boolean {
    if (this.durabilityRemaining <= 0) return false;
    this.durabilityRemaining -= 1;
    return this.durabilityRemaining > 0;
  }

  /**
   * Drop the item inert at `dropPosition` and stamp the broken-frame
   * for the despawn timer. Composes the pure
   * {@link transitionToBroken} helper from `itemLifecycle.ts`.
   */
  markBroken(currentFrame: number, dropPosition: { x: number; y: number }): void {
    const result = transitionToBroken({
      snapshot: this.snapshot,
      currentFrame,
      dropPosition,
    });
    if (result.ok) {
      this.snapshot = result.next;
    }
  }

  /**
   * Transition `broken → despawned` once the broken-debris timer has
   * elapsed. Also valid from `grounded` (TTL expiry on an unpicked
   * item) and from `falling` (defensive — never happens today).
   */
  markDespawned(currentFrame: number): void {
    if (this.snapshot.state === 'despawned') return;
    this.snapshot = Object.freeze({
      state: 'despawned' as const,
      holderPlayerIndex: null,
      position: this.snapshot.position,
      stateEnteredFrame: currentFrame,
    });
  }

  // -------------------------------------------------------------------------
  // Per-tick updates
  // -------------------------------------------------------------------------

  /**
   * Per-tick free-position update for `falling` / `grounded` items
   * (tracks the Matter body's centre); the registry runs this every
   * frame for non-held items so the snapshot stays in sync with the
   * physics body.
   */
  updateFreePosition(position: { x: number; y: number }): void {
    if (this.snapshot.state === 'held' || this.snapshot.state === 'despawned') {
      return;
    }
    this.snapshot = Object.freeze({
      state: this.snapshot.state,
      holderPlayerIndex: null,
      position: Object.freeze({ x: position.x, y: position.y }),
      stateEnteredFrame: this.snapshot.stateEnteredFrame,
    });
  }

  /**
   * Pure-data despawn check — returns true iff the item should be
   * reclaimed this tick. Used by the registry to drive
   * {@link markDespawned}; pure so unit tests pin every transition
   * without booting Phaser.
   */
  shouldDespawn(currentFrame: number): boolean {
    if (this.snapshot.state === 'despawned') return false;
    if (this.snapshot.state === 'broken') {
      const stateFrame = this.snapshot.stateEnteredFrame;
      if (stateFrame === null) return false;
      return currentFrame - stateFrame >= this.definition.brokenDespawnFrames;
    }
    if (this.snapshot.state === 'grounded') {
      const stateFrame = this.snapshot.stateEnteredFrame;
      if (stateFrame === null) return false;
      return currentFrame - stateFrame >= this.definition.ttlFrames;
    }
    return false;
  }
}
