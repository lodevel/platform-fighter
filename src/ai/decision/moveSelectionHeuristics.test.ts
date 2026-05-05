import { describe, expect, it } from 'vitest';

import { Rng } from '../../utils/Rng';
import type {
  PerceivedOpponent,
  PerceivedSelf,
  PerceivedStage,
} from '../perception/WorldSnapshot';

import {
  DEFAULT_ATTACK_VOCABULARY,
  DEFAULT_MOVE_SELECTION_OPTIONS,
  resolveMoveSelectionOptions,
  selectActionsForState,
  selectApproachActions,
  selectAttackActions,
  selectDefendActions,
  selectRecoverActions,
  selectRetreatActions,
  type ResolvedMoveSelectionOptions,
} from './moveSelectionHeuristics';
import type { DecisionAction, DecisionContext } from './types';

const STAGE: PerceivedStage = {
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
  rngSeed?: number;
} = {}): DecisionContext {
  return {
    self: makeSelf(overrides.self),
    opponent:
      overrides.opponent === undefined ? makeOpponent() : overrides.opponent,
    stage: overrides.stage ?? STAGE,
    tickIndex: 0,
    rng: new Rng(overrides.rngSeed ?? 1),
  };
}

const RESOLVED: ResolvedMoveSelectionOptions = DEFAULT_MOVE_SELECTION_OPTIONS;

describe('resolveMoveSelectionOptions', () => {
  it('fills defaults for an empty options bag', () => {
    expect(resolveMoveSelectionOptions()).toEqual(RESOLVED);
  });

  it('clamps dodge chance below 0 to 0', () => {
    expect(resolveMoveSelectionOptions({ dodgeChance: -1 }).dodgeChance).toBe(0);
  });

  it('clamps dodge chance above 1 to 1', () => {
    expect(resolveMoveSelectionOptions({ dodgeChance: 2 }).dodgeChance).toBe(1);
  });

  it('clamps NaN dodge chance to 0', () => {
    expect(resolveMoveSelectionOptions({ dodgeChance: Number.NaN }).dodgeChance).toBe(0);
  });

  it('honours an explicit attack vocabulary override', () => {
    const custom = {
      meleeLowPercent: 'tilt' as const,
      meleeKoPercent: 'special' as const,
      tilt: null,
      spaced: null,
    };
    const r = resolveMoveSelectionOptions({ attackVocabulary: custom });
    expect(r.attackVocabulary).toBe(custom);
  });
});

describe('selectApproachActions', () => {
  it('emits idle when no opponent is alive', () => {
    const actions = selectApproachActions(makeCtx({ opponent: null }));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: 'idle', state: 'approach' });
  });

  it('emits moveRight when opponent is to the right', () => {
    const actions = selectApproachActions(
      makeCtx({ opponent: makeOpponent({ position: { x: 600, y: 380 } }) }),
    );
    expect(actions).toEqual([{ kind: 'moveRight', state: 'approach', note: 'closeGap' }]);
  });

  it('emits moveLeft when opponent is to the left', () => {
    const actions = selectApproachActions(
      makeCtx({ opponent: makeOpponent({ position: { x: 200, y: 380 } }) }),
    );
    expect(actions).toEqual([{ kind: 'moveLeft', state: 'approach', note: 'closeGap' }]);
  });

  it('emits idle when perfectly aligned (dx === 0)', () => {
    const ctx = makeCtx({
      self: { position: { x: 400, y: 380 } },
      opponent: makeOpponent({ position: { x: 400, y: 380 } }),
    });
    const actions = selectApproachActions(ctx);
    expect(actions[0]).toMatchObject({ kind: 'idle', state: 'approach', note: 'aligned' });
  });
});

describe('selectAttackActions', () => {
  it('emits jab when in melee reach against low %', () => {
    const ctx = makeCtx({
      opponent: makeOpponent({ position: { x: 440, y: 380 }, damagePercent: 30 }),
    });
    const actions = selectAttackActions(ctx);
    expect(actions).toEqual([{ kind: 'jab', state: 'attack', note: 'meleeLow' }]);
  });

  it('emits smash in melee reach against KO %', () => {
    const ctx = makeCtx({
      opponent: makeOpponent({ position: { x: 440, y: 380 }, damagePercent: 110 }),
    });
    const actions = selectAttackActions(ctx);
    expect(actions).toEqual([{ kind: 'smash', state: 'attack', note: 'meleeKo' }]);
  });

  it('emits movement + tilt in tilt reach', () => {
    const ctx = makeCtx({
      opponent: makeOpponent({ position: { x: 480, y: 380 } }),
    });
    const actions = selectAttackActions(ctx);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({ kind: 'moveRight', state: 'attack' });
    expect(actions[1]).toEqual({ kind: 'tilt', state: 'attack', note: 'tiltZone' });
  });

  it('emits special in spaced reach', () => {
    const ctx = makeCtx({
      opponent: makeOpponent({ position: { x: 600, y: 380 } }),
    });
    const actions = selectAttackActions(ctx);
    expect(actions).toEqual([{ kind: 'special', state: 'attack', note: 'spacedZone' }]);
  });

  it('falls through to movement when in far reach', () => {
    const ctx = makeCtx({
      opponent: makeOpponent({ position: { x: 750, y: 380 } }),
    });
    const actions = selectAttackActions(ctx);
    expect(actions).toEqual([{ kind: 'moveRight', state: 'attack', note: 'lostReach' }]);
  });

  it('emits idle when no opponent is alive', () => {
    const actions = selectAttackActions(makeCtx({ opponent: null }));
    expect(actions[0]).toMatchObject({ kind: 'idle', state: 'attack', note: 'noOpponent' });
  });

  it('respects a custom KO percent threshold', () => {
    const ctx = makeCtx({
      opponent: makeOpponent({ position: { x: 440, y: 380 }, damagePercent: 60 }),
    });
    const opts = resolveMoveSelectionOptions({
      policy: { koPercent: 50 },
    });
    const actions = selectAttackActions(ctx, opts);
    expect(actions[0]).toMatchObject({ kind: 'smash', note: 'meleeKo' });
  });

  it('falls through to approach-style movement when tilt verb is null', () => {
    const ctx = makeCtx({
      opponent: makeOpponent({ position: { x: 480, y: 380 } }),
    });
    const opts = resolveMoveSelectionOptions({
      attackVocabulary: { ...DEFAULT_ATTACK_VOCABULARY, tilt: null },
    });
    const actions = selectAttackActions(ctx, opts);
    expect(actions).toEqual([
      { kind: 'moveRight', state: 'attack', note: 'noTiltVerb' },
    ]);
  });
});

describe('selectDefendActions', () => {
  it('emits shield by default with low dodge chance', () => {
    // seed=1 produces first roll near 0.41 → above 0.20 dodge threshold
    const ctx = makeCtx({ rngSeed: 1 });
    const actions = selectDefendActions(ctx);
    expect(actions).toEqual([{ kind: 'shield', state: 'defend', note: 'block' }]);
  });

  it('emits dodge when the rng roll lands below the dodge chance', () => {
    // Force dodge chance to 1 — every roll dodges.
    const opts = resolveMoveSelectionOptions({ dodgeChance: 1 });
    const actions = selectDefendActions(makeCtx({ rngSeed: 99 }), opts);
    expect(actions).toEqual([{ kind: 'dodge', state: 'defend', note: 'evade' }]);
  });

  it('always shields when dodge chance is 0', () => {
    const opts = resolveMoveSelectionOptions({ dodgeChance: 0 });
    for (let seed = 1; seed < 8; seed++) {
      const actions = selectDefendActions(makeCtx({ rngSeed: seed }), opts);
      expect(actions[0]?.kind).toBe('shield');
    }
  });

  it('determinism: same seed produces same defend verb', () => {
    const a = selectDefendActions(makeCtx({ rngSeed: 42 }));
    const b = selectDefendActions(makeCtx({ rngSeed: 42 }));
    expect(a).toEqual(b);
  });
});

describe('selectRecoverActions', () => {
  it('emits drift toward stage centre + jump when above stage top', () => {
    // bot off-stage left, above stage top
    const ctx = makeCtx({
      self: { position: { x: 60, y: 380 }, isAirborne: true },
    });
    const actions = selectRecoverActions(ctx);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({ kind: 'moveRight', state: 'recover' });
    expect(actions[1]).toMatchObject({ kind: 'jump', state: 'recover' });
  });

  it('emits drift + upSpecial when below stage top', () => {
    const ctx = makeCtx({
      self: { position: { x: 60, y: 500 }, isAirborne: true },
    });
    const actions = selectRecoverActions(ctx);
    expect(actions[0]?.kind).toBe('moveRight');
    expect(actions[1]).toMatchObject({ kind: 'upSpecial', state: 'recover' });
  });

  it('only emits the recovery press when already at stage centre', () => {
    const ctx = makeCtx({
      self: { position: { x: 400, y: 380 }, isAirborne: true },
    });
    const actions = selectRecoverActions(ctx);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: 'jump', state: 'recover' });
  });

  it('drifts left when off-stage right', () => {
    const ctx = makeCtx({
      self: { position: { x: 750, y: 380 }, isAirborne: true },
    });
    const actions = selectRecoverActions(ctx);
    expect(actions[0]?.kind).toBe('moveLeft');
  });
});

describe('selectRetreatActions', () => {
  it('moves away from opponent when no blast-wall pressure', () => {
    // bot at centre, opponent to right → bot retreats left
    const ctx = makeCtx({
      self: { damagePercent: 110, position: { x: 400, y: 380 } },
      opponent: makeOpponent({ position: { x: 440, y: 380 } }),
    });
    const actions = selectRetreatActions(ctx);
    expect(actions[0]).toMatchObject({ kind: 'moveLeft', state: 'retreat', note: 'awayFromOpponent' });
  });

  it('moves away from blast wall (priority over opponent direction)', () => {
    const ctx = makeCtx({
      self: { position: { x: 50, y: 380 }, damagePercent: 0 },
      opponent: makeOpponent({ position: { x: 200, y: 380 } }),
    });
    const actions = selectRetreatActions(ctx);
    expect(actions[0]).toMatchObject({
      kind: 'moveRight',
      state: 'retreat',
      note: 'awayFromBlastWall',
    });
  });

  it('moves away from right blast wall', () => {
    const ctx = makeCtx({
      self: { position: { x: 750, y: 380 } },
      opponent: makeOpponent({ position: { x: 700, y: 380 } }),
    });
    const actions = selectRetreatActions(ctx);
    expect(actions[0]).toMatchObject({ kind: 'moveLeft', note: 'awayFromBlastWall' });
  });

  it('emits idle when no opponent and no blast-wall pressure', () => {
    const ctx = makeCtx({
      self: { position: { x: 400, y: 380 } },
      opponent: null,
    });
    const actions = selectRetreatActions(ctx);
    expect(actions[0]).toMatchObject({ kind: 'idle', state: 'retreat', note: 'noPressure' });
  });

  it('adds a jump press when high % and opponent in melee reach', () => {
    const ctx = makeCtx({
      self: { damagePercent: 120, position: { x: 400, y: 380 } },
      opponent: makeOpponent({ position: { x: 440, y: 380 } }),
    });
    const actions = selectRetreatActions(ctx);
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.kind)).toContain('jump');
  });

  it('does NOT add a jump press when opponent is in tilt reach (not melee)', () => {
    const ctx = makeCtx({
      self: { damagePercent: 120, position: { x: 400, y: 380 } },
      opponent: makeOpponent({ position: { x: 480, y: 380 } }),
    });
    const actions = selectRetreatActions(ctx);
    expect(actions.map((a) => a.kind)).not.toContain('jump');
  });
});

describe('selectActionsForState dispatcher', () => {
  it('dispatches to approach', () => {
    const actions = selectActionsForState('approach', makeCtx());
    expect(actions[0]?.state).toBe('approach');
  });

  it('dispatches to attack', () => {
    const ctx = makeCtx({ opponent: makeOpponent({ position: { x: 440, y: 380 } }) });
    const actions = selectActionsForState('attack', ctx);
    expect(actions[0]?.state).toBe('attack');
  });

  it('dispatches to defend', () => {
    const actions = selectActionsForState('defend', makeCtx());
    expect(actions[0]?.state).toBe('defend');
  });

  it('dispatches to recover', () => {
    const ctx = makeCtx({ self: { position: { x: 60, y: 500 }, isAirborne: true } });
    const actions = selectActionsForState('recover', ctx);
    expect(actions.every((a) => a.state === 'recover')).toBe(true);
  });

  it('dispatches to retreat', () => {
    const ctx = makeCtx({ self: { position: { x: 50, y: 380 } } });
    const actions = selectActionsForState('retreat', ctx);
    expect(actions[0]?.state).toBe('retreat');
  });

  it('all dispatched action arrays are non-empty', () => {
    const states = ['approach', 'attack', 'defend', 'recover', 'retreat'] as const;
    for (const s of states) {
      const ctx = makeCtx({
        self: { position: { x: 60, y: 500 }, isAirborne: true, damagePercent: 110 },
        opponent: makeOpponent({ position: { x: 440, y: 380 } }),
      });
      const actions = selectActionsForState(s, ctx);
      expect(actions.length).toBeGreaterThan(0);
    }
  });

  it('determinism: same context + state yields identical actions', () => {
    const a = selectActionsForState('defend', makeCtx({ rngSeed: 5 }));
    const b = selectActionsForState('defend', makeCtx({ rngSeed: 5 }));
    expect(a).toEqual(b);
  });
});

describe('action shape invariants', () => {
  function flatten(actions: readonly DecisionAction[]): DecisionAction[] {
    return actions.slice();
  }

  it('every emitted action carries a defined state', () => {
    const states = ['approach', 'attack', 'defend', 'recover', 'retreat'] as const;
    for (const s of states) {
      const ctx = makeCtx({
        self: { position: { x: 60, y: 500 }, isAirborne: true, damagePercent: 110 },
        opponent: makeOpponent({ position: { x: 440, y: 380 } }),
      });
      const actions = flatten(selectActionsForState(s, ctx));
      for (const a of actions) {
        expect(a.state).toBe(s);
        expect(a.kind).toBeDefined();
      }
    }
  });
});
