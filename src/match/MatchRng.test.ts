import { describe, it, expect } from 'vitest';
import {
  MatchRng,
  hashSeedWithLabel,
  type MatchRngState,
} from './MatchRng';
import { Rng } from '../utils/Rng';

/**
 * AC 30001 Sub-AC 1 — `MatchRng` is the single deterministic source
 * for all in-match randomness. These tests lock down the four
 * properties the replay system depends on:
 *
 *   1. **Seed determinism.** Constructing a MatchRng with the same
 *      seed must produce identical sequences for both the root and
 *      every named substream.
 *
 *   2. **Stream isolation.** Pulling values from one stream must never
 *      shift another stream's sequence. Adding a new stream to the
 *      engine in a future milestone cannot break old replays.
 *
 *   3. **Stream identity caching.** Repeated `stream(label)` calls
 *      return the *same* `Rng` instance, so a subsystem holding the
 *      reference for the whole match keeps a single PRNG sequence
 *      across frames.
 *
 *   4. **Snapshot/restore round-trip.** Capturing state at frame N and
 *      restoring it on a fresh MatchRng (same seed) reproduces the
 *      identical post-frame-N stream — the contract the M4 hybrid
 *      replay system relies on every 300 frames.
 */

// ---------------------------------------------------------------------------
// 1. Seed determinism
// ---------------------------------------------------------------------------

describe('MatchRng — seed determinism', () => {
  it('same seed produces identical root sequences', () => {
    const a = new MatchRng(0xc0ffee);
    const b = new MatchRng(0xc0ffee);
    const aSeq = Array.from({ length: 16 }, () => a.next());
    const bSeq = Array.from({ length: 16 }, () => b.next());
    expect(aSeq).toEqual(bSeq);
  });

  it('same seed produces identical streams for the same label', () => {
    const a = new MatchRng(42);
    const b = new MatchRng(42);
    const aAi = Array.from({ length: 16 }, () => a.stream('ai').next());
    const bAi = Array.from({ length: 16 }, () => b.stream('ai').next());
    expect(aAi).toEqual(bAi);
  });

  it('different seeds produce different root sequences', () => {
    const a = new MatchRng(1);
    const b = new MatchRng(2);
    expect(a.next()).not.toEqual(b.next());
  });

  it('clamps the seed to unsigned 32-bit (negative seed is normalised)', () => {
    const a = new MatchRng(-1);
    const b = new MatchRng(0xffffffff);
    expect(a.getSeed()).toBe(0xffffffff);
    expect(b.getSeed()).toBe(0xffffffff);
    expect(a.next()).toBe(b.next());
  });

  it('exposes the captured seed verbatim via getSeed()', () => {
    expect(new MatchRng(0).getSeed()).toBe(0);
    expect(new MatchRng(0x12345678).getSeed()).toBe(0x12345678);
  });
});

// ---------------------------------------------------------------------------
// 2. Stream isolation
// ---------------------------------------------------------------------------

describe('MatchRng — stream isolation', () => {
  it('different stream labels produce different sequences', () => {
    const m = new MatchRng(0xc0ffee);
    const ai = Array.from({ length: 8 }, () => m.stream('ai').next());
    const fresh = new MatchRng(0xc0ffee);
    const hazard = Array.from({ length: 8 }, () => fresh.stream('hazard').next());
    expect(ai).not.toEqual(hazard);
  });

  it('pulling from one stream does not affect another stream', () => {
    // Two MatchRng's with the same seed: one only pulls hazard, the
    // other heavily pulls ai *first* and then pulls hazard. Because
    // streams are independently seeded, both hazard sequences must
    // match exactly.
    const a = new MatchRng(0x900d5eed);
    const b = new MatchRng(0x900d5eed);
    for (let i = 0; i < 100; i++) b.stream('ai').next();
    const aHazard = Array.from({ length: 16 }, () => a.stream('hazard').next());
    const bHazard = Array.from({ length: 16 }, () => b.stream('hazard').next());
    expect(aHazard).toEqual(bHazard);
  });

  it('pulling from a stream does not affect the root sequence', () => {
    const a = new MatchRng(7);
    const b = new MatchRng(7);
    for (let i = 0; i < 32; i++) b.stream('ai').next();
    expect(a.next()).toEqual(b.next());
    expect(a.range(0, 1000)).toEqual(b.range(0, 1000));
  });

  it('pulling from the root does not affect any stream', () => {
    const a = new MatchRng(99);
    const b = new MatchRng(99);
    // Drain a's root before it ever touches a stream.
    for (let i = 0; i < 100; i++) a.next();
    const aAi = Array.from({ length: 8 }, () => a.stream('ai').next());
    const bAi = Array.from({ length: 8 }, () => b.stream('ai').next());
    expect(aAi).toEqual(bAi);
  });
});

// ---------------------------------------------------------------------------
// 3. Stream identity caching
// ---------------------------------------------------------------------------

describe('MatchRng — stream identity caching', () => {
  it('returns the same Rng instance for repeated stream(label) calls', () => {
    const m = new MatchRng(123);
    const a = m.stream('ai');
    const b = m.stream('ai');
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(Rng);
  });

  it('hasStream() reflects materialised streams; listStreams() preserves order', () => {
    const m = new MatchRng(123);
    expect(m.hasStream('ai')).toBe(false);
    expect(m.listStreams()).toEqual([]);
    m.stream('ai').next();
    m.stream('hazard').next();
    m.stream('visual').next();
    expect(m.hasStream('ai')).toBe(true);
    expect(m.hasStream('hazard')).toBe(true);
    expect(m.hasStream('particle')).toBe(false);
    expect(m.listStreams()).toEqual(['ai', 'hazard', 'visual']);
  });
});

// ---------------------------------------------------------------------------
// 4. Snapshot / restore round-trip
// ---------------------------------------------------------------------------

describe('MatchRng — snapshot/restore', () => {
  it('snapshot+restore reproduces post-snapshot stream behaviour bit-identically', () => {
    const a = new MatchRng(0xdeadbeef);
    // Touch a couple of streams + the root so the snapshot has real
    // content.
    for (let i = 0; i < 50; i++) a.next();
    for (let i = 0; i < 70; i++) a.stream('ai').next();
    for (let i = 0; i < 25; i++) a.stream('hazard').next();
    const snap = a.snapshotState();

    // Continue the original RNG to capture a "ground truth" continuation.
    const aRoot = Array.from({ length: 8 }, () => a.next());
    const aAi = Array.from({ length: 8 }, () => a.stream('ai').next());
    const aHaz = Array.from({ length: 8 }, () => a.stream('hazard').next());

    // Build a fresh MatchRng with the same seed and restore the snap.
    const b = new MatchRng(0xdeadbeef);
    b.restoreState(snap);
    const bRoot = Array.from({ length: 8 }, () => b.next());
    const bAi = Array.from({ length: 8 }, () => b.stream('ai').next());
    const bHaz = Array.from({ length: 8 }, () => b.stream('hazard').next());

    expect(bRoot).toEqual(aRoot);
    expect(bAi).toEqual(aAi);
    expect(bHaz).toEqual(aHaz);
  });

  it('restore creates streams that did not yet exist on the target', () => {
    const a = new MatchRng(1);
    a.stream('ai').next();
    a.stream('hazard').next();
    const snap = a.snapshotState();

    const b = new MatchRng(1);
    expect(b.hasStream('ai')).toBe(false);
    expect(b.hasStream('hazard')).toBe(false);
    b.restoreState(snap);
    expect(b.hasStream('ai')).toBe(true);
    expect(b.hasStream('hazard')).toBe(true);
  });

  it('restore refuses a snapshot whose seed differs from the live MatchRng', () => {
    const m = new MatchRng(1);
    const wrongSeed: MatchRngState = {
      seed: 2,
      root: 0,
      streams: {},
    };
    expect(() => m.restoreState(wrongSeed)).toThrowError(/seed mismatch/);
  });

  it('snapshot is JSON-safe (round-trips through JSON.stringify)', () => {
    const m = new MatchRng(0xfeedface);
    m.stream('ai').next();
    m.stream('hazard').next();
    const snap = m.snapshotState();
    const round = JSON.parse(JSON.stringify(snap)) as MatchRngState;
    expect(round).toEqual(snap);
  });
});

// ---------------------------------------------------------------------------
// 5. hashSeedWithLabel — internal hash exposed for stream-derivation
// ---------------------------------------------------------------------------

describe('hashSeedWithLabel', () => {
  it('is deterministic for identical inputs', () => {
    expect(hashSeedWithLabel(123, 'ai')).toBe(hashSeedWithLabel(123, 'ai'));
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = hashSeedWithLabel(0xc0ffee, 'hazard');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it('separates similar labels (avoids collisions on near-misses)', () => {
    const a = hashSeedWithLabel(1, 'ai');
    const b = hashSeedWithLabel(1, 'ai2');
    const c = hashSeedWithLabel(1, 'AI');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it('separates similar seeds (0/1/2 produce well-spread hashes)', () => {
    const h0 = hashSeedWithLabel(0, 'ai');
    const h1 = hashSeedWithLabel(1, 'ai');
    const h2 = hashSeedWithLabel(2, 'ai');
    expect(new Set([h0, h1, h2]).size).toBe(3);
  });
});
