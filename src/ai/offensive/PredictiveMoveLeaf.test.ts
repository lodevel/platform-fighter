import { describe, expect, it } from 'vitest';
import { NodeStatus } from '../behaviorTree/Node';
import { Blackboard } from '../behaviorTree/Blackboard';
import { Rng } from '../../utils/Rng';
import { PredictiveMoveLeaf } from './PredictiveMoveLeaf';
import { DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES } from './predictiveMovement';
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
  selfPosition?: { x: number; y: number };
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
    selfPosition: overrides.selfPosition,
    self,
    out: { emit: (a) => emits.push(a) },
    rng: new Rng(1),
  };
  return { ctx, emits };
}

describe('PredictiveMoveLeaf', () => {
  it('rejects non-positive preferredRangePx', () => {
    expect(() => new PredictiveMoveLeaf({ preferredRangePx: 0 })).toThrow(
      /preferredRangePx/,
    );
    expect(() => new PredictiveMoveLeaf({ preferredRangePx: -10 })).toThrow(
      /preferredRangePx/,
    );
  });

  it('clamps the lookahead value to the supported band', () => {
    const leaf = new PredictiveMoveLeaf({
      preferredRangePx: 50,
      lookaheadFrames: 1000,
    });
    expect(leaf.getLookaheadFrames()).toBeLessThanOrEqual(60);
  });

  it('uses the documented default lookahead when omitted', () => {
    const leaf = new PredictiveMoveLeaf({ preferredRangePx: 50 });
    expect(leaf.getLookaheadFrames()).toBe(DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES);
  });

  it('returns Failure when no opponent is alive', () => {
    const leaf = new PredictiveMoveLeaf({ preferredRangePx: 50 });
    const { ctx, emits } = makeContext({ opponent: null });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(emits).toEqual([]);
  });

  it('falls back to current distance when opponent has no position', () => {
    const leaf = new PredictiveMoveLeaf({ preferredRangePx: 50 });
    const { ctx, emits } = makeContext({
      opponent: {
        id: 'p2',
        distance: 100,
        damagePercent: 0,
        stateLabel: 'idle',
        isAirborne: false,
      },
    });
    // Distance 100 > range 50, opponent on the right → moveRight
    expect(leaf.tick(ctx)).toBe(NodeStatus.Running);
    expect(emits).toEqual([{ kind: 'moveRight' }]);
  });

  it('predicts forward and emits movement toward projected position', () => {
    // selfPosition.x = 100, opponent at x=200 with vx=4 px/step
    // lookahead 5 → projected x = 220, distance = 120 → moveRight
    const leaf = new PredictiveMoveLeaf({
      preferredRangePx: 50,
      lookaheadFrames: 5,
    });
    const { ctx, emits } = makeContext({
      selfPosition: { x: 100, y: 0 },
      opponent: {
        id: 'p2',
        distance: 100,
        damagePercent: 0,
        stateLabel: 'idle',
        isAirborne: false,
        position: { x: 200, y: 0 },
        velocity: { vx: 4, vy: 0 },
      },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Running);
    expect(emits).toEqual([{ kind: 'moveRight' }]);
  });

  it('intercepts a retreating opponent (negative velocity)', () => {
    // selfX 0, opp at x=120 with vx=-12 px/step, lookahead 8
    // projected x = 24, signed distance = 24 → inside range 50 → stop
    const leaf = new PredictiveMoveLeaf({
      preferredRangePx: 50,
      lookaheadFrames: 8,
    });
    const { ctx, emits } = makeContext({
      selfPosition: { x: 0, y: 0 },
      opponent: {
        id: 'p2',
        distance: 120,
        damagePercent: 0,
        stateLabel: 'idle',
        isAirborne: false,
        position: { x: 120, y: 0 },
        velocity: { vx: -12, vy: 0 },
      },
    });
    // Without prediction the bot would walk right toward distance 120;
    // with prediction it sees the opponent will arrive in range and stops.
    expect(leaf.tick(ctx)).toBe(NodeStatus.Success);
    expect(emits).toEqual([]);
  });

  it('emits moveLeft when projected position is to the left', () => {
    const leaf = new PredictiveMoveLeaf({
      preferredRangePx: 30,
      lookaheadFrames: 4,
    });
    const { ctx, emits } = makeContext({
      selfPosition: { x: 200, y: 0 },
      opponent: {
        id: 'p2',
        distance: -150,
        damagePercent: 0,
        stateLabel: 'idle',
        isAirborne: false,
        position: { x: 50, y: 0 },
        velocity: { vx: -8, vy: 0 },
      },
    });
    // Projected x = 50 - 32 = 18, signed distance = -182 → moveLeft
    expect(leaf.tick(ctx)).toBe(NodeStatus.Running);
    expect(emits).toEqual([{ kind: 'moveLeft' }]);
  });

  it('returns Success and emits nothing when already in range', () => {
    const leaf = new PredictiveMoveLeaf({
      preferredRangePx: 60,
      lookaheadFrames: 3,
    });
    const { ctx, emits } = makeContext({
      selfPosition: { x: 0, y: 0 },
      opponent: {
        id: 'p2',
        distance: 40,
        damagePercent: 0,
        stateLabel: 'idle',
        isAirborne: false,
        position: { x: 40, y: 0 },
        velocity: { vx: 0, vy: 0 },
      },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Success);
    expect(emits).toEqual([]);
  });

  it('derives selfX from opponent.position - opponent.distance when selfPosition is absent', () => {
    const leaf = new PredictiveMoveLeaf({
      preferredRangePx: 30,
      lookaheadFrames: 4,
    });
    const { ctx, emits } = makeContext({
      // No selfPosition
      opponent: {
        id: 'p2',
        distance: 100, // Implies selfX = 200 - 100 = 100
        damagePercent: 0,
        stateLabel: 'idle',
        isAirborne: false,
        position: { x: 200, y: 0 },
        velocity: { vx: 5, vy: 0 },
      },
    });
    // selfX inferred = 100, projected oppX = 220, distance = 120 → moveRight
    expect(leaf.tick(ctx)).toBe(NodeStatus.Running);
    expect(emits).toEqual([{ kind: 'moveRight' }]);
  });

  it('exposes its configured tunables', () => {
    const leaf = new PredictiveMoveLeaf({
      preferredRangePx: 75,
      lookaheadFrames: 12,
    });
    expect(leaf.getPreferredRangePx()).toBe(75);
    expect(leaf.getLookaheadFrames()).toBe(12);
  });

  it('is deterministic — identical contexts produce identical status + emits', () => {
    const leaf1 = new PredictiveMoveLeaf({
      preferredRangePx: 50,
      lookaheadFrames: 8,
    });
    const leaf2 = new PredictiveMoveLeaf({
      preferredRangePx: 50,
      lookaheadFrames: 8,
    });
    const a = makeContext({
      selfPosition: { x: 0, y: 0 },
      opponent: {
        id: 'p2',
        distance: 200,
        damagePercent: 0,
        stateLabel: 'idle',
        isAirborne: false,
        position: { x: 200, y: 0 },
        velocity: { vx: 3, vy: 0 },
      },
    });
    const b = makeContext({
      selfPosition: { x: 0, y: 0 },
      opponent: {
        id: 'p2',
        distance: 200,
        damagePercent: 0,
        stateLabel: 'idle',
        isAirborne: false,
        position: { x: 200, y: 0 },
        velocity: { vx: 3, vy: 0 },
      },
    });
    expect(leaf1.tick(a.ctx)).toBe(leaf2.tick(b.ctx));
    expect(a.emits).toEqual(b.emits);
  });
});
