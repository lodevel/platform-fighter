/**
 * AC 30101 Sub-AC 1 — localStorage backend tests.
 *
 * Drives {@link LocalStorageReplayStorage} against an in-memory
 * `Storage`-like shim so vitest's plain-Node environment can exercise
 * every CRUD + quota path without a real browser.
 *
 * Coverage:
 *
 *   • Constructor — rejects when localStorage is unavailable.
 *   • Key layout — uses the configured prefix; index/meta/data keys
 *     are stable.
 *   • CRUD — save / load / list / has / delete / clear all match
 *     the interface contract.
 *   • Overwrite — refused by default, allowed with overwrite: true.
 *   • Quota — the shim simulates `setItem` quota errors; the backend
 *     translates them to `ReplayStorageQuotaExceededError` and rolls
 *     back the partial write.
 *   • Stats — totalBytes / count match the listed rows.
 *   • Close — subsequent calls throw /closed/.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { MatchConfig, PlayerSlot } from '../types';
import { RecordingController } from './RecordingController';
import {
  LocalStorageReplayStorage,
  LS_DEFAULT_PREFIX,
  LS_INDEX_SUFFIX,
  LS_META_SUFFIX,
  LS_DATA_SUFFIX,
} from './LocalStorageReplayStorage';
import {
  ReplayCorruptedError,
  ReplayNotFoundError,
  ReplayStorageError,
  ReplayStorageQuotaExceededError,
} from './ReplayStorage';
import {
  CHECKSUM_ALGORITHM,
  computeReplayChecksum,
} from './replayChecksum';
import type { ReplayFile } from './ReplayFile';

// ---------------------------------------------------------------------------
// In-memory Storage shim
// ---------------------------------------------------------------------------

interface FakeStorageOptions {
  /** Cap on cumulative byte size across keys + values. Default Infinity. */
  quotaBytes?: number;
}

class FakeStorage implements Storage {
  private readonly map = new Map<string, string>();
  private readonly quotaBytes: number;

  constructor(options: FakeStorageOptions = {}) {
    this.quotaBytes =
      typeof options.quotaBytes === 'number' && options.quotaBytes >= 0
        ? options.quotaBytes
        : Number.POSITIVE_INFINITY;
  }

  get length(): number {
    return this.map.size;
  }

  key(n: number): string | null {
    const keys = [...this.map.keys()];
    return keys[n] ?? null;
  }

  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }

  setItem(k: string, v: string): void {
    const prev = this.map.get(k) ?? '';
    const delta = byteLength(v) + byteLength(k) - byteLength(prev) - (this.map.has(k) ? byteLength(k) : 0);
    if (this.computeSize() + delta > this.quotaBytes) {
      const err = new Error('quota exceeded') as Error & { name: string };
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.map.set(k, v);
  }

  removeItem(k: string): void {
    this.map.delete(k);
  }

  clear(): void {
    this.map.clear();
  }

  /** Test helper: read every key for assertions. */
  keys(): string[] {
    return [...this.map.keys()];
  }

  /** Test helper: introspect the cumulative byte usage. */
  computeSize(): number {
    let total = 0;
    for (const [k, v] of this.map) total += byteLength(k) + byteLength(v);
    return total;
  }
}

function byteLength(s: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  return s.length;
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

function buildReplay(seed = 0xc0ffee): ReplayFile {
  const c = new RecordingController({
    engineVersion: '1.0.0',
    nowFactory: () => new Date('2026-04-30T12:00:00.000Z'),
  });
  c.start({ matchConfig: makeMatchConfig(seed), notes: 'ls-test' });
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

function makeStorage(
  storage: FakeStorage,
  options: { namespace?: string; nextId?: () => string } = {},
): LocalStorageReplayStorage {
  let counter = 0;
  let day = 0;
  return new LocalStorageReplayStorage({
    localStorageRef: storage,
    namespace: options.namespace ?? 'pf:test:',
    idFactory: options.nextId ?? (() => `id-${(counter += 1)}`),
    nowFactory: () => {
      day += 1;
      return new Date(`2026-05-${String(day).padStart(2, '0')}T00:00:00.000Z`);
    },
  });
}

// ---------------------------------------------------------------------------
// Constants + constructor
// ---------------------------------------------------------------------------

describe('LocalStorageReplayStorage — constants', () => {
  it('exposes default prefix + suffixes', () => {
    expect(LS_DEFAULT_PREFIX).toBe('pf:replay:');
    expect(LS_INDEX_SUFFIX).toBe('index');
    expect(LS_META_SUFFIX).toBe('meta:');
    expect(LS_DATA_SUFFIX).toBe('data:');
  });
});

describe('LocalStorageReplayStorage — constructor', () => {
  it('throws when localStorage is unavailable', () => {
    expect(
      () => new LocalStorageReplayStorage({ localStorageRef: undefined }),
    ).toThrow(ReplayStorageError);
  });

  it('throws when localStorage stub is missing setItem', () => {
    const broken = {} as Storage;
    expect(
      () => new LocalStorageReplayStorage({ localStorageRef: broken }),
    ).toThrow(ReplayStorageError);
  });

  it('uses the configured namespace', async () => {
    const fake = new FakeStorage();
    const s = makeStorage(fake, { namespace: 'foo:' });
    await s.save(buildReplay(), { id: 'bar' });
    const keys = fake.keys().sort();
    expect(keys).toContain('foo:data:bar');
    expect(keys).toContain('foo:meta:bar');
    expect(keys).toContain('foo:index');
  });
});

// ---------------------------------------------------------------------------
// CRUD lifecycle
// ---------------------------------------------------------------------------

describe('LocalStorageReplayStorage — CRUD', () => {
  let fake: FakeStorage;
  let storage: LocalStorageReplayStorage;

  beforeEach(() => {
    fake = new FakeStorage();
    storage = makeStorage(fake);
  });

  it('save returns metadata mirroring the replay header', async () => {
    const meta = await storage.save(buildReplay());
    expect(meta.id).toBe('id-1');
    expect(meta.savedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(meta.sizeBytes).toBeGreaterThan(0);
    expect(meta.rngSeed).toBe(0xc0ffee);
    expect(meta.stageId).toBe('flat');
    expect(meta.notes).toBe('ls-test');
    expect(Object.isFrozen(meta)).toBe(true);
  });

  it('round-trips a replay through save → load', async () => {
    const original = buildReplay();
    const meta = await storage.save(original);
    const fetched = await storage.loadOrThrow(meta.id);
    expect(fetched.metadata.id).toBe(meta.id);
    expect(fetched.replay.rngSeed).toBe(original.rngSeed);
    expect(fetched.replay.matchConfig.players.length).toBe(2);
    expect(Object.isFrozen(fetched.replay)).toBe(true);
  });

  it('load returns null for a missing id', async () => {
    expect(await storage.load('absent')).toBeNull();
  });

  it('loadOrThrow throws ReplayNotFoundError', async () => {
    await expect(storage.loadOrThrow('absent')).rejects.toBeInstanceOf(
      ReplayNotFoundError,
    );
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
    // Index does not duplicate the id on overwrite.
    const indexRaw = fake.getItem('pf:test:index');
    const ids = JSON.parse(indexRaw!);
    expect(ids.filter((id: string) => id === 'row').length).toBe(1);
  });

  it('list returns rows newest savedAt first', async () => {
    await storage.save(buildReplay(0x1));
    await storage.save(buildReplay(0x2));
    await storage.save(buildReplay(0x3));
    const list = await storage.list();
    expect(list.map((m) => m.id)).toEqual(['id-3', 'id-2', 'id-1']);
  });

  it('has / delete / clear behave consistently', async () => {
    await storage.save(buildReplay(), { id: 'row' });
    expect(await storage.has('row')).toBe(true);
    expect(await storage.delete('row')).toBe(true);
    expect(await storage.has('row')).toBe(false);
    expect(await storage.delete('row')).toBe(false); // idempotent
    await storage.save(buildReplay(0xa));
    await storage.save(buildReplay(0xb));
    await storage.clear();
    expect((await storage.list()).length).toBe(0);
    expect(fake.getItem('pf:test:index')).toBeNull();
  });

  it('rejects malformed replays before touching storage', async () => {
    const before = fake.keys().length;
    await expect(
      storage.save({ format: 'wrong' } as unknown as ReplayFile),
    ).rejects.toBeInstanceOf(ReplayStorageError);
    expect(fake.keys().length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

describe('LocalStorageReplayStorage — stats', () => {
  it('reports counts and bytes derived from listed rows', async () => {
    const fake = new FakeStorage();
    const storage = makeStorage(fake);
    const a = await storage.save(buildReplay(0x1));
    const b = await storage.save(buildReplay(0x2));
    const stats = await storage.getStats();
    expect(stats.count).toBe(2);
    expect(stats.totalBytes).toBe(a.sizeBytes + b.sizeBytes);
    expect(stats.usageBytes).toBe(stats.totalBytes);
    expect(stats.quotaBytes).toBeNull();
    expect(stats.backend).toBe('localstorage');
  });
});

// ---------------------------------------------------------------------------
// Quota handling
// ---------------------------------------------------------------------------

describe('LocalStorageReplayStorage — quota', () => {
  it('translates QuotaExceededError into ReplayStorageQuotaExceededError', async () => {
    const fake = new FakeStorage({ quotaBytes: 64 });
    const storage = makeStorage(fake);
    await expect(storage.save(buildReplay())).rejects.toBeInstanceOf(
      ReplayStorageQuotaExceededError,
    );
  });

  it('rolls back the partially-written row on quota failure', async () => {
    // Allocate a budget that fits the data key but not the meta key.
    // Approximate sizes: data ~ 800B JSON, meta ~ 250B + key overhead.
    // A 900B budget lets the data write succeed but blocks the meta write.
    const fake = new FakeStorage({ quotaBytes: 900 });
    const storage = makeStorage(fake);
    await expect(
      storage.save(buildReplay(), { id: 'row' }),
    ).rejects.toBeInstanceOf(ReplayStorageQuotaExceededError);
    // After rollback no data/meta/index keys should remain for this row.
    expect(fake.getItem('pf:test:data:row')).toBeNull();
    expect(fake.getItem('pf:test:meta:row')).toBeNull();
    expect(fake.getItem('pf:test:index')).toBeNull();
  });

  it('rolls back when the index update hits quota', async () => {
    // Fill up most of the budget with one successful save, then shrink
    // the quota so the second save's index update overflows.
    const fake = new FakeStorage();
    const storage = makeStorage(fake);
    await storage.save(buildReplay(0x1), { id: 'r1' });
    // Cumulatively the existing keys plus a new save's keys exceed the budget.
    const currentSize = fake.computeSize();
    const fakeWithQuota = new FakeStorage({ quotaBytes: currentSize + 50 });
    // Re-seed the new fake with the existing rows.
    for (const k of fake.keys()) {
      fakeWithQuota.setItem(k, fake.getItem(k)!);
    }
    const storage2 = makeStorage(fakeWithQuota, { namespace: 'pf:test:' });
    await expect(
      storage2.save(buildReplay(0x2), { id: 'r2' }),
    ).rejects.toBeInstanceOf(ReplayStorageQuotaExceededError);
    expect(fakeWithQuota.getItem('pf:test:data:r2')).toBeNull();
    expect(fakeWithQuota.getItem('pf:test:meta:r2')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Close
// ---------------------------------------------------------------------------

describe('LocalStorageReplayStorage — close', () => {
  it('rejects calls after close()', async () => {
    const fake = new FakeStorage();
    const storage = makeStorage(fake);
    await storage.save(buildReplay(), { id: 'row' });
    await storage.close();
    await expect(storage.save(buildReplay())).rejects.toThrow(/closed/);
    await expect(storage.list()).rejects.toThrow(/closed/);
    await expect(storage.has('row')).rejects.toThrow(/closed/);
    // Idempotent.
    await expect(storage.close()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Resilience
// ---------------------------------------------------------------------------

describe('LocalStorageReplayStorage — resilience', () => {
  it('list() skips rows whose metadata key is corrupt', async () => {
    const fake = new FakeStorage();
    const storage = makeStorage(fake);
    await storage.save(buildReplay(0x1), { id: 'good' });
    // Corrupt one row's metadata.
    fake.setItem('pf:test:meta:bad', 'NOT JSON');
    // Manually push 'bad' into the index so it is enumerated.
    const indexRaw = fake.getItem('pf:test:index')!;
    const ids = [...JSON.parse(indexRaw), 'bad'];
    fake.setItem('pf:test:index', JSON.stringify(ids));
    const list = await storage.list();
    expect(list.map((m) => m.id)).toEqual(['good']);
  });

  it('treats a corrupt index as empty', async () => {
    const fake = new FakeStorage();
    fake.setItem('pf:test:index', 'NOT JSON');
    const storage = makeStorage(fake);
    expect((await storage.list()).length).toBe(0);
  });

  it('load surfaces a corrupt payload as ReplayStorageError', async () => {
    const fake = new FakeStorage();
    fake.setItem('pf:test:data:bad', '{not json}');
    fake.setItem('pf:test:index', JSON.stringify(['bad']));
    const storage = makeStorage(fake);
    await expect(storage.load('bad')).rejects.toBeInstanceOf(ReplayStorageError);
  });
});

// ---------------------------------------------------------------------------
// AC 30104 Sub-AC 4 — integrity checks via checksum/hash validation
// ---------------------------------------------------------------------------

describe('LocalStorageReplayStorage — integrity (AC 30104 Sub-AC 4)', () => {
  it('save() stamps a fnv1a-64-v1 checksum onto every row', async () => {
    const fake = new FakeStorage();
    const storage = makeStorage(fake);
    const meta = await storage.save(buildReplay(), { id: 'integrity-1' });
    expect(meta.checksum).toMatch(/^[0-9a-f]{16}$/);
    expect(meta.checksumAlgorithm).toBe(CHECKSUM_ALGORITHM);
  });

  it('save() checksum equals the canonical digest of the stored payload', async () => {
    const fake = new FakeStorage();
    const storage = makeStorage(fake);
    const meta = await storage.save(buildReplay(), { id: 'row' });
    const stored = fake.getItem('pf:test:data:row')!;
    expect(meta.checksum).toBe(computeReplayChecksum(stored));
  });

  it('load() round-trips a clean row without an integrity error', async () => {
    const fake = new FakeStorage();
    const storage = makeStorage(fake);
    await storage.save(buildReplay(0xc0ffee), { id: 'clean' });
    const loaded = await storage.loadOrThrow('clean');
    expect(loaded.replay.rngSeed).toBe(0xc0ffee);
    expect(loaded.metadata.checksum).toMatch(/^[0-9a-f]{16}$/);
  });

  it('load() throws ReplayCorruptedError when the data key is tampered with', async () => {
    const fake = new FakeStorage();
    const storage = makeStorage(fake);
    await storage.save(buildReplay(0xc0ffee), { id: 'tampered' });
    // Simulate corruption: another tab / extension / disk fault
    // overwrites the data key with a still-parseable but altered
    // payload. 0xc0ffee = 12648430 in decimal; flip the last digit.
    const original = fake.getItem('pf:test:data:tampered')!;
    expect(original).toContain('"rngSeed":12648430');
    const tampered = original.replace(
      '"rngSeed":12648430',
      '"rngSeed":12648431',
    );
    expect(tampered).not.toBe(original);
    fake.setItem('pf:test:data:tampered', tampered);

    await expect(storage.load('tampered')).rejects.toBeInstanceOf(
      ReplayCorruptedError,
    );
  });

  it('load() reports the corruption details on the thrown error', async () => {
    const fake = new FakeStorage();
    const storage = makeStorage(fake);
    const meta = await storage.save(buildReplay(), { id: 'reported' });
    // Truncate the payload to force a checksum mismatch.
    const original = fake.getItem('pf:test:data:reported')!;
    fake.setItem('pf:test:data:reported', original.slice(0, -10));

    let caught: unknown = null;
    try {
      await storage.load('reported');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ReplayCorruptedError);
    const e = caught as ReplayCorruptedError;
    expect(e.id).toBe('reported');
    expect(e.cause.kind).toBe('mismatch');
    expect(e.cause.expected).toBe(meta.checksum);
    expect(e.cause.algorithm).toBe(CHECKSUM_ALGORITHM);
    expect(e.message).toMatch(/integrity check/i);
  });

  it('loadOrThrow() also surfaces ReplayCorruptedError', async () => {
    const fake = new FakeStorage();
    const storage = makeStorage(fake);
    await storage.save(buildReplay(), { id: 'orthrow' });
    fake.setItem('pf:test:data:orthrow', 'corrupt-bytes-not-json');
    // The integrity check fires before the JSON parse, so the
    // ReplayCorruptedError beats the JSON parse error to the surface.
    await expect(storage.loadOrThrow('orthrow')).rejects.toBeInstanceOf(
      ReplayCorruptedError,
    );
  });

  it('integrity error is a ReplayStorageError subclass', async () => {
    // The error class hierarchy lets a single `catch
    // (ReplayStorageError)` block handle every storage-side failure
    // mode while still allowing finer-grained branches on
    // `instanceof ReplayCorruptedError`.
    const fake = new FakeStorage();
    const storage = makeStorage(fake);
    await storage.save(buildReplay(), { id: 'hierarchy' });
    const original = fake.getItem('pf:test:data:hierarchy')!;
    fake.setItem('pf:test:data:hierarchy', original + ' '); // append a byte

    await expect(storage.load('hierarchy')).rejects.toBeInstanceOf(
      ReplayStorageError,
    );
  });

  it('legacy rows with no checksum field still load (backward compat)', async () => {
    // Simulate a row written before AC 30104 Sub-AC 4 — the metadata
    // key has no `checksum` field. The loader must fall back to the
    // pre-integrity behaviour and parse the payload directly rather
    // than refusing to load the row.
    const fake = new FakeStorage();
    const storage = makeStorage(fake);
    await storage.save(buildReplay(), { id: 'legacy' });
    const metaRaw = fake.getItem('pf:test:meta:legacy')!;
    const meta = JSON.parse(metaRaw) as Record<string, unknown>;
    delete meta['checksum'];
    delete meta['checksumAlgorithm'];
    fake.setItem('pf:test:meta:legacy', JSON.stringify(meta));

    const loaded = await storage.loadOrThrow('legacy');
    // Loaded successfully — and the loader recomputes a checksum from
    // the stored payload so the returned metadata still has one.
    expect(loaded.replay.rngSeed).toBe(0xc0ffee);
    expect(loaded.metadata.checksum).toMatch(/^[0-9a-f]{16}$/);
  });

  it('list() exposes the checksum + algorithm on every row', async () => {
    const fake = new FakeStorage();
    const storage = makeStorage(fake);
    await storage.save(buildReplay(), { id: 'r1' });
    await storage.save(buildReplay(0xfeedface), { id: 'r2' });
    const list = await storage.list();
    for (const m of list) {
      expect(m.checksum).toMatch(/^[0-9a-f]{16}$/);
      expect(m.checksumAlgorithm).toBe(CHECKSUM_ALGORITHM);
    }
  });

  it('overwriting a row recomputes the checksum', async () => {
    const fake = new FakeStorage();
    const storage = makeStorage(fake);
    const first = await storage.save(buildReplay(0xaaaa), { id: 'overwrite' });
    const second = await storage.save(buildReplay(0xbbbb), {
      id: 'overwrite',
      overwrite: true,
    });
    // Different payloads → different checksums.
    expect(second.checksum).not.toBe(first.checksum);
    // And a fresh load surfaces the new checksum without an integrity error.
    const loaded = await storage.loadOrThrow('overwrite');
    expect(loaded.metadata.checksum).toBe(second.checksum);
  });
});
