import { describe, it, expect } from 'vitest';
import {
  validateDownSpecialMove,
  isDownSpecialMove,
  isGroundPoundDownSpecial,
  isTrapDownSpecial,
  isStallAndFallDownSpecial,
  isCounterDownSpecial,
  isShockwaveDownSpecial,
  isInGroundPoundHopPhase,
  isInGroundPoundSlamPhase,
  isInStallAndFallStallPhase,
  isInStallAndFallFallPhase,
  isTrapArmed,
  isTrapExpired,
  isInDownCounterWindow,
  computeDownCounterDamage,
  type DownSpecialMove,
  type GroundPoundDownSpecialMove,
  type TrapDownSpecialMove,
  type StallAndFallDownSpecialMove,
  type CounterDownSpecialMove,
} from './downSpecialSchema';
import {
  DONKEYKONG_DOWN_SPECIAL,
  DONKEYKONG_JAB,
  DONKEYKONG_NAIR,
  DONKEYKONG_NEUTRAL_SPECIAL,
  DONKEYKONG_SIDE_SPECIAL,
  DONKEYKONG_UP_SPECIAL,
} from './DonkeyKong';
import {
  PIKACHU_DOWN_SPECIAL,
  PIKACHU_NEUTRAL_SPECIAL,
  PIKACHU_SIDE_SPECIAL,
  PIKACHU_UP_SPECIAL,
} from './Pikachu';
import {
  LINK_DOWN_SPECIAL,
  LINK_NEUTRAL_SPECIAL,
  LINK_SIDE_SPECIAL,
  LINK_UP_SPECIAL,
} from './linkFreshKit';
import { CHARACTER_ROSTER, findMoveByType } from './roster';

/**
 * AC 60304 Sub-AC 4 — down-special schema + per-character down-special
 * data records.
 *
 * The schema module is pure (no Phaser, no Matter, no Math.random,
 * no wall-clock). This suite locks down:
 *
 *   1. Type guards correctly classify every kind.
 *   2. Schema validators reject malformed records and accept every
 *      authored roster record plus the synthetic kind fixtures.
 *   3. Phase predicates (groundPound hop/slam, stallAndFall stall/fall)
 *      respect their boundaries.
 *   4. Trap life-stage predicates (armed, expired) respect their
 *      boundaries.
 *   5. Counter-window predicate and damage-clamp helper produce the
 *      right values.
 *   6. Per-character data — each authored down-special passes the schema
 *      AND the roster invariants (every character has exactly one down
 *      special, ids are unique and carry the owner prefix).
 *   7. Roster integration — `CHARACTER_ROSTER[id].moves` exposes the
 *      down-special and `findMoveByType(spec, 'downSpecial')` returns it.
 *   8. Down-special and the other three specials coexist as distinct
 *      moves on every character (the slot wiring keeps them
 *      independent).
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Every authored roster down-special (DK shockwave, Pikachu thunder, Link trap). */
const ROSTER_DOWN_SPECIALS = [
  { id: 'donkeykong', move: DONKEYKONG_DOWN_SPECIAL },
  { id: 'pikachu', move: PIKACHU_DOWN_SPECIAL },
  { id: 'link', move: LINK_DOWN_SPECIAL },
] as const;

/** Shared AttackMove fields for the synthetic kind fixtures below. */
const fixtureBase = (id: string, startupFrames: number, activeFrames: number, recoveryFrames: number) => ({
  id,
  type: 'downSpecial' as const,
  damage: 10,
  knockback: { x: 0.5, y: 2.0, scaling: 0.15 },
  hitbox: { offsetX: 0, offsetY: 20, width: 60, height: 30 },
  startupFrames,
  activeFrames,
  recoveryFrames,
  cooldownFrames: 20,
  animation: { startupFrames: 2, activeFrames: 3, recoveryFrames: 2 },
});

/**
 * Synthetic kind fixtures: no roster fighter ships a groundPound,
 * stallAndFall or counter down special, and Link's bomb arms instantly,
 * so these stand in to keep the schema / predicate coverage.
 */
const GROUND_POUND_FIXTURE: GroundPoundDownSpecialMove = Object.freeze({
  ...fixtureBase('fixture.ground_pound', 6, 24, 20),
  downSpecialKind: 'groundPound',
  groundPound: {
    hopFrames: 8,
    hopImpulse: -6,
    slamVelocity: 14,
    shockwaveDamage: 6,
    shockwaveKnockback: { x: 2.0, y: -1.2, scaling: 0.1 },
    shockwaveHitbox: { offsetX: 0, offsetY: 30, width: 120, height: 20 },
  },
});

const STALL_AND_FALL_FIXTURE: StallAndFallDownSpecialMove = Object.freeze({
  ...fixtureBase('fixture.stall_and_fall', 4, 30, 18),
  downSpecialKind: 'stallAndFall',
  stallAndFall: {
    stallFrames: 10,
    stallVelocity: 0,
    fallVelocity: 16,
    shockwaveDamage: 5,
    shockwaveKnockback: { x: 1.8, y: -1.0, scaling: 0.1 },
    shockwaveHitbox: { offsetX: 0, offsetY: 30, width: 100, height: 20 },
    helplessAfterFall: false,
  },
});

const TRAP_FIXTURE: TrapDownSpecialMove = Object.freeze({
  ...fixtureBase('fixture.trap', 8, 2, 16),
  downSpecialKind: 'trap',
  trap: {
    trapWidth: 40,
    trapHeight: 16,
    spawnOffsetX: 30,
    spawnOffsetY: 20,
    armDelayFrames: 20,
    trapLifetimeFrames: 300,
    trapDamage: 8,
    trapKnockback: { x: 1.0, y: -2.0, scaling: 0.12 },
    maxActiveTraps: 1,
  },
});

/** Busy total = 4 + 24 + 30 = 58; window [4, 22) sits inside it. */
const DOWN_COUNTER_FIXTURE: CounterDownSpecialMove = Object.freeze({
  ...fixtureBase('fixture.down_counter', 4, 24, 30),
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  downSpecialKind: 'counter',
  counter: {
    counterWindowStart: 4,
    counterWindowEnd: 22,
    damageMultiplier: 1.5,
    minCounterDamage: 12,
    maxCounterDamage: 28,
    counterKnockback: { x: 0.6, y: -3.4, scaling: 0.3 },
    counterHitbox: { offsetX: 0, offsetY: -30, width: 70, height: 70 },
  },
});

const KIND_FIXTURES = [GROUND_POUND_FIXTURE, STALL_AND_FALL_FIXTURE, TRAP_FIXTURE, DOWN_COUNTER_FIXTURE] as const;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe('down-special type guards', () => {
  it('isDownSpecialMove rejects non-downSpecial moves', () => {
    expect(isDownSpecialMove(DONKEYKONG_JAB)).toBe(false);
    expect(isDownSpecialMove(DONKEYKONG_NAIR)).toBe(false);
    // Crucially, a NEUTRAL/SIDE/UP special is also not a DOWN special.
    for (const move of [
      DONKEYKONG_NEUTRAL_SPECIAL, PIKACHU_NEUTRAL_SPECIAL, LINK_NEUTRAL_SPECIAL,
      DONKEYKONG_SIDE_SPECIAL, PIKACHU_SIDE_SPECIAL, LINK_SIDE_SPECIAL,
      DONKEYKONG_UP_SPECIAL, PIKACHU_UP_SPECIAL, LINK_UP_SPECIAL,
    ]) {
      expect(isDownSpecialMove(move), move.id).toBe(false);
    }
  });

  it('isDownSpecialMove accepts every authored down-special and every kind fixture', () => {
    for (const { move } of ROSTER_DOWN_SPECIALS) {
      expect(isDownSpecialMove(move)).toBe(true);
    }
    for (const move of KIND_FIXTURES) {
      expect(isDownSpecialMove(move)).toBe(true);
    }
  });

  it('per-kind type guards classify correctly and exclusively', () => {
    // Donkey Kong = shockwave (Hand Slap)
    expect(isShockwaveDownSpecial(DONKEYKONG_DOWN_SPECIAL)).toBe(true);
    expect(isGroundPoundDownSpecial(DONKEYKONG_DOWN_SPECIAL)).toBe(false);
    expect(isTrapDownSpecial(DONKEYKONG_DOWN_SPECIAL)).toBe(false);
    expect(isCounterDownSpecial(DONKEYKONG_DOWN_SPECIAL)).toBe(false);

    // Pikachu = thunder (no generic per-kind guard matches)
    expect(isShockwaveDownSpecial(PIKACHU_DOWN_SPECIAL)).toBe(false);
    expect(isTrapDownSpecial(PIKACHU_DOWN_SPECIAL)).toBe(false);
    expect(isStallAndFallDownSpecial(PIKACHU_DOWN_SPECIAL)).toBe(false);

    // Link = trap (Remote Bomb)
    expect(isTrapDownSpecial(LINK_DOWN_SPECIAL)).toBe(true);
    expect(isGroundPoundDownSpecial(LINK_DOWN_SPECIAL)).toBe(false);
    expect(isShockwaveDownSpecial(LINK_DOWN_SPECIAL)).toBe(false);

    // groundPound fixture
    expect(isGroundPoundDownSpecial(GROUND_POUND_FIXTURE)).toBe(true);
    expect(isTrapDownSpecial(GROUND_POUND_FIXTURE)).toBe(false);
    expect(isStallAndFallDownSpecial(GROUND_POUND_FIXTURE)).toBe(false);
    expect(isCounterDownSpecial(GROUND_POUND_FIXTURE)).toBe(false);

    // stallAndFall fixture
    expect(isStallAndFallDownSpecial(STALL_AND_FALL_FIXTURE)).toBe(true);
    expect(isTrapDownSpecial(STALL_AND_FALL_FIXTURE)).toBe(false);

    // counter fixture
    expect(isCounterDownSpecial(DOWN_COUNTER_FIXTURE)).toBe(true);
    expect(isStallAndFallDownSpecial(DOWN_COUNTER_FIXTURE)).toBe(false);
  });

  it('isDownSpecialMove rejects a move tagged "downSpecial" without a downSpecialKind', () => {
    const malformed = {
      ...GROUND_POUND_FIXTURE,
      downSpecialKind: undefined,
    } as unknown as DownSpecialMove;
    expect(isDownSpecialMove(malformed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateDownSpecialMove — happy path & rejection cases
// ---------------------------------------------------------------------------

describe('validateDownSpecialMove', () => {
  it('accepts every authored down-special record and every kind fixture', () => {
    for (const { move } of ROSTER_DOWN_SPECIALS) {
      expect(validateDownSpecialMove(move)).toBe(move);
    }
    for (const move of KIND_FIXTURES) {
      expect(validateDownSpecialMove(move)).toBe(move);
    }
  });

  it('rejects a record whose type is not "downSpecial"', () => {
    const bad = { ...GROUND_POUND_FIXTURE, type: 'jab' } as unknown as DownSpecialMove;
    expect(() => validateDownSpecialMove(bad)).toThrow(/type/);
  });

  // -----------------------------------------------------------------------
  // groundPound rejections
  // -----------------------------------------------------------------------

  it('groundPound: rejects hopFrames < 1', () => {
    const bad: GroundPoundDownSpecialMove = {
      ...GROUND_POUND_FIXTURE,
      groundPound: { ...GROUND_POUND_FIXTURE.groundPound, hopFrames: 0 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/hopFrames/);
  });

  it('groundPound: rejects hopFrames >= activeFrames (slam phase empty)', () => {
    const bad: GroundPoundDownSpecialMove = {
      ...GROUND_POUND_FIXTURE,
      groundPound: {
        ...GROUND_POUND_FIXTURE.groundPound,
        hopFrames: GROUND_POUND_FIXTURE.activeFrames,
      },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/slam phase non-empty/);
  });

  it('groundPound: rejects non-negative hopImpulse (must be upward)', () => {
    const bad: GroundPoundDownSpecialMove = {
      ...GROUND_POUND_FIXTURE,
      groundPound: { ...GROUND_POUND_FIXTURE.groundPound, hopImpulse: 5 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/hopImpulse/);
  });

  it('groundPound: rejects non-positive slamVelocity', () => {
    const bad: GroundPoundDownSpecialMove = {
      ...GROUND_POUND_FIXTURE,
      groundPound: { ...GROUND_POUND_FIXTURE.groundPound, slamVelocity: 0 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/slamVelocity/);
  });

  it('groundPound: rejects negative shockwaveDamage', () => {
    const bad: GroundPoundDownSpecialMove = {
      ...GROUND_POUND_FIXTURE,
      groundPound: { ...GROUND_POUND_FIXTURE.groundPound, shockwaveDamage: -1 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/shockwaveDamage/);
  });

  it('groundPound: rejects non-positive shockwave dimensions', () => {
    const bad: GroundPoundDownSpecialMove = {
      ...GROUND_POUND_FIXTURE,
      groundPound: {
        ...GROUND_POUND_FIXTURE.groundPound,
        shockwaveHitbox: {
          ...GROUND_POUND_FIXTURE.groundPound.shockwaveHitbox,
          width: 0,
        },
      },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/shockwaveHitbox/);
  });

  // -----------------------------------------------------------------------
  // trap rejections
  // -----------------------------------------------------------------------

  it('trap: rejects non-positive trap dimensions', () => {
    const bad: TrapDownSpecialMove = {
      ...LINK_DOWN_SPECIAL,
      trap: { ...LINK_DOWN_SPECIAL.trap, trapWidth: 0 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/trap dimensions/);
  });

  it('trap: rejects negative armDelayFrames', () => {
    const bad: TrapDownSpecialMove = {
      ...LINK_DOWN_SPECIAL,
      trap: { ...LINK_DOWN_SPECIAL.trap, armDelayFrames: -1 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/armDelayFrames/);
  });

  it('trap: rejects trapLifetimeFrames <= armDelayFrames', () => {
    const bad: TrapDownSpecialMove = {
      ...LINK_DOWN_SPECIAL,
      trap: {
        ...LINK_DOWN_SPECIAL.trap,
        armDelayFrames: 30,
        trapLifetimeFrames: 30,
      },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/trapLifetimeFrames/);
  });

  it('trap: rejects negative trapDamage', () => {
    const bad: TrapDownSpecialMove = {
      ...LINK_DOWN_SPECIAL,
      trap: { ...LINK_DOWN_SPECIAL.trap, trapDamage: -1 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/trapDamage/);
  });

  it('trap: rejects non-positive maxActiveTraps', () => {
    const bad: TrapDownSpecialMove = {
      ...LINK_DOWN_SPECIAL,
      trap: { ...LINK_DOWN_SPECIAL.trap, maxActiveTraps: 0 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/maxActiveTraps/);
  });

  // -----------------------------------------------------------------------
  // stallAndFall rejections
  // -----------------------------------------------------------------------

  it('stallAndFall: rejects stallFrames < 1', () => {
    const bad: StallAndFallDownSpecialMove = {
      ...STALL_AND_FALL_FIXTURE,
      stallAndFall: { ...STALL_AND_FALL_FIXTURE.stallAndFall, stallFrames: 0 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/stallFrames/);
  });

  it('stallAndFall: rejects stallFrames >= activeFrames (fall phase empty)', () => {
    const bad: StallAndFallDownSpecialMove = {
      ...STALL_AND_FALL_FIXTURE,
      stallAndFall: {
        ...STALL_AND_FALL_FIXTURE.stallAndFall,
        stallFrames: STALL_AND_FALL_FIXTURE.activeFrames,
      },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/fall phase non-empty/);
  });

  it('stallAndFall: rejects non-positive fallVelocity', () => {
    const bad: StallAndFallDownSpecialMove = {
      ...STALL_AND_FALL_FIXTURE,
      stallAndFall: { ...STALL_AND_FALL_FIXTURE.stallAndFall, fallVelocity: 0 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/fallVelocity/);
  });

  it('stallAndFall: rejects negative shockwaveDamage', () => {
    const bad: StallAndFallDownSpecialMove = {
      ...STALL_AND_FALL_FIXTURE,
      stallAndFall: { ...STALL_AND_FALL_FIXTURE.stallAndFall, shockwaveDamage: -1 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/shockwaveDamage/);
  });

  // -----------------------------------------------------------------------
  // counter rejections
  // -----------------------------------------------------------------------

  it('counter: rejects malformed counter window (start >= end)', () => {
    const bad: CounterDownSpecialMove = {
      ...DOWN_COUNTER_FIXTURE,
      counter: {
        ...DOWN_COUNTER_FIXTURE.counter,
        counterWindowStart: 10,
        counterWindowEnd: 10,
      },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/counter window/);
  });

  it('counter: rejects counter window past busyTotal', () => {
    const bad: CounterDownSpecialMove = {
      ...DOWN_COUNTER_FIXTURE,
      counter: {
        ...DOWN_COUNTER_FIXTURE.counter,
        counterWindowStart: 0,
        counterWindowEnd: 9999,
      },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/exceeds busyTotal/);
  });

  it('counter: rejects non-positive damageMultiplier', () => {
    const bad: CounterDownSpecialMove = {
      ...DOWN_COUNTER_FIXTURE,
      counter: { ...DOWN_COUNTER_FIXTURE.counter, damageMultiplier: 0 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/damageMultiplier/);
  });

  it('counter: rejects min > max counter damage clamp', () => {
    const bad: CounterDownSpecialMove = {
      ...DOWN_COUNTER_FIXTURE,
      counter: {
        ...DOWN_COUNTER_FIXTURE.counter,
        minCounterDamage: 50,
        maxCounterDamage: 10,
      },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/clamp/);
  });
});

// ---------------------------------------------------------------------------
// GroundPound phase predicates
// ---------------------------------------------------------------------------

describe('groundPound phase predicates', () => {
  const pound = GROUND_POUND_FIXTURE;
  const hop = pound.groundPound.hopFrames;
  const active = pound.activeFrames;

  it('isInGroundPoundHopPhase fires for [0, hopFrames) only', () => {
    expect(isInGroundPoundHopPhase(pound, -1)).toBe(false);
    expect(isInGroundPoundHopPhase(pound, 0)).toBe(true);
    expect(isInGroundPoundHopPhase(pound, hop - 1)).toBe(true);
    expect(isInGroundPoundHopPhase(pound, hop)).toBe(false);
  });

  it('isInGroundPoundSlamPhase fires for [hopFrames, activeFrames) only', () => {
    expect(isInGroundPoundSlamPhase(pound, hop - 1)).toBe(false);
    expect(isInGroundPoundSlamPhase(pound, hop)).toBe(true);
    expect(isInGroundPoundSlamPhase(pound, active - 1)).toBe(true);
    expect(isInGroundPoundSlamPhase(pound, active)).toBe(false);
  });

  it('hop and slam phases partition the active window without overlap', () => {
    for (let f = 0; f < active; f += 1) {
      const inHop = isInGroundPoundHopPhase(pound, f);
      const inSlam = isInGroundPoundSlamPhase(pound, f);
      // Exactly one of hop/slam is true on every active frame.
      expect(Number(inHop) + Number(inSlam)).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// StallAndFall phase predicates
// ---------------------------------------------------------------------------

describe('stallAndFall phase predicates', () => {
  const stallFall = STALL_AND_FALL_FIXTURE;
  const stall = stallFall.stallAndFall.stallFrames;
  const active = stallFall.activeFrames;

  it('isInStallAndFallStallPhase fires for [0, stallFrames) only', () => {
    expect(isInStallAndFallStallPhase(stallFall, -1)).toBe(false);
    expect(isInStallAndFallStallPhase(stallFall, 0)).toBe(true);
    expect(isInStallAndFallStallPhase(stallFall, stall - 1)).toBe(true);
    expect(isInStallAndFallStallPhase(stallFall, stall)).toBe(false);
  });

  it('isInStallAndFallFallPhase fires for [stallFrames, activeFrames) only', () => {
    expect(isInStallAndFallFallPhase(stallFall, stall - 1)).toBe(false);
    expect(isInStallAndFallFallPhase(stallFall, stall)).toBe(true);
    expect(isInStallAndFallFallPhase(stallFall, active - 1)).toBe(true);
    expect(isInStallAndFallFallPhase(stallFall, active)).toBe(false);
  });

  it('stall and fall phases partition the active window without overlap', () => {
    for (let f = 0; f < active; f += 1) {
      const inStall = isInStallAndFallStallPhase(stallFall, f);
      const inFall = isInStallAndFallFallPhase(stallFall, f);
      expect(Number(inStall) + Number(inFall)).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Trap life-stage predicates
// ---------------------------------------------------------------------------

describe('trap life-stage predicates', () => {
  const trap = TRAP_FIXTURE;
  const arm = trap.trap.armDelayFrames;
  const life = trap.trap.trapLifetimeFrames;

  it('isTrapArmed is false during arming window, true afterwards until expiry', () => {
    expect(isTrapArmed(trap, 0)).toBe(false);
    expect(isTrapArmed(trap, arm - 1)).toBe(false);
    expect(isTrapArmed(trap, arm)).toBe(true);
    expect(isTrapArmed(trap, life - 1)).toBe(true);
    expect(isTrapArmed(trap, life)).toBe(false);
  });

  it('isTrapExpired is false until lifetime, true after', () => {
    expect(isTrapExpired(trap, 0)).toBe(false);
    expect(isTrapExpired(trap, life - 1)).toBe(false);
    expect(isTrapExpired(trap, life)).toBe(true);
    expect(isTrapExpired(trap, life + 100)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Down-counter helpers
// ---------------------------------------------------------------------------

describe('down-counter helpers', () => {
  const counter = DOWN_COUNTER_FIXTURE;
  const start = counter.counter.counterWindowStart;
  const end = counter.counter.counterWindowEnd;

  it('isInDownCounterWindow fires for [start, end) only', () => {
    expect(isInDownCounterWindow(counter, start - 1)).toBe(false);
    expect(isInDownCounterWindow(counter, start)).toBe(true);
    expect(isInDownCounterWindow(counter, end - 1)).toBe(true);
    expect(isInDownCounterWindow(counter, end)).toBe(false);
  });

  it('computeDownCounterDamage applies multiplier and clamps to min', () => {
    // 1% jab × 1.5× = 1.5%; clamped UP to minCounterDamage = 12.
    expect(computeDownCounterDamage(counter, 1)).toBe(counter.counter.minCounterDamage);
  });

  it('computeDownCounterDamage applies multiplier and clamps to max', () => {
    // 100% absorbed × 1.5× = 150%; clamped DOWN to maxCounterDamage = 28.
    expect(computeDownCounterDamage(counter, 100)).toBe(counter.counter.maxCounterDamage);
  });

  it('computeDownCounterDamage interpolates between clamps for in-range absorbs', () => {
    // 12% × 1.5 = 18% — between the 12 floor and the 28 ceiling.
    expect(computeDownCounterDamage(counter, 12)).toBe(18);
  });

  it('computeDownCounterDamage is deterministic — same input → same output', () => {
    const a = computeDownCounterDamage(counter, 7);
    const b = computeDownCounterDamage(counter, 7);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Per-character data — Seed-mandated roster invariants
// ---------------------------------------------------------------------------

describe('per-character down-specials', () => {
  it('every character has exactly one down-special', () => {
    for (const { id } of ROSTER_DOWN_SPECIALS) {
      const spec = CHARACTER_ROSTER[id];
      const downs = spec.moves.filter((m) => m.type === 'downSpecial');
      expect(downs.length, `${id} downs`).toBe(1);
    }
  });

  it('every down-special id is unique across the roster', () => {
    const ids = ROSTER_DOWN_SPECIALS.map((e) => e.move.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every down-special id matches its owning character prefix', () => {
    for (const { id, move } of ROSTER_DOWN_SPECIALS) {
      expect(move.id.startsWith(`${id}.`)).toBe(true);
    }
  });

  it('findMoveByType("downSpecial") returns the down-special for each character', () => {
    for (const { id, move } of ROSTER_DOWN_SPECIALS) {
      expect(findMoveByType(CHARACTER_ROSTER[id], 'downSpecial')).toBe(move);
    }
  });

  it('declared art-frame counts never exceed gameplay-phase frame counts', () => {
    // Pikachu's Thunder is presented by its special runtime and declares no
    // animation block; DK and Link declare one.
    for (const sp of [DONKEYKONG_DOWN_SPECIAL, LINK_DOWN_SPECIAL]) {
      const a = sp.animation!;
      expect(a.startupFrames).toBeLessThanOrEqual(sp.startupFrames);
      expect(a.activeFrames).toBeLessThanOrEqual(sp.activeFrames);
      expect(a.recoveryFrames).toBeLessThanOrEqual(sp.recoveryFrames);
    }
  });
});

// ---------------------------------------------------------------------------
// Roster integration — full move table contains all four specials
// ---------------------------------------------------------------------------

describe('roster integration — every character ships all 4 special directions', () => {
  it('every character has exactly one neutral, side, up, AND down special', () => {
    for (const { id } of ROSTER_DOWN_SPECIALS) {
      const spec = CHARACTER_ROSTER[id];
      const neutralCount = spec.moves.filter((m) => m.type === 'special').length;
      const sideCount = spec.moves.filter((m) => m.type === 'sideSpecial').length;
      const upCount = spec.moves.filter((m) => m.type === 'upSpecial').length;
      const downCount = spec.moves.filter((m) => m.type === 'downSpecial').length;
      expect(neutralCount, `${id} neutral`).toBe(1);
      expect(sideCount, `${id} side`).toBe(1);
      expect(upCount, `${id} up`).toBe(1);
      expect(downCount, `${id} down`).toBe(1);
    }
  });

  it('the four specials on each character are all DISTINCT moves with different ids', () => {
    for (const { id } of ROSTER_DOWN_SPECIALS) {
      const spec = CHARACTER_ROSTER[id];
      const specials = spec.moves.filter(
        (m) =>
          m.type === 'special' ||
          m.type === 'sideSpecial' ||
          m.type === 'upSpecial' ||
          m.type === 'downSpecial',
      );
      const ids = specials.map((m) => m.id);
      expect(ids.length).toBe(4);
      expect(new Set(ids).size, `${id} unique special ids`).toBe(4);
    }
  });
});
