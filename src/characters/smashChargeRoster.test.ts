import { describe, it, expect } from 'vitest';

import { DONKEYKONG_SMASH, DONKEYKONG_USMASH, DONKEYKONG_DSMASH } from './DonkeyKong';
import { PIKACHU_SMASH, PIKACHU_USMASH, PIKACHU_DSMASH } from './Pikachu';
import { LINK_SMASH, LINK_USMASH, LINK_DSMASH } from './linkFreshKit';
import type { AttackMoveWithAnimation } from './moveSchema';
import { computeChargedDamageFromSpec, computeChargedKnockbackFromSpec } from './chargeSchema';

// Every forward / up / down smash across the roster (all chargeable).
const ALL_SMASHES: AttackMoveWithAnimation[] = [
  DONKEYKONG_SMASH, DONKEYKONG_USMASH, DONKEYKONG_DSMASH,
  PIKACHU_SMASH, PIKACHU_USMASH, PIKACHU_DSMASH,
  LINK_SMASH, LINK_USMASH, LINK_DSMASH,
];

describe('roster smash charge ramps', () => {
  it('covers all 9 smashes (3 fighters × fwd/up/down)', () => {
    expect(ALL_SMASHES).toHaveLength(9);
  });

  it.each(ALL_SMASHES.map((m) => [m.id, m] as const))(
    '%s carries a charge ramp',
    (_id, move) => {
      expect(move.charge).toBeDefined();
    },
  );

  // The headline invariant: a TAPPED (uncharged) smash must fire the
  // AUTHORED move unchanged. Roster smashes use Ultimate's damage-only
  // charge (holding scales damage; the launch comes from the move's own
  // reference knockback), so `minDamage` must equal the move's base and a
  // 0-frame charge must hand back the authored knockback record itself.
  it.each(ALL_SMASHES.map((m) => [m.id, m] as const))(
    '%s: a tap equals the authored move (damage-only charge, min == base)',
    (_id, move) => {
      const c = move.charge!;
      expect(c.knockbackMode).toBe('damage-only');
      expect(c.minDamage).toBe(move.damage);
      expect(computeChargedDamageFromSpec(c, 0)).toBe(move.damage);
      expect(computeChargedKnockbackFromSpec(c, 0, move.knockback)).toBe(move.knockback);
    },
  );

  // A full charge must be a strict upgrade (more damage + at least as much
  // launch) so charging is always worthwhile.
  it.each(ALL_SMASHES.map((m) => [m.id, m] as const))(
    '%s: a full charge strictly out-damages a tap',
    (_id, move) => {
      const c = move.charge!;
      expect(c.maxChargeFrames).toBeGreaterThan(c.minChargeFrames);
      expect(c.maxDamage).toBeGreaterThan(c.minDamage);
      const full = computeChargedDamageFromSpec(c, c.maxChargeFrames);
      expect(full).toBeGreaterThan(move.damage);
    },
  );
});
