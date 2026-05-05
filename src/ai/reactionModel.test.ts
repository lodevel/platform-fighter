/**
 * Tests for the Hard-tier reaction model — AC 19 Sub-AC 2.
 *
 * Two halves: the input-delay simulation (delegated to the underlying
 * {@link HardTierReactionSystem}, smoke-tested here for integration)
 * and the perception filtering layer (the new functionality this
 * module adds).
 */

import { describe, it, expect } from 'vitest';
import { Rng } from '../utils/Rng';
import { REACTION_WINDOW_PRESETS } from './perception/reactionWindowPresets';
import {
  DEFAULT_HARD_TIER_BUFFER_CAPACITY,
  DEFAULT_HARD_TIER_EVENT_MISS_RATE,
  DEFAULT_HARD_TIER_INPUT_DELAY,
  HARD_TIER_INPUT_DELAY_RANGE,
  REACTION_MODEL_ZERO_STATS,
  ReactionModel,
  passThroughEventFilter,
  passThroughStateFilter,
  predicateEventFilter,
  predicateStateFilter,
  probabilisticEventMissFilter,
  probabilisticStateMissFilter,
  transformStateFilter,
  type EventPerceptionFilter,
  type StatePerceptionFilter,
} from './reactionModel';

// ---------------------------------------------------------------------------
// Tiny test fixtures
// ---------------------------------------------------------------------------

interface MiniWorld {
  readonly tick: number;
  readonly opp: { x: number; y: number };
  readonly self: { x: number; y: number };
}

function makeMini(tick: number, x: number, y = 0): MiniWorld {
  return { tick, opp: { x, y }, self: { x: 0, y: 0 } };
}

interface MiniEvent {
  readonly type: string;
  readonly distance: number;
}

// ---------------------------------------------------------------------------
// Constants & defaults (re-export integrity)
// ---------------------------------------------------------------------------

describe('reactionModel — re-exports', () => {
  it('re-exports the AC-mandated Hard-tier band', () => {
    expect(HARD_TIER_INPUT_DELAY_RANGE).toEqual(REACTION_WINDOW_PRESETS.hard);
    expect(HARD_TIER_INPUT_DELAY_RANGE.minDelayFrames).toBe(15);
    expect(HARD_TIER_INPUT_DELAY_RANGE.maxDelayFrames).toBe(20);
  });

  it('re-exports the default fixed delay (mid of band)', () => {
    expect(DEFAULT_HARD_TIER_INPUT_DELAY).toEqual({
      mode: 'fixed',
      frames: 17,
    });
  });

  it('re-exports the default buffer capacity', () => {
    expect(DEFAULT_HARD_TIER_BUFFER_CAPACITY).toBeGreaterThan(
      HARD_TIER_INPUT_DELAY_RANGE.maxDelayFrames,
    );
  });

  it('exposes a zero-stats baseline', () => {
    expect(REACTION_MODEL_ZERO_STATS).toEqual({
      statePushed: 0,
      stateAccepted: 0,
      stateRejected: 0,
      eventsObserved: 0,
      eventsAccepted: 0,
      eventsRejected: 0,
    });
  });

  it('exposes a sensible default Hard-tier event miss rate', () => {
    expect(DEFAULT_HARD_TIER_EVENT_MISS_RATE).toBeGreaterThan(0);
    expect(DEFAULT_HARD_TIER_EVENT_MISS_RATE).toBeLessThan(0.2);
  });
});

// ---------------------------------------------------------------------------
// Construction & defaults
// ---------------------------------------------------------------------------

describe('ReactionModel — construction', () => {
  it('constructs with no options (fixed default delay)', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>();
    expect(m.getInputDelayFrames()).toBe(17);
    expect(m.getInputDelaySpec()).toEqual({ mode: 'fixed', frames: 17 });
    expect(m.getBufferCapacity()).toBe(DEFAULT_HARD_TIER_BUFFER_CAPACITY);
    expect(m.size()).toBe(0);
    expect(m.hasEventChannel()).toBe(false);
  });

  it('starts with empty filter chains', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>();
    expect(m.getStateFilters()).toEqual([]);
    expect(m.getEventFilters()).toEqual([]);
  });

  it('starts with zeroed stats', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>();
    expect(m.getStats()).toEqual(REACTION_MODEL_ZERO_STATS);
  });

  it('accepts a sampled delay spec when given an RNG', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(42),
      inputDelay: { mode: 'sampled', minFrames: 15, maxFrames: 20 },
    });
    const d = m.getInputDelayFrames();
    expect(d).toBeGreaterThanOrEqual(15);
    expect(d).toBeLessThanOrEqual(20);
  });

  it('throws on sampled mode without RNG (delegated to system)', () => {
    expect(
      () =>
        new ReactionModel<MiniWorld, MiniEvent>({
          inputDelay: { mode: 'sampled', minFrames: 15, maxFrames: 20 },
        }),
    ).toThrow(/sampled inputDelay requires an rng/);
  });

  it('throws on event range without RNG (delegated to system)', () => {
    expect(
      () =>
        new ReactionModel<MiniWorld, MiniEvent>({
          eventRange: REACTION_WINDOW_PRESETS.hard,
        }),
    ).toThrow(/eventRange requires an rng/);
  });

  it('configures an event channel when eventRange + RNG are supplied', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(7),
      eventRange: REACTION_WINDOW_PRESETS.hard,
    });
    expect(m.hasEventChannel()).toBe(true);
    expect(m.pendingEventCount()).toBe(0);
  });

  it('seeds initial filter chains from options (defensive copy)', () => {
    const stateFilters: StatePerceptionFilter<MiniWorld>[] = [
      passThroughStateFilter(),
    ];
    const eventFilters: EventPerceptionFilter<MiniEvent>[] = [
      passThroughEventFilter(),
    ];
    const m = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(1),
      eventRange: REACTION_WINDOW_PRESETS.hard,
      stateFilters,
      eventFilters,
    });
    expect(m.getStateFilters()).toHaveLength(1);
    expect(m.getEventFilters()).toHaveLength(1);
    // Mutating the original arrays must not affect the model.
    stateFilters.push(passThroughStateFilter());
    eventFilters.push(passThroughEventFilter());
    expect(m.getStateFilters()).toHaveLength(1);
    expect(m.getEventFilters()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// State channel — input delay
// ---------------------------------------------------------------------------

describe('ReactionModel — state channel input delay', () => {
  it('returns null while warming up', () => {
    const m = new ReactionModel<MiniWorld>();
    for (let f = 0; f < 17; f += 1) {
      m.pushPerception(f, makeMini(f, f * 10));
      expect(m.perceive(f)).toBeNull();
      expect(m.hasWarmedUp(f)).toBe(false);
    }
  });

  it('returns the snapshot at currentFrame - delayFrames once warmed up', () => {
    const m = new ReactionModel<MiniWorld>();
    for (let f = 0; f <= 30; f += 1) {
      m.pushPerception(f, makeMini(f, f * 10));
    }
    // delay = 17, so perceive(30) should return tick=13 (30 - 17)
    const seen = m.perceive(30);
    expect(seen).not.toBeNull();
    expect(seen!.tick).toBe(13);
  });

  it('every accepted snapshot increments stateAccepted, none increment rejected', () => {
    const m = new ReactionModel<MiniWorld>();
    for (let f = 0; f < 5; f += 1) {
      m.pushPerception(f, makeMini(f, 0));
    }
    expect(m.getStats()).toEqual({
      statePushed: 5,
      stateAccepted: 5,
      stateRejected: 0,
      eventsObserved: 0,
      eventsAccepted: 0,
      eventsRejected: 0,
    });
  });

  it('respects reconfigureDelay forwarded to the underlying system', () => {
    const m = new ReactionModel<MiniWorld>();
    m.reconfigureDelay({ mode: 'fixed', frames: 5 });
    for (let f = 0; f <= 10; f += 1) {
      m.pushPerception(f, makeMini(f, 0));
    }
    expect(m.getInputDelayFrames()).toBe(5);
    expect(m.perceive(10)?.tick).toBe(5);
  });

  it('peekFrame and peekEntries delegate through correctly', () => {
    const m = new ReactionModel<MiniWorld>();
    m.pushPerception(3, makeMini(3, 100));
    m.pushPerception(4, makeMini(4, 200));
    expect(m.peekFrame(3)?.opp.x).toBe(100);
    expect(m.peekFrame(4)?.opp.x).toBe(200);
    expect(m.peekFrame(5)).toBeNull();
    expect(m.peekEntries().map((e) => e.frame)).toEqual([3, 4]);
  });

  it('size reflects the number of buffered entries', () => {
    const m = new ReactionModel<MiniWorld>();
    expect(m.size()).toBe(0);
    m.pushPerception(0, makeMini(0, 0));
    expect(m.size()).toBe(1);
    m.pushPerception(1, makeMini(1, 0));
    expect(m.size()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// State channel — perception filtering
// ---------------------------------------------------------------------------

describe('ReactionModel — state perception filtering', () => {
  it('predicate filter drops snapshots failing the predicate', () => {
    const m = new ReactionModel<MiniWorld>({
      stateFilters: [
        predicateStateFilter<MiniWorld>((s) => s.opp.x <= 200),
      ],
    });
    expect(m.pushPerception(0, makeMini(0, 100))).toBe(true);
    expect(m.pushPerception(1, makeMini(1, 999))).toBe(false);
    expect(m.pushPerception(2, makeMini(2, 50))).toBe(true);
    expect(m.size()).toBe(2);
    expect(m.peekFrame(0)).not.toBeNull();
    expect(m.peekFrame(1)).toBeNull(); // dropped
    expect(m.peekFrame(2)).not.toBeNull();
    const stats = m.getStats();
    expect(stats.statePushed).toBe(3);
    expect(stats.stateAccepted).toBe(2);
    expect(stats.stateRejected).toBe(1);
  });

  it('transform filter rewrites the stored snapshot', () => {
    const m = new ReactionModel<MiniWorld>({
      stateFilters: [
        transformStateFilter<MiniWorld>((s) => ({
          ...s,
          opp: { x: Math.round(s.opp.x / 10) * 10, y: s.opp.y },
        })),
      ],
    });
    m.pushPerception(0, makeMini(0, 123));
    expect(m.peekFrame(0)?.opp.x).toBe(120);
  });

  it('chained filters short-circuit on the first null return', () => {
    let secondCalled = 0;
    const filters: StatePerceptionFilter<MiniWorld>[] = [
      () => null,
      (ctx) => {
        secondCalled += 1;
        return ctx.snapshot;
      },
    ];
    const m = new ReactionModel<MiniWorld>({ stateFilters: filters });
    m.pushPerception(0, makeMini(0, 0));
    expect(secondCalled).toBe(0);
    expect(m.size()).toBe(0);
  });

  it('chained filters pass transformed values through', () => {
    const m = new ReactionModel<MiniWorld>({
      stateFilters: [
        transformStateFilter<MiniWorld>((s) => ({ ...s, opp: { x: s.opp.x + 1, y: s.opp.y } })),
        transformStateFilter<MiniWorld>((s) => ({ ...s, opp: { x: s.opp.x * 2, y: s.opp.y } })),
      ],
    });
    m.pushPerception(0, makeMini(0, 5));
    // 5 -> 6 -> 12
    expect(m.peekFrame(0)?.opp.x).toBe(12);
  });

  it('probabilisticStateMissFilter is deterministic for the same RNG seed', () => {
    const seed = 0xDEADBEEF;
    const m1 = new ReactionModel<MiniWorld>({
      rng: new Rng(seed),
      stateFilters: [probabilisticStateMissFilter<MiniWorld>(0.5)],
    });
    const m2 = new ReactionModel<MiniWorld>({
      rng: new Rng(seed),
      stateFilters: [probabilisticStateMissFilter<MiniWorld>(0.5)],
    });
    const accepts1: boolean[] = [];
    const accepts2: boolean[] = [];
    for (let f = 0; f < 30; f += 1) {
      accepts1.push(m1.pushPerception(f, makeMini(f, 0)));
      accepts2.push(m2.pushPerception(f, makeMini(f, 0)));
    }
    expect(accepts1).toEqual(accepts2);
  });

  it('probabilisticStateMissFilter at rate 0 keeps everything', () => {
    const m = new ReactionModel<MiniWorld>({
      rng: new Rng(1),
      stateFilters: [probabilisticStateMissFilter<MiniWorld>(0)],
    });
    for (let f = 0; f < 20; f += 1) m.pushPerception(f, makeMini(f, 0));
    expect(m.getStats().stateAccepted).toBe(20);
    expect(m.getStats().stateRejected).toBe(0);
  });

  it('probabilisticStateMissFilter at rate 1 drops everything', () => {
    const m = new ReactionModel<MiniWorld>({
      rng: new Rng(1),
      stateFilters: [probabilisticStateMissFilter<MiniWorld>(1)],
    });
    for (let f = 0; f < 20; f += 1) m.pushPerception(f, makeMini(f, 0));
    expect(m.getStats().stateAccepted).toBe(0);
    expect(m.getStats().stateRejected).toBe(20);
  });

  it('rejects an out-of-range probability eagerly', () => {
    expect(() => probabilisticStateMissFilter<MiniWorld>(-0.1)).toThrow(
      /must be a finite number in \[0, 1\]/,
    );
    expect(() => probabilisticStateMissFilter<MiniWorld>(1.1)).toThrow(
      /must be a finite number in \[0, 1\]/,
    );
    expect(() => probabilisticStateMissFilter<MiniWorld>(NaN)).toThrow(
      /must be a finite number in \[0, 1\]/,
    );
  });

  it('probabilistic state filter without an RNG throws on use', () => {
    const m = new ReactionModel<MiniWorld>({
      stateFilters: [probabilisticStateMissFilter<MiniWorld>(0.5)],
    });
    expect(() => m.pushPerception(0, makeMini(0, 0))).toThrow(
      /requires an rng/,
    );
  });
});

// ---------------------------------------------------------------------------
// Event channel — input delay + filtering
// ---------------------------------------------------------------------------

describe('ReactionModel — event channel', () => {
  it('observeEvent throws when no event channel is configured', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>();
    expect(() => m.observeEvent({ type: 'a', distance: 0 }, 0)).toThrow(
      /no event channel/,
    );
  });

  it('pollReadyEvents on a missing channel returns []', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>();
    expect(m.pollReadyEvents(0)).toEqual([]);
    expect(m.peekPendingEvents()).toEqual([]);
    expect(m.pendingEventCount()).toBe(0);
  });

  it('forwards observed events to the underlying reaction window', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(123),
      eventRange: { minDelayFrames: 3, maxDelayFrames: 3 },
    });
    expect(m.observeEvent({ type: 'a', distance: 0 }, 0)).toBe(true);
    expect(m.pendingEventCount()).toBe(1);
    expect(m.pollReadyEvents(2)).toEqual([]);
    expect(m.pollReadyEvents(3).map((e) => e.type)).toEqual(['a']);
  });

  it('predicate event filter drops events failing the predicate', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(1),
      eventRange: { minDelayFrames: 1, maxDelayFrames: 1 },
      eventFilters: [
        predicateEventFilter<MiniEvent>((e) => e.distance <= 100),
      ],
    });
    expect(m.observeEvent({ type: 'near', distance: 50 }, 0)).toBe(true);
    expect(m.observeEvent({ type: 'far', distance: 1000 }, 0)).toBe(false);
    expect(m.pendingEventCount()).toBe(1);
    expect(m.pollReadyEvents(1).map((e) => e.type)).toEqual(['near']);
    const stats = m.getStats();
    expect(stats.eventsObserved).toBe(2);
    expect(stats.eventsAccepted).toBe(1);
    expect(stats.eventsRejected).toBe(1);
  });

  it('chained event filters short-circuit on the first false return', () => {
    let secondCalled = 0;
    const m = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(1),
      eventRange: { minDelayFrames: 1, maxDelayFrames: 1 },
      eventFilters: [
        () => false,
        () => {
          secondCalled += 1;
          return true;
        },
      ],
    });
    m.observeEvent({ type: 'a', distance: 0 }, 0);
    expect(secondCalled).toBe(0);
  });

  it('probabilisticEventMissFilter is deterministic for the same RNG seed', () => {
    const seed = 0xCAFEBABE;
    const accepts: boolean[][] = [];
    for (let i = 0; i < 2; i += 1) {
      const m = new ReactionModel<MiniWorld, MiniEvent>({
        rng: new Rng(seed),
        eventRange: { minDelayFrames: 1, maxDelayFrames: 1 },
        eventFilters: [probabilisticEventMissFilter<MiniEvent>(0.3)],
      });
      const run: boolean[] = [];
      for (let f = 0; f < 50; f += 1) {
        run.push(m.observeEvent({ type: 'e', distance: f }, f));
      }
      accepts.push(run);
    }
    expect(accepts[0]).toEqual(accepts[1]);
  });

  it('probabilisticEventMissFilter rate 0 keeps everything', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(1),
      eventRange: { minDelayFrames: 1, maxDelayFrames: 1 },
      eventFilters: [probabilisticEventMissFilter<MiniEvent>(0)],
    });
    for (let f = 0; f < 30; f += 1) {
      m.observeEvent({ type: 'e', distance: 0 }, f);
    }
    const stats = m.getStats();
    expect(stats.eventsAccepted).toBe(30);
    expect(stats.eventsRejected).toBe(0);
  });

  it('probabilisticEventMissFilter rate 1 drops everything', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(1),
      eventRange: { minDelayFrames: 1, maxDelayFrames: 1 },
      eventFilters: [probabilisticEventMissFilter<MiniEvent>(1)],
    });
    for (let f = 0; f < 30; f += 1) {
      m.observeEvent({ type: 'e', distance: 0 }, f);
    }
    const stats = m.getStats();
    expect(stats.eventsAccepted).toBe(0);
    expect(stats.eventsRejected).toBe(30);
  });

  it('probabilisticEventMissFilter respects miss rate roughly within band', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(99),
      eventRange: { minDelayFrames: 1, maxDelayFrames: 1 },
      eventFilters: [probabilisticEventMissFilter<MiniEvent>(0.3)],
    });
    for (let f = 0; f < 1000; f += 1) {
      m.observeEvent({ type: 'e', distance: 0 }, f);
    }
    const stats = m.getStats();
    // Expected ~300 rejected, allow ±5% tolerance
    expect(stats.eventsRejected).toBeGreaterThan(250);
    expect(stats.eventsRejected).toBeLessThan(350);
  });

  it('probabilistic event filter without an RNG throws on use', () => {
    // Force-construct a model without RNG and bypass event-range validation
    // by adding the filter post-construction but never enabling the channel
    // through the constructor. Instead we just exercise the filter directly.
    expect(() =>
      probabilisticEventMissFilter<MiniEvent>(0.5)({
        frame: 0,
        payload: { type: 'a', distance: 0 },
        rng: null,
      }),
    ).toThrow(/requires an rng/);
  });
});

// ---------------------------------------------------------------------------
// Filter management mutators
// ---------------------------------------------------------------------------

describe('ReactionModel — filter management', () => {
  it('addStateFilter / addEventFilter append to the chain', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(1),
      eventRange: { minDelayFrames: 1, maxDelayFrames: 1 },
    });
    m.addStateFilter(passThroughStateFilter());
    m.addEventFilter(passThroughEventFilter());
    expect(m.getStateFilters()).toHaveLength(1);
    expect(m.getEventFilters()).toHaveLength(1);
  });

  it('rejects non-function filters', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>();
    expect(() =>
      m.addStateFilter(undefined as unknown as StatePerceptionFilter<MiniWorld>),
    ).toThrow(/must be a function/);
    expect(() =>
      m.addEventFilter(123 as unknown as EventPerceptionFilter<MiniEvent>),
    ).toThrow(/must be a function/);
  });

  it('setStateFilters / setEventFilters replace the chain', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(1),
      eventRange: { minDelayFrames: 1, maxDelayFrames: 1 },
      stateFilters: [passThroughStateFilter(), passThroughStateFilter()],
      eventFilters: [passThroughEventFilter()],
    });
    m.setStateFilters([passThroughStateFilter()]);
    m.setEventFilters([
      passThroughEventFilter(),
      passThroughEventFilter(),
      passThroughEventFilter(),
    ]);
    expect(m.getStateFilters()).toHaveLength(1);
    expect(m.getEventFilters()).toHaveLength(3);
  });

  it('clearFilters wipes both chains', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(1),
      eventRange: { minDelayFrames: 1, maxDelayFrames: 1 },
      stateFilters: [passThroughStateFilter()],
      eventFilters: [passThroughEventFilter()],
    });
    m.clearFilters();
    expect(m.getStateFilters()).toHaveLength(0);
    expect(m.getEventFilters()).toHaveLength(0);
  });

  it('getStateFilters / getEventFilters return defensive copies', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>();
    const a = m.getStateFilters();
    expect(Object.isFrozen(a)).toBe(false);
    // mutating the returned array does not leak back
    (a as unknown as StatePerceptionFilter<MiniWorld>[]).push(
      passThroughStateFilter(),
    );
    expect(m.getStateFilters()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

describe('ReactionModel — stats', () => {
  it('counts state pushes / accepts / rejects accurately under filter', () => {
    const m = new ReactionModel<MiniWorld>({
      stateFilters: [predicateStateFilter<MiniWorld>((s) => s.tick % 2 === 0)],
    });
    for (let f = 0; f < 10; f += 1) m.pushPerception(f, makeMini(f, 0));
    const stats = m.getStats();
    expect(stats.statePushed).toBe(10);
    expect(stats.stateAccepted).toBe(5);
    expect(stats.stateRejected).toBe(5);
  });

  it('counts events observed / accepted / rejected accurately', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(1),
      eventRange: { minDelayFrames: 1, maxDelayFrames: 1 },
      eventFilters: [predicateEventFilter<MiniEvent>((e) => e.distance < 50)],
    });
    for (let f = 0; f < 20; f += 1) {
      m.observeEvent({ type: 'e', distance: f * 5 }, f);
    }
    const stats = m.getStats();
    expect(stats.eventsObserved).toBe(20);
    expect(stats.eventsAccepted).toBe(10); // 0..45 (f=0..9)
    expect(stats.eventsRejected).toBe(10);
  });

  it('resetStats zeros every counter', () => {
    const m = new ReactionModel<MiniWorld>();
    for (let f = 0; f < 5; f += 1) m.pushPerception(f, makeMini(f, 0));
    m.resetStats();
    expect(m.getStats()).toEqual(REACTION_MODEL_ZERO_STATS);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle: clear / snapshot / restore
// ---------------------------------------------------------------------------

describe('ReactionModel — lifecycle', () => {
  it('clear empties the buffer, drains pending events, and resets stats', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(1),
      eventRange: { minDelayFrames: 5, maxDelayFrames: 5 },
    });
    for (let f = 0; f < 10; f += 1) m.pushPerception(f, makeMini(f, 0));
    m.observeEvent({ type: 'a', distance: 0 }, 0);
    expect(m.size()).toBeGreaterThan(0);
    expect(m.pendingEventCount()).toBe(1);
    m.clear();
    expect(m.size()).toBe(0);
    expect(m.pendingEventCount()).toBe(0);
    expect(m.getStats()).toEqual(REACTION_MODEL_ZERO_STATS);
  });

  it('snapshot+restore round-trips the state buffer + event queue + stats', () => {
    const a = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(1),
      eventRange: { minDelayFrames: 3, maxDelayFrames: 3 },
      stateFilters: [predicateStateFilter<MiniWorld>((s) => s.tick !== 5)],
    });
    for (let f = 0; f < 10; f += 1) a.pushPerception(f, makeMini(f, f));
    a.observeEvent({ type: 'e1', distance: 1 }, 1);
    a.observeEvent({ type: 'e2', distance: 2 }, 2);

    const snap = a.snapshot();
    const b = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(1),
      eventRange: { minDelayFrames: 3, maxDelayFrames: 3 },
    });
    b.restoreSnapshot(snap);

    expect(b.size()).toBe(a.size());
    expect(b.peekEntries().map((e) => e.frame)).toEqual(
      a.peekEntries().map((e) => e.frame),
    );
    expect(b.peekFrame(5)).toBeNull(); // confirmed dropped pre-snapshot
    expect(b.getStats()).toEqual(a.getStats());
    // Event queue restored too — pollReady on the restored model returns
    // the same payloads at the same frames.
    expect(b.pollReadyEvents(4).map((e) => e.type)).toEqual(['e1']);
    expect(b.pollReadyEvents(5).map((e) => e.type)).toEqual(['e2']);
  });

  it('restoreSnapshot rejects malformed snapshots', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>();
    expect(() =>
      m.restoreSnapshot(
        null as unknown as ReturnType<ReactionModel<MiniWorld, MiniEvent>['snapshot']>,
      ),
    ).toThrow(/snapshot must be an object/);
  });

  it('restoreSnapshot rejects malformed stats', () => {
    const m = new ReactionModel<MiniWorld>();
    const good = m.snapshot();
    expect(() =>
      m.restoreSnapshot({
        ...good,
        stats: { ...good.stats, statePushed: -1 },
      }),
    ).toThrow(/must be a non-negative integer/);
  });

  it('restoreSnapshot rejects stats whose sum exceeds total', () => {
    const m = new ReactionModel<MiniWorld>();
    const good = m.snapshot();
    expect(() =>
      m.restoreSnapshot({
        ...good,
        stats: {
          statePushed: 1,
          stateAccepted: 1,
          stateRejected: 1, // 1+1 > 1
          eventsObserved: 0,
          eventsAccepted: 0,
          eventsRejected: 0,
        },
      }),
    ).toThrow(/must be <= stats.statePushed/);
  });
});

// ---------------------------------------------------------------------------
// Determinism: identical seeds + inputs produce identical results
// ---------------------------------------------------------------------------

describe('ReactionModel — determinism', () => {
  it('produces identical perception streams for two identically seeded models', () => {
    function run(): { delays: number[]; events: string[]; stats: number[] } {
      const m = new ReactionModel<MiniWorld, MiniEvent>({
        rng: new Rng(0xABCDEF12),
        inputDelay: { mode: 'sampled', minFrames: 15, maxFrames: 20 },
        eventRange: REACTION_WINDOW_PRESETS.hard,
        stateFilters: [probabilisticStateMissFilter<MiniWorld>(0.1)],
        eventFilters: [
          probabilisticEventMissFilter<MiniEvent>(
            DEFAULT_HARD_TIER_EVENT_MISS_RATE,
          ),
        ],
      });
      const delays: number[] = [];
      const events: string[] = [];
      for (let f = 0; f < 200; f += 1) {
        m.pushPerception(f, makeMini(f, f));
        if (f % 7 === 0) {
          m.observeEvent({ type: `evt-${f}`, distance: f }, f);
        }
        const seen = m.perceive(f);
        delays.push(seen ? seen.tick : -1);
        for (const e of m.pollReadyEvents(f)) events.push(e.type);
      }
      const s = m.getStats();
      return {
        delays,
        events,
        stats: [
          s.statePushed,
          s.stateAccepted,
          s.stateRejected,
          s.eventsObserved,
          s.eventsAccepted,
          s.eventsRejected,
        ],
      };
    }

    const a = run();
    const b = run();
    expect(a.delays).toEqual(b.delays);
    expect(a.events).toEqual(b.events);
    expect(a.stats).toEqual(b.stats);
  });

  it('replay seek (snapshot+restore) preserves perception over the next 100 frames', () => {
    const seed = 0x12345678;
    const original = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(seed),
      eventRange: { minDelayFrames: 10, maxDelayFrames: 10 },
    });
    // Bootstrap deterministic sequence to frame 50
    for (let f = 0; f < 50; f += 1) {
      original.pushPerception(f, makeMini(f, f * 2));
    }
    const anchor = original.snapshot();

    // Play forward original to frame 150
    const original_after: number[] = [];
    for (let f = 50; f < 150; f += 1) {
      original.pushPerception(f, makeMini(f, f * 2));
      const seen = original.perceive(f);
      original_after.push(seen ? seen.tick : -1);
    }

    // Restore a fresh model and replay the same inputs
    const replayed = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(seed),
      eventRange: { minDelayFrames: 10, maxDelayFrames: 10 },
    });
    replayed.restoreSnapshot(anchor);
    const replayed_after: number[] = [];
    for (let f = 50; f < 150; f += 1) {
      replayed.pushPerception(f, makeMini(f, f * 2));
      const seen = replayed.perceive(f);
      replayed_after.push(seen ? seen.tick : -1);
    }

    expect(replayed_after).toEqual(original_after);
  });
});

// ---------------------------------------------------------------------------
// Hard-tier integration smoke test
// ---------------------------------------------------------------------------

describe('ReactionModel — Hard-tier integration', () => {
  it('17-frame default delay matches the AC mid-band default', () => {
    const m = new ReactionModel<MiniWorld>();
    for (let f = 0; f <= 100; f += 1) {
      m.pushPerception(f, makeMini(f, f));
    }
    const seen = m.perceive(100);
    expect(seen?.tick).toBe(83); // 100 - 17
  });

  it('full Hard-tier wiring preserves the 15-20 frame band', () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const m = new ReactionModel<MiniWorld, MiniEvent>({
        rng: new Rng(seed),
        inputDelay: { mode: 'sampled', minFrames: 15, maxFrames: 20 },
        eventRange: REACTION_WINDOW_PRESETS.hard,
      });
      const d = m.getInputDelayFrames();
      expect(d).toBeGreaterThanOrEqual(15);
      expect(d).toBeLessThanOrEqual(20);
    }
  });

  it('supports a Hard-tier preset with both stochastic state and event miss filters', () => {
    const m = new ReactionModel<MiniWorld, MiniEvent>({
      rng: new Rng(2024),
      inputDelay: { mode: 'sampled', minFrames: 15, maxFrames: 20 },
      eventRange: REACTION_WINDOW_PRESETS.hard,
      stateFilters: [probabilisticStateMissFilter<MiniWorld>(0.02)],
      eventFilters: [
        probabilisticEventMissFilter<MiniEvent>(
          DEFAULT_HARD_TIER_EVENT_MISS_RATE,
        ),
      ],
    });
    for (let f = 0; f < 500; f += 1) {
      m.pushPerception(f, makeMini(f, f));
      if (f % 11 === 0) m.observeEvent({ type: 'e', distance: 0 }, f);
    }
    const stats = m.getStats();
    // The bot should perceive most state but not all
    expect(stats.stateAccepted).toBeGreaterThan(stats.stateRejected * 5);
    // And most events but not all
    expect(stats.eventsAccepted).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Built-in filter helpers — basic correctness
// ---------------------------------------------------------------------------

describe('built-in filter helpers', () => {
  it('passThroughStateFilter forwards the snapshot unchanged', () => {
    const f = passThroughStateFilter<MiniWorld>();
    const snap = makeMini(0, 5);
    expect(f({ frame: 0, snapshot: snap, rng: null })).toBe(snap);
  });

  it('passThroughEventFilter always returns true', () => {
    const f = passThroughEventFilter<MiniEvent>();
    expect(f({ frame: 0, payload: { type: 'a', distance: 0 }, rng: null })).toBe(
      true,
    );
  });

  it('predicateStateFilter returns the snapshot or null', () => {
    const f = predicateStateFilter<MiniWorld>((s) => s.opp.x >= 100);
    const yes = makeMini(0, 100);
    const no = makeMini(0, 50);
    expect(f({ frame: 0, snapshot: yes, rng: null })).toBe(yes);
    expect(f({ frame: 0, snapshot: no, rng: null })).toBeNull();
  });

  it('predicateEventFilter returns true / false', () => {
    const f = predicateEventFilter<MiniEvent>((e) => e.distance < 100);
    expect(
      f({ frame: 0, payload: { type: 'a', distance: 50 }, rng: null }),
    ).toBe(true);
    expect(
      f({ frame: 0, payload: { type: 'b', distance: 200 }, rng: null }),
    ).toBe(false);
  });

  it('transformStateFilter applies the transform', () => {
    const f = transformStateFilter<MiniWorld>((s) => ({
      ...s,
      opp: { x: s.opp.x + 10, y: s.opp.y },
    }));
    const result = f({ frame: 0, snapshot: makeMini(0, 5), rng: null });
    expect(result?.opp.x).toBe(15);
  });
});
