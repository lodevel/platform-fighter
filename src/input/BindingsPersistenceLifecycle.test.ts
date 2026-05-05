import { describe, expect, it, vi } from 'vitest';
import {
  BINDINGS_SCHEMA_VERSION,
  BindingsPersistenceLifecycle,
  CURRENT_BINDINGS_SCHEMA_VERSION,
  DEFAULT_PLAYER_BINDINGS,
  MIN_MIGRATABLE_BINDINGS_VERSION,
  createBootedLifecycle,
  type BindingsLifecycleChangeEvent,
} from './BindingsPersistenceLifecycle';
import {
  loadBindingsSnapshot,
  saveBindingsSnapshot,
  snapshotStorageKey,
  type StorageLike,
} from './BindingsStorage';
import {
  DEFAULT_KEYBOARD_P1_BINDINGS,
  InputBindingsStore,
} from './InputBindingsStore';
import { KEY_CODE } from './keyCodes';
import type {
  KeyboardBinding,
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';

/**
 * AC 40301 Sub-AC 1 — bindings persistence lifecycle.
 *
 * The lifecycle is the canonical AC-named entry point that wraps the
 * existing IO + migration + controller stack with auto-save semantics
 * and lifecycle-state observability. These tests lock down:
 *
 *   1. Construction defaults — every slot starts on its
 *      {@link DEFAULT_PLAYER_BINDINGS} entry; `getState()` returns
 *      `booted: false` until `boot()` runs.
 *   2. Boot — hydrates from storage when a saved blob exists,
 *      falls back to defaults when no blob is present, and surfaces a
 *      typed `fallbackReason` when the blob is corrupted.
 *   3. Schema migration — a v0 (legacy) blob is migrated forward to
 *      the current schema before strict validation runs.
 *   4. Auto-persist — every write API (`setBinding`, `setAction`,
 *      `reset`, `resetAction`, `resetAll`, `clear`) flushes the
 *      snapshot to storage in one call.
 *   5. Subscribers — `subscribe()` callbacks fire on every successful
 *      auto-save with the typed cause, the just-flushed snapshot, and
 *      the targeted slot.
 *   6. Idempotent boot — calling `boot()` twice is a deterministic
 *      re-load of whatever's currently in storage.
 *   7. Storage failures — write throws don't unwind the in-memory
 *      mutation; `getState().lastError` records the typed cause.
 *   8. End-to-end browser session survival — boot → mutate via
 *      lifecycle → fresh lifecycle on the same storage → `boot()`
 *      observes the just-saved bindings.
 *   9. `createBootedLifecycle` factory returns a usable lifecycle on
 *      every code path.
 *  10. The `clear()` operation removes the persisted blob entirely
 *      (next boot's hydrate goes via the `'missing'` fallback path),
 *      whereas `resetAll()` re-saves a defaults-shaped blob.
 *  11. Listener exceptions don't break the lifecycle's state machine
 *      (subsequent listeners still fire for the same event).
 */

// ---------------------------------------------------------------------------
// Storage doubles
// ---------------------------------------------------------------------------

class InMemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  has(key: string): boolean {
    return this.data.has(key);
  }
  size(): number {
    return this.data.size;
  }
  raw(key: string): string | undefined {
    return this.data.get(key);
  }
}

class WriteFailingStorage implements StorageLike {
  getItem(_key: string): string | null {
    return null;
  }
  setItem(_key: string, _value: string): void {
    throw new Error('quota exceeded (test stub)');
  }
  removeItem(_key: string): void {
    /* noop */
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_SLOTS: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];

function makeCustomP1(): PlayerBindings {
  return {
    playerIndex: 1,
    bindings: {
      ...DEFAULT_KEYBOARD_P1_BINDINGS,
      attack: [
        Object.freeze<KeyboardBinding>({ kind: 'keyboard', keyCode: KEY_CODE.SPACE }),
      ],
    },
  };
}

function makeCustomJumpBinding(): ReadonlyArray<KeyboardBinding> {
  return [Object.freeze<KeyboardBinding>({ kind: 'keyboard', keyCode: KEY_CODE.SPACE })];
}

// ---------------------------------------------------------------------------
// 1. Construction defaults
// ---------------------------------------------------------------------------

describe('BindingsPersistenceLifecycle — construction', () => {
  it('seeds every slot from DEFAULT_PLAYER_BINDINGS when no overrides supplied', () => {
    const storage = new InMemoryStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    for (const slot of ALL_SLOTS) {
      expect(lifecycle.getBindings(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('does not perform storage IO when bootOnConstruct is false (default)', () => {
    const storage = new InMemoryStorage();
    const getSpy = vi.spyOn(storage, 'getItem');
    const setSpy = vi.spyOn(storage, 'setItem');
    new BindingsPersistenceLifecycle({ storage });
    expect(getSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('getState reports booted=false and null hydrate fields until boot is called', () => {
    const storage = new InMemoryStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    const state = lifecycle.getState();
    expect(state.booted).toBe(false);
    expect(state.hydrateSource).toBeNull();
    expect(state.hydrateFallbackReason).toBeNull();
    expect(state.lastChange).toBeNull();
    expect(state.lastError).toBeNull();
    expect(state.schemaVersion).toBe(BINDINGS_SCHEMA_VERSION);
    expect(state.minMigratableVersion).toBe(MIN_MIGRATABLE_BINDINGS_VERSION);
  });

  it('applies overrides verbatim before any boot', () => {
    const storage = new InMemoryStorage();
    const customP1 = makeCustomP1();
    const lifecycle = new BindingsPersistenceLifecycle({
      storage,
      overrides: { 1: customP1 },
    });
    expect(lifecycle.getBindings(1)).toEqual(customP1);
    expect(lifecycle.getBindings(2)).toEqual(DEFAULT_PLAYER_BINDINGS[2]);
  });

  it('bootOnConstruct triggers an immediate hydrate', () => {
    const storage = new InMemoryStorage();
    saveBindingsSnapshot({ ...DEFAULT_PLAYER_BINDINGS, 1: makeCustomP1() }, storage);

    const lifecycle = new BindingsPersistenceLifecycle({
      storage,
      bootOnConstruct: true,
    });
    expect(lifecycle.getState().booted).toBe(true);
    expect(lifecycle.getState().hydrateSource).toBe('storage');
    expect(lifecycle.getBindings(1)).toEqual(makeCustomP1());
  });
});

// ---------------------------------------------------------------------------
// 2. Boot — hydrate-on-game-boot
// ---------------------------------------------------------------------------

describe('BindingsPersistenceLifecycle — boot()', () => {
  it('falls back to defaults when no saved blob exists', () => {
    const storage = new InMemoryStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });

    const result = lifecycle.boot();

    expect(result.source).toBe('defaults');
    if (result.source === 'defaults') {
      expect(result.fallbackReason).toBe('missing');
    }
    const state = lifecycle.getState();
    expect(state.booted).toBe(true);
    expect(state.hydrateSource).toBe('defaults');
    expect(state.hydrateFallbackReason).toBe('missing');
    for (const slot of ALL_SLOTS) {
      expect(lifecycle.getBindings(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('hydrates from a previously-saved snapshot', () => {
    const storage = new InMemoryStorage();
    const customSnap = { ...DEFAULT_PLAYER_BINDINGS, 1: makeCustomP1() };
    saveBindingsSnapshot(customSnap, storage);

    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    const result = lifecycle.boot();

    expect(result.source).toBe('storage');
    expect(lifecycle.getState().hydrateSource).toBe('storage');
    expect(lifecycle.getBindings(1)).toEqual(makeCustomP1());
    for (const slot of [2, 3, 4] as const) {
      expect(lifecycle.getBindings(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('falls back to defaults when the persisted blob is corrupted', () => {
    const storage = new InMemoryStorage();
    storage.setItem(snapshotStorageKey(), '{"this is not": "valid bindings json"}');

    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    const result = lifecycle.boot();

    expect(result.source).toBe('defaults');
    if (result.source === 'defaults') {
      // Corrupted JSON / shape ⇒ the storage layer reports 'corrupted'.
      expect(result.fallbackReason).toBe('corrupted');
    }
    // Defaults are still in place — boot never throws.
    for (const slot of ALL_SLOTS) {
      expect(lifecycle.getBindings(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('returns deterministic results when called twice (idempotent)', () => {
    const storage = new InMemoryStorage();
    saveBindingsSnapshot({ ...DEFAULT_PLAYER_BINDINGS, 1: makeCustomP1() }, storage);

    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    const first = lifecycle.boot();
    const second = lifecycle.boot();
    expect(first.source).toBe(second.source);
    expect(lifecycle.getBindings(1)).toEqual(makeCustomP1());
  });
});

// ---------------------------------------------------------------------------
// 3. Schema migration — legacy v0 → current
// ---------------------------------------------------------------------------

describe('BindingsPersistenceLifecycle — schema migration', () => {
  it('migrates a legacy v0 snapshot blob to the current schema on boot', () => {
    const storage = new InMemoryStorage();
    // Build a synthetic v0 blob in the legacy "flat slots" shape that
    // the v0 → v1 migration handler upgrades. The default-shaped slot
    // contents satisfy the post-migration strict validator.
    const legacyV0Blob = JSON.stringify({
      schemaVersion: 0,
      slots: {
        '1': DEFAULT_PLAYER_BINDINGS[1],
        '2': DEFAULT_PLAYER_BINDINGS[2],
        '3': DEFAULT_PLAYER_BINDINGS[3],
        '4': DEFAULT_PLAYER_BINDINGS[4],
      },
    });
    storage.setItem(snapshotStorageKey(), legacyV0Blob);

    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    const result = lifecycle.boot();
    expect(result.source).toBe('storage');
    for (const slot of ALL_SLOTS) {
      expect(lifecycle.getBindings(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('rejects a future-schema (too-new) blob and falls back to defaults', () => {
    const storage = new InMemoryStorage();
    const futureBlob = JSON.stringify({
      schemaVersion: CURRENT_BINDINGS_SCHEMA_VERSION + 99,
      kind: 'bindingsSnapshot',
      data: {},
    });
    storage.setItem(snapshotStorageKey(), futureBlob);

    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    const result = lifecycle.boot();
    expect(result.source).toBe('defaults');
    if (result.source === 'defaults') {
      expect(result.fallbackReason).toBe('too-new');
    }
    for (const slot of ALL_SLOTS) {
      expect(lifecycle.getBindings(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Auto-persist on every write
// ---------------------------------------------------------------------------

describe('BindingsPersistenceLifecycle — auto-persist on writes', () => {
  it('setBinding flushes the snapshot to storage', () => {
    const storage = new InMemoryStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });

    expect(storage.has(snapshotStorageKey())).toBe(false);
    const result = lifecycle.setBinding(1, makeCustomP1());
    expect(result.ok).toBe(true);
    expect(storage.has(snapshotStorageKey())).toBe(true);

    const reloaded = loadBindingsSnapshot(storage);
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      expect(reloaded.value[1]).toEqual(makeCustomP1());
    }
  });

  it('setAction flushes only the targeted action through to storage', () => {
    const storage = new InMemoryStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });

    const result = lifecycle.setAction(1, 'jump', makeCustomJumpBinding());
    expect(result.ok).toBe(true);

    const reloaded = loadBindingsSnapshot(storage);
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      expect(reloaded.value[1].bindings.jump).toEqual(makeCustomJumpBinding());
      expect(reloaded.value[1].bindings.attack).toEqual(
        DEFAULT_PLAYER_BINDINGS[1].bindings.attack,
      );
      expect(reloaded.value[2]).toEqual(DEFAULT_PLAYER_BINDINGS[2]);
    }
  });

  it('reset reverts a slot to defaults and re-saves the snapshot', () => {
    const storage = new InMemoryStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    lifecycle.setBinding(1, makeCustomP1());
    expect(lifecycle.getBindings(1)).toEqual(makeCustomP1());

    const result = lifecycle.reset(1);
    expect(result.ok).toBe(true);
    expect(lifecycle.getBindings(1)).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
    const reloaded = loadBindingsSnapshot(storage);
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      expect(reloaded.value[1]).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
    }
  });

  it('resetAction reverts a single action while leaving the rest of the slot intact', () => {
    const storage = new InMemoryStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    lifecycle.setAction(1, 'jump', makeCustomJumpBinding());
    lifecycle.setAction(1, 'attack', makeCustomJumpBinding());

    lifecycle.resetAction(1, 'jump');
    expect(lifecycle.getAction(1, 'jump')).toEqual(
      DEFAULT_PLAYER_BINDINGS[1].bindings.jump,
    );
    expect(lifecycle.getAction(1, 'attack')).toEqual(makeCustomJumpBinding());
  });

  it('resetAll reverts every slot AND re-saves a defaults snapshot', () => {
    const storage = new InMemoryStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    lifecycle.setBinding(1, makeCustomP1());
    lifecycle.setAction(2, 'attack', makeCustomJumpBinding());

    const result = lifecycle.resetAll();
    expect(result.ok).toBe(true);
    for (const slot of ALL_SLOTS) {
      expect(lifecycle.getBindings(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
    // The persisted blob is the defaults-shaped snapshot.
    expect(storage.has(snapshotStorageKey())).toBe(true);
    const reloaded = loadBindingsSnapshot(storage);
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      for (const slot of ALL_SLOTS) {
        expect(reloaded.value[slot]).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
      }
    }
  });

  it('clear() removes the persisted blob (distinct from resetAll)', () => {
    const storage = new InMemoryStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    lifecycle.setBinding(1, makeCustomP1());
    expect(storage.has(snapshotStorageKey())).toBe(true);

    const result = lifecycle.clear();
    expect(result.ok).toBe(true);
    expect(storage.has(snapshotStorageKey())).toBe(false);
    for (const slot of ALL_SLOTS) {
      expect(lifecycle.getBindings(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('save() flushes without mutating the in-memory state', () => {
    const storage = new InMemoryStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    // Mutate via the inner store directly to bypass auto-persist.
    lifecycle.getStore().setAction(1, 'jump', makeCustomJumpBinding());
    expect(storage.has(snapshotStorageKey())).toBe(false);

    const result = lifecycle.save();
    expect(result.ok).toBe(true);
    expect(storage.has(snapshotStorageKey())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Subscribers
// ---------------------------------------------------------------------------

describe('BindingsPersistenceLifecycle — subscribers', () => {
  it('fires subscribers on every successful auto-save with a typed cause', () => {
    const storage = new InMemoryStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    const events: BindingsLifecycleChangeEvent[] = [];
    lifecycle.subscribe((evt) => events.push(evt));

    lifecycle.setBinding(1, makeCustomP1());
    lifecycle.setAction(2, 'jump', makeCustomJumpBinding());
    lifecycle.reset(2);
    lifecycle.resetAction(1, 'attack');
    lifecycle.resetAll();
    lifecycle.clear();
    lifecycle.save();

    expect(events.map((e) => e.cause)).toEqual([
      'set',
      'set-action',
      'reset',
      'reset-action',
      'reset-all',
      'clear',
      'manual-save',
    ]);
    expect(events.map((e) => e.slot)).toEqual([1, 2, 2, 1, null, null, null]);
    // Every event carries a snapshot.
    for (const evt of events) {
      expect(evt.snapshot[1]).toBeDefined();
      expect(evt.snapshot[2]).toBeDefined();
    }
  });

  it('unsubscribe removes a listener', () => {
    const storage = new InMemoryStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    const events: BindingsLifecycleChangeEvent[] = [];
    const off = lifecycle.subscribe((evt) => events.push(evt));

    lifecycle.setAction(1, 'jump', makeCustomJumpBinding());
    expect(events.length).toBe(1);
    off();
    lifecycle.setAction(2, 'jump', makeCustomJumpBinding());
    expect(events.length).toBe(1);
  });

  it('a throwing listener does not break subsequent listeners for the same event', () => {
    const storage = new InMemoryStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    const tail: BindingsLifecycleChangeEvent[] = [];
    lifecycle.subscribe(() => {
      throw new Error('listener boom');
    });
    lifecycle.subscribe((evt) => tail.push(evt));
    // Silence the lifecycle's diagnostic console.error while we
    // intentionally provoke a listener throw — the assertion is that
    // the *lifecycle* keeps working, not that nothing logs.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => lifecycle.setAction(1, 'jump', makeCustomJumpBinding())).not.toThrow();
    } finally {
      errSpy.mockRestore();
    }
    expect(tail.length).toBe(1);
    expect(tail[0]?.cause).toBe('set-action');
  });

  it('lastChange in getState() mirrors the most recent emitted event', () => {
    const storage = new InMemoryStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });

    expect(lifecycle.getState().lastChange).toBeNull();

    lifecycle.setAction(1, 'jump', makeCustomJumpBinding());
    const state1 = lifecycle.getState();
    expect(state1.lastChange?.cause).toBe('set-action');
    expect(state1.lastChange?.slot).toBe(1);

    lifecycle.resetAll();
    const state2 = lifecycle.getState();
    expect(state2.lastChange?.cause).toBe('reset-all');
    expect(state2.lastChange?.slot).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. End-to-end browser session survival
// ---------------------------------------------------------------------------

describe('BindingsPersistenceLifecycle — browser session survival', () => {
  it('write-through-lifecycle then fresh-lifecycle-on-same-storage observes the bindings', () => {
    const storage = new InMemoryStorage();

    // First "session": mutate via the lifecycle.
    const sessionA = new BindingsPersistenceLifecycle({ storage });
    sessionA.boot();
    sessionA.setBinding(1, makeCustomP1());
    sessionA.setAction(3, 'jump', makeCustomJumpBinding());

    // Second "session": fresh lifecycle, fresh inner store, same storage.
    const sessionB = new BindingsPersistenceLifecycle({ storage });
    const result = sessionB.boot();
    expect(result.source).toBe('storage');
    expect(sessionB.getBindings(1)).toEqual(makeCustomP1());
    expect(sessionB.getBindings(3).bindings.jump).toEqual(makeCustomJumpBinding());
  });

  it('clear in one session ⇒ next session boots from defaults via missing path', () => {
    const storage = new InMemoryStorage();

    const sessionA = new BindingsPersistenceLifecycle({ storage });
    sessionA.boot();
    sessionA.setBinding(1, makeCustomP1());
    sessionA.clear();

    const sessionB = new BindingsPersistenceLifecycle({ storage });
    const result = sessionB.boot();
    expect(result.source).toBe('defaults');
    if (result.source === 'defaults') {
      expect(result.fallbackReason).toBe('missing');
    }
    expect(sessionB.getBindings(1)).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
  });
});

// ---------------------------------------------------------------------------
// 7. Storage failures
// ---------------------------------------------------------------------------

describe('BindingsPersistenceLifecycle — storage failures', () => {
  it('write-failed result still applies the in-memory mutation and records lastError', () => {
    const storage = new WriteFailingStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });

    const result = lifecycle.setAction(1, 'jump', makeCustomJumpBinding());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('write-failed');
    }
    // In-memory state still reflects the mutation.
    expect(lifecycle.getAction(1, 'jump')).toEqual(makeCustomJumpBinding());
    // Last error is captured for the boot banner / debug HUD.
    const state = lifecycle.getState();
    expect(state.lastError).not.toBeNull();
    expect(state.lastError?.code).toBe('write-failed');
  });

  it('null storage opts out — auto-save returns unavailable but in-memory state still updates', () => {
    const lifecycle = new BindingsPersistenceLifecycle({ storage: null });
    const result = lifecycle.setAction(1, 'jump', makeCustomJumpBinding());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unavailable');
    }
    expect(lifecycle.getAction(1, 'jump')).toEqual(makeCustomJumpBinding());
  });

  it('errorListener fires on typed failures, not on unavailable', () => {
    const errors: Array<{ code: string }> = [];

    // Write-failing storage triggers the listener.
    const failing = new WriteFailingStorage();
    const lifecycleFail = new BindingsPersistenceLifecycle({
      storage: failing,
      errorListener: (e) => errors.push({ code: e.code }),
    });
    lifecycleFail.setAction(1, 'jump', makeCustomJumpBinding());
    expect(errors.length).toBe(1);
    expect(errors[0]?.code).toBe('write-failed');

    // Unavailable storage does NOT trigger the listener.
    errors.length = 0;
    const lifecycleNo = new BindingsPersistenceLifecycle({
      storage: null,
      errorListener: (e) => errors.push({ code: e.code }),
    });
    lifecycleNo.setAction(1, 'jump', makeCustomJumpBinding());
    expect(errors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. createBootedLifecycle factory
// ---------------------------------------------------------------------------

describe('BindingsPersistenceLifecycle — createBootedLifecycle factory', () => {
  it('returns a booted lifecycle that observes the saved snapshot', () => {
    const storage = new InMemoryStorage();
    saveBindingsSnapshot({ ...DEFAULT_PLAYER_BINDINGS, 1: makeCustomP1() }, storage);

    const { lifecycle, hydrate } = createBootedLifecycle({ storage });
    expect(hydrate.source).toBe('storage');
    expect(lifecycle.getState().booted).toBe(true);
    expect(lifecycle.getBindings(1)).toEqual(makeCustomP1());
  });

  it('returns a defaults-backed lifecycle on missing storage', () => {
    const storage = new InMemoryStorage();
    const { lifecycle, hydrate } = createBootedLifecycle({ storage });
    expect(hydrate.source).toBe('defaults');
    if (hydrate.source === 'defaults') {
      expect(hydrate.fallbackReason).toBe('missing');
    }
    for (const slot of ALL_SLOTS) {
      expect(lifecycle.getBindings(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('returns a defaults-backed lifecycle when storage is null (boot-mode opt-out)', () => {
    const { lifecycle, hydrate } = createBootedLifecycle({ storage: null });
    expect(hydrate.source).toBe('defaults');
    if (hydrate.source === 'defaults') {
      expect(hydrate.fallbackReason).toBe('unavailable');
    }
    for (const slot of ALL_SLOTS) {
      expect(lifecycle.getBindings(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Inner store + controller escape hatches
// ---------------------------------------------------------------------------

describe('BindingsPersistenceLifecycle — escape hatches', () => {
  it('getStore returns the inner InputBindingsStore instance', () => {
    const storage = new InMemoryStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    const inner = lifecycle.getStore();
    expect(inner).toBeInstanceOf(InputBindingsStore);
    expect(inner.get(1)).toEqual(lifecycle.getBindings(1));
  });

  it('getController returns a controller that wraps the same inner store', () => {
    const storage = new InMemoryStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    const controller = lifecycle.getController();
    expect(controller.getStore()).toBe(lifecycle.getStore());
  });

  it('snapshot() and getDefault() match the inner store reads', () => {
    const storage = new InMemoryStorage();
    const lifecycle = new BindingsPersistenceLifecycle({ storage });
    const snap = lifecycle.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    for (const slot of ALL_SLOTS) {
      expect(snap[slot]).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
      expect(lifecycle.getDefault(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });
});
