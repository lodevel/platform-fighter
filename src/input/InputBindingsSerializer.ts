/**
 * Binding configuration serialization — AC 40004 Sub-AC 4.
 *
 * Purpose
 * -------
 *
 * Sub-AC 1 introduced the unified {@link PlayerBindings} schema; Sub-AC 2
 * landed the in-memory {@link InputBindingsStore}; Sub-AC 3 added the
 * runtime device dispatcher. This module closes the persistence side of
 * the M5 rebinding loop: a single, versioned wire format the rebinding
 * UI, the `localStorage` settings layer, and the replay payload all
 * share, with strict validation on the way in so a corrupted blob can't
 * silently leave a player unable to jump.
 *
 * Why an envelope, not a raw `JSON.stringify(playerBindings)`
 * ----------------------------------------------------------
 *
 * The binding schema will evolve — new logical actions, new device
 * families (arcade sticks, MIDI controllers), new fields on existing
 * bindings (per-slot vibration, alternate dead-zone curves). A blob
 * written today that round-trips through a future loader has to declare
 * "I am version N" so the loader can either accept it, migrate it, or
 * reject it loudly. The envelope shape is therefore:
 *
 *     { "schemaVersion": 1, "kind": "playerBindings",  "data": { ... } }
 *     { "schemaVersion": 1, "kind": "bindingsSnapshot","data": { ... } }
 *
 * The `kind` discriminator is essential because both shapes appear at
 * the top level of saved files: the rebinding UI saves a single slot
 * ("export P3's pad layout"), while the global settings layer saves the
 * full four-slot snapshot. A loader that opens an unknown file path
 * needs to know which one it's holding before it can validate the
 * `data` field.
 *
 * Determinism
 * -----------
 *
 *   • {@link serializePlayerBindings} and {@link serializeBindingsSnapshot}
 *     emit *canonical* JSON: keys are written in a fixed order
 *     (envelope → schemaVersion, kind, data; per binding → kind first,
 *     then the device-specific fields), and `LOGICAL_ACTIONS` controls
 *     the per-action ordering. Two equivalent binding tables therefore
 *     produce byte-identical strings — the replay system can hash a
 *     payload as part of its desync check, and a settings file written
 *     by two different sessions of the same game compares clean in
 *     `diff`.
 *   • No `Math.random()`, no `Date.now()`, no Phaser. The module is a
 *     pure data transform.
 *
 * Error handling
 * --------------
 *
 * Two flavours are exposed for every load path:
 *
 *   • `deserialize…(json)` throws on the first invalid field, with a
 *     descriptive message that names the offending action / index. Used
 *     by the rebinding UI when a user clicks "Import" and we want a
 *     dialog with a clear error.
 *   • `safeDeserialize…(json)` returns a discriminated `Result` so the
 *     replay loader can fall back to defaults when the embedded
 *     bindings are too old to load — without wrapping every call in a
 *     `try` / `catch`.
 */

import {
  LOGICAL_ACTIONS,
  type ActionBindings,
  type GamepadBinding,
  type GamepadBindingSource,
  type InputBinding,
  type KeyboardBinding,
  type LogicalAction,
  type PlayerBindings,
  type PlayerBindingsIndex,
} from '../types/inputBindings';
import { assertValidPlayerBindings } from './InputBindingsStore';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/**
 * Current wire-format version. Bump in lockstep with any change to the
 * envelope shape *or* to a field on {@link PlayerBindings} that older
 * loaders cannot interpret. Migrations live in
 * {@link migrateSerializedPayload} (a future sub-AC) — for now any
 * version other than this constant is rejected.
 *
 * Versioning policy:
 *
 *   • Patch additions that older loaders can ignore (e.g. an optional
 *     metadata field on the envelope) keep this constant pinned.
 *   • Additions to {@link InputBinding} (a new device kind, a new
 *     required field) bump the constant, because an older loader's
 *     `assertValidPlayerBindings` would reject the new shape.
 *   • Removing or renaming a {@link LogicalAction} bumps the constant
 *     and requires a migration entry — replays from before the rename
 *     are otherwise unrecoverable.
 */
export const BINDINGS_SCHEMA_VERSION = 1 as const;

/** Recognised top-level discriminators. */
export type SerializedBindingsKind = 'playerBindings' | 'bindingsSnapshot';

// ---------------------------------------------------------------------------
// Envelope shapes
// ---------------------------------------------------------------------------

/**
 * Wire payload for a single player slot's bindings.
 *
 * The rebinding UI writes one of these per "Export this player's
 * controls"; the replay layer embeds one per active player when the
 * match was recorded under custom bindings.
 */
export interface SerializedPlayerBindings {
  readonly schemaVersion: typeof BINDINGS_SCHEMA_VERSION;
  readonly kind: 'playerBindings';
  readonly data: PlayerBindings;
}

/**
 * Wire payload for the entire four-slot snapshot from
 * {@link InputBindingsStore.snapshot}.
 *
 * The settings layer writes one of these to `localStorage` under a
 * single key; the replay loader uses {@link safeDeserializeBindingsSnapshot}
 * so a missing or out-of-version blob silently falls back to defaults
 * rather than blocking match playback.
 *
 * `data` is keyed by stringified slot indices because that's how
 * `JSON.stringify` writes numeric record keys; the deserializer
 * coerces them back to the {@link PlayerBindingsIndex} numeric union.
 */
export interface SerializedBindingsSnapshot {
  readonly schemaVersion: typeof BINDINGS_SCHEMA_VERSION;
  readonly kind: 'bindingsSnapshot';
  /** All four slots keyed by stringified index ('1' .. '4'). */
  readonly data: Readonly<Record<'1' | '2' | '3' | '4', PlayerBindings>>;
}

/** Result type for `safeDeserialize…` — avoids forcing callers to use try/catch. */
export type DeserializeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

// ---------------------------------------------------------------------------
// Canonicalisation helpers
// ---------------------------------------------------------------------------

/**
 * Produce a fresh, plain-object copy of an {@link InputBinding} with
 * properties written in canonical order (`kind` first, then the
 * device-specific fields). Plain `JSON.stringify` writes keys in
 * insertion order, so we control the order by building a new object
 * here rather than trusting the caller's literal layout.
 */
function canonicaliseBinding(binding: InputBinding): Record<string, unknown> {
  if (binding.kind === 'keyboard') {
    const kb: KeyboardBinding = binding;
    return { kind: 'keyboard', keyCode: kb.keyCode };
  }
  const gp: GamepadBinding = binding;
  return {
    kind: 'gamepad',
    gamepadIndex: gp.gamepadIndex,
    source: canonicaliseGamepadSource(gp.source),
  };
}

function canonicaliseGamepadSource(source: GamepadBindingSource): Record<string, unknown> {
  if (source.type === 'button') {
    return { type: 'button', buttonIndex: source.buttonIndex };
  }
  return {
    type: 'axis',
    axisIndex: source.axisIndex,
    direction: source.direction,
    threshold: source.threshold,
  };
}

/**
 * Build a fresh {@link ActionBindings}-shaped object with actions
 * written in {@link LOGICAL_ACTIONS} order. The shape itself is
 * already complete (the type uses `Record<LogicalAction, ...>`), so
 * we are only enforcing key insertion order for byte-stable output.
 */
function canonicaliseActionBindings(map: ActionBindings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const action of LOGICAL_ACTIONS) {
    out[action] = map[action].map(canonicaliseBinding);
  }
  return out;
}

function canonicalisePlayerBindings(pb: PlayerBindings): Record<string, unknown> {
  return {
    playerIndex: pb.playerIndex,
    bindings: canonicaliseActionBindings(pb.bindings),
  };
}

// ---------------------------------------------------------------------------
// Serialise
// ---------------------------------------------------------------------------

/**
 * Serialise a single {@link PlayerBindings} to a canonical JSON string.
 *
 * Output format is the {@link SerializedPlayerBindings} envelope at
 * the top level so the loader can identify the payload kind without
 * relying on file extension or surrounding structure. The string is
 * pretty-printed with two-space indentation — `localStorage` is fine
 * either way, but humans inspecting an exported `.json` file in their
 * downloads folder benefit from line breaks.
 *
 * Throws if the input fails {@link assertValidPlayerBindings}, so a
 * caller cannot accidentally write a corrupted blob to disk and only
 * discover the corruption on next reload.
 */
export function serializePlayerBindings(bindings: PlayerBindings): string {
  assertValidPlayerBindings(bindings, bindings.playerIndex);
  const envelope = {
    schemaVersion: BINDINGS_SCHEMA_VERSION,
    kind: 'playerBindings' as const,
    data: canonicalisePlayerBindings(bindings),
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Serialise the full four-slot snapshot to a canonical JSON string.
 *
 * Slot keys are written in `'1' '2' '3' '4'` order so two stores with
 * identical state produce byte-identical output. This is the
 * settings-layer save path; replays embed the same envelope inside
 * their own outer wrapper.
 */
export function serializeBindingsSnapshot(
  snapshot: Readonly<Record<PlayerBindingsIndex, PlayerBindings>>,
): string {
  // Validate every slot before writing anything — fail before we touch IO.
  const slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
  for (const slot of slots) {
    const pb = snapshot[slot];
    if (pb === undefined) {
      throw new Error(`serializeBindingsSnapshot: slot ${slot} is missing from snapshot.`);
    }
    assertValidPlayerBindings(pb, slot);
  }
  const data: Record<string, unknown> = {};
  for (const slot of slots) {
    data[String(slot)] = canonicalisePlayerBindings(snapshot[slot]);
  }
  const envelope = {
    schemaVersion: BINDINGS_SCHEMA_VERSION,
    kind: 'bindingsSnapshot' as const,
    data,
  };
  return JSON.stringify(envelope, null, 2);
}

// ---------------------------------------------------------------------------
// Envelope validation
// ---------------------------------------------------------------------------

/**
 * Throw if `candidate` does not have a recognisable envelope shape.
 * This is the first stage of every deserialise path — once the
 * envelope is validated we know what `kind` the payload claims to be
 * and can route to the body-specific validator.
 */
function assertValidEnvelope(
  candidate: unknown,
  expectedKind?: SerializedBindingsKind,
): asserts candidate is { schemaVersion: number; kind: SerializedBindingsKind; data: unknown } {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error('InputBindingsSerializer: envelope must be a non-null object.');
  }
  const env = candidate as { schemaVersion?: unknown; kind?: unknown; data?: unknown };
  if (typeof env.schemaVersion !== 'number' || !Number.isInteger(env.schemaVersion)) {
    throw new Error(
      `InputBindingsSerializer: schemaVersion must be an integer, got ${String(env.schemaVersion)}.`,
    );
  }
  if (env.schemaVersion !== BINDINGS_SCHEMA_VERSION) {
    throw new Error(
      `InputBindingsSerializer: unsupported schemaVersion ${env.schemaVersion} ` +
        `(expected ${BINDINGS_SCHEMA_VERSION}). A migration entry is required.`,
    );
  }
  if (env.kind !== 'playerBindings' && env.kind !== 'bindingsSnapshot') {
    throw new Error(
      `InputBindingsSerializer: unknown envelope kind '${String(env.kind)}'.`,
    );
  }
  if (expectedKind !== undefined && env.kind !== expectedKind) {
    throw new Error(
      `InputBindingsSerializer: expected envelope kind '${expectedKind}', got '${env.kind}'.`,
    );
  }
  if (env.data === undefined || env.data === null) {
    throw new Error('InputBindingsSerializer: envelope.data is missing.');
  }
}

/**
 * Parse `json` into a JS value, throwing an error tagged with this
 * module's prefix so the rebinding UI can show a single source name
 * for any error that bubbles up.
 */
function parseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (err) {
    throw new Error(
      `InputBindingsSerializer: input is not valid JSON (${(err as Error).message}).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Deserialise — strict (throwing)
// ---------------------------------------------------------------------------

/**
 * Parse a {@link SerializedPlayerBindings} envelope and return the
 * validated {@link PlayerBindings}.
 *
 * `expectedSlot`, when supplied, additionally enforces that the
 * payload's `playerIndex` matches the slot the caller wanted to load
 * into. The rebinding UI passes this so an export of P3 cannot
 * silently overwrite P1's bindings on import.
 */
export function deserializePlayerBindings(
  json: string,
  expectedSlot?: PlayerBindingsIndex,
): PlayerBindings {
  const candidate = parseJson(json);
  assertValidEnvelope(candidate, 'playerBindings');
  // assertValidPlayerBindings throws if the body is malformed; the slot
  // check is delegated to that helper so error messages stay consistent
  // across import paths.
  assertValidPlayerBindings(candidate.data, expectedSlot);
  return candidate.data;
}

/**
 * Parse a {@link SerializedBindingsSnapshot} envelope and return the
 * validated four-slot record.
 *
 * Throws if any slot is missing, malformed, or carries a
 * `playerIndex` that disagrees with its key (the same invariant the
 * store enforces on `set`).
 */
export function deserializeBindingsSnapshot(
  json: string,
): Record<PlayerBindingsIndex, PlayerBindings> {
  const candidate = parseJson(json);
  assertValidEnvelope(candidate, 'bindingsSnapshot');
  if (typeof candidate.data !== 'object' || candidate.data === null) {
    throw new Error('InputBindingsSerializer: snapshot data must be an object keyed by slot.');
  }
  const data = candidate.data as Record<string, unknown>;
  const slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
  const result: Partial<Record<PlayerBindingsIndex, PlayerBindings>> = {};
  for (const slot of slots) {
    const key = String(slot);
    const entry = data[key];
    if (entry === undefined) {
      throw new Error(`InputBindingsSerializer: snapshot is missing slot '${key}'.`);
    }
    assertValidPlayerBindings(entry, slot);
    result[slot] = entry;
  }
  // Reject extra slot keys ('0', '5', stringy garbage) so a corrupted
  // file can't smuggle through unverified data.
  for (const key of Object.keys(data)) {
    if (key !== '1' && key !== '2' && key !== '3' && key !== '4') {
      throw new Error(
        `InputBindingsSerializer: snapshot contains unexpected slot key '${key}'.`,
      );
    }
  }
  return result as Record<PlayerBindingsIndex, PlayerBindings>;
}

// ---------------------------------------------------------------------------
// Deserialise — safe (Result-style)
// ---------------------------------------------------------------------------

/**
 * Non-throwing variant of {@link deserializePlayerBindings}. Used by the
 * replay loader and the settings boot path where a malformed blob
 * should fall back to defaults rather than crash the boot sequence.
 */
export function safeDeserializePlayerBindings(
  json: string,
  expectedSlot?: PlayerBindingsIndex,
): DeserializeResult<PlayerBindings> {
  try {
    return { ok: true, value: deserializePlayerBindings(json, expectedSlot) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Non-throwing variant of {@link deserializeBindingsSnapshot}. Settings
 * boot calls this and falls back to {@link DEFAULT_PLAYER_BINDINGS} on
 * `ok: false` so a single corrupted save never blocks the player from
 * reaching the menu.
 */
export function safeDeserializeBindingsSnapshot(
  json: string,
): DeserializeResult<Record<PlayerBindingsIndex, PlayerBindings>> {
  try {
    return { ok: true, value: deserializeBindingsSnapshot(json) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Convenience: snapshot from store, round-trip through string
// ---------------------------------------------------------------------------

/**
 * Detect the envelope kind of a JSON string without fully validating
 * the body. Useful when a loader receives an arbitrary file (drag /
 * drop, paste) and needs to pick which deserialiser to call.
 *
 * Returns `null` for any input that isn't a recognisable envelope —
 * the caller decides whether to surface that as an error or silently
 * ignore the file.
 */
export function detectSerializedKind(json: string): SerializedBindingsKind | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof candidate !== 'object' || candidate === null) return null;
  const env = candidate as { schemaVersion?: unknown; kind?: unknown };
  if (env.schemaVersion !== BINDINGS_SCHEMA_VERSION) return null;
  if (env.kind === 'playerBindings' || env.kind === 'bindingsSnapshot') return env.kind;
  return null;
}

/**
 * Re-export so callers that only import this module can still hand a
 * candidate to the canonical structural validator without grabbing the
 * store.
 */
export { assertValidPlayerBindings };
