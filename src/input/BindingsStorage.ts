/**
 * Bindings localStorage persistence layer — AC 40002 Sub-AC 2.
 *
 * Purpose
 * -------
 *
 * Sub-AC 1 nailed down the canonical {@link PlayerBindings} schema; the
 * companion {@link InputBindingsStore} (this same sub-AC) holds the
 * in-memory four-slot table; Sub-AC 4's
 * {@link InputBindingsSerializer} exports a versioned JSON envelope.
 *
 * What was missing — and what this module supplies — is the **IO
 * boundary** between the in-memory store and the browser's
 * `localStorage`: a small, dependency-light persistence layer that the
 * settings boot path, the rebinding UI's "Apply" button, and the
 * lobby's "Reset to defaults" workflow all share.
 *
 * Why a dedicated module (not "just call `localStorage.setItem`")
 * --------------------------------------------------------------
 *
 *   • **Namespace strategy** — The browser exposes a single global
 *     key/value bag. Anything else the game eventually persists (custom
 *     stages, audio mixer levels, replay shortlist) lives in the same
 *     bag. We need every key this codebase writes to share a stable
 *     prefix so a future "Clear save data" button can wipe everything
 *     under `platformfighter.*` without nuking unrelated origin state
 *     and so we can spot collisions in DevTools.
 *
 *   • **Versioned schema** — The on-disk envelope already declares
 *     `schemaVersion` (Sub-AC 4). This module additionally bakes the
 *     version into the *key*, so a future breaking change can land on
 *     a brand-new key without an explicit migration step — the old
 *     blob just becomes inert until a "Clear save data" pass collects
 *     it. Belt + braces: one version field that gates *content* (the
 *     envelope), one version segment that gates *namespace* (the key).
 *
 *   • **Error handling for corrupted / missing data** — A real browser
 *     can return `null` (key absent), throw on `setItem` (quota
 *     exceeded, private mode), or hand back a string that is invalid
 *     JSON (user edited it from DevTools, or two browser tabs raced to
 *     write it). Every load path here converts those failure modes
 *     into a `Result`-style return so the boot sequence can fall back
 *     to {@link DEFAULT_PLAYER_BINDINGS} without catching exceptions
 *     all over the place.
 *
 *   • **Storage abstraction** — Tests run under Node (vitest); Node's
 *     stdlib has no `localStorage`. The module accepts an injectable
 *     {@link StorageLike} so tests can pass a plain in-memory `Map`
 *     wrapper without monkey-patching globals, and so a future
 *     "settings live in IndexedDB" migration changes only one
 *     dependency injection rather than every call site.
 *
 * Determinism
 * -----------
 *
 *   • The module is a pure data transform on top of
 *     {@link InputBindingsSerializer}. It never reads `Date.now()`,
 *     `Math.random()`, or any wall-clock source. Two saves of an
 *     identical {@link InputBindingsStore} produce byte-identical
 *     blobs because the serializer's canonicalisation pins key order.
 *
 *   • The module never participates in the gameplay path — replays
 *     embed the full binding table inside their own envelope (Sub-AC
 *     4's `bindingsSnapshot`), so a settings reset between recording
 *     and playback can never desync a replay.
 *
 * Strict TypeScript
 * -----------------
 *
 * The codebase compiles under `strict + noUncheckedIndexedAccess`. The
 * {@link StorageLike} interface narrows to the three calls this module
 * actually uses (`getItem`, `setItem`, `removeItem`); the {@link Result}
 * type forces every consumer to handle the `ok: false` branch on the
 * load path, so a corrupted blob can never silently propagate through
 * the boot sequence.
 */

import {
  BINDINGS_SCHEMA_VERSION,
  detectSerializedKind,
  serializeBindingsSnapshot,
  serializePlayerBindings,
} from './InputBindingsSerializer';
import {
  migrationAwareDeserializeBindingsSnapshot,
  migrationAwareDeserializePlayerBindings,
  type BindingsVersionUnsupportedKind,
} from './BindingsMigrations';
import { DEFAULT_PLAYER_BINDINGS } from './InputBindingsStore';
import type {
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';

// ---------------------------------------------------------------------------
// Namespace strategy
// ---------------------------------------------------------------------------

/**
 * Top-level vendor / app namespace. Every key this codebase writes
 * starts with this prefix so a "Clear save data" sweep can match
 * `*` under it without accidentally hitting third-party storage that
 * the page might also use (analytics, dev tools, etc.).
 *
 * Pinned to a string literal (not derived from `package.json`'s name)
 * so a rename of the npm package can't silently invalidate every
 * player's settings file.
 */
export const STORAGE_APP_NAMESPACE = 'platformfighter';

/**
 * Per-domain namespace under {@link STORAGE_APP_NAMESPACE}. Bindings
 * are one of several domains the M5 + later milestones will persist
 * (custom stages, audio levels, replay index); each gets its own
 * sub-namespace so the same key segment can have different meanings in
 * different domains.
 */
export const STORAGE_BINDINGS_DOMAIN = 'bindings';

/**
 * Storage-key version segment. Bumped in lockstep with
 * {@link BINDINGS_SCHEMA_VERSION} so a breaking change to the
 * envelope content lands on a new key — the old data becomes inert
 * (still parsable in DevTools, still sweepable by "Clear save data")
 * but is never returned by `loadBindingsSnapshot`.
 *
 * Encoded as `vN` rather than the bare number so a flat key listing
 * (`localStorage.key(i)` enumeration in DevTools) sorts version
 * boundaries cleanly between domains.
 */
export const STORAGE_BINDINGS_VERSION_SEGMENT = `v${BINDINGS_SCHEMA_VERSION}` as const;

/** Key segment identifying the four-slot snapshot blob. */
const SNAPSHOT_KEY_SEGMENT = 'snapshot';

/** Key segment prefix for per-slot blobs (e.g. `player.1`). */
const PLAYER_KEY_SEGMENT = 'player';

/**
 * Key separator. `.` (dot) is conventional for hierarchical keys in
 * `localStorage` and avoids any clash with the `:` character that
 * some legacy libraries reserve for special meaning. The serializer's
 * JSON output never contains the separator at the top level of a key,
 * so there is no ambiguity when parsing or filtering.
 */
const KEY_SEPARATOR = '.';

/**
 * Build the full namespaced key for the four-slot snapshot blob.
 *
 *     platformfighter.bindings.v1.snapshot
 *
 * Exported so tests and a hypothetical "Clear save data" sweep can
 * predict / iterate the keys this module owns without re-implementing
 * the namespace policy.
 */
export function snapshotStorageKey(): string {
  return [
    STORAGE_APP_NAMESPACE,
    STORAGE_BINDINGS_DOMAIN,
    STORAGE_BINDINGS_VERSION_SEGMENT,
    SNAPSHOT_KEY_SEGMENT,
  ].join(KEY_SEPARATOR);
}

/**
 * Build the full namespaced key for a single slot's blob.
 *
 *     platformfighter.bindings.v1.player.3
 *
 * Per-slot keys exist so the rebinding UI's "Apply just this slot"
 * action does not have to read, mutate, and re-serialise the entire
 * snapshot. The settings boot path still loads the snapshot first;
 * per-slot keys are an optional override layer the rebinding flow
 * uses for incremental writes.
 */
export function playerStorageKey(slot: PlayerBindingsIndex): string {
  return [
    STORAGE_APP_NAMESPACE,
    STORAGE_BINDINGS_DOMAIN,
    STORAGE_BINDINGS_VERSION_SEGMENT,
    PLAYER_KEY_SEGMENT,
    String(slot),
  ].join(KEY_SEPARATOR);
}

/**
 * Frozen list of the *exact* keys this module owns under the current
 * schema version. The "Clear save data" sweep can iterate this list
 * to call {@link StorageLike.removeItem} without touching any
 * unrelated origin state.
 */
export const ALL_BINDINGS_STORAGE_KEYS: readonly string[] = Object.freeze([
  snapshotStorageKey(),
  playerStorageKey(1),
  playerStorageKey(2),
  playerStorageKey(3),
  playerStorageKey(4),
]);

// ---------------------------------------------------------------------------
// Storage abstraction
// ---------------------------------------------------------------------------

/**
 * Minimal subset of the DOM `Storage` interface this module needs.
 *
 * The browser's `localStorage` already satisfies the shape; tests
 * inject an in-memory implementation (see `BindingsStorage.test.ts`)
 * to avoid depending on a real DOM in vitest.
 *
 * Methods may throw — `setItem` in particular throws under quota
 * exhaustion or private-browsing mode in some Safari versions. The
 * module's callers handle those throws via the {@link Result} return
 * shape rather than propagating to the caller.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Result type returned from every load / save call. The discriminator
 * forces consumers to handle the `false` branch — a corrupted blob
 * cannot silently propagate as `undefined`.
 *
 * `error` is a human-readable string suitable for surfacing in a debug
 * panel or for emitting to a `console.warn` during boot. The settings
 * boot path falls back to {@link DEFAULT_PLAYER_BINDINGS} on `ok:
 * false` regardless of the specific message.
 */
export type StorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/** Reason codes for {@link StorageResult.error} so callers can branch on the cause. */
export type StorageErrorCode =
  | 'unavailable' //      No `localStorage` in this environment (Node, sandboxed iframe, …)
  | 'missing' //          Key not present.
  | 'corrupted' //        Key present but the blob failed validation.
  | 'write-failed' //     `setItem` threw (quota, private mode).
  | 'too-old' //          Blob's schemaVersion is below MIN_MIGRATABLE_BINDINGS_VERSION.
  | 'too-new' //          Blob's schemaVersion is above this build's CURRENT_BINDINGS_SCHEMA_VERSION.
  | 'migration-failed'; // A registered migration step threw on this specific payload.

/**
 * `StorageResult` tagged with a {@link StorageErrorCode} so callers
 * that care about the *kind* of failure (e.g. "fall back silently on
 * `missing`, surface a toast on `corrupted`") can branch without
 * regex-matching the error string.
 */
export type DetailedStorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: StorageErrorCode; readonly error: string };

// ---------------------------------------------------------------------------
// Storage resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the {@link StorageLike} the module should use.
 *
 *   • An explicit argument always wins — tests and dependency-injected
 *     consumers (lobby code that holds a long-lived storage reference)
 *     pass their own.
 *   • Otherwise we fall back to `globalThis.localStorage` if it
 *     exists. Inside `try` because some browsers throw on the *access*
 *     when storage is disabled (Safari private mode, third-party
 *     iframe with "block all cookies").
 *   • `null` means "no storage available" — every load path converts
 *     this to an `unavailable` error result; every save path becomes
 *     a no-op so the boot sequence never crashes on a sandboxed iframe.
 */
function resolveStorage(explicit?: StorageLike | null): StorageLike | null {
  // Explicit `null` from the caller is an opt-out — "I know there's no
  // storage in this context, please don't touch the global". The
  // ambient fallback only fires when the parameter is omitted entirely.
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
// Snapshot — load / save
// ---------------------------------------------------------------------------

/**
 * Persist the full four-slot snapshot to storage.
 *
 * Serialises through {@link serializeBindingsSnapshot} so the on-disk
 * blob declares its `schemaVersion` and `kind` — the load path can
 * therefore reject a partial / wrong-shape blob (e.g. someone wrote a
 * single-slot envelope to the snapshot key) before any of it leaks
 * into the in-memory store.
 *
 * Returns a `DetailedStorageResult<void>`:
 *
 *   • `ok: true`             — the blob was written.
 *   • `ok: false, unavailable` — no `localStorage` in this environment;
 *                                the call was a no-op. Boot continues
 *                                with in-memory defaults.
 *   • `ok: false, write-failed` — `setItem` threw (quota / private
 *                                  mode). The caller may surface the
 *                                  message to the player and continue;
 *                                  the in-memory store is unaffected.
 *   • `ok: false, corrupted`  — the supplied snapshot failed structural
 *                               validation; nothing was written. This
 *                               is the "tried to save a malformed
 *                               table" case — surfaces the underlying
 *                               serializer error.
 */
export function saveBindingsSnapshot(
  snapshot: Readonly<Record<PlayerBindingsIndex, PlayerBindings>>,
  storage?: StorageLike | null,
): DetailedStorageResult<void> {
  const target = resolveStorage(storage);
  if (target === null) {
    return {
      ok: false,
      code: 'unavailable',
      error: 'BindingsStorage: no localStorage-compatible storage available; snapshot not saved.',
    };
  }
  let json: string;
  try {
    json = serializeBindingsSnapshot(snapshot);
  } catch (err) {
    return {
      ok: false,
      code: 'corrupted',
      error: `BindingsStorage: refused to save invalid snapshot — ${(err as Error).message}`,
    };
  }
  try {
    target.setItem(snapshotStorageKey(), json);
    return { ok: true, value: undefined };
  } catch (err) {
    return {
      ok: false,
      code: 'write-failed',
      error: `BindingsStorage: setItem threw while saving snapshot — ${(err as Error).message}`,
    };
  }
}

/**
 * Load the full four-slot snapshot from storage.
 *
 * Returns a `DetailedStorageResult`:
 *
 *   • `ok: true`             — `value` is a fully-validated four-slot
 *                              record. Pass it directly to
 *                              `new InputBindingsStore({ overrides })`
 *                              or compare against
 *                              {@link DEFAULT_PLAYER_BINDINGS} for an
 *                              "is anything customised?" UI affordance.
 *   • `ok: false, unavailable` — no storage in this environment.
 *   • `ok: false, missing`     — the key is absent (first-run or after
 *                                a "Clear save data").
 *   • `ok: false, corrupted`   — the blob exists but failed JSON parse
 *                                or schema validation. The caller
 *                                should fall back to defaults and
 *                                *may* clear the corrupted key (see
 *                                {@link clearBindingsStorage}) so a
 *                                future load doesn't keep surfacing
 *                                the same error.
 */
export function loadBindingsSnapshot(
  storage?: StorageLike | null,
): DetailedStorageResult<Record<PlayerBindingsIndex, PlayerBindings>> {
  const target = resolveStorage(storage);
  if (target === null) {
    return {
      ok: false,
      code: 'unavailable',
      error: 'BindingsStorage: no localStorage-compatible storage available; cannot load snapshot.',
    };
  }
  let raw: string | null;
  try {
    raw = target.getItem(snapshotStorageKey());
  } catch (err) {
    return {
      ok: false,
      code: 'corrupted',
      error: `BindingsStorage: getItem threw while loading snapshot — ${(err as Error).message}`,
    };
  }
  if (raw === null) {
    return {
      ok: false,
      code: 'missing',
      error: `BindingsStorage: no snapshot stored at key '${snapshotStorageKey()}'.`,
    };
  }
  // Detect kind first so a single-slot blob accidentally written to the
  // snapshot key (e.g. by a future version with a different namespace
  // policy) is rejected with a clear message rather than passed through
  // to the snapshot deserializer's "missing slot" error. The kind
  // detector pins to the *current* schema version; a v0 blob declaring
  // its kind in the legacy shape is allowed through to the
  // migration-aware deserializer below, where the migration step
  // re-wraps it under the canonical envelope.
  const detectedKind = detectSerializedKind(raw);
  if (detectedKind !== null && detectedKind !== 'bindingsSnapshot') {
    return {
      ok: false,
      code: 'corrupted',
      error: `BindingsStorage: snapshot key holds a '${detectedKind}' envelope, not 'bindingsSnapshot'.`,
    };
  }
  // Run the load through the migration-aware deserializer. The
  // migration framework upgrades any blob in
  // [MIN_MIGRATABLE_BINDINGS_VERSION, CURRENT_BINDINGS_SCHEMA_VERSION]
  // to today's schema before the strict validator runs, so a v0 blob
  // saved by a previous build loads under today's contract. Out-of-
  // window or genuinely-corrupt blobs surface as a typed error code so
  // the boot path can distinguish "user has older save we can't read"
  // (`too-old`) from "the file is junk" (`corrupted` /
  // `migration-failed`).
  const result = migrationAwareDeserializeBindingsSnapshot(raw);
  if (!result.ok) {
    return mapMigrationFailureToStorageResult(result.reason, result.error);
  }
  return { ok: true, value: result.value };
}

/**
 * Convenience wrapper that always returns a usable
 * {@link PlayerBindings} record. On any failure (unavailable, missing,
 * corrupted) it returns the canonical
 * {@link DEFAULT_PLAYER_BINDINGS} table so the boot path can write:
 *
 *     const overrides = loadBindingsSnapshotOrDefaults();
 *     const store = new InputBindingsStore({ overrides });
 *
 * without branching on a Result. The `source` field on the returned
 * value still tells the caller which path was taken so the settings
 * UI can render "Currently using defaults" vs. "Loaded saved
 * bindings" without re-running the load.
 */
export function loadBindingsSnapshotOrDefaults(
  storage?: StorageLike | null,
): {
  readonly bindings: Record<PlayerBindingsIndex, PlayerBindings>;
  readonly source: 'storage' | 'defaults';
  readonly fallbackReason?: StorageErrorCode;
  readonly fallbackError?: string;
} {
  const result = loadBindingsSnapshot(storage);
  if (result.ok) {
    // The migration layer has already upgraded the blob in place
    // before strict validation; from this entry point's perspective a
    // freshly-migrated v0 blob and a native v1 blob are
    // indistinguishable. Callers that need the "we just upgraded your
    // save" affordance use the lower-level
    // {@link migrationAwareDeserializeBindingsSnapshot} which exposes
    // `migratedFrom` directly.
    return { bindings: result.value, source: 'storage' };
  }
  // Defaults are deeply frozen — clone shallow so the caller can pass
  // the result directly to `new InputBindingsStore({ overrides })`
  // without confusing TypeScript's `Readonly<Record<...>>` view.
  const defaults: Record<PlayerBindingsIndex, PlayerBindings> = {
    1: DEFAULT_PLAYER_BINDINGS[1],
    2: DEFAULT_PLAYER_BINDINGS[2],
    3: DEFAULT_PLAYER_BINDINGS[3],
    4: DEFAULT_PLAYER_BINDINGS[4],
  };
  return {
    bindings: defaults,
    source: 'defaults',
    fallbackReason: result.code,
    fallbackError: result.error,
  };
}

// ---------------------------------------------------------------------------
// Per-player slot — load / save
// ---------------------------------------------------------------------------

/**
 * Persist a single slot's bindings to storage.
 *
 * The rebinding UI calls this from "Apply" so a one-slot change does
 * not have to read, mutate, and re-serialise the entire four-slot
 * snapshot. The boot path still prefers
 * {@link loadBindingsSnapshot} as the primary source of truth, with
 * per-slot blobs layered on top.
 *
 * `slot` and `bindings.playerIndex` must agree. Mismatch is treated
 * as a serializer-side `corrupted` error (the underlying validator
 * raises) — a copy-paste bug between two players' rebinding payloads
 * is exactly the silent-corruption case versioned storage exists to
 * catch.
 */
export function savePlayerBindings(
  slot: PlayerBindingsIndex,
  bindings: PlayerBindings,
  storage?: StorageLike | null,
): DetailedStorageResult<void> {
  const target = resolveStorage(storage);
  if (target === null) {
    return {
      ok: false,
      code: 'unavailable',
      error: 'BindingsStorage: no localStorage-compatible storage available; player bindings not saved.',
    };
  }
  let json: string;
  try {
    json = serializePlayerBindings(bindings);
  } catch (err) {
    return {
      ok: false,
      code: 'corrupted',
      error: `BindingsStorage: refused to save invalid player bindings — ${(err as Error).message}`,
    };
  }
  // Cross-check slot vs payload after serialization so the
  // serializer's own slot-mismatch error wins where they overlap.
  if (bindings.playerIndex !== slot) {
    return {
      ok: false,
      code: 'corrupted',
      error: `BindingsStorage: slot ${slot} does not match payload playerIndex ${bindings.playerIndex}.`,
    };
  }
  try {
    target.setItem(playerStorageKey(slot), json);
    return { ok: true, value: undefined };
  } catch (err) {
    return {
      ok: false,
      code: 'write-failed',
      error: `BindingsStorage: setItem threw while saving slot ${slot} — ${(err as Error).message}`,
    };
  }
}

/**
 * Load a single slot's bindings from storage.
 *
 * Same `Result` semantics as {@link loadBindingsSnapshot}; the
 * `expectedSlot` argument is forwarded to
 * {@link safeDeserializePlayerBindings} so a copy/paste of P3's
 * payload into P1's key surfaces as `corrupted` rather than silently
 * loading P3's bindings under P1's index.
 */
export function loadPlayerBindings(
  slot: PlayerBindingsIndex,
  storage?: StorageLike | null,
): DetailedStorageResult<PlayerBindings> {
  const target = resolveStorage(storage);
  if (target === null) {
    return {
      ok: false,
      code: 'unavailable',
      error: 'BindingsStorage: no localStorage-compatible storage available; cannot load player bindings.',
    };
  }
  let raw: string | null;
  try {
    raw = target.getItem(playerStorageKey(slot));
  } catch (err) {
    return {
      ok: false,
      code: 'corrupted',
      error: `BindingsStorage: getItem threw while loading slot ${slot} — ${(err as Error).message}`,
    };
  }
  if (raw === null) {
    return {
      ok: false,
      code: 'missing',
      error: `BindingsStorage: no bindings stored at key '${playerStorageKey(slot)}'.`,
    };
  }
  const detectedKind = detectSerializedKind(raw);
  if (detectedKind !== null && detectedKind !== 'playerBindings') {
    return {
      ok: false,
      code: 'corrupted',
      error: `BindingsStorage: slot ${slot} key holds a '${detectedKind}' envelope, not 'playerBindings'.`,
    };
  }
  // Migration-aware load: same rationale as loadBindingsSnapshot —
  // older single-slot exports get upgraded to today's envelope before
  // validation runs.
  const result = migrationAwareDeserializePlayerBindings(raw, slot);
  if (!result.ok) {
    return mapMigrationFailureToStorageResult(result.reason, result.error);
  }
  return { ok: true, value: result.value };
}

// ---------------------------------------------------------------------------
// Migration result → storage result mapping
// ---------------------------------------------------------------------------

/**
 * Translate a {@link migrationAwareDeserializeBindingsSnapshot} /
 * {@link migrationAwareDeserializePlayerBindings} failure into the
 * storage layer's {@link StorageErrorCode} vocabulary.
 *
 * The migration layer distinguishes seven failure modes (`tooOld`,
 * `tooNew`, `notAnInteger`, `migrationFailed`, `invalidContent`); the
 * storage layer collapses them into:
 *
 *   • `too-old`            — out-of-window historical version.
 *   • `too-new`            — payload from a newer build than this loader.
 *   • `corrupted`          — JSON parse / envelope shape failure
 *                            (`notAnInteger` from the migration layer)
 *                            or a strict validator rejection of an
 *                            already-current-version blob (`invalidContent`).
 *   • `migration-failed`   — a registered migration step threw on this
 *                            specific payload.
 *
 * Callers that branch on `code` (the load-or-defaults helper, the
 * settings UI's "corrupted save" dialog) get a stable enum without
 * having to know the migration framework's internal vocabulary.
 */
function mapMigrationFailureToStorageResult<T>(
  reason: BindingsVersionUnsupportedKind | 'migrationFailed' | 'invalidContent',
  error: string,
): DetailedStorageResult<T> {
  switch (reason) {
    case 'tooOld':
      return { ok: false, code: 'too-old', error };
    case 'tooNew':
      return { ok: false, code: 'too-new', error };
    case 'migrationFailed':
      return { ok: false, code: 'migration-failed', error };
    case 'notAnInteger':
    case 'invalidContent':
      return { ok: false, code: 'corrupted', error };
  }
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/**
 * Remove every key this module owns at the current schema version.
 *
 * Used by:
 *
 *   • The settings UI's "Reset all controls and clear save" button.
 *   • The corrupted-blob recovery path: a load that returns
 *     `code: 'corrupted'` *may* call this to evict the bad data so
 *     the next session loads cleanly.
 *
 * Returns a `DetailedStorageResult<void>`. `unavailable` is returned
 * verbatim — there is nothing to clear if storage doesn't exist.
 * `removeItem` is treated as best-effort: a throw on one key does not
 * abort the sweep, but the *first* error is reported in the result so
 * callers don't have to inspect the storage to know whether data
 * remains.
 */
export function clearBindingsStorage(
  storage?: StorageLike | null,
): DetailedStorageResult<void> {
  const target = resolveStorage(storage);
  if (target === null) {
    return {
      ok: false,
      code: 'unavailable',
      error: 'BindingsStorage: no localStorage-compatible storage available; nothing to clear.',
    };
  }
  let firstError: string | null = null;
  for (const key of ALL_BINDINGS_STORAGE_KEYS) {
    try {
      target.removeItem(key);
    } catch (err) {
      if (firstError === null) {
        firstError = `BindingsStorage: removeItem threw for key '${key}' — ${(err as Error).message}`;
      }
    }
  }
  if (firstError !== null) {
    return { ok: false, code: 'write-failed', error: firstError };
  }
  return { ok: true, value: undefined };
}

/**
 * Quick predicate for "is there a snapshot already saved here?"
 *
 * Intended for the settings UI's "Reset all controls" affordance —
 * it should be greyed out when there are no customised bindings to
 * reset. Returns `false` on any error (including unavailable storage)
 * because in those cases there is nothing to reset.
 */
export function hasStoredBindingsSnapshot(storage?: StorageLike | null): boolean {
  const target = resolveStorage(storage);
  if (target === null) return false;
  try {
    return target.getItem(snapshotStorageKey()) !== null;
  } catch {
    return false;
  }
}
