import { describe, it, expect } from 'vitest';
import {
  NEUTRAL_INPUT_SNAPSHOT,
  closeCharacterInput,
  createBothKeyboardInputProviders,
  createBothBindingsKeyboardInputProviders,
  createBindingsKeyboardInputProvider,
  createBindingsGamepadInputProvider,
  createBothBindingsGamepadInputProviders,
  createKeyboardInputProvider,
  GAMEPAD_ANY_PAD_SCAN_RANGE,
  type PlayerInputProvider,
} from './InputProvider';
import {
  LocalInputHandler,
  type KeyboardSource,
} from './LocalInputHandler';
import { KEY_CODE } from './keyCodes';
import {
  DEFAULT_GAMEPAD_AXIS_THRESHOLD,
  InputBindingsStore,
} from './InputBindingsStore';
import { BindingsStore } from './BindingsStore';
import type { PlayerBindings, PlayerBindingsIndex } from '../types/inputBindings';
import type {
  GamepadButtonState,
  GamepadSource,
  PlayerBindingsProvider,
} from './DeviceInputDispatcher';

/**
 * AC 10201 Sub-AC 1 — shared input-provider interface.
 *
 * The provider abstraction is the single read-side contract every
 * player slot conforms to (keyboard, gamepad, AI, replay playback).
 * The test suite locks down:
 *
 *   1. The keyboard adapter delegates to `LocalInputHandler.sample` —
 *      pressing the bound jump key surfaces on the provider's sample.
 *   2. Slot index is independently configurable so the same
 *      `LocalInputHandler` can drive any pair of match slots.
 *   3. `closeCharacterInput` produces a fully-closed record (every
 *      optional flag becomes `false`, `moveX` is clamped). The replay
 *      buffer's normaliser produces the same byte-shape, but this
 *      module's helper is independent.
 *   4. `NEUTRAL_INPUT_SNAPSHOT` is a frozen, fully-neutral record —
 *      safe for shared reuse across slots and frames.
 *   5. The `PlayerInputProvider` type is structurally compatible with
 *      bespoke implementations (the AI adapter; replay playback). An
 *      ad-hoc provider that returns whatever record it likes
 *      type-checks and runs.
 */

// ---------------------------------------------------------------------------
// Mock keyboard (mirrors the LocalInputHandler test suite pattern)
// ---------------------------------------------------------------------------

function createMockKeyboard(): KeyboardSource & {
  press(...codes: number[]): void;
  release(...codes: number[]): void;
} {
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
  };
}

// ---------------------------------------------------------------------------
// Keyboard adapter
// ---------------------------------------------------------------------------

describe('createKeyboardInputProvider', () => {
  it('delegates sample() to the underlying LocalInputHandler', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    const provider = createKeyboardInputProvider(handler, 1);

    // Neutral key state.
    expect(provider.sample(0)).toEqual({
      moveX: 0, moveY: 0,
      jump: false,
      attack: false,
      shield: false,
      dodge: false,
      dropThrough: false,
    });

    // Press jump (W).
    kb.press(KEY_CODE.W);
    const sampled = provider.sample(1);
    expect(sampled.jump).toBe(true);
    expect(sampled.moveX).toBe(0);
  });

  it('defaults P1 to slot 0 and P2 to slot 1', () => {
    const handler = new LocalInputHandler(createMockKeyboard());
    expect(createKeyboardInputProvider(handler, 1).slotIndex).toBe(0);
    expect(createKeyboardInputProvider(handler, 2).slotIndex).toBe(1);
  });

  it('honours an explicit slotIndex override', () => {
    const handler = new LocalInputHandler(createMockKeyboard());
    const provider = createKeyboardInputProvider(handler, 1, 3);
    expect(provider.slotIndex).toBe(3);
  });

  it('emits a default debug label and accepts an override', () => {
    const handler = new LocalInputHandler(createMockKeyboard());
    expect(createKeyboardInputProvider(handler, 1).label).toBe('keyboard.P1');
    expect(createKeyboardInputProvider(handler, 2).label).toBe('keyboard.P2');
    expect(
      createKeyboardInputProvider(handler, 1, 0, 'lobby.P1').label,
    ).toBe('lobby.P1');
  });

  it('routes keyboard players independently — P1 keys do not bleed into P2', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    const p1 = createKeyboardInputProvider(handler, 1);
    const p2 = createKeyboardInputProvider(handler, 2);

    kb.press(KEY_CODE.D); // P1 right
    expect(p1.sample(0).moveX).toBe(1);
    expect(p2.sample(0).moveX).toBe(0);

    kb.press(KEY_CODE.ARROW_LEFT); // P2 left
    expect(p1.sample(1).moveX).toBe(1);
    expect(p2.sample(1).moveX).toBe(-1);
  });
});

describe('createBothKeyboardInputProviders', () => {
  it('returns a [P1, P2] tuple of slot-scoped providers', () => {
    const handler = new LocalInputHandler(createMockKeyboard());
    const [p1, p2] = createBothKeyboardInputProviders(handler);
    expect(p1.slotIndex).toBe(0);
    expect(p2.slotIndex).toBe(1);
    expect(p1.label).toBe('keyboard.P1');
    expect(p2.label).toBe('keyboard.P2');
  });

  it('respects custom slot assignments for both keyboard players', () => {
    const handler = new LocalInputHandler(createMockKeyboard());
    const [p1, p2] = createBothKeyboardInputProviders(handler, {
      p1Slot: 1,
      p2Slot: 3,
    });
    expect(p1.slotIndex).toBe(1);
    expect(p2.slotIndex).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// closeCharacterInput
// ---------------------------------------------------------------------------

describe('closeCharacterInput', () => {
  it('fills every optional field with false / null', () => {
    const closed = closeCharacterInput({ moveX: 0, moveY: 0, jump: false });
    expect(closed).toEqual({
      moveX: 0, moveY: 0,
      jump: false,
      attack: false,
      attackHeavy: false,
      // T1 (AC 5-9) — `special` joined the closed shape so a press
      // reaches Character.tickAttack's special-dispatch branch.
      special: false,
      // T3 (AC 12) — `grab` joined the closed shape as the dedicated
      // throw key.
      grab: false,
      shield: false,
      dodge: false,
      dropThrough: false,
      ledgeRelease: null,
    });
  });

  it('clamps moveX to [-1, 1] without rounding intermediate values', () => {
    expect(closeCharacterInput({ moveX: 2, moveY: 0, jump: false }).moveX).toBe(1);
    expect(closeCharacterInput({ moveX: -3.5, moveY: 0, jump: false }).moveX).toBe(-1);
    expect(closeCharacterInput({ moveX: 0.42, moveY: 0, jump: false }).moveX).toBe(0.42);
  });

  it('coerces NaN / ±Infinity moveX to 0', () => {
    expect(closeCharacterInput({ moveX: NaN, jump: false }).moveX).toBe(0);
    expect(closeCharacterInput({ moveX: Infinity, jump: false }).moveX).toBe(0);
    expect(
      closeCharacterInput({ moveX: -Infinity, jump: false }).moveX,
    ).toBe(0);
  });

  it('preserves explicit press flags', () => {
    const closed = closeCharacterInput({
      moveX: 1, moveY: 0,
      jump: true,
      attack: true,
      attackHeavy: true,
      special: true,
      grab: true,
      shield: true,
      dodge: true,
      dropThrough: true,
      ledgeRelease: 'getUp',
    });
    expect(closed).toEqual({
      moveX: 1, moveY: 0,
      jump: true,
      attack: true,
      attackHeavy: true,
      special: true,
      grab: true,
      shield: true,
      dodge: true,
      dropThrough: true,
      ledgeRelease: 'getUp',
    });
  });

  it('returns a frozen record so the replay path can share the reference', () => {
    const closed = closeCharacterInput({ moveX: 0, moveY: 0, jump: false });
    expect(Object.isFrozen(closed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NEUTRAL_INPUT_SNAPSHOT
// ---------------------------------------------------------------------------

describe('NEUTRAL_INPUT_SNAPSHOT', () => {
  it('is a fully-neutral, frozen record', () => {
    expect(NEUTRAL_INPUT_SNAPSHOT.moveX).toBe(0);
    expect(NEUTRAL_INPUT_SNAPSHOT.jump).toBe(false);
    expect(NEUTRAL_INPUT_SNAPSHOT.attack).toBe(false);
    expect(NEUTRAL_INPUT_SNAPSHOT.dropThrough).toBe(false);
    expect(Object.isFrozen(NEUTRAL_INPUT_SNAPSHOT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Structural compatibility — ad-hoc provider implementations
// ---------------------------------------------------------------------------

describe('PlayerInputProvider structural typing', () => {
  it('accepts any object that implements the slotIndex + sample contract', () => {
    let calls = 0;
    const provider: PlayerInputProvider = {
      slotIndex: 2,
      label: 'always-jump',
      sample(_frame) {
        calls += 1;
        return closeCharacterInput({ moveX: 0, moveY: 0, jump: true });
      },
    };
    const sample0 = provider.sample(0);
    const sample1 = provider.sample(1);
    expect(calls).toBe(2);
    expect(sample0.jump).toBe(true);
    expect(sample1.jump).toBe(true);
  });

  it('treats reset() as optional', () => {
    const provider: PlayerInputProvider = {
      slotIndex: 0,
      sample(_frame) {
        return NEUTRAL_INPUT_SNAPSHOT;
      },
    };
    expect(provider.reset).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC 40102 Sub-AC 2 — Bindings-aware keyboard device adapter
// ---------------------------------------------------------------------------
//
// The legacy `createKeyboardInputProvider` wraps `LocalInputHandler`, which
// holds two hardcoded binding tables (DEFAULT_P1_BINDINGS /
// DEFAULT_P2_BINDINGS). The new adapter resolves every keyCode through the
// per-player BindingsStore, so:
//
//   • A rebind committed via `store.setAction(slot, ...)` takes effect on
//     the very next sample — no scene reload, no provider reconstruction.
//   • There is no hardcoded keyCode constant anywhere in the adapter's
//     read path; pointing the store at a totally exotic keyCode (e.g.
//     SPACE) makes the adapter listen on SPACE, period.
//   • Empty binding lists read as "deliberately unbound" (the schema doc's
//     contract) — the action stays released for that slot.
//   • Gamepad bindings on the same action are silently ignored (the
//     keyboard adapter is device-scoped — gamepad slots use the
//     dispatcher's gamepad path).
// ---------------------------------------------------------------------------

describe('createBindingsKeyboardInputProvider — AC 40102 Sub-AC 2', () => {
  it('resolves the live BindingsStore profile for the given player slot', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    const provider = createBindingsKeyboardInputProvider({
      keyboard: kb,
      bindings: store,
      playerSlot: 1,
    });

    // Default P1 layout: jump = W, attack = F, left = A, right = D.
    expect(provider.sample(0)).toEqual({
      moveX: 0, moveY: 0,
      jump: false,
      attack: false,
      shield: false,
      dropThrough: false,
    });

    kb.press(KEY_CODE.W); // P1 jump default
    const jumped = provider.sample(1);
    expect(jumped.jump).toBe(true);
    expect(jumped.attack).toBe(false);

    kb.press(KEY_CODE.F); // P1 attack default
    expect(provider.sample(2).attack).toBe(true);
  });

  it('reflects a mid-session rebind on the very next sample (no reload)', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    const provider = createBindingsKeyboardInputProvider({
      keyboard: kb,
      bindings: store,
      playerSlot: 1,
    });

    // Default jump = W. Rebind to SPACE mid-session.
    store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);

    // Pressing W (the OLD bound key) no longer jumps.
    kb.press(KEY_CODE.W);
    expect(provider.sample(0).jump).toBe(false);
    kb.release(KEY_CODE.W);

    // Pressing SPACE (the NEW bound key) does.
    kb.press(KEY_CODE.SPACE);
    expect(provider.sample(1).jump).toBe(true);
  });

  it('treats an empty binding list as deliberately unbound (action stays released)', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    const provider = createBindingsKeyboardInputProvider({
      keyboard: kb,
      bindings: store,
      playerSlot: 1,
    });

    store.setAction(1, 'attack', []); // unbind attack

    // Pressing the original default attack key (F) does nothing.
    kb.press(KEY_CODE.F);
    expect(provider.sample(0).attack).toBe(false);
  });

  it('OR-s multi-bind entries: any bound key fires the action', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    const provider = createBindingsKeyboardInputProvider({
      keyboard: kb,
      bindings: store,
      playerSlot: 1,
    });

    store.setAction(1, 'jump', [
      { kind: 'keyboard', keyCode: KEY_CODE.W },
      { kind: 'keyboard', keyCode: KEY_CODE.SPACE },
      { kind: 'keyboard', keyCode: KEY_CODE.ENTER },
    ]);

    kb.press(KEY_CODE.SPACE);
    expect(provider.sample(0).jump).toBe(true);
    kb.release(KEY_CODE.SPACE);

    kb.press(KEY_CODE.ENTER);
    expect(provider.sample(1).jump).toBe(true);
    kb.release(KEY_CODE.ENTER);

    kb.press(KEY_CODE.W);
    expect(provider.sample(2).jump).toBe(true);
  });

  it('routes P1 and P2 independently through the same BindingsStore', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    const p1 = createBindingsKeyboardInputProvider({
      keyboard: kb,
      bindings: store,
      playerSlot: 1,
    });
    const p2 = createBindingsKeyboardInputProvider({
      keyboard: kb,
      bindings: store,
      playerSlot: 2,
    });

    // P1 right = D, P2 right = ARROW_RIGHT (defaults).
    kb.press(KEY_CODE.D);
    expect(p1.sample(0).moveX).toBe(1);
    expect(p2.sample(0).moveX).toBe(0);

    kb.press(KEY_CODE.ARROW_LEFT);
    expect(p1.sample(1).moveX).toBe(1); // still right (D held)
    expect(p2.sample(1).moveX).toBe(-1);
  });

  it('ignores gamepad bindings on the same action (keyboard-only adapter)', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    const provider = createBindingsKeyboardInputProvider({
      keyboard: kb,
      bindings: store,
      playerSlot: 3, // default = gamepad layout, no keyboard bindings at all
    });

    // No keyboard bindings on slot 3 by default → every keyboard press is a no-op.
    kb.press(KEY_CODE.W, KEY_CODE.F, KEY_CODE.SPACE, KEY_CODE.ARROW_UP);
    expect(provider.sample(0)).toEqual({
      moveX: 0, moveY: 0,
      jump: false,
      attack: false,
      shield: false,
      dropThrough: false,
    });

    // Add a gamepad-only binding on attack — still doesn't react to keys.
    store.setAction(3, 'attack', [
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 2 } },
    ]);
    expect(provider.sample(1).attack).toBe(false);

    // Mix in a keyboard binding alongside the gamepad one — keyboard fires.
    store.setAction(3, 'attack', [
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 2 } },
      { kind: 'keyboard', keyCode: KEY_CODE.F },
    ]);
    expect(provider.sample(2).attack).toBe(true);
  });

  it('left + right cancel to neutral moveX (digital keyboard semantics)', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    const provider = createBindingsKeyboardInputProvider({
      keyboard: kb,
      bindings: store,
      playerSlot: 1,
    });

    kb.press(KEY_CODE.A); // left
    kb.press(KEY_CODE.D); // right
    expect(provider.sample(0).moveX).toBe(0);
  });

  it('drop-through fires only when down + jump are both held', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    const provider = createBindingsKeyboardInputProvider({
      keyboard: kb,
      bindings: store,
      playerSlot: 1,
    });

    // S = down, W = jump (defaults).
    kb.press(KEY_CODE.S);
    expect(provider.sample(0).dropThrough).toBe(false);
    kb.press(KEY_CODE.W);
    expect(provider.sample(1).dropThrough).toBe(true);
    kb.release(KEY_CODE.S);
    expect(provider.sample(2).dropThrough).toBe(false);
  });

  it('forwards the held shield key without runtime gating', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    const provider = createBindingsKeyboardInputProvider({
      keyboard: kb,
      bindings: store,
      playerSlot: 1,
    });

    kb.press(KEY_CODE.H); // P1 shield default
    expect(provider.sample(0).shield).toBe(true);
  });

  it('defaults the slotIndex from the playerSlot (P1 → 0, P2 → 1, P3 → 2, P4 → 3)', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    const slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
    for (const playerSlot of slots) {
      const provider = createBindingsKeyboardInputProvider({
        keyboard: kb,
        bindings: store,
        playerSlot,
      });
      expect(provider.slotIndex).toBe(playerSlot - 1);
    }
  });

  it('honours an explicit slotIndex override', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    const provider = createBindingsKeyboardInputProvider({
      keyboard: kb,
      bindings: store,
      playerSlot: 1,
      slotIndex: 3,
    });
    expect(provider.slotIndex).toBe(3);
  });

  it('emits a "keyboard.bindings.P{n}" debug label by default and accepts an override', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    expect(
      createBindingsKeyboardInputProvider({
        keyboard: kb,
        bindings: store,
        playerSlot: 1,
      }).label,
    ).toBe('keyboard.bindings.P1');
    expect(
      createBindingsKeyboardInputProvider({
        keyboard: kb,
        bindings: store,
        playerSlot: 2,
      }).label,
    ).toBe('keyboard.bindings.P2');
    expect(
      createBindingsKeyboardInputProvider({
        keyboard: kb,
        bindings: store,
        playerSlot: 1,
        label: 'lobby.P1',
      }).label,
    ).toBe('lobby.P1');
  });

  it('accepts a BindingsStore facade and unwraps it to the inner store', () => {
    const kb = createMockKeyboard();
    const store = new BindingsStore({ storage: null }); // disable persistence
    const provider = createBindingsKeyboardInputProvider({
      keyboard: kb,
      bindings: store,
      playerSlot: 1,
    });

    // Default jump = W via the inner store's defaults.
    kb.press(KEY_CODE.W);
    expect(provider.sample(0).jump).toBe(true);

    // Rebind through the facade — auto-persist is a no-op here, but the
    // in-memory state is still updated.
    store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    kb.release(KEY_CODE.W);
    kb.press(KEY_CODE.SPACE);
    expect(provider.sample(1).jump).toBe(true);
  });

  it('accepts an arbitrary PlayerBindingsProvider fixture (test seam)', () => {
    const kb = createMockKeyboard();
    const profile: PlayerBindings = {
      playerIndex: 1,
      bindings: {
        left: [{ kind: 'keyboard', keyCode: KEY_CODE.A }],
        right: [{ kind: 'keyboard', keyCode: KEY_CODE.D }],
        up: [],
        down: [],
        jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }],
        attack: [{ kind: 'keyboard', keyCode: KEY_CODE.ENTER }],
        special: [],
        shield: [],
        grab: [],
        taunt: [],
      },
    };
    const fixture: PlayerBindingsProvider = {
      get(_slot) {
        return profile;
      },
    };
    const provider = createBindingsKeyboardInputProvider({
      keyboard: kb,
      bindings: fixture,
      playerSlot: 1,
    });

    kb.press(KEY_CODE.SPACE);
    expect(provider.sample(0).jump).toBe(true);

    kb.release(KEY_CODE.SPACE);
    kb.press(KEY_CODE.ENTER);
    expect(provider.sample(1).attack).toBe(true);
  });

  it('throws on null/undefined bindings (defensive boundary check)', () => {
    const kb = createMockKeyboard();
    expect(() =>
      createBindingsKeyboardInputProvider({
        keyboard: kb,
        // @ts-expect-error — intentional misuse to assert the runtime guard.
        bindings: null,
        playerSlot: 1,
      }),
    ).toThrow(/null\/undefined/);
  });

  it('throws on a bindings object that does not implement get(slot)', () => {
    const kb = createMockKeyboard();
    expect(() =>
      createBindingsKeyboardInputProvider({
        keyboard: kb,
        // @ts-expect-error — intentional misuse to assert the runtime guard.
        bindings: { wrong: 'shape' },
        playerSlot: 1,
      }),
    ).toThrow(/get\(slot\)/);
  });

  it('does NOT cache the bindings — every sample re-reads the live profile', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    let getCalls = 0;
    const wrapper: PlayerBindingsProvider = {
      get(slot) {
        getCalls += 1;
        return store.get(slot);
      },
    };
    const provider = createBindingsKeyboardInputProvider({
      keyboard: kb,
      bindings: wrapper,
      playerSlot: 1,
    });

    provider.sample(0);
    provider.sample(1);
    provider.sample(2);
    // Three samples → at least three live reads (one per sample). The
    // adapter never memoises the profile so a rebind is always observed.
    expect(getCalls).toBeGreaterThanOrEqual(3);
  });

  it('omits reset() — adapter holds no per-match state', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    const provider = createBindingsKeyboardInputProvider({
      keyboard: kb,
      bindings: store,
      playerSlot: 1,
    });
    expect(provider.reset).toBeUndefined();
  });
});

describe('createBothBindingsKeyboardInputProviders — AC 40102 Sub-AC 2', () => {
  it('returns a [P1, P2] tuple of slot-scoped providers', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    const [p1, p2] = createBothBindingsKeyboardInputProviders({
      keyboard: kb,
      bindings: store,
    });
    expect(p1.slotIndex).toBe(0);
    expect(p2.slotIndex).toBe(1);
    expect(p1.label).toBe('keyboard.bindings.P1');
    expect(p2.label).toBe('keyboard.bindings.P2');
  });

  it('drives both keyboard players from the same BindingsStore', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    const [p1, p2] = createBothBindingsKeyboardInputProviders({
      keyboard: kb,
      bindings: store,
    });

    // Pressing P1's default attack only fires for P1.
    kb.press(KEY_CODE.F);
    expect(p1.sample(0).attack).toBe(true);
    expect(p2.sample(0).attack).toBe(false);

    // And rebinding only P2's attack does not affect P1.
    store.setAction(2, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.W }]);
    kb.release(KEY_CODE.F);
    kb.press(KEY_CODE.W);
    expect(p1.sample(1).jump).toBe(true); // P1 still jumps on W (default)
    expect(p2.sample(1).attack).toBe(true);
  });

  it('respects custom slot assignments for both keyboard players', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    const [p1, p2] = createBothBindingsKeyboardInputProviders({
      keyboard: kb,
      bindings: store,
      p1Slot: 1,
      p2Slot: 3,
    });
    expect(p1.slotIndex).toBe(1);
    expect(p2.slotIndex).toBe(3);
  });

  it('respects custom labels for both keyboard players', () => {
    const kb = createMockKeyboard();
    const store = new InputBindingsStore();
    const [p1, p2] = createBothBindingsKeyboardInputProviders({
      keyboard: kb,
      bindings: store,
      p1Label: 'lobby.P1',
      p2Label: 'lobby.P2',
    });
    expect(p1.label).toBe('lobby.P1');
    expect(p2.label).toBe('lobby.P2');
  });
});

// ---------------------------------------------------------------------------
// AC 40103 Sub-AC 3 — Bindings-aware gamepad device adapter
// ---------------------------------------------------------------------------
//
// The gamepad parallel of `createBindingsKeyboardInputProvider`. The
// adapter resolves every button index / axis index through the
// per-player BindingsStore on every sample, so:
//
//   • A rebind committed via `store.setAction(slot, ...)` takes effect
//     on the very next sample — no scene reload, no provider
//     reconstruction, no hardcoded W3C "standard mapping" constants.
//   • There is no hardcoded button index anywhere in the adapter's
//     read path; pointing the store at button 7 makes the adapter
//     listen on button 7, period.
//   • Empty binding lists read as "deliberately unbound" — the action
//     stays released for that slot.
//   • Keyboard bindings on the same action are silently ignored (the
//     gamepad adapter is device-scoped — keyboard slots use the
//     keyboard adapter or the dispatcher's keyboard path).
//   • Disconnected pads surface as "every action released" so a
//     yanked controller never crashes the scene.
// ---------------------------------------------------------------------------

interface MockGamepad extends GamepadSource {
  connect(index: number): void;
  disconnect(index: number): void;
  setButton(index: number, button: number, state: GamepadButtonState): void;
  setAxis(index: number, axis: number, value: number): void;
  releaseAll(): void;
}

function createMockGamepad(): MockGamepad {
  const connected = new Set<number>();
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
    releaseAll(): void {
      buttons.clear();
      axes.clear();
    },
  };
}

function pressedButton(value = 1): GamepadButtonState {
  return Object.freeze({ pressed: true, value });
}

describe('createBindingsGamepadInputProvider — AC 40103 Sub-AC 3', () => {
  it('resolves the live BindingsStore profile for the given player slot', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: store,
      playerSlot: 3,
    });

    // Pad disconnected → every action released.
    expect(provider.sample(0)).toEqual({
      moveX: 0, moveY: 0,
      jump: false,
      attack: false,
      shield: false,
      dropThrough: false,
    });

    // Connect pad 0 (P3 default index) and press button 0 (jump default).
    gp.connect(0);
    gp.setButton(0, 0, pressedButton());
    const jumped = provider.sample(1);
    expect(jumped.jump).toBe(true);
    expect(jumped.attack).toBe(false);

    // Press button 2 (attack default).
    gp.setButton(0, 2, pressedButton());
    expect(provider.sample(2).attack).toBe(true);

    // Press button 5 (shield default).
    gp.setButton(0, 5, pressedButton());
    expect(provider.sample(3).shield).toBe(true);
  });

  it('reflects a mid-session rebind on the very next sample (no reload)', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: store,
      playerSlot: 3,
    });
    gp.connect(0);

    // Default jump = button 0. Rebind to button 7 mid-session.
    store.setAction(3, 'jump', [
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 7 } },
    ]);

    // Pressing the OLD bound button no longer jumps.
    gp.setButton(0, 0, pressedButton());
    expect(provider.sample(0).jump).toBe(false);
    gp.releaseAll();

    // Pressing the NEW bound button does.
    gp.setButton(0, 7, pressedButton());
    expect(provider.sample(1).jump).toBe(true);
  });

  it('treats an empty binding list as deliberately unbound (action stays released)', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: store,
      playerSlot: 3,
    });
    gp.connect(0);

    store.setAction(3, 'attack', []); // unbind attack

    // Pressing the original default attack button (2) does nothing.
    gp.setButton(0, 2, pressedButton());
    expect(provider.sample(0).attack).toBe(false);
  });

  it('OR-s multi-bind entries: any bound button fires the action', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: store,
      playerSlot: 3,
    });
    gp.connect(0);

    store.setAction(3, 'jump', [
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 0 } },
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 4 } },
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 7 } },
    ]);

    gp.setButton(0, 4, pressedButton());
    expect(provider.sample(0).jump).toBe(true);
    gp.releaseAll();

    gp.setButton(0, 7, pressedButton());
    expect(provider.sample(1).jump).toBe(true);
    gp.releaseAll();

    gp.setButton(0, 0, pressedButton());
    expect(provider.sample(2).jump).toBe(true);
  });

  it('routes P3 and P4 independently — pressing pad 0 does not fire pad 1\'s slot', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const p3 = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: store,
      playerSlot: 3,
    });
    const p4 = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: store,
      playerSlot: 4,
    });

    gp.connect(0);
    gp.connect(1);
    // Press button 0 (jump) on pad 0 — only P3 (pinned to pad 0) fires.
    gp.setButton(0, 0, pressedButton());
    expect(p3.sample(0).jump).toBe(true);
    expect(p4.sample(0).jump).toBe(false);

    // Press button 0 on pad 1 — now P4 fires too.
    gp.setButton(1, 0, pressedButton());
    expect(p4.sample(1).jump).toBe(true);
  });

  it('ignores keyboard bindings on the same action (gamepad-only adapter)', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: store,
      playerSlot: 1, // default = keyboard layout, no gamepad bindings at all
    });

    // Slot 1 default is all-keyboard — every gamepad press is a no-op.
    gp.connect(0);
    gp.setButton(0, 0, pressedButton());
    gp.setButton(0, 2, pressedButton());
    gp.setAxis(0, 0, -1);
    expect(provider.sample(0)).toEqual({
      moveX: 0, moveY: 0,
      jump: false,
      attack: false,
      shield: false,
      dropThrough: false,
    });

    // Mix in a gamepad binding alongside the keyboard one — gamepad fires.
    store.setAction(1, 'attack', [
      { kind: 'keyboard', keyCode: KEY_CODE.F },
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 2 } },
    ]);
    expect(provider.sample(1).attack).toBe(true);
  });

  it('preserves analog magnitude on moveX (half-pushed stick walks instead of dashing)', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: store,
      playerSlot: 3,
    });
    gp.connect(0);

    // Stick at 60% deflection right: moveX should reflect the analog magnitude.
    gp.setAxis(0, 0, 0.6);
    expect(provider.sample(0).moveX).toBeCloseTo(0.6, 5);

    // Stick fully left.
    gp.setAxis(0, 0, -1);
    expect(provider.sample(1).moveX).toBeCloseTo(-1, 5);

    // Stick neutral.
    gp.setAxis(0, 0, 0);
    expect(provider.sample(2).moveX).toBe(0);
  });

  it('does not fire below the per-binding axis threshold', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: store,
      playerSlot: 3,
    });
    gp.connect(0);

    gp.setAxis(0, 0, -DEFAULT_GAMEPAD_AXIS_THRESHOLD + 0.01);
    expect(provider.sample(0).moveX).toBe(0);

    gp.setAxis(0, 0, -DEFAULT_GAMEPAD_AXIS_THRESHOLD);
    expect(provider.sample(1).moveX).toBeCloseTo(-DEFAULT_GAMEPAD_AXIS_THRESHOLD, 5);
  });

  it('treats a disconnected pad as fully released for every action', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: store,
      playerSlot: 3,
    });
    // Stage state on a disconnected pad — should still read as released.
    gp.setButton(0, 0, pressedButton());
    gp.setButton(0, 2, pressedButton());
    gp.setAxis(0, 0, -1);
    expect(provider.sample(0)).toEqual({
      moveX: 0, moveY: 0,
      jump: false,
      attack: false,
      shield: false,
      dropThrough: false,
    });
  });

  it('drop-through fires only when down + jump are both held on the pad', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: store,
      playerSlot: 3,
    });
    gp.connect(0);

    // Down = stick Y +1, jump = button 0 (defaults).
    gp.setAxis(0, 1, 1);
    expect(provider.sample(0).dropThrough).toBe(false);
    gp.setButton(0, 0, pressedButton());
    expect(provider.sample(1).dropThrough).toBe(true);
    gp.setAxis(0, 1, 0);
    expect(provider.sample(2).dropThrough).toBe(false);
  });

  it('a binding with gamepadIndex = null fires from any connected pad within the scan range', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    store.setAction(3, 'attack', [
      { kind: 'gamepad', gamepadIndex: null, source: { type: 'button', buttonIndex: 9 } },
    ]);
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: store,
      playerSlot: 3,
    });

    // Press the button on pad 2 (somewhere in the 0..3 scan window).
    gp.connect(2);
    gp.setButton(2, 9, pressedButton());
    expect(provider.sample(0).attack).toBe(true);

    // GAMEPAD_ANY_PAD_SCAN_RANGE bounds the scan — assert the constant
    // is the documented value so a future bump is intentional.
    expect(GAMEPAD_ANY_PAD_SCAN_RANGE).toBe(4);
  });

  it('forwards the held shield button without runtime gating', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: store,
      playerSlot: 3,
    });
    gp.connect(0);
    gp.setButton(0, 5, pressedButton()); // P3 shield default = button 5
    expect(provider.sample(0).shield).toBe(true);
  });

  it('defaults the slotIndex from the playerSlot (P1 → 0, P2 → 1, P3 → 2, P4 → 3)', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
    for (const playerSlot of slots) {
      const provider = createBindingsGamepadInputProvider({
        gamepad: gp,
        bindings: store,
        playerSlot,
      });
      expect(provider.slotIndex).toBe(playerSlot - 1);
    }
  });

  it('honours an explicit slotIndex override', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: store,
      playerSlot: 3,
      slotIndex: 0,
    });
    expect(provider.slotIndex).toBe(0);
  });

  it('emits a "gamepad.bindings.P{n}" debug label by default and accepts an override', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    expect(
      createBindingsGamepadInputProvider({
        gamepad: gp,
        bindings: store,
        playerSlot: 3,
      }).label,
    ).toBe('gamepad.bindings.P3');
    expect(
      createBindingsGamepadInputProvider({
        gamepad: gp,
        bindings: store,
        playerSlot: 4,
      }).label,
    ).toBe('gamepad.bindings.P4');
    expect(
      createBindingsGamepadInputProvider({
        gamepad: gp,
        bindings: store,
        playerSlot: 3,
        label: 'lobby.P3',
      }).label,
    ).toBe('lobby.P3');
  });

  it('accepts a BindingsStore facade and unwraps it to the inner store', () => {
    const gp = createMockGamepad();
    const store = new BindingsStore({ storage: null }); // disable persistence
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: store,
      playerSlot: 3,
    });
    gp.connect(0);

    // Default jump = button 0 via the inner store's defaults.
    gp.setButton(0, 0, pressedButton());
    expect(provider.sample(0).jump).toBe(true);

    // Rebind through the facade — auto-persist is a no-op here, but the
    // in-memory state is still updated.
    store.setAction(3, 'jump', [
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 11 } },
    ]);
    gp.releaseAll();
    gp.setButton(0, 11, pressedButton());
    expect(provider.sample(1).jump).toBe(true);
  });

  it('accepts an arbitrary PlayerBindingsProvider fixture (test seam)', () => {
    const gp = createMockGamepad();
    const profile: PlayerBindings = {
      playerIndex: 3,
      bindings: {
        left: [
          {
            kind: 'gamepad',
            gamepadIndex: 0,
            source: { type: 'axis', axisIndex: 0, direction: -1, threshold: 0.5 },
          },
        ],
        right: [
          {
            kind: 'gamepad',
            gamepadIndex: 0,
            source: { type: 'axis', axisIndex: 0, direction: 1, threshold: 0.5 },
          },
        ],
        up: [],
        down: [],
        jump: [
          { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 11 } },
        ],
        attack: [
          { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 12 } },
        ],
        special: [],
        shield: [],
        grab: [],
        taunt: [],
      },
    };
    const fixture: PlayerBindingsProvider = {
      get(_slot) {
        return profile;
      },
    };
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: fixture,
      playerSlot: 3,
    });
    gp.connect(0);

    gp.setButton(0, 11, pressedButton());
    expect(provider.sample(0).jump).toBe(true);

    gp.setButton(0, 12, pressedButton());
    expect(provider.sample(1).attack).toBe(true);
  });

  it('throws on null/undefined bindings (defensive boundary check)', () => {
    const gp = createMockGamepad();
    expect(() =>
      createBindingsGamepadInputProvider({
        gamepad: gp,
        // @ts-expect-error — intentional misuse to assert the runtime guard.
        bindings: null,
        playerSlot: 3,
      }),
    ).toThrow(/null\/undefined/);
  });

  it('throws on a bindings object that does not implement get(slot)', () => {
    const gp = createMockGamepad();
    expect(() =>
      createBindingsGamepadInputProvider({
        gamepad: gp,
        // @ts-expect-error — intentional misuse to assert the runtime guard.
        bindings: { wrong: 'shape' },
        playerSlot: 3,
      }),
    ).toThrow(/get\(slot\)/);
  });

  it('does NOT cache the bindings — every sample re-reads the live profile', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    let getCalls = 0;
    const wrapper: PlayerBindingsProvider = {
      get(slot) {
        getCalls += 1;
        return store.get(slot);
      },
    };
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: wrapper,
      playerSlot: 3,
    });

    provider.sample(0);
    provider.sample(1);
    provider.sample(2);
    // Three samples → at least three live reads (one per sample). The
    // adapter never memoises the profile so a rebind is always observed.
    expect(getCalls).toBeGreaterThanOrEqual(3);
  });

  it('omits reset() — adapter holds no per-match state', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: store,
      playerSlot: 3,
    });
    expect(provider.reset).toBeUndefined();
  });

  it('left+right at equal magnitudes cancel to zero (truly centred stick)', () => {
    // Synthetic profile that binds both `left` and `right` to the
    // *same* axis source (unusual, but the OR-of-bindings semantics
    // make it valid). Equal magnitudes should cancel.
    const gp = createMockGamepad();
    const profile: PlayerBindings = {
      playerIndex: 3,
      bindings: {
        left: [
          {
            kind: 'gamepad',
            gamepadIndex: 0,
            source: { type: 'axis', axisIndex: 0, direction: -1, threshold: 0.5 },
          },
        ],
        right: [
          {
            kind: 'gamepad',
            gamepadIndex: 0,
            source: { type: 'axis', axisIndex: 0, direction: 1, threshold: 0.5 },
          },
        ],
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
    const fixture: PlayerBindingsProvider = { get: () => profile };
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: fixture,
      playerSlot: 3,
    });
    gp.connect(0);

    // Stick at neutral — neither half-axis crosses the threshold.
    expect(provider.sample(0).moveX).toBe(0);

    // Stick at full right — only the `right` half-axis fires.
    gp.setAxis(0, 0, 1);
    expect(provider.sample(1).moveX).toBeCloseTo(1, 5);

    // Stick at full left — only the `left` half-axis fires.
    gp.setAxis(0, 0, -1);
    expect(provider.sample(2).moveX).toBeCloseTo(-1, 5);
  });

  it('uses analog trigger value for button magnitude when available', () => {
    // A trigger reports both `pressed` (true once it crosses the
    // browser's hardware threshold) and an analog `value` in [0, 1].
    // The adapter's magnitude path uses `value` when non-zero — the
    // dispatcher's same path uses the same rule.
    const gp = createMockGamepad();
    const profile: PlayerBindings = {
      playerIndex: 3,
      bindings: {
        left: [],
        right: [
          { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 6 } },
        ],
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
    const fixture: PlayerBindingsProvider = { get: () => profile };
    const provider = createBindingsGamepadInputProvider({
      gamepad: gp,
      bindings: fixture,
      playerSlot: 3,
    });
    gp.connect(0);

    gp.setButton(0, 6, { pressed: true, value: 0.4 });
    expect(provider.sample(0).moveX).toBeCloseTo(0.4, 5);

    gp.setButton(0, 6, { pressed: true, value: 1 });
    expect(provider.sample(1).moveX).toBeCloseTo(1, 5);
  });
});

describe('createBothBindingsGamepadInputProviders — AC 40103 Sub-AC 3', () => {
  it('returns a [P3, P4] tuple of slot-scoped providers', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const [p3, p4] = createBothBindingsGamepadInputProviders({
      gamepad: gp,
      bindings: store,
    });
    expect(p3.slotIndex).toBe(2);
    expect(p4.slotIndex).toBe(3);
    expect(p3.label).toBe('gamepad.bindings.P3');
    expect(p4.label).toBe('gamepad.bindings.P4');
  });

  it('drives both gamepad players from the same BindingsStore', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const [p3, p4] = createBothBindingsGamepadInputProviders({
      gamepad: gp,
      bindings: store,
    });
    gp.connect(0);
    gp.connect(1);

    // Pressing P3's pad-0 jump button only fires for P3.
    gp.setButton(0, 0, pressedButton());
    expect(p3.sample(0).jump).toBe(true);
    expect(p4.sample(0).jump).toBe(false);

    // Rebinding only P4's attack does not affect P3.
    store.setAction(4, 'attack', [
      { kind: 'gamepad', gamepadIndex: 1, source: { type: 'button', buttonIndex: 11 } },
    ]);
    gp.releaseAll();
    gp.setButton(1, 11, pressedButton());
    expect(p4.sample(1).attack).toBe(true);
    expect(p3.sample(1).attack).toBe(false);
  });

  it('respects custom slot assignments for both gamepad players', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const [p3, p4] = createBothBindingsGamepadInputProviders({
      gamepad: gp,
      bindings: store,
      p3Slot: 0,
      p4Slot: 1,
    });
    expect(p3.slotIndex).toBe(0);
    expect(p4.slotIndex).toBe(1);
  });

  it('respects custom labels for both gamepad players', () => {
    const gp = createMockGamepad();
    const store = new InputBindingsStore();
    const [p3, p4] = createBothBindingsGamepadInputProviders({
      gamepad: gp,
      bindings: store,
      p3Label: 'lobby.P3',
      p4Label: 'lobby.P4',
    });
    expect(p3.label).toBe('lobby.P3');
    expect(p4.label).toBe('lobby.P4');
  });
});
