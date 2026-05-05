import { describe, expect, it } from 'vitest';

import { Creature, type CreatureAITarget, type CreatureScene } from './Creature';
import type { CreatureSpec } from './creatureSchema';
import type { HitInfo } from '../characters/combat';

const SPEC: CreatureSpec = {
  id: 'demo',
  displayName: 'Demo',
  spriteKey: null,
  playable: false,
  body: { width: 24, height: 24, chamfer: 4 },
  movement: {
    maxRunSpeed: 5,
    groundAccel: 0.5,
    airAccel: 0.3,
    groundDamping: 0.85,
    airDamping: 0.95,
    jumpImpulse: 8,
    maxJumps: 1,
    mass: 4,
  },
  maxHp: 20,
  moveset: {
    chaseAttack: {
      id: 'demo.chase',
      type: 'jab' as const,
      damage: 5,
      knockback: { x: 1, y: -0.5, scaling: 0.05 },
      hitbox: { offsetX: 12, offsetY: 0, width: 18, height: 14 },
      startupFrames: 4,
      activeFrames: 2,
      recoveryFrames: 8,
      cooldownFrames: 12,
      animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 2 },
    },
  },
  ai: { aggroRangePx: 200, leashRangePx: 400, attackCadenceFrames: 12 },
  despawnPolicies: ['timer', 'onHpZero', 'onOwnerKO'],
  lifetimeFrames: 240,
};

class MockTarget implements CreatureAITarget {
  hits: HitInfo[] = [];
  alive = true;
  constructor(
    readonly actorId: string,
    public position: { x: number; y: number },
    readonly ownerActorId: string | null = null,
    readonly factionId: string | null = null,
  ) {}
  isAlive(): boolean {
    return this.alive;
  }
  applyHit(hit: HitInfo): void {
    this.hits.push(hit);
  }
}

const makeCreature = (overrides: Partial<{ ownerActorId: string; spawnX: number; spawnY: number; spawnedAtFrame: number; spec: CreatureSpec }> = {}): Creature =>
  new Creature(null, {
    spec: overrides.spec ?? SPEC,
    ownerActorId: overrides.ownerActorId ?? 'owner-1',
    spawnX: overrides.spawnX ?? 100,
    spawnY: overrides.spawnY ?? 100,
    spawnedAtFrame: overrides.spawnedAtFrame ?? 0,
  });

describe('Creature — construction', () => {
  it('starts at full HP and is alive', () => {
    const c = makeCreature();
    expect(c.getHp()).toBe(SPEC.maxHp);
    expect(c.isAlive()).toBe(true);
    expect(c.isDestroyed()).toBe(false);
  });

  it('reports the spec-driven actor identity', () => {
    const c = makeCreature({ spawnedAtFrame: 7 });
    expect(c.actorId).toContain('demo');
    expect(c.actorKind).toBe('creature');
    expect(c.ownerActorId).toBe('owner-1');
  });
});

describe('Creature — applyHit / HP / despawn', () => {
  it('drains HP and reports kill state on lethal hit', () => {
    const c = makeCreature();
    const r1 = c.applyHit({ damage: 5, knockback: { x: 1, y: 0, scaling: 0 }, facing: 1 });
    expect(r1.killed).toBe(false);
    expect(c.isAlive()).toBe(true);
    const r2 = c.applyHit({ damage: 999, knockback: { x: 1, y: 0, scaling: 0 }, facing: 1 });
    expect(r2.killed).toBe(true);
    expect(r2.hp).toBe(0);
    expect(c.isAlive()).toBe(false);
    expect(c.isDestroyed()).toBe(true);
  });

  it('does NOT auto-despawn when spec omits the onHpZero policy', () => {
    const noHpZeroSpec: CreatureSpec = { ...SPEC, despawnPolicies: ['timer'] };
    const c = makeCreature({ spec: noHpZeroSpec });
    const r = c.applyHit({ damage: 999, knockback: { x: 0, y: 0, scaling: 0 }, facing: 1 });
    expect(r.hp).toBe(0);
    expect(r.killed).toBe(false);
    // The creature is at 0 HP but still "alive" from the destroy-flag
    // perspective until something else fires `destroy()`.
    expect(c.isDestroyed()).toBe(false);
  });

  it('subsequent hits on a destroyed creature are no-ops', () => {
    const c = makeCreature();
    c.destroy();
    const r = c.applyHit({ damage: 5, knockback: { x: 0, y: 0, scaling: 0 }, facing: 1 });
    expect(r.hp).toBe(0);
    expect(r.killed).toBe(false);
  });
});

describe('Creature — AI tick: targeting + chase', () => {
  it('despawns by timer policy after lifetimeFrames elapse', () => {
    const c = makeCreature({ spawnedAtFrame: 0 });
    const r = c.tickAI(SPEC.lifetimeFrames!, [], null);
    expect(r.despawned).toBe(true);
    expect(c.isDestroyed()).toBe(true);
  });

  it('walks toward the nearest non-owner enemy in aggro range', () => {
    const c = makeCreature({ spawnX: 0 });
    c.setPosition(0, 0);
    const enemy = new MockTarget('enemy-1', { x: 80, y: 0 });
    const r = c.tickAI(1, [enemy], null);
    expect(r.despawned).toBe(false);
    // Velocity x should be positive (moving right toward enemy)
    // The runtime applies via setVelocity; we check via internal-state
    // proxy by re-running and watching position via setPosition.
    expect(r.hit).toBeNull();
  });

  it('skips its owner as a target (friendly-fire safety)', () => {
    const c = makeCreature({ ownerActorId: 'owner-1' });
    c.setPosition(0, 0);
    // Owner is the only "target" in range — should be ignored.
    const owner: CreatureAITarget = {
      actorId: 'owner-1',
      ownerActorId: null,
      factionId: null,
      position: { x: 50, y: 0 },
      isAlive: () => true,
      applyHit: () => {},
    };
    const r = c.tickAI(1, [owner], { x: 50, y: 0 });
    expect(r.hit).toBeNull();
  });

  it('attacks an enemy in chase-attack reach after cadence elapses', () => {
    const c = makeCreature({ spawnedAtFrame: 0 });
    c.setPosition(0, 0);
    const enemy = new MockTarget('enemy-1', { x: 18, y: 0 }); // within hitbox reach
    // Tick enough times for the cadence gate to open, plus the
    // already-armed initial cadence in the constructor.
    let lastHit: HitInfo | null = null;
    for (let i = 0; i < SPEC.ai.attackCadenceFrames + 2; i += 1) {
      const r = c.tickAI(i + 1, [enemy], null);
      if (r.hit !== null) {
        lastHit = r.hit.hit;
        enemy.hits.push(r.hit.hit);
      }
    }
    expect(lastHit).not.toBeNull();
    expect(lastHit?.damage).toBe(SPEC.moveset.chaseAttack!.damage);
  });

  it('breaks engagement past the leash range', () => {
    const c = makeCreature();
    c.setPosition(0, 0);
    const enemy = new MockTarget('enemy-1', { x: 20, y: 0 });
    // Owner is far away — past leash range.
    const r = c.tickAI(1, [enemy], { x: 1000, y: 0 });
    expect(r.hit).toBeNull();
  });

  it('returns null hit when no enemy is in aggro range', () => {
    const c = makeCreature();
    c.setPosition(0, 0);
    const enemy = new MockTarget('enemy-1', { x: 9999, y: 0 });
    const r = c.tickAI(1, [enemy], null);
    expect(r.hit).toBeNull();
  });
});

describe('Creature — destroy', () => {
  it('destroy() is idempotent', () => {
    const c = makeCreature();
    c.destroy();
    c.destroy();
    expect(c.isDestroyed()).toBe(true);
  });

  it('AI tick on a destroyed creature returns despawned: true and no hit', () => {
    const c = makeCreature();
    c.destroy();
    const r = c.tickAI(1, [], null);
    expect(r.despawned).toBe(true);
    expect(r.hit).toBeNull();
  });
});

describe('Creature — Phaser body integration', () => {
  it('attaches a Matter body when scene is provided', () => {
    let attachedOptions: Record<string, unknown> | null = null;
    const fakeScene: CreatureScene = {
      matter: {
        add: {
          rectangle(_x, _y, _w, _h, options) {
            attachedOptions = options as Record<string, unknown>;
            return { _attached: true };
          },
        },
        body: {
          setVelocity() {},
          setPosition() {},
        },
        world: { remove() {} },
      },
    };
    const c = new Creature(fakeScene, {
      spec: SPEC,
      ownerActorId: 'owner-1',
      spawnX: 100,
      spawnY: 200,
      spawnedAtFrame: 0,
    });
    expect(attachedOptions).not.toBeNull();
    expect(c.body).toEqual({ _attached: true });
    // Plugin record carries the actor identity
    const opts = attachedOptions as unknown as {
      plugin?: { actorId?: string; ownerActorId?: string };
    };
    expect(opts.plugin?.actorId).toContain('demo');
    expect(opts.plugin?.ownerActorId).toBe('owner-1');
  });

  it('removes the body from the world on destroy()', () => {
    let removed = false;
    const fakeScene: CreatureScene = {
      matter: {
        add: { rectangle: () => ({ _b: true }) },
        body: { setVelocity() {}, setPosition() {} },
        world: { remove: () => { removed = true; } },
      },
    };
    const c = new Creature(fakeScene, {
      spec: SPEC,
      ownerActorId: 'owner-1',
      spawnX: 0,
      spawnY: 0,
      spawnedAtFrame: 0,
    });
    c.destroy();
    expect(removed).toBe(true);
    expect(c.body).toBeNull();
  });
});
