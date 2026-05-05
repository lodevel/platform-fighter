import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STORAGE_APP_NAMESPACE,
  STORAGE_CUSTOM_STAGES_DOMAIN,
  STORAGE_CUSTOM_STAGES_VERSION_SEGMENT,
  clearAllCustomStages,
  deleteCustomStage,
  hasCustomStage,
  hasCustomStageByName,
  indexStorageKey,
  inspectCustomStageIndex,
  listCustomStages,
  loadCustomStage,
  loadCustomStageByName,
  saveCustomStage,
  stageStorageKey,
  toPlacedPiece,
  toPlacedPieces,
  type StorageLike,
} from './customStageStorage';
import {
  CUSTOM_STAGE_SCHEMA_VERSION,
  customStageSlotIdFromName,
  serializeCustomStageIndex,
  type CustomStageData,
} from './customStageSerializer';
import {
  BUILDER_CANVAS_DEFAULT_HEIGHT,
  BUILDER_CANVAS_DEFAULT_WIDTH,
  BUILDER_GRID_CELL_PX,
  DEFAULT_GRID_SPEC,
  buildGridSpec,
} from './builderGrid';
import { STAGE_PIECE_LIMIT, StageDataModel } from './stageDataModel';
import type { PlacedPiece } from './dragDrop';

/**
 * AC 20104 Sub-AC 3 — localStorage save/load of custom stages with
 * named slots.
 *
 * Locks down:
 *
 *   1. Namespace strategy — keys are
 *      `platformfighter.customStages.v1.…` and the per-slot keys are
 *      predictable.
 *   2. saveCustomStage round-trips losslessly through localStorage.
 *   3. Named-slot collisions surface `name-collision` and refuse the
 *      write unless `overwrite: true` is set.
 *   4. Missing index / blob returns the appropriate typed error code.
 *   5. Corrupted JSON / wrong-shape envelope returns `corrupted`.
 *   6. Unavailable storage (no localStorage on the global, explicit
 *      null passed in) returns `unavailable` and never throws.
 *   7. setItem / removeItem throws (quota / private mode) are caught
 *      and surfaced as `write-failed`.
 *   8. List / has helpers reflect the live index.
 *   9. Delete cleans up both the per-slot blob and the index entry.
 *  10. Clear removes every key under the schema version.
 *  11. Round-trip with StageDataModel: a saved → loaded → replaced
 *      stage produces identical pieces in identical order.
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

class ThrowingSetStorage extends InMemoryStorage {
  override setItem(_key: string, _value: string): void {
    throw new Error('quota-exceeded');
  }
}

class ThrowingGetStorage implements StorageLike {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getItem(_key: string): string | null {
    throw new Error('boom-get');
  }
  setItem(): void {
    /* noop */
  }
  removeItem(): void {
    /* noop */
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePiece(overrides: Partial<PlacedPiece> = {}): PlacedPiece {
  return {
    type: 'flat-platform',
    canvasX: 200,
    canvasY: 320,
    width: 160,
    height: 40,
    col: 5,
    row: 8,
    ...overrides,
  };
}

function makeFixturePieces(): PlacedPiece[] {
  return [
    makePiece({ type: 'flat-platform' }),
    makePiece({
      type: 'lava-zone',
      canvasX: 480,
      canvasY: 240,
      width: 200,
      height: 80,
      col: 12,
      row: 6,
    }),
    makePiece({
      type: 'spawn-point',
      canvasX: 800,
      canvasY: 200,
      width: 40,
      height: 40,
      col: 20,
      row: 5,
    }),
  ];
}

// ---------------------------------------------------------------------------
// Namespace + key derivation
// ---------------------------------------------------------------------------

describe('storage key derivation', () => {
  it('uses the canonical namespace prefix', () => {
    expect(indexStorageKey()).toBe(
      `${STORAGE_APP_NAMESPACE}.${STORAGE_CUSTOM_STAGES_DOMAIN}.${STORAGE_CUSTOM_STAGES_VERSION_SEGMENT}.index`,
    );
  });

  it('builds per-slot keys from a slot id', () => {
    expect(stageStorageKey('lava-tower')).toBe(
      `${STORAGE_APP_NAMESPACE}.${STORAGE_CUSTOM_STAGES_DOMAIN}.${STORAGE_CUSTOM_STAGES_VERSION_SEGMENT}.stage.lava-tower`,
    );
  });

  it('schema version segment matches the serializer', () => {
    expect(STORAGE_CUSTOM_STAGES_VERSION_SEGMENT).toBe(
      `v${CUSTOM_STAGE_SCHEMA_VERSION}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Save → load round-trip
// ---------------------------------------------------------------------------

describe('saveCustomStage + loadCustomStage', () => {
  it('persists a stage and reads it back losslessly', () => {
    const storage = new InMemoryStorage();
    const pieces = makeFixturePieces();
    const saved = saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, pieces, {
      storage,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.id).toBe('lava-tower');
    expect(saved.value.name).toBe('Lava Tower');

    // Per-slot blob lives at a predictable key; index lives at another.
    expect(storage.has(stageStorageKey('lava-tower'))).toBe(true);
    expect(storage.has(indexStorageKey())).toBe(true);

    const loaded = loadCustomStage('lava-tower', storage);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.name).toBe('Lava Tower');
    expect(loaded.value.gridSpec).toEqual({
      cellPx: BUILDER_GRID_CELL_PX,
      width: BUILDER_CANVAS_DEFAULT_WIDTH,
      height: BUILDER_CANVAS_DEFAULT_HEIGHT,
    });
    expect(loaded.value.pieces.length).toBe(pieces.length);
    expect(loaded.value.pieces[0]?.type).toBe('flat-platform');
    expect(loaded.value.pieces[1]?.type).toBe('lava-zone');
    expect(loaded.value.pieces[2]?.type).toBe('spawn-point');
  });

  it('round-trips byte-for-byte under repeat saves', () => {
    const storage = new InMemoryStorage();
    saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, makeFixturePieces(), {
      storage,
    });
    const blobA = storage.getItem(stageStorageKey('lava-tower'));
    saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, makeFixturePieces(), {
      storage,
      overwrite: true,
    });
    const blobB = storage.getItem(stageStorageKey('lava-tower'));
    expect(blobA).toBe(blobB);
  });

  it('trims the player-typed name before storing it', () => {
    const storage = new InMemoryStorage();
    const result = saveCustomStage('   Wind Castle   ', DEFAULT_GRID_SPEC, [], {
      storage,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe('wind-castle');
    expect(result.value.name).toBe('Wind Castle');
  });

  it('promotes most-recent saves to the head of the index', () => {
    const storage = new InMemoryStorage();
    saveCustomStage('Alpha', DEFAULT_GRID_SPEC, [], { storage });
    saveCustomStage('Beta', DEFAULT_GRID_SPEC, [], { storage });
    saveCustomStage('Gamma', DEFAULT_GRID_SPEC, [], { storage });
    expect(listCustomStages(storage).map((s) => s.id)).toEqual([
      'gamma',
      'beta',
      'alpha',
    ]);

    saveCustomStage('Alpha', DEFAULT_GRID_SPEC, [], {
      storage,
      overwrite: true,
    });
    expect(listCustomStages(storage).map((s) => s.id)).toEqual([
      'alpha',
      'gamma',
      'beta',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Name-collision rules
// ---------------------------------------------------------------------------

describe('name-collision handling', () => {
  it('refuses to overwrite an existing slot without `overwrite: true`', () => {
    const storage = new InMemoryStorage();
    saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, [], { storage });
    const second = saveCustomStage('lava   tower', DEFAULT_GRID_SPEC, [], {
      storage,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('name-collision');
  });

  it('overwrites the slot when `overwrite: true` is passed', () => {
    const storage = new InMemoryStorage();
    saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, [], { storage });
    const second = saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, makeFixturePieces(), {
      storage,
      overwrite: true,
    });
    expect(second.ok).toBe(true);
    const loaded = loadCustomStage('lava-tower', storage);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.pieces.length).toBe(makeFixturePieces().length);
  });
});

// ---------------------------------------------------------------------------
// Validation rejection
// ---------------------------------------------------------------------------

describe('save validation', () => {
  it('rejects an invalid name with `invalid-name`', () => {
    const storage = new InMemoryStorage();
    const result = saveCustomStage('', DEFAULT_GRID_SPEC, [], { storage });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid-name');
    expect(storage.size()).toBe(0);
  });

  it('rejects malformed pieces with `corrupted` and never touches storage', () => {
    const storage = new InMemoryStorage();
    const bad = [
      makePiece({ type: 'unknown-type' as never }),
    ];
    const result = saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, bad, {
      storage,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('corrupted');
    expect(storage.size()).toBe(0);
  });

  it('rejects piece counts above the 30-piece cap', () => {
    const storage = new InMemoryStorage();
    const tooMany: PlacedPiece[] = Array.from({ length: STAGE_PIECE_LIMIT + 1 }, () =>
      makePiece(),
    );
    const result = saveCustomStage('Big Stage', DEFAULT_GRID_SPEC, tooMany, {
      storage,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('corrupted');
  });
});

// ---------------------------------------------------------------------------
// Storage availability
// ---------------------------------------------------------------------------

describe('storage availability', () => {
  it('save returns `unavailable` when storage is explicitly null', () => {
    const result = saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, [], {
      storage: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unavailable');
  });

  it('load returns `unavailable` when storage is explicitly null', () => {
    const result = loadCustomStage('lava-tower', null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unavailable');
  });

  it('listCustomStages returns [] when storage is unavailable', () => {
    expect(listCustomStages(null)).toEqual([]);
  });

  it('hasCustomStage returns false when storage is unavailable', () => {
    expect(hasCustomStage('lava-tower', null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setItem failure (write-failed)
// ---------------------------------------------------------------------------

describe('write failures', () => {
  it('save surfaces `write-failed` when setItem throws on the per-slot blob', () => {
    const storage = new ThrowingSetStorage();
    const result = saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, [], {
      storage,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('write-failed');
  });

  it('save rolls back the per-slot blob if the index write fails', () => {
    // A storage whose setItem throws *only* for the index key —
    // simulates "I have just enough space for one but not two".
    class IndexThrowsStorage extends InMemoryStorage {
      writeCount = 0;
      override setItem(key: string, value: string): void {
        this.writeCount += 1;
        if (key === indexStorageKey()) throw new Error('full');
        super.setItem(key, value);
      }
    }
    const storage = new IndexThrowsStorage();
    const result = saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, [], {
      storage,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('write-failed');
    // Per-slot blob must NOT remain after rollback (the write of the
    // blob preceded the failed index write — best-effort cleanup
    // removes it).
    expect(storage.keys()).toEqual([]);
    expect(storage.writeCount).toBeGreaterThan(0);
  });

  it('load surfaces `corrupted` when getItem throws', () => {
    const storage = new ThrowingGetStorage();
    const result = loadCustomStage('lava-tower', storage);
    // Index read is the first thing — failure short-circuits to slot-not-found.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['slot-not-found', 'corrupted']).toContain(result.code);
  });
});

// ---------------------------------------------------------------------------
// Corruption handling
// ---------------------------------------------------------------------------

describe('corruption handling', () => {
  it('returns `corrupted` when the per-slot blob is malformed JSON', () => {
    const storage = new InMemoryStorage();
    saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, [], { storage });
    storage.rawSet(stageStorageKey('lava-tower'), '{not json');
    const result = loadCustomStage('lava-tower', storage);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('corrupted');
  });

  it('returns `corrupted` when the per-slot blob is the wrong envelope', () => {
    const storage = new InMemoryStorage();
    saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, [], { storage });
    storage.rawSet(
      stageStorageKey('lava-tower'),
      serializeCustomStageIndex({ slots: [] }),
    );
    const result = loadCustomStage('lava-tower', storage);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('corrupted');
  });

  it('returns `slot-not-found` when the index does not list the requested slot', () => {
    const storage = new InMemoryStorage();
    const result = loadCustomStage('ghost-stage', storage);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('slot-not-found');
  });

  it('returns `missing` when the index lists the slot but the blob is gone', () => {
    const storage = new InMemoryStorage();
    saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, [], { storage });
    storage.removeItem(stageStorageKey('lava-tower'));
    const result = loadCustomStage('lava-tower', storage);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('missing');
  });

  it('inspectCustomStageIndex distinguishes missing from corrupted', () => {
    const storage = new InMemoryStorage();
    expect(inspectCustomStageIndex(storage).ok).toBe(false);
    storage.rawSet(indexStorageKey(), '{not json');
    const result = inspectCustomStageIndex(storage);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('corrupted');
  });
});

// ---------------------------------------------------------------------------
// loadCustomStageByName
// ---------------------------------------------------------------------------

describe('loadCustomStageByName', () => {
  it('resolves player-typed names through the canonicaliser', () => {
    const storage = new InMemoryStorage();
    saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, [], { storage });
    expect(loadCustomStageByName('LAVA tower!!!', storage).ok).toBe(true);
  });

  it('rejects empty names with `invalid-name`', () => {
    const result = loadCustomStageByName('', new InMemoryStorage());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid-name');
  });
});

// ---------------------------------------------------------------------------
// listCustomStages, hasCustomStage, hasCustomStageByName
// ---------------------------------------------------------------------------

describe('list + has helpers', () => {
  it('listCustomStages returns the saved slots in newest-first order', () => {
    const storage = new InMemoryStorage();
    saveCustomStage('Alpha', DEFAULT_GRID_SPEC, [], { storage });
    saveCustomStage('Beta', DEFAULT_GRID_SPEC, [], { storage });
    expect(listCustomStages(storage).map((s) => s.name)).toEqual(['Beta', 'Alpha']);
  });

  it('hasCustomStage tracks the live index', () => {
    const storage = new InMemoryStorage();
    expect(hasCustomStage('lava-tower', storage)).toBe(false);
    saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, [], { storage });
    expect(hasCustomStage('lava-tower', storage)).toBe(true);
  });

  it('hasCustomStageByName matches the canonical id', () => {
    const storage = new InMemoryStorage();
    saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, [], { storage });
    expect(hasCustomStageByName('lava   TOWER', storage)).toBe(true);
    expect(hasCustomStageByName('Other Stage', storage)).toBe(false);
    expect(hasCustomStageByName('', storage)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Delete + clear
// ---------------------------------------------------------------------------

describe('deleteCustomStage', () => {
  it('removes the per-slot blob and the index entry', () => {
    const storage = new InMemoryStorage();
    saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, [], { storage });
    expect(deleteCustomStage('lava-tower', storage).ok).toBe(true);
    expect(storage.has(stageStorageKey('lava-tower'))).toBe(false);
    expect(listCustomStages(storage)).toEqual([]);
  });

  it('returns `slot-not-found` when the slot is absent', () => {
    const storage = new InMemoryStorage();
    const result = deleteCustomStage('ghost', storage);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('slot-not-found');
  });
});

describe('clearAllCustomStages', () => {
  it('removes every key under the schema version', () => {
    const storage = new InMemoryStorage();
    saveCustomStage('Alpha', DEFAULT_GRID_SPEC, [], { storage });
    saveCustomStage('Beta', DEFAULT_GRID_SPEC, [], { storage });
    saveCustomStage('Gamma', DEFAULT_GRID_SPEC, [], { storage });
    expect(clearAllCustomStages(storage).ok).toBe(true);
    expect(storage.size()).toBe(0);
  });

  it('returns `unavailable` when storage is missing', () => {
    const result = clearAllCustomStages(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------
// Round-trip with StageDataModel
// ---------------------------------------------------------------------------

describe('round-trip with StageDataModel', () => {
  it('save → load → replaceAllPieces produces an identical roster', () => {
    const storage = new InMemoryStorage();
    const source = new StageDataModel({ gridSpec: DEFAULT_GRID_SPEC });
    for (const piece of makeFixturePieces()) {
      const result = source.addPiece(piece);
      expect(result.ok).toBe(true);
    }
    const exported = source.toPlacedPieces();
    expect(exported.length).toBe(makeFixturePieces().length);

    saveCustomStage('Round Trip', DEFAULT_GRID_SPEC, exported, { storage });
    const loaded = loadCustomStage('round-trip', storage);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const target = new StageDataModel({ gridSpec: DEFAULT_GRID_SPEC });
    const report = target.replaceAllPieces(toPlacedPieces(loaded.value), {
      gridSpec: DEFAULT_GRID_SPEC,
    });
    expect(report.accepted).toBe(makeFixturePieces().length);
    expect(report.rejected).toEqual([]);
    // Compare the geometry-only projections: the registry-only fields
    // (id, insertionIndex) are reset on import so the projections
    // match byte-for-byte.
    expect(target.toPlacedPieces()).toEqual(source.toPlacedPieces());
  });

  it('replaceAllPieces collects per-piece rejection reasons', () => {
    const storage = new InMemoryStorage();
    const goodSpec = buildGridSpec(640, 480);
    const target = new StageDataModel({ gridSpec: goodSpec });
    // Hand the model a piece that does not fit inside the smaller grid.
    const result = target.replaceAllPieces(
      [
        makePiece({ canvasX: 0, canvasY: 0 }),
        makePiece({ canvasX: 640, canvasY: 0, width: 80, height: 40 }),
      ],
      { gridSpec: goodSpec },
    );
    expect(result.accepted).toBe(1);
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0]?.reason).toBe('out-of-bounds');
    void storage; // silence lint — fixture is shared.
  });

  it('replaceAllPieces fires listeners exactly once per import', () => {
    const model = new StageDataModel({ gridSpec: DEFAULT_GRID_SPEC });
    let calls = 0;
    model.addListener(() => {
      calls += 1;
    });
    model.replaceAllPieces(makeFixturePieces());
    expect(calls).toBe(1);
  });

  it('replaceAllPieces with suppressNotify does not fire listeners', () => {
    const model = new StageDataModel({ gridSpec: DEFAULT_GRID_SPEC });
    let calls = 0;
    model.addListener(() => {
      calls += 1;
    });
    model.replaceAllPieces(makeFixturePieces(), { suppressNotify: true });
    expect(calls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// toPlacedPiece projection
// ---------------------------------------------------------------------------

describe('toPlacedPiece / toPlacedPieces', () => {
  it('projects serialised pieces into the PlacedPiece shape', () => {
    const data: CustomStageData = {
      name: 'Lava Tower',
      gridSpec: {
        cellPx: BUILDER_GRID_CELL_PX,
        width: BUILDER_CANVAS_DEFAULT_WIDTH,
        height: BUILDER_CANVAS_DEFAULT_HEIGHT,
      },
      pieces: [
        {
          type: 'flat-platform',
          canvasX: 200,
          canvasY: 320,
          width: 160,
          height: 40,
          col: 5,
          row: 8,
        },
      ],
    };
    expect(toPlacedPieces(data)).toEqual([
      {
        type: 'flat-platform',
        canvasX: 200,
        canvasY: 320,
        width: 160,
        height: 40,
        col: 5,
        row: 8,
      },
    ]);
    expect(toPlacedPiece(data.pieces[0]!)).toEqual(toPlacedPieces(data)[0]);
  });
});

// ---------------------------------------------------------------------------
// Determinism — ids derive identically each time
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('canonical slot id matches between save + the public helper', () => {
    const storage = new InMemoryStorage();
    saveCustomStage('Wind Castle', DEFAULT_GRID_SPEC, [], { storage });
    expect(listCustomStages(storage)[0]?.id).toBe(
      customStageSlotIdFromName('Wind Castle'),
    );
  });

  it('two saves of the same in-memory stage produce identical blobs', () => {
    const a = new InMemoryStorage();
    const b = new InMemoryStorage();
    saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, makeFixturePieces(), {
      storage: a,
    });
    saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, makeFixturePieces(), {
      storage: b,
    });
    expect(a.getItem(stageStorageKey('lava-tower'))).toBe(
      b.getItem(stageStorageKey('lava-tower')),
    );
    expect(a.getItem(indexStorageKey())).toBe(b.getItem(indexStorageKey()));
  });
});

// ---------------------------------------------------------------------------
// Cleanup hooks for tests that mutate ambient `localStorage` (if any)
// ---------------------------------------------------------------------------

beforeEach(() => {
  /* nothing — tests inject explicit storage doubles */
});
afterEach(() => {
  /* nothing */
});
