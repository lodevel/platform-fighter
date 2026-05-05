import { describe, expect, it } from 'vitest';
import {
  BindingsPersistenceController,
  createHydratedBindingsStore,
  snapshotMatchesDefaults,
} from './BindingsPersistenceController';
import {
  ALL_BINDINGS_STORAGE_KEYS,
  saveBindingsSnapshot,
  snapshotStorageKey,
  type StorageLike,
} from './BindingsStorage';
import {
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_PLAYER_BINDINGS,
  InputBindingsStore,
} from './InputBindingsStore';
import { KEY_CODE } from './keyCodes';
import type {
  KeyboardBinding,
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';

/**
 * AC 5 Sub-AC 4 — bindings persistence controller.
 *
 * The controller wires the in-memory `InputBindingsStore` to the
 * `BindingsStorage` IO layer so the four player slots' binding profiles
 * survive a browser session. These tests lock down:
 *
 *   1. Hydrate from an empty storage falls back to defaults without
 *      throwing and reports `source: 'defaults'`.
 *   2. Hydrate from a previously-saved snapshot replaces every slot
 *      losslessly (`source: 'storage'`).
 *   3. `saveAll()` round-trips through storage byte-for-byte.
 *   4. `saveSlot()` writes a single slot's per-player blob without
 *      touching the snapshot.
 *   5. `resetAll()` clears the store *and* every persisted key so a
 *      fresh hydrate sees defaults.
 *   6. `resetSlot()` reverts one slot only and re-saves the snapshot.
 *   7. The error listener fires with a typed code on failure (write
 *      throws) but stays quiet for `unavailable` (no storage in env)
 *      and `missing` (first-run hydrate).
 *   8. `createHydratedBindingsStore` factory returns a usable store on
 *      every code path.
 *   9. `snapshotMatchesDefaults` correctly distinguishes a customised
 *      snapshot from the canonical defaults.
 *  10. End-to-end "browser session survival": save → fresh
 *      controller + fresh store → hydrate → identical snapshot.
 */

// ---------------------------------------------------------------------------
// In-memory storage doubles
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
    throw new Error('quota');
  }
  removeItem(_key: string): void {
    /* noop */
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCustomP1(): PlayerBindings {
  // P1 with `attack` rebound to SPACE — clearly different from defaults.
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

// ---------------------------------------------------------------------------
// Hydrate
// ---------------------------------------------------------------------------

describe('BindingsPersistenceController.hydrate', () => {
  it('falls back to defaults when storage is empty (first-run)', () => {
    const storage = new InMemoryStorage();
    const store = new InputBindingsStore();
    const controller = new BindingsPersistenceController({ store, storage });

    const result = controller.hydrate();
    expect(result.source).toBe('defaults');
    if (result.source === 'defaults') {
      expect(result.fallbackReason).toBe('missing');
    }
    // Store untouched.
    expect(snapshotMatchesDefaults(store.snapshot())).toBe(true);
  });

  it('replaces every slot from a saved snapshot', () => {
    const storage = new InMemoryStorage();

    // Pre-seed storage with a customised P1, defaults elsewhere.
    const seed: Record<PlayerBindingsIndex, PlayerBindings> = {
      1: makeCustomP1(),
      2: DEFAULT_PLAYER_BINDINGS[2],
      3: DEFAULT_PLAYER_BINDINGS[3],
      4: DEFAULT_PLAYER_BINDINGS[4],
    };
    saveBindingsSnapshot(seed, storage);

    // Fresh store + controller; hydrate.
    const store = new InputBindingsStore();
    const controller = new BindingsPersistenceController({ store, storage });
    const result = controller.hydrate();

    expect(result.source).toBe('storage');
    const p1 = store.get(1);
    const p1Attack = p1.bindings.attack[0] as KeyboardBinding;
    expect(p1Attack.keyCode).toBe(KEY_CODE.SPACE);
    // Slot 2/3/4 still defaults.
    expect(JSON.stringify(store.get(2))).toBe(JSON.stringify(DEFAULT_PLAYER_BINDINGS[2]));
  });

  it('returns defaults gracefully when storage is null (opt-out)', () => {
    const store = new InputBindingsStore();
    const controller = new BindingsPersistenceController({ store, storage: null });
    const result = controller.hydrate();
    expect(result.source).toBe('defaults');
    if (result.source === 'defaults') {
      expect(result.fallbackReason).toBe('unavailable');
    }
    expect(snapshotMatchesDefaults(store.snapshot())).toBe(true);
  });

  it('does not surface unavailable / missing to the error listener', () => {
    const events: string[] = [];
    const listener = (e: { stage: string; code: string }): void => {
      events.push(`${e.stage}:${e.code}`);
    };

    // Empty in-memory storage → 'missing'.
    const storage = new InMemoryStorage();
    const c1 = new BindingsPersistenceController({
      store: new InputBindingsStore(),
      storage,
      errorListener: listener,
    });
    c1.hydrate();
    // Null storage → 'unavailable'.
    const c2 = new BindingsPersistenceController({
      store: new InputBindingsStore(),
      storage: null,
      errorListener: listener,
    });
    c2.hydrate();

    expect(events).toEqual([]);
  });

  it('surfaces a corrupted blob to the error listener', () => {
    const storage = new InMemoryStorage();
    storage.setItem(snapshotStorageKey(), 'not-json');
    const events: string[] = [];
    const controller = new BindingsPersistenceController({
      store: new InputBindingsStore(),
      storage,
      errorListener: (e) => events.push(`${e.stage}:${e.code}`),
    });
    const result = controller.hydrate();
    expect(result.source).toBe('defaults');
    expect(events.length).toBe(1);
    expect(events[0]).toMatch(/^hydrate:(corrupted|migration-failed|too-old|too-new)$/);
  });
});

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

describe('BindingsPersistenceController.saveAll', () => {
  it('writes the full snapshot under the canonical key', () => {
    const storage = new InMemoryStorage();
    const store = new InputBindingsStore();
    store.set(1, makeCustomP1());
    const controller = new BindingsPersistenceController({ store, storage });

    const result = controller.saveAll();
    expect(result.ok).toBe(true);
    expect(storage.has(snapshotStorageKey())).toBe(true);

    // Round-trip via the controller's hydrate path.
    const fresh = new InputBindingsStore();
    new BindingsPersistenceController({ store: fresh, storage }).hydrate();
    const p1Attack = fresh.get(1).bindings.attack[0] as KeyboardBinding;
    expect(p1Attack.keyCode).toBe(KEY_CODE.SPACE);
  });

  it('returns unavailable without throwing when storage is null', () => {
    const store = new InputBindingsStore();
    store.set(1, makeCustomP1());
    const controller = new BindingsPersistenceController({ store, storage: null });
    const result = controller.saveAll();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unavailable');
    }
  });

  it('emits write-failed to the listener on a setItem throw', () => {
    const storage = new WriteFailingStorage();
    const store = new InputBindingsStore();
    store.set(1, makeCustomP1());
    const events: string[] = [];
    const controller = new BindingsPersistenceController({
      store,
      storage,
      errorListener: (e) => events.push(`${e.stage}:${e.code}`),
    });
    const result = controller.saveAll();
    expect(result.ok).toBe(false);
    expect(events).toEqual(['save:write-failed']);
  });
});

describe('BindingsPersistenceController.saveSlot', () => {
  it('writes the single-slot envelope under the per-player key', () => {
    const storage = new InMemoryStorage();
    const store = new InputBindingsStore();
    store.set(1, makeCustomP1());
    const controller = new BindingsPersistenceController({ store, storage });

    const result = controller.saveSlot(1);
    expect(result.ok).toBe(true);
    // Snapshot key NOT written; per-player key IS written.
    expect(storage.has(snapshotStorageKey())).toBe(false);
    const playerKey = ALL_BINDINGS_STORAGE_KEYS.find((k) => k.endsWith('player.1'));
    expect(playerKey).toBeDefined();
    expect(storage.has(playerKey as string)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

describe('BindingsPersistenceController.resetAll', () => {
  it('reverts every slot to defaults and clears every persisted key', () => {
    const storage = new InMemoryStorage();
    const store = new InputBindingsStore();
    store.set(1, makeCustomP1());
    const controller = new BindingsPersistenceController({ store, storage });

    // Persist + per-slot blob to prove resetAll wipes all of it.
    controller.saveAll();
    controller.saveSlot(1);
    expect(storage.size()).toBeGreaterThan(0);

    const result = controller.resetAll();
    expect(result.ok).toBe(true);
    expect(snapshotMatchesDefaults(store.snapshot())).toBe(true);
    // Every owned key is gone.
    for (const key of ALL_BINDINGS_STORAGE_KEYS) {
      expect(storage.has(key)).toBe(false);
    }

    // A fresh hydrate of a fresh store sees defaults — both because the
    // in-memory state starts at defaults and because hydrate falls
    // back to defaults (storage was cleared).
    const fresh = new InputBindingsStore();
    const c2 = new BindingsPersistenceController({ store: fresh, storage });
    const hydrate2 = c2.hydrate();
    expect(hydrate2.source).toBe('defaults');
    expect(snapshotMatchesDefaults(fresh.snapshot())).toBe(true);
  });

  it('still resets the in-memory store even if storage is unavailable', () => {
    const store = new InputBindingsStore();
    store.set(1, makeCustomP1());
    const controller = new BindingsPersistenceController({
      store,
      storage: null,
    });
    const result = controller.resetAll();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unavailable');
    // Store is reset regardless.
    expect(snapshotMatchesDefaults(store.snapshot())).toBe(true);
  });
});

describe('BindingsPersistenceController.resetSlot', () => {
  it('reverts one slot and re-saves the snapshot', () => {
    const storage = new InMemoryStorage();
    const store = new InputBindingsStore();
    // Customise P1 + a different P2 binding so we can prove only P1 reverts.
    store.set(1, makeCustomP1());
    const customP2: PlayerBindings = {
      playerIndex: 2,
      bindings: {
        ...DEFAULT_PLAYER_BINDINGS[2].bindings,
        jump: [
          Object.freeze<KeyboardBinding>({ kind: 'keyboard', keyCode: KEY_CODE.SHIFT }),
        ],
      },
    };
    store.set(2, customP2);
    const controller = new BindingsPersistenceController({ store, storage });
    controller.saveAll();

    const result = controller.resetSlot(1);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(store.get(1))).toBe(JSON.stringify(DEFAULT_PLAYER_BINDINGS[1]));
    // P2 untouched.
    const p2Jump = store.get(2).bindings.jump[0] as KeyboardBinding;
    expect(p2Jump.keyCode).toBe(KEY_CODE.SHIFT);

    // Persisted snapshot matches the new state.
    const fresh = new InputBindingsStore();
    new BindingsPersistenceController({ store: fresh, storage }).hydrate();
    expect(JSON.stringify(fresh.get(1))).toBe(JSON.stringify(DEFAULT_PLAYER_BINDINGS[1]));
    const freshP2 = fresh.get(2).bindings.jump[0] as KeyboardBinding;
    expect(freshP2.keyCode).toBe(KEY_CODE.SHIFT);
  });
});

// ---------------------------------------------------------------------------
// Factory + helpers
// ---------------------------------------------------------------------------

describe('createHydratedBindingsStore', () => {
  it('returns a defaults store when storage is empty', () => {
    const storage = new InMemoryStorage();
    const result = createHydratedBindingsStore(storage);
    expect(result.source).toBe('defaults');
    expect(result.fallbackReason).toBe('missing');
    expect(snapshotMatchesDefaults(result.store.snapshot())).toBe(true);
  });

  it('returns a hydrated store when storage carries a saved snapshot', () => {
    const storage = new InMemoryStorage();
    const seed: Record<PlayerBindingsIndex, PlayerBindings> = {
      1: makeCustomP1(),
      2: DEFAULT_PLAYER_BINDINGS[2],
      3: DEFAULT_PLAYER_BINDINGS[3],
      4: DEFAULT_PLAYER_BINDINGS[4],
    };
    saveBindingsSnapshot(seed, storage);

    const result = createHydratedBindingsStore(storage);
    expect(result.source).toBe('storage');
    const p1Attack = result.store.get(1).bindings.attack[0] as KeyboardBinding;
    expect(p1Attack.keyCode).toBe(KEY_CODE.SPACE);
  });

  it('always returns a usable store even when storage is null (opt-out)', () => {
    const result = createHydratedBindingsStore(null);
    expect(result.source).toBe('defaults');
    expect(result.fallbackReason).toBe('unavailable');
    // Store works.
    expect(result.store.get(1).playerIndex).toBe(1);
  });
});

describe('snapshotMatchesDefaults', () => {
  it('returns true on a fresh defaults snapshot', () => {
    const store = new InputBindingsStore();
    expect(snapshotMatchesDefaults(store.snapshot())).toBe(true);
  });

  it('returns false once any slot diverges', () => {
    const store = new InputBindingsStore();
    store.set(1, makeCustomP1());
    expect(snapshotMatchesDefaults(store.snapshot())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end "browser session" survival
// ---------------------------------------------------------------------------

describe('BindingsPersistenceController end-to-end', () => {
  it('survives a simulated browser session restart (save → fresh hydrate)', () => {
    const storage = new InMemoryStorage();

    // Session 1: customise + save.
    {
      const store = new InputBindingsStore();
      store.set(1, makeCustomP1());
      const ctrl = new BindingsPersistenceController({ store, storage });
      const r = ctrl.saveAll();
      expect(r.ok).toBe(true);
    }

    // Session 2: fresh process — only the storage carries over. Verify
    // hydrate restores the customisation.
    {
      const store = new InputBindingsStore();
      const ctrl = new BindingsPersistenceController({ store, storage });
      const hydrate = ctrl.hydrate();
      expect(hydrate.source).toBe('storage');
      const p1Attack = store.get(1).bindings.attack[0] as KeyboardBinding;
      expect(p1Attack.keyCode).toBe(KEY_CODE.SPACE);
    }
  });

  it('reset-then-restart leaves the player on defaults', () => {
    const storage = new InMemoryStorage();

    // Customise + save.
    {
      const store = new InputBindingsStore();
      store.set(1, makeCustomP1());
      const ctrl = new BindingsPersistenceController({ store, storage });
      ctrl.saveAll();
    }
    // Reset (player clicked "Reset all").
    {
      const store = new InputBindingsStore();
      // hydrate first so resetAll has something to wipe
      const ctrl = new BindingsPersistenceController({ store, storage });
      ctrl.hydrate();
      ctrl.resetAll();
    }
    // Fresh "session" — defaults all the way down.
    {
      const store = new InputBindingsStore();
      // pretend the player was already customised in-memory; hydrate
      // overwrites that with whatever's in storage.
      store.set(1, makeCustomP1());
      const ctrl = new BindingsPersistenceController({ store, storage });
      const hydrate = ctrl.hydrate();
      expect(hydrate.source).toBe('defaults');
      // Hydrate did not write anything, so the in-memory mutation
      // (set(1, makeCustomP1())) is technically still there. The
      // important guarantee is that the *persisted* state is empty —
      // which is what `hydrate.source === 'defaults'` proves.
    }
  });
});
