import { describe, it, expect } from 'vitest';
import {
  CAPTURE_AXIS_TRIGGER_THRESHOLD,
  CAPTURE_CANCEL_GAMEPAD_BUTTON,
  CAPTURE_CANCEL_KEYCODE,
  CAPTURE_PROMPT_LABEL,
  buildGamepadAxisCaptureBinding,
  buildGamepadButtonCaptureBinding,
  buildKeyboardCaptureBinding,
  captureBindingsForAction,
  isAxisPastCaptureThreshold,
  isCaptureCancelGamepadButton,
  isCaptureCancelKey,
} from './bindingCapture';
import { DEFAULT_GAMEPAD_AXIS_THRESHOLD, SMASH_STICK_THRESHOLD } from '../input/InputBindingsStore';
import { KEY_CODE } from '../input/keyCodes';

/**
 * AC 40102 Sub-AC 2 — pure capture helpers.
 *
 * Locks down:
 *
 *   1. Keyboard capture builds a frozen `KeyboardBinding` and rejects
 *      every value the store validator would reject (zero, NaN, infinity,
 *      non-integer, negative).
 *   2. Gamepad button capture pins to the supplied `gamepadIndex` and
 *      builds a frozen `GamepadBinding` with a button source.
 *   3. Gamepad axis capture infers direction from axis-value sign,
 *      defaults the threshold to the same constant the per-binding
 *      gameplay sampler uses, and lets a custom threshold override.
 *   4. Cancel detection: ESC and Start cancel; B / Circle can be bound.
 *   5. Axis trigger threshold: the helper rejects deflections under
 *      the capture-only threshold even when the per-binding threshold
 *      would have accepted them.
 */

describe('bindingCapture — keyboard capture', () => {
  it('returns a frozen KeyboardBinding for a valid keyCode', () => {
    const b = buildKeyboardCaptureBinding(KEY_CODE.W);
    expect(b.kind).toBe('keyboard');
    expect(b.keyCode).toBe(KEY_CODE.W);
    expect(Object.isFrozen(b)).toBe(true);
  });

  it('rejects zero, NaN, infinity, non-integer, and negative keyCodes', () => {
    expect(() => buildKeyboardCaptureBinding(0)).toThrow();
    expect(() => buildKeyboardCaptureBinding(Number.NaN)).toThrow();
    expect(() => buildKeyboardCaptureBinding(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => buildKeyboardCaptureBinding(1.5)).toThrow();
    expect(() => buildKeyboardCaptureBinding(-1)).toThrow();
    expect(() => buildKeyboardCaptureBinding('A' as unknown as number)).toThrow();
  });
});

describe('bindingCapture — gamepad button capture', () => {
  it('pins to gamepadIndex and produces a frozen button binding', () => {
    const b = buildGamepadButtonCaptureBinding(2, 0);
    expect(b.kind).toBe('gamepad');
    expect(b.gamepadIndex).toBe(2);
    expect(b.source.type).toBe('button');
    if (b.source.type === 'button') {
      expect(b.source.buttonIndex).toBe(0);
    }
    expect(Object.isFrozen(b)).toBe(true);
    expect(Object.isFrozen(b.source)).toBe(true);
  });

  it('rejects negative / non-integer button indices', () => {
    expect(() => buildGamepadButtonCaptureBinding(0, -1)).toThrow();
    expect(() => buildGamepadButtonCaptureBinding(0, 1.5)).toThrow();
    expect(() => buildGamepadButtonCaptureBinding(0, Number.NaN)).toThrow();
  });

  it('rejects negative / non-integer gamepad indices', () => {
    expect(() => buildGamepadButtonCaptureBinding(-1, 0)).toThrow();
    expect(() => buildGamepadButtonCaptureBinding(1.5, 0)).toThrow();
  });
});

describe('bindingCapture — gamepad axis capture', () => {
  it('infers +1 direction from a positive axis value', () => {
    const b = buildGamepadAxisCaptureBinding(0, 0, 0.9);
    expect(b.source.type).toBe('axis');
    if (b.source.type === 'axis') {
      expect(b.source.direction).toBe(1);
      expect(b.source.axisIndex).toBe(0);
      expect(b.source.threshold).toBe(DEFAULT_GAMEPAD_AXIS_THRESHOLD);
    }
  });

  it('infers -1 direction from a negative axis value', () => {
    const b = buildGamepadAxisCaptureBinding(0, 1, -0.85);
    if (b.source.type === 'axis') {
      expect(b.source.direction).toBe(-1);
    }
  });

  it('honours custom threshold overrides in (0, 1]', () => {
    const b = buildGamepadAxisCaptureBinding(1, 0, 0.9, 0.25);
    if (b.source.type === 'axis') {
      expect(b.source.threshold).toBe(0.25);
    }
  });

  it('rejects axis value of zero (no direction can be inferred)', () => {
    expect(() => buildGamepadAxisCaptureBinding(0, 0, 0)).toThrow();
  });

  it('rejects bad threshold values', () => {
    expect(() => buildGamepadAxisCaptureBinding(0, 0, 0.9, 0)).toThrow();
    expect(() => buildGamepadAxisCaptureBinding(0, 0, 0.9, 1.1)).toThrow();
    expect(() => buildGamepadAxisCaptureBinding(0, 0, 0.9, Number.NaN)).toThrow();
  });

  it('rejects bad axis indices', () => {
    expect(() => buildGamepadAxisCaptureBinding(0, -1, 0.9)).toThrow();
    expect(() => buildGamepadAxisCaptureBinding(0, 1.5, 0.9)).toThrow();
  });
});

describe('bindingCapture — cancel detection', () => {
  it('ESC keyCode is recognised as cancel', () => {
    expect(CAPTURE_CANCEL_KEYCODE).toBe(27);
    expect(isCaptureCancelKey(27)).toBe(true);
    expect(isCaptureCancelKey(KEY_CODE.W)).toBe(false);
  });

  it('Start cancels while all four face buttons remain assignable', () => {
    expect(CAPTURE_CANCEL_GAMEPAD_BUTTON).toBe(9);
    expect(isCaptureCancelGamepadButton(9)).toBe(true);
    expect(isCaptureCancelGamepadButton(1)).toBe(false);
    expect(isCaptureCancelGamepadButton(0)).toBe(false);
    expect(isCaptureCancelGamepadButton(2)).toBe(false);
    expect(isCaptureCancelGamepadButton(3)).toBe(false);
  });
});

describe('bindingCapture — axis trigger threshold', () => {
  it('axis past threshold (positive) trips', () => {
    expect(isAxisPastCaptureThreshold(CAPTURE_AXIS_TRIGGER_THRESHOLD)).toBe(true);
    expect(isAxisPastCaptureThreshold(0.95)).toBe(true);
  });

  it('axis past threshold (negative) trips', () => {
    expect(isAxisPastCaptureThreshold(-CAPTURE_AXIS_TRIGGER_THRESHOLD)).toBe(true);
    expect(isAxisPastCaptureThreshold(-0.99)).toBe(true);
  });

  it('axis under threshold does not trip', () => {
    expect(isAxisPastCaptureThreshold(0)).toBe(false);
    expect(isAxisPastCaptureThreshold(0.5)).toBe(false);
    expect(isAxisPastCaptureThreshold(-0.5)).toBe(false);
  });

  it('NaN / infinity does not trip', () => {
    expect(isAxisPastCaptureThreshold(Number.NaN)).toBe(false);
    expect(isAxisPastCaptureThreshold(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isAxisPastCaptureThreshold(Number.NEGATIVE_INFINITY)).toBe(false);
  });
});

describe('bindingCapture — prompt label', () => {
  it('has a non-empty player-facing prompt label', () => {
    expect(typeof CAPTURE_PROMPT_LABEL).toBe('string');
    expect(CAPTURE_PROMPT_LABEL.length).toBeGreaterThan(0);
  });
});

describe('captureBindingsForAction', () => {
  it('expands a stick push on the Smash row to all four half-axes of that stick', () => {
    const pushedDown = buildGamepadAxisCaptureBinding(1, 3, 0.9);
    const stored = captureBindingsForAction('smash', pushedDown);
    expect(stored).toEqual([2, 2, 3, 3].map((axisIndex, i) => ({ kind: 'gamepad', gamepadIndex: 1,
      source: { type: 'axis', axisIndex, direction: i % 2 ? 1 : -1, threshold: SMASH_STICK_THRESHOLD } })));
    // Left-stick pushes expand to the left stick.
    expect(captureBindingsForAction('smash', buildGamepadAxisCaptureBinding(0, 0, -1))
      .map(binding => binding.kind === 'gamepad' && binding.source.type === 'axis' ? binding.source.axisIndex : -1))
      .toEqual([0, 0, 1, 1]);
  });

  it('expands only the named sticks: any other axis stays the single captured half-axis', () => {
    // Axes 4+ (triggers / extra axes on non-standard pads) are not a stick pair.
    for (const axisIndex of [4, 5, 7]) {
      const trigger = buildGamepadAxisCaptureBinding(0, axisIndex, 0.9);
      expect(captureBindingsForAction('smash', trigger)).toEqual([trigger]);
    }
    // Every axis of the two named sticks still expands to its own stick.
    for (const axisIndex of [0, 1, 2, 3]) {
      const stored = captureBindingsForAction('smash', buildGamepadAxisCaptureBinding(0, axisIndex, -0.9));
      expect(stored).toHaveLength(4);
      expect(stored.every(binding => binding.kind === 'gamepad' && binding.source.type === 'axis'
        && (binding.source.axisIndex & ~1) === (axisIndex & ~1))).toBe(true);
    }
  });

  it('keeps keys, buttons and every other action as a single binding', () => {
    const key = buildKeyboardCaptureBinding(KEY_CODE.V);
    const button = buildGamepadButtonCaptureBinding(0, 7);
    const axis = buildGamepadAxisCaptureBinding(0, 2, 1);
    expect(captureBindingsForAction('smash', key)).toEqual([key]);
    expect(captureBindingsForAction('smash', button)).toEqual([button]);
    expect(captureBindingsForAction('attack', axis)).toEqual([axis]);
    expect(captureBindingsForAction('right', axis)).toEqual([axis]);
  });
});
