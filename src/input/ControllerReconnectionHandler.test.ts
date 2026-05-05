import { describe, expect, it, vi } from 'vitest';
import {
  ControllerReconnectionHandler,
  remapSlotBindings,
  type ControllerRebindEvent,
} from './ControllerReconnectionHandler';
import {
  DisconnectPauseController,
  type PausableSimulation,
} from '../match/DisconnectPauseController';
import { GamepadConnectionMonitor } from './GamepadConnectionMonitor';
import {
  InputBindingsStore,
  buildDefaultGamepadBindings,
} from './InputBindingsStore';
import type {
  GamepadBinding,
  InputBinding,
  PlayerBindings,
} from '../types/inputBindings';

/**
 * AC 14 Sub-AC 4 — handle controller reconnection to restore the
 * player binding and resume gameplay from the paused state.
 *
 * Locks down:
 *
 *   1. Pure rewrite — `remapSlotBindings` swaps every gamepad binding
 *      pinned to the original index for an equivalent binding pinned
 *      to the new index, leaves keyboard bindings untouched, and
 *      preserves "any pad" (`gamepadIndex: null`) bindings.
 *   2. Same-index reconnect is a structural no-op — `remapSlotBindings`
 *      returns the original reference so the caller can skip a
 *      `set()` round-trip.
 *   3. End-to-end: pad disconnects at index 0 → reconnects at index 2
 *      → handler rewrites the affected slot's bindings to point at
 *      index 2 AND the disconnect-pause controller releases the
 *      simulation pause.
 *   4. Same-id-same-index reconnect: handler clears the tracked
 *      record but does NOT rewrite bindings (no synthetic emit) and
 *      the pause controller releases the pause via its normal path.
 *   5. Empty `gamepadId` is skipped — without a stable id we cannot
 *      match on reconnect, so the handler stays out of the way.
 *   6. Multi-slot pad: a single pad bound to two slots is rewritten
 *      for both slots on the same reconnect.
 *   7. Dormant handler ignores all events; flipping back to active
 *      starts fresh tracking with no stale records.
 *   8. Listener-order independence: the test runs both
 *      "handler subscribed first" and "pause controller subscribed
 *      first" — both produce a released pause after the cross-index
 *      reconnect.
 *   9. `forget()` drops a tracked record so a later reconnect at a
 *      different index is a no-op.
 *  10. Listener errors are isolated — a throwing `onRebind` does not
 *      break the handler's state machine.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class FakeSimulation implements PausableSimulation {
  pauseCount = 0;
  resumeCount = 0;
  private paused = false;

  pause(): void {
    this.paused = true;
    this.pauseCount += 1;
  }
  resume(): void {
    this.paused = false;
    this.resumeCount += 1;
  }
  isPaused(): boolean {
    return this.paused;
  }
}

interface BuiltSystem {
  monitor: GamepadConnectionMonitor;
  store: InputBindingsStore;
  pause: DisconnectPauseController;
  handler: ControllerReconnectionHandler;
  sim: FakeSimulation;
  rebindEvents: ControllerRebindEvent[];
}

/**
 * Build the standard "match-live" system: monitor + store + pause
 * controller + reconnect handler, all wired the way `MatchScene` does
 * at runtime.
 *
 * `subscriptionOrder` controls the order in which the handler and
 * pause controller register their connect listeners. The Sub-AC 4
 * design promises both orders work — the test uses it to verify.
 */
function buildSystem(
  options: {
    initialActive?: boolean;
    subscriptionOrder?: 'handler-first' | 'pause-first';
  } = {},
): BuiltSystem {
  const order = options.subscriptionOrder ?? 'handler-first';
  const initialActive = options.initialActive ?? true;

  const store = new InputBindingsStore();
  const monitor = new GamepadConnectionMonitor({
    bindings: store,
    eventTarget: null,
  });
  const sim = new FakeSimulation();
  const rebindEvents: ControllerRebindEvent[] = [];

  const handler = new ControllerReconnectionHandler({
    monitor,
    bindings: store,
    onRebind: (e) => rebindEvents.push(e),
  });
  const pause = new DisconnectPauseController({
    monitor,
    simulation: sim,
  });

  if (order === 'handler-first') {
    handler.start();
    pause.start();
  } else {
    pause.start();
    handler.start();
  }

  monitor.start();
  if (initialActive) {
    handler.setActive(true);
    pause.setActive(true);
  }

  return { monitor, store, pause, handler, sim, rebindEvents };
}

function teardown(system: BuiltSystem): void {
  system.handler.stop();
  system.pause.stop();
  system.monitor.stop();
}

// ---------------------------------------------------------------------------
// Pure helper: remapSlotBindings
// ---------------------------------------------------------------------------

describe('remapSlotBindings', () => {
  it('rewrites every gamepad binding pinned to the original index', () => {
    const original: PlayerBindings = {
      playerIndex: 3,
      bindings: buildDefaultGamepadBindings(0),
    };
    const remapped = remapSlotBindings(original, 0, 2);

    // Sample one button binding and one axis binding — both must now
    // point at the new index.
    const jumpEntry = remapped.bindings.jump[0];
    expect(jumpEntry).toBeDefined();
    expect(jumpEntry?.kind).toBe('gamepad');
    if (jumpEntry?.kind === 'gamepad') {
      expect(jumpEntry.gamepadIndex).toBe(2);
      // Source data preserved verbatim.
      expect(jumpEntry.source).toEqual({ type: 'button', buttonIndex: 0 });
    }
    const leftEntry = remapped.bindings.left[0];
    expect(leftEntry).toBeDefined();
    if (leftEntry?.kind === 'gamepad') {
      expect(leftEntry.gamepadIndex).toBe(2);
      expect(leftEntry.source).toEqual({
        type: 'axis',
        axisIndex: 0,
        direction: -1,
        threshold: 0.5,
      });
    }
    expect(remapped.playerIndex).toBe(3);
  });

  it('returns the same reference when nothing matches the original index', () => {
    const original: PlayerBindings = {
      playerIndex: 3,
      bindings: buildDefaultGamepadBindings(0),
    };
    // Pad index 7 is never referenced — function should short-circuit.
    const remapped = remapSlotBindings(original, 7, 2);
    expect(remapped).toBe(original);
  });

  it('returns the same reference when original equals new', () => {
    const original: PlayerBindings = {
      playerIndex: 3,
      bindings: buildDefaultGamepadBindings(0),
    };
    const remapped = remapSlotBindings(original, 0, 0);
    expect(remapped).toBe(original);
  });

  it('preserves keyboard bindings untouched', () => {
    // Slot with a mix of keyboard + gamepad bindings.
    const mixed: PlayerBindings = {
      playerIndex: 1,
      bindings: {
        ...buildDefaultGamepadBindings(0),
        // Override one action with a keyboard binding so we can
        // verify it survives.
        attack: Object.freeze([
          Object.freeze<InputBinding>({ kind: 'keyboard', keyCode: 70 }),
        ]),
      },
    };
    const remapped = remapSlotBindings(mixed, 0, 2);
    expect(remapped.bindings.attack[0]).toEqual({ kind: 'keyboard', keyCode: 70 });
    // Other actions still rewritten.
    const jumpEntry = remapped.bindings.jump[0];
    if (jumpEntry?.kind === 'gamepad') {
      expect(jumpEntry.gamepadIndex).toBe(2);
    }
  });

  it('preserves "any pad" gamepad bindings (gamepadIndex: null)', () => {
    const anyPadBinding: GamepadBinding = {
      kind: 'gamepad',
      gamepadIndex: null,
      source: { type: 'button', buttonIndex: 9 },
    };
    const profile: PlayerBindings = {
      playerIndex: 1,
      bindings: {
        ...buildDefaultGamepadBindings(0),
        taunt: Object.freeze([Object.freeze(anyPadBinding)]),
      },
    };
    const remapped = remapSlotBindings(profile, 0, 2);
    // Any-pad binding stays put.
    expect(remapped.bindings.taunt[0]).toEqual({
      kind: 'gamepad',
      gamepadIndex: null,
      source: { type: 'button', buttonIndex: 9 },
    });
    // But the pinned bindings did rewrite.
    const jumpEntry = remapped.bindings.jump[0];
    if (jumpEntry?.kind === 'gamepad') {
      expect(jumpEntry.gamepadIndex).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Construction guards
// ---------------------------------------------------------------------------

describe('ControllerReconnectionHandler construction', () => {
  it('throws when monitor is missing', () => {
    expect(
      () =>
        new ControllerReconnectionHandler(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { bindings: new InputBindingsStore() } as any,
        ),
    ).toThrow(/monitor and options.bindings are required/);
  });

  it('throws when bindings is missing', () => {
    const monitor = new GamepadConnectionMonitor({
      bindings: new InputBindingsStore(),
      eventTarget: null,
    });
    expect(
      () =>
        new ControllerReconnectionHandler(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { monitor } as any,
        ),
    ).toThrow(/monitor and options.bindings are required/);
  });

  it('defaults to dormant so a pre-match disconnect is not tracked', () => {
    const store = new InputBindingsStore();
    const monitor = new GamepadConnectionMonitor({ bindings: store, eventTarget: null });
    const handler = new ControllerReconnectionHandler({ monitor, bindings: store });
    handler.start();
    monitor.start();

    monitor.emitDisconnect(0, { gamepadId: 'Xbox' });
    expect(handler.isActive()).toBe(false);
    expect(handler.hasPendingReconnect()).toBe(false);
    expect(handler.getPendingCount()).toBe(0);

    handler.stop();
    monitor.stop();
  });
});

// ---------------------------------------------------------------------------
// Cross-index reconnect — the headline case
// ---------------------------------------------------------------------------

describe('ControllerReconnectionHandler cross-index reconnect', () => {
  it('rewrites slot bindings when the same pad reconnects at a different index', () => {
    const system = buildSystem();
    const { monitor, store, sim, handler, rebindEvents } = system;

    // Slot 3 ships with gamepad bindings on index 0 by default.
    expect((store.get(3).bindings.jump[0] as GamepadBinding).gamepadIndex).toBe(0);

    // Pad 0 disconnects (Xbox controller).
    monitor.emitDisconnect(0, { gamepadId: 'Xbox 360 Controller', timestamp: 100 });
    expect(sim.isPaused()).toBe(true);
    expect(handler.hasPendingReconnect()).toBe(true);
    expect(handler.getPendingGamepadIds()).toEqual(['Xbox 360 Controller']);

    // Pad reconnects at index 2 (different USB port → new index).
    monitor.emitConnect(2, { gamepadId: 'Xbox 360 Controller', timestamp: 200 });

    // Slot 3's bindings are now pinned to pad 2.
    const jumpBinding = store.get(3).bindings.jump[0] as GamepadBinding;
    expect(jumpBinding.gamepadIndex).toBe(2);
    const leftBinding = store.get(3).bindings.left[0] as GamepadBinding;
    expect(leftBinding.gamepadIndex).toBe(2);

    // Pause controller saw the synthetic emit and released the pause.
    expect(sim.isPaused()).toBe(false);
    expect(sim.resumeCount).toBe(1);

    // Tracked record cleared.
    expect(handler.hasPendingReconnect()).toBe(false);
    expect(handler.getPendingCount()).toBe(0);

    // Rebind event fired with full payload.
    expect(rebindEvents).toHaveLength(1);
    const evt = rebindEvents[0]!;
    expect(evt.gamepadId).toBe('Xbox 360 Controller');
    expect(evt.originalGamepadIndex).toBe(0);
    expect(evt.newGamepadIndex).toBe(2);
    expect(evt.affectedSlots).toEqual([3]);
    expect(evt.bindingsRebound).toBe(true);
    expect(evt.timestamp).toBe(200);
    expect(Object.isFrozen(evt)).toBe(true);

    teardown(system);
  });

  it('listener-order independence — pause controller subscribed FIRST also works', () => {
    const system = buildSystem({ subscriptionOrder: 'pause-first' });
    const { monitor, store, sim, rebindEvents } = system;

    monitor.emitDisconnect(0, { gamepadId: 'Pad-Order-Test', timestamp: 100 });
    expect(sim.isPaused()).toBe(true);

    monitor.emitConnect(2, { gamepadId: 'Pad-Order-Test', timestamp: 200 });

    // Same end state — bindings rewritten + pause released — regardless
    // of which listener fired first on the original event.
    expect((store.get(3).bindings.jump[0] as GamepadBinding).gamepadIndex).toBe(2);
    expect(sim.isPaused()).toBe(false);
    expect(rebindEvents[0]!.bindingsRebound).toBe(true);

    teardown(system);
  });
});

// ---------------------------------------------------------------------------
// Same-index reconnect
// ---------------------------------------------------------------------------

describe('ControllerReconnectionHandler same-index reconnect', () => {
  it('clears tracked state but does not rewrite bindings', () => {
    const system = buildSystem();
    const { monitor, store, sim, handler, rebindEvents } = system;

    monitor.emitDisconnect(0, { gamepadId: 'Same-Index Pad' });
    expect(handler.hasPendingReconnect()).toBe(true);

    // Reconnect at the SAME index.
    monitor.emitConnect(0, { gamepadId: 'Same-Index Pad', timestamp: 300 });

    // Bindings unchanged (still pad 0).
    expect((store.get(3).bindings.jump[0] as GamepadBinding).gamepadIndex).toBe(0);
    // Pause released via the pause controller's normal index-keyed path.
    expect(sim.isPaused()).toBe(false);
    // Tracked record cleared.
    expect(handler.hasPendingReconnect()).toBe(false);

    // Rebind event still fires (telemetry hook), but with
    // bindingsRebound=false and original===new.
    expect(rebindEvents).toHaveLength(1);
    expect(rebindEvents[0]!.bindingsRebound).toBe(false);
    expect(rebindEvents[0]!.originalGamepadIndex).toBe(0);
    expect(rebindEvents[0]!.newGamepadIndex).toBe(0);

    teardown(system);
  });
});

// ---------------------------------------------------------------------------
// Empty / missing gamepadId
// ---------------------------------------------------------------------------

describe('ControllerReconnectionHandler missing id', () => {
  it('skips disconnects with empty gamepadId — no tracking', () => {
    const system = buildSystem();
    const { monitor, handler, sim } = system;

    // Disconnect with empty id (some UAs).
    monitor.emitDisconnect(0, { gamepadId: '' });
    // Pause controller still pauses — its index-keyed path doesn't
    // need an id. But our handler tracks nothing.
    expect(sim.isPaused()).toBe(true);
    expect(handler.hasPendingReconnect()).toBe(false);

    // A later reconnect with empty id is a no-op for our handler.
    // The pause controller's normal path handles the same-index case.
    monitor.emitConnect(0, { gamepadId: '' });
    expect(sim.isPaused()).toBe(false);

    teardown(system);
  });

  it('skips reconnects with empty gamepadId even if a tracked id is pending', () => {
    const system = buildSystem();
    const { monitor, store, handler, rebindEvents } = system;

    monitor.emitDisconnect(0, { gamepadId: 'Xbox' });
    expect(handler.hasPendingReconnect()).toBe(true);

    // A different connect event with no id arrives — must not match.
    monitor.emitConnect(2, { gamepadId: '' });
    expect(handler.hasPendingReconnect()).toBe(true);
    // No rebind happened.
    expect((store.get(3).bindings.jump[0] as GamepadBinding).gamepadIndex).toBe(0);
    expect(rebindEvents).toHaveLength(0);

    teardown(system);
  });
});

// ---------------------------------------------------------------------------
// Multi-slot pad
// ---------------------------------------------------------------------------

describe('ControllerReconnectionHandler multi-slot', () => {
  it('rewrites every slot bound to the same pad on a single reconnect', () => {
    const system = buildSystem();
    const { monitor, store, rebindEvents } = system;

    // Bind slot 1 (default keyboard) ALSO to gamepad 0 — now pad 0
    // affects both slot 1 and slot 3.
    store.set(1, { playerIndex: 1, bindings: buildDefaultGamepadBindings(0) });

    monitor.emitDisconnect(0, { gamepadId: 'Shared Pad' });

    monitor.emitConnect(2, { gamepadId: 'Shared Pad' });

    // Both slots rewritten.
    expect((store.get(1).bindings.jump[0] as GamepadBinding).gamepadIndex).toBe(2);
    expect((store.get(3).bindings.jump[0] as GamepadBinding).gamepadIndex).toBe(2);

    expect(rebindEvents).toHaveLength(1);
    expect(rebindEvents[0]!.affectedSlots).toEqual([1, 3]);
    expect(rebindEvents[0]!.bindingsRebound).toBe(true);

    teardown(system);
  });
});

// ---------------------------------------------------------------------------
// Active / dormant gating
// ---------------------------------------------------------------------------

describe('ControllerReconnectionHandler active gating', () => {
  it('dormant handler ignores disconnect/reconnect entirely', () => {
    const system = buildSystem({ initialActive: false });
    const { monitor, store, handler, rebindEvents } = system;

    monitor.emitDisconnect(0, { gamepadId: 'Test' });
    expect(handler.hasPendingReconnect()).toBe(false);

    monitor.emitConnect(2, { gamepadId: 'Test' });
    expect((store.get(3).bindings.jump[0] as GamepadBinding).gamepadIndex).toBe(0);
    expect(rebindEvents).toHaveLength(0);

    teardown(system);
  });

  it('flipping to dormant clears tracked records', () => {
    const system = buildSystem();
    const { monitor, handler } = system;

    monitor.emitDisconnect(0, { gamepadId: 'X' });
    expect(handler.hasPendingReconnect()).toBe(true);

    handler.setActive(false);
    expect(handler.hasPendingReconnect()).toBe(false);

    teardown(system);
  });

  it('setActive(true) → setActive(true) is idempotent', () => {
    const system = buildSystem();
    const { handler } = system;

    handler.setActive(true);
    expect(handler.isActive()).toBe(true);

    teardown(system);
  });
});

// ---------------------------------------------------------------------------
// forget()
// ---------------------------------------------------------------------------

describe('ControllerReconnectionHandler.forget', () => {
  it('drops a tracked record so a later reconnect is a no-op', () => {
    const system = buildSystem();
    const { monitor, store, handler, rebindEvents } = system;

    monitor.emitDisconnect(0, { gamepadId: 'XYZ' });
    expect(handler.forget('XYZ')).toBe(true);
    expect(handler.hasPendingReconnect()).toBe(false);

    // Reconnect at a different index — no rebind.
    monitor.emitConnect(2, { gamepadId: 'XYZ' });
    expect((store.get(3).bindings.jump[0] as GamepadBinding).gamepadIndex).toBe(0);
    expect(rebindEvents).toHaveLength(0);

    // forget() is idempotent on an unknown id.
    expect(handler.forget('XYZ')).toBe(false);

    teardown(system);
  });

  it('forgetAll() drops every tracked record', () => {
    const system = buildSystem();
    const { monitor, store, handler } = system;

    // Bind both pad 0 (slot 3) and pad 1 (slot 4 default).
    monitor.emitDisconnect(0, { gamepadId: 'A' });
    monitor.emitDisconnect(1, { gamepadId: 'B' });
    expect(handler.getPendingCount()).toBe(2);

    handler.forgetAll();
    expect(handler.getPendingCount()).toBe(0);

    // Reconnect at different indices → no rebind.
    monitor.emitConnect(5, { gamepadId: 'A' });
    monitor.emitConnect(6, { gamepadId: 'B' });
    expect((store.get(3).bindings.jump[0] as GamepadBinding).gamepadIndex).toBe(0);
    expect((store.get(4).bindings.jump[0] as GamepadBinding).gamepadIndex).toBe(1);

    teardown(system);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('ControllerReconnectionHandler lifecycle', () => {
  it('start() is idempotent — does not double-subscribe', () => {
    const store = new InputBindingsStore();
    const monitor = new GamepadConnectionMonitor({ bindings: store, eventTarget: null });
    const rebindEvents: ControllerRebindEvent[] = [];
    const handler = new ControllerReconnectionHandler({
      monitor,
      bindings: store,
      onRebind: (e) => rebindEvents.push(e),
      initialActive: true,
    });

    handler.start();
    handler.start();
    monitor.start();

    monitor.emitDisconnect(0, { gamepadId: 'Single' });
    monitor.emitConnect(2, { gamepadId: 'Single' });

    // If start() double-subscribed we'd get two rebind events.
    expect(rebindEvents).toHaveLength(1);

    handler.stop();
    monitor.stop();
  });

  it('stop() detaches listeners — subsequent events do nothing', () => {
    const system = buildSystem();
    const { monitor, store, handler, rebindEvents } = system;

    handler.stop();
    monitor.emitDisconnect(0, { gamepadId: 'After-Stop' });
    monitor.emitConnect(2, { gamepadId: 'After-Stop' });
    expect(rebindEvents).toHaveLength(0);
    expect((store.get(3).bindings.jump[0] as GamepadBinding).gamepadIndex).toBe(0);

    system.pause.stop();
    monitor.stop();
  });
});

// ---------------------------------------------------------------------------
// Listener-error isolation
// ---------------------------------------------------------------------------

describe('ControllerReconnectionHandler listener errors', () => {
  it('isolates an onRebind throw — state machine remains correct', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new InputBindingsStore();
    const monitor = new GamepadConnectionMonitor({ bindings: store, eventTarget: null });
    const handler = new ControllerReconnectionHandler({
      monitor,
      bindings: store,
      onRebind: () => {
        throw new Error('boom');
      },
      initialActive: true,
    });
    handler.start();
    monitor.start();

    monitor.emitDisconnect(0, { gamepadId: 'Throw' });
    monitor.emitConnect(2, { gamepadId: 'Throw' });

    // Despite the listener throwing, the rewrite landed.
    expect((store.get(3).bindings.jump[0] as GamepadBinding).gamepadIndex).toBe(2);
    expect(handler.hasPendingReconnect()).toBe(false);
    expect(consoleSpy).toHaveBeenCalled();

    handler.stop();
    monitor.stop();
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Pending-record inspection
// ---------------------------------------------------------------------------

describe('ControllerReconnectionHandler pending-record inspection', () => {
  it('getTrackedRecord returns a snapshot of the tracked entry', () => {
    const system = buildSystem();
    const { monitor, handler } = system;

    monitor.emitDisconnect(0, { gamepadId: 'Inspect' });
    const record = handler.getTrackedRecord('Inspect');
    expect(record).toBeDefined();
    expect(record?.gamepadIndex).toBe(0);
    expect(record?.slots).toEqual([3]);
    expect(Object.isFrozen(record)).toBe(true);

    // Unknown id returns undefined.
    expect(handler.getTrackedRecord('Unknown')).toBeUndefined();

    teardown(system);
  });

  it('getPendingGamepadIds returns sorted ids', () => {
    const system = buildSystem();
    const { monitor, handler } = system;

    monitor.emitDisconnect(0, { gamepadId: 'Z-pad' });
    monitor.emitDisconnect(1, { gamepadId: 'A-pad' });
    expect(handler.getPendingGamepadIds()).toEqual(['A-pad', 'Z-pad']);
    expect(Object.isFrozen(handler.getPendingGamepadIds())).toBe(true);

    teardown(system);
  });
});
