/**
 * IndexedDB persistence backend — AC 30101 Sub-AC 1.
 *
 * What this module is
 * ===================
 *
 * The primary, browser-native storage backend behind
 * {@link ReplayStorage}. IDB gives us:
 *
 *   • A large, browser-managed quota (typically tens of MB to GB,
 *     vs. localStorage's ~5 MB).
 *   • Structured-clone payloads — we could stash binary blobs later
 *     without rewriting the schema.
 *   • Transactions: a `save()` that throws part-way through is
 *     guaranteed to either fully succeed or fully fail; no half-written
 *     row leaks into the index.
 *
 * Schema
 * ------
 *
 * One database, two object stores:
 *
 *   • `replays`  — keyPath: `id`. Stores
 *       { id, savedAt, sizeBytes, recordedAt, durationFrames, notes,
 *         stageId, playerCount, rngSeed, engineVersion, payload }
 *     where `payload` is the serialised replay JSON string. Indexing
 *     into the metadata fields means `list()` reads only the metadata
 *     index (not the multi-MB `payload` blob) when paging through
 *     dozens of replays.
 *
 *   • `metadata` — keyPath: `id`. Stores the same shape minus the
 *     `payload` field, so `list()` is a straight `getAll()` of small
 *     records. Cross-store consistency is enforced inside one
 *     read-write transaction per save.
 *
 * Why two stores instead of one with an index? IDB indexes can re-read
 * row payloads via cursors, but the simpler shape compares cleaner in
 * the test snapshots and lets us evolve the metadata without touching
 * the payload encoding.
 *
 * Schema versioning
 * -----------------
 *
 * The IDB database carries a `version` integer. {@link IDB_DB_VERSION}
 * is the version this build expects; an older DB on disk triggers
 * `onupgradeneeded` and we create / amend the stores. Future schema
 * changes bump the version and add migration logic in
 * {@link migrateOnUpgrade}; today's writer creates both stores fresh.
 *
 * Async + transaction discipline
 * ------------------------------
 *
 * Every public method:
 *
 *   1. Wraps the IDB request in a Promise that resolves on `success`
 *      and rejects on `error` *or* `abort`. We listen on `abort`
 *      because a quota error fires `abort` after the per-request
 *      `error` and we want the rejection to carry the quota signal.
 *   2. Catches and translates `QuotaExceededError` to
 *      {@link ReplayStorageQuotaExceededError} so callers don't have to
 *      sniff browser-specific names.
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM-canvas imports. Touches only IDB. The
 * IDB factory is injectable via the constructor so vitest can pass a
 * shim — see `IndexedDBReplayStorage.test.ts` for the in-memory shim.
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
import { CHECKSUM_ALGORITHM, type ReplayChecksumAlgorithm } from './replayChecksum';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default database name used by the factory when no namespace is supplied. */
export const IDB_DB_NAME = 'platform-fighter-replays' as const;

/** Schema version this build expects. Bump on schema changes. */
export const IDB_DB_VERSION = 1 as const;

/** Object store name for full replay rows (metadata + serialised payload). */
export const IDB_STORE_REPLAYS = 'replays' as const;

/** Object store name for metadata-only rows used by `list()`. */
export const IDB_STORE_METADATA = 'metadata' as const;

// ---------------------------------------------------------------------------
// Internal record shapes
// ---------------------------------------------------------------------------

/** Row shape stored in the `replays` store. `payload` is the JSON string. */
interface IDBReplayRow {
  id: ReplayStorageId;
  savedAt: string;
  sizeBytes: number;
  recordedAt: string;
  durationFrames: number;
  notes: string;
  stageId: string;
  playerCount: number;
  rngSeed: number;
  engineVersion: string;
  payload: string;
  /**
   * Integrity checksum of the `payload` field — AC 30104 Sub-AC 4.
   * Computed at save time; re-computed on load and rejected as
   * {@link ReplayCorruptedError} on disagreement so a bit-flipped row
   * never silently feeds bad bytes into the replay player.
   */
  checksum: string;
  /**
   * Identifier of the algorithm used to produce {@link checksum}. Today
   * always `'fnv1a-64-v1'`; carried per row so a future migration can
   * introduce a stronger hash without invalidating existing rows.
   *
   * Optional in the on-disk shape so legacy rows written before AC
   * 30104 Sub-AC 4 still load — the loader treats a missing algorithm
   * as the v1 default. New writes always populate it.
   */
  checksumAlgorithm?: ReplayChecksumAlgorithm;
}

// ---------------------------------------------------------------------------
// IndexedDBReplayStorage
// ---------------------------------------------------------------------------

/**
 * Persistent IDB-backed storage. Constructed via the static
 * {@link IndexedDBReplayStorage.open} method, not `new` directly — opening
 * a database is an async IDB request, and a constructor cannot wait on
 * it.
 */
export class IndexedDBReplayStorage implements ReplayStorage {
  public readonly backend: ReplayStorageBackend = 'indexeddb';

  private readonly idFactory: () => ReplayStorageId;
  private readonly nowFactory: () => Date;
  private readonly estimateStorage: () => Promise<{ usage?: number; quota?: number }>;
  private db: IDBDatabase | null;
  private closed = false;

  private constructor(
    db: IDBDatabase,
    options: OpenReplayStorageOptions,
  ) {
    this.db = db;
    this.idFactory = options.idFactory ?? defaultIdFactory();
    this.nowFactory = options.nowFactory ?? (() => new Date());
    this.estimateStorage =
      options.estimateStorage ?? (() => defaultEstimateStorage());
  }

  /**
   * Open (or create + migrate) the IDB database, then resolve to a
   * ready-to-use storage instance. Throws {@link ReplayStorageError} on
   * IDB failures (most commonly: private-mode browser refusing to open
   * any IDB database).
   */
  static async open(
    options: OpenReplayStorageOptions = {},
  ): Promise<IndexedDBReplayStorage> {
    const factory =
      options.indexedDBFactory ??
      (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (factory === undefined || typeof factory.open !== 'function') {
      throw new ReplayStorageError(
        'IndexedDBReplayStorage.open: globalThis.indexedDB is unavailable',
      );
    }
    const dbName = options.namespace ?? IDB_DB_NAME;

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      let req: IDBOpenDBRequest;
      try {
        req = factory.open(dbName, IDB_DB_VERSION);
      } catch (err) {
        reject(
          new ReplayStorageError(
            `IndexedDBReplayStorage.open: factory.open threw — ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
        return;
      }
      req.onupgradeneeded = (event) => {
        const target = event.target as IDBOpenDBRequest;
        const upgradeDb = target.result;
        migrateOnUpgrade(upgradeDb, event.oldVersion ?? 0, event.newVersion ?? IDB_DB_VERSION);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(
          new ReplayStorageError(
            `IndexedDBReplayStorage.open: ${req.error?.message ?? 'unknown error'}`,
          ),
        );
      req.onblocked = () =>
        reject(
          new ReplayStorageError(
            'IndexedDBReplayStorage.open: another connection is blocking the upgrade',
          ),
        );
    });

    return new IndexedDBReplayStorage(db, options);
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  async save(
    replay: ReplayFile,
    options: SaveReplayOptions = {},
  ): Promise<StoredReplayMetadata> {
    const db = this.requireDb();
    const validated = validateReplayForWrite(replay);
    const id = options.id ?? this.idFactory();
    if (typeof id !== 'string' || id.length === 0) {
      throw new ReplayStorageError(
        'IndexedDBReplayStorage.save: id must be a non-empty string',
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

    return new Promise<StoredReplayMetadata>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(
          [IDB_STORE_REPLAYS, IDB_STORE_METADATA],
          'readwrite',
        );
      } catch (err) {
        reject(translateIdbError(err, 'save'));
        return;
      }

      const replays = tx.objectStore(IDB_STORE_REPLAYS);
      const metaStore = tx.objectStore(IDB_STORE_METADATA);

      const existsReq = replays.getKey(id);
      existsReq.onsuccess = () => {
        if (existsReq.result !== undefined && options.overwrite !== true) {
          // Abort the transaction so neither store ends up half-modified
          // and reject the outer promise with a clear message.
          tx.abort();
          reject(
            new ReplayStorageError(
              `IndexedDBReplayStorage.save: row '${id}' already exists; pass overwrite: true to replace`,
            ),
          );
          return;
        }
        const row: IDBReplayRow = {
          ...metadata,
          payload: serialized,
          // The metadata struct already carries `checksum` and
          // `checksumAlgorithm`; we re-spread them here for clarity
          // (the row schema treats them as first-class fields rather
          // than relying on the spread to forward them).
          checksum: metadata.checksum,
          checksumAlgorithm: metadata.checksumAlgorithm,
        };
        const putReplay = replays.put(row);
        putReplay.onerror = () => {
          // Don't reject yet — the transaction's `onabort` will surface
          // the proper QuotaExceededError translation once the abort
          // settles.
        };
        const metaRow: StoredReplayMetadata = metadata;
        const putMeta = metaStore.put(metaRow);
        putMeta.onerror = () => {
          /* see putReplay.onerror */
        };
      };
      existsReq.onerror = () => {
        // Existence check failed — most likely the connection is gone.
        reject(translateIdbError(existsReq.error, 'save'));
      };

      tx.oncomplete = () => resolve(metadata);
      tx.onerror = () => {
        reject(translateIdbError(tx.error, 'save'));
      };
      tx.onabort = () => {
        // If we got here without a synchronous reject (`already exists`
        // path), the abort came from a quota / IO error we should
        // surface.
        reject(translateIdbError(tx.error, 'save'));
      };
    });
  }

  async load(id: ReplayStorageId): Promise<StoredReplay | null> {
    const db = this.requireDb();
    return new Promise<StoredReplay | null>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction([IDB_STORE_REPLAYS], 'readonly');
      } catch (err) {
        reject(translateIdbError(err, 'load'));
        return;
      }
      const req = tx.objectStore(IDB_STORE_REPLAYS).get(id);
      req.onsuccess = () => {
        const row = req.result as IDBReplayRow | undefined;
        if (row === undefined) {
          resolve(null);
          return;
        }
        // AC 30104 Sub-AC 4 — verify integrity *before* JSON.parse so
        // a known-corrupted payload surfaces as a typed
        // ReplayCorruptedError rather than a generic JSON-parse error.
        // Legacy rows written before AC 30104 may not carry a checksum
        // field; in that case skip the integrity check (and rely on
        // the parser's per-field validation) so existing data still
        // loads. New writes always populate the field.
        if (typeof row.checksum === 'string' && row.checksum.length > 0) {
          const algorithm = row.checksumAlgorithm ?? CHECKSUM_ALGORITHM;
          try {
            assertReplayPayloadIntegrity(
              row.id,
              row.payload,
              row.checksum,
              algorithm,
            );
          } catch (err) {
            if (err instanceof ReplayCorruptedError) {
              reject(err);
              return;
            }
            reject(
              new ReplayStorageError(
                `IndexedDBReplayStorage.load: row '${id}' integrity check failed — ${
                  err instanceof Error ? err.message : String(err)
                }`,
              ),
            );
            return;
          }
        }
        let replay: ReplayFile;
        try {
          replay = deserializeReplay(JSON.parse(row.payload));
        } catch (err) {
          reject(
            new ReplayStorageError(
              `IndexedDBReplayStorage.load: row '${id}' is corrupt — ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
          );
          return;
        }
        const metadata = buildStoredReplayMetadata(
          row.id,
          row.savedAt,
          row.sizeBytes,
          replay,
          // Preserve the stored checksum verbatim — reusing the row's
          // value rather than re-hashing means the metadata returned
          // to the caller exactly mirrors what's on disk.
          typeof row.checksum === 'string' && row.checksum.length > 0
            ? row.checksum
            : computeReplayPayloadChecksum(row.payload),
          row.checksumAlgorithm ?? CHECKSUM_ALGORITHM,
        );
        resolve(Object.freeze({ metadata, replay }));
      };
      req.onerror = () => reject(translateIdbError(req.error, 'load'));
      tx.onerror = () => reject(translateIdbError(tx.error, 'load'));
      tx.onabort = () => reject(translateIdbError(tx.error, 'load'));
    });
  }

  async loadOrThrow(id: ReplayStorageId): Promise<StoredReplay> {
    const r = await this.load(id);
    if (r === null) throw new ReplayNotFoundError(id);
    return r;
  }

  async list(): Promise<ReadonlyArray<StoredReplayMetadata>> {
    const db = this.requireDb();
    return new Promise<ReadonlyArray<StoredReplayMetadata>>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction([IDB_STORE_METADATA], 'readonly');
      } catch (err) {
        reject(translateIdbError(err, 'list'));
        return;
      }
      const req = tx.objectStore(IDB_STORE_METADATA).getAll();
      req.onsuccess = () => {
        const rows = (req.result ?? []) as StoredReplayMetadata[];
        // Newest savedAt first; tie-break on id for stable order.
        rows.sort((a, b) => {
          if (a.savedAt !== b.savedAt) return a.savedAt < b.savedAt ? 1 : -1;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        resolve(Object.freeze(rows.map((r) => Object.freeze({ ...r }))));
      };
      req.onerror = () => reject(translateIdbError(req.error, 'list'));
      tx.onerror = () => reject(translateIdbError(tx.error, 'list'));
      tx.onabort = () => reject(translateIdbError(tx.error, 'list'));
    });
  }

  async has(id: ReplayStorageId): Promise<boolean> {
    const db = this.requireDb();
    return new Promise<boolean>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction([IDB_STORE_METADATA], 'readonly');
      } catch (err) {
        reject(translateIdbError(err, 'has'));
        return;
      }
      const req = tx.objectStore(IDB_STORE_METADATA).getKey(id);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => reject(translateIdbError(req.error, 'has'));
      tx.onerror = () => reject(translateIdbError(tx.error, 'has'));
      tx.onabort = () => reject(translateIdbError(tx.error, 'has'));
    });
  }

  async delete(id: ReplayStorageId): Promise<boolean> {
    const db = this.requireDb();
    // Two-step: existence check, then delete. Both inside one transaction
    // so a concurrent writer can't slip a row under us between the check
    // and the delete.
    return new Promise<boolean>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction([IDB_STORE_REPLAYS, IDB_STORE_METADATA], 'readwrite');
      } catch (err) {
        reject(translateIdbError(err, 'delete'));
        return;
      }
      const replays = tx.objectStore(IDB_STORE_REPLAYS);
      const metaStore = tx.objectStore(IDB_STORE_METADATA);
      const existsReq = replays.getKey(id);
      let removed = false;
      existsReq.onsuccess = () => {
        if (existsReq.result === undefined) {
          // Nothing to delete — let the transaction commit cleanly.
          return;
        }
        removed = true;
        replays.delete(id);
        metaStore.delete(id);
      };
      existsReq.onerror = () => reject(translateIdbError(existsReq.error, 'delete'));
      tx.oncomplete = () => resolve(removed);
      tx.onerror = () => reject(translateIdbError(tx.error, 'delete'));
      tx.onabort = () => reject(translateIdbError(tx.error, 'delete'));
    });
  }

  async clear(): Promise<void> {
    const db = this.requireDb();
    return new Promise<void>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction([IDB_STORE_REPLAYS, IDB_STORE_METADATA], 'readwrite');
      } catch (err) {
        reject(translateIdbError(err, 'clear'));
        return;
      }
      tx.objectStore(IDB_STORE_REPLAYS).clear();
      tx.objectStore(IDB_STORE_METADATA).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(translateIdbError(tx.error, 'clear'));
      tx.onabort = () => reject(translateIdbError(tx.error, 'clear'));
    });
  }

  async getStats(): Promise<ReplayStorageStats> {
    const list = await this.list();
    let total = 0;
    for (const m of list) total += m.sizeBytes;
    let usageBytes: number | null = total;
    let quotaBytes: number | null = null;
    try {
      const est = await this.estimateStorage();
      if (typeof est.quota === 'number' && Number.isFinite(est.quota)) {
        quotaBytes = est.quota;
      }
      if (typeof est.usage === 'number' && Number.isFinite(est.usage)) {
        usageBytes = est.usage;
      }
    } catch {
      // Storage estimate is a best-effort hint — keep the local total
      // we already computed if the API throws.
    }
    return Object.freeze({
      count: list.length,
      totalBytes: total,
      quotaBytes,
      usageBytes,
      backend: this.backend,
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.db !== null) {
      try {
        this.db.close();
      } catch {
        // Closing twice or after a forced close is a no-op in Chrome
        // but historically threw in older Firefox; swallow.
      }
      this.db = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private requireDb(): IDBDatabase {
    if (this.closed || this.db === null) {
      throw new ReplayStorageError(
        'IndexedDBReplayStorage: backend is closed',
      );
    }
    return this.db;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run on `onupgradeneeded`. Today's writer creates both stores fresh;
 * future schema changes branch on `oldVersion` to migrate.
 */
function migrateOnUpgrade(
  db: IDBDatabase,
  oldVersion: number,
  _newVersion: number,
): void {
  if (oldVersion < 1) {
    if (!db.objectStoreNames.contains(IDB_STORE_REPLAYS)) {
      db.createObjectStore(IDB_STORE_REPLAYS, { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains(IDB_STORE_METADATA)) {
      const metaStore = db.createObjectStore(IDB_STORE_METADATA, { keyPath: 'id' });
      metaStore.createIndex('savedAt', 'savedAt', { unique: false });
    }
  }
  // Future bumps land here.
}

/**
 * Translate an IDB error into a {@link ReplayStorageError} subclass.
 * Specifically maps quota-exceeded into
 * {@link ReplayStorageQuotaExceededError} so callers can branch on the
 * type without sniffing browser strings.
 */
function translateIdbError(err: unknown, op: string): ReplayStorageError {
  if (isQuotaExceededError(err)) {
    return new ReplayStorageQuotaExceededError(
      `IndexedDBReplayStorage.${op}: storage quota exceeded`,
      err,
    );
  }
  const msg = err instanceof Error ? err.message : err === null || err === undefined ? 'unknown error' : String(err);
  return new ReplayStorageError(`IndexedDBReplayStorage.${op}: ${msg}`);
}

/**
 * Default `navigator.storage.estimate` invocation. Returns an empty
 * object on environments that don't support it (Node, older browsers)
 * so callers don't have to branch.
 */
async function defaultEstimateStorage(): Promise<{ usage?: number; quota?: number }> {
  const nav = (globalThis as { navigator?: Navigator & { storage?: StorageManager } }).navigator;
  if (
    nav !== undefined &&
    nav.storage !== undefined &&
    typeof nav.storage.estimate === 'function'
  ) {
    return nav.storage.estimate();
  }
  return {};
}
