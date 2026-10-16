import { describe, expect, it } from 'vitest';
import { initialCaptureMash } from './ultimateCapture';
import { canCargoJump, reducedCargoFrames, selectCargoThrow, ultimateCargoFrames } from './donkeykongCargoRules';

describe('published Ultimate Kong Karry capture/input rules', () => {
  it('extends percent-scaled capture and subtracts prior elapsed/mash instead of using a flat240', () => {
    expect(ultimateCargoFrames(0, 0)).toBe(165);
    expect(ultimateCargoFrames(100, 0)).toBeCloseTo(476.6666666667);
    expect(ultimateCargoFrames(100, 25 + 14.4)).toBeCloseTo(437.2666666667);
    expect(ultimateCargoFrames(0, 170)).toBe(0);
    expect(() => ultimateCargoFrames(-1, 0)).toThrow();
  });
  it('mash can end the current cargo rather than being clamped to nineteen remaining steps', () => {
    const mash = initialCaptureMash({ moveX: 0, jump: false });
    expect(reducedCargoFrames(165, { ...mash, reduction: 160 })).toBe(5);
    expect(reducedCargoFrames(165, { ...mash, reduction: 170 })).toBe(0);
  });
  it.each([1, -1] as const)('selects four throw directions only on fresh presses, facing%s', facing => {
    const idle = { attackPressed: false, grabPressed: false, moveX: -facing, moveY: -1 };
    expect(selectCargoThrow(idle, facing)).toBeNull();
    expect(selectCargoThrow({ ...idle, attackPressed: true }, facing)).toBe('up');
    expect(selectCargoThrow({ ...idle, attackPressed: true, moveY: 1 }, facing)).toBe('down');
    expect(selectCargoThrow({ ...idle, attackPressed: true, moveY: 0 }, facing)).toBe('back');
    expect(selectCargoThrow({ ...idle, grabPressed: true, moveX: facing, moveY: 0 }, facing)).toBe('forward');
    expect(selectCargoThrow({ ...idle, attackPressed: true, moveX: 0, moveY: 0 }, facing)).toBe('forward');
  });
  it('allows the ground jump while blocking a cargo double jump and walk-off airjump', () => {
    expect(canCargoJump(true)).toBe(true);
    expect(canCargoJump(false)).toBe(false);
  });
});
