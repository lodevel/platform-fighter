import { describe, expect, it } from 'vitest';
import { getReferenceDamageSpeedUpGroups } from './referenceDamageSpeedUp';

// Independent iterative oracle, preserving the source's remaining-clock
// operation order. Production evaluates the geometric recurrence directly.
// Source: formulas.js ReactionFrameMulSpeedUp / DamageSpeedUpFrames, retrieved
// 2026-09-20 from the refs/heads/gh-pages raw URL in the implementation.
function sourceElapsedMap(faf: number): number[] {
  const maximum = 1 + 5 * Math.min(1, Math.max(0, (faf - 30) / 50));
  const remaining = (start: number): number => {
    let frame = start;
    let magnitude = maximum;
    let elapsed = 0;
    while (magnitude > 1) {
      const ratio = Math.min(1, Math.max(0,
        (faf * (1 - 0.7) - frame) / (faf * (1 - 0.7) - faf)));
      magnitude = ratio * maximum;
      frame -= magnitude < 1 ? 1 : magnitude;
      elapsed += 1;
    }
    return elapsed + Math.ceil(frame);
  };
  const displayedFaf = remaining(faf);
  return Array.from({ length: faf + 1 }, (_, tick) => displayedFaf - remaining(faf - tick));
}

function expandGroups(groups: readonly number[]): number[] {
  return groups.flatMap((count, step) => Array<number>(count).fill(step));
}

describe('reference damage speed-up timing', () => {
  it.each([
    [32, 32], [54, 41], [62, 44], [65, 45], [66, 45], [80, 50],
  ])('maps ordinary FAF %i to displayed FAF %i while retaining every trajectory tick', (faf, displayed) => {
    const groups = getReferenceDamageSpeedUpGroups(faf - 1, true);
    expect(groups).toHaveLength(displayed);
    expect(groups.reduce((sum, count) => sum + count, 0)).toBe(faf);
    expect(groups.every((count) => Number.isInteger(count) && count >= 1 && count <= 6)).toBe(true);
    expect(groups.at(-1)).toBe(1);
  });

  it('includes release tick zero exactly once, even when release shares a displayed frame', () => {
    const groups = getReferenceDamageSpeedUpGroups(65, true);
    expect(groups.slice(0, 12)).toEqual([2, 5, 4, 3, 4, 2, 3, 2, 3, 1, 2, 2]);
    const elapsed = expandGroups(groups);
    expect(elapsed.slice(0, 8)).toEqual([0, 0, 1, 1, 1, 1, 1, 2]);
    expect(elapsed[65]).toBe(44); // Last locked integration H.
    expect(groups.length).toBe(45); // First free displayed step, with release at zero.
  });

  it('keeps a singleton release when the timing map advances on tick one', () => {
    const groups = getReferenceDamageSpeedUpGroups(79, true);
    expect(groups.slice(0, 14)).toEqual([1, 6, 6, 4, 4, 4, 4, 3, 2, 3, 2, 2, 1, 2]);
    // The visualizer combines its first plotted points into seven integrations;
    // the reaction-clock timing map retains these separate one/six-tick groups.
    expect(expandGroups(groups).slice(0, 8)).toEqual([0, 1, 1, 1, 1, 1, 1, 2]);
  });

  it('uses identity schedules for ineligible launches and clocks below the acceleration range', () => {
    for (const hitstun of [0, 4, 29, 31, 65, 999]) {
      expect(getReferenceDamageSpeedUpGroups(hitstun, false)).toEqual(Array(hitstun + 1).fill(1));
    }
    for (const hitstun of [0, 4, 28, 29]) {
      expect(getReferenceDamageSpeedUpGroups(hitstun, true)).toEqual(Array(hitstun + 1).fill(1));
    }
  });

  it('matches the independent iterative clock across threshold and rounding boundaries', () => {
    for (let faf = 1; faf <= 250; faf++) {
      const groups = getReferenceDamageSpeedUpGroups(faf - 1, true);
      const source = sourceElapsedMap(faf);
      expect(expandGroups(groups), `ordinary FAF ${faf}`).toEqual(source.slice(0, -1));
      expect(groups.length, `ordinary FAF ${faf}`).toBe(source.at(-1));
    }
  });

  it('handles a thousand ordinary ticks with capped groups and an unaccelerated tail', () => {
    const groups = getReferenceDamageSpeedUpGroups(999, true);
    expect(groups).toHaveLength(625);
    expect(groups.reduce((sum, count) => sum + count, 0)).toBe(1000);
    expect(Math.max(...groups)).toBe(6);
    expect(groups.slice(0, 8)).toEqual([5, 6, 6, 6, 6, 6, 5, 6]);
    expect(groups.slice(-300)).toEqual(Array(300).fill(1));
    const elapsed = expandGroups(groups);
    expect([0, 50, 100, 200, 500, 999].map((tick) => elapsed[tick])).toEqual([0, 8, 18, 39, 145, 624]);
    expect(elapsed).toEqual(sourceElapsedMap(1000).slice(0, -1));
  });

  it('bounds imported reaction clocks before allocating a schedule', () => {
    const boundary = getReferenceDamageSpeedUpGroups(10000, true);
    expect(boundary.reduce((sum, count) => sum + count, 0)).toBe(10001);
    expect(boundary.every((count) => count >= 1 && count <= 6)).toBe(true);
    for (const eligible of [true, false]) {
      for (const hitstun of [10001, 1e12]) {
        expect(() => getReferenceDamageSpeedUpGroups(hitstun, eligible)).toThrow(RangeError);
      }
    }
  });

  it('returns immutable schedules and rejects invalid clock values', () => {
    expect(Object.isFrozen(getReferenceDamageSpeedUpGroups(65, true))).toBe(true);
    expect(Object.isFrozen(getReferenceDamageSpeedUpGroups(65, false))).toBe(true);
    for (const hitstun of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      expect(() => getReferenceDamageSpeedUpGroups(hitstun, true)).toThrow(RangeError);
    }
  });
});
