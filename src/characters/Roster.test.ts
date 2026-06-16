import { describe, it, expect } from 'vitest';
import {
  Cat,
  CAT_JAB,
  CAT_NAIR,
  CAT_SMASH,
  CAT_TILT,
  CAT_TUNING,
  Character,
  HITBOX_COLLISION_FILTER,
  HITBOX_LABEL,
  Wolf,
  WOLF_JAB,
  WOLF_NAIR,
  WOLF_SMASH,
  WOLF_TILT,
  WOLF_TUNING,
  createCharacterById,
  selectAnimationFrame,
  computeAttackPhase,
  type AttackMove,
} from './index';
import { FIGHTER_REGISTRY_IDS } from './fighterRegistry';
import { COLLISION_CATEGORIES, COLLISION_MASKS } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/StageRenderer';

/**
 * AC 202 Sub-AC 2: two concrete character subclasses with distinct
 * stats and at least one basic attack move each (hitbox spawn, damage
 * value, cooldown).
 *
 * What this suite locks down:
 *
 *   1. Distinct stats — Wolf (bruiser) and Cat (ninja) ship with
 *      different mass, top speed, jump height, and silhouette. The
 *      stat-spread isn't accidental: a balance pass that flattens
 *      them into clones should fail loudly here.
 *   2. Hitbox spawn — pressing attack while idle creates exactly one
 *      Matter sensor body in front of the fighter, on the right
 *      animation frame, with the right collision filter, label, and
 *      `plugin.{ownerId, moveId, damage, knockback, facing}` payload.
 *   3. Damage value — the spawned hitbox carries the attack's damage
 *      so the (later AC) damage handler can read a single source of
 *      truth without reverse-looking-up the character's moveset.
 *   4. Cooldown — back-to-back attacks are gated by
 *      `cooldownRemaining` running from the end of recovery. Cat's
 *      cooldown is shorter than Wolf's by design, so this also
 *      double-checks the stats are wired through.
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

/** Drop the character onto a platform so subsequent applyInput sees grounded=true. */
function ground(ch: Character, m: MockScene): void {
  const plat = makePlatform(ch.getPosition().x, ch.getPosition().y + 100);
  m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
}

/** Find the first hitbox body in the mock scene that hasn't been removed yet. */
function liveHitbox(m: MockScene): MockBody | null {
  for (const b of m.bodies) {
    if (b.label === HITBOX_LABEL && !b.removed) return b;
  }
  return null;
}

/** Run the attack press-and-release pattern across N frames, returning frame log. */
function runFrames(ch: Wolf | Cat, frames: number, attackHeld: (frame: number) => boolean): void {
  for (let i = 0; i < frames; i += 1) {
    ch.applyInput({ moveX: 0, jump: false, attack: attackHeld(i) });
  }
}

// ---------------------------------------------------------------------------
// Distinct stats
// ---------------------------------------------------------------------------

describe('Wolf vs Cat — distinct stats (AC 202 Sub-AC 2)', () => {
  it('ships Wolf with bruiser stats and Cat with ninja stats', () => {
    // Cat is faster.
    expect(CAT_TUNING.maxRunSpeed).toBeGreaterThan(WOLF_TUNING.maxRunSpeed);
    // Wolf is heavier.
    expect(WOLF_TUNING.mass).toBeGreaterThan(CAT_TUNING.mass);
    // Cat has higher air control.
    expect(CAT_TUNING.airAccel).toBeGreaterThan(WOLF_TUNING.airAccel);
    // Cat jumps higher.
    expect(CAT_TUNING.jumpImpulse).toBeGreaterThan(WOLF_TUNING.jumpImpulse);
    // Wolf is bigger.
    expect(WOLF_TUNING.width).toBeGreaterThan(CAT_TUNING.width);
    expect(WOLF_TUNING.height).toBeGreaterThan(CAT_TUNING.height);
  });

  it('Wolf reports id "wolf" and uses WOLF_TUNING by default', () => {
    const m = createMockScene();
    const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    expect(ch.id).toBe('wolf');
    const t = ch.getTuning();
    expect(t.maxRunSpeed).toBe(WOLF_TUNING.maxRunSpeed);
    expect(t.mass).toBe(WOLF_TUNING.mass);
    expect(t.width).toBe(WOLF_TUNING.width);
    expect(t.height).toBe(WOLF_TUNING.height);
  });

  it('Cat reports id "cat" and uses CAT_TUNING by default', () => {
    const m = createMockScene();
    const ch = new Cat(m.scene, { spawnX: 0, spawnY: 0 });
    expect(ch.id).toBe('cat');
    const t = ch.getTuning();
    expect(t.maxRunSpeed).toBe(CAT_TUNING.maxRunSpeed);
    expect(t.mass).toBe(CAT_TUNING.mass);
    expect(t.width).toBe(CAT_TUNING.width);
    expect(t.height).toBe(CAT_TUNING.height);
  });

  it('the body geometry passed to Matter matches the per-character tuning', () => {
    const wolfScene = createMockScene();
    new Wolf(wolfScene.scene, { spawnX: 0, spawnY: 0 });
    const catScene = createMockScene();
    new Cat(catScene.scene, { spawnX: 0, spawnY: 0 });

    expect(wolfScene.bodies[0]!.options['_w']).toBe(WOLF_TUNING.width);
    expect(wolfScene.bodies[0]!.options['_h']).toBe(WOLF_TUNING.height);
    expect(catScene.bodies[0]!.options['_w']).toBe(CAT_TUNING.width);
    expect(catScene.bodies[0]!.options['_h']).toBe(CAT_TUNING.height);
    // Mass is wired through Matter's options bag.
    expect(wolfScene.bodies[0]!.options['mass']).toBe(WOLF_TUNING.mass);
    expect(catScene.bodies[0]!.options['mass']).toBe(CAT_TUNING.mass);
  });

  it('caller-supplied options still override class defaults (e.g. test mass overrides)', () => {
    const m = createMockScene();
    const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0, mass: 99, maxRunSpeed: 1 });
    const t = ch.getTuning();
    expect(t.mass).toBe(99);
    expect(t.maxRunSpeed).toBe(1);
    // Other fields keep the class defaults.
    expect(t.airAccel).toBe(WOLF_TUNING.airAccel);
  });

  it('movement speed difference is observable through applyInput', () => {
    const wolfScene = createMockScene();
    const wolf = new Wolf(wolfScene.scene, { spawnX: 0, spawnY: 0 });
    ground(wolf, wolfScene);

    const catScene = createMockScene();
    const cat = new Cat(catScene.scene, { spawnX: 0, spawnY: 0 });
    ground(cat, catScene);

    for (let i = 0; i < 60; i += 1) {
      wolf.applyInput({ moveX: 1, jump: false });
      cat.applyInput({ moveX: 1, jump: false });
    }
    // Cat's terminal velocity is the bigger number.
    expect(cat.getVelocity().x).toBeGreaterThan(wolf.getVelocity().x);
    expect(cat.getVelocity().x).toBeCloseTo(CAT_TUNING.maxRunSpeed);
    expect(wolf.getVelocity().x).toBeCloseTo(WOLF_TUNING.maxRunSpeed);
  });
});

// ---------------------------------------------------------------------------
// Attack-move definitions — damage + cooldown values
// ---------------------------------------------------------------------------

describe('Wolf.jab and Cat.jab — move definitions', () => {
  it('exposes WOLF_JAB and CAT_JAB as fully-specified AttackMove records', () => {
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
    for (const move of [WOLF_JAB, CAT_JAB]) {
      for (const key of required) {
        expect(move[key]).not.toBeUndefined();
      }
      expect(move.type).toBe('jab');
    }
  });

  it('Wolf hits harder than Cat (distinct damage values)', () => {
    expect(WOLF_JAB.damage).toBeGreaterThan(CAT_JAB.damage);
  });

  it('Cat recovers faster than Wolf (distinct cooldown values)', () => {
    expect(CAT_JAB.cooldownFrames).toBeLessThan(WOLF_JAB.cooldownFrames);
    expect(CAT_JAB.recoveryFrames).toBeLessThan(WOLF_JAB.recoveryFrames);
  });

  it('hitbox geometry sits in front of the fighter (positive offsetX)', () => {
    expect(WOLF_JAB.hitbox.offsetX).toBeGreaterThan(0);
    expect(CAT_JAB.hitbox.offsetX).toBeGreaterThan(0);
    expect(WOLF_JAB.hitbox.width).toBeGreaterThan(0);
    expect(CAT_JAB.hitbox.width).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Hitbox spawn — body construction & timing
// ---------------------------------------------------------------------------

describe('Hitbox spawn (AC 202 Sub-AC 2)', () => {
  it('spawns no hitbox until the active phase begins', () => {
    const m = createMockScene();
    const ch = new Wolf(m.scene, { spawnX: 100, spawnY: 100 });
    ground(ch, m);

    // Press attack on frame 0. With startup=4, the hitbox should NOT
    // exist on frames 1..3.
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(liveHitbox(m)).toBeNull();
    for (let i = 0; i < WOLF_JAB.startupFrames - 1; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, attack: false });
      expect(liveHitbox(m)).toBeNull();
    }
    // Next call rolls the elapsed counter into the active window.
    ch.applyInput({ moveX: 0, jump: false, attack: false });
    expect(liveHitbox(m)).not.toBeNull();
  });

  it('despawns the hitbox at the end of the active window', () => {
    const m = createMockScene();
    const ch = new Wolf(m.scene, { spawnX: 100, spawnY: 100 });
    ground(ch, m);

    // Press on the press call (f=0). Then advance startup+active calls
    // — this lands us on the first 'recovery' frame, which is the step
    // where the despawn fires.
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    runFrames(
      ch,
      WOLF_JAB.startupFrames + WOLF_JAB.activeFrames,
      () => false,
    );
    // A hitbox was alive at some point.
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
    const ch = new Cat(m.scene, { spawnX: 0, spawnY: 0 });
    ground(ch, m);

    // Cat: startup 2, active 2 → hitbox alive on frame 3 (after 3 ticks).
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    ch.applyInput({ moveX: 0, jump: false, attack: false });
    ch.applyInput({ moveX: 0, jump: false, attack: false });
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
    const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    ground(ch, m);

    ch.applyInput({ moveX: 0, jump: false, attack: true });
    runFrames(ch, WOLF_JAB.startupFrames, () => false); // land in active
    const hb = liveHitbox(m);
    expect(hb).not.toBeNull();
    const plugin = hb!.options['plugin'] as Record<string, unknown>;
    expect(plugin['ownerId']).toBe('wolf');
    expect(plugin['moveId']).toBe(WOLF_JAB.id);
    expect(plugin['damage']).toBe(WOLF_JAB.damage);
    expect(plugin['knockback']).toEqual(WOLF_JAB.knockback);
    // Default facing is right (+1) since we never deflected the stick.
    expect(plugin['facing']).toBe(1);
  });

  it('mirrors hitbox offsetX by the fighter\'s facing direction', () => {
    const m = createMockScene();
    const ch = new Cat(m.scene, { spawnX: 500, spawnY: 200 });
    ground(ch, m);
    // Face left.
    ch.setFacing(-1);
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    // Cat: startup 2 — advance to active.
    ch.applyInput({ moveX: 0, jump: false, attack: false });
    ch.applyInput({ moveX: 0, jump: false, attack: false });
    const hb = liveHitbox(m);
    expect(hb).not.toBeNull();
    // offsetX should be flipped: hitbox center sits to the LEFT of body.
    expect(hb!.position.x).toBeLessThan(ch.getPosition().x);
    // ...and at the configured offset distance.
    expect(ch.getPosition().x - hb!.position.x).toBeCloseTo(CAT_JAB.hitbox.offsetX);
  });

  it('hitbox dimensions match the move definition', () => {
    const m = createMockScene();
    const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    runFrames(ch, WOLF_JAB.startupFrames, () => false);
    const hb = liveHitbox(m);
    expect(hb).not.toBeNull();
    expect(hb!.options['_w']).toBe(WOLF_JAB.hitbox.width);
    expect(hb!.options['_h']).toBe(WOLF_JAB.hitbox.height);
  });

  it('exposes the active-attack snapshot through getActiveAttack()', () => {
    const m = createMockScene();
    const ch = new Cat(m.scene, { spawnX: 0, spawnY: 0 });
    ground(ch, m);

    expect(ch.getActiveAttack()).toBeNull();
    expect(ch.isAttacking()).toBe(false);

    ch.applyInput({ moveX: 0, jump: false, attack: true });
    let snap = ch.getActiveAttack()!;
    expect(snap.move.id).toBe(CAT_JAB.id);
    expect(snap.phase).toBe('startup');
    // Press call doesn't burn a frame — the move's first deterministic
    // step is the *next* applyInput. So framesElapsed reads 0 here.
    expect(snap.framesElapsed).toBe(0);
    expect(snap.hitboxBody).toBeNull();

    // Advance into active window.
    ch.applyInput({ moveX: 0, jump: false, attack: false });
    ch.applyInput({ moveX: 0, jump: false, attack: false });
    snap = ch.getActiveAttack()!;
    expect(snap.phase).toBe('active');
    expect(snap.hitboxBody).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cooldown
// ---------------------------------------------------------------------------

describe('Cooldown gating (AC 202 Sub-AC 2)', () => {
  it('rejects re-press during the move\'s own startup/active/recovery window', () => {
    const m = createMockScene();
    const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    ground(ch, m);

    // Frame 0 — first press.
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(ch.isAttacking()).toBe(true);

    // Release & re-press inside the active window. Should NOT start a
    // fresh attack (canAttack returns false while one is in flight).
    ch.applyInput({ moveX: 0, jump: false, attack: false });
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    const snap = ch.getActiveAttack();
    expect(snap).not.toBeNull();
    // Still the original move, not a re-launch.
    expect(snap!.framesElapsed).toBeGreaterThan(1);
  });

  it('arms cooldown only after recovery ends, not during the move', () => {
    const m = createMockScene();
    const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    ground(ch, m);

    ch.applyInput({ moveX: 0, jump: false, attack: true });
    // While the move is in flight, cooldown stays at 0 (the gate is the
    // active-attack flag itself).
    expect(ch.getCooldownRemaining()).toBe(0);
    runFrames(ch, WOLF_JAB.startupFrames + WOLF_JAB.activeFrames - 1, () => false);
    expect(ch.getCooldownRemaining()).toBe(0);
    expect(ch.isAttacking()).toBe(true);
  });

  it('locks out re-press during the cooldown window, then accepts a new attack', () => {
    const m = createMockScene();
    const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    ground(ch, m);

    const totalBusy = WOLF_JAB.startupFrames + WOLF_JAB.activeFrames + WOLF_JAB.recoveryFrames;
    // Press, then ride out the entire move-busy window (no held button —
    // we only want to detect rising-edge presses). After `totalBusy`
    // post-press calls, framesElapsed advances from 0 through totalBusy,
    // crossing into 'done' on the last call → activeAttack cleared and
    // cooldown freshly armed.
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    runFrames(ch, totalBusy, () => false);
    expect(ch.isAttacking()).toBe(false);
    expect(ch.getCooldownRemaining()).toBe(WOLF_JAB.cooldownFrames);

    // Try to press again immediately — must be rejected. Cooldown also
    // drains by 1 on this call (the rejected press doesn't restart the
    // attack, so step 3's drain runs).
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(ch.isAttacking()).toBe(false);
    expect(ch.canAttack()).toBe(false);
    expect(ch.getCooldownRemaining()).toBe(WOLF_JAB.cooldownFrames - 1);

    // Burn the rest of the cooldown with neutral inputs.
    runFrames(ch, WOLF_JAB.cooldownFrames - 1, () => false);
    expect(ch.getCooldownRemaining()).toBe(0);
    expect(ch.canAttack()).toBe(true);

    // Now a fresh press connects.
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(ch.isAttacking()).toBe(true);
  });

  it('Cat\'s shorter cooldown lets her press-press faster than Wolf', () => {
    const wolfScene = createMockScene();
    const wolf = new Wolf(wolfScene.scene, { spawnX: 0, spawnY: 0 });
    ground(wolf, wolfScene);
    const catScene = createMockScene();
    const cat = new Cat(catScene.scene, { spawnX: 0, spawnY: 0 });
    ground(cat, catScene);

    // Time-to-second-press = startup + active + recovery + cooldown.
    const wolfWindow =
      WOLF_JAB.startupFrames +
      WOLF_JAB.activeFrames +
      WOLF_JAB.recoveryFrames +
      WOLF_JAB.cooldownFrames;
    const catWindow =
      CAT_JAB.startupFrames +
      CAT_JAB.activeFrames +
      CAT_JAB.recoveryFrames +
      CAT_JAB.cooldownFrames;
    expect(catWindow).toBeLessThan(wolfWindow);
  });

  it('attemptAttack(id) respects cooldown the same way as the rising-edge button', () => {
    const m = createMockScene();
    const ch = new Cat(m.scene, { spawnX: 0, spawnY: 0 });
    ground(ch, m);

    expect(ch.attemptAttack('cat.jab')).toBe(true);
    // Already in flight — second call rejected.
    expect(ch.attemptAttack('cat.jab')).toBe(false);
    // Run the move + cooldown to completion. Each fixed step both
    // advances the move (when active) and drains the cooldown (after
    // the move ends), so the lockout from press to actionable is the
    // sum of every phase's frame budget.
    const totalLockout =
      CAT_JAB.startupFrames +
      CAT_JAB.activeFrames +
      CAT_JAB.recoveryFrames +
      CAT_JAB.cooldownFrames;
    runFrames(ch, totalLockout, () => false);
    expect(ch.canAttack()).toBe(true);
    expect(ch.attemptAttack('cat.jab')).toBe(true);
  });

  it('attemptAttack(id) rejects unknown move ids without affecting state', () => {
    const m = createMockScene();
    const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
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
    const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    ground(ch, m);

    ch.applyInput({ moveX: 0, jump: false, attack: true });
    runFrames(ch, WOLF_JAB.startupFrames, () => false);
    expect(liveHitbox(m)).not.toBeNull();

    ch.destroy();
    // Hitbox plus the character body should both be removed.
    expect(liveHitbox(m)).toBeNull();
    expect(m.removed.length).toBeGreaterThanOrEqual(2);
  });

  it('setPosition() cancels an in-flight attack and clears cooldown', () => {
    const m = createMockScene();
    const ch = new Cat(m.scene, { spawnX: 0, spawnY: 0 });
    ground(ch, m);

    ch.applyInput({ moveX: 0, jump: false, attack: true });
    ch.applyInput({ moveX: 0, jump: false, attack: false });
    ch.applyInput({ moveX: 0, jump: false, attack: false }); // active
    expect(liveHitbox(m)).not.toBeNull();

    ch.setPosition(500, 250);
    expect(ch.isAttacking()).toBe(false);
    expect(ch.getCooldownRemaining()).toBe(0);
    expect(liveHitbox(m)).toBeNull();
  });

  it('applyInput() after destroy() does not spawn new hitboxes', () => {
    const m = createMockScene();
    const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.destroy();
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(m.bodies.some((b) => b.label === HITBOX_LABEL)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 3.3 — light / heavy / aerial attack triplet
// ---------------------------------------------------------------------------

describe('Light / heavy / aerial moves — definitions (AC 203 Sub-AC 3.3)', () => {
  it('Wolf ships a fully-specified smash and nair', () => {
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
    for (const move of [WOLF_SMASH, WOLF_NAIR]) {
      for (const key of required) {
        expect(move[key]).not.toBeUndefined();
      }
    }
    expect(WOLF_SMASH.type).toBe('smash');
    expect(WOLF_NAIR.type).toBe('aerial');
  });

  it('Cat ships a fully-specified smash and nair', () => {
    expect(CAT_SMASH.type).toBe('smash');
    expect(CAT_NAIR.type).toBe('aerial');
    expect(CAT_SMASH.damage).toBeGreaterThan(0);
    expect(CAT_NAIR.damage).toBeGreaterThan(0);
  });

  it('heavy hits harder than light for both fighters', () => {
    expect(WOLF_SMASH.damage).toBeGreaterThan(WOLF_JAB.damage);
    expect(CAT_SMASH.damage).toBeGreaterThan(CAT_JAB.damage);
    // Knockback scaling distinguishes a finisher from a poke; the heavy
    // moves are KO finishers and must scale meaningfully harder than
    // the corresponding jab.
    expect(WOLF_SMASH.knockback.scaling).toBeGreaterThan(WOLF_JAB.knockback.scaling);
    expect(CAT_SMASH.knockback.scaling).toBeGreaterThan(CAT_JAB.knockback.scaling);
  });

  it('heavy moves cost more frames than light moves (the speed-vs-power trade-off)', () => {
    expect(WOLF_SMASH.startupFrames).toBeGreaterThan(WOLF_JAB.startupFrames);
    expect(CAT_SMASH.startupFrames).toBeGreaterThan(CAT_JAB.startupFrames);
    const wolfHeavyTotal =
      WOLF_SMASH.startupFrames +
      WOLF_SMASH.activeFrames +
      WOLF_SMASH.recoveryFrames +
      WOLF_SMASH.cooldownFrames;
    const wolfLightTotal =
      WOLF_JAB.startupFrames +
      WOLF_JAB.activeFrames +
      WOLF_JAB.recoveryFrames +
      WOLF_JAB.cooldownFrames;
    expect(wolfHeavyTotal).toBeGreaterThan(wolfLightTotal);
  });

  it('Wolf hits harder than Cat across the entire kit (archetype check)', () => {
    expect(WOLF_JAB.damage).toBeGreaterThan(CAT_JAB.damage);
    expect(WOLF_SMASH.damage).toBeGreaterThan(CAT_SMASH.damage);
    expect(WOLF_NAIR.damage).toBeGreaterThan(CAT_NAIR.damage);
  });

  it('aerial hitboxes are body-centred (offsetX = 0) so they cover both sides', () => {
    expect(WOLF_NAIR.hitbox.offsetX).toBe(0);
    expect(CAT_NAIR.hitbox.offsetX).toBe(0);
  });

  it('Wolf and Cat each register exactly three moves: jab, smash, nair', () => {
    const wolfScene = createMockScene();
    const wolf = new Wolf(wolfScene.scene, { spawnX: 0, spawnY: 0 });
    expect(wolf.getAttack(WOLF_JAB.id)).toBeDefined();
    expect(wolf.getAttack(WOLF_SMASH.id)).toBeDefined();
    expect(wolf.getAttack(WOLF_NAIR.id)).toBeDefined();

    const catScene = createMockScene();
    const cat = new Cat(catScene.scene, { spawnX: 0, spawnY: 0 });
    expect(cat.getAttack(CAT_JAB.id)).toBeDefined();
    expect(cat.getAttack(CAT_SMASH.id)).toBeDefined();
    expect(cat.getAttack(CAT_NAIR.id)).toBeDefined();
  });

  it('the registered moves auto-fill the light/heavy/aerial dispatch slots', () => {
    const wolfScene = createMockScene();
    const wolf = new Wolf(wolfScene.scene, { spawnX: 0, spawnY: 0 });
    expect(wolf.getLightAttackId()).toBe(WOLF_JAB.id);
    expect(wolf.getHeavyAttackId()).toBe(WOLF_SMASH.id);
    expect(wolf.getAerialAttackId()).toBe(WOLF_NAIR.id);

    const catScene = createMockScene();
    const cat = new Cat(catScene.scene, { spawnX: 0, spawnY: 0 });
    expect(cat.getLightAttackId()).toBe(CAT_JAB.id);
    expect(cat.getHeavyAttackId()).toBe(CAT_SMASH.id);
    expect(cat.getAerialAttackId()).toBe(CAT_NAIR.id);
  });
});

describe('Light vs heavy vs aerial dispatch (AC 203 Sub-AC 3.3)', () => {
  it('grounded `attack` press fires the light (jab) move', () => {
    const m = createMockScene();
    const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    const snap = ch.getActiveAttack();
    expect(snap).not.toBeNull();
    expect(snap!.move.id).toBe(WOLF_JAB.id);
  });

  it('grounded `attackHeavy` press fires the heavy (smash) move', () => {
    const m = createMockScene();
    const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    ground(ch, m);
    // Smashes are now hold-to-charge: press starts the charge, release fires.
    ch.applyInput({ moveX: 0, jump: false, attack: false, attackHeavy: true });
    ch.applyInput({ moveX: 0, jump: false, attack: false, attackHeavy: false });
    const snap = ch.getActiveAttack();
    expect(snap).not.toBeNull();
    expect(snap!.move.id).toBe(WOLF_SMASH.id);
  });

  it('heavy press takes priority over light when both rise the same frame', () => {
    const m = createMockScene();
    const ch = new Cat(m.scene, { spawnX: 0, spawnY: 0 });
    ground(ch, m);
    // Heavy wins the priority cascade → enters the smash charge; release fires.
    ch.applyInput({ moveX: 0, jump: false, attack: true, attackHeavy: true });
    ch.applyInput({ moveX: 0, jump: false, attack: false, attackHeavy: false });
    const snap = ch.getActiveAttack();
    expect(snap).not.toBeNull();
    expect(snap!.move.id).toBe(CAT_SMASH.id);
  });

  it("Wolf's jab chains jab1 → jab2 → jab3 on re-presses (Tier 4)", () => {
    const m = createMockScene();
    const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    ground(ch, m);
    // Advance the current stage into its active window (hitbox out), then
    // release + re-press to step the chain.
    const advanceAndRepress = (): void => {
      const window = ch.getActiveAttack()!.move.startupFrames;
      for (
        let i = 0;
        i < 30 &&
        ch.getActiveAttack() !== null &&
        ch.getActiveAttack()!.framesElapsed < window;
        i += 1
      ) {
        ch.applyInput({ moveX: 0, jump: false, attack: false });
      }
      ch.applyInput({ moveX: 0, jump: false, attack: true });
    };

    ch.applyInput({ moveX: 0, jump: false, attack: true }); // jab1
    expect(ch.getActiveAttack()!.move.id).toBe('wolf.jab');
    advanceAndRepress();
    expect(ch.getActiveAttack()!.move.id).toBe('wolf.jab2');
    advanceAndRepress();
    expect(ch.getActiveAttack()!.move.id).toBe('wolf.jab3'); // finisher
  });

  it('airborne `attack` press fires the aerial (nair) move', () => {
    const m = createMockScene();
    const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    // No ground contact — fighter is airborne.
    expect(ch.isGrounded()).toBe(false);
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    const snap = ch.getActiveAttack();
    expect(snap).not.toBeNull();
    expect(snap!.move.id).toBe(WOLF_NAIR.id);
  });

  it('airborne `attackHeavy` press is ignored (smashes are grounded moves)', () => {
    const m = createMockScene();
    const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    expect(ch.isGrounded()).toBe(false);
    ch.applyInput({ moveX: 0, jump: false, attack: false, attackHeavy: true });
    expect(ch.isAttacking()).toBe(false);
  });

  it('grounded heavy press takes a press-and-release cycle to re-fire', () => {
    // Smashes are hold-to-charge with the same rising-edge contract: a
    // FRESH press starts the charge; holding the button (no new rising
    // edge) after a smash ends does NOT auto-start a new charge.
    const m = createMockScene();
    const ch = new Cat(m.scene, { spawnX: 0, spawnY: 0 });
    ground(ch, m);

    // Press → charge → release → fire.
    ch.applyInput({ moveX: 0, jump: false, attackHeavy: true });
    ch.applyInput({ moveX: 0, jump: false, attackHeavy: false });
    expect(ch.getActiveAttack()!.move.id).toBe(CAT_SMASH.id);
    const totalLockout =
      CAT_SMASH.startupFrames +
      CAT_SMASH.activeFrames +
      CAT_SMASH.recoveryFrames +
      CAT_SMASH.cooldownFrames;
    // Ride out the move + cooldown with no input.
    runFrames(ch, totalLockout, () => false);
    expect(ch.canAttack()).toBe(true);
    expect(ch.isAttacking()).toBe(false);
    // A fresh press-and-release cycle re-fires.
    ch.applyInput({ moveX: 0, jump: false, attackHeavy: true });
    ch.applyInput({ moveX: 0, jump: false, attackHeavy: false });
    expect(ch.isAttacking()).toBe(true);
    expect(ch.getActiveAttack()!.move.id).toBe(CAT_SMASH.id);
  });

  it('grounded `attack` after taking off (becoming airborne) fires nair on the next press', () => {
    const m = createMockScene();
    const ch = new Cat(m.scene, { spawnX: 0, spawnY: 0 });
    ground(ch, m);

    // Frame 0: jump press while grounded — kicks off the ground.
    ch.applyInput({ moveX: 0, jump: true, attack: false });
    // Simulate Matter losing the ground contact on the take-off frame.
    m.emit('collisionend', [
      { bodyA: ch.body, bodyB: { label: PLATFORM_LABELS.solid, position: { x: 0, y: 100 } } },
    ]);
    expect(ch.isGrounded()).toBe(false);

    // Now press attack while airborne — must dispatch to nair.
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    const snap = ch.getActiveAttack();
    expect(snap).not.toBeNull();
    expect(snap!.move.id).toBe(CAT_NAIR.id);
  });

  it('hitbox plugin payload reflects the dispatched move (smash vs jab vs nair)', () => {
    // Three independent fighters so we can compare plugin payloads
    // without a single fighter's cooldown getting in the way.
    const groundedAttack = (() => {
      const m = createMockScene();
      const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
      ground(ch, m);
      ch.applyInput({ moveX: 0, jump: false, attack: true });
      runFrames(ch, WOLF_JAB.startupFrames, () => false);
      const hb = liveHitbox(m)!;
      return (hb.options['plugin'] as { moveId: string }).moveId;
    })();
    const groundedHeavy = (() => {
      const m = createMockScene();
      const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
      ground(ch, m);
      ch.applyInput({ moveX: 0, jump: false, attackHeavy: true }); // charge
      ch.applyInput({ moveX: 0, jump: false, attackHeavy: false }); // release → fire
      runFrames(ch, WOLF_SMASH.startupFrames, () => false);
      const hb = liveHitbox(m)!;
      return (hb.options['plugin'] as { moveId: string }).moveId;
    })();
    const airAttack = (() => {
      const m = createMockScene();
      const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
      // Airborne (no ground contact emitted).
      ch.applyInput({ moveX: 0, jump: false, attack: true });
      runFrames(ch, WOLF_NAIR.startupFrames, () => false);
      const hb = liveHitbox(m)!;
      return (hb.options['plugin'] as { moveId: string }).moveId;
    })();
    expect(groundedAttack).toBe(WOLF_JAB.id);
    expect(groundedHeavy).toBe(WOLF_SMASH.id);
    expect(airAttack).toBe(WOLF_NAIR.id);
  });

  it('damage payload differs across light / heavy / aerial connects', () => {
    // The hitbox plugin carries the move's damage value verbatim — the
    // damage handler reads it directly without re-looking-up the move.
    // We assert each variant carries the right damage so the (later AC)
    // collision pipeline produces distinct percent jumps.
    const grabHitboxDamage = (
      ch: Wolf,
      m: ReturnType<typeof createMockScene>,
      startupFrames: number,
    ): number => {
      runFrames(ch, startupFrames, () => false);
      const hb = liveHitbox(m)!;
      return (hb.options['plugin'] as { damage: number }).damage;
    };

    {
      const m = createMockScene();
      const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
      ground(ch, m);
      ch.applyInput({ moveX: 0, jump: false, attack: true });
      expect(grabHitboxDamage(ch, m, WOLF_JAB.startupFrames)).toBe(WOLF_JAB.damage);
    }
    {
      const m = createMockScene();
      const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
      ground(ch, m);
      // Charge + immediate release → uncharged smash spawns at base damage
      // (the charge ramp's minDamage equals the move's authored damage).
      ch.applyInput({ moveX: 0, jump: false, attackHeavy: true });
      ch.applyInput({ moveX: 0, jump: false, attackHeavy: false });
      expect(grabHitboxDamage(ch, m, WOLF_SMASH.startupFrames)).toBe(WOLF_SMASH.damage);
    }
    {
      const m = createMockScene();
      const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
      // Airborne by default — no ground contact emitted.
      ch.applyInput({ moveX: 0, jump: false, attack: true });
      expect(grabHitboxDamage(ch, m, WOLF_NAIR.startupFrames)).toBe(WOLF_NAIR.damage);
    }
  });

  it('a heavy press during hitstun is suppressed (input lockout includes attackHeavy)', () => {
    // Same contract as the existing "attack press during hitstun is
    // suppressed" test — the heavy button is a player input and must
    // be ignored while the fighter is locked out. Post-M2 hit-feel
    // pass: the lockout now includes the hitlag freeze AND the
    // hitstun window that follows it.
    const m = createMockScene();
    const ch = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
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
// AC 60002 Sub-AC 2 — grounded jab / tilt / smash for Wolf, with full
// data and animation states. Locks down:
//   1. Wolf.registerAttack wires up `wolf.tilt` alongside the existing
//      jab and smash, so it's reachable via `attemptAttack(id)`.
//   2. The default light-attack dispatch slot is unaffected (jab still
//      wins because it registers first).
//   3. Pressing the tilt via `attemptAttack` runs the same hitbox/
//      cooldown lifecycle as the other grounded moves.
//   4. The animation block on every grounded move drives the renderer's
//      frame-index selector for the full lifetime of the move (no
//      gameplay frame ever maps to an out-of-bounds art frame).
// ---------------------------------------------------------------------------

describe('Wolf grounded triplet — registration & dispatch (AC 60002 Sub-AC 2)', () => {
  it('Wolf registers `wolf.tilt` so attemptAttack can fire it directly', () => {
    const m = createMockScene();
    const wolf = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    expect(wolf.getAttack(WOLF_TILT.id)).toBe(WOLF_TILT);
  });

  it('jab still owns the auto-light-slot — tilt registers without stealing it', () => {
    // The base class wires the FIRST registered jab/tilt into the light
    // slot. Wolf's constructor registers jab before tilt, so jab keeps
    // the slot. (A future input AC routes a directional press to the
    // tilt explicitly via attemptAttack.)
    const m = createMockScene();
    const wolf = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    expect(wolf.getLightAttackId()).toBe(WOLF_JAB.id);
    expect(wolf.getHeavyAttackId()).toBe(WOLF_SMASH.id);
    expect(wolf.getAerialAttackId()).toBe(WOLF_NAIR.id);
  });

  it('attemptAttack(\'wolf.tilt\') drives the same hitbox lifecycle as jab/smash', () => {
    const m = createMockScene();
    const wolf = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    ground(wolf, m);

    // Kick off the tilt directly. Cooldown is 0, no other attack live.
    expect(wolf.attemptAttack(WOLF_TILT.id)).toBe(true);
    expect(wolf.getActiveAttack()!.move.id).toBe(WOLF_TILT.id);

    // Advance through the full startup → active transition; the hitbox
    // sensor body must spawn with the tilt's plugin payload.
    runFrames(wolf, WOLF_TILT.startupFrames, () => false);
    const hb = liveHitbox(m);
    expect(hb).not.toBeNull();
    const plugin = hb!.options['plugin'] as Record<string, unknown>;
    expect(plugin['ownerId']).toBe('wolf');
    expect(plugin['moveId']).toBe(WOLF_TILT.id);
    expect(plugin['damage']).toBe(WOLF_TILT.damage);
    expect(plugin['knockback']).toEqual(WOLF_TILT.knockback);

    // Hitbox geometry mirrors the tilt's authored width/height.
    expect(hb!.options['_w']).toBe(WOLF_TILT.hitbox.width);
    expect(hb!.options['_h']).toBe(WOLF_TILT.hitbox.height);

    // Ride out the rest of the move — the hitbox is despawned by the
    // active → recovery transition.
    runFrames(wolf, WOLF_TILT.activeFrames, () => false);
    expect(liveHitbox(m)).toBeNull();
  });

  it('full grounded-triplet press-to-press lockouts widen with damage', () => {
    // Lockout (busy + cooldown) must monotonically increase from jab
    // through tilt to smash — the canonical "more power costs more
    // commitment" trade-off. Tests the data table's internal
    // consistency without instantiating a fighter.
    const lockout = (m: AttackMove): number =>
      m.startupFrames + m.activeFrames + m.recoveryFrames + m.cooldownFrames;
    expect(lockout(WOLF_JAB)).toBeLessThan(lockout(WOLF_TILT));
    expect(lockout(WOLF_TILT)).toBeLessThan(lockout(WOLF_SMASH));
  });
});

describe('Wolf grounded triplet — animation state machine (AC 60002 Sub-AC 2)', () => {
  it('selectAnimationFrame walks every gameplay frame of the jab cleanly', () => {
    // Sweep the jab from frame 0 through the busy total. For every
    // frame, the selector must agree with computeAttackPhase on which
    // phase we're in, AND must hand back a valid art-frame index
    // bounded by the move's per-phase art frame count.
    const total =
      WOLF_JAB.startupFrames + WOLF_JAB.activeFrames + WOLF_JAB.recoveryFrames;
    for (let f = 0; f < total; f += 1) {
      const sel = selectAnimationFrame(f, WOLF_JAB);
      expect(sel.phase).toBe(computeAttackPhase(f, WOLF_JAB));
      const anim = WOLF_JAB.animation!;
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
    expect(selectAnimationFrame(total, WOLF_JAB)).toEqual({
      phase: 'done',
      artFrameIndex: 0,
    });
  });

  it('selectAnimationFrame walks every gameplay frame of the tilt cleanly', () => {
    const total =
      WOLF_TILT.startupFrames + WOLF_TILT.activeFrames + WOLF_TILT.recoveryFrames;
    for (let f = 0; f < total; f += 1) {
      const sel = selectAnimationFrame(f, WOLF_TILT);
      expect(sel.phase).toBe(computeAttackPhase(f, WOLF_TILT));
      const anim = WOLF_TILT.animation!;
      const cap =
        sel.phase === 'startup'
          ? anim.startupFrames
          : sel.phase === 'active'
            ? anim.activeFrames
            : anim.recoveryFrames;
      expect(sel.artFrameIndex).toBeGreaterThanOrEqual(0);
      expect(sel.artFrameIndex).toBeLessThan(cap);
    }
    expect(selectAnimationFrame(total, WOLF_TILT).phase).toBe('done');
  });

  it('selectAnimationFrame walks every gameplay frame of the smash cleanly', () => {
    const total =
      WOLF_SMASH.startupFrames +
      WOLF_SMASH.activeFrames +
      WOLF_SMASH.recoveryFrames;
    for (let f = 0; f < total; f += 1) {
      const sel = selectAnimationFrame(f, WOLF_SMASH);
      expect(sel.phase).toBe(computeAttackPhase(f, WOLF_SMASH));
      const anim = WOLF_SMASH.animation!;
      const cap =
        sel.phase === 'startup'
          ? anim.startupFrames
          : sel.phase === 'active'
            ? anim.activeFrames
            : anim.recoveryFrames;
      expect(sel.artFrameIndex).toBeGreaterThanOrEqual(0);
      expect(sel.artFrameIndex).toBeLessThan(cap);
    }
    expect(selectAnimationFrame(total, WOLF_SMASH).phase).toBe('done');
  });

  it('every art-frame index along the move is reached at least once', () => {
    // The stretch math is "art frame i shows during gameplay frames
    // [i * gameplay / art, (i+1) * gameplay / art)". When art ≤ gameplay
    // for each phase (verified separately), every art frame index in
    // [0, artCount) MUST be visited at least once during a full sweep.
    // This is the strongest determinism guarantee for the renderer:
    // the artist authors N frames, and the engine displays all N.
    for (const move of [WOLF_JAB, WOLF_TILT, WOLF_SMASH]) {
      const total =
        move.startupFrames + move.activeFrames + move.recoveryFrames;
      const seen = new Map<string, Set<number>>();
      for (let f = 0; f < total; f += 1) {
        const sel = selectAnimationFrame(f, move);
        if (sel.phase === 'done') continue;
        const key = sel.phase;
        if (!seen.has(key)) seen.set(key, new Set());
        seen.get(key)!.add(sel.artFrameIndex);
      }
      const anim = move.animation!;
      // Each phase saw exactly its declared number of distinct art frames.
      expect(seen.get('startup')!.size).toBe(anim.startupFrames);
      expect(seen.get('active')!.size).toBe(anim.activeFrames);
      expect(seen.get('recovery')!.size).toBe(anim.recoveryFrames);
    }
  });

  it('art-frame transitions advance monotonically within each phase', () => {
    // Within a phase, the art-frame index never decreases — the swing
    // animation reads forward in time. (Across phases the index resets
    // to 0 because each phase has its own art-frame sequence.)
    for (const move of [WOLF_JAB, WOLF_TILT, WOLF_SMASH]) {
      const total =
        move.startupFrames + move.activeFrames + move.recoveryFrames;
      let prevPhase = '';
      let prevIdx = -1;
      for (let f = 0; f < total; f += 1) {
        const sel = selectAnimationFrame(f, move);
        if (sel.phase !== prevPhase) {
          // Phase change — art index resets to whatever the start of
          // the new phase is (always 0 for the first frame in the phase).
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
// AC 60003 Sub-AC 3 — grounded jab / tilt / smash for Cat, with full
// data and animation states. Mirrors the Wolf block above (AC 60002
// Sub-AC 2) so the second playable character ships the same grounded
// triplet contract:
//   1. Cat.registerAttack wires up `cat.tilt` alongside the existing
//      jab and smash, so it's reachable via `attemptAttack(id)`.
//   2. The default light-attack dispatch slot is unaffected (jab still
//      wins because it registers first).
//   3. Pressing the tilt via `attemptAttack` runs the same hitbox/
//      cooldown lifecycle as the other grounded moves — Cat's body
//      width and faster frame budget produce the right hitbox on the
//      right frame.
//   4. The animation block on every grounded move drives the renderer's
//      frame-index selector for the full lifetime of the move (no
//      gameplay frame ever maps to an out-of-bounds art frame).
// ---------------------------------------------------------------------------

describe('Cat grounded triplet — registration & dispatch (AC 60003 Sub-AC 3)', () => {
  it('Cat registers `cat.tilt` so attemptAttack can fire it directly', () => {
    const m = createMockScene();
    const cat = new Cat(m.scene, { spawnX: 0, spawnY: 0 });
    expect(cat.getAttack(CAT_TILT.id)).toBe(CAT_TILT);
  });

  it('jab still owns the auto-light-slot — tilt registers without stealing it', () => {
    // The base class wires the FIRST registered jab/tilt into the light
    // slot. Cat's constructor registers jab before tilt, so jab keeps
    // the slot. (A future input AC routes a directional press to the
    // tilt explicitly via attemptAttack.)
    const m = createMockScene();
    const cat = new Cat(m.scene, { spawnX: 0, spawnY: 0 });
    expect(cat.getLightAttackId()).toBe(CAT_JAB.id);
    expect(cat.getHeavyAttackId()).toBe(CAT_SMASH.id);
    expect(cat.getAerialAttackId()).toBe(CAT_NAIR.id);
  });

  it("attemptAttack('cat.tilt') drives the same hitbox lifecycle as jab/smash", () => {
    const m = createMockScene();
    const cat = new Cat(m.scene, { spawnX: 0, spawnY: 0 });
    ground(cat, m);

    // Kick off the tilt directly. Cooldown is 0, no other attack live.
    expect(cat.attemptAttack(CAT_TILT.id)).toBe(true);
    expect(cat.getActiveAttack()!.move.id).toBe(CAT_TILT.id);

    // Advance through the full startup → active transition; the hitbox
    // sensor body must spawn with the tilt's plugin payload.
    runFrames(cat, CAT_TILT.startupFrames, () => false);
    const hb = liveHitbox(m);
    expect(hb).not.toBeNull();
    const plugin = hb!.options['plugin'] as Record<string, unknown>;
    expect(plugin['ownerId']).toBe('cat');
    expect(plugin['moveId']).toBe(CAT_TILT.id);
    expect(plugin['damage']).toBe(CAT_TILT.damage);
    expect(plugin['knockback']).toEqual(CAT_TILT.knockback);

    // Hitbox geometry mirrors the tilt's authored width/height.
    expect(hb!.options['_w']).toBe(CAT_TILT.hitbox.width);
    expect(hb!.options['_h']).toBe(CAT_TILT.hitbox.height);

    // Ride out the rest of the move — the hitbox is despawned by the
    // active → recovery transition.
    runFrames(cat, CAT_TILT.activeFrames, () => false);
    expect(liveHitbox(m)).toBeNull();
  });

  it('full grounded-triplet press-to-press lockouts widen with damage', () => {
    // Lockout (busy + cooldown) must monotonically increase from jab
    // through tilt to smash — the canonical "more power costs more
    // commitment" trade-off. Tests the data table's internal
    // consistency without instantiating a fighter.
    const lockout = (m: AttackMove): number =>
      m.startupFrames + m.activeFrames + m.recoveryFrames + m.cooldownFrames;
    expect(lockout(CAT_JAB)).toBeLessThan(lockout(CAT_TILT));
    expect(lockout(CAT_TILT)).toBeLessThan(lockout(CAT_SMASH));
  });

  it('Cat grounded triplet is faster across the board than Wolf grounded triplet', () => {
    // Ninja-vs-bruiser archetype: every grounded move on Cat must have
    // a startup ≤ Wolf's matching move. The damage gradient asymmetry
    // is intentional (Wolf hits harder) but the speed asymmetry is
    // *also* intentional — a balance pass that flattens this should
    // fail loudly here.
    expect(CAT_JAB.startupFrames).toBeLessThanOrEqual(WOLF_JAB.startupFrames);
    expect(CAT_TILT.startupFrames).toBeLessThanOrEqual(WOLF_TILT.startupFrames);
    expect(CAT_SMASH.startupFrames).toBeLessThanOrEqual(WOLF_SMASH.startupFrames);
  });
});

describe('Cat grounded triplet — animation state machine (AC 60003 Sub-AC 3)', () => {
  it('selectAnimationFrame walks every gameplay frame of the jab cleanly', () => {
    // Sweep the jab from frame 0 through the busy total. For every
    // frame, the selector must agree with computeAttackPhase on which
    // phase we're in, AND must hand back a valid art-frame index
    // bounded by the move's per-phase art frame count.
    const total =
      CAT_JAB.startupFrames + CAT_JAB.activeFrames + CAT_JAB.recoveryFrames;
    for (let f = 0; f < total; f += 1) {
      const sel = selectAnimationFrame(f, CAT_JAB);
      expect(sel.phase).toBe(computeAttackPhase(f, CAT_JAB));
      const anim = CAT_JAB.animation!;
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
    expect(selectAnimationFrame(total, CAT_JAB)).toEqual({
      phase: 'done',
      artFrameIndex: 0,
    });
  });

  it('selectAnimationFrame walks every gameplay frame of the tilt cleanly', () => {
    const total =
      CAT_TILT.startupFrames + CAT_TILT.activeFrames + CAT_TILT.recoveryFrames;
    for (let f = 0; f < total; f += 1) {
      const sel = selectAnimationFrame(f, CAT_TILT);
      expect(sel.phase).toBe(computeAttackPhase(f, CAT_TILT));
      const anim = CAT_TILT.animation!;
      const cap =
        sel.phase === 'startup'
          ? anim.startupFrames
          : sel.phase === 'active'
            ? anim.activeFrames
            : anim.recoveryFrames;
      expect(sel.artFrameIndex).toBeGreaterThanOrEqual(0);
      expect(sel.artFrameIndex).toBeLessThan(cap);
    }
    expect(selectAnimationFrame(total, CAT_TILT).phase).toBe('done');
  });

  it('selectAnimationFrame walks every gameplay frame of the smash cleanly', () => {
    const total =
      CAT_SMASH.startupFrames +
      CAT_SMASH.activeFrames +
      CAT_SMASH.recoveryFrames;
    for (let f = 0; f < total; f += 1) {
      const sel = selectAnimationFrame(f, CAT_SMASH);
      expect(sel.phase).toBe(computeAttackPhase(f, CAT_SMASH));
      const anim = CAT_SMASH.animation!;
      const cap =
        sel.phase === 'startup'
          ? anim.startupFrames
          : sel.phase === 'active'
            ? anim.activeFrames
            : anim.recoveryFrames;
      expect(sel.artFrameIndex).toBeGreaterThanOrEqual(0);
      expect(sel.artFrameIndex).toBeLessThan(cap);
    }
    expect(selectAnimationFrame(total, CAT_SMASH).phase).toBe('done');
  });

  it('every art-frame index along the move is reached at least once', () => {
    // The stretch math is "art frame i shows during gameplay frames
    // [i * gameplay / art, (i+1) * gameplay / art)". When art ≤ gameplay
    // for each phase (verified separately), every art frame index in
    // [0, artCount) MUST be visited at least once during a full sweep.
    // This is the strongest determinism guarantee for the renderer:
    // the artist authors N frames, and the engine displays all N.
    for (const move of [CAT_JAB, CAT_TILT, CAT_SMASH]) {
      const total =
        move.startupFrames + move.activeFrames + move.recoveryFrames;
      const seen = new Map<string, Set<number>>();
      for (let f = 0; f < total; f += 1) {
        const sel = selectAnimationFrame(f, move);
        if (sel.phase === 'done') continue;
        const key = sel.phase;
        if (!seen.has(key)) seen.set(key, new Set());
        seen.get(key)!.add(sel.artFrameIndex);
      }
      const anim = move.animation!;
      // Each phase saw exactly its declared number of distinct art frames.
      expect(seen.get('startup')!.size).toBe(anim.startupFrames);
      expect(seen.get('active')!.size).toBe(anim.activeFrames);
      expect(seen.get('recovery')!.size).toBe(anim.recoveryFrames);
    }
  });

  it('art-frame transitions advance monotonically within each phase', () => {
    // Within a phase, the art-frame index never decreases — the swing
    // animation reads forward in time. (Across phases the index resets
    // to 0 because each phase has its own art-frame sequence.)
    for (const move of [CAT_JAB, CAT_TILT, CAT_SMASH]) {
      const total =
        move.startupFrames + move.activeFrames + move.recoveryFrames;
      let prevPhase = '';
      let prevIdx = -1;
      for (let f = 0; f < total; f += 1) {
        const sel = selectAnimationFrame(f, move);
        if (sel.phase !== prevPhase) {
          // Phase change — art index resets to whatever the start of
          // the new phase is (always 0 for the first frame in the phase).
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
// runtime are exercised for the whole roster, not just Wolf.
// ---------------------------------------------------------------------------

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
      const window = ch.getActiveAttack()!.move.startupFrames;
      for (
        let i = 0;
        i < 40 &&
        ch.getActiveAttack() !== null &&
        ch.getActiveAttack()!.framesElapsed < window;
        i += 1
      ) {
        ch.applyInput({ moveX: 0, jump: false, attack: false });
      }
      ch.applyInput({ moveX: 0, jump: false, attack: true });
    };

    ch.applyInput({ moveX: 0, jump: false, attack: true }); // jab1
    expect(ch.getActiveAttack()!.move.id).toBe(`${id}.jab`);
    advanceAndRepress();
    expect(ch.getActiveAttack()!.move.id).toBe(`${id}.jab2`);
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
        expect(hb.offsetX + hb.width / 2).toBeGreaterThanOrEqual(halfBodyW + 12);

        // (2) Bottom edge drops to at least body-centre height (y >= 0), so a
        //     standing opponent's torso is caught — not only an airborne one.
        expect(hb.offsetY + hb.height / 2).toBeGreaterThanOrEqual(0);

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
// (no up-stick) jumps stay instant.
// ---------------------------------------------------------------------------

describe('Tap-jump buffer — up+attack beats the jump', () => {
  const groundedWolf = (): Character => {
    const m = createMockScene();
    const ch = createCharacterById(m.scene, 'wolf', { spawnX: 0, spawnY: 0 });
    ground(ch, m);
    return ch;
  };

  it('a plain jump (no up-stick) still fires instantly', () => {
    const ch = groundedWolf();
    ch.applyInput({ moveX: 0, jump: true });
    expect(ch.getVelocity().y).toBeLessThan(0); // left the ground this frame
  });

  it('an up+jump press is held back, not an instant jump', () => {
    const ch = groundedWolf();
    ch.applyInput({ moveX: 0, moveY: -1, jump: true });
    expect(ch.getVelocity().y).toBeGreaterThanOrEqual(0); // buffered, not jumped
    expect(ch.getActiveAttack()).toBeNull();
  });

  it('up+jump then attack within the window fires the up-attack, NOT a jump', () => {
    const ch = groundedWolf();
    ch.applyInput({ moveX: 0, moveY: -1, jump: true }); // press → buffer
    ch.applyInput({ moveX: 0, moveY: -1, jump: true }); // hold → buffer ticks
    ch.applyInput({ moveX: 0, moveY: -1, jump: true, attack: true }); // attack converts
    expect(ch.getVelocity().y).toBeGreaterThanOrEqual(0); // did NOT jump
    const active = ch.getActiveAttack();
    expect(active).not.toBeNull();
    expect(active!.move.id).toBe(ch.getUpTiltId());
  });

  it('up+jump with no follow-up attack still jumps once the buffer expires', () => {
    const ch = groundedWolf();
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
  const groundedWolf = (): Character => {
    const m = createMockScene();
    const ch = createCharacterById(m.scene, 'wolf', { spawnX: 0, spawnY: 0 });
    ground(ch, m);
    return ch;
  };

  it('an UP-flick (rest → up) + attack fires up-smash (charge, release to fire)', () => {
    const ch = groundedWolf();
    ch.applyInput({ moveX: 0, jump: false }); // stick at rest → prevMoveY latches 0
    ch.applyInput({ moveX: 0, moveY: -1, jump: false, attack: true }); // flick up → up-smash charge
    ch.applyInput({ moveX: 0, moveY: -1, jump: false, attack: false }); // release → fires
    expect(ch.getActiveAttack()?.move.id).toBe(ch.getUpSmashId());
  });

  it('a DOWN-flick (rest → down) + attack fires down-smash (charge, release to fire)', () => {
    const ch = groundedWolf();
    ch.applyInput({ moveX: 0, jump: false });
    ch.applyInput({ moveX: 0, moveY: 1, jump: false, attack: true }); // flick down → down-smash charge
    ch.applyInput({ moveX: 0, moveY: 1, jump: false, attack: false }); // release → fires
    expect(ch.getActiveAttack()?.move.id).toBe(ch.getDownSmashId());
  });

  it('a HELD up-stick + attack stays an up-TILT (a lean is not a flick)', () => {
    const ch = groundedWolf();
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
    const ch = createCharacterById(m.scene, 'wolf', { spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.applyInput({ moveX: 0, moveY: -1, jump: false, special: true });
    expect(ch.getActiveAttack()?.move.id).toBe(ch.getUpSpecialId());
  });
});
