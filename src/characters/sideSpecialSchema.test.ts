import { describe, it, expect } from 'vitest';
import {
  validateSideSpecialMove,
  isSideSpecialMove,
  isDashStrikeSideSpecial,
  isMultiHitSideSpecial,
  isReflectorSideSpecial,
  isCommandDashSideSpecial,
  computeDashVelocity,
  computeSideMultiHitFrames,
  isSideMultiHitFrame,
  getSideMultiHitIndex,
  computeReflectedDamage,
  computeReflectedVelocity,
  type DashStrikeSideSpecialMove,
  type MultiHitSideSpecialMove,
  type ReflectorSideSpecialMove,
  type CommandDashSideSpecialMove,
  type SideSpecialMove,
} from './sideSpecialSchema';

/**
 * AC 60101 Sub-AC 1 — side-special schema invariants.
 *
 * The schema module is pure (no Phaser, no Matter, no Math.random,
 * no wall-clock). This suite locks down:
 *
 *   1. Type guards correctly classify the four kinds.
 *   2. Schema validators reject malformed records and accept all four
 *      authored records.
 *   3. Pure helpers (dash velocity, multi-hit frames, reflected damage
 *      / velocity) are deterministic.
 */

// ---------------------------------------------------------------------------
// Test fixtures — minimal valid records of each kind
// ---------------------------------------------------------------------------

const FIXTURE_DASH_STRIKE: DashStrikeSideSpecialMove = {
  id: 'fixture.side.dash',
  type: 'sideSpecial',
  sideSpecialKind: 'dashStrike',
  damage: 10,
  knockback: { x: 2.4, y: -0.6, scaling: 0.18 },
  hitbox: { offsetX: 40, offsetY: -10, width: 80, height: 80 },
  startupFrames: 6,
  activeFrames: 8,
  recoveryFrames: 14,
  cooldownFrames: 16,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
  dashStrike: {
    dashSpeed: 16,
    dashFrames: 6,
    helplessAfterDash: false,
  },
};

const FIXTURE_MULTI_HIT: MultiHitSideSpecialMove = {
  id: 'fixture.side.multi',
  type: 'sideSpecial',
  sideSpecialKind: 'multiHit',
  damage: 3,
  knockback: { x: 1.0, y: -0.2, scaling: 0.04 },
  hitbox: { offsetX: 50, offsetY: -8, width: 70, height: 60 },
  startupFrames: 5,
  activeFrames: 12,
  recoveryFrames: 12,
  cooldownFrames: 14,
  animation: { startupFrames: 2, activeFrames: 3, recoveryFrames: 2 },
  multiHit: {
    hitCount: 3,
    hitInterval: 4,
    damagePerHit: [3, 3, 7],
    knockbackPerHit: [
      { x: 1.0, y: -0.2, scaling: 0.04 },
      { x: 1.0, y: -0.2, scaling: 0.04 },
      { x: 2.5, y: -1.4, scaling: 0.22 },
    ],
    chainWindowFrames: 8,
  },
};

const FIXTURE_REFLECTOR: ReflectorSideSpecialMove = {
  id: 'fixture.side.reflector',
  type: 'sideSpecial',
  sideSpecialKind: 'reflector',
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  hitbox: { offsetX: 30, offsetY: 0, width: 1, height: 1 },
  startupFrames: 4,
  activeFrames: 14,
  recoveryFrames: 18,
  cooldownFrames: 24,
  animation: { startupFrames: 1, activeFrames: 3, recoveryFrames: 3 },
  reflector: {
    reflectMultiplier: 1.5,
    velocityScale: 1.4,
    contactDamage: 2,
    contactKnockback: { x: 1.2, y: -0.4, scaling: 0.05 },
    reflectorBody: {
      offsetX: 50,
      offsetY: -10,
      width: 80,
      height: 100,
    },
  },
};

const FIXTURE_COMMAND_DASH: CommandDashSideSpecialMove = {
  id: 'fixture.side.commanddash',
  type: 'sideSpecial',
  sideSpecialKind: 'commandDash',
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  hitbox: { offsetX: 60, offsetY: 0, width: 60, height: 80 },
  startupFrames: 7,
  activeFrames: 10,
  recoveryFrames: 22,
  cooldownFrames: 30,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 4 },
  commandDash: {
    dashSpeed: 14,
    dashFrames: 8,
    grabHoldFrames: 18,
    throwDamage: 12,
    throwKnockback: { x: 3.6, y: -1.8, scaling: 0.32 },
    ignoresShield: true,
    helplessOnWhiff: true,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sideSpecialSchema — type guards', () => {
  it('identifies the four side-special kinds', () => {
    expect(isSideSpecialMove(FIXTURE_DASH_STRIKE)).toBe(true);
    expect(isSideSpecialMove(FIXTURE_MULTI_HIT)).toBe(true);
    expect(isSideSpecialMove(FIXTURE_REFLECTOR)).toBe(true);
    expect(isSideSpecialMove(FIXTURE_COMMAND_DASH)).toBe(true);

    expect(isDashStrikeSideSpecial(FIXTURE_DASH_STRIKE)).toBe(true);
    expect(isDashStrikeSideSpecial(FIXTURE_MULTI_HIT)).toBe(false);

    expect(isMultiHitSideSpecial(FIXTURE_MULTI_HIT)).toBe(true);
    expect(isMultiHitSideSpecial(FIXTURE_REFLECTOR)).toBe(false);

    expect(isReflectorSideSpecial(FIXTURE_REFLECTOR)).toBe(true);
    expect(isReflectorSideSpecial(FIXTURE_COMMAND_DASH)).toBe(false);

    expect(isCommandDashSideSpecial(FIXTURE_COMMAND_DASH)).toBe(true);
    expect(isCommandDashSideSpecial(FIXTURE_DASH_STRIKE)).toBe(false);
  });

  it('rejects non-side-special moves', () => {
    const fakeJab = {
      id: 'fake.jab',
      type: 'jab',
      damage: 5,
      knockback: { x: 1, y: 0, scaling: 0 },
      hitbox: { offsetX: 10, offsetY: 0, width: 10, height: 10 },
      startupFrames: 1,
      activeFrames: 1,
      recoveryFrames: 1,
      cooldownFrames: 0,
    } as const;
    expect(isSideSpecialMove(fakeJab)).toBe(false);
  });

  it('rejects moves typed sideSpecial but missing a kind tag', () => {
    const malformed = {
      ...FIXTURE_DASH_STRIKE,
      sideSpecialKind: 'unknownKind',
    } as unknown as SideSpecialMove;
    expect(isSideSpecialMove(malformed)).toBe(false);
  });
});

describe('sideSpecialSchema — validators', () => {
  it('accepts all four well-formed fixtures', () => {
    expect(() => validateSideSpecialMove(FIXTURE_DASH_STRIKE)).not.toThrow();
    expect(() => validateSideSpecialMove(FIXTURE_MULTI_HIT)).not.toThrow();
    expect(() => validateSideSpecialMove(FIXTURE_REFLECTOR)).not.toThrow();
    expect(() => validateSideSpecialMove(FIXTURE_COMMAND_DASH)).not.toThrow();
  });

  it('rejects dashStrike with non-positive dashSpeed', () => {
    const bad: DashStrikeSideSpecialMove = {
      ...FIXTURE_DASH_STRIKE,
      dashStrike: { ...FIXTURE_DASH_STRIKE.dashStrike, dashSpeed: 0 },
    };
    expect(() => validateSideSpecialMove(bad)).toThrow(/dashSpeed/);
  });

  it('rejects dashStrike with dashFrames > activeFrames', () => {
    const bad: DashStrikeSideSpecialMove = {
      ...FIXTURE_DASH_STRIKE,
      dashStrike: { ...FIXTURE_DASH_STRIKE.dashStrike, dashFrames: 99 },
    };
    expect(() => validateSideSpecialMove(bad)).toThrow(/dashFrames=99/);
  });

  it('rejects multiHit when arrays mismatch hitCount', () => {
    const bad: MultiHitSideSpecialMove = {
      ...FIXTURE_MULTI_HIT,
      multiHit: {
        ...FIXTURE_MULTI_HIT.multiHit,
        damagePerHit: [3, 3], // length 2 != hitCount 3
      },
    };
    expect(() => validateSideSpecialMove(bad)).toThrow(/damagePerHit/);
  });

  it('rejects multiHit when final hit fires past activeFrames', () => {
    const bad: MultiHitSideSpecialMove = {
      ...FIXTURE_MULTI_HIT,
      multiHit: {
        ...FIXTURE_MULTI_HIT.multiHit,
        hitInterval: 999,
      },
    };
    expect(() => validateSideSpecialMove(bad)).toThrow(/final hit/);
  });

  it('rejects reflector with non-positive reflectMultiplier', () => {
    const bad: ReflectorSideSpecialMove = {
      ...FIXTURE_REFLECTOR,
      reflector: { ...FIXTURE_REFLECTOR.reflector, reflectMultiplier: 0 },
    };
    expect(() => validateSideSpecialMove(bad)).toThrow(/reflectMultiplier/);
  });

  it('rejects commandDash with negative throwDamage', () => {
    const bad: CommandDashSideSpecialMove = {
      ...FIXTURE_COMMAND_DASH,
      commandDash: { ...FIXTURE_COMMAND_DASH.commandDash, throwDamage: -5 },
    };
    expect(() => validateSideSpecialMove(bad)).toThrow(/throwDamage/);
  });

  it('rejects animation block with zero per-phase frames', () => {
    const bad: DashStrikeSideSpecialMove = {
      ...FIXTURE_DASH_STRIKE,
      animation: { startupFrames: 0, activeFrames: 1, recoveryFrames: 1 },
    };
    expect(() => validateSideSpecialMove(bad)).toThrow(/animation/);
  });
});

describe('sideSpecialSchema — pure helpers', () => {
  it('computeDashVelocity mirrors by facing', () => {
    const right = computeDashVelocity(16, 1);
    expect(right).toEqual({ x: 16, y: 0 });
    const left = computeDashVelocity(16, -1);
    expect(left).toEqual({ x: -16, y: 0 });
  });

  it('computeSideMultiHitFrames returns the right ladder', () => {
    const frames = computeSideMultiHitFrames(FIXTURE_MULTI_HIT.multiHit);
    expect(frames).toEqual([0, 4, 8]);
  });

  it('isSideMultiHitFrame is true only on a hit-spawn frame', () => {
    const spec = FIXTURE_MULTI_HIT.multiHit;
    expect(isSideMultiHitFrame(spec, 0)).toBe(true);
    expect(isSideMultiHitFrame(spec, 1)).toBe(false);
    expect(isSideMultiHitFrame(spec, 4)).toBe(true);
    expect(isSideMultiHitFrame(spec, 8)).toBe(true);
    // 12 = 3 * hitInterval = past hitCount 3 so out of bounds
    expect(isSideMultiHitFrame(spec, 12)).toBe(false);
    expect(isSideMultiHitFrame(spec, -1)).toBe(false);
  });

  it('getSideMultiHitIndex maps a hit-spawn frame to its index', () => {
    const spec = FIXTURE_MULTI_HIT.multiHit;
    expect(getSideMultiHitIndex(spec, 0)).toBe(0);
    expect(getSideMultiHitIndex(spec, 4)).toBe(1);
    expect(getSideMultiHitIndex(spec, 8)).toBe(2);
    expect(getSideMultiHitIndex(spec, 1)).toBe(-1);
    expect(getSideMultiHitIndex(spec, 12)).toBe(-1);
  });

  it('computeReflectedDamage scales by multiplier', () => {
    const spec = FIXTURE_REFLECTOR.reflector;
    expect(computeReflectedDamage(spec, 10)).toBeCloseTo(15);
    expect(computeReflectedDamage(spec, 0)).toBe(0);
    // Negative damage clamps to 0 (defensive case)
    expect(computeReflectedDamage(spec, -8)).toBe(0);
  });

  it('computeReflectedVelocity inverts and scales', () => {
    const spec = FIXTURE_REFLECTOR.reflector;
    const v = computeReflectedVelocity(spec, { x: 5, y: -3 });
    expect(v.x).toBeCloseTo(-7);
    expect(v.y).toBeCloseTo(4.2);
  });
});
