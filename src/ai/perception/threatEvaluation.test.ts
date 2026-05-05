import { describe, it, expect } from 'vitest';
import {
  aggressionScore,
  approachScore,
  DEFAULT_THREAT_WEIGHTS,
  evaluateThreat,
  koPotentialScore,
  proximityScore,
  selfVulnerabilityScore,
  stagePositionScore,
} from './threatEvaluation';
import type {
  PerceivedOpponent,
  PerceivedSelf,
  PerceivedStage,
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

// ---------------------------------------------------------------------------
// proximityScore
// ---------------------------------------------------------------------------

describe('proximityScore', () => {
  it('peaks at zero distance', () => {
    expect(proximityScore(0)).toBe(1);
  });

  it('hits half the score at the falloff radius', () => {
    expect(proximityScore(192)).toBeCloseTo(0.5, 5);
  });

  it('hits zero at the cutoff radius', () => {
    expect(proximityScore(512)).toBe(0);
  });

  it('beyond the cutoff stays at zero', () => {
    expect(proximityScore(2000)).toBe(0);
  });

  it('honours custom shape values', () => {
    expect(
      proximityScore(50, { proximityFalloffPx: 50, proximityCutoffPx: 100 }),
    ).toBeCloseTo(0.5, 5);
  });

  it('treats negative distance as max (defensive)', () => {
    expect(proximityScore(-5)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// aggressionScore
// ---------------------------------------------------------------------------

describe('aggressionScore', () => {
  it('attacking opponents are maximally aggressive', () => {
    expect(aggressionScore(makeOpp(1, { stateLabel: 'attacking' }))).toBe(1);
  });

  it('hitstun opponents are zero-aggressive', () => {
    expect(aggressionScore(makeOpp(1, { stateLabel: 'hitstun' }))).toBe(0);
  });

  it('orders states sensibly: hitstun < recovering < ledgeHang < shielding < idle/airborne < dodging < attacking', () => {
    const hitstun = aggressionScore(makeOpp(1, { stateLabel: 'hitstun' }));
    const recovering = aggressionScore(
      makeOpp(1, { stateLabel: 'recovering' }),
    );
    const ledge = aggressionScore(makeOpp(1, { stateLabel: 'ledgeHang' }));
    const shield = aggressionScore(makeOpp(1, { stateLabel: 'shielding' }));
    const idle = aggressionScore(makeOpp(1, { stateLabel: 'idle' }));
    const air = aggressionScore(makeOpp(1, { stateLabel: 'airborne' }));
    const dodge = aggressionScore(makeOpp(1, { stateLabel: 'dodging' }));
    const attack = aggressionScore(makeOpp(1, { stateLabel: 'attacking' }));

    // Strict ordering — punishable / disadvantaged states grade up to the
    // canonical "panic now" attacking state.
    expect(hitstun).toBeLessThan(recovering);
    expect(recovering).toBeLessThan(ledge);
    expect(ledge).toBeLessThan(shield);
    expect(shield).toBeLessThan(idle);
    expect(idle).toBe(air);
    expect(idle).toBeLessThan(dodge);
    expect(dodge).toBeLessThan(attack);
  });
});

// ---------------------------------------------------------------------------
// approachScore
// ---------------------------------------------------------------------------

describe('approachScore', () => {
  it('saturates at 1 when opponent dashes hard at the bot', () => {
    const self = makeSelf();
    const opp = makeOpp(1, {
      position: { x: 200, y: 0 },
      velocity: { vx: -10, vy: 0 },
    });
    // 30 frames × 10 px/frame closing = 300px > saturation 64px.
    expect(approachScore(self, opp)).toBe(1);
  });

  it('returns 0 when the opponent is moving away', () => {
    const self = makeSelf();
    const opp = makeOpp(1, {
      position: { x: 200, y: 0 },
      velocity: { vx: 10, vy: 0 },
    });
    expect(approachScore(self, opp)).toBe(0);
  });

  it('scales linearly between 0 and the saturation distance', () => {
    const self = makeSelf();
    const opp = makeOpp(1, {
      position: { x: 200, y: 0 },
      velocity: { vx: -1, vy: 0 },
    });
    // 30 frames × 1 px/frame = 30 px closing → 30/64 ≈ 0.469.
    expect(approachScore(self, opp)).toBeCloseTo(30 / 64, 3);
  });
});

// ---------------------------------------------------------------------------
// koPotentialScore
// ---------------------------------------------------------------------------

describe('koPotentialScore', () => {
  it('zero at zero damage', () => {
    expect(koPotentialScore(makeSelf({ damagePercent: 0 }))).toBe(0);
  });

  it('saturates at threshold (default 90)', () => {
    expect(koPotentialScore(makeSelf({ damagePercent: 100 }))).toBe(1);
    expect(koPotentialScore(makeSelf({ damagePercent: 90 }))).toBe(1);
  });

  it('linear ramp under threshold', () => {
    expect(
      koPotentialScore(makeSelf({ damagePercent: 45 })),
    ).toBeCloseTo(0.5, 5);
  });
});

// ---------------------------------------------------------------------------
// stagePositionScore
// ---------------------------------------------------------------------------

describe('stagePositionScore', () => {
  it('rewards on-stage opponent (+0.5 baseline)', () => {
    expect(
      stagePositionScore(
        makeSelf({ position: { x: 0, y: 0 } }),
        makeOpp(1, { position: { x: 0, y: 0 } }),
        makeStage(),
      ),
    ).toBeCloseTo(0.5, 5);
  });

  it('omits the on-stage bonus when opponent is off-stage', () => {
    expect(
      stagePositionScore(
        makeSelf({ position: { x: 0, y: 0 } }),
        makeOpp(1, { position: { x: 600, y: 0 } }),
        makeStage(),
      ),
    ).toBe(0);
  });

  it('amplifies when bot is near a blast wall', () => {
    // Bot only 64 px from the right blast wall (default safePx 128).
    expect(
      stagePositionScore(
        makeSelf({ position: { x: 736, y: 0 } }),
        makeOpp(1, { position: { x: 0, y: 0 } }),
        makeStage(),
      ),
    ).toBeGreaterThan(0.7);
  });

  it('caps at 1.0', () => {
    expect(
      stagePositionScore(
        makeSelf({ position: { x: 799, y: 0 } }),
        makeOpp(1, { position: { x: 0, y: 0 } }),
        makeStage(),
      ),
    ).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// selfVulnerabilityScore
// ---------------------------------------------------------------------------

describe('selfVulnerabilityScore', () => {
  it('returns 0 in baseline grounded neutral', () => {
    expect(selfVulnerabilityScore(makeSelf())).toBe(0);
  });

  it('returns 1 in hitstun (max vulnerability)', () => {
    expect(selfVulnerabilityScore(makeSelf({ isInHitstun: true }))).toBe(1);
  });

  it('caps at 1 even when stacking flags', () => {
    expect(
      selfVulnerabilityScore(
        makeSelf({ isInHitstun: true, isAirborne: true, isOnLedge: true }),
      ),
    ).toBe(1);
  });

  it('isAirborne adds 0.25', () => {
    expect(selfVulnerabilityScore(makeSelf({ isAirborne: true }))).toBe(0.25);
  });

  it('isOnLedge adds 0.5', () => {
    expect(selfVulnerabilityScore(makeSelf({ isOnLedge: true }))).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// evaluateThreat
// ---------------------------------------------------------------------------

describe('evaluateThreat — composition', () => {
  it('returns total in [0, 1]', () => {
    const result = evaluateThreat(
      makeSelf(),
      makeOpp(1, { position: { x: 100, y: 0 } }),
      makeStage(),
    );
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(1);
  });

  it('a close attacking opponent scores higher than a far idle one', () => {
    const stage = makeStage();
    const self = makeSelf();

    const closeAttacker = evaluateThreat(
      self,
      makeOpp(1, {
        position: { x: 30, y: 0 },
        stateLabel: 'attacking',
      }),
      stage,
    );
    const farIdle = evaluateThreat(
      self,
      makeOpp(2, { position: { x: 600, y: 0 } }),
      stage,
    );
    expect(closeAttacker.total).toBeGreaterThan(farIdle.total);
  });

  it('invincibility damps proximity / aggression / approach', () => {
    const stage = makeStage();
    const self = makeSelf();

    // Position the opponent far enough away that the 30-frame
    // projection closes ground without overshooting through the bot
    // (which would clamp the approach axis to zero from sign change).
    const normal = evaluateThreat(
      self,
      makeOpp(1, {
        position: { x: 200, y: 0 },
        stateLabel: 'attacking',
        velocity: { vx: -3, vy: 0 },
      }),
      stage,
    );
    const invincible = evaluateThreat(
      self,
      makeOpp(1, {
        position: { x: 200, y: 0 },
        stateLabel: 'attacking',
        velocity: { vx: -3, vy: 0 },
        isInvincible: true,
      }),
      stage,
    );
    expect(invincible.proximity).toBeLessThan(normal.proximity);
    expect(invincible.aggression).toBe(0);
    expect(invincible.approach).toBeLessThan(normal.approach);
    expect(invincible.total).toBeLessThan(normal.total);
  });

  it('exposes per-axis components for debug introspection', () => {
    // Opponent at 200 with vx -3 closes 90px in 30 frames — well past
    // the 64px approach saturation without overshooting through the bot.
    const result = evaluateThreat(
      makeSelf({ damagePercent: 100, isInHitstun: true }),
      makeOpp(1, {
        position: { x: 200, y: 0 },
        stateLabel: 'attacking',
        velocity: { vx: -3, vy: 0 },
      }),
      makeStage(),
    );
    expect(result.proximity).toBeGreaterThan(0);
    expect(result.aggression).toBe(1);
    expect(result.approach).toBe(1);
    expect(result.koPotential).toBe(1);
    expect(result.selfVulnerability).toBe(1);
    // Metrics surfaced to avoid recompute.
    expect(result.metrics.dx).toBe(200);
  });

  it('weights default sum to 1.0 — total cannot exceed component sum', () => {
    const sum =
      DEFAULT_THREAT_WEIGHTS.proximityWeight +
      DEFAULT_THREAT_WEIGHTS.aggressionWeight +
      DEFAULT_THREAT_WEIGHTS.approachWeight +
      DEFAULT_THREAT_WEIGHTS.koPotentialWeight +
      DEFAULT_THREAT_WEIGHTS.stagePositionWeight +
      DEFAULT_THREAT_WEIGHTS.selfVulnerabilityWeight;
    expect(sum).toBeCloseTo(1, 5);
  });

  it('is deterministic — identical inputs yield identical scores', () => {
    const inputs = [
      makeSelf({ damagePercent: 50 }),
      makeOpp(1, { position: { x: 80, y: 10 }, stateLabel: 'attacking' }),
      makeStage(),
    ] as const;
    const a = evaluateThreat(inputs[0], inputs[1], inputs[2]);
    const b = evaluateThreat(inputs[0], inputs[1], inputs[2]);
    expect(a).toEqual(b);
  });
});
