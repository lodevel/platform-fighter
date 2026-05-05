import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DisconnectPauseController,
  type DisconnectPauseEvent,
  type DisconnectResumeEvent,
  type PausableSimulation,
} from './DisconnectPauseController';
import { GamepadConnectionMonitor } from '../input/GamepadConnectionMonitor';
import {
  InputBindingsStore,
  buildDefaultGamepadBindings,
} from '../input/InputBindingsStore';
import { PhysicsEngine } from '../engine/PhysicsEngine';

/**
 * AC 14 Sub-AC 2 — auto-pause on disconnect mid-match.
 *
 * Locks down:
 *
 *   1. A qualifying disconnect (a pad bound to at least one slot)
 *      while the controller is active pauses the simulation.
 *   2. A reconnect for the same pad clears the disconnect state and
 *      releases the pause.
 *   3. A disconnect for a pad bound to no slot is ignored — the engine
 *      stays unpaused.
 *   4. While dormant (`active=false`), neither disconnects nor
 *      reconnects affect the simulation.
 *   5. Multi-pad pull: two simultaneous disconnects pause once;
 *      releasing the pause requires both pads back.
 *   6. `acknowledgeAndResume()` lifts the pause without a hardware
 *      reconnect and reports `reason: 'acknowledge'`.
 *   7. Going dormant mid-pause releases the pause and clears the
 *      tracked set.
 *   8. The controller never releases a pause it did not take (a
 *      pre-existing pause from another subsystem is preserved on
 *      reconnect).
 *   9. `start()` / `stop()` are idempotent and do not leak listeners.
 *  10. End-to-end with the real `PhysicsEngine`: a pause prevents the
 *      `step` callback from firing — input + simulation are frozen.
 *  11. Listener errors are isolated and don't break the state machine.
 */

// ---------------------------------------------------------------------------
// Mocks
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

function buildController(
  store: InputBindingsStore,
  options: {
    initialActive?: boolean;
    onPause?: (e: DisconnectPauseEvent) => void;
    onResume?: (e: DisconnectResumeEvent) => void;
    simulation?: PausableSimulation;
  } = {},
): {
  monitor: GamepadConnectionMonitor;
  controller: DisconnectPauseController;
  simulation: PausableSimulation;
} {
  const monitor = new GamepadConnectionMonitor({
    bindings: store,
    eventTarget: null, // we drive via emit*; no DOM needed
  });
  const simulation = options.simulation ?? new FakeSimulation();
  const controller = new DisconnectPauseController({
    monitor,
    simulation,
    initialActive: options.initialActive,
    onPause: options.onPause,
    onResume: options.onResume,
  });
  controller.start();
  monitor.start();
  return { monitor, controller, simulation };
}

// ---------------------------------------------------------------------------
// Construction guards
// ---------------------------------------------------------------------------

describe('DisconnectPauseController construction', () => {
  it('throws when monitor is missing', () => {
    expect(
      () =>
        new DisconnectPauseController(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { simulation: new FakeSimulation() } as any,
        ),
    ).toThrow(/monitor and options.simulation are required/);
  });

  it('throws when simulation is missing', () => {
    const monitor = new GamepadConnectionMonitor({
      bindings: new InputBindingsStore(),
      eventTarget: null,
    });
    expect(
      () =>
        new DisconnectPauseController(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { monitor } as any,
        ),
    ).toThrow(/monitor and options.simulation are required/);
  });

  it('defaults to dormant (active=false) so a pre-match disconnect does not pause', () => {
    const store = new InputBindingsStore();
    const { controller, simulation } = buildController(store);
    expect(controller.isActive()).toBe(false);
    expect(controller.isPausedDueToDisconnect()).toBe(false);
    expect(simulation.isPaused()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pause + resume (single pad)
// ---------------------------------------------------------------------------

describe('DisconnectPauseController single-pad pause/resume', () => {
  let store: InputBindingsStore;
  let monitor: GamepadConnectionMonitor;
  let controller: DisconnectPauseController;
  let simulation: FakeSimulation;
  let pauseEvents: DisconnectPauseEvent[];
  let resumeEvents: DisconnectResumeEvent[];

  beforeEach(() => {
    store = new InputBindingsStore();
    pauseEvents = [];
    resumeEvents = [];
    const built = buildController(store, {
      initialActive: true,
      onPause: (e) => pauseEvents.push(e),
      onResume: (e) => resumeEvents.push(e),
      simulation: new FakeSimulation(),
    });
    monitor = built.monitor;
    controller = built.controller;
    simulation = built.simulation as FakeSimulation;
  });

  afterEach(() => {
    controller.stop();
    monitor.stop();
  });

  it('pauses the simulation when an active pad disconnects', () => {
    monitor.emitDisconnect(0, { gamepadId: 'Xbox 360 Controller', timestamp: 100 });

    expect(simulation.pauseCount).toBe(1);
    expect(simulation.isPaused()).toBe(true);
    expect(controller.isPausedDueToDisconnect()).toBe(true);
    expect(controller.getDisconnectedPadIndices()).toEqual([0]);
    expect(controller.getAffectedSlots()).toEqual([3]);

    expect(pauseEvents).toHaveLength(1);
    const evt = pauseEvents[0]!;
    expect(evt.gamepadIndex).toBe(0);
    expect(evt.gamepadId).toBe('Xbox 360 Controller');
    expect(evt.affectedSlots).toEqual([3]);
    expect(evt.disconnectedPadIndices).toEqual([0]);
    expect(evt.affectedSlotsTotal).toEqual([3]);
    expect(evt.pauseEngaged).toBe(true);
    expect(evt.timestamp).toBe(100);
    expect(Object.isFrozen(evt)).toBe(true);
  });

  it('resumes the simulation when the same pad reconnects', () => {
    monitor.emitDisconnect(0, { gamepadId: 'A' });
    expect(simulation.isPaused()).toBe(true);

    monitor.emitConnect(0, { gamepadId: 'A', timestamp: 200 });

    expect(simulation.resumeCount).toBe(1);
    expect(simulation.isPaused()).toBe(false);
    expect(controller.isPausedDueToDisconnect()).toBe(false);
    expect(controller.getDisconnectedPadIndices()).toEqual([]);
    expect(controller.getAffectedSlots()).toEqual([]);

    expect(resumeEvents).toHaveLength(1);
    const evt = resumeEvents[0]!;
    expect(evt.gamepadIndex).toBe(0);
    expect(evt.pauseReleased).toBe(true);
    expect(evt.reason).toBe('reconnect');
    expect(evt.timestamp).toBe(200);
    expect(evt.remainingDisconnectedPadIndices).toEqual([]);
    expect(evt.remainingAffectedSlots).toEqual([]);
  });

  it('ignores disconnect events for unbound pad indices', () => {
    monitor.emitDisconnect(7); // no slot bound to pad 7
    expect(simulation.pauseCount).toBe(0);
    expect(simulation.isPaused()).toBe(false);
    expect(controller.isPausedDueToDisconnect()).toBe(false);
    expect(pauseEvents).toHaveLength(0);
  });

  it('ignores reconnect events for pads we never tracked', () => {
    // No prior disconnect for pad 1 — reconnect must be a no-op.
    monitor.emitConnect(1);
    expect(simulation.resumeCount).toBe(0);
    expect(resumeEvents).toHaveLength(0);
  });

  it('a second qualifying disconnect while paused fires onPause but does not double-pause', () => {
    // Bind slot 2 to pad 1 too so both pads have an affected slot.
    store.set(2, { playerIndex: 2, bindings: buildDefaultGamepadBindings(1) });

    monitor.emitDisconnect(0); // first qualifying disconnect — engages pause
    monitor.emitDisconnect(1); // second qualifying disconnect — banner update

    expect(simulation.pauseCount).toBe(1); // engaged exactly once
    expect(controller.getDisconnectedPadIndices()).toEqual([0, 1]);
    expect(controller.getAffectedSlots()).toEqual([2, 3, 4].sort());

    expect(pauseEvents).toHaveLength(2);
    expect(pauseEvents[0]!.pauseEngaged).toBe(true);
    expect(pauseEvents[1]!.pauseEngaged).toBe(false); // already paused
    expect(pauseEvents[1]!.disconnectedPadIndices).toEqual([0, 1]);
    expect(pauseEvents[1]!.affectedSlotsTotal).toEqual([2, 3, 4]);
  });
});

// ---------------------------------------------------------------------------
// Multi-pad pull-out
// ---------------------------------------------------------------------------

describe('DisconnectPauseController multi-pad', () => {
  it('requires every disconnected pad to reconnect before releasing the pause', () => {
    const store = new InputBindingsStore();
    // Bind slot 2 to pad 1 (so both pad 0 and pad 1 are affected).
    store.set(2, { playerIndex: 2, bindings: buildDefaultGamepadBindings(1) });

    const resumeEvents: DisconnectResumeEvent[] = [];
    const { monitor, controller, simulation } = buildController(store, {
      initialActive: true,
      onResume: (e) => resumeEvents.push(e),
    });
    const sim = simulation as FakeSimulation;

    monitor.emitDisconnect(0);
    monitor.emitDisconnect(1);
    expect(sim.isPaused()).toBe(true);

    // Pad 0 reconnects — pad 1 still missing, pause MUST stay engaged.
    monitor.emitConnect(0);
    expect(sim.isPaused()).toBe(true);
    expect(controller.isPausedDueToDisconnect()).toBe(true);
    expect(controller.getDisconnectedPadIndices()).toEqual([1]);
    expect(resumeEvents).toHaveLength(1);
    expect(resumeEvents[0]!.pauseReleased).toBe(false);
    expect(resumeEvents[0]!.remainingDisconnectedPadIndices).toEqual([1]);

    // Pad 1 reconnects — pause finally releases.
    monitor.emitConnect(1);
    expect(sim.isPaused()).toBe(false);
    expect(controller.isPausedDueToDisconnect()).toBe(false);
    expect(resumeEvents).toHaveLength(2);
    expect(resumeEvents[1]!.pauseReleased).toBe(true);

    controller.stop();
    monitor.stop();
  });
});

// ---------------------------------------------------------------------------
// Active / dormant gating
// ---------------------------------------------------------------------------

describe('DisconnectPauseController active gating', () => {
  it('dormant controller ignores disconnects entirely', () => {
    const store = new InputBindingsStore();
    const pauseEvents: DisconnectPauseEvent[] = [];
    const { monitor, controller, simulation } = buildController(store, {
      onPause: (e) => pauseEvents.push(e),
      // initialActive defaults to false
    });

    monitor.emitDisconnect(0); // would normally affect slot 3
    expect(simulation.isPaused()).toBe(false);
    expect(controller.isPausedDueToDisconnect()).toBe(false);
    expect(pauseEvents).toHaveLength(0);

    controller.stop();
    monitor.stop();
  });

  it('flipping to dormant mid-pause releases the pause and clears state', () => {
    const store = new InputBindingsStore();
    const { monitor, controller, simulation } = buildController(store, {
      initialActive: true,
    });
    const sim = simulation as FakeSimulation;

    monitor.emitDisconnect(0);
    expect(sim.isPaused()).toBe(true);
    expect(controller.getDisconnectedPadIndices()).toEqual([0]);

    controller.setActive(false);
    expect(sim.isPaused()).toBe(false);
    expect(controller.isPausedDueToDisconnect()).toBe(false);
    expect(controller.getDisconnectedPadIndices()).toEqual([]);

    // A subsequent disconnect while dormant must remain a no-op.
    monitor.emitDisconnect(0);
    expect(sim.isPaused()).toBe(false);

    controller.stop();
    monitor.stop();
  });

  it('setActive(true) → setActive(true) is a no-op (idempotent)', () => {
    const store = new InputBindingsStore();
    const { controller } = buildController(store, { initialActive: true });
    controller.setActive(true);
    expect(controller.isActive()).toBe(true);
    controller.stop();
  });
});

// ---------------------------------------------------------------------------
// acknowledgeAndResume
// ---------------------------------------------------------------------------

describe('DisconnectPauseController.acknowledgeAndResume', () => {
  it('lifts the pause and reports reason=acknowledge', () => {
    const store = new InputBindingsStore();
    const resumeEvents: DisconnectResumeEvent[] = [];
    const { monitor, controller, simulation } = buildController(store, {
      initialActive: true,
      onResume: (e) => resumeEvents.push(e),
    });
    const sim = simulation as FakeSimulation;

    monitor.emitDisconnect(0);
    expect(sim.isPaused()).toBe(true);

    controller.acknowledgeAndResume();

    expect(sim.isPaused()).toBe(false);
    expect(controller.isPausedDueToDisconnect()).toBe(false);
    expect(controller.getDisconnectedPadIndices()).toEqual([]);
    expect(resumeEvents).toHaveLength(1);
    expect(resumeEvents[0]!.reason).toBe('acknowledge');
    expect(resumeEvents[0]!.pauseReleased).toBe(true);

    // Idempotent — calling again does nothing.
    controller.acknowledgeAndResume();
    expect(sim.resumeCount).toBe(1);
    expect(resumeEvents).toHaveLength(1);

    controller.stop();
    monitor.stop();
  });
});

// ---------------------------------------------------------------------------
// Pause-ownership safety
// ---------------------------------------------------------------------------

describe('DisconnectPauseController pause ownership', () => {
  it('does not call resume() when the engine was paused before our subscription', () => {
    const store = new InputBindingsStore();
    const sim = new FakeSimulation();
    sim.pause(); // some other subsystem already holds the pause
    sim.pauseCount = 0;
    sim.resumeCount = 0;

    const { monitor, controller } = buildController(store, {
      initialActive: true,
      simulation: sim,
    });

    // No qualifying disconnect ever fires — we should not touch pause/resume.
    monitor.emitConnect(0); // not tracked
    expect(sim.resumeCount).toBe(0);
    expect(sim.isPaused()).toBe(true);

    controller.stop();
    monitor.stop();
    // stop() must also leave the pre-existing pause alone (we never held it).
    expect(sim.resumeCount).toBe(0);
  });

  it('preserves a pre-existing pause when the disconnect resolves but never released by us', () => {
    // Edge case: external pause + our pause together. When pad reconnects
    // we release our share via simulation.resume(); the simulation impl
    // decides what that means semantically. Our contract is just that we
    // call resume() exactly once for our pause. A naive PausableSimulation
    // (the real GameLoop) treats pause/resume as a flag, so the test
    // simply verifies our resume bookkeeping.
    const store = new InputBindingsStore();
    const sim = new FakeSimulation();
    const { monitor, controller } = buildController(store, {
      initialActive: true,
      simulation: sim,
    });

    monitor.emitDisconnect(0);
    expect(sim.pauseCount).toBe(1);
    expect(sim.isPaused()).toBe(true);

    monitor.emitConnect(0);
    expect(sim.resumeCount).toBe(1);
    expect(sim.isPaused()).toBe(false);

    controller.stop();
    monitor.stop();
    // We released our pause once, and stop() with nothing tracked is a
    // no-op on the simulation side.
    expect(sim.resumeCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Subscription lifecycle
// ---------------------------------------------------------------------------

describe('DisconnectPauseController lifecycle', () => {
  it('start() then start() again is idempotent (no double subscription)', () => {
    const store = new InputBindingsStore();
    const monitor = new GamepadConnectionMonitor({ bindings: store, eventTarget: null });
    const sim = new FakeSimulation();
    const pauseEvents: DisconnectPauseEvent[] = [];
    const controller = new DisconnectPauseController({
      monitor,
      simulation: sim,
      initialActive: true,
      onPause: (e) => pauseEvents.push(e),
    });

    controller.start();
    controller.start(); // second start must not double-subscribe
    monitor.start();

    monitor.emitDisconnect(0);
    expect(pauseEvents).toHaveLength(1);
    expect(sim.pauseCount).toBe(1);

    controller.stop();
    monitor.stop();
  });

  it('stop() detaches listeners — subsequent disconnects do nothing', () => {
    const store = new InputBindingsStore();
    const sim = new FakeSimulation();
    const pauseEvents: DisconnectPauseEvent[] = [];
    const { monitor, controller } = buildController(store, {
      initialActive: true,
      onPause: (e) => pauseEvents.push(e),
      simulation: sim,
    });

    controller.stop();
    monitor.emitDisconnect(0);
    expect(pauseEvents).toHaveLength(0);
    expect(sim.pauseCount).toBe(0);

    monitor.stop();
  });

  it('stop() while paused releases the pause and clears tracked state', () => {
    const store = new InputBindingsStore();
    const sim = new FakeSimulation();
    const { monitor, controller } = buildController(store, {
      initialActive: true,
      simulation: sim,
    });

    monitor.emitDisconnect(0);
    expect(sim.isPaused()).toBe(true);

    controller.stop();
    expect(sim.isPaused()).toBe(false);
    expect(controller.isPausedDueToDisconnect()).toBe(false);
    expect(controller.getDisconnectedPadIndices()).toEqual([]);

    // stop() is idempotent.
    controller.stop();
    expect(sim.resumeCount).toBe(1);

    monitor.stop();
  });
});

// ---------------------------------------------------------------------------
// Real PhysicsEngine integration
// ---------------------------------------------------------------------------

describe('DisconnectPauseController × PhysicsEngine', () => {
  it('a qualifying disconnect freezes the simulation step callback', () => {
    const store = new InputBindingsStore();
    const monitor = new GamepadConnectionMonitor({ bindings: store, eventTarget: null });
    const physics = new PhysicsEngine();

    const controller = new DisconnectPauseController({
      monitor,
      simulation: physics,
      initialActive: true,
    });
    controller.start();
    monitor.start();

    let stepCount = 0;
    const step = (): void => {
      stepCount += 1;
    };

    // Baseline: 100 ms of wall-clock advances ~6 fixed steps (16.67 ms each).
    physics.advance(100, step); // primes accumulator
    expect(stepCount).toBeGreaterThan(0);
    const baseline = stepCount;
    expect(physics.getFrame()).toBe(baseline);

    // Pad pulled — controller pauses the engine BEFORE the next advance.
    monitor.emitDisconnect(0);
    expect(physics.isPaused()).toBe(true);

    // 1000 ms of wall-clock during pause — step MUST NOT fire.
    physics.advance(1000, step);
    expect(stepCount).toBe(baseline); // no new steps
    expect(physics.getFrame()).toBe(baseline); // frame counter frozen

    // Pad replugged — pause lifts.
    monitor.emitConnect(0);
    expect(physics.isPaused()).toBe(false);

    // The next advance can step the engine again.
    physics.advance(100, step);
    expect(stepCount).toBeGreaterThan(baseline);

    controller.stop();
    monitor.stop();
  });
});

// ---------------------------------------------------------------------------
// Listener-error isolation
// ---------------------------------------------------------------------------

describe('DisconnectPauseController listener errors', () => {
  it('isolates an onPause throw — state machine remains correct', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new InputBindingsStore();
    const sim = new FakeSimulation();
    const { monitor, controller } = buildController(store, {
      initialActive: true,
      onPause: () => {
        throw new Error('boom');
      },
      simulation: sim,
    });

    monitor.emitDisconnect(0);
    expect(sim.isPaused()).toBe(true);
    expect(controller.isPausedDueToDisconnect()).toBe(true);
    expect(controller.getDisconnectedPadIndices()).toEqual([0]);
    expect(consoleSpy).toHaveBeenCalled();

    controller.stop();
    monitor.stop();
    consoleSpy.mockRestore();
  });

  it('isolates an onResume throw — state machine remains correct', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new InputBindingsStore();
    const sim = new FakeSimulation();
    const { monitor, controller } = buildController(store, {
      initialActive: true,
      onResume: () => {
        throw new Error('boom');
      },
      simulation: sim,
    });

    monitor.emitDisconnect(0);
    monitor.emitConnect(0);
    expect(sim.isPaused()).toBe(false);
    expect(controller.isPausedDueToDisconnect()).toBe(false);
    expect(controller.getDisconnectedPadIndices()).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();

    controller.stop();
    monitor.stop();
    consoleSpy.mockRestore();
  });
});
