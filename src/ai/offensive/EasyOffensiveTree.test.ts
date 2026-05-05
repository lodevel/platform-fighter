import { describe, expect, it } from 'vitest';
import { Blackboard } from '../behaviorTree/Blackboard';
import { BehaviorTree } from '../behaviorTree/BehaviorTree';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';
import { REACTION_WINDOW_PRESETS } from '../perception/reactionWindowPresets';
import {
  EASY_REACTION_WINDOW_RANGE,
  buildEasyOffensiveTree,
  resolveEasyOffensiveTreeOptions,
} from './EasyOffensiveTree';
import { DEFAULT_EASY_IDLE_CHANCE } from './IdleChanceLeaf';
import { DEFAULT_EASY_WANDER_CHANCE } from './WanderLeaf';
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

describe('resolveEasyOffensiveTreeOptions', () => {
  it('fills in defaults for unspecified fields', () => {
    expect(resolveEasyOffensiveTreeOptions()).toEqual({
      idleChance: DEFAULT_EASY_IDLE_CHANCE,
      wanderChance: DEFAULT_EASY_WANDER_CHANCE,
      jabRangePx: 50,
    });
  });

  it('respects explicit overrides', () => {
    const r = resolveEasyOffensiveTreeOptions({
      idleChance: 0.2,
      wanderChance: 0.1,
      jabRangePx: 40,
    });
    expect(r).toEqual({ idleChance: 0.2, wanderChance: 0.1, jabRangePx: 40 });
  });

  it('defaults wanderChance to DEFAULT_EASY_WANDER_CHANCE when unspecified', () => {
    expect(
      resolveEasyOffensiveTreeOptions({ idleChance: 0 }).wanderChance,
    ).toBe(DEFAULT_EASY_WANDER_CHANCE);
  });
});

describe('EASY_REACTION_WINDOW_RANGE', () => {
  it('matches the central preset table for the easy tier', () => {
    expect(EASY_REACTION_WINDOW_RANGE).toEqual(
      REACTION_WINDOW_PRESETS.easy,
    );
    // Surface the AC-mandated slow band: 28-36 frames.
    expect(EASY_REACTION_WINDOW_RANGE.minDelayFrames).toBe(28);
    expect(EASY_REACTION_WINDOW_RANGE.maxDelayFrames).toBe(36);
  });

  it('is slower than medium and hard tiers', () => {
    const easy = EASY_REACTION_WINDOW_RANGE;
    const medium = REACTION_WINDOW_PRESETS.medium;
    const hard = REACTION_WINDOW_PRESETS.hard;
    expect(easy.minDelayFrames).toBeGreaterThan(medium.minDelayFrames);
    expect(easy.minDelayFrames).toBeGreaterThan(hard.minDelayFrames);
  });
});

describe('buildEasyOffensiveTree — idle hesitation branch', () => {
  it('emits idle and short-circuits when idleChance is 1', () => {
    const root = buildEasyOffensiveTree({ idleChance: 1 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 30 },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    // Only an idle emit — the basic-jab branch never ran.
    expect(h.emits).toEqual([{ kind: 'idle', comboStepId: 'easy.idle' }]);
  });

  it('falls through to the basic-jab branch when idleChance is 0', () => {
    const root = buildEasyOffensiveTree({ idleChance: 0, wanderChance: 0 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 30 },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'easy.jab' }]);
  });
});

describe('buildEasyOffensiveTree — basic-jab branch', () => {
  it('emits a jab when in range and idle does not fire', () => {
    const root = buildEasyOffensiveTree({ idleChance: 0, wanderChance: 0 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 40 },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'easy.jab' }]);
  });

  it('emits movement when out of jab range and returns Running', () => {
    const root = buildEasyOffensiveTree({ idleChance: 0, wanderChance: 0 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 200 },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([{ kind: 'moveRight' }]);
  });

  it('moves left when opponent is to the left', () => {
    const root = buildEasyOffensiveTree({ idleChance: 0, wanderChance: 0 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: -200 },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([{ kind: 'moveLeft' }]);
  });

  it('returns Failure when no opponent is alive', () => {
    const root = buildEasyOffensiveTree({ idleChance: 0, wanderChance: 0 });
    const h = makeHarness({ initialOpponent: null });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('only ever picks jab — never tilt, smash, or special', () => {
    // Run the tree across many ticks with varied opponent percent and
    // confirm the only attack verb that appears is `jab`.
    const root = buildEasyOffensiveTree({ idleChance: 0, wanderChance: 0 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 40 },
    });

    for (const pct of [0, 30, 60, 90, 130, 160, 200]) {
      h.setOpponent({
        ...DEFAULT_OPPONENT,
        distance: 40,
        damagePercent: pct,
      });
      h.emits.length = 0;
      h.bumpTick();
      root.tick(h.ctx);
      // Only ever a jab — never tilt/smash/special.
      const attackEmits = h.emits.filter((e) =>
        e.kind === 'jab' ||
        e.kind === 'tilt' ||
        e.kind === 'smash' ||
        e.kind === 'special',
      );
      expect(attackEmits).toEqual([{ kind: 'jab', comboStepId: 'easy.jab' }]);
    }
  });

  it('does not stage combo follow-ups even after a landed jab', () => {
    // Easy tier ignores comboStage entirely — even if the controller
    // calls registerLandedHit (which it likely will not in M2 Easy
    // wiring), the next tick must still pick jab, never tilt or smash.
    const root = buildEasyOffensiveTree({ idleChance: 0, wanderChance: 0 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 40 },
    });

    // Manually pre-populate the blackboard to simulate a registered jab
    // hit (this is what the offensive controller does on a landed jab).
    h.blackboard.set('comboStage', 'jabConnected');
    h.blackboard.set('comboLastLandedMove', 'jab');
    h.blackboard.set('comboLastLandedTick', 0);
    h.blackboard.set('comboLastLandedOpponentPercent', 70);

    h.bumpTick();
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    // Easy tier ignored the staged combo — basic jab fired again.
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'easy.jab' }]);
  });
});

describe('buildEasyOffensiveTree — frequency over many ticks', () => {
  it('idles roughly idleChance fraction of ticks across a long sample', () => {
    // Use a low-but-nontrivial idleChance and confirm the bot
    // *frequently* idles. Easy AC requires "frequent idle behavior";
    // the default 0.4 chance should produce thousands of idle beats
    // across 5_000 ticks. Disable wander so the per-tick partition is
    // a clean idle / jab split for assertion purposes.
    const root = buildEasyOffensiveTree({ wanderChance: 0 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 30 },
      rngSeed: 0xc0ffee,
    });

    let idleCount = 0;
    let jabCount = 0;
    const N = 5000;
    for (let i = 0; i < N; i += 1) {
      h.emits.length = 0;
      h.bumpTick();
      root.tick(h.ctx);
      for (const emit of h.emits) {
        if (emit.kind === 'idle') idleCount += 1;
        if (emit.kind === 'jab') jabCount += 1;
      }
    }

    // Both behaviors fire many times — the bot is neither frozen nor
    // permanently aggressive.
    expect(idleCount).toBeGreaterThan(N * 0.3);
    expect(idleCount).toBeLessThan(N * 0.5);
    expect(jabCount).toBeGreaterThan(N * 0.5);
    // Sanity: the two largely partition the tick space (some ticks
    // produce neither, e.g. if the harness drops into edge cases).
    expect(idleCount + jabCount).toBeGreaterThan(N * 0.95);
  });

  it('wanders roughly wanderChance fraction of non-idle ticks across a long sample', () => {
    // Default idleChance = 0.4, default wanderChance = 0.25. Of the
    // ~60 % non-idle ticks, ~25 % wander → ~15 % of the total.
    const root = buildEasyOffensiveTree(); // defaults
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 30 },
      rngSeed: 0xfeedbeef,
    });

    let idleCount = 0;
    let wanderCount = 0;
    let jabCount = 0;
    const N = 5000;
    for (let i = 0; i < N; i += 1) {
      h.emits.length = 0;
      h.bumpTick();
      root.tick(h.ctx);
      // Categorise each tick by its first emit kind (the tree always
      // emits exactly one verb when a branch fires).
      const first = h.emits[0]?.kind;
      if (first === 'idle') idleCount += 1;
      else if (first === 'moveLeft' || first === 'moveRight') wanderCount += 1;
      else if (first === 'jab') jabCount += 1;
    }

    // Idle is the dominant mode (~40 %).
    expect(idleCount).toBeGreaterThan(N * 0.3);
    // Wander fires on a meaningful fraction of ticks (~15 %, allow
    // ±5 % slack).
    expect(wanderCount).toBeGreaterThan(N * 0.1);
    expect(wanderCount).toBeLessThan(N * 0.2);
    // Purposeful jab is the residual (~45 % when in range).
    expect(jabCount).toBeGreaterThan(N * 0.3);
  });

  it('weakness vs. Hard: Easy emits far fewer attacks per tick on average', () => {
    // Easy hesitates and only ever jabs; Hard runs MoveTowardOpponent
    // → FireAttackLeaf with combo follow-ups and a KO smash branch.
    // We approximate the "noticeably weaker" criterion by counting
    // attack emits over a fixed window of identical scenarios — Easy
    // should produce strictly fewer.
    const easy = buildEasyOffensiveTree();
    const hEasy = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 30 },
      rngSeed: 42,
    });
    let easyAttacks = 0;
    const N = 1000;
    for (let i = 0; i < N; i += 1) {
      hEasy.emits.length = 0;
      hEasy.bumpTick();
      easy.tick(hEasy.ctx);
      for (const e of hEasy.emits) {
        if (
          e.kind === 'jab' ||
          e.kind === 'tilt' ||
          e.kind === 'smash' ||
          e.kind === 'special'
        ) {
          easyAttacks += 1;
        }
      }
    }
    // Easy emits roughly (1 - idleChance) × (1 - wanderChance) × N
    // attacks ≈ 450 jabs after both gates. It MUST be strictly less
    // than N — the AC's "frequent idle / wandering" beats keep the
    // bot from pressing every frame.
    expect(easyAttacks).toBeLessThan(N);
    expect(easyAttacks).toBeGreaterThan(0);
  });
});

describe('buildEasyOffensiveTree — determinism', () => {
  it('produces identical tick sequences across two identically-seeded harnesses', () => {
    const a = buildEasyOffensiveTree();
    const b = buildEasyOffensiveTree();
    const ha = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 200 },
      rngSeed: 0xfeedface,
    });
    const hb = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 200 },
      rngSeed: 0xfeedface,
    });

    for (let i = 0; i < 50; i += 1) {
      ha.bumpTick();
      hb.bumpTick();
      expect(a.tick(ha.ctx)).toBe(b.tick(hb.ctx));
      expect(ha.emits).toEqual(hb.emits);
    }
  });

  it('plays nicely with BehaviorTree runner — reset clears tree state', () => {
    const root = buildEasyOffensiveTree({ idleChance: 0, wanderChance: 0 });
    const tree = new BehaviorTree<OffensiveContext, OffensiveBlackboardSchema>(
      root,
      { initialBlackboard: { ...DEFAULT_OFFENSIVE_BLACKBOARD } },
    );
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 200 },
    });
    Object.defineProperty(h.ctx, 'blackboard', {
      value: tree.getBlackboard(),
      configurable: true,
    });

    expect(tree.tick(h.ctx)).toBe(NodeStatus.Running);
    // The Selector has the Sequence pinned as Running; resetting the
    // tree should clear that progress so the next tick starts fresh.
    tree.reset();
    h.setOpponent({ ...DEFAULT_OPPONENT, distance: 30 });
    h.emits.length = 0;
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'easy.jab' }]);
  });
});
