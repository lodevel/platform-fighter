import { describe, expect, it } from 'vitest';

import { Blackboard } from '../behaviorTree/Blackboard';
import { BehaviorTree } from '../behaviorTree/BehaviorTree';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';

import { REACTION_WINDOW_PRESETS } from '../perception/reactionWindowPresets';

import {
  MEDIUM_REACTION_WINDOW_RANGE,
  buildMediumOffensiveTree,
  resolveMediumOffensiveTreeOptions,
} from './MediumOffensiveTree';
import {
  DEFAULT_DODGE_RANGE_PX,
  DEFAULT_DODGE_THREAT_STATE_LABELS,
  DEFAULT_MEDIUM_DODGE_CHANCE,
} from './DodgeThreatLeaf';
import {
  DEFAULT_RANGED_MAX_RANGE_PX,
  DEFAULT_RANGED_MIN_RANGE_PX,
  DEFAULT_RANGED_SKIP_STATE_LABELS,
} from './RangedAttackLeaf';
import {
  DEFAULT_MEDIUM_SHIELD_CHANCE,
  DEFAULT_SHIELD_RANGE_PX,
  DEFAULT_THREAT_STATE_LABELS,
} from './ShieldThreatLeaf';
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

const DEFAULT_OPPONENT: OpponentSnapshot = {
  id: 'p2',
  distance: 30,
  damagePercent: 0,
  stateLabel: 'idle',
  isAirborne: false,
};

function makeHarness(opts: {
  initialOpponent?: OpponentSnapshot | null;
  rngSeed?: number;
} = {}): Harness {
  const emits: OffensiveAction[] = [];
  const blackboard = new Blackboard<OffensiveBlackboardSchema>({
    ...DEFAULT_OFFENSIVE_BLACKBOARD,
  });
  let opponent: OpponentSnapshot | null =
    'initialOpponent' in opts
      ? opts.initialOpponent ?? null
      : { ...DEFAULT_OPPONENT };
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
    rng: new Rng(opts.rngSeed ?? 1),
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

describe('resolveMediumOffensiveTreeOptions', () => {
  it('fills in defaults for unspecified fields', () => {
    expect(resolveMediumOffensiveTreeOptions()).toEqual({
      neutralJabRangePx: 50,
      comboFollowUpRangePx: 60,
      shieldRangePx: DEFAULT_SHIELD_RANGE_PX,
      shieldChance: DEFAULT_MEDIUM_SHIELD_CHANCE,
      threatStateLabels: DEFAULT_THREAT_STATE_LABELS,
      dodgeRangePx: DEFAULT_DODGE_RANGE_PX,
      dodgeChance: DEFAULT_MEDIUM_DODGE_CHANCE,
      dodgeThreatStateLabels: DEFAULT_DODGE_THREAT_STATE_LABELS,
      rangedEnabled: true,
      rangedMinRangePx: DEFAULT_RANGED_MIN_RANGE_PX,
      rangedMaxRangePx: DEFAULT_RANGED_MAX_RANGE_PX,
      rangedSkipStateLabels: DEFAULT_RANGED_SKIP_STATE_LABELS,
    });
  });

  it('respects explicit overrides', () => {
    const r = resolveMediumOffensiveTreeOptions({
      neutralJabRangePx: 40,
      comboFollowUpRangePx: 55,
      shieldRangePx: 120,
      shieldChance: 0.5,
      threatStateLabels: ['attacking', 'dodging'],
      dodgeRangePx: 100,
      dodgeChance: 0.4,
      dodgeThreatStateLabels: ['attacking', 'shielding'],
      rangedEnabled: false,
      rangedMinRangePx: 80,
      rangedMaxRangePx: 240,
      rangedSkipStateLabels: ['shielding'],
    });
    expect(r).toEqual({
      neutralJabRangePx: 40,
      comboFollowUpRangePx: 55,
      shieldRangePx: 120,
      shieldChance: 0.5,
      threatStateLabels: ['attacking', 'dodging'],
      dodgeRangePx: 100,
      dodgeChance: 0.4,
      dodgeThreatStateLabels: ['attacking', 'shielding'],
      rangedEnabled: false,
      rangedMinRangePx: 80,
      rangedMaxRangePx: 240,
      rangedSkipStateLabels: ['shielding'],
    });
  });
});

describe('MEDIUM_REACTION_WINDOW_RANGE', () => {
  it('matches the central preset table for the medium tier', () => {
    expect(MEDIUM_REACTION_WINDOW_RANGE).toEqual(
      REACTION_WINDOW_PRESETS.medium,
    );
    // Surface the AC-mandated balanced band: 22-28 frames.
    expect(MEDIUM_REACTION_WINDOW_RANGE.minDelayFrames).toBe(22);
    expect(MEDIUM_REACTION_WINDOW_RANGE.maxDelayFrames).toBe(28);
  });

  it('sits between easy and hard tiers (balanced)', () => {
    const easy = REACTION_WINDOW_PRESETS.easy;
    const medium = MEDIUM_REACTION_WINDOW_RANGE;
    const hard = REACTION_WINDOW_PRESETS.hard;
    expect(medium.minDelayFrames).toBeLessThan(easy.minDelayFrames);
    expect(medium.minDelayFrames).toBeGreaterThan(hard.minDelayFrames);
    expect(medium.maxDelayFrames).toBeLessThan(easy.maxDelayFrames);
    expect(medium.maxDelayFrames).toBeGreaterThan(hard.maxDelayFrames);
  });
});

describe('buildMediumOffensiveTree — neutral jab branch', () => {
  it('emits a jab when opponent is idle and in range', () => {
    const root = buildMediumOffensiveTree();
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 40,
        stateLabel: 'idle',
      },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'medium.jab' }]);
  });

  it('emits movement when out of jab range and returns Running', () => {
    const root = buildMediumOffensiveTree();
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 200,
        stateLabel: 'idle',
      },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([{ kind: 'moveRight' }]);
  });

  it('returns Failure when no opponent is alive', () => {
    const root = buildMediumOffensiveTree();
    const h = makeHarness({ initialOpponent: null });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

describe('buildMediumOffensiveTree — defensive shield branch', () => {
  it('emits shield when opponent is attacking within shield range (chance=1)', () => {
    const root = buildMediumOffensiveTree({ shieldChance: 1 });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 50,
        stateLabel: 'attacking',
      },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'shield', comboStepId: 'medium.shield' }]);
  });

  it('falls through to neutral jab when opponent attacks but block roll fails', () => {
    // shieldChance = 0 → block branch always Fails, Selector falls through.
    const root = buildMediumOffensiveTree({ shieldChance: 0 });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 40,
        stateLabel: 'attacking',
      },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    // Block didn't fire → neutral jab path.
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'medium.jab' }]);
  });

  it('does NOT block opponents far outside shield range', () => {
    const root = buildMediumOffensiveTree({ shieldChance: 1 });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 300, // far
        stateLabel: 'attacking',
      },
    });
    // Block branch fails (out of range), neutral jab branch fails the
    // attack press but emits movement → Running.
    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([{ kind: 'moveRight' }]);
  });

  it('does NOT block when opponent is in non-threatening state', () => {
    const root = buildMediumOffensiveTree({ shieldChance: 1 });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 40,
        stateLabel: 'recovering', // mid-whiff — punishable, not blockable
      },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    // Block branch fails (state not in threat list); neutral jab fires.
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'medium.jab' }]);
  });

  it('shield branch sits FIRST — pre-empts combo and neutral branches', () => {
    // Even if a combo is staged, an attacking-in-range opponent
    // triggers shield, terminating the Selector before the combo
    // branch runs.
    const root = buildMediumOffensiveTree({ shieldChance: 1 });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 40,
        stateLabel: 'attacking',
        damagePercent: 30,
      },
    });
    // Pre-stage that a jab landed (Blackboard will be `jabConnected`
    // — the combo branch *would* fire its tilt follow-up if the
    // shield branch did not pre-empt).
    registerLandedHit(h.blackboard, {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: 30,
    });
    h.bumpTick();

    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    // ONLY a shield emit — no tilt, no jab. The combo branch never
    // ran because the Selector short-circuited at the shield leaf.
    expect(h.emits).toEqual([{ kind: 'shield', comboStepId: 'medium.shield' }]);
    // Blackboard combo state is preserved because the recognition
    // leaf (which would advance / clear it) never ran.
    expect(h.blackboard.get('comboStage')).toBe('jabConnected');
    expect(h.blackboard.get('comboLastLandedMove')).toBe('jab');
  });
});

describe('buildMediumOffensiveTree — combo awareness branch', () => {
  it('jab → tilt: registered jab triggers tilt follow-up the next tick', () => {
    const root = buildMediumOffensiveTree({ shieldChance: 0 });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 40,
        damagePercent: 5,
        stateLabel: 'idle',
      },
    });

    // Tick 0 — jab fires (neutral path).
    root.tick(h.ctx);
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'medium.jab' }]);

    // Controller-side: jab landed.
    registerLandedHit(h.blackboard, {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: 5,
    });

    // Tick 1 — combo branch should now fire the tilt.
    h.emits.length = 0;
    h.bumpTick();
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'tilt', comboStepId: 'jab→tilt' }]);
    expect(h.blackboard.get('comboPlannedFollowUp')).toBeNull();
  });

  it('jab at KO percent → smash finisher via the combo branch', () => {
    const root = buildMediumOffensiveTree({ shieldChance: 0 });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 40,
        damagePercent: KO_PERCENT_THRESHOLD,
        stateLabel: 'idle',
      },
    });

    // Pre-stage a jab landed at KO percent.
    registerLandedHit(h.blackboard, {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: KO_PERCENT_THRESHOLD,
    });

    h.bumpTick();
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    // Combo follow-up plans jab→smash because percent ≥ KO threshold.
    expect(h.emits).toEqual([{ kind: 'smash', comboStepId: 'jab→smash' }]);
  });

  it('tilt → smash at KO percent', () => {
    const root = buildMediumOffensiveTree({ shieldChance: 0 });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 50,
        damagePercent: 75,
        stateLabel: 'idle',
      },
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

  it('drops chain when window expires; falls through to neutral jab', () => {
    const root = buildMediumOffensiveTree({ shieldChance: 0 });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 40,
        damagePercent: 20,
        stateLabel: 'idle',
      },
    });

    registerLandedHit(h.blackboard, {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: 5,
    });

    // Advance way past the JAB_TO_TILT_FRAMES window.
    for (let i = 0; i < 30; i += 1) h.bumpTick();

    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    // Combo recognition leaf dropped the chain; neutral jab fired instead.
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'medium.jab' }]);
    expect(h.blackboard.get('comboStage')).toBe('idle');
  });

  it('combo branch waits (Running) when canAttack is false', () => {
    const root = buildMediumOffensiveTree({ shieldChance: 0 });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 40,
        damagePercent: 30,
        stateLabel: 'idle',
      },
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
});

describe('buildMediumOffensiveTree — KO smash fishing is OFF', () => {
  it('does NOT fire a standalone smash at KO percent without a combo — falls back to jab', () => {
    // The Hard tier's KO-smash branch fires a smash on a high-percent
    // opponent EVEN WITHOUT a recognised combo. Medium tier omits
    // that branch — at KO percent, with no chain in flight, the bot
    // should still fire its safe neutral jab, not a smash.
    const root = buildMediumOffensiveTree({ shieldChance: 0 });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 50,
        damagePercent: 95, // well past KO threshold
        stateLabel: 'idle',
      },
    });

    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    // No smash; only a jab. This is the key behavioural gap that
    // makes Medium "balanced not aggressive".
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'medium.jab' }]);
  });

  it('over many ticks at KO percent, never emits a non-combo smash', () => {
    const root = buildMediumOffensiveTree({ shieldChance: 0 });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 40,
        damagePercent: 100,
        stateLabel: 'idle',
      },
      rngSeed: 0xfeedface,
    });

    let smashEmits = 0;
    let jabEmits = 0;
    const N = 200;
    for (let i = 0; i < N; i += 1) {
      h.emits.length = 0;
      h.bumpTick();
      root.tick(h.ctx);
      for (const e of h.emits) {
        if (e.kind === 'smash') smashEmits += 1;
        if (e.kind === 'jab') jabEmits += 1;
      }
    }
    // No standalone smashes (no combo was staged).
    expect(smashEmits).toBe(0);
    // But the bot did press jab a lot.
    expect(jabEmits).toBeGreaterThan(0);
  });
});

describe('buildMediumOffensiveTree — defensive sample over many ticks', () => {
  it('blocks roughly shieldChance fraction of attacking-in-range threats (no dodge)', () => {
    // With dodge disabled, shield captures ~70 % of threats and the
    // remaining 30 % fall through to neutral jab.
    const root = buildMediumOffensiveTree({ dodgeChance: 0 });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 50,
        stateLabel: 'attacking',
      },
      rngSeed: 0xc0ffee,
    });

    let shieldEmits = 0;
    let jabEmits = 0;
    const N = 5000;
    for (let i = 0; i < N; i += 1) {
      h.emits.length = 0;
      h.bumpTick();
      root.tick(h.ctx);
      for (const e of h.emits) {
        if (e.kind === 'shield') shieldEmits += 1;
        if (e.kind === 'jab') jabEmits += 1;
      }
    }

    // Both shielding and jabbing fire many times — the bot is not
    // perfect (it doesn't shield 100 % of threats), nor is it
    // negligent (it shields more than half).
    expect(shieldEmits).toBeGreaterThan(N * 0.6);
    expect(shieldEmits).toBeLessThan(N * 0.8);
    // Whenever the block roll fails, the neutral jab fires (when in
    // range), so jabEmits ≈ N - shieldEmits.
    expect(jabEmits).toBeGreaterThan(N * 0.2);
    // Total accounted for is essentially every tick.
    expect(shieldEmits + jabEmits).toBeGreaterThan(N * 0.95);
  });

  it('mixes dodge and shield with shield dominating, dodge a smaller mix-in', () => {
    // Default: dodgeChance = 0.20, shieldChance = 0.70 sequentially.
    // Expected dodge ≈ 1000/5000 (20 %); expected shield ≈ 0.7 *
    // (1 - 0.2) * 5000 = 2800 (56 %); jab fallback ≈ 0.3 * 0.8 * 5000
    // = 1200 (24 %).
    const root = buildMediumOffensiveTree();
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 50,
        stateLabel: 'attacking',
      },
      rngSeed: 0xc0ffee,
    });

    let dodgeEmits = 0;
    let shieldEmits = 0;
    let jabEmits = 0;
    const N = 5000;
    for (let i = 0; i < N; i += 1) {
      h.emits.length = 0;
      h.bumpTick();
      root.tick(h.ctx);
      for (const e of h.emits) {
        if (e.kind === 'dodge') dodgeEmits += 1;
        if (e.kind === 'shield') shieldEmits += 1;
        if (e.kind === 'jab') jabEmits += 1;
      }
    }

    // Dodge fires on roughly 20 % of threats.
    expect(dodgeEmits).toBeGreaterThan(N * 0.15);
    expect(dodgeEmits).toBeLessThan(N * 0.25);
    // Shield captures most of what dodge skips: ~56 % of total ticks.
    expect(shieldEmits).toBeGreaterThan(N * 0.45);
    expect(shieldEmits).toBeLessThan(N * 0.65);
    // Shield always dominates dodge — dodge is the smaller mix-in.
    expect(shieldEmits).toBeGreaterThan(dodgeEmits);
    // Combined defensive coverage is around 76 %; the rest jabs.
    expect(dodgeEmits + shieldEmits).toBeGreaterThan(N * 0.7);
    expect(dodgeEmits + shieldEmits).toBeLessThan(N * 0.85);
    // Total accounted for is essentially every tick.
    expect(dodgeEmits + shieldEmits + jabEmits).toBeGreaterThan(N * 0.95);
  });
});

describe('buildMediumOffensiveTree — determinism', () => {
  it('produces identical tick sequences across two same-seeded harnesses', () => {
    const a = buildMediumOffensiveTree();
    const b = buildMediumOffensiveTree();
    const ha = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 50,
        stateLabel: 'attacking',
      },
      rngSeed: 0xfeedface,
    });
    const hb = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 50,
        stateLabel: 'attacking',
      },
      rngSeed: 0xfeedface,
    });

    for (let i = 0; i < 50; i += 1) {
      ha.bumpTick();
      hb.bumpTick();
      expect(a.tick(ha.ctx)).toBe(b.tick(hb.ctx));
      expect(ha.emits).toEqual(hb.emits);
    }
  });

  it('plays nicely with BehaviorTree runner — reset clears combo state', () => {
    const root = buildMediumOffensiveTree({ shieldChance: 0 });
    const tree = new BehaviorTree<OffensiveContext, OffensiveBlackboardSchema>(
      root,
      { initialBlackboard: { ...DEFAULT_OFFENSIVE_BLACKBOARD } },
    );
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 40,
        stateLabel: 'idle',
      },
    });

    Object.defineProperty(h.ctx, 'blackboard', {
      value: tree.getBlackboard(),
      configurable: true,
    });

    tree.tick(h.ctx);
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'medium.jab' }]);

    registerLandedHit(tree.getBlackboard(), {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: 30,
    });
    expect(tree.getBlackboard().get('comboStage')).toBe('jabConnected');

    tree.reset();
    expect(tree.getBlackboard().get('comboStage')).toBe('idle');
    expect(tree.getBlackboard().get('comboLastLandedMove')).toBeNull();
    expect(tree.getBlackboard().get('comboLastLandedTick')).toBe(-1);
  });
});

describe('buildMediumOffensiveTree — tier comparison invariants', () => {
  it('Medium emits MORE shield emits than Easy and Hard against attacking opponent', async () => {
    const { buildEasyOffensiveTree } = await import('./EasyOffensiveTree');
    const { buildHardOffensiveTree } = await import('./HardOffensiveTree');

    const easyRoot = buildEasyOffensiveTree();
    const mediumRoot = buildMediumOffensiveTree();
    const hardRoot = buildHardOffensiveTree();

    function countShieldEmits(
      root: ReturnType<typeof buildMediumOffensiveTree>,
      seed: number,
    ): number {
      const h = makeHarness({
        initialOpponent: {
          ...DEFAULT_OPPONENT,
          distance: 50,
          stateLabel: 'attacking',
        },
        rngSeed: seed,
      });
      let shieldEmits = 0;
      for (let i = 0; i < 1000; i += 1) {
        h.emits.length = 0;
        h.bumpTick();
        root.tick(h.ctx);
        for (const e of h.emits) {
          if (e.kind === 'shield') shieldEmits += 1;
        }
      }
      return shieldEmits;
    }

    const seed = 0xbeef;
    const easyShields = countShieldEmits(easyRoot, seed);
    const mediumShields = countShieldEmits(mediumRoot, seed);
    const hardShields = countShieldEmits(hardRoot, seed);

    // Only Medium has the defensive shield branch.
    expect(easyShields).toBe(0);
    expect(hardShields).toBe(0);
    expect(mediumShields).toBeGreaterThan(0);
  });

  it('Medium emits FEWER smash emits than Hard at KO percent (no fishing)', async () => {
    const { buildHardOffensiveTree } = await import('./HardOffensiveTree');

    const mediumRoot = buildMediumOffensiveTree({ shieldChance: 0 });
    const hardRoot = buildHardOffensiveTree();

    function countSmashEmits(
      root: ReturnType<typeof buildMediumOffensiveTree>,
      seed: number,
    ): number {
      const h = makeHarness({
        initialOpponent: {
          ...DEFAULT_OPPONENT,
          distance: 50,
          damagePercent: 95,
          stateLabel: 'idle',
        },
        rngSeed: seed,
      });
      let smashEmits = 0;
      for (let i = 0; i < 200; i += 1) {
        h.emits.length = 0;
        h.bumpTick();
        root.tick(h.ctx);
        for (const e of h.emits) {
          if (e.kind === 'smash') smashEmits += 1;
        }
      }
      return smashEmits;
    }

    const seed = 0xbabe;
    const mediumSmashes = countSmashEmits(mediumRoot, seed);
    const hardSmashes = countSmashEmits(hardRoot, seed);

    // Hard fishes for KO smashes; Medium does not.
    expect(hardSmashes).toBeGreaterThan(0);
    expect(mediumSmashes).toBeLessThan(hardSmashes);
  });
});

describe('buildMediumOffensiveTree — defensive dodge branch', () => {
  it('emits dodge when opponent is attacking within dodge range (chance=1, shield off)', () => {
    // shieldChance=0 isolates the dodge branch from shield interception.
    const root = buildMediumOffensiveTree({
      dodgeChance: 1,
      shieldChance: 0,
    });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 50,
        stateLabel: 'attacking',
      },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'dodge', comboStepId: 'medium.dodge' }]);
  });

  it('dodge sits BEFORE shield in priority — pre-empts shield', () => {
    // Both dodge and shield gate-open against an attacker in close
    // range; with both forced to chance=1 dodge wins because it's
    // earlier in the Selector.
    const root = buildMediumOffensiveTree({
      dodgeChance: 1,
      shieldChance: 1,
    });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 50,
        stateLabel: 'attacking',
      },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'dodge', comboStepId: 'medium.dodge' }]);
  });

  it('shield catches threats when dodge roll fails', () => {
    // dodgeChance=0 ensures dodge never fires; shield handles the
    // threat. The combined defensive coverage at default tunings is
    // ~76 % but here we force shield to 1 so it always catches.
    const root = buildMediumOffensiveTree({
      dodgeChance: 0,
      shieldChance: 1,
    });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 50,
        stateLabel: 'attacking',
      },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'shield', comboStepId: 'medium.shield' }]);
  });

  it('does NOT dodge opponents far outside dodge range', () => {
    // Dodge defaults to 70 px reach. Distance 100 is too far.
    const root = buildMediumOffensiveTree({
      dodgeChance: 1,
      shieldChance: 0,
      rangedEnabled: false,
    });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 100,
        stateLabel: 'attacking',
      },
    });
    // Dodge fails (out of range), shield off, ranged disabled, falls to
    // neutral jab → moveRight.
    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([{ kind: 'moveRight' }]);
  });

  it('does NOT dodge non-threatening opponent states', () => {
    const root = buildMediumOffensiveTree({
      dodgeChance: 1,
      shieldChance: 0,
    });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 40,
        stateLabel: 'recovering', // mid-whiff — punish, don't dodge
      },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'medium.jab' }]);
  });
});

describe('buildMediumOffensiveTree — ranged attack branch', () => {
  it('emits special when opponent is in mid-range (idle)', () => {
    const root = buildMediumOffensiveTree({
      dodgeChance: 0,
      shieldChance: 0,
    });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 120,
        stateLabel: 'idle',
      },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([
      { kind: 'special', comboStepId: 'medium.ranged' },
    ]);
  });

  it('does NOT fire ranged at point-blank — falls to jab branch', () => {
    const root = buildMediumOffensiveTree({
      dodgeChance: 0,
      shieldChance: 0,
    });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 30, // melee range
        stateLabel: 'idle',
      },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    // Close-range → jab, NOT special.
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'medium.jab' }]);
  });

  it('does NOT fire ranged when opponent is shielding (skip state)', () => {
    const root = buildMediumOffensiveTree({
      dodgeChance: 0,
      shieldChance: 0,
    });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 120,
        stateLabel: 'shielding',
      },
    });
    // Ranged skipped (shielding); falls to neutral jab → moveRight.
    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([{ kind: 'moveRight' }]);
  });

  it('does NOT fire ranged at extreme distance — walks closer instead', () => {
    const root = buildMediumOffensiveTree({
      dodgeChance: 0,
      shieldChance: 0,
    });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 250, // beyond ranged max of 180
        stateLabel: 'idle',
      },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([{ kind: 'moveRight' }]);
  });

  it('combo branch trumps ranged when a chain is staged', () => {
    const root = buildMediumOffensiveTree({
      dodgeChance: 0,
      shieldChance: 0,
    });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 100, // mid-range — ranged would normally fire here
        damagePercent: 30,
        stateLabel: 'idle',
      },
    });

    // Pre-stage a jab landed → combo branch will plan a tilt follow-up.
    registerLandedHit(h.blackboard, {
      landed: 'jab',
      landedTick: 0,
      opponentPercent: 30,
    });
    h.bumpTick();

    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    // Combo branch closes the gap (moveRight) — ranged was pre-empted.
    // The execution sequence: MoveTowardOpponentLeaf says "you're 100
    // px away, target is 60 px → moveRight"; the recognition + execute
    // leaves don't run because the move-leaf returns Running.
    expect(h.emits).toEqual([{ kind: 'moveRight' }]);
  });

  it('rangedEnabled: false disables the branch entirely', () => {
    const root = buildMediumOffensiveTree({
      dodgeChance: 0,
      shieldChance: 0,
      rangedEnabled: false,
    });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 120,
        stateLabel: 'idle',
      },
    });
    // Without ranged, mid-range opponents fall to neutral jab → moveRight.
    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([{ kind: 'moveRight' }]);
  });

  it('contextual move selection — close-range vs ranged at distance bands', () => {
    const root = buildMediumOffensiveTree({
      dodgeChance: 0,
      shieldChance: 0,
    });
    const cases: ReadonlyArray<{
      distance: number;
      expectedKind: string;
      label: string;
    }> = [
      { distance: 30, expectedKind: 'jab', label: 'point-blank' },
      { distance: 50, expectedKind: 'jab', label: 'melee edge' },
      { distance: 80, expectedKind: 'special', label: 'mid-range close' },
      { distance: 150, expectedKind: 'special', label: 'mid-range far' },
      { distance: 180, expectedKind: 'special', label: 'mid-range edge' },
      { distance: 220, expectedKind: 'moveRight', label: 'too far — walk' },
    ];
    for (const { distance, expectedKind, label } of cases) {
      const h = makeHarness({
        initialOpponent: {
          ...DEFAULT_OPPONENT,
          distance,
          stateLabel: 'idle',
        },
      });
      h.emits.length = 0;
      root.tick(h.ctx);
      const kinds = h.emits.map((e) => e.kind);
      expect(
        kinds,
        `at ${label} (distance=${distance}): expected [${expectedKind}], got [${kinds.join(',')}]`,
      ).toEqual([expectedKind]);
    }
  });
});

describe('buildMediumOffensiveTree — tier delta with new branches', () => {
  it('Medium emits dodge but Easy and Hard never do', async () => {
    const { buildEasyOffensiveTree } = await import('./EasyOffensiveTree');
    const { buildHardOffensiveTree } = await import('./HardOffensiveTree');

    const easyRoot = buildEasyOffensiveTree();
    const mediumRoot = buildMediumOffensiveTree();
    const hardRoot = buildHardOffensiveTree();

    function countDodgeEmits(
      root: ReturnType<typeof buildMediumOffensiveTree>,
      seed: number,
    ): number {
      const h = makeHarness({
        initialOpponent: {
          ...DEFAULT_OPPONENT,
          distance: 50,
          stateLabel: 'attacking',
        },
        rngSeed: seed,
      });
      let dodgeEmits = 0;
      for (let i = 0; i < 1000; i += 1) {
        h.emits.length = 0;
        h.bumpTick();
        root.tick(h.ctx);
        for (const e of h.emits) {
          if (e.kind === 'dodge') dodgeEmits += 1;
        }
      }
      return dodgeEmits;
    }

    const seed = 0xfeed;
    expect(countDodgeEmits(easyRoot, seed)).toBe(0);
    expect(countDodgeEmits(hardRoot, seed)).toBe(0);
    expect(countDodgeEmits(mediumRoot, seed)).toBeGreaterThan(0);
  });

  it('Medium emits ranged special at mid-range; Easy / Hard fall through', async () => {
    const { buildEasyOffensiveTree } = await import('./EasyOffensiveTree');
    const { buildHardOffensiveTree } = await import('./HardOffensiveTree');

    const easyRoot = buildEasyOffensiveTree();
    const mediumRoot = buildMediumOffensiveTree({
      dodgeChance: 0,
      shieldChance: 0,
    });
    const hardRoot = buildHardOffensiveTree();

    function countSpecialEmits(
      root: ReturnType<typeof buildMediumOffensiveTree>,
      seed: number,
    ): number {
      const h = makeHarness({
        initialOpponent: {
          ...DEFAULT_OPPONENT,
          distance: 120,
          stateLabel: 'idle',
        },
        rngSeed: seed,
      });
      let specialEmits = 0;
      for (let i = 0; i < 500; i += 1) {
        h.emits.length = 0;
        h.bumpTick();
        root.tick(h.ctx);
        for (const e of h.emits) {
          if (e.kind === 'special') specialEmits += 1;
        }
      }
      return specialEmits;
    }

    const seed = 0xfade;
    // Easy lacks the ranged branch; Hard's tree doesn't use special as
    // a mid-range poke. Only Medium routes a mid-range opponent into
    // the special projectile.
    expect(countSpecialEmits(mediumRoot, seed)).toBeGreaterThan(0);
    expect(countSpecialEmits(easyRoot, seed)).toBe(0);
    expect(countSpecialEmits(hardRoot, seed)).toBe(0);
  });
});
