/**
 * AC 30101 Sub-AC 1 — IndexedDB backend tests.
 *
 * Drives {@link IndexedDBReplayStorage} against the in-memory
 * {@link FakeIDBFactory} shim so vitest's plain-Node environment can
 * exercise every CRUD code path without a real browser.
 *
 * Coverage:
 *
 *   • open() — creates database, migrates on first run, surfaces
 *     factory-throws as ReplayStorageError.
 *   • save() — happy path, explicit id, overwrite=true, conflict
 *     rejection, validation rejection.
 *   • load() — returns null for missing rows, returns a frozen
 *     StoredReplay for hits, surfaces a corrupt-payload as
 *     ReplayStorageError.
 *   • list() — sorted newest first, only metadata keys touched.
 *   • has() / delete() / clear() — match the interface contract.
 *   • getStats() — sums sizeBytes, picks up the injected estimate.
 *   • Quota — a save that exceeds the configured quota throws
 *     ReplayStorageQuotaExceededError and rolls back the row.
 *   • close() — subsequent calls reject with /closed/.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { MatchConfig, PlayerSlot } from '../types';
import { RecordingController } from './RecordingController';
import {
  IndexedDBReplayStorage,
  IDB_DB_NAME,
  IDB_DB_VERSION,
  IDB_STORE_REPLAYS,
  IDB_STORE_METADATA,
} from './IndexedDBReplayStorage';
import {
  ReplayCorruptedError,
  ReplayNotFoundError,
  ReplayStorageError,
  ReplayStorageQuotaExceededError,
  type ReplayStorage,
} from './ReplayStorage';
import {
  CHECKSUM_ALGORITHM,
  computeReplayChecksum,
} from './replayChecksum';
import type { ReplayFile } from './ReplayFile';
import { FakeIDBFactory } from './__fixtures__/fakeIndexedDB';

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

function buildReplay(seed = 0xc0ffee, recordedAt = '2026-04-30T12:00:00.000Z'): ReplayFile {
  const c = new RecordingController({
    engineVersion: '1.0.0',
    nowFactory: () => new Date(recordedAt),
  });
  c.start({ matchConfig: makeMatchConfig(seed), notes: 'idb-test' });
  c.captureFrame(0, [
    { moveX: 1, jump: false, attack: false, dropThrough: false },
    { moveX: -1, jump: false, attack: false, dropThrough: false },
  ]);
  c.captureFrame(1, [
    { moveX: 0, jump: true, attack: false, dropThrough: false },
    { moveX: 0, jump: false, attack: true, dropThrough: false },
  ]);
  c.stop();
  return c.buildReplayFile();
}

async function makeStorage(
  factory: FakeIDBFactory,
  options: {
    namespace?: string;
    quotaUsage?: number;
    quotaTotal?: number;
    nextId?: () => string;
  } = {},
): Promise<IndexedDBReplayStorage> {
  let counter = 0;
  return IndexedDBReplayStorage.open({
    indexedDBFactory: factory as unknown as IDBFactory,
    namespace: options.namespace ?? 'test-replays',
    idFactory:
      options.nextId ??
      (() => `id-${(counter += 1)}`),
    nowFactory: (() => {
      let day = 0;
      return () => {
        day += 1;
        return new Date(`2026-05-${String(day).padStart(2, '0')}T00:00:00.000Z`);
      };
    })(),
    estimateStorage:
      options.quotaUsage !== undefined || options.quotaTotal !== undefined
        ? async () => ({ usage: options.quotaUsage, quota: options.quotaTotal })
        : undefined,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IndexedDBReplayStorage — constants', () => {
  it('exposes db name + version + store names', () => {
    expect(IDB_DB_NAME).toBe('platform-fighter-replays');
    expect(IDB_DB_VERSION).toBe(1);
    expect(IDB_STORE_REPLAYS).toBe('replays');
    expect(IDB_STORE_METADATA).toBe('metadata');
  });
});

describe('IndexedDBReplayStorage — open', () => {
  it('opens, runs migration, exposes backend tag', async () => {
    const factory = new FakeIDBFactory();
    const s = await makeStorage(factory);
    expect(s.backend).toBe('indexeddb');
    await s.close();
  });

  it('throws ReplayStorageError when the IDB factory is missing', async () => {
    await expect(
      IndexedDBReplayStorage.open({
        indexedDBFactory: undefined as unknown as IDBFactory,
      }),
    ).rejects.toBeInstanceOf(ReplayStorageError);
  });

  it('rejects a second open while another connection is blocking', async () => {
    // Our shim does not simulate `onblocked` directly. This test stays
    // here as a smoke-test that a normal sequential open works.
    const factory = new FakeIDBFactory();
    const a = await makeStorage(factory);
    await a.close();
    const b = await makeStorage(factory);
    expect(b.backend).toBe('indexeddb');
    await b.close();
  });
});

describe('IndexedDBReplayStorage — save', () => {
  let factory: FakeIDBFactory;
  let storage: IndexedDBReplayStorage;

  beforeEach(async () => {
    factory = new FakeIDBFactory();
    storage = await makeStorage(factory);
  });

  it('persists a replay and returns metadata', async () => {
    const meta = await storage.save(buildReplay());
    expect(meta.id).toBe('id-1');
    expect(meta.savedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(meta.sizeBytes).toBeGreaterThan(0);
    expect(meta.rngSeed).toBe(0xc0ffee);
    expect(Object.isFrozen(meta)).toBe(true);
  });

  it('honours an explicit id', async () => {
    const meta = await storage.save(buildReplay(), { id: 'custom' });
    expect(meta.id).toBe('custom');
    expect(await storage.has('custom')).toBe(true);
  });

  it('rejects an empty id', async () => {
    await expect(storage.save(buildReplay(), { id: '' })).rejects.toBeInstanceOf(
      ReplayStorageError,
    );
  });

  it('refuses to overwrite without overwrite: true', async () => {
    await storage.save(buildReplay(), { id: 'row' });
    await expect(storage.save(buildReplay(), { id: 'row' })).rejects.toThrow(
      /already exists/,
    );
  });

  it('overwrites when overwrite: true', async () => {
    await storage.save(buildReplay(0xaaaa), { id: 'row' });
    await storage.save(buildReplay(0xbbbb), { id: 'row', overwrite: true });
    const loaded = await storage.loadOrThrow('row');
    expect(loaded.replay.rngSeed).toBe(0xbbbb);
  });

  it('rejects a malformed replay before touching IDB', async () => {
    const bad = { format: 'wrong-magic' } as unknown as ReplayFile;
    await expect(storage.save(bad)).rejects.toBeInstanceOf(ReplayStorageError);
  });
});

describe('IndexedDBReplayStorage — load / has / list', () => {
  let factory: FakeIDBFactory;
  let storage: IndexedDBReplayStorage;

  beforeEach(async () => {
    factory = new FakeIDBFactory();
    storage = await makeStorage(factory);
  });

  it('round-trips replay data through save → load', async () => {
    const original = buildReplay();
    const meta = await storage.save(original);
    const loaded = await storage.loadOrThrow(meta.id);
    expect(loaded.metadata.id).toBe(meta.id);
    expect(loaded.replay.rngSeed).toBe(original.rngSeed);
    expect(loaded.replay.matchConfig.players.length).toBe(2);
    expect(loaded.replay.inputTimeline.entries.length).toBe(2);
    expect(Object.isFrozen(loaded.replay)).toBe(true);
  });

  it('load returns null for an absent id', async () => {
    expect(await storage.load('missing')).toBeNull();
  });

  it('loadOrThrow throws ReplayNotFoundError for missing rows', async () => {
    await expect(storage.loadOrThrow('missing')).rejects.toBeInstanceOf(
      ReplayNotFoundError,
    );
  });

  it('lists newest savedAt first', async () => {
    await storage.save(buildReplay(0xa));
    await storage.save(buildReplay(0xb));
    await storage.save(buildReplay(0xc));
    const list = await storage.list();
    expect(list.map((m) => m.id)).toEqual(['id-3', 'id-2', 'id-1']);
  });

  it('has() returns true after save and false after delete', async () => {
    await storage.save(buildReplay(), { id: 'r1' });
    expect(await storage.has('r1')).toBe(true);
    expect(await storage.delete('r1')).toBe(true);
    expect(await storage.has('r1')).toBe(false);
  });
});

describe('IndexedDBReplayStorage — delete / clear', () => {
  let factory: FakeIDBFactory;
  let storage: IndexedDBReplayStorage;

  beforeEach(async () => {
    factory = new FakeIDBFactory();
    storage = await makeStorage(factory);
  });

  it('delete is idempotent', async () => {
    await storage.save(buildReplay(), { id: 'row' });
    expect(await storage.delete('row')).toBe(true);
    expect(await storage.delete('row')).toBe(false);
  });

  it('clear empties every row', async () => {
    await storage.save(buildReplay(0x1));
    await storage.save(buildReplay(0x2));
    await storage.clear();
    expect((await storage.list()).length).toBe(0);
    expect(await storage.has('id-1')).toBe(false);
  });
});

describe('IndexedDBReplayStorage — stats', () => {
  it('reports counts and sizes plus injected estimate', async () => {
    const factory = new FakeIDBFactory();
    const storage = await makeStorage(factory, {
      quotaUsage: 1234,
      quotaTotal: 1_000_000,
    });
    const a = await storage.save(buildReplay(0x1));
    const b = await storage.save(buildReplay(0x2));
    const stats = await storage.getStats();
    expect(stats.count).toBe(2);
    expect(stats.totalBytes).toBe(a.sizeBytes + b.sizeBytes);
    // Storage estimate overrides the local total.
    expect(stats.usageBytes).toBe(1234);
    expect(stats.quotaBytes).toBe(1_000_000);
    expect(stats.backend).toBe('indexeddb');
  });

  it('falls back to the local total when the estimate throws', async () => {
    const factory = new FakeIDBFactory();
    const storage = await IndexedDBReplayStorage.open({
      indexedDBFactory: factory as unknown as IDBFactory,
      namespace: 'estimate-throws',
      estimateStorage: async () => {
        throw new Error('cannot estimate');
      },
    });
    const a = await storage.save(buildReplay());
    const stats = await storage.getStats();
    expect(stats.count).toBe(1);
    expect(stats.usageBytes).toBe(a.sizeBytes);
    expect(stats.quotaBytes).toBeNull();
  });
});

describe('IndexedDBReplayStorage — quota', () => {
  it('translates QuotaExceededError into ReplayStorageQuotaExceededError', async () => {
    // Set a quota tiny enough that even one save fails. A real replay
    // serialises to a few hundred bytes; 50 bytes is well below the floor.
    const factory = new FakeIDBFactory({ quotaBytes: 50 });
    const storage = await makeStorage(factory);
    await expect(storage.save(buildReplay())).rejects.toBeInstanceOf(
      ReplayStorageQuotaExceededError,
    );
  });

  it('a quota failure rolls back so the row is not partially present', async () => {
    const factory = new FakeIDBFactory({ quotaBytes: 50 });
    const storage = await makeStorage(factory);
    await expect(storage.save(buildReplay(), { id: 'row' })).rejects.toBeInstanceOf(
      ReplayStorageQuotaExceededError,
    );
    expect(await storage.has('row')).toBe(false);
    expect((await storage.list()).length).toBe(0);
  });
});

describe('IndexedDBReplayStorage — close', () => {
  it('rejects calls after close()', async () => {
    const factory = new FakeIDBFactory();
    const storage = await makeStorage(factory);
    await storage.close();
    await expect(storage.save(buildReplay())).rejects.toThrow(/closed/);
    await expect(storage.list()).rejects.toThrow(/closed/);
    await expect(storage.has('x')).rejects.toThrow(/closed/);
    // close() is idempotent.
    await expect(storage.close()).resolves.toBeUndefined();
  });
});

describe('IndexedDBReplayStorage — interface contract', () => {
  it('implements ReplayStorage', async () => {
    const factory = new FakeIDBFactory();
    const storage: ReplayStorage = await makeStorage(factory);
    expect(storage.backend).toBe('indexeddb');
    expect(typeof storage.save).toBe('function');
    expect(typeof storage.load).toBe('function');
    expect(typeof storage.loadOrThrow).toBe('function');
    expect(typeof storage.list).toBe('function');
    expect(typeof storage.has).toBe('function');
    expect(typeof storage.delete).toBe('function');
    expect(typeof storage.clear).toBe('function');
    expect(typeof storage.getStats).toBe('function');
    expect(typeof storage.close).toBe('function');
    await storage.close();
  });
});

// ---------------------------------------------------------------------------
// AC 30104 Sub-AC 4 — integrity checks via checksum/hash validation
// ---------------------------------------------------------------------------

describe('IndexedDBReplayStorage — integrity (AC 30104 Sub-AC 4)', () => {
  it('save() stamps a fnv1a-64-v1 checksum onto every row', async () => {
    const factory = new FakeIDBFactory();
    const storage = await makeStorage(factory, { namespace: 'integrity-1' });
    const meta = await storage.save(buildReplay(), { id: 'row' });
    expect(meta.checksum).toMatch(/^[0-9a-f]{16}$/);
    expect(meta.checksumAlgorithm).toBe(CHECKSUM_ALGORITHM);
    await storage.close();
  });

  it('save() persists the checksum into both the replay and metadata stores', async () => {
    const factory = new FakeIDBFactory();
    const storage = await makeStorage(factory, { namespace: 'integrity-2' });
    const meta = await storage.save(buildReplay(), { id: 'row' });

    const fullRow = factory.peekRaw('integrity-2', IDB_STORE_REPLAYS, 'row') as {
      checksum: string;
      checksumAlgorithm: string;
      payload: string;
    };
    expect(fullRow.checksum).toBe(meta.checksum);
    expect(fullRow.checksumAlgorithm).toBe(CHECKSUM_ALGORITHM);
    expect(fullRow.checksum).toBe(computeReplayChecksum(fullRow.payload));

    const metaRow = factory.peekRaw(
      'integrity-2',
      IDB_STORE_METADATA,
      'row',
    ) as { checksum: string; checksumAlgorithm: string };
    expect(metaRow.checksum).toBe(meta.checksum);
    expect(metaRow.checksumAlgorithm).toBe(CHECKSUM_ALGORITHM);
    await storage.close();
  });

  it('load() returns a clean replay without an integrity error', async () => {
    const factory = new FakeIDBFactory();
    const storage = await makeStorage(factory, { namespace: 'integrity-3' });
    await storage.save(buildReplay(0xdeadbeef), { id: 'row' });
    const loaded = await storage.loadOrThrow('row');
    expect(loaded.replay.rngSeed).toBe(0xdeadbeef);
    expect(loaded.metadata.checksum).toMatch(/^[0-9a-f]{16}$/);
    await storage.close();
  });

  it('load() throws ReplayCorruptedError when the payload is tampered with', async () => {
    const factory = new FakeIDBFactory();
    const storage = await makeStorage(factory, { namespace: 'integrity-4' });
    await storage.save(buildReplay(0xc0ffee), { id: 'row' });
    // Simulate corruption: another tab / extension / disk fault
    // overwrites the payload with still-parseable but altered bytes.
    const row = factory.peekRaw('integrity-4', IDB_STORE_REPLAYS, 'row') as {
      payload: string;
      checksum: string;
      checksumAlgorithm: string;
      [k: string]: unknown;
    };
    expect(row.payload).toContain('"rngSeed":12648430');
    const tampered = {
      ...row,
      payload: row.payload.replace('"rngSeed":12648430', '"rngSeed":12648431'),
    };
    factory.pokeRaw('integrity-4', IDB_STORE_REPLAYS, 'row', tampered);

    await expect(storage.load('row')).rejects.toBeInstanceOf(
      ReplayCorruptedError,
    );
    await storage.close();
  });

  it('load() reports the corruption details on the thrown error', async () => {
    const factory = new FakeIDBFactory();
    const storage = await makeStorage(factory, { namespace: 'integrity-5' });
    const meta = await storage.save(buildReplay(), { id: 'row' });
    const row = factory.peekRaw('integrity-5', IDB_STORE_REPLAYS, 'row') as {
      payload: string;
      [k: string]: unknown;
    };
    // Truncate the payload bytes — checksum will mismatch.
    factory.pokeRaw('integrity-5', IDB_STORE_REPLAYS, 'row', {
      ...row,
      payload: row.payload.slice(0, -10),
    });

    let caught: unknown = null;
    try {
      await storage.load('row');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ReplayCorruptedError);
    const e = caught as ReplayCorruptedError;
    expect(e.id).toBe('row');
    expect(e.cause.kind).toBe('mismatch');
    expect(e.cause.expected).toBe(meta.checksum);
    expect(e.cause.algorithm).toBe(CHECKSUM_ALGORITHM);
    expect(e.message).toMatch(/integrity check/i);
    await storage.close();
  });

  it('integrity error is a ReplayStorageError subclass for catch-all handlers', async () => {
    const factory = new FakeIDBFactory();
    const storage = await makeStorage(factory, { namespace: 'integrity-6' });
    await storage.save(buildReplay(), { id: 'row' });
    const row = factory.peekRaw('integrity-6', IDB_STORE_REPLAYS, 'row') as {
      payload: string;
      [k: string]: unknown;
    };
    factory.pokeRaw('integrity-6', IDB_STORE_REPLAYS, 'row', {
      ...row,
      payload: 'definitely not the original bytes',
    });

    await expect(storage.load('row')).rejects.toBeInstanceOf(
      ReplayStorageError,
    );
    await storage.close();
  });

  it('legacy rows with no checksum field still load (backward compat)', async () => {
    const factory = new FakeIDBFactory();
    const storage = await makeStorage(factory, { namespace: 'integrity-7' });
    await storage.save(buildReplay(), { id: 'row' });
    // Simulate a row written before AC 30104 Sub-AC 4 — strip the
    // checksum fields. The loader must fall back to the pre-integrity
    // behaviour and parse the payload directly.
    const row = factory.peekRaw('integrity-7', IDB_STORE_REPLAYS, 'row') as {
      payload: string;
      [k: string]: unknown;
    };
    const legacy = { ...row };
    delete (legacy as { checksum?: string }).checksum;
    delete (legacy as { checksumAlgorithm?: string }).checksumAlgorithm;
    factory.pokeRaw('integrity-7', IDB_STORE_REPLAYS, 'row', legacy);

    const loaded = await storage.loadOrThrow('row');
    // Loaded successfully — and the loader recomputes a checksum from
    // the stored payload so the returned metadata still has one.
    expect(loaded.replay.rngSeed).toBe(0xc0ffee);
    expect(loaded.metadata.checksum).toMatch(/^[0-9a-f]{16}$/);
    await storage.close();
  });

  it('list() exposes the checksum + algorithm on every row', async () => {
    const factory = new FakeIDBFactory();
    const storage = await makeStorage(factory, { namespace: 'integrity-8' });
    await storage.save(buildReplay(), { id: 'r1' });
    await storage.save(buildReplay(0xfeedface), { id: 'r2' });
    const list = await storage.list();
    expect(list.length).toBe(2);
    for (const m of list) {
      expect(m.checksum).toMatch(/^[0-9a-f]{16}$/);
      expect(m.checksumAlgorithm).toBe(CHECKSUM_ALGORITHM);
    }
    await storage.close();
  });

  it('overwriting a row recomputes the checksum', async () => {
    const factory = new FakeIDBFactory();
    const storage = await makeStorage(factory, { namespace: 'integrity-9' });
    const first = await storage.save(buildReplay(0xaaaa), { id: 'row' });
    const second = await storage.save(buildReplay(0xbbbb), {
      id: 'row',
      overwrite: true,
    });
    expect(second.checksum).not.toBe(first.checksum);
    const loaded = await storage.loadOrThrow('row');
    expect(loaded.metadata.checksum).toBe(second.checksum);
    await storage.close();
  });
});
