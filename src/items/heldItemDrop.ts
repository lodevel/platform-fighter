/**
 * Held item lost on hit (Ultimate items, phase 2). SmashWiki Item#Item_drop_chance: "normal items use
 * the formula base damage / 70, with the base damage rounded up" (universal-rules.json
 * dropToss.dropChanceWhenHit); "shooting items ... that have run out of ammo have a nearly guaranteed drop
 * chance, using the formula base damage / 2" (dropToss.dropChanceEmptyShooting, Smash 4 and Ultimate).
 * The roll uses its own named MatchRng stream so no other stream shifts.
 */
import type { Rng } from '../utils/Rng';

export const ITEM_DROP_RNG_STREAM = 'item-drop' as const;

export function heldItemDropChance(baseDamage: number, emptyShooter = false): number {
  const damage = Math.max(0, baseDamage);
  return Math.min(1, emptyShooter ? damage / 2 : Math.ceil(damage) / 70);
}

/** One roll per landed hit on a fighter holding a light item. */
export function rollHeldItemDrop(rng: Rng, baseDamage: number, emptyShooter = false): boolean {
  return rng.next() < heldItemDropChance(baseDamage, emptyShooter);
}
