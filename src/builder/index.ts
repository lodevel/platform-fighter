/**
 * Stage builder module.
 *
 * Drag-and-drop editor with a piece catalog (max 30 pieces per stage,
 * max 2x screen-size canvas). Saves to localStorage in M3.
 *
 * Public surface:
 *   - AC 20001 Sub-AC 1: Phaser-free grid math used by
 *     `StageBuilderScene` to render the snapping grid + coordinate
 *     system, re-used at save time by the validator that enforces the
 *     Seed's piece-count + canvas-size hard limits (`builderGrid.ts`).
 *   - AC 20002 Sub-AC 2: Catalog panel data + UI component — the
 *     eight-piece roster (flat platform, slope/ramp, wall, drop-through
 *     platform, lava zone, wind zone, moving platform, spawn point)
 *     plus the Phaser panel that paints them with thumbnails + labels
 *     (`catalogPieces.ts`, `CatalogPanel.ts`).
 *   - AC 20003 Sub-AC 3: Grid-based canvas-area component bundling
 *     the visible grid lines, snap-coordinate cursor overlay, and
 *     bounds rendering (active + 2× max headroom outline) into a
 *     single discrete Phaser-host component. Pure geometry lives in
 *     `canvasBounds.ts`; the Phaser host is `CanvasArea.ts`.
 *   - AC 20102 Sub-AC 2: Stage-data model registry + placed-piece
 *     renderer. The drag-drop pipeline routes successful drops into
 *     `StageDataModel`, which enforces the Seed's 30-piece cap and
 *     re-validates canvas bounds; `PlacedPieceRenderer` mirrors the
 *     model's roster onto the canvas as one Phaser rectangle per
 *     piece (`stageDataModel.ts`, `PlacedPieceRenderer.ts`).
 *
 * Future sub-ACs add deletion brushes, undo/redo, and
 * `localStorage` persistence on top of this base.
 */

export {
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
  type CoordinateMark,
  type GridLine,
  type GridSpec,
} from './builderGrid';

// AC 20002 Sub-AC 2 — Catalog panel data + UI component.
export {
  CATALOG_PIECES,
  CATALOG_PIECE_COUNT,
  CATALOG_PANEL_LAYOUT,
  buildCatalogRowLayouts,
  catalogColorHex,
  catalogPanelHeight,
  catalogPieceLabel,
  catalogPiecesByCategory,
  findCatalogPiece,
} from './catalogPieces';
export type {
  BuilderPieceType,
  CatalogPiece,
  CatalogPieceCategory,
  CatalogRowLayout,
  CatalogThumbnailKind,
} from './catalogPieces';

export { CatalogPanel, CATALOG_PANEL_COLORS } from './CatalogPanel';
export type { CatalogPanelOptions, CatalogRowHitRect } from './CatalogPanel';

// AC 20003 Sub-AC 3 — Grid-based canvas area: bounds geometry + snap-cursor math.
export {
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
export type {
  BoundsRect,
  CanvasAreaSpec,
  SnapCursorState,
} from './canvasBounds';

// AC 20003 Sub-AC 3 — Phaser host component for the canvas area.
export { CANVAS_AREA_COLORS, CANVAS_AREA_STROKES, CanvasArea } from './CanvasArea';
export type { CanvasAreaLayerFlags, CanvasAreaOptions } from './CanvasArea';

// AC 20101 Sub-AC 1 — Phaser-free drag-and-drop state machine.
export {
  DragDropController,
  computeSnapTarget,
  findCatalogHitAt,
  isPieceInCanvasBounds,
  viewportToCanvas,
} from './dragDrop';
export type {
  DragDropOptions,
  DragGhostState,
  DragPhase,
  PlacedPiece,
  SnapTarget,
} from './dragDrop';

// AC 20101 Sub-AC 1 — Phaser host that paints the drag ghost preview.
export { GhostPreview, GHOST_PREVIEW_COLORS } from './GhostPreview';
export type { GhostPreviewOptions, GhostPreviewVisualState } from './GhostPreview';

// AC 20102 Sub-AC 2 — Phaser-free stage-data model + placed-piece renderer.
export {
  STAGE_PIECE_LIMIT,
  StageDataModel,
  formatPlacedCountLabel,
} from './stageDataModel';
export type {
  AddPieceRejection,
  AddPieceResult,
  RegisteredPiece,
  StageDataModelListener,
  StageDataModelOptions,
} from './stageDataModel';
export {
  PLACED_PIECE_COLORS,
  PlacedPieceRenderer,
} from './PlacedPieceRenderer';
export type {
  PlacedPieceRendererOptions,
  PlacedPieceVisual,
} from './PlacedPieceRenderer';

// AC 20103 Sub-AC 3 — Phaser-free placement-validation rules. Exposes
// the unified validator the controller, the registry, and the ghost
// renderer all consume so per-rule visual feedback stays consistent.
export {
  HAZARD_NEAR_SPAWN_BUFFER_CELLS,
  HAZARD_PIECE_TYPES,
  describePlacementRejection,
  findHazardSpawnConflict,
  findOverlappingPiece,
  inflateRect,
  isHazardType,
  isSpawnType,
  rectsOverlap,
  validatePlacement,
} from './placementValidation';
export type {
  PlacementCandidate,
  PlacementRejectionReason,
  PlacementValidationResult,
  RegisteredCandidate,
} from './placementValidation';

// AC 20101 Sub-AC 1 — Stage serialization schema (canonical types,
// version constant, and a Result-style integrity validator). The
// serializer module below is the legacy declaration site for the
// types; this module re-exports them under schema-centric names plus
// adds `validateStageData` / `validateStageIndex` for non-throwing
// integrity checks at boundaries (file import, replay desync detector).
export {
  STAGE_SCHEMA_LIMITS,
  STAGE_SCHEMA_VERSION,
  isValidStageData,
  isValidStageIndex,
  validateStageData,
  validateStageEnvelope,
  validateStageIndex,
  validateStageIndexEnvelope,
} from './stageSchema';
export type {
  StageValidationFailure,
  StageValidationFailureReason,
  StageValidationResult,
  StageValidationSuccess,
} from './stageSchema';

// AC 20104 Sub-AC 3 — Phaser-free custom-stage save/load with named
// slots. Two modules:
//
//   • `customStageSerializer` — versioned envelopes + canonical JSON.
//   • `customStageStorage`    — localStorage IO with namespaced keys
//                               and a slot index.
export {
  CUSTOM_STAGE_NAME_MAX_LENGTH,
  CUSTOM_STAGE_NAME_MIN_LENGTH,
  CUSTOM_STAGE_MIN_CANVAS_PX,
  CUSTOM_STAGE_SCHEMA_VERSION,
  CUSTOM_STAGE_SLOT_ID_MAX_LENGTH,
  RECOGNISED_PIECE_TYPES,
  assertValidCustomStageData,
  assertValidCustomStageIndexData,
  assertValidCustomStageName,
  assertValidGridSpec,
  assertValidStagePiece,
  buildCustomStageData,
  customStageSlotIdFromName,
  deserializeCustomStage,
  deserializeCustomStageIndex,
  detectSerializedKind as detectCustomStageSerializedKind,
  safeDeserializeCustomStage,
  safeDeserializeCustomStageIndex,
  serializeCustomStage,
  serializeCustomStageIndex,
  toSerializedGridSpec,
  toSerializedPiece,
} from './customStageSerializer';
export type {
  CustomStageData,
  CustomStageIndexData,
  CustomStageIndexEntry,
  DeserializeResult as CustomStageDeserializeResult,
  SerializedCustomStage,
  SerializedCustomStageIndex,
  SerializedCustomStageKind,
  SerializedGridSpec,
  SerializedStagePiece,
} from './customStageSerializer';

export {
  STORAGE_APP_NAMESPACE as CUSTOM_STAGE_STORAGE_APP_NAMESPACE,
  STORAGE_CUSTOM_STAGES_DOMAIN,
  STORAGE_CUSTOM_STAGES_VERSION_SEGMENT,
  clearAllCustomStages,
  deleteCustomStage,
  hasCustomStage,
  hasCustomStageByName,
  indexStorageKey as customStageIndexStorageKey,
  inspectCustomStageIndex,
  listCustomStages,
  loadCustomStage,
  loadCustomStageByName,
  saveCustomStage,
  stageStorageKey as customStageSlotStorageKey,
  toPlacedPiece,
  toPlacedPieces,
} from './customStageStorage';
export type {
  CustomStageStorageErrorCode,
  DetailedStorageResult as CustomStageStorageResult,
  SaveCustomStageOptions,
  StorageLike as CustomStageStorageLike,
} from './customStageStorage';

// AC 20103 Sub-AC 3 — Save/load UI controls wired to the persistence
// layer with slot naming, overwrite confirmation, and validation error
// handling. Two modules:
//
//   • `saveLoadController` — Phaser-free state machine + storage driver.
//   • `SaveLoadDialog`     — Phaser host that paints the toolbar buttons
//                            and the modal panel that mirrors the
//                            controller's view.
export {
  SaveLoadController,
  defaultSaveLoadStorageDriver,
  describeLoadError,
  describeSaveError,
  validateNameDraft,
} from './saveLoadController';
export type {
  LoadFailure,
  SaveLoadApplyLoad,
  SaveLoadConfirmOverwriteView,
  SaveLoadController as SaveLoadControllerType,
  SaveLoadControllerOptions,
  SaveLoadLastResult,
  SaveLoadListener,
  SaveLoadLoadErrorView,
  SaveLoadLoadListView,
  SaveLoadLoadSuccessView,
  SaveLoadRegistrySource,
  SaveLoadSaveErrorView,
  SaveLoadSavePromptView,
  SaveLoadSaveSuccessView,
  SaveLoadStorageDriver,
  SaveLoadToolbarView,
  SaveLoadView,
  SaveLoadViewKind,
  SaveValidationCode,
  SaveValidationFailure,
} from './saveLoadController';
export { SAVE_LOAD_DIALOG_COLORS, SaveLoadDialog } from './SaveLoadDialog';
export type { SaveLoadDialogOptions } from './SaveLoadDialog';
