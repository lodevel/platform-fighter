import { describe, it, expect } from 'vitest';
import {
  DeviceInputDispatcher,
  type GamepadButtonState,
  type GamepadSource,
} from './DeviceInputDispatcher';
import { InputBindingsStore } from './InputBindingsStore';
import { KEY_CODE } from './keyCodes';
import type { KeyboardSource } from './LocalInputHandler';
import { InputResolver } from './InputResolver';
import {
  MENU_ACTIONS,
  MENU_ACTION_TO_RESOLVER,
  MenuInputAdapter,
} from './MenuInputAdapter';
import type { PlayerBindingsIndex } from '../types/inputBindings';

/**
 * AC 50203 Sub-AC 3 — MenuInputAdapter.
 *
 * Locks down:
 *
 *   1. The adapter exposes the canonical menu vocabulary
 *      (`navigateLeft / navigateRight / navigateUp / navigateDown /
 *      confirm / cancel`).
 *   2. `wasTriggered(player, action)` returns rising-edge semantics —
 *      true on the press frame only, false on hold and on release.
 *   3. `confirm` fires for either `attack` OR `jump`; `cancel` fires
 *      for either `shield` OR `special`.
 *   4. `wasTriggeredByAnyPlayer` folds across the tracked slots in
 *      the configured order.
 *   5. Untracked slots return `false` for every query.
 *   6. Mid-session rebind: rebinding the store flips which physical
 *      key triggers a menu action on the very next resolver `update()`.
 *   7. The constructor rejects null/undefined resolver inputs cleanly.
 *   8. The adapter never references hardcoded KEY_CODE constants in
 *      its mapping path — every read flows through the resolver.
 */

// ---------------------------------------------------------------------------
// Mocks (mirror InputResolver.test.ts)
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

interface Harness {
  resolver: InputResolver;
  dispatcher: DeviceInputDispatcher;
  store: InputBindingsStore;
  keyboard: MockKeyboard;
  adapter: MenuInputAdapter;
}

function buildHarness(slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2]): Harness {
  const keyboard = createMockKeyboard();
  const gamepad = createIdleGamepad();
  const store = new InputBindingsStore();
  const dispatcher = new DeviceInputDispatcher({
    keyboard,
    gamepad,
    bindings: store,
  });
  const resolver = new InputResolver({ dispatcher, slots });
  const adapter = new MenuInputAdapter({ resolver });
  return { resolver, dispatcher, store, keyboard, adapter };
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

describe('MenuInputAdapter — canonical menu vocabulary', () => {
  it('exposes the six canonical menu actions in declaration order', () => {
    expect(MENU_ACTIONS).toEqual([
      'navigateLeft',
      'navigateRight',
      'navigateUp',
      'navigateDown',
      'confirm',
      'cancel',
    ]);
  });

  it('maps each menu action to canonical resolver action(s)', () => {
    expect(MENU_ACTION_TO_RESOLVER.navigateLeft).toEqual(['moveLeft']);
    expect(MENU_ACTION_TO_RESOLVER.navigateRight).toEqual(['moveRight']);
    expect(MENU_ACTION_TO_RESOLVER.navigateUp).toEqual(['moveUp']);
    expect(MENU_ACTION_TO_RESOLVER.navigateDown).toEqual(['moveDown']);
    expect(MENU_ACTION_TO_RESOLVER.confirm).toEqual(['attack', 'jump']);
    expect(MENU_ACTION_TO_RESOLVER.cancel).toEqual(['shield', 'special']);
  });

  it('mapping table is frozen so callers cannot mutate it', () => {
    expect(Object.isFrozen(MENU_ACTION_TO_RESOLVER)).toBe(true);
    expect(Object.isFrozen(MENU_ACTION_TO_RESOLVER.confirm)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('MenuInputAdapter — construction', () => {
  it('rejects null resolver', () => {
    expect(
      () =>
        new MenuInputAdapter({
          resolver: null as never,
        }),
    ).toThrowError(/resolver is required/);
  });

  it('defaults tracked slots to the resolver tracked slots', () => {
    const { adapter } = buildHarness([1, 2, 3]);
    expect(adapter.getTrackedSlots()).toEqual([1, 2, 3]);
  });

  it('honours an explicit slots override', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createIdleGamepad();
    const store = new InputBindingsStore();
    const dispatcher = new DeviceInputDispatcher({
      keyboard,
      gamepad,
      bindings: store,
    });
    const resolver = new InputResolver({ dispatcher, slots: [1, 2, 3, 4] });
    const adapter = new MenuInputAdapter({ resolver, slots: [1] });
    expect(adapter.getTrackedSlots()).toEqual([1]);
  });

  it('exposes the wrapped resolver via getResolver', () => {
    const { adapter, resolver } = buildHarness([1]);
    expect(adapter.getResolver()).toBe(resolver);
  });
});

// ---------------------------------------------------------------------------
// Per-player rising-edge semantics
// ---------------------------------------------------------------------------

describe('MenuInputAdapter — per-player rising-edge', () => {
  it('navigateLeft fires once on the first update where moveLeft becomes held', () => {
    const { adapter, resolver, keyboard } = buildHarness([1]);

    // Baseline: an update with nothing held establishes the prev-frame.
    resolver.update();
    expect(adapter.wasTriggered(1, 'navigateLeft')).toBe(false);

    // Press P1 default keyboard left (A).
    keyboard.press(KEY_CODE.A);
    resolver.update();
    expect(adapter.wasTriggered(1, 'navigateLeft')).toBe(true);
    expect(adapter.isHeld(1, 'navigateLeft')).toBe(true);

    // Hold for another frame — `wasTriggered` is rising-edge only, so
    // it returns false even though the action is still held.
    resolver.update();
    expect(adapter.wasTriggered(1, 'navigateLeft')).toBe(false);
    expect(adapter.isHeld(1, 'navigateLeft')).toBe(true);
  });

  it('confirm fires on attack press', () => {
    const { adapter, resolver, keyboard } = buildHarness([1]);
    resolver.update();
    // P1 default attack is F.
    keyboard.press(KEY_CODE.F);
    resolver.update();
    expect(adapter.wasTriggered(1, 'confirm')).toBe(true);
  });

  it('confirm fires on jump press too (not just attack)', () => {
    const { adapter, resolver, keyboard } = buildHarness([1]);
    resolver.update();
    // P1 default jump is W.
    keyboard.press(KEY_CODE.W);
    resolver.update();
    expect(adapter.wasTriggered(1, 'confirm')).toBe(true);
  });

  it('cancel fires on shield press', () => {
    const { adapter, resolver, keyboard } = buildHarness([1]);
    resolver.update();
    // P1 default shield is H.
    keyboard.press(KEY_CODE.H);
    resolver.update();
    expect(adapter.wasTriggered(1, 'cancel')).toBe(true);
  });

  it('cancel fires on special press too (not just shield)', () => {
    const { adapter, resolver, keyboard } = buildHarness([1]);
    resolver.update();
    // P1 default special is G.
    keyboard.press(KEY_CODE.G);
    resolver.update();
    expect(adapter.wasTriggered(1, 'cancel')).toBe(true);
  });

  it('confirm does NOT fire on hold (edge-only)', () => {
    const { adapter, resolver, keyboard } = buildHarness([1]);
    resolver.update();
    keyboard.press(KEY_CODE.F);
    resolver.update();
    expect(adapter.wasTriggered(1, 'confirm')).toBe(true);
    resolver.update();
    expect(adapter.wasTriggered(1, 'confirm')).toBe(false);
    expect(adapter.isHeld(1, 'confirm')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Any-player fold
// ---------------------------------------------------------------------------

describe('MenuInputAdapter — any-player fold', () => {
  it('wasTriggeredByAnyPlayer returns true when any tracked slot triggered the action', () => {
    const { adapter, resolver, keyboard } = buildHarness([1, 2]);
    resolver.update();
    // P2 attack is NUMPAD_1 in default profile.
    keyboard.press(KEY_CODE.NUMPAD_1);
    resolver.update();
    expect(adapter.wasTriggeredByAnyPlayer('confirm')).toBe(true);
    // Per-player attribution: only P2 triggered.
    expect(adapter.wasTriggered(1, 'confirm')).toBe(false);
    expect(adapter.wasTriggered(2, 'confirm')).toBe(true);
  });

  it('firstSlotThatTriggered returns the first tracked slot in iteration order', () => {
    const { adapter, resolver, keyboard } = buildHarness([1, 2]);
    resolver.update();
    // P1 attack (F) AND P2 attack (NUMPAD_1) both pressed in same frame.
    keyboard.press(KEY_CODE.F, KEY_CODE.NUMPAD_1);
    resolver.update();
    expect(adapter.firstSlotThatTriggered('confirm')).toBe(1);
  });

  it('firstSlotThatTriggered returns null if no slot triggered', () => {
    const { adapter, resolver } = buildHarness([1, 2]);
    resolver.update();
    resolver.update();
    expect(adapter.firstSlotThatTriggered('confirm')).toBeNull();
  });

  it('wasTriggeredByAnyPlayer returns false when nothing pressed', () => {
    const { adapter, resolver } = buildHarness([1, 2]);
    resolver.update();
    resolver.update();
    expect(adapter.wasTriggeredByAnyPlayer('confirm')).toBe(false);
    expect(adapter.wasTriggeredByAnyPlayer('cancel')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Untracked slots
// ---------------------------------------------------------------------------

describe('MenuInputAdapter — untracked slots', () => {
  it('reads of an untracked slot return false / not held', () => {
    const { adapter } = buildHarness([1]);
    // Slot 4 is not tracked.
    expect(adapter.wasTriggered(4, 'confirm')).toBe(false);
    expect(adapter.isHeld(4, 'confirm')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Navigate vector
// ---------------------------------------------------------------------------

describe('MenuInputAdapter — navigate vector', () => {
  it('reflects rising-edge directional state', () => {
    const { adapter, resolver, keyboard } = buildHarness([1]);
    resolver.update();
    expect(adapter.getNavigateVector(1)).toEqual({ x: 0, y: 0 });

    keyboard.press(KEY_CODE.D); // P1 right
    resolver.update();
    expect(adapter.getNavigateVector(1)).toEqual({ x: 1, y: 0 });

    // Hold — edges drop, vector zeroes again.
    resolver.update();
    expect(adapter.getNavigateVector(1)).toEqual({ x: 0, y: 0 });
  });

  it('reads digital up/down on rising edge', () => {
    const { adapter, resolver, keyboard } = buildHarness([1]);
    resolver.update();
    keyboard.press(KEY_CODE.S); // P1 down
    resolver.update();
    expect(adapter.getNavigateVector(1)).toEqual({ x: 0, y: 1 });
  });

  it('returns frozen vectors', () => {
    const { adapter, resolver, keyboard } = buildHarness([1]);
    resolver.update();
    keyboard.press(KEY_CODE.A);
    resolver.update();
    expect(Object.isFrozen(adapter.getNavigateVector(1))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mid-session rebind reflection
// ---------------------------------------------------------------------------

describe('MenuInputAdapter — mid-session rebind', () => {
  it('a rebind committed mid-session is reflected on the next update', () => {
    const { adapter, resolver, store, keyboard } = buildHarness([1]);
    resolver.update();
    // Default attack: F.
    keyboard.press(KEY_CODE.F);
    resolver.update();
    expect(adapter.wasTriggered(1, 'confirm')).toBe(true);

    // Release everything and re-baseline so the next presses produce
    // proper rising edges.
    keyboard.releaseAll();
    resolver.update();

    // Mutate P1's attack binding from F (70) to a custom code (75 = K).
    store.setAction(1, 'attack', [{ kind: 'keyboard', keyCode: 75 }]);

    // The old key (F) is no longer attack — pressing it should NOT
    // fire confirm (and jump is still W, not F, so neither path is hit).
    keyboard.press(KEY_CODE.F);
    resolver.update();
    expect(adapter.wasTriggered(1, 'confirm')).toBe(false);
    keyboard.releaseAll();
    resolver.update();

    // The new key (K = 75) IS attack — pressing it fires confirm.
    keyboard.press(75);
    resolver.update();
    expect(adapter.wasTriggered(1, 'confirm')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// No KEY_CODE in the mapping path
// ---------------------------------------------------------------------------

describe('MenuInputAdapter — no hardcoded device lookups', () => {
  it('the adapter module references zero KEY_CODE constants', async () => {
    // Read the module source — the adapter must be a pure shape
    // translator over the resolver. Any KEY_CODE / device-specific
    // constant in its mapping path would mean a rebind of `attack` →
    // `K` would NOT carry over to menu confirm, breaking the AC.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, './MenuInputAdapter.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/KEY_CODE/);
    // No `getGamepads()`, no Phaser scene API, no localStorage.
    expect(src).not.toMatch(/navigator\.getGamepads/);
    // No imports from 'phaser' — the adapter is Phaser-free.
    expect(src).not.toMatch(/from\s+['"]phaser['"]/);
  });
});
