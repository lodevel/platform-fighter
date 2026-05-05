import { describe, it, expect } from 'vitest';
import { selectTarget } from './targetSelection';
import {
  buildWorldSnapshot,
  type PerceivedOpponent,
  type PerceivedSelf,
  type PerceivedStage,
  type WorldSnapshot,
} from './WorldSnapshot';
import type { PlayerSlotIndex } from '../../input/InputProvider';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

function makeStage(overrides: Partial<PerceivedStage> = {}): PerceivedStage {
  return {
    stageLeft: -400,
    stageRight: 400,
    stageTop: 200,
    blastZone: { left: -800, right: 800, top: -600, bottom: 600 },
    ...overrides,
  };
}

function makeSnap(
  opponents: ReadonlyArray<PerceivedOpponent>,
  self: PerceivedSelf = makeSelf(),
): WorldSnapshot {
  return buildWorldSnapshot({
    tickIndex: 0,
    self,
    opponents,
    stage: makeStage(),
  });
}

// ---------------------------------------------------------------------------
// Empty / single-opponent fast paths
// ---------------------------------------------------------------------------

describe('selectTarget — empty / single', () => {
  it('returns noOpponents on an empty list', () => {
    const result = selectTarget(makeSnap([]));
    expect(result.slotIndex).toBeNull();
    expect(result.opponent).toBeNull();
    expect(result.reason).toBe('noOpponents');
    expect(result.metrics).toBeNull();
    expect(result.threat).toBeNull();
  });

  it('returns the only opponent unconditionally with reason singleOpponent', () => {
    const opp = makeOpp(2, { position: { x: 200, y: 0 } });
    const result = selectTarget(makeSnap([opp]));
    expect(result.slotIndex).toBe(2);
    expect(result.opponent?.slotIndex).toBe(2);
    expect(result.reason).toBe('singleOpponent');
    expect(result.metrics?.dx).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// nearest policy
// ---------------------------------------------------------------------------

describe('selectTarget — nearest policy', () => {
  it('picks the smallest euclidean distance', () => {
    const a = makeOpp(1, { position: { x: 200, y: 0 } });
    const b = makeOpp(2, { position: { x: 50, y: 30 } });
    const c = makeOpp(3, { position: { x: 400, y: 0 } });

    const result = selectTarget(makeSnap([a, b, c]), { policy: 'nearest' });
    expect(result.slotIndex).toBe(2);
    expect(result.reason).toBe('closest');
  });

  it('breaks ties deterministically by lower slot index', () => {
    const a = makeOpp(1, { position: { x: 100, y: 0 } });
    const b = makeOpp(2, { position: { x: 100, y: 0 } });
    const result = selectTarget(makeSnap([a, b]), { policy: 'nearest' });
    expect(result.slotIndex).toBe(1);
  });

  it('returns metrics for the picked opponent', () => {
    const a = makeOpp(1, { position: { x: 60, y: 80 } });
    const b = makeOpp(2, { position: { x: 200, y: 0 } });
    const result = selectTarget(makeSnap([a, b]), { policy: 'nearest' });
    expect(result.slotIndex).toBe(1);
    expect(result.metrics?.dx).toBe(60);
    expect(result.metrics?.dy).toBe(80);
    expect(result.threat).toBeNull(); // not computed for nearest policy
  });
});

// ---------------------------------------------------------------------------
// lowestPercent policy
// ---------------------------------------------------------------------------

describe('selectTarget — lowestPercent policy', () => {
  it('picks the opponent with the lowest %', () => {
    const a = makeOpp(1, { damagePercent: 80 });
    const b = makeOpp(2, { damagePercent: 30, position: { x: 600, y: 0 } });
    const c = makeOpp(3, { damagePercent: 110 });

    const result = selectTarget(makeSnap([a, b, c]), {
      policy: 'lowestPercent',
    });
    expect(result.slotIndex).toBe(2);
    expect(result.reason).toBe('lowestPercent');
  });

  it('ties broken by lower slot index', () => {
    const a = makeOpp(1, { damagePercent: 50 });
    const b = makeOpp(2, { damagePercent: 50 });
    const result = selectTarget(makeSnap([a, b]), {
      policy: 'lowestPercent',
    });
    expect(result.slotIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// threatWeighted policy
// ---------------------------------------------------------------------------

describe('selectTarget — threatWeighted policy', () => {
  it('prefers a closer attacker over a far idle target', () => {
    const closeAttacker = makeOpp(1, {
      position: { x: 60, y: 0 },
      stateLabel: 'attacking',
      velocity: { vx: -3, vy: 0 },
    });
    const farIdle = makeOpp(2, { position: { x: 350, y: 0 } });

    const result = selectTarget(makeSnap([closeAttacker, farIdle]), {
      policy: 'threatWeighted',
    });
    expect(result.slotIndex).toBe(1);
    expect(result.reason).toBe('highestThreat');
    expect(result.threat).not.toBeNull();
  });

  it('downweights invincible opponents', () => {
    // Invincible at melee, vulnerable at smash range. Pick the
    // vulnerable one because the invincible one contributes ~0
    // proximity / aggression / approach.
    const invincible = makeOpp(1, {
      position: { x: 30, y: 0 },
      stateLabel: 'attacking',
      isInvincible: true,
    });
    const vulnerable = makeOpp(2, {
      position: { x: 150, y: 0 },
      stateLabel: 'idle',
    });
    const result = selectTarget(makeSnap([invincible, vulnerable]), {
      policy: 'threatWeighted',
    });
    expect(result.slotIndex).toBe(2);
  });

  it('boosts opponents at high % via appeal', () => {
    // Two equally-positioned idle opponents; the one with higher %
    // wins because appeal pushes its score up.
    const lowPercent = makeOpp(1, {
      position: { x: 100, y: 0 },
      damagePercent: 0,
    });
    const highPercent = makeOpp(2, {
      position: { x: 100, y: 0 },
      damagePercent: 150,
    });
    const result = selectTarget(makeSnap([lowPercent, highPercent]), {
      policy: 'threatWeighted',
    });
    expect(result.slotIndex).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Sticky bias
// ---------------------------------------------------------------------------

describe('selectTarget — sticky policy', () => {
  it('retains previous target when candidate is within margin', () => {
    // Two opponents with identical scores; sticky to slot 2 should
    // override the deterministic tie-break-to-slot-1.
    const a = makeOpp(1, { position: { x: 100, y: 0 } });
    const b = makeOpp(2, { position: { x: 100, y: 0 } });
    const result = selectTarget(makeSnap([a, b]), {
      policy: 'threatWeighted',
      sticky: { previousSlotIndex: 2, switchMargin: 0.1 },
    });
    expect(result.slotIndex).toBe(2);
    expect(result.reason).toBe('stickToPrev');
  });

  it('switches when candidate exceeds margin', () => {
    // Slot 1 is heavily favored over slot 2.
    const a = makeOpp(1, {
      position: { x: 30, y: 0 },
      stateLabel: 'attacking',
      velocity: { vx: -10, vy: 0 },
    });
    const b = makeOpp(2, { position: { x: 600, y: 0 } });
    const result = selectTarget(makeSnap([a, b]), {
      policy: 'threatWeighted',
      sticky: { previousSlotIndex: 2, switchMargin: 0.1 },
    });
    expect(result.slotIndex).toBe(1);
    expect(result.reason).toBe('highestThreat');
  });

  it('ignores sticky bias when previous target no longer exists', () => {
    const a = makeOpp(1, { position: { x: 50, y: 0 } });
    const result = selectTarget(makeSnap([a, makeOpp(2)]), {
      sticky: { previousSlotIndex: 7 as PlayerSlotIndex },
    });
    // Picks the actual highest-scored opponent without crashing.
    expect(result.slotIndex).not.toBeNull();
    expect(result.reason).not.toBe('stickToPrev');
  });

  it('switchMargin = 0 disables stickiness', () => {
    const a = makeOpp(1, { position: { x: 100, y: 0 } });
    const b = makeOpp(2, { position: { x: 100, y: 0 } });
    const result = selectTarget(makeSnap([a, b]), {
      policy: 'threatWeighted',
      sticky: { previousSlotIndex: 2, switchMargin: 0 },
    });
    // With margin zero and a tied candidate, deterministic tie-break
    // (slot 1) wins over the previous target (slot 2).
    expect(result.slotIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('selectTarget — determinism', () => {
  it('produces identical selection for identical snapshots', () => {
    const opps = [
      makeOpp(1, { position: { x: 60, y: 0 }, stateLabel: 'attacking' }),
      makeOpp(2, { position: { x: 200, y: 30 }, damagePercent: 90 }),
      makeOpp(3, { position: { x: 350, y: 0 } }),
    ];
    const a = selectTarget(makeSnap(opps));
    const b = selectTarget(makeSnap(opps));
    expect(a).toEqual(b);
  });

  it('selection is invariant under opponent input order', () => {
    const opps1 = [
      makeOpp(1, { position: { x: 60, y: 0 }, stateLabel: 'attacking' }),
      makeOpp(2, { position: { x: 200, y: 30 }, damagePercent: 90 }),
      makeOpp(3, { position: { x: 350, y: 0 } }),
    ];
    const opps2 = [opps1[2]!, opps1[0]!, opps1[1]!];
    const a = selectTarget(makeSnap(opps1));
    const b = selectTarget(makeSnap(opps2));
    expect(a.slotIndex).toBe(b.slotIndex);
  });
});
