import { describe, it, expect } from 'vitest';
import {
  REBINDING_DEVICE_OPTIONS,
  DEFAULT_REBINDING_DEVICE_FOR_SLOT,
  buildActionRows,
  formatActionLabel,
  formatBinding,
  formatBindingList,
  formatDeviceLabel,
  formatGamepadBinding,
  formatGamepadSource,
  formatKeyCode,
  inferDeviceOption,
  nextDeviceOption,
} from './rebindingScreenFormat';
import { KEY_CODE } from '../input/keyCodes';
import {
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_KEYBOARD_P2_BINDINGS,
  DEFAULT_GAMEPAD_P3_BINDINGS,
  DEFAULT_GAMEPAD_P4_BINDINGS,
  DEFAULT_PLAYER_BINDINGS,
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
  it('REBINDING_DEVICE_OPTIONS is a frozen, ordered list of all 5 options', () => {
    expect(Object.isFrozen(REBINDING_DEVICE_OPTIONS)).toBe(true);
    expect(REBINDING_DEVICE_OPTIONS).toEqual([
      'keyboard_p1',
      'keyboard_p2',
      'gamepad_0',
      'gamepad_1',
      'none',
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
    expect(formatDeviceLabel('keyboard_p1')).toBe('Keyboard P1 (WASD)');
    expect(formatDeviceLabel('keyboard_p2')).toBe('Keyboard P2 (Arrows)');
    expect(formatDeviceLabel('gamepad_0')).toBe('Gamepad 1');
    expect(formatDeviceLabel('gamepad_1')).toBe('Gamepad 2');
    expect(formatDeviceLabel('none')).toBe('No Device');
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
    expect(formatActionLabel('taunt')).toBe('Taunt');
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
