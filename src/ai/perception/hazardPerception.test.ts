import { describe, it, expect } from 'vitest';
import {
  PERCEIVED_HAZARD_KINDS,
  chebyshevDistanceToHazardEdge,
  distanceToHazardCenter,
  findNearestDangerousHazard,
  findNearestHazard,
  getBlockingHazards,
  getDangerousHazards,
  getHazardAabbMinMax,
  pointInsideHazard,
  sortPerceivedHazards,
  validatePerceivedHazard,
  type PerceivedCrumblingHazard,
  type PerceivedHazard,
  type PerceivedLavaHazard,
  type PerceivedPeriodicHazard,
  type PerceivedWindHazard,
} from './hazardPerception';

// ---------------------------------------------------------------------------
// Fixtures — one builder per kind so tests stay readable
// ---------------------------------------------------------------------------

function makeLava(
  overrides: Partial<PerceivedLavaHazard> = {},
): PerceivedLavaHazard {
  return {
    kind: 'lava',
    id: 'lava',
    bounds: { x: 0, y: 100, width: 64, height: 32 },
    isDangerous: true,
    isBlocking: false,
    state: {
      phase: 'rising',
      heightNorm: 0.7,
      isActive: true,
      damagePerTick: 8,
      framesUntilActive: 0,
    },
    ...overrides,
  };
}

function makeWind(
  overrides: Partial<PerceivedWindHazard> = {},
): PerceivedWindHazard {
  return {
    kind: 'wind',
    id: 'wind',
    bounds: { x: 200, y: 0, width: 100, height: 200 },
    isDangerous: false,
    isBlocking: false,
    state: {
      phase: 'forward',
      force: { x: 0.5, y: 0 },
      isActive: true,
      framesUntilActive: 0,
    },
    ...overrides,
  };
}

function makeCrumble(
  overrides: Partial<PerceivedCrumblingHazard> = {},
): PerceivedCrumblingHazard {
  return {
    kind: 'crumbling',
    id: 'crumble',
    bounds: { x: -200, y: 50, width: 80, height: 16 },
    isDangerous: false,
    isBlocking: true,
    state: {
      phase: 'intact',
      isSolid: true,
      framesUntilNextTransition: Infinity,
    },
    ...overrides,
  };
}

function makePeriodic(
  overrides: Partial<PerceivedPeriodicHazard> = {},
): PerceivedPeriodicHazard {
  return {
    kind: 'periodic',
    id: 'periodic',
    bounds: { x: 100, y: -50, width: 96, height: 16 },
    isDangerous: false,
    isBlocking: true,
    state: {
      phase: 'solid',
      isSolid: true,
      framesUntilNextTransition: 120,
      framesUntilSolid: 0,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PERCEIVED_HAZARD_KINDS
// ---------------------------------------------------------------------------

describe('PERCEIVED_HAZARD_KINDS', () => {
  it('includes all four M2 hazard kinds', () => {
    expect(PERCEIVED_HAZARD_KINDS.has('lava')).toBe(true);
    expect(PERCEIVED_HAZARD_KINDS.has('wind')).toBe(true);
    expect(PERCEIVED_HAZARD_KINDS.has('crumbling')).toBe(true);
    expect(PERCEIVED_HAZARD_KINDS.has('periodic')).toBe(true);
  });

  it('does not include unknown kinds', () => {
    // Cast through `unknown` so the test compiles with the union type
    // but still exercises the runtime guard against typos.
    expect(
      PERCEIVED_HAZARD_KINDS.has('moving' as unknown as PerceivedHazard['kind']),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validatePerceivedHazard
// ---------------------------------------------------------------------------

describe('validatePerceivedHazard', () => {
  it('accepts a well-formed lava hazard', () => {
    expect(() => validatePerceivedHazard(makeLava())).not.toThrow();
  });

  it('accepts a degenerate (zero-area) hazard — used for fully-receded lava', () => {
    expect(() =>
      validatePerceivedHazard(
        makeLava({
          bounds: { x: 0, y: 100, width: 0, height: 0 },
          isDangerous: false,
        }),
      ),
    ).not.toThrow();
  });

  it('rejects an empty id', () => {
    expect(() =>
      validatePerceivedHazard(makeLava({ id: '' })),
    ).toThrow(/id must be a non-empty string/);
  });

  it('rejects a non-string id', () => {
    expect(() =>
      validatePerceivedHazard(
        makeLava({ id: undefined as unknown as string }),
      ),
    ).toThrow(/id must be a non-empty string/);
  });

  it('rejects an unknown kind', () => {
    const bogus = {
      ...makeLava(),
      kind: 'moving' as unknown as PerceivedLavaHazard['kind'],
    };
    expect(() => validatePerceivedHazard(bogus as PerceivedHazard)).toThrow(
      /unknown kind/,
    );
  });

  it('rejects non-finite bounds coordinates', () => {
    expect(() =>
      validatePerceivedHazard(
        makeLava({ bounds: { x: NaN, y: 0, width: 10, height: 10 } }),
      ),
    ).toThrow(/finite numbers/);
    expect(() =>
      validatePerceivedHazard(
        makeLava({ bounds: { x: 0, y: Infinity, width: 10, height: 10 } }),
      ),
    ).toThrow(/finite numbers/);
  });

  it('rejects negative bounds extents', () => {
    expect(() =>
      validatePerceivedHazard(
        makeLava({ bounds: { x: 0, y: 0, width: -10, height: 10 } }),
      ),
    ).toThrow(/width \/ bounds.height/);
    expect(() =>
      validatePerceivedHazard(
        makeLava({ bounds: { x: 0, y: 0, width: 10, height: -1 } }),
      ),
    ).toThrow(/width \/ bounds.height/);
  });
});

// ---------------------------------------------------------------------------
// getHazardAabbMinMax
// ---------------------------------------------------------------------------

describe('getHazardAabbMinMax', () => {
  it('expands centre + half-extents into min/max bounds', () => {
    const r = getHazardAabbMinMax({ x: 100, y: 50, width: 40, height: 20 });
    expect(r.minX).toBe(80);
    expect(r.maxX).toBe(120);
    expect(r.minY).toBe(40);
    expect(r.maxY).toBe(60);
  });

  it('handles zero-area bounds gracefully', () => {
    const r = getHazardAabbMinMax({ x: 0, y: 0, width: 0, height: 0 });
    expect(r.minX).toBe(0);
    expect(r.maxX).toBe(0);
    expect(r.minY).toBe(0);
    expect(r.maxY).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// pointInsideHazard
// ---------------------------------------------------------------------------

describe('pointInsideHazard', () => {
  it('returns true for a point at the centre', () => {
    expect(pointInsideHazard({ x: 0, y: 100 }, makeLava())).toBe(true);
  });

  it('returns true on the boundary (inclusive)', () => {
    // Lava bounds: centre (0, 100), 64x32 → minX = -32, maxX = 32, minY = 84, maxY = 116.
    expect(pointInsideHazard({ x: -32, y: 100 }, makeLava())).toBe(true);
    expect(pointInsideHazard({ x: 32, y: 116 }, makeLava())).toBe(true);
  });

  it('returns false outside the AABB on either axis', () => {
    expect(pointInsideHazard({ x: 33, y: 100 }, makeLava())).toBe(false);
    expect(pointInsideHazard({ x: 0, y: 200 }, makeLava())).toBe(false);
  });

  it('returns false for a degenerate (zero-area) hazard regardless of point', () => {
    const lava = makeLava({
      bounds: { x: 0, y: 100, width: 0, height: 0 },
    });
    expect(pointInsideHazard({ x: 0, y: 100 }, lava)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// distanceToHazardCenter
// ---------------------------------------------------------------------------

describe('distanceToHazardCenter', () => {
  it('produces signed deltas relative to the hazard centre', () => {
    const lava = makeLava({
      bounds: { x: 100, y: 200, width: 64, height: 32 },
    });
    const m = distanceToHazardCenter({ x: 50, y: 250 }, lava);
    expect(m.dx).toBe(50);
    expect(m.dy).toBe(-50);
    expect(m.horizontalAbs).toBe(50);
    expect(m.verticalAbs).toBe(50);
  });

  it('returns zero metrics for a point exactly at the centre', () => {
    const lava = makeLava({
      bounds: { x: 100, y: 200, width: 64, height: 32 },
    });
    const m = distanceToHazardCenter({ x: 100, y: 200 }, lava);
    expect(m.chebyshev).toBe(0);
    expect(m.euclideanSquared).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// chebyshevDistanceToHazardEdge
// ---------------------------------------------------------------------------

describe('chebyshevDistanceToHazardEdge', () => {
  // Reference hazard: centred at (0,0), 100x40 → minX -50, maxX 50, minY -20, maxY 20.
  const hazard: PerceivedHazard = {
    kind: 'lava',
    id: 'ref',
    bounds: { x: 0, y: 0, width: 100, height: 40 },
    isDangerous: true,
    isBlocking: false,
    state: {
      phase: 'rising',
      heightNorm: 1,
      isActive: true,
      damagePerTick: 8,
      framesUntilActive: 0,
    },
  };

  it('returns 0 on the boundary', () => {
    expect(chebyshevDistanceToHazardEdge({ x: 50, y: 0 }, hazard)).toBe(0);
    expect(chebyshevDistanceToHazardEdge({ x: 0, y: -20 }, hazard)).toBe(0);
  });

  it('returns the gap to the nearest edge when outside on one axis', () => {
    // 30 px to the right of the right edge (50 + 30 = 80).
    expect(chebyshevDistanceToHazardEdge({ x: 80, y: 0 }, hazard)).toBe(30);
    // 60 px below the bottom edge (20 + 60 = 80).
    expect(chebyshevDistanceToHazardEdge({ x: 0, y: 80 }, hazard)).toBe(60);
  });

  it('returns the larger axis gap when outside on both axes (chebyshev)', () => {
    // 30 px right + 60 px below → chebyshev 60.
    expect(chebyshevDistanceToHazardEdge({ x: 80, y: 80 }, hazard)).toBe(60);
    // 70 px right + 5 px above → chebyshev 70.
    expect(chebyshevDistanceToHazardEdge({ x: 120, y: 25 }, hazard)).toBe(70);
  });

  it('returns negative penetration when fully inside', () => {
    // Centre — equally penetrating both axes; closest edge is 20 px
    // (the half-height). Result is the worse penetration (the larger
    // absolute value, encoded as `Math.max(xGap, yGap)` with both
    // negative — i.e. the smaller magnitude).
    const d = chebyshevDistanceToHazardEdge({ x: 0, y: 0 }, hazard);
    // Closer edge is along Y (half-height 20 < half-width 50), so
    // escape distance is 20.
    expect(d).toBe(-20);
  });

  it('returns the closer-edge penetration when off-centre but inside', () => {
    // (40, 5): right-edge gap = 50-40 = 10; left-edge = 40 - (-50) = 90.
    // bottom-edge = 20 - 5 = 15; top-edge = 5 - (-20) = 25.
    // Min(10, 15) on each axis → -10 horizontally, -15 vertically.
    // chebyshev = max(-10, -15) = -10 (closer edge horizontal).
    expect(chebyshevDistanceToHazardEdge({ x: 40, y: 5 }, hazard)).toBe(-10);
  });
});

// ---------------------------------------------------------------------------
// getDangerousHazards / getBlockingHazards
// ---------------------------------------------------------------------------

describe('getDangerousHazards / getBlockingHazards', () => {
  it('filters by dangerous flag', () => {
    const lava = makeLava();
    const wind = makeWind();
    const crumble = makeCrumble();
    const out = getDangerousHazards([lava, wind, crumble]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(lava);
  });

  it('filters by blocking flag', () => {
    const lava = makeLava();
    const wind = makeWind();
    const crumble = makeCrumble();
    const out = getBlockingHazards([lava, wind, crumble]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(crumble);
  });

  it('returns an empty array unchanged (same reference)', () => {
    const empty: ReadonlyArray<PerceivedHazard> = [];
    expect(getDangerousHazards(empty)).toBe(empty);
    expect(getBlockingHazards(empty)).toBe(empty);
  });

  it('returns multiple matches in input order', () => {
    const a = makeLava({ id: 'a' });
    const b = makeLava({ id: 'b' });
    const c = makeWind({ id: 'c' }); // not dangerous in this fixture
    const out = getDangerousHazards([a, c, b]);
    expect(out.map((h) => h.id)).toEqual(['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// findNearestHazard / findNearestDangerousHazard
// ---------------------------------------------------------------------------

describe('findNearestHazard', () => {
  it('returns null for an empty list', () => {
    expect(findNearestHazard({ x: 0, y: 0 }, [])).toBeNull();
  });

  it('picks the closest hazard by edge distance', () => {
    const near = makeLava({
      id: 'near',
      bounds: { x: 30, y: 0, width: 20, height: 20 },
      // Edge distance from (0,0) to AABB (20..40, -10..10) = 20.
    });
    const far = makeLava({
      id: 'far',
      bounds: { x: 200, y: 0, width: 20, height: 20 },
      // Edge distance = 190.
    });
    const result = findNearestHazard({ x: 0, y: 0 }, [far, near]);
    expect(result?.hazard.id).toBe('near');
    expect(result?.edgeDistance).toBe(20);
  });

  it('respects an optional predicate', () => {
    const dangerous = makeLava({
      id: 'far-dangerous',
      bounds: { x: 200, y: 0, width: 20, height: 20 },
      isDangerous: true,
    });
    const safe = makeWind({
      id: 'near-safe',
      bounds: { x: 30, y: 0, width: 20, height: 20 },
      isDangerous: false,
    });
    const r = findNearestHazard(
      { x: 0, y: 0 },
      [safe, dangerous],
      (h) => h.isDangerous,
    );
    expect(r?.hazard.id).toBe('far-dangerous');
  });

  it('breaks ties deterministically — earlier-in-list wins', () => {
    const first = makeLava({
      id: 'first',
      bounds: { x: 30, y: 0, width: 20, height: 20 },
    });
    const second = makeLava({
      id: 'second',
      bounds: { x: -30, y: 0, width: 20, height: 20 },
      // Symmetric — same edge distance from origin.
    });
    const r = findNearestHazard({ x: 0, y: 0 }, [first, second]);
    expect(r?.hazard.id).toBe('first');
    // Reversed order picks the other one — confirms the policy is
    // "first match wins" rather than something content-dependent.
    const r2 = findNearestHazard({ x: 0, y: 0 }, [second, first]);
    expect(r2?.hazard.id).toBe('second');
  });
});

describe('findNearestDangerousHazard', () => {
  it('mirrors findNearestHazard with the dangerous predicate baked in', () => {
    const dangerous = makeLava({ id: 'd', isDangerous: true });
    const safe = makeWind({ id: 's', isDangerous: false });
    const r = findNearestDangerousHazard({ x: 0, y: 0 }, [safe, dangerous]);
    expect(r?.hazard.id).toBe('d');
  });

  it('returns null when no hazard is dangerous', () => {
    const safe1 = makeWind({ id: 's1', isDangerous: false });
    const safe2 = makeCrumble({ id: 's2', isDangerous: false });
    expect(findNearestDangerousHazard({ x: 0, y: 0 }, [safe1, safe2])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sortPerceivedHazards
// ---------------------------------------------------------------------------

describe('sortPerceivedHazards', () => {
  it('returns the input unchanged when length ≤ 1', () => {
    const empty: ReadonlyArray<PerceivedHazard> = [];
    expect(sortPerceivedHazards(empty)).toBe(empty);
    const single = [makeLava()];
    expect(sortPerceivedHazards(single)).toBe(single);
  });

  it('orders by kind: lava → wind → crumbling → periodic', () => {
    const lava = makeLava({ id: 'l' });
    const wind = makeWind({ id: 'w' });
    const crumble = makeCrumble({ id: 'c' });
    const periodic = makePeriodic({ id: 'p' });
    const sorted = sortPerceivedHazards([periodic, crumble, wind, lava]);
    expect(sorted.map((h) => h.kind)).toEqual([
      'lava',
      'wind',
      'crumbling',
      'periodic',
    ]);
  });

  it('breaks kind ties by id lexicographically', () => {
    const a = makeLava({ id: 'a' });
    const b = makeLava({ id: 'b' });
    const c = makeLava({ id: 'c' });
    const sorted = sortPerceivedHazards([c, a, b]);
    expect(sorted.map((h) => h.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const lava = makeLava({ id: 'l' });
    const wind = makeWind({ id: 'w' });
    const input = [wind, lava];
    sortPerceivedHazards(input);
    expect(input.map((h) => h.id)).toEqual(['w', 'l']);
  });
});

// ---------------------------------------------------------------------------
// Type-level smoke — discriminated union narrows correctly
// ---------------------------------------------------------------------------

describe('PerceivedHazard discriminated union', () => {
  it('narrows on `kind` so per-variant state fields are reachable', () => {
    const list: ReadonlyArray<PerceivedHazard> = [
      makeLava(),
      makeWind(),
      makeCrumble(),
      makePeriodic(),
    ];
    const seenKinds: string[] = [];
    for (const h of list) {
      switch (h.kind) {
        case 'lava':
          // Property access should compile because TS narrowed to PerceivedLavaHazard.
          expect(typeof h.state.heightNorm).toBe('number');
          seenKinds.push('lava');
          break;
        case 'wind':
          expect(typeof h.state.force.x).toBe('number');
          seenKinds.push('wind');
          break;
        case 'crumbling':
          expect(typeof h.state.isSolid).toBe('boolean');
          seenKinds.push('crumbling');
          break;
        case 'periodic':
          expect(typeof h.state.framesUntilSolid).toBe('number');
          seenKinds.push('periodic');
          break;
      }
    }
    expect(seenKinds).toEqual(['lava', 'wind', 'crumbling', 'periodic']);
  });
});
