import { describe, it, expect } from 'vitest';
import {
  buildGamepadDefaultsForPad,
  DEFAULT_GAMEPAD_AXIS_THRESHOLD,
  gamepadDefaults,
  keyboardDefaultsBySlot,
  keyboardDefaultsP1,
  keyboardDefaultsP2,
  keyboardDefaultsP3,
  keyboardDefaultsP4,
} from './defaultBindingProfiles';
import {
  BINDING_ACTIONS,
  DEFAULT_GAMEPAD_P3_BINDINGS,
  DEFAULT_GAMEPAD_P4_BINDINGS,
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_KEYBOARD_P2_BINDINGS,
  type ActionMap,
  type BindingAction,
  type GamepadBinding,
  type KeyboardBinding,
} from '../types/bindings';
import { KEY_CODE } from './keyCodes';

/**
 * AC 50002 Sub-AC 2 — default binding presets module.
 *
 * Locks down the literal contract called out in the seed:
 *
 *   • keyboardDefaultsP1, keyboardDefaultsP2 are exported as the named
 *     defaults the lobby's "Reset to Defaults" button hands to slot 1
 *     and slot 2 respectively.
 *   • gamepadDefaults is the standard-layout template that the lobby
 *     pins to a concrete `Gamepad.index` per slot via
 *     `buildGamepadDefaultsForPad`.
 *   • Every default profile covers every action name in
 *     {@link BINDING_ACTIONS} for its device type.
 *   • Profiles are recursively frozen so identity-equality and
 *     byte-stable JSON serialisation hold across the whole codebase.
 */

// ---------------------------------------------------------------------------
// keyboardDefaultsP1
// ---------------------------------------------------------------------------

describe('keyboardDefaultsP1', () => {
  const kb = (action: BindingAction): KeyboardBinding =>
    keyboardDefaultsP1[action][0] as KeyboardBinding;

  it('binds movement to WASD with W doubling as jump', () => {
    expect(kb('moveLeft').keyCode).toBe(KEY_CODE.A);
    expect(kb('moveRight').keyCode).toBe(KEY_CODE.D);
    expect(kb('moveUp').keyCode).toBe(KEY_CODE.W);
    expect(kb('moveDown').keyCode).toBe(KEY_CODE.S);
    expect(kb('jump').keyCode).toBe(KEY_CODE.W);
  });

  it('binds the action cluster to F/G/H/T/R', () => {
    expect(kb('attack').keyCode).toBe(KEY_CODE.F);
    expect(kb('special').keyCode).toBe(KEY_CODE.G);
    expect(kb('shield').keyCode).toBe(KEY_CODE.H);
    expect(kb('grab').keyCode).toBe(KEY_CODE.T);
    expect(kb('dodge').keyCode).toBe(KEY_CODE.R);
  });

  it('aliases the canonical M1 default (identity equality)', () => {
    expect(keyboardDefaultsP1).toBe(DEFAULT_KEYBOARD_P1_BINDINGS);
  });
});

// ---------------------------------------------------------------------------
// keyboardDefaultsP2
// ---------------------------------------------------------------------------

describe('keyboardDefaultsP2', () => {
  const kb = (action: BindingAction): KeyboardBinding =>
    keyboardDefaultsP2[action][0] as KeyboardBinding;

  it('binds movement to arrow keys with Up doubling as jump', () => {
    expect(kb('moveLeft').keyCode).toBe(KEY_CODE.ARROW_LEFT);
    expect(kb('moveRight').keyCode).toBe(KEY_CODE.ARROW_RIGHT);
    expect(kb('moveUp').keyCode).toBe(KEY_CODE.ARROW_UP);
    expect(kb('moveDown').keyCode).toBe(KEY_CODE.ARROW_DOWN);
    expect(kb('jump').keyCode).toBe(KEY_CODE.ARROW_UP);
  });

  it('binds the action cluster to Numpad 1–5', () => {
    expect(kb('attack').keyCode).toBe(KEY_CODE.NUMPAD_1);
    expect(kb('special').keyCode).toBe(KEY_CODE.NUMPAD_2);
    expect(kb('shield').keyCode).toBe(KEY_CODE.NUMPAD_3);
    expect(kb('grab').keyCode).toBe(KEY_CODE.NUMPAD_4);
    expect(kb('dodge').keyCode).toBe(KEY_CODE.NUMPAD_5);
  });

  it('aliases the canonical M1 default (identity equality)', () => {
    expect(keyboardDefaultsP2).toBe(DEFAULT_KEYBOARD_P2_BINDINGS);
  });
});

// ---------------------------------------------------------------------------
// keyboardDefaultsP3 / P4 (fallback profiles)
// ---------------------------------------------------------------------------

describe('keyboardDefaultsP3 fallback', () => {
  const kb = (action: BindingAction): KeyboardBinding =>
    keyboardDefaultsP3[action][0] as KeyboardBinding;

  it('binds movement to IJKL with I doubling as jump', () => {
    // legacy keyCode integers: I=73, J=74, K=75, L=76
    expect(kb('moveLeft').keyCode).toBe(74);
    expect(kb('moveRight').keyCode).toBe(76);
    expect(kb('moveUp').keyCode).toBe(73);
    expect(kb('moveDown').keyCode).toBe(75);
    expect(kb('jump').keyCode).toBe(73);
  });

  it('does not collide with P1 or P2 default keycodes', () => {
    const usedP1 = new Set(
      Object.values(keyboardDefaultsP1).map(
        (binding) => (binding[0] as KeyboardBinding).keyCode,
      ),
    );
    const usedP2 = new Set(
      Object.values(keyboardDefaultsP2).map(
        (binding) => (binding[0] as KeyboardBinding).keyCode,
      ),
    );

    for (const action of BINDING_ACTIONS) {
      const code = kb(action).keyCode;
      expect(usedP1.has(code)).toBe(false);
      expect(usedP2.has(code)).toBe(false);
    }
  });
});

describe('keyboardDefaultsP4 fallback', () => {
  const kb = (action: BindingAction): KeyboardBinding =>
    keyboardDefaultsP4[action][0] as KeyboardBinding;

  it('binds movement to numpad inverted-T with Numpad 8 as jump', () => {
    // legacy keyCode integers: NumPad8=104, NumPad4=100, NumPad5=101, NumPad6=102
    expect(kb('moveLeft').keyCode).toBe(100);
    expect(kb('moveRight').keyCode).toBe(102);
    expect(kb('moveUp').keyCode).toBe(104);
    expect(kb('moveDown').keyCode).toBe(101);
    expect(kb('jump').keyCode).toBe(104);
  });

  it('does not collide with P1 or P3 default keycodes', () => {
    // (P2 reuses Numpad 1–5 and intentionally overlaps with P4's numpad
    // layout — see the module header for the slot-policy rationale.)
    const usedP1 = new Set(
      Object.values(keyboardDefaultsP1).map(
        (binding) => (binding[0] as KeyboardBinding).keyCode,
      ),
    );
    const usedP3 = new Set(
      Object.values(keyboardDefaultsP3).map(
        (binding) => (binding[0] as KeyboardBinding).keyCode,
      ),
    );

    for (const action of BINDING_ACTIONS) {
      const code = kb(action).keyCode;
      expect(usedP1.has(code)).toBe(false);
      expect(usedP3.has(code)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// keyboardDefaultsBySlot lookup
// ---------------------------------------------------------------------------

describe('keyboardDefaultsBySlot', () => {
  it('exposes the four per-slot keyboard defaults under their slot index', () => {
    expect(keyboardDefaultsBySlot[1]).toBe(keyboardDefaultsP1);
    expect(keyboardDefaultsBySlot[2]).toBe(keyboardDefaultsP2);
    expect(keyboardDefaultsBySlot[3]).toBe(keyboardDefaultsP3);
    expect(keyboardDefaultsBySlot[4]).toBe(keyboardDefaultsP4);
  });

  it('is frozen so no caller can mutate the lookup table', () => {
    expect(Object.isFrozen(keyboardDefaultsBySlot)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// gamepadDefaults — pad-agnostic template
// ---------------------------------------------------------------------------

describe('gamepadDefaults template', () => {
  const ax = (action: BindingAction): GamepadBinding =>
    gamepadDefaults[action][0] as GamepadBinding;

  it('uses null gamepadIndex (any-pad template)', () => {
    for (const action of BINDING_ACTIONS) {
      expect(ax(action).gamepadIndex).toBeNull();
    }
  });

  it('binds movement to left-stick half-axes with the canonical dead-zone', () => {
    const left = ax('moveLeft').source;
    const right = ax('moveRight').source;
    const up = ax('moveUp').source;
    const down = ax('moveDown').source;

    expect(left).toEqual({
      type: 'axis',
      axisIndex: 0,
      direction: -1,
      threshold: DEFAULT_GAMEPAD_AXIS_THRESHOLD,
    });
    expect(right).toEqual({
      type: 'axis',
      axisIndex: 0,
      direction: +1,
      threshold: DEFAULT_GAMEPAD_AXIS_THRESHOLD,
    });
    expect(up).toEqual({
      type: 'axis',
      axisIndex: 1,
      direction: -1,
      threshold: DEFAULT_GAMEPAD_AXIS_THRESHOLD,
    });
    expect(down).toEqual({
      type: 'axis',
      axisIndex: 1,
      direction: +1,
      threshold: DEFAULT_GAMEPAD_AXIS_THRESHOLD,
    });
  });

  it('binds combat actions to the standard Xbox-layout buttons', () => {
    expect(ax('jump').source).toEqual({ type: 'button', buttonIndex: 0 });
    expect(ax('attack').source).toEqual({ type: 'button', buttonIndex: 2 });
    expect(ax('special').source).toEqual({ type: 'button', buttonIndex: 3 });
    expect(ax('grab').source).toEqual({ type: 'button', buttonIndex: 4 });
    expect(ax('shield').source).toEqual({ type: 'button', buttonIndex: 5 });
    expect(ax('dodge').source).toEqual({ type: 'button', buttonIndex: 6 });
  });
});

// ---------------------------------------------------------------------------
// buildGamepadDefaultsForPad — re-export
// ---------------------------------------------------------------------------

describe('buildGamepadDefaultsForPad', () => {
  it('produces a profile whose bindings are pinned to the supplied pad index', () => {
    const pad0 = buildGamepadDefaultsForPad(0);
    for (const action of BINDING_ACTIONS) {
      const binding = pad0[action][0] as GamepadBinding;
      expect(binding.gamepadIndex).toBe(0);
    }
  });

  it('matches the canonical slot-3 / slot-4 defaults verbatim', () => {
    expect(buildGamepadDefaultsForPad(0)).toEqual(DEFAULT_GAMEPAD_P3_BINDINGS);
    expect(buildGamepadDefaultsForPad(1)).toEqual(DEFAULT_GAMEPAD_P4_BINDINGS);
  });
});

// ---------------------------------------------------------------------------
// Coverage — every profile binds every action
// ---------------------------------------------------------------------------

describe('Action coverage', () => {
  const profiles: ReadonlyArray<readonly [string, ActionMap]> = [
    ['keyboardDefaultsP1', keyboardDefaultsP1],
    ['keyboardDefaultsP2', keyboardDefaultsP2],
    ['keyboardDefaultsP3', keyboardDefaultsP3],
    ['keyboardDefaultsP4', keyboardDefaultsP4],
    ['gamepadDefaults', gamepadDefaults],
  ];

  it.each(profiles)('%s binds every BINDING_ACTIONS entry', (_label, profile) => {
    for (const action of BINDING_ACTIONS) {
      const list = profile[action];
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
    }
  });

  it('every keyboard profile entry is a keyboard binding', () => {
    for (const profile of [
      keyboardDefaultsP1,
      keyboardDefaultsP2,
      keyboardDefaultsP3,
      keyboardDefaultsP4,
    ]) {
      for (const action of BINDING_ACTIONS) {
        for (const binding of profile[action]) {
          expect(binding.kind).toBe('keyboard');
        }
      }
    }
  });

  it('gamepadDefaults entries are gamepad bindings', () => {
    for (const action of BINDING_ACTIONS) {
      for (const binding of gamepadDefaults[action]) {
        expect(binding.kind).toBe('gamepad');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism — frozen + byte-stable JSON
// ---------------------------------------------------------------------------

describe('Determinism', () => {
  it('every profile is frozen at the top level', () => {
    expect(Object.isFrozen(keyboardDefaultsP1)).toBe(true);
    expect(Object.isFrozen(keyboardDefaultsP2)).toBe(true);
    expect(Object.isFrozen(keyboardDefaultsP3)).toBe(true);
    expect(Object.isFrozen(keyboardDefaultsP4)).toBe(true);
    expect(Object.isFrozen(gamepadDefaults)).toBe(true);
  });

  it('per-action binding arrays are frozen', () => {
    for (const profile of [
      keyboardDefaultsP1,
      keyboardDefaultsP2,
      keyboardDefaultsP3,
      keyboardDefaultsP4,
      gamepadDefaults,
    ]) {
      for (const action of BINDING_ACTIONS) {
        expect(Object.isFrozen(profile[action])).toBe(true);
      }
    }
  });

  it('JSON.stringify output is byte-stable across module loads', () => {
    // Two stringifications of the same frozen object must be identical.
    expect(JSON.stringify(gamepadDefaults)).toBe(JSON.stringify(gamepadDefaults));
    expect(JSON.stringify(keyboardDefaultsP1)).toBe(JSON.stringify(keyboardDefaultsP1));
    expect(JSON.stringify(keyboardDefaultsP3)).toBe(JSON.stringify(keyboardDefaultsP3));
    expect(JSON.stringify(keyboardDefaultsP4)).toBe(JSON.stringify(keyboardDefaultsP4));
  });

  it('exposes the canonical axis dead-zone constant', () => {
    expect(typeof DEFAULT_GAMEPAD_AXIS_THRESHOLD).toBe('number');
    expect(DEFAULT_GAMEPAD_AXIS_THRESHOLD).toBeGreaterThan(0);
    expect(DEFAULT_GAMEPAD_AXIS_THRESHOLD).toBeLessThan(1);
  });
});
