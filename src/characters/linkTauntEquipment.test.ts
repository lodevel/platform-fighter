import { describe, expect, it } from 'vitest';
import { selectLinkTauntEquipment, parseLinkTauntEquipmentInput } from './linkTauntEquipment';
const entry = { sword: 'normal', shield: 'normal', bow: 'back', heldItemVisible: true, ancientBowVisible: false } as const;
describe('Link exact taunt expression equipment (prepared, unrun)', () => {
  it('restores side Shield at71 but retains the actual source-hidden item until owner exit', () => {
    for (const motion of ['appeal_s_l', 'appeal_s_r'] as const) {
      const select = (scriptNativeFrame: number) => selectLinkTauntEquipment({ motion, scriptNativeFrame, equipmentAtEntry: entry });
      expect(select(0).equipment).toEqual({ ...entry, shield: 'back', heldItemVisible: false });
      expect(select(70.999).equipment.shield).toBe('back');
      expect(select(71).equipment).toEqual({ ...entry, heldItemVisible: false });
      expect(select(140).equipment.heldItemVisible).toBe(false);
    }
  });
  it('empty up/down expressions preserve actual current-inventory entry without inferred stow', () => {
    for (const motion of ['appeal_hi_l', 'appeal_hi_r', 'appeal_lw_l', 'appeal_lw_r'] as const) {
      const result = selectLinkTauntEquipment({ motion, scriptNativeFrame: 0, equipmentAtEntry: entry });
      expect(result.equipment).toEqual(entry);
      expect(result.delta).toEqual({});
      expect(result.hasCapturedGearCommands).toBe(false);
    }
  });
  it('rejects renderer-derived alias, nonfinite clock and fake owner fields', () => {
    for (const value of [
      { motion: 'j01appealsr', scriptNativeFrame: 0, equipmentAtEntry: entry },
      { motion: 'appeal_s_r', scriptNativeFrame: Infinity, equipmentAtEntry: entry },
      { motion: 'appeal_s_r', scriptNativeFrame: 0, equipmentAtEntry: entry, nativeCallerRecovered: true },
    ]) expect(() => parseLinkTauntEquipmentInput(value)).toThrow();
  });
});
