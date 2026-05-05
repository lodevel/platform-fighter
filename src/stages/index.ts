/**
 * Stage module.
 *
 * Public surface:
 *   - `stageDefinitions` exposes the built-in stage data records
 *     (Phaser-free, importable by tests / the stage builder / replay
 *     tooling).
 *   - `StageRenderer` turns a `StageLayout` into Matter bodies and
 *     Phaser visuals inside a live scene.
 *
 * Built-in hazard stages (4 in M2) and the runtime that loads
 * custom stages from the builder will plug into this module.
 */

export {
  FLAT_STAGE,
  FLAT_STAGE_DEFAULTS,
  LAVA_STAGE,
  LAVA_STAGE_DEFAULTS,
  WIND_STAGE,
  WIND_STAGE_DEFAULTS,
  CRUMBLING_STAGE,
  CRUMBLING_STAGE_DEFAULTS,
  MOVING_PLATFORM_STAGE,
  MOVING_PLATFORM_STAGE_DEFAULTS,
  STAGES,
  STAGE_DESIGN_WIDTH,
  STAGE_DESIGN_HEIGHT,
  createFlatStage,
  createLavaStage,
  createWindStage,
  createCrumblingStage,
  createMovingPlatformStage,
  getStage,
  type FlatStageOptions,
  type LavaStageOptions,
  type WindStageOptions,
  type CrumblingStageOptions,
  type MovingPlatformStageOptions,
} from './stageDefinitions';

export {
  renderStage,
  PLATFORM_LABELS,
  BLAST_ZONE_LABELS,
  type RenderedStage,
  type StageRenderOptions,
} from './StageRenderer';

// AC 20101 Sub-AC 1 — `BaseStage` is the shared stage runtime contract
// that consolidates geometry loading, platform colliders, spawn points,
// blast zones, and hazard lifecycle hooks into a single class the
// gameplay loop drives via `tickHazards`/`applyHazardEffects`/`updateRender`.
// See module header for the full design rationale.
export {
  BaseStage,
} from './BaseStage';
export type {
  BaseStageOptions,
  LavaKoListener,
  StageViewportTransform,
  ViewportPoint,
  WindForceListener,
} from './BaseStage';

// Sub-AC 1 of AC 90301: schema-level platform behavior helpers.
// `getPlatformBehavior()` is the single source of truth for resolving
// the canonical behavior across the existing legacy `passThrough`
// boolean and the new explicit `behavior` field.
export {
  getPlatformBehavior,
  isPassThroughPlatform,
  isMovingPlatform,
  resolveMovingPlatformMotion,
  validateMovingPlatformMotion,
  validateStagePlatform,
  MOVING_PLATFORM_MOTION_DEFAULTS,
  PLATFORM_BEHAVIORS,
} from './platformBehavior';

// Sub-AC 3 of AC 90303: runtime collision toggling for platforms.
// Pairs with the schema layer above — `getPlatformBehavior()` resolves
// what a platform is, `computePlatformColliderState()` resolves how it
// should be filtering collisions *right now* (drop-through, crumble
// fallen, normal). The `togglePlatformCollision()` convenience entry
// composes compute + apply for the simple "every fixed step" path used
// by `StageRenderer` and the crumble adapter.
export {
  computePlatformColliderState,
  applyPlatformColliderState,
  togglePlatformCollision,
  PLATFORM_COLLIDER_MODES,
  type PlatformColliderMode,
  type PlatformColliderState,
  type PlatformColliderInput,
  type ToggleablePlatformBody,
} from './platformCollisionToggle';

// Sub-AC 3 of AC 9: lava hazard renderer — bridges StageHazard
// authoring records → LavaHazard runtime entities → Matter sensor
// bodies + Phaser visuals. Lives next to StageRenderer because it
// is the second member of the "turn StageLayout data into live
// scene actors" family.
export {
  renderLavaHazard,
  renderLavaHazards,
  createLavaHazardFromStageHazard,
  computeStageViewportTransform,
  DEFAULT_LAVA_VISUAL_COLORS,
  type RenderedLavaHazard,
  type LavaHazardsRenderResult,
  type LavaRenderOptions,
  type LavaVisualOptions,
} from './LavaHazardRenderer';

// AC 10102 Sub-AC 2: wind hazard renderer — sister of the lava
// renderer above. Bridges StageHazard 'wind' records → WindZoneHazard
// runtime entities → Matter sensor bodies + Phaser visuals. The
// owning scene composes this with `WindForceController` to apply the
// per-frame gust force to overlapping fighters.
export {
  renderWindHazard,
  renderWindHazards,
  createWindHazardFromStageHazard,
  DEFAULT_WIND_VISUAL_COLORS,
  type RenderedWindHazard,
  type WindHazardsRenderResult,
  type WindRenderOptions,
  type WindVisualOptions,
} from './WindHazardRenderer';

// Sub-AC 4 of AC 90304: platform visual-state computation +
// Phaser-side binder. The pure module computes a `PlatformVisualState`
// hint set from a platform's behavior + runtime entity state; the
// binder applies that hint set to a Phaser GameObject each frame so
// the sprite/tint/animation transitions reflect the platform's active
// state at runtime.
export {
  computePlatformVisualState,
  computeMovingPlatformOffset,
  PLATFORM_VISUAL_TINTS,
  PLATFORM_WOBBLE_MAX_PX,
  PLATFORM_WOBBLE_DEFAULT_FRAME,
  type PlatformVisualState,
  type PlatformVisualInput,
  type PlatformOutlineMode,
} from './platformVisualState';
export {
  createPlatformVisualBinder,
  bindPlatformRectangle,
  PLATFORM_GHOST_STROKE_WIDTH,
  PLATFORM_OVERLAY_STROKE_WIDTH,
  type BindablePlatformVisual,
  type PlatformVisualBinder,
} from './PlatformVisualBinder';

// AC 20104 Sub-AC 4 — saved-stage → runtime stage layout converter.
// Wires the M3 builder's `CustomStageData` (loaded from localStorage
// via `customStageStorage`) into the runtime stage pipeline so a
// custom stage can be selected and played as a live match.
export {
  CUSTOM_STAGE_ID_PREFIX,
  CUSTOM_STAGE_BLAST_ZONE_OUTSET,
  CUSTOM_LAVA_CYCLE_FRAMES,
  CUSTOM_WIND_CYCLE_FRAMES,
  CUSTOM_MOVING_PLATFORM_CYCLE_FRAMES,
  CUSTOM_MOVING_PLATFORM_SWEEP_PX,
  buildBlastZoneForCanvas,
  buildFallbackSpawnPoints,
  customStageDataToStageLayout,
  customStageRuntimeId,
  customStageSlotIdFromRuntimeId,
  hazardFromBuilderPiece,
  isCustomStageId,
  platformFromBuilderPiece,
  type CustomStageLoaderOptions,
} from './customStageLoader';

// AC 20102 Sub-AC 2 — Stage 1 (lava) public surface. Re-exports the
// canonical layout, factory, defaults, and loader-registration check
// under explicit Stage 1 names so call sites that reason about "Stage 1"
// have a single landing site instead of having to know that "Stage 1"
// is implemented as `LAVA_STAGE` inside `stageDefinitions.ts`.
export {
  STAGE_1,
  STAGE_1_DEFAULTS,
  STAGE_1_DISPLAY_INFO,
  STAGE_1_ID,
  STAGE_1_LOADER_BINDING,
  Stage1RegistrationError,
  assertStage1RegisteredWithLoader,
  createStage1,
  type Stage1Id,
  type Stage1Options,
} from './Stage1';

// AC 20103 Sub-AC 3 — Stage 2 (wind) public surface. Mirror of the
// Stage 1 export shape: explicit Stage 2 names front the canonical
// `WIND_STAGE` / `WIND_STAGE_DEFAULTS` / `createWindStage` so a call
// site that reasons about "Stage 2" has a dedicated landing module
// instead of having to know Stage 2 is implemented as `WIND_STAGE`
// inside `stageDefinitions.ts`.
export {
  STAGE_2,
  STAGE_2_DEFAULTS,
  STAGE_2_DISPLAY_INFO,
  STAGE_2_ID,
  STAGE_2_LOADER_BINDING,
  Stage2RegistrationError,
  assertStage2RegisteredWithLoader,
  createStage2,
  type Stage2Id,
  type Stage2Options,
} from './Stage2';

// AC 20104 Sub-AC 4 — Stage 3 (crumbling) public surface. Mirror of
// the Stage 1 / Stage 2 export shape: explicit Stage 3 names front
// the canonical `CRUMBLING_STAGE` / `CRUMBLING_STAGE_DEFAULTS` /
// `createCrumblingStage` so a call site that reasons about "Stage 3"
// has a dedicated landing module instead of having to know Stage 3 is
// implemented as `CRUMBLING_STAGE` inside `stageDefinitions.ts`.
export {
  STAGE_3,
  STAGE_3_DEFAULTS,
  STAGE_3_DISPLAY_INFO,
  STAGE_3_ID,
  STAGE_3_LOADER_BINDING,
  Stage3RegistrationError,
  assertStage3RegisteredWithLoader,
  createStage3,
  type Stage3Id,
  type Stage3Options,
} from './Stage3';

// AC 20105 Sub-AC 5 — Stage 4 (moving-platform) public surface. Mirror
// of the Stage 1 / Stage 2 / Stage 3 export shape: explicit Stage 4
// names front the canonical `MOVING_PLATFORM_STAGE` /
// `MOVING_PLATFORM_STAGE_DEFAULTS` / `createMovingPlatformStage` so a
// call site that reasons about "Stage 4" has a dedicated landing module
// instead of having to know Stage 4 is implemented as
// `MOVING_PLATFORM_STAGE` inside `stageDefinitions.ts`. Stage 4 is also
// the only built-in stage that simultaneously exercises all three
// platform behavior types (`'solid'` + `'pass-through'` + `'moving'`)
// in one layout.
export {
  STAGE_4,
  STAGE_4_DEFAULTS,
  STAGE_4_DISPLAY_INFO,
  STAGE_4_ID,
  STAGE_4_LOADER_BINDING,
  Stage4RegistrationError,
  assertStage4RegisteredWithLoader,
  createStage4,
  type Stage4Id,
  type Stage4Options,
} from './Stage4';

// AC 20201 Sub-AC 1 — canonical stage-data deserializer / parser.
// Combines the schema validator (`stageSchema.validateStageEnvelope`)
// + the `customStageDataToStageLayout` converter into a single
// JSON-string → in-memory `StageLayout` pipeline so the load dialog,
// the future "Import stage" file-drop UI, and the replay rehydrator
// share one entry point.
export {
  blastZoneFromParsed,
  hazardsFromParsed,
  isParseableStageJson,
  parseStageData,
  parseStageEnvelope,
  parseStageJson,
  parseStageJsonOrThrow,
  platformsFromParsed,
  spawnPointsFromParsed,
} from './stageDataParser';
export type {
  ParsedStage,
  ParseStageOptions,
  StageValidationFailure as StageParserFailure,
  StageValidationFailureReason as StageParserFailureReason,
  StageValidationResult as StageParserResult,
} from './stageDataParser';
