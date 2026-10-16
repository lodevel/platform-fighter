import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { CharacterEditState } from '../characterBuilder/characterEditState';
import { buildCharacterEditorFields, stepCharacterEditorField } from '../characterBuilder/characterEditorFields';
import { resolveAttackHitWindow } from './attackHitWindows';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { applyCharacterMoveOverrides, createCharacterById } from './characterFactory';
import { parseCharacterDataFile, serializeCharacterDataSpec, type CharacterDataSpec } from './characterSerializer';
import { LINK_BAIR, LINK_FAIR } from './Link';

const require = createRequire(import.meta.url);
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const FAIR_FINISH = { base: 43, growth: 120, angle: 44 };
const FAIR_FIRST_GROUND = { base: 31, growth: 28, angle: 43, setWeight: true };
const FAIR_FIRST_AIR = { base: 25, growth: 30, angle: 367, setWeight: true };
const BAIR_FINISH = { base: 45, growth: 98, angle: 361 };
const BAIR_AIR = { base: 0, growth: 100, angle: 70, fixed: 36, setWeight: true };
const BAIR_GROUND = { base: 0, growth: 100, angle: 73, fixed: 50, setWeight: true };
const reference = (hit: { knockback?: { reference?: unknown } } | undefined) => hit?.knockback?.reference;

function reload(spec: CharacterDataSpec): CharacterDataSpec {
  return parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));
}

function construct(spec: CharacterDataSpec) {
  const fighter = createCharacterById({ matter: { body: Body, add: { rectangle: Bodies.rectangle },
    world: { on() {}, off() {}, remove() {} } } } as any, 'link', {
    ...spec.body, ...spec.movement, spawnX: 0, spawnY: 0,
  });
  applyCharacterMoveOverrides(fighter, spec);
  return fighter;
}

describe('saved Link forward/back aerial launch contracts', () => {
  it('keeps fair first-hit situation records separate from its reference finisher through JSON and construction', () => {
    const saved = reload(getAuthorableCharacterSpec('link'));
    expect(saved.moves!.fair).toEqual(LINK_FAIR);
    const fighter = construct(saved);
    try {
      const move = fighter.getAttack(LINK_FAIR.id)!;
      expect(move.knockback.reference).toMatchObject(FAIR_FIRST_GROUND);
      expect(move.launchAwayFromSource).toBeUndefined();
      expect(move.hitWindows!.map(window => window.group)).toEqual(['hit1', 'hit2']);
      const first = resolveAttackHitWindow(move, move, move.hitWindows![0]!);
      const finish = resolveAttackHitWindow(move, move, move.hitWindows![1]!);
      expect(first.damage).toBe(8);
      expect(first.collisionHits!.map(hit => hit.situation)).toEqual(['ground', 'air', 'ground', 'air', 'ground', 'air']);
      expect(reference(first.collisionHits![0])).toMatchObject(FAIR_FIRST_GROUND);
      expect(reference(first.collisionHits![1])).toMatchObject(FAIR_FIRST_AIR);
      expect(finish.damage).toBe(10);
      expect(finish.collisionHits).toHaveLength(3);
      for (const hit of finish.collisionHits!) {
        expect(reference(hit)).toMatchObject(FAIR_FINISH);
        expect(hit.situation).toBeUndefined();
      }
      expect(finish.groundedKnockback).toBeUndefined();
    } finally {
      fighter.destroy();
    }
  });

  it('preserves distinct fixed ground/air bair linkers without leaking their options into the finisher', () => {
    const saved = reload(getAuthorableCharacterSpec('link'));
    expect(saved.moves!.bair).toEqual(LINK_BAIR);
    expect(saved.moves!.bair!.aerialDirection).toBe('back');
    const fighter = construct(saved);
    try {
      const move = fighter.getAttack(LINK_BAIR.id)!;
      const first = resolveAttackHitWindow(move, move, move.hitWindows![0]!);
      const finish = resolveAttackHitWindow(move, move, move.hitWindows![3]!);
      expect(first.damage).toBe(5);
      expect(reference(first.collisionHits![0])).toMatchObject(BAIR_GROUND);
      expect(first.collisionHits![0]!.situation).toBe('ground');
      expect(reference(first.collisionHits![1])).toMatchObject(BAIR_AIR);
      expect(first.collisionHits![1]!.situation).toBe('air');
      expect(finish.damage).toBe(7);
      for (const hit of finish.collisionHits!) {
        expect(reference(hit)).toMatchObject(BAIR_FINISH);
        expect(hit.situation).toBeUndefined();
      }
      expect(finish.groundedKnockback).toBeUndefined();
      expect(move.launchAwayFromSource).toBeUndefined();
      expect(move.hitWindows!.map(window => window.group)).toEqual(['hit1', 'hit1', 'hit1', 'hit2', 'hit2', 'hit2']);
    } finally {
      fighter.destroy();
    }
  });

  it('edits fair first-hit and finisher reference controls independently through Lab/save/factory', () => {
    const state = new CharacterEditState(reload(getAuthorableCharacterSpec('link')));
    const fields = buildCharacterEditorFields(state.getSpec(), 'move', 'fair');
    expect(fields.find(field => field.id === 'hitWindows.1.collisionHits.0.knockback.reference.growth')?.value).toBe(120);
    expect(fields.find(field => field.id === 'hitWindows.0.collisionHits.1.knockback.reference.base')?.value).toBe(25);
    expect(fields.some(field => field.id === 'hitWindows.0.collisionHits.0.knockback.x')).toBe(false);
    state.setMoveNumericField('fair', ['hitWindows', '1', 'collisionHits', '0', 'knockback', 'reference', 'growth'], 121);
    state.setMoveNumericField('fair', ['hitWindows', '0', 'collisionHits', '1', 'knockback', 'reference', 'base'], 26);
    const saved = reload(state.getSpec());
    const fighter = construct(saved);
    try {
      const move = fighter.getAttack(LINK_FAIR.id)!;
      expect(reference(move.hitWindows![1]!.collisionHits![0])).toMatchObject({ ...FAIR_FINISH, growth: 121 });
      expect(reference(move.hitWindows![1]!.collisionHits![1])).toMatchObject(FAIR_FINISH);
      expect(reference(move.hitWindows![0]!.collisionHits![1])).toMatchObject({ ...FAIR_FIRST_AIR, base: 26 });
      expect(reference(move.hitWindows![0]!.collisionHits![0])).toMatchObject(FAIR_FIRST_GROUND);
      const authored = getAuthorableCharacterSpec('link').moves!.fair!;
      expect(reference(authored.hitWindows![1]!.collisionHits![0])).toMatchObject(FAIR_FINISH);
      expect(reference(authored.hitWindows![0]!.collisionHits![1])).toMatchObject(FAIR_FIRST_AIR);
    } finally {
      fighter.destroy();
    }
  });

  it('exposes independent bair ground/air fixed controls and preserves forced-weight flags after edits', () => {
    const state = new CharacterEditState(reload(getAuthorableCharacterSpec('link')));
    const fields = buildCharacterEditorFields(state.getSpec(), 'move', 'bair');
    for (const [hit, launch] of [[0, BAIR_GROUND], [1, BAIR_AIR]] as const) {
      const prefix = `hitWindows.0.collisionHits.${hit}.knockback`;
      const fixed = fields.find(field => field.id === `${prefix}.reference.fixed`)!;
      expect(fixed).toMatchObject({ value: launch.fixed, step: 1, min: 0, max: 300 });
      expect(fields.find(field => field.id === `${prefix}.reference.angle`)?.value).toBe(launch.angle);
      expect(fields.some(field => field.id === `${prefix}.x`)).toBe(false);
      state.setMoveNumericField('bair', fixed.path, stepCharacterEditorField(fixed, 1));
    }
    const finishBase = fields.find(field => field.id === 'hitWindows.3.collisionHits.0.knockback.reference.base')!;
    state.setMoveNumericField('bair', finishBase.path, stepCharacterEditorField(finishBase, 1));
    const saved = reload(state.getSpec());
    const fighter = construct(saved);
    try {
      const move = fighter.getAttack(LINK_BAIR.id)!;
      const [ground, air] = move.hitWindows![0]!.collisionHits!;
      expect(reference(ground)).toEqual({ ...BAIR_GROUND, fixed: 51 });
      expect(reference(air)).toEqual({ ...BAIR_AIR, fixed: 37 });
      expect(reference(move.hitWindows![3]!.collisionHits![0])).toMatchObject({ ...BAIR_FINISH, base: 46 });
      expect(reference(move.hitWindows![3]!.collisionHits![1])).toMatchObject(BAIR_FINISH);
      const authored = getAuthorableCharacterSpec('link').moves!.bair!;
      expect(reference(authored.hitWindows![0]!.collisionHits![0])).toMatchObject(BAIR_GROUND);
      expect(reference(authored.hitWindows![0]!.collisionHits![1])).toMatchObject(BAIR_AIR);
    } finally {
      fighter.destroy();
    }
  });

  it.each([365, 368])('rejects unsupported special angle %s at the saved aerial launch boundaries', angle => {
    const baseline = serializeCharacterDataSpec(getAuthorableCharacterSpec('link'));
    const locations = [
      { slot: 'fair', path: ['knockback'], label: 'knockback' },
      { slot: 'fair', path: ['hitWindows', '0', 'collisionHits', '0', 'knockback'], label: 'hitWindows[0].collisionHits[0].knockback' },
      { slot: 'bair', path: ['knockback'], label: 'knockback' },
      { slot: 'bair', path: ['hitWindows', '0', 'collisionHits', '1', 'knockback'], label: 'hitWindows[0].collisionHits[1].knockback' },
    ];
    for (const { slot, path, label } of locations) {
      const file = JSON.parse(JSON.stringify(baseline));
      let knockback = file.moves[slot];
      for (const key of path) knockback = knockback[key];
      knockback.reference = { ...knockback.reference, angle };
      expect(() => parseCharacterDataFile(file)).toThrow(`moves.${slot}.${label}.reference.angle`);
    }
  });
});
