import { describe, it, expect } from 'vitest';

import {
  ATTACK_MOVESET_SLOT_NAMES,
  DEFENSIVE_MOVESET_SLOT_NAMES,
  EXTENDED_ATTACK_MOVESET_SLOT_COUNT,
  EXTENDED_ATTACK_MOVESET_SLOT_NAMES,
  MOVESET_SLOT_NAMES,
  MOVESET_SLOT_COUNT,
  assertAttackSlotCount,
  assertDefensiveSlotCount,
  assertFighterMoveset,
  assertMovesetSlotCount,
  forEachMovesetSlot,
  getMovesetSlot,
  getMovesetSlotCategory,
  isAttackMovesetSlot,
  isDefensiveMovesetSlot,
  isMovesetSlotName,
  listAttackMoves,
  type AttackMovesetSlotName,
  type DefensiveMovesetSlotName,
  type FighterMoveset,
  type MovesetSlotCategory,
  type MovesetSlotName,
  type MovesetSlotOverride,
} from './movesetContract';
import {
  WOLF_JAB,
  WOLF_TILT,
  WOLF_SMASH,
  WOLF_FAIR,
  WOLF_NEUTRAL_SPECIAL,
  WOLF_SIDE_SPECIAL,
  WOLF_UP_SPECIAL,
  WOLF_DOWN_SPECIAL,
} from './Wolf';
import { SHIELD_DEFAULTS } from './shieldState';
import { DODGE_DEFAULTS } from './dodgeState';

/**
 * AC 1 Sub-AC 1 — uniform 10-slot moveset contract.
 *
 * Locks down:
 *   1. Slot taxonomy — 8 attack slots + 2 defensive slots = 10 total,
 *      in the canonical authoring order.
 *   2. Category partitioning — `getMovesetSlotCategory` and the
 *      `is*MovesetSlot` type guards agree on every slot name.
 *   3. Shape access — `getMovesetSlot`, `listAttackMoves`,
 *      `forEachMovesetSlot` walk the slots in the canonical order and
 *      return the typed values.
 *   4. Validation — `assertFighterMoveset` accepts a well-formed
 *      moveset and rejects every kind of contract violation.
 *
 * Pure / Phaser-free / Matter-free — runs under Node alone.
 */

// A reusable well-formed moveset built from Wolf's authored records.
// Wolf already exposes the canonical 8 attack records + we plug in the
// shared shield/dodge defaults for the defensive slots.
function buildWolfMoveset(): FighterMoveset {
  return {
    jab: WOLF_JAB,
    tilt: WOLF_TILT,
    smash: WOLF_SMASH,
    fair: WOLF_FAIR,
    neutralSpecial: WOLF_NEUTRAL_SPECIAL,
    sideSpecial: WOLF_SIDE_SPECIAL,
    upSpecial: WOLF_UP_SPECIAL,
    downSpecial: WOLF_DOWN_SPECIAL,
    shield: SHIELD_DEFAULTS,
    dodge: DODGE_DEFAULTS,
  };
}

// ---------------------------------------------------------------------------
// Slot-name lists
// ---------------------------------------------------------------------------

describe('MOVESET_SLOT_NAMES', () => {
  it('has exactly 10 slots — the Seed-mandated canonical count', () => {
    expect(MOVESET_SLOT_NAMES).toHaveLength(MOVESET_SLOT_COUNT);
    expect(MOVESET_SLOT_COUNT).toBe(10);
  });

  it('lists the canonical 10 names in authoring order', () => {
    expect([...MOVESET_SLOT_NAMES]).toEqual([
      'jab',
      'tilt',
      'smash',
      'fair',
      'neutralSpecial',
      'sideSpecial',
      'upSpecial',
      'downSpecial',
      'shield',
      'dodge',
    ]);
  });

  it('is the concatenation of attack + defensive lists', () => {
    expect([...MOVESET_SLOT_NAMES]).toEqual([
      ...ATTACK_MOVESET_SLOT_NAMES,
      ...DEFENSIVE_MOVESET_SLOT_NAMES,
    ]);
  });

  it('is frozen so accidental writes throw in strict mode', () => {
    expect(Object.isFrozen(MOVESET_SLOT_NAMES)).toBe(true);
    expect(Object.isFrozen(ATTACK_MOVESET_SLOT_NAMES)).toBe(true);
    expect(Object.isFrozen(DEFENSIVE_MOVESET_SLOT_NAMES)).toBe(true);
  });

  it('attack slot list has 8 entries in canonical order', () => {
    expect(ATTACK_MOVESET_SLOT_NAMES).toHaveLength(8);
    expect([...ATTACK_MOVESET_SLOT_NAMES]).toEqual([
      'jab',
      'tilt',
      'smash',
      'fair',
      'neutralSpecial',
      'sideSpecial',
      'upSpecial',
      'downSpecial',
    ]);
  });

  it('defensive slot list has 2 entries in canonical order', () => {
    expect(DEFENSIVE_MOVESET_SLOT_NAMES).toHaveLength(2);
    expect([...DEFENSIVE_MOVESET_SLOT_NAMES]).toEqual(['shield', 'dodge']);
  });

  it('contains no duplicate slot names', () => {
    const set = new Set(MOVESET_SLOT_NAMES);
    expect(set.size).toBe(MOVESET_SLOT_NAMES.length);
  });
});

// ---------------------------------------------------------------------------
// Slot category helpers
// ---------------------------------------------------------------------------

describe('getMovesetSlotCategory', () => {
  it('returns "attack" for every attack slot', () => {
    for (const slot of ATTACK_MOVESET_SLOT_NAMES) {
      expect(getMovesetSlotCategory(slot)).toBe<MovesetSlotCategory>('attack');
    }
  });

  it('returns "defensive" for every defensive slot', () => {
    for (const slot of DEFENSIVE_MOVESET_SLOT_NAMES) {
      expect(getMovesetSlotCategory(slot)).toBe<MovesetSlotCategory>('defensive');
    }
  });

  it('agrees with the type-guards on every slot', () => {
    for (const slot of MOVESET_SLOT_NAMES) {
      const cat = getMovesetSlotCategory(slot);
      expect(isAttackMovesetSlot(slot)).toBe(cat === 'attack');
      expect(isDefensiveMovesetSlot(slot)).toBe(cat === 'defensive');
    }
  });
});

describe('isMovesetSlotName', () => {
  it('accepts every canonical slot name', () => {
    for (const slot of MOVESET_SLOT_NAMES) {
      expect(isMovesetSlotName(slot)).toBe(true);
    }
  });

  it('rejects non-canonical names', () => {
    expect(isMovesetSlotName('nair')).toBe(false);
    expect(isMovesetSlotName('bair')).toBe(false);
    expect(isMovesetSlotName('grab')).toBe(false);
    expect(isMovesetSlotName('')).toBe(false);
    expect(isMovesetSlotName('JAB')).toBe(false);
    expect(isMovesetSlotName('forwardAerial')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Slot accessors
// ---------------------------------------------------------------------------

describe('getMovesetSlot', () => {
  it('returns the typed move for each attack slot', () => {
    const ms = buildWolfMoveset();
    expect(getMovesetSlot(ms, 'jab')).toBe(WOLF_JAB);
    expect(getMovesetSlot(ms, 'tilt')).toBe(WOLF_TILT);
    expect(getMovesetSlot(ms, 'smash')).toBe(WOLF_SMASH);
    expect(getMovesetSlot(ms, 'fair')).toBe(WOLF_FAIR);
    expect(getMovesetSlot(ms, 'neutralSpecial')).toBe(WOLF_NEUTRAL_SPECIAL);
    expect(getMovesetSlot(ms, 'sideSpecial')).toBe(WOLF_SIDE_SPECIAL);
    expect(getMovesetSlot(ms, 'upSpecial')).toBe(WOLF_UP_SPECIAL);
    expect(getMovesetSlot(ms, 'downSpecial')).toBe(WOLF_DOWN_SPECIAL);
  });

  it('returns the typed tuning for each defensive slot', () => {
    const ms = buildWolfMoveset();
    expect(getMovesetSlot(ms, 'shield')).toBe(SHIELD_DEFAULTS);
    expect(getMovesetSlot(ms, 'dodge')).toBe(DODGE_DEFAULTS);
  });
});

describe('listAttackMoves', () => {
  it('returns 8 moves in the canonical attack-slot order', () => {
    const ms = buildWolfMoveset();
    const moves = listAttackMoves(ms);
    expect(moves).toHaveLength(8);
    expect(moves).toEqual([
      WOLF_JAB,
      WOLF_TILT,
      WOLF_SMASH,
      WOLF_FAIR,
      WOLF_NEUTRAL_SPECIAL,
      WOLF_SIDE_SPECIAL,
      WOLF_UP_SPECIAL,
      WOLF_DOWN_SPECIAL,
    ]);
  });
});

describe('forEachMovesetSlot', () => {
  it('visits every slot exactly once in the canonical order', () => {
    const ms = buildWolfMoveset();
    const visits: Array<{ slot: MovesetSlotName; cat: MovesetSlotCategory }> = [];
    forEachMovesetSlot(ms, (slot, _value, category) => {
      visits.push({ slot, cat: category });
    });
    expect(visits.map((v) => v.slot)).toEqual([...MOVESET_SLOT_NAMES]);
  });

  it('reports the right category alongside each slot', () => {
    const ms = buildWolfMoveset();
    forEachMovesetSlot(ms, (slot, _value, category) => {
      expect(category).toBe(getMovesetSlotCategory(slot));
    });
  });

  it('passes the moveset value through for the typed slot', () => {
    const ms = buildWolfMoveset();
    const seen: Record<string, unknown> = {};
    forEachMovesetSlot(ms, (slot, value) => {
      seen[slot] = value;
    });
    expect(seen.jab).toBe(WOLF_JAB);
    expect(seen.fair).toBe(WOLF_FAIR);
    expect(seen.shield).toBe(SHIELD_DEFAULTS);
    expect(seen.dodge).toBe(DODGE_DEFAULTS);
  });
});

// ---------------------------------------------------------------------------
// assertFighterMoveset
// ---------------------------------------------------------------------------

describe('assertFighterMoveset', () => {
  it('accepts a well-formed Wolf moveset', () => {
    expect(() => assertFighterMoveset('wolf', buildWolfMoveset())).not.toThrow();
  });

  it('rejects a moveset with a wrong-typed jab', () => {
    const ms = { ...buildWolfMoveset(), jab: WOLF_TILT } as FighterMoveset;
    expect(() => assertFighterMoveset('wolf', ms)).toThrow(/jab/);
  });

  it('rejects a moveset with a wrong-typed smash', () => {
    const ms = { ...buildWolfMoveset(), smash: WOLF_JAB } as FighterMoveset;
    expect(() => assertFighterMoveset('wolf', ms)).toThrow(/smash/);
  });

  it('rejects a fair slot whose direction is not forward', () => {
    // Synthesise an aerial move that claims direction 'back' — the
    // contract requires the fair slot to be a forward aerial.
    const wrongFair = { ...WOLF_FAIR, aerialDirection: 'back' as const };
    const ms = { ...buildWolfMoveset(), fair: wrongFair };
    expect(() => assertFighterMoveset('wolf', ms)).toThrow(/aerialDirection/);
  });

  it('rejects a fair slot whose type is not "aerial"', () => {
    const wrongFair = { ...WOLF_FAIR, type: 'jab' as const };
    const ms = { ...buildWolfMoveset(), fair: wrongFair } as unknown as FighterMoveset;
    expect(() => assertFighterMoveset('wolf', ms)).toThrow(/fair/);
  });

  it('rejects a moveset with a wrong-typed neutralSpecial', () => {
    const ms = {
      ...buildWolfMoveset(),
      neutralSpecial: WOLF_SIDE_SPECIAL,
    } as unknown as FighterMoveset;
    expect(() => assertFighterMoveset('wolf', ms)).toThrow(/neutralSpecial/);
  });

  it('rejects a moveset with a wrong-typed sideSpecial', () => {
    const ms = {
      ...buildWolfMoveset(),
      sideSpecial: WOLF_NEUTRAL_SPECIAL,
    } as unknown as FighterMoveset;
    expect(() => assertFighterMoveset('wolf', ms)).toThrow(/sideSpecial/);
  });

  it('rejects a moveset with a wrong-typed upSpecial', () => {
    const ms = {
      ...buildWolfMoveset(),
      upSpecial: WOLF_DOWN_SPECIAL,
    } as unknown as FighterMoveset;
    expect(() => assertFighterMoveset('wolf', ms)).toThrow(/upSpecial/);
  });

  it('rejects a moveset with a wrong-typed downSpecial', () => {
    const ms = {
      ...buildWolfMoveset(),
      downSpecial: WOLF_UP_SPECIAL,
    } as unknown as FighterMoveset;
    expect(() => assertFighterMoveset('wolf', ms)).toThrow(/downSpecial/);
  });

  it('rejects a moveset with a missing shield tuning', () => {
    const ms = { ...buildWolfMoveset(), shield: null as unknown } as FighterMoveset;
    expect(() => assertFighterMoveset('wolf', ms)).toThrow(/shield/);
  });

  it('rejects a moveset with a missing dodge tuning', () => {
    const ms = { ...buildWolfMoveset(), dodge: null as unknown } as FighterMoveset;
    expect(() => assertFighterMoveset('wolf', ms)).toThrow(/dodge/);
  });
});

// ---------------------------------------------------------------------------
// Slot-count assertions
// ---------------------------------------------------------------------------

describe('slot-count invariants', () => {
  it('assertAttackSlotCount passes', () => {
    expect(() => assertAttackSlotCount()).not.toThrow();
  });
  it('assertDefensiveSlotCount passes', () => {
    expect(() => assertDefensiveSlotCount()).not.toThrow();
  });
  it('assertMovesetSlotCount passes', () => {
    expect(() => assertMovesetSlotCount()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// MovesetSlotOverride — type-only smoke test
// ---------------------------------------------------------------------------

describe('MovesetSlotOverride', () => {
  it('accepts an override targeting any attack slot', () => {
    const overrides: ReadonlyArray<MovesetSlotOverride> = [
      { slot: 'jab', move: WOLF_JAB },
      { slot: 'smash', move: WOLF_SMASH },
      { slot: 'sideSpecial', move: WOLF_SIDE_SPECIAL },
    ];
    expect(overrides).toHaveLength(3);
    for (const o of overrides) {
      expect(isAttackMovesetSlot(o.slot)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Type-level assertions (verified by the compiler)
// ---------------------------------------------------------------------------

// The following tests don't run any runtime assertions — their purpose
// is to lock in the type-level contract so a future regression that
// drops a slot from the union would fail the test build.

// A FighterMoveset must carry every slot name as a key. If a slot is
// missing, this object literal won't compile.
const _exhaustivenessCheck: keyof FighterMoveset = (
  null as unknown as MovesetSlotName
)!;
void _exhaustivenessCheck;

// AttackMovesetSlotName ⊆ MovesetSlotName
const _attackSlotIsMovesetSlot: AttackMovesetSlotName extends MovesetSlotName
  ? true
  : false = true;
void _attackSlotIsMovesetSlot;

// DefensiveMovesetSlotName ⊆ MovesetSlotName
const _defSlotIsMovesetSlot: DefensiveMovesetSlotName extends MovesetSlotName
  ? true
  : false = true;
void _defSlotIsMovesetSlot;

// ---------------------------------------------------------------------------
// Extended attack slots (post-M2 — directional lights + full aerial kit)
// ---------------------------------------------------------------------------

describe('ExtendedAttackMovesetSlotName — taxonomy', () => {
  it('lists exactly 6 extended attack slots', () => {
    expect(EXTENDED_ATTACK_MOVESET_SLOT_NAMES).toHaveLength(
      EXTENDED_ATTACK_MOVESET_SLOT_COUNT,
    );
    expect(EXTENDED_ATTACK_MOVESET_SLOT_COUNT).toBe(6);
  });

  it('lists the canonical names in routing order (lights then aerials)', () => {
    expect([...EXTENDED_ATTACK_MOVESET_SLOT_NAMES]).toEqual([
      'sideLight',
      'upLight',
      'downLight',
      'nair',
      'uair',
      'dair',
    ]);
  });

  it('the slot-name list is frozen', () => {
    expect(Object.isFrozen(EXTENDED_ATTACK_MOVESET_SLOT_NAMES)).toBe(true);
  });

  it('does not overlap with the core 8 attack slots', () => {
    const core = new Set<string>(ATTACK_MOVESET_SLOT_NAMES);
    for (const slot of EXTENDED_ATTACK_MOVESET_SLOT_NAMES) {
      expect(core.has(slot)).toBe(false);
    }
  });

  it('does not overlap with the 2 defensive slots', () => {
    const def = new Set<string>(DEFENSIVE_MOVESET_SLOT_NAMES);
    for (const slot of EXTENDED_ATTACK_MOVESET_SLOT_NAMES) {
      expect(def.has(slot)).toBe(false);
    }
  });

  it('extended slots are absent from MOVESET_SLOT_NAMES (the strict 10-slot core)', () => {
    const coreNames = new Set<string>(MOVESET_SLOT_NAMES);
    for (const slot of EXTENDED_ATTACK_MOVESET_SLOT_NAMES) {
      expect(coreNames.has(slot)).toBe(false);
    }
    // And the strict count remains 10 — extended slots do NOT inflate it.
    expect(MOVESET_SLOT_COUNT).toBe(10);
  });
});
