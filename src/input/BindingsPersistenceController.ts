/**
 * Bindings persistence controller — AC 5 Sub-AC 4.
 *
 * Purpose
 * -------
 *
 * Sub-AC 1 (`InputBindingsStore`) supplied the in-memory four-slot
 * source of truth. Sub-AC 2 (`BindingsStorage`) supplied the
 * `localStorage` IO primitives — namespaced keys, versioned envelopes,
 * `Result`-shaped error returns, defaults-fallback helpers. Sub-AC 3
 * (`BindingsMigrations`) supplied the upgrade pipeline that turns a
 * legacy blob into today's schema.
 *
 * What was still missing — and what this module supplies — is the
 * **glue** that makes localStorage persistence actually *work* for the
 * player:
 *
 *   • A boot-time hydrate step that reads any saved bindings off
 *     `localStorage` and seeds the store *before* any scene reads it,
 *     so `MatchScene` and `RebindingScene` immediately see the player's
 *     last-saved layout instead of always starting from defaults.
 *
 *   • A "save on commit" hook the rebinding UI uses after every
 *     successful capture so a single rebound key survives an
 *     accidental tab close — no explicit "Apply" button required.
 *
 *   • A "Reset to defaults" action that clears both the in-memory store
 *     *and* the persisted blob in one call, so a player who runs
 *     `Reset All` doesn't see their old layout reappear after a refresh.
 *
 *   • A clean `errorListener` callback so the UI can surface a toast on
 *     `quota` / `private mode` write failures without each call site
 *     having to inspect the `DetailedStorageResult` shape.
 *
 * Why a controller (and not an event hook on the store)
 * -----------------------------------------------------
 *
 *   • The store is a deliberately dumb data container — it doesn't
 *     emit events, it doesn't know about IO, it doesn't pull in
 *     `localStorage`. That keeps it test-trivial and replay-deterministic.
 *     Wrapping it in an opt-in controller keeps that boundary intact:
 *     gameplay code that doesn't want autosave (e.g. tests) just uses
 *     the store directly.
 *
 *   • Save calls are *explicit* — the controller's `saveAll()` is a
 *     one-liner the rebinding scene calls after each commit. Autosave
 *     by hidden subscription would either over-save (write on every
 *     read of `setAction`) or under-save (forget when reset is called).
 *     Explicit calls keep the policy where the policy lives.
 *
 *   • The controller composes the migration-aware load helper, the
 *     save helper, and the clear helper into a single object the
 *     scene wires up once and forgets about. Without it every scene
 *     would re-implement the "load on enter, save on commit, clear on
 *     reset" tri-fold by hand.
 *
 * Determinism
 * -----------
 *
 *   • The controller is a pure conduit between the store and the IO
 *     layer. It never reads `Date.now()` or `Math.random()`. Two
 *     identical stores written through two controllers produce
 *     byte-identical blobs — the canonicalising serializer guarantees
 *     this and the controller adds no extra randomness.
 *
 *   • Replays embed the full binding table inside their own envelope
 *     (replay headers carry `bindingsSnapshot`), so a `resetAll()`
 *     between recording and playback never desyncs a replay — the
 *     controller participates only in the live-input path.
 */

import {
  clearBindingsStorage,
  loadBindingsSnapshot,
  saveBindingsSnapshot,
  savePlayerBindings,
  type DetailedStorageResult,
  type StorageErrorCode,
  type StorageLike,
} from './BindingsStorage';
import {
  DEFAULT_PLAYER_BINDINGS,
  InputBindingsStore,
} from './InputBindingsStore';
import type {
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Reason a hydrate completed via the defaults path. Mirrors
 * {@link StorageErrorCode} from the storage layer plus an explicit
 * `'no-data'` for the first-run case (no key present yet) — the UI may
 * want to render "Loaded saved bindings" vs. "Starting from defaults"
 * differently from "Couldn't read your save (corrupted)".
 */
export type HydrateFallbackReason = StorageErrorCode;

/**
 * Result of {@link BindingsPersistenceController.hydrate}. Always
 * leaves the controller's store in a usable state — never throws —
 * because the boot path *must not* crash on a corrupted blob, a
 * sandboxed iframe, or a future schema version.
 */
export type HydrateResult =
  | { readonly source: 'storage' }
  | {
      readonly source: 'defaults';
      readonly fallbackReason: HydrateFallbackReason;
      readonly fallbackError: string;
    };

/**
 * Listener fired whenever a controller-mediated storage call fails.
 * Centralises the "tell the player something went wrong" affordance —
 * the rebinding UI subscribes once and renders a toast on every error
 * without having to thread the result through each call site.
 */
export type BindingsPersistenceErrorListener = (event: {
  readonly stage: 'hydrate' | 'save' | 'save-slot' | 'reset' | 'reset-slot';
  readonly code: StorageErrorCode;
  readonly error: string;
}) => void;

/** Constructor options. */
export interface BindingsPersistenceControllerOptions {
  /**
   * The in-memory store the controller mutates. Required — the
   * controller is intentionally stateless about bindings *content* and
   * defers to the store for that.
   */
  readonly store: InputBindingsStore;
  /**
   * Storage backing for the controller. Pass `undefined` (or omit) to
   * use the ambient `localStorage`; pass `null` to explicitly opt out
   * of persistence (boot mode in a headless test, for example); pass an
   * object for unit tests.
   */
  readonly storage?: StorageLike | null;
  /**
   * Optional error sink — invoked on every controller call that surfaces
   * a `DetailedStorageResult` with `ok: false`. The controller still
   * returns the result to the caller, but a UI that just wants to log
   * the error can subscribe here once and ignore the per-call return
   * value.
   *
   * `unavailable` is treated as a normal "no storage in this
   * environment" condition and is **not** forwarded to the listener —
   * surfacing it to the player would be confusing on a sandboxed iframe
   * where there is nothing the player could do about it. All other
   * codes (corrupted, write-failed, too-old, …) *are* forwarded.
   */
  readonly errorListener?: BindingsPersistenceErrorListener;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * Glue that ties an {@link InputBindingsStore} to the persistence layer.
 *
 * Lifecycle:
 *
 *     // At boot:
 *     const store = new InputBindingsStore();
 *     const persistence = new BindingsPersistenceController({ store });
 *     persistence.hydrate();        // load saved blob if any
 *
 *     // After a rebind UI commits a capture:
 *     store.setAction(slot, action, [binding]);
 *     persistence.saveAll();        // write snapshot
 *
 *     // "Reset all controls" button:
 *     persistence.resetAll();       // store + storage both cleared
 *
 * The controller never throws — every method returns a
 * {@link DetailedStorageResult} so the caller can branch on the cause
 * if it cares, or ignore the return value and let the listener handle
 * surfacing errors.
 */
export class BindingsPersistenceController {
  private readonly store: InputBindingsStore;
  /**
   * Captured at construction so a later `globalThis.localStorage`
   * shim swap (e.g. by a test) doesn't change the storage the
   * controller writes to. Explicit `null` means "no persistence";
   * `undefined` means "resolve from globalThis.localStorage on every
   * call".
   *
   * The IO helpers ({@link saveBindingsSnapshot} et al.) take an
   * optional storage argument. Passing it through verbatim preserves
   * their `resolveStorage(undefined)` policy when the caller wants the
   * ambient `localStorage`.
   */
  private readonly storage: StorageLike | null | undefined;
  private readonly errorListener: BindingsPersistenceErrorListener | undefined;

  constructor(options: BindingsPersistenceControllerOptions) {
    this.store = options.store;
    this.storage = options.storage;
    this.errorListener = options.errorListener;
  }

  /**
   * The store this controller is wired to. Exposed so the rebinding UI
   * can hand the same store to its `RebindingScreen` instance — single
   * source of truth, end-to-end.
   */
  getStore(): InputBindingsStore {
    return this.store;
  }

  // -------------------------------------------------------------------------
  // Hydrate (load on boot)
  // -------------------------------------------------------------------------

  /**
   * Read the persisted snapshot (if any) and apply it to the store.
   *
   * On success, every slot in the store is replaced by the
   * corresponding entry from the persisted snapshot. On any failure —
   * unavailable storage, missing key, corrupted blob, future schema
   * version we can't migrate — the store is left untouched (the caller
   * gets a "we used the in-memory defaults" signal back).
   *
   * The boot sequence calls this exactly once, immediately after
   * constructing the controller. Calling it twice is harmless — the
   * second call is a deterministic re-application of the same blob.
   */
  hydrate(): HydrateResult {
    const result = loadBindingsSnapshot(this.storage);
    if (result.ok) {
      // Apply each slot through the store's `set` so its validation
      // re-runs (paranoia against a serializer / migration bug that
      // produces structurally-valid-but-semantically-wrong output).
      const slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
      for (const slot of slots) {
        const entry = result.value[slot];
        this.store.set(slot, entry);
      }
      return { source: 'storage' };
    }
    // The 'unavailable' case is the boot-in-a-sandbox path; not an
    // error worth telling the player about. 'missing' is first-run
    // (also not an error). Other codes are real failures we want to
    // surface.
    if (result.code !== 'unavailable' && result.code !== 'missing') {
      this.emitError('hydrate', result.code, result.error);
    }
    return {
      source: 'defaults',
      fallbackReason: result.code,
      fallbackError: result.error,
    };
  }

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  /**
   * Persist the full four-slot snapshot to storage. Called after any
   * binding-mutating operation in the rebinding UI (capture commit,
   * conflict resolve, programmatic device override).
   *
   * Returns a `DetailedStorageResult<void>` so callers that *do* care
   * about a `quota` / `private-mode` write failure can react (e.g.
   * surface "Couldn't save your controls" toast); the listener also
   * fires for the same event so a UI that already subscribed can stay
   * out of the per-call return value.
   */
  saveAll(): DetailedStorageResult<void> {
    const result = saveBindingsSnapshot(this.store.snapshot(), this.storage);
    if (!result.ok && result.code !== 'unavailable') {
      this.emitError('save', result.code, result.error);
    }
    return result;
  }

  /**
   * Persist a single slot's bindings. The rebinding UI's "Apply just
   * this player" path (and the per-slot reset) calls this so a single-
   * slot change does not have to re-serialise the whole snapshot.
   *
   * The boot loader still prefers the snapshot key — per-slot keys are
   * an optional override layer kept in lockstep with the snapshot via
   * the rebinding UI's "save after commit" calls.
   */
  saveSlot(slot: PlayerBindingsIndex): DetailedStorageResult<void> {
    const slotBindings = this.store.get(slot);
    const result = savePlayerBindings(slot, slotBindings, this.storage);
    if (!result.ok && result.code !== 'unavailable') {
      this.emitError('save-slot', result.code, result.error);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------------

  /**
   * Restore *every* slot to its default {@link PlayerBindings} *and*
   * clear the persisted blobs. The combined operation is the rebinding
   * UI's "Reset all controls" affordance: a player who clicks it should
   * not see their old layout reappear after a refresh.
   *
   * The store is reset first so that a transient `removeItem` failure
   * still leaves the player on defaults in-memory — better the layout
   * survives the session than the failure does.
   */
  resetAll(): DetailedStorageResult<void> {
    this.store.resetAll();
    const result = clearBindingsStorage(this.storage);
    if (!result.ok && result.code !== 'unavailable') {
      this.emitError('reset', result.code, result.error);
    }
    return result;
  }

  /**
   * Restore a single slot to its default and persist the new state.
   *
   * Implementation note: we re-save the entire snapshot rather than
   * trying to selectively delete the per-slot key. The snapshot is the
   * canonical source of truth, and a stray per-slot key for slot 3 is
   * harmless (it's only consulted as an override) — but a snapshot that
   * disagrees with the player's expected reset is *not* harmless.
   */
  resetSlot(slot: PlayerBindingsIndex): DetailedStorageResult<void> {
    this.store.reset(slot);
    const result = saveBindingsSnapshot(this.store.snapshot(), this.storage);
    if (!result.ok && result.code !== 'unavailable') {
      this.emitError('reset-slot', result.code, result.error);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private emitError(
    stage: 'hydrate' | 'save' | 'save-slot' | 'reset' | 'reset-slot',
    code: StorageErrorCode,
    error: string,
  ): void {
    if (this.errorListener) {
      this.errorListener({ stage, code, error });
    }
  }
}

// ---------------------------------------------------------------------------
// One-shot factory used by the BootScene boot path
// ---------------------------------------------------------------------------

/**
 * Build a fresh {@link InputBindingsStore} hydrated from storage.
 *
 * Convenience for the boot path that doesn't want to manage a
 * controller instance — it just needs "the right store to put on the
 * Phaser registry". The controller is constructed, used once, and
 * discarded; downstream scenes (`RebindingScene`, `MatchScene`) build
 * their own controller around the same store when they need autosave.
 *
 * Always returns a usable store. Boot continues with the in-memory
 * defaults whenever the persisted blob can't be loaded.
 */
export function createHydratedBindingsStore(
  storage?: StorageLike | null,
): {
  readonly store: InputBindingsStore;
  readonly source: 'storage' | 'defaults';
  readonly fallbackReason?: HydrateFallbackReason;
  readonly fallbackError?: string;
} {
  const store = new InputBindingsStore();
  const controller = new BindingsPersistenceController({ store, storage });
  const result = controller.hydrate();
  if (result.source === 'storage') {
    return { store, source: 'storage' };
  }
  return {
    store,
    source: 'defaults',
    fallbackReason: result.fallbackReason,
    fallbackError: result.fallbackError,
  };
}

/**
 * Snapshot helper — given a raw `Record<PlayerBindingsIndex,
 * PlayerBindings>` (e.g. read off the registry), produce a deep
 * structural-equality check against the canonical defaults. Used by
 * tests and by the rebinding UI's "Reset" affordance to decide whether
 * the button should be greyed out.
 *
 * Exported here (rather than in `InputBindingsStore`) so the dependency
 * arrow stays one-way: persistence depends on the store, never the
 * other way around.
 */
export function snapshotMatchesDefaults(
  snapshot: Readonly<Record<PlayerBindingsIndex, PlayerBindings>>,
): boolean {
  const slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
  for (const slot of slots) {
    if (
      JSON.stringify(snapshot[slot]) !==
      JSON.stringify(DEFAULT_PLAYER_BINDINGS[slot])
    ) {
      return false;
    }
  }
  return true;
}
