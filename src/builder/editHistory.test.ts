import { describe, it, expect } from 'vitest';
import {
  EDIT_HISTORY_LIMIT,
  canRedo,
  canUndo,
  createEditHistory,
  currentEntry,
  formatHistoryStatusLabel,
  pushHistory,
  redo,
  redoDepth,
  undo,
  undoDepth,
  type EditHistory,
} from './editHistory';

/**
 * Undo/redo history for the stage builder.
 *
 * The history is Phaser-free so the unit suite drives every branch
 * under plain Node. These tests guard:
 *
 *   • createEditHistory() seeds the stack with the initial state and
 *     clamps degenerate limits;
 *   • pushHistory() appends, clears the redo branch, trims at the cap,
 *     and no-ops on a same-ref push;
 *   • undo() / redo() step the index with same-ref no-ops at either
 *     end (the scene uses `next === prev` to skip re-apply work);
 *   • the depth / capability reads agree with the index math;
 *   • returned values are frozen (immutability contract);
 *   • the HUD format helper clamps bad input.
 */

// ---------------------------------------------------------------------------
// Test fixture — histories over plain strings; snapshots are opaque to
// the module so primitive states exercise every branch.
// ---------------------------------------------------------------------------

function historyOf(...states: string[]): EditHistory<string> {
  const [first, ...rest] = states;
  let history = createEditHistory(first ?? 's0');
  for (const state of rest) {
    history = pushHistory(history, state);
  }
  return history;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('createEditHistory', () => {
  it('seeds the stack with the initial state as the current entry', () => {
    const history = createEditHistory('empty');
    expect(currentEntry(history)).toBe('empty');
    expect(history.entries).toEqual(['empty']);
    expect(history.index).toBe(0);
  });

  it('starts with nothing to undo or redo', () => {
    const history = createEditHistory('empty');
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undoDepth(history)).toBe(0);
    expect(redoDepth(history)).toBe(0);
  });

  it('defaults the cap to EDIT_HISTORY_LIMIT (50)', () => {
    expect(EDIT_HISTORY_LIMIT).toBe(50);
    expect(createEditHistory('s').limit).toBe(EDIT_HISTORY_LIMIT);
  });

  it('accepts a custom limit and floors fractional values', () => {
    expect(createEditHistory('s', 5).limit).toBe(5);
    expect(createEditHistory('s', 5.9).limit).toBe(5);
  });

  it('clamps a non-finite or non-positive limit to the default cap', () => {
    expect(createEditHistory('s', Number.NaN).limit).toBe(EDIT_HISTORY_LIMIT);
    expect(createEditHistory('s', Number.POSITIVE_INFINITY).limit).toBe(
      EDIT_HISTORY_LIMIT,
    );
    expect(createEditHistory('s', 0).limit).toBe(EDIT_HISTORY_LIMIT);
    expect(createEditHistory('s', -3).limit).toBe(EDIT_HISTORY_LIMIT);
  });

  it('returns a frozen history with frozen entries', () => {
    const history = createEditHistory('s');
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(history.entries)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pushHistory
// ---------------------------------------------------------------------------

describe('pushHistory', () => {
  it('appends the new state and makes it current', () => {
    const history = pushHistory(createEditHistory('a'), 'b');
    expect(history.entries).toEqual(['a', 'b']);
    expect(currentEntry(history)).toBe('b');
    expect(undoDepth(history)).toBe(1);
    expect(redoDepth(history)).toBe(0);
  });

  it('is a same-ref no-op when pushing the reference-identical current state', () => {
    // The scene's snapshots are frozen objects; a double commit from a
    // re-entrant listener would push the same reference twice. The
    // history absorbs it so undo never has a zero-width step.
    const snapshot = Object.freeze({ pieces: [] });
    const history = createEditHistory<object>(snapshot);
    expect(pushHistory(history, snapshot)).toBe(history);
  });

  it('records structurally-equal but distinct references as separate entries', () => {
    // Same-REF is the no-op contract — structural equality is NOT
    // checked (snapshots are cheap references; deep comparison would
    // cost more than the duplicate entry is worth).
    const objHistory = createEditHistory<object>({ v: 1 });
    const pushed = pushHistory(objHistory, { v: 1 });
    expect(pushed).not.toBe(objHistory);
    expect(pushed.entries).toHaveLength(2);
  });

  it('clears the redo branch on a push after undo (standard branching)', () => {
    const history = historyOf('a', 'b', 'c');
    const undone = undo(history); // current: 'b', redo branch: ['c']
    expect(canRedo(undone)).toBe(true);
    const branched = pushHistory(undone, 'd');
    expect(branched.entries).toEqual(['a', 'b', 'd']);
    expect(currentEntry(branched)).toBe('d');
    expect(canRedo(branched)).toBe(false);
  });

  it('trims the oldest entries once the cap is exceeded', () => {
    let history = createEditHistory('s0', 3);
    history = pushHistory(history, 's1');
    history = pushHistory(history, 's2');
    history = pushHistory(history, 's3'); // s0 falls off the front
    expect(history.entries).toEqual(['s1', 's2', 's3']);
    expect(currentEntry(history)).toBe('s3');
    // Undo floor is now s1, not the original seed.
    expect(undoDepth(history)).toBe(2);
  });

  it('holds the default 50-entry cap across a long session', () => {
    let history = createEditHistory(0 as number);
    for (let i = 1; i <= 80; i += 1) {
      history = pushHistory(history, i);
    }
    expect(history.entries).toHaveLength(EDIT_HISTORY_LIMIT);
    expect(currentEntry(history)).toBe(80);
    expect(history.entries[0]).toBe(80 - (EDIT_HISTORY_LIMIT - 1));
    expect(undoDepth(history)).toBe(EDIT_HISTORY_LIMIT - 1);
  });

  it('returns frozen values', () => {
    const history = pushHistory(createEditHistory('a'), 'b');
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(history.entries)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// undo / redo
// ---------------------------------------------------------------------------

describe('undo / redo', () => {
  it('undo steps the current entry backward', () => {
    const history = historyOf('a', 'b', 'c');
    const undone = undo(history);
    expect(currentEntry(undone)).toBe('b');
    expect(undoDepth(undone)).toBe(1);
    expect(redoDepth(undone)).toBe(1);
  });

  it('redo steps forward along the redo branch', () => {
    const history = redo(undo(historyOf('a', 'b', 'c')));
    expect(currentEntry(history)).toBe('c');
    expect(canRedo(history)).toBe(false);
  });

  it('undo is a same-ref no-op at the oldest entry', () => {
    const history = createEditHistory('a');
    expect(undo(history)).toBe(history);
    const drained = undo(undo(historyOf('a', 'b', 'c')));
    expect(undo(drained)).toBe(drained);
  });

  it('redo is a same-ref no-op at the newest entry', () => {
    const history = historyOf('a', 'b');
    expect(redo(history)).toBe(history);
  });

  it('undo / redo share the entries array by reference (snapshots stay cheap)', () => {
    const history = historyOf('a', 'b', 'c');
    const undone = undo(history);
    expect(undone.entries).toBe(history.entries);
    expect(redo(undone).entries).toBe(history.entries);
  });

  it('round-trips: undo then redo restores the exact entry reference', () => {
    const a = Object.freeze({ tag: 'a' });
    const b = Object.freeze({ tag: 'b' });
    const history = pushHistory(createEditHistory<object>(a), b);
    const roundTripped = redo(undo(history));
    expect(currentEntry(roundTripped)).toBe(b);
    expect(currentEntry(undo(history))).toBe(a);
  });

  it('walks all the way back to the seed entry', () => {
    let history = historyOf('a', 'b', 'c', 'd');
    while (canUndo(history)) history = undo(history);
    expect(currentEntry(history)).toBe('a');
    expect(redoDepth(history)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// HUD format helper
// ---------------------------------------------------------------------------

describe('formatHistoryStatusLabel', () => {
  it('formats the standard "UNDO n · REDO m" label', () => {
    expect(formatHistoryStatusLabel(0, 0)).toBe('UNDO 0 · REDO 0');
    expect(formatHistoryStatusLabel(3, 1)).toBe('UNDO 3 · REDO 1');
  });

  it('clamps non-finite / negative depths to zero', () => {
    expect(formatHistoryStatusLabel(Number.NaN, 2)).toBe('UNDO 0 · REDO 2');
    expect(formatHistoryStatusLabel(-4, Number.POSITIVE_INFINITY)).toBe(
      'UNDO 0 · REDO 0',
    );
  });

  it('floors fractional depths', () => {
    expect(formatHistoryStatusLabel(2.9, 1.1)).toBe('UNDO 2 · REDO 1');
  });

  it('agrees with the live depth reads', () => {
    const history = undo(historyOf('a', 'b', 'c'));
    expect(
      formatHistoryStatusLabel(undoDepth(history), redoDepth(history)),
    ).toBe('UNDO 1 · REDO 1');
  });
});
