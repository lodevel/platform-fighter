/**
 * Wolf-pup creature spec — first authored creature for the M6
 * subsystem. A small fast-chasing minion that Wolf can summon to
 * harass an opponent.
 *
 * Design intent (Wolf bruiser archetype synergy):
 *   • Small, fast, low HP — a tactical pressure tool, not a tank.
 *   • Lifecycle: timer (lasts ~10 seconds) OR despawn-on-HP-zero,
 *     whichever fires first. Tied to Wolf via owner-only friendly
 *     fire (per the M6 chosen faction model).
 *   • Single chase-attack — a quick lunge bite. No special.
 *
 * # Sprite gap (per project memory: "Use real sprites, not ugly
 * rectangles"):
 *   • `spriteKey: null` — a real CC0 wolf-pup atlas needs to be
 *     sourced and added under `assets/creatures/wolfPup/` before
 *     this creature ships in a live match. The Kenney pixel-pack
 *     pattern used by Cat / Wolf is the precedent. `playable:
 *     false` blocks live-match use until the asset lands.
 */

import { registerCreature } from './creatureRegistry';
import type { CreatureSpec } from './creatureSchema';

export const WOLF_PUP: CreatureSpec = {
  id: 'wolfPup',
  displayName: 'Wolf Pup',
  // TODO(sprite-gap): replace with real CC0 atlas key once a
  // wolf-pup sprite sheet is added under assets/creatures/wolfPup/
  // and the palette pipeline is wired up.
  spriteKey: null,
  playable: false,
  body: { width: 24, height: 22, chamfer: 4 },
  movement: {
    maxRunSpeed: 9.5, // faster than Wolf — meant to harass
    groundAccel: 0.7,
    airAccel: 0.3,
    groundDamping: 0.8,
    airDamping: 0.96,
    jumpImpulse: 10,
    maxJumps: 1,
    mass: 4, // light — easy to KO if the opponent commits
  },
  maxHp: 24,
  moveset: {
    chaseAttack: {
      id: 'wolfPup.chaseAttack',
      type: 'jab',
      damage: 4,
      knockback: { x: 1.2, y: -0.4, scaling: 0.06 },
      hitbox: { offsetX: 14, offsetY: -2, width: 22, height: 14 },
      startupFrames: 6,
      activeFrames: 3,
      recoveryFrames: 14,
      cooldownFrames: 22,
      animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
    },
  },
  ai: {
    aggroRangePx: 320,
    leashRangePx: 480,
    attackCadenceFrames: 32,
  },
  despawnPolicies: ['timer', 'onHpZero', 'onOwnerKO'],
  lifetimeFrames: 600, // 10 seconds at 60 Hz
};

// Eagerly register on module load so a `getCreatureSpec('wolfPup')`
// lookup always resolves once this module is imported.
registerCreature(WOLF_PUP);
