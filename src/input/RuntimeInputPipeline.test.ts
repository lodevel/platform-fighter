/**
 * AC 50203 Sub-AC 3 — RuntimeInputPipeline.
 *
 * Locks down the runtime input pipeline that connects the bindings
 * store to per-slot gameplay input via the {@link InputBindingManager}:
 *
 *   1. Per-slot device assignment — slots 1/2 routed through their
 *      keyboard cluster bindings, slots 3/4 through their assigned
 *      gamepad indices. A keyboard press on slot 3's pad index does
 *      not fire slot 3's actions; a gamepad axis push for slot 1 does
 *      nothing.
 *   2. Multi-player simultaneous polling — four slots, four assignments
 *      (two keyboard clusters + two gamepads), each holding their own
 *      jump on the same frame produces the right
 *      {@link CharacterInput} record for every slot independently.
 *   3. Live rebind on the shared store — a `setAction` against the
 *      same store the pipeline reads from is visible on the very
 *      next `update()` without scene reload.
 *   4. Mid-session reassignment — `assignSlotDevice(slot, ...)`
 *      hot-swaps a slot from keyboard to gamepad (or to a different
 *      gamepad index) without rebuilding the pipeline. The new device
 *      drives gameplay on the very next frame, the previous device's
 *      held inputs no longer fire phantom presses on the slot.
 *   5. Single device sample feeds every consumer — both
 *      `getCharacterInput(slot)` and `getController(slot)` read off
 *      the same per-frame snapshot the manager poll established.
 */

import { describe, expect, it } from 'vitest';
import {
  DeviceInputDispatcher,
  type GamepadButtonState,
  type GamepadSource,
} from './DeviceInputDispatcher';
import { InputBindingsStore } from './InputBindingsStore';
import { InputBindingManager } from './InputBindingManager';
import {
  RuntimeInputPipeline,
  defaultRuntimeSlotConfigs,
  profileForAssignment,
  type RuntimeSlotConfig,
} from './RuntimeInputPipeline';
import { KEY_CODE } from './keyCodes';
import type { KeyboardSource } from './LocalInputHandler';

// ---------------------------------------------------------------------------
// Mocks — same shape as the rest of the input suite.
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

interface FourPlayerFixture {
  readonly bindings: InputBindingsStore;
  readonly keyboard: MockKeyboard;
  readonly gamepad: MockGamepad;
  readonly pipeline: RuntimeInputPipeline;
}

function buildFourPlayerFixture(): FourPlayerFixture {
  const bindings = new InputBindingsStore();
  const keyboard = createMockKeyboard();
  const gamepad = createMockGamepad();
  // Connect both pads up front so default gamepad slots can fire on
  // their canonical indices without an extra setup step in each test.
  gamepad.connect(0);
  gamepad.connect(1);
  const pipeline = new RuntimeInputPipeline({
    bindings,
    keyboard,
    gamepad,
    slots: defaultRuntimeSlotConfigs(),
  });
  return { bindings, keyboard, gamepad, pipeline };
}

// ---------------------------------------------------------------------------
// 1. Construction — bindings are written to the store per assignment
// ---------------------------------------------------------------------------

describe('RuntimeInputPipeline — slot assignments configure the bindings store', () => {
  it('writes the keyboard P1 / P2 defaults for keyboard slots and the gamepad defaults for gamepad slots', () => {
    const fx = buildFourPlayerFixture();

    // Slot 1 → P1 keyboard cluster (jump = W = 87).
    const slot1 = fx.bindings.get(1);
    expect(slot1.bindings.jump.length).toBe(1);
    expect(slot1.bindings.jump[0]).toEqual({ kind: 'keyboard', keyCode: KEY_CODE.W });

    // Slot 2 → P2 keyboard cluster (jump = ARROW_UP = 38).
    const slot2 = fx.bindings.get(2);
    expect(slot2.bindings.jump.length).toBe(1);
    expect(slot2.bindings.jump[0]).toEqual({ kind: 'keyboard', keyCode: KEY_CODE.ARROW_UP });

    // Slot 3 → gamepad index 0 (jump = button 0).
    const slot3 = fx.bindings.get(3);
    expect(slot3.bindings.jump.length).toBe(1);
    const jump3 = slot3.bindings.jump[0];
    expect(jump3?.kind).toBe('gamepad');
    if (jump3 && jump3.kind === 'gamepad') {
      expect(jump3.gamepadIndex).toBe(0);
    }

    // Slot 4 → gamepad index 1.
    const slot4 = fx.bindings.get(4);
    const jump4 = slot4.bindings.jump[0];
    expect(jump4?.kind).toBe('gamepad');
    if (jump4 && jump4.kind === 'gamepad') {
      expect(jump4.gamepadIndex).toBe(1);
    }
  });

  it('exposes the registered assignment per slot via getAssignment', () => {
    const fx = buildFourPlayerFixture();
    expect(fx.pipeline.getAssignment(1)).toEqual({ kind: 'keyboard', cluster: 'p1' });
    expect(fx.pipeline.getAssignment(2)).toEqual({ kind: 'keyboard', cluster: 'p2' });
    expect(fx.pipeline.getAssignment(3)).toEqual({ kind: 'gamepad', gamepadIndex: 0 });
    expect(fx.pipeline.getAssignment(4)).toEqual({ kind: 'gamepad', gamepadIndex: 1 });
  });

  it('returns null assignment for unregistered slots', () => {
    const bindings = new InputBindingsStore();
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    const pipeline = new RuntimeInputPipeline({
      bindings,
      keyboard,
      gamepad,
      slots: [
        { slot: 1, assignment: { kind: 'keyboard', cluster: 'p1' } },
        { slot: 2, assignment: { kind: 'keyboard', cluster: 'p2' } },
      ],
    });
    expect(pipeline.getAssignment(3)).toBeNull();
    expect(pipeline.getAssignment(4)).toBeNull();
    expect(pipeline.getController(3)).toBeNull();
    expect(pipeline.getCharacterInput(3)).toBeNull();
  });

  it('throws on duplicate slot entries', () => {
    const bindings = new InputBindingsStore();
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    expect(
      () =>
        new RuntimeInputPipeline({
          bindings,
          keyboard,
          gamepad,
          slots: [
            { slot: 1, assignment: { kind: 'keyboard', cluster: 'p1' } },
            { slot: 1, assignment: { kind: 'gamepad', gamepadIndex: 0 } },
          ],
        }),
    ).toThrow(/duplicate slot/i);
  });

  it('only tracks the manager-poll slots that were registered', () => {
    const bindings = new InputBindingsStore();
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    const pipeline = new RuntimeInputPipeline({
      bindings,
      keyboard,
      gamepad,
      slots: [{ slot: 2, assignment: { kind: 'keyboard', cluster: 'p2' } }],
    });
    expect(pipeline.getSlots()).toEqual([2]);
  });
});

// ---------------------------------------------------------------------------
// 2. Multi-player end-to-end: each slot reads through its assigned device
// ---------------------------------------------------------------------------

describe('RuntimeInputPipeline — per-slot device routing', () => {
  it('keyboard P1 jump fires for slot 1 only — slots 2/3/4 stay neutral', () => {
    const fx = buildFourPlayerFixture();
    fx.keyboard.press(KEY_CODE.W); // P1 jump
    fx.pipeline.update(0);
    expect(fx.pipeline.getCharacterInput(1)?.jump).toBe(true);
    expect(fx.pipeline.getCharacterInput(2)?.jump).toBe(false);
    expect(fx.pipeline.getCharacterInput(3)?.jump).toBe(false);
    expect(fx.pipeline.getCharacterInput(4)?.jump).toBe(false);
  });

  it('keyboard P2 jump fires for slot 2 only — slots 1/3/4 stay neutral', () => {
    const fx = buildFourPlayerFixture();
    fx.keyboard.press(KEY_CODE.ARROW_UP); // P2 jump
    fx.pipeline.update(0);
    expect(fx.pipeline.getCharacterInput(1)?.jump).toBe(false);
    expect(fx.pipeline.getCharacterInput(2)?.jump).toBe(true);
    expect(fx.pipeline.getCharacterInput(3)?.jump).toBe(false);
    expect(fx.pipeline.getCharacterInput(4)?.jump).toBe(false);
  });

  it('gamepad 0 button 0 fires slot 3 jump only — keyboard / pad 1 / slot 4 untouched', () => {
    const fx = buildFourPlayerFixture();
    fx.gamepad.setButton(0, 0, Object.freeze({ pressed: true, value: 1 }));
    fx.pipeline.update(0);
    expect(fx.pipeline.getCharacterInput(1)?.jump).toBe(false);
    expect(fx.pipeline.getCharacterInput(2)?.jump).toBe(false);
    expect(fx.pipeline.getCharacterInput(3)?.jump).toBe(true);
    expect(fx.pipeline.getCharacterInput(4)?.jump).toBe(false);
  });

  it('gamepad 1 button 0 fires slot 4 jump only — pad 0 / keyboard / slot 3 untouched', () => {
    const fx = buildFourPlayerFixture();
    fx.gamepad.setButton(1, 0, Object.freeze({ pressed: true, value: 1 }));
    fx.pipeline.update(0);
    expect(fx.pipeline.getCharacterInput(1)?.jump).toBe(false);
    expect(fx.pipeline.getCharacterInput(2)?.jump).toBe(false);
    expect(fx.pipeline.getCharacterInput(3)?.jump).toBe(false);
    expect(fx.pipeline.getCharacterInput(4)?.jump).toBe(true);
  });

  it('all four slots fire jumps simultaneously when each player presses their assigned device', () => {
    const fx = buildFourPlayerFixture();
    fx.keyboard.press(KEY_CODE.W, KEY_CODE.ARROW_UP);
    fx.gamepad.setButton(0, 0, Object.freeze({ pressed: true, value: 1 }));
    fx.gamepad.setButton(1, 0, Object.freeze({ pressed: true, value: 1 }));
    fx.pipeline.update(0);
    for (const slot of [1, 2, 3, 4] as const) {
      expect(
        fx.pipeline.getCharacterInput(slot)?.jump,
        `slot ${slot} did not see its jump press`,
      ).toBe(true);
    }
  });

  it('gamepad axis movement on pad 0 ramps slot 3 moveX without affecting other slots', () => {
    const fx = buildFourPlayerFixture();
    // Default slot 3 uses pad 0 axis 0, threshold 0.5.
    fx.gamepad.setAxis(0, 0, 1); // full right
    fx.pipeline.update(0);
    expect(fx.pipeline.getCharacterInput(3)?.moveX).toBe(1);
    // Slot 4 axis is on pad 1 — pad 0 push should not leak.
    expect(fx.pipeline.getCharacterInput(4)?.moveX).toBe(0);
    // Keyboard slots stay neutral.
    expect(fx.pipeline.getCharacterInput(1)?.moveX).toBe(0);
    expect(fx.pipeline.getCharacterInput(2)?.moveX).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Live rebind through the shared store — no pipeline reconstruction
// ---------------------------------------------------------------------------

describe('RuntimeInputPipeline — live rebinds applied mid-session', () => {
  it('a setAction on the bindings store is visible on the very next update()', () => {
    const fx = buildFourPlayerFixture();
    // Player has been holding the *future* binding key — does nothing yet
    // because the slot still uses defaults.
    fx.keyboard.press(KEY_CODE.SPACE);
    fx.pipeline.update(0);
    expect(fx.pipeline.getCharacterInput(1)?.jump).toBe(false);

    // Simulate the rebinding screen committing "jump = SPACE" for slot 1.
    fx.bindings.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);

    // Same physical press, next frame: the new binding is honoured.
    fx.pipeline.update(1);
    expect(fx.pipeline.getCharacterInput(1)?.jump).toBe(true);

    // Releasing the new key drops jump on the very next sample — proves
    // the dispatcher reads the live key state, not a buffered snapshot.
    fx.keyboard.releaseAll();
    fx.pipeline.update(2);
    expect(fx.pipeline.getCharacterInput(1)?.jump).toBe(false);
  });

  it('a gamepad rebind on slot 3 takes effect on the next frame without rebuilding the pipeline', () => {
    const fx = buildFourPlayerFixture();
    // Default slot 3 jump = pad 0 button 0. Remap to pad 0 button 7.
    fx.bindings.setAction(3, 'jump', [
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 7 } },
    ]);

    // Old button does nothing now.
    fx.gamepad.setButton(0, 0, Object.freeze({ pressed: true, value: 1 }));
    fx.pipeline.update(0);
    expect(fx.pipeline.getCharacterInput(3)?.jump).toBe(false);

    // New button fires jump.
    fx.gamepad.setButton(0, 0, Object.freeze({ pressed: false, value: 0 }));
    fx.gamepad.setButton(0, 7, Object.freeze({ pressed: true, value: 1 }));
    fx.pipeline.update(1);
    expect(fx.pipeline.getCharacterInput(3)?.jump).toBe(true);
  });

  it('rebinding the device family for a slot (keyboard ⇒ gamepad) via the store routes through the new device', () => {
    const fx = buildFourPlayerFixture();
    // Slot 2 starts as P2 keyboard. Move it onto pad 0 button 9 — the
    // exact mutation a "move slot 2 to a controller" rebinding flow
    // would produce.
    fx.bindings.setAction(2, 'jump', [
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 9 } },
    ]);
    // Holding the old keyboard arrow no longer fires jump.
    fx.keyboard.press(KEY_CODE.ARROW_UP);
    fx.pipeline.update(0);
    expect(fx.pipeline.getCharacterInput(2)?.jump).toBe(false);
    // Pressing the new gamepad button does.
    fx.gamepad.setButton(0, 9, Object.freeze({ pressed: true, value: 1 }));
    fx.pipeline.update(1);
    expect(fx.pipeline.getCharacterInput(2)?.jump).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Mid-session reassignment — assignSlotDevice
// ---------------------------------------------------------------------------

describe('RuntimeInputPipeline — assignSlotDevice hot-swaps a slot mid-session', () => {
  it('reassigning slot 3 to a different gamepad index routes the new pad to the slot', () => {
    const fx = buildFourPlayerFixture();
    // Default slot 3 reads pad 0. Reassign to pad 2.
    fx.gamepad.connect(2);
    fx.pipeline.assignSlotDevice(3, { kind: 'gamepad', gamepadIndex: 2 });

    // Pressing the OLD pad's button does nothing.
    fx.gamepad.setButton(0, 0, Object.freeze({ pressed: true, value: 1 }));
    fx.pipeline.update(0);
    expect(fx.pipeline.getCharacterInput(3)?.jump).toBe(false);

    // Pressing the NEW pad's button fires jump on slot 3.
    fx.gamepad.setButton(0, 0, Object.freeze({ pressed: false, value: 0 }));
    fx.gamepad.setButton(2, 0, Object.freeze({ pressed: true, value: 1 }));
    fx.pipeline.update(1);
    expect(fx.pipeline.getCharacterInput(3)?.jump).toBe(true);
    expect(fx.pipeline.getAssignment(3)).toEqual({ kind: 'gamepad', gamepadIndex: 2 });
  });

  it('reassigning slot 1 from keyboard to gamepad rewires the slot to read from the pad', () => {
    const fx = buildFourPlayerFixture();
    fx.gamepad.connect(3);
    // Slot 1 starts on P1 keyboard; press the old key on the same frame
    // we reassign to a fresh pad index.
    fx.keyboard.press(KEY_CODE.W);
    fx.pipeline.assignSlotDevice(1, { kind: 'gamepad', gamepadIndex: 3 });
    fx.pipeline.update(0);
    // Old keyboard binding no longer drives slot 1.
    expect(fx.pipeline.getCharacterInput(1)?.jump).toBe(false);

    // Press the new pad's button.
    fx.gamepad.setButton(3, 0, Object.freeze({ pressed: true, value: 1 }));
    fx.pipeline.update(1);
    expect(fx.pipeline.getCharacterInput(1)?.jump).toBe(true);
  });

  it('reassigning a slot does not affect the other slots', () => {
    const fx = buildFourPlayerFixture();
    fx.pipeline.assignSlotDevice(3, { kind: 'keyboard', cluster: 'p1' });
    // Slot 4 still holds its gamepad-1 binding.
    fx.gamepad.setButton(1, 0, Object.freeze({ pressed: true, value: 1 }));
    fx.pipeline.update(0);
    expect(fx.pipeline.getCharacterInput(4)?.jump).toBe(true);
    // Slot 3 now reads from the keyboard.
    fx.keyboard.press(KEY_CODE.W);
    fx.pipeline.update(1);
    expect(fx.pipeline.getCharacterInput(3)?.jump).toBe(true);
  });

  it('reassigning a never-registered slot throws', () => {
    const bindings = new InputBindingsStore();
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    const pipeline = new RuntimeInputPipeline({
      bindings,
      keyboard,
      gamepad,
      slots: [{ slot: 1, assignment: { kind: 'keyboard', cluster: 'p1' } }],
    });
    expect(() => pipeline.assignSlotDevice(2, { kind: 'gamepad', gamepadIndex: 0 })).toThrow();
  });

  it('reassigning after dispose throws', () => {
    const fx = buildFourPlayerFixture();
    fx.pipeline.dispose();
    expect(() => fx.pipeline.assignSlotDevice(1, { kind: 'gamepad', gamepadIndex: 0 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. Single-poll consistency + introspection
// ---------------------------------------------------------------------------

describe('RuntimeInputPipeline — polling + introspection', () => {
  it('update(frame) polls the manager exactly once — getController + getCharacterInput share the snapshot', () => {
    const fx = buildFourPlayerFixture();
    fx.keyboard.press(KEY_CODE.W);
    fx.pipeline.update(7);
    const controller1 = fx.pipeline.getController(1);
    expect(controller1).not.toBeNull();
    expect(controller1?.isActionDown('jump')).toBe(true);
    expect(fx.pipeline.getCharacterInput(1)?.jump).toBe(true);
    // Frame is forwarded to the manager via the controller.
    expect(controller1?.getLastFrame()).toBe(7);
  });

  it('forceRelease drops every held action and resets controller state', () => {
    const fx = buildFourPlayerFixture();
    fx.keyboard.press(KEY_CODE.W);
    fx.pipeline.update(0);
    expect(fx.pipeline.getCharacterInput(1)?.jump).toBe(true);

    fx.pipeline.forceRelease(1);
    // Without another update(), held flags are cleared.
    expect(fx.pipeline.getCharacterInput(1)?.jump).toBe(false);
  });

  it('dispose makes update() a no-op without throwing', () => {
    const fx = buildFourPlayerFixture();
    fx.pipeline.dispose();
    expect(() => fx.pipeline.update(0)).not.toThrow();
    expect(fx.pipeline.isDisposed).toBe(true);
  });

  it('exposes the dispatcher and manager for advanced consumers', () => {
    const fx = buildFourPlayerFixture();
    expect(fx.pipeline.getDispatcher()).toBeInstanceOf(DeviceInputDispatcher);
    expect(fx.pipeline.getManager()).toBeInstanceOf(InputBindingManager);
  });
});

// ---------------------------------------------------------------------------
// 6. Per-slot binding isolation — a press on one slot's device does not
//    leak into another slot's CharacterInput.
// ---------------------------------------------------------------------------

describe('RuntimeInputPipeline — per-slot binding isolation', () => {
  it('two slots assigned to the same gamepad index share the press (legal tag-team setup)', () => {
    const bindings = new InputBindingsStore();
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    gamepad.connect(0);
    const pipeline = new RuntimeInputPipeline({
      bindings,
      keyboard,
      gamepad,
      slots: [
        { slot: 1, assignment: { kind: 'gamepad', gamepadIndex: 0 } },
        { slot: 2, assignment: { kind: 'gamepad', gamepadIndex: 0 } },
      ],
    });
    gamepad.setButton(0, 0, Object.freeze({ pressed: true, value: 1 }));
    pipeline.update(0);
    expect(pipeline.getCharacterInput(1)?.jump).toBe(true);
    expect(pipeline.getCharacterInput(2)?.jump).toBe(true);
  });

  it('each slot only sees its own analog axis on its assigned pad', () => {
    const fx = buildFourPlayerFixture();
    // Slot 3 (pad 0) pushes left; slot 4 (pad 1) pushes right. Same frame.
    fx.gamepad.setAxis(0, 0, -1);
    fx.gamepad.setAxis(1, 0, 1);
    fx.pipeline.update(0);
    expect(fx.pipeline.getCharacterInput(3)?.moveX).toBe(-1);
    expect(fx.pipeline.getCharacterInput(4)?.moveX).toBe(1);
  });

  it('mixed multi-action multi-device frame: each slot fires only its assigned action', () => {
    const fx = buildFourPlayerFixture();
    fx.keyboard.press(KEY_CODE.F); // P1 attack default
    fx.keyboard.press(KEY_CODE.ARROW_RIGHT); // P2 right default
    fx.gamepad.setButton(0, 5, Object.freeze({ pressed: true, value: 1 })); // slot 3 shield
    fx.gamepad.setAxis(1, 1, 1); // slot 4 down (no drop-through without jump)
    fx.pipeline.update(0);

    expect(fx.pipeline.getCharacterInput(1)?.attack).toBe(true);
    expect(fx.pipeline.getCharacterInput(1)?.shield).toBe(false);
    expect(fx.pipeline.getCharacterInput(2)?.moveX).toBe(1);
    expect(fx.pipeline.getCharacterInput(2)?.attack).toBe(false);
    expect(fx.pipeline.getCharacterInput(3)?.shield).toBe(true);
    expect(fx.pipeline.getCharacterInput(3)?.attack).toBe(false);
    // Slot 4 down without jump: dropThrough false.
    expect(fx.pipeline.getCharacterInput(4)?.dropThrough).toBe(false);
    expect(fx.pipeline.getCharacterInput(4)?.attack).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. profileForAssignment helper — pure default lookup
// ---------------------------------------------------------------------------

describe('RuntimeInputPipeline — profileForAssignment', () => {
  it('returns the canonical keyboard cluster bindings for keyboard assignments', () => {
    const p1 = profileForAssignment({ kind: 'keyboard', cluster: 'p1' });
    expect(p1.jump.length).toBe(1);
    expect(p1.jump[0]).toEqual({ kind: 'keyboard', keyCode: KEY_CODE.W });
    const p2 = profileForAssignment({ kind: 'keyboard', cluster: 'p2' });
    expect(p2.jump[0]).toEqual({ kind: 'keyboard', keyCode: KEY_CODE.ARROW_UP });
  });

  it('returns gamepad defaults pinned to the supplied index', () => {
    const pad7 = profileForAssignment({ kind: 'gamepad', gamepadIndex: 7 });
    const jumpBinding = pad7.jump[0];
    expect(jumpBinding?.kind).toBe('gamepad');
    if (jumpBinding && jumpBinding.kind === 'gamepad') {
      expect(jumpBinding.gamepadIndex).toBe(7);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Sparse / variable-size rosters — the pipeline scales with playerSlots
// ---------------------------------------------------------------------------

describe('RuntimeInputPipeline — variable roster sizes', () => {
  it('a 3-player config (P1 keyboard + P3/P4 gamepad) tracks only the registered slots', () => {
    const bindings = new InputBindingsStore();
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    gamepad.connect(0);
    gamepad.connect(1);
    const slots: ReadonlyArray<RuntimeSlotConfig> = [
      { slot: 1, assignment: { kind: 'keyboard', cluster: 'p1' } },
      { slot: 3, assignment: { kind: 'gamepad', gamepadIndex: 0 } },
      { slot: 4, assignment: { kind: 'gamepad', gamepadIndex: 1 } },
    ];
    const pipeline = new RuntimeInputPipeline({ bindings, keyboard, gamepad, slots });

    keyboard.press(KEY_CODE.W);
    gamepad.setButton(0, 0, Object.freeze({ pressed: true, value: 1 }));
    gamepad.setButton(1, 0, Object.freeze({ pressed: true, value: 1 }));
    pipeline.update(0);

    expect(pipeline.getCharacterInput(1)?.jump).toBe(true);
    expect(pipeline.getCharacterInput(2)).toBeNull();
    expect(pipeline.getCharacterInput(3)?.jump).toBe(true);
    expect(pipeline.getCharacterInput(4)?.jump).toBe(true);
    expect(pipeline.getSlots()).toEqual([1, 3, 4]);
  });
});
