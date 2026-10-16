import { describe, expect, it } from 'vitest';
import { parseLinkLandingEquipmentInput, selectLinkLandingEquipment } from './linkLandingEquipment';

const entry = { sword: 'normal', shield: 'normal', bow: 'hidden', heldItemVisible: true, ancientBowVisible: false } as const;
describe('captured Link landing expression boundaries (prepared, unrun)', () => {
  it('keeps Uair landing back through21, exposes the retained item at22, restores shield at28', () => {
    const select = (scriptNativeFrame: number) => selectLinkLandingEquipment({ motion: 'landing_air_hi', scriptNativeFrame, equipmentAtEntry: entry });
    expect(select(0).equipment).toEqual({ ...entry, shield: 'back', heldItemVisible: false });
    expect(select(21.999).equipment.heldItemVisible).toBe(false);
    expect(select(22).equipment).toEqual({ ...entry, shield: 'back' });
    expect(select(27.999).equipment.shield).toBe('back');
    expect(select(28).equipment).toEqual(entry);
    expect(select(28).source.function).toBe('expression_landingairhi');
  });
  it('restores Dair landing gear only at captured65', () => {
    const select = (scriptNativeFrame: number) => selectLinkLandingEquipment({ motion: 'landing_air_lw', scriptNativeFrame, equipmentAtEntry: entry });
    expect(select(64.999).equipment).toEqual({ ...entry, shield: 'back', heldItemVisible: false });
    expect(select(65).equipment).toEqual(entry);
  });
  it('preserves a genuinely reconciled N/F/B entry rather than inventing a normal callback', () => {
    for (const motion of ['landing_air_n', 'landing_air_f', 'landing_air_b'] as const) {
      const baseline = { ...entry, shield: 'back' as const, bow: 'back' as const };
      const result = selectLinkLandingEquipment({ motion, scriptNativeFrame: 30, equipmentAtEntry: baseline });
      expect(result.equipment).toEqual(baseline);
      expect(result.delta).toEqual({});
      expect(result.hasCapturedGearCommands).toBe(false);
    }
  });
  it('rejects unknown motion, fake age and extra owner fields at the pure boundary', () => {
    for (const value of [
      { motion: 'landing_air_x', scriptNativeFrame: 0, equipmentAtEntry: entry },
      { motion: 'landing_air_hi', scriptNativeFrame: -1, equipmentAtEntry: entry },
      { motion: 'landing_air_hi', scriptNativeFrame: Infinity, equipmentAtEntry: entry },
      { motion: 'landing_air_hi', scriptNativeFrame: 0, equipmentAtEntry: entry, nativeRateRecovered: true },
    ]) expect(() => parseLinkLandingEquipmentInput(value)).toThrow();
  });
});
