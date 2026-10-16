import type { AttackMove } from './attacks';

/**
 * Test fixture: a neutral aerial as saved before the `AerialMove` record
 * existed — no direction, animation, landing lag or auto-cancel data. No
 * roster fighter ships one any more, but Character Lab saves may still
 * carry this shape, so the serializer suites keep covering it.
 */
export const LEGACY_NAIR: AttackMove = Object.freeze({
  id: 'legacy.nair',
  type: 'aerial',
  damage: 8,
  knockback: { x: 1.6, y: -1, scaling: 0.12 },
  hitbox: { offsetX: 0, offsetY: -1, width: 50, height: 39 },
  startupFrames: 5,
  activeFrames: 6,
  recoveryFrames: 12,
  cooldownFrames: 8,
});
