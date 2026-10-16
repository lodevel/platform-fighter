import { describe, it, expect } from 'vitest';
import {
  REBINDING_DEVICE_OPTIONS,
  DEFAULT_REBINDING_DEVICE_FOR_SLOT,
  buildActionRows,
  formatActionLabel,
  formatBinding,
  formatBindingList,
  formatControlsHelpLine,
  formatDeviceLabel,
  formatGamepadBinding,
  formatGamepadSource,
  formatKeyCode,
  formatStickLabel,
  groupStickBindings,
  inferDeviceOption,
  inferKeyboardHalf,
  nextDeviceOption,
} from './rebindingScreenFormat';
import { KEY_CODE } from '../input/keyCodes';
import {
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_KEYBOARD_P2_BINDINGS,
  DEFAULT_GAMEPAD_P3_BINDINGS,
  DEFAULT_GAMEPAD_P4_BINDINGS,
  DEFAULT_PLAYER_BINDINGS,
  buildStickHalfAxisBindings,
} from '../input/InputBindingsStore';
import {
  LOGICAL_ACTIONS,
  type GamepadBinding,
  type KeyboardBinding,
  type PlayerBindings,
} from '../types/inputBindings';

/**
 * AC 40101 Sub-AC 1 — pure formatting helpers used by the rebinding
 * screen layout.
 *
 * Locks down:
 *
 *   1. Device option vocabulary — every panel's dropdown cycles through
 *      a frozen, ordered list and every option carries a human-readable
 *      label.
 *   2. Action labels — each {@link LogicalAction} maps to a fixed
 *      title-cased string. Renaming an action without updating the
 *      label table is caught here.
 *   3. Key-code labels — covers every keyCode bound by the M1 default
 *      presets plus a controlled fallback for unfamiliar codes.
 *   4. Gamepad source labels — buttons map to W3C standard names
 *      (A / B / X / Y / LB / …); axes carry an "LS-X +" sign suffix.
 *   5. Binding-list join — empty lists render "—", multi-entry lists
 *      use a stable " / " separator so two equivalent arrays produce
 *      byte-identical strings.
 *   6. Action-row builder — yields one row per action in the supplied
 *      order, each row carrying the action ID + label + formatted
 *      binding string.
 *   7. `inferDeviceOption` — round-trips the four default presets back
 *      to the right device option so a fresh store opens with each
 *      panel's chip pointing at the slot's policy default.
 */

// ---------------------------------------------------------------------------

describe('rebindingScreenFormat — device options', () => {
  it('cycles keyboard layouts and four physical controllers without unassigning a player', () => {
    expect(Object.isFrozen(REBINDING_DEVICE_OPTIONS)).toBe(true);
    expect(REBINDING_DEVICE_OPTIONS).toEqual([
      'keyboard_p1',
      'keyboard_p2',
      'gamepad_0',
      'gamepad_1',
      'gamepad_2',
      'gamepad_3',
    ]);
  });

  it('DEFAULT_REBINDING_DEVICE_FOR_SLOT mirrors the per-slot default policy', () => {
    expect(DEFAULT_REBINDING_DEVICE_FOR_SLOT[1]).toBe('keyboard_p1');
    expect(DEFAULT_REBINDING_DEVICE_FOR_SLOT[2]).toBe('keyboard_p2');
    expect(DEFAULT_REBINDING_DEVICE_FOR_SLOT[3]).toBe('gamepad_0');
    expect(DEFAULT_REBINDING_DEVICE_FOR_SLOT[4]).toBe('gamepad_1');
  });

  it('formatDeviceLabel returns a human-readable label for every option', () => {
    for (const opt of REBINDING_DEVICE_OPTIONS) {
      expect(typeof formatDeviceLabel(opt)).toBe('string');
      expect(formatDeviceLabel(opt).length).toBeGreaterThan(0);
    }
    // Spot-check a couple to lock the wording.
    expect(formatDeviceLabel('keyboard_p1')).toBe('Device: Keys WASD ›');
    expect(formatDeviceLabel('keyboard_p2')).toBe('Device: Keys Arrows ›');
    expect(formatDeviceLabel('gamepad_0')).toBe('Device: Controller 1 ›');
    expect(formatDeviceLabel('gamepad_3')).toBe('Device: Controller 4 ›');
    expect(formatDeviceLabel('gamepad_6')).toBe('Device: Controller 7 ›');
    expect(formatDeviceLabel('none')).toBe('Device: None ›');
  });

  it('nextDeviceOption walks through every option and wraps around', () => {
    let opt = REBINDING_DEVICE_OPTIONS[0]!;
    const visited: string[] = [opt];
    for (let i = 0; i < REBINDING_DEVICE_OPTIONS.length; i += 1) {
      opt = nextDeviceOption(opt);
      visited.push(opt);
    }
    // First step forward → second option.
    expect(visited[1]).toBe(REBINDING_DEVICE_OPTIONS[1]);
    // After N cycles we should be back at the starting option.
    expect(visited[REBINDING_DEVICE_OPTIONS.length]).toBe(visited[0]);
  });
});

describe('rebindingScreenFormat — action labels', () => {
  it('every LogicalAction has a title-cased label', () => {
    for (const action of LOGICAL_ACTIONS) {
      const label = formatActionLabel(action);
      expect(label.length).toBeGreaterThan(0);
      // First char uppercased.
      expect(label[0]).toBe(label[0]!.toUpperCase());
    }
  });

  it('returns the canonical label for a sample of actions', () => {
    expect(formatActionLabel('left')).toBe('Left');
    expect(formatActionLabel('jump')).toBe('Jump');
    expect(formatActionLabel('attack')).toBe('Attack');
    expect(formatActionLabel('taunt')).toBe('Dodge');
    expect(formatActionLabel('smash')).toBe('Smash');
  });
});

describe('rebindingScreenFormat — smash keys', () => {
  it('labels the default smash keys and the rest of the numpad', () => {
    expect(formatKeyCode(KEY_CODE.V)).toBe('V');
    expect(formatKeyCode(KEY_CODE.NUMPAD_0)).toBe('Numpad 0');
    for (const digit of [6, 7, 8, 9]) expect(formatKeyCode(96 + digit)).toBe(`Numpad ${digit}`);
  });

  it('treats every numpad digit as a P2-half key and V as a P1-half key', () => {
    for (let digit = 0; digit <= 9; digit += 1) expect(inferKeyboardHalf(96 + digit)).toBe('keyboard_p2');
    expect(inferKeyboardHalf(KEY_CODE.ARROW_UP)).toBe('keyboard_p2');
    expect(inferKeyboardHalf(KEY_CODE.V)).toBe('keyboard_p1');
  });
});

describe('rebindingScreenFormat — keycode labels', () => {
  it('returns the curated label for every key the M1 defaults bind', () => {
    expect(formatKeyCode(KEY_CODE.W)).toBe('W');
    expect(formatKeyCode(KEY_CODE.A)).toBe('A');
    expect(formatKeyCode(KEY_CODE.S)).toBe('S');
    expect(formatKeyCode(KEY_CODE.D)).toBe('D');
    expect(formatKeyCode(KEY_CODE.F)).toBe('F');
    expect(formatKeyCode(KEY_CODE.G)).toBe('G');
    expect(formatKeyCode(KEY_CODE.H)).toBe('H');
    expect(formatKeyCode(KEY_CODE.T)).toBe('T');
    expect(formatKeyCode(KEY_CODE.R)).toBe('R');
    expect(formatKeyCode(KEY_CODE.ARROW_LEFT)).toBe('Left Arrow');
    expect(formatKeyCode(KEY_CODE.ARROW_RIGHT)).toBe('Right Arrow');
    expect(formatKeyCode(KEY_CODE.ARROW_UP)).toBe('Up Arrow');
    expect(formatKeyCode(KEY_CODE.ARROW_DOWN)).toBe('Down Arrow');
    expect(formatKeyCode(KEY_CODE.NUMPAD_1)).toBe('Numpad 1');
    expect(formatKeyCode(KEY_CODE.NUMPAD_5)).toBe('Numpad 5');
  });

  it('falls back to "Key {n}" for codes outside the curated table', () => {
    expect(formatKeyCode(123456)).toBe('Key 123456');
  });

  it('labels common rebind candidates (Space / Enter / Shift)', () => {
    expect(formatKeyCode(KEY_CODE.SPACE)).toBe('Space');
    expect(formatKeyCode(KEY_CODE.ENTER)).toBe('Enter');
    expect(formatKeyCode(KEY_CODE.SHIFT)).toBe('Shift');
  });
});

describe('rebindingScreenFormat — gamepad sources', () => {
  it('formats W3C standard buttons by their Xbox-layout names', () => {
    expect(formatGamepadSource({ type: 'button', buttonIndex: 0 })).toBe('A');
    expect(formatGamepadSource({ type: 'button', buttonIndex: 1 })).toBe('B');
    expect(formatGamepadSource({ type: 'button', buttonIndex: 2 })).toBe('X');
    expect(formatGamepadSource({ type: 'button', buttonIndex: 3 })).toBe('Y');
    expect(formatGamepadSource({ type: 'button', buttonIndex: 4 })).toBe('LB');
    expect(formatGamepadSource({ type: 'button', buttonIndex: 5 })).toBe('RB');
  });

  it('falls back to "Btn {n}" for buttons outside the standard layout', () => {
    expect(formatGamepadSource({ type: 'button', buttonIndex: 99 })).toBe('Btn 99');
  });

  it('labels axes with a sign suffix matching the half-axis direction', () => {
    expect(
      formatGamepadSource({ type: 'axis', axisIndex: 0, direction: -1, threshold: 0.5 }),
    ).toContain('LS-X');
    expect(
      formatGamepadSource({ type: 'axis', axisIndex: 0, direction: -1, threshold: 0.5 }),
    ).toContain('−');
    expect(
      formatGamepadSource({ type: 'axis', axisIndex: 1, direction: 1, threshold: 0.5 }),
    ).toContain('LS-Y');
    expect(
      formatGamepadSource({ type: 'axis', axisIndex: 1, direction: 1, threshold: 0.5 }),
    ).toContain('+');
  });

  it('formatGamepadBinding tags the pad index in [brackets]', () => {
    const binding: GamepadBinding = {
      kind: 'gamepad',
      gamepadIndex: 0,
      source: { type: 'button', buttonIndex: 0 },
    };
    expect(formatGamepadBinding(binding)).toBe('[1] A');

    const padTwo: GamepadBinding = {
      kind: 'gamepad',
      gamepadIndex: 1,
      source: { type: 'axis', axisIndex: 0, direction: -1, threshold: 0.5 },
    };
    expect(formatGamepadBinding(padTwo)).toBe('[2] LS-X −');
  });

  it('formatGamepadBinding renders a null pad index as "[any]"', () => {
    const binding: GamepadBinding = {
      kind: 'gamepad',
      gamepadIndex: null,
      source: { type: 'button', buttonIndex: 0 },
    };
    expect(formatGamepadBinding(binding)).toBe('[any] A');
  });
});

describe('rebindingScreenFormat — binding lists', () => {
  it('formatBinding dispatches by kind', () => {
    const kb: KeyboardBinding = { kind: 'keyboard', keyCode: KEY_CODE.W };
    expect(formatBinding(kb)).toBe('W');

    const gp: GamepadBinding = {
      kind: 'gamepad',
      gamepadIndex: 0,
      source: { type: 'button', buttonIndex: 0 },
    };
    expect(formatBinding(gp)).toBe('[1] A');
  });

  it('formatBindingList renders an empty list as "—"', () => {
    expect(formatBindingList([])).toBe('—');
  });

  it('formatBindingList joins entries with " / " in array order', () => {
    const a: KeyboardBinding = { kind: 'keyboard', keyCode: KEY_CODE.W };
    const b: KeyboardBinding = { kind: 'keyboard', keyCode: KEY_CODE.SPACE };
    expect(formatBindingList([a, b])).toBe('W / Space');
    // Order is preserved — swap inputs and the output flips.
    expect(formatBindingList([b, a])).toBe('Space / W');
  });

  it('formatBindingList shows a complete stick as one entry with its pad tag', () => {
    expect(formatBindingList(DEFAULT_GAMEPAD_P3_BINDINGS.smash)).toBe('[1] Right Stick');
    expect(formatBindingList(DEFAULT_GAMEPAD_P4_BINDINGS.smash)).toBe('[2] Right Stick');
    expect(formatBindingList(buildStickHalfAxisBindings(null, 2, 0.6))).toBe('[any] Right Stick');
    expect(formatBindingList(buildStickHalfAxisBindings(0, 0, 0.5))).toBe('[1] Left Stick');
  });

  it('formatBindingList collapses the stick in place and keeps other entries around it', () => {
    const key: KeyboardBinding = { kind: 'keyboard', keyCode: KEY_CODE.V };
    const button: GamepadBinding = { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 7 } };
    const stick = buildStickHalfAxisBindings(0, 3, 0.6);
    expect(formatBindingList([key, ...stick, button])).toBe('V / [1] Right Stick / [1] RT');
    // Any order of the four halves still reads as the stick, placed at the first half.
    expect(formatBindingList([stick[3]!, button, stick[0]!, stick[2]!, stick[1]!])).toBe('[1] Right Stick / [1] RT');
  });

  it('formatBindingList keeps partial sticks and sticks split across pads as half-axes', () => {
    const stick = buildStickHalfAxisBindings(0, 2, 0.6);
    expect(formatBindingList(stick.slice(0, 3))).toBe('[1] RS-X − / [1] RS-X + / [1] RS-Y −');
    const otherPad = buildStickHalfAxisBindings(1, 2, 0.6);
    expect(formatBindingList([...stick.slice(0, 2), ...otherPad.slice(2)]))
      .toBe('[1] RS-X − / [1] RS-X + / [2] RS-Y − / [2] RS-Y +');
    // Unnamed axis pairs are never collapsed.
    expect(formatBindingList(buildStickHalfAxisBindings(0, 4, 0.5))).toBe('[1] Axis 4 − / [1] Axis 4 + / [1] Axis 5 − / [1] Axis 5 +');
  });

  it('groupStickBindings reports the stick and its pad', () => {
    expect(groupStickBindings(DEFAULT_GAMEPAD_P4_BINDINGS.smash)).toEqual([
      { kind: 'stick', gamepadIndex: 1, label: 'Right Stick' },
    ]);
    expect(groupStickBindings(DEFAULT_KEYBOARD_P1_BINDINGS.smash)).toEqual([
      { kind: 'binding', binding: DEFAULT_KEYBOARD_P1_BINDINGS.smash[0] },
    ]);
  });

  it('formatBindingList is byte-stable for identical inputs (determinism)', () => {
    const a: KeyboardBinding = { kind: 'keyboard', keyCode: KEY_CODE.A };
    const b: KeyboardBinding = { kind: 'keyboard', keyCode: KEY_CODE.D };
    const first = formatBindingList([a, b]);
    const second = formatBindingList([a, b]);
    expect(first).toBe(second);
  });
});

describe('rebindingScreenFormat — buildActionRows', () => {
  it('emits one row per action in the supplied order', () => {
    const rows = buildActionRows(DEFAULT_KEYBOARD_P1_BINDINGS, LOGICAL_ACTIONS);
    expect(rows.length).toBe(LOGICAL_ACTIONS.length);
    rows.forEach((row, i) => {
      expect(row.action).toBe(LOGICAL_ACTIONS[i]);
      expect(row.actionLabel).toBe(formatActionLabel(LOGICAL_ACTIONS[i]!));
    });
  });

  it('row.bindingLabel reflects the formatted binding for that action', () => {
    const rows = buildActionRows(DEFAULT_KEYBOARD_P1_BINDINGS, LOGICAL_ACTIONS);
    // P1 left = A, jump = W
    const leftRow = rows.find((r) => r.action === 'left');
    const jumpRow = rows.find((r) => r.action === 'jump');
    expect(leftRow?.bindingLabel).toBe('A');
    expect(jumpRow?.bindingLabel).toBe('W');
  });

  it('honours a restricted action order (e.g. movement-only view)', () => {
    const subset = ['left', 'right', 'jump'] as const;
    const rows = buildActionRows(DEFAULT_KEYBOARD_P1_BINDINGS, subset);
    expect(rows.map((r) => r.action)).toEqual(['left', 'right', 'jump']);
  });
});

describe('rebindingScreenFormat — inferDeviceOption', () => {
  function profile(slot: 1 | 2 | 3 | 4): PlayerBindings {
    return DEFAULT_PLAYER_BINDINGS[slot];
  }

  it('round-trips slot 1 default → keyboard_p1', () => {
    expect(inferDeviceOption(profile(1))).toBe('keyboard_p1');
  });

  it('round-trips slot 2 default → keyboard_p2', () => {
    expect(inferDeviceOption(profile(2))).toBe('keyboard_p2');
  });

  it('round-trips slot 3 default → gamepad_0', () => {
    expect(inferDeviceOption(profile(3))).toBe('gamepad_0');
  });

  it('round-trips slot 4 default → gamepad_1', () => {
    expect(inferDeviceOption(profile(4))).toBe('gamepad_1');
  });

  it('returns "none" for a fully-empty bindings table', () => {
    const empty: PlayerBindings = {
      playerIndex: 1,
      bindings: {
        left: [],
        right: [],
        up: [],
        down: [],
        jump: [],
        attack: [],
        special: [],
        shield: [],
        grab: [],
        taunt: [],
        smash: [],
      },
    };
    expect(inferDeviceOption(empty)).toBe('none');
  });

  it('also matches the reference presets directly', () => {
    expect(
      inferDeviceOption({ playerIndex: 1, bindings: DEFAULT_KEYBOARD_P1_BINDINGS }),
    ).toBe('keyboard_p1');
    expect(
      inferDeviceOption({ playerIndex: 2, bindings: DEFAULT_KEYBOARD_P2_BINDINGS }),
    ).toBe('keyboard_p2');
    expect(
      inferDeviceOption({ playerIndex: 3, bindings: DEFAULT_GAMEPAD_P3_BINDINGS }),
    ).toBe('gamepad_0');
    expect(
      inferDeviceOption({ playerIndex: 4, bindings: DEFAULT_GAMEPAD_P4_BINDINGS }),
    ).toBe('gamepad_1');
  });
});

describe('formatStickLabel', () => {
  it('names the two sticks of the standard mapping by pad and returns null for other axes', () => {
    expect(formatStickLabel(0, 0)).toBe('[1] Left Stick');
    expect(formatStickLabel(0, 1)).toBe('[1] Left Stick');
    expect(formatStickLabel(2, 3)).toBe('[3] Right Stick');
    expect(formatStickLabel(null, 2)).toBe('[any] Right Stick');
    expect(formatStickLabel(0, 4)).toBeNull();
    expect(formatStickLabel(0, -1)).toBeNull();
  });
});

describe('formatControlsHelpLine (in-match controls cheat-sheet)', () => {
  it('lists move, attack, smash, special, shield, dodge and grab from the live bindings', () => {
    expect(formatControlsHelpLine('P1', DEFAULT_KEYBOARD_P1_BINDINGS))
      .toBe('P1: A/D/W/S move | F attack | V smash | G special | H shield | R dodge | T grab | B taunt');
    expect(formatControlsHelpLine('P2', DEFAULT_KEYBOARD_P2_BINDINGS)).toBe('P2: Left Arrow/Right Arrow/Up Arrow/'
      + 'Down Arrow move | Numpad 1 attack | Numpad 0 smash | Numpad 2 special | Numpad 3 shield | Numpad 5 dodge | Numpad 4 grab | Numpad 7 taunt');
    expect(formatControlsHelpLine('P3', DEFAULT_GAMEPAD_P3_BINDINGS)).toBe('P3: [1] LS-X −/[1] LS-X +/[1] LS-Y −/'
      + '[1] LS-Y + move | [1] X attack | [1] Right Stick smash | [1] Y special | [1] RB shield | [1] B dodge | [1] LB grab | [1] Back taunt');
  });

  it('shows a remap and an unbound smash', () => {
    const remapped = { ...DEFAULT_KEYBOARD_P1_BINDINGS, smash: [], taunt: [{ kind: 'keyboard' as const, keyCode: KEY_CODE.SHIFT }] };
    expect(formatControlsHelpLine('P1', remapped)).toContain('| — smash |');
    expect(formatControlsHelpLine('P1', remapped)).toContain('| Shift dodge |');
  });
});
