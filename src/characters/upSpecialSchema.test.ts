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
  WOLF_UP_SPECIAL,
  CAT_UP_SPECIAL,
  OWL_UP_SPECIAL,
  BEAR_UP_SPECIAL,
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
} from './index';
import { CHARACTER_ROSTER, findMoveByType } from './roster';

/**
 * AC 60202 Sub-AC 2 — up-special schema + per-character up-special
 * data records.
 *
 * The schema module is pure (no Phaser, no Matter, no Math.random,
 * no wall-clock). This suite locks down:
 *
 *   1. Type guards correctly classify the four kinds.
 *   2. Schema validators reject malformed records and accept all four
 *      authored records.
 *   3. 8-direction stick snap is a pure function with the canonical
 *      output set (8 unit vectors + neutral default).
 *   4. Multi-hit ladder helpers produce correct hit-spawn frames.
 *   5. Teleport / burst window predicates respect their boundaries.
 *   6. Tether tip-position math grows linearly to maxRange.
 *   7. Per-character data — each authored up-special passes the schema
 *      AND the Seed roster invariants (every character has exactly
 *      one up special, kinds are pairwise distinct, ids are unique).
 *   8. Roster integration — `CHARACTER_ROSTER[id].moves` exposes the
 *      up-special and `findMoveByType(spec, 'upSpecial')` returns it.
 *   9. Up-special and neutral-special coexist as distinct moves on
 *      every character (the slot wiring keeps them independent).
 */

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe('up-special type guards', () => {
  it('isUpSpecialMove rejects non-upSpecial moves', () => {
    expect(isUpSpecialMove(WOLF_JAB)).toBe(false);
    expect(isUpSpecialMove(WOLF_NAIR)).toBe(false);
    // Crucially, a NEUTRAL special is also not an UP special.
    expect(isUpSpecialMove(WOLF_NEUTRAL_SPECIAL)).toBe(false);
    expect(isUpSpecialMove(CAT_NEUTRAL_SPECIAL)).toBe(false);
    expect(isUpSpecialMove(OWL_NEUTRAL_SPECIAL)).toBe(false);
    expect(isUpSpecialMove(BEAR_NEUTRAL_SPECIAL)).toBe(false);
  });

  it('isUpSpecialMove accepts every authored up-special', () => {
    expect(isUpSpecialMove(WOLF_UP_SPECIAL)).toBe(true);
    expect(isUpSpecialMove(CAT_UP_SPECIAL)).toBe(true);
    expect(isUpSpecialMove(OWL_UP_SPECIAL)).toBe(true);
    expect(isUpSpecialMove(BEAR_UP_SPECIAL)).toBe(true);
  });

  it('per-kind type guards classify correctly and exclusively', () => {
    // Wolf = multiHitRising
    expect(isMultiHitRisingUpSpecial(WOLF_UP_SPECIAL)).toBe(true);
    expect(isTeleportUpSpecial(WOLF_UP_SPECIAL)).toBe(false);
    expect(isDirectionalJumpUpSpecial(WOLF_UP_SPECIAL)).toBe(false);
    expect(isTetherUpSpecial(WOLF_UP_SPECIAL)).toBe(false);

    // Cat = teleport
    expect(isTeleportUpSpecial(CAT_UP_SPECIAL)).toBe(true);
    expect(isMultiHitRisingUpSpecial(CAT_UP_SPECIAL)).toBe(false);

    // Owl = directionalJump
    expect(isDirectionalJumpUpSpecial(OWL_UP_SPECIAL)).toBe(true);
    expect(isTeleportUpSpecial(OWL_UP_SPECIAL)).toBe(false);

    // Bear = tether
    expect(isTetherUpSpecial(BEAR_UP_SPECIAL)).toBe(true);
    expect(isDirectionalJumpUpSpecial(BEAR_UP_SPECIAL)).toBe(false);
  });

  it('isUpSpecialMove rejects a move tagged "upSpecial" without an upSpecialKind', () => {
    const malformed = {
      ...WOLF_UP_SPECIAL,
      upSpecialKind: undefined,
    } as unknown as UpSpecialMove;
    expect(isUpSpecialMove(malformed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateUpSpecialMove — happy path & rejection cases
// ---------------------------------------------------------------------------

describe('validateUpSpecialMove', () => {
  it('accepts every authored up-special record', () => {
    expect(validateUpSpecialMove(WOLF_UP_SPECIAL)).toBe(WOLF_UP_SPECIAL);
    expect(validateUpSpecialMove(CAT_UP_SPECIAL)).toBe(CAT_UP_SPECIAL);
    expect(validateUpSpecialMove(OWL_UP_SPECIAL)).toBe(OWL_UP_SPECIAL);
    expect(validateUpSpecialMove(BEAR_UP_SPECIAL)).toBe(BEAR_UP_SPECIAL);
  });

  it('rejects a record whose type is not "upSpecial"', () => {
    const bad = { ...WOLF_UP_SPECIAL, type: 'jab' } as unknown as UpSpecialMove;
    expect(() => validateUpSpecialMove(bad)).toThrow(/type/);
  });

  // -----------------------------------------------------------------------
  // multiHitRising rejections
  // -----------------------------------------------------------------------

  it('multiHitRising: rejects non-negative riseImpulse (must be upward)', () => {
    const bad: MultiHitRisingUpSpecialMove = {
      ...WOLF_UP_SPECIAL,
      multiHitRising: { ...WOLF_UP_SPECIAL.multiHitRising, riseImpulse: 5 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/riseImpulse/);
  });

  it('multiHitRising: rejects hitCount < 1', () => {
    const bad: MultiHitRisingUpSpecialMove = {
      ...WOLF_UP_SPECIAL,
      multiHitRising: { ...WOLF_UP_SPECIAL.multiHitRising, hitCount: 0 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/hitCount/);
  });

  it('multiHitRising: rejects hitInterval < 1', () => {
    const bad: MultiHitRisingUpSpecialMove = {
      ...WOLF_UP_SPECIAL,
      multiHitRising: { ...WOLF_UP_SPECIAL.multiHitRising, hitInterval: 0 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/hitInterval/);
  });

  it('multiHitRising: rejects final hit past activeFrames', () => {
    const bad: MultiHitRisingUpSpecialMove = {
      ...WOLF_UP_SPECIAL,
      // 4 hits × 100 interval = final hit at active-frame 300 — way past
      // the 18-frame active window.
      multiHitRising: {
        ...WOLF_UP_SPECIAL.multiHitRising,
        hitCount: 4,
        hitInterval: 100,
      },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/exceeds activeFrames/);
  });

  it('multiHitRising: rejects negative damage', () => {
    const bad: MultiHitRisingUpSpecialMove = {
      ...WOLF_UP_SPECIAL,
      multiHitRising: {
        ...WOLF_UP_SPECIAL.multiHitRising,
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
      ...CAT_UP_SPECIAL,
      teleport: { ...CAT_UP_SPECIAL.teleport, teleportDistance: 0 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/teleportDistance/);
  });

  it('teleport: rejects negative invincibilityFrames', () => {
    const bad: TeleportUpSpecialMove = {
      ...CAT_UP_SPECIAL,
      teleport: { ...CAT_UP_SPECIAL.teleport, invincibilityFrames: -1 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/invincibilityFrames/);
  });

  it('teleport: rejects invincibilityFrames > activeFrames', () => {
    const bad: TeleportUpSpecialMove = {
      ...CAT_UP_SPECIAL,
      teleport: { ...CAT_UP_SPECIAL.teleport, invincibilityFrames: 999 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/exceeds activeFrames/);
  });

  // -----------------------------------------------------------------------
  // directionalJump rejections
  // -----------------------------------------------------------------------

  it('directionalJump: rejects non-positive burstSpeed', () => {
    const bad: DirectionalJumpUpSpecialMove = {
      ...OWL_UP_SPECIAL,
      directionalJump: { ...OWL_UP_SPECIAL.directionalJump, burstSpeed: 0 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/burstSpeed/);
  });

  it('directionalJump: rejects burstFrames < 1', () => {
    const bad: DirectionalJumpUpSpecialMove = {
      ...OWL_UP_SPECIAL,
      directionalJump: { ...OWL_UP_SPECIAL.directionalJump, burstFrames: 0 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/burstFrames/);
  });

  it('directionalJump: rejects burstFrames > activeFrames', () => {
    const bad: DirectionalJumpUpSpecialMove = {
      ...OWL_UP_SPECIAL,
      directionalJump: {
        ...OWL_UP_SPECIAL.directionalJump,
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
      ...BEAR_UP_SPECIAL,
      tether: { ...BEAR_UP_SPECIAL.tether, maxRange: 0 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/maxRange/);
  });

  it('tether: rejects mismatched maxRange vs extensionSpeed*extensionFrames', () => {
    const bad: TetherUpSpecialMove = {
      ...BEAR_UP_SPECIAL,
      tether: { ...BEAR_UP_SPECIAL.tether, maxRange: 999 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/maxRange/);
  });

  it('tether: rejects extensionFrames > activeFrames', () => {
    const bad: TetherUpSpecialMove = {
      ...BEAR_UP_SPECIAL,
      tether: {
        ...BEAR_UP_SPECIAL.tether,
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
      ...BEAR_UP_SPECIAL,
      tether: { ...BEAR_UP_SPECIAL.tether, reelSpeed: 0 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/reelSpeed/);
  });

  it('tether: rejects negative tetherTipDamage', () => {
    const bad: TetherUpSpecialMove = {
      ...BEAR_UP_SPECIAL,
      tether: { ...BEAR_UP_SPECIAL.tether, tetherTipDamage: -1 },
    };
    expect(() => validateUpSpecialMove(bad)).toThrow(/tetherTipDamage/);
  });

  it('tether: rejects non-positive lineWidth', () => {
    const bad: TetherUpSpecialMove = {
      ...BEAR_UP_SPECIAL,
      tether: { ...BEAR_UP_SPECIAL.tether, lineWidth: 0 },
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
  const wolf = WOLF_UP_SPECIAL;

  it('computeMultiHitFrames returns hitCount frames spaced by hitInterval', () => {
    const frames = computeMultiHitFrames(wolf.multiHitRising);
    expect(frames.length).toBe(wolf.multiHitRising.hitCount);
    // Wolf: hitCount=4, hitInterval=5 → [0, 5, 10, 15]
    expect(frames).toEqual([0, 5, 10, 15]);
  });

  it('isMultiHitFrame returns true on hit-spawn frames and false off them', () => {
    // Wolf ladder is [0, 5, 10, 15]
    expect(isMultiHitFrame(wolf.multiHitRising, 0)).toBe(true);
    expect(isMultiHitFrame(wolf.multiHitRising, 1)).toBe(false);
    expect(isMultiHitFrame(wolf.multiHitRising, 4)).toBe(false);
    expect(isMultiHitFrame(wolf.multiHitRising, 5)).toBe(true);
    expect(isMultiHitFrame(wolf.multiHitRising, 10)).toBe(true);
    expect(isMultiHitFrame(wolf.multiHitRising, 15)).toBe(true);
    // Past the last hit but still on a multiple of hitInterval.
    expect(isMultiHitFrame(wolf.multiHitRising, 20)).toBe(false);
  });

  it('isMultiHitFrame rejects negative input', () => {
    expect(isMultiHitFrame(wolf.multiHitRising, -1)).toBe(false);
  });

  it('isFinalLauncherFrame returns true ONLY on the last hit in the ladder', () => {
    // Wolf ladder is [0, 5, 10, 15]; final = 15.
    expect(isFinalLauncherFrame(wolf.multiHitRising, 0)).toBe(false);
    expect(isFinalLauncherFrame(wolf.multiHitRising, 5)).toBe(false);
    expect(isFinalLauncherFrame(wolf.multiHitRising, 10)).toBe(false);
    expect(isFinalLauncherFrame(wolf.multiHitRising, 15)).toBe(true);
    // Off-ladder frame is not the launcher.
    expect(isFinalLauncherFrame(wolf.multiHitRising, 7)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Teleport helpers
// ---------------------------------------------------------------------------

describe('teleport helpers', () => {
  const cat = CAT_UP_SPECIAL;

  it('computeTeleportDestination applies direction × distance', () => {
    // Up (0, -1) × 280 from (100, 200) → (100, -80)
    const up = computeTeleportDestination(cat.teleport, 100, 200, { x: 0, y: -1 });
    expect(up).toEqual({ x: 100, y: 200 - cat.teleport.teleportDistance });
    // East (1, 0) × 280 from (100, 200) → (380, 200)
    const east = computeTeleportDestination(cat.teleport, 100, 200, { x: 1, y: 0 });
    expect(east).toEqual({ x: 100 + cat.teleport.teleportDistance, y: 200 });
  });

  it('computeTeleportDestination is deterministic', () => {
    const a = computeTeleportDestination(cat.teleport, 50, 50, { x: 1, y: 0 });
    const b = computeTeleportDestination(cat.teleport, 50, 50, { x: 1, y: 0 });
    expect(a).toEqual(b);
  });

  it('isInTeleportInvincibilityWindow respects [0, invincibilityFrames)', () => {
    expect(isInTeleportInvincibilityWindow(cat, -1)).toBe(false);
    expect(isInTeleportInvincibilityWindow(cat, 0)).toBe(true);
    expect(isInTeleportInvincibilityWindow(cat, cat.teleport.invincibilityFrames - 1)).toBe(true);
    expect(isInTeleportInvincibilityWindow(cat, cat.teleport.invincibilityFrames)).toBe(false);
    expect(isInTeleportInvincibilityWindow(cat, cat.teleport.invincibilityFrames + 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Directional-jump helpers
// ---------------------------------------------------------------------------

describe('directional-jump helpers', () => {
  const owl = OWL_UP_SPECIAL;

  it('computeBurstVelocity scales the unit direction by burstSpeed', () => {
    // East × 22 → (22, 0)
    const east = computeBurstVelocity(owl.directionalJump, { x: 1, y: 0 });
    expect(east).toEqual({ x: owl.directionalJump.burstSpeed, y: 0 });
    // Up × 22 → (0, -22)
    const up = computeBurstVelocity(owl.directionalJump, { x: 0, y: -1 });
    expect(up).toEqual({ x: 0, y: -owl.directionalJump.burstSpeed });
  });

  it('isInBurstWindow respects [0, burstFrames)', () => {
    expect(isInBurstWindow(owl, -1)).toBe(false);
    expect(isInBurstWindow(owl, 0)).toBe(true);
    expect(isInBurstWindow(owl, owl.directionalJump.burstFrames - 1)).toBe(true);
    expect(isInBurstWindow(owl, owl.directionalJump.burstFrames)).toBe(false);
  });

  it('burst velocity is deterministic', () => {
    const a = computeBurstVelocity(owl.directionalJump, { x: 1, y: 0 });
    const b = computeBurstVelocity(owl.directionalJump, { x: 1, y: 0 });
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Tether helpers
// ---------------------------------------------------------------------------

describe('tether helpers', () => {
  const bear = BEAR_UP_SPECIAL;

  it('computeTetherTipPosition starts at the body and grows linearly', () => {
    // Frame 0: tip at body
    const t0 = computeTetherTipPosition(bear.tether, 100, 200, 1, 0);
    expect(t0).toEqual({ x: 100, y: 200 });
    // Frame 1: tip moved by extensionSpeed in facing direction
    const t1 = computeTetherTipPosition(bear.tether, 100, 200, 1, 1);
    expect(t1).toEqual({ x: 100 + bear.tether.extensionSpeed, y: 200 });
    // Frame extensionFrames: tip at maxRange
    const tFull = computeTetherTipPosition(
      bear.tether,
      100,
      200,
      1,
      bear.tether.extensionFrames,
    );
    expect(tFull).toEqual({ x: 100 + bear.tether.maxRange, y: 200 });
  });

  it('computeTetherTipPosition mirrors by facing', () => {
    // Facing left → tip extends to the LEFT of the body.
    const t1 = computeTetherTipPosition(bear.tether, 100, 200, -1, 1);
    expect(t1).toEqual({ x: 100 - bear.tether.extensionSpeed, y: 200 });
  });

  it('computeTetherTipPosition clamps at maxRange (no over-extension)', () => {
    // Past extensionFrames, tip should still cap at maxRange.
    const tOver = computeTetherTipPosition(
      bear.tether,
      100,
      200,
      1,
      bear.tether.extensionFrames + 100,
    );
    expect(tOver).toEqual({ x: 100 + bear.tether.maxRange, y: 200 });
  });

  it('isTetherFullyExtended fires at and after extensionFrames', () => {
    expect(isTetherFullyExtended(bear.tether, 0)).toBe(false);
    expect(isTetherFullyExtended(bear.tether, bear.tether.extensionFrames - 1)).toBe(false);
    expect(isTetherFullyExtended(bear.tether, bear.tether.extensionFrames)).toBe(true);
    expect(isTetherFullyExtended(bear.tether, bear.tether.extensionFrames + 5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Per-character data — Seed-mandated roster invariants
// ---------------------------------------------------------------------------

describe('per-character up-specials', () => {
  it('every character has exactly one up-special', () => {
    for (const id of ['wolf', 'cat', 'owl', 'bear'] as const) {
      const spec = CHARACTER_ROSTER[id];
      const ups = spec.moves.filter((m) => m.type === 'upSpecial');
      expect(ups.length, `${id} ups`).toBe(1);
    }
  });

  it('the four characters use four distinct kinds (Seed: unique mechanics)', () => {
    const kinds = new Set([
      WOLF_UP_SPECIAL.upSpecialKind,
      CAT_UP_SPECIAL.upSpecialKind,
      OWL_UP_SPECIAL.upSpecialKind,
      BEAR_UP_SPECIAL.upSpecialKind,
    ]);
    expect(kinds.size).toBe(4);
    expect(kinds.has('multiHitRising')).toBe(true);
    expect(kinds.has('teleport')).toBe(true);
    expect(kinds.has('directionalJump')).toBe(true);
    expect(kinds.has('tether')).toBe(true);
  });

  it('every up-special id is unique across the roster', () => {
    const ids = [
      WOLF_UP_SPECIAL.id,
      CAT_UP_SPECIAL.id,
      OWL_UP_SPECIAL.id,
      BEAR_UP_SPECIAL.id,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every up-special id matches its owning character prefix', () => {
    expect(WOLF_UP_SPECIAL.id).toMatch(/^wolf\./);
    expect(CAT_UP_SPECIAL.id).toMatch(/^cat\./);
    expect(OWL_UP_SPECIAL.id).toMatch(/^owl\./);
    expect(BEAR_UP_SPECIAL.id).toMatch(/^bear\./);
  });

  it('findMoveByType("upSpecial") returns the up-special for each character', () => {
    expect(findMoveByType(CHARACTER_ROSTER.wolf, 'upSpecial')).toBe(WOLF_UP_SPECIAL);
    expect(findMoveByType(CHARACTER_ROSTER.cat, 'upSpecial')).toBe(CAT_UP_SPECIAL);
    expect(findMoveByType(CHARACTER_ROSTER.owl, 'upSpecial')).toBe(OWL_UP_SPECIAL);
    expect(findMoveByType(CHARACTER_ROSTER.bear, 'upSpecial')).toBe(BEAR_UP_SPECIAL);
  });

  it('every up-special declares an animation block (renderer integration)', () => {
    for (const sp of [WOLF_UP_SPECIAL, CAT_UP_SPECIAL, OWL_UP_SPECIAL, BEAR_UP_SPECIAL]) {
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
    // Stretch contract — art frames stretch out over gameplay frames,
    // but cannot demand more art frames than the gameplay phase has time
    // to play.
    for (const sp of [WOLF_UP_SPECIAL, CAT_UP_SPECIAL, OWL_UP_SPECIAL, BEAR_UP_SPECIAL]) {
      const a = sp.animation!;
      expect(a.startupFrames).toBeLessThanOrEqual(sp.startupFrames);
      expect(a.activeFrames).toBeLessThanOrEqual(sp.activeFrames);
      expect(a.recoveryFrames).toBeLessThanOrEqual(sp.recoveryFrames);
    }
  });
});

// ---------------------------------------------------------------------------
// Recovery-archetype invariants — the move family has a job to do
// ---------------------------------------------------------------------------

describe('recovery-archetype invariants', () => {
  it('Wolf rises (negative riseImpulse — upward in Phaser screen-space)', () => {
    expect(WOLF_UP_SPECIAL.multiHitRising.riseImpulse).toBeLessThan(0);
  });

  it('Wolf lands the final launcher inside the active window', () => {
    const r = WOLF_UP_SPECIAL.multiHitRising;
    const finalOffset = (r.hitCount - 1) * r.hitInterval;
    expect(finalOffset).toBeLessThan(WOLF_UP_SPECIAL.activeFrames);
  });

  it('Cat teleports a meaningful distance', () => {
    // teleportDistance must be enough to actually save a stock —
    // longer than a typical jump arc (~150-200 px).
    expect(CAT_UP_SPECIAL.teleport.teleportDistance).toBeGreaterThan(200);
  });

  it('Cat is invincible during the entire vanish (active phase)', () => {
    // Invincibility must cover the whole active window so Cat cannot be
    // hit during the vanish.
    expect(CAT_UP_SPECIAL.teleport.invincibilityFrames).toBe(CAT_UP_SPECIAL.activeFrames);
  });

  it('Owl bursts at high speed for the entire active phase', () => {
    expect(OWL_UP_SPECIAL.directionalJump.burstSpeed).toBeGreaterThan(15);
    expect(OWL_UP_SPECIAL.directionalJump.burstFrames).toBe(OWL_UP_SPECIAL.activeFrames);
  });

  it('Owl enters helpless state after the burst', () => {
    expect(OWL_UP_SPECIAL.directionalJump.helplessAfterBurst).toBe(true);
  });

  it('Bear extension reaches maxRange in exactly extensionFrames', () => {
    const t = BEAR_UP_SPECIAL.tether;
    expect(t.extensionSpeed * t.extensionFrames).toBe(t.maxRange);
  });

  it('Bear extension fits inside the active window', () => {
    expect(BEAR_UP_SPECIAL.tether.extensionFrames).toBeLessThanOrEqual(BEAR_UP_SPECIAL.activeFrames);
  });

  it('Bear tether reach is the longest single-direction recovery anchor in the cast', () => {
    // Bear's grappler identity demands a long-reach tether — > 200 px.
    expect(BEAR_UP_SPECIAL.tether.maxRange).toBeGreaterThan(200);
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
    const a = computeMultiHitFrames(WOLF_UP_SPECIAL.multiHitRising);
    const b = computeMultiHitFrames(WOLF_UP_SPECIAL.multiHitRising);
    expect(a).toEqual(b);
  });

  it('teleport destination is deterministic', () => {
    const a = computeTeleportDestination(CAT_UP_SPECIAL.teleport, 0, 0, { x: 1, y: 0 });
    const b = computeTeleportDestination(CAT_UP_SPECIAL.teleport, 0, 0, { x: 1, y: 0 });
    expect(a).toEqual(b);
  });

  it('tether tip position is deterministic', () => {
    const a = computeTetherTipPosition(BEAR_UP_SPECIAL.tether, 0, 0, 1, 5);
    const b = computeTetherTipPosition(BEAR_UP_SPECIAL.tether, 0, 0, 1, 5);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// AttackMove compatibility
// ---------------------------------------------------------------------------

describe('AttackMove compatibility (structural subtype)', () => {
  it('every UpSpecialMove has the AttackMove fields', () => {
    for (const sp of [WOLF_UP_SPECIAL, CAT_UP_SPECIAL, OWL_UP_SPECIAL, BEAR_UP_SPECIAL]) {
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
    expect(WOLF_JAB.type).toBe('jab');
    expect(CAT_JAB.type).toBe('jab');
    expect(OWL_JAB.type).toBe('jab');
    expect(BEAR_JAB.type).toBe('jab');
  });

  it('neutral specials are still type="special" and distinct from up-specials', () => {
    // The new MoveType union added 'upSpecial' alongside 'special'; the
    // existing neutral specials must not have been retagged.
    expect(WOLF_NEUTRAL_SPECIAL.type).toBe('special');
    expect(CAT_NEUTRAL_SPECIAL.type).toBe('special');
    expect(OWL_NEUTRAL_SPECIAL.type).toBe('special');
    expect(BEAR_NEUTRAL_SPECIAL.type).toBe('special');
    // And the up-specials are NOT type='special' (they're 'upSpecial').
    expect(WOLF_UP_SPECIAL.type).toBe('upSpecial');
    expect(CAT_UP_SPECIAL.type).toBe('upSpecial');
    expect(OWL_UP_SPECIAL.type).toBe('upSpecial');
    expect(BEAR_UP_SPECIAL.type).toBe('upSpecial');
  });

  it('every character ships BOTH a neutral special AND an up special (the two slots are independent)', () => {
    for (const id of ['wolf', 'cat', 'owl', 'bear'] as const) {
      const spec = CHARACTER_ROSTER[id];
      expect(findMoveByType(spec, 'special'), `${id} special`).toBeDefined();
      expect(findMoveByType(spec, 'upSpecial'), `${id} upSpecial`).toBeDefined();
      // And they must be distinct moves.
      expect(findMoveByType(spec, 'special')).not.toBe(findMoveByType(spec, 'upSpecial'));
    }
  });
});
