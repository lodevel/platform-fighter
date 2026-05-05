import { describe, it, expect } from 'vitest';
import {
  DAMAGE_HUD_COLOR_RAMP,
  colorIntToHexString,
  damagePercentColor,
  formatDamagePercent,
} from './damageHudFormat';
import { MAX_DAMAGE_PERCENT } from '../characters/combat';

/**
 * Sub-AC 3 of AC 60003 — pure formatting helpers for the in-match
 * damage HUD. The Phaser-touching `DamageHud` component imports these
 * to render text + colour; the tests here pin the contract those calls
 * depend on.
 */
describe('formatDamagePercent', () => {
  it('renders 0 as "0%"', () => {
    expect(formatDamagePercent(0)).toBe('0%');
  });

  it('renders an integer percent verbatim', () => {
    expect(formatDamagePercent(23)).toBe('23%');
    expect(formatDamagePercent(100)).toBe('100%');
    expect(formatDamagePercent(999)).toBe('999%');
  });

  it('truncates fractional percents toward zero (no flicker)', () => {
    // 23.0 → 23.4 → 23.8 must all read "23%" so the meter doesn't
    // jump to 24 mid-tick from rounding.
    expect(formatDamagePercent(23.0)).toBe('23%');
    expect(formatDamagePercent(23.4)).toBe('23%');
    expect(formatDamagePercent(23.8)).toBe('23%');
    // The next integer step happens once the underlying value crosses
    // 24.0 itself.
    expect(formatDamagePercent(24.0)).toBe('24%');
  });

  it('clamps negative percents to "0%" (no healing in v1)', () => {
    expect(formatDamagePercent(-1)).toBe('0%');
    expect(formatDamagePercent(-100)).toBe('0%');
  });

  it(`clamps overflow at MAX_DAMAGE_PERCENT (${MAX_DAMAGE_PERCENT})`, () => {
    expect(formatDamagePercent(1000)).toBe(`${MAX_DAMAGE_PERCENT}%`);
    expect(formatDamagePercent(99999)).toBe(`${MAX_DAMAGE_PERCENT}%`);
  });

  it('treats NaN / Infinity as 0% (defensive)', () => {
    expect(formatDamagePercent(Number.NaN)).toBe('0%');
    expect(formatDamagePercent(Number.POSITIVE_INFINITY)).toBe('0%');
    expect(formatDamagePercent(Number.NEGATIVE_INFINITY)).toBe('0%');
  });
});

describe('damagePercentColor', () => {
  it('uses the lowest band for percents below the first threshold', () => {
    const lowest = DAMAGE_HUD_COLOR_RAMP[0]!.color;
    expect(damagePercentColor(0)).toBe(lowest);
    expect(damagePercentColor(49)).toBe(lowest);
    expect(damagePercentColor(-5)).toBe(lowest);
  });

  it('escalates as the percent crosses each threshold', () => {
    // 50 % crosses into the second band (warming up).
    expect(damagePercentColor(50)).toBe(DAMAGE_HUD_COLOR_RAMP[1]!.color);
    expect(damagePercentColor(99)).toBe(DAMAGE_HUD_COLOR_RAMP[1]!.color);
    // 100 % crosses into the third band (kill range opens).
    expect(damagePercentColor(100)).toBe(DAMAGE_HUD_COLOR_RAMP[2]!.color);
    expect(damagePercentColor(149)).toBe(DAMAGE_HUD_COLOR_RAMP[2]!.color);
    // 150 % is the top band (red — one good hit and you're gone).
    expect(damagePercentColor(150)).toBe(DAMAGE_HUD_COLOR_RAMP[3]!.color);
    expect(damagePercentColor(999)).toBe(DAMAGE_HUD_COLOR_RAMP[3]!.color);
  });

  it('treats NaN as the lowest band', () => {
    expect(damagePercentColor(Number.NaN)).toBe(
      DAMAGE_HUD_COLOR_RAMP[0]!.color,
    );
  });

  it('ramp is sorted ascending (contract for the threshold walk)', () => {
    for (let i = 1; i < DAMAGE_HUD_COLOR_RAMP.length; i += 1) {
      expect(DAMAGE_HUD_COLOR_RAMP[i]!.threshold).toBeGreaterThan(
        DAMAGE_HUD_COLOR_RAMP[i - 1]!.threshold,
      );
    }
  });
});

describe('colorIntToHexString', () => {
  it('zero-pads short hex values', () => {
    expect(colorIntToHexString(0x000000)).toBe('#000000');
    expect(colorIntToHexString(0x00ff00)).toBe('#00ff00');
    expect(colorIntToHexString(0xff)).toBe('#0000ff');
  });

  it('clamps values outside the 24-bit range', () => {
    expect(colorIntToHexString(-1)).toBe('#000000');
    expect(colorIntToHexString(0x1000000)).toBe('#ffffff');
  });

  it('round-trips with damagePercentColor', () => {
    for (let p = 0; p <= 200; p += 25) {
      const c = damagePercentColor(p);
      const s = colorIntToHexString(c);
      expect(s).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
