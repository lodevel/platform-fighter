import { describe, expect, it } from 'vitest';
import { computeHitlag, computeShieldHitlag, computeShieldParryHitlag } from './combat';

/** Published Ultimate Hitlag equation, retained source clock contract;
 * ordinary fixtures remain independent regressions for existing profiles. */
describe('authored electric collision attribute', () => {
  it('preserves the source hitbox multiplier instead of folding electricity into it', () => {
    const jolt = { damage: 4.8, targetPercent: 0, multiplier: 0.3, electricCollision: true, projectile: true };
    expect(computeHitlag(jolt)).toBe(4);
    expect(computeShieldHitlag(jolt)).toBe(9);
    expect(computeHitlag({ ...jolt, electricCollision: false })).toBe(2);
    expect(computeShieldHitlag({ ...jolt, electricCollision: false })).toBe(6);
  });
  it('gives the15-percent self-contact23 frozen steps and honors zero-hitlag bolts', () => {
    expect(computeHitlag({ damage: 15, targetPercent: 0, electricCollision: true })).toBe(23);
    expect(computeHitlag({ damage: 6, targetPercent: 0, electricCollision: true, multiplier: 0 })).toBe(0);
    expect(computeShieldHitlag({ damage: 6, targetPercent: 0, electricCollision: true, multiplier: 0 })).toBe(0);
    expect(computeShieldParryHitlag({ damage: 6, targetPercent: 0, electricCollision: true, multiplier: 0 }, true))
      .toEqual({ defender: 0, attacker: 0 });
  });
  it('keeps projectile victims exempt from multiplayer reduction and applies crouch after count rounding', () => {
    const thunder = { damage: 15, targetPercent: 0, electricCollision: true, players: 4 };
    expect(computeHitlag(thunder)).toBe(20);
    expect(computeHitlag({ ...thunder, projectile: true })).toBe(23);
    expect(computeHitlag({ ...thunder, crouching: true })).toBe(13);
  });
});
