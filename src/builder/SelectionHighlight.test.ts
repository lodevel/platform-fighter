import { describe, it, expect } from 'vitest';
import {
  SELECTION_HIGHLIGHT_COLORS,
  SELECTION_HINT_FLIP_THRESHOLD_PX,
  SELECTION_HINT_GAP_PX,
  SELECTION_OUTLINE_PAD_PX,
  SELECTION_OUTLINE_STROKE_PX,
  SelectionHighlight,
  selectionHintAnchor,
} from './SelectionHighlight';
import { SELECTION_HINT_TEXT, type SelectablePiece } from './pieceSelection';

/**
 * Selection-highlight painter wiring contract.
 *
 * The component itself only `import type Phaser`, so we can construct
 * it under plain Node by handing it a structurally-typed scene shim —
 * the same pattern `PlacedPieceRenderer.test.ts` / `GhostPreview.test.ts`
 * use. These tests guard:
 *
 *   • pre-allocation: exactly one outline rect + one hint text, both
 *     hidden until a piece is selected;
 *   • update(piece) positions the outline (with the pad outset) at the
 *     piece's viewport-translated bounds and shows the hint;
 *   • the hint flips below the piece near the canvas top;
 *   • update(null) / clear() hide everything without deallocating;
 *   • destroy() releases both GameObjects and is idempotent.
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
  origin: { x: number; y: number };
  content: string;
  style: Record<string, unknown>;
  depth: number;
  visible: boolean;
  setOrigin: (x: number, y?: number) => StubText;
  setScrollFactor: (x: number, y?: number) => StubText;
  setDepth: (d: number) => StubText;
  setVisible: (v: boolean) => StubText;
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
    origin: { x: 0, y: 0 },
    content,
    style,
    depth: 0,
    visible: true,
    setOrigin: (ox, oy = ox) => {
      txt.origin = { x: ox, y: oy };
      return txt;
    },
    setScrollFactor: () => txt,
    setDepth: (d) => {
      txt.depth = d;
      return txt;
    },
    setVisible: (v) => {
      txt.visible = v;
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
  const rects: StubRect[] = [];
  const texts: StubText[] = [];
  return {
    rects,
    texts,
    add: {
      rectangle: (
        x: number,
        y: number,
        w: number,
        h: number,
        color: number,
        alpha = 1,
      ) => {
        const rect = makeStubRect(x, y, w, h, color, alpha);
        rects.push(rect);
        return rect;
      },
      text: (
        x: number,
        y: number,
        content: string,
        style: Record<string, unknown>,
      ) => {
        const txt = makeStubText(x, y, content, style);
        texts.push(txt);
        return txt;
      },
    },
  };
}

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

const ORIGIN = { canvasOriginX: 300, canvasOriginY: 50 };

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('SelectionHighlight — construction', () => {
  it('pre-allocates one hidden outline rect + one hidden hint text', () => {
    const scene = makeStubScene();
    new SelectionHighlight(scene, ORIGIN);
    expect(scene.rects).toHaveLength(1);
    expect(scene.texts).toHaveLength(1);
    expect(scene.rects[0]!.visible).toBe(false);
    expect(scene.texts[0]!.visible).toBe(false);
  });

  it('paints a stroke-only outline in the selection gold', () => {
    const scene = makeStubScene();
    new SelectionHighlight(scene, ORIGIN);
    const outline = scene.rects[0]!;
    expect(outline.stroke).toEqual({
      width: SELECTION_OUTLINE_STROKE_PX,
      color: SELECTION_HIGHLIGHT_COLORS.outline,
      alpha: 1,
    });
    expect(outline.fill.alpha).toBe(0);
  });

  it('seeds the hint with the [DEL] remove affordance text', () => {
    const scene = makeStubScene();
    new SelectionHighlight(scene, ORIGIN);
    expect(scene.texts[0]!.content).toBe(SELECTION_HINT_TEXT);
  });

  it('layers the hint one depth step above the outline', () => {
    const scene = makeStubScene();
    new SelectionHighlight(scene, { ...ORIGIN, depth: 40 });
    expect(scene.rects[0]!.depth).toBe(40);
    expect(scene.texts[0]!.depth).toBe(41);
  });

  it('starts with a hidden visual-state snapshot', () => {
    const scene = makeStubScene();
    const highlight = new SelectionHighlight(scene, ORIGIN);
    expect(highlight.getVisualState().visible).toBe(false);
    expect(highlight.getVisualState().pieceId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('SelectionHighlight — update', () => {
  it('positions the outline at the viewport-translated, pad-outset bounds', () => {
    const scene = makeStubScene();
    const highlight = new SelectionHighlight(scene, ORIGIN);
    const piece = makePiece(); // canvas (200, 320) 160×40
    highlight.update(piece);
    const outline = scene.rects[0]!;
    expect(outline.visible).toBe(true);
    expect(outline.position).toEqual({
      x: 300 + 200 - SELECTION_OUTLINE_PAD_PX,
      y: 50 + 320 - SELECTION_OUTLINE_PAD_PX,
    });
    expect(outline.size).toEqual({
      width: 160 + SELECTION_OUTLINE_PAD_PX * 2,
      height: 40 + SELECTION_OUTLINE_PAD_PX * 2,
    });
  });

  it('floats the hint above the piece by default', () => {
    const scene = makeStubScene();
    const highlight = new SelectionHighlight(scene, ORIGIN);
    highlight.update(makePiece());
    const hint = scene.texts[0]!;
    const state = highlight.getVisualState();
    expect(hint.visible).toBe(true);
    expect(state.hintAnchor).toBe('above');
    expect(hint.position.y).toBe(state.outlineY - SELECTION_HINT_GAP_PX);
    expect(hint.origin.y).toBe(1); // bottom-anchored so it grows upward
  });

  it('flips the hint below a piece hugging the canvas top', () => {
    const scene = makeStubScene();
    const highlight = new SelectionHighlight(scene, ORIGIN);
    highlight.update(makePiece({ canvasY: 0 }));
    const hint = scene.texts[0]!;
    const state = highlight.getVisualState();
    expect(state.hintAnchor).toBe('below');
    expect(hint.position.y).toBe(
      state.outlineY + state.outlineHeight + SELECTION_HINT_GAP_PX,
    );
    expect(hint.origin.y).toBe(0); // top-anchored so it grows downward
  });

  it('exposes the selected piece id in the visual state', () => {
    const scene = makeStubScene();
    const highlight = new SelectionHighlight(scene, ORIGIN);
    highlight.update(makePiece({ id: 'lava-zone#3' }));
    expect(highlight.getVisualState().pieceId).toBe('lava-zone#3');
  });

  it('update(null) hides both GameObjects without deallocating', () => {
    const scene = makeStubScene();
    const highlight = new SelectionHighlight(scene, ORIGIN);
    highlight.update(makePiece());
    highlight.update(null);
    expect(scene.rects[0]!.visible).toBe(false);
    expect(scene.texts[0]!.visible).toBe(false);
    expect(scene.rects).toHaveLength(1);
    expect(scene.texts).toHaveLength(1);
    expect(highlight.getVisualState().visible).toBe(false);
  });

  it('clear() is equivalent to update(null)', () => {
    const scene = makeStubScene();
    const highlight = new SelectionHighlight(scene, ORIGIN);
    highlight.update(makePiece());
    highlight.clear();
    expect(scene.rects[0]!.visible).toBe(false);
    expect(highlight.getVisualState().visible).toBe(false);
  });

  it('re-targets the existing GameObjects when the selection switches pieces', () => {
    const scene = makeStubScene();
    const highlight = new SelectionHighlight(scene, ORIGIN);
    highlight.update(makePiece({ id: 'a', canvasX: 0, canvasY: 100 }));
    highlight.update(makePiece({ id: 'b', canvasX: 400, canvasY: 200 }));
    expect(scene.rects).toHaveLength(1); // allocation-free updates
    expect(scene.rects[0]!.position.x).toBe(
      300 + 400 - SELECTION_OUTLINE_PAD_PX,
    );
    expect(highlight.getVisualState().pieceId).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// destroy
// ---------------------------------------------------------------------------

describe('SelectionHighlight — destroy', () => {
  it('releases both GameObjects', () => {
    const scene = makeStubScene();
    const highlight = new SelectionHighlight(scene, ORIGIN);
    highlight.destroy();
    expect(scene.rects[0]!.destroyed).toBe(true);
    expect(scene.texts[0]!.destroyed).toBe(true);
  });

  it('is idempotent and ignores post-destroy updates', () => {
    const scene = makeStubScene();
    const highlight = new SelectionHighlight(scene, ORIGIN);
    highlight.destroy();
    highlight.destroy();
    highlight.update(makePiece());
    expect(highlight.getVisualState().visible).toBe(false);
    expect(scene.rects[0]!.visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// selectionHintAnchor — pure flip rule
// ---------------------------------------------------------------------------

describe('selectionHintAnchor', () => {
  it('anchors above once the piece clears the flip threshold', () => {
    expect(selectionHintAnchor(SELECTION_HINT_FLIP_THRESHOLD_PX)).toBe('above');
    expect(selectionHintAnchor(500)).toBe('above');
  });

  it('flips below for pieces hugging the canvas top', () => {
    expect(selectionHintAnchor(0)).toBe('below');
    expect(selectionHintAnchor(SELECTION_HINT_FLIP_THRESHOLD_PX - 1)).toBe(
      'below',
    );
  });

  it('treats non-finite input as the safe below case', () => {
    expect(selectionHintAnchor(Number.NaN)).toBe('below');
  });
});
