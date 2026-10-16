/**
 * Pure formatting helpers for the M5 rebinding screen — AC 40101 Sub-AC 1.
 *
 * Why a sibling formatter module (mirrors `damageHudFormat.ts`)
 * ------------------------------------------------------------
 *
 * The Phaser-touching renderer (`RebindingScreen.ts`) wires up text
 * objects, click regions, and tween animations. Anything that turns a
 * binding (`{ kind: 'keyboard', keyCode: 87 }`) or a logical action
 * (`'jump'`) into a human-readable string is pure data transformation
 * and lives here. Two reasons:
 *
 *   • Test ergonomics — the formatter suite runs under plain Node /
 *     vitest with no jsdom + Phaser stack to spin up.
 *   • Re-use — the (later) replay-VCR overlay and stage-builder hint
 *     bar can reuse `formatBinding` to label "press X" prompts without
 *     dragging the rebinding screen along.
 *
 * Determinism
 * -----------
 *
 *   • Pure functions: every output depends only on the input. No
 *     `Math.random()`, no wall-clock reads, no Phaser, no DOM.
 *   • Stable ordering — when a binding list contains multiple entries,
 *     they are joined in the array's existing order with " / " (the
 *     same separator Smash Bros. uses on its rebinding screens), so
 *     two calls with the same array yield byte-identical strings.
 *   • Frozen lookup tables — the keycode label table is `Object.freeze`d
 *     so a formatter consumer can't mutate the lookup at runtime.
 */

import { KEY_CODE, isP2KeyboardHalfKey } from '../input/keyCodes';
import type {
  ActionBindings,
  GamepadBinding,
  GamepadBindingSource,
  InputBinding,
  KeyboardBinding,
  LogicalAction,
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';

// ---------------------------------------------------------------------------
// Device label
// ---------------------------------------------------------------------------

/**
 * The high-level device family the rebinding screen's "device selector
 * dropdown" lets a player choose between. The names are deliberately
 * coarse — the player is picking *which keyboard layout* or *which
 * gamepad slot* drives this player slot, not configuring an individual
 * binding.
 *
 * Why a string-literal union and not the `InputDeviceKind` from the
 * binding schema:
 *
 *   • `InputDeviceKind` is `'keyboard' | 'gamepad'` and treats both
 *     keyboards as one option. The screen needs to distinguish P1's
 *     WASD layout from P2's arrow-keys layout because the two keyboards
 *     share one physical device — picking "Keyboard" without saying
 *     which half doesn't disambiguate.
 *   • We add a `'none'` option for slots filled by AI / a CPU player
 *     so the UI has a clear "this player slot has no device" state.
 */
export type RebindingDeviceOption =
  | 'keyboard_p1'
  | 'keyboard_p2'
  | `gamepad_${number}`
  | 'none';

/**
 * Frozen, ordered list of every device option. The screen's selector
 * cycles through this list, so the order doubles as the canonical
 * tab-through order on the screen.
 */
export const REBINDING_DEVICE_OPTIONS: ReadonlyArray<RebindingDeviceOption> =
  Object.freeze([
    'keyboard_p1',
    'keyboard_p2',
    'gamepad_0',
    'gamepad_1',
    'gamepad_2',
    'gamepad_3',
  ]);

/**
 * Default device option per player slot — mirrors the slot policy in
 * `InputBindingsStore.DEFAULT_PLAYER_BINDINGS`. Slots 1-2 default to
 * the two keyboard halves, slots 3-4 default to gamepad 0 / 1.
 */
export const DEFAULT_REBINDING_DEVICE_FOR_SLOT: Readonly<
  Record<PlayerBindingsIndex, RebindingDeviceOption>
> = Object.freeze({
  1: 'keyboard_p1',
  2: 'keyboard_p2',
  3: 'gamepad_0',
  4: 'gamepad_1',
});

const DEVICE_LABELS: Readonly<Record<RebindingDeviceOption, string>> =
  Object.freeze({
    keyboard_p1: 'Device: Keys WASD ›',
    keyboard_p2: 'Device: Keys Arrows ›',
    gamepad_0: 'Device: Controller 1 ›',
    gamepad_1: 'Device: Controller 2 ›',
    gamepad_2: 'Device: Controller 3 ›',
    gamepad_3: 'Device: Controller 4 ›',
    none: 'Device: None ›',
  });

/**
 * Human-readable label for a device option. Used by the dropdown chip
 * on every player panel.
 */
export function formatDeviceLabel(option: RebindingDeviceOption): string {
  if (option.startsWith('gamepad_')) {
    return `Device: Controller ${Number(option.slice(8)) + 1} ›`;
  }
  return DEVICE_LABELS[option]!;
}

/**
 * Cycle to the next device option in `REBINDING_DEVICE_OPTIONS`.
 * Wraps around at the end. The dropdown is implemented as a click-to-
 * cycle chip on Phaser's canvas (no native HTML `<select>` because the
 * scene runs inside the Phaser renderer), so the renderer pre-computes
 * the next option from this helper rather than embedding the cycle
 * order in the scene.
 */
export function nextDeviceOption(option: RebindingDeviceOption): RebindingDeviceOption {
  const i = REBINDING_DEVICE_OPTIONS.indexOf(option);
  /* istanbul ignore next — `option` is a literal-typed enum, indexOf must succeed. */
  if (i < 0) return REBINDING_DEVICE_OPTIONS[0]!;
  return REBINDING_DEVICE_OPTIONS[(i + 1) % REBINDING_DEVICE_OPTIONS.length]!;
}

/**
 * Best-effort device-option inference from a {@link PlayerBindings}.
 * The rebinding screen reads the live store on open and needs to seed
 * each panel's device chip without storing a parallel "selected device"
 * field somewhere. The rules:
 *
 *   • Empty bindings table → `'none'` (no input wired).
 *   • Pure-keyboard bindings → look at the `jump` keyCode to disambiguate
 *     P1 (W) vs. P2 (Up arrow). Falls back to `'keyboard_p1'` if neither
 *     matches — the player still gets a sensible label and can click
 *     to cycle.
 *   • Pure-gamepad bindings → look at the `gamepadIndex` on the first
 *     gameplay binding. `0` → `gamepad_0`, `1` → `gamepad_1`, anything
 *     else → `gamepad_0`.
 *   • Mixed → preserve the first binding's family the same way
 *     ("which keyboard half" / "which pad").
 */
export function inferDeviceOption(
  bindings: PlayerBindings,
): RebindingDeviceOption {
  const probeOrder: ReadonlyArray<LogicalAction> = [
    'jump',
    'left',
    'right',
    'up',
    'down',
    'attack',
  ];
  for (const action of probeOrder) {
    const list = (bindings.bindings[action] ?? []);
    if (list.length === 0) continue;
    const first = list[0]!;
    if (first.kind === 'keyboard') {
      return inferKeyboardHalf(first.keyCode);
    }
    if (first.kind === 'gamepad') {
      return `gamepad_${first.gamepadIndex ?? 0}`;
    }
  }
  return 'none';
}

/**
 * Which keyboard half a key belongs to: the arrow cluster + numpad
 * (including the Numpad 0 smash key) is P2, anything else is P1.
 */
export function inferKeyboardHalf(keyCode: number): 'keyboard_p1' | 'keyboard_p2' {
  return isP2KeyboardHalfKey(keyCode) ? 'keyboard_p2' : 'keyboard_p1';
}

// ---------------------------------------------------------------------------
// Action labels
// ---------------------------------------------------------------------------

const ACTION_LABELS: Readonly<Record<LogicalAction, string>> = Object.freeze({
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down',
  jump: 'Jump',
  attack: 'Attack',
  special: 'Special',
  shield: 'Shield',
  grab: 'Grab',
  // Persisted as `taunt` for profile compatibility; gameplay consumes it as
  // the dedicated dodge action.
  taunt: 'Dodge',
  smash: 'Smash',
  appeal: 'Taunt',
  walk: 'Walk / tilt (hold)',
});

/**
 * Title-cased label for a {@link LogicalAction}. The screen renders one
 * row per action with this label on the left and the formatted bindings
 * on the right.
 */
export function formatActionLabel(action: LogicalAction): string {
  return ACTION_LABELS[action];
}

// ---------------------------------------------------------------------------
// Keycode label
// ---------------------------------------------------------------------------

/**
 * Hand-rolled keyCode → label table covering every key the M5 default
 * presets actually bind, plus a couple of common rebind candidates
 * (Space, Enter, Shift). For codes outside the table we fall back to
 * a `Key 87`-style readout so the UI never renders a blank cell — far
 * better than the player wondering whether the binding even exists.
 *
 * Why a hand-rolled map instead of `String.fromCharCode`:
 *
 *   • Letters (`KEY_CODE.A` → 65) round-trip cleanly via `fromCharCode`,
 *     but the arrow / numpad / modifier keys that the default tables
 *     bind do not. A single table covers both consistently.
 *   • The table is tiny and frozen — no allocation cost per render
 *     frame.
 */
const KEY_LABELS: Readonly<Record<number, string>> = Object.freeze({
  // Letters used by the default keyboard P1 preset.
  [KEY_CODE.A]: 'A',
  [KEY_CODE.D]: 'D',
  [KEY_CODE.F]: 'F',
  [KEY_CODE.G]: 'G',
  [KEY_CODE.H]: 'H',
  [KEY_CODE.R]: 'R',
  [KEY_CODE.S]: 'S',
  [KEY_CODE.T]: 'T',
  [KEY_CODE.V]: 'V',
  [KEY_CODE.W]: 'W',
  // Arrows used by the default keyboard P2 preset.
  [KEY_CODE.ARROW_LEFT]: 'Left Arrow',
  [KEY_CODE.ARROW_UP]: 'Up Arrow',
  [KEY_CODE.ARROW_RIGHT]: 'Right Arrow',
  [KEY_CODE.ARROW_DOWN]: 'Down Arrow',
  // Numpad cluster used by the default keyboard P2 preset.
  [KEY_CODE.NUMPAD_0]: 'Numpad 0',
  [KEY_CODE.NUMPAD_1]: 'Numpad 1',
  [KEY_CODE.NUMPAD_2]: 'Numpad 2',
  [KEY_CODE.NUMPAD_3]: 'Numpad 3',
  [KEY_CODE.NUMPAD_4]: 'Numpad 4',
  [KEY_CODE.NUMPAD_5]: 'Numpad 5',
  [KEY_CODE.NUMPAD_6]: 'Numpad 6',
  [KEY_CODE.NUMPAD_7]: 'Numpad 7',
  [KEY_CODE.NUMPAD_8]: 'Numpad 8',
  [KEY_CODE.NUMPAD_9]: 'Numpad 9',
  // Common rebind candidates the table makes sense to label up front.
  [KEY_CODE.SHIFT]: 'Shift',
  [KEY_CODE.CTRL]: 'Ctrl',
  [KEY_CODE.SPACE]: 'Space',
  [KEY_CODE.ENTER]: 'Enter',
});

/**
 * Label a single keyCode for the rebinding row. Falls through:
 *   1. Curated table (Shift/Ctrl/Space/Arrows/Numpad and the default
 *      letters used by the preset bindings).
 *   2. ASCII letters — `KeyboardEvent.keyCode` for letters matches the
 *      uppercase ASCII codepoint, so 65..90 → "A".."Z". Critical for
 *      AZERTY users rebinding to keys like Z (keyCode 90, which the
 *      curated table doesn't include because none of the default
 *      presets use Z).
 *   3. ASCII digits — top-row 48..57 → "0".."9".
 *   4. `Key {n}` numeric fallback for anything truly unknown.
 */
export function formatKeyCode(keyCode: number): string {
  const label = KEY_LABELS[keyCode];
  if (label !== undefined) return label;
  if (keyCode >= 65 && keyCode <= 90) return String.fromCharCode(keyCode);
  if (keyCode >= 48 && keyCode <= 57) return String.fromCharCode(keyCode);
  return `Key ${keyCode}`;
}

// ---------------------------------------------------------------------------
// Gamepad label
// ---------------------------------------------------------------------------

const STANDARD_BUTTON_LABELS: Readonly<Record<number, string>> = Object.freeze({
  0: 'A',
  1: 'B',
  2: 'X',
  3: 'Y',
  4: 'LB',
  5: 'RB',
  6: 'LT',
  7: 'RT',
  8: 'Back',
  9: 'Start',
  10: 'L3',
  11: 'R3',
  12: 'D-Up',
  13: 'D-Down',
  14: 'D-Left',
  15: 'D-Right',
});

const STANDARD_AXIS_LABELS: Readonly<Record<number, string>> = Object.freeze({
  0: 'LS-X',
  1: 'LS-Y',
  2: 'RS-X',
  3: 'RS-Y',
});

/**
 * Label a {@link GamepadBindingSource}. Buttons → "A" / "LB" / etc.
 * via the standard W3C gamepad layout; axes → "LS-X +" with a sign
 * suffix and the configured threshold so a player can see "stick must
 * push past 0.5 to count".
 */
export function formatGamepadSource(source: GamepadBindingSource): string {
  if (source.type === 'button') {
    const label = STANDARD_BUTTON_LABELS[source.buttonIndex];
    return label ?? `Btn ${source.buttonIndex}`;
  }
  // axis
  const axisLabel =
    STANDARD_AXIS_LABELS[source.axisIndex] ?? `Axis ${source.axisIndex}`;
  const sign = source.direction > 0 ? '+' : '−';
  return `${axisLabel} ${sign}`;
}

/**
 * Format a single {@link GamepadBinding}. The pad index appears in
 * `[brackets]` so the rebinding row reads "[1] LS-X +" — players can
 * tell which physical pad owns which binding at a glance even when
 * two pads share the same standard mapping.
 */
export function formatGamepadBinding(binding: GamepadBinding): string {
  return `${formatPadTag(binding.gamepadIndex)} ${formatGamepadSource(binding.source)}`;
}

function formatPadTag(gamepadIndex: number | null): string {
  return gamepadIndex === null ? '[any]' : `[${gamepadIndex + 1}]`;
}

// ---------------------------------------------------------------------------
// Whole-stick display
// ---------------------------------------------------------------------------

/** Names for sticks on the standard mapping, keyed by their X axis. */
const STICK_LABELS: Readonly<Record<number, string>> = Object.freeze({
  0: 'Left Stick',
  2: 'Right Stick',
});

/**
 * "[1] Left Stick" / "[any] Right Stick" for any axis of a named stick
 * (0/1 left, 2/3 right on the standard mapping); `null` for any other
 * axis. Used where a whole stick stands in for its half-axes.
 */
export function formatStickLabel(gamepadIndex: number | null, axisIndex: number): string | null {
  const label = STICK_LABELS[axisIndex & ~1];
  return label === undefined || axisIndex < 0 ? null : `${formatPadTag(gamepadIndex)} ${label}`;
}

/**
 * One entry of a binding list as displayed: either a single binding, or
 * a whole stick standing in for its four half-axis bindings.
 */
export type BindingDisplayItem =
  | { readonly kind: 'binding'; readonly binding: InputBinding }
  | { readonly kind: 'stick'; readonly gamepadIndex: number | null; readonly label: string };

function stickKey(gamepadIndex: number | null, xAxis: number): string {
  return `${gamepadIndex === null ? 'any' : gamepadIndex}:${xAxis}`;
}

/**
 * Collapse every complete four-half-axis set of one named stick on one
 * pad (X−, X+, Y−, Y+ in any order and threshold) into a single stick
 * item at the position of its first half-axis. Partial sets stay as
 * individual half-axes so the player can see which directions are bound.
 */
export function groupStickBindings(
  bindings: ReadonlyArray<InputBinding>,
): BindingDisplayItem[] {
  const halves = new Map<string, Set<string>>();
  for (const binding of bindings) {
    if (binding.kind !== 'gamepad' || binding.source.type !== 'axis') continue;
    const xAxis = binding.source.axisIndex & ~1;
    if (STICK_LABELS[xAxis] === undefined) continue;
    const key = stickKey(binding.gamepadIndex, xAxis);
    const set = halves.get(key) ?? new Set<string>();
    set.add(`${binding.source.axisIndex}:${binding.source.direction}`);
    halves.set(key, set);
  }
  const complete = new Set(
    [...halves].filter(([, set]) => set.size === 4).map(([key]) => key),
  );
  const items: BindingDisplayItem[] = [];
  const emitted = new Set<string>();
  for (const binding of bindings) {
    if (binding.kind === 'gamepad' && binding.source.type === 'axis') {
      const xAxis = binding.source.axisIndex & ~1;
      const key = stickKey(binding.gamepadIndex, xAxis);
      if (complete.has(key)) {
        if (!emitted.has(key)) {
          emitted.add(key);
          items.push({ kind: 'stick', gamepadIndex: binding.gamepadIndex, label: STICK_LABELS[xAxis]! });
        }
        continue;
      }
    }
    items.push({ kind: 'binding', binding });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Generic binding + binding list
// ---------------------------------------------------------------------------

/** Format a single binding regardless of family. */
export function formatBinding(binding: InputBinding): string {
  if (binding.kind === 'keyboard') {
    return formatKeyCode((binding as KeyboardBinding).keyCode);
  }
  return formatGamepadBinding(binding as GamepadBinding);
}

/**
 * Format a binding list. An empty list reads "—" (em dash) so a
 * deliberately-unbound action is visually distinct from a single bound
 * key. Multi-entry lists join with " / " (Smash Bros. convention).
 */
export function formatBindingList(
  bindings: ReadonlyArray<InputBinding>,
): string {
  if (bindings.length === 0) return '—';
  // A whole stick reads "[1] Right Stick" rather than four half-axes,
  // which would not fit the row.
  return groupStickBindings(bindings)
    .map((item) => item.kind === 'stick'
      ? `${formatPadTag(item.gamepadIndex)} ${item.label}`
      : formatBinding(item.binding))
    .join(' / ');
}

/**
 * One player's line of the in-match controls cheat-sheet, e.g.
 * "P1: A/D/W/S move | F attack | V smash | G special | H shield | R dodge | T grab".
 * Every label comes from {@link formatBindingList}, so a remap shows the
 * player's real inputs and a whole stick reads "[1] Right Stick". Dodge
 * is the `taunt` action (its persisted name).
 */
export function formatControlsHelpLine(tag: string, bindings: ActionBindings): string {
  const label = (action: LogicalAction) => formatBindingList((bindings[action] ?? []));
  const move = (['left', 'right', 'up', 'down'] as const).map(label).join('/');
  return `${tag}: ${move} move | ${label('attack')} attack | ${label('smash')} smash | `
    + `${label('special')} special | ${label('shield')} shield | ${label('taunt')} dodge | ${label('grab')} grab | ${label('appeal')} taunt`;
}

// ---------------------------------------------------------------------------
// Action-row data shape
// ---------------------------------------------------------------------------

/**
 * One row's worth of data for a player panel's action list. Pure data
 * — no Phaser objects, no closures — so the renderer can derive every
 * panel layout once at construction and cache it.
 */
export interface RebindingActionRow {
  readonly action: LogicalAction;
  readonly actionLabel: string;
  readonly bindingLabel: string;
}

/**
 * Build the ordered action-row list for one player. Iterates
 * `LOGICAL_ACTIONS` in its canonical (movement → attacks → social)
 * order, so panels render row-aligned across all four players — a
 * player can compare slots horizontally without their eyes jumping.
 */
export function buildActionRows(
  bindings: ActionBindings,
  actionOrder: ReadonlyArray<LogicalAction>,
): RebindingActionRow[] {
  const rows: RebindingActionRow[] = [];
  for (const action of actionOrder) {
    rows.push({
      action,
      actionLabel: formatActionLabel(action),
      bindingLabel: formatBindingList((bindings[action] ?? [])),
    });
  }
  return rows;
}
