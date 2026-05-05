import { describe, expect, it } from 'vitest';

import {
  type ThrowSet,
  type ThrowSpec,
  THROW_DIRECTIONS,
  getThrowByDirection,
  isThrowDirection,
  validateThrowSet,
  validateThrowSpec,
} from './throwSchema';

const validSpec = (): ThrowSpec => ({
  damage: 8,
  knockback: { x: 2.0, y: -1.0, scaling: 0.1 },
  animationFrames: 24,
});

const validSet = (): ThrowSet => ({
  forward: { ...validSpec(), animationFrames: 22 },
  back: { ...validSpec(), animationFrames: 26 },
  up: { ...validSpec(), animationFrames: 14 },
  down: { ...validSpec(), animationFrames: 16 },
});

describe('THROW_DIRECTIONS — taxonomy', () => {
  it('lists the four canonical directions in order', () => {
    expect([...THROW_DIRECTIONS]).toEqual(['forward', 'back', 'up', 'down']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(THROW_DIRECTIONS)).toBe(true);
  });
});

describe('isThrowDirection', () => {
  it('accepts each canonical direction', () => {
    for (const d of THROW_DIRECTIONS) expect(isThrowDirection(d)).toBe(true);
  });

  it('rejects junk values', () => {
    expect(isThrowDirection('left')).toBe(false);
    expect(isThrowDirection(null)).toBe(false);
    expect(isThrowDirection(42)).toBe(false);
    expect(isThrowDirection(undefined)).toBe(false);
  });
});

describe('validateThrowSpec — happy path', () => {
  it('returns the spec unchanged on success', () => {
    const s = validSpec();
    expect(validateThrowSpec(s, 'test')).toBe(s);
  });
});

describe('validateThrowSpec — invariants', () => {
  it('rejects negative damage', () => {
    expect(() => validateThrowSpec({ ...validSpec(), damage: -1 }, 'test')).toThrow(/damage/);
  });

  it('rejects NaN damage', () => {
    expect(() => validateThrowSpec({ ...validSpec(), damage: NaN }, 'test')).toThrow(/damage/);
  });

  it('rejects zero animationFrames', () => {
    expect(() =>
      validateThrowSpec({ ...validSpec(), animationFrames: 0 }, 'test'),
    ).toThrow(/animationFrames/);
  });

  it('rejects non-integer animationFrames', () => {
    expect(() =>
      validateThrowSpec({ ...validSpec(), animationFrames: 24.5 }, 'test'),
    ).toThrow(/animationFrames/);
  });

  it('rejects non-finite knockback components', () => {
    expect(() =>
      validateThrowSpec(
        { ...validSpec(), knockback: { x: Infinity, y: 0, scaling: 0 } },
        'test',
      ),
    ).toThrow(/knockback/);
  });

  it('rejects negative knockback.scaling', () => {
    expect(() =>
      validateThrowSpec(
        { ...validSpec(), knockback: { x: 1, y: 0, scaling: -0.1 } },
        'test',
      ),
    ).toThrow(/scaling/);
  });

  it('embeds the contextLabel in error messages', () => {
    expect(() =>
      validateThrowSpec(
        { ...validSpec(), damage: -1 },
        "wolf.throws.forward",
      ),
    ).toThrow(/wolf\.throws\.forward/);
  });
});

describe('validateThrowSet', () => {
  it('returns the set unchanged on success', () => {
    const s = validSet();
    expect(validateThrowSet(s, 'test')).toBe(s);
  });

  it('rejects an invalid throw in any direction', () => {
    const bad: ThrowSet = {
      ...validSet(),
      up: { ...validSpec(), damage: -5 },
    };
    expect(() => validateThrowSet(bad, 'test')).toThrow(/up/);
  });
});

describe('getThrowByDirection', () => {
  it('returns the matching throw spec', () => {
    const set = validSet();
    expect(getThrowByDirection(set, 'forward').animationFrames).toBe(22);
    expect(getThrowByDirection(set, 'back').animationFrames).toBe(26);
    expect(getThrowByDirection(set, 'up').animationFrames).toBe(14);
    expect(getThrowByDirection(set, 'down').animationFrames).toBe(16);
  });
});
