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
  D: 68,
  F: 70,
  G: 71,
  H: 72,
  R: 82,
  S: 83,
  T: 84,
  W: 87,

  // ---- Arrow keys -----------------------------------------------------------
  ARROW_LEFT: 37,
  ARROW_UP: 38,
  ARROW_RIGHT: 39,
  ARROW_DOWN: 40,

  // ---- Numpad (default P2 attack cluster) -----------------------------------
  NUMPAD_0: 96,
  NUMPAD_1: 97,
  NUMPAD_2: 98,
  NUMPAD_3: 99,
  NUMPAD_4: 100,
  NUMPAD_5: 101,

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
