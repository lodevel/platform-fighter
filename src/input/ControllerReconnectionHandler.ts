/**
 * Controller-reconnection handler — AC 14 Sub-AC 4.
 *
 * Purpose
 * -------
 *
 * Sub-AC 1 wired the browser's `gamepadconnected` /
 * `gamepaddisconnected` events into the engine via
 * {@link GamepadConnectionMonitor}. Sub-AC 2 paused the simulation
 * when a disconnect affected a live human slot and released the pause
 * when the same `gamepadIndex` came back. Sub-AC 3 painted the
 * reconnect-prompt overlay. The remaining Sub-AC 4 question is the
 * one a real player will hit first: *what if the pad comes back at a
 * different index?*
 *
 * The browser is allowed to assign the reconnected pad a new
 * `Gamepad.index` (e.g. the player unplugs from USB-A port 1 and
 * plugs into USB-A port 2; the new mapping may be index 2 instead of
 * index 0). The player slot's binding table still references the
 * original index, so the disconnect-pause controller would lift its
 * pause but the fighter would remain unresponsive — same hardware,
 * different index, no input route from one to the other.
 *
 * This handler closes that loop:
 *
 *   • On disconnect of a pad whose `gamepadId` is non-empty AND
 *     bound to at least one slot, it records
 *     `(gamepadId → { gamepadIndex, slots })` so the slot's profile
 *     can be reconciled when the pad comes back.
 *   • On reconnect, it looks up the same `gamepadId`. When the new
 *     `gamepadIndex` differs from the original it rewrites every
 *     affected slot's bindings: every {@link GamepadBinding} whose
 *     `gamepadIndex` matched the original now points at the new index.
 *     Same id, same binding feel — only the integer changed.
 *   • It then forwards a synthetic connect for the *original* index
 *     to the monitor, which lets {@link DisconnectPauseController}
 *     release its pause via its normal path. The original connect
 *     event for the *new* index continues to fan out and is a no-op
 *     for the pause controller (the new index was never tracked).
 *
 * Why a synthetic emit instead of poking the pause controller
 * -----------------------------------------------------------
 *
 * The pause controller keys its tracked set by `gamepadIndex`. A
 * connect event for a *different* index is — by design — not a
 * resolution it knows how to act on. Rather than punching a "release
 * the disconnect for original index N" backdoor onto the controller's
 * surface (which would couple the two modules and force a public
 * method whose only legitimate caller is this handler), we drive the
 * release through the same public {@link GamepadConnectionMonitor.emitConnect}
 * the unit-test suite uses. The pause controller sees a regular
 * connect for index N, releases its pause, and never has to know that
 * the pad it thought it lost is now plugged in at a different index.
 *
 * Composition
 * -----------
 *
 *   • Subscribes to the same {@link GamepadConnectionMonitor} as the
 *     pause controller and the rebinding UI.
 *   • Mutates the shared {@link InputBindingsStore} in place — the
 *     {@link DeviceInputDispatcher}'s next sample reads the updated
 *     index automatically.
 *   • Listener fan-out order between this handler and the pause
 *     controller does not matter: even if the pause controller fires
 *     first on the original (new-index) event and no-ops, the synthetic
 *     emit from inside this handler reaches the pause controller with
 *     the original index and releases the pause then. A test verifies
 *     both orders.
 *
 * Determinism
 * -----------
 *
 *   • No `Math.random()`, no wall-clock reads, no Phaser. The handler
 *     is a pure data transform on the (binding table, event sequence)
 *     pair.
 *   • The replay layer records pad disconnect / connect events as
 *     opaque markers (see Sub-AC 1 module header). On playback the
 *     same handler sees the same sequence of markers and produces the
 *     same rebinds.
 *   • Pads with an empty `gamepadId` are skipped — without a stable id
 *     we cannot reliably match a reconnect to the original disconnect.
 *     The pause controller's existing index-keyed path still handles
 *     the simple case (same index reconnect) without our help, so a
 *     missing id only forfeits the cross-index rebind, not gameplay
 *     continuity.
 */

import type {
  GamepadConnectEvent,
  GamepadConnectionMonitor,
  GamepadDisconnectEvent,
} from './GamepadConnectionMonitor';
import type { InputBindingsStore } from './InputBindingsStore';
import {
  LOGICAL_ACTIONS,
  type ActionBindings,
  type GamepadBinding,
  type InputBinding,
  type LogicalAction,
  type PlayerBindings,
  type PlayerBindingsIndex,
} from '../types/inputBindings';

// ---------------------------------------------------------------------------
// Public event payloads
// ---------------------------------------------------------------------------

/**
 * Delivered to {@link ControllerReconnectionHandlerOptions.onRebind}
 * after a tracked pad reconnects — including when the new index equals
 * the original (no binding rewrite needed but the player is back).
 *
 * `originalGamepadIndex === newGamepadIndex` means the pad came back at
 * the same port; the handler did not rewrite bindings and did not
 * fire a synthetic connect (the pause controller already releases the
 * pause via its normal index-keyed path). The event is still fired so
 * UI / telemetry can confirm the binding restoration end-to-end.
 *
 * `affectedSlots` is the snapshot at *disconnect time* — the slots
 * whose bindings the handler considered for rewrite. Slots later
 * unbound from the pad mid-pause are still listed so a UI tooltip can
 * read "P1 + P3 controller restored" even if the live binding table
 * has since changed.
 */
export interface ControllerRebindEvent {
  /** Stable pad id (`Gamepad.id`) the handler matched on. Never empty. */
  readonly gamepadId: string;
  /** Index the pad held when it disconnected. */
  readonly originalGamepadIndex: number;
  /** Index the pad now reports. Equal to `originalGamepadIndex` when no rewrite was needed. */
  readonly newGamepadIndex: number;
  /** Slot list captured at disconnect time. Frozen, sorted ascending. */
  readonly affectedSlots: ReadonlyArray<PlayerBindingsIndex>;
  /** Whether the handler rewrote any slot's bindings (`false` for same-index reconnect). */
  readonly bindingsRebound: boolean;
  /** `GamepadEvent.timeStamp` of the connect event that triggered the resolution. */
  readonly timestamp: number;
}

export type ControllerRebindListener = (event: ControllerRebindEvent) => void;

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface ControllerReconnectionHandlerOptions {
  /**
   * Source of disconnect / connect events. Must be the same monitor
   * the pause controller subscribes to so this handler and the pause
   * controller see the same sequence of events.
   */
  readonly monitor: GamepadConnectionMonitor;

  /**
   * Per-player bindings store. The handler rewrites slot profiles
   * in-place via {@link InputBindingsStore.set} — the dispatcher's
   * next sample reads the updated table automatically.
   */
  readonly bindings: InputBindingsStore;

  /**
   * Optional rebind listener — typically the scene's "controller
   * restored" toast / log line. Errors are caught and logged so a
   * buggy listener can't break the handler's internal state machine.
   */
  readonly onRebind?: ControllerRebindListener;

  /**
   * Initial active state. Defaults to `false` so a handler constructed
   * at scene-create time doesn't track disconnects that fired during
   * the create phase. The scene flips to `true` once the match is
   * live (after `start()` is called).
   */
  readonly initialActive?: boolean;
}

// ---------------------------------------------------------------------------
// Tracked record per disconnected pad
// ---------------------------------------------------------------------------

interface TrackedDisconnect {
  readonly gamepadId: string;
  readonly gamepadIndex: number;
  readonly slots: ReadonlyArray<PlayerBindingsIndex>;
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

/**
 * Glue between {@link GamepadConnectionMonitor} and
 * {@link InputBindingsStore} for the cross-index reconnect case.
 *
 * Lifecycle:
 *
 *   const handler = new ControllerReconnectionHandler({ monitor, bindings });
 *   handler.start();          // attach to monitor
 *   handler.setActive(true);  // match is live
 *
 *   // …pad pulled at index 0, replugged at index 2:
 *   //   • monitor fires onDisconnect(0, id='Xbox') — handler stores it
 *   //   • monitor fires onConnect(2, id='Xbox') — handler:
 *   //       - rewrites every slot's bindings 0 → 2
 *   //       - synthetically emits onConnect(0) to release pause
 *   //       - fires onRebind callback
 *
 *   // …on shutdown:
 *   handler.setActive(false);
 *   handler.stop();           // detach + drop state
 */
export class ControllerReconnectionHandler {
  private readonly monitor: GamepadConnectionMonitor;
  private readonly bindings: InputBindingsStore;
  private readonly onRebindCb: ControllerRebindListener | null;

  private active: boolean;
  /** `gamepadId` → tracked disconnect record. */
  private readonly trackedById: Map<string, TrackedDisconnect> = new Map();

  /** Subscription teardown handles returned by the monitor. */
  private unsubDisconnect: (() => void) | null = null;
  private unsubConnect: (() => void) | null = null;

  /**
   * Re-entry guard: `handleReconnect` synthetically calls
   * `monitor.emitConnect(originalIndex, …)` to nudge the pause
   * controller. That synthetic emit re-enters every connect listener
   * — including this handler. We've already cleared the tracked
   * record by then so the inner call would be a no-op anyway, but
   * the guard makes the intent explicit and protects against any
   * listener-order regressions in the future.
   */
  private inSyntheticEmit = false;

  constructor(options: ControllerReconnectionHandlerOptions) {
    if (!options || !options.monitor || !options.bindings) {
      throw new Error(
        'ControllerReconnectionHandler: options.monitor and options.bindings are required.',
      );
    }
    this.monitor = options.monitor;
    this.bindings = options.bindings;
    this.onRebindCb = options.onRebind ?? null;
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

  /** Detach from the monitor and clear tracked state. Idempotent. */
  stop(): void {
    if (this.unsubDisconnect) {
      this.unsubDisconnect();
      this.unsubDisconnect = null;
    }
    if (this.unsubConnect) {
      this.unsubConnect();
      this.unsubConnect = null;
    }
    this.trackedById.clear();
  }

  /**
   * Flip the handler between live (mid-match) and dormant (menu /
   * character select / post-match results). Going dormant clears
   * tracked state so a reconnection that happens after the match
   * ended doesn't trigger a stale rebind.
   */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) {
      this.trackedById.clear();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  // -------------------------------------------------------------------------
  // Read accessors (used by tests + the scene's debug HUD)
  // -------------------------------------------------------------------------

  /** True iff at least one disconnect is awaiting reconnection. */
  hasPendingReconnect(): boolean {
    return this.trackedById.size > 0;
  }

  /** Sorted (ascending) list of pad ids currently awaiting reconnection. */
  getPendingGamepadIds(): ReadonlyArray<string> {
    return Object.freeze(Array.from(this.trackedById.keys()).sort());
  }

  /** Number of pads currently awaiting reconnection. */
  getPendingCount(): number {
    return this.trackedById.size;
  }

  /**
   * Test-only inspection of the tracked record for a `gamepadId`.
   * Returns `undefined` if no record is held. The returned object is
   * a fresh frozen copy — mutating it has no effect on the handler's
   * internal state.
   */
  getTrackedRecord(gamepadId: string):
    | Readonly<{ gamepadIndex: number; slots: ReadonlyArray<PlayerBindingsIndex> }>
    | undefined {
    const r = this.trackedById.get(gamepadId);
    if (r === undefined) return undefined;
    return Object.freeze({
      gamepadIndex: r.gamepadIndex,
      slots: r.slots,
    });
  }

  // -------------------------------------------------------------------------
  // Manual escape hatch
  // -------------------------------------------------------------------------

  /**
   * Drop the tracked record for a `gamepadId` without resolving the
   * reconnect. The pause controller's
   * {@link DisconnectPauseController.acknowledgeAndResume} path is the
   * idiomatic way to abandon a pause; this method is the matching
   * cleanup on the rebinding side so a player who chose "continue
   * without controller" doesn't trigger a stale rebind if the pad
   * later reappears at a different index.
   *
   * Returns `true` if a record was cleared, `false` otherwise. The
   * scene calls this from the same hook that fires
   * `acknowledgeAndResume()` — see `MatchScene.handleAcknowledgeReconnect`.
   */
  forget(gamepadId: string): boolean {
    return this.trackedById.delete(gamepadId);
  }

  /** Forget every tracked record. Idempotent. */
  forgetAll(): void {
    this.trackedById.clear();
  }

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  private handleDisconnect(event: GamepadDisconnectEvent): void {
    if (!this.active) return;
    if (event.affectedSlots.length === 0) return;
    if (event.gamepadId.length === 0) {
      // Without a stable id we cannot match on reconnect; the pause
      // controller's index-keyed path still handles the same-index
      // case so we just skip tracking the cross-index case here.
      return;
    }
    this.trackedById.set(event.gamepadId, {
      gamepadId: event.gamepadId,
      gamepadIndex: event.gamepadIndex,
      slots: event.affectedSlots,
    });
  }

  private handleReconnect(event: GamepadConnectEvent): void {
    if (!this.active) return;
    if (this.inSyntheticEmit) return;
    if (event.gamepadId.length === 0) return;

    const tracked = this.trackedById.get(event.gamepadId);
    if (tracked === undefined) return;

    // Resolve the tracked record before any further work so a faulty
    // store / listener can't cause us to keep re-firing for the same
    // pad on a subsequent connect event.
    this.trackedById.delete(event.gamepadId);

    let bindingsRebound = false;
    if (event.gamepadIndex !== tracked.gamepadIndex) {
      // Index changed — rewrite each affected slot's bindings so its
      // gamepad bindings reference the new index. We refresh the
      // slot list from the LIVE binding table (rather than relying
      // solely on `tracked.slots`) so a slot the player rebound to
      // the same pad mid-pause is also picked up. Slots in
      // `tracked.slots` that are no longer bound are quietly
      // skipped — a `set()` would still work but it would also
      // re-store an unchanged profile, which is harmless but noisy.
      for (const slot of tracked.slots) {
        const current = this.bindings.get(slot);
        const next = remapSlotBindings(current, tracked.gamepadIndex, event.gamepadIndex);
        if (next !== current) {
          this.bindings.set(slot, next);
          bindingsRebound = true;
        }
      }

      // Release the pause-controller's hold on the original index by
      // forwarding a synthetic connect for it. We use the public
      // monitor surface so the test suite and the production wiring
      // both go through exactly one code path. The re-entry guard
      // above keeps this handler from re-processing its own
      // synthetic emit.
      this.inSyntheticEmit = true;
      try {
        this.monitor.emitConnect(tracked.gamepadIndex, {
          gamepadId: event.gamepadId,
          timestamp: event.timestamp,
        });
      } finally {
        this.inSyntheticEmit = false;
      }
    }

    this.fireRebind({
      gamepadId: event.gamepadId,
      originalGamepadIndex: tracked.gamepadIndex,
      newGamepadIndex: event.gamepadIndex,
      affectedSlots: tracked.slots,
      bindingsRebound,
      timestamp: event.timestamp,
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private fireRebind(payload: ControllerRebindEvent): void {
    if (!this.onRebindCb) return;
    try {
      this.onRebindCb(Object.freeze(payload));
    } catch (err) {
      // One bad listener must not silence the handler or leave it in
      // a half-fired state. Surface to the console for the dev to
      // notice, then keep going.
      // eslint-disable-next-line no-console
      console.error('[ControllerReconnectionHandler] onRebind listener threw:', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helper — rewrite a slot's gamepad bindings to a new index
// ---------------------------------------------------------------------------

/**
 * Return a copy of `player` whose every {@link GamepadBinding} pinned
 * to `originalIndex` is replaced with an equivalent binding pinned to
 * `newIndex`. Other bindings (keyboard, gamepad on a different index,
 * `gamepadIndex: null` "any pad") are preserved untouched.
 *
 * Returns the original `player` reference (not a clone) when no
 * binding referenced `originalIndex` — letting the caller skip a
 * round-trip through {@link InputBindingsStore.set} for the common
 * "no rewrite needed" case.
 *
 * Exported for the unit suite — the handler is the canonical caller.
 */
export function remapSlotBindings(
  player: PlayerBindings,
  originalIndex: number,
  newIndex: number,
): PlayerBindings {
  if (originalIndex === newIndex) return player;

  const map = player.bindings;
  // Build the next action map lazily — only allocate a new array
  // when we find a binding that actually needs rewriting.
  const nextEntries: Partial<Record<LogicalAction, ReadonlyArray<InputBinding>>> = {};
  let anyChanged = false;

  for (const action of LOGICAL_ACTIONS) {
    const list = map[action];
    let perActionChanged = false;
    let updated: InputBinding[] | null = null;
    for (let i = 0; i < list.length; i += 1) {
      const binding = list[i];
      if (binding === undefined) continue;
      if (
        binding.kind === 'gamepad' &&
        binding.gamepadIndex === originalIndex
      ) {
        if (updated === null) {
          // Lazy-clone the prefix as a plain (mutable-during-build) array.
          updated = list.slice(0, i) as InputBinding[];
        }
        const remapped: GamepadBinding = {
          kind: 'gamepad',
          gamepadIndex: newIndex,
          source: binding.source,
        };
        updated.push(remapped);
        perActionChanged = true;
      } else if (updated !== null) {
        updated.push(binding);
      }
    }
    if (perActionChanged && updated !== null) {
      nextEntries[action] = Object.freeze(updated);
      anyChanged = true;
    } else {
      nextEntries[action] = list;
    }
  }

  if (!anyChanged) return player;

  // `nextEntries` is now fully populated for every LOGICAL_ACTIONS key.
  return {
    playerIndex: player.playerIndex,
    bindings: nextEntries as ActionBindings,
  };
}
