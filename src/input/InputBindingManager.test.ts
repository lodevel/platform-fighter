import { describe, it, expect } from 'vitest';
import {
  DeviceInputDispatcher,
  type GamepadButtonState,
  type GamepadSource,
} from './DeviceInputDispatcher';
import {
  DEFAULT_GAMEPAD_AXIS_THRESHOLD,
  InputBindingsStore,
} from './InputBindingsStore';
import {
  InputBindingManager,
  type PlayerActionEvent,
} from './InputBindingManager';
import type { KeyboardSource } from './LocalInputHandler';
import { KEY_CODE } from './keyCodes';
import type { PlayerBindings, PlayerBindingsIndex } from '../types/inputBindings';

/**
 * AC 5 Sub-AC 2 — InputBindingManager.
 *
 * Locks down:
 *
 *   1. Press / release edges — held → released and released → held are
 *      the only state changes that emit events. Held-across-frames is
 *      silent unless `emitHold` is set.
 *   2. Binding-driven dispatch — the manager never references a keyCode
 *      directly; rebinding the store mid-session takes effect on the
 *      next poll without re-instantiating the manager (proving "no
 *      hardcoded input mapping in the input layer").
 *   3. Determinism — events emit in slot-asc, then logical-action
 *      declaration order. The same poll on two identical inputs
 *      produces identical event sequences (and the same `frame` tag
 *      flows through to every event).
 *   4. Multi-player — the manager fans events out for every tracked
 *      slot; a `slots: [1, 2]` filter skips slot 3/4 work entirely.
 *   5. Subscription lifecycle — disposers detach the listener; a
 *      buggy listener doesn't break sibling listeners; `dispose()`
 *      clears every subscription and short-circuits subsequent polls.
 *   6. forceRelease — emits a synthetic `release` for every held
 *      action and resets the internal snapshot to neutral.
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

function buildHarness(opts: {
  emitHold?: boolean;
  slots?: ReadonlyArray<PlayerBindingsIndex>;
  store?: InputBindingsStore;
} = {}): {
  manager: InputBindingManager;
  dispatcher: DeviceInputDispatcher;
  keyboard: MockKeyboard;
  gamepad: MockGamepad;
  store: InputBindingsStore;
  events: PlayerActionEvent[];
} {
  const keyboard = createMockKeyboard();
  const gamepad = createMockGamepad();
  const store = opts.store ?? new InputBindingsStore();
  const dispatcher = new DeviceInputDispatcher({
    keyboard,
    gamepad,
    bindings: store,
  });
  const manager = new InputBindingManager({
    dispatcher,
    slots: opts.slots,
    emitHold: opts.emitHold,
  });
  const events: PlayerActionEvent[] = [];
  manager.subscribe((e) => {
    events.push(e);
  });
  return { manager, dispatcher, keyboard, gamepad, store, events };
}

// ---------------------------------------------------------------------------
// Edge detection
// ---------------------------------------------------------------------------

describe('InputBindingManager — press / release edges', () => {
  it('emits a press event when an action transitions released → held', () => {
    const { manager, keyboard, events } = buildHarness();
    keyboard.press(KEY_CODE.W); // P1 jump + up
    const out = manager.poll(42);
    expect(events.map((e) => ({ kind: e.kind, slot: e.slot, action: e.action, frame: e.frame }))).toEqual(
      // `up` and `jump` both bind to W on P1 default — both fire on the same frame.
      [
        { kind: 'press', slot: 1, action: 'up', frame: 42 },
        { kind: 'press', slot: 1, action: 'jump', frame: 42 },
      ],
    );
    expect(out).toEqual(events);
  });

  it('emits a release event when an action transitions held → released', () => {
    const { manager, keyboard, events } = buildHarness();
    keyboard.press(KEY_CODE.F); // P1 attack
    manager.poll(0);
    events.length = 0;
    keyboard.release(KEY_CODE.F);
    manager.poll(1);
    expect(events).toEqual([
      { kind: 'release', slot: 1, action: 'attack', frame: 1 },
    ]);
  });

  it('does not emit a hold event by default for an action held across polls', () => {
    const { manager, keyboard, events } = buildHarness();
    keyboard.press(KEY_CODE.G); // P1 special
    manager.poll(0);
    const initial = events.length;
    manager.poll(1);
    manager.poll(2);
    expect(events.length).toBe(initial);
  });

  it('emits a hold event each poll while held when emitHold = true', () => {
    const { manager, keyboard, events } = buildHarness({ emitHold: true });
    keyboard.press(KEY_CODE.G); // P1 special
    manager.poll(0); // press
    manager.poll(1); // hold
    manager.poll(2); // hold
    keyboard.release(KEY_CODE.G);
    manager.poll(3); // release

    const filtered = events.filter((e) => e.action === 'special');
    expect(filtered.map((e) => ({ kind: e.kind, frame: e.frame }))).toEqual([
      { kind: 'press', frame: 0 },
      { kind: 'hold', frame: 1 },
      { kind: 'hold', frame: 2 },
      { kind: 'release', frame: 3 },
    ]);
  });

  it('frame defaults to -1 when poll() is called without a frame', () => {
    const { manager, keyboard, events } = buildHarness();
    keyboard.press(KEY_CODE.F);
    manager.poll();
    expect(events).toHaveLength(1);
    expect(events[0]?.frame).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Binding-driven dispatch (no hardcoded mappings)
// ---------------------------------------------------------------------------

describe('InputBindingManager — bindings-driven (no hardcoded mappings)', () => {
  it('routes events through the active binding profile, not raw keyCodes', () => {
    const { manager, keyboard, store, events } = buildHarness();
    // Default P1 attack is F. Verify, then rebind to SPACE and the SAME
    // physical key (F) should no longer fire attack on the next poll —
    // proving the manager doesn't carry a hardcoded F → attack table.
    keyboard.press(KEY_CODE.F);
    manager.poll(0);
    const initial = events.filter((e) => e.action === 'attack' && e.kind === 'press');
    expect(initial).toHaveLength(1);

    // Force a release first so we can re-press cleanly.
    keyboard.release(KEY_CODE.F);
    manager.poll(1);
    events.length = 0;

    // Rebind P1 attack: F → SPACE.
    store.setAction(1, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    keyboard.press(KEY_CODE.F);
    manager.poll(2);
    // F is no longer bound to anything for P1 — attack must NOT fire.
    expect(events.find((e) => e.action === 'attack')).toBeUndefined();

    // SPACE now fires attack — proves the manager picked up the rebind.
    keyboard.press(KEY_CODE.SPACE);
    manager.poll(3);
    expect(events.some((e) => e.action === 'attack' && e.kind === 'press' && e.frame === 3)).toBe(
      true,
    );
  });

  it('honours an empty binding list as deliberately unbound', () => {
    const { manager, keyboard, store, events } = buildHarness();
    store.setAction(1, 'taunt', []); // explicitly unbind
    keyboard.press(KEY_CODE.R); // default P1 taunt key
    manager.poll(0);
    expect(events.find((e) => e.action === 'taunt')).toBeUndefined();
  });

  it('translates gamepad button events into the same per-player action vocabulary', () => {
    const { manager, gamepad, events } = buildHarness();
    gamepad.connect(0); // slot 3 default pad
    // Default slot 3 jump = button 0.
    gamepad.setButton(0, 0, { pressed: true, value: 1 });
    manager.poll(0);
    expect(events).toEqual([
      { kind: 'press', slot: 3, action: 'jump', frame: 0 },
    ]);
  });

  it('translates gamepad half-axis stick deflection into directional press / release', () => {
    const { manager, gamepad, events } = buildHarness();
    gamepad.connect(0);
    // Push left stick X past the threshold to the right.
    gamepad.setAxis(0, 0, DEFAULT_GAMEPAD_AXIS_THRESHOLD + 0.1);
    manager.poll(0);
    expect(events.find((e) => e.action === 'right' && e.slot === 3 && e.kind === 'press')).toBeDefined();
    events.length = 0;
    // Recenter the stick.
    gamepad.setAxis(0, 0, 0);
    manager.poll(1);
    expect(events).toEqual([
      { kind: 'release', slot: 3, action: 'right', frame: 1 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Determinism + ordering
// ---------------------------------------------------------------------------

describe('InputBindingManager — deterministic ordering', () => {
  it('emits events in ascending slot order, then logical-action declaration order', () => {
    const { manager, keyboard, events } = buildHarness();
    // Press P2 attack (Numpad-1) AND P1 jump (W) on the same poll.
    keyboard.press(KEY_CODE.W);
    keyboard.press(KEY_CODE.NUMPAD_1);
    manager.poll(0);
    // Expected order: slot 1 (W → up, then jump in LOGICAL_ACTIONS order)
    // before slot 2 (Numpad-1 → attack).
    expect(events.map((e) => ({ slot: e.slot, action: e.action }))).toEqual([
      { slot: 1, action: 'up' },
      { slot: 1, action: 'jump' },
      { slot: 2, action: 'attack' },
    ]);
  });

  it('produces the same event sequence for two identical poll runs', () => {
    function run(): PlayerActionEvent[] {
      const { manager, keyboard, events } = buildHarness();
      keyboard.press(KEY_CODE.W, KEY_CODE.F);
      manager.poll(7);
      keyboard.release(KEY_CODE.F);
      manager.poll(8);
      return events;
    }
    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Slot filtering
// ---------------------------------------------------------------------------

describe('InputBindingManager — slot filtering', () => {
  it('skips event emission for slots not in the tracked set', () => {
    const { manager, keyboard, gamepad, events } = buildHarness({ slots: [1, 2] });
    gamepad.connect(0); // slot 3 pad
    gamepad.setButton(0, 0, { pressed: true, value: 1 });
    keyboard.press(KEY_CODE.W); // P1 up + jump
    manager.poll(0);
    // No slot-3 event should appear.
    expect(events.every((e) => e.slot === 1 || e.slot === 2)).toBe(true);
    expect(events.some((e) => e.slot === 1 && e.action === 'jump')).toBe(true);
  });

  it('returns NEUTRAL_ACTION_MAP-shaped sample for an untracked slot', () => {
    const { manager } = buildHarness({ slots: [1] });
    const sample = manager.getLastSample(3);
    expect(Object.values(sample).every((v) => v === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Subscription lifecycle
// ---------------------------------------------------------------------------

describe('InputBindingManager — subscription lifecycle', () => {
  it('detaches a subscriber when the disposer is called', () => {
    const { manager, keyboard } = buildHarness();
    const seen: PlayerActionEvent[] = [];
    const off = manager.subscribe((e) => {
      seen.push(e);
    });
    keyboard.press(KEY_CODE.F);
    manager.poll(0);
    expect(seen).toHaveLength(1);
    off();
    keyboard.release(KEY_CODE.F);
    manager.poll(1);
    expect(seen).toHaveLength(1); // still one — listener detached before the release fired
  });

  it('one listener throwing does not prevent siblings from receiving the event', () => {
    const { manager, keyboard } = buildHarness();
    let sibling = 0;
    manager.subscribe(() => {
      throw new Error('boom');
    });
    manager.subscribe(() => {
      sibling += 1;
    });
    keyboard.press(KEY_CODE.F);
    expect(() => manager.poll(0)).toThrow('boom');
    expect(sibling).toBe(1);
  });

  it('listenerCount tracks subscribe / unsubscribe / dispose', () => {
    const { manager } = buildHarness();
    expect(manager.listenerCount).toBe(1); // harness adds one
    const off = manager.subscribe(() => {
      /* no-op */
    });
    expect(manager.listenerCount).toBe(2);
    off();
    expect(manager.listenerCount).toBe(1);
    manager.dispose();
    expect(manager.listenerCount).toBe(0);
    expect(manager.isDisposed).toBe(true);
  });

  it('dispose() makes subsequent poll() a no-op', () => {
    const { manager, keyboard, events } = buildHarness();
    manager.dispose();
    keyboard.press(KEY_CODE.F);
    const out = manager.poll(0);
    expect(out).toEqual([]);
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// forceRelease
// ---------------------------------------------------------------------------

describe('InputBindingManager — forceRelease', () => {
  it('emits a release event for every currently-held action and resets state', () => {
    const { manager, keyboard, events } = buildHarness();
    keyboard.press(KEY_CODE.W, KEY_CODE.F); // P1 up + jump + attack
    manager.poll(0);
    events.length = 0;
    const released = manager.forceRelease(99);
    // All three actions release.
    expect(released.map((e) => e.action).sort()).toEqual(['attack', 'jump', 'up']);
    for (const e of released) {
      expect(e.kind).toBe('release');
      expect(e.frame).toBe(99);
    }
    // Subsequent poll with the keys still held re-emits a press
    // (because the snapshot was reset to neutral by forceRelease).
    events.length = 0;
    manager.poll(100);
    expect(events.every((e) => e.kind === 'press')).toBe(true);
  });

  it('is a no-op when nothing is held', () => {
    const { manager } = buildHarness();
    expect(manager.forceRelease(0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Convenience reads
// ---------------------------------------------------------------------------

describe('InputBindingManager — sample reads', () => {
  it('wasHeldLastPoll mirrors the most recent poll snapshot', () => {
    const { manager, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.F);
    manager.poll(0);
    expect(manager.wasHeldLastPoll(1, 'attack')).toBe(true);
    expect(manager.wasHeldLastPoll(1, 'jump')).toBe(false);
  });

  it('isActionHeld reflects live dispatcher state without advancing snapshot', () => {
    const { manager, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.F);
    expect(manager.isActionHeld(1, 'attack')).toBe(true);
    // No poll() has run yet, so the snapshot is still neutral.
    expect(manager.wasHeldLastPoll(1, 'attack')).toBe(false);
  });

  it('getLastSample returns a frozen copy that cannot mutate internal state', () => {
    const { manager, keyboard } = buildHarness();
    keyboard.press(KEY_CODE.F);
    manager.poll(0);
    const snap = manager.getLastSample(1);
    expect(snap.attack).toBe(true);
    expect(() => {
      // @ts-expect-error — runtime check that the returned record is frozen.
      snap.attack = false;
    }).toThrow();
    // Internal snapshot still reads true.
    expect(manager.wasHeldLastPoll(1, 'attack')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PlayerBindings live mutation
// ---------------------------------------------------------------------------

describe('InputBindingManager — store mutation mid-session', () => {
  it('replacing the entire PlayerBindings via store.set takes effect on next poll', () => {
    const store = new InputBindingsStore();
    const { manager, keyboard, events } = buildHarness({ store });
    keyboard.press(KEY_CODE.F);
    manager.poll(0); // press attack on default
    expect(events.some((e) => e.action === 'attack' && e.kind === 'press')).toBe(true);
    keyboard.release(KEY_CODE.F);
    manager.poll(1); // release attack
    events.length = 0;

    // Build a brand-new full PlayerBindings with attack moved to SPACE.
    const next: PlayerBindings = {
      playerIndex: 1,
      bindings: {
        ...store.get(1).bindings,
        attack: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }],
      },
    };
    store.set(1, next);

    keyboard.press(KEY_CODE.F);
    manager.poll(2);
    expect(events.find((e) => e.action === 'attack')).toBeUndefined();

    keyboard.press(KEY_CODE.SPACE);
    manager.poll(3);
    expect(events.some((e) => e.action === 'attack' && e.kind === 'press')).toBe(true);
  });
});
