import { describe, it, expect } from 'vitest';
import {
  makeBodyHurtbox,
  hitboxOverlapsHurtbox,
  computeAttackPhase,
  selectAnimationFrame,
  advanceAttackState,
  composeAttackStateHooks,
  getMoveBusyFrames,
  getMoveLockoutFrames,
  knockbackToAngleMagnitude,
  angleMagnitudeToKnockback,
  getFrameData,
  getFrameDataBusy,
  getFrameDataLockout,
  isHurtboxModifierActive,
  selectActiveHurtboxes,
  isAllHurtboxesIntangible,
  resolveHurtboxDamageMultiplier,
  type AttackStateHooks,
  type AttackStateContext,
  type AttackPhase,
  type Hitbox,
  type Hurtbox,
  type AttackMoveWithAnimation,
  type FrameData,
  type KnockbackAngleMagnitude,
  type KnockbackSpec,
  type MoveHurtboxModifier,
} from './moveSchema';
import type { AttackMove } from './attacks';

/**
 * Sub-AC 1 of AC 60001: shared move data schema + base attack system
 * (hitbox/hurtbox structures, damage, knockback vectors, animation
 * state machine hooks) in a reusable module.
 *
 * `moveSchema.ts` is pure — no Phaser, no Matter, no `Math.random()`,
 * no wall-clock reads. This suite locks down:
 *
 *   1. Hitbox / hurtbox geometry helpers — body-hurtbox factory and
 *      AABB overlap, with the attacker-facing mirror that AC 202's
 *      hitbox spawner relies on.
 *   2. Phase classifier (`computeAttackPhase`) — exclusive boundaries
 *      so each phase has exactly its declared frame count, plus the
 *      'done' tail.
 *   3. Move-duration helpers — busy and lockout windows.
 *   4. Animation frame selector — stretch art frames over gameplay
 *      windows with single-frame-per-phase fallback.
 *   5. State machine advance + hooks — boundary detection, hook-fire
 *      ordering, composition.
 *   6. Determinism — identical inputs → identical outputs.
 */

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SAMPLE_MOVE: AttackMove = {
  id: 'sample.jab',
  type: 'jab',
  damage: 6,
  knockback: { x: 1.4, y: -0.4, scaling: 0.06 },
  hitbox: { offsetX: 50, offsetY: -8, width: 70, height: 52 },
  startupFrames: 4,
  activeFrames: 3,
  recoveryFrames: 9,
  cooldownFrames: 14,
};

const SAMPLE_MOVE_ANIMATED: AttackMoveWithAnimation = {
  ...SAMPLE_MOVE,
  id: 'sample.jab.animated',
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
};

// ---------------------------------------------------------------------------
// makeBodyHurtbox
// ---------------------------------------------------------------------------

describe('makeBodyHurtbox', () => {
  it('builds a body-id hurtbox derived from tuning width/height', () => {
    const h = makeBodyHurtbox({ width: 90, height: 130 });
    expect(h.id).toBe('body');
    expect(h.offsetX).toBe(0);
    expect(h.offsetY).toBe(0);
    expect(h.width).toBe(90);
    expect(h.height).toBe(130);
  });

  it('does not set intangible by default', () => {
    const h = makeBodyHurtbox({ width: 100, height: 100 });
    expect(h.intangible).toBeUndefined();
  });

  it('returns a frozen object — accidental writes throw in strict mode', () => {
    const h = makeBodyHurtbox({ width: 80, height: 100 });
    expect(Object.isFrozen(h)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hitboxOverlapsHurtbox
// ---------------------------------------------------------------------------

describe('hitboxOverlapsHurtbox', () => {
  const attacker = { x: 0, y: 0 };
  const defender = { x: 60, y: 0 };
  const hitbox: Hitbox = { offsetX: 50, offsetY: 0, width: 40, height: 40 };
  const bodyHurtbox: Hurtbox = {
    id: 'body',
    offsetX: 0,
    offsetY: 0,
    width: 40,
    height: 40,
  };

  it('detects overlap when attacker faces toward the defender', () => {
    // attacker at x=0 facing right → hitbox centred at x=50, w=40 (extends [30, 70])
    // defender at x=60, hurtbox w=40 (extends [40, 80]) → overlap
    expect(
      hitboxOverlapsHurtbox(attacker, hitbox, 1, defender, bodyHurtbox),
    ).toBe(true);
  });

  it('mirrors offsetX by attacker facing — facing left puts hitbox on the wrong side', () => {
    // attacker at x=0 facing LEFT → hitbox centred at x=-50 → no overlap with defender at x=60
    expect(
      hitboxOverlapsHurtbox(attacker, hitbox, -1, defender, bodyHurtbox),
    ).toBe(false);
  });

  it('returns true on touching edges (matches Matter inclusive overlap)', () => {
    // hitbox right edge at x=70, hurtbox at x=90 with halfW 20 → left edge at x=70: touching
    const farDefender = { x: 90, y: 0 };
    expect(
      hitboxOverlapsHurtbox(attacker, hitbox, 1, farDefender, bodyHurtbox),
    ).toBe(true);
  });

  it('returns false when boxes are vertically separated', () => {
    const aboveDefender = { x: 60, y: -100 };
    expect(
      hitboxOverlapsHurtbox(attacker, hitbox, 1, aboveDefender, bodyHurtbox),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Move duration helpers
// ---------------------------------------------------------------------------

describe('getMoveBusyFrames / getMoveLockoutFrames', () => {
  it('busy = startup + active + recovery', () => {
    expect(getMoveBusyFrames(SAMPLE_MOVE)).toBe(4 + 3 + 9);
  });

  it('lockout = busy + cooldown (press-to-press lockout)', () => {
    expect(getMoveLockoutFrames(SAMPLE_MOVE)).toBe(4 + 3 + 9 + 14);
  });

  it('zero-cooldown move: lockout equals busy', () => {
    const zeroCooldown: AttackMove = { ...SAMPLE_MOVE, cooldownFrames: 0 };
    expect(getMoveLockoutFrames(zeroCooldown)).toBe(getMoveBusyFrames(zeroCooldown));
  });
});

// ---------------------------------------------------------------------------
// computeAttackPhase
// ---------------------------------------------------------------------------

describe('computeAttackPhase', () => {
  it('classifies frame 0 (press frame) as startup', () => {
    expect(computeAttackPhase(0, SAMPLE_MOVE)).toBe('startup');
  });

  it('startup phase covers [0, startupFrames) exclusive', () => {
    // SAMPLE_MOVE.startupFrames = 4
    expect(computeAttackPhase(3, SAMPLE_MOVE)).toBe('startup');
    expect(computeAttackPhase(4, SAMPLE_MOVE)).toBe('active');
  });

  it('active phase covers [startup, startup+active) exclusive', () => {
    // active = [4, 7)
    expect(computeAttackPhase(4, SAMPLE_MOVE)).toBe('active');
    expect(computeAttackPhase(6, SAMPLE_MOVE)).toBe('active');
    expect(computeAttackPhase(7, SAMPLE_MOVE)).toBe('recovery');
  });

  it('recovery phase covers [start+active, busyTotal) exclusive', () => {
    // busyTotal = 16 → recovery = [7, 16)
    expect(computeAttackPhase(7, SAMPLE_MOVE)).toBe('recovery');
    expect(computeAttackPhase(15, SAMPLE_MOVE)).toBe('recovery');
    expect(computeAttackPhase(16, SAMPLE_MOVE)).toBe('done');
  });

  it('done after busyTotal frames', () => {
    expect(computeAttackPhase(100, SAMPLE_MOVE)).toBe('done');
  });

  it('treats negative frames defensively as startup', () => {
    expect(computeAttackPhase(-1, SAMPLE_MOVE)).toBe('startup');
  });

  it('zero-startup move enters active immediately on press frame', () => {
    const noStart: AttackMove = { ...SAMPLE_MOVE, startupFrames: 0 };
    expect(computeAttackPhase(0, noStart)).toBe('active');
  });

  it('zero-active move skips active entirely', () => {
    const noActive: AttackMove = { ...SAMPLE_MOVE, activeFrames: 0 };
    // startup [0,4); active [4,4) empty; recovery [4,13)
    expect(computeAttackPhase(3, noActive)).toBe('startup');
    expect(computeAttackPhase(4, noActive)).toBe('recovery');
  });
});

// ---------------------------------------------------------------------------
// selectAnimationFrame
// ---------------------------------------------------------------------------

describe('selectAnimationFrame', () => {
  it('falls back to single-frame-per-phase (idx 0) when no animation block', () => {
    expect(selectAnimationFrame(0, SAMPLE_MOVE)).toEqual({
      phase: 'startup',
      artFrameIndex: 0,
    });
    expect(selectAnimationFrame(5, SAMPLE_MOVE)).toEqual({
      phase: 'active',
      artFrameIndex: 0,
    });
  });

  it('stretches startup art frames over gameplay startup window', () => {
    // SAMPLE_MOVE_ANIMATED: startupFrames gameplay=4, art=2
    // gameplay frame 0..1 → art 0; 2..3 → art 1
    expect(selectAnimationFrame(0, SAMPLE_MOVE_ANIMATED).artFrameIndex).toBe(0);
    expect(selectAnimationFrame(1, SAMPLE_MOVE_ANIMATED).artFrameIndex).toBe(0);
    expect(selectAnimationFrame(2, SAMPLE_MOVE_ANIMATED).artFrameIndex).toBe(1);
    expect(selectAnimationFrame(3, SAMPLE_MOVE_ANIMATED).artFrameIndex).toBe(1);
  });

  it('returns idx 0 in active when art has only one active frame', () => {
    // active = 3 gameplay frames, 1 art frame → always 0
    expect(selectAnimationFrame(4, SAMPLE_MOVE_ANIMATED).artFrameIndex).toBe(0);
    expect(selectAnimationFrame(5, SAMPLE_MOVE_ANIMATED).artFrameIndex).toBe(0);
    expect(selectAnimationFrame(6, SAMPLE_MOVE_ANIMATED).artFrameIndex).toBe(0);
  });

  it('clamps within recovery so the boundary frame never overflows', () => {
    // recovery: 9 gameplay frames, 3 art frames → each art covers 3 gameplay
    // recovery starts at gameplay frame 7
    expect(selectAnimationFrame(7, SAMPLE_MOVE_ANIMATED).artFrameIndex).toBe(0);
    expect(selectAnimationFrame(10, SAMPLE_MOVE_ANIMATED).artFrameIndex).toBe(1);
    expect(selectAnimationFrame(13, SAMPLE_MOVE_ANIMATED).artFrameIndex).toBe(2);
    expect(selectAnimationFrame(15, SAMPLE_MOVE_ANIMATED).artFrameIndex).toBe(2);
  });

  it('reports done phase with idx 0 after the move ends', () => {
    expect(selectAnimationFrame(100, SAMPLE_MOVE_ANIMATED)).toEqual({
      phase: 'done',
      artFrameIndex: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// advanceAttackState — boundary detection
// ---------------------------------------------------------------------------

describe('advanceAttackState', () => {
  it('advances framesElapsed by exactly 1', () => {
    const step = advanceAttackState('p1', 1, SAMPLE_MOVE, 0);
    expect(step.framesElapsed).toBe(1);
  });

  it('reports prevPhase / nextPhase on the startup → active transition', () => {
    // press frame 3 → 4 crosses startup→active
    const step = advanceAttackState('p1', 1, SAMPLE_MOVE, 3);
    expect(step.prevPhase).toBe('startup');
    expect(step.nextPhase).toBe('active');
    expect(step.didEnterActive).toBe(true);
    expect(step.didExitActive).toBe(false);
    expect(step.didEnd).toBe(false);
  });

  it('reports active → recovery exit', () => {
    // active = [4, 7), so frame 6 → 7 crosses active→recovery
    const step = advanceAttackState('p1', 1, SAMPLE_MOVE, 6);
    expect(step.prevPhase).toBe('active');
    expect(step.nextPhase).toBe('recovery');
    expect(step.didEnterActive).toBe(false);
    expect(step.didExitActive).toBe(true);
    expect(step.didEnd).toBe(false);
  });

  it('reports recovery → done end-of-move', () => {
    // busyTotal = 16 → frame 15 → 16 crosses recovery → done
    const step = advanceAttackState('p1', 1, SAMPLE_MOVE, 15);
    expect(step.prevPhase).toBe('recovery');
    expect(step.nextPhase).toBe('done');
    expect(step.didEnd).toBe(true);
  });

  it('is a no-op once the move has ended', () => {
    const step = advanceAttackState('p1', 1, SAMPLE_MOVE, 100);
    expect(step.prevPhase).toBe('done');
    expect(step.nextPhase).toBe('done');
    expect(step.framesElapsed).toBe(100);
    expect(step.didEnterActive).toBe(false);
    expect(step.didExitActive).toBe(false);
    expect(step.didEnd).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// advanceAttackState — hook firing
// ---------------------------------------------------------------------------

interface HookEvent {
  readonly kind:
    | 'enter'
    | 'exit'
    | 'spawn'
    | 'despawn'
    | 'end';
  readonly phase?: AttackPhase;
  readonly framesElapsed?: number;
}

function makeRecorder(): {
  hooks: AttackStateHooks;
  events: HookEvent[];
} {
  const events: HookEvent[] = [];
  const hooks: AttackStateHooks = {
    onPhaseEnter(phase, ctx) {
      events.push({ kind: 'enter', phase, framesElapsed: ctx.framesElapsed });
    },
    onPhaseExit(phase, ctx) {
      events.push({ kind: 'exit', phase, framesElapsed: ctx.framesElapsed });
    },
    onHitboxSpawn(_, ctx) {
      events.push({ kind: 'spawn', framesElapsed: ctx.framesElapsed });
    },
    onHitboxDespawn(_, ctx) {
      events.push({ kind: 'despawn', framesElapsed: ctx.framesElapsed });
    },
    onMoveEnd(_, ctx) {
      events.push({ kind: 'end', framesElapsed: ctx.framesElapsed });
    },
  };
  return { hooks, events };
}

describe('advanceAttackState hooks', () => {
  it('fires no hooks for an in-phase advance (no boundary crossed)', () => {
    const r = makeRecorder();
    advanceAttackState('p1', 1, SAMPLE_MOVE, 0, r.hooks);
    advanceAttackState('p1', 1, SAMPLE_MOVE, 1, r.hooks);
    expect(r.events).toEqual([]);
  });

  it('fires onHitboxSpawn + onPhaseEnter on startup → active', () => {
    const r = makeRecorder();
    advanceAttackState('p1', 1, SAMPLE_MOVE, 3, r.hooks);
    // Order: exit(startup), spawn, enter(active)
    expect(r.events.map((e) => e.kind)).toEqual(['exit', 'spawn', 'enter']);
    expect(r.events[0]!.phase).toBe('startup');
    expect(r.events[2]!.phase).toBe('active');
  });

  it('fires onHitboxDespawn + onPhaseEnter on active → recovery', () => {
    const r = makeRecorder();
    advanceAttackState('p1', 1, SAMPLE_MOVE, 6, r.hooks);
    expect(r.events.map((e) => e.kind)).toEqual(['exit', 'despawn', 'enter']);
    expect(r.events[0]!.phase).toBe('active');
    expect(r.events[2]!.phase).toBe('recovery');
  });

  it('fires onPhaseExit + onMoveEnd on recovery → done', () => {
    const r = makeRecorder();
    advanceAttackState('p1', 1, SAMPLE_MOVE, 15, r.hooks);
    // No onPhaseEnter (newPhase === 'done' is not a live phase)
    expect(r.events.map((e) => e.kind)).toEqual(['exit', 'end']);
    expect(r.events[0]!.phase).toBe('recovery');
  });

  it('drives the full lifecycle by repeatedly advancing from frame 0', () => {
    const r = makeRecorder();
    let f = 0;
    for (let i = 0; i < 20; i++) {
      const step = advanceAttackState('p1', 1, SAMPLE_MOVE, f, r.hooks);
      f = step.framesElapsed;
      if (step.nextPhase === 'done') break;
    }
    // We expect: startup→active (spawn), active→recovery (despawn),
    // recovery→done (end).
    const kinds = r.events.map((e) => e.kind);
    expect(kinds).toContain('spawn');
    expect(kinds).toContain('despawn');
    expect(kinds).toContain('end');
    // Spawn must precede despawn.
    expect(kinds.indexOf('spawn')).toBeLessThan(kinds.indexOf('despawn'));
    // Despawn must precede end.
    expect(kinds.indexOf('despawn')).toBeLessThan(kinds.indexOf('end'));
  });

  it('passes attacker id and facing through to the hook context', () => {
    const captures: AttackStateContext[] = [];
    advanceAttackState('wolf-p2', -1, SAMPLE_MOVE, 3, {
      onHitboxSpawn(_, ctx) {
        captures.push(ctx);
      },
    });
    expect(captures.length).toBe(1);
    const ctx = captures[0]!;
    expect(ctx.attackerId).toBe('wolf-p2');
    expect(ctx.facing).toBe(-1);
    expect(ctx.move.id).toBe(SAMPLE_MOVE.id);
  });
});

// ---------------------------------------------------------------------------
// composeAttackStateHooks
// ---------------------------------------------------------------------------

describe('composeAttackStateHooks', () => {
  it('returns an empty bag when no hooks are passed', () => {
    const composed = composeAttackStateHooks();
    expect(composed.onPhaseEnter).toBeUndefined();
  });

  it('passes through a single bag unchanged (referential)', () => {
    const bag: AttackStateHooks = {
      onPhaseEnter() {
        /* noop */
      },
    };
    expect(composeAttackStateHooks(bag)).toBe(bag);
  });

  it('fans out hooks to every subscriber in array order', () => {
    const order: string[] = [];
    const bagA: AttackStateHooks = {
      onHitboxSpawn() {
        order.push('a');
      },
    };
    const bagB: AttackStateHooks = {
      onHitboxSpawn() {
        order.push('b');
      },
    };
    const composed = composeAttackStateHooks(bagA, bagB);
    advanceAttackState('p1', 1, SAMPLE_MOVE, 3, composed);
    expect(order).toEqual(['a', 'b']);
  });

  it('skips undefined entries gracefully', () => {
    const fired: string[] = [];
    const bag: AttackStateHooks = {
      onMoveEnd() {
        fired.push('only');
      },
    };
    const composed = composeAttackStateHooks(undefined, bag, undefined);
    advanceAttackState('p1', 1, SAMPLE_MOVE, 15, composed);
    expect(fired).toEqual(['only']);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FrameData
// ---------------------------------------------------------------------------

describe('FrameData / getFrameData', () => {
  it('lifts the four frame fields from an AttackMove into a FrameData record', () => {
    const fd = getFrameData(SAMPLE_MOVE);
    expect(fd).toEqual({
      startup: 4,
      active: 3,
      recovery: 9,
      cooldown: 14,
    });
  });

  it('getFrameDataBusy = startup + active + recovery (no cooldown)', () => {
    const fd: FrameData = { startup: 4, active: 3, recovery: 9, cooldown: 14 };
    expect(getFrameDataBusy(fd)).toBe(16);
  });

  it('getFrameDataLockout = busy + cooldown', () => {
    const fd: FrameData = { startup: 4, active: 3, recovery: 9, cooldown: 14 };
    expect(getFrameDataLockout(fd)).toBe(30);
  });

  it('matches getMoveBusyFrames / getMoveLockoutFrames for the same move', () => {
    const fd = getFrameData(SAMPLE_MOVE);
    expect(getFrameDataBusy(fd)).toBe(getMoveBusyFrames(SAMPLE_MOVE));
    expect(getFrameDataLockout(fd)).toBe(getMoveLockoutFrames(SAMPLE_MOVE));
  });

  it('is a pure projection — repeated calls produce equal records', () => {
    const a = getFrameData(SAMPLE_MOVE);
    const b = getFrameData(SAMPLE_MOVE);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Knockback angle/magnitude conversion
// ---------------------------------------------------------------------------

describe('knockbackToAngleMagnitude / angleMagnitudeToKnockback', () => {
  // Tolerance for trig roundtrip — IEEE-754 sin/cos/atan2 introduce
  // ~1e-15 absolute error after a single forward+inverse pass.
  const TOL = 1e-9;

  it('horizontal-forward knockback (x>0, y=0) → angle 0°', () => {
    const polar = knockbackToAngleMagnitude({ x: 2, y: 0, scaling: 0.05 });
    expect(polar.angleDegrees).toBeCloseTo(0, 9);
    expect(polar.magnitude).toBeCloseTo(2, 9);
    expect(polar.scaling).toBe(0.05);
  });

  it('straight-up knockback (x=0, y=-1 in Phaser space) → angle +90°', () => {
    // y is negated by the helper so screen-space "up" becomes positive launch angle.
    const polar = knockbackToAngleMagnitude({ x: 0, y: -1, scaling: 0.1 });
    expect(polar.angleDegrees).toBeCloseTo(90, 9);
    expect(polar.magnitude).toBeCloseTo(1, 9);
  });

  it('45° up-and-forward knockback → angle 45° with √2 magnitude', () => {
    const polar = knockbackToAngleMagnitude({ x: 1, y: -1, scaling: 0 });
    expect(polar.angleDegrees).toBeCloseTo(45, 9);
    expect(polar.magnitude).toBeCloseTo(Math.SQRT2, 9);
  });

  it('reverse: angleMagnitudeToKnockback at 0° produces horizontal Cartesian', () => {
    const cart = angleMagnitudeToKnockback({
      angleDegrees: 0,
      magnitude: 3,
      scaling: 0.2,
    });
    expect(cart.x).toBeCloseTo(3, 9);
    expect(cart.y).toBeCloseTo(0, 9);
    expect(cart.scaling).toBe(0.2);
  });

  it('reverse: 90° polar produces y=-magnitude in Phaser screen-space', () => {
    const cart = angleMagnitudeToKnockback({
      angleDegrees: 90,
      magnitude: 4,
      scaling: 0.3,
    });
    expect(cart.x).toBeCloseTo(0, 9);
    expect(cart.y).toBeCloseTo(-4, 9);
  });

  it('roundtrips Cartesian → polar → Cartesian within IEEE-754 tolerance', () => {
    const original: KnockbackSpec = { x: 1.4, y: -0.4, scaling: 0.06 };
    const polar = knockbackToAngleMagnitude(original);
    const back = angleMagnitudeToKnockback(polar);
    expect(back.x).toBeCloseTo(original.x, 9);
    expect(back.y).toBeCloseTo(original.y, 9);
    expect(back.scaling).toBe(original.scaling);
  });

  it('roundtrips polar → Cartesian → polar within IEEE-754 tolerance', () => {
    const original: KnockbackAngleMagnitude = {
      angleDegrees: 53,
      magnitude: 2.7,
      scaling: 0.12,
    };
    const cart = angleMagnitudeToKnockback(original);
    const back = knockbackToAngleMagnitude(cart);
    expect(back.angleDegrees).toBeCloseTo(original.angleDegrees, 9);
    expect(back.magnitude).toBeCloseTo(original.magnitude, 9);
    expect(back.scaling).toBe(original.scaling);
  });

  it('preserves scaling field unchanged through both directions', () => {
    const cart: KnockbackSpec = { x: 1, y: 0, scaling: 0.42 };
    expect(knockbackToAngleMagnitude(cart).scaling).toBe(0.42);
    expect(angleMagnitudeToKnockback({ angleDegrees: 0, magnitude: 1, scaling: 0.42 }).scaling).toBe(0.42);
  });

  it('handles backward-launch knockback (x<0) with angle ±180°', () => {
    const polar = knockbackToAngleMagnitude({ x: -1, y: 0, scaling: 0 });
    expect(Math.abs(polar.angleDegrees)).toBeCloseTo(180, 9);
    expect(polar.magnitude).toBeCloseTo(1, 9);
    void TOL;
  });

  it('is deterministic — repeated calls produce identical records', () => {
    const cart: KnockbackSpec = { x: 1.337, y: -2.5, scaling: 0.08 };
    const a = knockbackToAngleMagnitude(cart);
    const b = knockbackToAngleMagnitude(cart);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------

describe('moveSchema determinism', () => {
  it('computeAttackPhase is a pure function of (frames, move)', () => {
    for (let f = 0; f < 20; f++) {
      const a = computeAttackPhase(f, SAMPLE_MOVE);
      const b = computeAttackPhase(f, SAMPLE_MOVE);
      expect(a).toBe(b);
    }
  });

  it('advanceAttackState produces identical step records on repeat calls', () => {
    const a = advanceAttackState('p1', 1, SAMPLE_MOVE, 5);
    const b = advanceAttackState('p1', 1, SAMPLE_MOVE, 5);
    expect(a).toEqual(b);
  });

  it('selectAnimationFrame is deterministic across repeated calls', () => {
    for (let f = 0; f < 18; f++) {
      const a = selectAnimationFrame(f, SAMPLE_MOVE_ANIMATED);
      const b = selectAnimationFrame(f, SAMPLE_MOVE_ANIMATED);
      expect(a).toEqual(b);
    }
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 2 of AC 10002 — runtime hurtbox resolution
//
// Locks down the per-move hurtbox modifier resolution rules so the
// damage handler, the AI predictor, and the (later AC) move-editor UI
// all agree on which hurtboxes are live for a given (move, frame)
// pair.
// ---------------------------------------------------------------------------

describe('isHurtboxModifierActive', () => {
  const intangibleHurtbox: Hurtbox = {
    id: 'm.intangible',
    offsetX: 0,
    offsetY: 0,
    width: 80,
    height: 100,
    intangible: true,
  };

  it('treats undefined phase as "active for every live phase"', () => {
    const m: MoveHurtboxModifier = { hurtbox: intangibleHurtbox };
    expect(isHurtboxModifierActive(m, 'startup')).toBe(true);
    expect(isHurtboxModifierActive(m, 'active')).toBe(true);
    expect(isHurtboxModifierActive(m, 'recovery')).toBe(true);
  });

  it('matches single-phase declaration only on that phase', () => {
    const m: MoveHurtboxModifier = {
      phase: 'active',
      hurtbox: intangibleHurtbox,
    };
    expect(isHurtboxModifierActive(m, 'startup')).toBe(false);
    expect(isHurtboxModifierActive(m, 'active')).toBe(true);
    expect(isHurtboxModifierActive(m, 'recovery')).toBe(false);
  });

  it('matches array-of-phases on any listed phase', () => {
    const m: MoveHurtboxModifier = {
      phase: ['startup', 'recovery'],
      hurtbox: intangibleHurtbox,
    };
    expect(isHurtboxModifierActive(m, 'startup')).toBe(true);
    expect(isHurtboxModifierActive(m, 'active')).toBe(false);
    expect(isHurtboxModifierActive(m, 'recovery')).toBe(true);
  });
});

describe('selectActiveHurtboxes', () => {
  const body: Hurtbox = makeBodyHurtbox({ width: 90, height: 130 });

  const intangibleHurtbox: Hurtbox = {
    id: 'm.intangible',
    offsetX: 0,
    offsetY: 0,
    width: 80,
    height: 100,
    intangible: true,
  };

  const armorHurtbox: Hurtbox = {
    id: 'm.armor',
    offsetX: 0,
    offsetY: -20,
    width: 60,
    height: 40,
    damageMultiplier: 0.5,
  };

  const weakpointHurtbox: Hurtbox = {
    id: 'm.weakpoint',
    offsetX: 0,
    offsetY: 0,
    width: 30,
    height: 30,
    damageMultiplier: 1.5,
  };

  it('returns [body] when no move is active', () => {
    expect(selectActiveHurtboxes(body, null, 0)).toEqual([body]);
    expect(selectActiveHurtboxes(body, undefined, 0)).toEqual([body]);
  });

  it('returns [body] for a move with no modifiers', () => {
    expect(selectActiveHurtboxes(body, SAMPLE_MOVE_ANIMATED, 5)).toEqual([
      body,
    ]);
  });

  it('returns [body] when the move has ended (done phase)', () => {
    const move: AttackMoveWithAnimation = {
      ...SAMPLE_MOVE_ANIMATED,
      hurtboxModifiers: [{ phase: 'active', hurtbox: intangibleHurtbox }],
    };
    // SAMPLE_MOVE_ANIMATED busy = 4 + 3 + 9 = 16, so frame 16 is done
    expect(selectActiveHurtboxes(body, move, 16)).toEqual([body]);
  });

  it('returns [body] when no modifier matches the live phase', () => {
    const move: AttackMoveWithAnimation = {
      ...SAMPLE_MOVE_ANIMATED,
      hurtboxModifiers: [{ phase: 'recovery', hurtbox: intangibleHurtbox }],
    };
    // active phase = frames 4..6
    expect(selectActiveHurtboxes(body, move, 5)).toEqual([body]);
  });

  it('layers a matching modifier on top of the body default', () => {
    const move: AttackMoveWithAnimation = {
      ...SAMPLE_MOVE_ANIMATED,
      hurtboxModifiers: [{ phase: 'startup', hurtbox: armorHurtbox }],
    };
    const set = selectActiveHurtboxes(body, move, 0);
    expect(set.length).toBe(2);
    expect(set[0]).toEqual(body);
    expect(set[1]).toEqual(armorHurtbox);
  });

  it('replaceBody:true drops the body default while the modifier is active', () => {
    const move: AttackMoveWithAnimation = {
      ...SAMPLE_MOVE_ANIMATED,
      hurtboxModifiers: [
        { phase: 'active', hurtbox: intangibleHurtbox, replaceBody: true },
      ],
    };
    // active phase = frames 4..6
    const set = selectActiveHurtboxes(body, move, 5);
    expect(set).toEqual([intangibleHurtbox]);
  });

  it('replaceBody:true on a non-matching phase does not drop the body', () => {
    const move: AttackMoveWithAnimation = {
      ...SAMPLE_MOVE_ANIMATED,
      hurtboxModifiers: [
        { phase: 'recovery', hurtbox: intangibleHurtbox, replaceBody: true },
      ],
    };
    // startup phase — modifier inactive
    expect(selectActiveHurtboxes(body, move, 0)).toEqual([body]);
  });

  it('preserves authoring order across multiple matching modifiers', () => {
    const move: AttackMoveWithAnimation = {
      ...SAMPLE_MOVE_ANIMATED,
      hurtboxModifiers: [
        { phase: 'active', hurtbox: armorHurtbox },
        { phase: 'active', hurtbox: weakpointHurtbox },
      ],
    };
    const set = selectActiveHurtboxes(body, move, 5);
    expect(set.length).toBe(3);
    expect(set[0]).toEqual(body);
    expect(set[1]).toEqual(armorHurtbox);
    expect(set[2]).toEqual(weakpointHurtbox);
  });

  it('is deterministic — same inputs return equivalent sets across calls', () => {
    const move: AttackMoveWithAnimation = {
      ...SAMPLE_MOVE_ANIMATED,
      hurtboxModifiers: [
        { phase: 'active', hurtbox: intangibleHurtbox },
        { phase: ['startup', 'recovery'], hurtbox: armorHurtbox },
      ],
    };
    for (let f = 0; f < 18; f++) {
      expect(selectActiveHurtboxes(body, move, f)).toEqual(
        selectActiveHurtboxes(body, move, f),
      );
    }
  });
});

describe('isAllHurtboxesIntangible', () => {
  const tangible: Hurtbox = {
    id: 'a',
    offsetX: 0,
    offsetY: 0,
    width: 10,
    height: 10,
  };
  const intangible: Hurtbox = {
    id: 'b',
    offsetX: 0,
    offsetY: 0,
    width: 10,
    height: 10,
    intangible: true,
  };

  it('returns false on the empty set (defensive)', () => {
    expect(isAllHurtboxesIntangible([])).toBe(false);
  });

  it('returns true when every hurtbox is intangible', () => {
    expect(isAllHurtboxesIntangible([intangible, intangible])).toBe(true);
  });

  it('returns false when at least one hurtbox is tangible', () => {
    expect(isAllHurtboxesIntangible([tangible, intangible])).toBe(false);
    expect(isAllHurtboxesIntangible([intangible, tangible])).toBe(false);
  });

  it('treats explicit intangible:false as tangible', () => {
    const explicitTangible: Hurtbox = {
      ...intangible,
      intangible: false,
    };
    expect(isAllHurtboxesIntangible([explicitTangible])).toBe(false);
  });
});

describe('resolveHurtboxDamageMultiplier', () => {
  const baseline: Hurtbox = {
    id: 'a',
    offsetX: 0,
    offsetY: 0,
    width: 10,
    height: 10,
  };

  it('returns 1.0 on the empty set', () => {
    expect(resolveHurtboxDamageMultiplier([])).toBe(1);
  });

  it('returns 1.0 when no hurtbox declares a multiplier', () => {
    expect(resolveHurtboxDamageMultiplier([baseline])).toBe(1);
  });

  it('returns the max multiplier across the tangible set', () => {
    const armor: Hurtbox = { ...baseline, id: 'armor', damageMultiplier: 0.5 };
    const weakpoint: Hurtbox = {
      ...baseline,
      id: 'weak',
      damageMultiplier: 1.75,
    };
    expect(resolveHurtboxDamageMultiplier([armor, weakpoint])).toBe(1.75);
  });

  it('clamps to 1.0 when every multiplier is below 1 (max wins)', () => {
    const a: Hurtbox = { ...baseline, id: 'a', damageMultiplier: 0.5 };
    const b: Hurtbox = { ...baseline, id: 'b', damageMultiplier: 0.75 };
    // The body default at 1.0 is the implicit baseline — but if the
    // caller passes only modifier hurtboxes (replaceBody=true case),
    // we should still floor at 1.0 because the move table never asks
    // for "less than baseline" without an explicit body suppression.
    // The rule is: max(1.0, any-declared-multiplier-above-1).
    expect(resolveHurtboxDamageMultiplier([a, b])).toBe(1);
  });

  it('skips intangible hurtboxes when picking the max multiplier', () => {
    const intangibleStrong: Hurtbox = {
      ...baseline,
      id: 'i',
      intangible: true,
      damageMultiplier: 5, // ignored — intangible ⇒ excluded from multiplier set
    };
    const tangible: Hurtbox = {
      ...baseline,
      id: 't',
      damageMultiplier: 1.5,
    };
    expect(resolveHurtboxDamageMultiplier([intangibleStrong, tangible])).toBe(
      1.5,
    );
  });

  it('returns 1.0 when every hurtbox is intangible (defensive)', () => {
    const intangibleA: Hurtbox = { ...baseline, id: 'a', intangible: true };
    const intangibleB: Hurtbox = { ...baseline, id: 'b', intangible: true };
    expect(resolveHurtboxDamageMultiplier([intangibleA, intangibleB])).toBe(1);
  });

  it('ignores NaN / non-finite damageMultiplier values', () => {
    const broken: Hurtbox = {
      ...baseline,
      id: 'broken',
      damageMultiplier: Number.NaN,
    };
    const broken2: Hurtbox = {
      ...baseline,
      id: 'broken2',
      damageMultiplier: Number.POSITIVE_INFINITY,
    };
    expect(resolveHurtboxDamageMultiplier([broken, broken2])).toBe(1);
  });
});
