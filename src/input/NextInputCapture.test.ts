import { describe, it, expect, vi } from 'vitest';
import {
  CAPTURE_CANCEL_GAMEPAD_BUTTON,
  CAPTURE_CANCEL_KEYCODE,
} from '../ui/bindingCapture';
import {
  KEYBOARD_DEVICE_SOURCE,
  gamepadDeviceSource,
  type RawInputEvent,
  type RawInputListener,
  type RawInputUnsubscribe,
} from './RawInputSource';
import {
  NextInputCaptureController,
  createNextInputCaptureForProfileManager,
  type NextInputCaptureResult,
  type NextInputCaptureSourceLike,
  type NextInputCaptureTarget,
} from './NextInputCapture';
import { InputBindingProfileManager } from './InputBindingProfileManager';
import type {
  BindingAction,
  GamepadBinding,
  InputBinding,
  KeyboardBinding,
  PlayerBindingIndex,
} from '../types/bindings';
import { KEY_CODE } from './keyCodes';
import { DEFAULT_GAMEPAD_AXIS_THRESHOLD } from './InputBindingsStore';

/**
 * AC 50003 Sub-AC 3 — next-input capture mechanism.
 *
 * Locks down:
 *
 *   1. Lifecycle — start opens a session, the next eligible event
 *      commits a binding via the target, the listener detaches.
 *   2. Keyboard capture — a `keydown` builds a {@link KeyboardBinding}
 *      and writes it through `setActionBindings`. Auto-repeat is
 *      ignored by default.
 *   3. Gamepad button capture — a `buttondown` builds a
 *      {@link GamepadBinding} pinned to the pad index.
 *   4. Gamepad axis capture — an `axischange` past the threshold builds
 *      a half-axis binding with the right direction sign and threshold.
 *   5. Cancel — ESC keydown / button-1 down end the session with
 *      `user_cancelled` without writing through the target.
 *   6. Replace vs append — `replace` (default) clobbers the row;
 *      `append` extends the existing list.
 *   7. Determinism — two controllers driven with identical events
 *      produce identical commits.
 *   8. Replaced session — calling start again while a session is open
 *      cancels the prior session with `session_replaced`.
 *   9. Destroy cancels in-flight — pending sessions resolve with
 *      `controller_destroyed` and post-destroy `start` calls throw.
 */

// ---------------------------------------------------------------------------
// Mock raw input source
// ---------------------------------------------------------------------------

interface MockSource extends NextInputCaptureSourceLike {
  emit(event: RawInputEvent): void;
  listenerCount(): number;
}

function createMockSource(): MockSource {
  const listeners = new Set<RawInputListener>();
  return {
    addListener(listener: RawInputListener): RawInputUnsubscribe {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event): void {
      // Snapshot to avoid concurrent-modification during dispatch.
      for (const fn of Array.from(listeners)) fn(event);
    },
    listenerCount(): number {
      return listeners.size;
    },
  };
}

// ---------------------------------------------------------------------------
// Mock target
// ---------------------------------------------------------------------------

function createMockTarget(): NextInputCaptureTarget & {
  calls: Array<{
    slot: PlayerBindingIndex;
    action: BindingAction;
    bindings: ReadonlyArray<InputBinding>;
  }>;
  preset: Map<string, ReadonlyArray<InputBinding>>;
} {
  const calls: Array<{
    slot: PlayerBindingIndex;
    action: BindingAction;
    bindings: ReadonlyArray<InputBinding>;
  }> = [];
  const preset = new Map<string, ReadonlyArray<InputBinding>>();
  return {
    setActionBindings(slot, action, bindings): void {
      calls.push({ slot, action, bindings });
    },
    resolveAction(slot, action): ReadonlyArray<InputBinding> {
      return preset.get(`${slot}:${action}`) ?? [];
    },
    calls,
    preset,
  };
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

function keydownEvent(keyCode: number, repeat = false): RawInputEvent {
  return {
    kind: 'keydown',
    source: KEYBOARD_DEVICE_SOURCE as { readonly kind: 'keyboard' },
    keyCode,
    repeat,
    frame: 0,
    timestamp: 0,
  };
}

function keyupEvent(keyCode: number): RawInputEvent {
  return {
    kind: 'keyup',
    source: KEYBOARD_DEVICE_SOURCE as { readonly kind: 'keyboard' },
    keyCode,
    frame: 0,
    timestamp: 0,
  };
}

function buttondownEvent(padIndex: number, buttonIndex: number): RawInputEvent {
  return {
    kind: 'buttondown',
    source: gamepadDeviceSource(padIndex) as {
      readonly kind: 'gamepad';
      readonly index: number;
    },
    buttonIndex,
    value: 1,
    frame: 0,
    timestamp: 0,
  };
}

function axisChangeEvent(
  padIndex: number,
  axisIndex: number,
  value: number,
): RawInputEvent {
  return {
    kind: 'axischange',
    source: gamepadDeviceSource(padIndex) as {
      readonly kind: 'gamepad';
      readonly index: number;
    },
    axisIndex,
    value,
    previousValue: 0,
    frame: 0,
    timestamp: 0,
  };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('NextInputCaptureController — construction', () => {
  it('does NOT subscribe to the source while idle', () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    expect(source.listenerCount()).toBe(0);
    expect(ctrl.isCapturing()).toBe(false);
    expect(ctrl.getActiveSession()).toBeNull();
  });

  it('subscribes only while a session is open', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(1, 'jump');
    expect(source.listenerCount()).toBe(1);
    source.emit(keydownEvent(KEY_CODE.W));
    await promise;
    expect(source.listenerCount()).toBe(0);
  });

  it('throws when constructed without a source', () => {
    // @ts-expect-error — exercising defensive validation.
    expect(() => new NextInputCaptureController({})).toThrow(/source/);
  });
});

// ---------------------------------------------------------------------------
// Start / session metadata
// ---------------------------------------------------------------------------

describe('NextInputCaptureController — session metadata', () => {
  it('exposes the active session while open', () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    void ctrl.start(2, 'attack');
    const session = ctrl.getActiveSession();
    expect(session).not.toBeNull();
    expect(session?.slot).toBe(2);
    expect(session?.action).toBe('attack');
    expect(session?.mode).toBe('replace');
    expect(ctrl.isCapturing()).toBe(true);
  });

  it('throws on invalid slot', () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    // @ts-expect-error — exercising runtime check.
    expect(() => ctrl.start(0, 'jump')).toThrow(/slot/);
    // @ts-expect-error — exercising runtime check.
    expect(() => ctrl.start(5, 'jump')).toThrow(/slot/);
  });

  it('throws on empty action', () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    // @ts-expect-error — exercising runtime check.
    expect(() => ctrl.start(1, '')).toThrow(/action/);
  });

  it('throws when no target is supplied', () => {
    const source = createMockSource();
    const ctrl = new NextInputCaptureController({ source });
    expect(() => ctrl.start(1, 'jump')).toThrow(/target/);
  });
});

// ---------------------------------------------------------------------------
// Keyboard capture
// ---------------------------------------------------------------------------

describe('NextInputCaptureController — keyboard capture', () => {
  it('commits a KeyboardBinding on the next keydown', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(1, 'jump');
    source.emit(keydownEvent(KEY_CODE.SPACE));
    const result = await promise;
    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed') return;
    expect(result.slot).toBe(1);
    expect(result.action).toBe('jump');
    expect(result.binding).toEqual({ kind: 'keyboard', keyCode: KEY_CODE.SPACE });
    expect(target.calls).toHaveLength(1);
    expect(target.calls[0]?.slot).toBe(1);
    expect(target.calls[0]?.action).toBe('jump');
    expect(target.calls[0]?.bindings).toEqual([
      { kind: 'keyboard', keyCode: KEY_CODE.SPACE },
    ]);
  });

  it('ignores auto-repeat keydown by default', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(1, 'jump');
    // Auto-repeat should be ignored — the next non-repeat is the one
    // that commits.
    source.emit(keydownEvent(KEY_CODE.W, true));
    expect(target.calls).toHaveLength(0);
    expect(ctrl.isCapturing()).toBe(true);
    source.emit(keydownEvent(KEY_CODE.A, false));
    const result = await promise;
    expect(result.kind).toBe('committed');
    if (result.kind === 'committed') {
      expect((result.binding as KeyboardBinding).keyCode).toBe(KEY_CODE.A);
    }
  });

  it('honours ignoreKeyRepeat: false', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(1, 'jump', { ignoreKeyRepeat: false });
    source.emit(keydownEvent(KEY_CODE.W, true));
    const result = await promise;
    expect(result.kind).toBe('committed');
  });

  it('cancels on ESC keydown', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(3, 'shield');
    source.emit(keydownEvent(CAPTURE_CANCEL_KEYCODE));
    const result = await promise;
    expect(result.kind).toBe('cancelled');
    if (result.kind === 'cancelled') {
      expect(result.reason).toBe('user_cancelled');
      expect(result.slot).toBe(3);
      expect(result.action).toBe('shield');
    }
    expect(target.calls).toHaveLength(0);
  });

  it('honours custom cancelKeyCode', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(1, 'jump', { cancelKeyCode: KEY_CODE.F1 });
    source.emit(keydownEvent(KEY_CODE.F1));
    const result = await promise;
    expect(result.kind).toBe('cancelled');
  });

  it('disables keyboard cancel when cancelKeyCode: null', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(1, 'jump', { cancelKeyCode: null });
    // ESC should now bind ESC instead of cancelling.
    source.emit(keydownEvent(CAPTURE_CANCEL_KEYCODE));
    const result = await promise;
    expect(result.kind).toBe('committed');
    if (result.kind === 'committed') {
      expect((result.binding as KeyboardBinding).keyCode).toBe(
        CAPTURE_CANCEL_KEYCODE,
      );
    }
  });

  it('skips invalid keyCodes and keeps waiting', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(1, 'jump');
    source.emit(keydownEvent(0)); // invalid → ignored
    source.emit(keydownEvent(NaN)); // invalid → ignored
    source.emit(keydownEvent(-3)); // invalid → ignored
    expect(target.calls).toHaveLength(0);
    expect(ctrl.isCapturing()).toBe(true);
    source.emit(keydownEvent(KEY_CODE.SPACE));
    const result = await promise;
    expect(result.kind).toBe('committed');
  });

  it('ignores keyup by default', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(1, 'jump');
    source.emit(keyupEvent(KEY_CODE.W));
    expect(target.calls).toHaveLength(0);
    expect(ctrl.isCapturing()).toBe(true);
    source.emit(keydownEvent(KEY_CODE.SPACE));
    await promise;
    expect(target.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Gamepad button capture
// ---------------------------------------------------------------------------

describe('NextInputCaptureController — gamepad button capture', () => {
  it('commits a GamepadBinding on buttondown', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(3, 'attack');
    source.emit(buttondownEvent(0, 0)); // pad 0, button 0 (A)
    const result = await promise;
    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed') return;
    const binding = result.binding as GamepadBinding;
    expect(binding.kind).toBe('gamepad');
    expect(binding.gamepadIndex).toBe(0);
    expect(binding.source).toEqual({ type: 'button', buttonIndex: 0 });
  });

  it('cancels on the canonical cancel button (B / button 1)', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(3, 'attack');
    source.emit(buttondownEvent(0, CAPTURE_CANCEL_GAMEPAD_BUTTON));
    const result = await promise;
    expect(result.kind).toBe('cancelled');
    expect(target.calls).toHaveLength(0);
  });

  it('honours custom cancelGamepadButton', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(3, 'attack', { cancelGamepadButton: 9 });
    source.emit(buttondownEvent(0, 9));
    const result = await promise;
    expect(result.kind).toBe('cancelled');
  });

  it('disables gamepad cancel when cancelGamepadButton: null', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(3, 'attack', { cancelGamepadButton: null });
    source.emit(buttondownEvent(0, CAPTURE_CANCEL_GAMEPAD_BUTTON));
    const result = await promise;
    expect(result.kind).toBe('committed');
  });

  it('pins the binding to the captured pad index', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(4, 'special');
    source.emit(buttondownEvent(2, 3)); // pad 2, button 3 (Y)
    const result = await promise;
    if (result.kind !== 'committed') {
      throw new Error('expected committed result');
    }
    const binding = result.binding as GamepadBinding;
    expect(binding.gamepadIndex).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Gamepad axis capture
// ---------------------------------------------------------------------------

describe('NextInputCaptureController — gamepad axis capture', () => {
  it('commits an axis half-binding past the capture threshold', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(3, 'moveLeft');
    source.emit(axisChangeEvent(0, 0, -0.95)); // strong left
    const result = await promise;
    if (result.kind !== 'committed') throw new Error('expected committed');
    const binding = result.binding as GamepadBinding;
    expect(binding.kind).toBe('gamepad');
    expect(binding.source.type).toBe('axis');
    if (binding.source.type === 'axis') {
      expect(binding.source.axisIndex).toBe(0);
      expect(binding.source.direction).toBe(-1);
      expect(binding.source.threshold).toBe(DEFAULT_GAMEPAD_AXIS_THRESHOLD);
    }
  });

  it('ignores axis movements below capture threshold', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(3, 'moveLeft');
    // Below the 0.7 capture threshold:
    source.emit(axisChangeEvent(0, 0, 0.3));
    source.emit(axisChangeEvent(0, 0, -0.4));
    expect(target.calls).toHaveLength(0);
    expect(ctrl.isCapturing()).toBe(true);
    // Past the threshold:
    source.emit(axisChangeEvent(0, 0, 0.9));
    const result = await promise;
    expect(result.kind).toBe('committed');
  });

  it('positive axis sign captures direction +1', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(3, 'moveRight');
    source.emit(axisChangeEvent(1, 2, 0.85));
    const result = await promise;
    if (result.kind !== 'committed') throw new Error('expected committed');
    const binding = result.binding as GamepadBinding;
    if (binding.source.type === 'axis') {
      expect(binding.source.direction).toBe(1);
      expect(binding.source.axisIndex).toBe(2);
    }
    expect(binding.gamepadIndex).toBe(1);
  });

  it('honours custom axisCaptureThreshold', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(3, 'moveLeft', {
      axisCaptureThreshold: 0.5,
    });
    source.emit(axisChangeEvent(0, 0, 0.6));
    const result = await promise;
    expect(result.kind).toBe('committed');
  });

  it('honours custom axisBindingThreshold', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(3, 'moveLeft', {
      axisBindingThreshold: 0.42,
    });
    source.emit(axisChangeEvent(0, 0, 0.95));
    const result = await promise;
    if (result.kind !== 'committed') throw new Error('expected committed');
    const binding = result.binding as GamepadBinding;
    if (binding.source.type === 'axis') {
      expect(binding.source.threshold).toBe(0.42);
    }
  });
});

// ---------------------------------------------------------------------------
// Replace vs append
// ---------------------------------------------------------------------------

describe('NextInputCaptureController — replace vs append', () => {
  it('replace mode (default) overwrites the entire row', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    target.preset.set('1:jump', [
      { kind: 'keyboard', keyCode: KEY_CODE.W },
    ]);
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(1, 'jump');
    source.emit(keydownEvent(KEY_CODE.SPACE));
    const result = await promise;
    if (result.kind !== 'committed') throw new Error('expected committed');
    expect(result.priorBindings).toEqual([]); // replace ignores prior
    expect(result.nextBindings).toEqual([
      { kind: 'keyboard', keyCode: KEY_CODE.SPACE },
    ]);
    expect(target.calls[0]?.bindings).toEqual([
      { kind: 'keyboard', keyCode: KEY_CODE.SPACE },
    ]);
  });

  it('append mode preserves prior bindings', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    target.preset.set('1:jump', [
      { kind: 'keyboard', keyCode: KEY_CODE.W },
    ]);
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(1, 'jump', { mode: 'append' });
    source.emit(keydownEvent(KEY_CODE.SPACE));
    const result = await promise;
    if (result.kind !== 'committed') throw new Error('expected committed');
    expect(result.priorBindings).toEqual([
      { kind: 'keyboard', keyCode: KEY_CODE.W },
    ]);
    expect(result.nextBindings).toEqual([
      { kind: 'keyboard', keyCode: KEY_CODE.W },
      { kind: 'keyboard', keyCode: KEY_CODE.SPACE },
    ]);
    expect(target.calls[0]?.bindings).toEqual([
      { kind: 'keyboard', keyCode: KEY_CODE.W },
      { kind: 'keyboard', keyCode: KEY_CODE.SPACE },
    ]);
  });

  it('append degenerates to replace when target lacks resolveAction', async () => {
    const source = createMockSource();
    // Build a write-only target that has no resolveAction
    const calls: Array<{
      slot: PlayerBindingIndex;
      action: BindingAction;
      bindings: ReadonlyArray<InputBinding>;
    }> = [];
    const writeOnly: NextInputCaptureTarget = {
      setActionBindings(slot, action, bindings): void {
        calls.push({ slot, action, bindings });
      },
    };
    const ctrl = new NextInputCaptureController({
      source,
      target: writeOnly,
    });
    const promise = ctrl.start(1, 'jump', { mode: 'append' });
    source.emit(keydownEvent(KEY_CODE.SPACE));
    const result = await promise;
    if (result.kind !== 'committed') throw new Error('expected committed');
    expect(result.priorBindings).toEqual([]);
    expect(result.nextBindings).toEqual([
      { kind: 'keyboard', keyCode: KEY_CODE.SPACE },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Cancel / replace / destroy
// ---------------------------------------------------------------------------

describe('NextInputCaptureController — cancel / replace / destroy', () => {
  it('cancel() ends an active session with user_cancelled', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(1, 'jump');
    const result1 = ctrl.cancel();
    expect(result1?.kind).toBe('cancelled');
    const result2 = await promise;
    expect(result2.kind).toBe('cancelled');
    if (result2.kind === 'cancelled') {
      expect(result2.reason).toBe('user_cancelled');
    }
    expect(source.listenerCount()).toBe(0);
    expect(ctrl.isCapturing()).toBe(false);
  });

  it('cancel() while idle is a no-op returning null', () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    expect(ctrl.cancel()).toBeNull();
  });

  it('starting a new session replaces the previous one', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const first = ctrl.start(1, 'jump');
    const second = ctrl.start(2, 'attack');
    const r1 = await first;
    expect(r1.kind).toBe('cancelled');
    if (r1.kind === 'cancelled') {
      expect(r1.reason).toBe('session_replaced');
      expect(r1.slot).toBe(1);
      expect(r1.action).toBe('jump');
    }
    // The new session is still open and pinned to slot 2.
    expect(ctrl.getActiveSession()?.slot).toBe(2);
    source.emit(keydownEvent(KEY_CODE.SPACE));
    const r2 = await second;
    expect(r2.kind).toBe('committed');
  });

  it('destroy() cancels in-flight with controller_destroyed', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const promise = ctrl.start(1, 'jump');
    ctrl.destroy();
    const result = await promise;
    expect(result.kind).toBe('cancelled');
    if (result.kind === 'cancelled') {
      expect(result.reason).toBe('controller_destroyed');
    }
    expect(ctrl.isDestroyed()).toBe(true);
    expect(source.listenerCount()).toBe(0);
  });

  it('start() throws after destroy', () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    ctrl.destroy();
    expect(() => ctrl.start(1, 'jump')).toThrow(/destroyed/);
  });

  it('destroy() is idempotent', () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    ctrl.destroy();
    expect(() => ctrl.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Result listeners
// ---------------------------------------------------------------------------

describe('NextInputCaptureController — onResult listeners', () => {
  it('fires every registered listener with the commit result', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const calls: NextInputCaptureResult[] = [];
    const unsubA = ctrl.onResult((r) => calls.push(r));
    ctrl.onResult((r) => calls.push(r));
    void ctrl.start(1, 'jump');
    source.emit(keydownEvent(KEY_CODE.SPACE));
    await Promise.resolve(); // flush microtasks
    expect(calls).toHaveLength(2);
    expect(calls[0]?.kind).toBe('committed');
    expect(calls[1]?.kind).toBe('committed');
    unsubA();
    void ctrl.start(1, 'attack');
    source.emit(keydownEvent(KEY_CODE.A));
    await Promise.resolve();
    expect(calls).toHaveLength(3);
  });

  it('isolates listener exceptions', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const sane = vi.fn();
    ctrl.onResult(() => {
      throw new Error('boom');
    });
    ctrl.onResult(sane);
    const promise = ctrl.start(1, 'jump');
    source.emit(keydownEvent(KEY_CODE.SPACE));
    const result = await promise;
    expect(result.kind).toBe('committed');
    expect(sane).toHaveBeenCalled();
  });

  it('fires listeners exactly once when destroy cancels an in-flight session', async () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const sane = vi.fn();
    ctrl.onResult(sane);
    const promise = ctrl.start(1, 'jump');
    ctrl.destroy();
    const result = await promise;
    expect(result.kind).toBe('cancelled');
    if (result.kind === 'cancelled') {
      expect(result.reason).toBe('controller_destroyed');
    }
    expect(sane).toHaveBeenCalledTimes(1);
    expect(sane).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'cancelled', reason: 'controller_destroyed' }),
    );
  });

  it('does NOT fire listeners on idle destroy', () => {
    const source = createMockSource();
    const target = createMockTarget();
    const ctrl = new NextInputCaptureController({ source, target });
    const sane = vi.fn();
    ctrl.onResult(sane);
    ctrl.destroy();
    // Nothing in flight to fan out about.
    expect(sane).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Integration with InputBindingProfileManager
// ---------------------------------------------------------------------------

describe('NextInputCaptureController + InputBindingProfileManager', () => {
  it('writes captured bindings through to the profile manager', async () => {
    const source = createMockSource();
    const manager = new InputBindingProfileManager();
    const ctrl = createNextInputCaptureForProfileManager(source, manager);
    const promise = ctrl.start(1, 'jump');
    source.emit(keydownEvent(KEY_CODE.SPACE));
    await promise;
    const slot1 = manager.getProfile(1);
    expect(slot1.bindings.jump).toEqual([
      { kind: 'keyboard', keyCode: KEY_CODE.SPACE },
    ]);
  });

  it('preserves prior bindings under append mode via manager.resolveAction', async () => {
    const source = createMockSource();
    const manager = new InputBindingProfileManager();
    const before = manager.resolveAction(1, 'jump');
    expect(before.length).toBeGreaterThan(0); // P1 default has W on jump
    const ctrl = createNextInputCaptureForProfileManager(source, manager);
    const promise = ctrl.start(1, 'jump', { mode: 'append' });
    source.emit(keydownEvent(KEY_CODE.SPACE));
    await promise;
    const after = manager.resolveAction(1, 'jump');
    expect(after.length).toBe(before.length + 1);
    expect(after[after.length - 1]).toEqual({
      kind: 'keyboard',
      keyCode: KEY_CODE.SPACE,
    });
  });

  it('binding kind matches keydown vs buttondown vs axischange', async () => {
    const source = createMockSource();
    const manager = new InputBindingProfileManager();
    const ctrl = createNextInputCaptureForProfileManager(source, manager);

    // Keyboard
    const p1 = ctrl.start(1, 'attack');
    source.emit(keydownEvent(KEY_CODE.F));
    const r1 = await p1;
    if (r1.kind !== 'committed') throw new Error('expected committed');
    expect(r1.binding.kind).toBe('keyboard');

    // Gamepad button
    const p2 = ctrl.start(3, 'attack');
    source.emit(buttondownEvent(0, 2));
    const r2 = await p2;
    if (r2.kind !== 'committed') throw new Error('expected committed');
    expect(r2.binding.kind).toBe('gamepad');
    expect((r2.binding as GamepadBinding).source.type).toBe('button');

    // Gamepad axis
    const p3 = ctrl.start(3, 'moveLeft');
    source.emit(axisChangeEvent(0, 0, -0.9));
    const r3 = await p3;
    if (r3.kind !== 'committed') throw new Error('expected committed');
    expect(r3.binding.kind).toBe('gamepad');
    expect((r3.binding as GamepadBinding).source.type).toBe('axis');
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('NextInputCaptureController — determinism', () => {
  it('two controllers driven with identical events commit identical bindings', async () => {
    const events: RawInputEvent[] = [
      keydownEvent(KEY_CODE.W, true), // ignored
      keydownEvent(KEY_CODE.SPACE),
    ];

    const sourceA = createMockSource();
    const targetA = createMockTarget();
    const ctrlA = new NextInputCaptureController({ source: sourceA, target: targetA });
    const promiseA = ctrlA.start(1, 'jump');
    for (const ev of events) sourceA.emit(ev);
    const resultA = await promiseA;

    const sourceB = createMockSource();
    const targetB = createMockTarget();
    const ctrlB = new NextInputCaptureController({ source: sourceB, target: targetB });
    const promiseB = ctrlB.start(1, 'jump');
    for (const ev of events) sourceB.emit(ev);
    const resultB = await promiseB;

    expect(resultA.kind).toBe('committed');
    expect(resultB.kind).toBe('committed');
    if (resultA.kind === 'committed' && resultB.kind === 'committed') {
      expect(resultA.binding).toEqual(resultB.binding);
      expect(resultA.nextBindings).toEqual(resultB.nextBindings);
    }
    expect(targetA.calls[0]?.bindings).toEqual(targetB.calls[0]?.bindings);
  });
});
