import { describe, expect, it } from 'vitest';
import { CharacterEditState } from '../characterBuilder/characterEditState';
import { buildCharacterEditorFields } from '../characterBuilder/characterEditorFields';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import { LINK_UP_SPECIAL } from './Link';
import {
  DONKEYKONG_DOWN_SPECIAL, DONKEYKONG_NEUTRAL_SPECIAL, DONKEYKONG_SIDE_SPECIAL, DONKEYKONG_UP_SPECIAL,
} from './DonkeyKong';
import { LINK_MOVEMENT_PROFILE } from './fighterMovementProfiles';
import { validateNeutralSpecialMove } from './specialSchema';
import { validateSideSpecialMove } from './sideSpecialSchema';
import { validateUpSpecialMove } from './upSpecialSchema';
import { validateDownSpecialMove } from './downSpecialSchema';

const dkFile = () => serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong'));
// DK's Spinning Kong authors its native landing lag; the fixture omits it so
// every slot starts from an absent field.
const { specialLandingLagFrames: _dkUpSpecialLanding, ...DK_UP_SPECIAL_WITHOUT_LANDING } = DONKEYKONG_UP_SPECIAL;
const specialFixtures = [
  { slot: 'neutralSpecial', move: DONKEYKONG_NEUTRAL_SPECIAL },
  { slot: 'sideSpecial', move: DONKEYKONG_SIDE_SPECIAL },
  { slot: 'upSpecial', move: DK_UP_SPECIAL_WITHOUT_LANDING },
  { slot: 'downSpecial', move: DONKEYKONG_DOWN_SPECIAL },
] as const;
const dodgeKeys = ['airDodgeLandingFrames', 'directionalAirDodgeLandingFrames'] as const;

describe('special landing authoring', () => {
  it.each(specialFixtures)('round-trips tunable landing timing for $slot, including zero', ({ slot, move }) => {
    for (const frames of [0, 17]) {
      const spec = parseCharacterDataFile({ ...dkFile(),
        moves: { [slot]: { ...move, specialLandingLagFrames: frames } } });
      const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));
      expect(loaded.moves?.[slot]).toEqual({ ...move, specialLandingLagFrames: frames });
    }
  });

  it.each(specialFixtures)('keeps omitted landing timing absent for $slot', ({ slot, move }) => {
    const spec = parseCharacterDataFile({ ...dkFile(), moves: { [slot]: move } });
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));
    expect(Object.hasOwn(loaded.moves![slot]!, 'specialLandingLagFrames')).toBe(false);
  });

  it.each(specialFixtures)('rejects malformed landing timing for $slot', ({ slot, move }) => {
    for (const specialLandingLagFrames of [-1, 1.5, null, Infinity, NaN, '3']) {
      expect(() => parseCharacterDataFile({ ...dkFile(),
        moves: { [slot]: { ...move, specialLandingLagFrames } } })).toThrow('specialLandingLagFrames');
    }
  });

  it('validates compiled special records as well as imported JSON', () => {
    const validators = [
      (frames: number) => validateNeutralSpecialMove({ ...DONKEYKONG_NEUTRAL_SPECIAL, specialLandingLagFrames: frames }),
      (frames: number) => validateSideSpecialMove({ ...DONKEYKONG_SIDE_SPECIAL, specialLandingLagFrames: frames }),
      (frames: number) => validateUpSpecialMove({ ...DONKEYKONG_UP_SPECIAL, specialLandingLagFrames: frames }),
      (frames: number) => validateDownSpecialMove({ ...DONKEYKONG_DOWN_SPECIAL, specialLandingLagFrames: frames }),
    ];
    for (const validate of validators) {
      for (const frames of [0, 17]) expect(validate(frames).specialLandingLagFrames).toBe(frames);
      for (const frames of [-1, 1.5, Infinity, NaN]) {
        expect(() => validate(frames)).toThrow('specialLandingLagFrames');
      }
    }
  });

  it('authors Link aerial Spin landing lag through save/load (his grounded Spin is source-driven, no authored variant)', () => {
    const link = getAuthorableCharacterSpec('link');
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(link))));
    expect(loaded.moves?.upSpecial).toEqual(LINK_UP_SPECIAL);
    expect(loaded.moves?.upSpecial?.specialLandingLagFrames).toBe(30);
    expect(LINK_UP_SPECIAL.groundedVariant).toBeUndefined();
  });

  it('also validates landing timing on explicitly authored grounded special variants', () => {
    const upSpecial = { ...DONKEYKONG_UP_SPECIAL,
      groundedVariant: { ...DONKEYKONG_UP_SPECIAL.groundedVariant!, specialLandingLagFrames: -1 } };
    expect(() => validateUpSpecialMove(upSpecial)).toThrow('specialLandingLagFrames');
    expect(() => parseCharacterDataFile({ ...dkFile(), moves: { upSpecial } })).toThrow('specialLandingLagFrames');
  });
});

describe('air-dodge landing authoring', () => {
  it.each(dodgeKeys)('round-trips edited %s including an explicit zero', key => {
    const original = dkFile();
    for (const frames of [0, 7]) {
      const spec = parseCharacterDataFile({ ...original, movement: { ...original.movement, [key]: frames } });
      const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));
      expect(loaded.movement[key]).toBe(frames);
    }
  });

  it.each(dodgeKeys)('rejects non-integral or malformed %s', key => {
    const original = dkFile();
    for (const value of [-1, 1.5, null, Infinity, NaN, '3']) {
      expect(() => parseCharacterDataFile({ ...original,
        movement: { ...original.movement, [key]: value } })).toThrow(key);
    }
  });

  it('defaults omitted Link dodge landing timing from its movement profile', () => {
    const original = serializeCharacterDataSpec(getAuthorableCharacterSpec('link'));
    const movement: Record<string, unknown> = { ...original.movement };
    for (const key of dodgeKeys) delete movement[key];
    expect(parseCharacterDataFile({ ...original, movement }).movement).toMatchObject({
      airDodgeLandingFrames: LINK_MOVEMENT_PROFILE.airDodgeLandingFrames,
      directionalAirDodgeLandingFrames: LINK_MOVEMENT_PROFILE.directionalAirDodgeLandingFrames,
    });
  });
});

describe('landing tuning in Character Lab', () => {
  it('exposes frame controls and retains user edits after save/reload', () => {
    const state = new CharacterEditState(getAuthorableCharacterSpec('link'));
    const specialFields = buildCharacterEditorFields(state.getSpec(), 'move', 'upSpecial');
    expect(specialFields.find(field => field.id === 'specialLandingLagFrames')).toMatchObject({
      value: 30, step: 1, min: 0, integer: true,
    });
    expect(specialFields.some(field => field.id === 'groundedVariant.specialLandingLagFrames')).toBe(false);
    const movementFields = buildCharacterEditorFields(state.getSpec(), 'movement');
    for (const key of dodgeKeys) {
      expect(movementFields.find(field => field.id === `movement.${key}`)).toMatchObject({
        step: 1, min: 0, integer: true,
      });
    }
    state.setMoveNumericField('upSpecial', ['specialLandingLagFrames'], 23);
    state.setMovementField('airDodgeLandingFrames', 6);
    state.setMovementField('directionalAirDodgeLandingFrames', 12);
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(state.getSpec()))));
    expect(loaded.moves?.upSpecial?.specialLandingLagFrames).toBe(23);
    expect(loaded.movement).toMatchObject({ airDodgeLandingFrames: 6, directionalAirDodgeLandingFrames: 12 });
    expect(getAuthorableCharacterSpec('link').moves?.upSpecial?.specialLandingLagFrames).toBe(30);
  });
});
