import { describe, it, expect } from 'vitest';
import {
  SWING_TRAIL_COLOR_RAMP,
  SWING_TRAIL_FADE_FRAMES,
  SWING_TRAIL_MAX_DAMAGE,
  SWING_TRAIL_MIN_DAMAGE,
  SWING_TRAIL_PEAK_ALPHA,
  computeSwingTrailVisual,
  swingTrailActiveAlphaMultiplier,
  swingTrailAppliesTo,
  swingTrailColor,
  swingTrailIntensity,
  type SwingTrailInput,
} from './swingTrailFormat';

/**
 * The swing trail's pure formatter decides which moves earn a sweep
 * streak and what that streak looks like. These tests pin the
 * classification (weapons + smashes only), the geometry truthfulness
 * (footprint == real hitbox mirrored by facing), and the active-frame
 * fade so a refactor can't silently start trailing every jab or lie
 * about a weapon's reach.
 */

const HITBOX = Object.freeze({ offsetX: 60, offsetY: -10, width: 80, height: 40 });

function input(overrides: Partial<SwingTrailInput>): SwingTrailInput {
  return {
    moveId: 'item.sword.slash',
    moveType: 'smash',
    damage: 14,
    phase: 'active',
    framesIntoActive: 0,
    hitbox: HITBOX,
    facing: 1,
    ...overrides,
  };
}

describe('swingTrailFormat — swingTrailAppliesTo', () => {
  it('applies to every held-weapon move id', () => {
    expect(swingTrailAppliesTo('item.sword.slash', 'tilt')).toBe(true);
    expect(swingTrailAppliesTo('item.bat.swing', 'jab')).toBe(true);
    expect(swingTrailAppliesTo('item.hammer.smash', 'smash')).toBe(true);
    expect(swingTrailAppliesTo('item.spear.thrust', 'tilt')).toBe(true);
  });

  it('applies to smash-type moves regardless of id', () => {
    expect(swingTrailAppliesTo('wolf.smash.forward', 'smash')).toBe(true);
  });

  it('does NOT apply to fast pokes (jab / tilt / aerial / special)', () => {
    expect(swingTrailAppliesTo('wolf.jab', 'jab')).toBe(false);
    expect(swingTrailAppliesTo('cat.ftilt', 'tilt')).toBe(false);
    expect(swingTrailAppliesTo('owl.nair', 'aerial')).toBe(false);
    expect(swingTrailAppliesTo('owl.neutralB', 'special')).toBe(false);
  });
});

describe('swingTrailFormat — intensity & colour', () => {
  it('intensity floors / ceilings on the damage ramp', () => {
    expect(swingTrailIntensity(SWING_TRAIL_MIN_DAMAGE)).toBe(0);
    expect(swingTrailIntensity(SWING_TRAIL_MAX_DAMAGE)).toBe(1);
    expect(swingTrailIntensity(0)).toBe(0);
  });

  it('colour walks the ramp by intensity', () => {
    expect(swingTrailColor(0)).toBe(SWING_TRAIL_COLOR_RAMP[0]!.color);
    expect(swingTrailColor(1)).toBe(
      SWING_TRAIL_COLOR_RAMP[SWING_TRAIL_COLOR_RAMP.length - 1]!.color,
    );
  });
});

describe('swingTrailFormat — active alpha falloff', () => {
  it('is full on the first active frame', () => {
    expect(swingTrailActiveAlphaMultiplier(0)).toBe(1);
  });

  it('fades over the configured number of frames but never to zero', () => {
    const mid = swingTrailActiveAlphaMultiplier(Math.floor(SWING_TRAIL_FADE_FRAMES / 2));
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0);
    // Long active windows floor at the configured minimum.
    expect(swingTrailActiveAlphaMultiplier(999)).toBeGreaterThan(0);
  });
});

describe('swingTrailFormat — computeSwingTrailVisual', () => {
  it('hides during startup / recovery (weapon not swinging yet)', () => {
    expect(computeSwingTrailVisual(input({ phase: 'startup' })).visible).toBe(false);
    expect(computeSwingTrailVisual(input({ phase: 'recovery' })).visible).toBe(false);
  });

  it('hides for non-trailed moves even in the active phase', () => {
    const v = computeSwingTrailVisual(
      input({ moveId: 'wolf.jab', moveType: 'jab' }),
    );
    expect(v.visible).toBe(false);
  });

  it('draws on the real hitbox footprint, mirrored by facing right', () => {
    const v = computeSwingTrailVisual(input({ facing: 1 }));
    expect(v.visible).toBe(true);
    expect(v.offsetX).toBe(HITBOX.offsetX); // +60 forward when facing right
    expect(v.offsetY).toBe(HITBOX.offsetY); // vertical taken as-is
    expect(v.width).toBe(HITBOX.width);
    expect(v.height).toBe(HITBOX.height);
  });

  it('mirrors the footprint to the left when facing left', () => {
    const v = computeSwingTrailVisual(input({ facing: -1 }));
    expect(v.offsetX).toBe(-HITBOX.offsetX); // mirrored behind/to the left
    expect(v.offsetY).toBe(HITBOX.offsetY); // unchanged
  });

  it('fades alpha across the active window', () => {
    const fresh = computeSwingTrailVisual(input({ framesIntoActive: 0 }));
    const stale = computeSwingTrailVisual(
      input({ framesIntoActive: SWING_TRAIL_FADE_FRAMES }),
    );
    expect(fresh.fillAlpha).toBe(SWING_TRAIL_PEAK_ALPHA);
    expect(stale.fillAlpha).toBeLessThan(fresh.fillAlpha);
  });

  it('is deterministic — identical input yields identical visual', () => {
    expect(computeSwingTrailVisual(input({}))).toEqual(
      computeSwingTrailVisual(input({})),
    );
  });
});
