/**
 * Sub-AC 3 of AC 303 — respawn coordinator unit tests.
 *
 * Locks down the three responsibilities the AC calls out, in isolation
 * from the rest of the match pipeline:
 *
 *   1. **Spawn platform placement** — every applied respawn produces
 *      a `SpawnPlatform` overlay sized by the configured geometry,
 *      positioned under the spawn point, expiring exactly when the
 *      invincibility window ends.
 *
 *   2. **Invulnerability frames** — the configured invincibility
 *      window from the `RespawnEvent` is forwarded to the registered
 *      target's `setInvincibility` call.
 *
 *   3. **State reset when stocks remain** — `setPosition`,
 *      `setDamagePercent(0)`, `setFacing(faceOnSpawn)`, and
 *      `setInvincibility` are all called, in that order, on every
 *      drained event.
 *
 * Plus determinism: same event log → same applied records → same
 * platform list. This is the gate the M4 replay system depends on.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_SPAWN_PLATFORM_GEOMETRY,
  RespawnHandler,
  type AppliedRespawn,
  type RespawnSlot,
  type RespawnTarget,
} from './RespawnHandler';
import type { RespawnEvent } from './StockTracker';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface RecordedCalls {
  setPosition: Array<{ x: number; y: number }>;
  setDamagePercent: number[];
  setInvincibility: number[];
  setFacing: Array<1 | -1>;
  /** Order of calls — proves the canonical reset → damage → iframe → facing sequence. */
  callOrder: Array<'setPosition' | 'setDamagePercent' | 'setInvincibility' | 'setFacing'>;
}

function makeRecordingTarget(): { target: RespawnTarget; calls: RecordedCalls } {
  const calls: RecordedCalls = {
    setPosition: [],
    setDamagePercent: [],
    setInvincibility: [],
    setFacing: [],
    callOrder: [],
  };
  const target: RespawnTarget = {
    setPosition(x, y) {
      calls.setPosition.push({ x, y });
      calls.callOrder.push('setPosition');
    },
    setDamagePercent(p) {
      calls.setDamagePercent.push(p);
      calls.callOrder.push('setDamagePercent');
    },
    setInvincibility(f) {
      calls.setInvincibility.push(f);
      calls.callOrder.push('setInvincibility');
    },
    setFacing(f) {
      calls.setFacing.push(f);
      calls.callOrder.push('setFacing');
    },
  };
  return { target, calls };
}

function makeSlot(overrides: Partial<RespawnSlot> = {}): RespawnSlot {
  return {
    playerIndex: 0,
    spawnX: 480,
    spawnY: 760,
    faceOnSpawn: 1,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<RespawnEvent> = {}): RespawnEvent {
  return {
    playerIndex: 0,
    invincibilityFrames: 90,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. State reset
// ---------------------------------------------------------------------------

describe('RespawnHandler — state reset', () => {
  it('teleports the fighter to the registered spawn point', () => {
    const handler = new RespawnHandler();
    const { target, calls } = makeRecordingTarget();
    handler.registerSlot(makeSlot({ spawnX: 1200, spawnY: 540 }), target);

    handler.applyRespawns([makeEvent()], 100);

    expect(calls.setPosition).toEqual([{ x: 1200, y: 540 }]);
  });

  it('resets damage percent to 0', () => {
    const handler = new RespawnHandler();
    const { target, calls } = makeRecordingTarget();
    handler.registerSlot(makeSlot(), target);

    handler.applyRespawns([makeEvent()], 0);

    expect(calls.setDamagePercent).toEqual([0]);
  });

  it('faces the fighter inward (per slot.faceOnSpawn)', () => {
    const handler = new RespawnHandler();
    const recA = makeRecordingTarget();
    const recB = makeRecordingTarget();
    handler.registerSlot(makeSlot({ playerIndex: 0, faceOnSpawn: 1 }), recA.target);
    handler.registerSlot(makeSlot({ playerIndex: 1, faceOnSpawn: -1 }), recB.target);

    handler.applyRespawns(
      [
        makeEvent({ playerIndex: 0 }),
        makeEvent({ playerIndex: 1 }),
      ],
      0,
    );

    expect(recA.calls.setFacing).toEqual([1]);
    expect(recB.calls.setFacing).toEqual([-1]);
  });

  it('applies state-reset calls in the canonical order', () => {
    // Position → Damage → Invincibility → Facing.
    // The order matters: setPosition clears transient state
    // (jumps/hitstun/attack); setDamagePercent then resets the meter;
    // setInvincibility grants the grace window; setFacing finishes the
    // visual contract. A renderer reading the post-respawn state in
    // that order sees a fully consistent fighter.
    const handler = new RespawnHandler();
    const { target, calls } = makeRecordingTarget();
    handler.registerSlot(makeSlot(), target);

    handler.applyRespawns([makeEvent()], 0);

    expect(calls.callOrder).toEqual([
      'setPosition',
      'setDamagePercent',
      'setInvincibility',
      'setFacing',
    ]);
  });

  it('returns one AppliedRespawn per processed event', () => {
    const handler = new RespawnHandler();
    const recA = makeRecordingTarget();
    const recB = makeRecordingTarget();
    handler.registerSlot(makeSlot({ playerIndex: 0, faceOnSpawn: 1 }), recA.target);
    handler.registerSlot(makeSlot({ playerIndex: 1, faceOnSpawn: -1 }), recB.target);

    const applied = handler.applyRespawns(
      [
        makeEvent({ playerIndex: 0, invincibilityFrames: 90 }),
        makeEvent({ playerIndex: 1, invincibilityFrames: 60 }),
      ],
      42,
    );

    expect(applied).toHaveLength(2);
    expect(applied[0]).toMatchObject({
      playerIndex: 0,
      faceOnSpawn: 1,
      invincibilityFrames: 90,
      frame: 42,
    });
    expect(applied[1]).toMatchObject({
      playerIndex: 1,
      faceOnSpawn: -1,
      invincibilityFrames: 60,
      frame: 42,
    });
  });

  it('skips events for unregistered slots without throwing', () => {
    const handler = new RespawnHandler();
    const { target } = makeRecordingTarget();
    handler.registerSlot(makeSlot({ playerIndex: 0 }), target);

    // Slot 1 was never registered — handler should silently skip it.
    const applied = handler.applyRespawns(
      [
        makeEvent({ playerIndex: 0 }),
        makeEvent({ playerIndex: 1 }),
      ],
      0,
    );

    expect(applied).toHaveLength(1);
    expect(applied[0]!.playerIndex).toBe(0);
  });

  it('rejects negative / non-integer playerIndex on registration', () => {
    const handler = new RespawnHandler();
    const { target } = makeRecordingTarget();
    expect(() =>
      handler.registerSlot(makeSlot({ playerIndex: -1 }), target),
    ).toThrow();
    expect(() =>
      handler.registerSlot(makeSlot({ playerIndex: 1.5 }), target),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. Invulnerability frames
// ---------------------------------------------------------------------------

describe('RespawnHandler — invulnerability frames', () => {
  it('forwards the event invincibilityFrames to the target', () => {
    const handler = new RespawnHandler();
    const { target, calls } = makeRecordingTarget();
    handler.registerSlot(makeSlot(), target);

    handler.applyRespawns([makeEvent({ invincibilityFrames: 42 })], 0);

    expect(calls.setInvincibility).toEqual([42]);
  });

  it('clamps negative invincibilityFrames to 0', () => {
    const handler = new RespawnHandler();
    const { target, calls } = makeRecordingTarget();
    handler.registerSlot(makeSlot(), target);

    handler.applyRespawns([makeEvent({ invincibilityFrames: -50 })], 0);

    expect(calls.setInvincibility).toEqual([0]);
  });

  it('floors fractional invincibilityFrames', () => {
    const handler = new RespawnHandler();
    const { target, calls } = makeRecordingTarget();
    handler.registerSlot(makeSlot(), target);

    handler.applyRespawns([makeEvent({ invincibilityFrames: 89.9 })], 0);

    expect(calls.setInvincibility).toEqual([89]);
  });

  it('canonical 90-frame window is the documented default', () => {
    // The Seed's "respawn invincibility" contract sits in StockTracker's
    // DEFAULT_INVINCIBILITY_FRAMES (= 90). The handler is the consumer —
    // proving it forwards 90 unchanged anchors the end-to-end contract.
    const handler = new RespawnHandler();
    const { target, calls } = makeRecordingTarget();
    handler.registerSlot(makeSlot(), target);

    handler.applyRespawns([makeEvent({ invincibilityFrames: 90 })], 0);

    expect(calls.setInvincibility[0]).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// 3. Spawn platform placement
// ---------------------------------------------------------------------------

describe('RespawnHandler — spawn platform placement', () => {
  it('exposes a default geometry the renderer can rely on', () => {
    expect(DEFAULT_SPAWN_PLATFORM_GEOMETRY).toMatchObject({
      width: expect.any(Number),
      height: expect.any(Number),
      yOffsetBelowSpawn: expect.any(Number),
    });
    expect(DEFAULT_SPAWN_PLATFORM_GEOMETRY.width).toBeGreaterThan(0);
    expect(DEFAULT_SPAWN_PLATFORM_GEOMETRY.height).toBeGreaterThan(0);
  });

  it('creates a platform under the fighter on respawn', () => {
    const handler = new RespawnHandler();
    const { target } = makeRecordingTarget();
    handler.registerSlot(makeSlot({ spawnX: 800, spawnY: 600 }), target);

    handler.applyRespawns([makeEvent()], 0);

    const platforms = handler.getActiveSpawnPlatforms();
    expect(platforms).toHaveLength(1);
    expect(platforms[0]).toMatchObject({
      playerIndex: 0,
      x: 800,
      y: 600 + DEFAULT_SPAWN_PLATFORM_GEOMETRY.yOffsetBelowSpawn,
      width: DEFAULT_SPAWN_PLATFORM_GEOMETRY.width,
      height: DEFAULT_SPAWN_PLATFORM_GEOMETRY.height,
    });
  });

  it('platform expires on the same frame the invincibility ends', () => {
    const handler = new RespawnHandler();
    const { target } = makeRecordingTarget();
    handler.registerSlot(makeSlot(), target);

    handler.applyRespawns([makeEvent({ invincibilityFrames: 90 })], 100);
    const [platform] = handler.getActiveSpawnPlatforms();

    expect(platform!.spawnedFrame).toBe(100);
    expect(platform!.expireFrame).toBe(190);
    expect(platform!.invincibilityFrames).toBe(90);
  });

  it('update() removes expired platforms and returns them', () => {
    const handler = new RespawnHandler();
    const { target } = makeRecordingTarget();
    handler.registerSlot(makeSlot(), target);

    handler.applyRespawns([makeEvent({ invincibilityFrames: 30 })], 0);
    expect(handler.getActiveSpawnPlatforms()).toHaveLength(1);

    // 29 frames in — still active.
    expect(handler.update(29)).toEqual([]);
    expect(handler.getActiveSpawnPlatforms()).toHaveLength(1);

    // Frame 30 — exactly at the expiry boundary, removed.
    const expired = handler.update(30);
    expect(expired).toHaveLength(1);
    expect(expired[0]!.playerIndex).toBe(0);
    expect(handler.getActiveSpawnPlatforms()).toEqual([]);
  });

  it('update() preserves not-yet-expired platforms', () => {
    const handler = new RespawnHandler();
    const recA = makeRecordingTarget();
    const recB = makeRecordingTarget();
    handler.registerSlot(makeSlot({ playerIndex: 0, faceOnSpawn: 1 }), recA.target);
    handler.registerSlot(makeSlot({ playerIndex: 1, faceOnSpawn: -1 }), recB.target);

    handler.applyRespawns([makeEvent({ playerIndex: 0, invincibilityFrames: 30 })], 0);
    handler.applyRespawns([makeEvent({ playerIndex: 1, invincibilityFrames: 90 })], 30);

    // Frame 30 — slot 0's platform expires, slot 1's just appeared.
    const expired = handler.update(30);
    expect(expired.map((p) => p.playerIndex)).toEqual([0]);
    const remaining = handler.getActiveSpawnPlatforms();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.playerIndex).toBe(1);
    expect(remaining[0]!.expireFrame).toBe(120);
  });

  it('back-to-back respawns for the same slot replace the platform', () => {
    const handler = new RespawnHandler();
    const { target } = makeRecordingTarget();
    handler.registerSlot(makeSlot(), target);

    // First respawn at frame 0.
    handler.applyRespawns([makeEvent({ invincibilityFrames: 90 })], 0);
    expect(handler.getActiveSpawnPlatforms()).toHaveLength(1);

    // Second respawn at frame 50 (before the first platform expires).
    // Defensive contract: only ONE active platform per slot at a time.
    handler.applyRespawns([makeEvent({ invincibilityFrames: 90 })], 50);
    const platforms = handler.getActiveSpawnPlatforms();
    expect(platforms).toHaveLength(1);
    expect(platforms[0]!.spawnedFrame).toBe(50);
    expect(platforms[0]!.expireFrame).toBe(140);
  });

  it('hasActiveSpawnPlatform reflects the live state', () => {
    const handler = new RespawnHandler();
    const { target } = makeRecordingTarget();
    handler.registerSlot(makeSlot(), target);

    expect(handler.hasActiveSpawnPlatform(0)).toBe(false);
    handler.applyRespawns([makeEvent({ invincibilityFrames: 30 })], 0);
    expect(handler.hasActiveSpawnPlatform(0)).toBe(true);
    handler.update(30);
    expect(handler.hasActiveSpawnPlatform(0)).toBe(false);
  });

  it('honours custom geometry overrides', () => {
    const handler = new RespawnHandler({
      spawnPlatform: { width: 200, height: 8, yOffsetBelowSpawn: 32 },
    });
    const { target } = makeRecordingTarget();
    handler.registerSlot(makeSlot({ spawnX: 0, spawnY: 0 }), target);

    handler.applyRespawns([makeEvent()], 0);
    const [platform] = handler.getActiveSpawnPlatforms();

    expect(platform).toMatchObject({
      x: 0,
      y: 32,
      width: 200,
      height: 8,
    });
  });

  it('partial geometry overrides fall back to defaults for missing fields', () => {
    const handler = new RespawnHandler({
      spawnPlatform: { width: 250 },
    });
    expect(handler.getSpawnPlatformGeometry()).toEqual({
      width: 250,
      height: DEFAULT_SPAWN_PLATFORM_GEOMETRY.height,
      yOffsetBelowSpawn: DEFAULT_SPAWN_PLATFORM_GEOMETRY.yOffsetBelowSpawn,
    });
  });

  it('zero-invincibility events still produce a (zero-lifetime) platform', () => {
    // Edge case: if the scene ever passes invincibilityFrames=0 (e.g.
    // tournament rules), the platform is created and then expires on
    // the same call to `update(frame)` — so one cycle of the loop
    // sees it land and expire at the same frame, deterministically.
    const handler = new RespawnHandler();
    const { target } = makeRecordingTarget();
    handler.registerSlot(makeSlot(), target);

    handler.applyRespawns([makeEvent({ invincibilityFrames: 0 })], 7);
    expect(handler.getActiveSpawnPlatforms()).toHaveLength(1);
    const expired = handler.update(7);
    expect(expired).toHaveLength(1);
    expect(handler.getActiveSpawnPlatforms()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Side-effect callbacks
// ---------------------------------------------------------------------------

describe('RespawnHandler — side-effect hooks', () => {
  it('fires each registered callback once per applied event', () => {
    const handler = new RespawnHandler();
    const { target } = makeRecordingTarget();
    handler.registerSlot(makeSlot({ playerIndex: 0 }), target);
    handler.registerSlot(makeSlot({ playerIndex: 1, faceOnSpawn: -1 }), target);

    const seen: AppliedRespawn[] = [];
    handler.onRespawn((ev) => seen.push(ev));

    handler.applyRespawns(
      [
        makeEvent({ playerIndex: 0 }),
        makeEvent({ playerIndex: 1 }),
      ],
      10,
    );

    expect(seen).toHaveLength(2);
    expect(seen.map((e) => e.playerIndex)).toEqual([0, 1]);
  });

  it('callback receives the AppliedRespawn record (not the raw event)', () => {
    const handler = new RespawnHandler();
    const { target } = makeRecordingTarget();
    handler.registerSlot(makeSlot({ spawnX: 100, spawnY: 200, faceOnSpawn: -1 }), target);

    const cb = vi.fn();
    handler.onRespawn(cb);

    handler.applyRespawns([makeEvent({ invincibilityFrames: 60 })], 5);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0]).toMatchObject({
      playerIndex: 0,
      spawnX: 100,
      spawnY: 200,
      faceOnSpawn: -1,
      invincibilityFrames: 60,
      frame: 5,
    });
  });

  it('a throwing callback does not break the rest of the batch', () => {
    const handler = new RespawnHandler();
    const recA = makeRecordingTarget();
    const recB = makeRecordingTarget();
    handler.registerSlot(makeSlot({ playerIndex: 0 }), recA.target);
    handler.registerSlot(makeSlot({ playerIndex: 1, faceOnSpawn: -1 }), recB.target);

    handler.onRespawn(() => {
      throw new Error('boom');
    });

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const applied = handler.applyRespawns(
        [
          makeEvent({ playerIndex: 0 }),
          makeEvent({ playerIndex: 1 }),
        ],
        0,
      );
      expect(applied).toHaveLength(2);
      // Both targets still got their state reset even though the hook threw.
      expect(recA.calls.setPosition).toHaveLength(1);
      expect(recB.calls.setPosition).toHaveLength(1);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('the unsubscribe handle stops firing the callback', () => {
    const handler = new RespawnHandler();
    const { target } = makeRecordingTarget();
    handler.registerSlot(makeSlot(), target);

    const cb = vi.fn();
    const off = handler.onRespawn(cb);

    handler.applyRespawns([makeEvent()], 0);
    expect(cb).toHaveBeenCalledTimes(1);

    off();
    handler.applyRespawns([makeEvent()], 1);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Lifecycle (unregister / reset)
// ---------------------------------------------------------------------------

describe('RespawnHandler — lifecycle', () => {
  it('unregisterSlot drops bindings and active platforms for that slot', () => {
    const handler = new RespawnHandler();
    const recA = makeRecordingTarget();
    const recB = makeRecordingTarget();
    handler.registerSlot(makeSlot({ playerIndex: 0 }), recA.target);
    handler.registerSlot(makeSlot({ playerIndex: 1, faceOnSpawn: -1 }), recB.target);

    handler.applyRespawns(
      [
        makeEvent({ playerIndex: 0, invincibilityFrames: 90 }),
        makeEvent({ playerIndex: 1, invincibilityFrames: 90 }),
      ],
      0,
    );
    expect(handler.getActiveSpawnPlatformCount()).toBe(2);

    handler.unregisterSlot(0);
    expect(handler.isRegistered(0)).toBe(false);
    expect(handler.isRegistered(1)).toBe(true);
    // Platform for slot 0 is gone; slot 1 still has one.
    expect(handler.getActiveSpawnPlatformCount()).toBe(1);
    expect(handler.getActiveSpawnPlatforms()[0]!.playerIndex).toBe(1);
  });

  it('subsequent respawn events for an unregistered slot are no-ops', () => {
    const handler = new RespawnHandler();
    const { target, calls } = makeRecordingTarget();
    handler.registerSlot(makeSlot(), target);
    handler.unregisterSlot(0);

    const applied = handler.applyRespawns([makeEvent()], 0);
    expect(applied).toEqual([]);
    expect(calls.setPosition).toEqual([]);
    expect(handler.getActiveSpawnPlatformCount()).toBe(0);
  });

  it('reset() clears slots, platforms, and side-effect hooks', () => {
    const handler = new RespawnHandler();
    const { target } = makeRecordingTarget();
    handler.registerSlot(makeSlot(), target);
    const cb = vi.fn();
    handler.onRespawn(cb);
    handler.applyRespawns([makeEvent()], 0);
    expect(handler.getActiveSpawnPlatformCount()).toBe(1);

    expect(cb).toHaveBeenCalledTimes(1); // Pre-reset application fired it once.
    handler.reset();

    expect(handler.isRegistered(0)).toBe(false);
    expect(handler.getActiveSpawnPlatformCount()).toBe(0);
    // Re-registering after reset and applying an event must NOT
    // re-fire the previously registered callback (the side-effect
    // table was cleared by reset, so the count stays at 1).
    handler.registerSlot(makeSlot(), target);
    handler.applyRespawns([makeEvent()], 1);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Determinism — same log → same applied state
// ---------------------------------------------------------------------------

describe('RespawnHandler — determinism', () => {
  it('replaying the same event log produces byte-identical applied records', () => {
    type Step =
      | { kind: 'apply'; events: ReadonlyArray<RespawnEvent>; frame: number }
      | { kind: 'tick'; frame: number };

    const log: Step[] = [
      { kind: 'apply', events: [makeEvent({ playerIndex: 0 })], frame: 0 },
      { kind: 'tick', frame: 30 },
      { kind: 'apply', events: [makeEvent({ playerIndex: 1, invincibilityFrames: 60 })], frame: 60 },
      { kind: 'tick', frame: 90 },
      { kind: 'apply', events: [makeEvent({ playerIndex: 0 })], frame: 120 },
      { kind: 'tick', frame: 211 }, // expire all remaining
    ];

    const replay = (): {
      applied: AppliedRespawn[][];
      expired: Array<Array<{ playerIndex: number; expireFrame: number }>>;
      finalActive: Array<{ playerIndex: number; expireFrame: number }>;
    } => {
      const handler = new RespawnHandler();
      const { target: t0 } = makeRecordingTarget();
      const { target: t1 } = makeRecordingTarget();
      handler.registerSlot(makeSlot({ playerIndex: 0, faceOnSpawn: 1 }), t0);
      handler.registerSlot(makeSlot({ playerIndex: 1, faceOnSpawn: -1 }), t1);

      const applied: AppliedRespawn[][] = [];
      const expired: Array<Array<{ playerIndex: number; expireFrame: number }>> = [];
      for (const step of log) {
        if (step.kind === 'apply') {
          applied.push(handler.applyRespawns(step.events, step.frame));
        } else {
          expired.push(
            handler
              .update(step.frame)
              .map((p) => ({ playerIndex: p.playerIndex, expireFrame: p.expireFrame })),
          );
        }
      }
      const finalActive = handler
        .getActiveSpawnPlatforms()
        .map((p) => ({ playerIndex: p.playerIndex, expireFrame: p.expireFrame }));
      return { applied, expired, finalActive };
    };

    const a = replay();
    const b = replay();
    const c = replay();
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    // And one anchored expectation so the test catches regressions
    // even if both replays drift in lockstep.
    expect(a.finalActive).toEqual([]);
  });
});
