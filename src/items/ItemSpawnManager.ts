/**
 * ItemSpawnManager — deterministic timed item-spawn scheduler
 * (T3 items framework, AC 10 Sub-AC 3).
 *
 * Headline contract
 * =================
 *
 * The manager is the single owner of "when (and where) does the next
 * item appear on the stage?". Every match constructs one instance,
 * pumps `step(currentFrame, activeItemCount)` once per fixed-step
 * physics tick, and treats the returned {@link ItemSpawnRequest}
 * array as the authoritative "spawn now" command — the caller (a
 * later sub-AC) instantiates the actual item entity at the supplied
 * anchor.
 *
 * The class is intentionally Phaser-free and item-type-agnostic so
 * it satisfies the Seed's open-closed extensibility invariant: a new
 * item type can land in this codebase as a single subclass file
 * without ever editing this module. The manager only knows about
 * anchors, intervals, and the on-field cap; *what* spawns at the
 * picked anchor is the spawn-callsite's concern.
 *
 * Determinism contract
 * --------------------
 *
 * Two simulations driven through the same {@link MatchConfig} (same
 * seed, same {@link ItemFrequency}, same anchor list) and the same
 * `step()` call sequence produce *identical* spawn schedules,
 * tick-for-tick. The manager achieves this by:
 *
 *   1. Reading both the next-spawn-interval and the picked-anchor
 *      index from a single {@link MatchRng} substream — the canonical
 *      `'item-spawn'` stream — so two independent subsystems can
 *      never race on the same Mulberry32 state.
 *
 *   2. Never rolling the RNG when the request can't proceed. Two
 *      cases that *could* burn rolls (and break determinism if a
 *      replay reproduced a different cap-state path) are handled
 *      explicitly:
 *
 *        • {@link ItemFrequency} `'off'` short-circuits before any
 *          stream materialisation, so an items-disabled match never
 *          touches the RNG and a future "turn items on mid-match"
 *          path doesn't shift any other subsystem's stream.
 *        • Empty anchor list short-circuits identically — a stage
 *          authored without {@link ItemSpawnAnchor}s consumes no
 *          rolls.
 *        • When the on-field cap is full, the manager *idles*: it
 *          neither spawns nor advances its scheduled timer. The next
 *          time the cap frees up the manager spawns immediately on
 *          the same step (since the deadline has already elapsed) —
 *          burning exactly the rolls a fresh schedule would, no more.
 *
 *   3. Lazy-initialising the first spawn deadline on the first
 *      `step()` call. The manager is constructed before the
 *      simulation knows what frame the match starts on (which is
 *      typically `0`, but the replay system supports starting from
 *      a snapshot mid-match). The first `step(currentFrame, …)` call
 *      seeds `nextSpawnFrame = currentFrame + roll()`, so the spawn
 *      schedule is anchored to the simulation's first tick — not to
 *      the constructor — and a snapshot resync resumes from the
 *      right deadline via {@link snapshotState} / {@link restoreState}.
 *
 * Spawn cycle (per `step()` call)
 * -------------------------------
 *
 *   1. Reject if `'off'` or no anchors → no rolls, no spawn.
 *   2. Lazy-init `nextSpawnFrame` on first call.
 *   3. If active items ≥ cap → idle (no spawn, no roll, deadline
 *      preserved).
 *   4. If `currentFrame < nextSpawnFrame` → wait (no spawn, no roll).
 *   5. Otherwise: pick an anchor, emit one {@link ItemSpawnRequest},
 *      roll the next interval, set
 *      `nextSpawnFrame = currentFrame + interval`. Exactly one
 *      spawn per `step()` — even if the deadline elapsed many ticks
 *      ago (e.g. cap-full then freed) we never burst-spawn. The next
 *      tick handles the next eligible spawn.
 *
 * What this module deliberately does NOT do
 * -----------------------------------------
 *
 *   • It does not build {@link Item} entities. The spawn request
 *     carries the anchor + frame; the caller's spawn callsite owns
 *     the type-roulette + entity construction. This is the open-
 *     closed seam that lets new items land as new files.
 *   • It does not track live items. The caller passes
 *     `activeItemCount` each step. The manager would otherwise need
 *     to subscribe to pickup / break / TTL events from the items
 *     framework, coupling the scheduler to the entity layer.
 *   • It does not emit replay events. The replay-RNG seeding lives
 *     on `MatchRng`; the spawn-event log entries are produced by
 *     the spawn callsite (a later sub-AC) using the data this module
 *     yields.
 *   • It does not own the {@link MatchRng}. The manager holds a
 *     stable reference to the canonical match RNG so a snapshot
 *     resync that restores the MatchRng state automatically restores
 *     this manager's roll sequence too.
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM imports. Unit-testable under plain Node
 * (vitest) and reusable from headless replay tooling that has to
 * reproduce spawn ticks without booting Phaser.
 */

import type { ItemFrequency, ItemSpawnAnchor } from '../types';
import type { MatchRng } from '../match/MatchRng';
import type { Rng } from '../utils/Rng';
import {
  getItemSpawnInterval,
  getItemSpawnPosition,
  getMaxItemsOnField,
} from './itemSpawnSettings';

// ---------------------------------------------------------------------------
// Stream label
// ---------------------------------------------------------------------------

/**
 * Canonical {@link MatchRng} stream label this manager pulls from.
 * Exported so tests, snapshot writers, and a future "spawn debug
 * inspector" can reference the stream by the same name the manager
 * uses without reaching into private state.
 *
 * Keeping a dedicated stream (rather than reusing `'hazard'` or the
 * root) means adding new items / anchors / dial positions can never
 * shift another subsystem's PRNG sequence — old replays stay valid.
 */
export const ITEM_SPAWN_RNG_STREAM = 'item-spawn' as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One "spawn now" command produced by the manager. The caller
 * instantiates an item entity at {@link spawnPosition} on the supplied
 * `frame` and attaches a Matter.js body with normal gravity so the
 * item falls from the drop-in point toward {@link anchor} —
 * Smash-style "items rain in from above" (T3 items framework, AC
 * 90301 Sub-AC 1). See {@link ITEM_SPAWN_DROP_HEIGHT_PX} for the
 * vertical offset between {@link spawnPosition} and {@link anchor}.
 *
 * `anchorIndex` is exposed alongside the resolved {@link anchor}
 * record so the replay-event log can persist the picked anchor by
 * index without the caller having to scan the configured list.
 */
export interface ItemSpawnRequest {
  /** Fixed-step frame the spawn was authorised on (matches the `step` arg). */
  readonly frame: number;
  /**
   * Index of the picked anchor in the configured anchor array.
   * Stable across the manager's lifetime — the anchor array is
   * frozen at construction.
   */
  readonly anchorIndex: number;
  /** The picked anchor record itself, by reference. */
  readonly anchor: ItemSpawnAnchor;
  /**
   * The position the item entity should be **materialised** at — i.e.
   * the drop-in point a few hundred design pixels above {@link anchor}.
   * The spawn callsite places the item here and lets Matter.js gravity
   * pull it down to the anchor surface (drop-from-above behaviour).
   *
   * Computed deterministically from {@link anchor} via
   * {@link getItemSpawnPosition} — every replay reproduces the same
   * drop-in point given the same anchor index, with no extra coords
   * persisted in the replay event.
   */
  readonly spawnPosition: { readonly x: number; readonly y: number };
}

/**
 * Construction options for an {@link ItemSpawnManager}.
 *
 * `frequency` and `anchors` are both required: the dial position is
 * a {@link MatchConfig} field (resolved via `resolveItemFrequency`
 * upstream), and the anchor list comes from the active stage layout
 * ({@link StageLayout.itemSpawnAnchors}, which the spawn callsite
 * already has in hand at match-init time).
 */
export interface ItemSpawnManagerOptions {
  /**
   * Resolved items-frequency dial position. Pass through
   * `resolveItemFrequency(matchConfig.itemFrequency)` so corrupt
   * replay headers fall through to the default rather than
   * exploding here.
   */
  readonly frequency: ItemFrequency;
  /**
   * Stage-declared positions where items may appear. Frozen at
   * construction — re-build the manager if the stage changes mid-
   * match (no current path does this; included for forward-compat).
   * An empty array silently disables spawning even at high
   * frequency, matching the {@link StageLayout} spec.
   */
  readonly anchors: ReadonlyArray<ItemSpawnAnchor>;
  /**
   * The match-scoped {@link MatchRng}. The manager pulls its
   * substream from here on first use so a snapshot/restore cycle
   * on the MatchRng automatically restores this manager's roll
   * sequence.
   */
  readonly rng: MatchRng;
  /**
   * Override the {@link MatchRng} stream label. Defaults to
   * {@link ITEM_SPAWN_RNG_STREAM} (`'item-spawn'`). Unit tests use
   * this hook to verify that the manager really does pull from the
   * advertised stream and nothing else.
   */
  readonly streamLabel?: string;
}

/**
 * Snapshot of the manager's deterministic state. Plain JSON-safe
 * data so the M4 hybrid replay snapshot system can persist it
 * verbatim alongside the {@link MatchRngState}.
 *
 * The {@link Rng} stream itself is *not* duplicated here — it lives
 * on the {@link MatchRng}, which has its own snapshot path. Capturing
 * it twice would risk the two snapshots disagreeing after a hand-edit.
 */
export interface ItemSpawnManagerState {
  /**
   * Frame the next spawn is scheduled for. `null` means
   * "not yet initialised" (the simulation hasn't ticked the manager
   * yet) — which differs from "items disabled" (frequency `'off'`,
   * which the manager handles statelessly without ever populating
   * this field).
   */
  readonly nextSpawnFrame: number | null;
}

// ---------------------------------------------------------------------------
// ItemSpawnManager
// ---------------------------------------------------------------------------

/**
 * Deterministic items-spawn scheduler. One instance per match.
 *
 * Lifecycle:
 *
 *   const manager = new ItemSpawnManager({
 *     frequency: resolveItemFrequency(matchConfig.itemFrequency),
 *     anchors: stage.itemSpawnAnchors ?? [],
 *     rng: matchRng,
 *   });
 *
 *   // …once per fixed-step physics tick:
 *   const requests = manager.step(currentFrame, activeItemCount);
 *   for (const req of requests) {
 *     spawnItemAt(req.anchor, req.frame); // caller's job
 *   }
 *
 * `activeItemCount` is the number of live items currently on the
 * stage (the caller's items-framework holds this number; the manager
 * does not).
 */
export class ItemSpawnManager {
  private readonly frequency: ItemFrequency;
  private readonly anchors: ReadonlyArray<ItemSpawnAnchor>;
  private readonly matchRng: MatchRng;
  private readonly streamLabel: string;

  /**
   * Lazy-bound substream reference. Materialised on first roll so
   * an `'off'`-frequency manager that never spawns also never
   * touches the {@link MatchRng}, leaving the `'item-spawn'` stream
   * unmaterialised in the snapshot writer's diff.
   */
  private rngStream: Rng | null = null;

  /** Frame the next spawn is scheduled for. Lazy-initialised. */
  private nextSpawnFrame: number | null = null;

  constructor(options: ItemSpawnManagerOptions) {
    this.frequency = options.frequency;
    // Freeze the anchors array reference so reassignment can't drift
    // the schedule mid-match. Callers that need a different anchor
    // set rebuild the manager.
    this.anchors = options.anchors;
    this.matchRng = options.rng;
    this.streamLabel = options.streamLabel ?? ITEM_SPAWN_RNG_STREAM;
  }

  // -------------------------------------------------------------------------
  // Per-step driver
  // -------------------------------------------------------------------------

  /**
   * Advance the spawn schedule by one fixed-step tick.
   *
   * @param currentFrame  Monotonic fixed-step frame index. Must be a
   *   non-negative integer; non-finite / negative values throw.
   * @param activeItemCount  Number of live items currently on the
   *   stage. Treated as `0` when negative (defensive — the items
   *   framework should never produce a negative count, but a corrupt
   *   replay header that mutated it shouldn't crash the spawn loop).
   * @returns An array of zero or one {@link ItemSpawnRequest}. The
   *   array shape (rather than `T | null`) is forward-compat for a
   *   future "burst spawn" mode without changing the call signature
   *   on the caller side.
   */
  step(currentFrame: number, activeItemCount: number): ItemSpawnRequest[] {
    if (!Number.isFinite(currentFrame) || currentFrame < 0) {
      throw new Error(
        `ItemSpawnManager.step: currentFrame must be a non-negative finite number, got ${currentFrame}`,
      );
    }
    const safeFrame = Math.floor(currentFrame);
    const safeActive = Math.max(0, Math.floor(activeItemCount));

    // 1. Items disabled (`'off'`) or stage has no anchors → no spawn,
    //    no RNG roll, no state mutation. The latter keeps the snapshot
    //    diff empty for items-disabled matches.
    if (this.frequency === 'off') return [];
    if (this.anchors.length === 0) return [];

    // 2. Lazy-init the first deadline. This is intentionally allowed
    //    to happen *before* the cap check: even an items-disabled-by-
    //    cap match (cap=0 only happens for `'off'`, which we already
    //    rejected) gets its schedule anchored to the first tick the
    //    manager sees, so a later "cap freed up" path resumes from
    //    a stable deadline rather than rolling for the first time on
    //    an arbitrary later tick.
    if (this.nextSpawnFrame === null) {
      this.nextSpawnFrame = safeFrame + this.rollInterval();
    }

    // 3. Field is full → idle. Critically, do NOT advance
    //    `nextSpawnFrame` and do NOT roll. When the cap frees up the
    //    deadline is still where we left it and the next eligible
    //    step spawns immediately.
    const cap = getMaxItemsOnField(this.frequency);
    if (safeActive >= cap) return [];

    // 4. Deadline not reached yet → keep waiting.
    if (safeFrame < this.nextSpawnFrame) return [];

    // 5. Spawn one item. Pick the anchor THEN roll the next interval
    //    so the RNG-call sequence is `pickAnchor, rollInterval` per
    //    spawn — predictable and easy to verify under test.
    const anchorIndex = this.pickAnchorIndex();
    const anchor = this.anchors[anchorIndex]!;
    // Drop-from-above (AC 90301 Sub-AC 1): items materialise at a fixed
    // offset *above* the anchor; the spawn callsite attaches a gravity
    // body so the item falls toward the anchor surface. Computing the
    // drop point here (rather than at the entity layer) keeps the
    // single-source-of-truth invariant for replay determinism — the
    // saved replay only persists the anchor index; the drop-in point
    // is reconstructed from the anchor + the global drop-height
    // constant on playback.
    const spawnPosition = getItemSpawnPosition(anchor);
    const request: ItemSpawnRequest = {
      frame: safeFrame,
      anchorIndex,
      anchor,
      spawnPosition,
    };
    this.nextSpawnFrame = safeFrame + this.rollInterval();
    return [request];
  }

  // -------------------------------------------------------------------------
  // Read-only inspection (HUD / tests / replay)
  // -------------------------------------------------------------------------

  /** The resolved frequency dial this manager was constructed with. */
  getFrequency(): ItemFrequency {
    return this.frequency;
  }

  /** The configured anchor list (by reference; do not mutate). */
  getAnchors(): ReadonlyArray<ItemSpawnAnchor> {
    return this.anchors;
  }

  /** The cap on simultaneous live items for the current frequency. */
  getMaxItemsOnField(): number {
    return getMaxItemsOnField(this.frequency);
  }

  /**
   * Frame the next spawn is currently scheduled for, or `null` if
   * the manager hasn't been ticked yet (or items are disabled).
   * Useful for the debug HUD's "next spawn in N frames" overlay.
   */
  getNextSpawnFrame(): number | null {
    if (this.frequency === 'off') return null;
    if (this.anchors.length === 0) return null;
    return this.nextSpawnFrame;
  }

  /**
   * `true` once the manager has materialised its {@link MatchRng}
   * substream (i.e. has rolled at least one interval). Useful for
   * the snapshot writer's "skip empty streams" optimisation and
   * for tests that verify the `'off'` short-circuit doesn't touch
   * the RNG.
   */
  hasMaterialisedStream(): boolean {
    return this.rngStream !== null;
  }

  // -------------------------------------------------------------------------
  // Snapshot / restore (M4 hybrid replay snapshots)
  // -------------------------------------------------------------------------

  /**
   * Capture the deterministic schedule state. Pair with
   * {@link restoreState} on a snapshot resync.
   *
   * Note: the {@link MatchRng} substream's PRNG state is captured
   * separately by `MatchRng.snapshotState()`. This snapshot only
   * carries the manager-private deadline counter.
   */
  snapshotState(): ItemSpawnManagerState {
    return { nextSpawnFrame: this.nextSpawnFrame };
  }

  /**
   * Restore from a previously captured state. The matching
   * {@link MatchRng} restore call must happen first (or in the same
   * batch) so the substream is back to the right Mulberry32 state
   * before the next `step()` rolls a fresh interval.
   *
   * Defensive: rejects a non-`null` `nextSpawnFrame` that is not a
   * non-negative finite integer — a corrupt snapshot must not
   * silently produce an unscheduled spawn loop.
   */
  restoreState(state: ItemSpawnManagerState): void {
    if (state.nextSpawnFrame === null) {
      this.nextSpawnFrame = null;
      return;
    }
    const f = state.nextSpawnFrame;
    if (!Number.isFinite(f) || f < 0 || !Number.isInteger(f)) {
      throw new Error(
        `ItemSpawnManager.restoreState: nextSpawnFrame must be a non-negative integer or null, got ${f}`,
      );
    }
    this.nextSpawnFrame = f;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Materialise (once) and return the {@link MatchRng} substream
   * the manager pulls from. Lazy so an `'off'` manager never marks
   * the stream as touched in `MatchRng.listStreams()`.
   */
  private getRngStream(): Rng {
    if (this.rngStream === null) {
      this.rngStream = this.matchRng.stream(this.streamLabel);
    }
    return this.rngStream;
  }

  /**
   * Roll the next spawn-interval delay (in fixed-step frames) for
   * the configured frequency. Pulls a uniform integer in
   * `[min, max]` from the dedicated substream.
   *
   * Throws if called for `'off'` — which the public `step()` short-
   * circuits before reaching here. The throw guards against a
   * future refactor accidentally inviting an `'off'` roll.
   */
  private rollInterval(): number {
    const window = getItemSpawnInterval(this.frequency);
    if (window === null) {
      throw new Error(
        `ItemSpawnManager.rollInterval: frequency '${this.frequency}' has no spawn interval`,
      );
    }
    const stream = this.getRngStream();
    return stream.range(window.minIntervalFrames, window.maxIntervalFrames);
  }

  /**
   * Roll the picked-anchor index. Uniform over `[0, anchors.length)`.
   * Single-anchor stages still consume a roll so the RNG-call
   * sequence stays identical regardless of stage anchor count
   * (replay determinism across a hypothetical anchor-count edit).
   */
  private pickAnchorIndex(): number {
    const stream = this.getRngStream();
    return stream.range(0, this.anchors.length - 1);
  }
}
