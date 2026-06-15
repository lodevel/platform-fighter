/**
 * Phaser-free piece-selection logic for the M3 stage builder.
 *
 * "Implement click-to-select on placed pieces so the player can target
 * one entry for deletion".
 *
 * The selection is the bridge between the canvas click and the delete
 * action: a pointer-down on the canvas hit-tests the registered piece
 * roster, the selected piece gets a highlight outline + a `[DEL]
 * remove` hint, and DELETE / BACKSPACE (or the REMOVE button) removes
 * exactly that entry from the {@link StageDataModel}.
 *
 * Why Phaser-free
 * ---------------
 *
 * Per the project's `code_architecture` evaluation principle, scenes
 * stay thin: lifecycle wiring + input forwarding only. The selection
 * is pure logic — `(roster, click point) → selection` — so it lives in
 * a Phaser-free module the unit suite can drive exhaustively under
 * plain Node. The Phaser host that paints the highlight outline is
 * `./SelectionHighlight.ts`.
 *
 * Same-ref no-op contract
 * -----------------------
 *
 * Every transition returns the *same* selection reference when nothing
 * changed — re-clicking the already-selected piece, clearing an
 * already-empty selection, reconciling a selection whose piece still
 * exists. Callers can therefore use `next === prev` to skip repaint
 * work, matching the convention the rest of the builder's pure modules
 * follow.
 *
 * Determinism note: every helper here is a pure function of its
 * arguments. No module-level mutable state, no `Math.random()`, no
 * wall-clock reads. A replay that records "pointerDown at (x, y)"
 * reproduces the exact selection byte-identically.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Minimal structural shape the hit-test needs — id + AABB in
 * canvas-relative design pixels. `RegisteredPiece` from
 * `./stageDataModel.ts` satisfies this, but accepting the structural
 * subset keeps the module decoupled so future overlays (hover preview,
 * multi-select) can reuse the hit-test on their own shapes.
 */
export interface SelectablePiece {
  readonly id: string;
  readonly canvasX: number;
  readonly canvasY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Immutable selection state. `selectedId` is the stable registry id of
 * the selected piece (`flat-platform#3`), or `null` when nothing is
 * selected. Ids — not array indices — so a deletion elsewhere in the
 * roster can never silently retarget the selection.
 */
export interface PieceSelection {
  readonly selectedId: string | null;
}

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * The canonical empty selection. Shared frozen singleton so "cleared"
 * transitions are reference-comparable and allocation-free.
 */
export const NO_SELECTION: PieceSelection = Object.freeze({
  selectedId: null,
});

/**
 * Floating hint shown next to the selected piece so the delete
 * affordance is discoverable without reading docs. The scene's
 * keyboard wiring honours both DELETE and BACKSPACE; the hint names
 * the canonical key.
 */
export const SELECTION_HINT_TEXT = '[DEL] remove';

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/**
 * `true` iff canvas-relative `(x, y)` falls inside the piece's AABB.
 * Inclusive on the top/left edge and exclusive on the bottom/right —
 * the same convention `findCatalogHitAt` uses — so two edge-adjacent
 * pieces never both claim a single pixel.
 */
export function pieceContainsPoint(
  piece: SelectablePiece,
  x: number,
  y: number,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return (
    x >= piece.canvasX &&
    x < piece.canvasX + piece.width &&
    y >= piece.canvasY &&
    y < piece.canvasY + piece.height
  );
}

/**
 * Find the topmost piece under canvas-relative `(x, y)`, or `null`
 * when the point misses every piece.
 *
 * "Topmost" = latest in roster order. The registry preserves insertion
 * order and the renderer paints pieces in that order at a shared
 * depth, so the *last* matching entry is the one the player visually
 * sees on top — scanning from the end of the array returns exactly
 * that piece on overlap.
 *
 * (The placement validator rejects overlapping *drops*, but loaded
 * legacy saves and future resize tools may still produce overlap, so
 * the ordering rule is load-bearing rather than theoretical.)
 */
export function hitTestTopmostPiece<P extends SelectablePiece>(
  pieces: ReadonlyArray<P>,
  x: number,
  y: number,
): P | null {
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    const piece = pieces[i];
    if (piece !== undefined && pieceContainsPoint(piece, x, y)) {
      return piece;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Selection transitions
// ---------------------------------------------------------------------------

/**
 * Resolve a canvas click into the next selection state:
 *
 *   • click hits a piece     → that piece becomes selected (topmost
 *                              wins on overlap);
 *   • click hits empty canvas → selection clears;
 *   • no effective change    → the same selection reference comes
 *                              back (re-clicking the selected piece,
 *                              or empty-clicking an empty selection).
 */
export function selectPieceAt(
  selection: PieceSelection,
  pieces: ReadonlyArray<SelectablePiece>,
  x: number,
  y: number,
): PieceSelection {
  const hit = hitTestTopmostPiece(pieces, x, y);
  if (!hit) return clearSelection(selection);
  if (hit.id === selection.selectedId) return selection;
  return Object.freeze({ selectedId: hit.id });
}

/**
 * Clear the selection. Same-ref no-op when already empty so observers
 * keyed on reference change don't churn.
 */
export function clearSelection(selection: PieceSelection): PieceSelection {
  return selection.selectedId === null ? selection : NO_SELECTION;
}

/**
 * Drop the selection if its piece no longer exists in the roster
 * (deleted, cleared, or replaced by a bulk import). Same-ref no-op
 * when the selection is already empty or the piece survives — the
 * scene calls this from the data model's change listener, so the
 * cheap path has to be reference-stable.
 */
export function reconcileSelection(
  selection: PieceSelection,
  pieces: ReadonlyArray<SelectablePiece>,
): PieceSelection {
  if (selection.selectedId === null) return selection;
  for (const piece of pieces) {
    if (piece.id === selection.selectedId) return selection;
  }
  return NO_SELECTION;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Resolve the selected piece record from the roster, or `null` when
 * nothing is selected (or the id has gone stale). The highlight
 * painter consumes this so it never has to understand selection state
 * itself — it just paints "this piece or nothing".
 */
export function findSelectedPiece<P extends SelectablePiece>(
  selection: PieceSelection,
  pieces: ReadonlyArray<P>,
): P | null {
  if (selection.selectedId === null) return null;
  for (const piece of pieces) {
    if (piece.id === selection.selectedId) return piece;
  }
  return null;
}
