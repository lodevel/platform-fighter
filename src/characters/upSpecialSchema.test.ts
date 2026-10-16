import { describe, it, expect } from 'vitest';
import {
  validateUpSpecialMove,
  isUpSpecialMove,
  isMultiHitRisingUpSpecial,
  isTeleportUpSpecial,
  isDirectionalJumpUpSpecial,
  isTetherUpSpecial,
  snapStickToOctant,
  computeMultiHitFrames,
  isMultiHitFrame,
  isFinalLauncherFrame,
  computeTeleportDestination,
  isInTeleportInvincibilityWindow,
  computeBurstVelocity,
  isInBurstWindow,
  computeTetherTipPosition,
  isTetherFullyExtended,
  type UpSpecialMove,
  type MultiHitRisingUpSpecialMove,
  type TeleportUpSpecialMove,
  type DirectionalJumpUpSpecialMove,
  type TetherUpSpecialMove,
} from './upSpecialSchema';
import {
  DONKEYKONG_JAB,
  DONKEYKONG_NAIR,
  DONKEYKONG_NEUTRAL_SPECIAL,
  DONKEYKONG_UP_SPECIAL,
} from './DonkeyKong';
import { PIKACHU_JAB, PIKACHU_NEUTRAL_SPECIAL, PIKACHU_UP_SPECIAL } from './Pikachu';
import { LINK_JAB, LINK_NEUTRAL_SPECIAL, LINK_UP_SPECIAL } from './linkFreshKit';
import { CHARACTER_ROSTER, findMoveByType } from './roster';

/**
 * AC 60202 Sub-AC 2 — up-special schema + per-character up-special
 * data records.
 *
 * The schema module is pure (no Phaser, no Matter, no Math.random,
 * no wall-clock). This suite locks down:
 *
 *   1. Type guards correctly classify the four kinds.
 *   2. Schema validators reject malformed records and accept every
 *      authored roster record plus the synthetic kind fixtures.
 *   3. 8-direction stick snap is a pure function with the canonical
 *      output set (8 unit vectors + neutral default).
 *   4. Multi-hit ladder helpers produce correct hit-spawn frames.
 *   5. Teleport / burst window predicates respect their boundaries.
 *   6. Tether tip-position math grows linearly to maxRange.
 *   7. Per-character data — each authored up-special passes the schema
 *      AND the roster invariants (every character has exactly one up
 *      special, ids are unique and carry the owner prefix).
 *   8. Roster integration — `CHARACTER_ROSTER[id].moves` exposes the
 *      up-special and `findMoveByType(spec, 'upSpecial')` returns it.
 *   9. Up-special and neutral-special coexist as distinct moves on
 *      every character (the slot wiring keeps them independent).
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Every authored roster up-special (DK + Link multiHitRising, Pikachu directionalJump). */
const ROSTER_UP_SPECIALS = [
  { id: 'donkeykong', move: DONKEYKONG_UP_SPECIAL },
  { id: 'pikachu', move: PIKACHU_UP_SPECIAL },
  { id: 'link', move: LINK_UP_SPECIAL },
] as const;

/** Shared AttackMove fields for the synthetic kind fixtures below. */
const fixtureBase = (id: string, startupFrames: number, activeFrames: number, recoveryFrames: number) => ({
  id,
  type: 'upSpecial' as const,
  damage: 3,
  knockback: { x: 0.4, y: -2.2, scaling: 0.12 },
  hitbox: { offsetX: 0, offsetY: -20, width: 50, height: 50 },
  startupFrames,
  activeFrames,
  recoveryFrames,
  cooldownFrames: 20,
  animation: { startupFrames: 2, activeFrames: 3, recoveryFrames: 2 },
});

/**
 * Evenly spaced multi-hit ladder (no explicit `hitFrames`): 4 hits every
 * 5 frames → [0, 5, 10, 15] inside an 18-frame active window. The roster's
 * multiHitRising records author explicit native `hitFrames`, so the
 * interval-ladder path is exercised here.
 */
const MULTI_HIT_FIXTURE: MultiHitRisingUpSpecialMove = Object.freeze({
  ...fixtureBase('fixture.multi_hit_rising', 4, 18, 22),
  upSpecialKind: 'multiHitRising',
  multiHitRising: {
    riseImpulse: -9,
    driftImpulse: 1,
    hitCount: 4,
    hitInterval: 5,
    linkDamage: 2,
    linkKnockback: { x: 0.2, y: -0.8, scaling: 0 },
    launcherDamage: 5,
    launcherKnockback: { x: 1.2, y: -3.0, scaling: 0.2 },
  },
});

/** Synthetic teleport fixture: no roster fighter ships a teleport up special. */
const TELEPORT_FIXTURE: TeleportUpSpecialMove = Object.freeze({
  ...fixtureBase('fixture.teleport', 6, 10, 24),
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  upSpecialKind: 'teleport',
  teleport: { teleportDistance: 280, invincibilityFrames: 10, snapToOctant: true },
});

/** Synthetic tether fixture: maxRange = extensionSpeed × extensionFrames = 24 × 10. */
const TETHER_FIXTURE: TetherUpSpecialMove = Object.freeze({
  ...fixtureBase('fixture.tether', 6, 20, 22),
  upSpecialKind: 'tether',
  tether: {
    maxRange: 240,
    extensionSpeed: 24,
    extensionFrames: 10,
    reelSpeed: 18,
    reelFrames: 10,
    tetherTipDamage: 4,
    tetherTipKnockback: { x: 1.0, y: -1.0, scaling: 0.05 },
    lineWidth: 3,
  },
});

const KIND_FIXTURES = [MULTI_HIT_FIXTURE, TELEPORT_FIXTURE, TETHER_FIXTURE] as const;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe('up-special type guards', () => {
  it('isUpSpecialMove rejects non-upSpecial moves', () => {
    expect(isUpSpecialMove(DONKEYKONG_JAB)).toBe(false);
    expect(isUpSpecialMove(DONKEYKONG_NAIR)).toBe(false);
    // Crucially, a NEUTRAL special is also not an UP special.
    expect(isUpSpecialMove(DONKEYKONG_NEUTRAL_SPECIAL)).toBe(false);
    expect(isUpSpecialMove(PIKACHU_NEUTRAL_SPECIAL)).toBe(false);
    expect(isUpSpecialMove(LINK_NEUTRAL_SPECIAL)).toBe(false);
  });

  it('isUpSpecialMove accepts every authored up-special and every kind fixture', () => {
    for (const { move } of ROSTER_UP_SPECIALS) {
      expect(isUpSpecialMove(move)).toBe(true);
    }
    for (const move of KIND_FIXTURES) {
      expect(isUpSpecialMove(move)).toBe(true);
    }
  });

  it('per-kind type guards classify correctly and exclusively', () => {
    // Donkey Kong and Link = multiHitRising (Spinning Kong, Spin Attack)
    for (const move of [DONKEYKONG_UP_SPECIAL, LINK_UP_SPECIAL, MULTI_HIT_FIXTURE]) {
      expect(isMultiHitRisingUpSpecial(move)).toBe(true);
      expect(isTeleportUpSpecial(move)).toBe(false);
      expect(isDirectionalJumpUpSpecial(move)).toBe(false);
      expect(isTetherUpSpecial(move)).toBe(false);
    }

    // Pikachu = directionalJump (Quick Attack)
    expect(isDirectionalJumpUpSpecial(PIKACHU_UP_SPECIAL)).toBe(true);
    expect(isTeleportUpSpecial(PIKACHU_UP_SPECIAL)).toBe(false);
    expect(isMultiHitRisingUpSpecial(PIKACHU_UP_SPECIAL)).toBe(false);

    // teleport fixture
    expect(isTeleportUpSpecial(TELEPORT_FIXTURE)).toBe(true);
    expect(isMultiHitRisingUpSpecial(TELEPORT_FIXTURE)).toBe(false);

    // tether fixture
    expect(isTetherUpSpecial(TETHER_FIXTURE)).toBe(true);
    expect(isDirectionalJumpUpSpecial(TETHER_FIXTURE)).toBe(false);
  });

  it('isUpSpecialMove rejects a move tagged "upSpecial" without an upSpecialKind', () => {
    const malformed = {
      ...MULTI_HIT_FIXTURE,
      upSpecialKind: undefined,
    } as unknown as UpSpecialMove;
    expect(isUpSpecialMove(malformed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateUpSpecialMove — happy path & rejection cases
// ---------------------------------------------------------------------------

describe('validateUpSpecialMove', () => {
  it('accepts every authored up-special record and every kind fixture', () => {
    for (const { move } of ROSTER_UP_SPECIALS) {
      expect(validateUpSpecialMove(move)).toBe(move);
    }
    for (const move of KIND_FIXTURES) {
      expect(validateUpSpecialMove(move)).toBe(move);
    }
  });

  it('rejects a record whose type is not "upSpecial"', () => {
    const bad = { ...MULTI_HIT_FIXTURE, type: 'jab' } as unknown as UpSpecialMove;
    expect(() => validateUpSpecialMove(bad)).toThrow(/type/);
  });

  // -----------------------------------------------------------------------
  // multiHitRising rejections
  // -----------------------------------------------------------------------

  it('multiHitRising: rejects non-negative riseImpulse (must be upward)', () => {
    const bad: MultiHitRisingUpSpecialMove = {
      ...MULTI_HIT_FIXTURE,
      multiHitRising: { ...MULTI_HIT_FIXTURE.multiHitRising, riseImpulse: 5 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/riseImpulse/);
  });

  it('multiHitRising: rejects hitCount < 1', () => {
    const bad: MultiHitRisingUpSpecialMove = {
      ...MULTI_HIT_FIXTURE,
      multiHitRising: { ...MULTI_HIT_FIXTURE.multiHitRising, hitCount: 0 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/hitCount/);
  });

  it('multiHitRising: rejects hitInterval < 1', () => {
    const bad: MultiHitRisingUpSpecialMove = {
      ...MULTI_HIT_FIXTURE,
      multiHitRising: { ...MULTI_HIT_FIXTURE.multiHitRising, hitInterval: 0 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/hitInterval/);
  });

  it('multiHitRising: rejects final hit past activeFrames', () => {
    const bad: MultiHitRisingUpSpecialMove = {
      ...MULTI_HIT_FIXTURE,
      // 4 hits × 100 interval = final hit at active-frame 300 — way past
      // the 18-frame active window.
      multiHitRising: {
        ...MULTI_HIT_FIXTURE.multiHitRising,
        hitCount: 4,
        hitInterval: 100,
      },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/exceeds activeFrames/);
  });

  it('multiHitRising: rejects negative damage', () => {
    const bad: MultiHitRisingUpSpecialMove = {
      ...MULTI_HIT_FIXTURE,
      multiHitRising: {
        ...MULTI_HIT_FIXTURE.multiHitRising,
        linkDamage: -1,
      },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/non-negative/);
  });

  // -----------------------------------------------------------------------
  // teleport rejections
  // -----------------------------------------------------------------------

  it('teleport: rejects non-positive teleportDistance', () => {
    const bad: TeleportUpSpecialMove = {
      ...TELEPORT_FIXTURE,
      teleport: { ...TELEPORT_FIXTURE.teleport, teleportDistance: 0 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/teleportDistance/);
  });

  it('teleport: rejects negative invincibilityFrames', () => {
    const bad: TeleportUpSpecialMove = {
      ...TELEPORT_FIXTURE,
      teleport: { ...TELEPORT_FIXTURE.teleport, invincibilityFrames: -1 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/invincibilityFrames/);
  });

  it('teleport: rejects invincibilityFrames > activeFrames', () => {
    const bad: TeleportUpSpecialMove = {
      ...TELEPORT_FIXTURE,
      teleport: { ...TELEPORT_FIXTURE.teleport, invincibilityFrames: 999 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/exceeds activeFrames/);
  });

  // -----------------------------------------------------------------------
  // directionalJump rejections
  // -----------------------------------------------------------------------

  it('directionalJump: rejects non-positive burstSpeed', () => {
    const bad: DirectionalJumpUpSpecialMove = {
      ...PIKACHU_UP_SPECIAL,
      directionalJump: { ...PIKACHU_UP_SPECIAL.directionalJump, burstSpeed: 0 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/burstSpeed/);
  });

  it('directionalJump: rejects burstFrames < 1', () => {
    const bad: DirectionalJumpUpSpecialMove = {
      ...PIKACHU_UP_SPECIAL,
      directionalJump: { ...PIKACHU_UP_SPECIAL.directionalJump, burstFrames: 0 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/burstFrames/);
  });

  it('directionalJump: rejects burstFrames > activeFrames', () => {
    const bad: DirectionalJumpUpSpecialMove = {
      ...PIKACHU_UP_SPECIAL,
      directionalJump: {
        ...PIKACHU_UP_SPECIAL.directionalJump,
        burstFrames: 999,
      },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/exceeds activeFrames/);
  });

  // -----------------------------------------------------------------------
  // tether rejections
  // -----------------------------------------------------------------------

  it('tether: rejects non-positive maxRange', () => {
    const bad: TetherUpSpecialMove = {
      ...TETHER_FIXTURE,
      tether: { ...TETHER_FIXTURE.tether, maxRange: 0 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/maxRange/);
  });

  it('tether: rejects mismatched maxRange vs extensionSpeed*extensionFrames', () => {
    const bad: TetherUpSpecialMove = {
      ...TETHER_FIXTURE,
      tether: { ...TETHER_FIXTURE.tether, maxRange: 999 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/maxRange/);
  });

  it('tether: rejects extensionFrames > activeFrames', () => {
    const bad: TetherUpSpecialMove = {
      ...TETHER_FIXTURE,
      tether: {
        ...TETHER_FIXTURE.tether,
        // Inflate extensionFrames AND extensionSpeed/maxRange to keep
        // the maxRange = extensionSpeed * extensionFrames invariant —
        // we want to fail the "extension > active" check, not the
        // "maxRange mismatch" check.
        extensionFrames: 999,
        extensionSpeed: 1,
        maxRange: 999,
      },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/exceeds activeFrames/);
  });

  it('tether: rejects non-positive reelSpeed', () => {
    const bad: TetherUpSpecialMove = {
      ...TETHER_FIXTURE,
      tether: { ...TETHER_FIXTURE.tether, reelSpeed: 0 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/reelSpeed/);
  });

  it('tether: rejects negative tetherTipDamage', () => {
    const bad: TetherUpSpecialMove = {
      ...TETHER_FIXTURE,
      tether: { ...TETHER_FIXTURE.tether, tetherTipDamage: -1 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/tetherTipDamage/);
  });

  it('tether: rejects non-positive lineWidth', () => {
    const bad: TetherUpSpecialMove = {
      ...TETHER_FIXTURE,
      tether: { ...TETHER_FIXTURE.tether, lineWidth: 0 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/lineWidth/);
  });
});

// ---------------------------------------------------------------------------
// 8-direction stick snap (shared by teleport + directionalJump)
// ---------------------------------------------------------------------------

describe('snapStickToOctant', () => {
  it('neutral stick defaults to "up" (0, -1)', () => {
    expect(snapStickToOctant(0, 0)).toEqual({ x: 0, y: -1 });
  });

  it('cardinal directions snap exactly', () => {
    // East (positive X)
    expect(snapStickToOctant(1, 0)).toEqual({ x: 1, y: 0 });
    // West (negative X)
    expect(snapStickToOctant(-1, 0)).toEqual({ x: -1, y: 0 });
    // North (negative Y in Phaser screen space)
    expect(snapStickToOctant(0, -1)).toEqual({ x: 0, y: -1 });
    // South (positive Y)
    expect(snapStickToOctant(0, 1)).toEqual({ x: 0, y: 1 });
  });

  it('diagonals snap to ±√½ on both axes', () => {
    const half = Math.SQRT1_2;
    // Northeast
    const ne = snapStickToOctant(1, -1);
    expect(ne.x).toBeCloseTo(half, 10);
    expect(ne.y).toBeCloseTo(-half, 10);
    // Southwest
    const sw = snapStickToOctant(-1, 1);
    expect(sw.x).toBeCloseTo(-half, 10);
    expect(sw.y).toBeCloseTo(half, 10);
  });

  it('off-axis sticks snap to the nearest of 8 directions', () => {
    // Stick mostly east, slightly north → should snap to East (close
    // to angle 0, which rounds to 0/4).
    const slightlyNorth = snapStickToOctant(1.0, -0.05);
    expect(slightlyNorth).toEqual({ x: 1, y: 0 });

    // Stick mostly north, slightly east → snaps to North (angle near
    // -π/2 which rounds to -π/2 = -2 × π/4).
    const slightlyEast = snapStickToOctant(0.05, -1.0);
    expect(slightlyEast).toEqual({ x: 0, y: -1 });
  });

  it('is deterministic across calls', () => {
    const a = snapStickToOctant(0.7, -0.7);
    const b = snapStickToOctant(0.7, -0.7);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Multi-hit ladder helpers
// ---------------------------------------------------------------------------

describe('multi-hit ladder helpers', () => {
  const ladder = MULTI_HIT_FIXTURE;

  it('computeMultiHitFrames returns hitCount frames spaced by hitInterval', () => {
    const frames = computeMultiHitFrames(ladder.multiHitRising);
    expect(frames.length).toBe(ladder.multiHitRising.hitCount);
    // hitCount=4, hitInterval=5 → [0, 5, 10, 15]
    expect(frames).toEqual([0, 5, 10, 15]);
  });

  it('isMultiHitFrame returns true on hit-spawn frames and false off them', () => {
    // Ladder is [0, 5, 10, 15]
    expect(isMultiHitFrame(ladder.multiHitRising, 0)).toBe(true);
    expect(isMultiHitFrame(ladder.multiHitRising, 1)).toBe(false);
    expect(isMultiHitFrame(ladder.multiHitRising, 4)).toBe(false);
    expect(isMultiHitFrame(ladder.multiHitRising, 5)).toBe(true);
    expect(isMultiHitFrame(ladder.multiHitRising, 10)).toBe(true);
    expect(isMultiHitFrame(ladder.multiHitRising, 15)).toBe(true);
    // Past the last hit but still on a multiple of hitInterval.
    expect(isMultiHitFrame(ladder.multiHitRising, 20)).toBe(false);
  });

  it('isMultiHitFrame rejects negative input', () => {
    expect(isMultiHitFrame(ladder.multiHitRising, -1)).toBe(false);
  });

  it('isFinalLauncherFrame returns true ONLY on the last hit in the ladder', () => {
    // Ladder is [0, 5, 10, 15]; final = 15.
    expect(isFinalLauncherFrame(ladder.multiHitRising, 0)).toBe(false);
    expect(isFinalLauncherFrame(ladder.multiHitRising, 5)).toBe(false);
    expect(isFinalLauncherFrame(ladder.multiHitRising, 10)).toBe(false);
    expect(isFinalLauncherFrame(ladder.multiHitRising, 15)).toBe(true);
    // Off-ladder frame is not the launcher.
    expect(isFinalLauncherFrame(ladder.multiHitRising, 7)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Teleport helpers
// ---------------------------------------------------------------------------

describe('teleport helpers', () => {
  const teleport = TELEPORT_FIXTURE;

  it('computeTeleportDestination applies direction × distance', () => {
    // Up (0, -1) × 280 from (100, 200) → (100, -80)
    const up = computeTeleportDestination(teleport.teleport, 100, 200, { x: 0, y: -1 });
    expect(up).toEqual({ x: 100, y: 200 - teleport.teleport.teleportDistance });
    // East (1, 0) × 280 from (100, 200) → (380, 200)
    const east = computeTeleportDestination(teleport.teleport, 100, 200, { x: 1, y: 0 });
    expect(east).toEqual({ x: 100 + teleport.teleport.teleportDistance, y: 200 });
  });

  it('computeTeleportDestination is deterministic', () => {
    const a = computeTeleportDestination(teleport.teleport, 50, 50, { x: 1, y: 0 });
    const b = computeTeleportDestination(teleport.teleport, 50, 50, { x: 1, y: 0 });
    expect(a).toEqual(b);
  });

  it('isInTeleportInvincibilityWindow respects [0, invincibilityFrames)', () => {
    expect(isInTeleportInvincibilityWindow(teleport, -1)).toBe(false);
    expect(isInTeleportInvincibilityWindow(teleport, 0)).toBe(true);
    expect(isInTeleportInvincibilityWindow(teleport, teleport.teleport.invincibilityFrames - 1)).toBe(true);
    expect(isInTeleportInvincibilityWindow(teleport, teleport.teleport.invincibilityFrames)).toBe(false);
    expect(isInTeleportInvincibilityWindow(teleport, teleport.teleport.invincibilityFrames + 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Directional-jump helpers
// ---------------------------------------------------------------------------

describe('directional-jump helpers', () => {
  const quickAttack = PIKACHU_UP_SPECIAL;

  it('computeBurstVelocity scales the unit direction by burstSpeed', () => {
    // East × 22 → (22, 0)
    const east = computeBurstVelocity(quickAttack.directionalJump, { x: 1, y: 0 });
    expect(east).toEqual({ x: quickAttack.directionalJump.burstSpeed, y: 0 });
    // Up × 22 → (0, -22)
    const up = computeBurstVelocity(quickAttack.directionalJump, { x: 0, y: -1 });
    expect(up).toEqual({ x: 0, y: -quickAttack.directionalJump.burstSpeed });
  });

  it('isInBurstWindow respects [0, burstFrames)', () => {
    expect(isInBurstWindow(quickAttack, -1)).toBe(false);
    expect(isInBurstWindow(quickAttack, 0)).toBe(true);
    expect(isInBurstWindow(quickAttack, quickAttack.directionalJump.burstFrames - 1)).toBe(true);
    expect(isInBurstWindow(quickAttack, quickAttack.directionalJump.burstFrames)).toBe(false);
  });

  it('burst velocity is deterministic', () => {
    const a = computeBurstVelocity(quickAttack.directionalJump, { x: 1, y: 0 });
    const b = computeBurstVelocity(quickAttack.directionalJump, { x: 1, y: 0 });
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Tether helpers
// ---------------------------------------------------------------------------

describe('tether helpers', () => {
  const tether = TETHER_FIXTURE;

  it('computeTetherTipPosition starts at the body and grows linearly', () => {
    // Frame 0: tip at body
    const t0 = computeTetherTipPosition(tether.tether, 100, 200, 1, 0);
    expect(t0).toEqual({ x: 100, y: 200 });
    // Frame 1: tip moved by extensionSpeed in facing direction
    const t1 = computeTetherTipPosition(tether.tether, 100, 200, 1, 1);
    expect(t1).toEqual({ x: 100 + tether.tether.extensionSpeed, y: 200 });
    // Frame extensionFrames: tip at maxRange
    const tFull = computeTetherTipPosition(
      tether.tether,
      100,
      200,
      1,
      tether.tether.extensionFrames,
    );
    expect(tFull).toEqual({ x: 100 + tether.tether.maxRange, y: 200 });
  });

  it('computeTetherTipPosition mirrors by facing', () => {
    // Facing left → tip extends to the LEFT of the body.
    const t1 = computeTetherTipPosition(tether.tether, 100, 200, -1, 1);
    expect(t1).toEqual({ x: 100 - tether.tether.extensionSpeed, y: 200 });
  });

  it('computeTetherTipPosition clamps at maxRange (no over-extension)', () => {
    // Past extensionFrames, tip should still cap at maxRange.
    const tOver = computeTetherTipPosition(
      tether.tether,
      100,
      200,
      1,
      tether.tether.extensionFrames + 100,
    );
    expect(tOver).toEqual({ x: 100 + tether.tether.maxRange, y: 200 });
  });

  it('isTetherFullyExtended fires at and after extensionFrames', () => {
    expect(isTetherFullyExtended(tether.tether, 0)).toBe(false);
    expect(isTetherFullyExtended(tether.tether, tether.tether.extensionFrames - 1)).toBe(false);
    expect(isTetherFullyExtended(tether.tether, tether.tether.extensionFrames)).toBe(true);
    expect(isTetherFullyExtended(tether.tether, tether.tether.extensionFrames + 5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Per-character data — Seed-mandated roster invariants
// ---------------------------------------------------------------------------

describe('per-character up-specials', () => {
  it('every character has exactly one up-special', () => {
    for (const { id } of ROSTER_UP_SPECIALS) {
      const spec = CHARACTER_ROSTER[id];
      const ups = spec.moves.filter((m) => m.type === 'upSpecial');
      expect(ups.length, `${id} ups`).toBe(1);
    }
  });

  it('every up-special id is unique across the roster', () => {
    const ids = ROSTER_UP_SPECIALS.map((e) => e.move.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every up-special id matches its owning character prefix', () => {
    for (const { id, move } of ROSTER_UP_SPECIALS) {
      expect(move.id.startsWith(`${id}.`)).toBe(true);
    }
  });

  it('findMoveByType("upSpecial") returns the up-special for each character', () => {
    for (const { id, move } of ROSTER_UP_SPECIALS) {
      expect(findMoveByType(CHARACTER_ROSTER[id], 'upSpecial')).toBe(move);
    }
  });

  it('declared art-frame counts never exceed gameplay-phase frame counts', () => {
    // Stretch contract — art frames stretch out over gameplay frames,
    // but cannot demand more art frames than the gameplay phase has time
    // to play. Pikachu's Quick Attack is presented by its special runtime
    // and declares no animation block.
    for (const sp of [DONKEYKONG_UP_SPECIAL, LINK_UP_SPECIAL]) {
      const a = sp.animation!;
      expect(a.startupFrames).toBeLessThanOrEqual(sp.startupFrames);
      expect(a.activeFrames).toBeLessThanOrEqual(sp.activeFrames);
      expect(a.recoveryFrames).toBeLessThanOrEqual(sp.recoveryFrames);
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('snapStickToOctant is deterministic', () => {
    const a = snapStickToOctant(0.3, -0.7);
    const b = snapStickToOctant(0.3, -0.7);
    expect(a).toEqual(b);
  });

  it('multi-hit frame computation is deterministic', () => {
    const a = computeMultiHitFrames(MULTI_HIT_FIXTURE.multiHitRising);
    const b = computeMultiHitFrames(MULTI_HIT_FIXTURE.multiHitRising);
    expect(a).toEqual(b);
  });

  it('teleport destination is deterministic', () => {
    const a = computeTeleportDestination(TELEPORT_FIXTURE.teleport, 0, 0, { x: 1, y: 0 });
    const b = computeTeleportDestination(TELEPORT_FIXTURE.teleport, 0, 0, { x: 1, y: 0 });
    expect(a).toEqual(b);
  });

  it('tether tip position is deterministic', () => {
    const a = computeTetherTipPosition(TETHER_FIXTURE.tether, 0, 0, 1, 5);
    const b = computeTetherTipPosition(TETHER_FIXTURE.tether, 0, 0, 1, 5);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// AttackMove compatibility
// ---------------------------------------------------------------------------

describe('AttackMove compatibility (structural subtype)', () => {
  it('every UpSpecialMove has the AttackMove fields', () => {
    for (const sp of [...ROSTER_UP_SPECIALS.map((e) => e.move), ...KIND_FIXTURES]) {
      expect(typeof sp.id).toBe('string');
      expect(sp.type).toBe('upSpecial');
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

  it('grounded triplets are unaffected by the up-special slot wiring', () => {
    // Sanity: jab still resolves to type='jab'; the new up-special slot
    // should not have leaked through and reclassified anything.
    expect(DONKEYKONG_JAB.type).toBe('jab');
    expect(PIKACHU_JAB.type).toBe('jab');
    expect(LINK_JAB.type).toBe('jab');
  });

  it('neutral specials are still type="special" and distinct from up-specials', () => {
    // The new MoveType union added 'upSpecial' alongside 'special'; the
    // existing neutral specials must not have been retagged.
    expect(DONKEYKONG_NEUTRAL_SPECIAL.type).toBe('special');
    expect(PIKACHU_NEUTRAL_SPECIAL.type).toBe('special');
    expect(LINK_NEUTRAL_SPECIAL.type).toBe('special');
    // And the up-specials are NOT type='special' (they're 'upSpecial').
    for (const { move } of ROSTER_UP_SPECIALS) {
      expect(move.type).toBe('upSpecial');
    }
  });

  it('every character ships BOTH a neutral special AND an up special (the two slots are independent)', () => {
    for (const { id } of ROSTER_UP_SPECIALS) {
      const spec = CHARACTER_ROSTER[id];
      expect(findMoveByType(spec, 'special'), `${id} special`).toBeDefined();
      expect(findMoveByType(spec, 'upSpecial'), `${id} upSpecial`).toBeDefined();
      // And they must be distinct moves.
      expect(findMoveByType(spec, 'special')).not.toBe(findMoveByType(spec, 'upSpecial'));
    }
  });
});
