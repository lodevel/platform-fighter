/**
 * `attackMoveToSheets` — ordered per-move sheet candidates. Dedicated
 * directional / dash normals and special variants come first; the shared
 * sheet `attackMoveToSheet` already returned always closes the list so a
 * fighter without the specific strip keeps its art.
 */
import { describe, expect, it } from 'vitest';
import { attackMoveToSheets, attackMoveToSheet, getMoveAnimKey } from './spriteAnimationDriver';

describe('attackMoveToSheets', () => {
  it('returns the shared sheet alone for plain moves', () => {
    expect(attackMoveToSheets({ type: 'tilt', id: 'link.tilt' })).toEqual(['tilt']);
    expect(attackMoveToSheets({ type: 'aerial', aerialDirection: 'back', id: 'link.bair' })).toEqual(['bair']);
    expect(attackMoveToSheets(null)).toEqual([]);
  });

  it('prefers utilt / dash_attack / usmash / dsmash before the shared tilt or smash sheet', () => {
    expect(attackMoveToSheets({ type: 'tilt', id: 'donkeykong.utilt' })).toEqual(['utilt', 'tilt']);
    expect(attackMoveToSheets({ type: 'tilt', id: 'donkeykong.dashAttack' })).toEqual(['dash_attack', 'tilt']);
    expect(attackMoveToSheets({ type: 'smash', id: 'donkeykong.usmash' })).toEqual(['usmash', 'smash']);
    expect(attackMoveToSheets({ type: 'smash', id: 'donkeykong.dsmash' })).toEqual(['dsmash', 'smash']);
    expect(attackMoveToSheets({ type: 'tilt', id: 'donkeykong.dtilt' })).toEqual(['dtilt']);
  });

  it('adds the airborne / grounded variant sheet before its base when the runtime tagged the move', () => {
    expect(attackMoveToSheets({ type: 'downSpecial', id: 'donkeykong.down_special', sheetVariant: 'air' }))
      .toEqual(['down_special_air', 'down_special']);
    expect(attackMoveToSheets({ type: 'upSpecial', id: 'donkeykong.up_special', sheetVariant: 'ground' }))
      .toEqual(['up_special_ground', 'up_special']);
    expect(attackMoveToSheets({ type: 'upSpecial', id: 'link.up_special', sheetVariant: 'ground' })[1]).toBe('up_special');
  });

  it('routes source-named normals and nested aerial landing attacks to their own strips', () => {
    expect(attackMoveToSheets({ type: 'tilt', id: 'pikachu.up-tilt' })).toEqual(['utilt', 'tilt']);
    expect(attackMoveToSheets({ type: 'tilt', id: 'pikachu.down-tilt' })).toEqual(['dtilt']);
    expect(attackMoveToSheets({ type: 'tilt', id: 'pikachu.dash-attack' })).toEqual(['dash_attack', 'tilt']);
    expect(attackMoveToSheets({ type: 'tilt', id: 'pikachu.forward-tilt-up' })).toEqual(['tilt_up', 'tilt']);
    expect(attackMoveToSheets({ type: 'tilt', id: 'pikachu.forward-tilt-down' })).toEqual(['tilt_down', 'tilt']);
    expect(attackMoveToSheets({ type: 'smash', id: 'pikachu.up-smash' })).toEqual(['usmash', 'smash']);
    expect(attackMoveToSheets({ type: 'smash', id: 'pikachu.down-smash' })).toEqual(['dsmash', 'smash']);
    expect(attackMoveToSheets({ type: 'tilt', id: 'pikachu.back-air-landing' })).toEqual(['bair_landing', 'tilt']);
    expect(attackMoveToSheets({ type: 'tilt', id: 'pikachu.down-air-landing' })).toEqual(['dair_landing', 'tilt']);
    expect(attackMoveToSheets({ type: 'downSpecial', id: 'pikachu.down_special', sheetVariant: 'ground-hit' }))
      .toEqual(['down_special_hit', 'down_special']);
    expect(attackMoveToSheets({ type: 'downSpecial', id: 'pikachu.down_special', sheetVariant: 'air-hit' }))
      .toEqual(['down_special_air_hit', 'down_special']);
  });

  it('the first candidate always agrees with the legacy single-sheet mapping when nothing specific applies', () => {
    for (const move of [
      { type: 'jab', id: 'donkeykong.jab2' }, { type: 'special', id: 'pikachu.neutral_special' },
      { type: 'aerial', aerialDirection: 'down', id: 'link.dair' },
    ]) {
      expect(attackMoveToSheets(move)[0]).toBe(attackMoveToSheet(move));
    }
  });

  it('Donkey Kong resolves anim keys for the new dedicated sheets; each fighter resolves only its own sheets', () => {
    expect(getMoveAnimKey('donkeykong', 'utilt')).toBe('donkeykong.utilt.anim');
    expect(getMoveAnimKey('donkeykong', 'up_special_ground')).toBe('donkeykong.up_special_ground.anim');
    expect(getMoveAnimKey('link', 'utilt')).toBe('link.utilt.anim');
    expect(getMoveAnimKey('pikachu', 'up_special_ground')).toBeNull();
  });
});
