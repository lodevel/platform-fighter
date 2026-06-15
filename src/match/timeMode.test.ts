import { describe, it, expect } from 'vitest';

import {
  createMatchTimer,
  tickMatchTimer,
  isTimeUp,
  timerSecondsRemaining,
  resolveTimeModeResult,
  DEFAULT_TIME_LIMIT_SECONDS,
  MATCH_FPS,
} from './timeMode';

describe('timeMode — match timer', () => {
  it('builds from seconds × fps', () => {
    const t = createMatchTimer(10);
    expect(t.framesRemaining).toBe(10 * MATCH_FPS);
    expect(isTimeUp(t)).toBe(false);
  });

  it('falls back to the default limit for a non-positive / non-finite limit', () => {
    expect(createMatchTimer(0).framesRemaining).toBe(DEFAULT_TIME_LIMIT_SECONDS * MATCH_FPS);
    expect(createMatchTimer(undefined).framesRemaining).toBe(
      DEFAULT_TIME_LIMIT_SECONDS * MATCH_FPS,
    );
    expect(createMatchTimer(Number.NaN).framesRemaining).toBe(
      DEFAULT_TIME_LIMIT_SECONDS * MATCH_FPS,
    );
    expect(createMatchTimer(-5).framesRemaining).toBe(
      DEFAULT_TIME_LIMIT_SECONDS * MATCH_FPS,
    );
  });

  it('ticks down one frame at a time and clamps at 0', () => {
    let t = createMatchTimer(1); // 60 frames
    for (let i = 0; i < 60; i += 1) {
      expect(isTimeUp(t)).toBe(false);
      t = tickMatchTimer(t);
    }
    expect(t.framesRemaining).toBe(0);
    expect(isTimeUp(t)).toBe(true);
    // Idempotent once expired.
    expect(tickMatchTimer(t)).toBe(t);
  });

  it('reports whole seconds remaining, rounded UP', () => {
    let t = createMatchTimer(2); // 120 frames
    expect(timerSecondsRemaining(t)).toBe(2);
    t = tickMatchTimer(t); // 119 frames → still "2"
    expect(timerSecondsRemaining(t)).toBe(2);
    // Drain to exactly 60 frames → "1".
    while (t.framesRemaining > 60) t = tickMatchTimer(t);
    expect(timerSecondsRemaining(t)).toBe(1);
    // One more frame → 59 → still "1".
    t = tickMatchTimer(t);
    expect(timerSecondsRemaining(t)).toBe(1);
    while (t.framesRemaining > 0) t = tickMatchTimer(t);
    expect(timerSecondsRemaining(t)).toBe(0);
  });

  it('is deterministic — identical tick streams produce identical timers', () => {
    const run = (): number[] => {
      let t = createMatchTimer(3);
      const out: number[] = [];
      for (let i = 0; i < 200; i += 1) {
        out.push(t.framesRemaining);
        t = tickMatchTimer(t);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe('timeMode — time-up resolution by score (kos − falls)', () => {
  it('picks the highest net score', () => {
    const r = resolveTimeModeResult([
      { kos: 5, falls: 2 }, // 3
      { kos: 4, falls: 3 }, // 1
    ]);
    expect(r.scores).toEqual([3, 1]);
    expect(r.winnerIndex).toBe(0);
    expect(r.tied).toBe(false);
  });

  it('a self-destruct (fall) costs a point', () => {
    const r = resolveTimeModeResult([
      { kos: 2, falls: 0 }, // 2
      { kos: 2, falls: 1 }, // 1 — SD'd once
    ]);
    expect(r.winnerIndex).toBe(0);
  });

  it('a shared top score is a TIE (→ sudden death)', () => {
    const r = resolveTimeModeResult([
      { kos: 3, falls: 1 }, // 2
      { kos: 4, falls: 2 }, // 2
    ]);
    expect(r.scores).toEqual([2, 2]);
    expect(r.tied).toBe(true);
    expect(r.winnerIndex).toBeNull();
  });

  it('handles 4 players, unique winner', () => {
    const r = resolveTimeModeResult([
      { kos: 1, falls: 0 }, // 1
      { kos: 6, falls: 2 }, // 4 ← winner
      { kos: 3, falls: 3 }, // 0
      { kos: 2, falls: 0 }, // 2
    ]);
    expect(r.winnerIndex).toBe(1);
    expect(r.tied).toBe(false);
  });

  it('negative scores are fine (more falls than kos)', () => {
    const r = resolveTimeModeResult([
      { kos: 0, falls: 3 }, // -3
      { kos: 1, falls: 2 }, // -1 ← winner
    ]);
    expect(r.winnerIndex).toBe(1);
    expect(r.scores).toEqual([-3, -1]);
  });
});
