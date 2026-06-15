/**
 * Spear — longest-reach melee item (4th item, open-closed proof).
 *
 * Melee weapon. Overrides `jab` and `tilt` slots while held — pressing
 * either button thrusts the spear forward and decrements durability.
 * Breaks after 7 successful pokes.
 *
 * Design choice — no `smash` override
 * -----------------------------------
 * The spear deliberately does NOT override the `smash` slot. Its whole
 * identity is the disjointed poke: a long, fast, low-commitment stab
 * that out-spaces every native jab/tilt in the roster. Layering a
 * power-finisher on top of that reach would make the spear strictly
 * dominate the bat; instead the holder keeps their fighter's own smash
 * as the kill option and the spear stays a spacing tool. Mechanically
 * this also demonstrates that {@link ItemDefinition.slotOverrides} is a
 * genuine subset declaration — the dispatcher routes only the declared
 * slots and the fighter's native smash keeps firing untouched.
 *
 * Tip sweet-spot: the outermost 20 px of the thrust hitbox is the
 * spear-tip — landing it grants bonus damage / knockback (the Marth
 * tipper idiom; see `attacks.ts` {@link AttackMove.sweetSpot}).
 *
 * Open-closed extensibility: this file is the entire spear
 * contribution. The framework reads `SPEAR_DEFINITION` off the
 * {@link ItemEntity}; no other module mentions `'spear'` by name.
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
 * Authored thrust move for the spear. Registered on the holder at
 * pickup time (see `Inventory.pickup`), and fired by the slot override
 * below via `attemptAttack`. Base damage sits below the bat's swing —
 * the spear's value is reach, not raw power: the hitbox extends
 * further from the fighter's centre than any native move, and only the
 * tip sweet-spot (outermost 20 px) lands with real authority.
 */
export const SPEAR_THRUST_MOVE: AttackMove = Object.freeze({
  id: 'item.spear.thrust',
  type: 'jab',
  damage: 9,
  knockback: { x: 2.2, y: -0.5, scaling: 0.16 },
  hitbox: {
    offsetX: 52,
    offsetY: -4,
    width: 72,
    height: 18,
  },
  startupFrames: 6,
  activeFrames: 3,
  recoveryFrames: 8,
  cooldownFrames: 5,
  animation: {
    startupFrames: 1,
    activeFrames: 1,
    recoveryFrames: 2,
  },
  // Tipper — the outermost slice of the 72 px thrust. Authored in the
  // same fighter-centre coordinate system as `hitbox`; the runtime
  // ANDs the two regions (`pointInSweetSpot && pointInHitbox`, see
  // attacks.ts) so only contact at the very tip rewards the spacing
  // with +25 % damage and +20 % knockback on top of the sweet-spot
  // hitlag bonus.
  sweetSpot: {
    hitbox: {
      offsetX: 80,
      offsetY: -4,
      width: 20,
      height: 18,
    },
    damageMultiplier: 1.25,
    knockbackMultiplier: 1.2,
  },
});

const SPEAR_THROW_BEHAVIOR: ThrowBehavior = Object.freeze({
  // A spear flies well — it is literally a javelin. Forward throw
  // out-ranges the bat's; the flat trajectory reads as a true hurl.
  forward: { velocityX: 18, velocityY: -1 },
  back: { velocityX: -13, velocityY: -1 },
  up: { velocityX: 0, velocityY: -18 },
  down: { velocityX: 0, velocityY: 12 },
  drop: { velocityX: 0, velocityY: 0 },
  consumeOnImpact: false,
});

/**
 * Spear per-slot fire callback. Same callback for jab / tilt — the
 * spear doesn't differentiate the thrust per slot today; a future
 * polish pass could give the tilt a slight upward angle. Returns
 * `true` to consume the press; on the last successful thrust it also
 * marks the item broken in-place.
 *
 * The callback is intentionally minimal — a Phaser integration layer
 * spawns the actual thrust hitbox by reading the holder's facing
 * + position. The deterministic data layer just tracks durability.
 */
function buildSpearSlotOverride(
  _slot: AttackMovesetSlotName,
  ctx: SlotOverrideContext,
): () => boolean {
  const item = ctx.itemEntity as ItemEntity;
  const holder = ctx.holder as Character;
  return () => {
    if (item.getDurability() <= 0) return false;
    if (item.isBroken() || item.isDespawned()) return false;
    // Fire the actual thrust move — registered on the holder when the
    // spear was picked up. `attemptAttack` runs the canonical
    // startup/active/recovery cycle, spawns a real hitbox during the
    // active window, and routes damage through the standard combat
    // pipeline. Without this, the override would silently consume
    // the input press without any visible thrust.
    const fired = holder.attemptAttack(SPEAR_THRUST_MOVE.id);
    if (!fired) return false;
    item.consumeDurability();
    if (item.getDurability() <= 0) {
      // Last-use-broken transition. Drop the spear at the holder's
      // current position; the inventory layer detaches the slot
      // override on the same path the natural drop would.
      const pos = holder.getPosition();
      item.markBroken(ctx.frame, { x: pos.x, y: pos.y });
    }
    return true;
  };
}

export const SPEAR_DEFINITION: ItemDefinition = Object.freeze({
  type: 'spear',
  category: 'melee-weapon',
  // 7 pokes before break — more uses than the bat (5) because each
  // poke is weaker; the spear trades per-hit power for reach + budget.
  maxDurability: 7,
  // Unpicked grounded spear sticks around for ~10 seconds (600 frames
  // @ 60 fps fixed-step) — the standard melee-weapon TTL (same as the
  // bat): long enough for a fighter to walk over from mid-stage but
  // short enough that ignored items reclaim cleanly.
  ttlFrames: 600,
  // Broken-debris stays for ~30 frames (~half a second) so the
  // breakage reads visually before the entity reclaims.
  brokenDespawnFrames: 30,
  // jab + tilt only — NO smash override, by design (see module JSDoc):
  // the spear is a spacing tool, not a finisher; the holder's native
  // smash stays available as their kill option while holding it.
  slotOverrides: Object.freeze(['jab', 'tilt'] as AttackMovesetSlotName[]),
  buildSlotOverride: buildSpearSlotOverride,
  throwBehavior: SPEAR_THROW_BEHAVIOR,
  attackMoves: Object.freeze([SPEAR_THRUST_MOVE]),
});
