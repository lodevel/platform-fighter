import { describe, it, expect } from 'vitest';
import {
  initialiseMatchRng,
  initialiseMatchRngFromConfig,
  pickMatchSeed,
} from './MatchInit';
import { MatchRng } from './MatchRng';
import type { MatchConfig } from '../types';

/**
 * AC 30001 Sub-AC 1 — match-init wiring tests.
 *
 * `initialiseMatchRng` is the single capture point: every gameplay
 * scene calls it once during `create()` so the match-scoped RNG is
 * deterministic regardless of which call site started the scene.
 *
 * These tests lock down:
 *   • Resolution order — `MatchConfig.rngSeed` wins over the fallback,
 *     fallback applies otherwise.
 *   • Bad-input safety — non-finite seeds fall through to the fallback
 *     so a corrupt MatchConfig can't silently produce an
 *     unreproducible match.
 *   • Determinism end-to-end — two calls with the same inputs produce
 *     MatchRng instances whose root + streams match bit-for-bit.
 */

// ---------------------------------------------------------------------------
// pickMatchSeed — pure resolution helper
// ---------------------------------------------------------------------------

describe('pickMatchSeed', () => {
  it('uses configSeed when finite', () => {
    expect(pickMatchSeed({ configSeed: 7, fallbackSeed: 99 })).toBe(7);
    expect(pickMatchSeed({ configSeed: 0, fallbackSeed: 99 })).toBe(0);
    expect(pickMatchSeed({ configSeed: 0xc0ffee, fallbackSeed: 99 })).toBe(
      0xc0ffee,
    );
  });

  it('falls back to fallbackSeed when configSeed is undefined', () => {
    expect(pickMatchSeed({ fallbackSeed: 0xdeadbeef })).toBe(0xdeadbeef);
  });

  it('falls back to fallbackSeed when configSeed is non-finite', () => {
    expect(pickMatchSeed({ configSeed: NaN, fallbackSeed: 42 })).toBe(42);
    expect(pickMatchSeed({ configSeed: Infinity, fallbackSeed: 42 })).toBe(
      42,
    );
    expect(pickMatchSeed({ configSeed: -Infinity, fallbackSeed: 42 })).toBe(
      42,
    );
  });

  it('clamps the resolved seed to unsigned 32-bit', () => {
    expect(pickMatchSeed({ configSeed: -1, fallbackSeed: 0 })).toBe(0xffffffff);
    expect(pickMatchSeed({ configSeed: 0x1_ffff_ffff, fallbackSeed: 0 })).toBe(
      0xffffffff,
    );
  });
});

// ---------------------------------------------------------------------------
// initialiseMatchRng — seed capture + live MatchRng
// ---------------------------------------------------------------------------

describe('initialiseMatchRng', () => {
  it('captures the resolved seed verbatim and returns a live MatchRng', () => {
    const { seed, rng } = initialiseMatchRng({
      configSeed: 0x1234,
      fallbackSeed: 0,
    });
    expect(seed).toBe(0x1234);
    expect(rng).toBeInstanceOf(MatchRng);
    expect(rng.getSeed()).toBe(0x1234);
  });

  it('two calls with the same seed produce identical sequences', () => {
    const a = initialiseMatchRng({ configSeed: 0xc0ffee, fallbackSeed: 0 });
    const b = initialiseMatchRng({ configSeed: 0xc0ffee, fallbackSeed: 0 });
    const aRoot = Array.from({ length: 8 }, () => a.rng.next());
    const bRoot = Array.from({ length: 8 }, () => b.rng.next());
    const aAi = Array.from({ length: 8 }, () => a.rng.stream('ai').next());
    const bAi = Array.from({ length: 8 }, () => b.rng.stream('ai').next());
    expect(aRoot).toEqual(bRoot);
    expect(aAi).toEqual(bAi);
  });

  it('uses fallbackSeed when no configSeed is supplied', () => {
    const { seed, rng } = initialiseMatchRng({ fallbackSeed: 0xfeedface });
    expect(seed).toBe(0xfeedface);
    expect(rng.getSeed()).toBe(0xfeedface);
  });

  it('rejects non-finite configSeed and falls back', () => {
    const { seed } = initialiseMatchRng({
      configSeed: NaN,
      fallbackSeed: 0xabc,
    });
    expect(seed).toBe(0xabc);
  });
});

// ---------------------------------------------------------------------------
// initialiseMatchRngFromConfig — convenience for callers holding a MatchConfig
// ---------------------------------------------------------------------------

describe('initialiseMatchRngFromConfig', () => {
  const baseConfig: MatchConfig = {
    mode: 'stocks',
    stockCount: 3,
    stageId: 'flat',
    players: [],
    rngSeed: 0,
  };

  it("uses MatchConfig.rngSeed when present", () => {
    const cfg: MatchConfig = { ...baseConfig, rngSeed: 0x42 };
    const { seed } = initialiseMatchRngFromConfig(cfg, 0x99);
    expect(seed).toBe(0x42);
  });

  it("falls back when given a null config (e.g. no MatchConfig piped through yet)", () => {
    const { seed } = initialiseMatchRngFromConfig(null, 0xabc);
    expect(seed).toBe(0xabc);
  });

  it('falls back when given undefined', () => {
    const { seed } = initialiseMatchRngFromConfig(undefined, 0xabc);
    expect(seed).toBe(0xabc);
  });

  it('returns a MatchRng whose stream(label) sequence matches a reconstruction from the seed', () => {
    const cfg: MatchConfig = { ...baseConfig, rngSeed: 0x10101 };
    const { rng } = initialiseMatchRngFromConfig(cfg, 0);
    const reconstruction = new MatchRng(0x10101);
    const a = Array.from({ length: 8 }, () => rng.stream('hazard').next());
    const b = Array.from({ length: 8 }, () => reconstruction.stream('hazard').next());
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// "single source captured at match start" — end-to-end determinism
// ---------------------------------------------------------------------------

describe('match-init end-to-end determinism', () => {
  it('a recorded stream sequence reproduces given only the captured seed', () => {
    // 1) Match A: capture a seed, run a few "subsystems" against it.
    const matchA = initialiseMatchRng({ fallbackSeed: 0xdef0 });
    const aiSeq = Array.from({ length: 5 }, () =>
      matchA.rng.stream('ai').next(),
    );
    const hazardSeq = Array.from({ length: 5 }, () =>
      matchA.rng.stream('hazard').next(),
    );

    // 2) Match B: only the captured seed survives (the live RNG is gone).
    //    The replay system has just the seed and recreates everything.
    const matchB = initialiseMatchRng({ configSeed: matchA.seed, fallbackSeed: 0 });
    const aiSeqB = Array.from({ length: 5 }, () =>
      matchB.rng.stream('ai').next(),
    );
    const hazardSeqB = Array.from({ length: 5 }, () =>
      matchB.rng.stream('hazard').next(),
    );

    expect(aiSeqB).toEqual(aiSeq);
    expect(hazardSeqB).toEqual(hazardSeq);
  });
});
