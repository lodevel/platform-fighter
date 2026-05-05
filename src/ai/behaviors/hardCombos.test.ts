import { describe, expect, it } from 'vitest';
import { Blackboard } from '../behaviorTree/Blackboard';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';
import { registerLandedHit } from '../offensive/registerLandedHit';
import { KO_PERCENT_THRESHOLD } from '../offensive/comboRecognition';
import type {
  OffensiveAction,
  OffensiveBlackboardSchema,
  OffensiveContext,
  OpponentSnapshot,
  OpponentStateLabel,
  SelfSnapshot,
} from '../offensive/types';
import { DEFAULT_OFFENSIVE_BLACKBOARD } from '../offensive/types';
import {
  DEFAULT_HIT_CONFIRM_RANGE_PX,
  DEFAULT_PUNISHABLE_STATE_LABELS,
  DEFAULT_PUNISH_CLOSE_RANGE_PX,
  DEFAULT_PUNISH_SMASH_RANGE_PX,
  DEFAULT_PUNISH_TILT_RANGE_PX,
  buildHardCombosTree,
  buildHitConfirmComboSubtree,
  buildPunishComboSubtree,
  resolveHardCombosTreeOptions,
  resolveHitConfirmComboOptions,
  resolvePunishComboOptions,
} from './hardCombos';

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

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe('hardCombos — default exports', () => {
  it('DEFAULT_PUNISHABLE_STATE_LABELS includes recovering / dodging / shielding / hitstun', () => {
    expect(DEFAULT_PUNISHABLE_STATE_LABELS.has('recovering')).toBe(true);
    expect(DEFAULT_PUNISHABLE_STATE_LABELS.has('dodging')).toBe(true);
    expect(DEFAULT_PUNISHABLE_STATE_LABELS.has('shielding')).toBe(true);
    expect(DEFAULT_PUNISHABLE_STATE_LABELS.has('hitstun')).toBe(true);
  });

  it('DEFAULT_PUNISHABLE_STATE_LABELS excludes attacking / idle / airborne / ledgeHang', () => {
    expect(DEFAULT_PUNISHABLE_STATE_LABELS.has('attacking')).toBe(false);
    expect(DEFAULT_PUNISHABLE_STATE_LABELS.has('idle')).toBe(false);
    expect(DEFAULT_PUNISHABLE_STATE_LABELS.has('airborne')).toBe(false);
    expect(DEFAULT_PUNISHABLE_STATE_LABELS.has('ledgeHang')).toBe(false);
  });

  it('reach defaults are positive and ordered as documented', () => {
    expect(DEFAULT_HIT_CONFIRM_RANGE_PX).toBeGreaterThan(0);
    expect(DEFAULT_PUNISH_CLOSE_RANGE_PX).toBeGreaterThan(0);
    expect(DEFAULT_PUNISH_TILT_RANGE_PX).toBeGreaterThan(0);
    expect(DEFAULT_PUNISH_SMASH_RANGE_PX).toBeGreaterThan(0);
    expect(DEFAULT_PUNISH_SMASH_RANGE_PX).toBeGreaterThanOrEqual(
      DEFAULT_PUNISH_TILT_RANGE_PX,
    );
  });
});

// ---------------------------------------------------------------------------
// resolve* helpers
// ---------------------------------------------------------------------------

describe('resolveHitConfirmComboOptions', () => {
  it('fills in defaults for unspecified fields', () => {
    expect(resolveHitConfirmComboOptions()).toEqual({
      closeRangePx: DEFAULT_HIT_CONFIRM_RANGE_PX,
    });
  });

  it('respects explicit overrides', () => {
    expect(resolveHitConfirmComboOptions({ closeRangePx: 42 })).toEqual({
      closeRangePx: 42,
    });
  });
});

describe('resolvePunishComboOptions', () => {
  it('fills in defaults for unspecified fields', () => {
    const r = resolvePunishComboOptions();
    expect(r.closeRangePx).toBe(DEFAULT_PUNISH_CLOSE_RANGE_PX);
    expect(r.smashRangePx).toBe(DEFAULT_PUNISH_SMASH_RANGE_PX);
    expect(r.tiltRangePx).toBe(DEFAULT_PUNISH_TILT_RANGE_PX);
    expect(r.koPercentThreshold).toBe(KO_PERCENT_THRESHOLD);
    expect(r.punishableStates).toBe(DEFAULT_PUNISHABLE_STATE_LABELS);
  });

  it('respects explicit overrides', () => {
    const customSet: ReadonlySet<OpponentStateLabel> = new Set<OpponentStateLabel>([
      'recovering',
    ]);
    const r = resolvePunishComboOptions({
      closeRangePx: 50,
      smashRangePx: 80,
      tiltRangePx: 55,
      koPercentThreshold: 90,
      punishableStates: customSet,
    });
    expect(r).toEqual({
      closeRangePx: 50,
      smashRangePx: 80,
      tiltRangePx: 55,
      koPercentThreshold: 90,
      punishableStates: customSet,
    });
  });
});

describe('resolveHardCombosTreeOptions', () => {
  it('forwards subtree options', () => {
    const r = resolveHardCombosTreeOptions({
      hitConfirm: { closeRangePx: 33 },
      punish: { koPercentThreshold: 88 },
    });
    expect(r.hitConfirm.closeRangePx).toBe(33);
    expect(r.punish.koPercentThreshold).toBe(88);
    expect(r.punish.smashRangePx).toBe(DEFAULT_PUNISH_SMASH_RANGE_PX);
  });
});

// ---------------------------------------------------------------------------
// Hit-confirm subtree
// ---------------------------------------------------------------------------

describe('buildHitConfirmComboSubtree', () => {
  it('returns Failure when no opponent is alive', () => {
    const root = buildHitConfirmComboSubtree();
    const h = makeHarness(null);
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when no chain is in flight (combo stage idle)', () => {
    const root = buildHitConfirmComboSubtree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      damagePercent: 0,
    });
    // No registerLandedHit → stage stays 'idle' → recognise returns Failure.
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('after a registered jab, fires the planned tilt follow-up', () => {
    const root = buildHitConfirmComboSubtree();
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
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'tilt', comboStepId: 'jab→tilt' }]);
    expect(h.blackboard.get('comboPlannedFollowUp')).toBeNull();
  });

  it('after a registered tilt at KO%, fires the planned smash finisher', () => {
    const root = buildHitConfirmComboSubtree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 50,
      damagePercent: 75,
    });

    registerLandedHit(h.blackboard, {
      landed: 'tilt',
      landedTick: 0,
      opponentPercent: 75,
    });

    h.bumpTick();
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'smash', comboStepId: 'tilt→smash' }]);
  });

  it('returns Running while still closing distance to follow-up reach', () => {
    const root = buildHitConfirmComboSubtree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 200,
      damagePercent: 5,
    });

    registerLandedHit(h.blackboard, {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: 5,
    });

    h.bumpTick();
    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([{ kind: 'moveRight' }]);
    // Plan not yet staged because movement leaf parked the sequence.
    expect(h.blackboard.get('comboPlannedFollowUp')).toBeNull();
  });

  it('returns Running and latches plan when canAttack is false', () => {
    const root = buildHitConfirmComboSubtree();
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
    expect(h.emits).toEqual([]);
    const plan = h.blackboard.get('comboPlannedFollowUp');
    expect(plan?.nextAttack).toBe('tilt');
  });

  it('drops chain to idle when window expires', () => {
    const root = buildHitConfirmComboSubtree();
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

    // Walk the tick way past JAB_TO_TILT_FRAMES.
    for (let i = 0; i < 30; i += 1) h.bumpTick();

    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
    expect(h.blackboard.get('comboStage')).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Punish subtree
// ---------------------------------------------------------------------------

describe('buildPunishComboSubtree', () => {
  it('returns Failure when no opponent is alive', () => {
    const root = buildPunishComboSubtree();
    const h = makeHarness(null);
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when opponent is in a non-punishable state (idle)', () => {
    const root = buildPunishComboSubtree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      stateLabel: 'idle',
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when opponent is attacking (would trade stocks)', () => {
    const root = buildPunishComboSubtree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      stateLabel: 'attacking',
      damagePercent: 90,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('fires a tilt punish opener when opponent is recovering at low %', () => {
    const root = buildPunishComboSubtree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      stateLabel: 'recovering',
      damagePercent: 20,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'tilt', comboStepId: 'punishTilt' }]);
  });

  it('fires a smash punish opener when opponent is recovering at KO %', () => {
    const root = buildPunishComboSubtree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 50,
      stateLabel: 'recovering',
      damagePercent: KO_PERCENT_THRESHOLD,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'smash', comboStepId: 'punishSmash' }]);
  });

  it('punish triggers on shielding opponent', () => {
    const root = buildPunishComboSubtree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      stateLabel: 'shielding',
      damagePercent: 30,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'tilt', comboStepId: 'punishTilt' }]);
  });

  it('punish triggers on dodging opponent', () => {
    const root = buildPunishComboSubtree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      stateLabel: 'dodging',
      damagePercent: 30,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'tilt', comboStepId: 'punishTilt' }]);
  });

  it('punish triggers on hitstun opponent', () => {
    const root = buildPunishComboSubtree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      stateLabel: 'hitstun',
      damagePercent: 30,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'tilt', comboStepId: 'punishTilt' }]);
  });

  it('Running emits movement when out of close range', () => {
    const root = buildPunishComboSubtree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 200,
      stateLabel: 'recovering',
      damagePercent: 30,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([{ kind: 'moveRight' }]);
  });

  it('respects custom punishableStates option', () => {
    const customSet: ReadonlySet<OpponentStateLabel> = new Set<OpponentStateLabel>([
      'recovering',
    ]);
    const root = buildPunishComboSubtree({ punishableStates: customSet });

    // Shielding is no longer in the set → Failure.
    const h1 = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      stateLabel: 'shielding',
      damagePercent: 30,
    });
    expect(root.tick(h1.ctx)).toBe(NodeStatus.Failure);

    // Recovering still in the set → Success.
    const h2 = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      stateLabel: 'recovering',
      damagePercent: 30,
    });
    expect(root.tick(h2.ctx)).toBe(NodeStatus.Success);
  });

  it('respects custom koPercentThreshold for smash gating', () => {
    const root = buildPunishComboSubtree({ koPercentThreshold: 50 });
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      stateLabel: 'recovering',
      damagePercent: 50, // exactly threshold under 50 → smash
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'smash', comboStepId: 'punishSmash' }]);
  });

  it('Failure when canAttack is false and bot is in range', () => {
    // Both opener branches of the inner Selector require canAttack;
    // FireAttackLeaf returns Failure when canAttack is false. The
    // Selector therefore returns Failure, which propagates up.
    const root = buildPunishComboSubtree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      stateLabel: 'recovering',
      damagePercent: 30,
    });
    h.setSelf({ canAttack: false });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Composed root
// ---------------------------------------------------------------------------

describe('buildHardCombosTree', () => {
  it('hit-confirm subtree wins over punish when a chain is in flight', () => {
    const root = buildHardCombosTree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      stateLabel: 'recovering', // would also trigger punish
      damagePercent: 5,
    });

    registerLandedHit(h.blackboard, {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: 5,
    });

    h.bumpTick();
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    // Hit-confirm took priority — emits the planned tilt follow-up,
    // not the punish-tilt opener.
    expect(h.emits).toEqual([{ kind: 'tilt', comboStepId: 'jab→tilt' }]);
  });

  it('falls through to punish when no chain is in flight', () => {
    const root = buildHardCombosTree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      stateLabel: 'recovering',
      damagePercent: 30,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'tilt', comboStepId: 'punishTilt' }]);
  });

  it('returns Failure when neither subtree wants to act', () => {
    const root = buildHardCombosTree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      stateLabel: 'idle',
      damagePercent: 0,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when no opponent is alive', () => {
    const root = buildHardCombosTree();
    const h = makeHarness(null);
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('full punish-then-finish exchange composes via the Blackboard', () => {
    // 1. Tick 0: opponent recovering at 30% → punish tilt fires.
    // 2. Controller registers the tilt as landed at percent ≥ KO threshold.
    // 3. Tick 1: opponent is back to idle but the chain is staged →
    //    hit-confirm fires the smash finisher (tilt → smash).
    const root = buildHardCombosTree();
    const h = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      stateLabel: 'recovering',
      damagePercent: 30,
    });

    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'tilt', comboStepId: 'punishTilt' }]);

    // Simulate the tilt connecting and the opponent's percent jumping
    // to KO band.
    registerLandedHit(h.blackboard, {
      landed: 'tilt',
      landedTick: 0,
      opponentPercent: KO_PERCENT_THRESHOLD,
    });

    // Tick 1 — opponent reverts to idle (no longer punishable),
    // but the staged chain takes priority.
    h.emits.length = 0;
    h.bumpTick();
    h.setOpponent({
      ...DEFAULT_OPPONENT,
      distance: 40,
      stateLabel: 'idle',
      damagePercent: KO_PERCENT_THRESHOLD,
    });

    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'smash', comboStepId: 'tilt→smash' }]);
  });

  it('determinism — two identically-built trees produce identical tick sequences', () => {
    const a = buildHardCombosTree();
    const b = buildHardCombosTree();
    const ha = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 200,
      stateLabel: 'recovering',
      damagePercent: 30,
    });
    const hb = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 200,
      stateLabel: 'recovering',
      damagePercent: 30,
    });

    for (let i = 0; i < 20; i += 1) {
      ha.bumpTick();
      hb.bumpTick();
      expect(a.tick(ha.ctx)).toBe(b.tick(hb.ctx));
      expect(ha.emits).toEqual(hb.emits);
    }
  });

  it('determinism — same options always build an isomorphic tree', () => {
    const a = buildHardCombosTree({
      hitConfirm: { closeRangePx: 55 },
      punish: { koPercentThreshold: 70 },
    });
    const b = buildHardCombosTree({
      hitConfirm: { closeRangePx: 55 },
      punish: { koPercentThreshold: 70 },
    });

    // Tree shapes must produce identical statuses + emits when ticked
    // with the same harness state.
    const ha = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      stateLabel: 'recovering',
      damagePercent: 60,
    });
    const hb = makeHarness({
      ...DEFAULT_OPPONENT,
      distance: 40,
      stateLabel: 'recovering',
      damagePercent: 60,
    });

    expect(a.tick(ha.ctx)).toBe(b.tick(hb.ctx));
    expect(ha.emits).toEqual(hb.emits);
    // Custom KO threshold (70) means 60% no longer triggers the smash
    // gate — both builds fall back to tilt.
    expect(ha.emits).toEqual([{ kind: 'tilt', comboStepId: 'punishTilt' }]);
  });
});
