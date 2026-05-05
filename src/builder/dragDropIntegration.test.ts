import { describe, it, expect } from 'vitest';
import {
  DragDropController,
  type DragDropOptions,
  type PlacedPiece,
} from './dragDrop';
import {
  CATALOG_PIECES,
  findCatalogPiece,
  type CatalogPiece,
} from './catalogPieces';
import { DEFAULT_GRID_SPEC } from './builderGrid';
import { StageDataModel, STAGE_PIECE_LIMIT } from './stageDataModel';
import type { CatalogRowHitRect } from './CatalogPanel';
import type { RegisteredPiece } from './stageDataModel';

/**
 * AC 20003 Sub-AC 3 — "Implement drag-and-drop interaction system to
 * place selected palette pieces onto grid canvas cells with placement
 * validation and piece data tracking".
 *
 * Earlier sub-ACs landed each piece of the pipeline in isolation:
 *
 *   • AC 20101 Sub-AC 1 — `DragDropController` (state machine + snap
 *     target).
 *   • AC 20102 Sub-AC 2 — `StageDataModel` (registry + listeners + cap).
 *   • AC 20103 Sub-AC 3 — `validatePlacement` (bounds + overlap +
 *     hazard-near-spawn rules), wired through both surfaces.
 *
 * This file is the *integration* contract: it drives the three modules
 * end-to-end as the `StageBuilderScene` wires them, and proves the AC's
 * three-part deliverable holds as one cohesive system:
 *
 *   1. **Drag-and-drop interaction** — pointer-down on a catalog row
 *      transitions to dragging; pointer-move surfaces a snap target;
 *      pointer-up emits a `PlacedPiece` (or `null` for cancel paths).
 *   2. **Placement validation** — every rejection reason (bounds,
 *      overlap, hazard-near-spawn) suppresses both the controller's
 *      `pointerUp` payload AND the registry's `addPiece` so a stale /
 *      corrupted call site can never sneak an invalid piece in.
 *   3. **Piece data tracking** — accepted drops land in the registry,
 *      the listener fires once per mutation, and the 30-piece cap is
 *      respected across the integrated pipeline.
 *
 * Determinism note: every helper here is a pure function of inputs.
 * No `Math.random()`, no wall-clock reads — a replay that records the
 * pointer event stream produces byte-identical registry state.
 */

// ---------------------------------------------------------------------------
// Test fixtures — reproduce the StageBuilderScene's wiring without Phaser.
// ---------------------------------------------------------------------------

/** Canvas origin (where the canvas's top-left lives in viewport space). */
const CANVAS_ORIGIN_X = 320;
const CANVAS_ORIGIN_Y = 80;

/**
 * Build a synthetic stack of catalog hit-rects matching the canonical
 * panel layout — same shape `CatalogPanel.getRowHitRects()` emits.
 */
function makeCatalogRects(): CatalogRowHitRect[] {
  const rects: CatalogRowHitRect[] = [];
  const rowH = 92;
  const startY = 120;
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

/**
 * Wires the controller + the data-model exactly the way
 * `StageBuilderScene.create()` does, including the `getPlacedPieces`
 * registry source the validator consumes during in-flight ghost state.
 */
function buildPipeline(): {
  readonly controller: DragDropController;
  readonly model: StageDataModel;
  readonly options: DragDropOptions;
  readonly notifications: ReadonlyArray<RegisteredPiece>[];
} {
  const model = new StageDataModel({ gridSpec: DEFAULT_GRID_SPEC });
  const notifications: ReadonlyArray<RegisteredPiece>[] = [];
  model.addListener((pieces) => {
    // Snapshot the live roster (defensive copy) so subsequent mutations
    // don't retro-edit prior recorded events.
    notifications.push([...pieces]);
  });
  const options: DragDropOptions = {
    gridSpec: DEFAULT_GRID_SPEC,
    canvasOriginX: CANVAS_ORIGIN_X,
    canvasOriginY: CANVAS_ORIGIN_Y,
    catalogHitRects: makeCatalogRects(),
    // Same closure shape the scene uses — read at call time so the
    // controller always sees the current registry.
    getPlacedPieces: () => model.getRegisteredCandidates(),
  };
  const controller = new DragDropController(options);
  return { controller, model, options, notifications };
}

/** Centre point of the first catalog row for the given piece. */
function catalogRowCentre(rects: ReadonlyArray<CatalogRowHitRect>, piece: CatalogPiece): {
  readonly x: number;
  readonly y: number;
} {
  const hit = rects.find((r) => r.type === piece.type);
  if (!hit) throw new Error(`no catalog rect for ${piece.type}`);
  return {
    x: hit.x + hit.width / 2,
    y: hit.y + hit.height / 2,
  };
}

/**
 * Convert a *canvas-local* (centre) drop point in design pixels into a
 * viewport-space coordinate the controller's pointer handlers consume.
 */
function canvasCentreToViewport(canvasCx: number, canvasCy: number): {
  readonly x: number;
  readonly y: number;
} {
  return {
    x: canvasCx + CANVAS_ORIGIN_X,
    y: canvasCy + CANVAS_ORIGIN_Y,
  };
}

/**
 * Drive the whole gesture (down on catalog → move on canvas → up on
 * canvas) and return the registry result. Mirrors the
 * `StageBuilderScene` pointer-event wiring exactly:
 *
 *   pointerdown (catalog) → controller.pointerDown(...)
 *   pointermove  (canvas) → controller.pointerMove(...)
 *   pointerup    (canvas) → controller.pointerUp(...) → model.addPiece(...)
 */
function performDrop(
  pipeline: ReturnType<typeof buildPipeline>,
  pieceType: CatalogPiece['type'],
  canvasCx: number,
  canvasCy: number,
): {
  readonly placed: PlacedPiece | null;
  readonly registryResult:
    | { ok: true; piece: RegisteredPiece }
    | { ok: false; reason: string }
    | null;
} {
  const { controller, model, options } = pipeline;
  const piece = findCatalogPiece(pieceType);
  if (!piece) throw new Error(`unknown piece ${pieceType}`);
  const start = catalogRowCentre(options.catalogHitRects, piece);
  const drop = canvasCentreToViewport(canvasCx, canvasCy);
  controller.pointerDown(start.x, start.y);
  controller.pointerMove(drop.x, drop.y);
  const placed = controller.pointerUp(drop.x, drop.y);
  let registryResult:
    | { ok: true; piece: RegisteredPiece }
    | { ok: false; reason: string }
    | null = null;
  if (placed) {
    const result = model.addPiece(placed);
    registryResult = result.ok
      ? { ok: true, piece: result.piece }
      : { ok: false, reason: result.reason };
  }
  return { placed, registryResult };
}

// ---------------------------------------------------------------------------
// Pipeline integration — the AC's three deliverables, end to end.
// ---------------------------------------------------------------------------

describe('AC 20003 Sub-AC 3 — drag-drop / validation / data-tracking pipeline', () => {
  describe('valid drop end-to-end', () => {
    it('routes a successful drag from catalog to registered piece', () => {
      const pipe = buildPipeline();
      const { placed, registryResult } = performDrop(
        pipe,
        'flat-platform',
        DEFAULT_GRID_SPEC.width / 2,
        DEFAULT_GRID_SPEC.height / 2,
      );
      // 1. The controller emitted a placement payload (drag-and-drop
      //    interaction worked).
      expect(placed).not.toBeNull();
      expect(placed!.type).toBe('flat-platform');
      // 2. The placement validator accepted it (bounds + overlap +
      //    hazard-near-spawn all green).
      // 3. The registry tracked it (piece data tracking).
      expect(registryResult).not.toBeNull();
      expect(registryResult!.ok).toBe(true);
      if (registryResult!.ok) {
        expect(registryResult!.piece.type).toBe('flat-platform');
        expect(registryResult!.piece.id).toBe('flat-platform#0');
        expect(registryResult!.piece.insertionIndex).toBe(0);
      }
      // The model's roster reflects the registered piece.
      expect(pipe.model.getPieces()).toHaveLength(1);
    });

    it('snaps the placed piece to grid and records the snapped coords', () => {
      const pipe = buildPipeline();
      // Pick an off-grid drop point — the snapping math must round the
      // piece onto the nearest cell intersection.
      const piece = findCatalogPiece('flat-platform')!;
      const cell = DEFAULT_GRID_SPEC.cellPx;
      // Drop the cursor at a non-cell-aligned point near (cell*5, cell*3).
      const offX = cell * 5 + 7;
      const offY = cell * 3 + 11;
      const { placed } = performDrop(pipe, 'flat-platform', offX, offY);
      expect(placed).not.toBeNull();
      // The piece's centre should snap to a grid intersection — i.e.
      // (canvasX + width/2) and (canvasY + height/2) must be a
      // multiple of cellSize.
      const centreX = placed!.canvasX + placed!.width / 2;
      const centreY = placed!.canvasY + placed!.height / 2;
      expect(centreX % cell).toBe(0);
      expect(centreY % cell).toBe(0);
      // Piece footprint matches the catalog default size.
      expect(placed!.width).toBe(piece.defaultWidth);
      expect(placed!.height).toBe(piece.defaultHeight);
    });

    it('fires the listener exactly once per accepted drop', () => {
      const pipe = buildPipeline();
      performDrop(pipe, 'flat-platform', 200, 200);
      performDrop(pipe, 'flat-platform', 600, 600);
      // Two accepted drops → two notifications (one per registry
      // mutation), with the live roster lengthening on each.
      expect(pipe.notifications).toHaveLength(2);
      expect(pipe.notifications[0]!).toHaveLength(1);
      expect(pipe.notifications[1]!).toHaveLength(2);
    });

    it('routes drops of every catalog piece type into the registry', () => {
      const pipe = buildPipeline();
      // Place each of the 8 piece types at non-overlapping spots so
      // every catalog row is exercised through the full pipeline.
      // We lay them out on a coarse 4×2 grid of widely-spaced anchors.
      const anchors: Array<{ x: number; y: number }> = [
        { x: 200, y: 200 },
        { x: 600, y: 200 },
        { x: 1000, y: 200 },
        { x: 1400, y: 200 },
        { x: 200, y: 600 },
        { x: 600, y: 600 },
        { x: 1000, y: 600 },
        { x: 1400, y: 600 },
      ];
      const types = CATALOG_PIECES.map((p) => p.type);
      for (let i = 0; i < types.length; i += 1) {
        const a = anchors[i]!;
        // Skip the spawn-point + hazard pairs that would intentionally
        // trip the hazard-near-spawn rule (anchors are spaced > 1 cell
        // apart but a hazard's exclusion zone reaches further). Drop
        // them at well-separated anchors to keep the pipeline green.
        performDrop(pipe, types[i]!, a.x, a.y);
      }
      // Every type should be represented in the registry.
      const registered = pipe.model.getPieces();
      expect(registered).toHaveLength(types.length);
      const registeredTypes = new Set(registered.map((p) => p.type));
      for (const t of types) {
        expect(registeredTypes.has(t)).toBe(true);
      }
    });
  });

  describe('placement validation suppresses the registry', () => {
    it('rejects out-of-bounds drops at the controller boundary', () => {
      const pipe = buildPipeline();
      // Drop centre at canvas origin (0, 0) — the piece footprint
      // (160 × 40 platform) extends past the top + left edges, so the
      // validator must reject.
      const { placed, registryResult } = performDrop(
        pipe,
        'flat-platform',
        0,
        0,
      );
      // Controller short-circuits before emitting a payload, so the
      // registry is never even called.
      expect(placed).toBeNull();
      expect(registryResult).toBeNull();
      expect(pipe.model.getPieces()).toHaveLength(0);
      expect(pipe.notifications).toHaveLength(0);
    });

    it('rejects overlap drops via the in-flight validation rules', () => {
      const pipe = buildPipeline();
      // First drop succeeds.
      const first = performDrop(pipe, 'flat-platform', 400, 400);
      expect(first.registryResult?.ok).toBe(true);
      // Second drop at the same spot — should be flagged by the
      // overlap rule and rejected at the controller boundary because
      // the registry source is wired in.
      const second = performDrop(pipe, 'flat-platform', 400, 400);
      expect(second.placed).toBeNull();
      expect(second.registryResult).toBeNull();
      // Registry still has only the first piece.
      expect(pipe.model.getPieces()).toHaveLength(1);
      expect(pipe.notifications).toHaveLength(1);
    });

    it('rejects hazard-near-spawn drops via the in-flight validation rules', () => {
      const pipe = buildPipeline();
      // Place a spawn point first.
      const spawn = performDrop(pipe, 'spawn-point', 600, 400);
      expect(spawn.registryResult?.ok).toBe(true);
      // Drop a lava hazard *adjacent* to the spawn — within the
      // hazard's exclusion buffer (1 cell = 40px). Even though the
      // pieces don't overlap, the hazard-near-spawn rule must fire.
      const hazard = performDrop(pipe, 'lava-zone', 640, 400);
      expect(hazard.placed).toBeNull();
      expect(hazard.registryResult).toBeNull();
      // Registry still has only the spawn point.
      expect(pipe.model.getPieces()).toHaveLength(1);
    });

    it('suppresses listener notifications for rejected drops', () => {
      const pipe = buildPipeline();
      // OOB rejected drop.
      performDrop(pipe, 'flat-platform', 0, 0);
      // Valid drop.
      performDrop(pipe, 'flat-platform', 400, 400);
      // Overlap rejected drop.
      performDrop(pipe, 'flat-platform', 400, 400);
      // Only the one valid drop should have notified.
      expect(pipe.notifications).toHaveLength(1);
      expect(pipe.notifications[0]!).toHaveLength(1);
    });

    it('rejects drops over the catalog panel without touching the registry', () => {
      const pipe = buildPipeline();
      const { controller, options } = pipe;
      const piece = findCatalogPiece('flat-platform')!;
      const start = catalogRowCentre(options.catalogHitRects, piece);
      // Begin a drag, then release back over the catalog (a "put it
      // back" gesture). The controller cancels and the registry stays
      // empty.
      controller.pointerDown(start.x, start.y);
      controller.pointerMove(start.x, start.y);
      const placed = controller.pointerUp(start.x, start.y);
      expect(placed).toBeNull();
      expect(pipe.model.getPieces()).toHaveLength(0);
      expect(pipe.notifications).toHaveLength(0);
    });
  });

  describe('piece data tracking respects the Seed cap', () => {
    it('honours the 30-piece hard cap across the integrated pipeline', () => {
      // Construct with a tiny cap so the test doesn't author 30 pieces
      // — the pipeline contract is "registry rejects, so a 31st drop
      // never lands", which is the same shape regardless of cap size.
      const model = new StageDataModel({
        gridSpec: DEFAULT_GRID_SPEC,
        maxPieces: 2,
      });
      const notifications: ReadonlyArray<RegisteredPiece>[] = [];
      model.addListener((pieces) => notifications.push([...pieces]));
      const options: DragDropOptions = {
        gridSpec: DEFAULT_GRID_SPEC,
        canvasOriginX: CANVAS_ORIGIN_X,
        canvasOriginY: CANVAS_ORIGIN_Y,
        catalogHitRects: makeCatalogRects(),
        getPlacedPieces: () => model.getRegisteredCandidates(),
      };
      const controller = new DragDropController(options);
      const piece = findCatalogPiece('flat-platform')!;
      const startPx = catalogRowCentre(options.catalogHitRects, piece);
      const dropAt = (cx: number, cy: number): {
        readonly placed: PlacedPiece | null;
        readonly result:
          | { ok: true; piece: RegisteredPiece }
          | { ok: false; reason: string }
          | null;
      } => {
        controller.pointerDown(startPx.x, startPx.y);
        const view = canvasCentreToViewport(cx, cy);
        controller.pointerMove(view.x, view.y);
        const p = controller.pointerUp(view.x, view.y);
        let result:
          | { ok: true; piece: RegisteredPiece }
          | { ok: false; reason: string }
          | null = null;
        if (p) {
          const r = model.addPiece(p);
          result = r.ok
            ? { ok: true, piece: r.piece }
            : { ok: false, reason: r.reason };
        }
        return { placed: p, result };
      };
      // Drop two pieces — both accepted.
      const a = dropAt(300, 300);
      expect(a.result?.ok).toBe(true);
      const b = dropAt(700, 300);
      expect(b.result?.ok).toBe(true);
      expect(model.getPieces()).toHaveLength(2);
      // Third drop — controller emits a `PlacedPiece` (passes the
      // bounds/overlap/hazard checks) but the registry rejects with
      // `limit-exceeded`. Critical: the cap is enforced at the
      // *registry* boundary so any future load-from-localStorage
      // path inherits it for free.
      const c = dropAt(1100, 300);
      expect(c.placed).not.toBeNull();
      expect(c.result?.ok).toBe(false);
      if (c.result && !c.result.ok) {
        expect(c.result.reason).toBe('limit-exceeded');
      }
      // Roster still capped at 2; only two notifications fired.
      expect(model.getPieces()).toHaveLength(2);
      expect(notifications).toHaveLength(2);
    });

    it('exposes the canonical 30-piece cap as the Seed-mandated limit', () => {
      // Sanity-check that the constant the registry defaults to is the
      // Seed's stated value. If this drifts the integration breaks
      // silently the next time the cap is the source of truth.
      expect(STAGE_PIECE_LIMIT).toBe(30);
    });
  });

  describe('post-cancel + post-update lifecycle', () => {
    it('cancel() leaves the registry untouched and the controller idle', () => {
      const pipe = buildPipeline();
      const { controller, options } = pipe;
      const piece = findCatalogPiece('lava-zone')!;
      const start = catalogRowCentre(options.catalogHitRects, piece);
      controller.pointerDown(start.x, start.y);
      controller.pointerMove(500 + CANVAS_ORIGIN_X, 500 + CANVAS_ORIGIN_Y);
      controller.cancel();
      expect(controller.getPhase()).toBe('idle');
      expect(controller.getDraggedPiece()).toBeNull();
      // No pointerUp → no registry mutation.
      expect(pipe.model.getPieces()).toHaveLength(0);
      expect(pipe.notifications).toHaveLength(0);
    });

    it('options update preserves the registry source closure', () => {
      const pipe = buildPipeline();
      // First drop establishes a piece in the registry.
      performDrop(pipe, 'flat-platform', 400, 400);
      // Simulate a canvas resize via updateOptions — the controller's
      // getPlacedPieces closure should still see the registry.
      pipe.controller.updateOptions({ canvasOriginX: CANVAS_ORIGIN_X + 8 });
      // A drop on the *same* spot must still trip the overlap rule —
      // proving the registry source survived the update.
      const piece = findCatalogPiece('flat-platform')!;
      const start = catalogRowCentre(pipe.options.catalogHitRects, piece);
      // The new origin shifts viewport->canvas mapping by 8px. Pick a
      // viewport coord that maps to the same canvas centre as the
      // first drop so we hit the existing piece's footprint.
      pipe.controller.pointerDown(start.x, start.y);
      const newOptions = pipe.controller.getOptions();
      const view = {
        x: 400 + newOptions.canvasOriginX,
        y: 400 + newOptions.canvasOriginY,
      };
      pipe.controller.pointerMove(view.x, view.y);
      const placed = pipe.controller.pointerUp(view.x, view.y);
      expect(placed).toBeNull();
      // Registry still only holds the first piece.
      expect(pipe.model.getPieces()).toHaveLength(1);
    });
  });

  describe('ghost state surfaces validation feedback during the drag', () => {
    it('reports a green ghost over a free cell', () => {
      const pipe = buildPipeline();
      const { controller, options } = pipe;
      const piece = findCatalogPiece('flat-platform')!;
      const start = catalogRowCentre(options.catalogHitRects, piece);
      const view = canvasCentreToViewport(400, 400);
      controller.pointerDown(start.x, start.y);
      controller.pointerMove(view.x, view.y);
      const ghost = controller.getGhostState();
      expect(ghost).not.toBeNull();
      expect(ghost!.snap).not.toBeNull();
      expect(ghost!.snap!.valid).toBe(true);
      expect(ghost!.snap!.invalidReason).toBeNull();
    });

    it('reports a red ghost over an existing piece (overlap rule)', () => {
      const pipe = buildPipeline();
      // Plant an existing piece.
      performDrop(pipe, 'flat-platform', 400, 400);
      // Begin a fresh drag and hover over the existing piece.
      const { controller, options } = pipe;
      const piece = findCatalogPiece('flat-platform')!;
      const start = catalogRowCentre(options.catalogHitRects, piece);
      const view = canvasCentreToViewport(400, 400);
      controller.pointerDown(start.x, start.y);
      controller.pointerMove(view.x, view.y);
      const ghost = controller.getGhostState();
      expect(ghost!.snap!.valid).toBe(false);
      expect(ghost!.snap!.invalidReason).toBe('overlap');
      // Conflict id points at the registered piece.
      expect(ghost!.snap!.conflictId).toBe('flat-platform#0');
    });

    it('reports a red ghost over an OOB drop (bounds rule)', () => {
      const pipe = buildPipeline();
      const { controller, options } = pipe;
      const piece = findCatalogPiece('flat-platform')!;
      const start = catalogRowCentre(options.catalogHitRects, piece);
      // Hover near the canvas's top-left corner — the piece footprint
      // overflows the canvas, so the bounds rule must fire.
      const view = canvasCentreToViewport(0, 0);
      controller.pointerDown(start.x, start.y);
      controller.pointerMove(view.x, view.y);
      const ghost = controller.getGhostState();
      expect(ghost!.snap!.valid).toBe(false);
      expect(ghost!.snap!.invalidReason).toBe('out-of-bounds');
      expect(ghost!.snap!.inBounds).toBe(false);
    });
  });
});
