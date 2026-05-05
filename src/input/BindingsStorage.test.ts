import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_BINDINGS_STORAGE_KEYS,
  STORAGE_APP_NAMESPACE,
  STORAGE_BINDINGS_DOMAIN,
  STORAGE_BINDINGS_VERSION_SEGMENT,
  clearBindingsStorage,
  hasStoredBindingsSnapshot,
  loadBindingsSnapshot,
  loadBindingsSnapshotOrDefaults,
  loadPlayerBindings,
  playerStorageKey,
  saveBindingsSnapshot,
  savePlayerBindings,
  snapshotStorageKey,
  type StorageLike,
} from './BindingsStorage';
import {
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_PLAYER_BINDINGS,
  InputBindingsStore,
} from './InputBindingsStore';
import {
  BINDINGS_SCHEMA_VERSION,
  serializeBindingsSnapshot,
  serializePlayerBindings,
} from './InputBindingsSerializer';
import { KEY_CODE } from './keyCodes';
import type {
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';

/**
 * AC 40002 Sub-AC 2 — localStorage persistence layer for bindings.
 *
 * Locks down:
 *
 *   1. Namespace strategy — keys are `platformfighter.bindings.v1.…`
 *      and the per-slot keys are predictable.
 *   2. Save → load round-trips both shapes losslessly.
 *   3. Missing data on load returns a `missing` error rather than
 *      surfacing a `null` to the caller.
 *   4. Corrupted JSON / wrong-shape envelope / wrong slot index on
 *      load returns a `corrupted` error.
 *   5. Unavailable storage (no `localStorage` on the global, explicit
 *      `null` passed in) returns an `unavailable` error and never
 *      throws.
 *   6. `setItem` / `removeItem` throws (quota / private mode) are
 *      caught and surfaced as `write-failed`.
 *   7. The defaults-fallback helper always returns a usable bindings
 *      record and tags the `source` correctly.
 *   8. Save validation refuses malformed snapshots / payloads.
 */

// ---------------------------------------------------------------------------
// In-memory storage double
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

  // Test-only helpers
  has(key: string): boolean {
    return this.data.has(key);
  }
  rawSet(key: string, value: string): void {
    this.data.set(key, value);
  }
  size(): number {
    return this.data.size;
  }
  keys(): string[] {
    return Array.from(this.data.keys());
  }
}

class ThrowingStorage implements StorageLike {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getItem(_key: string): string | null {
    throw new Error('boom-get');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setItem(_key: string, _value: string): void {
    throw new Error('boom-set');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  removeItem(_key: string): void {
    throw new Error('boom-remove');
  }
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const customP1: PlayerBindings = {
  playerIndex: 1,
  bindings: {
    ...DEFAULT_KEYBOARD_P1_BINDINGS,
    jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }],
    attack: [
      { kind: 'keyboard', keyCode: KEY_CODE.F },
      { kind: 'keyboard', keyCode: KEY_CODE.ENTER },
    ],
  },
};

function fullSnapshot(): Record<PlayerBindingsIndex, PlayerBindings> {
  return {
    1: customP1,
    2: DEFAULT_PLAYER_BINDINGS[2],
    3: DEFAULT_PLAYER_BINDINGS[3],
    4: DEFAULT_PLAYER_BINDINGS[4],
  };
}

// ---------------------------------------------------------------------------
// Namespace strategy
// ---------------------------------------------------------------------------

describe('namespace strategy', () => {
  it('snapshot key follows app.domain.version.snapshot', () => {
    expect(snapshotStorageKey()).toBe(
      `${STORAGE_APP_NAMESPACE}.${STORAGE_BINDINGS_DOMAIN}.${STORAGE_BINDINGS_VERSION_SEGMENT}.snapshot`,
    );
  });

  it('per-player keys follow app.domain.version.player.<slot>', () => {
    for (const slot of [1, 2, 3, 4] as const) {
      expect(playerStorageKey(slot)).toBe(
        `${STORAGE_APP_NAMESPACE}.${STORAGE_BINDINGS_DOMAIN}.${STORAGE_BINDINGS_VERSION_SEGMENT}.player.${slot}`,
      );
    }
  });

  it('version segment matches BINDINGS_SCHEMA_VERSION', () => {
    expect(STORAGE_BINDINGS_VERSION_SEGMENT).toBe(`v${BINDINGS_SCHEMA_VERSION}`);
  });

  it('ALL_BINDINGS_STORAGE_KEYS lists snapshot + 4 per-slot keys', () => {
    expect(ALL_BINDINGS_STORAGE_KEYS).toEqual([
      snapshotStorageKey(),
      playerStorageKey(1),
      playerStorageKey(2),
      playerStorageKey(3),
      playerStorageKey(4),
    ]);
  });

  it('every owned key starts with the app namespace', () => {
    for (const key of ALL_BINDINGS_STORAGE_KEYS) {
      expect(key.startsWith(`${STORAGE_APP_NAMESPACE}.`)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Save / load round-trips
// ---------------------------------------------------------------------------

describe('saveBindingsSnapshot + loadBindingsSnapshot', () => {
  it('round-trips a full snapshot through storage', () => {
    const storage = new InMemoryStorage();
    const snap = fullSnapshot();
    const saved = saveBindingsSnapshot(snap, storage);
    expect(saved.ok).toBe(true);
    expect(storage.has(snapshotStorageKey())).toBe(true);

    const loaded = loadBindingsSnapshot(storage);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).toEqual(snap);
    }
  });

  it('persisted blob is the canonical serializer output', () => {
    const storage = new InMemoryStorage();
    const snap = fullSnapshot();
    saveBindingsSnapshot(snap, storage);
    const stored = storage.getItem(snapshotStorageKey());
    expect(stored).toBe(serializeBindingsSnapshot(snap));
  });

  it('load returns missing when no snapshot is stored', () => {
    const storage = new InMemoryStorage();
    const result = loadBindingsSnapshot(storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('missing');
  });

  it('load returns corrupted on invalid JSON', () => {
    const storage = new InMemoryStorage();
    storage.rawSet(snapshotStorageKey(), '{not valid json');
    const result = loadBindingsSnapshot(storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('corrupted');
  });

  it('load returns corrupted when a playerBindings envelope is at the snapshot key', () => {
    const storage = new InMemoryStorage();
    // Write a *valid* per-player envelope to the snapshot key.
    storage.rawSet(
      snapshotStorageKey(),
      serializePlayerBindings(DEFAULT_PLAYER_BINDINGS[1]),
    );
    const result = loadBindingsSnapshot(storage);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('corrupted');
      expect(result.error).toMatch(/playerBindings.*bindingsSnapshot/);
    }
  });

  it('load returns too-new on a future schemaVersion', () => {
    // AC 40003 Sub-AC 3 — the migration framework now distinguishes
    // "blob is from a newer build of the game" from generic
    // corruption. The storage layer surfaces `too-new` so the settings
    // UI can advise "upgrade your build" rather than "your save is
    // junk".
    const storage = new InMemoryStorage();
    storage.rawSet(
      snapshotStorageKey(),
      JSON.stringify({
        schemaVersion: BINDINGS_SCHEMA_VERSION + 1,
        kind: 'bindingsSnapshot',
        data: {},
      }),
    );
    const result = loadBindingsSnapshot(storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('too-new');
  });

  it('save returns corrupted when refusing to write malformed input', () => {
    const storage = new InMemoryStorage();
    // Drop slot 4 — the serializer will reject this snapshot.
    const broken = {
      1: DEFAULT_PLAYER_BINDINGS[1],
      2: DEFAULT_PLAYER_BINDINGS[2],
      3: DEFAULT_PLAYER_BINDINGS[3],
      // 4 deliberately missing
    } as unknown as Record<PlayerBindingsIndex, PlayerBindings>;
    const result = saveBindingsSnapshot(broken, storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('corrupted');
    // Nothing was written.
    expect(storage.size()).toBe(0);
  });

  it('save reports write-failed when setItem throws (quota / private mode)', () => {
    const result = saveBindingsSnapshot(fullSnapshot(), new ThrowingStorage());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('write-failed');
      expect(result.error).toContain('boom-set');
    }
  });

  it('load reports corrupted when getItem throws', () => {
    const result = loadBindingsSnapshot(new ThrowingStorage());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('corrupted');
      expect(result.error).toContain('boom-get');
    }
  });
});

// ---------------------------------------------------------------------------
// Per-slot save / load
// ---------------------------------------------------------------------------

describe('savePlayerBindings + loadPlayerBindings', () => {
  it('round-trips a single slot losslessly', () => {
    const storage = new InMemoryStorage();
    const saved = savePlayerBindings(1, customP1, storage);
    expect(saved.ok).toBe(true);
    const loaded = loadPlayerBindings(1, storage);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value).toEqual(customP1);
  });

  it('rejects slot/payload mismatch on save', () => {
    const storage = new InMemoryStorage();
    const result = savePlayerBindings(2, customP1, storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('corrupted');
    expect(storage.size()).toBe(0);
  });

  it('rejects an envelope of the wrong kind on load', () => {
    const storage = new InMemoryStorage();
    storage.rawSet(playerStorageKey(1), serializeBindingsSnapshot(fullSnapshot()));
    const result = loadPlayerBindings(1, storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('corrupted');
  });

  it('rejects a payload whose playerIndex disagrees with the slot key', () => {
    const storage = new InMemoryStorage();
    // Place a valid P3 envelope into the P1 key — mismatch.
    storage.rawSet(playerStorageKey(1), serializePlayerBindings(DEFAULT_PLAYER_BINDINGS[3]));
    const result = loadPlayerBindings(1, storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('corrupted');
  });

  it('returns missing for a slot that was never saved', () => {
    const storage = new InMemoryStorage();
    const result = loadPlayerBindings(4, storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('missing');
  });
});

// ---------------------------------------------------------------------------
// Defaults fallback
// ---------------------------------------------------------------------------

describe('loadBindingsSnapshotOrDefaults', () => {
  it('returns storage value with source = storage when present', () => {
    const storage = new InMemoryStorage();
    saveBindingsSnapshot(fullSnapshot(), storage);
    const r = loadBindingsSnapshotOrDefaults(storage);
    expect(r.source).toBe('storage');
    expect(r.bindings[1]).toEqual(customP1);
  });

  it('falls back to defaults with the missing reason when nothing is stored', () => {
    const storage = new InMemoryStorage();
    const r = loadBindingsSnapshotOrDefaults(storage);
    expect(r.source).toBe('defaults');
    expect(r.fallbackReason).toBe('missing');
    expect(r.bindings[1]).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
    expect(r.bindings[4]).toEqual(DEFAULT_PLAYER_BINDINGS[4]);
  });

  it('falls back with the corrupted reason when the blob is malformed', () => {
    const storage = new InMemoryStorage();
    storage.rawSet(snapshotStorageKey(), 'definitely not json');
    const r = loadBindingsSnapshotOrDefaults(storage);
    expect(r.source).toBe('defaults');
    expect(r.fallbackReason).toBe('corrupted');
  });

  it('result can seed an InputBindingsStore directly', () => {
    const storage = new InMemoryStorage();
    saveBindingsSnapshot(fullSnapshot(), storage);
    const r = loadBindingsSnapshotOrDefaults(storage);
    const store = new InputBindingsStore({ overrides: r.bindings });
    expect(store.get(1)).toEqual(customP1);
    expect(store.get(2)).toEqual(DEFAULT_PLAYER_BINDINGS[2]);
  });
});

// ---------------------------------------------------------------------------
// Storage availability
// ---------------------------------------------------------------------------

describe('storage availability', () => {
  // We restore any global mutation at the end of each test.
  const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

  afterEach(() => {
    if (originalLocalStorage === undefined) {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    } else {
      (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
    }
  });

  it('returns unavailable when caller passes explicit null', () => {
    const result = loadBindingsSnapshot(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unavailable');
  });

  it('save with explicit null is a no-op and returns unavailable', () => {
    const result = saveBindingsSnapshot(fullSnapshot(), null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unavailable');
  });

  it('clear with explicit null returns unavailable', () => {
    const result = clearBindingsStorage(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unavailable');
  });

  it('hasStoredBindingsSnapshot returns false when explicit null', () => {
    expect(hasStoredBindingsSnapshot(null)).toBe(false);
  });

  it('falls back to globalThis.localStorage when no argument is supplied', () => {
    const store = new InMemoryStorage();
    (globalThis as { localStorage?: unknown }).localStorage = store;

    const saved = saveBindingsSnapshot(fullSnapshot());
    expect(saved.ok).toBe(true);
    expect(store.has(snapshotStorageKey())).toBe(true);

    const loaded = loadBindingsSnapshot();
    expect(loaded.ok).toBe(true);
  });

  it('returns unavailable when no localStorage is on the global', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    const result = loadBindingsSnapshot();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unavailable');
  });

  it('returns unavailable when the global access throws (Safari private mode)', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    const result = loadBindingsSnapshot();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------
// Maintenance: clear + has
// ---------------------------------------------------------------------------

describe('clearBindingsStorage + hasStoredBindingsSnapshot', () => {
  it('clearBindingsStorage removes every owned key', () => {
    const storage = new InMemoryStorage();
    saveBindingsSnapshot(fullSnapshot(), storage);
    savePlayerBindings(1, customP1, storage);
    expect(storage.size()).toBeGreaterThan(0);
    const r = clearBindingsStorage(storage);
    expect(r.ok).toBe(true);
    expect(storage.size()).toBe(0);
  });

  it('clearBindingsStorage leaves non-bindings keys alone', () => {
    const storage = new InMemoryStorage();
    storage.rawSet('platformfighter.audio.v1.master', '0.8');
    storage.rawSet('totally-unrelated-key', 'x');
    saveBindingsSnapshot(fullSnapshot(), storage);
    clearBindingsStorage(storage);
    expect(storage.has('platformfighter.audio.v1.master')).toBe(true);
    expect(storage.has('totally-unrelated-key')).toBe(true);
    expect(storage.has(snapshotStorageKey())).toBe(false);
  });

  it('clearBindingsStorage reports write-failed but still attempts every key', () => {
    const removed: string[] = [];
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: vi.fn((key: string) => {
        removed.push(key);
        if (key === snapshotStorageKey()) {
          throw new Error('boom-snapshot-remove');
        }
      }),
    };
    const r = clearBindingsStorage(storage);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('write-failed');
      expect(r.error).toContain('boom-snapshot-remove');
    }
    // All five keys were attempted even though the first errored.
    expect(removed).toEqual(ALL_BINDINGS_STORAGE_KEYS);
  });

  it('hasStoredBindingsSnapshot is false before save and true after', () => {
    const storage = new InMemoryStorage();
    expect(hasStoredBindingsSnapshot(storage)).toBe(false);
    saveBindingsSnapshot(fullSnapshot(), storage);
    expect(hasStoredBindingsSnapshot(storage)).toBe(true);
  });

  it('hasStoredBindingsSnapshot returns false if getItem throws', () => {
    expect(hasStoredBindingsSnapshot(new ThrowingStorage())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Determinism — byte-stable round-trip
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('two saves of the same snapshot produce byte-identical blobs', () => {
    const a = new InMemoryStorage();
    const b = new InMemoryStorage();
    saveBindingsSnapshot(fullSnapshot(), a);
    saveBindingsSnapshot(fullSnapshot(), b);
    expect(a.getItem(snapshotStorageKey())).toBe(b.getItem(snapshotStorageKey()));
  });

  it('save → load → save produces the same blob', () => {
    const storage = new InMemoryStorage();
    saveBindingsSnapshot(fullSnapshot(), storage);
    const first = storage.getItem(snapshotStorageKey());
    const loaded = loadBindingsSnapshot(storage);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      saveBindingsSnapshot(loaded.value, storage);
    }
    const second = storage.getItem(snapshotStorageKey());
    expect(second).toBe(first);
  });
});
