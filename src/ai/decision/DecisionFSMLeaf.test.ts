import { describe, expect, it, vi } from 'vitest';

import { Blackboard } from '../behaviorTree/Blackboard';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';
import type {
  PerceivedSelf,
  PerceivedStage,
  PerceivedOpponent,
} from '../perception/WorldSnapshot';
import {
  DEFAULT_OFFENSIVE_BLACKBOARD,
  type OffensiveAction,
  type OffensiveBlackboardSchema,
  type OffensiveContext,
  type OpponentSnapshot,
  type SelfSnapshot,
} from '../offensive/types';

import { DecisionFSM } from './DecisionFSM';
import {
  DEFAULT_DECISION_FSM_LEAF_SUCCESS_STATES,
  DecisionFSMLeaf,
  defaultDecisionToOffensiveTranslator,
} from './DecisionFSMLeaf';
import type { DecisionAction, DecisionContext } from './types';

const STAGE: PerceivedStage = {
  stageLeft: 100,
  stageRight: 700,
  stageTop: 400,
  blastZone: { left: 0, right: 800, top: 0, bottom: 600 },
};

function makePerceivedSelf(overrides: Partial<PerceivedSelf> = {}): PerceivedSelf {
  return {
    slotIndex: 0,
    position: { x: 400, y: 380 },
    velocity: { vx: 0, vy: 0 },
    facing: 1,
    damagePercent: 0,
    stocksRemaining: 3,
    isAirborne: false,
    isInHitstun: false,
    isOnLedge: false,
    ...overrides,
  };
}

function makePerceivedOpponent(overrides: Partial<PerceivedOpponent> = {}): PerceivedOpponent {
  return {
    slotIndex: 1,
    position: { x: 440, y: 380 },
    velocity: { vx: 0, vy: 0 },
    facing: -1,
    damagePercent: 0,
    stocksRemaining: 3,
    stateLabel: 'idle',
    isAirborne: false,
    isInvincible: false,
    ...overrides,
  };
}

function makeOffensiveCtx(overrides: {
  opponent?: OpponentSnapshot | null;
  self?: Partial<SelfSnapshot>;
  decisionSelf?: Partial<PerceivedSelf>;
  decisionOpponent?: PerceivedOpponent | null;
  emits?: OffensiveAction[];
  rngSeed?: number;
} = {}): { ctx: OffensiveContext; emits: OffensiveAction[]; decision: DecisionContext } {
  const emits = overrides.emits ?? [];
  const blackboard = new Blackboard<OffensiveBlackboardSchema>({
    ...DEFAULT_OFFENSIVE_BLACKBOARD,
  });
  const opponent: OpponentSnapshot | null =
    overrides.opponent === undefined
      ? {
          id: 'p2',
          distance: 40,
          damagePercent: 0,
          stateLabel: 'idle',
          isAirborne: false,
        }
      : overrides.opponent;
  const self: SelfSnapshot = {
    facing: 1,
    canAttack: true,
    isAirborne: false,
    damagePercent: 0,
    ...overrides.self,
  };
  const ctx: OffensiveContext = {
    blackboard,
    tickIndex: 0,
    opponent,
    self,
    out: { emit: (a) => emits.push(a) },
    rng: new Rng(overrides.rngSeed ?? 1),
  };

  const decisionCtx: DecisionContext = {
    self: makePerceivedSelf(overrides.decisionSelf),
    opponent:
      overrides.decisionOpponent === undefined
        ? makePerceivedOpponent()
        : overrides.decisionOpponent,
    stage: STAGE,
    tickIndex: 0,
    rng: ctx.rng,
  };

  return { ctx, emits, decision: decisionCtx };
}

describe('defaultDecisionToOffensiveTranslator', () => {
  const cases: Array<[DecisionAction['kind'], boolean]> = [
    ['idle', true],
    ['moveLeft', true],
    ['moveRight', true],
    ['jab', true],
    ['tilt', true],
    ['smash', true],
    ['special', true],
    ['shield', true],
    ['dodge', true],
    ['jump', false],
    ['upSpecial', false],
    ['dropThrough', false],
  ];

  for (const [kind, mappable] of cases) {
    it(`${kind} → ${mappable ? 'mapped' : 'dropped'}`, () => {
      const action: DecisionAction = { kind, state: 'attack' };
      const result = defaultDecisionToOffensiveTranslator(action);
      if (mappable) {
        expect(result).not.toBeNull();
        expect(result!.kind).toBe(kind);
      } else {
        expect(result).toBeNull();
      }
    });
  }

  it('uses note as comboStepId when present', () => {
    const result = defaultDecisionToOffensiveTranslator({
      kind: 'jab',
      state: 'attack',
      note: 'meleeLow',
    });
    expect(result?.comboStepId).toBe('meleeLow');
  });

  it('falls back to state name as comboStepId when note absent', () => {
    const result = defaultDecisionToOffensiveTranslator({
      kind: 'shield',
      state: 'defend',
    });
    expect(result?.comboStepId).toBe('defend');
  });
});

describe('DecisionFSMLeaf basic behaviour', () => {
  it('returns Failure when FSM resolves to approach (default success states)', () => {
    const { ctx, emits, decision } = makeOffensiveCtx();
    const fsm = new DecisionFSM();
    const leaf = new DecisionFSMLeaf<OffensiveContext>({
      fsm,
      project: () => ({
        ...decision,
        self: makePerceivedSelf({ position: { x: 400, y: 380 } }),
        opponent: makePerceivedOpponent({ position: { x: 700, y: 380 } }),
      }),
    });
    // Status contract: approach → Failure so an enclosing Selector
    // can fall through to a sibling branch.
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
    // ...but the approach state's movement verb still flows through the
    // translator into the host's `out` writer, so a downstream consumer
    // can still see "FSM wants to walk right" even though the leaf
    // surface is Failure.
    expect(emits.length).toBeGreaterThan(0);
    expect(emits[0]?.kind).toBe('moveRight');
  });

  it('emits offensive verbs when in attack state', () => {
    const { ctx, emits } = makeOffensiveCtx();
    const fsm = new DecisionFSM();
    const leaf = new DecisionFSMLeaf<OffensiveContext>({
      fsm,
      project: () => ({
        self: makePerceivedSelf({ position: { x: 400, y: 380 } }),
        opponent: makePerceivedOpponent({ position: { x: 440, y: 380 }, damagePercent: 30 }),
        stage: STAGE,
        tickIndex: 0,
        rng: ctx.rng,
      }),
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Success);
    const kinds = emits.map((e) => e.kind);
    expect(kinds).toContain('jab');
  });

  it('returns Success in defend state and emits shield', () => {
    const { ctx, emits } = makeOffensiveCtx();
    const fsm = new DecisionFSM({ moveSelection: { dodgeChance: 0 } });
    const leaf = new DecisionFSMLeaf<OffensiveContext>({
      fsm,
      project: () => ({
        self: makePerceivedSelf(),
        opponent: makePerceivedOpponent({
          position: { x: 440, y: 380 },
          stateLabel: 'attacking',
        }),
        stage: STAGE,
        tickIndex: 0,
        rng: ctx.rng,
      }),
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Success);
    expect(emits.map((e) => e.kind)).toContain('shield');
  });

  it('drops recovery-only verbs (jump, upSpecial) under default translator', () => {
    const { ctx, emits } = makeOffensiveCtx();
    const fsm = new DecisionFSM();
    const leaf = new DecisionFSMLeaf<OffensiveContext>({
      fsm,
      project: () => ({
        self: makePerceivedSelf({ position: { x: 60, y: 500 }, isAirborne: true }),
        opponent: null,
        stage: STAGE,
        tickIndex: 0,
        rng: ctx.rng,
      }),
    });
    expect(leaf.tick(ctx)).toBe(NodeStatus.Success); // recover IS in success states
    // Default translator drops upSpecial; movement (moveRight) flows through.
    expect(emits.map((e) => e.kind)).not.toContain('upSpecial' as never);
    expect(emits.map((e) => e.kind)).not.toContain('jump' as never);
    expect(emits.map((e) => e.kind)).toContain('moveRight');
  });

  it('uses a custom translator to map upSpecial through to a sink', () => {
    const { ctx } = makeOffensiveCtx();
    const auxSink: DecisionAction[] = [];
    const fsm = new DecisionFSM();

    // Custom translator: capture all verbs (including upSpecial) into
    // an aux sink and never forward to the offensive writer.
    const leaf = new DecisionFSMLeaf<OffensiveContext>({
      fsm,
      project: () => ({
        self: makePerceivedSelf({ position: { x: 60, y: 500 }, isAirborne: true }),
        opponent: null,
        stage: STAGE,
        tickIndex: 0,
        rng: ctx.rng,
      }),
      translate: (action) => {
        auxSink.push(action);
        return null;
      },
    });
    leaf.tick(ctx);
    expect(auxSink.map((a) => a.kind)).toContain('upSpecial');
    expect(auxSink.map((a) => a.kind)).toContain('moveRight');
  });

  it('cascades reset into the wrapped FSM', () => {
    const { ctx } = makeOffensiveCtx();
    const fsm = new DecisionFSM();
    const leaf = new DecisionFSMLeaf<OffensiveContext>({
      fsm,
      project: () => ({
        self: makePerceivedSelf(),
        opponent: makePerceivedOpponent({ position: { x: 440, y: 380 } }),
        stage: STAGE,
        tickIndex: 0,
        rng: ctx.rng,
      }),
    });
    leaf.tick(ctx);
    expect(fsm.getCurrentState()).not.toBeNull();
    expect(fsm.getTickCount()).toBe(1);
    leaf.reset();
    expect(fsm.getCurrentState()).toBeNull();
    expect(fsm.getTickCount()).toBe(0);
  });

  it('successWhenStates override changes the leaf-status contract', () => {
    const { ctx } = makeOffensiveCtx();
    const fsm = new DecisionFSM();
    // Configure leaf so only `defend` returns Success.
    const leaf = new DecisionFSMLeaf<OffensiveContext>({
      fsm,
      project: () => ({
        self: makePerceivedSelf(),
        opponent: makePerceivedOpponent({ position: { x: 440, y: 380 } }),
        stage: STAGE,
        tickIndex: 0,
        rng: ctx.rng,
      }),
      successWhenStates: new Set(['defend']),
    });
    // Attack state → Failure under this override
    expect(leaf.tick(ctx)).toBe(NodeStatus.Failure);
  });

  it('defaultSuccessStates excludes approach', () => {
    expect(DEFAULT_DECISION_FSM_LEAF_SUCCESS_STATES.has('approach')).toBe(false);
    expect(DEFAULT_DECISION_FSM_LEAF_SUCCESS_STATES.has('attack')).toBe(true);
    expect(DEFAULT_DECISION_FSM_LEAF_SUCCESS_STATES.has('defend')).toBe(true);
    expect(DEFAULT_DECISION_FSM_LEAF_SUCCESS_STATES.has('recover')).toBe(true);
    expect(DEFAULT_DECISION_FSM_LEAF_SUCCESS_STATES.has('retreat')).toBe(true);
  });

  it('exposes the wrapped FSM via getFsm()', () => {
    const fsm = new DecisionFSM({ name: 'wrapped' });
    const leaf = new DecisionFSMLeaf<OffensiveContext>({
      fsm,
      project: () => ({
        self: makePerceivedSelf(),
        opponent: null,
        stage: STAGE,
        tickIndex: 0,
        rng: new Rng(1),
      }),
    });
    expect(leaf.getFsm()).toBe(fsm);
  });

  it('silently drops emits when host context lacks an out writer', () => {
    const fsm = new DecisionFSM();
    // Create a malformed context (no `out`) — leaf must not throw.
    const malformedCtx = {
      blackboard: new Blackboard<OffensiveBlackboardSchema>({ ...DEFAULT_OFFENSIVE_BLACKBOARD }),
      tickIndex: 0,
      opponent: null,
      self: { facing: 1, canAttack: true, isAirborne: false, damagePercent: 0 },
      rng: new Rng(1),
    } as unknown as OffensiveContext;
    const leaf = new DecisionFSMLeaf<OffensiveContext>({
      fsm,
      project: () => ({
        self: makePerceivedSelf(),
        opponent: makePerceivedOpponent({ position: { x: 440, y: 380 } }),
        stage: STAGE,
        tickIndex: 0,
        rng: new Rng(1),
      }),
    });
    expect(() => leaf.tick(malformedCtx)).not.toThrow();
  });

  it('forwards translated emits to the host out writer with state-aware comboStepId', () => {
    const { ctx, emits } = makeOffensiveCtx();
    const fsm = new DecisionFSM();
    const leaf = new DecisionFSMLeaf<OffensiveContext>({
      fsm,
      project: () => ({
        self: makePerceivedSelf({ position: { x: 400, y: 380 } }),
        opponent: makePerceivedOpponent({ position: { x: 440, y: 380 }, damagePercent: 30 }),
        stage: STAGE,
        tickIndex: 0,
        rng: ctx.rng,
      }),
    });
    leaf.tick(ctx);
    const jabEmit = emits.find((e) => e.kind === 'jab');
    expect(jabEmit).toBeDefined();
    expect(jabEmit?.comboStepId).toBe('meleeLow');
  });
});

describe('DecisionFSMLeaf with custom project', () => {
  it('uses the project callback to derive context per tick', () => {
    const { ctx } = makeOffensiveCtx();
    const project = vi.fn((ctx: OffensiveContext): DecisionContext => ({
      self: makePerceivedSelf(),
      opponent: null,
      stage: STAGE,
      tickIndex: ctx.tickIndex,
      rng: ctx.rng,
    }));
    const leaf = new DecisionFSMLeaf<OffensiveContext>({
      fsm: new DecisionFSM(),
      project,
    });
    leaf.tick(ctx);
    expect(project).toHaveBeenCalledWith(ctx);
  });
});
