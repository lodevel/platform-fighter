/**
 * `localStorage` persistence layer for custom stages saved through the
 * M3 stage builder.
 *
 * AC 20104 Sub-AC 3 — "Implement save/load serialization of custom
 * stages to/from localStorage with named slots".
 *
 * Why a dedicated module
 * ----------------------
 *
 *   • **Namespace strategy** — `localStorage` is a flat key/value bag.
 *     Custom stages share the bag with input bindings (Sub-AC of M5),
 *     audio mixer levels, and replay shortlists. Every key this module
 *     writes lives under `platformfighter.customStages.v1.…` so a
 *     "Clear save data" sweep can wipe just the custom-stage namespace
 *     without touching unrelated origin state.
 *
 *   • **Versioned schema** — The on-disk envelope already declares
 *     `schemaVersion`; the storage key bakes the version into its
 *     namespace too, so a future breaking change can land on a new key
 *     space and the old data becomes inert (still parsable in
 *     DevTools, still sweepable by "Clear save data") without an
 *     explicit migration step.
 *
 *   • **Index + per-slot keys** — Each named slot gets its own
 *     `…stage.<id>` key; a single `…index` key holds the ordered roster
 *     of slot ids + their human names. Two-key design lets the load
 *     dialog populate the slot selector by reading one key (the index)
 *     instead of N (the per-slot blobs).
 *
 *   • **Error handling** — A real browser can return `null` (key
 *     absent), throw on `setItem` (quota exceeded, private mode), or
 *     hand back a string that fails JSON parse (user-edited from
 *     DevTools). Every load path here converts those into a
 *     {@link DetailedStorageResult} so the UI can fall back gracefully
 *     without catching exceptions.
 *
 *   • **Storage abstraction** — Tests run under Node (vitest); Node has
 *     no `localStorage`. The module accepts an injectable
 *     {@link StorageLike} so tests pass an in-memory `Map` wrapper and
 *     a future migration to IndexedDB changes one DI seam, not every
 *     call site.
 *
 * Determinism
 * -----------
 *
 *   • The module is a pure data transform on top of
 *     {@link customStageSerializer}. It never reads `Date.now()` /
 *     `Math.random()` / any wall-clock source, so two saves of the
 *     same in-memory stage produce byte-identical blobs.
 *   • The storage layer never participates in the gameplay path —
 *     replays embed their own immutable snapshot of the stage they
 *     were recorded on (the M2 stage table, or the custom stage at
 *     record time), so an edit / delete between recording and playback
 *     can never desync a replay.
 *
 * Strict TypeScript
 * -----------------
 *
 * The codebase compiles under `strict + noUncheckedIndexedAccess`. The
 * {@link StorageLike} interface narrows to the three calls this module
 * actually uses (`getItem`, `setItem`, `removeItem`); the
 * {@link DetailedStorageResult} type forces every consumer to handle
 * the `ok: false` branch on the load path, so a corrupted blob can
 * never silently propagate through the boot sequence.
 */

import {
  CUSTOM_STAGE_SCHEMA_VERSION,
  buildCustomStageData,
  customStageSlotIdFromName,
  detectSerializedKind,
  serializeCustomStage,
  serializeCustomStageIndex,
  safeDeserializeCustomStage,
  safeDeserializeCustomStageIndex,
  assertValidCustomStageName,
  type CustomStageData,
  type CustomStageIndexData,
  type CustomStageIndexEntry,
  type SerializedStagePiece,
} from './customStageSerializer';
import { type GridSpec } from './builderGrid';
import type { PlacedPiece } from './dragDrop';
import type { RegisteredPiece } from './stageDataModel';

// ---------------------------------------------------------------------------
// Namespace strategy
// ---------------------------------------------------------------------------

/**
 * Top-level vendor / app namespace. Same value used by
 * `BindingsStorage`, deliberately — every key written by this codebase
 * lives under one prefix so a "Clear save data" sweep can match
 * `platformfighter.*` without touching third-party storage.
 */
export const STORAGE_APP_NAMESPACE = 'platformfighter';

/**
 * Per-domain namespace under {@link STORAGE_APP_NAMESPACE}. Custom
 * stages get their own segment so the same key word ("index", "stage")
 * can have different meanings in different domains.
 */
export const STORAGE_CUSTOM_STAGES_DOMAIN = 'customStages';

/**
 * Storage-key version segment. Bumped in lockstep with
 * {@link CUSTOM_STAGE_SCHEMA_VERSION} so a breaking change to the
 * envelope content lands on a new key — old data becomes inert (still
 * parsable in DevTools, still sweepable by "Clear save data") but is
 * never returned by a load.
 */
export const STORAGE_CUSTOM_STAGES_VERSION_SEGMENT =
  `v${CUSTOM_STAGE_SCHEMA_VERSION}` as const;

/** Key segment for the slot index. */
const INDEX_KEY_SEGMENT = 'index';

/** Key segment prefix for per-slot blobs (e.g. `stage.lava-tower`). */
const STAGE_KEY_SEGMENT = 'stage';

/**
 * Key separator. `.` (dot) is conventional for hierarchical
 * `localStorage` keys and avoids the `:` character some legacy libs
 * reserve for special meaning. The serializer's JSON output never
 * contains the separator at the top level of a key, so there is no
 * ambiguity when parsing or filtering.
 */
const KEY_SEPARATOR = '.';

/**
 * Build the full namespaced key for the slot index blob.
 *
 *     platformfighter.customStages.v1.index
 *
 * Exported so tests + future "Clear save data" sweeps can predict the
 * keys this module owns without re-implementing the namespace policy.
 */
export function indexStorageKey(): string {
  return [
    STORAGE_APP_NAMESPACE,
    STORAGE_CUSTOM_STAGES_DOMAIN,
    STORAGE_CUSTOM_STAGES_VERSION_SEGMENT,
    INDEX_KEY_SEGMENT,
  ].join(KEY_SEPARATOR);
}

/**
 * Build the full namespaced key for a single slot's blob.
 *
 *     platformfighter.customStages.v1.stage.lava-tower
 */
export function stageStorageKey(slotId: string): string {
  return [
    STORAGE_APP_NAMESPACE,
    STORAGE_CUSTOM_STAGES_DOMAIN,
    STORAGE_CUSTOM_STAGES_VERSION_SEGMENT,
    STAGE_KEY_SEGMENT,
    slotId,
  ].join(KEY_SEPARATOR);
}

// ---------------------------------------------------------------------------
// Storage abstraction
// ---------------------------------------------------------------------------

/**
 * Minimal subset of the DOM `Storage` interface this module needs.
 *
 * Browser `localStorage` already satisfies the shape; tests inject an
 * in-memory implementation to avoid depending on a real DOM in vitest.
 *
 * Methods may throw — `setItem` in particular throws under quota
 * exhaustion or private-browsing mode in some Safari versions. The
 * module's callers handle those throws via the {@link DetailedStorageResult}
 * return shape rather than letting them propagate.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Reason codes for {@link DetailedStorageResult.code}. Callers branch
 * on the kind of failure (e.g. "fall back silently on missing", "show
 * a toast on corrupted") without regex-matching error strings.
 *
 *   • `unavailable`     — no `localStorage` in this environment.
 *   • `missing`         — key absent (first run, or after a slot delete).
 *   • `corrupted`       — key present but failed JSON / schema validation.
 *   • `write-failed`    — `setItem` threw (quota, private mode).
 *   • `name-collision`  — saving with a name whose slot id already exists
 *                         and `overwrite: false` was passed.
 *   • `invalid-name`    — provided slot name failed validation.
 *   • `slot-not-found`  — load / delete targeted a slot the index
 *                         doesn't list (or the index itself is missing).
 */
export type CustomStageStorageErrorCode =
  | 'unavailable'
  | 'missing'
  | 'corrupted'
  | 'write-failed'
  | 'name-collision'
  | 'invalid-name'
  | 'slot-not-found';

/**
 * Discriminated `Result`. The `false` branch carries a typed `code` so
 * a UI can branch on causes; `error` is human-readable for surfacing in
 * a debug panel or `console.warn`.
 */
export type DetailedStorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: CustomStageStorageErrorCode;
      readonly error: string;
    };

// ---------------------------------------------------------------------------
// Storage resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the {@link StorageLike} the module should use.
 *
 *   • An explicit argument always wins — tests + DI consumers pass
 *     their own.
 *   • Otherwise we fall back to `globalThis.localStorage` if it exists.
 *     Wrapped in `try` because some browsers throw on the *access* when
 *     storage is disabled (Safari private mode, third-party iframe with
 *     "block all cookies").
 *   • `null` means "no storage available" — every load path converts
 *     this to an `unavailable` error result; every save path becomes a
 *     no-op so the boot sequence never crashes on a sandboxed iframe.
 */
function resolveStorage(explicit?: StorageLike | null): StorageLike | null {
  if (explicit === null) return null;
  if (explicit !== undefined) return explicit;
  try {
    const candidate = (globalThis as { localStorage?: unknown }).localStorage;
    if (
      candidate !== undefined &&
      candidate !== null &&
      typeof (candidate as StorageLike).getItem === 'function' &&
      typeof (candidate as StorageLike).setItem === 'function' &&
      typeof (candidate as StorageLike).removeItem === 'function'
    ) {
      return candidate as StorageLike;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Index — load / save (internal helpers)
// ---------------------------------------------------------------------------

/** Load the slot index, or `null` if missing / unavailable / corrupted. */
function readIndexSafe(target: StorageLike): CustomStageIndexData | null {
  let raw: string | null;
  try {
    raw = target.getItem(indexStorageKey());
  } catch {
    return null;
  }
  if (raw === null) return null;
  const detected = detectSerializedKind(raw);
  if (detected !== null && detected !== 'customStageIndex') return null;
  const parsed = safeDeserializeCustomStageIndex(raw);
  return parsed.ok ? parsed.value : null;
}

/** Load the slot index, returning an empty index if anything goes wrong. */
function readIndexOrEmpty(target: StorageLike): CustomStageIndexData {
  return readIndexSafe(target) ?? { slots: [] };
}

/**
 * Persist a new slot index. Returns `false` on `setItem` throw so the
 * caller can roll back any prior write that depends on the index being
 * up-to-date.
 */
function writeIndex(
  target: StorageLike,
  index: CustomStageIndexData,
): { ok: true } | { ok: false; error: string } {
  let json: string;
  try {
    json = serializeCustomStageIndex(index);
  } catch (err) {
    return {
      ok: false,
      error: `customStageStorage: refused to write malformed index — ${(err as Error).message}`,
    };
  }
  try {
    target.setItem(indexStorageKey(), json);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `customStageStorage: setItem threw while writing index — ${(err as Error).message}`,
    };
  }
}

/**
 * Insert / promote `entry` into `slots`. The most-recently-saved slot
 * sits at the head of the array so the load dialog can render saves in
 * "newest first" order without sorting metadata. If a slot with the
 * same id already exists it is moved to the head and its display name
 * is updated to the supplied value.
 */
function upsertIndexEntry(
  slots: ReadonlyArray<CustomStageIndexEntry>,
  entry: CustomStageIndexEntry,
): CustomStageIndexEntry[] {
  const next: CustomStageIndexEntry[] = [entry];
  for (const existing of slots) {
    if (existing.id === entry.id) continue;
    next.push(existing);
  }
  return next;
}

/** Remove the entry with the given id from `slots`. */
function removeIndexEntry(
  slots: ReadonlyArray<CustomStageIndexEntry>,
  id: string,
): CustomStageIndexEntry[] {
  const next: CustomStageIndexEntry[] = [];
  for (const entry of slots) {
    if (entry.id !== id) next.push(entry);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Options for {@link saveCustomStage}.
 *
 *   • `overwrite` — when `true`, an existing slot with the same id is
 *     overwritten in place. When `false` (the default), an existing
 *     slot surfaces as a `name-collision` error so the UI can prompt
 *     the player for a different name.
 *   • `storage` — injected {@link StorageLike}; defaults to
 *     `globalThis.localStorage`.
 */
export interface SaveCustomStageOptions {
  readonly overwrite?: boolean;
  readonly storage?: StorageLike | null;
}

/**
 * Persist a custom stage to storage.
 *
 * The save runs in three steps:
 *
 *   1. Validate the inputs (name, grid spec, pieces). A failed
 *      validation surfaces as `invalid-name` / `corrupted` *before* any
 *      storage write — a malformed payload never reaches disk.
 *   2. Read the current index and check for name collisions. With
 *      `overwrite: false` (default), a duplicate id surfaces as
 *      `name-collision` and nothing is written.
 *   3. Write the per-slot blob first, then the index. The order matters
 *      under crashes: an index that lists a slot whose blob never
 *      landed produces a `corrupted` error on load (which the load
 *      path handles); the reverse — a blob with no index entry — is
 *      effectively orphaned but harmless (the load dialog won't list
 *      it). Writing blob → index minimises the orphan window.
 *
 * Returns the index entry that was written so the caller can update
 * its in-memory roster without re-reading the index.
 */
export function saveCustomStage(
  name: string,
  gridSpec: GridSpec,
  pieces: ReadonlyArray<RegisteredPiece | PlacedPiece>,
  opts: SaveCustomStageOptions = {},
): DetailedStorageResult<CustomStageIndexEntry> {
  // Step 1: name validation. The grid + pieces are validated by
  // `serializeCustomStage` below — they share an error code so we
  // don't need to pre-validate them here.
  try {
    assertValidCustomStageName(name);
  } catch (err) {
    return {
      ok: false,
      code: 'invalid-name',
      error: (err as Error).message,
    };
  }
  const id = customStageSlotIdFromName(name);
  if (id.length === 0) {
    // Defensive: the validator should reject names that derive to an
    // empty id, but the fallback inside `customStageSlotIdFromName`
    // returns 'stage' rather than '' so this branch should be
    // unreachable. Keep the guard so a future change to the helper
    // can't silently produce an empty key.
    return {
      ok: false,
      code: 'invalid-name',
      error: 'customStageStorage: derived slot id is empty.',
    };
  }
  const target = resolveStorage(opts.storage);
  if (target === null) {
    return {
      ok: false,
      code: 'unavailable',
      error: 'customStageStorage: no localStorage-compatible storage available; stage not saved.',
    };
  }
  const data = buildCustomStageData(name.trim(), gridSpec, pieces);
  let json: string;
  try {
    json = serializeCustomStage(data);
  } catch (err) {
    return {
      ok: false,
      code: 'corrupted',
      error: `customStageStorage: refused to save malformed stage — ${(err as Error).message}`,
    };
  }
  // Step 2: collision check.
  const overwrite = opts.overwrite === true;
  const currentIndex = readIndexOrEmpty(target);
  const existingEntry = currentIndex.slots.find((s) => s.id === id) ?? null;
  if (existingEntry && !overwrite) {
    return {
      ok: false,
      code: 'name-collision',
      error: `customStageStorage: a slot named '${existingEntry.name}' already exists; pass { overwrite: true } to replace it.`,
    };
  }
  // Step 3a: per-slot blob first.
  try {
    target.setItem(stageStorageKey(id), json);
  } catch (err) {
    return {
      ok: false,
      code: 'write-failed',
      error: `customStageStorage: setItem threw while saving slot '${id}' — ${(err as Error).message}`,
    };
  }
  // Step 3b: update + write the index. If the index write fails we
  // try to roll back the per-slot blob so the storage doesn't end up
  // with an orphaned stage the player can't see in the load dialog.
  const entry: CustomStageIndexEntry = { id, name: name.trim() };
  const nextIndex: CustomStageIndexData = {
    slots: upsertIndexEntry(currentIndex.slots, entry),
  };
  const writeResult = writeIndex(target, nextIndex);
  if (!writeResult.ok) {
    // Best-effort rollback of the per-slot blob. `removeItem` may also
    // throw under the same conditions that broke `setItem`; we ignore
    // that throw — the original write-failed error is more meaningful
    // than the rollback-also-failed one.
    if (!existingEntry) {
      try {
        target.removeItem(stageStorageKey(id));
      } catch {
        /* swallow — see comment above */
      }
    }
    return {
      ok: false,
      code: 'write-failed',
      error: writeResult.error,
    };
  }
  return { ok: true, value: entry };
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load a slot by id and return the validated stage body. Errors:
 *
 *   • `unavailable`    — no storage in this environment.
 *   • `slot-not-found` — the index does not list this id (or the index
 *                        itself is missing).
 *   • `missing`        — the index lists the id but the per-slot blob
 *                        is absent. This is the "orphaned index entry"
 *                        case from a crashed save; callers may call
 *                        {@link deleteCustomStage} to evict it.
 *   • `corrupted`      — the per-slot blob exists but failed validation.
 */
export function loadCustomStage(
  id: string,
  storage?: StorageLike | null,
): DetailedStorageResult<CustomStageData> {
  const target = resolveStorage(storage);
  if (target === null) {
    return {
      ok: false,
      code: 'unavailable',
      error: 'customStageStorage: no localStorage-compatible storage available; cannot load stage.',
    };
  }
  if (typeof id !== 'string' || id.length === 0) {
    return {
      ok: false,
      code: 'slot-not-found',
      error: 'customStageStorage: load called with an empty / non-string slot id.',
    };
  }
  // Confirm the slot is in the index — if it isn't we surface
  // `slot-not-found` rather than reading a stray key the player can't
  // see in the load dialog. Defends against a tab-switch race that
  // tries to load a slot another tab just deleted.
  const index = readIndexSafe(target);
  if (index === null) {
    return {
      ok: false,
      code: 'slot-not-found',
      error: `customStageStorage: index is missing or unreadable; slot '${id}' cannot be loaded.`,
    };
  }
  const indexed = index.slots.find((s) => s.id === id);
  if (!indexed) {
    return {
      ok: false,
      code: 'slot-not-found',
      error: `customStageStorage: index does not list slot '${id}'.`,
    };
  }
  let raw: string | null;
  try {
    raw = target.getItem(stageStorageKey(id));
  } catch (err) {
    return {
      ok: false,
      code: 'corrupted',
      error: `customStageStorage: getItem threw while loading slot '${id}' — ${(err as Error).message}`,
    };
  }
  if (raw === null) {
    return {
      ok: false,
      code: 'missing',
      error: `customStageStorage: index lists slot '${id}' but no blob was found.`,
    };
  }
  const detected = detectSerializedKind(raw);
  if (detected !== null && detected !== 'customStage') {
    return {
      ok: false,
      code: 'corrupted',
      error: `customStageStorage: slot '${id}' key holds a '${detected}' envelope, not 'customStage'.`,
    };
  }
  const parsed = safeDeserializeCustomStage(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      code: 'corrupted',
      error: parsed.error,
    };
  }
  return { ok: true, value: parsed.value };
}

/**
 * Convenience wrapper that resolves a slot id from a player-typed name
 * before loading. Useful for "Load by name" UX paths.
 */
export function loadCustomStageByName(
  name: string,
  storage?: StorageLike | null,
): DetailedStorageResult<CustomStageData> {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return {
      ok: false,
      code: 'invalid-name',
      error: 'customStageStorage: name must be a non-empty string.',
    };
  }
  return loadCustomStage(customStageSlotIdFromName(name), storage);
}

// ---------------------------------------------------------------------------
// Enumerate
// ---------------------------------------------------------------------------

/**
 * List every saved slot in last-saved-first order. Returns an empty
 * array on missing / corrupted index — the load dialog can render
 * "no saves yet" without distinguishing between the two cases.
 *
 * Use {@link inspectCustomStageIndex} when you need the typed error
 * code instead.
 */
export function listCustomStages(
  storage?: StorageLike | null,
): ReadonlyArray<CustomStageIndexEntry> {
  const target = resolveStorage(storage);
  if (target === null) return [];
  const index = readIndexSafe(target);
  return index === null ? [] : index.slots;
}

/**
 * Typed-result wrapper around the index read for callers that need to
 * distinguish "no saves yet" from "the index is corrupted". The load
 * dialog uses {@link listCustomStages}; the (future) "Repair save data"
 * affordance uses this.
 */
export function inspectCustomStageIndex(
  storage?: StorageLike | null,
): DetailedStorageResult<CustomStageIndexData> {
  const target = resolveStorage(storage);
  if (target === null) {
    return {
      ok: false,
      code: 'unavailable',
      error: 'customStageStorage: no localStorage-compatible storage available; cannot inspect index.',
    };
  }
  let raw: string | null;
  try {
    raw = target.getItem(indexStorageKey());
  } catch (err) {
    return {
      ok: false,
      code: 'corrupted',
      error: `customStageStorage: getItem threw while loading index — ${(err as Error).message}`,
    };
  }
  if (raw === null) {
    return {
      ok: false,
      code: 'missing',
      error: `customStageStorage: no index stored at key '${indexStorageKey()}'.`,
    };
  }
  const detected = detectSerializedKind(raw);
  if (detected !== null && detected !== 'customStageIndex') {
    return {
      ok: false,
      code: 'corrupted',
      error: `customStageStorage: index key holds a '${detected}' envelope, not 'customStageIndex'.`,
    };
  }
  const parsed = safeDeserializeCustomStageIndex(raw);
  if (!parsed.ok) {
    return { ok: false, code: 'corrupted', error: parsed.error };
  }
  return { ok: true, value: parsed.value };
}

/**
 * `true` iff the index lists a slot under the given id.
 */
export function hasCustomStage(
  id: string,
  storage?: StorageLike | null,
): boolean {
  const target = resolveStorage(storage);
  if (target === null) return false;
  const index = readIndexSafe(target);
  if (index === null) return false;
  return index.slots.some((s) => s.id === id);
}

/**
 * `true` iff a slot derived from `name` is already saved. The save
 * dialog uses this to surface a "this name will overwrite an existing
 * stage" warning *before* the player commits.
 */
export function hasCustomStageByName(
  name: string,
  storage?: StorageLike | null,
): boolean {
  if (typeof name !== 'string' || name.trim().length === 0) return false;
  return hasCustomStage(customStageSlotIdFromName(name), storage);
}

// ---------------------------------------------------------------------------
// Delete + clear
// ---------------------------------------------------------------------------

/**
 * Delete a single slot. Removes the per-slot blob and updates the
 * index. Idempotent — deleting a missing slot returns `slot-not-found`
 * (not an error in the storage sense, but typed so the UI can render
 * "nothing to delete" cleanly).
 */
export function deleteCustomStage(
  id: string,
  storage?: StorageLike | null,
): DetailedStorageResult<void> {
  const target = resolveStorage(storage);
  if (target === null) {
    return {
      ok: false,
      code: 'unavailable',
      error: 'customStageStorage: no localStorage-compatible storage available; cannot delete.',
    };
  }
  if (typeof id !== 'string' || id.length === 0) {
    return {
      ok: false,
      code: 'slot-not-found',
      error: 'customStageStorage: delete called with empty slot id.',
    };
  }
  const currentIndex = readIndexOrEmpty(target);
  const exists = currentIndex.slots.some((s) => s.id === id);
  if (!exists) {
    // Best-effort: also try to remove a stray per-slot blob in case
    // the index lost the entry but the blob remained orphaned.
    try {
      target.removeItem(stageStorageKey(id));
    } catch {
      /* ignore — slot wasn't indexed anyway */
    }
    return {
      ok: false,
      code: 'slot-not-found',
      error: `customStageStorage: index does not list slot '${id}'.`,
    };
  }
  // Remove the per-slot blob first; if that throws we leave the index
  // intact so the load dialog still shows the slot. Surfacing as
  // `write-failed` lets the UI prompt the player to retry.
  try {
    target.removeItem(stageStorageKey(id));
  } catch (err) {
    return {
      ok: false,
      code: 'write-failed',
      error: `customStageStorage: removeItem threw while deleting slot '${id}' — ${(err as Error).message}`,
    };
  }
  const nextIndex: CustomStageIndexData = {
    slots: removeIndexEntry(currentIndex.slots, id),
  };
  const writeResult = writeIndex(target, nextIndex);
  if (!writeResult.ok) {
    return {
      ok: false,
      code: 'write-failed',
      error: writeResult.error,
    };
  }
  return { ok: true, value: undefined };
}

/**
 * Wipe every custom-stage key under the current schema version. Used
 * by:
 *
 *   • The settings UI's "Clear save data" sweep.
 *   • The corrupted-blob recovery path: a load that returns
 *     `code: 'corrupted'` for the index *may* call this (or a more
 *     surgical {@link deleteCustomStage}) to evict the bad data so the
 *     next session loads cleanly.
 *
 * Best-effort — a throw on one key does not abort the sweep, but the
 * first error is reported in the result so callers don't have to
 * inspect storage to know whether data remains.
 */
export function clearAllCustomStages(
  storage?: StorageLike | null,
): DetailedStorageResult<void> {
  const target = resolveStorage(storage);
  if (target === null) {
    return {
      ok: false,
      code: 'unavailable',
      error: 'customStageStorage: no localStorage-compatible storage available; nothing to clear.',
    };
  }
  // Read the index *first* so we know which per-slot keys to evict.
  // Falling back to an empty index is safe — there is nothing more to
  // clear if the index is unreadable, and the index key itself is
  // included in the per-key sweep below.
  const index = readIndexOrEmpty(target);
  let firstError: string | null = null;
  const tryRemove = (key: string): void => {
    try {
      target.removeItem(key);
    } catch (err) {
      if (firstError === null) {
        firstError = `customStageStorage: removeItem threw for key '${key}' — ${(err as Error).message}`;
      }
    }
  };
  for (const slot of index.slots) {
    tryRemove(stageStorageKey(slot.id));
  }
  tryRemove(indexStorageKey());
  if (firstError !== null) {
    return { ok: false, code: 'write-failed', error: firstError };
  }
  return { ok: true, value: undefined };
}

// ---------------------------------------------------------------------------
// Round-trip helpers
// ---------------------------------------------------------------------------

/**
 * Project a {@link CustomStageData} body's pieces into the
 * {@link PlacedPiece} shape the {@link StageDataModel} expects when
 * importing a saved stage. The grid `(col, row)` coordinates round-trip
 * verbatim because the saved canvas spec is also restored on load.
 */
export function toPlacedPieces(
  data: CustomStageData,
): ReadonlyArray<PlacedPiece> {
  const out: PlacedPiece[] = [];
  for (const piece of data.pieces) {
    out.push(toPlacedPiece(piece));
  }
  return out;
}

/** Project one {@link SerializedStagePiece} into {@link PlacedPiece}. */
export function toPlacedPiece(piece: SerializedStagePiece): PlacedPiece {
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
