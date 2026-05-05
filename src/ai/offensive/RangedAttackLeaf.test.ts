import { describe, expect, it } from 'vitest';

import { Blackboard } from '../behaviorTree/Blackboard';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';

import {
  DEFAULT_RANGED_MAX_RANGE_PX,
  DEFAULT_RANGED_MIN_RANGE_PX,
  DEFAULT_RANGED_SKIP_STATE_LABELS,
  RangedAttackLeaf,
} from './RangedAttackLeaf';
import type {
  OffensiveAction,
  OffensiveBlackboardSchema,
  OffensiveContext,
  OpponentSnapshot,
  OpponentStateLabel,
  SelfSnapshot,
} from './types';
import { DEFAULT_OFFENSIVE_BLACKBOARD } from './types';

interface Harness {
  ctx: OffensiveContext;
  emits: OffensiveAction[];
  setOpponent(snap: OpponentSnapshot | null): void;
  setSelf(self: Partial<SelfSnapshot>): void;
}

const DEFAULT_OPPONENT: OpponentSnapshot = {
  id: 'p2',
  distance: 120,
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
  const tickIndex = 0;

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
    setOpponent(snap) {
      opponent = snap;
    },
    setSelf(patch) {
      self = { ...self, ...patch };
    },
  };
}

describe('RangedAttackLeaf — constructor validation', () => {
  it('accepts default options', () => {
    const leaf = new RangedAttackLeaf();
    expect(leaf.getMinRangePx()).toBe(DEFAULT_RANGED_MIN_RANGE_PX);
    expect(leaf.getMaxRangePx()).toBe(DEFAULT_RANGED_MAX_RANGE_PX);
    expect(leaf.getComboStepId()).toBe('medium.ranged');
    expect([...leaf.getSkipStateLabels()].sort()).toEqual(
      ['dodging', 'shielding'].sort(),
    );
  });

  it('accepts overrides for every option', () => {
    const leaf = new RangedAttackLeaf({
      minRangePx: 80,
      maxRangePx: 240,
      skipStateLabels: ['shielding'],
      comboStepId: 'custom.ranged',
    });
    expect(leaf.getMinRangePx()).toBe(80);
    expect(leaf.getMaxRangePx()).toBe(240);
    expect(leaf.getComboStepId()).toBe('custom.ranged');
    expect(leaf.getSkipStateLabels()).toEqual(['shielding']);
  });

  it('rejects non-positive minRangePx / maxRangePx', () => {
    expect(() => new RangedAttackLeaf({ minRangePx: 0 })).toThrow();
    expect(() => new RangedAttackLeaf({ minRangePx: -10 })).toThrow();
    expect(() => new RangedAttackLeaf({ minRangePx: NaN })).toThrow();
    expect(() => new RangedAttackLeaf({ maxRangePx: 0 })).toThrow();
    expect(() => new RangedAttackLeaf({ maxRangePx: NaN })).toThrow();
  });

  it('rejects min >= max (empty / inverted band)', () => {
    expect(
      () => new RangedAttackLeaf({ minRangePx: 100, maxRangePx: 100 }),
    ).toThrow();
    expect(
      () => new RangedAttackLeaf({ minRangePx: 200, maxRangePx: 100 }),
    ).toThrow();
  });

  it('accepts an empty skipStateLabels list (fire regardless)', () => {
    expect(
      () => new RangedAttackLeaf({ skipStateLabels: [] }),
    ).not.toThrow();
  });
});

describe('RangedAttackLeaf — gating', () => {
  it('returns Failure with no opponent', () => {
    const leaf = new RangedAttackLeaf();
    const h = makeHarness({ initialOpponent: null });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when canAttack is false', () => {
    const leaf = new RangedAttackLeaf();
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 120 },
    });
    h.setSelf({ canAttack: false });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when opponent is too close (inside minRangePx)', () => {
    const leaf = new RangedAttackLeaf();
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 30 },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when opponent is too far (outside maxRangePx)', () => {
    const leaf = new RangedAttackLeaf();
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 250 },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when opponent is in a skip state (shielding)', () => {
    const leaf = new RangedAttackLeaf();
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 120,
        stateLabel: 'shielding',
      },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when opponent is in a skip state (dodging)', () => {
    const leaf = new RangedAttackLeaf();
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 120,
        stateLabel: 'dodging',
      },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('emits special when all gates open', () => {
    const leaf = new RangedAttackLeaf();
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 120 },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'special', comboStepId: 'medium.ranged' }]);
  });

  it('range gating uses absolute distance — fires for left-side opponents too', () => {
    const leaf = new RangedAttackLeaf();
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: -120 },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'special', comboStepId: 'medium.ranged' }]);
  });

  it('boundary distance exactly at minRangePx fires (closed lower bound)', () => {
    const leaf = new RangedAttackLeaf({ minRangePx: 60, maxRangePx: 180 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 60 },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'special', comboStepId: 'medium.ranged' }]);
  });

  it('boundary distance exactly at maxRangePx fires (closed upper bound)', () => {
    const leaf = new RangedAttackLeaf({ minRangePx: 60, maxRangePx: 180 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 180 },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'special', comboStepId: 'medium.ranged' }]);
  });
});

describe('RangedAttackLeaf — contextual move selection', () => {
  it('partitions distance space cleanly: close-range Fails, mid-range Success, far Fails', () => {
    const leaf = new RangedAttackLeaf({ minRangePx: 60, maxRangePx: 180 });
    const cases: ReadonlyArray<{ distance: number; expected: NodeStatus }> = [
      { distance: 0, expected: NodeStatus.Failure }, // point-blank
      { distance: 30, expected: NodeStatus.Failure }, // melee
      { distance: 50, expected: NodeStatus.Failure }, // melee edge
      { distance: 60, expected: NodeStatus.Success }, // mid-range start
      { distance: 100, expected: NodeStatus.Success }, // mid-range
      { distance: 180, expected: NodeStatus.Success }, // mid-range end
      { distance: 181, expected: NodeStatus.Failure }, // beyond
      { distance: 300, expected: NodeStatus.Failure }, // far
    ];
    for (const { distance, expected } of cases) {
      const h = makeHarness({
        initialOpponent: { ...DEFAULT_OPPONENT, distance },
      });
      expect(leaf.tick(h.ctx)).toBe(expected);
    }
  });

  it('iterates every OpponentStateLabel and skips configured ones', () => {
    const allLabels: readonly OpponentStateLabel[] = [
      'idle',
      'attacking',
      'recovering',
      'shielding',
      'dodging',
      'hitstun',
      'airborne',
      'ledgeHang',
    ];

    const leaf = new RangedAttackLeaf({
      minRangePx: 60,
      maxRangePx: 180,
      skipStateLabels: ['shielding', 'dodging'],
    });

    for (const label of allLabels) {
      const h = makeHarness({
        initialOpponent: {
          ...DEFAULT_OPPONENT,
          distance: 120,
          stateLabel: label,
        },
      });
      const status = leaf.tick(h.ctx);
      if (label === 'shielding' || label === 'dodging') {
        expect(status).toBe(NodeStatus.Failure);
      } else {
        expect(status).toBe(NodeStatus.Success);
        expect(h.emits).toEqual([
          { kind: 'special', comboStepId: 'medium.ranged' },
        ]);
      }
    }
  });
});

describe('RangedAttackLeaf — determinism', () => {
  it('does not consume RNG (pure snapshot-in / emit-out)', () => {
    const leaf = new RangedAttackLeaf();
    const baseline = makeHarness({ rngSeed: 0xc0ffee }).ctx.rng.next();

    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 120 },
      rngSeed: 0xc0ffee,
    });
    leaf.tick(h.ctx);
    // RNG was never advanced — first call still returns baseline.
    expect(h.ctx.rng.next()).toBe(baseline);
  });

  it('produces identical results across two same-seeded harnesses', () => {
    const leafA = new RangedAttackLeaf();
    const leafB = new RangedAttackLeaf();
    const ha = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 120 },
      rngSeed: 0xfeedface,
    });
    const hb = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 120 },
      rngSeed: 0xfeedface,
    });

    for (let i = 0; i < 100; i += 1) {
      ha.emits.length = 0;
      hb.emits.length = 0;
      expect(leafA.tick(ha.ctx)).toBe(leafB.tick(hb.ctx));
      expect(ha.emits).toEqual(hb.emits);
    }
  });
});

describe('RangedAttackLeaf — exposed defaults', () => {
  it('DEFAULT_RANGED_MIN_RANGE_PX is positive and finite', () => {
    expect(DEFAULT_RANGED_MIN_RANGE_PX).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_RANGED_MIN_RANGE_PX)).toBe(true);
  });

  it('DEFAULT_RANGED_MAX_RANGE_PX is greater than DEFAULT_RANGED_MIN_RANGE_PX', () => {
    expect(DEFAULT_RANGED_MAX_RANGE_PX).toBeGreaterThan(
      DEFAULT_RANGED_MIN_RANGE_PX,
    );
  });

  it('DEFAULT_RANGED_SKIP_STATE_LABELS includes shielding and dodging', () => {
    expect(DEFAULT_RANGED_SKIP_STATE_LABELS).toContain('shielding');
    expect(DEFAULT_RANGED_SKIP_STATE_LABELS).toContain('dodging');
  });

  it('DEFAULT_RANGED_SKIP_STATE_LABELS is frozen', () => {
    expect(Object.isFrozen(DEFAULT_RANGED_SKIP_STATE_LABELS)).toBe(true);
  });
});
