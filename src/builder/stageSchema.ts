/**
 * Stage serialization schema — canonical TypeScript types, JSON shape,
 * version constant, and a Result-style integrity validator for custom
 * stages.
 *
 * AC 20101 Sub-AC 1 — "Define stage serialization schema (TypeScript
 * types/JSON shape) with versioning and a validation function for
 * stage data integrity".
 *
 * Why a dedicated schema module
 * -----------------------------
 *
 * The M3 stage builder has three distinct concerns the codebase keeps
 * separate so each can evolve and be tested in isolation:
 *
 *   1. **Schema** (this file) — what a saved stage *looks like* on the
 *      wire: types, version, envelope shape, integrity invariants.
 *   2. **Serializer** (`customStageSerializer.ts`) — canonical JSON
 *      encode / decode, slot-id derivation, throw-on-error and
 *      Result-style deserialise paths.
 *   3. **Storage**  (`customStageStorage.ts`) — `localStorage` IO,
 *      namespaced keys, slot index orchestration.
 *
 * AC 20101 owns concern (1). AC 20104 owns concerns (2) and (3). The
 * serializer module is older and grew its own copy of the type / version
 * declarations; this module is the canonical home and the serializer is
 * incrementally migrating to import from it. To keep that migration
 * non-breaking, this module re-exports the existing serializer types
 * verbatim — there is exactly one source of truth, just temporarily
 * declared in the older file. A follow-up clean-up sub-AC moves the
 * declarations physically into this file.
 *
 * Why a Result-style validator
 * ----------------------------
 *
 * The serializer ships **assertion**-style validators
 * (`assertValidCustomStageData`, etc.) that throw on the first bad
 * field. They are convenient inside the serializer's "fail before
 * write" guards but awkward at the *boundary*:
 *
 *   • The future "Import stage" file-drop dialog wants to surface
 *     validation problems in the UI without wrapping every call in
 *     `try` / `catch`.
 *   • The save-time guard wants to highlight the bad field by *path*
 *     (e.g. `pieces[3].canvasX`) so the player can see which piece
 *     tripped the check.
 *   • The replay engine's desync detector wants a deterministic boolean
 *     ("does this snapshot's stage payload still pass schema?") without
 *     paying for thrown-Error stack capture every frame.
 *
 * `validateStageData(candidate)` and `validateStageIndex(candidate)`
 * therefore return a structured {@link StageValidationResult} with an
 * explicit `ok: boolean` discriminant and, on failure, the offending
 * `path` and a human-readable `message`. Callers that prefer the
 * throwing form keep using `assertValidCustomStageData` from the
 * serializer — both paths agree on accept / reject because the
 * Result-style helpers wrap the assertions internally.
 *
 * Versioning policy
 * -----------------
 *
 *   • {@link STAGE_SCHEMA_VERSION} starts at `1`.
 *   • A new `BuilderPieceType`, a removed field, or any change an older
 *     loader cannot interpret bumps the version and ships a migration
 *     entry.
 *   • Strictly additive, *optional* envelope fields older loaders can
 *     ignore keep the version pinned.
 *   • A blob with a version other than {@link STAGE_SCHEMA_VERSION} is
 *     rejected with a `'unsupported-schema-version'` reason — the
 *     caller is expected to route the blob through a migration table
 *     before re-validating.
 *
 * Determinism
 * -----------
 *
 * Every helper here is a pure function of its arguments. No
 * `Math.random()`, no `Date.now()`, no Phaser. The validator does not
 * mutate its input; it walks the candidate object and accumulates a
 * Result. Two byte-identical candidate objects always produce the same
 * Result.
 */

import {
  BUILDER_CANVAS_MAX_HEIGHT,
  BUILDER_CANVAS_MAX_WIDTH,
} from './builderGrid';
import { findCatalogPiece } from './catalogPieces';
import {
  CUSTOM_STAGE_MIN_CANVAS_PX,
  CUSTOM_STAGE_NAME_MAX_LENGTH,
  CUSTOM_STAGE_NAME_MIN_LENGTH,
  CUSTOM_STAGE_SCHEMA_VERSION,
  CUSTOM_STAGE_SLOT_ID_MAX_LENGTH,
  RECOGNISED_PIECE_TYPES,
  type CustomStageData,
  type CustomStageIndexData,
  type CustomStageIndexEntry,
  type SerializedCustomStage,
  type SerializedCustomStageIndex,
  type SerializedCustomStageKind,
  type SerializedGridSpec,
  type SerializedStagePiece,
} from './customStageSerializer';
import { STAGE_PIECE_LIMIT } from './stageDataModel';

// ---------------------------------------------------------------------------
// Schema version + canonical re-exports
//
// The serializer module is the legacy declaration site for the schema
// types; this module is the canonical home and re-exports them so new
// code can import "schema" things from `stageSchema` and "serialize /
// deserialize" things from `customStageSerializer`.
// ---------------------------------------------------------------------------

/**
 * Current wire-format version. Aliased to {@link CUSTOM_STAGE_SCHEMA_VERSION}
 * so legacy imports keep working; new code imports
 * {@link STAGE_SCHEMA_VERSION} from this module.
 */
export const STAGE_SCHEMA_VERSION = CUSTOM_STAGE_SCHEMA_VERSION;

export {
  CUSTOM_STAGE_MIN_CANVAS_PX,
  CUSTOM_STAGE_NAME_MAX_LENGTH,
  CUSTOM_STAGE_NAME_MIN_LENGTH,
  CUSTOM_STAGE_SCHEMA_VERSION,
  CUSTOM_STAGE_SLOT_ID_MAX_LENGTH,
  RECOGNISED_PIECE_TYPES,
};
export type {
  CustomStageData,
  CustomStageIndexData,
  CustomStageIndexEntry,
  SerializedCustomStage,
  SerializedCustomStageIndex,
  SerializedCustomStageKind,
  SerializedGridSpec,
  SerializedStagePiece,
};

/**
 * Schema-level limits surfaced as a frozen object so tests + the UI can
 * read every cap from one place without importing N constants.
 */
export const STAGE_SCHEMA_LIMITS = Object.freeze({
  schemaVersion: CUSTOM_STAGE_SCHEMA_VERSION,
  pieceLimit: STAGE_PIECE_LIMIT,
  canvasMinPx: CUSTOM_STAGE_MIN_CANVAS_PX,
  canvasMaxWidthPx: BUILDER_CANVAS_MAX_WIDTH,
  canvasMaxHeightPx: BUILDER_CANVAS_MAX_HEIGHT,
  nameMinLength: CUSTOM_STAGE_NAME_MIN_LENGTH,
  nameMaxLength: CUSTOM_STAGE_NAME_MAX_LENGTH,
  slotIdMaxLength: CUSTOM_STAGE_SLOT_ID_MAX_LENGTH,
} as const);

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * Stable identifier for each integrity-violation flavour. Strings are
 * machine-comparable (so the future "Import stage" UI can render
 * localised copy keyed off the reason) and stay stable across patch
 * versions of the validator.
 */
export type StageValidationFailureReason =
  | 'not-an-object'
  | 'missing-field'
  | 'wrong-type'
  | 'unsupported-schema-version'
  | 'unknown-envelope-kind'
  | 'unknown-piece-type'
  | 'piece-count-exceeded'
  | 'canvas-too-small'
  | 'canvas-too-large'
  | 'piece-out-of-bounds'
  | 'piece-non-positive'
  | 'piece-negative-position'
  | 'name-empty'
  | 'name-too-long'
  | 'name-control-characters'
  | 'invalid-grid-cell-px'
  | 'duplicate-slot-id'
  | 'slot-id-empty'
  | 'slot-id-too-long';

/**
 * Structured failure: the field path that tripped the check and a
 * human-readable message. The path uses `dot.notation` for nested
 * fields and `array[i]` for indexed elements — same convention the
 * serializer's assertion messages already use, so error strings stay
 * recognisable across both APIs.
 */
export interface StageValidationFailure {
  readonly ok: false;
  readonly reason: StageValidationFailureReason;
  readonly path: string;
  readonly message: string;
}

/**
 * Successful validation: the candidate has been narrowed to the
 * declared schema type. Re-emitted as `value` so callers can chain
 * without re-casting.
 */
export interface StageValidationSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export type StageValidationResult<T> =
  | StageValidationSuccess<T>
  | StageValidationFailure;

/**
 * Build a typed failure result. Centralised so message format stays
 * consistent across every integrity check.
 */
function fail(
  reason: StageValidationFailureReason,
  path: string,
  message: string,
): StageValidationFailure {
  return { ok: false, reason, path, message };
}

function ok<T>(value: T): StageValidationSuccess<T> {
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Pretty-print a value for the error message without recursing. */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const t = typeof value;
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value);
  if (t === 'string') return JSON.stringify(value);
  if (t === 'object') return Array.isArray(value) ? `[array(${(value as unknown[]).length})]` : '[object]';
  return t;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasControlCharacters(s: string): boolean {
  // U+0000..U+001F and U+007F..U+009F are ASCII / C1 control chars.
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code < 0x20) return true;
    if (code >= 0x7f && code <= 0x9f) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Field-level validators
// ---------------------------------------------------------------------------

function validateName(
  value: unknown,
  path: string,
): StageValidationResult<string> {
  if (typeof value !== 'string') {
    return fail(
      'wrong-type',
      path,
      `${path} must be a string, got ${describeValue(value)}.`,
    );
  }
  const trimmed = value.trim();
  if (trimmed.length < CUSTOM_STAGE_NAME_MIN_LENGTH) {
    return fail(
      'name-empty',
      path,
      `${path} must have at least ${CUSTOM_STAGE_NAME_MIN_LENGTH} non-whitespace character.`,
    );
  }
  if (trimmed.length > CUSTOM_STAGE_NAME_MAX_LENGTH) {
    return fail(
      'name-too-long',
      path,
      `${path} must be at most ${CUSTOM_STAGE_NAME_MAX_LENGTH} characters (got ${trimmed.length}).`,
    );
  }
  if (hasControlCharacters(value)) {
    return fail(
      'name-control-characters',
      path,
      `${path} contains control characters.`,
    );
  }
  return ok(value);
}

function validateGridSpec(
  value: unknown,
  path: string,
): StageValidationResult<SerializedGridSpec> {
  if (typeof value !== 'object' || value === null) {
    return fail(
      'not-an-object',
      path,
      `${path} must be a non-null object, got ${describeValue(value)}.`,
    );
  }
  const g = value as { cellPx?: unknown; width?: unknown; height?: unknown };
  if (!isFiniteNumber(g.cellPx)) {
    return fail(
      'wrong-type',
      `${path}.cellPx`,
      `${path}.cellPx must be a finite number, got ${describeValue(g.cellPx)}.`,
    );
  }
  if (g.cellPx < 1) {
    return fail(
      'invalid-grid-cell-px',
      `${path}.cellPx`,
      `${path}.cellPx must be ≥ 1, got ${g.cellPx}.`,
    );
  }
  if (!isFiniteNumber(g.width)) {
    return fail(
      'wrong-type',
      `${path}.width`,
      `${path}.width must be a finite number, got ${describeValue(g.width)}.`,
    );
  }
  if (g.width < CUSTOM_STAGE_MIN_CANVAS_PX) {
    return fail(
      'canvas-too-small',
      `${path}.width`,
      `${path}.width must be ≥ ${CUSTOM_STAGE_MIN_CANVAS_PX}, got ${g.width}.`,
    );
  }
  if (g.width > BUILDER_CANVAS_MAX_WIDTH) {
    return fail(
      'canvas-too-large',
      `${path}.width`,
      `${path}.width exceeds the 2× screen cap (${BUILDER_CANVAS_MAX_WIDTH}), got ${g.width}.`,
    );
  }
  if (!isFiniteNumber(g.height)) {
    return fail(
      'wrong-type',
      `${path}.height`,
      `${path}.height must be a finite number, got ${describeValue(g.height)}.`,
    );
  }
  if (g.height < CUSTOM_STAGE_MIN_CANVAS_PX) {
    return fail(
      'canvas-too-small',
      `${path}.height`,
      `${path}.height must be ≥ ${CUSTOM_STAGE_MIN_CANVAS_PX}, got ${g.height}.`,
    );
  }
  if (g.height > BUILDER_CANVAS_MAX_HEIGHT) {
    return fail(
      'canvas-too-large',
      `${path}.height`,
      `${path}.height exceeds the 2× screen cap (${BUILDER_CANVAS_MAX_HEIGHT}), got ${g.height}.`,
    );
  }
  return ok({ cellPx: g.cellPx, width: g.width, height: g.height });
}

function validatePiece(
  value: unknown,
  path: string,
  gridSpec: SerializedGridSpec,
): StageValidationResult<SerializedStagePiece> {
  if (typeof value !== 'object' || value === null) {
    return fail(
      'not-an-object',
      path,
      `${path} must be a non-null object, got ${describeValue(value)}.`,
    );
  }
  const p = value as Record<string, unknown>;

  if (typeof p.type !== 'string') {
    return fail(
      'wrong-type',
      `${path}.type`,
      `${path}.type must be a string, got ${describeValue(p.type)}.`,
    );
  }
  if (!findCatalogPiece(p.type)) {
    return fail(
      'unknown-piece-type',
      `${path}.type`,
      `${path}.type '${p.type}' is not in the catalog.`,
    );
  }

  // Geometry — every numeric field must be finite.
  for (const field of ['canvasX', 'canvasY', 'width', 'height', 'col', 'row'] as const) {
    if (!isFiniteNumber(p[field])) {
      return fail(
        'wrong-type',
        `${path}.${field}`,
        `${path}.${field} must be a finite number, got ${describeValue(p[field])}.`,
      );
    }
  }

  const canvasX = p.canvasX as number;
  const canvasY = p.canvasY as number;
  const width = p.width as number;
  const height = p.height as number;
  const col = p.col as number;
  const row = p.row as number;

  if (width <= 0 || height <= 0) {
    return fail(
      'piece-non-positive',
      path,
      `${path} footprint must be positive, got ${width}×${height}.`,
    );
  }
  if (canvasX < 0 || canvasY < 0) {
    return fail(
      'piece-negative-position',
      path,
      `${path} top-left must be ≥ 0, got (${canvasX}, ${canvasY}).`,
    );
  }
  if (canvasX + width > gridSpec.width) {
    return fail(
      'piece-out-of-bounds',
      path,
      `${path} clips the right canvas edge (${canvasX + width} > ${gridSpec.width}).`,
    );
  }
  if (canvasY + height > gridSpec.height) {
    return fail(
      'piece-out-of-bounds',
      path,
      `${path} clips the bottom canvas edge (${canvasY + height} > ${gridSpec.height}).`,
    );
  }

  return ok({
    type: p.type as SerializedStagePiece['type'],
    canvasX,
    canvasY,
    width,
    height,
    col,
    row,
  });
}

// ---------------------------------------------------------------------------
// Public — body-level validators
// ---------------------------------------------------------------------------

/**
 * Validate a candidate {@link CustomStageData} body. Runs every
 * integrity check the schema demands and returns the first failure as
 * a structured {@link StageValidationResult}.
 *
 * The checks, in order of fail-fast cost:
 *
 *   1. The body is a non-null object.
 *   2. `name` is a 1..64-char string with no control characters.
 *   3. `gridSpec` declares a finite, positive, in-cap canvas.
 *   4. `pieces` is an array no longer than {@link STAGE_PIECE_LIMIT}.
 *   5. Every piece is a recognised catalog type with a finite,
 *      positive, fully-in-canvas footprint.
 *
 * On success the returned `value` is the same object reference, narrowed
 * to {@link CustomStageData}. On failure the result names the offending
 * path so the caller can highlight it in the UI without re-walking the
 * tree.
 */
export function validateStageData(
  candidate: unknown,
  rootPath: string = 'stage',
): StageValidationResult<CustomStageData> {
  if (typeof candidate !== 'object' || candidate === null) {
    return fail(
      'not-an-object',
      rootPath,
      `${rootPath} must be a non-null object, got ${describeValue(candidate)}.`,
    );
  }

  const d = candidate as Record<string, unknown>;

  const nameResult = validateName(d.name, `${rootPath}.name`);
  if (!nameResult.ok) return nameResult;

  const gridResult = validateGridSpec(d.gridSpec, `${rootPath}.gridSpec`);
  if (!gridResult.ok) return gridResult;

  if (!Array.isArray(d.pieces)) {
    return fail(
      'wrong-type',
      `${rootPath}.pieces`,
      `${rootPath}.pieces must be an array, got ${describeValue(d.pieces)}.`,
    );
  }
  if (d.pieces.length > STAGE_PIECE_LIMIT) {
    return fail(
      'piece-count-exceeded',
      `${rootPath}.pieces`,
      `${rootPath}.pieces.length ${d.pieces.length} exceeds the ${STAGE_PIECE_LIMIT}-piece hard cap.`,
    );
  }

  const validatedPieces: SerializedStagePiece[] = [];
  for (let i = 0; i < d.pieces.length; i += 1) {
    const result = validatePiece(
      d.pieces[i],
      `${rootPath}.pieces[${i}]`,
      gridResult.value,
    );
    if (!result.ok) return result;
    validatedPieces.push(result.value);
  }

  return ok({
    name: nameResult.value,
    gridSpec: gridResult.value,
    pieces: validatedPieces,
  });
}

/**
 * Validate a candidate {@link CustomStageIndexData}. The slot index is
 * the canonical roster of saved stages; storage uses each entry's `id`
 * as a unique key, so duplicates would silently clobber a slot.
 */
export function validateStageIndex(
  candidate: unknown,
  rootPath: string = 'index',
): StageValidationResult<CustomStageIndexData> {
  if (typeof candidate !== 'object' || candidate === null) {
    return fail(
      'not-an-object',
      rootPath,
      `${rootPath} must be a non-null object, got ${describeValue(candidate)}.`,
    );
  }
  const d = candidate as { slots?: unknown };
  if (!Array.isArray(d.slots)) {
    return fail(
      'wrong-type',
      `${rootPath}.slots`,
      `${rootPath}.slots must be an array, got ${describeValue(d.slots)}.`,
    );
  }

  const seen = new Set<string>();
  const validatedSlots: CustomStageIndexEntry[] = [];

  for (let i = 0; i < d.slots.length; i += 1) {
    const entry = d.slots[i];
    const at = `${rootPath}.slots[${i}]`;
    if (typeof entry !== 'object' || entry === null) {
      return fail(
        'not-an-object',
        at,
        `${at} must be a non-null object, got ${describeValue(entry)}.`,
      );
    }
    const e = entry as { id?: unknown; name?: unknown };
    if (typeof e.id !== 'string') {
      return fail(
        'wrong-type',
        `${at}.id`,
        `${at}.id must be a string, got ${describeValue(e.id)}.`,
      );
    }
    if (e.id.length === 0) {
      return fail(
        'slot-id-empty',
        `${at}.id`,
        `${at}.id must be a non-empty string.`,
      );
    }
    if (e.id.length > CUSTOM_STAGE_SLOT_ID_MAX_LENGTH) {
      return fail(
        'slot-id-too-long',
        `${at}.id`,
        `${at}.id exceeds ${CUSTOM_STAGE_SLOT_ID_MAX_LENGTH} chars (got ${e.id.length}).`,
      );
    }
    const nameResult = validateName(e.name, `${at}.name`);
    if (!nameResult.ok) return nameResult;
    if (seen.has(e.id)) {
      return fail(
        'duplicate-slot-id',
        `${at}.id`,
        `${rootPath} contains duplicate slot id '${e.id}'.`,
      );
    }
    seen.add(e.id);
    validatedSlots.push({ id: e.id, name: nameResult.value });
  }

  return ok({ slots: validatedSlots });
}

// ---------------------------------------------------------------------------
// Envelope-level validators
// ---------------------------------------------------------------------------

/**
 * Validate a complete `customStage` envelope (schemaVersion + kind +
 * data). The version check is the first hard wall: a future blob with
 * a higher version is rejected with `'unsupported-schema-version'` so
 * the caller can route it through the migration table before retry.
 */
export function validateStageEnvelope(
  candidate: unknown,
  rootPath: string = 'envelope',
): StageValidationResult<SerializedCustomStage> {
  const envelope = validateEnvelopeShape(candidate, 'customStage', rootPath);
  if (!envelope.ok) return envelope;

  const dataResult = validateStageData(envelope.value.data, `${rootPath}.data`);
  if (!dataResult.ok) return dataResult;

  return ok({
    schemaVersion: STAGE_SCHEMA_VERSION,
    kind: 'customStage',
    data: dataResult.value,
  });
}

/** Validate a complete `customStageIndex` envelope. */
export function validateStageIndexEnvelope(
  candidate: unknown,
  rootPath: string = 'envelope',
): StageValidationResult<SerializedCustomStageIndex> {
  const envelope = validateEnvelopeShape(candidate, 'customStageIndex', rootPath);
  if (!envelope.ok) return envelope;

  const dataResult = validateStageIndex(envelope.value.data, `${rootPath}.data`);
  if (!dataResult.ok) return dataResult;

  return ok({
    schemaVersion: STAGE_SCHEMA_VERSION,
    kind: 'customStageIndex',
    data: dataResult.value,
  });
}

interface EnvelopeShape {
  readonly schemaVersion: number;
  readonly kind: SerializedCustomStageKind;
  readonly data: unknown;
}

function validateEnvelopeShape(
  candidate: unknown,
  expectedKind: SerializedCustomStageKind,
  rootPath: string,
): StageValidationResult<EnvelopeShape> {
  if (typeof candidate !== 'object' || candidate === null) {
    return fail(
      'not-an-object',
      rootPath,
      `${rootPath} must be a non-null object, got ${describeValue(candidate)}.`,
    );
  }
  const env = candidate as {
    schemaVersion?: unknown;
    kind?: unknown;
    data?: unknown;
  };
  if (typeof env.schemaVersion !== 'number' || !Number.isInteger(env.schemaVersion)) {
    return fail(
      'wrong-type',
      `${rootPath}.schemaVersion`,
      `${rootPath}.schemaVersion must be an integer, got ${describeValue(env.schemaVersion)}.`,
    );
  }
  if (env.schemaVersion !== STAGE_SCHEMA_VERSION) {
    return fail(
      'unsupported-schema-version',
      `${rootPath}.schemaVersion`,
      `${rootPath}.schemaVersion ${env.schemaVersion} is unsupported (expected ${STAGE_SCHEMA_VERSION}).`,
    );
  }
  if (env.kind !== 'customStage' && env.kind !== 'customStageIndex') {
    return fail(
      'unknown-envelope-kind',
      `${rootPath}.kind`,
      `${rootPath}.kind must be 'customStage' or 'customStageIndex', got ${describeValue(env.kind)}.`,
    );
  }
  if (env.kind !== expectedKind) {
    return fail(
      'unknown-envelope-kind',
      `${rootPath}.kind`,
      `${rootPath}.kind must be '${expectedKind}', got '${env.kind}'.`,
    );
  }
  if (env.data === undefined || env.data === null) {
    return fail(
      'missing-field',
      `${rootPath}.data`,
      `${rootPath}.data is missing.`,
    );
  }
  return ok({
    schemaVersion: env.schemaVersion,
    kind: env.kind,
    data: env.data,
  });
}

// ---------------------------------------------------------------------------
// Convenience predicates — sometimes a caller just wants a boolean.
// ---------------------------------------------------------------------------

/**
 * `true` iff `candidate` passes {@link validateStageData}. Useful for
 * one-line guards in the replay desync detector and tests.
 */
export function isValidStageData(candidate: unknown): candidate is CustomStageData {
  return validateStageData(candidate).ok;
}

/** `true` iff `candidate` passes {@link validateStageIndex}. */
export function isValidStageIndex(
  candidate: unknown,
): candidate is CustomStageIndexData {
  return validateStageIndex(candidate).ok;
}
