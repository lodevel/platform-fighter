import { describe, it, expect } from 'vitest';
import {
  CHARGE_INDICATOR_BAR_HEIGHT,
  CHARGE_INDICATOR_BAR_WIDTH,
  CHARGE_INDICATOR_COLOR_RAMP,
  CHARGE_INDICATOR_MIN_PROGRESS_TO_SHOW,
  CHARGE_INDICATOR_PULSE_DEPTH,
  CHARGE_INDICATOR_PULSE_PERIOD_FAST,
  CHARGE_INDICATOR_PULSE_PERIOD_SLOW,
  CHARGE_INDICATOR_RING_PADDING,
  chargeIndicatorColor,
  chargeIndicatorPulseMultiplier,
  chargeIndicatorPulsePeriod,
  computeChargeIndicatorVisual,
} from './chargeIndicatorFormat';

/**
 * The charge-indicator overlay's pure formatter is the single source of
 * truth for "what does the wind-up glow / bar look like at this charge
 * fraction on this frame?". The Phaser component applies the result
 * verbatim. These tests pin the colour ramp, the frame-driven pulse,
 * and the bar-width / ring-radius derivations so a future refactor
 * can't drift past visual expectations — and, critically, that the
 * pulse is driven off the SIMULATED frame counter (deterministic), not
 * a wall clock.
 */

// ---------------------------------------------------------------------------
// Colour ramp
// ---------------------------------------------------------------------------

describe('chargeIndicatorFormat — chargeIndicatorColor', () => {
  it('starts white (cool) at zero / low charge', () => {
    expect(chargeIndicatorColor(0)).toBe(0xffffff);
    expect(chargeIndicatorColor(0.1)).toBe(0xffffff);
  });

  it('ramps cool → hot through yellow / orange to red', () => {
    expect(chargeIndicatorColor(0.25)).toBe(0xfff0a0); // pale yellow
    expect(chargeIndicatorColor(0.5)).toBe(0xffd23f); // yellow
    expect(chargeIndicatorColor(0.75)).toBe(0xff8c2b); // orange
    expect(chargeIndicatorColor(0.95)).toBe(0xff3030); // red
    expect(chargeIndicatorColor(1)).toBe(0xff3030); // red at full
  });

  it('clamps fractions outside [0, 1]', () => {
    expect(chargeIndicatorColor(-1)).toBe(0xffffff);
    expect(chargeIndicatorColor(2)).toBe(0xff3030);
  });

  it('ramp is sorted by ascending threshold (regression guard)', () => {
    let prev = -1;
    for (const entry of CHARGE_INDICATOR_COLOR_RAMP) {
      expect(entry.thresholdFraction).toBeGreaterThanOrEqual(prev);
      prev = entry.thresholdFraction;
    }
  });
});

// ---------------------------------------------------------------------------
// Pulse period — accelerates with charge
// ---------------------------------------------------------------------------

describe('chargeIndicatorFormat — chargeIndicatorPulsePeriod', () => {
  it('is the slow period at zero charge and the fast period at full', () => {
    expect(chargeIndicatorPulsePeriod(0)).toBe(CHARGE_INDICATOR_PULSE_PERIOD_SLOW);
    expect(chargeIndicatorPulsePeriod(1)).toBe(CHARGE_INDICATOR_PULSE_PERIOD_FAST);
  });

  it('shrinks monotonically (blink speeds up) as charge builds', () => {
    const periods = [0, 0.25, 0.5, 0.75, 1].map((f) =>
      chargeIndicatorPulsePeriod(f),
    );
    for (let i = 1; i < periods.length; i += 1) {
      expect(periods[i]!).toBeLessThanOrEqual(periods[i - 1]!);
    }
    // And strictly faster overall, not flat.
    expect(periods[periods.length - 1]!).toBeLessThan(periods[0]!);
  });

  it('never returns a sub-1 period (no divide-by-zero downstream)', () => {
    for (let f = -0.5; f <= 1.5; f += 0.1) {
      expect(chargeIndicatorPulsePeriod(f)).toBeGreaterThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Pulse multiplier — deterministic, frame-driven
// ---------------------------------------------------------------------------

describe('chargeIndicatorFormat — chargeIndicatorPulseMultiplier', () => {
  it('stays within [1 - depth, 1]', () => {
    for (let frame = 0; frame < 200; frame += 1) {
      const m = chargeIndicatorPulseMultiplier(frame, 0.4);
      expect(m).toBeGreaterThanOrEqual(1 - CHARGE_INDICATOR_PULSE_DEPTH - 1e-9);
      expect(m).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('peaks (full bright) at the mid-point of a pulse cycle', () => {
    // At full charge the period is the fast period; the triangular wave
    // peaks at the half-period frame.
    const period = chargeIndicatorPulsePeriod(1);
    const mid = Math.floor(period / 2);
    const peak = chargeIndicatorPulseMultiplier(mid, 1);
    // The mid frame is the brightest sampled frame in the cycle.
    for (let f = 0; f < period; f += 1) {
      expect(chargeIndicatorPulseMultiplier(f, 1)).toBeLessThanOrEqual(
        peak + 1e-9,
      );
    }
  });

  it('repeats deterministically across whole pulse cycles', () => {
    const fraction = 0.5;
    const period = chargeIndicatorPulsePeriod(fraction);
    for (let f = 0; f < period; f += 1) {
      const a = chargeIndicatorPulseMultiplier(f, fraction);
      const b = chargeIndicatorPulseMultiplier(f + period, fraction);
      const c = chargeIndicatorPulseMultiplier(f + 5 * period, fraction);
      expect(b).toBeCloseTo(a, 12);
      expect(c).toBeCloseTo(a, 12);
    }
  });

  it('is identical for the same (frame, fraction) — no wall-clock dependence', () => {
    // Two calls with identical args at "different real times" must
    // agree byte-for-byte (the determinism gate for replays).
    expect(chargeIndicatorPulseMultiplier(37, 0.6)).toBe(
      chargeIndicatorPulseMultiplier(37, 0.6),
    );
  });

  it('is defensive against negative / NaN frames (treats as frame 0)', () => {
    expect(chargeIndicatorPulseMultiplier(-10, 0.5)).toBe(
      chargeIndicatorPulseMultiplier(0, 0.5),
    );
    expect(chargeIndicatorPulseMultiplier(Number.NaN, 0.5)).toBe(
      chargeIndicatorPulseMultiplier(0, 0.5),
    );
  });
});

// ---------------------------------------------------------------------------
// Top-level visual derivation
// ---------------------------------------------------------------------------

describe('chargeIndicatorFormat — computeChargeIndicatorVisual', () => {
  const base = { frame: 3, bodyRadius: 40, bodyHeight: 80 };

  it('hides when not charging (chargeProgress === null)', () => {
    const v = computeChargeIndicatorVisual({ ...base, chargeProgress: null });
    expect(v.visible).toBe(false);
    expect(v.ringFillAlpha).toBe(0);
    expect(v.ringStrokeAlpha).toBe(0);
    expect(v.barFillWidth).toBe(0);
  });

  it('hides a sub-threshold wind-up (e.g. a 1-frame jab flash)', () => {
    const v = computeChargeIndicatorVisual({
      ...base,
      chargeProgress: CHARGE_INDICATOR_MIN_PROGRESS_TO_SHOW / 2,
    });
    expect(v.visible).toBe(false);
  });

  it('hides on a non-finite chargeProgress', () => {
    expect(
      computeChargeIndicatorVisual({ ...base, chargeProgress: Number.NaN })
        .visible,
    ).toBe(false);
  });

  it('shows a white aura + partial bar early in the charge', () => {
    const v = computeChargeIndicatorVisual({ ...base, chargeProgress: 0.1 });
    expect(v.visible).toBe(true);
    expect(v.ringColor).toBe(0xffffff); // cool
    expect(v.ringRadius).toBe(40 + CHARGE_INDICATOR_RING_PADDING);
    expect(v.barMaxWidth).toBe(CHARGE_INDICATOR_BAR_WIDTH);
    expect(v.barFillWidth).toBeCloseTo(CHARGE_INDICATOR_BAR_WIDTH * 0.1, 9);
    expect(v.barHeight).toBe(CHARGE_INDICATOR_BAR_HEIGHT);
  });

  it('shows a red aura + full bar at full charge', () => {
    const v = computeChargeIndicatorVisual({ ...base, chargeProgress: 1 });
    expect(v.visible).toBe(true);
    expect(v.ringColor).toBe(0xff3030); // hot
    expect(v.barColor).toBe(0xff3030);
    expect(v.barFillWidth).toBe(CHARGE_INDICATOR_BAR_WIDTH);
  });

  it('floats the bar above the head (negative offset, clear of the body)', () => {
    const v = computeChargeIndicatorVisual({ ...base, chargeProgress: 0.5 });
    // Bar centre must sit above the body centre by more than half the
    // body height (it clears the head plus a gap).
    expect(v.barCenterOffsetY).toBeLessThan(-base.bodyHeight / 2);
  });

  it('bar fill width grows monotonically with charge', () => {
    const widths = [0.1, 0.3, 0.5, 0.7, 0.9, 1].map(
      (f) =>
        computeChargeIndicatorVisual({ ...base, chargeProgress: f })
          .barFillWidth,
    );
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i]!).toBeGreaterThan(widths[i - 1]!);
    }
  });

  it('ring stroke alpha at the pulse peak grows with charge (brighter as it heats up)', () => {
    // Sample at each charge's own pulse peak so the comparison isolates
    // the base-intensity ramp from the pulse modulation.
    const peakAlpha = (fraction: number): number => {
      const period = chargeIndicatorPulsePeriod(fraction);
      let best = 0;
      for (let f = 0; f < period; f += 1) {
        const v = computeChargeIndicatorVisual({
          ...base,
          frame: f,
          chargeProgress: fraction,
        });
        best = Math.max(best, v.ringStrokeAlpha);
      }
      return best;
    };
    expect(peakAlpha(0.9)).toBeGreaterThan(peakAlpha(0.1));
  });

  it('clamps over-1 chargeProgress to full charge', () => {
    const v = computeChargeIndicatorVisual({ ...base, chargeProgress: 5 });
    expect(v.barFillWidth).toBe(CHARGE_INDICATOR_BAR_WIDTH);
    expect(v.ringColor).toBe(0xff3030);
  });

  it('honours a custom minProgressToShow floor', () => {
    const shown = computeChargeIndicatorVisual({
      ...base,
      chargeProgress: 0.3,
      minProgressToShow: 0.5,
    });
    expect(shown.visible).toBe(false);
    const shown2 = computeChargeIndicatorVisual({
      ...base,
      chargeProgress: 0.6,
      minProgressToShow: 0.5,
    });
    expect(shown2.visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Determinism gate
// ---------------------------------------------------------------------------

describe('chargeIndicatorFormat — determinism', () => {
  it('identical charge + frame produces byte-equivalent visuals across calls', () => {
    const input = {
      chargeProgress: 0.62,
      frame: 41,
      bodyRadius: 36,
      bodyHeight: 72,
    };
    const a = computeChargeIndicatorVisual(input);
    const b = computeChargeIndicatorVisual(input);
    expect(a).toEqual(b);
  });

  it('the aura visibly throbs across frames at a fixed charge (pulse is live)', () => {
    const fraction = 0.5;
    const period = chargeIndicatorPulsePeriod(fraction);
    const alphas = new Set<number>();
    for (let f = 0; f < period; f += 1) {
      alphas.add(
        computeChargeIndicatorVisual({
          chargeProgress: fraction,
          frame: f,
          bodyRadius: 40,
          bodyHeight: 80,
        }).ringStrokeAlpha,
      );
    }
    // More than one distinct alpha across a cycle ⇒ the glow pulses.
    expect(alphas.size).toBeGreaterThan(1);
  });
});
