import { describe, it, expect } from 'vitest';

import {
  createLocomotionState,
  resetLocomotionState,
  resolveLocomotionTuning,
  tickLocomotion,
  getLocomotionTargetVx,
  isDashing,
  isCrouching,
  isPivoting,
  getLocomotionFacing,
  LOCOMOTION_DEFAULTS,
  type LocomotionInput,
  type LocomotionState,
  type ResolvedLocomotionTuning,
} from './locomotionState';

const T = LOCOMOTION_DEFAULTS;

function input(
  moveX: number,
  prevMoveX: number,
  opts: Partial<LocomotionInput> = {},
): LocomotionInput {
  return {
    moveX,
    prevMoveX,
    moveY: opts.moveY ?? 0,
    grounded: opts.grounded ?? true,
    facing: opts.facing ?? 1,
  };
}

/** Drive a constant held stick for n frames from a starting state. */
function hold(
  start: LocomotionState,
  moveX: number,
  n: number,
  tuning: ResolvedLocomotionTuning = T,
  opts: Partial<LocomotionInput> = {},
): LocomotionState {
  let s = start;
  let prev = 0;
  for (let i = 0; i < n; i += 1) {
    s = tickLocomotion(s, input(moveX, prev, opts), tuning);
    prev = moveX;
  }
  return s;
}

describe('locomotionState — construction / resolve', () => {
  it('starts standing, facing right, frame 0', () => {
    const s = createLocomotionState();
    expect(s.name).toBe('standing');
    expect(s.facing).toBe(1);
    expect(s.framesElapsed).toBe(0);
    expect(getLocomotionFacing(s)).toBe(1);
  });

  it('createLocomotionState honours a starting facing', () => {
    expect(createLocomotionState(-1).facing).toBe(-1);
  });

  it('resetLocomotionState returns a fresh standing state', () => {
    expect(resetLocomotionState(-1)).toEqual(createLocomotionState(-1));
  });

  it('resolve: speeds default to fractions of the passed maxRunSpeed', () => {
    const r = resolveLocomotionTuning(undefined, 10);
    expect(r.runMaxSpeed).toBe(10);
    expect(r.initialDashSpeed).toBeCloseTo(9); // 0.9 ×
    expect(r.walkMaxSpeed).toBeCloseTo(4.5); // 0.45 ×
  });

  it('resolve: explicit overrides win; thresholds clamp to [0,1]; negatives clamp to 0', () => {
    const r = resolveLocomotionTuning(
      {
        initialDashSpeed: 6,
        walkMaxSpeed: 2,
        dashStickThreshold: 1.5,
        walkStickThreshold: -0.2,
        pivotDamping: 2,
        dashDanceWindowFrames: -4,
      },
      8,
    );
    expect(r.initialDashSpeed).toBe(6);
    expect(r.walkMaxSpeed).toBe(2);
    expect(r.dashStickThreshold).toBe(1); // clamped
    expect(r.walkStickThreshold).toBe(0); // clamped
    expect(r.pivotDamping).toBe(1); // clamped
    expect(r.dashDanceWindowFrames).toBe(0); // negative → 0
  });
});

describe('locomotionState — walk / dash / run thresholds', () => {
  it('a sub-walk stick stays standing', () => {
    const s = hold(createLocomotionState(), 0.2, 5);
    expect(s.name).toBe('standing');
  });

  it('a partial tilt walks (no flick to dash)', () => {
    const s = hold(createLocomotionState(), 0.5, 5);
    expect(s.name).toBe('walk');
    expect(s.facing).toBe(1);
  });

  it('a full-tilt flick from rest enters the initial dash', () => {
    const s = tickLocomotion(createLocomotionState(), input(1, 0), T);
    expect(s.name).toBe('initialDash');
    expect(isDashing(s)).toBe(true);
    expect(s.facing).toBe(1);
    expect(s.framesElapsed).toBe(0);
  });

  it('a sustained full-tilt hold transitions initialDash → run after the window', () => {
    const s = hold(createLocomotionState(), 1, T.dashDanceWindowFrames + 3);
    expect(s.name).toBe('run');
    expect(isDashing(s)).toBe(true);
  });

  it('stays in the initial dash for the whole window', () => {
    // Within the window it must still read as initialDash, not yet run.
    const s = hold(createLocomotionState(), 1, T.dashDanceWindowFrames);
    expect(s.name).toBe('initialDash');
  });

  it('promotes to run exactly AT the window boundary (no off-by-one dash frame)', () => {
    // One tick past the window must already be run — the machine never
    // dwells in an initialDash frame at framesElapsed == window (which
    // would dash-dance an opposite flick where one frame later it pivots).
    const s = hold(createLocomotionState(), 1, T.dashDanceWindowFrames + 1);
    expect(s.name).toBe('run');
  });

  it('facing flips to the input direction', () => {
    const s = tickLocomotion(createLocomotionState(), input(-1, 0), T);
    expect(s.facing).toBe(-1);
    expect(getLocomotionFacing(s)).toBe(-1);
  });
});

describe('locomotionState — dash-dance vs pivot asymmetry', () => {
  it('an opposite flick INSIDE the dash window dash-dances (clean reverse, frame reset)', () => {
    // Flick right (enter initialDash), then a few frames in, flick left.
    let s = tickLocomotion(createLocomotionState(), input(1, 0), T); // initialDash R
    s = tickLocomotion(s, input(1, 1), T); // continue (fe 1)
    expect(s.framesElapsed).toBeLessThan(T.dashDanceWindowFrames);
    const danced = tickLocomotion(s, input(-1, 1), T); // opposite flick, still in window
    expect(danced.name).toBe('initialDash');
    expect(danced.facing).toBe(-1); // reversed
    expect(danced.dashFacing).toBe(-1);
    expect(danced.framesElapsed).toBe(0); // re-armed
  });

  it('an opposite flick AFTER the window (in run) pivots, not dash-dances', () => {
    const running = hold(createLocomotionState(), 1, T.dashDanceWindowFrames + 3);
    expect(running.name).toBe('run');
    const pivoted = tickLocomotion(running, input(-1, 1), T); // opposite flick from run
    expect(pivoted.name).toBe('pivot');
    expect(isPivoting(pivoted)).toBe(true);
    expect(pivoted.facing).toBe(-1); // facing flips immediately
  });

  it('a pivot lasts pivotStopFrames then resolves to the held direction', () => {
    const running = hold(createLocomotionState(), 1, T.dashDanceWindowFrames + 3);
    let s = tickLocomotion(running, input(-1, 1), T); // → pivot (fe 0)
    expect(s.name).toBe('pivot');
    // Hold the new direction through the skid.
    for (let i = 0; i < T.pivotStopFrames; i += 1) {
      s = tickLocomotion(s, input(-1, -1), T);
    }
    // After the skid, the held full tilt becomes a fresh dash the new way.
    expect(s.name).toBe('initialDash');
    expect(s.facing).toBe(-1);
  });
});

describe('locomotionState — crouch', () => {
  it('stick down with no lateral intent crouches', () => {
    const s = tickLocomotion(createLocomotionState(), input(0, 0, { moveY: 0.8 }), T);
    expect(s.name).toBe('crouch');
    expect(isCrouching(s)).toBe(true);
  });

  it('a clear lateral tilt beats crouch (down + side → not crouch)', () => {
    const s = tickLocomotion(createLocomotionState(), input(0.6, 0, { moveY: 0.8 }), T);
    expect(isCrouching(s)).toBe(false);
    expect(s.name).toBe('walk');
  });

  it('releasing down returns to standing', () => {
    let s = tickLocomotion(createLocomotionState(), input(0, 0, { moveY: 0.8 }), T);
    expect(s.name).toBe('crouch');
    s = tickLocomotion(s, input(0, 0, { moveY: 0 }), T);
    expect(s.name).toBe('standing');
  });

  it('crouch can be disabled by tuning', () => {
    const noCrouch = resolveLocomotionTuning({ crouchEnabled: false }, 8);
    const s = tickLocomotion(createLocomotionState(), input(0, 0, { moveY: 0.8 }), noCrouch);
    expect(s.name).toBe('standing');
  });
});

describe('locomotionState — airborne', () => {
  it('airborne forces standing regardless of stick', () => {
    const running = hold(createLocomotionState(), 1, 20);
    const air = tickLocomotion(running, input(1, 1, { grounded: false }), T);
    expect(air.name).toBe('standing');
  });

  it('getLocomotionTargetVx defers (null) when airborne', () => {
    const s = createLocomotionState();
    expect(getLocomotionTargetVx(s, input(1, 0, { grounded: false }), T)).toBeNull();
  });
});

describe('locomotionState — target velocity', () => {
  it('standing / crouch / pivot defer to damping (null target)', () => {
    const standing = createLocomotionState();
    expect(getLocomotionTargetVx(standing, input(0, 0), T)).toBeNull();
    const crouch = tickLocomotion(standing, input(0, 0, { moveY: 0.8 }), T);
    expect(getLocomotionTargetVx(crouch, input(0, 0, { moveY: 0.8 }), T)).toBeNull();
  });

  it('walk target is proportional and capped at walkMaxSpeed', () => {
    const walk = hold(createLocomotionState(), 0.5, 3);
    const v = getLocomotionTargetVx(walk, input(0.5, 0.5), T)!;
    expect(v).toBeGreaterThan(0);
    expect(Math.abs(v)).toBeLessThanOrEqual(T.walkMaxSpeed + 1e-9);
    // Full walk-band tilt (just below the dash threshold) approaches — but
    // never exceeds — walkMaxSpeed.
    const nearTop = getLocomotionTargetVx(walk, input(0.74, 0.74), T)!;
    expect(nearTop).toBeGreaterThan(T.walkMaxSpeed * 0.9);
    expect(nearTop).toBeLessThanOrEqual(T.walkMaxSpeed + 1e-9);
  });

  it('initial-dash target is the burst speed with the dash sign', () => {
    const dashL = tickLocomotion(createLocomotionState(), input(-1, 0), T);
    expect(getLocomotionTargetVx(dashL, input(-1, 0), T)).toBeCloseTo(-T.initialDashSpeed);
  });

  it('run target is runMaxSpeed with the facing sign', () => {
    const run = hold(createLocomotionState(), 1, T.dashDanceWindowFrames + 3);
    expect(getLocomotionTargetVx(run, input(1, 1), T)).toBeCloseTo(T.runMaxSpeed);
  });
});

describe('locomotionState — determinism', () => {
  it('identical input streams produce identical state trajectories', () => {
    const stream = [1, 1, 1, -1, -1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, -1];
    const run = (): LocomotionState[] => {
      let s = createLocomotionState();
      let prev = 0;
      const out: LocomotionState[] = [];
      for (const mx of stream) {
        s = tickLocomotion(s, input(mx, prev), T);
        out.push(s);
        prev = mx;
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});
