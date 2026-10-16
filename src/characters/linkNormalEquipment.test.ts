import { describe, expect, it } from 'vitest';
import { parseLinkNormalEquipmentInput, selectLinkNormalEquipment, selectLinkNormalMotionGearOverride } from './linkNormalEquipment';
const baseline = { sword: 'normal', shield: 'normal', bow: 'back', heldItemVisible: true, ancientBowVisible: false } as const;
const at = (id: Parameters<typeof selectLinkNormalEquipment>[0]['id'], scriptNativeFrame: number) =>
  selectLinkNormalEquipment({ id, scriptNativeFrame, equipmentAtEntry: baseline });
describe('normal expression facts on SCRIPT clock (prepared, not executed)', () => {
  it('keeps Fsmash3/11/39 callbacks distinct from body offsets and guarded repeat10', () => {
    expect(at('link.smash', 2.999).equipment.shield).toBe('normal');
    expect(at('link.smash', 3).equipment.shield).toBe('back');
    expect(at('link.smash', 10).guardedCallbacksNotApplied).toEqual([{ sourceLine: 85, scriptNativeFrame: 10,
      guard: 'FIGHTER_STATUS_ATTACK_FLAG_SMASH_SMASH_HOLD_TO_ATTACK' }]);
    expect(at('link.smash', 10).scriptNativeFramesApplied).toEqual([0, 3]);
    expect(at('link.smash', 38.999).equipment.shield).toBe('back');
    expect(at('link.smash', 39).equipment).toEqual({ ...baseline, heldItemVisible: false });
  });
  it('retains exact second smash and airborne restore boundaries with no Sword stow', () => {
    for (const [id, start, end] of [['link.smash2', 0, 47], ['link.uair', 2, 48], ['link.dair', 3, 78]] as const) {
      expect(at(id, start).equipment).toMatchObject({ sword: 'normal', shield: 'back' });
      expect(at(id, end - .001).equipment.shield).toBe('back');
      expect(at(id, end).equipment.shield).toBe('normal');
    }
    expect(at('link.dair', 2.999).equipment.heldItemVisible).toBe(true);
    expect(at('link.dair', 3).equipment.heldItemVisible).toBe(false);
    expect(at('link.dair', 78).equipment.heldItemVisible).toBe(true);
  });
  it('applies actual Fsmash charge callbacks, while commandless holds preserve CURRENT baseline', () => {
    expect(at('link.smash_hold', 0).equipment).toEqual({ ...baseline, shield: 'back', heldItemVisible: false });
    for (const id of ['link.usmash_hold', 'link.dsmash_hold', 'link.nair', 'link.fair'] as const) {
      expect(at(id, 900).equipment).toEqual(baseline);
      expect(at(id, 900).hasCapturedGearCommands).toBe(false);
    }
    expect(at('link.jab', 0).equipment).toEqual({ ...baseline, heldItemVisible: false });
    expect(Object.keys(at('link.smash', 100))).not.toContain('controls');
  });
  it('keeps Bair source-guided BACK placement separate from empty captured expression events', () => {
    const bair = at('link.bair', 0);
    expect(bair.equipment).toEqual(baseline);
    expect(bair.hasCapturedGearCommands).toBe(false);
    expect(bair.scriptNativeFramesApplied).toEqual([]);
    const override = selectLinkNormalMotionGearOverride({ id: 'link.bair', unheld: true });
    expect(override?.gearOwner.policyId).toBe('SOURCE_GUIDED_BAIR_EXCLUSIVE_BACK_SHIELD');
    expect({ ...at('link.bair', 49).equipment, ...override?.changes }.shield).toBe('back');
    expect(selectLinkNormalMotionGearOverride({ id: 'link.bair', unheld: false })).toBeNull();
    // A true independent next owner supplies CURRENT baseline again, rather
    // than snapshotting the old Bair tail into its own source lease.
    expect(at('link.fair', 0).equipment.shield).toBe('normal');
    expect(selectLinkNormalMotionGearOverride({ id: 'link.nair', unheld: true })).toBeNull();
  });
  it('rejects renderer motion names, negative clocks and extra guessed flag fields', () => {
    for (const value of [{ id: 'attack_s4_s', scriptNativeFrame: 0, equipmentAtEntry: baseline },
      { id: 'link.smash', scriptNativeFrame: -1, equipmentAtEntry: baseline },
      { id: 'link.smash', scriptNativeFrame: 10, equipmentAtEntry: baseline, holdToAttack: true }])
      expect(() => parseLinkNormalEquipmentInput(value)).toThrow();
  });
});
