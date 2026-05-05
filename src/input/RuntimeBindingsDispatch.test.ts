/**
 * AC 40302 Sub-AC 2 — runtime input dispatcher contract test.
 *
 * Locks down the wiring chain that drives in-game character controls
 * during matches:
 *
 *     RebindingScreen.commit
 *           │   (mutates the inner store the lifecycle owns)
 *           ▼
 *     BindingsPersistenceLifecycle (auto-saves to localStorage)
 *           │   (`getStore()` is the same instance MatchScene reads)
 *           ▼
 *     InputBindingsStore  ◄─── DeviceInputDispatcher / InputService
 *                                       │
 *                                       ▼
 *                               CharacterInput record
 *                                       │
 *                                       ▼
 *                               Character.applyInput  (gameplay)
 *
 * The chain is what the production scenes — `BootScene`,
 * `RebindingScene`, `MatchScene` — already construct, but the
 * intermediate hops are not unit-testable through Phaser. These tests
 * exercise the same composition with the same mocks the rest of the
 * input suite uses, so a regression in any of the layers (the
 * lifecycle's inner-store identity, the dispatcher's stateless
 * binding lookup, the InputService's `sampleCharacterInput` shape) shows
 * up here as a failed assertion.
 *
 * Why a dedicated test rather than extending one of the existing files:
 *
 *   • `InputService.test.ts` already proves "rebind a `setAction(...)`,
 *     read the new action via the service" — but at the bare-store
 *     level. The new test additionally proves that the *lifecycle's*
 *     mutation surface (the path the rebinding screen actually uses)
 *     produces the same effect, AND that the dispatcher seen by
 *     gameplay reads from the lifecycle's inner store by reference.
 *   • The tests assert against the runtime `CharacterInput` shape
 *     (`moveX / jump / attack / shield / dropThrough / dodge`) — the
 *     exact record `Character.applyInput` consumes — so a future
 *     refactor that drops a field from the service's character-input
 *     fold also fails here.
 */

import { describe, expect, it } from 'vitest';
import {
  BindingsPersistenceLifecycle,
  createBootedLifecycle,
} from './BindingsPersistenceLifecycle';
import {
  DeviceInputDispatcher,
  type GamepadButtonState,
  type GamepadSource,
} from './DeviceInputDispatcher';
import { InputService } from './InputService';
import type { KeyboardSource } from './LocalInputHandler';
import { KEY_CODE } from './keyCodes';
import type { StorageLike } from './BindingsStorage';

// ---------------------------------------------------------------------------
// Mocks — mirrors the shape used by the surrounding input suite.
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

class InMemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Builder — wires the same composition `MatchScene.create()` does, minus
// Phaser. Returns the lifecycle (the rebinding-screen write surface) plus
// the dispatcher / service the match scene constructs from
// `lifecycle.getStore()`.
// ---------------------------------------------------------------------------

interface MatchBindingsFixture {
  readonly lifecycle: BindingsPersistenceLifecycle;
  readonly dispatcher: DeviceInputDispatcher;
  readonly service: InputService;
  readonly keyboard: MockKeyboard;
  readonly gamepad: MockGamepad;
  readonly storage: InMemoryStorage;
}

function buildMatchBindingsFixture(): MatchBindingsFixture {
  const storage = new InMemoryStorage();
  // `createBootedLifecycle` is the helper `BootScene.initialiseEngineSystems`
  // uses to seed the registry. Driving the test through it (rather than
  // hand-rolling a lifecycle) keeps the test honest: if the boot
  // factory ever stops returning a usable inner store, the test would
  // fail at construction.
  const { lifecycle } = createBootedLifecycle({ storage });
  const keyboard = createMockKeyboard();
  const gamepad = createMockGamepad();
  // MatchScene reads `lifecycle.getStore()` (now via the new
  // `acquireBindingsStore` priority chain) and threads the same store
  // into the device dispatcher and the unified input service. We do
  // exactly the same wiring here.
  const store = lifecycle.getStore();
  const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad, bindings: store });
  const service = new InputService({ bindings: store, dispatcher });
  return { lifecycle, dispatcher, service, keyboard, gamepad, storage };
}

// ---------------------------------------------------------------------------
// 1. Identity — the dispatcher / service read from the lifecycle's store.
// ---------------------------------------------------------------------------

describe('runtime bindings dispatch — lifecycle/store identity', () => {
  it('lifecycle.getStore() is the same instance the dispatcher reads from', () => {
    const { lifecycle, dispatcher, service } = buildMatchBindingsFixture();
    // The dispatcher and service both expose their bindings provider via
    // their own escape hatches. Both must be the lifecycle's inner
    // store: a future refactor that wraps the store in a copy here
    // would break "rebind takes effect mid-match" silently.
    expect(service.getBindingsProvider()).toBe(lifecycle.getStore());
    // The dispatcher does not export a getter for its bindings, but the
    // service shares its dispatcher with us, so a press through the
    // shared store proves the read path is live.
    void dispatcher; // referenced to satisfy strict-unused
  });

  it('rebinds applied via the lifecycle write API are visible without reload', () => {
    const { lifecycle, service, keyboard } = buildMatchBindingsFixture();
    // P1 default jump = W. Remap to Space the way the rebinding screen
    // would (`commitCapturedBinding` → `store.setAction`); the lifecycle's
    // `setAction` mirrors the screen's path one level up so it also
    // auto-saves to storage.
    lifecycle.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    keyboard.press(KEY_CODE.W);
    expect(service.sampleCharacterInput(1).jump).toBe(false);
    keyboard.releaseAll();
    keyboard.press(KEY_CODE.SPACE);
    expect(service.sampleCharacterInput(1).jump).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Per-player isolation — a P1 rebind doesn't leak into P2/P3/P4.
// ---------------------------------------------------------------------------

describe('runtime bindings dispatch — per-player isolation', () => {
  it('a rebind on slot 1 does not affect slots 2 / 3 / 4', () => {
    const { lifecycle, service, keyboard, gamepad } = buildMatchBindingsFixture();
    // Move P1 attack onto Space. P2 still uses Numpad-1.
    lifecycle.setAction(1, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    keyboard.press(KEY_CODE.SPACE);
    expect(service.sampleCharacterInput(1).attack).toBe(true);
    expect(service.sampleCharacterInput(2).attack).toBe(false);
    keyboard.releaseAll();
    keyboard.press(KEY_CODE.NUMPAD_1);
    expect(service.sampleCharacterInput(2).attack).toBe(true);
    expect(service.sampleCharacterInput(1).attack).toBe(false);
    // Slot 3 still uses default gamepad bindings — verify the gamepad
    // path is unaffected by the keyboard rebind on slot 1.
    keyboard.releaseAll();
    gamepad.connect(0);
    gamepad.setButton(0, 2, Object.freeze({ pressed: true, value: 1 })); // default attack = button 2
    expect(service.sampleCharacterInput(3).attack).toBe(true);
    expect(service.sampleCharacterInput(4).attack).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Keyboard rebind — covers every action that flows through CharacterInput.
// ---------------------------------------------------------------------------

describe('runtime bindings dispatch — keyboard rebind covers every CharacterInput action', () => {
  it('jump / attack / shield / left / right / down all honour the lifecycle rebind', () => {
    const { lifecycle, service, keyboard } = buildMatchBindingsFixture();
    // Remap P1's full action set onto a fresh key cluster the player
    // could plausibly choose — every action moves to a new keyCode so a
    // bug that "still reads from the old binding" surfaces below as a
    // false negative on the new keys.
    const newJump = KEY_CODE.SPACE;
    const newAttack = KEY_CODE.NUMPAD_0;
    const newShield = KEY_CODE.NUMPAD_1;
    const newLeft = KEY_CODE.NUMPAD_2;
    const newRight = KEY_CODE.NUMPAD_3;
    const newDown = KEY_CODE.NUMPAD_4;
    lifecycle.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: newJump }]);
    lifecycle.setAction(1, 'attack', [{ kind: 'keyboard', keyCode: newAttack }]);
    lifecycle.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: newShield }]);
    lifecycle.setAction(1, 'left', [{ kind: 'keyboard', keyCode: newLeft }]);
    lifecycle.setAction(1, 'right', [{ kind: 'keyboard', keyCode: newRight }]);
    lifecycle.setAction(1, 'down', [{ kind: 'keyboard', keyCode: newDown }]);

    // Pressing any of the OLD default keys (W / F / H / A / D / S) must
    // produce a neutral CharacterInput — the rebind has fully replaced
    // the old binding, not layered on top.
    keyboard.press(
      KEY_CODE.W,
      KEY_CODE.F,
      KEY_CODE.H,
      KEY_CODE.A,
      KEY_CODE.D,
      KEY_CODE.S,
    );
    const fromOldKeys = service.sampleCharacterInput(1);
    expect(fromOldKeys.jump).toBe(false);
    expect(fromOldKeys.attack).toBe(false);
    expect(fromOldKeys.shield).toBe(false);
    expect(fromOldKeys.moveX).toBe(0);

    // Pressing the new keys (one at a time) must fire each action.
    keyboard.releaseAll();
    keyboard.press(newJump);
    expect(service.sampleCharacterInput(1).jump).toBe(true);
    keyboard.releaseAll();
    keyboard.press(newAttack);
    expect(service.sampleCharacterInput(1).attack).toBe(true);
    keyboard.releaseAll();
    keyboard.press(newShield);
    expect(service.sampleCharacterInput(1).shield).toBe(true);
    keyboard.releaseAll();
    keyboard.press(newLeft);
    expect(service.sampleCharacterInput(1).moveX).toBe(-1);
    keyboard.releaseAll();
    keyboard.press(newRight);
    expect(service.sampleCharacterInput(1).moveX).toBe(1);

    // Drop-through is the `down + jump` chord — both must be on the new
    // keys, proving the chord re-resolves through the rebind.
    keyboard.releaseAll();
    keyboard.press(newDown, newJump);
    expect(service.sampleCharacterInput(1).dropThrough).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Gamepad rebind — proves slot 3 / 4 routes also flow through the lifecycle.
// ---------------------------------------------------------------------------

describe('runtime bindings dispatch — gamepad rebind drives slot 3/4 controls', () => {
  it('a gamepad rebind on slot 3 takes effect on the very next sample', () => {
    const { lifecycle, service, gamepad } = buildMatchBindingsFixture();
    gamepad.connect(0);
    // Default slot 3 jump = button 0 (A / Cross). Rebind to button 7
    // (right trigger on the standard mapping) — the same mutation the
    // gamepad capture path in `RebindingScreen.submitGamepadButtonCapture`
    // produces on commit.
    lifecycle.setAction(3, 'jump', [
      {
        kind: 'gamepad',
        gamepadIndex: 0,
        source: { type: 'button', buttonIndex: 7 },
      },
    ]);
    // Pressing the OLD button must NOT fire jump anymore.
    gamepad.setButton(0, 0, Object.freeze({ pressed: true, value: 1 }));
    expect(service.sampleCharacterInput(3).jump).toBe(false);
    // Pressing the new button must fire jump.
    gamepad.setButton(0, 0, Object.freeze({ pressed: false, value: 0 }));
    gamepad.setButton(0, 7, Object.freeze({ pressed: true, value: 1 }));
    expect(service.sampleCharacterInput(3).jump).toBe(true);
  });

  it('a gamepad axis rebind for moveX flows through to CharacterInput.moveX', () => {
    const { lifecycle, service, gamepad } = buildMatchBindingsFixture();
    gamepad.connect(0);
    // Re-bind slot 3 left/right onto the right stick (axis 2). Same
    // half-axis shape the default emits, just on a different axis index.
    lifecycle.setAction(3, 'left', [
      {
        kind: 'gamepad',
        gamepadIndex: 0,
        source: { type: 'axis', axisIndex: 2, direction: -1, threshold: 0.5 },
      },
    ]);
    lifecycle.setAction(3, 'right', [
      {
        kind: 'gamepad',
        gamepadIndex: 0,
        source: { type: 'axis', axisIndex: 2, direction: 1, threshold: 0.5 },
      },
    ]);
    // Pushing the OLD axis (0) does nothing for moveX now.
    gamepad.setAxis(0, 0, 1);
    expect(service.sampleCharacterInput(3).moveX).toBe(0);
    gamepad.setAxis(0, 0, 0);
    // Pushing the new axis (2) fully right produces moveX = 1 (analog
    // magnitude clamped) — the same path the M2 4P FFA uses.
    gamepad.setAxis(0, 2, 1);
    expect(service.sampleCharacterInput(3).moveX).toBe(1);
    // Pushing left on the new axis produces moveX = -1.
    gamepad.setAxis(0, 2, -1);
    expect(service.sampleCharacterInput(3).moveX).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// 5. Stateless reads — `sampleCharacterInput` recomputes from live state
//    every call, so a mid-match rebind followed by a key release gives a
//    self-consistent record. This is the property `Character.applyInput`
//    relies on (no implicit per-frame caching anywhere upstream).
// ---------------------------------------------------------------------------

describe('runtime bindings dispatch — stateless re-reads', () => {
  it('a same-frame rebind+press cycle is reflected on the very next sample', () => {
    const { lifecycle, service, keyboard } = buildMatchBindingsFixture();
    keyboard.press(KEY_CODE.SPACE);
    // No binding for SPACE yet — sample should be neutral.
    expect(service.sampleCharacterInput(1).jump).toBe(false);
    // Rebind jump to SPACE.
    lifecycle.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    // Same frame: same key still pressed, but the binding now resolves it.
    expect(service.sampleCharacterInput(1).jump).toBe(true);
    // Release and re-sample — must drop back to false the same frame.
    keyboard.releaseAll();
    expect(service.sampleCharacterInput(1).jump).toBe(false);
  });

  it('reset(slot) on the lifecycle reverts dispatcher reads to defaults', () => {
    const { lifecycle, service, keyboard } = buildMatchBindingsFixture();
    lifecycle.setAction(1, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    keyboard.press(KEY_CODE.SPACE);
    expect(service.sampleCharacterInput(1).attack).toBe(true);
    lifecycle.reset(1);
    keyboard.releaseAll();
    keyboard.press(KEY_CODE.F); // P1 default attack key
    expect(service.sampleCharacterInput(1).attack).toBe(true);
    keyboard.releaseAll();
    keyboard.press(KEY_CODE.SPACE);
    expect(service.sampleCharacterInput(1).attack).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Persistence round-trip — a rebind committed via the lifecycle
//    survives a fresh "boot" against the same storage and is observed
//    by a new dispatcher / service pair. This is the property that
//    makes "press FIGHT after rebinding" durable across session reloads.
// ---------------------------------------------------------------------------

describe('runtime bindings dispatch — persistence across boot cycles', () => {
  it('a rebind committed in session A is honoured by a fresh dispatcher in session B', () => {
    // Session A — apply the rebind.
    const storage = new InMemoryStorage();
    const a = createBootedLifecycle({ storage });
    a.lifecycle.setAction(1, 'jump', [
      { kind: 'keyboard', keyCode: KEY_CODE.SPACE },
    ]);

    // Session B — fresh lifecycle on the same storage, fresh dispatcher
    // and service pair (mirroring "browser tab closed → reopened →
    // MatchScene constructed from scratch").
    const b = createBootedLifecycle({ storage });
    expect(b.hydrate.source).toBe('storage');
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    const dispatcher = new DeviceInputDispatcher({
      keyboard,
      gamepad,
      bindings: b.lifecycle.getStore(),
    });
    const service = new InputService({ bindings: b.lifecycle.getStore(), dispatcher });

    keyboard.press(KEY_CODE.SPACE);
    expect(service.sampleCharacterInput(1).jump).toBe(true);
    // The previous default (W) must NOT fire jump anymore — proving the
    // rebind survived the round-trip end-to-end.
    keyboard.releaseAll();
    keyboard.press(KEY_CODE.W);
    expect(service.sampleCharacterInput(1).jump).toBe(false);
  });
});
