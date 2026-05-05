import { describe, expect, it } from 'vitest';

import {
  type ChargeSpec,
  computeChargeTFromSpec,
  computeChargedDamageFromSpec,
  computeChargedKnockbackFromSpec,
  validateChargeSpec,
} from './chargeSchema';

const FIXTURE: ChargeSpec = Object.freeze({
  minChargeFrames: 4,
  maxChargeFrames: 64,
  minDamage: 5,
  maxDamage: 20,
  minKnockback: { x: 1.0, y: -0.4, scaling: 0.06 },
  maxKnockback: { x: 2.5, y: -0.7, scaling: 0.18 },
});

describe('chargeSchema', () => {
  describe('computeChargeTFromSpec', () => {
    it('returns 0 at or below minChargeFrames', () => {
      expect(computeChargeTFromSpec(FIXTURE, 0)).toBe(0);
      expect(computeChargeTFromSpec(FIXTURE, 4)).toBe(0);
    });

    it('returns 1 at or above maxChargeFrames', () => {
      expect(computeChargeTFromSpec(FIXTURE, 64)).toBe(1);
      expect(computeChargeTFromSpec(FIXTURE, 200)).toBe(1);
    });

    it('linearly interpolates between min and max', () => {
      expect(computeChargeTFromSpec(FIXTURE, 34)).toBeCloseTo(0.5, 5);
      expect(computeChargeTFromSpec(FIXTURE, 19)).toBeCloseTo(0.25, 5);
    });

    it('is monotonic non-decreasing', () => {
      let prev = -Infinity;
      for (let f = 0; f <= 80; f += 1) {
        const t = computeChargeTFromSpec(FIXTURE, f);
        expect(t).toBeGreaterThanOrEqual(prev);
        prev = t;
      }
    });

    it('is deterministic — identical inputs yield identical outputs', () => {
      expect(computeChargeTFromSpec(FIXTURE, 30)).toBe(
        computeChargeTFromSpec(FIXTURE, 30),
      );
    });
  });

  describe('computeChargedDamageFromSpec', () => {
    it('returns minDamage at or below minChargeFrames', () => {
      expect(computeChargedDamageFromSpec(FIXTURE, 0)).toBe(5);
      expect(computeChargedDamageFromSpec(FIXTURE, 4)).toBe(5);
    });

    it('returns maxDamage at or above maxChargeFrames', () => {
      expect(computeChargedDamageFromSpec(FIXTURE, 64)).toBe(20);
    });

    it('linearly interpolates damage at midpoint', () => {
      expect(computeChargedDamageFromSpec(FIXTURE, 34)).toBeCloseTo(12.5, 5);
    });
  });

  describe('computeChargedKnockbackFromSpec', () => {
    it('returns minKnockback at or below minChargeFrames', () => {
      const kb = computeChargedKnockbackFromSpec(FIXTURE, 0);
      expect(kb).toEqual(FIXTURE.minKnockback);
    });

    it('returns maxKnockback at or above maxChargeFrames', () => {
      const kb = computeChargedKnockbackFromSpec(FIXTURE, 64);
      expect(kb).toEqual(FIXTURE.maxKnockback);
    });

    it('lerps each component independently at midpoint', () => {
      const kb = computeChargedKnockbackFromSpec(FIXTURE, 34);
      expect(kb.x).toBeCloseTo(1.75, 5);
      expect(kb.y).toBeCloseTo(-0.55, 5);
      expect(kb.scaling).toBeCloseTo(0.12, 5);
    });
  });

  describe('validateChargeSpec', () => {
    it('returns the spec unchanged on success', () => {
      expect(validateChargeSpec(FIXTURE, 'test')).toBe(FIXTURE);
    });

    it('rejects negative minChargeFrames', () => {
      expect(() =>
        validateChargeSpec({ ...FIXTURE, minChargeFrames: -1 }, 'test'),
      ).toThrow(/minChargeFrames/);
    });

    it('rejects non-integer minChargeFrames', () => {
      expect(() =>
        validateChargeSpec({ ...FIXTURE, minChargeFrames: 4.5 }, 'test'),
      ).toThrow(/minChargeFrames/);
    });

    it('rejects maxChargeFrames <= minChargeFrames', () => {
      expect(() =>
        validateChargeSpec(
          { ...FIXTURE, minChargeFrames: 10, maxChargeFrames: 10 },
          'test',
        ),
      ).toThrow(/maxChargeFrames/);
      expect(() =>
        validateChargeSpec(
          { ...FIXTURE, minChargeFrames: 10, maxChargeFrames: 5 },
          'test',
        ),
      ).toThrow(/maxChargeFrames/);
    });

    it('rejects negative damage', () => {
      expect(() =>
        validateChargeSpec({ ...FIXTURE, minDamage: -1 }, 'test'),
      ).toThrow(/damage range/);
    });

    it('rejects maxDamage < minDamage', () => {
      expect(() =>
        validateChargeSpec(
          { ...FIXTURE, minDamage: 10, maxDamage: 5 },
          'test',
        ),
      ).toThrow(/damage range/);
    });

    it('embeds the context label in error messages', () => {
      expect(() =>
        validateChargeSpec(
          { ...FIXTURE, minChargeFrames: -1 },
          "move 'wolf.sideLight'",
        ),
      ).toThrow(/move 'wolf\.sideLight'/);
    });
  });
});
