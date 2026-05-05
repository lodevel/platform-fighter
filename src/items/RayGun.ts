/**
 * Reference item — Ray Gun (T3 items framework, AC 14).
 *
 * Ranged weapon. Overrides only the `neutralSpecial` slot while held
 * — pressing the special button (G) with no directional input fires
 * one shot. Breaks after 6 shots.
 *
 * Open-closed extensibility: this file is the entire ray-gun
 * contribution. The framework reads `RAY_GUN_DEFINITION` off the
 * {@link ItemEntity}; no other module mentions `'rayGun'` by name.
 */

import type { Character } from '../characters/Character';
import type { ProjectileSpecialMove } from '../characters/specialSchema';
import type {
  ItemDefinition,
  SlotOverrideContext,
  ThrowBehavior,
} from './ItemDefinition';
import type { ItemEntity } from './ItemEntity';
import type { AttackMovesetSlotName } from '../characters/movesetContract';

/**
 * Authored shot move for the ray gun. A real `ProjectileSpecialMove`
 * so the MatchScene's projectile runtime (which spawns a Phaser-side
 * projectile entity on the active frame of any `'projectile'` kind
 * special) picks it up and fires a beam without per-item plumbing.
 * Registered on the holder at pickup time.
 */
export const RAY_GUN_SHOT_MOVE: ProjectileSpecialMove = Object.freeze({
  id: 'item.rayGun.shot',
  type: 'special',
  specialKind: 'projectile',
  damage: 10,
  knockback: { x: 1.6, y: -0.5, scaling: 0.10 },
  hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
  startupFrames: 4,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 8,
  animation: {
    startupFrames: 1,
    activeFrames: 1,
    recoveryFrames: 2,
  },
  projectile: {
    speed: 22,            // ≈ 1320 px/s — fast laser feel
    lifetimeFrames: 60,   // ~1320 px range
    width: 32,
    height: 10,
    spawnOffsetX: 50,
    spawnOffsetY: -10,
  },
  // The gun does the visible work — the holder's punch pose would
  // read as "I just punched air, AND a laser came out." Stay in
  // idle while the projectile flies.
  suppressFighterPose: true,
});

const RAY_GUN_THROW_BEHAVIOR: ThrowBehavior = Object.freeze({
  forward: { velocityX: 12, velocityY: -2 },
  back: { velocityX: -9, velocityY: -2 },
  up: { velocityX: 0, velocityY: -14 },
  down: { velocityX: 0, velocityY: 11 },
  drop: { velocityX: 0, velocityY: 0 },
  consumeOnImpact: false,
});

function buildRayGunSlotOverride(
  _slot: AttackMovesetSlotName,
  ctx: SlotOverrideContext,
): () => boolean {
  const item = ctx.itemEntity as ItemEntity;
  const holder = ctx.holder as Character;
  return () => {
    if (item.getDurability() <= 0) return false;
    if (item.isBroken() || item.isDespawned()) return false;
    // Fire the projectile move via the canonical attack path. The
    // MatchScene's projectile runtime detects the `'projectile'`
    // specialKind on the active frame and spawns a beam.
    const fired = holder.attemptAttack(RAY_GUN_SHOT_MOVE.id);
    if (!fired) return false;
    item.consumeDurability();
    if (item.getDurability() <= 0) {
      // Out of ammo → break in-place. The shot already left the
      // barrel because durability ticked AFTER the spawn.
      const pos = holder.getPosition();
      item.markBroken(ctx.frame, { x: pos.x, y: pos.y });
    }
    return true;
  };
}

export const RAY_GUN_DEFINITION: ItemDefinition = Object.freeze({
  type: 'rayGun',
  category: 'ranged-weapon',
  // 6 shots before break.
  maxDurability: 6,
  // Ranged weapons reclaim slightly faster than melee — they're
  // potent enough that a long TTL would dominate item economy.
  ttlFrames: 480,
  brokenDespawnFrames: 30,
  // Per the seed's "while holding, jab re-routes to the item's slot
  // override" contract. RayGun hijacks jab (the basic attack) so the
  // held-item button is consistent across the roster — players don't
  // have to remember "bat = jab, gun = special".
  slotOverrides: Object.freeze(['jab'] as AttackMovesetSlotName[]),
  buildSlotOverride: buildRayGunSlotOverride,
  throwBehavior: RAY_GUN_THROW_BEHAVIOR,
  attackMoves: Object.freeze([RAY_GUN_SHOT_MOVE]),
});
