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
  NEUTRAL_SMASH_STATE,
  PlayerActionMap,
  buildCharacterInputFromResolver,
  type ActionName,
} from './InputResolver';
import { MOVE_NEUTRAL } from './InputService';
import type { GamepadBinding, PlayerBindingsIndex } from '../types/inputBindings';

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
  it('routes the persisted direct-dodge binding into CharacterInput', () => {
    const { resolver, keyboard, store } = buildHarness([1]);
    const directDodgeKey = (store.get(1).bindings.taunt[0] as { keyCode: number }).keyCode;
    keyboard.press(directDodgeKey);
    resolver.update(0);
    const input = buildCharacterInputFromResolver(resolver, 1);
    expect(input.dodge).toBe(true);
    expect(input.shield).toBe(false);
    expect(input.moveX).toBe(0);
  });

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
    // Held Shield+Special is the shield-shift modifier, not a dodge chord.
    expect(input.dodge).toBe(false);
    // Shield + directional (special released) → derived dodge action fires.
    keyboard.release(specialKey);
    resolver.update(1);
    expect(buildCharacterInputFromResolver(resolver, 1).dodge).toBe(true);
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

// ---------------------------------------------------------------------------
// Smash action — per-slot state and the CharacterInput translation
// ---------------------------------------------------------------------------

interface StickPad extends GamepadSource {
  setAxis(axis: number, value: number): void;
}

/** Pad 0 connected, axes settable, no buttons pressed. */
function createStickPad(): StickPad {
  const NEUTRAL: GamepadButtonState = Object.freeze({ pressed: false, value: 0 });
  const axes = new Map<number, number>();
  return {
    isConnected: (index: number) => index === 0,
    getButton: () => NEUTRAL,
    getAxis: (index: number, axis: number) => (index === 0 ? axes.get(axis) ?? 0 : 0),
    setAxis(axis: number, value: number): void {
      axes.set(axis, value);
    },
  };
}

const RIGHT_STICK_SMASH: GamepadBinding[] = [2, 3].flatMap((axisIndex) =>
  ([-1, 1] as const).map((direction) => ({
    kind: 'gamepad' as const,
    gamepadIndex: 0,
    source: { type: 'axis' as const, axisIndex, direction, threshold: 0.6 },
  })),
);

function buildSmashHarness() {
  const keyboard = createMockKeyboard();
  const pad = createStickPad();
  const store = new InputBindingsStore();
  // Slot 1 smashes with a key, slot 3 with pad 0's right stick; the left
  // stick (axes 0/1) moves slot 3 so the tests can check it is untouched.
  store.setAction(1, 'smash', [{ kind: 'keyboard', keyCode: KEY_CODE.V }]);
  store.setAction(3, 'smash', RIGHT_STICK_SMASH);
  const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad: pad, bindings: store });
  const resolver = new InputResolver({ dispatcher, slots: [1, 3] });
  return { resolver, keyboard, pad, store };
}

describe('InputResolver.getSmash', () => {
  it('is neutral before the first update and for untracked slots', () => {
    const { resolver } = buildSmashHarness();
    expect(resolver.getSmash(1)).toBe(NEUTRAL_SMASH_STATE);
    resolver.update(0);
    expect(resolver.getSmash(2)).toBe(NEUTRAL_SMASH_STATE);
  });

  it('tracks held / edges per slot, with the stick direction only for stick slots', () => {
    const { resolver, keyboard, pad } = buildSmashHarness();
    resolver.update(0);
    keyboard.press(KEY_CODE.V);
    pad.setAxis(2, -1);
    resolver.update(1);
    expect(resolver.getSmash(1)).toEqual({
      held: true, justPressed: true, justReleased: false,
      buttonHeld: true, fromStick: false, stickJustPressed: false, x: 0, y: 0,
    });
    expect(resolver.getSmash(3)).toEqual({
      held: true, justPressed: true, justReleased: false,
      buttonHeld: false, fromStick: true, stickJustPressed: true, x: -1, y: 0,
    });
    resolver.update(2);
    expect(resolver.getSmash(1).justPressed).toBe(false);
    expect(resolver.getSmash(1).held).toBe(true);
    keyboard.release(KEY_CODE.V);
    resolver.update(3);
    expect(resolver.getSmash(1)).toMatchObject({ held: false, justReleased: true });
    expect(resolver.getSmash(3)).toMatchObject({ held: true, justPressed: false });
  });

  it('does not report a phantom press for a stick already held at the first update', () => {
    const { resolver, pad } = buildSmashHarness();
    pad.setAxis(3, 1);
    resolver.update(0);
    expect(resolver.getSmash(3)).toMatchObject({ held: true, justPressed: false, stickJustPressed: false });
    expect(buildCharacterInputFromResolver(resolver, 3).attackHeavy).toBe(false);
  });

  it('tracks the smash key and the smash stick separately on one slot', () => {
    const { resolver, keyboard, pad, store } = buildSmashHarness();
    store.setAction(3, 'smash', [{ kind: 'keyboard', keyCode: KEY_CODE.V }, ...RIGHT_STICK_SMASH]);
    resolver.update(0);
    keyboard.press(KEY_CODE.V);
    resolver.update(1);
    expect(resolver.getSmash(3)).toMatchObject({
      held: true, justPressed: true, buttonHeld: true, fromStick: false, stickJustPressed: false,
    });
    pad.setAxis(3, -1);
    resolver.update(2);
    // The stick has its own edge even though the action as a whole was already held.
    expect(resolver.getSmash(3)).toMatchObject({
      held: true, justPressed: false, buttonHeld: true, fromStick: true, stickJustPressed: true, x: 0, y: -1,
    });
    resolver.update(3);
    expect(resolver.getSmash(3)).toMatchObject({ buttonHeld: true, fromStick: true, stickJustPressed: false });
    keyboard.release(KEY_CODE.V);
    resolver.update(4);
    expect(resolver.getSmash(3)).toMatchObject({
      held: true, justReleased: false, buttonHeld: false, fromStick: true, stickJustPressed: false,
    });
  });

  it('reset() clears the smash state so the next press is a fresh edge', () => {
    const { resolver, keyboard } = buildSmashHarness();
    resolver.update(0);
    keyboard.press(KEY_CODE.V);
    resolver.update(1);
    resolver.reset();
    expect(resolver.getSmash(1)).toBe(NEUTRAL_SMASH_STATE);
    keyboard.release(KEY_CODE.V);
    resolver.update(2);
    keyboard.press(KEY_CODE.V);
    resolver.update(3);
    expect(resolver.getSmash(1).justPressed).toBe(true);
  });
});

describe('buildCharacterInputFromResolver — smash', () => {
  it('a held smash key sends attackHeavy on every held frame (it charges) with no stick direction', () => {
    const { resolver, keyboard } = buildSmashHarness();
    resolver.update(0);
    expect(buildCharacterInputFromResolver(resolver, 1).attackHeavy).toBe(false);
    keyboard.press(KEY_CODE.V);
    for (let frame = 1; frame <= 4; frame += 1) {
      resolver.update(frame);
      const input = buildCharacterInputFromResolver(resolver, 1);
      expect(input.attackHeavy).toBe(true);
      expect(input.attackStickX).toBe(0);
      expect(input.attackStickY).toBe(0);
    }
    keyboard.release(KEY_CODE.V);
    resolver.update(5);
    expect(buildCharacterInputFromResolver(resolver, 1).attackHeavy).toBe(false);
  });

  it('a stick smash is one press with its direction on the start frame only', () => {
    const { resolver, pad } = buildSmashHarness();
    resolver.update(0);
    pad.setAxis(3, -1); // right stick up
    resolver.update(1);
    expect(buildCharacterInputFromResolver(resolver, 3)).toMatchObject({
      attackHeavy: true, attackStickX: 0, attackStickY: -1,
    });
    for (let frame = 2; frame <= 4; frame += 1) {
      resolver.update(frame);
      expect(buildCharacterInputFromResolver(resolver, 3)).toMatchObject({
        attackHeavy: false, attackStickX: 0, attackStickY: 0,
      });
    }
    // Rotating the held stick does not re-trigger; returning to neutral re-arms.
    pad.setAxis(3, 0);
    pad.setAxis(2, 1);
    resolver.update(5);
    expect(buildCharacterInputFromResolver(resolver, 3).attackHeavy).toBe(false);
    pad.setAxis(2, 0);
    resolver.update(6);
    pad.setAxis(2, 1);
    resolver.update(7);
    expect(buildCharacterInputFromResolver(resolver, 3)).toMatchObject({
      attackHeavy: true, attackStickX: 1, attackStickY: 0,
    });
  });

  it('the stick smash leaves moveX / moveY on the left stick', () => {
    const { resolver, keyboard, pad } = buildSmashHarness();
    resolver.update(0);
    // Slot 3's default left stick (pad 0, axes 0/1) holds down-left while
    // the right stick flicks up: the move vector must stay the left stick.
    pad.setAxis(0, -0.7);
    pad.setAxis(1, 0.9);
    pad.setAxis(3, -1);
    resolver.update(1);
    const stick = buildCharacterInputFromResolver(resolver, 3);
    expect(stick.moveX).toBeCloseTo(-0.7);
    expect(stick.moveY).toBeCloseTo(0.9);
    expect(stick).toMatchObject({ attackHeavy: true, attackStickX: 0, attackStickY: -1 });
    // Keyboard: holding down (S) then the smash key keeps moveY = down
    // and sends no stick direction — the fighter reads moveY for its aim.
    keyboard.press(KEY_CODE.S);
    resolver.update(2);
    keyboard.press(KEY_CODE.V);
    resolver.update(3);
    const key = buildCharacterInputFromResolver(resolver, 1);
    expect(key.moveY).toBe(1);
    expect(key).toMatchObject({ attackHeavy: true, attackStickX: 0, attackStickY: 0 });
  });
});

describe('buildCharacterInputFromResolver — smash key and smash stick held together', () => {
  function bothSources() {
    const h = buildSmashHarness();
    h.store.setAction(3, 'smash', [{ kind: 'keyboard', keyCode: KEY_CODE.V }, ...RIGHT_STICK_SMASH]);
    h.resolver.update(0);
    return h;
  }
  const heavyOf = (h: ReturnType<typeof bothSources>) =>
    buildCharacterInputFromResolver(h.resolver, 3).attackHeavy === true;

  it('a stick push while the smash key charges neither releases the charge nor re-presses on return', () => {
    const h = bothSources();
    const trace: boolean[] = [];
    h.keyboard.press(KEY_CODE.V);
    h.resolver.update(1); trace.push(heavyOf(h)); // key down: press
    h.pad.setAxis(2, 1);
    h.resolver.update(2); trace.push(heavyOf(h)); // stick pushed while the key is held
    h.resolver.update(3); trace.push(heavyOf(h)); // both held
    h.pad.setAxis(2, 0);
    h.resolver.update(4); trace.push(heavyOf(h)); // stick back to neutral, key still held
    h.resolver.update(5); trace.push(heavyOf(h));
    h.keyboard.release(KEY_CODE.V);
    h.resolver.update(6); trace.push(heavyOf(h)); // key up: the charge releases here, once
    // One continuous hold: no false frame (early release), no false → true (phantom press).
    expect(trace).toEqual([true, true, true, true, true, false]);
  });

  it('a key press while the stick is held is a fresh press after the stick\'s one-frame press', () => {
    const h = bothSources();
    const trace: boolean[] = [];
    h.pad.setAxis(3, -1);
    h.resolver.update(1); trace.push(heavyOf(h)); // stick press (one frame)
    h.resolver.update(2); trace.push(heavyOf(h)); // stick held: released
    h.keyboard.press(KEY_CODE.V);
    h.resolver.update(3); trace.push(heavyOf(h)); // key: a new press, held
    h.pad.setAxis(3, 0);
    h.resolver.update(4); trace.push(heavyOf(h)); // stick returns: the key keeps it held
    expect(trace).toEqual([true, false, true, true]);
    // Only the stick's own start frame carries a direction.
    expect(buildCharacterInputFromResolver(h.resolver, 3)).toMatchObject({ attackStickX: 0, attackStickY: 0 });
  });
});

describe('InputResolver — dodge vs. smash (keyboard P1 defaults: H shield, R dodge, V smash)', () => {
  function keyboardP1() {
    const keyboard = createMockKeyboard();
    const pad = createStickPad();
    const store = new InputBindingsStore();
    const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad: pad, bindings: store });
    const resolver = new InputResolver({ dispatcher, slots: [1] });
    resolver.update(0);
    return { keyboard, resolver };
  }

  it('dodge + smash on the same frame is not a dodge', () => {
    const { keyboard, resolver } = keyboardP1();
    keyboard.press(KEY_CODE.R, KEY_CODE.V);
    resolver.update(1);
    const input = buildCharacterInputFromResolver(resolver, 1);
    expect(input.dodge).toBe(false);
    expect(input.attackHeavy).toBe(true);
  });

  it('shield + W + V on the same frame reports no dodge; the smash key held afterwards does not block the chord', () => {
    const { keyboard, resolver } = keyboardP1();
    keyboard.press(KEY_CODE.H);
    resolver.update(1);
    keyboard.press(KEY_CODE.W, KEY_CODE.V);
    resolver.update(2);
    const press = buildCharacterInputFromResolver(resolver, 1);
    expect(press).toMatchObject({ shield: true, moveY: -1, jump: true, attackHeavy: true, dodge: false });
    // Only the press frame is special: a smash held from before is not a new press.
    resolver.update(3);
    expect(buildCharacterInputFromResolver(resolver, 1).dodge).toBe(true);
  });
});

describe('InputResolver — dodge vs. the smash stick (default pad: B dodge, R1 shield, right stick smash)', () => {
  /** Slot 3 on its default bindings, pad 0 connected with settable buttons and axes. */
  function padP3() {
    const NEUTRAL: GamepadButtonState = Object.freeze({ pressed: false, value: 0 });
    const PRESSED: GamepadButtonState = Object.freeze({ pressed: true, value: 1 });
    const buttons = new Set<number>();
    const axes = new Map<number, number>();
    const gamepad: GamepadSource = {
      isConnected: (index: number) => index === 0,
      getButton: (index: number, button: number) => (index === 0 && buttons.has(button) ? PRESSED : NEUTRAL),
      getAxis: (index: number, axis: number) => (index === 0 ? axes.get(axis) ?? 0 : 0),
    };
    const dispatcher = new DeviceInputDispatcher({
      keyboard: createMockKeyboard(), gamepad, bindings: new InputBindingsStore(),
    });
    const resolver = new InputResolver({ dispatcher, slots: [3] });
    let frame = 0;
    /** One update with exactly these buttons held and axes deflected. */
    const step = (held: number[] = [], stick: Record<number, number> = {}) => {
      buttons.clear();
      axes.clear();
      for (const b of held) buttons.add(b);
      for (const [a, v] of Object.entries(stick)) axes.set(Number(a), v);
      resolver.update(frame);
      frame += 1;
      return buildCharacterInputFromResolver(resolver, 3);
    };
    step();
    return { step };
  }
  const DODGE = 1;
  const SHIELD = 5;

  it('a right stick left deflected does not block the dodge button', () => {
    const { step } = padP3();
    expect(step([], { 2: 1 })).toMatchObject({ attackHeavy: true, dodge: false }); // the stick's press
    step([], { 2: 1 });
    expect(step([DODGE], { 2: 1 })).toMatchObject({ attackHeavy: false, dodge: true });
  });

  it('the dodge button on the frame the stick smashes is the smash, not a dodge', () => {
    const { step } = padP3();
    expect(step([DODGE], { 3: -1 })).toMatchObject({ attackHeavy: true, attackStickY: -1, dodge: false });
  });

  it('shield + left stick up + right stick forward is still a dodge (the smash is not aimed up)', () => {
    const { step } = padP3();
    for (let i = 0; i < 3; i += 1) step([SHIELD]);
    expect(step([SHIELD], { 1: -1, 2: 1 })).toMatchObject({ shield: true, attackHeavy: true, attackStickX: 1, dodge: true });
  });

  it('shield + left stick up + right stick up is the out-of-shield up smash, not a dodge', () => {
    const { step } = padP3();
    for (let i = 0; i < 3; i += 1) step([SHIELD]);
    expect(step([SHIELD], { 1: -1, 3: -1 })).toMatchObject({ shield: true, attackHeavy: true, attackStickY: -1, dodge: false });
  });

  it('shield + left stick up with the right stick already held is an up dodge', () => {
    const { step } = padP3();
    step([SHIELD], { 3: -1 });
    step([SHIELD], { 3: -1 });
    expect(step([SHIELD], { 1: -1, 3: -1 })).toMatchObject({ attackHeavy: false, dodge: true });
  });
});

describe('InputResolver — shield already up, then W + V (keyboard P1)', () => {
  it('reports no dodge on the press frame: the out-of-shield up smash', () => {
    const keyboard = createMockKeyboard();
    const dispatcher = new DeviceInputDispatcher({
      keyboard, gamepad: createIdleGamepad(), bindings: new InputBindingsStore(),
    });
    const resolver = new InputResolver({ dispatcher, slots: [1] });
    resolver.update(0);
    keyboard.press(KEY_CODE.H);
    for (let frame = 1; frame <= 4; frame += 1) resolver.update(frame);
    keyboard.press(KEY_CODE.W, KEY_CODE.V);
    resolver.update(5);
    expect(buildCharacterInputFromResolver(resolver, 1)).toMatchObject({
      shield: true, moveY: -1, attackHeavy: true, attackStickX: 0, attackStickY: 0, dodge: false,
    });
  });
});

describe('buildCharacterInputFromResolver — smash on an axis off the named sticks', () => {
  it('a trigger-style axis charges like a held button and aims with the left stick', () => {
    const { resolver, pad, store } = buildSmashHarness();
    store.setAction(3, 'smash', [
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'axis', axisIndex: 5, direction: 1, threshold: 0.5 } },
    ]);
    resolver.update(0);
    pad.setAxis(4, -1); // the would-be "pair" axis must not be read as a direction
    pad.setAxis(5, 1);
    pad.setAxis(1, -1); // left stick up
    for (let frame = 1; frame <= 4; frame += 1) {
      resolver.update(frame);
      expect(buildCharacterInputFromResolver(resolver, 3)).toMatchObject({
        attackHeavy: true, attackStickX: 0, attackStickY: 0, moveY: -1,
      });
    }
    pad.setAxis(5, 0);
    resolver.update(5);
    expect(buildCharacterInputFromResolver(resolver, 3).attackHeavy).toBe(false);
  });
});
