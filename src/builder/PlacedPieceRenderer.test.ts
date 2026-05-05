import { describe, it, expect } from 'vitest';
import {
  PLACED_PIECE_COLORS,
  PlacedPieceRenderer,
} from './PlacedPieceRenderer';
import { findCatalogPiece } from './catalogPieces';
import type { RegisteredPiece } from './stageDataModel';

/**
 * AC 20102 Sub-AC 2 — placed-piece renderer wiring contract.
 *
 * The component itself only `import type Phaser`, so we can construct
 * it under plain Node by handing it a structurally-typed scene shim.
 * That covers the runtime behaviour (allocate-on-add, destroy-on-remove,
 * idempotent destroy). The static contract — colour palette, default
 * depth — is asserted by reading the source as text where needed.
 *
 * Pattern matches `GhostPreview.test.ts` / `CatalogPanel.test.ts` so
 * the unit suite stays uniform across builder components.
 */

// ---------------------------------------------------------------------------
// Scene shim
// ---------------------------------------------------------------------------

interface StubRect {
  kind: 'rectangle';
  destroyed: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  fill: { color: number; alpha: number };
  stroke: { width: number; color: number; alpha: number } | null;
  depth: number;
  visible: boolean;
  setOrigin: (x: number, y?: number) => StubRect;
  setScrollFactor: (x: number, y?: number) => StubRect;
  setDepth: (d: number) => StubRect;
  setStrokeStyle: (w: number, c: number, a?: number) => StubRect;
  setFillStyle: (c: number, a?: number) => StubRect;
  setVisible: (v: boolean) => StubRect;
  setPosition: (x: number, y: number) => StubRect;
  setSize: (w: number, h: number) => StubRect;
  destroy: () => void;
}

interface StubText {
  kind: 'text';
  destroyed: boolean;
  position: { x: number; y: number };
  content: string;
  style: Record<string, unknown>;
  depth: number;
  setOrigin: (x: number, y?: number) => StubText;
  setScrollFactor: (x: number, y?: number) => StubText;
  setDepth: (d: number) => StubText;
  setPosition: (x: number, y: number) => StubText;
  destroy: () => void;
}

function makeStubRect(
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  alpha: number,
): StubRect {
  const rect: StubRect = {
    kind: 'rectangle',
    destroyed: false,
    position: { x, y },
    size: { width: w, height: h },
    fill: { color, alpha },
    stroke: null,
    depth: 0,
    visible: true,
    setOrigin: () => rect,
    setScrollFactor: () => rect,
    setDepth: (d) => {
      rect.depth = d;
      return rect;
    },
    setStrokeStyle: (sw, sc, sa = 1) => {
      rect.stroke = { width: sw, color: sc, alpha: sa };
      return rect;
    },
    setFillStyle: (c, a = 1) => {
      rect.fill = { color: c, alpha: a };
      return rect;
    },
    setVisible: (v) => {
      rect.visible = v;
      return rect;
    },
    setPosition: (px, py) => {
      rect.position = { x: px, y: py };
      return rect;
    },
    setSize: (sw, sh) => {
      rect.size = { width: sw, height: sh };
      return rect;
    },
    destroy: () => {
      rect.destroyed = true;
    },
  };
  return rect;
}

function makeStubText(
  x: number,
  y: number,
  content: string,
  style: Record<string, unknown>,
): StubText {
  const txt: StubText = {
    kind: 'text',
    destroyed: false,
    position: { x, y },
    content,
    style,
    depth: 0,
    setOrigin: () => txt,
    setScrollFactor: () => txt,
    setDepth: (d) => {
      txt.depth = d;
      return txt;
    },
    setPosition: (px, py) => {
      txt.position = { x: px, y: py };
      return txt;
    },
    destroy: () => {
      txt.destroyed = true;
    },
  };
  return txt;
}

function makeStubScene() {
  const rectangles: StubRect[] = [];
  const texts: StubText[] = [];
  const scene = {
    add: {
      rectangle: (
        x: number,
        y: number,
        w: number,
        h: number,
        color: number,
        alpha: number,
      ) => {
        const r = makeStubRect(x, y, w, h, color, alpha);
        rectangles.push(r);
        return r;
      },
      text: (
        x: number,
        y: number,
        content: string,
        style: Record<string, unknown>,
      ) => {
        const t = makeStubText(x, y, content, style);
        texts.push(t);
        return t;
      },
    },
  };
  return { scene, rectangles, texts };
}

function makeRegisteredPiece(
  overrides: Partial<RegisteredPiece> = {},
): RegisteredPiece {
  return {
    id: overrides.id ?? 'flat-platform#0',
    insertionIndex: 0,
    type: 'flat-platform',
    canvasX: 200,
    canvasY: 320,
    width: 160,
    height: 40,
    col: 5,
    row: 8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('PlacedPieceRenderer — construction', () => {
  it('starts with no painted sprites', () => {
    const { scene } = makeStubScene();
    const renderer = new PlacedPieceRenderer(scene, {
      canvasOriginX: 320,
      canvasOriginY: 80,
    });
    expect(renderer.getSpriteCount()).toBe(0);
    expect(renderer.getVisuals()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// repaint — diff-based add / remove
// ---------------------------------------------------------------------------

describe('PlacedPieceRenderer.repaint — diff-based updates', () => {
  it('allocates a rectangle for each new piece in the roster', () => {
    const { scene, rectangles } = makeStubScene();
    const renderer = new PlacedPieceRenderer(scene, {
      canvasOriginX: 320,
      canvasOriginY: 80,
    });
    renderer.repaint([makeRegisteredPiece()]);
    expect(rectangles).toHaveLength(1);
    const rect = rectangles[0]!;
    // Position is canvas-relative + the canvas origin offset.
    expect(rect.position).toEqual({ x: 200 + 320, y: 320 + 80 });
    expect(rect.size).toEqual({ width: 160, height: 40 });
    // Fill colour matches the catalog accent for flat-platform.
    expect(rect.fill.color).toBe(findCatalogPiece('flat-platform')!.accentColor);
    // Stroke uses the renderer's border palette entry.
    expect(rect.stroke?.color).toBe(PLACED_PIECE_COLORS.border);
    expect(renderer.getSpriteCount()).toBe(1);
  });

  it('skips re-allocation for pieces already painted (idempotent on identical roster)', () => {
    const { scene, rectangles } = makeStubScene();
    const renderer = new PlacedPieceRenderer(scene, {
      canvasOriginX: 0,
      canvasOriginY: 0,
    });
    const piece = makeRegisteredPiece();
    renderer.repaint([piece]);
    renderer.repaint([piece]);
    renderer.repaint([piece]);
    expect(rectangles).toHaveLength(1);
    expect(renderer.getSpriteCount()).toBe(1);
  });

  it('destroys sprites whose ids were removed from the roster', () => {
    const { scene, rectangles } = makeStubScene();
    const renderer = new PlacedPieceRenderer(scene, {
      canvasOriginX: 0,
      canvasOriginY: 0,
    });
    const a = makeRegisteredPiece({ id: 'flat-platform#0', canvasX: 0 });
    const b = makeRegisteredPiece({ id: 'flat-platform#1', canvasX: 200 });
    renderer.repaint([a, b]);
    expect(rectangles).toHaveLength(2);
    expect(rectangles.every((r) => !r.destroyed)).toBe(true);
    // Remove b from the roster.
    renderer.repaint([a]);
    expect(rectangles[0]!.destroyed).toBe(false);
    expect(rectangles[1]!.destroyed).toBe(true);
    expect(renderer.getSpriteCount()).toBe(1);
  });

  it('paints hazard pieces with the catalog accent colour for that hazard', () => {
    const { scene, rectangles } = makeStubScene();
    const renderer = new PlacedPieceRenderer(scene, {
      canvasOriginX: 0,
      canvasOriginY: 0,
    });
    renderer.repaint([
      makeRegisteredPiece({
        id: 'lava-zone#0',
        type: 'lava-zone',
        width: 200,
        height: 80,
      }),
    ]);
    const lava = findCatalogPiece('lava-zone')!;
    expect(rectangles[0]!.fill.color).toBe(lava.accentColor);
    expect(rectangles[0]!.size).toEqual({ width: 200, height: 80 });
  });

  it('paints distinct pieces at their snapped canvas coordinates', () => {
    const { scene, rectangles } = makeStubScene();
    const renderer = new PlacedPieceRenderer(scene, {
      canvasOriginX: 320,
      canvasOriginY: 80,
    });
    renderer.repaint([
      makeRegisteredPiece({ id: 'flat-platform#0', canvasX: 0, canvasY: 0 }),
      makeRegisteredPiece({
        id: 'wind-zone#1',
        type: 'wind-zone',
        canvasX: 400,
        canvasY: 200,
        width: 200,
        height: 80,
      }),
      makeRegisteredPiece({
        id: 'spawn-point#2',
        type: 'spawn-point',
        canvasX: 600,
        canvasY: 600,
        width: 40,
        height: 40,
      }),
    ]);
    expect(rectangles).toHaveLength(3);
    expect(rectangles[0]!.position).toEqual({ x: 320, y: 80 });
    expect(rectangles[1]!.position).toEqual({ x: 720, y: 280 });
    expect(rectangles[2]!.position).toEqual({ x: 920, y: 680 });
  });

  it('emits a small type-tag overlay for pieces large enough to read text on', () => {
    const { scene, texts } = makeStubScene();
    const renderer = new PlacedPieceRenderer(scene, {
      canvasOriginX: 0,
      canvasOriginY: 0,
    });
    renderer.repaint([
      // Large enough — gets a tag.
      makeRegisteredPiece({
        id: 'lava-zone#0',
        type: 'lava-zone',
        width: 200,
        height: 80,
      }),
      // Spawn point is 40×40 — no tag (skipped to keep the marker clean).
      makeRegisteredPiece({
        id: 'spawn-point#1',
        type: 'spawn-point',
        canvasX: 200,
        width: 40,
        height: 40,
      }),
    ]);
    // Exactly one text emitted (for the lava zone).
    expect(texts).toHaveLength(1);
    expect(texts[0]!.content).toBe('LAVA');
  });
});

// ---------------------------------------------------------------------------
// setCanvasOrigin
// ---------------------------------------------------------------------------

describe('PlacedPieceRenderer.setCanvasOrigin', () => {
  it('repositions every existing sprite when the canvas origin shifts', () => {
    const { scene, rectangles } = makeStubScene();
    const renderer = new PlacedPieceRenderer(scene, {
      canvasOriginX: 100,
      canvasOriginY: 100,
    });
    const piece = makeRegisteredPiece({ canvasX: 50, canvasY: 60 });
    renderer.repaint([piece]);
    expect(rectangles[0]!.position).toEqual({ x: 150, y: 160 });
    renderer.setCanvasOrigin(500, 200, [piece]);
    expect(rectangles[0]!.position).toEqual({ x: 550, y: 260 });
  });
});

// ---------------------------------------------------------------------------
// destroy
// ---------------------------------------------------------------------------

describe('PlacedPieceRenderer.destroy', () => {
  it('destroys every painted GameObject', () => {
    const { scene, rectangles } = makeStubScene();
    const renderer = new PlacedPieceRenderer(scene, {
      canvasOriginX: 0,
      canvasOriginY: 0,
    });
    renderer.repaint([
      makeRegisteredPiece({ id: 'a' }),
      makeRegisteredPiece({ id: 'b', canvasX: 200 }),
    ]);
    renderer.destroy();
    expect(rectangles.every((r) => r.destroyed)).toBe(true);
    expect(renderer.getSpriteCount()).toBe(0);
  });

  it('is idempotent', () => {
    const { scene } = makeStubScene();
    const renderer = new PlacedPieceRenderer(scene, {
      canvasOriginX: 0,
      canvasOriginY: 0,
    });
    expect(() => {
      renderer.destroy();
      renderer.destroy();
    }).not.toThrow();
  });

  it('repaint after destroy is a no-op', () => {
    const { scene, rectangles } = makeStubScene();
    const renderer = new PlacedPieceRenderer(scene, {
      canvasOriginX: 0,
      canvasOriginY: 0,
    });
    renderer.destroy();
    renderer.repaint([makeRegisteredPiece()]);
    expect(rectangles).toHaveLength(0);
  });
});
