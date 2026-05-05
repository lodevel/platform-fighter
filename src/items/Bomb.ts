/**
 * Reference item — Bomb (T3 items framework, AC 15).
 *
 * Single-use throwable. Overrides the `neutralSpecial` slot while
 * held — pressing the special button arms the bomb and "fires" it
 * (in practice the bomb is thrown via the dedicated throw key with
 * `consumeOnImpact = true` so the bomb explodes on contact). The
 * neutralSpecial override here is the "drop in place / detonate"
 * fallback when the player hits special without a direction.
 *
 * Open-closed extensibility: this file is the entire bomb
 * contribution.
 */

import type { Character } from '../characters/Character';
import type { AttackMove } from '../characters/attacks';
import type {
  ItemDefinition,
  SlotOverrideContext,
  ThrowBehavior,
} from './ItemDefinition';
import type { ItemEntity } from './ItemEntity';
import type { AttackMovesetSlotName } from '../characters/movesetContract';

/**
 * Authored detonation move for the bomb. The bomb's neutralSpecial
 * press detonates in the holder's hand — a wide AoE hit that damages
 * the holder less than nearby opponents because real Smash bombs
 * always go off in your face. Registered on the holder at pickup.
 */
export const BOMB_DETONATION_MOVE: AttackMove = Object.freeze({
  id: 'item.bomb.detonate',
  type: 'smash',
  damage: 18,
  knockback: { x: 4.0, y: -2.0, scaling: 0.42 },
  hitbox: {
    offsetX: 0,
    offsetY: 0,
    width: 110,
    height: 90,
  },
  startupFrames: 6,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 8,
  animation: {
    startupFrames: 2,
    activeFrames: 2,
    recoveryFrames: 2,
  },
});

const BOMB_THROW_BEHAVIOR: ThrowBehavior = Object.freeze({
  // Heavier launch on every direction — bombs are a commitment.
  forward: { velocityX: 16, velocityY: -5 },
  back: { velocityX: -12, velocityY: -5 },
  up: { velocityX: 0, velocityY: -18 },
  down: { velocityX: 0, velocityY: 16 },
  drop: { velocityX: 0, velocityY: 0 },
  // Bomb explodes on impact — single-use throwable.
  consumeOnImpact: true,
});

function buildBombSlotOverride(
  _slot: AttackMovesetSlotName,
  ctx: SlotOverrideContext,
): () => boolean {
  const item = ctx.itemEntity as ItemEntity;
  const holder = ctx.holder as Character;
  return () => {
    if (item.getDurability() <= 0) return false;
    if (item.isBroken() || item.isDespawned()) return false;
    // Fire the detonation AoE move via the canonical attack path.
    const fired = holder.attemptAttack(BOMB_DETONATION_MOVE.id);
    if (!fired) return false;
    item.consumeDurability();
    const pos = holder.getPosition();
    item.markBroken(ctx.frame, { x: pos.x, y: pos.y });
    return true;
  };
}

export const BOMB_DEFINITION: ItemDefinition = Object.freeze({
  type: 'bomb',
  category: 'throwable',
  // Single-use — one detonation and it's gone.
  maxDurability: 1,
  // Throwables reclaim quickly — they're high-impact, low-supply.
  ttlFrames: 360,
  brokenDespawnFrames: 30,
  // Per the seed's "while holding, jab re-routes to the item's slot
  // override" contract. Jab in-hand = detonate-in-place; throw key
  // (grab binding) = launch as a thrown explosive. Consistent with
  // bat / ray gun hijacking jab too.
  slotOverrides: Object.freeze(['jab'] as AttackMovesetSlotName[]),
  buildSlotOverride: buildBombSlotOverride,
  throwBehavior: BOMB_THROW_BEHAVIOR,
  attackMoves: Object.freeze([BOMB_DETONATION_MOVE]),
});
