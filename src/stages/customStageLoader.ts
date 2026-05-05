/**
 * Bridge between the M3 stage builder's saved-stage data and the live
 * `StageLayout` shape the M2 stage renderer / blast-zone watcher /
 * camera consume.
 *
 * AC 20104 Sub-AC 4 — "Wire saved-stage loader into match flow so a
 * custom stage can be selected and played as a live match".
 *
 * Why a dedicated module
 * ----------------------
 *
 *   • The builder authors pieces in a *canvas-relative* coordinate
 *     system whose top-left is `(0, 0)`. The runtime stage authoring
 *     constants live in design pixels with the canonical 1920×1080
 *     viewport's top-left at `(0, 0)`. Custom canvases up to 2× screen
 *     are allowed, so a placed piece's `(canvasX, canvasY)` already
 *     lines up with design coordinates one-for-one — no scaling, no
 *     translation. This module's main job is therefore to map each
 *     {@link BuilderPieceType} onto either a {@link StagePlatform} or a
 *     {@link StageHazard}, and to extract spawn-points + a sensible
 *     blast-zone envelope so the runtime has everything `StageRenderer`
 *     needs.
 *
 *   • Keeping the conversion Phaser-free means the unit suite can
 *     exercise every branch (each of the 8 catalog piece types, the
 *     "no spawn points" fallback, the per-canvas blast zone) without
 *     booting a scene — same testability discipline used by every other
 *     `customStage*` helper in this codebase.
 *
 *   • A future sub-AC (e.g. "preview a custom stage in the builder")
 *     can re-use the same converter to drive a Phaser preview scene
 *     without re-implementing the geometry mapping.
 *
 * Determinism
 * -----------
 *
 *   • Pure data transform — no `Math.random()`, no wall-clock reads.
 *   • Inserts pieces in registry order so a replay that records the
 *     original placement order can re-derive the runtime body order
 *     byte-identically.
 *   • Spawn points fall back to a deterministic four-corner pattern
 *     when the player saved no `spawn-point` pieces, so a custom stage
 *     missing spawn markers still produces a playable match instead of
 *     crashing the runtime's spawn-point allocator.
 */

import type {
  BlastZone,
  ItemSpawnAnchor,
  StageHazard,
  StageLayout,
  StagePlatform,
} from '../types';
import type {
  CustomStageData,
  SerializedStagePiece,
} from '../builder/customStageSerializer';
import { LAVA_DEFAULTS } from '../entities/LavaHazard';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Stable id-prefix for runtime stage layouts produced from saved custom
 * stages. Keeping the namespace explicit means:
 *
 *   • A built-in stage id (`'flat'`, `'lava'`, …) can never collide with
 *     a custom-stage slot id, even if a player names their save "flat".
 *   • The match-replay header / save-file metadata can detect a custom
 *     stage at parse time without consulting the storage layer.
 *   • The match-flow router (`MatchScene.create`) can branch on the
 *     prefix to pick the saved-stage loader vs. the built-in registry
 *     without an extra indirection through the storage layer.
 */
export const CUSTOM_STAGE_ID_PREFIX = 'custom:';

/**
 * Compose the runtime stage id for a saved-stage slot.
 *
 * `customStageRuntimeId('lava-tower')` → `'custom:lava-tower'`.
 */
export function customStageRuntimeId(slotId: string): string {
  return `${CUSTOM_STAGE_ID_PREFIX}${slotId}`;
}

/**
 * `true` iff the given stage id refers to a saved custom stage rather
 * than a built-in. Used by `MatchScene.create` (and the future replay
 * loader) to branch the stage-resolution path.
 */
export function isCustomStageId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(CUSTOM_STAGE_ID_PREFIX);
}

/**
 * Recover the slot id from a runtime custom-stage id. Returns the
 * input verbatim when the id has no prefix so callers can pass either
 * shape interchangeably.
 */
export function customStageSlotIdFromRuntimeId(id: string): string {
  if (typeof id !== 'string') return '';
  return id.startsWith(CUSTOM_STAGE_ID_PREFIX)
    ? id.slice(CUSTOM_STAGE_ID_PREFIX.length)
    : id;
}

/**
 * Outset (design pixels) the blast zone extends past each canvas edge.
 * Mirrors the per-edge envelope the built-in stages use so a custom
 * stage feels the same to play — fighters knocked through the canvas
 * edge get the same recovery window the built-ins offer.
 *
 * Tuned to match `BLAST_ZONE_OUTSET` in `stageDefinitions.ts` exactly
 * (kept literal here so this module stays Phaser-free without a
 * cross-import on the private constant).
 */
export const CUSTOM_STAGE_BLAST_ZONE_OUTSET = Object.freeze({
  horizontal: 240,
  top: 280,
  bottom: 240,
});

/**
 * Default cycle length for converted lava-zone pieces, in fixed frames.
 * Re-used from the canonical built-in lava stage's tuning so a custom
 * stage's lava behaves identically to the M2 lava stage's pools — a
 * predictable rise / fall rhythm rather than something the player
 * would have to learn from scratch.
 */
export const CUSTOM_LAVA_CYCLE_FRAMES = 480;

/**
 * Default cycle length for converted wind-zone pieces, in fixed frames.
 * Mirrors the built-in wind stage's gust period.
 */
export const CUSTOM_WIND_CYCLE_FRAMES = 360;

/**
 * Default cycle length for converted moving-platform pieces, in fixed
 * frames. Long enough that a horizontal sweep feels like a ferry rather
 * than a treadmill.
 */
export const CUSTOM_MOVING_PLATFORM_CYCLE_FRAMES = 360;

/**
 * Default horizontal sweep distance for converted moving platforms, in
 * design pixels — used when the saved piece doesn't carry an explicit
 * waypoint (the M3 builder doesn't yet author paths). The platform
 * ping-pongs ±half the sweep around its placed centre.
 */
export const CUSTOM_MOVING_PLATFORM_SWEEP_PX = 240;

// ---------------------------------------------------------------------------
// Pure conversion helpers
// ---------------------------------------------------------------------------

/** Centre coordinate of a placed piece (top-left → centre). */
function pieceCentreX(piece: SerializedStagePiece): number {
  return piece.canvasX + piece.width / 2;
}

function pieceCentreY(piece: SerializedStagePiece): number {
  return piece.canvasY + piece.height / 2;
}

/**
 * Map a builder piece to a `StagePlatform` body when its catalog
 * category is "platform" (flat, slope, wall, drop-through). Returns
 * `null` for non-platform types so the caller can route the piece
 * elsewhere (hazards, spawn points, etc.).
 *
 * Slope ramps are mapped to `'solid'` for v1 — the renderer doesn't yet
 * support angled colliders. Tracked under the M3 follow-up backlog;
 * mapping to a solid block is the safe fallback that keeps the stage
 * playable rather than rejecting the save outright.
 */
export function platformFromBuilderPiece(
  piece: SerializedStagePiece,
  index: number,
): StagePlatform | null {
  const x = pieceCentreX(piece);
  const y = pieceCentreY(piece);
  switch (piece.type) {
    case 'flat-platform':
      return {
        x,
        y,
        width: piece.width,
        height: piece.height,
        passThrough: false,
        behavior: 'solid',
        id: `custom-flat-${index}`,
      };
    case 'slope-ramp':
      // v1 fallback: render as a solid box. The renderer doesn't yet
      // support 45° colliders. Authoring intent is preserved through
      // the original piece type at save time so a future renderer can
      // upgrade the visual without re-saving.
      return {
        x,
        y,
        width: piece.width,
        height: piece.height,
        passThrough: false,
        behavior: 'solid',
        id: `custom-slope-${index}`,
      };
    case 'wall':
      return {
        x,
        y,
        width: piece.width,
        height: piece.height,
        passThrough: false,
        behavior: 'solid',
        id: `custom-wall-${index}`,
      };
    case 'drop-through-platform':
      return {
        x,
        y,
        width: piece.width,
        height: piece.height,
        passThrough: true,
        behavior: 'pass-through',
        id: `custom-droppthrough-${index}`,
      };
    case 'moving-platform':
      // Convert to a kinematic moving platform that ping-pongs across
      // a horizontal sweep around the placed centre. The waypoint
      // shape mirrors the built-in moving-platform stage so the
      // renderer's existing motion path handles it without changes.
      return {
        x,
        y,
        width: piece.width,
        height: piece.height,
        passThrough: false,
        behavior: 'moving',
        motion: {
          waypoints: [
            { x: -CUSTOM_MOVING_PLATFORM_SWEEP_PX / 2, y: 0 },
            { x: CUSTOM_MOVING_PLATFORM_SWEEP_PX / 2, y: 0 },
          ],
          cycleFrames: CUSTOM_MOVING_PLATFORM_CYCLE_FRAMES,
          phaseFrames: 0,
          mode: 'ping-pong',
          easing: 'sine',
        },
        id: `custom-moving-${index}`,
      };
    default:
      return null;
  }
}

/**
 * Map a builder piece to a `StageHazard` record when the piece type is
 * a hazard (lava-zone, wind-zone). Moving platforms are NOT routed
 * through hazards — they live on the platform array (matching the
 * built-in `MOVING_PLATFORM_STAGE`) so the runtime doesn't have to
 * juggle two motion-driver code paths.
 *
 * Returns `null` for non-hazard piece types.
 */
export function hazardFromBuilderPiece(
  piece: SerializedStagePiece,
  index: number,
): StageHazard | null {
  switch (piece.type) {
    case 'lava-zone': {
      // Lava authoring convention: `(x, y)` is the centre-X / resting
      // bottom edge that the column grows up from. The builder authors
      // a top-left rectangle, so the bottom edge is `canvasY + height`.
      const cx = pieceCentreX(piece);
      const baseY = piece.canvasY + piece.height;
      return {
        type: 'lava',
        id: `custom-lava-${index}`,
        x: cx,
        y: baseY,
        width: piece.width,
        height: piece.height,
        cycleFrames: CUSTOM_LAVA_CYCLE_FRAMES,
        phaseFrames: 0,
        damagePerTick: LAVA_DEFAULTS.damagePerTick,
        activeThreshold: LAVA_DEFAULTS.activeThreshold,
        minHeight: 0,
      };
    }
    case 'wind-zone':
      return {
        type: 'wind',
        id: `custom-wind-${index}`,
        x: pieceCentreX(piece),
        y: pieceCentreY(piece),
        width: piece.width,
        height: piece.height,
        cycleFrames: CUSTOM_WIND_CYCLE_FRAMES,
        phaseFrames: 0,
      };
    default:
      return null;
  }
}

/**
 * Build a deterministic four-corner spawn pattern for a canvas of the
 * given dimensions. Used as the fallback when the saved stage carries
 * no `spawn-point` pieces — every match needs at least one spawn point
 * per joined slot, so we always produce four points.
 */
export function buildFallbackSpawnPoints(
  canvasWidth: number,
  canvasHeight: number,
): ReadonlyArray<{ x: number; y: number }> {
  // Spawn at 30% of the canvas height from the top so fighters drop
  // onto whatever ground sits below — matches the built-in stage
  // convention where spawns live above the playable surface.
  const spawnY = canvasHeight * 0.3;
  return Object.freeze([
    { x: canvasWidth * 0.25, y: spawnY },
    { x: canvasWidth * 0.4, y: spawnY },
    { x: canvasWidth * 0.6, y: spawnY },
    { x: canvasWidth * 0.75, y: spawnY },
  ]);
}

/**
 * Compute a blast zone envelope that extends past each canvas edge by
 * the canonical outset values. Mirrors the built-in stages' envelope
 * so KO behaviour (recovery window, off-stage drift) feels identical
 * to a player who is already familiar with the M2 hazard stages.
 */
export function buildBlastZoneForCanvas(
  canvasWidth: number,
  canvasHeight: number,
): BlastZone {
  return {
    left: -CUSTOM_STAGE_BLAST_ZONE_OUTSET.horizontal,
    right: canvasWidth + CUSTOM_STAGE_BLAST_ZONE_OUTSET.horizontal,
    top: -CUSTOM_STAGE_BLAST_ZONE_OUTSET.top,
    bottom: canvasHeight + CUSTOM_STAGE_BLAST_ZONE_OUTSET.bottom,
  };
}

// ---------------------------------------------------------------------------
// Public converter
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link customStageDataToStageLayout}.
 *
 *   • `runtimeIdOverride` — an explicit runtime stage id. Defaults to
 *     `customStageRuntimeId(<slot id derived from the saved name>)`
 *     when the caller passes a {@link CustomStageData} that has been
 *     loaded by id. The caller (`MatchScene`) supplies the slot id so
 *     the runtime layout's id round-trips through the replay header
 *     unambiguously.
 */
export interface CustomStageLoaderOptions {
  readonly runtimeIdOverride?: string;
}

/**
 * Convert a {@link CustomStageData} body — the shape returned by
 * `loadCustomStage()` — into a runtime-compatible {@link StageLayout}.
 *
 * The conversion preserves piece ordering: pieces are walked in
 * registry order, so the runtime body order matches what the player
 * authored. This is the single seam the match flow uses to play a
 * saved custom stage as a live match.
 */
export function customStageDataToStageLayout(
  data: CustomStageData,
  options: CustomStageLoaderOptions = {},
): StageLayout {
  const platforms: StagePlatform[] = [];
  const hazards: StageHazard[] = [];
  const spawnPoints: { x: number; y: number }[] = [];

  for (let i = 0; i < data.pieces.length; i += 1) {
    const piece = data.pieces[i]!;
    if (piece.type === 'spawn-point') {
      spawnPoints.push({
        x: pieceCentreX(piece),
        y: pieceCentreY(piece),
      });
      continue;
    }
    const platform = platformFromBuilderPiece(piece, i);
    if (platform) {
      platforms.push(platform);
      continue;
    }
    const hazard = hazardFromBuilderPiece(piece, i);
    if (hazard) {
      hazards.push(hazard);
      continue;
    }
    // Defensive: an unrecognised piece type is silently dropped.
    // The save-time validator already rejects unknown types, so this
    // branch should be unreachable in practice; we leave it as a
    // backstop so a forward-compatibility upgrade can ship a new piece
    // type without crashing older runtimes that haven't learned it yet.
  }

  // Always have at least four spawn points: pad with the fallback if
  // the saved stage didn't include enough markers. Four points is the
  // Seed-mandated max-player count (`maxPlayers: 4`); fewer points
  // would make a 3- or 4-player match unreachable on the custom stage.
  const fallback = buildFallbackSpawnPoints(
    data.gridSpec.width,
    data.gridSpec.height,
  );
  while (spawnPoints.length < fallback.length) {
    const next = fallback[spawnPoints.length];
    if (!next) break;
    spawnPoints.push({ x: next.x, y: next.y });
  }

  const id =
    options.runtimeIdOverride !== undefined
      ? options.runtimeIdOverride
      : customStageRuntimeId(toSlotIdFromName(data.name));

  // Custom stages don't yet author item spawn anchors (the M3 stage
  // builder gains an "item anchor" piece in a later sub-AC). Surface
  // an empty array so the runtime spawn manager — which reads
  // `layout.itemSpawnAnchors` — sees a well-formed list and treats
  // the stage as items-disabled until the builder adds the piece.
  // T3 / AC 10 Sub-AC 1.
  const itemSpawnAnchors: ReadonlyArray<ItemSpawnAnchor> = Object.freeze([]);

  return {
    id,
    platforms: Object.freeze(platforms),
    hazards: Object.freeze(hazards),
    blastZone: buildBlastZoneForCanvas(
      data.gridSpec.width,
      data.gridSpec.height,
    ),
    spawnPoints: Object.freeze(spawnPoints),
    itemSpawnAnchors,
  };
}

/**
 * Inline copy of the slot-id derivation rule from
 * `customStageSerializer.customStageSlotIdFromName`. Replicated here
 * so `customStageLoader.ts` doesn't induce a cyclic import between the
 * stages module and the builder module — both modules import from
 * `'../types'` and the engine constants, but only the loader pulls in
 * the serializer's data shape.
 *
 * Mirror of the canonical rules: trim → lowercase → replace runs of
 * non-alphanumerics with `-` → strip leading/trailing dashes → fall
 * back to `'stage'` if empty.
 */
function toSlotIdFromName(name: string): string {
  if (typeof name !== 'string') return 'stage';
  const trimmed = name.trim().toLowerCase();
  if (trimmed.length === 0) return 'stage';
  let id = trimmed.replace(/[^a-z0-9]+/g, '-');
  id = id.replace(/^-+|-+$/g, '');
  if (id.length === 0) return 'stage';
  return id;
}
