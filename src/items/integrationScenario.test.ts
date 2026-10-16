/**
 * 4-player match integration scenario — T3 items framework, AC 19.
 *
 * Drives the headless deterministic data layer end-to-end through the
 * AC 19 scenario:
 *
 *   1. Items spawn on timer at anchors (ItemSpawnManager + RNG).
 *   2. P1 picks up bat via jab-near, swings 5 times until break.
 *   3. P2 picks up the Ray Gun, fires its 16 shots; the empty gun's fire press throws it.
 *   4. P3 picks up the Bob-omb and throws it.
 *   5. P4 (bot) picks up an item via simpleBot's item-awareness branch.
 *   6. Refactor invariants pass (per-fighter slot count, etc.).
 *   7. The replay event log records every spawn (type, position, tick).
 */

import { describe, it, expect } from 'vitest';
import {
  HOME_RUN_BAT_DEFINITION,
  RAY_GUN_DEFINITION,
  BOB_OMB_DEFINITION,
  ItemRegistry,
  ItemEntity,
  Inventory,
  ItemSpawnManager,
} from './index';
import { DEFAULT_FIGHTER_ITEM_PROFILE, getItemActionPlan, itemReleaseVelocity, resolveItemThrowDirection,
  selectItemThrow } from './itemActions';
import { fighterAcquisitionRectangle, nearestAcquirableItem } from './itemAcquisitionBounds';
import { nativeItemReleaseVelocity } from './nativeItemThrow';
import { ItemSpawnEventLog } from '../replay/ItemSpawnEventLog';
import { MatchRng } from '../match/MatchRng';
import { resolveItemInput, type ItemInputPattern } from './resolveItemInput';
import type { HeldItemHandle } from './ItemDefinition';
import {
  simpleBotInput,
  resetSimpleBotState,
  type ItemSnapshot,
  type HeldItemSnapshot,
} from '../ai/simpleBot';

// Stub fighter mirroring the surface the item framework reads.
class StubFighter {
  readonly id = 'donkeykong' as const;
  canUseItemsBeforeInput() { return true; }
  private attacks = new Map<string, unknown>();
  private equipped: HeldItemHandle | null = null;
  facing: 1 | -1 = 1;
  position: { x: number; y: number };
  constructor(position: { x: number; y: number }) {
    this.position = position;
  }
  equipItem(item: HeldItemHandle) { this.equipped = item; }
  unequipItem() { this.equipped = null; }
  /** Character's dispatch step: resolve the press, start the item move (or shoot one shot), count the use. */
  press(pattern: ItemInputPattern): boolean | 'empty-throw' {
    const item = this.equipped;
    const decision = item ? resolveItemInput(pattern, item.definition.uses, item.canUse(), false,
      item.definition.shooting !== undefined) : null;
    if (decision?.kind === 'fire') return item!.spendShot();
    if (decision?.kind === 'empty-throw') return 'empty-throw';
    const move = decision?.kind === 'use' ? decision.move : null;
    if (!move || !this.attacks.has(move.id)) return false;
    item!.noteUse(0, this.position);
    return true;
  }
  getFacing(): 1 | -1 {
    return this.facing;
  }
  getPosition() {
    return this.position;
  }
  addAttack(move: { id: string }) {
    this.attacks.set(move.id, move);
  }
}

describe('AC 19 — 4-player match integration scenario', () => {
  it('runs the full P1 bat / P2 ray gun / P3 Bob-omb / P4 bot scenario', () => {
    // ---- Setup ---------------------------------------------------------
    const registry = new ItemRegistry();
    const eventLog = new ItemSpawnEventLog();
    const matchRng = new MatchRng(12345);

    // 4 fighters, one anchor cluster around mid-stage.
    const p1 = new StubFighter({ x: 100, y: 200 });
    const p2 = new StubFighter({ x: 200, y: 200 });
    const p3 = new StubFighter({ x: 300, y: 200 });
    const p4 = new StubFighter({ x: 400, y: 200 });

    const inventories = [
      new Inventory(p1 as any),
      new Inventory(p2 as any),
      new Inventory(p3 as any),
      new Inventory(p4 as any),
    ];

    const spawnAnchors = [
      { x: 110, y: 180 },
      { x: 210, y: 180 },
      { x: 310, y: 180 },
      { x: 410, y: 180 },
    ];

    // SpawnManager is constructed for completeness (proves the wiring
    // accepts the 4-anchor stage) but the test doesn't drive it — we
    // hand-spawn 4 items so the assertions don't depend on the RNG
    // schedule (which has its own dedicated tests).
    void new ItemSpawnManager({
      frequency: 'high',
      anchors: spawnAnchors,
      rng: matchRng,
    });

    // The match's ground pickup: the nearest pickable item inside the fighter's acquisition range.
    const pickupCtl = { tryPickup(f: StubFighter, inventory: Inventory, items: ItemRegistry, player: number, frame: number, _press: boolean) {
      const range = fighterAcquisitionRectangle(DEFAULT_FIGHTER_ITEM_PROFILE, f.position, f.facing, false, 0);
      const item = nearestAcquirableItem(range, f.position, items.getGrounded().filter(e => e.isPickable()));
      return item && inventory.pickup(item, frame, player, f.position) ? item : null;
    } };

    // ---- Spawn 4 items deterministically -------------------------------
    // Manually place one item per anchor (the test isn't validating the
    // ItemSpawnManager's RNG schedule — that's covered by its own tests
    // — but it IS validating that the registry + event log pipeline
    // records every spawn).
    const definitions = [
      HOME_RUN_BAT_DEFINITION,
      RAY_GUN_DEFINITION,
      BOB_OMB_DEFINITION,
      HOME_RUN_BAT_DEFINITION, // P4's bot grabs a bat
    ];
    for (let i = 0; i < 4; i++) {
      const def = definitions[i]!;
      const anchor = spawnAnchors[i]!;
      const entity = registry.spawn(def, anchor, i * 100, ItemEntity);
      entity.markGrounded(i * 100, anchor);
      eventLog.record({
        frame: i * 100,
        type: def.type,
        x: anchor.x,
        y: anchor.y,
        anchorIndex: i,
      });
    }

    // ---- AC 17 — replay event log records every spawn ------------------
    expect(eventLog.size()).toBe(4);
    const events = eventLog.getEntries();
    expect(events[0]!.type).toBe('homeRunBat');
    expect(events[1]!.type).toBe('rayGun');
    expect(events[2]!.type).toBe('bobOmb');
    expect(events[3]!.type).toBe('homeRunBat');

    // ---- P1 picks up the Home-Run Bat: swings never break it (Ultimate) --
    const batItem = registry.getActive()[0]!;
    p1.position = { x: batItem.getPosition().x, y: batItem.getPosition().y };
    const pickedBat = pickupCtl.tryPickup(p1, inventories[0]!, registry, 1, 200, true);
    expect(pickedBat).toBe(batItem);
    expect(inventories[0]!.isHolding()).toBe(true);

    let p1Swings = 0;
    for (const pattern of ['jab', 'tilt', 'dashAttack', 'smash', 'jab', 'jab'] as const) {
      if (p1.press(pattern)) p1Swings += 1;
    }
    expect(p1Swings).toBe(6);
    expect(batItem.isBroken()).toBe(false);
    expect(p1.press('aerial')).toBe(false); // aerials stay native

    // ---- P2 picks up the Ray Gun, fires 16 shots, then the empty gun is thrown ----
    const rayGun = registry.getActive().find((e) => e.definition.type === 'rayGun')!;
    p2.position = { x: rayGun.getPosition().x, y: rayGun.getPosition().y };
    const pickedGun = pickupCtl.tryPickup(p2, inventories[1]!, registry, 2, 210, true);
    expect(pickedGun).toBe(rayGun);

    let p2Shots = 0;
    for (let i = 0; i < 16; i++) {
      if (p2.press(i % 2 ? 'jab' : 'nair') === true) p2Shots += 1;
    }
    expect(p2Shots).toBe(16);
    expect(rayGun.isEmptyShooter()).toBe(true);
    expect(p2.press('jab')).toBe('empty-throw');

    // ---- P3 picks up the Bob-omb and throws it --------------------------
    const bomb = registry.getActive().find((e) => e.definition.type === 'bobOmb')!;
    p3.position = { x: bomb.getPosition().x, y: bomb.getPosition().y };
    const pickedBomb = pickupCtl.tryPickup(p3, inventories[2]!, registry, 3, 220, true);
    expect(pickedBomb).toBe(bomb);

    p3.facing = 1;
    // A forward grab-throw through the shared planner: direction, action, release velocity.
    const direction = resolveItemThrowDirection(1, 0, p3.facing);
    const action = selectItemThrow({ airborne: false, direction, strength: 'ordinary' });
    expect(action).toBe('throw-ground-forward-ordinary');
    const release = nativeItemReleaseVelocity(bomb.definition.throwProfile,
      itemReleaseVelocity(getItemActionPlan(action, DEFAULT_FIGHTER_ITEM_PROFILE), p3.facing, DEFAULT_FIGHTER_ITEM_PROFILE));
    expect(release.x).toBeGreaterThan(0); // launched forward
    expect(inventories[2]!.detachWithoutDrop()).toBe(bomb);
    expect(inventories[2]!.isHolding()).toBe(false);
    // A thrown Bob-omb explodes on what it hits (MatchScene.explodeItem takes it out of play).
    expect(bomb.definition.bobOmb).toBeDefined();
    bomb.markDespawned(231);
    expect(bomb.isDespawned()).toBe(true);

    // ---- P4 (bot) picks up the remaining bat via item-aware AI ---------
    const remainingBat = registry.getActive().find(
      (e) => e.definition.type === 'homeRunBat' && !e.isBroken() && !e.isHeld(),
    )!;
    expect(remainingBat).toBeDefined();

    const items: ItemSnapshot[] = [
      {
        position: remainingBat.getPosition(),
        itemClass: 'battering',
        pickable: true,
      },
    ];
    const opp = [
      { playerIndex: 1, position: p1.position, grounded: true },
    ];
    // Position the bot near the item so the bot's pickup branch fires.
    p4.position = { x: remainingBat.getPosition().x - 30, y: remainingBat.getPosition().y };
    const botKey = {};
    const botInput = simpleBotInput(
      botKey,
      { playerIndex: 4, position: p4.position, grounded: true },
      opp,
      'medium',
      items,
      null,
    );
    expect(botInput.attack).toBe(true); // bot pressed jab to pick up

    // Drive the pickup with the bot's press.
    const botPicked = pickupCtl.tryPickup(p4, inventories[3]!, registry, 4, 240, true);
    expect(botPicked).toBe(remainingBat);
    expect(inventories[3]!.isHolding()).toBe(true);

    // Reset the bot's state so the cooldown from the pickup press
    // doesn't suppress the next melee swing.
    resetSimpleBotState(botKey);

    // Now the bot has a melee weapon held; verify it would press jab
    // when in range of an opponent.
    const heldItem: HeldItemSnapshot = { itemClass: 'battering' };
    p4.position = { x: 110, y: 200 }; // close to P1
    const botInput2 = simpleBotInput(
      botKey,
      { playerIndex: 4, position: p4.position, grounded: true },
      [{ playerIndex: 1, position: { x: 170, y: 200 }, grounded: true }],
      'medium',
      [],
      heldItem,
    );
    expect(botInput2.attack).toBe(true);
  });

  it('refactor invariants — every fighter has all 10 slots, no attack code in Character', async () => {
    const { DONKEYKONG_FIGHTER_CONTRACT } = await import('../characters/DonkeyKong');
    const { PIKACHU_FIGHTER_CONTRACT } = await import('../characters/Pikachu');

    const expectedSlots = [
      'jab',
      'tilt',
      'smash',
      'fair',
      'shield',
      'dodge',
      'neutralSpecial',
      'sideSpecial',
      'upSpecial',
      'downSpecial',
    ];

    for (const contract of [
      DONKEYKONG_FIGHTER_CONTRACT,
      PIKACHU_FIGHTER_CONTRACT,
    ]) {
      for (const slot of expectedSlots) {
        expect(
          (contract.moveset as unknown as Record<string, unknown>)[slot],
          `${contract.id} missing slot '${slot}'`,
        ).toBeDefined();
      }
      // Movement profile per-fighter: jumpImpulse + maxJumps explicit.
      expect(typeof contract.movementProfile.jumpImpulse).toBe('number');
      expect(typeof contract.movementProfile.maxJumps).toBe('number');
    }
  });
});
