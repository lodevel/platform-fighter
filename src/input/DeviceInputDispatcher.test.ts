import { describe, it, expect } from 'vitest';
import {
  DeviceInputDispatcher,
  NEUTRAL_ACTION_MAP,
  type GamepadButtonState,
  type GamepadSource,
} from './DeviceInputDispatcher';
import {
  DEFAULT_GAMEPAD_AXIS_THRESHOLD,
  DEFAULT_GAMEPAD_P3_BINDINGS,
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_KEYBOARD_P2_BINDINGS,
  InputBindingsStore,
} from './InputBindingsStore';
import type { KeyboardSource } from './LocalInputHandler';
import { KEY_CODE } from './keyCodes';
import { LOGICAL_ACTIONS } from '../types/inputBindings';
import type {
  GamepadBinding,
  KeyboardBinding,
  PlayerBindings,
} from '../types/inputBindings';

/**
 * AC 40003 Sub-AC 3 — device abstraction layer.
 *
 * Locks down:
 *
 *   1. Keyboard path — keyboard bindings forward `KeyboardSource.isDown`
 *      to the matching `LogicalAction`. Multi-bind lists OR together,
 *      empty lists report released.
 *   2. Gamepad path — button bindings forward `Gamepad.buttons[i].pressed`,
 *      half-axis bindings clear / fail the per-binding threshold and
 *      flip on direction. Disconnected pads silently report released.
 *   3. Mixed bindings — a slot can layer keyboard + gamepad bindings
 *      under one action and either one fires it.
 *   4. Live-store integration — rebinding the action through the store
 *      after dispatcher construction takes effect on the next sample
 *      (no cache).
 *   5. CharacterInput shape — matches the M1 keyboard handler's output
 *      bit-for-bit on a keyboard slot, preserves analog magnitude on
 *      gamepad slots, sets dropThrough = down && jump per Smash convention.
 *   6. Determinism — the dispatcher is stateless. Two reads with the
 *      same source state return identical bitmaps.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface MockKeyboard extends KeyboardSource {
  press(...codes: number[]): void;
  release(...codes: number[]): void;
  releaseAll(): void;
}

function createMockKeyboard(): MockKeyboard {
  const held = new Set<number>();
  return {
    isDown(code: number): boolean {
      return held.has(code);
    },
    press(...codes: number[]): void {
      for (const c of codes) held.add(c);
    },
    release(...codes: number[]): void {
      for (const c of codes) held.delete(c);
    },
    releaseAll(): void {
      held.clear();
    },
  };
}

interface MockGamepad extends GamepadSource {
  connect(index: number): void;
  disconnect(index: number): void;
  setButton(index: number, button: number, state: GamepadButtonState): void;
  setAxis(index: number, axis: number, value: number): void;
}

function createMockGamepad(): MockGamepad {
  const connected = new Set<number>();
  // Per-pad sparse maps so out-of-range / unset reads return the neutral
  // sentinel, mirroring the production browser adapter.
  const buttons = new Map<string, GamepadButtonState>();
  const axes = new Map<string, number>();
  const NEUTRAL: GamepadButtonState = Object.freeze({ pressed: false, value: 0 });
  return {
    isConnected(index: number): boolean {
      return connected.has(index);
    },
    getButton(index: number, button: number): GamepadButtonState {
      if (!connected.has(index)) return NEUTRAL;
      return buttons.get(`${index}:${button}`) ?? NEUTRAL;
    },
    getAxis(index: number, axis: number): number {
      if (!connected.has(index)) return 0;
      return axes.get(`${index}:${axis}`) ?? 0;
    },
    connect(index: number): void {
      connected.add(index);
    },
    disconnect(index: number): void {
      connected.delete(index);
    },
    setButton(index: number, button: number, state: GamepadButtonState): void {
      buttons.set(`${index}:${button}`, state);
    },
    setAxis(index: number, axis: number, value: number): void {
      axes.set(`${index}:${axis}`, value);
    },
  };
}

function pressedButton(value = 1): GamepadButtonState {
  return Object.freeze({ pressed: true, value });
}

// ---------------------------------------------------------------------------
// Setup helper
// ---------------------------------------------------------------------------

function buildDispatcher(): {
  keyboard: MockKeyboard;
  gamepad: MockGamepad;
  store: InputBindingsStore;
  dispatcher: DeviceInputDispatcher;
} {
  const keyboard = createMockKeyboard();
  const gamepad = createMockGamepad();
  const store = new InputBindingsStore();
  const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad, bindings: store });
  return { keyboard, gamepad, store, dispatcher };
}

// ---------------------------------------------------------------------------
// Keyboard normalisation
// ---------------------------------------------------------------------------

describe('DeviceInputDispatcher — keyboard normalisation', () => {
  it('reports a keyboard action as held when the bound key is down', () => {
    const { keyboard, dispatcher } = buildDispatcher();
    keyboard.press(KEY_CODE.A);
    expect(dispatcher.isActionHeld(1, 'left')).toBe(true);
    expect(dispatcher.isActionHeld(1, 'right')).toBe(false);
  });

  it('reports a keyboard action as released when the bound key is up', () => {
    const { dispatcher } = buildDispatcher();
    expect(dispatcher.isActionHeld(1, 'jump')).toBe(false);
  });

  it('uses each slot\'s own binding table — P1 and P2 share one keyboard', () => {
    const { keyboard, dispatcher } = buildDispatcher();
    keyboard.press(KEY_CODE.A);
    expect(dispatcher.isActionHeld(1, 'left')).toBe(true);
    // P2's `left` is bound to ARROW_LEFT, not A.
    expect(dispatcher.isActionHeld(2, 'left')).toBe(false);
    keyboard.press(KEY_CODE.ARROW_LEFT);
    expect(dispatcher.isActionHeld(2, 'left')).toBe(true);
  });

  it('sampleActions(slot) builds a complete LogicalAction map', () => {
    const { keyboard, dispatcher } = buildDispatcher();
    keyboard.press(KEY_CODE.W, KEY_CODE.F);
    const actions = dispatcher.sampleActions(1);
    expect(actions.up).toBe(true);
    expect(actions.jump).toBe(true);
    expect(actions.attack).toBe(true);
    // Every other action is released.
    for (const action of LOGICAL_ACTIONS) {
      if (action === 'up' || action === 'jump' || action === 'attack') continue;
      expect(actions[action]).toBe(false);
    }
  });

  it('returns a frozen action map', () => {
    const { dispatcher } = buildDispatcher();
    const actions = dispatcher.sampleActions(1);
    expect(Object.isFrozen(actions)).toBe(true);
    expect(() => {
      (actions as unknown as { jump: boolean }).jump = true;
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Gamepad button normalisation
// ---------------------------------------------------------------------------

describe('DeviceInputDispatcher — gamepad button normalisation', () => {
  it('reports gamepad action held when its bound button is pressed', () => {
    const { gamepad, dispatcher } = buildDispatcher();
    gamepad.connect(0);
    gamepad.setButton(0, 0, pressedButton()); // jump = button 0 on slot 3 default
    expect(dispatcher.isActionHeld(3, 'jump')).toBe(true);
    expect(dispatcher.isActionHeld(3, 'attack')).toBe(false);
  });

  it('attack / special / grab / shield / taunt routes to the standard layout', () => {
    const { gamepad, dispatcher } = buildDispatcher();
    gamepad.connect(0);
    gamepad.setButton(0, 2, pressedButton()); // attack
    expect(dispatcher.isActionHeld(3, 'attack')).toBe(true);
    gamepad.setButton(0, 3, pressedButton()); // special
    expect(dispatcher.isActionHeld(3, 'special')).toBe(true);
    gamepad.setButton(0, 4, pressedButton()); // grab
    expect(dispatcher.isActionHeld(3, 'grab')).toBe(true);
    gamepad.setButton(0, 5, pressedButton()); // shield
    expect(dispatcher.isActionHeld(3, 'shield')).toBe(true);
    gamepad.setButton(0, 1, pressedButton()); // taunt
    expect(dispatcher.isActionHeld(3, 'taunt')).toBe(true);
  });

  it('does not fire when the pad reports the button as not pressed', () => {
    const { gamepad, dispatcher } = buildDispatcher();
    gamepad.connect(0);
    gamepad.setButton(0, 0, { pressed: false, value: 0.4 }); // half-pulled trigger
    expect(dispatcher.isActionHeld(3, 'jump')).toBe(false);
  });

  it('treats a disconnected pad as fully released for every action', () => {
    const { gamepad, dispatcher } = buildDispatcher();
    // No connect() — pad is disconnected.
    gamepad.setButton(0, 0, pressedButton());
    gamepad.setAxis(0, 0, -1);
    expect(dispatcher.sampleActions(3)).toEqual(NEUTRAL_ACTION_MAP);
  });

  it('isolates pads — pressing button on pad 0 does not fire pad 1\'s slot 4 action', () => {
    const { gamepad, dispatcher } = buildDispatcher();
    gamepad.connect(0);
    gamepad.connect(1);
    gamepad.setButton(0, 0, pressedButton());
    expect(dispatcher.isActionHeld(3, 'jump')).toBe(true); // P3 is on pad 0
    expect(dispatcher.isActionHeld(4, 'jump')).toBe(false); // P4 is on pad 1
    gamepad.setButton(1, 0, pressedButton());
    expect(dispatcher.isActionHeld(4, 'jump')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gamepad axis normalisation
// ---------------------------------------------------------------------------

describe('DeviceInputDispatcher — gamepad axis normalisation', () => {
  it('does not fire below the configured threshold', () => {
    const { gamepad, dispatcher } = buildDispatcher();
    gamepad.connect(0);
    gamepad.setAxis(0, 0, -DEFAULT_GAMEPAD_AXIS_THRESHOLD + 0.01); // just under
    expect(dispatcher.isActionHeld(3, 'left')).toBe(false);
  });

  it('fires once the axis * direction crosses the threshold', () => {
    const { gamepad, dispatcher } = buildDispatcher();
    gamepad.connect(0);
    gamepad.setAxis(0, 0, -DEFAULT_GAMEPAD_AXIS_THRESHOLD); // exactly at threshold
    expect(dispatcher.isActionHeld(3, 'left')).toBe(true);
  });

  it('treats opposing half-axes as mutually exclusive at any stick position', () => {
    const { gamepad, dispatcher } = buildDispatcher();
    gamepad.connect(0);
    gamepad.setAxis(0, 0, 0.8); // pushed right
    expect(dispatcher.isActionHeld(3, 'left')).toBe(false);
    expect(dispatcher.isActionHeld(3, 'right')).toBe(true);
    gamepad.setAxis(0, 0, -0.8); // pushed left
    expect(dispatcher.isActionHeld(3, 'left')).toBe(true);
    expect(dispatcher.isActionHeld(3, 'right')).toBe(false);
  });

  it('uses Y-axis half-axes for up / down', () => {
    const { gamepad, dispatcher } = buildDispatcher();
    gamepad.connect(0);
    gamepad.setAxis(0, 1, -1); // stick all the way up
    expect(dispatcher.isActionHeld(3, 'up')).toBe(true);
    gamepad.setAxis(0, 1, 1); // stick all the way down
    expect(dispatcher.isActionHeld(3, 'up')).toBe(false);
    expect(dispatcher.isActionHeld(3, 'down')).toBe(true);
  });

  it('respects a custom per-binding threshold', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    const store = new InputBindingsStore();
    // Tighten P3's `left` threshold to 0.9 — only a near-full stick fires it.
    const tight: PlayerBindings = {
      playerIndex: 3,
      bindings: {
        ...DEFAULT_GAMEPAD_P3_BINDINGS,
        left: [
          {
            kind: 'gamepad',
            gamepadIndex: 0,
            source: { type: 'axis', axisIndex: 0, direction: -1, threshold: 0.9 },
          },
        ],
      },
    };
    store.set(3, tight);
    const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad, bindings: store });
    gamepad.connect(0);
    gamepad.setAxis(0, 0, -0.7);
    expect(dispatcher.isActionHeld(3, 'left')).toBe(false);
    gamepad.setAxis(0, 0, -0.95);
    expect(dispatcher.isActionHeld(3, 'left')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multi-bind / mixed-device bindings
// ---------------------------------------------------------------------------

describe('DeviceInputDispatcher — multi-bind / mixed-device', () => {
  it('OR-s multiple bindings under one action — keyboard + gamepad both fire it', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    const store = new InputBindingsStore();
    // P1's jump now responds to either W (default) or pad 0 button 0.
    store.setAction(1, 'jump', [
      { kind: 'keyboard', keyCode: KEY_CODE.W },
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 0 } },
    ]);
    const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad, bindings: store });
    expect(dispatcher.isActionHeld(1, 'jump')).toBe(false);
    keyboard.press(KEY_CODE.W);
    expect(dispatcher.isActionHeld(1, 'jump')).toBe(true);
    keyboard.releaseAll();
    expect(dispatcher.isActionHeld(1, 'jump')).toBe(false);
    gamepad.connect(0);
    gamepad.setButton(0, 0, pressedButton());
    expect(dispatcher.isActionHeld(1, 'jump')).toBe(true);
  });

  it('treats an empty binding list as released even if any device is active', () => {
    const { keyboard, gamepad, store, dispatcher } = buildDispatcher();
    store.setAction(1, 'taunt', []);
    keyboard.press(KEY_CODE.R); // the old default for P1 taunt
    gamepad.connect(0);
    gamepad.setButton(0, 1, pressedButton()); // gamepad taunt button (irrelevant for P1)
    expect(dispatcher.isActionHeld(1, 'taunt')).toBe(false);
  });

  it('a binding with gamepadIndex = null fires from any connected pad', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    const store = new InputBindingsStore();
    store.setAction(1, 'taunt', [
      { kind: 'gamepad', gamepadIndex: null, source: { type: 'button', buttonIndex: 9 } },
    ]);
    const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad, bindings: store });
    gamepad.connect(2);
    gamepad.setButton(2, 9, pressedButton());
    expect(dispatcher.isActionHeld(1, 'taunt')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Live-store integration
// ---------------------------------------------------------------------------

describe('DeviceInputDispatcher — live store integration', () => {
  it('picks up rebindings committed to the store after construction', () => {
    const { keyboard, store, dispatcher } = buildDispatcher();
    // Default P1 jump is W. Rebind to Space, no dispatcher reset needed.
    store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    keyboard.press(KEY_CODE.W);
    expect(dispatcher.isActionHeld(1, 'jump')).toBe(false);
    keyboard.releaseAll();
    keyboard.press(KEY_CODE.SPACE);
    expect(dispatcher.isActionHeld(1, 'jump')).toBe(true);
  });

  it('reset(slot) on the store reverts the dispatcher\'s reads', () => {
    const { keyboard, store, dispatcher } = buildDispatcher();
    store.setAction(1, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    keyboard.press(KEY_CODE.SPACE);
    expect(dispatcher.isActionHeld(1, 'attack')).toBe(true);
    store.reset(1);
    keyboard.releaseAll();
    keyboard.press(KEY_CODE.F); // default P1 attack
    expect(dispatcher.isActionHeld(1, 'attack')).toBe(true);
    keyboard.releaseAll();
    keyboard.press(KEY_CODE.SPACE);
    expect(dispatcher.isActionHeld(1, 'attack')).toBe(false);
  });

  it('accepts a frozen PlayerBindings provider directly (no full store)', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    const provider = {
      get(): PlayerBindings {
        return {
          playerIndex: 1,
          bindings: {
            ...DEFAULT_KEYBOARD_P1_BINDINGS,
            jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }],
          },
        };
      },
    };
    const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad, bindings: provider });
    keyboard.press(KEY_CODE.SPACE);
    expect(dispatcher.isActionHeld(1, 'jump')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CharacterInput conversion
// ---------------------------------------------------------------------------

describe('DeviceInputDispatcher.sampleCharacterInput', () => {
  it('matches the M1 keyboard handler\'s shape on a keyboard slot', () => {
    const { keyboard, dispatcher } = buildDispatcher();
    keyboard.press(KEY_CODE.A, KEY_CODE.F); // P1: left + attack
    const ci = dispatcher.sampleCharacterInput(1);
    expect(ci.moveX).toBe(-1);
    expect(ci.attack).toBe(true);
    expect(ci.jump).toBe(false);
    expect(ci.dropThrough).toBe(false);
  });

  it('cancels left + right held simultaneously to moveX = 0', () => {
    const { keyboard, dispatcher } = buildDispatcher();
    keyboard.press(KEY_CODE.A, KEY_CODE.D);
    expect(dispatcher.sampleCharacterInput(1).moveX).toBe(0);
  });

  it('sets dropThrough = true on a rapid double-tap of the down action', () => {
    // The new gesture is two consecutive down rising-edges within the
    // window — replaces the prior `down + jump` chord which clobbered
    // ordinary fast-falls. A held-down (no rising edge) never fires
    // dropThrough; the player has to release + re-press.
    const { keyboard, dispatcher } = buildDispatcher();
    // Tap 1
    keyboard.press(KEY_CODE.S);
    expect(dispatcher.sampleCharacterInput(1).dropThrough).toBe(false);
    keyboard.release(KEY_CODE.S);
    // Tap 2 within the window
    expect(dispatcher.sampleCharacterInput(1).dropThrough).toBe(false);
    keyboard.press(KEY_CODE.S);
    expect(dispatcher.sampleCharacterInput(1).dropThrough).toBe(true);
  });

  it('does NOT set dropThrough when down is merely held (no rising edge)', () => {
    const { keyboard, dispatcher } = buildDispatcher();
    keyboard.press(KEY_CODE.S);
    // First sample sees the rising edge of the very first press, not a double-tap.
    expect(dispatcher.sampleCharacterInput(1).dropThrough).toBe(false);
    // Holding through many frames must NEVER trigger drop-through.
    for (let i = 0; i < 60; i += 1) {
      expect(dispatcher.sampleCharacterInput(1).dropThrough).toBe(false);
    }
  });

  it('preserves analog magnitude for gamepad slots', () => {
    const { gamepad, dispatcher } = buildDispatcher();
    gamepad.connect(0);
    gamepad.setAxis(0, 0, 0.65); // half-pushed right
    const ci = dispatcher.sampleCharacterInput(3);
    expect(ci.moveX).toBeCloseTo(0.65, 5);
  });

  it('reports moveX in the negative direction when stick is pushed left', () => {
    const { gamepad, dispatcher } = buildDispatcher();
    gamepad.connect(0);
    gamepad.setAxis(0, 0, -0.8);
    const ci = dispatcher.sampleCharacterInput(3);
    expect(ci.moveX).toBeCloseTo(-0.8, 5);
  });

  it('keyboard P2 default sample matches expected shape', () => {
    const { keyboard, dispatcher } = buildDispatcher();
    keyboard.press(KEY_CODE.ARROW_RIGHT, KEY_CODE.NUMPAD_1, KEY_CODE.ARROW_UP);
    const ci = dispatcher.sampleCharacterInput(2);
    expect(ci.moveX).toBe(1);
    expect(ci.jump).toBe(true); // ARROW_UP is bound to jump
    expect(ci.attack).toBe(true);
    expect(ci.dropThrough).toBe(false);
    // Sanity — P2 left in store is ARROW_LEFT not A.
    expect(DEFAULT_KEYBOARD_P2_BINDINGS.left[0]).toMatchObject({
      kind: 'keyboard',
      keyCode: KEY_CODE.ARROW_LEFT,
    });
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('DeviceInputDispatcher — determinism', () => {
  it('repeated samples with the same source state return identical bitmaps', () => {
    const { keyboard, gamepad, dispatcher } = buildDispatcher();
    keyboard.press(KEY_CODE.A);
    gamepad.connect(0);
    gamepad.setAxis(0, 1, -1);
    const a = dispatcher.sampleActions(1);
    const b = dispatcher.sampleActions(1);
    const c = dispatcher.sampleActions(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    const d = dispatcher.sampleActions(3);
    const e = dispatcher.sampleActions(3);
    expect(d).toEqual(e);
  });

  it('two dispatchers over the same sources + store produce identical samples', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    const store = new InputBindingsStore();
    const a = new DeviceInputDispatcher({ keyboard, gamepad, bindings: store });
    const b = new DeviceInputDispatcher({ keyboard, gamepad, bindings: store });
    keyboard.press(KEY_CODE.W);
    gamepad.connect(1);
    gamepad.setButton(1, 2, pressedButton());
    expect(a.sampleActions(1)).toEqual(b.sampleActions(1));
    expect(a.sampleActions(4)).toEqual(b.sampleActions(4));
  });
});

// ---------------------------------------------------------------------------
// Smoke / integration with InputBindingsStore defaults
// ---------------------------------------------------------------------------

describe('DeviceInputDispatcher — defaults integration smoke', () => {
  it('every default-binding slot starts neutral', () => {
    const { dispatcher } = buildDispatcher();
    expect(dispatcher.sampleActions(1)).toEqual(NEUTRAL_ACTION_MAP);
    expect(dispatcher.sampleActions(2)).toEqual(NEUTRAL_ACTION_MAP);
    expect(dispatcher.sampleActions(3)).toEqual(NEUTRAL_ACTION_MAP);
    expect(dispatcher.sampleActions(4)).toEqual(NEUTRAL_ACTION_MAP);
  });

  it('a sanity round-trip: every default action fires its primary binding', () => {
    const { keyboard, gamepad, dispatcher } = buildDispatcher();
    // Slot 1 — keyboard
    for (const action of LOGICAL_ACTIONS) {
      const binding = DEFAULT_KEYBOARD_P1_BINDINGS[action][0] as KeyboardBinding;
      keyboard.releaseAll();
      keyboard.press(binding.keyCode);
      expect(dispatcher.isActionHeld(1, action)).toBe(true);
    }
    keyboard.releaseAll();
    // Slot 3 — gamepad
    gamepad.connect(0);
    for (const action of LOGICAL_ACTIONS) {
      const binding = DEFAULT_GAMEPAD_P3_BINDINGS[action][0] as GamepadBinding;
      // Reset all sources first.
      gamepad.setAxis(0, 0, 0);
      gamepad.setAxis(0, 1, 0);
      // Reset every button we might have flipped.
      for (let b = 0; b < 8; b += 1) {
        gamepad.setButton(0, b, { pressed: false, value: 0 });
      }
      if (binding.source.type === 'button') {
        gamepad.setButton(0, binding.source.buttonIndex, pressedButton());
      } else {
        gamepad.setAxis(0, binding.source.axisIndex, binding.source.direction);
      }
      expect(dispatcher.isActionHeld(3, action)).toBe(true);
    }
  });
});
