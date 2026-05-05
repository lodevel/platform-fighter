/**
 * Item-spawn event log — T3 items framework, AC 17.
 *
 * What this module is
 * ===================
 *
 * The deterministic, append-only ledger of every item that physically
 * appeared on the stage during a match. Sits next to
 * {@link ./InputCaptureBuffer} as the *second* per-match capture buffer
 * the M4 hybrid replay system persists into a `ReplayFile`:
 *
 *   InputCaptureBuffer  →  per-frame fighter inputs   (existing)
 *   ItemSpawnEventLog   →  one entry per item spawn   (this module)
 *
 * Each entry records the **type, position, and tick** of one spawn —
 * the three fields the AC calls out. The log is the single source of
 * truth for "an item appeared at frame N" so a replay browser, the
 * desync-recovery overlay, and the determinism harness can all reason
 * about item appearances without re-running the full
 * {@link ./../items/ItemSpawnManager}.
 *
 * Why a separate log (instead of widening InputCaptureBuffer)
 * ----------------------------------------------------------
 *
 *   • **Cardinality.** Inputs fire every fixed-step (~36 000 entries
 *     for a 10-minute match). Item spawns are sparse — 1 every few
 *     hundred frames at most. Forcing a sparse stream into the dense
 *     per-frame array would waste persistence space and complicate the
 *     timeline encoding.
 *
 *   • **Schema independence.** Item spawn events carry fields no input
 *     entry does (item type, anchor index, sub-pixel-precision world
 *     position). Mixing them into `RecordedCharacterInput` would force
 *     every neutral input to carry placeholders too.
 *
 *   • **Open-closed for new items.** The log stores `type` as an open
 *     string — adding a 4th item type later requires zero changes to
 *     the log; it just records a new string value. The Seed's
 *     extensibility invariant (new items land as new files only) keeps
 *     working.
 *
 * Determinism contract
 * --------------------
 *
 * The log is **append-only** by frame: `record()` rejects an event
 * whose frame is below the last recorded one. This mirrors the
 * monotonicity guarantee {@link ./InputCaptureBuffer} enforces and
 * makes "two log instances driven by the same spawn manager produce
 * byte-identical entries" a property the type system prevents from
 * regressing.
 *
 *   • Multiple events on the **same** frame are allowed. The current
 *     {@link ./../items/ItemSpawnManager} emits at most one spawn per
 *     `step()` call, but a future "burst spawn" mode (or two
 *     independent spawn drivers) might emit multiple — the log accepts
 *     them as long as each one's frame is `>= lastFrame`.
 *
 *   • Frame numbers must be non-negative integers. Non-finite / negative
 *     values throw — a corrupt frame field that slipped through to the
 *     log would silently break replay determinism otherwise.
 *
 *   • The recorded entry is **deeply frozen** so a caller mutating the
 *     event object after `record()` cannot retroactively corrupt the
 *     log.
 *
 *   • No wall-clock reads, no `Math.random()`, no Phaser / DOM imports.
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM imports. Unit-testable under plain Node
 * (vitest) and reusable from headless replay tooling that has to
 * reconstruct item spawn timelines without booting Phaser.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One item-spawn event entry. The three Seed-mandated fields —
 * **type, position, tick** — plus an optional `anchorIndex` carried for
 * round-trip diagnostics (the spawn manager picked anchor N; the replay
 * browser can highlight that anchor when scrubbing to this event).
 *
 * Field semantics:
 *
 *   • `frame` — the fixed-step tick the spawn was authorised on. Same
 *     domain as `physicsEngine.getFrame()`. Non-negative integer.
 *   • `type` — the item entity's type identifier. Open string so a
 *     hypothetical 4th item type can be recorded without changing the
 *     schema. The reference items in this codebase use lowerCamelCase
 *     (`'bat'`, `'rayGun'`, `'bomb'`); the log itself does not enforce
 *     a specific naming convention.
 *   • `x`, `y` — the world-space position (in design pixels) the item
 *     entity was materialised at. Mirrors
 *     {@link ./../items/ItemSpawnManager.ItemSpawnRequest.spawnPosition}.
 *     Stored as separate `x` / `y` fields (not a `{ x, y }` sub-object)
 *     so the JSON wire format is one less level of nesting per entry.
 *   • `anchorIndex` — the index in the stage's
 *     {@link ./../types/index.StageLayout.itemSpawnAnchors} array the
 *     spawn picked. Diagnostic only — the position is the canonical
 *     reproduction key — but useful for replay tooling that wants to
 *     correlate events with stage anchors.
 *
 * Frozen at construction by {@link ItemSpawnEventLog.record}. Callers
 * must not mutate the returned reference.
 */
export interface ItemSpawnEvent {
  /** Fixed-step tick the spawn fired on. Non-negative integer. */
  readonly frame: number;
  /** Item type identifier (e.g. `'bat'`, `'rayGun'`, `'bomb'`). */
  readonly type: string;
  /** World-space x of the spawn position (design pixels). */
  readonly x: number;
  /** World-space y of the spawn position (design pixels). */
  readonly y: number;
  /**
   * Index of the picked spawn anchor in the stage's anchor array.
   * Diagnostic — the canonical reproduction key is `(x, y)`. Stored as
   * a non-negative integer; `-1` is permitted for events whose spawn
   * pathway didn't go through an anchor (none today, reserved for
   * future hand-spawned debug items).
   */
  readonly anchorIndex: number;
}

// ---------------------------------------------------------------------------
// ItemSpawnEventLog
// ---------------------------------------------------------------------------

/**
 * Append-only frame-keyed item-spawn log. One per match.
 *
 * Lifecycle:
 *
 *   const log = new ItemSpawnEventLog();
 *   // …on each ItemSpawnRequest produced by ItemSpawnManager.step():
 *   log.record({
 *     frame: req.frame,
 *     type: 'bat',
 *     x: req.spawnPosition.x,
 *     y: req.spawnPosition.y,
 *     anchorIndex: req.anchorIndex,
 *   });
 *   // …at match end (or every snapshot pin), persist:
 *   const events = log.getEntries();
 *
 * The log is intentionally tiny — no constructor options, no
 * configurable size cap, no per-event back-pointers. Its only contract
 * is "give me a deterministic list of every spawn that fired."
 */
export class ItemSpawnEventLog {
  /**
   * Recorded events in capture order. Plain array (not a Map) because
   * — like {@link ./InputCaptureBuffer.entries} — entries are sparse,
   * monotonic, and bounded; the array is what we hand to the replay
   * serialiser verbatim.
   */
  private readonly entries: ItemSpawnEvent[] = [];

  /**
   * Last recorded frame, or `null` when empty. Tracked separately so
   * `record()` can validate non-decreasing frames in O(1). Note: this
   * is "non-decreasing" (NOT strictly monotonic like
   * `InputCaptureBuffer`) because two items may legitimately spawn on
   * the same frame in a future burst mode.
   */
  private lastFrame: number | null = null;

  /** Total number of recorded events. */
  size(): number {
    return this.entries.length;
  }

  /** True iff no events have been recorded yet. */
  isEmpty(): boolean {
    return this.entries.length === 0;
  }

  /** Most recently recorded frame, or `null` if empty. */
  getLastFrame(): number | null {
    return this.lastFrame;
  }

  /**
   * Record one item-spawn event. Performs:
   *
   *   1. **Frame-number validation** — must be a non-negative integer
   *      and `>= lastFrame`. Non-decreasing (rather than strict
   *      monotonic) so multiple items spawning on the same fixed-step
   *      tick are accepted; the order of two same-frame events is the
   *      caller's call order.
   *   2. **Type validation** — must be a non-empty string. Open enum so
   *      a future 4th item type doesn't require a schema change here,
   *      but rejecting `''` / `undefined` / non-string catches caller
   *      bugs early.
   *   3. **Position validation** — `x` / `y` must be finite numbers.
   *      Non-finite values would poison the replay browser's overlay
   *      and the determinism harness's diff.
   *   4. **anchorIndex validation** — must be an integer `>= -1`. The
   *      `-1` sentinel is reserved for "this spawn did not go through
   *      an anchor" (no current pathway uses it, but it makes the
   *      schema forward-compat for hand-spawned debug items).
   *   5. **Defensive freeze** — the recorded entry is `Object.freeze`-d
   *      so a caller mutating the event object after `record()` cannot
   *      retroactively corrupt the log.
   *
   * @param event  The spawn event to record.
   */
  record(event: ItemSpawnEvent): void {
    if (event === null || typeof event !== 'object') {
      throw new Error(
        `ItemSpawnEventLog.record: event must be a non-null object`,
      );
    }
    if (!Number.isInteger(event.frame) || event.frame < 0) {
      throw new Error(
        `ItemSpawnEventLog.record: frame must be a non-negative integer, ` +
          `got ${String(event.frame)}`,
      );
    }
    if (this.lastFrame !== null && event.frame < this.lastFrame) {
      throw new Error(
        `ItemSpawnEventLog.record: frame ${event.frame} is below last ` +
          `recorded frame ${this.lastFrame} — events must be non-decreasing ` +
          `to preserve replay determinism`,
      );
    }
    if (typeof event.type !== 'string' || event.type.length === 0) {
      throw new Error(
        `ItemSpawnEventLog.record: type must be a non-empty string`,
      );
    }
    if (typeof event.x !== 'number' || !Number.isFinite(event.x)) {
      throw new Error(
        `ItemSpawnEventLog.record: x must be a finite number, got ` +
          `${String(event.x)}`,
      );
    }
    if (typeof event.y !== 'number' || !Number.isFinite(event.y)) {
      throw new Error(
        `ItemSpawnEventLog.record: y must be a finite number, got ` +
          `${String(event.y)}`,
      );
    }
    if (
      !Number.isInteger(event.anchorIndex) ||
      event.anchorIndex < -1
    ) {
      throw new Error(
        `ItemSpawnEventLog.record: anchorIndex must be an integer >= -1, ` +
          `got ${String(event.anchorIndex)}`,
      );
    }

    this.entries.push(
      Object.freeze({
        frame: event.frame,
        type: event.type,
        x: event.x,
        y: event.y,
        anchorIndex: event.anchorIndex,
      }) as ItemSpawnEvent,
    );
    this.lastFrame = event.frame;
  }

  /**
   * Read-only view of every recorded event in capture order. The
   * returned array is the log's internal storage — callers MUST NOT
   * mutate it (every entry is already frozen, but the outer array is
   * not, because freezing it would break the serialiser's ability to
   * pass it to `Array.prototype.map`).
   */
  getEntries(): ReadonlyArray<ItemSpawnEvent> {
    return this.entries;
  }

  /**
   * Drop every recorded event. Intended for the scene's SHUTDOWN hook
   * so a subsequent match doesn't inherit the previous match's spawn
   * log.
   */
  reset(): void {
    this.entries.length = 0;
    this.lastFrame = null;
  }
}
