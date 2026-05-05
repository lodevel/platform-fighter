import { describe, it, expect } from 'vitest';
import {
  DeviceInputDispatcher,
  type GamepadButtonState,
  type GamepadSource,
} from './DeviceInputDispatcher';
import { InputBindingsStore } from './InputBindingsStore';
import { KEY_CODE } from './keyCodes';
import type { KeyboardSource } from './LocalInputHandler';
import {
  ACTION_NAMES,
  ALL_PLAYER_INDICES,
  InputResolver,
  NEUTRAL_ACTION_STATE,
  PlayerActionMap,
  buildCharacterInputFromResolver,
  type ActionName,
} from './InputResolver';
import { MOVE_NEUTRAL } from './InputService';
import type { PlayerBindingsIndex } from '../types/inputBindings';

/**
 * AC 50201 Sub-AC 1 — central InputResolver / ActionMap.
 *
 * Locks down:
 *
 *   1. The module file and the surrounding suite reference zero
 *      hardcoded `KEY_CODE` constants in the resolver's mapping path —
 *      every device read flows through the dispatcher and the active
 *      binding profile.
 *   2. `getAction(playerIndex, actionName)` returns a frozen
 *      {@link ActionState} carrying `held / justPressed / justReleased`
 *      for every player + action; results before the first `update()`
 *      are the {@link NEUTRAL_ACTION_STATE} singleton; reading an
 *      untracked slot also returns the singleton.
 *   3. Edges (`justPressed` / `justReleased`) fire on the rising / falling
 *      transitions for one `update()` only and don't fire on the very
 *      first update (no phantom press from the initial all-released
 *      previous-frame baseline).
 *   4. The full canonical seed action vocabulary is supported:
 *      `move{Left,Right,Up,Down}`, `jump`, `attack`, `special`,
 *      `shield`, `grab`, `dodge` — and `dodge` is derived through the
 *      configured resolver (default: shield + directional chord).
 *   5. Mid-match rebind: rebinding the store after construction is
 *      reflected on the very next `update()` — `justPressed` fires for
 *      the new binding, `justReleased` fires for the old one.
 *   6. `getMoveVector(player)` reuses the {@link MOVE_NEUTRAL} singleton
 *      at neutral and reflects the dispatcher's analog axes at non-neutral.
 *   7. `reset()` clears every cached snapshot so the next two updates
 *      re-establish a fresh edge baseline.
 *   8. The {@link PlayerActionMap} alias points at the same class.
 *   9. The constructor rejects null/undefined dispatcher inputs cleanly.
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
  return { resolver, dispatcher, store, keyboard };
}

// ---------------------------------------------------------------------------
// Construction + read shape
// ---------------------------------------------------------------------------

describe('InputResolver — construction', () => {
  it('reports the neutral action state for every action before the first update', () => {
    const { resolver } = buildHarness();
    for (const action of ACTION_NAMES) {
      const state = resolver.getAction(1, action);
      expect(state).toBe(NEUTRAL_ACTION_STATE);
      expect(state.held).toBe(false);
      expect(state.justPressed).toBe(false);
      expect(state.justReleased).toBe(false);
    }
  });

  it('returns NEUTRAL_ACTION_STATE for slots that are not tracked', () => {
    const { resolver } = buildHarness([1]);
    expect(resolver.getAction(2, 'jump')).toBe(NEUTRAL_ACTION_STATE);
    expect(resolver.getAction(3, 'shield')).toBe(NEUTRAL_ACTION_STATE);
    expect(resolver.getAction(4, 'attack')).toBe(NEUTRAL_ACTION_STATE);
  });

  it('isActionHeld / wasJustPressed / wasJustReleased return false for untracked slots', () => {
    const { resolver } = buildHarness([1]);
    expect(resolver.isActionHeld(2, 'jump')).toBe(false);
    expect(resolver.wasJustPressed(2, 'jump')).toBe(false);
    expect(resolver.wasJustReleased(2, 'jump')).toBe(false);
  });

  it('exposes the tracked slots and last frame', () => {
    const { resolver } = buildHarness([1, 2]);
    expect(resolver.getTrackedSlots()).toEqual([1, 2]);
    expect(resolver.getLastFrame()).toBe(-1);
  });

  it('defaults to tracking all four slots when slots option is omitted', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createIdleGamepad();
    const store = new InputBindingsStore();
    const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad, bindings: store });
    const resolver = new InputResolver({ dispatcher });
    expect(resolver.getTrackedSlots()).toEqual([...ALL_PLAYER_INDICES]);
  });

  it('throws on null/undefined dispatcher', () => {
    expect(() => new InputResolver({ dispatcher: null as never })).toThrow(/dispatcher/);
    expect(() => new InputResolver({ dispatcher: undefined as never })).toThrow(/dispatcher/);
  });

  it('returns the dispatcher it was constructed against', () => {
    const { resolver, dispatcher } = buildHarness();
    expect(resolver.getDispatcher()).toBe(dispatcher);
  });
});

// ---------------------------------------------------------------------------
// getAction — held / press / release semantics
// ---------------------------------------------------------------------------

describe('InputResolver.getAction — held bit reflects most recent update', () => {
  it('reports held=true after the first update samples a held key (no phantom edges)', () => {
    const { resolver, keyboard } = buildHarness([1]);
    keyboard.press(KEY_CODE.W); // P1 default jump (also P1 up)
    resolver.update(0);
    const state = resolver.getAction(1, 'jump');
    // First update establishes the previous baseline — the action is
    // held but no phantom rising edge fires.
    expect(state.held).toBe(true);
    expect(state.justPressed).toBe(false);
    expect(state.justReleased).toBe(false);
  });

  it('justPressed fires once on rising edge after the baseline update', () => {
    const { resolver, keyboard } = buildHarness([1]);
    // First update — nothing held, baseline established.
    resolver.update(0);
    expect(resolver.getAction(1, 'jump')).toBe(NEUTRAL_ACTION_STATE);

    keyboard.press(KEY_CODE.W);
    resolver.update(1);
    const pressed = resolver.getAction(1, 'jump');
    expect(pressed.held).toBe(true);
    expect(pressed.justPressed).toBe(true);
    expect(pressed.justReleased).toBe(false);

    // Held next frame — no edge.
    resolver.update(2);
    const stillHeld = resolver.getAction(1, 'jump');
    expect(stillHeld.held).toBe(true);
    expect(stillHeld.justPressed).toBe(false);
    expect(stillHeld.justReleased).toBe(false);
  });

  it('justReleased fires once on falling edge', () => {
    const { resolver, keyboard } = buildHarness([1]);
    resolver.update(0);
    keyboard.press(KEY_CODE.W);
    resolver.update(1);
    keyboard.release(KEY_CODE.W);
    resolver.update(2);
    const released = resolver.getAction(1, 'jump');
    expect(released.held).toBe(false);
    expect(released.justPressed).toBe(false);
    expect(released.justReleased).toBe(true);

    // Subsequent frame — no lingering edge.
    resolver.update(3);
    expect(resolver.getAction(1, 'jump')).toBe(NEUTRAL_ACTION_STATE);
  });

  it('returns frozen records', () => {
    const { resolver, keyboard } = buildHarness([1]);
    keyboard.press(KEY_CODE.W);
    resolver.update(0);
    keyboard.release(KEY_CODE.W);
    keyboard.press(KEY_CODE.A); // P1 default left
    resolver.update(1);
    const state = resolver.getAction(1, 'jump');
    // jumped held → released — should be a fresh frozen record.
    expect(Object.isFrozen(state)).toBe(true);
  });

  it('isActionHeld matches getAction(...).held', () => {
    const { resolver, keyboard } = buildHarness([1]);
    resolver.update(0);
    keyboard.press(KEY_CODE.W);
    resolver.update(1);
    expect(resolver.isActionHeld(1, 'jump')).toBe(true);
    expect(resolver.isActionHeld(1, 'jump')).toBe(resolver.getAction(1, 'jump').held);
  });

  it('wasJustPressed / wasJustReleased match getAction edges', () => {
    const { resolver, keyboard } = buildHarness([1]);
    resolver.update(0);
    keyboard.press(KEY_CODE.W);
    resolver.update(1);
    expect(resolver.wasJustPressed(1, 'jump')).toBe(true);
    expect(resolver.wasJustReleased(1, 'jump')).toBe(false);
    keyboard.release(KEY_CODE.W);
    resolver.update(2);
    expect(resolver.wasJustPressed(1, 'jump')).toBe(false);
    expect(resolver.wasJustReleased(1, 'jump')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multi-player: getAction is per-slot
// ---------------------------------------------------------------------------

describe('InputResolver.getAction — multi-player isolation', () => {
  it('reads per-slot state independently — P1 attack vs P2 attack', () => {
    const { resolver, keyboard } = buildHarness([1, 2]);
    resolver.update(0);
    keyboard.press(KEY_CODE.F); // P1 default attack
    resolver.update(1);
    expect(resolver.getAction(1, 'attack').held).toBe(true);
    expect(resolver.getAction(1, 'attack').justPressed).toBe(true);
    // P2 default attack is NUMPAD_1 — still released.
    expect(resolver.getAction(2, 'attack').held).toBe(false);

    keyboard.press(KEY_CODE.NUMPAD_1); // P2 default attack
    resolver.update(2);
    expect(resolver.getAction(2, 'attack').held).toBe(true);
    expect(resolver.getAction(2, 'attack').justPressed).toBe(true);
    // P1 still holding, no new edge.
    expect(resolver.getAction(1, 'attack').justPressed).toBe(false);
    expect(resolver.getAction(1, 'attack').held).toBe(true);
  });

  it('iterates slots in the order supplied to the constructor', () => {
    const { resolver } = buildHarness([4, 1, 2]);
    expect(resolver.getTrackedSlots()).toEqual([4, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Action vocabulary coverage
// ---------------------------------------------------------------------------

describe('InputResolver.getAction — full canonical action vocabulary', () => {
  it('exposes every Seed action by name (move{Left,Right,Up,Down}, jump, attack, special, shield, grab, dodge)', () => {
    const expected: ActionName[] = [
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
    ];
    expect([...ACTION_NAMES]).toEqual(expected);
    const { resolver } = buildHarness([1]);
    for (const action of expected) {
      expect(resolver.getAction(1, action)).toBe(NEUTRAL_ACTION_STATE);
    }
  });

  it('moveLeft and moveRight track the dispatcher half-axis bindings', () => {
    const { resolver, keyboard } = buildHarness([1]);
    resolver.update(0);
    keyboard.press(KEY_CODE.A); // P1 default left
    resolver.update(1);
    expect(resolver.getAction(1, 'moveLeft').held).toBe(true);
    expect(resolver.getAction(1, 'moveLeft').justPressed).toBe(true);
    expect(resolver.getAction(1, 'moveRight').held).toBe(false);

    keyboard.release(KEY_CODE.A);
    keyboard.press(KEY_CODE.D); // P1 default right
    resolver.update(2);
    expect(resolver.getAction(1, 'moveLeft').held).toBe(false);
    expect(resolver.getAction(1, 'moveLeft').justReleased).toBe(true);
    expect(resolver.getAction(1, 'moveRight').held).toBe(true);
    expect(resolver.getAction(1, 'moveRight').justPressed).toBe(true);
  });

  it('shield + directional → dodge fires through the default resolver', () => {
    const { resolver, keyboard, store } = buildHarness([1]);
    // P1 default shield code:
    const shieldKey = (store.get(1).bindings.shield[0] as { keyCode: number }).keyCode;
    resolver.update(0);

    // Shield alone — no dodge.
    keyboard.press(shieldKey);
    resolver.update(1);
    expect(resolver.getAction(1, 'shield').held).toBe(true);
    expect(resolver.getAction(1, 'dodge').held).toBe(false);

    // Shield + directional → dodge.
    keyboard.press(KEY_CODE.A);
    resolver.update(2);
    expect(resolver.getAction(1, 'dodge').held).toBe(true);
    expect(resolver.getAction(1, 'dodge').justPressed).toBe(true);

    // Drop directional — dodge falls.
    keyboard.release(KEY_CODE.A);
    resolver.update(3);
    expect(resolver.getAction(1, 'dodge').held).toBe(false);
    expect(resolver.getAction(1, 'dodge').justReleased).toBe(true);
  });

  it('honours a custom dodge resolver override', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createIdleGamepad();
    const store = new InputBindingsStore();
    const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad, bindings: store });
    const resolver = new InputResolver({
      dispatcher,
      slots: [1],
      dodgeResolver: () => true, // Always-on dodge
    });
    resolver.update(0);
    expect(resolver.getAction(1, 'dodge').held).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getMoveVector
// ---------------------------------------------------------------------------

describe('InputResolver.getMoveVector', () => {
  it('returns MOVE_NEUTRAL singleton at rest and before first update', () => {
    const { resolver } = buildHarness([1]);
    expect(resolver.getMoveVector(1)).toBe(MOVE_NEUTRAL);
    resolver.update(0);
    expect(resolver.getMoveVector(1)).toBe(MOVE_NEUTRAL);
  });

  it('returns MOVE_NEUTRAL for untracked slots', () => {
    const { resolver } = buildHarness([1]);
    expect(resolver.getMoveVector(2)).toBe(MOVE_NEUTRAL);
  });

  it('returns digital -1 / +1 for keyboard left/right', () => {
    const { resolver, keyboard } = buildHarness([1]);
    keyboard.press(KEY_CODE.A);
    resolver.update(0);
    const left = resolver.getMoveVector(1);
    expect(left.x).toBe(-1);
    expect(left.y).toBe(0);

    keyboard.release(KEY_CODE.A);
    keyboard.press(KEY_CODE.D);
    resolver.update(1);
    const right = resolver.getMoveVector(1);
    expect(right.x).toBe(1);
    expect(right.y).toBe(0);
  });

  it('returns digital +1 on Y for keyboard down', () => {
    const { resolver, keyboard } = buildHarness([1]);
    keyboard.press(KEY_CODE.S); // P1 default down
    resolver.update(0);
    const v = resolver.getMoveVector(1);
    expect(v.y).toBe(1); // canvas Y: down is positive
  });
});

// ---------------------------------------------------------------------------
// Mid-match rebind reflection
// ---------------------------------------------------------------------------

describe('InputResolver — mid-match rebind reflection', () => {
  it('reflects bindings store mutation on the very next update', () => {
    const { resolver, keyboard, store } = buildHarness([1]);
    // Establish baseline — no keys held.
    resolver.update(0);

    // Hold a key that is NOT yet bound to attack on P1.
    keyboard.press(75 /* 'K' */);
    resolver.update(1);
    expect(resolver.getAction(1, 'attack').held).toBe(false);

    // Rebind P1 attack to that key. The next update should pick it up
    // — justPressed fires for the new binding.
    store.setAction(1, 'attack', [{ kind: 'keyboard', keyCode: 75 /* 'K' */ }]);
    resolver.update(2);
    expect(resolver.getAction(1, 'attack').held).toBe(true);
    expect(resolver.getAction(1, 'attack').justPressed).toBe(true);

    // Drop the rebound key; justReleased fires.
    keyboard.release(75 /* 'K' */);
    resolver.update(3);
    expect(resolver.getAction(1, 'attack').held).toBe(false);
    expect(resolver.getAction(1, 'attack').justReleased).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reset semantics
// ---------------------------------------------------------------------------

describe('InputResolver.reset', () => {
  it('clears every cached action and re-establishes a fresh baseline on next update', () => {
    const { resolver, keyboard } = buildHarness([1]);
    keyboard.press(KEY_CODE.W);
    resolver.update(0);
    keyboard.press(KEY_CODE.A);
    resolver.update(1);
    expect(resolver.getAction(1, 'jump').held).toBe(true);
    expect(resolver.getAction(1, 'moveLeft').held).toBe(true);

    resolver.reset();
    // After reset, every read returns the neutral singleton until the
    // next update — the dispatch state is not yet refreshed.
    for (const action of ACTION_NAMES) {
      expect(resolver.getAction(1, action)).toBe(NEUTRAL_ACTION_STATE);
    }
    expect(resolver.getMoveVector(1)).toBe(MOVE_NEUTRAL);
    expect(resolver.getLastFrame()).toBe(-1);

    // Next update establishes a fresh baseline — no phantom edges
    // even though the keys are still physically held.
    resolver.update(10);
    expect(resolver.getAction(1, 'jump').held).toBe(true);
    expect(resolver.getAction(1, 'jump').justPressed).toBe(false);
    expect(resolver.getAction(1, 'moveLeft').held).toBe(true);
    expect(resolver.getAction(1, 'moveLeft').justPressed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// snapshotSlot & lastFrame
// ---------------------------------------------------------------------------

describe('InputResolver.snapshotSlot', () => {
  it('returns a frozen snapshot of one slot — neutral before first update', () => {
    const { resolver } = buildHarness([1]);
    const snap = resolver.snapshotSlot(1);
    expect(Object.isFrozen(snap)).toBe(true);
    for (const action of ACTION_NAMES) {
      expect(snap[action]).toBe(false);
    }
  });

  it('returns a neutral record for untracked slots', () => {
    const { resolver } = buildHarness([1]);
    const snap = resolver.snapshotSlot(3);
    for (const action of ACTION_NAMES) {
      expect(snap[action]).toBe(false);
    }
  });

  it('reflects the current sample after update', () => {
    const { resolver, keyboard } = buildHarness([1]);
    keyboard.press(KEY_CODE.W); // P1 default jump (and moveUp)
    resolver.update(0);
    const snap = resolver.snapshotSlot(1);
    expect(snap.jump).toBe(true);
    expect(snap.moveUp).toBe(true);
    expect(snap.attack).toBe(false);
  });
});

describe('InputResolver.getLastFrame', () => {
  it('records the most recent frame argument', () => {
    const { resolver } = buildHarness([1]);
    expect(resolver.getLastFrame()).toBe(-1);
    resolver.update(7);
    expect(resolver.getLastFrame()).toBe(7);
    resolver.update(42);
    expect(resolver.getLastFrame()).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// PlayerActionMap alias
// ---------------------------------------------------------------------------

describe('PlayerActionMap alias', () => {
  it('is the same class as InputResolver', () => {
    expect(PlayerActionMap).toBe(InputResolver);
  });

  it('instantiated via the alias still exposes getAction', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createIdleGamepad();
    const store = new InputBindingsStore();
    const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad, bindings: store });
    const map = new PlayerActionMap({ dispatcher, slots: [1] });
    expect(typeof map.getAction).toBe('function');
    expect(map.getAction(1, 'jump')).toBe(NEUTRAL_ACTION_STATE);
  });
});

// ---------------------------------------------------------------------------
// Single source of truth: no hardcoded device polling in the resolver
// ---------------------------------------------------------------------------

describe('InputResolver — single source of truth', () => {
  it('two getAction reads on the same frame return identical records', () => {
    const { resolver, keyboard } = buildHarness([1]);
    resolver.update(0);
    keyboard.press(KEY_CODE.W);
    resolver.update(1);
    const a = resolver.getAction(1, 'jump');
    const b = resolver.getAction(1, 'jump');
    expect(a).toEqual(b);
    expect(a.held).toBe(b.held);
    expect(a.justPressed).toBe(b.justPressed);
    expect(a.justReleased).toBe(b.justReleased);
  });

  it('the resolver source file references no KEY_CODE constants in its mapping path', async () => {
    // Defensive smoke check: the resolver should rely on the dispatcher
    // for all device translation. Any future regression that pulls in
    // KEY_CODE.X to special-case a key will fail this assertion.
    const fs = await import('node:fs/promises');
    const path = new URL('./InputResolver.ts', import.meta.url);
    const source = await fs.readFile(path, 'utf8');
    expect(source.includes('KEY_CODE.')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC 50202 Sub-AC 2 — buildCharacterInputFromResolver
//
// Locks the gameplay-side translator that turns the central resolver's
// per-player action snapshot into the {@link CharacterInput} record
// `Character.applyInput` consumes. Every gameplay input consumer
// (player controller, move/attack handlers, movement) reads through
// this helper rather than touching raw key codes / gamepad buttons.
// ---------------------------------------------------------------------------

describe('buildCharacterInputFromResolver', () => {
  it('returns an all-released frozen record before the first update', () => {
    const { resolver } = buildHarness([1]);
    const input = buildCharacterInputFromResolver(resolver, 1);
    expect(Object.isFrozen(input)).toBe(true);
    expect(input.moveX).toBe(0);
    expect(input.jump).toBe(false);
    expect(input.attack).toBe(false);
    expect(input.special).toBe(false);
    expect(input.shield).toBe(false);
    expect(input.grab).toBe(false);
    expect(input.dodge).toBe(false);
    expect(input.dropThrough).toBe(false);
  });

  it('returns a neutral record for an untracked slot', () => {
    const { resolver } = buildHarness([1]);
    const input = buildCharacterInputFromResolver(resolver, 3);
    expect(input.moveX).toBe(0);
    expect(input.jump).toBe(false);
    expect(input.attack).toBe(false);
    expect(input.shield).toBe(false);
  });

  it('reflects every Seed action category through the resolver', () => {
    const { resolver, keyboard, store } = buildHarness([1]);
    // Resolve P1 default keys for each action so we don't hardcode any
    // KEY_CODE constants inside the gameplay path under test.
    const profile = store.get(1).bindings;
    const jumpKey = (profile.jump[0] as { keyCode: number }).keyCode;
    const attackKey = (profile.attack[0] as { keyCode: number }).keyCode;
    const specialKey = (profile.special[0] as { keyCode: number }).keyCode;
    const shieldKey = (profile.shield[0] as { keyCode: number }).keyCode;
    const grabKey = (profile.grab[0] as { keyCode: number }).keyCode;
    const rightKey = (profile.right[0] as { keyCode: number }).keyCode;

    keyboard.press(jumpKey, attackKey, specialKey, shieldKey, grabKey, rightKey);
    resolver.update(0);

    const input = buildCharacterInputFromResolver(resolver, 1);
    expect(input.moveX).toBe(1);
    expect(input.jump).toBe(true);
    expect(input.attack).toBe(true);
    expect(input.special).toBe(true);
    expect(input.shield).toBe(true);
    expect(input.grab).toBe(true);
    // Shield + directional → derived dodge action fires.
    expect(input.dodge).toBe(true);
  });

  it('produces dropThrough = true on a rapid double-tap of the down action', () => {
    // The drop-through gesture is now a double-tap of `down` within
    // ~12 frames — replaces the prior `down + jump` chord that
    // clobbered ordinary fast-falls. A held-down (no rising edge)
    // never fires, so a player crouching can't accidentally drop.
    const { resolver, keyboard, store } = buildHarness([1]);
    const profile = store.get(1).bindings;
    const downKey = (profile.down[0] as { keyCode: number }).keyCode;

    // Tap 1
    keyboard.press(downKey);
    resolver.update(0);
    expect(buildCharacterInputFromResolver(resolver, 1).dropThrough).toBe(false);
    keyboard.release(downKey);
    resolver.update(1);
    expect(buildCharacterInputFromResolver(resolver, 1).dropThrough).toBe(false);
    // Tap 2 within the window
    keyboard.press(downKey);
    resolver.update(2);
    expect(buildCharacterInputFromResolver(resolver, 1).dropThrough).toBe(true);
  });

  it('two reads on the same frame return byte-identical records', () => {
    const { resolver, keyboard } = buildHarness([1]);
    keyboard.press(KEY_CODE.W);
    resolver.update(0);
    const a = buildCharacterInputFromResolver(resolver, 1);
    const b = buildCharacterInputFromResolver(resolver, 1);
    expect(a).toEqual(b);
    expect(a.jump).toBe(b.jump);
    expect(a.moveX).toBe(b.moveX);
  });

  it('multi-player isolation — P1 and P2 read independent state', () => {
    const { resolver, keyboard, store } = buildHarness([1, 2]);
    const p1Attack = (store.get(1).bindings.attack[0] as { keyCode: number }).keyCode;
    const p2Attack = (store.get(2).bindings.attack[0] as { keyCode: number }).keyCode;

    keyboard.press(p1Attack);
    resolver.update(0);
    expect(buildCharacterInputFromResolver(resolver, 1).attack).toBe(true);
    expect(buildCharacterInputFromResolver(resolver, 2).attack).toBe(false);

    keyboard.press(p2Attack);
    resolver.update(1);
    expect(buildCharacterInputFromResolver(resolver, 1).attack).toBe(true);
    expect(buildCharacterInputFromResolver(resolver, 2).attack).toBe(true);
  });

  it('reflects mid-match rebinds on the next update — no scene reload', () => {
    const { resolver, keyboard, store } = buildHarness([1]);
    resolver.update(0);

    // Press a key not yet bound to attack — the gameplay-side input
    // should not see an attack press.
    keyboard.press(75 /* 'K' */);
    resolver.update(1);
    expect(buildCharacterInputFromResolver(resolver, 1).attack).toBe(false);

    // Rebind P1 attack to that key. The very next resolver update +
    // helper read picks the rebind up — no manual refresh / scene
    // reload required.
    store.setAction(1, 'attack', [{ kind: 'keyboard', keyCode: 75 /* 'K' */ }]);
    resolver.update(2);
    expect(buildCharacterInputFromResolver(resolver, 1).attack).toBe(true);
  });
});
