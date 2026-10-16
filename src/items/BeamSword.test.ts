import { describe, expect, it } from 'vitest';
import { BEAM_SWORD_DEFINITION } from './BeamSword';
import { computeChargedDamageFromSpec } from '../characters/chargeSchema';
import { resolveItemInput } from './resolveItemInput';
import type { AttackMoveWithAnimation } from '../characters/moveSchema';

const uses = BEAM_SWORD_DEFINITION.uses!;
const total = (m: { startupFrames: number; activeFrames: number; recoveryFrames: number }) =>
  m.startupFrames + m.activeFrames + m.recoveryFrames;

/** docs/review/2026-10-11/ultimate-items/phase-3/sources.json */
describe('Beam Sword', () => {
  it('is a light battering item with exactly the four item swipes and no break count', () => {
    expect(BEAM_SWORD_DEFINITION.type).toBe('beamSword');
    expect(BEAM_SWORD_DEFINITION.itemClass).toBe('battering');
    expect(BEAM_SWORD_DEFINITION.heavy).not.toBe(true);
    expect(BEAM_SWORD_DEFINITION.ammo).toBeUndefined();
    expect(Object.keys(uses).sort()).toEqual(['dashAttack', 'fsmash', 'ftilt', 'jab']);
  });

  it('deals the SmashWiki Ultimate damages: jab 4 (4.5 near the base), ftilt 9, dash 8 (7 near the base)', () => {
    expect([uses.jab!.damage, uses.ftilt!.damage, uses.dashAttack!.damage]).toEqual([4, 9, 8]);
    expect(uses.jab!.damage * uses.jab!.sweetSpot!.damageMultiplier!).toBeCloseTo(4.5, 10);
    expect(uses.dashAttack!.damage * uses.dashAttack!.sweetSpot!.damageMultiplier!).toBeCloseTo(7, 10);
    expect(uses.ftilt!.sweetSpot).toBeUndefined();
  });

  it('puts the base region inside the blade, at the hand end', () => {
    for (const m of [uses.jab!, uses.dashAttack!, uses.fsmash!]) {
      const blade = m.hitbox, base = m.sweetSpot!.hitbox;
      expect(base.offsetX - base.width / 2).toBe(blade.offsetX - blade.width / 2);
      expect(base.offsetX + base.width / 2).toBeLessThan(blade.offsetX + blade.width / 2);
    }
  });

  // Root decision (phase 4): SmashWiki "Forward Smash 13% - 19.6%" = tip 13 / base 14, each × the Ultimate
  // smash charge 1.4 (SmashWiki Smash_attack): tip 13 → 18.2, base 14 → 19.6.
  it('forward smash: tip 13 / base 14, both × 1.4 at full charge (13% – 19.6%)', () => {
    const fsmash = uses.fsmash as AttackMoveWithAnimation;
    const base = fsmash.sweetSpot!.damageMultiplier!;
    expect(fsmash.damage).toBe(13);
    expect(13 * base).toBeCloseTo(14, 10);
    expect(computeChargedDamageFromSpec(fsmash.charge!, 0)).toBe(13);
    expect(computeChargedDamageFromSpec(fsmash.charge!, 60)).toBeCloseTo(13 * 1.4, 10);
    expect(computeChargedDamageFromSpec(fsmash.charge!, 60) * base).toBeCloseTo(19.6, 10);
    expect(computeChargedDamageFromSpec(fsmash.charge!, 180)).toBeCloseTo(18.2, 10);
    expect(fsmash.charge!.maxHoldFrames).toBe(180);
    // SwordSwing4: FIGHTER_STATUS_ITEM_SWING_WORK_FLAG_START_SMASH_HOLD at native frame 7.
    expect(fsmash.chargeStartFrame).toBe(6);
  });

  it('has the longest blade on the forward smash (SmashWiki)', () => {
    const reach = (m: { hitbox: { offsetX: number; width: number } }) => m.hitbox.offsetX + m.hitbox.width / 2;
    for (const m of [uses.jab!, uses.ftilt!, uses.dashAttack!]) expect(reach(uses.fsmash!)).toBeGreaterThan(reach(m));
  });

  it('native-derived windows: SwordSwing*.txt hitbox frames, totals from the motion cancel_frame (FAF − 1)', () => {
    expect([uses.jab!.startupFrames, uses.jab!.activeFrames, total(uses.jab!)]).toEqual([3, 2, 25]);
    expect([uses.ftilt!.startupFrames, uses.ftilt!.activeFrames, total(uses.ftilt!)]).toEqual([7, 2, 37]);
    expect([uses.dashAttack!.startupFrames, uses.dashAttack!.activeFrames, total(uses.dashAttack!)]).toEqual([6, 7, 44]);
    expect([uses.fsmash!.startupFrames, uses.fsmash!.activeFrames, total(uses.fsmash!)]).toEqual([14, 1, 51]);
  });

  it('plays the native sword motions', () => {
    expect([uses.jab!.itemClip, uses.ftilt!.itemClip, uses.dashAttack!.itemClip, uses.fsmash!.itemClip])
      .toEqual(['item_sword_swing_1', 'item_sword_swing_3', 'item_sword_swing_dash', 'item_sword_swing_4']);
  });

  it('routes presses through the shared item decision; aerials and up/down tilts stay native', () => {
    expect(resolveItemInput('smash', uses, true)).toEqual({ kind: 'use', move: uses.fsmash });
    expect(resolveItemInput('aerial', uses, true)).toBeNull();
    expect(resolveItemInput('utilt', uses, true)).toBeNull();
    expect(resolveItemInput('usmash', uses, true)).toEqual({ kind: 'smash-throw', direction: 'up' });
  });

  it('throws on the Ultimate formula with the base damage the SmashWiki thrown table implies', () => {
    expect(BEAM_SWORD_DEFINITION.throwProfile).toMatchObject({ damage: 8, gravity: .075, terminalFallSpeed: 2,
      damageSpeedAdd: -.4, damageSpeedMultiplier: 3, referenceKnockbackMultiplier: .8 });
    expect(BEAM_SWORD_DEFINITION.visual?.spriteKey).toBe('item.beamSword.sprite');
  });
});
