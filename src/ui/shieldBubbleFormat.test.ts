import { describe, it, expect } from 'vitest';
import {
  SHIELD_BUBBLE_ACTIVE_FILL_ALPHA,
  SHIELD_BUBBLE_ACTIVE_STROKE_ALPHA,
  SHIELD_BUBBLE_ACTIVE_STROKE_WIDTH,
  SHIELD_BUBBLE_BROKEN_FILL_COLOR,
  SHIELD_BUBBLE_BROKEN_STROBE_PERIOD,
  SHIELD_BUBBLE_BROKEN_STROKE_COLOR,
  SHIELD_BUBBLE_BROKEN_STROKE_WIDTH,
  SHIELD_BUBBLE_FULL_PADDING,
  SHIELD_BUBBLE_HEALTH_COLOR_RAMP,
  SHIELD_BUBBLE_MIN_PADDING,
  computeShieldBubbleVisual,
  shieldBubbleActiveRadius,
  shieldBubbleBrokenStrobeOn,
  shieldBubbleHealthColor,
  shieldHealthFraction,
} from './shieldBubbleFormat';
import {
  SHIELD_DEFAULTS,
  applyShieldHit,
  createShieldState,
  tickShield,
} from '../characters/shieldState';

/**
 * AC 60401 Sub-AC 1 (visual half) — the shield bubble overlay's pure
 * formatter is the single source of truth for "what does the bubble
 * look like at this state on this frame?". The Phaser component
 * applies the result verbatim. These tests pin the formatter's
 * derivations down so a future refactor of the colour ramp / radius
 * curve / strobe period can't drift past visual expectations without
 * a test failure.
 */

// ---------------------------------------------------------------------------
// Health fraction
// ---------------------------------------------------------------------------

describe('shieldBubbleFormat — shieldHealthFraction', () => {
  it('returns 1 for full health, 0 for empty', () => {
    expect(shieldHealthFraction(50, 50)).toBe(1);
    expect(shieldHealthFraction(0, 50)).toBe(0);
  });

  it('linearly interpolates between 0 and 1', () => {
    expect(shieldHealthFraction(25, 50)).toBe(0.5);
    expect(shieldHealthFraction(10, 50)).toBe(0.2);
  });

  it('clamps over-max health to 1', () => {
    expect(shieldHealthFraction(999, 50)).toBe(1);
  });

  it('clamps negative health to 0', () => {
    expect(shieldHealthFraction(-12, 50)).toBe(0);
  });

  it('returns 0 for zero / negative / NaN max', () => {
    expect(shieldHealthFraction(10, 0)).toBe(0);
    expect(shieldHealthFraction(10, -5)).toBe(0);
    expect(shieldHealthFraction(10, Number.NaN)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Health colour ramp
// ---------------------------------------------------------------------------

describe('shieldBubbleFormat — shieldBubbleHealthColor', () => {
  it('paints high health blue', () => {
    expect(shieldBubbleHealthColor(1.0)).toBe(0x4dd0ff);
    expect(shieldBubbleHealthColor(0.66)).toBe(0x4dd0ff);
  });

  it('paints mid health amber', () => {
    expect(shieldBubbleHealthColor(0.5)).toBe(0xffb84d);
    expect(shieldBubbleHealthColor(0.33)).toBe(0xffb84d);
  });

  it('paints low health red', () => {
    expect(shieldBubbleHealthColor(0.32)).toBe(0xff4040);
    expect(shieldBubbleHealthColor(0.0)).toBe(0xff4040);
  });

  it('clamps fractions outside [0, 1]', () => {
    expect(shieldBubbleHealthColor(2.0)).toBe(0x4dd0ff);
    expect(shieldBubbleHealthColor(-0.5)).toBe(0xff4040);
  });

  it('ramp is sorted by ascending threshold (regression guard)', () => {
    let prev = -1;
    for (const entry of SHIELD_BUBBLE_HEALTH_COLOR_RAMP) {
      expect(entry.thresholdFraction).toBeGreaterThanOrEqual(prev);
      prev = entry.thresholdFraction;
    }
  });
});

// ---------------------------------------------------------------------------
// Bubble radius
// ---------------------------------------------------------------------------

describe('shieldBubbleFormat — shieldBubbleActiveRadius', () => {
  it('returns body radius + full padding at full health', () => {
    expect(shieldBubbleActiveRadius(40, 1)).toBe(40 + SHIELD_BUBBLE_FULL_PADDING);
  });

  it('returns body radius + min padding at empty health', () => {
    expect(shieldBubbleActiveRadius(40, 0)).toBe(40 + SHIELD_BUBBLE_MIN_PADDING);
  });

  it('linearly interpolates padding between min and full', () => {
    const r = shieldBubbleActiveRadius(40, 0.5);
    const expectedPadding =
      SHIELD_BUBBLE_MIN_PADDING +
      (SHIELD_BUBBLE_FULL_PADDING - SHIELD_BUBBLE_MIN_PADDING) * 0.5;
    expect(r).toBe(40 + expectedPadding);
  });

  it('clamps fractions outside [0, 1]', () => {
    expect(shieldBubbleActiveRadius(40, 2)).toBe(40 + SHIELD_BUBBLE_FULL_PADDING);
    expect(shieldBubbleActiveRadius(40, -1)).toBe(40 + SHIELD_BUBBLE_MIN_PADDING);
  });

  it('floors a negative body radius at zero', () => {
    expect(shieldBubbleActiveRadius(-100, 1)).toBe(SHIELD_BUBBLE_FULL_PADDING);
  });

  it('shrinks monotonically as health drops', () => {
    const radii = [1, 0.75, 0.5, 0.25, 0].map((f) =>
      shieldBubbleActiveRadius(40, f),
    );
    for (let i = 1; i < radii.length; i += 1) {
      expect(radii[i]!).toBeLessThan(radii[i - 1]!);
    }
  });
});

// ---------------------------------------------------------------------------
// Broken-state strobe
// ---------------------------------------------------------------------------

describe('shieldBubbleFormat — shieldBubbleBrokenStrobeOn', () => {
  it('is on for the first period and off for the second', () => {
    for (let f = 0; f < SHIELD_BUBBLE_BROKEN_STROBE_PERIOD; f += 1) {
      expect(shieldBubbleBrokenStrobeOn(f)).toBe(true);
    }
    for (
      let f = SHIELD_BUBBLE_BROKEN_STROBE_PERIOD;
      f < SHIELD_BUBBLE_BROKEN_STROBE_PERIOD * 2;
      f += 1
    ) {
      expect(shieldBubbleBrokenStrobeOn(f)).toBe(false);
    }
  });

  it('repeats deterministically across many cycles', () => {
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const onFrame = cycle * 2 * SHIELD_BUBBLE_BROKEN_STROBE_PERIOD;
      const offFrame = onFrame + SHIELD_BUBBLE_BROKEN_STROBE_PERIOD;
      expect(shieldBubbleBrokenStrobeOn(onFrame)).toBe(true);
      expect(shieldBubbleBrokenStrobeOn(offFrame)).toBe(false);
    }
  });

  it('is defensive against negative / NaN frames (treats as 0 / on)', () => {
    expect(shieldBubbleBrokenStrobeOn(-100)).toBe(true);
    expect(shieldBubbleBrokenStrobeOn(Number.NaN)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Top-level visual derivation
// ---------------------------------------------------------------------------

describe('shieldBubbleFormat — computeShieldBubbleVisual', () => {
  it('hides the bubble when shield is idle', () => {
    const v = computeShieldBubbleVisual({
      state: createShieldState(),
      maxHealth: SHIELD_DEFAULTS.maxHealth,
      bodyRadius: 40,
      frame: 0,
    });
    expect(v.visible).toBe(false);
    expect(v.fillAlpha).toBe(0);
    expect(v.strokeAlpha).toBe(0);
    expect(v.strokeWidth).toBe(0);
  });

  it('paints the active bubble with correct healthy-blue colour', () => {
    const active = tickShield(createShieldState(), { held: true });
    const v = computeShieldBubbleVisual({
      state: active,
      maxHealth: SHIELD_DEFAULTS.maxHealth,
      bodyRadius: 40,
      frame: 0,
    });
    expect(v.visible).toBe(true);
    expect(v.fillColor).toBe(0x4dd0ff); // high health → blue
    expect(v.strokeColor).toBe(0x4dd0ff);
    expect(v.fillAlpha).toBe(SHIELD_BUBBLE_ACTIVE_FILL_ALPHA);
    expect(v.strokeAlpha).toBe(SHIELD_BUBBLE_ACTIVE_STROKE_ALPHA);
    expect(v.strokeWidth).toBe(SHIELD_BUBBLE_ACTIVE_STROKE_WIDTH);
    // Radius shrinks one frame's worth of decay below full padding.
    expect(v.radius).toBeLessThan(40 + SHIELD_BUBBLE_FULL_PADDING);
  });

  it('shrinks the active radius as the shield drains', () => {
    let s = createShieldState();
    s = tickShield(s, { held: true });
    const radii: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      s = tickShield(s, { held: true });
      const v = computeShieldBubbleVisual({
        state: s,
        maxHealth: SHIELD_DEFAULTS.maxHealth,
        bodyRadius: 40,
        frame: i,
      });
      radii.push(v.radius);
    }
    // Strict monotonic decrease — health is falling every frame, so
    // the radius must too.
    for (let i = 1; i < radii.length; i += 1) {
      expect(radii[i]!).toBeLessThan(radii[i - 1]!);
    }
  });

  it('ramps active colour blue → amber → red as the shield drains past thresholds', () => {
    // Drain from full toward empty under hits so the colour walks the
    // whole ramp deterministically.
    let s = createShieldState();
    s = tickShield(s, { held: true });
    const max = SHIELD_DEFAULTS.maxHealth;
    const vFull = computeShieldBubbleVisual({
      state: s,
      maxHealth: max,
      bodyRadius: 40,
      frame: 0,
    });
    expect(vFull.fillColor).toBe(0x4dd0ff); // blue

    s = applyShieldHit(s, max * 0.5, SHIELD_DEFAULTS).state;
    const vMid = computeShieldBubbleVisual({
      state: s,
      maxHealth: max,
      bodyRadius: 40,
      frame: 0,
    });
    expect(vMid.fillColor).toBe(0xffb84d); // amber

    s = applyShieldHit(s, max * 0.3, SHIELD_DEFAULTS).state;
    const vLow = computeShieldBubbleVisual({
      state: s,
      maxHealth: max,
      bodyRadius: 40,
      frame: 0,
    });
    expect(vLow.fillColor).toBe(0xff4040); // red
  });

  it('paints a strobing shatter ring while the shield is broken', () => {
    // Force a break.
    const tinyShieldTuning = {
      maxHealth: 5,
      decayPerFrame: 0,
      breakStunFrames: 60,
      postBreakHealth: 5,
      regenPerFrame: 0,
      regenDelayFrames: 30,
      minHealthToRaise: 1,
    } as const;
    let s = createShieldState(tinyShieldTuning);
    s = tickShield(s, { held: true }, tinyShieldTuning);
    s = applyShieldHit(s, 999, tinyShieldTuning).state;
    expect(s.name).toBe('broken');

    // On a strobe-on frame.
    const onVisual = computeShieldBubbleVisual({
      state: s,
      maxHealth: tinyShieldTuning.maxHealth,
      bodyRadius: 40,
      frame: 0,
    });
    expect(onVisual.visible).toBe(true);
    expect(onVisual.fillColor).toBe(SHIELD_BUBBLE_BROKEN_FILL_COLOR);
    expect(onVisual.strokeColor).toBe(SHIELD_BUBBLE_BROKEN_STROKE_COLOR);
    expect(onVisual.strokeWidth).toBe(SHIELD_BUBBLE_BROKEN_STROKE_WIDTH);
    expect(onVisual.fillAlpha).toBeGreaterThan(0);

    // On a strobe-off frame the alpha drops but the ring stays visible.
    const offVisual = computeShieldBubbleVisual({
      state: s,
      maxHealth: tinyShieldTuning.maxHealth,
      bodyRadius: 40,
      frame: SHIELD_BUBBLE_BROKEN_STROBE_PERIOD, // first off frame
    });
    expect(offVisual.visible).toBe(true);
    expect(offVisual.fillAlpha).toBeLessThan(onVisual.fillAlpha);
    expect(offVisual.strokeAlpha).toBeLessThan(onVisual.strokeAlpha);
  });

  it('keeps the broken-shield radius constant at the outer shell size', () => {
    const tinyShieldTuning = {
      maxHealth: 5,
      decayPerFrame: 0,
      breakStunFrames: 30,
      postBreakHealth: 5,
      regenPerFrame: 0,
      regenDelayFrames: 30,
      minHealthToRaise: 1,
    } as const;
    let s = createShieldState(tinyShieldTuning);
    s = tickShield(s, { held: true }, tinyShieldTuning);
    s = applyShieldHit(s, 999, tinyShieldTuning).state;
    const r1 = computeShieldBubbleVisual({
      state: s,
      maxHealth: tinyShieldTuning.maxHealth,
      bodyRadius: 40,
      frame: 0,
    }).radius;
    const r2 = computeShieldBubbleVisual({
      state: s,
      maxHealth: tinyShieldTuning.maxHealth,
      bodyRadius: 40,
      frame: 12,
    }).radius;
    expect(r1).toBe(r2);
    expect(r1).toBe(40 + SHIELD_BUBBLE_FULL_PADDING);
  });
});

// ---------------------------------------------------------------------------
// Determinism gate
// ---------------------------------------------------------------------------

describe('shieldBubbleFormat — determinism', () => {
  it('identical state + frame produces byte-equivalent visuals across calls', () => {
    let s = createShieldState();
    for (let i = 0; i < 25; i += 1) s = tickShield(s, { held: true });
    const a = computeShieldBubbleVisual({
      state: s,
      maxHealth: SHIELD_DEFAULTS.maxHealth,
      bodyRadius: 40,
      frame: 42,
    });
    const b = computeShieldBubbleVisual({
      state: s,
      maxHealth: SHIELD_DEFAULTS.maxHealth,
      bodyRadius: 40,
      frame: 42,
    });
    expect(a).toEqual(b);
  });
});
