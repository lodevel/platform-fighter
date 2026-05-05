import { describe, it, expect } from 'vitest';
import {
  validateDownSpecialMove,
  isDownSpecialMove,
  isGroundPoundDownSpecial,
  isTrapDownSpecial,
  isStallAndFallDownSpecial,
  isCounterDownSpecial,
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
  WOLF_DOWN_SPECIAL,
  CAT_DOWN_SPECIAL,
  OWL_DOWN_SPECIAL,
  BEAR_DOWN_SPECIAL,
} from './index';
import {
  WOLF_JAB,
  CAT_JAB,
  OWL_JAB,
  BEAR_JAB,
  WOLF_NAIR,
  WOLF_NEUTRAL_SPECIAL,
  CAT_NEUTRAL_SPECIAL,
  OWL_NEUTRAL_SPECIAL,
  BEAR_NEUTRAL_SPECIAL,
  WOLF_SIDE_SPECIAL,
  WOLF_UP_SPECIAL,
  CAT_UP_SPECIAL,
  OWL_UP_SPECIAL,
  BEAR_UP_SPECIAL,
} from './index';
import { CHARACTER_ROSTER, findMoveByType } from './roster';

/**
 * AC 60304 Sub-AC 4 — down-special schema + per-character down-special
 * data records.
 *
 * The schema module is pure (no Phaser, no Matter, no Math.random,
 * no wall-clock). This suite locks down:
 *
 *   1. Type guards correctly classify the four kinds.
 *   2. Schema validators reject malformed records and accept all four
 *      authored records.
 *   3. Phase predicates (groundPound hop/slam, stallAndFall stall/fall)
 *      respect their boundaries.
 *   4. Trap life-stage predicates (armed, expired) respect their
 *      boundaries.
 *   5. Counter-window predicate and damage-clamp helper produce the
 *      right values.
 *   6. Per-character data — each authored down-special passes the schema
 *      AND the Seed roster invariants (every character has exactly
 *      one down special, kinds are pairwise distinct, ids are unique).
 *   7. Roster integration — `CHARACTER_ROSTER[id].moves` exposes the
 *      down-special and `findMoveByType(spec, 'downSpecial')` returns it.
 *   8. Down-special and the other three specials coexist as distinct
 *      moves on every character (the slot wiring keeps them
 *      independent).
 */

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe('down-special type guards', () => {
  it('isDownSpecialMove rejects non-downSpecial moves', () => {
    expect(isDownSpecialMove(WOLF_JAB)).toBe(false);
    expect(isDownSpecialMove(WOLF_NAIR)).toBe(false);
    // Crucially, a NEUTRAL/SIDE/UP special is also not a DOWN special.
    expect(isDownSpecialMove(WOLF_NEUTRAL_SPECIAL)).toBe(false);
    expect(isDownSpecialMove(CAT_NEUTRAL_SPECIAL)).toBe(false);
    expect(isDownSpecialMove(OWL_NEUTRAL_SPECIAL)).toBe(false);
    expect(isDownSpecialMove(BEAR_NEUTRAL_SPECIAL)).toBe(false);
    expect(isDownSpecialMove(WOLF_SIDE_SPECIAL)).toBe(false);
    expect(isDownSpecialMove(WOLF_UP_SPECIAL)).toBe(false);
    expect(isDownSpecialMove(CAT_UP_SPECIAL)).toBe(false);
    expect(isDownSpecialMove(OWL_UP_SPECIAL)).toBe(false);
    expect(isDownSpecialMove(BEAR_UP_SPECIAL)).toBe(false);
  });

  it('isDownSpecialMove accepts every authored down-special', () => {
    expect(isDownSpecialMove(WOLF_DOWN_SPECIAL)).toBe(true);
    expect(isDownSpecialMove(CAT_DOWN_SPECIAL)).toBe(true);
    expect(isDownSpecialMove(OWL_DOWN_SPECIAL)).toBe(true);
    expect(isDownSpecialMove(BEAR_DOWN_SPECIAL)).toBe(true);
  });

  it('per-kind type guards classify correctly and exclusively', () => {
    // Wolf = groundPound
    expect(isGroundPoundDownSpecial(WOLF_DOWN_SPECIAL)).toBe(true);
    expect(isTrapDownSpecial(WOLF_DOWN_SPECIAL)).toBe(false);
    expect(isStallAndFallDownSpecial(WOLF_DOWN_SPECIAL)).toBe(false);
    expect(isCounterDownSpecial(WOLF_DOWN_SPECIAL)).toBe(false);

    // Cat = trap
    expect(isTrapDownSpecial(CAT_DOWN_SPECIAL)).toBe(true);
    expect(isGroundPoundDownSpecial(CAT_DOWN_SPECIAL)).toBe(false);

    // Owl = stallAndFall
    expect(isStallAndFallDownSpecial(OWL_DOWN_SPECIAL)).toBe(true);
    expect(isTrapDownSpecial(OWL_DOWN_SPECIAL)).toBe(false);

    // Bear = counter
    expect(isCounterDownSpecial(BEAR_DOWN_SPECIAL)).toBe(true);
    expect(isStallAndFallDownSpecial(BEAR_DOWN_SPECIAL)).toBe(false);
  });

  it('isDownSpecialMove rejects a move tagged "downSpecial" without a downSpecialKind', () => {
    const malformed = {
      ...WOLF_DOWN_SPECIAL,
      downSpecialKind: undefined,
    } as unknown as DownSpecialMove;
    expect(isDownSpecialMove(malformed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateDownSpecialMove — happy path & rejection cases
// ---------------------------------------------------------------------------

describe('validateDownSpecialMove', () => {
  it('accepts every authored down-special record', () => {
    expect(validateDownSpecialMove(WOLF_DOWN_SPECIAL)).toBe(WOLF_DOWN_SPECIAL);
    expect(validateDownSpecialMove(CAT_DOWN_SPECIAL)).toBe(CAT_DOWN_SPECIAL);
    expect(validateDownSpecialMove(OWL_DOWN_SPECIAL)).toBe(OWL_DOWN_SPECIAL);
    expect(validateDownSpecialMove(BEAR_DOWN_SPECIAL)).toBe(BEAR_DOWN_SPECIAL);
  });

  it('rejects a record whose type is not "downSpecial"', () => {
    const bad = { ...WOLF_DOWN_SPECIAL, type: 'jab' } as unknown as DownSpecialMove;
    expect(() => validateDownSpecialMove(bad)).toThrow(/type/);
  });

  // -----------------------------------------------------------------------
  // groundPound rejections
  // -----------------------------------------------------------------------

  it('groundPound: rejects hopFrames < 1', () => {
    const bad: GroundPoundDownSpecialMove = {
      ...WOLF_DOWN_SPECIAL,
      groundPound: { ...WOLF_DOWN_SPECIAL.groundPound, hopFrames: 0 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/hopFrames/);
  });

  it('groundPound: rejects hopFrames >= activeFrames (slam phase empty)', () => {
    const bad: GroundPoundDownSpecialMove = {
      ...WOLF_DOWN_SPECIAL,
      groundPound: {
        ...WOLF_DOWN_SPECIAL.groundPound,
        hopFrames: WOLF_DOWN_SPECIAL.activeFrames,
      },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/slam phase non-empty/);
  });

  it('groundPound: rejects non-negative hopImpulse (must be upward)', () => {
    const bad: GroundPoundDownSpecialMove = {
      ...WOLF_DOWN_SPECIAL,
      groundPound: { ...WOLF_DOWN_SPECIAL.groundPound, hopImpulse: 5 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/hopImpulse/);
  });

  it('groundPound: rejects non-positive slamVelocity', () => {
    const bad: GroundPoundDownSpecialMove = {
      ...WOLF_DOWN_SPECIAL,
      groundPound: { ...WOLF_DOWN_SPECIAL.groundPound, slamVelocity: 0 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/slamVelocity/);
  });

  it('groundPound: rejects negative shockwaveDamage', () => {
    const bad: GroundPoundDownSpecialMove = {
      ...WOLF_DOWN_SPECIAL,
      groundPound: { ...WOLF_DOWN_SPECIAL.groundPound, shockwaveDamage: -1 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/shockwaveDamage/);
  });

  it('groundPound: rejects non-positive shockwave dimensions', () => {
    const bad: GroundPoundDownSpecialMove = {
      ...WOLF_DOWN_SPECIAL,
      groundPound: {
        ...WOLF_DOWN_SPECIAL.groundPound,
        shockwaveHitbox: {
          ...WOLF_DOWN_SPECIAL.groundPound.shockwaveHitbox,
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
      ...CAT_DOWN_SPECIAL,
      trap: { ...CAT_DOWN_SPECIAL.trap, trapWidth: 0 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/trap dimensions/);
  });

  it('trap: rejects negative armDelayFrames', () => {
    const bad: TrapDownSpecialMove = {
      ...CAT_DOWN_SPECIAL,
      trap: { ...CAT_DOWN_SPECIAL.trap, armDelayFrames: -1 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/armDelayFrames/);
  });

  it('trap: rejects trapLifetimeFrames <= armDelayFrames', () => {
    const bad: TrapDownSpecialMove = {
      ...CAT_DOWN_SPECIAL,
      trap: {
        ...CAT_DOWN_SPECIAL.trap,
        armDelayFrames: 30,
        trapLifetimeFrames: 30,
      },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/trapLifetimeFrames/);
  });

  it('trap: rejects negative trapDamage', () => {
    const bad: TrapDownSpecialMove = {
      ...CAT_DOWN_SPECIAL,
      trap: { ...CAT_DOWN_SPECIAL.trap, trapDamage: -1 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/trapDamage/);
  });

  it('trap: rejects non-positive maxActiveTraps', () => {
    const bad: TrapDownSpecialMove = {
      ...CAT_DOWN_SPECIAL,
      trap: { ...CAT_DOWN_SPECIAL.trap, maxActiveTraps: 0 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/maxActiveTraps/);
  });

  // -----------------------------------------------------------------------
  // stallAndFall rejections
  // -----------------------------------------------------------------------

  it('stallAndFall: rejects stallFrames < 1', () => {
    const bad: StallAndFallDownSpecialMove = {
      ...OWL_DOWN_SPECIAL,
      stallAndFall: { ...OWL_DOWN_SPECIAL.stallAndFall, stallFrames: 0 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/stallFrames/);
  });

  it('stallAndFall: rejects stallFrames >= activeFrames (fall phase empty)', () => {
    const bad: StallAndFallDownSpecialMove = {
      ...OWL_DOWN_SPECIAL,
      stallAndFall: {
        ...OWL_DOWN_SPECIAL.stallAndFall,
        stallFrames: OWL_DOWN_SPECIAL.activeFrames,
      },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/fall phase non-empty/);
  });

  it('stallAndFall: rejects non-positive fallVelocity', () => {
    const bad: StallAndFallDownSpecialMove = {
      ...OWL_DOWN_SPECIAL,
      stallAndFall: { ...OWL_DOWN_SPECIAL.stallAndFall, fallVelocity: 0 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/fallVelocity/);
  });

  it('stallAndFall: rejects negative shockwaveDamage', () => {
    const bad: StallAndFallDownSpecialMove = {
      ...OWL_DOWN_SPECIAL,
      stallAndFall: { ...OWL_DOWN_SPECIAL.stallAndFall, shockwaveDamage: -1 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/shockwaveDamage/);
  });

  // -----------------------------------------------------------------------
  // counter rejections
  // -----------------------------------------------------------------------

  it('counter: rejects malformed counter window (start >= end)', () => {
    const bad: CounterDownSpecialMove = {
      ...BEAR_DOWN_SPECIAL,
      counter: {
        ...BEAR_DOWN_SPECIAL.counter,
        counterWindowStart: 10,
        counterWindowEnd: 10,
      },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/counter window/);
  });

  it('counter: rejects counter window past busyTotal', () => {
    const bad: CounterDownSpecialMove = {
      ...BEAR_DOWN_SPECIAL,
      counter: {
        ...BEAR_DOWN_SPECIAL.counter,
        counterWindowStart: 0,
        counterWindowEnd: 9999,
      },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/exceeds busyTotal/);
  });

  it('counter: rejects non-positive damageMultiplier', () => {
    const bad: CounterDownSpecialMove = {
      ...BEAR_DOWN_SPECIAL,
      counter: { ...BEAR_DOWN_SPECIAL.counter, damageMultiplier: 0 },
    };
    expect(() => validateDownSpecialMove(bad)).toThrow(/damageMultiplier/);
  });

  it('counter: rejects min > max counter damage clamp', () => {
    const bad: CounterDownSpecialMove = {
      ...BEAR_DOWN_SPECIAL,
      counter: {
        ...BEAR_DOWN_SPECIAL.counter,
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
  const wolf = WOLF_DOWN_SPECIAL;
  const hop = wolf.groundPound.hopFrames;
  const active = wolf.activeFrames;

  it('isInGroundPoundHopPhase fires for [0, hopFrames) only', () => {
    expect(isInGroundPoundHopPhase(wolf, -1)).toBe(false);
    expect(isInGroundPoundHopPhase(wolf, 0)).toBe(true);
    expect(isInGroundPoundHopPhase(wolf, hop - 1)).toBe(true);
    expect(isInGroundPoundHopPhase(wolf, hop)).toBe(false);
  });

  it('isInGroundPoundSlamPhase fires for [hopFrames, activeFrames) only', () => {
    expect(isInGroundPoundSlamPhase(wolf, hop - 1)).toBe(false);
    expect(isInGroundPoundSlamPhase(wolf, hop)).toBe(true);
    expect(isInGroundPoundSlamPhase(wolf, active - 1)).toBe(true);
    expect(isInGroundPoundSlamPhase(wolf, active)).toBe(false);
  });

  it('hop and slam phases partition the active window without overlap', () => {
    for (let f = 0; f < active; f += 1) {
      const inHop = isInGroundPoundHopPhase(wolf, f);
      const inSlam = isInGroundPoundSlamPhase(wolf, f);
      // Exactly one of hop/slam is true on every active frame.
      expect(Number(inHop) + Number(inSlam)).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// StallAndFall phase predicates
// ---------------------------------------------------------------------------

describe('stallAndFall phase predicates', () => {
  const owl = OWL_DOWN_SPECIAL;
  const stall = owl.stallAndFall.stallFrames;
  const active = owl.activeFrames;

  it('isInStallAndFallStallPhase fires for [0, stallFrames) only', () => {
    expect(isInStallAndFallStallPhase(owl, -1)).toBe(false);
    expect(isInStallAndFallStallPhase(owl, 0)).toBe(true);
    expect(isInStallAndFallStallPhase(owl, stall - 1)).toBe(true);
    expect(isInStallAndFallStallPhase(owl, stall)).toBe(false);
  });

  it('isInStallAndFallFallPhase fires for [stallFrames, activeFrames) only', () => {
    expect(isInStallAndFallFallPhase(owl, stall - 1)).toBe(false);
    expect(isInStallAndFallFallPhase(owl, stall)).toBe(true);
    expect(isInStallAndFallFallPhase(owl, active - 1)).toBe(true);
    expect(isInStallAndFallFallPhase(owl, active)).toBe(false);
  });

  it('stall and fall phases partition the active window without overlap', () => {
    for (let f = 0; f < active; f += 1) {
      const inStall = isInStallAndFallStallPhase(owl, f);
      const inFall = isInStallAndFallFallPhase(owl, f);
      expect(Number(inStall) + Number(inFall)).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Trap life-stage predicates
// ---------------------------------------------------------------------------

describe('trap life-stage predicates', () => {
  const cat = CAT_DOWN_SPECIAL;
  const arm = cat.trap.armDelayFrames;
  const life = cat.trap.trapLifetimeFrames;

  it('isTrapArmed is false during arming window, true afterwards until expiry', () => {
    expect(isTrapArmed(cat, 0)).toBe(false);
    expect(isTrapArmed(cat, arm - 1)).toBe(false);
    expect(isTrapArmed(cat, arm)).toBe(true);
    expect(isTrapArmed(cat, life - 1)).toBe(true);
    expect(isTrapArmed(cat, life)).toBe(false);
  });

  it('isTrapExpired is false until lifetime, true after', () => {
    expect(isTrapExpired(cat, 0)).toBe(false);
    expect(isTrapExpired(cat, life - 1)).toBe(false);
    expect(isTrapExpired(cat, life)).toBe(true);
    expect(isTrapExpired(cat, life + 100)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Down-counter helpers
// ---------------------------------------------------------------------------

describe('down-counter helpers', () => {
  const bear = BEAR_DOWN_SPECIAL;
  const start = bear.counter.counterWindowStart;
  const end = bear.counter.counterWindowEnd;

  it('isInDownCounterWindow fires for [start, end) only', () => {
    expect(isInDownCounterWindow(bear, start - 1)).toBe(false);
    expect(isInDownCounterWindow(bear, start)).toBe(true);
    expect(isInDownCounterWindow(bear, end - 1)).toBe(true);
    expect(isInDownCounterWindow(bear, end)).toBe(false);
  });

  it('computeDownCounterDamage applies multiplier and clamps to min', () => {
    // 1% jab × 1.5× = 1.5%; clamped UP to minCounterDamage = 12.
    expect(computeDownCounterDamage(bear, 1)).toBe(bear.counter.minCounterDamage);
  });

  it('computeDownCounterDamage applies multiplier and clamps to max', () => {
    // 100% absorbed × 1.5× = 150%; clamped DOWN to maxCounterDamage = 28.
    expect(computeDownCounterDamage(bear, 100)).toBe(bear.counter.maxCounterDamage);
  });

  it('computeDownCounterDamage interpolates between clamps for in-range absorbs', () => {
    // 12% × 1.5 = 18% — between the 12 floor and the 28 ceiling.
    expect(computeDownCounterDamage(bear, 12)).toBe(18);
  });

  it('computeDownCounterDamage is deterministic — same input → same output', () => {
    const a = computeDownCounterDamage(bear, 7);
    const b = computeDownCounterDamage(bear, 7);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Per-character data — Seed-mandated roster invariants
// ---------------------------------------------------------------------------

describe('per-character down-specials', () => {
  it('every character has exactly one down-special', () => {
    for (const id of ['wolf', 'cat', 'owl', 'bear'] as const) {
      const spec = CHARACTER_ROSTER[id];
      const downs = spec.moves.filter((m) => m.type === 'downSpecial');
      expect(downs.length, `${id} downs`).toBe(1);
    }
  });

  it('the four characters use four distinct kinds (Seed: unique mechanics)', () => {
    const kinds = new Set([
      WOLF_DOWN_SPECIAL.downSpecialKind,
      CAT_DOWN_SPECIAL.downSpecialKind,
      OWL_DOWN_SPECIAL.downSpecialKind,
      BEAR_DOWN_SPECIAL.downSpecialKind,
    ]);
    expect(kinds.size).toBe(4);
    expect(kinds.has('groundPound')).toBe(true);
    expect(kinds.has('trap')).toBe(true);
    expect(kinds.has('stallAndFall')).toBe(true);
    expect(kinds.has('counter')).toBe(true);
  });

  it('every down-special id is unique across the roster', () => {
    const ids = [
      WOLF_DOWN_SPECIAL.id,
      CAT_DOWN_SPECIAL.id,
      OWL_DOWN_SPECIAL.id,
      BEAR_DOWN_SPECIAL.id,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every down-special id matches its owning character prefix', () => {
    expect(WOLF_DOWN_SPECIAL.id).toMatch(/^wolf\./);
    expect(CAT_DOWN_SPECIAL.id).toMatch(/^cat\./);
    expect(OWL_DOWN_SPECIAL.id).toMatch(/^owl\./);
    expect(BEAR_DOWN_SPECIAL.id).toMatch(/^bear\./);
  });

  it('findMoveByType("downSpecial") returns the down-special for each character', () => {
    expect(findMoveByType(CHARACTER_ROSTER.wolf, 'downSpecial')).toBe(WOLF_DOWN_SPECIAL);
    expect(findMoveByType(CHARACTER_ROSTER.cat, 'downSpecial')).toBe(CAT_DOWN_SPECIAL);
    expect(findMoveByType(CHARACTER_ROSTER.owl, 'downSpecial')).toBe(OWL_DOWN_SPECIAL);
    expect(findMoveByType(CHARACTER_ROSTER.bear, 'downSpecial')).toBe(BEAR_DOWN_SPECIAL);
  });

  it('every down-special declares an animation block (renderer integration)', () => {
    for (const sp of [
      WOLF_DOWN_SPECIAL,
      CAT_DOWN_SPECIAL,
      OWL_DOWN_SPECIAL,
      BEAR_DOWN_SPECIAL,
    ]) {
      expect(sp.animation).toBeDefined();
      const a = sp.animation!;
      expect(a.startupFrames).toBeGreaterThan(0);
      expect(a.activeFrames).toBeGreaterThan(0);
      expect(a.recoveryFrames).toBeGreaterThan(0);
      // Seed constraint: 6-8 art frames per move.
      const total = a.startupFrames + a.activeFrames + a.recoveryFrames;
      expect(total, `${sp.id} art-frame count`).toBeGreaterThanOrEqual(6);
      expect(total, `${sp.id} art-frame count`).toBeLessThanOrEqual(8);
    }
  });

  it('art-frame counts never exceed gameplay-phase frame counts', () => {
    for (const sp of [
      WOLF_DOWN_SPECIAL,
      CAT_DOWN_SPECIAL,
      OWL_DOWN_SPECIAL,
      BEAR_DOWN_SPECIAL,
    ]) {
      const a = sp.animation!;
      expect(a.startupFrames).toBeLessThanOrEqual(sp.startupFrames);
      expect(a.activeFrames).toBeLessThanOrEqual(sp.activeFrames);
      expect(a.recoveryFrames).toBeLessThanOrEqual(sp.recoveryFrames);
    }
  });
});

// ---------------------------------------------------------------------------
// Down-special-archetype invariants — the move family has a job to do
// ---------------------------------------------------------------------------

describe('down-special archetype invariants', () => {
  it("Wolf's groundPound hops up (negative hopImpulse) and slams down (positive slamVelocity)", () => {
    expect(WOLF_DOWN_SPECIAL.groundPound.hopImpulse).toBeLessThan(0);
    expect(WOLF_DOWN_SPECIAL.groundPound.slamVelocity).toBeGreaterThan(0);
  });

  it("Wolf's groundPound meteor knockback is downward (positive y)", () => {
    // Phaser screen-space: positive y = downward = meteor / spike.
    expect(WOLF_DOWN_SPECIAL.knockback.y).toBeGreaterThan(0);
  });

  it("Cat's trap arms after a non-trivial delay (counter-play)", () => {
    expect(CAT_DOWN_SPECIAL.trap.armDelayFrames).toBeGreaterThan(0);
    expect(CAT_DOWN_SPECIAL.trap.trapLifetimeFrames).toBeGreaterThan(
      CAT_DOWN_SPECIAL.trap.armDelayFrames,
    );
  });

  it("Cat's trap is limited to a single active placement", () => {
    expect(CAT_DOWN_SPECIAL.trap.maxActiveTraps).toBe(1);
  });

  it("Owl's stallAndFall plunges downward (positive fallVelocity)", () => {
    expect(OWL_DOWN_SPECIAL.stallAndFall.fallVelocity).toBeGreaterThan(0);
  });

  it("Owl's stallAndFall meteor knockback is downward (positive y)", () => {
    expect(OWL_DOWN_SPECIAL.knockback.y).toBeGreaterThan(0);
  });

  it("Bear's counter has an upward (negative-y) launch — vertical KO trajectory", () => {
    // Vertical-launch is the key flavour distinction from Wolf's neutral
    // counter, which uses a horizontal launch.
    expect(BEAR_DOWN_SPECIAL.counter.counterKnockback.y).toBeLessThan(0);
  });

  it("Bear's counter has a heavier damage multiplier than Wolf's neutral counter", () => {
    // The down-counter is more committal, so the payoff is heavier.
    expect(BEAR_DOWN_SPECIAL.counter.damageMultiplier).toBeGreaterThan(1.3);
  });
});

// ---------------------------------------------------------------------------
// Roster integration — full move table contains all four specials
// ---------------------------------------------------------------------------

describe('roster integration — every character ships all 4 special directions', () => {
  it('every character has exactly one neutral, side, up, AND down special', () => {
    for (const id of ['wolf', 'cat', 'owl', 'bear'] as const) {
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
    for (const id of ['wolf', 'cat', 'owl', 'bear'] as const) {
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

// Anchor a JAB symbol so the import doesn't get tree-shaken in
// type-only contexts. Also stops "unused import" lint flags in the
// bundle on import-removal optimisations.
void [WOLF_JAB, CAT_JAB, OWL_JAB, BEAR_JAB];
