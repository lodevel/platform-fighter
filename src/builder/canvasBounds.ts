/**
 * Phaser-free bounds + snap-cursor geometry for the M3 stage builder
 * canvas area.
 *
 * AC 20003 Sub-AC 3 — "Implement grid-based canvas area with visible
 * grid lines, snap coordinates, and bounds rendering".
 *
 * Sub-AC 1 (`builderGrid.ts`) gave us the math for cell sizes, line
 * enumeration, and `snapToGrid` / `worldToGrid` / `gridToWorld`. Sub-AC
 * 3 is one step up the abstraction ladder: it owns the *canvas area* —
 * the rectangle the player draws in. That entails three concerns this
 * helper covers as pure functions:
 *
 *   1. **Visible grid lines** — already enumerated by
 *      `enumerateGridLines`. We don't redo that math; we wrap it in a
 *      `CanvasAreaSpec` envelope that lets a renderer know which
 *      gridSpec it should iterate, alongside the canvas's viewport
 *      origin.
 *
 *   2. **Snap coordinates** — given a viewport-space cursor, return a
 *      `SnapCursorState` describing the snapped grid intersection (in
 *      both canvas pixels and grid cells), the live cell-under-cursor,
 *      and whether the cursor is currently over the canvas at all. The
 *      Phaser host paints a small crosshair / cell-highlight from this
 *      state every pointer-move tick.
 *
 *   3. **Bounds rendering** — the canvas has TWO bounds the player
 *      should see:
 *
 *        • The *active* canvas rectangle (current authored stage size,
 *          1× by default, growable up to 2× per the Seed cap).
 *        • The *maximum* canvas rectangle (always 2× the design screen
 *          per the Seed's "max dimensions 2× screen size" hard limit).
 *          Drawn as a dim outline so the player can see how much room
 *          they have left to grow before the validator rejects a save.
 *
 *      `enumerateBoundsRects` returns both as a render-friendly
 *      ordered list with stroke styles already picked.
 *
 * Why Phaser-free
 * ---------------
 *
 * Per the project's `code_architecture` evaluation principle, scenes
 * stay thin: lifecycle wiring + scene transitions only. The geometry
 * here is `(spec, cursor) → renderable shapes` — pure number juggling
 * — so it lives in a Phaser-free module that the unit suite drives
 * exhaustively under plain Node. The CanvasArea Phaser component just
 * iterates the helper's outputs and issues `Graphics`/`Text` calls.
 *
 * Determinism note: every helper here is a pure function of its
 * arguments. No module-level mutable state, no `Math.random()`, no
 * wall-clock reads. A replay that records cursor positions can derive
 * snap state byte-identically.
 */

import {
  BUILDER_CANVAS_MAX_HEIGHT,
  BUILDER_CANVAS_MAX_WIDTH,
  DEFAULT_GRID_SPEC,
  gridLineCount,
  snapToGrid,
  worldToGrid,
  type GridSpec,
} from './builderGrid';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Snapshot of the canvas area's geometry as seen from the renderer.
 *
 *   • `gridSpec` — the live grid spec (cell size + canvas dimensions).
 *   • `originX` / `originY` — viewport-space top-left of the canvas
 *     (the Phaser container the grid is parented under).
 *   • `width` / `height` — convenience copy of the canvas footprint;
 *     equal to `gridSpec.width` / `gridSpec.height`.
 *
 * The CanvasArea Phaser component holds one of these and re-emits it
 * for tests / future sub-ACs (drag/drop hit-test, save/load) so they
 * don't have to re-derive the math.
 */
export interface CanvasAreaSpec {
  readonly gridSpec: GridSpec;
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Stroke style + rectangle to draw — one of these per "bounds frame"
 * the canvas area paints. Returned in render order (back-to-front);
 * the renderer just iterates and forwards each entry to a Phaser
 * `Graphics.lineStyle(...) → strokeRect(...)` pair.
 */
export interface BoundsRect {
  /**
   * Stable identifier for the rect:
   *
   *   • `'active'` — the current authored canvas's outer frame.
   *   • `'max'` — the Seed's 2× screen hard-cap frame (drawn as a dim
   *     outline so the player can see remaining headroom).
   *   • `'shadow'` — a one-pixel-offset darker frame underlying the
   *     active rect so the canvas reads as a "raised" surface against
   *     the builder background.
   */
  readonly kind: 'active' | 'max' | 'shadow';
  /** Top-left X in canvas-relative pixels (0 = canvas origin). */
  readonly x: number;
  /** Top-left Y in canvas-relative pixels (0 = canvas origin). */
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Hex colour (no `#`) suitable for `Graphics.lineStyle`. */
  readonly strokeColor: number;
  /** Stroke width in design pixels. */
  readonly strokeWidth: number;
  /** Alpha multiplier in `[0, 1]`. */
  readonly strokeAlpha: number;
}

/**
 * Live snap-cursor state derived from a viewport-space pointer
 * position.
 *
 *   • `overCanvas` — `true` iff the pointer lies within the canvas
 *     rectangle (inclusive on the leading edge, exclusive on the
 *     trailing edge so adjacent pixels never both claim a cell).
 *   • `canvasX` / `canvasY` — pointer position translated into
 *     canvas-relative pixels (0 at the canvas origin). Always finite,
 *     even when the pointer is off-canvas.
 *   • `snappedX` / `snappedY` — the nearest grid intersection in
 *     canvas-relative pixels. Always clamped to the canvas bounds.
 *   • `viewportSnappedX` / `viewportSnappedY` — same point translated
 *     back to viewport space (so the renderer can paint a crosshair
 *     without redoing the math).
 *   • `col` / `row` — cell currently under the cursor. Clamped to the
 *     canvas's cell range when the pointer is off-canvas.
 *   • `cellX` / `cellY` — viewport-space top-left of the cell the
 *     cursor is in (so the renderer can paint a translucent
 *     highlight rectangle without redoing the math).
 *   • `cellWidth` / `cellHeight` — cell dimensions, copied here so the
 *     renderer can `fillRect(cellX, cellY, cellWidth, cellHeight)`
 *     without reading the grid spec separately.
 */
export interface SnapCursorState {
  readonly overCanvas: boolean;
  readonly canvasX: number;
  readonly canvasY: number;
  readonly snappedX: number;
  readonly snappedY: number;
  readonly viewportSnappedX: number;
  readonly viewportSnappedY: number;
  readonly col: number;
  readonly row: number;
  readonly cellX: number;
  readonly cellY: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Build a `CanvasAreaSpec` from a grid spec + viewport origin. The
 * helper exists so callers don't have to remember to copy
 * `gridSpec.width` / `gridSpec.height` into the spec — there's exactly
 * one source of truth.
 *
 * Non-finite origin coordinates fall back to `0` (the canvas pins to
 * the viewport top-left). The grid spec is passed through unchanged
 * because `buildGridSpec` already normalises its own input.
 */
export function buildCanvasAreaSpec(
  gridSpec: GridSpec = DEFAULT_GRID_SPEC,
  originX: number = 0,
  originY: number = 0,
): CanvasAreaSpec {
  return Object.freeze({
    gridSpec,
    originX: Number.isFinite(originX) ? originX : 0,
    originY: Number.isFinite(originY) ? originY : 0,
    width: gridSpec.width,
    height: gridSpec.height,
  });
}

// ---------------------------------------------------------------------------
// Bounds rectangles
// ---------------------------------------------------------------------------

/**
 * Default colours for the bounds frames. Hex literals (no `#`) so the
 * renderer can pass them straight into `Graphics.lineStyle`. Exposed
 * so tests + future themes can override without duplicating the
 * literals.
 */
export const CANVAS_BOUNDS_COLORS = Object.freeze({
  /** Bright frame around the active canvas — the "you're authoring here" anchor. */
  active: 0x6cf0c2,
  /** Shadow drop under the active frame so the canvas looks raised. */
  shadow: 0x05080e,
  /** Dim frame around the 2× screen hard cap so the player sees headroom. */
  max: 0x2c3656,
});

/**
 * Default stroke widths in design pixels. The active frame is the
 * thickest so the player's eye lands on it first; the max frame is a
 * single thin line so it feels like a hint rather than another canvas.
 */
export const CANVAS_BOUNDS_STROKES = Object.freeze({
  active: 3,
  shadow: 4,
  max: 1,
});

/**
 * Enumerate the bounds rectangles to draw for a canvas area. Order is
 * back-to-front:
 *
 *   1. `max` — drawn first so the active frame paints over its corners.
 *      Skipped when the active canvas equals the max canvas (no
 *      headroom to indicate).
 *   2. `shadow` — a 1-pixel offset darker frame under the active rect.
 *   3. `active` — the bright frame the player tracks while authoring.
 *
 * Coordinates are canvas-relative — `x` / `y` are offsets from the
 * canvas's top-left in design pixels. The `max` frame can therefore
 * have negative `x` / `y` (it extends left/up of the active canvas
 * when the player has chosen anything less than the 2× max).
 */
export function enumerateBoundsRects(
  spec: CanvasAreaSpec = buildCanvasAreaSpec(),
  maxWidth: number = BUILDER_CANVAS_MAX_WIDTH,
  maxHeight: number = BUILDER_CANVAS_MAX_HEIGHT,
): ReadonlyArray<BoundsRect> {
  const rects: BoundsRect[] = [];

  const safeMaxW = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : spec.width;
  const safeMaxH = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : spec.height;

  // Max-bounds frame — only emitted when the active canvas is smaller
  // than the cap. Otherwise it would overlap the active frame and
  // serve no informational purpose.
  if (safeMaxW > spec.width || safeMaxH > spec.height) {
    // Centre the max frame around the active canvas so the headroom
    // reads symmetrically (the player can grow in any direction).
    const dx = (safeMaxW - spec.width) / 2;
    const dy = (safeMaxH - spec.height) / 2;
    rects.push({
      kind: 'max',
      x: -dx,
      y: -dy,
      width: safeMaxW,
      height: safeMaxH,
      strokeColor: CANVAS_BOUNDS_COLORS.max,
      strokeWidth: CANVAS_BOUNDS_STROKES.max,
      strokeAlpha: 0.55,
    });
  }

  // Shadow drop under the active frame. Offset by 1px so the bottom +
  // right edges read as raised geometry against the dark background.
  rects.push({
    kind: 'shadow',
    x: 1,
    y: 1,
    width: spec.width,
    height: spec.height,
    strokeColor: CANVAS_BOUNDS_COLORS.shadow,
    strokeWidth: CANVAS_BOUNDS_STROKES.shadow,
    strokeAlpha: 0.85,
  });

  // Active canvas frame — paints last so it sits over the shadow's
  // bottom-right edge.
  rects.push({
    kind: 'active',
    x: 0,
    y: 0,
    width: spec.width,
    height: spec.height,
    strokeColor: CANVAS_BOUNDS_COLORS.active,
    strokeWidth: CANVAS_BOUNDS_STROKES.active,
    strokeAlpha: 1,
  });

  return rects;
}

// ---------------------------------------------------------------------------
// Snap-cursor state
// ---------------------------------------------------------------------------

/**
 * `true` iff a viewport-space `(vx, vy)` lies inside the canvas
 * rectangle described by `spec`. Inclusive on the leading edge,
 * exclusive on the trailing edge so adjacent pixels never both claim
 * a cell. Non-finite inputs return `false` (the cursor is "lost", not
 * "over the canvas").
 */
export function isOverCanvas(
  vx: number,
  vy: number,
  spec: CanvasAreaSpec = buildCanvasAreaSpec(),
): boolean {
  if (!Number.isFinite(vx) || !Number.isFinite(vy)) return false;
  if (vx < spec.originX) return false;
  if (vy < spec.originY) return false;
  if (vx >= spec.originX + spec.width) return false;
  if (vy >= spec.originY + spec.height) return false;
  return true;
}

/**
 * Compute the live snap-cursor state for a viewport-space `(vx, vy)`.
 * Returns a fully-populated `SnapCursorState` so the Phaser host can
 * paint a crosshair + cell highlight in one render pass.
 *
 * Non-finite inputs collapse to the canvas origin (0, 0). The renderer
 * gets a finite, in-bounds-clamped state so it never has to draw at
 * NaN/Infinity, and the `overCanvas` flag tells it whether to show the
 * cursor at all (a `false` value means "hide the highlight").
 */
export function computeSnapCursor(
  vx: number,
  vy: number,
  spec: CanvasAreaSpec = buildCanvasAreaSpec(),
): SnapCursorState {
  const safeVx = Number.isFinite(vx) ? vx : spec.originX;
  const safeVy = Number.isFinite(vy) ? vy : spec.originY;
  const canvasX = safeVx - spec.originX;
  const canvasY = safeVy - spec.originY;

  const snapped = snapToGrid(canvasX, canvasY, spec.gridSpec);
  const cell = worldToGrid(canvasX, canvasY, spec.gridSpec);

  // Clamp the cell index to the canvas's last *cell* (not last grid
  // line) so the highlight rectangle never extends past the canvas
  // bounds. `worldToGrid` clamps to the line index, which would
  // otherwise let a cursor at the bottom-right edge produce a cell
  // whose origin sits exactly on the canvas trailing edge.
  const lastCol = Math.max(0, Math.floor(spec.width / spec.gridSpec.cellPx) - 1);
  const lastRow = Math.max(0, Math.floor(spec.height / spec.gridSpec.cellPx) - 1);
  const clampedCol = Math.min(cell.col, lastCol);
  const clampedRow = Math.min(cell.row, lastRow);

  return {
    overCanvas: isOverCanvas(safeVx, safeVy, spec),
    canvasX,
    canvasY,
    snappedX: snapped.x,
    snappedY: snapped.y,
    viewportSnappedX: snapped.x + spec.originX,
    viewportSnappedY: snapped.y + spec.originY,
    col: clampedCol,
    row: clampedRow,
    cellX: spec.originX + clampedCol * spec.gridSpec.cellPx,
    cellY: spec.originY + clampedRow * spec.gridSpec.cellPx,
    cellWidth: spec.gridSpec.cellPx,
    cellHeight: spec.gridSpec.cellPx,
  };
}

/**
 * Format a snap-cursor state as a short user-facing label (e.g.
 * `"col 12 · row 7 · (480, 280)"`). The HUD line above the canvas
 * displays this so playtesters + QA can read the live snap target
 * without eyeballing pixel offsets.
 */
export function formatSnapCursorLabel(state: SnapCursorState | null): string {
  if (!state || !state.overCanvas) return 'cursor: off-canvas';
  return `col ${state.col} · row ${state.row} · (${state.snappedX}, ${state.snappedY})`;
}

// ---------------------------------------------------------------------------
// Cell counts — convenience wrappers around `gridLineCount` so the
// renderer can size cell-highlight pools without reaching into the
// grid module directly.
// ---------------------------------------------------------------------------

/**
 * Number of *cells* (not lines) along the canvas's X axis. A 1920px
 * canvas at 40px cells has 48 cells, regardless of how many grid
 * lines (`gridLineCount` returns 49 — leading + trailing edges).
 */
export function cellColumnCount(spec: CanvasAreaSpec = buildCanvasAreaSpec()): number {
  const lines = gridLineCount(spec.width, spec.gridSpec.cellPx);
  return Math.max(0, lines - 1);
}

/** Number of *cells* (not lines) along the canvas's Y axis. */
export function cellRowCount(spec: CanvasAreaSpec = buildCanvasAreaSpec()): number {
  const lines = gridLineCount(spec.height, spec.gridSpec.cellPx);
  return Math.max(0, lines - 1);
}
