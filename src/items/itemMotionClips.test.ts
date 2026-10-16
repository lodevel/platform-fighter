import { describe, expect, it } from 'vitest';
import { itemChargeClip, itemMotionClip } from './itemMotionClips';

/** art/item-clips.json already_installed_aliases: one drawn clip per native animation file. */
describe('item motion clips', () => {
  it('draws the Beam Sword and Star Rod swings with the clips of the same native files', () => {
    for (const n of ['1', '3', 'dash']) {
      expect(itemMotionClip(`item_sword_swing_${n}`)).toBe(`item_bat_swing_${n}`);
      expect(itemMotionClip(`item_starrod_swing_${n}`)).toBe(`item_bat_swing_${n}`);
    }
    expect(itemMotionClip('item_sword_swing_4')).toBe('item_sword_swing_4');
    expect(itemMotionClip('item_starrod_swing_4')).toBe('item_sword_swing_4');
    expect(itemMotionClip('item_bat_swing_4')).toBe('item_bat_swing_4');
  });
  it('resolves the charge loop of a smash swing', () => {
    expect(itemChargeClip('item_sword_swing_4')).toBe('item_sword_swing_4_hold');
    expect(itemChargeClip('item_starrod_swing_4')).toBe('item_sword_swing_4_hold');
  });
});
