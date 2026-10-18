import { describe, expect, it } from 'vitest';
import { SAMPLE } from '../testing/samplePackage';
import { costumeShifts, packRecolor, recolorUniforms } from './recolor';

describe('costumeShifts', () => {
  it('draws costume 0, and a package without costumes, as drawn', () => {
    expect(costumeShifts(SAMPLE.costumes, 0)).toEqual([]);
    expect(costumeShifts(undefined, 3)).toEqual([]);
  });

  it('moves each region by its slot colour relative to costume 0', () => {
    const [shift] = costumeShifts(SAMPLE.costumes, 1);
    // HSV: region #704023 (0.0628, 0.6875, 0.4392); brown #6b4a2b (0.0807, 0.5981, 0.4196) → blue #2b62d9 (0.6140, 0.8018, 0.8510).
    expect(shift!.key.map(n => +n.toFixed(4))).toEqual([0.0628, 0.6875, 0.4392]);
    expect(shift!.hueShift).toBeCloseTo(0.6140 - 0.0807, 3);
    expect(shift!.saturationRatio).toBeCloseTo(0.8018 / 0.5981, 3);
    expect(shift!.valueRatio).toBeCloseTo(0xd9 / 0x6b, 6);
    expect(shift!.tolerance).toEqual([0.03, 0.35, 0.3]);
  });

  it('wraps the costume index', () => {
    expect(costumeShifts(SAMPLE.costumes, 3)).toEqual(costumeShifts(SAMPLE.costumes, 1));
    expect(costumeShifts(SAMPLE.costumes, -2)).toEqual([]);
    expect(costumeShifts(SAMPLE.costumes, Number.NaN)).toEqual([]);
  });
});

describe('packRecolor', () => {
  it('writes three floats per region', () => {
    const out = recolorUniforms();
    packRecolor(costumeShifts(SAMPLE.costumes, 1), out);
    expect(out.count).toBe(1);
    expect(Array.from(out.tolerance.slice(0, 3)).map(n => +n.toFixed(2))).toEqual([0.03, 0.35, 0.3]);
    packRecolor([], out);
    expect(out.count).toBe(0);
  });
});
