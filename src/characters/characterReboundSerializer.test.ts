import { describe, expect, it } from 'vitest';
import { CharacterEditState } from '../characterBuilder/characterEditState';
import { buildCharacterEditorFields, stepCharacterEditorField } from '../characterBuilder/characterEditorFields';
import { type AerialMove, validateAerialMove } from './aerialSchema';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import { LINK_DAIR, LINK_NAIR } from './Link';
import { LEGACY_NAIR } from './legacyMoveFixtures';

const linkFile = () => serializeCharacterDataSpec(getAuthorableCharacterSpec('link'));

describe('aerial rebound authoring', () => {
  it('round-trips tuned rebound speed, return delay, and return strike without changing initial windows', () => {
    const dair = { ...LINK_DAIR, rebound: { ...LINK_DAIR.rebound!, upwardSpeed: 8.5,
      rehitFrames: 22, disableOnFastFall: false,
      returnHit: { ...LINK_DAIR.rebound!.returnHit!, damage: 12.5,
        knockback: { x: 1.1, y: -3.2, scaling: 0.25, baseMagnitude: 1.2, damageGrowth: 0.6 } },
    } };
    const spec = parseCharacterDataFile({ ...linkFile(), moves: { dair } });
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));
    expect(loaded.moves?.dair).toEqual(dair);
    expect(validateAerialMove(dair)).toBe(dair);
  });

  it('preserves omission of the optional fast-fall guard and return strike', () => {
    const rebound = { upwardSpeed: 8.5, rehitFrames: 22 };
    const spec = parseCharacterDataFile({ ...linkFile(), moves: { dair: { ...LINK_DAIR, rebound } } });
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));
    expect(loaded.moves?.dair?.rebound).toEqual(rebound);
    expect(Object.hasOwn(loaded.moves!.dair!.rebound!, 'disableOnFastFall')).toBe(false);
    expect(Object.hasOwn(loaded.moves!.dair!.rebound!, 'returnHit')).toBe(false);
  });

  it('keeps rebound absent on ordinary authored and legacy aerials', () => {
    const original = { ...linkFile(), moves: { dair: { ...LINK_DAIR, rebound: undefined }, nair: LINK_NAIR } };
    const spec = parseCharacterDataFile(original);
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));
    expect(Object.hasOwn(loaded.moves!.dair!, 'rebound')).toBe(false);
    expect(Object.hasOwn(loaded.moves!.nair!, 'rebound')).toBe(false);
    const legacy = parseCharacterDataFile({ ...linkFile(), moves: { nair: LEGACY_NAIR } });
    expect(legacy.moves?.nair).toEqual(LEGACY_NAIR);
    expect(Object.hasOwn(legacy.moves!.nair!, 'rebound')).toBe(false);
  });

  it.each(['upwardSpeed', 'rehitFrames'] as const)('rejects invalid %s in imported and compiled moves', key => {
    const invalid = [-1, 0, null, Infinity, NaN, '3', undefined];
    if (key === 'rehitFrames') invalid.push(1.5);
    for (const value of invalid) {
      const dair = { ...LINK_DAIR, rebound: { upwardSpeed: 10, rehitFrames: 30, [key]: value } };
      expect(() => parseCharacterDataFile({ ...linkFile(), moves: { dair } })).toThrow(`rebound.${key}`);
      expect(() => validateAerialMove(dair as unknown as AerialMove)).toThrow(`rebound.${key}`);
    }
  });

  it('rejects malformed rebound blocks and metadata added to incomplete legacy aerials', () => {
    for (const rebound of [null, [], 'bounce', {}, { upwardSpeed: 10 }, { rehitFrames: 30 }]) {
      const dair = { ...LINK_DAIR, rebound };
      expect(() => parseCharacterDataFile({ ...linkFile(), moves: { dair } })).toThrow(/rebound/);
      expect(() => validateAerialMove(dair as unknown as AerialMove)).toThrow(/rebound/);
    }
    expect(() => parseCharacterDataFile({ ...linkFile(), moves: {
      nair: { ...LEGACY_NAIR, rebound: { upwardSpeed: 10, rehitFrames: 30 } },
    } })).toThrow();
  });

  it('requires an explicit boolean when the fast-fall guard is authored', () => {
    for (const disableOnFastFall of [null, 'true', 0, 1, {}]) {
      const dair = { ...LINK_DAIR, rebound: { ...LINK_DAIR.rebound!, disableOnFastFall } };
      expect(() => parseCharacterDataFile({ ...linkFile(), moves: { dair } })).toThrow('disableOnFastFall');
      expect(() => validateAerialMove(dair as unknown as AerialMove)).toThrow('disableOnFastFall');
    }
  });

  it('rejects invalid return damage, launch values, and hitbox geometry', () => {
    const hit = LINK_DAIR.rebound!.returnHit!;
    for (const returnHit of [null, [], 'hit', {},
      { ...hit, damage: -1 }, { ...hit, damage: Infinity },
      { ...hit, knockback: null }, { ...hit, knockback: { ...hit.knockback, y: NaN } },
      { ...hit, knockback: { ...hit.knockback, baseMagnitude: -1 } },
      { ...hit, knockback: { ...hit.knockback, damageGrowth: -1 } },
      { ...hit, hitbox: null }, { ...hit, hitbox: { ...hit.hitbox, width: 0 } },
      { ...hit, hitbox: { ...hit.hitbox, offsetY: Infinity } },
    ]) {
      const dair = { ...LINK_DAIR, rebound: { ...LINK_DAIR.rebound!, returnHit } };
      expect(() => parseCharacterDataFile({ ...linkFile(), moves: { dair } })).toThrow('returnHit');
      expect(() => validateAerialMove(dair as unknown as AerialMove)).toThrow('returnHit');
    }
  });

  it('exposes positive Lab controls and retains independent edits after reload', () => {
    const state = new CharacterEditState(getAuthorableCharacterSpec('link'));
    const fields = buildCharacterEditorFields(state.getSpec(), 'move', 'dair');
    const speed = fields.find(field => field.id === 'rebound.upwardSpeed')!;
    const interval = fields.find(field => field.id === 'rebound.rehitFrames')!;
    const damage = fields.find(field => field.id === 'rebound.returnHit.damage')!;
    expect(speed).toMatchObject({ value: 6.65, step: 0.25, min: 0.25, integer: false });
    expect(interval).toMatchObject({ value: 30, step: 1, min: 1, integer: true });
    expect(damage).toMatchObject({ value: 11, step: 0.5, min: 0, integer: false });
    expect(stepCharacterEditorField({ ...speed, value: speed.min }, -1)).toBeGreaterThan(0);
    expect(stepCharacterEditorField({ ...interval, value: interval.min }, -1)).toBe(1);
    state.setMoveNumericField('dair', speed.path, 8.5);
    state.setMoveNumericField('dair', interval.path, 22);
    state.setMoveNumericField('dair', damage.path, 9.5);
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(state.getSpec()))));
    expect(loaded.moves?.dair?.rebound).toEqual({ ...LINK_DAIR.rebound!, upwardSpeed: 8.5, rehitFrames: 22,
      returnHit: { ...LINK_DAIR.rebound!.returnHit!, damage: 9.5 } });
    expect(loaded.moves?.dair?.hitWindows).toEqual(LINK_DAIR.hitWindows);
    expect(getAuthorableCharacterSpec('link').moves?.dair?.rebound?.rehitFrames).toBe(30);
  });
});
