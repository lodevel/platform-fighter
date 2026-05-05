import { describe, it, expect } from 'vitest';
import {
  TIME_MATCH_FRAME_RATE_HZ,
  evaluateTimeMatch,
  findStockLeaders,
  getMatchConfigTimeLimitFrames,
  getTimeRemainingFrames,
  isTimeUp,
  timeLimitSecondsToFrames,
} from './timeMatchResolution';

/**
 * AC 12 — pure resolution helpers for time-mode match end + tie
 * detection. The state-machine integration tests live in
 * `SuddenDeathController.test.ts`; here we only nail the pure
 * functions.
 */

describe('timeMatchResolution — constants', () => {
  it('runs at the engine canonical 60 Hz', () => {
    expect(TIME_MATCH_FRAME_RATE_HZ).toBe(60);
  });
});

describe('timeMatchResolution — timeLimitSecondsToFrames', () => {
  it('multiplies by 60 for whole seconds', () => {
    expect(timeLimitSecondsToFrames(1)).toBe(60);
    expect(timeLimitSecondsToFrames(180)).toBe(180 * 60);
    expect(timeLimitSecondsToFrames(8)).toBe(480);
  });

  it('floors fractional seconds to a deterministic integer frame', () => {
    expect(timeLimitSecondsToFrames(1.5)).toBe(90);
    expect(timeLimitSecondsToFrames(0.5)).toBe(30);
    expect(timeLimitSecondsToFrames(180.999)).toBe(Math.floor(180.999 * 60));
  });

  it('zero / negative / NaN clamps to zero', () => {
    expect(timeLimitSecondsToFrames(0)).toBe(0);
    expect(timeLimitSecondsToFrames(-5)).toBe(0);
    expect(timeLimitSecondsToFrames(Number.NaN)).toBe(0);
    expect(timeLimitSecondsToFrames(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('timeMatchResolution — getMatchConfigTimeLimitFrames', () => {
  it('returns null for stock matches', () => {
    expect(
      getMatchConfigTimeLimitFrames({ mode: 'stocks', timeLimitSeconds: 180 }),
    ).toBeNull();
  });

  it('returns frames for valid time-mode configs', () => {
    expect(
      getMatchConfigTimeLimitFrames({ mode: 'time', timeLimitSeconds: 180 }),
    ).toBe(180 * 60);
  });

  it('returns null for time mode without a configured limit', () => {
    expect(getMatchConfigTimeLimitFrames({ mode: 'time' })).toBeNull();
    expect(
      getMatchConfigTimeLimitFrames({ mode: 'time', timeLimitSeconds: 0 }),
    ).toBeNull();
    expect(
      getMatchConfigTimeLimitFrames({ mode: 'time', timeLimitSeconds: -10 }),
    ).toBeNull();
  });
});

describe('timeMatchResolution — isTimeUp', () => {
  it('returns false while the timer is still running', () => {
    expect(isTimeUp(0, 100)).toBe(false);
    expect(isTimeUp(99, 100)).toBe(false);
  });

  it('returns true when elapsed reaches the limit (inclusive)', () => {
    expect(isTimeUp(100, 100)).toBe(true);
    expect(isTimeUp(101, 100)).toBe(true);
    expect(isTimeUp(10000, 100)).toBe(true);
  });

  it('returns false when no timer is configured', () => {
    expect(isTimeUp(100, 0)).toBe(false);
    expect(isTimeUp(100, -1)).toBe(false);
    expect(isTimeUp(100, Number.NaN)).toBe(false);
  });

  it('clamps fractional elapsed values via floor()', () => {
    expect(isTimeUp(99.99, 100)).toBe(false);
    expect(isTimeUp(100.5, 100)).toBe(true);
  });

  it('treats negative elapsed defensively as zero', () => {
    expect(isTimeUp(-5, 100)).toBe(false);
  });
});

describe('timeMatchResolution — getTimeRemainingFrames', () => {
  it('returns the correct delta while the timer is running', () => {
    expect(getTimeRemainingFrames(0, 600)).toBe(600);
    expect(getTimeRemainingFrames(300, 600)).toBe(300);
    expect(getTimeRemainingFrames(599, 600)).toBe(1);
  });

  it('clamps to 0 once the timer has expired', () => {
    expect(getTimeRemainingFrames(600, 600)).toBe(0);
    expect(getTimeRemainingFrames(9999, 600)).toBe(0);
  });

  it('returns Infinity when no timer is configured (stock match)', () => {
    expect(getTimeRemainingFrames(0, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(getTimeRemainingFrames(123, -1)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('timeMatchResolution — findStockLeaders', () => {
  it('returns the sole leader when one player has the most stocks', () => {
    expect(findStockLeaders([3, 1, 2])).toEqual([0]);
    expect(findStockLeaders([0, 1, 5, 0])).toEqual([2]);
  });

  it('returns every tied leader in ascending order', () => {
    expect(findStockLeaders([2, 2, 1])).toEqual([0, 1]);
    expect(findStockLeaders([2, 1, 2, 0])).toEqual([0, 2]);
    expect(findStockLeaders([3, 3, 3, 3])).toEqual([0, 1, 2, 3]);
  });

  it('excludes eliminated players (zero stocks) from the leader pool', () => {
    expect(findStockLeaders([0, 0, 0, 1])).toEqual([3]);
    expect(findStockLeaders([0, 1, 0, 1])).toEqual([1, 3]);
  });

  it('returns empty array when every player is eliminated', () => {
    expect(findStockLeaders([0, 0, 0, 0])).toEqual([]);
    expect(findStockLeaders([])).toEqual([]);
  });
});

describe('timeMatchResolution — evaluateTimeMatch', () => {
  it('reports in-progress while the timer is still running', () => {
    expect(evaluateTimeMatch([3, 3], 0, 600)).toEqual({ kind: 'in-progress' });
    expect(evaluateTimeMatch([3, 1], 599, 600)).toEqual({
      kind: 'in-progress',
    });
  });

  it('reports a single winner when one player leads on time-up', () => {
    expect(evaluateTimeMatch([3, 1], 600, 600)).toEqual({
      kind: 'winner',
      winnerIndex: 0,
    });
    expect(evaluateTimeMatch([1, 3, 0, 0], 600, 600)).toEqual({
      kind: 'winner',
      winnerIndex: 1,
    });
  });

  it('reports a tie with the tied indexes when the leaders are equal', () => {
    const r = evaluateTimeMatch([2, 2], 600, 600);
    expect(r.kind).toBe('tie');
    if (r.kind === 'tie') {
      expect(r.tiedIndexes).toEqual([0, 1]);
      expect(Object.isFrozen(r.tiedIndexes)).toBe(true);
    }
  });

  it('reports a 4-way tie when every player has the same stocks', () => {
    const r = evaluateTimeMatch([3, 3, 3, 3], 600, 600);
    expect(r.kind).toBe('tie');
    if (r.kind === 'tie') {
      expect(r.tiedIndexes).toEqual([0, 1, 2, 3]);
    }
  });

  it('reports a 3-way tie when one player is eliminated and three lead', () => {
    const r = evaluateTimeMatch([2, 0, 2, 2], 600, 600);
    expect(r.kind).toBe('tie');
    if (r.kind === 'tie') {
      expect(r.tiedIndexes).toEqual([0, 2, 3]);
    }
  });

  it('reports a draw when every player has been eliminated', () => {
    expect(evaluateTimeMatch([0, 0, 0, 0], 600, 600)).toEqual({ kind: 'draw' });
  });

  it('determinism: same input always produces the same output', () => {
    const a = evaluateTimeMatch([2, 0, 2, 2], 1234, 600);
    const b = evaluateTimeMatch([2, 0, 2, 2], 1234, 600);
    expect(a).toEqual(b);
  });
});
