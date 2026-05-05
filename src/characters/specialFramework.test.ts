import { describe, it, expect } from 'vitest';
import {
  SPECIAL_DIRECTIONS,
  SPECIAL_STICK_THRESHOLD,
  detectSpecialDirection,
  createSpecialCooldownState,
  tickSpecialCooldowns,
  startSpecialCooldown,
  isSpecialReady,
  getSpecialCooldownRemaining,
  resetSpecialCooldowns,
  resolveSpecialMove,
  resolveSpecialFromInput,
  listSpecialMoves,
  listSpecialMoveEntries,
  type CharacterSpecialConfig,
  type SpecialDirection,
} from './specialFramework';
import type { CounterSpecialMove } from './specialSchema';
import type { MultiHitRisingUpSpecialMove } from './upSpecialSchema';
import type { DashStrikeSideSpecialMove } from './sideSpecialSchema';

/**
 * AC 60101 Sub-AC 1 — special move framework invariants.
 *
 * Pure module — no Phaser, Matter, Math.random, or wall-clock. This
 * suite locks down:
 *
 *   1. The direction detector classifies stick + button combos
 *      correctly with the documented up-priority precedence.
 *   2. Cooldown state ticks down deterministically and gates resolution.
 *   3. Per-character config resolves to the right move per direction.
 *   4. The end-to-end resolver returns null on no-press / on cooldown
 *      and returns the correct move + direction on a clean press.
 */

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FIXTURE_NEUTRAL: CounterSpecialMove = {
  id: 'fix.neutral',
  type: 'special',
  specialKind: 'counter',
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
  startupFrames: 4,
  activeFrames: 12,
  recoveryFrames: 16,
  cooldownFrames: 20,
  counter: {
    counterWindowStart: 4,
    counterWindowEnd: 16,
    damageMultiplier: 1.3,
    minCounterDamage: 6,
    maxCounterDamage: 18,
    counterKnockback: { x: 3, y: -1.4, scaling: 0.25 },
    counterHitbox: { offsetX: 50, offsetY: -10, width: 60, height: 60 },
  },
};

const FIXTURE_SIDE: DashStrikeSideSpecialMove = {
  id: 'fix.side',
  type: 'sideSpecial',
  sideSpecialKind: 'dashStrike',
  damage: 8,
  knockback: { x: 2.0, y: -0.5, scaling: 0.15 },
  hitbox: { offsetX: 40, offsetY: -10, width: 60, height: 60 },
  startupFrames: 6,
  activeFrames: 8,
  recoveryFrames: 14,
  cooldownFrames: 16,
  dashStrike: { dashSpeed: 16, dashFrames: 6, helplessAfterDash: false },
};

const FIXTURE_UP: MultiHitRisingUpSpecialMove = {
  id: 'fix.up',
  type: 'upSpecial',
  upSpecialKind: 'multiHitRising',
  damage: 2,
  knockback: { x: 0, y: -0.4, scaling: 0.02 },
  hitbox: { offsetX: 0, offsetY: -10, width: 80, height: 120 },
  startupFrames: 4,
  activeFrames: 18,
  recoveryFrames: 22,
  cooldownFrames: 18,
  multiHitRising: {
    riseImpulse: -16,
    driftImpulse: 0,
    hitCount: 3,
    hitInterval: 6,
    linkDamage: 2,
    linkKnockback: { x: 0, y: -0.4, scaling: 0.02 },
    launcherDamage: 8,
    launcherKnockback: { x: 0.5, y: -3.0, scaling: 0.32 },
  },
};

const FIXTURE_CONFIG: CharacterSpecialConfig = {
  characterId: 'fixture',
  neutral: FIXTURE_NEUTRAL,
  side: FIXTURE_SIDE,
  up: FIXTURE_UP,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('specialFramework — constants', () => {
  it('exposes the three directions in canonical order', () => {
    expect(SPECIAL_DIRECTIONS).toEqual(['neutral', 'side', 'up']);
    // Frozen so tests / runtime can't accidentally mutate it.
    expect(Object.isFrozen(SPECIAL_DIRECTIONS)).toBe(true);
  });

  it('exposes a sensible stick threshold', () => {
    expect(SPECIAL_STICK_THRESHOLD).toBeGreaterThan(0);
    expect(SPECIAL_STICK_THRESHOLD).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// Direction detection
// ---------------------------------------------------------------------------

describe('specialFramework — detectSpecialDirection', () => {
  it('returns null when special is not pressed', () => {
    expect(
      detectSpecialDirection({ specialPressed: false, moveX: 0, moveY: 0 }),
    ).toBeNull();
    expect(
      detectSpecialDirection({ specialPressed: false, moveX: 1, moveY: -1 }),
    ).toBeNull();
  });

  it('returns "neutral" on a press with stick centered', () => {
    expect(
      detectSpecialDirection({ specialPressed: true, moveX: 0, moveY: 0 }),
    ).toBe('neutral');
  });

  it('returns "neutral" when stick deflection is below threshold', () => {
    const t = SPECIAL_STICK_THRESHOLD;
    expect(
      detectSpecialDirection({
        specialPressed: true,
        moveX: t * 0.9,
        moveY: -t * 0.9,
      }),
    ).toBe('neutral');
  });

  it('returns "side" when horizontal deflection is past threshold (right)', () => {
    expect(
      detectSpecialDirection({
        specialPressed: true,
        moveX: SPECIAL_STICK_THRESHOLD,
        moveY: 0,
      }),
    ).toBe('side');
    expect(
      detectSpecialDirection({ specialPressed: true, moveX: 1, moveY: 0 }),
    ).toBe('side');
  });

  it('returns "side" when horizontal deflection is past threshold (left)', () => {
    expect(
      detectSpecialDirection({
        specialPressed: true,
        moveX: -SPECIAL_STICK_THRESHOLD,
        moveY: 0,
      }),
    ).toBe('side');
    expect(
      detectSpecialDirection({ specialPressed: true, moveX: -1, moveY: 0 }),
    ).toBe('side');
  });

  it('returns "up" when vertical deflection is past threshold (negative Y)', () => {
    expect(
      detectSpecialDirection({
        specialPressed: true,
        moveX: 0,
        moveY: -SPECIAL_STICK_THRESHOLD,
      }),
    ).toBe('up');
    expect(
      detectSpecialDirection({ specialPressed: true, moveX: 0, moveY: -1 }),
    ).toBe('up');
  });

  it('prefers "up" over "side" when stick is held up-and-side', () => {
    // This is the canonical recovery-grace rule from the JSDoc — a player
    // off-stage holding up-and-toward-stage should still resolve into
    // up-special.
    expect(
      detectSpecialDirection({
        specialPressed: true,
        moveX: 1,
        moveY: -1,
      }),
    ).toBe('up');
    expect(
      detectSpecialDirection({
        specialPressed: true,
        moveX: -1,
        moveY: -1,
      }),
    ).toBe('up');
  });

  it('does NOT misclassify a held-down stick as up', () => {
    expect(
      detectSpecialDirection({ specialPressed: true, moveX: 0, moveY: 1 }),
    ).toBe('neutral');
    expect(
      detectSpecialDirection({ specialPressed: true, moveX: 1, moveY: 1 }),
    ).toBe('side'); // side wins because down isn't routed to up
  });
});

// ---------------------------------------------------------------------------
// Cooldown tracking
// ---------------------------------------------------------------------------

describe('specialFramework — cooldown tracking', () => {
  it('createSpecialCooldownState yields an all-zero state', () => {
    const s = createSpecialCooldownState();
    expect(s).toEqual({ neutral: 0, side: 0, up: 0 });
    // Independent instance — different calls don't share refs.
    const s2 = createSpecialCooldownState();
    expect(s2).not.toBe(s);
  });

  it('isSpecialReady is true on a fresh state for every direction', () => {
    const s = createSpecialCooldownState();
    expect(isSpecialReady(s, 'neutral')).toBe(true);
    expect(isSpecialReady(s, 'side')).toBe(true);
    expect(isSpecialReady(s, 'up')).toBe(true);
  });

  it('startSpecialCooldown sets the right slot to busy + cooldownFrames', () => {
    const s = createSpecialCooldownState();
    startSpecialCooldown(s, 'neutral', FIXTURE_NEUTRAL);
    // lockout = 4 + 12 + 16 + 20 = 52
    expect(s.neutral).toBe(52);
    // Other slots untouched.
    expect(s.side).toBe(0);
    expect(s.up).toBe(0);
    expect(isSpecialReady(s, 'neutral')).toBe(false);
    expect(isSpecialReady(s, 'side')).toBe(true);
    expect(isSpecialReady(s, 'up')).toBe(true);
  });

  it('per-direction cooldowns are independent', () => {
    const s = createSpecialCooldownState();
    startSpecialCooldown(s, 'side', FIXTURE_SIDE);
    // Side specials lockout = 6 + 8 + 14 + 16 = 44
    expect(s.side).toBe(44);
    expect(s.neutral).toBe(0);
    expect(s.up).toBe(0);
  });

  it('tickSpecialCooldowns decrements all positive slots by 1, clamps at 0', () => {
    const s = createSpecialCooldownState();
    s.neutral = 3;
    s.side = 1;
    s.up = 0;
    tickSpecialCooldowns(s);
    expect(s).toEqual({ neutral: 2, side: 0, up: 0 });
    tickSpecialCooldowns(s);
    expect(s).toEqual({ neutral: 1, side: 0, up: 0 });
    tickSpecialCooldowns(s);
    expect(s).toEqual({ neutral: 0, side: 0, up: 0 });
    tickSpecialCooldowns(s);
    // Clamped at zero — no negative drift.
    expect(s).toEqual({ neutral: 0, side: 0, up: 0 });
  });

  it('getSpecialCooldownRemaining returns the right slot value', () => {
    const s = createSpecialCooldownState();
    s.neutral = 7;
    s.side = 12;
    s.up = 0;
    expect(getSpecialCooldownRemaining(s, 'neutral')).toBe(7);
    expect(getSpecialCooldownRemaining(s, 'side')).toBe(12);
    expect(getSpecialCooldownRemaining(s, 'up')).toBe(0);
  });

  it('resetSpecialCooldowns clears every counter to 0', () => {
    const s = createSpecialCooldownState();
    s.neutral = 30;
    s.side = 25;
    s.up = 60;
    resetSpecialCooldowns(s);
    expect(s).toEqual({ neutral: 0, side: 0, up: 0 });
  });

  it('startSpecialCooldown takes the max when re-armed mid-cooldown', () => {
    const s = createSpecialCooldownState();
    // Pre-set a high cooldown manually
    s.neutral = 200;
    startSpecialCooldown(s, 'neutral', FIXTURE_NEUTRAL); // lockout = 52
    // Should keep the higher value, not overwrite with 52.
    expect(s.neutral).toBe(200);
  });

  it('cooldown ticks consistently across many fixed steps', () => {
    const s = createSpecialCooldownState();
    startSpecialCooldown(s, 'up', FIXTURE_UP);
    // FIXTURE_UP lockout = 4 + 18 + 22 + 18 = 62
    expect(s.up).toBe(62);
    for (let i = 0; i < 62; i += 1) {
      tickSpecialCooldowns(s);
    }
    // Now ready again
    expect(isSpecialReady(s, 'up')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Per-character config resolution
// ---------------------------------------------------------------------------

describe('specialFramework — resolveSpecialMove', () => {
  it('returns the right move per direction', () => {
    expect(resolveSpecialMove(FIXTURE_CONFIG, 'neutral')).toBe(FIXTURE_NEUTRAL);
    expect(resolveSpecialMove(FIXTURE_CONFIG, 'side')).toBe(FIXTURE_SIDE);
    expect(resolveSpecialMove(FIXTURE_CONFIG, 'up')).toBe(FIXTURE_UP);
  });

  it('listSpecialMoves returns all three in canonical order', () => {
    const list = listSpecialMoves(FIXTURE_CONFIG);
    expect(list).toEqual([FIXTURE_NEUTRAL, FIXTURE_SIDE, FIXTURE_UP]);
  });

  it('listSpecialMoveEntries pairs direction with move', () => {
    const entries = listSpecialMoveEntries(FIXTURE_CONFIG);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ direction: 'neutral', move: FIXTURE_NEUTRAL });
    expect(entries[1]).toEqual({ direction: 'side', move: FIXTURE_SIDE });
    expect(entries[2]).toEqual({ direction: 'up', move: FIXTURE_UP });
  });

  it('throws on an unknown direction', () => {
    // @ts-expect-error — runtime branch validation
    expect(() => resolveSpecialMove(FIXTURE_CONFIG, 'down')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// End-to-end resolver
// ---------------------------------------------------------------------------

describe('specialFramework — resolveSpecialFromInput', () => {
  it('returns null when special is not pressed', () => {
    const cooldown = createSpecialCooldownState();
    expect(
      resolveSpecialFromInput(FIXTURE_CONFIG, cooldown, {
        specialPressed: false,
        moveX: 1,
        moveY: -1,
      }),
    ).toBeNull();
  });

  it('returns the resolved move on a clean neutral press', () => {
    const cooldown = createSpecialCooldownState();
    const result = resolveSpecialFromInput(FIXTURE_CONFIG, cooldown, {
      specialPressed: true,
      moveX: 0,
      moveY: 0,
    });
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('neutral');
    expect(result!.move).toBe(FIXTURE_NEUTRAL);
  });

  it('returns the resolved move on a clean side press', () => {
    const cooldown = createSpecialCooldownState();
    const result = resolveSpecialFromInput(FIXTURE_CONFIG, cooldown, {
      specialPressed: true,
      moveX: 1,
      moveY: 0,
    });
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('side');
    expect(result!.move).toBe(FIXTURE_SIDE);
  });

  it('returns the resolved move on a clean up press', () => {
    const cooldown = createSpecialCooldownState();
    const result = resolveSpecialFromInput(FIXTURE_CONFIG, cooldown, {
      specialPressed: true,
      moveX: 0,
      moveY: -1,
    });
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('up');
    expect(result!.move).toBe(FIXTURE_UP);
  });

  it('returns null when the resolved direction is on cooldown', () => {
    const cooldown = createSpecialCooldownState();
    cooldown.neutral = 30;
    const result = resolveSpecialFromInput(FIXTURE_CONFIG, cooldown, {
      specialPressed: true,
      moveX: 0,
      moveY: 0,
    });
    expect(result).toBeNull();
  });

  it('returns the move once the cooldown drains', () => {
    const cooldown = createSpecialCooldownState();
    cooldown.neutral = 1;
    // Still on cooldown:
    expect(
      resolveSpecialFromInput(FIXTURE_CONFIG, cooldown, {
        specialPressed: true,
        moveX: 0,
        moveY: 0,
      }),
    ).toBeNull();
    // After one tick:
    tickSpecialCooldowns(cooldown);
    const result = resolveSpecialFromInput(FIXTURE_CONFIG, cooldown, {
      specialPressed: true,
      moveX: 0,
      moveY: 0,
    });
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('neutral');
  });

  it('does not mutate the cooldown state', () => {
    const cooldown = createSpecialCooldownState();
    cooldown.neutral = 5;
    const before = { ...cooldown };
    resolveSpecialFromInput(FIXTURE_CONFIG, cooldown, {
      specialPressed: true,
      moveX: 0,
      moveY: 0,
    });
    expect(cooldown).toEqual(before);
  });

  it('only gates the resolved direction (other directions still fire)', () => {
    const cooldown = createSpecialCooldownState();
    cooldown.neutral = 30;
    // Side press should still fire even though neutral is on cooldown.
    const result = resolveSpecialFromInput(FIXTURE_CONFIG, cooldown, {
      specialPressed: true,
      moveX: 1,
      moveY: 0,
    });
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('side');
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('specialFramework — determinism', () => {
  it('the same input sequence always produces the same cooldown trace', () => {
    const trace = (): number[] => {
      const s = createSpecialCooldownState();
      const out: number[] = [];
      const presses: Array<{ press: boolean; dir: SpecialDirection | null }> = [
        { press: true, dir: 'neutral' },
        { press: false, dir: null },
        { press: false, dir: null },
        { press: true, dir: 'side' },
        { press: false, dir: null },
      ];
      for (const p of presses) {
        if (p.press && p.dir !== null && isSpecialReady(s, p.dir)) {
          startSpecialCooldown(
            s,
            p.dir,
            p.dir === 'neutral'
              ? FIXTURE_NEUTRAL
              : p.dir === 'side'
                ? FIXTURE_SIDE
                : FIXTURE_UP,
          );
        }
        tickSpecialCooldowns(s);
        out.push(s.neutral, s.side, s.up);
      }
      return out;
    };
    const a = trace();
    const b = trace();
    expect(a).toEqual(b);
  });
});
