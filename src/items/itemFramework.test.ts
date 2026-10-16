/**
 * Items framework integration tests (Ultimate items phase 1).
 *
 * Drives pickup / equip / per-input item use / ammo / throw / break /
 * despawn with a stub holder so the deterministic data layer is exercised
 * without booting Phaser. Character's real routing is covered by
 * homeRunBat.physics.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  HOME_RUN_BAT_DEFINITION,
  RAY_GUN_DEFINITION,
  BOB_OMB_DEFINITION,
  ItemEntity,
  ItemRegistry,
  Inventory,
  resolveItemInput,
  type HeldItemHandle,
  type ItemDefinition,
  type ItemInputPattern,
} from './index';
import { DEFAULT_FIGHTER_ITEM_PROFILE, getItemActionPlan, itemReleaseVelocity, selectItemThrow,
  resolveItemThrowDirection } from './itemActions';
import { fighterAcquisitionRectangle, nearestAcquirableItem } from './itemAcquisitionBounds';
import { nativeItemReleaseVelocity } from './nativeItemThrow';

// ---------------------------------------------------------------------------
// Stub holder — the surface the inventory drives, plus the dispatch step
// Character performs (resolveItemInput → start the move → noteUse).
// ---------------------------------------------------------------------------

class StubCharacter {
  readonly id = 'donkeykong' as const;
  canUseItemsBeforeInput() { return true; }
  private attacks = new Map<string, unknown>();
  equipped: HeldItemHandle | null = null;
  facing: 1 | -1 = 1;
  position = { x: 100, y: 200 };
  started: string[] = [];
  addAttack(move: { id: string }) { this.attacks.set(move.id, move); }
  equipItem(item: HeldItemHandle) { this.equipped = item; }
  unequipItem() { this.equipped = null; }
  getFacing(): 1 | -1 { return this.facing; }
  getPosition() { return this.position; }
  /** The id of the item move a press would start, or null for the native move. */
  press(pattern: ItemInputPattern, frame = 0): string | null {
    const item = this.equipped;
    const decision = item ? resolveItemInput(pattern, item.definition.uses, item.canUse()) : null;
    const move = decision?.kind === 'use' ? decision.move : null;
    if (!move || !this.attacks.has(move.id)) return null;
    this.started.push(move.id);
    item!.noteUse(frame, this.position);
    return move.id;
  }
}

/** The match's ground pickup: the nearest pickable item inside the holder's acquisition range. */
function groundPickup(stub: StubCharacter, inv: Inventory, registry: ItemRegistry, frame: number): ItemEntity | null {
  if (inv.isHolding()) return null;
  const range = fighterAcquisitionRectangle(DEFAULT_FIGHTER_ITEM_PROFILE, stub.position, stub.facing, false, 0);
  const item = nearestAcquirableItem(range, stub.position, registry.getGrounded().filter(e => e.isPickable()));
  return item && inv.pickup(item, frame, 0, stub.position) ? item : null;
}

/** A grab-throw through the shared planner: the release velocity the match launches the item with. */
function groundThrow(stub: StubCharacter, inv: Inventory, moveX: number, moveY: number) {
  const item = inv.getHeldItem()!;
  const direction = resolveItemThrowDirection(moveX, moveY, stub.facing);
  const action = selectItemThrow({ airborne: false, direction, strength: 'ordinary',
    groundDropAllowed: item.definition.itemClass === 'battering' || item.definition.itemClass === 'shooting' });
  const velocity = nativeItemReleaseVelocity(item.definition.throwProfile,
    itemReleaseVelocity(getItemActionPlan(action, DEFAULT_FIGHTER_ITEM_PROFILE), stub.facing, DEFAULT_FIGHTER_ITEM_PROFILE));
  inv.detachWithoutDrop();
  return { action, velocity };
}

function makeRegistry() {
  return new ItemRegistry();
}

function spawnItem(registry: ItemRegistry, def: ItemDefinition, pos = { x: 80, y: 200 }, frame = 0): ItemEntity {
  const entity = registry.spawn(def, pos, frame, ItemEntity);
  entity.markGrounded(frame, pos);
  return entity;
}

function holding(def: ItemDefinition) {
  const stub = new StubCharacter();
  const registry = makeRegistry();
  const item = spawnItem(registry, def, { x: 100, y: 200 });
  const inv = new Inventory(stub as any);
  groundPickup(stub, inv, registry, 0);
  return { stub, registry, item, inv };
}

describe('pickup equips the item', () => {
  it('picks up a grounded item inside the acquisition range', () => {
    const stub = new StubCharacter();
    const registry = makeRegistry();
    const item = spawnItem(registry, HOME_RUN_BAT_DEFINITION, { x: 150, y: 200 });
    const inv = new Inventory(stub as any);
    expect(groundPickup(stub, inv, registry, 10)).toBe(item);
    expect(inv.isHolding()).toBe(true);
    expect(stub.equipped).toBe(item);
  });

  it('rejects pickup when out of range (behind the short back range too)', () => {
    const stub = new StubCharacter();
    const registry = makeRegistry();
    spawnItem(registry, HOME_RUN_BAT_DEFINITION, { x: 500, y: 200 });
    spawnItem(registry, HOME_RUN_BAT_DEFINITION, { x: 30, y: 200 });
    const inv = new Inventory(stub as any);
    expect(groundPickup(stub, inv, registry, 0)).toBe(null);
    expect(stub.equipped).toBe(null);
  });

  it('honors the single-slot inventory invariant — second pickup rejected while held', () => {
    const stub = new StubCharacter();
    const registry = makeRegistry();
    spawnItem(registry, HOME_RUN_BAT_DEFINITION, { x: 100, y: 200 });
    spawnItem(registry, RAY_GUN_DEFINITION, { x: 110, y: 200 });
    const inv = new Inventory(stub as any);
    expect(groundPickup(stub, inv, registry, 0)).not.toBe(null);
    expect(groundPickup(stub, inv, registry, 1)).toBe(null);
  });

  it('every release unequips', () => {
    for (const release of ['drop', 'detachWithoutDrop', 'breakHeldItem'] as const) {
      const { stub, inv } = holding(HOME_RUN_BAT_DEFINITION);
      if (release === 'detachWithoutDrop') inv.detachWithoutDrop();
      else inv[release](1, { x: 0, y: 0 });
      expect(stub.equipped).toBe(null);
    }
  });
});

describe('direction-aware throw through the shared planner', () => {
  it('a neutral press ground-drops a battering item behind (power 0.5) and throws other items forward', () => {
    const bat = holding(HOME_RUN_BAT_DEFINITION);
    const drop = groundThrow(bat.stub, bat.inv, 0, 0);
    expect(drop.action).toBe('ground-drop');
    expect(drop.velocity.power).toBe(.5);
    expect(bat.inv.isHolding()).toBe(false);
    const bobOmb = holding(BOB_OMB_DEFINITION);
    expect(groundThrow(bobOmb.stub, bobOmb.inv, 0, 0).action).toBe('throw-ground-forward-ordinary');
  });

  it('forward throw follows the facing', () => {
    const right = holding(HOME_RUN_BAT_DEFINITION);
    const r = groundThrow(right.stub, right.inv, 1, 0);
    expect(r.action).toBe('throw-ground-forward-ordinary');
    expect(r.velocity.x).toBeGreaterThan(0);
    const left = holding(RAY_GUN_DEFINITION);
    left.stub.facing = -1;
    const l = groundThrow(left.stub, left.inv, -1, 0);
    expect(l.action).toBe('throw-ground-forward-ordinary');
    expect(l.velocity.x).toBeLessThan(0);
    const up = holding(HOME_RUN_BAT_DEFINITION);
    expect(groundThrow(up.stub, up.inv, 0, -1).action).toBe('throw-ground-up-ordinary');
  });
});

// ---------------------------------------------------------------------------
// Item uses and ammo
// ---------------------------------------------------------------------------

describe('Home-Run Bat uses', () => {
  it('jab / tilt / dash attack / smash start the bat swipes; other inputs stay native', () => {
    const { stub } = holding(HOME_RUN_BAT_DEFINITION);
    const u = HOME_RUN_BAT_DEFINITION.uses!;
    expect(['jab', 'tilt', 'dashAttack', 'smash'].map(p => stub.press(p as ItemInputPattern)))
      .toEqual([u.jab!.id, u.ftilt!.id, u.dashAttack!.id, u.fsmash!.id]);
    expect(['utilt', 'dtilt', 'usmash', 'dsmash', 'aerial'].map(p => stub.press(p as ItemInputPattern)))
      .toEqual([null, null, null, null, null]);
  });

  it('never breaks (no Ultimate break count)', () => {
    const { stub, item } = holding(HOME_RUN_BAT_DEFINITION);
    for (let i = 0; i < 40; i++) expect(stub.press('jab', i)).not.toBe(null);
    expect(item.isBroken()).toBe(false);
  });
});

describe('throwing items have no item uses', () => {
  it('Bob-omb: no press becomes an item use (the attack button throws it: MatchScene.prepareItemInput)', () => {
    const { stub, item } = holding(BOB_OMB_DEFINITION);
    expect(['jab', 'tilt', 'dashAttack', 'nair', 'aerial'].map(p => stub.press(p as ItemInputPattern))).toEqual([null, null, null, null, null]);
    expect(item.isBroken()).toBe(false);
  });
});

describe('AC 16 — broken visual + TTL despawn', () => {
  it('broken item despawns after brokenDespawnFrames', () => {
    const registry = makeRegistry();
    const bat = spawnItem(registry, HOME_RUN_BAT_DEFINITION, { x: 100, y: 200 });

    bat.markBroken(10, { x: 100, y: 200 });
    expect(bat.isBroken()).toBe(true);

    // Just before the timer expires — still broken.
    registry.tick(10 + HOME_RUN_BAT_DEFINITION.brokenDespawnFrames - 1);
    expect(bat.isBroken()).toBe(true);

    // At threshold — flips to despawned.
    registry.tick(10 + HOME_RUN_BAT_DEFINITION.brokenDespawnFrames);
    expect(bat.isDespawned()).toBe(true);
  });

  it('unpicked grounded item despawns after TTL', () => {
    const registry = makeRegistry();
    const bat = spawnItem(registry, HOME_RUN_BAT_DEFINITION, { x: 100, y: 200 }, 0);
    expect(bat.isPickable()).toBe(true);

    registry.tick(HOME_RUN_BAT_DEFINITION.ttlFrames - 1);
    expect(bat.isPickable()).toBe(true);

    registry.tick(HOME_RUN_BAT_DEFINITION.ttlFrames);
    expect(bat.isDespawned()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Extensibility: a new item is one definition
// ---------------------------------------------------------------------------

describe('extensibility invariant', () => {
  it('a new item plugs in through its uses table with no framework edits', () => {
    const MOCK_MOVE = Object.freeze({
      id: 'item.mock.poke', type: 'jab' as const, damage: 3, knockback: { x: 1, y: 0, scaling: 0 },
      hitbox: { offsetX: 30, offsetY: 0, width: 20, height: 20 },
      startupFrames: 2, activeFrames: 2, recoveryFrames: 4, cooldownFrames: 0,
    });
    const MOCK_DEFINITION: ItemDefinition = Object.freeze({
      type: 'mockItem',
      itemClass: 'battering',
      ammo: 3,
      ttlFrames: 100,
      brokenDespawnFrames: 10,
      throwProfile: HOME_RUN_BAT_DEFINITION.throwProfile,
      uses: Object.freeze({ ftilt: MOCK_MOVE }),
    });
    const { stub, item } = holding(MOCK_DEFINITION);
    expect(stub.press('jab')).toBe(null);
    expect([stub.press('tilt'), stub.press('tilt'), stub.press('tilt')]).toEqual(['item.mock.poke', 'item.mock.poke', 'item.mock.poke']);
    expect(item.isBroken()).toBe(true);
    expect(stub.press('tilt')).toBe(null);
  });
});
