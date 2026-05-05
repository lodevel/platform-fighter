import { describe, it, expect, vi } from 'vitest';
import {
  STAGE_PIECE_LIMIT,
  StageDataModel,
  type RegisteredPiece,
} from './stageDataModel';
import { CATALOG_PIECES, findCatalogPiece } from './catalogPieces';
import { DEFAULT_GRID_SPEC, buildGridSpec } from './builderGrid';
import type { PlacedPiece } from './dragDrop';

/**
 * AC 20102 Sub-AC 2 — drop placement registry.
 *
 * The registry is Phaser-free so the unit suite drives every branch
 * under plain Node. These tests guard:
 *
 *   • addPiece() registers valid placements and assigns stable ids;
 *   • addPiece() rejects placements that violate the Seed's hard
 *     limits (30-piece cap, canvas bounds);
 *   • addPiece() defends the registry against malformed payloads
 *     (unknown type, non-finite geometry);
 *   • the change-listener contract fires on every mutation in
 *     registration order;
 *   • hazard / spawn-point counters reflect the live roster (the
 *     M3 acceptance test reads "places at least 1 hazard").
 */

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makePlacedPiece(
  overrides: Partial<PlacedPiece> = {},
): PlacedPiece {
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

// ---------------------------------------------------------------------------
// Hard-limit constant
// ---------------------------------------------------------------------------

describe('STAGE_PIECE_LIMIT', () => {
  it('matches the Seed-mandated 30-piece cap', () => {
    expect(STAGE_PIECE_LIMIT).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('StageDataModel — initial state', () => {
  it('starts empty with no pieces', () => {
    const model = new StageDataModel();
    expect(model.getPieces()).toEqual([]);
    expect(model.getCount()).toBe(0);
    expect(model.isFull()).toBe(false);
    expect(model.getRemainingCapacity()).toBe(STAGE_PIECE_LIMIT);
  });

  it('exposes the configured grid spec + max-piece cap', () => {
    const spec = buildGridSpec(800, 600);
    const model = new StageDataModel({ gridSpec: spec, maxPieces: 12 });
    expect(model.getGridSpec()).toBe(spec);
    expect(model.getMaxPieces()).toBe(12);
  });

  it('clamps a non-finite or non-positive maxPieces to the Seed cap', () => {
    expect(new StageDataModel({ maxPieces: Number.NaN }).getMaxPieces()).toBe(
      STAGE_PIECE_LIMIT,
    );
    expect(new StageDataModel({ maxPieces: -5 }).getMaxPieces()).toBe(
      STAGE_PIECE_LIMIT,
    );
    expect(new StageDataModel({ maxPieces: 0 }).getMaxPieces()).toBe(
      STAGE_PIECE_LIMIT,
    );
  });
});

// ---------------------------------------------------------------------------
// addPiece — happy paths
// ---------------------------------------------------------------------------

describe('StageDataModel.addPiece — accepted placements', () => {
  it('registers a valid placement and assigns a stable id + insertion index', () => {
    const model = new StageDataModel();
    const result = model.addPiece(makePlacedPiece());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.piece.id).toBe('flat-platform#0');
    expect(result.piece.insertionIndex).toBe(0);
    expect(result.piece.type).toBe('flat-platform');
    expect(result.piece.canvasX).toBe(200);
    expect(result.piece.canvasY).toBe(320);
    expect(result.piece.col).toBe(5);
    expect(result.piece.row).toBe(8);
    expect(model.getCount()).toBe(1);
    expect(model.getPieces()[0]).toEqual(result.piece);
  });

  it('assigns monotonically increasing ids per type', () => {
    const model = new StageDataModel();
    const a = model.addPiece(makePlacedPiece({ canvasX: 0, canvasY: 0, col: 0, row: 0 }));
    const b = model.addPiece(makePlacedPiece({ canvasX: 200, canvasY: 0, col: 5, row: 0 }));
    const c = model.addPiece(makePlacedPiece({ type: 'lava-zone', canvasX: 400, canvasY: 200, col: 10, row: 5, width: 200, height: 80 }));
    expect(a.ok && a.piece.id).toBe('flat-platform#0');
    expect(b.ok && b.piece.id).toBe('flat-platform#1');
    expect(c.ok && c.piece.id).toBe('lava-zone#2');
  });

  it('preserves insertion order across the roster', () => {
    const model = new StageDataModel();
    // Coordinates spread far enough that AC 20103 Sub-AC 3's overlap +
    // hazard-near-spawn rules don't reject any of the placements:
    //   • Pieces sit on different rows so footprints can never collide.
    //   • The spawn-point row sits >1 cell below the hazard rows so the
    //     hazard-near-spawn buffer doesn't fire.
    const placements = [
      { type: 'flat-platform' as const, canvasX: 40, canvasY: 80 },
      { type: 'lava-zone' as const, canvasX: 40, canvasY: 200 },
      { type: 'wind-zone' as const, canvasX: 40, canvasY: 320 },
      { type: 'spawn-point' as const, canvasX: 40, canvasY: 600 },
    ];
    for (const p of placements) {
      const meta = findCatalogPiece(p.type)!;
      model.addPiece(
        makePlacedPiece({
          type: meta.type,
          canvasX: p.canvasX,
          canvasY: p.canvasY,
          width: meta.defaultWidth,
          height: meta.defaultHeight,
        }),
      );
    }
    expect(model.getPieces().map((p) => p.type)).toEqual(
      placements.map((p) => p.type),
    );
    expect(model.getPieces().map((p) => p.insertionIndex)).toEqual([0, 1, 2, 3]);
  });

  it('registers every catalog piece type (including hazards)', () => {
    const model = new StageDataModel({ maxPieces: CATALOG_PIECES.length });
    let placedY = 0;
    for (const piece of CATALOG_PIECES) {
      const result = model.addPiece(
        makePlacedPiece({
          type: piece.type,
          canvasX: 0,
          canvasY: placedY,
          width: piece.defaultWidth,
          height: piece.defaultHeight,
          col: 0,
          row: Math.floor(placedY / DEFAULT_GRID_SPEC.cellPx),
        }),
      );
      expect(result.ok).toBe(true);
      placedY += piece.defaultHeight + 40;
    }
    expect(model.getCount()).toBe(CATALOG_PIECES.length);
  });
});

// ---------------------------------------------------------------------------
// addPiece — rejection paths
// ---------------------------------------------------------------------------

describe('StageDataModel.addPiece — rejections', () => {
  it('rejects an unknown piece type', () => {
    const model = new StageDataModel();
    // Cast through unknown so the test can construct a malformed
    // payload without TypeScript shielding the production code path.
    const result = model.addPiece(
      makePlacedPiece({ type: 'not-a-real-piece' as unknown as PlacedPiece['type'] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-type');
    expect(model.getCount()).toBe(0);
  });

  it('rejects non-finite or non-positive geometry', () => {
    const model = new StageDataModel();
    expect(model.addPiece(makePlacedPiece({ width: 0 })).ok).toBe(false);
    expect(model.addPiece(makePlacedPiece({ height: -10 })).ok).toBe(false);
    expect(model.addPiece(makePlacedPiece({ canvasX: Number.NaN })).ok).toBe(false);
    expect(model.addPiece(makePlacedPiece({ canvasY: Number.POSITIVE_INFINITY })).ok).toBe(false);
    expect(model.getCount()).toBe(0);
  });

  it('rejects placements that clip the canvas bounds', () => {
    const spec = DEFAULT_GRID_SPEC;
    const model = new StageDataModel({ gridSpec: spec });
    const result = model.addPiece(
      makePlacedPiece({
        canvasX: spec.width - 80,
        canvasY: 0,
        width: 160,
        height: 40,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('out-of-bounds');
    expect(model.getCount()).toBe(0);
  });

  it('rejects placements once the piece-count cap is reached', () => {
    const model = new StageDataModel({ maxPieces: 2 });
    expect(model.addPiece(makePlacedPiece({ canvasX: 0 })).ok).toBe(true);
    expect(model.addPiece(makePlacedPiece({ canvasX: 200 })).ok).toBe(true);
    const overflow = model.addPiece(makePlacedPiece({ canvasX: 400 }));
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.reason).toBe('limit-exceeded');
    expect(model.getCount()).toBe(2);
    expect(model.isFull()).toBe(true);
    expect(model.getRemainingCapacity()).toBe(0);
  });

  it('honours the Seed-mandated 30-piece cap by default', () => {
    const model = new StageDataModel();
    let placedX = 0;
    let placedY = 0;
    for (let i = 0; i < STAGE_PIECE_LIMIT; i += 1) {
      const result = model.addPiece(
        makePlacedPiece({ canvasX: placedX, canvasY: placedY }),
      );
      expect(result.ok).toBe(true);
      placedX += 200;
      if (placedX > 1600) {
        placedX = 0;
        placedY += 80;
      }
    }
    expect(model.getCount()).toBe(STAGE_PIECE_LIMIT);
    const overflow = model.addPiece(
      makePlacedPiece({ canvasX: 0, canvasY: placedY + 80 }),
    );
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.reason).toBe('limit-exceeded');
  });
});

// ---------------------------------------------------------------------------
// AC 20103 Sub-AC 3 — placement validation in the registry
// ---------------------------------------------------------------------------

describe('StageDataModel.addPiece — AC 20103 Sub-AC 3 placement validation', () => {
  it('rejects an overlapping placement with the `overlap` reason', () => {
    const model = new StageDataModel();
    model.addPiece(
      makePlacedPiece({
        type: 'flat-platform',
        canvasX: 200,
        canvasY: 200,
      }),
    );
    const result = model.addPiece(
      makePlacedPiece({
        type: 'flat-platform',
        canvasX: 240,
        canvasY: 200,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('overlap');
    expect(model.getCount()).toBe(1);
  });

  it('rejects a hazard placed too close to an existing spawn-point', () => {
    const model = new StageDataModel();
    // Spawn at (400, 200)–(440, 240); place the lava close enough that
    // the 1-cell hazard buffer (40px) overlaps the spawn footprint.
    model.addPiece(
      makePlacedPiece({
        type: 'spawn-point',
        canvasX: 400,
        canvasY: 200,
        width: 40,
        height: 40,
      }),
    );
    const result = model.addPiece(
      makePlacedPiece({
        type: 'lava-zone',
        canvasX: 400,
        canvasY: 260,
        width: 200,
        height: 80,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('hazard-near-spawn');
    expect(model.getCount()).toBe(1);
  });

  it('rejects a spawn placed too close to an existing hazard (symmetric)', () => {
    const model = new StageDataModel();
    model.addPiece(
      makePlacedPiece({
        type: 'lava-zone',
        canvasX: 200,
        canvasY: 200,
        width: 200,
        height: 80,
      }),
    );
    const result = model.addPiece(
      makePlacedPiece({
        type: 'spawn-point',
        canvasX: 380,
        canvasY: 220,
        width: 40,
        height: 40,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('hazard-near-spawn');
  });

  it('exposes registered candidates for the controller to validate against', () => {
    const model = new StageDataModel();
    const r = model.addPiece(makePlacedPiece({ canvasX: 0, canvasY: 0 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cands = model.getRegisteredCandidates();
    expect(cands).toHaveLength(1);
    expect(cands[0]!.id).toBe(r.piece.id);
    expect(cands[0]!.type).toBe('flat-platform');
  });
});

// ---------------------------------------------------------------------------
// removePiece + clear
// ---------------------------------------------------------------------------

describe('StageDataModel.removePiece + clear', () => {
  it('removes a piece by id and returns the removed entry', () => {
    const model = new StageDataModel();
    const a = model.addPiece(makePlacedPiece({ canvasX: 0 }));
    const b = model.addPiece(makePlacedPiece({ canvasX: 200 }));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const removed = model.removePiece(a.piece.id);
    expect(removed?.id).toBe(a.piece.id);
    expect(model.getCount()).toBe(1);
    expect(model.getPieces()[0]?.id).toBe(b.piece.id);
  });

  it('returns null when removing an unknown id', () => {
    const model = new StageDataModel();
    model.addPiece(makePlacedPiece());
    expect(model.removePiece('does-not-exist')).toBeNull();
    expect(model.getCount()).toBe(1);
  });

  it('clear() empties the registry and resets the id sequence', () => {
    const model = new StageDataModel();
    model.addPiece(makePlacedPiece({ canvasX: 0 }));
    model.addPiece(makePlacedPiece({ canvasX: 200 }));
    model.clear();
    expect(model.getCount()).toBe(0);
    const next = model.addPiece(makePlacedPiece({ canvasX: 0 }));
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    // Sequence resets so the first piece after clear is `#0` again.
    expect(next.piece.id).toBe('flat-platform#0');
  });
});

// ---------------------------------------------------------------------------
// Listener contract
// ---------------------------------------------------------------------------

describe('StageDataModel — change listeners', () => {
  it('invokes listeners after every successful add', () => {
    const model = new StageDataModel();
    const spy = vi.fn();
    model.addListener(spy);
    model.addPiece(makePlacedPiece());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toEqual(model.getPieces());
  });

  it('does NOT invoke listeners on a rejected add', () => {
    const model = new StageDataModel({ maxPieces: 1 });
    model.addPiece(makePlacedPiece({ canvasX: 0 }));
    const spy = vi.fn();
    model.addListener(spy);
    const result = model.addPiece(makePlacedPiece({ canvasX: 200 }));
    expect(result.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('invokes listeners on remove + clear', () => {
    const model = new StageDataModel();
    const a = model.addPiece(makePlacedPiece());
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const spy = vi.fn();
    model.addListener(spy);
    model.removePiece(a.piece.id);
    expect(spy).toHaveBeenCalledTimes(1);
    model.clear();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('addListener returns an unsubscribe function', () => {
    const model = new StageDataModel();
    const spy = vi.fn();
    const off = model.addListener(spy);
    off();
    model.addPiece(makePlacedPiece());
    expect(spy).not.toHaveBeenCalled();
  });

  it('iterating listeners is safe when a listener unsubscribes itself mid-fire', () => {
    const model = new StageDataModel();
    const a = vi.fn();
    const b = vi.fn();
    const offA = model.addListener(() => {
      a();
      offA();
    });
    model.addListener(b);
    model.addPiece(makePlacedPiece());
    expect(a).toHaveBeenCalledTimes(1);
    // The sibling listener still runs even though the first one
    // unsubscribed itself during the same notify().
    expect(b).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Hazard + spawn-point counters
// ---------------------------------------------------------------------------

describe('StageDataModel — hazard + spawn-point counters', () => {
  it('counts hazards across the live roster', () => {
    const model = new StageDataModel();
    model.addPiece(makePlacedPiece({ type: 'flat-platform', canvasX: 0 }));
    model.addPiece(
      makePlacedPiece({
        type: 'lava-zone',
        canvasX: 200,
        width: 200,
        height: 80,
      }),
    );
    model.addPiece(
      makePlacedPiece({
        type: 'wind-zone',
        canvasX: 600,
        width: 200,
        height: 80,
      }),
    );
    model.addPiece(makePlacedPiece({ type: 'spawn-point', canvasX: 1000, width: 40, height: 40 }));
    expect(model.countHazards()).toBe(2);
    expect(model.countSpawnPoints()).toBe(1);
  });

  it('hazard / spawn counters return zero on an empty registry', () => {
    const model = new StageDataModel();
    expect(model.countHazards()).toBe(0);
    expect(model.countSpawnPoints()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism guard
// ---------------------------------------------------------------------------

describe('StageDataModel — determinism', () => {
  it('two models driven with identical inputs produce identical rosters', () => {
    const buildSequence = (model: StageDataModel): RegisteredPiece[] => {
      const out: RegisteredPiece[] = [];
      const placements: Array<Partial<PlacedPiece>> = [
        { type: 'flat-platform', canvasX: 0, canvasY: 80 },
        { type: 'lava-zone', canvasX: 240, canvasY: 320, width: 200, height: 80 },
        { type: 'spawn-point', canvasX: 600, canvasY: 80, width: 40, height: 40 },
      ];
      for (const p of placements) {
        const result = model.addPiece(makePlacedPiece(p));
        if (result.ok) out.push(result.piece);
      }
      return out;
    };
    const a = buildSequence(new StageDataModel());
    const b = buildSequence(new StageDataModel());
    expect(a).toEqual(b);
  });
});
