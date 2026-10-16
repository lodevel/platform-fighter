import { describe, expect, it, vi } from 'vitest';
import { CHARACTER_IDS } from '../types';
import { DEFAULT_AUTHORABLE_CHARACTER_ID, getAuthorableCharacterSpec, listAuthorableCharacterSpecs } from './authorableCharacterRegistry';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import * as Link from './Link';
import * as Pikachu from './Pikachu';
import * as DonkeyKong from './DonkeyKong';
import { Character } from './Character';
import { applyCharacterMoveOverrides, createCharacterById } from './characterFactory';

function createScene(): any {
  return { matter: {
    add: { rectangle: (x: number, y: number, _w: number, _h: number, options: object) => ({
      position: { x, y }, velocity: { x: 0, y: 0 }, ...options,
    }) },
    body: { setInertia: vi.fn(), setVelocity: vi.fn(), setPosition: vi.fn() },
    world: { on: vi.fn(), off: vi.fn(), remove: vi.fn() },
  } };
}

const jsonValue=(v:unknown)=>v===undefined?v:JSON.parse(JSON.stringify(v));

const KITS = [{ id: 'link', exports: Link }, { id: 'pikachu', exports: Pikachu }, { id: 'donkeykong', exports: DonkeyKong }] as const;

describe('authorable character registry', () => {
  it('offers every playable identity once and defaults to Link', () => {
    expect(listAuthorableCharacterSpecs().map(spec => spec.id)).toEqual(CHARACTER_IDS);
    expect(DEFAULT_AUTHORABLE_CHARACTER_ID).toBe('link');
  });

  it.each(CHARACTER_IDS)('validates and round-trips the %s spec', id => {
    const spec = getAuthorableCharacterSpec(id);
    expect(parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))))).toEqual(jsonValue(spec));
  });

  it.each(CHARACTER_IDS)('an untouched %s draft preserves the actual constructor kit, dispatch and tuning', id => {
    const scene = createScene();
    const registration = vi.spyOn(Character.prototype, 'addAttack');
    const tauntRegistration = vi.spyOn(Character.prototype, 'setTauntSpec');
    const baseline = createCharacterById(scene, id, { spawnX: 0, spawnY: 0 });
    // Observe actual constructor registrations, including imported extended
    // moves and excluding unused exported alternatives with the same ID.
    const liveMoves = new Map(registration.mock.calls.map(([move]) => [move.id, move]));
    const constructorTaunts = tauntRegistration.mock.calls.at(-1)?.[0];
    registration.mockRestore();
    tauntRegistration.mockRestore();
    const spec = parseCharacterDataFile(JSON.parse(JSON.stringify(
      serializeCharacterDataSpec(getAuthorableCharacterSpec(id)),
    )));
    const persistedMoves = Object.entries(spec.moves!).filter(([slot])=>slot!=='taunts'&&slot!=='grab').map(([,move])=>move);
    expect(jsonValue(spec.moves?.taunts)).toEqual(jsonValue(constructorTaunts));
    expect(persistedMoves.map(move => move!.id).sort()).toEqual([...liveMoves.keys()].sort());
    const saved = createCharacterById(scene, id, { spawnX: 0, spawnY: 0, ...spec.body, ...spec.movement });
    applyCharacterMoveOverrides(saved, spec);
    expect(saved.getTuning()).toEqual(baseline.getTuning());
    expect(saved.getGrabSpec()).toEqual(baseline.getGrabSpec());
    for (const [moveId, live] of liveMoves) {
      expect(JSON.parse(JSON.stringify(saved.getAttack(moveId))), moveId).toEqual(JSON.parse(JSON.stringify(live)));
    }
    for (const getter of [
      'getDefaultAttackId', 'getLightAttackId', 'getHeavyAttackId', 'getTiltAttackId',
      'getAerialNeutralId', 'getAerialForwardId', 'getAerialBackId', 'getAerialUpId', 'getAerialDownId',
      'getUpTiltId', 'getUpSmashId', 'getDownTiltId', 'getDownSmashId', 'getDashAttackId',
      'getNeutralSpecialId', 'getUpSpecialId', 'getDownSpecialId',
    ] as const) {
      expect(saved[getter](), getter).toEqual(baseline[getter]());
    }
    baseline.destroy();
    saved.destroy();
  });

  it.each(KITS)('preserves every compiled $id move including chains, animation, and special families', kit => {
    const spec = getAuthorableCharacterSpec(kit.id);
    const persisted = JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))).moves;
    // Derive expectations independently from all exported move declarations,
    // so omitting a newly registered move from the bridge fails visibly.
    const compiled = (Object.values(kit.exports) as unknown[]).filter((value): value is { id: string } =>
      typeof value === 'object' && value !== null && 'id' in value &&
      typeof value.id === 'string' && value.id.startsWith(`${kit.id}.`));
    expect(Object.entries(persisted).filter(([slot])=>slot!=='taunts')).toHaveLength(compiled.length);
    const exports=kit.exports as Readonly<Record<string,unknown>>;
    expect(persisted.taunts).toEqual(jsonValue(exports[`${kit.id.toUpperCase()}_TAUNTS`]));
    for (const move of compiled) {
      const stored = Object.values(persisted).find((entry: any) => entry.id === move.id);
      expect(stored, move.id).toEqual(JSON.parse(JSON.stringify(move)));
    }
  });

  it.each([
    { id: 'link', path: ['moves', 'grab', 'dashGrab', 'momentumRetain'], value: 2 },
    { id: 'link', path: ['moves', 'downSpecial', 'trap', 'fuseDetonateFrames'], value: -1 },
    { id: 'link', path: ['moves', 'downSpecial', 'trap', 'selfBounceVelocity'], value: 'high' },
    { id: 'donkeykong', path: ['moves', 'upSpecial', 'multiHitRising', 'hitCount'], value: 'many' },
  ] as const)('rejects invalid preserved family data at $path', ({ id, path, value }) => {
    const raw = JSON.parse(JSON.stringify(serializeCharacterDataSpec(getAuthorableCharacterSpec(id))));
    let target = raw;
    for (const key of path.slice(0, -1)) target = target[key];
    target[path[path.length - 1]!] = value;
    expect(() => parseCharacterDataFile(raw)).toThrow();
  });
});
