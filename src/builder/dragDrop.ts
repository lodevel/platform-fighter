/**
 * Phaser-free drag-and-drop state machine for the M3 stage builder.
 *
 * AC 20003 Sub-AC 3 — "Implement drag-and-drop interaction logic for
 * placing catalog pieces onto the grid canvas with snap-to-grid
 * behavior".
 *
 * Drag lifecycle owned here
 * -------------------------
 *
 *   1. Player mouses down on a catalog row (left edge panel) —
 *      `pointerDown(x, y)` finds the row's hit-rect, transitions
 *      `idle → dragging`, and returns the picked `CatalogPiece` so the
 *      Phaser host can spawn a ghost preview.
 *
 *   2. While dragging, `pointerMove(x, y)` updates the live cursor
 *      position. The host re-reads `getGhostState()` each frame and
 *      paints the ghost at the snapped target. Snapping uses the same
 *      `snapToGrid` helper the validator uses at save time, so what
 *      the player sees IS where the piece will land.
 *
 *   3. On `pointerUp(x, y)` the controller emits a `PlacedPiece` if:
 *
 *        • the drag was active,
 *        • the pointer is NOT over the catalog panel (releasing on the
 *          panel cancels — same gesture as in Smash's stage builder),
 *        • the snapped piece bounds fit fully inside the canvas
 *          (out-of-bounds drops are rejected so the save validator
 *          never has to deal with off-canvas pieces).
 *
 *      All other `pointerUp` paths reset to `idle` and return `null`
 *      (drag cancelled).
 *
 *   4. `cancel()` aborts mid-drag — the host wires this to ESC so a
 *      player can bail out without committing a placement.
 *
 * Why Phaser-free
 * ---------------
 *
 * Per the project's `code_architecture` evaluation principle, scenes
 * stay thin: lifecycle wiring + input forwarding only. The drag-drop
 * state machine is pure logic — `(pointer, catalog rects, grid spec)
 * → ghost / placed piece` — so it lives in a Phaser-free module that
 * the unit suite can drive exhaustively under plain Node.
 *
 * Determinism note: every helper here is a pure function of its
 * arguments. No module-level mutable state, no `Math.random()`, no
 * wall-clock reads. A replay that records "pointerDown at (vx, vy)
 * → pointerUp at (vx', vy')" reproduces the exact placed piece
 * byte-identically.
 */

import {
  DEFAULT_GRID_SPEC,
  snapToGrid,
  worldToGrid,
  type GridSpec,
} from './builderGrid';
import type { CatalogPiece, BuilderPieceType } from './catalogPieces';
import type { CatalogRowHitRect } from './CatalogPanel';
import {
  validatePlacement,
  type PlacementRejectionReason,
  type PlacementValidationResult,
  type RegisteredCandidate,
} from './placementValidation';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Drag-drop phases. The state machine has only two states because the
 * builder has only two interaction modes — "browsing" (waiting for a
 * pointer-down on the catalog) and "placing" (carrying a piece toward
 * the canvas). Future sub-ACs add 'selecting'/'erasing' phases for
 * undo + delete brushes.
 */
export type DragPhase = 'idle' | 'dragging';

/**
 * Snap target for an in-flight drag — what the ghost renderer uses to
 * paint the preview, and what `pointerUp` commits to a `PlacedPiece`
 * if the player drops here.
 *
 *   • `col` / `row` — grid cell of the piece's top-left corner.
 *   • `canvasX` / `canvasY` — top-left in canvas-relative design pixels.
 *   • `viewportX` / `viewportY` — top-left in viewport pixels (already
 *     translated by the canvas origin) so the host can drop the ghost
 *     rectangle at this exact position without re-doing the math.
 *   • `width` / `height` — piece footprint in design pixels.
 *   • `inBounds` — `true` iff the entire footprint fits inside the
 *     canvas. Kept as a separate flag (rather than folded into the
 *     full validation result) so legacy consumers from earlier sub-ACs
 *     keep working without code churn.
 *   • `validation` — full placement validity verdict (AC 20103 Sub-AC
 *     3). When the controller is configured with a registry source
 *     this includes overlap + hazard-spawn rule outcomes too, so the
 *     ghost renderer can paint distinct visual feedback per reason.
 *     Independently of `inBounds` because overlap / hazard checks
 *     only run when the registry source is wired in.
 *   • `valid` — convenience flag, equivalent to `validation.ok`. The
 *     ghost renderer reads this to decide between in-bounds and
 *     "rejected drop" tints; `pointerUp` rejects every `valid: false`
 *     drop regardless of which rule fired.
 *   • `invalidReason` — the rule that rejected the drop, or `null`
 *     when `valid` is `true`. Surfaced for tests + future toast banners
 *     so consumers can branch on the specific reason without re-running
 *     the rules themselves.
 *   • `conflictId` — id of the existing piece the rejected drop
 *     conflicts with, when applicable (overlap / hazard-spawn). `null`
 *     for accept paths and bounds / type rejections.
 */
export interface SnapTarget {
  readonly col: number;
  readonly row: number;
  readonly canvasX: number;
  readonly canvasY: number;
  readonly viewportX: number;
  readonly viewportY: number;
  readonly width: number;
  readonly height: number;
  readonly inBounds: boolean;
  readonly validation: PlacementValidationResult;
  readonly valid: boolean;
  readonly invalidReason: PlacementRejectionReason | null;
  readonly conflictId: string | null;
}

/**
 * Live ghost-preview state. The Phaser host re-reads this every frame
 * (or at least on every pointer move) and paints a translucent
 * rectangle at the snap target. Returns `null` when the controller is
 * idle.
 *
 *   • `pointerX` / `pointerY` — raw pointer position in viewport
 *     pixels (so the host can paint a "carry" sprite that follows the
 *     cursor without snapping).
 *   • `snap` — snapped target on the canvas, or `null` when the
 *     pointer is over the catalog panel (no preview at all in that
 *     case — releasing there cancels).
 *   • `piece` — the catalog piece being dragged (so the host can
 *     paint the right thumbnail glyph in the ghost).
 */
export interface DragGhostState {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly snap: SnapTarget | null;
  readonly piece: CatalogPiece;
}

/**
 * A piece that has been committed to the canvas. The save-time
 * validator + the localStorage serializer (later sub-ACs) both
 * consume this shape.
 *
 *   • `type` — stable `BuilderPieceType` identity.
 *   • `canvasX` / `canvasY` — top-left in canvas-relative design pixels.
 *   • `width` / `height` — footprint at default catalog size.
 *   • `col` / `row` — top-left grid cell (redundant with canvas coords
 *     but cached so cell-based hit tests don't have to redo the math).
 */
export interface PlacedPiece {
  readonly type: BuilderPieceType;
  readonly canvasX: number;
  readonly canvasY: number;
  readonly width: number;
  readonly height: number;
  readonly col: number;
  readonly row: number;
}

/**
 * Controller construction options. Pass the live grid spec, the
 * canvas origin in viewport pixels, and the catalog panel's row hit
 * rects. The host calls `updateOptions(...)` if any of these change
 * (e.g. canvas resize, future "scroll catalog" feature).
 *
 * `getPlacedPieces` (AC 20103 Sub-AC 3) is an optional callback the
 * scene wires up so the in-flight ghost preview can run the full
 * placement-validation rules (overlap, hazard-near-spawn) against the
 * live registry — the player sees a red ghost the *moment* their drag
 * floats over an existing piece, not after they release. Omitting it
 * collapses the validation set to "bounds + type / geometry sanity",
 * which preserves the Sub-AC 1 contract for legacy callers / tests.
 */
export interface DragDropOptions {
  readonly gridSpec: GridSpec;
  readonly canvasOriginX: number;
  readonly canvasOriginY: number;
  readonly catalogHitRects: ReadonlyArray<CatalogRowHitRect>;
  readonly getPlacedPieces?: () => ReadonlyArray<RegisteredCandidate>;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported so the test suite can drive each branch
// without constructing a controller.
// ---------------------------------------------------------------------------

/**
 * Find the catalog row hit-rect under viewport-space `(x, y)`, or
 * `null` if the pointer is not over any row. The hit test is
 * inclusive on the top/left edge and exclusive on the bottom/right
 * so adjacent rows never both claim a single pixel.
 */
export function findCatalogHitAt(
  rects: ReadonlyArray<CatalogRowHitRect>,
  x: number,
  y: number,
): CatalogRowHitRect | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (const r of rects) {
    if (
      x >= r.x &&
      x < r.x + r.width &&
      y >= r.y &&
      y < r.y + r.height
    ) {
      return r;
    }
  }
  return null;
}

/**
 * Translate a viewport-space `(x, y)` into canvas-relative design
 * pixels. The canvas origin is in viewport pixels; subtracting it
 * yields canvas-local coordinates that `snapToGrid` and `worldToGrid`
 * understand.
 */
export function viewportToCanvas(
  vx: number,
  vy: number,
  originX: number,
  originY: number,
): { x: number; y: number } {
  return {
    x: (Number.isFinite(vx) ? vx : 0) - (Number.isFinite(originX) ? originX : 0),
    y: (Number.isFinite(vy) ? vy : 0) - (Number.isFinite(originY) ? originY : 0),
  };
}

/**
 * `true` iff a piece footprint at canvas-relative top-left `(canvasX,
 * canvasY)` with `width × height` fits fully inside the canvas
 * defined by `gridSpec`. The save-time validator uses the same check;
 * surfacing it here lets the ghost renderer dim out-of-bounds previews
 * before the player commits.
 */
export function isPieceInCanvasBounds(
  canvasX: number,
  canvasY: number,
  width: number,
  height: number,
  gridSpec: GridSpec = DEFAULT_GRID_SPEC,
): boolean {
  if (
    !Number.isFinite(canvasX) ||
    !Number.isFinite(canvasY) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return false;
  }
  if (width <= 0 || height <= 0) return false;
  if (canvasX < 0 || canvasY < 0) return false;
  if (canvasX + width > gridSpec.width) return false;
  if (canvasY + height > gridSpec.height) return false;
  return true;
}

/**
 * Compute the snap target for a pointer at viewport-space `(vx, vy)`
 * carrying `piece`. The pointer is treated as the piece's *centre*:
 * we snap the centre to the nearest grid intersection (via
 * `snapToGrid`) and derive the top-left as `centre - (w/2, h/2)`.
 *
 * Why centre-on-grid rather than top-left-on-grid:
 *
 *   • Players expect a drag preview to follow the cursor, with the
 *     piece "wrapped around" the pointer. Snapping the top-left would
 *     leave the cursor floating outside the piece for any footprint
 *     wider than one cell.
 *   • Centre snapping keeps even-multiple pieces (160×40 platforms,
 *     200×80 hazards) cell-aligned — `centre - w/2` is still a grid
 *     line for those sizes.
 *   • Odd-multiple pieces still feel snapped because the cursor jumps
 *     between intersections instead of moving smoothly.
 */
export function computeSnapTarget(
  viewportX: number,
  viewportY: number,
  piece: CatalogPiece,
  opts: DragDropOptions,
): SnapTarget {
  const { x: cx, y: cy } = viewportToCanvas(
    viewportX,
    viewportY,
    opts.canvasOriginX,
    opts.canvasOriginY,
  );
  const snappedCentre = snapToGrid(cx, cy, opts.gridSpec);
  const w = piece.defaultWidth;
  const h = piece.defaultHeight;
  // Top-left = centre - half-footprint. The `Math.round` guard keeps
  // sub-pixel float drift from leaking into rendered coordinates.
  const topLeftX = Math.round(snappedCentre.x - w / 2);
  const topLeftY = Math.round(snappedCentre.y - h / 2);
  const cell = worldToGrid(topLeftX, topLeftY, opts.gridSpec);
  const inBounds = isPieceInCanvasBounds(topLeftX, topLeftY, w, h, opts.gridSpec);
  // AC 20103 Sub-AC 3 — run the full placement-validation suite (bounds,
  // overlap, hazard-near-spawn) so the ghost renderer + the pointerUp
  // commit path consume one verdict. If the host did not wire a
  // registry source, the registry collapses to `[]` and the validator
  // degrades gracefully to "bounds + type / geometry only" (the Sub-AC
  // 1 contract).
  const registry = opts.getPlacedPieces?.() ?? [];
  const validation = validatePlacement(
    {
      type: piece.type,
      canvasX: topLeftX,
      canvasY: topLeftY,
      width: w,
      height: h,
    },
    registry,
    opts.gridSpec,
  );
  const valid = validation.ok;
  const invalidReason = validation.ok ? null : validation.reason;
  const conflictId = validation.ok ? null : validation.conflictId ?? null;
  return {
    col: cell.col,
    row: cell.row,
    canvasX: topLeftX,
    canvasY: topLeftY,
    viewportX: topLeftX + opts.canvasOriginX,
    viewportY: topLeftY + opts.canvasOriginY,
    width: w,
    height: h,
    inBounds,
    validation,
    valid,
    invalidReason,
    conflictId,
  };
}

// ---------------------------------------------------------------------------
// DragDropController
// ---------------------------------------------------------------------------

/**
 * Drag-drop state machine. One controller per `StageBuilderScene`
 * lifetime. Pointer events are forwarded in by the Phaser host:
 *
 *     const dnd = new DragDropController({
 *       gridSpec, canvasOriginX, canvasOriginY,
 *       catalogHitRects: panel.getRowHitRects(),
 *     });
 *     scene.input.on('pointerdown', (p) => dnd.pointerDown(p.x, p.y));
 *     scene.input.on('pointermove', (p) => dnd.pointerMove(p.x, p.y));
 *     scene.input.on('pointerup',   (p) => {
 *       const placed = dnd.pointerUp(p.x, p.y);
 *       if (placed) commitPiece(placed);
 *     });
 */
export class DragDropController {
  private opts: DragDropOptions;
  private phase: DragPhase = 'idle';
  private draggedPiece: CatalogPiece | null = null;
  private pointerX = 0;
  private pointerY = 0;

  constructor(opts: DragDropOptions) {
    this.opts = opts;
  }

  // -------------------------------------------------------------------------
  // State queries
  // -------------------------------------------------------------------------

  getPhase(): DragPhase {
    return this.phase;
  }

  /**
   * The piece currently being dragged, or `null` when idle. Exposed so
   * tests + the host can read the active piece without re-deriving it
   * from a returned event payload.
   */
  getDraggedPiece(): CatalogPiece | null {
    return this.draggedPiece;
  }

  /**
   * Live ghost-preview state for the renderer. Returns `null` when no
   * drag is in flight.
   */
  getGhostState(): DragGhostState | null {
    if (this.phase !== 'dragging' || !this.draggedPiece) return null;
    const overPanel =
      findCatalogHitAt(this.opts.catalogHitRects, this.pointerX, this.pointerY) !== null;
    const snap = overPanel
      ? null
      : computeSnapTarget(this.pointerX, this.pointerY, this.draggedPiece, this.opts);
    return {
      pointerX: this.pointerX,
      pointerY: this.pointerY,
      snap,
      piece: this.draggedPiece,
    };
  }

  // -------------------------------------------------------------------------
  // Pointer event sinks
  // -------------------------------------------------------------------------

  /**
   * Begin a drag if the pointer hits a catalog row. Returns the
   * picked piece (so the host can paint a ghost matching its glyph)
   * or `null` if the pointer missed every row — in which case the
   * controller stays idle and the host should treat the click as a
   * canvas interaction (e.g. future delete brush).
   *
   * No-op if a drag is already in flight (defensive: shouldn't
   * happen because pointer-down → pointer-up are paired, but a stuck
   * pointer-up due to an off-window release is recoverable via
   * `cancel()`).
   */
  pointerDown(x: number, y: number): CatalogPiece | null {
    this.pointerX = x;
    this.pointerY = y;
    if (this.phase !== 'idle') return null;
    const hit = findCatalogHitAt(this.opts.catalogHitRects, x, y);
    if (!hit) return null;
    this.phase = 'dragging';
    this.draggedPiece = hit.piece;
    return hit.piece;
  }

  /**
   * Track the live pointer position. Returns `true` while a drag is
   * active so the host can short-circuit non-drag pointer-move work.
   */
  pointerMove(x: number, y: number): boolean {
    this.pointerX = x;
    this.pointerY = y;
    return this.phase === 'dragging';
  }

  /**
   * End a drag. Returns the committed `PlacedPiece` if the drop is
   * valid (drag was active, pointer not over the catalog panel,
   * snap target fits inside the canvas); returns `null` otherwise.
   * The controller always resets to `idle` after this call.
   */
  pointerUp(x: number, y: number): PlacedPiece | null {
    this.pointerX = x;
    this.pointerY = y;
    if (this.phase !== 'dragging' || !this.draggedPiece) {
      this.resetToIdle();
      return null;
    }
    const piece = this.draggedPiece;
    // Drop over the catalog panel cancels — the player is "putting
    // the piece back" rather than placing it. Same gesture pattern as
    // the Smash Bros stage builder.
    const overPanel = findCatalogHitAt(this.opts.catalogHitRects, x, y) !== null;
    if (overPanel) {
      this.resetToIdle();
      return null;
    }
    const target = computeSnapTarget(x, y, piece, this.opts);
    this.resetToIdle();
    // AC 20103 Sub-AC 3 — reject any drop the validator flagged. The
    // `valid` flag is the union of bounds + overlap + hazard-near-spawn,
    // so a single check covers every rule the ghost renderer also
    // surfaces. `inBounds === false` always implies `valid === false`,
    // which keeps the Sub-AC 1 contract intact for callers that ran
    // without a registry source.
    if (!target.valid) return null;
    return {
      type: piece.type,
      canvasX: target.canvasX,
      canvasY: target.canvasY,
      width: target.width,
      height: target.height,
      col: target.col,
      row: target.row,
    };
  }

  /**
   * Abort any in-flight drag. The host wires this to ESC so a player
   * can back out without committing a placement. Idempotent — calling
   * `cancel()` on an idle controller is a no-op.
   */
  cancel(): void {
    this.resetToIdle();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Update controller options. The host calls this when the canvas
   * is resized, the catalog panel is rebuilt, or the canvas origin
   * shifts (future pan/zoom). Any in-flight drag is preserved — the
   * snap target re-computes against the new options on the next
   * `getGhostState()` read.
   */
  updateOptions(partial: Partial<DragDropOptions>): void {
    this.opts = {
      gridSpec: partial.gridSpec ?? this.opts.gridSpec,
      canvasOriginX: partial.canvasOriginX ?? this.opts.canvasOriginX,
      canvasOriginY: partial.canvasOriginY ?? this.opts.canvasOriginY,
      catalogHitRects: partial.catalogHitRects ?? this.opts.catalogHitRects,
      // Preserve the registry source unless the caller passes a new one;
      // a typical update (canvas resize) shouldn't have to re-thread it.
      getPlacedPieces:
        partial.getPlacedPieces ?? this.opts.getPlacedPieces,
    };
  }

  /** Read-only snapshot of the live options (mainly for tests). */
  getOptions(): DragDropOptions {
    return this.opts;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private resetToIdle(): void {
    this.phase = 'idle';
    this.draggedPiece = null;
  }
}
