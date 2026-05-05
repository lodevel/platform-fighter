/**
 * Canonical stage-data deserializer / parser.
 *
 * AC 20201 Sub-AC 1 — "Create stage data deserializer/parser module
 * that validates saved stage JSON schema and converts it into an
 * in-memory stage descriptor (platforms, spawn points, hazards,
 * boundaries)".
 *
 * Why a dedicated parser module
 * -----------------------------
 *
 * Three pre-existing modules each own one slice of the pipeline:
 *
 *   1. {@link validateStageEnvelope} (`builder/stageSchema.ts`) — pure
 *      structural validation of the envelope + body, returning a
 *      Result-style outcome.
 *   2. {@link safeDeserializeCustomStage} / {@link deserializeCustomStage}
 *      (`builder/customStageSerializer.ts`) — JSON parse + assertion-
 *      style validation that yields a `CustomStageData` body.
 *   3. {@link customStageDataToStageLayout} (`stages/customStageLoader.ts`)
 *      — geometry conversion that maps each builder piece onto a
 *      runtime {@link StagePlatform} / {@link StageHazard} / spawn
 *      point.
 *
 * What was missing was a single, canonical entry point that takes the
 * blob a player / file-drop / replay header hands you (a `string`, an
 * already-parsed envelope, or a raw `data` body) and returns a
 * runtime-shaped {@link StageLayout} — without forcing every caller
 * to wire the three modules together by hand. This module is that
 * entry point. It is the seam the M3 builder's "Load…" dialog, the
 * future "Import stage" file-drop UI, and the replay engine's
 * stage-rehydrator all share.
 *
 * Why a Result-style API
 * ----------------------
 *
 * The boundary between disk / network / clipboard and the runtime is
 * the place where a malformed blob is most likely to appear:
 *
 *   • A player edits their `localStorage` from DevTools.
 *   • An old replay header references a schema version this build
 *     hasn't shipped a migration for yet.
 *   • A future "Import" dialog accepts an arbitrary `.json` file.
 *
 * Throwing on the first bad field is convenient inside the serializer's
 * "fail before write" guards but awkward at this boundary because the
 * UI wants to render a localised error keyed by a stable `reason`
 * rather than show a raw `Error.message`. Hence
 * {@link parseStageData} / {@link parseStageJson} return the same
 * {@link StageValidationResult} discriminator the schema validator
 * already uses, with the success branch carrying a fully-built
 * {@link StageLayout} (`value.layout`) plus the validated
 * {@link CustomStageData} body (`value.data`) so callers that want
 * both — e.g. the load dialog wants the slot name for its toast and
 * the layout for the live match — get them in one pass.
 *
 * Determinism
 * -----------
 *
 *   • Pure data transform — no `Math.random()`, no wall-clock reads,
 *     no Phaser. Every function is deterministic on its inputs.
 *   • The parser preserves piece order so the runtime body order
 *     matches what the player authored, exactly as
 *     {@link customStageDataToStageLayout} guarantees on its own.
 *   • The same JSON string parsed twice yields two `StageLayout`
 *     objects whose JSON projection is byte-identical (modulo the
 *     deliberate `Object.freeze` on `platforms` / `hazards` /
 *     `spawnPoints` arrays).
 *
 * Strict TypeScript
 * -----------------
 *
 * Compiles under `strict + noUncheckedIndexedAccess`. The
 * {@link ParsedStage} type carries readonly slices, and the failure
 * branch reuses {@link StageValidationFailure} so callers that already
 * branch on {@link StageValidationFailureReason} for the structural
 * validator don't need a second discriminator for the parser.
 */

import type {
  BlastZone,
  StageHazard,
  StageLayout,
  StagePlatform,
} from '../types';
import type { CustomStageData } from '../builder/customStageSerializer';
import type {
  StageValidationFailure,
  StageValidationFailureReason,
  StageValidationResult,
} from '../builder/stageSchema';
import {
  validateStageData,
  validateStageEnvelope,
} from '../builder/stageSchema';
import {
  customStageDataToStageLayout,
  type CustomStageLoaderOptions,
} from './customStageLoader';

// ---------------------------------------------------------------------------
// Re-exports — let downstream code import the failure-shape types from a
// single module without forcing `import { … } from '../builder/...'` for
// the schema half and `import { … } from './customStageLoader'` for the
// runtime half.
// ---------------------------------------------------------------------------

export type {
  StageValidationFailure,
  StageValidationFailureReason,
  StageValidationResult,
} from '../builder/stageSchema';

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/**
 * The validated body + the runtime descriptor produced from it. Callers
 * that only need the layout can read `value.layout`; callers that need
 * the slot name (e.g. for a "Loaded *Lava Tower*" toast) read
 * `value.data.name`.
 *
 * `layout` is the in-memory stage descriptor the runtime consumes:
 *
 *   • `platforms`  — `ReadonlyArray<StagePlatform>` (solid + drop-through
 *     + moving). Insertion order matches the saved piece order.
 *   • `hazards`    — `ReadonlyArray<StageHazard>` (lava-zone, wind-zone).
 *   • `spawnPoints`— `ReadonlyArray<{x, y}>`, padded to four points
 *     using {@link buildFallbackSpawnPoints} when the saved stage didn't
 *     include enough explicit `spawn-point` pieces.
 *   • `blastZone`  — `BlastZone` envelope (the four boundary distances)
 *     computed from the canvas dimensions using the canonical outset.
 */
export interface ParsedStage {
  /** Validated, schema-conforming body. Useful for slot names + UI labels. */
  readonly data: CustomStageData;
  /** Runtime in-memory stage descriptor. Pass directly to `StageRenderer`. */
  readonly layout: StageLayout;
}

/**
 * Options forwarded through to {@link customStageDataToStageLayout} —
 * primarily the `runtimeIdOverride` the match flow uses to attach a
 * specific slot id to the loaded stage so the replay header round-
 * trips unambiguously.
 */
export interface ParseStageOptions extends CustomStageLoaderOptions {
  /**
   * When `true`, accept a raw `CustomStageData` body (no envelope).
   * Defaults to `false` for {@link parseStageEnvelope} — that path
   * always expects a full envelope. {@link parseStageData} sets this
   * to `true` automatically since it is the body-level entry point.
   */
  readonly acceptRawBody?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers — kept private so the public API stays narrow.
// ---------------------------------------------------------------------------

function fail(
  reason: StageValidationFailureReason,
  path: string,
  message: string,
): StageValidationFailure {
  return { ok: false, reason, path, message };
}

function success(
  data: CustomStageData,
  options: ParseStageOptions,
): StageValidationResult<ParsedStage> {
  // The conversion never fails for a body that already passed
  // schema validation — every branch in `customStageDataToStageLayout`
  // tolerates an unknown piece type, and spawn-point fallback
  // guarantees a non-empty array. This wrapper exists so a future
  // hardening pass can add post-conversion sanity checks (e.g.
  // "platform width × count fits the renderer's body cap") without
  // changing the public surface.
  const layout = customStageDataToStageLayout(data, {
    runtimeIdOverride: options.runtimeIdOverride,
  });
  return { ok: true, value: { data, layout } };
}

// ---------------------------------------------------------------------------
// Public — parse from raw body (`CustomStageData`-shaped object)
// ---------------------------------------------------------------------------

/**
 * Parse a candidate {@link CustomStageData} body — already JSON-parsed,
 * with no envelope wrapper. Returns a {@link ParsedStage} (data +
 * runtime layout) on success, or a structured
 * {@link StageValidationFailure} on the first failed integrity check.
 *
 * Use this when the caller is sure they already have a body (e.g.
 * the storage layer's `loadCustomStage` returns one directly), or
 * when the envelope was already validated upstream and only the body
 * needs to round-trip through the parser.
 */
export function parseStageData(
  candidate: unknown,
  options: ParseStageOptions = {},
): StageValidationResult<ParsedStage> {
  const validation = validateStageData(candidate, 'stage');
  if (!validation.ok) return validation;
  return success(validation.value, options);
}

// ---------------------------------------------------------------------------
// Public — parse from envelope (`{ schemaVersion, kind, data }` object)
// ---------------------------------------------------------------------------

/**
 * Parse a candidate envelope — typically the result of `JSON.parse(blob)`
 * for an exported stage file. Validates schema version + kind +
 * body, then converts. Returns a structured failure for any of the
 * envelope-level reasons (`'unsupported-schema-version'`,
 * `'unknown-envelope-kind'`, `'missing-field'`) so the future "Import
 * stage" UI can render a localised error keyed off the reason.
 */
export function parseStageEnvelope(
  candidate: unknown,
  options: ParseStageOptions = {},
): StageValidationResult<ParsedStage> {
  const envelope = validateStageEnvelope(candidate, 'envelope');
  if (!envelope.ok) return envelope;
  return success(envelope.value.data, options);
}

// ---------------------------------------------------------------------------
// Public — parse from JSON string
// ---------------------------------------------------------------------------

/**
 * Parse a JSON string into a runtime stage descriptor.
 *
 * Order of checks:
 *
 *   1. Input is a string. (`'wrong-type'` at `'json'`.)
 *   2. JSON syntax is valid. (`'wrong-type'` at `'json'`, message
 *      includes the parser's diagnostic.)
 *   3. Envelope shape (or, if `options.acceptRawBody === true`, the
 *      body shape directly).
 *   4. Body integrity (every piece, geometry, name, gridSpec).
 *
 * On success, the returned {@link ParsedStage} carries both the
 * validated body (so callers can show the slot name / piece count)
 * and the live runtime layout (so the match flow can hand it to
 * `StageRenderer` without re-walking the data).
 */
export function parseStageJson(
  json: string,
  options: ParseStageOptions = {},
): StageValidationResult<ParsedStage> {
  if (typeof json !== 'string') {
    return fail(
      'wrong-type',
      'json',
      `parseStageJson: expected a JSON string, got ${describeValue(json)}.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return fail(
      'wrong-type',
      'json',
      `parseStageJson: input is not valid JSON (${(err as Error).message}).`,
    );
  }

  if (options.acceptRawBody && !looksLikeEnvelope(parsed)) {
    return parseStageData(parsed, options);
  }

  return parseStageEnvelope(parsed, options);
}

/**
 * Throwing variant of {@link parseStageJson}. Calls the safe parser
 * and rethrows the structured failure as an `Error` whose message
 * includes the failed `path` and the schema's `reason` code.
 *
 * Use sparingly — most boundary call sites prefer the Result form so
 * they don't have to wrap their handler in `try` / `catch`.
 */
export function parseStageJsonOrThrow(
  json: string,
  options: ParseStageOptions = {},
): ParsedStage {
  const result = parseStageJson(json, options);
  if (!result.ok) {
    throw new Error(
      `parseStageJsonOrThrow: ${result.message} ` +
        `(reason='${result.reason}', path='${result.path}')`,
    );
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// Public — predicates / boundary helpers
// ---------------------------------------------------------------------------

/**
 * `true` iff the given JSON string parses to a recognisable envelope or
 * body that {@link parseStageJson} would accept. Useful for the future
 * "Import" file-drop UI that wants to enable / disable the import
 * button before the player commits.
 */
export function isParseableStageJson(
  json: string,
  options: ParseStageOptions = {},
): boolean {
  return parseStageJson(json, options).ok;
}

/**
 * Convenience accessor: extract just the {@link BlastZone} boundaries
 * from a parsed result. Used by the (future) "preview" mode that draws
 * the stage envelope before the live scene is built.
 */
export function blastZoneFromParsed(parsed: ParsedStage): BlastZone {
  return parsed.layout.blastZone;
}

/**
 * Convenience accessor: extract just the platform descriptors. The
 * stage builder's preview pane uses this to paint the platforms while
 * iterating the catalog rather than rebuilding the runtime body list.
 */
export function platformsFromParsed(
  parsed: ParsedStage,
): ReadonlyArray<StagePlatform> {
  return parsed.layout.platforms;
}

/**
 * Convenience accessor: extract just the hazard descriptors.
 */
export function hazardsFromParsed(
  parsed: ParsedStage,
): ReadonlyArray<StageHazard> {
  return parsed.layout.hazards;
}

/**
 * Convenience accessor: extract just the spawn-point coordinates.
 */
export function spawnPointsFromParsed(
  parsed: ParsedStage,
): ReadonlyArray<{ x: number; y: number }> {
  return parsed.layout.spawnPoints;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function looksLikeEnvelope(candidate: unknown): boolean {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const env = candidate as { schemaVersion?: unknown; kind?: unknown };
  return (
    typeof env.schemaVersion === 'number' &&
    (env.kind === 'customStage' || env.kind === 'customStageIndex')
  );
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const t = typeof value;
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value);
  if (t === 'string') return JSON.stringify(value);
  if (t === 'object') return Array.isArray(value) ? `[array(${(value as unknown[]).length})]` : '[object]';
  return t;
}
