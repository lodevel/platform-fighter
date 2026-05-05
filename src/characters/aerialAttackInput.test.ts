/**
 * Tests for AC 60201 Sub-AC 1 — airborne state detection + aerial
 * input dispatch.
 *
 * Asserts the pure helper's behaviour directly so the contract can be
 * verified without spinning up a Matter/Phaser scene. The runtime
 * integration (Character.tickAttack delegating to this helper) is
 * covered by the existing `Character.test.ts` "airborne gating" suite —
 * those tests still pass against the post-extraction wiring, locking
 * down the behaviour-preserving refactor.
 */

import { describe, expect, it } from 'vitest';

import {
  AERIAL_STICK_THRESHOLD,
  classifyAerialAttack,
  classifyAerialDirection,
  isStickNeutral,
  type AerialAttackInputSnapshot,
  type AerialAttackSlots,
} from './aerialAttackInput';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FULL_SLOTS: AerialAttackSlots = {
  aerialNeutralId: 'nair',
  aerialForwardId: 'fair',
  aerialBackId: 'bair',
  aerialAttackId: 'legacy_aerial',
  lightAttackId: 'jab',
  defaultId: 'default',
};

const NEUTRAL_ONLY_SLOTS: AerialAttackSlots = {
  aerialNeutralId: 'nair',
  aerialForwardId: null,
  aerialBackId: null,
  aerialAttackId: 'legacy_aerial',
  lightAttackId: 'jab',
  defaultId: 'default',
};

const LEGACY_SINGLE_AERIAL_SLOTS: AerialAttackSlots = {
  // Wolf-style "only WOLF_NAIR registered" — all directional slots
  // null, but the legacy single-aerial slot picks up the move.
  aerialNeutralId: null,
  aerialForwardId: null,
  aerialBackId: null,
  aerialAttackId: 'wolf_nair',
  lightAttackId: 'wolf_jab',
  defaultId: 'wolf_jab',
};

const LIGHT_ONLY_SLOTS: AerialAttackSlots = {
  // Test fighter that only registered a jab — no aerials at all.
  aerialNeutralId: null,
  aerialForwardId: null,
  aerialBackId: null,
  aerialAttackId: null,
  lightAttackId: 'jab',
  defaultId: 'jab',
};

const EMPTY_SLOTS: AerialAttackSlots = {
  aerialNeutralId: null,
  aerialForwardId: null,
  aerialBackId: null,
  aerialAttackId: null,
  lightAttackId: null,
  defaultId: null,
};

function snapshot(
  overrides: Partial<AerialAttackInputSnapshot> = {},
): AerialAttackInputSnapshot {
  return {
    airborne: true,
    attackJustPressed: false,
    heavyJustPressed: false,
    moveX: 0,
    prevFacing: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AERIAL_STICK_THRESHOLD constant
// ---------------------------------------------------------------------------

describe('AERIAL_STICK_THRESHOLD', () => {
  it('is the 0.3 deadzone shared with the grounded classifier', () => {
    expect(AERIAL_STICK_THRESHOLD).toBe(0.3);
  });
});

// ---------------------------------------------------------------------------
// isStickNeutral — pure predicate
// ---------------------------------------------------------------------------

describe('isStickNeutral', () => {
  it('returns true at exact zero', () => {
    expect(isStickNeutral(0)).toBe(true);
  });

  it('returns true within the deadzone', () => {
    expect(isStickNeutral(0.29)).toBe(true);
    expect(isStickNeutral(-0.29)).toBe(true);
  });

  it('returns false at and past the deadzone boundary', () => {
    // |moveX| >= threshold ⇒ NOT neutral. The threshold is exclusive
    // on the neutral side and inclusive on the directional side.
    expect(isStickNeutral(0.3)).toBe(false);
    expect(isStickNeutral(-0.3)).toBe(false);
    expect(isStickNeutral(1)).toBe(false);
    expect(isStickNeutral(-1)).toBe(false);
  });

  it('honours a custom threshold', () => {
    expect(isStickNeutral(0.4, 0.5)).toBe(true);
    expect(isStickNeutral(0.5, 0.5)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyAerialDirection — direction classifier
// ---------------------------------------------------------------------------

describe('classifyAerialDirection', () => {
  it('classifies stick-at-rest as neutral regardless of facing', () => {
    expect(classifyAerialDirection(0, 1)).toBe('neutral');
    expect(classifyAerialDirection(0, -1)).toBe('neutral');
    expect(classifyAerialDirection(0.1, 1)).toBe('neutral');
    expect(classifyAerialDirection(-0.1, -1)).toBe('neutral');
  });

  it('classifies stick-toward-facing as forward', () => {
    expect(classifyAerialDirection(1, 1)).toBe('forward');
    expect(classifyAerialDirection(0.5, 1)).toBe('forward');
    expect(classifyAerialDirection(-1, -1)).toBe('forward');
    expect(classifyAerialDirection(-0.5, -1)).toBe('forward');
  });

  it('classifies stick-against-facing as back', () => {
    expect(classifyAerialDirection(-1, 1)).toBe('back');
    expect(classifyAerialDirection(-0.5, 1)).toBe('back');
    expect(classifyAerialDirection(1, -1)).toBe('back');
    expect(classifyAerialDirection(0.5, -1)).toBe('back');
  });
});

// ---------------------------------------------------------------------------
// Aerial gate — airborne === false ⇒ no dispatch
// ---------------------------------------------------------------------------

describe('classifyAerialAttack — airborne gate', () => {
  it('returns null when grounded even with a light press + held stick', () => {
    // The runtime never calls this helper for grounded presses (the
    // grounded classifier handles those), but the gate defends the
    // contract anyway so AI / replay re-drivers cannot accidentally
    // fire an aerial from a grounded press.
    const result = classifyAerialAttack(
      snapshot({
        airborne: false,
        attackJustPressed: true,
        moveX: 1,
      }),
      FULL_SLOTS,
    );
    expect(result).toBeNull();
  });

  it('returns null when grounded with a heavy press', () => {
    const result = classifyAerialAttack(
      snapshot({ airborne: false, heavyJustPressed: true }),
      FULL_SLOTS,
    );
    expect(result).toBeNull();
  });

  it('returns null when grounded with no press at all', () => {
    const result = classifyAerialAttack(
      snapshot({ airborne: false }),
      FULL_SLOTS,
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Heavy press while airborne is silently dropped
// ---------------------------------------------------------------------------

describe('classifyAerialAttack — heavy press handling', () => {
  it('returns null when only heavy is pressed in air', () => {
    // Smashes are grounded moves — heavy press while airborne is
    // intentionally a no-op.
    const result = classifyAerialAttack(
      snapshot({ heavyJustPressed: true, attackJustPressed: false, moveX: 1 }),
      FULL_SLOTS,
    );
    expect(result).toBeNull();
  });

  it('still fires the aerial when both light AND heavy press the same frame', () => {
    // Light takes precedence — the airborne classifier reads
    // `attackJustPressed`, not `heavyJustPressed`, when picking a
    // direction. Heavy is "additionally" dropped.
    const result = classifyAerialAttack(
      snapshot({
        attackJustPressed: true,
        heavyJustPressed: true,
        moveX: 0,
      }),
      FULL_SLOTS,
    );
    expect(result).toEqual({ moveId: 'nair', direction: 'neutral' });
  });
});

// ---------------------------------------------------------------------------
// No press → no dispatch
// ---------------------------------------------------------------------------

describe('classifyAerialAttack — no press', () => {
  it('returns null when neither button rose this frame', () => {
    const result = classifyAerialAttack(snapshot({ moveX: 1 }), FULL_SLOTS);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Directional dispatch — neutral / forward / back
// ---------------------------------------------------------------------------

describe('classifyAerialAttack — directional dispatch', () => {
  it('neutral stick → nair', () => {
    const result = classifyAerialAttack(
      snapshot({ attackJustPressed: true, moveX: 0 }),
      FULL_SLOTS,
    );
    expect(result).toEqual({ moveId: 'nair', direction: 'neutral' });
  });

  it('stick toward facing (right) → fair', () => {
    const result = classifyAerialAttack(
      snapshot({ attackJustPressed: true, moveX: 1, prevFacing: 1 }),
      FULL_SLOTS,
    );
    expect(result).toEqual({ moveId: 'fair', direction: 'forward' });
  });

  it('stick toward facing (left) → fair', () => {
    const result = classifyAerialAttack(
      snapshot({ attackJustPressed: true, moveX: -1, prevFacing: -1 }),
      FULL_SLOTS,
    );
    expect(result).toEqual({ moveId: 'fair', direction: 'forward' });
  });

  it('stick against facing (right-facing, stick left) → bair', () => {
    const result = classifyAerialAttack(
      snapshot({ attackJustPressed: true, moveX: -1, prevFacing: 1 }),
      FULL_SLOTS,
    );
    expect(result).toEqual({ moveId: 'bair', direction: 'back' });
  });

  it('stick against facing (left-facing, stick right) → bair', () => {
    const result = classifyAerialAttack(
      snapshot({ attackJustPressed: true, moveX: 1, prevFacing: -1 }),
      FULL_SLOTS,
    );
    expect(result).toEqual({ moveId: 'bair', direction: 'back' });
  });

  it('stick at deadzone boundary classifies relative to the threshold', () => {
    // Below 0.3 ⇒ neutral.
    expect(
      classifyAerialAttack(
        snapshot({ attackJustPressed: true, moveX: 0.29, prevFacing: 1 }),
        FULL_SLOTS,
      ),
    ).toEqual({ moveId: 'nair', direction: 'neutral' });
    // At/above 0.3 ⇒ directional.
    expect(
      classifyAerialAttack(
        snapshot({ attackJustPressed: true, moveX: 0.3, prevFacing: 1 }),
        FULL_SLOTS,
      ),
    ).toEqual({ moveId: 'fair', direction: 'forward' });
  });
});

// ---------------------------------------------------------------------------
// Cascading fallback — partial movesets keep firing
// ---------------------------------------------------------------------------

describe('classifyAerialAttack — cascading fallback', () => {
  it('forward press with no fair slot falls back to nair', () => {
    const result = classifyAerialAttack(
      snapshot({ attackJustPressed: true, moveX: 1, prevFacing: 1 }),
      NEUTRAL_ONLY_SLOTS,
    );
    expect(result).toEqual({ moveId: 'nair', direction: 'forward' });
  });

  it('back press with no bair slot falls back to nair', () => {
    const result = classifyAerialAttack(
      snapshot({ attackJustPressed: true, moveX: -1, prevFacing: 1 }),
      NEUTRAL_ONLY_SLOTS,
    );
    expect(result).toEqual({ moveId: 'nair', direction: 'back' });
  });

  it('legacy single-aerial roster fires its aerial on every directional press', () => {
    // Wolf-style: only `WOLF_NAIR` registered. All directional slots
    // are null but `aerialAttackId` carries the move.
    expect(
      classifyAerialAttack(
        snapshot({ attackJustPressed: true, moveX: 0, prevFacing: 1 }),
        LEGACY_SINGLE_AERIAL_SLOTS,
      ),
    ).toEqual({ moveId: 'wolf_nair', direction: 'neutral' });
    expect(
      classifyAerialAttack(
        snapshot({ attackJustPressed: true, moveX: 1, prevFacing: 1 }),
        LEGACY_SINGLE_AERIAL_SLOTS,
      ),
    ).toEqual({ moveId: 'wolf_nair', direction: 'forward' });
    expect(
      classifyAerialAttack(
        snapshot({ attackJustPressed: true, moveX: -1, prevFacing: 1 }),
        LEGACY_SINGLE_AERIAL_SLOTS,
      ),
    ).toEqual({ moveId: 'wolf_nair', direction: 'back' });
  });

  it('roster with no aerials at all falls back to the light/jab slot', () => {
    // A test fighter that only registered a jab.
    const result = classifyAerialAttack(
      snapshot({ attackJustPressed: true, moveX: 0 }),
      LIGHT_ONLY_SLOTS,
    );
    expect(result).toEqual({ moveId: 'jab', direction: 'neutral' });
  });

  it('returns null when every cascade fallback is empty', () => {
    const result = classifyAerialAttack(
      snapshot({ attackJustPressed: true, moveX: 0 }),
      EMPTY_SLOTS,
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Determinism — pure function contract
// ---------------------------------------------------------------------------

describe('classifyAerialAttack — determinism', () => {
  it('identical (snapshot, slots) triples return identical results', () => {
    const snap = snapshot({ attackJustPressed: true, moveX: 0.7, prevFacing: 1 });
    const a = classifyAerialAttack(snap, FULL_SLOTS);
    const b = classifyAerialAttack(snap, FULL_SLOTS);
    const c = classifyAerialAttack(snap, FULL_SLOTS);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('honours a custom stick threshold', () => {
    // With threshold 0.5, |moveX|=0.4 reads as neutral.
    const snap = snapshot({ attackJustPressed: true, moveX: 0.4, prevFacing: 1 });
    expect(classifyAerialAttack(snap, FULL_SLOTS, { stickThreshold: 0.5 })).toEqual({
      moveId: 'nair',
      direction: 'neutral',
    });
    // Default threshold treats 0.4 as a forward press.
    expect(classifyAerialAttack(snap, FULL_SLOTS)).toEqual({
      moveId: 'fair',
      direction: 'forward',
    });
  });
});
