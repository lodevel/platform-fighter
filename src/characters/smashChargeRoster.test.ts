import { describe, it, expect } from 'vitest';

import { WOLF_SMASH, WOLF_USMASH, WOLF_DSMASH } from './Wolf';
import { CAT_SMASH, CAT_USMASH, CAT_DSMASH } from './Cat';
import { OWL_SMASH, OWL_USMASH, OWL_DSMASH } from './Owl';
import { BEAR_SMASH, BEAR_USMASH, BEAR_DSMASH } from './Bear';
import { BLAZE_SMASH, BLAZE_USMASH, BLAZE_DSMASH } from './Blaze';
import { PUFF_SMASH, PUFF_USMASH, PUFF_DSMASH } from './Puff';
import { AEGIS_SMASH, AEGIS_USMASH, AEGIS_DSMASH } from './Aegis';
import { VOLT_SMASH, VOLT_USMASH, VOLT_DSMASH } from './Volt';
import { NOVA_SMASH, NOVA_USMASH, NOVA_DSMASH } from './Nova';
import { BRUNO_SMASH, BRUNO_USMASH, BRUNO_DSMASH } from './Bruno';
import type { AttackMoveWithAnimation } from './moveSchema';
import { computeChargedDamageFromSpec, computeChargedKnockbackFromSpec } from './chargeSchema';

// Every forward / up / down smash across the roster (Tier 4: all chargeable).
const ALL_SMASHES: AttackMoveWithAnimation[] = [
  WOLF_SMASH, WOLF_USMASH, WOLF_DSMASH,
  CAT_SMASH, CAT_USMASH, CAT_DSMASH,
  OWL_SMASH, OWL_USMASH, OWL_DSMASH,
  BEAR_SMASH, BEAR_USMASH, BEAR_DSMASH,
  BLAZE_SMASH, BLAZE_USMASH, BLAZE_DSMASH,
  PUFF_SMASH, PUFF_USMASH, PUFF_DSMASH,
  AEGIS_SMASH, AEGIS_USMASH, AEGIS_DSMASH,
  VOLT_SMASH, VOLT_USMASH, VOLT_DSMASH,
  NOVA_SMASH, NOVA_USMASH, NOVA_DSMASH,
  BRUNO_SMASH, BRUNO_USMASH, BRUNO_DSMASH,
];

describe('Tier 4 — roster smash charge ramps', () => {
  it('covers all 30 smashes (10 fighters × fwd/up/down)', () => {
    expect(ALL_SMASHES).toHaveLength(30);
  });

  it.each(ALL_SMASHES.map((m) => [m.id, m] as const))(
    '%s carries a charge ramp',
    (_id, move) => {
      expect(move.charge).toBeDefined();
    },
  );

  // The headline invariant: a TAPPED (uncharged) smash must fire the
  // AUTHORED move unchanged — so `minDamage`/`minKnockback` must equal the
  // move's base. (This is exactly what the parallel authoring pass got
  // wrong on the first try — minKnockback dropped baseMagnitude — so it is
  // locked here.)
  it.each(ALL_SMASHES.map((m) => [m.id, m] as const))(
    '%s: a tap equals the authored move (charge.min == base)',
    (_id, move) => {
      const c = move.charge!;
      expect(c.minDamage).toBe(move.damage);
      expect(c.minKnockback).toEqual(move.knockback);
      // The charge lerp at 0 held-frames reproduces the base exactly.
      expect(computeChargedDamageFromSpec(c, 0)).toBe(move.damage);
      expect(computeChargedKnockbackFromSpec(c, 0)).toEqual(move.knockback);
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
