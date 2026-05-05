/**
 * Character builder storage — post-M2 visual editor scaffolding (M7).
 *
 * localStorage CRUD layer for {@link CharacterDataSpec}. Mirrors the
 * pattern of `src/builder/customStageStorage.ts` so the visual
 * editor (forthcoming) and the data-file pipeline share one
 * persistence shape:
 *
 *   • `saveCharacter(slotId, spec)` — write under
 *     `platformfighter:characters:v1:<slotId>` with a metadata
 *     wrapper carrying `savedAt` so a migration path can sort by
 *     recency.
 *   • `loadCharacter(slotId)` — read + parse + validate via
 *     `parseCharacterDataFile`. Returns `null` on missing / corrupt
 *     records (the caller is responsible for showing an error UI).
 *   • `listCharacters()` — every saved slot id, latest-first.
 *   • `deleteCharacter(slotId)` — remove the slot.
 *
 * # Why localStorage (not IndexedDB)
 *
 * Same rationale as the stage builder: characters are small JSON
 * blobs (typically < 4 KB each) so the 5 MB localStorage budget is
 * ample. The synchronous API matches the editor's "save / undo"
 * UX better than IndexedDB's async open. A future export-to-file
 * flow can write the same JSON shape to a download.
 *
 * # Determinism
 *
 * The storage layer itself is non-deterministic (depends on user
 * timestamp), but the parsed {@link CharacterDataSpec} is a frozen
 * record — once loaded into the runtime, the data is replay-safe.
 * The runtime uses authored character data only at scene boot, not
 * during the deterministic physics tick.
 */

import {
  type CharacterDataSpec,
  parseCharacterDataFile,
  serializeCharacterDataSpec,
} from '../characters/characterSerializer';

/** Top-level localStorage namespace shared by all builder tools. */
export const STORAGE_APP_NAMESPACE = 'platformfighter';
/** Per-domain segment for character builder records. */
export const STORAGE_CHARACTERS_DOMAIN = 'characters';
/** Schema version segment — bump on a breaking shape change. */
export const STORAGE_CHARACTERS_VERSION_SEGMENT = 'v1';

const PREFIX = `${STORAGE_APP_NAMESPACE}:${STORAGE_CHARACTERS_DOMAIN}:${STORAGE_CHARACTERS_VERSION_SEGMENT}`;

/** Compose the full localStorage key for a given slot id. */
export function characterStorageKey(slotId: string): string {
  return `${PREFIX}:${slotId}`;
}

/** Compose the index-of-slots key. */
export function indexStorageKey(): string {
  return `${PREFIX}:_index`;
}

/**
 * Saved-record wrapper — a thin envelope around the spec so we can
 * carry per-slot metadata (timestamps, schema version) without
 * polluting the spec itself.
 */
export interface CharacterRecord {
  readonly schemaVersion: 1;
  readonly slotId: string;
  readonly savedAtMs: number;
  readonly spec: CharacterDataSpec;
}

/** Minimal localStorage interface — lets tests inject a fake. */
export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultBackend(): StorageBackend | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageBackend }).localStorage;
  return ls ?? null;
}

function readIndex(backend: StorageBackend): string[] {
  const raw = backend.getItem(indexStorageKey());
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    return [];
  }
}

function writeIndex(backend: StorageBackend, ids: ReadonlyArray<string>): void {
  backend.setItem(indexStorageKey(), JSON.stringify([...ids]));
}

/**
 * Save a character spec under `slotId`. Overwrites any existing
 * record at that slot. Returns the persisted {@link CharacterRecord}
 * so the caller can show "saved at HH:MM" feedback.
 *
 * `nowMs` is injectable for deterministic tests; production code
 * passes `Date.now()`.
 */
export function saveCharacter(
  slotId: string,
  spec: CharacterDataSpec,
  nowMs: number = Date.now(),
  backend: StorageBackend | null = defaultBackend(),
): CharacterRecord {
  if (backend === null) {
    throw new Error('saveCharacter: no localStorage backend available');
  }
  if (typeof slotId !== 'string' || slotId.length === 0) {
    throw new Error('saveCharacter: slotId must be a non-empty string');
  }
  const record: CharacterRecord = {
    schemaVersion: 1,
    slotId,
    savedAtMs: nowMs,
    spec,
  };
  backend.setItem(
    characterStorageKey(slotId),
    JSON.stringify({
      ...record,
      spec: serializeCharacterDataSpec(spec),
    }),
  );
  const ids = readIndex(backend);
  if (!ids.includes(slotId)) {
    ids.unshift(slotId);
    writeIndex(backend, ids);
  }
  return record;
}

/**
 * Load a character spec by slot id. Returns `null` if the slot is
 * empty OR if the record is corrupt (parse / validation error). On
 * a corrupt record the slot is NOT auto-deleted — the caller can
 * surface an error UI and offer manual recovery.
 */
export function loadCharacter(
  slotId: string,
  backend: StorageBackend | null = defaultBackend(),
): CharacterRecord | null {
  if (backend === null) return null;
  const raw = backend.getItem(characterStorageKey(slotId));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const r = parsed as Record<string, unknown>;
  if (r.schemaVersion !== 1) return null;
  if (typeof r.slotId !== 'string') return null;
  if (typeof r.savedAtMs !== 'number') return null;
  let spec: CharacterDataSpec;
  try {
    spec = parseCharacterDataFile(r.spec, `slot '${slotId}'`);
  } catch {
    return null;
  }
  return {
    schemaVersion: 1,
    slotId,
    savedAtMs: r.savedAtMs,
    spec,
  };
}

/** List every saved slot id, in most-recently-saved-first order. */
export function listCharacters(
  backend: StorageBackend | null = defaultBackend(),
): ReadonlyArray<string> {
  if (backend === null) return [];
  return Object.freeze(readIndex(backend));
}

/** Delete a saved slot. No-op if the slot doesn't exist. */
export function deleteCharacter(
  slotId: string,
  backend: StorageBackend | null = defaultBackend(),
): void {
  if (backend === null) return;
  backend.removeItem(characterStorageKey(slotId));
  const ids = readIndex(backend).filter((id) => id !== slotId);
  writeIndex(backend, ids);
}
