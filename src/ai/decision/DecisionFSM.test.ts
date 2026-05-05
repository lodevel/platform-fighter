import { describe, expect, it, vi } from 'vitest';

import { Rng } from '../../utils/Rng';
import type {
  PerceivedOpponent,
  PerceivedSelf,
  PerceivedStage,
} from '../perception/WorldSnapshot';

import { DecisionFSM, recordingDecisionWriter } from './DecisionFSM';
import type {
  DecisionAction,
  DecisionContext,
  DecisionState,
} from './types';

const STAGE: PerceivedStage = {
  stageLeft: 100,
  stageRight: 700,
  stageTop: 400,
  blastZone: { left: 0, right: 800, top: 0, bottom: 600 },
};

function makeSelf(overrides: Partial<PerceivedSelf> = {}): PerceivedSelf {
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

function makeOpponent(overrides: Partial<PerceivedOpponent> = {}): PerceivedOpponent {
  return {
    slotIndex: 1,
    position: { x: 500, y: 380 },
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

function makeCtx(overrides: {
  self?: Partial<PerceivedSelf>;
  opponent?: PerceivedOpponent | null;
  stage?: PerceivedStage;
  tickIndex?: number;
  rngSeed?: number;
} = {}): DecisionContext {
  return {
    self: makeSelf(overrides.self),
    opponent:
      overrides.opponent === undefined ? makeOpponent() : overrides.opponent,
    stage: overrides.stage ?? STAGE,
    tickIndex: overrides.tickIndex ?? 0,
    rng: new Rng(overrides.rngSeed ?? 1),
  };
}

describe('DecisionFSM construction', () => {
  it('starts with null current state and zero ticks', () => {
    const fsm = new DecisionFSM();
    expect(fsm.getCurrentState()).toBeNull();
    expect(fsm.getTickCount()).toBe(0);
    expect(fsm.getLastEmitCount()).toBe(0);
  });

  it('accepts a debug name', () => {
    const fsm = new DecisionFSM({ name: 'bot.slot1' });
    expect(fsm.name).toBe('bot.slot1');
  });

  it('resolves and exposes its policy and move-selection options', () => {
    const fsm = new DecisionFSM({ policy: { koPercent: 80 } });
    expect(fsm.getResolvedPolicy().koPercent).toBe(80);
    // Move selection should inherit the same KO percent.
    expect(fsm.getResolvedMoveSelection().policy.koPercent).toBe(80);
  });

  it('respects an explicit moveSelection.policy override', () => {
    const fsm = new DecisionFSM({
      policy: { koPercent: 80 },
      moveSelection: { policy: { koPercent: 120 } },
    });
    expect(fsm.getResolvedPolicy().koPercent).toBe(80);
    expect(fsm.getResolvedMoveSelection().policy.koPercent).toBe(120);
  });
});

describe('DecisionFSM tick — basic behaviour', () => {
  it('returns approach for a centered bot with far opponent', () => {
    const fsm = new DecisionFSM();
    const out: DecisionAction[] = [];
    const ctx = makeCtx({
      self: { position: { x: 400, y: 380 } },
      opponent: makeOpponent({ position: { x: 700, y: 380 } }),
    });
    expect(fsm.tick(ctx, recordingDecisionWriter(out))).toBe('approach');
    expect(fsm.getCurrentState()).toBe('approach');
    expect(fsm.getTickCount()).toBe(1);
    expect(out.every((a) => a.state === 'approach')).toBe(true);
  });

  it('returns attack and emits an attack verb in melee', () => {
    const fsm = new DecisionFSM();
    const out: DecisionAction[] = [];
    const ctx = makeCtx({
      opponent: makeOpponent({ position: { x: 440, y: 380 } }),
    });
    expect(fsm.tick(ctx, recordingDecisionWriter(out))).toBe('attack');
    const attackKinds = out.filter((a) => a.state === 'attack').map((a) => a.kind);
    expect(attackKinds.some((k) => ['jab', 'tilt', 'smash', 'special'].includes(k))).toBe(true);
  });

  it('returns recover when off-stage and emits a recovery verb', () => {
    const fsm = new DecisionFSM();
    const out: DecisionAction[] = [];
    const ctx = makeCtx({
      self: { position: { x: 60, y: 500 }, isAirborne: true },
    });
    expect(fsm.tick(ctx, recordingDecisionWriter(out))).toBe('recover');
    const kinds = out.map((a) => a.kind);
    expect(kinds).toContain('upSpecial');
    expect(kinds).toContain('moveRight');
  });

  it('increments tickCount across multiple ticks', () => {
    const fsm = new DecisionFSM();
    const out: DecisionAction[] = [];
    fsm.tick(makeCtx(), recordingDecisionWriter(out));
    fsm.tick(makeCtx({ tickIndex: 1 }), recordingDecisionWriter(out));
    fsm.tick(makeCtx({ tickIndex: 2 }), recordingDecisionWriter(out));
    expect(fsm.getTickCount()).toBe(3);
  });

  it('updates getLastEmitCount per tick', () => {
    const fsm = new DecisionFSM();
    const out: DecisionAction[] = [];
    fsm.tick(makeCtx({ self: { position: { x: 60, y: 500 }, isAirborne: true } }), recordingDecisionWriter(out));
    // recover state emits drift + recovery press = 2
    expect(fsm.getLastEmitCount()).toBe(2);
  });
});

describe('DecisionFSM transition observer', () => {
  it('does not fire on the very first tick', () => {
    const observer = vi.fn();
    const fsm = new DecisionFSM({ onTransition: observer });
    fsm.tick(makeCtx(), recordingDecisionWriter([]));
    expect(observer).not.toHaveBeenCalled();
  });

  it('fires when state changes between ticks', () => {
    const observer = vi.fn();
    const fsm = new DecisionFSM({ onTransition: observer });
    // Tick 1 — approach (opponent far)
    fsm.tick(
      makeCtx({
        self: { position: { x: 400, y: 380 } },
        opponent: makeOpponent({ position: { x: 700, y: 380 } }),
      }),
      recordingDecisionWriter([]),
    );
    // Tick 2 — attack (opponent in tilt range)
    fsm.tick(
      makeCtx({
        self: { position: { x: 400, y: 380 } },
        opponent: makeOpponent({ position: { x: 480, y: 380 } }),
        tickIndex: 1,
      }),
      recordingDecisionWriter([]),
    );
    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith('approach', 'attack', 1);
  });

  it('does not fire when state stays the same across ticks', () => {
    const observer = vi.fn();
    const fsm = new DecisionFSM({ onTransition: observer });
    const out = recordingDecisionWriter([]);
    fsm.tick(makeCtx(), out);
    fsm.tick(makeCtx({ tickIndex: 1 }), out);
    fsm.tick(makeCtx({ tickIndex: 2 }), out);
    // First tick: approach (no observer fire). Subsequent ticks resolve
    // the same state (defend, since opponent is idle in melee → attack
    // — wait, opponent at 500 is in tilt zone, so attack).
    // Let's be specific: with default ctx (opponent at 500, self at 400),
    // chebyshev=100 → tilt zone → attack. All three ticks → attack.
    expect(observer).not.toHaveBeenCalled();
  });

  it('fires with the correct from/to/tickIndex on each transition', () => {
    const events: Array<[DecisionState, DecisionState, number]> = [];
    const fsm = new DecisionFSM({
      onTransition: (from, to, tick) => events.push([from, to, tick]),
    });
    const out = recordingDecisionWriter([]);
    // Tick 0 — far apart → approach
    fsm.tick(
      makeCtx({
        self: { position: { x: 400, y: 380 } },
        opponent: makeOpponent({ position: { x: 700, y: 380 } }),
        tickIndex: 0,
      }),
      out,
    );
    // Tick 1 — opponent in melee → attack
    fsm.tick(
      makeCtx({
        self: { position: { x: 400, y: 380 } },
        opponent: makeOpponent({ position: { x: 440, y: 380 } }),
        tickIndex: 1,
      }),
      out,
    );
    // Tick 2 — opponent attacking in melee → defend
    fsm.tick(
      makeCtx({
        self: { position: { x: 400, y: 380 } },
        opponent: makeOpponent({
          position: { x: 440, y: 380 },
          stateLabel: 'attacking',
        }),
        tickIndex: 2,
      }),
      out,
    );
    expect(events).toEqual([
      ['approach', 'attack', 1],
      ['attack', 'defend', 2],
    ]);
  });
});

describe('DecisionFSM reset', () => {
  it('clears current state, tick count, and emit count', () => {
    const fsm = new DecisionFSM();
    fsm.tick(makeCtx(), recordingDecisionWriter([]));
    expect(fsm.getCurrentState()).not.toBeNull();
    expect(fsm.getTickCount()).toBe(1);
    fsm.reset();
    expect(fsm.getCurrentState()).toBeNull();
    expect(fsm.getTickCount()).toBe(0);
    expect(fsm.getLastEmitCount()).toBe(0);
  });

  it('does not re-fire the transition observer on first post-reset tick', () => {
    const observer = vi.fn();
    const fsm = new DecisionFSM({ onTransition: observer });
    const out = recordingDecisionWriter([]);
    fsm.tick(makeCtx(), out);
    fsm.tick(
      makeCtx({
        opponent: makeOpponent({ position: { x: 700, y: 380 } }),
        tickIndex: 1,
      }),
      out,
    );
    observer.mockClear();
    fsm.reset();
    fsm.tick(makeCtx(), out);
    expect(observer).not.toHaveBeenCalled();
  });

  it('idempotent — reset twice equals reset once', () => {
    const fsm = new DecisionFSM();
    fsm.tick(makeCtx(), recordingDecisionWriter([]));
    fsm.reset();
    const snap1 = fsm.snapshot();
    fsm.reset();
    const snap2 = fsm.snapshot();
    expect(snap1).toEqual(snap2);
  });
});

describe('DecisionFSM determinism', () => {
  it('two FSMs with the same config and same context sequence emit the same actions', () => {
    const buildFsm = () => new DecisionFSM();
    const fsmA = buildFsm();
    const fsmB = buildFsm();
    const a: DecisionAction[] = [];
    const b: DecisionAction[] = [];

    const ctxs = [
      makeCtx({
        self: { position: { x: 400, y: 380 } },
        opponent: makeOpponent({ position: { x: 700, y: 380 } }),
        rngSeed: 5,
      }),
      makeCtx({
        opponent: makeOpponent({
          position: { x: 480, y: 380 },
          stateLabel: 'attacking',
        }),
        rngSeed: 5,
        tickIndex: 1,
      }),
      makeCtx({
        opponent: makeOpponent({ position: { x: 440, y: 380 } }),
        rngSeed: 5,
        tickIndex: 2,
      }),
    ];

    for (const ctx of ctxs) {
      fsmA.tick(ctx, recordingDecisionWriter(a));
      fsmB.tick(ctx, recordingDecisionWriter(b));
    }

    expect(a).toEqual(b);
    expect(fsmA.snapshot()).toEqual(fsmB.snapshot());
  });

  it('RNG advancement: identical seeds across construction-and-tick produce identical defend rolls', () => {
    const a: DecisionAction[] = [];
    const b: DecisionAction[] = [];
    const fsmA = new DecisionFSM();
    const fsmB = new DecisionFSM();
    const seed = 17;
    // Build a defending context — opponent attacking in melee.
    const buildCtx = () =>
      makeCtx({
        opponent: makeOpponent({
          position: { x: 440, y: 380 },
          stateLabel: 'attacking',
        }),
        rngSeed: seed,
      });
    fsmA.tick(buildCtx(), recordingDecisionWriter(a));
    fsmB.tick(buildCtx(), recordingDecisionWriter(b));
    expect(a).toEqual(b);
  });
});

describe('DecisionFSM snapshot', () => {
  it('returns a fresh object on every call', () => {
    const fsm = new DecisionFSM();
    const a = fsm.snapshot();
    const b = fsm.snapshot();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('reflects the latest tick state', () => {
    const fsm = new DecisionFSM();
    const ctx = makeCtx({
      self: { position: { x: 60, y: 500 }, isAirborne: true },
    });
    fsm.tick(ctx, recordingDecisionWriter([]));
    const snap = fsm.snapshot();
    expect(snap.currentState).toBe('recover');
    expect(snap.tickCount).toBe(1);
    expect(snap.lastEmitCount).toBeGreaterThan(0);
  });
});

describe('recordingDecisionWriter', () => {
  it('appends emits to the supplied array in call order', () => {
    const sink: DecisionAction[] = [];
    const writer = recordingDecisionWriter(sink);
    writer.emit({ kind: 'jab', state: 'attack', note: 'test1' });
    writer.emit({ kind: 'shield', state: 'defend' });
    expect(sink).toEqual([
      { kind: 'jab', state: 'attack', note: 'test1' },
      { kind: 'shield', state: 'defend' },
    ]);
  });
});
