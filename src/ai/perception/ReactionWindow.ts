/**
 * ReactionWindow — gates AI perception of player actions behind a sampled
 * latency window so bots respond on a human-like timescale.
 *
 * Why this exists
 * ---------------
 * A behavior tree that reads the live world state every tick is omniscient
 * — it sees a smash startup the same frame the player begins it and can
 * shield the very next frame. That feels robotic and unfair; competent
 * humans need ~15-20 frames (≈250-330 ms at 60 FPS) to perceive a stimulus
 * and convert it into an input. The Hard-tier AC targets exactly that
 * window. Easy / Medium tiers are even slower (see {@link
 * REACTION_WINDOW_PRESETS}).
 *
 * Mental model
 * ------------
 * Treat the window as an in-flight pipeline of observations:
 *
 *   1. The world raises an event ("opponent started a smash") which the
 *      controller hands to {@link ReactionWindow.observe} on the same
 *      simulation frame the event happened.
 *   2. The window samples a per-event delay from `[minDelayFrames,
 *      maxDelayFrames]` (inclusive) using the seeded {@link Rng} the
 *      caller passed at construction. The event becomes "visible" at
 *      `observedFrame + sampledDelay`.
 *   3. Each tick the controller calls {@link ReactionWindow.pollReady}
 *      with the *current* simulation frame. Every pending event whose
 *      visibility frame has been reached is returned (in observation
 *      order) and removed from the queue — those are the events the
 *      AI is now allowed to react to.
 *
 * Conceptually the window is a fixed-latency event pipe with a small,
 * deterministic jitter band. It does NOT spoof world state; the rest of
 * the controller still reads live positions / velocities for prediction.
 * Only discrete events (attack starts, hazard spawns, KO confirms,
 * platform crumble, …) need a reaction window because those are the
 * inputs a human plays *off of*.
 *
 * Determinism contract
 * --------------------
 * The window takes a caller-owned {@link Rng}. It never reads
 * `Math.random()` and never queries wall-clock time. Two windows seeded
 * identically and fed identical `(payload, currentFrame)` sequences
 * produce identical visibility frames and pollReady output sequences —
 * a property the replay system relies on to verify drift-free playback.
 *
 * Replay-snapshot friendliness
 * ----------------------------
 * The hybrid replay snapshots full state every 300 frames. To support
 * that without exposing internals, {@link ReactionWindow.snapshot} and
 * {@link ReactionWindow.restoreSnapshot} round-trip the queued events
 * (payload + observed/visible frames). RNG state is owned by the caller
 * and snapshotted separately, so the window itself only needs to
 * preserve its in-flight queue.
 *
 * @example Hard-tier reactive shield gate
 * ```ts
 * const rng = new Rng(seed);
 * const window = new ReactionWindow<PlayerEvent>({
 *   minDelayFrames: 15,
 *   maxDelayFrames: 20,
 *   rng,
 * });
 *
 * function onWorldEvent(ev: PlayerEvent, frame: number): void {
 *   window.observe(ev, frame);
 * }
 *
 * function onAiTick(frame: number): void {
 *   for (const event of window.pollReady(frame)) {
 *     // event was observed 15-20 frames ago — react now.
 *     blackboard.set('lastPerceivedAttack', event);
 *   }
 * }
 * ```
 */

import { type Rng } from '../../utils/Rng';

/** Tier-specific reaction-window range (inclusive at both ends, in frames). */
export interface ReactionWindowRange {
  /** Smallest possible delay in frames. Must be a positive integer. */
  readonly minDelayFrames: number;
  /**
   * Largest possible delay in frames. Must be a positive integer
   * `>= minDelayFrames`.
   */
  readonly maxDelayFrames: number;
}

/** Construction options for {@link ReactionWindow}. */
export interface ReactionWindowOptions extends ReactionWindowRange {
  /**
   * Seeded RNG used to sample per-event delays. Owned by the caller —
   * the window only ever calls {@link Rng.range} on it. Sharing the
   * RNG across multiple reaction windows is safe so long as all sample
   * orders are themselves deterministic across replays.
   */
  readonly rng: Rng;
}

/**
 * One observation queued inside the window.
 *
 * Exposed publicly so callers can serialise the queue for replay
 * snapshots and so {@link ReactionWindow.peekPending} consumers can
 * surface "X frames until visible" diagnostics.
 *
 * @typeParam T Payload type — typically a discriminated union of player
 *              events (attack start, dodge release, hazard spawn, …).
 */
export interface ReactionWindowEntry<T> {
  /** Caller-supplied event data, stored verbatim (no defensive copy). */
  readonly payload: T;
  /** Frame on which the controller observed the event (`observe()` arg). */
  readonly observedFrame: number;
  /**
   * Frame at which the event becomes visible — `observedFrame + sampled
   * delay`. Equality with `currentFrame` counts as visible.
   */
  readonly visibleFrame: number;
}

/**
 * Snapshot shape used by {@link ReactionWindow.snapshot} /
 * {@link ReactionWindow.restoreSnapshot}.
 *
 * Plain-data, no class methods, so it can sit inside a replay state
 * snapshot and serialise through `JSON.stringify` without any
 * additional adapters.
 */
export interface ReactionWindowSnapshot<T> {
  readonly queue: ReadonlyArray<ReactionWindowEntry<T>>;
}

/**
 * Buffered observation queue with per-event sampled latency.
 *
 * @typeParam T Payload type for queued events.
 */
export class ReactionWindow<T> {
  private readonly minDelayFrames: number;
  private readonly maxDelayFrames: number;
  private readonly rng: Rng;

  /**
   * In-flight observations awaiting their visibility frame.
   *
   * Stored in observation order (FIFO) — observations with an earlier
   * `observedFrame` are at the front. Within a single frame, multiple
   * `observe()` calls preserve insertion order so the AI processes
   * events in the same order they were raised. `pollReady` walks the
   * front of the queue and stops at the first not-yet-visible entry,
   * which is correct because, with `minDelayFrames > 0`, the entry at
   * index `i+1` always has `observedFrame >= queue[i].observedFrame`
   * and visibility frames are non-decreasing in observation order
   * *only when* delays are sampled within an inclusive band; we
   * therefore additionally walk the entire queue for ready entries
   * to handle out-of-order visibility caused by jitter (an earlier
   * event sampled at `max` after a later event sampled at `min`).
   *
   * The queue is small (one bot rarely observes more than a handful of
   * events in flight) so a linear scan is fine and dramatically simpler
   * than a min-heap by `visibleFrame`.
   */
  private queue: ReactionWindowEntry<T>[] = [];

  /**
   * @param options See {@link ReactionWindowOptions}. Validates that the
   *                delay band is well-formed: both bounds positive
   *                integers and `min <= max`. Throws on invalid input
   *                so misconfigured tiers fail loudly during boot.
   */
  constructor(options: ReactionWindowOptions) {
    const { minDelayFrames, maxDelayFrames, rng } = options;
    assertPositiveInteger(minDelayFrames, 'minDelayFrames');
    assertPositiveInteger(maxDelayFrames, 'maxDelayFrames');
    if (minDelayFrames > maxDelayFrames) {
      throw new Error(
        `ReactionWindow: minDelayFrames (${minDelayFrames}) must be <= ` +
          `maxDelayFrames (${maxDelayFrames})`,
      );
    }
    this.minDelayFrames = minDelayFrames;
    this.maxDelayFrames = maxDelayFrames;
    this.rng = rng;
  }

  /** Inclusive minimum sampled delay in frames. Useful for diagnostics. */
  getMinDelayFrames(): number {
    return this.minDelayFrames;
  }

  /** Inclusive maximum sampled delay in frames. Useful for diagnostics. */
  getMaxDelayFrames(): number {
    return this.maxDelayFrames;
  }

  /**
   * Push a new observation into the pipeline.
   *
   * Samples a delay from `[minDelayFrames, maxDelayFrames]` (inclusive)
   * via the caller-owned RNG and computes the visibility frame as
   * `currentFrame + delay`. The entry is appended to the queue so
   * observation order is preserved within a single tick.
   *
   * Returns the resolved {@link ReactionWindowEntry} so callers can,
   * if they wish, log the synthetic visibility frame for debug overlays
   * — the same entry will be returned later from `pollReady`.
   *
   * @param payload Caller-supplied event data. Stored by reference; do
   *                not mutate after handing it to the window.
   * @param currentFrame Simulation frame on which the event happened.
   *                     Negative or non-integer values throw — the
   *                     fixed-step engine always supplies a non-negative
   *                     integer frame counter.
   */
  observe(payload: T, currentFrame: number): ReactionWindowEntry<T> {
    assertNonNegativeInteger(currentFrame, 'currentFrame');
    const delay = this.rng.range(this.minDelayFrames, this.maxDelayFrames);
    const entry: ReactionWindowEntry<T> = {
      payload,
      observedFrame: currentFrame,
      visibleFrame: currentFrame + delay,
    };
    this.queue.push(entry);
    return entry;
  }

  /**
   * Drain every observation that has reached its visibility frame.
   *
   * Returns ready entries in observation order (FIFO across the queue)
   * — *not* visibility-frame order — so a mid-air string of player
   * events surfaces to the bot in the order the player produced them.
   * Removed entries are no longer pending.
   *
   * @param currentFrame Simulation frame the controller is processing.
   *                     `entry.visibleFrame === currentFrame` counts
   *                     as visible (the event becomes available the
   *                     same tick the visibility frame is reached).
   */
  pollReady(currentFrame: number): ReactionWindowEntry<T>[] {
    assertNonNegativeInteger(currentFrame, 'currentFrame');
    if (this.queue.length === 0) {
      return [];
    }
    const ready: ReactionWindowEntry<T>[] = [];
    const remaining: ReactionWindowEntry<T>[] = [];
    for (const entry of this.queue) {
      if (entry.visibleFrame <= currentFrame) {
        ready.push(entry);
      } else {
        remaining.push(entry);
      }
    }
    this.queue = remaining;
    return ready;
  }

  /**
   * Read-only view of every entry currently waiting to surface.
   *
   * Includes both ready and not-yet-ready entries — useful for debug
   * overlays that render "5 frames until visible" indicators above
   * pending events. Mutating the returned array does not affect the
   * window's internal state (the array itself is fresh; the entries
   * are shared by reference but immutable via their `readonly` fields).
   */
  peekPending(): ReadonlyArray<ReactionWindowEntry<T>> {
    return this.queue.slice();
  }

  /**
   * Number of observations currently in flight (ready + not-yet-ready).
   *
   * Equivalent to `peekPending().length` but avoids the array copy.
   */
  pendingCount(): number {
    return this.queue.length;
  }

  /**
   * Discard every queued observation.
   *
   * Used on match restart, replay scrub-back, and tier swap so the AI
   * cannot react to perceptions that pre-date the new logical
   * timeline. Idempotent — calling on an empty window is a no-op.
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Capture the in-flight queue for the replay snapshot system.
   *
   * The returned object is a fresh, deep-immutable array of the same
   * `ReactionWindowEntry` records held internally — no internal
   * reference leaks. Pair with {@link restoreSnapshot} to rehydrate.
   *
   * RNG state is intentionally NOT included; the controller owns the
   * `Rng` and is expected to snapshot it separately so a single RNG
   * shared across multiple windows / decision systems stays in sync.
   */
  snapshot(): ReactionWindowSnapshot<T> {
    return { queue: this.queue.slice() };
  }

  /**
   * Replace the in-flight queue with `snapshot.queue`.
   *
   * Used on replay seek to rehydrate the window's pipeline from a
   * 300-frame state snapshot. Validates each entry to fail loudly on
   * corrupted snapshots rather than silently producing garbage during
   * playback.
   */
  restoreSnapshot(snapshot: ReactionWindowSnapshot<T>): void {
    const next: ReactionWindowEntry<T>[] = [];
    for (const entry of snapshot.queue) {
      assertNonNegativeInteger(entry.observedFrame, 'snapshot observedFrame');
      assertNonNegativeInteger(entry.visibleFrame, 'snapshot visibleFrame');
      if (entry.visibleFrame < entry.observedFrame) {
        throw new Error(
          'ReactionWindow.restoreSnapshot: visibleFrame must be >= ' +
            'observedFrame',
        );
      }
      next.push({
        payload: entry.payload,
        observedFrame: entry.observedFrame,
        visibleFrame: entry.visibleFrame,
      });
    }
    this.queue = next;
  }
}

/** Shared validation helper — not exported. */
function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `ReactionWindow: ${label} must be a positive integer, got ${String(value)}`,
    );
  }
}

/** Shared validation helper — not exported. */
function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `ReactionWindow: ${label} must be a non-negative integer, got ${String(value)}`,
    );
  }
}
