import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_AXIS_DEADZONE,
  DEFAULT_MAX_GAMEPAD_INDEX,
  KEYBOARD_DEVICE_SOURCE,
  RawInputSource,
  createBrowserKeyboardEventTarget,
  gamepadDeviceSource,
  type KeyboardEventLike,
  type RawInputEvent,
  type RawInputListener,
  type RawKeyboardEventTarget,
} from './RawInputSource';
import type {
  GamepadButtonState,
  GamepadSource,
} from './DeviceInputDispatcher';
import { KEY_CODE } from './keyCodes';

/**
 * AC 50101 Sub-AC 1 — raw input source.
 *
 * Locks down:
 *
 *   1. Keyboard path — keydown / keyup events fired on the configured
 *      target are normalised into RawKeyDown / RawKeyUp events with
 *      `{ kind: 'keyboard' }` source attribution and the legacy keyCode.
 *   2. Gamepad path — `poll()` diffs the snapshot maps and emits
 *      buttondown / buttonup / axischange events with the pad index
 *      attached to the source.
 *   3. Player-source attribution — every event carries a
 *      `RawInputDeviceSource`. Keyboard events identify keyboard,
 *      gamepad events identify the pad index. The descriptor for one
 *      pad index is stable across emissions (no per-event allocation).
 *   4. Frame stamping — `poll(frame)` updates the source's frame counter,
 *      keyboard events fired between polls inherit the current frame.
 *   5. Subscription lifecycle — `addListener` returns an unsubscribe,
 *      `destroy` detaches keyboard listeners and stops emission.
 *   6. Listener error isolation — a thrown exception inside one
 *      listener does not break the dispatch loop for siblings.
 *   7. Disconnect handling — when a pad transitions to `isConnected
 *      === false`, the source clears its snapshot for that pad so a
 *      subsequent reconnect at the same index does not generate
 *      phantom released-edge events.
 *   8. Deadzone — axis movements smaller than the configured deadzone
 *      do NOT fire; movements larger than it do fire; crossing zero
 *      always fires.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface MockKeyboardTarget extends RawKeyboardEventTarget {
  fire(type: 'keydown' | 'keyup', payload: KeyboardEventLike): void;
  listenerCount(type: 'keydown' | 'keyup'): number;
}

function createMockKeyboardTarget(): MockKeyboardTarget {
  const listeners = {
    keydown: new Set<(event: KeyboardEventLike) => void>(),
    keyup: new Set<(event: KeyboardEventLike) => void>(),
  };
  return {
    addEventListener(type, listener): void {
      listeners[type].add(listener);
    },
    removeEventListener(type, listener): void {
      listeners[type].delete(listener);
    },
    fire(type, payload): void {
      // Snapshot to avoid mutation during iteration.
      for (const fn of Array.from(listeners[type])) fn(payload);
    },
    listenerCount(type): number {
      return listeners[type].size;
    },
  };
}

interface MockGamepad extends GamepadSource {
  connect(index: number): void;
  disconnect(index: number): void;
  setButton(index: number, button: number, state: GamepadButtonState): void;
  setAxis(index: number, axis: number, value: number): void;
  reset(): void;
}

function createMockGamepad(): MockGamepad {
  const connected = new Set<number>();
  const buttons = new Map<string, GamepadButtonState>();
  const axes = new Map<string, number>();
  const NEUTRAL: GamepadButtonState = Object.freeze({ pressed: false, value: 0 });
  const key = (i: number, j: number) => `${i}:${j}`;
  return {
    isConnected(index): boolean {
      return connected.has(index);
    },
    getButton(index, button): GamepadButtonState {
      return buttons.get(key(index, button)) ?? NEUTRAL;
    },
    getAxis(index, axis): number {
      return axes.get(key(index, axis)) ?? 0;
    },
    connect(index): void {
      connected.add(index);
    },
    disconnect(index): void {
      connected.delete(index);
    },
    setButton(index, button, state): void {
      buttons.set(key(index, button), state);
    },
    setAxis(index, axis, value): void {
      axes.set(key(index, axis), value);
    },
    reset(): void {
      connected.clear();
      buttons.clear();
      axes.clear();
    },
  };
}

function recorder(): { events: RawInputEvent[]; listener: RawInputListener } {
  const events: RawInputEvent[] = [];
  return {
    events,
    listener: (event) => {
      events.push(event);
    },
  };
}

// ---------------------------------------------------------------------------
// Cleanup — every test that constructs a RawInputSource registers it here so
// destroy() runs deterministically even when an assertion fails midway.
// ---------------------------------------------------------------------------

const liveSources: RawInputSource[] = [];
function track(source: RawInputSource): RawInputSource {
  liveSources.push(source);
  return source;
}
afterEach(() => {
  for (const s of liveSources) s.destroy();
  liveSources.length = 0;
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('RawInputSource — constants', () => {
  it('exposes a frozen keyboard source descriptor', () => {
    expect(KEYBOARD_DEVICE_SOURCE.kind).toBe('keyboard');
    expect(Object.isFrozen(KEYBOARD_DEVICE_SOURCE)).toBe(true);
  });

  it('memoises gamepadDeviceSource(index) so repeated lookups return the same object', () => {
    const a = gamepadDeviceSource(2);
    const b = gamepadDeviceSource(2);
    expect(a).toBe(b);
    expect(a.kind).toBe('gamepad');
    if (a.kind === 'gamepad') expect(a.index).toBe(2);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('publishes the documented defaults', () => {
    expect(DEFAULT_AXIS_DEADZONE).toBeGreaterThan(0);
    expect(DEFAULT_AXIS_DEADZONE).toBeLessThan(1);
    expect(DEFAULT_MAX_GAMEPAD_INDEX).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Keyboard path
// ---------------------------------------------------------------------------

describe('RawInputSource — keyboard events', () => {
  it('emits a keydown event with the keyCode and a keyboard-source descriptor', () => {
    const target = createMockKeyboardTarget();
    const source = track(new RawInputSource({ keyboardTarget: target }));
    const rec = recorder();
    source.addListener(rec.listener);

    target.fire('keydown', { keyCode: KEY_CODE.W, repeat: false, timeStamp: 100 });

    expect(rec.events).toHaveLength(1);
    const e = rec.events[0]!;
    expect(e.kind).toBe('keydown');
    expect(e.source.kind).toBe('keyboard');
    if (e.kind === 'keydown') {
      expect(e.keyCode).toBe(KEY_CODE.W);
      expect(e.repeat).toBe(false);
      expect(e.timestamp).toBe(100);
    }
  });

  it('emits a keyup event with the keyCode', () => {
    const target = createMockKeyboardTarget();
    const source = track(new RawInputSource({ keyboardTarget: target }));
    const rec = recorder();
    source.addListener(rec.listener);

    target.fire('keyup', { keyCode: KEY_CODE.SPACE, timeStamp: 250 });

    expect(rec.events).toHaveLength(1);
    expect(rec.events[0]!.kind).toBe('keyup');
    if (rec.events[0]!.kind === 'keyup') {
      expect(rec.events[0]!.keyCode).toBe(KEY_CODE.SPACE);
    }
  });

  it('forwards the OS auto-repeat flag without filtering', () => {
    const target = createMockKeyboardTarget();
    const source = track(new RawInputSource({ keyboardTarget: target }));
    const rec = recorder();
    source.addListener(rec.listener);

    target.fire('keydown', { keyCode: KEY_CODE.A, repeat: true, timeStamp: 0 });
    target.fire('keydown', { keyCode: KEY_CODE.A, repeat: false, timeStamp: 0 });

    expect(rec.events).toHaveLength(2);
    if (rec.events[0]!.kind === 'keydown') expect(rec.events[0]!.repeat).toBe(true);
    if (rec.events[1]!.kind === 'keydown') expect(rec.events[1]!.repeat).toBe(false);
  });

  it('falls back to performance.now() when timeStamp is missing', () => {
    const target = createMockKeyboardTarget();
    const source = track(new RawInputSource({ keyboardTarget: target }));
    const rec = recorder();
    source.addListener(rec.listener);

    target.fire('keydown', { keyCode: KEY_CODE.D });

    expect(rec.events).toHaveLength(1);
    const e = rec.events[0]!;
    expect(typeof e.timestamp).toBe('number');
    expect(Number.isFinite(e.timestamp)).toBe(true);
  });

  it('stops emitting after destroy() and detaches from the target', () => {
    const target = createMockKeyboardTarget();
    const source = new RawInputSource({ keyboardTarget: target });
    const rec = recorder();
    source.addListener(rec.listener);

    expect(target.listenerCount('keydown')).toBe(1);
    expect(target.listenerCount('keyup')).toBe(1);

    source.destroy();
    expect(source.isDestroyed()).toBe(true);
    expect(target.listenerCount('keydown')).toBe(0);
    expect(target.listenerCount('keyup')).toBe(0);

    target.fire('keydown', { keyCode: KEY_CODE.W });
    expect(rec.events).toHaveLength(0);
  });

  it('survives the keyboard target being null (gamepad-only mode)', () => {
    const source = track(new RawInputSource({ keyboardTarget: null }));
    const rec = recorder();
    source.addListener(rec.listener);
    // No throw, no listeners attached anywhere.
    source.poll(7);
    expect(rec.events).toHaveLength(0);
    expect(source.getFrame()).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Gamepad path
// ---------------------------------------------------------------------------

describe('RawInputSource — gamepad events', () => {
  it('emits buttondown when a connected pad transitions a button to held', () => {
    const gamepad = createMockGamepad();
    gamepad.connect(0);
    const source = track(new RawInputSource({ gamepad }));
    const rec = recorder();
    source.addListener(rec.listener);

    // First poll seeds the snapshot — no events because the previous
    // state is "unknown" and the current state is "released" (the
    // mock returns released-by-default), so no transition.
    source.poll(0);
    expect(rec.events).toHaveLength(0);

    gamepad.setButton(0, 0, { pressed: true, value: 1 });
    source.poll(1);

    expect(rec.events).toHaveLength(1);
    const e = rec.events[0]!;
    expect(e.kind).toBe('buttondown');
    expect(e.source.kind).toBe('gamepad');
    if (e.kind === 'buttondown') {
      expect(e.source.index).toBe(0);
      expect(e.buttonIndex).toBe(0);
      expect(e.value).toBe(1);
      expect(e.frame).toBe(1);
    }
  });

  it('emits buttonup when a held button releases', () => {
    const gamepad = createMockGamepad();
    gamepad.connect(0);
    gamepad.setButton(0, 1, { pressed: true, value: 1 });
    const source = track(new RawInputSource({ gamepad }));
    const rec = recorder();
    source.addListener(rec.listener);

    source.poll(1); // initial snapshot: button 1 was unknown→pressed.
    expect(rec.events.filter((e) => e.kind === 'buttondown')).toHaveLength(1);

    gamepad.setButton(0, 1, { pressed: false, value: 0 });
    source.poll(2);

    const ups = rec.events.filter((e) => e.kind === 'buttonup');
    expect(ups).toHaveLength(1);
    if (ups[0]!.kind === 'buttonup') {
      expect(ups[0]!.buttonIndex).toBe(1);
      expect(ups[0]!.frame).toBe(2);
    }
  });

  it('emits axischange when an axis moves past the deadzone', () => {
    const gamepad = createMockGamepad();
    gamepad.connect(0);
    const source = track(
      new RawInputSource({ gamepad, axisDeadzone: 0.1 }),
    );
    const rec = recorder();
    source.addListener(rec.listener);

    source.poll(0); // baseline at 0
    rec.events.length = 0;

    // Tiny jitter — should be filtered.
    gamepad.setAxis(0, 0, 0.05);
    source.poll(1);
    expect(rec.events).toHaveLength(0);

    // Larger movement — should fire.
    gamepad.setAxis(0, 0, 0.6);
    source.poll(2);
    expect(rec.events).toHaveLength(1);
    const e = rec.events[0]!;
    expect(e.kind).toBe('axischange');
    if (e.kind === 'axischange') {
      expect(e.source.kind).toBe('gamepad');
      if (e.source.kind === 'gamepad') expect(e.source.index).toBe(0);
      expect(e.axisIndex).toBe(0);
      expect(e.value).toBeCloseTo(0.6);
      expect(e.previousValue).toBeCloseTo(0);
    }
  });

  it('emits axischange across a sign-flipping deflection (push → opposite push)', () => {
    const gamepad = createMockGamepad();
    gamepad.connect(0);
    const source = track(
      new RawInputSource({ gamepad, axisDeadzone: 0.1 }),
    );
    const rec = recorder();
    source.addListener(rec.listener);

    // Baseline +0.6 — first observation crosses the deadzone, fires.
    gamepad.setAxis(0, 1, 0.6);
    source.poll(1);
    expect(rec.events).toHaveLength(1);
    if (rec.events[0]!.kind === 'axischange') {
      expect(rec.events[0]!.previousValue).toBe(0);
      expect(rec.events[0]!.value).toBeCloseTo(0.6);
    }
    rec.events.length = 0;

    // Now snap to -0.6 — same axis pushed the opposite way. Delta 1.2
    // clears the deadzone trivially and the half-axis binding layer
    // sees the sign flip via `value` and `previousValue`.
    gamepad.setAxis(0, 1, -0.6);
    source.poll(2);
    expect(rec.events).toHaveLength(1);
    if (rec.events[0]!.kind === 'axischange') {
      expect(rec.events[0]!.previousValue).toBeCloseTo(0.6);
      expect(rec.events[0]!.value).toBeCloseTo(-0.6);
    }
  });

  it('does not fire axischange while the stick idles below the deadzone', () => {
    const gamepad = createMockGamepad();
    gamepad.connect(0);
    const source = track(
      new RawInputSource({ gamepad, axisDeadzone: 0.1 }),
    );
    const rec = recorder();
    source.addListener(rec.listener);

    // Tiny jitter on every axis, every poll. None should fire.
    for (let i = 0; i < 5; i += 1) {
      gamepad.setAxis(0, 0, (i % 2 === 0 ? 1 : -1) * 0.02);
      source.poll(i);
    }
    expect(rec.events).toHaveLength(0);
  });

  it('does not fire button events for disconnected pads and clears their snapshot', () => {
    const gamepad = createMockGamepad();
    gamepad.connect(0);
    gamepad.setButton(0, 5, { pressed: true, value: 1 });
    const source = track(new RawInputSource({ gamepad }));
    const rec = recorder();
    source.addListener(rec.listener);

    source.poll(1);
    expect(rec.events.filter((e) => e.kind === 'buttondown')).toHaveLength(1);
    rec.events.length = 0;

    // Pad disconnects with the button still "held" in the mock store —
    // simulates a player ripping the cable. The source should NOT emit
    // a buttonup (the pad is gone, not the button) but it should drop
    // its snapshot so reconnect doesn't see a stale held state.
    gamepad.disconnect(0);
    source.poll(2);
    expect(rec.events).toHaveLength(0);

    // Reconnect with the button now released. No transition events
    // because the snapshot was cleared on disconnect.
    gamepad.connect(0);
    gamepad.setButton(0, 5, { pressed: false, value: 0 });
    source.poll(3);
    expect(rec.events).toHaveLength(0);

    // And then a fresh press — fires a buttondown as expected.
    gamepad.setButton(0, 5, { pressed: true, value: 1 });
    source.poll(4);
    const downs = rec.events.filter((e) => e.kind === 'buttondown');
    expect(downs).toHaveLength(1);
  });

  it('attributes events to the pad index they came from across multiple pads', () => {
    const gamepad = createMockGamepad();
    gamepad.connect(0);
    gamepad.connect(2);
    const source = track(new RawInputSource({ gamepad }));
    const rec = recorder();
    source.addListener(rec.listener);

    source.poll(0); // baseline

    gamepad.setButton(0, 1, { pressed: true, value: 1 });
    gamepad.setButton(2, 1, { pressed: true, value: 1 });
    source.poll(1);

    const downs = rec.events.filter((e) => e.kind === 'buttondown');
    expect(downs).toHaveLength(2);
    const indices = new Set<number>();
    for (const d of downs) {
      if (d.kind === 'buttondown') indices.add(d.source.index);
    }
    expect(indices).toEqual(new Set([0, 2]));
  });
});

// ---------------------------------------------------------------------------
// Frame stamping
// ---------------------------------------------------------------------------

describe('RawInputSource — frame stamping', () => {
  it('stamps keyboard events with the most-recent poll frame', () => {
    const target = createMockKeyboardTarget();
    const source = track(new RawInputSource({ keyboardTarget: target }));
    const rec = recorder();
    source.addListener(rec.listener);

    source.poll(42);
    target.fire('keydown', { keyCode: KEY_CODE.W });

    expect(rec.events).toHaveLength(1);
    expect(rec.events[0]!.frame).toBe(42);
  });

  it('setFrame() updates the counter without polling gamepads', () => {
    const gamepad = createMockGamepad();
    gamepad.connect(0);
    const source = track(new RawInputSource({ gamepad }));
    const rec = recorder();
    source.addListener(rec.listener);

    source.setFrame(99);
    // setFrame must not iterate pads.
    expect(rec.events).toHaveLength(0);
    expect(source.getFrame()).toBe(99);
  });

  it('rejects non-finite frames in setFrame and poll', () => {
    const source = track(new RawInputSource({}));
    expect(() => source.setFrame(Number.NaN)).toThrow();
    expect(() => source.setFrame(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => source.poll(Number.NaN)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

describe('RawInputSource — subscription', () => {
  it('addListener returns an unsubscribe that detaches one listener', () => {
    const target = createMockKeyboardTarget();
    const source = track(new RawInputSource({ keyboardTarget: target }));
    const recA = recorder();
    const recB = recorder();
    const unsubA = source.addListener(recA.listener);
    source.addListener(recB.listener);

    target.fire('keydown', { keyCode: KEY_CODE.W });
    expect(recA.events).toHaveLength(1);
    expect(recB.events).toHaveLength(1);

    unsubA();
    target.fire('keydown', { keyCode: KEY_CODE.A });
    expect(recA.events).toHaveLength(1);
    expect(recB.events).toHaveLength(2);

    expect(source.listenerCount).toBe(1);
  });

  it('hasListener reports current subscription state', () => {
    const source = track(new RawInputSource({}));
    const rec = recorder();
    expect(source.hasListener(rec.listener)).toBe(false);
    const unsub = source.addListener(rec.listener);
    expect(source.hasListener(rec.listener)).toBe(true);
    unsub();
    expect(source.hasListener(rec.listener)).toBe(false);
  });

  it('isolates listener errors so siblings still receive events', () => {
    const target = createMockKeyboardTarget();
    const source = track(new RawInputSource({ keyboardTarget: target }));
    const rec = recorder();
    source.addListener(() => {
      throw new Error('boom');
    });
    source.addListener(rec.listener);

    // Suppress the console.error so the test output stays clean.
    const originalError = console.error;
    let errorCount = 0;
    console.error = (..._args: unknown[]) => {
      errorCount += 1;
    };
    try {
      target.fire('keydown', { keyCode: KEY_CODE.W });
    } finally {
      console.error = originalError;
    }

    expect(rec.events).toHaveLength(1);
    expect(errorCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Construction validation
// ---------------------------------------------------------------------------

describe('RawInputSource — option validation', () => {
  it('rejects an out-of-range axis deadzone', () => {
    expect(() => new RawInputSource({ axisDeadzone: -0.1 })).toThrow();
    expect(() => new RawInputSource({ axisDeadzone: 1.1 })).toThrow();
    expect(() => new RawInputSource({ axisDeadzone: Number.NaN })).toThrow();
  });

  it('rejects a non-integer or out-of-range maxGamepadIndex', () => {
    expect(() => new RawInputSource({ maxGamepadIndex: -1 })).toThrow();
    expect(() => new RawInputSource({ maxGamepadIndex: 33 })).toThrow();
    expect(() => new RawInputSource({ maxGamepadIndex: 1.5 })).toThrow();
  });

  it('accepts the documented default options without throwing', () => {
    expect(() => new RawInputSource({})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Browser adapter
// ---------------------------------------------------------------------------

describe('createBrowserKeyboardEventTarget', () => {
  it('forwards add/remove to an EventTarget-like object', () => {
    const calls: Array<{ op: 'add' | 'remove'; type: string }> = [];
    const target: EventTarget = {
      addEventListener: ((type: string, _listener: EventListener) => {
        calls.push({ op: 'add', type });
      }) as EventTarget['addEventListener'],
      removeEventListener: ((type: string, _listener: EventListener) => {
        calls.push({ op: 'remove', type });
      }) as EventTarget['removeEventListener'],
      dispatchEvent: () => true,
    };

    const adapter = createBrowserKeyboardEventTarget(target);
    const noop = () => {};
    adapter.addEventListener('keydown', noop);
    adapter.addEventListener('keyup', noop);
    adapter.removeEventListener('keydown', noop);
    adapter.removeEventListener('keyup', noop);

    expect(calls).toEqual([
      { op: 'add', type: 'keydown' },
      { op: 'add', type: 'keyup' },
      { op: 'remove', type: 'keydown' },
      { op: 'remove', type: 'keyup' },
    ]);
  });

  it('throws when no target is available and none is supplied', () => {
    expect(() => createBrowserKeyboardEventTarget(null)).toThrow();
  });
});
