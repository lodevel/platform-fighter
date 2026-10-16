import { describe, expect, it } from 'vitest';
import { STAR_ROD_DEFINITION, STAR_ROD_STAR } from './StarRod';
import { ItemEntity } from './ItemEntity';
import { resolveItemInput } from './resolveItemInput';
import { computeChargedDamageFromSpec } from '../characters/chargeSchema';
import type { AttackMoveWithAnimation } from '../characters/moveSchema';

const uses = STAR_ROD_DEFINITION.uses!;
const held = () => {
  const rod = new ItemEntity(1, STAR_ROD_DEFINITION, 0, { x: 0, y: 0 });
  rod.markGrounded(0, { x: 0, y: 0 });
  rod.markHeld(0, 0, { x: 0, y: 0 });
  return rod;
};

/** docs/review/2026-10-11/ultimate-items/phase-3/sources.json */
describe('Star Rod', () => {
  it('is a light battering item with the four item swipes and 16 stars', () => {
    expect(STAR_ROD_DEFINITION.type).toBe('starRod');
    expect(STAR_ROD_DEFINITION.itemClass).toBe('battering');
    expect(STAR_ROD_DEFINITION.ammo).toBe(16);
    expect(Object.keys(uses).sort()).toEqual(['dashAttack', 'fsmash', 'ftilt', 'jab']);
  });

  it('fires a star on forward tilt and forward smash only', () => {
    expect(uses.ftilt!.itemShot).toBe(STAR_ROD_STAR);
    expect(uses.fsmash!.itemShot).toBe(STAR_ROD_STAR);
    expect(uses.jab!.itemShot).toBeUndefined();
    expect(uses.dashAttack!.itemShot).toBeUndefined();
  });

  it('the star flies straight (native starrodshot gravity 0) with a 30 px damage area (clip sphere r 3 u)', () => {
    expect(STAR_ROD_STAR.width).toBe(30);
    expect(STAR_ROD_STAR.height).toBe(30);
    expect(STAR_ROD_STAR.speed).toBeGreaterThan(0);
    expect(STAR_ROD_STAR.lifetimeFrames).toBeGreaterThan(0);
  });

  it('spends one star per shot; swings never break it and the empty rod still swings', () => {
    const rod = held();
    for (let i = 0; i < 40; i++) rod.noteUse(i, { x: 0, y: 0 });
    expect(rod.getAmmo()).toBe(16);
    for (let i = 0; i < 16; i++) expect(rod.spendShot()).toBe(true);
    expect(rod.getAmmo()).toBe(0);
    expect(rod.spendShot()).toBe(false);
    expect(rod.isBroken()).toBe(false);
    expect(rod.canUse()).toBe(true);
    expect(resolveItemInput('tilt', uses, rod.canUse())).toEqual({ kind: 'use', move: uses.ftilt });
    expect(resolveItemInput('smash', uses, rod.canUse())).toEqual({ kind: 'use', move: uses.fsmash });
  });

  it('charges the forward smash by the Ultimate smash-charge multiplier 1.4 over 60 frames', () => {
    const fsmash = uses.fsmash as AttackMoveWithAnimation;
    expect(computeChargedDamageFromSpec(fsmash.charge!, 0)).toBe(fsmash.damage);
    expect(computeChargedDamageFromSpec(fsmash.charge!, 60)).toBeCloseTo(fsmash.damage * 1.4, 10);
    expect(fsmash.chargeStartFrame).toBe(6);
  });

  it('native-derived windows: StarRodSwing*.txt (star on the hitbox frame: ftilt 8, fsmash 15)', () => {
    expect([uses.jab!.startupFrames, uses.jab!.activeFrames]).toEqual([3, 2]);
    expect([uses.ftilt!.startupFrames, uses.ftilt!.activeFrames]).toEqual([7, 2]);
    expect([uses.dashAttack!.startupFrames, uses.dashAttack!.activeFrames]).toEqual([6, 7]);
    expect([uses.fsmash!.startupFrames, uses.fsmash!.activeFrames]).toEqual([14, 1]);
    expect([uses.jab!.itemClip, uses.ftilt!.itemClip, uses.dashAttack!.itemClip, uses.fsmash!.itemClip])
      .toEqual(['item_starrod_swing_1', 'item_starrod_swing_3', 'item_starrod_swing_dash', 'item_starrod_swing_4']);
  });

  it('has a real sprite visual', () => {
    expect(STAR_ROD_DEFINITION.visual?.spriteKey).toBe('item.starRod.sprite');
  });
});

describe('ammo spent per use (remaining test items)', () => {
  it('an item without shot ammo still spends one per use and breaks on its last', () => {
    const item = new ItemEntity(2, { ...STAR_ROD_DEFINITION, ammoSpentOnShot: undefined, ammo: 2 }, 0, { x: 0, y: 0 });
    item.markGrounded(0, { x: 0, y: 0 });
    item.markHeld(0, 0, { x: 0, y: 0 });
    item.noteUse(1, { x: 0, y: 0 });
    expect(item.canUse()).toBe(true);
    item.noteUse(2, { x: 0, y: 0 });
    expect(item.isBroken()).toBe(true);
  });
});
