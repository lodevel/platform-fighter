/**
 * Replay library — AC 30102 Sub-AC 2.
 *
 * What this module is
 * ===================
 *
 * The high-level **CRUD façade** the rest of the game (the M4 replay menu,
 * the post-match "Save Replay" button, the stage builder's "Replay this
 * test fight" link) talks to. Where {@link ReplayStorage} is the
 * backend-agnostic interface every storage backend implements,
 * `ReplayLibrary` is the *user-facing service*: opens a sensible default
 * backend on construction, exposes exactly the four CRUD methods the AC
 * names — `save`, `load`, `list`, `delete` — and quietly falls back from
 * IndexedDB to localStorage when the browser refuses to open IDB
 * (incognito Firefox, embedded WebViews, locked-down enterprise builds).
 *
 * Why a separate type?
 * --------------------
 *
 *   • **Smaller surface.** The storage interface ships with
 *     `loadOrThrow`, `has`, `clear`, `getStats`, `close` and the option
 *     to inject id / time factories. The replay menu doesn't need most
 *     of that — a shorter API is easier to reason about and easier to
 *     mock in M4 menu tests.
 *   • **Friendlier `load`.** The storage layer's `load` returns
 *     `StoredReplay | null` (metadata + frozen replay). 90% of callers
 *     only want the {@link ReplayFile} itself; this façade returns it
 *     directly.
 *   • **Explicit fallback story.** The factory `openReplayStorage` does
 *     fall back automatically, but its order is
 *     `IDB → localStorage → memory`. The library makes the IDB→LS
 *     transition observable through a `usedFallback` flag and a
 *     diagnostic `fallbackReason` string so HUDs / logs can show "your
 *     replays are saved in localStorage because IDB failed".
 *   • **Lazy + idempotent open.** `ReplayLibrary.open()` is async because
 *     IDB is async; subsequent CRUD calls are awaited against the same
 *     backend without re-probing. Tests that build many libraries pay
 *     only one open per library.
 *
 * Determinism
 * -----------
 *
 * No gameplay code paths through the library — it's a pure save/load
 * service. The library does not introduce non-determinism: `save()` uses
 * `crypto.randomUUID()` for ids and `Date.now()` for timestamps by
 * default, both injectable via the constructor for tests that need
 * exact ids / stable `savedAt` strings.
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or HTMLCanvas imports. Reaches only IDB,
 * localStorage, `crypto.randomUUID`, and `Date.now`, all stubbable
 * through the existing `ReplayStorageOptions` factory hooks.
 */

import type { ReplayFile } from './ReplayFile';
import {
  ReplayNotFoundError,
  ReplayStorageError,
  openReplayStorage,
  type OpenReplayStorageOptions,
  type ReplayStorage,
  type ReplayStorageBackend,
  type ReplayStorageId,
  type ReplayStorageStats,
  type SaveReplayOptions,
  type StoredReplayMetadata,
} from './ReplayStorage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for {@link ReplayLibrary.open}. Same shape as
 * {@link OpenReplayStorageOptions} plus a flag governing the
 * IDB→localStorage fallback policy.
 *
 * The default is `'auto'`, matching {@link openReplayStorage}: try IDB,
 * fall back to localStorage on any open failure, then to memory if
 * neither is available. Tests pin `prefer` to one specific backend.
 */
export interface ReplayLibraryOptions extends OpenReplayStorageOptions {
  /**
   * Hook fired after the library successfully opens. Receives the chosen
   * backend kind and, when a fallback occurred, the diagnostic message
   * from the underlying open failure. Useful for logging and HUD
   * annotations. Defaults to a no-op.
   */
  readonly onBackendOpen?: (info: {
    backend: ReplayStorageBackend;
    usedFallback: boolean;
    fallbackReason: string | null;
  }) => void;
}

/**
 * Subset of {@link ReplayStorageStats} a UI typically displays. Mirrors
 * the storage shape verbatim — re-exported so menu code can import it
 * without depending on the storage module directly.
 */
export type ReplayLibraryStats = ReplayStorageStats;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * High-level CRUD service for stored replays. Construct via the static
 * {@link ReplayLibrary.open} method — the underlying IDB connection is
 * async, and a constructor cannot wait on it.
 *
 * Lifecycle:
 *
 *     const lib = await ReplayLibrary.open();
 *     const meta = await lib.save(replay);
 *     const list = await lib.list();
 *     const file = await lib.load(meta.id);
 *     await lib.delete(meta.id);
 *     await lib.close();
 *
 * Threading model: every method awaits a single internal `ReplayStorage`
 * instance. Concurrent saves serialise inside the backend (IDB
 * transactions, localStorage's synchronous setItem). The library itself
 * adds no extra locking.
 */
export class ReplayLibrary {
  /**
   * Open a library, choosing the best available backend. Probe order:
   *
   *   1. IndexedDB — primary, generous quota, structured-clone payloads.
   *   2. localStorage — fallback, ~5 MB synchronous string store. Used
   *      when IDB throws / refuses (private-mode Firefox, locked-down
   *      WebViews, missing-API embeddings).
   *   3. {@link MemoryReplayStorage} — in-process, non-persistent. Last
   *      resort; used by Node tests and the headless CLI.
   *
   * Returns a ready-to-use library. Throws {@link ReplayStorageError}
   * only when `prefer` was pinned to a specific backend that turned out
   * to be unavailable; otherwise the `'auto'` mode never throws — it
   * always finds *some* backend to use, even if only memory.
   */
  static async open(options: ReplayLibraryOptions = {}): Promise<ReplayLibrary> {
    const prefer = options.prefer ?? 'auto';
    const onOpen = options.onBackendOpen ?? (() => {});

    // Pinned-backend modes go straight through `openReplayStorage` and
    // surface its errors verbatim. Tests use these to drive specific
    // backends.
    if (prefer === 'memory' || prefer === 'localstorage' || prefer === 'indexeddb') {
      const storage = await openReplayStorage(options);
      onOpen({
        backend: storage.backend,
        usedFallback: false,
        fallbackReason: null,
      });
      return new ReplayLibrary(storage, false, null);
    }

    // Auto mode — try IDB first, observe whether it succeeded, fall back
    // to localStorage with a diagnostic on failure.
    let usedFallback = false;
    let fallbackReason: string | null = null;
    let storage: ReplayStorage;

    const idbFactory =
      options.indexedDBFactory ??
      (globalThis as { indexedDB?: IDBFactory }).indexedDB;

    if (idbFactory !== undefined && typeof idbFactory.open === 'function') {
      try {
        storage = await openReplayStorage({
          ...options,
          prefer: 'indexeddb',
          indexedDBFactory: idbFactory,
        });
      } catch (err) {
        usedFallback = true;
        fallbackReason = err instanceof Error ? err.message : String(err);
        storage = await ReplayLibrary.openFallback(options);
      }
    } else {
      // No IDB at all in this runtime — fall back without recording it
      // as an IDB failure (there was nothing to fail).
      storage = await ReplayLibrary.openFallback(options);
      // Distinguish "IDB missing" from "IDB threw" in the diagnostic so
      // log readers can tell whether the runtime was misconfigured.
      if (storage.backend !== 'indexeddb') {
        usedFallback = storage.backend === 'localstorage';
        if (usedFallback) {
          fallbackReason = 'IndexedDB API not present in this runtime';
        }
      }
    }

    onOpen({
      backend: storage.backend,
      usedFallback,
      fallbackReason,
    });
    return new ReplayLibrary(storage, usedFallback, fallbackReason);
  }

  /**
   * Open the next-best backend after IDB has been ruled out. Tries
   * localStorage, then memory. Never throws — memory is always available.
   */
  private static async openFallback(
    options: ReplayLibraryOptions,
  ): Promise<ReplayStorage> {
    const lsRef =
      options.localStorageRef ?? (globalThis as { localStorage?: Storage }).localStorage;
    if (lsRef !== undefined && typeof lsRef.setItem === 'function') {
      try {
        return await openReplayStorage({
          ...options,
          prefer: 'localstorage',
          localStorageRef: lsRef,
        });
      } catch {
        // Fall through to memory if localStorage construction itself
        // threw (extremely rare — the constructor only checks API
        // shape).
      }
    }
    return openReplayStorage({ ...options, prefer: 'memory' });
  }

  /** Underlying storage instance — exposed as an escape hatch for advanced callers. */
  public readonly storage: ReplayStorage;

  /**
   * `true` when the library is using a backend other than IDB *because*
   * IDB threw or was unavailable. `false` when IDB succeeded and `false`
   * when the caller pinned `prefer='memory'` / `'localstorage'`
   * explicitly.
   */
  public readonly usedFallback: boolean;

  /**
   * Diagnostic string describing why IDB was bypassed, or `null` when
   * IDB was used (or when the caller pinned a different backend).
   */
  public readonly fallbackReason: string | null;

  private closed = false;

  private constructor(
    storage: ReplayStorage,
    usedFallback: boolean,
    fallbackReason: string | null,
  ) {
    this.storage = storage;
    this.usedFallback = usedFallback;
    this.fallbackReason = fallbackReason;
  }

  /** Discriminator for HUD / logs — `'indexeddb' | 'localstorage' | 'memory'`. */
  get backend(): ReplayStorageBackend {
    return this.storage.backend;
  }

  // -------------------------------------------------------------------------
  // CRUD — the four methods named in AC 30102 Sub-AC 2
  // -------------------------------------------------------------------------

  /**
   * Persist a replay. Returns the storage-side metadata (including the
   * newly-allocated `id`). Mirrors {@link ReplayStorage.save} verbatim
   * for full feature parity.
   *
   *     const meta = await lib.save(replay);
   *     console.log(meta.id, meta.savedAt, meta.sizeBytes);
   *
   * Pre-validates the replay through the deserialiser; a malformed
   * `ReplayFile` is rejected before it touches storage.
   */
  async save(
    replay: ReplayFile,
    options?: SaveReplayOptions,
  ): Promise<StoredReplayMetadata> {
    this.assertOpen();
    return this.storage.save(replay, options);
  }

  /**
   * Load a replay by id. Returns the {@link ReplayFile} directly (or
   * `null` for a missing row) — the storage-side metadata is intentionally
   * *not* exposed here because the common case (the M4 replay player) only
   * needs the replay payload. Use {@link ReplayLibrary.loadWithMetadata}
   * for the metadata-paired form.
   *
   *     const replay = await lib.load(id);
   *     if (replay !== null) startReplayPlayback(replay);
   */
  async load(id: ReplayStorageId): Promise<ReplayFile | null> {
    this.assertOpen();
    const stored = await this.storage.load(id);
    return stored === null ? null : stored.replay;
  }

  /**
   * Load a replay by id and return both the metadata and the replay
   * payload. For the file-list+detail UI flow where the menu already has
   * the metadata row in hand and just wants the replay payload, prefer
   * {@link ReplayLibrary.load}.
   */
  async loadWithMetadata(
    id: ReplayStorageId,
  ): Promise<{ readonly metadata: StoredReplayMetadata; readonly replay: ReplayFile } | null> {
    this.assertOpen();
    return this.storage.load(id);
  }

  /**
   * Throwing variant of {@link ReplayLibrary.load}. Throws
   * {@link ReplayNotFoundError} if no row matches the id.
   *
   *     try { const replay = await lib.loadOrThrow(id); … }
   *     catch (e) { if (e instanceof ReplayNotFoundError) … }
   */
  async loadOrThrow(id: ReplayStorageId): Promise<ReplayFile> {
    this.assertOpen();
    const stored = await this.storage.loadOrThrow(id);
    return stored.replay;
  }

  /**
   * List every saved replay's metadata, newest `savedAt` first. Cheap —
   * does not load any replay's input timeline. The replay menu uses this
   * to render rows with stage / duration / notes columns.
   */
  async list(): Promise<ReadonlyArray<StoredReplayMetadata>> {
    this.assertOpen();
    return this.storage.list();
  }

  /**
   * Delete a replay by id. Returns `true` when a row was removed,
   * `false` when the row was absent. Idempotent — never throws on a
   * missing row, so the menu can dispatch a delete without a prior
   * existence check.
   */
  async delete(id: ReplayStorageId): Promise<boolean> {
    this.assertOpen();
    return this.storage.delete(id);
  }

  // -------------------------------------------------------------------------
  // Convenience — exposed for parity with the storage interface
  // -------------------------------------------------------------------------

  /** Membership check. */
  async has(id: ReplayStorageId): Promise<boolean> {
    this.assertOpen();
    return this.storage.has(id);
  }

  /**
   * Drop every saved replay. Used by the (later-AC) "Reset Replays"
   * button on the storage HUD.
   */
  async clear(): Promise<void> {
    this.assertOpen();
    return this.storage.clear();
  }

  /**
   * Aggregate storage stats — count, total bytes used, browser quota
   * (when known). Useful for the storage HUD that warns the user before
   * IDB hits the quota wall.
   */
  async getStats(): Promise<ReplayLibraryStats> {
    this.assertOpen();
    return this.storage.getStats();
  }

  /**
   * Release backend resources. Idempotent. After `close()` further CRUD
   * calls throw {@link ReplayStorageError}.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.storage.close();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new ReplayStorageError('ReplayLibrary: library is closed');
    }
  }
}

// ---------------------------------------------------------------------------
// Re-export for convenience
// ---------------------------------------------------------------------------

export { ReplayNotFoundError, ReplayStorageError } from './ReplayStorage';
