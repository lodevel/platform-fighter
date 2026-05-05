import { describe, it, expect } from 'vitest';
import {
  HAZARD_NEAR_SPAWN_BUFFER_CELLS,
  HAZARD_PIECE_TYPES,
  describePlacementRejection,
  findHazardSpawnConflict,
  findOverlappingPiece,
  inflateRect,
  isHazardType,
  isSpawnType,
  rectsOverlap,
  validatePlacement,
  type PlacementCandidate,
  type PlacementRejectionReason,
  type RegisteredCandidate,
} from './placementValidation';
import { DEFAULT_GRID_SPEC, buildGridSpec } from './builderGrid';

/**
 * AC 20103 Sub-AC 3 — placement validation rules.
 *
 * The validator is Phaser-free pure logic so the unit suite drives
 * every branch under plain Node. These tests guard:
 *
 *   • the geometric overlap helper (axis-aligned, exclusive-trailing-edge);
 *   • the hazard-near-spawn rule fires symmetrically (spawn-then-hazard
 *     and hazard-then-spawn produce the same verdict);
 *   • the unified `validatePlacement` returns the most specific
 *     rejection reason in priority order;
 *   • visual-feedback wiring: rejection reasons map to short user-
 *     facing labels.
 */

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function candidate(overrides: Partial<PlacementCandidate> = {}): PlacementCandidate {
  return {
    type: 'flat-platform',
    canvasX: 200,
    canvasY: 200,
    width: 160,
    height: 40,
    ...overrides,
  };
}

function registered(
  id: string,
  overrides: Partial<RegisteredCandidate> = {},
): RegisteredCandidate {
  return {
    id,
    type: 'flat-platform',
    canvasX: 0,
    canvasY: 0,
    width: 160,
    height: 40,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// rectsOverlap — geometric primitive
// ---------------------------------------------------------------------------

describe('rectsOverlap', () => {
  it('detects an axis-aligned overlap', () => {
    expect(rectsOverlap(0, 0, 100, 100, 50, 50, 100, 100)).toBe(true);
  });

  it('reports no overlap when rectangles touch on the trailing edge', () => {
    // Trailing-edge contact reads as "side by side" in the builder
    // grid model, not overlap.
    expect(rectsOverlap(0, 0, 100, 100, 100, 0, 100, 100)).toBe(false);
    expect(rectsOverlap(0, 0, 100, 100, 0, 100, 100, 100)).toBe(false);
  });

  it('reports no overlap for clearly disjoint rects', () => {
    expect(rectsOverlap(0, 0, 50, 50, 200, 200, 50, 50)).toBe(false);
  });

  it('reports overlap when one rect fully contains the other', () => {
    expect(rectsOverlap(0, 0, 200, 200, 50, 50, 50, 50)).toBe(true);
  });

  it('reports no overlap for non-finite or zero-extent inputs', () => {
    expect(rectsOverlap(Number.NaN, 0, 10, 10, 0, 0, 10, 10)).toBe(false);
    expect(rectsOverlap(0, 0, 0, 10, 0, 0, 10, 10)).toBe(false);
    expect(rectsOverlap(0, 0, 10, 0, 0, 0, 10, 10)).toBe(false);
  });

  it('detects overlap of one pixel', () => {
    // ax+aw=101 > bx=100, so they overlap by 1px.
    expect(rectsOverlap(0, 0, 101, 100, 100, 0, 100, 100)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// inflateRect — grow box for exclusion zones
// ---------------------------------------------------------------------------

describe('inflateRect', () => {
  it('expands the rectangle by the padding on every side', () => {
    const r = inflateRect(100, 100, 80, 60, 20);
    expect(r).toEqual({ x: 80, y: 80, width: 120, height: 100 });
  });

  it('returns the input unchanged when padding is non-positive or non-finite', () => {
    expect(inflateRect(10, 20, 30, 40, 0)).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
    expect(inflateRect(10, 20, 30, 40, -5)).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
    expect(inflateRect(10, 20, 30, 40, Number.NaN)).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });
});

// ---------------------------------------------------------------------------
// Catalog-category helpers
// ---------------------------------------------------------------------------

describe('isHazardType / isSpawnType', () => {
  it('recognises every catalog hazard type', () => {
    for (const t of HAZARD_PIECE_TYPES) {
      expect(isHazardType(t)).toBe(true);
    }
  });

  it('rejects non-hazard catalog types', () => {
    expect(isHazardType('flat-platform')).toBe(false);
    expect(isHazardType('slope-ramp')).toBe(false);
    expect(isHazardType('wall')).toBe(false);
    expect(isHazardType('drop-through-platform')).toBe(false);
    expect(isHazardType('spawn-point')).toBe(false);
  });

  it('rejects unknown types', () => {
    expect(isHazardType('not-a-real-piece')).toBe(false);
  });

  it('isSpawnType matches only spawn-point', () => {
    expect(isSpawnType('spawn-point')).toBe(true);
    expect(isSpawnType('lava-zone')).toBe(false);
    expect(isSpawnType('flat-platform')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findOverlappingPiece — registry-aware overlap detection
// ---------------------------------------------------------------------------

describe('findOverlappingPiece', () => {
  it('returns the first overlapping registered piece', () => {
    const registry = [
      registered('flat#0', { canvasX: 0, canvasY: 0 }),
      registered('flat#1', { canvasX: 200, canvasY: 0 }),
    ];
    // Candidate at x=180 (overlaps flat#1 which ends at x=200… wait
    // no, flat#1 is at x=200, so candidate at x=100 overlaps flat#0).
    const cand = candidate({ canvasX: 100, canvasY: 0, width: 160, height: 40 });
    const conflict = findOverlappingPiece(cand, registry);
    expect(conflict?.id).toBe('flat#0');
  });

  it('returns null when the candidate fits cleanly', () => {
    const registry = [registered('flat#0', { canvasX: 0, canvasY: 0 })];
    const cand = candidate({ canvasX: 400, canvasY: 200 });
    expect(findOverlappingPiece(cand, registry)).toBeNull();
  });

  it('skips entries whose id matches ignoreId (edit-in-place support)', () => {
    const registry = [
      registered('flat#0', { canvasX: 0, canvasY: 0 }),
      registered('flat#1', { canvasX: 100, canvasY: 0 }),
    ];
    const cand = candidate({ canvasX: 0, canvasY: 0 });
    expect(findOverlappingPiece(cand, registry, 'flat#0')?.id).toBe('flat#1');
  });

  it('returns null on an empty registry', () => {
    expect(findOverlappingPiece(candidate(), [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findHazardSpawnConflict — symmetric spawn / hazard rule
// ---------------------------------------------------------------------------

describe('findHazardSpawnConflict', () => {
  it('rejects a spawn placed inside a hazard exclusion zone', () => {
    const registry = [
      registered('lava#0', {
        type: 'lava-zone',
        canvasX: 200,
        canvasY: 200,
        width: 200,
        height: 80,
      }),
    ];
    // Spawn within 1 cell (40px) of the lava-zone footprint.
    const spawn = candidate({
      type: 'spawn-point',
      canvasX: 180,
      canvasY: 200,
      width: 40,
      height: 40,
    });
    const conflict = findHazardSpawnConflict(spawn, registry);
    expect(conflict?.id).toBe('lava#0');
  });

  it('rejects a hazard placed near an existing spawn (symmetric)', () => {
    const registry = [
      registered('spawn#0', {
        type: 'spawn-point',
        canvasX: 200,
        canvasY: 200,
        width: 40,
        height: 40,
      }),
    ];
    const lava = candidate({
      type: 'lava-zone',
      canvasX: 240,
      canvasY: 200,
      width: 200,
      height: 80,
    });
    const conflict = findHazardSpawnConflict(lava, registry);
    expect(conflict?.id).toBe('spawn#0');
  });

  it('accepts a spawn placed well outside the hazard buffer', () => {
    const registry = [
      registered('lava#0', {
        type: 'lava-zone',
        canvasX: 0,
        canvasY: 0,
        width: 200,
        height: 80,
      }),
    ];
    // 200 + 40 (buffer) = 240; place spawn at x=280 — clear of buffer.
    const spawn = candidate({
      type: 'spawn-point',
      canvasX: 280,
      canvasY: 0,
      width: 40,
      height: 40,
    });
    expect(findHazardSpawnConflict(spawn, registry)).toBeNull();
  });

  it('is inert when neither the candidate nor the registry contains a hazard/spawn pair', () => {
    const registry = [
      registered('flat#0', { canvasX: 0, canvasY: 0 }),
      registered('flat#1', { canvasX: 200, canvasY: 0 }),
    ];
    const cand = candidate({ type: 'flat-platform', canvasX: 100, canvasY: 0 });
    expect(findHazardSpawnConflict(cand, registry)).toBeNull();
  });

  it('respects the configured grid cell size when computing the buffer', () => {
    const wideSpec = buildGridSpec(1920, 1080, 80); // 80px cells
    const registry = [
      registered('lava#0', {
        type: 'lava-zone',
        canvasX: 0,
        canvasY: 0,
        width: 200,
        height: 80,
      }),
    ];
    // With 80px cells the buffer is 80px; spawn at x=240 is INSIDE
    // the 200+80=280 buffer end.
    const spawn = candidate({
      type: 'spawn-point',
      canvasX: 240,
      canvasY: 0,
      width: 40,
      height: 40,
    });
    expect(findHazardSpawnConflict(spawn, registry, wideSpec)?.id).toBe('lava#0');
    // ... but at x=320 it's clear.
    expect(
      findHazardSpawnConflict(
        candidate({
          type: 'spawn-point',
          canvasX: 320,
          canvasY: 0,
          width: 40,
          height: 40,
        }),
        registry,
        wideSpec,
      ),
    ).toBeNull();
  });

  it('exposes HAZARD_NEAR_SPAWN_BUFFER_CELLS as a stable constant', () => {
    expect(HAZARD_NEAR_SPAWN_BUFFER_CELLS).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// validatePlacement — the unified entry point
// ---------------------------------------------------------------------------

describe('validatePlacement', () => {
  it('accepts a valid placement on an empty canvas', () => {
    const verdict = validatePlacement(candidate());
    expect(verdict.ok).toBe(true);
  });

  it('rejects unknown piece types with `invalid-type`', () => {
    const verdict = validatePlacement(candidate({ type: 'not-a-real-piece' }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('invalid-type');
  });

  it('rejects malformed geometry with `invalid-geometry`', () => {
    const verdicts: PlacementRejectionReason[] = [];
    const drive = (override: Partial<PlacementCandidate>) => {
      const v = validatePlacement(candidate(override));
      if (!v.ok) verdicts.push(v.reason);
    };
    drive({ width: 0 });
    drive({ height: -5 });
    drive({ canvasX: Number.NaN });
    drive({ canvasY: Number.POSITIVE_INFINITY });
    expect(verdicts.every((r) => r === 'invalid-geometry')).toBe(true);
  });

  it('rejects out-of-bounds placements with `out-of-bounds`', () => {
    const verdict = validatePlacement(
      candidate({ canvasX: DEFAULT_GRID_SPEC.width - 80, width: 200, height: 40 }),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('out-of-bounds');
  });

  it('rejects overlapping placements with `overlap` and surfaces the conflict id', () => {
    const registry = [registered('flat#0', { canvasX: 200, canvasY: 200 })];
    const verdict = validatePlacement(
      candidate({ canvasX: 240, canvasY: 200 }),
      registry,
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('overlap');
    expect(verdict.conflictId).toBe('flat#0');
  });

  it('rejects hazard-near-spawn with `hazard-near-spawn` BEFORE the generic overlap reason', () => {
    // Construct a registry where the candidate would simultaneously
    // trigger overlap AND hazard-near-spawn — the validator must
    // surface the more specific rule.
    const registry = [
      registered('spawn#0', {
        type: 'spawn-point',
        canvasX: 200,
        canvasY: 200,
        width: 40,
        height: 40,
      }),
    ];
    const lava = candidate({
      type: 'lava-zone',
      canvasX: 200,
      canvasY: 200,
      width: 200,
      height: 80,
    });
    const verdict = validatePlacement(lava, registry);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('hazard-near-spawn');
    expect(verdict.conflictId).toBe('spawn#0');
  });

  it('honours the priority order: type > geometry > bounds > hazard > overlap', () => {
    // Type wins over everything else.
    expect(
      validatePlacement(
        candidate({ type: 'not-a-piece', canvasX: -1000, width: 0 }),
      ),
    ).toEqual({ ok: false, reason: 'invalid-type' });
    // Geometry wins over bounds.
    expect(
      validatePlacement(candidate({ canvasX: -100, width: 0 })),
    ).toEqual({ ok: false, reason: 'invalid-geometry' });
    // Bounds wins over overlap (you can't overlap when you're off-canvas).
    const reg = [registered('flat#0', { canvasX: 200, canvasY: 200 })];
    expect(
      validatePlacement(
        candidate({ canvasX: -100, canvasY: 200 }),
        reg,
      ),
    ).toMatchObject({ ok: false, reason: 'out-of-bounds' });
  });

  it('respects ignoreId so an edit-in-place flow can re-validate the moved piece', () => {
    const registry = [
      registered('flat#0', { canvasX: 200, canvasY: 200 }),
      registered('flat#1', { canvasX: 800, canvasY: 200 }),
    ];
    // Moving flat#0 slightly within its own footprint should NOT
    // reject as overlap when we ignore that id.
    expect(
      validatePlacement(
        candidate({ canvasX: 220, canvasY: 200 }),
        registry,
        DEFAULT_GRID_SPEC,
        'flat#0',
      ),
    ).toEqual({ ok: true });
    // Without the ignore the same drop overlaps.
    expect(
      validatePlacement(candidate({ canvasX: 220, canvasY: 200 }), registry),
    ).toMatchObject({ ok: false, reason: 'overlap' });
  });
});

// ---------------------------------------------------------------------------
// describePlacementRejection — visual-feedback labels
// ---------------------------------------------------------------------------

describe('describePlacementRejection', () => {
  it('returns a short user-facing label per reason', () => {
    expect(describePlacementRejection('out-of-bounds')).toMatch(/bound/i);
    expect(describePlacementRejection('overlap')).toMatch(/overlap/i);
    expect(describePlacementRejection('hazard-near-spawn')).toMatch(/spawn|hazard/i);
    expect(describePlacementRejection('invalid-type')).toMatch(/unknown|piece/i);
    expect(describePlacementRejection('invalid-geometry')).toMatch(/size|geometry/i);
  });

  it('is exhaustive — every PlacementRejectionReason returns a non-empty label', () => {
    const reasons: PlacementRejectionReason[] = [
      'out-of-bounds',
      'invalid-type',
      'invalid-geometry',
      'overlap',
      'hazard-near-spawn',
    ];
    for (const r of reasons) {
      expect(describePlacementRejection(r).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism guard
// ---------------------------------------------------------------------------

describe('placementValidation — determinism', () => {
  it('two identical inputs produce byte-identical verdicts', () => {
    const reg = [
      registered('flat#0', { canvasX: 0, canvasY: 0 }),
      registered('lava#1', {
        type: 'lava-zone',
        canvasX: 400,
        canvasY: 200,
        width: 200,
        height: 80,
      }),
    ];
    const cand = candidate({ canvasX: 100, canvasY: 0 });
    const a = validatePlacement(cand, reg);
    const b = validatePlacement(cand, reg);
    expect(a).toEqual(b);
  });
});
