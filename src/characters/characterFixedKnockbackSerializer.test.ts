import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { CharacterEditState } from '../characterBuilder/characterEditState';
import { buildCharacterEditorFields, stepCharacterEditorField } from '../characterBuilder/characterEditorFields';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { applyCharacterMoveOverrides, createCharacterById } from './characterFactory';
import { parseCharacterDataFile, serializeCharacterDataSpec, type CharacterDataSpec } from './characterSerializer';
import { LINK_SMASH, LINK_USMASH } from './Link';
import { CHARGED_BOW_NEUTRAL_SPECIAL } from './chargedBowFixture';

const require = createRequire(import.meta.url);
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const LEGACY = { x: 1, y: -2, scaling: 0.1 };
const BASE = { base: 0, growth: 100, angle: 95 };
const LOCATIONS = [
  { path: ['knockback'], label: 'knockback' },
  { path: ['groundedKnockback'], label: 'groundedKnockback' },
  { path: ['sweetSpot', 'knockback'], label: 'sweetSpot.knockback' },
  { path: ['hitWindows', '0', 'knockback'], label: 'hitWindows[0].knockback' },
  { path: ['hitWindows', '0', 'groundedKnockback'], label: 'hitWindows[0].groundedKnockback' },
  { path: ['hitWindows', '0', 'sweetSpot', 'knockback'], label: 'hitWindows[0].sweetSpot.knockback' },
] as const;
const file = () => serializeCharacterDataSpec(getAuthorableCharacterSpec('link'));
const reload = (spec: CharacterDataSpec) => parseCharacterDataFile(
  JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))),
);

function atPath(value: unknown, path: readonly string[]): Record<string, unknown> {
  let current = value;
  for (const key of path) current = (current as Record<string, unknown>)[key];
  return current as Record<string, unknown>;
}

/** Synthetic charged move exercises every reference-bearing attack location. */
function fixture(reference: Record<string, unknown>, onlyPath?: readonly string[]) {
  const kb = () => ({ ...LEGACY, reference: { ...BASE } });
  const sweet = () => ({ hitbox: LINK_SMASH.hitbox, damageMultiplier: 2, knockback: kb() });
  const move = { ...LINK_SMASH, knockback: kb(), groundedKnockback: kb(), sweetSpot: sweet(),
    charge: { ...LINK_SMASH.charge!, knockbackMode: 'damage-only' as const },
    hitWindows: [{ startFrame: LINK_SMASH.startupFrames,
      endFrame: LINK_SMASH.startupFrames + LINK_SMASH.activeFrames,
      knockback: kb(), groundedKnockback: kb(), sweetSpot: sweet() }] };
  for (const path of onlyPath ? [onlyPath] : LOCATIONS.map(location => location.path)) {
    atPath(move, path).reference = { ...reference };
  }
  return { ...file(), moves: { smash: move } };
}

describe('fixed knockback, set-weight and additional reaction authoring', () => {
  it.each([
    { label: 'omitted options', reference: BASE },
    { label: 'explicit zero and false', reference: { ...BASE, fixed: 0, setWeight: false, additionalHitstunFrames: 0 } },
    { label: 'positive options and fractional fixed units', reference: {
      ...BASE, fixed: 37.5, setWeight: true, additionalHitstunFrames: 8,
    } },
  ])('preserves $label at main, grounded, window and sweet-spot locations', ({ reference }) => {
    const input = fixture(reference);
    const saved = reload(parseCharacterDataFile(input));
    expect(saved.moves?.smash).toEqual(input.moves.smash);
    for (const { path } of LOCATIONS) {
      const actual = atPath(saved.moves!.smash, [...path, 'reference']);
      expect(actual).toEqual(reference);
      for (const key of ['fixed', 'setWeight', 'additionalHitstunFrames']) {
        expect(Object.hasOwn(actual, key)).toBe(Object.hasOwn(reference, key));
      }
    }
  });

  it.each(LOCATIONS)('rejects malformed optional fields with their full $label path', ({ path, label }) => {
    const invalid = [
      ['fixed', -1], ['fixed', Infinity], ['fixed', NaN], ['fixed', null], ['fixed', '40'], ['fixed', true],
      ['setWeight', null], ['setWeight', 0], ['setWeight', 1], ['setWeight', 'true'], ['setWeight', {}], ['setWeight', []],
      ['additionalHitstunFrames', -1], ['additionalHitstunFrames', 1.5],
      ['additionalHitstunFrames', Infinity], ['additionalHitstunFrames', NaN],
      ['additionalHitstunFrames', null], ['additionalHitstunFrames', '8'], ['additionalHitstunFrames', false],
    ] as const;
    for (const [key, value] of invalid) {
      expect(() => parseCharacterDataFile(fixture({ ...BASE, [key]: value }, path)))
        .toThrow(`moves.smash.${label}.reference.${key}`);
    }
  });

  it('does not add optional defaults when older reference records are edited and reloaded', () => {
    const state = new CharacterEditState(parseCharacterDataFile(fixture(BASE)));
    state.setMoveNumericField('smash', ['knockback', 'reference', 'base'], 10);
    const saved = reload(state.getSpec());
    expect(saved.moves!.smash!.knockback.reference).toEqual({ ...BASE, base: 10 });
    for (const { path } of LOCATIONS) {
      const reference = atPath(saved.moves!.smash, [...path, 'reference']);
      expect(Object.hasOwn(reference, 'fixed')).toBe(false);
      expect(Object.hasOwn(reference, 'setWeight')).toBe(false);
      expect(Object.hasOwn(reference, 'additionalHitstunFrames')).toBe(false);
    }
  });

  it('retains the existing legacy charge and projectile interpolation guards for these reference options', () => {
    const reference = { ...BASE, fixed: 40, setWeight: true, additionalHitstunFrames: 8 };
    const input = fixture(reference);
    const { knockbackMode: _omitted, ...charge } = input.moves.smash.charge;
    expect(() => parseCharacterDataFile({ ...input, moves: { smash: { ...input.moves.smash, charge } } }))
      .toThrow('moves.smash.knockback.reference is not supported for charged attacks');
    const { knockbackMode: _projectileMode, ...projectileCharge } = CHARGED_BOW_NEUTRAL_SPECIAL.chargedProjectile!.charge;
    const neutralSpecial = { ...CHARGED_BOW_NEUTRAL_SPECIAL, knockback: { ...LEGACY, reference },
      chargedProjectile: { ...CHARGED_BOW_NEUTRAL_SPECIAL.chargedProjectile!, charge: projectileCharge } };
    expect(() => parseCharacterDataFile({ ...file(), moves: { neutralSpecial } }))
      .toThrow('moves.neutralSpecial.knockback.reference is not supported for charged attacks');
  });
});

describe('fixed-launch numeric controls and boolean persistence', () => {
  it('preserves the shipped up-smash ground/air linkers and independently edits their fixed units', () => {
    const state = new CharacterEditState(reload(getAuthorableCharacterSpec('link')));
    const move = state.getSpec().moves!.upSmash!;
    const air = { base: 0, growth: 100, angle: 115, fixed: 38, setWeight: true };
    const ground = { base: 0, growth: 100, angle: 107, fixed: 28, setWeight: true };
    const hitRef = (spec: typeof move, window: number, hit: number) => spec.hitWindows![window]!.collisionHits![hit]!.knockback!.reference;
    expect(move.knockback.reference).toMatchObject({ base: 0, growth: 100, angle: 105, fixed: 55, setWeight: true });
    expect(move.charge?.knockbackMode).toBe('damage-only');
    expect(move.hitWindows!.map(window => window.group)).toEqual([
      ...Array(6).fill('hit1'), ...Array(6).fill('hit2'), ...Array(5).fill('hit3')]);
    const fields = buildCharacterEditorFields(state.getSpec(), 'move', 'upSmash');
    for (const window of [0, 6]) {
      expect(move.hitWindows![window]!.collisionHits![1]!.situation).toBe('air');
      expect(move.hitWindows![window]!.collisionHits![2]!.situation).toBe('ground');
      expect(hitRef(move, window, 1)).toMatchObject(air);
      expect(hitRef(move, window, 2)).toMatchObject(ground);
      for (const [hit, reference] of [[1, air], [2, ground]] as const) {
        expect(fields.find(field => field.id === `hitWindows.${window}.collisionHits.${hit}.knockback.reference.fixed`)?.value)
          .toBe(reference.fixed);
      }
    }
    state.setMoveNumericField('upSmash', ['hitWindows', '0', 'collisionHits', '1', 'knockback', 'reference', 'fixed'], 39);
    state.setMoveNumericField('upSmash', ['hitWindows', '6', 'collisionHits', '2', 'knockback', 'reference', 'fixed'], 29);
    const saved = reload(state.getSpec());
    const fighter = createCharacterById({ matter: { body: Body, add: { rectangle: Bodies.rectangle },
      world: { on() {}, off() {}, remove() {} } } } as any, 'link', {
      ...saved.body, ...saved.movement, spawnX: 0, spawnY: 0,
    });
    applyCharacterMoveOverrides(fighter, saved);
    const authored = fighter.getAttack(LINK_USMASH.id)! as typeof LINK_USMASH;
    expect(authored.knockback.reference).toMatchObject({ base: 0, growth: 100, angle: 105, fixed: 55, setWeight: true });
    expect(hitRef(authored, 0, 1)).toMatchObject({ ...air, fixed: 39 });
    expect(hitRef(authored, 0, 2)).toMatchObject(ground);
    expect(hitRef(authored, 6, 1)).toMatchObject(air);
    expect(hitRef(authored, 6, 2)).toMatchObject({ ...ground, fixed: 29 });
    expect(authored.charge).toEqual(move.charge);
    expect(hitRef(getAuthorableCharacterSpec('link').moves!.upSmash! as typeof move, 0, 1)).toMatchObject(air);
    fighter.destroy();
  });

  it.each([true, false])('edits numeric reference fields while preserving setWeight=%s through save/load and the factory', setWeight => {
    const reference = { ...BASE, fixed: 37.5, setWeight, additionalHitstunFrames: 8 };
    const original = parseCharacterDataFile(fixture(reference));
    const state = new CharacterEditState(original);
    const fields = buildCharacterEditorFields(state.getSpec(), 'move', 'smash');
    for (const { path } of LOCATIONS) {
      const prefix = [...path, 'reference'].join('.');
      const fixed = fields.find(field => field.id === `${prefix}.fixed`)!;
      const frames = fields.find(field => field.id === `${prefix}.additionalHitstunFrames`)!;
      expect(fixed).toMatchObject({ value: 37.5, step: 1, min: 0, max: 300, integer: false });
      expect(frames).toMatchObject({ value: 8, step: 1, min: 0, max: 600, integer: true });
      expect(stepCharacterEditorField({ ...fixed, value: 0 }, -1)).toBe(0);
      expect(stepCharacterEditorField({ ...frames, value: 0 }, -1)).toBe(0);
      // The Lab is numeric-only; the authored boolean must survive unrelated edits.
      expect(fields.some(field => field.id === `${prefix}.setWeight`)).toBe(false);
      expect(fields.some(field => field.id === [...path, 'x'].join('.'))).toBe(false);
      state.setMoveNumericField('smash', fixed.path, stepCharacterEditorField(fixed, 1));
      state.setMoveNumericField('smash', frames.path, stepCharacterEditorField(frames, 1));
    }
    expect(fields.some(field => /^charge\.(min|max)Knockback\./.test(field.id))).toBe(false);
    const saved = reload(state.getSpec());
    const fighter = createCharacterById({ matter: { body: Body, add: { rectangle: Bodies.rectangle },
      world: { on() {}, off() {}, remove() {} } } } as any, 'link', {
      ...saved.body, ...saved.movement, spawnX: 0, spawnY: 0,
    });
    applyCharacterMoveOverrides(fighter, saved);
    for (const { path } of LOCATIONS) {
      expect(atPath(fighter.getAttack(LINK_SMASH.id), [...path, 'reference']))
        .toEqual({ ...BASE, fixed: 38.5, setWeight, additionalHitstunFrames: 9 });
      expect(atPath(original.moves!.smash, [...path, 'reference'])).toEqual(reference);
    }
    fighter.destroy();
  });
});
