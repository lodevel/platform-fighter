import { describe, expect, it } from 'vitest';
import { NodeStatus } from '../behaviorTree/Node';
import { Blackboard } from '../behaviorTree/Blackboard';
import { Rng } from '../../utils/Rng';
import type { PerceivedStage } from '../perception/WorldSnapshot';
import { EdgeGuardLeaf } from './EdgeGuardLeaf';
import type {
  OffensiveAction,
  OffensiveBlackboardSchema,
  OffensiveContext,
  OpponentSnapshot,
  SelfSnapshot,
} from './types';
import { DEFAULT_OFFENSIVE_BLACKBOARD } from './types';

const STAGE: PerceivedStage = {
  stageLeft: 100,
  stageRight: 500,
  stageTop: 200,
  blastZone: { left: 0, right: 600, top: 0, bottom: 400 },
};

function makeContext(overrides: {
  opponent?: OpponentSnapshot | null;
  self?: Partial<SelfSnapshot>;
  selfPosition?: { x: number; y: number };
  stage?: PerceivedStage | null;
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
    stage: overrides.stage === undefined ? STAGE : overrides.stage,
    self,
    out: { emit: (a) => emits.push(a) },
    rng: new Rng(1),
  };
  return { ctx, emits };
}

const offStageOpponent: OpponentSnapshot = {
  id: 'p2',
  distance: -150,
  damagePercent: 30,
  stateLabel: 'airborne',
  isAirborne: true,
  position: { x: 50, y: 230 },
  velocity: { vx: 2, vy: -1 },
};

describe('EdgeGuardLeaf', () => {
  it('returns Failure when opponent is null', () => {
    const leaf = new EdgeGuardLeaf();
    const { ctx, emits } = makeContext({ opponent: null });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(emits).toEqual([]);
  });

  it('returns Failure when stage is missing', () => {
    const leaf = new EdgeGuardLeaf();
    const { ctx, emits } = makeContext({
      opponent: offStageOpponent,
      stage: null,
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(emits).toEqual([]);
  });

  it('returns Failure when opponent has no position (legacy snapshot)', () => {
    const leaf = new EdgeGuardLeaf();
    const opp: OpponentSnapshot = {
      id: 'p2',
      distance: -100,
      damagePercent: 0,
      stateLabel: 'airborne',
      isAirborne: true,
    };
    const { ctx, emits } = makeContext({ opponent: opp });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(emits).toEqual([]);
  });

  it('returns Failure when bot is airborne', () => {
    const leaf = new EdgeGuardLeaf();
    const { ctx, emits } = makeContext({
      opponent: offStageOpponent,
      selfPosition: { x: 200, y: 100 },
      self: { isAirborne: true },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(emits).toEqual([]);
  });

  it('returns Failure when opponent is on stage', () => {
    const leaf = new EdgeGuardLeaf();
    const onStageOpp: OpponentSnapshot = {
      ...offStageOpponent,
      position: { x: 250, y: 150 },
      isAirborne: false,
    };
    const { ctx, emits } = makeContext({
      opponent: onStageOpp,
      selfPosition: { x: 200, y: 100 },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(emits).toEqual([]);
  });

  it('walks toward the threatened ledge when not yet anchored', () => {
    const leaf = new EdgeGuardLeaf();
    // Bot at x=200, opponent at x=50 (off-stage left)
    // Anchor = stage.left + tolerance = 100 + 16 = 116
    // Bot distance to anchor = |116 - 200| = 84
    // Opponent distance to ledge = |100 - 50| = 50; 84 ≤ 100 → commit
    // Bot needs to walk left to reach the anchor.
    const { ctx, emits } = makeContext({
      opponent: { ...offStageOpponent, position: { x: 50, y: 230 } },
      selfPosition: { x: 200, y: 100 },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Running);
    expect(emits).toEqual([{ kind: 'moveLeft' }]);
  });

  it('walks toward the right ledge when opponent is on the right', () => {
    const leaf = new EdgeGuardLeaf();
    // Opponent off the right edge of stage (stageRight=500), close to ledge.
    // Anchor = stage.right - tolerance = 500 - 16 = 484
    // Bot at x=400 → distance to anchor = 84
    // Opponent distance to ledge = |500 - 550| = 50; 84 ≤ 100 → commit
    const opp: OpponentSnapshot = {
      ...offStageOpponent,
      position: { x: 550, y: 230 },
    };
    const { ctx, emits } = makeContext({
      opponent: opp,
      selfPosition: { x: 400, y: 100 },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Running);
    expect(emits).toEqual([{ kind: 'moveRight' }]);
  });

  it('throws smash when anchored and opponent is within smash band', () => {
    const leaf = new EdgeGuardLeaf();
    // Bot exactly at left anchor (116), opponent at y near stage top → smash
    const { ctx, emits } = makeContext({
      opponent: {
        ...offStageOpponent,
        position: { x: 80, y: 220 },
      },
      selfPosition: { x: 116, y: 200 },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Success);
    expect(emits).toEqual([
      { kind: 'smash', comboStepId: 'edgeGuard.smash' },
    ]);
  });

  it('falls back to special when opponent is below smash band', () => {
    const leaf = new EdgeGuardLeaf();
    const { ctx, emits } = makeContext({
      opponent: {
        ...offStageOpponent,
        position: { x: 80, y: 350 }, // far below stage top
      },
      selfPosition: { x: 116, y: 200 },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Success);
    expect(emits).toEqual([
      { kind: 'special', comboStepId: 'edgeGuard.special' },
    ]);
  });

  it('emits idle hold when anchored but special is disabled and opponent is too low', () => {
    const leaf = new EdgeGuardLeaf({ enableSpecial: false });
    const { ctx, emits } = makeContext({
      opponent: {
        ...offStageOpponent,
        position: { x: 80, y: 350 },
      },
      selfPosition: { x: 116, y: 200 },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Running);
    expect(emits).toEqual([
      { kind: 'idle', comboStepId: 'edgeGuard.hold' },
    ]);
  });

  it('emits idle wait when anchored but cannot attack yet', () => {
    const leaf = new EdgeGuardLeaf();
    const { ctx, emits } = makeContext({
      opponent: {
        ...offStageOpponent,
        position: { x: 80, y: 220 },
      },
      selfPosition: { x: 116, y: 200 },
      self: { canAttack: false },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Running);
    expect(emits).toEqual([
      { kind: 'idle', comboStepId: 'edgeGuard.wait' },
    ]);
  });

  it('returns Failure when bot cannot reach anchor before opponent reaches ledge', () => {
    const leaf = new EdgeGuardLeaf();
    // Opponent right at stage left edge (very close to ledge)
    // Bot all the way across the stage → cannot commit
    const { ctx, emits } = makeContext({
      opponent: {
        ...offStageOpponent,
        position: { x: 99, y: 230 },
      },
      selfPosition: { x: 490, y: 100 },
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(emits).toEqual([]);
  });

  it('exposes its configured tunables', () => {
    const leaf = new EdgeGuardLeaf({
      anchorTolerancePx: 24,
      smashVerticalReachPx: 100,
      enableSpecial: false,
    });
    expect(leaf.getAnchorTolerancePx()).toBe(24);
    expect(leaf.getSmashVerticalReachPx()).toBe(100);
    expect(leaf.isSpecialEnabled()).toBe(false);
  });

  it('is deterministic — identical contexts produce identical status + emits', () => {
    const leaf1 = new EdgeGuardLeaf();
    const leaf2 = new EdgeGuardLeaf();
    const a = makeContext({
      opponent: { ...offStageOpponent, position: { x: 80, y: 220 } },
      selfPosition: { x: 116, y: 200 },
    });
    const b = makeContext({
      opponent: { ...offStageOpponent, position: { x: 80, y: 220 } },
      selfPosition: { x: 116, y: 200 },
    });
    expect(leaf1.tick(a.ctx)).toBe(leaf2.tick(b.ctx));
    expect(a.emits).toEqual(b.emits);
  });

  it('derives selfX from opponent position - distance when selfPosition absent', () => {
    const leaf = new EdgeGuardLeaf();
    // Opponent at x=80, distance = -36 → implies selfX = 80 - (-36) = 116
    // That's exactly the left anchor → smash should fire
    const opp: OpponentSnapshot = {
      ...offStageOpponent,
      position: { x: 80, y: 220 },
      distance: -36,
    };
    const { ctx, emits } = makeContext({
      opponent: opp,
      // No selfPosition
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Success);
    expect(emits[0]?.kind).toBe('smash');
  });

  // ---- AC 20205 Sub-AC 5: DI-aware anchor selection ---------------------

  describe('useDIPrediction option', () => {
    it('defaults to disabled (back-compat with non-Hard tiers)', () => {
      const leaf = new EdgeGuardLeaf();
      expect(leaf.isDIPredictionEnabled()).toBe(false);
    });

    it('reports as enabled when opted in', () => {
      const leaf = new EdgeGuardLeaf({ useDIPrediction: true });
      expect(leaf.isDIPredictionEnabled()).toBe(true);
    });

    it('routes through naive nearestStageEdge when disabled', () => {
      // Opponent currently at x=50 (off-stage left of stageLeft=100),
      // launched left, in hitstun. Naive predicate picks 'left' (the
      // side the opponent is currently closest to).
      // Stage left=100, right=500, midpoint=300.
      // Anchor for left side = 100 + 16 = 116.
      // Bot at x=200 → distance to anchor = 84.
      // Opponent distance to ledge = |100 - 50| = 50; 84 ≤ 100 → commit.
      const leaf = new EdgeGuardLeaf({ useDIPrediction: false });
      const opp: OpponentSnapshot = {
        ...offStageOpponent,
        position: { x: 50, y: 230 },
        velocity: { vx: -2, vy: -3 },
        stateLabel: 'hitstun',
      };
      const { ctx, emits } = makeContext({
        opponent: opp,
        selfPosition: { x: 200, y: 100 },
      });
      const status = leaf.tick(ctx);
      expect(status).toBe(NodeStatus.Running);
      expect(emits[0]?.kind).toBe('moveLeft');
    });

    it('uses DI-aware predicted edge when enabled', () => {
      // Opponent at x=250 (just left of midpoint 300), airborne /
      // off-stage vertically (y=230 > stageTop+slack), in hitstun
      // with a strong rightward velocity. The projection carries the
      // opponent past midpoint within the lookahead window, so the
      // DI-aware predicted recovery edge is 'right'. The naive
      // predicate (looking only at the *current* opponent X=250 ≤
      // 300) would pick 'left'.
      //
      // With useDIPrediction=true the leaf walks the bot toward the
      // RIGHT anchor (500-16 = 484) — the bot at x=200 is to the
      // left of the right anchor, so the emit is moveRight.
      const leaf = new EdgeGuardLeaf({ useDIPrediction: true });
      const opp: OpponentSnapshot = {
        ...offStageOpponent,
        position: { x: 250, y: 230 },
        velocity: { vx: 12, vy: -8 },
        stateLabel: 'hitstun',
      };
      const { ctx, emits } = makeContext({
        opponent: opp,
        selfPosition: { x: 200, y: 100 },
      });
      const status = leaf.tick(ctx);
      expect(status).toBe(NodeStatus.Running);
      expect(emits[0]?.kind).toBe('moveRight');
    });

    it('falls through to the naive ledge when DI-aware is disabled (same scenario)', () => {
      // Same opponent state as the DI-aware test above, but with
      // useDIPrediction=false: the naive predicate looks at the
      // opponent's *current* X=250 (left of midpoint 300) and picks
      // the LEFT anchor (100+16 = 116). Bot at x=200 walks LEFT.
      const leaf = new EdgeGuardLeaf({ useDIPrediction: false });
      const opp: OpponentSnapshot = {
        ...offStageOpponent,
        position: { x: 250, y: 230 },
        velocity: { vx: 12, vy: -8 },
        stateLabel: 'hitstun',
      };
      const { ctx, emits } = makeContext({
        opponent: opp,
        selfPosition: { x: 200, y: 100 },
      });
      const status = leaf.tick(ctx);
      expect(status).toBe(NodeStatus.Running);
      expect(emits[0]?.kind).toBe('moveLeft');
    });

    it('determinism — DI-aware and naive paths each produce stable outputs', () => {
      const opp: OpponentSnapshot = {
        ...offStageOpponent,
        position: { x: 80, y: 230 },
        velocity: { vx: 5, vy: -5 },
        stateLabel: 'hitstun',
      };
      const naive1 = new EdgeGuardLeaf({ useDIPrediction: false });
      const naive2 = new EdgeGuardLeaf({ useDIPrediction: false });
      const di1 = new EdgeGuardLeaf({ useDIPrediction: true });
      const di2 = new EdgeGuardLeaf({ useDIPrediction: true });
      const a = makeContext({
        opponent: opp,
        selfPosition: { x: 200, y: 100 },
      });
      const b = makeContext({
        opponent: opp,
        selfPosition: { x: 200, y: 100 },
      });
      const c = makeContext({
        opponent: opp,
        selfPosition: { x: 200, y: 100 },
      });
      const d = makeContext({
        opponent: opp,
        selfPosition: { x: 200, y: 100 },
      });
      expect(naive1.tick(a.ctx)).toBe(naive2.tick(b.ctx));
      expect(a.emits).toEqual(b.emits);
      expect(di1.tick(c.ctx)).toBe(di2.tick(d.ctx));
      expect(c.emits).toEqual(d.emits);
    });
  });
});
