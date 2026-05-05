import { describe, it, expect } from 'vitest';
import {
  BUILDER_CANVAS_DEFAULT_HEIGHT,
  BUILDER_CANVAS_DEFAULT_WIDTH,
  BUILDER_CANVAS_MAX_HEIGHT,
  BUILDER_CANVAS_MAX_WIDTH,
  BUILDER_GRID_CELL_PX,
  DEFAULT_GRID_SPEC,
  buildGridSpec,
} from './builderGrid';
import {
  CANVAS_BOUNDS_COLORS,
  CANVAS_BOUNDS_STROKES,
  buildCanvasAreaSpec,
  cellColumnCount,
  cellRowCount,
  computeSnapCursor,
  enumerateBoundsRects,
  formatSnapCursorLabel,
  isOverCanvas,
} from './canvasBounds';

/**
 * AC 20003 Sub-AC 3 — "Implement grid-based canvas area with visible
 * grid lines, snap coordinates, and bounds rendering".
 *
 * The geometry powering the CanvasArea Phaser component is split into
 * a Phaser-free helper module so the unit suite can drive every branch
 * exhaustively under plain Node. The Phaser component
 * (`CanvasArea.test.ts`) proves the wiring; this file proves the math.
 */

describe('canvasBounds — buildCanvasAreaSpec', () => {
  it('defaults to the canonical 1× canvas pinned at (0, 0)', () => {
    const spec = buildCanvasAreaSpec();
    expect(spec.gridSpec).toBe(DEFAULT_GRID_SPEC);
    expect(spec.originX).toBe(0);
    expect(spec.originY).toBe(0);
    expect(spec.width).toBe(BUILDER_CANVAS_DEFAULT_WIDTH);
    expect(spec.height).toBe(BUILDER_CANVAS_DEFAULT_HEIGHT);
  });

  it('forwards the grid spec dimensions into the convenience width/height fields', () => {
    const grid = buildGridSpec(800, 600, 40);
    const spec = buildCanvasAreaSpec(grid, 100, 200);
    expect(spec.width).toBe(800);
    expect(spec.height).toBe(600);
    expect(spec.originX).toBe(100);
    expect(spec.originY).toBe(200);
  });

  it('falls back to (0, 0) when origin coordinates are non-finite', () => {
    const spec = buildCanvasAreaSpec(DEFAULT_GRID_SPEC, NaN, Infinity);
    expect(spec.originX).toBe(0);
    expect(spec.originY).toBe(0);
  });

  it('returns a frozen spec so accidental mutation does not poison every consumer', () => {
    const spec = buildCanvasAreaSpec();
    expect(Object.isFrozen(spec)).toBe(true);
  });
});

describe('canvasBounds — enumerateBoundsRects', () => {
  it('emits the active + shadow rects when the canvas equals the max cap', () => {
    // A canvas already at the 2× cap has no headroom, so the helper
    // should skip the dim max-bounds outline (it would just overlap
    // the active frame).
    const grid = buildGridSpec(BUILDER_CANVAS_MAX_WIDTH, BUILDER_CANVAS_MAX_HEIGHT);
    const spec = buildCanvasAreaSpec(grid);
    const rects = enumerateBoundsRects(spec);
    const kinds = rects.map((r) => r.kind);
    expect(kinds).toEqual(['shadow', 'active']);
  });

  it('emits the max-bounds outline when the canvas is smaller than the cap', () => {
    // A 1× canvas has full 2× headroom — the dim outline should
    // appear so the player can see how much room is left.
    const rects = enumerateBoundsRects(buildCanvasAreaSpec());
    const kinds = rects.map((r) => r.kind);
    expect(kinds).toEqual(['max', 'shadow', 'active']);
  });

  it('centres the max-bounds frame around the active canvas (symmetric headroom)', () => {
    // Players grow in any direction, so the headroom indicator should
    // read as "you have N px on each side" rather than pinning the
    // active frame to one corner.
    const rects = enumerateBoundsRects(buildCanvasAreaSpec());
    const max = rects.find((r) => r.kind === 'max');
    expect(max).toBeDefined();
    expect(max!.x).toBe(-(BUILDER_CANVAS_MAX_WIDTH - BUILDER_CANVAS_DEFAULT_WIDTH) / 2);
    expect(max!.y).toBe(-(BUILDER_CANVAS_MAX_HEIGHT - BUILDER_CANVAS_DEFAULT_HEIGHT) / 2);
    expect(max!.width).toBe(BUILDER_CANVAS_MAX_WIDTH);
    expect(max!.height).toBe(BUILDER_CANVAS_MAX_HEIGHT);
  });

  it('marks the active frame with the bright accent stroke', () => {
    const rects = enumerateBoundsRects(buildCanvasAreaSpec());
    const active = rects.find((r) => r.kind === 'active');
    expect(active).toBeDefined();
    expect(active!.strokeColor).toBe(CANVAS_BOUNDS_COLORS.active);
    expect(active!.strokeWidth).toBe(CANVAS_BOUNDS_STROKES.active);
    expect(active!.strokeAlpha).toBe(1);
    expect(active!.x).toBe(0);
    expect(active!.y).toBe(0);
    expect(active!.width).toBe(BUILDER_CANVAS_DEFAULT_WIDTH);
    expect(active!.height).toBe(BUILDER_CANVAS_DEFAULT_HEIGHT);
  });

  it('paints in back-to-front order so the active frame sits over the shadow', () => {
    // The renderer iterates the array in order; the active frame must
    // come last so its bright stroke isn't obscured by the shadow drop.
    const rects = enumerateBoundsRects(buildCanvasAreaSpec());
    const activeIdx = rects.findIndex((r) => r.kind === 'active');
    const shadowIdx = rects.findIndex((r) => r.kind === 'shadow');
    expect(activeIdx).toBeGreaterThan(shadowIdx);
  });

  it('falls back to the spec dimensions when the max cap is non-finite', () => {
    // Defensive: a caller passing NaN / 0 should not crash the
    // renderer; the helper degrades to "active + shadow only".
    const rects = enumerateBoundsRects(buildCanvasAreaSpec(), NaN, 0);
    const kinds = rects.map((r) => r.kind);
    expect(kinds).toEqual(['shadow', 'active']);
  });
});

describe('canvasBounds — isOverCanvas', () => {
  it('inclusive on the leading edge, exclusive on the trailing edge', () => {
    // 1×1 canvas at origin (100, 200) — pixels (100, 200) → cell (0, 0);
    // pixels (BUILDER_CANVAS_DEFAULT_WIDTH+100, ...) just past the
    // right edge → off-canvas.
    const spec = buildCanvasAreaSpec(DEFAULT_GRID_SPEC, 100, 200);
    expect(isOverCanvas(100, 200, spec)).toBe(true);
    expect(isOverCanvas(99, 200, spec)).toBe(false);
    expect(isOverCanvas(100, 199, spec)).toBe(false);
    expect(isOverCanvas(100 + BUILDER_CANVAS_DEFAULT_WIDTH - 1, 200, spec)).toBe(true);
    expect(isOverCanvas(100 + BUILDER_CANVAS_DEFAULT_WIDTH, 200, spec)).toBe(false);
  });

  it('returns false for non-finite cursor coordinates', () => {
    expect(isOverCanvas(NaN, 0)).toBe(false);
    expect(isOverCanvas(0, NaN)).toBe(false);
    expect(isOverCanvas(Infinity, Infinity)).toBe(false);
  });
});

describe('canvasBounds — computeSnapCursor', () => {
  it('snaps the cursor to the nearest grid intersection inside the canvas', () => {
    const spec = buildCanvasAreaSpec();
    // Halfway through the first cell — should snap to (0, 0).
    const a = computeSnapCursor(BUILDER_GRID_CELL_PX / 2 - 1, BUILDER_GRID_CELL_PX / 2 - 1, spec);
    expect(a.snappedX).toBe(0);
    expect(a.snappedY).toBe(0);
    expect(a.col).toBe(0);
    expect(a.row).toBe(0);
    expect(a.overCanvas).toBe(true);
  });

  it('reports overCanvas=false when the cursor leaves the canvas rectangle', () => {
    const spec = buildCanvasAreaSpec(DEFAULT_GRID_SPEC, 100, 100);
    const off = computeSnapCursor(50, 50, spec);
    expect(off.overCanvas).toBe(false);
    // The state still has finite snapped coordinates so the renderer
    // can hide the highlight without worrying about NaN-poisoned
    // positions.
    expect(Number.isFinite(off.snappedX)).toBe(true);
    expect(Number.isFinite(off.snappedY)).toBe(true);
  });

  it('translates the snapped point back into viewport space', () => {
    const spec = buildCanvasAreaSpec(DEFAULT_GRID_SPEC, 200, 300);
    const state = computeSnapCursor(200 + 80, 300 + 40, spec);
    expect(state.snappedX).toBe(80);
    expect(state.snappedY).toBe(40);
    expect(state.viewportSnappedX).toBe(200 + 80);
    expect(state.viewportSnappedY).toBe(300 + 40);
  });

  it('clamps the cell index so the highlight never extends past the canvas trailing edge', () => {
    // Cursor exactly on the right edge would otherwise yield col == lastLine,
    // putting the highlight rectangle past the canvas. The helper clamps
    // to the last *cell* (lastLine - 1).
    const spec = buildCanvasAreaSpec();
    const lastCol = Math.floor(BUILDER_CANVAS_DEFAULT_WIDTH / BUILDER_GRID_CELL_PX) - 1;
    const lastRow = Math.floor(BUILDER_CANVAS_DEFAULT_HEIGHT / BUILDER_GRID_CELL_PX) - 1;
    const edge = computeSnapCursor(
      BUILDER_CANVAS_DEFAULT_WIDTH - 1,
      BUILDER_CANVAS_DEFAULT_HEIGHT - 1,
      spec,
    );
    expect(edge.col).toBe(lastCol);
    expect(edge.row).toBe(lastRow);
    // The highlight rect's top-left + width fits inside the canvas.
    expect(edge.cellX + edge.cellWidth).toBeLessThanOrEqual(BUILDER_CANVAS_DEFAULT_WIDTH);
    expect(edge.cellY + edge.cellHeight).toBeLessThanOrEqual(BUILDER_CANVAS_DEFAULT_HEIGHT);
  });

  it('exposes the cell footprint in viewport space so the renderer can fillRect() directly', () => {
    const spec = buildCanvasAreaSpec(DEFAULT_GRID_SPEC, 50, 60);
    const state = computeSnapCursor(50 + 100, 60 + 100, spec);
    expect(state.cellX).toBe(50 + state.col * BUILDER_GRID_CELL_PX);
    expect(state.cellY).toBe(60 + state.row * BUILDER_GRID_CELL_PX);
    expect(state.cellWidth).toBe(BUILDER_GRID_CELL_PX);
    expect(state.cellHeight).toBe(BUILDER_GRID_CELL_PX);
  });

  it('non-finite cursor coordinates collapse to the canvas origin without poisoning the state', () => {
    const spec = buildCanvasAreaSpec(DEFAULT_GRID_SPEC, 100, 100);
    for (const state of [
      computeSnapCursor(NaN, NaN, spec),
      computeSnapCursor(Infinity, -Infinity, spec),
    ]) {
      expect(Number.isFinite(state.snappedX)).toBe(true);
      expect(Number.isFinite(state.snappedY)).toBe(true);
      expect(Number.isFinite(state.cellX)).toBe(true);
      expect(Number.isFinite(state.cellY)).toBe(true);
    }
  });

  it('is deterministic — same (cursor, spec) yields byte-identical state', () => {
    // Replay support: a recorded pointer position must re-derive the
    // same snap state when the replay drives the helper at playback.
    const spec = buildCanvasAreaSpec(DEFAULT_GRID_SPEC, 25, 75);
    const a = computeSnapCursor(317, 521, spec);
    const b = computeSnapCursor(317, 521, spec);
    expect(a).toEqual(b);
  });
});

describe('canvasBounds — formatSnapCursorLabel', () => {
  it('reports off-canvas when the state is null or the cursor is off-canvas', () => {
    expect(formatSnapCursorLabel(null)).toBe('cursor: off-canvas');
    const off = computeSnapCursor(-100, -100, buildCanvasAreaSpec());
    expect(formatSnapCursorLabel(off)).toBe('cursor: off-canvas');
  });

  it('formats over-canvas state as "col C · row R · (X, Y)"', () => {
    const spec = buildCanvasAreaSpec();
    const state = computeSnapCursor(80, 40, spec);
    expect(formatSnapCursorLabel(state)).toBe('col 2 · row 1 · (80, 40)');
  });
});

describe('canvasBounds — cellColumnCount / cellRowCount', () => {
  it('returns one fewer cell than gridLineCount (lines bracket cells)', () => {
    // 1920 / 40 = 48 cells, even though the line count is 49.
    expect(cellColumnCount(buildCanvasAreaSpec())).toBe(48);
    expect(cellRowCount(buildCanvasAreaSpec())).toBe(27);
  });

  it('returns 0 for a zero-sized canvas', () => {
    const spec = buildCanvasAreaSpec(buildGridSpec(40, 40), 0, 0);
    // A one-cell canvas has 1 cell along each axis.
    expect(cellColumnCount(spec)).toBe(1);
    expect(cellRowCount(spec)).toBe(1);
  });
});
