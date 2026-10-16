/**
 * Per-fighter single-slot inventory.
 *
 * Owns the pickup / drop / throw transitions that move an {@link ItemEntity}
 * into and out of the slot. On pickup it registers the item's use moves on
 * the holder and equips the item, so the holder's attack dispatch can route
 * presses through {@link import('./resolveItemInput').resolveItemInput}; every
 * way out of the slot unequips it. No per-item code lives here.
 */

import type { Character } from '../characters/Character';
import type { ItemEntity } from './ItemEntity';
import { itemUseMoves } from './ItemDefinition';

/** Holder surface the inventory drives. */
type ItemHolder = Pick<Character, 'id' | 'addAttack' | 'equipItem' | 'unequipItem'> & Partial<Pick<Character,'isTumbling'>>;

export class Inventory {
  private heldItem: ItemEntity | null = null;

  constructor(private readonly holder: ItemHolder) {}

  /** The held item, or null when the slot is empty. */
  getHeldItem(): ItemEntity | null {
    return this.heldItem;
  }

  isHolding(): boolean {
    return this.heldItem !== null;
  }

  /**
   * Take `item` into the empty slot. Rejects when already holding, when the
   * item is not holdable, or when its lifecycle does not allow the
   * acquisition. Returns true iff the pickup was accepted.
   */
  pickup(
    item: ItemEntity,
    currentFrame: number,
    holderPlayerIndex: number,
    holderPos: { x: number; y: number },
    acquisition: 'ground' | 'catch' = 'ground',
  ): boolean {
    if (this.heldItem !== null) return false;
    if (item.definition.holdable === false || (acquisition === 'catch' ? !item.isCatchable() : !item.isPickable())) return false;
    item.markHeld(currentFrame, holderPlayerIndex, holderPos, acquisition);
    this.heldItem = item;
    for (const move of itemUseMoves(item.definition, this.holder.id)) this.holder.addAttack(move);
    this.holder.equipItem(item);
    return true;
  }

  /** Drop the held item intact at `dropPosition`. */
  drop(currentFrame: number, dropPosition: { x: number; y: number }, reason: 'voluntary'|'damage'|'reset'='voluntary'): ItemEntity | null {
    if(reason==='voluntary' && this.heldItem?.definition.hammer && !this.holder.isTumbling?.()) return null;
    const item = this.release();
    item?.markDropped(currentFrame, dropPosition);
    return item;
  }

  /** Empty the slot without a lifecycle change (the thrower owns the item's flight). */
  detachWithoutDrop(): ItemEntity | null {
    return this.release();
  }

  /** Empty the slot and drop the item inert (broken). */
  breakHeldItem(currentFrame: number, dropPosition: { x: number; y: number }): ItemEntity | null {
    const item = this.release();
    item?.markBroken(currentFrame, dropPosition);
    return item;
  }

  private release(): ItemEntity | null {
    const item = this.heldItem;
    if (item === null) return null;
    this.heldItem = null;
    this.holder.unequipItem();
    return item;
  }
}
