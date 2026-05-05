import { describe, expect, it } from 'vitest';
import { Blackboard } from '../behaviorTree/Blackboard';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';
import {
  DEFAULT_EASY_WANDER_CHANCE,
  WanderLeaf,
} from './WanderLeaf';
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

describe('WanderLeaf — construction', () => {
  it('uses the default wander chance when none is supplied', () => {
    const leaf = new WanderLeaf();
    expect(leaf.getWanderChance()).toBe(DEFAULT_EASY_WANDER_CHANCE);
  });

  it('honours an explicit wander chance', () => {
    expect(new WanderLeaf({ wanderChance: 0.7 }).getWanderChance()).toBe(0.7);
  });

  it('uses a default comboStepId of `easy.wander`', () => {
    expect(new WanderLeaf().getComboStepId()).toBe('easy.wander');
  });

  it('honours an explicit comboStepId override', () => {
    expect(
      new WanderLeaf({ comboStepId: 'medium.wander' }).getComboStepId(),
    ).toBe('medium.wander');
  });

  it('throws when wanderChance is below 0', () => {
    expect(() => new WanderLeaf({ wanderChance: -0.1 })).toThrow(
      /wanderChance must be in \[0, 1\]/,
    );
  });

  it('throws when wanderChance is above 1', () => {
    expect(() => new WanderLeaf({ wanderChance: 1.1 })).toThrow(
      /wanderChance must be in \[0, 1\]/,
    );
  });

  it('throws on NaN wander chance', () => {
    expect(() => new WanderLeaf({ wanderChance: NaN })).toThrow(
      /wanderChance must be in \[0, 1\]/,
    );
  });

  it('throws on Infinity wander chance', () => {
    expect(() => new WanderLeaf({ wanderChance: Infinity })).toThrow(
      /wanderChance must be in \[0, 1\]/,
    );
  });

  it('accepts the boundary values 0 and 1', () => {
    expect(new WanderLeaf({ wanderChance: 0 }).getWanderChance()).toBe(0);
    expect(new WanderLeaf({ wanderChance: 1 }).getWanderChance()).toBe(1);
  });
});

describe('WanderLeaf — tick behaviour', () => {
  it('emits a movement and returns Success when the wander roll passes', () => {
    // wanderChance = 1 → every tick wanders, regardless of RNG.
    const leaf = new WanderLeaf({ wanderChance: 1 });
    const h = makeHarness();

    const status = leaf.tick(h.ctx);
    expect(status).toBe(NodeStatus.Success);
    expect(h.emits).toHaveLength(1);
    expect(h.emits[0]!.kind).toMatch(/^move(Left|Right)$/);
    expect(h.emits[0]!.comboStepId).toBe('easy.wander');
  });

  it('returns Failure without emitting when the wander roll fails', () => {
    // wanderChance = 0 → never wanders.
    const leaf = new WanderLeaf({ wanderChance: 0 });
    const h = makeHarness();

    const status = leaf.tick(h.ctx);
    expect(status).toBe(NodeStatus.Failure);
    expect(h.emits).toHaveLength(0);
  });

  it('always burns at least one RNG draw on tick', () => {
    // wanderChance = 0 → leaf will Fail, but the spec says it MUST
    // still consume one RNG value so consumption is stable.
    const leaf = new WanderLeaf({ wanderChance: 0 });
    const h = makeHarness();

    const stateBefore = h.ctx.rng.getState();
    leaf.tick(h.ctx);
    const stateAfter = h.ctx.rng.getState();
    expect(stateAfter).not.toBe(stateBefore);
  });

  it('burns a second RNG draw when the wander succeeds (direction pick)', () => {
    const leaf = new WanderLeaf({ wanderChance: 1 });
    const successH = makeHarness({ rngSeed: 1 });
    leaf.tick(successH.ctx);
    const successConsumption = successH.ctx.rng.getState();

    // Same seed, but a Failure case (wanderChance = 0) — should
    // burn exactly ONE draw, leaving the RNG in a different state
    // than the success case.
    const failLeaf = new WanderLeaf({ wanderChance: 0 });
    const failH = makeHarness({ rngSeed: 1 });
    failLeaf.tick(failH.ctx);
    const failConsumption = failH.ctx.rng.getState();

    // Two-draw vs one-draw consumption diverges.
    expect(successConsumption).not.toBe(failConsumption);
  });

  it('emits both moveLeft and moveRight over many ticks (no bias)', () => {
    // With wanderChance = 1 every tick wanders, picking direction
    // 50/50 by a second RNG draw. Across many ticks the leaf should
    // emit both directions roughly evenly.
    const leaf = new WanderLeaf({ wanderChance: 1 });
    const h = makeHarness({ rngSeed: 0xCAFE });

    const directions = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      h.bumpTick();
      h.emits.length = 0;
      leaf.tick(h.ctx);
      directions.add(h.emits[0]!.kind);
    }
    expect(directions.has('moveLeft')).toBe(true);
    expect(directions.has('moveRight')).toBe(true);
  });

  it('does NOT bias the direction toward the opponent', () => {
    // Even with the opponent very far to the right, the wander leaf
    // emits both moveLeft and moveRight. The "purposeful" gap-close
    // is a separate leaf; this one is intentionally aimless.
    const leaf = new WanderLeaf({ wanderChance: 1 });
    const farRightOpp: OpponentSnapshot = {
      id: 'p2',
      distance: 500,
      damagePercent: 0,
      stateLabel: 'idle',
      isAirborne: false,
    };
    const h = makeHarness({
      rngSeed: 0xBEEF,
      opponent: farRightOpp,
    });

    const dirCounts = { moveLeft: 0, moveRight: 0 };
    for (let i = 0; i < 200; i += 1) {
      h.bumpTick();
      h.emits.length = 0;
      leaf.tick(h.ctx);
      const d = h.emits[0]!.kind;
      if (d === 'moveLeft') dirCounts.moveLeft += 1;
      if (d === 'moveRight') dirCounts.moveRight += 1;
    }
    // Both directions should fire — the opponent's position must
    // not bias the pick.
    expect(dirCounts.moveLeft).toBeGreaterThan(0);
    expect(dirCounts.moveRight).toBeGreaterThan(0);
  });

  it('honours the long-run wander fraction over many ticks', () => {
    const leaf = new WanderLeaf({ wanderChance: 0.25 });
    const h = makeHarness({ rngSeed: 0xC0DE });

    let wanderCount = 0;
    const TOTAL = 4000;
    for (let i = 0; i < TOTAL; i += 1) {
      h.bumpTick();
      h.emits.length = 0;
      const status = leaf.tick(h.ctx);
      if (status === NodeStatus.Success) wanderCount += 1;
    }
    const fraction = wanderCount / TOTAL;
    // 25 % ± 3 % over 4000 trials — well inside the long-run band.
    expect(fraction).toBeGreaterThan(0.22);
    expect(fraction).toBeLessThan(0.28);
  });

  it('wanders even when the bot has no opponent', () => {
    const leaf = new WanderLeaf({ wanderChance: 1 });
    const h = makeHarness({ opponent: null });

    leaf.tick(h.ctx);
    expect(h.emits).toHaveLength(1);
    expect(h.emits[0]!.kind).toMatch(/^move(Left|Right)$/);
  });

  it('wanders even when canAttack is false', () => {
    // The leaf is purely about ambling; it ignores attack gates.
    const leaf = new WanderLeaf({ wanderChance: 1 });
    const h = makeHarness({ self: { canAttack: false } });

    leaf.tick(h.ctx);
    expect(h.emits).toHaveLength(1);
  });

  it('wanders even when the bot is airborne', () => {
    const leaf = new WanderLeaf({ wanderChance: 1 });
    const h = makeHarness({ self: { isAirborne: true } });

    leaf.tick(h.ctx);
    expect(h.emits).toHaveLength(1);
  });

  it('produces deterministic results given the same RNG seed', () => {
    const leaf1 = new WanderLeaf({ wanderChance: 0.5 });
    const leaf2 = new WanderLeaf({ wanderChance: 0.5 });
    const h1 = makeHarness({ rngSeed: 42 });
    const h2 = makeHarness({ rngSeed: 42 });

    const trace1: Array<{ status: NodeStatus; emit?: string }> = [];
    const trace2: Array<{ status: NodeStatus; emit?: string }> = [];

    for (let i = 0; i < 50; i += 1) {
      h1.bumpTick();
      h2.bumpTick();
      h1.emits.length = 0;
      h2.emits.length = 0;
      const s1 = leaf1.tick(h1.ctx);
      const s2 = leaf2.tick(h2.ctx);
      trace1.push({ status: s1, emit: h1.emits[0]?.kind });
      trace2.push({ status: s2, emit: h2.emits[0]?.kind });
    }

    expect(trace2).toEqual(trace1);
  });
});

describe('WanderLeaf — comboStepId tagging', () => {
  it('tags emits with the default comboStepId', () => {
    const leaf = new WanderLeaf({ wanderChance: 1 });
    const h = makeHarness();

    leaf.tick(h.ctx);
    expect(h.emits[0]!.comboStepId).toBe('easy.wander');
  });

  it('tags emits with an explicit comboStepId override', () => {
    const leaf = new WanderLeaf({
      wanderChance: 1,
      comboStepId: 'novice.amble',
    });
    const h = makeHarness();

    leaf.tick(h.ctx);
    expect(h.emits[0]!.comboStepId).toBe('novice.amble');
  });
});
