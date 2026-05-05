import { describe, expect, it } from 'vitest';
import { Blackboard } from '../behaviorTree/Blackboard';
import { BehaviorTree } from '../behaviorTree/BehaviorTree';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';
import type { PerceivedStage } from '../perception/WorldSnapshot';
import {
  buildHardOffensiveTreeV2,
  resolveHardOffensiveTreeV2Options,
} from './HardOffensiveTreeV2';
import { KO_PERCENT_THRESHOLD } from './comboRecognition';
import { DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES } from './predictiveMovement';
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

interface Harness {
  ctx: OffensiveContext;
  emits: OffensiveAction[];
  blackboard: Blackboard<OffensiveBlackboardSchema>;
  setOpponent(snap: OpponentSnapshot | null): void;
  setSelf(self: Partial<SelfSnapshot>): void;
  setSelfPosition(p: { x: number; y: number } | undefined): void;
  setStage(s: PerceivedStage | null): void;
  bumpTick(): void;
}

function makeHarness(initialOpponent: OpponentSnapshot | null = null): Harness {
  const emits: OffensiveAction[] = [];
  const blackboard = new Blackboard<OffensiveBlackboardSchema>({
    ...DEFAULT_OFFENSIVE_BLACKBOARD,
  });
  let opponent: OpponentSnapshot | null = initialOpponent;
  let self: SelfSnapshot = {
    facing: 1,
    canAttack: true,
    isAirborne: false,
    damagePercent: 0,
  };
  let selfPosition: { x: number; y: number } | undefined = { x: 250, y: 100 };
  let stage: PerceivedStage | null = STAGE;
  let tickIndex = 0;

  const ctx: OffensiveContext = {
    blackboard,
    get tickIndex() {
      return tickIndex;
    },
    get opponent() {
      return opponent;
    },
    get self() {
      return self;
    },
    get selfPosition() {
      return selfPosition;
    },
    get stage() {
      return stage;
    },
    out: { emit: (a) => emits.push(a) },
    rng: new Rng(1),
  } as OffensiveContext;

  return {
    ctx,
    emits,
    blackboard,
    setOpponent(snap) {
      opponent = snap;
    },
    setSelf(patch) {
      self = { ...self, ...patch };
    },
    setSelfPosition(p) {
      selfPosition = p;
    },
    setStage(s) {
      stage = s;
    },
    bumpTick() {
      tickIndex += 1;
    },
  };
}

describe('resolveHardOffensiveTreeV2Options', () => {
  it('applies documented defaults', () => {
    const r = resolveHardOffensiveTreeV2Options();
    expect(r.neutralJabRangePx).toBe(50);
    expect(r.koSmashRangePx).toBe(72);
    expect(r.comboFollowUpRangePx).toBe(60);
    expect(r.koPercentThreshold).toBe(KO_PERCENT_THRESHOLD);
    expect(r.predictiveLookaheadFrames).toBe(
      DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES,
    );
    expect(r.edgeGuard).toEqual({});
  });

  it('passes through user overrides', () => {
    const r = resolveHardOffensiveTreeV2Options({
      neutralJabRangePx: 60,
      koSmashRangePx: 80,
      comboFollowUpRangePx: 70,
      koPercentThreshold: 90,
      predictiveLookaheadFrames: 12,
      edgeGuard: { anchorTolerancePx: 24 },
    });
    expect(r.neutralJabRangePx).toBe(60);
    expect(r.koSmashRangePx).toBe(80);
    expect(r.comboFollowUpRangePx).toBe(70);
    expect(r.koPercentThreshold).toBe(90);
    expect(r.predictiveLookaheadFrames).toBe(12);
    expect(r.edgeGuard).toEqual({ anchorTolerancePx: 24 });
  });

  it('clamps oversized predictive lookahead requests', () => {
    const r = resolveHardOffensiveTreeV2Options({
      predictiveLookaheadFrames: 1000,
    });
    expect(r.predictiveLookaheadFrames).toBeLessThanOrEqual(60);
  });
});

describe('buildHardOffensiveTreeV2 — branch priority', () => {
  it('takes the edge-guard branch when opponent is off-stage', () => {
    const root = buildHardOffensiveTreeV2();
    const tree = new BehaviorTree(root);
    const h = makeHarness();
    h.setOpponent({
      id: 'p2',
      // Opponent off the left side, near stage top
      distance: -200,
      damagePercent: 30,
      stateLabel: 'airborne',
      isAirborne: true,
      position: { x: 50, y: 220 },
      velocity: { vx: 1, vy: 0 },
    });
    // Bot at x=130 (close to left anchor 116) → should be anchored and emit smash
    h.setSelfPosition({ x: 130, y: 200 });

    expect(tree.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits[0]?.kind).toBe('smash');
    expect(h.emits[0]?.comboStepId).toBe('edgeGuard.smash');
  });

  it('falls through to neutral jab when opponent is on stage near the bot', () => {
    const root = buildHardOffensiveTreeV2();
    const tree = new BehaviorTree(root);
    const h = makeHarness();
    h.setOpponent({
      id: 'p2',
      distance: 30,
      damagePercent: 0,
      stateLabel: 'idle',
      isAirborne: false,
      position: { x: 280, y: 100 },
      velocity: { vx: 0, vy: 0 },
    });
    h.setSelfPosition({ x: 250, y: 100 });

    // Bot already in jab range → predictive move is Success, jab fires
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Success);
    const kinds = h.emits.map((e) => e.kind);
    expect(kinds).toContain('jab');
  });

  it('uses predictive movement to close on a moving opponent', () => {
    const root = buildHardOffensiveTreeV2();
    const tree = new BehaviorTree(root);
    const h = makeHarness();
    // Opponent at x=400 retreating right with velocity 5; lookahead 8
    // → projected x = 440, signed distance from selfX 250 = 190 → moveRight
    h.setOpponent({
      id: 'p2',
      distance: 150,
      damagePercent: 0,
      stateLabel: 'idle',
      isAirborne: false,
      position: { x: 400, y: 100 },
      velocity: { vx: 5, vy: 0 },
    });
    h.setSelfPosition({ x: 250, y: 100 });

    expect(tree.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits[0]?.kind).toBe('moveRight');
  });

  it('takes the KO smash branch at high damage when in range', () => {
    const root = buildHardOffensiveTreeV2();
    const tree = new BehaviorTree(root);
    const h = makeHarness();
    h.setOpponent({
      id: 'p2',
      distance: 50,
      damagePercent: KO_PERCENT_THRESHOLD + 10,
      stateLabel: 'idle',
      isAirborne: false,
      position: { x: 300, y: 100 },
      velocity: { vx: 0, vy: 0 },
    });
    h.setSelfPosition({ x: 250, y: 100 });

    expect(tree.tick(h.ctx)).toBe(NodeStatus.Success);
    const kinds = h.emits.map((e) => e.kind);
    expect(kinds).toContain('smash');
    expect(h.emits.find((e) => e.kind === 'smash')?.comboStepId).toBe(
      'koFinisher',
    );
  });

  it('returns Failure when no branch can fire (no opponent)', () => {
    const root = buildHardOffensiveTreeV2();
    const tree = new BehaviorTree(root);
    const h = makeHarness(null);
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

describe('buildHardOffensiveTreeV2 — determinism', () => {
  it('two trees with the same options produce the same emit stream', () => {
    const a = makeHarness();
    const b = makeHarness();
    const opp: OpponentSnapshot = {
      id: 'p2',
      distance: 80,
      damagePercent: 0,
      stateLabel: 'idle',
      isAirborne: false,
      position: { x: 330, y: 100 },
      velocity: { vx: 2, vy: 0 },
    };
    a.setOpponent(opp);
    b.setOpponent(opp);

    const treeA = new BehaviorTree(buildHardOffensiveTreeV2());
    const treeB = new BehaviorTree(buildHardOffensiveTreeV2());

    for (let i = 0; i < 5; i += 1) {
      treeA.tick(a.ctx);
      treeB.tick(b.ctx);
      a.bumpTick();
      b.bumpTick();
    }
    expect(a.emits).toEqual(b.emits);
  });
});
