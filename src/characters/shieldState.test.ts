import { describe, it, expect } from 'vitest';
import {
  SHIELD_DEFAULTS,
  applyShieldHit,
  createShieldState,
  getShieldHoldStunRemaining,
  getShieldStunRemaining,
  isInShieldstun,
  isShieldBroken,
  isShieldRaised,
  resetShieldState,
  resolveShieldTuning,
  tickShield,
  type ShieldState,
  type ShieldTuning,
} from './shieldState';
import { SHIELDSTUN_MAX_FRAMES, SHIELDSTUN_MIN_FRAMES } from './combat';

/**
 * AC 60301 Sub-AC 1 — Shield mechanic with shield health,
 * regeneration, and shield-break stun state.
 *
 * The shield state machine lives in `shieldState.ts` as pure
 * functions; the runtime `Character` wires them into the per-frame
 * tick. These tests lock down the pure-function half:
 *
 *   1. Initial state — full HP, idle, no stun.
 *   2. Raise / lower transitions on `held`.
 *   3. Decay while active.
 *   4. Regen while idle, after the regen-delay grace.
 *   5. Hit absorption while active — damage subtracted from health.
 *   6. Shield break (decay-to-zero AND hit-to-zero), stun timer drains,
 *      transitions back to idle with `postBreakHealth`.
 *   7. Determinism — identical inputs ⇒ identical state across many
 *      runs.
 */

// ---------------------------------------------------------------------------
// Construction & queries
// ---------------------------------------------------------------------------

describe('shieldState — construction', () => {
  it('starts idle, full health, no stun, regen clock ready', () => {
    const s = createShieldState();
    expect(s.name).toBe('idle');
    expect(s.health).toBe(SHIELD_DEFAULTS.maxHealth);
    expect(s.stunRemaining).toBe(0);
    // Regen clock is pre-armed past the threshold so an initial press
    // followed by quick release doesn't prevent the next tick's regen.
    expect(s.framesSinceLastDamage).toBe(SHIELD_DEFAULTS.regenDelayFrames);
  });

  it('honours tuning overrides via createShieldState', () => {
    const tuning = resolveShieldTuning({ maxHealth: 100 });
    const s = createShieldState(tuning);
    expect(s.health).toBe(100);
  });

  it('resolveShieldTuning fills every default when overrides absent', () => {
    const t = resolveShieldTuning();
    expect(t).toEqual(SHIELD_DEFAULTS);
  });

  it('resolveShieldTuning keeps unrelated defaults when one field set', () => {
    const t = resolveShieldTuning({ breakStunFrames: 60 });
    expect(t.breakStunFrames).toBe(60);
    expect(t.maxHealth).toBe(SHIELD_DEFAULTS.maxHealth);
    expect(t.regenPerFrame).toBe(SHIELD_DEFAULTS.regenPerFrame);
  });

  it('isShieldRaised / isShieldBroken / getShieldStunRemaining match the state name', () => {
    const idle: ShieldState = createShieldState();
    expect(isShieldRaised(idle)).toBe(false);
    expect(isShieldBroken(idle)).toBe(false);
    expect(getShieldStunRemaining(idle)).toBe(0);

    const active: ShieldState = tickShield(idle, { held: true });
    expect(isShieldRaised(active)).toBe(true);
    expect(isShieldBroken(active)).toBe(false);
    expect(getShieldStunRemaining(active)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Raise / lower transitions
// ---------------------------------------------------------------------------

describe('shieldState — raise / lower transitions', () => {
  it('idle + held=true → active (health unchanged on the raise frame)', () => {
    const s0 = createShieldState();
    const s1 = tickShield(s0, { held: true });
    expect(s1.name).toBe('active');
    // Decay applied this same frame because the raise transition flips
    // first then runs through the active-tick decay branch.
    expect(s1.health).toBe(SHIELD_DEFAULTS.maxHealth - SHIELD_DEFAULTS.decayPerFrame);
  });

  it('active + held=false → idle (no further decay this frame)', () => {
    const active = tickShield(createShieldState(), { held: true });
    const idle = tickShield(active, { held: false });
    expect(idle.name).toBe('idle');
    // Health should NOT drop further on the release frame (no decay
    // tick fires because `nextName === 'idle'`).
    expect(idle.health).toBe(active.health);
  });

  it('held while already idle (no transition required) — regen progresses', () => {
    let s = createShieldState();
    // Drop health a bit by raising and lowering once.
    s = tickShield(s, { held: true });
    s = tickShield(s, { held: false });
    const baseline = s.health;
    // Now ride out enough idle frames for regen to kick in.
    for (let i = 0; i < SHIELD_DEFAULTS.regenDelayFrames + 5; i += 1) {
      s = tickShield(s, { held: false });
    }
    expect(s.health).toBeGreaterThan(baseline);
  });

  it('refuses to raise from idle when health is below minHealthToRaise', () => {
    const tuning = resolveShieldTuning({
      maxHealth: 5,
      minHealthToRaise: 10,
    });
    const s = createShieldState(tuning);
    const next = tickShield(s, { held: true }, tuning);
    expect(next.name).toBe('idle');
    // No decay either — we never entered active.
    expect(next.health).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Decay while active
// ---------------------------------------------------------------------------

describe('shieldState — active decay', () => {
  it('drains health by decayPerFrame each held frame', () => {
    let s = createShieldState();
    const start = s.health;
    for (let i = 0; i < 10; i += 1) {
      s = tickShield(s, { held: true });
    }
    expect(s.name).toBe('active');
    expect(s.health).toBeCloseTo(start - SHIELD_DEFAULTS.decayPerFrame * 10, 6);
  });

  it('breaks when decay drains the last HP', () => {
    const tuning = resolveShieldTuning({
      maxHealth: 1,
      decayPerFrame: 1,
      breakStunFrames: 30,
    });
    let s = createShieldState(tuning);
    s = tickShield(s, { held: true }, tuning);
    expect(s.name).toBe('broken');
    expect(s.health).toBe(0);
    expect(s.stunRemaining).toBe(30);
  });

  it('held throughout decay-to-break never enters a negative-health state', () => {
    // Use a fractional decay that wouldn't divide evenly — make sure
    // the clamp at zero holds across many ticks (which span break,
    // stun-drain, idle-regen, and re-raise cycles).
    const tuning = resolveShieldTuning({
      maxHealth: 1,
      decayPerFrame: 0.3,
      breakStunFrames: 5,
      postBreakHealth: 1,
    });
    let s = createShieldState(tuning);
    let sawBroken = false;
    for (let i = 0; i < 60; i += 1) {
      s = tickShield(s, { held: true }, tuning);
      expect(s.health).toBeGreaterThanOrEqual(0);
      if (s.name === 'broken') sawBroken = true;
    }
    expect(sawBroken).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regen while idle
// ---------------------------------------------------------------------------

describe('shieldState — idle regen', () => {
  it('does not regen during the regen-delay grace window', () => {
    let s = createShieldState();
    s = tickShield(s, { held: true }); // drain a bit
    s = tickShield(s, { held: false }); // release — sinceDamage is now 1
    const baseline = s.health;
    // Within the delay window the regen gate hasn't opened yet — health
    // should hold steady. The release tick already advanced sinceDamage
    // by 1, so we have `regenDelayFrames - 2` further idle ticks before
    // sinceDamage hits the threshold and regen fires.
    for (let i = 0; i < SHIELD_DEFAULTS.regenDelayFrames - 2; i += 1) {
      s = tickShield(s, { held: false });
      expect(s.health).toBe(baseline);
    }
  });

  it('regenerates once the delay window clears', () => {
    let s = createShieldState();
    // Drain to 80% of max to leave room for regen.
    const drainTarget = SHIELD_DEFAULTS.maxHealth * 0.8;
    while (s.name !== 'active' || s.health > drainTarget) {
      s = tickShield(s, { held: true });
    }
    s = tickShield(s, { held: false }); // release
    const baseline = s.health;
    // Run past the delay window plus a few regen ticks.
    for (let i = 0; i < SHIELD_DEFAULTS.regenDelayFrames + 5; i += 1) {
      s = tickShield(s, { held: false });
    }
    expect(s.health).toBeGreaterThan(baseline);
  });

  it('caps regen at maxHealth — never overflows', () => {
    // A fresh shield is already at max; regen should hold steady.
    let s = createShieldState();
    for (let i = 0; i < 1000; i += 1) {
      s = tickShield(s, { held: false });
    }
    expect(s.health).toBe(SHIELD_DEFAULTS.maxHealth);
  });

  it('regen resumes from where it stopped after a re-raise', () => {
    let s = createShieldState();
    // Drain.
    for (let i = 0; i < 50; i += 1) {
      s = tickShield(s, { held: true });
    }
    expect(s.name).toBe('active');
    s = tickShield(s, { held: false }); // release
    const justAfterRelease = s.health;
    // Wait through delay + 30 frames of regen.
    for (let i = 0; i < SHIELD_DEFAULTS.regenDelayFrames + 30; i += 1) {
      s = tickShield(s, { held: false });
    }
    expect(s.health).toBeGreaterThan(justAfterRelease);
    // Re-raise — health should resume from its current value.
    const afterRegen = s.health;
    s = tickShield(s, { held: true });
    expect(s.health).toBeCloseTo(afterRegen - SHIELD_DEFAULTS.decayPerFrame, 6);
  });
});

// ---------------------------------------------------------------------------
// applyShieldHit
// ---------------------------------------------------------------------------

describe('shieldState — applyShieldHit', () => {
  it('absorbs damage when shield is active and reduces health', () => {
    const active = tickShield(createShieldState(), { held: true });
    const r = applyShieldHit(active, 12);
    expect(r.absorbed).toBe(true);
    expect(r.broke).toBe(false);
    expect(r.state.name).toBe('active');
    expect(r.state.health).toBeCloseTo(active.health - 12, 6);
    // framesSinceLastDamage resets to 0 on damage.
    expect(r.state.framesSinceLastDamage).toBe(0);
  });

  it('does NOT absorb when shield is idle (caller falls through)', () => {
    const idle = createShieldState();
    const r = applyShieldHit(idle, 12);
    expect(r.absorbed).toBe(false);
    expect(r.broke).toBe(false);
    expect(r.state).toBe(idle);
  });

  it('does NOT absorb when shield is broken (still in stun)', () => {
    // Force a break first.
    const tuning = resolveShieldTuning({
      maxHealth: 5,
      decayPerFrame: 0,
      breakStunFrames: 30,
    });
    let s = tickShield(createShieldState(tuning), { held: true }, tuning);
    s = applyShieldHit(s, 999, tuning).state; // forces break
    expect(s.name).toBe('broken');
    const r = applyShieldHit(s, 5, tuning);
    expect(r.absorbed).toBe(false);
    expect(r.state).toBe(s);
  });

  it('breaks the shield when damage drains health to zero or below', () => {
    const tuning = resolveShieldTuning({
      maxHealth: 10,
      breakStunFrames: 60,
    });
    const active = tickShield(createShieldState(tuning), { held: true }, tuning);
    const r = applyShieldHit(active, 999, tuning);
    expect(r.absorbed).toBe(true);
    expect(r.broke).toBe(true);
    expect(r.state.name).toBe('broken');
    expect(r.state.health).toBe(0);
    expect(r.state.stunRemaining).toBe(60);
  });

  it('coerces negative damage to 0 (defensive against bad tuning)', () => {
    const active = tickShield(createShieldState(), { held: true });
    const r = applyShieldHit(active, -5);
    expect(r.absorbed).toBe(true);
    expect(r.state.health).toBe(active.health);
  });
});

// ---------------------------------------------------------------------------
// Shield break stun lifecycle
// ---------------------------------------------------------------------------

describe('shieldState — break stun', () => {
  it('drains stunRemaining by 1 each tick', () => {
    const tuning = resolveShieldTuning({
      maxHealth: 1,
      decayPerFrame: 0,
      breakStunFrames: 5,
    });
    let s = tickShield(createShieldState(tuning), { held: true }, tuning);
    s = applyShieldHit(s, 999, tuning).state;
    expect(s.name).toBe('broken');
    expect(s.stunRemaining).toBe(5);
    for (let i = 1; i <= 4; i += 1) {
      s = tickShield(s, { held: false }, tuning);
      expect(s.name).toBe('broken');
      expect(s.stunRemaining).toBe(5 - i);
    }
    s = tickShield(s, { held: false }, tuning);
    expect(s.name).toBe('idle');
  });

  it('held shield button is ignored during stun (no transition to active)', () => {
    const tuning = resolveShieldTuning({
      maxHealth: 1,
      decayPerFrame: 0,
      breakStunFrames: 10,
    });
    let s = tickShield(createShieldState(tuning), { held: true }, tuning);
    s = applyShieldHit(s, 999, tuning).state;
    expect(s.name).toBe('broken');
    // Hammering the shield key during stun does nothing — the fighter
    // is helpless until the timer drains.
    for (let i = 0; i < 9; i += 1) {
      s = tickShield(s, { held: true }, tuning);
      expect(s.name).toBe('broken');
    }
  });

  it('returns to idle with postBreakHealth after stun ends', () => {
    const tuning = resolveShieldTuning({
      maxHealth: 50,
      decayPerFrame: 0,
      breakStunFrames: 3,
      postBreakHealth: 10,
    });
    let s = tickShield(createShieldState(tuning), { held: true }, tuning);
    s = applyShieldHit(s, 999, tuning).state;
    for (let i = 0; i < 3; i += 1) {
      s = tickShield(s, { held: false }, tuning);
    }
    expect(s.name).toBe('idle');
    expect(s.health).toBe(10);
    // Regen clock starts fresh (0) so regen has to wait the full delay.
    expect(s.framesSinceLastDamage).toBe(0);
  });

  it('caps postBreakHealth at maxHealth (defensive against bad tuning)', () => {
    const tuning = resolveShieldTuning({
      maxHealth: 5,
      decayPerFrame: 0,
      breakStunFrames: 1,
      postBreakHealth: 999, // absurd — should clamp
    });
    let s = tickShield(createShieldState(tuning), { held: true }, tuning);
    s = applyShieldHit(s, 999, tuning).state;
    s = tickShield(s, { held: false }, tuning);
    expect(s.name).toBe('idle');
    expect(s.health).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

describe('shieldState — resetShieldState', () => {
  it('restores a fresh full-health idle state', () => {
    let s = createShieldState();
    // Beat it up.
    for (let i = 0; i < 100; i += 1) s = tickShield(s, { held: true });
    s = applyShieldHit(s, 999).state;
    expect(s.name).toBe('broken');
    const fresh = resetShieldState();
    expect(fresh.name).toBe('idle');
    expect(fresh.health).toBe(SHIELD_DEFAULTS.maxHealth);
    expect(fresh.stunRemaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('shieldState — determinism', () => {
  it('identical input streams produce byte-equivalent state trajectories', () => {
    // Pseudo-random stream of held / released values from a deterministic
    // seed (NOT Math.random — we hand-craft a pattern).
    const heldStream: boolean[] = [];
    for (let i = 0; i < 600; i += 1) {
      heldStream.push((i % 13) < 5);
    }
    const tuning = resolveShieldTuning({ breakStunFrames: 12 });
    const runOnce = (): ShieldState[] => {
      let s = createShieldState(tuning);
      const trace: ShieldState[] = [s];
      for (const held of heldStream) {
        s = tickShield(s, { held }, tuning);
        trace.push(s);
      }
      return trace;
    };
    const a = runOnce();
    const b = runOnce();
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i += 1) {
      expect(b[i]!.name).toBe(a[i]!.name);
      expect(b[i]!.health).toBe(a[i]!.health);
      expect(b[i]!.stunRemaining).toBe(a[i]!.stunRemaining);
      expect(b[i]!.framesSinceLastDamage).toBe(a[i]!.framesSinceLastDamage);
    }
  });

  it('hits applied at the same frames produce identical breaks', () => {
    const tuning = resolveShieldTuning({ maxHealth: 30, breakStunFrames: 60 });
    const runWithHit = (): ShieldState => {
      let s = createShieldState(tuning);
      for (let i = 0; i < 5; i += 1) s = tickShield(s, { held: true }, tuning);
      s = applyShieldHit(s, 25, tuning).state;
      // Continue holding — should drain remaining ~5 HP and break.
      for (let i = 0; i < 100; i += 1) s = tickShield(s, { held: true }, tuning);
      return s;
    };
    const a = runWithHit();
    const b = runWithHit();
    expect(a.name).toBe(b.name);
    expect(a.health).toBe(b.health);
    expect(a.stunRemaining).toBe(b.stunRemaining);
  });
});

// ---------------------------------------------------------------------------
// Type ergonomics — make sure the tuning shape is partial-friendly
// ---------------------------------------------------------------------------

describe('shieldState — tuning shape', () => {
  it('accepts an empty partial', () => {
    const overrides: ShieldTuning = {};
    const t = resolveShieldTuning(overrides);
    expect(t).toEqual(SHIELD_DEFAULTS);
  });

  it('accepts a single-field partial', () => {
    const overrides: ShieldTuning = { regenPerFrame: 1 };
    const t = resolveShieldTuning(overrides);
    expect(t.regenPerFrame).toBe(1);
    expect(t.decayPerFrame).toBe(SHIELD_DEFAULTS.decayPerFrame);
  });
});

// ---------------------------------------------------------------------------
// Shieldstun (post-block hold-stun) — post-M2 hit-feel addition
// ---------------------------------------------------------------------------

describe('shieldState — shieldstun on block', () => {
  it('initial state has zero blockStunRemaining', () => {
    const s = createShieldState();
    expect(s.blockStunRemaining).toBe(0);
    expect(getShieldHoldStunRemaining(s)).toBe(0);
    expect(isInShieldstun(s)).toBe(false);
  });

  it('arms blockStunRemaining when an active shield absorbs a hit', () => {
    let s = createShieldState();
    s = tickShield(s, { held: true }); // raise
    const result = applyShieldHit(s, 10);
    expect(result.absorbed).toBe(true);
    expect(result.broke).toBe(false);
    expect(result.state.blockStunRemaining).toBeGreaterThanOrEqual(SHIELDSTUN_MIN_FRAMES);
    expect(result.state.blockStunRemaining).toBeLessThanOrEqual(SHIELDSTUN_MAX_FRAMES);
    expect(isInShieldstun(result.state)).toBe(true);
  });

  it('drains blockStunRemaining each tick while shield is held', () => {
    let s = createShieldState();
    s = tickShield(s, { held: true });
    s = applyShieldHit(s, 10).state;
    const initial = s.blockStunRemaining;
    expect(initial).toBeGreaterThan(0);
    s = tickShield(s, { held: true });
    expect(s.blockStunRemaining).toBe(initial - 1);
  });

  it('ignores release while shieldstun is non-zero (shield stays active)', () => {
    let s = createShieldState();
    s = tickShield(s, { held: true });
    s = applyShieldHit(s, 10).state;
    // Player tries to release — should be locked in shield until stun drains.
    s = tickShield(s, { held: false });
    expect(s.name).toBe('active');
  });

  it('allows release once shieldstun drains', () => {
    let s = createShieldState();
    s = tickShield(s, { held: true });
    s = applyShieldHit(s, 10).state;
    // Drain by holding, then release.
    while (s.blockStunRemaining > 0) {
      s = tickShield(s, { held: true });
    }
    s = tickShield(s, { held: false });
    expect(s.name).toBe('idle');
  });

  it('stacks additional shieldstun on a second block, capped at SHIELDSTUN_MAX_FRAMES', () => {
    let s = createShieldState();
    s = tickShield(s, { held: true });
    s = applyShieldHit(s, 10).state;
    const afterFirst = s.blockStunRemaining;
    s = applyShieldHit(s, 10).state;
    // After the second block, shieldstun is greater than after the
    // first (stacked), but never exceeds the cap.
    expect(s.blockStunRemaining).toBeGreaterThanOrEqual(afterFirst);
    expect(s.blockStunRemaining).toBeLessThanOrEqual(SHIELDSTUN_MAX_FRAMES);
  });

  it('idle and broken states never carry blockStunRemaining', () => {
    const idle = createShieldState();
    expect(idle.blockStunRemaining).toBe(0);
    // Force a break by applying massive damage.
    let s = createShieldState();
    s = tickShield(s, { held: true });
    s = applyShieldHit(s, 999).state;
    expect(s.name).toBe('broken');
    expect(s.blockStunRemaining).toBe(0);
  });

  it('shieldstun is deterministic across repeated runs', () => {
    const runOnce = (): ShieldState => {
      let s = createShieldState();
      s = tickShield(s, { held: true });
      s = applyShieldHit(s, 7).state;
      for (let i = 0; i < 5; i += 1) s = tickShield(s, { held: true });
      return s;
    };
    const a = runOnce();
    const b = runOnce();
    expect(a.blockStunRemaining).toBe(b.blockStunRemaining);
    expect(a.name).toBe(b.name);
    expect(a.health).toBe(b.health);
  });
});
