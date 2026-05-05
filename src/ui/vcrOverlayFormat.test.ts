/**
 * Pure-function tests for the VCR overlay's formatting helpers.
 * AC 30301 Sub-AC 1.
 *
 * Phaser-free; runs under plain Node + vitest.
 */

import { describe, it, expect } from 'vitest';
import {
  VCR_CONTROL,
  VCR_CONTROL_ORDER,
  VCR_BUTTON_LAYOUT,
  VCR_BUTTON_COLOR_RAMP,
  SLOW_MOTION_RATE,
  NORMAL_PLAYBACK_RATE,
  DEFAULT_REWIND_FRAMES,
  buttonStateColor,
  buildHeaderLines,
  colorIntToHexString,
  findButtonLayout,
  findControlForKeyCode,
  formatPhaseLabel,
  formatPlaybackRate,
  formatTimeline,
  resolveButtonBand,
  resolveSpaceShortcut,
  type VcrPlaybackState,
} from './vcrOverlayFormat';
import { KEY_CODE } from '../input/keyCodes';

function makeState(overrides: Partial<VcrPlaybackState> = {}): VcrPlaybackState {
  return {
    phase: 'playing',
    isPlaying: true,
    isPaused: false,
    isSlowMotion: false,
    isFinished: false,
    currentFrame: 120,
    firstFrame: 0,
    lastFrame: 1800,
    playbackRate: NORMAL_PLAYBACK_RATE,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Layout invariants
// ---------------------------------------------------------------------------

describe('VCR_CONTROL — enum + layout invariants', () => {
  it('declares the five canonical buttons in order', () => {
    expect(VCR_CONTROL_ORDER).toEqual([
      'rewind',
      'play',
      'pause',
      'slow-motion',
      'frame-advance',
    ]);
  });

  it('VCR_BUTTON_LAYOUT contains exactly the five controls in order', () => {
    expect(VCR_BUTTON_LAYOUT.map((b) => b.control)).toEqual(VCR_CONTROL_ORDER);
  });

  it('every button declares an accessible label', () => {
    for (const entry of VCR_BUTTON_LAYOUT) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.glyph.length).toBeGreaterThan(0);
    }
  });

  it('shortcut hints follow the [ X ] pattern', () => {
    for (const entry of VCR_BUTTON_LAYOUT) {
      expect(entry.shortcutHint).toMatch(/^\[ .+ ]$/);
    }
  });

  it('Play and Pause share the Space shortcut', () => {
    const play = findButtonLayout(VCR_CONTROL.PLAY);
    const pause = findButtonLayout(VCR_CONTROL.PAUSE);
    expect(play?.shortcutKeyCode).toBe(KEY_CODE.SPACE);
    expect(pause?.shortcutKeyCode).toBe(KEY_CODE.SPACE);
  });

  it('Rewind binds R, Slow-mo binds S, Frame-advance binds F', () => {
    expect(findButtonLayout(VCR_CONTROL.REWIND)?.shortcutKeyCode).toBe(
      KEY_CODE.R,
    );
    expect(findButtonLayout(VCR_CONTROL.SLOW_MOTION)?.shortcutKeyCode).toBe(
      KEY_CODE.S,
    );
    expect(findButtonLayout(VCR_CONTROL.FRAME_ADVANCE)?.shortcutKeyCode).toBe(
      KEY_CODE.F,
    );
  });

  it('findButtonLayout returns null for unknown controls', () => {
    expect(findButtonLayout('garbage' as never)).toBeNull();
  });

  it('findControlForKeyCode resolves shortcuts in canonical order', () => {
    expect(findControlForKeyCode(KEY_CODE.R)).toBe(VCR_CONTROL.REWIND);
    expect(findControlForKeyCode(KEY_CODE.F)).toBe(VCR_CONTROL.FRAME_ADVANCE);
    // Space is shared — first canonical match is Play.
    expect(findControlForKeyCode(KEY_CODE.SPACE)).toBe(VCR_CONTROL.PLAY);
    // Unknown.
    expect(findControlForKeyCode(0xdead)).toBeNull();
  });

  it('rewind/slow-mo/normal constants have the expected values', () => {
    expect(SLOW_MOTION_RATE).toBe(0.25);
    expect(NORMAL_PLAYBACK_RATE).toBe(1.0);
    expect(DEFAULT_REWIND_FRAMES).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// Space shortcut resolves toggle state
// ---------------------------------------------------------------------------

describe('resolveSpaceShortcut', () => {
  it('returns pause while playing', () => {
    expect(resolveSpaceShortcut(makeState({ isPlaying: true }))).toBe(
      VCR_CONTROL.PAUSE,
    );
  });

  it('returns play while paused', () => {
    expect(
      resolveSpaceShortcut(
        makeState({ isPlaying: false, isPaused: true, phase: 'loaded' }),
      ),
    ).toBe(VCR_CONTROL.PLAY);
  });

  it('returns play when finished (Space re-arms playback)', () => {
    expect(
      resolveSpaceShortcut(
        makeState({
          isPlaying: false,
          isPaused: false,
          isFinished: true,
          phase: 'finished',
        }),
      ),
    ).toBe(VCR_CONTROL.PLAY);
  });

  it('returns play when no replay loaded', () => {
    expect(
      resolveSpaceShortcut(
        makeState({
          isPlaying: false,
          isPaused: false,
          phase: 'idle',
          lastFrame: null,
          firstFrame: null,
        }),
      ),
    ).toBe(VCR_CONTROL.PLAY);
  });
});

// ---------------------------------------------------------------------------
// Visual band resolver
// ---------------------------------------------------------------------------

describe('resolveButtonBand', () => {
  it('Play is active while playing', () => {
    expect(
      resolveButtonBand(VCR_CONTROL.PLAY, makeState({ isPlaying: true }), false),
    ).toBe('active');
  });

  it('Pause is active while paused', () => {
    expect(
      resolveButtonBand(
        VCR_CONTROL.PAUSE,
        makeState({ isPlaying: false, isPaused: true, phase: 'loaded' }),
        false,
      ),
    ).toBe('active');
  });

  it('Slow-motion is active while slow-motion is on', () => {
    expect(
      resolveButtonBand(
        VCR_CONTROL.SLOW_MOTION,
        makeState({ isSlowMotion: true, playbackRate: SLOW_MOTION_RATE }),
        false,
      ),
    ).toBe('active');
  });

  it('Frame advance is disabled while playing, idle while paused', () => {
    expect(
      resolveButtonBand(
        VCR_CONTROL.FRAME_ADVANCE,
        makeState({ isPlaying: true }),
        false,
      ),
    ).toBe('disabled');
    expect(
      resolveButtonBand(
        VCR_CONTROL.FRAME_ADVANCE,
        makeState({ isPlaying: false, isPaused: true, phase: 'loaded' }),
        false,
      ),
    ).toBe('idle');
  });

  it('Frame advance hover wins over idle while paused', () => {
    expect(
      resolveButtonBand(
        VCR_CONTROL.FRAME_ADVANCE,
        makeState({ isPlaying: false, isPaused: true, phase: 'loaded' }),
        true,
      ),
    ).toBe('hover');
  });

  it('every button is disabled when no replay is loaded', () => {
    const empty = makeState({
      phase: 'idle',
      isPlaying: false,
      isPaused: false,
      isFinished: false,
      isSlowMotion: false,
      currentFrame: 0,
      firstFrame: null,
      lastFrame: null,
    });
    for (const control of VCR_CONTROL_ORDER) {
      expect(resolveButtonBand(control, empty, false)).toBe('disabled');
      expect(resolveButtonBand(control, empty, true)).toBe('disabled');
    }
  });

  it('hover band wins over idle', () => {
    const paused = makeState({
      isPlaying: false,
      isPaused: true,
      phase: 'loaded',
    });
    expect(resolveButtonBand(VCR_CONTROL.PLAY, paused, true)).toBe('hover');
    expect(resolveButtonBand(VCR_CONTROL.REWIND, paused, true)).toBe('hover');
  });

  it('active band wins over hover (truth-in-painting)', () => {
    const playing = makeState({ isPlaying: true });
    expect(resolveButtonBand(VCR_CONTROL.PLAY, playing, true)).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Visual ramp colours
// ---------------------------------------------------------------------------

describe('VCR_BUTTON_COLOR_RAMP / buttonStateColor', () => {
  it('declares one entry per visual band', () => {
    const bands = VCR_BUTTON_COLOR_RAMP.map((e) => e.band);
    expect(bands).toEqual(['idle', 'hover', 'active', 'disabled']);
  });

  it('buttonStateColor returns a distinct colour per band', () => {
    const idle = buttonStateColor('idle');
    const hover = buttonStateColor('hover');
    const active = buttonStateColor('active');
    const disabled = buttonStateColor('disabled');
    expect(new Set([idle, hover, active, disabled]).size).toBe(4);
  });

  it('falls back to idle for unknown bands', () => {
    expect(buttonStateColor('garbage' as never)).toBe(buttonStateColor('idle'));
  });

  it('colorIntToHexString formats #rrggbb with leading zeros', () => {
    expect(colorIntToHexString(0)).toBe('#000000');
    expect(colorIntToHexString(0xff)).toBe('#0000ff');
    expect(colorIntToHexString(0xffffff)).toBe('#ffffff');
    // Out-of-range clamps.
    expect(colorIntToHexString(-1)).toBe('#000000');
    expect(colorIntToHexString(0x1000000)).toBe('#ffffff');
    expect(colorIntToHexString(Number.NaN)).toBe('#000000');
  });
});

// ---------------------------------------------------------------------------
// Read-out strings
// ---------------------------------------------------------------------------

describe('formatTimeline', () => {
  it('renders cursor / total in fNNN format', () => {
    expect(formatTimeline(makeState({ currentFrame: 600, lastFrame: 1800 }))).toBe(
      'f600 / f1800',
    );
  });

  it('renders an em-dash when no replay is loaded', () => {
    expect(
      formatTimeline(
        makeState({ firstFrame: null, lastFrame: null, currentFrame: 0 }),
      ),
    ).toBe('—');
  });
});

describe('formatPlaybackRate', () => {
  it('renders 1.0x for normal speed', () => {
    expect(formatPlaybackRate(NORMAL_PLAYBACK_RATE)).toBe('1.0x');
  });

  it('renders 0.25x for slow-motion', () => {
    expect(formatPlaybackRate(SLOW_MOTION_RATE)).toBe('0.25x');
  });

  it('handles edge cases', () => {
    expect(formatPlaybackRate(0)).toBe('0.0x');
    expect(formatPlaybackRate(Number.NaN)).toBe('0.0x');
    expect(formatPlaybackRate(-1)).toBe('0.0x');
  });
});

describe('formatPhaseLabel', () => {
  it('maps every phase to a human label', () => {
    expect(formatPhaseLabel('idle')).toBe('no replay');
    expect(formatPhaseLabel('loaded')).toBe('paused');
    expect(formatPhaseLabel('playing')).toBe('playing');
    expect(formatPhaseLabel('finished')).toBe('finished');
  });
});

describe('buildHeaderLines', () => {
  it('emits three stable lines', () => {
    const lines = buildHeaderLines(makeState());
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('REPLAY PLAYBACK');
    expect(lines[1]).toBe('playing · 1.0x');
    expect(lines[2]).toBe('f120 / f1800');
  });

  it('reflects slow-motion in the rate line', () => {
    const lines = buildHeaderLines(
      makeState({ isSlowMotion: true, playbackRate: SLOW_MOTION_RATE }),
    );
    expect(lines[1]).toBe('playing · 0.25x');
  });

  it('reflects paused phase', () => {
    const lines = buildHeaderLines(
      makeState({ phase: 'loaded', isPlaying: false, isPaused: true }),
    );
    expect(lines[1]).toContain('paused');
  });
});
