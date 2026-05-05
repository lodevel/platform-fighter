/**
 * Phaser-free placement-validation rules for the M3 stage builder.
 *
 * AC 20103 Sub-AC 3 — "Implement placement validation rules (bounds
 * checking, overlap/collision detection, hazard-specific constraints)
 * with visual feedback for invalid drops".
 *
 * Two earlier sub-ACs landed the *bones* of validation:
 *
 *   • `dragDrop.ts::isPieceInCanvasBounds` — rejects drops that clip the
 *     canvas frame.
 *   • `stageDataModel.ts::addPiece` — rejects unknown types, malformed
 *     geometry, out-of-bounds drops, and the 30-piece cap.
 *
 * What this module adds
 * ---------------------
 *
 *   1. **Overlap / collision detection.** Two pieces' axis-aligned
 *      bounding rectangles may not intersect. The builder is a
 *      "place once" editor — overlapping pieces would yield
 *      collision-system inconsistencies at runtime (which solid wins?
 *      does a hazard "see through" a platform?), and surface as save-
 *      time validation failures rather than helpful drop-time feedback.
 *      Detecting them at drop time gives the player immediate "you
 *      can't drop here" feedback.
 *
 *   2. **Hazard-specific constraints.** Two ontology-driven rules:
 *
 *        • A spawn-point may not be placed inside the *exclusion zone*
 *          of any hazard (lava-zone / wind-zone / moving-platform). The
 *          exclusion zone is the hazard's footprint expanded by one
 *          grid cell (40px) on each side so a freshly-spawned fighter
 *          isn't dropped right next to instant-KO geometry.
 *
 *        • A hazard may not be placed inside the exclusion zone of an
 *          existing spawn-point — the symmetric rule for the placement
 *          order "spawn first, then hazard". Without this the rule
 *          would only fire on placements in one order, and the player
 *          would (rightly) be confused.
 *
 *      These rules are deliberately narrow — they target the most
 *      acute "this would feel broken" cases the Seed's `hazard`
 *      ontology entry calls out. Future sub-ACs can layer richer
 *      constraints (e.g. "wind zones must not overlap moving platforms"
 *      for path determinism) on top by extending {@link PLACEMENT_VALIDATION_REASONS}.
 *
 *   3. **A unified `validatePlacement(...)` entry point** the drag-drop
 *      controller, the data-model registry, and the ghost renderer all
 *      consume so each surface gives the player consistent feedback.
 *
 * Why Phaser-free
 * ---------------
 *
 * Per the project's `code_architecture` evaluation principle, scenes
 * stay thin: lifecycle wiring + scene transitions only. Placement rules
 * are pure logic — `(piece, registry, gridSpec) → ok | rejection` — so
 * they live in a Phaser-free module the unit suite drives exhaustively
 * under plain Node.
 *
 * Determinism note: every helper here is a pure function of its
 * arguments. No module-level mutable state, no `Math.random()`, no
 * wall-clock reads. A replay that re-builds the same registry produces
 * the same validation verdicts byte-identically.
 */

import {
  DEFAULT_GRID_SPEC,
  type GridSpec,
} from './builderGrid';
import { findCatalogPiece, type BuilderPieceType } from './catalogPieces';
import { isPieceInCanvasBounds } from './dragDrop';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Reason a placement was rejected. Discriminated-union shape so
 * callers can `switch` on the value and pick the appropriate visual
 * feedback (red ghost vs. amber "spawn-too-close" tint, toast text,
 * etc.) without re-deriving the rule themselves.
 *
 *   • `out-of-bounds` — piece footprint clips the canvas frame.
 *   • `invalid-type` — the piece's `type` is not in the catalog.
 *   • `invalid-geometry` — non-finite / non-positive dimensions.
 *   • `overlap` — piece footprint intersects an existing piece.
 *   • `hazard-near-spawn` — a hazard placement falls inside a spawn
 *     point's safety buffer (or the symmetric case: a spawn placement
 *     falls inside a hazard's exclusion zone).
 */
export type PlacementRejectionReason =
  | 'out-of-bounds'
  | 'invalid-type'
  | 'invalid-geometry'
  | 'overlap'
  | 'hazard-near-spawn';

/**
 * Discriminated-union result of {@link validatePlacement}. The accept
 * branch carries no extra data; the reject branch carries the reason
 * plus (when applicable) the existing piece that conflicts so the UI
 * can highlight it.
 */
export type PlacementValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: PlacementRejectionReason;
      /** Existing piece that conflicts with this drop, if applicable. */
      readonly conflictId?: string;
    };

/**
 * Minimal "footprint with id" shape consumed by overlap / hazard
 * checks. Both `PlacedPiece` (drop-time payload) and
 * `RegisteredPiece` (post-commit registry entry) are structurally
 * compatible — we only read the AABB + the `type` for hazard rules.
 */
export interface PlacementCandidate {
  readonly type: BuilderPieceType | string;
  readonly canvasX: number;
  readonly canvasY: number;
  readonly width: number;
  readonly height: number;
}

/** Same shape, plus a stable id — for entries already in the registry. */
export interface RegisteredCandidate extends PlacementCandidate {
  readonly id: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hazard-near-spawn exclusion buffer expressed in *grid cells*. One
 * cell (40px) of padding around hazards is enough to catch the
 * "spawn touching the lava edge" foot-fault without forbidding
 * legitimate "spawn one cell above lava" stage layouts that turn the
 * spawn into a quick-falling drop.
 *
 * Exposed so the test suite + future tuning passes can drive the
 * inflation distance without re-deriving it from a magic number.
 */
export const HAZARD_NEAR_SPAWN_BUFFER_CELLS = 1;

/**
 * The full set of `BuilderPieceType` values the validator considers
 * "hazard-like" for the spawn-distance rule. Matches the catalog's
 * `category === 'hazard'` set: lava, wind, moving platform.
 */
export const HAZARD_PIECE_TYPES: ReadonlyArray<BuilderPieceType> = Object.freeze([
  'lava-zone',
  'wind-zone',
  'moving-platform',
]);

// ---------------------------------------------------------------------------
// Pure geometry helpers — exported so the unit suite drives every branch.
// ---------------------------------------------------------------------------

/**
 * Axis-aligned rectangle overlap test. Inclusive on the trailing
 * edge would leave two pieces sharing a single cell-edge pixel "non-
 * overlapping" — that's the right call for the builder's grid model
 * because pieces are conventionally drawn at top-left corners and a
 * pixel-perfect cell-edge contact reads to the player as "side by
 * side", not "overlapping".
 *
 * Returns `false` for any non-finite input (NaN/±Infinity coordinates
 * propagate from a malformed payload — fall through to "no overlap"
 * so the validator can surface the *real* malformed-geometry reason
 * instead of a misleading overlap rejection).
 */
export function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  if (
    !Number.isFinite(ax) ||
    !Number.isFinite(ay) ||
    !Number.isFinite(aw) ||
    !Number.isFinite(ah) ||
    !Number.isFinite(bx) ||
    !Number.isFinite(by) ||
    !Number.isFinite(bw) ||
    !Number.isFinite(bh)
  ) {
    return false;
  }
  if (aw <= 0 || ah <= 0 || bw <= 0 || bh <= 0) return false;
  // Standard separating-axis test: rectangles overlap iff each axis
  // shows a positive intersection. Trailing-edge contact (ax + aw === bx)
  // counts as "no overlap" by design — see helper docblock.
  if (ax + aw <= bx) return false;
  if (bx + bw <= ax) return false;
  if (ay + ah <= by) return false;
  if (by + bh <= ay) return false;
  return true;
}

/**
 * Inflate an axis-aligned rectangle by `padding` design pixels on
 * every side. Used by the hazard-near-spawn rule to compute the
 * spawn-exclusion zone around each hazard footprint.
 *
 * Negative or non-finite padding returns the input rectangle
 * unchanged — the caller never wants the exclusion zone to *shrink*
 * the source rectangle, and a NaN buffer should fall through to
 * "no extra padding" rather than poisoning downstream math.
 */
export function inflateRect(
  x: number,
  y: number,
  w: number,
  h: number,
  padding: number,
): { x: number; y: number; width: number; height: number } {
  const safePad =
    Number.isFinite(padding) && padding > 0 ? padding : 0;
  return {
    x: x - safePad,
    y: y - safePad,
    width: w + safePad * 2,
    height: h + safePad * 2,
  };
}

/**
 * `true` iff the given piece type is a hazard per the catalog
 * (category === 'hazard'). Used by the hazard-near-spawn rule.
 */
export function isHazardType(type: BuilderPieceType | string): boolean {
  const meta = findCatalogPiece(type);
  return meta?.category === 'hazard';
}

/**
 * `true` iff the given piece type is a spawn marker. Currently the
 * catalog has exactly one spawn type; surfaced as a helper so future
 * spawn variants (e.g. team-tagged spawns) inherit the rule.
 */
export function isSpawnType(type: BuilderPieceType | string): boolean {
  return type === 'spawn-point';
}

// ---------------------------------------------------------------------------
// Rule lookups — exported so the controller / ghost / model can each
// consume the helper that matches its surface.
// ---------------------------------------------------------------------------

/**
 * Find the first registered piece whose AABB overlaps the candidate's.
 * Returns the conflicting entry or `null` if the candidate's
 * footprint is clear. Iteration is in registry insertion order so the
 * "earliest placed conflict" wins — the player sees their original
 * piece highlighted rather than a downstream piece they don't
 * remember placing.
 */
export function findOverlappingPiece(
  candidate: PlacementCandidate,
  registry: ReadonlyArray<RegisteredCandidate>,
  ignoreId: string | null = null,
): RegisteredCandidate | null {
  for (const entry of registry) {
    if (ignoreId !== null && entry.id === ignoreId) continue;
    if (
      rectsOverlap(
        candidate.canvasX,
        candidate.canvasY,
        candidate.width,
        candidate.height,
        entry.canvasX,
        entry.canvasY,
        entry.width,
        entry.height,
      )
    ) {
      return entry;
    }
  }
  return null;
}

/**
 * Find the first registered piece that violates the hazard-near-spawn
 * rule against the candidate. Returns the conflicting entry (the
 * existing hazard or spawn) or `null`.
 *
 * Two symmetric branches:
 *
 *   • Candidate is a spawn-point → check every existing hazard's
 *     inflated exclusion zone.
 *   • Candidate is a hazard → check every existing spawn-point with
 *     the candidate's *own* footprint inflated by the buffer.
 *
 * If the candidate is neither a hazard nor a spawn-point, the rule is
 * inert and the function returns `null`.
 */
export function findHazardSpawnConflict(
  candidate: PlacementCandidate,
  registry: ReadonlyArray<RegisteredCandidate>,
  gridSpec: GridSpec = DEFAULT_GRID_SPEC,
  ignoreId: string | null = null,
): RegisteredCandidate | null {
  const buffer = HAZARD_NEAR_SPAWN_BUFFER_CELLS * gridSpec.cellPx;
  const candidateIsSpawn = isSpawnType(candidate.type);
  const candidateIsHazard = isHazardType(candidate.type);
  if (!candidateIsSpawn && !candidateIsHazard) return null;

  for (const entry of registry) {
    if (ignoreId !== null && entry.id === ignoreId) continue;

    // Spawn candidate vs existing hazard — inflate the hazard's box
    // and test the spawn against it.
    if (candidateIsSpawn && isHazardType(entry.type)) {
      const inflated = inflateRect(
        entry.canvasX,
        entry.canvasY,
        entry.width,
        entry.height,
        buffer,
      );
      if (
        rectsOverlap(
          candidate.canvasX,
          candidate.canvasY,
          candidate.width,
          candidate.height,
          inflated.x,
          inflated.y,
          inflated.width,
          inflated.height,
        )
      ) {
        return entry;
      }
    }

    // Hazard candidate vs existing spawn — inflate the candidate
    // hazard so the same buffer applies regardless of which piece
    // got placed first.
    if (candidateIsHazard && isSpawnType(entry.type)) {
      const inflated = inflateRect(
        candidate.canvasX,
        candidate.canvasY,
        candidate.width,
        candidate.height,
        buffer,
      );
      if (
        rectsOverlap(
          entry.canvasX,
          entry.canvasY,
          entry.width,
          entry.height,
          inflated.x,
          inflated.y,
          inflated.width,
          inflated.height,
        )
      ) {
        return entry;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Unified validator — the single entry point each consumer uses.
// ---------------------------------------------------------------------------

/**
 * Run every placement rule in priority order:
 *
 *   1. catalog identity (`invalid-type`)
 *   2. footprint geometry (`invalid-geometry`)
 *   3. canvas bounds (`out-of-bounds`)
 *   4. hazard-spawn proximity (`hazard-near-spawn`)
 *   5. AABB overlap (`overlap`)
 *
 * Earliest-failure-wins so the rejection reason is the most specific
 * one the system can determine. A drop that simultaneously overlaps a
 * piece AND a hazard exclusion zone surfaces the more meaningful
 * `hazard-near-spawn` reason — overlap is the catch-all backstop.
 *
 * `ignoreId` is used by future "edit in place" flows where a piece is
 * being moved: the registry entry being moved is excluded from
 * overlap / hazard checks against itself.
 */
export function validatePlacement(
  candidate: PlacementCandidate,
  registry: ReadonlyArray<RegisteredCandidate> = [],
  gridSpec: GridSpec = DEFAULT_GRID_SPEC,
  ignoreId: string | null = null,
): PlacementValidationResult {
  // Catalog identity — earliest fail so a malformed payload doesn't
  // leak through to the geometry checks (`findCatalogPiece` returning
  // `undefined` is the canonical "type not in catalog" signal).
  const meta = findCatalogPiece(candidate.type);
  if (!meta) return { ok: false, reason: 'invalid-type' };

  // Geometry sanity — non-finite / non-positive dims are unrenderable.
  if (
    !Number.isFinite(candidate.canvasX) ||
    !Number.isFinite(candidate.canvasY) ||
    !Number.isFinite(candidate.width) ||
    !Number.isFinite(candidate.height) ||
    candidate.width <= 0 ||
    candidate.height <= 0
  ) {
    return { ok: false, reason: 'invalid-geometry' };
  }

  // Canvas bounds — same helper the drag controller uses for the
  // ghost preview, so what the player sees IS what the validator
  // accepts.
  if (
    !isPieceInCanvasBounds(
      candidate.canvasX,
      candidate.canvasY,
      candidate.width,
      candidate.height,
      gridSpec,
    )
  ) {
    return { ok: false, reason: 'out-of-bounds' };
  }

  // Hazard-near-spawn — surfaced before the generic overlap check so
  // the player gets the specific rule explanation, not the catch-all.
  const hazardConflict = findHazardSpawnConflict(
    candidate,
    registry,
    gridSpec,
    ignoreId,
  );
  if (hazardConflict) {
    return {
      ok: false,
      reason: 'hazard-near-spawn',
      conflictId: hazardConflict.id,
    };
  }

  // Generic AABB overlap — the catch-all "two pieces in the same
  // cell" rule.
  const overlap = findOverlappingPiece(candidate, registry, ignoreId);
  if (overlap) {
    return { ok: false, reason: 'overlap', conflictId: overlap.id };
  }

  return { ok: true };
}

/**
 * Map a `PlacementRejectionReason` to a short, user-facing label —
 * exposed so the ghost renderer + future toast banner can surface
 * consistent copy without re-deriving strings per call site.
 */
export function describePlacementRejection(reason: PlacementRejectionReason): string {
  switch (reason) {
    case 'out-of-bounds':
      return 'Out of bounds';
    case 'invalid-type':
      return 'Unknown piece';
    case 'invalid-geometry':
      return 'Invalid size';
    case 'overlap':
      return 'Overlaps another piece';
    case 'hazard-near-spawn':
      return 'Too close to spawn / hazard';
    default:
      return 'Invalid placement';
  }
}
