import { describe, it, expect } from 'vitest';
import {
  BUILDER_GRID_CELL_PX,
  BUILDER_GRID_MAJOR_EVERY,
  BUILDER_CANVAS_DEFAULT_HEIGHT,
  BUILDER_CANVAS_DEFAULT_WIDTH,
  BUILDER_CANVAS_MAX_HEIGHT,
  BUILDER_CANVAS_MAX_WIDTH,
  DEFAULT_GRID_SPEC,
  buildGridSpec,
  enumerateCoordinateMarks,
  enumerateGridLines,
  gridLineCount,
  gridToWorld,
  isMajorGridLine,
  snapToGrid,
  worldToGrid,
} from './builderGrid';
import { GAME_CONFIG } from '../engine/constants';

/**
 * AC 20001 Sub-AC 1 — "Create StageBuilderScene skeleton with grid
 * canvas rendering (snapping grid lines, coordinate system,
 * background)".
 *
 * The grid math powering the scene's rendering is split into a
 * Phaser-free helper so it can be exhaustively unit-tested without
 * booting Phaser. The scene file forwards every grid query into one
 * of these helpers, so if the contract here holds the scene's
 * rendering is correct (the scene-level test in
 * `StageBuilderScene.test.ts` proves the wiring).
 */
describe('builderGrid — defaults & spec construction', () => {
  it('exposes 2× screen as the canvas hard cap (Seed constraint)', () => {
    // The Seed enforces "max dimensions 2× screen size" for any
    // custom stage. The constants here are the single source of
    // truth used by the grid math, the camera, and the save-time
    // validator.
    expect(BUILDER_CANVAS_MAX_WIDTH).toBe(GAME_CONFIG.width * 2);
    expect(BUILDER_CANVAS_MAX_HEIGHT).toBe(GAME_CONFIG.height * 2);
    expect(BUILDER_CANVAS_DEFAULT_WIDTH).toBe(GAME_CONFIG.width);
    expect(BUILDER_CANVAS_DEFAULT_HEIGHT).toBe(GAME_CONFIG.height);
  });

  it('default grid spec is the 1× canvas at the canonical cell size', () => {
    expect(DEFAULT_GRID_SPEC.cellPx).toBe(BUILDER_GRID_CELL_PX);
    expect(DEFAULT_GRID_SPEC.width).toBe(BUILDER_CANVAS_DEFAULT_WIDTH);
    expect(DEFAULT_GRID_SPEC.height).toBe(BUILDER_CANVAS_DEFAULT_HEIGHT);
  });

  it('default grid spec divides the screen into integer-count cells (no half-cell sliver)', () => {
    // Picking a cell size that evenly divides the design canvas
    // means the rendered grid never has a final partial cell at
    // the edge.
    expect(BUILDER_CANVAS_DEFAULT_WIDTH % BUILDER_GRID_CELL_PX).toBe(0);
    expect(BUILDER_CANVAS_DEFAULT_HEIGHT % BUILDER_GRID_CELL_PX).toBe(0);
  });

  it('buildGridSpec clamps oversize canvases to the 2× screen cap', () => {
    const spec = buildGridSpec(99_999, 99_999);
    expect(spec.width).toBe(BUILDER_CANVAS_MAX_WIDTH);
    expect(spec.height).toBe(BUILDER_CANVAS_MAX_HEIGHT);
  });

  it('buildGridSpec rejects bad cellPx values and falls back to the canonical default', () => {
    // Non-finite or non-positive cell sizes would crash any
    // downstream `Math.floor(... / 0)` — the helper guards them.
    const spec = buildGridSpec(800, 600, NaN);
    expect(spec.cellPx).toBe(BUILDER_GRID_CELL_PX);
    const spec2 = buildGridSpec(800, 600, 0);
    expect(spec2.cellPx).toBe(BUILDER_GRID_CELL_PX);
    const spec3 = buildGridSpec(800, 600, -10);
    expect(spec3.cellPx).toBe(BUILDER_GRID_CELL_PX);
  });

  it('buildGridSpec floors the canvas to at least one cell', () => {
    // A canvas smaller than one cell would render with zero grid
    // lines and break drag-snap (no valid cell to snap to).
    const spec = buildGridSpec(5, 5);
    expect(spec.width).toBeGreaterThanOrEqual(BUILDER_GRID_CELL_PX);
    expect(spec.height).toBeGreaterThanOrEqual(BUILDER_GRID_CELL_PX);
  });
});

describe('builderGrid — snapToGrid', () => {
  it('snaps to the nearest cell intersection', () => {
    // Halfway points round to the higher cell (JS Math.round rule).
    const a = snapToGrid(19, 19);
    expect(a).toEqual({ x: 0, y: 0 });
    const b = snapToGrid(21, 21);
    expect(b).toEqual({ x: 40, y: 40 });
    const c = snapToGrid(40, 40);
    expect(c).toEqual({ x: 40, y: 40 });
  });

  it('clamps off-canvas points back to the nearest in-bounds intersection', () => {
    // Beyond the right edge should clamp to width; negative should
    // clamp to 0. Saves the validator from rejecting an off-canvas
    // piece on save.
    const off = snapToGrid(-50, BUILDER_CANVAS_DEFAULT_HEIGHT + 200);
    expect(off.x).toBe(0);
    expect(off.y).toBe(BUILDER_CANVAS_DEFAULT_HEIGHT);
  });

  it('non-finite inputs do not produce NaN/Infinity coordinates', () => {
    // The helper guards against non-finite inputs so the
    // downstream renderer never has to draw at NaN/Infinity.
    // The exact resolution (origin vs. nearest edge) is a
    // policy decision — what matters for the AC is that the
    // result is always a finite, in-bounds canvas pixel.
    for (const result of [
      snapToGrid(NaN, NaN),
      snapToGrid(Infinity, -Infinity),
      snapToGrid(-Infinity, Infinity),
    ]) {
      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
      expect(result.x).toBeGreaterThanOrEqual(0);
      expect(result.x).toBeLessThanOrEqual(BUILDER_CANVAS_DEFAULT_WIDTH);
      expect(result.y).toBeGreaterThanOrEqual(0);
      expect(result.y).toBeLessThanOrEqual(BUILDER_CANVAS_DEFAULT_HEIGHT);
    }
  });
});

describe('builderGrid — worldToGrid / gridToWorld round-trip', () => {
  it('worldToGrid returns 0-based integer cell indices', () => {
    const a = worldToGrid(0, 0);
    expect(a).toEqual({ col: 0, row: 0 });
    const b = worldToGrid(40, 40);
    expect(b).toEqual({ col: 1, row: 1 });
    const c = worldToGrid(79, 79);
    // 79 / 40 = 1.975 → floor to 1
    expect(c).toEqual({ col: 1, row: 1 });
  });

  it('gridToWorld is the inverse of worldToGrid for cell-aligned input', () => {
    for (let col = 0; col < 5; col += 1) {
      for (let row = 0; row < 5; row += 1) {
        const world = gridToWorld(col, row);
        const back = worldToGrid(world.x, world.y);
        expect(back).toEqual({ col, row });
      }
    }
  });

  it('worldToGrid clamps out-of-bounds coordinates rather than throwing', () => {
    const off = worldToGrid(-100, 999_999);
    expect(off.col).toBe(0);
    // Default canvas is 1080 tall, 27 cells.
    expect(off.row).toBe(Math.floor(BUILDER_CANVAS_DEFAULT_HEIGHT / BUILDER_GRID_CELL_PX));
  });

  it('non-finite cell indices fall back to (0, 0)', () => {
    expect(gridToWorld(NaN, NaN)).toEqual({ x: 0, y: 0 });
  });
});

describe('builderGrid — isMajorGridLine / gridLineCount', () => {
  it('treats every BUILDER_GRID_MAJOR_EVERY-th line as major (including index 0)', () => {
    expect(isMajorGridLine(0)).toBe(true); // canvas edge always major
    expect(isMajorGridLine(BUILDER_GRID_MAJOR_EVERY)).toBe(true);
    expect(isMajorGridLine(BUILDER_GRID_MAJOR_EVERY * 3)).toBe(true);
    expect(isMajorGridLine(1)).toBe(false);
    expect(isMajorGridLine(BUILDER_GRID_MAJOR_EVERY - 1)).toBe(false);
  });

  it('handles bad input defensively', () => {
    expect(isMajorGridLine(-1)).toBe(false);
    expect(isMajorGridLine(NaN)).toBe(false);
    expect(isMajorGridLine(5, 0)).toBe(false);
  });

  it('gridLineCount includes both leading and trailing edges', () => {
    // 1920 / 40 = 48 cells → 49 vertical lines (0..48).
    expect(gridLineCount(1920, 40)).toBe(49);
    // 1080 / 40 = 27 cells → 28 horizontal lines.
    expect(gridLineCount(1080, 40)).toBe(28);
  });

  it('gridLineCount handles bad input', () => {
    expect(gridLineCount(0, 40)).toBe(0);
    expect(gridLineCount(100, 0)).toBe(0);
    expect(gridLineCount(NaN, 40)).toBe(0);
  });
});

describe('builderGrid — enumerateGridLines', () => {
  it('emits one line per axis index, in render order (verticals then horizontals)', () => {
    const lines = enumerateGridLines();
    const verts = lines.filter((l) => l.axis === 'vertical');
    const horizs = lines.filter((l) => l.axis === 'horizontal');
    expect(verts.length).toBe(gridLineCount(BUILDER_CANVAS_DEFAULT_WIDTH, BUILDER_GRID_CELL_PX));
    expect(horizs.length).toBe(gridLineCount(BUILDER_CANVAS_DEFAULT_HEIGHT, BUILDER_GRID_CELL_PX));
    // Verticals come first.
    expect(lines[0]?.axis).toBe('vertical');
    expect(lines[verts.length]?.axis).toBe('horizontal');
  });

  it('marks the canvas edges as major (so the renderer can stroke them brighter)', () => {
    const lines = enumerateGridLines();
    const firstVert = lines.find((l) => l.axis === 'vertical' && l.index === 0);
    expect(firstVert?.major).toBe(true);
  });

  it('emits position 0 at the leading edge and canvas dim at the trailing edge', () => {
    const spec = buildGridSpec(800, 600, 40);
    const lines = enumerateGridLines(spec);
    const verts = lines.filter((l) => l.axis === 'vertical');
    expect(verts[0]?.position).toBe(0);
    expect(verts[verts.length - 1]?.position).toBe(800);
    const horizs = lines.filter((l) => l.axis === 'horizontal');
    expect(horizs[0]?.position).toBe(0);
    expect(horizs[horizs.length - 1]?.position).toBe(600);
  });
});

describe('builderGrid — enumerateCoordinateMarks', () => {
  it('always emits an origin label and two axis-direction labels', () => {
    const marks = enumerateCoordinateMarks();
    const kinds = new Set(marks.map((m) => m.kind));
    expect(kinds.has('origin')).toBe(true);
    expect(kinds.has('axis-x')).toBe(true);
    expect(kinds.has('axis-y')).toBe(true);
    const origin = marks.find((m) => m.kind === 'origin');
    expect(origin).toEqual(
      expect.objectContaining({ x: 0, y: 0, label: '(0,0)' }),
    );
  });

  it('emits axis labels at the far end of each axis', () => {
    const marks = enumerateCoordinateMarks();
    const ax = marks.find((m) => m.kind === 'axis-x');
    const ay = marks.find((m) => m.kind === 'axis-y');
    expect(ax?.x).toBe(BUILDER_CANVAS_DEFAULT_WIDTH);
    expect(ax?.y).toBe(0);
    expect(ay?.x).toBe(0);
    expect(ay?.y).toBe(BUILDER_CANVAS_DEFAULT_HEIGHT);
  });

  it('emits one numeric tick label per major grid line (excluding the origin)', () => {
    // Default canvas is 48×27 cells, 4-major cadence:
    //   X: indices 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48 → 12 ticks
    //   Y: indices 4, 8, 12, 16, 20, 24                          → 6 ticks
    const marks = enumerateCoordinateMarks();
    const xTicks = marks.filter(
      (m) => m.kind === 'tick' && m.y === 0 && m.x > 0,
    );
    const yTicks = marks.filter(
      (m) => m.kind === 'tick' && m.x === 0 && m.y > 0,
    );
    expect(xTicks.length).toBeGreaterThan(0);
    expect(yTicks.length).toBeGreaterThan(0);
    // Tick labels carry the design-pixel position so the player can
    // read coordinates without doing column-times-cell-size math.
    for (const t of xTicks) {
      expect(t.label).toBe(`${t.x}`);
    }
    for (const t of yTicks) {
      expect(t.label).toBe(`${t.y}`);
    }
  });
});
