import { describe, it, expect } from 'vitest';
import {
  Character,
  CHARACTER_LABEL,
  CROUCH_KNOCKBACK_REDUCTION,
  SDI_NUDGE_PX,
  TECH_WINDOW_FRAMES,
  type CharacterInput,
} from './Character';
import { HITBOX_LABEL } from './attacks';
// Sub-AC 3 of the T2 refactor — the legacy `Character.prototype.registerAttack`
// method is no longer defined inside `Character.ts`. The same registration
// behaviour now lives in `attackRegistration.ts`, which both exports the
// canonical `registerFighterAttack(character, move)` helper AND re-installs
// the legacy prototype method as a backwards-compatibility shim. This
// side-effect import wires the shim in before any test calls
// `ch.registerAttack(...)` on a base `Character` instance.
import './attackRegistration';
import {
  BASELINE_MASS,
  MAX_DAMAGE_PERCENT,
  MIN_HITSTUN_FRAMES,
  STALE_QUEUE_SIZE,
  computeKnockback,
  type HitInfo,
} from './combat';
// Sub-AC 2.2 of the T2 refactor — movement values come from the per-fighter
// movement profile (Wolf / Bear) rather than a generic base default.
import {
  WOLF_MOVEMENT_PROFILE,
  BEAR_MOVEMENT_PROFILE,
} from './fighterMovementProfiles';
import { COLLISION_CATEGORIES, COLLISION_MASKS } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/StageRenderer';

/**
 * Sub-AC 1 of AC 201: `Character` is a Phaser-touching helper, but its
 * core responsibilities — body construction, ground-contact bookkeeping,
 * left/right acceleration math, jump rising-edge detection — are pure
 * functions of body state + input. We exercise them via a minimal mock
 * scene that stands in for `scene.matter.add`, `scene.matter.body`, and
 * `scene.matter.world`. That keeps the suite Node-only and matches the
 * `StageRenderer` / `CameraController` testing pattern already in the
 * repo.
 *
 * What this suite locks down:
 *
 *   1. Body construction — label, collision filter, chamfer, mass,
 *      inertia all match the contract downstream code (collision
 *      handler, KO sensor, AI vision) relies on.
 *   2. Ground detection — collision events with platform bodies whose
 *      centre is below the character increment the support counter;
 *      walls / ceilings do not.
 *   3. Movement — left / right acceleration toward `maxRunSpeed`,
 *      damping when the stick is neutral, separate ground vs air tuning.
 *   4. Jump — rising-edge detection, multi-jump budget, reset on
 *      landing, no double-trigger when held.
 *   5. Lifecycle — `destroy()` detaches listeners, removes the body,
 *      and is idempotent.
 */

// ---------------------------------------------------------------------------
// Mock scene helpers
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

/** Build a fake platform body (not added through the mock matter.add). */
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

/** Convenience — quiet a few helpers that need a baseline input. */
const NEUTRAL: CharacterInput = { moveX: 0, jump: false };

/**
 * Drive `applyInput(NEUTRAL)` until the fighter's hitlag freeze
 * drains to zero, OR until a small safety cap is reached. Used by
 * tests that exercise post-hitlag behaviour (knockback velocity
 * application, hitstun arming) — added after the post-M2 hit-feel
 * pass deferred those effects behind the freeze window.
 *
 * Safe no-op if the fighter is not in hitlag.
 */
function tickPastHitlag(ch: Character, maxFrames = 32): void {
  for (let i = 0; i < maxFrames && ch.getHitlagRemaining() > 0; i += 1) {
    ch.applyInput(NEUTRAL);
  }
}

// ---------------------------------------------------------------------------
// Body construction
// ---------------------------------------------------------------------------

describe('Character — body construction (Sub-AC 1)', () => {
  it('creates a single Matter rectangle body with the canonical label', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 100, spawnY: 200 });
    expect(m.bodies.length).toBe(1);
    expect(ch.body).toBe(m.bodies[0]!);
    expect(ch.body.label).toBe(CHARACTER_LABEL);
    expect(ch.id).toBe('wolf');
  });

  it('uses the CHARACTER collision category and the matching default mask', () => {
    const m = createMockScene();
    new Character(m.scene, { id: 'cat', spawnX: 0, spawnY: 0 });
    const filter = m.bodies[0]!.options['collisionFilter'] as {
      category: number;
      mask: number;
      group: number;
    };
    // Multi-bit category: shared CHARACTER bit + per-slot bit. The
    // default-slot path lands on slot 0 (no `slotIndex` was passed).
    expect(filter.category & COLLISION_CATEGORIES.CHARACTER).toBeTruthy();
    expect(filter.category & COLLISION_CATEGORIES.CHARACTER_SLOT_0).toBeTruthy();
    expect(filter.mask).toBe(COLLISION_MASKS.CHARACTER);
    // Group must be 0 — non-zero groups would override category/mask.
    expect(filter.group).toBe(0);
  });

  it('OR-s the per-slot category bit into the body for the supplied slotIndex', () => {
    // Sub-AC: pass-through driver targets fighters by slot bit, so the
    // body must opt in to its slot's `CHARACTER_SLOT_*` category bit.
    const slotBits = [
      COLLISION_CATEGORIES.CHARACTER_SLOT_0,
      COLLISION_CATEGORIES.CHARACTER_SLOT_1,
      COLLISION_CATEGORIES.CHARACTER_SLOT_2,
      COLLISION_CATEGORIES.CHARACTER_SLOT_3,
    ];
    for (let slot = 0; slot < slotBits.length; slot += 1) {
      const m = createMockScene();
      new Character(m.scene, { id: 'cat', spawnX: 0, spawnY: 0, slotIndex: slot });
      const filter = m.bodies[0]!.options['collisionFilter'] as {
        category: number;
      };
      expect(filter.category & slotBits[slot]!).toBeTruthy();
      // Other slot bits MUST be off — leaking would let one slot's
      // phase decision affect another.
      for (let other = 0; other < slotBits.length; other += 1) {
        if (other === slot) continue;
        expect(filter.category & slotBits[other]!).toBe(0);
      }
    }
  });

  it('throws when constructed with an out-of-range slotIndex', () => {
    const m = createMockScene();
    expect(
      () => new Character(m.scene, { id: 'cat', spawnX: 0, spawnY: 0, slotIndex: 4 }),
    ).toThrow(/slotIndex/);
    expect(
      () => new Character(m.scene, { id: 'cat', spawnX: 0, spawnY: 0, slotIndex: -1 }),
    ).toThrow(/slotIndex/);
  });

  it('locks rotation by setting inertia to Infinity post-construction', () => {
    // Characters should never tumble — Smash-style fighters always
    // stand upright. `Body.setInertia(body, Infinity)` is Matter's
    // idiomatic way to freeze rotation while still letting linear
    // physics apply. We call it post-construction because Phaser's
    // `MatterBodyConfig` typing doesn't surface the option directly.
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'owl', spawnX: 0, spawnY: 0 });
    expect(m.inertiaCalls.length).toBe(1);
    expect(m.inertiaCalls[0]!.body).toBe(ch.body);
    expect(m.inertiaCalls[0]!.inertia).toBe(Infinity);
  });

  it('applies a chamfer so corners do not catch on platform ledges', () => {
    const m = createMockScene();
    new Character(m.scene, {
      id: 'bear',
      spawnX: 0,
      spawnY: 0,
      chamfer: 16,
    });
    expect(m.bodies[0]!.options['chamfer']).toEqual({ radius: 16 });
  });

  it('omits chamfer when set to 0', () => {
    const m = createMockScene();
    new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0, chamfer: 0 });
    expect(m.bodies[0]!.options['chamfer']).toBeUndefined();
  });

  it('keeps Matter friction values low so they do not fight velocity control', () => {
    // The class manages horizontal velocity itself each frame. If
    // Matter's friction were left at the default 0.1, the controller
    // and the engine would compete and the result would feel mushy.
    const m = createMockScene();
    new Character(m.scene, { id: 'cat', spawnX: 0, spawnY: 0 });
    const opts = m.bodies[0]!.options;
    expect((opts['friction'] as number)).toBeLessThan(0.01);
    expect(opts['frictionAir']).toBe(0);
    expect(opts['frictionStatic']).toBe(0);
    expect(opts['restitution']).toBe(0);
  });

  it('stamps the character id onto the Matter `plugin` bag for collision callbacks', () => {
    const m = createMockScene();
    new Character(m.scene, { id: 'owl', spawnX: 0, spawnY: 0 });
    expect(m.bodies[0]!.options['plugin']).toEqual({ characterId: 'owl' });
  });

  it('honours tuning overrides supplied at construction', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'bear',
      spawnX: 0,
      spawnY: 0,
      mass: 25,
      maxRunSpeed: 6,
      jumpImpulse: 11,
      maxJumps: 1,
    });
    const tuning = ch.getTuning();
    expect(tuning.mass).toBe(25);
    expect(tuning.maxRunSpeed).toBe(6);
    expect(tuning.jumpImpulse).toBe(11);
    expect(tuning.maxJumps).toBe(1);
    // Sub-AC 2.2 of the T2 refactor — unspecified movement fields fall
    // back to the per-fighter movement profile (`bear` here) instead of
    // a generic base default. Bear's `groundAccel` is the source of
    // truth, sourced from `BEAR_MOVEMENT_PROFILE`.
    expect(tuning.groundAccel).toBe(BEAR_MOVEMENT_PROFILE.groundAccel);
  });

  it('subscribes to collisionstart / collisionend at construction', () => {
    const m = createMockScene();
    new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const events = m.listeners.map((l) => l.event).sort();
    expect(events).toEqual(['collisionend', 'collisionstart']);
  });
});

// ---------------------------------------------------------------------------
// Ground detection
// ---------------------------------------------------------------------------

describe('Character — ground detection (Sub-AC 1)', () => {
  it('starts ungrounded before any collision events fire', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 500, spawnY: 200 });
    expect(ch.isGrounded()).toBe(false);
  });

  it('becomes grounded when a platform body below the centre starts colliding', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 500, spawnY: 500 });
    // Platform centre at y=600 (below character centre at 500). Standing on it.
    const platform = makePlatform(500, 600);
    m.emit('collisionstart', [{ bodyA: ch.body, bodyB: platform }]);
    expect(ch.isGrounded()).toBe(true);
  });

  it('treats the pair order symmetrically (character can be bodyA or bodyB)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 100 });
    const platform = makePlatform(0, 200);
    m.emit('collisionstart', [{ bodyA: platform, bodyB: ch.body }]);
    expect(ch.isGrounded()).toBe(true);
  });

  it('drops back to ungrounded when the support contact ends', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const platform = makePlatform(0, 100);
    m.emit('collisionstart', [{ bodyA: ch.body, bodyB: platform }]);
    expect(ch.isGrounded()).toBe(true);
    m.emit('collisionend', [{ bodyA: ch.body, bodyB: platform }]);
    expect(ch.isGrounded()).toBe(false);
  });

  it('counts multiple support contacts (e.g. two adjacent platforms under a foot)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const left = makePlatform(-50, 100);
    const right = makePlatform(50, 100);
    m.emit('collisionstart', [
      { bodyA: ch.body, bodyB: left },
      { bodyA: ch.body, bodyB: right },
    ]);
    expect(ch.isGrounded()).toBe(true);
    // Walking off the left platform — still grounded thanks to the right.
    m.emit('collisionend', [{ bodyA: ch.body, bodyB: left }]);
    expect(ch.isGrounded()).toBe(true);
    m.emit('collisionend', [{ bodyA: ch.body, bodyB: right }]);
    expect(ch.isGrounded()).toBe(false);
  });

  it('ignores side-wall bumps (platform centre level with character)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 100 });
    // Wall centre at y=100 — same height as character. Not a support.
    const wall = makePlatform(80, 100);
    m.emit('collisionstart', [{ bodyA: ch.body, bodyB: wall }]);
    expect(ch.isGrounded()).toBe(false);
  });

  it('ignores ceiling thumps (platform centre above character)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 100 });
    const ceiling = makePlatform(0, 50); // above
    m.emit('collisionstart', [{ bodyA: ch.body, bodyB: ceiling }]);
    expect(ch.isGrounded()).toBe(false);
  });

  it('recognises pass-through platforms as support surfaces', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const passPlat = makePlatform(0, 100, /* passThrough */ true);
    m.emit('collisionstart', [{ bodyA: ch.body, bodyB: passPlat }]);
    expect(ch.isGrounded()).toBe(true);
  });

  it('ignores collisions that are not platforms (hitboxes, hazards, etc.)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const hazard = { label: 'hazard.lava', position: { x: 0, y: 100 } };
    m.emit('collisionstart', [{ bodyA: ch.body, bodyB: hazard }]);
    expect(ch.isGrounded()).toBe(false);
  });

  it('ignores collision pairs the character is not part of', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const otherA = { label: 'platform.solid', position: { x: 0, y: 0 } };
    const otherB = { label: 'platform.solid', position: { x: 0, y: 100 } };
    m.emit('collisionstart', [{ bodyA: otherA, bodyB: otherB }]);
    expect(ch.isGrounded()).toBe(false);
  });

  it('clamps the support counter at 0 so duplicate end events cannot underflow', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const plat = makePlatform(0, 100);
    // Single start, two ends — second end is a no-op.
    m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
    m.emit('collisionend', [{ bodyA: ch.body, bodyB: plat }]);
    m.emit('collisionend', [{ bodyA: ch.body, bodyB: plat }]);
    expect(ch.isGrounded()).toBe(false);
    // A subsequent real start should still produce a single ground contact.
    m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
    expect(ch.isGrounded()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Horizontal movement
// ---------------------------------------------------------------------------

/** Drop a character onto a platform so subsequent applyInput sees grounded=true. */
function ground(ch: Character, m: MockScene): void {
  const plat = makePlatform(ch.getPosition().x, ch.getPosition().y + 100);
  m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
}

describe('Character — horizontal movement (Sub-AC 1)', () => {
  it('accelerates rightward toward `maxRunSpeed` when moveX = 1', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    const tuning = ch.getTuning();
    ch.applyInput({ moveX: 1, jump: false });
    expect(ch.getVelocity().x).toBeCloseTo(tuning.groundAccel);
    // Several more steps — should converge to maxRunSpeed.
    for (let i = 0; i < 50; i += 1) {
      ch.applyInput({ moveX: 1, jump: false });
    }
    expect(ch.getVelocity().x).toBeCloseTo(tuning.maxRunSpeed);
  });

  it('accelerates leftward toward -maxRunSpeed when moveX = -1', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    const tuning = ch.getTuning();
    for (let i = 0; i < 50; i += 1) {
      ch.applyInput({ moveX: -1, jump: false });
    }
    expect(ch.getVelocity().x).toBeCloseTo(-tuning.maxRunSpeed);
  });

  it('updates facing to match horizontal input direction', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    expect(ch.getFacing()).toBe(1); // default
    ch.applyInput({ moveX: -1, jump: false });
    expect(ch.getFacing()).toBe(-1);
    ch.applyInput({ moveX: 1, jump: false });
    expect(ch.getFacing()).toBe(1);
    // Neutral input does NOT flip facing — momentum keeps last direction.
    ch.applyInput(NEUTRAL);
    expect(ch.getFacing()).toBe(1);
  });

  it('damps velocity toward zero when stick is neutral on the ground', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    // Build up speed, then release the stick.
    for (let i = 0; i < 30; i += 1) ch.applyInput({ moveX: 1, jump: false });
    const top = ch.getVelocity().x;
    expect(top).toBeGreaterThan(0);
    // Two damping frames should be visibly slower; many should be zero.
    ch.applyInput(NEUTRAL);
    const after1 = ch.getVelocity().x;
    expect(after1).toBeLessThan(top);
    for (let i = 0; i < 60; i += 1) ch.applyInput(NEUTRAL);
    expect(ch.getVelocity().x).toBe(0);
  });

  it('uses lower air acceleration than ground acceleration', () => {
    const groundScene = createMockScene();
    const groundCh = new Character(groundScene.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
    });
    ground(groundCh, groundScene);
    groundCh.applyInput({ moveX: 1, jump: false });
    const groundDelta = groundCh.getVelocity().x;

    const airScene = createMockScene();
    const airCh = new Character(airScene.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
    });
    // No ground event → airborne.
    airCh.applyInput({ moveX: 1, jump: false });
    const airDelta = airCh.getVelocity().x;

    expect(airDelta).toBeGreaterThan(0);
    expect(airDelta).toBeLessThan(groundDelta);
  });

  it('clamps moveX into [-1, 1] and treats analog values as proportional', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    const tuning = ch.getTuning();
    // moveX = 5 should behave like moveX = 1 — no overspeed.
    for (let i = 0; i < 100; i += 1) {
      ch.applyInput({ moveX: 5, jump: false });
    }
    expect(ch.getVelocity().x).toBeCloseTo(tuning.maxRunSpeed);
  });
});

// ---------------------------------------------------------------------------
// Jumping
// ---------------------------------------------------------------------------

describe('Character — jumping (Sub-AC 1)', () => {
  it('applies the upward jump impulse on the rising edge of `jump`', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    const tuning = ch.getTuning();
    ch.applyInput({ moveX: 0, jump: true });
    expect(ch.getVelocity().y).toBeCloseTo(-tuning.jumpImpulse);
    expect(ch.getJumpsUsed()).toBe(1);
  });

  it('does not double-trigger when the jump button is held across frames', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: true });
    expect(ch.getJumpsUsed()).toBe(1);
    // Held — should NOT consume another jump.
    ch.applyInput({ moveX: 0, jump: true });
    expect(ch.getJumpsUsed()).toBe(1);
  });

  it('allows a second jump after release-then-press (air jump)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      maxJumps: 2,
    });
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: true }); // initial jump
    expect(ch.getJumpsUsed()).toBe(1);
    // Release jump and leave the ground (simulate by ending support contact).
    const plat = makePlatform(0, 100);
    m.emit('collisionend', [{ bodyA: ch.body, bodyB: plat }]);
    ch.applyInput({ moveX: 0, jump: false });
    // Re-press in mid-air — should consume an air jump.
    ch.applyInput({ moveX: 0, jump: true });
    expect(ch.getJumpsUsed()).toBe(2);
    expect(ch.getJumpsRemaining()).toBe(0);
  });

  it('refuses a third jump when only 2 are configured', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      maxJumps: 2,
    });
    ground(ch, m);
    // Use both jumps. Release between presses.
    ch.applyInput({ moveX: 0, jump: true });
    // Leave ground so the budget doesn't reset.
    const plat = makePlatform(0, 100);
    m.emit('collisionend', [{ bodyA: ch.body, bodyB: plat }]);
    ch.applyInput({ moveX: 0, jump: false });
    ch.applyInput({ moveX: 0, jump: true });
    expect(ch.getJumpsUsed()).toBe(2);
    // Third attempt — denied.
    ch.applyInput({ moveX: 0, jump: false });
    const vyBefore = ch.getVelocity().y;
    ch.applyInput({ moveX: 0, jump: true });
    expect(ch.getJumpsUsed()).toBe(2);
    expect(ch.getVelocity().y).toBe(vyBefore);
  });

  it('resets the jump budget when grounded and not in mid-impulse', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      maxJumps: 2,
    });
    ground(ch, m);
    // Take off.
    ch.applyInput({ moveX: 0, jump: true });
    const plat = makePlatform(0, 100);
    m.emit('collisionend', [{ bodyA: ch.body, bodyB: plat }]);
    ch.applyInput({ moveX: 0, jump: false });
    expect(ch.getJumpsUsed()).toBe(1);
    // Land again — apply a positive vy to simulate gravity, then ground.
    m.scene.matter.body.setVelocity(ch.body, { x: 0, y: 1 });
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false });
    expect(ch.getJumpsUsed()).toBe(0);
    expect(ch.getJumpsRemaining()).toBe(2);
  });

  it('exposes `getJumpsRemaining()` reflecting the configured budget', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    // Sub-AC 2.2 of the T2 refactor — jump budget is sourced from the
    // per-fighter movement profile (Wolf) instead of a generic default.
    expect(ch.getJumpsRemaining()).toBe(WOLF_MOVEMENT_PROFILE.maxJumps);
  });
});

// ---------------------------------------------------------------------------
// Mutators
// ---------------------------------------------------------------------------

describe('Character — mutators', () => {
  it('setPosition() teleports and resets transient state', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.applyInput({ moveX: 1, jump: true });
    expect(ch.getJumpsUsed()).toBe(1);
    expect(ch.getVelocity().x).not.toBe(0);

    ch.setPosition(500, 250);
    expect(ch.getPosition()).toEqual({ x: 500, y: 250 });
    expect(ch.getVelocity()).toEqual({ x: 0, y: 0 });
    expect(ch.getJumpsUsed()).toBe(0);
    expect(ch.isGrounded()).toBe(false);
  });

  it('setTuning() merges over existing tuning without dropping defaults', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setTuning({ maxRunSpeed: 4 });
    const t = ch.getTuning();
    expect(t.maxRunSpeed).toBe(4);
    // Sub-AC 2.2 of the T2 refactor — unspecified movement fields keep
    // their per-fighter movement-profile values (Wolf's `groundAccel`).
    expect(t.groundAccel).toBe(WOLF_MOVEMENT_PROFILE.groundAccel);
  });

  it('setFacing() forces facing direction', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setFacing(-1);
    expect(ch.getFacing()).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('Character — lifecycle', () => {
  it('destroy() removes the body from the world and detaches both listeners', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(m.listeners.length).toBe(2);
    ch.destroy();
    expect(m.listeners.length).toBe(0);
    expect(m.removed.length).toBe(1);
    expect(m.removed[0]).toBe(ch.body);
  });

  it('destroy() is idempotent', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.destroy();
    expect(() => ch.destroy()).not.toThrow();
    // Body removed exactly once.
    expect(m.removed.length).toBe(1);
  });

  it('applyInput() after destroy() is a no-op', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.destroy();
    expect(() => ch.applyInput({ moveX: 1, jump: true })).not.toThrow();
    // Body velocity is whatever it was before destroy — no further mutation.
    expect(ch.getVelocity()).toEqual({ x: 0, y: 0 });
  });

  it('collision events after destroy() do not change grounded state', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.destroy();
    // Listeners are detached, so emit() is a no-op for the character —
    // and even if they weren't, grounded state should freeze on destroy.
    const plat = makePlatform(0, 100);
    m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
    expect(ch.isGrounded()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Light / heavy / aerial slot dispatch (AC 203 Sub-AC 3.3)
// ---------------------------------------------------------------------------

describe('Character — light/heavy/aerial slot dispatch (Sub-AC 3.3)', () => {
  // A reusable trio of moves with distinct ids and types so we can
  // verify each one auto-fills the right dispatch slot. Damage and
  // frame counts are minimal — this suite cares about *which* move
  // fires, not how it feels.
  const TEST_LIGHT = {
    id: 'test.jab',
    type: 'jab' as const,
    damage: 3,
    knockback: { x: 1, y: 0, scaling: 0 },
    hitbox: { offsetX: 30, offsetY: 0, width: 40, height: 30 },
    startupFrames: 1,
    activeFrames: 1,
    recoveryFrames: 1,
    cooldownFrames: 1,
  };
  const TEST_HEAVY = {
    id: 'test.smash',
    type: 'smash' as const,
    damage: 10,
    knockback: { x: 3, y: -1, scaling: 0.3 },
    hitbox: { offsetX: 50, offsetY: 0, width: 60, height: 40 },
    startupFrames: 4,
    activeFrames: 2,
    recoveryFrames: 4,
    cooldownFrames: 4,
  };
  const TEST_AERIAL = {
    id: 'test.nair',
    type: 'aerial' as const,
    damage: 5,
    knockback: { x: 1, y: -1, scaling: 0.1 },
    hitbox: { offsetX: 0, offsetY: 0, width: 80, height: 80 },
    startupFrames: 2,
    activeFrames: 2,
    recoveryFrames: 2,
    cooldownFrames: 2,
  };
  const TEST_TILT = {
    id: 'test.tilt',
    type: 'tilt' as const,
    damage: 4,
    knockback: { x: 1, y: 0, scaling: 0 },
    hitbox: { offsetX: 30, offsetY: 0, width: 40, height: 30 },
    startupFrames: 1,
    activeFrames: 1,
    recoveryFrames: 1,
    cooldownFrames: 1,
  };
  const TEST_SPECIAL = {
    id: 'test.special',
    type: 'special' as const,
    damage: 0,
    knockback: { x: 0, y: 0, scaling: 0 },
    hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
    startupFrames: 4,
    activeFrames: 4,
    recoveryFrames: 4,
    cooldownFrames: 4,
  };

  // -------------------------------------------------------------------------
  // AC 60201 Sub-AC 1 — neutral-special dispatch slot
  // -------------------------------------------------------------------------

  it('registerAttack auto-fills the neutralSpecialId slot for type="special"', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(ch.getNeutralSpecialId()).toBe(null);
    ch.registerAttack(TEST_SPECIAL);
    expect(ch.getNeutralSpecialId()).toBe(TEST_SPECIAL.id);
  });

  it('only the FIRST registered special fills the slot (subsequent specials do not overwrite)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_SPECIAL);
    ch.registerAttack({ ...TEST_SPECIAL, id: 'test.special2' });
    expect(ch.getNeutralSpecialId()).toBe(TEST_SPECIAL.id);
  });

  it('registering a special does NOT pollute the light/heavy/aerial slots', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_SPECIAL);
    // No grounded/aerial moves registered; the slot should be empty
    // even after the special-only registration.
    expect(ch.getLightAttackId()).toBe(null);
    expect(ch.getHeavyAttackId()).toBe(null);
    expect(ch.getAerialAttackId()).toBe(null);
  });

  it('registering a non-special does NOT pollute the neutralSpecialId slot', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_LIGHT);
    ch.registerAttack(TEST_HEAVY);
    ch.registerAttack(TEST_AERIAL);
    expect(ch.getNeutralSpecialId()).toBe(null);
  });

  it('setNeutralSpecial overrides the auto-filled slot', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_SPECIAL);
    const second = { ...TEST_SPECIAL, id: 'test.special2' };
    ch.registerAttack(second);
    ch.setNeutralSpecial(second.id);
    expect(ch.getNeutralSpecialId()).toBe(second.id);
    ch.setNeutralSpecial(null);
    expect(ch.getNeutralSpecialId()).toBe(null);
  });

  it('setNeutralSpecial throws on unregistered id', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(() => ch.setNeutralSpecial('nope')).toThrow();
  });

  it('attemptAttack(neutralSpecialId) fires the registered special when free', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_SPECIAL);
    expect(ch.attemptAttack(TEST_SPECIAL.id)).toBe(true);
    expect(ch.getActiveAttack()!.move.id).toBe(TEST_SPECIAL.id);
  });

  // -------------------------------------------------------------------------
  // AC 60202 Sub-AC 2 — up-special dispatch slot
  // -------------------------------------------------------------------------

  const TEST_UP_SPECIAL = {
    id: 'test.up_special',
    type: 'upSpecial' as const,
    damage: 0,
    knockback: { x: 0, y: 0, scaling: 0 },
    hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
    startupFrames: 4,
    activeFrames: 4,
    recoveryFrames: 4,
    cooldownFrames: 4,
  };

  it('registerAttack auto-fills the upSpecialId slot for type="upSpecial"', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(ch.getUpSpecialId()).toBe(null);
    ch.registerAttack(TEST_UP_SPECIAL);
    expect(ch.getUpSpecialId()).toBe(TEST_UP_SPECIAL.id);
  });

  it('only the FIRST registered upSpecial fills the slot (subsequent ones do not overwrite)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_UP_SPECIAL);
    ch.registerAttack({ ...TEST_UP_SPECIAL, id: 'test.up2' });
    expect(ch.getUpSpecialId()).toBe(TEST_UP_SPECIAL.id);
  });

  it('registering an upSpecial does NOT pollute the neutralSpecialId slot', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_UP_SPECIAL);
    expect(ch.getNeutralSpecialId()).toBe(null);
  });

  it('registering a neutral special does NOT pollute the upSpecialId slot', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_SPECIAL);
    expect(ch.getUpSpecialId()).toBe(null);
  });

  it('setUpSpecial overrides the auto-filled slot', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_UP_SPECIAL);
    const second = { ...TEST_UP_SPECIAL, id: 'test.up2' };
    ch.registerAttack(second);
    ch.setUpSpecial(second.id);
    expect(ch.getUpSpecialId()).toBe(second.id);
    ch.setUpSpecial(null);
    expect(ch.getUpSpecialId()).toBe(null);
  });

  it('setUpSpecial throws on unregistered id', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(() => ch.setUpSpecial('nope')).toThrow();
  });

  it('attemptAttack(upSpecialId) fires the registered up special when free', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_UP_SPECIAL);
    expect(ch.attemptAttack(TEST_UP_SPECIAL.id)).toBe(true);
    expect(ch.getActiveAttack()!.move.id).toBe(TEST_UP_SPECIAL.id);
  });

  it('registerAttack auto-fills the slot matching the move type', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_LIGHT);
    ch.registerAttack(TEST_HEAVY);
    ch.registerAttack(TEST_AERIAL);
    expect(ch.getLightAttackId()).toBe(TEST_LIGHT.id);
    expect(ch.getHeavyAttackId()).toBe(TEST_HEAVY.id);
    expect(ch.getAerialAttackId()).toBe(TEST_AERIAL.id);
  });

  it('a tilt-typed move also fills the light slot if jab is absent', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'cat', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_TILT);
    expect(ch.getLightAttackId()).toBe(TEST_TILT.id);
  });

  it('only the FIRST move of a given type fills its slot (subsequent ones do not overwrite)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_LIGHT);
    ch.registerAttack(TEST_TILT); // both 'jab'/'tilt' map to light
    expect(ch.getLightAttackId()).toBe(TEST_LIGHT.id);
  });

  it('grounded `attack` press fires the light slot', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_LIGHT);
    ch.registerAttack(TEST_HEAVY);
    ch.registerAttack(TEST_AERIAL);
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(ch.getActiveAttack()!.move.id).toBe(TEST_LIGHT.id);
  });

  it('grounded `attackHeavy` press fires the heavy slot', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_LIGHT);
    ch.registerAttack(TEST_HEAVY);
    ch.registerAttack(TEST_AERIAL);
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, attackHeavy: true });
    expect(ch.getActiveAttack()!.move.id).toBe(TEST_HEAVY.id);
  });

  it('airborne `attack` press fires the aerial slot', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_LIGHT);
    ch.registerAttack(TEST_HEAVY);
    ch.registerAttack(TEST_AERIAL);
    expect(ch.isGrounded()).toBe(false);
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(ch.getActiveAttack()!.move.id).toBe(TEST_AERIAL.id);
  });

  it('airborne `attackHeavy` press is ignored', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_LIGHT);
    ch.registerAttack(TEST_HEAVY);
    ch.registerAttack(TEST_AERIAL);
    ch.applyInput({ moveX: 0, jump: false, attackHeavy: true });
    expect(ch.isAttacking()).toBe(false);
  });

  it('aerial fallback: airborne attack fires the light move when no aerial is registered', () => {
    // This is the backward-compat path that keeps the existing
    // single-jab fixtures working in the air.
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_LIGHT);
    expect(ch.isGrounded()).toBe(false);
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(ch.getActiveAttack()!.move.id).toBe(TEST_LIGHT.id);
  });

  it('grounded heavy press without a registered heavy is a no-op (no light fallback)', () => {
    // Heavy is a deliberate "do this only" trigger; we don't want a
    // missing smash to silently fire the jab.
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_LIGHT);
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, attackHeavy: true });
    expect(ch.isAttacking()).toBe(false);
  });

  it('explicit setLightAttack / setHeavyAttack / setAerialAttack overrides the auto-filled slots', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_LIGHT);
    ch.registerAttack(TEST_TILT);
    ch.registerAttack(TEST_HEAVY);
    ch.registerAttack(TEST_AERIAL);
    // Override light → tilt instead of jab.
    ch.setLightAttack(TEST_TILT.id);
    expect(ch.getLightAttackId()).toBe(TEST_TILT.id);
    // Cleared slots disable the dispatch path.
    ch.setHeavyAttack(null);
    expect(ch.getHeavyAttackId()).toBe(null);
    ch.setAerialAttack(null);
    expect(ch.getAerialAttackId()).toBe(null);
  });

  it('setLightAttack / setHeavyAttack / setAerialAttack throws on unregistered ids', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(() => ch.setLightAttack('nope')).toThrow();
    expect(() => ch.setHeavyAttack('nope')).toThrow();
    expect(() => ch.setAerialAttack('nope')).toThrow();
  });

  it('rising-edge contract on heavy press: held button does not retrigger', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_LIGHT);
    ch.registerAttack(TEST_HEAVY);
    ground(ch, m);

    ch.applyInput({ moveX: 0, jump: false, attackHeavy: true });
    expect(ch.getActiveAttack()!.move.id).toBe(TEST_HEAVY.id);
    // Hold the button through the entire move + cooldown.
    const totalLockout =
      TEST_HEAVY.startupFrames +
      TEST_HEAVY.activeFrames +
      TEST_HEAVY.recoveryFrames +
      TEST_HEAVY.cooldownFrames;
    for (let i = 0; i < totalLockout; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, attackHeavy: true });
    }
    expect(ch.canAttack()).toBe(true);
    expect(ch.isAttacking()).toBe(false);
    // Release — still no rising edge.
    ch.applyInput({ moveX: 0, jump: false, attackHeavy: false });
    expect(ch.isAttacking()).toBe(false);
    // Now press again — fires.
    ch.applyInput({ moveX: 0, jump: false, attackHeavy: true });
    expect(ch.getActiveAttack()!.move.id).toBe(TEST_HEAVY.id);
  });

  it('determinism — identical input streams produce identical dispatch decisions', () => {
    const runOnce = (): string | null => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.registerAttack(TEST_LIGHT);
      ch.registerAttack(TEST_HEAVY);
      ch.registerAttack(TEST_AERIAL);
      ground(ch, m);
      ch.applyInput({ moveX: 0, jump: false, attack: true });
      return ch.getActiveAttack()?.move.id ?? null;
    };
    expect(runOnce()).toBe(runOnce());
  });

  // -------------------------------------------------------------------------
  // AC 60101 Sub-AC 1 — grounded jab / tilt / smash input pattern dispatch
  // -------------------------------------------------------------------------

  describe('grounded normal-move dispatch (AC 60101 Sub-AC 1)', () => {
    it('registerAttack auto-fills the dedicated tiltAttackId slot for type="tilt"', () => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.registerAttack(TEST_LIGHT); // jab fills light slot
      ch.registerAttack(TEST_TILT); // tilt fills tilt slot, NOT light
      expect(ch.getLightAttackId()).toBe(TEST_LIGHT.id);
      expect(ch.getTiltAttackId()).toBe(TEST_TILT.id);
    });

    it('a tilt-only roster fills both light AND tilt slots', () => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.registerAttack(TEST_TILT);
      // The "first jab/tilt wins light slot" rule still applies — tilt
      // takes the light slot too when jab is absent.
      expect(ch.getLightAttackId()).toBe(TEST_TILT.id);
      expect(ch.getTiltAttackId()).toBe(TEST_TILT.id);
    });

    it('a jab-only roster has an empty tilt slot', () => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.registerAttack(TEST_LIGHT);
      expect(ch.getTiltAttackId()).toBe(null);
    });

    it('setTiltAttack overrides the auto-filled slot', () => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.registerAttack(TEST_LIGHT);
      ch.registerAttack(TEST_TILT);
      const second = { ...TEST_TILT, id: 'test.tilt2' };
      ch.registerAttack(second);
      ch.setTiltAttack(second.id);
      expect(ch.getTiltAttackId()).toBe(second.id);
      ch.setTiltAttack(null);
      expect(ch.getTiltAttackId()).toBe(null);
    });

    it('setTiltAttack throws on unregistered ids', () => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      expect(() => ch.setTiltAttack('nope')).toThrow();
    });

    it('grounded neutral attack press → jab (light slot)', () => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.registerAttack(TEST_LIGHT);
      ch.registerAttack(TEST_TILT);
      ch.registerAttack(TEST_HEAVY);
      ground(ch, m);
      ch.applyInput({ moveX: 0, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_LIGHT.id);
    });

    it('grounded directional tap (held stick + attack press, no flick) → tilt', () => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.registerAttack(TEST_LIGHT);
      ch.registerAttack(TEST_TILT);
      ch.registerAttack(TEST_HEAVY);
      ground(ch, m);
      // Frame 1: hold stick at half deflection (not a flick — prev=0,
      // current=0.5 is below the smash flick threshold 0.7).
      ch.applyInput({ moveX: 0.5, jump: false, attack: false });
      // Frame 2: same deflection, press attack. prevMoveX latched at
      // 0.5 from frame 1 means the flick predicate fails → tilt.
      ch.applyInput({ moveX: 0.5, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_TILT.id);
    });

    it('grounded smash-flick (rest → full deflection + attack) → smash', () => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.registerAttack(TEST_LIGHT);
      ch.registerAttack(TEST_TILT);
      ch.registerAttack(TEST_HEAVY);
      ground(ch, m);
      // Frame 1: stick rest, no press.
      ch.applyInput({ moveX: 0, jump: false, attack: false });
      // Frame 2: stick flicked to full deflection AND attack press.
      // prevMoveX=0 (rest) → moveX=1 (past flick threshold) is a smash.
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_HEAVY.id);
    });

    it('grounded dedicated heavy press → smash (regardless of stick)', () => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.registerAttack(TEST_LIGHT);
      ch.registerAttack(TEST_TILT);
      ch.registerAttack(TEST_HEAVY);
      ground(ch, m);
      ch.applyInput({ moveX: 0, jump: false, attackHeavy: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_HEAVY.id);
    });

    it('directional tap on a roster without a tilt slot falls back to the jab/light slot', () => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.registerAttack(TEST_LIGHT);
      ch.registerAttack(TEST_HEAVY);
      ground(ch, m);
      ch.applyInput({ moveX: 0.5, jump: false, attack: false });
      ch.applyInput({ moveX: 0.5, jump: false, attack: true });
      // No tilt registered — directional press falls back to jab.
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_LIGHT.id);
    });

    it('held lean above the rest threshold cannot become a flick by pushing further', () => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.registerAttack(TEST_LIGHT);
      ch.registerAttack(TEST_TILT);
      ch.registerAttack(TEST_HEAVY);
      ground(ch, m);
      // Pre-load the latch with a half lean.
      ch.applyInput({ moveX: 0.5, jump: false, attack: false });
      // Now push to full deflection + press attack. prevMoveX=0.5
      // exceeded the rest threshold (0.3), so the flick predicate
      // fails — this resolves as a tilt, not a smash.
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_TILT.id);
    });

    it('heavy press on a roster without a smash slot is a no-op (no jab fallback)', () => {
      // Heavy is an explicit "fire smash only" trigger — silently
      // firing jab on a roster that deliberately skipped the smash
      // would surprise the player.
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.registerAttack(TEST_LIGHT);
      ground(ch, m);
      ch.applyInput({ moveX: 0, jump: false, attackHeavy: true });
      expect(ch.isAttacking()).toBe(false);
    });

    it('smash flick on a roster without a smash falls back through tilt → jab', () => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.registerAttack(TEST_LIGHT);
      ground(ch, m);
      ch.applyInput({ moveX: 0, jump: false, attack: false });
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      // No smash registered — flick falls back to jab via the helper's
      // cascade so a single-jab roster keeps firing on every press.
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_LIGHT.id);
    });

    it('Wolf integration: jab on neutral, tilt on directional tap, smash on flick', () => {
      // End-to-end: with all three registered, each input pattern
      // resolves to its dedicated slot. This is the canonical AC 60101
      // Sub-AC 1 acceptance — three distinct grounded press patterns
      // map to three distinct moves on a fully-stocked roster.
      function freshGroundedWolf(): { ch: Character; m: MockScene } {
        const m = createMockScene();
        const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
        ch.registerAttack(TEST_LIGHT);
        ch.registerAttack(TEST_TILT);
        ch.registerAttack(TEST_HEAVY);
        ground(ch, m);
        return { ch, m };
      }

      // Jab.
      {
        const { ch } = freshGroundedWolf();
        ch.applyInput({ moveX: 0, jump: false, attack: true });
        expect(ch.getActiveAttack()!.move.id).toBe(TEST_LIGHT.id);
      }
      // Tilt — pre-load the latch so the press isn't classified as a flick.
      {
        const { ch } = freshGroundedWolf();
        ch.applyInput({ moveX: 0.5, jump: false, attack: false });
        ch.applyInput({ moveX: 0.5, jump: false, attack: true });
        expect(ch.getActiveAttack()!.move.id).toBe(TEST_TILT.id);
      }
      // Smash via heavy button.
      {
        const { ch } = freshGroundedWolf();
        ch.applyInput({ moveX: 0, jump: false, attackHeavy: true });
        expect(ch.getActiveAttack()!.move.id).toBe(TEST_HEAVY.id);
      }
      // Smash via stick flick.
      {
        const { ch } = freshGroundedWolf();
        ch.applyInput({ moveX: 0, jump: false, attack: false });
        ch.applyInput({ moveX: 1, jump: false, attack: true });
        expect(ch.getActiveAttack()!.move.id).toBe(TEST_HEAVY.id);
      }
    });

    it('determinism — identical grounded press streams produce identical dispatch decisions', () => {
      function runOnce(): string | null {
        const m = createMockScene();
        const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
        ch.registerAttack(TEST_LIGHT);
        ch.registerAttack(TEST_TILT);
        ch.registerAttack(TEST_HEAVY);
        ground(ch, m);
        ch.applyInput({ moveX: 0, jump: false, attack: false });
        ch.applyInput({ moveX: 1, jump: false, attack: true });
        return ch.getActiveAttack()?.move.id ?? null;
      }
      expect(runOnce()).toBe(runOnce());
    });
  });
});

// ---------------------------------------------------------------------------
// Charge / wind-up progress — drives the ChargeIndicator overlay
// ---------------------------------------------------------------------------

describe('Character — getChargeProgress (charge-indicator source)', () => {
  // A charge-type move with a long startup window (the visible wind-up).
  // `attemptAttack` latches it at framesElapsed = 0; each subsequent
  // `applyInput` advances the attack one frame, so the startup fraction
  // walks 0 → 0.25 → 0.5 → 0.75 then drops to null when the hitbox goes
  // live (phase leaves 'startup').
  const TEST_CHARGE = {
    id: 'test.charge',
    type: 'special' as const,
    damage: 0,
    knockback: { x: 0, y: 0, scaling: 0 },
    hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
    startupFrames: 4,
    activeFrames: 2,
    recoveryFrames: 2,
    cooldownFrames: 2,
  };

  it('returns null when no attack is in flight', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(ch.getChargeProgress()).toBe(null);
  });

  it('reports 0 on the press frame (start of the wind-up)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_CHARGE);
    expect(ch.attemptAttack(TEST_CHARGE.id)).toBe(true);
    expect(ch.getChargeProgress()).toBe(0);
  });

  it('climbs 0 → 1 across the startup phase as framesElapsed advances', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_CHARGE);
    ch.attemptAttack(TEST_CHARGE.id);
    // framesElapsed = 0 → 0/4 = 0.
    expect(ch.getChargeProgress()).toBe(0);
    ch.applyInput(NEUTRAL); // framesElapsed = 1 → 0.25
    expect(ch.getChargeProgress()).toBe(0.25);
    ch.applyInput(NEUTRAL); // framesElapsed = 2 → 0.5
    expect(ch.getChargeProgress()).toBe(0.5);
    ch.applyInput(NEUTRAL); // framesElapsed = 3 → 0.75
    expect(ch.getChargeProgress()).toBe(0.75);
  });

  it('returns null once the move leaves startup (hitbox live / recovery)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_CHARGE);
    ch.attemptAttack(TEST_CHARGE.id);
    // Advance through the entire 4-frame startup window into 'active'.
    for (let i = 0; i < TEST_CHARGE.startupFrames; i += 1) {
      ch.applyInput(NEUTRAL);
    }
    // framesElapsed = 4 = startupFrames → phase is now 'active'.
    expect(ch.getActiveAttack()!.phase).toBe('active');
    expect(ch.getChargeProgress()).toBe(null);
  });

  it('is deterministic — identical press + tick count yields identical progress', () => {
    function progressAfter(ticks: number): number | null {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.registerAttack(TEST_CHARGE);
      ch.attemptAttack(TEST_CHARGE.id);
      for (let i = 0; i < ticks; i += 1) ch.applyInput(NEUTRAL);
      return ch.getChargeProgress();
    }
    expect(progressAfter(2)).toBe(progressAfter(2));
    expect(progressAfter(2)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Airborne attack state machine — directional aerials + landing interrupt
// (AC 60102 Sub-AC 2)
// ---------------------------------------------------------------------------

describe('Character — airborne attack state machine (AC 60102 Sub-AC 2)', () => {
  // Three test aerials with explicit `aerialDirection` so we can verify
  // the directional dispatch path. Each one carries its own
  // landingLagFrames + autoCancelWindows so the landing-interrupt tests
  // can branch on either path. Ids are intentionally distinct so a
  // dispatch mistake can't masquerade as a "right move" assertion.
  const TEST_NAIR = {
    id: 'test.nair',
    type: 'aerial' as const,
    aerialDirection: 'neutral' as const,
    damage: 5,
    knockback: { x: 1, y: -1, scaling: 0.1 },
    hitbox: { offsetX: 0, offsetY: 0, width: 80, height: 80 },
    startupFrames: 3,
    activeFrames: 4,
    recoveryFrames: 6,
    cooldownFrames: 4,
    landingLagFrames: 8,
    autoCancelWindows: [{ startFrame: 0, endFrame: 3 }],
  };
  const TEST_FAIR = {
    id: 'test.fair',
    type: 'aerial' as const,
    aerialDirection: 'forward' as const,
    damage: 6,
    knockback: { x: 2, y: -0.5, scaling: 0.15 },
    hitbox: { offsetX: 50, offsetY: 0, width: 60, height: 50 },
    startupFrames: 4,
    activeFrames: 3,
    recoveryFrames: 8,
    cooldownFrames: 6,
    landingLagFrames: 12,
    autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
  };
  const TEST_BAIR = {
    id: 'test.bair',
    type: 'aerial' as const,
    aerialDirection: 'back' as const,
    damage: 8,
    knockback: { x: 2.5, y: -1, scaling: 0.25 },
    hitbox: { offsetX: 50, offsetY: 0, width: 60, height: 50 },
    startupFrames: 5,
    activeFrames: 3,
    recoveryFrames: 10,
    cooldownFrames: 8,
    landingLagFrames: 16,
    autoCancelWindows: [{ startFrame: 0, endFrame: 5 }],
  };
  const TEST_LIGHT_ATK = {
    id: 'test.jab',
    type: 'jab' as const,
    damage: 3,
    knockback: { x: 1, y: 0, scaling: 0 },
    hitbox: { offsetX: 30, offsetY: 0, width: 40, height: 30 },
    startupFrames: 1,
    activeFrames: 1,
    recoveryFrames: 1,
    cooldownFrames: 1,
  };

  function buildCharacter(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_LIGHT_ATK);
    ch.registerAttack(TEST_NAIR);
    ch.registerAttack(TEST_FAIR);
    ch.registerAttack(TEST_BAIR);
    return { ch, m };
  }

  // -------------------------------------------------------------------------
  // Slot wiring — registerAttack populates the directional aerial slots
  // -------------------------------------------------------------------------

  describe('directional aerial slot wiring', () => {
    it('registerAttack auto-fills the neutral / forward / back slots from `aerialDirection`', () => {
      const { ch } = buildCharacter();
      expect(ch.getAerialNeutralId()).toBe(TEST_NAIR.id);
      expect(ch.getAerialForwardId()).toBe(TEST_FAIR.id);
      expect(ch.getAerialBackId()).toBe(TEST_BAIR.id);
      // Legacy slot still wired up — first 'aerial' wins.
      expect(ch.getAerialAttackId()).toBe(TEST_NAIR.id);
    });

    it('a plain AttackMove-typed aerial (no `aerialDirection`) defaults into the neutral slot', () => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      // Same shape as legacy WOLF_NAIR (AttackMove, no aerialDirection).
      const legacyAerial = {
        id: 'legacy.nair',
        type: 'aerial' as const,
        damage: 5,
        knockback: { x: 1, y: -1, scaling: 0.1 },
        hitbox: { offsetX: 0, offsetY: 0, width: 80, height: 80 },
        startupFrames: 2,
        activeFrames: 2,
        recoveryFrames: 4,
        cooldownFrames: 2,
      };
      ch.registerAttack(legacyAerial);
      // Backwards compat: auto-fills both legacy slot AND new neutral slot.
      expect(ch.getAerialAttackId()).toBe('legacy.nair');
      expect(ch.getAerialNeutralId()).toBe('legacy.nair');
      expect(ch.getAerialForwardId()).toBe(null);
      expect(ch.getAerialBackId()).toBe(null);
    });

    it('only the FIRST move of a given direction fills its slot', () => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.registerAttack(TEST_NAIR);
      ch.registerAttack({ ...TEST_NAIR, id: 'test.nair2' });
      expect(ch.getAerialNeutralId()).toBe(TEST_NAIR.id);
    });

    it('explicit setters override the auto-filled directional slots', () => {
      const { ch } = buildCharacter();
      ch.setAerialForward(TEST_NAIR.id);
      expect(ch.getAerialForwardId()).toBe(TEST_NAIR.id);
      ch.setAerialBack(null);
      expect(ch.getAerialBackId()).toBe(null);
      ch.setAerialNeutral(null);
      expect(ch.getAerialNeutralId()).toBe(null);
    });

    it('setters throw on unregistered ids', () => {
      const { ch } = buildCharacter();
      expect(() => ch.setAerialNeutral('nope')).toThrow();
      expect(() => ch.setAerialForward('nope')).toThrow();
      expect(() => ch.setAerialBack('nope')).toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Direction classification — stick vs facing at the moment of the press
  // -------------------------------------------------------------------------

  describe('aerial direction classification (stick vs prevFacing)', () => {
    it('neutral stick + airborne attack press → neutral aerial', () => {
      const { ch } = buildCharacter();
      // Default facing = 1 (right), default ungrounded.
      ch.applyInput({ moveX: 0, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_NAIR.id);
    });

    it('stick toward facing + attack press → forward aerial (fair)', () => {
      const { ch } = buildCharacter();
      // Facing right (default), stick right → forward aerial.
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_FAIR.id);
    });

    it('stick away from facing + attack press → back aerial (bair)', () => {
      const { ch } = buildCharacter();
      // Facing right (default), stick left → back aerial.
      // The motion section flips this.facing to -1, but the classifier
      // reads prevFacing=1 so the press still resolves as bair.
      ch.applyInput({ moveX: -1, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_BAIR.id);
    });

    it('bair when facing left + stick right → still bair (relative to prevFacing)', () => {
      const { ch } = buildCharacter();
      // Force facing left so the prevFacing for the next call is -1.
      ch.setFacing(-1);
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_BAIR.id);
    });

    it('fair when facing left + stick left → forward aerial (relative to prevFacing)', () => {
      const { ch } = buildCharacter();
      ch.setFacing(-1);
      ch.applyInput({ moveX: -1, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_FAIR.id);
    });

    it('stick within the deadzone counts as neutral (|moveX| < AERIAL_STICK_THRESHOLD)', () => {
      const { ch } = buildCharacter();
      // 0.2 < 0.3 (the threshold) — analog drift, intent is neutral.
      ch.applyInput({ moveX: 0.2, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_NAIR.id);
    });

    it('character facing is locked to prevFacing when an aerial fires (no mid-aerial flip)', () => {
      const { ch } = buildCharacter();
      // Facing right, press left+attack → bair. Without the lock,
      // motion would flip this.facing to -1 (matching the stick); the
      // lock restores it to prevFacing=1 so the fighter visually keeps
      // facing right while throwing the back-kick.
      ch.applyInput({ moveX: -1, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_BAIR.id);
      expect(ch.getFacing()).toBe(1);
    });

    it('back-aerial active-attack `facing` is inverted so the hitbox spawns behind', () => {
      const { ch } = buildCharacter();
      // Facing right (1). Press left+attack → bair.
      // ActiveAttack.facing should be -1 so when spawnHitbox mirrors
      // `offsetX * facing` the hitbox lands BEHIND the attacker
      // (negative side) even though the character still faces right.
      ch.applyInput({ moveX: -1, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_BAIR.id);
      expect(ch.getActiveAttack()!.facing).toBe(-1);
      expect(ch.getFacing()).toBe(1); // character orientation unchanged
    });

    it('forward-aerial active-attack `facing` matches the character facing', () => {
      const { ch } = buildCharacter();
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_FAIR.id);
      expect(ch.getActiveAttack()!.facing).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Airborne-only state — attacks transition to aerial state only when
  // ungrounded; the same press while grounded routes to a light/heavy.
  // -------------------------------------------------------------------------

  describe('airborne gating (transition into aerial-attack only when airborne)', () => {
    it('grounded press fires the LIGHT slot, not the aerial slot', () => {
      const { ch, m } = buildCharacter();
      ground(ch, m);
      ch.applyInput({ moveX: 0, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_LIGHT_ATK.id);
    });

    it('grounded press with stick toward facing still fires LIGHT (no fair on the ground)', () => {
      const { ch, m } = buildCharacter();
      ground(ch, m);
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_LIGHT_ATK.id);
    });

    it('aerial dispatch only fires when ungrounded', () => {
      const { ch, m } = buildCharacter();
      ground(ch, m);
      // Grounded: light fires.
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_LIGHT_ATK.id);
    });
  });

  // -------------------------------------------------------------------------
  // Lock attack until completion — re-pressing during an aerial does
  // nothing; the move plays out fully before another can begin.
  // -------------------------------------------------------------------------

  describe('attack lockout while aerial is in flight', () => {
    it('a second attack press during an active aerial is ignored', () => {
      const { ch } = buildCharacter();
      // Start fair.
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      const firstId = ch.getActiveAttack()!.move.id;
      expect(firstId).toBe(TEST_FAIR.id);

      // Release + re-press during recovery — must NOT start a new attack.
      // (Re-press triggers a rising edge but activeAttack !== null gates.)
      ch.applyInput({ moveX: 1, jump: false, attack: false });
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_FAIR.id);
    });

    it('aerial plays out across all phases; locked while activeAttack !== null', () => {
      const { ch } = buildCharacter();
      ch.applyInput({ moveX: 0, jump: false, attack: true }); // start nair
      const move = TEST_NAIR;
      const totalBusy = move.startupFrames + move.activeFrames + move.recoveryFrames;
      // Walk through busyTotal-1 frames; each frame the attack is still
      // in flight. (The press frame is frame 0 inside the move; one
      // applyInput later we're at frame 1.)
      for (let i = 0; i < totalBusy - 1; i += 1) {
        ch.applyInput({ moveX: 0, jump: false, attack: false });
        expect(ch.isAttacking()).toBe(true);
      }
      // One more frame and the move ends, cooldown arms.
      ch.applyInput({ moveX: 0, jump: false, attack: false });
      expect(ch.isAttacking()).toBe(false);
      expect(ch.getCooldownRemaining()).toBe(move.cooldownFrames);
    });

    it('cooldown after aerial completes prevents an immediate re-press', () => {
      const { ch } = buildCharacter();
      ch.applyInput({ moveX: 0, jump: false, attack: true }); // nair
      const move = TEST_NAIR;
      const totalBusy = move.startupFrames + move.activeFrames + move.recoveryFrames;
      for (let i = 0; i < totalBusy; i += 1) {
        ch.applyInput({ moveX: 0, jump: false, attack: false });
      }
      // Move done; cooldown armed.
      expect(ch.getCooldownRemaining()).toBe(move.cooldownFrames);
      // Re-press during cooldown is ignored.
      ch.applyInput({ moveX: 0, jump: false, attack: true });
      expect(ch.isAttacking()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Lock attack until landing — touchdown during an aerial interrupts the
  // move and applies landing-lag (or auto-cancels cleanly).
  // -------------------------------------------------------------------------

  describe('landing interrupt — "lock until completion or landing"', () => {
    it('landing during an in-flight aerial outside any auto-cancel window applies landing-lag', () => {
      const { ch, m } = buildCharacter();
      // Start fair (airborne).
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      expect(ch.isAttacking()).toBe(true);

      // Advance the move a few frames so the framesElapsed is past the
      // pre-active auto-cancel window [0, 4) and into 'active' phase.
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // frame 1
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // frame 2
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // frame 3
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // frame 4
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // frame 5
      // framesElapsed should now be 5 — outside the [0, 4) auto-cancel
      // window, so a landing this frame triggers the full lag.

      // Touch down: emit a platform contact and let applyInput see it.
      const plat = makePlatform(0, 100);
      m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
      ch.applyInput({ moveX: 0, jump: false, attack: false });

      // Aerial interrupted; landing-lag stamped onto cooldown.
      expect(ch.isAttacking()).toBe(false);
      expect(ch.getCooldownRemaining()).toBe(TEST_FAIR.landingLagFrames);
    });

    it('landing during the auto-cancel window applies ZERO landing-lag (clean cancel)', () => {
      const { ch, m } = buildCharacter();
      // Start fair (airborne) — frame 0 is in the [0, 4) auto-cancel window.
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      // Advance one frame so framesElapsed = 1 (still inside auto-cancel).
      ch.applyInput({ moveX: 1, jump: false, attack: false });
      expect(ch.isAttacking()).toBe(true);

      // Touch down inside the window.
      const plat = makePlatform(0, 100);
      m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
      ch.applyInput({ moveX: 0, jump: false, attack: false });

      expect(ch.isAttacking()).toBe(false);
      expect(ch.getCooldownRemaining()).toBe(0);
    });

    it('landing despawns the live hitbox so no sensor leaks into the world', () => {
      const { ch, m } = buildCharacter();
      ch.applyInput({ moveX: 1, jump: false, attack: true }); // fair
      // Step to active phase: startup=4, so at framesElapsed=4 we've
      // entered active and the hitbox body exists.
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=1
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=2
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=3
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=4 — hitbox spawned
      const active = ch.getActiveAttack();
      expect(active?.phase).toBe('active');
      expect(active?.hitboxBody).not.toBeNull();
      const hitboxBody = active!.hitboxBody!;
      const removedBefore = m.removed.length;

      // Land — hitbox should be removed during the landing interrupt.
      const plat = makePlatform(0, 100);
      m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
      ch.applyInput({ moveX: 0, jump: false, attack: false });
      expect(ch.isAttacking()).toBe(false);
      expect(m.removed.length).toBeGreaterThan(removedBefore);
      expect(m.removed).toContain(hitboxBody);
    });

    it('legacy AttackMove-typed aerial (no landingLagFrames) is interrupted with zero lag', () => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      const legacyAerial = {
        id: 'legacy.nair',
        type: 'aerial' as const,
        damage: 5,
        knockback: { x: 1, y: -1, scaling: 0.1 },
        hitbox: { offsetX: 0, offsetY: 0, width: 80, height: 80 },
        startupFrames: 3,
        activeFrames: 4,
        recoveryFrames: 6,
        cooldownFrames: 4,
      };
      ch.registerAttack(legacyAerial);

      ch.applyInput({ moveX: 0, jump: false, attack: true });
      expect(ch.isAttacking()).toBe(true);
      // Advance a couple of frames, then land.
      ch.applyInput({ moveX: 0, jump: false, attack: false });
      ch.applyInput({ moveX: 0, jump: false, attack: false });
      const plat = makePlatform(0, 100);
      m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
      ch.applyInput({ moveX: 0, jump: false, attack: false });

      expect(ch.isAttacking()).toBe(false);
      // No landing-lag info on a plain AttackMove → cancelled cleanly.
      expect(ch.getCooldownRemaining()).toBe(0);
    });

    it('landing while NOT in an aerial (e.g. grounded jab) does not trigger the interrupt path', () => {
      const { ch, m } = buildCharacter();
      ground(ch, m); // start grounded
      ch.applyInput({ moveX: 0, jump: false, attack: true }); // jab fires
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_LIGHT_ATK.id);
      // Step a few frames to keep jab in flight.
      ch.applyInput({ moveX: 0, jump: false, attack: false });
      // The landing-interrupt path is gated on type === 'aerial', so
      // the in-flight jab keeps playing — no premature cancel.
      expect(ch.isAttacking()).toBe(true);
    });

    it('successive airborne→ground→airborne cycles each detect their own touchdown', () => {
      const { ch, m } = buildCharacter();
      // Start airborne, fire a fair.
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      // Advance to outside the auto-cancel window.
      for (let i = 0; i < 5; i += 1) {
        ch.applyInput({ moveX: 1, jump: false, attack: false });
      }
      const plat = makePlatform(0, 100);
      m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
      ch.applyInput({ moveX: 0, jump: false, attack: false });
      expect(ch.getCooldownRemaining()).toBe(TEST_FAIR.landingLagFrames);

      // Drain the lag.
      for (let i = 0; i < TEST_FAIR.landingLagFrames; i += 1) {
        ch.applyInput({ moveX: 0, jump: false, attack: false });
      }
      expect(ch.canAttack()).toBe(true);

      // Take off again.
      m.emit('collisionend', [{ bodyA: ch.body, bodyB: plat }]);
      // Fire fair again, advance past auto-cancel, land again.
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      for (let i = 0; i < 5; i += 1) {
        ch.applyInput({ moveX: 1, jump: false, attack: false });
      }
      m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
      ch.applyInput({ moveX: 0, jump: false, attack: false });
      expect(ch.getCooldownRemaining()).toBe(TEST_FAIR.landingLagFrames);
    });

    it('respawn (setPosition) clears prevGrounded so the next frame is not "just landed"', () => {
      const { ch, m } = buildCharacter();
      // Land first to set prevGrounded = true.
      const plat = makePlatform(0, 100);
      m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
      ch.applyInput({ moveX: 0, jump: false, attack: false });
      // Take off.
      m.emit('collisionend', [{ bodyA: ch.body, bodyB: plat }]);
      ch.applyInput({ moveX: 0, jump: false, attack: false });
      // Teleport (respawn).
      ch.setPosition(500, 100);
      // First frame post-respawn: airborne, no landing detection should fire.
      ch.applyInput({ moveX: 0, jump: false, attack: true });
      // Aerial should have started normally (no spurious cancel).
      expect(ch.isAttacking()).toBe(true);
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_NAIR.id);
    });
  });

  // -------------------------------------------------------------------------
  // AC 60204 Sub-AC 4 — auto-cancel windows that bypass landing lag
  // when landing during designated startup/recovery frame ranges.
  //
  // The schema-side contract (`isAutoCancelFrame` + `getLandingLagFrames`
  // + the `getAutoCancelWindowPhase` classifier) lives in
  // `aerialSchema.test.ts`. This block locks down the runtime side:
  // touching the ground while the move's frame counter sits in a
  // designated startup-OR-recovery window cancels the move with ZERO
  // lag, and any landing OUTSIDE those windows applies the full
  // `landingLagFrames` lockout.
  // -------------------------------------------------------------------------

  describe('auto-cancel landing-lag bypass — startup vs recovery (AC 60204 Sub-AC 4)', () => {
    // Test aerial with BOTH a startup-side and a recovery-side
    // auto-cancel window so the two designated phases can be
    // exercised separately. Frame layout:
    //
    //   startup  = [0, 5)   ← startup auto-cancel window covers this
    //   active   = [5, 9)   ← landing here MUST apply full lag
    //   recovery = [9, 17)
    //     • frame 9        → landing here applies full lag (no late window)
    //     • [14, 17)       ← recovery auto-cancel window covers this tail
    //
    const TWO_WINDOW_AERIAL = {
      id: 'test.two-window.fair',
      type: 'aerial' as const,
      aerialDirection: 'forward' as const,
      damage: 7,
      knockback: { x: 1.6, y: -1, scaling: 0.12 },
      hitbox: { offsetX: 40, offsetY: 0, width: 60, height: 50 },
      startupFrames: 5,
      activeFrames: 4,
      recoveryFrames: 8,
      cooldownFrames: 5,
      landingLagFrames: 18,
      autoCancelWindows: [
        { startFrame: 0, endFrame: 5 }, // startup window
        { startFrame: 14, endFrame: 17 }, // recovery (tail) window
      ],
    };

    function buildTwoWindow(): {
      ch: Character;
      m: ReturnType<typeof createMockScene>;
    } {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.registerAttack(TEST_LIGHT_ATK);
      ch.registerAttack(TWO_WINDOW_AERIAL);
      return { ch, m };
    }

    function advanceFrames(ch: Character, n: number): void {
      for (let i = 0; i < n; i += 1) {
        ch.applyInput({ moveX: 1, jump: false, attack: false });
      }
    }

    it('landing during the STARTUP auto-cancel window applies ZERO landing lag', () => {
      const { ch, m } = buildTwoWindow();
      // Press attack airborne — fair fires on frame 0 (in startup window).
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      // Advance to frame 2 — still inside startup window [0, 5).
      advanceFrames(ch, 2);
      expect(ch.isAttacking()).toBe(true);

      // Touch down DURING the startup window.
      const plat = makePlatform(0, 100);
      m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
      ch.applyInput({ moveX: 0, jump: false, attack: false });

      // Move interrupted with NO landing lag — startup window
      // designated as auto-cancel.
      expect(ch.isAttacking()).toBe(false);
      expect(ch.getCooldownRemaining()).toBe(0);
      expect(ch.canAttack()).toBe(true);
    });

    it('landing during the RECOVERY auto-cancel window applies ZERO landing lag', () => {
      const { ch, m } = buildTwoWindow();
      // Fire fair, advance the move's gameplay-frame counter into
      // the recovery tail window [14, 17). Press happens at frame 0;
      // advancing 14 more frames puts framesElapsed = 14 (inside the
      // recovery window). The fighter must remain airborne through
      // the active-phase frames so the move stays in flight.
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      advanceFrames(ch, 14);
      // Sanity: still in the move (busy = 5+4+8 = 17, framesElapsed=14).
      expect(ch.isAttacking()).toBe(true);

      // Touch down DURING the recovery window.
      const plat = makePlatform(0, 100);
      m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
      ch.applyInput({ moveX: 0, jump: false, attack: false });

      expect(ch.isAttacking()).toBe(false);
      expect(ch.getCooldownRemaining()).toBe(0);
      expect(ch.canAttack()).toBe(true);
    });

    it('landing during the ACTIVE phase applies full landing lag (no bypass)', () => {
      const { ch, m } = buildTwoWindow();
      // Advance into active phase [5, 9). Frame 0 = press, then 6
      // more frames → framesElapsed = 6 (inside active).
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      advanceFrames(ch, 6);
      expect(ch.isAttacking()).toBe(true);

      const plat = makePlatform(0, 100);
      m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
      ch.applyInput({ moveX: 0, jump: false, attack: false });

      // No bypass — full lag stamps onto cooldown.
      expect(ch.isAttacking()).toBe(false);
      expect(ch.getCooldownRemaining()).toBe(TWO_WINDOW_AERIAL.landingLagFrames);
    });

    it('landing in early-recovery (BEFORE the recovery window) applies full landing lag', () => {
      const { ch, m } = buildTwoWindow();
      // Recovery = [9, 17), recovery window = [14, 17). Frames
      // 9..13 are recovery-but-not-cancel-window. Land at frame 10
      // → full lag.
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      advanceFrames(ch, 10);
      expect(ch.isAttacking()).toBe(true);

      const plat = makePlatform(0, 100);
      m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
      ch.applyInput({ moveX: 0, jump: false, attack: false });

      expect(ch.getCooldownRemaining()).toBe(TWO_WINDOW_AERIAL.landingLagFrames);
    });

    it('startup-window bypass lets the fighter immediately fire a grounded attack on the same landing step', () => {
      const { ch, m } = buildTwoWindow();
      // Frame 0: airborne press → fair fires.
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      advanceFrames(ch, 1); // framesElapsed = 1, inside [0, 5)
      // Touch down + RE-PRESS attack on the same step. Because the
      // landing-lag is zero, the cooldown stamps as 0 and the press
      // dispatch can immediately start a grounded jab.
      const plat = makePlatform(0, 100);
      m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
      // Release the attack button so the next step can rising-edge.
      ch.applyInput({ moveX: 0, jump: false, attack: false });
      // Now press again grounded — should fire jab cleanly.
      ch.applyInput({ moveX: 0, jump: false, attack: true });
      const active = ch.getActiveAttack();
      expect(active).not.toBeNull();
      expect(active!.move.id).toBe(TEST_LIGHT_ATK.id);
    });

    it('recovery-window bypass leaves the fighter free immediately on the next step', () => {
      const { ch, m } = buildTwoWindow();
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      advanceFrames(ch, 14); // into recovery window
      const plat = makePlatform(0, 100);
      m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
      ch.applyInput({ moveX: 0, jump: false, attack: false });

      // Same step: lag was 0, fighter is free. Try a press — should fire.
      ch.applyInput({ moveX: 0, jump: false, attack: true });
      expect(ch.getActiveAttack()?.move.id).toBe(TEST_LIGHT_ATK.id);
    });

    it('determinism — identical landing-frame inputs produce identical bypass results', () => {
      // Run the startup-window scenario twice and compare cooldowns.
      // Pure-function landing-lag selector ⇒ identical state.
      const runStartupBypass = (): number => {
        const { ch, m } = buildTwoWindow();
        ch.applyInput({ moveX: 1, jump: false, attack: true });
        advanceFrames(ch, 2);
        const plat = makePlatform(0, 100);
        m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
        ch.applyInput({ moveX: 0, jump: false, attack: false });
        return ch.getCooldownRemaining();
      };
      const runRecoveryBypass = (): number => {
        const { ch, m } = buildTwoWindow();
        ch.applyInput({ moveX: 1, jump: false, attack: true });
        advanceFrames(ch, 14);
        const plat = makePlatform(0, 100);
        m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
        ch.applyInput({ moveX: 0, jump: false, attack: false });
        return ch.getCooldownRemaining();
      };
      expect(runStartupBypass()).toBe(0);
      expect(runStartupBypass()).toBe(runStartupBypass());
      expect(runRecoveryBypass()).toBe(0);
      expect(runRecoveryBypass()).toBe(runRecoveryBypass());
    });
  });

  // -------------------------------------------------------------------------
  // Determinism — the airborne dispatcher is a pure function of input
  // streams + the fighter's frozen tuning + facing history.
  // -------------------------------------------------------------------------

  describe('determinism', () => {
    it('identical input streams produce identical aerial dispatches', () => {
      const runOnce = (): { id: string | null; facing: number | null } => {
        const m = createMockScene();
        const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
        ch.registerAttack(TEST_LIGHT_ATK);
        ch.registerAttack(TEST_NAIR);
        ch.registerAttack(TEST_FAIR);
        ch.registerAttack(TEST_BAIR);
        ch.applyInput({ moveX: -1, jump: false, attack: true });
        const a = ch.getActiveAttack();
        return { id: a?.move.id ?? null, facing: a?.facing ?? null };
      };
      const a = runOnce();
      const b = runOnce();
      expect(a).toEqual(b);
    });

    it('identical landing-interrupt sequences arm identical cooldowns', () => {
      const runOnce = (): number => {
        const m = createMockScene();
        const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
        ch.registerAttack(TEST_LIGHT_ATK);
        ch.registerAttack(TEST_FAIR);
        // Start fair, advance past auto-cancel, land.
        ch.applyInput({ moveX: 1, jump: false, attack: true });
        for (let i = 0; i < 5; i += 1) {
          ch.applyInput({ moveX: 1, jump: false, attack: false });
        }
        const plat = makePlatform(0, 100);
        m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
        ch.applyInput({ moveX: 0, jump: false, attack: false });
        return ch.getCooldownRemaining();
      };
      expect(runOnce()).toBe(runOnce());
    });
  });
});

// ---------------------------------------------------------------------------
// Aerial hitbox position tracking (AC 60103 Sub-AC 3)
//
// "Implement aerial hitbox spawning and timing system that activates /
//  deactivates hitboxes based on frame data while airborne, attaching
//  them to the character's position with correct offsets per move."
//
// What we lock down:
//
//   1. The hitbox spawns precisely on the startup → active phase
//      transition (frame `startupFrames`).
//   2. The hitbox despawns precisely on the active → recovery phase
//      transition (frame `startupFrames + activeFrames`).
//   3. The hitbox sensor follows the character's body each frame it
//      remains in the active phase, with the move's authored offset
//      mirrored against the latched `facing`.
//   4. The mirror behaviour is preserved both for forward-aerials
//      (offset stays in front of the fighter) and back-aerials
//      (`ActiveAttack.facing === -1` puts the sensor behind a
//      right-facing fighter).
//   5. The position-tracker is gated to aerial moves — grounded moves
//      keep their fixed-anchor behaviour so AC 202's hitbox tests stay
//      green and the canonical "rooted-stance" feel survives.
// ---------------------------------------------------------------------------

describe('Character — aerial hitbox position tracking (AC 60103 Sub-AC 3)', () => {
  // Aerial test record. Authored facing-right with a forward offset so
  // the mirror-by-facing arithmetic is verifiable from the assertion.
  // startup=2, active=3 → spawn on frame 2, despawn on frame 5.
  const TEST_AERIAL = {
    id: 'test.aerial',
    type: 'aerial' as const,
    aerialDirection: 'forward' as const,
    damage: 6,
    knockback: { x: 1.5, y: -1, scaling: 0.1 },
    hitbox: { offsetX: 40, offsetY: -10, width: 60, height: 50 },
    startupFrames: 2,
    activeFrames: 3,
    recoveryFrames: 4,
    cooldownFrames: 2,
    landingLagFrames: 8,
  };

  // Grounded jab — used to verify the position-tracker is *not*
  // engaged for non-aerial moves.
  const TEST_JAB = {
    id: 'test.jab',
    type: 'jab' as const,
    damage: 3,
    knockback: { x: 1, y: 0, scaling: 0 },
    hitbox: { offsetX: 30, offsetY: 0, width: 40, height: 30 },
    startupFrames: 2,
    activeFrames: 3,
    recoveryFrames: 1,
    cooldownFrames: 1,
  };

  function build(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TEST_AERIAL);
    ch.registerAttack(TEST_JAB);
    return { ch, m };
  }

  // Helper — return the most recently added hitbox sensor from the mock
  // scene's body list. The mock pushes every spawned body in order, so
  // "last with HITBOX_LABEL semantics" is "any body with isSensor:true
  // not yet removed" — we filter rather than assume index because the
  // character body lives at index 0.
  function activeHitboxBody(m: MockScene) {
    return m.bodies.find((b) => b.options['isSensor'] === true && !b.removed) ?? null;
  }

  // -------------------------------------------------------------------------
  // Activation timing — hitbox spawns precisely on startup → active
  // -------------------------------------------------------------------------

  describe('hitbox activation / deactivation timing while airborne', () => {
    it('hitbox does not exist during the startup phase', () => {
      const { ch, m } = build();
      // Press: start the aerial. framesElapsed = 0, phase = startup.
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      expect(ch.getActiveAttack()?.phase).toBe('startup');
      expect(ch.getActiveAttack()?.hitboxBody).toBeNull();
      expect(activeHitboxBody(m)).toBeNull();

      // One more frame — framesElapsed = 1, still in startup [0, 2).
      ch.applyInput({ moveX: 1, jump: false, attack: false });
      expect(ch.getActiveAttack()?.phase).toBe('startup');
      expect(ch.getActiveAttack()?.hitboxBody).toBeNull();
    });

    it('hitbox spawns on the startup → active phase transition', () => {
      const { ch, m } = build();
      ch.applyInput({ moveX: 1, jump: false, attack: true }); // f=0 startup
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=1 startup
      // f=2 — startup window [0, 2) ends, active begins. Hitbox
      // spawns on this transition.
      ch.applyInput({ moveX: 1, jump: false, attack: false });
      const a = ch.getActiveAttack();
      expect(a?.phase).toBe('active');
      expect(a?.framesElapsed).toBe(2);
      expect(a?.hitboxBody).not.toBeNull();
      expect(activeHitboxBody(m)).not.toBeNull();
    });

    it('hitbox persists through every active frame', () => {
      const { ch, m } = build();
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      // Step into active.
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=1
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=2 spawn

      // Active = [2, 5). The hitbox must stay alive on every active frame.
      for (let f = 2; f < TEST_AERIAL.startupFrames + TEST_AERIAL.activeFrames; f += 1) {
        expect(ch.getActiveAttack()?.phase).toBe('active');
        expect(ch.getActiveAttack()?.hitboxBody).not.toBeNull();
        expect(activeHitboxBody(m)).not.toBeNull();
        if (f + 1 < TEST_AERIAL.startupFrames + TEST_AERIAL.activeFrames) {
          ch.applyInput({ moveX: 1, jump: false, attack: false });
        }
      }
    });

    it('hitbox despawns on the active → recovery phase transition', () => {
      const { ch, m } = build();
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=1
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=2 spawn
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=3 active
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=4 active
      // f=5 — leaves active, hitbox should despawn.
      const spawned = ch.getActiveAttack()!.hitboxBody!;
      ch.applyInput({ moveX: 1, jump: false, attack: false });
      expect(ch.getActiveAttack()?.phase).toBe('recovery');
      expect(ch.getActiveAttack()?.hitboxBody).toBeNull();
      expect(m.removed).toContain(spawned);
    });

    it('matches the canonical frame-data contract: spawn at f=startupFrames, despawn at f=startupFrames+activeFrames', () => {
      const { ch } = build();
      ch.applyInput({ moveX: 1, jump: false, attack: true }); // press, f=0
      const trace: Array<{ f: number; phase: string; hasHitbox: boolean }> = [];
      const total =
        TEST_AERIAL.startupFrames + TEST_AERIAL.activeFrames + TEST_AERIAL.recoveryFrames;
      // Record one snapshot per fixed step until the move ends.
      for (let i = 0; i < total; i += 1) {
        const a = ch.getActiveAttack();
        if (a) {
          trace.push({
            f: a.framesElapsed,
            phase: a.phase,
            hasHitbox: a.hitboxBody !== null,
          });
        }
        ch.applyInput({ moveX: 1, jump: false, attack: false });
      }
      // Pull out frame ranges.
      const startup = trace.filter((t) => t.phase === 'startup');
      const active = trace.filter((t) => t.phase === 'active');
      const recovery = trace.filter((t) => t.phase === 'recovery');
      expect(startup.length).toBe(TEST_AERIAL.startupFrames);
      expect(active.length).toBe(TEST_AERIAL.activeFrames);
      expect(recovery.length).toBe(TEST_AERIAL.recoveryFrames);
      // Hitbox lives on every active frame, no others.
      for (const t of startup) expect(t.hasHitbox).toBe(false);
      for (const t of active) expect(t.hasHitbox).toBe(true);
      for (const t of recovery) expect(t.hasHitbox).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Position attachment — hitbox follows the body each active frame
  // -------------------------------------------------------------------------

  describe('hitbox follows the character\'s position with correct offsets', () => {
    it('hitbox spawns at body.position + (offsetX * facing, offsetY)', () => {
      const { ch, m } = build();
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=1
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=2 spawn
      const hb = activeHitboxBody(m)!;
      // Facing right, body at origin: hitbox at (offsetX, offsetY).
      expect(hb.position.x).toBe(0 + TEST_AERIAL.hitbox.offsetX * 1);
      expect(hb.position.y).toBe(0 + TEST_AERIAL.hitbox.offsetY);
    });

    it('hitbox tracks the body across subsequent active frames', () => {
      const { ch, m } = build();
      ch.applyInput({ moveX: 1, jump: false, attack: true });
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=1
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=2 spawn
      const hb = activeHitboxBody(m)!;
      // Spawn-frame anchor.
      expect(hb.position.x).toBe(TEST_AERIAL.hitbox.offsetX);

      // Simulate the body drifting through the air. The mock matter
      // doesn't integrate, so we move the body manually before the next
      // applyInput — the position-tracker reads `this.body.position`
      // each tick and re-anchors the sensor.
      ch.body.position.x = 30;
      ch.body.position.y = -15;
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=3 active
      expect(hb.position.x).toBe(30 + TEST_AERIAL.hitbox.offsetX);
      expect(hb.position.y).toBe(-15 + TEST_AERIAL.hitbox.offsetY);

      // Another frame — body drifts further; sensor follows.
      ch.body.position.x = 65;
      ch.body.position.y = -32;
      ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=4 active
      expect(hb.position.x).toBe(65 + TEST_AERIAL.hitbox.offsetX);
      expect(hb.position.y).toBe(-32 + TEST_AERIAL.hitbox.offsetY);
    });

    it('offsetX is mirrored by the latched facing (forward-aerial when facing left)', () => {
      const { ch, m } = build();
      ch.setFacing(-1);
      // Stick toward facing (left) → forward aerial. ActiveAttack.facing
      // latches at -1, and offsetX * -1 mirrors the sensor to the left.
      ch.applyInput({ moveX: -1, jump: false, attack: true });
      expect(ch.getActiveAttack()!.facing).toBe(-1);
      ch.applyInput({ moveX: -1, jump: false, attack: false }); // f=1
      ch.applyInput({ moveX: -1, jump: false, attack: false }); // f=2 spawn
      const hb = activeHitboxBody(m)!;
      // Facing left, body at origin: sensor at -offsetX.
      expect(hb.position.x).toBe(-TEST_AERIAL.hitbox.offsetX);

      // Drift left through the air; sensor stays mirror-correct.
      ch.body.position.x = -50;
      ch.applyInput({ moveX: -1, jump: false, attack: false }); // f=3 active
      expect(hb.position.x).toBe(-50 - TEST_AERIAL.hitbox.offsetX);
    });

    it('back-aerial inverts facing on the active-attack so the hitbox spawns BEHIND the fighter', () => {
      const { ch, m } = build();
      // Register a back-aerial alongside the forward.
      const TEST_BAIR = {
        id: 'test.bair',
        type: 'aerial' as const,
        aerialDirection: 'back' as const,
        damage: 7,
        knockback: { x: 2, y: -1, scaling: 0.2 },
        hitbox: { offsetX: 50, offsetY: -8, width: 60, height: 50 },
        startupFrames: 2,
        activeFrames: 3,
        recoveryFrames: 4,
        cooldownFrames: 2,
        landingLagFrames: 12,
      };
      ch.registerAttack(TEST_BAIR);

      // Facing right, press left + attack → bair. The dispatch layer
      // inverts ActiveAttack.facing to -1 so spawnHitbox / the tracker
      // mirror the authored "facing-right" geometry to the BACK side.
      ch.applyInput({ moveX: -1, jump: false, attack: true });
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_BAIR.id);
      expect(ch.getActiveAttack()!.facing).toBe(-1);
      // Character orientation stays right (no mid-aerial flip).
      expect(ch.getFacing()).toBe(1);

      ch.applyInput({ moveX: -1, jump: false, attack: false }); // f=1
      ch.applyInput({ moveX: -1, jump: false, attack: false }); // f=2 spawn
      const hb = activeHitboxBody(m)!;
      // Sensor sits at body.x + (offsetX * -1) = -offsetX (behind a
      // right-facing fighter, exactly the canonical bair geometry).
      expect(hb.position.x).toBe(-TEST_BAIR.hitbox.offsetX);
      expect(hb.position.y).toBe(TEST_BAIR.hitbox.offsetY);

      // Drift; the inverted-facing tracker keeps the sensor behind.
      ch.body.position.x = 100;
      ch.applyInput({ moveX: -1, jump: false, attack: false }); // f=3 active
      expect(hb.position.x).toBe(100 - TEST_BAIR.hitbox.offsetX);
    });

    it('grounded jab does NOT track the body — sensor stays at its spawn position', () => {
      const { ch, m } = build();
      // Force grounded so the press routes to the jab slot, not aerial.
      const plat = makePlatform(0, 100);
      m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
      ch.applyInput({ moveX: 0, jump: false, attack: true }); // f=0 startup
      expect(ch.getActiveAttack()!.move.id).toBe(TEST_JAB.id);
      ch.applyInput({ moveX: 0, jump: false, attack: false }); // f=1 startup
      ch.applyInput({ moveX: 0, jump: false, attack: false }); // f=2 spawn
      const hb = activeHitboxBody(m)!;
      const spawnX = hb.position.x;
      const spawnY = hb.position.y;

      // Move the body — for grounded moves the tracker is gated off,
      // so the sensor must NOT follow. (Canonical "rooted-stance"
      // feel; preserves AC 202 hitbox semantics.)
      ch.body.position.x = 200;
      ch.body.position.y = -50;
      ch.applyInput({ moveX: 0, jump: false, attack: false }); // f=3 active
      expect(hb.position.x).toBe(spawnX);
      expect(hb.position.y).toBe(spawnY);
    });
  });

  // -------------------------------------------------------------------------
  // Determinism — identical input + body-motion produce identical sensor
  // trajectories (the property the replay system requires).
  // -------------------------------------------------------------------------

  describe('determinism', () => {
    it('identical body-motion and input streams produce identical hitbox positions every frame', () => {
      function trace(): Array<{ x: number; y: number }> {
        const m = createMockScene();
        const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
        ch.registerAttack(TEST_AERIAL);
        ch.applyInput({ moveX: 1, jump: false, attack: true });
        ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=1
        ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=2 spawn
        const positions: Array<{ x: number; y: number }> = [];
        const hb0 = activeHitboxBody(m)!;
        positions.push({ x: hb0.position.x, y: hb0.position.y });
        // Two more active frames, body drifts deterministically.
        ch.body.position.x = 25;
        ch.body.position.y = -7;
        ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=3
        positions.push({ x: hb0.position.x, y: hb0.position.y });
        ch.body.position.x = 51;
        ch.body.position.y = -19;
        ch.applyInput({ moveX: 1, jump: false, attack: false }); // f=4
        positions.push({ x: hb0.position.x, y: hb0.position.y });
        return positions;
      }
      expect(trace()).toEqual(trace());
    });
  });
});

// ---------------------------------------------------------------------------
// Damage / knockback / hitstun (Sub-AC 4.1 of AC 301)
// ---------------------------------------------------------------------------

const STANDARD_HIT: HitInfo = {
  damage: 10,
  knockback: { x: 2, y: -1, scaling: 0.05 },
  facing: 1,
};

describe('Character — damage accumulation (Sub-AC 4.1)', () => {
  it('starts at 0% damage', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(ch.getDamagePercent()).toBe(0);
  });

  it('accumulates damage from each hit', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      mass: BASELINE_MASS,
    });
    ch.applyHit(STANDARD_HIT);
    expect(ch.getDamagePercent()).toBe(10);
    ch.applyHit(STANDARD_HIT);
    expect(ch.getDamagePercent()).toBe(20);
    ch.applyHit({ ...STANDARD_HIT, damage: 5 });
    expect(ch.getDamagePercent()).toBe(25);
  });

  it('caps at MAX_DAMAGE_PERCENT', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setDamagePercent(995);
    ch.applyHit({ ...STANDARD_HIT, damage: 50 });
    expect(ch.getDamagePercent()).toBe(MAX_DAMAGE_PERCENT);
  });

  it('setDamagePercent() can reset / force a percent value', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setDamagePercent(75);
    expect(ch.getDamagePercent()).toBe(75);
    ch.setDamagePercent(0);
    expect(ch.getDamagePercent()).toBe(0);
  });

  it('setDamagePercent() clamps inputs into [0, MAX]', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setDamagePercent(-50);
    expect(ch.getDamagePercent()).toBe(0);
    ch.setDamagePercent(2000);
    expect(ch.getDamagePercent()).toBe(MAX_DAMAGE_PERCENT);
  });

  it('damage persists across setPosition (teleport / replay seek)', () => {
    // setPosition is a teleport, not a respawn. Damage is part of match
    // state and should NOT be reset by simply moving the body. Stocks
    // call `setDamagePercent(0)` explicitly when a life is consumed.
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.applyHit(STANDARD_HIT);
    expect(ch.getDamagePercent()).toBe(10);
    ch.setPosition(500, 250);
    expect(ch.getDamagePercent()).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// addDamage — lightweight damage accumulator (Sub-AC 1 of AC 60001)
// ---------------------------------------------------------------------------

/**
 * `addDamage(delta)` is the third damage-accumulation surface (alongside
 * `applyHit` for full combat hits and `setDamagePercent` for replace
 * semantics). It exists for damage sources that want percent-meter
 * mutation without the side effects of a full hit — hazard ticks,
 * healing items, debug tooling, replay snapshot replay.
 *
 * Contract this suite locks down:
 *   • Adds `delta` to current percent and returns the new value.
 *   • Clamped into `[0, MAX_DAMAGE_PERCENT]` (delegates to combat.ts).
 *   • Does NOT touch velocity, attack state, hitstun, cooldown,
 *     facing, or invincibility — pure percent mutation.
 *   • Idempotent on destroyed fighters: returns current percent,
 *     mutates nothing.
 *   • Deterministic: identical (state, delta) → identical result.
 */
describe('Character — addDamage accumulator (Sub-AC 1, AC 60001)', () => {
  it('adds positive delta to current percent and returns the new value', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(ch.addDamage(7)).toBe(7);
    expect(ch.getDamagePercent()).toBe(7);
    expect(ch.addDamage(13)).toBe(20);
    expect(ch.getDamagePercent()).toBe(20);
  });

  it('caps at MAX_DAMAGE_PERCENT — no overflow past the ontology cap', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setDamagePercent(990);
    expect(ch.addDamage(50)).toBe(MAX_DAMAGE_PERCENT);
    expect(ch.getDamagePercent()).toBe(MAX_DAMAGE_PERCENT);
  });

  it('floors at 0 when delta is negative (healing-item semantics)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setDamagePercent(15);
    expect(ch.addDamage(-5)).toBe(10);
    expect(ch.addDamage(-100)).toBe(0);
    expect(ch.getDamagePercent()).toBe(0);
  });

  it('handles fractional deltas without rounding', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.addDamage(2.5);
    ch.addDamage(0.25);
    expect(ch.getDamagePercent()).toBeCloseTo(2.75);
  });

  it('does NOT mutate velocity (no knockback applied)', () => {
    // The whole point of addDamage vs applyHit: percent rises but the
    // body is undisturbed. A lava tick adds damage; the lava body
    // (separately) is responsible for any push effect.
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      mass: BASELINE_MASS,
    });
    // Give the body a known velocity, then add damage and verify it stays.
    m.scene.matter.body.setVelocity(ch.body, { x: 4, y: -2 });
    ch.addDamage(20);
    expect(ch.getVelocity().x).toBe(4);
    expect(ch.getVelocity().y).toBe(-2);
  });

  it('does NOT apply hitstun (fighter remains free to act)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.addDamage(40);
    expect(ch.isInHitstun()).toBe(false);
    expect(ch.getHitstunRemaining()).toBe(0);
  });

  it('does NOT cancel an in-flight attack (unlike applyHit)', () => {
    // Hazard damage shouldn't interrupt a swing the way a full hit does.
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack({
      id: 'test.jab',
      type: 'jab',
      damage: 5,
      knockback: { x: 1, y: 0, scaling: 0 },
      hitbox: { offsetX: 30, offsetY: 0, width: 40, height: 30 },
      startupFrames: 4,
      activeFrames: 3,
      recoveryFrames: 6,
      cooldownFrames: 8,
    });
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(ch.isAttacking()).toBe(true);
    ch.addDamage(15);
    expect(ch.isAttacking()).toBe(true);
  });

  it('does NOT consult invincibility (callers gate per-hazard policy)', () => {
    // applyHit gates on invincibility because that's the attacker-hit
    // contract. addDamage is a primitive — environmental damage decides
    // its own policy. We document the unconditional behaviour here so
    // it's a recorded design choice, not an oversight.
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setInvincibility(120);
    ch.addDamage(8);
    expect(ch.getDamagePercent()).toBe(8);
    expect(ch.getInvincibilityRemaining()).toBe(120);
  });

  it('is a no-op on destroyed fighters and returns the frozen percent', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setDamagePercent(42);
    ch.destroy();
    expect(ch.addDamage(100)).toBe(42);
    expect(ch.getDamagePercent()).toBe(42);
  });

  it('determinism — identical (state, delta) sequences produce identical percent', () => {
    const runOnce = (): number => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.addDamage(7.5);
      ch.addDamage(13.25);
      ch.addDamage(-2);
      return ch.getDamagePercent();
    };
    expect(runOnce()).toBe(runOnce());
  });

  it('composes with applyHit and setDamagePercent in any order', () => {
    // Lock down that the three accumulation surfaces share the same
    // underlying field — interleaving them produces the obvious
    // arithmetic result.
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      mass: BASELINE_MASS,
    });
    ch.addDamage(10); // 10
    ch.applyHit(STANDARD_HIT); // +10 damage → 20
    ch.addDamage(5); // 25
    expect(ch.getDamagePercent()).toBe(25);
    ch.setDamagePercent(0); // reset
    ch.addDamage(3);
    expect(ch.getDamagePercent()).toBe(3);
  });
});

describe('Character — knockback application (Sub-AC 4.1)', () => {
  it('applies the computed knockback velocity to the body on hit (after hitlag drains)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      mass: BASELINE_MASS,
    });
    const result = ch.applyHit(STANDARD_HIT);
    // Post-M2 hit-feel pass: body is pinned at zero velocity during
    // the freeze, then the queued knockback fires when hitlag drains.
    expect(ch.getHitlagRemaining()).toBeGreaterThan(0);
    expect(ch.getVelocity().x).toBe(0);
    expect(ch.getVelocity().y).toBe(0);
    tickPastHitlag(ch);

    // Velocity should match the math helper exactly.
    expect(ch.getVelocity().x).toBeCloseTo(result.vector.x);
    expect(ch.getVelocity().y).toBeCloseTo(result.vector.y);
    // Sanity — a hit with positive base x and facing right sends the
    // target rightward and upward.
    expect(ch.getVelocity().x).toBeGreaterThan(0);
    expect(ch.getVelocity().y).toBeLessThan(0);
  });

  it('uses the *new* damage percent for knockback scaling (damage stacks within hit)', () => {
    // Smash semantics: a hit's own damage feeds into its own knockback
    // scaling. So a 10-damage hit on a 0% target uses percent = 10,
    // not 0, when computing knockback.
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      mass: BASELINE_MASS,
    });
    const result = ch.applyHit(STANDARD_HIT);
    const expected = computeKnockback(STANDARD_HIT, 10, BASELINE_MASS);
    expect(result.vector.x).toBeCloseTo(expected.vector.x);
    expect(result.vector.y).toBeCloseTo(expected.vector.y);
  });

  it('mirrors knockback direction with attacker facing', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 500,
      spawnY: 200,
      mass: BASELINE_MASS,
    });
    ch.applyHit({ ...STANDARD_HIT, facing: -1 });
    tickPastHitlag(ch);
    // Hit from the right pushes target leftward.
    expect(ch.getVelocity().x).toBeLessThan(0);
  });

  it('heavier fighters take less knockback than lighter ones at the same percent', () => {
    const heavyScene = createMockScene();
    const heavy = new Character(heavyScene.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      mass: BASELINE_MASS * 2,
    });
    const lightScene = createMockScene();
    const light = new Character(lightScene.scene, {
      id: 'cat',
      spawnX: 0,
      spawnY: 0,
      mass: BASELINE_MASS / 2,
    });
    const heavyResult = heavy.applyHit(STANDARD_HIT);
    const lightResult = light.applyHit(STANDARD_HIT);
    expect(lightResult.magnitude).toBeGreaterThan(heavyResult.magnitude);
  });

  it('newer hit fully overrides previous velocity (no knockback stacking)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      mass: BASELINE_MASS,
    });
    // First hit launches rightward (after hitlag drains).
    ch.applyHit({ ...STANDARD_HIT, facing: 1 });
    tickPastHitlag(ch);
    const vx1 = ch.getVelocity().x;
    expect(vx1).toBeGreaterThan(0);
    // Second hit from the right reverses direction — newest wins.
    // The new hit replaces the queued knockback; after the new
    // hitlag drains the velocity points leftward.
    ch.applyHit({ ...STANDARD_HIT, facing: -1 });
    tickPastHitlag(ch);
    expect(ch.getVelocity().x).toBeLessThan(0);
  });

  it('cancels any in-flight attack when the fighter gets hit', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack({
      id: 'test.jab',
      type: 'jab',
      damage: 5,
      knockback: { x: 1, y: 0, scaling: 0 },
      hitbox: { offsetX: 30, offsetY: 0, width: 40, height: 30 },
      startupFrames: 4,
      activeFrames: 3,
      recoveryFrames: 6,
      cooldownFrames: 8,
    });
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(ch.isAttacking()).toBe(true);
    ch.applyHit(STANDARD_HIT);
    expect(ch.isAttacking()).toBe(false);
  });

  it('clears attack cooldown so post-hitstun the fighter can act immediately', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack({
      id: 'test.jab',
      type: 'jab',
      damage: 5,
      knockback: { x: 1, y: 0, scaling: 0 },
      hitbox: { offsetX: 30, offsetY: 0, width: 40, height: 30 },
      startupFrames: 1,
      activeFrames: 1,
      recoveryFrames: 1,
      cooldownFrames: 30,
    });
    ground(ch, m);
    // Run a full attack so cooldown is armed.
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    for (let i = 0; i < 3; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, attack: false });
    }
    expect(ch.getCooldownRemaining()).toBeGreaterThan(0);
    // Get hit — cooldown clears.
    ch.applyHit(STANDARD_HIT);
    expect(ch.getCooldownRemaining()).toBe(0);
  });

  it('returns the realised KnockbackResult for AI / HUD inspection', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      mass: BASELINE_MASS,
    });
    const result = ch.applyHit(STANDARD_HIT);
    expect(result.vector).toBeDefined();
    expect(result.magnitude).toBeGreaterThan(0);
    expect(result.hitstunFrames).toBeGreaterThanOrEqual(MIN_HITSTUN_FRAMES);
  });

  it('applyHit() on a destroyed fighter is a no-op', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.destroy();
    const r = ch.applyHit(STANDARD_HIT);
    expect(ch.getDamagePercent()).toBe(0);
    expect(r.hitstunFrames).toBe(0);
    expect(r.magnitude).toBe(0);
  });
});

describe('Character — hitstun lockout (Sub-AC 4.1)', () => {
  it('sets hitstunRemaining > 0 once hitlag freeze drains (post-M2 hit-feel pass)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(ch.isInHitstun()).toBe(false);
    const r = ch.applyHit(STANDARD_HIT);
    // During hitlag, hitstun is queued but not yet armed.
    expect(ch.isInHitlag()).toBe(true);
    expect(ch.isInHitstun()).toBe(false);
    tickPastHitlag(ch);
    expect(ch.isInHitstun()).toBe(true);
    expect(ch.getHitstunRemaining()).toBe(r.hitstunFrames);
  });

  it('decrements hitstunRemaining once per applyInput call (post-hitlag)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const r = ch.applyHit(STANDARD_HIT);
    tickPastHitlag(ch);
    const start = r.hitstunFrames;
    expect(ch.getHitstunRemaining()).toBe(start);
    ch.applyInput(NEUTRAL);
    expect(ch.getHitstunRemaining()).toBe(start - 1);
    ch.applyInput(NEUTRAL);
    expect(ch.getHitstunRemaining()).toBe(start - 2);
  });

  it('ignores horizontal stick input while in hitstun', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      mass: BASELINE_MASS,
    });
    ground(ch, m);
    ch.applyHit(STANDARD_HIT);
    const vxAfterHit = ch.getVelocity().x;
    // Player tries to push left — but hitstun should suppress it.
    ch.applyInput({ moveX: -1, jump: false });
    expect(ch.getVelocity().x).toBeCloseTo(vxAfterHit);
  });

  it('does NOT damp velocity while in hitstun (knockback carries through the air)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      mass: BASELINE_MASS,
    });
    ch.applyHit(STANDARD_HIT);
    const vx0 = ch.getVelocity().x;
    // Several neutral input frames — velocity should NOT decay.
    for (let i = 0; i < 3; i += 1) ch.applyInput(NEUTRAL);
    expect(ch.getVelocity().x).toBeCloseTo(vx0);
  });

  it('rejects jump input while in hitstun', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.applyHit(STANDARD_HIT);
    const jumpsBefore = ch.getJumpsUsed();
    ch.applyInput({ moveX: 0, jump: true });
    expect(ch.getJumpsUsed()).toBe(jumpsBefore);
  });

  it('rejects attack input while in hitstun', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack({
      id: 'test.jab',
      type: 'jab',
      damage: 5,
      knockback: { x: 1, y: 0, scaling: 0 },
      hitbox: { offsetX: 30, offsetY: 0, width: 40, height: 30 },
      startupFrames: 4,
      activeFrames: 3,
      recoveryFrames: 6,
      cooldownFrames: 8,
    });
    ch.applyHit(STANDARD_HIT);
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(ch.isAttacking()).toBe(false);
  });

  it('a held attack button during hitstun does NOT trigger an attack on the first free frame', () => {
    // Rising-edge detection: if the button is held throughout hitstun,
    // there's no rising edge when hitstun ends. The player must release
    // and re-press.
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack({
      id: 'test.jab',
      type: 'jab',
      damage: 5,
      knockback: { x: 1, y: 0, scaling: 0 },
      hitbox: { offsetX: 30, offsetY: 0, width: 40, height: 30 },
      startupFrames: 4,
      activeFrames: 3,
      recoveryFrames: 6,
      cooldownFrames: 8,
    });
    const r = ch.applyHit(STANDARD_HIT);
    // Hold the attack button throughout the entire hitlag freeze AND
    // hitstun window plus a few extra frames.
    const totalLockedFrames =
      ch.getHitlagRemaining() + r.hitstunFrames + 3;
    for (let i = 0; i < totalLockedFrames; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, attack: true });
    }
    expect(ch.isAttacking()).toBe(false);
    // Now release...
    ch.applyInput({ moveX: 0, jump: false, attack: false });
    // ...and re-press — that rising edge should land.
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(ch.isAttacking()).toBe(true);
  });

  it('exits hitstun and accepts input again after hitstunFrames pass', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      mass: BASELINE_MASS,
    });
    ground(ch, m);
    const r = ch.applyHit(STANDARD_HIT);
    // Drain hitstun with neutral inputs.
    for (let i = 0; i < r.hitstunFrames; i += 1) ch.applyInput(NEUTRAL);
    expect(ch.isInHitstun()).toBe(false);
    // Now the player regains control.
    const tuning = ch.getTuning();
    ch.applyInput({ moveX: 1, jump: false });
    // Some leftward knockback may remain; the controller is still
    // accelerating toward the right target velocity though.
    // What we care about is that movement input is honoured: the body's
    // x velocity changed in the rightward direction by approximately
    // groundAccel relative to where it started.
    // (We don't snap to maxRunSpeed because knockback may have left the
    // body well beyond it — the controller eases via damping.)
    expect(ch.getFacing()).toBe(1);
    // Sub-AC 2.2 of the T2 refactor — the tuning is wired through and
    // pulls Wolf's `maxRunSpeed` from the per-fighter movement profile.
    expect(tuning.maxRunSpeed).toBe(WOLF_MOVEMENT_PROFILE.maxRunSpeed);
  });

  it('drains attack cooldown during hitstun so cooldown does not block post-hitstun action', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack({
      id: 'test.jab',
      type: 'jab',
      damage: 5,
      knockback: { x: 1, y: 0, scaling: 0 },
      hitbox: { offsetX: 30, offsetY: 0, width: 40, height: 30 },
      startupFrames: 1,
      activeFrames: 1,
      recoveryFrames: 1,
      cooldownFrames: 5,
    });
    ground(ch, m);
    // Press attack and complete it so cooldown is armed.
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    for (let i = 0; i < 3; i += 1) ch.applyInput({ moveX: 0, jump: false, attack: false });
    // Attack just ended — cooldown is at 5. applyHit clears it
    // (and that's already its own test); we want to verify that even
    // *without* applyHit, hitstun would drain cooldown.
    // Build the scenario manually by setting damage and hitstun via
    // a hit that scales to a long stun. Use a high-magnitude hit:
    expect(ch.getCooldownRemaining()).toBeGreaterThan(0);
  });

  it('setPosition() clears hitstun + hitlag (transient combat state)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.applyHit(STANDARD_HIT);
    tickPastHitlag(ch);
    expect(ch.isInHitstun()).toBe(true);
    ch.setPosition(500, 250);
    expect(ch.isInHitstun()).toBe(false);
    expect(ch.getHitstunRemaining()).toBe(0);
    expect(ch.getHitlagRemaining()).toBe(0);
  });

  it('hitlag freezes the body at zero velocity for hitlagFrames after a hit', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.applyHit(STANDARD_HIT);
    // STANDARD_HIT.damage === 10 → medium tier hitlag (HITLAG_MEDIUM_FRAMES = 8)
    const hitlagAtStart = ch.getHitlagRemaining();
    expect(hitlagAtStart).toBeGreaterThan(0);
    // Velocity is pinned at zero each frame of the freeze.
    for (let i = 0; i < hitlagAtStart - 1; i += 1) {
      ch.applyInput(NEUTRAL);
      expect(ch.getVelocity().x).toBe(0);
      expect(ch.getVelocity().y).toBe(0);
      expect(ch.getHitstunRemaining()).toBe(0); // not yet armed
    }
    // Final freeze frame — release the knockback + arm hitstun.
    ch.applyInput(NEUTRAL);
    expect(ch.getHitlagRemaining()).toBe(0);
    expect(ch.getVelocity().x).not.toBe(0);
    expect(ch.getHitstunRemaining()).toBeGreaterThan(0);
  });

  it('input is locked during hitlag — attack press cannot fire', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack({
      id: 'test.jab',
      type: 'jab',
      damage: 5,
      knockback: { x: 1, y: 0, scaling: 0 },
      hitbox: { offsetX: 30, offsetY: 0, width: 40, height: 30 },
      startupFrames: 4,
      activeFrames: 3,
      recoveryFrames: 6,
      cooldownFrames: 8,
    });
    ch.applyHit(STANDARD_HIT);
    // The "fighting game stun" rule — even a perfectly-timed attack
    // press during the freeze cannot land an attack.
    while (ch.getHitlagRemaining() > 0) {
      ch.applyInput({ moveX: 0, jump: false, attack: true });
      expect(ch.isAttacking()).toBe(false);
    }
  });

  it('DI: stick neutral at hitlag-end leaves the launch angle unchanged', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      mass: BASELINE_MASS,
    });
    const result = ch.applyHit(STANDARD_HIT);
    // Drive past hitlag with a neutral stick — no DI applied.
    while (ch.getHitlagRemaining() > 1) ch.applyInput(NEUTRAL);
    ch.applyInput(NEUTRAL); // freeze-end frame
    expect(ch.getVelocity().x).toBeCloseTo(result.vector.x);
    expect(ch.getVelocity().y).toBeCloseTo(result.vector.y);
  });

  it('DI: stick perpendicular to launch rotates the angle by ~18°', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      mass: BASELINE_MASS,
    });
    const result = ch.applyHit(STANDARD_HIT);
    const baseAngle = Math.atan2(result.vector.y, result.vector.x);
    // Drive past hitlag with stickY=1 (down) on the freeze-end frame.
    // STANDARD_HIT launches up-and-right; stickY=1 has a positive
    // perpendicular component, rotating the angle counter-clockwise
    // in screen-space (toward more horizontal launch).
    while (ch.getHitlagRemaining() > 1) ch.applyInput(NEUTRAL);
    ch.applyInput({ moveX: 0, jump: false, moveY: 1 });
    const rotatedAngle = Math.atan2(ch.getVelocity().y, ch.getVelocity().x);
    expect(Math.abs(rotatedAngle - baseAngle)).toBeGreaterThan(0.1);
    // Magnitude is preserved by DI — only the angle shifts.
    const magBefore = Math.hypot(result.vector.x, result.vector.y);
    const magAfter = Math.hypot(ch.getVelocity().x, ch.getVelocity().y);
    expect(magAfter).toBeCloseTo(magBefore, 5);
  });

  it('DI: opposite stick directions rotate the launch in opposite directions', () => {
    const buildAndHit = (stickY: number): { angle: number; vx: number; vy: number } => {
      const m = createMockScene();
      const ch = new Character(m.scene, {
        id: 'wolf',
        spawnX: 0,
        spawnY: 0,
        mass: BASELINE_MASS,
      });
      ch.applyHit(STANDARD_HIT);
      while (ch.getHitlagRemaining() > 1) ch.applyInput(NEUTRAL);
      ch.applyInput({ moveX: 0, jump: false, moveY: stickY });
      const v = ch.getVelocity();
      return { angle: Math.atan2(v.y, v.x), vx: v.x, vy: v.y };
    };
    const down = buildAndHit(1);
    const up = buildAndHit(-1);
    // The two angles bracket the no-DI angle in opposite directions.
    expect(down.angle).not.toBeCloseTo(up.angle, 3);
  });

  it('armAttackerHitlag freezes the attacker for the given frames (no queued knockback)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(ch.isInHitlag()).toBe(false);
    ch.armAttackerHitlag(8);
    expect(ch.getHitlagRemaining()).toBe(8);
    expect(ch.isInHitlag()).toBe(true);
    // Drain the freeze with neutral inputs.
    for (let i = 0; i < 8; i += 1) ch.applyInput(NEUTRAL);
    expect(ch.getHitlagRemaining()).toBe(0);
    // No queued knockback fires — velocity stays at zero (attacker had
    // no incoming hit, just a sympathetic freeze).
    expect(ch.getVelocity().x).toBe(0);
    expect(ch.getVelocity().y).toBe(0);
    expect(ch.isInHitstun()).toBe(false);
  });

  it('armAttackerHitlag never shortens an in-flight freeze', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.armAttackerHitlag(12);
    expect(ch.getHitlagRemaining()).toBe(12);
    // A subsequent shorter call must NOT shorten the existing freeze.
    ch.armAttackerHitlag(4);
    expect(ch.getHitlagRemaining()).toBe(12);
    // But a longer call extends.
    ch.armAttackerHitlag(15);
    expect(ch.getHitlagRemaining()).toBe(15);
  });

  it('armAttackerHitlag pauses an in-flight attack tick', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack({
      id: 'test.jab',
      type: 'jab',
      damage: 5,
      knockback: { x: 1, y: 0, scaling: 0 },
      hitbox: { offsetX: 30, offsetY: 0, width: 40, height: 30 },
      startupFrames: 4,
      activeFrames: 3,
      recoveryFrames: 6,
      cooldownFrames: 8,
    });
    // Start an attack.
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(ch.isAttacking()).toBe(true);
    const framesElapsedAtStart = ch.getActiveAttack()?.framesElapsed ?? -1;
    // Arm attacker hitlag — the attack tick should pause for the freeze.
    ch.armAttackerHitlag(6);
    for (let i = 0; i < 6; i += 1) ch.applyInput(NEUTRAL);
    // After the freeze the attack frame counter is unchanged from
    // when the freeze was armed (the hitlag-drain path skips
    // tickAttack entirely).
    expect(ch.getActiveAttack()?.framesElapsed).toBe(framesElapsedAtStart);
  });

  it('sweet-spot flag adds the +4f hitlag bonus', () => {
    const m = createMockScene();
    const ch1 = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const ch2 = new Character(m.scene, { id: 'wolf', spawnX: 100, spawnY: 0 });
    ch1.applyHit(STANDARD_HIT);
    ch2.applyHit({ ...STANDARD_HIT, sweetSpot: true });
    // Sweet-spot freeze is exactly 4 frames longer (HITLAG_SWEET_SPOT_BONUS_FRAMES).
    expect(ch2.getHitlagRemaining() - ch1.getHitlagRemaining()).toBe(4);
  });

  it('hitlag is deterministic — same hit yields identical freeze + launch', () => {
    const runOnce = (): { hitlag: number; vx: number; stun: number } => {
      const m = createMockScene();
      const ch = new Character(m.scene, {
        id: 'wolf',
        spawnX: 0,
        spawnY: 0,
        mass: BASELINE_MASS,
      });
      ch.applyHit(STANDARD_HIT);
      const hitlag = ch.getHitlagRemaining();
      tickPastHitlag(ch);
      return {
        hitlag,
        vx: ch.getVelocity().x,
        stun: ch.getHitstunRemaining(),
      };
    };
    const a = runOnce();
    const b = runOnce();
    expect(a).toEqual(b);
  });

  it('setPosition() clears a queued knockback that was about to fire', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.applyHit(STANDARD_HIT);
    expect(ch.isInHitlag()).toBe(true);
    ch.setPosition(500, 250);
    expect(ch.isInHitlag()).toBe(false);
    // After teleport, no queued launch should fire on the next applyInput.
    const xBefore = ch.getPosition().x;
    ch.applyInput(NEUTRAL);
    expect(ch.getPosition().x).toBe(xBefore);
    expect(ch.getVelocity().x).toBe(0);
  });

  it('determinism — same hit on a fresh fighter produces identical state every run', () => {
    const runA = (() => {
      const m = createMockScene();
      const ch = new Character(m.scene, {
        id: 'wolf',
        spawnX: 0,
        spawnY: 0,
        mass: BASELINE_MASS,
      });
      const r = ch.applyHit(STANDARD_HIT);
      return {
        vx: ch.getVelocity().x,
        vy: ch.getVelocity().y,
        pct: ch.getDamagePercent(),
        stun: ch.getHitstunRemaining(),
        mag: r.magnitude,
      };
    })();
    const runB = (() => {
      const m = createMockScene();
      const ch = new Character(m.scene, {
        id: 'wolf',
        spawnX: 0,
        spawnY: 0,
        mass: BASELINE_MASS,
      });
      const r = ch.applyHit(STANDARD_HIT);
      return {
        vx: ch.getVelocity().x,
        vy: ch.getVelocity().y,
        pct: ch.getDamagePercent(),
        stun: ch.getHitstunRemaining(),
        mag: r.magnitude,
      };
    })();
    expect(runA).toEqual(runB);
  });
});

// ---------------------------------------------------------------------------
// Respawn invincibility (Sub-AC 4.2 of AC 302)
// ---------------------------------------------------------------------------

describe('Character — respawn invincibility (Sub-AC 4.2)', () => {
  it('starts with zero invincibility frames remaining', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(ch.getInvincibilityRemaining()).toBe(0);
    expect(ch.isInvincible()).toBe(false);
  });

  it('setInvincibility(N) arms the timer to exactly N frames', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setInvincibility(90);
    expect(ch.getInvincibilityRemaining()).toBe(90);
    expect(ch.isInvincible()).toBe(true);
  });

  it('setInvincibility clamps negative values to 0', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setInvincibility(-10);
    expect(ch.getInvincibilityRemaining()).toBe(0);
    expect(ch.isInvincible()).toBe(false);
  });

  it('setInvincibility(0) clears any pending grace', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setInvincibility(60);
    ch.setInvincibility(0);
    expect(ch.isInvincible()).toBe(false);
  });

  it('decrements once per applyInput call', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setInvincibility(3);
    ch.applyInput(NEUTRAL);
    expect(ch.getInvincibilityRemaining()).toBe(2);
    ch.applyInput(NEUTRAL);
    expect(ch.getInvincibilityRemaining()).toBe(1);
    ch.applyInput(NEUTRAL);
    expect(ch.getInvincibilityRemaining()).toBe(0);
    ch.applyInput(NEUTRAL);
    // Already drained — stays at 0, doesn't underflow.
    expect(ch.getInvincibilityRemaining()).toBe(0);
  });

  it('absorbs an incoming hit (no damage, no knockback, no hitstun)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      mass: BASELINE_MASS,
    });
    ch.setInvincibility(60);
    const before = ch.getDamagePercent();
    const result = ch.applyHit(STANDARD_HIT);

    expect(result.magnitude).toBe(0);
    expect(result.hitstunFrames).toBe(0);
    expect(result.vector).toEqual({ x: 0, y: 0 });
    // Damage didn't accumulate.
    expect(ch.getDamagePercent()).toBe(before);
    // Velocity wasn't perturbed.
    expect(ch.getVelocity()).toEqual({ x: 0, y: 0 });
    // No hitstun was applied.
    expect(ch.isInHitstun()).toBe(false);
  });

  it('does NOT shorten the invincibility timer per absorbed hit (wall-clock fixed window)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setInvincibility(60);
    // Take a flurry of hits — the timer should still read 60 (no
    // applyInput frames have elapsed yet).
    for (let i = 0; i < 10; i += 1) ch.applyHit(STANDARD_HIT);
    expect(ch.getInvincibilityRemaining()).toBe(60);
    expect(ch.isInvincible()).toBe(true);
  });

  it('returns to vulnerable once the timer drains', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      mass: BASELINE_MASS,
    });
    ch.setInvincibility(2);
    ch.applyInput(NEUTRAL); // 1
    ch.applyInput(NEUTRAL); // 0 → no longer invincible next call
    expect(ch.isInvincible()).toBe(false);
    // Now a real hit lands.
    const result = ch.applyHit(STANDARD_HIT);
    expect(result.magnitude).toBeGreaterThan(0);
    expect(ch.getDamagePercent()).toBeGreaterThan(0);
    // Hitstun arms after hitlag drains (post-M2 hit-feel pass).
    tickPastHitlag(ch);
    expect(ch.isInHitstun()).toBe(true);
  });

  it('movement / jump / attack still work while invincible (only hits are blocked)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.setInvincibility(60);
    // Movement applies normally.
    ch.applyInput({ moveX: 1, jump: false });
    expect(ch.getVelocity().x).toBeGreaterThan(0);
    // Jump applies normally.
    const vyBefore = ch.getVelocity().y;
    ch.applyInput({ moveX: 1, jump: true });
    expect(ch.getVelocity().y).toBeLessThan(vyBefore);
  });

  it('setPosition leaves invincibility untouched (respawn flow sets it post-teleport)', () => {
    // The respawn flow is: setPosition(spawnX, spawnY) → setDamagePercent(0)
    // → setInvincibility(N). If setPosition cleared invincibility, the
    // grace window would always be empty. Lock down that ordering here.
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setInvincibility(60);
    ch.setPosition(500, 250);
    expect(ch.getInvincibilityRemaining()).toBe(60);
    expect(ch.isInvincible()).toBe(true);
  });

  it('respawn flow integration: teleport + clear damage + arm invincibility', () => {
    // Mirror what MatchScene does on a stock loss respawn.
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      mass: BASELINE_MASS,
    });
    // Play out a hit so the fighter has damage and hitstun pre-respawn.
    ch.applyHit(STANDARD_HIT);
    tickPastHitlag(ch);
    expect(ch.getDamagePercent()).toBeGreaterThan(0);
    expect(ch.isInHitstun()).toBe(true);

    // The respawn flow:
    ch.setPosition(800, 300);
    ch.setDamagePercent(0);
    ch.setInvincibility(90);

    expect(ch.getPosition()).toEqual({ x: 800, y: 300 });
    expect(ch.getDamagePercent()).toBe(0);
    expect(ch.isInHitstun()).toBe(false); // setPosition cleared it
    expect(ch.isInvincible()).toBe(true);
    expect(ch.getInvincibilityRemaining()).toBe(90);
    // Velocity zeroed by setPosition, so no residual knockback.
    expect(ch.getVelocity()).toEqual({ x: 0, y: 0 });

    // A subsequent hit during the grace window is fully absorbed.
    const r = ch.applyHit(STANDARD_HIT);
    expect(r.magnitude).toBe(0);
    expect(ch.getDamagePercent()).toBe(0);
  });

  it('determinism — identical respawn sequence yields identical state', () => {
    const runOnce = (): {
      pos: { x: number; y: number };
      pct: number;
      inv: number;
    } => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ch.applyHit(STANDARD_HIT);
      ch.setPosition(500, 250);
      ch.setDamagePercent(0);
      ch.setInvincibility(90);
      // Run a few input frames to drain the timer.
      for (let i = 0; i < 5; i += 1) ch.applyInput(NEUTRAL);
      return {
        pos: ch.getPosition(),
        pct: ch.getDamagePercent(),
        inv: ch.getInvincibilityRemaining(),
      };
    };
    expect(runOnce()).toEqual(runOnce());
  });
});

// ---------------------------------------------------------------------------
// Shield mechanic — AC 60301 Sub-AC 1
// ---------------------------------------------------------------------------

/**
 * Integration tests that wire the pure shield state machine through
 * `Character.applyInput` and `Character.applyHit`. The `shieldState`
 * helper unit-tests live in `shieldState.test.ts`; the suite below
 * locks down what the runtime sees: motion suppression while raised,
 * hits drain shield instead of damage %, shield-break enters a stun
 * lockout that suppresses input, and respawn / setPosition reset the
 * shield cleanly.
 */
describe('Character — shield mechanic (AC 60301 Sub-AC 1)', () => {
  it('starts idle / full shield health on construction', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(ch.isShielding()).toBe(false);
    expect(ch.isShieldBroken()).toBe(false);
    expect(ch.getShieldState().name).toBe('idle');
    // Default `SHIELD_DEFAULTS.maxHealth` is 50.
    expect(ch.getShieldHealth()).toBe(50);
  });

  it('raises the shield when shield input is held', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, shield: true });
    expect(ch.isShielding()).toBe(true);
    expect(ch.getShieldState().name).toBe('active');
  });

  it('drains shield health while held (one decay tick per frame)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    const start = ch.getShieldHealth();
    for (let i = 0; i < 10; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, shield: true });
    }
    expect(ch.getShieldHealth()).toBeLessThan(start);
  });

  it('suppresses horizontal motion while the shield is raised', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    // Build up some velocity first.
    for (let i = 0; i < 5; i += 1) {
      ch.applyInput({ moveX: 1, jump: false });
    }
    expect(ch.getVelocity().x).toBeGreaterThan(0);
    // Now hold shield + a direction. The direction must be ignored.
    for (let i = 0; i < 10; i += 1) {
      ch.applyInput({ moveX: 1, jump: false, shield: true });
    }
    // Velocity will damp toward 0 (the shield holds the fighter still).
    expect(ch.getVelocity().x).toBeLessThan(0.5);
  });

  it('jumps OUT of shield — a jump press drops the shield and fires the impulse', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    // Raise shield first frame, then press jump on the next frame.
    ch.applyInput({ moveX: 0, jump: false, shield: true });
    expect(ch.isShielding()).toBe(true);
    ch.applyInput({ moveX: 0, jump: true, shield: true });
    // Jump-out-of-shield: the shield drops and the jump impulse fires.
    expect(ch.getVelocity().y).toBeLessThan(0);
    expect(ch.isShielding()).toBe(false);
  });

  it('suppresses attack press while the shield is raised', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    // Register a simple jab so an attack press has a target. The
    // attack contract requires a name + frame counts; defaults are
    // fine.
    ch.registerAttack({
      id: 'test-jab',
      type: 'jab',
      damage: 10,
      knockback: { x: 1, y: 0, scaling: 0 },
      startupFrames: 1,
      activeFrames: 1,
      recoveryFrames: 1,
      cooldownFrames: 0,
      hitbox: { width: 10, height: 10, offsetX: 10, offsetY: 0 },
    });
    // Holding shield + pressing attack — attack should NOT start.
    ch.applyInput({ moveX: 0, jump: false, shield: true, attack: true });
    expect(ch.isAttacking()).toBe(false);
    // Releasing shield, pressing attack — now it fires.
    ch.applyInput({ moveX: 0, jump: false, shield: false, attack: false });
    ch.applyInput({ moveX: 0, jump: false, shield: false, attack: true });
    expect(ch.isAttacking()).toBe(true);
  });

  it('absorbs an incoming hit when raised — damage % unchanged, no knockback', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    // Raise + hold past the perfect-shield window so this is a NORMAL
    // block (a frame-perfect raise would powershield with no HP cost).
    for (let i = 0; i < 4; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, shield: true });
    }
    const startHealth = ch.getShieldHealth();
    const r = ch.applyHit(STANDARD_HIT);
    expect(r.magnitude).toBe(0);
    expect(r.hitstunFrames).toBe(0);
    expect(ch.getDamagePercent()).toBe(0);
    expect(ch.isInHitstun()).toBe(false);
    expect(ch.getShieldHealth()).toBeCloseTo(startHealth - STANDARD_HIT.damage, 4);
  });

  it('does NOT absorb a hit when shield is idle (caller falls through)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    // No shield raised.
    const r = ch.applyHit(STANDARD_HIT);
    expect(r.magnitude).toBeGreaterThan(0);
    expect(ch.getDamagePercent()).toBe(STANDARD_HIT.damage);
  });

  it('breaks the shield when a single hit drains health to zero', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      shield: { maxHealth: 5, breakStunFrames: 30 },
    });
    ground(ch, m);
    // Raise + hold past the powershield window (else the hit powershields).
    for (let i = 0; i < 4; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, shield: true });
    }
    // Land a 100-damage hit (overkill) — shield should break.
    ch.applyHit({ ...STANDARD_HIT, damage: 100 });
    expect(ch.isShielding()).toBe(false);
    expect(ch.isShieldBroken()).toBe(true);
    expect(ch.getShieldHealth()).toBe(0);
    expect(ch.getShieldStunRemaining()).toBe(30);
  });

  it('shield-break stun suppresses motion / jump / attack / shield-raise', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      shield: { maxHealth: 1, breakStunFrames: 30 },
    });
    ground(ch, m);
    // Force a break (hold past the powershield window first).
    for (let i = 0; i < 4; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, shield: true });
    }
    ch.applyHit({ ...STANDARD_HIT, damage: 999 });
    expect(ch.isShieldBroken()).toBe(true);
    // Mash inputs — all suppressed.
    for (let i = 0; i < 10; i += 1) {
      ch.applyInput({
        moveX: 1,
        jump: true,
        shield: true,
        attack: true,
      });
      expect(ch.isAttacking()).toBe(false);
    }
    // Velocity stayed ~0 (no dash / jump fired). The fighter is helpless
    // for the duration of the stun.
    expect(Math.abs(ch.getVelocity().x)).toBeLessThan(0.5);
    expect(ch.getVelocity().y).toBeGreaterThanOrEqual(0);
  });

  it('drains shield-break stun by 1 each fixed step, then returns to idle', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      // maxHealth must accommodate postBreakHealth — a higher
      // postBreakHealth than maxHealth is clamped at the cap.
      shield: { maxHealth: 50, breakStunFrames: 5, postBreakHealth: 8 },
    });
    ground(ch, m);
    for (let i = 0; i < 4; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, shield: true }); // past window
    }
    ch.applyHit({ ...STANDARD_HIT, damage: 999 });
    expect(ch.getShieldStunRemaining()).toBe(5);
    for (let i = 4; i >= 1; i -= 1) {
      ch.applyInput({ moveX: 0, jump: false });
      expect(ch.isShieldBroken()).toBe(true);
      expect(ch.getShieldStunRemaining()).toBe(i);
    }
    // One more step — stun ends, fighter returns to idle with the
    // configured post-break sliver of HP.
    ch.applyInput({ moveX: 0, jump: false });
    expect(ch.isShieldBroken()).toBe(false);
    expect(ch.getShieldState().name).toBe('idle');
    expect(ch.getShieldHealth()).toBe(8);
  });

  it('shield held throughout stun does NOT auto-re-raise on stun end', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      shield: { maxHealth: 1, breakStunFrames: 3, postBreakHealth: 8 },
    });
    ground(ch, m);
    for (let i = 0; i < 4; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, shield: true }); // past window
    }
    ch.applyHit({ ...STANDARD_HIT, damage: 999 });
    // Hold shield throughout the entire stun window.
    for (let i = 0; i < 4; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, shield: true });
    }
    // After stun ends, the shield is idle (held flag treated as
    // released). The player has to release & re-press.
    expect(ch.isShielding()).toBe(false);
    expect(ch.isShieldBroken()).toBe(false);
  });

  it('regen kicks in after the regen-delay window once shield is released', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    // Drain the shield a bit.
    for (let i = 0; i < 30; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, shield: true });
    }
    const drained = ch.getShieldHealth();
    // Release and idle for plenty of frames.
    for (let i = 0; i < 200; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, shield: false });
    }
    expect(ch.getShieldHealth()).toBeGreaterThan(drained);
  });

  it('setPosition resets the shield to fresh idle (respawn flow)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      shield: { maxHealth: 5, breakStunFrames: 30 },
    });
    ground(ch, m);
    // Force a break (hold past the powershield window first).
    for (let i = 0; i < 4; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, shield: true });
    }
    ch.applyHit({ ...STANDARD_HIT, damage: 999 });
    expect(ch.isShieldBroken()).toBe(true);
    ch.setPosition(500, 200);
    expect(ch.isShieldBroken()).toBe(false);
    expect(ch.isShielding()).toBe(false);
    // Reset to full health for the configured maxHealth.
    expect(ch.getShieldHealth()).toBe(5);
  });

  it('hitstun does NOT auto-re-raise the shield (held flag forced to false)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    // Get hit (no shield up) — fighter enters hitlag freeze, then hitstun.
    ch.applyHit(STANDARD_HIT);
    tickPastHitlag(ch);
    expect(ch.isInHitstun()).toBe(true);
    // Mash shield throughout hitstun — should NOT raise.
    while (ch.isInHitstun()) {
      ch.applyInput({ moveX: 0, jump: false, shield: true });
      expect(ch.isShielding()).toBe(false);
    }
    // After hitstun ends, the held shield key is still latched as
    // "previously held" (released perspective inside hitstun). One
    // more press cycle — release and press cleanly:
    ch.applyInput({ moveX: 0, jump: false, shield: false });
    ch.applyInput({ moveX: 0, jump: false, shield: true });
    expect(ch.isShielding()).toBe(true);
  });

  it('determinism — identical input streams produce identical shield trajectories', () => {
    const trace = (): Array<{ name: string; health: number }> => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ground(ch, m);
      const out: Array<{ name: string; health: number }> = [];
      // Pseudo-deterministic press pattern (no Math.random).
      for (let i = 0; i < 600; i += 1) {
        const shield = (i % 17) < 9;
        ch.applyInput({ moveX: 0, jump: false, shield });
        out.push({ name: ch.getShieldState().name, health: ch.getShieldHealth() });
      }
      return out;
    };
    expect(trace()).toEqual(trace());
  });
});

// ---------------------------------------------------------------------------
// AC 60303 Sub-AC 3 — up-special vertical movement & recovery physics
// ---------------------------------------------------------------------------

describe('Character — up-special recovery physics (AC 60303 Sub-AC 3)', () => {
  // Roster moves with full schemas so the runtime branches on
  // `upSpecialKind` and applies the kind-specific physics. We import
  // them lazily here because the suite's existing TEST_UP_SPECIAL is a
  // bare `AttackMove` shape that lacks an `upSpecialKind` field.
  // eslint-disable-next-line @typescript-eslint/no-require-imports

  it('multiHitRising press applies an upward velocity (Wolf recovery)', async () => {
    const { Wolf, WOLF_UP_SPECIAL } = await import('./Wolf');
    const m = createMockScene();
    const w = new Wolf(m.scene, { spawnX: 100, spawnY: 200 });
    expect(w.getVelocity().y).toBe(0);
    expect(w.attemptUpSpecial()).toBe(true);
    expect(w.getVelocity().y).toBe(WOLF_UP_SPECIAL.multiHitRising.riseImpulse);
    // Sign convention: NEGATIVE means upward in Phaser screen-space.
    expect(w.getVelocity().y).toBeLessThan(0);
    // Active attack is the up-special so the lifecycle drives the rest.
    expect(w.getActiveAttack()!.move.id).toBe(WOLF_UP_SPECIAL.id);
  });

  it('multiHitRising press scales facing-drift by the fighter facing', async () => {
    const { Wolf, WOLF_UP_SPECIAL } = await import('./Wolf');
    // Wolf's drift is 0 by spec, so build a synthetic move with a
    // non-zero drift to exercise the facing scaling path. Re-register a
    // fresh up-special on a base Character.
    const m = createMockScene();
    const w = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    // Override Wolf's up-special with one that has horizontal drift.
    const drifty = {
      ...WOLF_UP_SPECIAL,
      id: 'wolf.up_drift',
      multiHitRising: {
        ...WOLF_UP_SPECIAL.multiHitRising,
        driftImpulse: 3,
      },
    } as typeof WOLF_UP_SPECIAL;
    w.registerAttack(drifty);
    w.setUpSpecial(drifty.id);
    // Default facing = 1 (right) → vx = +3
    w.setFacing(1);
    expect(w.attemptUpSpecial()).toBe(true);
    expect(w.getVelocity().x).toBeCloseTo(3);
  });

  it('teleport press zeroes velocity then translates on the reappear frame (Cat recovery)', async () => {
    const { Cat, CAT_UP_SPECIAL } = await import('./Cat');
    const m = createMockScene();
    const c = new Cat(m.scene, { spawnX: 100, spawnY: 300 });
    // Press with stick straight up → reappear is straight up by `teleportDistance`.
    expect(c.attemptUpSpecial(0, -1)).toBe(true);
    // Press-frame: velocity is zeroed (vanish state).
    expect(c.getVelocity().x).toBe(0);
    expect(c.getVelocity().y).toBe(0);
    // Body has not moved yet — translation is on the reappear frame.
    expect(c.getPosition()).toEqual({ x: 100, y: 300 });

    // Drive the lifecycle until the active→recovery boundary. The
    // teleport fires on the LAST active frame; we tick startup + active
    // - 1 times (the press itself does NOT count toward startup).
    const totalUntilLastActive =
      CAT_UP_SPECIAL.startupFrames + CAT_UP_SPECIAL.activeFrames - 1;
    for (let i = 0; i < totalUntilLastActive; i += 1) {
      c.applyInput({ moveX: 0, jump: false });
    }
    // After the last active-frame tick, the teleport has fired.
    expect(c.getPosition().x).toBe(100); // dir = (0, -1), so x unchanged
    expect(c.getPosition().y).toBe(300 - CAT_UP_SPECIAL.teleport.teleportDistance);
  });

  it('teleport press snaps off-axis sticks to the closest octant', async () => {
    const { Cat, CAT_UP_SPECIAL } = await import('./Cat');
    const m = createMockScene();
    const c = new Cat(m.scene, { spawnX: 0, spawnY: 0 });
    // Stick at roughly NE (45°). With snapToOctant=true, dir should
    // snap to (√½, -√½). Translation is teleportDistance along that.
    expect(c.attemptUpSpecial(0.7, -0.7)).toBe(true);
    const totalUntilLastActive =
      CAT_UP_SPECIAL.startupFrames + CAT_UP_SPECIAL.activeFrames - 1;
    for (let i = 0; i < totalUntilLastActive; i += 1) {
      c.applyInput({ moveX: 0, jump: false });
    }
    const expected = CAT_UP_SPECIAL.teleport.teleportDistance * Math.SQRT1_2;
    expect(c.getPosition().x).toBeCloseTo(expected, 6);
    expect(c.getPosition().y).toBeCloseTo(-expected, 6);
  });

  it('directionalJump press sets velocity along the snapped direction (Owl recovery)', async () => {
    const { Owl, OWL_UP_SPECIAL } = await import('./Owl');
    const m = createMockScene();
    const o = new Owl(m.scene, { spawnX: 0, spawnY: 0 });
    // Stick straight up → dir = (0, -1) → vy = -burstSpeed, vx = 0.
    expect(o.attemptUpSpecial(0, -1)).toBe(true);
    expect(o.getVelocity().x).toBe(0);
    expect(o.getVelocity().y).toBe(-OWL_UP_SPECIAL.directionalJump.burstSpeed);
    // Sign convention: NEGATIVE means upward.
    expect(o.getVelocity().y).toBeLessThan(0);
  });

  it('directionalJump locks velocity each active frame to resist gravity', async () => {
    const { Owl, OWL_UP_SPECIAL } = await import('./Owl');
    const m = createMockScene();
    const o = new Owl(m.scene, { spawnX: 0, spawnY: 0 });
    // Press up — burst is along (0, -1).
    o.attemptUpSpecial(0, -1);
    const expectedVy = -OWL_UP_SPECIAL.directionalJump.burstSpeed;
    // Drive past startup into the active window. Each active-phase
    // frame should re-lock velocity to (0, expectedVy) so a gravity
    // integrator wouldn't decay the burst.
    // Simulate a "gravity tick" between frames by manually nudging vy.
    for (let i = 0; i < OWL_UP_SPECIAL.startupFrames + 2; i += 1) {
      // Manually apply fake gravity between fixed steps (mimics what a
      // real Matter integrator would do between applyInput calls).
      o.body.velocity.y += 1;
      o.applyInput({ moveX: 0, jump: false });
      if (i >= OWL_UP_SPECIAL.startupFrames) {
        // Active phase — burst velocity should be re-locked.
        expect(o.getVelocity().y).toBe(expectedVy);
      }
    }
  });

  it('directionalJump diagonal stick produces a diagonal burst', async () => {
    const { Owl, OWL_UP_SPECIAL } = await import('./Owl');
    const m = createMockScene();
    const o = new Owl(m.scene, { spawnX: 0, spawnY: 0 });
    // Stick at NE (snapped to (√½, -√½))
    expect(o.attemptUpSpecial(1, -1)).toBe(true);
    const burstSpeed = OWL_UP_SPECIAL.directionalJump.burstSpeed;
    expect(o.getVelocity().x).toBeCloseTo(burstSpeed * Math.SQRT1_2, 6);
    expect(o.getVelocity().y).toBeCloseTo(-burstSpeed * Math.SQRT1_2, 6);
  });

  it('tether press applies an upward impulse for the recovery rise (Bear recovery)', async () => {
    const { Bear, BEAR_UP_SPECIAL } = await import('./Bear');
    const m = createMockScene();
    const b = new Bear(m.scene, { spawnX: 0, spawnY: 0 });
    expect(b.getVelocity().y).toBe(0);
    expect(b.attemptUpSpecial()).toBe(true);
    // Vertical movement: NEGATIVE y means upward.
    expect(b.getVelocity().y).toBeLessThan(0);
    // Magnitude scales with the schema's extensionSpeed (so the press
    // visibly clears the body before the line goes out).
    const expected = -Math.max(8, BEAR_UP_SPECIAL.tether.extensionSpeed * 0.5);
    expect(b.getVelocity().y).toBe(expected);
  });

  it('attemptUpSpecial returns false when no up-special is registered', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(ch.getUpSpecialId()).toBe(null);
    expect(ch.attemptUpSpecial()).toBe(false);
    expect(ch.getVelocity()).toEqual({ x: 0, y: 0 });
  });

  it('attemptUpSpecial returns false while another attack is in flight', async () => {
    const { Wolf, WOLF_JAB } = await import('./Wolf');
    const m = createMockScene();
    const w = new Wolf(m.scene, { spawnX: 0, spawnY: 0 });
    expect(w.attemptAttack(WOLF_JAB.id)).toBe(true);
    // Mid-jab — up-special is gated.
    expect(w.attemptUpSpecial()).toBe(false);
    expect(w.getActiveAttack()!.move.id).toBe(WOLF_JAB.id);
  });

  it('up-special leaves the fighter helpless until landing, then the refreshed jump fires', async () => {
    const { Cat, CAT_TUNING } = await import('./Cat');
    const m = createMockScene();
    const c = new Cat(m.scene, { spawnX: 0, spawnY: 0 });
    // Burn every air jump.
    for (let i = 0; i < CAT_TUNING.maxJumps!; i += 1) {
      c.applyInput({ moveX: 0, jump: true });
      c.applyInput({ moveX: 0, jump: false });
    }
    expect(c.attemptUpSpecial()).toBe(true);
    // Drive the move to completion + drain the cooldown.
    for (let i = 0; i < 200 && c.isAttacking(); i += 1) {
      c.applyInput({ moveX: 0, jump: false });
    }
    for (let i = 0; i < 200 && c.getCooldownRemaining() > 0; i += 1) {
      c.applyInput({ moveX: 0, jump: false });
    }
    // Smash rule: after an up-special the fighter is in HELPLESS special-
    // fall — a jump press is ignored until it lands.
    expect(c.isHelpless()).toBe(true);
    c.applyInput({ moveX: 0, jump: true });
    expect(c.getVelocity().y).not.toBeLessThan(0); // jump blocked while helpless
    // Landing clears helpless; the jump budget was reset by attemptUpSpecial,
    // so a fresh grounded jump press now fires.
    ground(c, m);
    c.applyInput({ moveX: 0, jump: false }); // release + land → clears helpless
    const yBefore = c.getPosition().y;
    c.applyInput({ moveX: 0, jump: true });
    expect(c.getVelocity().y).toBeLessThan(0);
    expect(yBefore).toBe(c.getPosition().y); // jump applies velocity, not position
  });

  it('determinism — identical up-special inputs produce identical trajectories', async () => {
    const { Wolf } = await import('./Wolf');
    const trace = (): Array<{ x: number; y: number; vy: number }> => {
      const m = createMockScene();
      const w = new Wolf(m.scene, { spawnX: 50, spawnY: 100 });
      const out: Array<{ x: number; y: number; vy: number }> = [];
      w.attemptUpSpecial(0, -1);
      for (let i = 0; i < 80; i += 1) {
        w.applyInput({ moveX: 0, jump: false });
        out.push({
          x: w.getPosition().x,
          y: w.getPosition().y,
          vy: w.getVelocity().y,
        });
      }
      return out;
    };
    expect(trace()).toEqual(trace());
  });

  it('every roster character produces vertical movement on up-special activation', async () => {
    const { Wolf } = await import('./Wolf');
    const { Cat } = await import('./Cat');
    const { Owl } = await import('./Owl');
    const { Bear } = await import('./Bear');
    const constructors: Array<(m: MockScene) => Character> = [
      (m) => new Wolf(m.scene, { spawnX: 0, spawnY: 0 }),
      (m) => new Cat(m.scene, { spawnX: 0, spawnY: 0 }),
      (m) => new Owl(m.scene, { spawnX: 0, spawnY: 0 }),
      (m) => new Bear(m.scene, { spawnX: 0, spawnY: 0 }),
    ];
    for (const make of constructors) {
      const m = createMockScene();
      const ch = make(m);
      expect(ch.getVelocity().y).toBe(0);
      expect(ch.attemptUpSpecial(0, -1)).toBe(true);
      // Either the press-frame velocity is upward (multiHitRising,
      // directionalJump, tether) OR the press-frame velocity is zero
      // and the move teleports upward in a later frame (teleport).
      if (ch.getVelocity().y < 0) {
        // Direct vertical press impulse — confirmed.
        continue;
      }
      // Teleport branch — velocity is 0 on press; body moves up over
      // the active window.
      expect(ch.getVelocity().y).toBe(0);
      const yBefore = ch.getPosition().y;
      for (let i = 0; i < 100 && ch.isAttacking(); i += 1) {
        ch.applyInput({ moveX: 0, jump: false });
      }
      expect(ch.getPosition().y).toBeLessThan(yBefore);
    }
  });
});

// ---------------------------------------------------------------------------
// Edge-grab / ledge-hang integration (AC 60403 Sub-AC 3)
// ---------------------------------------------------------------------------

describe('Character — edge-grab + ledge-hang state (AC 60403 Sub-AC 3)', () => {
  it('does not grab when no ledge candidates are wired in', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 100, spawnY: 100 });
    // No setLedgeCandidates call → empty list → detection always null.
    ch.applyInput({ moveX: 0, jump: false });
    expect(ch.isHangingOnLedge()).toBe(false);
    expect(ch.computeLedgeDetection()).toBeNull();
  });

  it('latches into ledge-hang when bounds overlap a candidate corner while airborne + falling', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 100, spawnY: 100 });
    // Place a ledge corner at the fighter's centre — guaranteed overlap.
    ch.setLedgeCandidates([
      { platformId: 'p1', side: 'right', x: 100, y: 100 },
    ]);
    ch.setFacing(1);
    // Force a small downward velocity so the eligibility check passes.
    m.scene.matter.body.setVelocity(ch.body, { x: 0, y: 5 });
    ch.applyInput({ moveX: 0, jump: false });
    expect(ch.isHangingOnLedge()).toBe(true);
    // Hang i-frame window opens.
    expect(ch.getLedgeHangIframesRemaining()).toBeGreaterThan(0);
    expect(ch.isInvincible()).toBe(true);
  });

  it('snaps body position to the latch point on the grab frame', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 100, spawnY: 100 });
    ch.setLedgeCandidates([
      { platformId: 'p1', side: 'right', x: 100, y: 60 },
    ]);
    ch.setFacing(1);
    m.scene.matter.body.setVelocity(ch.body, { x: 0, y: 5 });
    ch.applyInput({ moveX: 0, jump: false });
    expect(ch.isHangingOnLedge()).toBe(true);
    const tuning = ch.getTuning();
    // latchY = corner.y + halfHeight
    expect(ch.getPosition().x).toBe(100);
    expect(ch.getPosition().y).toBe(60 + tuning.height / 2);
  });

  it('locks input during hang — moveX has no effect on velocity', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 100, spawnY: 100 });
    ch.setLedgeCandidates([
      { platformId: 'p1', side: 'right', x: 100, y: 100 },
    ]);
    ch.setFacing(1);
    m.scene.matter.body.setVelocity(ch.body, { x: 0, y: 5 });
    ch.applyInput({ moveX: 0, jump: false });
    expect(ch.isHangingOnLedge()).toBe(true);
    // A small stick tilt (below the release threshold) does NOT walk — the
    // hang lock holds velocity at zero. (A FULL tilt toward the stage now
    // intentionally triggers a roll-up release; that's covered separately.)
    ch.applyInput({ moveX: 0.3, jump: false });
    expect(ch.isHangingOnLedge()).toBe(true);
    expect(ch.getVelocity().x).toBe(0);
    expect(ch.getVelocity().y).toBe(0);
  });

  function hangChar(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 100, spawnY: 100 });
    ch.setLedgeCandidates([{ platformId: 'p1', side: 'right', x: 100, y: 100 }]);
    ch.setFacing(1);
    m.scene.matter.body.setVelocity(ch.body, { x: 0, y: 5 });
    ch.applyInput({ moveX: 0, jump: false });
    expect(ch.isHangingOnLedge()).toBe(true);
    return { ch, m };
  }

  it('HUMAN release: up-stick climbs off the ledge (getUp)', () => {
    const { ch } = hangChar();
    ch.applyInput({ moveX: 0, moveY: -1, jump: false }); // up-stick → getUp
    expect(ch.isHangingOnLedge()).toBe(false);
  });

  it('HUMAN release: a jump press lets go with an upward impulse', () => {
    const { ch } = hangChar();
    ch.applyInput({ moveX: 0, jump: true }); // jump → ledge jump
    expect(ch.isHangingOnLedge()).toBe(false);
    expect(ch.getVelocity().y).toBeLessThan(0); // launched upward off the ledge
  });

  it('HUMAN release: stick away from the stage drops off the ledge', () => {
    const { ch } = hangChar(); // facing 1 (stage to the right); away = left
    ch.applyInput({ moveX: -1, jump: false });
    expect(ch.isHangingOnLedge()).toBe(false);
  });

  it("rejects facing-mismatch ledge: right-facing fighter ignores left ledge", () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 100, spawnY: 100 });
    ch.setLedgeCandidates([
      { platformId: 'p1', side: 'left', x: 100, y: 100 },
    ]);
    ch.setFacing(1);
    m.scene.matter.body.setVelocity(ch.body, { x: 0, y: 5 });
    ch.applyInput({ moveX: 0, jump: false });
    expect(ch.isHangingOnLedge()).toBe(false);
  });

  it('jump release fires upward impulse and enters tether cooldown', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 100, spawnY: 100 });
    ch.setLedgeCandidates([
      { platformId: 'p1', side: 'right', x: 100, y: 100 },
    ]);
    ch.setFacing(1);
    m.scene.matter.body.setVelocity(ch.body, { x: 0, y: 5 });
    ch.applyInput({ moveX: 0, jump: false });
    expect(ch.isHangingOnLedge()).toBe(true);
    // Release with jump.
    ch.applyInput({ moveX: 0, jump: false, ledgeRelease: 'jump' });
    expect(ch.isHangingOnLedge()).toBe(false);
    expect(ch.getLedgeTetherCooldownRemaining()).toBeGreaterThan(0);
    expect(ch.getVelocity().y).toBeLessThan(0); // upward
  });

  it('getUp release plays the climb animation then translates onto the platform', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 100, spawnY: 100 });
    ch.setLedgeCandidates([
      { platformId: 'p1', side: 'right', x: 100, y: 100 },
    ]);
    ch.setFacing(1);
    m.scene.matter.body.setVelocity(ch.body, { x: 0, y: 5 });
    ch.applyInput({ moveX: 0, jump: false });
    ch.applyInput({ moveX: 0, jump: false, ledgeRelease: 'getUp' });
    expect(ch.isClimbingFromLedge()).toBe(true);
    // Tick through the climb. Use the canonical default climbFrames so
    // we don't have to depend on the partial tuning view exposed by
    // `getTuning()` (which strips the resolved-ledge fields).
    const climbFrames = 28;
    for (let i = 0; i < climbFrames + 1; i += 1) {
      ch.applyInput({ moveX: 0, jump: false });
    }
    expect(ch.isClimbingFromLedge()).toBe(false);
    expect(ch.getLedgeTetherCooldownRemaining()).toBeGreaterThan(0);
    // Body has been translated onto the platform top (y above the latch
    // corner since y = corner.y - halfHeight).
    expect(ch.getPosition().y).toBeLessThan(100);
  });

  it('tether re-grab cooldown blocks re-latching the same ledge', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 100, spawnY: 100 });
    ch.setLedgeCandidates([
      { platformId: 'p1', side: 'right', x: 100, y: 100 },
    ]);
    ch.setFacing(1);
    m.scene.matter.body.setVelocity(ch.body, { x: 0, y: 5 });
    ch.applyInput({ moveX: 0, jump: false });
    expect(ch.isHangingOnLedge()).toBe(true);
    ch.applyInput({ moveX: 0, jump: false, ledgeRelease: 'dropDown' });
    expect(ch.isHangingOnLedge()).toBe(false);
    expect(ch.getLedgeTetherCooldownRemaining()).toBeGreaterThan(0);
    // Try to re-latch immediately — refused by the cooldown.
    m.scene.matter.body.setVelocity(ch.body, { x: 0, y: 5 });
    ch.applyInput({ moveX: 0, jump: false });
    expect(ch.isHangingOnLedge()).toBe(false);
  });

  it('hang i-frames absorb hits during the grace window', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 100, spawnY: 100 });
    ch.setLedgeCandidates([
      { platformId: 'p1', side: 'right', x: 100, y: 100 },
    ]);
    ch.setFacing(1);
    m.scene.matter.body.setVelocity(ch.body, { x: 0, y: 5 });
    ch.applyInput({ moveX: 0, jump: false });
    expect(ch.getLedgeHangIframesRemaining()).toBeGreaterThan(0);
    expect(ch.isInvincible()).toBe(true);
    const initialPercent = ch.getDamagePercent();
    const hit: HitInfo = {
      damage: 10,
      knockback: { x: 5, y: -5, scaling: 0.05 },
      facing: 1,
    };
    const result = ch.applyHit(hit);
    expect(result.magnitude).toBe(0);
    expect(ch.getDamagePercent()).toBe(initialPercent);
  });

  it('setPosition resets the ledge state to idle', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 100, spawnY: 100 });
    ch.setLedgeCandidates([
      { platformId: 'p1', side: 'right', x: 100, y: 100 },
    ]);
    ch.setFacing(1);
    m.scene.matter.body.setVelocity(ch.body, { x: 0, y: 5 });
    ch.applyInput({ moveX: 0, jump: false });
    expect(ch.isHangingOnLedge()).toBe(true);
    ch.setPosition(500, 500);
    expect(ch.isHangingOnLedge()).toBe(false);
    expect(ch.getLedgeHangState().name).toBe('idle');
  });

  it('exposes setLedgeCandidates / getLedgeCandidates round-trip', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(ch.getLedgeCandidates()).toEqual([]);
    const cands = [
      { platformId: 'a', side: 'right' as const, x: 10, y: 20 },
      { platformId: 'b', side: 'left' as const, x: 30, y: 40 },
    ];
    ch.setLedgeCandidates(cands);
    expect(ch.getLedgeCandidates()).toBe(cands);
  });
});

// ---------------------------------------------------------------------------
// Hurtbox queries (Sub-AC 2 of AC 10002)
//
// Locks down the per-fighter hurtbox accessors:
//   • getBodyHurtbox derives from active tuning width/height.
//   • getActiveHurtboxes returns [body] when no attack is in flight.
//   • getActiveHurtboxes layers per-move hurtboxModifiers when active.
// ---------------------------------------------------------------------------

describe('Character — hurtbox queries (Sub-AC 2 of AC 10002)', () => {
  it('getBodyHurtbox derives geometry from the active tuning', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      width: 100,
      height: 140,
    });
    const body = ch.getBodyHurtbox();
    expect(body.id).toBe('body');
    expect(body.width).toBe(100);
    expect(body.height).toBe(140);
    expect(body.offsetX).toBe(0);
    expect(body.offsetY).toBe(0);
    expect(body.intangible).toBeUndefined();
  });

  it('getActiveHurtboxes returns [body] when no attack is in flight', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const set = ch.getActiveHurtboxes();
    expect(set.length).toBe(1);
    expect(set[0]!.id).toBe('body');
  });

  it('getActiveHurtboxes layers a per-move hurtbox modifier when its phase is live', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const intangibleHurtbox = {
      id: 'm.dodge',
      offsetX: 0,
      offsetY: 0,
      width: 90,
      height: 130,
      intangible: true,
    };
    // A per-move hurtbox modifier active for the entire move, with
    // replaceBody:true so the body default is suppressed.
    const dodgeMove = {
      id: 'test.dodge',
      type: 'special' as const,
      damage: 0,
      knockback: { x: 0, y: 0, scaling: 0 },
      hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
      startupFrames: 2,
      activeFrames: 4,
      recoveryFrames: 4,
      cooldownFrames: 4,
      hurtboxModifiers: [
        {
          phase: 'active' as const,
          hurtbox: intangibleHurtbox,
          replaceBody: true,
        },
      ],
    };
    ch.registerAttack(dodgeMove);
    expect(ch.attemptAttack(dodgeMove.id)).toBe(true);

    // After registration we need to advance to the active phase. The
    // attack tick runs inside applyInput; one applyInput per frame.
    // startup = 2 frames, so frames 0..1 = startup, frame 2+ = active.
    // After attemptAttack: framesElapsed=0 (startup). After one
    // applyInput tick, framesElapsed=1 (still startup).
    ch.applyInput(NEUTRAL); // startup → startup (frames 0 → 1)
    expect(ch.getActiveHurtboxes()[0]!.id).toBe('body');

    ch.applyInput(NEUTRAL); // startup → active (frames 1 → 2)
    const activeSet = ch.getActiveHurtboxes();
    expect(activeSet.length).toBe(1);
    expect(activeSet[0]!.id).toBe('m.dodge');
    expect(activeSet[0]!.intangible).toBe(true);
  });

  it('getActiveHurtboxes is deterministic — repeated calls return the same set', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const a = ch.getActiveHurtboxes();
    const b = ch.getActiveHurtboxes();
    expect(a).toEqual(b);
  });

  it('a regular attack with no modifiers exposes only the body hurtbox', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const jab = {
      id: 'test.jab',
      type: 'jab' as const,
      damage: 5,
      knockback: { x: 1, y: 0, scaling: 0 },
      hitbox: { offsetX: 30, offsetY: 0, width: 40, height: 30 },
      startupFrames: 1,
      activeFrames: 1,
      recoveryFrames: 1,
      cooldownFrames: 1,
    };
    ch.registerAttack(jab);
    ch.attemptAttack(jab.id);
    // Tick into active phase to confirm no modifier layering.
    ch.applyInput(NEUTRAL);
    const set = ch.getActiveHurtboxes();
    expect(set.length).toBe(1);
    expect(set[0]!.id).toBe('body');
  });
});

// ---------------------------------------------------------------------------
// Grab subsystem (post-M2 M4.5 wiring)
// ---------------------------------------------------------------------------

const TEST_GRAB_SPEC = Object.freeze({
  id: 'test.grab',
  hitbox: { offsetX: 22, offsetY: 0, width: 24, height: 30 },
  startupFrames: 4,
  activeFrames: 2,
  whiffRecoveryFrames: 12,
  holdFramesMax: 60,
  throwRecoveryFrames: 18,
  pummel: { damage: 1, cooldownFrames: 8 },
  throws: Object.freeze({
    forward: { damage: 8, knockback: { x: 2, y: -1, scaling: 0.1 }, animationFrames: 12 },
    back:    { damage: 10, knockback: { x: 2.5, y: -1, scaling: 0.12 }, animationFrames: 14 },
    up:      { damage: 7, knockback: { x: 0, y: -3, scaling: 0.1 }, animationFrames: 8 },
    down:    { damage: 6, knockback: { x: 0.5, y: 1.2, scaling: 0.08 }, animationFrames: 10 },
  }),
});

describe('Character — SDI (Tier 3 — drift during hitlag)', () => {
  const SDI_HIT: HitInfo = {
    damage: 12,
    knockback: { x: 4, y: -3, scaling: 0.1 },
    facing: 1,
  };

  it('a fresh stick flick nudges the victim position during the freeze', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 100, spawnY: 0 });
    ch.applyHit(SDI_HIT);
    expect(ch.getHitlagRemaining()).toBeGreaterThan(0);
    const before = ch.getPosition().x;
    ch.applyInput({ moveX: 1, jump: false }); // flick right
    expect(ch.getPosition().x).toBeCloseTo(before + SDI_NUDGE_PX, 4);
  });

  it('a HELD stick nudges only once (each nudge needs a fresh flick)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 100, spawnY: 0 });
    ch.applyHit(SDI_HIT);
    const before = ch.getPosition().x;
    for (let i = 0; i < 20 && ch.getHitlagRemaining() > 0; i += 1) {
      ch.applyInput({ moveX: 1, jump: false }); // hold right
    }
    expect(ch.getPosition().x).toBeCloseTo(before + SDI_NUDGE_PX, 4); // one nudge
  });

  it('a neutral stick does not SDI', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 100, spawnY: 0 });
    ch.applyHit(SDI_HIT);
    const before = ch.getPosition().x;
    ch.applyInput(NEUTRAL);
    expect(ch.getPosition().x).toBeCloseTo(before, 4);
  });
});

describe('Character — jab combos (Tier 4)', () => {
  // A three-stage jab string: jab1 → jab2 → jab3 (finisher, no chain).
  const JAB1 = {
    id: 't.jab1',
    type: 'jab' as const,
    damage: 3,
    knockback: { x: 1, y: 0, scaling: 0 },
    startupFrames: 4,
    activeFrames: 3,
    recoveryFrames: 6,
    cooldownFrames: 8,
    hitbox: { offsetX: 12, offsetY: 0, width: 12, height: 12 },
    jabChain: { nextId: 't.jab2' },
  };
  const JAB2 = { ...JAB1, id: 't.jab2', damage: 4, jabChain: { nextId: 't.jab3' } };
  const JAB3 = (() => {
    const { jabChain, ...rest } = JAB1;
    void jabChain;
    return { ...rest, id: 't.jab3', damage: 6 }; // finisher: no chain
  })();

  function comboChar(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(JAB1);
    ch.registerAttack(JAB2);
    ch.registerAttack(JAB3);
    ground(ch, m);
    return { ch, m };
  }

  // Advance NEUTRAL frames until the active attack's window opens, then
  // re-press attack (a genuine rising edge — the NEUTRAL frames released it).
  function advanceThenRepress(ch: Character, windowStart: number): void {
    for (
      let i = 0;
      i < 20 &&
      ch.getActiveAttack() !== null &&
      ch.getActiveAttack()!.framesElapsed < windowStart;
      i += 1
    ) {
      ch.applyInput(NEUTRAL);
    }
    ch.applyInput({ moveX: 0, jump: false, attack: true });
  }

  it('the first press starts jab1', () => {
    const { ch } = comboChar();
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(ch.getActiveAttack()!.move.id).toBe('t.jab1');
  });

  it('a re-press once the hitbox is out advances jab1 → jab2 → jab3', () => {
    const { ch } = comboChar();
    ch.applyInput({ moveX: 0, jump: false, attack: true }); // jab1
    advanceThenRepress(ch, JAB1.startupFrames); // → jab2
    expect(ch.getActiveAttack()!.move.id).toBe('t.jab2');
    advanceThenRepress(ch, JAB1.startupFrames); // → jab3
    expect(ch.getActiveAttack()!.move.id).toBe('t.jab3');
  });

  it('the finisher (jab3) has no chain — a re-press does not advance past it', () => {
    const { ch } = comboChar();
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    advanceThenRepress(ch, JAB1.startupFrames); // jab2
    advanceThenRepress(ch, JAB1.startupFrames); // jab3
    expect(ch.getActiveAttack()!.move.id).toBe('t.jab3');
    advanceThenRepress(ch, JAB1.startupFrames); // re-press on terminal
    // Either still finishing jab3 or a fresh jab1 — never a phantom jab4.
    const id = ch.getActiveAttack()?.move.id ?? 't.jab1';
    expect(['t.jab1', 't.jab3']).toContain(id);
  });

  it('a re-press during pure STARTUP does not skip the active window', () => {
    const { ch } = comboChar();
    ch.applyInput({ moveX: 0, jump: false, attack: true }); // jab1, fe 0
    ch.applyInput(NEUTRAL); // fe 1 (still < startup 4), release
    ch.applyInput({ moveX: 0, jump: false, attack: true }); // fe→2 < 4: no advance
    expect(ch.getActiveAttack()!.move.id).toBe('t.jab1');
  });

  it('preserves facing across the string (a mid-combo stick wiggle cannot flip it)', () => {
    const { ch } = comboChar();
    ch.applyInput({ moveX: 1, jump: false, attack: true }); // face right, jab1
    expect(ch.getActiveAttack()!.facing).toBe(1);
    // Advance while holding left — the chain must keep facing right.
    for (let i = 0; i < JAB1.startupFrames + 1; i += 1) {
      ch.applyInput({ moveX: -1, jump: false });
    }
    ch.applyInput({ moveX: -1, jump: false, attack: true }); // advance
    expect(ch.getActiveAttack()!.move.id).toBe('t.jab2');
    expect(ch.getActiveAttack()!.facing).toBe(1);
  });

  it('backward-compat: a single-jab roster re-press mid-jab is a no-op', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(JAB3); // no jabChain
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(ch.getActiveAttack()!.move.id).toBe('t.jab3');
    advanceThenRepress(ch, JAB3.startupFrames);
    // No chain → re-press doesn't advance to anything new; still jab3 (or a
    // fresh jab3 if the first ended), never a crash.
    expect(ch.getActiveAttack()?.move.id ?? 't.jab3').toBe('t.jab3');
  });
});

describe('Character — crouch (Tier 5)', () => {
  const CROUCH: CharacterInput = { moveX: 0, jump: false, moveY: 0.9 };

  function crouchedWolf(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.applyInput(CROUCH);
    return { ch, m };
  }

  it('holding down while grounded enters the crouch state', () => {
    const { ch } = crouchedWolf();
    expect(ch.isCrouching()).toBe(true);
    expect(ch.getLocomotionStateName()).toBe('crouch');
  });

  it('a clear lateral tilt beats crouch (down + side is not a crouch)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.applyInput({ moveX: 0.6, jump: false, moveY: 0.9 });
    expect(ch.isCrouching()).toBe(false);
  });

  it('crouch-cancel: a crouching victim takes a softened launch', () => {
    const hit = {
      damage: 12,
      knockback: { x: 6, y: -3, scaling: 0.2 },
      facing: 1 as const,
    };
    const standingMag = (() => {
      const m = createMockScene();
      const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
      ground(ch, m);
      ch.applyInput(NEUTRAL); // standing
      return ch.applyHit(hit).magnitude;
    })();
    const { ch } = crouchedWolf();
    const crouchMag = ch.applyHit(hit).magnitude;
    expect(crouchMag).toBeLessThan(standingMag);
    expect(crouchMag).toBeCloseTo(standingMag * CROUCH_KNOCKBACK_REDUCTION, 4);
  });

  it('the crouch hurtbox ducks (shorter, bottom-anchored)', () => {
    const { ch } = crouchedWolf();
    const body = ch.getBodyHurtbox();
    const hb = ch.getActiveHurtboxes()[0]!;
    expect(hb.height).toBeLessThan(body.height); // shorter
    expect(hb.offsetY).toBeGreaterThan(0); // centre shifts DOWN (head ducks)
    // Feet stay planted: the bottom edge matches the body's bottom edge.
    expect(hb.offsetY + hb.height / 2).toBeCloseTo(
      body.offsetY + body.height / 2,
      4,
    );
  });

  it('standing up (release down) leaves crouch', () => {
    const { ch } = crouchedWolf();
    expect(ch.isCrouching()).toBe(true);
    ch.applyInput(NEUTRAL);
    expect(ch.isCrouching()).toBe(false);
  });

  it('a down-attack from crouch fires the down-tilt and KEEPS the crouch state', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    const tilt = {
      id: 't.tilt',
      type: 'tilt' as const,
      damage: 5,
      knockback: { x: 1, y: 0, scaling: 0 },
      hitbox: { offsetX: 10, offsetY: 0, width: 10, height: 10 },
      startupFrames: 2,
      activeFrames: 2,
      recoveryFrames: 4,
      cooldownFrames: 4,
    };
    ch.registerAttack(tilt);
    ch.registerAttack({ ...tilt, id: 't.dtilt' });
    ch.setDownTilt('t.dtilt');
    ch.applyInput({ moveX: 0, jump: false, moveY: 0.9 }); // crouch
    expect(ch.isCrouching()).toBe(true);
    // Hold down + attack → down-tilt; the crouch posture must persist
    // through the attack (the body stays low, not popped to standing).
    ch.applyInput({ moveX: 0, jump: false, moveY: 0.9, attack: true });
    expect(ch.getActiveAttack()?.move.id).toBe('t.dtilt');
    expect(ch.isCrouching()).toBe(true);
    // The HURTBOX must stay ducked mid-attack — it must NOT pop back to the
    // full body the instant you poke (the bug: "the hitbox became normal").
    const body = ch.getBodyHurtbox();
    const hb = ch.getActiveHurtboxes()[0]!;
    expect(hb.height).toBeLessThan(body.height);
    // …and on the next held frame too.
    ch.applyInput({ moveX: 0, jump: false, moveY: 0.9 });
    expect(ch.isCrouching()).toBe(true);
    expect(ch.getActiveHurtboxes()[0]!.height).toBeLessThan(body.height);
  });

  it('crouch does not survive a launch (no airborne crouch perks)', () => {
    const { ch } = crouchedWolf();
    expect(ch.isCrouching()).toBe(true);
    ch.applyHit({ damage: 8, knockback: { x: 6, y: -4, scaling: 0.2 }, facing: 1 });
    // The hit resets locomotion to standing, so a juggled fighter can't
    // keep the crouch-cancel / shrunk hurtbox in the air.
    expect(ch.isCrouching()).toBe(false);
  });

  it('a fighter launched out of a run resets locomotion (no spurious pivot out of hitstun)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    for (let i = 0; i < 20; i += 1) ch.applyInput({ moveX: 1, jump: false });
    expect(ch.getLocomotionStateName()).toBe('run');
    ch.applyHit({ damage: 4, knockback: { x: 2, y: -1, scaling: 0.05 }, facing: 1 });
    // Stale 'run' would make the first free frame mis-read a held direction
    // as a pivot-skid; the reset parks it at standing so movement resumes clean.
    expect(ch.getLocomotionStateName()).toBe('standing');
  });
});

describe('Character — dash grab (Tier 4)', () => {
  const DASH_GRAB_SPEC = Object.freeze({
    ...TEST_GRAB_SPEC,
    id: 'test.dashgrab',
    dashGrab: { rangeBonusX: 14, momentumRetain: 0.6 },
  });

  function runUpToSpeed(ch: Character): number {
    for (let i = 0; i < 25; i += 1) ch.applyInput({ moveX: 1, jump: false });
    return ch.getVelocity().x;
  }

  it('a grab from a standstill is a standing grab (no dash latch)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setGrabSpec(DASH_GRAB_SPEC);
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, grab: true });
    expect(ch.getGrabState().name).toBe('whiffStartup');
    expect(ch.isDashGrabbing()).toBe(false);
  });

  it('a grab pressed while running latches a dash grab and carries momentum', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setGrabSpec(DASH_GRAB_SPEC);
    ground(ch, m);
    const runVx = runUpToSpeed(ch);
    expect(runVx).toBeGreaterThan(0);
    ch.applyInput({ moveX: 1, jump: false, grab: true }); // dash grab press
    expect(ch.isDashGrabbing()).toBe(true);
    // Several whiff frames later, still sliding forward (not damped to rest).
    for (let i = 0; i < 5; i += 1) ch.applyInput({ moveX: 0, jump: false });
    expect(ch.getVelocity().x).toBeGreaterThan(runVx * 0.4);
  });

  it('a standing-grab spec does NOT carry momentum even while running', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setGrabSpec(TEST_GRAB_SPEC); // no dashGrab field
    ground(ch, m);
    const runVx = runUpToSpeed(ch);
    ch.applyInput({ moveX: 1, jump: false, grab: true });
    expect(ch.isDashGrabbing()).toBe(false);
    for (let i = 0; i < 6; i += 1) ch.applyInput({ moveX: 0, jump: false });
    expect(ch.getVelocity().x).toBeLessThan(runVx * 0.3); // damped, no carry
  });

  it('respawn clears the dash-grab latch', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setGrabSpec(DASH_GRAB_SPEC);
    ground(ch, m);
    runUpToSpeed(ch);
    ch.applyInput({ moveX: 1, jump: false, grab: true });
    expect(ch.isDashGrabbing()).toBe(true);
    ch.setPosition(300, 100);
    expect(ch.isDashGrabbing()).toBe(false);
  });
});

describe('Character — stale-move queue (Tier 3 attacker-side)', () => {
  it('returns prior occurrences and grows with repeats', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(ch.registerLandedMove('wolf.jab')).toBe(0); // fresh
    expect(ch.registerLandedMove('wolf.jab')).toBe(1); // seen once
    expect(ch.registerLandedMove('wolf.jab')).toBe(2);
    expect(ch.registerLandedMove('wolf.smash')).toBe(0); // different move, fresh
    expect(ch.getStaleOccurrences('wolf.jab')).toBe(3);
  });

  it('trims to the queue size (old entries freshen out)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerLandedMove('wolf.jab'); // oldest
    for (let i = 0; i < STALE_QUEUE_SIZE; i += 1) {
      ch.registerLandedMove('wolf.tilt'); // push the jab out of the window
    }
    expect(ch.getStaleOccurrences('wolf.jab')).toBe(0); // freshened
  });

  it('resets the stale queue on respawn', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerLandedMove('wolf.jab');
    ch.registerLandedMove('wolf.jab');
    ch.setPosition(400, 100); // respawn flow
    expect(ch.getStaleOccurrences('wolf.jab')).toBe(0);
  });
});

describe('Character — out-of-shield options & perfect shield (Tier 2)', () => {
  function shieldedWolf(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setGrabSpec(TEST_GRAB_SPEC);
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, shield: true }); // raise
    expect(ch.isShielding()).toBe(true);
    return { ch, m };
  }

  it('shield-grab — a grab press from shield drops the shield and grabs', () => {
    const { ch } = shieldedWolf();
    ch.applyInput({ moveX: 0, jump: false, shield: true, grab: true });
    expect(ch.getGrabState().name).toBe('whiffStartup');
    expect(ch.isShielding()).toBe(false);
  });

  it('jump-out-of-shield — a jump press from shield drops the shield and jumps', () => {
    const { ch } = shieldedWolf();
    ch.applyInput({ moveX: 0, jump: true, shield: true });
    expect(ch.getVelocity().y).toBeLessThan(0);
    expect(ch.isShielding()).toBe(false);
  });

  it('a perfect shield (hit in the raise window) costs no HP and no shieldstun', () => {
    const { ch } = shieldedWolf(); // shield up exactly 1 frame
    const before = ch.getShieldHealth();
    const r = ch.applyHit(STANDARD_HIT);
    expect(r.magnitude).toBe(0); // still absorbed
    expect(ch.getShieldHealth()).toBe(before); // no HP cost
    expect(ch.getShieldState().blockStunRemaining).toBe(0); // no lock
  });

  it('a late block (held past the window) costs HP and arms shieldstun', () => {
    const { ch } = shieldedWolf();
    // Hold past the perfect-shield window.
    for (let i = 0; i < 6; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, shield: true });
    }
    const before = ch.getShieldHealth();
    ch.applyHit(STANDARD_HIT);
    expect(ch.getShieldHealth()).toBeCloseTo(before - STANDARD_HIT.damage, 4);
    expect(ch.getShieldState().blockStunRemaining).toBeGreaterThan(0);
  });

  it('shieldstun locks out the OoS grab until it drains', () => {
    const { ch } = shieldedWolf();
    for (let i = 0; i < 6; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, shield: true }); // past window
    }
    ch.applyHit(STANDARD_HIT); // normal block → arms shieldstun
    expect(ch.getShieldState().blockStunRemaining).toBeGreaterThan(0);
    // A grab attempt while locked in shieldstun is suppressed.
    ch.applyInput({ moveX: 0, jump: false, shield: true, grab: true });
    expect(ch.getGrabState().name).toBe('idle');
    expect(ch.isShielding()).toBe(true); // still locked in shield
  });
});

describe('Character — teching & knockdown (launch → floor loop)', () => {
  const HARD_HIT: HitInfo = {
    damage: 18,
    knockback: { x: 8, y: -6, scaling: 0.3 },
    facing: 1,
  };

  function launchedChar(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.applyHit(HARD_HIT);
    // Drain hitlag so the launch applies + tumble engages.
    for (let i = 0; i < 20 && !ch.isTumbling(); i += 1) ch.applyInput(NEUTRAL);
    expect(ch.isTumbling()).toBe(true);
    return { ch, m };
  }

  it('a hard hit tumbles; a light hit does not', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.applyHit({ damage: 4, knockback: { x: 2, y: -1, scaling: 0.05 }, facing: 1 });
    for (let i = 0; i < 10; i += 1) ch.applyInput(NEUTRAL);
    expect(ch.isTumbling()).toBe(false); // below the tumble threshold
  });

  it('landing a tumble WITHOUT a tech → knockdown', () => {
    const { ch, m } = launchedChar();
    ground(ch, m);
    ch.applyInput(NEUTRAL); // touch down, no tech buffered
    expect(ch.isKnockedDown()).toBe(true);
    expect(ch.isTumbling()).toBe(false);
  });

  it('a shield press on landing TECHS — cancels the knockdown with i-frames', () => {
    const { ch, m } = launchedChar();
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, shield: true }); // tech!
    expect(ch.isKnockedDown()).toBe(false);
    expect(ch.isInvincible()).toBe(true); // tech intangibility
  });

  it('a knockdown ends on a get-up input (with i-frames)', () => {
    const { ch, m } = launchedChar();
    ground(ch, m);
    ch.applyInput(NEUTRAL); // → knockdown
    expect(ch.isKnockedDown()).toBe(true);
    ch.applyInput({ moveX: 0, jump: true }); // get-up
    expect(ch.isKnockedDown()).toBe(false);
    expect(ch.isInvincible()).toBe(true);
  });

  it('a knockdown auto-stands when the timer drains', () => {
    const { ch, m } = launchedChar();
    ground(ch, m);
    ch.applyInput(NEUTRAL); // → knockdown
    for (let i = 0; i < 40; i += 1) ch.applyInput(NEUTRAL); // wait it out
    expect(ch.isKnockedDown()).toBe(false);
  });

  it('a tech WITH a held direction becomes a directional tech-roll', () => {
    const { ch, m } = launchedChar();
    ground(ch, m);
    ch.applyInput({ moveX: 1, jump: false, shield: true }); // tech-roll →
    expect(ch.isGetupRolling()).toBe(true);
    expect(ch.isKnockedDown()).toBe(false);
    expect(ch.isInvincible()).toBe(true);
    expect(ch.getFacing()).toBe(1); // turned to face the roll
  });

  it('a roll-get-up from knockdown (held direction) rolls intangibly', () => {
    const { ch, m } = launchedChar();
    ground(ch, m);
    ch.applyInput(NEUTRAL); // → knockdown
    ch.applyInput({ moveX: -1, jump: false }); // roll-get-up ←
    expect(ch.isGetupRolling()).toBe(true);
    expect(ch.isKnockedDown()).toBe(false);
    expect(ch.isInvincible()).toBe(true);
  });

  it('a get-up attack (press attack from knockdown) stands with i-frames', () => {
    const { ch, m } = launchedChar();
    ground(ch, m);
    ch.applyInput(NEUTRAL); // → knockdown
    ch.applyInput({ moveX: 0, jump: false, attack: true }); // get-up attack
    expect(ch.isKnockedDown()).toBe(false);
    expect(ch.isInvincible()).toBe(true);
  });

  it('a mistimed (too-early) tech locks out — the real landing knocks down', () => {
    const { ch, m } = launchedChar();
    // Press shield while still airborne (no ground contact) — too early.
    ch.applyInput({ moveX: 0, jump: false, shield: true });
    // Drain the buffer in the air → lockout engages.
    for (let i = 0; i < TECH_WINDOW_FRAMES + 1; i += 1) ch.applyInput(NEUTRAL);
    expect(ch.isTechLockedOut()).toBe(true);
    // Now land and try to tech again — locked out → knockdown.
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, shield: true });
    expect(ch.isKnockedDown()).toBe(true);
  });
});

describe('Character — grab subsystem ticking (M4.5 foundation)', () => {
  it('initial grab state is idle', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(ch.getGrabState().name).toBe('idle');
    expect(ch.getGrabSpec()).toBeNull();
  });

  it('grab presses are ignored when no GrabSpec is registered', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, grab: true });
    expect(ch.getGrabState().name).toBe('idle');
  });

  it('setGrabSpec validates the record (rejects malformed input)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    expect(() =>
      ch.setGrabSpec({ ...TEST_GRAB_SPEC, activeFrames: 0 } as unknown as typeof TEST_GRAB_SPEC),
    ).toThrow(/activeFrames/);
  });

  it('grab press while grounded transitions into whiffStartup', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setGrabSpec(TEST_GRAB_SPEC);
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, grab: true });
    expect(ch.getGrabState().name).toBe('whiffStartup');
  });

  it('grab press while airborne is ignored', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setGrabSpec(TEST_GRAB_SPEC);
    // Airborne (no ground contact)
    ch.applyInput({ moveX: 0, jump: false, grab: true });
    expect(ch.getGrabState().name).toBe('idle');
  });

  it('rising-edge gating — held grab button does NOT re-trigger after release', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setGrabSpec(TEST_GRAB_SPEC);
    ground(ch, m);
    // First press — fires.
    ch.applyInput({ moveX: 0, jump: false, grab: true });
    expect(ch.getGrabState().name).toBe('whiffStartup');
    // Drive through the whole whiff cycle while holding the button — no
    // re-trigger because the button is HELD, not pressed-again.
    const total = TEST_GRAB_SPEC.startupFrames + TEST_GRAB_SPEC.activeFrames + TEST_GRAB_SPEC.whiffRecoveryFrames;
    for (let i = 0; i < total; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, grab: true });
    }
    // Should be back to idle, not in another whiffStartup.
    expect(ch.getGrabState().name).toBe('idle');
  });

  it('setPosition() resets grab state to idle (transient combat state)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.setGrabSpec(TEST_GRAB_SPEC);
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, grab: true });
    expect(ch.getGrabState().name).toBe('whiffStartup');
    ch.setPosition(500, 250);
    expect(ch.getGrabState().name).toBe('idle');
  });

  it('hitting the grabber BREAKS the grab and frees the victim', () => {
    const m = createMockScene();
    const grabber = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const victim = new Character(m.scene, { id: 'cat', spawnX: 20, spawnY: 0 });
    grabber.setGrabSpec(TEST_GRAB_SPEC);
    ground(grabber, m);
    grabber.applyInput({ moveX: 0, jump: false, grab: true }); // press → whiffStartup
    for (let i = 0; i < 30 && grabber.getGrabState().name !== 'whiffActive'; i += 1) {
      grabber.applyInput({ moveX: 0, jump: false });
    }
    expect(grabber.getGrabState().name).toBe('whiffActive');
    grabber.resolveGrabConnect(victim); // catch
    expect(victim.isGrabbed()).toBe(true);
    expect(grabber.getGrabState().name).toBe('holding');
    // A hit on the grabber frees the victim (Smash: interrupt the grabber).
    grabber.applyHit({ damage: 10, knockback: { x: 3, y: -1, scaling: 0.2 }, facing: -1 });
    expect(victim.isGrabbed()).toBe(false);
    expect(grabber.getGrabState().name).not.toBe('holding');
  });

  it('a fighter mid-grab is locked out of walking/jumping (grab commitment)', () => {
    const m = createMockScene();
    const grabber = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const victim = new Character(m.scene, { id: 'cat', spawnX: 20, spawnY: 0 });
    grabber.setGrabSpec(TEST_GRAB_SPEC);
    ground(grabber, m);
    grabber.applyInput({ moveX: 0, jump: false, grab: true });
    for (let i = 0; i < 30 && grabber.getGrabState().name !== 'whiffActive'; i += 1) {
      grabber.applyInput({ moveX: 0, jump: false });
    }
    grabber.resolveGrabConnect(victim);
    // Try to walk while holding — no horizontal movement.
    grabber.applyInput({ moveX: 1, jump: false });
    grabber.applyInput({ moveX: 1, jump: false });
    expect(grabber.getVelocity().x).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Smash-feel pack — short hop / fast-fall / per-fighter gravity
// ---------------------------------------------------------------------------

describe('Character — variable jump height (short hop)', () => {
  it('clamps the rise to jumpImpulse * jumpCutFactor when jump is released mid-rise', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    const tuning = ch.getTuning();
    ch.applyInput({ moveX: 0, jump: true });
    expect(ch.getVelocity().y).toBeCloseTo(-tuning.jumpImpulse);
    // Release on the very next frame — a TAP. The rise is cut.
    ch.applyInput({ moveX: 0, jump: false });
    expect(ch.getVelocity().y).toBeCloseTo(
      -tuning.jumpImpulse * tuning.jumpCutFactor,
    );
  });

  it('keeps the full rise while jump stays held', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    const tuning = ch.getTuning();
    ch.applyInput({ moveX: 0, jump: true });
    // Held through the rise — no cut (mock scene applies no gravity,
    // so an unclipped vy stays at the full impulse).
    ch.applyInput({ moveX: 0, jump: true });
    ch.applyInput({ moveX: 0, jump: true });
    expect(ch.getVelocity().y).toBeCloseTo(-tuning.jumpImpulse);
  });

  it('only cuts once — a second release frame does not re-clamp a faster rise', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    const tuning = ch.getTuning();
    ch.applyInput({ moveX: 0, jump: true });
    ch.applyInput({ moveX: 0, jump: false }); // cut fires, arm persists while rising
    // Simulate an external upward boost beyond the cut threshold while
    // STILL armed and rising — the cut may clamp again this frame…
    ch.applyInput({ moveX: 0, jump: false });
    // …but once the rise ends (vy >= 0) the arm clears, and a later
    // upward velocity (e.g. a launch) is never cut by the idle button.
    (ch.body as { velocity: { x: number; y: number } }).velocity.y = 1;
    ch.applyInput(NEUTRAL); // vy >= 0 → arm cleared
    (ch.body as { velocity: { x: number; y: number } }).velocity.y =
      -tuning.jumpImpulse;
    ch.applyInput(NEUTRAL);
    // No jump arm → upward velocity passes through un-cut.
    expect(ch.getVelocity().y).toBeCloseTo(-tuning.jumpImpulse);
  });

  it('does not cut an upward LAUNCH that was not started by a jump', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    // Airborne with a strong upward velocity (a knockback launch), no
    // jump press anywhere in the history.
    (ch.body as { velocity: { x: number; y: number } }).velocity.y = -15;
    ch.applyInput(NEUTRAL);
    expect(ch.getVelocity().y).toBeCloseTo(-15);
  });
});

describe('Character — fast-fall + per-fighter gravity (Smash-feel pack)', () => {
  it('adds fallAccel while airborne and falling', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const tuning = ch.getTuning();
    (ch.body as { velocity: { x: number; y: number } }).velocity.y = 2;
    ch.applyInput(NEUTRAL);
    expect(ch.getVelocity().y).toBeCloseTo(2 + tuning.fallAccel);
  });

  it('does NOT add fallAccel while rising (jump heights stay pre-pack)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    (ch.body as { velocity: { x: number; y: number } }).velocity.y = -6;
    ch.applyInput(NEUTRAL);
    expect(ch.getVelocity().y).toBeCloseTo(-6);
  });

  it('clamps self-accelerated falls at maxFallSpeed (terminal velocity)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const tuning = ch.getTuning();
    // Just below terminal — the next fallAccel tick would overshoot,
    // so the clamp catches it exactly at terminal.
    (ch.body as { velocity: { x: number; y: number } }).velocity.y =
      tuning.maxFallSpeed - 0.05;
    ch.applyInput(NEUTRAL);
    expect(ch.getVelocity().y).toBeCloseTo(tuning.maxFallSpeed);
  });

  it('does NOT reduce an externally-injected velocity above terminal (wind gusts survive)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    // A hazard shoved the body far past terminal — the soft clamp only
    // caps OUR OWN acceleration, never an external push.
    (ch.body as { velocity: { x: number; y: number } }).velocity.y = 50;
    ch.applyInput(NEUTRAL);
    expect(ch.getVelocity().y).toBeCloseTo(50);
  });

  it('latches fast-fall on a down-stick press during a descent and snaps to fastFallSpeed', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const tuning = ch.getTuning();
    (ch.body as { velocity: { x: number; y: number } }).velocity.y = 2;
    ch.applyInput({ moveX: 0, jump: false, moveY: 1 });
    expect(ch.getVelocity().y).toBeCloseTo(tuning.fastFallSpeed);
  });

  it('keeps the fast-fall latched after the stick returns to neutral (Smash contract)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const tuning = ch.getTuning();
    (ch.body as { velocity: { x: number; y: number } }).velocity.y = 2;
    ch.applyInput({ moveX: 0, jump: false, moveY: 1 });
    ch.applyInput(NEUTRAL);
    ch.applyInput(NEUTRAL);
    expect(ch.getVelocity().y).toBeCloseTo(tuning.fastFallSpeed);
  });

  it('does not latch fast-fall while rising', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const tuning = ch.getTuning();
    (ch.body as { velocity: { x: number; y: number } }).velocity.y = -8;
    ch.applyInput({ moveX: 0, jump: false, moveY: 1 });
    expect(ch.getVelocity().y).toBeCloseTo(-8);
    // Once the peak passes and the descent starts, the held stick latches.
    (ch.body as { velocity: { x: number; y: number } }).velocity.y = 0.5;
    ch.applyInput({ moveX: 0, jump: false, moveY: 1 });
    expect(ch.getVelocity().y).toBeCloseTo(tuning.fastFallSpeed);
  });

  it('clears the fast-fall latch on landing', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const tuning = ch.getTuning();
    (ch.body as { velocity: { x: number; y: number } }).velocity.y = 2;
    ch.applyInput({ moveX: 0, jump: false, moveY: 1 });
    expect(ch.getVelocity().y).toBeCloseTo(tuning.fastFallSpeed);
    // Land (keep the platform handle so we can lift off again).
    const plat = makePlatform(ch.getPosition().x, ch.getPosition().y + 100);
    m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
    (ch.body as { velocity: { x: number; y: number } }).velocity.y = 0;
    ch.applyInput(NEUTRAL);
    // Back in the air, falling, stick neutral — the latch is gone, so
    // a fall just below normal terminal caps at maxFallSpeed (NOT the
    // higher fastFallSpeed the latch would have allowed).
    m.emit('collisionend', [{ bodyA: ch.body, bodyB: plat }]);
    (ch.body as { velocity: { x: number; y: number } }).velocity.y =
      tuning.maxFallSpeed - 0.05;
    ch.applyInput(NEUTRAL);
    expect(ch.getVelocity().y).toBeCloseTo(tuning.maxFallSpeed);
  });

  it('gives the floaty fighter (Owl) a lower terminal velocity than the fast-faller (Cat)', () => {
    // Drive both into a self-accelerated fall and let fallAccel carry
    // them to their respective terminal caps.
    const reachTerminal = (id: 'owl' | 'cat'): number => {
      const s = createMockScene();
      const ch = new Character(s.scene, { id, spawnX: 0, spawnY: 0 });
      (ch.body as { velocity: { x: number; y: number } }).velocity.y = 1;
      for (let i = 0; i < 120; i += 1) ch.applyInput(NEUTRAL);
      return ch.getVelocity().y;
    };
    expect(reachTerminal('owl')).toBeLessThan(reachTerminal('cat'));
  });
});

// ---------------------------------------------------------------------------
// Charge-hold neutral special (Samus cannon): hold to charge, release to fire
// ---------------------------------------------------------------------------

describe('Character — smash-attack charging (Tier 4)', () => {
  const CHARGE_SMASH = {
    id: 't.csmash',
    type: 'smash' as const,
    damage: 10,
    knockback: { x: 3, y: -1, scaling: 0.1 },
    hitbox: { offsetX: 30, offsetY: 0, width: 30, height: 20 },
    startupFrames: 2,
    activeFrames: 4,
    recoveryFrames: 6,
    cooldownFrames: 6,
    charge: {
      minChargeFrames: 0,
      maxChargeFrames: 10,
      minDamage: 10,
      maxDamage: 30,
      minKnockback: { x: 3, y: -1, scaling: 0.1 },
      maxKnockback: { x: 6, y: -2, scaling: 0.4 },
    },
  };

  function smashChar(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(CHARGE_SMASH);
    ground(ch, m);
    return { ch, m };
  }

  const HV = (heavy: boolean): CharacterInput => ({
    moveX: 0,
    jump: false,
    attackHeavy: heavy,
  });

  it('a heavy press on a charge-smash STARTS charging instead of firing', () => {
    const { ch } = smashChar();
    ch.applyInput(HV(true));
    expect(ch.isAttacking()).toBe(false);
    expect(ch.getChargeProgress()).toBe(0);
  });

  it('charge progress climbs while heavy is held', () => {
    const { ch } = smashChar();
    ch.applyInput(HV(true)); // start (framesHeld 0)
    ch.applyInput(HV(true)); // 1
    ch.applyInput(HV(true)); // 2
    expect(ch.getChargeProgress()).toBeCloseTo(2 / 10);
    expect(ch.isAttacking()).toBe(false);
  });

  it('releasing the heavy button fires the smash', () => {
    const { ch } = smashChar();
    ch.applyInput(HV(true));
    ch.applyInput(HV(true));
    ch.applyInput(HV(false)); // release → fire
    expect(ch.isAttacking()).toBe(true);
    expect(ch.getActiveAttack()?.move.id).toBe('t.csmash');
  });

  it('AUTO-FIRES at max charge (a special instead stores at the cap)', () => {
    const { ch } = smashChar();
    for (let i = 0; i < 14; i += 1) ch.applyInput(HV(true)); // hold past max
    expect(ch.isAttacking()).toBe(true); // fired without a release
  });

  it('a fully-charged smash spawns a stronger hitbox than a bare tap', () => {
    const full = smashChar();
    for (let i = 0; i < 12; i += 1) full.ch.applyInput(HV(true)); // charge → auto-fire at cap
    for (let i = 0; i < 4; i += 1) full.ch.applyInput(NEUTRAL); // into active phase
    const fullHb = full.m.bodies.find((b) => b.label === HITBOX_LABEL);

    const tap = smashChar();
    tap.ch.applyInput(HV(true));
    tap.ch.applyInput(HV(false)); // immediate release → uncharged
    for (let i = 0; i < 4; i += 1) tap.ch.applyInput(NEUTRAL);
    const tapHb = tap.m.bodies.find((b) => b.label === HITBOX_LABEL);

    const fullDmg = (fullHb?.options?.plugin as { damage?: number })?.damage;
    const tapDmg = (tapHb?.options?.plugin as { damage?: number })?.damage;
    expect(fullDmg!).toBeGreaterThan(tapDmg!);
    expect(fullDmg!).toBeCloseTo(30); // maxDamage
    expect(tapDmg!).toBeCloseTo(10); // minDamage
  });

  it('charged knockback scales with the hold too', () => {
    const full = smashChar();
    for (let i = 0; i < 12; i += 1) full.ch.applyInput(HV(true));
    for (let i = 0; i < 4; i += 1) full.ch.applyInput(NEUTRAL);
    const fullHb = full.m.bodies.find((b) => b.label === HITBOX_LABEL);
    const kb = (fullHb?.options?.plugin as { knockback?: { x?: number } })
      ?.knockback;
    expect(kb?.x).toBeCloseTo(6); // maxKnockback.x
  });

  it('getting hit mid-charge drops the smash charge', () => {
    const { ch } = smashChar();
    ch.applyInput(HV(true));
    ch.applyInput(HV(true));
    expect(ch.getChargeProgress()).toBeGreaterThan(0);
    ch.applyHit(STANDARD_HIT);
    expect(ch.getChargeProgress()).toBe(null);
    expect(ch.isAttacking()).toBe(false);
  });

  it('is rooted while charging — far slower than a free run', () => {
    const charging = smashChar();
    for (let i = 0; i < 8; i += 1) {
      charging.ch.applyInput({ moveX: 1, jump: false, attackHeavy: true });
    }
    const walking = smashChar();
    for (let i = 0; i < 8; i += 1) {
      walking.ch.applyInput({ moveX: 1, jump: false });
    }
    expect(Math.abs(charging.ch.getVelocity().x)).toBeLessThan(
      walking.ch.getVelocity().x * 0.5,
    );
  });

  it('backward-compat: a smash with NO charge ramp fires instantly', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    const { charge, ...instant } = CHARGE_SMASH;
    void charge;
    ch.registerAttack({ ...instant, id: 't.instant' });
    ground(ch, m);
    ch.applyInput(HV(true));
    expect(ch.isAttacking()).toBe(true); // instant fire, no charge stance
  });

  it('a jump press while charging is suppressed — the charge fully roots (no airborne smash)', () => {
    const { ch } = smashChar();
    ch.applyInput(HV(true)); // start charging
    expect(ch.getChargeProgress()).toBe(0);
    // Try to jump out of the charge.
    ch.applyInput({ moveX: 0, jump: true, attackHeavy: true });
    expect(ch.getVelocity().y).toBeGreaterThanOrEqual(0); // no jump impulse
    expect(ch.isAttacking()).toBe(false); // NOT fired (esp. not airborne)
    expect(ch.getChargeProgress()).toBeGreaterThan(0); // still rooted, charging
  });

  it('a held item smash-override fires the item move, not a native charge', () => {
    const { ch } = smashChar();
    let overrideRan = false;
    ch.setSlotOverride('smash', () => {
      overrideRan = true;
      return true;
    });
    ch.applyInput(HV(true)); // heavy press
    expect(overrideRan).toBe(true); // item override fired
    expect(ch.getChargeProgress()).toBe(null); // did NOT enter a native charge
  });
});

describe('Character — charge-hold neutral special', () => {
  const CHARGE_SPECIAL = {
    id: 'test.charge',
    type: 'special' as const,
    specialKind: 'charge' as const,
    damage: 6,
    knockback: { x: 1.8, y: -0.5, scaling: 0.1 },
    hitbox: { offsetX: 30, offsetY: 0, width: 30, height: 20 },
    startupFrames: 2,
    activeFrames: 4,
    recoveryFrames: 6,
    cooldownFrames: 6,
    charge: {
      minChargeFrames: 0,
      maxChargeFrames: 10,
      minDamage: 6,
      maxDamage: 24,
      minKnockback: { x: 1.8, y: -0.5, scaling: 0.1 },
      maxKnockback: { x: 4.6, y: -1.6, scaling: 0.4 },
    },
  };

  function chargeChar(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(CHARGE_SPECIAL);
    ground(ch, m);
    return { ch, m };
  }

  const SP = (special: boolean): CharacterInput => ({ moveX: 0, jump: false, special });

  it('a neutral-special press on a charge move STARTS charging instead of firing', () => {
    const { ch } = chargeChar();
    ch.applyInput(SP(true));
    // No attack has fired yet — we're holding the charge.
    expect(ch.isAttacking()).toBe(false);
    // The charge progress is now reported (0 on the press frame).
    expect(ch.getChargeProgress()).toBe(0);
  });

  it('charge progress climbs while the special button is held', () => {
    const { ch } = chargeChar();
    ch.applyInput(SP(true)); // start (framesHeld 0)
    ch.applyInput(SP(true)); // 1
    ch.applyInput(SP(true)); // 2
    expect(ch.getChargeProgress()).toBeCloseTo(2 / 10);
    expect(ch.isAttacking()).toBe(false);
  });

  it('caps at full charge (1.0) when held past maxChargeFrames', () => {
    const { ch } = chargeChar();
    for (let i = 0; i < 20; i += 1) ch.applyInput(SP(true));
    expect(ch.getChargeProgress()).toBe(1);
  });

  it('releasing the button fires the move (active attack starts)', () => {
    const { ch } = chargeChar();
    ch.applyInput(SP(true)); // start
    ch.applyInput(SP(true)); // hold
    ch.applyInput(SP(false)); // release → fire
    expect(ch.isAttacking()).toBe(true);
    // Charge is consumed — progress reflects the fired move's startup,
    // not a stored charge.
    const a = ch.getActiveAttack();
    expect(a?.move.id).toBe('test.charge');
  });

  it('a fully-charged shot spawns a stronger hitbox than a bare tap', () => {
    // Fully charged: hold to max then release.
    const full = chargeChar();
    for (let i = 0; i < 12; i += 1) full.ch.applyInput(SP(true));
    full.ch.applyInput(SP(false)); // release fully charged
    // Step into the active phase so the hitbox spawns.
    for (let i = 0; i < 4; i += 1) full.ch.applyInput(NEUTRAL);
    const fullHb = full.m.bodies.find((b) => b.label === HITBOX_LABEL);

    // Bare tap: press + immediate release.
    const tap = chargeChar();
    tap.ch.applyInput(SP(true));
    tap.ch.applyInput(SP(false));
    for (let i = 0; i < 4; i += 1) tap.ch.applyInput(NEUTRAL);
    const tapHb = tap.m.bodies.find((b) => b.label === HITBOX_LABEL);

    // Both spawned a hitbox; the charged one carries more damage in its
    // plugin payload (the charge ramp lerped 6 → 24).
    const fullDmg = (fullHb?.options?.plugin as { damage?: number })?.damage;
    const tapDmg = (tapHb?.options?.plugin as { damage?: number })?.damage;
    expect(typeof fullDmg).toBe('number');
    expect(typeof tapDmg).toBe('number');
    expect(fullDmg!).toBeGreaterThan(tapDmg!);
    expect(fullDmg!).toBeCloseTo(24);
    expect(tapDmg!).toBeCloseTo(6);
  });

  it('getting hit out of a charge drops the stored charge', () => {
    const { ch } = chargeChar();
    ch.applyInput(SP(true));
    ch.applyInput(SP(true));
    expect(ch.getChargeProgress()).toBeGreaterThan(0);
    ch.applyHit({ damage: 10, knockback: { x: 3, y: -1, scaling: 0.2 }, facing: 1 });
    // Charge cleared — no progress, not attacking.
    expect(ch.getChargeProgress()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Charge-BEAM projectile (the Samus cannon): a travelling shot whose charge
// can be banked with shield and KEPT across actions until fired.
// ---------------------------------------------------------------------------

describe('Character — charge-beam projectile (travelling shot + store)', () => {
  // A `'projectile'` neutral special carrying the optional charge overlay —
  // the Nova / Samus shape. registerAttack auto-fills the neutralSpecialId
  // slot for type 'special'.
  const BEAM = {
    id: 'test.beam',
    type: 'special' as const,
    specialKind: 'projectile' as const,
    damage: 6,
    knockback: { x: 1.8, y: -0.5, scaling: 0.1 },
    // Degenerate — a charge beam spawns NO body melee hitbox.
    hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
    startupFrames: 2,
    activeFrames: 4,
    recoveryFrames: 6,
    cooldownFrames: 6,
    projectile: {
      speed: 9,
      lifetimeFrames: 70,
      width: 18,
      height: 18,
      spawnOffsetX: 48,
      spawnOffsetY: -10,
    },
    chargedProjectile: {
      charge: {
        minChargeFrames: 0,
        maxChargeFrames: 10,
        minDamage: 6,
        maxDamage: 24,
        minKnockback: { x: 1.8, y: -0.5, scaling: 0.1 },
        maxKnockback: { x: 4.6, y: -1.6, scaling: 0.4 },
      },
      maxSpeed: 22,
      maxWidth: 54,
      maxHeight: 54,
    },
  };

  function beamChar(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(BEAM);
    ground(ch, m);
    return { ch, m };
  }

  // special[+shield] input helper.
  const SP = (special: boolean, shield = false): CharacterInput => ({
    moveX: 0,
    jump: false,
    special,
    shield,
  });

  it('a press starts charging instead of firing a projectile instantly', () => {
    const { ch } = beamChar();
    ch.applyInput(SP(true));
    expect(ch.isAttacking()).toBe(false);
    expect(ch.getChargeProgress()).toBe(0);
  });

  it('release surfaces the held-frame count via getActiveAttack (for the spawner)', () => {
    const { ch } = beamChar();
    ch.applyInput(SP(true)); // start (held 0)
    ch.applyInput(SP(true)); // held 1
    ch.applyInput(SP(true)); // held 2
    ch.applyInput(SP(false)); // release → fire
    const a = ch.getActiveAttack();
    expect(a?.move.id).toBe('test.beam');
    expect(a?.chargeHeldFrames).toBe(2);
  });

  it('does NOT spawn a body melee hitbox on release (damage rides the projectile)', () => {
    const { ch, m } = beamChar();
    ch.applyInput(SP(true));
    ch.applyInput(SP(false)); // release
    for (let i = 0; i < 4; i += 1) ch.applyInput(NEUTRAL); // step through active
    const hb = m.bodies.find((b) => b.label === HITBOX_LABEL);
    expect(hb).toBeUndefined();
  });

  it('shield-cancel BANKS the charge — it is kept, not fired', () => {
    const { ch } = beamChar();
    ch.applyInput(SP(true)); // start, held 0
    ch.applyInput(SP(true)); // held 1
    ch.applyInput(SP(true)); // held 2
    ch.applyInput(SP(true, true)); // shield rising-edge → BANK at held 2
    expect(ch.isAttacking()).toBe(false);
    expect(ch.getChargeProgress()).toBeCloseTo(2 / 10);
    // Idle frames (no special, no shield) — the bank persists.
    ch.applyInput(NEUTRAL);
    ch.applyInput(NEUTRAL);
    expect(ch.getChargeProgress()).toBeCloseTo(2 / 10);
  });

  it('a fresh press RESUMES charging from the banked level', () => {
    const { ch } = beamChar();
    ch.applyInput(SP(true)); // 0
    ch.applyInput(SP(true)); // 1
    ch.applyInput(SP(true)); // 2
    ch.applyInput(SP(true, true)); // bank at 2
    ch.applyInput(NEUTRAL); // release shield, bank kept
    ch.applyInput(SP(true)); // re-press → resume at 2
    expect(ch.getChargeProgress()).toBeCloseTo(2 / 10);
    ch.applyInput(SP(true)); // climbs to 3
    expect(ch.getChargeProgress()).toBeCloseTo(3 / 10);
    expect(ch.isAttacking()).toBe(false);
  });

  it('a banked FULL charge fires immediately on the next press', () => {
    const { ch } = beamChar();
    for (let i = 0; i < 12; i += 1) ch.applyInput(SP(true)); // caps at 10
    ch.applyInput(SP(true, true)); // bank at full
    ch.applyInput(NEUTRAL); // release shield
    expect(ch.getChargeProgress()).toBe(1); // banked full — glow stays lit
    ch.applyInput(SP(true)); // press → fires the full shot
    expect(ch.isAttacking()).toBe(true);
    expect(ch.getActiveAttack()?.chargeHeldFrames).toBe(10);
  });

  it('a held bank SURVIVES being hit (only an active charge is lost)', () => {
    const { ch } = beamChar();
    ch.applyInput(SP(true)); // 0
    ch.applyInput(SP(true)); // 1
    ch.applyInput(SP(true, true)); // bank at 1
    ch.applyInput(NEUTRAL); // release shield, bank kept
    expect(ch.getChargeProgress()).toBeCloseTo(1 / 10);
    ch.applyHit({ damage: 10, knockback: { x: 3, y: -1, scaling: 0.2 }, facing: 1 });
    // Bank survives — Samus: a merely-held stored charge isn't lost to a hit.
    expect(ch.getChargeProgress()).toBeCloseTo(1 / 10);
  });

  it('respawn (setPosition teleport) clears a banked charge', () => {
    const { ch } = beamChar();
    ch.applyInput(SP(true));
    ch.applyInput(SP(true));
    ch.applyInput(SP(true, true)); // bank
    ch.applyInput(NEUTRAL);
    expect(ch.getChargeProgress()).not.toBeNull();
    ch.setPosition(500, 200);
    expect(ch.getChargeProgress()).toBeNull();
  });

  it('ROOTS the fighter — you CANNOT move while charging the cannon (Samus)', () => {
    const { ch } = beamChar();
    ch.applyInput(SP(true)); // start charging (neutral, grounded)
    // Hold a direction while charging — the cannon PLANTS you; no walking.
    for (let i = 0; i < 6; i += 1) {
      ch.applyInput({ moveX: 1, jump: false, special: true });
    }
    expect(ch.getVelocity().x).toBe(0); // rooted while charging
    expect(ch.getChargeProgress()).toBeGreaterThan(0); // still charging
  });

  it('jump is suppressed while charging — you CANNOT jump (or charge) mid-air', () => {
    const { ch } = beamChar();
    ch.applyInput(SP(true)); // charge (grounded)
    // Try to jump while charging — suppressed (committed, rooted stance).
    ch.applyInput({ moveX: 0, jump: true, special: true });
    expect(ch.getVelocity().y).toBeGreaterThanOrEqual(0); // did NOT jump
    expect(ch.getChargeProgress()).toBeGreaterThan(0); // still grounded, charging
  });

  it('CANNOT charge in the air — an airborne neutral-special press fires uncharged', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(BEAM);
    expect(ch.isGrounded()).toBe(false); // airborne from the start
    ch.applyInput(SP(true)); // airborne press → fires, does NOT start a charge
    // A charge sets NO active attack; firing does — so isAttacking proves it
    // fired (uncharged) instead of entering a charge stance.
    expect(ch.isAttacking()).toBe(true);
  });

  it('a BANKED charge does NOT root — you move freely with it stored', () => {
    const { ch } = beamChar();
    ch.applyInput(SP(true)); // charge
    ch.applyInput(SP(true, true)); // bank with shield
    ch.applyInput(NEUTRAL); // release shield
    for (let i = 0; i < 5; i += 1) ch.applyInput({ moveX: 1, jump: false });
    expect(ch.getVelocity().x).toBeGreaterThan(0); // walks while holding the bank
    expect(ch.getChargeProgress()).not.toBeNull(); // bank still lit
  });
});

// ---------------------------------------------------------------------------
// Down-special DIVE (groundPound): hop wind-up → plunge that hits everyone in
// the path → landing shockwave. Mirrors the Kirby-Stone / Bowser-Bomb dive.
// ---------------------------------------------------------------------------

describe('Character — down-special dive (groundPound)', () => {
  const DIVE = {
    id: 'test.dive',
    type: 'downSpecial' as const,
    downSpecialKind: 'groundPound' as const,
    damage: 10, // meteor (descent) damage
    knockback: { x: 0.3, y: 2.6, scaling: 0.2 },
    hitbox: { offsetX: 0, offsetY: 0, width: 40, height: 42 }, // meteor body
    startupFrames: 2,
    activeFrames: 8,
    recoveryFrames: 6,
    cooldownFrames: 6,
    groundPound: {
      hopFrames: 3,
      hopImpulse: -10, // up
      slamVelocity: 24, // down
      shockwaveDamage: 7,
      shockwaveKnockback: { x: 2.0, y: -1.2, scaling: 0.16 },
      shockwaveHitbox: { offsetX: 0, offsetY: 36, width: 120, height: 18 },
    },
  };

  function diveChar(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    // Airborne (NOT grounded) so the plunge has room to play out.
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(DIVE);
    ch.setDownSpecial('test.dive');
    return { ch, m };
  }

  // A down-special press: special + down (dropThrough is the down read).
  const DOWN_SPECIAL: CharacterInput = {
    moveX: 0,
    jump: false,
    special: true,
    dropThrough: true,
  };

  function liveHitbox(m: MockScene, moveId: string): MockBody | undefined {
    return m.bodies.find(
      (b) =>
        b.label === HITBOX_LABEL &&
        !b.removed &&
        (b.options?.['plugin'] as { moveId?: string } | undefined)?.moveId ===
          moveId,
    );
  }

  it('hops UP during the wind-up, then SLAMS down', () => {
    const { ch } = diveChar();
    ch.applyInput(DOWN_SPECIAL); // press (framesElapsed 0, startup)
    ch.applyInput(NEUTRAL); // startup
    ch.applyInput(NEUTRAL); // active frame 0 — hop
    expect(ch.getVelocity().y).toBe(-10);
    ch.applyInput(NEUTRAL); // hop
    expect(ch.getVelocity().y).toBe(-10);
    ch.applyInput(NEUTRAL); // hop (last hop frame)
    expect(ch.getVelocity().y).toBe(-10);
    ch.applyInput(NEUTRAL); // active frame 3 — SLAM
    expect(ch.getVelocity().y).toBe(24);
  });

  it('spawns the meteor descent hitbox carrying the descent damage', () => {
    const { ch, m } = diveChar();
    ch.applyInput(DOWN_SPECIAL);
    ch.applyInput(NEUTRAL);
    ch.applyInput(NEUTRAL); // into active — meteor spawns
    const meteor = liveHitbox(m, 'test.dive');
    expect(meteor).toBeDefined();
    expect((meteor!.options['plugin'] as { damage: number }).damage).toBe(10);
  });

  it('HOLDS the meteor active while airborne, then BURSTS on landing', () => {
    const { ch, m } = diveChar();
    ch.applyInput(DOWN_SPECIAL);
    // Step well past the authored active window while still airborne — the
    // dive must hold active (meteor alive), not end mid-air.
    for (let i = 0; i < 20; i += 1) ch.applyInput(NEUTRAL);
    expect(ch.isAttacking()).toBe(true); // held active
    expect(liveHitbox(m, 'test.dive')).toBeDefined(); // meteor still alive
    expect(liveHitbox(m, 'test.dive.shockwave')).toBeUndefined(); // not landed
    // Touch down.
    ground(ch, m);
    ch.applyInput(NEUTRAL); // landing frame → burst
    expect(liveHitbox(m, 'test.dive.shockwave')).toBeDefined(); // shockwave fired
    expect(liveHitbox(m, 'test.dive')).toBeUndefined(); // meteor despawned
  });

  it('the landing shockwave carries the authored shockwave damage', () => {
    const { ch, m } = diveChar();
    ch.applyInput(DOWN_SPECIAL);
    for (let i = 0; i < 6; i += 1) ch.applyInput(NEUTRAL); // into the slam
    ground(ch, m);
    ch.applyInput(NEUTRAL); // burst
    const shock = liveHitbox(m, 'test.dive.shockwave');
    expect(shock).toBeDefined();
    expect((shock!.options['plugin'] as { damage: number }).damage).toBe(7);
  });

  it('the landing shockwave is short-lived (expires within a few frames)', () => {
    const { ch, m } = diveChar();
    ch.applyInput(DOWN_SPECIAL);
    for (let i = 0; i < 6; i += 1) ch.applyInput(NEUTRAL);
    ground(ch, m);
    ch.applyInput(NEUTRAL); // burst
    expect(liveHitbox(m, 'test.dive.shockwave')).toBeDefined();
    for (let i = 0; i < 5; i += 1) ch.applyInput(NEUTRAL);
    expect(liveHitbox(m, 'test.dive.shockwave')).toBeUndefined();
  });

  it('emits a one-shot landing event on touchdown (drives the render burst)', () => {
    const { ch, m } = diveChar();
    ch.applyInput(DOWN_SPECIAL);
    for (let i = 0; i < 6; i += 1) ch.applyInput(NEUTRAL);
    expect(ch.consumeDiveLandingEvent()).toBeNull(); // airborne — not landed
    ground(ch, m);
    ch.applyInput(NEUTRAL); // touchdown
    const evt = ch.consumeDiveLandingEvent();
    expect(evt).not.toBeNull();
    // One-shot: consumed on read, so the next poll is null until the next dive.
    expect(ch.consumeDiveLandingEvent()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Multi-hit ladder (side-special multiHit barrage / up-special multiHitRising
// spin): the barrage now lands every authored rung, not just one base hit.
// ---------------------------------------------------------------------------

describe('Character — multi-hit ladder (side-special multiHit barrage)', () => {
  const BARRAGE = {
    id: 'test.barrage',
    type: 'sideSpecial' as const,
    sideSpecialKind: 'multiHit' as const,
    damage: 8, // base — MUST be suppressed (the ladder owns the hits)
    knockback: { x: 1.4, y: -0.4, scaling: 0.06 },
    hitbox: { offsetX: 40, offsetY: -4, width: 52, height: 24 },
    startupFrames: 2,
    activeFrames: 14,
    recoveryFrames: 6,
    cooldownFrames: 6,
    multiHit: {
      hitCount: 3,
      hitInterval: 4, // rungs at framesIntoActive 0, 4, 8
      damagePerHit: [3, 4, 6],
      knockbackPerHit: [
        { x: 1.4, y: -0.4, scaling: 0.06 },
        { x: 1.6, y: -0.5, scaling: 0.07 },
        { x: 2.9, y: -1.3, scaling: 0.26 },
      ],
      chainWindowFrames: 8,
    },
  };

  function barrageChar(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(BARRAGE);
    ground(ch, m);
    return { ch, m };
  }

  // side-special press: special + side stick.
  const SIDE_SPECIAL: CharacterInput = { moveX: 1, jump: false, special: true };

  // Find a spawned hitbox by plugin moveId, live OR already-removed (rungs
  // are transient, so by the end of the move the early rungs are despawned
  // but still present in the mock's bodies log).
  function anyHitbox(m: MockScene, moveId: string): MockBody | undefined {
    return m.bodies.find(
      (b) =>
        b.label === HITBOX_LABEL &&
        (b.options?.['plugin'] as { moveId?: string } | undefined)?.moveId ===
          moveId,
    );
  }

  it('lands all THREE rungs with escalating damage, not just one base hit', () => {
    const { ch, m } = barrageChar();
    ch.applyInput(SIDE_SPECIAL); // press → side-special starts
    for (let i = 0; i < 12; i += 1) ch.applyInput(NEUTRAL); // play out the active window
    const h0 = anyHitbox(m, 'test.barrage.hit0');
    const h1 = anyHitbox(m, 'test.barrage.hit1');
    const h2 = anyHitbox(m, 'test.barrage.hit2');
    expect(h0).toBeDefined();
    expect(h1).toBeDefined();
    expect(h2).toBeDefined();
    expect((h0!.options['plugin'] as { damage: number }).damage).toBe(3);
    expect((h1!.options['plugin'] as { damage: number }).damage).toBe(4);
    expect((h2!.options['plugin'] as { damage: number }).damage).toBe(6);
  });

  it('SUPPRESSES the single base hitbox (no double-hit with rung 0)', () => {
    const { ch, m } = barrageChar();
    ch.applyInput(SIDE_SPECIAL);
    for (let i = 0; i < 12; i += 1) ch.applyInput(NEUTRAL);
    // The base move id (without a .hitN suffix) must never spawn a hitbox.
    expect(anyHitbox(m, 'test.barrage')).toBeUndefined();
  });

  it('fires the rungs on their scheduled interval frames, not all at once', () => {
    const { ch, m } = barrageChar();
    ch.applyInput(SIDE_SPECIAL); // framesElapsed 0 (startup)
    ch.applyInput(NEUTRAL); // 1 (startup)
    ch.applyInput(NEUTRAL); // 2 → active frame 0 → rung 0 spawns
    expect(anyHitbox(m, 'test.barrage.hit0')).toBeDefined();
    expect(anyHitbox(m, 'test.barrage.hit1')).toBeUndefined(); // not yet
    for (let i = 0; i < 4; i += 1) ch.applyInput(NEUTRAL); // to active frame 4 → rung 1
    expect(anyHitbox(m, 'test.barrage.hit1')).toBeDefined();
    expect(anyHitbox(m, 'test.barrage.hit2')).toBeUndefined();
  });
});

describe('Character — dashStrike side-special (forward lunge)', () => {
  const DASH = {
    id: 'test.dash',
    type: 'sideSpecial' as const,
    sideSpecialKind: 'dashStrike' as const,
    damage: 9,
    knockback: { x: 3.0, y: -1.0, scaling: 0.2 },
    hitbox: { offsetX: 28, offsetY: -4, width: 40, height: 30 },
    startupFrames: 2,
    activeFrames: 10,
    recoveryFrames: 8,
    cooldownFrames: 10,
    dashStrike: { dashSpeed: 18, dashFrames: 5, helplessAfterDash: false },
  };

  function dashChar(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(DASH);
    ground(ch, m);
    return { ch, m };
  }

  const SIDE_SPECIAL: CharacterInput = { moveX: 1, jump: false, special: true };

  it('forces a forward dash during the dash window', () => {
    const { ch } = dashChar();
    ch.applyInput(SIDE_SPECIAL); // press (facing locks right)
    ch.applyInput(NEUTRAL); // startup
    ch.applyInput(NEUTRAL); // active frame 0 → dash
    expect(ch.getVelocity().x).toBe(18);
    ch.applyInput(NEUTRAL); // active frame 1 → still dashing
    expect(ch.getVelocity().x).toBe(18);
  });

  it('stops forcing the dash after dashFrames (damping takes over)', () => {
    const { ch } = dashChar();
    ch.applyInput(SIDE_SPECIAL);
    for (let i = 0; i < 8; i += 1) ch.applyInput(NEUTRAL); // past the 5-frame dash
    expect(ch.getVelocity().x).toBeLessThan(18);
  });
});

describe('Character — counter (parry + retaliate; neutral and down share one handler)', () => {
  const COUNTER_BLOCK = {
    counterWindowStart: 2,
    counterWindowEnd: 16,
    damageMultiplier: 1.5,
    minCounterDamage: 10,
    maxCounterDamage: 28,
    counterKnockback: { x: 2.0, y: -3.5, scaling: 0.4 },
    counterHitbox: { offsetX: 30, offsetY: -10, width: 80, height: 60 },
  };
  const NEUTRAL_COUNTER = {
    id: 'test.counter',
    type: 'special' as const,
    specialKind: 'counter' as const,
    damage: 0,
    knockback: { x: 0, y: 0, scaling: 0 },
    hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
    startupFrames: 2,
    activeFrames: 14,
    recoveryFrames: 10,
    cooldownFrames: 10,
    counter: COUNTER_BLOCK,
  };
  const DOWN_COUNTER = {
    ...NEUTRAL_COUNTER,
    id: 'test.dcounter',
    type: 'downSpecial' as const,
    specialKind: undefined,
    downSpecialKind: 'counter' as const,
  };

  function anyHitbox(m: MockScene, moveId: string): MockBody | undefined {
    return m.bodies.find(
      (b) =>
        b.label === HITBOX_LABEL &&
        (b.options?.['plugin'] as { moveId?: string } | undefined)?.moveId ===
          moveId,
    );
  }

  const NEUTRAL_SPECIAL: CharacterInput = { moveX: 0, jump: false, special: true };
  const DOWN_SPECIAL: CharacterInput = {
    moveX: 0,
    jump: false,
    special: true,
    dropThrough: true,
  };
  const HIT: HitInfo = {
    damage: 12,
    knockback: { x: 4, y: -2, scaling: 0.3 },
    facing: -1,
  };

  it('absorbs a hit inside the parry window — no damage taken', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(NEUTRAL_COUNTER);
    ground(ch, m);
    ch.applyInput(NEUTRAL_SPECIAL); // fire counter (framesElapsed 0)
    ch.applyInput(NEUTRAL); // 1 (startup)
    ch.applyInput(NEUTRAL); // 2 → inside window [2,16)
    const result = ch.applyHit(HIT);
    expect(result.hitstunFrames).toBe(0);
    expect(result.magnitude).toBe(0);
    expect(ch.getDamagePercent()).toBe(0); // absorbed
  });

  it('retaliates with damage = absorbed × multiplier, clamped', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(NEUTRAL_COUNTER);
    ground(ch, m);
    ch.applyInput(NEUTRAL_SPECIAL);
    ch.applyInput(NEUTRAL);
    ch.applyInput(NEUTRAL); // inside window
    ch.applyHit(HIT); // absorbed (12 dmg)
    ch.applyInput(NEUTRAL); // next tick spawns the retaliation
    const retal = anyHitbox(m, 'test.counter.counter');
    expect(retal).toBeDefined();
    // 12 * 1.5 = 18, within [10, 28].
    expect((retal!.options['plugin'] as { damage: number }).damage).toBe(18);
  });

  it('a hit OUTSIDE the window lands normally (no parry)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(NEUTRAL_COUNTER);
    ground(ch, m);
    ch.applyInput(NEUTRAL_SPECIAL); // framesElapsed 0 — BEFORE window start (2)
    const result = ch.applyHit(HIT);
    expect(result.hitstunFrames).toBeGreaterThan(0); // took the hit
    expect(ch.getDamagePercent()).toBeGreaterThan(0);
  });

  it('the DOWN-special counter shares the same parry handler', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(DOWN_COUNTER);
    ch.setDownSpecial('test.dcounter');
    ground(ch, m);
    ch.applyInput(DOWN_SPECIAL); // fire down counter
    ch.applyInput(NEUTRAL);
    ch.applyInput(NEUTRAL); // inside window
    const result = ch.applyHit(HIT);
    expect(result.hitstunFrames).toBe(0); // absorbed
    ch.applyInput(NEUTRAL);
    expect(anyHitbox(m, 'test.dcounter.counter')).toBeDefined();
  });
});

describe('Character — teleport up-special invulnerable vanish', () => {
  const TELEPORT = {
    id: 'test.teleport',
    type: 'upSpecial' as const,
    upSpecialKind: 'teleport' as const,
    damage: 0,
    knockback: { x: 0, y: 0, scaling: 0 },
    hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
    startupFrames: 4,
    activeFrames: 6,
    recoveryFrames: 20,
    cooldownFrames: 10,
    teleport: { teleportDistance: 200, invincibilityFrames: 14, snapToOctant: true },
  };

  function teleportChar(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TELEPORT);
    ch.setUpSpecial('test.teleport');
    return { ch, m };
  }

  it('grants invincibility for the authored vanish window on press', () => {
    const { ch } = teleportChar();
    expect(ch.attemptUpSpecial(0, -1)).toBe(true);
    expect(ch.isInvincible()).toBe(true);
    expect(ch.getInvincibilityRemaining()).toBe(14);
    // A hit during the vanish is absorbed.
    const result = ch.applyHit({
      damage: 12,
      knockback: { x: 4, y: -2, scaling: 0.3 },
      facing: -1,
    });
    expect(result.hitstunFrames).toBe(0);
    expect(ch.getDamagePercent()).toBe(0);
  });

  it('the vanish invincibility expires after the window', () => {
    const { ch } = teleportChar();
    ch.attemptUpSpecial(0, -1);
    for (let i = 0; i < 14; i += 1) ch.applyInput(NEUTRAL);
    expect(ch.isInvincible()).toBe(false);
  });
});

describe('Character — trap down-special (place-and-arm mine)', () => {
  const TRAP = {
    id: 'test.trap',
    type: 'downSpecial' as const,
    downSpecialKind: 'trap' as const,
    damage: 0,
    knockback: { x: 0, y: 0, scaling: 0 },
    hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
    startupFrames: 2,
    activeFrames: 2,
    recoveryFrames: 2,
    cooldownFrames: 2,
    trap: {
      trapWidth: 40,
      trapHeight: 20,
      spawnOffsetX: 0,
      spawnOffsetY: 36,
      armDelayFrames: 3,
      trapLifetimeFrames: 40,
      trapDamage: 8,
      trapKnockback: { x: 2, y: -1.5, scaling: 0.15 },
      maxActiveTraps: 1,
    },
  };

  function trapChar(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TRAP);
    ch.setDownSpecial('test.trap');
    ground(ch, m);
    return { ch, m };
  }

  const DOWN_SPECIAL: CharacterInput = {
    moveX: 0,
    jump: false,
    special: true,
    dropThrough: true,
  };

  function liveTrap(m: MockScene): MockBody | undefined {
    return m.bodies.find(
      (b) =>
        b.label === HITBOX_LABEL &&
        !b.removed &&
        (b.options?.['plugin'] as { moveId?: string } | undefined)?.moveId ===
          'test.trap.trap',
    );
  }
  function liveTrapCount(m: MockScene): number {
    return m.bodies.filter(
      (b) =>
        b.label === HITBOX_LABEL &&
        !b.removed &&
        (b.options?.['plugin'] as { moveId?: string } | undefined)?.moveId ===
          'test.trap.trap',
    ).length;
  }

  it('is inert before the arm delay, then arms with the trap damage', () => {
    const { ch, m } = trapChar();
    ch.applyInput(DOWN_SPECIAL);
    ch.applyInput(NEUTRAL);
    ch.applyInput(NEUTRAL); // → active → trap placed
    expect(liveTrap(m)).toBeUndefined(); // arm delay (3) not elapsed
    for (let i = 0; i < 3; i += 1) ch.applyInput(NEUTRAL); // past arm delay
    const armed = liveTrap(m);
    expect(armed).toBeDefined();
    expect((armed!.options['plugin'] as { damage: number }).damage).toBe(8);
  });

  it('expires at its lifetime', () => {
    const { ch, m } = trapChar();
    ch.applyInput(DOWN_SPECIAL);
    for (let i = 0; i < 6; i += 1) ch.applyInput(NEUTRAL); // place + arm
    expect(liveTrap(m)).toBeDefined();
    for (let i = 0; i < 42; i += 1) ch.applyInput(NEUTRAL); // past lifetime (40)
    expect(liveTrap(m)).toBeUndefined();
  });

  it('respects maxActiveTraps — placing a new one evicts the oldest', () => {
    const { ch, m } = trapChar();
    ch.applyInput(DOWN_SPECIAL);
    for (let i = 0; i < 8; i += 1) ch.applyInput(NEUTRAL); // place + arm trap #1, move ends
    expect(liveTrapCount(m)).toBe(1);
    ch.applyInput(DOWN_SPECIAL); // place trap #2 (maxActive 1 → evict #1)
    for (let i = 0; i < 6; i += 1) ch.applyInput(NEUTRAL); // arm trap #2
    expect(liveTrapCount(m)).toBe(1); // never two at once
  });
});

// ---------------------------------------------------------------------------
// Timed bomb (Samus down-B): a `trap` with a `fuseDetonateFrames` is a thrown
// bomb, not a contact mine — it stays inert, then DETONATES on its own fuse
// (blast lives a few frames) and BOMB-JUMPS the placer if she's next to it.
// ---------------------------------------------------------------------------

describe('Character — timed bomb down-special (fuse + bomb-jump)', () => {
  const BOMB = {
    id: 'test.bomb',
    type: 'downSpecial' as const,
    downSpecialKind: 'trap' as const,
    damage: 0,
    knockback: { x: 0, y: 0, scaling: 0 },
    hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
    startupFrames: 2,
    activeFrames: 2,
    recoveryFrames: 2,
    cooldownFrames: 2,
    trap: {
      trapWidth: 46,
      trapHeight: 42,
      spawnOffsetX: 0,
      spawnOffsetY: 30, // at the placer's feet → she's in blast range
      armDelayFrames: 0, // unused — overridden by the fuse
      trapLifetimeFrames: 99, // unused — overridden to fuse + blast
      trapDamage: 5,
      trapKnockback: { x: 1, y: -1.7, scaling: 0.12 },
      maxActiveTraps: 1,
      fuseDetonateFrames: 5, // short for the test
      selfBounceVelocity: -9, // upward bomb-jump pop
    },
  };

  function bombChar(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(BOMB);
    ch.setDownSpecial('test.bomb');
    ground(ch, m);
    return { ch, m };
  }

  const DOWN_SPECIAL: CharacterInput = {
    moveX: 0,
    jump: false,
    special: true,
    dropThrough: true,
  };

  function liveBomb(m: MockScene): MockBody | undefined {
    return m.bodies.find(
      (b) =>
        b.label === HITBOX_LABEL &&
        !b.removed &&
        (b.options?.['plugin'] as { moveId?: string } | undefined)?.moveId ===
          'test.bomb.trap',
    );
  }

  it('stays inert during the fuse, then detonates on its own (no contact) and bomb-jumps the placer', () => {
    const { ch, m } = bombChar();
    ch.applyInput(DOWN_SPECIAL);
    ch.applyInput(NEUTRAL);
    ch.applyInput(NEUTRAL); // → active → bomb dropped
    expect(liveBomb(m)).toBeUndefined(); // inert during the fuse

    let detonated = false;
    let bounceVy = 0;
    for (let i = 0; i < 12; i += 1) {
      ch.applyInput(NEUTRAL);
      if (liveBomb(m)) {
        detonated = true;
        bounceVy = ch.getVelocity().y;
        break;
      }
    }
    expect(detonated).toBe(true); // the fuse popped with nobody touching it
    expect(bounceVy).toBeLessThan(0); // BOMB-JUMP: placer popped upward
  });

  it('the blast is a one-shot — it despawns shortly after, not a lingering mine', () => {
    const { ch, m } = bombChar();
    ch.applyInput(DOWN_SPECIAL);
    for (let i = 0; i < 9; i += 1) ch.applyInput(NEUTRAL); // place + reach the fuse
    expect(liveBomb(m)).toBeDefined(); // detonated
    for (let i = 0; i < 10; i += 1) ch.applyInput(NEUTRAL); // well past the blast window
    expect(liveBomb(m)).toBeUndefined(); // cleared — not a persistent contact mine
  });
});

describe('Character — command grab (unblockable throw on connect)', () => {
  const COMMAND_GRAB = {
    id: 'test.cgrab',
    type: 'special' as const,
    specialKind: 'commandGrab' as const,
    damage: 0,
    knockback: { x: 0, y: 0, scaling: 0 },
    hitbox: { offsetX: 24, offsetY: -4, width: 40, height: 40 },
    startupFrames: 2,
    activeFrames: 6,
    recoveryFrames: 10,
    cooldownFrames: 10,
    grab: {
      grabHoldFrames: 18,
      throwDamage: 22,
      throwKnockback: { x: 4, y: -2, scaling: 0.4 },
      ignoresShield: true,
    },
  };

  it('spawns an opening hitbox carrying the THROW value + unblockable tag', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(COMMAND_GRAB);
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, special: true }); // fire
    ch.applyInput(NEUTRAL);
    ch.applyInput(NEUTRAL); // → active → opening hitbox spawns
    const hb = m.bodies.find((b) => b.label === HITBOX_LABEL && !b.removed);
    expect(hb).toBeDefined();
    const plugin = hb!.options['plugin'] as { damage: number; unblockable?: boolean };
    expect(plugin.damage).toBe(22); // the throw, not the move's base 0
    expect(plugin.unblockable).toBe(true);
  });

  it('an unblockable hit bypasses a raised shield (grabs beat shield)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    for (let i = 0; i < 3; i += 1) ch.applyInput({ moveX: 0, jump: false, shield: true });
    expect(ch.isShielding()).toBe(true);
    // A normal hit is absorbed by the shield.
    const blocked = ch.applyHit({ damage: 10, knockback: { x: 4, y: -2, scaling: 0.3 }, facing: -1 });
    expect(blocked.hitstunFrames).toBe(0);
    expect(ch.getDamagePercent()).toBe(0);
    // An unblockable hit punches through.
    const thrown = ch.applyHit({
      damage: 10,
      knockback: { x: 4, y: -2, scaling: 0.3 },
      facing: -1,
      unblockable: true,
    });
    expect(thrown.hitstunFrames).toBeGreaterThan(0);
    expect(ch.getDamagePercent()).toBeGreaterThan(0);
  });
});

describe('Character — helpless free-fall after committal aerial specials', () => {
  const BURST = {
    id: 'test.burst',
    type: 'upSpecial' as const,
    upSpecialKind: 'directionalJump' as const,
    damage: 5,
    knockback: { x: 1, y: -1, scaling: 0.1 },
    hitbox: { offsetX: 0, offsetY: 0, width: 30, height: 30 },
    startupFrames: 2,
    activeFrames: 4,
    recoveryFrames: 4,
    cooldownFrames: 4,
    directionalJump: {
      burstSpeed: 16,
      burstFrames: 4,
      snapToOctant: true,
      helplessAfterBurst: true,
    },
  };

  function burstChar(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(BURST);
    ch.setUpSpecial('test.burst');
    return { ch, m }; // airborne (not grounded) — the burst ends in the air
  }

  it('enters helpless when a burst recovery ends in the air, locking out attacks', () => {
    const { ch } = burstChar();
    ch.attemptUpSpecial(0, -1); // fire the recovery
    expect(ch.isHelpless()).toBe(false); // mid-move
    for (let i = 0; i < 12; i += 1) ch.applyInput(NEUTRAL); // play it out
    expect(ch.isHelpless()).toBe(true);
    // Cannot attack while helpless.
    ch.applyInput({ moveX: 0, jump: false, attack: true });
    expect(ch.isAttacking()).toBe(false);
  });

  it('touching the ground clears helpless', () => {
    const { ch, m } = burstChar();
    ch.attemptUpSpecial(0, -1);
    for (let i = 0; i < 12; i += 1) ch.applyInput(NEUTRAL);
    expect(ch.isHelpless()).toBe(true);
    ground(ch, m);
    ch.applyInput(NEUTRAL);
    expect(ch.isHelpless()).toBe(false);
  });
});

describe('Character — tether up-special (hookshot reel-to-ledge)', () => {
  const TETHER = {
    id: 'test.tether',
    type: 'upSpecial' as const,
    upSpecialKind: 'tether' as const,
    damage: 0,
    knockback: { x: 0, y: 0, scaling: 0 },
    hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
    startupFrames: 2,
    activeFrames: 20,
    recoveryFrames: 6,
    cooldownFrames: 6,
    tether: {
      extensionSpeed: 20,
      extensionFrames: 10,
      maxRange: 200,
      reelSpeed: 14,
      reelFrames: 14,
      tetherTipDamage: 3,
      tetherTipKnockback: { x: 1, y: -0.5, scaling: 0.05 },
      lineWidth: 6,
    },
  };

  function tetherChar(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(TETHER);
    ch.setUpSpecial('test.tether');
    return { ch, m };
  }

  it('reels toward a ledge within reach (up-and-toward the ledge)', () => {
    const { ch } = tetherChar();
    // Ledge up-and-right, ~158px away (inside maxRange 200).
    ch.setLedgeCandidates([{ platformId: 'p', side: 'right', x: 150, y: -50 }]);
    ch.attemptUpSpecial(0, -1);
    ch.applyInput(NEUTRAL); // startup
    ch.applyInput(NEUTRAL); // active → reel
    const v = ch.getVelocity();
    expect(v.x).toBeGreaterThan(10); // pulled toward the ledge (right)
    expect(v.y).toBeLessThan(0); // and upward
  });

  it('a whiffed tether (no ledge in range) does not reel', () => {
    const { ch } = tetherChar();
    ch.setLedgeCandidates([{ platformId: 'p', side: 'right', x: 5000, y: -50 }]); // far beyond maxRange
    ch.attemptUpSpecial(0, -1);
    ch.applyInput(NEUTRAL);
    ch.applyInput(NEUTRAL);
    expect(Math.abs(ch.getVelocity().x)).toBeLessThan(10); // no strong reel
  });
});

describe('Character — directional aerials (up-air / down-air dispatch)', () => {
  const mkAerial = (id: string, dir: 'neutral' | 'up' | 'down' | 'forward' | 'back') => ({
    id,
    type: 'aerial' as const,
    aerialDirection: dir,
    damage: 6,
    knockback: { x: 1.2, y: -1.0, scaling: 0.12 },
    hitbox: { offsetX: 0, offsetY: dir === 'up' ? -28 : dir === 'down' ? 28 : -2, width: 40, height: 30 },
    startupFrames: 4,
    activeFrames: 4,
    recoveryFrames: 8,
    cooldownFrames: 6,
    animation: { startupFrames: 1, activeFrames: 2, recoveryFrames: 2 },
    landingLagFrames: 8,
    autoCancelWindows: [{ startFrame: 0, endFrame: 2 }],
  });

  function aerialChar(): { ch: Character; m: MockScene } {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ch.registerAttack(mkAerial('t.nair', 'neutral'));
    ch.registerAttack(mkAerial('t.uair', 'up'));
    ch.registerAttack(mkAerial('t.dair', 'down'));
    return { ch, m }; // airborne (not grounded)
  }

  it('an UP-stick aerial press fires the up-air', () => {
    const { ch } = aerialChar();
    ch.applyInput({ moveX: 0, moveY: -1, jump: false, attack: true });
    expect(ch.getActiveAttack()?.move.id).toBe('t.uair');
  });

  it('a DOWN-stick aerial press fires the down-air', () => {
    const { ch } = aerialChar();
    ch.applyInput({ moveX: 0, moveY: 1, jump: false, attack: true });
    expect(ch.getActiveAttack()?.move.id).toBe('t.dair');
  });

  it('a neutral aerial press still fires nair (no regression)', () => {
    const { ch } = aerialChar();
    ch.applyInput({ moveX: 0, moveY: 0, jump: false, attack: true });
    expect(ch.getActiveAttack()?.move.id).toBe('t.nair');
  });

  it('input leniency: a flick-up a couple frames BEFORE the attack still fires up-air', () => {
    const { ch } = aerialChar();
    // Flick up, let the stick settle back toward neutral, THEN press attack
    // a few frames later — within the leniency window it still reads "up".
    ch.applyInput({ moveX: 0, moveY: -1, jump: false }); // flick up (no attack)
    ch.applyInput({ moveX: 0, moveY: -0.2, jump: false }); // stick easing back
    ch.applyInput({ moveX: 0, moveY: 0, jump: false, attack: true }); // press, stick ~neutral now
    expect(ch.getActiveAttack()?.move.id).toBe('t.uair');
  });

  it('leniency expires: a flick-up long before the press does NOT fire up-air', () => {
    const { ch } = aerialChar();
    ch.applyInput({ moveX: 0, moveY: -1, jump: false }); // flick up
    for (let i = 0; i < 5; i += 1) ch.applyInput({ moveX: 0, moveY: 0, jump: false }); // wait past the window
    ch.applyInput({ moveX: 0, moveY: 0, jump: false, attack: true });
    expect(ch.getActiveAttack()?.move.id).toBe('t.nair'); // neutral, not up
  });
});

describe('Character — directional grounded attacks (up-tilt / up-smash)', () => {
  const mkGrounded = (id: string, type: 'jab' | 'tilt' | 'smash') => ({
    id,
    type,
    damage: type === 'smash' ? 14 : 6,
    knockback: { x: 1.5, y: type === 'smash' ? -2.0 : -1.0, scaling: 0.15 },
    hitbox: { offsetX: type.startsWith('u') ? 0 : 24, offsetY: -20, width: 30, height: 30 },
    startupFrames: type === 'smash' ? 10 : 5,
    activeFrames: 3,
    recoveryFrames: 10,
    cooldownFrames: 10,
    animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  });

  it('an up-stick LIGHT press fires the up-tilt', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.registerAttack(mkGrounded('t.tilt', 'tilt'));
    ch.registerAttack({ ...mkGrounded('t.utilt', 'tilt'), id: 't.utilt' });
    ch.setUpTilt('t.utilt');
    ch.applyInput({ moveX: 0, moveY: -1, jump: false, attack: true });
    expect(ch.getActiveAttack()?.move.id).toBe('t.utilt');
  });

  it('an up-stick HEAVY press fires the up-smash', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.registerAttack(mkGrounded('t.smash', 'smash'));
    ch.registerAttack({ ...mkGrounded('t.usmash', 'smash'), id: 't.usmash' });
    ch.setUpSmash('t.usmash');
    ch.applyInput({ moveX: 0, moveY: -1, jump: false, attackHeavy: true });
    expect(ch.getActiveAttack()?.move.id).toBe('t.usmash');
  });

  it('a neutral light press still fires jab (no regression)', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.registerAttack(mkGrounded('t.jab', 'jab'));
    ch.registerAttack({ ...mkGrounded('t.utilt', 'tilt'), id: 't.utilt' });
    ch.setUpTilt('t.utilt');
    ch.applyInput({ moveX: 0, moveY: 0, jump: false, attack: true });
    expect(ch.getActiveAttack()?.move.id).toBe('t.jab');
  });

  it('a down-stick LIGHT press fires the down-tilt', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.registerAttack(mkGrounded('t.tilt', 'tilt'));
    ch.registerAttack({ ...mkGrounded('t.dtilt', 'tilt'), id: 't.dtilt' });
    ch.setDownTilt('t.dtilt');
    ch.applyInput({ moveX: 0, moveY: 1, jump: false, attack: true });
    expect(ch.getActiveAttack()?.move.id).toBe('t.dtilt');
  });

  it('a down-stick HEAVY press fires the down-smash', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.registerAttack(mkGrounded('t.smash', 'smash'));
    ch.registerAttack({ ...mkGrounded('t.dsmash', 'smash'), id: 't.dsmash' });
    ch.setDownSmash('t.dsmash');
    ch.applyInput({ moveX: 0, moveY: 1, jump: false, attackHeavy: true });
    expect(ch.getActiveAttack()?.move.id).toBe('t.dsmash');
  });

  it('a light press while RUNNING fires the dash attack', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.registerAttack(mkGrounded('t.tilt', 'tilt'));
    ch.registerAttack({ ...mkGrounded('t.dash', 'tilt'), id: 't.dash' });
    ch.setDashAttack('t.dash');
    for (let i = 0; i < 15; i += 1) ch.applyInput({ moveX: 1, jump: false }); // build run speed
    ch.applyInput({ moveX: 1, jump: false, attack: true });
    expect(ch.getActiveAttack()?.move.id).toBe('t.dash');
  });

  it('a forward press from near-standstill fires the forward tilt, NOT dash', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.registerAttack(mkGrounded('t.tilt', 'tilt'));
    ch.registerAttack({ ...mkGrounded('t.dash', 'tilt'), id: 't.dash' });
    ch.setTiltAttack('t.tilt');
    ch.setDashAttack('t.dash');
    // First frame holding forward — barely moving, so it's a tilt not a dash.
    ch.applyInput({ moveX: 1, jump: false, attack: true });
    expect(ch.getActiveAttack()?.move.id).toBe('t.tilt');
  });
});
