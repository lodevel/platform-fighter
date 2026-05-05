import { describe, expect, it } from 'vitest';
import { NodeStatus } from '../behaviorTree/Node';
import { Blackboard } from '../behaviorTree/Blackboard';
import { Rng } from '../../utils/Rng';
import { FireAttackLeaf } from './FireAttackLeaf';
import type {
  OffensiveAction,
  OffensiveBlackboardSchema,
  OffensiveContext,
  OpponentSnapshot,
  SelfSnapshot,
} from './types';
import { DEFAULT_OFFENSIVE_BLACKBOARD } from './types';

function makeContext(overrides: {
  opponent?: OpponentSnapshot | null;
  self?: Partial<SelfSnapshot>;
  emits?: OffensiveAction[];
}): { ctx: OffensiveContext; emits: OffensiveAction[] } {
  const emits = overrides.emits ?? [];
  const blackboard = new Blackboard<OffensiveBlackboardSchema>({
    ...DEFAULT_OFFENSIVE_BLACKBOARD,
  });
  const self: SelfSnapshot = {
    facing: 1,
    canAttack: true,
    isAirborne: false,
    damagePercent: 0,
    ...overrides.self,
  };
  const ctx: OffensiveContext = {
    blackboard,
    tickIndex: 0,
    opponent: overrides.opponent ?? null,
    self,
    out: { emit: (a) => emits.push(a) },
    rng: new Rng(1),
  };
  return { ctx, emits };
}

describe('FireAttackLeaf', () => {
  it('rejects non-positive maxRangePx', () => {
    expect(
      () => new FireAttackLeaf({ attackKind: 'jab', maxRangePx: 0 }),
    ).toThrow(/maxRangePx/);
  });

  it('returns Failure when no opponent is alive', () => {
    const leaf = new FireAttackLeaf({ attackKind: 'jab', maxRangePx: 50 });
    const { ctx, emits } = makeContext({ opponent: null });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(emits).toEqual([]);
  });

  it('returns Failure when self.canAttack is false', () => {
    const leaf = new FireAttackLeaf({ attackKind: 'jab', maxRangePx: 50 });
    const { ctx, emits } = makeContext({
      opponent: {
        id: 'p2',
        distance: 30,
        damagePercent: 0,
        stateLabel: 'idle',
        isAirborne: false,
      },
      self: { canAttack: false },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(emits).toEqual([]);
  });

  it('returns Failure when opponent is out of range', () => {
    const leaf = new FireAttackLeaf({ attackKind: 'jab', maxRangePx: 50 });
    const { ctx, emits } = makeContext({
      opponent: {
        id: 'p2',
        distance: 200,
        damagePercent: 0,
        stateLabel: 'idle',
        isAirborne: false,
      },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(emits).toEqual([]);
  });

  it('emits the configured attack kind when all gates clear', () => {
    const leaf = new FireAttackLeaf({ attackKind: 'jab', maxRangePx: 50 });
    const { ctx, emits } = makeContext({
      opponent: {
        id: 'p2',
        distance: 30,
        damagePercent: 0,
        stateLabel: 'idle',
        isAirborne: false,
      },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Success);
    expect(emits).toEqual([{ kind: 'jab', comboStepId: 'neutral' }]);
  });

  it('forwards the configured comboStepId on the emit', () => {
    const leaf = new FireAttackLeaf({
      attackKind: 'smash',
      maxRangePx: 70,
      comboStepId: 'koFinisher',
    });
    const { ctx, emits } = makeContext({
      opponent: {
        id: 'p2',
        distance: 60,
        damagePercent: 90,
        stateLabel: 'idle',
        isAirborne: false,
      },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Success);
    expect(emits).toEqual([{ kind: 'smash', comboStepId: 'koFinisher' }]);
  });

  it('boundary — distance exactly equal to maxRangePx fires', () => {
    const leaf = new FireAttackLeaf({ attackKind: 'tilt', maxRangePx: 60 });
    const { ctx, emits } = makeContext({
      opponent: {
        id: 'p2',
        distance: -60,
        damagePercent: 0,
        stateLabel: 'idle',
        isAirborne: false,
      },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Success);
    expect(emits).toEqual([{ kind: 'tilt', comboStepId: 'neutral' }]);
  });

  it('exposes inspectors for tests', () => {
    const leaf = new FireAttackLeaf({
      attackKind: 'special',
      maxRangePx: 80,
      comboStepId: 'zone',
    });
    expect(leaf.getAttackKind()).toBe('special');
    expect(leaf.getMaxRangePx()).toBe(80);
    expect(leaf.getComboStepId()).toBe('zone');
  });
});
