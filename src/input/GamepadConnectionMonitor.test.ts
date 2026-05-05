import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_PLAYER_SLOTS,
  GamepadConnectionMonitor,
  findSlotsBoundToGamepad,
  isPlayerBoundToGamepad,
  resolveDefaultGamepadEventTarget,
  type GamepadEventTargetLike,
  type GamepadConnectEvent,
  type GamepadDisconnectEvent,
} from './GamepadConnectionMonitor';
import {
  DEFAULT_PLAYER_BINDINGS,
  InputBindingsStore,
  buildDefaultGamepadBindings,
} from './InputBindingsStore';
import type {
  GamepadBinding,
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';

/**
 * AC 14 Sub-AC 1 — controller-disconnect detection.
 *
 * Locks down:
 *
 *   1. Pure helper — `findSlotsBoundToGamepad` returns the slots whose
 *      bindings reference the disconnected pad index, in ascending order,
 *      excluding "any pad" (`gamepadIndex: null`) bindings and keyboard
 *      bindings.
 *   2. Browser event wiring — a `gamepaddisconnected` event delivered to
 *      the injected event target fans out to every disconnect listener
 *      with the correct `affectedSlots`, `gamepadIndex`, and `gamepadId`.
 *   3. Reconnect path — `gamepadconnected` fires `onConnect` listeners
 *      with the same shape, and the monitor remembers the pad's `id` so
 *      a later disconnect that omits the id still surfaces it.
 *   4. Lifecycle — `start()` and `stop()` are idempotent, listeners are
 *      detached cleanly on `stop()`, no event target makes both calls
 *      no-op without throwing.
 *   5. Listener-error isolation — a throwing subscriber doesn't silence
 *      the others or leave the monitor in a half-fired state.
 *   6. Live store integration — rebinding a slot to a different pad
 *      between events flips the affected-slot list on the next event.
 *   7. `emitDisconnect` / `emitConnect` programmatic helpers behave
 *      identically to the browser path.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

class MockEventTarget implements GamepadEventTargetLike {
  readonly listeners: Map<string, Set<(event: GamepadEvent) => void>> = new Map();

  addEventListener(
    type: 'gamepadconnected' | 'gamepaddisconnected',
    listener: (event: GamepadEvent) => void,
  ): void {
    let bucket = this.listeners.get(type);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(type, bucket);
    }
    bucket.add(listener);
  }

  removeEventListener(
    type: 'gamepadconnected' | 'gamepaddisconnected',
    listener: (event: GamepadEvent) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: 'gamepadconnected' | 'gamepaddisconnected', event: GamepadEvent): void {
    const bucket = this.listeners.get(type);
    if (!bucket) return;
    for (const fn of Array.from(bucket)) fn(event);
  }

  countListeners(type: 'gamepadconnected' | 'gamepaddisconnected'): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

interface MockGamepadEventInit {
  readonly index: number;
  readonly id?: string;
  readonly timeStamp?: number;
}

function makeGamepadEvent(init: MockGamepadEventInit): GamepadEvent {
  // Synthesise a minimal {@link GamepadEvent} — we only access
  // `event.gamepad.index`, `event.gamepad.id`, and `event.timeStamp`.
  return {
    gamepad: {
      index: init.index,
      id: init.id ?? `pad-${init.index}`,
      connected: true,
      mapping: 'standard',
      timestamp: init.timeStamp ?? 0,
      axes: [],
      buttons: [],
      hapticActuators: [],
      vibrationActuator: null,
    } as unknown as Gamepad,
    timeStamp: init.timeStamp ?? 0,
  } as unknown as GamepadEvent;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('isPlayerBoundToGamepad', () => {
  it('returns true when any binding references the given pad index', () => {
    const profile: PlayerBindings = DEFAULT_PLAYER_BINDINGS[3]; // pad index 0
    expect(isPlayerBoundToGamepad(profile, 0)).toBe(true);
    expect(isPlayerBoundToGamepad(profile, 1)).toBe(false);
  });

  it('returns false for keyboard-only profiles regardless of index', () => {
    const profile: PlayerBindings = DEFAULT_PLAYER_BINDINGS[1];
    expect(isPlayerBoundToGamepad(profile, 0)).toBe(false);
    expect(isPlayerBoundToGamepad(profile, 99)).toBe(false);
  });

  it('does NOT match `gamepadIndex: null` ("any pad") bindings', () => {
    const anyPadBinding: GamepadBinding = Object.freeze({
      kind: 'gamepad',
      gamepadIndex: null,
      source: Object.freeze({ type: 'button', buttonIndex: 0 }),
    });
    const profile: PlayerBindings = Object.freeze<PlayerBindings>({
      playerIndex: 1,
      bindings: Object.freeze({
        ...DEFAULT_PLAYER_BINDINGS[1].bindings,
        jump: Object.freeze([anyPadBinding]),
      }),
    });
    expect(isPlayerBoundToGamepad(profile, 0)).toBe(false);
    expect(isPlayerBoundToGamepad(profile, 7)).toBe(false);
  });

  it('matches a layered keyboard+gamepad slot', () => {
    const padBinding: GamepadBinding = Object.freeze({
      kind: 'gamepad',
      gamepadIndex: 2,
      source: Object.freeze({ type: 'button', buttonIndex: 4 }),
    });
    const profile: PlayerBindings = Object.freeze<PlayerBindings>({
      playerIndex: 1,
      bindings: Object.freeze({
        ...DEFAULT_PLAYER_BINDINGS[1].bindings,
        attack: Object.freeze([
          ...DEFAULT_PLAYER_BINDINGS[1].bindings.attack,
          padBinding,
        ]),
      }),
    });
    expect(isPlayerBoundToGamepad(profile, 2)).toBe(true);
    expect(isPlayerBoundToGamepad(profile, 0)).toBe(false);
  });
});

describe('findSlotsBoundToGamepad', () => {
  it('returns slot 3 for pad 0 and slot 4 for pad 1 with default bindings', () => {
    const store = new InputBindingsStore();
    expect(findSlotsBoundToGamepad(store, 0)).toEqual([3]);
    expect(findSlotsBoundToGamepad(store, 1)).toEqual([4]);
  });

  it('returns multiple slots when several bindings share a pad index', () => {
    const store = new InputBindingsStore({
      overrides: {
        2: { playerIndex: 2, bindings: buildDefaultGamepadBindings(0) },
      },
    });
    // Both slot 2 (override) and slot 3 (default) are bound to pad 0.
    expect(findSlotsBoundToGamepad(store, 0)).toEqual([2, 3]);
  });

  it('returns an empty list when no slot is bound to the index', () => {
    const store = new InputBindingsStore();
    expect(findSlotsBoundToGamepad(store, 7)).toEqual([]);
  });

  it('rejects negative or non-integer pad indices with an empty list (no throw)', () => {
    const store = new InputBindingsStore();
    expect(findSlotsBoundToGamepad(store, -1)).toEqual([]);
    expect(findSlotsBoundToGamepad(store, 0.5)).toEqual([]);
    expect(findSlotsBoundToGamepad(store, NaN)).toEqual([]);
  });

  it('returns a frozen array', () => {
    const store = new InputBindingsStore();
    const result = findSlotsBoundToGamepad(store, 0) as PlayerBindingsIndex[];
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('honours a custom slot iteration order', () => {
    const store = new InputBindingsStore({
      overrides: {
        2: { playerIndex: 2, bindings: buildDefaultGamepadBindings(0) },
      },
    });
    // Reverse iteration → slot 3 first, then slot 2.
    const result = findSlotsBoundToGamepad(store, 0, [4, 3, 2, 1] as const);
    expect(result).toEqual([3, 2]);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('GamepadConnectionMonitor lifecycle', () => {
  it('start() then stop() attaches and detaches listeners exactly once', () => {
    const target = new MockEventTarget();
    const store = new InputBindingsStore();
    const monitor = new GamepadConnectionMonitor({ bindings: store, eventTarget: target });

    expect(monitor.isStarted()).toBe(false);
    expect(target.countListeners('gamepadconnected')).toBe(0);

    monitor.start();
    expect(monitor.isStarted()).toBe(true);
    expect(target.countListeners('gamepadconnected')).toBe(1);
    expect(target.countListeners('gamepaddisconnected')).toBe(1);

    // Idempotent.
    monitor.start();
    expect(target.countListeners('gamepadconnected')).toBe(1);

    monitor.stop();
    expect(monitor.isStarted()).toBe(false);
    expect(target.countListeners('gamepadconnected')).toBe(0);
    expect(target.countListeners('gamepaddisconnected')).toBe(0);

    // Idempotent again.
    monitor.stop();
    expect(target.countListeners('gamepadconnected')).toBe(0);
  });

  it('start() with eventTarget=null marks started without throwing', () => {
    const store = new InputBindingsStore();
    const monitor = new GamepadConnectionMonitor({ bindings: store, eventTarget: null });
    expect(() => monitor.start()).not.toThrow();
    expect(monitor.isStarted()).toBe(true);
    monitor.stop();
    expect(monitor.isStarted()).toBe(false);
  });

  it('throws if options.bindings is omitted', () => {
    expect(
      () =>
        new GamepadConnectionMonitor(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {} as any,
        ),
    ).toThrow(/bindings is required/);
  });
});

// ---------------------------------------------------------------------------
// Disconnect path
// ---------------------------------------------------------------------------

describe('GamepadConnectionMonitor disconnect path', () => {
  let target: MockEventTarget;
  let store: InputBindingsStore;
  let monitor: GamepadConnectionMonitor;
  let received: GamepadDisconnectEvent[];

  beforeEach(() => {
    target = new MockEventTarget();
    store = new InputBindingsStore();
    monitor = new GamepadConnectionMonitor({ bindings: store, eventTarget: target });
    received = [];
    monitor.onDisconnect((e) => {
      received.push(e);
    });
    monitor.start();
  });

  afterEach(() => {
    monitor.stop();
  });

  it('reports the correct affected slot for a default-bindings pad disconnect', () => {
    target.dispatch(
      'gamepaddisconnected',
      makeGamepadEvent({ index: 0, id: 'Xbox 360 Controller', timeStamp: 1234.5 }),
    );

    expect(received).toHaveLength(1);
    const event = received[0]!;
    expect(event.gamepadIndex).toBe(0);
    expect(event.gamepadId).toBe('Xbox 360 Controller');
    expect(event.timestamp).toBe(1234.5);
    expect(event.affectedSlots).toEqual([3]);
    expect(Object.isFrozen(event)).toBe(true);
  });

  it('reports an empty affected list when the disconnected pad maps to no slot', () => {
    target.dispatch('gamepaddisconnected', makeGamepadEvent({ index: 7 }));
    expect(received).toHaveLength(1);
    expect(received[0]!.affectedSlots).toEqual([]);
  });

  it('reports multiple slots in ascending order when several share the pad index', () => {
    store.set(2, { playerIndex: 2, bindings: buildDefaultGamepadBindings(0) });
    target.dispatch('gamepaddisconnected', makeGamepadEvent({ index: 0 }));
    expect(received[0]!.affectedSlots).toEqual([2, 3]);
  });

  it('falls back to the last seen pad id when the disconnect event omits one', () => {
    target.dispatch(
      'gamepadconnected',
      makeGamepadEvent({ index: 0, id: 'DualShock 4', timeStamp: 100 }),
    );
    target.dispatch(
      'gamepaddisconnected',
      makeGamepadEvent({ index: 0, id: '', timeStamp: 200 }),
    );

    expect(received).toHaveLength(1);
    expect(received[0]!.gamepadId).toBe('DualShock 4');
  });

  it('does not fire after stop()', () => {
    monitor.stop();
    target.dispatch('gamepaddisconnected', makeGamepadEvent({ index: 0 }));
    expect(received).toHaveLength(0);
  });

  it('reflects live store mutations between events', () => {
    target.dispatch('gamepaddisconnected', makeGamepadEvent({ index: 0 }));
    expect(received[0]!.affectedSlots).toEqual([3]);

    // Move slot 3 onto pad 1 — pad 0 now affects nobody.
    store.set(3, { playerIndex: 3, bindings: buildDefaultGamepadBindings(1) });

    target.dispatch('gamepaddisconnected', makeGamepadEvent({ index: 0 }));
    expect(received[1]!.affectedSlots).toEqual([]);

    target.dispatch('gamepaddisconnected', makeGamepadEvent({ index: 1 }));
    // Slot 3 (now on pad 1) and slot 4 (default on pad 1) both affected.
    expect(received[2]!.affectedSlots).toEqual([3, 4]);
  });

  it('isolates listener errors so other listeners still fire', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const second: GamepadDisconnectEvent[] = [];
    monitor.onDisconnect(() => {
      throw new Error('boom');
    });
    monitor.onDisconnect((e) => {
      second.push(e);
    });

    target.dispatch('gamepaddisconnected', makeGamepadEvent({ index: 0 }));

    expect(received).toHaveLength(1); // first listener (set up in beforeEach)
    expect(second).toHaveLength(1);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('lets a listener unsubscribe itself mid-fire without affecting siblings', () => {
    const order: string[] = [];
    const unsub = monitor.onDisconnect(() => {
      order.push('a');
      unsub();
    });
    monitor.onDisconnect(() => {
      order.push('b');
    });

    target.dispatch('gamepaddisconnected', makeGamepadEvent({ index: 0 }));
    expect(order).toEqual(['a', 'b']);

    target.dispatch('gamepaddisconnected', makeGamepadEvent({ index: 0 }));
    expect(order).toEqual(['a', 'b', 'b']);
  });
});

// ---------------------------------------------------------------------------
// Connect path
// ---------------------------------------------------------------------------

describe('GamepadConnectionMonitor connect path', () => {
  it('fires onConnect listeners with the affected slots for a (re)connect', () => {
    const target = new MockEventTarget();
    const store = new InputBindingsStore();
    const monitor = new GamepadConnectionMonitor({ bindings: store, eventTarget: target });
    const received: GamepadConnectEvent[] = [];
    monitor.onConnect((e) => received.push(e));
    monitor.start();

    target.dispatch(
      'gamepadconnected',
      makeGamepadEvent({ index: 1, id: 'Pro Controller', timeStamp: 42 }),
    );

    expect(received).toHaveLength(1);
    expect(received[0]!.gamepadIndex).toBe(1);
    expect(received[0]!.gamepadId).toBe('Pro Controller');
    expect(received[0]!.timestamp).toBe(42);
    expect(received[0]!.affectedSlots).toEqual([4]);
    expect(monitor.getLastKnownGamepadId(1)).toBe('Pro Controller');
  });

  it('forgets the pad id after a disconnect', () => {
    const target = new MockEventTarget();
    const store = new InputBindingsStore();
    const monitor = new GamepadConnectionMonitor({ bindings: store, eventTarget: target });
    monitor.start();

    target.dispatch('gamepadconnected', makeGamepadEvent({ index: 0, id: 'A' }));
    expect(monitor.getLastKnownGamepadId(0)).toBe('A');

    target.dispatch('gamepaddisconnected', makeGamepadEvent({ index: 0, id: 'A' }));
    expect(monitor.getLastKnownGamepadId(0)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Programmatic helpers
// ---------------------------------------------------------------------------

describe('GamepadConnectionMonitor programmatic helpers', () => {
  it('emitDisconnect fans out the same payload as the browser path', () => {
    const store = new InputBindingsStore();
    const monitor = new GamepadConnectionMonitor({ bindings: store, eventTarget: null });
    const received: GamepadDisconnectEvent[] = [];
    monitor.onDisconnect((e) => received.push(e));
    monitor.start();

    const result = monitor.emitDisconnect(0, { gamepadId: 'Test Pad', timestamp: 9 });
    expect(received).toEqual([result]);
    expect(result.affectedSlots).toEqual([3]);
    expect(result.gamepadId).toBe('Test Pad');
    expect(result.timestamp).toBe(9);
  });

  it('emitConnect updates the last-seen id cache and fires listeners', () => {
    const store = new InputBindingsStore();
    const monitor = new GamepadConnectionMonitor({ bindings: store, eventTarget: null });
    const received: GamepadConnectEvent[] = [];
    monitor.onConnect((e) => received.push(e));

    monitor.emitConnect(1, { gamepadId: 'Pad B', timestamp: 5 });
    expect(received).toHaveLength(1);
    expect(received[0]!.gamepadIndex).toBe(1);
    expect(monitor.getLastKnownGamepadId(1)).toBe('Pad B');
  });

  it('getAffectedSlots delegates to the bindings provider', () => {
    const store = new InputBindingsStore();
    const monitor = new GamepadConnectionMonitor({ bindings: store, eventTarget: null });
    expect(monitor.getAffectedSlots(0)).toEqual([3]);
    expect(monitor.getAffectedSlots(1)).toEqual([4]);
    expect(monitor.getAffectedSlots(99)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Default event target resolution
// ---------------------------------------------------------------------------

describe('resolveDefaultGamepadEventTarget', () => {
  const original = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (original === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = original;
    }
  });

  it('returns null in environments without window', () => {
    delete (globalThis as { window?: unknown }).window;
    expect(resolveDefaultGamepadEventTarget()).toBeNull();
  });

  it('returns the global window when it has the listener API', () => {
    const fake = {
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    (globalThis as { window?: unknown }).window = fake;
    expect(resolveDefaultGamepadEventTarget()).toBe(fake);
  });

  it('returns null when window lacks the listener API', () => {
    (globalThis as { window?: unknown }).window = { foo: 1 };
    expect(resolveDefaultGamepadEventTarget()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sanity — shared constant
// ---------------------------------------------------------------------------

describe('ALL_PLAYER_SLOTS', () => {
  it('is the canonical 1..4 list and is frozen', () => {
    expect(ALL_PLAYER_SLOTS).toEqual([1, 2, 3, 4]);
    expect(Object.isFrozen(ALL_PLAYER_SLOTS)).toBe(true);
  });
});
