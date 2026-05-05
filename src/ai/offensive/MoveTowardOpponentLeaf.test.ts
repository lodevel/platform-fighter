import { describe, expect, it } from 'vitest';
import { NodeStatus } from '../behaviorTree/Node';
import { Blackboard } from '../behaviorTree/Blackboard';
import { Rng } from '../../utils/Rng';
import { MoveTowardOpponentLeaf } from './MoveTowardOpponentLeaf';
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
  tickIndex?: number;
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
    tickIndex: overrides.tickIndex ?? 0,
    opponent: overrides.opponent ?? null,
    self,
    out: { emit: (a) => emits.push(a) },
    rng: new Rng(1),
  };
  return { ctx, emits };
}

describe('MoveTowardOpponentLeaf', () => {
  it('rejects non-positive preferredRangePx', () => {
    expect(() => new MoveTowardOpponentLeaf({ preferredRangePx: 0 })).toThrow(
      /preferredRangePx/,
    );
    expect(() =>
      new MoveTowardOpponentLeaf({ preferredRangePx: -10 }),
    ).toThrow(/preferredRangePx/);
  });

  it('returns Failure when no opponent is alive', () => {
    const leaf = new MoveTowardOpponentLeaf({ preferredRangePx: 50 });
    const { ctx, emits } = makeContext({ opponent: null });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(emits).toEqual([]);
  });

  it('returns Success with no emit when already inside range', () => {
    const leaf = new MoveTowardOpponentLeaf({ preferredRangePx: 50 });
    const { ctx, emits } = makeContext({
      opponent: {
        id: 'p2',
        distance: 30,
        damagePercent: 10,
        stateLabel: 'idle',
        isAirborne: false,
      },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Success);
    expect(emits).toEqual([]);
  });

  it('emits moveRight when opponent is to the right and out of range', () => {
    const leaf = new MoveTowardOpponentLeaf({ preferredRangePx: 50 });
    const { ctx, emits } = makeContext({
      opponent: {
        id: 'p2',
        distance: 200,
        damagePercent: 10,
        stateLabel: 'idle',
        isAirborne: false,
      },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Running);
    expect(emits).toEqual([{ kind: 'moveRight' }]);
  });

  it('emits moveLeft when opponent is to the left and out of range', () => {
    const leaf = new MoveTowardOpponentLeaf({ preferredRangePx: 50 });
    const { ctx, emits } = makeContext({
      opponent: {
        id: 'p2',
        distance: -150,
        damagePercent: 10,
        stateLabel: 'idle',
        isAirborne: false,
      },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Running);
    expect(emits).toEqual([{ kind: 'moveLeft' }]);
  });

  it('boundary — distance equal to preferredRangePx returns Success', () => {
    const leaf = new MoveTowardOpponentLeaf({ preferredRangePx: 50 });
    const { ctx, emits } = makeContext({
      opponent: {
        id: 'p2',
        distance: 50,
        damagePercent: 10,
        stateLabel: 'idle',
        isAirborne: false,
      },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Success);
    expect(emits).toEqual([]);
  });

  it('exposes the configured range', () => {
    const leaf = new MoveTowardOpponentLeaf({ preferredRangePx: 70 });
    expect(leaf.getPreferredRangePx()).toBe(70);
  });

  it('is deterministic — identical contexts produce identical status + emits', () => {
    const leaf1 = new MoveTowardOpponentLeaf({ preferredRangePx: 50 });
    const leaf2 = new MoveTowardOpponentLeaf({ preferredRangePx: 50 });
    const a = makeContext({
      opponent: {
        id: 'p2',
        distance: 100,
        damagePercent: 10,
        stateLabel: 'idle',
        isAirborne: false,
      },
    });
    const b = makeContext({
      opponent: {
        id: 'p2',
        distance: 100,
        damagePercent: 10,
        stateLabel: 'idle',
        isAirborne: false,
      },
    });
    expect(leaf1.tick(a.ctx)).toBe(leaf2.tick(b.ctx));
    expect(a.emits).toEqual(b.emits);
  });
});
