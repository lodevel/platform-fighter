import { describe, it, expect } from 'vitest';
import {
  validateNeutralSpecialMove,
  isNeutralSpecialMove,
  isProjectileSpecial,
  isChargeSpecial,
  isCommandGrabSpecial,
  isCounterSpecial,
  computeChargeT,
  computeChargedDamage,
  computeChargedKnockback,
  isInCounterWindow,
  computeCounterDamage,
  type NeutralSpecialMove,
  type ProjectileSpecialMove,
  type ChargeSpecialMove,
  type CommandGrabSpecialMove,
  type CounterSpecialMove,
} from './specialSchema';
import {
  WOLF_NEUTRAL_SPECIAL,
  CAT_NEUTRAL_SPECIAL,
  OWL_NEUTRAL_SPECIAL,
  BEAR_NEUTRAL_SPECIAL,
} from './index';
import {
  WOLF_JAB,
  CAT_JAB,
  OWL_JAB,
  BEAR_JAB,
  WOLF_NAIR,
} from './index';
import { CHARACTER_ROSTER, findMoveByType } from './roster';

/**
 * AC 60201 Sub-AC 1 — neutral-special schema + per-character special
 * data records.
 *
 * The schema module is pure (no Phaser, no Matter, no Math.random,
 * no wall-clock). This suite locks down:
 *
 *   1. Type guards correctly classify the four kinds.
 *   2. Schema validators reject malformed records and accept all four
 *      authored records.
 *   3. Charge interpolation is monotonic and clamped.
 *   4. Counter window predicate respects the half-open boundaries.
 *   5. Counter damage clamp respects min / max bounds.
 *   6. Per-character data — each authored special passes the schema
 *      AND the Seed roster invariants (every character has exactly
 *      one neutral special, kinds are pairwise distinct, ids are
 *      unique).
 *   7. Roster integration — `CHARACTER_ROSTER[id].moves` exposes the
 *      special and `findMoveByType(spec, 'special')` returns it.
 */

/**
 * Synthetic charge-kind fixture for tests that exercise the
 * `ChargeSpecialMove` schema or the charge-interpolation helpers
 * (computeChargeT / computeChargedDamage / computeChargedKnockback).
 *
 * Owl previously authored a charge variant; after pivoting Owl to
 * `'projectile'` the roster no longer ships a charge example, so
 * this fixture stands in. Authored to validate cleanly so it serves
 * as the baseline for every "tweak this field to break it"
 * mutation test below.
 */
const CHARGE_TEST_FIXTURE: ChargeSpecialMove = Object.freeze({
  id: 'fixture.charge_special',
  type: 'special',
  specialKind: 'charge',
  damage: 6,
  knockback: { x: 1.5, y: -0.6, scaling: 0.10 },
  hitbox: { offsetX: 40, offsetY: -5, width: 50, height: 30 },
  startupFrames: 4,
  activeFrames: 12,
  recoveryFrames: 18,
  cooldownFrames: 16,
  animation: { startupFrames: 1, activeFrames: 4, recoveryFrames: 3 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 6,
    maxDamage: 18,
    minKnockback: { x: 1.5, y: -0.6, scaling: 0.10 },
    maxKnockback: { x: 3.8, y: -1.5, scaling: 0.40 },
  },
});

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe('type guards', () => {
  it('isNeutralSpecialMove rejects non-special moves', () => {
    expect(isNeutralSpecialMove(WOLF_JAB)).toBe(false);
    expect(isNeutralSpecialMove(WOLF_NAIR)).toBe(false);
  });

  it('isNeutralSpecialMove accepts every authored special', () => {
    expect(isNeutralSpecialMove(WOLF_NEUTRAL_SPECIAL)).toBe(true);
    expect(isNeutralSpecialMove(CAT_NEUTRAL_SPECIAL)).toBe(true);
    expect(isNeutralSpecialMove(OWL_NEUTRAL_SPECIAL)).toBe(true);
    expect(isNeutralSpecialMove(BEAR_NEUTRAL_SPECIAL)).toBe(true);
  });

  it('per-kind type guards classify correctly and exclusively', () => {
    // Wolf = counter
    expect(isCounterSpecial(WOLF_NEUTRAL_SPECIAL)).toBe(true);
    expect(isProjectileSpecial(WOLF_NEUTRAL_SPECIAL)).toBe(false);
    expect(isChargeSpecial(WOLF_NEUTRAL_SPECIAL)).toBe(false);
    expect(isCommandGrabSpecial(WOLF_NEUTRAL_SPECIAL)).toBe(false);

    // Cat = charge (close-range ninja strike — was projectile,
    // pivoted to keep Owl as the sole zoner).
    expect(isChargeSpecial(CAT_NEUTRAL_SPECIAL)).toBe(true);
    expect(isProjectileSpecial(CAT_NEUTRAL_SPECIAL)).toBe(false);
    expect(isCounterSpecial(CAT_NEUTRAL_SPECIAL)).toBe(false);

    // Owl = projectile (mage / zoner — feather-bolt).
    expect(isProjectileSpecial(OWL_NEUTRAL_SPECIAL)).toBe(true);
    expect(isChargeSpecial(OWL_NEUTRAL_SPECIAL)).toBe(false);
    expect(isCounterSpecial(OWL_NEUTRAL_SPECIAL)).toBe(false);

    // Bear = command grab
    expect(isCommandGrabSpecial(BEAR_NEUTRAL_SPECIAL)).toBe(true);
    expect(isCounterSpecial(BEAR_NEUTRAL_SPECIAL)).toBe(false);
  });

  it('isNeutralSpecialMove rejects a move tagged "special" without a specialKind', () => {
    const malformed = {
      ...WOLF_NEUTRAL_SPECIAL,
      specialKind: undefined,
    } as unknown as NeutralSpecialMove;
    expect(isNeutralSpecialMove(malformed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateNeutralSpecialMove — happy path & rejection cases
// ---------------------------------------------------------------------------

describe('validateNeutralSpecialMove', () => {
  it('accepts every authored neutral-special record', () => {
    expect(validateNeutralSpecialMove(WOLF_NEUTRAL_SPECIAL)).toBe(WOLF_NEUTRAL_SPECIAL);
    expect(validateNeutralSpecialMove(CAT_NEUTRAL_SPECIAL)).toBe(CAT_NEUTRAL_SPECIAL);
    expect(validateNeutralSpecialMove(OWL_NEUTRAL_SPECIAL)).toBe(OWL_NEUTRAL_SPECIAL);
    expect(validateNeutralSpecialMove(BEAR_NEUTRAL_SPECIAL)).toBe(BEAR_NEUTRAL_SPECIAL);
  });

  it('rejects a record whose type is not "special"', () => {
    const bad = { ...WOLF_NEUTRAL_SPECIAL, type: 'jab' } as unknown as NeutralSpecialMove;
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/type/);
  });

  it('projectile: rejects zero-speed projectile', () => {
    const bad: ProjectileSpecialMove = {
      ...OWL_NEUTRAL_SPECIAL,
      projectile: { ...OWL_NEUTRAL_SPECIAL.projectile, speed: 0 },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/speed/);
  });

  it('projectile: rejects non-positive lifetime', () => {
    const bad: ProjectileSpecialMove = {
      ...OWL_NEUTRAL_SPECIAL,
      projectile: { ...OWL_NEUTRAL_SPECIAL.projectile, lifetimeFrames: 0 },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/lifetimeFrames/);
  });

  it('projectile: rejects non-positive dimensions', () => {
    const bad: ProjectileSpecialMove = {
      ...OWL_NEUTRAL_SPECIAL,
      projectile: { ...OWL_NEUTRAL_SPECIAL.projectile, width: 0 },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/dimensions/);
  });

  it('charge: rejects maxChargeFrames <= minChargeFrames', () => {
    const bad: ChargeSpecialMove = {
      ...CHARGE_TEST_FIXTURE,
      charge: {
        ...CHARGE_TEST_FIXTURE.charge,
        minChargeFrames: 30,
        maxChargeFrames: 30,
      },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/maxChargeFrames/);
  });

  it('charge: rejects maxDamage < minDamage', () => {
    const bad: ChargeSpecialMove = {
      ...CHARGE_TEST_FIXTURE,
      charge: {
        ...CHARGE_TEST_FIXTURE.charge,
        minDamage: 20,
        maxDamage: 5,
      },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/damage/);
  });

  it('commandGrab: rejects negative grabHoldFrames', () => {
    const bad: CommandGrabSpecialMove = {
      ...BEAR_NEUTRAL_SPECIAL,
      grab: { ...BEAR_NEUTRAL_SPECIAL.grab, grabHoldFrames: -1 },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/grabHoldFrames/);
  });

  it('commandGrab: rejects negative throwDamage', () => {
    const bad: CommandGrabSpecialMove = {
      ...BEAR_NEUTRAL_SPECIAL,
      grab: { ...BEAR_NEUTRAL_SPECIAL.grab, throwDamage: -1 },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/throwDamage/);
  });

  it('counter: rejects window where end <= start', () => {
    const bad: CounterSpecialMove = {
      ...WOLF_NEUTRAL_SPECIAL,
      counter: {
        ...WOLF_NEUTRAL_SPECIAL.counter,
        counterWindowStart: 5,
        counterWindowEnd: 5,
      },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/window/);
  });

  it('counter: rejects window past busyTotal', () => {
    const bad: CounterSpecialMove = {
      ...WOLF_NEUTRAL_SPECIAL,
      counter: {
        ...WOLF_NEUTRAL_SPECIAL.counter,
        counterWindowStart: 0,
        counterWindowEnd: 999,
      },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/busyTotal/);
  });

  it('counter: rejects non-positive damageMultiplier', () => {
    const bad: CounterSpecialMove = {
      ...WOLF_NEUTRAL_SPECIAL,
      counter: { ...WOLF_NEUTRAL_SPECIAL.counter, damageMultiplier: 0 },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/damageMultiplier/);
  });

  it('counter: rejects max < min counter damage clamp', () => {
    const bad: CounterSpecialMove = {
      ...WOLF_NEUTRAL_SPECIAL,
      counter: {
        ...WOLF_NEUTRAL_SPECIAL.counter,
        minCounterDamage: 30,
        maxCounterDamage: 10,
      },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/clamp/);
  });
});

// ---------------------------------------------------------------------------
// Charge interpolation helpers
// ---------------------------------------------------------------------------

describe('charge interpolation', () => {
  // Synthetic charge fixture — Owl pivoted to projectile, but the
  // charge-helper math is still part of the public schema and is
  // exercised here against an authored fixture so adding a future
  // charge-kind character (or restoring Owl's charge variant)
  // doesn't drop the test coverage.
  const charge = CHARGE_TEST_FIXTURE;

  it('computeChargeT clamps at 0 below minChargeFrames', () => {
    expect(computeChargeT(charge.charge, -5)).toBe(0);
    expect(computeChargeT(charge.charge, 0)).toBe(0);
  });

  it('computeChargeT clamps at 1 at or above maxChargeFrames', () => {
    expect(computeChargeT(charge.charge, charge.charge.maxChargeFrames)).toBe(1);
    expect(computeChargeT(charge.charge, charge.charge.maxChargeFrames + 100)).toBe(1);
  });

  it('computeChargeT linearly interpolates between min and max', () => {
    const mid = (charge.charge.minChargeFrames + charge.charge.maxChargeFrames) / 2;
    expect(computeChargeT(charge.charge, mid)).toBeCloseTo(0.5, 5);
  });

  it('computeChargedDamage returns minDamage at 0 charge', () => {
    expect(computeChargedDamage(charge, 0)).toBe(charge.charge.minDamage);
  });

  it('computeChargedDamage returns maxDamage at full charge', () => {
    expect(computeChargedDamage(charge, charge.charge.maxChargeFrames)).toBe(charge.charge.maxDamage);
  });

  it('computeChargedDamage is monotonic non-decreasing', () => {
    let prev = -Infinity;
    for (let f = 0; f <= charge.charge.maxChargeFrames + 5; f += 5) {
      const dmg = computeChargedDamage(charge, f);
      expect(dmg).toBeGreaterThanOrEqual(prev);
      prev = dmg;
    }
  });

  it('computeChargedKnockback returns minKnockback at 0 charge', () => {
    const kb = computeChargedKnockback(charge, 0);
    expect(kb.x).toBeCloseTo(charge.charge.minKnockback.x, 5);
    expect(kb.y).toBeCloseTo(charge.charge.minKnockback.y, 5);
    expect(kb.scaling).toBeCloseTo(charge.charge.minKnockback.scaling, 5);
  });

  it('computeChargedKnockback returns maxKnockback at full charge', () => {
    const kb = computeChargedKnockback(charge, charge.charge.maxChargeFrames);
    expect(kb.x).toBeCloseTo(charge.charge.maxKnockback.x, 5);
    expect(kb.y).toBeCloseTo(charge.charge.maxKnockback.y, 5);
    expect(kb.scaling).toBeCloseTo(charge.charge.maxKnockback.scaling, 5);
  });
});

// ---------------------------------------------------------------------------
// Counter window predicate / damage clamp
// ---------------------------------------------------------------------------

describe('counter helpers', () => {
  const wolf = WOLF_NEUTRAL_SPECIAL;

  it('isInCounterWindow respects half-open boundaries', () => {
    const start = wolf.counter.counterWindowStart;
    const end = wolf.counter.counterWindowEnd;
    expect(isInCounterWindow(wolf, start - 1)).toBe(false);
    expect(isInCounterWindow(wolf, start)).toBe(true);
    expect(isInCounterWindow(wolf, end - 1)).toBe(true);
    expect(isInCounterWindow(wolf, end)).toBe(false);
  });

  it('computeCounterDamage applies the multiplier', () => {
    // 10% absorbed * 1.3 = 13 (within clamp)
    expect(computeCounterDamage(wolf, 10)).toBeCloseTo(13, 5);
  });

  it('computeCounterDamage clamps at the minimum', () => {
    // 1% absorbed * 1.3 = 1.3 — below minCounterDamage (8)
    expect(computeCounterDamage(wolf, 1)).toBe(wolf.counter.minCounterDamage);
  });

  it('computeCounterDamage clamps at the maximum', () => {
    // 50% absorbed * 1.3 = 65 — above maxCounterDamage (22)
    expect(computeCounterDamage(wolf, 50)).toBe(wolf.counter.maxCounterDamage);
  });
});

// ---------------------------------------------------------------------------
// Per-character data — Seed-mandated roster invariants
// ---------------------------------------------------------------------------

describe('per-character neutral specials', () => {
  it('every character has exactly one neutral special', () => {
    for (const id of ['wolf', 'cat', 'owl', 'bear'] as const) {
      const spec = CHARACTER_ROSTER[id];
      const specials = spec.moves.filter((m) => m.type === 'special');
      expect(specials.length).toBe(1);
    }
  });

  it('the four characters use four distinct kinds (Seed: unique mechanics)', () => {
    // Wolf=counter, Cat=charge (close-range ninja strike),
    // Owl=projectile (mage zoner), Bear=commandGrab. One kind each.
    const kinds = new Set([
      WOLF_NEUTRAL_SPECIAL.specialKind,
      CAT_NEUTRAL_SPECIAL.specialKind,
      OWL_NEUTRAL_SPECIAL.specialKind,
      BEAR_NEUTRAL_SPECIAL.specialKind,
    ]);
    expect(kinds.size).toBe(4);
    expect(kinds.has('counter')).toBe(true);
    expect(kinds.has('charge')).toBe(true);
    expect(kinds.has('projectile')).toBe(true);
    expect(kinds.has('commandGrab')).toBe(true);
  });

  it('every special id is unique within its character moveset', () => {
    for (const id of ['wolf', 'cat', 'owl', 'bear'] as const) {
      const spec = CHARACTER_ROSTER[id];
      const ids = spec.moves.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('every special id matches its owning character prefix', () => {
    expect(WOLF_NEUTRAL_SPECIAL.id).toMatch(/^wolf\./);
    expect(CAT_NEUTRAL_SPECIAL.id).toMatch(/^cat\./);
    expect(OWL_NEUTRAL_SPECIAL.id).toMatch(/^owl\./);
    expect(BEAR_NEUTRAL_SPECIAL.id).toMatch(/^bear\./);
  });

  it('findMoveByType("special") returns the neutral special for each character', () => {
    expect(findMoveByType(CHARACTER_ROSTER.wolf, 'special')).toBe(WOLF_NEUTRAL_SPECIAL);
    expect(findMoveByType(CHARACTER_ROSTER.cat, 'special')).toBe(CAT_NEUTRAL_SPECIAL);
    expect(findMoveByType(CHARACTER_ROSTER.owl, 'special')).toBe(OWL_NEUTRAL_SPECIAL);
    expect(findMoveByType(CHARACTER_ROSTER.bear, 'special')).toBe(BEAR_NEUTRAL_SPECIAL);
  });

  it('every special declares an animation block (renderer integration)', () => {
    for (const sp of [WOLF_NEUTRAL_SPECIAL, CAT_NEUTRAL_SPECIAL, OWL_NEUTRAL_SPECIAL, BEAR_NEUTRAL_SPECIAL]) {
      expect(sp.animation).toBeDefined();
      const a = sp.animation!;
      expect(a.startupFrames).toBeGreaterThan(0);
      expect(a.activeFrames).toBeGreaterThan(0);
      expect(a.recoveryFrames).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('charge interpolation is deterministic', () => {
    const a = computeChargedDamage(CHARGE_TEST_FIXTURE, 30);
    const b = computeChargedDamage(CHARGE_TEST_FIXTURE, 30);
    expect(a).toBe(b);
  });

  it('counter damage clamp is deterministic', () => {
    const a = computeCounterDamage(WOLF_NEUTRAL_SPECIAL, 12);
    const b = computeCounterDamage(WOLF_NEUTRAL_SPECIAL, 12);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// AttackMove compatibility
// ---------------------------------------------------------------------------

describe('AttackMove compatibility (structural subtype)', () => {
  it('every NeutralSpecialMove has the AttackMove fields', () => {
    for (const sp of [WOLF_NEUTRAL_SPECIAL, CAT_NEUTRAL_SPECIAL, OWL_NEUTRAL_SPECIAL, BEAR_NEUTRAL_SPECIAL]) {
      expect(typeof sp.id).toBe('string');
      expect(sp.type).toBe('special');
      expect(typeof sp.damage).toBe('number');
      expect(typeof sp.knockback.x).toBe('number');
      expect(typeof sp.knockback.y).toBe('number');
      expect(typeof sp.knockback.scaling).toBe('number');
      expect(typeof sp.hitbox.offsetX).toBe('number');
      expect(typeof sp.hitbox.offsetY).toBe('number');
      expect(typeof sp.hitbox.width).toBe('number');
      expect(typeof sp.hitbox.height).toBe('number');
      expect(Number.isInteger(sp.startupFrames)).toBe(true);
      expect(Number.isInteger(sp.activeFrames)).toBe(true);
      expect(Number.isInteger(sp.recoveryFrames)).toBe(true);
      expect(Number.isInteger(sp.cooldownFrames)).toBe(true);
    }
  });

  it('grounded triplets are unaffected by the special slot wiring', () => {
    // Sanity: jab still resolves to type='jab'; the new special slot
    // should not have leaked through and reclassified anything.
    expect(WOLF_JAB.type).toBe('jab');
    expect(CAT_JAB.type).toBe('jab');
    expect(OWL_JAB.type).toBe('jab');
    expect(BEAR_JAB.type).toBe('jab');
  });
});
