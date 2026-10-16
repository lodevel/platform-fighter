import { describe, it, expect } from 'vitest';
import {
  Character,
  DonkeyKong,
  DONKEYKONG_JAB,
  DONKEYKONG_NAIR,
  DONKEYKONG_SMASH,
  DONKEYKONG_TILT,
  DONKEYKONG_TUNING,
  HITBOX_COLLISION_FILTER,
  HITBOX_LABEL,
  Pikachu,
  PIKACHU_JAB,
  PIKACHU_NAIR,
  PIKACHU_SMASH,
  PIKACHU_TILT,
  PIKACHU_TUNING,
  createCharacterById,
  OFFENSIVE_ACTION_BUFFER_FRAMES,
  selectAnimationFrame,
  computeAttackPhase,
  type AttackMove,
} from './index';
import { FIGHTER_REGISTRY_IDS } from './fighterRegistry';
import { attackSensorGeometry } from './attacks';
import type { AttackMoveWithAnimation } from './moveSchema';
import type { CharacterId } from '../types';
import { COLLISION_CATEGORIES, COLLISION_MASKS } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';

/**
 * Concrete roster fighters (Donkey Kong, Pikachu) with distinct stats and
 * a working grounded/aerial kit (hitbox spawn, damage value, move lockout).
 *
 * What this suite locks down:
 *
 *   1. Distinct stats — Donkey Kong (heavyweight) and Pikachu
 *      (lightweight) ship with different mass, top speed, air control
 *      and silhouette.
 *   2. Hitbox spawn — pressing attack while idle creates exactly one
 *      Matter sensor body in front of the fighter, on the right
 *      animation frame, with the right collision filter, label, and
 *      `plugin.{ownerId, moveId, damage, knockback, facing}` payload.
 *   3. Damage value — the spawned hitbox carries the attack's damage
 *      so the damage handler can read a single source of truth without
 *      reverse-looking-up the character's moveset.
 *   4. Move lockout — back-to-back attacks are gated while a move is in
 *      flight.
 *   5. Lifecycle — destroying or teleporting a fighter mid-attack
 *      cleans up the hitbox sensor (no orphaned bodies in the world).
 *
 * Same mock-scene pattern as `Character.test.ts` — no jsdom required.
 */

// ---------------------------------------------------------------------------
// Mock scene helpers (mirrors `Character.test.ts`)
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
  inertiaCalls: Array<{ body: MockBody; inertia: number }>;
  emit(event: 'collisionstart' | 'collisionend', pairs: unknown[]): void;
  scene: any;
}

function createMockScene(): MockScene {
  const bodies: MockBody[] = [];
  const removed: MockBody[] = [];
  const listeners: CollisionListener[] = [];
  const inertiaCalls: Array<{ body: MockBody; inertia: number }> = [];

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
      setInertia(body: MockBody, inertia: number): void {
        inertiaCalls.push({ body, inertia });
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
    inertiaCalls,
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

function makePlatform(
  x: number,
  y: number,
  passThrough = false,
): { label: string; position: { x: number; y: number } } {
  return {
    label: passThrough ? PLATFORM_LABELS.passThrough : PLATFORM_LABELS.solid,
    position: { x, y },
  };
}

/**
 * Drop the character onto a platform so subsequent applyInput sees
 * grounded=true, then ride out the fixture's initial landing recovery so
 * the fighter starts from a settled stance (landing timing has its own
 * physics coverage).
 */
function ground(ch: Character, m: MockScene) {
  const plat = makePlatform(ch.getPosition().x, ch.getPosition().y + 100);
  m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
  // The first neutral step processes the touchdown; keep stepping until
  // the landing recovery has drained and the fighter is actionable.
  let frames = 0;
  do {
    ch.applyInput({ moveX: 0, jump: false });
  } while (!ch.canAttack() && ++frames < 30);
  return plat;
}

/** Find the first hitbox body in the mock scene that hasn't been removed yet. */
function liveHitbox(m: MockScene): MockBody | null {
  for (const b of m.bodies) {
    if (b.label === HITBOX_LABEL && !b.removed) return b;
  }
  return null;
}

/** Run the attack press-and-release pattern across N frames, returning frame log. */
function runFrames(ch: Character, frames: number, attackHeld: (frame: number) => boolean): void {
  for (let i = 0; i < frames; i += 1) {
    ch.applyInput({ moveX: 0, jump: false, attack: attackHeld(i) });
  }
}

/** A roster fighter fixture: its class, id, tuning and grounded/aerial moves. */
interface FighterFixture {
  readonly name: string;
  readonly id: CharacterId;
  readonly create: (scene: any, x?: number, y?: number) => Character;
  readonly tuning: { readonly mass: number; readonly maxRunSpeed: number; readonly airAccel: number; readonly width: number; readonly height: number };
  readonly jab: AttackMoveWithAnimation;
  readonly tilt: AttackMoveWithAnimation;
  readonly smash: AttackMoveWithAnimation;
  readonly nair: AttackMoveWithAnimation;
}

const DK: FighterFixture = {
  name: 'Donkey Kong',
  id: 'donkeykong',
  create: (scene, x = 0, y = 0) => new DonkeyKong(scene, { spawnX: x, spawnY: y }),
  tuning: DONKEYKONG_TUNING,
  jab: DONKEYKONG_JAB,
  tilt: DONKEYKONG_TILT,
  smash: DONKEYKONG_SMASH,
  nair: DONKEYKONG_NAIR,
};

const PIKACHU: FighterFixture = {
  name: 'Pikachu',
  id: 'pikachu',
  create: (scene, x = 0, y = 0) => new Pikachu(scene, { spawnX: x, spawnY: y }),
  tuning: PIKACHU_TUNING,
  jab: PIKACHU_JAB,
  tilt: PIKACHU_TILT,
  smash: PIKACHU_SMASH,
  nair: PIKACHU_NAIR,
};

const FIGHTERS: readonly FighterFixture[] = [DK, PIKACHU];

/** Frames from press until the move ends (startup + active + recovery + cooldown). */
const lockout = (m: AttackMove): number =>
  m.startupFrames + m.activeFrames + m.recoveryFrames + m.cooldownFrames;

/** Source knockback growth — the KO-power term of the reference formula. */
const knockbackGrowth = (m: AttackMove): number => m.knockback.reference!.growth;

// ---------------------------------------------------------------------------
// Distinct stats
// ---------------------------------------------------------------------------

describe('Donkey Kong vs Pikachu — distinct stats', () => {
  it('ships Donkey Kong with heavyweight stats and Pikachu with lightweight stats', () => {
    // Pikachu is faster.
    expect(PIKACHU_TUNING.maxRunSpeed).toBeGreaterThan(DONKEYKONG_TUNING.maxRunSpeed);
    // DK is heavier.
    expect(DONKEYKONG_TUNING.mass).toBeGreaterThan(PIKACHU_TUNING.mass);
    // Pikachu has higher air control.
    expect(PIKACHU_TUNING.airAccel).toBeGreaterThan(DONKEYKONG_TUNING.airAccel);
    // DK is bigger.
    expect(DONKEYKONG_TUNING.width).toBeGreaterThan(PIKACHU_TUNING.width);
    expect(DONKEYKONG_TUNING.height).toBeGreaterThan(PIKACHU_TUNING.height);
  });

  it.each(FIGHTERS)('$name reports its id and uses its tuning by default', (f) => {
    const m = createMockScene();
    const ch = f.create(m.scene);
    expect(ch.id).toBe(f.id);
    const t = ch.getTuning();
    expect(t.maxRunSpeed).toBe(f.tuning.maxRunSpeed);
    expect(t.mass).toBe(f.tuning.mass);
    expect(t.width).toBe(f.tuning.width);
    expect(t.height).toBe(f.tuning.height);
  });

  it.each(FIGHTERS)('$name body geometry passed to Matter matches its tuning', (f) => {
    const m = createMockScene();
    f.create(m.scene);
    expect(m.bodies[0]!.options['_w']).toBe(f.tuning.width);
    expect(m.bodies[0]!.options['_h']).toBe(f.tuning.height);
    // Mass is wired through Matter's options bag.
    expect(m.bodies[0]!.options['mass']).toBe(f.tuning.mass);
  });

  it('caller-supplied options still override class defaults (e.g. test mass overrides)', () => {
    const m = createMockScene();
    const ch = new DonkeyKong(m.scene, { spawnX: 0, spawnY: 0, mass: 99, maxRunSpeed: 1 });
    const t = ch.getTuning();
    expect(t.mass).toBe(99);
    expect(t.maxRunSpeed).toBe(1);
    // Other fields keep the class defaults.
    expect(t.airAccel).toBe(DONKEYKONG_TUNING.airAccel);
  });

  it('movement speed difference is observable through applyInput', () => {
    const dkScene = createMockScene();
    const dk = DK.create(dkScene.scene);
    ground(dk, dkScene);

    const pikachuScene = createMockScene();
    const pikachu = PIKACHU.create(pikachuScene.scene);
    ground(pikachu, pikachuScene);

    for (let i = 0; i < 60; i += 1) {
      dk.applyInput({ moveX: 1, jump: false });
      pikachu.applyInput({ moveX: 1, jump: false });
    }
    // Pikachu's terminal velocity is the bigger number.
    expect(pikachu.getVelocity().x).toBeGreaterThan(dk.getVelocity().x);
    expect(pikachu.getVelocity().x).toBeCloseTo(PIKACHU_TUNING.maxRunSpeed);
    expect(dk.getVelocity().x).toBeCloseTo(DONKEYKONG_TUNING.maxRunSpeed);
  });
});

// ---------------------------------------------------------------------------
// Attack-move definitions — damage + frame values
// ---------------------------------------------------------------------------

describe('Donkey Kong and Pikachu jab — move definitions', () => {
  it('exposes both jabs as fully-specified AttackMove records', () => {
    const required: Array<keyof AttackMove> = [
      'id',
      'type',
      'damage',
      'knockback',
      'hitbox',
      'startupFrames',
      'activeFrames',
      'recoveryFrames',
      'cooldownFrames',
    ];
    for (const move of [DONKEYKONG_JAB, PIKACHU_JAB]) {
      for (const key of required) {
        expect(move[key]).not.toBeUndefined();
      }
      expect(move.type).toBe('jab');
    }
  });

  it('Donkey Kong hits harder than Pikachu (distinct damage values)', () => {
    expect(DONKEYKONG_JAB.damage).toBeGreaterThan(PIKACHU_JAB.damage);
  });

  it('Pikachu recovers faster than Donkey Kong (distinct jab lockouts)', () => {
    expect(PIKACHU_JAB.recoveryFrames).toBeLessThan(DONKEYKONG_JAB.recoveryFrames);
    expect(lockout(PIKACHU_JAB)).toBeLessThan(lockout(DONKEYKONG_JAB));
  });

  it('hitbox geometry sits in front of the fighter (positive offsetX)', () => {
    for (const move of [DONKEYKONG_JAB, PIKACHU_JAB]) {
      expect(move.hitbox.offsetX).toBeGreaterThan(0);
      expect(move.hitbox.width).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Hitbox spawn — body construction & timing
// ---------------------------------------------------------------------------

describe.each(FIGHTERS)('Hitbox spawn — $name jab', (f) => {
  it('spawns no hitbox until the active phase begins', () => {
    const m = createMockScene();
    const ch = f.create(m.scene, 100, 100);
    ground(ch, m);

    // Press attack on frame 0; the hitbox must not exist during startup.
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(liveHitbox(m)).toBeNull();
    for (let i = 0; i < f.jab.startupFrames - 1; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, attack: false });
      expect(liveHitbox(m)).toBeNull();
    }
    // Next call rolls the elapsed counter into the active window.
    ch.applyInput({ moveX: 0, jump: false, attack: false });
    expect(liveHitbox(m)).not.toBeNull();
  });

  it('despawns the hitbox at the end of the active window', () => {
    const m = createMockScene();
    const ch = f.create(m.scene, 100, 100);
    ground(ch, m);

    // Press, then advance startup+active calls — this lands on the first
    // 'recovery' frame, which is the step where the despawn fires.
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    runFrames(ch, f.jab.startupFrames + f.jab.activeFrames, () => false);
    // A hitbox was alive at some point...
    expect(m.bodies.some((b) => b.label === HITBOX_LABEL)).toBe(true);
    // ...but after the active window it's been removed.
    expect(liveHitbox(m)).toBeNull();
    // Defensive: the removed body really did call world.remove().
    const hitboxes = m.bodies.filter((b) => b.label === HITBOX_LABEL);
    expect(hitboxes.length).toBe(1);
    expect(hitboxes[0]!.removed).toBe(true);
  });

  it('hitbox is a sensor with the canonical HITBOX collision filter', () => {
    const m = createMockScene();
    const ch = f.create(m.scene);
    ground(ch, m);

    ch.applyInput({ moveX: 0, jump: false, attack: true });
    runFrames(ch, f.jab.startupFrames, () => false); // land in active
    const hb = liveHitbox(m);
    expect(hb).not.toBeNull();
    const opts = hb!.options;
    expect(opts['isSensor']).toBe(true);
    expect(opts['label']).toBe(HITBOX_LABEL);
    const filter = opts['collisionFilter'] as { category: number; mask: number; group: number };
    expect(filter.category).toBe(COLLISION_CATEGORIES.HITBOX);
    expect(filter.mask).toBe(COLLISION_MASKS.HITBOX);
    expect(filter.group).toBe(0);
    // Sanity: the exported convenience filter matches.
    expect(HITBOX_COLLISION_FILTER.category).toBe(COLLISION_CATEGORIES.HITBOX);
    expect(HITBOX_COLLISION_FILTER.mask).toBe(COLLISION_MASKS.HITBOX);
  });

  it('hitbox plugin payload carries owner, move, damage, knockback, and facing', () => {
    const m = createMockScene();
    const ch = f.create(m.scene);
    ground(ch, m);

    ch.applyInput({ moveX: 0, jump: false, attack: true });
    runFrames(ch, f.jab.startupFrames, () => false); // land in active
    const hb = liveHitbox(m);
    expect(hb).not.toBeNull();
    const plugin = hb!.options['plugin'] as Record<string, unknown>;
    expect(plugin['ownerId']).toBe(f.id);
    expect(plugin['moveId']).toBe(f.jab.id);
    expect(plugin['damage']).toBe(f.jab.damage);
    expect(plugin['knockback']).toEqual(f.jab.knockback);
    // Default facing is right (+1) since we never deflected the stick.
    expect(plugin['facing']).toBe(1);
  });

  it("mirrors hitbox offsetX by the fighter's facing direction", () => {
    const m = createMockScene();
    const ch = f.create(m.scene, 500, 200);
    ground(ch, m);
    // Face left.
    ch.setFacing(-1);
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    runFrames(ch, f.jab.startupFrames, () => false);
    const hb = liveHitbox(m);
    expect(hb).not.toBeNull();
    // offsetX is flipped: hitbox centre sits to the LEFT of the body...
    expect(hb!.position.x).toBeLessThan(ch.getPosition().x);
    // ...at the configured offset distance (the sensor encloses every
    // collision record of the move).
    expect(ch.getPosition().x - hb!.position.x).toBeCloseTo(attackSensorGeometry(f.jab).offsetX);
  });

  it('hitbox dimensions match the move definition', () => {
    const m = createMockScene();
    const ch = f.create(m.scene);
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    runFrames(ch, f.jab.startupFrames, () => false);
    const hb = liveHitbox(m);
    expect(hb).not.toBeNull();
    // The broadphase sensor encloses every collision record of the move.
    const geometry = attackSensorGeometry(f.jab);
    expect(hb!.options['_w']).toBe(geometry.width);
    expect(hb!.options['_h']).toBe(geometry.height);
  });

  it('exposes the active-attack snapshot through getActiveAttack()', () => {
    const m = createMockScene();
    const ch = f.create(m.scene);
    ground(ch, m);

    expect(ch.getActiveAttack()).toBeNull();
    expect(ch.isAttacking()).toBe(false);

    ch.applyInput({ moveX: 0, jump: false, attack: true });
    let snap = ch.getActiveAttack()!;
    expect(snap.move.id).toBe(f.jab.id);
    expect(snap.phase).toBe('startup');
    // Press call doesn't burn a frame — the move's first deterministic
    // step is the *next* applyInput. So framesElapsed reads 0 here.
    expect(snap.framesElapsed).toBe(0);
    expect(snap.hitboxBody).toBeNull();

    // Advance into the active window.
    runFrames(ch, f.jab.startupFrames, () => false);
    snap = ch.getActiveAttack()!;
    expect(snap.phase).toBe('active');
    expect(snap.hitboxBody).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Move lockout
// ---------------------------------------------------------------------------

describe('Move lockout gating', () => {
  it("rejects re-press during the move's own startup/active/recovery window", () => {
    const m = createMockScene();
    const ch = DK.create(m.scene);
    ground(ch, m);

    // Frame 0 — first press.
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(ch.isAttacking()).toBe(true);

    // Release & re-press inside the move. Should NOT start a fresh
    // attack (canAttack returns false while one is in flight).
    ch.applyInput({ moveX: 0, jump: false, attack: false });
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    const snap = ch.getActiveAttack();
    expect(snap).not.toBeNull();
    // Still the original move, not a re-launch.
    expect(snap!.move.id).toBe(DONKEYKONG_JAB.id);
    expect(snap!.framesElapsed).toBeGreaterThan(1);
  });

  it('arms no cooldown while the move is in flight', () => {
    const m = createMockScene();
    const ch = DK.create(m.scene);
    ground(ch, m);

    ch.applyInput({ moveX: 0, jump: false, attack: true });
    // While the move is in flight, cooldown stays at 0 (the gate is the
    // active-attack flag itself).
    expect(ch.getCooldownRemaining()).toBe(0);
    runFrames(ch, DONKEYKONG_JAB.startupFrames + DONKEYKONG_JAB.activeFrames - 1, () => false);
    expect(ch.getCooldownRemaining()).toBe(0);
    expect(ch.isAttacking()).toBe(true);
  });

  it('attemptAttack(id) gates re-presses the same way as the rising-edge button', () => {
    const m = createMockScene();
    const ch = PIKACHU.create(m.scene);
    ground(ch, m);

    expect(ch.attemptAttack(PIKACHU_JAB.id)).toBe(true);
    // Already in flight — second call rejected.
    expect(ch.attemptAttack(PIKACHU_JAB.id)).toBe(false);
    // Run the move to completion; the fighter is actionable again.
    runFrames(ch, lockout(PIKACHU_JAB), () => false);
    expect(ch.canAttack()).toBe(true);
    expect(ch.attemptAttack(PIKACHU_JAB.id)).toBe(true);
  });

  it('attemptAttack(id) rejects unknown move ids without affecting state', () => {
    const m = createMockScene();
    const ch = DK.create(m.scene);
    ground(ch, m);
    expect(ch.attemptAttack('does-not-exist')).toBe(false);
    expect(ch.isAttacking()).toBe(false);
    expect(ch.getCooldownRemaining()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle — destroy / setPosition cancel any live hitbox
// ---------------------------------------------------------------------------

describe('Hitbox lifecycle', () => {
  it('destroy() removes any in-flight hitbox sensor from the world', () => {
    const m = createMockScene();
    const ch = DK.create(m.scene);
    ground(ch, m);

    ch.applyInput({ moveX: 0, jump: false, attack: true });
    runFrames(ch, DONKEYKONG_JAB.startupFrames, () => false);
    expect(liveHitbox(m)).not.toBeNull();

    ch.destroy();
    // Hitbox plus the character body should both be removed.
    expect(liveHitbox(m)).toBeNull();
    expect(m.removed.length).toBeGreaterThanOrEqual(2);
  });

  it('setPosition() cancels an in-flight attack and clears cooldown', () => {
    const m = createMockScene();
    const ch = PIKACHU.create(m.scene);
    ground(ch, m);

    ch.applyInput({ moveX: 0, jump: false, attack: true });
    runFrames(ch, PIKACHU_JAB.startupFrames, () => false); // active
    expect(liveHitbox(m)).not.toBeNull();

    ch.setPosition(500, 250);
    expect(ch.isAttacking()).toBe(false);
    expect(ch.getCooldownRemaining()).toBe(0);
    expect(liveHitbox(m)).toBeNull();
  });

  it('applyInput() after destroy() does not spawn new hitboxes', () => {
    const m = createMockScene();
    const ch = DK.create(m.scene);
    ground(ch, m);
    ch.destroy();
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(m.bodies.some((b) => b.label === HITBOX_LABEL)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Light / heavy / aerial attack triplet
// ---------------------------------------------------------------------------

describe('Light / heavy / aerial moves — definitions', () => {
  it.each(FIGHTERS)('$name ships a fully-specified smash and nair', (f) => {
    const required: Array<keyof AttackMove> = [
      'id',
      'type',
      'damage',
      'knockback',
      'hitbox',
      'startupFrames',
      'activeFrames',
      'recoveryFrames',
      'cooldownFrames',
    ];
    for (const move of [f.smash, f.nair]) {
      for (const key of required) {
        expect(move[key]).not.toBeUndefined();
      }
      expect(move.damage).toBeGreaterThan(0);
    }
    expect(f.smash.type).toBe('smash');
    expect(f.nair.type).toBe('aerial');
  });

  it.each(FIGHTERS)('$name heavy hits harder than light', (f) => {
    expect(f.smash.damage).toBeGreaterThan(f.jab.damage);
    // Knockback growth distinguishes a finisher from a poke; the heavy
    // move is a KO finisher and must scale meaningfully harder than the jab.
    expect(knockbackGrowth(f.smash)).toBeGreaterThan(knockbackGrowth(f.jab));
  });

  it.each(FIGHTERS)('$name heavy move costs more frames than light (the speed-vs-power trade-off)', (f) => {
    expect(f.smash.startupFrames).toBeGreaterThan(f.jab.startupFrames);
    expect(lockout(f.smash)).toBeGreaterThan(lockout(f.jab));
  });

  it('Donkey Kong hits harder than Pikachu across the kit (archetype check)', () => {
    expect(DONKEYKONG_JAB.damage).toBeGreaterThan(PIKACHU_JAB.damage);
    expect(DONKEYKONG_SMASH.damage).toBeGreaterThan(PIKACHU_SMASH.damage);
    expect(DONKEYKONG_NAIR.damage).toBeGreaterThan(PIKACHU_NAIR.damage);
  });

  it.each(FIGHTERS)('$name registers its jab, tilt, smash and nair', (f) => {
    const m = createMockScene();
    const ch = f.create(m.scene);
    expect(ch.getAttack(f.jab.id)).toBeDefined();
    expect(ch.getAttack(f.tilt.id)).toBe(f.tilt);
    expect(ch.getAttack(f.smash.id)).toBeDefined();
    expect(ch.getAttack(f.nair.id)).toBeDefined();
  });

  it.each(FIGHTERS)('$name registered moves auto-fill the light/heavy/aerial dispatch slots', (f) => {
    // The base class wires the FIRST registered jab/tilt into the light
    // slot; jab registers before tilt, so jab keeps the slot.
    const m = createMockScene();
    const ch = f.create(m.scene);
    expect(ch.getLightAttackId()).toBe(f.jab.id);
    expect(ch.getHeavyAttackId()).toBe(f.smash.id);
    expect(ch.getAerialAttackId()).toBe(f.nair.id);
  });
});

describe('Light vs heavy vs aerial dispatch', () => {
  it('grounded `attack` press fires the light (jab) move', () => {
    const m = createMockScene();
    const ch = DK.create(m.scene);
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    const snap = ch.getActiveAttack();
    expect(snap).not.toBeNull();
    expect(snap!.move.id).toBe(DONKEYKONG_JAB.id);
  });

  it('grounded `attackHeavy` press fires the heavy (smash) move', () => {
    const m = createMockScene();
    const ch = DK.create(m.scene);
    ground(ch, m);
    // Smashes are hold-to-charge: press starts the charge, release fires.
    ch.applyInput({ moveX: 0, jump: false, attack: false, attackHeavy: true });
    ch.applyInput({ moveX: 0, jump: false, attack: false, attackHeavy: false });
    const snap = ch.getActiveAttack();
    expect(snap).not.toBeNull();
    expect(snap!.move.id).toBe(DONKEYKONG_SMASH.id);
  });

  it('heavy press takes priority over light when both rise the same frame', () => {
    const m = createMockScene();
    const ch = PIKACHU.create(m.scene);
    ground(ch, m);
    // Heavy wins the priority cascade → enters the smash charge; release fires.
    ch.applyInput({ moveX: 0, jump: false, attack: true, attackHeavy: true });
    ch.applyInput({ moveX: 0, jump: false, attack: false, attackHeavy: false });
    const snap = ch.getActiveAttack();
    expect(snap).not.toBeNull();
    expect(snap!.move.id).toBe(PIKACHU_SMASH.id);
  });

  it('airborne `attack` press fires the aerial (nair) move', () => {
    const m = createMockScene();
    const ch = DK.create(m.scene);
    // No ground contact — fighter is airborne.
    expect(ch.isGrounded()).toBe(false);
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    const snap = ch.getActiveAttack();
    expect(snap).not.toBeNull();
    expect(snap!.move.id).toBe(DONKEYKONG_NAIR.id);
  });

  // There is no airborne smash, so an airborne heavy press (smash key /
  // C-stick) fires the aerial instead.
  it('airborne `attackHeavy` press fires the aerial (no airborne smash)', () => {
    const m = createMockScene();
    const ch = DK.create(m.scene);
    expect(ch.isGrounded()).toBe(false);
    ch.applyInput({ moveX: 0, jump: false, attack: false, attackHeavy: true });
    expect(ch.getActiveAttack()?.move.id).toBe(DONKEYKONG_NAIR.id);
  });

  it('grounded heavy press takes a press-and-release cycle to re-fire', () => {
    // Smashes are hold-to-charge with the same rising-edge contract: a
    // FRESH press starts the charge; holding the button (no new rising
    // edge) after a smash ends does NOT auto-start a new charge.
    const m = createMockScene();
    const ch = PIKACHU.create(m.scene);
    ground(ch, m);

    // Press → charge → release → fire.
    ch.applyInput({ moveX: 0, jump: false, attackHeavy: true });
    ch.applyInput({ moveX: 0, jump: false, attackHeavy: false });
    expect(ch.getActiveAttack()!.move.id).toBe(PIKACHU_SMASH.id);
    // Ride out the move with no input.
    runFrames(ch, lockout(PIKACHU_SMASH), () => false);
    expect(ch.canAttack()).toBe(true);
    expect(ch.isAttacking()).toBe(false);
    // A fresh press-and-release cycle re-fires.
    ch.applyInput({ moveX: 0, jump: false, attackHeavy: true });
    ch.applyInput({ moveX: 0, jump: false, attackHeavy: false });
    expect(ch.isAttacking()).toBe(true);
    expect(ch.getActiveAttack()!.move.id).toBe(PIKACHU_SMASH.id);
  });

  it('grounded `attack` after taking off (becoming airborne) fires nair on the next press', () => {
    const m = createMockScene();
    const ch = PIKACHU.create(m.scene);
    const platform = ground(ch, m);

    // Frame 0: jump press while grounded — kicks off the ground.
    ch.applyInput({ moveX: 0, jump: true, attack: false });
    // Simulate Matter losing the ground contact on the take-off frame.
    m.emit('collisionend', [{ bodyA: ch.body, bodyB: platform }]);
    expect(ch.isGrounded()).toBe(false);

    // Now press attack while airborne — must dispatch to nair.
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    const snap = ch.getActiveAttack();
    expect(snap).not.toBeNull();
    expect(snap!.move.id).toBe(PIKACHU_NAIR.id);
  });

  /** Start one of DK's light / heavy / aerial moves and return its live hitbox plugin. */
  const dkHitboxPlugin = (kind: 'jab' | 'smash' | 'nair'): { moveId: string; damage: number } => {
    const m = createMockScene();
    const ch = DK.create(m.scene);
    if (kind === 'nair') {
      // Airborne (no ground contact emitted).
      ch.applyInput({ moveX: 0, jump: false, attack: true });
    } else {
      ground(ch, m);
      if (kind === 'jab') {
        ch.applyInput({ moveX: 0, jump: false, attack: true });
      } else {
        // Charge + immediate release → uncharged smash at base damage
        // (the charge ramp's minDamage equals the move's authored damage).
        ch.applyInput({ moveX: 0, jump: false, attackHeavy: true });
        ch.applyInput({ moveX: 0, jump: false, attackHeavy: false });
      }
    }
    runFrames(ch, DK[kind].startupFrames, () => false);
    return liveHitbox(m)!.options['plugin'] as { moveId: string; damage: number };
  };

  it('hitbox plugin payload reflects the dispatched move (smash vs jab vs nair)', () => {
    expect(dkHitboxPlugin('jab').moveId).toBe(DONKEYKONG_JAB.id);
    expect(dkHitboxPlugin('smash').moveId).toBe(DONKEYKONG_SMASH.id);
    expect(dkHitboxPlugin('nair').moveId).toBe(DONKEYKONG_NAIR.id);
  });

  it('damage payload differs across light / heavy / aerial connects', () => {
    // The hitbox plugin carries the move's damage value verbatim — the
    // damage handler reads it directly without re-looking-up the move.
    expect(dkHitboxPlugin('jab').damage).toBe(DONKEYKONG_JAB.damage);
    expect(dkHitboxPlugin('smash').damage).toBe(DONKEYKONG_SMASH.damage);
    expect(dkHitboxPlugin('nair').damage).toBe(DONKEYKONG_NAIR.damage);
  });

  it('a heavy press during hitstun is suppressed (input lockout includes attackHeavy)', () => {
    // The heavy button is a player input and must be ignored while the
    // fighter is locked out — the lockout includes the hitlag freeze AND
    // the hitstun window that follows it.
    const m = createMockScene();
    const ch = DK.create(m.scene);
    ground(ch, m);
    ch.applyHit({
      damage: 5,
      knockback: { x: 1, y: 0, scaling: 0 },
      facing: 1,
    });
    // Drive the heavy press through hitlag — should NOT trigger.
    while (ch.getHitlagRemaining() > 0) {
      ch.applyInput({ moveX: 0, jump: false, attackHeavy: true });
      expect(ch.isAttacking()).toBe(false);
    }
    expect(ch.isInHitstun()).toBe(true);
    // And through hitstun — still suppressed.
    ch.applyInput({ moveX: 0, jump: false, attackHeavy: true });
    expect(ch.isAttacking()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Grounded jab / tilt / smash — registration, dispatch and animation states.
// Locks down per fighter:
//   1. The tilt is reachable via `attemptAttack(id)` and runs the same
//      hitbox lifecycle as the other grounded moves.
//   2. The animation block on every grounded move drives the renderer's
//      frame-index selector for the full lifetime of the move (no
//      gameplay frame ever maps to an out-of-bounds art frame).
// ---------------------------------------------------------------------------

describe.each(FIGHTERS)('$name grounded triplet — registration & dispatch', (f) => {
  it('attemptAttack(tilt) drives the same hitbox lifecycle as jab/smash', () => {
    const m = createMockScene();
    const ch = f.create(m.scene);
    ground(ch, m);

    // Kick off the tilt directly. No other attack live.
    expect(ch.attemptAttack(f.tilt.id)).toBe(true);
    expect(ch.getActiveAttack()!.move.id).toBe(f.tilt.id);

    // Advance through the full startup → active transition; the hitbox
    // sensor body must spawn with the tilt's plugin payload.
    runFrames(ch, f.tilt.startupFrames, () => false);
    const hb = liveHitbox(m);
    expect(hb).not.toBeNull();
    const plugin = hb!.options['plugin'] as Record<string, unknown>;
    expect(plugin['ownerId']).toBe(f.id);
    expect(plugin['moveId']).toBe(f.tilt.id);
    expect(plugin['damage']).toBe(f.tilt.damage);
    expect(plugin['knockback']).toEqual(f.tilt.knockback);

    // Hitbox geometry encloses the tilt's authored collision records.
    const geometry = attackSensorGeometry(f.tilt);
    expect(hb!.options['_w']).toBe(geometry.width);
    expect(hb!.options['_h']).toBe(geometry.height);

    // Ride out the rest of the active window — the hitbox is despawned by
    // the active → recovery transition.
    runFrames(ch, f.tilt.activeFrames, () => false);
    expect(liveHitbox(m)).toBeNull();
  });

  it('full grounded-triplet press-to-press lockouts widen with damage', () => {
    // Lockout must monotonically increase from jab through tilt to smash —
    // the canonical "more power costs more commitment" trade-off.
    expect(lockout(f.jab)).toBeLessThan(lockout(f.tilt));
    expect(lockout(f.tilt)).toBeLessThan(lockout(f.smash));
  });
});

describe('Grounded triplet speed — Pikachu vs Donkey Kong', () => {
  it('Pikachu grounded triplet starts up no slower than Donkey Kong', () => {
    expect(PIKACHU_JAB.startupFrames).toBeLessThanOrEqual(DONKEYKONG_JAB.startupFrames);
    expect(PIKACHU_TILT.startupFrames).toBeLessThanOrEqual(DONKEYKONG_TILT.startupFrames);
    expect(PIKACHU_SMASH.startupFrames).toBeLessThanOrEqual(DONKEYKONG_SMASH.startupFrames);
  });
});

describe.each(FIGHTERS)('$name grounded triplet — animation state machine', (f) => {
  const triplet = [f.jab, f.tilt, f.smash] as const;

  it.each(triplet.map((move) => [move.id, move] as const))(
    'selectAnimationFrame walks every gameplay frame of %s cleanly',
    (_id, move) => {
      // For every frame, the selector must agree with computeAttackPhase
      // on which phase we're in, AND must hand back a valid art-frame
      // index bounded by the move's per-phase art frame count.
      const total = move.startupFrames + move.activeFrames + move.recoveryFrames;
      const anim = move.animation!;
      for (let frame = 0; frame < total; frame += 1) {
        const sel = selectAnimationFrame(frame, move);
        expect(sel.phase).toBe(computeAttackPhase(frame, move));
        const cap =
          sel.phase === 'startup'
            ? anim.startupFrames
            : sel.phase === 'active'
              ? anim.activeFrames
              : anim.recoveryFrames;
        expect(sel.artFrameIndex).toBeGreaterThanOrEqual(0);
        expect(sel.artFrameIndex).toBeLessThan(cap);
      }
      // Past the busy total, the move is 'done' and the selector reports
      // idx 0 — the renderer falls back to a neutral pose.
      expect(selectAnimationFrame(total, move)).toEqual({ phase: 'done', artFrameIndex: 0 });
    },
  );

  it('every art-frame index along the move is reached at least once', () => {
    // When art ≤ gameplay for each phase, every art frame index in
    // [0, artCount) MUST be visited at least once during a full sweep:
    // the artist authors N frames, and the engine displays all N.
    for (const move of triplet) {
      const total = move.startupFrames + move.activeFrames + move.recoveryFrames;
      const seen = new Map<string, Set<number>>();
      for (let frame = 0; frame < total; frame += 1) {
        const sel = selectAnimationFrame(frame, move);
        if (sel.phase === 'done') continue;
        if (!seen.has(sel.phase)) seen.set(sel.phase, new Set());
        seen.get(sel.phase)!.add(sel.artFrameIndex);
      }
      const anim = move.animation!;
      expect(seen.get('startup')!.size, `${move.id} startup`).toBe(anim.startupFrames);
      expect(seen.get('active')!.size, `${move.id} active`).toBe(anim.activeFrames);
      expect(seen.get('recovery')!.size, `${move.id} recovery`).toBe(anim.recoveryFrames);
    }
  });

  it('art-frame transitions advance monotonically within each phase', () => {
    // Within a phase, the art-frame index never decreases — the swing
    // animation reads forward in time. (Across phases the index resets.)
    for (const move of triplet) {
      const total = move.startupFrames + move.activeFrames + move.recoveryFrames;
      let prevPhase = '';
      let prevIdx = -1;
      for (let frame = 0; frame < total; frame += 1) {
        const sel = selectAnimationFrame(frame, move);
        if (sel.phase !== prevPhase) {
          prevPhase = sel.phase;
          prevIdx = sel.artFrameIndex;
          continue;
        }
        expect(sel.artFrameIndex).toBeGreaterThanOrEqual(prevIdx);
        prevIdx = sel.artFrameIndex;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 4 — every roster fighter has a working jab combo (jab1 → jab2 → jab3).
// Built uniformly through `createCharacterById` so registration + the chain
// runtime are exercised for the whole roster.
// ---------------------------------------------------------------------------

// Fighters whose sourced kit has a two-hit jab string (Ultimate Donkey Kong:
// Attack11 → Attack12 only; see docs/review/2026-09-25/donkeykong-character).
const TWO_STAGE_JAB_STRINGS: ReadonlySet<string> = new Set(['donkeykong']);
// Fighters whose sourced jab is one move that a fresh press restarts (no jab2): Pikachu's
// authored jab chains back into itself (pikachuJab.physics.test.ts covers the restart).
const SINGLE_STAGE_JAB_STRINGS: ReadonlySet<string> = new Set(['pikachu']);

describe('Tier 4 — roster jab combos (every fighter chains jab1 → jab2 → jab3)', () => {
  it.each(FIGHTER_REGISTRY_IDS)('%s chains its jab string', (id) => {
    const m = createMockScene();
    const ch: Character = createCharacterById(m.scene, id, {
      spawnX: 0,
      spawnY: 0,
    });
    ground(ch, m);

    // Advance the current stage into its active window (hitbox out), then
    // release + re-press to step the chain.
    const advanceAndRepress = (): void => {
      const move = ch.getActiveAttack()!.move as AttackMoveWithAnimation;
      const window = move.jabChain?.advanceWindowStart ?? move.startupFrames;
      for (
        let i = 0;
        i < 40 &&
        ch.getActiveAttack() !== null &&
        ch.getActiveAttack()!.framesElapsed < window;
        i += 1
      ) {
        ch.applyInput({ moveX: 0, jump: false, attack: false });
      }
      // A fighter whose continuation window opens after this press (Link: SmashWiki quickest loop,
      // jab 2 on frame 10) holds the tap in the offensive-action buffer until the window opens.
      let input = { moveX: 0, jump: false, attack: true };
      for (let i = 0; i <= OFFENSIVE_ACTION_BUFFER_FRAMES; i += 1) {
        const before = ch.getActiveAttack()!;
        ch.applyInput(input);
        input = { ...input, attack: false };
        const after = ch.getActiveAttack();
        if (after === null || after.move.id !== move.id || after.framesElapsed <= before.framesElapsed) break;
      }
    };

    ch.applyInput({ moveX: 0, jump: false, attack: true }); // jab1
    expect(ch.getActiveAttack()!.move.id).toBe(`${id}.jab`);
    advanceAndRepress();
    if (SINGLE_STAGE_JAB_STRINGS.has(id)) {
      expect(ch.getActiveAttack()!.move.id).toBe(`${id}.jab`);
      expect((ch.getActiveAttack()!.move as AttackMoveWithAnimation).jabChain?.nextId).toBe(`${id}.jab`);
      return;
    }
    expect(ch.getActiveAttack()!.move.id).toBe(`${id}.jab2`);
    if (TWO_STAGE_JAB_STRINGS.has(id)) {
      // Sourced two-hit string: jab 2 declares no chain, so a re-press
      // cannot advance to a third stage.
      expect((ch.getActiveAttack()!.move as AttackMoveWithAnimation).jabChain).toBeUndefined();
      return;
    }
    advanceAndRepress();
    expect(ch.getActiveAttack()!.move.id).toBe(`${id}.jab3`); // finisher
  });
});

// ---------------------------------------------------------------------------
// Up-attack coverage — an up-tilt / up-smash must be able to hit a GROUNDED
// opponent standing next to you, not only something directly overhead.
//
// Originally these hitboxes were NARROWER than the fighter's own body and sat
// entirely above it (bottom edge ~y -15), so two adjacent fighters never
// overlapped the box — the move was almost impossible to land on the ground.
// The reshape gives every up-attack a dome that (1) clears both flanks of the
// body, (2) drops to grounded-torso height, and (3) still reaches above the
// head for the juggle / anti-air column. This locks all three across the
// whole roster so the regression can't silently return.
// ---------------------------------------------------------------------------

describe('Up-attacks reach a grounded opponent in front (Smash-parity)', () => {
  const upSlots = [
    { slot: 'up-tilt', pick: (ch: Character) => ch.getUpTiltId() },
    { slot: 'up-smash', pick: (ch: Character) => ch.getUpSmashId() },
  ] as const;

  for (const id of FIGHTER_REGISTRY_IDS) {
    for (const { slot, pick } of upSlots) {
      it(`${id} ${slot} clears the body, hits grounded height, and still covers overhead`, () => {
        const m = createMockScene();
        const ch = createCharacterById(m.scene, id, { spawnX: 0, spawnY: 0 });

        const moveId = pick(ch);
        expect(moveId, `${id} has a wired ${slot}`).not.toBeNull();
        const move = ch.getAttack(moveId!);
        expect(move, `${id} ${slot} (${moveId}) is registered`).toBeDefined();

        const body = ch.getBodyHurtbox();
        const halfBodyW = body.width / 2;
        const halfBodyH = body.height / 2;
        const hb = move!.hitbox;

        // (1) The FRONT edge (offsetX is mirrored by facing, so +X is in
        //     front) reaches clearly past the body's front edge — enough to
        //     touch an opponent standing in front, not just graze the flank.
        //     Pikachu's sourced up tilt is a tail arc over the head (native tail
        //     capture, pikachuUpTiltPose.ts), so its reference box need not flank the body.
        const sourcedFrontReach = id === 'pikachu' && slot === 'up-tilt' ? 0 : halfBodyW + 12;
        expect(hb.offsetX + hb.width / 2).toBeGreaterThanOrEqual(sourcedFrontReach);

        // (2) Bottom edge drops to at least body-centre height (y >= 0), so a
        //     standing opponent's torso is caught — not only an airborne one.
        //     A sourced up smash may stop higher: Donkey Kong's AttackHi4
        //     capsule sits at y 18 ± 7 units (bottom 13 px above centre),
        //     which still overlaps a standing opponent's head and shoulders.
        const sourcedUpSmashFloor = id === 'donkeykong' && slot === 'up-smash' ? -halfBodyH + 20 : 0;
        expect(hb.offsetY + hb.height / 2).toBeGreaterThanOrEqual(sourcedUpSmashFloor);

        // (3) Top edge is still above the head, preserving the overhead
        //     juggle / anti-air column the move is built around.
        expect(hb.offsetY - hb.height / 2).toBeLessThanOrEqual(-halfBodyH);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Down-tilt coverage — a "low poke at the feet" must actually reach the floor
// so it hits a LOW / CROUCHING opponent, not whiff over their head.
//
// Originally every down-tilt sat at offsetY ~12-16 (just below body centre)
// while the feet are at +bodyHeight/2 (26-40), so the box hovered at chest
// height — a move documented as a ground sweep that couldn't hit a crouching
// target. The fix drops each box so its bottom edge lands at the feet/ground
// line while keeping its forward reach. Locked roster-wide here.
// ---------------------------------------------------------------------------

describe('Down-tilts poke low at the feet and reach in front (Smash-parity)', () => {
  for (const id of FIGHTER_REGISTRY_IDS) {
    it(`${id} down-tilt reaches the feet/ground and pokes forward`, () => {
      const m = createMockScene();
      const ch = createCharacterById(m.scene, id, { spawnX: 0, spawnY: 0 });

      const moveId = ch.getDownTiltId();
      expect(moveId, `${id} has a wired down-tilt`).not.toBeNull();
      const move = ch.getAttack(moveId!);
      expect(move, `${id} down-tilt (${moveId}) is registered`).toBeDefined();

      const body = ch.getBodyHurtbox();
      // Body is centre-anchored (offsetY > 0 = down), feet at +height/2.
      const feetY = body.height / 2;
      const hb = move!.hitbox;

      // (1) Bottom edge reaches the feet/ground (within 4px), so a low /
      //     crouching opponent at the floor is inside the box.
      expect(hb.offsetY + hb.height / 2).toBeGreaterThanOrEqual(feetY - 4);

      // (2) Forward low poke — reaches past the body's front edge.
      expect(hb.offsetX + hb.width / 2).toBeGreaterThan(body.width / 2);
    });
  }
});

// ---------------------------------------------------------------------------
// Tap-jump buffer — with "tap up to jump", pressing UP to up-tilt/up-smash
// also fires a jump and the jump would win, making grounded up-attacks nearly
// impossible. The buffer holds an ambiguous up+jump a few frames so a
// follow-up attack converts it to the up-attack instead of jumping. Plain
// (no up-stick) jumps use only the universal grounded jumpsquat.
// ---------------------------------------------------------------------------

describe('Tap-jump buffer — up+attack beats the jump', () => {
  const groundedDonkeyKong = (): Character => {
    const m = createMockScene();
    const ch = createCharacterById(m.scene, 'donkeykong', { spawnX: 0, spawnY: 0 });
    ground(ch, m);
    return ch;
  };

  it('a plain jump (no up-stick) takes off after three preparation frames', () => {
    const ch = groundedDonkeyKong();
    ch.applyInput({ moveX: 0, jump: true });
    for (let frame = 0; frame < 3; frame += 1) {
      expect(ch.getVelocity().y).toBeGreaterThanOrEqual(0);
      ch.applyInput({ moveX: 0, jump: true });
    }
    expect(ch.getVelocity().y).toBeLessThan(0);
  });

  it('an up+jump press is held back, not an instant jump', () => {
    const ch = groundedDonkeyKong();
    ch.applyInput({ moveX: 0, moveY: -1, jump: true });
    expect(ch.getVelocity().y).toBeGreaterThanOrEqual(0); // buffered, not jumped
    expect(ch.getActiveAttack()).toBeNull();
  });

  it('up+jump then attack within the window fires the up-attack, NOT a jump', () => {
    const ch = groundedDonkeyKong();
    ch.applyInput({ moveX: 0, moveY: -1, jump: true }); // press → buffer
    ch.applyInput({ moveX: 0, moveY: -1, jump: true }); // hold → buffer ticks
    ch.applyInput({ moveX: 0, moveY: -1, jump: true, attack: true }); // attack converts
    expect(ch.getVelocity().y).toBeGreaterThanOrEqual(0); // did NOT jump
    const active = ch.getActiveAttack();
    expect(active).not.toBeNull();
    expect(active!.move.id).toBe(ch.getUpTiltId());
  });

  it('up+jump with no follow-up attack still jumps once the buffer expires', () => {
    const ch = groundedDonkeyKong();
    ch.applyInput({ moveX: 0, moveY: -1, jump: true }); // press → buffer
    let jumped = false;
    // Hold up+jump; the buffered jump must fire within a handful of frames.
    for (let i = 0; i < 8; i += 1) {
      ch.applyInput({ moveX: 0, moveY: -1, jump: true });
      if (ch.getVelocity().y < 0) {
        jumped = true;
        break;
      }
    }
    expect(jumped).toBe(true);
    expect(ch.getActiveAttack()).toBeNull(); // jumped, no attack fired
  });
});

// ---------------------------------------------------------------------------
// Vertical smash flick — up/down-smash must be reachable by FLICKING the stick
// up/down + attack (the only way without a dedicated heavy button, which the
// input layer never wires). A steadily HELD stick + attack stays a tilt.
// REGRESSION: these moves were authored but UNREACHABLE by a real player.
// ---------------------------------------------------------------------------

describe('Vertical smash flick — up/down-smash reachable via flick + attack', () => {
  const groundedDonkeyKong = (): Character => {
    const m = createMockScene();
    const ch = createCharacterById(m.scene, 'donkeykong', { spawnX: 0, spawnY: 0 });
    ground(ch, m);
    return ch;
  };

  it('an UP-flick (rest → up) + attack fires up-smash (charge, release to fire)', () => {
    const ch = groundedDonkeyKong();
    ch.applyInput({ moveX: 0, jump: false }); // stick at rest → prevMoveY latches 0
    ch.applyInput({ moveX: 0, moveY: -1, jump: false, attack: true }); // flick up → up-smash charge
    ch.applyInput({ moveX: 0, moveY: -1, jump: false, attack: false }); // release → fires
    expect(ch.getActiveAttack()?.move.id).toBe(ch.getUpSmashId());
  });

  it('a DOWN-flick (rest → down) + attack fires down-smash (charge, release to fire)', () => {
    const ch = groundedDonkeyKong();
    ch.applyInput({ moveX: 0, jump: false });
    ch.applyInput({ moveX: 0, moveY: 1, jump: false, attack: true }); // flick down → down-smash charge
    ch.applyInput({ moveX: 0, moveY: 1, jump: false, attack: false }); // release → fires
    expect(ch.getActiveAttack()?.move.id).toBe(ch.getDownSmashId());
  });

  it('a HELD up-stick + attack stays an up-TILT (a lean is not a flick)', () => {
    const ch = groundedDonkeyKong();
    ch.applyInput({ moveX: 0, moveY: -1, jump: false }); // hold up → prevMoveY latches -1
    ch.applyInput({ moveX: 0, moveY: -1, jump: false, attack: true }); // still up + attack
    expect(ch.getActiveAttack()?.move.id).toBe(ch.getUpTiltId());
  });
});

// ---------------------------------------------------------------------------
// Up-special via the up-stick (not only the jump button) — on a gamepad, jump
// and the up-stick are separate inputs, so a stick-only up+special must still
// reach the recovery rather than falling through to the neutral special.
// ---------------------------------------------------------------------------

describe('Up-special via up-stick (jump button not pressed)', () => {
  it('special + up-stick with NO jump fires the up-special', () => {
    const m = createMockScene();
    const ch = createCharacterById(m.scene, 'donkeykong', { spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.applyInput({ moveX: 0, moveY: -1, jump: false, special: true });
    expect(ch.getActiveAttack()?.move.id).toBe(ch.getUpSpecialId());
  });
});
