/**
 * Item — Hammer (T3 items framework, open-closed extension).
 *
 * Melee weapon, the slow colossal KO tool of the item pool. Overrides
 * `jab`, `tilt`, `smash` slots while held — pressing any of those
 * buttons winds up a massive overhead smash and decrements durability.
 * Breaks after only 3 hits: the hammer trades everything (startup,
 * recovery, durability budget) for raw kill power.
 *
 * Design intent vs the bat:
 *
 *   • Damage 22 / scaling 0.38 — finisher-smash tier and beyond; a
 *     single connect at mid percent is a stock threat.
 *   • startupFrames 14 — heavily telegraphed, over twice a fighter
 *     smash. Opponents get a real reaction window; landing the hammer
 *     is a read, not a mash.
 *   • maxDurability 3 — three swings and it's debris. The bat is a
 *     sustained power-up; the hammer is three kill attempts.
 *
 * Open-closed extensibility: this file is the entire hammer
 * contribution. The framework reads `HAMMER_DEFINITION` off the
 * {@link ItemEntity}; no other module mentions `'hammer'` by name.
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
 * Authored smash move for the hammer. Registered on the holder at
 * pickup time (see `Inventory.pickup`), and fired by the slot
 * override below via `attemptAttack`. The frame data is deliberately
 * lopsided — 14 frames of telegraphed wind-up (over twice a fighter
 * smash) into a 4-frame live window, then 18 frames of whiffed-it
 * recovery. Huge hitbox, huge knockback: when it connects, it KOs.
 */
export const HAMMER_SMASH_MOVE: AttackMove = Object.freeze({
  id: 'item.hammer.smash',
  type: 'jab',
  damage: 22,
  knockback: { x: 4.5, y: -2.0, scaling: 0.38 },
  hitbox: {
    offsetX: 34,
    offsetY: -8,
    width: 50,
    height: 44,
  },
  // Telegraphed — over twice a fighter smash's startup. The wind-up
  // is the hammer's entire counterplay surface.
  startupFrames: 14,
  activeFrames: 4,
  recoveryFrames: 18,
  cooldownFrames: 10,
  animation: {
    startupFrames: 2,
    activeFrames: 1,
    recoveryFrames: 2,
  },
});

const HAMMER_THROW_BEHAVIOR: ThrowBehavior = Object.freeze({
  forward: { velocityX: 12, velocityY: -2 },
  back: { velocityX: -9, velocityY: -2 },
  up: { velocityX: 0, velocityY: -14 },
  down: { velocityX: 0, velocityY: 14 },
  drop: { velocityX: 0, velocityY: 0 },
  consumeOnImpact: false,
});

/**
 * Hammer per-slot fire callback. Same callback for jab / tilt / smash —
 * the hammer doesn't differentiate the swing per slot today; a future
 * polish pass could vary swing animation by slot. Returns `true` to
 * consume the press; on the last successful swing it also marks the
 * item broken in-place.
 *
 * The callback is intentionally minimal — a Phaser integration layer
 * spawns the actual hammer-smash hitbox by reading the holder's facing
 * + position. The deterministic data layer just tracks durability.
 */
function buildHammerSlotOverride(
  _slot: AttackMovesetSlotName,
  ctx: SlotOverrideContext,
): () => boolean {
  const item = ctx.itemEntity as ItemEntity;
  const holder = ctx.holder as Character;
  return () => {
    if (item.getDurability() <= 0) return false;
    if (item.isBroken() || item.isDespawned()) return false;
    // Fire the actual smash move — registered on the holder when the
    // hammer was picked up. `attemptAttack` runs the canonical
    // startup/active/recovery cycle, spawns a real hitbox during the
    // active window, and routes damage through the standard combat
    // pipeline. Without this, the override would silently consume
    // the input press without any visible swing.
    const fired = holder.attemptAttack(HAMMER_SMASH_MOVE.id);
    if (!fired) return false;
    item.consumeDurability();
    if (item.getDurability() <= 0) {
      // Last-use-broken transition. Drop the hammer at the holder's
      // current position; the inventory layer detaches the slot
      // override on the same path the natural drop would.
      const pos = holder.getPosition();
      item.markBroken(ctx.frame, { x: pos.x, y: pos.y });
    }
    return true;
  };
}

export const HAMMER_DEFINITION: ItemDefinition = Object.freeze({
  type: 'hammer',
  category: 'melee-weapon',
  // 3 hits before break — tiny budget by design. The hammer is three
  // kill attempts, not a sustained power-up like the 5-hit bat.
  maxDurability: 3,
  // Unpicked grounded hammer lives ~8 seconds (480 frames @ 60 fps
  // fixed-step) — shorter than the bat's 600; a free KO tool sitting
  // on stage for too long warps the item economy.
  ttlFrames: 480,
  // Broken-debris stays for ~30 frames (~half a second) so the
  // breakage reads visually before the entity reclaims.
  brokenDespawnFrames: 30,
  slotOverrides: Object.freeze(['jab', 'tilt', 'smash'] as AttackMovesetSlotName[]),
  buildSlotOverride: buildHammerSlotOverride,
  throwBehavior: HAMMER_THROW_BEHAVIOR,
  attackMoves: Object.freeze([HAMMER_SMASH_MOVE]),
});
