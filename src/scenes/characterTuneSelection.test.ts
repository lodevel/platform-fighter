import { describe, expect, it } from 'vitest';
import type { CharacterRecord } from '../characterBuilder/characterStorage';
import { parseCharacterDataFile, serializeCharacterDataSpec } from '../characters/characterSerializer';
import { getAuthorableCharacterSpec } from '../characters/authorableCharacterRegistry';
import {
  DEFAULT_HAND_CURSOR_STATE, buildPlayerSlotsFromHandCursor,
  selectAtCursor, setHoveredTarget, setSlotInputType, setSlotMode, setSlotPalette, unselectSlot,
} from './handCursorState';
import { compatibleCharacterTunes, cycleCharacterTune, reconcileCharacterTunes } from './characterTuneSelection';

const dkData = serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong'));

function tune(slotId: string, maxRunSpeed = 9): CharacterRecord {
  return { slotId, schemaVersion: 2, savedAtMs: 1,
    spec: parseCharacterDataFile({ ...dkData,
      movement: { ...dkData.movement, maxRunSpeed } }, slotId) };
}

function lobby() {
  return setSlotMode(setSlotMode(DEFAULT_HAND_CURSOR_STATE, 1, 'human'), 3, 'bot');
}

describe('saved character tune selection', () => {
  it('cycles base -> compatible saves -> base, in either direction', () => {
    const initial = lobby();
    const records = [tune('quick'), tune('heavy', 6)];
    const quick = cycleCharacterTune(initial, 1, records);
    expect(quick.slots[0]?.customCharacter?.slotId).toBe('quick');
    const heavy = cycleCharacterTune(quick, 1, records);
    expect(heavy.slots[0]?.customCharacter?.slotId).toBe('heavy');
    expect(cycleCharacterTune(heavy, 1, records).slots[0]?.customCharacter).toBeUndefined();
    expect(cycleCharacterTune(initial, 1, records, -1).slots[0]?.customCharacter?.slotId).toBe('heavy');
    expect(initial.slots[0]?.customCharacter).toBeUndefined();
  });

  it('filters other fighters and duplicate storage IDs without reordering saves', () => {
    const record = tune('quick');
    const pikachu = { ...tune('pikachu-save'), spec: { ...record.spec, id: 'pikachu' as const } };
    expect(compatibleCharacterTunes('donkeykong', [pikachu, record, record, tune('heavy')]).map((r) => r.slotId))
      .toEqual(['quick', 'heavy']);
    expect(cycleCharacterTune(lobby(), 2, [record])).toEqual(lobby());
  });

  it('retains base identity, palette, sparse lobby index and device while carrying the full snapshot', () => {
    const base = setSlotPalette(setSlotInputType(lobby(), 1, 'gamepad'), 1, 5);
    const selected = cycleCharacterTune(base, 1, [tune('quick')]);
    expect(selected.slots[0]).toMatchObject({ index: 1, pickedCharacterId: 'donkeykong', paletteIndex: 5, inputType: 'gamepad' });
    const players = buildPlayerSlotsFromHandCursor(selected);
    expect(players.map((player) => player.index)).toEqual([1, 3]);
    expect(players[0]).toMatchObject({ index: 1, characterId: 'donkeykong', paletteIndex: 5, inputType: 'gamepad',
      customCharacter: { slotId: 'quick', spec: { movement: { maxRunSpeed: 9 } } } });
    expect(players[1]?.customCharacter).toBeUndefined();
  });

  it('clears tunes on fighter change or leave, while palette and device changes preserve them', () => {
    const selected = cycleCharacterTune(lobby(), 1, [tune('quick')]);
    const repainted = reconcileCharacterTunes(setSlotPalette(setSlotInputType(selected, 1, 'keyboard_p2'), 1, 6));
    expect(repainted.slots[0]?.customCharacter).toBe(selected.slots[0]?.customCharacter);
    const pikachu = selectAtCursor(setHoveredTarget(selected, 1, { kind: 'portrait', portraitIndex: 1 }), 1);
    expect(reconcileCharacterTunes(pikachu).slots[0]?.customCharacter).toBeUndefined();
    expect(buildPlayerSlotsFromHandCursor(pikachu)[0]?.customCharacter).toBeUndefined();
    expect(reconcileCharacterTunes(unselectSlot(selected, 1)).slots[0]?.customCharacter).toBeUndefined();
    expect(setSlotMode(unselectSlot(selected, 1), 1, 'human').slots[0]?.customCharacter).toBeUndefined();
  });

  it('copies and freezes nested data at selection time and does not refresh it from edited storage', () => {
    const mutable = JSON.parse(JSON.stringify(tune('quick'))) as CharacterRecord;
    const selected = cycleCharacterTune(lobby(), 1, [mutable]);
    const snapshot = selected.slots[0]!.customCharacter!;
    (mutable.spec.movement as { maxRunSpeed: number }).maxRunSpeed = 4;
    (mutable.spec.moves!.jab!.hitbox as { width: number }).width = 99;
    expect(snapshot.spec.movement.maxRunSpeed).toBe(9);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.spec.movement)).toBe(true);
    expect(snapshot.spec.moves?.jab?.hitbox.width).not.toBe(99);
    expect(Object.isFrozen(snapshot.spec.moves?.jab?.hitbox)).toBe(true);
    expect(Object.isFrozen(snapshot.spec.moves?.jab?.knockback)).toBe(true);
    expect(reconcileCharacterTunes(selected)).toBe(selected);
    expect(buildPlayerSlotsFromHandCursor(selected)[0]?.customCharacter).toBe(snapshot);
  });

  it('keeps a deleted tune playable until explicitly cycling back to base', () => {
    const selected = cycleCharacterTune(lobby(), 1, [tune('quick')]);
    expect(reconcileCharacterTunes(selected).slots[0]?.customCharacter?.slotId).toBe('quick');
    expect(cycleCharacterTune(selected, 1, []).slots[0]?.customCharacter).toBeUndefined();
    expect(cycleCharacterTune(lobby(), 1, [])).toEqual(lobby());
  });
});
