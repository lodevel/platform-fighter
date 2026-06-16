import { describe, it, expect } from 'vitest';
import {
  LEDGE_HANG_DEFAULTS,
  createLedgeHangState,
  isClimbingFromLedge,
  isHangingOnLedge,
  isLedgeHangInvincible,
  isLedgeLockingInput,
  isLedgeRolling,
  isLedgeTetherCooldown,
  resetLedgeHangState,
  resolveLedgeHangTuning,
  resolveLedgeTrumps,
  tickLedgeHang,
  type LedgeHangInput,
  type LedgeHangState,
} from './ledgeHangState';
import type { LedgeCandidate } from './ledgeDetection';

/**
 * AC 60403 Sub-AC 3 — Ledge-hang state machine + tether timing.
 *
 * The state machine is the runtime half of the edge-grab feature:
 * (geometric detection produces a `LedgeGrabDetection` snapshot; this
 * machine consumes it + player input to produce the discrete hang /
 * climb / cooldown phases). Tests lock down:
 *
 *   1. Initial state — idle, no active hang, no i-frames, no cooldown.
 *   2. Construction — frozen state objects, reset returns fresh idle.
 *   3. Detection latch — a positive detection while idle + airborne
 *      transitions to `'hanging'` with i-frames armed.
 *   4. Detection rejected — grounded fighter ignores detection;
 *      cooldown active rejects detection too.
 *   5. Hanging tick — frame counter advances, i-frames drain, max-hang
 *      auto-drop fires.
 *   6. Release actions — getUp, jump, attack, dropDown each transition
 *      cleanly with the correct `released` outcome.
 *   7. Climbing — the climb plays for `climbFrames` then transitions
 *      to cooldown.
 *   8. Cooldown — drains over `tetherCooldownFrames` and returns to idle.
 *   9. Force release — punches the machine out of `'hanging'` /
 *      `'climbing'` immediately into cooldown.
 *  10. Tuning — overrides merge with defaults; bad inputs clamp.
 *  11. Determinism — identical inputs produce identical state trajectories.
 */

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_CANDIDATE: LedgeCandidate = Object.freeze({
  platformId: 'main',
  side: 'right',
  x: 100,
  y: 50,
});

function makeDetection(latchX = 100, latchY = 100) {
  return { candidate: TEST_CANDIDATE, latchX, latchY };
}

function makeInput(overrides: Partial<LedgeHangInput> = {}): LedgeHangInput {
  return {
    detection: null,
    release: null,
    airborne: true,
    facing: 1,
    ...overrides,
  };
}

/** Tick many frames at once for fast-forward through phases. */
function advanceFrames(
  state: LedgeHangState,
  frames: number,
  inputBuilder: () => LedgeHangInput,
  tuning = LEDGE_HANG_DEFAULTS,
): LedgeHangState {
  let s = state;
  for (let i = 0; i < frames; i += 1) {
    s = tickLedgeHang(s, inputBuilder(), tuning).state;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('ledgeHangState — construction', () => {
  it('starts idle with no active hang / no i-frames / no cooldown', () => {
    const s = createLedgeHangState();
    expect(s.name).toBe('idle');
    expect(s.active).toBeNull();
    expect(s.hangIframesRemaining).toBe(0);
    expect(s.cooldownRemaining).toBe(0);
  });

  it('returns a frozen state object', () => {
    expect(Object.isFrozen(createLedgeHangState())).toBe(true);
  });

  it('resetLedgeHangState produces a fresh idle state', () => {
    const fresh = resetLedgeHangState();
    expect(fresh.name).toBe('idle');
    expect(fresh.active).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe('LEDGE_HANG_DEFAULTS', () => {
  it('matches sane Smash-like values', () => {
    expect(LEDGE_HANG_DEFAULTS.maxHangFrames).toBe(360);
    expect(LEDGE_HANG_DEFAULTS.hangIframeFrames).toBe(24);
    expect(LEDGE_HANG_DEFAULTS.climbFrames).toBe(28);
    expect(LEDGE_HANG_DEFAULTS.tetherCooldownFrames).toBe(30);
    expect(LEDGE_HANG_DEFAULTS.dropDownClearance).toBe(20);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(LEDGE_HANG_DEFAULTS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Detection latch
// ---------------------------------------------------------------------------

describe('detection latch', () => {
  it('latches into hanging on a fresh detection while idle + airborne', () => {
    const s0 = createLedgeHangState();
    const input = makeInput({ detection: makeDetection(), airborne: true });
    const r = tickLedgeHang(s0, input);
    expect(r.state.name).toBe('hanging');
    expect(r.state.active).not.toBeNull();
    expect(r.state.active!.candidate).toBe(TEST_CANDIDATE);
    expect(r.state.active!.latchX).toBe(100);
    expect(r.state.active!.framesElapsed).toBe(0);
    expect(r.state.hangIframesRemaining).toBe(LEDGE_HANG_DEFAULTS.hangIframeFrames);
  });

  it('latches even with no release intent', () => {
    const r = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
    );
    expect(r.released).toBeNull();
    expect(isHangingOnLedge(r.state)).toBe(true);
  });

  it('does NOT latch when grounded — fighter must be airborne', () => {
    const r = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection(), airborne: false }),
    );
    expect(r.state.name).toBe('idle');
  });

  it('does NOT latch with null detection', () => {
    const r = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: null }),
    );
    expect(r.state.name).toBe('idle');
  });

  it('locks in facing on the latch', () => {
    const r = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection(), facing: -1 }),
    );
    expect(r.state.active?.facing).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Hanging tick
// ---------------------------------------------------------------------------

describe('hanging tick', () => {
  it('increments framesElapsed by 1 each tick', () => {
    let s = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
    ).state;
    s = tickLedgeHang(s, makeInput()).state;
    expect(s.active?.framesElapsed).toBe(1);
    s = tickLedgeHang(s, makeInput()).state;
    expect(s.active?.framesElapsed).toBe(2);
  });

  it('drains hangIframesRemaining over the i-frame window', () => {
    const tuning = resolveLedgeHangTuning({ hangIframeFrames: 5 });
    let s = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
      tuning,
    ).state;
    expect(s.hangIframesRemaining).toBe(5);
    for (let i = 0; i < 5; i += 1) {
      s = tickLedgeHang(s, makeInput(), tuning).state;
    }
    expect(s.hangIframesRemaining).toBe(0);
    expect(s.name).toBe('hanging');
  });

  it('isLedgeHangInvincible reads `hangIframesRemaining > 0`', () => {
    const s = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
    ).state;
    expect(isLedgeHangInvincible(s)).toBe(true);
  });

  it('auto-drops on max-hang clock expiry', () => {
    const tuning = resolveLedgeHangTuning({ maxHangFrames: 5 });
    let s = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
      tuning,
    ).state;
    s = advanceFrames(s, 5, () => makeInput(), tuning);
    expect(s.name).toBe('cooldown');
    expect(s.cooldownRemaining).toBe(LEDGE_HANG_DEFAULTS.tetherCooldownFrames);
  });
});

// ---------------------------------------------------------------------------
// Release actions
// ---------------------------------------------------------------------------

describe('release actions', () => {
  function spinUpHang(): LedgeHangState {
    return tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
    ).state;
  }

  it('jump release transitions to cooldown and emits released=jump', () => {
    const s0 = spinUpHang();
    const r = tickLedgeHang(s0, makeInput({ release: 'jump' }));
    expect(r.state.name).toBe('cooldown');
    expect(r.state.cooldownRemaining).toBe(LEDGE_HANG_DEFAULTS.tetherCooldownFrames);
    expect(r.released).toBe('jump');
  });

  it('dropDown release transitions to cooldown and emits released=dropDown', () => {
    const s0 = spinUpHang();
    const r = tickLedgeHang(s0, makeInput({ release: 'dropDown' }));
    expect(r.state.name).toBe('cooldown');
    expect(r.released).toBe('dropDown');
  });

  it('attack release transitions to cooldown and emits released=attack', () => {
    const s0 = spinUpHang();
    const r = tickLedgeHang(s0, makeInput({ release: 'attack' }));
    expect(r.state.name).toBe('cooldown');
    expect(r.released).toBe('attack');
  });

  it('getUp release transitions to climbing (not cooldown)', () => {
    const s0 = spinUpHang();
    const r = tickLedgeHang(s0, makeInput({ release: 'getUp' }));
    expect(r.state.name).toBe('climbing');
    expect(r.state.active).not.toBeNull();
    expect(r.state.active?.framesElapsed).toBe(0);
    expect(r.released).toBe('getUp');
  });

  it('release outside hanging is a no-op (idle stays idle)', () => {
    const r = tickLedgeHang(createLedgeHangState(), makeInput({ release: 'jump' }));
    expect(r.state.name).toBe('idle');
    expect(r.released).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Climbing
// ---------------------------------------------------------------------------

describe('climbing tick', () => {
  it('plays for climbFrames before transitioning to cooldown', () => {
    const tuning = resolveLedgeHangTuning({ climbFrames: 4 });
    let s = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
      tuning,
    ).state;
    s = tickLedgeHang(s, makeInput({ release: 'getUp' }), tuning).state;
    expect(s.name).toBe('climbing');
    s = advanceFrames(s, 4, () => makeInput(), tuning);
    expect(s.name).toBe('cooldown');
  });

  it('isClimbingFromLedge reads the climb state', () => {
    let s = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
    ).state;
    s = tickLedgeHang(s, makeInput({ release: 'getUp' })).state;
    expect(isClimbingFromLedge(s)).toBe(true);
    expect(isLedgeLockingInput(s)).toBe(true);
  });

  it('does NOT have i-frames during the climb', () => {
    let s = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
    ).state;
    s = tickLedgeHang(s, makeInput({ release: 'getUp' })).state;
    expect(s.hangIframesRemaining).toBe(0);
    expect(isLedgeHangInvincible(s)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cooldown (tether timing)
// ---------------------------------------------------------------------------

describe('cooldown (tether re-grab timing)', () => {
  it('drains over tetherCooldownFrames and returns to idle', () => {
    const tuning = resolveLedgeHangTuning({ tetherCooldownFrames: 4 });
    // Spin up a hang and drop it.
    let s = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
      tuning,
    ).state;
    s = tickLedgeHang(s, makeInput({ release: 'dropDown' }), tuning).state;
    expect(s.name).toBe('cooldown');
    expect(s.cooldownRemaining).toBe(4);
    s = advanceFrames(s, 4, () => makeInput(), tuning);
    expect(s.name).toBe('idle');
    expect(s.cooldownRemaining).toBe(0);
  });

  it('rejects fresh detection while cooldown is active', () => {
    const tuning = resolveLedgeHangTuning({ tetherCooldownFrames: 5 });
    let s = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
      tuning,
    ).state;
    s = tickLedgeHang(s, makeInput({ release: 'dropDown' }), tuning).state;
    expect(s.name).toBe('cooldown');
    // Try to grab again — cooldown rejects.
    s = tickLedgeHang(s, makeInput({ detection: makeDetection() }), tuning).state;
    expect(s.name).toBe('cooldown');
    expect(s.cooldownRemaining).toBe(4); // drained one frame
  });

  it('isLedgeTetherCooldown reads `cooldownRemaining > 0`', () => {
    let s = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
    ).state;
    s = tickLedgeHang(s, makeInput({ release: 'jump' })).state;
    expect(isLedgeTetherCooldown(s)).toBe(true);
  });

  it('skips cooldown when tetherCooldownFrames === 0', () => {
    const tuning = resolveLedgeHangTuning({ tetherCooldownFrames: 0 });
    let s = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
      tuning,
    ).state;
    s = tickLedgeHang(s, makeInput({ release: 'jump' }), tuning).state;
    expect(s.name).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Force release
// ---------------------------------------------------------------------------

describe('force release', () => {
  it('drops a hanging fighter immediately into cooldown with no released action', () => {
    const s0 = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
    ).state;
    const r = tickLedgeHang(s0, makeInput({ forceRelease: true }));
    expect(r.state.name).toBe('cooldown');
    expect(r.released).toBeNull();
  });

  it('drops a climbing fighter into cooldown', () => {
    let s = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
    ).state;
    s = tickLedgeHang(s, makeInput({ release: 'getUp' })).state;
    expect(s.name).toBe('climbing');
    const r = tickLedgeHang(s, makeInput({ forceRelease: true }));
    expect(r.state.name).toBe('cooldown');
  });

  it('forceRelease while idle is a no-op', () => {
    const r = tickLedgeHang(createLedgeHangState(), makeInput({ forceRelease: true }));
    expect(r.state.name).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// isLedgeLockingInput
// ---------------------------------------------------------------------------

describe('isLedgeLockingInput', () => {
  it('locks during hanging', () => {
    const s = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
    ).state;
    expect(isLedgeLockingInput(s)).toBe(true);
  });

  it('locks during climbing', () => {
    let s = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
    ).state;
    s = tickLedgeHang(s, makeInput({ release: 'getUp' })).state;
    expect(isLedgeLockingInput(s)).toBe(true);
  });

  it('does NOT lock during cooldown — movement / attacks free again', () => {
    let s = tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
    ).state;
    s = tickLedgeHang(s, makeInput({ release: 'jump' })).state;
    expect(s.name).toBe('cooldown');
    expect(isLedgeLockingInput(s)).toBe(false);
  });

  it('does NOT lock during idle', () => {
    expect(isLedgeLockingInput(createLedgeHangState())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

describe('resolveLedgeHangTuning', () => {
  it('returns defaults when overrides is undefined', () => {
    const t = resolveLedgeHangTuning();
    expect(t).toBe(LEDGE_HANG_DEFAULTS);
  });

  it('merges partial overrides', () => {
    const t = resolveLedgeHangTuning({ climbFrames: 60 });
    expect(t.climbFrames).toBe(60);
    expect(t.tetherCooldownFrames).toBe(LEDGE_HANG_DEFAULTS.tetherCooldownFrames);
  });

  it('clamps negative values to 0', () => {
    const t = resolveLedgeHangTuning({
      climbFrames: -5,
      tetherCooldownFrames: -10,
      dropDownClearance: -20,
    });
    expect(t.climbFrames).toBe(0);
    expect(t.tetherCooldownFrames).toBe(0);
    expect(t.dropDownClearance).toBe(0);
  });

  it('returns frozen records', () => {
    expect(Object.isFrozen(resolveLedgeHangTuning({ climbFrames: 10 }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('identical input streams produce identical state trajectories', () => {
    const inputs: LedgeHangInput[] = [
      makeInput({ detection: makeDetection() }),
      makeInput(),
      makeInput(),
      makeInput({ release: 'getUp' }),
      makeInput(),
      makeInput(),
    ];
    const runA: string[] = [];
    const runB: string[] = [];
    let sA = createLedgeHangState();
    let sB = createLedgeHangState();
    for (const inp of inputs) {
      sA = tickLedgeHang(sA, inp).state;
      sB = tickLedgeHang(sB, inp).state;
      runA.push(sA.name);
      runB.push(sB.name);
    }
    expect(runA).toEqual(runB);
  });

  it('full hang lifecycle: idle → hanging → climbing → cooldown → idle', () => {
    const tuning = resolveLedgeHangTuning({
      hangIframeFrames: 2,
      climbFrames: 3,
      tetherCooldownFrames: 2,
    });
    let s = createLedgeHangState();
    expect(s.name).toBe('idle');

    // Latch.
    s = tickLedgeHang(s, makeInput({ detection: makeDetection() }), tuning).state;
    expect(s.name).toBe('hanging');

    // Choose getUp on the next frame.
    s = tickLedgeHang(s, makeInput({ release: 'getUp' }), tuning).state;
    expect(s.name).toBe('climbing');

    // Climb 3 frames.
    s = advanceFrames(s, 3, () => makeInput(), tuning);
    expect(s.name).toBe('cooldown');

    // Cool down 2 frames.
    s = advanceFrames(s, 2, () => makeInput(), tuning);
    expect(s.name).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// AC 60404 Sub-AC 4 — Ledge options i-frames + recovery
// ---------------------------------------------------------------------------

describe('AC 60404 Sub-AC 4 — ledge option i-frame defaults', () => {
  it('exposes per-option i-frame and recovery tuning defaults', () => {
    expect(LEDGE_HANG_DEFAULTS.rollFrames).toBe(36);
    expect(LEDGE_HANG_DEFAULTS.rollIframes).toBe(24);
    expect(LEDGE_HANG_DEFAULTS.attackIframes).toBe(16);
    expect(LEDGE_HANG_DEFAULTS.jumpIframes).toBe(8);
    // canonical Smash: getup recovery is NOT invulnerable.
    expect(LEDGE_HANG_DEFAULTS.getupIframes).toBe(0);
    expect(LEDGE_HANG_DEFAULTS.rollDistance).toBe(96);
  });

  it('clamps negative per-option tuning values to 0', () => {
    const t = resolveLedgeHangTuning({
      rollFrames: -5,
      rollIframes: -7,
      attackIframes: -3,
      jumpIframes: -1,
      getupIframes: -2,
      rollDistance: -50,
    });
    expect(t.rollFrames).toBe(0);
    expect(t.rollIframes).toBe(0);
    expect(t.attackIframes).toBe(0);
    expect(t.jumpIframes).toBe(0);
    expect(t.getupIframes).toBe(0);
    expect(t.rollDistance).toBe(0);
  });

  it('merges partial per-option overrides with defaults', () => {
    const t = resolveLedgeHangTuning({ rollIframes: 99 });
    expect(t.rollIframes).toBe(99);
    expect(t.attackIframes).toBe(LEDGE_HANG_DEFAULTS.attackIframes);
    expect(t.jumpIframes).toBe(LEDGE_HANG_DEFAULTS.jumpIframes);
  });
});

describe('AC 60404 Sub-AC 4 — ledge-roll release', () => {
  function spinUpHang(tuning = LEDGE_HANG_DEFAULTS): LedgeHangState {
    return tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
      tuning,
    ).state;
  }

  it('roll release transitions hanging → rolling and emits released=roll', () => {
    const s0 = spinUpHang();
    const r = tickLedgeHang(s0, makeInput({ release: 'roll' }));
    expect(r.state.name).toBe('rolling');
    expect(r.state.active).not.toBeNull();
    expect(r.released).toBe('roll');
  });

  it('arms i-frames for the full rollIframes budget', () => {
    const tuning = resolveLedgeHangTuning({ rollIframes: 12, rollFrames: 36 });
    let s = spinUpHang(tuning);
    s = tickLedgeHang(s, makeInput({ release: 'roll' }), tuning).state;
    expect(s.hangIframesRemaining).toBe(12);
    expect(isLedgeHangInvincible(s)).toBe(true);
  });

  it('drains roll i-frames frame-by-frame across the recovery', () => {
    const tuning = resolveLedgeHangTuning({ rollIframes: 5, rollFrames: 20 });
    let s = spinUpHang(tuning);
    s = tickLedgeHang(s, makeInput({ release: 'roll' }), tuning).state;
    expect(s.hangIframesRemaining).toBe(5);
    for (let i = 0; i < 5; i += 1) {
      s = tickLedgeHang(s, makeInput(), tuning).state;
    }
    expect(s.hangIframesRemaining).toBe(0);
    // Still rolling — i-frames ended but recovery continues.
    expect(s.name).toBe('rolling');
    expect(isLedgeHangInvincible(s)).toBe(false);
  });

  it('plays for rollFrames before transitioning to cooldown', () => {
    const tuning = resolveLedgeHangTuning({ rollFrames: 4, rollIframes: 0 });
    let s = spinUpHang(tuning);
    s = tickLedgeHang(s, makeInput({ release: 'roll' }), tuning).state;
    expect(s.name).toBe('rolling');
    s = advanceFrames(s, 4, () => makeInput(), tuning);
    expect(s.name).toBe('cooldown');
  });

  it('isLedgeRolling reads the rolling state', () => {
    const s0 = spinUpHang();
    const s = tickLedgeHang(s0, makeInput({ release: 'roll' })).state;
    expect(isLedgeRolling(s)).toBe(true);
    expect(isLedgeLockingInput(s)).toBe(true);
    expect(isClimbingFromLedge(s)).toBe(false);
    expect(isHangingOnLedge(s)).toBe(false);
  });

  it('forceRelease drops a rolling fighter into cooldown', () => {
    const s0 = spinUpHang();
    const s1 = tickLedgeHang(s0, makeInput({ release: 'roll' })).state;
    expect(s1.name).toBe('rolling');
    const r = tickLedgeHang(s1, makeInput({ forceRelease: true }));
    expect(r.state.name).toBe('cooldown');
    expect(r.released).toBeNull();
  });
});

describe('AC 60404 Sub-AC 4 — ledge-jump release i-frames', () => {
  function spinUpHang(tuning = LEDGE_HANG_DEFAULTS): LedgeHangState {
    return tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
      tuning,
    ).state;
  }

  it('seeds hangIframesRemaining with jumpIframes on jump release', () => {
    const tuning = resolveLedgeHangTuning({ jumpIframes: 10 });
    const s0 = spinUpHang(tuning);
    const r = tickLedgeHang(s0, makeInput({ release: 'jump' }), tuning);
    expect(r.state.name).toBe('cooldown');
    expect(r.state.hangIframesRemaining).toBe(10);
    expect(isLedgeHangInvincible(r.state)).toBe(true);
  });

  it('drains jump i-frames over the cooldown phase', () => {
    const tuning = resolveLedgeHangTuning({
      jumpIframes: 3,
      tetherCooldownFrames: 10,
    });
    let s = spinUpHang(tuning);
    s = tickLedgeHang(s, makeInput({ release: 'jump' }), tuning).state;
    expect(s.hangIframesRemaining).toBe(3);
    s = tickLedgeHang(s, makeInput(), tuning).state;
    expect(s.hangIframesRemaining).toBe(2);
    s = tickLedgeHang(s, makeInput(), tuning).state;
    expect(s.hangIframesRemaining).toBe(1);
    s = tickLedgeHang(s, makeInput(), tuning).state;
    expect(s.hangIframesRemaining).toBe(0);
    expect(s.name).toBe('cooldown'); // cooldown still has frames left
  });

  it('jumpIframes=0 leaves cooldown with no i-frame protection', () => {
    const tuning = resolveLedgeHangTuning({ jumpIframes: 0 });
    const s0 = spinUpHang(tuning);
    const r = tickLedgeHang(s0, makeInput({ release: 'jump' }), tuning);
    expect(r.state.hangIframesRemaining).toBe(0);
    expect(isLedgeHangInvincible(r.state)).toBe(false);
  });
});

describe('AC 60404 Sub-AC 4 — ledge-attack release i-frames', () => {
  function spinUpHang(tuning = LEDGE_HANG_DEFAULTS): LedgeHangState {
    return tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
      tuning,
    ).state;
  }

  it('seeds hangIframesRemaining with attackIframes on attack release', () => {
    const tuning = resolveLedgeHangTuning({ attackIframes: 14 });
    const s0 = spinUpHang(tuning);
    const r = tickLedgeHang(s0, makeInput({ release: 'attack' }), tuning);
    expect(r.state.name).toBe('cooldown');
    expect(r.state.hangIframesRemaining).toBe(14);
    expect(isLedgeHangInvincible(r.state)).toBe(true);
  });

  it('attackIframes=0 leaves the attack release vulnerable', () => {
    const tuning = resolveLedgeHangTuning({ attackIframes: 0 });
    const s0 = spinUpHang(tuning);
    const r = tickLedgeHang(s0, makeInput({ release: 'attack' }), tuning);
    expect(r.state.hangIframesRemaining).toBe(0);
    expect(isLedgeHangInvincible(r.state)).toBe(false);
  });
});

describe('AC 60404 Sub-AC 4 — ledge-getup recovery + i-frames', () => {
  function spinUpHang(tuning = LEDGE_HANG_DEFAULTS): LedgeHangState {
    return tickLedgeHang(
      createLedgeHangState(),
      makeInput({ detection: makeDetection() }),
      tuning,
    ).state;
  }

  it('default getupIframes=0 keeps the climb canonically vulnerable', () => {
    const s0 = spinUpHang();
    const s1 = tickLedgeHang(s0, makeInput({ release: 'getUp' })).state;
    expect(s1.name).toBe('climbing');
    expect(s1.hangIframesRemaining).toBe(0);
    expect(isLedgeHangInvincible(s1)).toBe(false);
  });

  it('getupIframes override grants invuln during climb recovery', () => {
    const tuning = resolveLedgeHangTuning({
      climbFrames: 10,
      getupIframes: 4,
    });
    const s0 = spinUpHang(tuning);
    let s = tickLedgeHang(s0, makeInput({ release: 'getUp' }), tuning).state;
    expect(s.name).toBe('climbing');
    expect(s.hangIframesRemaining).toBe(4);
    expect(isLedgeHangInvincible(s)).toBe(true);
    // Drains over the climb.
    for (let i = 0; i < 4; i += 1) {
      s = tickLedgeHang(s, makeInput(), tuning).state;
    }
    expect(s.hangIframesRemaining).toBe(0);
    expect(s.name).toBe('climbing'); // climb continues past the i-frame window
  });

  it('climb recovery still completes after climbFrames regardless of i-frames', () => {
    const tuning = resolveLedgeHangTuning({
      climbFrames: 3,
      getupIframes: 0,
      tetherCooldownFrames: 2,
    });
    const s0 = spinUpHang(tuning);
    let s = tickLedgeHang(s0, makeInput({ release: 'getUp' }), tuning).state;
    s = advanceFrames(s, 3, () => makeInput(), tuning);
    expect(s.name).toBe('cooldown');
  });
});

describe('AC 60404 Sub-AC 4 — full ledge-roll lifecycle', () => {
  it('idle → hanging → rolling → cooldown → idle', () => {
    const tuning = resolveLedgeHangTuning({
      hangIframeFrames: 2,
      rollFrames: 5,
      rollIframes: 3,
      tetherCooldownFrames: 2,
    });
    let s = createLedgeHangState();
    s = tickLedgeHang(s, makeInput({ detection: makeDetection() }), tuning).state;
    expect(s.name).toBe('hanging');
    s = tickLedgeHang(s, makeInput({ release: 'roll' }), tuning).state;
    expect(s.name).toBe('rolling');
    expect(s.hangIframesRemaining).toBe(3);
    s = advanceFrames(s, 5, () => makeInput(), tuning);
    expect(s.name).toBe('cooldown');
    s = advanceFrames(s, 2, () => makeInput(), tuning);
    expect(s.name).toBe('idle');
  });

  it('reset clears a rolling state to idle', () => {
    const tuning = resolveLedgeHangTuning({ rollFrames: 30 });
    let s = createLedgeHangState();
    s = tickLedgeHang(s, makeInput({ detection: makeDetection() }), tuning).state;
    s = tickLedgeHang(s, makeInput({ release: 'roll' }), tuning).state;
    expect(s.name).toBe('rolling');
    const r = resetLedgeHangState();
    expect(r.name).toBe('idle');
    expect(r.active).toBeNull();
  });
});

describe('AC 60404 Sub-AC 4 — determinism across all options', () => {
  it('ledge-roll trajectory is deterministic across two runs', () => {
    const tuning = resolveLedgeHangTuning({
      rollFrames: 4,
      rollIframes: 2,
      tetherCooldownFrames: 2,
    });
    const inputs: LedgeHangInput[] = [
      makeInput({ detection: makeDetection() }),
      makeInput({ release: 'roll' }),
      makeInput(),
      makeInput(),
      makeInput(),
      makeInput(),
      makeInput(),
      makeInput(),
    ];
    const traceA: string[] = [];
    const traceB: string[] = [];
    let sA = createLedgeHangState();
    let sB = createLedgeHangState();
    for (const inp of inputs) {
      sA = tickLedgeHang(sA, inp, tuning).state;
      sB = tickLedgeHang(sB, inp, tuning).state;
      traceA.push(`${sA.name}:${sA.hangIframesRemaining}`);
      traceB.push(`${sB.name}:${sB.hangIframesRemaining}`);
    }
    expect(traceA).toEqual(traceB);
  });

  it('all four options produce distinct released outcomes from the same hang', () => {
    const seen = new Set<string>();
    for (const action of ['getUp', 'roll', 'jump', 'attack'] as const) {
      const s0 = tickLedgeHang(
        createLedgeHangState(),
        makeInput({ detection: makeDetection() }),
      ).state;
      const r = tickLedgeHang(s0, makeInput({ release: action }));
      expect(r.released).toBe(action);
      seen.add(action);
    }
    expect(seen.size).toBe(4);
  });
});

describe('resolveLedgeTrumps — Ultimate ledge-occupancy (trump)', () => {
  it('a FRESH grab on an occupied ledge trumps the prior occupant', () => {
    expect(
      resolveLedgeTrumps([
        { id: 0, wasHanging: true, wasKey: 'p1:right', nowHanging: true, nowKey: 'p1:right' },
        { id: 1, wasHanging: false, wasKey: null, nowHanging: true, nowKey: 'p1:right' },
      ]),
    ).toEqual([0]);
  });

  it('no trump when nobody just grabbed (both already hanging)', () => {
    expect(
      resolveLedgeTrumps([
        { id: 0, wasHanging: true, wasKey: 'p1:right', nowHanging: true, nowKey: 'p1:right' },
        { id: 1, wasHanging: true, wasKey: 'p1:left', nowHanging: true, nowKey: 'p1:left' },
      ]),
    ).toEqual([]);
  });

  it('no trump when the fresh grab is on a DIFFERENT ledge', () => {
    expect(
      resolveLedgeTrumps([
        { id: 0, wasHanging: true, wasKey: 'p1:right', nowHanging: true, nowKey: 'p1:right' },
        { id: 1, wasHanging: false, wasKey: null, nowHanging: true, nowKey: 'p1:left' },
      ]),
    ).toEqual([]);
  });

  it('a simultaneous double-grab trumps no-one', () => {
    expect(
      resolveLedgeTrumps([
        { id: 0, wasHanging: false, wasKey: null, nowHanging: true, nowKey: 'p1:right' },
        { id: 1, wasHanging: false, wasKey: null, nowHanging: true, nowKey: 'p1:right' },
      ]),
    ).toEqual([]);
  });
});
