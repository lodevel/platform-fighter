/**
 * Pickup controller — T3 items framework, AC 11.
 *
 * Drives the "press jab while standing near a grounded item" pickup
 * pathway. Reads the per-frame {@link CharacterInput.attack} press
 * (rising edge), scans the {@link ItemRegistry} for a grounded item
 * within proximity of the holder, and invokes {@link Inventory.pickup}
 * if both gates pass.
 *
 * Wiring contract:
 *
 *   • Runs BEFORE Character.applyInput so a successful pickup installs
 *     slot overrides that the same frame's tickAttack consults. This
 *     is the "pickup happens on the press frame; the same press
 *     never both picks up AND fires" canonical Smash rule.
 *   • Skipped while the holder is already carrying — single-slot
 *     inventory invariant. The player's jab press then routes to
 *     the held item's slot override (bat swing, etc.) instead.
 */

import type { Character } from '../characters/Character';
import type { ItemEntity } from './ItemEntity';
import type { ItemRegistry } from './ItemRegistry';
import type { Inventory } from './Inventory';

/** Default proximity in design pixels — fighters within this radius can grab. */
export const DEFAULT_PICKUP_RADIUS_PX = 64;

export interface PickupControllerOptions {
  readonly pickupRadiusPx?: number;
}

export class PickupController {
  private readonly pickupRadius: number;

  constructor(options: PickupControllerOptions = {}) {
    this.pickupRadius = options.pickupRadiusPx ?? DEFAULT_PICKUP_RADIUS_PX;
  }

  /**
   * Try to pick up the nearest pickable item within
   * {@link pickupRadiusPx} of `holder`. Returns the picked item iff
   * a pickup fired this call.
   *
   * Caller contract:
   *   • Pass `attackJustPressed = true` only on a rising-edge frame.
   *   • Pass `currentFrame` from the simulation's fixed-step counter.
   *
   * Determinism: pure projection over `(holder position, registry
   * state, current frame)` — no `Math.random()`, no wall-clock reads.
   * Two runs with the same registry produce the same pickup order.
   */
  tryPickup(
    holder: Character,
    inventory: Inventory,
    registry: ItemRegistry,
    holderPlayerIndex: number,
    currentFrame: number,
    attackJustPressed: boolean,
  ): ItemEntity | null {
    if (!attackJustPressed) return null;
    if (inventory.isHolding()) return null;

    const holderPos = holder.getPosition();
    const candidates = registry.getGrounded();
    let nearest: ItemEntity | null = null;
    let nearestDist = Infinity;
    for (const item of candidates) {
      const ipos = item.getPosition();
      const dx = ipos.x - holderPos.x;
      const dy = ipos.y - holderPos.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= this.pickupRadius && d < nearestDist) {
        nearest = item;
        nearestDist = d;
      }
    }
    if (nearest === null) return null;

    const ok = inventory.pickup(nearest, currentFrame, holderPlayerIndex, holderPos);
    return ok ? nearest : null;
  }
}
