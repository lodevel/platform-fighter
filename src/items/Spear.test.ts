/**
 * Spear item tests — 4th item, open-closed proof.
 *
 * Exercises the spear's frozen definition shape, the jab/tilt slot
 * override behaviour (fire → durability → break), the deliberate
 * absence of a smash override, and the javelin throw table — all
 * against the deterministic data layer with a stub Character, the
 * same style as `itemFramework.test.ts`. No Phaser boot.
 */

import { describe, it, expect } from 'vitest';
import { SPEAR_DEFINITION, SPEAR_THRUST_MOVE } from './Spear';
import {
  ItemEntity,
  ItemRegistry,
  Inventory,
  PickupController,
} from './index';
import type { AttackMovesetSlotName } from '../characters/movesetContract';

// ---------------------------------------------------------------------------
// Stub Character — minimal surface the items framework reads from.
// Mirrors the stub in itemFramework.test.ts.
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
  // Stubs for the held-item attack pipeline. The spear registers its
  // thrust move via `addAttack` at pickup; the slot-override callback
  // then fires it via `attemptAttack`. The stub records calls so tests
  // can assert the dispatch happened and returns `true` so the
  // override proceeds to consume durability.
  addAttack(move: { id: string }) {
    this.attacks.set(move.id, move);
  }
  attemptAttack(id: string): boolean {
    this.attemptAttackCalls.push(id);
    return this.attacks.has(id);
  }
}

function spawnSpear(
  registry: ItemRegistry,
  pos = { x: 100, y: 200 },
  frame = 0,
): ItemEntity {
  const entity = registry.spawn(SPEAR_DEFINITION, pos, frame, ItemEntity);
  // Move past the falling state immediately so the pickup tests can
  // hit the grounded contract without booting a Matter step.
  entity.markGrounded(frame, pos);
  return entity;
}

/** Spawn + pick up a spear; returns the wired stub/entity pair. */
function pickupSpear() {
  const stub = new StubCharacter();
  const registry = new ItemRegistry();
  const spear = spawnSpear(registry);
  const inv = new Inventory(stub as any);
  new PickupController().tryPickup(stub as any, inv, registry, 0, 0, true);
  return { stub, registry, spear, inv };
}

// ---------------------------------------------------------------------------
// Definition shape
// ---------------------------------------------------------------------------

describe('spear — definition shape', () => {
  it('is a frozen melee-weapon record with the authored budget values', () => {
    expect(Object.isFrozen(SPEAR_DEFINITION)).toBe(true);
    expect(Object.isFrozen(SPEAR_DEFINITION.slotOverrides)).toBe(true);
    expect(Object.isFrozen(SPEAR_DEFINITION.throwBehavior)).toBe(true);
    expect(Object.isFrozen(SPEAR_DEFINITION.attackMoves)).toBe(true);

    expect(SPEAR_DEFINITION.type).toBe('spear');
    expect(SPEAR_DEFINITION.category).toBe('melee-weapon');
    expect(SPEAR_DEFINITION.maxDurability).toBe(7);
    expect(SPEAR_DEFINITION.ttlFrames).toBe(600);
    expect(SPEAR_DEFINITION.brokenDespawnFrames).toBe(30);
  });

  it('overrides only jab + tilt — the smash slot stays native by design', () => {
    expect([...SPEAR_DEFINITION.slotOverrides].sort()).toEqual(['jab', 'tilt']);
    // Spacing tool, not a finisher — the holder's own smash remains
    // their kill option while the spear is held (see Spear.ts JSDoc).
    expect(SPEAR_DEFINITION.slotOverrides).not.toContain('smash');
  });

  it('registers the thrust move on the holder via attackMoves', () => {
    expect(SPEAR_DEFINITION.attackMoves).toEqual([SPEAR_THRUST_MOVE]);
  });
});

// ---------------------------------------------------------------------------
// Thrust move — frame data + tip sweet-spot
// ---------------------------------------------------------------------------

describe('spear — thrust move', () => {
  it('is a frozen jab-type move with the authored frame data', () => {
    expect(Object.isFrozen(SPEAR_THRUST_MOVE)).toBe(true);
    expect(SPEAR_THRUST_MOVE.id).toBe('item.spear.thrust');
    expect(SPEAR_THRUST_MOVE.type).toBe('jab');
    expect(SPEAR_THRUST_MOVE.damage).toBe(9);
    expect(SPEAR_THRUST_MOVE.knockback).toEqual({ x: 2.2, y: -0.5, scaling: 0.16 });
    expect(SPEAR_THRUST_MOVE.hitbox).toEqual({
      offsetX: 52,
      offsetY: -4,
      width: 72,
      height: 18,
    });
    expect(SPEAR_THRUST_MOVE.startupFrames).toBe(6);
    expect(SPEAR_THRUST_MOVE.activeFrames).toBe(3);
    expect(SPEAR_THRUST_MOVE.recoveryFrames).toBe(8);
    expect(SPEAR_THRUST_MOVE.cooldownFrames).toBe(5);
  });

  it('authors a tip sweet-spot with bonus damage + knockback', () => {
    expect(SPEAR_THRUST_MOVE.sweetSpot).toEqual({
      hitbox: { offsetX: 80, offsetY: -4, width: 20, height: 18 },
      damageMultiplier: 1.25,
      knockbackMultiplier: 1.2,
    });
  });
});

// ---------------------------------------------------------------------------
// Slot override behaviour
// ---------------------------------------------------------------------------

describe('spear — slot override behaviour', () => {
  it('fires the thrust via holder.attemptAttack and consumes durability', () => {
    const { stub, spear } = pickupSpear();

    expect(stub.fireSlot('jab')).toBe(true);
    expect(stub.attemptAttackCalls).toEqual(['item.spear.thrust']);
    expect(spear.getDurability()).toBe(6);

    // tilt routes through the same callback — same move, same budget.
    expect(stub.fireSlot('tilt')).toBe(true);
    expect(stub.attemptAttackCalls).toEqual([
      'item.spear.thrust',
      'item.spear.thrust',
    ]);
    expect(spear.getDurability()).toBe(5);
  });

  it('leaves the smash slot untouched — no override installed', () => {
    const { stub } = pickupSpear();
    expect(stub.getSlotOverride('smash')).toBe(null);
    // Firing smash declines at the override layer, so the fighter's
    // native smash runs as the fallback.
    expect(stub.fireSlot('smash')).toBe(false);
  });

  it('declines without consuming durability when attemptAttack fails', () => {
    // Build the override directly (itemFramework.test.ts AC-20 style)
    // against a holder that never registered the thrust move — the
    // attemptAttack dispatch fails and the press must NOT burn a use.
    const stub = new StubCharacter();
    const registry = new ItemRegistry();
    const spear = spawnSpear(registry);
    const cb = SPEAR_DEFINITION.buildSlotOverride('jab', {
      holder: stub,
      frame: 0,
      itemEntity: spear,
    });

    expect(cb()).toBe(false);
    expect(stub.attemptAttackCalls).toEqual(['item.spear.thrust']);
    expect(spear.getDurability()).toBe(7);
  });

  it('breaks after exactly 7 thrusts, marks broken on the last use', () => {
    const { stub, spear } = pickupSpear();

    let consumed = 0;
    for (let i = 0; i < 7; i++) {
      expect(spear.isBroken()).toBe(false);
      if (stub.fireSlot('jab')) consumed += 1;
    }
    expect(consumed).toBe(7);
    expect(spear.getDurability()).toBe(0);
    // The 7th (last) successful thrust marks the spear broken
    // in-place — no extra press needed for the transition.
    expect(spear.isBroken()).toBe(true);
  });

  it('returns false once broken / durability empty', () => {
    const { stub, spear } = pickupSpear();

    for (let i = 0; i < 7; i++) stub.fireSlot('jab');
    expect(spear.isBroken()).toBe(true);

    // The 8th press declines on both slots — and the declined press
    // must not re-dispatch the thrust move.
    const callsAfterBreak = stub.attemptAttackCalls.length;
    expect(stub.fireSlot('jab')).toBe(false);
    expect(stub.fireSlot('tilt')).toBe(false);
    expect(stub.attemptAttackCalls.length).toBe(callsAfterBreak);
    expect(spear.getDurability()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Throw behaviour
// ---------------------------------------------------------------------------

describe('spear — throw behaviour', () => {
  it('flies well — javelin-flat forward arc, lands reusable', () => {
    const tb = SPEAR_DEFINITION.throwBehavior;
    expect(tb.forward).toEqual({ velocityX: 18, velocityY: -1 });
    expect(tb.back).toEqual({ velocityX: -13, velocityY: -1 });
    expect(tb.up).toEqual({ velocityX: 0, velocityY: -18 });
    expect(tb.down).toEqual({ velocityX: 0, velocityY: 12 });
    expect(tb.drop).toEqual({ velocityX: 0, velocityY: 0 });
    // Melee weapon — a thrown spear lands grounded and fully usable,
    // it is not consumed on impact (bomb-style).
    expect(tb.consumeOnImpact).toBe(false);
  });
});
