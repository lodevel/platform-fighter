import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CANVAS_AREA_COLORS,
  CANVAS_AREA_STROKES,
  CanvasArea,
} from './CanvasArea';
import {
  BUILDER_CANVAS_DEFAULT_HEIGHT,
  BUILDER_CANVAS_DEFAULT_WIDTH,
  BUILDER_GRID_CELL_PX,
  DEFAULT_GRID_SPEC,
  buildGridSpec,
  enumerateGridLines,
} from './builderGrid';
import { enumerateBoundsRects } from './canvasBounds';

/**
 * AC 20003 Sub-AC 3 — wiring contract for the grid-based CanvasArea
 * component.
 *
 * The component itself only `import type Phaser`, so we can construct
 * it under plain Node by handing it a structurally-typed scene shim.
 * That covers the runtime behaviour (one Graphics per cohort, snap-
 * cursor toggling, idempotent destroy). The static contract — colour
 * palette, render-order constants, layer flags — is asserted by
 * reading the source as text where needed.
 *
 * Pattern matches `CatalogPanel.test.ts` so the unit suite stays
 * uniform across builder components.
 */

// ---------------------------------------------------------------------------
// Scene shim — captures every `add.*` call so tests can inspect what
// the component painted without needing a real Phaser canvas.
// ---------------------------------------------------------------------------

interface CapturedCall {
  kind: 'rectangle' | 'text' | 'graphics';
  args: unknown[];
  obj: StubObject;
}

interface StubObject {
  visible: boolean;
  destroyed: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number } | null;
  fillStyle: { color: number; alpha: number } | null;
  /** Each lineStyle call. */
  strokeCalls: Array<{ width: number; color: number; alpha: number }>;
  /** Each lineBetween call. */
  lineCalls: Array<[number, number, number, number]>;
  /** Each strokeRect call. */
  strokeRects: Array<[number, number, number, number]>;
  /** Each fillRect call. */
  fillRects: Array<[number, number, number, number]>;
  /** Last-set text content for text objects. */
  text: string | null;
  setOrigin: (x: number, y?: number) => StubObject;
  setScrollFactor: (x: number, y?: number) => StubObject;
  setDepth: (depth: number) => StubObject;
  setStrokeStyle: (width: number, color: number, alpha?: number) => StubObject;
  setVisible: (v: boolean) => StubObject;
  setPosition: (x: number, y: number) => StubObject;
  setSize: (w: number, h: number) => StubObject;
  setFillStyle: (color: number, alpha?: number) => StubObject;
  setText: (s: string) => StubObject;
  fillStyleFn: (color: number, alpha?: number) => StubObject;
  lineStyle: (width: number, color: number, alpha?: number) => StubObject;
  fillRect: (x: number, y: number, w: number, h: number) => StubObject;
  strokeRect: (x: number, y: number, w: number, h: number) => StubObject;
  lineBetween: (x1: number, y1: number, x2: number, y2: number) => StubObject;
  clear: () => StubObject;
  destroy: () => void;
}

function makeStubObject(): StubObject {
  const obj: StubObject = {
    visible: true,
    destroyed: false,
    position: { x: 0, y: 0 },
    size: null,
    fillStyle: null,
    strokeCalls: [],
    lineCalls: [],
    strokeRects: [],
    fillRects: [],
    text: null,
    setOrigin: () => obj,
    setScrollFactor: () => obj,
    setDepth: () => obj,
    setStrokeStyle: () => obj,
    setVisible: (v) => {
      obj.visible = v;
      return obj;
    },
    setPosition: (x, y) => {
      obj.position = { x, y };
      return obj;
    },
    setSize: (w, h) => {
      obj.size = { width: w, height: h };
      return obj;
    },
    setFillStyle: (color, alpha = 1) => {
      obj.fillStyle = { color, alpha };
      return obj;
    },
    setText: (s) => {
      obj.text = s;
      return obj;
    },
    fillStyleFn: (color, alpha = 1) => {
      obj.fillStyle = { color, alpha };
      return obj;
    },
    lineStyle: (width, color, alpha = 1) => {
      obj.strokeCalls.push({ width, color, alpha });
      return obj;
    },
    fillRect: (x, y, w, h) => {
      obj.fillRects.push([x, y, w, h]);
      return obj;
    },
    strokeRect: (x, y, w, h) => {
      obj.strokeRects.push([x, y, w, h]);
      return obj;
    },
    lineBetween: (x1, y1, x2, y2) => {
      obj.lineCalls.push([x1, y1, x2, y2]);
      return obj;
    },
    clear: () => {
      obj.lineCalls.length = 0;
      obj.strokeCalls.length = 0;
      return obj;
    },
    destroy: () => {
      obj.destroyed = true;
    },
  };
  return obj;
}

function makeStubScene() {
  const captured: CapturedCall[] = [];
  const scene = {
    add: {
      rectangle: (...args: unknown[]) => {
        const obj = makeStubObject();
        captured.push({ kind: 'rectangle', args, obj });
        // Initialise size from constructor args so tests can check
        // the requested footprint via `obj.size`.
        const [, , w, h] = args as [number, number, number, number];
        if (typeof w === 'number' && typeof h === 'number') {
          obj.size = { width: w, height: h };
        }
        return obj;
      },
      text: (...args: unknown[]) => {
        const obj = makeStubObject();
        const [, , content] = args as [number, number, string];
        obj.text = typeof content === 'string' ? content : null;
        captured.push({ kind: 'text', args, obj });
        return obj;
      },
      graphics: (...args: unknown[]) => {
        const obj = makeStubObject();
        // Phaser's `Graphics.fillStyle(color, alpha)` uses the same
        // method name as `Rectangle.setFillStyle` here — mirror that
        // through a small shim so the component code paths work.
        (obj as unknown as Record<string, unknown>).fillStyle = obj.fillStyleFn;
        captured.push({ kind: 'graphics', args, obj });
        return obj;
      },
    },
  };
  return { scene, captured };
}

// ---------------------------------------------------------------------------
// Static wiring contract — assertions over the source text so the
// component's exported surface stays stable for downstream sub-ACs.
// ---------------------------------------------------------------------------

describe('CanvasArea — AC 20003 Sub-AC 3 wiring contract', () => {
  const SRC = readFileSync(resolve(__dirname, './CanvasArea.ts'), 'utf8');

  it('imports the Phaser-free grid + bounds helpers', () => {
    expect(SRC).toMatch(/from\s+['"]\.\/builderGrid['"]/);
    expect(SRC).toMatch(/from\s+['"]\.\/canvasBounds['"]/);
    expect(SRC).toMatch(/enumerateGridLines/);
    expect(SRC).toMatch(/enumerateCoordinateMarks/);
    expect(SRC).toMatch(/enumerateBoundsRects/);
    expect(SRC).toMatch(/computeSnapCursor/);
  });

  it('exposes a colour palette + stroke widths for layered overrides', () => {
    expect(SRC).toMatch(/CANVAS_AREA_COLORS/);
    expect(SRC).toMatch(/CANVAS_AREA_STROKES/);
  });

  it('declares per-layer opt-in flags so hosts can skip duplicated layers', () => {
    expect(SRC).toMatch(/CanvasAreaLayerFlags/);
    expect(SRC).toMatch(/snapCursor\?:\s*boolean/);
    expect(SRC).toMatch(/bounds\?:\s*boolean/);
  });

  it('forwards pointer-derived snap state via updateSnapCursor / hideSnapCursor', () => {
    expect(SRC).toMatch(/updateSnapCursor\(/);
    expect(SRC).toMatch(/hideSnapCursor\(/);
  });
});

// ---------------------------------------------------------------------------
// Runtime behaviour — drive the component with the stub scene.
// ---------------------------------------------------------------------------

describe('CanvasArea — full layer rendering', () => {
  it('paints surface + grid + bounds + coordinate marks + snap layers by default', () => {
    const { scene, captured } = makeStubScene();
    const area = new CanvasArea(scene as never);

    // Surface = a single rectangle filling the canvas dimensions.
    const rectangles = captured.filter((c) => c.kind === 'rectangle');
    const surfaceCandidates = rectangles.filter(
      (c) => c.obj.size?.width === BUILDER_CANVAS_DEFAULT_WIDTH,
    );
    expect(surfaceCandidates.length).toBeGreaterThanOrEqual(1);

    // Grid lines = two graphics (minor + major) plus bounds graphics.
    const graphics = captured.filter((c) => c.kind === 'graphics');
    expect(graphics.length).toBeGreaterThan(2);

    // Coordinate marks = at least three text objects (origin + axis-x + axis-y).
    const texts = captured.filter((c) => c.kind === 'text');
    expect(texts.length).toBeGreaterThanOrEqual(3);

    area.destroy();
  });

  it('emits exactly one lineBetween per grid line across the minor + major cohorts', () => {
    const { scene, captured } = makeStubScene();
    const area = new CanvasArea(scene as never);

    const expectedLines = enumerateGridLines().length;
    const actualLines = captured
      .filter((c) => c.kind === 'graphics')
      .reduce((sum, c) => sum + c.obj.lineCalls.length, 0);
    // Grid lines + crosshair (2 segments per call when active, but the
    // crosshair starts hidden so only grid lines count).
    expect(actualLines).toBe(expectedLines);

    area.destroy();
  });

  it('renders one strokeRect per bounds frame returned by enumerateBoundsRects', () => {
    const { scene, captured } = makeStubScene();
    const area = new CanvasArea(scene as never);

    const expectedBoundsRects = enumerateBoundsRects(area.getSpec()).length;
    const actualStrokeRects = captured
      .filter((c) => c.kind === 'graphics')
      .reduce((sum, c) => sum + c.obj.strokeRects.length, 0);
    expect(actualStrokeRects).toBe(expectedBoundsRects);

    area.destroy();
  });

  it('translates grid-line coordinates by the canvas origin', () => {
    const { scene, captured } = makeStubScene();
    const area = new CanvasArea(scene as never, { originX: 200, originY: 300 });

    // The first vertical grid line (index 0, position 0) lives at the
    // canvas's left edge; in viewport space that's exactly originX.
    const minor = captured
      .filter((c) => c.kind === 'graphics')
      .map((c) => c.obj)
      .find((obj) => obj.lineCalls.some(([x1]) => x1 === 200));
    expect(minor).toBeDefined();

    area.destroy();
  });
});

describe('CanvasArea — layer opt-out flags', () => {
  it('skips disabled layers entirely', () => {
    const { scene, captured } = makeStubScene();
    const area = new CanvasArea(scene as never, {
      layers: {
        surface: false,
        gridLines: false,
        coordinateMarks: false,
        bounds: true,
        snapCursor: true,
      },
    });

    // No surface rectangle (only the snap-cell highlight, which has
    // SNAP cell dimensions, NOT canvas dimensions).
    const rectangles = captured.filter((c) => c.kind === 'rectangle');
    for (const r of rectangles) {
      expect(r.obj.size?.width).not.toBe(BUILDER_CANVAS_DEFAULT_WIDTH);
    }

    // No coordinate-mark text objects.
    expect(captured.filter((c) => c.kind === 'text')).toHaveLength(0);

    // Bounds frames still painted.
    const totalStrokeRects = captured
      .filter((c) => c.kind === 'graphics')
      .reduce((sum, c) => sum + c.obj.strokeRects.length, 0);
    expect(totalStrokeRects).toBeGreaterThan(0);

    area.destroy();
  });

  it('emits zero grid lineBetween calls when gridLines layer is off', () => {
    const { scene, captured } = makeStubScene();
    const area = new CanvasArea(scene as never, {
      layers: { gridLines: false },
    });

    const totalLineBetween = captured
      .filter((c) => c.kind === 'graphics')
      .reduce((sum, c) => sum + c.obj.lineCalls.length, 0);
    expect(totalLineBetween).toBe(0);

    area.destroy();
  });
});

describe('CanvasArea — snap cursor', () => {
  it('updates the cell highlight to the snapped cell on a pointer over the canvas', () => {
    const { scene, captured } = makeStubScene();
    const area = new CanvasArea(scene as never, {
      originX: 100,
      originY: 200,
    });

    // Hover near (100+80, 200+40). The snap-cell highlight is the LAST
    // rectangle the component creates (after the surface).
    const state = area.updateSnapCursor(100 + 80, 200 + 40);
    expect(state.overCanvas).toBe(true);
    expect(state.col).toBe(2);
    expect(state.row).toBe(1);

    const rectangles = captured.filter((c) => c.kind === 'rectangle');
    const cell = rectangles[rectangles.length - 1]!.obj;
    expect(cell.visible).toBe(true);
    expect(cell.position.x).toBe(100 + 2 * BUILDER_GRID_CELL_PX);
    expect(cell.position.y).toBe(200 + 1 * BUILDER_GRID_CELL_PX);
    expect(cell.size).toEqual({
      width: BUILDER_GRID_CELL_PX,
      height: BUILDER_GRID_CELL_PX,
    });

    area.destroy();
  });

  it('hides the snap-cell highlight when the cursor is off-canvas', () => {
    const { scene, captured } = makeStubScene();
    const area = new CanvasArea(scene as never, { originX: 500, originY: 500 });

    // Cursor at (0, 0) — well off-canvas.
    const state = area.updateSnapCursor(0, 0);
    expect(state.overCanvas).toBe(false);

    const rectangles = captured.filter((c) => c.kind === 'rectangle');
    const cell = rectangles[rectangles.length - 1]!.obj;
    expect(cell.visible).toBe(false);

    area.destroy();
  });

  it('hideSnapCursor() hides the overlay even after a previous over-canvas update', () => {
    const { scene, captured } = makeStubScene();
    const area = new CanvasArea(scene as never);

    area.updateSnapCursor(100, 100);
    area.hideSnapCursor();

    const rectangles = captured.filter((c) => c.kind === 'rectangle');
    const cell = rectangles[rectangles.length - 1]!.obj;
    expect(cell.visible).toBe(false);

    area.destroy();
  });

  it('exposes the latest snap state via getSnapCursor()', () => {
    const { scene } = makeStubScene();
    const area = new CanvasArea(scene as never);

    expect(area.getSnapCursor()).toBeNull();
    area.updateSnapCursor(80, 40);
    const state = area.getSnapCursor();
    expect(state).not.toBeNull();
    expect(state!.col).toBe(2);
    expect(state!.row).toBe(1);

    area.destroy();
  });
});

describe('CanvasArea — setSpec rebuild', () => {
  it('rebuilds every visual when the spec changes', () => {
    const { scene, captured } = makeStubScene();
    const area = new CanvasArea(scene as never);
    const initialCount = captured.length;

    area.setSpec({ gridSpec: buildGridSpec(800, 600) });

    // Rebuild should have created a fresh batch of GameObjects, so the
    // capture log grew and the previously captured objects are
    // destroyed.
    expect(captured.length).toBeGreaterThan(initialCount);
    // At least one of the original objects is now destroyed (we
    // destroyed the entire prior batch in `populate()`).
    const someInitialDestroyed = captured
      .slice(0, initialCount)
      .some((c) => c.obj.destroyed);
    expect(someInitialDestroyed).toBe(true);

    area.destroy();
  });

  it('preserves the canvas origin when setSpec is called with only a gridSpec', () => {
    const { scene } = makeStubScene();
    const area = new CanvasArea(scene as never, { originX: 200, originY: 300 });
    area.setSpec({ gridSpec: buildGridSpec(800, 600) });
    expect(area.getSpec().originX).toBe(200);
    expect(area.getSpec().originY).toBe(300);
    area.destroy();
  });
});

describe('CanvasArea — destroy idempotence', () => {
  it('drops every GameObject on destroy and is safe to call twice', () => {
    const { scene, captured } = makeStubScene();
    const area = new CanvasArea(scene as never);
    area.destroy();
    for (const c of captured) {
      expect(c.obj.destroyed).toBe(true);
    }
    // Second destroy is a no-op — should not throw.
    expect(() => area.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Palette + stroke-width sanity (so the wiring contract test can lock
// the canonical values without re-reading the source).
// ---------------------------------------------------------------------------

describe('CanvasArea — visual constants', () => {
  it('declares both the snap-cell + crosshair colours', () => {
    expect(typeof CANVAS_AREA_COLORS.snapCellFill).toBe('number');
    expect(typeof CANVAS_AREA_COLORS.snapCrosshair).toBe('number');
  });

  it('declares stroke widths for minor + major + crosshair', () => {
    expect(CANVAS_AREA_STROKES.minor).toBeGreaterThan(0);
    expect(CANVAS_AREA_STROKES.major).toBeGreaterThan(CANVAS_AREA_STROKES.minor);
    expect(CANVAS_AREA_STROKES.crosshair).toBeGreaterThan(0);
  });

  it('default grid spec exposes the canonical canvas dimensions', () => {
    // Sanity check — guards against accidental drift where the
    // CanvasArea picks up a different default than the rest of the
    // builder.
    const { scene } = makeStubScene();
    const area = new CanvasArea(scene as never);
    expect(area.getSpec().gridSpec).toBe(DEFAULT_GRID_SPEC);
    expect(area.getSpec().width).toBe(BUILDER_CANVAS_DEFAULT_WIDTH);
    expect(area.getSpec().height).toBe(BUILDER_CANVAS_DEFAULT_HEIGHT);
    area.destroy();
  });
});

// ---------------------------------------------------------------------------
// StageBuilderScene wiring — assert the scene actually consumes the
// component for AC 20003 Sub-AC 3.
// ---------------------------------------------------------------------------

describe('StageBuilderScene — AC 20003 Sub-AC 3 canvas-area wiring', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, '../scenes/StageBuilderScene.ts'),
    'utf8',
  );

  it('imports CanvasArea from the builder module', () => {
    expect(SCENE_SRC).toMatch(
      /import\s*\{[^}]*CanvasArea[^}]*\}\s*from\s*['"]\.\.\/builder\/CanvasArea['"]/,
    );
  });

  it('instantiates a CanvasArea during create() with snap-cursor + bounds enabled', () => {
    expect(SCENE_SRC).toMatch(/new\s+CanvasArea\s*\(/);
    expect(SCENE_SRC).toMatch(/snapCursor:\s*true/);
    expect(SCENE_SRC).toMatch(/bounds:\s*true/);
  });

  it('mounts the canvas area at its dedicated depth in the depth ladder', () => {
    expect(SCENE_SRC).toMatch(/canvasArea:\s*\d+/);
    expect(SCENE_SRC).toMatch(/STAGE_BUILDER_DEPTHS\.canvasArea/);
  });

  it('forwards pointer events into the canvas area for snap-cursor updates', () => {
    expect(SCENE_SRC).toMatch(/updateSnapCursor/);
    expect(SCENE_SRC).toMatch(/hideSnapCursor/);
  });

  it('tears the canvas area down on shutdown so re-entries do not leak GameObjects', () => {
    expect(SCENE_SRC).toMatch(/this\.canvasArea\s*=\s*null/);
    expect(SCENE_SRC).toMatch(/this\.canvasArea\.destroy\(\)/);
  });

  it('exposes a getter for the canvas area + snap cursor (test seam)', () => {
    expect(SCENE_SRC).toMatch(/getCanvasArea\(\)/);
    expect(SCENE_SRC).toMatch(/getSnapCursor\(\)/);
  });

  it('paints a snap-cursor HUD readout via formatSnapCursorLabel', () => {
    expect(SCENE_SRC).toMatch(/formatSnapCursorLabel/);
  });
});
