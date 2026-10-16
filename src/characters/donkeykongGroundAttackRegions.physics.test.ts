import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { DonkeyKong } from './DonkeyKong';
import { Pikachu } from './Pikachu';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import type { Character, CharacterInput } from './Character';
import type { HitInfo } from './combat';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const FLOOR_TOP = 42;

/** DK (slot 0, facing right, centre x 0) against a Pikachu target at `targetX`.
 * `pinY` (body centre) holds the target airborne at a fixed point each step. */
function world(targetX: number, pinY?: number) {
  const engine = Engine.create();
  const events: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, s: object) {
    const b = Bodies.rectangle(x, y, w, h, s); Composite.add(engine.world, b); return b;
  } }, world: { on(e: string, fn: any) { Events.on(engine, events[e] ?? e, fn); }, off(e: string, fn: any) { Events.off(engine, events[e] ?? e, fn); },
    remove(b: any) { Composite.remove(engine.world, b); } } } };
  const a = new DonkeyKong(scene, { spawnX: 0, spawnY: 0 });
  const b: Character = new Pikachu(scene, { spawnX: targetX, spawnY: pinY ?? 17, slotIndex: 1 } as any);
  Composite.add(engine.world, Bodies.rectangle(0, FLOOR_TOP + 10, 20000, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
  const contacts: { hit: HitInfo; region?: number; age: number }[] = [];
  const handler = new HitboxDamageHandler((i, hit, ctx) => {
    if (i !== 1) return { confirmed: false };
    contacts.push({ hit, region: ctx.collisionHitId, age: a.getActiveAttack()?.framesElapsed ?? -1 });
    const result = b.applyHit(hit); a.armAttackerHitlag(b.getHitlagRemaining());
    return { confirmed: result.magnitude > 0 || b.isShielding() };
  });
  handler.registerPlayer(0, a.body); handler.registerPlayer(1, b.body);
  handler.setGroundedLookup(i => (i === 0 ? a : b).isGrounded());
  handler.setFacingLookup(i => (i === 0 ? a : b).getFacing());
  handler.setHurtboxLookup(i => (i === 0 ? a : b).getActiveHurtboxes());
  Events.on(engine, 'collisionStart', (e: any) => handler.handleCollisionStart(e));
  Events.on(engine, 'collisionActive', (e: any) => handler.handleCollisionStart(e));
  const pin = () => {
    if (pinY === undefined || contacts.length) return;
    Body.setPosition(b.body, { x: targetX, y: pinY }); Body.setVelocity(b.body, { x: 0, y: 0 });
  };
  const step = (input: CharacterInput = neutral) => {
    pin(); a.applyInput(input); b.applyInput(neutral);
    stepCharacterPhysics({ characters: [a, b], bodies: Composite.allBodies(engine.world), gravity: engine.gravity, body: Body,
      deltaMs: 1000 / 60, stepWorld: dt => Engine.update(engine, dt),
      afterSubstep: () => handler.sampleHurtboxContacts(Composite.allBodies(engine.world)) });
  };
  for (let i = 0; i < 12; i++) step();
  return { a, b, step, contacts };
}

/** One press (smashes released uncharged), then neutral until the attack ends. */
function swing(w: ReturnType<typeof world>, input: CharacterInput) {
  w.step(input);
  let started = false;
  for (let i = 0; i < 120 && !(started && !w.a.getActiveAttack()); i++) {
    started ||= w.a.getActiveAttack() !== null;
    w.step();
  }
  return w.contacts;
}

const reference = (c: { hit: HitInfo }) => c.hit.knockback?.reference;

describe('DK ground attack regions on native bone positions', () => {
  // Grounded Pikachu touching DK (bodies 60/40 wide: 50 px centre distance)
  // and at the 64 px settled spacing measured in the production match.
  it.each([50, 64])('up tilt hits a grounded adjacent Pikachu at %s px', distance => {
    const w = world(distance);
    expect(w.b.isGrounded()).toBe(true);
    // Held stick before the press: a tilt, not an up smash (real W held + F).
    for (let i = 0; i < 3; i++) w.step({ ...neutral, moveY: -1 });
    const hits = swing(w, { ...neutral, moveY: -1, attack: true });
    expect(w.a.getActiveAttack()).toBeNull();
    expect(hits).toHaveLength(1);
    expect(hits[0]!.age).toBeGreaterThanOrEqual(4);
    expect(hits[0]!.age).toBeLessThanOrEqual(10);
    expect(reference(hits[0]!)?.angle).toBe(100);
  });

  it.each([50, 64])('forward smash close capsule (ID1) wins alone against an adjacent grounded Pikachu at %s px', distance => {
    const hits = swing(world(distance), { ...neutral, moveX: 1, attackHeavy: true });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.region).toBe(1);
    expect(hits[0]!.hit.damage).toBe(21);
    expect(reference(hits[0]!)).toMatchObject({ angle: 361, base: 18, growth: 86 });
  });

  it('forward smash far sphere (ID0) still takes a spaced target', () => {
    const hits = swing(world(115), { ...neutral, moveX: 1, attackHeavy: true });
    expect(hits.map(h => h.region)).toEqual([0]);
    expect(hits[0]!.hit.damage).toBe(22);
  });

  // Shoulders sit on DK's body: only a target above the front shoulder, or one
  // still overlapping DK's body box (before soft separation), avoids the fists.
  it.each([[40, -30], [40, undefined]] as const)('down smash shoulder region wins alone against a target at x %s, pinned y %s', (x, y) => {
    const hits = swing(world(x, y), { ...neutral, moveY: 1, attackHeavy: true });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.region).toBe(3);
    expect(hits[0]!.hit.damage).toBe(14);
    expect(reference(hits[0]!)).toMatchObject({ angle: 82, base: 35, growth: 88 });
  });

  it('down smash fist region (ID1 front elbow) takes an adjacent grounded target', () => {
    const hits = swing(world(50), { ...neutral, moveY: 1, attackHeavy: true });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.region).toBe(1);
    expect(hits[0]!.hit.damage).toBe(17);
    expect(reference(hits[0]!)).toMatchObject({ angle: 70, base: 35, growth: 88 });
  });
});
