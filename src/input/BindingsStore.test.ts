import { describe, expect, it, vi } from 'vitest';
import {
  BindingsStore,
  createBindingsStore,
  DEFAULT_PLAYER_BINDINGS,
} from './BindingsStore';
import {
  loadBindingsSnapshot,
  saveBindingsSnapshot,
  snapshotStorageKey,
  type StorageLike,
} from './BindingsStorage';
import { DEFAULT_KEYBOARD_P1_BINDINGS } from './InputBindingsStore';
import { KEY_CODE } from './keyCodes';
import { LOGICAL_ACTIONS } from '../types/inputBindings';
import type {
  KeyboardBinding,
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';

/**
 * AC 40003 Sub-AC 3 — unified BindingsStore facade.
 *
 * The facade composes:
 *   • `InputBindingsStore`            — in-memory four-slot data model
 *   • `BindingsPersistenceController` — controller-shape glue
 *   • `BindingsStorage` (functional)  — namespaced localStorage IO
 *
 * These tests lock down the facade-specific contracts:
 *
 *   1. Construction defaults — every slot starts on its
 *      {@link DEFAULT_PLAYER_BINDINGS} entry; no storage IO happens
 *      unless `hydrateOnConstruct` is requested.
 *   2. `get` / `getAction` / `getDefault` / `snapshot` are immutable
 *      reads that match the underlying inner store.
 *   3. Auto-persist — every write API (`set`, `setAction`, `reset`,
 *      `resetAction`, `resetAll`) flushes the snapshot to storage in
 *      one call.
 *   4. The in-memory state survives a storage failure (in-memory
 *      mutation is *not* unwound on `write-failed`).
 *   5. End-to-end round-trip — write through one facade, hydrate a
 *      fresh facade off the same storage, observe identical snapshot.
 *   6. `hydrate` and `hydrateOnConstruct` apply the persisted snapshot
 *      to every slot; `lastHydrate` mirrors the result.
 *   7. `resetAll` resets the store *and* clears the persisted blobs so
 *      a subsequent hydrate sees defaults.
 *   8. The error listener is invoked exactly when the underlying
 *      controller would invoke it (typed `code`, never on `unavailable`
 *      or `missing`).
 *   9. `createBindingsStore` factory returns a usable store + the same
 *      hydrate result the boot path would otherwise read off
 *      `lastHydrate`.
 *  10. `getRawStore` and `getPersistenceController` expose the inner
 *      pieces so existing wiring (dispatcher, per-slot save) keeps
 *      working without re-routing through the facade.
 */

// ---------------------------------------------------------------------------
// Storage doubles (mirror the BindingsPersistenceController suite)
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

describe('BindingsStore — construction', () => {
  it('seeds every slot from DEFAULT_PLAYER_BINDINGS when no overrides supplied', () => {
    const storage = new InMemoryStorage();
    const bindings = new BindingsStore({ storage });
    for (const slot of ALL_SLOTS) {
      expect(bindings.get(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('does not perform storage IO when hydrateOnConstruct is false (default)', () => {
    const storage = new InMemoryStorage();
    const getSpy = vi.spyOn(storage, 'getItem');
    const setSpy = vi.spyOn(storage, 'setItem');

    new BindingsStore({ storage });

    expect(getSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('applies overrides verbatim before any hydrate', () => {
    const storage = new InMemoryStorage();
    const customP1 = makeCustomP1();
    const bindings = new BindingsStore({ storage, overrides: { 1: customP1 } });
    expect(bindings.get(1)).toEqual(customP1);
    // Other slots stay on defaults.
    expect(bindings.get(2)).toEqual(DEFAULT_PLAYER_BINDINGS[2]);
  });

  it('lastHydrate is null until hydrate is called', () => {
    const storage = new InMemoryStorage();
    const bindings = new BindingsStore({ storage });
    expect(bindings.lastHydrate).toBeNull();
  });

  it('throws if overrides contain an invalid PlayerBindings (delegates to inner store)', () => {
    const storage = new InMemoryStorage();
    expect(
      () =>
        new BindingsStore({
          storage,
          overrides: {
            1: {
              playerIndex: 1,
              // Missing actions — inner validator rejects.
              bindings: { left: [] } as unknown as PlayerBindings['bindings'],
            },
          },
        }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. Reads
// ---------------------------------------------------------------------------

describe('BindingsStore — reads', () => {
  it('get returns frozen PlayerBindings that match the inner store', () => {
    const storage = new InMemoryStorage();
    const bindings = new BindingsStore({ storage });
    const p2 = bindings.get(2);
    expect(Object.isFrozen(p2)).toBe(true);
    // Strict-mode mutation must throw; freezing is the contract.
    expect(() => {
      (p2 as { playerIndex: number }).playerIndex = 99;
    }).toThrow();
  });

  it('getAction returns the binding list for a single action', () => {
    const storage = new InMemoryStorage();
    const bindings = new BindingsStore({ storage });
    const jump = bindings.getAction(1, 'jump');
    expect(jump.length).toBe(1);
    expect(jump[0]).toEqual({ kind: 'keyboard', keyCode: KEY_CODE.W });
  });

  it('getDefault returns the canonical default for a slot regardless of mutations', () => {
    const storage = new InMemoryStorage();
    const bindings = new BindingsStore({ storage });
    bindings.setAction(1, 'attack', makeCustomJumpBinding());
    expect(bindings.getDefault(1)).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
    // Sanity: `get` reflects the mutation, `getDefault` does not.
    expect(bindings.get(1).bindings.attack[0]).toEqual({
      kind: 'keyboard',
      keyCode: KEY_CODE.SPACE,
    });
  });

  it('snapshot returns every slot frozen', () => {
    const storage = new InMemoryStorage();
    const bindings = new BindingsStore({ storage });
    const snap = bindings.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    for (const slot of ALL_SLOTS) {
      expect(snap[slot]).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('getRawStore returns the inner InputBindingsStore (escape hatch for the dispatcher)', () => {
    const storage = new InMemoryStorage();
    const bindings = new BindingsStore({ storage });
    const inner = bindings.getRawStore();
    // The inner store reads must match the facade's reads.
    expect(inner.get(1)).toEqual(bindings.get(1));
  });

  it('getPersistenceController returns the inner controller (escape hatch for per-slot save)', () => {
    const storage = new InMemoryStorage();
    const bindings = new BindingsStore({ storage });
    const controller = bindings.getPersistenceController();
    expect(controller.getStore()).toBe(bindings.getRawStore());
  });
});

// ---------------------------------------------------------------------------
// 3. Auto-persist on writes
// ---------------------------------------------------------------------------

describe('BindingsStore — auto-persist on writes', () => {
  it('set flushes the snapshot to storage', () => {
    const storage = new InMemoryStorage();
    const bindings = new BindingsStore({ storage });

    expect(storage.has(snapshotStorageKey())).toBe(false);
    const result = bindings.set(1, makeCustomP1());
    expect(result.ok).toBe(true);
    expect(storage.has(snapshotStorageKey())).toBe(true);

    // The persisted blob round-trips back to the same snapshot.
    const reloaded = loadBindingsSnapshot(storage);
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      expect(reloaded.value[1]).toEqual(makeCustomP1());
    }
  });

  it('setAction flushes the snapshot to storage with only the targeted action changed', () => {
    const storage = new InMemoryStorage();
    const bindings = new BindingsStore({ storage });

    const result = bindings.setAction(1, 'jump', makeCustomJumpBinding());
    expect(result.ok).toBe(true);

    const reloaded = loadBindingsSnapshot(storage);
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      expect(reloaded.value[1].bindings.jump).toEqual(makeCustomJumpBinding());
      // Other actions on slot 1 stay on defaults.
      expect(reloaded.value[1].bindings.attack).toEqual(
        DEFAULT_PLAYER_BINDINGS[1].bindings.attack,
      );
      // Other slots are untouched.
      expect(reloaded.value[2]).toEqual(DEFAULT_PLAYER_BINDINGS[2]);
    }
  });

  it('reset flushes the post-reset snapshot to storage', () => {
    const storage = new InMemoryStorage();
    const bindings = new BindingsStore({ storage });

    bindings.set(1, makeCustomP1());
    expect(bindings.get(1)).toEqual(makeCustomP1());

    const result = bindings.reset(1);
    expect(result.ok).toBe(true);
    expect(bindings.get(1)).toEqual(DEFAULT_PLAYER_BINDINGS[1]);

    // The persisted blob now matches defaults for slot 1.
    const reloaded = loadBindingsSnapshot(storage);
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      expect(reloaded.value[1]).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
    }
  });

  it('resetAction flushes the snapshot with only the targeted action restored', () => {
    const storage = new InMemoryStorage();
    const bindings = new BindingsStore({ storage });

    bindings.setAction(1, 'jump', makeCustomJumpBinding());
    bindings.setAction(1, 'attack', makeCustomJumpBinding());

    const result = bindings.resetAction(1, 'jump');
    expect(result.ok).toBe(true);
    expect(bindings.getAction(1, 'jump')).toEqual(
      DEFAULT_PLAYER_BINDINGS[1].bindings.jump,
    );
    // The non-reset action stays customised.
    expect(bindings.getAction(1, 'attack')).toEqual(makeCustomJumpBinding());
  });

  it('resetAll restores every slot AND clears the persisted blob', () => {
    const storage = new InMemoryStorage();
    const bindings = new BindingsStore({ storage });

    bindings.set(1, makeCustomP1());
    expect(storage.has(snapshotStorageKey())).toBe(true);

    const result = bindings.resetAll();
    expect(result.ok).toBe(true);

    // Every slot restored.
    for (const slot of ALL_SLOTS) {
      expect(bindings.get(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
    // Persisted blob cleared.
    expect(storage.has(snapshotStorageKey())).toBe(false);
  });

  it('save() flushes without mutating', () => {
    const storage = new InMemoryStorage();
    const bindings = new BindingsStore({ storage });
    const snapBefore = bindings.snapshot();

    const result = bindings.save();
    expect(result.ok).toBe(true);
    expect(storage.has(snapshotStorageKey())).toBe(true);

    const snapAfter = bindings.snapshot();
    expect(snapAfter).toEqual(snapBefore);
  });
});

// ---------------------------------------------------------------------------
// 4. In-memory state survives storage failure
// ---------------------------------------------------------------------------

describe('BindingsStore — storage failure handling', () => {
  it('keeps the in-memory write applied even when storage throws', () => {
    const storage = new WriteFailingStorage();
    const bindings = new BindingsStore({ storage });

    const result = bindings.setAction(1, 'jump', makeCustomJumpBinding());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('write-failed');
    }
    // The in-memory mutation still applied — better the layout survive
    // the session than the failure.
    expect(bindings.getAction(1, 'jump')).toEqual(makeCustomJumpBinding());
  });

  it('returns code: unavailable when storage is explicitly null', () => {
    const bindings = new BindingsStore({ storage: null });
    const result = bindings.setAction(1, 'jump', makeCustomJumpBinding());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unavailable');
    }
    // The in-memory mutation still applied.
    expect(bindings.getAction(1, 'jump')).toEqual(makeCustomJumpBinding());
  });

  it('errorListener fires on write-failed but stays quiet on unavailable', () => {
    const failingStorage = new WriteFailingStorage();
    const errorEvents: Array<{ stage: string; code: string }> = [];
    const failingBindings = new BindingsStore({
      storage: failingStorage,
      errorListener: (e) => errorEvents.push({ stage: e.stage, code: e.code }),
    });

    failingBindings.setAction(1, 'jump', makeCustomJumpBinding());
    expect(errorEvents).toEqual([{ stage: 'save', code: 'write-failed' }]);

    // unavailable storage path — listener should NOT fire.
    const silentEvents: Array<{ stage: string; code: string }> = [];
    const silentBindings = new BindingsStore({
      storage: null,
      errorListener: (e) => silentEvents.push({ stage: e.stage, code: e.code }),
    });
    silentBindings.setAction(1, 'jump', makeCustomJumpBinding());
    expect(silentEvents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. End-to-end round-trip
// ---------------------------------------------------------------------------

describe('BindingsStore — end-to-end persistence round-trip', () => {
  it('write through one facade, hydrate a fresh one off the same storage, observe identical snapshot', () => {
    const storage = new InMemoryStorage();
    const writer = new BindingsStore({ storage });
    writer.set(1, makeCustomP1());
    writer.setAction(3, 'jump', makeCustomJumpBinding());

    // Fresh facade — deliberately *not* sharing any in-memory state with `writer`.
    const reader = new BindingsStore({ storage });
    const result = reader.hydrate();
    expect(result.source).toBe('storage');
    expect(reader.get(1)).toEqual(writer.get(1));
    expect(reader.get(3)).toEqual(writer.get(3));
    expect(reader.snapshot()).toEqual(writer.snapshot());
  });

  it('a snapshot pre-seeded into storage hydrates the four slots verbatim', () => {
    const storage = new InMemoryStorage();
    // Pre-seed via the IO layer directly.
    const customSnapshot: Record<PlayerBindingsIndex, PlayerBindings> = {
      1: makeCustomP1(),
      2: DEFAULT_PLAYER_BINDINGS[2],
      3: DEFAULT_PLAYER_BINDINGS[3],
      4: DEFAULT_PLAYER_BINDINGS[4],
    };
    const seedResult = saveBindingsSnapshot(customSnapshot, storage);
    expect(seedResult.ok).toBe(true);

    const bindings = new BindingsStore({ storage, hydrateOnConstruct: true });
    expect(bindings.lastHydrate?.source).toBe('storage');
    expect(bindings.get(1)).toEqual(makeCustomP1());
    for (const slot of [2, 3, 4] as const) {
      expect(bindings.get(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Hydrate + lastHydrate
// ---------------------------------------------------------------------------

describe('BindingsStore — hydrate', () => {
  it('hydrate falls back to defaults on empty storage and reports the fallback reason', () => {
    const storage = new InMemoryStorage();
    const bindings = new BindingsStore({ storage });
    const result = bindings.hydrate();
    expect(result.source).toBe('defaults');
    if (result.source === 'defaults') {
      expect(result.fallbackReason).toBe('missing');
    }
    // lastHydrate mirrors the result.
    expect(bindings.lastHydrate).toEqual(result);
  });

  it('hydrateOnConstruct: true populates lastHydrate immediately', () => {
    const storage = new InMemoryStorage();
    const bindings = new BindingsStore({ storage, hydrateOnConstruct: true });
    expect(bindings.lastHydrate).not.toBeNull();
    expect(bindings.lastHydrate?.source).toBe('defaults');
  });

  it('hydrate replaces existing in-memory state with the persisted snapshot', () => {
    const storage = new InMemoryStorage();
    // Persist a custom snapshot through one facade.
    const writer = new BindingsStore({ storage });
    writer.set(1, makeCustomP1());

    // Different facade, with overrides — those should be wiped by hydrate.
    const customP2: PlayerBindings = {
      playerIndex: 2,
      bindings: {
        ...DEFAULT_PLAYER_BINDINGS[2].bindings,
        // Wildly customised — should disappear after hydrate (storage holds defaults for slot 2).
        attack: [Object.freeze<KeyboardBinding>({ kind: 'keyboard', keyCode: KEY_CODE.NUMPAD_5 })],
      },
    };
    const reader = new BindingsStore({ storage, overrides: { 2: customP2 } });
    expect(reader.get(2)).toEqual(customP2);

    const result = reader.hydrate();
    expect(result.source).toBe('storage');
    // After hydrate, slot 2 reverted to the persisted (default) value;
    // slot 1 picked up the writer's customisation.
    expect(reader.get(1)).toEqual(makeCustomP1());
    expect(reader.get(2)).toEqual(DEFAULT_PLAYER_BINDINGS[2]);
  });

  it('calling hydrate twice is idempotent', () => {
    const storage = new InMemoryStorage();
    const writer = new BindingsStore({ storage });
    writer.set(1, makeCustomP1());

    const reader = new BindingsStore({ storage });
    reader.hydrate();
    const snap1 = reader.snapshot();
    reader.hydrate();
    const snap2 = reader.snapshot();
    expect(snap2).toEqual(snap1);
  });
});

// ---------------------------------------------------------------------------
// 7. createBindingsStore factory
// ---------------------------------------------------------------------------

describe('createBindingsStore factory', () => {
  it('returns a hydrated store + the matching hydrate result', () => {
    const storage = new InMemoryStorage();
    const writer = new BindingsStore({ storage });
    writer.set(1, makeCustomP1());

    const { store, hydrate } = createBindingsStore({ storage });
    expect(hydrate.source).toBe('storage');
    expect(store.lastHydrate).toEqual(hydrate);
    expect(store.get(1)).toEqual(makeCustomP1());
  });

  it('falls back to defaults gracefully when storage is empty', () => {
    const storage = new InMemoryStorage();
    const { store, hydrate } = createBindingsStore({ storage });
    expect(hydrate.source).toBe('defaults');
    if (hydrate.source === 'defaults') {
      expect(hydrate.fallbackReason).toBe('missing');
    }
    for (const slot of ALL_SLOTS) {
      expect(store.get(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('honours storage: null (returns a usable store with no IO)', () => {
    const { store, hydrate } = createBindingsStore({ storage: null });
    expect(hydrate.source).toBe('defaults');
    if (hydrate.source === 'defaults') {
      expect(hydrate.fallbackReason).toBe('unavailable');
    }
    // Writes still mutate the in-memory state.
    store.setAction(1, 'jump', makeCustomJumpBinding());
    expect(store.getAction(1, 'jump')).toEqual(makeCustomJumpBinding());
  });
});

// ---------------------------------------------------------------------------
// 8. Logical-action coverage smoke
// ---------------------------------------------------------------------------

describe('BindingsStore — logical action coverage', () => {
  it('every default slot exposes a binding list for every LogicalAction', () => {
    const bindings = new BindingsStore({ storage: null });
    for (const slot of ALL_SLOTS) {
      const profile = bindings.get(slot);
      for (const action of LOGICAL_ACTIONS) {
        expect(Array.isArray(profile.bindings[action])).toBe(true);
        expect(profile.bindings[action].length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
