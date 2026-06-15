import { describe, it, expect } from 'vitest';
import {
  NO_SELECTION,
  SELECTION_HINT_TEXT,
  clearSelection,
  findSelectedPiece,
  hitTestTopmostPiece,
  pieceContainsPoint,
  reconcileSelection,
  selectPieceAt,
  type PieceSelection,
  type SelectablePiece,
} from './pieceSelection';

/**
 * Click-to-select + delete targeting.
 *
 * The selection logic is Phaser-free so the unit suite drives every
 * branch under plain Node. These tests guard:
 *
 *   • the AABB hit-test edge conventions (inclusive top/left,
 *     exclusive bottom/right);
 *   • topmost-wins ordering on overlapping pieces (latest roster
 *     entry is painted on top, so it must win the hit-test);
 *   • selection transitions (select / switch / clear) with same-ref
 *     no-ops the scene relies on to skip repaints;
 *   • reconciliation after a roster mutation (delete / undo / bulk
 *     load) drops stale ids;
 *   • the immutability contract (frozen selections).
 */

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makePiece(overrides: Partial<SelectablePiece> = {}): SelectablePiece {
  return {
    id: 'flat-platform#0',
    canvasX: 200,
    canvasY: 320,
    width: 160,
    height: 40,
    ...overrides,
  };
}

const selected = (id: string): PieceSelection => Object.freeze({ selectedId: id });

// ---------------------------------------------------------------------------
// pieceContainsPoint
// ---------------------------------------------------------------------------

describe('pieceContainsPoint', () => {
  const piece = makePiece(); // 200,320 → 360,360

  it('hits a point inside the bounds', () => {
    expect(pieceContainsPoint(piece, 280, 340)).toBe(true);
  });

  it('is inclusive on the top/left edge', () => {
    expect(pieceContainsPoint(piece, 200, 320)).toBe(true);
  });

  it('is exclusive on the bottom/right edge (adjacent pieces never share a pixel)', () => {
    expect(pieceContainsPoint(piece, 360, 340)).toBe(false);
    expect(pieceContainsPoint(piece, 280, 360)).toBe(false);
  });

  it('misses points outside the bounds', () => {
    expect(pieceContainsPoint(piece, 199, 340)).toBe(false);
    expect(pieceContainsPoint(piece, 280, 319)).toBe(false);
  });

  it('rejects non-finite points', () => {
    expect(pieceContainsPoint(piece, Number.NaN, 340)).toBe(false);
    expect(pieceContainsPoint(piece, 280, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hitTestTopmostPiece
// ---------------------------------------------------------------------------

describe('hitTestTopmostPiece', () => {
  it('returns the piece under the point', () => {
    const a = makePiece({ id: 'a', canvasX: 0, canvasY: 0 });
    const b = makePiece({ id: 'b', canvasX: 400, canvasY: 400 });
    expect(hitTestTopmostPiece([a, b], 410, 410)?.id).toBe('b');
    expect(hitTestTopmostPiece([a, b], 10, 10)?.id).toBe('a');
  });

  it('returns null when the point misses every piece', () => {
    const a = makePiece({ id: 'a' });
    expect(hitTestTopmostPiece([a], 0, 0)).toBeNull();
  });

  it('returns null for an empty roster', () => {
    expect(hitTestTopmostPiece([], 100, 100)).toBeNull();
  });

  it('topmost wins on overlap — the latest roster entry takes the hit', () => {
    // The renderer paints pieces in insertion order at a shared depth,
    // so the last entry is visually on top. The hit-test must agree
    // with what the player sees.
    const below = makePiece({ id: 'below', canvasX: 100, canvasY: 100, width: 200, height: 200 });
    const above = makePiece({ id: 'above', canvasX: 150, canvasY: 150, width: 50, height: 50 });
    const hit = hitTestTopmostPiece([below, above], 160, 160);
    expect(hit?.id).toBe('above');
    // A point covered only by the lower piece still resolves to it.
    expect(hitTestTopmostPiece([below, above], 110, 110)?.id).toBe('below');
  });

  it('three-deep overlap still resolves to the newest entry', () => {
    const stack = [
      makePiece({ id: 'p0', canvasX: 0, canvasY: 0, width: 100, height: 100 }),
      makePiece({ id: 'p1', canvasX: 0, canvasY: 0, width: 100, height: 100 }),
      makePiece({ id: 'p2', canvasX: 0, canvasY: 0, width: 100, height: 100 }),
    ];
    expect(hitTestTopmostPiece(stack, 50, 50)?.id).toBe('p2');
  });

  it('returns null for non-finite points', () => {
    const a = makePiece({ id: 'a' });
    expect(hitTestTopmostPiece([a], Number.NaN, Number.NaN)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// selectPieceAt
// ---------------------------------------------------------------------------

describe('selectPieceAt', () => {
  const roster = [
    makePiece({ id: 'a', canvasX: 0, canvasY: 0 }),
    makePiece({ id: 'b', canvasX: 400, canvasY: 400 }),
  ];

  it('selects the piece under the click', () => {
    const next = selectPieceAt(NO_SELECTION, roster, 10, 10);
    expect(next.selectedId).toBe('a');
  });

  it('switches the selection when a different piece is clicked', () => {
    const next = selectPieceAt(selected('a'), roster, 410, 410);
    expect(next.selectedId).toBe('b');
  });

  it('clears the selection on an empty-canvas click', () => {
    const next = selectPieceAt(selected('a'), roster, 999, 0);
    expect(next).toBe(NO_SELECTION);
  });

  it('is a same-ref no-op when re-clicking the already-selected piece', () => {
    const current = selected('a');
    expect(selectPieceAt(current, roster, 10, 10)).toBe(current);
  });

  it('is a same-ref no-op when empty-clicking an already-empty selection', () => {
    expect(selectPieceAt(NO_SELECTION, roster, 999, 0)).toBe(NO_SELECTION);
  });

  it('returns frozen selections', () => {
    const next = selectPieceAt(NO_SELECTION, roster, 10, 10);
    expect(Object.isFrozen(next)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clearSelection
// ---------------------------------------------------------------------------

describe('clearSelection', () => {
  it('clears an active selection to the shared NO_SELECTION singleton', () => {
    expect(clearSelection(selected('a'))).toBe(NO_SELECTION);
  });

  it('is a same-ref no-op when the selection is already empty', () => {
    expect(clearSelection(NO_SELECTION)).toBe(NO_SELECTION);
    const otherEmpty: PieceSelection = Object.freeze({ selectedId: null });
    expect(clearSelection(otherEmpty)).toBe(otherEmpty);
  });
});

// ---------------------------------------------------------------------------
// reconcileSelection
// ---------------------------------------------------------------------------

describe('reconcileSelection', () => {
  const roster = [makePiece({ id: 'a' }), makePiece({ id: 'b', canvasX: 400 })];

  it('keeps the selection (same ref) while the piece survives', () => {
    const current = selected('b');
    expect(reconcileSelection(current, roster)).toBe(current);
  });

  it('clears the selection when the piece was removed from the roster', () => {
    expect(reconcileSelection(selected('gone#7'), roster)).toBe(NO_SELECTION);
  });

  it('clears against an emptied roster (clear-all / fresh load)', () => {
    expect(reconcileSelection(selected('a'), [])).toBe(NO_SELECTION);
  });

  it('is a same-ref no-op when already empty', () => {
    expect(reconcileSelection(NO_SELECTION, roster)).toBe(NO_SELECTION);
  });
});

// ---------------------------------------------------------------------------
// findSelectedPiece
// ---------------------------------------------------------------------------

describe('findSelectedPiece', () => {
  const roster = [makePiece({ id: 'a' }), makePiece({ id: 'b', canvasX: 400 })];

  it('resolves the selected piece record from the roster', () => {
    expect(findSelectedPiece(selected('b'), roster)).toBe(roster[1]);
  });

  it('returns null for an empty selection', () => {
    expect(findSelectedPiece(NO_SELECTION, roster)).toBeNull();
  });

  it('returns null for a stale id', () => {
    expect(findSelectedPiece(selected('gone#7'), roster)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('selection constants', () => {
  it('NO_SELECTION is a frozen empty selection', () => {
    expect(NO_SELECTION.selectedId).toBeNull();
    expect(Object.isFrozen(NO_SELECTION)).toBe(true);
  });

  it('the floating hint names the DELETE key affordance', () => {
    expect(SELECTION_HINT_TEXT).toContain('[DEL]');
    expect(SELECTION_HINT_TEXT.toLowerCase()).toContain('remove');
  });
});
