import { describe, it, expect } from 'vitest';
import {
  LEDGE_DETECTION_DEFAULTS,
  detectLedgeGrab,
  isEligibleForLedgeGrab,
  isWithinLedgeRadius,
  ledgeCandidatesEqual,
  ledgeCandidatesFromPlatform,
  type FighterBounds,
  type LedgeCandidate,
} from './ledgeDetection';

/**
 * AC 60403 Sub-AC 3 — Ledge / edge-grab geometric detection.
 *
 * The detection module is the geometric half of the edge-grab feature:
 * given a fighter's bounding box + velocity + facing, and a list of
 * grabbable ledge corners, decide which (if any) the fighter is
 * currently overlapping. The state-machine half (`ledgeHangState.ts`)
 * is tested separately. These tests lock down:
 *
 *   1. Construction — defaults are sane / per-call radii derive from
 *      the fighter's body when not pinned via tuning.
 *   2. Eligibility — falling/stationary fighters can grab; rising can't;
 *      facing rule blocks back-side grabs by default; opt-out works.
 *   3. Geometric overlap — the body-vs-corner radius check matches
 *      Smash convention (silhouette straddles corner).
 *   4. Composition — `detectLedgeGrab` returns the closest matching
 *      candidate; null when no candidate matches.
 *   5. Helpers — `ledgeCandidatesFromPlatform` emits both corners with
 *      correct geometry; `ledgeCandidatesEqual` matches by
 *      (platformId, side).
 *   6. Determinism — identical inputs always produce identical outputs.
 */

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeBounds(overrides: Partial<FighterBounds> = {}): FighterBounds {
  return {
    centerX: 0,
    centerY: 0,
    halfWidth: 45,
    halfHeight: 65,
    velocityY: 1,
    facing: 1,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<LedgeCandidate> = {}): LedgeCandidate {
  return {
    platformId: 'plat',
    side: 'right',
    x: 0,
    y: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe('LEDGE_DETECTION_DEFAULTS', () => {
  it('has sane non-derived defaults', () => {
    expect(LEDGE_DETECTION_DEFAULTS.minDescendVelocity).toBe(0);
    // Smash-faithful: ledge grab is facing-agnostic by default (recovering
    // fighters face the stage, i.e. away from the ledge's outer side).
    expect(LEDGE_DETECTION_DEFAULTS.requireFacing).toBe(false);
  });

  it('does not pin per-call radii (derived from fighter body)', () => {
    expect(LEDGE_DETECTION_DEFAULTS.horizontalRadius).toBeUndefined();
    expect(LEDGE_DETECTION_DEFAULTS.verticalRadiusUp).toBeUndefined();
    expect(LEDGE_DETECTION_DEFAULTS.verticalRadiusDown).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

describe('isEligibleForLedgeGrab', () => {
  it('accepts a falling fighter facing the right corner', () => {
    const bounds = makeBounds({ velocityY: 5, facing: 1 });
    const candidate = makeCandidate({ side: 'right' });
    expect(isEligibleForLedgeGrab(bounds, candidate)).toBe(true);
  });

  it('rejects a rising fighter (velocityY < 0)', () => {
    const bounds = makeBounds({ velocityY: -5, facing: 1 });
    const candidate = makeCandidate({ side: 'right' });
    expect(isEligibleForLedgeGrab(bounds, candidate)).toBe(false);
  });

  it('accepts a stationary fighter (velocityY === 0)', () => {
    const bounds = makeBounds({ velocityY: 0, facing: 1 });
    const candidate = makeCandidate({ side: 'right' });
    expect(isEligibleForLedgeGrab(bounds, candidate)).toBe(true);
  });

  it('accepts either facing by default (Smash-faithful, facing-agnostic)', () => {
    const left = makeCandidate({ side: 'left' });
    const right = makeCandidate({ side: 'right' });
    // A fighter recovering inward faces away from the ledge's outer side;
    // the default must still let them grab it.
    expect(isEligibleForLedgeGrab(makeBounds({ facing: 1 }), left)).toBe(true);
    expect(isEligibleForLedgeGrab(makeBounds({ facing: -1 }), right)).toBe(true);
  });

  it('honours requireFacing=true to reject a right-facing fighter at a left ledge', () => {
    const bounds = makeBounds({ facing: 1 });
    const candidate = makeCandidate({ side: 'left' });
    expect(
      isEligibleForLedgeGrab(bounds, candidate, { requireFacing: true }),
    ).toBe(false);
  });

  it('honours requireFacing=true to reject a left-facing fighter at a right ledge', () => {
    const bounds = makeBounds({ facing: -1 });
    const candidate = makeCandidate({ side: 'right' });
    expect(
      isEligibleForLedgeGrab(bounds, candidate, { requireFacing: true }),
    ).toBe(false);
  });

  it('honours minDescendVelocity threshold', () => {
    const bounds = makeBounds({ velocityY: 0.5 });
    const candidate = makeCandidate({ side: 'right' });
    expect(
      isEligibleForLedgeGrab(bounds, candidate, { minDescendVelocity: 1 }),
    ).toBe(false);
    expect(
      isEligibleForLedgeGrab(bounds, candidate, { minDescendVelocity: 0.4 }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Geometric overlap
// ---------------------------------------------------------------------------

describe('isWithinLedgeRadius', () => {
  it('matches when corner is at fighter centre', () => {
    const bounds = makeBounds({ centerX: 0, centerY: 0 });
    const candidate = makeCandidate({ x: 0, y: 0 });
    expect(isWithinLedgeRadius(bounds, candidate)).toBe(true);
  });

  it('matches when corner sits inside the fighter silhouette', () => {
    const bounds = makeBounds({ centerX: 100, centerY: 200 });
    const candidate = makeCandidate({ x: 130, y: 210 });
    expect(isWithinLedgeRadius(bounds, candidate)).toBe(true);
  });

  it('rejects a corner just outside the horizontal radius', () => {
    const bounds = makeBounds({ centerX: 0, centerY: 0, halfWidth: 45 });
    const candidate = makeCandidate({ x: 50, y: 0 });
    expect(isWithinLedgeRadius(bounds, candidate)).toBe(false);
  });

  it('rejects a corner above the fighter', () => {
    const bounds = makeBounds({ centerX: 0, centerY: 0, halfHeight: 65 });
    const candidate = makeCandidate({ x: 0, y: -100 });
    expect(isWithinLedgeRadius(bounds, candidate)).toBe(false);
  });

  it('rejects a corner below the fighter', () => {
    const bounds = makeBounds({ centerX: 0, centerY: 0, halfHeight: 65 });
    const candidate = makeCandidate({ x: 0, y: 100 });
    expect(isWithinLedgeRadius(bounds, candidate)).toBe(false);
  });

  it('honours an explicit horizontalRadius override', () => {
    const bounds = makeBounds({ centerX: 0, halfWidth: 45 });
    const candidate = makeCandidate({ x: 30, y: 0 });
    expect(isWithinLedgeRadius(bounds, candidate)).toBe(true);
    expect(isWithinLedgeRadius(bounds, candidate, { horizontalRadius: 20 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Composition: detectLedgeGrab
// ---------------------------------------------------------------------------

describe('detectLedgeGrab', () => {
  it('returns null for an empty candidate list', () => {
    const bounds = makeBounds();
    expect(detectLedgeGrab(bounds, [])).toBeNull();
  });

  it('returns null when no candidate matches', () => {
    const bounds = makeBounds({ centerX: 0, velocityY: -5 });
    const candidate = makeCandidate({ x: 0, y: 0 });
    expect(detectLedgeGrab(bounds, [candidate])).toBeNull();
  });

  it('returns the matching candidate with computed latch coordinates', () => {
    const bounds = makeBounds({ centerX: 100, centerY: 100, halfHeight: 65 });
    const candidate = makeCandidate({ x: 100, y: 100, side: 'right' });
    const result = detectLedgeGrab(bounds, [candidate]);
    expect(result).not.toBeNull();
    expect(result!.candidate).toBe(candidate);
    expect(result!.latchX).toBe(100);
    // latchY = ledge.y + halfHeight
    expect(result!.latchY).toBe(165);
  });

  it('returns the closest candidate when multiple match', () => {
    const bounds = makeBounds({ centerX: 0, centerY: 0, halfWidth: 60, halfHeight: 80 });
    const closer = makeCandidate({ platformId: 'a', side: 'right', x: 10, y: 0 });
    const farther = makeCandidate({ platformId: 'b', side: 'right', x: 50, y: 0 });
    const result = detectLedgeGrab(bounds, [farther, closer]);
    expect(result?.candidate.platformId).toBe('a');
  });

  it('skips ineligible candidates (facing mismatch) when requireFacing opted in', () => {
    const bounds = makeBounds({ facing: 1 });
    const wrongSide = makeCandidate({ side: 'left' });
    const rightSide = makeCandidate({ side: 'right' });
    const result = detectLedgeGrab(bounds, [wrongSide, rightSide], {
      requireFacing: true,
    });
    expect(result?.candidate).toBe(rightSide);
  });

  it('is deterministic — identical inputs always return the same detection', () => {
    const bounds = makeBounds({ centerX: 5, centerY: 10 });
    const candidate = makeCandidate({ x: 5, y: 10 });
    const a = detectLedgeGrab(bounds, [candidate]);
    const b = detectLedgeGrab(bounds, [candidate]);
    expect(a?.candidate).toBe(b?.candidate);
    expect(a?.latchX).toBe(b?.latchX);
    expect(a?.latchY).toBe(b?.latchY);
  });
});

// ---------------------------------------------------------------------------
// Helpers: ledgeCandidatesFromPlatform / ledgeCandidatesEqual
// ---------------------------------------------------------------------------

describe('ledgeCandidatesFromPlatform', () => {
  it('emits a left + right corner from a platform rectangle', () => {
    const [left, right] = ledgeCandidatesFromPlatform({
      id: 'main',
      centerX: 100,
      centerY: 200,
      width: 400,
      height: 40,
    });
    expect(left.side).toBe('left');
    expect(left.x).toBe(-100); // 100 - 400/2
    expect(left.y).toBe(180); // 200 - 40/2
    expect(right.side).toBe('right');
    expect(right.x).toBe(300);
    expect(right.y).toBe(180);
    expect(left.platformId).toBe('main');
    expect(right.platformId).toBe('main');
  });

  it('emits frozen records', () => {
    const [left, right] = ledgeCandidatesFromPlatform({
      id: 'p',
      centerX: 0,
      centerY: 0,
      width: 100,
      height: 20,
    });
    expect(Object.isFrozen(left)).toBe(true);
    expect(Object.isFrozen(right)).toBe(true);
  });
});

describe('ledgeCandidatesEqual', () => {
  it('matches by (platformId, side)', () => {
    const a = makeCandidate({ platformId: 'p', side: 'left', x: 1, y: 2 });
    const b = makeCandidate({ platformId: 'p', side: 'left', x: 99, y: 99 });
    expect(ledgeCandidatesEqual(a, b)).toBe(true);
  });

  it('returns false for differing platforms', () => {
    const a = makeCandidate({ platformId: 'a', side: 'left' });
    const b = makeCandidate({ platformId: 'b', side: 'left' });
    expect(ledgeCandidatesEqual(a, b)).toBe(false);
  });

  it('returns false for differing sides on the same platform', () => {
    const a = makeCandidate({ platformId: 'p', side: 'left' });
    const b = makeCandidate({ platformId: 'p', side: 'right' });
    expect(ledgeCandidatesEqual(a, b)).toBe(false);
  });

  it('handles null arguments cleanly', () => {
    expect(ledgeCandidatesEqual(null, null)).toBe(true);
    expect(ledgeCandidatesEqual(makeCandidate(), null)).toBe(false);
    expect(ledgeCandidatesEqual(null, makeCandidate())).toBe(false);
  });
});
