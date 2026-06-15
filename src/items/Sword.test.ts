/**
 * Sword item tests — definition shape, slot-override behaviour, and
 * throw behaviour. Drives the deterministic data layer with a stub
 * Character (same pattern as `itemFramework.test.ts`) so no Phaser
 * boot is required.
 *
 * The sword is authored as a sibling of the bat — these tests also
 * re-prove the open-closed invariant: everything below works with
 * zero edits to the framework or `index.ts`.
 */

import { describe, it, expect } from 'vitest';
import { SWORD_DEFINITION, SWORD_SLASH_MOVE } from './Sword';
import { ItemEntity } from './ItemEntity';
import { ItemRegistry } from './ItemRegistry';
import type { SlotOverrideContext } from './ItemDefinition';
import type { AttackMovesetSlotName } from '../characters/movesetContract';

// ---------------------------------------------------------------------------
// Stub Character — minimal surface the sword's slot override reads from.
// ---------------------------------------------------------------------------

class StubCharacter {
  private attacks = new Map<string, unknown>();
  facing: 1 | -1 = 1;
  position = { x: 100, y: 200 };
  attemptAttackCalls: string[] = [];
  getFacing(): 1 | -1 {
    return this.facing;
  }
  getPosition() {
    return this.position;
  }
  // Stubs for the held-item attack pipeline. The slot-override
  // callback fires the registered slash move via `attemptAttack`;
  // the stub records calls so tests can assert the dispatch happened
  // and returns `true` only when the move was registered, mirroring
  // the real Character contract.
  addAttack(move: { id: string }) {
    this.attacks.set(move.id, move);
  }
  attemptAttack(id: string): boolean {
    this.attemptAttackCalls.push(id);
    return this.attacks.has(id);
  }
}

function spawnSword(
  registry: ItemRegistry,
  pos = { x: 80, y: 200 },
  frame = 0,
): ItemEntity {
  const entity = registry.spawn(SWORD_DEFINITION, pos, frame, ItemEntity);
  // Move past the falling state immediately so the override tests can
  // hit the held contract without booting a Matter step.
  entity.markGrounded(frame, pos);
  return entity;
}

/**
 * Build the sword's slot override directly off the definition, the
 * way `Inventory.pickup` does — factory runs once at pickup time,
 * closed over holder + item + frame.
 */
function buildOverride(
  stub: StubCharacter,
  item: ItemEntity,
  slot: AttackMovesetSlotName = 'jab',
  frame = 0,
): () => boolean {
  const ctx: SlotOverrideContext = {
    holder: stub,
    frame,
    itemEntity: item,
  };
  return SWORD_DEFINITION.buildSlotOverride(slot, ctx);
}

// ---------------------------------------------------------------------------
// Definition shape
// ---------------------------------------------------------------------------

describe('sword definition shape', () => {
  it('exports frozen records', () => {
    expect(Object.isFrozen(SWORD_DEFINITION)).toBe(true);
    expect(Object.isFrozen(SWORD_SLASH_MOVE)).toBe(true);
    expect(Object.isFrozen(SWORD_DEFINITION.slotOverrides)).toBe(true);
    expect(Object.isFrozen(SWORD_DEFINITION.throwBehavior)).toBe(true);
    expect(Object.isFrozen(SWORD_DEFINITION.attackMoves)).toBe(true);
  });

  it('declares the melee-weapon taxonomy values', () => {
    expect(SWORD_DEFINITION.type).toBe('sword');
    expect(SWORD_DEFINITION.category).toBe('melee-weapon');
    expect(SWORD_DEFINITION.maxDurability).toBe(8);
    expect(SWORD_DEFINITION.ttlFrames).toBe(600);
    expect(SWORD_DEFINITION.brokenDespawnFrames).toBe(30);
  });

  it('overrides jab/tilt/smash slots', () => {
    expect([...SWORD_DEFINITION.slotOverrides].sort()).toEqual([
      'jab',
      'smash',
      'tilt',
    ]);
  });

  it('registers the slash move on pickup via attackMoves', () => {
    expect(SWORD_DEFINITION.attackMoves).toEqual([SWORD_SLASH_MOVE]);
    expect(SWORD_SLASH_MOVE.id).toBe('item.sword.slash');
    expect(SWORD_SLASH_MOVE.type).toBe('jab');
    expect(SWORD_SLASH_MOVE.damage).toBe(11);
    expect(SWORD_SLASH_MOVE.knockback).toEqual({ x: 2.6, y: -0.9, scaling: 0.22 });
    expect(SWORD_SLASH_MOVE.hitbox).toEqual({
      offsetX: 42,
      offsetY: -6,
      width: 64,
      height: 26,
    });
    expect(SWORD_SLASH_MOVE.startupFrames).toBe(5);
    expect(SWORD_SLASH_MOVE.activeFrames).toBe(3);
    expect(SWORD_SLASH_MOVE.recoveryFrames).toBe(9);
    expect(SWORD_SLASH_MOVE.cooldownFrames).toBe(6);
  });

  it('authors a tipper sweet-spot that is a strict sub-region of the blade', () => {
    const sweet = SWORD_SLASH_MOVE.sweetSpot;
    expect(sweet).toBeDefined();
    expect(sweet!.hitbox).toEqual({
      offsetX: 62,
      offsetY: -6,
      width: 24,
      height: 26,
    });
    expect(sweet!.damageMultiplier).toBe(1.35);
    expect(sweet!.knockbackMultiplier).toBe(1.3);

    // The runtime tests `pointInSweetSpot && pointInHitbox` — a tip
    // region outside the parent blade would simply never fire. Prove
    // the authored geometry keeps the tip inside the parent.
    const parent = SWORD_SLASH_MOVE.hitbox;
    const parentLeft = parent.offsetX - parent.width / 2;
    const parentRight = parent.offsetX + parent.width / 2;
    const tipLeft = sweet!.hitbox.offsetX - sweet!.hitbox.width / 2;
    const tipRight = sweet!.hitbox.offsetX + sweet!.hitbox.width / 2;
    expect(tipLeft).toBeGreaterThanOrEqual(parentLeft);
    expect(tipRight).toBeLessThanOrEqual(parentRight);
    // Tip hugs the far edge of the blade — the spacing reward.
    expect(tipRight).toBe(parentRight);
  });
});

// ---------------------------------------------------------------------------
// Slot override behaviour
// ---------------------------------------------------------------------------

describe('sword slot override', () => {
  it('fires the slash via holder.attemptAttack and consumes durability', () => {
    const stub = new StubCharacter();
    stub.addAttack(SWORD_SLASH_MOVE);
    const registry = new ItemRegistry();
    const sword = spawnSword(registry);
    sword.markHeld(0, 0, stub.position);

    const fire = buildOverride(stub, sword);
    expect(fire()).toBe(true);
    expect(stub.attemptAttackCalls).toEqual(['item.sword.slash']);
    expect(sword.getDurability()).toBe(SWORD_DEFINITION.maxDurability - 1);
  });

  it('declines without consuming durability when attemptAttack fails', () => {
    // Holder without the slash registered (e.g. mid-cooldown in the
    // real Character) — the press is not consumed and durability is
    // untouched, so the fighter's native slot move runs as fallback.
    const stub = new StubCharacter();
    const registry = new ItemRegistry();
    const sword = spawnSword(registry);
    sword.markHeld(0, 0, stub.position);

    const fire = buildOverride(stub, sword);
    expect(fire()).toBe(false);
    expect(sword.getDurability()).toBe(SWORD_DEFINITION.maxDurability);
  });

  it('breaks after exactly 8 successful slashes, then declines', () => {
    const stub = new StubCharacter();
    stub.addAttack(SWORD_SLASH_MOVE);
    const registry = new ItemRegistry();
    const sword = spawnSword(registry);
    sword.markHeld(0, 0, stub.position);

    const fire = buildOverride(stub, sword);
    let consumed = 0;
    for (let i = 0; i < SWORD_DEFINITION.maxDurability; i++) {
      if (fire()) consumed += 1;
    }
    expect(consumed).toBe(8);
    // Last use marks broken in-place at the holder's position.
    expect(sword.getDurability()).toBe(0);
    expect(sword.isBroken()).toBe(true);
    expect(sword.getSnapshot().position).toEqual(stub.position);
    // The 9th press declines (sword is broken / durability empty).
    expect(fire()).toBe(false);
    expect(stub.attemptAttackCalls).toHaveLength(8);
  });

  it('stays unbroken before the final use', () => {
    const stub = new StubCharacter();
    stub.addAttack(SWORD_SLASH_MOVE);
    const registry = new ItemRegistry();
    const sword = spawnSword(registry);
    sword.markHeld(0, 0, stub.position);

    const fire = buildOverride(stub, sword);
    for (let i = 0; i < SWORD_DEFINITION.maxDurability - 1; i++) {
      expect(fire()).toBe(true);
    }
    expect(sword.getDurability()).toBe(1);
    expect(sword.isBroken()).toBe(false);
  });

  it('uses the same callback contract for every overridden slot', () => {
    const stub = new StubCharacter();
    stub.addAttack(SWORD_SLASH_MOVE);
    const registry = new ItemRegistry();
    const sword = spawnSword(registry);
    sword.markHeld(0, 0, stub.position);

    for (const slot of SWORD_DEFINITION.slotOverrides) {
      expect(buildOverride(stub, sword, slot)()).toBe(true);
    }
    expect(stub.attemptAttackCalls).toEqual([
      'item.sword.slash',
      'item.sword.slash',
      'item.sword.slash',
    ]);
    expect(sword.getDurability()).toBe(SWORD_DEFINITION.maxDurability - 3);
  });
});

// ---------------------------------------------------------------------------
// Throw behaviour
// ---------------------------------------------------------------------------

describe('sword throw behaviour', () => {
  it('declares the full direction table and survives impact', () => {
    const tb = SWORD_DEFINITION.throwBehavior;
    expect(tb.forward).toEqual({ velocityX: 15, velocityY: -2 });
    expect(tb.back).toEqual({ velocityX: -11, velocityY: -2 });
    expect(tb.up).toEqual({ velocityX: 0, velocityY: -17 });
    expect(tb.down).toEqual({ velocityX: 0, velocityY: 13 });
    expect(tb.drop).toEqual({ velocityX: 0, velocityY: 0 });
    // Melee weapon — lands grounded after a throw, fully usable.
    expect(tb.consumeOnImpact).toBe(false);
  });
});
