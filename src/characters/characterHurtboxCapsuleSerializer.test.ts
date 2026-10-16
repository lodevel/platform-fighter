import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { applyCharacterMoveOverrides, createCharacterById } from './characterFactory';
import { buildCharacterEditorFields } from '../characterBuilder/characterEditorFields';
import { CharacterEditState } from '../characterBuilder/characterEditState';
import { PIKACHU_JAB } from './Pikachu';
import { getMoveBusyFrames, hitboxOverlapsHurtbox, selectActiveHurtboxes, isHurtboxModifierActive, type Hurtbox } from './moveSchema';

const capsule = { start: { x: 30, y: -10 }, end: { x: 40, y: 0 }, radius: 2 };
const hurtbox: Hurtbox = { id: 'authored.posed-limb', offsetX: 0, offsetY: 0, width: 1, height: 1,
  capsule, damageMultiplier: 0.75, intangible: false };
const move = { ...PIKACHU_JAB, hurtboxModifiers: [{ replaceBody: true, hurtbox }] };
const file = () => ({ ...serializeCharacterDataSpec(getAuthorableCharacterSpec('pikachu')), moves: { jab: move } });
const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');

describe('explicit hurtbox capsule authoring/save/factory transport', () => {
  it('round-trips full geometry/flags without changing the legacy rectangle fields', () => {
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(file())));
    const reloaded = parseCharacterDataFile(serializeCharacterDataSpec(loaded));
    expect(reloaded.moves!.jab!.hurtboxModifiers).toEqual(move.hurtboxModifiers);
    expect(reloaded.moves!.jab!.hurtboxModifiers![0]!.hurtbox).toMatchObject({ width: 1, height: 1, capsule });
  });

  it('exposes nested posed endpoints/radius in Lab and preserves edits through save/load', () => {
    const state = new CharacterEditState(parseCharacterDataFile(file()));
    const fields = buildCharacterEditorFields(state.getSpec(), 'move', 'jab');
    expect(fields.find(field => field.id === 'hurtboxModifiers.0.hurtbox.capsule.start.x')?.value).toBe(30);
    expect(fields.find(field => field.id === 'hurtboxModifiers.0.hurtbox.capsule.radius')?.value).toBe(2);
    state.setMoveNumericField('jab', ['hurtboxModifiers', '0', 'hurtbox', 'capsule', 'start', 'x'], 32);
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(state.getSpec()))));
    expect(loaded.moves!.jab!.hurtboxModifiers![0]!.hurtbox.capsule!.start.x).toBe(32);
  });

  it('keeps omitted capsules absent for older rectangular saves', () => {
    const { capsule: _capsule, ...rectangular } = hurtbox;
    const saved = { ...file(), moves: { jab: { ...move, hurtboxModifiers: [{ hurtbox: rectangular }] } } };
    const loaded = parseCharacterDataFile(serializeCharacterDataSpec(parseCharacterDataFile(saved)));
    expect(Object.hasOwn(loaded.moves!.jab!.hurtboxModifiers![0]!.hurtbox, 'capsule')).toBe(false);
  });

  it('rejects malformed points/radii rather than accepting a broad rectangle instead', () => {
    for (const invalid of [null, {}, { ...capsule, radius: 0 }, { ...capsule, radius: -1 },
      { ...capsule, radius: Infinity }, { ...capsule, start: { x: NaN, y: 0 } }, { ...capsule, end: { x: 0 } }]) {
      const saved = { ...file(), moves: { jab: { ...move, hurtboxModifiers: [{ hurtbox: { ...hurtbox, capsule: invalid } }] } } };
      expect(() => parseCharacterDataFile(saved)).toThrow('capsule');
    }
  });

  it.each([1, -1] as const)('transports saved capsule into real-Matter factory Character facing%s and clears it on reset', facing => {
    const engine = Engine.create(); engine.gravity.y = 0;
    const events: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
    const scene: any = { matter: { body: Body, add: {
      rectangle(x: number, y: number, width: number, height: number, options: object) {
        const body = Bodies.rectangle(x, y, width, height, options); Composite.add(engine.world, body); return body;
      },
    }, world: { on(name: string, fn: any) { Events.on(engine, events[name] ?? name, fn); },
      off(name: string, fn: any) { Events.off(engine, events[name] ?? name, fn); },
      remove(body: any) { Composite.remove(engine.world, body); } } } };
    const saved = parseCharacterDataFile(JSON.parse(JSON.stringify(file())));
    const character = createCharacterById(scene, saved.id, { spawnX: 0, spawnY: 0, width: 40, height: 50 });
    applyCharacterMoveOverrides(character, saved); character.setFacing(facing);
    // Pikachu's idle receiving is its reviewed posed body, restored after the move.
    const idle = character.getActiveHurtboxes();
    expect(character.attemptAttack(move.id)).toBe(true);
    expect(character.getActiveHurtboxes()).toEqual([hurtbox]);
    const probe = { offsetX: 35 * facing, offsetY: -5, width: 0.5, height: 0.5 };
    expect(hitboxOverlapsHurtbox({ x: 0, y: 0 }, probe, 1, { x: 0, y: 0 }, hurtbox, facing)).toBe(true);
    expect(hitboxOverlapsHurtbox({ x: 0, y: 0 }, { ...probe, offsetY: 0 }, 1, { x: 0, y: 0 }, hurtbox, facing)).toBe(false);
    character.resetForRound(0, 0);
    expect(character.getActiveHurtboxes()).toEqual(idle);
    expect(character.getActiveHurtboxes()).not.toContainEqual(hurtbox);
    character.destroy(); Engine.clear(engine); Composite.clear(engine.world, false);
  });
});


describe('fixed-frame hurtbox windows', () => {
  const before = { ...hurtbox, id: 'before' };
  const after = { ...hurtbox, id: 'after', capsule: { ...capsule, start: { x: 60, y: -10 }, end: { x: 70, y: 0 } } };
  const timed = { ...PIKACHU_JAB, hurtboxModifiers: [
    { frameWindow: { startFrame: 0, endFrame: 2 }, replaceBody: true, hurtbox: before },
    { frameWindow: { startFrame: 2, endFrame: 5 }, replaceBody: true, hurtbox: after },
  ] };
  const timedFile = () => ({ ...file(), moves: { jab: timed } });

  it('changes at exact half-open boundaries and restores the body outside windows and at completion', () => {
    for (const [frame, expected] of [[0, before], [1, before], [2, after], [3, after], [4, after], [5, hurtbox], [16, hurtbox]] as const)
      expect(selectActiveHurtboxes(hurtbox, timed, frame)).toEqual([expected]);
  });

  it('intersects phase and frame windows, and requires a clock for timed modifiers', () => {
    const modifier = { ...timed.hurtboxModifiers[1]!, phase: 'active' as const };
    expect(isHurtboxModifierActive(modifier, 'active')).toBe(false);
    expect(isHurtboxModifierActive(modifier, 'startup', 4)).toBe(false);
    expect(isHurtboxModifierActive(modifier, 'active', 4)).toBe(true);
    expect(isHurtboxModifierActive(modifier, 'active', 5)).toBe(false);
    expect(isHurtboxModifierActive({ hurtbox }, 'active')).toBe(true);
  });

  it('preserves fixed-step windows through Lab editing and save/load', () => {
    const state = new CharacterEditState(parseCharacterDataFile(timedFile()));
    const fields = buildCharacterEditorFields(state.getSpec(), 'move', 'jab');
    expect(fields.find(field => field.id === 'hurtboxModifiers.0.frameWindow.endFrame')?.value).toBe(2);
    state.setMoveNumericField('jab', ['hurtboxModifiers', '0', 'frameWindow', 'endFrame'], 3);
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(state.getSpec()))));
    expect(loaded.moves!.jab!.hurtboxModifiers![0]!.frameWindow).toEqual({ startFrame: 0, endFrame: 3 });
    expect(loaded.moves!.jab!.hurtboxModifiers![1]).toEqual(timed.hurtboxModifiers[1]);
  });

  it('rejects missing, negative, fractional, empty, reversed and out-of-move intervals', () => {
    for (const frameWindow of [null, {}, { startFrame: 0 }, { startFrame: -1, endFrame: 2 },
      { startFrame: 0.5, endFrame: 2 }, { startFrame: 2, endFrame: 2 }, { startFrame: 3, endFrame: 2 },
      { startFrame: 0, endFrame: getMoveBusyFrames(PIKACHU_JAB) + 1 }, { startFrame: 0, endFrame: Infinity }])
      expect(() => parseCharacterDataFile({ ...file(), moves: { jab: { ...PIKACHU_JAB,
        hurtboxModifiers: [{ hurtbox, frameWindow }] } } })).toThrow('frameWindow');
  });

  it.each([1, -1] as const)('uses the live factory Character clock and freezes/reset geometry facing%s', facing => {
    const engine = Engine.create(); engine.gravity.y = 0;
    const events: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
    const scene: any = { matter: { body: Body, add: {
      rectangle(x: number, y: number, width: number, height: number, options: object) {
        const body = Bodies.rectangle(x, y, width, height, options); Composite.add(engine.world, body); return body;
      },
    }, world: { on(name: string, fn: any) { Events.on(engine, events[name] ?? name, fn); },
      off(name: string, fn: any) { Events.off(engine, events[name] ?? name, fn); },
      remove(body: any) { Composite.remove(engine.world, body); } } } };
    const saved = parseCharacterDataFile(JSON.parse(JSON.stringify(timedFile())));
    const character = createCharacterById(scene, saved.id, { spawnX: 0, spawnY: 0, width: 40, height: 50 });
    applyCharacterMoveOverrides(character, saved); character.setFacing(facing);
    // Pikachu's idle receiving is its reviewed posed body, restored after the move.
    const idle = character.getActiveHurtboxes();
    expect(character.attemptAttack(timed.id)).toBe(true);
    expect(character.getActiveHurtboxes()).toEqual([before]);
    const step = () => character.applyInput({ moveX: 0, moveY: 0, jump: false });
    step(); expect(character.getActiveHurtboxes()).toEqual([before]);
    character.armAttackerHitlag(3);
    for (let i = 0; i < 3; i++) { step(); expect(character.getActiveHurtboxes()).toEqual([before]); }
    step(); expect(character.getActiveHurtboxes()).toEqual([after]);
    const probe = { offsetX: 65 * facing, offsetY: -5, width: 0.5, height: 0.5 };
    expect(hitboxOverlapsHurtbox({ x: 0, y: 0 }, probe, 1, { x: 0, y: 0 }, character.getActiveHurtboxes()[0]!, facing)).toBe(true);
    for (let i = 0; i < 3; i++) step();
    expect(character.getActiveHurtboxes()[0]!.id).toBe('body');
    character.resetForRound(0, 0); expect(character.getActiveHurtboxes()).toEqual(idle);
    character.destroy(); Engine.clear(engine); Composite.clear(engine.world, false);
  });
});
