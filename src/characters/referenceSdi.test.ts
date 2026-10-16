import { describe, expect, it } from 'vitest';
import { createReferenceSdiState, stepReferenceSdi, type SdiVector } from './referenceSdi';

const neutral = { x: 0, y: 0 };
function sequence(inputs: readonly SdiVector[], multiplier = 1) {
  let state = createReferenceSdiState();
  return inputs.map(input => {
    const step = stepReferenceSdi(state, input, multiplier);
    state = step.state;
    return step;
  });
}

describe('reference SDI — documented pulse rules with a local input threshold', () => {
  it.each([
    [{ x: 1, y: 0 }, 1, { x: 10, y: 0 }],
    [{ x: 0.6, y: -0.3 }, 0.3, { x: 1.8, y: -0.9 }],
    [{ x: -0.5, y: 0 }, 2, { x: -10, y: 0 }],
  ] as const)('preserves partial-stick distance for %j ×%s', (input, multiplier, expected) => {
    const actual = stepReferenceSdi(createReferenceSdiState(), input, multiplier);
    expect(actual.pulsed).toBe(true);
    expect(actual.displacement.x).toBeCloseTo(expected.x, 12);
    expect(actual.displacement.y).toBeCloseTo(expected.y, 12);
  });

  it('normalizes an overlength keyboard diagonal without normalizing partial input', () => {
    const full = stepReferenceSdi(createReferenceSdiState(), { x: 1, y: -1 });
    expect(full.displacement).toEqual({ x: 10 / Math.sqrt(2), y: -10 / Math.sqrt(2) });
    const partial = stepReferenceSdi(createReferenceSdiState(), { x: 0.5, y: 0.5 });
    expect(partial.displacement).toEqual({ x: 5, y: 5 });
  });

  it('triggers newly added cardinal components, not held or removed ones', () => {
    const rows = sequence([
      { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 },
      { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 },
      { x: 1, y: 0 }, { x: -1, y: 0 },
    ]);
    expect(rows.flatMap((row, frame) => row.pulsed ? [frame] : [])).toEqual([0, 4, 9]);
  });

  it('reproduces the testing page first-buffer trace at an exact four-frame interval', () => {
    const rows = sequence([neutral, { x: 1, y: 0 }, { x: 1, y: -1 },
      { x: 1, y: 0 }, { x: 1, y: 1 }, neutral, neutral, neutral, neutral, neutral]);
    expect(rows.flatMap((row, frame) => row.pulsed ? [frame] : [])).toEqual([1, 5]);
    expect(rows[5]!.displacement).toEqual({ x: 10 / Math.sqrt(2), y: -10 / Math.sqrt(2) });
    expect(rows[9]!.state.bufferedInput).toBeNull();
  });

  it('caps pulse count at sixteen independently of displacement and multiplier', () => {
    const inputs = Array.from({ length: 100 }, (_, frame) => ({ x: frame % 2 ? -1 : 1, y: 0 }));
    for (const multiplier of [0.1, 1, 4]) {
      const rows = sequence(inputs, multiplier);
      expect(rows.flatMap((row, frame) => row.pulsed ? [frame] : []))
        .toEqual(Array.from({ length: 16 }, (_, index) => index * 4));
      expect(rows[99]!.state.pulses).toBe(16);
      expect(rows[99]!.state.bufferedInput).toBeNull();
    }
  });

  it('keeps zero-multiplier and below-threshold input stationary', () => {
    const rows = sequence([{ x: 1, y: 1 }, neutral, { x: -1, y: -1 }], 0);
    expect(rows.every(row => !row.pulsed && row.displacement.x === 0 && row.displacement.y === 0)).toBe(true);
    expect(stepReferenceSdi(createReferenceSdiState(), { x: 0.49, y: -0.49 }).pulsed).toBe(false);
    expect(stepReferenceSdi(createReferenceSdiState(), { x: NaN, y: Infinity }).pulsed).toBe(false);
  });

  it('a fresh hit discards a previous pulse interval and pending vector', () => {
    const rows = sequence([{ x: 1, y: 0 }, { x: -1, y: 0 }]);
    expect(rows[1]!.state.bufferedInput).toEqual({ x: -1, y: 0 });
    const reset = stepReferenceSdi(createReferenceSdiState(), { x: 0, y: 0.5 });
    expect(reset.displacement).toEqual({ x: 0, y: 5 });
    expect(reset.state.pulses).toBe(1);
  });
});
