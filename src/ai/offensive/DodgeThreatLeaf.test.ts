import { describe, expect, it } from 'vitest';

import { Blackboard } from '../behaviorTree/Blackboard';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';

import {
  DEFAULT_DODGE_RANGE_PX,
  DEFAULT_DODGE_THREAT_STATE_LABELS,
  DEFAULT_MEDIUM_DODGE_CHANCE,
  DodgeThreatLeaf,
} from './DodgeThreatLeaf';
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

describe('DodgeThreatLeaf — constructor validation', () => {
  it('accepts default options', () => {
    const leaf = new DodgeThreatLeaf();
    expect(leaf.getDodgeRangePx()).toBe(DEFAULT_DODGE_RANGE_PX);
    expect(leaf.getDodgeChance()).toBe(DEFAULT_MEDIUM_DODGE_CHANCE);
    expect(leaf.getComboStepId()).toBe('medium.dodge');
    expect(leaf.getThreatStateLabels()).toEqual(['attacking']);
  });

  it('accepts overrides for every option', () => {
    const leaf = new DodgeThreatLeaf({
      dodgeRangePx: 100,
      dodgeChance: 0.5,
      threatStateLabels: ['attacking', 'shielding'],
      comboStepId: 'custom.dodge',
    });
    expect(leaf.getDodgeRangePx()).toBe(100);
    expect(leaf.getDodgeChance()).toBe(0.5);
    expect(leaf.getComboStepId()).toBe('custom.dodge');
    expect([...leaf.getThreatStateLabels()].sort()).toEqual(
      ['attacking', 'shielding'].sort(),
    );
  });

  it('rejects non-positive dodgeRangePx', () => {
    expect(() => new DodgeThreatLeaf({ dodgeRangePx: 0 })).toThrow();
    expect(() => new DodgeThreatLeaf({ dodgeRangePx: -10 })).toThrow();
    expect(() => new DodgeThreatLeaf({ dodgeRangePx: NaN })).toThrow();
  });

  it('rejects dodgeChance outside [0, 1]', () => {
    expect(() => new DodgeThreatLeaf({ dodgeChance: -0.1 })).toThrow();
    expect(() => new DodgeThreatLeaf({ dodgeChance: 1.1 })).toThrow();
    expect(() => new DodgeThreatLeaf({ dodgeChance: NaN })).toThrow();
  });

  it('accepts boundary dodgeChance values 0 and 1', () => {
    expect(() => new DodgeThreatLeaf({ dodgeChance: 0 })).not.toThrow();
    expect(() => new DodgeThreatLeaf({ dodgeChance: 1 })).not.toThrow();
  });

  it('rejects empty threatStateLabels', () => {
    expect(
      () => new DodgeThreatLeaf({ threatStateLabels: [] }),
    ).toThrow();
  });
});

describe('DodgeThreatLeaf — gating', () => {
  it('returns Failure with no opponent', () => {
    const leaf = new DodgeThreatLeaf({ dodgeChance: 1 });
    const h = makeHarness({ initialOpponent: null });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when opponent is out of dodge range', () => {
    const leaf = new DodgeThreatLeaf({
      dodgeRangePx: 70,
      dodgeChance: 1,
    });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 200 },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when opponent state is not in threat list', () => {
    const leaf = new DodgeThreatLeaf({ dodgeChance: 1 });
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

  it('emits dodge when threat is in range and the dice favour the bot', () => {
    // dodgeChance = 1 → always dodges when gates open
    const leaf = new DodgeThreatLeaf({ dodgeChance: 1 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 50 },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'dodge', comboStepId: 'medium.dodge' }]);
  });

  it('dodge range covers absolute distance — evades left-side opponents too', () => {
    const leaf = new DodgeThreatLeaf({ dodgeChance: 1 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: -50 },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'dodge', comboStepId: 'medium.dodge' }]);
  });
});

describe('DodgeThreatLeaf — probabilistic gate', () => {
  it('dodgeChance = 0 always Fails (leaf disabled) and burns no RNG', () => {
    const leaf = new DodgeThreatLeaf({ dodgeChance: 0 });
    const fresh = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 50 },
      rngSeed: 0xc0ffee,
    });
    const baseline = makeHarness({ rngSeed: 0xc0ffee }).ctx.rng.next();

    for (let i = 0; i < 50; i += 1) {
      fresh.emits.length = 0;
      expect(leaf.tick(fresh.ctx)).toBe(NodeStatus.Failure);
      expect(fresh.emits).toEqual([]);
    }
    // RNG was never advanced — first call still returns the baseline.
    expect(fresh.ctx.rng.next()).toBe(baseline);
  });

  it('roughly dodges dodgeChance fraction of threats over a long sample', () => {
    const leaf = new DodgeThreatLeaf({ dodgeChance: 0.2 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 50 },
      rngSeed: 0xfeedface,
    });

    let dodgeCount = 0;
    const N = 5000;
    for (let i = 0; i < N; i += 1) {
      h.emits.length = 0;
      const status = leaf.tick(h.ctx);
      if (status === NodeStatus.Success) {
        dodgeCount += 1;
        expect(h.emits).toEqual([
          { kind: 'dodge', comboStepId: 'medium.dodge' },
        ]);
      } else {
        expect(h.emits).toEqual([]);
      }
    }

    // Expected ≈ 1000. Allow ±5 percentage-point band for RNG noise.
    expect(dodgeCount).toBeGreaterThan(N * 0.15);
    expect(dodgeCount).toBeLessThan(N * 0.25);
  });

  it('does NOT consume RNG when gates are closed', () => {
    const leaf = new DodgeThreatLeaf({ dodgeChance: 1 });
    const baseline = makeHarness({ rngSeed: 0xc0ffee }).ctx.rng.next();

    const fresh = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 50,
        stateLabel: 'idle', // not a threat
      },
      rngSeed: 0xc0ffee,
    });
    leaf.tick(fresh.ctx);
    // After leaf tick, the next() call should still produce the same
    // value as the baseline (the leaf did not advance the RNG).
    expect(fresh.ctx.rng.next()).toBe(baseline);
  });

  it('DOES consume RNG when gates are open', () => {
    const leaf = new DodgeThreatLeaf({ dodgeChance: 0.5 });
    const h = makeHarness({
      initialOpponent: { ...DEFAULT_OPPONENT, distance: 50 },
      rngSeed: 0xc0ffee,
    });
    const baseline = makeHarness({ rngSeed: 0xc0ffee }).ctx.rng.next();

    leaf.tick(h.ctx);
    // The leaf should have consumed exactly the first roll. The next
    // call returns the *second* RNG value, NOT the baseline.
    const next = h.ctx.rng.next();
    expect(next).not.toBe(baseline);
  });
});

describe('DodgeThreatLeaf — custom threat labels', () => {
  it('evades against `shielding` opponents when configured', () => {
    const leaf = new DodgeThreatLeaf({
      dodgeChance: 1,
      threatStateLabels: ['attacking', 'shielding'],
    });

    const h = makeHarness({
      initialOpponent: {
        ...DEFAULT_OPPONENT,
        distance: 50,
        stateLabel: 'shielding',
      },
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([{ kind: 'dodge', comboStepId: 'medium.dodge' }]);

    // recovering still does NOT trigger.
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

    const leaf = new DodgeThreatLeaf({
      dodgeChance: 1,
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
          { kind: 'dodge', comboStepId: 'medium.dodge' },
        ]);
      } else {
        expect(status).toBe(NodeStatus.Failure);
        expect(h.emits).toEqual([]);
      }
    }
  });
});

describe('DodgeThreatLeaf — determinism', () => {
  it('produces identical dodge decisions across two same-seeded harnesses', () => {
    const leafA = new DodgeThreatLeaf({ dodgeChance: 0.3 });
    const leafB = new DodgeThreatLeaf({ dodgeChance: 0.3 });
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

describe('DodgeThreatLeaf — exposed defaults', () => {
  it('DEFAULT_DODGE_RANGE_PX is positive and finite', () => {
    expect(DEFAULT_DODGE_RANGE_PX).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_DODGE_RANGE_PX)).toBe(true);
  });

  it('DEFAULT_MEDIUM_DODGE_CHANCE sits in (0, 1) — not deterministic', () => {
    // Must be probabilistic — Medium is "balanced" not "perfect".
    expect(DEFAULT_MEDIUM_DODGE_CHANCE).toBeGreaterThan(0);
    expect(DEFAULT_MEDIUM_DODGE_CHANCE).toBeLessThan(1);
  });

  it('DEFAULT_MEDIUM_DODGE_CHANCE is lower than DEFAULT_MEDIUM_SHIELD_CHANCE', async () => {
    const { DEFAULT_MEDIUM_SHIELD_CHANCE } = await import('./ShieldThreatLeaf');
    // Dodge is the lower-frequency mix-in; shield is the primary
    // defensive verb. The shield rate should dominate so the bot reads
    // as "blocks reliably and occasionally evades", not "always
    // dodges".
    expect(DEFAULT_MEDIUM_DODGE_CHANCE).toBeLessThan(
      DEFAULT_MEDIUM_SHIELD_CHANCE,
    );
  });

  it('DEFAULT_DODGE_THREAT_STATE_LABELS includes attacking', () => {
    expect(DEFAULT_DODGE_THREAT_STATE_LABELS).toContain('attacking');
  });

  it('DEFAULT_DODGE_THREAT_STATE_LABELS is frozen', () => {
    expect(Object.isFrozen(DEFAULT_DODGE_THREAT_STATE_LABELS)).toBe(true);
  });
});
