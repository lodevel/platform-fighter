import { describe, it, expect } from 'vitest';
import {
  DODGE_ANIMATION_FRAMES,
  DODGE_PART_ID,
  HURT_PART_ID,
  LEDGE_ANIMATION_FRAMES,
  LEDGE_PART_ID,
  SHIELD_ANIMATION_FRAMES,
  SHIELD_PART_ID,
  computeDodgeFramesInPhase,
  dodgeStateToAnimationPhase,
  enumerateAllDefensiveAnimationKeys,
  enumerateDefensiveAnimationKeys,
  getDodgeAnimationKey,
  getHurtAnimationKey,
  getLedgeAnimationKey,
  getShieldAnimationKey,
  ledgeStateToAnimationPhase,
  resolveDodgeAnimation,
  resolveLedgeAnimation,
  resolveShieldAnimation,
  selectDodgeArtFrame,
  selectLedgeArtFrame,
  selectShieldArtFrame,
  shieldStateToAnimationPhase,
} from './defensiveAnimationState';
import type { ShieldState } from './shieldState';
import type { DodgeState } from './dodgeState';
import type { LedgeHangState } from './ledgeHangState';
import type { CharacterId } from '../types';

const ALL_CHARACTERS: ReadonlyArray<CharacterId> = ['wolf', 'cat', 'owl', 'bear', 'blaze', 'puff', 'aegis', 'volt', 'nova', 'bruno', 'link', 'kirby', 'donkeykong'];

describe('AC 10003 Sub-AC 3 — defensive animation state', () => {
  describe('Constants', () => {
    it('exposes part ids for every defensive subsystem', () => {
      expect(SHIELD_PART_ID).toBe('shield');
      expect(DODGE_PART_ID).toBe('dodge');
      expect(LEDGE_PART_ID).toBe('ledge');
      expect(HURT_PART_ID).toBe('hurt');
    });

    it('every shield phase has a positive frame count', () => {
      for (const phase of ['raise', 'hold', 'break'] as const) {
        expect(SHIELD_ANIMATION_FRAMES[phase]).toBeGreaterThan(0);
      }
    });

    it('every dodge variant × phase has a positive frame count', () => {
      for (const kind of ['spot', 'roll', 'air'] as const) {
        for (const phase of ['active', 'recovery'] as const) {
          expect(DODGE_ANIMATION_FRAMES[kind][phase]).toBeGreaterThan(0);
        }
      }
    });

    it('every ledge phase has a positive frame count', () => {
      for (const phase of ['hanging', 'climbing', 'rolling'] as const) {
        expect(LEDGE_ANIMATION_FRAMES[phase]).toBeGreaterThan(0);
      }
    });
  });

  describe('Shield animation', () => {
    it('maps idle → null, active → hold, broken → break', () => {
      expect(shieldStateToAnimationPhase('idle')).toBeNull();
      expect(shieldStateToAnimationPhase('active')).toBe('hold');
      expect(shieldStateToAnimationPhase('broken')).toBe('break');
    });

    it('builds canonical keys for all phases', () => {
      expect(getShieldAnimationKey('wolf', 'hold', 0)).toBe('wolf.shield.hold.0');
      expect(getShieldAnimationKey('cat', 'break', 2)).toBe('cat.shield.break.2');
      expect(getShieldAnimationKey('owl', 'raise', 1)).toBe('owl.shield.raise.1');
    });

    it('selectShieldArtFrame clamps to the phase frame count', () => {
      expect(selectShieldArtFrame('hold', 0)).toBe(0);
      expect(selectShieldArtFrame('hold', 99)).toBe(0);
      expect(selectShieldArtFrame('break', 0)).toBe(0);
      expect(selectShieldArtFrame('break', 100)).toBe(SHIELD_ANIMATION_FRAMES.break - 1);
      expect(selectShieldArtFrame('break', -1)).toBe(0);
    });

    it('resolveShieldAnimation returns null when shield is idle', () => {
      const idle: ShieldState = {
        name: 'idle',
        health: 50,
        stunRemaining: 0,
        blockStunRemaining: 0,
        framesSinceLastDamage: 0,
      };
      expect(resolveShieldAnimation('wolf', idle)).toBeNull();
    });

    it('resolveShieldAnimation produces hold key when active', () => {
      const active: ShieldState = {
        name: 'active',
        health: 40,
        stunRemaining: 0,
        blockStunRemaining: 0,
        framesSinceLastDamage: 0,
      };
      const a = resolveShieldAnimation('cat', active, 0);
      expect(a).not.toBeNull();
      expect(a!.kind).toBe('shield');
      expect(a!.phase).toBe('hold');
      expect(a!.key).toBe('cat.shield.hold.0');
    });

    it('resolveShieldAnimation produces break keys when broken, ramping with elapsed', () => {
      const broken: ShieldState = {
        name: 'broken',
        health: 0,
        stunRemaining: 100,
        blockStunRemaining: 0,
        framesSinceLastDamage: 0,
      };
      for (let elapsed = 0; elapsed <= 10; elapsed++) {
        const a = resolveShieldAnimation('bear', broken, elapsed);
        expect(a).not.toBeNull();
        expect(a!.phase).toBe('break');
        expect(a!.key.startsWith('bear.shield.break.')).toBe(true);
      }
    });
  });

  describe('Dodge animation', () => {
    it('maps idle/cooldown → null, active → active, recovery → recovery', () => {
      expect(dodgeStateToAnimationPhase('idle')).toBeNull();
      expect(dodgeStateToAnimationPhase('cooldown')).toBeNull();
      expect(dodgeStateToAnimationPhase('active')).toBe('active');
      expect(dodgeStateToAnimationPhase('recovery')).toBe('recovery');
    });

    it('builds canonical keys for every variant × phase', () => {
      expect(getDodgeAnimationKey('wolf', 'spot', 'active', 0)).toBe(
        'wolf.dodge.spot.active.0',
      );
      expect(getDodgeAnimationKey('cat', 'roll', 'recovery', 1)).toBe(
        'cat.dodge.roll.recovery.1',
      );
      expect(getDodgeAnimationKey('owl', 'air', 'active', 3)).toBe(
        'owl.dodge.air.active.3',
      );
    });

    it('selectDodgeArtFrame clamps to phase frame count', () => {
      expect(selectDodgeArtFrame('spot', 'active', 0)).toBe(0);
      expect(selectDodgeArtFrame('spot', 'active', 1000)).toBe(
        DODGE_ANIMATION_FRAMES.spot.active - 1,
      );
      expect(selectDodgeArtFrame('air', 'recovery', -10)).toBe(0);
    });

    it('resolveDodgeAnimation returns null when idle', () => {
      const idle: DodgeState = {
        name: 'idle',
        active: null,
        iframesRemaining: 0,
        cooldownRemaining: 0,
      };
      expect(resolveDodgeAnimation('wolf', idle)).toBeNull();
    });

    it('resolveDodgeAnimation returns null when on cooldown', () => {
      const cooldown: DodgeState = {
        name: 'cooldown',
        active: null,
        iframesRemaining: 0,
        cooldownRemaining: 5,
      };
      expect(resolveDodgeAnimation('wolf', cooldown)).toBeNull();
    });

    it('resolveDodgeAnimation produces correct key for each kind × phase', () => {
      const variants = ['spot', 'roll', 'air'] as const;
      for (const kind of variants) {
        const active: DodgeState = {
          name: 'active',
          active: { kind, facing: 1, framesElapsed: 0 },
          iframesRemaining: 14,
          cooldownRemaining: 0,
        };
        const a = resolveDodgeAnimation('cat', active, 0);
        expect(a).not.toBeNull();
        expect(a!.kind).toBe('dodge');
        expect(a!.key).toBe(`cat.dodge.${kind}.active.0`);
      }
    });

    it('returns null when active is unexpectedly null', () => {
      const corrupt: DodgeState = {
        name: 'active',
        active: null,
        iframesRemaining: 0,
        cooldownRemaining: 0,
      };
      expect(resolveDodgeAnimation('owl', corrupt)).toBeNull();
    });

    it('computeDodgeFramesInPhase returns 0 for null inputs', () => {
      expect(computeDodgeFramesInPhase(null, null, 0)).toBe(0);
      expect(computeDodgeFramesInPhase(null, 'active', 16)).toBe(0);
    });

    it('computeDodgeFramesInPhase mirrors framesElapsed during the active phase', () => {
      const active = { kind: 'spot' as const, facing: 1 as const, framesElapsed: 5 };
      expect(computeDodgeFramesInPhase(active, 'active', 16)).toBe(5);
    });

    it('computeDodgeFramesInPhase subtracts active window during recovery', () => {
      const active = { kind: 'spot' as const, facing: 1 as const, framesElapsed: 18 };
      // active=16, so recovery elapsed = 18 - 16 = 2.
      expect(computeDodgeFramesInPhase(active, 'recovery', 16)).toBe(2);
    });
  });

  describe('Ledge animation', () => {
    it('maps idle/cooldown → null, hanging/climbing/rolling → matching phase', () => {
      expect(ledgeStateToAnimationPhase('idle')).toBeNull();
      expect(ledgeStateToAnimationPhase('cooldown')).toBeNull();
      expect(ledgeStateToAnimationPhase('hanging')).toBe('hanging');
      expect(ledgeStateToAnimationPhase('climbing')).toBe('climbing');
      expect(ledgeStateToAnimationPhase('rolling')).toBe('rolling');
    });

    it('builds canonical keys for every phase', () => {
      expect(getLedgeAnimationKey('wolf', 'hanging', 0)).toBe('wolf.ledge.hanging.0');
      expect(getLedgeAnimationKey('cat', 'climbing', 2)).toBe('cat.ledge.climbing.2');
      expect(getLedgeAnimationKey('owl', 'rolling', 1)).toBe('owl.ledge.rolling.1');
    });

    it('selectLedgeArtFrame clamps to phase frame count', () => {
      expect(selectLedgeArtFrame('hanging', 1000)).toBe(LEDGE_ANIMATION_FRAMES.hanging - 1);
      expect(selectLedgeArtFrame('climbing', -1)).toBe(0);
    });

    it('resolveLedgeAnimation returns null when idle / cooldown', () => {
      const idle: LedgeHangState = {
        name: 'idle',
        active: null,
        cooldownRemaining: 0,
        hangIframesRemaining: 0,
      } as LedgeHangState;
      expect(resolveLedgeAnimation('wolf', idle)).toBeNull();

      const cooldown: LedgeHangState = {
        name: 'cooldown',
        active: null,
        cooldownRemaining: 5,
        hangIframesRemaining: 0,
      } as LedgeHangState;
      expect(resolveLedgeAnimation('wolf', cooldown)).toBeNull();
    });

    it('resolveLedgeAnimation produces correct keys for each ledge phase', () => {
      const cases: Array<['hanging' | 'climbing' | 'rolling', LedgeHangState['name']]> = [
        ['hanging', 'hanging'],
        ['climbing', 'climbing'],
        ['rolling', 'rolling'],
      ];
      for (const [animPhase, machineName] of cases) {
        const state: LedgeHangState = {
          name: machineName,
          active: null,
          cooldownRemaining: 0,
          hangIframesRemaining: 0,
        } as LedgeHangState;
        const a = resolveLedgeAnimation('bear', state, 0);
        expect(a).not.toBeNull();
        expect(a!.kind).toBe('ledge');
        expect(a!.phase).toBe(animPhase);
        expect(a!.key).toBe(`bear.ledge.${animPhase}.0`);
      }
    });
  });

  describe('Hurt key', () => {
    it('builds the canonical hurt key per character', () => {
      expect(getHurtAnimationKey('wolf')).toBe('wolf.hurt');
      expect(getHurtAnimationKey('cat')).toBe('cat.hurt');
      expect(getHurtAnimationKey('owl')).toBe('owl.hurt');
      expect(getHurtAnimationKey('bear')).toBe('bear.hurt');
    });
  });

  describe('Enumeration', () => {
    it('enumerateDefensiveAnimationKeys covers every shield/dodge/ledge/hurt key for one character', () => {
      const keys = enumerateDefensiveAnimationKeys('wolf');
      // Shield: 2+1+4 = 7 raise/hold/break keys.
      let expected = SHIELD_ANIMATION_FRAMES.raise + SHIELD_ANIMATION_FRAMES.hold + SHIELD_ANIMATION_FRAMES.break;
      // Dodge: 3 variants × 2 phases × varying frame counts.
      for (const kind of ['spot', 'roll', 'air'] as const) {
        for (const phase of ['active', 'recovery'] as const) {
          expected += DODGE_ANIMATION_FRAMES[kind][phase];
        }
      }
      // Ledge: 3 phases × frame counts.
      for (const phase of ['hanging', 'climbing', 'rolling'] as const) {
        expected += LEDGE_ANIMATION_FRAMES[phase];
      }
      // Plus 1 hurt key.
      expected += 1;
      expect(keys).toHaveLength(expected);
      // Every key starts with `wolf.`.
      for (const k of keys) {
        expect(k.startsWith('wolf.')).toBe(true);
      }
      // Hurt key is included.
      expect(keys).toContain('wolf.hurt');
    });

    it('enumerateAllDefensiveAnimationKeys covers all 13 characters in canonical order', () => {
      const all = enumerateAllDefensiveAnimationKeys();
      const perChar = enumerateDefensiveAnimationKeys('wolf').length;
      expect(all).toHaveLength(perChar * ALL_CHARACTERS.length);
      // Hurt keys for all 10 characters present.
      for (const id of ALL_CHARACTERS) {
        expect(all).toContain(`${id}.hurt`);
      }
    });

    it('enumeration outputs are deterministic across calls', () => {
      const a = enumerateAllDefensiveAnimationKeys();
      const b = enumerateAllDefensiveAnimationKeys();
      expect(a).toEqual(b);
    });

    it('all enumerated defensive keys for a single character are unique', () => {
      const keys = enumerateDefensiveAnimationKeys('cat');
      const set = new Set(keys);
      expect(set.size).toBe(keys.length);
    });
  });
});
