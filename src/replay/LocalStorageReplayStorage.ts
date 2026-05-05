/**
 * localStorage persistence backend — AC 30101 Sub-AC 1.
 *
 * What this module is
 * ===================
 *
 * The fallback storage backend behind {@link ReplayStorage}, used when
 * IndexedDB is unavailable (private-mode Firefox sometimes refuses to
 * open IDB; some embedded WebViews disable it entirely). Trades IDB's
 * generous quota for ~5 MB of synchronous string storage, but every
 * other CRUD operation behaves identically — the replay menu doesn't
 * need to branch on backend type.
 *
 * Key layout
 * ----------
 *
 * Every stored replay occupies two `localStorage` keys:
 *
 *   • `${prefix}meta:${id}`   — JSON-encoded {@link StoredReplayMetadata}.
 *   • `${prefix}data:${id}`   — the serialised replay JSON string.
 *
 * Plus one bookkeeping key:
 *
 *   • `${prefix}index`        — JSON array of every replay's id, in
 *     insertion order. Lets `list()` answer in one read instead of
 *     scanning every key the page has stored.
 *
 * `prefix` defaults to `'pf:replay:'` and is configurable via the
 * `namespace` option so multiple builds (alpha / production) don't
 * collide on the same origin.
 *
 * Quota handling
 * --------------
 *
 * Browsers throw a `QuotaExceededError` when a `setItem` call would
 * push the origin over its localStorage limit. The backend catches
 * the error, attempts to roll back the partial write (the half-written
 * data key is removed; the metadata key only writes after data is
 * confirmed; the index key only updates after both confirm), and
 * rethrows as {@link ReplayStorageQuotaExceededError}.
 *
 * Async pretence
 * --------------
 *
 * localStorage is synchronous — but the {@link ReplayStorage}
 * interface is async. Methods here resolve immediately via
 * `Promise.resolve(...)`. The cost is a microtask hop per operation,
 * which is negligible compared to the user clicking "save".
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM-canvas imports. `localStorage` itself is
 * a `Storage` instance reachable via `globalThis.localStorage`; tests
 * pass an in-memory shim through the constructor.
 */

import {
  type ReplayFile,
  deserializeReplay,
} from './ReplayFile';
import {
  type OpenReplayStorageOptions,
  type ReplayStorage,
  type ReplayStorageBackend,
  type ReplayStorageId,
  type ReplayStorageStats,
  type SaveReplayOptions,
  type StoredReplay,
  type StoredReplayMetadata,
  ReplayCorruptedError,
  ReplayNotFoundError,
  ReplayStorageError,
  ReplayStorageQuotaExceededError,
  assertReplayPayloadIntegrity,
  buildStoredReplayMetadata,
  computeReplayPayloadChecksum,
  defaultIdFactory,
  isQuotaExceededError,
  serializeReplayForStorage,
  utf8ByteLength,
  validateReplayForWrite,
} from './ReplayStorage';
import { CHECKSUM_ALGORITHM } from './replayChecksum';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default key prefix when no namespace is supplied. */
export const LS_DEFAULT_PREFIX = 'pf:replay:' as const;

/** Bookkeeping suffix for the array-of-ids index. */
export const LS_INDEX_SUFFIX = 'index' as const;

/** Per-row metadata-key suffix. */
export const LS_META_SUFFIX = 'meta:' as const;

/** Per-row payload-key suffix. */
export const LS_DATA_SUFFIX = 'data:' as const;

// ---------------------------------------------------------------------------
// LocalStorageReplayStorage
// ---------------------------------------------------------------------------

/**
 * `localStorage`-backed implementation of {@link ReplayStorage}.
 * Constructable synchronously — unlike the IDB backend, no async
 * "open" step is needed.
 */
export class LocalStorageReplayStorage implements ReplayStorage {
  public readonly backend: ReplayStorageBackend = 'localstorage';

  private readonly idFactory: () => ReplayStorageId;
  private readonly nowFactory: () => Date;
  private readonly storage: Storage;
  private readonly prefix: string;
  private closed = false;

  constructor(options: OpenReplayStorageOptions = {}) {
    const ls =
      options.localStorageRef ??
      (globalThis as { localStorage?: Storage }).localStorage;
    if (
      ls === undefined ||
      typeof ls.setItem !== 'function' ||
      typeof ls.getItem !== 'function' ||
      typeof ls.removeItem !== 'function'
    ) {
      throw new ReplayStorageError(
        'LocalStorageReplayStorage: globalThis.localStorage is unavailable',
      );
    }
    this.storage = ls;
    this.prefix = options.namespace ?? LS_DEFAULT_PREFIX;
    this.idFactory = options.idFactory ?? defaultIdFactory();
    this.nowFactory = options.nowFactory ?? (() => new Date());
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  async save(
    replay: ReplayFile,
    options: SaveReplayOptions = {},
  ): Promise<StoredReplayMetadata> {
    this.assertOpen();
    const validated = validateReplayForWrite(replay);
    const id = options.id ?? this.idFactory();
    if (typeof id !== 'string' || id.length === 0) {
      throw new ReplayStorageError(
        'LocalStorageReplayStorage.save: id must be a non-empty string',
      );
    }

    const index = this.readIndex();
    const exists = index.includes(id);
    if (exists && options.overwrite !== true) {
      throw new ReplayStorageError(
        `LocalStorageReplayStorage.save: row '${id}' already exists; pass overwrite: true to replace`,
      );
    }

    const serialized = serializeReplayForStorage(validated);
    const sizeBytes = utf8ByteLength(serialized);
    const checksum = computeReplayPayloadChecksum(serialized);
    const savedAt = (options.savedAt ?? this.nowFactory()).toISOString();
    const metadata = buildStoredReplayMetadata(
      id,
      savedAt,
      sizeBytes,
      validated,
      checksum,
    );
    const dataKey = this.dataKey(id);
    const metaKey = this.metaKey(id);

    // Three-step write: data → metadata → index. The order matters —
    // a quota error mid-write leaves at most a stale data row, which
    // we GC on the catch path. The metadata + index are only updated
    // once data is committed, so `list()` never points at a partial.
    try {
      this.setItemOrThrow(dataKey, serialized);
    } catch (err) {
      // Nothing to roll back yet.
      throw err;
    }
    try {
      this.setItemOrThrow(metaKey, JSON.stringify(metadata));
    } catch (err) {
      // Roll back the data write so we don't leak a key with no
      // metadata pointing at it.
      this.safeRemove(dataKey);
      throw err;
    }
    if (!exists) {
      const nextIndex = [...index, id];
      try {
        this.setItemOrThrow(this.indexKey(), JSON.stringify(nextIndex));
      } catch (err) {
        this.safeRemove(metaKey);
        this.safeRemove(dataKey);
        throw err;
      }
    }
    return metadata;
  }

  async load(id: ReplayStorageId): Promise<StoredReplay | null> {
    this.assertOpen();
    const data = this.storage.getItem(this.dataKey(id));
    if (data === null) return null;

    // Re-derive metadata from the metadata key first — we need the
    // stored checksum to verify integrity *before* the JSON parse.
    const metaRaw = this.storage.getItem(this.metaKey(id));
    let storedMeta: StoredReplayMetadata | null = null;
    if (metaRaw !== null) {
      try {
        storedMeta = JSON.parse(metaRaw) as StoredReplayMetadata;
      } catch {
        // Fall through — corrupt metadata is handled below the same
        // way as a missing metadata key (re-derive from the payload,
        // skip the integrity check).
        storedMeta = null;
      }
    }

    // AC 30104 Sub-AC 4 — verify integrity *before* JSON.parse so
    // a known-corrupted payload surfaces as a typed
    // ReplayCorruptedError. Skip when no checksum is available
    // (legacy rows written before the integrity layer existed; or
    // rows whose meta key was deleted by an external tool — the
    // payload still parses, so we'll just recompute metadata).
    if (
      storedMeta !== null &&
      typeof storedMeta.checksum === 'string' &&
      storedMeta.checksum.length > 0
    ) {
      const algorithm = storedMeta.checksumAlgorithm ?? CHECKSUM_ALGORITHM;
      try {
        assertReplayPayloadIntegrity(id, data, storedMeta.checksum, algorithm);
      } catch (err) {
        if (err instanceof ReplayCorruptedError) {
          throw err;
        }
        throw new ReplayStorageError(
          `LocalStorageReplayStorage.load: row '${id}' integrity check failed — ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    let replay: ReplayFile;
    try {
      replay = deserializeReplay(JSON.parse(data));
    } catch (err) {
      throw new ReplayStorageError(
        `LocalStorageReplayStorage.load: row '${id}' is corrupt — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    let metadata: StoredReplayMetadata;
    if (storedMeta !== null) {
      // Legacy compat: if the stored metadata predates AC 30104 Sub-AC 4
      // (no `checksum` field), backfill a freshly computed checksum
      // from the loaded payload so the metadata returned to the caller
      // still satisfies the post-AC schema. Live writes always populate
      // the field, so this only triggers for old rows on first read.
      const checksum =
        typeof storedMeta.checksum === 'string' && storedMeta.checksum.length > 0
          ? storedMeta.checksum
          : computeReplayPayloadChecksum(data);
      const checksumAlgorithm = storedMeta.checksumAlgorithm ?? CHECKSUM_ALGORITHM;
      metadata = Object.freeze({
        ...storedMeta,
        checksum,
        checksumAlgorithm,
      });
    } else {
      // Defensive: meta key was missing or unparseable — re-derive
      // from the loaded replay. The new metadata gets a freshly
      // computed checksum so callers still see a consistent struct,
      // even though we couldn't verify against a stored value.
      metadata = buildStoredReplayMetadata(
        id,
        replay.metadata.recordedAt,
        utf8ByteLength(data),
        replay,
        computeReplayPayloadChecksum(data),
      );
    }
    return Object.freeze({ metadata, replay });
  }

  async loadOrThrow(id: ReplayStorageId): Promise<StoredReplay> {
    const r = await this.load(id);
    if (r === null) throw new ReplayNotFoundError(id);
    return r;
  }

  async list(): Promise<ReadonlyArray<StoredReplayMetadata>> {
    this.assertOpen();
    const ids = this.readIndex();
    const rows: StoredReplayMetadata[] = [];
    for (const id of ids) {
      const raw = this.storage.getItem(this.metaKey(id));
      if (raw === null) continue;
      try {
        rows.push(Object.freeze(JSON.parse(raw) as StoredReplayMetadata));
      } catch {
        // Skip corrupt metadata rows — they'll show as "missing" in
        // list output and the user can purge them via clear().
      }
    }
    rows.sort((a, b) => {
      if (a.savedAt !== b.savedAt) return a.savedAt < b.savedAt ? 1 : -1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return Object.freeze(rows);
  }

  async has(id: ReplayStorageId): Promise<boolean> {
    this.assertOpen();
    return this.storage.getItem(this.metaKey(id)) !== null;
  }

  async delete(id: ReplayStorageId): Promise<boolean> {
    this.assertOpen();
    const index = this.readIndex();
    const idx = index.indexOf(id);
    const hadIndexEntry = idx >= 0;
    const hadDataKey = this.storage.getItem(this.dataKey(id)) !== null;
    if (!hadIndexEntry && !hadDataKey) return false;
    this.safeRemove(this.dataKey(id));
    this.safeRemove(this.metaKey(id));
    if (hadIndexEntry) {
      const next = [...index.slice(0, idx), ...index.slice(idx + 1)];
      // The index key write *can* in principle hit quota (shrinking
      // strings can grow the encoding). Defensive: catch and rethrow
      // as a quota error rather than leave a half-deleted row.
      try {
        this.setItemOrThrow(this.indexKey(), JSON.stringify(next));
      } catch (err) {
        if (err instanceof ReplayStorageQuotaExceededError) {
          // Best-effort recovery: nothing else we can do here.
        }
        throw err;
      }
    }
    return true;
  }

  async clear(): Promise<void> {
    this.assertOpen();
    const ids = this.readIndex();
    for (const id of ids) {
      this.safeRemove(this.dataKey(id));
      this.safeRemove(this.metaKey(id));
    }
    this.safeRemove(this.indexKey());
  }

  async getStats(): Promise<ReplayStorageStats> {
    this.assertOpen();
    const list = await this.list();
    let total = 0;
    for (const m of list) total += m.sizeBytes;
    return Object.freeze({
      count: list.length,
      totalBytes: total,
      // localStorage's per-origin quota is browser-defined (~5 MB) but
      // not exposed programmatically — leave null and let the UI use
      // the count + totalBytes for guidance.
      quotaBytes: null,
      usageBytes: total,
      backend: this.backend,
    });
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private assertOpen(): void {
    if (this.closed) {
      throw new ReplayStorageError('LocalStorageReplayStorage: backend is closed');
    }
  }

  private indexKey(): string {
    return `${this.prefix}${LS_INDEX_SUFFIX}`;
  }

  private metaKey(id: ReplayStorageId): string {
    return `${this.prefix}${LS_META_SUFFIX}${id}`;
  }

  private dataKey(id: ReplayStorageId): string {
    return `${this.prefix}${LS_DATA_SUFFIX}${id}`;
  }

  private readIndex(): ReplayStorageId[] {
    const raw = this.storage.getItem(this.indexKey());
    if (raw === null) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const out: ReplayStorageId[] = [];
      for (const item of parsed) {
        if (typeof item === 'string' && item.length > 0) out.push(item);
      }
      return out;
    } catch {
      // Corrupt index — treat as empty so the caller can still write
      // new replays. The orphaned data/meta keys stay in storage and
      // can be cleaned via `clear()`.
      return [];
    }
  }

  private setItemOrThrow(key: string, value: string): void {
    try {
      this.storage.setItem(key, value);
    } catch (err) {
      if (isQuotaExceededError(err)) {
        throw new ReplayStorageQuotaExceededError(
          `LocalStorageReplayStorage: quota exceeded writing key '${key}'`,
          err,
        );
      }
      throw new ReplayStorageError(
        `LocalStorageReplayStorage: setItem('${key}') failed — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private safeRemove(key: string): void {
    try {
      this.storage.removeItem(key);
    } catch {
      // Ignore — `removeItem` failures shouldn't block higher-level
      // operations (and almost never happen in practice).
    }
  }
}
