/**
 * AC 30102 Sub-AC 2 — high-level CRUD façade tests.
 *
 * Drives {@link ReplayLibrary} through every code path the AC names:
 *
 *   • CRUD against IDB (primary backend) — save / load / list / delete.
 *   • CRUD against localStorage (fallback backend).
 *   • Auto-fallback — when IDB throws on open, the library transparently
 *     opens localStorage and exposes a diagnostic message.
 *   • Auto-fallback — when neither IDB nor localStorage is available, the
 *     library lands on memory storage (so a CLI can still drive it).
 *   • `loadWithMetadata` / `loadOrThrow` — alternate read shapes.
 *   • Close — subsequent CRUD calls throw `/closed/`.
 *
 * Both backends are exercised against the in-memory shims used by the
 * lower-level tests so vitest's plain Node environment runs them with
 * no browser shim plumbing.
 */

import { describe, it, expect } from 'vitest';
import type { MatchConfig, PlayerSlot } from '../types';
import { RecordingController } from './RecordingController';
import { ReplayLibrary } from './ReplayLibrary';
import {
  ReplayNotFoundError,
  ReplayStorageError,
  type ReplayStorageBackend,
} from './ReplayStorage';
import type { ReplayFile } from './ReplayFile';
import { FakeIDBFactory } from './__fixtures__/fakeIndexedDB';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/**
 * In-memory `Storage` shim with the minimum surface the localStorage
 * backend uses. Mirrors the shim in `LocalStorageReplayStorage.test.ts`
 * but lives separately so the two suites cannot influence each other.
 */
class FakeStorage implements Storage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  key(n: number): string | null {
    return [...this.map.keys()][n] ?? null;
  }

  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }

  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }

  removeItem(k: string): void {
    this.map.delete(k);
  }

  clear(): void {
    this.map.clear();
  }

  /** Test helper. */
  keys(): string[] {
    return [...this.map.keys()];
  }
}

/**
 * IDBFactory whose `open` synchronously throws — simulates the
 * private-mode Firefox "IDB is denied" path.
 */
class ThrowingIDBFactory {
  open(): never {
    throw new Error('IndexedDB is disabled in this browser context');
  }
}

/**
 * IDBFactory whose `open` returns a request that fires `onerror` on its
 * next microtask — simulates a quota-exhausted IDB rejecting the open.
 */
class FailingOpenIDBFactory {
  open(): {
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
    onupgradeneeded: (() => void) | null;
    onblocked: (() => void) | null;
    error: Error;
  } {
    const req = {
      onsuccess: null as null | (() => void),
      onerror: null as null | (() => void),
      onupgradeneeded: null as null | (() => void),
      onblocked: null as null | (() => void),
      error: new Error('open denied (private mode)'),
    };
    queueMicrotask(() => {
      if (req.onerror) req.onerror();
    });
    return req;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePlayerSlots(count: number): PlayerSlot[] {
  const ids = ['wolf', 'cat', 'owl', 'bear'] as const;
  return Array.from({ length: count }, (_, i) => ({
    index: (i + 1) as PlayerSlot['index'],
    characterId: ids[i]!,
    paletteIndex: i,
    inputType: i === 0 ? 'keyboard_p1' : i === 1 ? 'keyboard_p2' : 'ai',
    ...(i >= 2 ? { aiDifficulty: 'easy' as const } : {}),
  }));
}

function makeMatchConfig(seed = 0xc0ffee): MatchConfig {
  return {
    mode: 'stocks',
    stockCount: 3,
    stageId: 'flat',
    players: makePlayerSlots(2),
    rngSeed: seed,
  };
}

function buildReplay(seed = 0xc0ffee, notes = 'lib-test'): ReplayFile {
  const c = new RecordingController({
    engineVersion: '1.0.0',
    nowFactory: () => new Date('2026-04-30T12:00:00.000Z'),
  });
  c.start({ matchConfig: makeMatchConfig(seed), notes });
  c.captureFrame(0, [
    { moveX: 1, moveY: 0, jump: false, attack: false, dropThrough: false },
    { moveX: -1, moveY: 0, jump: false, attack: false, dropThrough: false },
  ]);
  c.captureFrame(1, [
    { moveX: 0, moveY: 0, jump: true, attack: false, dropThrough: false },
    { moveX: 0, moveY: 0, jump: false, attack: true, dropThrough: false },
  ]);
  c.stop();
  return c.buildReplayFile();
}

interface OpenLibraryHelper {
  lib: ReplayLibrary;
  observed: { backend: ReplayStorageBackend; usedFallback: boolean; fallbackReason: string | null }[];
}

/** Shared helper that builds a library against a configurable backend mix. */
async function openLibrary(opts: {
  indexedDBFactory?: IDBFactory;
  localStorageRef?: Storage;
  prefer?: 'auto' | ReplayStorageBackend;
  namespace?: string;
}): Promise<OpenLibraryHelper> {
  const observed: OpenLibraryHelper['observed'] = [];
  let counter = 0;
  let day = 0;
  const lib = await ReplayLibrary.open({
    indexedDBFactory: opts.indexedDBFactory,
    localStorageRef: opts.localStorageRef,
    prefer: opts.prefer ?? 'auto',
    namespace: opts.namespace,
    idFactory: () => `id-${(counter += 1)}`,
    nowFactory: () => {
      day += 1;
      return new Date(`2026-05-${String(day).padStart(2, '0')}T00:00:00.000Z`);
    },
    onBackendOpen: (info) => observed.push(info),
  });
  return { lib, observed };
}

// ---------------------------------------------------------------------------
// CRUD — IndexedDB primary path
// ---------------------------------------------------------------------------

describe('ReplayLibrary — CRUD against IndexedDB', () => {
  it('save → load → list → delete works against IDB', async () => {
    const idb = new FakeIDBFactory();
    const { lib } = await openLibrary({
      indexedDBFactory: idb as unknown as IDBFactory,
      namespace: 'lib-test-idb',
    });
    expect(lib.backend).toBe('indexeddb');

    // save
    const meta = await lib.save(buildReplay(0x1));
    expect(meta.id).toBe('id-1');
    expect(meta.rngSeed).toBe(0x1);
    expect(meta.sizeBytes).toBeGreaterThan(0);

    // load returns the ReplayFile directly
    const replay = await lib.load(meta.id);
    expect(replay).not.toBeNull();
    expect(replay!.rngSeed).toBe(0x1);
    expect(Object.isFrozen(replay)).toBe(true);

    // list returns the saved row
    const list = await lib.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(meta.id);

    // delete removes it
    expect(await lib.delete(meta.id)).toBe(true);
    expect(await lib.delete(meta.id)).toBe(false); // idempotent
    expect(await lib.list()).toHaveLength(0);
    expect(await lib.load(meta.id)).toBeNull();

    await lib.close();
  });

  it('list orders newest-first across multiple saves', async () => {
    const idb = new FakeIDBFactory();
    const { lib } = await openLibrary({
      indexedDBFactory: idb as unknown as IDBFactory,
      namespace: 'lib-list-order',
    });
    await lib.save(buildReplay(0xaa));
    await lib.save(buildReplay(0xbb));
    await lib.save(buildReplay(0xcc));
    const list = await lib.list();
    expect(list.map((m) => m.id)).toEqual(['id-3', 'id-2', 'id-1']);
    await lib.close();
  });

  it('loadWithMetadata returns both pieces; loadOrThrow throws on miss', async () => {
    const idb = new FakeIDBFactory();
    const { lib } = await openLibrary({
      indexedDBFactory: idb as unknown as IDBFactory,
      namespace: 'lib-load-shapes',
    });
    const meta = await lib.save(buildReplay(0xdd));
    const pair = await lib.loadWithMetadata(meta.id);
    expect(pair).not.toBeNull();
    expect(pair!.metadata.id).toBe(meta.id);
    expect(pair!.replay.rngSeed).toBe(0xdd);

    await expect(lib.loadOrThrow('absent')).rejects.toBeInstanceOf(
      ReplayNotFoundError,
    );
    await lib.close();
  });
});

// ---------------------------------------------------------------------------
// CRUD — localStorage backend
// ---------------------------------------------------------------------------

describe('ReplayLibrary — CRUD against localStorage', () => {
  it('save → load → list → delete works against localStorage', async () => {
    const ls = new FakeStorage();
    const { lib } = await openLibrary({
      localStorageRef: ls,
      prefer: 'localstorage',
      namespace: 'pf:lib:',
    });
    expect(lib.backend).toBe('localstorage');

    const meta = await lib.save(buildReplay(0x42));
    expect(meta.id).toBe('id-1');
    // The localStorage backend writes data + meta + index keys.
    const keys = ls.keys().sort();
    expect(keys).toEqual(
      expect.arrayContaining(['pf:lib:data:id-1', 'pf:lib:meta:id-1', 'pf:lib:index']),
    );

    const replay = await lib.load(meta.id);
    expect(replay!.rngSeed).toBe(0x42);

    const list = await lib.list();
    expect(list).toHaveLength(1);

    expect(await lib.delete(meta.id)).toBe(true);
    expect(await lib.list()).toHaveLength(0);
    await lib.close();
  });

  it('clear / has / getStats round out the surface', async () => {
    const ls = new FakeStorage();
    const { lib } = await openLibrary({
      localStorageRef: ls,
      prefer: 'localstorage',
      namespace: 'pf:lib:',
    });
    await lib.save(buildReplay(0x1));
    await lib.save(buildReplay(0x2));
    expect(await lib.has('id-1')).toBe(true);
    expect(await lib.has('absent')).toBe(false);
    const stats = await lib.getStats();
    expect(stats.count).toBe(2);
    expect(stats.backend).toBe('localstorage');
    await lib.clear();
    expect(await lib.list()).toHaveLength(0);
    expect((await lib.getStats()).count).toBe(0);
    await lib.close();
  });
});

// ---------------------------------------------------------------------------
// Fallback path — IDB unavailable → localStorage
// ---------------------------------------------------------------------------

describe('ReplayLibrary — IDB→localStorage fallback', () => {
  it('falls back to localStorage when IDB factory.open throws synchronously', async () => {
    const idb = new ThrowingIDBFactory();
    const ls = new FakeStorage();
    const { lib, observed } = await openLibrary({
      indexedDBFactory: idb as unknown as IDBFactory,
      localStorageRef: ls,
      namespace: 'pf:fb:',
    });
    expect(lib.backend).toBe('localstorage');
    expect(lib.usedFallback).toBe(true);
    expect(lib.fallbackReason).toMatch(/IndexedDB|disabled|threw/i);

    // CRUD still works after the fallback.
    const meta = await lib.save(buildReplay(0x99));
    const replay = await lib.load(meta.id);
    expect(replay!.rngSeed).toBe(0x99);
    expect(await lib.delete(meta.id)).toBe(true);

    // The onBackendOpen hook saw the fallback flag.
    expect(observed).toHaveLength(1);
    expect(observed[0]!).toMatchObject({
      backend: 'localstorage',
      usedFallback: true,
    });
    expect(observed[0]!.fallbackReason).toBeTruthy();
    await lib.close();
  });

  it('falls back to localStorage when IDB open emits onerror asynchronously', async () => {
    const idb = new FailingOpenIDBFactory();
    const ls = new FakeStorage();
    const { lib } = await openLibrary({
      indexedDBFactory: idb as unknown as IDBFactory,
      localStorageRef: ls,
      namespace: 'pf:fb-async:',
    });
    expect(lib.backend).toBe('localstorage');
    expect(lib.usedFallback).toBe(true);
    expect(lib.fallbackReason).toMatch(/denied|private/i);

    // CRUD still works.
    await lib.save(buildReplay(0x123));
    const list = await lib.list();
    expect(list).toHaveLength(1);
    await lib.close();
  });

  it('falls back to memory when neither IDB nor localStorage is available', async () => {
    const { lib } = await openLibrary({
      indexedDBFactory: undefined,
      localStorageRef: undefined,
    });
    expect(lib.backend).toBe('memory');
    // Memory isn't an IDB *fallback* — there was no IDB to fail. The
    // library should not pretend a fallback occurred when both backends
    // were simply absent.
    expect(lib.usedFallback).toBe(false);
    await lib.save(buildReplay(0x1));
    expect(await lib.list()).toHaveLength(1);
    await lib.close();
  });

  it('does not flag fallback when the caller pinned prefer=memory', async () => {
    const { lib } = await openLibrary({ prefer: 'memory' });
    expect(lib.backend).toBe('memory');
    expect(lib.usedFallback).toBe(false);
    expect(lib.fallbackReason).toBeNull();
    await lib.close();
  });

  it('does not flag fallback when IDB is the chosen backend', async () => {
    const idb = new FakeIDBFactory();
    const { lib } = await openLibrary({
      indexedDBFactory: idb as unknown as IDBFactory,
      namespace: 'pf:no-fb:',
    });
    expect(lib.backend).toBe('indexeddb');
    expect(lib.usedFallback).toBe(false);
    expect(lib.fallbackReason).toBeNull();
    await lib.close();
  });
});

// ---------------------------------------------------------------------------
// Cross-backend invariant — same replay survives both IDB and LS
// ---------------------------------------------------------------------------

describe('ReplayLibrary — cross-backend round-trip', () => {
  it('a replay saved through IDB and through LS yields identical payloads', async () => {
    const original = buildReplay(0xdead, 'cross-backend');

    const idb = new FakeIDBFactory();
    const { lib: idbLib } = await openLibrary({
      indexedDBFactory: idb as unknown as IDBFactory,
      namespace: 'pf:xb-idb:',
    });
    const idbMeta = await idbLib.save(original);
    const idbReplay = await idbLib.load(idbMeta.id);
    await idbLib.close();

    const ls = new FakeStorage();
    const { lib: lsLib } = await openLibrary({
      localStorageRef: ls,
      prefer: 'localstorage',
      namespace: 'pf:xb-ls:',
    });
    const lsMeta = await lsLib.save(original);
    const lsReplay = await lsLib.load(lsMeta.id);
    await lsLib.close();

    expect(idbReplay).not.toBeNull();
    expect(lsReplay).not.toBeNull();
    expect(idbReplay!.rngSeed).toBe(lsReplay!.rngSeed);
    expect(idbReplay!.matchConfig.players.length).toBe(
      lsReplay!.matchConfig.players.length,
    );
    expect(idbReplay!.metadata.notes).toBe(lsReplay!.metadata.notes);
    expect(idbReplay!.inputTimeline.entries.length).toBe(
      lsReplay!.inputTimeline.entries.length,
    );
  });
});

// ---------------------------------------------------------------------------
// Close discipline
// ---------------------------------------------------------------------------

describe('ReplayLibrary — close', () => {
  it('CRUD calls throw /closed/ after close()', async () => {
    const ls = new FakeStorage();
    const { lib } = await openLibrary({
      localStorageRef: ls,
      prefer: 'localstorage',
      namespace: 'pf:closed:',
    });
    await lib.save(buildReplay(0x1));
    await lib.close();

    await expect(lib.save(buildReplay(0x2))).rejects.toBeInstanceOf(
      ReplayStorageError,
    );
    await expect(lib.load('id-1')).rejects.toThrow(/closed/);
    await expect(lib.list()).rejects.toThrow(/closed/);
    await expect(lib.delete('id-1')).rejects.toThrow(/closed/);
    // Idempotent.
    await expect(lib.close()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error surface
// ---------------------------------------------------------------------------

describe('ReplayLibrary — error surface', () => {
  it('rejects malformed replays before touching storage', async () => {
    const ls = new FakeStorage();
    const { lib } = await openLibrary({
      localStorageRef: ls,
      prefer: 'localstorage',
      namespace: 'pf:err:',
    });
    await expect(
      lib.save({ format: 'wrong' } as unknown as ReplayFile),
    ).rejects.toBeInstanceOf(ReplayStorageError);
    expect(ls.keys().length).toBe(0);
    await lib.close();
  });

  it('refuses to overwrite without overwrite: true', async () => {
    const ls = new FakeStorage();
    const { lib } = await openLibrary({
      localStorageRef: ls,
      prefer: 'localstorage',
      namespace: 'pf:err:',
    });
    await lib.save(buildReplay(), { id: 'row' });
    await expect(lib.save(buildReplay(), { id: 'row' })).rejects.toThrow(
      /already exists/,
    );
    await lib.close();
  });

  it('throws when prefer=indexeddb but no factory is available', async () => {
    await expect(
      ReplayLibrary.open({ prefer: 'indexeddb', indexedDBFactory: undefined }),
    ).rejects.toBeInstanceOf(ReplayStorageError);
  });
});
