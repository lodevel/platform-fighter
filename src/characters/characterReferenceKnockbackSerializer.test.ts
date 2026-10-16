import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { CharacterEditState } from '../characterBuilder/characterEditState';
import { buildCharacterEditorFields, stepCharacterEditorField } from '../characterBuilder/characterEditorFields';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { applyCharacterMoveOverrides, createCharacterById } from './characterFactory';
import {
  parseCharacterDataFile, serializeCharacterDataSpec, type CharacterDataSpec,
} from './characterSerializer';
import { FIGHTER_MOVEMENT_PROFILES } from './fighterMovementProfiles';
import { LINK_DAIR, LINK_SMASH, LINK_TILT, LINK_UAIR } from './Link';
import { DONKEYKONG_NEUTRAL_SPECIAL } from './DonkeyKong';
import { CHARGED_BOW_NEUTRAL_SPECIAL } from './chargedBowFixture';

const require = createRequire(import.meta.url);
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const linkFile = () => serializeCharacterDataSpec(getAuthorableCharacterSpec('link'));
const legacyKnockback = { x: 2.2, y: -0.6, scaling: 0.13, baseMagnitude: 1.3, damageGrowth: 0.5 };
const reference = { base: 30, growth: 100, angle: 361 };
const referenceKnockback = { ...legacyKnockback, reference };
const legacyChargeSmash = () => {
  const { knockbackMode: _omitted, ...charge } = LINK_SMASH.charge!;
  return { ...LINK_SMASH, knockback: legacyKnockback, charge,
    sweetSpot: { ...LINK_SMASH.sweetSpot!, knockback: legacyKnockback } };
};
const withReference = (value: unknown) => ({ ...linkFile(), moves: {
  tilt: { ...LINK_TILT, knockback: { ...legacyKnockback, reference: value } },
} });
const reload = (spec: CharacterDataSpec) =>
  parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));

function factoryScene(): any {
  return { matter: {
    body: Body,
    add: { rectangle: Bodies.rectangle },
    world: { on() {}, off() {}, remove() {} },
  } };
}

describe('reference knockback authoring', () => {
  it('preserves the separate full-charge punch launch through save/load and fighter construction', () => {
    const spec = reload(getAuthorableCharacterSpec('donkeykong'));
    expect(spec.moves?.neutralSpecial).toEqual(DONKEYKONG_NEUTRAL_SPECIAL);
    const fighter = createCharacterById(factoryScene(), 'donkeykong', { spawnX: 0, spawnY: 0 });
    applyCharacterMoveOverrides(fighter, spec);
    expect(fighter.getAttack('donkeykong.neutral_special')).toEqual(DONKEYKONG_NEUTRAL_SPECIAL);
    fighter.destroy();
  });
  it.each([0, 85.5, 360, 361, 367])('round-trips angle %s and explicit zero base/growth', angle => {
    const authored = { base: 0, growth: 0, angle };
    const spec = reload(parseCharacterDataFile(withReference(authored)));
    expect(spec.moves?.tilt?.knockback).toEqual({ ...legacyKnockback, reference: authored });
  });

  it('retains reference data in victim variants, hit windows and returning hitboxes', () => {
    const moves = {
      tilt: { ...LINK_TILT, knockback: referenceKnockback, groundedKnockback: referenceKnockback,
        hitWindows: [{ startFrame: LINK_TILT.startupFrames,
          endFrame: LINK_TILT.startupFrames + LINK_TILT.activeFrames,
          knockback: referenceKnockback, groundedKnockback: referenceKnockback }] },
      dair: { ...LINK_DAIR, rebound: { ...LINK_DAIR.rebound!,
        returnHit: { ...LINK_DAIR.rebound!.returnHit!, knockback: referenceKnockback } } },
    };
    const saved = reload(parseCharacterDataFile({ ...linkFile(), moves }));
    expect(saved.moves).toEqual(moves);
  });

  it('keeps legacy knockback and source-facing omissions absent', () => {
    const tilt = { ...LINK_TILT, knockback: legacyKnockback };
    const spec = reload(parseCharacterDataFile({ ...linkFile(), moves: { tilt } }));
    expect(spec.moves?.tilt?.knockback).toEqual(legacyKnockback);
    expect(Object.hasOwn(spec.moves!.tilt!.knockback, 'reference')).toBe(false);
    expect(Object.hasOwn(spec.moves!.tilt!, 'launchAwayFromSource')).toBe(false);
  });

  it.each([
    { field: 'base', value: -1 }, { field: 'base', value: Infinity },
    { field: 'base', value: '30' }, { field: 'base', value: undefined },
    { field: 'growth', value: -1 }, { field: 'growth', value: NaN },
    { field: 'growth', value: null }, { field: 'growth', value: undefined },
    { field: 'angle', value: -1 }, { field: 'angle', value: 360.5 },
    { field: 'angle', value: 362 }, { field: 'angle', value: Infinity },
    { field: 'angle', value: '361' }, { field: 'angle', value: undefined },
  ])('rejects invalid reference $field=$value with a field path', ({ field, value }) => {
    expect(() => parseCharacterDataFile(withReference({ ...reference, [field]: value })))
      .toThrow(`moves.tilt.knockback.reference.${field}`);
  });

  it.each([null, [], 'reference', 30, true])('rejects non-object reference %j', value => {
    expect(() => parseCharacterDataFile(withReference(value)))
      .toThrow('moves.tilt.knockback.reference must be an object');
  });

  it.each([true, false])('round-trips explicit launchAwayFromSource=%s', launchAwayFromSource => {
    const uair = { ...LINK_UAIR, launchAwayFromSource };
    const spec = reload(parseCharacterDataFile({ ...linkFile(), moves: { uair } }));
    expect(spec.moves?.uair?.launchAwayFromSource).toBe(launchAwayFromSource);
  });

  it.each([null, 0, 1, 'true', {}, []])('rejects malformed launchAwayFromSource=%j', value => {
    expect(() => parseCharacterDataFile({ ...linkFile(), moves: {
      uair: { ...LINK_UAIR, launchAwayFromSource: value },
    } })).toThrow('moves.uair.launchAwayFromSource must be a boolean');
  });

  it.each(['knockback', 'groundedKnockback'] as const)
    ('rejects reference %s on a chargeable move or one of its hit windows', key => {
      const smash = { ...legacyChargeSmash(), [key]: referenceKnockback };
      expect(() => parseCharacterDataFile({ ...linkFile(), moves: { smash } }))
        .toThrow(`moves.smash.${key}.reference is not supported for charged attacks`);
      const windowed = { ...legacyChargeSmash(), hitWindows: [{ startFrame: LINK_SMASH.startupFrames,
        endFrame: LINK_SMASH.startupFrames + LINK_SMASH.activeFrames, [key]: referenceKnockback }] };
      expect(() => parseCharacterDataFile({ ...linkFile(), moves: { smash: windowed } }))
        .toThrow(`moves.smash.hitWindows[0].${key}.reference is not supported for charged attacks`);
    });

  it.each(['minKnockback', 'maxKnockback'] as const)
    ('rejects reference %s on melee and projectile charge endpoints', key => {
      const smash = { ...LINK_SMASH, charge: { ...LINK_SMASH.charge!, [key]: referenceKnockback } };
      expect(() => parseCharacterDataFile({ ...linkFile(), moves: { smash } }))
        .toThrow(`moves.smash.charge.${key}.reference is not supported for charged attacks`);
      const neutralSpecial = { ...CHARGED_BOW_NEUTRAL_SPECIAL, chargedProjectile: {
        ...CHARGED_BOW_NEUTRAL_SPECIAL.chargedProjectile!, charge: {
          ...CHARGED_BOW_NEUTRAL_SPECIAL.chargedProjectile!.charge, [key]: referenceKnockback,
        },
      } };
      expect(() => parseCharacterDataFile({ ...linkFile(), moves: { neutralSpecial } }))
        .toThrow(`moves.neutralSpecial.chargedProjectile.charge.${key}.reference is not supported for charged attacks`);
    });

  it('requires explicit damage-only mode for a charged projectile reference launch', () => {
    const { knockbackMode: _omitted, ...charge } = CHARGED_BOW_NEUTRAL_SPECIAL.chargedProjectile!.charge;
    const neutralSpecial = { ...CHARGED_BOW_NEUTRAL_SPECIAL, knockback: referenceKnockback,
      chargedProjectile: { ...CHARGED_BOW_NEUTRAL_SPECIAL.chargedProjectile!, charge } };
    expect(() => parseCharacterDataFile({ ...linkFile(), moves: { neutralSpecial } }))
      .toThrow('moves.neutralSpecial.knockback.reference is not supported for charged attacks');
  });
});

describe('reference weight authoring and factory', () => {
  it('authors every roster weight separately from body mass', () => {
    expect(FIGHTER_MOVEMENT_PROFILES.link).toMatchObject({ mass: 12, referenceWeight: 104 });
    expect(FIGHTER_MOVEMENT_PROFILES.donkeykong).toMatchObject({ mass: 18, referenceWeight: 127 });
    expect(FIGHTER_MOVEMENT_PROFILES.pikachu).toMatchObject({ mass: 7.9, referenceWeight: 79 });
  });

  it.each([
    { id: 'link', expected: 104 }, { id: 'donkeykong', expected: 127 },
    { id: 'pikachu', expected: 79 },
  ] as const)('loads older $id files using the profile weight without changing mass', ({ id, expected }) => {
    const original = serializeCharacterDataSpec(getAuthorableCharacterSpec(id));
    const { referenceWeight: _omitted, ...movement } = original.movement;
    const spec = reload(parseCharacterDataFile({ ...original, movement }));
    expect(spec.movement.referenceWeight).toBe(expected);
    expect(spec.movement.mass).toBe(original.movement.mass);
    const fighter = createCharacterById(factoryScene(), id, {
      ...spec.body, ...spec.movement, spawnX: 0, spawnY: 0,
    });
    expect(fighter.getTuning().referenceWeight).toBe(expected);
    expect(fighter.body.mass).toBe(original.movement.mass);
    fighter.destroy();
  });

  it('passes saved movement and move edits through the runtime factory', () => {
    const original = linkFile();
    const spec = reload(parseCharacterDataFile({ ...original,
      movement: { ...original.movement, referenceWeight: 82.5, mass: 21 },
      moves: { uair: { ...LINK_UAIR, knockback: referenceKnockback, launchAwayFromSource: true } },
    }));
    const fighter = createCharacterById(factoryScene(), spec.id, {
      ...spec.body, ...spec.movement, spawnX: 0, spawnY: 0,
    });
    applyCharacterMoveOverrides(fighter, spec);
    expect(fighter.getTuning()).toMatchObject({ referenceWeight: 82.5, mass: 21 });
    expect(fighter.body.mass).toBe(21);
    expect(fighter.getAttack(LINK_UAIR.id)).toMatchObject({
      knockback: referenceKnockback, launchAwayFromSource: true,
    });
    fighter.destroy();
  });

  it.each([0, -1, Infinity, NaN, null, '104'])('rejects invalid reference weight %j', referenceWeight => {
    const original = linkFile();
    expect(() => parseCharacterDataFile({ ...original,
      movement: { ...original.movement, referenceWeight },
    })).toThrow('movement.referenceWeight');
  });
});

describe('reference controls in Character Lab', () => {
  it.each([
    { slot: 'upLight', id: 'link.utilt', reference: { base: 30, growth: 103, angle: 95 } },
    { slot: 'downLight', id: 'link.dtilt', reference: { base: 90, growth: 30, angle: 85 } },
    { slot: 'nair', id: 'link.nair', reference: { base: 22, growth: 100, angle: 361 } },
    { slot: 'dashAttack', id: 'link.dashAttack', reference: { base: 70, growth: 85, angle: 45 } },
    { slot: 'dair', id: 'link.dair', reference: { base: 30, growth: 80, angle: 270 } },
  ] as const)('preserves $slot reference launches through Lab edits, save/load and live construction', ({ slot, id, reference }) => {
    const state = new CharacterEditState(reload(getAuthorableCharacterSpec('link')));
    const move = state.getSpec().moves![slot]!;
    expect(move.knockback.reference).toMatchObject(reference);
    const fields = buildCharacterEditorFields(state.getSpec(), 'move', slot);
    for (const [key, value] of Object.entries(reference)) {
      expect(fields.find(field => field.id === `knockback.reference.${key}`)?.value).toBe(value);
    }
    expect(fields.some(field => field.id === 'knockback.x')).toBe(false);
    state.setMoveNumericField(slot, ['knockback', 'reference', 'growth'], reference.growth + 7);
    const saved = reload(state.getSpec());
    const fighter = createCharacterById(factoryScene(), 'link', {
      ...saved.body, ...saved.movement, spawnX: 0, spawnY: 0,
    });
    applyCharacterMoveOverrides(fighter, saved);
    expect(fighter.getAttack(id)?.knockback.reference).toMatchObject({ ...reference, growth: reference.growth + 7 });
    expect(getAuthorableCharacterSpec('link').moves![slot]!.knockback.reference).toMatchObject(reference);
    fighter.destroy();
  });

  it('edits and reloads a late neutral-air collision hit without changing its early hit or hit group', () => {
    const state = new CharacterEditState(reload(getAuthorableCharacterSpec('link')));
    const fields = buildCharacterEditorFields(state.getSpec(), 'move', 'nair');
    const late = 'hitWindows.1.collisionHits.0.knockback.reference';
    expect(fields.find(field => field.id === `${late}.base`)?.value).toBe(22);
    expect(fields.find(field => field.id === `${late}.growth`)?.value).toBe(100);
    expect(fields.find(field => field.id === `${late}.angle`)?.value).toBe(361);
    expect(fields.some(field => field.id === 'hitWindows.1.collisionHits.0.knockback.x')).toBe(false);
    state.setMoveNumericField('nair', ['hitWindows', '1', 'collisionHits', '0', 'knockback', 'reference', 'base'], 27);
    const saved = reload(state.getSpec());
    const fighter = createCharacterById(factoryScene(), 'link', {
      ...saved.body, ...saved.movement, spawnX: 0, spawnY: 0,
    });
    applyCharacterMoveOverrides(fighter, saved);
    const move = fighter.getAttack('link.nair')!;
    expect(move.knockback.reference).toMatchObject({ base: 22, growth: 100, angle: 361 });
    expect(move.hitWindows![0]).toMatchObject({ startFrame: 6, endFrame: 7, group: 'nair', damage: 11 });
    expect(move.hitWindows![0]!.collisionHits![0]!.knockback!.reference!.base).toBe(22);
    expect(move.hitWindows![1]).toMatchObject({ startFrame: 7, endFrame: 8, group: 'nair', damage: 11 });
    expect(move.hitWindows![1]!.collisionHits![0]!.knockback!.reference!.base).toBe(27);
    expect(getAuthorableCharacterSpec('link').moves!.nair!.hitWindows![1]!.collisionHits![0]!.knockback!.reference!.base).toBe(22);
    fighter.destroy();
  });

  it('edits down-air window hits and the returning hit independently through save/load and construction', () => {
    const original = reload(getAuthorableCharacterSpec('link'));
    const state = new CharacterEditState(original);
    const variants = [
      { path: ['hitWindows', '0', 'collisionHits', '1', 'knockback'], reference: { base: 30, growth: 78, angle: 60 } },
      { path: ['hitWindows', '1', 'collisionHits', '0', 'knockback'], reference: { base: 30, growth: 80, angle: 60 } },
      { path: ['rebound', 'returnHit', 'knockback'], reference: { base: 50, growth: 80, angle: 65 } },
    ];
    const fields = buildCharacterEditorFields(state.getSpec(), 'move', 'dair');
    for (const { path, reference } of variants) {
      const prefix = path.join('.');
      for (const [key, value] of Object.entries(reference)) {
        expect(fields.find(field => field.id === `${prefix}.reference.${key}`)?.value).toBe(value);
      }
      for (const key of ['x', 'y', 'scaling']) {
        expect(fields.some(field => field.id === `${prefix}.${key}`)).toBe(false);
      }
      state.setMoveNumericField('dair', [...path, 'reference', 'base'], reference.base + 5);
    }
    const saved = reload(state.getSpec());
    const fighter = createCharacterById(factoryScene(), 'link', {
      ...saved.body, ...saved.movement, spawnX: 0, spawnY: 0,
    });
    applyCharacterMoveOverrides(fighter, saved);
    const dair = fighter.getAttack('link.dair')! as typeof LINK_DAIR;
    expect(dair.knockback.reference).toMatchObject({ base: 30, growth: 80, angle: 270 });
    expect(dair.hitWindows![0]).toMatchObject({ startFrame: 13, endFrame: 19, group: 'dair', damage: 18 });
    expect(dair.hitWindows![0]!.collisionHits![0]!.knockback!.reference).toMatchObject({ base: 30, growth: 80, angle: 270 });
    expect(dair.hitWindows![0]!.collisionHits![1]!.knockback!.reference).toMatchObject({ base: 35, growth: 78, angle: 60 });
    expect(dair.hitWindows![1]).toMatchObject({ startFrame: 19, endFrame: 64, group: 'dair', damage: 15 });
    expect(dair.hitWindows![1]!.collisionHits![0]!.knockback!.reference).toMatchObject({ base: 35, growth: 80, angle: 60 });
    expect(dair.rebound).toMatchObject({ upwardSpeed: 6.65, rehitFrames: 30, disableOnFastFall: true,
      returnHit: { damage: 11, knockback: { reference: { base: 55, growth: 80, angle: 65 } } } });
    expect(getAuthorableCharacterSpec('link')).toEqual(original);
    fighter.destroy();
  });

  it('exposes active reference fields and weight, hides unused launch fields, and saves edits', () => {
    const state = new CharacterEditState(parseCharacterDataFile(withReference(reference)));
    const fields = buildCharacterEditorFields(state.getSpec(), 'move', 'tilt');
    expect(fields.find(field => field.id === 'knockback.reference.base')).toMatchObject({ value: 30, min: 0 });
    expect(fields.find(field => field.id === 'knockback.reference.growth')).toMatchObject({ value: 100, min: 0 });
    const angle = fields.find(field => field.id === 'knockback.reference.angle')!;
    expect(angle).toMatchObject({ value: 361, min: 0, max: 367, step: 1, integer: true });
    expect(stepCharacterEditorField({ ...angle, value: 360 }, 1)).toBe(361);
    expect(stepCharacterEditorField(angle, 1)).toBe(367);
    expect(stepCharacterEditorField({ ...angle, value: 367 }, -1)).toBe(361);
    for (const key of Object.keys(legacyKnockback)) {
      expect(fields.some(field => field.id === `knockback.${key}`), key).toBe(false);
    }
    expect(buildCharacterEditorFields(state.getSpec(), 'movement')
      .find(field => field.id === 'movement.referenceWeight')).toMatchObject({ value: 104, min: 1 });
    state.setMoveNumericField('tilt', ['knockback', 'reference', 'base'], 40);
    state.setMoveNumericField('tilt', ['knockback', 'reference', 'growth'], 115);
    state.setMoveNumericField('tilt', ['knockback', 'reference', 'angle'], 45);
    state.setMovementField('referenceWeight', 95);
    const saved = reload(state.getSpec());
    expect(saved.moves?.tilt?.knockback).toEqual({ ...legacyKnockback,
      reference: { base: 40, growth: 115, angle: 45 } });
    expect(saved.movement.referenceWeight).toBe(95);
    expect(reference).toEqual({ base: 30, growth: 100, angle: 361 });
  });

  it('hides inactive values independently for nested launch records while keeping legacy controls', () => {
    const spec = parseCharacterDataFile({ ...linkFile(), moves: { tilt: { ...LINK_TILT,
      knockback: legacyKnockback,
      hitWindows: [{ startFrame: LINK_TILT.startupFrames,
        endFrame: LINK_TILT.startupFrames + LINK_TILT.activeFrames,
        knockback: referenceKnockback, groundedKnockback: legacyKnockback }],
    } } });
    const ids = buildCharacterEditorFields(spec, 'move', 'tilt').map(field => field.id);
    expect(ids).toContain('knockback.x');
    expect(ids).toContain('knockback.damageGrowth');
    expect(ids).toContain('hitWindows.0.knockback.reference.angle');
    expect(ids).not.toContain('hitWindows.0.knockback.x');
    expect(ids).not.toContain('hitWindows.0.knockback.damageGrowth');
    expect(ids).toContain('hitWindows.0.groundedKnockback.x');
  });
});
