import { heldItemPlacement } from '../../../src/characters/heldItemSocket';
import type { ItemView } from '../../../src/sim/view';
import type { HeldItemGrip } from '../fighters/appearance';

/**
 * A held item drawn at its holder's drawn grip (display only): a fighter drawn from its character package may hold
 * one drawing for several ticks with its socket, while the gameplay grip in `item` moves every tick. Without a
 * drawn grip (legacy art, an action without a socket) the item keeps the gameplay placement. Hit areas and muzzles
 * always use the gameplay grip.
 */
export function placeHeldItem(item: ItemView, grip: HeldItemGrip | null): ItemView {
  if (!item.held || !grip) return item;
  return { ...item, ...heldItemPlacement(grip, item.height, item.held.turns ? grip : null) };
}
