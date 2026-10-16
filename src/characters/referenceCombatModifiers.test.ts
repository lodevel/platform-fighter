import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { computeHitlag, computeKnockback, computeRageMultiplier, computeShieldHitlag, computeShieldParryHitlag, computeShieldstun, computeStaleMultiplier, type HitInfo, type StaleEntry } from './combat';
import { applyCombatModifiers } from './referenceCombatModifiers';

// Execute the pinned, unmodified independent calculator functions. Its full
// trajectory class is irrelevant here; capture the KB argument at its boundary.
const source = readFileSync(new URL('../../docs/review/2026-09-22/combat-parity/shared/sources/calculator-formulas.js', import.meta.url), 'utf8');
const oracle = runInNewContext(source + '\n({ parameters, Hitlag, Rage, StaleNegation, VSKB, ShieldStun, ShieldHitlag, ParryHitlag, AttackerParryHitlag })', {
  Knockback: class { constructor(public kb: number) {} },
}) as {
  Hitlag: (damage: number, multiplier: number, electric: boolean, crouch: number, projectile: boolean, players: number) => number;
  Rage: (percent: number) => number;
  StaleNegation: (queue: boolean[], shields: boolean[], ignore: boolean) => number;
  VSKB: (...args: unknown[]) => { kb: number };
  ShieldStun: (damage: number, multiplier: number, projectile: boolean, attached: boolean, perfect: boolean, smash: boolean, aerial: boolean) => number;
  ShieldHitlag: (damage: number, multiplier: number, electric: boolean, perfect: boolean, projectile: boolean, attached: boolean, direct: boolean) => number;
  ParryHitlag: (damage: number, multiplier: number, electric: boolean, projectile: boolean, attached: boolean, direct: boolean, players: number) => number;
  AttackerParryHitlag: (damage: number, multiplier: number, electric: boolean, projectile: boolean, attached: boolean, direct: boolean, players: number) => number;
};

describe('reference combat modifiers — independent pinned calculator', () => {
  it.each([0, 35, 92.5, 150, 999])('matches rage at %s percent', percent => {
    expect(computeRageMultiplier(percent)).toBeCloseTo(oracle.Rage(percent), 12);
  });

  it.each([[], [0], [8], [0, 3, 8], [0, 1, 2, 3, 4, 5, 6, 7, 8]].map(slots => ({ slots })))('matches stale queue slots $slots', ({ slots }) => {
    for (const shield of [false, true]) {
      const entries: StaleEntry[] = Array.from({ length: 9 }, (_, slot) => ({ moveId: slots.includes(slot) ? 'jab' : 'other', shield }));
      const expected = oracle.StaleNegation(entries.map(entry => entry.moveId === 'jab'), entries.map(entry => entry.shield), false);
      expect(computeStaleMultiplier(entries, 'jab')).toBeCloseTo(expected, 12);
    }
  });

  it.each([0, 3, 4, 10, 20, 60])('matches hitlag at damage %s, including zero/capped and multiplayer cases', damage => {
    for (const multiplier of [0, 0.5, 1, 1.2, 1.6, 2]) {
      for (const players of [2, 3, 4, 8]) {
        for (const crouching of [false, true]) {
          expect(computeHitlag({ damage, targetPercent: 200, sweetSpot: true, multiplier, players, crouching }))
            .toBe(oracle.Hitlag(damage, multiplier, false, crouching ? 0.67 : 1, false, players));
        }
      }
    }
  });

  it.each([0, 50, 150])('matches percent/damage/weight/rage/stale growth together at %s percent', percent => {
    const hit: HitInfo = { damage: 10, knockback: { x: 1, y: -1, scaling: 0, reference: { base: 30, growth: 100, angle: 45 } }, facing: 1 };
    for (const weight of [100, 104, 127]) {
      for (const attacker of [0, 92.5, 150]) {
        for (const slots of [[], [0], [8], [0, 2, 8]]) {
          const queue = Array.from({ length: 9 }, (_, index) => slots.includes(index));
          const shields = queue.map((_, index) => index % 2 === 0);
          const stale = oracle.StaleNegation(queue, shields, false);
          const modified = applyCombatModifiers(hit, attacker, stale);
          const actual = computeKnockback(modified, percent + modified.damage, 1, { referenceWeight: weight });
          const expected = oracle.VSKB(percent, 10, 10, weight, 100, 30, .096, 1.6, 1,
            queue, shields, false, attacker, 45, false, false, false, false, { X: 0, Y: 0 }, false, 1);
          expect(modified.damage).toBeCloseTo(10 * stale, 12);
          expect(actual.referenceKnockback).toBeCloseTo(expected.kb, 10);
          expect(modified.baseDamage).toBe(10);
        }
      }
    }
  });

  it('keeps fixed launch independent of rage/staling while damage still changes', () => {
    const hit: HitInfo = { damage: 5, knockback: { x: 1, y: -1, scaling: 0, reference: { base: 0, growth: 100, angle: 70, fixed: 36, setWeight: true } }, facing: 1 };
    for (const stale of [1.05, .91, .4695]) {
      const effective = applyCombatModifiers(hit, 150, stale);
      expect(effective.damage).toBeCloseTo(5 * stale);
      expect(computeKnockback(effective, 100 + effective.damage, 1).referenceKnockback).toBeCloseTo(44.6);
    }
  });

  it.each(['normal', 'smash', 'aerial', 'projectile'] as const)('matches %s shieldstun and ordinary hit-stop', kind => {
    for (const damage of [0, 3.15, 10, 30, 50]) {
      expect(computeShieldstun(damage, kind)).toBe(oracle.ShieldStun(damage, 1,
        kind === 'projectile', false, false, kind === 'smash', kind === 'aerial'));
      for (const multiplier of [0, .5, 1, 1.6, 2]) {
        expect(computeShieldHitlag({ damage, targetPercent: 0, multiplier }))
          .toBe(multiplier === 0 ? 0
            : oracle.ShieldHitlag(damage, multiplier, false, false, kind === 'projectile', false, kind !== 'projectile'));
      }
    }
  });

  // SmashWiki Perfect shield (Ultimate) wins over the calculator oracle: a release parry adds
  // +11 defender / +14 attacker frames to shield hitlag for direct melee hits and leaves a
  // detached (indirect) projectile's owner free with the victim 1 frame under shield hitlag,
  // in every player count. https://www.ssbwiki.com/Perfect_shield
  it.each([false, true])('release-parry hit-stop follows SmashWiki for detached projectile=%s', projectile => {
    expect(computeShieldParryHitlag({ damage: 0, targetPercent: 0 }, projectile)).toEqual({ defender: 0, attacker: 0 });
    for (const damage of [3, 10, 30, 99]) {
      for (const multiplier of [0, 1, 1.6, 2]) {
        for (const players of [2, 3, 4]) {
          const base = computeShieldHitlag({ damage, targetPercent: 0, multiplier, players });
          expect(computeShieldParryHitlag({ damage, targetPercent: 0, multiplier, players }, projectile)).toEqual({
            defender: multiplier === 0 ? 0 : base + (projectile ? -1 : 11),
            attacker: multiplier === 0 || projectile ? 0 : base + 14,
          });
        }
      }
    }
  });
});
