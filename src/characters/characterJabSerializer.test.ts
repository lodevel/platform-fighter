import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { CharacterEditState } from '../characterBuilder/characterEditState';
import { buildCharacterEditorFields, stepCharacterEditorField } from '../characterBuilder/characterEditorFields';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { applyCharacterMoveOverrides, createCharacterById } from './characterFactory';
import { parseCharacterDataFile, serializeCharacterDataSpec, type CharacterDataSpec } from './characterSerializer';
import type { AttackMoveWithAnimation } from './moveSchema';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { GAME_CONFIG } from '../engine/constants';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const reload = (spec: CharacterDataSpec) => parseCharacterDataFile(
  JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))),
);

function construct(spec: CharacterDataSpec) {
  const engine = Engine.create();
  engine.gravity.y = GAME_CONFIG.gravity;
  const events: Record<string, string> = {
    collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd',
  };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, width: number, height: number, options: object) {
      const body = Bodies.rectangle(x, y, width, height, options);
      Composite.add(engine.world, body);
      return body;
    },
  }, world: {
    on(event: string, fn: (...args: any[]) => void) { Events.on(engine, events[event] ?? event, fn); },
    off(event: string, fn: (...args: any[]) => void) { Events.off(engine, events[event] ?? event, fn); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const fighter = createCharacterById(scene, spec.id, {
    ...spec.body, ...spec.movement, spawnX: 0, spawnY: 0,
  });
  applyCharacterMoveOverrides(fighter, spec);
  Composite.add(engine.world, Bodies.rectangle(0, spec.body.height / 2 + 10, 400, 20, {
    isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
  }));
  const step = (attack = false) => {
    fighter.applyInput({ moveX: 0, jump: false, attack });
    stepCharacterPhysics({ characters: [fighter], bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: delta => Engine.update(engine, delta) });
  };
  return { fighter, step, destroy() {
    fighter.destroy(); Engine.clear(engine); Composite.clear(engine.world, false);
  } };
}

describe('jab chain authoring', () => {
  // Link's jab string is driven by his source clocks, so it authors no `jabChain`; Donkey Kong's is authored data.
  it.each([
    { id: 'donkeykong', slot: 'jab', opening: 7, nextId: 'donkeykong.jab2', continuationWindowEndFrame: 28 },
  ] as const)('edits $id $slot opening by whole frames through Lab, save/load and factory', ({ id, slot, opening, nextId, continuationWindowEndFrame }) => {
    const original = getAuthorableCharacterSpec(id);
    const state = new CharacterEditState(reload(original));
    const field = buildCharacterEditorFields(state.getSpec(), 'move', slot)
      .find(candidate => candidate.id === 'jabChain.advanceWindowStart')!;
    expect(field).toMatchObject({ value: opening, step: 1, min: 0, max: 600, integer: true });
    expect(stepCharacterEditorField({ ...field, value: 0 }, -1)).toBe(0);
    expect(stepCharacterEditorField(field, 1)).toBe(opening + 1);
    state.setMoveNumericField(slot, field.path, stepCharacterEditorField(field, 1));
    const saved = reload(state.getSpec());
    expect(saved.moves![slot]).toEqual({ ...original.moves![slot],
      jabChain: { nextId, continuationWindowEndFrame, advanceWindowStart: opening + 1 } });
    const world = construct(saved);
    const { fighter, step } = world;
    try {
      const authored = fighter.getAttack(original.moves![slot]!.id)! as AttackMoveWithAnimation;
      expect(authored.jabChain).toEqual({ nextId, continuationWindowEndFrame, advanceWindowStart: opening + 1 });
      expect(authored.knockback).toEqual(original.moves![slot]!.knockback);
      expect(authored.sweetSpot).toEqual(original.moves![slot]!.sweetSpot);
      expect(getAuthorableCharacterSpec(id).moves![slot]!.jabChain)
        .toEqual({ nextId, continuationWindowEndFrame, advanceWindowStart: opening });
      // The saved edit also controls the live chain, not only the serialized leaf.
      for (let frame = 0; frame < 20; frame++) step();
      expect(fighter.isGrounded()).toBe(true);
      expect(fighter.attemptAttack(authored.id)).toBe(true);
      for (let frame = 0; frame < opening - 1; frame++) step();
      step(true); // The original opening is now one frame too early.
      expect(fighter.getActiveAttack()).toMatchObject({ move: { id: authored.id }, framesElapsed: opening });
      // The continuation window buffers that early press: it chains the moment the edited opening is reached.
      step();
      expect(fighter.getActiveAttack()).toMatchObject({ move: { id: nextId }, framesElapsed: 0 });
    } finally {
      world.destroy();
    }
    const exact = construct(saved);
    try {
      for (let frame = 0; frame < 20; frame++) exact.step();
      expect(exact.fighter.isGrounded()).toBe(true);
      expect(exact.fighter.attemptAttack(original.moves![slot]!.id)).toBe(true);
      for (let frame = 0; frame < opening; frame++) exact.step();
      expect(exact.fighter.getActiveAttack()?.framesElapsed).toBe(opening);
      exact.step(true); // The tick reaches exactly the edited opening, opening + 1.
      expect(exact.fighter.getActiveAttack()).toMatchObject({ move: { id: nextId }, framesElapsed: 0 });
    } finally {
      exact.destroy();
    }
  });

  it.each([
    { slot: 'jab', reference: { base: 25, growth: 25, angle: 361 }, damage: 3, chain: undefined },
    { slot: 'jab2', reference: { base: 25, growth: 25, angle: 361 }, damage: 3, chain: undefined },
    { slot: 'jab3', reference: { base: 70, growth: 70, angle: 30 }, damage: 4, chain: undefined },
  ] as const)('retains $slot source launch and independently edited reference values through save and factory', ({ slot, reference, damage, chain }) => {
    const state = new CharacterEditState(reload(getAuthorableCharacterSpec('link')));
    const move = state.getSpec().moves![slot]!;
    expect(move.damage).toBe(damage);
    expect(move.knockback.reference).toMatchObject(reference);
    expect(move.jabChain).toEqual(chain);
    for (const key of ['sweetSpot', 'groundedKnockback', 'launchAwayFromSource', 'minHitstunFrames', 'airborneVelocityCarry']) {
      expect(Object.hasOwn(move, key)).toBe(false);
    }
    const fields = buildCharacterEditorFields(state.getSpec(), 'move', slot);
    for (const [key, value] of Object.entries(reference)) {
      expect(fields.find(field => field.id === `knockback.reference.${key}`)?.value).toBe(value);
    }
    expect(fields.some(field => field.id === 'knockback.x')).toBe(false);
    const base = fields.find(field => field.id === 'knockback.reference.base')!;
    state.setMoveNumericField(slot, base.path, stepCharacterEditorField(base, 1));
    const saved = reload(state.getSpec());
    const world = construct(saved);
    try {
      const authored = world.fighter.getAttack(move.id)! as AttackMoveWithAnimation;
      expect(authored.knockback.reference).toMatchObject({ ...reference, base: reference.base + 1 });
      expect(authored.jabChain).toEqual(chain);
      expect(authored.sweetSpot).toBeUndefined();
      expect(authored.damage).toBe(damage);
      expect(getAuthorableCharacterSpec('link').moves![slot]!.knockback.reference).toMatchObject(reference);
    } finally {
      world.destroy();
    }
  });
});
