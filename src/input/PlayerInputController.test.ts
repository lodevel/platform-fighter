import { describe, it, expect } from 'vitest';
import {
  DeviceInputDispatcher,
  type GamepadButtonState,
  type GamepadSource,
} from './DeviceInputDispatcher';
import { InputBindingsStore } from './InputBindingsStore';
import { InputBindingManager } from './InputBindingManager';
import type { KeyboardSource } from './LocalInputHandler';
import { KEY_CODE } from './keyCodes';
import {
  ACTION_NAMES,
  PlayerInputController,
  buildCharacterInputFromController,
} from './PlayerInputController';
import { MOVE_NEUTRAL } from './InputService';
import type { PlayerBindingsIndex } from '../types/inputBindings';

/**
 * AC 50201 Sub-AC 1 — PlayerInputController.
 *
 * Locks down:
 *
 *   1. The controller queries the {@link InputBindingManager} every
 *      `update()` rather than referencing a hardcoded keyCode. Searching
 *      this file (and the controller source) for `KEY_CODE` shows zero
 *      references in the controller's mapping path — every key/button
 *      lookup flows through the manager's `isActionHeld`.
 *   2. `isActionDown` reflects the held state at the most recent
 *      `update()`; before any update every action is released.
 *   3. `justPressed` fires on the released → held transition for one
 *      `update()` only; `justReleased` fires on the held → released
 *      transition for one `update()` only.
 *   4. The full Seed action set is covered: `move{Left,Right,Up,Down}`,
 *      `jump`, `attack`, `special`, `shield`, `grab`, `dodge`.
 *   5. Mid-match rebind: rebinding the store after construction is
 *      reflected on the very next `update()` — `justPressed` fires for
 *      the new binding.
 *   6. Dodge is derived through the configured resolver (default chord:
 *      shield + directional). A custom resolver can override.
 *   7. `getMoveVector()` folds the four directional half-axes into a
 *      digital `MoveVector` and reuses the {@link MOVE_NEUTRAL}
 *      singleton at neutral.
 *   8. `reset()` clears every cached snapshot so the next `update()`
 *      establishes a fresh baseline.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface MockKeyboard extends KeyboardSource {
  press(...codes: number[]): void;
  release(...codes: number[]): void;
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
  };
}

function createIdleGamepad(): GamepadSource {
  const NEUTRAL: GamepadButtonState = Object.freeze({ pressed: false, value: 0 });
  return {
    isConnected(): boolean {
      return false;
    },
    getButton(): GamepadButtonState {
      return NEUTRAL;
    },
    getAxis(): number {
      return 0;
    },
  };
}

function buildHarness(slot: PlayerBindingsIndex = 1): {
  controller: PlayerInputController;
  manager: InputBindingManager;
  store: InputBindingsStore;
  keyboard: MockKeyboard;
} {
  const keyboard = createMockKeyboard();
  const gamepad = createIdleGamepad();
  const store = new InputBindingsStore();
  const dispatcher = new DeviceInputDispatcher({
    keyboard,
    gamepad,
    bindings: store,
  });
  const manager = new InputBindingManager({ dispatcher });
  const controller = new PlayerInputController({ manager, slot });
  return { controller, manager, store, keyboard };
}

// ---------------------------------------------------------------------------
// Construction + read shape
// ---------------------------------------------------------------------------

describe('PlayerInputController — construction', () => {
  it('reports every action as released before the first update', () => {
    const { controller } = buildHarness();
    for (const action of ACTION_NAMES) {
      expect(controller.isActionDown(action)).toBe(false);
      expect(controller.justPressed(action)).toBe(false);
      expect(controller.justReleased(action)).toBe(false);
    }
  });

  it('exposes the slot it was constructed for', () => {
    const { controller } = buildHarness(2);
    expect(controller.getSlot()).toBe(2);
  });

  it('exposes the manager it queries', () => {
    const { controller, manager } = buildHarness();
    expect(controller.getManager()).toBe(manager);
  });

  it('returns -1 from getLastFrame before the first update', () => {
    const { controller } = buildHarness();
    expect(controller.getLastFrame()).toBe(-1);
  });

  it('records the frame index passed to update()', () => {
    const { controller } = buildHarness();
    controller.update(42);
    expect(controller.getLastFrame()).toBe(42);
    controller.update(100);
    expect(controller.getLastFrame()).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// isActionDown — held-state reads
// ---------------------------------------------------------------------------

describe('PlayerInputController — isActionDown', () => {
  it('reflects the held state of every action after update()', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.F); // P1 attack
    keyboard.press(KEY_CODE.D); // P1 right
    controller.update(0);
    expect(controller.isActionDown('attack')).toBe(true);
    expect(controller.isActionDown('moveRight')).toBe(true);
    expect(controller.isActionDown('moveLeft')).toBe(false);
    expect(controller.isActionDown('jump')).toBe(false);
  });

  it('updates held state across consecutive updates', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.W); // P1 jump (and up)
    controller.update(0);
    expect(controller.isActionDown('jump')).toBe(true);
    expect(controller.isActionDown('moveUp')).toBe(true);

    keyboard.release(KEY_CODE.W);
    controller.update(1);
    expect(controller.isActionDown('jump')).toBe(false);
    expect(controller.isActionDown('moveUp')).toBe(false);
  });

  it('covers the full Seed action set the AC requires', () => {
    // The set required by the AC: movement (left/right/up/down), jump,
    // attack, special, shield, grab, dodge. Verify every one exists in
    // the controller's exported action names.
    const required = [
      'moveLeft',
      'moveRight',
      'moveUp',
      'moveDown',
      'jump',
      'attack',
      'special',
      'shield',
      'grab',
      'dodge',
    ] as const;
    for (const action of required) {
      expect(ACTION_NAMES).toContain(action);
    }
  });

  it('reports independent state for each player slot', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createIdleGamepad();
    const store = new InputBindingsStore();
    const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad, bindings: store });
    const manager = new InputBindingManager({ dispatcher });
    const p1 = new PlayerInputController({ manager, slot: 1 });
    const p2 = new PlayerInputController({ manager, slot: 2 });

    keyboard.press(KEY_CODE.F); // P1 attack only
    keyboard.press(KEY_CODE.NUMPAD_1); // P2 attack only
    p1.update(0);
    p2.update(0);
    expect(p1.isActionDown('attack')).toBe(true);
    expect(p2.isActionDown('attack')).toBe(true);

    keyboard.release(KEY_CODE.F);
    p1.update(1);
    p2.update(1);
    expect(p1.isActionDown('attack')).toBe(false);
    expect(p2.isActionDown('attack')).toBe(true); // P2 still holds NUMPAD_1
  });
});

// ---------------------------------------------------------------------------
// justPressed / justReleased — edge detection
// ---------------------------------------------------------------------------

describe('PlayerInputController — justPressed / justReleased', () => {
  it('fires justPressed on the released → held transition for one frame only', () => {
    const { controller, keyboard } = buildHarness();
    // First update establishes the baseline; no edge yet.
    controller.update(0);
    expect(controller.justPressed('attack')).toBe(false);

    keyboard.press(KEY_CODE.F);
    controller.update(1);
    expect(controller.justPressed('attack')).toBe(true);

    // Held across the next update — no more press edge.
    controller.update(2);
    expect(controller.justPressed('attack')).toBe(false);
    expect(controller.isActionDown('attack')).toBe(true);
  });

  it('fires justReleased on the held → released transition for one frame only', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.H); // P1 shield
    controller.update(0);
    expect(controller.justReleased('shield')).toBe(false);

    keyboard.release(KEY_CODE.H);
    controller.update(1);
    expect(controller.justReleased('shield')).toBe(true);
    expect(controller.isActionDown('shield')).toBe(false);

    // Released across the next update — no more release edge.
    controller.update(2);
    expect(controller.justReleased('shield')).toBe(false);
  });

  it('does not fire justPressed on the very first update for an already-held key', () => {
    // A fighter spawned with shield held shouldn't fire a phantom press
    // on its first read — no previous-frame baseline exists.
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.H);
    controller.update(0);
    expect(controller.justPressed('shield')).toBe(false);
    expect(controller.isActionDown('shield')).toBe(true);
  });

  it('justPressed and isActionDown can both be true on the same frame', () => {
    const { controller, keyboard } = buildHarness();
    controller.update(0);
    keyboard.press(KEY_CODE.F);
    controller.update(1);
    expect(controller.justPressed('attack')).toBe(true);
    expect(controller.isActionDown('attack')).toBe(true);
    expect(controller.justReleased('attack')).toBe(false);
  });

  it('round-trips press → hold → release across multiple updates', () => {
    const { controller, keyboard } = buildHarness();
    controller.update(0); // baseline

    keyboard.press(KEY_CODE.G); // P1 special
    controller.update(1);
    expect(controller.justPressed('special')).toBe(true);

    controller.update(2); // held
    expect(controller.justPressed('special')).toBe(false);
    expect(controller.isActionDown('special')).toBe(true);

    keyboard.release(KEY_CODE.G);
    controller.update(3); // released
    expect(controller.justReleased('special')).toBe(true);
    expect(controller.isActionDown('special')).toBe(false);

    controller.update(4); // stable released
    expect(controller.justReleased('special')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mid-match rebind — proves no hardcoded mapping
// ---------------------------------------------------------------------------

describe('PlayerInputController — mid-match rebind', () => {
  it('reflects a rebinding committed mid-match on the very next update', () => {
    const { controller, keyboard, store } = buildHarness();
    // Player swaps jump from W (default) to SPACE.
    store.set(1, {
      ...store.get(1),
      bindings: {
        ...store.get(1).bindings,
        jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }],
      },
    });

    // Pressing the OLD binding does nothing now.
    keyboard.press(KEY_CODE.W);
    controller.update(0);
    // W is still bound to `up`, but jump was rebound off W.
    expect(controller.isActionDown('jump')).toBe(false);
    expect(controller.isActionDown('moveUp')).toBe(true);

    // Pressing the NEW binding fires jump.
    keyboard.press(KEY_CODE.SPACE);
    controller.update(1);
    expect(controller.justPressed('jump')).toBe(true);
    expect(controller.isActionDown('jump')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MoveVector
// ---------------------------------------------------------------------------

describe('PlayerInputController — getMoveVector', () => {
  it('returns the MOVE_NEUTRAL singleton at rest', () => {
    const { controller } = buildHarness();
    controller.update(0);
    expect(controller.getMoveVector()).toBe(MOVE_NEUTRAL);
  });

  it('produces digital -1 / 0 / +1 per axis from the directional flags', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.D); // right
    controller.update(0);
    expect(controller.getMoveVector()).toEqual({ x: 1, y: 0 });

    keyboard.release(KEY_CODE.D);
    keyboard.press(KEY_CODE.A); // left
    controller.update(1);
    expect(controller.getMoveVector()).toEqual({ x: -1, y: 0 });

    keyboard.release(KEY_CODE.A);
    keyboard.press(KEY_CODE.S); // down
    controller.update(2);
    expect(controller.getMoveVector()).toEqual({ x: 0, y: 1 });
  });

  it('cancels left + right held simultaneously to neutral X', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.A, KEY_CODE.D);
    controller.update(0);
    expect(controller.getMoveVector().x).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Dodge resolver
// ---------------------------------------------------------------------------

describe('PlayerInputController — dodge derivation', () => {
  it('default resolver: shield alone does not fire dodge', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.H); // P1 shield only
    controller.update(0);
    expect(controller.isActionDown('shield')).toBe(true);
    expect(controller.isActionDown('dodge')).toBe(false);
  });

  it('default resolver: shield + directional input fires dodge', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.H, KEY_CODE.D); // shield + right
    controller.update(0);
    expect(controller.isActionDown('dodge')).toBe(true);
  });

  it('default resolver: directional alone does not fire dodge', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.D); // right only
    controller.update(0);
    expect(controller.isActionDown('dodge')).toBe(false);
  });

  it('justPressed / justReleased work for the derived dodge action', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.H); // hold shield
    controller.update(0);
    expect(controller.justPressed('dodge')).toBe(false);

    keyboard.press(KEY_CODE.D); // tilt right while shielding → dodge
    controller.update(1);
    expect(controller.justPressed('dodge')).toBe(true);

    keyboard.release(KEY_CODE.D);
    controller.update(2);
    expect(controller.justReleased('dodge')).toBe(true);
  });

  it('honours a custom dodge resolver', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createIdleGamepad();
    const store = new InputBindingsStore();
    const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad, bindings: store });
    const manager = new InputBindingManager({ dispatcher });
    const controller = new PlayerInputController({
      manager,
      slot: 1,
      // Custom: dodge fires whenever attack is held.
      dodgeResolver: (ctx) => ctx.attack,
    });
    keyboard.press(KEY_CODE.F); // attack
    controller.update(0);
    expect(controller.isActionDown('dodge')).toBe(true);
    expect(controller.isActionDown('shield')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe('PlayerInputController — reset', () => {
  it('clears every cached state and resets the frame counter', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.F);
    controller.update(0);
    controller.update(1);
    expect(controller.isActionDown('attack')).toBe(true);

    controller.reset();
    expect(controller.isActionDown('attack')).toBe(false);
    expect(controller.justPressed('attack')).toBe(false);
    expect(controller.justReleased('attack')).toBe(false);
    expect(controller.getLastFrame()).toBe(-1);
  });

  it('does not fire phantom edges on the first update after reset', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.F);
    controller.update(0);
    controller.reset();

    // Key still held — but reset put the controller in pre-update mode.
    controller.update(1);
    // First update post-reset establishes the baseline; no edge yet.
    expect(controller.justPressed('attack')).toBe(false);
    expect(controller.isActionDown('attack')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// snapshotState
// ---------------------------------------------------------------------------

describe('PlayerInputController — snapshotState', () => {
  it('returns a frozen snapshot of the current held state', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.F, KEY_CODE.D);
    controller.update(0);
    const snap = controller.snapshotState();
    expect(snap.attack).toBe(true);
    expect(snap.moveRight).toBe(true);
    expect(snap.jump).toBe(false);
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it('two snapshots taken at different frames are independent', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.F);
    controller.update(0);
    const a = controller.snapshotState();

    keyboard.release(KEY_CODE.F);
    controller.update(1);
    const b = controller.snapshotState();

    expect(a.attack).toBe(true);
    expect(b.attack).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC compliance — no hardcoded key constants
// ---------------------------------------------------------------------------

describe('PlayerInputController — AC compliance', () => {
  it('does not reference KEY_CODE constants in its mapping path', () => {
    // The AC mandates the controller queries the InputBindingManager
    // every frame instead of referencing hardcoded key constants. This
    // is enforced structurally by the absence of `KEY_CODE` imports
    // and direct keyCode comparisons in PlayerInputController.ts.
    //
    // We assert here that the controller produces correct output even
    // when the binding store is mutated — a hardcoded-keyCode
    // implementation could not pass this without the rebind being
    // visible mid-session.
    const { controller, keyboard, store } = buildHarness();

    // Before rebind: F is the default attack binding.
    keyboard.press(KEY_CODE.F);
    controller.update(0);
    expect(controller.isActionDown('attack')).toBe(true);

    // Rebind attack to a different key entirely.
    keyboard.release(KEY_CODE.F);
    store.set(1, {
      ...store.get(1),
      bindings: {
        ...store.get(1).bindings,
        attack: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }],
      },
    });

    // Pressing the new binding fires the action via the manager.
    keyboard.press(KEY_CODE.SPACE);
    controller.update(1);
    expect(controller.isActionDown('attack')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildCharacterInputFromController — gameplay-side translator
// (AC 50202 Sub-AC 2)
// ---------------------------------------------------------------------------

describe('buildCharacterInputFromController — gameplay translator', () => {
  it('produces a neutral CharacterInput from a fresh, untouched controller', () => {
    const { controller } = buildHarness();
    controller.update(0);
    const input = buildCharacterInputFromController(controller);
    expect(input.moveX).toBe(0);
    expect(input.jump).toBe(false);
    expect(input.attack).toBe(false);
    expect(input.special).toBe(false);
    expect(input.grab).toBe(false);
    expect(input.shield).toBe(false);
    expect(input.dodge).toBe(false);
    expect(input.dropThrough).toBe(false);
  });

  it('routes movement through the controller for the moveX field', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.D); // P1 right
    controller.update(0);
    expect(buildCharacterInputFromController(controller).moveX).toBe(1);

    keyboard.release(KEY_CODE.D);
    keyboard.press(KEY_CODE.A); // P1 left
    controller.update(1);
    expect(buildCharacterInputFromController(controller).moveX).toBe(-1);
  });

  it('routes the jump button through the controller for the jump field', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.W); // P1 jump
    controller.update(0);
    expect(buildCharacterInputFromController(controller).jump).toBe(true);
  });

  it('routes the attack button through the controller for the attack field', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.F); // P1 attack
    controller.update(0);
    expect(buildCharacterInputFromController(controller).attack).toBe(true);
  });

  it('routes the special button through the controller for the special field', () => {
    // AC 50202 Sub-AC 2 — `special` is one of the eight action
    // categories the Seed names. The press surfaces verbatim through
    // the unified action-state API so the (later sub-AC) dedicated
    // special handler can branch on the unaliased press without
    // re-deriving it from raw key codes. The translator deliberately
    // does NOT alias `special` into the `attackHeavy` smash slot —
    // doing so would mis-fire the smash dispatch on a special press
    // for movesets that ship a smash but no neutral special.
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.G); // P1 special (default binding)
    controller.update(0);
    const input = buildCharacterInputFromController(controller);
    expect(input.special).toBe(true);
  });

  it('routes the shield button through the controller for the shield field', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.H); // P1 shield
    controller.update(0);
    expect(buildCharacterInputFromController(controller).shield).toBe(true);
  });

  it('routes the grab button through the controller for the grab field', () => {
    // AC 50202 Sub-AC 2 — grab is one of the eight action categories
    // the Seed names. Even though the Character runtime does not yet
    // consume `input.grab`, the binding-layer read must surface here
    // so the (later sub-AC) grab handler reads it without
    // re-deriving a press from raw key codes.
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.T); // P1 grab (default binding — see DEFAULT_KEYBOARD_P1_BINDINGS)
    controller.update(0);
    expect(buildCharacterInputFromController(controller).grab).toBe(true);
  });

  it('derives dodge through the dodge resolver chord (shield + directional)', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.H, KEY_CODE.D); // shield + right
    controller.update(0);
    expect(buildCharacterInputFromController(controller).dodge).toBe(true);
  });

  it('does not fire dodge when only shield is held (default resolver)', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.H); // shield only
    controller.update(0);
    expect(buildCharacterInputFromController(controller).dodge).toBe(false);
  });

  it('reports dropThrough when moveDown + jump are both held', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.S, KEY_CODE.W); // P1 down + jump
    controller.update(0);
    const input = buildCharacterInputFromController(controller);
    expect(input.dropThrough).toBe(true);
    expect(input.jump).toBe(true);
  });

  it('does not report dropThrough when only one of moveDown / jump is held', () => {
    const { controller, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.S); // down only
    controller.update(0);
    expect(buildCharacterInputFromController(controller).dropThrough).toBe(false);

    keyboard.release(KEY_CODE.S);
    keyboard.press(KEY_CODE.W); // jump only
    controller.update(1);
    expect(buildCharacterInputFromController(controller).dropThrough).toBe(false);
  });

  it('returns a frozen record so consumers can stash references safely', () => {
    const { controller } = buildHarness();
    controller.update(0);
    const input = buildCharacterInputFromController(controller);
    expect(Object.isFrozen(input)).toBe(true);
  });

  it('routes all eight action categories through the rebindable binding layer', () => {
    // AC 50202 Sub-AC 2 — the helper reads every action category
    // through PlayerInputController, which in turn queries the
    // InputBindingManager / DeviceInputDispatcher / BindingsStore.
    // A rebind committed to the store must be visible on the very
    // next update — verifying that here exercises the full chain
    // from binding profile → gameplay-shape CharacterInput record.
    const { controller, keyboard, store } = buildHarness();

    // Rebind every relevant action to a fresh, distinct key so we can
    // exercise the chain without colliding with the default WASD/F/G/H/T
    // table. Uses only the KEY_CODE constants the engine ships
    // (letters + numpad cluster + arrows + space) so the test does not
    // depend on undefined keyCodes — the InputBindingsStore validates
    // every value is a positive integer.
    store.set(1, {
      ...store.get(1),
      bindings: {
        ...store.get(1).bindings,
        left: [{ kind: 'keyboard', keyCode: KEY_CODE.ARROW_LEFT }],
        right: [{ kind: 'keyboard', keyCode: KEY_CODE.ARROW_RIGHT }],
        up: [{ kind: 'keyboard', keyCode: KEY_CODE.ARROW_UP }],
        down: [{ kind: 'keyboard', keyCode: KEY_CODE.ARROW_DOWN }],
        jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }],
        attack: [{ kind: 'keyboard', keyCode: KEY_CODE.NUMPAD_0 }],
        special: [{ kind: 'keyboard', keyCode: KEY_CODE.NUMPAD_1 }],
        shield: [{ kind: 'keyboard', keyCode: KEY_CODE.NUMPAD_3 }],
        grab: [{ kind: 'keyboard', keyCode: KEY_CODE.NUMPAD_5 }],
      },
    });

    keyboard.press(
      KEY_CODE.ARROW_RIGHT, // right
      KEY_CODE.SPACE, // jump
      KEY_CODE.NUMPAD_0, // attack
      KEY_CODE.NUMPAD_1, // special
      KEY_CODE.NUMPAD_3, // shield (also drives dodge with right held)
      KEY_CODE.NUMPAD_5, // grab
    );
    controller.update(0);
    const input = buildCharacterInputFromController(controller);
    expect(input.moveX).toBe(1);
    expect(input.jump).toBe(true);
    expect(input.attack).toBe(true);
    expect(input.special).toBe(true);
    expect(input.shield).toBe(true);
    expect(input.grab).toBe(true);
    // Shield + right deflection past threshold → dodge fires through
    // the default resolver chord — the eighth action category.
    expect(input.dodge).toBe(true);
  });
});
