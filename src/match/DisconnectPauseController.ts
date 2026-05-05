/**
 * Disconnect-pause controller — AC 14 Sub-AC 2.
 *
 * Purpose
 * -------
 *
 * Sub-AC 1 wired the browser's `gamepadconnected` /
 * `gamepaddisconnected` events into the engine via
 * {@link GamepadConnectionMonitor} and exposed *which player slot* lost
 * its pad. Sub-AC 2 closes the loop: when a disconnect event fires for
 * a pad that is **actually mapped to a live human slot**, the running
 * match must immediately freeze input + simulation so the player who
 * just lost their controller doesn't watch their fighter walk off the
 * stage. Reconnect (or an explicit acknowledge) lifts the freeze.
 *
 * What "freeze input/simulation" means here
 * -----------------------------------------
 *
 * The deterministic engine is built around {@link GameLoop} (used via
 * {@link PhysicsEngine}). The MatchScene's `update()` calls
 * `physicsEngine.advance(deltaMs, step, render)` once per Phaser tick.
 * `step` is what samples inputs, captures the per-frame snapshot for
 * the replay system, calls `applyInput()` on each fighter, and then
 * steps the Matter world. When the loop is paused
 * ({@link GameLoop.pause}) the `tick()` short-circuits *before* calling
 * `step` — no input sample, no Matter integration, no advancement of
 * the simulation frame counter. Render still runs (so the screen stays
 * live and the pause-banner UI can refresh) but every gameplay-side
 * mutation is gated.
 *
 * That makes "pause the engine" the canonical implementation of
 * "freeze input + simulation": there is no separate input gate to
 * close because input sampling is itself part of the simulation step.
 *
 * Behaviour
 * ---------
 *
 *   • A `gamepaddisconnected` event whose `affectedSlots` list is
 *     **non-empty** — i.e. the pad that just left is bound to at least
 *     one human player slot — pauses the simulation and records the
 *     pad index in the controller's "currently disconnected" set.
 *   • A disconnect for a pad that nobody bound (e.g. a fifth pad
 *     unplugged from a 4-player match where only 2 slots use pads) is
 *     intentionally ignored. Pausing for it would be a UX false
 *     positive that has nothing to do with gameplay continuity.
 *   • A `gamepadconnected` event for a pad in the disconnected set
 *     removes that pad from the set. When the set goes empty the
 *     controller releases the pause it held; if other pads are still
 *     missing the freeze stays in effect (multi-pad pull-out case).
 *   • {@link DisconnectPauseController.acknowledgeAndResume} is the
 *     escape hatch for "I unplugged the pad on purpose, let me keep
 *     playing" — clears the tracked set and lifts the pause without
 *     waiting for a reconnect. Idempotent.
 *   • {@link DisconnectPauseController.setActive} flips the controller
 *     between live (mid-match) and dormant (menu / character select /
 *     post-match results). Disconnects fire all the time during menu
 *     navigation; pausing the not-yet-running match would be confusing.
 *     Going dormant additionally drops any tracked state and releases
 *     a pause we held — a player who walks back to the menu mid-pause
 *     should not find the pause echoed onto the next match they start.
 *
 * What this controller does *not* do
 * ----------------------------------
 *
 *   • It does not render the pause banner. The Phaser scene owns the
 *     UI; the controller fires `onPause` / `onResume` callbacks so the
 *     scene can update text, dim the canvas, etc.
 *   • It does not decide when a match is "live" — the scene flips
 *     `setActive(true)` once gameplay starts and `setActive(false)`
 *     on shutdown / transition to results.
 *   • It does not own pause for *any other reason* (the user pressing
 *     the pause button, the AI picker dialog, …). It only releases the
 *     simulation pause when **it** was the one that took it. This keeps
 *     it composable with a future player-driven pause without two
 *     subsystems fighting over the same `pause()` / `resume()` flag.
 *
 * Determinism
 * -----------
 *
 * Disconnect / connect events arrive asynchronously from the browser.
 * They affect the engine only by toggling pause; the simulation frame
 * counter does not advance during pause and the render layer is the
 * only thing that observes the pause toggle within the same animation
 * frame. The replay layer records disconnects as opaque "pad N gone at
 * frame F" markers (Sub-AC 1 design note) — playback re-fires those
 * markers in the same order, which deterministically reproduces the
 * pause windows.
 */

import type {
  GamepadConnectEvent,
  GamepadConnectionMonitor,
  GamepadDisconnectEvent,
} from '../input/GamepadConnectionMonitor';
import type { PlayerBindingsIndex } from '../types/inputBindings';

// ---------------------------------------------------------------------------
// Pausable simulation surface
// ---------------------------------------------------------------------------

/**
 * Minimal interface the controller needs to freeze the simulation. The
 * production wiring passes a {@link PhysicsEngine} (which forwards to
 * {@link GameLoop}); the unit tests pass a tiny mock so they don't need
 * to instantiate Matter.js.
 *
 * `isPaused` is exposed so the controller can preserve a third-party
 * pause (e.g. user-initiated) — if the simulation was already paused
 * when the disconnect arrived, the controller will not call `resume()`
 * later. Only pauses *taken by this controller* are released by it.
 */
export interface PausableSimulation {
  pause(): void;
  resume(): void;
  isPaused(): boolean;
}

// ---------------------------------------------------------------------------
// Public event payloads
// ---------------------------------------------------------------------------

/**
 * Delivered to {@link DisconnectPauseControllerOptions.onPause} every
 * time a qualifying disconnect arrives — including a *second* qualifying
 * disconnect while the controller is already holding the pause. The
 * scene can use the latter to refresh the banner text ("P1 + P3 lost
 * their controllers" instead of just "P1 lost their controller").
 */
export interface DisconnectPauseEvent {
  /** Pad that just disconnected. */
  readonly gamepadIndex: number;
  /** `Gamepad.id` from the browser, if known (may be ''). */
  readonly gamepadId: string;
  /** Slots the *triggering* pad was bound to. */
  readonly affectedSlots: ReadonlyArray<PlayerBindingsIndex>;
  /**
   * Sorted list of EVERY pad currently considered disconnected by
   * this controller (the triggering pad plus any earlier disconnects
   * not yet recovered). Useful for the multi-pad pull-out banner.
   */
  readonly disconnectedPadIndices: ReadonlyArray<number>;
  /**
   * Sorted union of every slot affected by the currently-disconnected
   * pads. Distinct from {@link affectedSlots} because that field
   * names just the triggering pad's slots.
   */
  readonly affectedSlotsTotal: ReadonlyArray<PlayerBindingsIndex>;
  /** Whether this event toggled the simulation pause from off → on. */
  readonly pauseEngaged: boolean;
  /** `GamepadEvent.timeStamp` when the trigger arrived. */
  readonly timestamp: number;
}

/**
 * Delivered to {@link DisconnectPauseControllerOptions.onResume} when a
 * tracked pad reconnects. If other pads are still missing the resume
 * is "partial" (`pauseReleased: false`) — the controller stays
 * subscribed to the next event but does not release its pause yet.
 */
export interface DisconnectResumeEvent {
  readonly gamepadIndex: number;
  readonly gamepadId: string;
  /** Pads still considered disconnected after this event. */
  readonly remainingDisconnectedPadIndices: ReadonlyArray<number>;
  /** Slots still affected after this event. */
  readonly remainingAffectedSlots: ReadonlyArray<PlayerBindingsIndex>;
  /** Whether this event lifted the simulation pause. */
  readonly pauseReleased: boolean;
  /**
   * Reason the resume fired. `'reconnect'` for a `gamepadconnected`
   * event clearing a tracked pad; `'acknowledge'` when
   * {@link DisconnectPauseController.acknowledgeAndResume} cleared the
   * state without a hardware reconnect (e.g. player chose to fill the
   * empty slot with a bot).
   */
  readonly reason: 'reconnect' | 'acknowledge';
  /** `GamepadEvent.timeStamp` if available; `0` for `'acknowledge'`. */
  readonly timestamp: number;
}

export type DisconnectPauseListener = (event: DisconnectPauseEvent) => void;
export type DisconnectResumeListener = (event: DisconnectResumeEvent) => void;

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface DisconnectPauseControllerOptions {
  /**
   * Source of disconnect / connect events. Typically the singleton
   * created in `MatchScene.create()` from
   * {@link GamepadConnectionMonitor} after Sub-AC 1 wiring.
   */
  readonly monitor: GamepadConnectionMonitor;

  /**
   * The simulation to pause. {@link PhysicsEngine} satisfies this
   * interface directly; tests pass a mock.
   */
  readonly simulation: PausableSimulation;

  /**
   * Optional pause listener — typically the scene's banner-show hook.
   * Errors are caught and logged so a buggy listener can't break the
   * controller's internal state machine.
   */
  readonly onPause?: DisconnectPauseListener;

  /** Symmetric resume listener — banner-hide / fade-out hook. */
  readonly onResume?: DisconnectResumeListener;

  /**
   * Initial active state. Defaults to `false` so a controller
   * constructed at scene-create time doesn't pause the engine on a
   * disconnect that fired during the create phase. The scene flips
   * to `true` once the match is live (after `start()` is called).
   */
  readonly initialActive?: boolean;
}

// ---------------------------------------------------------------------------
// Tracked state for a single disconnected pad
// ---------------------------------------------------------------------------

interface TrackedDisconnect {
  readonly gamepadId: string;
  readonly affectedSlots: ReadonlyArray<PlayerBindingsIndex>;
}

// ---------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------

/**
 * Glue between {@link GamepadConnectionMonitor} and
 * {@link PausableSimulation}. Stateless w.r.t. the simulation itself —
 * the controller only flips pause on/off; it does not snapshot any
 * gameplay state.
 *
 * Lifecycle:
 *
 *   const ctrl = new DisconnectPauseController({ monitor, simulation });
 *   ctrl.onPause = (e) => banner.show(e.affectedSlotsTotal);
 *   ctrl.onResume = (e) => banner.hide();
 *   ctrl.start();          // attach to monitor
 *   ctrl.setActive(true);  // match is live
 *
 *   // …mid-match:
 *   //   • pad pulled → monitor fires onDisconnect → controller pauses engine
 *   //   • pad replugged → monitor fires onConnect → controller resumes
 *
 *   // …on shutdown:
 *   ctrl.setActive(false);
 *   ctrl.stop();           // detach + drop state
 */
export class DisconnectPauseController {
  private readonly monitor: GamepadConnectionMonitor;
  private readonly simulation: PausableSimulation;
  private readonly onPauseCb: DisconnectPauseListener | null;
  private readonly onResumeCb: DisconnectResumeListener | null;

  private active: boolean;
  /** Pad index → snapshot of the disconnect event payload for that pad. */
  private readonly disconnectedPads: Map<number, TrackedDisconnect> = new Map();
  /**
   * True iff *we* called `simulation.pause()` since the last paired
   * `simulation.resume()`. Tracks our share of pause ownership so we
   * never accidentally release a pause that some other subsystem (a
   * player-pressed pause menu, a debug freeze) is also holding.
   */
  private holdingPause = false;

  /** Subscription teardown handles returned by the monitor. */
  private unsubDisconnect: (() => void) | null = null;
  private unsubConnect: (() => void) | null = null;

  constructor(options: DisconnectPauseControllerOptions) {
    if (!options || !options.monitor || !options.simulation) {
      throw new Error(
        'DisconnectPauseController: options.monitor and options.simulation are required.',
      );
    }
    this.monitor = options.monitor;
    this.simulation = options.simulation;
    this.onPauseCb = options.onPause ?? null;
    this.onResumeCb = options.onResume ?? null;
    this.active = options.initialActive ?? false;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Attach to the monitor. Idempotent — a paired `stop(); start()`
   * from a scene transition cannot leak listeners.
   */
  start(): void {
    if (this.unsubDisconnect !== null || this.unsubConnect !== null) return;
    this.unsubDisconnect = this.monitor.onDisconnect((e) => this.handleDisconnect(e));
    this.unsubConnect = this.monitor.onConnect((e) => this.handleReconnect(e));
  }

  /**
   * Detach from the monitor and release any pause WE held. Idempotent.
   *
   * Calling `stop()` while paused is the controller's "I'm shutting
   * down — clean up after myself" path: the engine resume guarantees
   * the next scene boots in a sane state instead of inheriting a
   * frozen loop. If the engine pause was *also* being held by another
   * subsystem (we don't currently have one, but a future user-pause
   * would qualify) the `holdingPause` guard prevents us from clobbering
   * its bookkeeping.
   */
  stop(): void {
    if (this.unsubDisconnect) {
      this.unsubDisconnect();
      this.unsubDisconnect = null;
    }
    if (this.unsubConnect) {
      this.unsubConnect();
      this.unsubConnect = null;
    }
    this.disconnectedPads.clear();
    if (this.holdingPause) {
      this.simulation.resume();
      this.holdingPause = false;
    }
  }

  /**
   * Flip the controller between live (mid-match) and dormant (menu /
   * character select / post-match results). Going dormant clears all
   * tracked state and releases any pause we held — see the module-
   * level rationale.
   */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) {
      this.disconnectedPads.clear();
      if (this.holdingPause) {
        this.simulation.resume();
        this.holdingPause = false;
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }

  /** True iff this controller is currently holding a simulation pause. */
  isPausedDueToDisconnect(): boolean {
    return this.holdingPause;
  }

  /** Sorted list of pads the controller currently considers disconnected. */
  getDisconnectedPadIndices(): ReadonlyArray<number> {
    return Object.freeze(Array.from(this.disconnectedPads.keys()).sort((a, b) => a - b));
  }

  /** Sorted union of slots affected by the currently-disconnected pads. */
  getAffectedSlots(): ReadonlyArray<PlayerBindingsIndex> {
    return this.aggregateAffectedSlots();
  }

  /**
   * Manual escape hatch: drop tracked state and lift the pause without
   * waiting for the missing pad to reconnect. The scene calls this
   * when the player presses "continue with bot" / "continue
   * unbound" in the disconnect banner, or when the scene transitions
   * to a context where the disconnect no longer matters. Idempotent.
   *
   * Fires `onResume` with `reason: 'acknowledge'` so the UI can
   * distinguish a hardware reconnect from a player-initiated dismiss
   * (e.g. for telemetry / log lines).
   */
  acknowledgeAndResume(): void {
    if (!this.holdingPause && this.disconnectedPads.size === 0) return;
    const wasPaused = this.holdingPause;
    this.disconnectedPads.clear();
    if (this.holdingPause) {
      this.simulation.resume();
      this.holdingPause = false;
    }
    this.fireResume(
      Object.freeze<DisconnectResumeEvent>({
        gamepadIndex: -1,
        gamepadId: '',
        remainingDisconnectedPadIndices: Object.freeze<number[]>([]),
        remainingAffectedSlots: Object.freeze<PlayerBindingsIndex[]>([]),
        pauseReleased: wasPaused,
        reason: 'acknowledge',
        timestamp: 0,
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  private handleDisconnect(event: GamepadDisconnectEvent): void {
    if (!this.active) return;
    // A pad nobody bound is a real disconnect but not a UX-meaningful
    // one. Skip it so we don't pause for a spurious 5th-pad pull during
    // a 2-pad match.
    if (event.affectedSlots.length === 0) return;

    this.disconnectedPads.set(event.gamepadIndex, {
      gamepadId: event.gamepadId,
      affectedSlots: event.affectedSlots,
    });

    let pauseEngaged = false;
    if (!this.holdingPause) {
      // The engine may already be paused by another subsystem (none
      // currently, but the seam is here for a future user-pause).
      // Either way we set the pause and remember WE are now also
      // holding it — the matched `resume()` only fires when this
      // flag is true.
      this.simulation.pause();
      this.holdingPause = true;
      pauseEngaged = true;
    }

    this.firePause(
      Object.freeze<DisconnectPauseEvent>({
        gamepadIndex: event.gamepadIndex,
        gamepadId: event.gamepadId,
        affectedSlots: event.affectedSlots,
        disconnectedPadIndices: this.getDisconnectedPadIndices(),
        affectedSlotsTotal: this.aggregateAffectedSlots(),
        pauseEngaged,
        timestamp: event.timestamp,
      }),
    );
  }

  private handleReconnect(event: GamepadConnectEvent): void {
    if (!this.active) return;
    // Reconnects for pads we never tracked don't matter — the engine
    // wasn't paused on their account and the pause-banner state has
    // nothing to update.
    if (!this.disconnectedPads.has(event.gamepadIndex)) return;

    this.disconnectedPads.delete(event.gamepadIndex);

    let pauseReleased = false;
    if (this.disconnectedPads.size === 0 && this.holdingPause) {
      this.simulation.resume();
      this.holdingPause = false;
      pauseReleased = true;
    }

    this.fireResume(
      Object.freeze<DisconnectResumeEvent>({
        gamepadIndex: event.gamepadIndex,
        gamepadId: event.gamepadId,
        remainingDisconnectedPadIndices: this.getDisconnectedPadIndices(),
        remainingAffectedSlots: this.aggregateAffectedSlots(),
        pauseReleased,
        reason: 'reconnect',
        timestamp: event.timestamp,
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private aggregateAffectedSlots(): ReadonlyArray<PlayerBindingsIndex> {
    if (this.disconnectedPads.size === 0) {
      return Object.freeze<PlayerBindingsIndex[]>([]);
    }
    const set = new Set<PlayerBindingsIndex>();
    for (const value of this.disconnectedPads.values()) {
      for (const slot of value.affectedSlots) set.add(slot);
    }
    return Object.freeze(Array.from(set).sort((a, b) => a - b));
  }

  private firePause(payload: DisconnectPauseEvent): void {
    if (!this.onPauseCb) return;
    try {
      this.onPauseCb(payload);
    } catch (err) {
      // One bad listener must not silence the controller or leave it
      // in a half-fired state. Surface to the console for the dev to
      // notice, then keep going.
      // eslint-disable-next-line no-console
      console.error('[DisconnectPauseController] onPause listener threw:', err);
    }
  }

  private fireResume(payload: DisconnectResumeEvent): void {
    if (!this.onResumeCb) return;
    try {
      this.onResumeCb(payload);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[DisconnectPauseController] onResume listener threw:', err);
    }
  }
}
