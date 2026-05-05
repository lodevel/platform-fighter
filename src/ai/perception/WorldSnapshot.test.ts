import { describe, it, expect } from 'vitest';
import {
  buildWorldSnapshot,
  findOpponentBySlot,
  projectOpponentSnapshot,
  type PerceivedOpponent,
  type PerceivedSelf,
  type PerceivedStage,
  type WorldSnapshot,
} from './WorldSnapshot';
import type {
  PerceivedHazard,
  PerceivedLavaHazard,
} from './hazardPerception';
import type { PlayerSlotIndex } from '../../input/InputProvider';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSelf(overrides: Partial<PerceivedSelf> = {}): PerceivedSelf {
  return {
    slotIndex: 0,
    position: { x: 0, y: 0 },
    velocity: { vx: 0, vy: 0 },
    facing: 1,
    damagePercent: 0,
    stocksRemaining: 3,
    isAirborne: false,
    isInHitstun: false,
    isOnLedge: false,
    ...overrides,
  };
}

function makeOpp(
  slot: PlayerSlotIndex,
  overrides: Partial<PerceivedOpponent> = {},
): PerceivedOpponent {
  return {
    slotIndex: slot,
    position: { x: 100, y: 0 },
    velocity: { vx: 0, vy: 0 },
    facing: -1,
    damagePercent: 0,
    stocksRemaining: 3,
    stateLabel: 'idle',
    isAirborne: false,
    isInvincible: false,
    ...overrides,
  };
}

function makeStage(overrides: Partial<PerceivedStage> = {}): PerceivedStage {
  return {
    stageLeft: -400,
    stageRight: 400,
    stageTop: 200,
    blastZone: { left: -800, right: 800, top: -600, bottom: 600 },
    ...overrides,
  };
}

function draft(
  partial: Partial<WorldSnapshot> = {},
): WorldSnapshot {
  return {
    tickIndex: 0,
    self: makeSelf(),
    opponents: [],
    stage: makeStage(),
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// buildWorldSnapshot — invariants
// ---------------------------------------------------------------------------

describe('buildWorldSnapshot — invariants', () => {
  it('accepts a minimal valid snapshot', () => {
    const snap = buildWorldSnapshot(draft());
    expect(snap.tickIndex).toBe(0);
    expect(snap.opponents).toHaveLength(0);
  });

  it('rejects negative tickIndex', () => {
    expect(() => buildWorldSnapshot(draft({ tickIndex: -1 }))).toThrow(
      /tickIndex/,
    );
  });

  it('rejects non-integer tickIndex', () => {
    expect(() => buildWorldSnapshot(draft({ tickIndex: 0.5 }))).toThrow(
      /tickIndex/,
    );
  });

  it('rejects NaN tickIndex', () => {
    expect(() => buildWorldSnapshot(draft({ tickIndex: NaN }))).toThrow(
      /tickIndex/,
    );
  });

  it('rejects opponent matching self slot', () => {
    expect(() =>
      buildWorldSnapshot(
        draft({
          self: makeSelf({ slotIndex: 1 }),
          opponents: [makeOpp(1)],
        }),
      ),
    ).toThrow(/matches self/);
  });

  it('rejects duplicate opponent slot indices', () => {
    expect(() =>
      buildWorldSnapshot(
        draft({
          opponents: [makeOpp(1), makeOpp(2), makeOpp(1)],
        }),
      ),
    ).toThrow(/duplicate/);
  });

  it('rejects malformed stage box (left > right)', () => {
    expect(() =>
      buildWorldSnapshot(
        draft({
          stage: makeStage({ stageLeft: 500, stageRight: -500 }),
        }),
      ),
    ).toThrow(/stageLeft/);
  });

  it('rejects blast zone that does not enclose the stage', () => {
    expect(() =>
      buildWorldSnapshot(
        draft({
          stage: makeStage({
            blastZone: { left: -100, right: 100, top: -100, bottom: 100 },
          }),
        }),
      ),
    ).toThrow(/blast zone/);
  });

  it('sorts opponents by slot index for stable iteration', () => {
    const snap = buildWorldSnapshot(
      draft({
        opponents: [makeOpp(3), makeOpp(1), makeOpp(2)],
      }),
    );
    expect(snap.opponents.map((o) => o.slotIndex)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// findOpponentBySlot
// ---------------------------------------------------------------------------

describe('findOpponentBySlot', () => {
  it('returns the matching opponent', () => {
    const snap = buildWorldSnapshot(
      draft({ opponents: [makeOpp(1), makeOpp(2)] }),
    );
    expect(findOpponentBySlot(snap, 2)?.slotIndex).toBe(2);
  });

  it('returns null when slot is missing', () => {
    const snap = buildWorldSnapshot(draft({ opponents: [makeOpp(1)] }));
    expect(findOpponentBySlot(snap, 3)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// projectOpponentSnapshot
// ---------------------------------------------------------------------------

describe('projectOpponentSnapshot', () => {
  it('produces signed horizontal distance, positive = right', () => {
    const opp = makeOpp(1, { position: { x: 200, y: 0 } });
    const projected = projectOpponentSnapshot({ x: 50, y: 0 }, opp);
    expect(projected.distance).toBe(150);
    expect(projected.id).toBe('1');
  });

  it('produces negative distance when opponent is to the left', () => {
    const opp = makeOpp(1, { position: { x: 0, y: 0 } });
    const projected = projectOpponentSnapshot({ x: 100, y: 0 }, opp);
    expect(projected.distance).toBe(-100);
  });

  it('passes through stateLabel, damage, isAirborne', () => {
    const opp = makeOpp(2, {
      damagePercent: 87,
      stateLabel: 'attacking',
      isAirborne: true,
    });
    const projected = projectOpponentSnapshot({ x: 0, y: 0 }, opp);
    expect(projected.damagePercent).toBe(87);
    expect(projected.stateLabel).toBe('attacking');
    expect(projected.isAirborne).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PerceivedSelf.currentMove — current move state (AC 10201 Sub-AC 1)
// ---------------------------------------------------------------------------

describe('PerceivedSelf.currentMove', () => {
  it('is optional — a self with no currentMove field still satisfies the type', () => {
    const self = makeSelf();
    // No `currentMove` set; the field is optional, so this compiles
    // and the runtime shape stays clean.
    expect((self as PerceivedSelf).currentMove).toBeUndefined();
  });

  it('accepts an explicit null when the bot is in neutral', () => {
    const self = makeSelf({ currentMove: null });
    expect(self.currentMove).toBe(null);
  });

  it('carries kind / phase / framesRemaining when a move is in flight', () => {
    const self = makeSelf({
      currentMove: {
        kind: 'forwardSmash',
        phase: 'startup',
        framesRemaining: 6,
      },
    });
    expect(self.currentMove?.kind).toBe('forwardSmash');
    expect(self.currentMove?.phase).toBe('startup');
    expect(self.currentMove?.framesRemaining).toBe(6);
  });

  it('round-trips through buildWorldSnapshot without rejection', () => {
    const snap = buildWorldSnapshot(
      draft({
        self: makeSelf({
          currentMove: {
            kind: 'upSpecial',
            phase: 'recovery',
            framesRemaining: 12,
          },
        }),
      }),
    );
    expect(snap.self.currentMove?.kind).toBe('upSpecial');
    expect(snap.self.currentMove?.phase).toBe('recovery');
  });
});

// ---------------------------------------------------------------------------
// WorldSnapshot.hazards — hazard perception (AC 20201 Sub-AC 1)
// ---------------------------------------------------------------------------

function makeLavaHazard(
  overrides: Partial<PerceivedLavaHazard> = {},
): PerceivedLavaHazard {
  return {
    kind: 'lava',
    id: 'lava-1',
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

describe('WorldSnapshot.hazards', () => {
  it('defaults to an empty (frozen) array when no hazards supplied', () => {
    const snap = buildWorldSnapshot(draft());
    expect(snap.hazards).toBeDefined();
    expect(snap.hazards).toEqual([]);
    // Same singleton reference across calls — cheap for hazard-free
    // stages.
    const snap2 = buildWorldSnapshot(draft());
    expect(snap2.hazards).toBe(snap.hazards);
  });

  it('preserves a single supplied hazard verbatim', () => {
    const lava = makeLavaHazard();
    const snap = buildWorldSnapshot(draft({ hazards: [lava] }));
    expect(snap.hazards).toHaveLength(1);
    expect(snap.hazards?.[0]).toBe(lava);
  });

  it('rejects duplicate hazard ids', () => {
    expect(() =>
      buildWorldSnapshot(
        draft({
          hazards: [
            makeLavaHazard({ id: 'dupe' }),
            makeLavaHazard({ id: 'dupe' }),
          ],
        }),
      ),
    ).toThrow(/duplicate hazard id/);
  });

  it('rejects hazards with negative bounds extents', () => {
    expect(() =>
      buildWorldSnapshot(
        draft({
          hazards: [
            makeLavaHazard({
              bounds: { x: 0, y: 100, width: -1, height: 32 },
            }),
          ],
        }),
      ),
    ).toThrow(/width \/ bounds.height/);
  });

  it('rejects hazards with non-finite coordinates', () => {
    expect(() =>
      buildWorldSnapshot(
        draft({
          hazards: [
            makeLavaHazard({
              bounds: { x: NaN, y: 100, width: 64, height: 32 },
            }),
          ],
        }),
      ),
    ).toThrow(/finite numbers/);
  });

  it('sorts hazards into deterministic kind+id order', () => {
    const wind: PerceivedHazard = {
      kind: 'wind',
      id: 'wind-a',
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      isDangerous: false,
      isBlocking: false,
      state: {
        phase: 'quiet',
        force: { x: 0, y: 0 },
        isActive: false,
        framesUntilActive: 30,
      },
    };
    const lavaB = makeLavaHazard({ id: 'lava-b' });
    const lavaA = makeLavaHazard({ id: 'lava-a' });
    // Insertion order: wind, lava-b, lava-a — sort should yield
    // lava-a, lava-b, wind.
    const snap = buildWorldSnapshot(
      draft({ hazards: [wind, lavaB, lavaA] }),
    );
    expect(snap.hazards?.map((h) => h.id)).toEqual([
      'lava-a',
      'lava-b',
      'wind-a',
    ]);
  });
});
