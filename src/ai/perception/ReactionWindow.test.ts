import { describe, expect, it } from 'vitest';
import { Rng } from '../../utils/Rng';
import {
  ReactionWindow,
  type ReactionWindowEntry,
  type ReactionWindowSnapshot,
} from './ReactionWindow';

// ────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ────────────────────────────────────────────────────────────────────────────

interface PlayerEvent {
  readonly kind: 'attackStart' | 'jump' | 'shieldRelease';
  readonly playerId: number;
}

const HARD_TIER = { minDelayFrames: 15, maxDelayFrames: 20 } as const;

function makeWindow(
  range: { minDelayFrames: number; maxDelayFrames: number } = HARD_TIER,
  seed = 0xc0ffee,
): { window: ReactionWindow<PlayerEvent>; rng: Rng } {
  const rng = new Rng(seed);
  return {
    window: new ReactionWindow<PlayerEvent>({ ...range, rng }),
    rng,
  };
}

function evt(
  kind: PlayerEvent['kind'],
  playerId: number = 1,
): PlayerEvent {
  return { kind, playerId };
}

// ────────────────────────────────────────────────────────────────────────────
// Construction validation
// ────────────────────────────────────────────────────────────────────────────

describe('ReactionWindow — construction', () => {
  it('rejects non-positive minDelayFrames', () => {
    const rng = new Rng(1);
    expect(
      () =>
        new ReactionWindow({ minDelayFrames: 0, maxDelayFrames: 5, rng }),
    ).toThrow(/minDelayFrames/);
    expect(
      () =>
        new ReactionWindow({ minDelayFrames: -3, maxDelayFrames: 5, rng }),
    ).toThrow(/minDelayFrames/);
  });

  it('rejects non-integer minDelayFrames', () => {
    const rng = new Rng(1);
    expect(
      () =>
        new ReactionWindow({ minDelayFrames: 2.5, maxDelayFrames: 5, rng }),
    ).toThrow(/minDelayFrames/);
  });

  it('rejects non-positive maxDelayFrames', () => {
    const rng = new Rng(1);
    expect(
      () =>
        new ReactionWindow({ minDelayFrames: 1, maxDelayFrames: 0, rng }),
    ).toThrow(/maxDelayFrames/);
  });

  it('rejects min > max', () => {
    const rng = new Rng(1);
    expect(
      () =>
        new ReactionWindow({ minDelayFrames: 20, maxDelayFrames: 15, rng }),
    ).toThrow(/<=/);
  });

  it('accepts min === max (degenerate fixed-delay window)', () => {
    const rng = new Rng(1);
    expect(
      () =>
        new ReactionWindow({ minDelayFrames: 17, maxDelayFrames: 17, rng }),
    ).not.toThrow();
  });

  it('exposes the configured min/max for diagnostics', () => {
    const { window } = makeWindow();
    expect(window.getMinDelayFrames()).toBe(15);
    expect(window.getMaxDelayFrames()).toBe(20);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// observe(): delay sampling, payload preservation, validation
// ────────────────────────────────────────────────────────────────────────────

describe('ReactionWindow — observe()', () => {
  it('samples a delay strictly inside the configured band', () => {
    const { window } = makeWindow(HARD_TIER, 0xa1b2c3);
    for (let frame = 0; frame < 100; frame += 1) {
      const entry = window.observe(evt('jump'), frame);
      const delay = entry.visibleFrame - entry.observedFrame;
      expect(delay).toBeGreaterThanOrEqual(HARD_TIER.minDelayFrames);
      expect(delay).toBeLessThanOrEqual(HARD_TIER.maxDelayFrames);
      expect(Number.isInteger(delay)).toBe(true);
    }
  });

  it('honours min === max as a fixed-latency line', () => {
    const rng = new Rng(7);
    const window = new ReactionWindow<PlayerEvent>({
      minDelayFrames: 17,
      maxDelayFrames: 17,
      rng,
    });
    const e1 = window.observe(evt('jump'), 0);
    const e2 = window.observe(evt('attackStart'), 5);
    expect(e1.visibleFrame - e1.observedFrame).toBe(17);
    expect(e2.visibleFrame - e2.observedFrame).toBe(17);
    expect(e1.visibleFrame).toBe(17);
    expect(e2.visibleFrame).toBe(22);
  });

  it('returns the resolved entry with the same payload reference', () => {
    const { window } = makeWindow();
    const payload = evt('attackStart');
    const entry = window.observe(payload, 42);
    expect(entry.payload).toBe(payload);
    expect(entry.observedFrame).toBe(42);
    expect(entry.visibleFrame).toBeGreaterThan(42);
  });

  it('rejects negative or non-integer currentFrame', () => {
    const { window } = makeWindow();
    expect(() => window.observe(evt('jump'), -1)).toThrow(/currentFrame/);
    expect(() => window.observe(evt('jump'), 1.25)).toThrow(/currentFrame/);
  });

  it('queues observations in insertion order', () => {
    const { window } = makeWindow();
    const a = window.observe(evt('jump', 1), 0);
    const b = window.observe(evt('attackStart', 1), 0);
    const c = window.observe(evt('shieldRelease', 2), 0);
    expect(window.peekPending()).toEqual([a, b, c]);
    expect(window.pendingCount()).toBe(3);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// pollReady(): visibility-frame gating and FIFO ordering
// ────────────────────────────────────────────────────────────────────────────

describe('ReactionWindow — pollReady()', () => {
  it('returns nothing until an entry reaches its visibility frame', () => {
    const { window } = makeWindow();
    const entry = window.observe(evt('jump'), 0);
    for (let frame = 0; frame < entry.visibleFrame; frame += 1) {
      expect(window.pollReady(frame)).toEqual([]);
    }
    expect(window.pollReady(entry.visibleFrame)).toEqual([entry]);
  });

  it('treats visibleFrame === currentFrame as ready', () => {
    const rng = new Rng(1);
    const window = new ReactionWindow<PlayerEvent>({
      minDelayFrames: 15,
      maxDelayFrames: 15,
      rng,
    });
    const entry = window.observe(evt('jump'), 100);
    expect(entry.visibleFrame).toBe(115);
    expect(window.pollReady(114)).toEqual([]);
    expect(window.pollReady(115)).toEqual([entry]);
  });

  it('removes ready entries from the queue (drain semantics)', () => {
    const { window } = makeWindow();
    const a = window.observe(evt('jump'), 0);
    expect(window.pollReady(a.visibleFrame)).toEqual([a]);
    expect(window.pollReady(a.visibleFrame)).toEqual([]);
    expect(window.pendingCount()).toBe(0);
  });

  it('returns multiple ready entries in observation order', () => {
    const { window } = makeWindow();
    const a = window.observe(evt('jump'), 0);
    const b = window.observe(evt('attackStart'), 0);
    const c = window.observe(evt('shieldRelease'), 0);
    const ready = window.pollReady(1000); // far future — all visible
    expect(ready).toEqual([a, b, c]);
  });

  it('keeps not-yet-visible entries pending while draining ready ones', () => {
    const { window } = makeWindow(
      { minDelayFrames: 15, maxDelayFrames: 20 },
      0xdeadbeef,
    );
    const early = window.observe(evt('jump'), 0);
    const late = window.observe(evt('attackStart'), 50);

    // Drain only `early`.
    const ready = window.pollReady(early.visibleFrame);
    expect(ready).toEqual([early]);
    expect(window.pendingCount()).toBe(1);
    expect(window.peekPending()).toEqual([late]);
  });

  it('handles jitter where an earlier observation visible AFTER a later one', () => {
    // Construct a hand-rolled scenario via min===max=15 then min===max=15
    // is uniform; instead use a stub Rng-equivalent by feeding the same
    // RNG carefully so we know the exact delays. We use min=15, max=20
    // and rely on actual RNG output: even if delays are jittered, the
    // pollReady contract is "all entries whose visibleFrame <= currentFrame
    // are returned in insertion order."
    const { window } = makeWindow();
    const e1 = window.observe(evt('jump'), 0);
    // Observe a second event 1 frame later — its visibility is at most
    // 1+20=21, possibly earlier than e1.visibleFrame which is at most 20.
    const e2 = window.observe(evt('attackStart'), 1);

    const both = window.pollReady(1000);
    // Insertion order is preserved regardless of relative visibility.
    expect(both[0]).toBe(e1);
    expect(both[1]).toBe(e2);
  });

  it('rejects negative or non-integer currentFrame', () => {
    const { window } = makeWindow();
    expect(() => window.pollReady(-1)).toThrow(/currentFrame/);
    expect(() => window.pollReady(0.5)).toThrow(/currentFrame/);
  });

  it('returns an empty array fast when nothing is queued', () => {
    const { window } = makeWindow();
    expect(window.pollReady(0)).toEqual([]);
    expect(window.pollReady(9999)).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Determinism — identical seed + sequence ⇒ identical visibility frames
// ────────────────────────────────────────────────────────────────────────────

describe('ReactionWindow — determinism', () => {
  it('produces identical visibility frames for identically-seeded windows', () => {
    const seed = 0x1234abcd;
    const a = new ReactionWindow<PlayerEvent>({
      ...HARD_TIER,
      rng: new Rng(seed),
    });
    const b = new ReactionWindow<PlayerEvent>({
      ...HARD_TIER,
      rng: new Rng(seed),
    });

    const frames = [0, 5, 12, 30, 91, 200, 999];
    const aOut: ReactionWindowEntry<PlayerEvent>[] = frames.map((f) =>
      a.observe(evt('jump'), f),
    );
    const bOut: ReactionWindowEntry<PlayerEvent>[] = frames.map((f) =>
      b.observe(evt('jump'), f),
    );

    expect(aOut.map((e) => e.visibleFrame)).toEqual(
      bOut.map((e) => e.visibleFrame),
    );
  });

  it('uses Rng.range — does not call Math.random', () => {
    // Snapshot Math.random and assert no usage during observe().
    const original = Math.random;
    let calls = 0;
    Math.random = (): number => {
      calls += 1;
      return 0;
    };
    try {
      const { window } = makeWindow();
      for (let i = 0; i < 50; i += 1) {
        window.observe(evt('jump'), i);
      }
      expect(calls).toBe(0);
    } finally {
      Math.random = original;
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Hard-tier band — AC-anchored sanity check
// ────────────────────────────────────────────────────────────────────────────

describe('ReactionWindow — Hard-tier 15-20 frame contract', () => {
  it('every observation lands inside [15, 20] inclusive over many seeds', () => {
    const seeds = [
      1, 2, 3, 7, 11, 17, 31, 64, 128, 1024, 0xabc, 0xfeed, 0xcafe,
    ];
    for (const seed of seeds) {
      const rng = new Rng(seed);
      const window = new ReactionWindow<PlayerEvent>({
        ...HARD_TIER,
        rng,
      });
      for (let frame = 0; frame < 200; frame += 1) {
        const entry = window.observe(evt('jump'), frame);
        const delay = entry.visibleFrame - entry.observedFrame;
        expect(delay).toBeGreaterThanOrEqual(15);
        expect(delay).toBeLessThanOrEqual(20);
      }
    }
  });

  it('explores all six discrete delays across enough samples (no off-by-one band)', () => {
    // With 6 possible delays and a uniform-ish PRNG, 6000 samples should
    // hit every value with overwhelming probability — if any value is
    // missing the band is implemented incorrectly (e.g. off-by-one upper
    // bound).
    const rng = new Rng(0x515151);
    const window = new ReactionWindow<PlayerEvent>({
      ...HARD_TIER,
      rng,
    });
    const seen = new Set<number>();
    for (let frame = 0; frame < 6000; frame += 1) {
      const entry = window.observe(evt('jump'), frame);
      seen.add(entry.visibleFrame - entry.observedFrame);
    }
    for (const expected of [15, 16, 17, 18, 19, 20]) {
      expect(seen.has(expected)).toBe(true);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// peekPending() / pendingCount() / clear()
// ────────────────────────────────────────────────────────────────────────────

describe('ReactionWindow — pending introspection and clear()', () => {
  it('peekPending returns a fresh array (mutation-safe)', () => {
    const { window } = makeWindow();
    window.observe(evt('jump'), 0);
    const view = window.peekPending();
    // Cast to the mutable array type for the test only.
    (view as ReactionWindowEntry<PlayerEvent>[]).pop();
    expect(window.pendingCount()).toBe(1);
  });

  it('clear() removes every queued observation', () => {
    const { window } = makeWindow();
    window.observe(evt('jump'), 0);
    window.observe(evt('attackStart'), 1);
    window.observe(evt('shieldRelease'), 2);
    expect(window.pendingCount()).toBe(3);
    window.clear();
    expect(window.pendingCount()).toBe(0);
    expect(window.pollReady(1000)).toEqual([]);
  });

  it('clear() is idempotent on an empty queue', () => {
    const { window } = makeWindow();
    expect(() => window.clear()).not.toThrow();
    expect(() => window.clear()).not.toThrow();
    expect(window.pendingCount()).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// snapshot() / restoreSnapshot() — replay system support
// ────────────────────────────────────────────────────────────────────────────

describe('ReactionWindow — snapshot / restore', () => {
  it('snapshot captures pending entries verbatim', () => {
    const { window } = makeWindow();
    const a = window.observe(evt('jump'), 0);
    const b = window.observe(evt('attackStart'), 5);
    const snap = window.snapshot();
    expect(snap.queue).toEqual([a, b]);
  });

  it('snapshot returns a fresh array detached from internal state', () => {
    const { window } = makeWindow();
    window.observe(evt('jump'), 0);
    const snap = window.snapshot();
    window.observe(evt('attackStart'), 1);
    expect(snap.queue).toHaveLength(1);
  });

  it('restoreSnapshot rehydrates the queue from a serialised snapshot', () => {
    const { window: src } = makeWindow();
    src.observe(evt('jump'), 0);
    src.observe(evt('attackStart'), 5);
    const snap = src.snapshot();

    const { window: dst } = makeWindow(HARD_TIER, 0x12345);
    dst.observe(evt('shieldRelease'), 99); // contaminate destination
    dst.restoreSnapshot(snap);

    expect(dst.peekPending()).toEqual(snap.queue);
  });

  it('restoreSnapshot accepts an empty snapshot and clears existing queue', () => {
    const { window } = makeWindow();
    window.observe(evt('jump'), 0);
    window.restoreSnapshot({ queue: [] });
    expect(window.pendingCount()).toBe(0);
  });

  it('restoreSnapshot rejects entries with negative frames', () => {
    const { window } = makeWindow();
    const bad: ReactionWindowSnapshot<PlayerEvent> = {
      queue: [
        { payload: evt('jump'), observedFrame: -1, visibleFrame: 5 },
      ],
    };
    expect(() => window.restoreSnapshot(bad)).toThrow(/observedFrame/);
  });

  it('restoreSnapshot rejects entries with visibleFrame < observedFrame', () => {
    const { window } = makeWindow();
    const bad: ReactionWindowSnapshot<PlayerEvent> = {
      queue: [
        { payload: evt('jump'), observedFrame: 100, visibleFrame: 99 },
      ],
    };
    expect(() => window.restoreSnapshot(bad)).toThrow(/visibleFrame/);
  });

  it('restored window resumes pollReady semantics correctly', () => {
    const rng = new Rng(0xdada);
    const window = new ReactionWindow<PlayerEvent>({
      minDelayFrames: 15,
      maxDelayFrames: 15,
      rng,
    });
    const entry = window.observe(evt('jump'), 100);
    const snap = window.snapshot();

    const rng2 = new Rng(0xdada);
    const fresh = new ReactionWindow<PlayerEvent>({
      minDelayFrames: 15,
      maxDelayFrames: 15,
      rng: rng2,
    });
    fresh.restoreSnapshot(snap);
    expect(fresh.pollReady(114)).toEqual([]);
    expect(fresh.pollReady(115)).toEqual([entry]);
  });
});
