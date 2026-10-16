import { describe, expect, it } from 'vitest';
import { HOME_RUN_BAT_DEFINITION } from './HomeRunBat';
import { ItemEntity } from './ItemEntity';

const uses = HOME_RUN_BAT_DEFINITION.uses!;
const total = (m: { startupFrames: number; activeFrames: number; recoveryFrames: number }) =>
  m.startupFrames + m.activeFrames + m.recoveryFrames;

describe('Home-Run Bat (docs/review/2026-10-11/ultimate-items/phase-1/sources.json)', () => {
  it('is a light battering item with exactly the four item swipes', () => {
    expect(HOME_RUN_BAT_DEFINITION.itemClass).toBe('battering');
    expect(HOME_RUN_BAT_DEFINITION.heavy).not.toBe(true);
    expect(Object.keys(uses).sort()).toEqual(['dashAttack', 'fsmash', 'ftilt', 'jab']);
  });

  it('deals the SmashWiki Ultimate damages: jab 7, ftilt 13, dash 16, fsmash 30', () => {
    expect([uses.jab!.damage, uses.ftilt!.damage, uses.dashAttack!.damage, uses.fsmash!.damage]).toEqual([7, 13, 16, 30]);
  });

  it('forward smash is one fixed, uncharged swing hitting on frame 51 (SmashWiki "Ultimate | All characters | 51")', () => {
    expect('charge' in uses.fsmash!).toBe(false);
    // Engine convention: frame 1 is elapsed step 0, so the first active frame N has startupFrames N-1.
    expect(uses.fsmash!.startupFrames).toBe(50);
  });

  it('native-derived windows: hitbox frames from BatSwing*.txt, totals from motion cancel_frame (FAF − 1)', () => {
    expect([uses.jab!.startupFrames, uses.jab!.activeFrames, total(uses.jab!)]).toEqual([3, 2, 25]);
    expect([uses.ftilt!.startupFrames, uses.ftilt!.activeFrames, total(uses.ftilt!)]).toEqual([7, 2, 37]);
    expect([uses.dashAttack!.startupFrames, uses.dashAttack!.activeFrames, total(uses.dashAttack!)]).toEqual([6, 7, 44]);
    expect(total(uses.fsmash!)).toBe(80);
  });

  it('plays the native item motions (DK installed clips item_bat_swing_1/_3/_dash/_4)', () => {
    expect([uses.jab!.itemClip, uses.ftilt!.itemClip, uses.dashAttack!.itemClip, uses.fsmash!.itemClip])
      .toEqual(['item_bat_swing_1', 'item_bat_swing_3', 'item_bat_swing_dash', 'item_bat_swing_4']);
  });

  it('the forward smash reflects from its start and swings at once on a reflect (SmashWiki Ultimate)', () => {
    const r = uses.fsmash!.reflectWindow!;
    expect(r.startFrame).toBe(0);
    expect(r.swingOnReflect).toBe(true);
    for (const m of [uses.jab!, uses.ftilt!, uses.dashAttack!]) expect(m.reflectWindow).toBeUndefined();
  });

  it('never breaks: SmashWiki states no durability for battering items', () => {
    expect(HOME_RUN_BAT_DEFINITION.ammo).toBeUndefined();
    const bat = new ItemEntity(1, HOME_RUN_BAT_DEFINITION, 0, { x: 0, y: 0 });
    bat.markGrounded(0, { x: 0, y: 0 });
    bat.markHeld(0, 0, { x: 0, y: 0 });
    for (let i = 0; i < 50; i++) bat.noteUse(i, { x: 0, y: 0 });
    expect(bat.canUse()).toBe(true);
    expect(bat.isBroken()).toBe(false);
  });

  it('has a real sprite visual (not a debug rectangle)', () => {
    expect(HOME_RUN_BAT_DEFINITION.visual?.spriteKey).toBe('item.bat.sprite');
  });
});
