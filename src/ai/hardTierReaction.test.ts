import { describe, it, expect } from 'vitest';
import { Rng } from '../utils/Rng';
import {
  buildWorldSnapshot,
  type PerceivedOpponent,
  type PerceivedSelf,
  type PerceivedStage,
  type WorldSnapshot,
} from './perception/WorldSnapshot';
import { REACTION_WINDOW_PRESETS } from './perception/reactionWindowPresets';
import {
  DEFAULT_HARD_TIER_BUFFER_CAPACITY,
  DEFAULT_HARD_TIER_INPUT_DELAY,
  HARD_TIER_INPUT_DELAY_RANGE,
  HardTierReactionSystem,
  perceiveOpponent,
  type HardTierInputDelaySpec,
} from './hardTierReaction';

// ---------------------------------------------------------------------------
// Fixtures — minimal WorldSnapshots used by the integration tests
// ---------------------------------------------------------------------------

function makeSelf(overrides: Partial<PerceivedSelf> = {}): PerceivedSelf {
  return {
    slotIndex: 0,
    position: { x: 0, y: 0 },
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

function makeOpp(
  slot: 1 | 2 | 3,
  overrides: Partial<PerceivedOpponent> = {},
): PerceivedOpponent {
  return {
    slotIndex: slot,
    position: { x: 100, y: 0 },
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

function makeStage(): PerceivedStage {
  return {
    stageLeft: -400,
    stageRight: 400,
    stageTop: 200,
    blastZone: { left: -800, right: 800, top: -600, bottom: 600 },
  };
}

function makeWorld(
  tickIndex: number,
  oppX: number,
  extras: Partial<PerceivedOpponent> = {},
): WorldSnapshot {
  return buildWorldSnapshot({
    tickIndex,
    self: makeSelf(),
    opponents: [makeOpp(1, { position: { x: oppX, y: 0 }, ...extras })],
    stage: makeStage(),
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('HardTierReactionSystem — defaults', () => {
  it('exposes the AC-mandated 15-20 frame Hard-tier band', () => {
    expect(HARD_TIER_INPUT_DELAY_RANGE).toEqual(REACTION_WINDOW_PRESETS.hard);
    expect(HARD_TIER_INPUT_DELAY_RANGE.minDelayFrames).toBe(15);
    expect(HARD_TIER_INPUT_DELAY_RANGE.maxDelayFrames).toBe(20);
  });

  it('default delay sits at the middle of the AC band', () => {
    expect(DEFAULT_HARD_TIER_INPUT_DELAY).toEqual({
      mode: 'fixed',
      frames: 17,
    });
  });

  it('default buffer capacity comfortably exceeds the AC max delay', () => {
    expect(DEFAULT_HARD_TIER_BUFFER_CAPACITY).toBeGreaterThan(
      HARD_TIER_INPUT_DELAY_RANGE.maxDelayFrames,
    );
  });
});

// ---------------------------------------------------------------------------
// Construction validation
// ---------------------------------------------------------------------------

describe('HardTierReactionSystem — construction', () => {
  it('uses the 17-frame default when no inputDelay is supplied', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>();
    expect(sys.getInputDelayFrames()).toBe(17);
    expect(sys.getInputDelaySpec()).toEqual({ mode: 'fixed', frames: 17 });
  });

  it('accepts an explicit fixed delay', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'fixed', frames: 15 },
    });
    expect(sys.getInputDelayFrames()).toBe(15);
  });

  it('rolls a sampled delay strictly inside the configured band', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const sys = new HardTierReactionSystem<WorldSnapshot>({
        inputDelay: { mode: 'sampled', minFrames: 15, maxFrames: 20 },
        rng: new Rng(seed),
      });
      const delay = sys.getInputDelayFrames();
      expect(delay).toBeGreaterThanOrEqual(15);
      expect(delay).toBeLessThanOrEqual(20);
      expect(Number.isInteger(delay)).toBe(true);
    }
  });

  it('throws on sampled mode without an rng', () => {
    expect(
      () =>
        new HardTierReactionSystem<WorldSnapshot>({
          inputDelay: { mode: 'sampled', minFrames: 15, maxFrames: 20 },
        }),
    ).toThrow(/rng/);
  });

  it('throws when fixed delay is negative or non-integer', () => {
    expect(
      () =>
        new HardTierReactionSystem<WorldSnapshot>({
          inputDelay: { mode: 'fixed', frames: -1 },
        }),
    ).toThrow(/frames/);
    expect(
      () =>
        new HardTierReactionSystem<WorldSnapshot>({
          inputDelay: { mode: 'fixed', frames: 2.5 },
        }),
    ).toThrow(/frames/);
  });

  it('throws when sampled bounds are inverted or non-positive', () => {
    const rng = new Rng(1);
    expect(
      () =>
        new HardTierReactionSystem<WorldSnapshot>({
          inputDelay: { mode: 'sampled', minFrames: 20, maxFrames: 15 },
          rng,
        }),
    ).toThrow(/minFrames/);
    expect(
      () =>
        new HardTierReactionSystem<WorldSnapshot>({
          inputDelay: { mode: 'sampled', minFrames: 0, maxFrames: 5 },
          rng,
        }),
    ).toThrow(/minFrames/);
  });

  it('throws when bufferCapacity is invalid', () => {
    expect(
      () =>
        new HardTierReactionSystem<WorldSnapshot>({ bufferCapacity: 0 }),
    ).toThrow(/bufferCapacity/);
    expect(
      () =>
        new HardTierReactionSystem<WorldSnapshot>({ bufferCapacity: 4.5 }),
    ).toThrow(/bufferCapacity/);
  });

  it('throws when effective delay exceeds bufferCapacity', () => {
    expect(
      () =>
        new HardTierReactionSystem<WorldSnapshot>({
          inputDelay: { mode: 'fixed', frames: 50 },
          bufferCapacity: 10,
        }),
    ).toThrow(/bufferCapacity/);
  });

  it('throws when eventRange is supplied without an rng', () => {
    expect(
      () =>
        new HardTierReactionSystem<WorldSnapshot, string>({
          eventRange: HARD_TIER_INPUT_DELAY_RANGE,
        }),
    ).toThrow(/eventRange/);
  });

  it('exposes events facet when eventRange is supplied', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot, string>({
      eventRange: HARD_TIER_INPUT_DELAY_RANGE,
      rng: new Rng(1),
    });
    expect(sys.events).not.toBeNull();
  });

  it('omits events facet when eventRange is absent', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot, string>();
    expect(sys.events).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Push / perceive — happy path and warm-up
// ---------------------------------------------------------------------------

describe('HardTierReactionSystem — push & perceive', () => {
  it('returns null during warm-up (currentFrame < inputDelay)', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'fixed', frames: 17 },
    });
    sys.pushPerception(0, makeWorld(0, 100));
    expect(sys.perceive(0)).toBeNull();
    expect(sys.perceive(16)).toBeNull();
    expect(sys.hasWarmedUp(16)).toBe(false);
  });

  it('returns the snapshot from frame (currentFrame - inputDelay) once warmed up', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'fixed', frames: 15 },
    });
    for (let f = 0; f <= 30; f += 1) {
      sys.pushPerception(f, makeWorld(f, 100 + f));
    }
    const delayed = sys.perceive(30);
    expect(delayed).not.toBeNull();
    expect(delayed!.tickIndex).toBe(15); // 30 - 15
    expect(delayed!.opponents[0]?.position.x).toBe(115);
    expect(sys.hasWarmedUp(30)).toBe(true);
  });

  it('shifts the perception window forward exactly one frame per tick', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'fixed', frames: 15 },
    });
    for (let f = 0; f <= 50; f += 1) {
      sys.pushPerception(f, makeWorld(f, f));
    }
    expect(sys.perceive(20)!.tickIndex).toBe(5);
    expect(sys.perceive(21)!.tickIndex).toBe(6);
    expect(sys.perceive(50)!.tickIndex).toBe(35);
  });

  it('falls back to the most recent non-future snapshot when a frame is missing', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'fixed', frames: 5 },
    });
    sys.pushPerception(0, makeWorld(0, 0));
    sys.pushPerception(2, makeWorld(2, 200));
    // Skipped frames 1, 3, 4. Push frame 5.
    sys.pushPerception(5, makeWorld(5, 500));
    // perceive(7) → target frame = 2, latest entry whose frame <= 2
    // is entry at frame 2.
    expect(sys.perceive(7)!.tickIndex).toBe(2);
    // perceive(6) → target frame = 1, latest entry whose frame <= 1
    // is entry at frame 0.
    expect(sys.perceive(6)!.tickIndex).toBe(0);
  });

  it('rejects negative or non-integer frames on push', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>();
    expect(() => sys.pushPerception(-1, makeWorld(0, 0))).toThrow(/frame/);
    expect(() => sys.pushPerception(1.5, makeWorld(0, 0))).toThrow(/frame/);
  });

  it('rejects negative or non-integer frames on perceive', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>();
    expect(() => sys.perceive(-1)).toThrow(/currentFrame/);
    expect(() => sys.perceive(0.25)).toThrow(/currentFrame/);
  });

  it('rejects pushing a frame strictly older than the last pushed frame', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>();
    sys.pushPerception(10, makeWorld(10, 0));
    expect(() => sys.pushPerception(9, makeWorld(9, 0))).toThrow(/before/);
  });

  it('treats same-frame re-push as last-write-wins', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'fixed', frames: 1 },
    });
    sys.pushPerception(0, makeWorld(0, 100));
    sys.pushPerception(0, makeWorld(0, 999)); // overwrite
    sys.pushPerception(1, makeWorld(1, 1));
    expect(sys.size()).toBe(2);
    expect(sys.perceive(1)!.opponents[0]?.position.x).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// Buffer capacity / eviction
// ---------------------------------------------------------------------------

describe('HardTierReactionSystem — buffer eviction', () => {
  it('evicts the oldest entry when capacity is exceeded', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'fixed', frames: 1 },
      bufferCapacity: 3,
    });
    for (let f = 0; f <= 5; f += 1) {
      sys.pushPerception(f, makeWorld(f, f));
    }
    expect(sys.size()).toBe(3);
    const entries = sys.peekEntries();
    expect(entries.map((e) => e.frame)).toEqual([3, 4, 5]);
    // Old frames are gone — perceive(3) targets frame 2, but we only
    // have frames 3..5; nothing is <= 2.
    expect(sys.perceive(3)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reconfigure delay
// ---------------------------------------------------------------------------

describe('HardTierReactionSystem — reconfigureDelay', () => {
  it('switches a fixed delay in place', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'fixed', frames: 17 },
    });
    sys.reconfigureDelay({ mode: 'fixed', frames: 20 });
    expect(sys.getInputDelayFrames()).toBe(20);
    expect(sys.getInputDelaySpec()).toEqual({ mode: 'fixed', frames: 20 });
  });

  it('re-rolls a sampled delay using the constructor RNG', () => {
    const rng = new Rng(0xdeadbeef);
    const sys = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'fixed', frames: 17 },
      rng,
    });
    sys.reconfigureDelay({ mode: 'sampled', minFrames: 15, maxFrames: 20 });
    const delay = sys.getInputDelayFrames();
    expect(delay).toBeGreaterThanOrEqual(15);
    expect(delay).toBeLessThanOrEqual(20);
  });

  it('throws when reconfigured to a delay larger than buffer capacity', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>({
      bufferCapacity: 20,
    });
    expect(() =>
      sys.reconfigureDelay({ mode: 'fixed', frames: 25 }),
    ).toThrow(/bufferCapacity/);
  });

  it('rejects an unknown delay mode', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>();
    expect(() =>
      sys.reconfigureDelay({
        mode: 'bogus',
      } as unknown as HardTierInputDelaySpec),
    ).toThrow(/mode/);
  });
});

// ---------------------------------------------------------------------------
// Determinism contract
// ---------------------------------------------------------------------------

describe('HardTierReactionSystem — determinism', () => {
  it('two systems seeded identically produce identical sampled delays', () => {
    const a = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'sampled', minFrames: 15, maxFrames: 20 },
      rng: new Rng(42),
    });
    const b = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'sampled', minFrames: 15, maxFrames: 20 },
      rng: new Rng(42),
    });
    expect(a.getInputDelayFrames()).toBe(b.getInputDelayFrames());
  });

  it('does not call Math.random()', () => {
    const original = Math.random;
    let calls = 0;
    Math.random = (): number => {
      calls += 1;
      return 0;
    };
    try {
      const sys = new HardTierReactionSystem<WorldSnapshot>({
        inputDelay: { mode: 'sampled', minFrames: 15, maxFrames: 20 },
        rng: new Rng(7),
      });
      for (let f = 0; f < 100; f += 1) {
        sys.pushPerception(f, makeWorld(f, f));
        sys.perceive(f);
      }
      expect(calls).toBe(0);
    } finally {
      Math.random = original;
    }
  });
});

// ---------------------------------------------------------------------------
// Hard-tier 15-20 frame contract — AC-anchored sanity
// ---------------------------------------------------------------------------

describe('HardTierReactionSystem — Hard-tier 15-20 frame contract', () => {
  it('every sampled delay over many seeds lands inside [15, 20] inclusive', () => {
    const seeds = [1, 2, 7, 11, 31, 64, 256, 1024, 0xc0ffee, 0xfeed];
    for (const seed of seeds) {
      const sys = new HardTierReactionSystem<WorldSnapshot>({
        inputDelay: { mode: 'sampled', minFrames: 15, maxFrames: 20 },
        rng: new Rng(seed),
      });
      const d = sys.getInputDelayFrames();
      expect(d).toBeGreaterThanOrEqual(15);
      expect(d).toBeLessThanOrEqual(20);
    }
  });

  it('explores all six discrete delays across enough resamples', () => {
    const rng = new Rng(0x515151);
    const sys = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'sampled', minFrames: 15, maxFrames: 20 },
      rng,
    });
    const seen = new Set<number>();
    seen.add(sys.getInputDelayFrames());
    for (let i = 0; i < 6000; i += 1) {
      sys.reconfigureDelay({
        mode: 'sampled',
        minFrames: 15,
        maxFrames: 20,
      });
      seen.add(sys.getInputDelayFrames());
    }
    for (const expected of [15, 16, 17, 18, 19, 20]) {
      expect(seen.has(expected)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// peekFrame / hasWarmedUp / size
// ---------------------------------------------------------------------------

describe('HardTierReactionSystem — introspection', () => {
  it('peekFrame returns exactly the entry at the requested frame', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>();
    sys.pushPerception(5, makeWorld(5, 50));
    expect(sys.peekFrame(5)?.tickIndex).toBe(5);
    expect(sys.peekFrame(4)).toBeNull();
    expect(sys.peekFrame(6)).toBeNull();
  });

  it('size reports the number of buffered perceptions', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>();
    expect(sys.size()).toBe(0);
    sys.pushPerception(0, makeWorld(0, 0));
    sys.pushPerception(1, makeWorld(1, 1));
    expect(sys.size()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

describe('HardTierReactionSystem — clear()', () => {
  it('discards every buffered perception', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>();
    sys.pushPerception(0, makeWorld(0, 0));
    sys.pushPerception(1, makeWorld(1, 1));
    sys.clear();
    expect(sys.size()).toBe(0);
    expect(sys.perceive(50)).toBeNull();
  });

  it('clears the events facet when present', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot, string>({
      eventRange: HARD_TIER_INPUT_DELAY_RANGE,
      rng: new Rng(1),
    });
    sys.events!.observe('attackStart', 0);
    expect(sys.events!.pendingCount()).toBe(1);
    sys.clear();
    expect(sys.events!.pendingCount()).toBe(0);
  });

  it('is idempotent', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>();
    expect(() => {
      sys.clear();
      sys.clear();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Snapshot / restore — replay system support
// ---------------------------------------------------------------------------

describe('HardTierReactionSystem — snapshot / restore', () => {
  it('round-trips delay + entries without events', () => {
    const src = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'fixed', frames: 18 },
    });
    for (let f = 0; f <= 5; f += 1) {
      src.pushPerception(f, makeWorld(f, f * 10));
    }
    const snap = src.snapshot();

    const dst = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'fixed', frames: 17 },
    });
    dst.pushPerception(99, makeWorld(99, 999)); // contaminate
    dst.restoreSnapshot(snap);

    expect(dst.getInputDelayFrames()).toBe(18);
    expect(dst.size()).toBe(6);
    expect(dst.peekFrame(3)?.opponents[0]?.position.x).toBe(30);
  });

  it('round-trips the events facet when present', () => {
    const rng = new Rng(0xabc);
    const src = new HardTierReactionSystem<WorldSnapshot, string>({
      inputDelay: { mode: 'fixed', frames: 17 },
      eventRange: HARD_TIER_INPUT_DELAY_RANGE,
      rng,
    });
    src.events!.observe('jump', 5);
    src.events!.observe('attackStart', 7);
    const snap = src.snapshot();
    expect(snap.events).toBeDefined();

    const rng2 = new Rng(0x123);
    const dst = new HardTierReactionSystem<WorldSnapshot, string>({
      inputDelay: { mode: 'fixed', frames: 17 },
      eventRange: HARD_TIER_INPUT_DELAY_RANGE,
      rng: rng2,
    });
    dst.restoreSnapshot(snap);
    expect(dst.events!.pendingCount()).toBe(2);
  });

  it('rejects entries in decreasing frame order', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>();
    expect(() =>
      sys.restoreSnapshot({
        inputDelayFrames: 17,
        inputDelaySpec: { mode: 'fixed', frames: 17 },
        bufferCapacity: 64,
        entries: [
          { frame: 10, snapshot: makeWorld(10, 0) },
          { frame: 5, snapshot: makeWorld(5, 0) },
        ],
      }),
    ).toThrow(/non-decreasing/);
  });

  it('rejects negative-frame entries', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>();
    expect(() =>
      sys.restoreSnapshot({
        inputDelayFrames: 17,
        inputDelaySpec: { mode: 'fixed', frames: 17 },
        bufferCapacity: 64,
        entries: [{ frame: -1, snapshot: makeWorld(0, 0) }],
      }),
    ).toThrow(/snapshot entry frame/);
  });

  it('rejects inputDelayFrames > bufferCapacity', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>({
      bufferCapacity: 30,
    });
    expect(() =>
      sys.restoreSnapshot({
        inputDelayFrames: 50,
        inputDelaySpec: { mode: 'fixed', frames: 50 },
        bufferCapacity: 30,
        entries: [],
      }),
    ).toThrow(/bufferCapacity/);
  });

  it('rejects entries longer than bufferCapacity', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'fixed', frames: 1 },
      bufferCapacity: 3,
    });
    expect(() =>
      sys.restoreSnapshot({
        inputDelayFrames: 1,
        inputDelaySpec: { mode: 'fixed', frames: 1 },
        bufferCapacity: 3,
        entries: [
          { frame: 0, snapshot: makeWorld(0, 0) },
          { frame: 1, snapshot: makeWorld(1, 0) },
          { frame: 2, snapshot: makeWorld(2, 0) },
          { frame: 3, snapshot: makeWorld(3, 0) },
        ],
      }),
    ).toThrow(/bufferCapacity/);
  });

  it('throws when snapshot includes events but the system has no events facet', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot, string>();
    expect(() =>
      sys.restoreSnapshot({
        inputDelayFrames: 17,
        inputDelaySpec: { mode: 'fixed', frames: 17 },
        bufferCapacity: 64,
        entries: [],
        events: { queue: [] },
      }),
    ).toThrow(/eventRange/);
  });

  it('clears live events queue when the snapshot omits events but the system has the facet', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot, string>({
      eventRange: HARD_TIER_INPUT_DELAY_RANGE,
      rng: new Rng(1),
    });
    sys.events!.observe('jab', 0);
    sys.restoreSnapshot({
      inputDelayFrames: 17,
      inputDelaySpec: { mode: 'fixed', frames: 17 },
      bufferCapacity: 64,
      entries: [],
    });
    expect(sys.events!.pendingCount()).toBe(0);
  });

  it('resumes perceive() correctly after restore', () => {
    const src = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'fixed', frames: 5 },
    });
    for (let f = 0; f <= 10; f += 1) {
      src.pushPerception(f, makeWorld(f, f * 100));
    }
    const snap = src.snapshot();
    const dst = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'fixed', frames: 1 },
    });
    dst.restoreSnapshot(snap);
    expect(dst.perceive(10)!.opponents[0]?.position.x).toBe(500); // frame 5
  });
});

// ---------------------------------------------------------------------------
// perceiveOpponent helper
// ---------------------------------------------------------------------------

describe('perceiveOpponent helper', () => {
  it('returns the perceived opponent at the given slot from the delayed snapshot', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'fixed', frames: 5 },
    });
    for (let f = 0; f <= 10; f += 1) {
      sys.pushPerception(f, makeWorld(f, f * 100));
    }
    const opp = perceiveOpponent(sys, 10, 1);
    expect(opp).not.toBeNull();
    expect(opp!.position.x).toBe(500); // frame 5 — delayed read
  });

  it('returns null during warm-up', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'fixed', frames: 17 },
    });
    sys.pushPerception(0, makeWorld(0, 0));
    expect(perceiveOpponent(sys, 0, 1)).toBeNull();
  });

  it('returns null when the slot has no live opponent in the delayed snapshot', () => {
    const sys = new HardTierReactionSystem<WorldSnapshot>({
      inputDelay: { mode: 'fixed', frames: 1 },
    });
    sys.pushPerception(0, makeWorld(0, 0));
    sys.pushPerception(1, makeWorld(1, 1));
    // Slot 2 was never present.
    expect(perceiveOpponent(sys, 1, 2)).toBeNull();
  });
});
