/**
 * Test fixture (physics tests only): one DK, Pikachu or Link on a solid floor in a real Matter world, settled for
 * 20 steps, holding an item picked up through the ordinary Inventory. With `victimAt`, a Donkey Kong stands that many
 * px in front (body centres), facing the holder, and every hit the holder's sensors land on it goes through the real
 * HitboxDamageHandler (collision events + the live-hurtbox sampler, as MatchScene wires it) into `contacts`.
 * Phaser's Matter build is loaded from its sources the way the other `*.physics.test.ts` files do; nothing here runs
 * in the game.
 */
import { createRequire } from 'node:module';
import { DonkeyKong } from '../characters/DonkeyKong';
import { Pikachu } from '../characters/Pikachu';
import { Link } from '../characters/Link';
import type { Character, CharacterInput } from '../characters/Character';
import { stepCharacterPhysics } from '../characters/stepCharacterPhysics';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { ItemEntity } from './ItemEntity';
import { Inventory } from './Inventory';
import type { ItemDefinition } from './ItemDefinition';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');

export const NEUTRAL_INPUT: CharacterInput = { moveX: 0, moveY: 0, jump: false };
export type ItemFixtureFighter = typeof DonkeyKong | typeof Pikachu | typeof Link;
/** One hit the holder landed on the victim: the attacker's step, its active move and frame, the hit's damage and angle. */
export interface FixtureContact { readonly step: number; readonly moveId: string | null; readonly attackFrame: number | null;
  readonly damage: number; readonly angle: number | null }

export function itemPhysicsFixture(Fighter: ItemFixtureFighter, def: ItemDefinition, options: { victimAt?: number } = {}) {
  const engine = Engine.create();
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
    const b = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, b); return b; } },
  world: { on(e: string, fn: (...a: any[]) => void) { Events.on(engine, names[e] ?? e, fn); },
    off(e: string, fn: (...a: any[]) => void) { Events.off(engine, names[e] ?? e, fn); },
    remove(body: any) { Composite.remove(engine.world, body); } } } };
  const actor: Character = new Fighter(scene, { spawnX: 0, spawnY: 0 });
  const top = actor.getTuning().height / 2 + 1;
  const floor = Bodies.rectangle(0, top + 10, 6000, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } });
  Composite.add(engine.world, floor);
  let victim: Character | null = null;
  const contacts: FixtureContact[] = [];
  let frame = 0;
  let handler: HitboxDamageHandler | null = null;
  if (options.victimAt !== undefined) {
    const v: Character = new DonkeyKong(scene, { spawnX: options.victimAt, spawnY: 0 });
    v.setPosition(options.victimAt, top - v.getTuning().height / 2 - 1);
    v.setFacing(-1);
    victim = v;
    const h = new HitboxDamageHandler((_target, hit) => {
      const a = actor.getActiveAttack();
      contacts.push({ step: frame, moveId: a?.move.id ?? null, attackFrame: a?.framesElapsed ?? null,
        damage: hit.damage, angle: hit.knockback.reference?.angle ?? null });
      return { confirmed: true, reactionApplied: true };
    });
    h.registerPlayer(0, actor.body);
    h.registerPlayer(1, v.body);
    h.setFacingLookup(i => (i === 0 ? actor : v).getFacing());
    h.setGroundedLookup(i => (i === 0 ? actor : v).isGrounded());
    h.setHurtboxLookup(i => (i === 0 ? actor : v).getActiveHurtboxes());
    Events.on(engine, 'collisionStart', (e: any) => h.handleCollisionStart(e));
    Events.on(engine, 'collisionActive', (e: any) => h.handleCollisionStart(e));
    handler = h;
  }
  const step = (input: CharacterInput = NEUTRAL_INPUT) => {
    actor.applyInput(input, ++frame);
    victim?.applyInput(NEUTRAL_INPUT, frame);
    stepCharacterPhysics({ characters: victim ? [actor, victim] : [actor], bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: 1000 / 60, stepWorld: (dt: number) => Engine.update(engine, dt),
      ...(handler ? { afterSubstep: () => handler!.sampleHurtboxContacts(Composite.allBodies(engine.world)) } : {}) });
  };
  for (let n = 0; n < 20; n++) step();
  contacts.length = 0;
  const inventory = new Inventory(actor);
  const bat = new ItemEntity(1, def, 0, actor.getPosition());
  bat.markGrounded(0, actor.getPosition());
  if (!inventory.pickup(bat, frame, 0, actor.getPosition())) throw new Error('fixture pickup rejected');
  return { actor, victim, contacts, step, inventory, bat, engine, floor, scene, frame: () => frame };
}
