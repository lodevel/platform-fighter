/**
 * AC 40101 Sub-AC 1 — InputService / action-resolver test suite.
 *
 * Locks down the contract documented on the module:
 *
 *   1. Construction — accepts a {@link BindingsStore}, an
 *      {@link InputBindingsStore}, or a plain
 *      {@link PlayerBindingsProvider}; accepts a pre-built
 *      {@link DeviceInputDispatcher} or builds one from
 *      keyboard + gamepad sources; throws if neither is supplied.
 *
 *   2. `resolve(slot)` — returns a fully-closed, frozen
 *      {@link UnifiedActionState} with `move / jump / attack / special /
 *      shield / grab / dodge` populated correctly across keyboard and
 *      gamepad device families.
 *
 *   3. Movement — keyboard slots produce digital `-1 | 0 | +1` per axis
 *      (left+right cancel, up+down cancel); gamepad slots produce
 *      analog magnitude with the engine's canvas Y convention
 *      (`y < 0` is up, `y > 0` is down).
 *
 *   4. Dodge resolution — default chord fires when shield is held AND
 *      any directional input clears the threshold; a custom
 *      {@link DodgeResolver} can override the rule.
 *
 *   5. Live-store integration — mid-match rebinds committed to the
 *      underlying store take effect on the very next read with no
 *      explicit reload.
 *
 *   6. Determinism — two reads with identical source state return
 *      identical records, byte-for-byte.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  DeviceInputDispatcher,
  type GamepadButtonState,
  type GamepadSource,
  type PlayerBindingsProvider,
} from './DeviceInputDispatcher';
import {
  DEFAULT_GAMEPAD_AXIS_THRESHOLD,
  DEFAULT_KEYBOARD_P1_BINDINGS,
  InputBindingsStore,
} from './InputBindingsStore';
import { BindingsStore } from './BindingsStore';
import { KEY_CODE } from './keyCodes';
import {
  DODGE_DIRECTIONAL_THRESHOLD,
  InputService,
  MOVE_NEUTRAL,
  UNIFIED_ACTION_NAMES,
  defaultDodgeResolver,
  neutralUnifiedActionState,
  type DodgeResolver,
  type DodgeResolverContext,
  type UnifiedActionState,
} from './InputService';
import type { KeyboardSource } from './LocalInputHandler';
import type { PlayerBindings } from '../types/inputBindings';

// ---------------------------------------------------------------------------
// Fixtures — keyboard + gamepad mocks (mirror the DeviceInputDispatcher suite)
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

function pressedButton(value = 1): GamepadButtonState {
  return Object.freeze({ pressed: true, value });
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

interface ServiceFixture {
  service: InputService;
  keyboard: MockKeyboard;
  gamepad: MockGamepad;
  store: InputBindingsStore;
}

function build(): ServiceFixture {
  const keyboard = createMockKeyboard();
  const gamepad = createMockGamepad();
  const store = new InputBindingsStore();
  const service = new InputService({ keyboard, gamepad, bindings: store });
  return { service, keyboard, gamepad, store };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('InputService — construction', () => {
  it('builds a usable service from {keyboard, gamepad, bindings: InputBindingsStore}', () => {
    const { service } = build();
    const state = service.resolve(1);
    expect(state.slot).toBe(1);
    expect(state).toMatchObject(neutralUnifiedActionState(1));
  });

  it('accepts the BindingsStore facade and unwraps it via getRawStore()', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    // Use storage:null so the facade does not reach for ambient localStorage.
    const facade = new BindingsStore({ storage: null });
    const service = new InputService({ keyboard, gamepad, bindings: facade });
    keyboard.press(KEY_CODE.W);
    const state = service.resolve(1);
    expect(state.jump).toBe(true);
  });

  it('accepts a plain PlayerBindingsProvider (no full store)', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    const provider: PlayerBindingsProvider = {
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
    const service = new InputService({ keyboard, gamepad, bindings: provider });
    keyboard.press(KEY_CODE.SPACE);
    expect(service.resolve(1).jump).toBe(true);
    expect(service.isActionHeld(1, 'jump')).toBe(true);
  });

  it('reuses a pre-built dispatcher when supplied directly', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    const store = new InputBindingsStore();
    const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad, bindings: store });
    const service = new InputService({ bindings: store, dispatcher });
    expect(service.getDispatcher()).toBe(dispatcher);
    keyboard.press(KEY_CODE.F);
    expect(service.resolve(1).attack).toBe(true);
  });

  it('throws when neither dispatcher nor (keyboard+gamepad) is supplied', () => {
    const store = new InputBindingsStore();
    expect(
      () =>
        new InputService({
          bindings: store,
        }),
    ).toThrow(/dispatcher|keyboard|gamepad/);
  });

  it('throws when bindings is null/undefined', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    expect(
      () =>
        new InputService({
          keyboard,
          gamepad,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          bindings: null as any,
        }),
    ).toThrow(/null\/undefined|valid bindings source/);
  });

  it('throws when bindings does not implement get(slot)', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    expect(
      () =>
        new InputService({
          keyboard,
          gamepad,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          bindings: { something: 'else' } as any,
        }),
    ).toThrow(/get\(slot\)|valid bindings source/);
  });
});

// ---------------------------------------------------------------------------
// Unified action vocabulary
// ---------------------------------------------------------------------------

describe('InputService — unified action vocabulary', () => {
  it('covers exactly the Seed-mandated action API: jump/attack/special/grab/shield/dodge', () => {
    expect([...UNIFIED_ACTION_NAMES].sort()).toEqual(
      ['attack', 'dodge', 'grab', 'jump', 'shield', 'special'].sort(),
    );
  });

  it('every resolved record is frozen and has every field', () => {
    const { service } = build();
    const state = service.resolve(2);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.move)).toBe(true);
    expect(state).toMatchObject({
      slot: 2,
      move: { x: 0, y: 0 },
      jump: false,
      attack: false,
      special: false,
      shield: false,
      grab: false,
      dodge: false,
    });
    expect(() => {
      (state as unknown as { jump: boolean }).jump = true;
    }).toThrow();
  });

  it('neutral state factory matches the resolved-neutral shape', () => {
    const { service } = build();
    const a = service.resolve(3);
    const b = neutralUnifiedActionState(3);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Keyboard slots — button-style actions
// ---------------------------------------------------------------------------

describe('InputService — keyboard button actions', () => {
  it('forwards every default P1 binding through the unified API', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.W); // jump (and up)
    expect(service.resolve(1).jump).toBe(true);
    expect(service.isActionHeld(1, 'jump')).toBe(true);
    keyboard.releaseAll();

    keyboard.press(KEY_CODE.F); // attack
    expect(service.resolve(1).attack).toBe(true);
    expect(service.isActionHeld(1, 'attack')).toBe(true);
    keyboard.releaseAll();

    keyboard.press(KEY_CODE.G); // special
    expect(service.resolve(1).special).toBe(true);
    expect(service.isActionHeld(1, 'special')).toBe(true);
    keyboard.releaseAll();

    keyboard.press(KEY_CODE.H); // shield
    expect(service.resolve(1).shield).toBe(true);
    expect(service.isActionHeld(1, 'shield')).toBe(true);
    keyboard.releaseAll();

    keyboard.press(KEY_CODE.T); // grab
    expect(service.resolve(1).grab).toBe(true);
    expect(service.isActionHeld(1, 'grab')).toBe(true);
  });

  it('forwards every default P2 binding through the unified API', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.ARROW_UP); // jump
    expect(service.resolve(2).jump).toBe(true);
    keyboard.releaseAll();

    keyboard.press(KEY_CODE.NUMPAD_1);
    expect(service.resolve(2).attack).toBe(true);
    keyboard.releaseAll();

    keyboard.press(KEY_CODE.NUMPAD_2);
    expect(service.resolve(2).special).toBe(true);
    keyboard.releaseAll();

    keyboard.press(KEY_CODE.NUMPAD_3);
    expect(service.resolve(2).shield).toBe(true);
    keyboard.releaseAll();

    keyboard.press(KEY_CODE.NUMPAD_4);
    expect(service.resolve(2).grab).toBe(true);
  });

  it('isolates slots — pressing P1 keys does not fire P2 actions', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.F);
    expect(service.resolve(1).attack).toBe(true);
    expect(service.resolve(2).attack).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Keyboard slots — movement vector
// ---------------------------------------------------------------------------

describe('InputService — keyboard movement', () => {
  it('moveX is -1 / 0 / +1 for keyboard slots', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.A);
    expect(service.resolve(1).move).toEqual({ x: -1, y: 0 });
    keyboard.releaseAll();

    keyboard.press(KEY_CODE.D);
    expect(service.resolve(1).move).toEqual({ x: 1, y: 0 });
  });

  it('left + right held cancel out to moveX = 0', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.A, KEY_CODE.D);
    const state = service.resolve(1);
    expect(state.move.x).toBe(0);
  });

  it('moveY uses canvas convention — up is negative, down is positive', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.W);
    const upState = service.resolve(1);
    expect(upState.move.y).toBe(-1);
    keyboard.releaseAll();

    keyboard.press(KEY_CODE.S);
    const downState = service.resolve(1);
    expect(downState.move.y).toBe(1);
  });

  it('up + down held cancel out to moveY = 0', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.W, KEY_CODE.S);
    expect(service.resolve(1).move.y).toBe(0);
  });

  it('returns the MOVE_NEUTRAL singleton when both axes are zero', () => {
    const { service } = build();
    const m = service.sampleMove(1);
    expect(m).toBe(MOVE_NEUTRAL);
  });

  it('produces a fresh frozen vector when either axis is non-zero', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.D);
    const m = service.sampleMove(1);
    expect(m).not.toBe(MOVE_NEUTRAL);
    expect(Object.isFrozen(m)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gamepad slots — analog stick magnitude
// ---------------------------------------------------------------------------

describe('InputService — gamepad analog movement', () => {
  it('preserves analog magnitude on moveX for half-pushed sticks', () => {
    const { service, gamepad } = build();
    gamepad.connect(0);
    gamepad.setAxis(0, 0, 0.65);
    expect(service.resolve(3).move.x).toBeCloseTo(0.65, 5);
  });

  it('preserves analog magnitude on moveY (down = positive)', () => {
    const { service, gamepad } = build();
    gamepad.connect(0);
    gamepad.setAxis(0, 1, 0.7);
    expect(service.resolve(3).move.y).toBeCloseTo(0.7, 5);
  });

  it('preserves analog magnitude on moveY (up = negative)', () => {
    const { service, gamepad } = build();
    gamepad.connect(0);
    gamepad.setAxis(0, 1, -0.8);
    expect(service.resolve(3).move.y).toBeCloseTo(-0.8, 5);
  });

  it('does not fire below the dispatcher threshold', () => {
    const { service, gamepad } = build();
    gamepad.connect(0);
    gamepad.setAxis(0, 0, DEFAULT_GAMEPAD_AXIS_THRESHOLD - 0.01);
    expect(service.resolve(3).move.x).toBe(0);
  });

  it('treats a disconnected pad as fully released for a gamepad slot', () => {
    const { service, gamepad } = build();
    // No connect — pad disconnected.
    gamepad.setButton(0, 0, pressedButton());
    gamepad.setAxis(0, 0, -1);
    const state = service.resolve(3);
    expect(state).toMatchObject(neutralUnifiedActionState(3));
  });

  it('isolates pads — pad 0 does not fire pad 1 (slot 4) actions', () => {
    const { service, gamepad } = build();
    gamepad.connect(0);
    gamepad.connect(1);
    gamepad.setButton(0, 0, pressedButton());
    expect(service.resolve(3).jump).toBe(true);
    expect(service.resolve(4).jump).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Dodge resolution
// ---------------------------------------------------------------------------

describe('InputService — dodge resolution (default resolver)', () => {
  it('returns false when shield is not held, regardless of stick', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.A); // pure left, no shield
    const state = service.resolve(1);
    expect(state.dodge).toBe(false);
    expect(service.isActionHeld(1, 'dodge')).toBe(false);
  });

  it('returns false when shield is held but stick is neutral (standing shield)', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.H); // shield only
    const state = service.resolve(1);
    expect(state.shield).toBe(true);
    expect(state.dodge).toBe(false);
  });

  it('fires for shield + left (roll-dodge)', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.H, KEY_CODE.A);
    expect(service.resolve(1).dodge).toBe(true);
  });

  it('fires for shield + right (roll-dodge)', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.H, KEY_CODE.D);
    expect(service.resolve(1).dodge).toBe(true);
  });

  it('fires for shield + down (spot-dodge)', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.H, KEY_CODE.S);
    expect(service.resolve(1).dodge).toBe(true);
  });

  it('fires for shield + up (wave/air-dodge)', () => {
    const { service, keyboard } = build();
    // P1 W is bound to BOTH up and jump in defaults, so press shield+W
    // and assert dodge fires from the up direction (not because of any
    // jump-related side effect).
    keyboard.press(KEY_CODE.H, KEY_CODE.W);
    const state = service.resolve(1);
    expect(state.dodge).toBe(true);
    expect(state.move.y).toBe(-1);
  });

  it('default resolver respects the DODGE_DIRECTIONAL_THRESHOLD constant', () => {
    // Below the threshold should not fire; at-or-above should fire.
    const ctxBelow: DodgeResolverContext = {
      slot: 1,
      move: { x: 0, y: DODGE_DIRECTIONAL_THRESHOLD - 0.01 },
      jump: false,
      attack: false,
      special: false,
      shield: true,
      grab: false,
      held: {
        left: false,
        right: false,
        up: false,
        down: false,
        jump: false,
        attack: false,
        special: false,
        shield: true,
        grab: false,
        taunt: false,
      },
    };
    const ctxAtThreshold: DodgeResolverContext = {
      ...ctxBelow,
      move: { x: 0, y: DODGE_DIRECTIONAL_THRESHOLD },
    };
    expect(defaultDodgeResolver(ctxBelow)).toBe(false);
    expect(defaultDodgeResolver(ctxAtThreshold)).toBe(true);
  });

  it('honours a custom DodgeResolver override', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    const store = new InputBindingsStore();
    const customResolver: DodgeResolver = vi.fn((ctx) => ctx.attack); // dodge fires when attack is held
    const service = new InputService({
      keyboard,
      gamepad,
      bindings: store,
      dodgeResolver: customResolver,
    });
    keyboard.press(KEY_CODE.F); // attack
    const state = service.resolve(1);
    expect(state.dodge).toBe(true);
    expect(customResolver).toHaveBeenCalled();
  });

  it('the resolver context exposes the raw legacy held bitmap', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    const store = new InputBindingsStore();
    let captured: DodgeResolverContext | null = null;
    const service = new InputService({
      keyboard,
      gamepad,
      bindings: store,
      dodgeResolver: (ctx) => {
        captured = ctx;
        return false;
      },
    });
    keyboard.press(KEY_CODE.A);
    service.resolve(1);
    expect(captured).not.toBeNull();
    const seen = captured as unknown as DodgeResolverContext;
    expect(seen.held.left).toBe(true);
    // The raw held bitmap also surfaces the legacy 'taunt' action so a
    // future resolver can branch on it without re-querying.
    expect(typeof seen.held.taunt).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// Live store integration
// ---------------------------------------------------------------------------

describe('InputService — live store integration', () => {
  it('picks up a rebinding committed mid-session with no explicit reload', () => {
    const { service, keyboard, store } = build();
    // Default P1 jump is W. Rebind to Space.
    store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    keyboard.press(KEY_CODE.W);
    expect(service.resolve(1).jump).toBe(false);
    keyboard.releaseAll();
    keyboard.press(KEY_CODE.SPACE);
    expect(service.resolve(1).jump).toBe(true);
  });

  it('reset(slot) on the underlying store reverts service reads', () => {
    const { service, keyboard, store } = build();
    store.setAction(1, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    keyboard.press(KEY_CODE.SPACE);
    expect(service.resolve(1).attack).toBe(true);
    store.reset(1);
    keyboard.releaseAll();
    keyboard.press(KEY_CODE.F); // default P1 attack
    expect(service.resolve(1).attack).toBe(true);
    keyboard.releaseAll();
    keyboard.press(KEY_CODE.SPACE);
    expect(service.resolve(1).attack).toBe(false);
  });

  it('writes through the BindingsStore facade are visible on next read', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    const facade = new BindingsStore({ storage: null });
    const service = new InputService({ keyboard, gamepad, bindings: facade });
    facade.setAction(2, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    keyboard.press(KEY_CODE.SPACE);
    expect(service.resolve(2).attack).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveAll
// ---------------------------------------------------------------------------

describe('InputService — resolveAll', () => {
  it('returns a frozen record with every slot 1..4', () => {
    const { service } = build();
    const all = service.resolveAll();
    expect(Object.isFrozen(all)).toBe(true);
    expect(Object.keys(all).map(Number).sort()).toEqual([1, 2, 3, 4]);
    for (const slot of [1, 2, 3, 4] as const) {
      expect(all[slot].slot).toBe(slot);
      expect(Object.isFrozen(all[slot])).toBe(true);
    }
  });

  it('every slot resolves independently from its own bindings', () => {
    const { service, keyboard, gamepad } = build();
    keyboard.press(KEY_CODE.F); // P1 attack
    keyboard.press(KEY_CODE.NUMPAD_2); // P2 special
    gamepad.connect(0);
    gamepad.setButton(0, 0, pressedButton()); // P3 jump
    gamepad.connect(1);
    gamepad.setButton(1, 5, pressedButton()); // P4 shield
    const all = service.resolveAll();
    expect(all[1].attack).toBe(true);
    expect(all[2].special).toBe(true);
    expect(all[3].jump).toBe(true);
    expect(all[4].shield).toBe(true);
    // Confirm cross-slot isolation didn't bleed.
    expect(all[1].special).toBe(false);
    expect(all[2].attack).toBe(false);
    expect(all[3].shield).toBe(false);
    expect(all[4].jump).toBe(false);
  });

  it('iteration order of the resolveAll record is deterministic 1..4', () => {
    const { service } = build();
    const all = service.resolveAll();
    expect(Object.keys(all)).toEqual(['1', '2', '3', '4']);
  });
});

// ---------------------------------------------------------------------------
// isActionHeld
// ---------------------------------------------------------------------------

describe('InputService — isActionHeld single-action read', () => {
  it('every UnifiedActionName roundtrips through isActionHeld', () => {
    const { service, keyboard } = build();
    // Press every default P1 action key in turn and verify the matching
    // unified action returns true.
    keyboard.press(KEY_CODE.W);
    expect(service.isActionHeld(1, 'jump')).toBe(true);
    keyboard.releaseAll();
    keyboard.press(KEY_CODE.F);
    expect(service.isActionHeld(1, 'attack')).toBe(true);
    keyboard.releaseAll();
    keyboard.press(KEY_CODE.G);
    expect(service.isActionHeld(1, 'special')).toBe(true);
    keyboard.releaseAll();
    keyboard.press(KEY_CODE.T);
    expect(service.isActionHeld(1, 'grab')).toBe(true);
    keyboard.releaseAll();
    keyboard.press(KEY_CODE.H);
    expect(service.isActionHeld(1, 'shield')).toBe(true);
    expect(service.isActionHeld(1, 'dodge')).toBe(false); // shield + neutral stick
    keyboard.press(KEY_CODE.A);
    expect(service.isActionHeld(1, 'dodge')).toBe(true); // shield + left
  });

  it('isActionHeld(dodge) and resolve().dodge agree', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.H, KEY_CODE.S);
    const state = service.resolve(1);
    expect(state.dodge).toBe(true);
    expect(service.isActionHeld(1, 'dodge')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pass-throughs
// ---------------------------------------------------------------------------

describe('InputService — pass-throughs', () => {
  it('sampleHeldActions surfaces the legacy ActionHeldMap (taunt etc.)', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.R); // P1 default taunt key
    const map = service.sampleHeldActions(1);
    expect(map.taunt).toBe(true);
    expect(Object.isFrozen(map)).toBe(true);
  });

  it('getDispatcher returns the dispatcher the service was constructed with', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    const store = new InputBindingsStore();
    const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad, bindings: store });
    const service = new InputService({ bindings: store, dispatcher });
    expect(service.getDispatcher()).toBe(dispatcher);
  });

  it('getBindingsProvider returns the normalised provider (not the facade)', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    const facade = new BindingsStore({ storage: null });
    const service = new InputService({ keyboard, gamepad, bindings: facade });
    // The facade is unwrapped to its inner store on construction.
    expect(service.getBindingsProvider()).toBe(facade.getRawStore());
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('InputService — determinism', () => {
  it('two reads with identical source state return structurally-equal records', () => {
    const { service, keyboard, gamepad } = build();
    keyboard.press(KEY_CODE.A, KEY_CODE.F);
    gamepad.connect(0);
    gamepad.setAxis(0, 1, -0.7);
    const a = service.resolve(1);
    const b = service.resolve(1);
    const c = service.resolve(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    const d = service.resolve(3);
    const e = service.resolve(3);
    expect(d).toEqual(e);
  });

  it('two services over the same dispatcher produce identical samples', () => {
    const keyboard = createMockKeyboard();
    const gamepad = createMockGamepad();
    const store = new InputBindingsStore();
    const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad, bindings: store });
    const a = new InputService({ bindings: store, dispatcher });
    const b = new InputService({ bindings: store, dispatcher });
    keyboard.press(KEY_CODE.W);
    gamepad.connect(1);
    gamepad.setButton(1, 2, pressedButton());
    expect(a.resolve(1)).toEqual(b.resolve(1));
    expect(a.resolve(4)).toEqual(b.resolve(4));
  });

  it('repeated resolveAll calls are structurally equal under unchanged state', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.F);
    const a = service.resolveAll();
    const b = service.resolveAll();
    // Records compare equal; references differ (each call freezes a fresh
    // record, which keeps consumers from accidentally relying on identity).
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Smoke / integration with the canonical defaults
// ---------------------------------------------------------------------------

describe('InputService — defaults integration smoke', () => {
  it('every default-binding slot starts in the neutral unified state', () => {
    const { service } = build();
    expect(service.resolve(1)).toEqual(neutralUnifiedActionState(1));
    expect(service.resolve(2)).toEqual(neutralUnifiedActionState(2));
    expect(service.resolve(3)).toEqual(neutralUnifiedActionState(3));
    expect(service.resolve(4)).toEqual(neutralUnifiedActionState(4));
  });

  it('a typical gameplay frame yields a self-consistent unified record', () => {
    const { service, keyboard, gamepad } = build();
    // P1 holding shield + back-edging with attack press.
    keyboard.press(KEY_CODE.H, KEY_CODE.A, KEY_CODE.F);
    // P3 stick pushed up-right past threshold, jump button pressed.
    gamepad.connect(0);
    gamepad.setAxis(0, 0, 0.8);
    gamepad.setAxis(0, 1, -0.6);
    gamepad.setButton(0, 0, pressedButton());
    const p1 = service.resolve(1);
    const p3 = service.resolve(3);
    // P1: roll-dodge backward, attack held.
    expect(p1).toEqual<UnifiedActionState>({
      slot: 1,
      move: Object.freeze({ x: -1, y: 0 }),
      jump: false,
      attack: true,
      special: false,
      shield: true,
      grab: false,
      dodge: true,
    });
    // P3: full jump, stick up-right, no attack.
    expect(p3.move.x).toBeCloseTo(0.8, 5);
    expect(p3.move.y).toBeCloseTo(-0.6, 5);
    expect(p3.jump).toBe(true);
    expect(p3.attack).toBe(false);
    expect(p3.dodge).toBe(false); // shield not held → no dodge
  });
});

// ---------------------------------------------------------------------------
// AC 40104 Sub-AC 4 — sampleCharacterInput → CharacterInput
//
// The gameplay scene's per-step input read goes through
// `inputService.sampleCharacterInput(slot)` instead of poking the
// dispatcher directly. The fold-down here must:
//   • Forward `move.x` to `moveX` (digital on keyboard, analog on
//     gamepad) so a half-pushed stick walks on a controller.
//   • Forward `jump / attack / shield / dodge` verbatim from the
//     unified record.
//   • Derive `dropThrough` from the canonical Smash chord
//     (down + jump pressed simultaneously) read off `move.y > 0`.
//   • Be deterministic — two calls with identical source state
//     produce byte-identical frozen records.
// ---------------------------------------------------------------------------

describe('InputService — sampleCharacterInput (AC 40104 Sub-AC 4)', () => {
  it('returns a frozen, neutral CharacterInput when nothing is pressed', () => {
    const { service } = build();
    const input = service.sampleCharacterInput(1);
    expect(input.moveX).toBe(0);
    expect(input.jump).toBe(false);
    expect(input.attack).toBe(false);
    expect(input.shield).toBe(false);
    expect(input.dodge).toBe(false);
    expect(input.dropThrough).toBe(false);
    expect(Object.isFrozen(input)).toBe(true);
  });

  it('forwards keyboard moveX as digital -1 / 0 / +1', () => {
    const { service, keyboard } = build();
    // P1: A = left.
    keyboard.press(KEY_CODE.A);
    expect(service.sampleCharacterInput(1).moveX).toBe(-1);
    keyboard.releaseAll();
    // P1: D = right.
    keyboard.press(KEY_CODE.D);
    expect(service.sampleCharacterInput(1).moveX).toBe(1);
    keyboard.releaseAll();
    // P1: A + D cancel.
    keyboard.press(KEY_CODE.A, KEY_CODE.D);
    expect(service.sampleCharacterInput(1).moveX).toBe(0);
  });

  it('preserves analog stick magnitude on gamepad slots', () => {
    const { service, gamepad } = build();
    gamepad.connect(0);
    gamepad.setAxis(0, 0, 0.6); // half-deflection right (P3 default left-stick X).
    const input = service.sampleCharacterInput(3);
    expect(input.moveX).toBeCloseTo(0.6, 5);
  });

  it('forwards jump / attack / shield from the unified record', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.W); // P1 jump (and up).
    keyboard.press(KEY_CODE.F); // P1 attack.
    keyboard.press(KEY_CODE.H); // P1 shield.
    const input = service.sampleCharacterInput(1);
    expect(input.jump).toBe(true);
    expect(input.attack).toBe(true);
    expect(input.shield).toBe(true);
  });

  it('forwards the resolved dodge boolean (shield + directional chord)', () => {
    const { service, keyboard } = build();
    // Shield alone — no dodge.
    keyboard.press(KEY_CODE.H);
    expect(service.sampleCharacterInput(1).dodge).toBe(false);
    // Shield + back-edge → roll-dodge backward.
    keyboard.press(KEY_CODE.A);
    const dodging = service.sampleCharacterInput(1);
    expect(dodging.dodge).toBe(true);
    expect(dodging.shield).toBe(true);
    expect(dodging.moveX).toBe(-1);
  });

  it('derives dropThrough from the down + jump chord', () => {
    const { service, keyboard } = build();
    // Down alone — not enough.
    keyboard.press(KEY_CODE.S);
    expect(service.sampleCharacterInput(1).dropThrough).toBe(false);
    // Down + jump (W is bound to both `up` and `jump`, so use the
    // jump key to avoid the `up` cancellation).
    keyboard.releaseAll();
    keyboard.press(KEY_CODE.S, KEY_CODE.W);
    // S maps to `down`, W maps to `jump`. The unified `move.y` is
    // `down - up` per the dispatcher's convention; W also maps to
    // `up`, so the y components cancel — but `dropThrough` is `move.y
    // > 0 && jump`, which still requires y > 0. Verify the canonical
    // wiring: when only `down` is held alongside `jump`, dropThrough
    // fires.
    keyboard.releaseAll();
    // Bind a slot's jump to a *different* key from up so the chord
    // isolates cleanly. Use a custom provider for clarity.
    const provider: PlayerBindingsProvider = {
      get(): PlayerBindings {
        return {
          playerIndex: 1,
          bindings: {
            ...DEFAULT_KEYBOARD_P1_BINDINGS,
            // Move jump off W (which doubles as `up` in the defaults)
            // so this test isolates the down + jump chord.
            jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }],
            up: [{ kind: 'keyboard', keyCode: KEY_CODE.W }],
          },
        };
      },
    };
    const isolated = new InputService({
      keyboard,
      gamepad: createMockGamepad(),
      bindings: provider,
    });
    keyboard.press(KEY_CODE.S, KEY_CODE.SPACE);
    const input = isolated.sampleCharacterInput(1);
    expect(input.jump).toBe(true);
    expect(input.dropThrough).toBe(true);
  });

  it('mid-rebind takes effect on the very next sample (no reload)', () => {
    const { service, keyboard, store } = build();
    keyboard.press(KEY_CODE.SPACE);
    // SPACE is not bound to jump by default → released.
    expect(service.sampleCharacterInput(1).jump).toBe(false);
    // Rebind jump to SPACE; the very next sample reflects it.
    store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    expect(service.sampleCharacterInput(1).jump).toBe(true);
  });

  it('two reads with identical source state yield byte-identical records', () => {
    const { service, keyboard } = build();
    keyboard.press(KEY_CODE.W, KEY_CODE.F);
    const a = service.sampleCharacterInput(1);
    const b = service.sampleCharacterInput(1);
    expect(a).toEqual(b);
  });

  // -------------------------------------------------------------------------
  // AC 5 Sub-AC 3 — runtime input resolves through the per-player bindings
  // map for ALL four player slots simultaneously, with mid-match rebinds
  // taking effect immediately on the very next sample.
  //
  // The match-scene gameplay loop calls
  // `inputService.sampleCharacterInput(slot.bindingsSlot)` for every
  // entry in its `playerSlots` table — this test pins down the contract
  // it relies on: each slot's `CharacterInput` reflects only that
  // slot's binding profile, with no cross-slot bleed and no hardcoded
  // device-specific paths between the call site and the live store.
  // -------------------------------------------------------------------------
  describe('runtime input — per-player binding map across all 4 slots (AC 5 Sub-AC 3)', () => {
    it('resolves keyboard P1 + P2 and gamepad P3 + P4 concurrently from one shared store', () => {
      const { service, keyboard, gamepad } = build();
      // Hold one distinct action per slot so a cross-slot bleed shows
      // up as a wrong-slot true. Defaults wire each device family to
      // its canonical slot.
      keyboard.press(KEY_CODE.D); // P1 right
      keyboard.press(KEY_CODE.NUMPAD_1); // P2 attack
      gamepad.connect(0);
      gamepad.setButton(0, 0, pressedButton()); // P3 jump (face-button A)
      gamepad.connect(1);
      gamepad.setButton(1, 5, pressedButton()); // P4 shield (RB on pad 1)

      const p1 = service.sampleCharacterInput(1);
      const p2 = service.sampleCharacterInput(2);
      const p3 = service.sampleCharacterInput(3);
      const p4 = service.sampleCharacterInput(4);

      // P1 — only the moveX flag fires.
      expect(p1.moveX).toBe(1);
      expect(p1.attack).toBe(false);
      expect(p1.jump).toBe(false);
      expect(p1.shield).toBe(false);

      // P2 — only attack fires.
      expect(p2.attack).toBe(true);
      expect(p2.moveX).toBe(0);
      expect(p2.jump).toBe(false);
      expect(p2.shield).toBe(false);

      // P3 — only jump fires.
      expect(p3.jump).toBe(true);
      expect(p3.attack).toBe(false);
      expect(p3.moveX).toBe(0);
      expect(p3.shield).toBe(false);

      // P4 — only shield fires.
      expect(p4.shield).toBe(true);
      expect(p4.jump).toBe(false);
      expect(p4.attack).toBe(false);
      expect(p4.moveX).toBe(0);
    });

    it('mid-match rebind on one slot does not affect the other three slots', () => {
      const { service, keyboard, store } = build();
      // Rebind only P3's jump to SPACE; everyone else's profile stays
      // at defaults. The very next sample for P3 reflects the rebind;
      // the others are unaffected because they read from their own
      // slot's binding profile.
      store.setAction(3, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
      keyboard.press(KEY_CODE.SPACE);
      // P1, P2, P4 have NOT been rebound to SPACE — released for them.
      expect(service.sampleCharacterInput(1).jump).toBe(false);
      expect(service.sampleCharacterInput(2).jump).toBe(false);
      expect(service.sampleCharacterInput(4).jump).toBe(false);
      // P3 is rebound — its sample sees the press through the rebind.
      expect(service.sampleCharacterInput(3).jump).toBe(true);
    });

    it('iterating sampleCharacterInput over slots 1..4 reads only through the bindings map', () => {
      const { service, keyboard, gamepad, store } = build();
      // Rebind every slot's `attack` to a distinct key/button so a
      // single press on one of them must not fire any other slot's
      // attack. Slots 1 + 2 use distinct keyboard keys; slots 3 + 4
      // use distinct gamepad buttons on distinct pads.
      store.setAction(1, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
      store.setAction(2, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.ENTER }]);
      store.setAction(3, 'attack', [
        { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 2 } },
      ]);
      store.setAction(4, 'attack', [
        { kind: 'gamepad', gamepadIndex: 1, source: { type: 'button', buttonIndex: 3 } },
      ]);

      gamepad.connect(0);
      gamepad.connect(1);

      // Run the gameplay's per-step iteration verbatim — exactly what
      // the MatchScene update loop does. The unified `attack` field on
      // `CharacterInput` is declared optional so we coerce undefined →
      // false here for a clean assertion shape.
      function readAllSlots(): ReadonlyArray<{
        readonly slot: 1 | 2 | 3 | 4;
        readonly attack: boolean;
      }> {
        return ([1, 2, 3, 4] as const).map((slot) => ({
          slot,
          attack: service.sampleCharacterInput(slot).attack === true,
        }));
      }

      // Press only P1's bound key — only slot 1 reports attack.
      keyboard.press(KEY_CODE.SPACE);
      expect(readAllSlots()).toEqual([
        { slot: 1, attack: true },
        { slot: 2, attack: false },
        { slot: 3, attack: false },
        { slot: 4, attack: false },
      ]);
      keyboard.releaseAll();

      // Press only P2's bound key — only slot 2 reports attack.
      keyboard.press(KEY_CODE.ENTER);
      expect(readAllSlots()).toEqual([
        { slot: 1, attack: false },
        { slot: 2, attack: true },
        { slot: 3, attack: false },
        { slot: 4, attack: false },
      ]);
      keyboard.releaseAll();

      // Press only P3's bound gamepad button — only slot 3 reports.
      gamepad.setButton(0, 2, pressedButton());
      expect(readAllSlots()).toEqual([
        { slot: 1, attack: false },
        { slot: 2, attack: false },
        { slot: 3, attack: true },
        { slot: 4, attack: false },
      ]);
      gamepad.setButton(0, 2, Object.freeze({ pressed: false, value: 0 }));

      // Press only P4's bound gamepad button — only slot 4 reports.
      gamepad.setButton(1, 3, pressedButton());
      expect(readAllSlots()).toEqual([
        { slot: 1, attack: false },
        { slot: 2, attack: false },
        { slot: 3, attack: false },
        { slot: 4, attack: true },
      ]);
    });
  });
});
