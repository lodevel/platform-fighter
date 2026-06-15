/**
 * Phaser-free bounded undo/redo history for the M3 stage builder.
 *
 * "Implement undo/redo so every committed canvas mutation (place,
 * delete, load) can be stepped backward and forward".
 *
 * The history is a snapshot stack, not a command log. The stage data
 * model already produces frozen, immutable piece records, so a
 * snapshot is just a cheap bundle of references — undo restores the
 * whole roster in one bulk import instead of replaying inverse
 * operations one by one. That keeps the history correct by
 * construction: there is no "inverse of addPiece" to get subtly wrong.
 *
 * Shape
 * -----
 *
 * A history is a frozen `{ entries, index, limit }` triple where
 * `entries[index]` is the *current* state:
 *
 *     entries:  [ s0, s1, s2, s3 ]
 *     index:                ^ 2        ← s2 is live; s3 is the redo branch
 *
 *   • `pushHistory` drops everything after `index` (standard
 *     branch-clearing behaviour — once you edit after an undo, the
 *     redone future is gone), appends the new state, and trims the
 *     oldest entries once the stack exceeds `limit`.
 *   • `undo` / `redo` just move `index`; the entries array is shared
 *     by reference across the transition (it is frozen, so sharing is
 *     safe).
 *
 * Same-ref no-op contract
 * -----------------------
 *
 * Every transition returns the *same* history reference when nothing
 * changed — `undo` at the oldest entry, `redo` at the newest, and
 * `pushHistory` with a state that is reference-identical to the
 * current entry. Callers can therefore use `next === prev` to skip
 * repaint / re-apply work, mirroring the same-state-ref convention the
 * rest of the builder's pure modules follow.
 *
 * Determinism note: every function here is a pure function of its
 * arguments. No module-level mutable state, no `Math.random()`, no
 * wall-clock reads. A replay that records the sequence of pushes and
 * undo/redo keystrokes reproduces the exact history byte-identically.
 */

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Hard cap on the number of retained snapshots. 50 comfortably covers
 * a full builder session (the Seed caps stages at 30 pieces, so even
 * "place everything, delete everything" fits) while bounding memory to
 * a fixed number of roster references.
 */
export const EDIT_HISTORY_LIMIT = 50;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Immutable history value. Generic over the snapshot type so the unit
 * suite can drive it with plain strings while the scene instantiates
 * it with stage-data snapshots.
 *
 *   • `entries` — oldest → newest snapshot stack (frozen array).
 *   • `index`   — position of the current state inside `entries`.
 *                 Entries after `index` form the redo branch.
 *   • `limit`   — maximum entry count this history retains.
 */
export interface EditHistory<S> {
  readonly entries: ReadonlyArray<S>;
  readonly index: number;
  readonly limit: number;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Build a fresh history seeded with `initial` as the current (and
 * only) entry. The seed entry is the "empty canvas" floor — `undo`
 * never steps past it, so the player can always get back to the state
 * the session opened with.
 *
 * Defensive: a non-finite / non-positive `limit` is meaningless and
 * clamps to {@link EDIT_HISTORY_LIMIT} so a typo can't silently
 * disable the bound. A limit of `1` degenerates to "no undo", which
 * is still a valid (if useless) history.
 */
export function createEditHistory<S>(
  initial: S,
  limit: number = EDIT_HISTORY_LIMIT,
): EditHistory<S> {
  const safeLimit =
    Number.isFinite(limit) && Math.floor(limit) > 0
      ? Math.floor(limit)
      : EDIT_HISTORY_LIMIT;
  return freezeHistory([initial], 0, safeLimit);
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * Record a new committed state. Standard history semantics:
 *
 *   1. Same-ref no-op — pushing the state that is already current
 *      returns the same history reference (defends against double
 *      commits from re-entrant listeners).
 *   2. Branch clear — entries after `index` (the redo branch) are
 *      dropped; once the player edits after an undo, the redone
 *      future is unreachable.
 *   3. Cap trim — when the stack exceeds `limit`, the *oldest*
 *      entries fall off the front. The current state is always
 *      retained, so the cap only shortens how far back undo reaches.
 */
export function pushHistory<S>(history: EditHistory<S>, state: S): EditHistory<S> {
  if (state === history.entries[history.index]) return history;
  const kept = history.entries.slice(0, history.index + 1);
  kept.push(state);
  const overflow = kept.length - history.limit;
  const entries = overflow > 0 ? kept.slice(overflow) : kept;
  return freezeHistory(entries, entries.length - 1, history.limit);
}

/**
 * Step backward. Returns the same history reference when there is
 * nothing to undo (already at the oldest entry) so callers can skip
 * re-apply work via `next === prev`.
 */
export function undo<S>(history: EditHistory<S>): EditHistory<S> {
  if (history.index <= 0) return history;
  return freezeHistory(history.entries, history.index - 1, history.limit);
}

/**
 * Step forward along the redo branch. Returns the same history
 * reference when there is nothing to redo (already at the newest
 * entry).
 */
export function redo<S>(history: EditHistory<S>): EditHistory<S> {
  if (history.index >= history.entries.length - 1) return history;
  return freezeHistory(history.entries, history.index + 1, history.limit);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The current snapshot — `entries[index]`. */
export function currentEntry<S>(history: EditHistory<S>): S {
  return history.entries[history.index] as S;
}

/** `true` when at least one undo step is available. */
export function canUndo<S>(history: EditHistory<S>): boolean {
  return history.index > 0;
}

/** `true` when at least one redo step is available. */
export function canRedo<S>(history: EditHistory<S>): boolean {
  return history.index < history.entries.length - 1;
}

/** Number of undo steps remaining before the oldest retained entry. */
export function undoDepth<S>(history: EditHistory<S>): number {
  return history.index;
}

/** Number of redo steps remaining along the redo branch. */
export function redoDepth<S>(history: EditHistory<S>): number {
  return history.entries.length - 1 - history.index;
}

// ---------------------------------------------------------------------------
// HUD format helper — colocated here so it's a Phaser-free dependency
// the scene + the unit suite can both pull in (same pattern as
// `formatPlacedCountLabel` in `stageDataModel.ts`).
// ---------------------------------------------------------------------------

/**
 * Format the undo/redo HUD line. Pure function so tests can drive
 * every branch under plain Node and the scene's render path stays a
 * one-liner.
 *
 * Examples:
 *   formatHistoryStatusLabel(0, 0)  →  "UNDO 0 · REDO 0"
 *   formatHistoryStatusLabel(3, 1)  →  "UNDO 3 · REDO 1"
 *
 * Defensive against bad input: non-finite / negative depths clamp to
 * 0 so a regression upstream never renders "UNDO NaN".
 */
export function formatHistoryStatusLabel(
  undoLeft: number,
  redoLeft: number,
): string {
  const safeUndo = Number.isFinite(undoLeft)
    ? Math.max(0, Math.floor(undoLeft))
    : 0;
  const safeRedo = Number.isFinite(redoLeft)
    ? Math.max(0, Math.floor(redoLeft))
    : 0;
  return `UNDO ${safeUndo} · REDO ${safeRedo}`;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Freeze a history triple. The entries array is frozen too (when not
 * already) so a transition can safely share it by reference with the
 * history it derived from.
 */
function freezeHistory<S>(
  entries: ReadonlyArray<S>,
  index: number,
  limit: number,
): EditHistory<S> {
  const frozenEntries = Object.isFrozen(entries)
    ? entries
    : Object.freeze(entries);
  return Object.freeze({ entries: frozenEntries, index, limit });
}
