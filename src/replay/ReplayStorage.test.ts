/**
 * AC 30101 Sub-AC 1 — replay persistence facade tests.
 *
 * Coverage map for this file:
 *
 *   • Helpers — `utf8ByteLength`, `serializeReplayForStorage`,
 *     `buildStoredReplayMetadata`, `validateReplayForWrite`,
 *     `defaultIdFactory`, `isQuotaExceededError`.
 *   • MemoryReplayStorage — full CRUD lifecycle, error paths,
 *     close behaviour. The shared "every backend behaves the same"
 *     suite lives in `ReplayStorage.shared.test.ts` (run against all
 *     three backends).
 *   • Errors — `ReplayStorageError`, `ReplayStorageQuotaExceededError`,
 *     `ReplayNotFoundError` are distinguishable and chain causes.
 *   • Factory — `openReplayStorage` honours `prefer` and falls back
 *     through the IDB → localStorage → memory probe order.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { MatchConfig, PlayerSlot } from '../types';
import { RecordingController } from './RecordingController';
import {
  MemoryReplayStorage,
  ReplayCorruptedError,
  ReplayNotFoundError,
  ReplayStorageError,
  ReplayStorageQuotaExceededError,
  assertReplayPayloadIntegrity,
  buildStoredReplayMetadata,
  computeReplayPayloadChecksum,
  defaultIdFactory,
  isQuotaExceededError,
  openReplayStorage,
  serializeReplayForStorage,
  utf8ByteLength,
  validateReplayForWrite,
  type ReplayStorage,
} from './ReplayStorage';
import {
  CHECKSUM_ALGORITHM,
  ReplayIntegrityError,
  computeReplayChecksum,
} from './replayChecksum';
import { REPLAY_FORMAT_MAGIC, REPLAY_FORMAT_VERSION, type ReplayFile } from './ReplayFile';

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

function buildReplay(
  seed = 0xc0ffee,
  recordedAt = '2026-04-30T12:00:00.000Z',
): ReplayFile {
  const c = new RecordingController({
    engineVersion: '1.2.3',
    nowFactory: () => new Date(recordedAt),
  });
  c.start({ matchConfig: makeMatchConfig(seed), notes: 'exhibition' });
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe('utf8ByteLength', () => {
  it('counts ASCII as one byte per character', () => {
    expect(utf8ByteLength('hello')).toBe(5);
  });
  it('counts multi-byte UTF-8 correctly', () => {
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('🎮')).toBe(4);
  });
  it('handles the empty string', () => {
    expect(utf8ByteLength('')).toBe(0);
  });
});

describe('serializeReplayForStorage', () => {
  it('produces a JSON string the deserialiser accepts', () => {
    const replay = buildReplay();
    const text = serializeReplayForStorage(replay);
    expect(typeof text).toBe('string');
    const parsed = JSON.parse(text);
    expect(parsed.format).toBe(REPLAY_FORMAT_MAGIC);
    expect(parsed.version).toBe(REPLAY_FORMAT_VERSION);
    expect(parsed.rngSeed).toBe(0xc0ffee);
  });
  it('is stable for identical inputs (compact form)', () => {
    const a = serializeReplayForStorage(buildReplay());
    const b = serializeReplayForStorage(buildReplay());
    expect(a).toBe(b);
    // Compact = no leading whitespace before keys.
    expect(a.includes('  "format"')).toBe(false);
  });
});

describe('buildStoredReplayMetadata', () => {
  it('mirrors the replay header fields', () => {
    const replay = buildReplay();
    const meta = buildStoredReplayMetadata(
      'row-1',
      '2026-05-01T00:00:00Z',
      1234,
      replay,
      '0123456789abcdef',
    );
    expect(meta.id).toBe('row-1');
    expect(meta.savedAt).toBe('2026-05-01T00:00:00Z');
    expect(meta.sizeBytes).toBe(1234);
    expect(meta.recordedAt).toBe('2026-04-30T12:00:00.000Z');
    expect(meta.durationFrames).toBe(2);
    expect(meta.notes).toBe('exhibition');
    expect(meta.stageId).toBe('flat');
    expect(meta.playerCount).toBe(2);
    expect(meta.rngSeed).toBe(0xc0ffee);
    expect(meta.engineVersion).toBe('1.2.3');
    expect(meta.checksum).toBe('0123456789abcdef');
    expect(meta.checksumAlgorithm).toBe('fnv1a-64-v1');
    expect(Object.isFrozen(meta)).toBe(true);
  });
});

describe('validateReplayForWrite', () => {
  it('returns a frozen ReplayFile on success', () => {
    const replay = buildReplay();
    const v = validateReplayForWrite(replay);
    expect(Object.isFrozen(v)).toBe(true);
    expect(v.matchConfig.players.length).toBe(2);
  });
  it('rejects a non-object', () => {
    expect(() => validateReplayForWrite(null as unknown as ReplayFile)).toThrow(
      ReplayStorageError,
    );
  });
  it('rejects a wrong format magic', () => {
    const bad = { ...buildReplay(), format: 'not-a-replay' as never } as ReplayFile;
    expect(() => validateReplayForWrite(bad)).toThrow(/format must equal/);
  });
  it('rejects a wrong version', () => {
    const bad = { ...buildReplay(), version: 99 as never } as ReplayFile;
    expect(() => validateReplayForWrite(bad)).toThrow(/version must equal/);
  });
  it('rejects a malformed timeline (mismatched inputs length)', () => {
    const replay = buildReplay();
    // Inject a frame whose `inputs` array has the wrong width — the
    // serialiser checks `inputs.length === playerCount` and throws.
    const bad: ReplayFile = {
      ...replay,
      inputTimeline: {
        playerCount: replay.inputTimeline.playerCount,
        entries: [
          { frame: 99, inputs: [] }, // empty array, but playerCount is 2
        ],
      },
    };
    expect(() => validateReplayForWrite(bad)).toThrow(/validation failed/);
  });
});

describe('defaultIdFactory', () => {
  it('returns a non-empty string', () => {
    const make = defaultIdFactory();
    const id = make();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
  it('produces unique ids on consecutive calls', () => {
    const make = defaultIdFactory();
    const ids = new Set<string>();
    for (let i = 0; i < 16; i += 1) ids.add(make());
    expect(ids.size).toBe(16);
  });
});

describe('isQuotaExceededError', () => {
  it('matches by name', () => {
    expect(isQuotaExceededError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isQuotaExceededError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
  });
  it('matches by legacy DOMException code', () => {
    expect(isQuotaExceededError({ code: 22 })).toBe(true);
    expect(isQuotaExceededError({ code: 1014 })).toBe(true);
  });
  it('matches by message keyword as a last resort', () => {
    expect(isQuotaExceededError(new Error('Storage Quota exceeded'))).toBe(true);
  });
  it('returns false for unrelated errors', () => {
    expect(isQuotaExceededError(null)).toBe(false);
    expect(isQuotaExceededError(undefined)).toBe(false);
    expect(isQuotaExceededError(new Error('some random error'))).toBe(false);
    expect(isQuotaExceededError({ name: 'TypeError' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe('error classes', () => {
  it('ReplayStorageError is its own subclass of Error', () => {
    const e = new ReplayStorageError('oops');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ReplayStorageError);
    expect(e.name).toBe('ReplayStorageError');
  });
  it('ReplayStorageQuotaExceededError carries the cause', () => {
    const native = { name: 'QuotaExceededError' };
    const e = new ReplayStorageQuotaExceededError('full', native);
    expect(e).toBeInstanceOf(ReplayStorageError);
    expect(e).toBeInstanceOf(ReplayStorageQuotaExceededError);
    expect(e.cause).toBe(native);
    expect(e.name).toBe('ReplayStorageQuotaExceededError');
  });
  it('ReplayNotFoundError formats the id', () => {
    const e = new ReplayNotFoundError('abc');
    expect(e).toBeInstanceOf(ReplayStorageError);
    expect(e).toBeInstanceOf(ReplayNotFoundError);
    expect(e.message).toContain('abc');
  });
});

// ---------------------------------------------------------------------------
// MemoryReplayStorage — full CRUD lifecycle
// ---------------------------------------------------------------------------

describe('MemoryReplayStorage — CRUD', () => {
  let storage: MemoryReplayStorage;
  let nextId = 0;

  beforeEach(() => {
    nextId = 0;
    storage = new MemoryReplayStorage({
      idFactory: () => `id-${(nextId += 1)}`,
      nowFactory: () => new Date('2026-05-01T00:00:00.000Z'),
    });
  });

  it('starts empty', async () => {
    expect((await storage.list()).length).toBe(0);
    expect((await storage.getStats()).count).toBe(0);
  });

  it('saves and lists a replay', async () => {
    const replay = buildReplay();
    const meta = await storage.save(replay);
    expect(meta.id).toBe('id-1');
    expect(meta.savedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(meta.sizeBytes).toBeGreaterThan(0);
    expect(meta.rngSeed).toBe(0xc0ffee);

    const list = await storage.list();
    expect(list.length).toBe(1);
    expect(list[0]!.id).toBe('id-1');
  });

  it('honours an explicit id', async () => {
    const meta = await storage.save(buildReplay(), { id: 'custom-row' });
    expect(meta.id).toBe('custom-row');
    expect(await storage.has('custom-row')).toBe(true);
  });

  it('rejects an empty id string', async () => {
    await expect(storage.save(buildReplay(), { id: '' })).rejects.toBeInstanceOf(
      ReplayStorageError,
    );
  });

  it('refuses to overwrite without explicit consent', async () => {
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

  it('load returns null for a missing row', async () => {
    expect(await storage.load('absent')).toBeNull();
  });

  it('loadOrThrow throws ReplayNotFoundError for a missing row', async () => {
    await expect(storage.loadOrThrow('absent')).rejects.toBeInstanceOf(
      ReplayNotFoundError,
    );
  });

  it('round-trips a replay through save → load', async () => {
    const original = buildReplay();
    const meta = await storage.save(original);
    const fetched = await storage.loadOrThrow(meta.id);
    expect(fetched.metadata.id).toBe(meta.id);
    expect(fetched.replay.rngSeed).toBe(original.rngSeed);
    expect(fetched.replay.inputTimeline.entries.length).toBe(2);
    expect(fetched.replay.matchConfig.players.length).toBe(2);
    expect(Object.isFrozen(fetched.replay)).toBe(true);
  });

  it('lists replays newest savedAt first', async () => {
    let day = 1;
    const stamps: string[] = [];
    const s = new MemoryReplayStorage({
      idFactory: () => `id-${day}`,
      nowFactory: () => {
        const date = new Date(`2026-05-0${day}T00:00:00.000Z`);
        stamps.push(date.toISOString());
        day += 1;
        return date;
      },
    });
    await s.save(buildReplay(0x1));
    await s.save(buildReplay(0x2));
    await s.save(buildReplay(0x3));
    const list = await s.list();
    expect(list.map((m) => m.id)).toEqual(['id-3', 'id-2', 'id-1']);
  });

  it('deletes idempotently', async () => {
    await storage.save(buildReplay(), { id: 'row' });
    expect(await storage.delete('row')).toBe(true);
    expect(await storage.delete('row')).toBe(false);
    expect(await storage.has('row')).toBe(false);
  });

  it('clears every row', async () => {
    await storage.save(buildReplay(0x1));
    await storage.save(buildReplay(0x2));
    await storage.clear();
    expect((await storage.list()).length).toBe(0);
    expect((await storage.getStats()).count).toBe(0);
  });

  it('reports stats matching the stored rows', async () => {
    const m1 = await storage.save(buildReplay(0xa));
    const m2 = await storage.save(buildReplay(0xb));
    const stats = await storage.getStats();
    expect(stats.count).toBe(2);
    expect(stats.totalBytes).toBe(m1.sizeBytes + m2.sizeBytes);
    expect(stats.usageBytes).toBe(stats.totalBytes);
    expect(stats.quotaBytes).toBeNull();
    expect(stats.backend).toBe('memory');
  });

  it('rejects writes after close', async () => {
    await storage.close();
    await expect(storage.save(buildReplay())).rejects.toThrow(/closed/);
    await expect(storage.list()).rejects.toThrow(/closed/);
  });
});

// ---------------------------------------------------------------------------
// Factory — `openReplayStorage`
// ---------------------------------------------------------------------------

describe('openReplayStorage — backend selection', () => {
  it('returns MemoryReplayStorage when prefer=memory', async () => {
    const s = await openReplayStorage({ prefer: 'memory' });
    expect(s.backend).toBe('memory');
  });

  it('falls back to memory in plain Node (no IDB, no localStorage)', async () => {
    // Vitest's default Node env exposes neither indexedDB nor
    // localStorage — auto-mode should land on memory.
    const realIDB = (globalThis as { indexedDB?: unknown }).indexedDB;
    const realLS = (globalThis as { localStorage?: unknown }).localStorage;
    if (realIDB === undefined && realLS === undefined) {
      const s = await openReplayStorage();
      expect(s.backend).toBe('memory');
      await s.close();
    }
  });

  it('throws when prefer=indexeddb and IDB is unavailable', async () => {
    if ((globalThis as { indexedDB?: unknown }).indexedDB !== undefined) {
      // Skip — runtime exposes IDB (e.g. happy-dom). This test asserts
      // the headless-Node branch.
      return;
    }
    await expect(openReplayStorage({ prefer: 'indexeddb' })).rejects.toThrow();
  });

  it('throws when prefer=localstorage and localStorage is unavailable', async () => {
    if ((globalThis as { localStorage?: unknown }).localStorage !== undefined) {
      return;
    }
    await expect(openReplayStorage({ prefer: 'localstorage' })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cross-backend semantics — every backend respects the same contract.
// ---------------------------------------------------------------------------

describe('ReplayStorage — interface contract via MemoryReplayStorage', () => {
  let storage: ReplayStorage;
  beforeEach(async () => {
    storage = await openReplayStorage({
      prefer: 'memory',
      idFactory: (() => {
        let i = 0;
        return () => `r-${(i += 1)}`;
      })(),
      nowFactory: () => new Date('2026-05-01T00:00:00.000Z'),
    });
  });

  it('exposes a backend discriminator', () => {
    expect(['indexeddb', 'localstorage', 'memory']).toContain(storage.backend);
  });

  it('rejects loads after close', async () => {
    await storage.close();
    await expect(storage.load('any')).rejects.toThrow(/closed/);
  });
});

// ---------------------------------------------------------------------------
// AC 30104 Sub-AC 4 — integrity checks via checksum/hash validation
// ---------------------------------------------------------------------------

describe('computeReplayPayloadChecksum + assertReplayPayloadIntegrity (AC 30104 Sub-AC 4)', () => {
  it('computeReplayPayloadChecksum delegates to the canonical hash', () => {
    const payload = '{"a":1,"b":2}';
    expect(computeReplayPayloadChecksum(payload)).toBe(
      computeReplayChecksum(payload),
    );
  });

  it('assertReplayPayloadIntegrity passes silently on a matching checksum', () => {
    const payload = '{"x":1}';
    const checksum = computeReplayPayloadChecksum(payload);
    // No throw — returns void.
    expect(() => assertReplayPayloadIntegrity('id', payload, checksum)).not.toThrow();
  });

  it('assertReplayPayloadIntegrity wraps mismatch errors as ReplayCorruptedError', () => {
    const payload = '{"x":1}';
    const wrong = computeReplayPayloadChecksum('{"x":2}');
    let caught: unknown = null;
    try {
      assertReplayPayloadIntegrity('row-7', payload, wrong);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ReplayCorruptedError);
    const e = caught as ReplayCorruptedError;
    expect(e.id).toBe('row-7');
    expect(e.cause).toBeInstanceOf(ReplayIntegrityError);
    expect(e.cause.kind).toBe('mismatch');
  });

  it('assertReplayPayloadIntegrity surfaces malformed-checksum errors too', () => {
    expect(() => assertReplayPayloadIntegrity('id', 'x', 'not-hex')).toThrow(
      ReplayCorruptedError,
    );
  });

  it('assertReplayPayloadIntegrity surfaces unsupported-algorithm errors', () => {
    const payload = '{}';
    const checksum = computeReplayPayloadChecksum(payload);
    expect(() =>
      assertReplayPayloadIntegrity('id', payload, checksum, 'sha512-v1'),
    ).toThrow(ReplayCorruptedError);
  });
});

describe('ReplayCorruptedError', () => {
  it('is a ReplayStorageError subclass keyed by id', () => {
    const inner = new ReplayIntegrityError('mismatch', 'bad', {
      expected: '0'.repeat(16),
      actual: '1'.repeat(16),
    });
    const e = new ReplayCorruptedError('row-42', inner);
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ReplayStorageError);
    expect(e).toBeInstanceOf(ReplayCorruptedError);
    expect(e.name).toBe('ReplayCorruptedError');
    expect(e.id).toBe('row-42');
    expect(e.cause).toBe(inner);
    expect(e.message).toContain('row-42');
    expect(e.message).toContain('mismatch');
  });
});

describe('MemoryReplayStorage — integrity (AC 30104 Sub-AC 4)', () => {
  let storage: MemoryReplayStorage;
  let nextId = 0;

  beforeEach(() => {
    nextId = 0;
    storage = new MemoryReplayStorage({
      idFactory: () => `id-${(nextId += 1)}`,
      nowFactory: () => new Date('2026-05-01T00:00:00.000Z'),
    });
  });

  it('save() returns a metadata struct with checksum + algorithm', async () => {
    const meta = await storage.save(buildReplay());
    expect(meta.checksum).toMatch(/^[0-9a-f]{16}$/);
    expect(meta.checksumAlgorithm).toBe(CHECKSUM_ALGORITHM);
  });

  it('load() round-trips a clean row without raising integrity errors', async () => {
    await storage.save(buildReplay(0xc0ffee), { id: 'r' });
    const loaded = await storage.loadOrThrow('r');
    expect(loaded.replay.rngSeed).toBe(0xc0ffee);
    expect(loaded.metadata.checksum).toMatch(/^[0-9a-f]{16}$/);
  });

  it('load() throws ReplayCorruptedError when the in-memory payload is tampered with', async () => {
    await storage.save(buildReplay(), { id: 'r' });
    // Reach into the storage's internal rows map (test-only) and
    // overwrite the serialised payload with a still-parseable but
    // altered string. The integrity check fires before JSON.parse so
    // the error is the typed ReplayCorruptedError.
    const internal = (storage as unknown as {
      rows: Map<string, { metadata: { checksum: string }; serialized: string }>;
    }).rows;
    const row = internal.get('r')!;
    row.serialized = row.serialized.replace(
      '"rngSeed":12648430',
      '"rngSeed":12648431',
    );
    await expect(storage.load('r')).rejects.toBeInstanceOf(ReplayCorruptedError);
  });

  it('load() reports the corruption details', async () => {
    const meta = await storage.save(buildReplay(), { id: 'r' });
    const internal = (storage as unknown as {
      rows: Map<string, { metadata: { checksum: string }; serialized: string }>;
    }).rows;
    const row = internal.get('r')!;
    row.serialized = row.serialized.slice(0, -5);
    let caught: unknown = null;
    try {
      await storage.load('r');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ReplayCorruptedError);
    const e = caught as ReplayCorruptedError;
    expect(e.id).toBe('r');
    expect(e.cause.expected).toBe(meta.checksum);
    expect(e.cause.kind).toBe('mismatch');
  });

  it('save → load round-trip yields a checksum that is the canonical digest', async () => {
    const meta = await storage.save(buildReplay(), { id: 'r' });
    // The stored checksum equals what we'd compute from scratch over
    // the serialised payload — a strong signal that the writer and
    // verifier agree on the canonical encoding.
    const internal = (storage as unknown as {
      rows: Map<string, { serialized: string }>;
    }).rows;
    const serialized = internal.get('r')!.serialized;
    expect(meta.checksum).toBe(computeReplayChecksum(serialized));
  });

  it('list() exposes the checksum on every row', async () => {
    await storage.save(buildReplay(), { id: 'a' });
    await storage.save(buildReplay(0x11), { id: 'b' });
    const list = await storage.list();
    for (const m of list) {
      expect(m.checksum).toMatch(/^[0-9a-f]{16}$/);
      expect(m.checksumAlgorithm).toBe(CHECKSUM_ALGORITHM);
    }
  });

  it('overwrites recompute the checksum', async () => {
    const first = await storage.save(buildReplay(0x1), { id: 'r' });
    const second = await storage.save(buildReplay(0x2), {
      id: 'r',
      overwrite: true,
    });
    expect(second.checksum).not.toBe(first.checksum);
  });
});
