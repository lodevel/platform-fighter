/**
 * Gamepad connection monitor — AC 14 Sub-AC 1.
 *
 * Purpose
 * -------
 *
 * The Seed promises "controller disconnect detection that identifies which
 * player slot lost connection." On the web that signal lives at exactly
 * one place — the `gamepadconnected` / `gamepaddisconnected` events the
 * browser fires on `window` whenever a pad is plugged in or pulled out.
 * Polling `navigator.getGamepads()` and comparing snapshots can in theory
 * detect the same edges, but the events are precise (single fire per
 * change), already carry the {@link Gamepad} object whose `index` and
 * `id` we need, and avoid burning a per-frame diff against a 4-slot
 * array. The {@link GamepadSource} adapter introduced in Sub-AC 3 of the
 * device dispatcher already handles "is this pad connected *right now*?"
 * for the per-frame read path; this module fills in the remaining
 * "*who* just lost their pad?" question.
 *
 * What "which player slot" means here
 * -----------------------------------
 *
 * A {@link PlayerBindings} record may carry zero or more
 * {@link GamepadBinding}s — each pinned to a specific
 * `gamepadIndex` (per the schema in `src/types/inputBindings.ts`). When
 * pad index *N* disconnects, the affected slots are those whose binding
 * table references *N* under any logical action. That mapping is built
 * from the bindings, not hard-coded against the default-slot table
 * (`slot 3 → pad 0`, `slot 4 → pad 1`), because:
 *
 *   • The rebinding screen lets a player on slot 1 layer a gamepad
 *     binding on top of their keyboard table — pulling that pad must
 *     surface them too, or the pause-menu UI will say "no slot was
 *     affected" while the player just lost half their attack inputs.
 *   • The defaults are *defaults*, not invariants. A future preset
 *     swap (e.g. forced "all-pad" mode) must just work without this
 *     module needing a config edit.
 *
 * `gamepadIndex: null` bindings ("any pad" — used for menu confirms)
 * are intentionally **not** treated as affected by a single-pad
 * disconnect. A menu confirm bound to "any pad" still works on the
 * remaining pads, so flagging the slot as "lost" would be a false
 * positive that the UI would have to filter out anyway. This matches
 * the dispatcher's "any pad" semantics in
 * {@link DeviceInputDispatcher.isGamepadHeld}.
 *
 * Architecture
 * ------------
 *
 *   • Stateless w.r.t. gameplay. The monitor only caches the last known
 *     pad `id` per index so the connect-event payload can carry the
 *     same `gamepadId` the disconnect event later reports — useful for
 *     reconciliation by id when the browser reuses an index.
 *   • Pluggable {@link EventTarget}. The browser runtime passes
 *     `globalThis.window`; the unit-test suite passes a minimal
 *     `MockEventTarget` so we don't drag in jsdom for a feature that
 *     touches DOM events but doesn't render anything.
 *   • Idempotent `start()` / `stop()`. The pause-menu / character-select
 *     scene mounts and unmounts the monitor as part of its lifecycle;
 *     double-calls must be no-ops so a hasty `stop(); start()` from a
 *     scene transition can't leak listeners.
 *   • No `Math.random()`, no wall-clock reads (the timestamp on the
 *     event payload comes from the {@link GamepadEvent} itself, which
 *     the replay layer already records as part of the input stream
 *     when relevant). No Phaser.
 *
 * Determinism
 * -----------
 *
 * The monitor's *output* — the affected-slot list given a disconnect —
 * is a pure function of the {@link PlayerBindingsProvider} state at the
 * moment the event is processed. The replay layer can therefore record
 * disconnects as opaque "pad N gone at frame F" markers and reconstruct
 * the affected-slot list on playback from the recorded binding table at
 * frame F without storing it in the replay payload.
 */

import type {
  GamepadBinding,
  InputBinding,
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';
import type { PlayerBindingsProvider } from './DeviceInputDispatcher';

// ---------------------------------------------------------------------------
// Public event payloads
// ---------------------------------------------------------------------------

/**
 * Event delivered to {@link GamepadConnectionMonitor.onDisconnect} when a
 * pad disconnects. `affectedSlots` is the list of player slots whose
 * binding table referenced the disconnected pad's index — this is
 * exactly the set of human players the UI must warn or pause for.
 *
 * Slots are returned in ascending order so a UI rendering "P1 + P3
 * lost their controller" gets the same string regardless of which slot
 * the bindings provider iterates first.
 */
export interface GamepadDisconnectEvent {
  /** `Gamepad.index` of the pad that disconnected. */
  readonly gamepadIndex: number;
  /** `Gamepad.id` reported by the browser at disconnect time. May be the empty string on some UAs. */
  readonly gamepadId: string;
  /** Player slots (1..4) whose bindings referenced this pad index. Empty if no slot was bound. */
  readonly affectedSlots: ReadonlyArray<PlayerBindingsIndex>;
  /** `GamepadEvent.timeStamp` (DOMHighResTimeStamp) at the moment the browser fired the event. */
  readonly timestamp: number;
}

/**
 * Event delivered to {@link GamepadConnectionMonitor.onConnect} when a
 * pad connects (or reconnects). Symmetric with {@link GamepadDisconnectEvent}
 * — `affectedSlots` lists slots whose bindings already reference the
 * newly-connected pad's index, so a "P3's controller is back online"
 * banner can be raised on reconnect without a separate slot-lookup pass.
 */
export interface GamepadConnectEvent {
  readonly gamepadIndex: number;
  readonly gamepadId: string;
  readonly affectedSlots: ReadonlyArray<PlayerBindingsIndex>;
  readonly timestamp: number;
}

/** Listener for {@link GamepadConnectionMonitor.onDisconnect}. */
export type GamepadDisconnectListener = (event: GamepadDisconnectEvent) => void;

/** Listener for {@link GamepadConnectionMonitor.onConnect}. */
export type GamepadConnectListener = (event: GamepadConnectEvent) => void;

// ---------------------------------------------------------------------------
// Pluggable EventTarget
// ---------------------------------------------------------------------------

/**
 * Minimal `EventTarget` surface the monitor consumes. Narrower than the
 * DOM `EventTarget` so:
 *
 *   • The unit tests can supply a plain object backed by a `Map<type,
 *     Set<listener>>` without dragging jsdom in.
 *   • Future runtimes (e.g. an Electron main process that wants to
 *     forward connect events through IPC) can implement just this
 *     surface without a polyfill.
 *
 * The monitor only ever subscribes to the two gamepad events; that's
 * the entire vocabulary it cares about.
 */
export interface GamepadEventTargetLike {
  addEventListener(
    type: 'gamepadconnected' | 'gamepaddisconnected',
    listener: (event: GamepadEvent) => void,
  ): void;
  removeEventListener(
    type: 'gamepadconnected' | 'gamepaddisconnected',
    listener: (event: GamepadEvent) => void,
  ): void;
}

/**
 * Resolve the default browser event target. Returns `null` in non-DOM
 * environments (Node test runners, SSR, the deterministic-replay
 * harness) so the monitor can no-op cleanly instead of throwing on
 * import. The browser path passes the resolved value into `start()`;
 * the test path passes a mock and never touches this helper.
 */
export function resolveDefaultGamepadEventTarget(): GamepadEventTargetLike | null {
  // `globalThis.window` is the canonical browser source. We could read
  // `globalThis.addEventListener` directly but that would also fire on
  // workers and unrelated globals — `window` is what the spec says
  // hosts the gamepad events.
  const w = (globalThis as { window?: GamepadEventTargetLike }).window;
  if (!w || typeof w.addEventListener !== 'function' || typeof w.removeEventListener !== 'function') {
    return null;
  }
  return w;
}

// ---------------------------------------------------------------------------
// Pure helper — slot affinity for a pad index
// ---------------------------------------------------------------------------

/**
 * Default ordered slot list. Exposed so callers (the monitor, the
 * pause-menu UI) iterate the same canonical 1..4 every time. Frozen so
 * accidental in-place mutation doesn't reorder the disconnect payload.
 */
export const ALL_PLAYER_SLOTS: ReadonlyArray<PlayerBindingsIndex> = Object.freeze([1, 2, 3, 4]);

/**
 * Inspect a player's binding table and return `true` iff at least one
 * of its bindings is a {@link GamepadBinding} pinned to `gamepadIndex`.
 *
 *   • `gamepadIndex: null` ("any pad") bindings are intentionally
 *     **excluded** — they survive a single-pad disconnect because they
 *     listen to every pad. Documented on the module header.
 *   • `KeyboardBinding`s never match.
 *
 * Exported for the rebinding UI's "this slot is bound to which pad?"
 * panel and for the unit tests; the monitor uses it under the hood.
 */
export function isPlayerBoundToGamepad(
  bindings: PlayerBindings,
  gamepadIndex: number,
): boolean {
  // Every {@link LogicalAction} key is guaranteed present on the record
  // by the `Record<LogicalAction, …>` schema (`noUncheckedIndexedAccess`
  // forces us to handle the array reads explicitly anyway).
  const map = bindings.bindings;
  for (const action in map) {
    /* istanbul ignore next — `for...in` over a frozen Record only iterates own enumerable keys. */
    if (!Object.prototype.hasOwnProperty.call(map, action)) continue;
    const list = map[action as keyof typeof map];
    for (let i = 0; i < list.length; i += 1) {
      const binding: InputBinding | undefined = list[i];
      if (binding === undefined) continue;
      if (binding.kind !== 'gamepad') continue;
      const gp: GamepadBinding = binding;
      if (gp.gamepadIndex === gamepadIndex) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Pure helper: list every slot whose bindings reference a specific
 * `gamepadIndex`. Iterates `slots` (defaults to {@link ALL_PLAYER_SLOTS})
 * in order so the resulting list is deterministic and stable across
 * runs — the rebinding UI and the replay-debug overlay can both rely
 * on "P1 then P3" ordering without re-sorting.
 *
 * Returns a frozen array so callers can't accidentally mutate the
 * payload that the monitor will later hand to listeners.
 */
export function findSlotsBoundToGamepad(
  bindings: PlayerBindingsProvider,
  gamepadIndex: number,
  slots: ReadonlyArray<PlayerBindingsIndex> = ALL_PLAYER_SLOTS,
): ReadonlyArray<PlayerBindingsIndex> {
  if (!Number.isInteger(gamepadIndex) || gamepadIndex < 0) {
    // The Gamepad API never reports a negative or fractional index, but
    // the helper is exported and may be called from UI code with a
    // looser source. Returning an empty list (rather than throwing)
    // keeps the call site simple — `affectedSlots.length === 0` is
    // already the "no slot affected" signal.
    return Object.freeze([]);
  }
  const matches: PlayerBindingsIndex[] = [];
  for (const slot of slots) {
    const profile = bindings.get(slot);
    if (isPlayerBoundToGamepad(profile, gamepadIndex)) {
      matches.push(slot);
    }
  }
  return Object.freeze(matches);
}

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------

/** Constructor options. */
export interface GamepadConnectionMonitorOptions {
  /**
   * Provider for the live binding table. Re-read on every disconnect /
   * connect event so a slot rebinding committed mid-match is reflected
   * the next time a pad goes in or out.
   */
  readonly bindings: PlayerBindingsProvider;

  /**
   * Source of `gamepadconnected` / `gamepaddisconnected` events. Defaults
   * to {@link resolveDefaultGamepadEventTarget} (i.e. `window`) when
   * omitted. Pass an explicit value in unit tests / non-browser
   * runtimes; pass `null` to construct a "would-be-active" monitor whose
   * `start()` is a no-op (useful for replay headless mode).
   */
  readonly eventTarget?: GamepadEventTargetLike | null;

  /**
   * Optional override for the slot iteration order — same purpose as the
   * argument on {@link findSlotsBoundToGamepad}. Defaults to all four
   * slots in ascending order.
   */
  readonly slots?: ReadonlyArray<PlayerBindingsIndex>;
}

/**
 * Subscribes to the browser's `gamepadconnected` / `gamepaddisconnected`
 * events and translates each one into a {@link GamepadDisconnectEvent} /
 * {@link GamepadConnectEvent} carrying the affected player slots.
 *
 * Lifecycle (typical):
 *
 *   const monitor = new GamepadConnectionMonitor({ bindings: store });
 *   monitor.onDisconnect((e) => pauseMenu.showLostController(e.affectedSlots));
 *   monitor.onConnect((e) => pauseMenu.showRecoveredController(e.affectedSlots));
 *   monitor.start();
 *
 *   // …later, on scene shutdown / settings exit:
 *   monitor.stop();
 *
 * Subscriber errors are caught individually so one buggy listener can't
 * break the others or leave the monitor in a half-fired state.
 */
export class GamepadConnectionMonitor {
  private readonly bindings: PlayerBindingsProvider;
  private readonly eventTarget: GamepadEventTargetLike | null;
  private readonly slots: ReadonlyArray<PlayerBindingsIndex>;

  private readonly disconnectListeners: Set<GamepadDisconnectListener> = new Set();
  private readonly connectListeners: Set<GamepadConnectListener> = new Set();

  /** Last-seen pad id by index — used to enrich disconnect payloads when the event omits id. */
  private readonly lastSeenIds: Map<number, string> = new Map();

  private started = false;

  // Bound DOM handlers — stored on the instance so `removeEventListener`
  // can hand back the *same* function reference.
  private readonly handleConnected: (event: GamepadEvent) => void;
  private readonly handleDisconnected: (event: GamepadEvent) => void;

  constructor(options: GamepadConnectionMonitorOptions) {
    if (!options || !options.bindings) {
      throw new Error('GamepadConnectionMonitor: options.bindings is required.');
    }
    this.bindings = options.bindings;
    this.eventTarget =
      options.eventTarget === undefined ? resolveDefaultGamepadEventTarget() : options.eventTarget;
    this.slots = options.slots ?? ALL_PLAYER_SLOTS;

    // Pre-bind so listener identity is stable across subscriptions.
    this.handleConnected = (event: GamepadEvent): void => this.onBrowserConnect(event);
    this.handleDisconnected = (event: GamepadEvent): void => this.onBrowserDisconnect(event);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Attach the browser event listeners. Idempotent — calling `start()`
   * twice in a row attaches them only once. No-op if no event target was
   * resolved (non-DOM environment, or `eventTarget: null` was passed).
   */
  start(): void {
    if (this.started) return;
    if (!this.eventTarget) {
      // Mark started so a paired stop() is symmetric, even though there
      // is nothing to detach. This keeps scene-lifecycle code simple.
      this.started = true;
      return;
    }
    this.eventTarget.addEventListener('gamepadconnected', this.handleConnected);
    this.eventTarget.addEventListener('gamepaddisconnected', this.handleDisconnected);
    this.started = true;
  }

  /**
   * Detach the browser event listeners. Idempotent — safe to call from a
   * scene `shutdown` callback that may run after a failed `start()`.
   */
  stop(): void {
    if (!this.started) return;
    if (this.eventTarget) {
      this.eventTarget.removeEventListener('gamepadconnected', this.handleConnected);
      this.eventTarget.removeEventListener('gamepaddisconnected', this.handleDisconnected);
    }
    this.started = false;
  }

  /** True iff `start()` has been called more recently than `stop()`. */
  isStarted(): boolean {
    return this.started;
  }

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  /**
   * Register a disconnect listener. Returns an unsubscribe function so
   * the caller can drop the subscription without juggling listener
   * identity (the typical "useEffect cleanup" pattern).
   */
  onDisconnect(listener: GamepadDisconnectListener): () => void {
    this.disconnectListeners.add(listener);
    return (): void => {
      this.disconnectListeners.delete(listener);
    };
  }

  /** Symmetric with {@link onDisconnect} for the `gamepadconnected` event. */
  onConnect(listener: GamepadConnectListener): () => void {
    this.connectListeners.add(listener);
    return (): void => {
      this.connectListeners.delete(listener);
    };
  }

  // -------------------------------------------------------------------------
  // Direct helpers (used by the pause-menu / settings UI)
  // -------------------------------------------------------------------------

  /**
   * Look up which slots are currently bound to a given pad index. Pure
   * delegate to {@link findSlotsBoundToGamepad} using this monitor's
   * configured `bindings` + `slots`.
   */
  getAffectedSlots(gamepadIndex: number): ReadonlyArray<PlayerBindingsIndex> {
    return findSlotsBoundToGamepad(this.bindings, gamepadIndex, this.slots);
  }

  /**
   * Last-seen pad id at a given index, or the empty string if the
   * monitor never observed a connect event for that index. Useful for
   * the pause-menu UI to display "Xbox 360 Controller (P3) disconnected"
   * even when the disconnect event itself omits the id (some UAs do).
   */
  getLastKnownGamepadId(gamepadIndex: number): string {
    return this.lastSeenIds.get(gamepadIndex) ?? '';
  }

  // -------------------------------------------------------------------------
  // Manual fan-out (used by tests + replay harness)
  // -------------------------------------------------------------------------

  /**
   * Programmatic disconnect entry-point — the same path the browser
   * event listener takes, exposed so the replay harness and the unit
   * tests can drive it without synthesising a full `GamepadEvent`.
   *
   * `gamepadId` defaults to the last-seen id for the index (or empty
   * string if none); `timestamp` defaults to `0` so test fixtures
   * compare cleanly.
   */
  emitDisconnect(
    gamepadIndex: number,
    options: { readonly gamepadId?: string; readonly timestamp?: number } = {},
  ): GamepadDisconnectEvent {
    const event = this.buildDisconnectEvent(
      gamepadIndex,
      options.gamepadId ?? this.lastSeenIds.get(gamepadIndex) ?? '',
      options.timestamp ?? 0,
    );
    this.lastSeenIds.delete(gamepadIndex);
    this.fireDisconnect(event);
    return event;
  }

  /** Programmatic connect — symmetric with {@link emitDisconnect}. */
  emitConnect(
    gamepadIndex: number,
    options: { readonly gamepadId?: string; readonly timestamp?: number } = {},
  ): GamepadConnectEvent {
    const id = options.gamepadId ?? '';
    this.lastSeenIds.set(gamepadIndex, id);
    const event = this.buildConnectEvent(gamepadIndex, id, options.timestamp ?? 0);
    this.fireConnect(event);
    return event;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private onBrowserConnect(event: GamepadEvent): void {
    const pad = event.gamepad;
    /* istanbul ignore next — every spec-compliant UA populates `event.gamepad`. */
    if (!pad) return;
    const id = typeof pad.id === 'string' ? pad.id : '';
    this.lastSeenIds.set(pad.index, id);
    this.fireConnect(this.buildConnectEvent(pad.index, id, event.timeStamp));
  }

  private onBrowserDisconnect(event: GamepadEvent): void {
    const pad = event.gamepad;
    /* istanbul ignore next — every spec-compliant UA populates `event.gamepad`. */
    if (!pad) return;
    const id = typeof pad.id === 'string' && pad.id !== '' ? pad.id : this.lastSeenIds.get(pad.index) ?? '';
    const payload = this.buildDisconnectEvent(pad.index, id, event.timeStamp);
    this.lastSeenIds.delete(pad.index);
    this.fireDisconnect(payload);
  }

  private buildDisconnectEvent(
    gamepadIndex: number,
    gamepadId: string,
    timestamp: number,
  ): GamepadDisconnectEvent {
    return Object.freeze({
      gamepadIndex,
      gamepadId,
      affectedSlots: findSlotsBoundToGamepad(this.bindings, gamepadIndex, this.slots),
      timestamp,
    });
  }

  private buildConnectEvent(
    gamepadIndex: number,
    gamepadId: string,
    timestamp: number,
  ): GamepadConnectEvent {
    return Object.freeze({
      gamepadIndex,
      gamepadId,
      affectedSlots: findSlotsBoundToGamepad(this.bindings, gamepadIndex, this.slots),
      timestamp,
    });
  }

  private fireDisconnect(event: GamepadDisconnectEvent): void {
    // Snapshot before iterating so a listener that unsubscribes itself
    // (or another listener) doesn't reorder the fan-out for the
    // remaining listeners on this fire.
    const snapshot = Array.from(this.disconnectListeners);
    for (const listener of snapshot) {
      try {
        listener(event);
      } catch (err) {
        // One bad subscriber must not silence the others or leave the
        // monitor in a half-fired state. Surface to the console for the
        // dev to notice, then keep iterating.
        // eslint-disable-next-line no-console
        console.error('[GamepadConnectionMonitor] disconnect listener threw:', err);
      }
    }
  }

  private fireConnect(event: GamepadConnectEvent): void {
    const snapshot = Array.from(this.connectListeners);
    for (const listener of snapshot) {
      try {
        listener(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[GamepadConnectionMonitor] connect listener threw:', err);
      }
    }
  }
}
