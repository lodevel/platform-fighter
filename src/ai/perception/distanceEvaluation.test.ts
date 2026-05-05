import { describe, it, expect } from 'vitest';
import {
  classifyEngagementZone,
  computeDistance,
  DEFAULT_ENGAGEMENT_RADII,
  evaluateEngagement,
  horizontalDistance,
  projectClosingDelta,
  verticalDistance,
} from './distanceEvaluation';
import type {
  PerceivedOpponent,
  PerceivedSelf,
} from './WorldSnapshot';
import type { PlayerSlotIndex } from '../../input/InputProvider';

function makeSelf(overrides: Partial<PerceivedSelf> = {}): PerceivedSelf {
  return {
    slotIndex: 0,
    position: { x: 0, y: 0 },
    velocity: { vx: 0, vy: 0 },
    facing: 1,
    damagePercent: 0,
    stocksRemaining: 3,
    isAirborne: false,
    isInHitstun: false,
    isOnLedge: false,
    ...overrides,
  };
}

function makeOpp(
  slot: PlayerSlotIndex,
  overrides: Partial<PerceivedOpponent> = {},
): PerceivedOpponent {
  return {
    slotIndex: slot,
    position: { x: 100, y: 0 },
    velocity: { vx: 0, vy: 0 },
    facing: -1,
    damagePercent: 0,
    stocksRemaining: 3,
    stateLabel: 'idle',
    isAirborne: false,
    isInvincible: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeDistance
// ---------------------------------------------------------------------------

describe('computeDistance', () => {
  it('returns signed deltas (to - from)', () => {
    const m = computeDistance({ x: 10, y: 20 }, { x: 30, y: 5 });
    expect(m.dx).toBe(20);
    expect(m.dy).toBe(-15);
  });

  it('returns absolute values for horizontalAbs/verticalAbs', () => {
    const m = computeDistance({ x: 10, y: 20 }, { x: 30, y: 5 });
    expect(m.horizontalAbs).toBe(20);
    expect(m.verticalAbs).toBe(15);
  });

  it('chebyshev returns the larger axis', () => {
    expect(computeDistance({ x: 0, y: 0 }, { x: 30, y: 5 }).chebyshev).toBe(30);
    expect(computeDistance({ x: 0, y: 0 }, { x: 5, y: 40 }).chebyshev).toBe(40);
    expect(computeDistance({ x: 0, y: 0 }, { x: 7, y: 7 }).chebyshev).toBe(7);
  });

  it('euclideanSquared sums dx² + dy²', () => {
    expect(
      computeDistance({ x: 0, y: 0 }, { x: 3, y: 4 }).euclideanSquared,
    ).toBe(25);
  });

  it('zero distance returns all zeros', () => {
    const m = computeDistance({ x: 5, y: 5 }, { x: 5, y: 5 });
    expect(m.dx).toBe(0);
    expect(m.dy).toBe(0);
    expect(m.horizontalAbs).toBe(0);
    expect(m.verticalAbs).toBe(0);
    expect(m.chebyshev).toBe(0);
    expect(m.euclideanSquared).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// horizontalDistance / verticalDistance
// ---------------------------------------------------------------------------

describe('horizontalDistance / verticalDistance', () => {
  it('returns signed horizontal delta (positive = opponent to right)', () => {
    const self = makeSelf({ position: { x: 50, y: 0 } });
    const opp = makeOpp(1, { position: { x: 200, y: 0 } });
    expect(horizontalDistance(self, opp)).toBe(150);
  });

  it('returns negative when opponent is to the left', () => {
    const self = makeSelf({ position: { x: 200, y: 0 } });
    const opp = makeOpp(1, { position: { x: 50, y: 0 } });
    expect(horizontalDistance(self, opp)).toBe(-150);
  });

  it('returns signed vertical delta (positive = opponent below)', () => {
    const self = makeSelf({ position: { x: 0, y: 0 } });
    const opp = makeOpp(1, { position: { x: 0, y: 100 } });
    expect(verticalDistance(self, opp)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// classifyEngagementZone
// ---------------------------------------------------------------------------

describe('classifyEngagementZone', () => {
  it('uses default radii when no overrides supplied', () => {
    expect(classifyEngagementZone(0)).toBe('melee');
    expect(classifyEngagementZone(63)).toBe('melee');
    expect(classifyEngagementZone(64)).toBe('tilt');
    expect(classifyEngagementZone(127)).toBe('tilt');
    expect(classifyEngagementZone(128)).toBe('spaced');
    expect(classifyEngagementZone(255)).toBe('spaced');
    expect(classifyEngagementZone(256)).toBe('far');
    expect(classifyEngagementZone(10000)).toBe('far');
  });

  it('honours per-call radii overrides', () => {
    expect(
      classifyEngagementZone(40, { meleeMaxPx: 30, tiltMaxPx: 60 }),
    ).toBe('tilt');
    expect(
      classifyEngagementZone(80, { meleeMaxPx: 30, tiltMaxPx: 60, spacedMaxPx: 90 }),
    ).toBe('spaced');
  });

  it('treats negative or NaN distance as far (defensive)', () => {
    expect(classifyEngagementZone(-5)).toBe('far');
    expect(classifyEngagementZone(NaN)).toBe('far');
    expect(classifyEngagementZone(Infinity)).toBe('far');
  });

  it('exposes default radii as a frozen constant', () => {
    expect(DEFAULT_ENGAGEMENT_RADII.meleeMaxPx).toBe(64);
    expect(Object.isFrozen(DEFAULT_ENGAGEMENT_RADII)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateEngagement
// ---------------------------------------------------------------------------

describe('evaluateEngagement', () => {
  it('returns zone + metrics in one call', () => {
    const self = makeSelf();
    const opp = makeOpp(1, { position: { x: 50, y: 10 } });
    const result = evaluateEngagement(self, opp);
    expect(result.zone).toBe('melee');
    expect(result.metrics.dx).toBe(50);
    expect(result.metrics.dy).toBe(10);
    expect(result.metrics.chebyshev).toBe(50);
  });

  it('classifies a far opponent as far', () => {
    const self = makeSelf();
    const opp = makeOpp(1, { position: { x: 1000, y: 0 } });
    expect(evaluateEngagement(self, opp).zone).toBe('far');
  });
});

// ---------------------------------------------------------------------------
// projectClosingDelta
// ---------------------------------------------------------------------------

describe('projectClosingDelta', () => {
  it('returns positive delta when opponent dashes in', () => {
    // Self stationary at 0; opponent at 100 dashing toward 0 with vx = -5.
    // After 10 frames: opp at 50, distance 50. Closed by 50.
    const self = makeSelf({ position: { x: 0, y: 0 } });
    const opp = makeOpp(1, {
      position: { x: 100, y: 0 },
      velocity: { vx: -5, vy: 0 },
    });
    expect(projectClosingDelta(self, opp, 10)).toBe(50);
  });

  it('returns negative delta when opponent runs away', () => {
    const self = makeSelf({ position: { x: 0, y: 0 } });
    const opp = makeOpp(1, {
      position: { x: 100, y: 0 },
      velocity: { vx: 5, vy: 0 },
    });
    expect(projectClosingDelta(self, opp, 10)).toBe(-50);
  });

  it('returns zero when both fighters are stationary', () => {
    const self = makeSelf();
    const opp = makeOpp(1, { position: { x: 100, y: 0 } });
    expect(projectClosingDelta(self, opp, 30)).toBe(0);
  });

  it('returns zero for invalid lookahead', () => {
    const self = makeSelf();
    const opp = makeOpp(1, {
      position: { x: 100, y: 0 },
      velocity: { vx: -5, vy: 0 },
    });
    expect(projectClosingDelta(self, opp, 0)).toBe(0);
    expect(projectClosingDelta(self, opp, -10)).toBe(0);
    expect(projectClosingDelta(self, opp, NaN)).toBe(0);
  });

  it('accounts for both fighters moving', () => {
    // Self walks right at +2; opp at 100 walks right at +5.
    // Opp is opening distance — net opening of 30 at 10 frames.
    const self = makeSelf({
      position: { x: 0, y: 0 },
      velocity: { vx: 2, vy: 0 },
    });
    const opp = makeOpp(1, {
      position: { x: 100, y: 0 },
      velocity: { vx: 5, vy: 0 },
    });
    expect(projectClosingDelta(self, opp, 10)).toBe(-30);
  });
});
