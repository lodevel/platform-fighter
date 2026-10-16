import { describe, expect, it } from 'vitest';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import { LINK_DAIR, LINK_FAIR, LINK_SMASH, LINK_SMASH2, LINK_USMASH } from './Link';

const baseline = () => serializeCharacterDataSpec(getAuthorableCharacterSpec('link'));
const swing = () => ({
  ...LINK_SMASH,
  startupFrames: 4, activeFrames: 10, recoveryFrames: 6, chargeStartFrame: 2,
  followUp: { nextId: 'link.smash2', windowStart: 14, windowEnd: 20 },
  hitWindows: [
    { startFrame: 4, endFrame: 6, group: 'first', damage: 4,
      minHitstunFrames: 8, airborneVelocityCarry: true,
      groundedKnockback: { x: 1, y: -2, scaling: 0.03 },
      knockback: { x: 1, y: 2, scaling: 0.03 },
      hitbox: { offsetX: 20, offsetY: -2, width: 30, height: 10 },
      sweetSpot: { hitbox: { offsetX: 30, offsetY: -2, width: 10, height: 10 },
        damageMultiplier: 1.3, knockbackMultiplier: 1.1 } },
    { startFrame: 12, endFrame: 14, group: 'finish', damage: 10, facing: -1 },
  ],
});
const parseSwing = (overrides: Record<string, unknown>) => parseCharacterDataFile({
  ...baseline(), moves: { smash: { ...swing(), ...overrides }, smash2: LINK_SMASH2 },
});

describe('saved strike windows and follow-up moves', () => {
  it('retains gap timing, shared identity, reverse facing, per-strike geometry, ground launch and charge timing through JSON', () => {
    const move = swing();
    const spec = parseSwing({});
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));
    expect(loaded.moves?.smash).toEqual(move);
    expect(loaded.moves?.smash2).toEqual(LINK_SMASH2);
  });

  it('retains the actual compiled Link three-hit smash, aerial ground launch and second forward smash', () => {
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(baseline())));
    expect(loaded.moves?.upSmash).toEqual(LINK_USMASH);
    expect(loaded.moves?.dair).toEqual(LINK_DAIR);
    expect(loaded.moves?.fair).toEqual(LINK_FAIR);
    expect(loaded.moves?.smash2).toEqual(LINK_SMASH2);
    expect(loaded.moves?.smash?.followUp).toEqual(LINK_SMASH.followUp);
  });

  it('allows adjacent early/late windows in the same hit group without merging their authored values', () => {
    const hitWindows = [
      { startFrame: 4, endFrame: 6, group: 'one-hit', damage: 11 },
      { startFrame: 6, endFrame: 14, group: 'one-hit', damage: 6 },
    ];
    expect(parseSwing({ hitWindows }).moves?.smash?.hitWindows).toEqual(hitWindows);
  });

  it('does not synthesize new fields in a legacy continuous attack', () => {
    const { hitWindows: _windows, followUp: _follow, chargeStartFrame: _charge, ...legacy } = swing();
    const loaded = parseCharacterDataFile({ ...baseline(), moves: { smash: legacy } });
    for (const key of ['hitWindows', 'followUp', 'chargeStartFrame', 'groundedKnockback']) {
      expect(Object.hasOwn(loaded.moves!.smash!, key)).toBe(false);
    }
  });

  it.each([
    null, [], {}, [null],
    [{ startFrame: 3, endFrame: 5 }],
    [{ startFrame: 4, endFrame: 15 }],
    [{ startFrame: 4, endFrame: 4 }],
    [{ startFrame: 4.5, endFrame: 6 }],
    [{ startFrame: 4, endFrame: Infinity }],
    [{ startFrame: 9, endFrame: 11 }, { startFrame: 4, endFrame: 6 }],
    [{ startFrame: 4, endFrame: 7 }, { startFrame: 6, endFrame: 10 }],
  ])('rejects windows outside the ordered discrete active timeline: %j', hitWindows => {
    expect(() => parseSwing({ hitWindows })).toThrow(/hitWindows/);
  });

  it.each([
    { facing: 0 }, { facing: '1' }, { damage: -1 }, { damage: NaN }, { group: 5 },
    { hitbox: { offsetX: 0, offsetY: 0, width: 0, height: 10 } },
    { knockback: { x: 0, y: Infinity, scaling: 0.1 } },
    { groundedKnockback: { x: 0, y: NaN, scaling: 0.1 } },
    { sweetSpot: { hitbox: LINK_SMASH.hitbox, damageMultiplier: -1 } },
    { minHitstunFrames: -1 }, { minHitstunFrames: 1.5 }, { minHitstunFrames: 121 },
    { minHitstunFrames: Infinity }, { airborneVelocityCarry: 'yes' },
  ])('rejects invalid per-strike combat metadata: %j', invalid => {
    expect(() => parseSwing({ hitWindows: [{ startFrame: 4, endFrame: 6, ...invalid }] })).toThrow(/hitWindows/);
  });

  it.each([
    null, {}, { nextId: 7, windowStart: 14, windowEnd: 20 },
    { nextId: 'link.smash2', windowStart: -1, windowEnd: 20 },
    { nextId: 'link.smash2', windowStart: 14.5, windowEnd: 20 },
    { nextId: 'link.smash2', windowStart: 14, windowEnd: 14 },
    { nextId: 'link.smash2', windowStart: 14, windowEnd: 21 },
  ])('rejects an invalid follow-up input window: %j', followUp => {
    expect(() => parseSwing({ followUp })).toThrow(/followUp/);
  });

  it.each([-1, 0.5, 4, 5, Infinity, '2'])('rejects invalid charge hold frame %j', chargeStartFrame => {
    expect(() => parseSwing({ chargeStartFrame })).toThrow(/chargeStartFrame/);
  });

  it('requires an actual charge definition for a charge hold frame', () => {
    expect(() => parseSwing({ charge: undefined })).toThrow(/chargeStartFrame/);
  });
});
