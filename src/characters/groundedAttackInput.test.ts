/**
 * Unit tests for the grounded normal-move input dispatcher
 * (AC 60101 Sub-AC 1).
 *
 * What this suite locks down:
 *
 *   1. Pattern classification — given a snapshot and a slot table, the
 *      dispatcher returns the right move id for jab / tilt / smash
 *      input patterns.
 *   2. Threshold tuning — the neutral / flick / rest thresholds split
 *      "stick at rest" / "stick held" / "smash flick" exactly where
 *      the constants say they do.
 *   3. Cascading fallbacks — when a slot is empty, the helper falls
 *      through to the documented fallback in the cascade order, so a
 *      single-move test fighter (only `jabId`) keeps firing on every
 *      grounded press regardless of stick input.
 *   4. Determinism — identical (snapshot, slots, tuning) triples
 *      produce identical dispatch decisions on every call.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyGroundedAttack,
  isSmashFlick,
  isStickHeld,
  DEFAULT_NEUTRAL_THRESHOLD,
  DEFAULT_FLICK_REST_THRESHOLD,
  type GroundedAttackInputSnapshot,
  type GroundedAttackSlots,
} from './groundedAttackInput';

const FULL_SLOTS: GroundedAttackSlots = {
  jabId: 'wolf.jab',
  tiltId: 'wolf.tilt',
  smashId: 'wolf.smash',
  defaultId: 'wolf.jab',
};

function snap(partial: Partial<GroundedAttackInputSnapshot> = {}): GroundedAttackInputSnapshot {
  return {
    attackJustPressed: false,
    heavyJustPressed: false,
    moveX: 0,
    prevMoveX: 0,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Pure predicates
// ---------------------------------------------------------------------------

describe('isStickHeld — neutral deadzone classifier', () => {
  it('returns false at the deadzone exactly... no, returns true at threshold and above', () => {
    // The function uses `>=` so the threshold itself counts as held.
    expect(isStickHeld(DEFAULT_NEUTRAL_THRESHOLD)).toBe(true);
    expect(isStickHeld(-DEFAULT_NEUTRAL_THRESHOLD)).toBe(true);
  });

  it('returns false for stick values below the deadzone', () => {
    expect(isStickHeld(0)).toBe(false);
    expect(isStickHeld(0.1)).toBe(false);
    expect(isStickHeld(-0.29)).toBe(false);
  });

  it('returns true for full deflection in either direction', () => {
    expect(isStickHeld(1)).toBe(true);
    expect(isStickHeld(-1)).toBe(true);
  });

  it('honours a custom neutral threshold', () => {
    expect(isStickHeld(0.4, 0.5)).toBe(false);
    expect(isStickHeld(0.5, 0.5)).toBe(true);
  });
});

describe('isSmashFlick — rest → flick predicate', () => {
  it('detects a clean rest → flick transition (positive)', () => {
    expect(isSmashFlick(0, 1)).toBe(true);
  });

  it('detects a clean rest → flick transition (negative)', () => {
    expect(isSmashFlick(0, -0.9)).toBe(true);
  });

  it('treats a previously-held stick as ineligible (no flick)', () => {
    // prevMoveX > restThreshold means the stick wasn't at rest.
    expect(isSmashFlick(0.5, 1)).toBe(false);
  });

  it('treats a sub-flick deflection as no flick', () => {
    // moveX below the smash flick threshold is a tilt, not a smash.
    expect(isSmashFlick(0, 0.5)).toBe(false);
  });

  it('a stick held just inside the rest threshold can still flick', () => {
    expect(isSmashFlick(DEFAULT_FLICK_REST_THRESHOLD, 1)).toBe(true);
  });

  it('a stick held just above the rest threshold cannot flick', () => {
    expect(isSmashFlick(DEFAULT_FLICK_REST_THRESHOLD + 0.01, 1)).toBe(false);
  });

  it('honours custom thresholds', () => {
    // Custom: anything past 0.4 is a flick if previous was at rest below 0.1.
    expect(isSmashFlick(0.05, 0.5, 0.4, 0.1)).toBe(true);
    expect(isSmashFlick(0.2, 0.5, 0.4, 0.1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Classifier — the three patterns
// ---------------------------------------------------------------------------

describe('classifyGroundedAttack — jab / tilt / smash dispatch', () => {
  // ---- No press ---------------------------------------------------------

  it('returns null when no rising-edge press happened this frame', () => {
    expect(
      classifyGroundedAttack(
        snap({ attackJustPressed: false, heavyJustPressed: false }),
        FULL_SLOTS,
      ),
    ).toBeNull();
  });

  it('returns null when neither stick nor button changed (held inputs)', () => {
    // A held button → caller flags `attackJustPressed=false`. Nothing fires.
    expect(
      classifyGroundedAttack(
        snap({ attackJustPressed: false, moveX: 1, prevMoveX: 1 }),
        FULL_SLOTS,
      ),
    ).toBeNull();
  });

  // ---- Jab pattern ------------------------------------------------------

  it('neutral attack press + neutral stick → jab', () => {
    const result = classifyGroundedAttack(
      snap({ attackJustPressed: true, moveX: 0 }),
      FULL_SLOTS,
    );
    expect(result).toEqual({ moveId: 'wolf.jab', pattern: 'jab' });
  });

  it('neutral attack press + sub-deadzone deflection → jab (drift tolerance)', () => {
    const result = classifyGroundedAttack(
      snap({ attackJustPressed: true, moveX: 0.2, prevMoveX: 0.2 }),
      FULL_SLOTS,
    );
    expect(result).toEqual({ moveId: 'wolf.jab', pattern: 'jab' });
  });

  // ---- Tilt pattern -----------------------------------------------------

  it('directional tap (stick held + attack press, no flick) → tilt', () => {
    const result = classifyGroundedAttack(
      // prevMoveX held at the same deflection so the flick predicate fails.
      snap({ attackJustPressed: true, moveX: 0.5, prevMoveX: 0.5 }),
      FULL_SLOTS,
    );
    expect(result).toEqual({ moveId: 'wolf.tilt', pattern: 'tilt' });
  });

  it('tilt classifies on negative-direction holds too', () => {
    const result = classifyGroundedAttack(
      snap({ attackJustPressed: true, moveX: -0.5, prevMoveX: -0.5 }),
      FULL_SLOTS,
    );
    expect(result).toEqual({ moveId: 'wolf.tilt', pattern: 'tilt' });
  });

  it('tilt at sub-flick deflection (50%) does not become smash', () => {
    // A held lean below the flick threshold but above neutral — tilt.
    const result = classifyGroundedAttack(
      snap({ attackJustPressed: true, moveX: 0.6, prevMoveX: 0.6 }),
      FULL_SLOTS,
    );
    expect(result?.pattern).toBe('tilt');
  });

  // ---- Smash pattern ----------------------------------------------------

  it('dedicated heavy button press → smash', () => {
    const result = classifyGroundedAttack(
      snap({ heavyJustPressed: true }),
      FULL_SLOTS,
    );
    expect(result).toEqual({ moveId: 'wolf.smash', pattern: 'smash' });
  });

  it('smash flick (rest → full deflection) on light press → smash', () => {
    const result = classifyGroundedAttack(
      snap({ attackJustPressed: true, moveX: 1, prevMoveX: 0 }),
      FULL_SLOTS,
    );
    expect(result).toEqual({ moveId: 'wolf.smash', pattern: 'smash' });
  });

  it('smash flick from the negative side fires smash too', () => {
    const result = classifyGroundedAttack(
      snap({ attackJustPressed: true, moveX: -0.85, prevMoveX: 0 }),
      FULL_SLOTS,
    );
    expect(result).toEqual({ moveId: 'wolf.smash', pattern: 'smash' });
  });

  it('a held lean above the rest threshold cannot become a flick by pushing further', () => {
    // prevMoveX = 0.5 (already past the rest threshold 0.3), so even a
    // full deflection this frame is a tilt, not a smash.
    const result = classifyGroundedAttack(
      snap({ attackJustPressed: true, moveX: 1, prevMoveX: 0.5 }),
      FULL_SLOTS,
    );
    expect(result?.pattern).toBe('tilt');
  });

  // ---- Heavy + light press in the same frame: heavy wins ---------------

  it('when both attack and heavy rise the same frame, heavy wins', () => {
    const result = classifyGroundedAttack(
      snap({ attackJustPressed: true, heavyJustPressed: true, moveX: 0 }),
      FULL_SLOTS,
    );
    expect(result?.pattern).toBe('smash');
    expect(result?.moveId).toBe('wolf.smash');
  });
});

// ---------------------------------------------------------------------------
// Cascading fallbacks
// ---------------------------------------------------------------------------

describe('classifyGroundedAttack — cascading fallbacks', () => {
  it('tilt cascades to jab when the tilt slot is empty', () => {
    const slots: GroundedAttackSlots = {
      jabId: 'jab.id',
      tiltId: null,
      smashId: 'smash.id',
      defaultId: 'jab.id',
    };
    const result = classifyGroundedAttack(
      snap({ attackJustPressed: true, moveX: 0.5, prevMoveX: 0.5 }),
      slots,
    );
    // No tilt → falls back to jab. Pattern still reads `tilt` because
    // the input matched the directional-tap pattern.
    expect(result).toEqual({ moveId: 'jab.id', pattern: 'tilt' });
  });

  it('jab cascades to default when the jab slot is empty', () => {
    const slots: GroundedAttackSlots = {
      jabId: null,
      tiltId: null,
      smashId: null,
      defaultId: 'fallback.id',
    };
    const result = classifyGroundedAttack(
      snap({ attackJustPressed: true, moveX: 0 }),
      slots,
    );
    expect(result).toEqual({ moveId: 'fallback.id', pattern: 'jab' });
  });

  it('smash flick cascades through tilt → jab when smash slot is empty', () => {
    const slots: GroundedAttackSlots = {
      jabId: 'only.jab',
      tiltId: null,
      smashId: null,
      defaultId: 'only.jab',
    };
    const result = classifyGroundedAttack(
      snap({ attackJustPressed: true, moveX: 1, prevMoveX: 0 }),
      slots,
    );
    // Roster ships only jab — flick still fires it (pattern downgraded).
    expect(result).toEqual({ moveId: 'only.jab', pattern: 'tilt' });
  });

  it('dedicated heavy press is NOT downgraded to jab when smash slot is empty', () => {
    // Heavy is an explicit "fire smash only" trigger — silently firing
    // jab would surprise rosters that deliberately skip the smash slot.
    const slots: GroundedAttackSlots = {
      jabId: 'jab.id',
      tiltId: null,
      smashId: null,
      defaultId: 'jab.id',
    };
    const result = classifyGroundedAttack(
      snap({ heavyJustPressed: true }),
      slots,
    );
    expect(result).toBeNull();
  });

  it('every slot empty + press → null', () => {
    const slots: GroundedAttackSlots = {
      jabId: null,
      tiltId: null,
      smashId: null,
      defaultId: null,
    };
    expect(
      classifyGroundedAttack(snap({ attackJustPressed: true }), slots),
    ).toBeNull();
    expect(
      classifyGroundedAttack(snap({ heavyJustPressed: true }), slots),
    ).toBeNull();
    expect(
      classifyGroundedAttack(
        snap({ attackJustPressed: true, moveX: 1, prevMoveX: 0 }),
        slots,
      ),
    ).toBeNull();
  });

  it('single-jab roster fires jab on every directional press too', () => {
    // The classic "test fighter with one move" — every input class
    // should resolve to jab for backwards compat.
    const slots: GroundedAttackSlots = {
      jabId: 'mono.jab',
      tiltId: null,
      smashId: null,
      defaultId: 'mono.jab',
    };
    const neutral = classifyGroundedAttack(
      snap({ attackJustPressed: true }),
      slots,
    );
    expect(neutral?.moveId).toBe('mono.jab');

    const tilt = classifyGroundedAttack(
      snap({ attackJustPressed: true, moveX: 0.5, prevMoveX: 0.5 }),
      slots,
    );
    expect(tilt?.moveId).toBe('mono.jab');

    const flick = classifyGroundedAttack(
      snap({ attackJustPressed: true, moveX: 1, prevMoveX: 0 }),
      slots,
    );
    expect(flick?.moveId).toBe('mono.jab');
  });
});

// ---------------------------------------------------------------------------
// Threshold tuning overrides
// ---------------------------------------------------------------------------

describe('classifyGroundedAttack — tuning overrides', () => {
  it('a custom neutral threshold reroutes a sub-default deflection from jab to tilt', () => {
    // Below default 0.3 — jab. Custom threshold 0.1 — tilt.
    const press = snap({ attackJustPressed: true, moveX: 0.2, prevMoveX: 0.2 });
    expect(classifyGroundedAttack(press, FULL_SLOTS)?.pattern).toBe('jab');
    expect(
      classifyGroundedAttack(press, FULL_SLOTS, { neutralThreshold: 0.1 })?.pattern,
    ).toBe('tilt');
  });

  it('a custom flick threshold reclassifies a half-deflection as a smash', () => {
    // Default flick threshold 0.7 — half-deflection is a tilt. Custom 0.4 — smash.
    const press = snap({ attackJustPressed: true, moveX: 0.5, prevMoveX: 0 });
    expect(classifyGroundedAttack(press, FULL_SLOTS)?.pattern).toBe('tilt');
    expect(
      classifyGroundedAttack(press, FULL_SLOTS, { smashFlickThreshold: 0.4 })
        ?.pattern,
    ).toBe('smash');
  });

  it('a custom rest threshold gates the flick predicate independently', () => {
    // Default rest threshold 0.3 — pre-held lean of 0.4 is too high.
    // Custom 0.5 — same lean qualifies as rest.
    const press = snap({ attackJustPressed: true, moveX: 1, prevMoveX: 0.4 });
    expect(classifyGroundedAttack(press, FULL_SLOTS)?.pattern).toBe('tilt');
    expect(
      classifyGroundedAttack(press, FULL_SLOTS, { flickRestThreshold: 0.5 })
        ?.pattern,
    ).toBe('smash');
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('classifyGroundedAttack — determinism', () => {
  it('identical (snapshot, slots, tuning) tuples produce identical dispatches', () => {
    const press = snap({ attackJustPressed: true, moveX: 0.6, prevMoveX: 0 });
    const a = classifyGroundedAttack(press, FULL_SLOTS);
    const b = classifyGroundedAttack(press, FULL_SLOTS);
    const c = classifyGroundedAttack(press, FULL_SLOTS);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('a synthesised input stream produces the same dispatch sequence on replay', () => {
    // Mimic a 5-frame "neutral, lean, smash flick, lean, release" press
    // pattern. Every call is a pure function — running twice produces
    // identical outputs.
    const stream: GroundedAttackInputSnapshot[] = [
      { attackJustPressed: true, heavyJustPressed: false, moveX: 0, prevMoveX: 0 },
      { attackJustPressed: false, heavyJustPressed: false, moveX: 0.4, prevMoveX: 0 },
      // attack rises again with a flick — this is the smash press.
      { attackJustPressed: true, heavyJustPressed: false, moveX: 1, prevMoveX: 0 },
      { attackJustPressed: false, heavyJustPressed: false, moveX: 1, prevMoveX: 1 },
      { attackJustPressed: false, heavyJustPressed: false, moveX: 0, prevMoveX: 1 },
    ];
    const expected = stream.map((s) => classifyGroundedAttack(s, FULL_SLOTS));
    const replayed = stream.map((s) => classifyGroundedAttack(s, FULL_SLOTS));
    expect(replayed).toEqual(expected);
    // Sanity check the expected sequence: jab, none, smash, none, none.
    expect(expected[0]?.pattern).toBe('jab');
    expect(expected[1]).toBeNull();
    expect(expected[2]?.pattern).toBe('smash');
    expect(expected[3]).toBeNull();
    expect(expected[4]).toBeNull();
  });
});
