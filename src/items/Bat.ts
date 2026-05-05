/**
 * Reference item — Home-Run Bat (T3 items framework, AC 13).
 *
 * Melee weapon. Overrides `jab`, `tilt`, `smash` slots while held —
 * pressing any of those buttons swings the bat and decrements
 * durability. Breaks after 5 successful melee hits.
 *
 * Open-closed extensibility: this file is the entire bat contribution.
 * The framework reads `BAT_DEFINITION` off the {@link ItemEntity}; no
 * other module mentions `'bat'` by name. A hypothetical 4th item
 * (e.g. `Sword.ts`) lands as a sibling file with zero edits anywhere
 * else in the framework.
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
 * Authored swing move for the bat. Registered on the holder at
 * pickup time (see `Inventory.pickup`), and fired by the slot
 * override below via `attemptAttack`. Damage is well above each
 * fighter's smash tier so the bat is a clear power upgrade for the
 * jab/tilt/smash slots it replaces while held.
 */
export const BAT_SWING_MOVE: AttackMove = Object.freeze({
  id: 'item.bat.swing',
  type: 'jab',
  damage: 14,
  knockback: { x: 3.2, y: -1.2, scaling: 0.26 },
  hitbox: {
    offsetX: 36,
    offsetY: -4,
    width: 56,
    height: 32,
  },
  startupFrames: 4,
  activeFrames: 4,
  recoveryFrames: 10,
  cooldownFrames: 6,
  animation: {
    startupFrames: 1,
    activeFrames: 2,
    recoveryFrames: 1,
  },
});

const BAT_THROW_BEHAVIOR: ThrowBehavior = Object.freeze({
  forward: { velocityX: 14, velocityY: -3 },
  back: { velocityX: -10, velocityY: -3 },
  up: { velocityX: 0, velocityY: -16 },
  down: { velocityX: 0, velocityY: 12 },
  drop: { velocityX: 0, velocityY: 0 },
  consumeOnImpact: false,
});

/**
 * Bat per-slot fire callback. Same callback for jab / tilt / smash —
 * the bat doesn't differentiate the swing per slot today; a future
 * polish pass could vary swing animation by slot. Returns `true` to
 * consume the press; on the last successful swing it also marks the
 * item broken in-place.
 *
 * The callback is intentionally minimal — a Phaser integration layer
 * spawns the actual bat-swing hitbox by reading the holder's facing
 * + position. The deterministic data layer just tracks durability.
 */
function buildBatSlotOverride(
  _slot: AttackMovesetSlotName,
  ctx: SlotOverrideContext,
): () => boolean {
  const item = ctx.itemEntity as ItemEntity;
  const holder = ctx.holder as Character;
  return () => {
    if (item.getDurability() <= 0) return false;
    if (item.isBroken() || item.isDespawned()) return false;
    // Fire the actual swing move — registered on the holder when the
    // bat was picked up. `attemptAttack` runs the canonical
    // startup/active/recovery cycle, spawns a real hitbox during the
    // active window, and routes damage through the standard combat
    // pipeline. Without this, the override would silently consume
    // the input press without any visible swing.
    const fired = holder.attemptAttack(BAT_SWING_MOVE.id);
    if (!fired) return false;
    item.consumeDurability();
    if (item.getDurability() <= 0) {
      // Last-use-broken transition. Drop the bat at the holder's
      // current position; the inventory layer detaches the slot
      // override on the same path the natural drop would.
      const pos = holder.getPosition();
      item.markBroken(ctx.frame, { x: pos.x, y: pos.y });
    }
    return true;
  };
}

export const BAT_DEFINITION: ItemDefinition = Object.freeze({
  type: 'bat',
  category: 'melee-weapon',
  // 5 melee hits before break (the canonical home-run-bat budget).
  maxDurability: 5,
  // Unpicked grounded bat sticks around for ~10 seconds (600 frames @
  // 60 fps fixed-step) — long enough for a fighter to walk over from
  // mid-stage but short enough that ignored items reclaim cleanly.
  ttlFrames: 600,
  // Broken-debris stays for ~30 frames (~half a second) so the
  // breakage reads visually before the entity reclaims.
  brokenDespawnFrames: 30,
  slotOverrides: Object.freeze(['jab', 'tilt', 'smash'] as AttackMovesetSlotName[]),
  buildSlotOverride: buildBatSlotOverride,
  throwBehavior: BAT_THROW_BEHAVIOR,
  attackMoves: Object.freeze([BAT_SWING_MOVE]),
});
