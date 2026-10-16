/**
 * Test fixture: a charged-reference-projectile neutral special. Link's shipped bow is an
 * article without a charge ramp, so the serializer's charged-projectile guards are exercised
 * on his projectile special with a synthetic, otherwise valid `chargedProjectile` record.
 */
import { LINK_NEUTRAL_SPECIAL } from './Link';

export const CHARGED_BOW_NEUTRAL_SPECIAL = {
  ...LINK_NEUTRAL_SPECIAL,
  chargedProjectile: {
    charge: {
      minChargeFrames: 0,
      maxChargeFrames: 30,
      minDamage: LINK_NEUTRAL_SPECIAL.damage,
      maxDamage: LINK_NEUTRAL_SPECIAL.damage * 2,
      // Damage-only charge keeps the endpoints legacy (no reference) and inactive.
      minKnockback: { x: 2, y: -0.6, scaling: 0.1 },
      maxKnockback: { x: 4, y: -1, scaling: 0.2 },
      knockbackMode: 'damage-only' as const,
    },
    maxSpeed: 20,
    maxWidth: 27,
    maxHeight: 27,
  },
};
