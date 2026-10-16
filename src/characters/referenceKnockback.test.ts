import { describe, expect, it } from 'vitest';
import { computeReferenceKnockback, isFixedReferenceKnockback, type ReferenceKnockbackSpec } from './referenceKnockback';

// Independent numerical fixtures: post-hit percent, native fighter weight and
// dumped Link ATTACK data, without importing mutable runtime move definitions.
// https://github.com/rubendal/SSBU-Calculator/blob/gh-pages/Data/ulthitboxes/03_link.json
const FORWARD_TILT: ReferenceKnockbackSpec = { base: 55, growth: 82, angle: 361 };
const UP_AIR: ReferenceKnockbackSpec = { base: 23, growth: 93, angle: 85 };

describe('computeReferenceKnockback', () => {
  it.each([
    { fixed: 28, kb: 39, frames: 17 },
    { fixed: 38, kb: 46, frames: 20 },
    { fixed: 55, kb: 57.9, frames: 25 },
    { fixed: 150, kb: 124.4, frames: 51 },
  ])('uses fixed parameter $fixed independently of damage, percent and forced recipient weight', ({ fixed, kb, frames }) => {
    const spec = { base: 0, growth: 100, angle: 115, fixed, setWeight: true, additionalHitstunFrames: 3 };
    for (const percent of [0, 100, 999]) for (const damage of [0, 4, 5.6, 80]) for (const weight of [50, 104, 127, 200]) {
      const result = computeReferenceKnockback(spec, percent, damage, weight);
      expect(result.referenceKnockback).toBeCloseTo(kb, 12);
      expect(result.hitstunFrames).toBe(frames);
      expect(result.magnitude).toBeCloseTo(kb * 0.15, 12);
      expect(result.tumble).toBe(kb >= 80);
    }
  });

  it('keeps ordinary recipient weight for fixed launches without setWeight', () => {
    const spec = { base: 7, growth: 80, angle: 107, fixed: 28 };
    const result = computeReferenceKnockback(spec, 999, 99, 200);
    expect(result.referenceKnockback).toBeCloseTo(32.6, 12);
    expect(computeReferenceKnockback({ ...spec, setWeight: false }, 0, 0, 200)).toEqual(result);
    expect(computeReferenceKnockback({ ...spec, setWeight: true }, 0, 0, 200).referenceKnockback).toBeCloseTo(38.2, 12);
    // Explicit defensive/launch modifiers remain meaningful for fixed KB.
    expect(computeReferenceKnockback(spec, 0, 0, 200, 1, false, 0.5).referenceKnockback).toBeCloseTo(16.3, 12);
  });

  it('setWeight also fixes ordinary damage-based weight without disabling damage growth', () => {
    const spec = { ...FORWARD_TILT, setWeight: true };
    expect(computeReferenceKnockback(spec, 113, 13, 127)).toEqual(computeReferenceKnockback(FORWARD_TILT, 113, 13, 100));
    expect(computeReferenceKnockback(spec, 113, 20, 127).referenceKnockback)
      .toBeGreaterThan(computeReferenceKnockback(spec, 113, 13, 127).referenceKnockback);
  });

  it('adds reaction frames after the ordinary floor without promoting a weak hit to tumble', () => {
    const spec = { base: 79.9, growth: 0, angle: 90, additionalHitstunFrames: 40 };
    const result = computeReferenceKnockback(spec, 0, 0);
    expect(result.hitstunFrames).toBe(70);
    expect(result.tumble).toBe(false);
    expect(result.referenceKnockback).toBe(79.9);
    expect(computeReferenceKnockback({ ...spec, base: 80 }, 0, 0).tumble).toBe(true);
  });

  it('explicit zero fixed/reaction values and false setWeight preserve ordinary results', () => {
    expect(computeReferenceKnockback({ ...UP_AIR, fixed: 0, additionalHitstunFrames: 0, setWeight: false }, 115, 15, 104))
      .toEqual(computeReferenceKnockback(UP_AIR, 115, 15, 104));
    expect(isFixedReferenceKnockback(undefined)).toBe(false);
    for (const fixed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isFixedReferenceKnockback({ ...UP_AIR, fixed })).toBe(false);
    }
    expect(isFixedReferenceKnockback({ ...UP_AIR, fixed: 0.25 })).toBe(true);
  });

  it.each([
    { name: 'forward tilt at 0% before the hit', spec: FORWARD_TILT, percent: 13, damage: 13, weight: 104,
      kb: 80.7335294117647, speed: 12.110029411764705, x: 9.542834266017495, y: -7.4556774692262895, frames: 31 },
    { name: 'forward tilt at 100% before the hit', spec: FORWARD_TILT, percent: 113, damage: 13, weight: 104,
      kb: 165.14529411764704, speed: 24.771794117647055, x: 19.520441916264936, y: -15.251037053289856, frames: 65 },
    { name: 'forward tilt against weight 127', spec: FORWARD_TILT, percent: 113, damage: 13, weight: 127,
      kb: 155.48070484581498, speed: 23.32210572687225, x: 18.378071771639693, y: -14.35851989210126, frames: 61 },
    { name: 'early up air at 100% before the hit', spec: UP_AIR, percent: 115, damage: 15, weight: 104,
      kb: 164.515, speed: 24.67725, x: 2.1507640527196465, y: -24.583345613484525, frames: 64 },
    { name: 'late up air at 100% before the hit', spec: { base: 18, growth: 88, angle: 85 }, percent: 113, damage: 13, weight: 104,
      kb: 136.20470588235293, speed: 20.43070588235294, x: 1.7806533460354186, y: -20.352960878271837, frames: 53 },
  ])('$name agrees with independently calculated reference values', ({ spec, percent, damage, weight, kb, speed, x, y, frames }) => {
    const result = computeReferenceKnockback(spec, percent, damage, weight);
    expect(result.referenceKnockback).toBeCloseTo(kb, 10);
    expect(result.magnitude).toBeCloseTo(speed, 10);
    expect(result.vector.x).toBeCloseTo(x, 10);
    expect(result.vector.y).toBeCloseTo(y, 10);
    expect(result.hitstunFrames).toBe(frames);
    expect(result.launchDecayPerFrame).toBeCloseTo(0.255, 12);
    expect(result.tumble).toBe(true);
  });

  it('uses post-hit percent once and keeps damage as a separate growth input', () => {
    const spec = { base: 10, growth: 100, angle: 45 };
    expect(computeReferenceKnockback(spec, 100, 0).referenceKnockback).toBeCloseTo(42, 12);
    expect(computeReferenceKnockback(spec, 100, 10).referenceKnockback).toBeCloseTo(112, 12);
  });

  it('uses reference weight 100 by default and leaves base knockback outside the weight term', () => {
    const spec = { base: 40, growth: 100, angle: 45 };
    expect(computeReferenceKnockback(spec, 10, 10).referenceKnockback).toBeCloseTo(66.4, 12);
    expect(computeReferenceKnockback(spec, 10, 10, 200).referenceKnockback).toBeCloseTo(63.6, 12);
    expect(computeReferenceKnockback({ ...spec, growth: 0 }, 999, 50, 200).referenceKnockback).toBe(40);
  });

  it('applies the explicit modifier to base and growth before deriving hitstun and tumble', () => {
    const result = computeReferenceKnockback({ base: 40, growth: 100, angle: 45 }, 10, 10, 100, 1, false, 1.25);
    expect(result.referenceKnockback).toBeCloseTo(83, 12);
    expect(result.magnitude).toBeCloseTo(12.45, 12);
    expect(result.hitstunFrames).toBe(32);
    expect(result.tumble).toBe(true);
  });

  it.each([
    { kb: 59.999, angle: 0 },
    { kb: 60, angle: 1 },
    { kb: 74, angle: 20 },
    { kb: 87.5, angle: 38 },
    { kb: 88, angle: 38 },
    { kb: 200, angle: 38 },
  ])('resolves grounded 361 at $kb knockback to $angle degrees', ({ kb, angle }) => {
    const result = computeReferenceKnockback({ base: kb, growth: 0, angle: 361 }, 0, 0, 100, 1, true);
    expect(result.angle).toBeCloseTo(-angle * Math.PI / 180, 12);
    expect(result.magnitude).toBeCloseTo(kb * (angle === 0 ? 0.12 : 0.15), 12);
  });

  it.each([20, 60, 88, 200])('uses the airborne 361 radian constant at %s knockback', kb => {
    const result = computeReferenceKnockback({ base: kb, growth: 0, angle: 361 }, 0, 0);
    expect(result.angle).toBeCloseTo(-0.663225, 12);
    expect(result.magnitude).toBeCloseTo(kb * 0.15, 12);
  });

  it('mirrors only the horizontal component for left facing and reports screen-space radians', () => {
    const result = computeReferenceKnockback({ base: 100, growth: 0, angle: 30 }, 0, 0, 100, -1);
    expect(result.vector.x).toBeCloseTo(-12.99038105676658, 12);
    expect(result.vector.y).toBeCloseTo(-7.5, 12);
    expect(result.angle).toBeCloseTo(-5 * Math.PI / 6, 12);
    const meteor = computeReferenceKnockback({ base: 100, growth: 0, angle: 270 }, 0, 0);
    expect(meteor.vector.y).toBeCloseTo(15, 12);
    expect(meteor.angle).toBeCloseTo(Math.PI / 2, 12);
  });

  it.each([0, 180, 45, 270])('starts ordinary tumble at 80 knockback, including angle %s', angle => {
    expect(computeReferenceKnockback({ base: 79.999, growth: 0, angle }, 0, 0).tumble).toBe(false);
    const result = computeReferenceKnockback({ base: 80, growth: 0, angle }, 0, 0);
    expect(result.tumble).toBe(true);
    expect(result.hitstunFrames).toBe(31);
  });

  it('reduces grounded zero-angle speed without reducing hitstun', () => {
    const spec = { base: 100, growth: 0, angle: 0 };
    const grounded = computeReferenceKnockback(spec, 0, 0, 100, 1, true);
    const aerial = computeReferenceKnockback(spec, 0, 0);
    expect(grounded.vector).toEqual({ x: 12, y: 0 });
    expect(aerial.vector).toEqual({ x: 15, y: 0 });
    expect(grounded.hitstunFrames).toBe(39);
    expect(grounded.hitstunFrames).toBe(aerial.hitstunFrames);
  });

  it.each([0, 180])('changes a horizontal angle %s to 32 degrees at 120 knockback', angle => {
    const result = computeReferenceKnockback({ base: 120, growth: 0, angle }, 0, 0, 100, 1, true);
    expect(result.angle).toBeCloseTo(-32 * Math.PI / 180, 12);
    expect(result.magnitude).toBeCloseTo(18, 12);
  });

  it('floors ordinary hitstun at four returned frames and permits values above 120', () => {
    const weak = computeReferenceKnockback({ base: 0, growth: 0, angle: 45 }, 0, 0);
    expect(weak.vector).toEqual({ x: 0, y: 0 });
    expect(weak.angle).toBe(0);
    expect(weak.hitstunFrames).toBe(4);
    expect(weak.tumble).toBe(false);
    const strong = computeReferenceKnockback({ base: 400, growth: 0, angle: 90 }, 0, 0);
    expect(strong.hitstunFrames).toBe(159);
    expect(strong.magnitude).toBe(60);
  });

  it('bounds post-hit percent to the damage meter without rounding fractions', () => {
    expect(computeReferenceKnockback(UP_AIR, -1, 15)).toEqual(computeReferenceKnockback(UP_AIR, 0, 15));
    expect(computeReferenceKnockback(UP_AIR, Number.NaN, 15)).toEqual(computeReferenceKnockback(UP_AIR, 0, 15));
    expect(computeReferenceKnockback(UP_AIR, Number.POSITIVE_INFINITY, 15))
      .toEqual(computeReferenceKnockback(UP_AIR, 999, 15));
    expect(computeReferenceKnockback(UP_AIR, 1000, 15)).toEqual(computeReferenceKnockback(UP_AIR, 999, 15));
    expect(computeReferenceKnockback(UP_AIR, 0.5, 15).referenceKnockback).toBeCloseTo(40.29335, 10);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -100])('uses neutral reference weight for invalid weight %s', weight => {
    expect(computeReferenceKnockback(UP_AIR, 115, 15, weight))
      .toEqual(computeReferenceKnockback(UP_AIR, 115, 15, 100));
  });

  it('keeps invalid authoring, damage and multiplier inputs finite', () => {
    const result = computeReferenceKnockback({ base: Number.NaN, growth: Number.POSITIVE_INFINITY, angle: Number.NaN },
      Number.NaN, Number.POSITIVE_INFINITY, Number.NaN, 1, false, Number.NaN);
    expect(result.vector).toEqual({ x: 0, y: 0 });
    expect(result.referenceKnockback).toBe(0);
    expect(result.hitstunFrames).toBe(4);
    expect(computeReferenceKnockback(UP_AIR, 115, -15))
      .toEqual(computeReferenceKnockback(UP_AIR, 115, 0));
    expect(computeReferenceKnockback(UP_AIR, 115, 15, 100, 1, false, -1).magnitude).toBe(0);
    const overflow = computeReferenceKnockback({ base: Number.MAX_VALUE, growth: Number.MAX_VALUE, angle: 45 },
      999, Number.MAX_VALUE);
    expect(Number.isFinite(overflow.magnitude)).toBe(true);
  });
});
