/**
 * Per-fighter single-slot inventory — T3 items framework, AC 11-15.
 *
 * The Seed's `inventorySlot` ontology pins single-slot semantics:
 * each fighter holds at most one item at a time. This module owns the
 * pickup / drop / throw transitions that move an {@link ItemEntity}
 * into and out of that slot, including the per-slot override
 * installation on the holder via
 * {@link Character.setSlotOverride}.
 *
 * Open-closed extensibility: zero edits required to add a 4th item
 * type. The inventory reads `definition.slotOverrides` and
 * `definition.buildSlotOverride` off the item — categories and per-
 * item branching never appear here.
 */

import type { Character } from '../characters/Character';
import type { AttackMovesetSlotName } from '../characters/movesetContract';
import type { ItemEntity } from './ItemEntity';

/**
 * Tracks the currently-held item for one fighter. Constructed once
 * per match per player slot.
 */
export class Inventory {
  private heldItem: ItemEntity | null = null;
  private installedSlots: AttackMovesetSlotName[] = [];

  constructor(private readonly holder: Character) {}

  /**
   * Read the currently-held item, or `null` if the inventory is
   * empty. The pickup module reads this before attempting a pickup
   * — single-slot invariant: a holder with a held item rejects new
   * pickups.
   */
  getHeldItem(): ItemEntity | null {
    return this.heldItem;
  }

  isHolding(): boolean {
    return this.heldItem !== null;
  }

  /**
   * Pick up `item`. The holder's slot-override map is populated for
   * every slot the item declares; the per-slot factory is run once
   * (closed over the holder + item + initial frame) and the produced
   * callback is installed via {@link Character.setSlotOverride}.
   *
   * Idempotent: a holder already holding an item rejects the pickup.
   * The caller (PickupController) is expected to gate proximity /
   * lifecycle checks before reaching here.
   *
   * Returns `true` iff the pickup was accepted.
   */
  pickup(
    item: ItemEntity,
    currentFrame: number,
    holderPlayerIndex: number,
    holderPos: { x: number; y: number },
  ): boolean {
    if (this.heldItem !== null) return false;
    if (!item.isPickable()) return false;

    item.markHeld(currentFrame, holderPlayerIndex, holderPos);
    this.heldItem = item;

    // Register the item's authored attack moves on the holder so the
    // slot overrides can fire them via `attemptAttack`. Idempotent
    // re-registration is fine: `addAttack` overwrites the entry under
    // the same id, so picking up the same item type twice produces
    // identical move metadata each time. Guarded for unit tests that
    // construct a partial Character mock without the method.
    const def = item.definition;
    if (def.attackMoves && typeof this.holder.addAttack === 'function') {
      for (const move of def.attackMoves) {
        this.holder.addAttack(move);
      }
    }

    // Install slot overrides — one per slot the definition declares.
    this.installedSlots = [];
    for (const slot of def.slotOverrides) {
      const cb = def.buildSlotOverride(slot, {
        holder: this.holder,
        frame: currentFrame,
        itemEntity: item,
      });
      this.holder.setSlotOverride(slot, cb);
      this.installedSlots.push(slot);
    }
    return true;
  }

  /**
   * Voluntarily drop the held item intact at `dropPosition`. Used by
   * the throw module's `'drop'` direction (no stick held) and by the
   * KO / despawn flow when a holder loses their item without a throw.
   */
  drop(currentFrame: number, dropPosition: { x: number; y: number }): ItemEntity | null {
    if (this.heldItem === null) return null;
    const item = this.heldItem;
    item.markDropped(currentFrame, dropPosition);
    this.detachOverrides();
    this.heldItem = null;
    return item;
  }

  /**
   * Detach the held item from the slot without changing its lifecycle
   * — used by the throw module after it's already snapshotted the
   * item and applied a launch impulse. The runtime is responsible for
   * the lifecycle transition (Bomb sets `consumeOnImpact = true` and
   * the impact handler marks broken; Bat / RayGun stay grounded).
   */
  detachWithoutDrop(): ItemEntity | null {
    if (this.heldItem === null) return null;
    const item = this.heldItem;
    this.detachOverrides();
    this.heldItem = null;
    return item;
  }

  /**
   * Drop the held item inert (broken). Used when an item's
   * durability reaches zero mid-swing — the override callback
   * returns `false` to decline future presses, the carrier framework
   * spots the broken state and calls this.
   */
  breakHeldItem(currentFrame: number, dropPosition: { x: number; y: number }): ItemEntity | null {
    if (this.heldItem === null) return null;
    const item = this.heldItem;
    item.markBroken(currentFrame, dropPosition);
    this.detachOverrides();
    this.heldItem = null;
    return item;
  }

  /**
   * Detach every installed slot override from the holder. Called by
   * every drop / detach / break pathway above so the fighter's
   * native slot moves resume on the next press.
   */
  private detachOverrides(): void {
    for (const slot of this.installedSlots) {
      this.holder.clearSlotOverride(slot);
    }
    this.installedSlots = [];
  }
}
