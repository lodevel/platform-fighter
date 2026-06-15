import { describe, it, expect } from 'vitest';
import {
  GROUNDED_NORMAL_LIFECYCLE_RULES,
  GROUNDED_NORMAL_MOVES,
  GROUNDED_NORMAL_SLOTS,
  GROUNDED_NORMAL_TABLE,
  HITBOX_COLLISION_FILTER,
  HITBOX_LABEL,
  buildGroundedNormalHitboxPlugin,
  computeGroundedNormalHitboxCenter,
  describeHitboxAtFrame,
  describeHitboxLifecycle,
  enumerateGroundedNormalAnimationStates,
  getGroundedNormal,
  isHitboxActiveAt,
  resolveGroundedNormalAnimationKey,
} from './groundedNormalDriver';
import {
  Aegis,
  Bear,
  Blaze,
  Bruno,
  Cat,
  Nova,
  Owl,
  Puff,
  Volt,
  Wolf,
} from './index';
import { COLLISION_CATEGORIES, COLLISION_MASKS } from '../engine/collisionCategories';
import type { CharacterId } from '../types';

/**
 * AC 60102 Sub-AC 2 — animation + hitbox spawning for grounded normals.
 *
 * What this suite locks down (the Sub-AC's acceptance verbatim):
 *
 *   1. Move-table catalog — every roster slot ships exactly the three
 *      grounded normals (jab, tilt, smash) the Seed's "moveset" concept
 *      calls out, and every entry carries the schema fields the Sub-AC
 *      requires (hitbox geometry, damage, knockback, frame counts,
 *      animation block).
 *
 *   2. Frame-accurate hitbox lifecycle (per move-table entry) — for
 *      every grounded normal in the cast, the runtime spawns the
 *      Matter sensor on the exact frame the move's `startupFrames`
 *      counter rolls into the active phase, keeps it alive for exactly
 *      `activeFrames` frames, and despawns it on the frame the active
 *      phase ends.
 *
 *   3. Hitbox geometry (position, size) per move-table entry — the
 *      live sensor's centre = attacker centre + authored offset
 *      (mirrored by facing); width / height match the move record's
 *      hitbox geometry exactly.
 *
 *   4. Animation state drive — the live `getCurrentAnimation()` key
 *      walks the canonical
 *      `{character}.{move}.startup.* → active.* → recovery.* → idle`
 *      chain at the right frame boundaries, mirroring the pure
 *      `resolveGroundedNormalAnimationKey` projection so the sprite
 *      atlas pipeline (later AC) and the AI predictor read identical
 *      key streams.
 *
 *   5. Cancel-rule alignment — the same five rules the runtime
 *      enforces for every attack lifecycle (hit / respawn / destroy /
 *      no-buffering / no-phase-rewind) are documented for grounded
 *      normals in {@link GROUNDED_NORMAL_LIFECYCLE_RULES}.
 *
 * The suite mirrors the mock-scene pattern used by `Roster.test.ts` and
 * `animationState.test.ts` — no jsdom, no Phaser bootstrap, deterministic.
 */

// ---------------------------------------------------------------------------
// Mock scene helpers (mirrors `Roster.test.ts`)
// ---------------------------------------------------------------------------

interface MockBody {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  label: string | undefined;
  options: Record<string, unknown>;
  removed: boolean;
}

interface CollisionListener {
  event: 'collisionstart' | 'collisionend';
  fn: (e: { pairs: unknown[] }) => void;
}

interface MockScene {
  bodies: MockBody[];
  removed: MockBody[];
  listeners: CollisionListener[];
  emit(event: 'collisionstart' | 'collisionend', pairs: unknown[]): void;
  scene: any;
}

function createMockScene(): MockScene {
  const bodies: MockBody[] = [];
  const removed: MockBody[] = [];
  const listeners: CollisionListener[] = [];

  const matter = {
    add: {
      rectangle(
        x: number,
        y: number,
        w: number,
        h: number,
        options: Record<string, unknown>,
      ): MockBody {
        const body: MockBody = {
          position: { x, y },
          velocity: { x: 0, y: 0 },
          label: options['label'] as string | undefined,
          options: { ...options, _w: w, _h: h },
          removed: false,
        };
        bodies.push(body);
        return body;
      },
    },
    body: {
      setVelocity(body: MockBody, vec: { x: number; y: number }): void {
        body.velocity = { x: vec.x, y: vec.y };
      },
      setPosition(body: MockBody, vec: { x: number; y: number }): void {
        body.position = { x: vec.x, y: vec.y };
      },
      setInertia(): void {
        /* unused */
      },
    },
    world: {
      on(event: 'collisionstart' | 'collisionend', fn: CollisionListener['fn']): void {
        listeners.push({ event, fn });
      },
      off(event: 'collisionstart' | 'collisionend', fn: CollisionListener['fn']): void {
        const idx = listeners.findIndex((l) => l.event === event && l.fn === fn);
        if (idx >= 0) listeners.splice(idx, 1);
      },
      remove(body: MockBody): void {
        body.removed = true;
        removed.push(body);
      },
    },
  };

  const scene = { matter };

  return {
    bodies,
    removed,
    listeners,
    scene,
    emit(event, pairs) {
      for (const l of listeners.slice()) {
        if (l.event === event) {
          l.fn({ pairs });
        }
      }
    },
  };
}

function liveHitbox(m: MockScene): MockBody | null {
  return m.bodies.find((b) => b.label === HITBOX_LABEL && !b.removed) ?? null;
}

function spawnFighter(
  characterId: CharacterId,
  m: MockScene,
  spawnX = 200,
  spawnY = 200,
) {
  if (characterId === 'wolf') {
    return new Wolf(m.scene as any, { spawnX, spawnY });
  }
  if (characterId === 'cat') {
    return new Cat(m.scene as any, { spawnX, spawnY });
  }
  if (characterId === 'owl') {
    return new Owl(m.scene as any, { spawnX, spawnY });
  }
  if (characterId === 'blaze') {
    return new Blaze(m.scene as any, { spawnX, spawnY });
  }
  if (characterId === 'puff') {
    return new Puff(m.scene as any, { spawnX, spawnY });
  }
  if (characterId === 'aegis') {
    return new Aegis(m.scene as any, { spawnX, spawnY });
  }
  if (characterId === 'volt') {
    return new Volt(m.scene as any, { spawnX, spawnY });
  }
  if (characterId === 'nova') {
    return new Nova(m.scene as any, { spawnX, spawnY });
  }
  if (characterId === 'bruno') {
    return new Bruno(m.scene as any, { spawnX, spawnY });
  }
  return new Bear(m.scene as any, { spawnX, spawnY });
}

// ---------------------------------------------------------------------------
// 1. Move-table catalog completeness
// ---------------------------------------------------------------------------

describe('GROUNDED_NORMAL_TABLE — move-table catalog (AC 60102 Sub-AC 2)', () => {
  it('exposes every roster slot × grounded-normal slot pair', () => {
    const ids: CharacterId[] = ['wolf', 'cat', 'owl', 'bear', 'blaze', 'puff', 'aegis'];
    for (const id of ids) {
      for (const slot of GROUNDED_NORMAL_SLOTS) {
        const move = GROUNDED_NORMAL_TABLE[id][slot];
        expect(move, `${id}.${slot} must be present`).toBeDefined();
        expect(move.id).toBe(`${id}.${slot}`);
      }
    }
  });

  it('flat catalog enumerates exactly 30 entries (10 chars × 3 slots)', () => {
    expect(GROUNDED_NORMAL_MOVES.length).toBe(30);
    // Ensure no duplicates and the (id, slot) pairs cover the full grid.
    const seen = new Set<string>();
    for (const e of GROUNDED_NORMAL_MOVES) {
      const key = `${e.characterId}.${e.slot}`;
      expect(seen.has(key), `duplicate entry ${key}`).toBe(false);
      seen.add(key);
      expect(e.move.id).toBe(key);
    }
    expect(seen.size).toBe(30);
  });

  it('every grounded normal carries the schema fields the Sub-AC requires', () => {
    for (const e of GROUNDED_NORMAL_MOVES) {
      const m = e.move;
      // Hitbox geometry — non-degenerate sensor in front of the fighter.
      expect(m.hitbox.width, `${m.id} width`).toBeGreaterThan(0);
      expect(m.hitbox.height, `${m.id} height`).toBeGreaterThan(0);
      expect(m.hitbox.offsetX, `${m.id} offsetX`).toBeGreaterThan(0);
      // Damage / knockback — non-negative numbers.
      expect(m.damage, `${m.id} damage`).toBeGreaterThan(0);
      expect(typeof m.knockback.x).toBe('number');
      expect(typeof m.knockback.y).toBe('number');
      expect(typeof m.knockback.scaling).toBe('number');
      // Frame counts — strictly positive integers.
      expect(m.startupFrames, `${m.id} startup`).toBeGreaterThan(0);
      expect(m.activeFrames, `${m.id} active`).toBeGreaterThan(0);
      expect(m.recoveryFrames, `${m.id} recovery`).toBeGreaterThan(0);
      expect(m.cooldownFrames, `${m.id} cooldown`).toBeGreaterThanOrEqual(0);
      // Animation block — every entry ships per-phase art-frame counts.
      expect(m.animation, `${m.id} animation block`).toBeDefined();
      expect(m.animation!.startupFrames).toBeGreaterThanOrEqual(1);
      expect(m.animation!.activeFrames).toBeGreaterThanOrEqual(1);
      expect(m.animation!.recoveryFrames).toBeGreaterThanOrEqual(1);
      // Seed constraint: 6-8 art frames per move.
      const total =
        m.animation!.startupFrames +
        m.animation!.activeFrames +
        m.animation!.recoveryFrames;
      expect(total, `${m.id} total art frames`).toBeGreaterThanOrEqual(6);
      expect(total, `${m.id} total art frames`).toBeLessThanOrEqual(8);
    }
  });

  it('getGroundedNormal(id, slot) resolves to the same record as the table', () => {
    for (const e of GROUNDED_NORMAL_MOVES) {
      expect(getGroundedNormal(e.characterId, e.slot)).toBe(e.move);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Frame-accurate hitbox lifecycle
// ---------------------------------------------------------------------------

describe('describeHitboxLifecycle — frame-accurate boundaries', () => {
  for (const e of GROUNDED_NORMAL_MOVES) {
    it(`${e.move.id} reports correct first/last active frames + end frame`, () => {
      const lc = describeHitboxLifecycle(e.move);
      expect(lc.firstActiveFrame).toBe(e.move.startupFrames);
      expect(lc.lastActiveFrame).toBe(
        e.move.startupFrames + e.move.activeFrames - 1,
      );
      expect(lc.firstRecoveryFrame).toBe(
        e.move.startupFrames + e.move.activeFrames,
      );
      expect(lc.endFrame).toBe(
        e.move.startupFrames + e.move.activeFrames + e.move.recoveryFrames,
      );
      expect(lc.width).toBe(e.move.hitbox.width);
      expect(lc.height).toBe(e.move.hitbox.height);
    });
  }
});

describe('isHitboxActiveAt — predicate for the active window', () => {
  for (const e of GROUNDED_NORMAL_MOVES) {
    it(`${e.move.id} is inactive in startup, active in active window, inactive after`, () => {
      // Frame 0 (press): startup → not active.
      expect(isHitboxActiveAt(e.move, 0)).toBe(false);
      // Last startup frame (just before active begins).
      expect(
        isHitboxActiveAt(e.move, e.move.startupFrames - 1),
      ).toBe(false);
      // First active frame.
      expect(isHitboxActiveAt(e.move, e.move.startupFrames)).toBe(true);
      // Last active frame.
      expect(
        isHitboxActiveAt(
          e.move,
          e.move.startupFrames + e.move.activeFrames - 1,
        ),
      ).toBe(true);
      // First recovery frame.
      expect(
        isHitboxActiveAt(
          e.move,
          e.move.startupFrames + e.move.activeFrames,
        ),
      ).toBe(false);
      // After move ends.
      expect(
        isHitboxActiveAt(
          e.move,
          e.move.startupFrames +
            e.move.activeFrames +
            e.move.recoveryFrames,
        ),
      ).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Hitbox geometry (position + size) per move-table entry
// ---------------------------------------------------------------------------

describe('computeGroundedNormalHitboxCenter — pure projection', () => {
  for (const e of GROUNDED_NORMAL_MOVES) {
    it(`${e.move.id} mirrors offsetX by facing and applies offsetY unchanged`, () => {
      const pos = { x: 500, y: 300 };
      const right = computeGroundedNormalHitboxCenter(e.move, pos, 1);
      expect(right.x).toBe(pos.x + e.move.hitbox.offsetX);
      expect(right.y).toBe(pos.y + e.move.hitbox.offsetY);
      const left = computeGroundedNormalHitboxCenter(e.move, pos, -1);
      expect(left.x).toBe(pos.x - e.move.hitbox.offsetX);
      expect(left.y).toBe(pos.y + e.move.hitbox.offsetY);
    });
  }
});

describe('describeHitboxAtFrame — frame-by-frame snapshot', () => {
  it('marks live=true only inside the active window', () => {
    // Use Wolf's smash — generous frame budget makes the boundary
    // checks easy to read.
    const move = GROUNDED_NORMAL_TABLE.wolf.smash;
    const pos = { x: 0, y: 0 };
    const lc = describeHitboxLifecycle(move);
    for (let f = 0; f < lc.endFrame + 4; f++) {
      const snap = describeHitboxAtFrame(move, pos, 1, f);
      const expectedLive =
        f >= lc.firstActiveFrame && f <= lc.lastActiveFrame;
      expect(snap.live, `frame ${f}`).toBe(expectedLive);
      // Geometry is stable regardless of phase.
      expect(snap.width).toBe(move.hitbox.width);
      expect(snap.height).toBe(move.hitbox.height);
      expect(snap.moveId).toBe(move.id);
      expect(snap.damage).toBe(move.damage);
    }
  });

  it('reports the canonical per-phase classification', () => {
    const move = GROUNDED_NORMAL_TABLE.cat.tilt;
    const pos = { x: 100, y: 100 };
    const lc = describeHitboxLifecycle(move);
    expect(describeHitboxAtFrame(move, pos, 1, 0).phase).toBe('startup');
    expect(
      describeHitboxAtFrame(move, pos, 1, lc.firstActiveFrame).phase,
    ).toBe('active');
    expect(
      describeHitboxAtFrame(move, pos, 1, lc.firstRecoveryFrame).phase,
    ).toBe('recovery');
    expect(describeHitboxAtFrame(move, pos, 1, lc.endFrame).phase).toBe('done');
  });
});

describe('buildGroundedNormalHitboxPlugin — sensor plugin payload', () => {
  for (const e of GROUNDED_NORMAL_MOVES) {
    it(`${e.move.id} packs ownerId, moveId, damage, knockback, facing`, () => {
      const plugin = buildGroundedNormalHitboxPlugin(e.characterId, e.move, 1);
      expect(plugin.ownerId).toBe(e.characterId);
      expect(plugin.moveId).toBe(e.move.id);
      expect(plugin.damage).toBe(e.move.damage);
      expect(plugin.knockback).toEqual(e.move.knockback);
      expect(plugin.facing).toBe(1);

      const flipped = buildGroundedNormalHitboxPlugin(e.characterId, e.move, -1);
      expect(flipped.facing).toBe(-1);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. End-to-end: live runtime spawns frame-accurate hitboxes for every
//    grounded normal across the whole roster
// ---------------------------------------------------------------------------

describe('Live runtime — frame-accurate hitbox spawn for every grounded normal', () => {
  for (const e of GROUNDED_NORMAL_MOVES) {
    it(`${e.move.id} spawns sensor on first active frame and despawns on first recovery frame`, () => {
      const m = createMockScene();
      const ch = spawnFighter(e.characterId, m, 200, 200);
      // Drive the move directly via the public attemptAttack path so
      // this test is decoupled from the input dispatcher's ground-vs-air
      // gating (covered separately in groundedAttackInput.test.ts).
      const ok = ch.attemptAttack(e.move.id);
      expect(ok, `${e.move.id} attempt`).toBe(true);

      // Frame 0 (press frame): no sensor in the world yet.
      expect(liveHitbox(m), `${e.move.id} frame 0`).toBeNull();

      // Tick through startup; sensor must remain absent every frame
      // strictly before the first active frame.
      for (let f = 1; f < e.move.startupFrames; f++) {
        ch.applyInput({ moveX: 0, jump: false });
        expect(liveHitbox(m), `${e.move.id} startup frame ${f}`).toBeNull();
      }
      // Next tick crosses startup → active.
      ch.applyInput({ moveX: 0, jump: false });
      const live = liveHitbox(m);
      expect(live, `${e.move.id} first active frame`).not.toBeNull();
      expect(live!.label).toBe(HITBOX_LABEL);
      expect(live!.options['_w']).toBe(e.move.hitbox.width);
      expect(live!.options['_h']).toBe(e.move.hitbox.height);
      expect(live!.options['isSensor']).toBe(true);

      // Sensor stays alive for the rest of the active window.
      for (let f = 1; f < e.move.activeFrames; f++) {
        ch.applyInput({ moveX: 0, jump: false });
        expect(
          liveHitbox(m),
          `${e.move.id} active frame ${f}`,
        ).not.toBeNull();
      }

      // Next tick despawns the sensor (active → recovery).
      ch.applyInput({ moveX: 0, jump: false });
      expect(
        liveHitbox(m),
        `${e.move.id} first recovery frame`,
      ).toBeNull();
    });
  }

  for (const e of GROUNDED_NORMAL_MOVES) {
    it(`${e.move.id} spawns sensor at attacker centre + authored offset`, () => {
      const m = createMockScene();
      const spawnX = 700;
      const spawnY = 350;
      const ch = spawnFighter(e.characterId, m, spawnX, spawnY);
      ch.attemptAttack(e.move.id);
      // Tick through startup (consumes startupFrames - 1 ticks of pure
      // startup + the boundary tick that crosses into active).
      for (let f = 0; f < e.move.startupFrames; f++) {
        ch.applyInput({ moveX: 0, jump: false });
      }
      const live = liveHitbox(m);
      expect(live, `${e.move.id} live sensor`).not.toBeNull();
      // Authored offset is positive-forward; default facing = right(+1).
      // Allow tiny variance from velocity integration over the startup
      // window (no input → effectively zero, but the body integrates a
      // single frame of gravity each tick which is irrelevant for
      // horizontal hitbox checks).
      expect(live!.position.x).toBeCloseTo(spawnX + e.move.hitbox.offsetX, 0);
      expect(live!.options['_w']).toBe(e.move.hitbox.width);
      expect(live!.options['_h']).toBe(e.move.hitbox.height);
    });
  }

  for (const e of GROUNDED_NORMAL_MOVES) {
    it(`${e.move.id} sensor plugin payload matches buildGroundedNormalHitboxPlugin output`, () => {
      const m = createMockScene();
      const ch = spawnFighter(e.characterId, m, 0, 0);
      ch.attemptAttack(e.move.id);
      for (let f = 0; f < e.move.startupFrames; f++) {
        ch.applyInput({ moveX: 0, jump: false });
      }
      const live = liveHitbox(m);
      expect(live).not.toBeNull();
      const plugin = live!.options['plugin'] as Record<string, unknown>;
      const expected = buildGroundedNormalHitboxPlugin(e.characterId, e.move, 1);
      expect(plugin['ownerId']).toBe(expected.ownerId);
      expect(plugin['moveId']).toBe(expected.moveId);
      expect(plugin['damage']).toBe(expected.damage);
      expect(plugin['knockback']).toEqual(expected.knockback);
      expect(plugin['facing']).toBe(expected.facing);

      // Collision filter is the canonical HITBOX/CHARACTER pair.
      const filter = live!.options['collisionFilter'] as {
        category: number;
        mask: number;
        group: number;
      };
      expect(filter.category).toBe(COLLISION_CATEGORIES.HITBOX);
      expect(filter.mask).toBe(COLLISION_MASKS.HITBOX);
      expect(filter.category).toBe(HITBOX_COLLISION_FILTER.category);
      expect(filter.mask).toBe(HITBOX_COLLISION_FILTER.mask);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Animation drive — pure projection matches the live runtime
// ---------------------------------------------------------------------------

describe('resolveGroundedNormalAnimationKey — pure projection', () => {
  it('emits the canonical {char}.{move}.{phase}.{frame} key during the move', () => {
    const move = GROUNDED_NORMAL_TABLE.wolf.jab;
    // Frame 0 → startup.0
    expect(resolveGroundedNormalAnimationKey('wolf', move, 0)).toBe(
      'wolf.jab.startup.0',
    );
    // First active frame → active.0
    expect(
      resolveGroundedNormalAnimationKey('wolf', move, move.startupFrames),
    ).toBe('wolf.jab.active.0');
    // First recovery frame → recovery.0
    expect(
      resolveGroundedNormalAnimationKey(
        'wolf',
        move,
        move.startupFrames + move.activeFrames,
      ),
    ).toBe('wolf.jab.recovery.0');
    // After the move ends → idle key.
    const busy =
      move.startupFrames + move.activeFrames + move.recoveryFrames;
    expect(resolveGroundedNormalAnimationKey('wolf', move, busy)).toBe(
      'wolf.idle',
    );
  });

  for (const e of GROUNDED_NORMAL_MOVES) {
    it(`${e.move.id} produces the same key the live runtime emits at every frame`, () => {
      const m = createMockScene();
      const ch = spawnFighter(e.characterId, m, 100, 100);
      ch.attemptAttack(e.move.id);
      const busy =
        e.move.startupFrames + e.move.activeFrames + e.move.recoveryFrames;
      // Press frame: framesElapsed = 0
      let pure = resolveGroundedNormalAnimationKey(
        e.characterId,
        e.move,
        0,
      );
      let live = ch.getCurrentAnimation().key;
      expect(live, `${e.move.id} press frame`).toBe(pure);

      for (let f = 1; f <= busy; f++) {
        ch.applyInput({ moveX: 0, jump: false });
        pure = resolveGroundedNormalAnimationKey(e.characterId, e.move, f);
        live = ch.getCurrentAnimation().key;
        expect(live, `${e.move.id} frame ${f}`).toBe(pure);
      }
    });
  }
});

describe('enumerateGroundedNormalAnimationStates — full lifecycle keys', () => {
  for (const e of GROUNDED_NORMAL_MOVES) {
    it(`${e.move.id} emits a (busy + 1)-state stream that ends in idle`, () => {
      const stream = enumerateGroundedNormalAnimationStates(
        e.characterId,
        e.move,
        1,
      );
      const busy =
        e.move.startupFrames + e.move.activeFrames + e.move.recoveryFrames;
      // busy gameplay frames + 1 trailing idle = busy + 1 entries.
      expect(stream.length).toBe(busy + 1);
      // First state is startup.0
      expect(stream[0]!.phase).toBe('startup');
      expect(stream[0]!.artFrameIndex).toBe(0);
      expect(stream[0]!.key).toBe(
        `${e.characterId}.${e.slot}.startup.0`,
      );
      // Last state is idle
      expect(stream[stream.length - 1]!.phase).toBe('idle');
      expect(stream[stream.length - 1]!.key).toBe(`${e.characterId}.idle`);
      // Phase ordering is monotonically forward.
      const phaseOrder = ['startup', 'active', 'recovery', 'idle'];
      let lastIdx = 0;
      for (const s of stream) {
        const pIdx = phaseOrder.indexOf(s.phase);
        expect(pIdx).toBeGreaterThanOrEqual(lastIdx);
        lastIdx = pIdx;
      }
      // All phase names appear (each move has at least one frame in each).
      const seen = new Set(stream.map((s) => s.phase));
      expect(seen.has('startup')).toBe(true);
      expect(seen.has('active')).toBe(true);
      expect(seen.has('recovery')).toBe(true);
      expect(seen.has('idle')).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 6. Cancel-rule alignment table
// ---------------------------------------------------------------------------

describe('GROUNDED_NORMAL_LIFECYCLE_RULES — cancel-rule alignment', () => {
  it('enumerates the same five cancel rules animationState exposes', () => {
    const names = GROUNDED_NORMAL_LIFECYCLE_RULES.map((r) => r.rule);
    expect(names).toContain('hit-cancel');
    expect(names).toContain('respawn-cancel');
    expect(names).toContain('destroy-cancel');
    expect(names).toContain('no-buffering');
    expect(names).toContain('no-phase-rewind');
    expect(names.length).toBe(5);
  });

  it('every rule has a non-empty summary and an enforcedBy pointer', () => {
    for (const r of GROUNDED_NORMAL_LIFECYCLE_RULES) {
      expect(r.summary.length).toBeGreaterThan(0);
      expect(r.enforcedBy.length).toBeGreaterThan(0);
    }
  });
});
