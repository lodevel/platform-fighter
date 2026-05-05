import { describe, it, expect } from 'vitest';
import {
  CrumblingPlatform,
  CRUMBLE_DEFAULTS,
  type CrumblingPlatformOptions,
} from './CrumblingPlatform';

/**
 * Sub-AC 1 of AC 10 — timer-based crumbling platform entity.
 *
 * What this suite locks down:
 *
 *   1. Construction validates geometry and lifecycle delays so callers
 *      can't author an unphysical or undriveable platform.
 *   2. The lifecycle state machine fires transitions at the *exact*
 *      configured frame — `triggerDelay`, `fallDuration`, `respawnDelay`.
 *   3. Solidity (`isSolid`) flips off precisely at the
 *      `triggered → falling` boundary; the platform stays solid
 *      throughout the warning window.
 *   4. `onSteppedOn()` is idempotent during the warning window —
 *      repeated calls neither restart nor cancel the countdown, which
 *      is what makes the timer deterministic regardless of how many
 *      fighters bounce on it.
 *   5. The full lifecycle wraps cleanly: `intact → triggered → falling
 *      → gone → intact` with no off-by-one drift across many cycles.
 *   6. Render hints (`alpha`, `wobbleNorm`, `dropOffset`) follow the
 *      documented curves in each phase — the renderer adapter relies
 *      on this contract to drive the wobble + drop + fade visuals.
 *   7. Snapshot/restore round-trips byte-perfect — `fromState(toState())`
 *      yields identical phase, frame counter, and observable state.
 *      This is the property the M4 replay VCR relies on.
 *   8. Determinism — identical input sequences produce identical
 *      observable state across instances.
 */

const baseOpts: CrumblingPlatformOptions = {
  x: 960,
  y: 800,
  width: 200,
  height: 32,
};

// ---------------------------------------------------------------------------
// Construction / validation
// ---------------------------------------------------------------------------

describe('CrumblingPlatform — construction & validation', () => {
  it('builds with sensible defaults from CRUMBLE_DEFAULTS', () => {
    const p = new CrumblingPlatform(baseOpts);
    expect(p.getTriggerDelay()).toBe(CRUMBLE_DEFAULTS.triggerDelay);
    expect(p.getFallDuration()).toBe(CRUMBLE_DEFAULTS.fallDuration);
    expect(p.getRespawnDelay()).toBe(CRUMBLE_DEFAULTS.respawnDelay);
    expect(p.getId()).toBe('crumble');
    expect(p.getPhase()).toBe('intact');
    expect(p.getFrame()).toBe(0);
    expect(p.getPhaseStartFrame()).toBe(0);
  });

  it('uses an explicit id when provided', () => {
    const p = new CrumblingPlatform({ ...baseOpts, id: 'crumble-left' });
    expect(p.getId()).toBe('crumble-left');
  });

  it('exposes the static AABB geometry', () => {
    const p = new CrumblingPlatform({ ...baseOpts, x: 100, y: 200, width: 50, height: 12 });
    const b = p.getBounds();
    expect(b).toEqual({ x: 100, y: 200, width: 50, height: 12 });
    expect(p.getX()).toBe(100);
    expect(p.getY()).toBe(200);
    expect(p.getWidth()).toBe(50);
    expect(p.getHeight()).toBe(12);
  });

  it.each([
    ['width', { width: 0 }],
    ['width', { width: -1 }],
    ['height', { height: 0 }],
    ['height', { height: -1 }],
  ])('rejects bad geometry (%s)', (_label, override) => {
    expect(() => new CrumblingPlatform({ ...baseOpts, ...override })).toThrow();
  });

  it.each([
    ['x non-finite', { x: NaN }],
    ['y non-finite', { y: Infinity }],
  ])('rejects non-finite coordinates (%s)', (_label, override) => {
    expect(() => new CrumblingPlatform({ ...baseOpts, ...override })).toThrow(
      /finite/,
    );
  });

  it.each([
    ['triggerDelay <= 0', { triggerDelay: 0 }],
    ['triggerDelay negative', { triggerDelay: -10 }],
    ['triggerDelay fractional', { triggerDelay: 12.5 }],
  ])('rejects bad triggerDelay (%s)', (_label, override) => {
    expect(
      () => new CrumblingPlatform({ ...baseOpts, ...override }),
    ).toThrow(/triggerDelay/);
  });

  it.each([
    ['fallDuration <= 0', { fallDuration: 0 }],
    ['fallDuration negative', { fallDuration: -1 }],
    ['fallDuration fractional', { fallDuration: 2.5 }],
  ])('rejects bad fallDuration (%s)', (_label, override) => {
    expect(
      () => new CrumblingPlatform({ ...baseOpts, ...override }),
    ).toThrow(/fallDuration/);
  });

  it.each([
    ['respawnDelay <= 0', { respawnDelay: 0 }],
    ['respawnDelay negative', { respawnDelay: -1 }],
    ['respawnDelay fractional', { respawnDelay: 99.5 }],
  ])('rejects bad respawnDelay (%s)', (_label, override) => {
    expect(
      () => new CrumblingPlatform({ ...baseOpts, ...override }),
    ).toThrow(/respawnDelay/);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle state machine
// ---------------------------------------------------------------------------

describe('CrumblingPlatform — lifecycle state machine', () => {
  it('starts in intact, solid, visible, no countdown running', () => {
    const p = new CrumblingPlatform(baseOpts);
    expect(p.getPhase()).toBe('intact');
    expect(p.isSolid()).toBe(true);
    expect(p.isVisible()).toBe(true);
    expect(p.isTriggered()).toBe(false);
    expect(p.hasFallen()).toBe(false);
    expect(p.getFramesUntilNextTransition()).toBe(Infinity);
  });

  it('onSteppedOn advances intact → triggered and starts the countdown', () => {
    const p = new CrumblingPlatform({ ...baseOpts, triggerDelay: 60 });
    const fired = p.onSteppedOn();
    expect(fired).toBe(true);
    expect(p.getPhase()).toBe('triggered');
    expect(p.isSolid()).toBe(true); // still solid during warning window
    expect(p.isTriggered()).toBe(true);
    expect(p.getFramesUntilNextTransition()).toBe(60);
  });

  it('falls precisely at triggerDelay frames after step-on', () => {
    const p = new CrumblingPlatform({ ...baseOpts, triggerDelay: 60 });
    p.onSteppedOn();
    // One frame shy of the trigger delay: still triggered + solid.
    for (let i = 0; i < 59; i++) p.tick();
    expect(p.getPhase()).toBe('triggered');
    expect(p.isSolid()).toBe(true);
    expect(p.getFramesUntilNextTransition()).toBe(1);

    // Exactly triggerDelay frames after step-on: transition to falling.
    p.tick();
    expect(p.getPhase()).toBe('falling');
    expect(p.isSolid()).toBe(false); // crucial — fighters now drop through
  });

  it('disappears (gone) precisely at fallDuration frames after falling', () => {
    const p = new CrumblingPlatform({
      ...baseOpts,
      triggerDelay: 10,
      fallDuration: 20,
    });
    p.onSteppedOn();
    for (let i = 0; i < 10; i++) p.tick(); // -> falling
    expect(p.getPhase()).toBe('falling');
    for (let i = 0; i < 19; i++) p.tick(); // 1 frame shy of gone
    expect(p.getPhase()).toBe('falling');
    p.tick();
    expect(p.getPhase()).toBe('gone');
    expect(p.isSolid()).toBe(false);
    expect(p.isVisible()).toBe(false);
    expect(p.hasFallen()).toBe(true);
  });

  it('respawns (gone → intact) precisely at respawnDelay frames after gone', () => {
    const p = new CrumblingPlatform({
      ...baseOpts,
      triggerDelay: 5,
      fallDuration: 5,
      respawnDelay: 15,
    });
    p.onSteppedOn();
    for (let i = 0; i < 10; i++) p.tick(); // -> gone
    expect(p.getPhase()).toBe('gone');
    for (let i = 0; i < 14; i++) p.tick();
    expect(p.getPhase()).toBe('gone');
    p.tick();
    expect(p.getPhase()).toBe('intact');
    expect(p.isSolid()).toBe(true);
    expect(p.isVisible()).toBe(true);
  });

  it('completes a full cycle and is steppable again post-respawn', () => {
    const p = new CrumblingPlatform({
      ...baseOpts,
      triggerDelay: 5,
      fallDuration: 5,
      respawnDelay: 5,
    });
    p.onSteppedOn();
    for (let i = 0; i < 15; i++) p.tick(); // back to intact
    expect(p.getPhase()).toBe('intact');
    // The freshly-respawned platform is fully eligible for another trigger.
    expect(p.onSteppedOn()).toBe(true);
    expect(p.getPhase()).toBe('triggered');
  });

  it('runs many full cycles without drift (deterministic timing)', () => {
    const p = new CrumblingPlatform({
      ...baseOpts,
      triggerDelay: 7,
      fallDuration: 11,
      respawnDelay: 13,
    });
    const cycle = 7 + 11 + 13; // 31 frames per full lap
    let totalFramesElapsed = 0;
    for (let lap = 0; lap < 50; lap++) {
      p.onSteppedOn();
      for (let i = 0; i < cycle; i++) p.tick();
      totalFramesElapsed += cycle;
      expect(p.getPhase()).toBe('intact');
      expect(p.getFrame()).toBe(totalFramesElapsed);
    }
  });
});

// ---------------------------------------------------------------------------
// onSteppedOn idempotence
// ---------------------------------------------------------------------------

describe('CrumblingPlatform — onSteppedOn idempotence', () => {
  it('repeated step-on during triggered does NOT restart the countdown', () => {
    const p = new CrumblingPlatform({ ...baseOpts, triggerDelay: 30 });
    p.onSteppedOn();
    for (let i = 0; i < 20; i++) p.tick();

    // Another step-on while triggered — should be a no-op.
    const fired = p.onSteppedOn();
    expect(fired).toBe(false);
    expect(p.getFramesUntilNextTransition()).toBe(10); // not reset to 30

    // Countdown still completes on its original schedule.
    for (let i = 0; i < 10; i++) p.tick();
    expect(p.getPhase()).toBe('falling');
  });

  it('returns false when stepped on while falling or gone', () => {
    const p = new CrumblingPlatform({
      ...baseOpts,
      triggerDelay: 5,
      fallDuration: 5,
      respawnDelay: 100,
    });
    p.onSteppedOn();
    for (let i = 0; i < 5; i++) p.tick();
    expect(p.getPhase()).toBe('falling');
    expect(p.onSteppedOn()).toBe(false);

    for (let i = 0; i < 5; i++) p.tick();
    expect(p.getPhase()).toBe('gone');
    expect(p.onSteppedOn()).toBe(false);
  });

  it('returns true again only after a full lap back to intact', () => {
    const p = new CrumblingPlatform({
      ...baseOpts,
      triggerDelay: 3,
      fallDuration: 3,
      respawnDelay: 3,
    });
    expect(p.onSteppedOn()).toBe(true);
    for (let i = 0; i < 9; i++) p.tick();
    expect(p.getPhase()).toBe('intact');
    expect(p.onSteppedOn()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Render hints
// ---------------------------------------------------------------------------

describe('CrumblingPlatform — render hints', () => {
  it('intact renders fully solid, no wobble, no offset', () => {
    const p = new CrumblingPlatform(baseOpts);
    const r = p.getRenderState();
    expect(r.alpha).toBe(1);
    expect(r.wobbleNorm).toBe(0);
    expect(r.dropOffset).toBe(0);
  });

  it('triggered renders fully opaque with wobble crescendoing 0 → 1', () => {
    const p = new CrumblingPlatform({ ...baseOpts, triggerDelay: 60 });
    p.onSteppedOn();
    const start = p.getRenderState();
    expect(start.alpha).toBe(1);
    expect(start.wobbleNorm).toBeCloseTo(0, 6);
    expect(start.dropOffset).toBe(0);

    for (let i = 0; i < 30; i++) p.tick();
    const mid = p.getRenderState();
    expect(mid.alpha).toBe(1);
    expect(mid.wobbleNorm).toBeCloseTo(0.5, 6);

    for (let i = 0; i < 29; i++) p.tick();
    const lateTriggered = p.getRenderState();
    // 59 frames in: wobble close to but not quite 1 (still triggered).
    expect(p.getPhase()).toBe('triggered');
    expect(lateTriggered.wobbleNorm).toBeCloseTo(59 / 60, 6);
  });

  it('falling drops dropOffset 0 → fallPixels and fades alpha 1 → 0', () => {
    const p = new CrumblingPlatform({
      ...baseOpts,
      triggerDelay: 1,
      fallDuration: 10,
    });
    p.onSteppedOn();
    p.tick(); // -> falling, frame 0 of falling
    const start = p.getRenderState();
    expect(p.getPhase()).toBe('falling');
    expect(start.alpha).toBeCloseTo(1, 6);
    expect(start.dropOffset).toBeCloseTo(0, 6);
    expect(start.wobbleNorm).toBe(1);

    for (let i = 0; i < 5; i++) p.tick();
    const mid = p.getRenderState();
    expect(mid.alpha).toBeCloseTo(0.5, 6);
    expect(mid.dropOffset).toBeCloseTo(0.5 * CRUMBLE_DEFAULTS.fallPixels, 6);
  });

  it('gone renders alpha 0, no offset, no wobble', () => {
    const p = new CrumblingPlatform({
      ...baseOpts,
      triggerDelay: 1,
      fallDuration: 1,
      respawnDelay: 30,
    });
    p.onSteppedOn();
    p.tick(); // falling
    p.tick(); // gone
    const r = p.getRenderState();
    expect(p.getPhase()).toBe('gone');
    expect(r.alpha).toBe(0);
    expect(r.dropOffset).toBe(0);
    expect(r.wobbleNorm).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

describe('CrumblingPlatform — reset', () => {
  it('reset returns the platform to intact at frame 0', () => {
    const p = new CrumblingPlatform(baseOpts);
    p.onSteppedOn();
    for (let i = 0; i < 200; i++) p.tick();
    p.reset();
    expect(p.getPhase()).toBe('intact');
    expect(p.getFrame()).toBe(0);
    expect(p.getPhaseStartFrame()).toBe(0);
    expect(p.isSolid()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Snapshot / restore (replay)
// ---------------------------------------------------------------------------

describe('CrumblingPlatform — replay snapshot/restore', () => {
  it('toState/fromState round-trips phase, frame, and phaseStartFrame', () => {
    const p = new CrumblingPlatform({ ...baseOpts, triggerDelay: 60 });
    p.onSteppedOn();
    for (let i = 0; i < 25; i++) p.tick();

    const snap = p.toState();
    const phaseBefore = p.getPhase();
    const renderBefore = p.getRenderState();
    const untilBefore = p.getFramesUntilNextTransition();

    // Mutate state.
    for (let i = 0; i < 100; i++) p.tick();
    expect(p.getPhase()).not.toBe(phaseBefore);

    // Restore.
    p.fromState(snap);
    expect(p.getPhase()).toBe(phaseBefore);
    expect(p.getFrame()).toBe(snap.frame);
    expect(p.getPhaseStartFrame()).toBe(snap.phaseStartFrame);
    expect(p.getFramesUntilNextTransition()).toBe(untilBefore);
    const renderAfter = p.getRenderState();
    expect(renderAfter.alpha).toBeCloseTo(renderBefore.alpha, 10);
    expect(renderAfter.wobbleNorm).toBeCloseTo(renderBefore.wobbleNorm, 10);
    expect(renderAfter.dropOffset).toBeCloseTo(renderBefore.dropOffset, 10);
  });

  it('rejects malformed snapshots', () => {
    const p = new CrumblingPlatform(baseOpts);
    // @ts-expect-error — exercising runtime guard
    expect(() => p.fromState(null)).toThrow();
    // @ts-expect-error — invalid phase string
    expect(() => p.fromState({ phase: 'broken', frame: 0, phaseStartFrame: 0 })).toThrow();
    expect(() =>
      p.fromState({ phase: 'intact', frame: NaN, phaseStartFrame: 0 }),
    ).toThrow(/finite/);
    expect(() =>
      p.fromState({ phase: 'intact', frame: 0, phaseStartFrame: 5 }),
    ).toThrow(/phaseStartFrame/);
  });

  it('snapshots taken mid-falling restore the visual interpolation exactly', () => {
    const p = new CrumblingPlatform({
      ...baseOpts,
      triggerDelay: 2,
      fallDuration: 10,
    });
    p.onSteppedOn();
    p.tick();
    p.tick(); // -> falling at frame 2
    for (let i = 0; i < 4; i++) p.tick();
    const snap = p.toState();
    const renderBefore = p.getRenderState();

    const fresh = new CrumblingPlatform({
      ...baseOpts,
      triggerDelay: 2,
      fallDuration: 10,
    });
    fresh.fromState(snap);
    expect(fresh.getPhase()).toBe('falling');
    const renderAfter = fresh.getRenderState();
    expect(renderAfter.alpha).toBeCloseTo(renderBefore.alpha, 10);
    expect(renderAfter.dropOffset).toBeCloseTo(renderBefore.dropOffset, 10);
  });

  it('a snapshot mid-gone resumes the respawn countdown correctly', () => {
    const p = new CrumblingPlatform({
      ...baseOpts,
      triggerDelay: 1,
      fallDuration: 1,
      respawnDelay: 50,
    });
    p.onSteppedOn();
    p.tick(); // falling
    p.tick(); // gone
    for (let i = 0; i < 20; i++) p.tick();
    const snap = p.toState();
    expect(p.getPhase()).toBe('gone');
    expect(p.getFramesUntilNextTransition()).toBe(30);

    const fresh = new CrumblingPlatform({
      ...baseOpts,
      triggerDelay: 1,
      fallDuration: 1,
      respawnDelay: 50,
    });
    fresh.fromState(snap);
    // 30 more frames should respawn the fresh instance.
    for (let i = 0; i < 30; i++) fresh.tick();
    expect(fresh.getPhase()).toBe('intact');
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('CrumblingPlatform — determinism', () => {
  it('two instances driven through identical inputs produce identical state every frame', () => {
    const opts: CrumblingPlatformOptions = {
      ...baseOpts,
      triggerDelay: 23,
      fallDuration: 17,
      respawnDelay: 41,
    };
    const a = new CrumblingPlatform(opts);
    const b = new CrumblingPlatform(opts);

    // Identical input timeline: step on at frames 5, 100, 200.
    const stepFrames = new Set([5, 100, 200]);
    for (let f = 0; f < 500; f++) {
      if (stepFrames.has(f)) {
        expect(a.onSteppedOn()).toBe(b.onSteppedOn());
      }
      expect(a.getPhase()).toBe(b.getPhase());
      expect(a.isSolid()).toBe(b.isSolid());
      expect(a.getFramesUntilNextTransition()).toBe(
        b.getFramesUntilNextTransition(),
      );
      const ra = a.getRenderState();
      const rb = b.getRenderState();
      expect(ra.alpha).toBe(rb.alpha);
      expect(ra.wobbleNorm).toBe(rb.wobbleNorm);
      expect(ra.dropOffset).toBe(rb.dropOffset);
      a.tick();
      b.tick();
    }
  });

  it('is pure-arithmetic — no Date.now / Math.random side effects observable', () => {
    const opts: CrumblingPlatformOptions = {
      ...baseOpts,
      triggerDelay: 10,
      fallDuration: 10,
      respawnDelay: 10,
    };
    const p1 = new CrumblingPlatform(opts);
    const phasesA: string[] = [];
    p1.onSteppedOn();
    for (let i = 0; i < 60; i++) {
      phasesA.push(p1.getPhase());
      p1.tick();
    }

    // Replay the exact same input sequence; expect identical phase trace.
    const p2 = new CrumblingPlatform(opts);
    const phasesB: string[] = [];
    p2.onSteppedOn();
    for (let i = 0; i < 60; i++) {
      phasesB.push(p2.getPhase());
      p2.tick();
    }
    expect(phasesB).toEqual(phasesA);
  });
});
