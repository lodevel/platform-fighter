import { describe, it, expect } from 'vitest';
import {
  BLAST_ZONE_LABEL_PREFIX,
  BlastZoneWatcher,
  type BlastZoneCollisionEvent,
  type MinimalBody,
} from './BlastZoneWatcher';
import { BLAST_ZONE_LABELS, PLATFORM_LABELS } from '../stages/StageRenderer';

/**
 * Sub-AC 4.2 of AC 302: blast-zone collision watcher tests.
 *
 * The watcher's only job is "tell me when a registered character body
 * touches a blast-zone sensor." These tests lock down:
 *
 *   1. Detection — fires for `(character, blastZone.*)` pairs in either
 *      pair-order; ignores everything else (platforms, hitboxes, etc.).
 *   2. Per-event de-duplication — even if a body collides with multiple
 *      blast-zone walls in the same event, the callback fires once.
 *   3. Lifecycle — `unregisterPlayer` stops emissions immediately;
 *      `reset` clears the entire registry.
 *   4. Re-entrancy — modifying the registry inside the callback is safe.
 *   5. Defensive — null bodies, empty events, sensor-vs-sensor pairs
 *      are silently ignored.
 *
 * The watcher consumes a minimal `BlastZonePair` shape (only `bodyA`
 * and `bodyB` with optional `label`), so we can build pairs as plain
 * objects — no Matter.js fixture needed.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlastZoneSensor(edge: keyof typeof BLAST_ZONE_LABELS): MinimalBody {
  return { label: BLAST_ZONE_LABELS[edge] };
}

function makePlatform(passThrough = false): MinimalBody {
  return {
    label: passThrough ? PLATFORM_LABELS.passThrough : PLATFORM_LABELS.solid,
  };
}

function makeCharacter(): MinimalBody {
  return { label: 'character.body' };
}

function makeEvent(
  ...pairs: Array<{ bodyA: MinimalBody | null; bodyB: MinimalBody | null }>
): BlastZoneCollisionEvent {
  return { pairs };
}

interface CallbackLog {
  playerIndex: number;
  edgeLabel: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('BlastZoneWatcher — constants', () => {
  it('label prefix matches the StageRenderer convention', () => {
    expect(BLAST_ZONE_LABEL_PREFIX).toBe('blastZone.');
    // All four canonical edge labels start with the prefix.
    expect(BLAST_ZONE_LABELS.top.startsWith(BLAST_ZONE_LABEL_PREFIX)).toBe(true);
    expect(BLAST_ZONE_LABELS.bottom.startsWith(BLAST_ZONE_LABEL_PREFIX)).toBe(true);
    expect(BLAST_ZONE_LABELS.left.startsWith(BLAST_ZONE_LABEL_PREFIX)).toBe(true);
    expect(BLAST_ZONE_LABELS.right.startsWith(BLAST_ZONE_LABEL_PREFIX)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Construction & registration
// ---------------------------------------------------------------------------

describe('BlastZoneWatcher — registration', () => {
  it('rejects a negative or non-integer playerIndex', () => {
    const w = new BlastZoneWatcher(() => {});
    expect(() => w.registerPlayer(-1, makeCharacter())).toThrow();
    expect(() => w.registerPlayer(1.5, makeCharacter())).toThrow();
  });

  it('isRegistered reflects the registry state', () => {
    const w = new BlastZoneWatcher(() => {});
    expect(w.isRegistered(0)).toBe(false);
    w.registerPlayer(0, makeCharacter());
    expect(w.isRegistered(0)).toBe(true);
  });

  it('re-registering the same playerIndex replaces the body', () => {
    const log: CallbackLog[] = [];
    const w = new BlastZoneWatcher((p, l) => log.push({ playerIndex: p, edgeLabel: l }));
    const oldBody = makeCharacter();
    const newBody = makeCharacter();
    w.registerPlayer(0, oldBody);
    w.registerPlayer(0, newBody);
    // Old body no longer fires.
    w.handleCollisionStart(
      makeEvent({ bodyA: oldBody, bodyB: makeBlastZoneSensor('left') }),
    );
    expect(log.length).toBe(0);
    // New body does.
    w.handleCollisionStart(
      makeEvent({ bodyA: newBody, bodyB: makeBlastZoneSensor('left') }),
    );
    expect(log.length).toBe(1);
  });

  it('unregisterPlayer stops further emissions for that slot', () => {
    const log: CallbackLog[] = [];
    const w = new BlastZoneWatcher((p, l) => log.push({ playerIndex: p, edgeLabel: l }));
    const body = makeCharacter();
    w.registerPlayer(0, body);
    w.unregisterPlayer(0);
    w.handleCollisionStart(
      makeEvent({ bodyA: body, bodyB: makeBlastZoneSensor('top') }),
    );
    expect(log).toEqual([]);
    expect(w.isRegistered(0)).toBe(false);
  });

  it('unregistering a non-existent slot is a silent no-op', () => {
    const w = new BlastZoneWatcher(() => {});
    expect(() => w.unregisterPlayer(0)).not.toThrow();
    expect(() => w.unregisterPlayer(99)).not.toThrow();
  });

  it('reset clears the entire registry', () => {
    const w = new BlastZoneWatcher(() => {});
    w.registerPlayer(0, makeCharacter());
    w.registerPlayer(1, makeCharacter());
    w.reset();
    expect(w.isRegistered(0)).toBe(false);
    expect(w.isRegistered(1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

describe('BlastZoneWatcher — detection', () => {
  it('fires for character→blast-zone in pair order (A,B)', () => {
    const log: CallbackLog[] = [];
    const w = new BlastZoneWatcher((p, l) => log.push({ playerIndex: p, edgeLabel: l }));
    const ch = makeCharacter();
    w.registerPlayer(0, ch);
    w.handleCollisionStart(
      makeEvent({ bodyA: ch, bodyB: makeBlastZoneSensor('top') }),
    );
    expect(log).toEqual([{ playerIndex: 0, edgeLabel: BLAST_ZONE_LABELS.top }]);
  });

  it('fires for blast-zone→character in reverse pair order (A,B)', () => {
    const log: CallbackLog[] = [];
    const w = new BlastZoneWatcher((p, l) => log.push({ playerIndex: p, edgeLabel: l }));
    const ch = makeCharacter();
    w.registerPlayer(0, ch);
    w.handleCollisionStart(
      makeEvent({ bodyA: makeBlastZoneSensor('bottom'), bodyB: ch }),
    );
    expect(log).toEqual([{ playerIndex: 0, edgeLabel: BLAST_ZONE_LABELS.bottom }]);
  });

  it('forwards the exact edge label so HUD direction effects can read it', () => {
    const log: CallbackLog[] = [];
    const w = new BlastZoneWatcher((p, l) => log.push({ playerIndex: p, edgeLabel: l }));
    const ch = makeCharacter();
    w.registerPlayer(0, ch);
    for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
      w.handleCollisionStart(
        makeEvent({ bodyA: ch, bodyB: makeBlastZoneSensor(edge) }),
      );
    }
    expect(log.map((e) => e.edgeLabel)).toEqual([
      BLAST_ZONE_LABELS.top,
      BLAST_ZONE_LABELS.bottom,
      BLAST_ZONE_LABELS.left,
      BLAST_ZONE_LABELS.right,
    ]);
  });

  it('multiplexes correctly across multiple registered players', () => {
    const log: CallbackLog[] = [];
    const w = new BlastZoneWatcher((p, l) => log.push({ playerIndex: p, edgeLabel: l }));
    const p1 = makeCharacter();
    const p2 = makeCharacter();
    w.registerPlayer(0, p1);
    w.registerPlayer(1, p2);
    w.handleCollisionStart(
      makeEvent(
        { bodyA: p1, bodyB: makeBlastZoneSensor('top') },
        { bodyA: makeBlastZoneSensor('left'), bodyB: p2 },
      ),
    );
    expect(log.length).toBe(2);
    expect(log[0]!.playerIndex).toBe(0);
    expect(log[1]!.playerIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Filtering — non-blast-zone collisions
// ---------------------------------------------------------------------------

describe('BlastZoneWatcher — filtering', () => {
  it('ignores character-vs-platform collisions', () => {
    const log: CallbackLog[] = [];
    const w = new BlastZoneWatcher((p, l) => log.push({ playerIndex: p, edgeLabel: l }));
    const ch = makeCharacter();
    w.registerPlayer(0, ch);
    w.handleCollisionStart(
      makeEvent(
        { bodyA: ch, bodyB: makePlatform() },
        { bodyA: ch, bodyB: makePlatform(true) },
      ),
    );
    expect(log).toEqual([]);
  });

  it('ignores hitbox-vs-character collisions', () => {
    const log: CallbackLog[] = [];
    const w = new BlastZoneWatcher((p, l) => log.push({ playerIndex: p, edgeLabel: l }));
    const ch = makeCharacter();
    w.registerPlayer(0, ch);
    w.handleCollisionStart(
      makeEvent({ bodyA: ch, bodyB: { label: 'hitbox.attack' } }),
    );
    expect(log).toEqual([]);
  });

  it('ignores collisions involving unregistered bodies', () => {
    const log: CallbackLog[] = [];
    const w = new BlastZoneWatcher((p, l) => log.push({ playerIndex: p, edgeLabel: l }));
    // Character is NOT registered with the watcher.
    const stranger = makeCharacter();
    w.handleCollisionStart(
      makeEvent({ bodyA: stranger, bodyB: makeBlastZoneSensor('top') }),
    );
    expect(log).toEqual([]);
  });

  it('ignores blast-zone-vs-blast-zone pairs (defensive)', () => {
    const log: CallbackLog[] = [];
    const w = new BlastZoneWatcher((p, l) => log.push({ playerIndex: p, edgeLabel: l }));
    w.handleCollisionStart(
      makeEvent({
        bodyA: makeBlastZoneSensor('top'),
        bodyB: makeBlastZoneSensor('left'),
      }),
    );
    expect(log).toEqual([]);
  });

  it('ignores empty events and missing bodies', () => {
    const log: CallbackLog[] = [];
    const w = new BlastZoneWatcher((p, l) => log.push({ playerIndex: p, edgeLabel: l }));
    w.handleCollisionStart({ pairs: [] });
    w.handleCollisionStart(makeEvent({ bodyA: null, bodyB: null }));
    w.handleCollisionStart(
      makeEvent({ bodyA: null, bodyB: makeBlastZoneSensor('top') }),
    );
    expect(log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Per-event de-duplication
// ---------------------------------------------------------------------------

describe('BlastZoneWatcher — de-duplication', () => {
  it('fires at most once per player per event, even on multi-edge clip', () => {
    const log: CallbackLog[] = [];
    const w = new BlastZoneWatcher((p, l) => log.push({ playerIndex: p, edgeLabel: l }));
    const ch = makeCharacter();
    w.registerPlayer(0, ch);
    // Same event reports the character touching two blast-zone walls
    // simultaneously (corner clip). Should still emit only one event.
    w.handleCollisionStart(
      makeEvent(
        { bodyA: ch, bodyB: makeBlastZoneSensor('left') },
        { bodyA: ch, bodyB: makeBlastZoneSensor('bottom') },
      ),
    );
    expect(log.length).toBe(1);
    expect(log[0]!.playerIndex).toBe(0);
    // Any of the touched edges is a valid choice — the test guarantees
    // the *count* is one, not which edge wins. We just check the label
    // is one of the two we emitted.
    expect([BLAST_ZONE_LABELS.left, BLAST_ZONE_LABELS.bottom]).toContain(
      log[0]!.edgeLabel,
    );
  });

  it('fires again on a *new* event (deduplication is per-event only)', () => {
    const log: CallbackLog[] = [];
    const w = new BlastZoneWatcher((p, l) => log.push({ playerIndex: p, edgeLabel: l }));
    const ch = makeCharacter();
    w.registerPlayer(0, ch);
    w.handleCollisionStart(makeEvent({ bodyA: ch, bodyB: makeBlastZoneSensor('top') }));
    w.handleCollisionStart(makeEvent({ bodyA: ch, bodyB: makeBlastZoneSensor('top') }));
    expect(log.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Re-entrancy
// ---------------------------------------------------------------------------

describe('BlastZoneWatcher — re-entrancy', () => {
  it('callback that unregisters a different player mid-dispatch is safe', () => {
    const log: CallbackLog[] = [];
    let watcherRef: BlastZoneWatcher;
    const w = new BlastZoneWatcher((p, l) => {
      log.push({ playerIndex: p, edgeLabel: l });
      // Eliminate the *other* player as a side-effect.
      const other = p === 0 ? 1 : 0;
      if (watcherRef && watcherRef.isRegistered(other)) {
        watcherRef.unregisterPlayer(other);
      }
    });
    watcherRef = w;
    const p1 = makeCharacter();
    const p2 = makeCharacter();
    w.registerPlayer(0, p1);
    w.registerPlayer(1, p2);
    // Both players touch a blast zone in the same event. The first
    // callback (p1) unregisters p2; we want to verify the second
    // pair in the same event is still safely handled (it'll be
    // ignored because p2 is now unregistered, which is the right
    // semantic — once eliminated, no further losses).
    expect(() =>
      w.handleCollisionStart(
        makeEvent(
          { bodyA: p1, bodyB: makeBlastZoneSensor('top') },
          { bodyA: p2, bodyB: makeBlastZoneSensor('top') },
        ),
      ),
    ).not.toThrow();
    // p1 fired exactly once.
    expect(log.filter((e) => e.playerIndex === 0).length).toBe(1);
  });
});
