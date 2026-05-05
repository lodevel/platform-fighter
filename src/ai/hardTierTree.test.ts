/**
 * Unit tests for {@link buildHardTierTree} (AC 19 Sub-AC 3).
 *
 * The tree under test composes {@link buildHardCombosTree} and
 * {@link buildHardOffensiveTreeV2} under a single Selector. The tests
 * exercise three concerns:
 *
 *   1. Option resolution — {@link resolveHardTierTreeOptions} forwards
 *      to the per-subtree resolvers and fills documented defaults.
 *   2. Branch priority — the combos sub-tree fires when a chain is in
 *      flight, otherwise the offensive sub-tree takes over.
 *   3. Determinism — two trees built with identical options produce
 *      identical emit sequences across the same context schedule.
 */

import { describe, expect, it } from 'vitest';

import { Blackboard } from './behaviorTree/Blackboard';
import { BehaviorTree } from './behaviorTree/BehaviorTree';
import { NodeStatus } from './behaviorTree/Node';
import { Rng } from '../utils/Rng';
import { registerLandedHit } from './offensive/registerLandedHit';
import {
  buildHardTierTree,
  resolveHardTierTreeOptions,
} from './hardTierTree';
import {
  DEFAULT_HIT_CONFIRM_RANGE_PX,
  DEFAULT_PUNISHABLE_STATE_LABELS,
} from './behaviors/hardCombos';
import { KO_PERCENT_THRESHOLD } from './offensive/comboRecognition';
import { DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES } from './offensive/predictiveMovement';
import type { PerceivedStage } from './perception/WorldSnapshot';
import type {
  OffensiveAction,
  OffensiveBlackboardSchema,
  OffensiveContext,
  OpponentSnapshot,
  SelfSnapshot,
} from './offensive/types';
import { DEFAULT_OFFENSIVE_BLACKBOARD } from './offensive/types';

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

const DEFAULT_OPPONENT: OpponentSnapshot = {
  id: 'p2',
  distance: 30,
  damagePercent: 0,
  stateLabel: 'idle',
  isAirborne: false,
  position: { x: 280, y: 100 },
  velocity: { vx: 0, vy: 0 },
};

// ---------------------------------------------------------------------------
// resolveHardTierTreeOptions
// ---------------------------------------------------------------------------

describe('resolveHardTierTreeOptions', () => {
  it('fills in documented defaults for both sub-trees', () => {
    const r = resolveHardTierTreeOptions();

    expect(r.combos.hitConfirm.closeRangePx).toBe(DEFAULT_HIT_CONFIRM_RANGE_PX);
    expect(r.combos.punish.punishableStates).toBe(
      DEFAULT_PUNISHABLE_STATE_LABELS,
    );

    expect(r.offensive.neutralJabRangePx).toBe(50);
    expect(r.offensive.koSmashRangePx).toBe(72);
    expect(r.offensive.comboFollowUpRangePx).toBe(60);
    expect(r.offensive.koPercentThreshold).toBe(KO_PERCENT_THRESHOLD);
    expect(r.offensive.predictiveLookaheadFrames).toBe(
      DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES,
    );
    expect(r.offensive.edgeGuard).toEqual({});
  });

  it('forwards combos overrides verbatim', () => {
    const r = resolveHardTierTreeOptions({
      combos: {
        hitConfirm: { closeRangePx: 33 },
        punish: { koPercentThreshold: 88 },
      },
    });
    expect(r.combos.hitConfirm.closeRangePx).toBe(33);
    expect(r.combos.punish.koPercentThreshold).toBe(88);
  });

  it('forwards offensive overrides verbatim', () => {
    const r = resolveHardTierTreeOptions({
      offensive: {
        neutralJabRangePx: 60,
        koSmashRangePx: 80,
        predictiveLookaheadFrames: 12,
        edgeGuard: { anchorTolerancePx: 24 },
      },
    });
    expect(r.offensive.neutralJabRangePx).toBe(60);
    expect(r.offensive.koSmashRangePx).toBe(80);
    expect(r.offensive.predictiveLookaheadFrames).toBe(12);
    expect(r.offensive.edgeGuard).toEqual({ anchorTolerancePx: 24 });
  });

  it('produces structurally-equal output on repeated calls (purity)', () => {
    const a = resolveHardTierTreeOptions({ combos: { hitConfirm: { closeRangePx: 42 } } });
    const b = resolveHardTierTreeOptions({ combos: { hitConfirm: { closeRangePx: 42 } } });
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// buildHardTierTree — root structure
// ---------------------------------------------------------------------------

describe('buildHardTierTree — structure', () => {
  it('returns a node named "hardTier"', () => {
    const root = buildHardTierTree();
    expect(root.name).toBe('hardTier');
  });

  it('factory accepts no arguments and returns a tickable node', () => {
    const root = buildHardTierTree();
    const tree = new BehaviorTree(root);
    const h = makeHarness();
    // No opponent — both sub-trees return Failure → root returns Failure.
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildHardTierTree — branch priority
// ---------------------------------------------------------------------------

describe('buildHardTierTree — branch priority', () => {
  it('takes the combos hit-confirm branch when a chain is in flight', () => {
    const root = buildHardTierTree();
    const tree = new BehaviorTree(root);
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      damagePercent: 5,
    });

    registerLandedHit(h.blackboard, {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: 5,
    });

    h.bumpTick();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Success);
    // jab → tilt is the canonical low-percent follow-up.
    const kinds = h.emits.map((e) => e.kind);
    expect(kinds).toContain('tilt');
    // Combo step IDs surface the chain identifier.
    const tiltEmit = h.emits.find((e) => e.kind === 'tilt');
    expect(tiltEmit?.comboStepId).toBe('jab→tilt');
  });

  it('takes the combos punish branch when opponent is in a punishable state', () => {
    const root = buildHardTierTree();
    const tree = new BehaviorTree(root);
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      damagePercent: 30,
      stateLabel: 'recovering',
    });

    expect(tree.tick(h.ctx)).toBe(NodeStatus.Success);
    // Below KO percent → tilt opener is selected over smash.
    const tiltEmit = h.emits.find((e) => e.kind === 'tilt');
    expect(tiltEmit?.comboStepId).toBe('punishTilt');
  });

  it('falls through to offensive V2 when no chain in flight and no punish state', () => {
    const root = buildHardTierTree();
    const tree = new BehaviorTree(root);
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 30,
      damagePercent: 0,
      stateLabel: 'idle',
    });

    // Bot already in jab range, opponent idle → offensive jab branch fires.
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Success);
    const jabEmit = h.emits.find((e) => e.kind === 'jab');
    expect(jabEmit).toBeDefined();
    expect(jabEmit?.comboStepId).toBe('neutral');
  });

  it('takes the offensive edge-guard branch when opponent is off-stage', () => {
    const root = buildHardTierTree();
    const tree = new BehaviorTree(root);
    const h = makeHarness();
    h.setOpponent({
      id: 'p2',
      distance: -200,
      damagePercent: 30,
      stateLabel: 'airborne',
      isAirborne: true,
      position: { x: 50, y: 220 },
      velocity: { vx: 1, vy: 0 },
    });
    h.setSelfPosition({ x: 130, y: 200 });

    expect(tree.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits[0]?.kind).toBe('smash');
    expect(h.emits[0]?.comboStepId).toBe('edgeGuard.smash');
  });

  it('returns Failure when no opponent and no chain in flight', () => {
    const root = buildHardTierTree();
    const tree = new BehaviorTree(root);
    const h = makeHarness(null);
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildHardTierTree — combos preempt offensive
// ---------------------------------------------------------------------------

describe('buildHardTierTree — combos preempt offensive', () => {
  it('a recognised chain wins over an off-stage edge-guard opportunity', () => {
    // Set up an off-stage opponent (would normally trigger edge-guard)
    // but with a recognised chain in flight. Combos sub-tree must win.
    const root = buildHardTierTree();
    const tree = new BehaviorTree(root);
    const h = makeHarness();

    // Opponent in air but close enough for the chain follow-up to land.
    h.setOpponent({
      id: 'p2',
      distance: 30,
      damagePercent: 5,
      stateLabel: 'hitstun',
      isAirborne: false,
      position: { x: 280, y: 100 },
      velocity: { vx: 0, vy: 0 },
    });

    registerLandedHit(h.blackboard, {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: 5,
    });

    h.bumpTick();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Success);
    // The combos sub-tree fires the planned tilt — NOT a smash from the
    // V2 offensive sub-tree's edge-guard or KO branches.
    const kinds = h.emits.map((e) => e.kind);
    expect(kinds).toContain('tilt');
    const tiltEmit = h.emits.find((e) => e.kind === 'tilt');
    expect(tiltEmit?.comboStepId).toBe('jab→tilt');
  });
});

// ---------------------------------------------------------------------------
// buildHardTierTree — option propagation
// ---------------------------------------------------------------------------

describe('buildHardTierTree — option propagation', () => {
  it('propagates a stricter punishable-states set into the combos sub-tree', () => {
    // Custom set that EXCLUDES 'recovering' — so an opponent in
    // recovery state should NOT trigger the punish branch.
    const customSet = new Set<'shielding'>(['shielding']);
    const root = buildHardTierTree({
      combos: {
        punish: { punishableStates: customSet as ReadonlySet<'shielding'> },
      },
    });
    const tree = new BehaviorTree(root);
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 30,
      damagePercent: 30,
      stateLabel: 'recovering',
    });

    // Combos sub-tree's punish gate fails (recovering not in set), no
    // chain in flight → falls through to offensive V2 jab.
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Success);
    const jabEmit = h.emits.find((e) => e.kind === 'jab');
    expect(jabEmit).toBeDefined();
    expect(jabEmit?.comboStepId).toBe('neutral');
    // No punish-tagged emit.
    expect(h.emits.find((e) => e.comboStepId === 'punishTilt')).toBeUndefined();
  });

  it('propagates neutralJabRangePx into the offensive V2 sub-tree', () => {
    // With a custom (huge) jab range, an opponent at distance 100 px
    // becomes "in range" and the neutral jab branch fires immediately.
    const root = buildHardTierTree({
      offensive: { neutralJabRangePx: 200 },
    });
    const tree = new BehaviorTree(root);
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 100,
      damagePercent: 0,
      stateLabel: 'idle',
    });
    h.setSelfPosition({ x: 250, y: 100 });

    expect(tree.tick(h.ctx)).toBe(NodeStatus.Success);
    const jabEmit = h.emits.find((e) => e.kind === 'jab');
    expect(jabEmit).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// buildHardTierTree — determinism
// ---------------------------------------------------------------------------

describe('buildHardTierTree — determinism', () => {
  it('two trees built with identical options produce identical emit sequences', () => {
    const rootA = buildHardTierTree();
    const rootB = buildHardTierTree();
    const treeA = new BehaviorTree(rootA);
    const treeB = new BehaviorTree(rootB);
    const hA = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 30,
      damagePercent: 0,
    });
    const hB = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 30,
      damagePercent: 0,
    });

    // Schedule: 5 ticks with the same context.
    for (let i = 0; i < 5; i += 1) {
      treeA.tick(hA.ctx);
      treeB.tick(hB.ctx);
      hA.bumpTick();
      hB.bumpTick();
    }

    expect(hA.emits).toEqual(hB.emits);
  });

  it('reset returns the tree to a pristine state for the next run', () => {
    const root = buildHardTierTree();
    const tree = new BehaviorTree(root);

    // Run 1: with combo state in flight.
    const h1 = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      damagePercent: 5,
    });
    registerLandedHit(h1.blackboard, {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: 5,
    });
    h1.bumpTick();
    tree.tick(h1.ctx);
    const run1Emits = [...h1.emits];

    // Reset everything back to neutral.
    tree.reset();

    // Run 2: same setup → same outcome.
    const h2 = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      damagePercent: 5,
    });
    registerLandedHit(h2.blackboard, {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: 5,
    });
    h2.bumpTick();
    tree.tick(h2.ctx);

    expect(h2.emits).toEqual(run1Emits);
  });
});
