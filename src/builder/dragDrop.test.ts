import { describe, it, expect } from 'vitest';
import {
  DragDropController,
  computeSnapTarget,
  findCatalogHitAt,
  isPieceInCanvasBounds,
  viewportToCanvas,
  type DragDropOptions,
} from './dragDrop';
import {
  CATALOG_PIECES,
  findCatalogPiece,
} from './catalogPieces';
import { DEFAULT_GRID_SPEC } from './builderGrid';
import type { CatalogRowHitRect } from './CatalogPanel';
import type { RegisteredCandidate } from './placementValidation';

/**
 * AC 20101 Sub-AC 1 — drag-drop state machine.
 *
 * The controller is Phaser-free pure logic so the unit suite drives
 * every branch under plain Node. These tests guard:
 *
 *   • drag initiation (`pointerDown`) starts a drag iff the pointer is
 *     over a catalog row;
 *   • the in-flight drag exposes a coherent `DragGhostState` for the
 *     `GhostPreview` host to render;
 *   • snapping uses the canonical `snapToGrid` so what the player sees
 *     is what the placement validator consumes;
 *   • lifecycle paths (cancel, options update) preserve invariants.
 *
 * `pointerUp` placement and bounds-rejection logic land in later sub-ACs;
 * Sub-AC 1 only covers initiation + ghost-state visibility.
 */

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Build a synthetic stack of catalog hit-rects matching the canonical
 * panel layout. Rectangles share an X column on the left edge and stack
 * top-to-bottom — the same shape `CatalogPanel.getRowHitRects()` emits.
 */
function makeCatalogRects(): CatalogRowHitRect[] {
  const rects: CatalogRowHitRect[] = [];
  const rowH = 92;
  const startY = 120; // header + margin
  for (let i = 0; i < CATALOG_PIECES.length; i += 1) {
    const piece = CATALOG_PIECES[i]!;
    rects.push({
      type: piece.type,
      index: i,
      piece,
      x: 16,
      y: startY + i * rowH,
      width: 240,
      height: rowH,
    });
  }
  return rects;
}

function makeOptions(
  overrides: Partial<DragDropOptions> = {},
): DragDropOptions {
  return {
    gridSpec: DEFAULT_GRID_SPEC,
    canvasOriginX: 320,
    canvasOriginY: 80,
    catalogHitRects: makeCatalogRects(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('dragDrop — pure helpers', () => {
  it('findCatalogHitAt returns the row containing the pointer', () => {
    const rects = makeCatalogRects();
    const target = rects[3]!;
    const hit = findCatalogHitAt(rects, target.x + 5, target.y + 5);
    expect(hit?.type).toBe(target.type);
  });

  it('findCatalogHitAt returns null when the pointer misses every row', () => {
    const rects = makeCatalogRects();
    expect(findCatalogHitAt(rects, 10000, 10000)).toBeNull();
    expect(findCatalogHitAt(rects, 0, 0)).toBeNull();
  });

  it('findCatalogHitAt is exclusive on the bottom/right edge', () => {
    const rects = makeCatalogRects();
    const target = rects[0]!;
    const onTopLeft = findCatalogHitAt(rects, target.x, target.y);
    const onBottomRight = findCatalogHitAt(
      rects,
      target.x + target.width,
      target.y + target.height,
    );
    expect(onTopLeft?.type).toBe(target.type);
    // Bottom-right should belong to the next row (or null if past last).
    expect(onBottomRight?.type).not.toBe(target.type);
  });

  it('findCatalogHitAt rejects non-finite coords', () => {
    const rects = makeCatalogRects();
    expect(findCatalogHitAt(rects, Number.NaN, 0)).toBeNull();
    expect(findCatalogHitAt(rects, 0, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('viewportToCanvas subtracts the canvas origin', () => {
    expect(viewportToCanvas(500, 400, 100, 50)).toEqual({ x: 400, y: 350 });
  });

  it('viewportToCanvas treats non-finite inputs as zero', () => {
    expect(viewportToCanvas(Number.NaN, 0, 100, 50)).toEqual({ x: -100, y: -50 });
  });

  it('isPieceInCanvasBounds accepts pieces fully inside the canvas', () => {
    expect(isPieceInCanvasBounds(0, 0, 160, 40)).toBe(true);
    expect(isPieceInCanvasBounds(40, 80, 160, 40)).toBe(true);
  });

  it('isPieceInCanvasBounds rejects pieces with negative origin', () => {
    expect(isPieceInCanvasBounds(-1, 0, 160, 40)).toBe(false);
    expect(isPieceInCanvasBounds(0, -1, 160, 40)).toBe(false);
  });

  it('isPieceInCanvasBounds rejects pieces clipping the right/bottom edge', () => {
    const spec = DEFAULT_GRID_SPEC;
    expect(isPieceInCanvasBounds(spec.width - 80, 0, 160, 40, spec)).toBe(false);
    expect(isPieceInCanvasBounds(0, spec.height - 20, 160, 40, spec)).toBe(false);
  });

  it('isPieceInCanvasBounds rejects degenerate / non-finite dimensions', () => {
    expect(isPieceInCanvasBounds(0, 0, 0, 40)).toBe(false);
    expect(isPieceInCanvasBounds(0, 0, 160, 0)).toBe(false);
    expect(isPieceInCanvasBounds(Number.NaN, 0, 160, 40)).toBe(false);
  });

  it('computeSnapTarget centres the piece on the snapped grid intersection', () => {
    const piece = findCatalogPiece('flat-platform')!;
    const opts = makeOptions();
    // Pointer at viewport (320 + 200, 80 + 200) = (520, 280) — canvas
    // (200, 200). Default cell size = 40px → snaps to (200, 200).
    const target = computeSnapTarget(520, 280, piece, opts);
    expect(target.canvasX).toBe(200 - piece.defaultWidth / 2);
    expect(target.canvasY).toBe(200 - piece.defaultHeight / 2);
    expect(target.viewportX).toBe(target.canvasX + opts.canvasOriginX);
    expect(target.viewportY).toBe(target.canvasY + opts.canvasOriginY);
    expect(target.width).toBe(piece.defaultWidth);
    expect(target.height).toBe(piece.defaultHeight);
    expect(target.inBounds).toBe(true);
  });

  it('computeSnapTarget flags out-of-bounds when the centred footprint clips the canvas', () => {
    const piece = findCatalogPiece('lava-zone')!;
    const opts = makeOptions();
    // Pointer at the far right of the canvas — the centred footprint
    // overhangs the right edge.
    const target = computeSnapTarget(
      opts.canvasOriginX + opts.gridSpec.width - 10,
      opts.canvasOriginY + 100,
      piece,
      opts,
    );
    expect(target.inBounds).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DragDropController — drag initiation (Sub-AC 1)
// ---------------------------------------------------------------------------

describe('DragDropController — initial state', () => {
  it('starts idle with no piece in hand', () => {
    const dnd = new DragDropController(makeOptions());
    expect(dnd.getPhase()).toBe('idle');
    expect(dnd.getDraggedPiece()).toBeNull();
    expect(dnd.getGhostState()).toBeNull();
  });
});

describe('DragDropController — drag initiation', () => {
  it('pointerDown over a catalog row transitions to dragging and returns the picked piece', () => {
    const opts = makeOptions();
    const dnd = new DragDropController(opts);
    const row = opts.catalogHitRects[2]!;
    const picked = dnd.pointerDown(row.x + 10, row.y + 10);
    expect(picked?.type).toBe(row.type);
    expect(dnd.getPhase()).toBe('dragging');
    expect(dnd.getDraggedPiece()?.type).toBe(row.type);
  });

  it('pointerDown that misses the catalog stays idle and returns null', () => {
    const dnd = new DragDropController(makeOptions());
    expect(dnd.pointerDown(2000, 2000)).toBeNull();
    expect(dnd.getPhase()).toBe('idle');
    expect(dnd.getDraggedPiece()).toBeNull();
  });

  it('pointerDown is a no-op while a drag is already active', () => {
    const opts = makeOptions();
    const dnd = new DragDropController(opts);
    const first = opts.catalogHitRects[0]!;
    const second = opts.catalogHitRects[5]!;
    dnd.pointerDown(first.x + 5, first.y + 5);
    const repick = dnd.pointerDown(second.x + 5, second.y + 5);
    expect(repick).toBeNull();
    // First piece is still the one in hand.
    expect(dnd.getDraggedPiece()?.type).toBe(first.type);
  });

  it('pointerDown over each catalog row produces a unique piece in hand', () => {
    const opts = makeOptions();
    for (const row of opts.catalogHitRects) {
      const dnd = new DragDropController(opts);
      const picked = dnd.pointerDown(row.x + 5, row.y + 5);
      expect(picked?.type).toBe(row.type);
    }
  });
});

// ---------------------------------------------------------------------------
// Ghost-state contract — the GhostPreview component drives off this.
// ---------------------------------------------------------------------------

describe('DragDropController — ghost-state for the renderer', () => {
  it('returns null while idle so the ghost paints nothing', () => {
    const dnd = new DragDropController(makeOptions());
    expect(dnd.getGhostState()).toBeNull();
  });

  it('returns a ghost state with snap target while pointer is over the canvas', () => {
    const opts = makeOptions();
    const dnd = new DragDropController(opts);
    const row = opts.catalogHitRects[0]!;
    dnd.pointerDown(row.x + 5, row.y + 5);

    // Move pointer onto the canvas.
    dnd.pointerMove(opts.canvasOriginX + 200, opts.canvasOriginY + 160);
    const ghost = dnd.getGhostState();
    expect(ghost).not.toBeNull();
    expect(ghost!.piece.type).toBe(row.type);
    expect(ghost!.snap).not.toBeNull();
    expect(ghost!.snap!.inBounds).toBe(true);
  });

  it('returns ghost state with snap=null while pointer is over the catalog (cancel zone)', () => {
    const opts = makeOptions();
    const dnd = new DragDropController(opts);
    const row = opts.catalogHitRects[0]!;
    dnd.pointerDown(row.x + 5, row.y + 5);

    // Move pointer to a different catalog row — still over the panel.
    const otherRow = opts.catalogHitRects[4]!;
    dnd.pointerMove(otherRow.x + 10, otherRow.y + 10);
    const ghost = dnd.getGhostState();
    expect(ghost).not.toBeNull();
    expect(ghost!.snap).toBeNull();
    expect(ghost!.pointerX).toBe(otherRow.x + 10);
    expect(ghost!.pointerY).toBe(otherRow.y + 10);
  });

  it('reports raw pointer coordinates so the host can paint a carry sprite', () => {
    const opts = makeOptions();
    const dnd = new DragDropController(opts);
    const row = opts.catalogHitRects[1]!;
    dnd.pointerDown(row.x + 5, row.y + 5);
    dnd.pointerMove(777, 444);
    const ghost = dnd.getGhostState()!;
    expect(ghost.pointerX).toBe(777);
    expect(ghost.pointerY).toBe(444);
  });

  it('flags the snap target out-of-bounds when the centred footprint clips the canvas', () => {
    const opts = makeOptions();
    const dnd = new DragDropController(opts);
    const row = opts.catalogHitRects.find((r) => r.type === 'lava-zone')!;
    dnd.pointerDown(row.x + 5, row.y + 5);

    // Pointer near the right edge of the canvas — the lava-zone (200×80)
    // centred here overhangs the right boundary.
    dnd.pointerMove(opts.canvasOriginX + opts.gridSpec.width - 10, opts.canvasOriginY + 100);
    const ghost = dnd.getGhostState()!;
    expect(ghost.snap).not.toBeNull();
    expect(ghost.snap!.inBounds).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cancel + lifecycle.
// ---------------------------------------------------------------------------

describe('DragDropController — cancel + options update', () => {
  it('cancel() returns the controller to idle and drops the ghost state', () => {
    const opts = makeOptions();
    const dnd = new DragDropController(opts);
    const row = opts.catalogHitRects[0]!;
    dnd.pointerDown(row.x + 5, row.y + 5);
    expect(dnd.getPhase()).toBe('dragging');
    dnd.cancel();
    expect(dnd.getPhase()).toBe('idle');
    expect(dnd.getDraggedPiece()).toBeNull();
    expect(dnd.getGhostState()).toBeNull();
  });

  it('cancel() while idle is a no-op', () => {
    const dnd = new DragDropController(makeOptions());
    expect(() => dnd.cancel()).not.toThrow();
    expect(dnd.getPhase()).toBe('idle');
  });

  it('updateOptions preserves an in-flight drag while picking up the new options', () => {
    const opts = makeOptions();
    const dnd = new DragDropController(opts);
    const row = opts.catalogHitRects[2]!;
    dnd.pointerDown(row.x + 5, row.y + 5);
    dnd.pointerMove(opts.canvasOriginX + 100, opts.canvasOriginY + 100);

    dnd.updateOptions({ canvasOriginX: 500 });
    expect(dnd.getOptions().canvasOriginX).toBe(500);
    // Drag is still active.
    expect(dnd.getPhase()).toBe('dragging');
    expect(dnd.getDraggedPiece()?.type).toBe(row.type);
  });
});

// ---------------------------------------------------------------------------
// AC 20103 Sub-AC 3 — placement validation in the snap target.
// ---------------------------------------------------------------------------

describe('SnapTarget placement validation (AC 20103 Sub-AC 3)', () => {
  it('flags a clean drop as `valid: true` with `invalidReason: null`', () => {
    const piece = findCatalogPiece('flat-platform')!;
    const opts = makeOptions();
    const target = computeSnapTarget(
      opts.canvasOriginX + 200,
      opts.canvasOriginY + 200,
      piece,
      opts,
    );
    expect(target.valid).toBe(true);
    expect(target.invalidReason).toBeNull();
    expect(target.conflictId).toBeNull();
    expect(target.validation.ok).toBe(true);
  });

  it('flags an out-of-bounds drop with `invalidReason: out-of-bounds`', () => {
    const piece = findCatalogPiece('lava-zone')!;
    const opts = makeOptions();
    const target = computeSnapTarget(
      opts.canvasOriginX + opts.gridSpec.width - 10,
      opts.canvasOriginY + 100,
      piece,
      opts,
    );
    expect(target.valid).toBe(false);
    expect(target.invalidReason).toBe('out-of-bounds');
  });

  it('flags an overlapping drop with `invalidReason: overlap` and surfaces the conflict id', () => {
    const piece = findCatalogPiece('flat-platform')!;
    const registry: RegisteredCandidate[] = [
      {
        id: 'flat#0',
        type: 'flat-platform',
        canvasX: 200,
        canvasY: 200,
        width: 160,
        height: 40,
      },
    ];
    const opts = makeOptions({ getPlacedPieces: () => registry });
    const target = computeSnapTarget(
      opts.canvasOriginX + 280,
      opts.canvasOriginY + 220,
      piece,
      opts,
    );
    expect(target.valid).toBe(false);
    expect(target.invalidReason).toBe('overlap');
    expect(target.conflictId).toBe('flat#0');
  });

  it('flags a hazard-near-spawn drop with `invalidReason: hazard-near-spawn`', () => {
    const piece = findCatalogPiece('lava-zone')!;
    const registry: RegisteredCandidate[] = [
      {
        id: 'spawn#0',
        type: 'spawn-point',
        canvasX: 400,
        canvasY: 200,
        width: 40,
        height: 40,
      },
    ];
    const opts = makeOptions({ getPlacedPieces: () => registry });
    // Place lava close to the spawn so the buffer fires.
    const target = computeSnapTarget(
      opts.canvasOriginX + 380,
      opts.canvasOriginY + 220,
      piece,
      opts,
    );
    expect(target.valid).toBe(false);
    expect(target.invalidReason).toBe('hazard-near-spawn');
    expect(target.conflictId).toBe('spawn#0');
  });

  it('without a getPlacedPieces source the validation degrades to bounds + sanity (Sub-AC 1 contract)', () => {
    // The original Sub-AC 1 call shape (no registry source) keeps
    // working — `valid` mirrors `inBounds` for in-bounds drops.
    const piece = findCatalogPiece('flat-platform')!;
    const opts = makeOptions();
    const target = computeSnapTarget(
      opts.canvasOriginX + 200,
      opts.canvasOriginY + 200,
      piece,
      opts,
    );
    expect(target.valid).toBe(true);
    expect(target.inBounds).toBe(true);
  });
});

describe('DragDropController.pointerUp — placement validation gating (AC 20103 Sub-AC 3)', () => {
  it('rejects an overlapping drop and resets to idle', () => {
    const registry: RegisteredCandidate[] = [
      {
        id: 'flat#0',
        type: 'flat-platform',
        canvasX: 200,
        canvasY: 200,
        width: 160,
        height: 40,
      },
    ];
    const opts = makeOptions({ getPlacedPieces: () => registry });
    const dnd = new DragDropController(opts);
    const row = opts.catalogHitRects.find((r) => r.type === 'flat-platform')!;
    dnd.pointerDown(row.x + 5, row.y + 5);
    const placed = dnd.pointerUp(
      opts.canvasOriginX + 280,
      opts.canvasOriginY + 220,
    );
    expect(placed).toBeNull();
    expect(dnd.getPhase()).toBe('idle');
  });

  it('rejects a hazard-near-spawn drop', () => {
    const registry: RegisteredCandidate[] = [
      {
        id: 'spawn#0',
        type: 'spawn-point',
        canvasX: 400,
        canvasY: 200,
        width: 40,
        height: 40,
      },
    ];
    const opts = makeOptions({ getPlacedPieces: () => registry });
    const dnd = new DragDropController(opts);
    const row = opts.catalogHitRects.find((r) => r.type === 'lava-zone')!;
    dnd.pointerDown(row.x + 5, row.y + 5);
    const placed = dnd.pointerUp(
      opts.canvasOriginX + 380,
      opts.canvasOriginY + 220,
    );
    expect(placed).toBeNull();
  });

  it('still accepts a clean drop when a registry source is wired in', () => {
    const registry: RegisteredCandidate[] = [
      {
        id: 'flat#0',
        type: 'flat-platform',
        canvasX: 0,
        canvasY: 0,
        width: 160,
        height: 40,
      },
    ];
    const opts = makeOptions({ getPlacedPieces: () => registry });
    const dnd = new DragDropController(opts);
    const row = opts.catalogHitRects.find((r) => r.type === 'flat-platform')!;
    dnd.pointerDown(row.x + 5, row.y + 5);
    const placed = dnd.pointerUp(
      opts.canvasOriginX + 800,
      opts.canvasOriginY + 400,
    );
    expect(placed).not.toBeNull();
    expect(placed!.type).toBe('flat-platform');
  });
});

// ---------------------------------------------------------------------------
// Determinism guard — same inputs produce identical ghost state.
// ---------------------------------------------------------------------------

describe('DragDropController — determinism', () => {
  it('two controllers driven with identical inputs produce identical ghost state', () => {
    const opts = makeOptions();
    const a = new DragDropController(opts);
    const b = new DragDropController(opts);
    const row = opts.catalogHitRects[3]!;
    const moves: Array<[number, number]> = [
      [row.x + 5, row.y + 5],
      [opts.canvasOriginX + 50, opts.canvasOriginY + 60],
      [opts.canvasOriginX + 200, opts.canvasOriginY + 160],
      [opts.canvasOriginX + 400, opts.canvasOriginY + 240],
    ];
    a.pointerDown(...moves[0]!);
    b.pointerDown(...moves[0]!);
    for (let i = 1; i < moves.length; i += 1) {
      a.pointerMove(...moves[i]!);
      b.pointerMove(...moves[i]!);
      expect(a.getGhostState()).toEqual(b.getGhostState());
    }
  });
});
