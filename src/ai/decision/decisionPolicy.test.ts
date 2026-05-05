import { describe, expect, it } from 'vitest';

import { Rng } from '../../utils/Rng';
import type {
  PerceivedOpponent,
  PerceivedSelf,
  PerceivedStage,
} from '../perception/WorldSnapshot';

import {
  DEFAULT_DECISION_POLICY_OPTIONS,
  isAttackGate,
  isDefendGate,
  isRecoverGate,
  isRetreatGate,
  resolveDecisionPolicyOptions,
  resolveDecisionState,
  type ResolvedDecisionPolicyOptions,
} from './decisionPolicy';
import type { DecisionContext } from './types';

const DEFAULT_STAGE: PerceivedStage = {
  stageLeft: 100,
  stageRight: 700,
  stageTop: 400,
  blastZone: { left: 0, right: 800, top: 0, bottom: 600 },
};

function makeSelf(overrides: Partial<PerceivedSelf> = {}): PerceivedSelf {
  return {
    slotIndex: 0,
    position: { x: 400, y: 380 },
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

function makeOpponent(overrides: Partial<PerceivedOpponent> = {}): PerceivedOpponent {
  return {
    slotIndex: 1,
    position: { x: 500, y: 380 },
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

function makeCtx(overrides: {
  self?: Partial<PerceivedSelf>;
  opponent?: PerceivedOpponent | null;
  stage?: PerceivedStage;
  tickIndex?: number;
  rngSeed?: number;
} = {}): DecisionContext {
  return {
    self: makeSelf(overrides.self),
    opponent:
      overrides.opponent === undefined
        ? makeOpponent()
        : overrides.opponent,
    stage: overrides.stage ?? DEFAULT_STAGE,
    tickIndex: overrides.tickIndex ?? 0,
    rng: new Rng(overrides.rngSeed ?? 1),
  };
}

const RESOLVED: ResolvedDecisionPolicyOptions = DEFAULT_DECISION_POLICY_OPTIONS;

describe('resolveDecisionPolicyOptions', () => {
  it('fills defaults for an empty options bag', () => {
    expect(resolveDecisionPolicyOptions()).toEqual(RESOLVED);
  });

  it('honours partial overrides without dropping other defaults', () => {
    const r = resolveDecisionPolicyOptions({
      retreatDamageThreshold: 80,
      koPercent: 110,
    });
    expect(r.retreatDamageThreshold).toBe(80);
    expect(r.koPercent).toBe(110);
    // Defaults preserved.
    expect(r.retreatBlastZoneMarginPx).toBe(RESOLVED.retreatBlastZoneMarginPx);
    expect(r.offStageMarginPx).toBe(RESOLVED.offStageMarginPx);
    expect(r.defendEngagementZone).toBe(RESOLVED.defendEngagementZone);
    expect(r.radii).toEqual(RESOLVED.radii);
  });

  it('partial radii override merges with default zone radii', () => {
    const r = resolveDecisionPolicyOptions({ radii: { meleeMaxPx: 32 } });
    expect(r.radii.meleeMaxPx).toBe(32);
    expect(r.radii.tiltMaxPx).toBe(RESOLVED.radii.tiltMaxPx);
    expect(r.radii.spacedMaxPx).toBe(RESOLVED.radii.spacedMaxPx);
  });
});

describe('isRecoverGate', () => {
  it('returns false when on stage and grounded', () => {
    expect(isRecoverGate(makeSelf(), DEFAULT_STAGE, 8)).toBe(false);
  });

  it('returns false when clinging to ledge', () => {
    const self = makeSelf({ isOnLedge: true, isAirborne: true, position: { x: 90, y: 380 } });
    expect(isRecoverGate(self, DEFAULT_STAGE, 8)).toBe(false);
  });

  it('returns true when airborne and beyond left edge by margin', () => {
    const self = makeSelf({ isAirborne: true, position: { x: 80, y: 380 } });
    expect(isRecoverGate(self, DEFAULT_STAGE, 8)).toBe(true);
  });

  it('returns true when airborne and beyond right edge by margin', () => {
    const self = makeSelf({ isAirborne: true, position: { x: 720, y: 380 } });
    expect(isRecoverGate(self, DEFAULT_STAGE, 8)).toBe(true);
  });

  it('returns true when below the stage top regardless of x', () => {
    const self = makeSelf({ isAirborne: true, position: { x: 400, y: 410 } });
    expect(isRecoverGate(self, DEFAULT_STAGE, 8)).toBe(true);
  });

  it('treats hitstun as airborne for recovery purposes', () => {
    const self = makeSelf({
      isAirborne: false,
      isInHitstun: true,
      position: { x: 80, y: 380 },
    });
    expect(isRecoverGate(self, DEFAULT_STAGE, 8)).toBe(true);
  });

  it('respects the off-stage margin (still on stage with default 8 px tolerance)', () => {
    const self = makeSelf({ isAirborne: true, position: { x: 95, y: 380 } });
    expect(isRecoverGate(self, DEFAULT_STAGE, 8)).toBe(false);
  });
});

describe('isDefendGate', () => {
  it('returns false when no opponent', () => {
    expect(isDefendGate(makeSelf(), null, RESOLVED)).toBe(false);
  });

  it('returns false when opponent is idle', () => {
    expect(isDefendGate(makeSelf(), makeOpponent({ stateLabel: 'idle' }), RESOLVED)).toBe(false);
  });

  it('returns true when opponent is attacking and within tilt range', () => {
    const opp = makeOpponent({ stateLabel: 'attacking', position: { x: 460, y: 380 } });
    expect(isDefendGate(makeSelf(), opp, RESOLVED)).toBe(true);
  });

  it('returns false when opponent is attacking but outside tilt range', () => {
    const opp = makeOpponent({ stateLabel: 'attacking', position: { x: 700, y: 380 } });
    expect(isDefendGate(makeSelf(), opp, RESOLVED)).toBe(false);
  });

  it('respects a stricter melee defend zone', () => {
    const stricter = resolveDecisionPolicyOptions({ defendEngagementZone: 'melee' });
    const opp = makeOpponent({ stateLabel: 'attacking', position: { x: 480, y: 380 } });
    // 80 px is in the tilt zone but not the melee zone
    expect(isDefendGate(makeSelf(), opp, stricter)).toBe(false);
    const closer = makeOpponent({ stateLabel: 'attacking', position: { x: 440, y: 380 } });
    expect(isDefendGate(makeSelf(), closer, stricter)).toBe(true);
  });
});

describe('isRetreatGate', () => {
  it('returns true when bot is right against the left blast wall', () => {
    const self = makeSelf({ position: { x: 50, y: 380 } });
    expect(isRetreatGate(self, makeOpponent(), DEFAULT_STAGE, RESOLVED)).toBe(true);
  });

  it('returns true when bot is right against the right blast wall', () => {
    const self = makeSelf({ position: { x: 750, y: 380 } });
    expect(isRetreatGate(self, makeOpponent(), DEFAULT_STAGE, RESOLVED)).toBe(true);
  });

  it('returns false when bot is in the stage centre and at low %', () => {
    expect(isRetreatGate(makeSelf(), makeOpponent(), DEFAULT_STAGE, RESOLVED)).toBe(false);
  });

  it('returns true when bot is at KO % and opponent is in melee reach', () => {
    const self = makeSelf({ damagePercent: 110, position: { x: 400, y: 380 } });
    const opp = makeOpponent({ position: { x: 440, y: 380 } });
    expect(isRetreatGate(self, opp, DEFAULT_STAGE, RESOLVED)).toBe(true);
  });

  it('does NOT trigger high-% retreat when opponent is far away', () => {
    const self = makeSelf({ damagePercent: 110, position: { x: 400, y: 380 } });
    const opp = makeOpponent({ position: { x: 700, y: 380 } });
    expect(isRetreatGate(self, opp, DEFAULT_STAGE, RESOLVED)).toBe(false);
  });

  it('returns false when no opponent and bot away from blast walls', () => {
    expect(isRetreatGate(makeSelf(), null, DEFAULT_STAGE, RESOLVED)).toBe(false);
  });
});

describe('isAttackGate', () => {
  it('returns false when no opponent', () => {
    expect(isAttackGate(makeSelf(), null, RESOLVED)).toBe(false);
  });

  it('returns true when opponent is in melee reach', () => {
    const opp = makeOpponent({ position: { x: 440, y: 380 } });
    expect(isAttackGate(makeSelf(), opp, RESOLVED)).toBe(true);
  });

  it('returns true when opponent is in tilt reach', () => {
    const opp = makeOpponent({ position: { x: 480, y: 380 } });
    expect(isAttackGate(makeSelf(), opp, RESOLVED)).toBe(true);
  });

  it('returns false when opponent is in spaced reach', () => {
    const opp = makeOpponent({ position: { x: 600, y: 380 } });
    expect(isAttackGate(makeSelf(), opp, RESOLVED)).toBe(false);
  });

  it('returns false when opponent is far', () => {
    const opp = makeOpponent({ position: { x: 700, y: 380 } });
    expect(isAttackGate(makeSelf(), opp, RESOLVED)).toBe(false);
  });
});

describe('resolveDecisionState — priority resolution', () => {
  it('falls back to approach when no gate fires (opponent far, all neutral)', () => {
    const ctx = makeCtx({
      self: { position: { x: 400, y: 380 } },
      opponent: makeOpponent({ position: { x: 700, y: 380 } }),
    });
    expect(resolveDecisionState(ctx)).toBe('approach');
  });

  it('returns attack when opponent is in tilt range', () => {
    const ctx = makeCtx({
      self: { position: { x: 400, y: 380 } },
      opponent: makeOpponent({ position: { x: 480, y: 380 } }),
    });
    expect(resolveDecisionState(ctx)).toBe('attack');
  });

  it('returns defend when opponent is attacking in tilt range', () => {
    const ctx = makeCtx({
      self: { position: { x: 400, y: 380 } },
      opponent: makeOpponent({ position: { x: 480, y: 380 }, stateLabel: 'attacking' }),
    });
    expect(resolveDecisionState(ctx)).toBe('defend');
  });

  it('returns retreat when bot at KO % and opponent in melee', () => {
    const ctx = makeCtx({
      self: { damagePercent: 120, position: { x: 400, y: 380 } },
      opponent: makeOpponent({ position: { x: 440, y: 380 } }),
    });
    expect(resolveDecisionState(ctx)).toBe('retreat');
  });

  it('returns recover when off-stage and airborne', () => {
    const ctx = makeCtx({
      self: { isAirborne: true, position: { x: 80, y: 380 } },
    });
    expect(resolveDecisionState(ctx)).toBe('recover');
  });

  it('recover trumps defend (off-stage with attacking opponent in range)', () => {
    const ctx = makeCtx({
      self: { isAirborne: true, position: { x: 80, y: 380 } },
      opponent: makeOpponent({
        position: { x: 110, y: 380 },
        stateLabel: 'attacking',
      }),
    });
    expect(resolveDecisionState(ctx)).toBe('recover');
  });

  it('defend trumps retreat (attacking opponent + bot near blast wall)', () => {
    const ctx = makeCtx({
      self: { position: { x: 50, y: 380 }, damagePercent: 0 },
      opponent: makeOpponent({
        position: { x: 90, y: 380 },
        stateLabel: 'attacking',
      }),
    });
    expect(resolveDecisionState(ctx)).toBe('defend');
  });

  it('retreat trumps attack (high % + opponent in range = retreat not attack)', () => {
    const ctx = makeCtx({
      self: { damagePercent: 120, position: { x: 400, y: 380 } },
      opponent: makeOpponent({ position: { x: 440, y: 380 } }),
    });
    expect(resolveDecisionState(ctx)).toBe('retreat');
  });

  it('determinism: identical contexts produce identical state', () => {
    const a = resolveDecisionState(makeCtx({ rngSeed: 7 }));
    const b = resolveDecisionState(makeCtx({ rngSeed: 7 }));
    expect(a).toBe(b);
  });

  it('accepts an already-resolved options bag without re-resolving', () => {
    const ctx = makeCtx();
    const stricter = resolveDecisionPolicyOptions({ defendEngagementZone: 'melee' });
    const state = resolveDecisionState(ctx, stricter);
    expect(['approach', 'attack', 'defend', 'recover', 'retreat']).toContain(state);
  });
});
