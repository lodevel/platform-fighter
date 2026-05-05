/**
 * Phaser-free serialization layer for custom stages built in the M3
 * stage builder.
 *
 * AC 20104 Sub-AC 3 — "Implement save/load serialization of custom
 * stages to/from localStorage with named slots".
 *
 * Why an envelope, not a raw `JSON.stringify(pieces)`
 * --------------------------------------------------
 *
 * The custom-stage schema will evolve — new piece types, new per-piece
 * fields (rotation, hazard tuning), new top-level fields (background
 * track, scoring rule overrides). A blob written today that round-
 * trips through a future loader has to declare "I am version N" so the
 * loader can either accept it, migrate it, or reject it loudly. The
 * envelope shape is therefore:
 *
 *     { "schemaVersion": 1, "kind": "customStage", "data": {...} }
 *     { "schemaVersion": 1, "kind": "customStageIndex", "data": {...} }
 *
 * The `kind` discriminator is essential because both shapes appear at
 * the top level of saved blobs: each named slot writes a `customStage`
 * envelope to its own key, while the slot index that names + orders the
 * available slots writes a single `customStageIndex` envelope. A loader
 * that opens an arbitrary key needs to know which one it is holding
 * before it routes to the body-specific validator.
 *
 * Why a separate slot index
 * -------------------------
 *
 * `localStorage` is a flat key-value bag. Without an index there is no
 * portable way to enumerate "all custom stages" — `Storage.length` /
 * `Storage.key(i)` exist on the DOM `Storage` but not on the
 * {@link StorageLike} interface this codebase injects in tests, and a
 * future migration to IndexedDB would lose the enumeration completely.
 * The index is the canonical roster:
 *
 *   • The "Save" button writes / updates the index entry first, then
 *     the per-slot blob. A crash between the two writes leaves an
 *     orphaned index entry the loader detects and prunes.
 *   • The "Load" / "Delete" UIs read the index to populate the slot
 *     selector — no key-iteration needed.
 *   • The Seed's `customStage` ontology entry says custom stages are
 *     "serialized to localStorage". The index makes that round-trip
 *     visible to the player as a list of named saves rather than a
 *     stash of opaque keys.
 *
 * Determinism
 * -----------
 *
 *   • {@link serializeCustomStage} and {@link serializeCustomStageIndex}
 *     emit *canonical* JSON: keys are written in a fixed order
 *     (envelope → schemaVersion, kind, data; per-piece → type first,
 *     then geometry; index entry → id, name). Two equivalent stages
 *     produce byte-identical strings, which means a replay that records
 *     "player saved stage X" can hash the payload as part of its
 *     desync check, and a settings file written by two different
 *     sessions of the same build compares clean in `diff`.
 *   • No `Math.random()`, no `Date.now()`, no Phaser. The module is a
 *     pure data transform.
 *
 * Strict validation
 * -----------------
 *
 * Every load path runs the validator against the Seed's hard limits +
 * the catalog. Specifically:
 *
 *   • The piece type must be a recognised {@link BuilderPieceType} from
 *     the catalog — a corrupted blob can't smuggle through a
 *     `'lava-zone-2'` and explode at runtime.
 *   • Piece counts cannot exceed the Seed's 30-piece hard cap (the
 *     same {@link STAGE_PIECE_LIMIT} the in-memory model enforces).
 *   • Canvas dimensions must fit inside the 2× screen-size hard cap
 *     (`BUILDER_CANVAS_MAX_*`) and be at least one cell wide / tall.
 *   • Piece footprints must be finite, positive, and sit fully inside
 *     the saved canvas.
 *   • The slot name must be a non-empty 1..64 char string with no
 *     control characters — names that drop into the UI as labels.
 *
 * Error handling
 * --------------
 *
 * Two flavours are exposed for every load path:
 *
 *   • `deserialize…(json)` throws on the first invalid field, with a
 *     descriptive message that names the offending slot / piece. Used
 *     by the (future) "Import stage" dialog when we want a clear error.
 *   • `safeDeserialize…(json)` returns a discriminated `DeserializeResult`
 *     so the storage layer can fall back to "no slots saved" without
 *     wrapping every call in a `try` / `catch`.
 */

import {
  BUILDER_CANVAS_MAX_HEIGHT,
  BUILDER_CANVAS_MAX_WIDTH,
  BUILDER_GRID_CELL_PX,
  type GridSpec,
} from './builderGrid';
import {
  CATALOG_PIECES,
  findCatalogPiece,
  type BuilderPieceType,
} from './catalogPieces';
import {
  STAGE_PIECE_LIMIT,
  type RegisteredPiece,
} from './stageDataModel';
import type { PlacedPiece } from './dragDrop';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/**
 * Current wire-format version. Bumped in lockstep with any change to
 * the envelope shape *or* to a per-piece field that an older loader
 * cannot interpret. Migrations live alongside this constant when they
 * are needed — for now any version other than this constant is rejected.
 *
 * Versioning policy mirrors {@link BINDINGS_SCHEMA_VERSION}:
 *
 *   • Patch additions older loaders can ignore (e.g. an optional metadata
 *     field on the envelope) keep this constant pinned.
 *   • Adding a new {@link BuilderPieceType} bumps this constant because
 *     an older loader's catalog-identity check would reject the new type.
 *   • Removing or renaming a piece type bumps this constant and requires
 *     a migration entry.
 */
export const CUSTOM_STAGE_SCHEMA_VERSION = 1 as const;

/** Recognised top-level discriminators. */
export type SerializedCustomStageKind = 'customStage' | 'customStageIndex';

// ---------------------------------------------------------------------------
// Public data shapes
// ---------------------------------------------------------------------------

/**
 * Hard limits on slot-name strings. Names are user-typed labels that
 * appear in the (future) load dialog's slot selector, so we want them
 * short enough to fit a single line and free of control chars that
 * would garble the renderer.
 */
export const CUSTOM_STAGE_NAME_MIN_LENGTH = 1;
export const CUSTOM_STAGE_NAME_MAX_LENGTH = 64;

/**
 * The minimum canvas dimensions a save is allowed to declare. One cell
 * each — anything smaller would be unrenderable. The maximum follows
 * the Seed's `max dimensions 2× screen size` hard cap, sourced from
 * {@link BUILDER_CANVAS_MAX_WIDTH} / {@link BUILDER_CANVAS_MAX_HEIGHT}
 * so a single change to the cap propagates automatically.
 */
export const CUSTOM_STAGE_MIN_CANVAS_PX = BUILDER_GRID_CELL_PX;

/**
 * Plain piece-data shape — the geometry-only projection of
 * {@link RegisteredPiece} / {@link PlacedPiece} that round-trips
 * through JSON. Insertion order is preserved by the array index, so
 * the loader hydrates pieces in the same order the player placed them
 * (older pieces sit under newer ones, matching the
 * `you-just-placed-this` mental model).
 */
export interface SerializedStagePiece {
  /** Stable catalog identity. One of the eight Seed-mandated types. */
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
 * Serializable canvas dimensions. Saved per-stage so a custom stage
 * loaded into a new builder session reconstructs the original grid
 * without inheriting the host session's defaults.
 */
export interface SerializedGridSpec {
  /** Cell side length in design pixels. */
  readonly cellPx: number;
  /** Canvas width in design pixels. */
  readonly width: number;
  /** Canvas height in design pixels. */
  readonly height: number;
}

/**
 * Logical body of a `customStage` envelope. The serializer wraps this
 * in {@link SerializedCustomStage} when emitting JSON; the storage
 * layer hands the unwrapped body back to the caller.
 *
 * `name` is the player-facing slot label. The id under which the slot
 * is keyed is derived from the name by {@link customStageSlotIdFromName}
 * — see that helper for the canonicalisation rules.
 */
export interface CustomStageData {
  /** Player-facing slot label. 1..64 chars, no control characters. */
  readonly name: string;
  /** Saved canvas dimensions; rebuilds the grid spec on load. */
  readonly gridSpec: SerializedGridSpec;
  /** Pieces in placement order. Length ≤ {@link STAGE_PIECE_LIMIT}. */
  readonly pieces: ReadonlyArray<SerializedStagePiece>;
}

/**
 * One entry in the slot index. The storage layer joins the index with
 * the per-slot blobs so the load dialog can render
 * `[ "Lava Tower", "Wind Castle", … ]` without having to read every
 * blob.
 */
export interface CustomStageIndexEntry {
  /** Opaque slot id derived from the name. Used as the storage key suffix. */
  readonly id: string;
  /** Player-facing label, kept verbatim from {@link CustomStageData.name}. */
  readonly name: string;
}

/** Logical body of the `customStageIndex` envelope. */
export interface CustomStageIndexData {
  /** Slots in last-saved order — most-recent saves at the head. */
  readonly slots: ReadonlyArray<CustomStageIndexEntry>;
}

/** Wire envelope for a single saved stage. */
export interface SerializedCustomStage {
  readonly schemaVersion: typeof CUSTOM_STAGE_SCHEMA_VERSION;
  readonly kind: 'customStage';
  readonly data: CustomStageData;
}

/** Wire envelope for the slot index. */
export interface SerializedCustomStageIndex {
  readonly schemaVersion: typeof CUSTOM_STAGE_SCHEMA_VERSION;
  readonly kind: 'customStageIndex';
  readonly data: CustomStageIndexData;
}

/** Result type for `safeDeserialize…` — avoids forcing callers to use try/catch. */
export type DeserializeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

// ---------------------------------------------------------------------------
// Slot id derivation
// ---------------------------------------------------------------------------

/**
 * Maximum length of a derived slot id. Twice the name length cap so a
 * worst-case unicode → percent-encoded transformation still fits.
 * Exposed as a constant so the validator + the storage layer reference
 * one source of truth.
 */
export const CUSTOM_STAGE_SLOT_ID_MAX_LENGTH = 128;

/**
 * Derive a stable, filesystem- / URL-safe slot id from a player-typed
 * name. Two saves with names that normalise to the same id collide on
 * write — `saveCustomStage` surfaces a `name-collision` error so the
 * UI can prompt for a different name.
 *
 * Canonicalisation rules — the simplest set that yields predictable ids:
 *
 *   1. Trim leading + trailing whitespace.
 *   2. Lowercase (ASCII case-fold; unicode case stays as-is).
 *   3. Replace any run of characters outside `[a-z0-9]` with a single
 *      `-`. This collapses spaces, punctuation, and unicode that the
 *      ASCII fold leaves alone.
 *   4. Trim leading + trailing `-` so the id never starts / ends with
 *      a separator.
 *   5. If the result is empty (e.g. all whitespace, all unicode emoji),
 *      fall back to `'stage'` so the storage layer always has *something*
 *      to key on. The caller is expected to validate the name first;
 *      the empty-id fallback is a defensive backstop.
 *   6. Truncate to {@link CUSTOM_STAGE_SLOT_ID_MAX_LENGTH}.
 *
 * Determinism: the function is pure — same input, same output.
 */
export function customStageSlotIdFromName(name: string): string {
  if (typeof name !== 'string') return 'stage';
  const trimmed = name.trim().toLowerCase();
  if (trimmed.length === 0) return 'stage';
  // Replace ANY run of characters not in [a-z0-9] with a single dash.
  // Unicode without an ASCII fold drops out here — that's by design;
  // we want predictable, ASCII-only ids in the URL-safe set.
  let id = trimmed.replace(/[^a-z0-9]+/g, '-');
  // Trim leading / trailing dashes so the id never starts with `-`.
  id = id.replace(/^-+|-+$/g, '');
  if (id.length === 0) return 'stage';
  if (id.length > CUSTOM_STAGE_SLOT_ID_MAX_LENGTH) {
    id = id.slice(0, CUSTOM_STAGE_SLOT_ID_MAX_LENGTH);
    // After truncation we may have left a trailing dash; clean it up.
    id = id.replace(/-+$/g, '');
    if (id.length === 0) return 'stage';
  }
  return id;
}

// ---------------------------------------------------------------------------
// Validation — pure helpers shared by the throwing + safe deserialise paths.
// ---------------------------------------------------------------------------

/**
 * Throw if `value` is not a finite number. Helper used by every
 * geometry validator so the error message format stays consistent.
 */
function assertFiniteNumber(
  value: unknown,
  field: string,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `customStageSerializer: ${field} must be a finite number, got ${describeValue(value)}.`,
    );
  }
}

/** Print an unknown value safely — never throws, never recurses. */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const t = typeof value;
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value);
  if (t === 'string') return JSON.stringify(value);
  if (t === 'object') return '[object]';
  return t;
}

/** `true` iff every code point in `s` is non-control. */
function hasControlCharacters(s: string): boolean {
  // U+0000..U+001F and U+007F..U+009F are ASCII / C1 control chars.
  // Anything else (printable ASCII, punctuation, unicode letters /
  // emoji) is allowed — the slot-id derivation already strips them
  // for keying purposes, but the *display name* preserves them.
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code < 0x20) return true;
    if (code >= 0x7f && code <= 0x9f) return true;
  }
  return false;
}

/**
 * Validate a slot name. Throws on the first violation.
 *
 *   • Must be a string.
 *   • Length 1..{@link CUSTOM_STAGE_NAME_MAX_LENGTH} after trim.
 *   • No control characters (would garble the load dialog renderer).
 */
export function assertValidCustomStageName(name: unknown): asserts name is string {
  if (typeof name !== 'string') {
    throw new Error(
      `customStageSerializer: stage name must be a string, got ${describeValue(name)}.`,
    );
  }
  const trimmed = name.trim();
  if (trimmed.length < CUSTOM_STAGE_NAME_MIN_LENGTH) {
    throw new Error(
      `customStageSerializer: stage name must have at least ${CUSTOM_STAGE_NAME_MIN_LENGTH} non-whitespace character.`,
    );
  }
  // Apply the cap to the *trimmed* form so a 64-char name padded with
  // surrounding spaces still passes — players sometimes paste names
  // with stray whitespace and we don't want to penalise that.
  if (trimmed.length > CUSTOM_STAGE_NAME_MAX_LENGTH) {
    throw new Error(
      `customStageSerializer: stage name must be at most ${CUSTOM_STAGE_NAME_MAX_LENGTH} characters (got ${trimmed.length}).`,
    );
  }
  if (hasControlCharacters(name)) {
    throw new Error(
      'customStageSerializer: stage name contains control characters.',
    );
  }
}

/**
 * Validate a {@link SerializedGridSpec}. Throws on the first violation.
 *
 *   • All three fields finite + positive.
 *   • `cellPx` ≥ 1 (the `buildGridSpec` floor).
 *   • Width / height fit in the Seed's 2× screen-size cap.
 *   • Width / height are at least one full cell.
 */
export function assertValidGridSpec(
  candidate: unknown,
): asserts candidate is SerializedGridSpec {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error(
      `customStageSerializer: gridSpec must be a non-null object, got ${describeValue(candidate)}.`,
    );
  }
  const g = candidate as { cellPx?: unknown; width?: unknown; height?: unknown };
  assertFiniteNumber(g.cellPx, 'gridSpec.cellPx');
  assertFiniteNumber(g.width, 'gridSpec.width');
  assertFiniteNumber(g.height, 'gridSpec.height');
  if (g.cellPx < 1) {
    throw new Error(
      `customStageSerializer: gridSpec.cellPx must be ≥ 1, got ${g.cellPx}.`,
    );
  }
  if (g.width < CUSTOM_STAGE_MIN_CANVAS_PX) {
    throw new Error(
      `customStageSerializer: gridSpec.width must be ≥ ${CUSTOM_STAGE_MIN_CANVAS_PX}, got ${g.width}.`,
    );
  }
  if (g.width > BUILDER_CANVAS_MAX_WIDTH) {
    throw new Error(
      `customStageSerializer: gridSpec.width exceeds 2× screen cap (${BUILDER_CANVAS_MAX_WIDTH}), got ${g.width}.`,
    );
  }
  if (g.height < CUSTOM_STAGE_MIN_CANVAS_PX) {
    throw new Error(
      `customStageSerializer: gridSpec.height must be ≥ ${CUSTOM_STAGE_MIN_CANVAS_PX}, got ${g.height}.`,
    );
  }
  if (g.height > BUILDER_CANVAS_MAX_HEIGHT) {
    throw new Error(
      `customStageSerializer: gridSpec.height exceeds 2× screen cap (${BUILDER_CANVAS_MAX_HEIGHT}), got ${g.height}.`,
    );
  }
}

/**
 * Validate one piece entry. Throws on the first violation.
 *
 *   • `type` must be a recognised catalog piece.
 *   • All seven geometry fields finite.
 *   • Footprint dimensions positive.
 *   • Footprint sits fully inside the saved canvas.
 *
 * The catalog-default-size invariant (`width === catalog.defaultWidth`)
 * is intentionally NOT enforced here — a future "resizeable pieces"
 * sub-AC will let the player drag-resize a piece, and we don't want
 * the validator to reject those saves on round-trip.
 */
export function assertValidStagePiece(
  candidate: unknown,
  index: number,
  gridSpec: SerializedGridSpec,
): asserts candidate is SerializedStagePiece {
  const at = `pieces[${index}]`;
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error(
      `customStageSerializer: ${at} must be a non-null object, got ${describeValue(candidate)}.`,
    );
  }
  const p = candidate as Record<string, unknown>;
  if (typeof p.type !== 'string') {
    throw new Error(
      `customStageSerializer: ${at}.type must be a string, got ${describeValue(p.type)}.`,
    );
  }
  if (!findCatalogPiece(p.type)) {
    throw new Error(
      `customStageSerializer: ${at}.type '${p.type}' is not in the catalog.`,
    );
  }
  assertFiniteNumber(p.canvasX, `${at}.canvasX`);
  assertFiniteNumber(p.canvasY, `${at}.canvasY`);
  assertFiniteNumber(p.width, `${at}.width`);
  assertFiniteNumber(p.height, `${at}.height`);
  assertFiniteNumber(p.col, `${at}.col`);
  assertFiniteNumber(p.row, `${at}.row`);
  if ((p.width as number) <= 0 || (p.height as number) <= 0) {
    throw new Error(
      `customStageSerializer: ${at} footprint must be positive, got ${p.width}×${p.height}.`,
    );
  }
  if ((p.canvasX as number) < 0 || (p.canvasY as number) < 0) {
    throw new Error(
      `customStageSerializer: ${at} top-left must be ≥ 0, got (${p.canvasX}, ${p.canvasY}).`,
    );
  }
  if ((p.canvasX as number) + (p.width as number) > gridSpec.width) {
    throw new Error(
      `customStageSerializer: ${at} clips the right canvas edge (${(p.canvasX as number) + (p.width as number)} > ${gridSpec.width}).`,
    );
  }
  if ((p.canvasY as number) + (p.height as number) > gridSpec.height) {
    throw new Error(
      `customStageSerializer: ${at} clips the bottom canvas edge (${(p.canvasY as number) + (p.height as number)} > ${gridSpec.height}).`,
    );
  }
}

/**
 * Validate a candidate {@link CustomStageData}. Throws on the first
 * violation. Used by both the throwing deserialise path and the
 * `serializeCustomStage` "fail before write" guard so a malformed
 * blob can never reach disk.
 */
export function assertValidCustomStageData(
  candidate: unknown,
): asserts candidate is CustomStageData {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error(
      `customStageSerializer: stage data must be a non-null object, got ${describeValue(candidate)}.`,
    );
  }
  const d = candidate as Record<string, unknown>;
  assertValidCustomStageName(d.name);
  assertValidGridSpec(d.gridSpec);
  if (!Array.isArray(d.pieces)) {
    throw new Error(
      `customStageSerializer: pieces must be an array, got ${describeValue(d.pieces)}.`,
    );
  }
  if (d.pieces.length > STAGE_PIECE_LIMIT) {
    throw new Error(
      `customStageSerializer: pieces.length ${d.pieces.length} exceeds the ${STAGE_PIECE_LIMIT}-piece hard cap.`,
    );
  }
  for (let i = 0; i < d.pieces.length; i += 1) {
    assertValidStagePiece(d.pieces[i], i, d.gridSpec as SerializedGridSpec);
  }
}

/**
 * Validate one slot index entry. Throws on the first violation.
 */
function assertValidIndexEntry(
  candidate: unknown,
  index: number,
): asserts candidate is CustomStageIndexEntry {
  const at = `slots[${index}]`;
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error(
      `customStageSerializer: ${at} must be a non-null object, got ${describeValue(candidate)}.`,
    );
  }
  const e = candidate as { id?: unknown; name?: unknown };
  if (typeof e.id !== 'string' || e.id.length === 0) {
    throw new Error(
      `customStageSerializer: ${at}.id must be a non-empty string, got ${describeValue(e.id)}.`,
    );
  }
  if (e.id.length > CUSTOM_STAGE_SLOT_ID_MAX_LENGTH) {
    throw new Error(
      `customStageSerializer: ${at}.id exceeds ${CUSTOM_STAGE_SLOT_ID_MAX_LENGTH} chars.`,
    );
  }
  // The id is derived from the name; the entry-level check is just
  // "is the name a valid display label" — name → id agreement is the
  // storage layer's contract (it derives the id at write time).
  assertValidCustomStageName(e.name);
}

/**
 * Validate a candidate {@link CustomStageIndexData}. Throws on the
 * first violation.
 */
export function assertValidCustomStageIndexData(
  candidate: unknown,
): asserts candidate is CustomStageIndexData {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error(
      `customStageSerializer: index data must be a non-null object, got ${describeValue(candidate)}.`,
    );
  }
  const d = candidate as { slots?: unknown };
  if (!Array.isArray(d.slots)) {
    throw new Error(
      `customStageSerializer: index slots must be an array, got ${describeValue(d.slots)}.`,
    );
  }
  // Reject duplicate ids — the storage layer treats each id as a
  // unique key and a duplicated entry would clobber a slot silently.
  const seen = new Set<string>();
  for (let i = 0; i < d.slots.length; i += 1) {
    assertValidIndexEntry(d.slots[i], i);
    const id = (d.slots[i] as CustomStageIndexEntry).id;
    if (seen.has(id)) {
      throw new Error(
        `customStageSerializer: index contains duplicate slot id '${id}'.`,
      );
    }
    seen.add(id);
  }
}

// ---------------------------------------------------------------------------
// Canonicalisation — pin key order so two equivalent stages produce
// byte-identical JSON.
// ---------------------------------------------------------------------------

function canonicaliseGridSpec(g: SerializedGridSpec): Record<string, unknown> {
  return { cellPx: g.cellPx, width: g.width, height: g.height };
}

function canonicalisePiece(p: SerializedStagePiece): Record<string, unknown> {
  // `type` first so a JSON viewer shows the discriminant before the
  // numeric coordinates; geometry follows in (canvasX, canvasY,
  // width, height, col, row) order — same order RegisteredPiece /
  // PlacedPiece declare their fields.
  return {
    type: p.type,
    canvasX: p.canvasX,
    canvasY: p.canvasY,
    width: p.width,
    height: p.height,
    col: p.col,
    row: p.row,
  };
}

function canonicaliseCustomStage(d: CustomStageData): Record<string, unknown> {
  return {
    name: d.name,
    gridSpec: canonicaliseGridSpec(d.gridSpec),
    pieces: d.pieces.map(canonicalisePiece),
  };
}

function canonicaliseIndexEntry(e: CustomStageIndexEntry): Record<string, unknown> {
  return { id: e.id, name: e.name };
}

function canonicaliseCustomStageIndex(
  d: CustomStageIndexData,
): Record<string, unknown> {
  return { slots: d.slots.map(canonicaliseIndexEntry) };
}

// ---------------------------------------------------------------------------
// Build helpers — glue between the in-memory model and the wire shapes.
// ---------------------------------------------------------------------------

/**
 * Project a single {@link RegisteredPiece} or {@link PlacedPiece} into
 * the wire shape {@link SerializedStagePiece}. Drops the registry-only
 * fields (`id`, `insertionIndex`) that the loader will re-derive from
 * the array order.
 */
export function toSerializedPiece(
  piece: RegisteredPiece | PlacedPiece,
): SerializedStagePiece {
  return {
    type: piece.type,
    canvasX: piece.canvasX,
    canvasY: piece.canvasY,
    width: piece.width,
    height: piece.height,
    col: piece.col,
    row: piece.row,
  };
}

/**
 * Build a wire-shaped {@link SerializedGridSpec} from a {@link GridSpec}.
 */
export function toSerializedGridSpec(spec: GridSpec): SerializedGridSpec {
  return { cellPx: spec.cellPx, width: spec.width, height: spec.height };
}

/**
 * Build a {@link CustomStageData} body from the in-memory builder
 * state. The caller (storage layer) wraps this in an envelope and
 * writes the JSON to the per-slot key.
 *
 * Pieces are projected in the order the caller hands them in; the
 * stage data model preserves insertion order so passing the result of
 * `model.getPieces()` directly yields a deterministic save.
 */
export function buildCustomStageData(
  name: string,
  gridSpec: GridSpec,
  pieces: ReadonlyArray<RegisteredPiece | PlacedPiece>,
): CustomStageData {
  return {
    name,
    gridSpec: toSerializedGridSpec(gridSpec),
    pieces: pieces.map(toSerializedPiece),
  };
}

// ---------------------------------------------------------------------------
// Serialise
// ---------------------------------------------------------------------------

/**
 * Serialise a {@link CustomStageData} to canonical JSON. Validates
 * before writing so a malformed body cannot leak to disk.
 *
 * The output is pretty-printed with two-space indentation —
 * `localStorage` is fine either way, but humans inspecting an
 * exported `.json` file in their downloads folder benefit from line
 * breaks.
 */
export function serializeCustomStage(stage: CustomStageData): string {
  assertValidCustomStageData(stage);
  const envelope = {
    schemaVersion: CUSTOM_STAGE_SCHEMA_VERSION,
    kind: 'customStage' as const,
    data: canonicaliseCustomStage(stage),
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Serialise a {@link CustomStageIndexData} to canonical JSON.
 * Validates before writing so a malformed index cannot leak to disk.
 */
export function serializeCustomStageIndex(index: CustomStageIndexData): string {
  assertValidCustomStageIndexData(index);
  const envelope = {
    schemaVersion: CUSTOM_STAGE_SCHEMA_VERSION,
    kind: 'customStageIndex' as const,
    data: canonicaliseCustomStageIndex(index),
  };
  return JSON.stringify(envelope, null, 2);
}

// ---------------------------------------------------------------------------
// Envelope validation
// ---------------------------------------------------------------------------

/**
 * Throw if `candidate` does not have a recognisable envelope shape.
 * First stage of every deserialise path — once the envelope is
 * validated we know what `kind` the payload claims to be and can
 * route to the body-specific validator.
 */
function assertValidEnvelope(
  candidate: unknown,
  expectedKind?: SerializedCustomStageKind,
): asserts candidate is { schemaVersion: number; kind: SerializedCustomStageKind; data: unknown } {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error('customStageSerializer: envelope must be a non-null object.');
  }
  const env = candidate as { schemaVersion?: unknown; kind?: unknown; data?: unknown };
  if (typeof env.schemaVersion !== 'number' || !Number.isInteger(env.schemaVersion)) {
    throw new Error(
      `customStageSerializer: schemaVersion must be an integer, got ${describeValue(env.schemaVersion)}.`,
    );
  }
  if (env.schemaVersion !== CUSTOM_STAGE_SCHEMA_VERSION) {
    throw new Error(
      `customStageSerializer: unsupported schemaVersion ${env.schemaVersion} ` +
        `(expected ${CUSTOM_STAGE_SCHEMA_VERSION}). A migration entry is required.`,
    );
  }
  if (env.kind !== 'customStage' && env.kind !== 'customStageIndex') {
    throw new Error(
      `customStageSerializer: unknown envelope kind '${describeValue(env.kind)}'.`,
    );
  }
  if (expectedKind !== undefined && env.kind !== expectedKind) {
    throw new Error(
      `customStageSerializer: expected envelope kind '${expectedKind}', got '${env.kind}'.`,
    );
  }
  if (env.data === undefined || env.data === null) {
    throw new Error('customStageSerializer: envelope.data is missing.');
  }
}

/**
 * Parse `json` into a JS value, throwing an error tagged with this
 * module's prefix so the load-stage UI can show a single source name
 * for any error that bubbles up.
 */
function parseJson(json: string): unknown {
  if (typeof json !== 'string') {
    throw new Error(
      `customStageSerializer: expected a JSON string, got ${describeValue(json)}.`,
    );
  }
  try {
    return JSON.parse(json);
  } catch (err) {
    throw new Error(
      `customStageSerializer: input is not valid JSON (${(err as Error).message}).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Deserialise — strict (throwing)
// ---------------------------------------------------------------------------

/**
 * Parse a `customStage` envelope and return the validated body.
 *
 * Throws on:
 *   • malformed JSON;
 *   • missing / wrong-version envelope;
 *   • wrong `kind` (e.g. an index blob hit this path by mistake);
 *   • body that fails {@link assertValidCustomStageData}.
 */
export function deserializeCustomStage(json: string): CustomStageData {
  const candidate = parseJson(json);
  assertValidEnvelope(candidate, 'customStage');
  assertValidCustomStageData(candidate.data);
  return candidate.data;
}

/**
 * Parse a `customStageIndex` envelope and return the validated body.
 */
export function deserializeCustomStageIndex(json: string): CustomStageIndexData {
  const candidate = parseJson(json);
  assertValidEnvelope(candidate, 'customStageIndex');
  assertValidCustomStageIndexData(candidate.data);
  return candidate.data;
}

// ---------------------------------------------------------------------------
// Deserialise — safe (Result-style)
// ---------------------------------------------------------------------------

/**
 * Non-throwing variant of {@link deserializeCustomStage}. Used by the
 * storage layer's load path so a corrupted blob produces a typed
 * `Result` rather than a thrown error the boot path has to catch.
 */
export function safeDeserializeCustomStage(
  json: string,
): DeserializeResult<CustomStageData> {
  try {
    return { ok: true, value: deserializeCustomStage(json) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Non-throwing variant of {@link deserializeCustomStageIndex}.
 */
export function safeDeserializeCustomStageIndex(
  json: string,
): DeserializeResult<CustomStageIndexData> {
  try {
    return { ok: true, value: deserializeCustomStageIndex(json) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

/**
 * Detect the envelope kind of a JSON string without fully validating
 * the body. Useful when a future "Import stage" dialog accepts an
 * arbitrary file (drag / drop, paste) and needs to pick which
 * deserialiser to call.
 *
 * Returns `null` for any input that isn't a recognisable envelope —
 * the caller decides whether to surface that as an error or silently
 * ignore the file.
 */
export function detectSerializedKind(
  json: string,
): SerializedCustomStageKind | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof candidate !== 'object' || candidate === null) return null;
  const env = candidate as { schemaVersion?: unknown; kind?: unknown };
  if (env.schemaVersion !== CUSTOM_STAGE_SCHEMA_VERSION) return null;
  if (env.kind === 'customStage' || env.kind === 'customStageIndex') return env.kind;
  return null;
}

/**
 * The recognised set of {@link BuilderPieceType} values, surfaced as a
 * frozen array so external loaders / tests can verify the validator
 * matches the catalog without re-importing it.
 */
export const RECOGNISED_PIECE_TYPES: ReadonlyArray<BuilderPieceType> = Object.freeze(
  CATALOG_PIECES.map((p) => p.type),
);
