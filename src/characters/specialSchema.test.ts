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
import { DONKEYKONG_JAB, DONKEYKONG_NAIR, DONKEYKONG_NEUTRAL_SPECIAL } from './DonkeyKong';
import { PIKACHU_JAB, PIKACHU_NEUTRAL_SPECIAL } from './Pikachu';
import { LINK_JAB, LINK_NEUTRAL_SPECIAL } from './linkFreshKit';
import { CHARACTER_ROSTER, findMoveByType } from './roster';

/**
 * AC 60201 Sub-AC 1 — neutral-special schema + per-character special
 * data records.
 *
 * The schema module is pure (no Phaser, no Matter, no Math.random,
 * no wall-clock). This suite locks down:
 *
 *   1. Type guards correctly classify the four kinds.
 *   2. Schema validators reject malformed records and accept every
 *      authored roster record.
 *   3. Charge interpolation is monotonic and clamped.
 *   4. Counter window predicate respects the half-open boundaries.
 *   5. Counter damage clamp respects min / max bounds.
 *   6. Per-character data — each authored special passes the schema
 *      AND the roster invariants (every character has exactly one
 *      neutral special, ids are unique and carry the owner prefix).
 *   7. Roster integration — `CHARACTER_ROSTER[id].moves` exposes the
 *      special and `findMoveByType(spec, 'special')` returns it.
 */

/**
 * Synthetic charge-kind fixture for tests that exercise the
 * `ChargeSpecialMove` schema or the charge-interpolation helpers
 * (computeChargeT / computeChargedDamage / computeChargedKnockback).
 *
 * Authored to validate cleanly so it serves as the baseline for every
 * "tweak this field to break it" mutation test below, independent of
 * Donkey Kong's tuned Giant Punch record.
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

/**
 * Synthetic counter-kind fixture: no roster fighter ships a counter
 * neutral special, but the counter schema / helpers stay public.
 * Busy total = 4 + 20 + 26 = 50 frames; window [6, 20) sits inside it.
 */
const COUNTER_TEST_FIXTURE: CounterSpecialMove = Object.freeze({
  id: 'fixture.counter_special',
  type: 'special',
  specialKind: 'counter',
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
  startupFrames: 4,
  activeFrames: 20,
  recoveryFrames: 26,
  cooldownFrames: 30,
  animation: { startupFrames: 1, activeFrames: 4, recoveryFrames: 3 },
  counter: {
    counterWindowStart: 6,
    counterWindowEnd: 20,
    damageMultiplier: 1.3,
    minCounterDamage: 8,
    maxCounterDamage: 22,
    counterKnockback: { x: 3.2, y: -2.2, scaling: 0.3 },
    counterHitbox: { offsetX: 34, offsetY: -4, width: 56, height: 44 },
  },
});

/** Synthetic command-grab fixture: no roster fighter ships one either. */
const COMMAND_GRAB_TEST_FIXTURE: CommandGrabSpecialMove = Object.freeze({
  id: 'fixture.command_grab_special',
  type: 'special',
  specialKind: 'commandGrab',
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  hitbox: { offsetX: 30, offsetY: 0, width: 40, height: 50 },
  startupFrames: 10,
  activeFrames: 4,
  recoveryFrames: 30,
  cooldownFrames: 30,
  animation: { startupFrames: 2, activeFrames: 3, recoveryFrames: 3 },
  grab: {
    grabHoldFrames: 18,
    throwDamage: 14,
    throwKnockback: { x: 3, y: -2.4, scaling: 0.25 },
    ignoresShield: true,
  },
});

/** Every authored roster neutral special. */
const ROSTER_NEUTRAL_SPECIALS = [
  { id: 'donkeykong', move: DONKEYKONG_NEUTRAL_SPECIAL },
  { id: 'pikachu', move: PIKACHU_NEUTRAL_SPECIAL },
  { id: 'link', move: LINK_NEUTRAL_SPECIAL },
] as const;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe('type guards', () => {
  it('isNeutralSpecialMove rejects non-special moves', () => {
    expect(isNeutralSpecialMove(DONKEYKONG_JAB)).toBe(false);
    expect(isNeutralSpecialMove(DONKEYKONG_NAIR)).toBe(false);
  });

  it('isNeutralSpecialMove accepts every authored special and every kind fixture', () => {
    for (const { move } of ROSTER_NEUTRAL_SPECIALS) {
      expect(isNeutralSpecialMove(move)).toBe(true);
    }
    expect(isNeutralSpecialMove(CHARGE_TEST_FIXTURE)).toBe(true);
    expect(isNeutralSpecialMove(COUNTER_TEST_FIXTURE)).toBe(true);
    expect(isNeutralSpecialMove(COMMAND_GRAB_TEST_FIXTURE)).toBe(true);
  });

  it('per-kind type guards classify correctly and exclusively', () => {
    // Donkey Kong = charge (Giant Punch).
    expect(isChargeSpecial(DONKEYKONG_NEUTRAL_SPECIAL)).toBe(true);
    expect(isProjectileSpecial(DONKEYKONG_NEUTRAL_SPECIAL)).toBe(false);
    expect(isCounterSpecial(DONKEYKONG_NEUTRAL_SPECIAL)).toBe(false);
    expect(isCommandGrabSpecial(DONKEYKONG_NEUTRAL_SPECIAL)).toBe(false);

    // Pikachu and Link = projectile (Thunder Jolt, Bow).
    for (const move of [PIKACHU_NEUTRAL_SPECIAL, LINK_NEUTRAL_SPECIAL]) {
      expect(isProjectileSpecial(move)).toBe(true);
      expect(isChargeSpecial(move)).toBe(false);
      expect(isCounterSpecial(move)).toBe(false);
      expect(isCommandGrabSpecial(move)).toBe(false);
    }

    // Counter fixture
    expect(isCounterSpecial(COUNTER_TEST_FIXTURE)).toBe(true);
    expect(isProjectileSpecial(COUNTER_TEST_FIXTURE)).toBe(false);
    expect(isChargeSpecial(COUNTER_TEST_FIXTURE)).toBe(false);
    expect(isCommandGrabSpecial(COUNTER_TEST_FIXTURE)).toBe(false);

    // Command-grab fixture
    expect(isCommandGrabSpecial(COMMAND_GRAB_TEST_FIXTURE)).toBe(true);
    expect(isCounterSpecial(COMMAND_GRAB_TEST_FIXTURE)).toBe(false);
  });

  it('isNeutralSpecialMove rejects a move tagged "special" without a specialKind', () => {
    const malformed = {
      ...DONKEYKONG_NEUTRAL_SPECIAL,
      specialKind: undefined,
    } as unknown as NeutralSpecialMove;
    expect(isNeutralSpecialMove(malformed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateNeutralSpecialMove — happy path & rejection cases
// ---------------------------------------------------------------------------

describe('validateNeutralSpecialMove', () => {
  it('accepts every authored neutral-special record and every kind fixture', () => {
    for (const { move } of ROSTER_NEUTRAL_SPECIALS) {
      expect(validateNeutralSpecialMove(move)).toBe(move);
    }
    for (const move of [CHARGE_TEST_FIXTURE, COUNTER_TEST_FIXTURE, COMMAND_GRAB_TEST_FIXTURE]) {
      expect(validateNeutralSpecialMove(move)).toBe(move);
    }
  });

  it('rejects a record whose type is not "special"', () => {
    const bad = { ...DONKEYKONG_NEUTRAL_SPECIAL, type: 'jab' } as unknown as NeutralSpecialMove;
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/type/);
  });

  it('projectile: rejects zero-speed projectile', () => {
    const bad: ProjectileSpecialMove = {
      ...PIKACHU_NEUTRAL_SPECIAL,
      projectile: { ...PIKACHU_NEUTRAL_SPECIAL.projectile, speed: 0 },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/speed/);
  });

  it('projectile: rejects non-positive lifetime', () => {
    const bad: ProjectileSpecialMove = {
      ...PIKACHU_NEUTRAL_SPECIAL,
      projectile: { ...PIKACHU_NEUTRAL_SPECIAL.projectile, lifetimeFrames: 0 },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/lifetimeFrames/);
  });

  it('projectile: rejects non-positive dimensions', () => {
    const bad: ProjectileSpecialMove = {
      ...PIKACHU_NEUTRAL_SPECIAL,
      projectile: { ...PIKACHU_NEUTRAL_SPECIAL.projectile, width: 0 },
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
      ...COMMAND_GRAB_TEST_FIXTURE,
      grab: { ...COMMAND_GRAB_TEST_FIXTURE.grab, grabHoldFrames: -1 },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/grabHoldFrames/);
  });

  it('commandGrab: rejects negative throwDamage', () => {
    const bad: CommandGrabSpecialMove = {
      ...COMMAND_GRAB_TEST_FIXTURE,
      grab: { ...COMMAND_GRAB_TEST_FIXTURE.grab, throwDamage: -1 },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/throwDamage/);
  });

  it('counter: rejects window where end <= start', () => {
    const bad: CounterSpecialMove = {
      ...COUNTER_TEST_FIXTURE,
      counter: {
        ...COUNTER_TEST_FIXTURE.counter,
        counterWindowStart: 5,
        counterWindowEnd: 5,
      },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/window/);
  });

  it('counter: rejects window past busyTotal', () => {
    const bad: CounterSpecialMove = {
      ...COUNTER_TEST_FIXTURE,
      counter: {
        ...COUNTER_TEST_FIXTURE.counter,
        counterWindowStart: 0,
        counterWindowEnd: 999,
      },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/busyTotal/);
  });

  it('counter: rejects non-positive damageMultiplier', () => {
    const bad: CounterSpecialMove = {
      ...COUNTER_TEST_FIXTURE,
      counter: { ...COUNTER_TEST_FIXTURE.counter, damageMultiplier: 0 },
    };
    expect(() => validateNeutralSpecialMove(bad)).toThrow(/damageMultiplier/);
  });

  it('counter: rejects max < min counter damage clamp', () => {
    const bad: CounterSpecialMove = {
      ...COUNTER_TEST_FIXTURE,
      counter: {
        ...COUNTER_TEST_FIXTURE.counter,
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
  // Synthetic charge fixture: the charge-helper math is part of the
  // public schema and is exercised against fixed endpoints so a DK
  // Giant Punch retune doesn't change this coverage.
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
  const counter = COUNTER_TEST_FIXTURE;

  it('isInCounterWindow respects half-open boundaries', () => {
    const start = counter.counter.counterWindowStart;
    const end = counter.counter.counterWindowEnd;
    expect(isInCounterWindow(counter, start - 1)).toBe(false);
    expect(isInCounterWindow(counter, start)).toBe(true);
    expect(isInCounterWindow(counter, end - 1)).toBe(true);
    expect(isInCounterWindow(counter, end)).toBe(false);
  });

  it('computeCounterDamage applies the multiplier', () => {
    // 10% absorbed * 1.3 = 13 (within clamp)
    expect(computeCounterDamage(counter, 10)).toBeCloseTo(13, 5);
  });

  it('computeCounterDamage clamps at the minimum', () => {
    // 1% absorbed * 1.3 = 1.3 — below minCounterDamage (8)
    expect(computeCounterDamage(counter, 1)).toBe(counter.counter.minCounterDamage);
  });

  it('computeCounterDamage clamps at the maximum', () => {
    // 50% absorbed * 1.3 = 65 — above maxCounterDamage (22)
    expect(computeCounterDamage(counter, 50)).toBe(counter.counter.maxCounterDamage);
  });
});

// ---------------------------------------------------------------------------
// Per-character data — Seed-mandated roster invariants
// ---------------------------------------------------------------------------

describe('per-character neutral specials', () => {
  it('every character has exactly one neutral special', () => {
    for (const { id } of ROSTER_NEUTRAL_SPECIALS) {
      const spec = CHARACTER_ROSTER[id];
      const specials = spec.moves.filter((m) => m.type === 'special');
      expect(specials.length).toBe(1);
    }
  });

  it('every move id is unique within its character moveset', () => {
    for (const { id } of ROSTER_NEUTRAL_SPECIALS) {
      const spec = CHARACTER_ROSTER[id];
      const ids = spec.moves.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('every special id matches its owning character prefix', () => {
    for (const { id, move } of ROSTER_NEUTRAL_SPECIALS) {
      expect(move.id.startsWith(`${id}.`)).toBe(true);
    }
  });

  it('findMoveByType("special") returns the neutral special for each character', () => {
    for (const { id, move } of ROSTER_NEUTRAL_SPECIALS) {
      expect(findMoveByType(CHARACTER_ROSTER[id], 'special')).toBe(move);
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
    const a = computeCounterDamage(COUNTER_TEST_FIXTURE, 12);
    const b = computeCounterDamage(COUNTER_TEST_FIXTURE, 12);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// AttackMove compatibility
// ---------------------------------------------------------------------------

describe('AttackMove compatibility (structural subtype)', () => {
  it('every NeutralSpecialMove has the AttackMove fields', () => {
    for (const sp of [...ROSTER_NEUTRAL_SPECIALS.map((e) => e.move), CHARGE_TEST_FIXTURE, COUNTER_TEST_FIXTURE, COMMAND_GRAB_TEST_FIXTURE]) {
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
    expect(DONKEYKONG_JAB.type).toBe('jab');
    expect(PIKACHU_JAB.type).toBe('jab');
    expect(LINK_JAB.type).toBe('jab');
  });
});
