/**
 * Phaser-free stage-data model for the M3 stage builder.
 *
 * AC 20102 Sub-AC 2 — "Implement drop placement logic that instantiates
 * the selected piece (including hazards) at the snapped canvas
 * coordinates and registers it in the stage data model".
 *
 * The drag-and-drop state machine in `./dragDrop.ts` ends a successful
 * drag by emitting a `PlacedPiece` payload. This module is the
 * canonical *registry* the scene routes that payload into:
 *
 *   1. The scene calls `dragDrop.pointerUp(...)` and gets a
 *      `PlacedPiece | null` back.
 *   2. If the controller returned a piece, the scene calls
 *      `model.addPiece(piece)`. The model assigns the piece a stable
 *      id, appends it to the in-memory roster, and returns a result
 *      object describing what happened.
 *   3. The scene's renderer reads `model.getPieces()` (or listens to
 *      the change event the registry emits) and paints a rectangle for
 *      each registered entry.
 *
 * Why a separate module
 * ---------------------
 *
 *   • Per the Seed's `code_architecture` evaluation principle, scenes
 *     stay thin — the registry is "just a list with rules", and a list
 *     with rules belongs in a Phaser-free module the unit suite can
 *     drive exhaustively under plain Node.
 *
 *   • The model is the single source of truth the future sub-ACs
 *     (delete brush, undo/redo, save-to-localStorage, replay diff) all
 *     consume. Keeping it Phaser-free means those features land as
 *     pure data-layer changes without re-touching the scene.
 *
 *   • The Seed's hard limit "30 pieces per custom stage" is enforced
 *     here so the cap holds across every code path that adds a piece
 *     (drag-drop drop, future paste, future load-from-localStorage),
 *     not just the drag-drop UI surface.
 *
 * Determinism note: the registry is fully deterministic. Ids are
 * derived from a monotonically incrementing counter seeded at zero —
 * no `Math.random()`, no wall-clock reads. A replay that records
 * "player added a piece of type X at (col, row)" reproduces the same
 * registered id byte-identically.
 */

import {
  BUILDER_CANVAS_DEFAULT_HEIGHT,
  BUILDER_CANVAS_DEFAULT_WIDTH,
  buildGridSpec,
  type GridSpec,
} from './builderGrid';
import { findCatalogPiece, type BuilderPieceType } from './catalogPieces';
import { type PlacedPiece } from './dragDrop';
import {
  validatePlacement,
  type RegisteredCandidate,
} from './placementValidation';

// ---------------------------------------------------------------------------
// Public constants — Seed-mandated hard limits
// ---------------------------------------------------------------------------

/**
 * The Seed's "30 pieces per custom stage" cap, frozen as an exported
 * constant so the validator + the registry + the test suite all
 * reference one source of truth instead of magic-number-comparing.
 */
export const STAGE_PIECE_LIMIT = 30;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A piece that has been registered in the stage data model. Wraps the
 * raw `PlacedPiece` drop payload with:
 *
 *   • a stable `id` so a future delete brush or undo stack can target
 *     a specific entry without ambiguity (two flat-platforms at the
 *     same `(col, row)` would collide on coords alone);
 *   • a monotonic `insertionIndex` so a renderer that re-paints from
 *     scratch can preserve insertion order (older pieces sit under
 *     newer ones, matching the "you just placed this" mental model).
 */
export interface RegisteredPiece {
  /** Stable identifier of the form `<type>#<seq>` (e.g. `flat-platform#0`). */
  readonly id: string;
  /** Monotonic insertion index — `0` for the first piece, etc. */
  readonly insertionIndex: number;
  /** Catalog type identity; one of the eight Seed-mandated piece types. */
  readonly type: BuilderPieceType;
  /** Top-left in canvas-relative design pixels. */
  readonly canvasX: number;
  /** Top-left in canvas-relative design pixels. */
  readonly canvasY: number;
  /** Footprint width in design pixels. */
  readonly width: number;
  /** Footprint height in design pixels. */
  readonly height: number;
  /** Top-left grid cell column. */
  readonly col: number;
  /** Top-left grid cell row. */
  readonly row: number;
}

/**
 * Reasons `addPiece` can reject a placement.
 *
 *   • `limit-exceeded`     — the Seed's 30-piece hard cap is reached.
 *   • `out-of-bounds`      — the piece footprint clips the canvas. Should
 *                             never happen in the drag-drop flow (the
 *                             controller already filters this), but the
 *                             registry re-validates so other entry points
 *                             (future load-from-localStorage, paste) stay
 *                             honest.
 *   • `invalid-type`       — the piece's `type` is not in the catalog.
 *   • `invalid-geometry`   — non-finite / non-positive dimensions.
 *   • `overlap`            — piece footprint intersects an already-
 *                             registered piece. Added in AC 20103
 *                             Sub-AC 3 so a load-from-localStorage path
 *                             that round-trips a corrupted save can't
 *                             quietly stack two pieces in the same cell.
 *   • `hazard-near-spawn`  — hazard placed too close to a spawn-point
 *                             (or vice versa). Same AC; defends against
 *                             "fighter spawns onto lava" save corruption.
 */
export type AddPieceRejection =
  | 'limit-exceeded'
  | 'out-of-bounds'
  | 'invalid-type'
  | 'invalid-geometry'
  | 'overlap'
  | 'hazard-near-spawn';

/**
 * Result of `addPiece`. Either the piece was registered (success
 * payload includes the assigned `id`) or it was rejected with a
 * machine-readable reason. The shape is a discriminated union so
 * callers can `switch` on `result.ok` and TypeScript narrows the
 * payload accordingly.
 */
export type AddPieceResult =
  | { readonly ok: true; readonly piece: RegisteredPiece }
  | { readonly ok: false; readonly reason: AddPieceRejection };

/**
 * Construction options for {@link StageDataModel}.
 *
 *   • `gridSpec` — used for canvas-bounds re-validation. Defaults to
 *     the canonical 1× canvas. Re-set via {@link setGridSpec} when the
 *     player resizes the canvas (future sub-AC).
 *   • `maxPieces` — hard cap on the registered piece count. Defaults
 *     to {@link STAGE_PIECE_LIMIT}. Exposed as a constructor option so
 *     tests can drive the cap-exceeded branch without authoring 30
 *     fixture pieces, AND so a future "infinite sandbox" build flag
 *     can lift the cap without touching the model itself.
 */
export interface StageDataModelOptions {
  readonly gridSpec?: GridSpec;
  readonly maxPieces?: number;
}

/**
 * Listener invoked after every successful registry mutation
 * (add / remove / clear). The argument is the live piece roster — a
 * defensive copy is NOT made, so listeners must not mutate it.
 *
 * The renderer subscribes to this so a single registry mutation drives
 * a single canvas repaint without the scene having to thread the
 * change through every observer manually.
 */
export type StageDataModelListener = (
  pieces: ReadonlyArray<RegisteredPiece>,
) => void;

// ---------------------------------------------------------------------------
// StageDataModel
// ---------------------------------------------------------------------------

/**
 * In-memory registry of placed builder pieces. One instance per
 * `StageBuilderScene` lifetime; the scene wires its drag-drop pointer
 * pipeline into `addPiece(...)` and its renderer into the change
 * listener.
 *
 *     const model = new StageDataModel({ gridSpec });
 *     model.addListener((pieces) => renderer.repaint(pieces));
 *     // ...
 *     scene.input.on('pointerup', (p) => {
 *       const placed = dnd.pointerUp(p.x, p.y);
 *       if (placed) model.addPiece(placed);
 *     });
 *
 * Invariants the registry guarantees:
 *
 *   1. `getPieces().length` never exceeds the configured `maxPieces`.
 *   2. Every registered piece has a unique `id`.
 *   3. Insertion order is preserved across `getPieces()` reads (until
 *      `removePiece` punches a hole).
 *   4. Listeners are notified after every mutation, in registration
 *      order, with the live roster.
 */
export class StageDataModel {
  private readonly pieces: RegisteredPiece[] = [];
  private readonly listeners: Set<StageDataModelListener> = new Set();
  private gridSpec: GridSpec;
  private readonly maxPieces: number;
  private nextSeq = 0;

  constructor(opts: StageDataModelOptions = {}) {
    this.gridSpec =
      opts.gridSpec ??
      buildGridSpec(BUILDER_CANVAS_DEFAULT_WIDTH, BUILDER_CANVAS_DEFAULT_HEIGHT);
    const cap = opts.maxPieces ?? STAGE_PIECE_LIMIT;
    // Defensive: a non-finite / non-positive cap is meaningless. Clamp
    // to the Seed's canonical limit so a typo can't silently disable
    // the cap.
    this.maxPieces =
      Number.isFinite(cap) && Math.floor(cap) > 0
        ? Math.floor(cap)
        : STAGE_PIECE_LIMIT;
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  /**
   * Register a `PlacedPiece` from the drag-drop pipeline. Returns a
   * discriminated-union result describing whether the placement was
   * accepted and (on rejection) why.
   *
   * Validation order — earliest fail wins so the rejection reason is
   * the most specific:
   *
   *   1. catalog type identity (`invalid-type`)
   *   2. footprint geometry sanity (`invalid-geometry`)
   *   3. canvas bounds (`out-of-bounds`)
   *   4. piece-count hard cap (`limit-exceeded`)
   *
   * On acceptance the piece is appended to the roster, the next
   * sequence id is consumed, and every listener fires with the live
   * roster snapshot.
   */
  addPiece(piece: PlacedPiece): AddPieceResult {
    // The unified validator runs catalog-identity, geometry, canvas-
    // bounds, hazard-near-spawn, and overlap rules in a single pass.
    // Earliest fail wins — see `validatePlacement` for the exact order
    // — so the registry surfaces the most specific rejection reason.
    const verdict = validatePlacement(
      {
        type: piece.type,
        canvasX: piece.canvasX,
        canvasY: piece.canvasY,
        width: piece.width,
        height: piece.height,
      },
      this.toRegisteredCandidates(),
      this.gridSpec,
    );
    if (!verdict.ok) {
      return { ok: false, reason: verdict.reason };
    }
    // Piece-count cap is checked AFTER the validator so a malformed /
    // overlapping payload at the 30-piece boundary rejects on the
    // *real* reason rather than the catch-all cap.
    if (this.pieces.length >= this.maxPieces) {
      return { ok: false, reason: 'limit-exceeded' };
    }
    // Catalog identity is guaranteed at this point (validator returned
    // ok) — re-derive the canonical type so we never emit an id with
    // mixed casing or unexpected whitespace.
    const catalog = findCatalogPiece(piece.type)!;
    const seq = this.nextSeq;
    this.nextSeq += 1;
    const registered: RegisteredPiece = Object.freeze({
      id: `${catalog.type}#${seq}`,
      insertionIndex: this.pieces.length,
      type: catalog.type,
      canvasX: piece.canvasX,
      canvasY: piece.canvasY,
      width: piece.width,
      height: piece.height,
      col: piece.col,
      row: piece.row,
    });
    this.pieces.push(registered);
    this.notify();
    return { ok: true, piece: registered };
  }

  /**
   * Project the registry into the structurally-typed shape the
   * placement validator expects. Each entry carries id + AABB + type
   * — exactly enough for overlap and hazard-near-spawn rules.
   *
   * Returned as a fresh array so the validator can iterate without
   * worrying about concurrent mutation. A typical builder session has
   * 0–30 pieces, so the per-call copy is well within the
   * one-frame-at-60-FPS budget the Seed's `performance` principle
   * mandates.
   */
  private toRegisteredCandidates(): ReadonlyArray<RegisteredCandidate> {
    const out: RegisteredCandidate[] = [];
    for (const p of this.pieces) {
      out.push({
        id: p.id,
        type: p.type,
        canvasX: p.canvasX,
        canvasY: p.canvasY,
        width: p.width,
        height: p.height,
      });
    }
    return out;
  }

  /**
   * Public read-only projection of the registry into the validator's
   * candidate shape. Wired into the {@link DragDropController} so the
   * in-flight ghost preview can run the full rule set against the live
   * roster — the player sees a red ghost the moment they hover over an
   * existing piece, not after they release.
   */
  getRegisteredCandidates(): ReadonlyArray<RegisteredCandidate> {
    return this.toRegisteredCandidates();
  }

  /**
   * Remove the piece with the given `id`. Returns the removed entry,
   * or `null` if no piece matched. Listeners fire only on successful
   * removal so a listener subscribed to "any change" doesn't churn on
   * a no-op.
   */
  removePiece(id: string): RegisteredPiece | null {
    const idx = this.pieces.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    const [removed] = this.pieces.splice(idx, 1);
    this.notify();
    return removed ?? null;
  }

  /**
   * Wipe the registry. Resets the id sequence to zero so a re-entered
   * builder session starts with `flat-platform#0` instead of carrying
   * the prior session's counter. Listeners fire even if the registry
   * was already empty so a renderer subscribed to "any change" can
   * unconditionally rebuild its visual layer on a fresh-canvas signal.
   */
  clear(): void {
    this.pieces.length = 0;
    this.nextSeq = 0;
    this.notify();
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * Read the live roster. Returned array is the model's own internal
   * storage cast to a readonly view — callers MUST NOT mutate it. The
   * cost of a defensive copy on every read would dominate the renderer
   * hot path; idiomatic TypeScript catches the misuse via the
   * `ReadonlyArray` type at compile time.
   */
  getPieces(): ReadonlyArray<RegisteredPiece> {
    return this.pieces;
  }

  /** Convenience accessor — same as `getPieces().length`. */
  getCount(): number {
    return this.pieces.length;
  }

  /**
   * `true` once the Seed's piece-count hard cap is reached. The
   * catalog panel uses this to dim the catalog rows once the canvas is
   * full so the player gets immediate "you can't place more" feedback.
   */
  isFull(): boolean {
    return this.pieces.length >= this.maxPieces;
  }

  /**
   * Number of piece slots still available before the cap kicks in.
   * Exposed so the future "29 / 30" HUD can read a single integer
   * instead of subtracting `getCount()` from `maxPieces` at every
   * render.
   */
  getRemainingCapacity(): number {
    return Math.max(0, this.maxPieces - this.pieces.length);
  }

  /** Hard cap for the registry — the Seed's 30 unless overridden. */
  getMaxPieces(): number {
    return this.maxPieces;
  }

  /** Active grid spec used for canvas-bounds re-validation. */
  getGridSpec(): GridSpec {
    return this.gridSpec;
  }

  /**
   * Returns true iff the given piece type is registered as a hazard in
   * the catalog. The Seed's `customStage` ontology entry calls out
   * "hazard placements" as a first-class concern; surfacing this on
   * the model lets the (future) save-time validator + the M3 acceptance
   * test ("places at least 1 hazard") query the registry without
   * re-deriving catalog metadata.
   */
  countHazards(): number {
    let count = 0;
    for (const p of this.pieces) {
      const meta = findCatalogPiece(p.type);
      if (meta && meta.category === 'hazard') count += 1;
    }
    return count;
  }

  /** Number of registered spawn-point markers. */
  countSpawnPoints(): number {
    let count = 0;
    for (const p of this.pieces) {
      if (p.type === 'spawn-point') count += 1;
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Bulk import / export — AC 20104 Sub-AC 3 (named-slot save/load)
  // -------------------------------------------------------------------------

  /**
   * Project the live roster into the geometry-only {@link PlacedPiece}
   * shape. Drops the registry-only fields (`id`, `insertionIndex`) so
   * the result round-trips byte-identically through
   * {@link buildCustomStageData} → JSON → load → {@link replaceAllPieces}.
   *
   * The save/load pipeline calls this when committing the in-memory
   * roster to localStorage; replays + future "Export to file" UI use
   * the same projection. Returned as a fresh array so callers can
   * mutate without affecting the registry.
   */
  toPlacedPieces(): ReadonlyArray<PlacedPiece> {
    const out: PlacedPiece[] = [];
    for (const p of this.pieces) {
      out.push({
        type: p.type,
        canvasX: p.canvasX,
        canvasY: p.canvasY,
        width: p.width,
        height: p.height,
        col: p.col,
        row: p.row,
      });
    }
    return out;
  }

  /**
   * Atomic-feeling bulk import — used by the load path after
   * {@link customStageStorage.loadCustomStage} returns a validated
   * {@link CustomStageData}. The flow is:
   *
   *   1. Optionally replace the active grid spec so the canvas size
   *      matches the saved stage. The default is "leave unchanged" so
   *      a load that targets the wrong canvas size raises validator
   *      errors rather than resizing under the player's feet.
   *   2. Clear the existing roster (and reset the id sequence) so the
   *      first imported piece becomes `<type>#0`. Listeners do NOT
   *      fire here — a single fire-after-import keeps the renderer
   *      from repainting an empty canvas mid-load.
   *   3. Run every imported piece through the standard
   *      {@link addPiece} validator. Rejections are collected so the
   *      caller can surface "3 of 12 pieces failed validation" to the
   *      player.
   *   4. Notify listeners *once* with the final roster.
   *
   * Returns a structured report so the load dialog can decide whether
   * to surface a warning. `accepted` is the count of pieces that
   * passed validation; `rejected` lists `{ index, reason }` for each
   * piece that did not.
   *
   * Determinism: identical input produces identical output. The id
   * sequence is reset before the import so two loads of the same blob
   * yield byte-identical registry state.
   */
  replaceAllPieces(
    pieces: ReadonlyArray<PlacedPiece>,
    options: { gridSpec?: GridSpec; suppressNotify?: boolean } = {},
  ): {
    readonly accepted: number;
    readonly rejected: ReadonlyArray<{ readonly index: number; readonly reason: AddPieceRejection }>;
  } {
    if (options.gridSpec !== undefined) {
      this.gridSpec = options.gridSpec;
    }
    // Wipe in place — keep listeners detached so we only fire once at
    // the end (or not at all if the caller passed `suppressNotify`).
    this.pieces.length = 0;
    this.nextSeq = 0;
    let accepted = 0;
    const rejected: { index: number; reason: AddPieceRejection }[] = [];
    for (let i = 0; i < pieces.length; i += 1) {
      const piece = pieces[i];
      if (piece === undefined) {
        rejected.push({ index: i, reason: 'invalid-geometry' });
        continue;
      }
      // Bypass the listener notify per piece to avoid N repaints; we
      // re-implement the registry insertion inline so the cap +
      // validator still fire for every piece.
      const verdict = validatePlacement(
        {
          type: piece.type,
          canvasX: piece.canvasX,
          canvasY: piece.canvasY,
          width: piece.width,
          height: piece.height,
        },
        this.toRegisteredCandidates(),
        this.gridSpec,
      );
      if (!verdict.ok) {
        rejected.push({ index: i, reason: verdict.reason });
        continue;
      }
      if (this.pieces.length >= this.maxPieces) {
        rejected.push({ index: i, reason: 'limit-exceeded' });
        continue;
      }
      const catalog = findCatalogPiece(piece.type)!;
      const seq = this.nextSeq;
      this.nextSeq += 1;
      this.pieces.push(
        Object.freeze({
          id: `${catalog.type}#${seq}`,
          insertionIndex: this.pieces.length,
          type: catalog.type,
          canvasX: piece.canvasX,
          canvasY: piece.canvasY,
          width: piece.width,
          height: piece.height,
          col: piece.col,
          row: piece.row,
        }),
      );
      accepted += 1;
    }
    if (!options.suppressNotify) this.notify();
    return { accepted, rejected };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Update the active grid spec. Called when the player resizes the
   * canvas (future sub-AC). Existing pieces are NOT auto-removed if
   * they fall out of the new bounds — the validator surfaces those at
   * save time so the player can move them first; a silent delete
   * would feel like data loss.
   */
  setGridSpec(gridSpec: GridSpec): void {
    this.gridSpec = gridSpec;
  }

  /**
   * Subscribe to mutation events. Returns an unsubscribe function so
   * callers can detach in their own teardown without juggling refs.
   */
  addListener(listener: StageDataModelListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Detach a previously-registered listener. Idempotent. */
  removeListener(listener: StageDataModelListener): void {
    this.listeners.delete(listener);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private notify(): void {
    // Snapshot the listener set before iterating so a listener that
    // unsubscribes itself doesn't skip a sibling listener (Set
    // iteration order is insertion order, but mutation during
    // iteration is murky in older runtimes — safer to copy).
    const snapshot = Array.from(this.listeners);
    for (const listener of snapshot) {
      listener(this.pieces);
    }
  }
}

// ---------------------------------------------------------------------------
// HUD format helper — colocated here so it's a Phaser-free dependency
// the scene + the unit suite can both pull in.
// ---------------------------------------------------------------------------

/**
 * Format the live piece-count HUD line. Pure function so tests can
 * drive every formatting branch under plain Node and the scene's
 * render path stays a one-liner.
 *
 * Examples:
 *   formatPlacedCountLabel(0,  30)  →  "0 / 30 PIECES"
 *   formatPlacedCountLabel(23, 30)  →  "23 / 30 PIECES"
 *   formatPlacedCountLabel(30, 30)  →  "30 / 30 PIECES (FULL)"
 *
 * The "(FULL)" suffix gives the player an unmistakable cue that the
 * 30-piece hard cap is reached without having to read the numeric
 * fraction first.
 *
 * Defensive against bad input: non-finite / negative counts clamp to
 * 0; non-finite / non-positive caps clamp to 0 (the resulting "n / 0
 * PIECES" is recognisable enough that a regression that nukes the
 * cap doesn't silently render an inviting "go forever" HUD).
 */
export function formatPlacedCountLabel(count: number, max: number): string {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const safeMax = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0;
  const suffix = safeMax > 0 && safeCount >= safeMax ? ' (FULL)' : '';
  return `${safeCount} / ${safeMax} PIECES${suffix}`;
}
