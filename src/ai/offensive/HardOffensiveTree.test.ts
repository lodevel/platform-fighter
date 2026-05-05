import { describe, expect, it } from 'vitest';
import { Blackboard } from '../behaviorTree/Blackboard';
import { BehaviorTree } from '../behaviorTree/BehaviorTree';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';
import {
  buildHardOffensiveTree,
  resolveHardOffensiveTreeOptions,
} from './HardOffensiveTree';
import { registerLandedHit } from './registerLandedHit';
import { KO_PERCENT_THRESHOLD } from './comboRecognition';
import type {
  OffensiveAction,
  OffensiveBlackboardSchema,
  OffensiveContext,
  OpponentSnapshot,
  SelfSnapshot,
} from './types';
import { DEFAULT_OFFENSIVE_BLACKBOARD } from './types';

interface Harness {
  ctx: OffensiveContext;
  emits: OffensiveAction[];
  blackboard: Blackboard<OffensiveBlackboardSchema>;
  setOpponent(snap: OpponentSnapshot | null): void;
  setSelf(self: Partial<SelfSnapshot>): void;
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
    bumpTick() {
      tickIndex += 1;
    },
  };
}

const DEFAULT_OPPONENT: OpponentSnapshot = {
  id: 'p2',
  distance: 30,
  damagePercent: 0,
  stateLabel: 'idle',
  isAirborne: false,
};

describe('resolveHardOffensiveTreeOptions', () => {
  it('fills in defaults for unspecified fields', () => {
    expect(resolveHardOffensiveTreeOptions()).toEqual({
      neutralJabRangePx: 50,
      koSmashRangePx: 72,
      comboFollowUpRangePx: 60,
      koPercentThreshold: KO_PERCENT_THRESHOLD,
    });
  });

  it('respects explicit overrides', () => {
    const r = resolveHardOffensiveTreeOptions({
      neutralJabRangePx: 40,
      koSmashRangePx: 90,
      comboFollowUpRangePx: 55,
      koPercentThreshold: 80,
    });
    expect(r).toEqual({
      neutralJabRangePx: 40,
      koSmashRangePx: 90,
      comboFollowUpRangePx: 55,
      koPercentThreshold: 80,
    });
  });
});

describe('buildHardOffensiveTree — neutral jab branch', () => {
  it('emits a jab when in range and idle stage', () => {
    const root = buildHardOffensiveTree();
    const h = makeHarness({ ...DEFAULT_OPPONENT, distance: 40 });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    // Jab branch fires; no movement intent emitted because we were already in range.
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'neutral' }]);
  });

  it('emits movement when out of jab range and returns Running', () => {
    const root = buildHardOffensiveTree();
    const h = makeHarness({ ...DEFAULT_OPPONENT, distance: 200 });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([{ kind: 'moveRight' }]);
  });

  it('returns Failure when no opponent is alive', () => {
    const root = buildHardOffensiveTree();
    const h = makeHarness(null);
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

describe('buildHardOffensiveTree — KO smash branch', () => {
  it('emits a smash when opponent at KO percent and in smash range', () => {
    const root = buildHardOffensiveTree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 60,
      damagePercent: 90,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'smash', comboStepId: 'koFinisher' }]);
  });

  it('falls through to neutral jab when opponent below KO percent', () => {
    const root = buildHardOffensiveTree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      damagePercent: 20,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    // Selector picked the neutral branch (3rd child).
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'neutral' }]);
  });
});

describe('buildHardOffensiveTree — combo follow-up branch', () => {
  it('jab → tilt: a second tick after a registered jab fires the planned tilt', () => {
    const root = buildHardOffensiveTree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      damagePercent: 5,
    });

    // Tick 0 — jab fires (neutral path).
    root.tick(h.ctx);
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'neutral' }]);

    // Controller-side: the jab landed at tick 0 against a 5% opponent.
    registerLandedHit(h.blackboard, {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: 5,
    });

    // Advance one tick — combo branch should now stage and execute the tilt.
    h.emits.length = 0;
    h.bumpTick();
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'tilt', comboStepId: 'jab→tilt' }]);
    // Plan consumed.
    expect(h.blackboard.get('comboPlannedFollowUp')).toBeNull();
  });

  it('jab at KO percent → smash finisher', () => {
    const root = buildHardOffensiveTree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      damagePercent: 95,
    });

    // First tick — KO smash branch fires immediately because opponent is already at KO%.
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'smash', comboStepId: 'koFinisher' }]);
  });

  it('jab→smash combo: jab at KO percent records jabConnected, follow-up plans smash', () => {
    const root = buildHardOffensiveTree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      damagePercent: 70,
    });

    // First the KO smash branch fires (since opponent is past threshold) —
    // skip that by using a custom builder where opponent damage is below
    // threshold at start, then bumped via a successful jab.
    h.setOpponent({
      ...DEFAULT_OPPONENT,
      distance: 40,
      damagePercent: 30,
    });
    root.tick(h.ctx); // jab fires
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'neutral' }]);

    // Now register the jab landed and the opponent jumped to KO percent
    // (their damage was already at 55 and the jab pushed them to 58; we
    // simulate by passing 60 — at-threshold).
    registerLandedHit(h.blackboard, {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: KO_PERCENT_THRESHOLD,
    });

    // Tick 1 — combo branch should stage jab→smash because percent ≥ KO threshold.
    h.emits.length = 0;
    h.bumpTick();
    h.setOpponent({
      ...DEFAULT_OPPONENT,
      distance: 40,
      damagePercent: KO_PERCENT_THRESHOLD,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'smash', comboStepId: 'jab→smash' }]);
  });

  it('tilt → smash at KO percent', () => {
    const root = buildHardOffensiveTree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 50,
      damagePercent: 70,
    });

    // Pre-stage the blackboard to "I just landed a tilt" at low % — but
    // the recognition function uses the *captured* percent. Let's
    // register a tilt at KO percent to set up the chain.
    registerLandedHit(h.blackboard, {
      landed: 'tilt',
      landedTick: 0,
      opponentPercent: 75,
    });

    h.bumpTick();
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'smash', comboStepId: 'tilt→smash' }]);
  });

  it('combo branch drops chain when window expires; falls through to neutral jab', () => {
    const root = buildHardOffensiveTree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      damagePercent: 20,
    });

    registerLandedHit(h.blackboard, {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: 5,
    });

    // Advance way past the JAB_TO_TILT_FRAMES window.
    for (let i = 0; i < 30; i += 1) h.bumpTick();

    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    // Recognition leaf dropped the chain; neutral jab fired instead.
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'neutral' }]);
    expect(h.blackboard.get('comboStage')).toBe('idle');
  });

  it('combo branch waits (Running) when canAttack is false', () => {
    const root = buildHardOffensiveTree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      damagePercent: 30,
    });

    registerLandedHit(h.blackboard, {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: 30,
    });

    h.setSelf({ canAttack: false });
    h.bumpTick();
    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    // No emit (waiting for can-attack to clear) but plan still latched.
    expect(h.emits).toEqual([]);
    const plan = h.blackboard.get('comboPlannedFollowUp');
    expect(plan?.nextAttack).toBe('tilt');
  });
});

describe('buildHardOffensiveTree — determinism', () => {
  it('produces identical tick sequences across two identically-built trees', () => {
    const a = buildHardOffensiveTree();
    const b = buildHardOffensiveTree();
    const ha = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 200,
      damagePercent: 0,
    });
    const hb = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 200,
      damagePercent: 0,
    });

    for (let i = 0; i < 20; i += 1) {
      ha.bumpTick();
      hb.bumpTick();
      expect(a.tick(ha.ctx)).toBe(b.tick(hb.ctx));
      expect(ha.emits).toEqual(hb.emits);
    }
  });

  it('plays nicely with BehaviorTree runner — reset clears combo state', () => {
    const root = buildHardOffensiveTree();
    const tree = new BehaviorTree<OffensiveContext, OffensiveBlackboardSchema>(
      root,
      { initialBlackboard: { ...DEFAULT_OFFENSIVE_BLACKBOARD } },
    );
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      damagePercent: 0,
    });

    // Replace the harness blackboard with the runner's so writes propagate.
    Object.defineProperty(h.ctx, 'blackboard', {
      value: tree.getBlackboard(),
      configurable: true,
    });

    tree.tick(h.ctx);
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'neutral' }]);

    // Simulate a jab landed.
    registerLandedHit(tree.getBlackboard(), {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: 30,
    });

    expect(tree.getBlackboard().get('comboStage')).toBe('jabConnected');

    // Reset clears the chain via the initialBlackboard re-seed.
    tree.reset();
    expect(tree.getBlackboard().get('comboStage')).toBe('idle');
    expect(tree.getBlackboard().get('comboLastLandedMove')).toBeNull();
    expect(tree.getBlackboard().get('comboLastLandedTick')).toBe(-1);
  });
});
