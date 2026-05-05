import { describe, expect, it } from 'vitest';

import { Blackboard } from '../behaviorTree/Blackboard';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';

import {
  DEFAULT_MEDIUM_SHIELD_CHANCE,
  DEFAULT_SHIELD_RANGE_PX,
  DEFAULT_THREAT_STATE_LABELS,
  ShieldThreatLeaf,
} from './ShieldThreatLeaf';
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
  distance: 30,
  damagePercent: 0,
  stateLabel: 'attacking',
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

describe('ShieldThreatLeaf — constructor validation', () => {
  it('accepts default options', () => {
    const leaf = new ShieldThreatLeaf();
    expect(leaf.getShieldRangePx()).toBe(DEFAULT_SHIELD_RANGE_PX);
    expect(leaf.getShieldChance()).toBe(DEFAULT_MEDIUM_SHIELD_CHANCE);
    expect(leaf.getComboStepId()).toBe('medium.shield');
    expect(leaf.getThreatStateLabels()).toEqual(['attacking']);
  });

  it('accepts overrides for every option', () => {
    const leaf = new ShieldThreatLeaf({
      shieldRangePx: 120,
      shieldChance: 0.95,
      threatStateLabels: ['attacking', 'dodging'],
      comboStepId: 'custom.shield',
    });
    expect(leaf.getShieldRangePx()).toBe(120);
    expect(leaf.getShieldChance()).toBe(0.95);
    expect(leaf.getComboStepId()).toBe('custom.shield');
    expect([...leaf.getThreatStateLabels()].sort()).toEqual(
      ['attacking', 'dodging'].sort(),
    );
  });

  it('rejects non-positive shieldRangePx', () => {
    expect(() => new ShieldThreatLeaf({ shieldRangePx: 0 })).toThrow();
    expect(() => new ShieldThreatLeaf({ shieldRangePx: -10 })).toThrow();
    expect(() => new ShieldThreatLeaf({ shieldRangePx: NaN })).toThrow();
  });

  it('rejects shieldChance outside [0, 1]', () => {
    expect(() => new ShieldThreatLeaf({ shieldChance: -0.1 })).toThrow();
    expect(() => new ShieldThreatLeaf({ shieldChance: 1.1 })).toThrow();
    expect(() => new ShieldThreatLeaf({ shieldChance: NaN })).toThrow();
  });

  it('accepts boundary shieldChance values 0 and 1', () => {
    expect(() => new ShieldThreatLeaf({ shieldChance: 0 })).not.toThrow();
    expect(() => new ShieldThreatLeaf({ shieldChance: 1 })).not.toThrow();
  });

  it('rejects empty threatStateLabels', () => {
    expect(
      () => new ShieldThreatLeaf({ threatStateLabels: [] }),
    ).toThrow();
  });
});

describe('ShieldThreatLeaf — gating', () => {
  it('returns Failure with no opponent', () => {
    const leaf = new ShieldThreatLeaf({ shieldChance: 1 });
    const h = makeHarness({ initialOpponent: null });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when opponent is out of shield range', () => {
    const leaf = new ShieldThreatLeaf({
      shieldRangePx: 90,
      shieldChance: 1,
    });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 200 },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when opponent state is not in threat list', () => {
    const leaf = new ShieldThreatLeaf({ shieldChance: 1 });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 50,
        stateLabel: 'idle',
      },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('emits shield when threat is in range and the dice favour the bot', () => {
    // shieldChance = 1 → always blocks when gates open
    const leaf = new ShieldThreatLeaf({ shieldChance: 1 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 50 },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'shield', comboStepId: 'medium.shield' }]);
  });

  it('shield range covers absolute distance — blocks left-side opponents too', () => {
    const leaf = new ShieldThreatLeaf({ shieldChance: 1 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: -50 },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'shield', comboStepId: 'medium.shield' }]);
  });
});

describe('ShieldThreatLeaf — probabilistic gate', () => {
  it('shieldChance = 0 always Fails (leaf disabled)', () => {
    const leaf = new ShieldThreatLeaf({ shieldChance: 0 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 50 },
      rngSeed: 0xc0ffee,
    });
    for (let i = 0; i < 50; i += 1) {
      h.emits.length = 0;
      expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
      expect(h.emits).toEqual([]);
    }
  });

  it('roughly blocks shieldChance fraction of threats over a long sample', () => {
    const leaf = new ShieldThreatLeaf({ shieldChance: 0.7 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 50 },
      rngSeed: 0xfeedface,
    });

    let blockCount = 0;
    const N = 5000;
    for (let i = 0; i < N; i += 1) {
      h.emits.length = 0;
      const status = leaf.tick(h.ctx);
      if (status === NodeStatus.Success) {
        blockCount += 1;
        expect(h.emits).toEqual([
          { kind: 'shield', comboStepId: 'medium.shield' },
        ]);
      } else {
        expect(h.emits).toEqual([]);
      }
    }

    // Expected ≈ 3500. Allow a generous ±15 % band for RNG noise.
    expect(blockCount).toBeGreaterThan(N * 0.6);
    expect(blockCount).toBeLessThan(N * 0.8);
  });

  it('does NOT consume RNG when gates are closed', () => {
    // If the leaf early-Fails (no opponent / out of range / wrong state)
    // it must NOT consume an RNG value — otherwise replay determinism
    // breaks when the opponent state varies.
    const leaf = new ShieldThreatLeaf({ shieldChance: 1 });
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 50,
        stateLabel: 'idle', // not a threat
      },
      rngSeed: 0xc0ffee,
    });
    const before = h.ctx.rng.next();
    // Reset to put us at the same-seed state for the actual leaf tick.
    const fresh = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 50,
        stateLabel: 'idle',
      },
      rngSeed: 0xc0ffee,
    });
    leaf.tick(fresh.ctx);
    // After leaf tick, the next() call should still produce the same
    // value as `before` (the leaf did not advance the RNG).
    const after = fresh.ctx.rng.next();
    expect(after).toBe(before);
  });

  it('DOES consume RNG when gates are open', () => {
    const leaf = new ShieldThreatLeaf({ shieldChance: 0.5 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 50 },
      rngSeed: 0xc0ffee,
    });

    // Capture what the first RNG call would produce.
    const baseline = makeHarness({ rngSeed: 0xc0ffee }).ctx.rng.next();

    leaf.tick(h.ctx);
    // The leaf should have consumed exactly the first roll. So the
    // *next* call returns the *second* RNG value, NOT the baseline.
    const next = h.ctx.rng.next();
    expect(next).not.toBe(baseline);
  });
});

describe('ShieldThreatLeaf — custom threat labels', () => {
  it('blocks against `dodging` opponents when configured', () => {
    const leaf = new ShieldThreatLeaf({
      shieldChance: 1,
      threatStateLabels: ['attacking', 'dodging'],
    });

    // Confirm dodging state triggers a block.
    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 50,
        stateLabel: 'dodging',
      },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'shield', comboStepId: 'medium.shield' }]);

    // And recovering still does NOT trigger.
    h.emits.length = 0;
    h.setOpponent({
      ...DEFAULT_OPPONENT,
      distance: 50,
      stateLabel: 'recovering',
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('iterates every OpponentStateLabel and only fires on configured ones', () => {
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

    const leaf = new ShieldThreatLeaf({
      shieldChance: 1,
      threatStateLabels: ['attacking'],
    });

    for (const label of allLabels) {
      const h = makeHarness({
        initialOpponent: {
          ...DEFAULT_OPPONENT,
          distance: 50,
          stateLabel: label,
        },
      });
      const status = leaf.tick(h.ctx);
      if (label === 'attacking') {
        expect(status).toBe(NodeStatus.Success);
        expect(h.emits).toEqual([
          { kind: 'shield', comboStepId: 'medium.shield' },
        ]);
      } else {
        expect(status).toBe(NodeStatus.Failure);
        expect(h.emits).toEqual([]);
      }
    }
  });
});

describe('ShieldThreatLeaf — determinism', () => {
  it('produces identical block decisions across two same-seeded harnesses', () => {
    const leafA = new ShieldThreatLeaf({ shieldChance: 0.5 });
    const leafB = new ShieldThreatLeaf({ shieldChance: 0.5 });
    const ha = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 50 },
      rngSeed: 0xfeedface,
    });
    const hb = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 50 },
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

describe('ShieldThreatLeaf — exposed defaults', () => {
  it('DEFAULT_SHIELD_RANGE_PX is positive and finite', () => {
    expect(DEFAULT_SHIELD_RANGE_PX).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_SHIELD_RANGE_PX)).toBe(true);
  });

  it('DEFAULT_MEDIUM_SHIELD_CHANCE sits in (0, 1) — not deterministic', () => {
    // Must be probabilistic — Medium is "balanced" not "perfect".
    expect(DEFAULT_MEDIUM_SHIELD_CHANCE).toBeGreaterThan(0);
    expect(DEFAULT_MEDIUM_SHIELD_CHANCE).toBeLessThan(1);
  });

  it('DEFAULT_THREAT_STATE_LABELS includes attacking', () => {
    expect(DEFAULT_THREAT_STATE_LABELS).toContain('attacking');
  });

  it('DEFAULT_THREAT_STATE_LABELS is frozen', () => {
    expect(Object.isFrozen(DEFAULT_THREAT_STATE_LABELS)).toBe(true);
  });
});
