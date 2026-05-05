import { describe, it, expect } from 'vitest';
import {
  FPS_HEALTH_RAMP,
  TickRateMeter,
  colorIntToHexString,
  formatFpsLine,
  formatRate,
  fpsHealthColor,
} from './fpsCounterFormat';

/**
 * Sub-AC 3 of AC 3 — pure formatting + rolling-window helpers for the
 * in-match FPS overlay. The Phaser-touching `FpsCounter` component
 * imports these to render text + colour; the tests here pin the
 * contract those calls depend on.
 */
describe('formatRate', () => {
  it('renders an integer rate verbatim', () => {
    expect(formatRate(60)).toBe('60');
    expect(formatRate(0)).toBe('0');
  });

  it('rounds fractional rates to the nearest integer (no flicker)', () => {
    expect(formatRate(59.4)).toBe('59');
    expect(formatRate(59.6)).toBe('60');
  });

  it('renders NaN / Infinity / negative as "—"', () => {
    expect(formatRate(Number.NaN)).toBe('—');
    expect(formatRate(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatRate(-1)).toBe('—');
  });
});

describe('formatFpsLine', () => {
  it('produces the canonical "FPS X | SIM Y Hz | target Z" layout', () => {
    expect(formatFpsLine(60, 60, 60)).toBe('FPS 60 | SIM 60 Hz | target 60');
  });

  it('replaces unmeasured render FPS with "—"', () => {
    expect(formatFpsLine(Number.NaN, 60, 60)).toBe(
      'FPS — | SIM 60 Hz | target 60',
    );
  });

  it('rounds simulation Hz so a 59.6 readout displays as 60', () => {
    expect(formatFpsLine(60, 59.6, 60)).toBe('FPS 60 | SIM 60 Hz | target 60');
  });

  it('keeps the target FPS distinct from the live readouts', () => {
    expect(formatFpsLine(45, 30, 60)).toBe('FPS 45 | SIM 30 Hz | target 60');
  });
});

describe('fpsHealthColor', () => {
  it('paints green at the 60 FPS target (with 2-frame fudge)', () => {
    expect(fpsHealthColor(60)).toBe(0x6cf0c2);
    expect(fpsHealthColor(58)).toBe(0x6cf0c2);
  });

  it('paints yellow on a mild dip', () => {
    expect(fpsHealthColor(57)).toBe(0xffe066);
    expect(fpsHealthColor(50)).toBe(0xffe066);
  });

  it('paints red when failing the target', () => {
    expect(fpsHealthColor(49)).toBe(0xff6b6b);
    expect(fpsHealthColor(0)).toBe(0xff6b6b);
  });

  it('treats NaN / Infinity / negative as failing (red)', () => {
    // Non-finite inputs short-circuit to red — the overlay never paints
    // a healthy colour for "we couldn't read the FPS".
    expect(fpsHealthColor(Number.NaN)).toBe(0xff6b6b);
    expect(fpsHealthColor(-1)).toBe(0xff6b6b);
    expect(fpsHealthColor(Number.POSITIVE_INFINITY)).toBe(0xff6b6b);
  });

  it('matches the ramp ordering — every threshold is reachable', () => {
    // The ramp must be sorted descending by `minFps` so the linear walk
    // returns the top-most band the fps reading qualifies for.
    for (let i = 1; i < FPS_HEALTH_RAMP.length; i += 1) {
      expect(FPS_HEALTH_RAMP[i]!.minFps).toBeLessThan(
        FPS_HEALTH_RAMP[i - 1]!.minFps,
      );
    }
  });
});

describe('colorIntToHexString', () => {
  it('zero-pads to six hex digits', () => {
    expect(colorIntToHexString(0xff)).toBe('#0000ff');
    expect(colorIntToHexString(0xffffff)).toBe('#ffffff');
    expect(colorIntToHexString(0x000000)).toBe('#000000');
  });

  it('clamps overflow', () => {
    expect(colorIntToHexString(0xffffff + 1)).toBe('#ffffff');
  });

  it('handles non-finite gracefully (defensive)', () => {
    expect(colorIntToHexString(Number.NaN)).toBe('#000000');
  });
});

// ---------------------------------------------------------------------------
// TickRateMeter
// ---------------------------------------------------------------------------

describe('TickRateMeter — rolling window step counter', () => {
  it('starts empty (0 Hz, size 0)', () => {
    const meter = new TickRateMeter();
    expect(meter.size()).toBe(0);
    expect(meter.getRateHz(0)).toBe(0);
  });

  it('rejects non-positive window sizes at construction', () => {
    expect(() => new TickRateMeter({ windowMs: 0 })).toThrow();
    expect(() => new TickRateMeter({ windowMs: -1 })).toThrow();
    expect(() => new TickRateMeter({ windowMs: Number.NaN })).toThrow();
  });

  it('records every step and reports samples × (1000/window)', () => {
    const meter = new TickRateMeter({ windowMs: 500 });
    // Simulate 30 steps over 500 ms (60 Hz cadence).
    for (let i = 0; i < 30; i += 1) {
      meter.recordSteps(1, i * (500 / 30));
    }
    // 30 samples in a 500 ms window → 60 Hz.
    expect(meter.getRateHz(500)).toBe(60);
    expect(meter.size()).toBe(30);
  });

  it('handles burst N-step ticks (catch-up after pause)', () => {
    const meter = new TickRateMeter({ windowMs: 1000 });
    // Single tick that catches up 4 steps at t=100ms.
    meter.recordSteps(4, 100);
    expect(meter.size()).toBe(4);
    // 4 samples in a 1000 ms window → 4 Hz.
    expect(meter.getRateHz(100)).toBe(4);
  });

  it('evicts samples older than the window', () => {
    const meter = new TickRateMeter({ windowMs: 500 });
    meter.recordSteps(60, 0);
    expect(meter.size()).toBe(60);
    // Advance the clock past the window — eviction should drop everything.
    expect(meter.getRateHz(1000)).toBe(0);
    expect(meter.size()).toBe(0);
  });

  it('keeps in-window samples and drops only stale ones', () => {
    const meter = new TickRateMeter({ windowMs: 500 });
    // 30 samples at t=0 (will fall out by t=600).
    for (let i = 0; i < 30; i += 1) meter.recordSteps(1, 0);
    // 30 samples at t=400 (still in window at t=600).
    for (let i = 0; i < 30; i += 1) meter.recordSteps(1, 400);
    // At t=600, the cutoff is 100 — the t=0 batch is gone, t=400 stays.
    expect(meter.getRateHz(600)).toBe(60); // 30 × (1000/500)
    expect(meter.size()).toBe(30);
  });

  it('reset() drops every sample', () => {
    const meter = new TickRateMeter({ windowMs: 500 });
    meter.recordSteps(10, 0);
    expect(meter.size()).toBe(10);
    meter.reset();
    expect(meter.size()).toBe(0);
    expect(meter.getRateHz(0)).toBe(0);
  });

  it('records nothing when steps <= 0', () => {
    const meter = new TickRateMeter();
    meter.recordSteps(0, 100);
    meter.recordSteps(-5, 100);
    expect(meter.size()).toBe(0);
  });

  it('ignores non-finite step counts and timestamps', () => {
    const meter = new TickRateMeter();
    meter.recordSteps(Number.NaN, 100);
    meter.recordSteps(1, Number.NaN);
    meter.recordSteps(Number.POSITIVE_INFINITY, 100);
    expect(meter.size()).toBe(0);
    // getRateHz is also defensive against non-finite clocks.
    expect(meter.getRateHz(Number.NaN)).toBe(0);
  });

  it('floors fractional step counts to integer samples', () => {
    const meter = new TickRateMeter();
    meter.recordSteps(2.7, 0);
    expect(meter.size()).toBe(2);
  });

  it('default window is 500 ms', () => {
    const meter = new TickRateMeter();
    expect(meter.windowMs).toBe(500);
  });

  it('reports rate normalised to 1 second regardless of partial window fill', () => {
    // 6 samples in a fresh meter with 1000 ms window — should normalise
    // to 6 Hz, not 6 × something else.
    const meter = new TickRateMeter({ windowMs: 1000 });
    for (let i = 0; i < 6; i += 1) meter.recordSteps(1, i * 10);
    expect(meter.getRateHz(60)).toBe(6);
  });
});
