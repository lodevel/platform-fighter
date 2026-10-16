/**
 * Published Ultimate ordinary-block push speeds, converted to project pixels.
 * Source: https://www.ssbwiki.com/Shield#Shield_pushback (captured 2026-10-08).
 * Defender: min(1.3, (unrounded shieldstun + 1) * .09).
 * Attacker: damage * .04 + .025, except remote projectiles have no recoil.
 * Traction decays these speeds; attacker traction is multiplied by 1.1.
 *
 * This explicitly selects the current Wiki defender equation. The retained
 * rubendal calculator 233590e9 omits +1. Native rate/cap-order parity has not
 * been measured. A move's setoff factor scales the capped defender baseline;
 * this ordering is an explicit beta adapter, not a shieldstun multiplier.
 * Parry, shield break and edge restraint belong to the contact consumer.
 */
import type { ShieldAttackKind } from './combat';

export interface ShieldPushbackInput {
  readonly damage: number;
  readonly kind?: ShieldAttackKind;
  readonly setoffMultiplier?: number;
  readonly pixelsPerUnit?: number;
}

export function computeShieldPushback(input: ShieldPushbackInput): {
  readonly defenderSpeed: number;
  readonly attackerSpeed: number;
} {
  const { damage, kind = 'normal', setoffMultiplier = 1, pixelsPerUnit = 5 } = input;
  for (const value of [damage, setoffMultiplier, pixelsPerUnit]) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('Shield push parameters must be finite and nonnegative');
  }
  if (damage === 0) return { defenderSpeed: 0, attackerSpeed: 0 };
  const kindMultiplier = kind === 'smash' ? .725 : kind === 'aerial' ? .33 : kind === 'projectile' ? .29 : 1;
  const unroundedStun = damage * .8 * kindMultiplier + 2;
  return {
    defenderSpeed: Math.min(1.3, (unroundedStun + 1) * .09) * setoffMultiplier * pixelsPerUnit,
    attackerSpeed: kind === 'projectile' ? 0 : (damage * .04 + .025) * pixelsPerUnit,
  };
}

/** Signed project velocity. Frozen steps neither decay nor reverse it. */
export function decayShieldPushback(speed: number, traction: number, attacker = false, frozen = false): number {
  if (!Number.isFinite(speed) || !Number.isFinite(traction) || traction < 0) {
    throw new RangeError('Shield push speed must be finite; traction must be finite and nonnegative');
  }
  if (frozen) return speed;
  const remaining = Math.max(0, Math.abs(speed) - traction * (attacker ? 1.1 : 1));
  return remaining === 0 ? 0 : Math.sign(speed) * remaining;
}
