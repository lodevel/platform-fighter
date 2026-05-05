import { describe, it, expect } from 'vitest';
import {
  DODGE_DEFAULTS,
  DODGE_DEFAULTS_STICK_THRESHOLD,
  classifyDodgeFacing,
  classifyDodgeKind,
  createDodgeState,
  getDodgeSlideVelocity,
  isDodgeActing,
  isDodgeInvincible,
  isDodgeLockingInput,
  isDodgeOnCooldown,
  resetDodgeState,
  resolveDodgeTuning,
  tickDodge,
  type DodgeInput,
  type DodgeState,
} from './dodgeState';

/**
 * AC 60302 Sub-AC 2 — Dodge / roll mechanic with directional variants
 * (spot dodge, forward / back roll, air dodge), per-variant i-frame
 * windows, and cooldown / end-lag enforcement.
 *
 * The dodge state machine lives in `dodgeState.ts` as a pure-function
 * deterministic module; the runtime `Character` wires it into the
 * per-frame tick. These tests lock down the pure-function half:
 *
 *   1. Initial state — idle, no active dodge, no i-frames, no
 *      cooldown.
 *   2. Press classification — spot vs roll vs air picked from
 *      grounded + stick deflection.
 *   3. State transitions — idle → active → recovery → cooldown → idle.
 *   4. I-frame window — invincibility opens at press, drains over
 *      `iframeFrames`, closes before recovery.
 *   5. Cooldown / end-lag — fresh press is rejected during recovery
 *      and cooldown phases.
 *   6. Roll slide — `getDodgeSlideVelocity` returns
 *      `slideSpeed × facing` only during the active phase of a roll.
 *   7. Tuning — overrides merge with defaults; bad inputs clamp to
 *      sensible values; per-variant fields are independently
 *      resolvable.
 *   8. Determinism — identical inputs always produce identical state
 *      trajectories across many runs.
 */

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a default-zeroed input record. Caller overrides the relevant fields. */
function makeInput(overrides: Partial<DodgeInput> = {}): DodgeInput {
  return {
    held: false,
    justPressed: false,
    moveX: 0,
    grounded: true,
    facing: 1,
    ...overrides,
  };
}

/** Hold dodge for one frame as a fresh press (rising edge). */
function pressDodge(overrides: Partial<DodgeInput> = {}): DodgeInput {
  return makeInput({ held: true, justPressed: true, ...overrides });
}

/** Continue holding dodge in subsequent frames (no rising edge). */
function holdDodge(overrides: Partial<DodgeInput> = {}): DodgeInput {
  return makeInput({ held: true, justPressed: false, ...overrides });
}

/** A fully-released dodge frame — what the runtime feeds when the player is idle. */
function releaseDodge(overrides: Partial<DodgeInput> = {}): DodgeInput {
  return makeInput({ held: false, justPressed: false, ...overrides });
}

// ---------------------------------------------------------------------------
// Construction & defaults
// ---------------------------------------------------------------------------

describe('dodgeState — construction', () => {
  it('starts idle with no active dodge / no i-frames / no cooldown', () => {
    const s = createDodgeState();
    expect(s.name).toBe('idle');
    expect(s.active).toBeNull();
    expect(s.iframesRemaining).toBe(0);
    expect(s.cooldownRemaining).toBe(0);
  });

  it('returns a frozen state object so callers cannot mutate it', () => {
    const s = createDodgeState();
    expect(Object.isFrozen(s)).toBe(true);
  });

  it('resetDodgeState produces a fresh idle state', () => {
    const reset = resetDodgeState();
    expect(reset.name).toBe('idle');
    expect(reset.active).toBeNull();
    expect(reset.iframesRemaining).toBe(0);
    expect(reset.cooldownRemaining).toBe(0);
  });
});

describe('dodgeState — DODGE_DEFAULTS sanity', () => {
  it('spot variant is fastest, has no slide, has high i-frame ratio', () => {
    expect(DODGE_DEFAULTS.spot.slideSpeed).toBe(0);
    // Spot iframes should cover most of the active window.
    expect(DODGE_DEFAULTS.spot.iframeFrames).toBeLessThanOrEqual(
      DODGE_DEFAULTS.spot.activeFrames,
    );
    expect(DODGE_DEFAULTS.spot.iframeFrames).toBeGreaterThan(0);
  });

  it('roll variant has positive slide speed', () => {
    expect(DODGE_DEFAULTS.roll.slideSpeed).toBeGreaterThan(0);
    expect(DODGE_DEFAULTS.roll.iframeFrames).toBeLessThanOrEqual(
      DODGE_DEFAULTS.roll.activeFrames,
    );
  });

  it('air variant has no slide and the longest i-frame window', () => {
    expect(DODGE_DEFAULTS.air.slideSpeed).toBe(0);
    expect(DODGE_DEFAULTS.air.iframeFrames).toBeLessThanOrEqual(
      DODGE_DEFAULTS.air.activeFrames,
    );
    expect(DODGE_DEFAULTS.air.iframeFrames).toBeGreaterThanOrEqual(
      DODGE_DEFAULTS.spot.iframeFrames,
    );
  });

  it('stick threshold is in [0, 1]', () => {
    expect(DODGE_DEFAULTS.stickThreshold).toBeGreaterThanOrEqual(0);
    expect(DODGE_DEFAULTS.stickThreshold).toBeLessThanOrEqual(1);
  });
});

describe('dodgeState — resolveDodgeTuning', () => {
  it('returns canonical defaults when called with no overrides', () => {
    const t = resolveDodgeTuning();
    expect(t).toEqual(DODGE_DEFAULTS);
  });

  it('keeps unrelated defaults when one variant is partially overridden', () => {
    const t = resolveDodgeTuning({ roll: { slideSpeed: 20 } });
    expect(t.roll.slideSpeed).toBe(20);
    // Other roll fields preserved from defaults.
    expect(t.roll.activeFrames).toBe(DODGE_DEFAULTS.roll.activeFrames);
    expect(t.roll.iframeFrames).toBe(DODGE_DEFAULTS.roll.iframeFrames);
    // Other variants entirely untouched.
    expect(t.spot).toEqual(DODGE_DEFAULTS.spot);
    expect(t.air).toEqual(DODGE_DEFAULTS.air);
  });

  it('clamps iframeFrames to <= activeFrames', () => {
    const t = resolveDodgeTuning({
      spot: { activeFrames: 10, iframeFrames: 99 },
    });
    expect(t.spot.activeFrames).toBe(10);
    expect(t.spot.iframeFrames).toBe(10);
  });

  it('clamps negative frame fields to 0', () => {
    const t = resolveDodgeTuning({
      spot: {
        activeFrames: -5,
        iframeFrames: -1,
        recoveryFrames: -7,
        cooldownFrames: -3,
      },
    });
    expect(t.spot.activeFrames).toBe(0);
    expect(t.spot.iframeFrames).toBe(0);
    expect(t.spot.recoveryFrames).toBe(0);
    expect(t.spot.cooldownFrames).toBe(0);
  });

  it('clamps NaN / Infinity frame fields to 0', () => {
    const t = resolveDodgeTuning({
      spot: { activeFrames: NaN, iframeFrames: Infinity },
    });
    expect(t.spot.activeFrames).toBe(0);
    expect(t.spot.iframeFrames).toBe(0);
  });

  it('clamps negative slideSpeed to 0', () => {
    const t = resolveDodgeTuning({ roll: { slideSpeed: -10 } });
    expect(t.roll.slideSpeed).toBe(0);
  });

  it('floors fractional frame fields', () => {
    const t = resolveDodgeTuning({
      spot: { activeFrames: 12.9, iframeFrames: 4.5 },
    });
    expect(t.spot.activeFrames).toBe(12);
    expect(t.spot.iframeFrames).toBe(4);
  });

  it('clamps stickThreshold to [0, 1]', () => {
    expect(resolveDodgeTuning({ stickThreshold: -0.5 }).stickThreshold).toBe(0);
    expect(resolveDodgeTuning({ stickThreshold: 1.5 }).stickThreshold).toBe(1);
    expect(resolveDodgeTuning({ stickThreshold: 0.42 }).stickThreshold).toBe(
      0.42,
    );
  });

  it('falls back to default stickThreshold when given NaN', () => {
    const t = resolveDodgeTuning({ stickThreshold: NaN });
    expect(t.stickThreshold).toBe(DODGE_DEFAULTS_STICK_THRESHOLD);
  });
});

// ---------------------------------------------------------------------------
// Press classification helpers
// ---------------------------------------------------------------------------

describe('dodgeState — classifyDodgeKind', () => {
  it('returns "air" when not grounded regardless of stick', () => {
    expect(classifyDodgeKind(false, 0, 0.3)).toBe('air');
    expect(classifyDodgeKind(false, 1, 0.3)).toBe('air');
    expect(classifyDodgeKind(false, -1, 0.3)).toBe('air');
  });

  it('returns "spot" when grounded with neutral stick', () => {
    expect(classifyDodgeKind(true, 0, 0.3)).toBe('spot');
  });

  it('returns "spot" when grounded with stick below threshold', () => {
    expect(classifyDodgeKind(true, 0.2, 0.3)).toBe('spot');
    expect(classifyDodgeKind(true, -0.29, 0.3)).toBe('spot');
  });

  it('returns "roll" when grounded with stick at/above threshold', () => {
    expect(classifyDodgeKind(true, 0.3, 0.3)).toBe('roll');
    expect(classifyDodgeKind(true, -0.3, 0.3)).toBe('roll');
    expect(classifyDodgeKind(true, 1, 0.3)).toBe('roll');
    expect(classifyDodgeKind(true, -1, 0.3)).toBe('roll');
  });
});

describe('dodgeState — classifyDodgeFacing', () => {
  it('snaps to stick sign for a roll with deflected stick', () => {
    expect(classifyDodgeFacing('roll', 0.5, -1, 0.3)).toBe(1);
    expect(classifyDodgeFacing('roll', -0.5, 1, 0.3)).toBe(-1);
  });

  it('preserves prior facing for spot dodges', () => {
    expect(classifyDodgeFacing('spot', 0.5, -1, 0.3)).toBe(-1);
    expect(classifyDodgeFacing('spot', -0.5, 1, 0.3)).toBe(1);
  });

  it('preserves prior facing for air dodges', () => {
    expect(classifyDodgeFacing('air', 0.9, -1, 0.3)).toBe(-1);
    expect(classifyDodgeFacing('air', -0.9, 1, 0.3)).toBe(1);
  });

  it('preserves prior facing for a roll with neutral stick', () => {
    expect(classifyDodgeFacing('roll', 0, -1, 0.3)).toBe(-1);
    expect(classifyDodgeFacing('roll', 0.1, 1, 0.3)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Press handling — variant selection
// ---------------------------------------------------------------------------

describe('dodgeState — press handling fires correct variant', () => {
  it('grounded + neutral stick → spot dodge starts active phase', () => {
    const s0 = createDodgeState();
    const s1 = tickDodge(
      s0,
      pressDodge({ moveX: 0, grounded: true, facing: 1 }),
    );
    expect(s1.name).toBe('active');
    expect(s1.active).not.toBeNull();
    expect(s1.active?.kind).toBe('spot');
    expect(s1.active?.facing).toBe(1);
    expect(s1.active?.framesElapsed).toBe(0);
    expect(s1.iframesRemaining).toBe(DODGE_DEFAULTS.spot.iframeFrames);
    expect(s1.cooldownRemaining).toBe(0);
  });

  it('grounded + right stick → roll right starts active phase', () => {
    const s0 = createDodgeState();
    const s1 = tickDodge(
      s0,
      pressDodge({ moveX: 0.8, grounded: true, facing: -1 }),
    );
    expect(s1.name).toBe('active');
    expect(s1.active?.kind).toBe('roll');
    expect(s1.active?.facing).toBe(1);
    expect(s1.iframesRemaining).toBe(DODGE_DEFAULTS.roll.iframeFrames);
  });

  it('grounded + left stick → roll left', () => {
    const s0 = createDodgeState();
    const s1 = tickDodge(
      s0,
      pressDodge({ moveX: -0.7, grounded: true, facing: 1 }),
    );
    expect(s1.active?.kind).toBe('roll');
    expect(s1.active?.facing).toBe(-1);
  });

  it('airborne press → air dodge regardless of stick', () => {
    const s0 = createDodgeState();
    const s1 = tickDodge(
      s0,
      pressDodge({ moveX: 1, grounded: false, facing: 1 }),
    );
    expect(s1.active?.kind).toBe('air');
    expect(s1.iframesRemaining).toBe(DODGE_DEFAULTS.air.iframeFrames);
  });

  it('airborne press with neutral stick → air dodge', () => {
    const s0 = createDodgeState();
    const s1 = tickDodge(
      s0,
      pressDodge({ moveX: 0, grounded: false, facing: 1 }),
    );
    expect(s1.active?.kind).toBe('air');
  });

  it('held without rising edge does NOT fire a dodge', () => {
    const s0 = createDodgeState();
    const s1 = tickDodge(s0, holdDodge({ grounded: true }));
    expect(s1.name).toBe('idle');
    expect(s1.active).toBeNull();
  });

  it('justPressed without held does NOT fire (sanity guard)', () => {
    const s0 = createDodgeState();
    const s1 = tickDodge(
      s0,
      makeInput({ held: false, justPressed: true, grounded: true }),
    );
    expect(s1.name).toBe('idle');
  });

  it('rejects fresh press while machine is in active phase', () => {
    const s0 = createDodgeState();
    const s1 = tickDodge(s0, pressDodge({ grounded: true }));
    expect(s1.name).toBe('active');
    // Re-press on the next frame is dropped — already dodging.
    const s2 = tickDodge(s1, pressDodge({ grounded: true }));
    expect(s2.name).toBe('active');
    // framesElapsed should still increment to 1 — the dodge in flight ticks
    // forward, the press is silently dropped.
    expect(s2.active?.framesElapsed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// I-frame window
// ---------------------------------------------------------------------------

describe('dodgeState — i-frame window', () => {
  it('opens i-frames at press and drains by 1 per tick during active', () => {
    const s0 = createDodgeState();
    const s1 = tickDodge(s0, pressDodge({ grounded: true })); // spot
    expect(isDodgeInvincible(s1)).toBe(true);
    expect(s1.iframesRemaining).toBe(DODGE_DEFAULTS.spot.iframeFrames);

    // Continue holding (no fresh press); each tick should drain 1 i-frame
    // until the iframe window closes.
    let s = s1;
    for (let i = 1; i < DODGE_DEFAULTS.spot.iframeFrames; i++) {
      s = tickDodge(s, holdDodge({ grounded: true }));
      expect(s.iframesRemaining).toBe(DODGE_DEFAULTS.spot.iframeFrames - i);
      expect(isDodgeInvincible(s)).toBe(true);
    }
    // One more tick → i-frames hit 0 (still in active phase if iframe <
    // active, but no longer invincible).
    s = tickDodge(s, holdDodge({ grounded: true }));
    expect(s.iframesRemaining).toBe(0);
    expect(isDodgeInvincible(s)).toBe(false);
  });

  it('i-frames are forced to 0 when leaving the active phase', () => {
    // Author a tuning where iframeFrames === activeFrames, so the
    // i-frame counter would otherwise have leaked into recovery.
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 5,
        iframeFrames: 5,
        recoveryFrames: 4,
        cooldownFrames: 0,
      },
    });
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }), tuning);
    expect(s.name).toBe('active');
    // Tick through the active window.
    for (let i = 0; i < 5; i++) {
      s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    }
    expect(s.name).toBe('recovery');
    expect(s.iframesRemaining).toBe(0);
    expect(isDodgeInvincible(s)).toBe(false);
  });

  it('air dodge has the longest i-frame window of the three variants', () => {
    const s0 = createDodgeState();
    const air = tickDodge(s0, pressDodge({ grounded: false }));
    const spot = tickDodge(s0, pressDodge({ grounded: true, moveX: 0 }));
    const roll = tickDodge(s0, pressDodge({ grounded: true, moveX: 1 }));
    expect(air.iframesRemaining).toBeGreaterThanOrEqual(spot.iframesRemaining);
    expect(air.iframesRemaining).toBeGreaterThanOrEqual(roll.iframesRemaining);
  });
});

// ---------------------------------------------------------------------------
// Phase transitions: active → recovery → cooldown → idle
// ---------------------------------------------------------------------------

describe('dodgeState — phase transitions', () => {
  it('active → recovery after activeFrames', () => {
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 4,
        iframeFrames: 3,
        recoveryFrames: 5,
        cooldownFrames: 3,
      },
    });
    // Press → enters active with framesElapsed=0. We need framesElapsed
    // to reach activeFrames (=4) for the transition; that's 4 more ticks.
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }), tuning);
    expect(s.name).toBe('active');
    for (let i = 0; i < 3; i++) {
      s = tickDodge(s, holdDodge({ grounded: true }), tuning);
      expect(s.name).toBe('active');
    }
    // 4th tick crosses framesElapsed >= activeFrames → recovery.
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(s.name).toBe('recovery');
    expect(s.iframesRemaining).toBe(0);
    expect(s.cooldownRemaining).toBe(0);
    // The active snapshot's framesElapsed continues to count through
    // recovery so the same counter drives the recovery exit.
    expect(s.active?.kind).toBe('spot');
  });

  it('recovery → cooldown after recoveryFrames', () => {
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 3,
        iframeFrames: 2,
        recoveryFrames: 4,
        cooldownFrames: 6,
      },
    });
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }), tuning);
    // Tick to end of active.
    for (let i = 1; i < 3; i++) {
      s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    }
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(s.name).toBe('recovery');
    // Tick recovery to its end: total active+recovery = 7 frames.
    for (let i = 0; i < 3; i++) {
      s = tickDodge(s, holdDodge({ grounded: true }), tuning);
      expect(s.name).toBe('recovery');
    }
    // One more tick exits recovery → cooldown.
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(s.name).toBe('cooldown');
    expect(s.cooldownRemaining).toBe(6);
    expect(s.active).toBeNull();
  });

  it('cooldown → idle after cooldownFrames drain', () => {
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 2,
        iframeFrames: 2,
        recoveryFrames: 2,
        cooldownFrames: 3,
      },
    });
    // Press + tick through active + recovery to reach cooldown.
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }), tuning);
    for (let i = 0; i < 4; i++) {
      s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    }
    expect(s.name).toBe('cooldown');
    // Drain cooldown — 3 frames.
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(s.name).toBe('cooldown');
    expect(s.cooldownRemaining).toBe(2);
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(s.cooldownRemaining).toBe(1);
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(s.name).toBe('idle');
    expect(s.cooldownRemaining).toBe(0);
  });

  it('skips recovery when recoveryFrames === 0 (active → cooldown)', () => {
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 2,
        iframeFrames: 2,
        recoveryFrames: 0,
        cooldownFrames: 4,
      },
    });
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }), tuning);
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(s.name).toBe('cooldown');
    expect(s.cooldownRemaining).toBe(4);
  });

  it('skips cooldown when cooldownFrames === 0 (recovery → idle)', () => {
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 2,
        iframeFrames: 2,
        recoveryFrames: 2,
        cooldownFrames: 0,
      },
    });
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }), tuning);
    for (let i = 0; i < 4; i++) {
      s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    }
    expect(s.name).toBe('idle');
    expect(s.active).toBeNull();
    expect(s.cooldownRemaining).toBe(0);
  });

  it('zero-duration variant skips straight to cooldown / idle', () => {
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 0,
        iframeFrames: 0,
        recoveryFrames: 0,
        cooldownFrames: 5,
      },
    });
    const s = tickDodge(createDodgeState(), pressDodge({ grounded: true }), tuning);
    expect(s.name).toBe('cooldown');
    expect(s.cooldownRemaining).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Cooldown / end-lag rejection of fresh presses
// ---------------------------------------------------------------------------

describe('dodgeState — cooldown / end-lag rejects fresh presses', () => {
  function fastForwardToCooldown(): { s: DodgeState; tuning: ReturnType<typeof resolveDodgeTuning> } {
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 3,
        iframeFrames: 2,
        recoveryFrames: 3,
        cooldownFrames: 6,
      },
    });
    // Press = frame 1 (framesElapsed=0). Need framesElapsed=3 for active
    // exit (3 more holds), then framesElapsed=6 for recovery exit
    // (3 more holds) = 6 holds total.
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }), tuning);
    for (let i = 0; i < 6; i++) {
      s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    }
    expect(s.name).toBe('cooldown');
    return { s, tuning };
  }

  it('rejects a fresh press during the recovery phase', () => {
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 2,
        iframeFrames: 2,
        recoveryFrames: 6,
        cooldownFrames: 0,
      },
    });
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }), tuning);
    // Tick to recovery.
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(s.name).toBe('recovery');
    // Fresh press must NOT restart the dodge mid-recovery.
    const before = s;
    s = tickDodge(s, pressDodge({ grounded: true, moveX: 1 }), tuning);
    // Still recovery, framesElapsed ticked forward, no fresh active.
    expect(s.name).toBe('recovery');
    expect(s.active?.kind).toBe(before.active?.kind);
    expect(s.active?.framesElapsed).toBe((before.active?.framesElapsed ?? 0) + 1);
  });

  it('rejects a fresh press during the cooldown phase', () => {
    const { s: cooldownState, tuning } = fastForwardToCooldown();
    const before = cooldownState;
    const after = tickDodge(
      before,
      pressDodge({ grounded: true, moveX: 1 }),
      tuning,
    );
    // Cooldown counter ticked down, but no new active dodge.
    expect(after.name).toBe('cooldown');
    expect(after.cooldownRemaining).toBe(before.cooldownRemaining - 1);
    expect(after.active).toBeNull();
  });

  it('press on the same frame cooldown drains to 0 is rejected', () => {
    // The contract: press handling runs FIRST, so a press on the frame
    // cooldown would have hit 0 still sees the cooldown machine in
    // 'cooldown' state. The press is rejected. Cooldown drain happens
    // after, transitioning to idle. The NEXT frame's press is honoured.
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 1,
        iframeFrames: 1,
        recoveryFrames: 0,
        cooldownFrames: 1,
      },
    });
    // Press, frame 1 → active.
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }), tuning);
    expect(s.name).toBe('active');
    // Frame 2 → cooldown (active drains, recovery skipped, cooldown=1).
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(s.name).toBe('cooldown');
    expect(s.cooldownRemaining).toBe(1);
    // Frame 3 → press is rejected because still in cooldown; cooldown
    // drains to 0 → idle.
    s = tickDodge(s, pressDodge({ grounded: true }), tuning);
    expect(s.name).toBe('idle');
    // Frame 4 → fresh press is accepted now.
    s = tickDodge(s, pressDodge({ grounded: true }), tuning);
    expect(s.name).toBe('active');
  });

  it('full cycle returns to idle and accepts a fresh press', () => {
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 2,
        iframeFrames: 2,
        recoveryFrames: 2,
        cooldownFrames: 2,
      },
    });
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }), tuning);
    // Tick through full cycle: 2 active + 2 recovery + 2 cooldown =
    // 6 - 1 (we're already on frame 1 of active after the press).
    for (let i = 0; i < 6; i++) {
      s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    }
    expect(s.name).toBe('idle');
    // New press accepted.
    s = tickDodge(s, pressDodge({ grounded: true }), tuning);
    expect(s.name).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Roll slide velocity
// ---------------------------------------------------------------------------

describe('dodgeState — getDodgeSlideVelocity', () => {
  it('returns null while idle', () => {
    expect(getDodgeSlideVelocity(createDodgeState())).toBeNull();
  });

  it('returns null for an active spot dodge', () => {
    const s = tickDodge(
      createDodgeState(),
      pressDodge({ grounded: true, moveX: 0 }),
    );
    expect(s.active?.kind).toBe('spot');
    expect(getDodgeSlideVelocity(s)).toBeNull();
  });

  it('returns null for an active air dodge', () => {
    const s = tickDodge(
      createDodgeState(),
      pressDodge({ grounded: false }),
    );
    expect(s.active?.kind).toBe('air');
    expect(getDodgeSlideVelocity(s)).toBeNull();
  });

  it('returns slideSpeed × +1 for a right roll active phase', () => {
    const s = tickDodge(
      createDodgeState(),
      pressDodge({ grounded: true, moveX: 1, facing: 1 }),
    );
    expect(s.active?.kind).toBe('roll');
    expect(getDodgeSlideVelocity(s)).toBe(DODGE_DEFAULTS.roll.slideSpeed);
  });

  it('returns slideSpeed × -1 for a left roll active phase', () => {
    const s = tickDodge(
      createDodgeState(),
      pressDodge({ grounded: true, moveX: -1, facing: 1 }),
    );
    expect(s.active?.kind).toBe('roll');
    expect(getDodgeSlideVelocity(s)).toBe(-DODGE_DEFAULTS.roll.slideSpeed);
  });

  it('returns null once the roll enters recovery', () => {
    const tuning = resolveDodgeTuning({
      roll: {
        activeFrames: 2,
        iframeFrames: 2,
        recoveryFrames: 4,
        cooldownFrames: 0,
        slideSpeed: 8,
      },
    });
    let s = tickDodge(
      createDodgeState(),
      pressDodge({ grounded: true, moveX: 1 }),
      tuning,
    );
    expect(getDodgeSlideVelocity(s, tuning)).toBe(8);
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    // After 2 active frames, we should be in recovery now.
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(s.name).toBe('recovery');
    expect(getDodgeSlideVelocity(s, tuning)).toBeNull();
  });

  it('returns null when slideSpeed is 0 even for a roll', () => {
    const tuning = resolveDodgeTuning({
      roll: { slideSpeed: 0 },
    });
    const s = tickDodge(
      createDodgeState(),
      pressDodge({ grounded: true, moveX: 1 }),
      tuning,
    );
    expect(s.active?.kind).toBe('roll');
    expect(getDodgeSlideVelocity(s, tuning)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Public boolean queries
// ---------------------------------------------------------------------------

describe('dodgeState — boolean queries', () => {
  it('isDodgeActing is true during active and recovery only', () => {
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 2,
        iframeFrames: 2,
        recoveryFrames: 2,
        cooldownFrames: 2,
      },
    });
    const idle = createDodgeState();
    expect(isDodgeActing(idle)).toBe(false);
    let s = tickDodge(idle, pressDodge({ grounded: true }), tuning);
    expect(isDodgeActing(s)).toBe(true); // active
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(s.name).toBe('recovery');
    expect(isDodgeActing(s)).toBe(true); // recovery
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(s.name).toBe('cooldown');
    expect(isDodgeActing(s)).toBe(false); // cooldown
  });

  it('isDodgeOnCooldown is true only during the cooldown phase', () => {
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 1,
        iframeFrames: 1,
        recoveryFrames: 1,
        cooldownFrames: 3,
      },
    });
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }), tuning);
    expect(isDodgeOnCooldown(s)).toBe(false); // active
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(isDodgeOnCooldown(s)).toBe(false); // recovery
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(isDodgeOnCooldown(s)).toBe(true); // cooldown
  });

  it('isDodgeLockingInput matches isDodgeActing semantics', () => {
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 1,
        iframeFrames: 1,
        recoveryFrames: 1,
        cooldownFrames: 1,
      },
    });
    let s = createDodgeState();
    expect(isDodgeLockingInput(s)).toBe(false);
    s = tickDodge(s, pressDodge({ grounded: true }), tuning);
    expect(isDodgeLockingInput(s)).toBe(true);
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(s.name).toBe('recovery');
    expect(isDodgeLockingInput(s)).toBe(true);
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(s.name).toBe('cooldown');
    expect(isDodgeLockingInput(s)).toBe(false);
  });

  it('isDodgeInvincible mirrors iframesRemaining > 0', () => {
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 4,
        iframeFrames: 2,
        recoveryFrames: 2,
        cooldownFrames: 0,
      },
    });
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }), tuning);
    expect(isDodgeInvincible(s)).toBe(true);
    expect(s.iframesRemaining).toBe(2);
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(s.iframesRemaining).toBe(1);
    expect(isDodgeInvincible(s)).toBe(true);
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(s.iframesRemaining).toBe(0);
    expect(isDodgeInvincible(s)).toBe(false);
    // Still in active phase but no longer invincible.
    expect(s.name).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Determinism — pure-function contract
// ---------------------------------------------------------------------------

describe('dodgeState — determinism', () => {
  it('identical input streams produce identical state trajectories', () => {
    const inputs: DodgeInput[] = [
      pressDodge({ grounded: true, moveX: 0 }),
      holdDodge({ grounded: true }),
      holdDodge({ grounded: true }),
      releaseDodge({ grounded: true }),
      releaseDodge({ grounded: true }),
      pressDodge({ grounded: true, moveX: 1 }),
      holdDodge({ grounded: true }),
      holdDodge({ grounded: true }),
      holdDodge({ grounded: false }),
      pressDodge({ grounded: false }),
    ];

    function run(): DodgeState[] {
      const out: DodgeState[] = [];
      let s = createDodgeState();
      for (const inp of inputs) {
        s = tickDodge(s, inp);
        out.push(s);
      }
      return out;
    }

    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });

  it('idle ticks return identity (same reference) so callers can dirty-check', () => {
    const s0 = createDodgeState();
    const s1 = tickDodge(s0, releaseDodge({ grounded: true }));
    expect(s1).toBe(s0);
  });

  it('press classifier is order-independent of stick magnitude polarity', () => {
    const s0 = createDodgeState();
    const a = tickDodge(s0, pressDodge({ grounded: true, moveX: 0.4 }));
    const b = tickDodge(s0, pressDodge({ grounded: true, moveX: -0.4 }));
    expect(a.active?.kind).toBe('roll');
    expect(b.active?.kind).toBe('roll');
    expect(a.active?.facing).toBe(1);
    expect(b.active?.facing).toBe(-1);
    expect(a.iframesRemaining).toBe(b.iframesRemaining);
  });

  it('full cycle preserves state shape — no field drift across runs', () => {
    const tuning = resolveDodgeTuning();
    // Do a long-run press → release → press → release sequence and
    // confirm every state has the canonical 4-field shape.
    let s = createDodgeState();
    const inputs = [
      pressDodge({ grounded: true, moveX: 1 }),
      ...Array.from({ length: 60 }, () => holdDodge({ grounded: true })),
      ...Array.from({ length: 60 }, () => releaseDodge({ grounded: true })),
      pressDodge({ grounded: false }),
      ...Array.from({ length: 60 }, () => holdDodge({ grounded: false })),
    ];
    for (const inp of inputs) {
      s = tickDodge(s, inp, tuning);
      expect(typeof s.name).toBe('string');
      expect(typeof s.iframesRemaining).toBe('number');
      expect(typeof s.cooldownRemaining).toBe('number');
      // active is null in idle/cooldown, non-null in active/recovery.
      const expectingActive = s.name === 'active' || s.name === 'recovery';
      if (expectingActive) {
        expect(s.active).not.toBeNull();
      } else {
        expect(s.active).toBeNull();
      }
    }
    // After all the ticks we should be back at idle (everything drained).
    expect(s.name).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Edge cases & integration-style scenarios
// ---------------------------------------------------------------------------

describe('dodgeState — edge cases', () => {
  it('rolling against the facing direction snaps facing to stick sign', () => {
    const s = tickDodge(
      createDodgeState(),
      pressDodge({ grounded: true, moveX: -1, facing: 1 }),
    );
    expect(s.active?.kind).toBe('roll');
    expect(s.active?.facing).toBe(-1);
  });

  it('roll with neutral stick (just below threshold) becomes spot', () => {
    const tuning = resolveDodgeTuning({ stickThreshold: 0.5 });
    const s = tickDodge(
      createDodgeState(),
      pressDodge({ grounded: true, moveX: 0.4 }),
      tuning,
    );
    expect(s.active?.kind).toBe('spot');
  });

  it('roll exactly at threshold becomes a roll', () => {
    const tuning = resolveDodgeTuning({ stickThreshold: 0.5 });
    const s = tickDodge(
      createDodgeState(),
      pressDodge({ grounded: true, moveX: 0.5 }),
      tuning,
    );
    expect(s.active?.kind).toBe('roll');
  });

  it('spot dodge does not slide regardless of stick deflection', () => {
    const s = tickDodge(
      createDodgeState(),
      pressDodge({ grounded: true, moveX: 0.1 }),
    );
    expect(s.active?.kind).toBe('spot');
    expect(getDodgeSlideVelocity(s)).toBeNull();
  });

  it('active framesElapsed counts up monotonically through active+recovery', () => {
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 3,
        iframeFrames: 2,
        recoveryFrames: 4,
        cooldownFrames: 0,
      },
    });
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }), tuning);
    const elapsed: number[] = [s.active?.framesElapsed ?? -1];
    for (let i = 0; i < 6; i++) {
      s = tickDodge(s, holdDodge({ grounded: true }), tuning);
      if (s.active !== null) {
        elapsed.push(s.active.framesElapsed);
      }
    }
    // Monotonically increasing.
    for (let i = 1; i < elapsed.length; i++) {
      const a = elapsed[i] ?? 0;
      const b = elapsed[i - 1] ?? 0;
      expect(a).toBeGreaterThan(b);
    }
  });

  it('held flag without justPressed flag does not start a dodge after release-and-rehold', () => {
    // First press → fires dodge.
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }));
    // Continue holding all the way until idle. Without `justPressed`,
    // even a held button should NOT re-fire on idle.
    while (s.name !== 'idle') {
      s = tickDodge(s, holdDodge({ grounded: true }));
    }
    // Now we're idle, button still held → still no fresh dodge until
    // the runtime sets `justPressed=true` on the next rising edge.
    s = tickDodge(s, holdDodge({ grounded: true }));
    expect(s.name).toBe('idle');
  });

  it('pressing dodge while cooldown is draining still drains cooldown by 1', () => {
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 1,
        iframeFrames: 1,
        recoveryFrames: 0,
        cooldownFrames: 5,
      },
    });
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }), tuning);
    s = tickDodge(s, holdDodge({ grounded: true }), tuning);
    expect(s.name).toBe('cooldown');
    expect(s.cooldownRemaining).toBe(5);
    // Press during cooldown — drain by 1, no new dodge.
    s = tickDodge(s, pressDodge({ grounded: true }), tuning);
    expect(s.name).toBe('cooldown');
    expect(s.cooldownRemaining).toBe(4);
  });

  it('air dodge stays "air" even if grounded flips mid-sequence', () => {
    // Press airborne — air dodge fires.
    let s = tickDodge(
      createDodgeState(),
      pressDodge({ grounded: false }),
    );
    expect(s.active?.kind).toBe('air');
    // Land mid-dodge — the kind locked at press time should NOT change.
    s = tickDodge(s, holdDodge({ grounded: true }));
    expect(s.active?.kind).toBe('air');
  });

  it('classifyDodgeKind matches the variant chosen by tickDodge', () => {
    const cases = [
      { grounded: true, moveX: 0, expected: 'spot' },
      { grounded: true, moveX: 0.5, expected: 'roll' },
      { grounded: true, moveX: -0.5, expected: 'roll' },
      { grounded: false, moveX: 0, expected: 'air' },
      { grounded: false, moveX: 1, expected: 'air' },
    ] as const;
    for (const c of cases) {
      const k = classifyDodgeKind(c.grounded, c.moveX, DODGE_DEFAULTS.stickThreshold);
      expect(k).toBe(c.expected);
      const s = tickDodge(
        createDodgeState(),
        pressDodge({ grounded: c.grounded, moveX: c.moveX }),
      );
      expect(s.active?.kind).toBe(c.expected);
    }
  });
});

// ---------------------------------------------------------------------------
// Trajectory / visual regression — no off-by-one on the press frame
// ---------------------------------------------------------------------------

describe('dodgeState — trajectory regression', () => {
  it('total active frames equals tuning.activeFrames (press counts as frame 0)', () => {
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 7,
        iframeFrames: 5,
        recoveryFrames: 1,
        cooldownFrames: 0,
      },
    });
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }), tuning);
    let activeCount = 1; // press frame is active
    while (s.name === 'active') {
      s = tickDodge(s, holdDodge({ grounded: true }), tuning);
      if (s.name === 'active') activeCount++;
    }
    expect(activeCount).toBe(7);
  });

  it('total i-frame count equals tuning.iframeFrames', () => {
    const tuning = resolveDodgeTuning({
      spot: {
        activeFrames: 7,
        iframeFrames: 5,
        recoveryFrames: 0,
        cooldownFrames: 0,
      },
    });
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }), tuning);
    let iframeCount = isDodgeInvincible(s) ? 1 : 0;
    while (s.name === 'active' || s.name === 'recovery') {
      s = tickDodge(s, holdDodge({ grounded: true }), tuning);
      if (isDodgeInvincible(s)) iframeCount++;
    }
    expect(iframeCount).toBe(5);
  });

  it('every variant fires a complete press → idle cycle without leaking state', () => {
    const grids: Array<{ label: string; input: Partial<DodgeInput> }> = [
      { label: 'spot', input: { grounded: true, moveX: 0 } },
      { label: 'roll-right', input: { grounded: true, moveX: 1 } },
      { label: 'roll-left', input: { grounded: true, moveX: -1 } },
      { label: 'air', input: { grounded: false, moveX: 0 } },
    ];
    for (const g of grids) {
      let s = tickDodge(createDodgeState(), pressDodge(g.input));
      let ticks = 1;
      while (s.name !== 'idle' && ticks < 1000) {
        s = tickDodge(s, holdDodge({ grounded: g.input.grounded ?? true }));
        ticks++;
      }
      expect(s.name).toBe('idle');
      expect(s.active).toBeNull();
      expect(s.iframesRemaining).toBe(0);
      expect(s.cooldownRemaining).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Smoke-tests for the trajectory of the canonical defaults
// ---------------------------------------------------------------------------

describe('dodgeState — DODGE_DEFAULTS canonical trajectory', () => {
  it('spot dodge: 16 active frames, first 14 are i-frames', () => {
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: true }));
    let active = 0;
    let iframes = 0;
    if (s.name === 'active') active++;
    if (isDodgeInvincible(s)) iframes++;
    while (s.name === 'active') {
      s = tickDodge(s, holdDodge({ grounded: true }));
      if (s.name === 'active') active++;
      if (isDodgeInvincible(s)) iframes++;
    }
    expect(active).toBe(DODGE_DEFAULTS.spot.activeFrames);
    expect(iframes).toBe(DODGE_DEFAULTS.spot.iframeFrames);
  });

  it('roll: 20 active frames, slides at slideSpeed throughout active', () => {
    let s = tickDodge(
      createDodgeState(),
      pressDodge({ grounded: true, moveX: 1 }),
    );
    let active = 0;
    const slideSamples: Array<number | null> = [];
    if (s.name === 'active') active++;
    slideSamples.push(getDodgeSlideVelocity(s));
    while (s.name === 'active') {
      s = tickDodge(s, holdDodge({ grounded: true }));
      if (s.name === 'active') {
        active++;
        slideSamples.push(getDodgeSlideVelocity(s));
      }
    }
    expect(active).toBe(DODGE_DEFAULTS.roll.activeFrames);
    // Every sample during active should equal +slideSpeed.
    for (const v of slideSamples) {
      expect(v).toBe(DODGE_DEFAULTS.roll.slideSpeed);
    }
  });

  it('air dodge: 24 active frames, first 20 are i-frames', () => {
    let s = tickDodge(createDodgeState(), pressDodge({ grounded: false }));
    let active = 0;
    let iframes = 0;
    if (s.name === 'active') active++;
    if (isDodgeInvincible(s)) iframes++;
    while (s.name === 'active') {
      s = tickDodge(s, holdDodge({ grounded: false }));
      if (s.name === 'active') active++;
      if (isDodgeInvincible(s)) iframes++;
    }
    expect(active).toBe(DODGE_DEFAULTS.air.activeFrames);
    expect(iframes).toBe(DODGE_DEFAULTS.air.iframeFrames);
  });
});
