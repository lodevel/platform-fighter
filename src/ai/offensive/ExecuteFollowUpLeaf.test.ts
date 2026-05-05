import { describe, expect, it } from 'vitest';
import { NodeStatus } from '../behaviorTree/Node';
import { Blackboard } from '../behaviorTree/Blackboard';
import { Rng } from '../../utils/Rng';
import { ExecuteFollowUpLeaf } from './ExecuteFollowUpLeaf';
import type {
  OffensiveAction,
  OffensiveBlackboardSchema,
  OffensiveContext,
  OpponentSnapshot,
  PlannedFollowUp,
  SelfSnapshot,
} from './types';
import { DEFAULT_OFFENSIVE_BLACKBOARD } from './types';

function makeContext(opts: {
  opponent?: OpponentSnapshot | null;
  self?: Partial<SelfSnapshot>;
  tickIndex?: number;
  emits?: OffensiveAction[];
  blackboard?: Blackboard<OffensiveBlackboardSchema>;
}): {
  ctx: OffensiveContext;
  emits: OffensiveAction[];
  blackboard: Blackboard<OffensiveBlackboardSchema>;
} {
  const emits = opts.emits ?? [];
  const blackboard =
    opts.blackboard ??
    new Blackboard<OffensiveBlackboardSchema>({
      ...DEFAULT_OFFENSIVE_BLACKBOARD,
    });
  const self: SelfSnapshot = {
    facing: 1,
    canAttack: true,
    isAirborne: false,
    damagePercent: 0,
    ...opts.self,
  };
  const ctx: OffensiveContext = {
    blackboard,
    tickIndex: opts.tickIndex ?? 0,
    opponent: opts.opponent ?? null,
    self,
    out: { emit: (a) => emits.push(a) },
    rng: new Rng(1),
  };
  return { ctx, emits, blackboard };
}

function stagePlan(
  blackboard: Blackboard<OffensiveBlackboardSchema>,
  plan: PlannedFollowUp,
  landedTick = 0,
): void {
  blackboard.set('comboStage', 'jabConnected');
  blackboard.set('comboLastLandedMove', 'jab');
  blackboard.set('comboLastLandedTick', landedTick);
  blackboard.set('comboLastLandedOpponentPercent', 30);
  blackboard.set('comboPlannedFollowUp', plan);
}

describe('ExecuteFollowUpLeaf', () => {
  it('returns Failure when no plan is staged', () => {
    const leaf = new ExecuteFollowUpLeaf();
    const { ctx, emits } = makeContext({
      opponent: {
        id: 'p2',
        distance: 30,
        damagePercent: 0,
        stateLabel: 'idle',
        isAirborne: false,
      },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(emits).toEqual([]);
  });

  it('clears the plan and returns Failure when no opponent is alive', () => {
    const leaf = new ExecuteFollowUpLeaf();
    const { ctx, emits, blackboard } = makeContext({ opponent: null });
    stagePlan(blackboard, {
      nextAttack: 'tilt',
      maxFollowUpFrames: 12,
      comboStepId: 'jab→tilt',
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(emits).toEqual([]);
    expect(blackboard.get('comboPlannedFollowUp')).toBeNull();
  });

  it('returns Running and keeps the plan when canAttack is false', () => {
    const leaf = new ExecuteFollowUpLeaf();
    const { ctx, emits, blackboard } = makeContext({
      opponent: {
        id: 'p2',
        distance: 30,
        damagePercent: 30,
        stateLabel: 'hitstun',
        isAirborne: false,
      },
      self: { canAttack: false },
    });
    const plan: PlannedFollowUp = {
      nextAttack: 'tilt',
      maxFollowUpFrames: 12,
      comboStepId: 'jab→tilt',
    };
    stagePlan(blackboard, plan);
    expect(leaf.tick(ctx)).toBe(NodeStatus.Running);
    expect(emits).toEqual([]);
    // Plan still latched for the next tick.
    expect(blackboard.get('comboPlannedFollowUp')).toEqual(plan);
  });

  it('returns Running when opponent is out of reach for the planned attack', () => {
    const leaf = new ExecuteFollowUpLeaf();
    const { ctx, emits, blackboard } = makeContext({
      opponent: {
        id: 'p2',
        distance: 200, // beyond default tilt reach (60)
        damagePercent: 30,
        stateLabel: 'hitstun',
        isAirborne: false,
      },
    });
    const plan: PlannedFollowUp = {
      nextAttack: 'tilt',
      maxFollowUpFrames: 12,
      comboStepId: 'jab→tilt',
    };
    stagePlan(blackboard, plan);
    expect(leaf.tick(ctx)).toBe(NodeStatus.Running);
    expect(emits).toEqual([]);
    expect(blackboard.get('comboPlannedFollowUp')).toEqual(plan);
  });

  it('clears chain and returns Failure when the window has expired', () => {
    const leaf = new ExecuteFollowUpLeaf();
    const { ctx, emits, blackboard } = makeContext({
      opponent: {
        id: 'p2',
        distance: 30,
        damagePercent: 30,
        stateLabel: 'hitstun',
        isAirborne: false,
      },
      tickIndex: 25, // far past the 12-frame window
    });
    stagePlan(blackboard, {
      nextAttack: 'tilt',
      maxFollowUpFrames: 12,
      comboStepId: 'jab→tilt',
    }, 0);
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(emits).toEqual([]);
    expect(blackboard.get('comboStage')).toBe('idle');
    expect(blackboard.get('comboPlannedFollowUp')).toBeNull();
  });

  it('emits the planned attack and clears the plan when all gates clear', () => {
    const leaf = new ExecuteFollowUpLeaf();
    const { ctx, emits, blackboard } = makeContext({
      opponent: {
        id: 'p2',
        distance: 40,
        damagePercent: 30,
        stateLabel: 'hitstun',
        isAirborne: false,
      },
      tickIndex: 5,
    });
    const plan: PlannedFollowUp = {
      nextAttack: 'tilt',
      maxFollowUpFrames: 12,
      comboStepId: 'jab→tilt',
    };
    stagePlan(blackboard, plan, 0);
    expect(leaf.tick(ctx)).toBe(NodeStatus.Success);
    expect(emits).toEqual([{ kind: 'tilt', comboStepId: 'jab→tilt' }]);
    // Plan consumed.
    expect(blackboard.get('comboPlannedFollowUp')).toBeNull();
    // Stage NOT reset here — the controller's registerLandedHit will
    // promote it to tiltConnected if the press actually connects.
    expect(blackboard.get('comboStage')).toBe('jabConnected');
  });

  it('honours custom reach overrides', () => {
    const leaf = new ExecuteFollowUpLeaf({
      maxRangePxByAttack: { jab: 30, tilt: 30, smash: 30, special: 30 },
    });
    const { ctx, emits, blackboard } = makeContext({
      opponent: {
        id: 'p2',
        distance: 40, // beyond the custom 30 px reach
        damagePercent: 30,
        stateLabel: 'hitstun',
        isAirborne: false,
      },
    });
    stagePlan(blackboard, {
      nextAttack: 'tilt',
      maxFollowUpFrames: 12,
      comboStepId: 'jab→tilt',
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Running);
    expect(emits).toEqual([]);
  });
});
