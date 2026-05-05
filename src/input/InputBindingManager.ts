/**
 * Input binding manager — AC 5 Sub-AC 2.
 *
 * Purpose
 * -------
 *
 * The M5 rebinding architecture splits input handling into two halves:
 *
 *   1. **Polling layer** ({@link DeviceInputDispatcher}). Stateless,
 *      bindings-driven sampler that converts the live keyboard / gamepad
 *      state into a per-slot {@link ActionHeldMap} on demand. The
 *      gameplay scene polls it once per fixed step, the AI module reads
 *      it for state introspection, the rebinding UI uses it for the
 *      "press a key…" preview.
 *   2. **Event layer** (this file). Translates the polled held-bitmap
 *      into per-player **action events** (press / release / held) so
 *      menu code, the pause toggle, the rebinding screen's confirm
 *      button, and replay tagging can all subscribe instead of running
 *      their own `wasDown / isDown` edge detectors.
 *
 * `InputBindingManager` is the single named service the rest of the
 * codebase wires to when it wants "tell me when player N presses jump"
 * — no hardcoded `KEY_CODE.W` checks, no parallel mapping tables, no
 * scene-by-scene re-implementation of edge detection. The manager owns
 * the previous-frame snapshot and emits typed events on every diff.
 *
 * Architecture
 * ------------
 *
 *   raw keyboard / gamepad state
 *           │
 *   DeviceInputDispatcher  ◄── PlayerBindingsProvider (InputBindingsStore)
 *           │  per-frame ActionHeldMap
 *           ▼
 *   InputBindingManager   ──── press / release / held events
 *           │
 *   subscribers (menus, pause, rebinding UI, replay tagger…)
 *
 * The dispatcher remains the only thing that knows about device
 * specifics (keyCodes, gamepad axes, half-axis thresholds). The
 * manager is a pure diff-and-emit layer: given the active binding
 * profile through the dispatcher, it never sees a raw `KeyboardEvent`
 * itself, which is what guarantees the "no hardcoded input mapping"
 * promise. Adding a new device family means extending the dispatcher
 * and the binding schema, not touching this file.
 *
 * Determinism
 * -----------
 *
 *   • The manager holds exactly one piece of state — the last polled
 *     {@link ActionHeldMap} per slot — and updates it inside `poll()`.
 *     Outside `poll()` the manager is a pure subscription registry; no
 *     `Math.random()`, no wall-clock reads, no Phaser.
 *   • Events are emitted in a deterministic order: slots in ascending
 *     index order (1 → 4), then actions in {@link LOGICAL_ACTIONS}
 *     declaration order. A unit test that records a poll's emissions
 *     gets the same sequence on every machine and every replay.
 *   • The optional `frame` argument on `poll()` is forwarded onto every
 *     emitted event so the replay layer can tag a press with the exact
 *     fixed-step frame it occurred on.
 *
 * Strict TypeScript
 * -----------------
 *
 * Compiled under `noUncheckedIndexedAccess + strict`. The exhaustive
 * `LOGICAL_ACTIONS` iteration plus the discriminated event union keep
 * subscribers from forgetting an action when they switch on the event
 * type.
 */

import {
  LOGICAL_ACTIONS,
  type LogicalAction,
  type PlayerBindingsIndex,
} from '../types/inputBindings';
import { NEUTRAL_ACTION_MAP, type ActionHeldMap, type DeviceInputDispatcher } from './DeviceInputDispatcher';

// ---------------------------------------------------------------------------
// Event shape
// ---------------------------------------------------------------------------

/**
 * Per-player action event kinds.
 *
 *   • `press`  — the action transitioned from released → held this poll.
 *   • `release` — the action transitioned from held → released.
 *   • `hold`   — the action remained held across the poll boundary.
 *
 * `hold` is emitted only when the caller opts in via
 * {@link InputBindingManagerOptions.emitHold}. Most subscribers (menus,
 * pause toggle, rebinding capture) only care about edges; emitting a
 * `hold` event for every held action every frame would generate up to
 * `4 slots × 10 actions = 40` events per fixed step, which is
 * unnecessary noise unless the consumer specifically wants it (e.g. an
 * AI debug overlay rendering "what is each slot holding right now").
 */
export type PlayerActionEventKind = 'press' | 'release' | 'hold';

/**
 * Discriminated event surfaced to subscribers. The shape is a plain
 * frozen record — no class, no closure — so the replay tagger can
 * round-trip it through JSON without losing fidelity.
 *
 * `frame` is the integer fixed-step frame the event was sampled on. It
 * defaults to `-1` when the caller doesn't pass `poll(frame)` so a
 * standalone menu poll (which doesn't run on the simulation clock) can
 * still emit valid events; the gameplay loop always supplies the real
 * frame so replay tags are deterministic.
 */
export interface PlayerActionEvent {
  readonly kind: PlayerActionEventKind;
  readonly slot: PlayerBindingsIndex;
  readonly action: LogicalAction;
  readonly frame: number;
}

/**
 * Subscriber callback. Runs synchronously inside `poll()` (or
 * `forceRelease()`) — listeners must not call back into the manager's
 * mutators while iterating, or they'll re-enter the emit loop. Adding /
 * removing subscribers during dispatch is supported (the dispatch loop
 * snapshots the listener list once per emission).
 */
export type PlayerActionListener = (event: PlayerActionEvent) => void;

/** Disposer returned by `subscribe` — call to detach the listener. */
export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// Construction options
// ---------------------------------------------------------------------------

/** Constructor options. */
export interface InputBindingManagerOptions {
  /**
   * Polling layer the manager reads from. Holds the keyboard / gamepad
   * sources and the active {@link InputBindingsStore}; the manager
   * itself never touches raw device APIs. Required.
   */
  readonly dispatcher: DeviceInputDispatcher;

  /**
   * Player slots to track. Defaults to all four. Restricting to a
   * subset (e.g. `[1, 2]` during a 2P match) skips diff work and event
   * emission for empty slots — purely a performance hint, the dispatcher
   * itself remains slot-agnostic.
   */
  readonly slots?: ReadonlyArray<PlayerBindingsIndex>;

  /**
   * Whether to emit a `hold` event for every action that remained held
   * across the poll boundary. Default `false` — most subscribers care
   * only about press / release edges. Turn on for AI debug overlays
   * or per-frame replay logging that wants the full held bitmap as
   * a stream of events.
   */
  readonly emitHold?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const ALL_SLOTS: ReadonlyArray<PlayerBindingsIndex> = Object.freeze([1, 2, 3, 4]);

function makeNeutralCopy(): Record<LogicalAction, boolean> {
  // Defensive copy — `NEUTRAL_ACTION_MAP` is frozen, but the manager's
  // per-slot snapshot must be mutable so successive polls can write
  // into it without allocating a fresh record every frame.
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    attack: false,
    special: false,
    shield: false,
    grab: false,
    taunt: false,
  };
}

// ---------------------------------------------------------------------------
// InputBindingManager
// ---------------------------------------------------------------------------

/**
 * Event-driven binding-aware input service.
 *
 * The manager is the single named service that translates raw
 * keyboard / gamepad events (via the dispatcher) into per-player
 * {@link PlayerActionEvent}s, replacing any hardcoded input mapping in
 * the input layer. Lifecycle:
 *
 *   const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad, bindings: store });
 *   const manager = new InputBindingManager({ dispatcher });
 *
 *   // Listen for a single action edge:
 *   const off = manager.subscribe((e) => {
 *     if (e.kind === 'press' && e.slot === 1 && e.action === 'jump') startJump(e.frame);
 *   });
 *
 *   // Drive the manager once per fixed step:
 *   manager.poll(currentFrame);
 *
 *   // Tear down at scene shutdown (releases held actions cleanly):
 *   manager.dispose();
 *
 * Mutation of the underlying {@link InputBindingsStore} is fully
 * supported mid-session: because the dispatcher reads the store on
 * every sample, the very next `poll()` will pick up the new bindings
 * and emit a release for actions whose old binding stopped reporting
 * held / a press for actions whose new binding is now held.
 */
export class InputBindingManager {
  private readonly dispatcher: DeviceInputDispatcher;
  private readonly slots: ReadonlyArray<PlayerBindingsIndex>;
  private readonly emitHold: boolean;
  /**
   * Last polled held bitmap per tracked slot. Mutated in place inside
   * `poll()` so the manager allocates a fixed amount of memory after
   * construction; events themselves are short-lived frozen records.
   */
  private readonly previous: Map<PlayerBindingsIndex, Record<LogicalAction, boolean>>;
  private readonly listeners: Set<PlayerActionListener> = new Set();
  private disposed = false;

  constructor(options: InputBindingManagerOptions) {
    this.dispatcher = options.dispatcher;
    this.slots = options.slots ?? ALL_SLOTS;
    this.emitHold = options.emitHold === true;
    this.previous = new Map<PlayerBindingsIndex, Record<LogicalAction, boolean>>();
    for (const slot of this.slots) {
      this.previous.set(slot, makeNeutralCopy());
    }
  }

  // -------------------------------------------------------------------------
  // Subscription
  // -------------------------------------------------------------------------

  /**
   * Register a listener. Returns a disposer; calling it detaches the
   * listener from future emissions.
   *
   * Listeners run in the order they subscribed. A listener thrown out
   * of mid-emit does NOT stop the dispatch loop — we catch and re-throw
   * after every other listener has had a chance to fire, so a buggy
   * subscriber can't deadlock a polling tick.
   */
  subscribe(listener: PlayerActionListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Number of currently-attached listeners (handy for unit tests). */
  get listenerCount(): number {
    return this.listeners.size;
  }

  // -------------------------------------------------------------------------
  // Polling
  // -------------------------------------------------------------------------

  /**
   * Sample the dispatcher once and emit press / release events for any
   * action whose held state changed since the previous poll. Called
   * once per fixed step by the gameplay loop, and ad-hoc by menu code
   * that runs off the simulation clock.
   *
   * `frame` is forwarded onto every emitted event. Defaults to `-1`
   * when the caller doesn't supply one (e.g. a menu poll that has no
   * fixed-step concept). The gameplay loop always supplies the real
   * frame so replay tags are deterministic.
   *
   * Returns the list of events emitted this poll, in the same order
   * subscribers received them — useful for the replay layer, which can
   * record the manager's emissions instead of subscribing to them.
   */
  poll(frame: number = -1): ReadonlyArray<PlayerActionEvent> {
    if (this.disposed) {
      return Object.freeze([]);
    }
    const events: PlayerActionEvent[] = [];
    // Slots iterate in ascending order so the emission sequence is
    // deterministic across runs — required for the replay layer.
    for (const slot of this.slots) {
      const prev = this.previous.get(slot);
      /* istanbul ignore next — guaranteed by constructor seeding. */
      if (prev === undefined) continue;
      const next = this.dispatcher.sampleActions(slot);
      // Actions iterate in `LOGICAL_ACTIONS` declaration order — the
      // canonical order the rebinding UI renders, which is also the
      // order replay-event diffs are stored.
      for (const action of LOGICAL_ACTIONS) {
        const wasHeld = prev[action];
        const isHeld = next[action];
        if (isHeld && !wasHeld) {
          events.push(Object.freeze({ kind: 'press', slot, action, frame }));
        } else if (!isHeld && wasHeld) {
          events.push(Object.freeze({ kind: 'release', slot, action, frame }));
        } else if (isHeld && wasHeld && this.emitHold) {
          events.push(Object.freeze({ kind: 'hold', slot, action, frame }));
        }
        prev[action] = isHeld;
      }
    }
    if (events.length > 0) {
      this.dispatch(events);
    }
    return Object.freeze(events);
  }

  /**
   * Read a slot's previous-poll held bitmap without sampling the
   * dispatcher. Useful for debug overlays and unit assertions; never
   * advances internal state.
   */
  getLastSample(slot: PlayerBindingsIndex): ActionHeldMap {
    const prev = this.previous.get(slot);
    if (prev === undefined) {
      return NEUTRAL_ACTION_MAP;
    }
    // Defensive shallow copy + freeze so a caller can't mutate the
    // manager's internal record by writing into the returned object.
    return Object.freeze({ ...prev });
  }

  /**
   * True iff the given action was held on the most recent poll for the
   * slot. Equivalent to `getLastSample(slot)[action]` but avoids the
   * spread allocation. Listeners doing chord detection use this inside
   * a press-handler — "did the player press attack while shield was
   * already held?".
   */
  wasHeldLastPoll(slot: PlayerBindingsIndex, action: LogicalAction): boolean {
    const prev = this.previous.get(slot);
    return prev !== undefined && prev[action] === true;
  }

  /**
   * True iff the action is held *right now*, sampling the dispatcher
   * directly without advancing internal state. Convenience for
   * subscribers that want to check the live state inside a press
   * handler without waiting for the next poll. Bypasses the previous-
   * frame snapshot, so this is identical to
   * `dispatcher.isActionHeld(slot, action)`.
   */
  isActionHeld(slot: PlayerBindingsIndex, action: LogicalAction): boolean {
    return this.dispatcher.isActionHeld(slot, action);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Force-release every currently-held action for every tracked slot.
   * Emits a `release` event for each one (with the supplied frame) and
   * resets the internal snapshot to neutral. Used by:
   *
   *   • Scene shutdown — guarantees no held action leaks into the next
   *     scene if the player walked away mid-press.
   *   • Replay scrubbing — the VCR layer calls this when the playhead
   *     jumps so subscribers see a clean release before the next poll
   *     re-establishes the destination frame's state.
   *   • Controller-disconnect pause — disconnect releases everything;
   *     reconnect lets the next poll re-press whatever's actually held
   *     on the resumed pad.
   */
  forceRelease(frame: number = -1): ReadonlyArray<PlayerActionEvent> {
    if (this.disposed) {
      return Object.freeze([]);
    }
    const events: PlayerActionEvent[] = [];
    for (const slot of this.slots) {
      const prev = this.previous.get(slot);
      /* istanbul ignore next */
      if (prev === undefined) continue;
      for (const action of LOGICAL_ACTIONS) {
        if (prev[action]) {
          events.push(Object.freeze({ kind: 'release', slot, action, frame }));
          prev[action] = false;
        }
      }
    }
    if (events.length > 0) {
      this.dispatch(events);
    }
    return Object.freeze(events);
  }

  /**
   * Detach every listener and stop responding to polls. Idempotent —
   * a second `dispose()` is a no-op. Does NOT emit release events
   * itself (subscribers are already gone); callers that want the
   * release-on-shutdown semantics should call {@link forceRelease}
   * before disposing.
   */
  dispose(): void {
    this.listeners.clear();
    this.disposed = true;
  }

  /** True iff `dispose()` has been called. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Push events to every listener. Listeners that throw don't abort the
   * dispatch loop — we collect the first error and rethrow after every
   * other listener has fired so a buggy subscriber can't deadlock a
   * polling tick (and so the rest of the subscribers still see the
   * frame's events).
   */
  private dispatch(events: ReadonlyArray<PlayerActionEvent>): void {
    if (this.listeners.size === 0) return;
    // Snapshot the listener set so subscribers can self-detach inside
    // their own handler without skipping siblings registered later.
    const snapshot = Array.from(this.listeners);
    let firstError: unknown;
    for (const event of events) {
      for (const listener of snapshot) {
        try {
          listener(event);
        } catch (err) {
          if (firstError === undefined) firstError = err;
        }
      }
    }
    if (firstError !== undefined) {
      throw firstError;
    }
  }
}
