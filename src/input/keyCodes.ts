/**
 * Phaser-free table of the (legacy) `KeyboardEvent.keyCode` values used
 * by the local input handler.
 *
 * Why a hand-rolled table instead of `Phaser.Input.Keyboard.KeyCodes`:
 *   • Engine-core modules — replay logging, the rebinding store, unit
 *     tests — can read these names without pulling Phaser into their
 *     dependency graph. Same separation we use for `bootKeys.ts` and
 *     `collisionCategories.ts`.
 *   • The integers are already standardised (W=87, A=65, …) and Phaser's
 *     `KeyCodes` enum is just a friendlier alias over the same numbers,
 *     so wiring the two together at the adapter boundary is a no-op
 *     identity check.
 *
 * Determinism note: nothing here reads wall-clock or browser state — the
 * table is pure data. The replay system can serialise the bound
 * keyCode for each action and re-hydrate the binding losslessly.
 */

export const KEY_CODE = {
  // ---- Letters --------------------------------------------------------------
  A: 65,
  B: 66,
  D: 68,
  F: 70,
  G: 71,
  H: 72,
  R: 82,
  S: 83,
  T: 84,
  V: 86,
  W: 87,

  // ---- Arrow keys -----------------------------------------------------------
  ARROW_LEFT: 37,
  ARROW_UP: 38,
  ARROW_RIGHT: 39,
  ARROW_DOWN: 40,

  // ---- Numpad (default P2 attack cluster; Numpad 0 is P2's smash) ----------
  NUMPAD_0: 96,
  NUMPAD_1: 97,
  NUMPAD_2: 98,
  NUMPAD_3: 99,
  NUMPAD_4: 100,
  NUMPAD_5: 101,
  NUMPAD_6: 102,
  // 7-9 are bound by no default: rebind targets that stay on the P2 half.
  NUMPAD_7: 103,
  NUMPAD_8: 104,
  NUMPAD_9: 105,

  // ---- Modifiers / common ---------------------------------------------------
  SHIFT: 16,
  CTRL: 17,
  SPACE: 32,
  ENTER: 13,
  BACKSPACE: 8,

  // ---- Function keys --------------------------------------------------------
  // F1 is wired to "Reset all bindings to defaults" on the M5 rebinding
  // screen (AC 5 Sub-AC 4). Listed here so the screen and tests can both
  // reference the canonical numeric value without restating it inline.
  F1: 112,
} as const;

/** Numeric `KeyboardEvent.keyCode` value type. */
export type KeyCode = (typeof KEY_CODE)[keyof typeof KEY_CODE];

/**
 * Keys that mark a binding set as the P2 keyboard half (arrow cluster +
 * numpad). Shared by the Controls device inference and the smash
 * back-fill so both agree on which half a saved layout uses.
 */
const P2_KEYBOARD_HALF_KEY_CODES: ReadonlySet<number> = new Set<number>([
  KEY_CODE.ARROW_UP,
  KEY_CODE.ARROW_DOWN,
  KEY_CODE.ARROW_LEFT,
  KEY_CODE.ARROW_RIGHT,
  KEY_CODE.NUMPAD_0,
  KEY_CODE.NUMPAD_1,
  KEY_CODE.NUMPAD_2,
  KEY_CODE.NUMPAD_3,
  KEY_CODE.NUMPAD_4,
  KEY_CODE.NUMPAD_5,
  KEY_CODE.NUMPAD_6,
  KEY_CODE.NUMPAD_7,
  KEY_CODE.NUMPAD_8,
  KEY_CODE.NUMPAD_9,
]);

/** True when `keyCode` belongs to the P2 keyboard half; anything else is P1. */
export function isP2KeyboardHalfKey(keyCode: number): boolean {
  return P2_KEYBOARD_HALF_KEY_CODES.has(keyCode);
}
