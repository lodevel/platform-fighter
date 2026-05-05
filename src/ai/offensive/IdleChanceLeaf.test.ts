import { describe, expect, it } from 'vitest';
import { Blackboard } from '../behaviorTree/Blackboard';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';
import {
  DEFAULT_EASY_IDLE_CHANCE,
  IdleChanceLeaf,
} from './IdleChanceLeaf';
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
  setOpponent(snap: OpponentSnapshot | null): void;
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
  rngSeed?: number;
  opponent?: OpponentSnapshot | null;
  self?: Partial<SelfSnapshot>;
} = {}): Harness {
  const emits: OffensiveAction[] = [];
  const blackboard = new Blackboard<OffensiveBlackboardSchema>({
    ...DEFAULT_OFFENSIVE_BLACKBOARD,
  });
  let opponent: OpponentSnapshot | null =
    opts.opponent ?? { ...DEFAULT_OPPONENT };
  let tickIndex = 0;
  const self: SelfSnapshot = {
    facing: 1,
    canAttack: true,
    isAirborne: false,
    damagePercent: 0,
    ...opts.self,
  };

  const ctx: OffensiveContext = {
    blackboard,
    get tickIndex() {
      return tickIndex;
    },
    get opponent() {
      return opponent;
    },
    self,
    out: { emit: (a) => emits.push(a) },
    rng: new Rng(opts.rngSeed ?? 1),
  } as OffensiveContext;

  return {
    ctx,
    emits,
    setOpponent(snap) {
      opponent = snap;
    },
    bumpTick() {
      tickIndex += 1;
    },
  };
}

describe('IdleChanceLeaf — construction', () => {
  it('uses the default idle chance when none is supplied', () => {
    const leaf = new IdleChanceLeaf();
    expect(leaf.getIdleChance()).toBe(DEFAULT_EASY_IDLE_CHANCE);
  });

  it('uses the default comboStepId when none is supplied', () => {
    const leaf = new IdleChanceLeaf();
    expect(leaf.getComboStepId()).toBe('easy.idle');
  });

  it('respects an explicit idleChance', () => {
    const leaf = new IdleChanceLeaf({ idleChance: 0.25 });
    expect(leaf.getIdleChance()).toBe(0.25);
  });

  it('respects an explicit comboStepId', () => {
    const leaf = new IdleChanceLeaf({ comboStepId: 'mediumPause' });
    expect(leaf.getComboStepId()).toBe('mediumPause');
  });

  it.each([
    -0.001,
    1.001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('rejects out-of-range idleChance: %p', (chance) => {
    expect(() => new IdleChanceLeaf({ idleChance: chance })).toThrow(
      /idleChance/,
    );
  });

  it('accepts the boundary values 0 and 1', () => {
    expect(() => new IdleChanceLeaf({ idleChance: 0 })).not.toThrow();
    expect(() => new IdleChanceLeaf({ idleChance: 1 })).not.toThrow();
  });
});

describe('IdleChanceLeaf — tick behaviour', () => {
  it('emits idle and returns Success when the roll is below idleChance', () => {
    // With idleChance=1, every roll triggers an idle.
    const leaf = new IdleChanceLeaf({ idleChance: 1 });
    const h = makeHarness();
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'idle', comboStepId: 'easy.idle' }]);
  });

  it('returns Failure without emitting when idleChance is 0', () => {
    const leaf = new IdleChanceLeaf({ idleChance: 0 });
    const h = makeHarness();
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('uses the configured comboStepId in the emitted action', () => {
    const leaf = new IdleChanceLeaf({
      idleChance: 1,
      comboStepId: 'easy.hesitation',
    });
    const h = makeHarness();
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([
      { kind: 'idle', comboStepId: 'easy.hesitation' },
    ]);
  });

  it('always burns exactly one RNG draw per tick (failure path too)', () => {
    const leaf = new IdleChanceLeaf({ idleChance: 0.5 });
    const seed = 12345;
    const h = makeHarness({ rngSeed: seed });

    // Reference RNG with the same seed; advance it tick-by-tick and
    // confirm both the leaf's RNG state and the reference are aligned
    // after each tick.
    const reference = new Rng(seed);
    for (let i = 0; i < 20; i += 1) {
      const refRoll = reference.next();
      const expectStatus =
        refRoll < 0.5 ? NodeStatus.Success : NodeStatus.Failure;
      expect(leaf.tick(h.ctx)).toBe(expectStatus);
      expect(h.ctx.rng.getState()).toBe(reference.getState());
    }
  });
});

describe('IdleChanceLeaf — frequency over many ticks', () => {
  it('idles in roughly idleChance × N ticks over a long sample', () => {
    // Long-run frequency test: with `idleChance = 0.4` and a fixed
    // seed, the idle fraction across 5_000 ticks should be close to
    // 40 % within a generous tolerance band. We accept ±5 % to avoid
    // brittleness against the deterministic Mulberry32 distribution.
    const leaf = new IdleChanceLeaf({ idleChance: 0.4 });
    const h = makeHarness({ rngSeed: 0xc0ffee });
    let idleCount = 0;
    const N = 5000;
    for (let i = 0; i < N; i += 1) {
      const status = leaf.tick(h.ctx);
      if (status === NodeStatus.Success) {
        idleCount += 1;
      }
    }
    const fraction = idleCount / N;
    expect(fraction).toBeGreaterThan(0.35);
    expect(fraction).toBeLessThan(0.45);
  });

  it('idles less often at lower idleChance', () => {
    const lowChance = new IdleChanceLeaf({ idleChance: 0.1 });
    const highChance = new IdleChanceLeaf({ idleChance: 0.6 });
    const hLow = makeHarness({ rngSeed: 0xfeed });
    const hHigh = makeHarness({ rngSeed: 0xfeed });

    let lowIdle = 0;
    let highIdle = 0;
    const N = 2000;
    for (let i = 0; i < N; i += 1) {
      if (lowChance.tick(hLow.ctx) === NodeStatus.Success) lowIdle += 1;
      if (highChance.tick(hHigh.ctx) === NodeStatus.Success) highIdle += 1;
    }
    expect(lowIdle).toBeLessThan(highIdle);
  });
});

describe('IdleChanceLeaf — determinism', () => {
  it('produces identical Success/Failure sequences across two leaves with the same seed', () => {
    const leafA = new IdleChanceLeaf({ idleChance: 0.4 });
    const leafB = new IdleChanceLeaf({ idleChance: 0.4 });
    const hA = makeHarness({ rngSeed: 0xdeadbeef });
    const hB = makeHarness({ rngSeed: 0xdeadbeef });
    for (let i = 0; i < 100; i += 1) {
      expect(leafA.tick(hA.ctx)).toBe(leafB.tick(hB.ctx));
      expect(hA.emits).toEqual(hB.emits);
    }
  });

  it('produces different sequences across two leaves with different seeds', () => {
    const leafA = new IdleChanceLeaf({ idleChance: 0.4 });
    const leafB = new IdleChanceLeaf({ idleChance: 0.4 });
    const hA = makeHarness({ rngSeed: 1 });
    const hB = makeHarness({ rngSeed: 2 });
    let divergences = 0;
    for (let i = 0; i < 100; i += 1) {
      const a = leafA.tick(hA.ctx);
      const b = leafB.tick(hB.ctx);
      if (a !== b) divergences += 1;
    }
    // With independent seeds and 100 trials, the two streams should
    // disagree on a meaningful fraction of ticks.
    expect(divergences).toBeGreaterThan(10);
  });
});
