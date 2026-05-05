import Phaser from 'phaser';
import {
  BUILDER_CANVAS_DEFAULT_HEIGHT,
  BUILDER_CANVAS_DEFAULT_WIDTH,
  BUILDER_GRID_CELL_PX,
  DEFAULT_GRID_SPEC,
  enumerateCoordinateMarks,
  enumerateGridLines,
  type CoordinateMark,
  type GridLine,
  type GridSpec,
} from '../builder/builderGrid';
import {
  CanvasArea,
  type SnapCursorState,
} from '../builder/CanvasArea';
import { formatSnapCursorLabel } from '../builder/canvasBounds';
import { CatalogPanel } from '../builder/CatalogPanel';
import { CATALOG_PANEL_LAYOUT, catalogPanelHeight } from '../builder/catalogPieces';
import { DragDropController } from '../builder/dragDrop';
import { GhostPreview } from '../builder/GhostPreview';
import { PlacedPieceRenderer } from '../builder/PlacedPieceRenderer';
import {
  StageDataModel,
  formatPlacedCountLabel,
  type RegisteredPiece,
} from '../builder/stageDataModel';
import { SaveLoadController } from '../builder/saveLoadController';
import { SaveLoadDialog } from '../builder/SaveLoadDialog';
import { toPlacedPieces } from '../builder/customStageStorage';

/**
 * StageBuilderScene — AC 20001 Sub-AC 1.
 *
 * Skeleton-level Phaser host for the M3 stage builder. This sub-AC
 * lands the *grid canvas* — the snapping background the player sees
 * before any pieces, hazards, or spawn-point widgets exist. Future
 * sub-ACs add the piece catalog, drag-and-drop, hit testing,
 * undo/redo, and `localStorage` persistence on top of this base.
 *
 * Responsibilities owned here
 * ---------------------------
 *
 *   1. Background fill — a flat dark surface the canvas + grid sit
 *      on so the builder reads as a different "place" from the
 *      gameplay scenes (which fade up from `GAME_CONFIG.backgroundColor`).
 *
 *   2. Canvas surface — a flat rectangle covering the authored stage
 *      area (defaults to 1× screen; up to 2× per the Seed cap). The
 *      grid lines and pieces snap to this rectangle's coordinate
 *      system.
 *
 *   3. Grid lines — verticals + horizontals at every cell intersection,
 *      with a heavier stroke on every major (Nth) line to give the
 *      eye sub-region anchors. Geometry comes from
 *      {@link enumerateGridLines}.
 *
 *   4. Coordinate-system marks — origin label, axis arrows, numeric
 *      ticks at major lines. Geometry comes from
 *      {@link enumerateCoordinateMarks}.
 *
 *   5. Lifecycle wiring — ESC returns to the main menu (so a player
 *      who opens the builder by mistake isn't stranded), shutdown
 *      releases listeners.
 *
 * Why a thin scene file
 * ---------------------
 *
 * Per the project's `code_architecture` evaluation principle, scenes
 * stay thin: lifecycle wiring + scene transitions only. All grid
 * math lives in the Phaser-free `../builder/builderGrid.ts` helper —
 * snapping, line enumeration, coordinate-mark layout — so each can
 * be exhaustively unit-tested under plain Node. The scene's job is
 * just to drive a `Graphics` / `Text` rig from the helper's pure
 * outputs.
 *
 * Determinism note: nothing in this scene reads `Math.random()` or
 * the wall clock for gameplay-affecting values. The grid is static
 * for the lifetime of a builder session; only the (future) piece
 * placements mutate, and those mutations are recorded as discrete
 * events that can replay byte-identically.
 */
export class StageBuilderScene extends Phaser.Scene {
  /**
   * Active grid spec. Defaults to the canonical 1× canvas; future
   * sub-ACs let the player resize via a control panel, at which
   * point this gets re-assigned and the rendering layer redraws
   * by re-running `enumerateGridLines` / `enumerateCoordinateMarks`.
   */
  private gridSpec: GridSpec = DEFAULT_GRID_SPEC;

  /**
   * Container that owns every grid + coordinate-system visual so
   * teardown is a one-call destroy and a future "redraw on resize"
   * path can wipe the layer without touching the rest of the scene.
   */
  private gridLayer: Phaser.GameObjects.Container | null = null;

  /**
   * AC 20002 Sub-AC 2 — left-edge catalog panel showing the eight
   * piece types with thumbnails + labels. Future sub-ACs read its
   * `getRowHitRects()` to start drag-and-drop placements.
   */
  private catalogPanel: CatalogPanel | null = null;

  /**
   * AC 20003 Sub-AC 3 — discrete grid-based canvas-area component
   * that owns the bounds-frame rendering (active + 2× max outline)
   * and the live snap-cursor overlay (cell highlight + crosshair at
   * the snapped grid intersection).
   *
   * The grid lines + canvas surface + coordinate marks are still
   * painted by the inline `populateGridLayer(...)` path (Sub-AC 1
   * deliverable); this component is configured with
   * `layers: { surface:false, gridLines:false, coordinateMarks:false }`
   * so it ONLY draws the new Sub-AC 3 visuals on top of the existing
   * grid. That keeps the wiring contract from Sub-AC 1 intact while
   * letting the bounds + snap-cursor functionality live as a discrete,
   * unit-testable component.
   */
  private canvasArea: CanvasArea | null = null;

  /**
   * Live snap-cursor HUD line. Updated on every `pointermove` over the
   * canvas so the player sees `col 12 · row 7 · (480, 280)` while
   * authoring. Hidden on `pointerout`. Built once in `create()`;
   * teardown destroys it alongside the rest of the scene's chrome.
   */
  private snapCursorReadout: Phaser.GameObjects.Text | null = null;

  /**
   * AC 20101 Sub-AC 1 — Phaser-free drag-and-drop state machine. The
   * controller owns the lifecycle (`idle → dragging`) plus the snap
   * target the ghost preview consumes. Wiring lives in `create()`:
   * `pointerdown` on a catalog row starts a drag; `pointermove` updates
   * the ghost; `pointerup` and ESC cancel the in-flight drag (full
   * placement / save are deliverables of later sub-ACs).
   */
  private dragDrop: DragDropController | null = null;

  /**
   * AC 20101 Sub-AC 1 — Phaser host that paints the drag ghost. Reads
   * the controller's `getGhostState()` snapshot on every pointer move
   * and renders a translucent piece preview at the snapped target with
   * a cursor-following dot so the player can see the carry sprite even
   * while transiting back over the catalog.
   */
  private ghostPreview: GhostPreview | null = null;

  /**
   * AC 20102 Sub-AC 2 — Phaser-free registry of placed pieces. Every
   * successful drop appends to this model; the catalog count HUD reads
   * the live size; the future save-to-localStorage path serialises its
   * roster verbatim. The model enforces the Seed's 30-piece hard cap +
   * canvas-bounds re-validation so out-of-bounds placements never reach
   * the renderer.
   */
  private stageData: StageDataModel | null = null;

  /**
   * AC 20102 Sub-AC 2 — Phaser host that paints one rectangle per
   * registered piece. Subscribes to {@link stageData} via the model's
   * change listener so a single registry mutation drives a single
   * canvas repaint without the scene having to thread the change
   * through every observer manually.
   */
  private placedPieceRenderer: PlacedPieceRenderer | null = null;

  /**
   * Unsubscribe handle returned by `stageData.addListener(...)`. Called
   * during teardown so a re-entered scene doesn't leak the prior
   * session's listener (the closure captures the renderer + count HUD
   * GameObjects, both of which are destroyed at teardown).
   */
  private stageDataUnsubscribe: (() => void) | null = null;

  /**
   * AC 20102 Sub-AC 2 — live HUD line showing piece count vs. cap
   * (`23 / 30`). Updated after every registry mutation so the player
   * sees how close they are to the Seed's 30-piece hard cap. Hidden
   * before {@link create} runs and after {@link tearDown}.
   */
  private placedCountHud: Phaser.GameObjects.Text | null = null;

  /**
   * AC 20103 Sub-AC 3 — Phaser-free save/load state machine. Owns the
   * draft slot name, last error/success, and storage calls. The scene
   * wires the dialog host's gestures into this controller and the
   * controller's view changes back into the dialog via its listener.
   */
  private saveLoadController: SaveLoadController | null = null;

  /**
   * AC 20103 Sub-AC 3 — Phaser host that paints the toolbar (Save/Load
   * buttons) plus the modal panel that mirrors the controller's view.
   */
  private saveLoadDialog: SaveLoadDialog | null = null;

  /**
   * AC 20001 Sub-AC 1 — pre-computed base layout regions for the two
   * primary builder surfaces (catalog panel on the left, canvas area
   * on the right). Populated by {@link init} before any GameObjects
   * are created so future sub-ACs (drag/drop hit-testing, preview
   * ghosts, save/load dialogs) can read viewport-space rects without
   * re-deriving the math from scratch.
   *
   * Set to `null` between scene shutdown and the next `init()` so
   * tests + tooling can detect "scene not yet active" reliably.
   */
  private layoutRegions: StageBuilderLayoutRegions | null = null;

  constructor() {
    super({ key: 'StageBuilderScene' });
  }

  /**
   * Phaser scene-lifecycle hook fired before {@link create}. We use
   * it to:
   *
   *   1. Reset the per-instance layout regions (so a re-entered scene
   *      starts from a clean slate even if Phaser reused the object).
   *   2. Compute the catalog-panel + canvas-area rectangles from the
   *      current viewport size and the catalog layout constants.
   *
   * Splitting `init()` from `create()` mirrors Phaser's documented
   * lifecycle (init → preload → create) and keeps `create()` focused
   * purely on building GameObjects from the already-resolved regions.
   * Tests can call `init()` in isolation under a stub Scale Manager
   * to verify the region math without instantiating any Phaser
   * GameObjects.
   */
  init(): void {
    // Wipe any state left over from a previous scene cycle. Phaser
    // keeps Scene instances around across `scene.start(...)` calls,
    // so explicit reset here means the contract is "fresh fields
    // every time the player walks into the builder".
    this.gridSpec = DEFAULT_GRID_SPEC;
    this.gridLayer = null;
    this.catalogPanel = null;
    this.canvasArea = null;
    this.snapCursorReadout = null;
    this.dragDrop = null;
    this.ghostPreview = null;
    this.stageData = null;
    this.placedPieceRenderer = null;
    this.stageDataUnsubscribe = null;
    this.placedCountHud = null;
    this.saveLoadController = null;
    this.saveLoadDialog = null;
    this.layoutRegions = this.computeLayoutRegions();
  }

  create(): void {
    // `init()` runs before `create()` in Phaser's lifecycle, but for
    // robustness against test rigs that bypass it we lazily populate
    // the regions here too. The compute helper is pure so calling it
    // twice is harmless.
    if (!this.layoutRegions) {
      this.layoutRegions = this.computeLayoutRegions();
    }
    const { canvasArea, viewport } = this.layoutRegions;
    const viewW = viewport.width;
    const viewH = viewport.height;
    const canvasOriginX = canvasArea.x;
    const canvasOriginY = canvasArea.y;

    // ---- Background -------------------------------------------------------
    // Fill the entire viewport with a slightly bluer-than-the-menu
    // shade so the builder reads as a tool, not a gameplay scene.
    // procedural fallback — builder backdrop drawn as a flat-colour
    // `Phaser.GameObjects.Rectangle`. The builder is an editing tool, not
    // a gameplay scene, so a procedural backdrop is intentional — only
    // replace if a future skin/theme system needs textured chrome.
    const bg = this.add.rectangle(
      viewW / 2,
      viewH / 2,
      viewW,
      viewH,
      STAGE_BUILDER_COLORS.background,
      1,
    );
    bg.setDepth(STAGE_BUILDER_DEPTHS.background);

    // Title strip so QA / playtesters know which scene they're in
    // before any catalog UI lands.
    this.add
      .text(viewW / 2, 32, 'STAGE BUILDER', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#e8e8f0',
      })
      .setOrigin(0.5, 0)
      .setDepth(STAGE_BUILDER_DEPTHS.chrome);

    this.add
      .text(viewW / 2, viewH - 32, '[ESC] back to menu', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#888899',
      })
      .setOrigin(0.5, 1)
      .setDepth(STAGE_BUILDER_DEPTHS.chrome);

    // ---- Grid layer ------------------------------------------------------
    // Build the layer once; future redraws (resize, undo/redo,
    // theme toggles) wipe + rebuild via the same helper.
    this.gridLayer = this.add.container(canvasOriginX, canvasOriginY);
    this.gridLayer.setDepth(STAGE_BUILDER_DEPTHS.grid);
    this.populateGridLayer(this.gridLayer);

    // ---- Catalog panel (AC 20002 Sub-AC 2) -------------------------------
    // Pinned to the left edge of the viewport. The panel paints once
    // at construction and exposes `getRowHitRects()` so the future
    // drag-and-drop sub-AC can start a placement on pointer-down.
    this.catalogPanel = new CatalogPanel(this, {
      depth: STAGE_BUILDER_DEPTHS.catalog,
    });

    // ---- Canvas-area enhancement (AC 20003 Sub-AC 3) ---------------------
    // The grid lines + surface + coordinate marks are already painted
    // by the inline `populateGridLayer(...)` path above (Sub-AC 1
    // deliverable). The CanvasArea component layers ON TOP of that
    // existing rendering to provide:
    //
    //   • A bounds frame around the active canvas (bright outline so
    //     the playable area is unambiguous) plus a 1-px shadow drop.
    //   • A dim outline marking the 2× screen hard cap so the player
    //     can see how much room they have left to grow.
    //   • A live snap-cursor overlay — translucent cell highlight + a
    //     crosshair at the snapped grid intersection — so every pointer
    //     hover shows EXACTLY where a future drop would land.
    //
    // We pass `layers: { surface:false, gridLines:false, coordinateMarks:false }`
    // so the component only paints the NEW sub-AC 3 visuals; the existing
    // grid lines + coordinate marks stay owned by the inline scene path.
    this.canvasArea = new CanvasArea(this, {
      gridSpec: this.gridSpec,
      originX: canvasOriginX,
      originY: canvasOriginY,
      depth: STAGE_BUILDER_DEPTHS.canvasArea,
      layers: {
        surface: false,
        gridLines: false,
        coordinateMarks: false,
        bounds: true,
        snapCursor: true,
      },
    });

    // Snap-cursor HUD readout — sits under the title strip so playtesters
    // + QA can read the live snap target without eyeballing pixel offsets.
    this.snapCursorReadout = this.add
      .text(viewW / 2, 64, formatSnapCursorLabel(null), {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#9aa0b6',
      })
      .setOrigin(0.5, 0)
      .setDepth(STAGE_BUILDER_DEPTHS.chrome);

    // ---- Drag-and-drop (AC 20101 Sub-AC 1) -------------------------------
    // The Phaser-free `DragDropController` owns the state machine
    // (idle ↔ dragging) plus the snap target; `GhostPreview` is the
    // visual host that paints the translucent piece preview at the
    // snapped target with a cursor-following carry dot.
    //
    // Wiring contract:
    //
    //   • `pointerdown` over a catalog row → start a drag, paint the
    //     ghost matching the picked piece's accent colour + footprint.
    //   • `pointermove` while dragging → update the ghost's snap target
    //     so the preview follows the cursor on the canvas.
    //   • `pointerup` / ESC → cancel the in-flight drag for now.
    //     Full placement + commit logic land in later sub-ACs.
    // AC 20103 Sub-AC 3 — wire the data model's live roster into the
    // controller so the in-flight ghost preview can run the full
    // placement-validation rules (overlap + hazard-near-spawn) and the
    // player sees per-reason colour feedback the moment their drag
    // floats over an existing piece, not after they release.
    //
    // The closure reads `this.stageData` *at call time* so the order of
    // construction (controller before model) doesn't matter — by the
    // time the controller queries the registry the model is wired up.
    this.dragDrop = new DragDropController({
      gridSpec: this.gridSpec,
      canvasOriginX,
      canvasOriginY,
      catalogHitRects: this.catalogPanel.getRowHitRects(),
      getPlacedPieces: () =>
        this.stageData?.getRegisteredCandidates() ?? [],
    });
    this.ghostPreview = new GhostPreview(this, {
      depth: STAGE_BUILDER_DEPTHS.ghost,
    });

    // ---- Stage data model + placed-piece renderer (AC 20102 Sub-AC 2) ----
    // The data model is the single source of truth for which pieces
    // currently sit on the canvas. The renderer subscribes via the
    // model's change listener so one drop → one repaint without the
    // scene having to thread the mutation through every observer
    // manually. The count HUD is updated by the same listener so the
    // player sees their progress toward the Seed's 30-piece hard cap.
    this.stageData = new StageDataModel({ gridSpec: this.gridSpec });
    this.placedPieceRenderer = new PlacedPieceRenderer(this, {
      depth: STAGE_BUILDER_DEPTHS.placedPiece,
      canvasOriginX,
      canvasOriginY,
    });
    this.placedCountHud = this.add
      .text(
        viewW - 32,
        viewH - 32,
        formatPlacedCountLabel(0, this.stageData.getMaxPieces()),
        {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#9aa0b6',
        },
      )
      .setOrigin(1, 1)
      .setDepth(STAGE_BUILDER_DEPTHS.chrome);
    this.stageDataUnsubscribe = this.stageData.addListener((pieces) => {
      this.placedPieceRenderer?.repaint(pieces);
      if (this.placedCountHud && this.stageData) {
        this.placedCountHud.setText(
          formatPlacedCountLabel(pieces.length, this.stageData.getMaxPieces()),
        );
      }
    });

    // ---- Save / Load (AC 20103 Sub-AC 3) --------------------------------
    // Wire the Phaser-free SaveLoadController to the live registry +
    // grid spec, then mount the SaveLoadDialog Phaser host that paints
    // the toolbar buttons + modal flow. The controller is the single
    // seam where UI gestures (button clicks, keystrokes) become storage
    // calls; the dialog is a thin painter that mirrors the controller's
    // view snapshot every time it changes.
    //
    // The applyLoad hook routes a successfully loaded stage back into
    // the StageDataModel via its bulk `replaceAllPieces(...)` path so
    // the canvas reflects the loaded layout. The grid spec round-trips
    // through the saved blob too — a stage saved on a 1×canvas reloads
    // onto the same canvas size.
    this.saveLoadController = new SaveLoadController({
      registry: {
        getGridSpec: () =>
          this.stageData?.getGridSpec() ?? this.gridSpec,
        getPieces: () => this.stageData?.getPieces() ?? [],
      },
      applyLoad: (data) => {
        if (!this.stageData) return { accepted: 0, rejected: 0 };
        const pieces = toPlacedPieces(data);
        const report = this.stageData.replaceAllPieces(pieces, {
          gridSpec: {
            cellPx: data.gridSpec.cellPx,
            width: data.gridSpec.width,
            height: data.gridSpec.height,
          },
        });
        return { accepted: report.accepted, rejected: report.rejected.length };
      },
    });
    this.saveLoadDialog = new SaveLoadDialog(this, this.saveLoadController);

    // Forward pointer events into the canvas area + drag controller.
    // `pointermove` fires on every mouse / touch move; `pointerout`
    // fires when the pointer leaves the game canvas entirely. Both are
    // deterministic event streams so a future replay can re-derive the
    // snap-cursor + ghost state byte-identically.
    this.input.on(
      Phaser.Input.Events.POINTER_MOVE,
      (pointer: Phaser.Input.Pointer) => {
        const state = this.canvasArea?.updateSnapCursor(pointer.x, pointer.y) ?? null;
        this.snapCursorReadout?.setText(formatSnapCursorLabel(state));
        // Forward to the drag-drop state machine + ghost host. When the
        // controller is idle the ghost-state snapshot is null and the
        // preview hides itself — the per-frame path costs nothing.
        this.dragDrop?.pointerMove(pointer.x, pointer.y);
        this.ghostPreview?.update(this.dragDrop?.getGhostState() ?? null);
      },
    );
    this.input.on(Phaser.Input.Events.POINTER_OUT, () => {
      this.canvasArea?.hideSnapCursor();
      this.snapCursorReadout?.setText(formatSnapCursorLabel(null));
    });

    // Drag initiation: pointer-down on a catalog row picks up the
    // matching piece and starts the ghost preview at the cursor.
    this.input.on(
      Phaser.Input.Events.POINTER_DOWN,
      (pointer: Phaser.Input.Pointer) => {
        const picked = this.dragDrop?.pointerDown(pointer.x, pointer.y);
        if (picked) {
          this.catalogPanel?.setSelected(picked.type);
          this.ghostPreview?.update(this.dragDrop?.getGhostState() ?? null);
        }
      },
    );

    // Drag release: commit the placement (AC 20102 Sub-AC 2) if the
    // controller emitted a `PlacedPiece`, then clear the ghost +
    // catalog selection.
    //
    // Commit pipeline:
    //
    //   1. `dragDrop.pointerUp(...)` — returns a `PlacedPiece` iff the
    //      drop was valid (drag was active, not over the catalog,
    //      footprint fits in the canvas). Returns `null` for cancelled
    //      drops (over-panel or out-of-bounds).
    //
    //   2. `stageData.addPiece(placed)` — the registry re-validates the
    //      payload (catalog identity, geometry, canvas bounds, 30-piece
    //      cap) and assigns a stable id. The model's change listener
    //      then drives a single repaint of the placed-piece layer + a
    //      single update of the count HUD.
    //
    //   3. UI cleanup — clear the ghost preview + catalog selection so
    //      the next drag starts from a clean slate.
    this.input.on(
      Phaser.Input.Events.POINTER_UP,
      (pointer: Phaser.Input.Pointer) => {
        const placed = this.dragDrop?.pointerUp(pointer.x, pointer.y) ?? null;
        if (placed && this.stageData) {
          // Result is intentionally not surfaced as a UI toast yet —
          // the count HUD's "29 / 30" → "30 / 30" transition is the
          // visible signal that the cap was reached. A future sub-AC
          // can wire a transient toast banner ("Piece limit reached")
          // off the rejection reason.
          this.stageData.addPiece(placed);
        }
        this.ghostPreview?.clear();
        this.catalogPanel?.clearSelection();
      },
    );

    // ---- Input handlers --------------------------------------------------
    // ESC = cancel any in-flight drag if one is active, otherwise
    // return to the main menu. Future sub-ACs add pan/zoom keys,
    // piece-catalog hotkeys, undo/redo (CTRL+Z / CTRL+Y), and a
    // SAVE shortcut.
    this.input.keyboard?.on('keydown-ESC', () => {
      // AC 20103 Sub-AC 3 — when the save/load modal is open, ESC is
      // owned by the dialog (cancel back to the toolbar). The dialog
      // routes the keystroke through its own controller call so the
      // scene's drag-cancel + back-to-menu paths only fire when the
      // modal is closed.
      if (this.saveLoadDialog && this.saveLoadDialog.isModalOpen()) {
        this.saveLoadController?.cancel();
        return;
      }
      if (this.dragDrop && this.dragDrop.getPhase() === 'dragging') {
        this.dragDrop.cancel();
        this.ghostPreview?.clear();
        this.catalogPanel?.clearSelection();
        return;
      }
      this.scene.start('MainMenuScene');
    });

    // Phaser's SHUTDOWN runs when the scene is replaced via
    // `scene.start('OtherScene')`. Tear down the grid container so
    // its child `Graphics` / `Text` objects are released cleanly.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.tearDown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.tearDown());
  }

  // -------------------------------------------------------------------------
  // Public test seam
  // -------------------------------------------------------------------------

  /**
   * Read-only snapshot of the live grid spec. Exposed so tests + a
   * future "canvas size" control panel can verify the scene picked
   * up the size change without poking private fields.
   */
  getGridSpec(): GridSpec {
    return this.gridSpec;
  }

  /**
   * Catalog panel handle — exposed so future sub-ACs (drag/drop, the
   * piece-selection HUD) can pull row hit-rects without poking at
   * private fields. Returns `null` before `create()` runs and after
   * `tearDown()`.
   */
  getCatalogPanel(): CatalogPanel | null {
    return this.catalogPanel;
  }

  /**
   * Read-only snapshot of the base layout regions populated by
   * {@link init}. Returns `null` before the scene activates (or after
   * tear-down) so callers can distinguish "scene not yet started"
   * from "viewport collapsed to zero".
   *
   * Used by:
   *   • Tests (Sub-AC 1 wiring contract) to verify the catalog panel
   *     + canvas area regions line up with the viewport math.
   *   • Future sub-ACs that need to hit-test which surface a pointer
   *     event landed on (catalog vs. canvas) before deciding how to
   *     route it.
   */
  getLayoutRegions(): StageBuilderLayoutRegions | null {
    return this.layoutRegions;
  }

  /**
   * Pure helper — derives the base layout regions from the active
   * Scale Manager + catalog layout constants. Exported via the
   * `getLayoutRegions()` seam; lives as an instance method so the
   * `gridSpec` it depends on can vary per-instance once the
   * (future) "canvas size" control panel is wired in.
   *
   * Output regions are in viewport space (top-left origin):
   *
   *   • `viewport`   — the full game viewport rect.
   *   • `catalogPanel` — the left-edge catalog rect (matches the
   *     panel's own internal layout so the scene + the panel agree
   *     on where it sits without duplicating literals).
   *   • `canvasArea` — the rectangle that holds the snapping grid
   *     and (future) placed pieces. Centred horizontally between the
   *     catalog panel's right edge and the viewport's right edge so
   *     the canvas reads as the "main stage" of the builder.
   */
  private computeLayoutRegions(): StageBuilderLayoutRegions {
    const { width: viewW, height: viewH } = this.scale.gameSize;

    const catalogX = CATALOG_PANEL_LAYOUT.marginLeft;
    const catalogY = CATALOG_PANEL_LAYOUT.marginTop;
    const catalogW = CATALOG_PANEL_LAYOUT.panelWidth;
    const catalogH = catalogPanelHeight();

    // Canvas area lives to the right of the catalog. We reserve the
    // full panel width plus a small gutter so the canvas grid does
    // not visually collide with the panel's right border.
    const canvasGutter = 16;
    const canvasLeftBound = catalogX + catalogW + canvasGutter;
    const canvasAvailableW = Math.max(0, viewW - canvasLeftBound - canvasGutter);
    const canvasAvailableH = Math.max(0, viewH - canvasGutter * 2);

    // The snapping grid is currently fixed-size (1× canvas); we
    // centre it inside the available canvas area so smaller-than-
    // available grids look intentional rather than pinned to a
    // corner. When the viewport is too narrow to fit both the
    // catalog and the full canvas, the grid pins to the canvas-area
    // origin and the future pan/zoom sub-AC will let the player
    // scroll.
    const gridW = this.gridSpec.width;
    const gridH = this.gridSpec.height;
    const gridLocalX =
      canvasAvailableW > gridW ? (canvasAvailableW - gridW) / 2 : 0;
    const gridLocalY =
      canvasAvailableH > gridH ? (canvasAvailableH - gridH) / 2 : 0;

    return {
      viewport: { x: 0, y: 0, width: viewW, height: viewH },
      catalogPanel: {
        x: catalogX,
        y: catalogY,
        width: catalogW,
        height: catalogH,
      },
      canvasArea: {
        x: canvasLeftBound + gridLocalX,
        y: canvasGutter + gridLocalY,
        width: gridW,
        height: gridH,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Rendering — every helper here turns a pure-helper output into Phaser
  // GameObjects parented under `this.gridLayer`.
  // -------------------------------------------------------------------------

  /**
   * Wipe + rebuild the grid layer's contents from the active grid
   * spec. Called once during `create()` and re-callable by the
   * future resize / theme paths (so the layer-rebuild logic has
   * exactly one entry point).
   */
  private populateGridLayer(layer: Phaser.GameObjects.Container): void {
    layer.removeAll(true);

    // Canvas surface — a single rectangle the grid lines sit on.
    // procedural fallback — builder canvas surface + grid drawn from
    // `Phaser.GameObjects.Rectangle` + `Graphics` primitives (no sprite
    // frames). Editor chrome stays procedural by design; replace only
    // if a textured grid background ever ships.
    const surface = this.add.rectangle(
      this.gridSpec.width / 2,
      this.gridSpec.height / 2,
      this.gridSpec.width,
      this.gridSpec.height,
      STAGE_BUILDER_COLORS.canvasSurface,
      1,
    );
    layer.add(surface);

    // Grid lines: one Graphics for the minor cohort, one for the
    // major cohort, so the renderer batches each style into a
    // single GPU call instead of per-line draw calls.
    const minor = this.add.graphics();
    minor.lineStyle(STAGE_BUILDER_GRID.minorStrokePx, STAGE_BUILDER_COLORS.gridMinor, 1);
    const major = this.add.graphics();
    major.lineStyle(STAGE_BUILDER_GRID.majorStrokePx, STAGE_BUILDER_COLORS.gridMajor, 1);

    const lines = enumerateGridLines(this.gridSpec);
    for (const line of lines) {
      this.drawGridLine(line, line.major ? major : minor);
    }
    layer.add(minor);
    layer.add(major);

    // Outer canvas border — drawn last so it sits over the major
    // lines that fall on the canvas edge. Gives the canvas a clear
    // frame so the player can see "the playable area ends here".
    const border = this.add.graphics();
    border.lineStyle(STAGE_BUILDER_GRID.borderStrokePx, STAGE_BUILDER_COLORS.canvasBorder, 1);
    border.strokeRect(0, 0, this.gridSpec.width, this.gridSpec.height);
    layer.add(border);

    // Coordinate-system marks (origin, axis labels, numeric ticks).
    for (const mark of enumerateCoordinateMarks(this.gridSpec)) {
      layer.add(this.buildCoordinateMark(mark));
    }
  }

  private drawGridLine(line: GridLine, target: Phaser.GameObjects.Graphics): void {
    if (line.axis === 'vertical') {
      target.lineBetween(line.position, 0, line.position, this.gridSpec.height);
    } else {
      target.lineBetween(0, line.position, this.gridSpec.width, line.position);
    }
  }

  private buildCoordinateMark(mark: CoordinateMark): Phaser.GameObjects.Text {
    const colour =
      mark.kind === 'origin'
        ? '#ffd166'
        : mark.kind === 'tick'
          ? '#888899'
          : '#6cf0c2';
    // Origin label hugs the inside corner; axis labels sit just
    // inside the far edge; numeric ticks straddle the major line.
    const offsetX = mark.kind === 'axis-x' ? -6 : 6;
    const offsetY = mark.kind === 'axis-y' ? -6 : 6;
    const originX = mark.kind === 'axis-x' ? 1 : 0;
    const originY = mark.kind === 'axis-y' ? 1 : 0;
    const text = this.add
      .text(mark.x + offsetX, mark.y + offsetY, mark.label, {
        fontFamily: 'monospace',
        fontSize: mark.kind === 'tick' ? '12px' : '14px',
        color: colour,
      })
      .setOrigin(originX, originY);
    return text;
  }

  private tearDown(): void {
    if (this.gridLayer) {
      this.gridLayer.destroy(true);
      this.gridLayer = null;
    }
    if (this.catalogPanel) {
      this.catalogPanel.destroy();
      this.catalogPanel = null;
    }
    if (this.canvasArea) {
      this.canvasArea.destroy();
      this.canvasArea = null;
    }
    if (this.snapCursorReadout) {
      this.snapCursorReadout.destroy();
      this.snapCursorReadout = null;
    }
    // Drag-drop controller is Phaser-free — no GameObjects to release,
    // just cancel any in-flight drag and drop the reference so a future
    // re-entry rebuilds the controller against fresh hit-rects.
    if (this.dragDrop) {
      this.dragDrop.cancel();
      this.dragDrop = null;
    }
    if (this.ghostPreview) {
      this.ghostPreview.destroy();
      this.ghostPreview = null;
    }
    // AC 20102 Sub-AC 2 — release the data-model listener handle (so a
    // re-entered scene rewires fresh observers against the new model)
    // before destroying the renderer + count HUD it captured. The
    // model itself is just a dropped reference — no GameObjects to
    // release.
    if (this.stageDataUnsubscribe) {
      this.stageDataUnsubscribe();
      this.stageDataUnsubscribe = null;
    }
    if (this.placedPieceRenderer) {
      this.placedPieceRenderer.destroy();
      this.placedPieceRenderer = null;
    }
    if (this.placedCountHud) {
      this.placedCountHud.destroy();
      this.placedCountHud = null;
    }
    this.stageData = null;
    // AC 20103 Sub-AC 3 — release the dialog GameObjects + drop the
    // controller reference. The controller is Phaser-free so there's
    // nothing to destroy on it; nulling the field detaches the closure
    // captures the registry hooks made (so the next session rebuilds
    // them against the new model).
    if (this.saveLoadDialog) {
      this.saveLoadDialog.destroy();
      this.saveLoadDialog = null;
    }
    this.saveLoadController = null;
    // Drop layout regions so a re-entered scene can detect "init
    // hasn't run yet" via the same `null`-vs-rect contract.
    this.layoutRegions = null;
  }

  // -------------------------------------------------------------------------
  // Public test seam — AC 20003 Sub-AC 3
  // -------------------------------------------------------------------------

  /**
   * Canvas-area handle — exposed so future sub-ACs (drag/drop ghost
   * compositing, save dialogs that need the bounds frame) can read
   * the live snap-cursor state without poking private fields.
   * Returns `null` before `create()` runs and after `tearDown()`.
   */
  getCanvasArea(): CanvasArea | null {
    return this.canvasArea;
  }

  /**
   * Latest snap-cursor state from the canvas area, or `null` if the
   * area is not yet created or the cursor has not yet visited the
   * canvas. Convenience wrapper for tests + the (future) drag-drop
   * controller's preview path.
   */
  getSnapCursor(): SnapCursorState | null {
    return this.canvasArea?.getSnapCursor() ?? null;
  }

  /**
   * Drag-drop controller handle — exposed so tests + future sub-ACs
   * (placement commit, deletion brush) can read the in-flight drag
   * state without poking private fields. Returns `null` before
   * `create()` runs and after `tearDown()`.
   */
  getDragDrop(): DragDropController | null {
    return this.dragDrop;
  }

  /**
   * Ghost-preview host — exposed so tests can assert the visual
   * follows the controller's snap target. Returns `null` before
   * `create()` runs and after `tearDown()`.
   */
  getGhostPreview(): GhostPreview | null {
    return this.ghostPreview;
  }

  /**
   * Stage-data model handle — AC 20102 Sub-AC 2. Exposed so tests +
   * future sub-ACs (delete brush, save dialog) can read the live piece
   * roster without poking private fields. Returns `null` before
   * `create()` runs and after `tearDown()`.
   */
  getStageData(): StageDataModel | null {
    return this.stageData;
  }

  /**
   * Placed-piece renderer handle — AC 20102 Sub-AC 2. Exposed so tests
   * can assert the visual layer mirrors the data model. Returns `null`
   * before `create()` runs and after `tearDown()`.
   */
  getPlacedPieceRenderer(): PlacedPieceRenderer | null {
    return this.placedPieceRenderer;
  }

  /**
   * Read-only snapshot of the live piece roster — convenience accessor
   * that's safe to call before / after `create()` (returns `null` when
   * the scene is inactive). Future sub-ACs that need to display the
   * roster in a side-panel HUD read this instead of poking
   * `getStageData()` and unwrapping the null themselves.
   */
  getPlacedPieces(): ReadonlyArray<RegisteredPiece> | null {
    return this.stageData?.getPieces() ?? null;
  }

  /**
   * Save/load controller handle — AC 20103 Sub-AC 3. Exposed so tests
   * + future sub-ACs (e.g. an "Export to file" affordance) can drive
   * the save/load flow without poking private fields. Returns `null`
   * before `create()` runs and after `tearDown()`.
   */
  getSaveLoadController(): SaveLoadController | null {
    return this.saveLoadController;
  }

  /**
   * Save/load dialog handle — AC 20103 Sub-AC 3. Exposed so tests can
   * assert the dialog mirrors the controller's view changes. Returns
   * `null` before `create()` runs and after `tearDown()`.
   */
  getSaveLoadDialog(): SaveLoadDialog | null {
    return this.saveLoadDialog;
  }
}

// ---------------------------------------------------------------------------
// Public layout-region types — used by the scene + tests to talk about the
// builder's primary viewport partitions.
// ---------------------------------------------------------------------------

/**
 * Axis-aligned rectangle in viewport (top-left origin) coordinates.
 *
 * `x` / `y` is the top-left corner; `width` / `height` describe the
 * rectangle's extent. All values are in design pixels (the same
 * coordinate system Phaser's Scale Manager surfaces via
 * `scale.gameSize`).
 */
export interface StageBuilderLayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Pre-computed base layout for the stage builder. Returned by
 * {@link StageBuilderScene.getLayoutRegions} and consumed by:
 *
 *   • The scene's own `create()` to position the canvas grid.
 *   • Future sub-ACs (drag/drop hit-testing, save/load dialogs,
 *     pan/zoom controls) that need to know which surface a pointer
 *     event landed on.
 *   • Tests, which assert the regions form the canonical
 *     "catalog on the left, canvas on the right" partition the AC
 *     mandates.
 *
 * `viewport` is included for completeness so callers can bound-check
 * regions against the actual scale-manager size without re-reading
 * `this.scale.gameSize`.
 */
export interface StageBuilderLayoutRegions {
  readonly viewport: StageBuilderLayoutRect;
  readonly catalogPanel: StageBuilderLayoutRect;
  readonly canvasArea: StageBuilderLayoutRect;
}

// ---------------------------------------------------------------------------
// Visual constants — exported so the scene-test contract can verify the
// renderer is using the canonical palette / depth ordering, and so
// future sub-ACs (catalog, piece preview, save dialog) can layer on
// top of `chrome` / `grid` cleanly.
// ---------------------------------------------------------------------------

/**
 * Colour palette for the builder scene. Hex literals (no `#`) so they
 * pass straight into Phaser's `lineStyle` / `Rectangle` ctors.
 */
export const STAGE_BUILDER_COLORS = Object.freeze({
  background: 0x0d1320,
  canvasSurface: 0x141a2c,
  canvasBorder: 0x2c3656,
  gridMinor: 0x1f2640,
  gridMajor: 0x39456b,
});

/**
 * Stroke widths in design pixels. Major lines are drawn thicker
 * than minors so the player has visible "sub-region" anchors when
 * eyeballing piece placement. The border stroke sits on top of
 * both grid styles so the canvas edge is always crisp.
 */
export const STAGE_BUILDER_GRID = Object.freeze({
  minorStrokePx: 1,
  majorStrokePx: 2,
  borderStrokePx: 3,
});

/**
 * Depth ordering — every layer the scene draws picks one of these
 * constants. `background` is the lowest; `chrome` (titles, hints)
 * is the highest so HUD-style overlays paint cleanly over the grid.
 * Future sub-ACs (piece previews, drag ghosts) will slot a `pieces`
 * value between `grid` and `chrome`.
 */
export const STAGE_BUILDER_DEPTHS = Object.freeze({
  background: 0,
  grid: 10,
  /**
   * Canvas-area enhancement (AC 20003 Sub-AC 3) — bounds frames +
   * snap-cursor overlay sit above the grid (so they're visible over
   * the cell intersections) but below the catalog panel (so the panel
   * chrome occludes them at the canvas's left edge).
   */
  canvasArea: 25,
  /**
   * Placed-piece sprites (AC 20102 Sub-AC 2) — solid rectangles for
   * every piece registered in {@link StageDataModel}. Sit ABOVE the
   * canvas-area overlays so the player sees their committed pieces on
   * top of the grid + bounds frame, and BELOW the catalog panel so a
   * placement near the canvas's left edge can never hide the panel
   * chrome.
   */
  placedPiece: 35,
  /**
   * Catalog panel (AC 20002 Sub-AC 2) — sits above the grid so the
   * panel chrome occludes the grid lines that fall behind it, and
   * below scene chrome so future modal dialogs (save, confirm)
   * paint over it.
   */
  catalog: 50,
  /**
   * Drag ghost preview (AC 20101 Sub-AC 1) — the translucent piece
   * preview the player carries from the catalog onto the canvas.
   * Sits ABOVE the catalog so the ghost reads on top of panel chrome
   * while the cursor transits between catalog and canvas, and below
   * scene chrome so future modal dialogs paint over it.
   */
  ghost: 60,
  chrome: 100,
  /**
   * Save / Load dialog (AC 20103 Sub-AC 3) — the toolbar buttons +
   * modal panel sit ABOVE the chrome layer so they unambiguously
   * occlude the canvas + catalog while the modal is open.
   */
  saveLoad: 200,
});

/**
 * Convenience re-export so callers wiring buttons / hotkeys can
 * navigate to the builder by string key without importing the scene
 * class.
 */
export const STAGE_BUILDER_SCENE_KEY = 'StageBuilderScene';

// Surface the canvas defaults to consumers that don't want to
// import the helper module just to know the canvas dimensions.
export {
  BUILDER_CANVAS_DEFAULT_WIDTH,
  BUILDER_CANVAS_DEFAULT_HEIGHT,
  BUILDER_GRID_CELL_PX,
};

// Re-exported for backward compatibility — `formatPlacedCountLabel` was
// added alongside this scene as part of AC 20102 Sub-AC 2 but lives in
// the Phaser-free `stageDataModel.ts` so tests can drive it without
// pulling in browser globals.
export { formatPlacedCountLabel } from '../builder/stageDataModel';
