import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { computeShieldPushback, decayShieldPushback } from './shieldPushback';
import { getNativeShieldPushTraction } from './nativeShieldTraction';

const sourcePath = 'docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics/sources';

describe('sourced ordinary-block shield push adapter', () => {
  it('selects published receiving traction for each fighter and none for an unknown id', () => {
    expect(getNativeShieldPushTraction('donkeykong')).toBeCloseTo(.615);
    expect(getNativeShieldPushTraction('pikachu')).toBeCloseTo(.66);
    expect(getNativeShieldPushTraction('link')).toBeCloseTo(.565);
    expect(getNativeShieldPushTraction('unknown')).toBeNull();
  });
  it('independently matches the retained calculator attacker equation, including remote projectile recoil', () => {
    const raw = readFileSync(`${sourcePath}/calculator-formulas.js`, 'utf8');
    const body = /function AttackerShieldPushback\([\s\S]*?\n\}/.exec(raw)![0];
    const context = vm.createContext({});
    vm.runInContext(body, context);
    for (const damage of [1, 14, 100, 999]) {
      expect(computeShieldPushback({ damage }).attackerSpeed)
        .toBe(vm.runInContext(`AttackerShieldPushback(${damage})`, context) * 5);
      expect(computeShieldPushback({ damage, kind: 'projectile' }).attackerSpeed).toBe(0);
    }
  });
  it('uses fractional shieldstun and the separately selected current Wiki +1 equation', () => {
    // 1% normal: stun 2.8, defender .342 native; no rounding to stun 2.
    expect(computeShieldPushback({ damage: 1, pixelsPerUnit: 1 }).defenderSpeed).toBeCloseTo(.342);
    // 14% Hand Slap: stun 13.2, speed 1.278 * native .58 * project five.
    expect(computeShieldPushback({ damage: 14, setoffMultiplier: .58 }).defenderSpeed).toBeCloseTo(3.7062);
    expect(computeShieldPushback({ damage: 14, setoffMultiplier: .58 }).attackerSpeed).toBeCloseTo(2.925);
  });
  it('caps the defender baseline while preserving uncapped attacker recoil and explicit post-cap move factor', () => {
    const push = computeShieldPushback({ damage: 100, setoffMultiplier: .58 });
    expect(push.defenderSpeed).toBeCloseTo(3.77);
    expect(push.attackerSpeed).toBeCloseTo(20.125);
  });
  it('distinguishes smash, aerial and remote projectile shieldstun factors', () => {
    expect(computeShieldPushback({ damage: 10, kind: 'smash', pixelsPerUnit: 1 }).defenderSpeed).toBeCloseTo(.792);
    expect(computeShieldPushback({ damage: 10, kind: 'aerial', pixelsPerUnit: 1 }).defenderSpeed).toBeCloseTo(.5076);
    expect(computeShieldPushback({ damage: 10, kind: 'projectile', pixelsPerUnit: 1 }).defenderSpeed).toBeCloseTo(.4788);
  });
  it('decays signed speeds without reversal; hitlag preserves speed and attacker gets 1.1 traction', () => {
    expect(decayShieldPushback(-1, .2)).toBeCloseTo(-.8);
    expect(decayShieldPushback(1, .2, true)).toBeCloseTo(.78);
    expect(decayShieldPushback(-.1, .2)).toBe(0);
    expect(decayShieldPushback(-1, .2, true, true)).toBe(-1);
  });
  it('zero damage creates no displacement and malformed inputs fail before entering physics', () => {
    expect(computeShieldPushback({ damage: 0 })).toEqual({ defenderSpeed: 0, attackerSpeed: 0 });
    expect(() => computeShieldPushback({ damage: NaN })).toThrow();
    expect(() => computeShieldPushback({ damage: 1, setoffMultiplier: -1 })).toThrow();
    expect(() => decayShieldPushback(1, Infinity)).toThrow();
  });
});
