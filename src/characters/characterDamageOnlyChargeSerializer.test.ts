import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { CharacterEditState } from '../characterBuilder/characterEditState';
import { buildCharacterEditorFields, stepCharacterEditorField } from '../characterBuilder/characterEditorFields';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { applyCharacterMoveOverrides, createCharacterById } from './characterFactory';
import { parseCharacterDataFile, serializeCharacterDataSpec, type CharacterDataSpec } from './characterSerializer';
import { LINK_DSMASH, LINK_NEUTRAL_SPECIAL, LINK_SIDE_SPECIAL, LINK_SMASH, LINK_SMASH2 } from './Link';
import { CHARGED_BOW_NEUTRAL_SPECIAL } from './chargedBowFixture';

const require = createRequire(import.meta.url);
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const file = () => serializeCharacterDataSpec(getAuthorableCharacterSpec('link'));
const reload = (spec: CharacterDataSpec) => parseCharacterDataFile(
  JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))),
);
const legacy = { x: 2, y: -1, scaling: 0.2 };
const reference = { ...legacy, reference: { base: 45, growth: 12, angle: 69 } };
const damageOnlyMove = () => ({ ...LINK_SMASH, knockback: reference,
  charge: { ...LINK_SMASH.charge!, knockbackMode: 'damage-only' as const } });
const parseMove = (move: unknown) => parseCharacterDataFile({ ...file(), moves: { smash: move } });
const window = (sweetSpot: unknown) => ({ startFrame: LINK_SMASH.startupFrames,
  endFrame: LINK_SMASH.startupFrames + LINK_SMASH.activeFrames, sweetSpot });

describe('explicit damage-only charge authoring', () => {
  it('preserves main, grounded, window and sweet-spot reference records with legacy endpoints', () => {
    const sweetSpot = { hitbox: LINK_SMASH.hitbox, damageMultiplier: 2,
      knockback: { ...legacy, reference: { base: 30, growth: 100, angle: 361 } } };
    const smash = { ...damageOnlyMove(), groundedKnockback: reference, sweetSpot,
      hitWindows: [{ ...window(sweetSpot), knockback: reference, groundedKnockback: reference }] };
    expect(reload(parseMove(smash)).moves?.smash).toEqual(smash);
  });

  it.each([null, true, 0, 'legacy', 'damage', {}])('rejects unsupported charge mode %j', knockbackMode => {
    expect(() => parseMove({ ...damageOnlyMove(), charge: { ...LINK_SMASH.charge!, knockbackMode } }))
      .toThrow('moves.smash.charge.knockbackMode');
  });

  it('requires a main reference launch before accepting damage-only charge', () => {
    expect(() => parseMove({ ...damageOnlyMove(), knockback: legacy }))
      .toThrow("moves.smash.charge.knockbackMode 'damage-only' requires moves.smash.knockback.reference");
  });

  it('accepts an explicit damage-only charged reference projectile and rejects misplaced melee charge', () => {
    const neutralSpecial = CHARGED_BOW_NEUTRAL_SPECIAL;
    expect(parseCharacterDataFile({ ...file(), moves: { neutralSpecial } }).moves!.neutralSpecial)
      .toEqual(neutralSpecial);
    expect(() => parseCharacterDataFile({ ...file(), moves: { neutralSpecial: {
      ...LINK_NEUTRAL_SPECIAL, knockback: reference, charge: damageOnlyMove().charge,
    } } })).toThrow('moves.neutralSpecial.charge.knockbackMode is only supported for melee charges');
    expect(() => parseCharacterDataFile({ ...file(), moves: { sideSpecial: {
      ...LINK_SIDE_SPECIAL, knockback: reference, charge: damageOnlyMove().charge,
    } } })).toThrow('moves.sideSpecial.charge.knockbackMode is only supported for melee charges');
  });

  it.each(['minKnockback', 'maxKnockback'] as const)('keeps %s required and legacy in damage-only mode', key => {
    expect(() => parseMove({ ...damageOnlyMove(), charge: {
      ...damageOnlyMove().charge, [key]: reference,
    } })).toThrow(`moves.smash.charge.${key}.reference is not supported for charged attacks`);
    expect(() => parseMove({ ...damageOnlyMove(), charge: {
      ...damageOnlyMove().charge, [key]: undefined,
    } })).toThrow(`moves.smash.charge.${key}`);
  });

  it('keeps omitted mode absent and its legacy endpoint controls editable', () => {
    const { knockbackMode: _omitted, ...charge } = LINK_SMASH.charge!;
    // Legacy interpolation forbids reference launches, including the shipped per-hit records.
    const { hitWindows: _windows, ...plain } = LINK_SMASH;
    const smash = { ...plain, knockback: legacy, charge,
      sweetSpot: { hitbox: LINK_SMASH.hitbox, damageMultiplier: 2 } };
    const saved = reload(parseMove(smash));
    expect(saved.moves?.smash).toEqual(smash);
    expect(Object.hasOwn(saved.moves!.smash!.charge!, 'knockbackMode')).toBe(false);
    const fields = buildCharacterEditorFields(saved, 'move', 'smash');
    expect(fields.some(field => field.id === 'charge.minKnockback.x')).toBe(true);
    expect(fields.some(field => field.id === 'charge.maxKnockback.scaling')).toBe(true);
    expect(Object.hasOwn(saved.moves!.smash!.sweetSpot!, 'knockback')).toBe(false);
  });
});

describe('sweet-spot knockback parsing', () => {
  it.each(['main', 'window'] as const)('preserves an optional legacy override in the %s sweet spot', scope => {
    const sweetSpot = { hitbox: LINK_SMASH.hitbox, knockback: legacy };
    const smash = scope === 'main' ? { ...damageOnlyMove(), sweetSpot }
      : { ...damageOnlyMove(), hitWindows: [window(sweetSpot)] };
    expect(reload(parseMove(smash)).moves?.smash).toEqual(smash);
  });

  it.each(['main', 'window'] as const)('rejects malformed %s sweet-spot reference data at its full field path', scope => {
    const prefix = scope === 'main' ? 'moves.smash.sweetSpot' : 'moves.smash.hitWindows[0].sweetSpot';
    for (const [field, value] of [['base', -1], ['growth', Infinity], ['angle', 362]] as const) {
      const sweetSpot = { hitbox: LINK_SMASH.hitbox,
        knockback: { ...reference, reference: { ...reference.reference, [field]: value } } };
      const smash = scope === 'main' ? { ...damageOnlyMove(), sweetSpot }
        : { ...damageOnlyMove(), hitWindows: [window(sweetSpot)] };
      expect(() => parseMove(smash)).toThrow(`${prefix}.knockback.reference.${field}`);
    }
    const sweetSpot = { hitbox: LINK_SMASH.hitbox, knockback: { ...legacy, reference: null } };
    expect(() => parseMove(scope === 'main' ? { ...damageOnlyMove(), sweetSpot }
      : { ...damageOnlyMove(), hitWindows: [window(sweetSpot)] }))
      .toThrow(`${prefix}.knockback.reference must be an object`);
  });

  it.each(['main', 'window'] as const)('rejects reference %s sweet-spot overrides in legacy interpolation mode', scope => {
    const { knockbackMode: _omitted, ...charge } = LINK_SMASH.charge!;
    const sweetSpot = { hitbox: LINK_SMASH.hitbox, knockback: reference };
    const smash = { ...LINK_SMASH, knockback: legacy, charge,
      sweetSpot: scope === 'main' ? sweetSpot : { hitbox: LINK_SMASH.hitbox },
      ...(scope === 'window' ? { hitWindows: [window(sweetSpot)] } : {}) };
    const prefix = scope === 'main' ? 'moves.smash.sweetSpot' : 'moves.smash.hitWindows[0].sweetSpot';
    expect(() => parseMove(smash)).toThrow(`${prefix}.knockback.reference is not supported for charged attacks`);
  });
});

describe('damage-only charge controls and persistence', () => {
  it('edits down-smash front and back launches independently without losing charge', () => {
    const original = reload(getAuthorableCharacterSpec('link'));
    const state = new CharacterEditState(original);
    const move = state.getSpec().moves!.downSmash!;
    const front = { base: 40, growth: 88, angle: 78 };
    const back = { base: 80, growth: 63, angle: 30 };
    const backHit = (spec: typeof move) => spec.hitWindows![2]!.collisionHits![0]!.knockback!.reference;
    expect(move.knockback.reference).toMatchObject(front);
    expect(backHit(move)).toMatchObject(back);
    expect(move.charge?.knockbackMode).toBe('damage-only');
    const fields = buildCharacterEditorFields(state.getSpec(), 'move', 'downSmash');
    expect(fields.some(field => /^charge\.(min|max)Knockback\./.test(field.id))).toBe(false);
    expect(fields.find(field => field.id === 'charge.minDamage')?.value).toBe(16);
    expect(fields.find(field => field.id === 'charge.maxDamage')?.value).toBe(22.4);
    for (const [prefix, source] of [
      ['knockback', front],
      ['hitWindows.2.collisionHits.0.knockback', back],
    ] as const) {
      for (const [key, value] of Object.entries(source)) {
        expect(fields.find(field => field.id === `${prefix}.reference.${key}`)?.value).toBe(value);
      }
      expect(fields.some(field => field.id === `${prefix}.x`)).toBe(false);
    }
    for (const id of ['knockback.reference.base', 'hitWindows.2.collisionHits.0.knockback.reference.growth']) {
      const field = fields.find(candidate => candidate.id === id)!;
      state.setMoveNumericField('downSmash', field.path, stepCharacterEditorField(field, 1));
    }
    const saved = reload(state.getSpec());
    const fighter = createCharacterById({ matter: { body: Body, add: { rectangle: Bodies.rectangle },
      world: { on() {}, off() {}, remove() {} } } } as any, 'link', {
      ...saved.body, ...saved.movement, spawnX: 0, spawnY: 0,
    });
    applyCharacterMoveOverrides(fighter, saved);
    const authored = fighter.getAttack(LINK_DSMASH.id)!;
    expect(authored).toMatchObject({
      damage: 16, knockback: { reference: { base: 41, growth: 88, angle: 78 } },
      charge: { knockbackMode: 'damage-only', minDamage: 16, maxDamage: 22.4 },
    });
    expect(authored.hitWindows![0]).toMatchObject({ startFrame: 11, endFrame: 12, group: 'hit1', damage: 16 });
    expect(authored.hitWindows![2]).toMatchObject({ startFrame: 23, endFrame: 24, group: 'hit2', damage: 12 });
    expect(backHit(authored as typeof move)).toMatchObject({ ...back, growth: 64 });
    expect(authored.hitWindows![0]!.collisionHits![0]!.knockback!.reference).toMatchObject(front);
    expect(saved.moves!.downSmash!.charge).toEqual(original.moves!.downSmash!.charge);
    expect(getAuthorableCharacterSpec('link').moves!.downSmash!.knockback.reference?.base).toBe(40);
    expect(backHit(getAuthorableCharacterSpec('link').moves!.downSmash!)?.growth).toBe(63);
    fighter.destroy();
  });

  it('edits main, tip and second-slash source data through Lab save/load and the live factory', () => {
    const state = new CharacterEditState(reload(getAuthorableCharacterSpec('link')));
    const records = [
      { slot: 'smash', prefix: ['knockback'], source: { base: 45, growth: 12, angle: 69 } },
      { slot: 'smash', prefix: ['hitWindows', '0', 'collisionHits', '1', 'knockback'], source: { base: 30, growth: 100, angle: 361 } },
      { slot: 'smash2', prefix: ['knockback'], source: { base: 85, growth: 89, angle: 48 } },
    ] as const;
    for (const { slot, prefix, source } of records) {
      const move = state.getSpec().moves![slot]!;
      // The first slash charges (damage-only); the second slash is an uncharged follow-up.
      expect(move.charge?.knockbackMode).toBe(slot === 'smash' ? 'damage-only' : undefined);
      const fields = buildCharacterEditorFields(state.getSpec(), 'move', slot);
      expect(fields.some(field => /^charge\.(min|max)Knockback\./.test(field.id))).toBe(false);
      expect(fields.some(field => field.id === 'charge.minDamage')).toBe(slot === 'smash');
      expect(fields.some(field => field.id === 'charge.maxDamage')).toBe(slot === 'smash');
      for (const [key, value] of Object.entries(source)) {
        expect(fields.find(field => field.id === [...prefix, 'reference', key].join('.'))?.value).toBe(value);
      }
      expect(fields.some(field => field.id === [...prefix, 'x'].join('.'))).toBe(false);
      const field = fields.find(field => field.id === [...prefix, 'reference', 'base'].join('.'))!;
      state.setMoveNumericField(slot, field.path, stepCharacterEditorField(field, 1));
    }
    const saved = reload(state.getSpec());
    const fighter = createCharacterById({ matter: { body: Body, add: { rectangle: Bodies.rectangle },
      world: { on() {}, off() {}, remove() {} } } } as any, 'link', {
      ...saved.body, ...saved.movement, spawnX: 0, spawnY: 0,
    });
    applyCharacterMoveOverrides(fighter, saved);
    const smash = fighter.getAttack(LINK_SMASH.id)! as typeof LINK_SMASH;
    expect(smash).toMatchObject({
      knockback: { reference: { base: 46, growth: 12, angle: 69 } },
      charge: { knockbackMode: 'damage-only', minDamage: 7 },
    });
    expect(smash.charge!.maxDamage).toBeCloseTo(9.8, 12);
    expect(smash.hitWindows![0]!.collisionHits![1]!.knockback!.reference).toMatchObject({ base: 31, growth: 100, angle: 361 });
    expect(fighter.getAttack(LINK_SMASH2.id)).toMatchObject({ knockback: { reference: { base: 86, growth: 89, angle: 48 } } });
    expect((fighter.getAttack(LINK_SMASH2.id) as typeof LINK_SMASH).charge).toBeUndefined();
    const authored = getAuthorableCharacterSpec('link').moves!;
    expect(authored.smash!.knockback.reference?.base).toBe(45);
    expect(authored.smash!.hitWindows![0]!.collisionHits![1]!.knockback!.reference?.base).toBe(30);
    expect(authored.smash2!.knockback.reference?.base).toBe(85);
    fighter.destroy();
  });
});
