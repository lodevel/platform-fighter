/**
 * Minimal in-memory IndexedDB shim — just enough surface to drive
 * {@link IndexedDBReplayStorage} under vitest's default Node
 * environment, where `globalThis.indexedDB` is undefined.
 *
 * This shim is deliberately partial:
 *
 *   • It supports `IDBFactory.open`, the `onupgradeneeded` upgrade
 *     callback, and `transaction(storeNames, mode)` returning an
 *     `IDBTransaction`.
 *   • It supports `IDBObjectStore.get`, `getKey`, `getAll`, `put`,
 *     `delete`, and `clear`. That's the full set the production
 *     backend uses.
 *   • Transactions commit on a microtask hop after the last queued
 *     request resolves, mirroring real IDB's "auto-commit when no
 *     pending requests" behaviour.
 *   • A configurable `quotaBytes` lets tests force `QuotaExceededError`
 *     on writes once the cumulative payload exceeds the limit.
 *
 * Anything outside that subset is intentionally absent — adding it on
 * the principle of "more shim than the production code asks for" would
 * dilute the assertion surface. If a future test needs (say) cursors,
 * extend the shim alongside the test that needs it.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FakeIDBOptions {
  /** Total byte budget across all stored values. Default: Infinity. */
  quotaBytes?: number;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface QuotaError extends Error {
  name: 'QuotaExceededError';
}

function quotaError(): QuotaError {
  const e = new Error('Quota exceeded') as QuotaError;
  e.name = 'QuotaExceededError';
  return e;
}

class FakeRequest<T> {
  public result: T | undefined;
  public error: Error | null = null;
  public onsuccess: ((this: FakeRequest<T>, ev: Event) => unknown) | null = null;
  public onerror: ((this: FakeRequest<T>, ev: Event) => unknown) | null = null;
  public source?: unknown;
  public transaction?: FakeTransaction;
  public readyState: 'pending' | 'done' = 'pending';

  /** Resolve the request asynchronously with the given result. */
  resolve(value: T): void {
    this.result = value;
    this.readyState = 'done';
    queueMicrotask(() => {
      if (this.onsuccess) this.onsuccess.call(this, new Event('success'));
      this.transaction?._maybeComplete();
    });
  }

  /** Fail the request and abort its parent transaction. */
  fail(err: Error): void {
    this.error = err;
    this.readyState = 'done';
    // Mark the transaction aborted synchronously so the auto-complete
    // check doesn't fire `oncomplete` between the failure and the
    // queued onabort dispatch. Real IDB transitions to "inactive"
    // immediately on a request error too.
    this.transaction?._markAborted(err);
    queueMicrotask(() => {
      if (this.onerror) this.onerror.call(this, new Event('error'));
      this.transaction?._dispatchAbort();
    });
  }
}

class FakeObjectStore {
  constructor(
    private readonly name: string,
    private readonly db: FakeDatabase,
    private readonly tx: FakeTransaction,
  ) {}

  private store(): Map<string, unknown> {
    let s = this.db.stores.get(this.name);
    if (!s) {
      s = new Map<string, unknown>();
      this.db.stores.set(this.name, s);
    }
    return s;
  }

  put(value: unknown): FakeRequest<unknown> {
    const req = new FakeRequest<unknown>();
    req.transaction = this.tx;
    this.tx._enqueue(req, () => {
      const obj = value as { id?: string };
      if (typeof obj.id !== 'string') {
        req.fail(new Error('put: missing keyPath "id"'));
        return;
      }
      // Quota check: serialise the full DB and compare against the cap.
      const projectedSize = this.db.computeSizeWithReplacement(
        this.name,
        obj.id,
        value,
      );
      if (projectedSize > this.db.quotaBytes) {
        req.fail(quotaError());
        return;
      }
      this.store().set(obj.id, value);
      req.resolve(obj.id);
    });
    return req;
  }

  get(key: string): FakeRequest<unknown> {
    const req = new FakeRequest<unknown>();
    req.transaction = this.tx;
    this.tx._enqueue(req, () => {
      req.resolve(this.store().get(key));
    });
    return req;
  }

  getKey(key: string): FakeRequest<unknown> {
    const req = new FakeRequest<unknown>();
    req.transaction = this.tx;
    this.tx._enqueue(req, () => {
      req.resolve(this.store().has(key) ? key : undefined);
    });
    return req;
  }

  getAll(): FakeRequest<unknown[]> {
    const req = new FakeRequest<unknown[]>();
    req.transaction = this.tx;
    this.tx._enqueue(req, () => {
      req.resolve([...this.store().values()]);
    });
    return req;
  }

  delete(key: string): FakeRequest<undefined> {
    const req = new FakeRequest<undefined>();
    req.transaction = this.tx;
    this.tx._enqueue(req, () => {
      this.store().delete(key);
      req.resolve(undefined);
    });
    return req;
  }

  clear(): FakeRequest<undefined> {
    const req = new FakeRequest<undefined>();
    req.transaction = this.tx;
    this.tx._enqueue(req, () => {
      this.store().clear();
      req.resolve(undefined);
    });
    return req;
  }

  createIndex(_name: string, _keyPath: string, _options?: unknown): unknown {
    // No-op stand-in — production code creates indexes during the
    // upgrade callback, but our shim doesn't enforce them.
    return {};
  }
}

class FakeTransaction {
  public mode: IDBTransactionMode;
  public objectStoreNames: string[];
  public oncomplete: (() => void) | null = null;
  public onerror: ((ev: Event) => void) | null = null;
  public onabort: ((ev: Event) => void) | null = null;
  public error: Error | null = null;

  private pending = 0;
  private finished = false;
  private aborted = false;
  private queued: Array<() => void> = [];
  private draining = false;

  constructor(
    private readonly db: FakeDatabase,
    storeNames: string[],
    mode: IDBTransactionMode,
  ) {
    this.objectStoreNames = storeNames;
    this.mode = mode;
  }

  objectStore(name: string): FakeObjectStore {
    if (!this.objectStoreNames.includes(name)) {
      throw new Error(`objectStore: '${name}' not in transaction scope`);
    }
    return new FakeObjectStore(name, this.db, this);
  }

  abort(): void {
    if (this.finished) return;
    this._markAborted(new Error('aborted'));
    queueMicrotask(() => this._dispatchAbort());
  }

  /** Synchronous part: flip the aborted flag so _maybeComplete sees it. */
  _markAborted(err: Error): void {
    if (this.finished || this.aborted) return;
    this.aborted = true;
    this.finished = true;
    this.error = err;
    this.queued.length = 0;
  }

  /** Async part: fire onerror / onabort. */
  _dispatchAbort(): void {
    if (this.onerror) this.onerror(new Event('error'));
    if (this.onabort) this.onabort(new Event('abort'));
  }

  _enqueue(_req: FakeRequest<unknown> | FakeRequest<unknown[]> | FakeRequest<undefined>, work: () => void): void {
    if (this.finished || this.aborted) return;
    this.pending += 1;
    this.queued.push(() => {
      try {
        work();
      } catch (err) {
        this._abort(err instanceof Error ? err : new Error(String(err)));
      }
      this.pending -= 1;
    });
    this._drain();
  }

  _maybeComplete(): void {
    if (this.finished || this.aborted) return;
    // Auto-commit when nothing is queued and no requests are pending.
    queueMicrotask(() => {
      if (
        !this.finished &&
        !this.aborted &&
        this.pending === 0 &&
        this.queued.length === 0
      ) {
        this.finished = true;
        if (this.oncomplete) this.oncomplete();
      }
    });
  }

  _abort(err: Error): void {
    if (this.finished || this.aborted) return;
    this._markAborted(err);
    queueMicrotask(() => this._dispatchAbort());
  }

  private _drain(): void {
    if (this.draining) return;
    this.draining = true;
    queueMicrotask(() => {
      while (this.queued.length > 0 && !this.aborted) {
        const work = this.queued.shift();
        if (work) work();
      }
      this.draining = false;
    });
  }
}

class FakeObjectStoreNames {
  constructor(private readonly names: Set<string>) {}
  contains(name: string): boolean {
    return this.names.has(name);
  }
}

class FakeDatabase {
  public version: number;
  public name: string;
  public objectStoreNames: FakeObjectStoreNames;
  public stores: Map<string, Map<string, unknown>> = new Map();
  public quotaBytes: number;
  public closed = false;
  public onversionchange: ((ev: Event) => void) | null = null;

  constructor(name: string, version: number, quotaBytes: number) {
    this.name = name;
    this.version = version;
    this.quotaBytes = quotaBytes;
    this.objectStoreNames = new FakeObjectStoreNames(new Set(this.stores.keys()));
  }

  createObjectStore(
    name: string,
    _options?: { keyPath?: string },
  ): FakeObjectStore {
    if (this.stores.has(name)) {
      throw new Error(`createObjectStore: '${name}' already exists`);
    }
    this.stores.set(name, new Map());
    this.objectStoreNames = new FakeObjectStoreNames(new Set(this.stores.keys()));
    // Return a placeholder that exposes only `createIndex` (the upgrade
    // path uses it). Reuse FakeObjectStore so the shim has only one
    // type, but pass a synthesized transaction that swallows enqueue.
    const tx = new FakeTransaction(this, [name], 'versionchange');
    return new FakeObjectStore(name, this, tx);
  }

  transaction(storeNames: string | string[], mode?: IDBTransactionMode): FakeTransaction {
    if (this.closed) {
      throw new Error('transaction: database is closed');
    }
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    for (const n of names) {
      if (!this.stores.has(n)) {
        throw new Error(`transaction: store '${n}' does not exist`);
      }
    }
    return new FakeTransaction(this, names, mode ?? 'readonly');
  }

  close(): void {
    this.closed = true;
  }

  /**
   * Compute the cumulative byte size of every value in every store,
   * with one entry replaced (for projecting the *would-be* size of an
   * incoming put). Used by the quota check.
   */
  computeSizeWithReplacement(
    storeName: string,
    replacementKey: string,
    replacementValue: unknown,
  ): number {
    let total = 0;
    for (const [name, store] of this.stores) {
      for (const [key, value] of store) {
        if (name === storeName && key === replacementKey) continue;
        total += jsonByteLength(value);
      }
    }
    total += jsonByteLength(replacementValue);
    return total;
  }
}

function jsonByteLength(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return 0;
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(json).length;
    }
    return json.length;
  } catch {
    return 0;
  }
}

class FakeOpenRequest {
  public result: FakeDatabase | null = null;
  public error: Error | null = null;
  public onupgradeneeded:
    | ((this: FakeOpenRequest, ev: { target: FakeOpenRequest; oldVersion: number; newVersion: number }) => void)
    | null = null;
  public onsuccess: ((this: FakeOpenRequest, ev: Event) => void) | null = null;
  public onerror: ((this: FakeOpenRequest, ev: Event) => void) | null = null;
  public onblocked: ((this: FakeOpenRequest, ev: Event) => void) | null = null;
}

export class FakeIDBFactory {
  private readonly databases: Map<string, FakeDatabase> = new Map();
  private readonly quotaBytes: number;

  constructor(options: FakeIDBOptions = {}) {
    this.quotaBytes =
      typeof options.quotaBytes === 'number' && options.quotaBytes >= 0
        ? options.quotaBytes
        : Number.POSITIVE_INFINITY;
  }

  open(name: string, version?: number): FakeOpenRequest {
    const req = new FakeOpenRequest();
    queueMicrotask(() => {
      try {
        const requestedVersion = version ?? 1;
        let db = this.databases.get(name);
        const oldVersion = db?.version ?? 0;
        if (!db) {
          db = new FakeDatabase(name, requestedVersion, this.quotaBytes);
          this.databases.set(name, db);
        }
        const needsUpgrade = oldVersion < requestedVersion;
        if (needsUpgrade) {
          db.version = requestedVersion;
          req.result = db;
          if (req.onupgradeneeded) {
            req.onupgradeneeded.call(req, {
              target: req,
              oldVersion,
              newVersion: requestedVersion,
            });
          }
        }
        req.result = db;
        if (req.onsuccess) req.onsuccess.call(req, new Event('success'));
      } catch (err) {
        req.error = err instanceof Error ? err : new Error(String(err));
        if (req.onerror) req.onerror.call(req, new Event('error'));
      }
    });
    return req;
  }

  /** Drop every database — used by tests' `beforeEach` to reset state. */
  reset(): void {
    for (const db of this.databases.values()) db.close();
    this.databases.clear();
  }

  /** Adjust the byte budget so a follow-up put hits quota. */
  setQuota(bytes: number): void {
    for (const db of this.databases.values()) db.quotaBytes = bytes;
  }

  /**
   * Test helper: read the raw stored value for a given (database, store,
   * key) tuple. Bypasses the transaction layer entirely — use only for
   * test setup / inspection. Returns `undefined` when any segment of the
   * path doesn't exist.
   *
   * Used by AC 30104 Sub-AC 4 corruption-detection tests: read a row,
   * mutate one field, write it back via {@link pokeRaw}, then drive the
   * production code's `load()` to confirm the integrity check fires.
   */
  peekRaw(databaseName: string, storeName: string, key: string): unknown {
    const db = this.databases.get(databaseName);
    if (!db) return undefined;
    const store = db.stores.get(storeName);
    if (!store) return undefined;
    return store.get(key);
  }

  /**
   * Test helper: overwrite the raw stored value for a given (database,
   * store, key) tuple. Bypasses the transaction layer — use only for
   * test setup. Throws if the database / store does not yet exist
   * (we don't want a typo in the database name to silently succeed).
   */
  pokeRaw(
    databaseName: string,
    storeName: string,
    key: string,
    value: unknown,
  ): void {
    const db = this.databases.get(databaseName);
    if (!db) {
      throw new Error(`pokeRaw: database '${databaseName}' does not exist`);
    }
    const store = db.stores.get(storeName);
    if (!store) {
      throw new Error(
        `pokeRaw: store '${storeName}' does not exist in database '${databaseName}'`,
      );
    }
    store.set(key, value);
  }
}
