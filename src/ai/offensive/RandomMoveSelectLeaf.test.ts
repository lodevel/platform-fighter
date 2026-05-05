import { describe, expect, it } from 'vitest';
import { Blackboard } from '../behaviorTree/Blackboard';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';
import {
  DEFAULT_RANDOM_MOVE_COOLDOWN_FRAMES,
  DEFAULT_RANDOM_MOVE_POOL,
  DEFAULT_RANDOM_MOVE_RANGE_PX,
  RandomMoveSelectLeaf,
  resolveRandomMoveSelectOptions,
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

describe('resolveRandomMoveSelectOptions', () => {
  it('fills in defaults for unspecified fields', () => {
    expect(resolveRandomMoveSelectOptions()).toEqual({
      attackPool: DEFAULT_RANDOM_MOVE_POOL,
      cooldownFrames: DEFAULT_RANDOM_MOVE_COOLDOWN_FRAMES,
      maxRangePx: DEFAULT_RANDOM_MOVE_RANGE_PX,
      comboStepId: 'easy.random',
    });
  });

  it('respects explicit overrides', () => {
    const r = resolveRandomMoveSelectOptions({
      attackPool: ['jab', 'tilt'],
      cooldownFrames: 30,
      maxRangePx: 80,
      comboStepId: 'custom',
    });
    expect(r).toEqual({
      attackPool: ['jab', 'tilt'],
      cooldownFrames: 30,
      maxRangePx: 80,
      comboStepId: 'custom',
    });
  });

  it('throws on empty attack pool', () => {
    expect(() => resolveRandomMoveSelectOptions({ attackPool: [] })).toThrow(
      /at least one entry/,
    );
  });

  it('throws on negative cooldown', () => {
    expect(() => resolveRandomMoveSelectOptions({ cooldownFrames: -1 })).toThrow(
      /non-negative integer/,
    );
  });

  it('throws on non-integer cooldown', () => {
    expect(() => resolveRandomMoveSelectOptions({ cooldownFrames: 1.5 })).toThrow(
      /non-negative integer/,
    );
  });

  it('throws on non-positive range', () => {
    expect(() => resolveRandomMoveSelectOptions({ maxRangePx: 0 })).toThrow(
      /must be > 0/,
    );
    expect(() => resolveRandomMoveSelectOptions({ maxRangePx: -10 })).toThrow(
      /must be > 0/,
    );
  });

  it('freezes the resolved attack pool to prevent mutation', () => {
    const r = resolveRandomMoveSelectOptions({ attackPool: ['jab'] });
    expect(Object.isFrozen(r.attackPool)).toBe(true);
  });
});

describe('RandomMoveSelectLeaf — gating', () => {
  it('returns Failure when no opponent', () => {
    const leaf = new RandomMoveSelectLeaf();
    const h = makeHarness({ initialOpponent: null });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when self.canAttack is false', () => {
    const leaf = new RandomMoveSelectLeaf();
    const h = makeHarness();
    h.setSelf({ canAttack: false });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when opponent is out of range', () => {
    const leaf = new RandomMoveSelectLeaf({ maxRangePx: 50 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 200 },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('out-of-range Failure does not advance the cooldown', () => {
    // Cooldown should only start counting after a *real* press.
    const leaf = new RandomMoveSelectLeaf({ cooldownFrames: 30 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 1000 },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    // Move into range — leaf should be ready to fire immediately.
    h.setOpponent({ ...DEFAULT_OPPONENT, distance: 30 });
    h.bumpTick();
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits.length).toBe(1);
  });

  it('canAttack-false Failure does not advance the cooldown', () => {
    const leaf = new RandomMoveSelectLeaf({ cooldownFrames: 30 });
    const h = makeHarness();
    h.setSelf({ canAttack: false });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    h.setSelf({ canAttack: true });
    h.bumpTick();
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits.length).toBe(1);
  });
});

describe('RandomMoveSelectLeaf — random selection', () => {
  it('emits one of the configured pool entries', () => {
    const leaf = new RandomMoveSelectLeaf({
      attackPool: ['jab', 'tilt', 'smash', 'special'],
      cooldownFrames: 0,
    });
    const h = makeHarness({ rngSeed: 42 });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits.length).toBe(1);
    const emitted = h.emits[0]!;
    expect(['jab', 'tilt', 'smash', 'special']).toContain(emitted.kind);
    expect(emitted.comboStepId).toBe('easy.random');
  });

  it('samples roughly uniformly across a long run with cooldown disabled', () => {
    const pool: AttackKind[] = ['jab', 'tilt', 'smash', 'special'];
    const leaf = new RandomMoveSelectLeaf({
      attackPool: pool,
      cooldownFrames: 0,
    });
    const h = makeHarness({ rngSeed: 0xc0ffee });
    const counts: Record<AttackKind, number> = {
      jab: 0,
      tilt: 0,
      smash: 0,
      special: 0,
    };
    const N = 4000;
    for (let i = 0; i < N; i += 1) {
      h.bumpTick();
      h.emits.length = 0;
      const status = leaf.tick(h.ctx);
      if (status === NodeStatus.Success) {
        const kind = h.emits[0]!.kind as AttackKind;
        counts[kind] += 1;
      }
    }
    const expected = N / 4;
    // Every bucket should be within ±25 % of perfect uniform across 4 k draws.
    for (const k of pool) {
      expect(counts[k]).toBeGreaterThan(expected * 0.75);
      expect(counts[k]).toBeLessThan(expected * 1.25);
    }
  });

  it('skips RNG when pool length is 1', () => {
    const leaf = new RandomMoveSelectLeaf({
      attackPool: ['jab'],
      cooldownFrames: 0,
    });
    const h = makeHarness({ rngSeed: 1 });
    const stateBefore = h.ctx.rng.getState();
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'jab', comboStepId: 'easy.random' }]);
    // No RNG draw occurred — single-entry pool is forced.
    expect(h.ctx.rng.getState()).toBe(stateBefore);
  });

  it('does NOT consume RNG on cooldown-gate Failure', () => {
    const leaf = new RandomMoveSelectLeaf({
      attackPool: ['jab', 'tilt'],
      cooldownFrames: 60,
    });
    const h = makeHarness({ rngSeed: 1 });
    // First tick fires (consumes 1 RNG draw — pool has 2 entries).
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    const stateAfterFirst = h.ctx.rng.getState();

    // Next tick — cooldown active, no RNG burn.
    h.bumpTick();
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.ctx.rng.getState()).toBe(stateAfterFirst);
  });
});

describe('RandomMoveSelectLeaf — long cooldown gating', () => {
  it('first eligible tick fires immediately', () => {
    const leaf = new RandomMoveSelectLeaf({ cooldownFrames: 90 });
    const h = makeHarness();
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
  });

  it('blocks subsequent ticks while cooldown is active', () => {
    const leaf = new RandomMoveSelectLeaf({ cooldownFrames: 90 });
    const h = makeHarness();
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    h.emits.length = 0;
    // Tick 1 .. 89 are all gated.
    for (let i = 1; i < 90; i += 1) {
      h.bumpTick();
      expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
      expect(h.emits).toEqual([]);
    }
  });

  it('re-fires exactly when the cooldown elapses', () => {
    const leaf = new RandomMoveSelectLeaf({ cooldownFrames: 30 });
    const h = makeHarness();
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(leaf.getLastAttackTick()).toBe(0);
    // Skip past the cooldown.
    h.setTick(30);
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(leaf.getLastAttackTick()).toBe(30);
  });

  it('cooldown=0 fires every eligible tick', () => {
    const leaf = new RandomMoveSelectLeaf({ cooldownFrames: 0 });
    const h = makeHarness();
    let fires = 0;
    for (let i = 0; i < 10; i += 1) {
      h.setTick(i);
      h.emits.length = 0;
      if (leaf.tick(h.ctx) === NodeStatus.Success) {
        fires += 1;
      }
    }
    expect(fires).toBe(10);
  });

  it('isCooldownReady reflects the actual gate decision', () => {
    const leaf = new RandomMoveSelectLeaf({ cooldownFrames: 30 });
    const h = makeHarness();
    // Before first press — sentinel makes the gate trivially open.
    expect(leaf.isCooldownReady(0)).toBe(true);
    leaf.tick(h.ctx);
    expect(leaf.isCooldownReady(0)).toBe(false);
    expect(leaf.isCooldownReady(29)).toBe(false);
    expect(leaf.isCooldownReady(30)).toBe(true);
    expect(leaf.isCooldownReady(1000)).toBe(true);
  });

  it('the AC default cooldown is "long" — at least 60 frames', () => {
    expect(DEFAULT_RANDOM_MOVE_COOLDOWN_FRAMES).toBeGreaterThanOrEqual(60);
  });
});

describe('RandomMoveSelectLeaf — reset()', () => {
  it('clears the cooldown so the next eligible tick fires', () => {
    const leaf = new RandomMoveSelectLeaf({ cooldownFrames: 90 });
    const h = makeHarness();
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    h.bumpTick();
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    leaf.reset();
    expect(leaf.getLastAttackTick()).toBe(Number.MIN_SAFE_INTEGER);
    h.bumpTick();
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
  });
});

describe('RandomMoveSelectLeaf — determinism', () => {
  it('produces identical emit sequences across two identically-seeded leaves', () => {
    const a = new RandomMoveSelectLeaf({ cooldownFrames: 0 });
    const b = new RandomMoveSelectLeaf({ cooldownFrames: 0 });
    const ha = makeHarness({ rngSeed: 0xfeedface });
    const hb = makeHarness({ rngSeed: 0xfeedface });

    const N = 200;
    for (let i = 0; i < N; i += 1) {
      ha.bumpTick();
      hb.bumpTick();
      ha.emits.length = 0;
      hb.emits.length = 0;
      expect(a.tick(ha.ctx)).toBe(b.tick(hb.ctx));
      expect(ha.emits).toEqual(hb.emits);
    }
  });

  it('different seeds diverge in their attack picks', () => {
    const seedAttacks = (seed: number): AttackKind[] => {
      const leaf = new RandomMoveSelectLeaf({ cooldownFrames: 0 });
      const h = makeHarness({ rngSeed: seed });
      const out: AttackKind[] = [];
      for (let i = 0; i < 50; i += 1) {
        h.bumpTick();
        h.emits.length = 0;
        leaf.tick(h.ctx);
        out.push(h.emits[0]!.kind as AttackKind);
      }
      return out;
    };

    const a = seedAttacks(1);
    const b = seedAttacks(2);
    // Two different seeds should produce different sequences in 50
    // draws — vanishingly unlikely they exactly match.
    expect(a).not.toEqual(b);
  });
});

describe('RandomMoveSelectLeaf — inspectors', () => {
  it('returns configured tunables', () => {
    const leaf = new RandomMoveSelectLeaf({
      attackPool: ['jab', 'smash'],
      cooldownFrames: 45,
      maxRangePx: 70,
      comboStepId: 'custom',
    });
    expect(leaf.getAttackPool()).toEqual(['jab', 'smash']);
    expect(leaf.getCooldownFrames()).toBe(45);
    expect(leaf.getMaxRangePx()).toBe(70);
    expect(leaf.getComboStepId()).toBe('custom');
    expect(leaf.getLastAttackTick()).toBe(Number.MIN_SAFE_INTEGER);
  });
});
