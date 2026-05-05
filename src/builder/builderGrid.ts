/**
 * Phaser-free grid math for the M3 stage builder.
 *
 * AC 20001 Sub-AC 1 — "Create StageBuilderScene skeleton with grid
 * canvas rendering (snapping grid lines, coordinate system,
 * background)".
 *
 * The builder lays a uniform square grid over a custom-sized "canvas"
 * (the authored stage's design rectangle, up to 2× the live screen
 * size — see the Seed's `stage builder hard limit: 30 pieces per
 * custom stage, max dimensions 2× screen size`). Every piece in the
 * catalog (flat platform, slope, wall, drop-through, lava zone, wind
 * zone, moving platform, spawn point) snaps to the grid, so the same
 * grid math drives:
 *
 *   • The visual grid the scene draws under the canvas (this AC).
 *   • The drag-snap that future sub-ACs apply when the player drops a
 *     piece (`snapToGrid`).
 *   • The "where on the grid did the player click" coordinate read
 *     used by hit-tests and the deletion brush
 *     (`worldToGrid` / `gridToWorld`).
 *   • The save-time validator that asserts piece count ≤ 30 and the
 *     canvas dimensions ≤ 2× screen.
 *
 * Why Phaser-free
 * ---------------
 *
 * Per the project's `code_architecture` evaluation principle, scenes
 * stay thin: lifecycle wiring + scene transitions only. Grid math is
 * pure number juggling — putting it in a Phaser-importing module would
 * make every change require a full game-boot test, instead of the
 * fast vitest unit tests this file is designed to support. The module
 * has zero runtime dependencies (it only imports `GAME_CONFIG`
 * constants, which is itself a Phaser-free module).
 *
 * Determinism note: every helper here is a pure function of its
 * arguments. No module-level mutable state, no `Math.random()`, no
 * wall-clock reads. A replay that records "player dropped piece X at
 * grid (col, row)" can re-derive the world position byte-identically.
 */

import { GAME_CONFIG } from '../engine/constants';

// ---------------------------------------------------------------------------
// Grid constants
// ---------------------------------------------------------------------------

/**
 * Cell size in design pixels. 40px chosen because:
 *
 *   • `1920 / 40 = 48` and `1080 / 40 = 27` → integer line counts on
 *     the canonical 1920×1080 design canvas, so the rendered grid
 *     never has a half-cell sliver at the right or bottom edge.
 *   • 40px is one-third of the smallest authored platform width
 *     (~120px for a side platform on `FLAT_STAGE`) — coarse enough
 *     to feel snappy on drag, fine enough that placement still has
 *     enough granularity for a Smash-Bros-shaped stage.
 *   • Even at the 2× canvas (3840×2160) the grid stays 96×54 cells,
 *     which is fine for a Phaser `Graphics` line draw.
 */
export const BUILDER_GRID_CELL_PX = 40;

/**
 * Major grid line cadence — every Nth grid line is drawn thicker so
 * the player has visible "sub-region" anchors when judging piece
 * placement at a glance. 4 cells = 160 design px, which lines up with
 * the typical pass-through platform width on the built-in stages.
 */
export const BUILDER_GRID_MAJOR_EVERY = 4;

/**
 * The Seed's "max dimensions 2× screen size" hard cap, expressed in
 * design pixels. The save-time validator (separate sub-AC) enforces
 * this; this constant is exposed here so the grid math + the camera
 * code agree on a single source of truth.
 */
export const BUILDER_CANVAS_MAX_WIDTH = GAME_CONFIG.width * 2;
export const BUILDER_CANVAS_MAX_HEIGHT = GAME_CONFIG.height * 2;

/**
 * Default canvas size when a player opens the builder without an
 * existing draft — one full screen wide and tall. Players who want a
 * larger canvas grow it explicitly via the future "canvas size"
 * controls; defaulting to 1× keeps the initial workspace familiar
 * (it matches the dimensions of every built-in stage).
 */
export const BUILDER_CANVAS_DEFAULT_WIDTH = GAME_CONFIG.width;
export const BUILDER_CANVAS_DEFAULT_HEIGHT = GAME_CONFIG.height;

// ---------------------------------------------------------------------------
// Grid spec — a small immutable record so callers can dial cell size
// per-canvas (e.g. for a tighter grid on a small canvas) without
// breaking the default-arg shape of every helper.
// ---------------------------------------------------------------------------

export interface GridSpec {
  /** Side length of a single cell in design pixels. Must be positive. */
  readonly cellPx: number;
  /** Canvas width in design pixels. Must be positive. */
  readonly width: number;
  /** Canvas height in design pixels. Must be positive. */
  readonly height: number;
}

/**
 * Default grid spec — `BUILDER_GRID_CELL_PX` cells over a 1× screen
 * canvas. Frozen so a caller that mutates it doesn't accidentally
 * change every other consumer's grid.
 */
export const DEFAULT_GRID_SPEC: GridSpec = Object.freeze({
  cellPx: BUILDER_GRID_CELL_PX,
  width: BUILDER_CANVAS_DEFAULT_WIDTH,
  height: BUILDER_CANVAS_DEFAULT_HEIGHT,
});

/**
 * Build a grid spec, normalising bad input. `cellPx` falls back to
 * `BUILDER_GRID_CELL_PX` for non-finite or non-positive values; the
 * canvas dimensions are clamped to `[cellPx, BUILDER_CANVAS_MAX_*]`
 * so the resulting spec always yields at least one full cell and
 * never exceeds the Seed's 2× screen cap.
 */
export function buildGridSpec(
  width: number = BUILDER_CANVAS_DEFAULT_WIDTH,
  height: number = BUILDER_CANVAS_DEFAULT_HEIGHT,
  cellPx: number = BUILDER_GRID_CELL_PX,
): GridSpec {
  const safeCell =
    Number.isFinite(cellPx) && cellPx > 0 ? Math.max(1, Math.floor(cellPx)) : BUILDER_GRID_CELL_PX;
  const safeW = clampNumber(
    Number.isFinite(width) ? Math.floor(width) : BUILDER_CANVAS_DEFAULT_WIDTH,
    safeCell,
    BUILDER_CANVAS_MAX_WIDTH,
  );
  const safeH = clampNumber(
    Number.isFinite(height) ? Math.floor(height) : BUILDER_CANVAS_DEFAULT_HEIGHT,
    safeCell,
    BUILDER_CANVAS_MAX_HEIGHT,
  );
  return Object.freeze({ cellPx: safeCell, width: safeW, height: safeH });
}

// ---------------------------------------------------------------------------
// World ⇄ grid coordinate conversions
// ---------------------------------------------------------------------------

/**
 * Snap a world-space `(x, y)` to the nearest grid intersection.
 * Returns canvas-relative design pixels. The result is clamped to
 * the canvas bounds so a drag that strays off the canvas snaps to
 * the nearest in-bounds intersection rather than producing a piece
 * the validator would reject at save time.
 *
 * Snapping uses round-to-nearest so a piece centred between two
 * cells goes to whichever is closer (and, by JS rounding rules, the
 * higher of the two on a tie — symmetric enough for level design).
 */
export function snapToGrid(
  x: number,
  y: number,
  spec: GridSpec = DEFAULT_GRID_SPEC,
): { x: number; y: number } {
  // NaN has no useful signal, so it falls back to the safe canvas
  // origin (0, 0). ±Infinity is the natural "off-canvas in this
  // direction" sentinel: it propagates through `Math.round / *`
  // as ±Infinity and lands on the matching canvas edge once
  // `clampNumber` finishes. This means a wild hover snaps to the
  // closest valid cell instead of teleporting back to (0, 0).
  const sx = Number.isNaN(x) ? 0 : x;
  const sy = Number.isNaN(y) ? 0 : y;
  const snappedX = Math.round(sx / spec.cellPx) * spec.cellPx;
  const snappedY = Math.round(sy / spec.cellPx) * spec.cellPx;
  return {
    x: clampNumber(snappedX, 0, spec.width),
    y: clampNumber(snappedY, 0, spec.height),
  };
}

/**
 * Convert a canvas-relative world `(x, y)` to grid `(col, row)`.
 * Useful for hit-testing the cell under the cursor when the player
 * starts a drag. Out-of-bounds inputs clamp to the nearest valid
 * cell; non-finite values fall back to (0, 0). The returned
 * coordinates are integer cell indices (0-based, top-left origin).
 */
export function worldToGrid(
  x: number,
  y: number,
  spec: GridSpec = DEFAULT_GRID_SPEC,
): { col: number; row: number } {
  const sx = Number.isFinite(x) ? x : 0;
  const sy = Number.isFinite(y) ? y : 0;
  const maxCol = Math.max(0, Math.floor(spec.width / spec.cellPx));
  const maxRow = Math.max(0, Math.floor(spec.height / spec.cellPx));
  return {
    col: clampNumber(Math.floor(sx / spec.cellPx), 0, maxCol),
    row: clampNumber(Math.floor(sy / spec.cellPx), 0, maxRow),
  };
}

/**
 * Convert a grid `(col, row)` back to a canvas-relative world `(x, y)`
 * at the cell's *top-left corner*. To draw a piece centred on the
 * cell, add `cellPx / 2` to each coordinate (the catalog renderer
 * does this; this helper stays corner-anchored to round-trip with
 * `worldToGrid`).
 */
export function gridToWorld(
  col: number,
  row: number,
  spec: GridSpec = DEFAULT_GRID_SPEC,
): { x: number; y: number } {
  const safeCol = Number.isFinite(col) ? Math.floor(col) : 0;
  const safeRow = Number.isFinite(row) ? Math.floor(row) : 0;
  return {
    x: clampNumber(safeCol * spec.cellPx, 0, spec.width),
    y: clampNumber(safeRow * spec.cellPx, 0, spec.height),
  };
}

// ---------------------------------------------------------------------------
// Grid line enumeration — used by the scene to issue `Graphics.lineBetween`
// calls for each visible grid line.
// ---------------------------------------------------------------------------

/**
 * One grid line described in canvas-relative pixels.
 *
 *   • `axis` — `'vertical'` lines run top-to-bottom at a given X;
 *     `'horizontal'` lines run left-to-right at a given Y.
 *   • `position` — design pixel along the perpendicular axis (X for
 *     vertical lines, Y for horizontal).
 *   • `index` — 0-based count from the canvas's left/top edge.
 *   • `major` — `true` every `BUILDER_GRID_MAJOR_EVERY`th line so
 *     the renderer can pick a heavier stroke / brighter colour.
 */
export interface GridLine {
  readonly axis: 'vertical' | 'horizontal';
  readonly position: number;
  readonly index: number;
  readonly major: boolean;
}

/**
 * `true` when this is a major (thicker) grid line. `index` 0 is
 * always major so the canvas's outer edge is emphasised even on a
 * non-multiple-of-major canvas size.
 */
export function isMajorGridLine(
  index: number,
  majorEvery: number = BUILDER_GRID_MAJOR_EVERY,
): boolean {
  if (!Number.isFinite(index) || index < 0) return false;
  if (!Number.isFinite(majorEvery) || majorEvery <= 0) return false;
  return Math.floor(index) % Math.floor(majorEvery) === 0;
}

/**
 * Total grid lines along one axis for a canvas of size `canvasSize`
 * with cell size `cellPx`. Includes both the leading edge (index 0,
 * at position 0) and the trailing edge (index N, at position
 * `canvasSize`) so a canvas of 1920×1080 with 40px cells yields 49
 * vertical lines (0..48 → x=0..1920) and 28 horizontal lines.
 */
export function gridLineCount(canvasSize: number, cellPx: number): number {
  if (!Number.isFinite(canvasSize) || canvasSize <= 0) return 0;
  if (!Number.isFinite(cellPx) || cellPx <= 0) return 0;
  return Math.floor(canvasSize / cellPx) + 1;
}

/**
 * Enumerate every grid line on a canvas. Returned in render order:
 * vertical lines first (left to right), then horizontal (top to
 * bottom), each sorted by `index`. The scene iterates the result
 * once per `create()` and never recomputes — grid geometry is
 * static for the lifetime of a builder session.
 *
 * Each returned line carries enough info that the renderer can pick
 * a stroke style without re-running the major-line modulo check.
 */
export function enumerateGridLines(
  spec: GridSpec = DEFAULT_GRID_SPEC,
  majorEvery: number = BUILDER_GRID_MAJOR_EVERY,
): ReadonlyArray<GridLine> {
  const lines: GridLine[] = [];
  const verticalCount = gridLineCount(spec.width, spec.cellPx);
  const horizontalCount = gridLineCount(spec.height, spec.cellPx);
  for (let i = 0; i < verticalCount; i += 1) {
    lines.push({
      axis: 'vertical',
      position: Math.min(i * spec.cellPx, spec.width),
      index: i,
      major: isMajorGridLine(i, majorEvery),
    });
  }
  for (let j = 0; j < horizontalCount; j += 1) {
    lines.push({
      axis: 'horizontal',
      position: Math.min(j * spec.cellPx, spec.height),
      index: j,
      major: isMajorGridLine(j, majorEvery),
    });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Coordinate-system marks — origin + axis labels drawn over the canvas
// so the player sees where (0, 0) is and which way X / Y grow.
// ---------------------------------------------------------------------------

/**
 * A labelled tick mark or axis label.
 *
 *   • `kind: 'origin'` — drawn at the canvas's `(0, 0)` (top-left)
 *     to anchor the coordinate system.
 *   • `kind: 'axis-x'` / `'axis-y'` — drawn at the far end of each
 *     axis with a short directional caret.
 *   • `kind: 'tick'` — a numeric label drawn at every major grid
 *     line so the player can read positions at a glance.
 */
export interface CoordinateMark {
  readonly kind: 'origin' | 'axis-x' | 'axis-y' | 'tick';
  readonly x: number;
  readonly y: number;
  readonly label: string;
}

/**
 * Build the static set of coordinate-system marks for a canvas. The
 * scene draws each one as a `Phaser.GameObjects.Text` at the given
 * position. Like `enumerateGridLines`, this is recomputed once per
 * `create()` and reused for the rest of the builder session.
 *
 * Tick density follows the major-line cadence (one numeric label
 * per major line) so a 1× canvas at the default settings shows
 * ~12 X labels and ~7 Y labels — enough to navigate by, sparse
 * enough not to clutter.
 */
export function enumerateCoordinateMarks(
  spec: GridSpec = DEFAULT_GRID_SPEC,
  majorEvery: number = BUILDER_GRID_MAJOR_EVERY,
): ReadonlyArray<CoordinateMark> {
  const marks: CoordinateMark[] = [];
  marks.push({ kind: 'origin', x: 0, y: 0, label: '(0,0)' });
  marks.push({ kind: 'axis-x', x: spec.width, y: 0, label: 'X →' });
  marks.push({ kind: 'axis-y', x: 0, y: spec.height, label: 'Y ↓' });

  const verticalCount = gridLineCount(spec.width, spec.cellPx);
  const horizontalCount = gridLineCount(spec.height, spec.cellPx);
  // X-axis numeric labels along the canvas top edge.
  for (let i = 0; i < verticalCount; i += 1) {
    if (!isMajorGridLine(i, majorEvery)) continue;
    if (i === 0) continue; // origin already labelled
    const px = Math.min(i * spec.cellPx, spec.width);
    marks.push({ kind: 'tick', x: px, y: 0, label: `${px}` });
  }
  // Y-axis numeric labels along the canvas left edge.
  for (let j = 0; j < horizontalCount; j += 1) {
    if (!isMajorGridLine(j, majorEvery)) continue;
    if (j === 0) continue; // origin already labelled
    const py = Math.min(j * spec.cellPx, spec.height);
    marks.push({ kind: 'tick', x: 0, y: py, label: `${py}` });
  }
  return marks;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function clampNumber(value: number, lo: number, hi: number): number {
  // NaN has no usable comparison semantics; pin it to the low edge
  // so a non-finite axis reads as "0 = canvas origin" rather than
  // poisoning the downstream renderer with NaN. ±Infinity, however,
  // DOES compare correctly against finite bounds — it falls through
  // to the standard `< lo` / `> hi` cases so `clampNumber(Infinity,
  // 0, 1920)` lands on `1920` (the natural "clamp to the right
  // edge") and `clampNumber(-Infinity, 0, 1920)` lands on `0`.
  if (Number.isNaN(value)) return lo;
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}
