import { describe, expect, it } from 'vitest';

import {
  type GrabInput,
  type GrabState,
  applyGrabBreak,
  applyGrabConnect,
  canPummel,
  createGrabState,
  isGrabActing,
  isHoldingGrab,
  isThrowing,
  resetGrabState,
  tickGrab,
} from './grabState';
import type { GrabSpec } from './grabSchema';

const SPEC: GrabSpec = Object.freeze({
  id: 'test.grab',
  hitbox: { offsetX: 20, offsetY: 0, width: 24, height: 30 },
  startupFrames: 5,
  activeFrames: 2,
  whiffRecoveryFrames: 20,
  holdFramesMax: 30,
  throwRecoveryFrames: 12,
  pummel: { damage: 2, cooldownFrames: 10 },
  throws: Object.freeze({
    forward: { damage: 8, knockback: { x: 2, y: -1, scaling: 0.1 }, animationFrames: 12 },
    back:    { damage: 10, knockback: { x: 2.5, y: -1, scaling: 0.12 }, animationFrames: 14 },
    up:      { damage: 7, knockback: { x: 0, y: -3, scaling: 0.1 }, animationFrames: 8 },
    down:    { damage: 6, knockback: { x: 0.5, y: 1.2, scaling: 0.08 }, animationFrames: 10 },
  }),
}) as GrabSpec;

const idleInput: GrabInput = Object.freeze({
  grabPressed: false,
  grounded: true,
  pummelPressed: false,
  throwDirection: null,
});

const grabPressInput: GrabInput = { ...idleInput, grabPressed: true };

describe('createGrabState / queries', () => {
  it('starts idle with no active record and no cooldown', () => {
    const s = createGrabState();
    expect(s.name).toBe('idle');
    expect(s.active).toBeNull();
    expect(s.cooldownRemaining).toBe(0);
    expect(isGrabActing(s)).toBe(false);
    expect(isHoldingGrab(s)).toBe(false);
    expect(isThrowing(s)).toBe(false);
    expect(canPummel(s)).toBe(false);
  });

  it('resetGrabState produces an idle equivalent', () => {
    expect(resetGrabState()).toEqual(createGrabState());
  });
});

describe('tickGrab — idle → whiffStartup on grab press while grounded', () => {
  it('transitions on grab press', () => {
    const s = tickGrab(createGrabState(), grabPressInput, SPEC);
    expect(s.name).toBe('whiffStartup');
    expect(s.active?.framesElapsed).toBe(0);
  });

  it('does NOT transition while airborne', () => {
    const s = tickGrab(createGrabState(), { ...grabPressInput, grounded: false }, SPEC);
    expect(s.name).toBe('idle');
  });

  it('stays idle without grab press', () => {
    const s = tickGrab(createGrabState(), idleInput, SPEC);
    expect(s.name).toBe('idle');
  });
});

describe('tickGrab — whiff phases progression', () => {
  it('whiffStartup advances to whiffActive after startupFrames', () => {
    let s: GrabState = tickGrab(createGrabState(), grabPressInput, SPEC);
    for (let i = 0; i < SPEC.startupFrames - 1; i += 1) {
      s = tickGrab(s, idleInput, SPEC);
      expect(s.name).toBe('whiffStartup');
    }
    s = tickGrab(s, idleInput, SPEC);
    expect(s.name).toBe('whiffActive');
    expect(s.active?.framesElapsed).toBe(0);
  });

  it('whiffActive advances to whiffRecovery after activeFrames (no connect)', () => {
    let s: GrabState = tickGrab(createGrabState(), grabPressInput, SPEC);
    for (let i = 0; i < SPEC.startupFrames; i += 1) s = tickGrab(s, idleInput, SPEC);
    expect(s.name).toBe('whiffActive');
    for (let i = 0; i < SPEC.activeFrames - 1; i += 1) {
      s = tickGrab(s, idleInput, SPEC);
      expect(s.name).toBe('whiffActive');
    }
    s = tickGrab(s, idleInput, SPEC);
    expect(s.name).toBe('whiffRecovery');
  });

  it('whiffRecovery drains and returns to idle', () => {
    // Run through an entire whiff cycle.
    let s: GrabState = tickGrab(createGrabState(), grabPressInput, SPEC);
    for (let i = 0; i < SPEC.startupFrames + SPEC.activeFrames; i += 1) {
      s = tickGrab(s, idleInput, SPEC);
    }
    expect(s.name).toBe('whiffRecovery');
    for (let i = 0; i < SPEC.whiffRecoveryFrames - 1; i += 1) {
      s = tickGrab(s, idleInput, SPEC);
    }
    s = tickGrab(s, idleInput, SPEC);
    expect(s.name).toBe('idle');
  });
});

describe('applyGrabConnect — whiffActive → holding', () => {
  it('transitions on connect from whiffActive', () => {
    let s: GrabState = tickGrab(createGrabState(), grabPressInput, SPEC);
    for (let i = 0; i < SPEC.startupFrames; i += 1) s = tickGrab(s, idleInput, SPEC);
    expect(s.name).toBe('whiffActive');
    s = applyGrabConnect(s);
    expect(s.name).toBe('holding');
    expect(s.active?.framesElapsed).toBe(0);
    expect(s.active?.pummelCooldownRemaining).toBe(0);
    expect(canPummel(s)).toBe(true);
  });

  it('is a no-op outside whiffActive', () => {
    const idle = createGrabState();
    expect(applyGrabConnect(idle)).toBe(idle);
  });
});

describe('tickGrab — holding mechanics', () => {
  const reachHolding = (): GrabState => {
    let s: GrabState = tickGrab(createGrabState(), grabPressInput, SPEC);
    for (let i = 0; i < SPEC.startupFrames; i += 1) s = tickGrab(s, idleInput, SPEC);
    return applyGrabConnect(s);
  };

  it('throw direction press transitions immediately to throwing', () => {
    const s = tickGrab(reachHolding(), { ...idleInput, throwDirection: 'forward' }, SPEC);
    expect(s.name).toBe('throwing');
    expect(s.active?.throwDirection).toBe('forward');
    expect(s.active?.framesElapsed).toBe(0);
  });

  it('pummel press arms the cooldown', () => {
    const s = tickGrab(reachHolding(), { ...idleInput, pummelPressed: true }, SPEC);
    expect(s.name).toBe('holding');
    // cooldown was 0, press fired, now armed at the spec's cooldownFrames.
    expect(s.active?.pummelCooldownRemaining).toBe(SPEC.pummel!.cooldownFrames);
  });

  it('canPummel is false while pummel cooldown is armed', () => {
    const s = tickGrab(reachHolding(), { ...idleInput, pummelPressed: true }, SPEC);
    expect(canPummel(s)).toBe(false);
  });

  it('pummel cooldown drains over time', () => {
    let s = tickGrab(reachHolding(), { ...idleInput, pummelPressed: true }, SPEC);
    const start = s.active?.pummelCooldownRemaining ?? 0;
    s = tickGrab(s, idleInput, SPEC);
    expect(s.active?.pummelCooldownRemaining).toBe(start - 1);
  });

  it('auto-releases on holdFramesMax — no throw, drops to cooldown', () => {
    let s = reachHolding();
    for (let i = 0; i < SPEC.holdFramesMax; i += 1) s = tickGrab(s, idleInput, SPEC);
    expect(s.name).toBe('cooldown');
    expect(s.cooldownRemaining).toBe(SPEC.throwRecoveryFrames);
  });
});

describe('tickGrab — throwing animation', () => {
  const reachThrowing = (dir: 'forward' | 'back' | 'up' | 'down'): GrabState => {
    let s: GrabState = tickGrab(createGrabState(), grabPressInput, SPEC);
    for (let i = 0; i < SPEC.startupFrames; i += 1) s = tickGrab(s, idleInput, SPEC);
    s = applyGrabConnect(s);
    s = tickGrab(s, { ...idleInput, throwDirection: dir }, SPEC);
    return s;
  };

  it('forward throw drains animationFrames then drops to cooldown', () => {
    let s = reachThrowing('forward');
    expect(s.name).toBe('throwing');
    const total = SPEC.throws.forward.animationFrames;
    for (let i = 0; i < total - 1; i += 1) {
      s = tickGrab(s, idleInput, SPEC);
      expect(s.name).toBe('throwing');
    }
    s = tickGrab(s, idleInput, SPEC);
    expect(s.name).toBe('cooldown');
    expect(s.cooldownRemaining).toBe(SPEC.throwRecoveryFrames);
  });

  it('each direction uses its own animation length', () => {
    const dirs = ['forward', 'back', 'up', 'down'] as const;
    for (const dir of dirs) {
      let s = reachThrowing(dir);
      const total = SPEC.throws[dir].animationFrames;
      for (let i = 0; i < total; i += 1) s = tickGrab(s, idleInput, SPEC);
      expect(s.name).toBe('cooldown');
    }
  });
});

describe('tickGrab — cooldown drains to idle', () => {
  it('drains cooldownRemaining to 0 then transitions to idle', () => {
    // Whiff a grab to land in cooldown (we use the throw-recovery path
    // by reaching holding then auto-mash-out for simplicity).
    let s: GrabState = tickGrab(createGrabState(), grabPressInput, SPEC);
    for (let i = 0; i < SPEC.startupFrames; i += 1) s = tickGrab(s, idleInput, SPEC);
    s = applyGrabConnect(s);
    for (let i = 0; i < SPEC.holdFramesMax; i += 1) s = tickGrab(s, idleInput, SPEC);
    expect(s.name).toBe('cooldown');
    for (let i = 0; i < SPEC.throwRecoveryFrames - 1; i += 1) {
      s = tickGrab(s, idleInput, SPEC);
      expect(s.name).toBe('cooldown');
    }
    s = tickGrab(s, idleInput, SPEC);
    expect(s.name).toBe('idle');
  });
});

describe('applyGrabBreak — force release', () => {
  it('transitions holding to cooldown', () => {
    let s: GrabState = tickGrab(createGrabState(), grabPressInput, SPEC);
    for (let i = 0; i < SPEC.startupFrames; i += 1) s = tickGrab(s, idleInput, SPEC);
    s = applyGrabConnect(s);
    expect(s.name).toBe('holding');
    s = applyGrabBreak(s, SPEC);
    expect(s.name).toBe('cooldown');
    expect(s.cooldownRemaining).toBe(SPEC.throwRecoveryFrames);
  });

  it('is a no-op outside holding', () => {
    const idle = createGrabState();
    expect(applyGrabBreak(idle, SPEC)).toBe(idle);
  });
});

describe('tickGrab — determinism', () => {
  it('identical input sequences produce identical state trajectories', () => {
    const run = (): GrabState => {
      let s: GrabState = createGrabState();
      s = tickGrab(s, grabPressInput, SPEC);
      for (let i = 0; i < SPEC.startupFrames; i += 1) s = tickGrab(s, idleInput, SPEC);
      s = applyGrabConnect(s);
      s = tickGrab(s, { ...idleInput, throwDirection: 'up' }, SPEC);
      for (let i = 0; i < SPEC.throws.up.animationFrames; i += 1) {
        s = tickGrab(s, idleInput, SPEC);
      }
      return s;
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.name).toBe(b.name);
    expect(a.cooldownRemaining).toBe(b.cooldownRemaining);
  });
});
