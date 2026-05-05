/**
 * Hard-tier reaction model — AC 19 Sub-AC 2.
 *
 * Why this module exists
 * ----------------------
 * AC 19 (M2 AI Hard tier) requires a bot that "plays like a competent
 * human with ~15-20 frame reaction window". The {@link
 * HardTierReactionSystem} already supplies the *input-delay* half of
 * that requirement (a frame-keyed state-delay buffer + an event jitter
 * window). What was missing was the **perception filtering** half:
 * even a competent human does not perceive every signal. A real player
 * blinks, glances at the wrong half of the screen, focuses on the
 * opponent and misses a hazard, or simply tunes out a tiny bit of
 * twitchy noise the simulation produces. A bot that perceives every
 * single frame perfectly through a 17-frame delay still feels robotic
 * — it just feels like a *delayed* robot.
 *
 * `ReactionModel` solves that by composing the input-delay primitives
 * with a configurable **perception filter pipeline** that runs at the
 * sensory boundary — *before* a snapshot is committed to the delay
 * buffer and *before* an event is queued in the reaction window. The
 * result is a single drop-in component for the Hard tier (and any
 * other consumer that wants the same shape) that owns:
 *
 *   1. The 15-20 frame input-delay simulation (state + event channels),
 *      delegated to {@link HardTierReactionSystem}.
 *   2. The perception filter pipeline (state + event filters), local to
 *      this module.
 *   3. Per-channel acceptance / rejection statistics for diagnostics
 *      and replay debugging.
 *
 * Filters are pure functions. They receive `(frame, value, rng)` and
 * return either a kept value (state channel: original or transformed
 * snapshot) / a boolean (event channel: keep flag). Filters never
 * touch the underlying buffer directly — they may only decide whether
 * a perception enters the pipeline. This keeps the determinism story
 * simple: filters are pure-data over (caller-owned) RNG, the buffer
 * remains the single source of truth for *what was perceived*, and
 * the snapshot pipeline doesn't need to migrate filter internals.
 *
 * Filtering at the sensory boundary
 * ---------------------------------
 * A note on placement: filters run when the *engine* hands a perception
 * to the model (`pushPerception` / `observeEvent`), not when the bot's
 * behavior tree later reads a delayed snapshot (`perceive` /
 * `pollReadyEvents`). Two reasons:
 *
 *   - **Conceptually accurate** — humans miss things at the senses, not
 *     during memory recall. A snapshot that *was* perceived and stored
 *     should be perceptable later.
 *   - **Stable over time** — re-running a filter on every read would
 *     produce flickery perception (the bot perceives the snapshot at
 *     frame N but not at frame N+1). Filtering on entry yields a
 *     stable, replay-friendly perception history.
 *
 * Determinism contract
 * --------------------
 *   - No `Math.random()`. Filters that need randomness pull from the
 *     caller-owned {@link Rng}. The model itself only forwards.
 *   - All frame reads / writes go through the underlying
 *     {@link HardTierReactionSystem}, which is already snapshot-stable
 *     (see its module docs).
 *   - Filter functions are stateless from the model's point of view;
 *     they may close over their own state but the caller is responsible
 *     for that state's determinism. Built-in filters here are either
 *     pure (`predicate*Filter`) or only consume the supplied RNG
 *     (`probabilistic*Filter`).
 *   - {@link ReactionModel.snapshot} / {@link
 *     ReactionModel.restoreSnapshot} round-trip the underlying delay
 *     system + the perception statistics. Filter *identity* is owned
 *     by the controller (which constructed them) and is not part of the
 *     snapshot — the controller wires the same filter pipeline back up
 *     after a replay seek the same way it does for the behavior tree.
 *
 * Replay & VCR compatibility
 * --------------------------
 * On replay seek the controller restores the model from the anchor
 * snapshot. The state delay buffer's entries are restored verbatim;
 * subsequent ticks resume normally because the delay specification,
 * effective delay, and buffered perceptions all match. The
 * {@link HardTierReactionSystem}'s own snapshot semantics are reused
 * here — `ReactionModel` is purely additive.
 *
 * What this module deliberately is NOT
 * ------------------------------------
 *   - A behavior tree. The model is a perception input *to* the BT;
 *     it never reads the BT or fires actions.
 *   - A scene observer. The match scene assembles the world snapshot
 *     once per fixed step and pushes it in. The model never imports
 *     Phaser / Matter.
 *   - A replacement for {@link HardTierReactionSystem} or
 *     {@link ReactionWindow}. Both remain canonical and reusable on
 *     their own; this module composes them and adds filtering.
 *
 * @example Hard-tier perception wiring with a sensory miss filter
 * ```ts
 * const rng = new Rng(seed);
 * const model = new ReactionModel<WorldSnapshot, GameEvent>({
 *   inputDelay: { mode: 'sampled', minFrames: 15, maxFrames: 20 },
 *   rng,
 *   eventRange: REACTION_WINDOW_PRESETS.hard,
 *   eventFilters: [
 *     // Even the Hard tier misses ~5% of events.
 *     probabilisticEventMissFilter(DEFAULT_HARD_TIER_EVENT_MISS_RATE),
 *     // Filter out events that are too far away to register.
 *     predicateEventFilter((e) => Math.abs(e.distance) <= 600),
 *   ],
 * });
 *
 * function onFixedStep(frame: number, world: WorldSnapshot): void {
 *   model.pushPerception(frame, world);
 *   const delayed = model.perceive(frame);
 *   if (delayed) hardOffensiveTree.tick({ ..., world: delayed });
 *   for (const e of model.pollReadyEvents(frame)) {
 *     blackboard.set('lastPerceivedEvent', e);
 *   }
 * }
 *
 * // From the world's event bus:
 * function onWorldEvent(e: GameEvent, frame: number): void {
 *   model.observeEvent(e, frame);
 * }
 * ```
 */

import { type Rng } from '../utils/Rng';
import {
  HardTierReactionSystem,
  type HardTierInputDelaySpec,
  type HardTierReactionEntry,
  type HardTierReactionSnapshot,
} from './hardTierReaction';
import {
  type ReactionWindowRange,
  type ReactionWindowEntry,
} from './perception/ReactionWindow';
import {
  type WorldSnapshot,
} from './perception/WorldSnapshot';

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

/**
 * Context passed to every state perception filter.
 *
 * The `rng` is the same caller-owned RNG used by the underlying
 * {@link HardTierReactionSystem}; filters that consume it must do so
 * deterministically (one or more `next()` / `range()` calls per
 * invocation in a stable order — never branching on wall-clock time).
 *
 * `rng` is `null` iff the model was constructed without an RNG (only
 * possible when `inputDelay.mode === 'fixed'` and no event channel /
 * stochastic filter was wired in). Filters that require RNG should
 * throw when `rng === null` rather than silently fall through to a
 * non-deterministic source.
 */
export interface StatePerceptionFilterContext<TSnap> {
  readonly frame: number;
  readonly snapshot: TSnap;
  readonly rng: Rng | null;
}

/**
 * Predicate-style filter for the *continuous* state channel.
 *
 * Return value semantics:
 *
 *   - return the same object (or any non-null `TSnap`) — the snapshot
 *     is committed to the delay buffer. Filters may transform the
 *     snapshot (e.g. mask irrelevant fields) by returning a new object.
 *   - return `null` — the snapshot is dropped *and* the buffer is
 *     unchanged. The bot's previous perception (if any) is what
 *     {@link ReactionModel.perceive} will continue to surface, which
 *     is the right behavior for "missed this tick".
 *
 * Filters compose left-to-right via {@link ReactionModelOptions.stateFilters};
 * the first filter to return `null` short-circuits the chain.
 */
export type StatePerceptionFilter<TSnap> = (
  ctx: StatePerceptionFilterContext<TSnap>,
) => TSnap | null;

/**
 * Context passed to every event perception filter.
 *
 * Same RNG semantics as {@link StatePerceptionFilterContext}.
 */
export interface EventPerceptionFilterContext<TEvent> {
  readonly frame: number;
  readonly payload: TEvent;
  readonly rng: Rng | null;
}

/**
 * Predicate-style filter for the *discrete* event channel.
 *
 * Return `true` to forward the event to the underlying reaction window
 * (where it will pick up its sampled per-event jitter and become
 * visible 15-20 frames later for the Hard tier). Return `false` to
 * drop the event entirely.
 *
 * Filters compose left-to-right via {@link ReactionModelOptions.eventFilters};
 * the first filter to return `false` short-circuits the chain. Filters
 * may NOT transform the event payload — that would conflate filtering
 * with translation; callers wanting translation should do it before
 * calling {@link ReactionModel.observeEvent}.
 */
export type EventPerceptionFilter<TEvent> = (
  ctx: EventPerceptionFilterContext<TEvent>,
) => boolean;

// ---------------------------------------------------------------------------
// Construction options & snapshot shape
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link ReactionModel}.
 *
 * @typeParam TSnap  Continuous-state snapshot type. Defaults to
 *                   {@link WorldSnapshot}; tests routinely substitute a
 *                   simpler shape.
 * @typeParam TEvent Discrete-event payload type. Defaults to `unknown`.
 */
export interface ReactionModelOptions<TSnap = WorldSnapshot, TEvent = unknown> {
  /**
   * Input delay specification (forwarded verbatim to
   * {@link HardTierReactionSystem}). Defaults to
   * {@link DEFAULT_HARD_TIER_INPUT_DELAY} (fixed 17 frames).
   */
  readonly inputDelay?: HardTierInputDelaySpec;
  /**
   * Caller-owned RNG (forwarded verbatim). Required iff
   * `inputDelay.mode === 'sampled'`, an `eventRange` is supplied, or any
   * supplied filter consumes RNG.
   */
  readonly rng?: Rng;
  /**
   * State-delay ring buffer capacity in frames (forwarded verbatim).
   * Defaults to {@link DEFAULT_HARD_TIER_BUFFER_CAPACITY}.
   */
  readonly bufferCapacity?: number;
  /**
   * Optional event-channel jitter range. When supplied, the underlying
   * {@link HardTierReactionSystem} constructs a `ReactionWindow` for
   * the event channel; the model exposes it via
   * {@link ReactionModel.observeEvent} / {@link
   * ReactionModel.pollReadyEvents}.
   */
  readonly eventRange?: ReactionWindowRange;
  /**
   * State perception filters, applied in order before each snapshot is
   * committed to the delay buffer. Empty / undefined means no filtering
   * (every snapshot is perceived).
   */
  readonly stateFilters?: ReadonlyArray<StatePerceptionFilter<TSnap>>;
  /**
   * Event perception filters, applied in order before each event is
   * forwarded to the reaction window. Empty / undefined means no
   * filtering (every event is perceived).
   */
  readonly eventFilters?: ReadonlyArray<EventPerceptionFilter<TEvent>>;
}

/**
 * Acceptance / rejection counters for the perception pipeline.
 *
 * Useful for:
 *
 *   - Diagnostic overlays — "Hard tier perceived 94 of 100 events".
 *   - Test assertions — verifying a probabilistic filter dropped
 *     roughly the configured fraction.
 *   - Replay-debug heatmaps — distinguishing "bot saw nothing" from
 *     "bot saw it but ignored it".
 */
export interface ReactionModelStats {
  /** Total state-channel perceptions offered to the model. */
  readonly statePushed: number;
  /** Subset of `statePushed` that survived the filter chain. */
  readonly stateAccepted: number;
  /** Subset of `statePushed` that was dropped by a filter. */
  readonly stateRejected: number;
  /** Total event-channel perceptions offered to the model. */
  readonly eventsObserved: number;
  /** Subset of `eventsObserved` that survived the filter chain. */
  readonly eventsAccepted: number;
  /** Subset of `eventsObserved` that was dropped by a filter. */
  readonly eventsRejected: number;
}

const ZERO_STATS: ReactionModelStats = Object.freeze({
  statePushed: 0,
  stateAccepted: 0,
  stateRejected: 0,
  eventsObserved: 0,
  eventsAccepted: 0,
  eventsRejected: 0,
});

/**
 * Snapshot shape for {@link ReactionModel.snapshot} /
 * {@link ReactionModel.restoreSnapshot}.
 *
 * Plain data so it round-trips through `JSON.stringify` cleanly inside
 * a 300-frame replay state snapshot. RNG state is intentionally NOT
 * captured — it is owned by the controller and snapshotted separately
 * so multiple consumers sharing one RNG stay in sync.
 *
 * Filter identity is also intentionally NOT captured: the controller
 * owns the filter chain (it constructed it), and the act of restoring
 * a snapshot is "rehydrate the buffer + counters at this frame", not
 * "swap out the filter pipeline".
 */
export interface ReactionModelSnapshot<TSnap, TEvent> {
  /** Underlying delay-system snapshot. */
  readonly system: HardTierReactionSnapshot<TSnap, TEvent>;
  /** Captured perception statistics at snapshot time. */
  readonly stats: ReactionModelStats;
}

// ---------------------------------------------------------------------------
// ReactionModel — the main class
// ---------------------------------------------------------------------------

/**
 * Hard-tier reaction model: input delay + perception filtering, in one
 * drop-in component.
 *
 * @typeParam TSnap  Continuous-state snapshot type. Defaults to
 *                   {@link WorldSnapshot}.
 * @typeParam TEvent Discrete-event payload type. Defaults to `unknown`.
 */
export class ReactionModel<TSnap = WorldSnapshot, TEvent = unknown> {
  /** Underlying delay-buffer + event-window system. */
  private readonly system: HardTierReactionSystem<TSnap, TEvent>;
  /** Caller-owned RNG. Forwarded to filter contexts. */
  private readonly rng: Rng | null;
  /** Active state filter chain. Mutated through {@link addStateFilter}. */
  private stateFilters: StatePerceptionFilter<TSnap>[];
  /** Active event filter chain. Mutated through {@link addEventFilter}. */
  private eventFilters: EventPerceptionFilter<TEvent>[];

  // Counters (mutable; surfaced through `getStats`).
  private statePushed = 0;
  private stateAccepted = 0;
  private stateRejected = 0;
  private eventsObserved = 0;
  private eventsAccepted = 0;
  private eventsRejected = 0;

  /**
   * @param options See {@link ReactionModelOptions}. Validates the
   *                input delay specification, buffer capacity, and RNG
   *                requirements via the underlying
   *                {@link HardTierReactionSystem}; throws on
   *                misconfiguration.
   */
  constructor(options: ReactionModelOptions<TSnap, TEvent> = {}) {
    this.rng = options.rng ?? null;
    this.system = new HardTierReactionSystem<TSnap, TEvent>({
      inputDelay: options.inputDelay,
      rng: options.rng,
      bufferCapacity: options.bufferCapacity,
      eventRange: options.eventRange,
    });
    this.stateFilters = options.stateFilters ? options.stateFilters.slice() : [];
    this.eventFilters = options.eventFilters ? options.eventFilters.slice() : [];
  }

  // -------------------------------------------------------------------------
  // Continuous-state channel (with filtering)
  // -------------------------------------------------------------------------

  /**
   * Offer a fresh ground-truth perception to the model.
   *
   * Runs the state filter chain in declaration order; the first filter
   * to return `null` short-circuits and the snapshot is dropped (no
   * mutation to the underlying buffer). Filters that return a non-null
   * value pass that value through to the next filter — so filters can
   * transform the snapshot (e.g. mask out irrelevant opponent fields)
   * as well as drop it.
   *
   * Returns `true` if the snapshot was committed to the buffer, `false`
   * if it was filtered out.
   *
   * Throws when `frame` is negative / non-integer or earlier than the
   * last pushed frame (delegated to {@link
   * HardTierReactionSystem.pushPerception}).
   */
  pushPerception(frame: number, snapshot: TSnap): boolean {
    this.statePushed += 1;
    let value: TSnap | null = snapshot;
    for (const filter of this.stateFilters) {
      if (value === null) break;
      value = filter({ frame, snapshot: value, rng: this.rng });
    }
    if (value === null) {
      this.stateRejected += 1;
      return false;
    }
    this.system.pushPerception(frame, value);
    this.stateAccepted += 1;
    return true;
  }

  /**
   * Sample the perception the bot should see *this* tick — i.e. the
   * snapshot at frame `currentFrame - inputDelayFrames`.
   *
   * Pure delegation to {@link HardTierReactionSystem.perceive}; the
   * filter chain has already run on entry and never re-runs on read.
   */
  perceive(currentFrame: number): TSnap | null {
    return this.system.perceive(currentFrame);
  }

  /**
   * Look up the snapshot pushed for *exactly* the requested frame.
   *
   * Returns `null` when no entry was pushed (or it was evicted /
   * filtered out). Mainly useful for tests / replay diagnostics.
   */
  peekFrame(frame: number): TSnap | null {
    return this.system.peekFrame(frame);
  }

  /**
   * True iff the model currently holds a perception at or before
   * `currentFrame - inputDelayFrames` — i.e. {@link perceive} would
   * return non-null. Cheap O(1) check.
   */
  hasWarmedUp(currentFrame: number): boolean {
    return this.system.hasWarmedUp(currentFrame);
  }

  /** Number of perceptions currently buffered in the delay buffer. */
  size(): number {
    return this.system.size();
  }

  /** Read-only view of every buffered entry, in ascending frame order. */
  peekEntries(): ReadonlyArray<HardTierReactionEntry<TSnap>> {
    return this.system.peekEntries();
  }

  // -------------------------------------------------------------------------
  // Discrete-event channel (with filtering)
  // -------------------------------------------------------------------------

  /**
   * Offer a discrete event to the model.
   *
   * Runs the event filter chain in declaration order; the first filter
   * to return `false` short-circuits and the event is dropped. If every
   * filter returns `true`, the event is forwarded to the underlying
   * reaction window via {@link HardTierReactionSystem.events.observe}
   * where it picks up its per-event jitter delay.
   *
   * Returns `true` if the event was forwarded, `false` if it was
   * filtered out.
   *
   * Throws when the model was constructed without an `eventRange` —
   * the events facet is opt-in to keep memory cost zero for consumers
   * that don't want it.
   */
  observeEvent(payload: TEvent, frame: number): boolean {
    if (!this.system.events) {
      throw new Error(
        'ReactionModel.observeEvent: no event channel — pass eventRange to ' +
          'the constructor to enable discrete-event perception',
      );
    }
    this.eventsObserved += 1;
    for (const filter of this.eventFilters) {
      if (!filter({ frame, payload, rng: this.rng })) {
        this.eventsRejected += 1;
        return false;
      }
    }
    this.system.events.observe(payload, frame);
    this.eventsAccepted += 1;
    return true;
  }

  /**
   * Drain every event whose visibility frame has been reached.
   *
   * Returns the *payloads* (not the full {@link ReactionWindowEntry}s)
   * for the common consumer that just wants the event data. Callers
   * needing the entry metadata (observed / visible frames) can reach
   * the underlying window via {@link getReactionSystem}.events.
   *
   * Returns an empty array when no event channel is configured (rather
   * than throwing) so consumers can call this unconditionally each
   * tick.
   */
  pollReadyEvents(currentFrame: number): TEvent[] {
    if (!this.system.events) return [];
    const ready: ReactionWindowEntry<TEvent>[] = this.system.events.pollReady(
      currentFrame,
    );
    const out: TEvent[] = [];
    for (const entry of ready) out.push(entry.payload);
    return out;
  }

  /**
   * Read-only view of every event entry currently waiting to surface.
   *
   * Returns an empty array when no event channel is configured. Useful
   * for debug overlays that show "N events pending, M frames until next".
   */
  peekPendingEvents(): ReadonlyArray<ReactionWindowEntry<TEvent>> {
    return this.system.events?.peekPending() ?? [];
  }

  /** Number of events currently in flight in the reaction window. */
  pendingEventCount(): number {
    return this.system.events?.pendingCount() ?? 0;
  }

  /** True iff the model has an event channel configured. */
  hasEventChannel(): boolean {
    return this.system.events !== null;
  }

  // -------------------------------------------------------------------------
  // Filter management
  // -------------------------------------------------------------------------

  /** Append a filter to the end of the state filter chain. */
  addStateFilter(filter: StatePerceptionFilter<TSnap>): void {
    if (typeof filter !== 'function') {
      throw new Error(
        'ReactionModel.addStateFilter: filter must be a function',
      );
    }
    this.stateFilters.push(filter);
  }

  /** Append a filter to the end of the event filter chain. */
  addEventFilter(filter: EventPerceptionFilter<TEvent>): void {
    if (typeof filter !== 'function') {
      throw new Error(
        'ReactionModel.addEventFilter: filter must be a function',
      );
    }
    this.eventFilters.push(filter);
  }

  /**
   * Replace the entire state filter chain. Pass an empty array to
   * disable state filtering completely.
   */
  setStateFilters(filters: ReadonlyArray<StatePerceptionFilter<TSnap>>): void {
    for (const f of filters) {
      if (typeof f !== 'function') {
        throw new Error(
          'ReactionModel.setStateFilters: every entry must be a function',
        );
      }
    }
    this.stateFilters = filters.slice();
  }

  /**
   * Replace the entire event filter chain. Pass an empty array to
   * disable event filtering completely.
   */
  setEventFilters(filters: ReadonlyArray<EventPerceptionFilter<TEvent>>): void {
    for (const f of filters) {
      if (typeof f !== 'function') {
        throw new Error(
          'ReactionModel.setEventFilters: every entry must be a function',
        );
      }
    }
    this.eventFilters = filters.slice();
  }

  /** Remove every filter from both chains. */
  clearFilters(): void {
    this.stateFilters = [];
    this.eventFilters = [];
  }

  /** Read-only view of the current state filter chain. */
  getStateFilters(): ReadonlyArray<StatePerceptionFilter<TSnap>> {
    return this.stateFilters.slice();
  }

  /** Read-only view of the current event filter chain. */
  getEventFilters(): ReadonlyArray<EventPerceptionFilter<TEvent>> {
    return this.eventFilters.slice();
  }

  // -------------------------------------------------------------------------
  // Configuration accessors (delegate to the underlying system)
  // -------------------------------------------------------------------------

  /** Effective input delay in frames (`>= 0` integer). */
  getInputDelayFrames(): number {
    return this.system.getInputDelayFrames();
  }

  /** Original delay specification (`fixed` or `sampled`). */
  getInputDelaySpec(): HardTierInputDelaySpec {
    return this.system.getInputDelaySpec();
  }

  /** Capacity of the state delay ring buffer in frames. */
  getBufferCapacity(): number {
    return this.system.getBufferCapacity();
  }

  /**
   * Replace the delay specification. See {@link
   * HardTierReactionSystem.reconfigureDelay} for full semantics.
   */
  reconfigureDelay(spec: HardTierInputDelaySpec): void {
    this.system.reconfigureDelay(spec);
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  /** Snapshot of acceptance / rejection counters. */
  getStats(): ReactionModelStats {
    return {
      statePushed: this.statePushed,
      stateAccepted: this.stateAccepted,
      stateRejected: this.stateRejected,
      eventsObserved: this.eventsObserved,
      eventsAccepted: this.eventsAccepted,
      eventsRejected: this.eventsRejected,
    };
  }

  /** Reset every counter to zero. Buffer / event window are unchanged. */
  resetStats(): void {
    this.statePushed = 0;
    this.stateAccepted = 0;
    this.stateRejected = 0;
    this.eventsObserved = 0;
    this.eventsAccepted = 0;
    this.eventsRejected = 0;
  }

  // -------------------------------------------------------------------------
  // Lifecycle: clear / snapshot / restore
  // -------------------------------------------------------------------------

  /**
   * Discard every buffered perception and every pending event. Counters
   * are reset to zero so post-clear stats reflect the new logical
   * timeline rather than carrying yardage from the previous one.
   *
   * Used on match restart, replay scrub-back, and tier swap.
   */
  clear(): void {
    this.system.clear();
    this.resetStats();
  }

  /**
   * Capture model state for the replay snapshot pipeline.
   *
   * RNG state and filter identity are intentionally NOT captured — see
   * the module docstring for the rationale.
   */
  snapshot(): ReactionModelSnapshot<TSnap, TEvent> {
    return {
      system: this.system.snapshot(),
      stats: this.getStats(),
    };
  }

  /**
   * Replace model state from a snapshot.
   *
   * Validates each field via the underlying
   * {@link HardTierReactionSystem.restoreSnapshot} for the system part
   * and a defensive shape check for the stats part. Filter chain is
   * unchanged — the controller owns it.
   */
  restoreSnapshot(snap: ReactionModelSnapshot<TSnap, TEvent>): void {
    if (!snap || typeof snap !== 'object') {
      throw new Error(
        `ReactionModel.restoreSnapshot: snapshot must be an object, got ` +
          `${String(snap)}`,
      );
    }
    this.system.restoreSnapshot(snap.system);
    assertValidStats(snap.stats);
    this.statePushed = snap.stats.statePushed;
    this.stateAccepted = snap.stats.stateAccepted;
    this.stateRejected = snap.stats.stateRejected;
    this.eventsObserved = snap.stats.eventsObserved;
    this.eventsAccepted = snap.stats.eventsAccepted;
    this.eventsRejected = snap.stats.eventsRejected;
  }

  // -------------------------------------------------------------------------
  // Underlying-system access (for advanced consumers)
  // -------------------------------------------------------------------------

  /**
   * Read-only handle to the underlying {@link HardTierReactionSystem}.
   *
   * Most consumers should reach the system through the model's surface.
   * Provided for advanced use cases (custom diagnostics, alternate
   * snapshot strategies) that need direct access — but writing through
   * this handle bypasses the filter pipeline and is generally a bug.
   */
  getReactionSystem(): HardTierReactionSystem<TSnap, TEvent> {
    return this.system;
  }
}

// ---------------------------------------------------------------------------
// Built-in filter primitives
// ---------------------------------------------------------------------------

/**
 * State filter that keeps every snapshot unchanged. Useful as a
 * placeholder, in tests, or as a documentation marker that "no
 * filtering is intended at this position".
 */
export function passThroughStateFilter<TSnap>(): StatePerceptionFilter<TSnap> {
  return (ctx) => ctx.snapshot;
}

/**
 * Event filter that keeps every event. Mirror of
 * {@link passThroughStateFilter}.
 */
export function passThroughEventFilter<TEvent>(): EventPerceptionFilter<TEvent> {
  return () => true;
}

/**
 * Predicate-style state filter — keeps the snapshot iff `pred` returns
 * `true`, drops it (returns `null`) otherwise. The predicate has full
 * access to the snapshot and frame for distance / interest
 * calculations.
 *
 * Pure (no RNG) — deterministic by construction.
 */
export function predicateStateFilter<TSnap>(
  pred: (snapshot: TSnap, frame: number) => boolean,
): StatePerceptionFilter<TSnap> {
  return (ctx) => (pred(ctx.snapshot, ctx.frame) ? ctx.snapshot : null);
}

/**
 * Predicate-style event filter — mirror of {@link predicateStateFilter}.
 *
 * Pure (no RNG) — deterministic by construction.
 */
export function predicateEventFilter<TEvent>(
  pred: (payload: TEvent, frame: number) => boolean,
): EventPerceptionFilter<TEvent> {
  return (ctx) => pred(ctx.payload, ctx.frame);
}

/**
 * Transform-style state filter — applies `fn` to the snapshot and
 * pushes the result. Use to mask irrelevant fields ("the bot can't see
 * fine-grained opponent velocity at this distance").
 *
 * `fn` may return `null` to drop the snapshot, the same as
 * {@link predicateStateFilter}.
 */
export function transformStateFilter<TSnap>(
  fn: (snapshot: TSnap, frame: number) => TSnap | null,
): StatePerceptionFilter<TSnap> {
  return (ctx) => fn(ctx.snapshot, ctx.frame);
}

/**
 * Default event miss rate for the Hard tier — small but nonzero.
 *
 * 5% means out of 20 events the bot will, on average, miss 1. Picked to
 * be high enough to feel imperfect on close inspection but low enough
 * that the bot still reads as "competent". Easy / Medium tiers should
 * use higher rates if they enable this filter.
 */
export const DEFAULT_HARD_TIER_EVENT_MISS_RATE = 0.05;

/**
 * Probabilistic event miss filter — drops `missRate` fraction of
 * events through the supplied RNG.
 *
 * Determinism: uses {@link Rng.next} once per invocation. Two filters
 * seeded identically and given identical `(payload, frame)` sequences
 * will drop the same events.
 *
 * `missRate` must be in `[0, 1]` — `0` keeps everything (equivalent to
 * no filter), `1` drops everything. Throws on out-of-range or NaN.
 *
 * Throws if invoked with `rng === null` (a stochastic filter without
 * an RNG would have to fall back to wall-clock or `Math.random()`,
 * either of which breaks determinism).
 */
export function probabilisticEventMissFilter<TEvent>(
  missRate: number,
): EventPerceptionFilter<TEvent> {
  assertProbability(missRate, 'missRate');
  return (ctx) => {
    if (!ctx.rng) {
      throw new Error(
        'probabilisticEventMissFilter: requires an rng on the ReactionModel',
      );
    }
    if (missRate <= 0) return true;
    if (missRate >= 1) return false;
    return ctx.rng.next() >= missRate;
  };
}

/**
 * Probabilistic state miss filter — same shape as {@link
 * probabilisticEventMissFilter} but operates on the state channel.
 *
 * Note: dropping continuous-state perceptions is generally a riskier
 * design than dropping events because the bot's perception
 * "rewinds" to whatever was last buffered (or returns null until the
 * delay window passes). Prefer event-channel filtering unless you
 * explicitly want the bot to stale-read its world model.
 */
export function probabilisticStateMissFilter<TSnap>(
  missRate: number,
): StatePerceptionFilter<TSnap> {
  assertProbability(missRate, 'missRate');
  return (ctx) => {
    if (!ctx.rng) {
      throw new Error(
        'probabilisticStateMissFilter: requires an rng on the ReactionModel',
      );
    }
    if (missRate <= 0) return ctx.snapshot;
    if (missRate >= 1) return null;
    return ctx.rng.next() >= missRate ? ctx.snapshot : null;
  };
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

/**
 * Re-export of the AC-mandated 15-20 frame Hard-tier band so consumers
 * can import the canonical band from {@link reactionModel} directly.
 */
export {
  DEFAULT_HARD_TIER_BUFFER_CAPACITY,
  DEFAULT_HARD_TIER_INPUT_DELAY,
  HARD_TIER_INPUT_DELAY_RANGE,
} from './hardTierReaction';

// ---------------------------------------------------------------------------
// Internal validation helpers
// ---------------------------------------------------------------------------

function assertProbability(value: number, label: string): void {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error(
      `ReactionModel: ${label} must be a finite number in [0, 1], got ` +
        `${String(value)}`,
    );
  }
}

function assertValidStats(stats: ReactionModelStats | undefined): void {
  if (!stats || typeof stats !== 'object') {
    throw new Error(
      `ReactionModel.restoreSnapshot: stats must be an object, got ` +
        `${String(stats)}`,
    );
  }
  for (const key of [
    'statePushed',
    'stateAccepted',
    'stateRejected',
    'eventsObserved',
    'eventsAccepted',
    'eventsRejected',
  ] as const) {
    const v = stats[key];
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(
        `ReactionModel.restoreSnapshot: stats.${key} must be a non-negative ` +
          `integer, got ${String(v)}`,
      );
    }
  }
  if (stats.stateAccepted + stats.stateRejected > stats.statePushed) {
    throw new Error(
      `ReactionModel.restoreSnapshot: stats.stateAccepted + ` +
        `stats.stateRejected (${stats.stateAccepted + stats.stateRejected}) ` +
        `must be <= stats.statePushed (${stats.statePushed})`,
    );
  }
  if (stats.eventsAccepted + stats.eventsRejected > stats.eventsObserved) {
    throw new Error(
      `ReactionModel.restoreSnapshot: stats.eventsAccepted + ` +
        `stats.eventsRejected (${stats.eventsAccepted + stats.eventsRejected}) ` +
        `must be <= stats.eventsObserved (${stats.eventsObserved})`,
    );
  }
}

// Re-export to keep the unused-symbol bookkeeping clean for consumers
// that import the zero-stats object as a baseline.
export { ZERO_STATS as REACTION_MODEL_ZERO_STATS };
