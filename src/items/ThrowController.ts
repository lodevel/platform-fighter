/**
 * Throw controller — T3 items framework, AC 12.
 *
 * Smash-style direction-aware throw resolution. Reads the holder's
 * per-frame movement input at the throw-press frame and routes the
 * release through the held item's
 * {@link ItemDefinition.throwBehavior} table:
 *
 *   stick forward (sign(moveX) === holder facing)   → 'forward'
 *   stick back    (sign(moveX) === -holder facing)  → 'back'
 *   stick up      (jump key as up-flick)            → 'up'
 *   stick down    (downHeld / dropThrough)          → 'down'
 *   no direction held                               → 'drop'
 *
 * The dedicated throw key in the rebinding store maps to the `grab`
 * action — the runtime reads `input.grab === true` (rising edge) as
 * the throw press while a fighter is holding an item. This keeps
 * the throw key separately rebindable from attack / special and
 * follows the canonical Smash binding (Z = grab/throw).
 */

import type { Character } from '../characters/Character';
import type {
  ThrowDirection,
  ThrowVector,
} from './ItemDefinition';
import type { ItemEntity } from './ItemEntity';
import type { Inventory } from './Inventory';

/**
 * Threshold for deciding "stick is held side" vs "stick is neutral".
 * Mirrors the AERIAL_STICK_THRESHOLD used in
 * {@link Character.tickAttack}'s special-press dispatch so the
 * direction taxonomies stay aligned.
 */
const STICK_THRESHOLD = 0.3;

export interface ThrowResult {
  readonly item: ItemEntity;
  readonly direction: ThrowDirection;
  readonly velocityX: number;
  readonly velocityY: number;
}

/**
 * Pure helper — resolve the throw direction from the input fields
 * and the holder's facing. Phaser-free for unit testing.
 */
export function resolveThrowDirection(
  moveX: number,
  upHeld: boolean,
  downHeld: boolean,
  holderFacing: 1 | -1,
): ThrowDirection {
  if (downHeld) return 'down';
  if (upHeld) return 'up';
  if (Math.abs(moveX) >= STICK_THRESHOLD) {
    const sign = Math.sign(moveX);
    return sign === holderFacing ? 'forward' : 'back';
  }
  return 'drop';
}

/**
 * Resolve the launch vector for a throw direction, accounting for
 * facing (forward/back X-velocity is mirrored by holder facing so a
 * "forward throw" lands the item ahead regardless of orientation).
 */
export function resolveThrowImpulse(
  vec: ThrowVector,
  direction: ThrowDirection,
  holderFacing: 1 | -1,
): { readonly velocityX: number; readonly velocityY: number } {
  // Forward throws follow the holder's facing; back throws mirror to
  // the opposite. Up / down / drop are facing-agnostic.
  if (direction === 'forward' || direction === 'back') {
    return {
      velocityX: vec.velocityX * holderFacing,
      velocityY: vec.velocityY,
    };
  }
  return { velocityX: vec.velocityX, velocityY: vec.velocityY };
}

export class ThrowController {
  /**
   * Attempt a throw on a rising-edge throw-press frame. Returns the
   * resolved throw outcome (item + direction + launch vector) or
   * `null` if no throw fired (no item held, throw key not pressed
   * on this frame).
   *
   * Determinism: pure projection over `(input fields, inventory
   * state, holder facing, item throwBehavior)`.
   */
  tryThrow(
    holder: Character,
    inventory: Inventory,
    currentFrame: number,
    throwJustPressed: boolean,
    moveX: number,
    upHeld: boolean,
    downHeld: boolean,
  ): ThrowResult | null {
    if (!throwJustPressed) return null;
    const item = inventory.getHeldItem();
    if (item === null) return null;

    const facing = holder.getFacing();
    const direction = resolveThrowDirection(moveX, upHeld, downHeld, facing);
    const vec = item.definition.throwBehavior[direction];
    const impulse = resolveThrowImpulse(vec, direction, facing);

    // Detach from inventory without changing lifecycle — the runtime
    // physics layer applies the impulse and lets the body fly. For
    // the `'drop'` direction (no impulse) the item is intact-dropped
    // at the holder's position.
    if (direction === 'drop') {
      const pos = holder.getPosition();
      inventory.drop(currentFrame, { x: pos.x, y: pos.y });
    } else {
      inventory.detachWithoutDrop();
    }

    return {
      item,
      direction,
      velocityX: impulse.velocityX,
      velocityY: impulse.velocityY,
    };
  }
}
