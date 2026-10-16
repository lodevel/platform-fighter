import { describe, expect, it } from 'vitest';
import {
  isVerticalReferenceLaunch,
  referenceGravityBoost,
  stepReferenceGravity,
  type ReferenceLaunchProfile,
} from './referenceLaunchEnergy';

// Raw fighter data, independent of movement-profile runtime exports:
// https://github.com/rubendal/SSBU-Calculator/blob/master/Data/link/data.json
// https://github.com/rubendal/SSBU-Calculator/blob/master/Data/donkey/data.json
const LINK: ReferenceLaunchProfile = {
  gravity: 0.096, fallSpeed: 1.6, verticalGravity: 0.076944, verticalFallSpeed: 1.8,
};
const DONKEY_KONG: ReferenceLaunchProfile = {
  gravity: 0.085, fallSpeed: 1.63, verticalGravity: 0.084672, verticalFallSpeed: 1.8,
};

function vectorAt(radians: number, facing: 1 | -1 = 1): { x: number; y: number } {
  return { x: Math.cos(radians) * facing, y: -Math.sin(radians) };
}

describe('isVerticalReferenceLaunch', () => {
  it.each([1, -1] as const)('classifies the pre-DI angle with facing %s', facing => {
    expect(isVerticalReferenceLaunch(vectorAt(85 * Math.PI / 180, facing), true)).toBe(true);
    expect(isVerticalReferenceLaunch(vectorAt(0.663225, facing), true)).toBe(false);
    expect(isVerticalReferenceLaunch(vectorAt(85 * Math.PI / 180, facing), false)).toBe(false);
  });

  it.each([1, -1] as const)('uses symmetric source boundaries with facing %s', facing => {
    expect(isVerticalReferenceLaunch(vectorAt(1.22173, facing), true)).toBe(true);
    expect(isVerticalReferenceLaunch(vectorAt(1.22173 - 0.000001, facing), true)).toBe(false);
    expect(isVerticalReferenceLaunch(vectorAt(1.22173 + 0.000001, facing), true)).toBe(true);
    expect(isVerticalReferenceLaunch(vectorAt(1.91986, facing), true)).toBe(true);
    expect(isVerticalReferenceLaunch(vectorAt(Math.PI - 1.22173 + 0.000001, facing), true)).toBe(false);
  });

  it('requires an upward vector and ignores magnitude', () => {
    expect(isVerticalReferenceLaunch({ x: 0, y: -0.01 }, true)).toBe(true);
    expect(isVerticalReferenceLaunch({ x: 0, y: 100 }, true)).toBe(false);
    expect(isVerticalReferenceLaunch({ x: 0, y: 0 }, true)).toBe(false);
    expect(isVerticalReferenceLaunch({ x: Number.NaN, y: -10 }, true)).toBe(false);
    expect(isVerticalReferenceLaunch({ x: 0, y: Number.NEGATIVE_INFINITY }, true)).toBe(false);
  });
});

describe('referenceGravityBoost', () => {
  it.each([
    { name: 'Link', profile: LINK, pixels: 0.525 },
    { name: 'Donkey Kong', profile: DONKEY_KONG, pixels: 0.25 },
  ])('converts $name gravity boost into upward pixels', ({ profile, pixels }) => {
    expect(referenceGravityBoost(profile, false, true)).toBeCloseTo(pixels, 12);
    expect(referenceGravityBoost(profile, true, true)).toBe(0);
    expect(referenceGravityBoost(profile, false, false)).toBe(0);
    expect(referenceGravityBoost(profile, false, true, true)).toBe(0);
    expect(referenceGravityBoost(profile, false, true, false)).toBeCloseTo(pixels, 12);
  });

  it('preserves a negative boost below the reference gravity threshold', () => {
    expect(referenceGravityBoost({ ...LINK, gravity: 0.06 }, false, true)).toBeCloseTo(-0.375, 12);
    expect(referenceGravityBoost({ ...LINK, gravity: 0.075 }, false, true)).toBe(0);
  });
});

describe('stepReferenceGravity', () => {
  it.each([
    { name: 'Link', profile: LINK, normal: 0.48, vertical: 0.38472, normalCap: 8 },
    { name: 'Donkey Kong', profile: DONKEY_KONG, normal: 0.425, vertical: 0.42336, normalCap: 8.15 },
  ])('advances the exact $name components and caps in pixels', ({ profile, normal, vertical, normalCap }) => {
    expect(stepReferenceGravity(0, profile, false, true)).toBeCloseTo(normal, 12);
    expect(stepReferenceGravity(0, profile, true, true)).toBeCloseTo(vertical, 12);
    expect(stepReferenceGravity(0, profile, false, false)).toBeCloseTo(normal, 12);
    expect(stepReferenceGravity(0, profile, true, false)).toBeCloseTo(normal, 12);
    expect(stepReferenceGravity(normalCap - 0.01, profile, false, true)).toBeCloseTo(normalCap, 12);
    expect(stepReferenceGravity(8.99, profile, true, true)).toBe(9);
    expect(stepReferenceGravity(9, profile, true, true)).toBe(9);
  });

  it('returns Link vertical fall from 9 to 8 gradually after hitstun', () => {
    const first = stepReferenceGravity(9, LINK, true, false);
    const second = stepReferenceGravity(first, LINK, true, false);
    const third = stepReferenceGravity(second, LINK, true, false);
    expect(first).toBeCloseTo(8.52, 12);
    expect(second).toBeCloseTo(8.04, 12);
    expect(third).toBe(8);
    expect(stepReferenceGravity(third, LINK, true, false)).toBe(8);
  });

  it('returns Donkey Kong vertical fall from 9 to 8.15 over two free steps', () => {
    const first = stepReferenceGravity(9, DONKEY_KONG, true, false);
    expect(first).toBeCloseTo(8.575, 12);
    expect(stepReferenceGravity(first, DONKEY_KONG, true, false)).toBeCloseTo(8.15, 12);
  });

  it('switches from vertical acceleration to normal acceleration below terminal on release', () => {
    expect(stepReferenceGravity(7.5, LINK, true, true)).toBeCloseTo(7.88472, 12);
    expect(stepReferenceGravity(7.5, LINK, true, false)).toBeCloseTo(7.98, 12);
    expect(stepReferenceGravity(7.9, LINK, true, false)).toBe(8);
  });

  it('does not add motion when the gravity profile is disabled', () => {
    const disabled = { gravity: 0, fallSpeed: 0, verticalGravity: 0, verticalFallSpeed: 0 };
    expect(stepReferenceGravity(0, disabled, false, true)).toBe(0);
    expect(stepReferenceGravity(0, disabled, true, true)).toBe(0);
    expect(stepReferenceGravity(0, disabled, true, false)).toBe(0);
    const zeroAcceleration = { ...LINK, gravity: 0, verticalGravity: 0 };
    expect(stepReferenceGravity(2, zeroAcceleration, false, true)).toBe(2);
    expect(stepReferenceGravity(2, zeroAcceleration, true, false)).toBe(2);
  });
});
