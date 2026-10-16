/**
 * Banana Peel (Ultimate items phase 5). Sources: docs/review/2026-10-11/ultimate-items/phase-5/sources.json.
 */
import { describe, expect, it } from 'vitest';
import { BANANA_PEEL_DEFINITION, bananaSlipHit } from './BananaPeel';
import { thrownItemHit } from './nativeItemThrow';
import { ItemEntity } from './ItemEntity';
import { Inventory } from './Inventory';

describe('Banana Peel', () => {
  it('lasts two slips and / or throws (SmashWiki, Ultimate)', () => {
    const peel = new ItemEntity(0, BANANA_PEEL_DEFINITION, 0, { x: 0, y: 0 });
    expect(peel.getDurability()).toBe(2);
    expect(peel.wearOut()).toBe(false);
    expect(peel.wearOut()).toBe(true);
    expect(peel.getDurability()).toBe(0);
  });

  it('its placer is the last fighter that held it (the placer cannot slip on it)', () => {
    const peel = new ItemEntity(0, BANANA_PEEL_DEFINITION, 0, { x: 0, y: 0 });
    expect(peel.getOwnerPlayerIndex()).toBeNull();
    peel.markGrounded(0, { x: 0, y: 0 });
    const holder = { id: 'pikachu' as const, addAttack() {}, equipItem() {}, unequipItem() {} };
    new Inventory(holder as never).pickup(peel, 1, 3, { x: 0, y: 0 });
    expect(peel.getOwnerPlayerIndex()).toBe(3);
  });

  it('thrown damage per throw kind (SmashWiki Ultimate column: 4.1 … 6.7, down tilt 1) and a slip on grounded targets', () => {
    const v = { vx: 8, vy: -2 };
    const at = (action: Parameters<typeof thrownItemHit>[1], grounded = true) =>
      thrownItemHit(BANANA_PEEL_DEFINITION, action, v, 1, 1, grounded);
    expect(at('throw-ground-forward-ordinary').damage).toBe(4.1);
    expect(at('throw-ground-up-strong').damage).toBe(6.7);
    expect(at('throw-ground-down-ordinary').damage).toBe(1);
    expect(at('dash-throw').damage).toBe(5);
    expect(at('air-z-drop').damage).toBe(4.7);
    expect(at('throw-ground-forward-ordinary').slip).toBe(true);
    expect(at('throw-ground-forward-ordinary', false).slip).toBeUndefined();
    // Not explosive: the ordinary 0.8x thrown-item knockback multiplier; native game_Throw BKB 50 / KBG 0 at 361.
    expect(at('throw-ground-forward-ordinary')).toMatchObject({ referenceKnockbackMultiplier: .8,
      knockback: { reference: { base: 50, growth: 0, angle: 361 } } });
  });

  it('stepping on it: a 0% slip (native game_SetSlipCallback)', () => {
    expect(bananaSlipHit(-1)).toMatchObject({ damage: 0, slip: true, facing: -1,
      knockback: { reference: { base: 50, growth: 0, angle: 361 } } });
  });
});
