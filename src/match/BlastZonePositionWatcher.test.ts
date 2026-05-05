import { describe, it, expect } from 'vitest';
import {
  BlastZonePositionWatcher,
  BLAST_ZONE_EDGE_PRIORITY,
  type KoEvent,
  type PositionedBody,
} from './BlastZonePositionWatcher';
import type { BlastZone } from '../types';

/**
 * Sub-AC 2 of AC 60202 — position-based KO detection tests.
 *
 * The watcher's contract:
 *
 *   1. Detection — fires the KO callback when a fighter's centre-of-
 *      mass crosses any blast-zone edge.
 *   2. Per-fighter latch — a fighter that lingers outside the blast
 *      zone for multiple ticks fires the callback only ONCE; the
 *      latch is cleared explicitly via `clearOutOfBounds`.
 *   3. Edge priority — corner KOs (past two edges in the same frame)
 *      attribute deterministically to the higher-priority edge.
 *   4. Lifecycle — unregister stops emissions, reset clears state,
 *      `setBlastZone` rearms latches.
 *   5. Determinism — players are scanned in registration-index order.
 *   6. Re-entrancy — callbacks that mutate the registry don't crash.
 *   7. Defensive — invalid blast zones / positions are rejected /
 *      ignored cleanly.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FLAT_ZONE: BlastZone = {
  left: -100,
  right: 100,
  top: -50,
  bottom: 50,
};

function makeBody(x: number, y: number): { position: { x: number; y: number } } {
  return { position: { x, y } };
}

function moveBody(
  body: { position: { x: number; y: number } },
  x: number,
  y: number,
): void {
  body.position.x = x;
  body.position.y = y;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('BlastZonePositionWatcher — construction', () => {
  it('rejects a missing blast zone', () => {
    expect(
      () => new BlastZonePositionWatcher(undefined as unknown as BlastZone, () => {}),
    ).toThrow(/blastZone/);
  });

  it('rejects a blast zone with non-finite fields', () => {
    expect(
      () =>
        new BlastZonePositionWatcher(
          { ...FLAT_ZONE, left: Number.NaN },
          () => {},
        ),
    ).toThrow();
    expect(
      () =>
        new BlastZonePositionWatcher(
          { ...FLAT_ZONE, top: Number.POSITIVE_INFINITY },
          () => {},
        ),
    ).toThrow();
  });

  it('rejects an inverted blast zone', () => {
    expect(
      () =>
        new BlastZonePositionWatcher(
          { left: 100, right: -100, top: -50, bottom: 50 },
          () => {},
        ),
    ).toThrow(/left/);
    expect(
      () =>
        new BlastZonePositionWatcher(
          { left: -100, right: 100, top: 50, bottom: -50 },
          () => {},
        ),
    ).toThrow(/top/);
  });

  it('exposes the active blast zone via getBlastZone', () => {
    const w = new BlastZonePositionWatcher(FLAT_ZONE, () => {});
    expect(w.getBlastZone()).toEqual(FLAT_ZONE);
  });
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('BlastZonePositionWatcher — registration', () => {
  it('rejects a negative or non-integer playerIndex', () => {
    const w = new BlastZonePositionWatcher(FLAT_ZONE, () => {});
    expect(() => w.registerPlayer(-1, makeBody(0, 0))).toThrow();
    expect(() => w.registerPlayer(1.5, makeBody(0, 0))).toThrow();
  });

  it('rejects a body without a usable position field', () => {
    const w = new BlastZonePositionWatcher(FLAT_ZONE, () => {});
    expect(() =>
      w.registerPlayer(0, { position: { x: 'a', y: 0 } } as unknown as PositionedBody),
    ).toThrow();
  });

  it('isRegistered reflects the registry state', () => {
    const w = new BlastZonePositionWatcher(FLAT_ZONE, () => {});
    expect(w.isRegistered(0)).toBe(false);
    w.registerPlayer(0, makeBody(0, 0));
    expect(w.isRegistered(0)).toBe(true);
    w.unregisterPlayer(0);
    expect(w.isRegistered(0)).toBe(false);
  });

  it('re-registering the same slot replaces the body and clears the latch', () => {
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => events.push(e));

    const oldBody = makeBody(-200, 0); // already past the left edge
    w.registerPlayer(0, oldBody);
    w.update(0);
    expect(events.length).toBe(1);
    expect(w.isOutOfBounds(0)).toBe(true);

    // New body inside the bounds — re-registering should clear the
    // latch, and a subsequent update should not emit again.
    const newBody = makeBody(0, 0);
    w.registerPlayer(0, newBody);
    expect(w.isOutOfBounds(0)).toBe(false);
    w.update(1);
    expect(events.length).toBe(1);
  });

  it('unregisterPlayer is idempotent and clears the latch', () => {
    const w = new BlastZonePositionWatcher(FLAT_ZONE, () => {});
    w.unregisterPlayer(99); // safe — slot was never registered
    const body = makeBody(0, 0);
    w.registerPlayer(0, body);
    moveBody(body, -200, 0);
    w.update(0);
    expect(w.isOutOfBounds(0)).toBe(true);
    w.unregisterPlayer(0);
    expect(w.isOutOfBounds(0)).toBe(false);
    expect(w.isRegistered(0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Detection — basic axis-aligned crossings
// ---------------------------------------------------------------------------

describe('BlastZonePositionWatcher — edge detection', () => {
  it('does not emit when the body is fully inside the blast zone', () => {
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => events.push(e));
    w.registerPlayer(0, makeBody(0, 0));
    for (let f = 0; f < 5; f += 1) w.update(f);
    expect(events).toEqual([]);
  });

  it('does not emit when the body sits exactly on the boundary', () => {
    // Strict-crossing semantics — a body whose centre is on the line
    // is in-bounds. Stage interior shares the boundary coordinate.
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => events.push(e));
    w.registerPlayer(0, makeBody(FLAT_ZONE.left, 0));
    w.update(0);
    w.unregisterPlayer(0);
    w.registerPlayer(1, makeBody(FLAT_ZONE.right, 0));
    w.update(1);
    w.unregisterPlayer(1);
    w.registerPlayer(2, makeBody(0, FLAT_ZONE.top));
    w.update(2);
    w.unregisterPlayer(2);
    w.registerPlayer(3, makeBody(0, FLAT_ZONE.bottom));
    w.update(3);
    expect(events).toEqual([]);
  });

  it('emits a single KO event per edge crossing — left', () => {
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => events.push(e));
    const body = makeBody(0, 0);
    w.registerPlayer(0, body);
    moveBody(body, FLAT_ZONE.left - 0.1, 0);
    w.update(42);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({
      playerIndex: 0,
      edge: 'left',
      frame: 42,
    });
    expect(events[0]!.position).toEqual({ x: FLAT_ZONE.left - 0.1, y: 0 });
  });

  it('emits for the right edge', () => {
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => events.push(e));
    const body = makeBody(FLAT_ZONE.right + 1, 5);
    w.registerPlayer(0, body);
    w.update(7);
    expect(events.length).toBe(1);
    expect(events[0]!.edge).toBe('right');
  });

  it('emits for the top edge', () => {
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => events.push(e));
    const body = makeBody(0, FLAT_ZONE.top - 1);
    w.registerPlayer(0, body);
    w.update(0);
    expect(events.length).toBe(1);
    expect(events[0]!.edge).toBe('top');
  });

  it('emits for the bottom edge', () => {
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => events.push(e));
    const body = makeBody(0, FLAT_ZONE.bottom + 1);
    w.registerPlayer(0, body);
    w.update(0);
    expect(events.length).toBe(1);
    expect(events[0]!.edge).toBe('bottom');
  });

  it('handles tunnelling: a body that warps from inside to far past the edge in one tick still fires', () => {
    // Models the "knocked at terminal velocity past a thin sensor in
    // one Matter step" tunnelling case the position watcher exists to
    // catch.
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => events.push(e));
    const body = makeBody(0, 0);
    w.registerPlayer(0, body);
    w.update(0);
    expect(events.length).toBe(0);
    moveBody(body, 50_000, 0); // huge per-step jump past the right edge
    w.update(1);
    expect(events.length).toBe(1);
    expect(events[0]!.edge).toBe('right');
    expect(events[0]!.frame).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Latch behaviour
// ---------------------------------------------------------------------------

describe('BlastZonePositionWatcher — out-of-bounds latch', () => {
  it('fires only once even if the body lingers past the boundary', () => {
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => events.push(e));
    const body = makeBody(FLAT_ZONE.right + 5, 0);
    w.registerPlayer(0, body);
    for (let f = 0; f < 10; f += 1) w.update(f);
    expect(events.length).toBe(1);
    expect(w.isOutOfBounds(0)).toBe(true);
  });

  it('clearOutOfBounds re-arms the next crossing', () => {
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => events.push(e));
    const body = makeBody(FLAT_ZONE.right + 5, 0);
    w.registerPlayer(0, body);
    w.update(0);
    expect(events.length).toBe(1);

    // Simulate respawn — body teleported back inside, latch cleared.
    moveBody(body, 0, 0);
    w.clearOutOfBounds(0);
    expect(w.isOutOfBounds(0)).toBe(false);

    w.update(1);
    expect(events.length).toBe(1);

    // Cross again later.
    moveBody(body, FLAT_ZONE.left - 1, 0);
    w.update(2);
    expect(events.length).toBe(2);
    expect(events[1]!.edge).toBe('left');
    expect(events[1]!.frame).toBe(2);
  });

  it('clearOutOfBounds is idempotent on a cleared slot', () => {
    const w = new BlastZonePositionWatcher(FLAT_ZONE, () => {});
    expect(() => w.clearOutOfBounds(0)).not.toThrow();
    expect(() => w.clearOutOfBounds(99)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Edge priority — corner KOs
// ---------------------------------------------------------------------------

describe('BlastZonePositionWatcher — edge priority', () => {
  it('exposes a stable priority order constant', () => {
    expect(BLAST_ZONE_EDGE_PRIORITY).toEqual(['top', 'bottom', 'left', 'right']);
  });

  it('attributes a corner KO to top when both top and side are crossed', () => {
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => events.push(e));
    // Past both the top edge AND the right edge.
    w.registerPlayer(0, makeBody(FLAT_ZONE.right + 50, FLAT_ZONE.top - 50));
    w.update(0);
    expect(events.length).toBe(1);
    expect(events[0]!.edge).toBe('top');
  });

  it('attributes a bottom-side corner to bottom when no top is crossed', () => {
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => events.push(e));
    // Past both the bottom edge AND the left edge.
    w.registerPlayer(0, makeBody(FLAT_ZONE.left - 50, FLAT_ZONE.bottom + 50));
    w.update(0);
    expect(events.length).toBe(1);
    expect(events[0]!.edge).toBe('bottom');
  });

  it('attributes a side-only corner to left ahead of right', () => {
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => events.push(e));
    // Impossible geometrically with a single body, but guarded
    // explicitly: priority order picks `left` over `right`.
    // Here we register two bodies that each cross one side.
    w.registerPlayer(0, makeBody(FLAT_ZONE.left - 1, 0));
    w.registerPlayer(1, makeBody(FLAT_ZONE.right + 1, 0));
    w.update(0);
    expect(events.map((e) => e.edge)).toEqual(['left', 'right']);
  });
});

// ---------------------------------------------------------------------------
// Determinism / scan order
// ---------------------------------------------------------------------------

describe('BlastZonePositionWatcher — scan order', () => {
  it('emits in ascending player-index order regardless of registration order', () => {
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => events.push(e));
    // Register out of order on purpose.
    w.registerPlayer(2, makeBody(FLAT_ZONE.right + 1, 0));
    w.registerPlayer(0, makeBody(FLAT_ZONE.left - 1, 0));
    w.registerPlayer(3, makeBody(0, FLAT_ZONE.bottom + 1));
    w.registerPlayer(1, makeBody(0, FLAT_ZONE.top - 1));
    w.update(99);
    expect(events.map((e) => e.playerIndex)).toEqual([0, 1, 2, 3]);
    expect(events.map((e) => e.edge)).toEqual(['left', 'top', 'right', 'bottom']);
    for (const e of events) expect(e.frame).toBe(99);
  });

  it('returns the same events array as it dispatches via callback', () => {
    const seen: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => seen.push(e));
    w.registerPlayer(0, makeBody(FLAT_ZONE.left - 1, 0));
    w.registerPlayer(1, makeBody(FLAT_ZONE.right + 1, 0));
    const returned = w.update(0);
    expect(returned).toEqual(seen);
  });

  it('returns an empty array when there are no registered players', () => {
    const w = new BlastZonePositionWatcher(FLAT_ZONE, () => {});
    expect(w.update(0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Re-entrancy
// ---------------------------------------------------------------------------

describe('BlastZonePositionWatcher — re-entrancy', () => {
  it('survives an unregister inside the callback', () => {
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => {
      events.push(e);
      // Mid-callback: kick this slot out (e.g. a final-stock KO).
      w.unregisterPlayer(e.playerIndex);
    });
    w.registerPlayer(0, makeBody(FLAT_ZONE.left - 1, 0));
    w.registerPlayer(1, makeBody(FLAT_ZONE.right + 1, 0));
    w.update(0);
    expect(events.length).toBe(2);
    expect(w.isRegistered(0)).toBe(false);
    expect(w.isRegistered(1)).toBe(false);
  });

  it('survives a callback that registers a new player mid-tick', () => {
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => {
      events.push(e);
      if (e.playerIndex === 0) {
        w.registerPlayer(2, makeBody(FLAT_ZONE.right + 1, 0));
      }
    });
    w.registerPlayer(0, makeBody(FLAT_ZONE.left - 1, 0));
    // The newly-registered slot 2 should NOT fire on the same tick — it
    // was added after the snapshot — but should fire on the next.
    w.update(0);
    expect(events.length).toBe(1);
    w.update(1);
    expect(events.length).toBe(2);
    expect(events[1]!.playerIndex).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Defensive guards
// ---------------------------------------------------------------------------

describe('BlastZonePositionWatcher — defensive guards', () => {
  it('ignores NaN / Infinity positions without firing', () => {
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => events.push(e));
    const body = makeBody(0, 0);
    w.registerPlayer(0, body);
    moveBody(body, Number.NaN, 0);
    w.update(0);
    moveBody(body, Number.POSITIVE_INFINITY, 0);
    w.update(1);
    expect(events).toEqual([]);
    expect(w.isOutOfBounds(0)).toBe(false);
  });

  it('reset clears every registered player and latch', () => {
    const w = new BlastZonePositionWatcher(FLAT_ZONE, () => {});
    w.registerPlayer(0, makeBody(FLAT_ZONE.left - 1, 0));
    w.registerPlayer(1, makeBody(FLAT_ZONE.right + 1, 0));
    w.update(0);
    expect(w.isOutOfBounds(0)).toBe(true);
    expect(w.isOutOfBounds(1)).toBe(true);
    w.reset();
    expect(w.isRegistered(0)).toBe(false);
    expect(w.isRegistered(1)).toBe(false);
    expect(w.isOutOfBounds(0)).toBe(false);
  });

  it('setBlastZone replaces the rect and clears all latches', () => {
    const events: KoEvent[] = [];
    const w = new BlastZonePositionWatcher(FLAT_ZONE, (e) => events.push(e));
    const body = makeBody(150, 0); // past the right edge of FLAT_ZONE
    w.registerPlayer(0, body);
    w.update(0);
    expect(events.length).toBe(1);

    // Widen the zone — the body is now in-bounds again.
    w.setBlastZone({ left: -500, right: 500, top: -500, bottom: 500 });
    expect(w.isOutOfBounds(0)).toBe(false);
    w.update(1);
    expect(events.length).toBe(1);
  });

  it('setBlastZone rejects an invalid rect', () => {
    const w = new BlastZonePositionWatcher(FLAT_ZONE, () => {});
    expect(() =>
      w.setBlastZone({ left: 100, right: -100, top: -50, bottom: 50 }),
    ).toThrow();
  });
});
