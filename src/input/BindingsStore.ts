/**
 * Unified bindings store facade — AC 40003 Sub-AC 3.
 *
 * Purpose
 * -------
 *
 * Earlier sub-ACs landed each layer of the M5 rebinding stack as a
 * standalone module:
 *
 *   • {@link InputBindingsStore} — the in-memory four-slot data model
 *     (get / set / reset of typed {@link PlayerBindings} values).
 *   • {@link BindingsStorage}-functions — the namespaced, versioned,
 *     `Result`-shaped IO layer over `localStorage`.
 *   • {@link BindingsMigrations} — the schema-version migration pipeline
 *     used by every load path.
 *   • {@link BindingsPersistenceController} — the controller-shape glue
 *     a scene wires up once to get hydrate / save / reset behaviour.
 *
 * Each of those layers exists for a reason — the data model must remain
 * IO-free and replay-deterministic; the IO layer must remain DOM-free
 * and test-injectable; the controller must keep its `Result`-style error
 * surface so settings UIs can render typed toasts. But the *consumer*
 * surface is busy: the rebinding screen, the lobby, the boot path, and
 * the per-scene wiring code each have to import three or four modules,
 * remember to call `controller.saveAll()` after every store mutation,
 * and route every `setAction` through the right boundary so the
 * persisted blob stays in lockstep with the in-memory state.
 *
 * `BindingsStore` is the **single facade** that collapses that surface
 * into one object with the get / set / reset vocabulary the Seed and the
 * AC ask for — for all four player profiles, with persistence applied
 * automatically on every write. The underlying split-layer design is
 * preserved (this module composes the existing pieces; nothing is
 * re-implemented), so:
 *
 *   • Tests that need the bare data model still build a raw
 *     {@link InputBindingsStore} and skip persistence entirely.
 *   • Code paths that prefer the controller's explicit `saveAll()`
 *     return value (the rebinding UI's bulk "Apply" button, for
 *     instance) keep importing {@link BindingsPersistenceController}
 *     directly.
 *   • The replay layer — which deliberately bypasses persistence so a
 *     `resetAll` between recording and playback can never desync — keeps
 *     reading from the inner {@link InputBindingsStore}.
 *
 * What this module *adds* on top of the existing layers:
 *
 *   1. **Auto-persist on writes** — `set` / `setAction` / `reset` /
 *      `resetAction` each apply the change to the in-memory store *and*
 *      flush a snapshot to storage in one call. The rebinding UI no
 *      longer has to remember to call `saveAll()` after each capture.
 *
 *   2. **Single import surface** — one `BindingsStore` object exposes
 *      the get / set / reset / snapshot / hydrate vocabulary the AC
 *      describes. Everything else is internal.
 *
 *   3. **Hydrate at construction (opt-in)** — the
 *      {@link BindingsStoreOptions.hydrateOnConstruct} flag turns the
 *      "build store + build controller + call hydrate" boot dance into
 *      a single `new BindingsStore({ hydrateOnConstruct: true })`. The
 *      result of the hydrate is captured on the instance so the boot
 *      path can branch on `bindings.lastHydrate?.source` instead of
 *      threading a return value.
 *
 *   4. **Idempotent reads** — `get` returns the deeply-frozen
 *      {@link PlayerBindings} value the inner store keeps; callers
 *      cannot mutate the store from the outside even by accident.
 *
 * Determinism
 * -----------
 *
 *   • The facade is a pure conduit. It never reads `Date.now()` or
 *     `Math.random()`; it never instantiates Phaser; it never queues a
 *     timer.
 *   • Auto-persist is synchronous — every write returns once both the
 *     in-memory mutation *and* the storage flush have completed (or
 *     failed deterministically). A test that writes through the facade
 *     and then re-hydrates a fresh facade off the same storage observes
 *     the same snapshot.
 *   • Storage failures (quota, private mode, unavailable) do *not*
 *     unwind the in-memory write — the player's session keeps the new
 *     binding, and the typed error surfaces through the optional
 *     `errorListener`. Better the layout survives the session than the
 *     failure does (same policy as
 *     {@link BindingsPersistenceController.resetAll}).
 *
 * Strict TypeScript
 * -----------------
 *
 * The codebase compiles under `strict + noUncheckedIndexedAccess`. The
 * facade re-uses the inner store's strict typings — every accessor is
 * keyed by {@link PlayerBindingsIndex} and {@link LogicalAction}, so a
 * mistyped slot index or action name is a compile error rather than a
 * silent runtime fall-through. Persistence calls return the underlying
 * {@link DetailedStorageResult<void>} so the rebinding UI can branch
 * on `code` for `quota` / `private-mode` / `corrupted` failures.
 */

import {
  BindingsPersistenceController,
  type BindingsPersistenceErrorListener,
  type HydrateResult,
} from './BindingsPersistenceController';
import type { DetailedStorageResult, StorageLike } from './BindingsStorage';
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
// Options + result shapes
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link BindingsStore}.
 *
 * All fields are optional — `new BindingsStore()` builds a store seeded
 * from {@link DEFAULT_PLAYER_BINDINGS}, backed by the ambient
 * `globalThis.localStorage` if present, with no error listener and no
 * boot-time hydrate.
 */
export interface BindingsStoreOptions {
  /**
   * Per-slot overrides forwarded verbatim to the inner
   * {@link InputBindingsStore}. Any slot not supplied falls back to its
   * default; an invalid table throws eagerly from the constructor (same
   * policy as {@link InputBindingsStoreOptions.overrides}).
   *
   * Overrides are applied **before** any hydrate, so a hydrate that
   * succeeds will replace these values. The override path is intended
   * for tests that need a deterministic starting state independent of
   * `localStorage`.
   */
  readonly overrides?: InputBindingsStoreOptions['overrides'];

  /**
   * Storage backing for persistence. See
   * {@link BindingsPersistenceControllerOptions.storage} for the
   * resolution policy:
   *   • `undefined` (default) — use ambient `globalThis.localStorage`.
   *   • `null` — opt out of persistence entirely; auto-persist becomes a
   *     deterministic no-op. Useful for headless tests / replays.
   *   • a {@link StorageLike} — explicit injection (in-memory test
   *     double, IndexedDB shim, etc.).
   */
  readonly storage?: StorageLike | null;

  /**
   * If `true`, the constructor calls `hydrate()` immediately after
   * constructing the inner store. The hydrate result is captured on
   * {@link BindingsStore.lastHydrate} so the boot path can render
   * "Loaded saved bindings" vs. "Starting from defaults" without
   * threading the return value through the construction call site.
   *
   * Defaults to `false` so existing callers (and tests) get the
   * pre-hydrate behaviour by default; the boot path opts in explicitly.
   */
  readonly hydrateOnConstruct?: boolean;

  /**
   * Optional sink for typed persistence errors — see
   * {@link BindingsPersistenceErrorListener}. The facade forwards every
   * controller-mediated error to this callback if supplied. Per the
   * controller's policy, `unavailable` is *not* forwarded (boot in a
   * sandboxed iframe is a normal condition, not an error worth
   * surfacing to the player).
   */
  readonly errorListener?: BindingsPersistenceErrorListener;
}

/**
 * The auto-persist write APIs return a `WriteResult` so callers that
 * care about a `quota` / `corrupted` failure can branch on the cause.
 * The in-memory mutation has already been applied by the time the
 * result returns, regardless of the storage outcome.
 *
 * Aliased to {@link DetailedStorageResult<void>} so a caller that
 * already imports the storage layer's result vocabulary can compare
 * codes without an extra union.
 */
export type WriteResult = DetailedStorageResult<void>;

// ---------------------------------------------------------------------------
// Facade
// ---------------------------------------------------------------------------

/**
 * Unified front door to the M5 bindings stack.
 *
 * Lifecycle:
 *
 *     // Boot path: load saved bindings before any scene reads them.
 *     const bindings = new BindingsStore({ hydrateOnConstruct: true });
 *     // Anywhere downstream:
 *     const p1 = bindings.get(1);
 *     bindings.setAction(3, 'jump', [{ kind: 'gamepad', ... }]);
 *     bindings.reset(2);
 *     bindings.resetAll();
 *
 * Each write call mutates the in-memory four-slot table *and* flushes
 * the canonical snapshot to storage. Failures are deterministic: an
 * `unavailable` storage simply skips the IO, the in-memory write
 * succeeds, and the call returns `{ ok: false, code: 'unavailable' }`.
 * Subscribers to {@link BindingsStoreOptions.errorListener} see only
 * codes worth surfacing to the player (see the controller for the full
 * policy).
 */
export class BindingsStore {
  private readonly inner: InputBindingsStore;
  private readonly controller: BindingsPersistenceController;
  /**
   * Result of the most recent {@link hydrate} call. `null` until the
   * first hydrate happens. The boot path reads this to render an
   * "Loaded saved bindings" / "Starting from defaults" affordance
   * without re-running the load.
   */
  public lastHydrate: HydrateResult | null = null;

  constructor(options: BindingsStoreOptions = {}) {
    this.inner = new InputBindingsStore({ overrides: options.overrides });
    this.controller = new BindingsPersistenceController({
      store: this.inner,
      storage: options.storage,
      errorListener: options.errorListener,
    });
    if (options.hydrateOnConstruct === true) {
      this.lastHydrate = this.controller.hydrate();
    }
  }

  // -------------------------------------------------------------------------
  // Persistence lifecycle
  // -------------------------------------------------------------------------

  /**
   * Read the persisted snapshot (if any) and apply it to every slot.
   *
   * Always leaves the facade in a usable state — never throws. On any
   * failure the in-memory store is left untouched (the caller sees a
   * `source: 'defaults'` result with a typed `fallbackReason`).
   *
   * The boot path can either set
   * {@link BindingsStoreOptions.hydrateOnConstruct} to `true` and read
   * {@link lastHydrate}, or call this explicitly. Calling more than
   * once is harmless — each call is a deterministic re-application of
   * the current persisted blob.
   */
  hydrate(): HydrateResult {
    this.lastHydrate = this.controller.hydrate();
    return this.lastHydrate;
  }

  /**
   * Persist the current four-slot snapshot to storage.
   *
   * The auto-persist write APIs already flush after every mutation; this
   * method is exposed for callers that want to flush *without* mutating
   * (e.g. after a programmatic reconciliation that mutates the inner
   * store directly via {@link getRawStore}). It mirrors
   * {@link BindingsPersistenceController.saveAll}.
   */
  save(): WriteResult {
    return this.controller.saveAll();
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * Get a player's current binding profile. The returned value is
   * deeply frozen — attempts to mutate it throw in strict mode and
   * silently no-op otherwise. To change a binding, call {@link set} or
   * {@link setAction}.
   */
  get(slot: PlayerBindingsIndex): PlayerBindings {
    return this.inner.get(slot);
  }

  /**
   * Read a single action's binding list for a slot. Convenience for the
   * rebinding UI's per-row render path.
   */
  getAction(slot: PlayerBindingsIndex, action: LogicalAction): ReadonlyArray<InputBinding> {
    return this.inner.getAction(slot, action);
  }

  /**
   * Default {@link PlayerBindings} for a slot — what `reset(slot)` would
   * restore. Useful for "Reset to Default" preview tiles in the
   * rebinding UI.
   */
  getDefault(slot: PlayerBindingsIndex): PlayerBindings {
    return this.inner.getDefault(slot);
  }

  /**
   * Frozen snapshot of every slot's bindings — used by the settings
   * boot path to compare against {@link DEFAULT_PLAYER_BINDINGS} for
   * the "is anything customised?" affordance, and by tests to inspect
   * the full state in a single comparison.
   */
  snapshot(): Readonly<Record<PlayerBindingsIndex, PlayerBindings>> {
    return this.inner.snapshot();
  }

  /**
   * Escape hatch for the rare consumer that needs the raw inner
   * {@link InputBindingsStore} (currently: the device input dispatcher,
   * which already holds a `PlayerBindingsProvider` interface and does
   * not auto-persist on its own reads). Returning the inner instance
   * keeps the dispatcher's existing wiring intact while letting the
   * facade own the persistence policy.
   */
  getRawStore(): InputBindingsStore {
    return this.inner;
  }

  /**
   * Escape hatch for callers that need direct access to the
   * {@link BindingsPersistenceController} — e.g. the rebinding UI's
   * per-slot save flow, which prefers the controller's per-slot
   * `saveSlot` over the facade's full-snapshot flush. Returning the
   * inner controller keeps the existing scene wiring valid without
   * forcing every call site through the facade.
   */
  getPersistenceController(): BindingsPersistenceController {
    return this.controller;
  }

  // -------------------------------------------------------------------------
  // Writes — auto-persist
  // -------------------------------------------------------------------------

  /**
   * Replace a slot's full binding profile and flush the snapshot.
   *
   * The supplied object is validated, deep-cloned, and frozen by the
   * inner store before storage; the canonical serializer then writes a
   * byte-stable blob to `localStorage`.
   *
   * The `playerIndex` field on the supplied {@link PlayerBindings}
   * **must** equal `slot` — mismatch throws (same policy as the inner
   * store) before any persistence occurs, so a copy/paste of the wrong
   * payload can't silently corrupt the saved snapshot.
   */
  set(slot: PlayerBindingsIndex, bindings: PlayerBindings): WriteResult {
    this.inner.set(slot, bindings);
    return this.controller.saveAll();
  }

  /**
   * Replace the binding list for a single action and flush the
   * snapshot. The rebinding UI's main write path — every committed
   * capture lands here.
   */
  setAction(
    slot: PlayerBindingsIndex,
    action: LogicalAction,
    bindings: ReadonlyArray<InputBinding>,
  ): WriteResult {
    this.inner.setAction(slot, action, bindings);
    return this.controller.saveAll();
  }

  // -------------------------------------------------------------------------
  // Resets — auto-persist
  // -------------------------------------------------------------------------

  /**
   * Reset a single slot to its default {@link PlayerBindings} and flush
   * the snapshot. The persisted blob is rewritten (not deleted) so the
   * three other slots' customisations survive.
   */
  reset(slot: PlayerBindingsIndex): WriteResult {
    this.inner.reset(slot);
    return this.controller.saveAll();
  }

  /**
   * Reset a single action on a single slot to its default, leaving the
   * other actions on that slot (and every other slot) untouched. The
   * rebinding UI uses this to back out of a partial rebind.
   */
  resetAction(slot: PlayerBindingsIndex, action: LogicalAction): WriteResult {
    this.inner.resetAction(slot, action);
    return this.controller.saveAll();
  }

  /**
   * Reset every slot to its default *and* clear the persisted blobs.
   *
   * Delegates to {@link BindingsPersistenceController.resetAll}, which
   * resets the in-memory state first so a `removeItem` failure still
   * leaves the player on defaults in-memory — better the layout
   * survives the session than the failure does.
   */
  resetAll(): WriteResult {
    return this.controller.resetAll();
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

/**
 * Build a {@link BindingsStore} hydrated from storage in one call.
 *
 * Equivalent to
 * `new BindingsStore({ ...options, hydrateOnConstruct: true })` — but
 * exposes the {@link HydrateResult} alongside the store so the boot
 * path can branch on `source` in a single destructuring without having
 * to read `lastHydrate` afterwards.
 *
 * Always returns a usable store; never throws. On any hydrate failure
 * the store is left on its in-memory defaults and the failure code is
 * surfaced through the result.
 */
export function createBindingsStore(
  options: BindingsStoreOptions = {},
): {
  readonly store: BindingsStore;
  readonly hydrate: HydrateResult;
} {
  const store = new BindingsStore({ ...options, hydrateOnConstruct: true });
  // `hydrateOnConstruct: true` guarantees `lastHydrate` is non-null.
  /* istanbul ignore next — invariant from the constructor branch above. */
  if (store.lastHydrate === null) {
    throw new Error(
      'BindingsStore: createBindingsStore invariant violated — hydrateOnConstruct did not record a result.',
    );
  }
  return { store, hydrate: store.lastHydrate };
}

/**
 * Re-exported defaults so callers that only import this facade can
 * still render a "Reset to Default → these bindings" preview without
 * also importing {@link InputBindingsStore}.
 */
export { DEFAULT_PLAYER_BINDINGS };
