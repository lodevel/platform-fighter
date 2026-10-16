import { describe, expect, it } from 'vitest';
import { parseLinkCaptureActionEquipmentInput, selectLinkCaptureActionEquipment } from './linkCaptureActionEquipment';
const entry = { sword: 'normal', shield: 'normal', bow: 'back', heldItemVisible: true, ancientBowVisible: false } as const;
describe('captured pummel/throw gear callbacks (prepared, unrun)', () => {
  it('honors each independent restore boundary without Sword or Bow stow', () => {
    for (const [motion, restore] of [['throw_f', 33], ['throw_b', 35], ['throw_hi', 58], ['throw_lw', 57]] as const) {
      const select = (scriptNativeFrame: number) => selectLinkCaptureActionEquipment({ motion, scriptNativeFrame, equipmentAtEntry: entry });
      expect(select(0).equipment).toEqual({ ...entry, shield: 'back' });
      expect(select(restore - .001).equipment.shield).toBe('back');
      expect(select(restore).equipment).toEqual(entry);
      expect(select(restore).scriptNativeFramesApplied).toEqual([0, restore]);
    }
  });
  it('keeps independent dash/pivot delayed back callbacks distinct from standing entry', () => {
    for (const [motion, back, restore] of [['catch', 0, 40], ['catch_dash', 2, 42], ['catch_turn', 3, 40], ['catch_cut', 0, 27]] as const) {
      const select = (scriptNativeFrame: number) => selectLinkCaptureActionEquipment({ motion, scriptNativeFrame, equipmentAtEntry: entry });
      if (back > 0) expect(select(back - .001).equipment).toEqual(entry);
      expect(select(back).equipment.shield).toBe('back');
      expect(select(restore - .001).equipment.shield).toBe('back');
      expect(select(restore).equipment).toEqual(entry);
    }
  });
  it('actual pull/wait independently own captured BACK without a synthetic pummel restore', () => {
    for (const motion of ['catch_pull', 'catch_wait'] as const) {
      expect(selectLinkCaptureActionEquipment({ motion, scriptNativeFrame: 0, equipmentAtEntry: entry }).equipment.shield).toBe('back');
    }
  });
  it('does not fabricate a pummel restore from gameplay cancel7 or native extent25', () => {
    for (const scriptNativeFrame of [0, 7, 24, 25]) {
      const selected = selectLinkCaptureActionEquipment({ motion: 'catch_attack', scriptNativeFrame, equipmentAtEntry: entry });
      expect(selected.equipment).toEqual({ ...entry, shield: 'back' });
      expect(selected.scriptNativeFramesApplied).toEqual([0]);
    }
  });
  it('rejects recipient motion aliases, stale owner extras and nonfinite clocks', () => {
    for (const value of [
      { motion: 'thrown_f', scriptNativeFrame: 0, equipmentAtEntry: entry },
      { motion: 'throw_f', scriptNativeFrame: NaN, equipmentAtEntry: entry },
      { motion: 'throw_f', scriptNativeFrame: 0, equipmentAtEntry: entry, captureId: 'invented' },
    ]) expect(() => parseLinkCaptureActionEquipmentInput(value)).toThrow();
  });
});
