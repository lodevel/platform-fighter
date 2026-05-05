/**
 * Items framework integration tests — T3, AC 11-20.
 *
 * Drives the item lifecycle / pickup / throw / break / despawn / replay
 * pathway end-to-end with a stub Character so the deterministic data
 * layer is exercised without booting Phaser.
 */

import { describe, it, expect } from 'vitest';
import {
  BAT_DEFINITION,
  RAY_GUN_DEFINITION,
  BOMB_DEFINITION,
  ItemEntity,
  ItemRegistry,
  Inventory,
  PickupController,
  ThrowController,
  resolveThrowDirection,
} from './index';
import type { AttackMovesetSlotName } from '../characters/movesetContract';

// ---------------------------------------------------------------------------
// Stub Character — minimal surface the items framework reads from.
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
  // Stubs for the held-item attack pipeline. Items register their
  // authored swing/shot/detonation moves via `addAttack` at pickup;
  // the slot-override callback then fires them via `attemptAttack`.
  // The stub records calls so tests can assert the dispatch happened
  // and returns `true` so the override proceeds to consume durability.
  addAttack(move: { id: string }) {
    this.attacks.set(move.id, move);
  }
  attemptAttack(id: string): boolean {
    this.attemptAttackCalls.push(id);
    return this.attacks.has(id);
  }
}

function makeRegistry() {
  return new ItemRegistry();
}

function spawnItem(
  registry: ItemRegistry,
  def: typeof BAT_DEFINITION,
  pos = { x: 80, y: 200 },
  frame = 0,
): ItemEntity {
  const entity = registry.spawn(def, pos, frame, ItemEntity);
  // Move past the falling state immediately so the pickup tests can
  // hit the grounded contract without booting a Matter step.
  entity.markGrounded(frame, pos);
  return entity;
}

// ---------------------------------------------------------------------------
// AC 11 — pickup
// ---------------------------------------------------------------------------

describe('AC 11 — pickup via jab-near', () => {
  it('picks up a grounded item within proximity on attack rising-edge', () => {
    const stub = new StubCharacter();
    stub.position = { x: 100, y: 200 };
    const registry = makeRegistry();
    const item = spawnItem(registry, BAT_DEFINITION, { x: 110, y: 200 });

    const inv = new Inventory(stub as any);
    const ctl = new PickupController({ pickupRadiusPx: 50 });

    const picked = ctl.tryPickup(stub as any, inv, registry, 0, 10, true);
    expect(picked).toBe(item);
    expect(inv.isHolding()).toBe(true);
  });

  it('rejects pickup when out of range', () => {
    const stub = new StubCharacter();
    stub.position = { x: 100, y: 200 };
    const registry = makeRegistry();
    spawnItem(registry, BAT_DEFINITION, { x: 500, y: 200 });

    const inv = new Inventory(stub as any);
    const ctl = new PickupController({ pickupRadiusPx: 50 });

    expect(ctl.tryPickup(stub as any, inv, registry, 0, 0, true)).toBe(null);
  });

  it('routes jab/tilt/smash through the bat slot override while held', () => {
    const stub = new StubCharacter();
    const registry = makeRegistry();
    const bat = spawnItem(registry, BAT_DEFINITION, { x: 100, y: 200 });
    const inv = new Inventory(stub as any);
    const ctl = new PickupController();

    ctl.tryPickup(stub as any, inv, registry, 0, 0, true);

    // Bat installs jab/tilt/smash overrides — firing any of them
    // should consume the press (return true) until durability runs
    // out.
    expect(stub.fireSlot('jab')).toBe(true);
    expect(stub.fireSlot('tilt')).toBe(true);
    expect(stub.fireSlot('smash')).toBe(true);
    expect(bat.getDurability()).toBe(2);
  });

  it('honors the single-slot inventory invariant — second pickup rejected while held', () => {
    const stub = new StubCharacter();
    const registry = makeRegistry();
    spawnItem(registry, BAT_DEFINITION, { x: 100, y: 200 });
    spawnItem(registry, RAY_GUN_DEFINITION, { x: 110, y: 200 });
    const inv = new Inventory(stub as any);
    const ctl = new PickupController();

    expect(ctl.tryPickup(stub as any, inv, registry, 0, 0, true)).not.toBe(null);
    expect(ctl.tryPickup(stub as any, inv, registry, 0, 1, true)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// AC 12 — throw
// ---------------------------------------------------------------------------

describe('AC 12 — direction-aware throw', () => {
  it('resolves direction from input fields', () => {
    expect(resolveThrowDirection(0, false, false, 1)).toBe('drop');
    expect(resolveThrowDirection(1, false, false, 1)).toBe('forward');
    expect(resolveThrowDirection(-1, false, false, 1)).toBe('back');
    expect(resolveThrowDirection(0, true, false, 1)).toBe('up');
    expect(resolveThrowDirection(0, false, true, 1)).toBe('down');
    // Down beats up beats side priority.
    expect(resolveThrowDirection(1, true, true, 1)).toBe('down');
  });

  it('drop-in-place when no direction held', () => {
    const stub = new StubCharacter();
    const registry = makeRegistry();
    spawnItem(registry, BAT_DEFINITION, { x: 100, y: 200 });
    const inv = new Inventory(stub as any);
    new PickupController().tryPickup(stub as any, inv, registry, 0, 0, true);

    const tc = new ThrowController();
    const result = tc.tryThrow(stub as any, inv, 1, true, 0, false, false);
    expect(result).not.toBe(null);
    expect(result!.direction).toBe('drop');
    expect(result!.velocityX).toBe(0);
    expect(result!.velocityY).toBe(0);
    expect(inv.isHolding()).toBe(false);
  });

  it('forward throw applies facing-mirrored velocity', () => {
    const stub = new StubCharacter();
    stub.facing = 1;
    const registry = makeRegistry();
    spawnItem(registry, BAT_DEFINITION, { x: 100, y: 200 });
    const inv = new Inventory(stub as any);
    new PickupController().tryPickup(stub as any, inv, registry, 0, 0, true);

    const tc = new ThrowController();
    const result = tc.tryThrow(stub as any, inv, 1, true, 1, false, false);
    expect(result!.direction).toBe('forward');
    expect(result!.velocityX).toBe(BAT_DEFINITION.throwBehavior.forward.velocityX);

    // Facing left mirrors the X impulse:
    stub.facing = -1;
    const item2 = spawnItem(registry, RAY_GUN_DEFINITION, stub.position);
    const ok2 = inv.pickup(item2, 2, 0, stub.position);
    expect(ok2).toBe(true);
    const r2 = tc.tryThrow(stub as any, inv, 3, true, -1, false, false);
    expect(r2!.direction).toBe('forward');
    expect(r2!.velocityX).toBe(-RAY_GUN_DEFINITION.throwBehavior.forward.velocityX);
  });
});

// ---------------------------------------------------------------------------
// AC 13 — bat
// ---------------------------------------------------------------------------

describe('AC 13 — bat reference item', () => {
  it('overrides jab/tilt/smash slots', () => {
    expect([...BAT_DEFINITION.slotOverrides].sort()).toEqual([
      'jab',
      'smash',
      'tilt',
    ]);
  });

  it('breaks after exactly 5 successful melee hits, drops inert', () => {
    const stub = new StubCharacter();
    const registry = makeRegistry();
    const bat = spawnItem(registry, BAT_DEFINITION, { x: 100, y: 200 });
    const inv = new Inventory(stub as any);
    new PickupController().tryPickup(stub as any, inv, registry, 0, 0, true);

    let consumed = 0;
    for (let i = 0; i < 5; i++) {
      if (stub.fireSlot('jab')) consumed += 1;
    }
    expect(consumed).toBe(5);
    expect(bat.isBroken()).toBe(true);
    // The 6th press declines (bat is broken).
    expect(stub.fireSlot('jab')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC 14 — ray gun
// ---------------------------------------------------------------------------

describe('AC 14 — ray gun reference item', () => {
  it('overrides only the jab slot', () => {
    // Per the seed's "while holding, jab re-routes to the item's slot
    // override" contract — the held-item button is uniform across the
    // roster (bat / gun / bomb all hijack jab).
    expect([...RAY_GUN_DEFINITION.slotOverrides]).toEqual(['jab']);
  });

  it('breaks after exactly 6 shots', () => {
    const stub = new StubCharacter();
    const registry = makeRegistry();
    const gun = spawnItem(registry, RAY_GUN_DEFINITION, { x: 100, y: 200 });
    const inv = new Inventory(stub as any);
    new PickupController().tryPickup(stub as any, inv, registry, 0, 0, true);

    let fired = 0;
    for (let i = 0; i < 6; i++) {
      if (stub.fireSlot('jab')) fired += 1;
    }
    expect(fired).toBe(6);
    expect(gun.isBroken()).toBe(true);
    expect(stub.fireSlot('jab')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC 15 — bomb
// ---------------------------------------------------------------------------

describe('AC 15 — bomb reference item', () => {
  it('is single-use throwable that consumes on impact', () => {
    expect(BOMB_DEFINITION.maxDurability).toBe(1);
    expect(BOMB_DEFINITION.throwBehavior.consumeOnImpact).toBe(true);
  });

  it('explodes on the single jab press', () => {
    const stub = new StubCharacter();
    const registry = makeRegistry();
    const bomb = spawnItem(registry, BOMB_DEFINITION, { x: 100, y: 200 });
    const inv = new Inventory(stub as any);
    new PickupController().tryPickup(stub as any, inv, registry, 0, 0, true);

    expect(stub.fireSlot('jab')).toBe(true);
    expect(bomb.isBroken()).toBe(true);
    expect(stub.fireSlot('jab')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC 16 — broken items drop inert + TTL despawn
// ---------------------------------------------------------------------------

describe('AC 16 — broken visual + TTL despawn', () => {
  it('broken item despawns after brokenDespawnFrames', () => {
    const registry = makeRegistry();
    const bat = spawnItem(registry, BAT_DEFINITION, { x: 100, y: 200 });

    bat.markBroken(10, { x: 100, y: 200 });
    expect(bat.isBroken()).toBe(true);

    // Just before the timer expires — still broken.
    registry.tick(10 + BAT_DEFINITION.brokenDespawnFrames - 1);
    expect(bat.isBroken()).toBe(true);

    // At threshold — flips to despawned.
    registry.tick(10 + BAT_DEFINITION.brokenDespawnFrames);
    expect(bat.isDespawned()).toBe(true);
  });

  it('unpicked grounded item despawns after TTL', () => {
    const registry = makeRegistry();
    const bat = spawnItem(registry, BAT_DEFINITION, { x: 100, y: 200 }, 0);
    expect(bat.isPickable()).toBe(true);

    registry.tick(BAT_DEFINITION.ttlFrames - 1);
    expect(bat.isPickable()).toBe(true);

    registry.tick(BAT_DEFINITION.ttlFrames);
    expect(bat.isDespawned()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC 20 — extensibility invariant: 4th item is one new file
// ---------------------------------------------------------------------------

describe('AC 20 — extensibility invariant', () => {
  it('a hypothetical 4th item type plugs in via ItemDefinition with no framework edits', () => {
    // Author a new item entirely within this test file — the framework
    // never sees `'mock-item'` by name. If pickup / inventory / break /
    // throw all work without any other module change, the invariant
    // holds.
    const MOCK_DEFINITION = Object.freeze({
      type: 'mockItem',
      category: 'effect-consumable' as const,
      maxDurability: 3,
      ttlFrames: 100,
      brokenDespawnFrames: 10,
      slotOverrides: Object.freeze(['fair'] as AttackMovesetSlotName[]),
      buildSlotOverride: (_slot: AttackMovesetSlotName, ctx: any) => {
        const item = ctx.itemEntity as ItemEntity;
        return () => {
          if (item.getDurability() <= 0) return false;
          item.consumeDurability();
          if (item.getDurability() <= 0) {
            item.markBroken(ctx.frame, { x: 0, y: 0 });
          }
          return true;
        };
      },
      throwBehavior: Object.freeze({
        forward: { velocityX: 8, velocityY: -2 },
        back: { velocityX: -6, velocityY: -2 },
        up: { velocityX: 0, velocityY: -10 },
        down: { velocityX: 0, velocityY: 8 },
        drop: { velocityX: 0, velocityY: 0 },
        consumeOnImpact: false,
      }),
    });

    const stub = new StubCharacter();
    const registry = makeRegistry();
    const mock = spawnItem(registry, MOCK_DEFINITION as any, { x: 100, y: 200 });
    const inv = new Inventory(stub as any);
    new PickupController().tryPickup(stub as any, inv, registry, 0, 0, true);

    // 3 successful presses then break — the framework treats the
    // mock item identically to bat / ray gun / bomb.
    expect(stub.fireSlot('fair')).toBe(true);
    expect(stub.fireSlot('fair')).toBe(true);
    expect(stub.fireSlot('fair')).toBe(true);
    expect(mock.isBroken()).toBe(true);
    expect(stub.fireSlot('fair')).toBe(false);
  });
});
