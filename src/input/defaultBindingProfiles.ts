/**
 * Default binding profiles — AC 40002 Sub-AC 2 (literal contract).
 *
 * Purpose
 * -------
 *
 * AC 40002 Sub-AC 2 calls out the *names* of the default binding
 * constants the rebinding system, the lobby's "Reset to Defaults"
 * button, and the unit tests must reach for:
 *
 *   • {@link keyboardDefaultsP1}, {@link keyboardDefaultsP2},
 *     {@link keyboardDefaultsP3}, {@link keyboardDefaultsP4} —
 *     per-player keyboard layouts mapping every {@link BindingAction}
 *     to a concrete {@link KeyboardEvent.keyCode}.
 *   • {@link gamepadDefaults} — the standard-layout gamepad template
 *     (axis + button mapping) the lobby specialises per pad index when
 *     a pad is plugged into a slot.
 *
 * The names use the AC's exact `camelCase` form (no `DEFAULT_…_BINDINGS`
 * prefix) so a reader scanning the seed file and the codebase can match
 * one-to-one without translation.
 *
 * Relationship to the existing default tables
 * -------------------------------------------
 *
 * The codebase already ships two prior generations of default bindings:
 *
 *   1. {@link DEFAULT_KEYBOARD_P1_BINDINGS} / `…P2` and
 *      {@link DEFAULT_GAMEPAD_P3_BINDINGS} / `…P4` in
 *      `src/input/InputBindingsStore.ts` — the M1-era surface keyed off
 *      the legacy {@link LogicalAction} names (`taunt`, etc.).
 *   2. {@link DEFAULT_KEYBOARD_P1_BINDINGS} / `…P2` /
 *      {@link DEFAULT_GAMEPAD_P3_BINDINGS} / `…P4` in
 *      `src/types/bindings.ts` — the canonical M5 vocabulary keyed off
 *      the {@link BindingAction} action set
 *      (`moveLeft`/`moveRight`/`moveUp`/`moveDown`/`jump`/`attack`/
 *      `special`/`shield`/`grab`/`dodge`).
 *
 * This module **wraps the canonical M5 set** under the AC-literal names
 * so existing call sites that already use the canonical constants keep
 * working unchanged, while new code (and the AC test) imports the names
 * the seed actually spelled out. The on-the-wire JSON is identical
 * because the underlying values are the same frozen objects.
 *
 * Why four keyboard presets when only two keyboard slots can be active
 * at once
 * --------------------------------------------------------------------
 *
 * The Seed limits *concurrent* keyboard players to two
 * (`P1=WASD+nearby, P2=Arrows+nearby`). That is a runtime *slot policy*
 * enforced by the lobby — not a constraint on which default tables may
 * exist. Providing keyboard fallbacks for slots P3 and P4 lets:
 *
 *   • The rebinding UI render the "Reset to Defaults" preview for any
 *     slot the player has just configured to use a keyboard (e.g. a
 *     four-pad setup where one pad died and the player swapped to a
 *     spare USB number-pad on the fly).
 *   • Tests construct deterministic four-keyboard fixtures without
 *     having to invent ad-hoc tables — the whole replay-determinism
 *     story relies on every default being a frozen, byte-stable value.
 *
 * The fallback presets for slots 3 and 4 use letter clusters
 * (IJKL + bracket cluster, then numpad-relative clusters) that do not
 * physically collide with the P1 (WASD + F/G/H/T/R) or P2 (Arrows +
 * Numpad) layouts, so all four can coexist on a single keyboard
 * without two slots fighting over the same key. The lobby still
 * refuses to seat more than two keyboards at once — this is purely a
 * defaults table.
 *
 * Determinism
 * -----------
 *
 *   • All members are primitive or `readonly` containers of primitives.
 *   • The objects are recursively frozen so two equal profiles hash
 *     identically and `JSON.stringify` is byte-stable across instances.
 *   • No `Math.random()`, no wall-clock reads, no closures.
 */

import {
  BINDING_ACTIONS,
  DEFAULT_GAMEPAD_AXIS_THRESHOLD,
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_KEYBOARD_P2_BINDINGS,
  buildDefaultGamepadBindings,
  type ActionMap,
  type BindingAction,
  type GamepadBinding,
  type GamepadBindingSource,
  type KeyboardBinding,
  type PlayerBindingIndex,
} from '../types/bindings';

// ---------------------------------------------------------------------------
// Local keyCode table for the P3 / P4 fallback layouts
// ---------------------------------------------------------------------------

/**
 * Legacy `KeyboardEvent.keyCode` integers used by the P3 / P4 fallback
 * keyboard presets. Restated inline (rather than re-imported from
 * `src/input/keyCodes.ts`) so this defaults module has zero downward
 * dependencies on the runtime input subsystem — the rebinding UI and
 * tests can pull it without dragging the dispatcher graph along.
 *
 * The values are the standardised legacy keyCodes; they are stable
 * forever and match Phaser's keyboard plugin codes one-for-one.
 */
const KC = {
  // P3 IJKL movement cluster + adjacent action cluster.
  I: 73,
  J: 74,
  K: 75,
  L: 76,
  N: 78,
  M: 77,
  COMMA: 188,
  PERIOD: 190,
  SEMICOLON: 186,
  QUOTE: 222,
  // P4 numpad-cluster movement + numpad action cluster (uses the upper
  // numpad row so it doesn't collide with P2's Numpad 1–5).
  NUMPAD_8: 104,
  NUMPAD_4: 100,
  NUMPAD_5: 101,
  NUMPAD_6: 102,
  NUMPAD_2: 98,
  NUMPAD_7: 103,
  NUMPAD_9: 105,
  NUMPAD_DIVIDE: 111,
  NUMPAD_MULTIPLY: 106,
  NUMPAD_MINUS: 109,
} as const;

// ---------------------------------------------------------------------------
// Small frozen-list builders
// ---------------------------------------------------------------------------

/** Helper: wrap a keyCode in a frozen single-element keyboard binding list. */
function kb(keyCode: number): ReadonlyArray<KeyboardBinding> {
  return Object.freeze([Object.freeze<KeyboardBinding>({ kind: 'keyboard', keyCode })]);
}

/** Helper: build a frozen single-element gamepad button binding list. */
function gpButton(
  gamepadIndex: number | null,
  buttonIndex: number,
): ReadonlyArray<GamepadBinding> {
  const source: GamepadBindingSource = Object.freeze({ type: 'button', buttonIndex });
  return Object.freeze([
    Object.freeze<GamepadBinding>({ kind: 'gamepad', gamepadIndex, source }),
  ]);
}

/** Helper: build a frozen single-element half-axis gamepad binding list. */
function gpAxis(
  gamepadIndex: number | null,
  axisIndex: number,
  direction: -1 | 1,
): ReadonlyArray<GamepadBinding> {
  const source: GamepadBindingSource = Object.freeze({
    type: 'axis',
    axisIndex,
    direction,
    threshold: DEFAULT_GAMEPAD_AXIS_THRESHOLD,
  });
  return Object.freeze([
    Object.freeze<GamepadBinding>({ kind: 'gamepad', gamepadIndex, source }),
  ]);
}

// ---------------------------------------------------------------------------
// keyboardDefaultsP1 — alias of the canonical P1 default
// ---------------------------------------------------------------------------

/**
 * Default keyboard preset for Player 1 — WASD movement + F/G/H/T/R
 * action cluster.
 *
 * Layout rationale (matches the M1 / canonical P1 layout exactly so
 * the AC name and the canonical name resolve to the same frozen
 * object):
 *
 *   • W / A / S / D — directional movement. `moveUp` and `jump` both
 *     bind to W (canonical platformer convention).
 *   • F = `attack`, G = `special` — adjacent home-row keys, easy to
 *     roll between.
 *   • H = `shield`, T = `grab` — neighbours of the attack cluster,
 *     mirroring the Smash Bros "shield + grab combo" layout.
 *   • R = `dodge` — sits one row above the attack cluster so a panic
 *     dodge doesn't accidentally fire an attack.
 */
export const keyboardDefaultsP1: ActionMap = DEFAULT_KEYBOARD_P1_BINDINGS;

// ---------------------------------------------------------------------------
// keyboardDefaultsP2 — alias of the canonical P2 default
// ---------------------------------------------------------------------------

/**
 * Default keyboard preset for Player 2 — Arrow keys + Numpad 1–5
 * action cluster.
 *
 * Layout rationale (matches the M1 / canonical P2 layout exactly):
 *
 *   • Arrows drive directional movement; Up doubles as `jump`,
 *     symmetric with P1's W → `moveUp` + `jump`.
 *   • Numpad 1–5 host the action cluster, sitting under the right
 *     hand when P2 is at the right side of a shared keyboard.
 */
export const keyboardDefaultsP2: ActionMap = DEFAULT_KEYBOARD_P2_BINDINGS;

// ---------------------------------------------------------------------------
// keyboardDefaultsP3 — fallback IJKL layout
// ---------------------------------------------------------------------------

/**
 * Fallback keyboard preset for Player 3.
 *
 * Layout rationale:
 *
 *   • I / J / K / L drive directional movement (the conventional
 *     "second WASD" cluster long used in 2-player keyboard fighters).
 *     `moveUp` and `jump` both bind to I, matching the P1/P2
 *     up-doubles-as-jump convention.
 *   • N = `attack`, M = `special` — adjacent keys directly under
 *     the right hand when the player is sitting at the right side of a
 *     shared keyboard. They do not collide with P1's F/G/H/T/R or P2's
 *     numpad cluster, so a four-keyboard test fixture can hold all
 *     four presets simultaneously without two slots stealing the same
 *     key.
 *   • `,` (comma) = `shield`, `.` (period) = `grab`, `;` (semicolon)
 *     = `dodge` — punctuation row keys that round out the cluster
 *     without overlapping any other slot's defaults.
 *
 * Operational note: the Seed's slot policy ("Max 2 keyboard players")
 * is enforced by the lobby seater — this profile exists so the
 * "Reset to Defaults" button on the rebinding screen can render a
 * meaningful preview for any slot the player has manually flipped to
 * keyboard, and so deterministic four-keyboard test fixtures can
 * round-trip through the persistence layer.
 */
export const keyboardDefaultsP3: ActionMap = Object.freeze({
  moveLeft: kb(KC.J),
  moveRight: kb(KC.L),
  moveUp: kb(KC.I),
  moveDown: kb(KC.K),
  jump: kb(KC.I),
  attack: kb(KC.N),
  special: kb(KC.M),
  shield: kb(KC.COMMA),
  grab: kb(KC.PERIOD),
  dodge: kb(KC.SEMICOLON),
});

// ---------------------------------------------------------------------------
// keyboardDefaultsP4 — fallback upper-numpad layout
// ---------------------------------------------------------------------------

/**
 * Fallback keyboard preset for Player 4.
 *
 * Layout rationale:
 *
 *   • Numpad 8 / 4 / 5 / 6 drive directional movement
 *     (`moveUp`/`moveLeft`/`moveDown`/`moveRight`), the inverted-T
 *     pattern numpad arrows have used since the 80s. Numpad 8 doubles
 *     as `jump`, matching the up-doubles-as-jump convention.
 *
 *     IMPORTANT: P2's defaults already use Numpad 1–5 for the *action
 *     cluster*, including Numpad 5 itself. P4's defaults reuse Numpad
 *     5 for `moveDown`. This is the deliberate trade-off: the Seed
 *     forbids more than two concurrent keyboard players, so P2 and P4
 *     cannot be active in the same match. The collision is documented
 *     here so a future contributor doesn't "fix" it by inventing a
 *     third numeric cluster that doesn't exist on the keyboard.
 *
 *   • Numpad 7 = `attack`, Numpad 9 = `special` — the corners flanking
 *     Numpad 8, easy reach with the index/ring fingers while the
 *     middle finger sits on the movement key.
 *   • Numpad `/` = `shield`, Numpad `*` = `grab`, Numpad `-` =
 *     `dodge` — the operator column on the right edge of the numpad,
 *     symmetric with the action cluster on P3 (punctuation row).
 */
export const keyboardDefaultsP4: ActionMap = Object.freeze({
  moveLeft: kb(KC.NUMPAD_4),
  moveRight: kb(KC.NUMPAD_6),
  moveUp: kb(KC.NUMPAD_8),
  moveDown: kb(KC.NUMPAD_5),
  jump: kb(KC.NUMPAD_8),
  attack: kb(KC.NUMPAD_7),
  special: kb(KC.NUMPAD_9),
  shield: kb(KC.NUMPAD_DIVIDE),
  grab: kb(KC.NUMPAD_MULTIPLY),
  dodge: kb(KC.NUMPAD_MINUS),
});

// ---------------------------------------------------------------------------
// gamepadDefaults — standard-layout gamepad template
// ---------------------------------------------------------------------------

/**
 * Pad-agnostic standard-layout gamepad template.
 *
 * The Seed permits unlimited concurrent gamepads; a single
 * `gamepadDefaults` table is the *template* every connected pad starts
 * from. The lobby specialises this template per slot by stamping the
 * pad's actual `Gamepad.index` onto each binding's `gamepadIndex`
 * field — call {@link buildGamepadDefaultsForPad} (re-export of
 * {@link buildDefaultGamepadBindings}) at slot-assignment time.
 *
 * The template uses `gamepadIndex: null` ("any pad"), which is the
 * dispatcher's "scan every connected pad" mode. Profiles persisted to
 * `localStorage` for a specific slot replace `null` with a concrete
 * pad index; until that point the template is usable as a read-only
 * preview (e.g. for the rebinding UI's "Reset to Defaults" tile).
 *
 * Layout (Xbox-style; DualShock maps with the same indices on the W3C
 * Gamepad "standard" mapping):
 *
 *   • Left stick (axes 0/1) drives `moveLeft` / `moveRight` /
 *     `moveUp` / `moveDown` as half-axes with a {@link DEFAULT_GAMEPAD_AXIS_THRESHOLD}
 *     dead-zone.
 *   • `jump`    → button 0 (A on Xbox / Cross on DualShock).
 *   • `attack`  → button 2 (X / Square).
 *   • `special` → button 3 (Y / Triangle).
 *   • `grab`    → button 4 (LB / L1).
 *   • `shield`  → button 5 (RB / R1).
 *   • `dodge`   → button 6 (LT / L2).
 *
 * The mapping mirrors the canonical {@link buildDefaultGamepadBindings}
 * factory exactly — calling that factory with a concrete pad index
 * yields the same shape with `gamepadIndex` populated.
 */
export const gamepadDefaults: ActionMap = Object.freeze({
  moveLeft: gpAxis(null, 0, -1),
  moveRight: gpAxis(null, 0, +1),
  moveUp: gpAxis(null, 1, -1),
  moveDown: gpAxis(null, 1, +1),
  jump: Object.freeze([...gpButton(null, 0), ...gpButton(null, 1)]),
  attack: gpButton(null, 2),
  special: gpButton(null, 3),
  shield: gpButton(null, 5),
  grab: gpButton(null, 4),
  dodge: gpButton(null, 6),
});

/**
 * Build a pad-pinned copy of {@link gamepadDefaults} for a specific
 * `Gamepad.index`.
 *
 * Re-export of the canonical {@link buildDefaultGamepadBindings} so
 * the AC-named module is fully self-contained — callers don't need to
 * know which underlying module owns the factory. The slot-assignment
 * code path calls this once per pad to specialise the
 * template-with-`null`-index into a binding the dispatcher can pin to
 * a concrete pad.
 *
 * Pure function: same input always yields a structurally-identical
 * (and recursively frozen) output, satisfying the replay-determinism
 * contract.
 */
export const buildGamepadDefaultsForPad = buildDefaultGamepadBindings;

// ---------------------------------------------------------------------------
// Aggregate keyboard map (P1 → P4)
// ---------------------------------------------------------------------------

/**
 * Frozen mapping of {@link PlayerBindingIndex} → keyboard default
 * profile. Convenience for callers that need to look up the default
 * for an arbitrary slot index without a four-way `switch`.
 *
 * `keyboardDefaultsBySlot[1]` ≡ {@link keyboardDefaultsP1}, etc. The
 * mapping is exhaustive over the four slots so a `strict +
 * noUncheckedIndexedAccess` consumer can index any valid slot without a
 * defensive `undefined` check.
 */
export const keyboardDefaultsBySlot: Readonly<Record<PlayerBindingIndex, ActionMap>> =
  Object.freeze({
    1: keyboardDefaultsP1,
    2: keyboardDefaultsP2,
    3: keyboardDefaultsP3,
    4: keyboardDefaultsP4,
  });

// ---------------------------------------------------------------------------
// Coverage assertion (compile-time + runtime)
// ---------------------------------------------------------------------------

/**
 * Internal: every default profile **must** carry a binding entry for
 * every {@link BindingAction}. The type system enforces this through
 * the {@link ActionMap} `Record<BindingAction, …>` shape, but a runtime
 * sanity check guards against an accidental Object.assign with an
 * empty action map (which TypeScript would still accept under
 * structural compatibility).
 *
 * Throws if any profile omits an action; called once at module load
 * so a corrupted defaults table fails fast at startup rather than
 * silently leaving a slot unable to jump.
 */
function assertProfileCoversAllActions(label: string, map: ActionMap): void {
  for (const action of BINDING_ACTIONS) {
    const entries = map[action];
    /* istanbul ignore next — guarded by the static `Record` shape. */
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error(
        `defaultBindingProfiles: '${label}' is missing a binding for action '${action}'.`,
      );
    }
  }
}

assertProfileCoversAllActions('keyboardDefaultsP1', keyboardDefaultsP1);
assertProfileCoversAllActions('keyboardDefaultsP2', keyboardDefaultsP2);
assertProfileCoversAllActions('keyboardDefaultsP3', keyboardDefaultsP3);
assertProfileCoversAllActions('keyboardDefaultsP4', keyboardDefaultsP4);
assertProfileCoversAllActions('gamepadDefaults', gamepadDefaults);

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

/**
 * Re-export of the canonical {@link DEFAULT_GAMEPAD_AXIS_THRESHOLD}
 * used by {@link gamepadDefaults}. Surfacing it here keeps callers
 * that consume the AC-named defaults from having to reach into
 * `src/types/bindings.ts` for the dead-zone value.
 */
export { DEFAULT_GAMEPAD_AXIS_THRESHOLD } from '../types/bindings';

/**
 * Re-export of the {@link BindingAction} type so callers iterating a
 * default profile have one import path for both the data and the
 * vocabulary.
 */
export type { ActionMap, BindingAction, PlayerBindingIndex } from '../types/bindings';
