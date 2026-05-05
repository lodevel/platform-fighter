/**
 * Pure binding-capture helpers for the M5 rebinding screen — AC 40102 Sub-AC 2.
 *
 * The interactive capture flow:
 *
 *   1. The player clicks a binding-row value cell on a player panel
 *      (e.g. "Jump → W"). The screen enters *capture mode* for that
 *      `(slot, action)` pair, paints a `Press a key…` / `Press a button…`
 *      prompt in the cell, and starts listening for hardware input.
 *   2. The first key, gamepad button, or stick deflection that arrives
 *      becomes the new binding for that slot+action. The captured binding
 *      is written to the {@link InputBindingsStore} via `setAction(...)`,
 *      replacing whatever was there.
 *   3. ESC (keyboard) or B (gamepad button index 1) cancels capture and
 *      restores the previous label.
 *
 * Why a pure-helper module sibling to `RebindingScreen.ts`:
 *
 *   • Test ergonomics — every translation between "raw input event" and
 *     "{@link InputBinding} struct" runs under plain Node + vitest.
 *     Phaser's keyboard plugin and the W3C Gamepad API live behind the
 *     scene shim; the pure helpers here speak only in primitives.
 *   • Re-use — the (later) "press any key to assign Player N" lobby flow
 *     can reuse `buildKeyboardCaptureBinding` / `buildGamepadButtonCaptureBinding`
 *     to build defaulting tables without dragging the rebinding screen
 *     in.
 *   • Determinism — the helpers are referentially transparent. No
 *     `Math.random()`, no wall-clock reads, no Phaser. The screen and
 *     scene call them with explicit arguments, and the same arguments
 *     produce byte-identical {@link InputBinding} structures.
 *
 * Strict TypeScript: compiles under `noUncheckedIndexedAccess + strict`.
 */

import {
  DEFAULT_GAMEPAD_AXIS_THRESHOLD,
} from '../input/InputBindingsStore';
import type {
  GamepadBinding,
  GamepadBindingSource,
  KeyboardBinding,
  LogicalAction,
  PlayerBindingsIndex,
} from '../types/inputBindings';

// ---------------------------------------------------------------------------
// Capture state
// ---------------------------------------------------------------------------

/**
 * Snapshot of which `(slot, action)` pair is currently waiting for a
 * physical input. The screen owns one of these at a time — clicking a
 * different action while a capture is open replaces the active pair
 * (the previous binding stays untouched in the store).
 */
export interface BindingCaptureState {
  readonly slot: PlayerBindingsIndex;
  readonly action: LogicalAction;
}

/**
 * The label the screen paints in a binding-row value cell while it is
 * waiting for the player's next physical input. Used for keyboard,
 * gamepad, and "either" capture prompts.
 *
 * Why a single string instead of one per device kind: the player isn't
 * forced to commit to a device before capture begins — they just press
 * the key or button they want, and the helpers below detect which
 * device family fired. A unified prompt keeps the UX simple.
 */
export const CAPTURE_PROMPT_LABEL = 'Press input…';

/** Label for the "click me to begin capture" hover hint (future a11y). */
export const CAPTURE_HOVER_HINT = 'Click to rebind';

// ---------------------------------------------------------------------------
// Cancel detection
// ---------------------------------------------------------------------------

/** ESC keyCode — the canonical "cancel capture" signal. */
export const CAPTURE_CANCEL_KEYCODE = 27;

/**
 * Standard-layout gamepad button index that cancels capture (button 1 =
 * B / Circle — the universal "back" face button). Mirrors the rebinding
 * default that maps button 1 to taunt; while capture is active the
 * cancel meaning takes precedence so a player can always back out.
 */
export const CAPTURE_CANCEL_GAMEPAD_BUTTON = 1;

/**
 * True iff the supplied keyCode should cancel an active capture rather
 * than be assigned. Today only ESC qualifies; exposed as a helper so the
 * scene's keyboard listener doesn't have to know the constant.
 */
export function isCaptureCancelKey(keyCode: number): boolean {
  return keyCode === CAPTURE_CANCEL_KEYCODE;
}

/**
 * True iff the supplied gamepad button index should cancel an active
 * capture rather than be assigned. Mirrors {@link isCaptureCancelKey}.
 */
export function isCaptureCancelGamepadButton(buttonIndex: number): boolean {
  return buttonIndex === CAPTURE_CANCEL_GAMEPAD_BUTTON;
}

// ---------------------------------------------------------------------------
// Capture-binding builders
// ---------------------------------------------------------------------------

/**
 * Build a {@link KeyboardBinding} from a captured keyboard event. Throws
 * on inputs that the {@link InputBindingsStore} validator would reject
 * (zero, NaN, non-finite, non-integer, negative). Catching the bad value
 * here means the screen's capture handler can surface a friendly
 * "couldn't read that key" message instead of letting an exception
 * bubble out of `setAction`.
 *
 * The output is frozen so the screen can hand it straight to
 * `setAction` (which will also clone-and-freeze internally — but freezing
 * twice is cheap and means a returned binding can never be mutated by a
 * caller before reaching the store).
 */
export function buildKeyboardCaptureBinding(keyCode: number): KeyboardBinding {
  if (
    typeof keyCode !== 'number' ||
    !Number.isFinite(keyCode) ||
    !Number.isInteger(keyCode) ||
    keyCode <= 0
  ) {
    throw new Error(
      `bindingCapture.buildKeyboardCaptureBinding: invalid keyCode (${String(keyCode)}).`,
    );
  }
  return Object.freeze({ kind: 'keyboard', keyCode });
}

/**
 * Build a {@link GamepadBinding} for a captured *button* press on a
 * specific pad. The returned binding pins to `gamepadIndex` so a player
 * who rebinds while holding pad 0 cannot accidentally also affect pad 1.
 *
 * Reject negative / non-integer button indices the same way the store
 * validator would — the capture controller forwards
 * `Gamepad.buttons[i]` indices which are always non-negative integers in
 * the real browser, but a buggy adapter shouldn't be allowed to corrupt
 * the store.
 */
export function buildGamepadButtonCaptureBinding(
  gamepadIndex: number,
  buttonIndex: number,
): GamepadBinding {
  assertValidGamepadIndex(gamepadIndex);
  if (
    typeof buttonIndex !== 'number' ||
    !Number.isInteger(buttonIndex) ||
    buttonIndex < 0
  ) {
    throw new Error(
      `bindingCapture.buildGamepadButtonCaptureBinding: invalid buttonIndex (${String(buttonIndex)}).`,
    );
  }
  const source: GamepadBindingSource = Object.freeze({
    type: 'button',
    buttonIndex,
  });
  return Object.freeze({ kind: 'gamepad', gamepadIndex, source });
}

/**
 * Build a {@link GamepadBinding} for a captured *axis* deflection. The
 * direction is the sign of the captured axis value (negative → -1,
 * positive → +1). Threshold defaults to
 * {@link DEFAULT_GAMEPAD_AXIS_THRESHOLD} so the player gets the same
 * "pushed past the dead-zone" feel as the default presets, but a
 * `customThreshold` argument lets a future "advanced sensitivity" UI
 * customise it without forking the helper.
 */
export function buildGamepadAxisCaptureBinding(
  gamepadIndex: number,
  axisIndex: number,
  axisValue: number,
  customThreshold?: number,
): GamepadBinding {
  assertValidGamepadIndex(gamepadIndex);
  if (
    typeof axisIndex !== 'number' ||
    !Number.isInteger(axisIndex) ||
    axisIndex < 0
  ) {
    throw new Error(
      `bindingCapture.buildGamepadAxisCaptureBinding: invalid axisIndex (${String(axisIndex)}).`,
    );
  }
  if (typeof axisValue !== 'number' || !Number.isFinite(axisValue) || axisValue === 0) {
    throw new Error(
      `bindingCapture.buildGamepadAxisCaptureBinding: axisValue must be a non-zero finite number (got ${String(axisValue)}).`,
    );
  }
  const direction: -1 | 1 = axisValue > 0 ? 1 : -1;
  const threshold = customThreshold ?? DEFAULT_GAMEPAD_AXIS_THRESHOLD;
  if (
    typeof threshold !== 'number' ||
    !Number.isFinite(threshold) ||
    threshold <= 0 ||
    threshold > 1
  ) {
    throw new Error(
      `bindingCapture.buildGamepadAxisCaptureBinding: threshold must be in (0, 1] (got ${String(threshold)}).`,
    );
  }
  const source: GamepadBindingSource = Object.freeze({
    type: 'axis',
    axisIndex,
    direction,
    threshold,
  });
  return Object.freeze({ kind: 'gamepad', gamepadIndex, source });
}

function assertValidGamepadIndex(gamepadIndex: number): void {
  if (
    typeof gamepadIndex !== 'number' ||
    !Number.isInteger(gamepadIndex) ||
    gamepadIndex < 0
  ) {
    throw new Error(
      `bindingCapture: invalid gamepadIndex (${String(gamepadIndex)}). Must be a non-negative integer.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Axis capture detection
// ---------------------------------------------------------------------------

/**
 * Threshold the capture controller uses to detect "the player just pushed
 * the stick" — distinct from {@link DEFAULT_GAMEPAD_AXIS_THRESHOLD}
 * (which is the per-binding "is held" threshold during gameplay).
 *
 * Why a separate, slightly higher value: capture is one-shot and we want
 * to be sure the player meant to push the stick rather than getting a
 * false positive from stick-drift on a worn pad. A `0.7` floor handles
 * common drift tolerances on consumer hardware while still feeling
 * responsive when the player intentionally deflects the stick.
 */
export const CAPTURE_AXIS_TRIGGER_THRESHOLD = 0.7;

/**
 * True iff a captured axis value is past the capture trigger threshold
 * in either direction. Used by the scene's capture controller to decide
 * whether a `getAxis(...)` reading should commit a new binding.
 */
export function isAxisPastCaptureThreshold(axisValue: number): boolean {
  if (typeof axisValue !== 'number' || !Number.isFinite(axisValue)) return false;
  return Math.abs(axisValue) >= CAPTURE_AXIS_TRIGGER_THRESHOLD;
}
