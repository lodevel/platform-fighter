/**
 * Hard-tier reaction system — AC 18 Sub-AC 2.
 *
 * Why this module exists
 * ----------------------
 * The Hard-tier AC (AC 18) mandates a competent-human reaction window of
 * ~15–20 frames at 60 FPS. The behavior tree authored under Sub-AC 1
 * (offensive / recovery branches) reads opponent state every tick, but
 * if it reads the *current* world state it is omniscient — it sees a
 * smash startup the same frame the player begins it. That feels robotic
 * and unfair.
 *
 * The Hard-tier reaction model has two complementary perception
 * channels that both need to be delayed:
 *
 *   1. **Continuous state perception** — opponent kinematics (position,
 *      velocity, facing, damage %, state label). The bot should read
 *      these from `currentFrame - inputDelay` rather than from the live
 *      simulation. Delivered through a frame-keyed state delay buffer
 *      ({@link HardTierReactionSystem}).
 *
 *   2. **Discrete event perception** — instantaneous signals (attack
 *      starts, hazard spawns, KO confirms, platform crumble). These
 *      are *jittered* per-event from the same 15–20-frame band so the
 *      bot's reaction has human-like inconsistency. Already covered by
 *      {@link ReactionWindow}; this module composes one as the optional
 *      `events` facet so a single Hard-tier reaction system owns both
 *      channels.
 *
 * Why both: a state-only buffer would let the bot infer that "an attack
 * started" simply by reading `stateLabel === 'attacking'` from a delayed
 * snapshot, but that loses the per-event jitter that makes Hard-tier feel
 * organic. A discrete-event channel restores it. Conversely, a
 * discrete-event-only model can't satisfy continuous queries like
 * "where is the opponent right now" — the bot would need an unbounded
 * stream of every position change. Combining the two gives the right
 * shape for both kinds of perception.
 *
 * Configurable input delay
 * ------------------------
 * Two specs supported:
 *
 *   - `fixed`   — a single integer delay applied every frame, stable
 *                 across the match. Recommended for replay-friendly
 *                 behavior where the bot's perception offset is part
 *                 of the deterministic state. The default Hard tier
 *                 picks **17** (mid of [15, 20]).
 *
 *   - `sampled` — rolled once at construction (and on demand via
 *                 {@link HardTierReactionSystem.reconfigureDelay}) from
 *                 `[minFrames, maxFrames]` via a caller-owned {@link Rng}.
 *                 The roll is *sticky* — re-sampled only on explicit
 *                 reconfigure — so the perceived state doesn't time-shift
 *                 mid-match (which would manifest as the opponent
 *                 teleporting backwards/forwards in the bot's view).
 *
 * The discrete-event channel uses {@link ReactionWindow}'s native
 * per-event jitter — that's what gives Hard-tier its organic-feeling
 * variability *for events*. The continuous-state channel keeps a
 * stable offset because cherry-picking a different historical frame
 * each tick would cause perceived position / velocity discontinuities
 * that are worse than no delay at all.
 *
 * Determinism contract
 * --------------------
 *   - No `Math.random()`. RNG is caller-owned and snapshot-friendly.
 *   - All frame reads/writes validated as non-negative integers.
 *   - The state delay buffer is content-addressable by frame, never by
 *     wall-clock — same inputs produce the same outputs across replays.
 *   - {@link HardTierReactionSystem.snapshot} /
 *     {@link HardTierReactionSystem.restoreSnapshot} round-trip the
 *     entire system (delay spec + effective delay + buffered entries +
 *     event-window queue) so the 300-frame replay snapshot pipeline
 *     can rehydrate Hard-tier perception without bespoke adapters.
 *
 * Replay & VCR compatibility
 * --------------------------
 * On replay seek the controller calls {@link
 * HardTierReactionSystem.restoreSnapshot} with the snapshot recorded at
 * the seek anchor. The buffer's entries (and the event window's queue)
 * are restored verbatim; subsequent ticks resume normally because the
 * delay specification, effective delay, and buffered perceptions all
 * match what the original recording held.
 *
 * What this module deliberately is NOT
 * ------------------------------------
 *   - A behavior tree. The system is a perception input *to* the BT;
 *     it never reads the BT or fires actions.
 *   - A scene observer. The match scene assembles the world snapshot
 *     once per fixed step and pushes it in. The system never imports
 *     Phaser / Matter.
 *   - A replacement for {@link ReactionWindow}. The ReactionWindow
 *     remains the canonical event-jitter primitive; this module just
 *     composes one for the convenience of Hard-tier consumers that
 *     want both channels.
 *
 * @example Hard-tier perception wiring
 * ```ts
 * const rng = new Rng(seed);
 * const reaction = new HardTierReactionSystem<WorldSnapshot, GameEvent>({
 *   inputDelay: { mode: 'sampled', minFrames: 15, maxFrames: 20 },
 *   rng,
 *   eventRange: REACTION_WINDOW_PRESETS.hard,
 * });
 *
 * function onFixedStep(frame: number, world: WorldSnapshot): void {
 *   reaction.pushPerception(frame, world);
 *   const delayed = reaction.perceive(frame);
 *   if (delayed) {
 *     // Feed `delayed` into the offensive / recovery sub-trees.
 *     hardOffensiveTree.tick({ ..., opponent: pickOpponent(delayed) });
 *   }
 *   for (const ev of reaction.events?.pollReady(frame) ?? []) {
 *     blackboard.set('lastPerceivedEvent', ev.payload);
 *   }
 * }
 * ```
 */

import { type Rng } from '../utils/Rng';
import {
  ReactionWindow,
  type ReactionWindowRange,
  type ReactionWindowSnapshot,
} from './perception/ReactionWindow';
import { REACTION_WINDOW_PRESETS } from './perception/reactionWindowPresets';
import {
  findOpponentBySlot,
  type PerceivedOpponent,
  type WorldSnapshot,
} from './perception/WorldSnapshot';
import { type PlayerSlotIndex } from '../input/InputProvider';

// ---------------------------------------------------------------------------
// Configurable delay specification
// ---------------------------------------------------------------------------

/**
 * Specification for the Hard-tier input delay.
 *
 *   - `fixed`   — a single integer applied every frame (stable across
 *                 the match unless explicitly reconfigured).
 *   - `sampled` — rolled once at construction or on reconfigure from
 *                 `[minFrames, maxFrames]` via a caller-owned RNG. The
 *                 roll is sticky (not re-sampled per frame) to preserve
 *                 perceived continuity in the state delay buffer.
 */
export type HardTierInputDelaySpec =
  | { readonly mode: 'fixed'; readonly frames: number }
  | {
      readonly mode: 'sampled';
      readonly minFrames: number;
      readonly maxFrames: number;
    };

/**
 * AC-mandated Hard-tier reaction band (15–20 frames inclusive).
 *
 * Re-exported from {@link REACTION_WINDOW_PRESETS}.hard so callers can
 * import the canonical band from a single place. Mutate this and every
 * Hard-tier consumer scales coherently.
 */
export const HARD_TIER_INPUT_DELAY_RANGE: ReactionWindowRange =
  REACTION_WINDOW_PRESETS.hard;

/**
 * Default delay used when no spec is supplied — fixed at the *mid* of
 * the AC's 15–20-frame band.
 *
 * Mid (17 frames ≈ 283 ms at 60 FPS) is a deliberate choice over the
 * extremes: 15 frames is the AC's lower bound (very competent human),
 * 20 frames the upper (slow competent human). 17 sits at the centre of
 * what the AC tolerates so the default Hard-tier opponent feels neither
 * brittle-fast nor sluggish.
 */
export const DEFAULT_HARD_TIER_INPUT_DELAY: HardTierInputDelaySpec =
  Object.freeze({
    mode: 'fixed',
    frames: 17,
  });

/**
 * Default capacity of the state-delay ring buffer in frames.
 *
 * Sized to comfortably exceed the AC's 20-frame upper bound so the
 * default Hard tier never has to grow the buffer, while still leaving
 * headroom for callers that reconfigure to slower (Easy / Medium)
 * tiers without rebuilding the system. 64 frames ≈ ~1 second of
 * perception history at 60 FPS — adequate for any conceivable AC
 * tier and trivial in memory cost.
 */
export const DEFAULT_HARD_TIER_BUFFER_CAPACITY = 64;

// ---------------------------------------------------------------------------
// Construction options & snapshot shape
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link HardTierReactionSystem}.
 *
 * @typeParam TSnap  Continuous-state snapshot type. Defaults to
 *                   {@link WorldSnapshot}; tests routinely substitute a
 *                   simpler shape to avoid building full world state.
 * @typeParam TEvent Discrete-event payload type used by the optional
 *                   events facet. Defaults to `unknown` because callers
 *                   that don't enable events never reference it.
 */
export interface HardTierReactionOptions {
  /**
   * Initial input delay specification. Defaults to
   * {@link DEFAULT_HARD_TIER_INPUT_DELAY} (fixed 17 frames). When
   * `mode === 'sampled'` the constructor requires {@link rng}.
   */
  readonly inputDelay?: HardTierInputDelaySpec;
  /**
   * Caller-owned RNG. Required iff `inputDelay.mode === 'sampled'` or
   * the consumer enables the events facet via {@link eventRange}. The
   * system never calls `Math.random()`; all stochastic decisions flow
   * through this PRNG.
   */
  readonly rng?: Rng;
  /**
   * Capacity of the state-delay ring buffer in frames. Must be a
   * positive integer >= the maximum effective delay; throws on
   * violation. Defaults to {@link DEFAULT_HARD_TIER_BUFFER_CAPACITY}.
   */
  readonly bufferCapacity?: number;
  /**
   * Optional event-channel range. When supplied, the system constructs
   * a {@link ReactionWindow} (sharing the supplied RNG) and exposes it
   * as the {@link HardTierReactionSystem.events} facet. Omit when only
   * continuous-state perception is needed — the event window's
   * allocation cost is then avoided.
   */
  readonly eventRange?: ReactionWindowRange;
}

/**
 * One frame of perception held in the delay buffer.
 *
 * Public so callers / tests can serialise the buffer through
 * {@link HardTierReactionSystem.snapshot} and assert on its contents.
 *
 * @typeParam TSnap Continuous-state snapshot type.
 */
export interface HardTierReactionEntry<TSnap> {
  /** Simulation frame the snapshot was pushed on. */
  readonly frame: number;
  /** Caller-supplied snapshot. Stored by reference (no defensive copy). */
  readonly snapshot: TSnap;
}

/**
 * Snapshot shape for {@link HardTierReactionSystem.snapshot} /
 * {@link HardTierReactionSystem.restoreSnapshot}.
 *
 * Plain data so it round-trips through `JSON.stringify` cleanly inside
 * a 300-frame replay state snapshot. RNG state is intentionally NOT
 * captured — it is owned by the controller and snapshotted separately
 * so multiple consumers sharing one RNG stay in sync.
 */
export interface HardTierReactionSnapshot<TSnap, TEvent> {
  /** Effective delay frames at the time of the snapshot. */
  readonly inputDelayFrames: number;
  /** Original delay specification (re-rolled on restore for `sampled` mode). */
  readonly inputDelaySpec: HardTierInputDelaySpec;
  /** Buffer capacity in frames. */
  readonly bufferCapacity: number;
  /** All buffered perceptions, ordered by ascending frame. */
  readonly entries: ReadonlyArray<HardTierReactionEntry<TSnap>>;
  /** Optional event-window queue snapshot, present iff `events` is enabled. */
  readonly events?: ReactionWindowSnapshot<TEvent>;
}

// ---------------------------------------------------------------------------
// HardTierReactionSystem — the main class
// ---------------------------------------------------------------------------

/**
 * State-delay buffer + optional event-window facet for Hard-tier
 * perception.
 *
 * @typeParam TSnap  Continuous-state snapshot type. Defaults to
 *                   {@link WorldSnapshot}.
 * @typeParam TEvent Discrete-event payload type. Defaults to `unknown`.
 */
export class HardTierReactionSystem<
  TSnap = WorldSnapshot,
  TEvent = unknown,
> {
  /** Caller-owned RNG. `null` when only fixed mode is in use and no events facet was enabled. */
  private readonly rng: Rng | null;
  /** Capacity of the ring buffer (frames). */
  private readonly bufferCapacity: number;

  /** Resolved current effective delay in frames. */
  private currentInputDelayFrames: number;
  /** Last-set delay specification — kept for reconfigure / snapshot reasoning. */
  private currentSpec: HardTierInputDelaySpec;

  /**
   * Buffered perceptions, in non-decreasing `frame` order. Stored as an
   * array (not a Map) because the access pattern is dominated by:
   *
   *   - Append at the back (one push per fixed step).
   *   - Reverse linear scan to find the most recent entry with
   *     `frame <= targetFrame`.
   *   - Shift from the front when capacity is exceeded.
   *
   * For a buffer capped at ~64 entries the array variant beats Map on
   * both memory and constant factor. If capacity ever grows past
   * thousands a binary-search variant is a drop-in replacement; the
   * public surface doesn't depend on the storage shape.
   */
  private entries: HardTierReactionEntry<TSnap>[] = [];

  /**
   * Optional event-window facet. `null` when no `eventRange` was
   * supplied at construction. Public so consumers can call
   * `events.observe(...)` / `events.pollReady(...)` directly without
   * extra ceremony.
   */
  public readonly events: ReactionWindow<TEvent> | null;

  /**
   * @param options See {@link HardTierReactionOptions}. Validates the
   *                delay specification, buffer capacity, and RNG
   *                requirements; throws on misconfiguration.
   */
  constructor(options: HardTierReactionOptions = {}) {
    const spec = options.inputDelay ?? DEFAULT_HARD_TIER_INPUT_DELAY;
    const capacity = options.bufferCapacity ?? DEFAULT_HARD_TIER_BUFFER_CAPACITY;
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(
        `HardTierReactionSystem: bufferCapacity must be a positive integer, ` +
          `got ${String(capacity)}`,
      );
    }
    this.bufferCapacity = capacity;
    this.rng = options.rng ?? null;

    this.currentSpec = validateAndNormaliseSpec(spec);
    this.currentInputDelayFrames = this.rollDelayFor(this.currentSpec);
    if (this.currentInputDelayFrames > this.bufferCapacity) {
      throw new Error(
        `HardTierReactionSystem: bufferCapacity (${this.bufferCapacity}) ` +
          `must be >= effective input delay ` +
          `(${this.currentInputDelayFrames})`,
      );
    }

    if (options.eventRange) {
      if (!this.rng) {
        throw new Error(
          'HardTierReactionSystem: eventRange requires an rng — events ' +
            'channel jitter is sampled stochastically',
        );
      }
      this.events = new ReactionWindow<TEvent>({
        ...options.eventRange,
        rng: this.rng,
      });
    } else {
      this.events = null;
    }
  }

  // -------------------------------------------------------------------------
  // Continuous-state delay buffer
  // -------------------------------------------------------------------------

  /**
   * Push a fresh ground-truth perception into the buffer.
   *
   * The match scene calls this once per fixed step with the
   * authoritative current world snapshot. The system stores the entry
   * by frame and evicts the oldest entry when capacity is exceeded.
   *
   * Same-frame re-push is allowed and treated as last-write-wins so
   * the controller can rebuild the snapshot mid-tick (e.g. after a
   * deferred KO resolution) without leaving stale data behind.
   *
   * Throws when:
   *   - `frame` is negative or non-integer (defensive against engine
   *     bugs);
   *   - `frame` is strictly less than the most recently pushed frame
   *     (the buffer must advance forwards in time — going backwards is
   *     a sign the controller forgot to call {@link clear} after a
   *     replay scrub).
   */
  pushPerception(frame: number, snapshot: TSnap): void {
    assertNonNegativeInteger(frame, 'frame');
    const last = this.entries[this.entries.length - 1];
    if (last !== undefined) {
      if (frame < last.frame) {
        throw new Error(
          `HardTierReactionSystem.pushPerception: frame ${frame} is before ` +
            `last pushed frame ${last.frame}; call clear() / restoreSnapshot() ` +
            `before replaying earlier frames`,
        );
      }
      if (frame === last.frame) {
        // Last-write-wins on same-frame re-push — replace in place
        // without changing the queue length.
        this.entries[this.entries.length - 1] = { frame, snapshot };
        return;
      }
    }
    this.entries.push({ frame, snapshot });
    while (this.entries.length > this.bufferCapacity) {
      this.entries.shift();
    }
  }

  /**
   * Sample the perception the bot should see *this* tick — i.e. the
   * snapshot at frame `currentFrame - inputDelayFrames`.
   *
   * Returns:
   *   - `null` if the delayed frame is negative (warm-up — the match
   *     hasn't been running long enough for the delay to elapse);
   *   - `null` if no buffered entry exists at or before the delayed
   *     frame (the controller hasn't pushed yet, or every relevant
   *     entry was evicted);
   *   - the snapshot stored at the most recent frame `<= targetFrame`
   *     otherwise. When the controller pushes every fixed step the
   *     match operates strictly in `entry.frame === targetFrame` mode;
   *     the "most-recent-non-future" fallback handles the rare case of
   *     a missed push without exposing future state to the bot.
   */
  perceive(currentFrame: number): TSnap | null {
    assertNonNegativeInteger(currentFrame, 'currentFrame');
    const targetFrame = currentFrame - this.currentInputDelayFrames;
    if (targetFrame < 0) return null;
    return this.findClosestNonFutureSnapshot(targetFrame);
  }

  /**
   * Look up the snapshot pushed for *exactly* the requested frame.
   *
   * Returns `null` when no entry was pushed for that frame (or it was
   * evicted). Mainly useful for tests / replay diagnostics — production
   * AI code should call {@link perceive}.
   */
  peekFrame(frame: number): TSnap | null {
    assertNonNegativeInteger(frame, 'frame');
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i];
      if (entry === undefined) continue;
      if (entry.frame === frame) return entry.snapshot;
      if (entry.frame < frame) return null;
    }
    return null;
  }

  /**
   * True iff the buffer currently holds a perception at or before
   * `currentFrame - inputDelayFrames` — i.e. {@link perceive} would
   * return non-null. Cheap O(1) check.
   */
  hasWarmedUp(currentFrame: number): boolean {
    assertNonNegativeInteger(currentFrame, 'currentFrame');
    const targetFrame = currentFrame - this.currentInputDelayFrames;
    if (targetFrame < 0) return false;
    const oldest = this.entries[0];
    if (oldest === undefined) return false;
    return oldest.frame <= targetFrame;
  }

  /** Number of perceptions currently buffered (≤ {@link getBufferCapacity}). */
  size(): number {
    return this.entries.length;
  }

  /** Read-only view of every buffered entry, in ascending frame order. */
  peekEntries(): ReadonlyArray<HardTierReactionEntry<TSnap>> {
    return this.entries.slice();
  }

  // -------------------------------------------------------------------------
  // Configuration accessors
  // -------------------------------------------------------------------------

  /** Effective input delay in frames (`>= 0` integer). */
  getInputDelayFrames(): number {
    return this.currentInputDelayFrames;
  }

  /** Original delay specification (`fixed` or `sampled`). */
  getInputDelaySpec(): HardTierInputDelaySpec {
    return this.currentSpec;
  }

  /** Capacity of the state delay ring buffer in frames. */
  getBufferCapacity(): number {
    return this.bufferCapacity;
  }

  /**
   * Replace the delay specification.
   *
   *   - `fixed` — the new fixed delay applies on the next {@link perceive}
   *     call.
   *   - `sampled` — the delay is re-rolled from the new band immediately
   *     using the constructor-supplied RNG.
   *
   * The buffer is unchanged; subsequent ticks will simply read a
   * different historical frame. Throws if the new effective delay
   * exceeds the buffer capacity (no point sampling a frame that's
   * about to be evicted).
   */
  reconfigureDelay(spec: HardTierInputDelaySpec): void {
    const normalised = validateAndNormaliseSpec(spec);
    const next = this.rollDelayFor(normalised);
    if (next > this.bufferCapacity) {
      throw new Error(
        `HardTierReactionSystem.reconfigureDelay: effective delay (${next}) ` +
          `exceeds bufferCapacity (${this.bufferCapacity})`,
      );
    }
    this.currentSpec = normalised;
    this.currentInputDelayFrames = next;
  }

  // -------------------------------------------------------------------------
  // Lifecycle: clear / snapshot / restore
  // -------------------------------------------------------------------------

  /**
   * Discard every buffered perception and every pending event.
   *
   * Used on match restart, replay scrub-back, and tier swap so the bot
   * cannot perceive state that pre-dates the new logical timeline.
   * Idempotent — calling on an already-empty system is a no-op.
   */
  clear(): void {
    this.entries = [];
    this.events?.clear();
  }

  /**
   * Capture the system state for the replay snapshot pipeline.
   *
   * Returns a deep-immutable record covering:
   *   - The effective delay + spec (so a replay produces the same
   *     perception offset on rehydrate);
   *   - The buffered perceptions (so warm-up state is restored);
   *   - The event-window queue (when `events` is enabled).
   *
   * RNG state is *not* captured — the controller owns the RNG and
   * snapshots it separately so a single RNG shared across multiple
   * consumers stays in sync.
   */
  snapshot(): HardTierReactionSnapshot<TSnap, TEvent> {
    const entries: HardTierReactionEntry<TSnap>[] = this.entries.map(
      (e) => ({ frame: e.frame, snapshot: e.snapshot }),
    );
    if (this.events) {
      return {
        inputDelayFrames: this.currentInputDelayFrames,
        inputDelaySpec: this.currentSpec,
        bufferCapacity: this.bufferCapacity,
        entries,
        events: this.events.snapshot(),
      };
    }
    return {
      inputDelayFrames: this.currentInputDelayFrames,
      inputDelaySpec: this.currentSpec,
      bufferCapacity: this.bufferCapacity,
      entries,
    };
  }

  /**
   * Replace the system state from a snapshot.
   *
   * Validates each field to fail loudly on corrupted snapshots:
   *   - `inputDelayFrames` is a non-negative integer ≤ `bufferCapacity`;
   *   - `inputDelaySpec` is well-formed (delegates to the same
   *     validator the constructor uses);
   *   - entries are in non-decreasing frame order with non-negative
   *     integer frames;
   *   - the events sub-snapshot, when present, validates through
   *     {@link ReactionWindow.restoreSnapshot}.
   *
   * The snapshot's `bufferCapacity` is informational only — capacity
   * is fixed at construction time and does not migrate across snapshot
   * boundaries. (A capacity migration would require allocating a new
   * system, which is out of scope for the replay system.)
   */
  restoreSnapshot(snap: HardTierReactionSnapshot<TSnap, TEvent>): void {
    this.currentSpec = validateAndNormaliseSpec(snap.inputDelaySpec);
    if (
      !Number.isInteger(snap.inputDelayFrames) ||
      snap.inputDelayFrames < 0
    ) {
      throw new Error(
        `HardTierReactionSystem.restoreSnapshot: inputDelayFrames must be a ` +
          `non-negative integer, got ${String(snap.inputDelayFrames)}`,
      );
    }
    if (snap.inputDelayFrames > this.bufferCapacity) {
      throw new Error(
        `HardTierReactionSystem.restoreSnapshot: inputDelayFrames ` +
          `(${snap.inputDelayFrames}) exceeds bufferCapacity ` +
          `(${this.bufferCapacity})`,
      );
    }
    this.currentInputDelayFrames = snap.inputDelayFrames;

    const next: HardTierReactionEntry<TSnap>[] = [];
    let prevFrame = -1;
    for (const e of snap.entries) {
      assertNonNegativeInteger(e.frame, 'snapshot entry frame');
      if (e.frame < prevFrame) {
        throw new Error(
          'HardTierReactionSystem.restoreSnapshot: entries must be in ' +
            'non-decreasing frame order',
        );
      }
      next.push({ frame: e.frame, snapshot: e.snapshot });
      prevFrame = e.frame;
    }
    if (next.length > this.bufferCapacity) {
      throw new Error(
        `HardTierReactionSystem.restoreSnapshot: snapshot contains ` +
          `${next.length} entries which exceeds bufferCapacity ` +
          `(${this.bufferCapacity})`,
      );
    }
    this.entries = next;

    if (snap.events !== undefined) {
      if (!this.events) {
        throw new Error(
          'HardTierReactionSystem.restoreSnapshot: snapshot includes events ' +
            'queue but the system was constructed without an eventRange',
        );
      }
      this.events.restoreSnapshot(snap.events);
    } else if (this.events) {
      // Snapshot omits events but the system has an events facet —
      // safest interpretation is "events queue was empty when snapshot
      // was taken"; clear the live queue so playback starts clean.
      this.events.clear();
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Walk the buffer from the most recent entry backwards, returning
   * the first snapshot whose frame is `<= targetFrame`. Linear in the
   * worst case, but the typical case (controller pushes every tick)
   * resolves on the first iteration.
   */
  private findClosestNonFutureSnapshot(targetFrame: number): TSnap | null {
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i];
      if (entry === undefined) continue;
      if (entry.frame <= targetFrame) return entry.snapshot;
    }
    return null;
  }

  /**
   * Resolve a delay specification into a concrete integer delay.
   * `fixed` returns its frames verbatim; `sampled` rolls inclusively
   * from `[minFrames, maxFrames]` via the caller-owned RNG. Throws
   * if `sampled` mode is configured without an RNG.
   */
  private rollDelayFor(spec: HardTierInputDelaySpec): number {
    if (spec.mode === 'fixed') return spec.frames;
    if (!this.rng) {
      throw new Error(
        'HardTierReactionSystem: sampled inputDelay requires an rng — pass ' +
          'one in HardTierReactionOptions',
      );
    }
    return this.rng.range(spec.minFrames, spec.maxFrames);
  }
}

// ---------------------------------------------------------------------------
// Convenience helpers — typed for the WorldSnapshot specialization
// ---------------------------------------------------------------------------

/**
 * Read the perceived state of one opponent through the delay buffer.
 *
 * Convenience helper for the common Hard-tier flow:
 *
 *   1. Pull the delayed world snapshot via {@link
 *      HardTierReactionSystem.perceive}.
 *   2. Find the per-slot opponent in that snapshot via {@link
 *      findOpponentBySlot}.
 *
 * Returns `null` whenever either step yields nothing — the bot's
 * caller treats `null` as "no actionable perception this tick".
 */
export function perceiveOpponent(
  system: HardTierReactionSystem<WorldSnapshot, unknown>,
  currentFrame: number,
  slotIndex: PlayerSlotIndex,
): PerceivedOpponent | null {
  const snap = system.perceive(currentFrame);
  if (!snap) return null;
  return findOpponentBySlot(snap, slotIndex);
}

// ---------------------------------------------------------------------------
// Internal validation helpers
// ---------------------------------------------------------------------------

/** Shared validation helper — not exported. */
function assertNonNegativeInteger(value: number, label: string): void {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(
      `HardTierReactionSystem: ${label} must be a non-negative integer, ` +
        `got ${String(value)}`,
    );
  }
}

/**
 * Validate a {@link HardTierInputDelaySpec} and return it (typed-narrowly)
 * with a defensive shallow copy. Throws on:
 *
 *   - unrecognised `mode` discriminator;
 *   - non-integer / negative `frames` (fixed mode);
 *   - non-positive integer / inverted bounds (sampled mode).
 *
 * The returned object is a fresh literal so callers can hold onto a
 * canonical copy without worrying about subsequent mutation by the
 * caller's original reference.
 */
function validateAndNormaliseSpec(
  spec: HardTierInputDelaySpec,
): HardTierInputDelaySpec {
  if (!spec || typeof spec !== 'object') {
    throw new Error(
      `HardTierReactionSystem: inputDelay spec must be an object, got ` +
        `${String(spec)}`,
    );
  }
  if (spec.mode === 'fixed') {
    if (!Number.isInteger(spec.frames) || spec.frames < 0) {
      throw new Error(
        `HardTierReactionSystem: inputDelay.frames must be a non-negative ` +
          `integer, got ${String(spec.frames)}`,
      );
    }
    return { mode: 'fixed', frames: spec.frames };
  }
  if (spec.mode === 'sampled') {
    if (!Number.isInteger(spec.minFrames) || spec.minFrames < 1) {
      throw new Error(
        `HardTierReactionSystem: inputDelay.minFrames must be a positive ` +
          `integer, got ${String(spec.minFrames)}`,
      );
    }
    if (!Number.isInteger(spec.maxFrames) || spec.maxFrames < 1) {
      throw new Error(
        `HardTierReactionSystem: inputDelay.maxFrames must be a positive ` +
          `integer, got ${String(spec.maxFrames)}`,
      );
    }
    if (spec.minFrames > spec.maxFrames) {
      throw new Error(
        `HardTierReactionSystem: inputDelay.minFrames (${spec.minFrames}) ` +
          `must be <= maxFrames (${spec.maxFrames})`,
      );
    }
    return {
      mode: 'sampled',
      minFrames: spec.minFrames,
      maxFrames: spec.maxFrames,
    };
  }
  throw new Error(
    `HardTierReactionSystem: unknown inputDelay.mode "${
      (spec as { mode?: string }).mode ?? '<missing>'
    }"`,
  );
}
