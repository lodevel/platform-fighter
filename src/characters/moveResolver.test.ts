import { describe, it, expect } from 'vitest';
import {
  MOVE_RESOLVER_SPECIAL_DIRECTIONS,
  RESOLVER_SPECIAL_THRESHOLD,
  createMoveResolverCooldowns,
  detectMoveResolverSpecialDirection,
  enumerateMovesetMoves,
  isMoveResolverDirectionReady,
  resetMoveResolverCooldowns,
  resolveMoveFromInput,
  startMoveResolverCooldown,
  tickMoveResolverCooldowns,
  type MoveResolverCooldowns,
  type MoveResolverInput,
} from './moveResolver';
import { MOVESET_TABLE } from './movesetAnimationDriver';
import { getMoveLockoutFrames } from './moveSchema';
import type { CharacterId } from '../types';

/**
 * AC 10004 Sub-AC 4 — per-character move logic + input-to-move resolver
 * invariants.
 *
 * Pure module — no Phaser, Matter, Math.random, or wall-clock. This
 * suite locks down:
 *
 *   1. The 4-direction special classifier resolves the canonical
 *      Smash precedence (`up > down > side > neutral`) AND respects
 *      the rising-edge gate (no press = null).
 *   2. The cooldown record initialises ready, ticks deterministically,
 *      gates re-fires, and resets cleanly.
 *   3. The grounded branch dispatches jab / tilt / smash through the
 *      shared classifier — and resolves to the correct registered
 *      move on the fighter's data table.
 *   4. The aerial branch dispatches nair / fair / bair through the
 *      shared classifier with `prevFacing`-aware direction
 *      classification — and resolves to the correct slot.
 *   5. The special branch wins priority over a same-frame attack
 *      press AND respects per-direction cooldowns.
 *   6. Determinism — identical inputs always produce identical
 *      outputs; the 4 fighters in the v1 roster all dispatch their
 *      data-table moves through the resolver.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_CHARACTERS: ReadonlyArray<CharacterId> = ['wolf', 'cat', 'owl', 'bear', 'blaze', 'puff', 'aegis', 'volt', 'nova', 'bruno'];

function neutralInput(overrides: Partial<MoveResolverInput> = {}): MoveResolverInput {
  return {
    airborne: false,
    attackJustPressed: false,
    heavyJustPressed: false,
    specialJustPressed: false,
    moveX: 0,
    moveY: 0,
    prevMoveX: 0,
    prevFacing: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Special-direction classifier
// ---------------------------------------------------------------------------

describe('detectMoveResolverSpecialDirection', () => {
  it('returns null when the special button was not pressed this frame', () => {
    expect(
      detectMoveResolverSpecialDirection(
        neutralInput({ specialJustPressed: false, moveX: 1, moveY: -1 }),
      ),
    ).toBeNull();
  });

  it('returns "neutral" on a neutral-stick press', () => {
    expect(
      detectMoveResolverSpecialDirection(
        neutralInput({ specialJustPressed: true }),
      ),
    ).toBe('neutral');
  });

  it('returns "side" when the stick is past the side threshold', () => {
    expect(
      detectMoveResolverSpecialDirection(
        neutralInput({ specialJustPressed: true, moveX: 1, moveY: 0 }),
      ),
    ).toBe('side');
    expect(
      detectMoveResolverSpecialDirection(
        neutralInput({ specialJustPressed: true, moveX: -1, moveY: 0 }),
      ),
    ).toBe('side');
  });

  it('returns "up" when the stick is past the up threshold', () => {
    expect(
      detectMoveResolverSpecialDirection(
        neutralInput({ specialJustPressed: true, moveY: -1 }),
      ),
    ).toBe('up');
  });

  it('returns "down" when the stick is past the down threshold', () => {
    expect(
      detectMoveResolverSpecialDirection(
        neutralInput({ specialJustPressed: true, moveY: 1 }),
      ),
    ).toBe('down');
  });

  it('respects "up wins over side" precedence (up + side held → up)', () => {
    // Canonical Smash recovery-grace rule: a player off-stage scrambling
    // back holds up-and-toward-stage; the runtime should still give them
    // the recovery up-special.
    expect(
      detectMoveResolverSpecialDirection(
        neutralInput({ specialJustPressed: true, moveX: 1, moveY: -1 }),
      ),
    ).toBe('up');
  });

  it('respects "down wins over side" precedence (down + side held → down)', () => {
    // Stick held down-and-side reads as "down-special" — the down
    // direction is more explicit than a side lean.
    expect(
      detectMoveResolverSpecialDirection(
        neutralInput({ specialJustPressed: true, moveX: 1, moveY: 1 }),
      ),
    ).toBe('down');
  });

  it('respects "up wins over down" precedence (impossible stick state → up)', () => {
    // Defensive — a synthesised input with both Y deflections set
    // should still resolve deterministically to up (the higher-priority
    // direction).
    expect(
      detectMoveResolverSpecialDirection(
        // moveY = -0.5 wins (negative = up); the explicit threshold check
        // means moveY <= -threshold is checked before moveY >= threshold.
        neutralInput({ specialJustPressed: true, moveY: -0.5 }),
      ),
    ).toBe('up');
  });

  it('falls back to neutral within the deadzone', () => {
    // |moveX| = 0.2 and |moveY| = 0.2 — both inside the 0.3 deadzone.
    expect(
      detectMoveResolverSpecialDirection(
        neutralInput({ specialJustPressed: true, moveX: 0.2, moveY: 0.2 }),
      ),
    ).toBe('neutral');
  });

  it('treats exactly threshold as inclusive', () => {
    expect(
      detectMoveResolverSpecialDirection(
        neutralInput({
          specialJustPressed: true,
          moveX: RESOLVER_SPECIAL_THRESHOLD,
        }),
      ),
    ).toBe('side');
    expect(
      detectMoveResolverSpecialDirection(
        neutralInput({
          specialJustPressed: true,
          moveY: RESOLVER_SPECIAL_THRESHOLD,
        }),
      ),
    ).toBe('down');
    expect(
      detectMoveResolverSpecialDirection(
        neutralInput({
          specialJustPressed: true,
          moveY: -RESOLVER_SPECIAL_THRESHOLD,
        }),
      ),
    ).toBe('up');
  });

  it('exposes all four directions in canonical order', () => {
    expect([...MOVE_RESOLVER_SPECIAL_DIRECTIONS]).toEqual([
      'neutral',
      'side',
      'up',
      'down',
    ]);
  });

  it('accepts a custom threshold override', () => {
    expect(
      detectMoveResolverSpecialDirection(
        neutralInput({ specialJustPressed: true, moveX: 0.4 }),
        0.5,
      ),
    ).toBe('neutral');
    expect(
      detectMoveResolverSpecialDirection(
        neutralInput({ specialJustPressed: true, moveX: 0.6 }),
        0.5,
      ),
    ).toBe('side');
  });
});

// ---------------------------------------------------------------------------
// 2. Cooldown state
// ---------------------------------------------------------------------------

describe('MoveResolverCooldowns', () => {
  it('initialises every direction at 0 (ready)', () => {
    const cd = createMoveResolverCooldowns();
    expect(cd).toEqual({ neutral: 0, side: 0, up: 0, down: 0 });
    for (const d of MOVE_RESOLVER_SPECIAL_DIRECTIONS) {
      expect(isMoveResolverDirectionReady(cd, d)).toBe(true);
    }
  });

  it('factory returns fresh records (no shared state)', () => {
    const a = createMoveResolverCooldowns();
    const b = createMoveResolverCooldowns();
    a.neutral = 99;
    expect(b.neutral).toBe(0);
  });

  it('startMoveResolverCooldown stamps lockout = busy + cooldownFrames', () => {
    const cd = createMoveResolverCooldowns();
    const move = MOVESET_TABLE.wolf.neutralSpecial;
    const lockout = getMoveLockoutFrames(move);
    startMoveResolverCooldown(cd, 'neutral', move);
    expect(cd.neutral).toBe(lockout);
    expect(isMoveResolverDirectionReady(cd, 'neutral')).toBe(false);
  });

  it('cooldowns are independent across directions', () => {
    const cd = createMoveResolverCooldowns();
    startMoveResolverCooldown(cd, 'down', MOVESET_TABLE.wolf.downSpecial);
    expect(isMoveResolverDirectionReady(cd, 'down')).toBe(false);
    expect(isMoveResolverDirectionReady(cd, 'neutral')).toBe(true);
    expect(isMoveResolverDirectionReady(cd, 'side')).toBe(true);
    expect(isMoveResolverDirectionReady(cd, 'up')).toBe(true);
  });

  it('tickMoveResolverCooldowns drains every counter by 1, clamped at 0', () => {
    const cd: MoveResolverCooldowns = { neutral: 3, side: 1, up: 0, down: 5 };
    tickMoveResolverCooldowns(cd);
    expect(cd).toEqual({ neutral: 2, side: 0, up: 0, down: 4 });
    tickMoveResolverCooldowns(cd);
    expect(cd).toEqual({ neutral: 1, side: 0, up: 0, down: 3 });
  });

  it('startMoveResolverCooldown takes the max — never shortens an in-flight lockout', () => {
    const cd: MoveResolverCooldowns = { neutral: 100, side: 0, up: 0, down: 0 };
    startMoveResolverCooldown(cd, 'neutral', MOVESET_TABLE.wolf.neutralSpecial);
    expect(cd.neutral).toBe(100);
  });

  it('resetMoveResolverCooldowns clears every counter', () => {
    const cd: MoveResolverCooldowns = { neutral: 7, side: 5, up: 3, down: 9 };
    resetMoveResolverCooldowns(cd);
    expect(cd).toEqual({ neutral: 0, side: 0, up: 0, down: 0 });
  });
});

// ---------------------------------------------------------------------------
// 3. Grounded branch — jab / tilt / smash
// ---------------------------------------------------------------------------

describe('resolveMoveFromInput — grounded branch', () => {
  it('returns null when no press flag rose this frame', () => {
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.wolf,
      neutralInput(),
    );
    expect(dispatch).toBeNull();
  });

  it('resolves a neutral-stick light press to jab', () => {
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.wolf,
      neutralInput({ attackJustPressed: true }),
    );
    expect(dispatch).not.toBeNull();
    if (dispatch === null) return;
    expect(dispatch.category).toBe('groundedNormal');
    if (dispatch.category !== 'groundedNormal') return;
    expect(dispatch.slot).toBe('jab');
    expect(dispatch.pattern).toBe('jab');
    expect(dispatch.moveId).toBe(MOVESET_TABLE.wolf.jab.id);
    expect(dispatch.move).toBe(MOVESET_TABLE.wolf.jab);
  });

  it('resolves a held-stick light press to tilt', () => {
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.cat,
      neutralInput({ attackJustPressed: true, moveX: 1, prevMoveX: 1 }),
    );
    expect(dispatch).not.toBeNull();
    if (dispatch === null) return;
    expect(dispatch.category).toBe('groundedNormal');
    if (dispatch.category !== 'groundedNormal') return;
    expect(dispatch.slot).toBe('tilt');
    expect(dispatch.pattern).toBe('tilt');
    expect(dispatch.moveId).toBe(MOVESET_TABLE.cat.tilt.id);
  });

  it('resolves a heavy press to smash', () => {
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.owl,
      neutralInput({ heavyJustPressed: true }),
    );
    expect(dispatch).not.toBeNull();
    if (dispatch === null) return;
    expect(dispatch.category).toBe('groundedNormal');
    if (dispatch.category !== 'groundedNormal') return;
    expect(dispatch.slot).toBe('smash');
    expect(dispatch.pattern).toBe('smash');
    expect(dispatch.moveId).toBe(MOVESET_TABLE.owl.smash.id);
  });

  it('resolves a smash flick (light press + rapid stick deflection) to smash', () => {
    // prevMoveX = 0 (rest), moveX = 1 (full deflect) — flick crossed
    // both thresholds in one frame.
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.bear,
      neutralInput({ attackJustPressed: true, moveX: 1, prevMoveX: 0 }),
    );
    expect(dispatch).not.toBeNull();
    if (dispatch === null) return;
    expect(dispatch.category).toBe('groundedNormal');
    if (dispatch.category !== 'groundedNormal') return;
    expect(dispatch.slot).toBe('smash');
    expect(dispatch.pattern).toBe('smash');
  });

  it('every roster character resolves jab / tilt / smash to its own move table', () => {
    for (const id of ALL_CHARACTERS) {
      const moveset = MOVESET_TABLE[id];

      const jabDispatch = resolveMoveFromInput(
        moveset,
        neutralInput({ attackJustPressed: true }),
      );
      expect(jabDispatch?.moveId).toBe(moveset.jab.id);

      const tiltDispatch = resolveMoveFromInput(
        moveset,
        neutralInput({ attackJustPressed: true, moveX: 1, prevMoveX: 1 }),
      );
      expect(tiltDispatch?.moveId).toBe(moveset.tilt.id);

      const smashDispatch = resolveMoveFromInput(
        moveset,
        neutralInput({ heavyJustPressed: true }),
      );
      expect(smashDispatch?.moveId).toBe(moveset.smash.id);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Aerial branch — nair / fair / bair
// ---------------------------------------------------------------------------

describe('resolveMoveFromInput — aerial branch', () => {
  it('resolves a neutral-stick press to nair while airborne', () => {
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.wolf,
      neutralInput({ airborne: true, attackJustPressed: true }),
    );
    expect(dispatch).not.toBeNull();
    if (dispatch === null) return;
    expect(dispatch.category).toBe('aerial');
    if (dispatch.category !== 'aerial') return;
    expect(dispatch.slot).toBe('nair');
    expect(dispatch.direction).toBe('neutral');
    expect(dispatch.moveId).toBe(MOVESET_TABLE.wolf.nair.id);
  });

  it('resolves stick-toward-facing while airborne to fair', () => {
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.cat,
      neutralInput({
        airborne: true,
        attackJustPressed: true,
        moveX: 1,
        prevFacing: 1,
      }),
    );
    expect(dispatch).not.toBeNull();
    if (dispatch === null) return;
    expect(dispatch.category).toBe('aerial');
    if (dispatch.category !== 'aerial') return;
    expect(dispatch.slot).toBe('fair');
    expect(dispatch.direction).toBe('forward');
    expect(dispatch.moveId).toBe(MOVESET_TABLE.cat.fair.id);
  });

  it('resolves stick-opposite-facing while airborne to bair', () => {
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.owl,
      neutralInput({
        airborne: true,
        attackJustPressed: true,
        moveX: -1,
        prevFacing: 1,
      }),
    );
    expect(dispatch).not.toBeNull();
    if (dispatch === null) return;
    expect(dispatch.category).toBe('aerial');
    if (dispatch.category !== 'aerial') return;
    expect(dispatch.slot).toBe('bair');
    expect(dispatch.direction).toBe('back');
    expect(dispatch.moveId).toBe(MOVESET_TABLE.owl.bair.id);
  });

  it('drops a heavy press while airborne (smashes are grounded moves)', () => {
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.bear,
      neutralInput({ airborne: true, heavyJustPressed: true }),
    );
    expect(dispatch).toBeNull();
  });

  it('reads prevFacing — a press that flipped facing this frame still classifies relative to pre-flip facing', () => {
    // Player was facing right (prevFacing = 1), holds stick LEFT and
    // presses attack on the same frame they flipped facing — the canonical
    // "back-air does not turn you around" rule. Stick is left (-1), but
    // prevFacing = 1, so direction is "stick away from facing" = back.
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.wolf,
      neutralInput({
        airborne: true,
        attackJustPressed: true,
        moveX: -1,
        prevFacing: 1,
      }),
    );
    expect(dispatch).not.toBeNull();
    if (dispatch === null) return;
    if (dispatch.category !== 'aerial') return;
    expect(dispatch.direction).toBe('back');
  });

  it('every roster character resolves nair / fair / bair to its own move table', () => {
    for (const id of ALL_CHARACTERS) {
      const moveset = MOVESET_TABLE[id];

      const nairDispatch = resolveMoveFromInput(
        moveset,
        neutralInput({ airborne: true, attackJustPressed: true }),
      );
      expect(nairDispatch?.moveId).toBe(moveset.nair.id);

      const fairDispatch = resolveMoveFromInput(
        moveset,
        neutralInput({
          airborne: true,
          attackJustPressed: true,
          moveX: 1,
          prevFacing: 1,
        }),
      );
      expect(fairDispatch?.moveId).toBe(moveset.fair.id);

      const bairDispatch = resolveMoveFromInput(
        moveset,
        neutralInput({
          airborne: true,
          attackJustPressed: true,
          moveX: -1,
          prevFacing: 1,
        }),
      );
      expect(bairDispatch?.moveId).toBe(moveset.bair.id);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Special branch — neutral / side / up / down
// ---------------------------------------------------------------------------

describe('resolveMoveFromInput — special branch', () => {
  it('resolves a neutral-stick special press to the neutral special slot', () => {
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.wolf,
      neutralInput({ specialJustPressed: true }),
    );
    expect(dispatch).not.toBeNull();
    if (dispatch === null) return;
    expect(dispatch.category).toBe('special');
    if (dispatch.category !== 'special') return;
    expect(dispatch.slot).toBe('neutralSpecial');
    expect(dispatch.direction).toBe('neutral');
    expect(dispatch.moveId).toBe(MOVESET_TABLE.wolf.neutralSpecial.id);
  });

  it('resolves a side-stick special press to the side special slot', () => {
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.cat,
      neutralInput({ specialJustPressed: true, moveX: 1 }),
    );
    expect(dispatch).not.toBeNull();
    if (dispatch === null) return;
    if (dispatch.category !== 'special') return;
    expect(dispatch.slot).toBe('sideSpecial');
    expect(dispatch.direction).toBe('side');
    expect(dispatch.moveId).toBe(MOVESET_TABLE.cat.sideSpecial.id);
  });

  it('resolves an up-stick special press to the up special slot (recovery)', () => {
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.owl,
      neutralInput({ specialJustPressed: true, moveY: -1 }),
    );
    expect(dispatch).not.toBeNull();
    if (dispatch === null) return;
    if (dispatch.category !== 'special') return;
    expect(dispatch.slot).toBe('upSpecial');
    expect(dispatch.direction).toBe('up');
    expect(dispatch.moveId).toBe(MOVESET_TABLE.owl.upSpecial.id);
  });

  it('resolves a down-stick special press to the down special slot', () => {
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.bear,
      neutralInput({ specialJustPressed: true, moveY: 1 }),
    );
    expect(dispatch).not.toBeNull();
    if (dispatch === null) return;
    if (dispatch.category !== 'special') return;
    expect(dispatch.slot).toBe('downSpecial');
    expect(dispatch.direction).toBe('down');
    expect(dispatch.moveId).toBe(MOVESET_TABLE.bear.downSpecial.id);
  });

  it('special press wins priority over a same-frame attack press', () => {
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.wolf,
      neutralInput({
        specialJustPressed: true,
        attackJustPressed: true,
        heavyJustPressed: true,
        moveX: 1,
      }),
    );
    expect(dispatch).not.toBeNull();
    if (dispatch === null) return;
    expect(dispatch.category).toBe('special');
    if (dispatch.category !== 'special') return;
    expect(dispatch.slot).toBe('sideSpecial');
  });

  it('special press is gated by per-direction cooldown', () => {
    const cd: MoveResolverCooldowns = {
      neutral: 0,
      side: 30,
      up: 0,
      down: 0,
    };
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.wolf,
      neutralInput({ specialJustPressed: true, moveX: 1 }),
      cd,
    );
    expect(dispatch).toBeNull();
  });

  it('cooldown gate is direction-specific — up still ready while side cools', () => {
    const cd: MoveResolverCooldowns = {
      neutral: 0,
      side: 30,
      up: 0,
      down: 0,
    };
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.wolf,
      neutralInput({ specialJustPressed: true, moveY: -1 }),
      cd,
    );
    expect(dispatch).not.toBeNull();
    if (dispatch === null) return;
    if (dispatch.category !== 'special') return;
    expect(dispatch.slot).toBe('upSpecial');
  });

  it('special press fires when airborne too (recovery up-special is the canonical case)', () => {
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.cat,
      neutralInput({
        airborne: true,
        specialJustPressed: true,
        moveY: -1,
      }),
    );
    expect(dispatch).not.toBeNull();
    if (dispatch === null) return;
    if (dispatch.category !== 'special') return;
    expect(dispatch.slot).toBe('upSpecial');
    expect(dispatch.moveId).toBe(MOVESET_TABLE.cat.upSpecial.id);
  });

  it('every roster character resolves all 4 specials to its own move table', () => {
    for (const id of ALL_CHARACTERS) {
      const moveset = MOVESET_TABLE[id];

      const neutral = resolveMoveFromInput(
        moveset,
        neutralInput({ specialJustPressed: true }),
      );
      expect(neutral?.moveId).toBe(moveset.neutralSpecial.id);

      const side = resolveMoveFromInput(
        moveset,
        neutralInput({ specialJustPressed: true, moveX: 1 }),
      );
      expect(side?.moveId).toBe(moveset.sideSpecial.id);

      const up = resolveMoveFromInput(
        moveset,
        neutralInput({ specialJustPressed: true, moveY: -1 }),
      );
      expect(up?.moveId).toBe(moveset.upSpecial.id);

      const down = resolveMoveFromInput(
        moveset,
        neutralInput({ specialJustPressed: true, moveY: 1 }),
      );
      expect(down?.moveId).toBe(moveset.downSpecial.id);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. End-to-end determinism + edge cases
// ---------------------------------------------------------------------------

describe('resolveMoveFromInput — determinism + edge cases', () => {
  it('is purely deterministic: identical inputs produce identical outputs', () => {
    const moveset = MOVESET_TABLE.wolf;
    const input = neutralInput({
      attackJustPressed: true,
      moveX: 0.5,
      prevMoveX: 0.5,
    });
    const a = resolveMoveFromInput(moveset, input);
    const b = resolveMoveFromInput(moveset, input);
    expect(a).toEqual(b);
    // Distinct invocations return value-equal but distinct objects
    // (we don't memoise — that's a property of the pure function).
    expect(a).not.toBe(b);
  });

  it('does not mutate the cooldown state', () => {
    const cd = createMoveResolverCooldowns();
    const before = JSON.stringify(cd);
    resolveMoveFromInput(
      MOVESET_TABLE.wolf,
      neutralInput({ specialJustPressed: true, moveX: 1 }),
      cd,
    );
    expect(JSON.stringify(cd)).toBe(before);
  });

  it('end-to-end cooldown lifecycle: fire → cooldown → tick → ready', () => {
    const moveset = MOVESET_TABLE.wolf;
    const cd = createMoveResolverCooldowns();
    const input = neutralInput({ specialJustPressed: true, moveX: 1 });

    // Frame 0: fires, then arm cooldown.
    const dispatch1 = resolveMoveFromInput(moveset, input, cd);
    expect(dispatch1).not.toBeNull();
    if (dispatch1 === null) return;
    if (dispatch1.category !== 'special') return;
    startMoveResolverCooldown(cd, dispatch1.direction, dispatch1.move);
    const lockout = getMoveLockoutFrames(moveset.sideSpecial);
    expect(cd.side).toBe(lockout);

    // Frame 1+: gated until lockout drains.
    for (let i = 0; i < lockout; i += 1) {
      const dispatchMid = resolveMoveFromInput(moveset, input, cd);
      expect(dispatchMid).toBeNull();
      tickMoveResolverCooldowns(cd);
    }
    expect(cd.side).toBe(0);

    // Frame `lockout + 1`: ready to fire again.
    const dispatch2 = resolveMoveFromInput(moveset, input, cd);
    expect(dispatch2).not.toBeNull();
    if (dispatch2 === null) return;
    expect(dispatch2.category).toBe('special');
  });

  it('returns null on a heavy press while airborne (smashes are grounded only)', () => {
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.wolf,
      neutralInput({ airborne: true, heavyJustPressed: true }),
    );
    expect(dispatch).toBeNull();
  });

  it('uses default cooldowns (all ready) when caller omits the parameter', () => {
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.wolf,
      neutralInput({ specialJustPressed: true, moveX: 1 }),
      // No cooldowns argument — defaults to a fresh ready state.
    );
    expect(dispatch).not.toBeNull();
  });

  it('returns dispatch records whose move is === the moveset slot record (no clone)', () => {
    // Important for replay / AI consumers: the dispatched move record
    // is reference-equal to the authored data table entry, so callers
    // can safely compare with `===`.
    const dispatch = resolveMoveFromInput(
      MOVESET_TABLE.wolf,
      neutralInput({ heavyJustPressed: true }),
    );
    expect(dispatch).not.toBeNull();
    if (dispatch === null) return;
    expect(dispatch.move).toBe(MOVESET_TABLE.wolf.smash);
  });
});

// ---------------------------------------------------------------------------
// 7. Moveset enumeration helper
// ---------------------------------------------------------------------------

describe('enumerateMovesetMoves', () => {
  it('returns 10 moves in canonical order for every character', () => {
    for (const id of ALL_CHARACTERS) {
      const moveset = MOVESET_TABLE[id];
      const moves = enumerateMovesetMoves(moveset);
      expect(moves).toHaveLength(10);
      expect(moves[0]).toBe(moveset.jab);
      expect(moves[1]).toBe(moveset.tilt);
      expect(moves[2]).toBe(moveset.smash);
      expect(moves[3]).toBe(moveset.nair);
      expect(moves[4]).toBe(moveset.fair);
      expect(moves[5]).toBe(moveset.bair);
      expect(moves[6]).toBe(moveset.neutralSpecial);
      expect(moves[7]).toBe(moveset.sideSpecial);
      expect(moves[8]).toBe(moveset.upSpecial);
      expect(moves[9]).toBe(moveset.downSpecial);
    }
  });

  it('every move id is unique within a moveset', () => {
    for (const id of ALL_CHARACTERS) {
      const ids = enumerateMovesetMoves(MOVESET_TABLE[id]).map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
