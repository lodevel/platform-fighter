import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import Matter from './matter/matter';
import { PHASER_RESOLVER_GLOBALS, createMatterPhysicsWorld } from './matterPhysicsWorld';

const require = createRequire(import.meta.url);
const STEP = 1000 / 60;

/** A 40×40 box dropped above a 400×40 static ground whose top is y = 500. */
function dropBox(world = createMatterPhysicsWorld(), frames = 180) {
  world.add.rectangle(0, 520, 400, 40, { isStatic: true, label: 'ground' });
  const box = world.add.rectangle(0, 300, 40, 40, { label: 'box', friction: 0.1 });
  for (let i = 0; i < frames; i++) world.world.step(STEP);
  return { world, box };
}

describe('createMatterPhysicsWorld', () => {
  it("applies Phaser's resolver globals to the vendored Matter fork", () => {
    createMatterPhysicsWorld();
    for (const [k, v] of Object.entries(PHASER_RESOLVER_GLOBALS)) expect(Matter.Resolver[k as keyof typeof Matter.Resolver]).toBe(v);
  });

  it("uses the game's gravity, and localWorld.gravity is the engine's live object", () => {
    const world = createMatterPhysicsWorld();
    expect(world.world.localWorld.gravity).toEqual({ x: 0, y: 1, scale: 0.001 });
    // stepCharacterPhysics mutates it in place: zero gravity must stop the fall.
    world.world.localWorld.gravity.y = 0;
    const box = world.add.rectangle(0, 0, 10, 10, {});
    for (let i = 0; i < 30; i++) world.world.step(STEP);
    expect(box.position.y).toBe(0);
  });

  it('drops a box that comes to rest on top of the ground', () => {
    const { box } = dropBox();
    expect(box.position.y).toBeCloseTo(480, 0);
    expect(Math.abs(box.velocity.y)).toBeLessThan(0.05);
  });

  it('emits collisionstart with pairs, and off() unsubscribes', () => {
    const world = createMatterPhysicsWorld();
    const seen: string[] = [];
    const fn = (e: { pairs: ReadonlyArray<{ bodyA: { label: string }; bodyB: { label: string } }> }) =>
      e.pairs.forEach((p) => seen.push([(p.bodyA as { label?: string }).label, (p.bodyB as { label?: string }).label].sort().join('+')));
    world.world.on('collisionstart', fn as never);
    dropBox(world, 120);
    expect(seen).toContain('box+ground');
    const count = seen.length;
    world.world.off('collisionstart', fn as never);
    world.add.rectangle(100, 300, 20, 20, { label: 'late' });
    for (let i = 0; i < 120; i++) world.world.step(STEP);
    expect(seen.length).toBe(count);
  });

  it('exposes the engine: a fresh world starts at timestamp 0 and lists live contact pairs', () => {
    const world = createMatterPhysicsWorld();
    expect(world.world.engine.timing.timestamp).toBe(0);
    expect(world.world.engine.pairs.list).toHaveLength(0);
    dropBox(world, 120);
    expect(world.world.engine.timing.timestamp).toBeCloseTo(120 * STEP, 6);
    const labels = world.world.engine.pairs.list.map((p) => [(p.bodyA as { label?: string }).label, (p.bodyB as { label?: string }).label].sort().join('+'));
    expect(labels).toContain('box+ground');
  });

  it('steps exactly like an engine hand-built from the vendored CommonJS sources', () => {
    const Engine = require('./matter/source/lib/core/Engine.js');
    const Composite = require('./matter/source/lib/body/Composite.js');
    const Bodies = require('./matter/source/lib/factory/Bodies.js');
    const Resolver = require('./matter/source/lib/collision/Resolver.js');
    Object.assign(Resolver, PHASER_RESOLVER_GLOBALS);
    const engine = Engine.create({ enableSleeping: false, gravity: { x: 0, y: 1 } });
    Composite.add(engine.world, Bodies.rectangle(0, 520, 400, 40, { isStatic: true }));
    const ref = Bodies.rectangle(0, 300, 40, 40, { friction: 0.1 });
    Composite.add(engine.world, ref);
    for (let i = 0; i < 180; i++) Engine.update(engine, STEP);
    const { box } = dropBox();
    expect([box.position.x, box.position.y, box.velocity.y]).toEqual([ref.position.x, ref.position.y, ref.velocity.y]);
  });
});
