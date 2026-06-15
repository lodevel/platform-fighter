/**
 * Hammer item tests — T3 items framework, open-closed extension.
 *
 * Pins the hammer's frozen definition shape, the slot-override
 * behaviour (attemptAttack dispatch, durability consumption, broken
 * transition on the last swing), and the direction-aware throw table.
 * Drives the deterministic data layer with the same stub-Character
 * pattern as `itemFramework.test.ts` — no Phaser boot required.
 */

import { describe, it, expect } from 'vitest';
import { HAMMER_DEFINITION, HAMMER_SMASH_MOVE } from './Hammer';
import {
  ItemEntity,
  ItemRegistry,
  Inventory,
  PickupController,
} from './index';
import type { AttackMovesetSlotName } from '../characters/movesetContract';

// ---------------------------------------------------------------------------
// Stub Character — minimal surface the items framework reads from.
// Mirrors the stub in `itemFramework.test.ts`.
// ---------------------------------------------------------------------------

class StubCharacter {
  private overrides = new Map<AttackMovesetSlotName, () => boolean>();
  private attacks = new Map<string, unknown>();
  facing: 1 | -1 = 1;
  position = { x: 100, y: 200 };
  attemptAttackCalls: string[] = [];
  setSlotOverride(slot: AttackMovesetSlotName, fn: () => boolean) {
    this.overrides.set(slot, fn);
  }
  clearSlotOverride(slot: AttackMovesetSlotName) {
    this.overrides.delete(slot);
  }
  getSlotOverride(slot: AttackMovesetSlotName) {
    return this.overrides.get(slot) ?? null;
  }
  fireSlot(slot: AttackMovesetSlotName) {
    const cb = this.overrides.get(slot);
    return cb ? cb() : false;
  }
  getFacing(): 1 | -1 {
    return this.facing;
  }
  getPosition() {
    return this.position;
  }
  // Stubs for the held-item attack pipeline. The hammer registers its
  // authored smash move via `addAttack` at pickup; the slot-override
  // callback then fires it via `attemptAttack`. The stub records
  // calls so tests can assert the dispatch happened and returns
  // `true` so the override proceeds to consume durability.
  addAttack(move: { id: string }) {
    this.attacks.set(move.id, move);
  }
  attemptAttack(id: string): boolean {
    this.attemptAttackCalls.push(id);
    return this.attacks.has(id);
  }
}

function spawnHammer(
  registry: ItemRegistry,
  pos = { x: 100, y: 200 },
  frame = 0,
): ItemEntity {
  const entity = registry.spawn(HAMMER_DEFINITION, pos, frame, ItemEntity);
  // Move past the falling state immediately so the pickup tests can
  // hit the grounded contract without booting a Matter step.
  entity.markGrounded(frame, pos);
  return entity;
}

/** Spawn + pickup in one shot; returns the held entity + holder. */
function pickupHammer() {
  const stub = new StubCharacter();
  const registry = new ItemRegistry();
  const hammer = spawnHammer(registry);
  const inv = new Inventory(stub as any);
  new PickupController().tryPickup(stub as any, inv, registry, 0, 0, true);
  return { stub, hammer, inv };
}

// ---------------------------------------------------------------------------
// Definition shape
// ---------------------------------------------------------------------------

describe('hammer — definition shape', () => {
  it('is a frozen melee-weapon record with the authored budget values', () => {
    expect(Object.isFrozen(HAMMER_DEFINITION)).toBe(true);
    expect(HAMMER_DEFINITION.type).toBe('hammer');
    expect(HAMMER_DEFINITION.category).toBe('melee-weapon');
    expect(HAMMER_DEFINITION.maxDurability).toBe(3);
    expect(HAMMER_DEFINITION.ttlFrames).toBe(480);
    expect(HAMMER_DEFINITION.brokenDespawnFrames).toBe(30);
  });

  it('overrides jab/tilt/smash slots (frozen list)', () => {
    expect(Object.isFrozen(HAMMER_DEFINITION.slotOverrides)).toBe(true);
    expect([...HAMMER_DEFINITION.slotOverrides].sort()).toEqual([
      'jab',
      'smash',
      'tilt',
    ]);
  });

  it('authors the colossal-but-telegraphed smash move (frozen)', () => {
    expect(Object.isFrozen(HAMMER_SMASH_MOVE)).toBe(true);
    expect(HAMMER_SMASH_MOVE.id).toBe('item.hammer.smash');
    expect(HAMMER_SMASH_MOVE.type).toBe('jab');
    expect(HAMMER_SMASH_MOVE.damage).toBe(22);
    expect(HAMMER_SMASH_MOVE.knockback).toEqual({ x: 4.5, y: -2.0, scaling: 0.38 });
    expect(HAMMER_SMASH_MOVE.hitbox).toEqual({
      offsetX: 34,
      offsetY: -8,
      width: 50,
      height: 44,
    });
    // Telegraphed — over twice a fighter smash's startup; the wind-up
    // is the hammer's entire counterplay surface.
    expect(HAMMER_SMASH_MOVE.startupFrames).toBe(14);
    expect(HAMMER_SMASH_MOVE.activeFrames).toBe(4);
    expect(HAMMER_SMASH_MOVE.recoveryFrames).toBe(18);
    expect(HAMMER_SMASH_MOVE.cooldownFrames).toBe(10);
  });

  it('registers the smash move on the definition for pickup-time addAttack', () => {
    expect(HAMMER_DEFINITION.attackMoves).toEqual([HAMMER_SMASH_MOVE]);
  });
});

// ---------------------------------------------------------------------------
// Slot override behaviour
// ---------------------------------------------------------------------------

describe('hammer — slot override behaviour', () => {
  it('fires holder.attemptAttack with the hammer move id and consumes durability', () => {
    const { stub, hammer } = pickupHammer();

    expect(stub.fireSlot('jab')).toBe(true);
    expect(stub.attemptAttackCalls).toEqual(['item.hammer.smash']);
    expect(hammer.getDurability()).toBe(2);
  });

  it('routes jab/tilt/smash through the same override while held', () => {
    const { stub, hammer } = pickupHammer();

    expect(stub.fireSlot('jab')).toBe(true);
    expect(stub.fireSlot('tilt')).toBe(true);
    expect(stub.fireSlot('smash')).toBe(true);
    expect(stub.attemptAttackCalls).toEqual([
      'item.hammer.smash',
      'item.hammer.smash',
      'item.hammer.smash',
    ]);
    expect(hammer.getDurability()).toBe(0);
  });

  it('breaks after exactly 3 hits and declines the 4th press', () => {
    const { stub, hammer } = pickupHammer();

    let consumed = 0;
    for (let i = 0; i < 3; i++) {
      if (stub.fireSlot('jab')) consumed += 1;
    }
    expect(consumed).toBe(3);
    // Last-use-broken transition fired on the 3rd swing.
    expect(hammer.isBroken()).toBe(true);
    expect(hammer.getDurability()).toBe(0);
    // The 4th press declines (hammer is broken / durability empty) —
    // no further attemptAttack dispatch.
    expect(stub.fireSlot('jab')).toBe(false);
    expect(stub.attemptAttackCalls).toHaveLength(3);
  });

  it('declines without consuming durability when attemptAttack rejects', () => {
    // Build the override directly against a stub that never had the
    // smash move registered — attemptAttack returns false (e.g. the
    // holder is mid-cooldown), so the press must not cost a charge.
    const stub = new StubCharacter();
    const registry = new ItemRegistry();
    const hammer = spawnHammer(registry);

    const fire = HAMMER_DEFINITION.buildSlotOverride('jab', {
      holder: stub,
      frame: 0,
      itemEntity: hammer,
    });
    expect(fire()).toBe(false);
    expect(stub.attemptAttackCalls).toEqual(['item.hammer.smash']);
    expect(hammer.getDurability()).toBe(3);
    expect(hammer.isBroken()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Throw behaviour
// ---------------------------------------------------------------------------

describe('hammer — throw behaviour record', () => {
  it('is frozen with the authored direction table', () => {
    expect(Object.isFrozen(HAMMER_DEFINITION.throwBehavior)).toBe(true);
    expect(HAMMER_DEFINITION.throwBehavior).toEqual({
      forward: { velocityX: 12, velocityY: -2 },
      back: { velocityX: -9, velocityY: -2 },
      up: { velocityX: 0, velocityY: -14 },
      down: { velocityX: 0, velocityY: 14 },
      drop: { velocityX: 0, velocityY: 0 },
      consumeOnImpact: false,
    });
  });

  it('lands grounded after a throw — not consumed on impact', () => {
    expect(HAMMER_DEFINITION.throwBehavior.consumeOnImpact).toBe(false);
  });
});
