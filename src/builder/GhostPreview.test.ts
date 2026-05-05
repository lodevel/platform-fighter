import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GhostPreview, GHOST_PREVIEW_COLORS } from './GhostPreview';
import { CATALOG_PIECES, findCatalogPiece } from './catalogPieces';
import type { DragGhostState } from './dragDrop';

/**
 * AC 20101 Sub-AC 1 — wiring contract for the drag-ghost preview
 * renderer.
 *
 * The component itself only `import type Phaser`, so we can construct
 * it under plain Node by handing it a structurally-typed scene shim.
 * That covers the runtime behaviour (allocate-once + per-frame
 * positioning, idempotent destroy). The static contract — colour
 * palette, default depth, paint-from-DragGhostState shape — is
 * asserted by reading the source as text where needed.
 *
 * Pattern matches `CatalogPanel.test.ts` / `CanvasArea.test.ts` so the
 * unit suite stays uniform across builder components.
 */

// ---------------------------------------------------------------------------
// Scene shim — captures every `add.*` call so tests can inspect what
// the component painted without needing a real Phaser canvas.
// ---------------------------------------------------------------------------

interface CapturedCall {
  kind: 'rectangle' | 'graphics';
  args: unknown[];
  obj: StubObject;
}

interface StubObject {
  visible: boolean;
  destroyed: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number } | null;
  fill: { color: number; alpha: number } | null;
  stroke: { width: number; color: number; alpha: number } | null;
  fillCircles: Array<{ x: number; y: number; radius: number }>;
  fillStyleCalls: Array<{ color: number; alpha: number }>;
  cleared: number;
  setOrigin: (x: number, y?: number) => StubObject;
  setScrollFactor: (x: number, y?: number) => StubObject;
  setDepth: (depth: number) => StubObject;
  setStrokeStyle: (
    width: number,
    color: number,
    alpha?: number,
  ) => StubObject;
  setFillStyle: (color: number, alpha?: number) => StubObject;
  setVisible: (v: boolean) => StubObject;
  setPosition: (x: number, y: number) => StubObject;
  setSize: (w: number, h: number) => StubObject;
  fillStyle: (color: number, alpha?: number) => StubObject;
  fillCircle: (x: number, y: number, r: number) => StubObject;
  clear: () => StubObject;
  destroy: () => void;
}

function makeStubObject(): StubObject {
  const obj: StubObject = {
    visible: true,
    destroyed: false,
    position: { x: 0, y: 0 },
    size: null,
    fill: null,
    stroke: null,
    fillCircles: [],
    fillStyleCalls: [],
    cleared: 0,
    setOrigin: () => obj,
    setScrollFactor: () => obj,
    setDepth: () => obj,
    setStrokeStyle: (width, color, alpha = 1) => {
      obj.stroke = { width, color, alpha };
      return obj;
    },
    setFillStyle: (color, alpha = 1) => {
      obj.fill = { color, alpha };
      return obj;
    },
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
    fillStyle: (color, alpha = 1) => {
      obj.fillStyleCalls.push({ color, alpha });
      return obj;
    },
    fillCircle: (x, y, r) => {
      obj.fillCircles.push({ x, y, radius: r });
      return obj;
    },
    clear: () => {
      obj.cleared += 1;
      obj.fillCircles.length = 0;
      obj.fillStyleCalls.length = 0;
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
        const [, , w, h, color, alpha] = args as [
          number,
          number,
          number,
          number,
          number,
          number,
        ];
        obj.size = { width: w, height: h };
        obj.fill = { color, alpha: alpha ?? 1 };
        return obj;
      },
      graphics: (...args: unknown[]) => {
        const obj = makeStubObject();
        captured.push({ kind: 'graphics', args, obj });
        return obj;
      },
    },
  };
  return { scene, captured };
}

function ghostStateFor(
  pieceType: string,
  overrides: Partial<DragGhostState> & {
    snap?: DragGhostState['snap'];
  } = {},
): DragGhostState {
  const piece = findCatalogPiece(pieceType)!;
  const snap =
    overrides.snap === undefined
      ? {
          col: 6,
          row: 4,
          canvasX: 240,
          canvasY: 160,
          viewportX: 480,
          viewportY: 240,
          width: piece.defaultWidth,
          height: piece.defaultHeight,
          inBounds: true,
          validation: { ok: true } as const,
          valid: true,
          invalidReason: null,
          conflictId: null,
        }
      : overrides.snap;
  return {
    pointerX: overrides.pointerX ?? 520,
    pointerY: overrides.pointerY ?? 280,
    snap,
    piece,
  };
}

// ---------------------------------------------------------------------------
// Static wiring contract — assertions over the source text.
// ---------------------------------------------------------------------------

describe('GhostPreview — AC 20101 Sub-AC 1 wiring contract', () => {
  const SRC = readFileSync(resolve(__dirname, './GhostPreview.ts'), 'utf8');

  it('imports the DragGhostState type from the controller module', () => {
    expect(SRC).toMatch(/from\s+['"]\.\/dragDrop['"]/);
    expect(SRC).toMatch(/DragGhostState/);
    expect(SRC).toMatch(/SnapTarget/);
  });

  it('imports the catalog piece type for accent colour lookup', () => {
    expect(SRC).toMatch(/from\s+['"]\.\/catalogPieces['"]/);
    expect(SRC).toMatch(/CatalogPiece/);
  });

  it('exposes a colour palette with default + out-of-bounds tints', () => {
    expect(SRC).toMatch(/GHOST_PREVIEW_COLORS/);
    expect(SRC).toMatch(/outOfBoundsBorder/);
    expect(SRC).toMatch(/outOfBoundsFill/);
    expect(SRC).toMatch(/cursorDot/);
  });

  it('takes a `DragGhostState` snapshot via update()', () => {
    expect(SRC).toMatch(/update\(\s*ghost:\s*DragGhostState\s*\|\s*null\s*\)/);
  });

  it('exposes lifecycle methods: update, clear, destroy', () => {
    expect(SRC).toMatch(/clear\(\)/);
    expect(SRC).toMatch(/destroy\(\)/);
  });

  it('does not import phaser as a value (Phaser-host pattern, type-only)', () => {
    // Phaser-host components import the type only so the unit suite
    // can drive them under plain Node without booting the engine.
    expect(SRC).toMatch(/import\s+type\s+Phaser\s+from\s+['"]phaser['"]/);
    // No bare value import.
    expect(SRC).not.toMatch(/^import\s+Phaser\s+from\s+['"]phaser['"]/m);
  });
});

// ---------------------------------------------------------------------------
// Allocation contract — pre-allocate once at construction.
// ---------------------------------------------------------------------------

describe('GhostPreview — allocation contract', () => {
  it('allocates exactly one rectangle (snap target) and one graphics (cursor dot) up-front', () => {
    const { scene, captured } = makeStubScene();
    const ghost = new GhostPreview(scene as never);

    const rectangles = captured.filter((c) => c.kind === 'rectangle');
    const graphics = captured.filter((c) => c.kind === 'graphics');
    expect(rectangles).toHaveLength(1);
    expect(graphics).toHaveLength(1);

    ghost.destroy();
  });

  it('allocates GameObjects hidden so an idle scene paints nothing', () => {
    const { scene, captured } = makeStubScene();
    const ghost = new GhostPreview(scene as never);

    expect(ghost.isVisible()).toBe(false);
    for (const c of captured) {
      expect(c.obj.visible).toBe(false);
    }

    ghost.destroy();
  });

  it('does not allocate per-update — repeated update() calls do not create new GameObjects', () => {
    const { scene, captured } = makeStubScene();
    const ghost = new GhostPreview(scene as never);
    const initialCount = captured.length;
    for (let i = 0; i < 30; i += 1) {
      ghost.update(ghostStateFor('flat-platform', { pointerX: 100 + i }));
    }
    expect(captured.length).toBe(initialCount);
    ghost.destroy();
  });
});

// ---------------------------------------------------------------------------
// Per-state visual behaviour.
// ---------------------------------------------------------------------------

describe('GhostPreview — visual states', () => {
  it('shows the snap rectangle at the snap target when in-bounds', () => {
    const { scene, captured } = makeStubScene();
    const ghost = new GhostPreview(scene as never);

    const state = ghostStateFor('flat-platform');
    ghost.update(state);

    const rect = captured.find((c) => c.kind === 'rectangle')!.obj;
    expect(rect.visible).toBe(true);
    expect(rect.position).toEqual({
      x: state.snap!.viewportX,
      y: state.snap!.viewportY,
    });
    expect(rect.size).toEqual({
      width: state.snap!.width,
      height: state.snap!.height,
    });

    ghost.destroy();
  });

  it("paints the snap rectangle in the catalog piece's accent colour when in-bounds", () => {
    const { scene, captured } = makeStubScene();
    const ghost = new GhostPreview(scene as never);

    const state = ghostStateFor('lava-zone');
    const piece = findCatalogPiece('lava-zone')!;
    ghost.update(state);

    const rect = captured.find((c) => c.kind === 'rectangle')!.obj;
    expect(rect.fill?.color).toBe(piece.accentColor);
    expect(rect.stroke?.color).toBe(piece.accentColor);

    ghost.destroy();
  });

  it('switches to the out-of-bounds palette when snap.inBounds is false', () => {
    const { scene, captured } = makeStubScene();
    const ghost = new GhostPreview(scene as never);

    const state = ghostStateFor('flat-platform');
    const oobState: DragGhostState = {
      ...state,
      snap: {
        ...state.snap!,
        inBounds: false,
        valid: false,
        invalidReason: 'out-of-bounds',
        validation: { ok: false, reason: 'out-of-bounds' },
      },
    };
    ghost.update(oobState);

    const rect = captured.find((c) => c.kind === 'rectangle')!.obj;
    expect(rect.fill?.color).toBe(GHOST_PREVIEW_COLORS.outOfBoundsFill);
    expect(rect.stroke?.color).toBe(GHOST_PREVIEW_COLORS.outOfBoundsBorder);

    ghost.destroy();
  });

  it('AC 20103 Sub-AC 3 — switches to the overlap palette when snap.invalidReason is `overlap`', () => {
    const { scene, captured } = makeStubScene();
    const ghost = new GhostPreview(scene as never);

    const state = ghostStateFor('flat-platform');
    const overlapState: DragGhostState = {
      ...state,
      snap: {
        ...state.snap!,
        valid: false,
        invalidReason: 'overlap',
        conflictId: 'flat#0',
        validation: { ok: false, reason: 'overlap', conflictId: 'flat#0' },
      },
    };
    ghost.update(overlapState);

    const rect = captured.find((c) => c.kind === 'rectangle')!.obj;
    expect(rect.fill?.color).toBe(GHOST_PREVIEW_COLORS.overlapFill);
    expect(rect.stroke?.color).toBe(GHOST_PREVIEW_COLORS.overlapBorder);

    ghost.destroy();
  });

  it('AC 20103 Sub-AC 3 — switches to the hazard-warning palette for hazard-near-spawn rejections', () => {
    const { scene, captured } = makeStubScene();
    const ghost = new GhostPreview(scene as never);

    const state = ghostStateFor('lava-zone');
    const hazardState: DragGhostState = {
      ...state,
      snap: {
        ...state.snap!,
        valid: false,
        invalidReason: 'hazard-near-spawn',
        conflictId: 'spawn#0',
        validation: {
          ok: false,
          reason: 'hazard-near-spawn',
          conflictId: 'spawn#0',
        },
      },
    };
    ghost.update(hazardState);

    const rect = captured.find((c) => c.kind === 'rectangle')!.obj;
    expect(rect.fill?.color).toBe(GHOST_PREVIEW_COLORS.hazardWarningFill);
    expect(rect.stroke?.color).toBe(GHOST_PREVIEW_COLORS.hazardWarningBorder);

    ghost.destroy();
  });

  it('AC 20103 Sub-AC 3 — out-of-bounds, overlap, and hazard tints are all distinct hues', () => {
    // Visual-feedback contract: each invalid-drop reason has its own
    // tint so the player can read the rule from the colour alone.
    expect(GHOST_PREVIEW_COLORS.outOfBoundsFill).not.toBe(
      GHOST_PREVIEW_COLORS.overlapFill,
    );
    expect(GHOST_PREVIEW_COLORS.outOfBoundsFill).not.toBe(
      GHOST_PREVIEW_COLORS.hazardWarningFill,
    );
    expect(GHOST_PREVIEW_COLORS.overlapFill).not.toBe(
      GHOST_PREVIEW_COLORS.hazardWarningFill,
    );
  });

  it('hides the snap rectangle when snap is null but keeps the cursor dot visible', () => {
    const { scene, captured } = makeStubScene();
    const ghost = new GhostPreview(scene as never);

    // Snap === null happens when the pointer is over the catalog panel:
    // the controller has no valid grid target but the player is still
    // carrying the piece, so the cursor dot stays visible.
    const state: DragGhostState = {
      pointerX: 80,
      pointerY: 120,
      snap: null,
      piece: findCatalogPiece('wall')!,
    };
    ghost.update(state);

    const rect = captured.find((c) => c.kind === 'rectangle')!.obj;
    const dot = captured.find((c) => c.kind === 'graphics')!.obj;
    expect(rect.visible).toBe(false);
    expect(dot.visible).toBe(true);
    expect(dot.fillCircles.at(-1)).toEqual({ x: 80, y: 120, radius: 6 });

    ghost.destroy();
  });

  it('paints the cursor dot at the pointer position regardless of snap', () => {
    const { scene, captured } = makeStubScene();
    const ghost = new GhostPreview(scene as never);

    ghost.update(
      ghostStateFor('moving-platform', {
        pointerX: 333,
        pointerY: 444,
      }),
    );

    const dot = captured.find((c) => c.kind === 'graphics')!.obj;
    const last = dot.fillCircles.at(-1)!;
    expect(last.x).toBe(333);
    expect(last.y).toBe(444);
  });

  it('redraws the cursor dot on every update (clears previous strokes)', () => {
    const { scene, captured } = makeStubScene();
    const ghost = new GhostPreview(scene as never);

    ghost.update(ghostStateFor('flat-platform', { pointerX: 10, pointerY: 10 }));
    ghost.update(ghostStateFor('flat-platform', { pointerX: 20, pointerY: 20 }));
    ghost.update(ghostStateFor('flat-platform', { pointerX: 30, pointerY: 30 }));

    const dot = captured.find((c) => c.kind === 'graphics')!.obj;
    // One clear() per update.
    expect(dot.cleared).toBeGreaterThanOrEqual(3);
    // Last paint position matches the last update.
    expect(dot.fillCircles.at(-1)).toMatchObject({ x: 30, y: 30 });
  });
});

// ---------------------------------------------------------------------------
// Idle / clear lifecycle.
// ---------------------------------------------------------------------------

describe('GhostPreview — clear / idle behaviour', () => {
  it('update(null) hides every overlay', () => {
    const { scene, captured } = makeStubScene();
    const ghost = new GhostPreview(scene as never);

    ghost.update(ghostStateFor('flat-platform'));
    ghost.update(null);

    const rect = captured.find((c) => c.kind === 'rectangle')!.obj;
    const dot = captured.find((c) => c.kind === 'graphics')!.obj;
    expect(rect.visible).toBe(false);
    expect(dot.visible).toBe(false);
    expect(ghost.isVisible()).toBe(false);

    ghost.destroy();
  });

  it('clear() is idempotent', () => {
    const { scene } = makeStubScene();
    const ghost = new GhostPreview(scene as never);
    ghost.clear();
    ghost.clear();
    expect(ghost.isVisible()).toBe(false);
    ghost.destroy();
  });

  it('getVisualState() reflects the latest update payload', () => {
    const { scene } = makeStubScene();
    const ghost = new GhostPreview(scene as never);

    expect(ghost.getVisualState().visible).toBe(false);
    ghost.update(ghostStateFor('spawn-point', { pointerX: 50, pointerY: 60 }));
    const state = ghost.getVisualState();
    expect(state.visible).toBe(true);
    expect(state.piece?.type).toBe('spawn-point');
    expect(state.pointerX).toBe(50);
    expect(state.pointerY).toBe(60);

    ghost.destroy();
  });
});

// ---------------------------------------------------------------------------
// Destroy contract.
// ---------------------------------------------------------------------------

describe('GhostPreview — destroy contract', () => {
  it('destroys both pre-allocated GameObjects', () => {
    const { scene, captured } = makeStubScene();
    const ghost = new GhostPreview(scene as never);
    ghost.destroy();

    for (const c of captured) {
      expect(c.obj.destroyed).toBe(true);
    }
  });

  it('destroy() is idempotent', () => {
    const { scene } = makeStubScene();
    const ghost = new GhostPreview(scene as never);
    ghost.destroy();
    // Second call must be a no-op.
    expect(() => ghost.destroy()).not.toThrow();
  });

  it('update() after destroy() is a no-op (defensive)', () => {
    const { scene } = makeStubScene();
    const ghost = new GhostPreview(scene as never);
    ghost.destroy();
    expect(() => ghost.update(ghostStateFor('wall'))).not.toThrow();
    expect(ghost.isVisible()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// All catalog pieces are paintable — sanity guard so a future catalog
// piece addition doesn't slip through without ghost coverage.
// ---------------------------------------------------------------------------

describe('GhostPreview — catalog coverage', () => {
  it('renders every catalog piece type without throwing', () => {
    const { scene } = makeStubScene();
    const ghost = new GhostPreview(scene as never);
    for (const piece of CATALOG_PIECES) {
      expect(() => ghost.update(ghostStateFor(piece.type))).not.toThrow();
      const state = ghost.getVisualState();
      expect(state.piece?.type).toBe(piece.type);
    }
    ghost.destroy();
  });
});
