import { describe, expect, it } from 'vitest';
import { NodeStatus } from '../behaviorTree/Node';
import { Blackboard } from '../behaviorTree/Blackboard';
import { Rng } from '../../utils/Rng';
import { RecognizeFollowUpLeaf } from './RecognizeFollowUpLeaf';
import { registerLandedHit } from './registerLandedHit';
import type {
  OffensiveAction,
  OffensiveBlackboardSchema,
  OffensiveContext,
  OpponentSnapshot,
  SelfSnapshot,
} from './types';
import { DEFAULT_OFFENSIVE_BLACKBOARD } from './types';
import {
  JAB_TO_TILT_FRAMES,
  KO_PERCENT_THRESHOLD,
} from './comboRecognition';

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

describe('RecognizeFollowUpLeaf', () => {
  it('returns Failure when no chain is in flight', () => {
    const leaf = new RecognizeFollowUpLeaf();
    const { ctx, blackboard } = makeContext({});
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(blackboard.get('comboPlannedFollowUp')).toBeNull();
  });

  it('stages a jab→tilt plan after a jab lands at low percent', () => {
    const leaf = new RecognizeFollowUpLeaf();
    const blackboard = new Blackboard<OffensiveBlackboardSchema>({
      ...DEFAULT_OFFENSIVE_BLACKBOARD,
    });
    registerLandedHit(blackboard, {
      landed: 'jab',
      landedTick: 5,
      opponentPercent: 30,
    });
    const { ctx } = makeContext({ blackboard, tickIndex: 6 });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Success);
    expect(blackboard.get('comboPlannedFollowUp')).toEqual({
      nextAttack: 'tilt',
      maxFollowUpFrames: JAB_TO_TILT_FRAMES,
      comboStepId: 'jab→tilt',
    });
  });

  it('stages a jab→smash plan after a jab lands at KO percent', () => {
    const leaf = new RecognizeFollowUpLeaf();
    const blackboard = new Blackboard<OffensiveBlackboardSchema>({
      ...DEFAULT_OFFENSIVE_BLACKBOARD,
    });
    registerLandedHit(blackboard, {
      landed: 'jab',
      landedTick: 10,
      opponentPercent: KO_PERCENT_THRESHOLD,
    });
    const { ctx } = makeContext({ blackboard, tickIndex: 11 });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Success);
    const plan = blackboard.get('comboPlannedFollowUp');
    expect(plan?.nextAttack).toBe('smash');
    expect(plan?.comboStepId).toBe('jab→smash');
  });

  it('drops the chain when the follow-up window has expired', () => {
    const leaf = new RecognizeFollowUpLeaf();
    const blackboard = new Blackboard<OffensiveBlackboardSchema>({
      ...DEFAULT_OFFENSIVE_BLACKBOARD,
    });
    registerLandedHit(blackboard, {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: 30,
    });
    // Tick well past the JAB_TO_TILT_FRAMES window.
    const { ctx } = makeContext({
      blackboard,
      tickIndex: JAB_TO_TILT_FRAMES + 5,
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(blackboard.get('comboStage')).toBe('idle');
    expect(blackboard.get('comboLastLandedMove')).toBeNull();
    expect(blackboard.get('comboPlannedFollowUp')).toBeNull();
  });

  it('drops the chain after a tilt at low percent (no smash → drop)', () => {
    const leaf = new RecognizeFollowUpLeaf();
    const blackboard = new Blackboard<OffensiveBlackboardSchema>({
      ...DEFAULT_OFFENSIVE_BLACKBOARD,
    });
    registerLandedHit(blackboard, {
      landed: 'tilt',
      landedTick: 50,
      opponentPercent: 20,
    });
    const { ctx } = makeContext({ blackboard, tickIndex: 52 });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(blackboard.get('comboStage')).toBe('idle');
  });

  it('clears stale plan when stage is idle (defensive guard)', () => {
    const leaf = new RecognizeFollowUpLeaf();
    const blackboard = new Blackboard<OffensiveBlackboardSchema>({
      ...DEFAULT_OFFENSIVE_BLACKBOARD,
    });
    blackboard.set('comboPlannedFollowUp', {
      nextAttack: 'tilt',
      maxFollowUpFrames: 12,
      comboStepId: 'stale',
    });
    const { ctx } = makeContext({ blackboard });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    expect(blackboard.get('comboPlannedFollowUp')).toBeNull();
  });

  it('is deterministic — identical inputs produce identical plans', () => {
    const a = new RecognizeFollowUpLeaf();
    const b = new RecognizeFollowUpLeaf();

    const bbA = new Blackboard<OffensiveBlackboardSchema>({
      ...DEFAULT_OFFENSIVE_BLACKBOARD,
    });
    const bbB = new Blackboard<OffensiveBlackboardSchema>({
      ...DEFAULT_OFFENSIVE_BLACKBOARD,
    });
    registerLandedHit(bbA, {
      landed: 'jab',
      landedTick: 12,
      opponentPercent: 25,
    });
    registerLandedHit(bbB, {
      landed: 'jab',
      landedTick: 12,
      opponentPercent: 25,
    });

    const ctxA = makeContext({ blackboard: bbA, tickIndex: 14 }).ctx;
    const ctxB = makeContext({ blackboard: bbB, tickIndex: 14 }).ctx;

    expect(a.tick(ctxA)).toBe(b.tick(ctxB));
    expect(bbA.get('comboPlannedFollowUp')).toEqual(
      bbB.get('comboPlannedFollowUp'),
    );
  });
});
