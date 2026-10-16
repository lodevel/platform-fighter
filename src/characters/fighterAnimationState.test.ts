import { describe, it, expect, vi } from 'vitest';
import {
  attackStateToFighter,
  createFighterAnimationStateMachine,
  idleState,
  resolveFighterAnimationState,
  type FighterAnimationSnapshot,
  type FighterSnapshotProvider,
} from './fighterAnimationState';
import { resolveAttackAnimation, getIdleAnimationKey } from './animationState';
import { DONKEYKONG_JAB, DONKEYKONG_FAIR, DONKEYKONG_NEUTRAL_SPECIAL } from './DonkeyKong';
import type { ShieldState } from './shieldState';
import type { DodgeState } from './dodgeState';
import type { LedgeHangState } from './ledgeHangState';
import type { ActiveAttack } from './attacks';
import { CHARACTER_IDS, type CharacterId } from '../types';

const idleShield = (): ShieldState => ({
  name: 'idle',
  health: 50,
  stunRemaining: 0,
  blockStunRemaining: 0,
  framesSinceLastDamage: 0,
});

const idleDodge = (): DodgeState => ({
  name: 'idle',
  active: null,
  iframesRemaining: 0,
  cooldownRemaining: 0,
});

const idleLedge = (): LedgeHangState =>
  ({
    name: 'idle',
    active: null,
    hangIframesRemaining: 0,
    cooldownRemaining: 0,
  }) as LedgeHangState;

const baseSnapshot = (id: CharacterId = 'donkeykong'): FighterAnimationSnapshot => ({
  characterId: id,
  facing: 1,
  destroyed: false,
  activeAttack: null,
  hitstunRemaining: 0,
  shield: idleShield(),
  dodge: idleDodge(),
  ledgeHang: idleLedge(),
});

describe('AC 10003 Sub-AC 3 — fighter animation state composer', () => {
  describe('Precedence order — single-active-state cases', () => {
    it('falls back to idle when no state is active', () => {
      const r = resolveFighterAnimationState(baseSnapshot('donkeykong'));
      expect(r.layer).toBe('idle');
      expect(r.key).toBe('donkeykong.idle');
      expect(r.phase).toBeNull();
    });

    it('emits hurt key when in hitstun', () => {
      const snap = { ...baseSnapshot('link'), hitstunRemaining: 12 };
      const r = resolveFighterAnimationState(snap);
      expect(r.layer).toBe('hurt');
      expect(r.key).toBe('link.hurt');
    });

    it('emits shield-break key when shield is broken', () => {
      const snap: FighterAnimationSnapshot = {
        ...baseSnapshot('donkeykong'),
        shield: {
          name: 'broken',
          health: 0,
          stunRemaining: 100,
          blockStunRemaining: 0,
          framesSinceLastDamage: 0,
        },
      };
      const r = resolveFighterAnimationState(snap);
      expect(r.layer).toBe('shieldBreak');
      expect(r.key.startsWith('donkeykong.shield.break.')).toBe(true);
    });

    it('emits ledge key when hanging on a ledge', () => {
      const snap: FighterAnimationSnapshot = {
        ...baseSnapshot('link'),
        ledgeHang: {
          name: 'hanging',
          active: null,
          hangIframesRemaining: 30,
          cooldownRemaining: 0,
        } as LedgeHangState,
      };
      const r = resolveFighterAnimationState(snap);
      expect(r.layer).toBe('ledge');
      expect(r.key).toBe('link.ledge.hanging.0');
    });

    it('emits dodge key when mid-dodge', () => {
      const snap: FighterAnimationSnapshot = {
        ...baseSnapshot('donkeykong'),
        dodge: {
          name: 'active',
          active: { kind: 'spot', facing: 1, framesElapsed: 0 },
          iframesRemaining: 14,
          cooldownRemaining: 0,
        },
        dodgeActiveFrames: 16,
      };
      const r = resolveFighterAnimationState(snap);
      expect(r.layer).toBe('dodge');
      expect(r.key).toBe('donkeykong.dodge.spot.active.0');
    });

    it('emits shield-hold key when shield is active', () => {
      const snap: FighterAnimationSnapshot = {
        ...baseSnapshot('link'),
        shield: {
          name: 'active',
          health: 40,
          stunRemaining: 0,
          blockStunRemaining: 0,
          framesSinceLastDamage: 0,
        },
      };
      const r = resolveFighterAnimationState(snap);
      expect(r.layer).toBe('shield');
      expect(r.key).toBe('link.shield.hold.0');
    });

    it('emits attack key when mid-attack', () => {
      const active: ActiveAttack = {
        move: DONKEYKONG_JAB,
        facing: 1,
        framesElapsed: 0,
        phase: 'startup',
        hitboxBody: null,
      };
      const snap: FighterAnimationSnapshot = {
        ...baseSnapshot('donkeykong'),
        activeAttack: active,
      };
      const r = resolveFighterAnimationState(snap);
      expect(r.layer).toBe('attack');
      expect(r.key).toBe('donkeykong.jab.startup.0');
    });
  });

  describe('Precedence ordering — competing states', () => {
    it('hurt overrides attack, shield, dodge, and ledge', () => {
      const active: ActiveAttack = {
        move: DONKEYKONG_FAIR,
        facing: 1,
        framesElapsed: 5,
        phase: 'startup',
        hitboxBody: null,
      };
      const snap: FighterAnimationSnapshot = {
        ...baseSnapshot('donkeykong'),
        activeAttack: active,
        hitstunRemaining: 8,
        shield: {
          name: 'active',
          health: 40,
          stunRemaining: 0,
          blockStunRemaining: 0,
          framesSinceLastDamage: 0,
        },
        dodge: {
          name: 'active',
          active: { kind: 'spot', facing: 1, framesElapsed: 0 },
          iframesRemaining: 14,
          cooldownRemaining: 0,
        },
        dodgeActiveFrames: 16,
        ledgeHang: {
          name: 'hanging',
          active: null,
          hangIframesRemaining: 0,
          cooldownRemaining: 0,
        } as LedgeHangState,
      };
      const r = resolveFighterAnimationState(snap);
      expect(r.layer).toBe('hurt');
      expect(r.key).toBe('donkeykong.hurt');
    });

    it('shield-break overrides ledge, dodge, shield-active, attack', () => {
      const active: ActiveAttack = {
        move: DONKEYKONG_FAIR,
        facing: 1,
        framesElapsed: 0,
        phase: 'startup',
        hitboxBody: null,
      };
      const snap: FighterAnimationSnapshot = {
        ...baseSnapshot('donkeykong'),
        activeAttack: active,
        shield: {
          name: 'broken',
          health: 0,
          stunRemaining: 100,
          blockStunRemaining: 0,
          framesSinceLastDamage: 0,
        },
      };
      const r = resolveFighterAnimationState(snap);
      expect(r.layer).toBe('shieldBreak');
    });

    it('ledge overrides dodge, shield, attack', () => {
      const active: ActiveAttack = {
        move: DONKEYKONG_NEUTRAL_SPECIAL,
        facing: 1,
        framesElapsed: 0,
        phase: 'startup',
        hitboxBody: null,
      };
      const snap: FighterAnimationSnapshot = {
        ...baseSnapshot('donkeykong'),
        activeAttack: active,
        ledgeHang: {
          name: 'hanging',
          active: null,
          hangIframesRemaining: 30,
          cooldownRemaining: 0,
        } as LedgeHangState,
      };
      const r = resolveFighterAnimationState(snap);
      expect(r.layer).toBe('ledge');
    });

    it('dodge overrides shield-active and attack', () => {
      const active: ActiveAttack = {
        move: DONKEYKONG_JAB,
        facing: 1,
        framesElapsed: 0,
        phase: 'startup',
        hitboxBody: null,
      };
      const snap: FighterAnimationSnapshot = {
        ...baseSnapshot('donkeykong'),
        activeAttack: active,
        shield: {
          name: 'active',
          health: 40,
          stunRemaining: 0,
          blockStunRemaining: 0,
          framesSinceLastDamage: 0,
        },
        dodge: {
          name: 'active',
          active: { kind: 'roll', facing: 1, framesElapsed: 0 },
          iframesRemaining: 14,
          cooldownRemaining: 0,
        },
        dodgeActiveFrames: 20,
      };
      const r = resolveFighterAnimationState(snap);
      expect(r.layer).toBe('dodge');
    });

    it('shield-active overrides attack', () => {
      const active: ActiveAttack = {
        move: DONKEYKONG_JAB,
        facing: 1,
        framesElapsed: 0,
        phase: 'startup',
        hitboxBody: null,
      };
      const snap: FighterAnimationSnapshot = {
        ...baseSnapshot('donkeykong'),
        activeAttack: active,
        shield: {
          name: 'active',
          health: 40,
          stunRemaining: 0,
          blockStunRemaining: 0,
          framesSinceLastDamage: 0,
        },
      };
      const r = resolveFighterAnimationState(snap);
      expect(r.layer).toBe('shield');
      expect(r.key).toBe('donkeykong.shield.hold.0');
    });
  });

  describe('Destroyed fighter', () => {
    it('returns idle key when destroyed regardless of other state', () => {
      const active: ActiveAttack = {
        move: DONKEYKONG_FAIR,
        facing: 1,
        framesElapsed: 5,
        phase: 'startup',
        hitboxBody: null,
      };
      const snap: FighterAnimationSnapshot = {
        ...baseSnapshot('donkeykong'),
        destroyed: true,
        hitstunRemaining: 12,
        activeAttack: active,
      };
      const r = resolveFighterAnimationState(snap);
      expect(r.layer).toBe('idle');
      expect(r.key).toBe('donkeykong.idle');
    });
  });

  describe('Determinism', () => {
    it('identical snapshots produce identical resolved states', () => {
      const snap = baseSnapshot('donkeykong');
      const a = resolveFighterAnimationState(snap);
      const b = resolveFighterAnimationState(snap);
      expect(a).toEqual(b);
    });

    it('every character resolves to a character-namespaced idle key', () => {
      for (const id of CHARACTER_IDS) {
        const r = resolveFighterAnimationState(baseSnapshot(id));
        expect(r.key).toBe(getIdleAnimationKey(id));
      }
    });
  });

  describe('Convenience adapters', () => {
    it('idleState produces a canonical idle FighterAnimationState', () => {
      const r = idleState('link', -1);
      expect(r.key).toBe('link.idle');
      expect(r.layer).toBe('idle');
      expect(r.facing).toBe(-1);
    });

    it('attackStateToFighter wraps attack-state into FighterAnimationState (idle case)', () => {
      const idle = resolveAttackAnimation('donkeykong', DONKEYKONG_JAB, 1000, 1);
      const r = attackStateToFighter(idle, 1);
      expect(r.layer).toBe('idle');
      expect(r.key).toBe('donkeykong.idle');
    });

    it('attackStateToFighter wraps attack-state into FighterAnimationState (active case)', () => {
      const live = resolveAttackAnimation('donkeykong', DONKEYKONG_JAB, 0, 1);
      const r = attackStateToFighter(live, 1);
      expect(r.layer).toBe('attack');
      expect(r.key).toBe('donkeykong.jab.startup.0');
      expect(r.phase).toBe('startup');
    });
  });

  describe('FighterAnimationStateMachine binding', () => {
    function makeProvider(initial: FighterAnimationSnapshot): {
      provider: FighterSnapshotProvider;
      snap: { value: FighterAnimationSnapshot };
    } {
      const snap = { value: initial };
      return {
        snap,
        provider: {
          getAnimationSnapshot: () => snap.value,
        },
      };
    }

    it('fires the listener once on first tick (with prev = null)', () => {
      const { provider } = makeProvider(baseSnapshot('donkeykong'));
      const listener = vi.fn();
      const sm = createFighterAnimationStateMachine(provider, listener);
      sm.tick();
      expect(listener).toHaveBeenCalledTimes(1);
      const [next, prev] = listener.mock.calls[0];
      expect(prev).toBeNull();
      expect(next.key).toBe('donkeykong.idle');
    });

    it('only fires the listener on actual key changes', () => {
      const { provider } = makeProvider(baseSnapshot('donkeykong'));
      const listener = vi.fn();
      const sm = createFighterAnimationStateMachine(provider, listener);
      sm.tick();
      sm.tick(); // same snapshot — no change.
      sm.tick(); // same snapshot — no change.
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('fires the listener on key transitions', () => {
      const { provider, snap } = makeProvider(baseSnapshot('donkeykong'));
      const listener = vi.fn();
      const sm = createFighterAnimationStateMachine(provider, listener);

      sm.tick(); // idle.
      // Transition: donkeykong raises shield.
      snap.value = {
        ...baseSnapshot('donkeykong'),
        shield: {
          name: 'active',
          health: 40,
          stunRemaining: 0,
          blockStunRemaining: 0,
          framesSinceLastDamage: 0,
        },
      };
      sm.tick();
      // Transition: donkeykong is hit.
      snap.value = {
        ...baseSnapshot('donkeykong'),
        hitstunRemaining: 8,
      };
      sm.tick();
      // Transition: hitstun resolves.
      snap.value = baseSnapshot('donkeykong');
      sm.tick();

      expect(listener).toHaveBeenCalledTimes(4);
      const keys = listener.mock.calls.map((c: unknown[]) => (c[0] as { key: string }).key);
      expect(keys).toEqual([
        'donkeykong.idle',
        'donkeykong.shield.hold.0',
        'donkeykong.hurt',
        'donkeykong.idle',
      ]);
    });

    it('current() reflects the most recently emitted state', () => {
      const { provider } = makeProvider(baseSnapshot('link'));
      const sm = createFighterAnimationStateMachine(provider);
      expect(sm.current()).toBeNull();
      sm.tick();
      const cur = sm.current();
      expect(cur).not.toBeNull();
      expect(cur!.key).toBe('link.idle');
    });

    it('detach() stops the listener from firing', () => {
      const { provider, snap } = makeProvider(baseSnapshot('donkeykong'));
      const listener = vi.fn();
      const sm = createFighterAnimationStateMachine(provider, listener);
      sm.tick();
      sm.detach();
      snap.value = { ...baseSnapshot('donkeykong'), hitstunRemaining: 8 };
      sm.tick();
      // Only first tick fired before detach.
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('Active attack — uses locked-in facing', () => {
    it('fighter facing right but attack locked left — animation uses attack facing', () => {
      const active: ActiveAttack = {
        move: DONKEYKONG_JAB,
        facing: -1,
        framesElapsed: 0,
        phase: 'startup',
        hitboxBody: null,
      };
      const snap: FighterAnimationSnapshot = {
        ...baseSnapshot('donkeykong'),
        facing: 1,
        activeAttack: active,
      };
      const r = resolveFighterAnimationState(snap);
      // Attack facing was -1; the animation should mirror it.
      expect(r.facing).toBe(-1);
    });
  });
});
