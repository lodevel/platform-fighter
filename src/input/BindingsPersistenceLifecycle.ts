/**
 * Bindings persistence lifecycle — AC 40301 Sub-AC 1.
 *
 * Purpose
 * -------
 *
 * AC 40301 calls for a single, named "persistence lifecycle" object that
 * the boot path, the rebinding UI, and (eventually) the lobby's
 * "Reset / Import / Export" affordances can all share. The lifecycle's
 * documented contract is exactly the one the Seed names word-for-word:
 *
 *   1. **Auto-save on change** — any binding mutation routed through the
 *      lifecycle flushes a fresh snapshot to `localStorage` synchronously,
 *      so a tab close *or* an `F5` refresh *or* a crash on the very next
 *      tick still preserves the just-committed binding.
 *   2. **Hydrate on game boot** — the lifecycle's `boot()` step reads any
 *      saved blob off `localStorage` and replaces every slot in the
 *      in-memory store *before* the first scene reads from it.
 *   3. **Schema versioning** — the on-disk envelope carries an explicit
 *      `schemaVersion` integer (`BINDINGS_SCHEMA_VERSION`); the lifecycle
 *      surfaces the value back to the boot path via {@link LifecycleState}
 *      so a debug HUD can render "v1" alongside the boot banner.
 *   4. **Migration fallback for invalid / legacy data** — a v0 blob saved
 *      by an earlier dev build is upgraded through the registered
 *      migration chain *before* strict validation; a genuinely-corrupt
 *      blob (bad JSON, schema-violating contents, future unknown
 *      version) falls back to the canonical defaults table without
 *      throwing. Either way the lifecycle leaves the player on a usable
 *      bindings record.
 *
 * Why this module — given that the pieces already exist
 * -----------------------------------------------------
 *
 * The four lifecycle responsibilities above are already implemented as
 * standalone modules under `src/input/`:
 *
 *   • {@link InputBindingsStore} — in-memory four-slot data model.
 *   • {@link BindingsStorage} (functions) — namespaced localStorage IO
 *     with `Result`-style error handling.
 *   • {@link BindingsMigrations} — version detection + migration chain +
 *     migration-aware deserialisers.
 *   • {@link BindingsPersistenceController} / {@link BindingsStore} —
 *     glue that pairs hydrate and save calls with an in-memory store.
 *
 * What was still missing — and what *this* module supplies — is a single
 * **named lifecycle object** with the exact AC-40301 vocabulary on it
 * (`boot`, `getBindings`, `setBinding`, `setAction`, `reset`, `resetAll`,
 * `clear`, `subscribe`, `getState`). Every existing piece is preserved
 * (this module composes them; nothing is re-implemented), so:
 *
 *   • Tests that need the bare data model still build a raw
 *     {@link InputBindingsStore}.
 *   • Code paths that prefer the controller's `Result`-style returns
 *     (per-slot saves, the import dialog) keep importing the controller
 *     directly.
 *   • The replay layer continues to bypass persistence entirely — it
 *     embeds the binding snapshot inside its own envelope so a
 *     `clear()` between recording and playback never desyncs a replay.
 *
 * What this module *adds* on top of the existing layers:
 *
 *   1. **Lifecycle state** — `getState()` exposes the four observable
 *      lifecycle outcomes (booted / hydrated-from / current schema
 *      version / last-write outcome) in one read so the boot banner
 *      and the rebinding UI's status line can render a single
 *      destructure.
 *   2. **Change subscription** — `subscribe(listener)` fires once for
 *      every successful auto-save, with the just-flushed snapshot and
 *      the typed cause (`'set' | 'set-action' | 'reset' | 'reset-all'
 *      | 'clear'`). The rebinding UI uses this to refresh its visible
 *      panels without holding the underlying store reference; tests use
 *      it to assert auto-save cadence without sniffing localStorage.
 *   3. **Single import surface** — one default export gives boot code
 *      the entire "load on enter, save on commit, clear on reset"
 *      lifecycle in one constructor + one `boot()` call.
 *   4. **Idempotent boot** — calling `boot()` twice is a deterministic
 *      re-load of the same blob, useful for hot-reload paths and tests
 *      that inject a different storage mid-session.
 *
 * Determinism
 * -----------
 *
 *   • The lifecycle is a pure conduit between the inner store and the
 *     IO layer. It never reads `Date.now()` or `Math.random()`, never
 *     instantiates Phaser, never queues a timer. Two identical lifecycle
 *     instances running through the same operations against the same
 *     storage produce byte-identical blobs.
 *   • Auto-save is synchronous — the write returns once both the
 *     in-memory mutation *and* the storage flush have completed (or
 *     failed deterministically). A test that writes, awaits the
 *     subscriber callback, and re-boots a fresh lifecycle observes the
 *     same snapshot.
 *   • Storage failures (quota, private mode, unavailable) do not unwind
 *     the in-memory write — the player's session keeps the new binding
 *     and the typed error surfaces through the `errorListener`. Better
 *     the layout survives the session than the failure does (mirrors
 *     {@link BindingsPersistenceController.resetAll} policy).
 *
 * Strict TypeScript
 * -----------------
 *
 * The codebase compiles under `strict + noUncheckedIndexedAccess`. Every
 * accessor is keyed by {@link PlayerBindingsIndex} and {@link LogicalAction},
 * so a mistyped slot index or action name is a compile error. The
 * lifecycle's `WriteResult` re-exports the storage-layer's
 * {@link DetailedStorageResult<void>} so callers that already import the
 * IO vocabulary can branch on `code` without an extra union.
 */

import {
  BindingsPersistenceController,
  type BindingsPersistenceErrorListener,
  type HydrateResult,
} from './BindingsPersistenceController';
import {
  CURRENT_BINDINGS_SCHEMA_VERSION,
  MIN_MIGRATABLE_BINDINGS_VERSION,
} from './BindingsMigrations';
import { BINDINGS_SCHEMA_VERSION } from './InputBindingsSerializer';
import type {
  DetailedStorageResult,
  StorageLike,
  StorageErrorCode,
} from './BindingsStorage';
import {
  DEFAULT_PLAYER_BINDINGS,
  InputBindingsStore,
  type InputBindingsStoreOptions,
} from './InputBindingsStore';
import type {
  InputBinding,
  LogicalAction,
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Discriminator naming *which* mutation triggered an auto-save. Surfaced
 * to {@link BindingsLifecycleListener} so a UI can render different
 * affordances ("Saved your jump key" vs "Reset to defaults") without
 * inspecting the snapshot.
 */
export type LifecycleChangeCause =
  | 'set' //          replace one slot's full PlayerBindings via setBinding
  | 'set-action' //   replace one slot's single action via setAction
  | 'reset' //        revert one slot to its default
  | 'reset-action' // revert one slot's single action to its default
  | 'reset-all' //    revert every slot to defaults
  | 'clear' //        wipe the in-memory store *and* the persisted blob
  | 'manual-save'; // explicit save() call (no in-memory mutation)

/**
 * Event payload delivered to subscribers after a successful auto-save.
 * Includes the typed cause, the just-flushed snapshot, and the slot the
 * mutation targeted (`null` for whole-snapshot operations like
 * `reset-all` / `clear` / `manual-save`).
 */
export interface BindingsLifecycleChangeEvent {
  readonly cause: LifecycleChangeCause;
  readonly slot: PlayerBindingsIndex | null;
  readonly snapshot: Readonly<Record<PlayerBindingsIndex, PlayerBindings>>;
}

/** Subscriber callback shape; see {@link BindingsLifecycleChangeEvent}. */
export type BindingsLifecycleListener = (event: BindingsLifecycleChangeEvent) => void;

/** Unsubscribe handle returned by {@link BindingsPersistenceLifecycle.subscribe}. */
export type BindingsLifecycleUnsubscribe = () => void;

/**
 * Source description for the most recent hydrate. Mirrors the underlying
 * {@link HydrateResult} discriminator so a UI can render:
 *
 *   • `'storage'`   — loaded directly off the saved blob.
 *   • `'defaults'`  — fell back to defaults; `fallbackReason` explains why.
 */
export type LifecycleHydrateSource = 'storage' | 'defaults';

/**
 * Snapshot of every observable lifecycle outcome. Returned from
 * {@link BindingsPersistenceLifecycle.getState} as a single read so the
 * boot banner and the rebinding UI's status footer can render with one
 * destructure.
 *
 * `null` fields name "we haven't reached this lifecycle stage yet":
 *
 *   • `bootedAt === null`  — boot() has not been called yet.
 *   • `hydrateSource === null` — boot() not called.
 *   • `lastChange === null` — no write has happened since boot.
 *   • `lastError === null`  — no controller-mediated error has fired.
 */
export interface LifecycleState {
  /** Schema version this build *writes* (pinned to {@link BINDINGS_SCHEMA_VERSION}). */
  readonly schemaVersion: number;
  /** Oldest schema version this build can migrate forward. */
  readonly minMigratableVersion: number;
  /** True once {@link BindingsPersistenceLifecycle.boot} has run. */
  readonly booted: boolean;
  /**
   * Did the most recent boot() apply the persisted snapshot or fall back
   * to defaults? `null` until boot() has been called.
   */
  readonly hydrateSource: LifecycleHydrateSource | null;
  /**
   * If the boot fell back to defaults, the typed reason — useful for
   * "Couldn't load your saved controls" toasts in the rebinding UI.
   */
  readonly hydrateFallbackReason: StorageErrorCode | null;
  /** Most recent change event, or `null` if no write has happened since boot. */
  readonly lastChange: BindingsLifecycleChangeEvent | null;
  /** Most recent controller-mediated error, or `null`. */
  readonly lastError:
    | { readonly stage: string; readonly code: StorageErrorCode; readonly error: string }
    | null;
}

/**
 * Re-export of {@link DetailedStorageResult<void>} so callers that branch
 * on `code` don't have to import from the IO module directly.
 */
export type WriteResult = DetailedStorageResult<void>;

/** Constructor options for {@link BindingsPersistenceLifecycle}. */
export interface BindingsPersistenceLifecycleOptions {
  /**
   * Per-slot overrides forwarded to the inner {@link InputBindingsStore}.
   * Applied *before* any hydrate, so a successful hydrate replaces them.
   * Used by tests to seed a deterministic in-memory state independent of
   * `localStorage`.
   */
  readonly overrides?: InputBindingsStoreOptions['overrides'];

  /**
   * Storage backing for persistence:
   *   • `undefined` (default) — use ambient `globalThis.localStorage`.
   *   • `null` — opt out of persistence; auto-save becomes a deterministic
   *     no-op returning `{ ok: false, code: 'unavailable' }`. Useful for
   *     headless tests / replays.
   *   • a {@link StorageLike} — explicit injection (in-memory test
   *     double, IndexedDB shim, etc.).
   */
  readonly storage?: StorageLike | null;

  /**
   * If `true`, the constructor calls `boot()` immediately. The result is
   * captured on {@link LifecycleState.hydrateSource}, exactly as if the
   * caller had built the lifecycle and then called `boot()` themselves.
   *
   * Defaults to `false` so existing tests can build a lifecycle without
   * triggering an IO call. The boot path opts in explicitly via
   * {@link createBootedLifecycle}.
   */
  readonly bootOnConstruct?: boolean;

  /**
   * Optional sink for typed persistence errors. Per the controller's
   * policy, `unavailable` is *not* forwarded (boot in a sandboxed iframe
   * is a normal condition, not an error worth surfacing to the player).
   */
  readonly errorListener?: BindingsPersistenceErrorListener;
}

// ---------------------------------------------------------------------------
// Lifecycle class
// ---------------------------------------------------------------------------

/**
 * Single-object front door to the M5 bindings persistence stack.
 *
 * Lifecycle:
 *
 *     // Boot path (BootScene):
 *     const lifecycle = new BindingsPersistenceLifecycle();
 *     lifecycle.boot();           // hydrate from localStorage with migration
 *     this.registry.set('lifecycle', lifecycle);
 *
 *     // Rebinding UI (RebindingScene):
 *     const lifecycle = registry.get('lifecycle');
 *     lifecycle.subscribe((evt) => screen.repaint(evt.snapshot));
 *     lifecycle.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: 32 }]);
 *
 *     // "Reset all controls" button:
 *     lifecycle.clear();          // store + storage both wiped
 *
 * Every write call mutates the in-memory four-slot table *and* flushes
 * the canonical snapshot to storage *and* invokes every subscriber. The
 * three steps happen in that order; if storage IO fails the in-memory
 * mutation and the subscriber call still happen so the UI can repaint
 * the player's just-typed binding even if the disk write was rejected.
 */
export class BindingsPersistenceLifecycle {
  private readonly innerStore: InputBindingsStore;
  private readonly controller: BindingsPersistenceController;
  private readonly listeners: Set<BindingsLifecycleListener> = new Set();

  private booted = false;
  private hydrateSource: LifecycleHydrateSource | null = null;
  private hydrateFallbackReason: StorageErrorCode | null = null;
  private lastChange: BindingsLifecycleChangeEvent | null = null;
  private lastError:
    | { readonly stage: string; readonly code: StorageErrorCode; readonly error: string }
    | null = null;

  constructor(options: BindingsPersistenceLifecycleOptions = {}) {
    this.innerStore = new InputBindingsStore({ overrides: options.overrides });
    this.controller = new BindingsPersistenceController({
      store: this.innerStore,
      storage: options.storage,
      // Wrap the caller's listener so this module can also record the
      // last-error state for `getState()` consumers, regardless of
      // whether the caller supplied a listener of their own.
      errorListener: (event) => {
        this.lastError = event;
        if (options.errorListener !== undefined) {
          options.errorListener(event);
        }
      },
    });
    if (options.bootOnConstruct === true) {
      this.boot();
    }
  }

  // -------------------------------------------------------------------------
  // Boot — hydrate-on-game-boot
  // -------------------------------------------------------------------------

  /**
   * Read the persisted snapshot (if any) and apply it to every slot.
   *
   * The migration framework upgrades any blob in
   * `[MIN_MIGRATABLE_BINDINGS_VERSION, CURRENT_BINDINGS_SCHEMA_VERSION]`
   * to today's schema *before* strict validation runs, so a v0 blob
   * saved by a previous build loads under today's contract. Genuinely-
   * corrupt blobs (bad JSON, schema violations, unknown future versions)
   * fall back to {@link DEFAULT_PLAYER_BINDINGS} with a typed
   * `fallbackReason` recorded on {@link getState}.
   *
   * Always returns a usable lifecycle — never throws. Idempotent: calling
   * it twice is a deterministic re-load of whatever is currently in
   * storage (useful for hot-reload paths and tests that inject a
   * different storage mid-session).
   */
  boot(): HydrateResult {
    const result = this.controller.hydrate();
    this.booted = true;
    this.hydrateSource = result.source;
    this.hydrateFallbackReason =
      result.source === 'defaults' ? result.fallbackReason : null;
    return result;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** Return the current binding profile for a slot. The result is deeply frozen. */
  getBindings(slot: PlayerBindingsIndex): PlayerBindings {
    return this.innerStore.get(slot);
  }

  /** Read a single action's binding list for a slot. */
  getAction(slot: PlayerBindingsIndex, action: LogicalAction): ReadonlyArray<InputBinding> {
    return this.innerStore.getAction(slot, action);
  }

  /** Default {@link PlayerBindings} for a slot — what `reset(slot)` would restore. */
  getDefault(slot: PlayerBindingsIndex): PlayerBindings {
    return this.innerStore.getDefault(slot);
  }

  /** Frozen snapshot of every slot's bindings — single-call full read. */
  snapshot(): Readonly<Record<PlayerBindingsIndex, PlayerBindings>> {
    return this.innerStore.snapshot();
  }

  /**
   * Single read of every observable lifecycle outcome — the AC-named
   * surface a debug HUD or boot banner uses to render lifecycle status
   * without holding individual references to each piece.
   */
  getState(): LifecycleState {
    return Object.freeze({
      schemaVersion: BINDINGS_SCHEMA_VERSION,
      minMigratableVersion: MIN_MIGRATABLE_BINDINGS_VERSION,
      booted: this.booted,
      hydrateSource: this.hydrateSource,
      hydrateFallbackReason: this.hydrateFallbackReason,
      lastChange: this.lastChange,
      lastError: this.lastError,
    });
  }

  /**
   * Escape hatch for callers that need the raw inner
   * {@link InputBindingsStore} — the device input dispatcher reads
   * directly from it via the `PlayerBindingsProvider` interface and
   * doesn't need auto-save on its own reads.
   */
  getStore(): InputBindingsStore {
    return this.innerStore;
  }

  /**
   * Escape hatch for the per-slot save flow used by import dialogs and
   * the rebinding UI's "Apply just this player" button.
   */
  getController(): BindingsPersistenceController {
    return this.controller;
  }

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  /**
   * Register a listener fired on every successful auto-save.
   *
   * Listeners receive the just-flushed snapshot and the typed cause; the
   * rebinding UI uses this to repaint the visible panels without having
   * to hold the inner store reference. Returns an unsubscribe handle.
   *
   * Listener exceptions are caught and logged to `console.error` so a
   * buggy subscriber cannot break the lifecycle's own state machine;
   * the rest of the subscriber set still fires for the same event.
   */
  subscribe(listener: BindingsLifecycleListener): BindingsLifecycleUnsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // -------------------------------------------------------------------------
  // Writes — auto-persist
  // -------------------------------------------------------------------------

  /**
   * Replace a slot's full binding profile, flush the snapshot, and emit
   * a `'set'` change event. The supplied `bindings.playerIndex` must
   * equal `slot` — mismatch throws (same policy as the inner store)
   * before any persistence occurs.
   */
  setBinding(slot: PlayerBindingsIndex, bindings: PlayerBindings): WriteResult {
    this.innerStore.set(slot, bindings);
    const result = this.controller.saveAll();
    this.recordChange('set', slot);
    return result;
  }

  /**
   * Replace a single action's binding list, flush the snapshot, and emit
   * a `'set-action'` change event. The rebinding UI's main write path —
   * every committed capture lands here.
   */
  setAction(
    slot: PlayerBindingsIndex,
    action: LogicalAction,
    bindings: ReadonlyArray<InputBinding>,
  ): WriteResult {
    this.innerStore.setAction(slot, action, bindings);
    const result = this.controller.saveAll();
    this.recordChange('set-action', slot);
    return result;
  }

  // -------------------------------------------------------------------------
  // Resets — auto-persist
  // -------------------------------------------------------------------------

  /**
   * Reset a single slot to its default {@link PlayerBindings}, flush the
   * snapshot, and emit a `'reset'` change event. The persisted blob is
   * rewritten (not deleted) so the three other slots' customisations
   * survive.
   */
  reset(slot: PlayerBindingsIndex): WriteResult {
    this.innerStore.reset(slot);
    const result = this.controller.saveAll();
    this.recordChange('reset', slot);
    return result;
  }

  /**
   * Reset a single action on a single slot to its default, flush the
   * snapshot, and emit a `'reset-action'` change event. The rebinding
   * UI uses this to back out of a partial rebind.
   */
  resetAction(slot: PlayerBindingsIndex, action: LogicalAction): WriteResult {
    this.innerStore.resetAction(slot, action);
    const result = this.controller.saveAll();
    this.recordChange('reset-action', slot);
    return result;
  }

  /**
   * Reset every slot to its default *and* re-save the snapshot (so the
   * persisted blob matches the in-memory defaults). Emits a `'reset-all'`
   * change event.
   *
   * Note: distinct from {@link clear}, which *removes* the persisted
   * keys entirely. Reset-all leaves a `defaults`-shaped blob on disk;
   * clear leaves the keys absent, so the next boot's hydrate falls back
   * via the `'missing'` path instead of the `'storage'` path. Both leave
   * the in-memory store on defaults.
   */
  resetAll(): WriteResult {
    this.innerStore.resetAll();
    const result = this.controller.saveAll();
    this.recordChange('reset-all', null);
    return result;
  }

  /**
   * Reset every slot to its default *and* clear the persisted blobs.
   * The settings UI's "Reset all controls" affordance: a player who
   * clicks it should not see their old layout reappear after a refresh.
   *
   * Delegates to {@link BindingsPersistenceController.resetAll}, which
   * resets the in-memory state first so a transient `removeItem` failure
   * still leaves the player on defaults in-memory.
   */
  clear(): WriteResult {
    const result = this.controller.resetAll();
    this.recordChange('clear', null);
    return result;
  }

  /**
   * Persist the current four-slot snapshot to storage *without* mutating
   * the in-memory state. Useful for callers that mutated the inner store
   * directly via {@link getStore} and want the lifecycle to flush the
   * resulting state. Emits a `'manual-save'` change event so subscribers
   * can repaint.
   */
  save(): WriteResult {
    const result = this.controller.saveAll();
    this.recordChange('manual-save', null);
    return result;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private recordChange(cause: LifecycleChangeCause, slot: PlayerBindingsIndex | null): void {
    const event: BindingsLifecycleChangeEvent = Object.freeze({
      cause,
      slot,
      snapshot: this.innerStore.snapshot(),
    });
    this.lastChange = event;
    if (this.listeners.size === 0) return;
    // Iterate a defensive copy so a listener that calls `subscribe` /
    // `unsubscribe` from inside its own callback doesn't disturb the
    // current dispatch loop.
    const snapshot = Array.from(this.listeners);
    for (const listener of snapshot) {
      try {
        listener(event);
      } catch (err) {
        // A buggy subscriber must not break the lifecycle's own state
        // machine — log to console.error and continue dispatching to
        // downstream listeners for the same event. We log instead of
        // re-throwing because the throw would either break the caller
        // (the rebinding UI's commit path) or produce an unhandled
        // promise rejection if we deferred via queueMicrotask, both of
        // which are worse than a console.error in DevTools.
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error(
          `BindingsPersistenceLifecycle: subscriber threw on '${event.cause}' event — ${msg}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

/**
 * Build a {@link BindingsPersistenceLifecycle} that has already booted.
 *
 * Equivalent to
 * `new BindingsPersistenceLifecycle({ ...options, bootOnConstruct: true })`
 * — but exposes the resolved {@link HydrateResult} alongside the
 * lifecycle so the boot path can branch on `source` in a single
 * destructuring:
 *
 *     const { lifecycle, hydrate } = createBootedLifecycle();
 *     console.info(`bindings=${hydrate.source}`);
 *     this.registry.set('bindingsLifecycle', lifecycle);
 *
 * Always returns a usable lifecycle; never throws. On any hydrate failure
 * the lifecycle is left on its in-memory defaults and the failure code
 * surfaces through {@link LifecycleState.hydrateFallbackReason}.
 */
export function createBootedLifecycle(
  options: BindingsPersistenceLifecycleOptions = {},
): {
  readonly lifecycle: BindingsPersistenceLifecycle;
  readonly hydrate: HydrateResult;
} {
  const lifecycle = new BindingsPersistenceLifecycle(options);
  const hydrate = lifecycle.boot();
  return { lifecycle, hydrate };
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

/**
 * Schema version the lifecycle writes. Re-exported so callers that only
 * import this module can render "v1" in their boot banner without
 * pulling the migration framework in.
 */
export {
  BINDINGS_SCHEMA_VERSION,
  CURRENT_BINDINGS_SCHEMA_VERSION,
  MIN_MIGRATABLE_BINDINGS_VERSION,
};

/**
 * Re-exported defaults so callers that only import this lifecycle module
 * can render a "Reset to Default → these bindings" preview without
 * pulling the inner store module in.
 */
export { DEFAULT_PLAYER_BINDINGS };
