/**
 * Sword — precise long-reach blade (T3 items framework, 4th item).
 *
 * Melee weapon. Overrides `jab`, `tilt`, `smash` slots while held —
 * pressing any of those buttons slashes the sword and decrements
 * durability. Breaks after 8 successful melee hits.
 *
 * Design identity vs the bat: the bat is the raw power pick (14 base
 * damage, fat hitbox); the sword trades base damage for reach and a
 * Marth-style TIP sweet-spot. Landing the outer 24 px of the blade
 * multiplies damage and knockback — the sword rewards spacing, the
 * bat rewards brawling.
 *
 * Open-closed extensibility: this file is the entire sword
 * contribution. The framework reads `SWORD_DEFINITION` off the
 * {@link ItemEntity}; no other module mentions `'sword'` by name.
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
 * Authored slash move for the sword. Registered on the holder at
 * pickup time (see `Inventory.pickup`), and fired by the slot
 * override below via `attemptAttack`.
 *
 * Tuning notes: base damage (11) sits below the bat's 14 but the
 * hitbox reaches further out (64 px wide starting at the holder's
 * arm length) and comes out a frame faster. The `sweetSpot` is the
 * outermost 24 px of the blade — the TIP. A tipper connect lands
 * 11 × 1.35 ≈ 14.85 damage with 1.3× knockback, out-damaging the bat
 * *only* when the holder spaces the slash correctly. The tip rewards
 * spacing; a point-blank slash is deliberately the weaker hit.
 */
export const SWORD_SLASH_MOVE: AttackMove = Object.freeze({
  id: 'item.sword.slash',
  type: 'jab',
  damage: 11,
  knockback: { x: 2.6, y: -0.9, scaling: 0.22 },
  hitbox: {
    offsetX: 42,
    offsetY: -6,
    width: 64,
    height: 26,
  },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 9,
  cooldownFrames: 6,
  animation: {
    startupFrames: 1,
    activeFrames: 1,
    recoveryFrames: 2,
  },
  // Marth-style tipper — strict sub-region covering the far edge of
  // the blade (parent spans x ∈ [10, 74]; the tip spans x ∈ [50, 74]).
  // Same vertical band as the parent so the sweet/sour split is purely
  // a horizontal spacing question.
  sweetSpot: {
    hitbox: {
      offsetX: 62,
      offsetY: -6,
      width: 24,
      height: 26,
    },
    damageMultiplier: 1.35,
    knockbackMultiplier: 1.3,
  },
});

const SWORD_THROW_BEHAVIOR: ThrowBehavior = Object.freeze({
  forward: { velocityX: 15, velocityY: -2 },
  back: { velocityX: -11, velocityY: -2 },
  up: { velocityX: 0, velocityY: -17 },
  down: { velocityX: 0, velocityY: 13 },
  drop: { velocityX: 0, velocityY: 0 },
  consumeOnImpact: false,
});

/**
 * Sword per-slot fire callback. Same callback for jab / tilt / smash —
 * the sword doesn't differentiate the slash per slot today; a future
 * polish pass could vary slash animation by slot. Returns `true` to
 * consume the press; on the last successful slash it also marks the
 * item broken in-place.
 *
 * The callback is intentionally minimal — a Phaser integration layer
 * spawns the actual slash hitbox (and resolves the tipper sub-region)
 * by reading the holder's facing + position. The deterministic data
 * layer just tracks durability.
 */
function buildSwordSlotOverride(
  _slot: AttackMovesetSlotName,
  ctx: SlotOverrideContext,
): () => boolean {
  const item = ctx.itemEntity as ItemEntity;
  const holder = ctx.holder as Character;
  return () => {
    if (item.getDurability() <= 0) return false;
    if (item.isBroken() || item.isDespawned()) return false;
    // Fire the actual slash move — registered on the holder when the
    // sword was picked up. `attemptAttack` runs the canonical
    // startup/active/recovery cycle, spawns a real hitbox during the
    // active window (sweet-spot resolution included), and routes
    // damage through the standard combat pipeline. Without this, the
    // override would silently consume the input press without any
    // visible slash.
    const fired = holder.attemptAttack(SWORD_SLASH_MOVE.id);
    if (!fired) return false;
    item.consumeDurability();
    if (item.getDurability() <= 0) {
      // Last-use-broken transition. Drop the sword at the holder's
      // current position; the inventory layer detaches the slot
      // override on the same path the natural drop would.
      const pos = holder.getPosition();
      item.markBroken(ctx.frame, { x: pos.x, y: pos.y });
    }
    return true;
  };
}

export const SWORD_DEFINITION: ItemDefinition = Object.freeze({
  type: 'sword',
  category: 'melee-weapon',
  // 8 melee hits before break — more uses than the bat's 5 to balance
  // the lower base damage; the sword is the endurance pick.
  maxDurability: 8,
  // Unpicked grounded sword sticks around for ~10 seconds (600 frames
  // @ 60 fps fixed-step) — same melee-weapon TTL budget as the bat.
  ttlFrames: 600,
  // Broken-debris stays for ~30 frames (~half a second) so the
  // breakage reads visually before the entity reclaims.
  brokenDespawnFrames: 30,
  slotOverrides: Object.freeze(['jab', 'tilt', 'smash'] as AttackMovesetSlotName[]),
  buildSlotOverride: buildSwordSlotOverride,
  throwBehavior: SWORD_THROW_BEHAVIOR,
  attackMoves: Object.freeze([SWORD_SLASH_MOVE]),
});
