import { describe, expect, it } from 'vitest';
import { Blackboard } from '../behaviorTree/Blackboard';
import { BehaviorTree } from '../behaviorTree/BehaviorTree';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';
import { REACTION_WINDOW_PRESETS } from '../perception/reactionWindowPresets';
import {
  EASY_RANDOM_REACTION_WINDOW_RANGE,
  buildEasyRandomMoveTree,
  resolveEasyRandomMoveTreeOptions,
} from './EasyRandomMoveTree';
import { DEFAULT_EASY_IDLE_CHANCE } from './IdleChanceLeaf';
import {
  DEFAULT_RANDOM_MOVE_COOLDOWN_FRAMES,
  DEFAULT_RANDOM_MOVE_POOL,
  DEFAULT_RANDOM_MOVE_RANGE_PX,
} from './RandomMoveSelectLeaf';
import type {
  AttackKind,
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
  setTick(tick: number): void;
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
    setTick(tick) {
      tickIndex = tick;
    },
    bumpTick() {
      tickIndex += 1;
    },
  };
}

describe('resolveEasyRandomMoveTreeOptions', () => {
  it('fills in defaults for unspecified fields', () => {
    expect(resolveEasyRandomMoveTreeOptions()).toEqual({
      idleChance: DEFAULT_EASY_IDLE_CHANCE,
      attackPool: DEFAULT_RANDOM_MOVE_POOL,
      cooldownFrames: DEFAULT_RANDOM_MOVE_COOLDOWN_FRAMES,
      attackRangePx: DEFAULT_RANDOM_MOVE_RANGE_PX,
    });
  });

  it('respects explicit overrides', () => {
    const r = resolveEasyRandomMoveTreeOptions({
      idleChance: 0.2,
      attackPool: ['jab'],
      cooldownFrames: 10,
      attackRangePx: 80,
    });
    expect(r).toEqual({
      idleChance: 0.2,
      attackPool: ['jab'],
      cooldownFrames: 10,
      attackRangePx: 80,
    });
  });
});

describe('EASY_RANDOM_REACTION_WINDOW_RANGE — slow reaction times', () => {
  it('matches the central preset table for the easy tier', () => {
    expect(EASY_RANDOM_REACTION_WINDOW_RANGE).toEqual(
      REACTION_WINDOW_PRESETS.easy,
    );
    // Surface the AC-mandated slow band: 28-36 frames.
    expect(EASY_RANDOM_REACTION_WINDOW_RANGE.minDelayFrames).toBe(28);
    expect(EASY_RANDOM_REACTION_WINDOW_RANGE.maxDelayFrames).toBe(36);
  });

  it('is slower than medium and hard tiers', () => {
    const easy = EASY_RANDOM_REACTION_WINDOW_RANGE;
    const medium = REACTION_WINDOW_PRESETS.medium;
    const hard = REACTION_WINDOW_PRESETS.hard;
    expect(easy.minDelayFrames).toBeGreaterThan(medium.minDelayFrames);
    expect(easy.minDelayFrames).toBeGreaterThan(hard.minDelayFrames);
  });
});

describe('buildEasyRandomMoveTree — idle hesitation branch', () => {
  it('emits idle and short-circuits when idleChance is 1', () => {
    const root = buildEasyRandomMoveTree({ idleChance: 1 });
    const h = makeHarness();
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([
      { kind: 'idle', comboStepId: 'easyRandom.idle' },
    ]);
  });

  it('falls through to the random-attack branch when idleChance is 0', () => {
    const root = buildEasyRandomMoveTree({
      idleChance: 0,
      attackPool: ['jab'],
      cooldownFrames: 0,
    });
    const h = makeHarness();
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'easyRandom.press' }]);
  });
});

describe('buildEasyRandomMoveTree — basic movement toward opponent', () => {
  it('emits moveRight when opponent is far to the right', () => {
    const root = buildEasyRandomMoveTree({
      idleChance: 0,
      attackPool: ['jab'],
    });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 200 },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([{ kind: 'moveRight' }]);
  });

  it('emits moveLeft when opponent is far to the left', () => {
    const root = buildEasyRandomMoveTree({
      idleChance: 0,
      attackPool: ['jab'],
    });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: -200 },
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([{ kind: 'moveLeft' }]);
  });

  it('returns Failure when no opponent is alive', () => {
    const root = buildEasyRandomMoveTree({ idleChance: 0 });
    const h = makeHarness({ initialOpponent: null });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

describe('buildEasyRandomMoveTree — random move selection', () => {
  it('picks attacks across the full pool over time', () => {
    const root = buildEasyRandomMoveTree({
      idleChance: 0, // no idle hesitation — every tick wants to attack
      attackPool: ['jab', 'tilt', 'smash', 'special'],
      cooldownFrames: 0, // disable cooldown so we get one press per tick
    });
    const h = makeHarness({ rngSeed: 0xc0ffee });

    const seen = new Set<AttackKind>();
    for (let i = 0; i < 200; i += 1) {
      h.bumpTick();
      h.emits.length = 0;
      root.tick(h.ctx);
      for (const e of h.emits) {
        if (
          e.kind === 'jab' ||
          e.kind === 'tilt' ||
          e.kind === 'smash' ||
          e.kind === 'special'
        ) {
          seen.add(e.kind as AttackKind);
        }
      }
    }
    // All four pool entries should have been picked at least once.
    expect(seen).toEqual(new Set(['jab', 'tilt', 'smash', 'special']));
  });

  it('respects a narrowed pool', () => {
    const root = buildEasyRandomMoveTree({
      idleChance: 0,
      attackPool: ['jab', 'tilt'],
      cooldownFrames: 0,
    });
    const h = makeHarness({ rngSeed: 0xfeed });

    for (let i = 0; i < 100; i += 1) {
      h.bumpTick();
      h.emits.length = 0;
      root.tick(h.ctx);
      for (const e of h.emits) {
        if (
          e.kind === 'jab' ||
          e.kind === 'tilt' ||
          e.kind === 'smash' ||
          e.kind === 'special'
        ) {
          // Only picks from the narrowed pool — never smash or special.
          expect(['jab', 'tilt']).toContain(e.kind);
        }
      }
    }
  });
});

describe('buildEasyRandomMoveTree — long cooldowns', () => {
  it('does not press an attack on consecutive in-range ticks', () => {
    const root = buildEasyRandomMoveTree({
      idleChance: 0,
      attackPool: ['jab'],
      cooldownFrames: 30,
    });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 30 },
    });

    let pressCount = 0;
    for (let i = 0; i < 90; i += 1) {
      h.setTick(i);
      h.emits.length = 0;
      root.tick(h.ctx);
      for (const e of h.emits) {
        if (e.kind === 'jab') pressCount += 1;
      }
    }
    // 90 ticks / 30-frame cooldown = ~3 presses, definitely <= 4.
    expect(pressCount).toBeLessThanOrEqual(4);
    expect(pressCount).toBeGreaterThanOrEqual(2);
  });

  it('default cooldown produces noticeably slow attack cadence', () => {
    // No idle, in-range, default cooldown (90 frames) — this measures
    // the "long cooldown" beat the AC explicitly calls for.
    const root = buildEasyRandomMoveTree({ idleChance: 0 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 30 },
    });

    let attackCount = 0;
    const N = 600; // 10 seconds at 60 FPS
    for (let i = 0; i < N; i += 1) {
      h.setTick(i);
      h.emits.length = 0;
      root.tick(h.ctx);
      for (const e of h.emits) {
        if (
          e.kind === 'jab' ||
          e.kind === 'tilt' ||
          e.kind === 'smash' ||
          e.kind === 'special'
        ) {
          attackCount += 1;
        }
      }
    }
    // 600 frames / 90-frame cooldown ≈ 6-7 attacks. Cap firmly under
    // 10 — Easy tier should not be button-mashing every frame.
    expect(attackCount).toBeLessThan(10);
    expect(attackCount).toBeGreaterThan(3);
  });
});

describe('buildEasyRandomMoveTree — frequent idle behaviour', () => {
  it('idles a substantial fraction of ticks at default settings', () => {
    const root = buildEasyRandomMoveTree(); // defaults
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 30 },
      rngSeed: 0xc0ffee,
    });

    let idleCount = 0;
    const N = 3000;
    for (let i = 0; i < N; i += 1) {
      h.setTick(i);
      h.emits.length = 0;
      root.tick(h.ctx);
      for (const e of h.emits) {
        if (e.kind === 'idle') idleCount += 1;
      }
    }
    // Default idleChance is 0.4 — expect roughly 1200 idles, with
    // generous bounds for sampling noise.
    expect(idleCount).toBeGreaterThan(N * 0.3);
    expect(idleCount).toBeLessThan(N * 0.5);
  });
});

describe('buildEasyRandomMoveTree — determinism', () => {
  it('produces identical tick sequences across two identically-seeded harnesses', () => {
    const a = buildEasyRandomMoveTree({ cooldownFrames: 5 });
    const b = buildEasyRandomMoveTree({ cooldownFrames: 5 });
    const ha = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 200 },
      rngSeed: 0xfeedface,
    });
    const hb = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 200 },
      rngSeed: 0xfeedface,
    });

    for (let i = 0; i < 200; i += 1) {
      ha.bumpTick();
      hb.bumpTick();
      ha.emits.length = 0;
      hb.emits.length = 0;
      expect(a.tick(ha.ctx)).toBe(b.tick(hb.ctx));
      expect(ha.emits).toEqual(hb.emits);
    }
  });

  it('plays nicely with BehaviorTree runner — reset clears tree state', () => {
    const root = buildEasyRandomMoveTree({
      idleChance: 0,
      attackPool: ['jab'],
      cooldownFrames: 30,
    });
    const tree = new BehaviorTree<OffensiveContext, OffensiveBlackboardSchema>(
      root,
      { initialBlackboard: { ...DEFAULT_OFFENSIVE_BLACKBOARD } },
    );
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 30 },
    });
    Object.defineProperty(h.ctx, 'blackboard', {
      value: tree.getBlackboard(),
      configurable: true,
    });

    // Press once, exhaust the cooldown for a moment.
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Success);
    h.bumpTick();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure); // cooldown active

    // Reset clears the cooldown — the next tick should be able to fire.
    tree.reset();
    h.emits.length = 0;
    h.bumpTick();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits.length).toBe(1);
    expect(h.emits[0]!.kind).toBe('jab');
  });
});

describe('AC 10202 Sub-AC 2 — required-piece smoke test', () => {
  it('combines slow reactions (preset), basic movement, and random + cooldown', () => {
    // (1) slow reactions — preset re-export is the canonical 28-36 band.
    expect(EASY_RANDOM_REACTION_WINDOW_RANGE.minDelayFrames).toBe(28);
    expect(EASY_RANDOM_REACTION_WINDOW_RANGE.maxDelayFrames).toBe(36);

    // (2) basic movement toward opponent — far opponent triggers a
    //     gap-close emit.
    const movingTree = buildEasyRandomMoveTree({ idleChance: 0 });
    const farHarness = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 300 },
    });
    movingTree.tick(farHarness.ctx);
    expect(farHarness.emits.some((e) => e.kind === 'moveRight')).toBe(true);

    // (3) random move selection with long cooldowns — in 600 frames
    //     of in-range standing, the bot fires < 10 times.
    const stationaryTree = buildEasyRandomMoveTree({ idleChance: 0 });
    const stationaryHarness = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 30 },
    });
    let attacks = 0;
    for (let i = 0; i < 600; i += 1) {
      stationaryHarness.setTick(i);
      stationaryHarness.emits.length = 0;
      stationaryTree.tick(stationaryHarness.ctx);
      for (const e of stationaryHarness.emits) {
        if (
          e.kind === 'jab' ||
          e.kind === 'tilt' ||
          e.kind === 'smash' ||
          e.kind === 'special'
        ) {
          attacks += 1;
        }
      }
    }
    // Long cooldown ⇒ noticeably few attacks across a 10 s window.
    expect(attacks).toBeLessThan(10);
  });
});
