import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { CharacterEditState } from '../characterBuilder/characterEditState';
import { buildCharacterEditorFields, stepCharacterEditorField } from '../characterBuilder/characterEditorFields';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { createCharacterById } from './characterFactory';
import { parseCharacterDataFile, serializeCharacterDataSpec, type CharacterDataSpec } from './characterSerializer';
import { FIGHTER_MOVEMENT_PROFILES } from './fighterMovementProfiles';
import type { ReferenceLaunchProfile } from './referenceLaunchEnergy';

const require = createRequire(import.meta.url);
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const LINK_PROFILE: ReferenceLaunchProfile = {
  gravity: 0.096, fallSpeed: 1.6, verticalGravity: 0.076944, verticalFallSpeed: 1.8,
};
const DK_PROFILE: ReferenceLaunchProfile = {
  gravity: 0.085, fallSpeed: 1.63, verticalGravity: 0.084672, verticalFallSpeed: 1.8,
};
const PIKACHU_PROFILE: ReferenceLaunchProfile = {
  gravity: 0.095, fallSpeed: 1.55, verticalGravity: 0.068544, verticalFallSpeed: 1.8,
};
const profileKeys = ['gravity', 'fallSpeed', 'verticalGravity', 'verticalFallSpeed'] as const;
const linkFile = () => serializeCharacterDataSpec(getAuthorableCharacterSpec('link'));
const withProfile = (referenceLaunch: unknown) => {
  const original = linkFile();
  return { ...original, movement: { ...original.movement, referenceLaunch } };
};
const reload = (spec: CharacterDataSpec) =>
  parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));

function factoryScene(): any {
  return { matter: { body: Body, add: { rectangle: Bodies.rectangle },
    world: { on() {}, off() {}, remove() {} } } };
}

describe('reference launch profile serialization', () => {
  it('authors every roster fighter in native game units', () => {
    expect(FIGHTER_MOVEMENT_PROFILES.link.referenceLaunch).toEqual(LINK_PROFILE);
    expect(FIGHTER_MOVEMENT_PROFILES.donkeykong.referenceLaunch).toEqual(DK_PROFILE);
    expect(FIGHTER_MOVEMENT_PROFILES.pikachu.referenceLaunch).toEqual(PIKACHU_PROFILE);
  });

  it.each([
    { id: 'link', expected: LINK_PROFILE }, { id: 'donkeykong', expected: DK_PROFILE },
    { id: 'pikachu', expected: PIKACHU_PROFILE },
  ] as const)('inherits the profile for older $id saves without modifying normal movement', ({ id, expected }) => {
    const original = serializeCharacterDataSpec(getAuthorableCharacterSpec(id));
    const { referenceLaunch: _omitted, ...movement } = original.movement;
    const loaded = reload(parseCharacterDataFile({ ...original, movement }));
    expect(loaded.movement.referenceLaunch).toEqual(expected);
    for (const key of ['fallAccel', 'maxFallSpeed', 'fastFallSpeed', 'mass', 'referenceWeight'] as const) {
      expect(loaded.movement[key], key).toBe(original.movement[key]);
    }
    const fighter = createCharacterById(factoryScene(), id, {
      ...loaded.body, ...loaded.movement, spawnX: 0, spawnY: 0,
    });
    expect(fighter.getTuning().referenceLaunch).toEqual(expected);
    fighter.destroy();
  });

  it('round-trips a complete edited profile and passes it through the runtime factory', () => {
    const edited = { gravity: 0.123456, fallSpeed: 2.17, verticalGravity: 0.065432, verticalFallSpeed: 2.4 };
    const loaded = reload(parseCharacterDataFile(withProfile(edited)));
    expect(loaded.movement.referenceLaunch).toEqual(edited);
    const fighter = createCharacterById(factoryScene(), 'link', {
      ...loaded.body, ...loaded.movement, spawnX: 0, spawnY: 0,
    });
    expect(fighter.getTuning().referenceLaunch).toEqual(edited);
    expect(fighter.getTuning().maxFallSpeed).toBe(FIGHTER_MOVEMENT_PROFILES.link.maxFallSpeed);
    expect(fighter.body.mass).toBe(FIGHTER_MOVEMENT_PROFILES.link.mass);
    fighter.destroy();
  });

  it('retains explicit zero gravity values instead of replacing them with profile defaults', () => {
    const profile = { ...LINK_PROFILE, gravity: 0, verticalGravity: 0 };
    expect(reload(parseCharacterDataFile(withProfile(profile))).movement.referenceLaunch).toEqual(profile);
  });

  it.each(profileKeys)('requires finite, complete, nonnegative %s data', key => {
    for (const value of [-1, Infinity, NaN, undefined, null, '0.1', true]) {
      expect(() => parseCharacterDataFile(withProfile({ ...LINK_PROFILE, [key]: value })))
        .toThrow(`movement.referenceLaunch.${key}`);
    }
  });

  it.each(['fallSpeed', 'verticalFallSpeed'] as const)('requires a positive %s cap', key => {
    expect(() => parseCharacterDataFile(withProfile({ ...LINK_PROFILE, [key]: 0 })))
      .toThrow(`movement.referenceLaunch.${key}`);
  });

  it.each([null, [], 'launch', 1, true])('rejects a malformed profile %j', value => {
    expect(() => parseCharacterDataFile(withProfile(value))).toThrow('movement.referenceLaunch must be an object');
  });
});

describe('reference launch controls in Character Lab', () => {
  it('exposes four nested controls with units and enough precision for authored gravity', () => {
    const fields = buildCharacterEditorFields(getAuthorableCharacterSpec('link'), 'movement')
      .filter(field => field.path[0] === 'referenceLaunch');
    expect(fields).toHaveLength(4);
    for (const key of profileKeys) {
      const field = fields.find(candidate => candidate.id === `movement.referenceLaunch.${key}`)!;
      expect(field.path).toEqual(['referenceLaunch', key]);
      expect(field.value).toBe(LINK_PROFILE[key]);
      expect(field.label).toContain(key.endsWith('Gravity') || key === 'gravity' ? 'units/frame²' : 'units/frame');
      expect(field.precision).toBe(6);
    }
    const verticalGravity = fields.find(field => field.path[1] === 'verticalGravity')!;
    expect(stepCharacterEditorField(verticalGravity, 1)).toBe(0.077944);
    expect(stepCharacterEditorField({ ...verticalGravity, value: 0 }, -1)).toBe(0);
    const fallSpeed = fields.find(field => field.path[1] === 'fallSpeed')!;
    expect(stepCharacterEditorField({ ...fallSpeed, value: fallSpeed.min }, -1)).toBeGreaterThan(0);
  });

  it('edits the selected nested leaf, preserves siblings, and supports undo, redo and save', () => {
    const original = getAuthorableCharacterSpec('link');
    const state = new CharacterEditState(original);
    const field = buildCharacterEditorFields(state.getSpec(), 'movement')
      .find(candidate => candidate.id === 'movement.referenceLaunch.verticalGravity')!;
    state.setMovementNumericField(field.path, stepCharacterEditorField(field, 1));
    const edited = { ...LINK_PROFILE, verticalGravity: 0.077944 };
    expect(state.getSpec().movement.referenceLaunch).toEqual(edited);
    expect(original.movement.referenceLaunch).toEqual(LINK_PROFILE);
    expect(state.isDirty()).toBe(true);
    state.undo();
    expect(state.getSpec().movement.referenceLaunch).toEqual(LINK_PROFILE);
    state.redo();
    expect(reload(state.getSpec()).movement.referenceLaunch).toEqual(edited);
    // The same scene handler continues to edit ordinary single-level movement fields.
    state.setMovementNumericField(['maxRunSpeed'], 9);
    expect(state.getSpec().movement.maxRunSpeed).toBe(9);
    expect(state.getSpec().movement.referenceLaunch).toEqual(edited);
  });

  it('rejects absent or nonnumeric movement paths without creating incomplete profiles', () => {
    // A Lab spec without a launch profile must not gain a partial one.
    const pikachu = getAuthorableCharacterSpec('pikachu');
    const { referenceLaunch: _omitted, ...movement } = pikachu.movement;
    const state = new CharacterEditState({ ...pikachu, movement });
    expect(() => state.setMovementNumericField([], 1)).toThrow('path cannot be empty');
    expect(() => state.setMovementNumericField(['referenceLaunch', 'gravity'], 0.1)).toThrow('is not numeric');
    expect(() => state.setMovementNumericField(['missing'], 1)).toThrow('is not numeric');
    expect(state.isDirty()).toBe(false);
  });
});
