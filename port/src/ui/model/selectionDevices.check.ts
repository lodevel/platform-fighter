import { describe, expect, it } from 'vitest';
import { DEFAULT_HAND_CURSOR_STATE, type HandCursorState } from '../../../../src/scenes/handCursorState';
import type { PlayerSlot } from '../../../../src/types';
import { restoreSelectionHand, restoreSelectionOwners } from './selectionDevices';

const players: PlayerSlot[] = [
  { index: 1, characterId: 'donkeykong', inputType: 'keyboard_p1', paletteIndex: 3,
    inputDevice: { kind: 'keyboard', layout: 'keyboard_p1' }, bindingProfileId: 'custom-1' },
  { index: 2, characterId: 'pikachu', inputType: 'gamepad', paletteIndex: 5,
    inputDevice: { kind: 'gamepad', gamepadIndex: 0 }, bindingProfileId: 'custom-2' },
  { index: 3, characterId: 'link', inputType: 'gamepad', paletteIndex: 7,
    inputDevice: { kind: 'gamepad', gamepadIndex: 2 }, bindingProfileId: 'custom-3' },
];

describe('returning character-selection device ownership', () => {
  it('restores every participant to the original card before another A press', () => {
    const hand = restoreSelectionHand(undefined, players);
    expect(restoreSelectionOwners(hand, players, [], [{ index: 0, id: 'first' }, { index: 2, id: 'second' }]))
      .toEqual([{ device: 'pad0', slot: 2, padId: 'first' }, { device: 'pad2', slot: 3, padId: 'second' }, { device: 'keyboard', slot: 1 }]);
    expect(hand.slots.map(slot => [slot.mode, slot.pickedCharacterId, slot.paletteIndex, slot.bindingProfileId]))
      .toEqual([['human', 'donkeykong', 3, 'custom-1'], ['human', 'pikachu', 5, 'custom-2'],
        ['human', 'link', 7, 'custom-3'], ['empty', null, 3, undefined]]);
  });

  it('uses the live match reconnect index rather than the previous selection index', () => {
    const rebound = players.map(player => player.index === 2 ? { ...player, inputDevice: { kind: 'gamepad' as const, gamepadIndex: 4 } } : player);
    const owners = restoreSelectionOwners(restoreSelectionHand(undefined, rebound), rebound,
      [{ device: 'pad0', slot: 2, padId: 'first' }], [{ index: 4, id: 'first' }, { index: 2, id: 'second' }]);
    expect(owners.find(owner => owner.slot === 2)).toEqual({ device: 'pad4', slot: 2, padId: 'first' });
    expect(owners.some(owner => owner.device === 'pad0')).toBe(false);
  });

  it('preserves the active keyboard card instead of falling back to the first keyboard player', () => {
    const bothKeyboards: PlayerSlot[] = [players[0]!, { ...players[1]!, inputType: 'keyboard_p2',
      inputDevice: { kind: 'keyboard', layout: 'keyboard_p2' } }];
    const hand = restoreSelectionHand(undefined, bothKeyboards);
    expect(restoreSelectionOwners(hand, bothKeyboards, [{ device: 'keyboard', slot: 2 }]))
      .toEqual([{ device: 'keyboard', slot: 2 }]);
  });

  it('retains hand positions and updated match profiles independently of physical ownership', () => {
    const saved: HandCursorState = { slots: restoreSelectionHand(undefined, players).slots.map(slot => ({ ...slot, cursor: { x: 123, y: 456 } })) };
    const hand = restoreSelectionHand(saved, players.map(player => ({ ...player, bindingProfileId: 'custom-new' })));
    expect(hand.slots[1]!.cursor).toEqual({ x: 123, y: 456 });
    expect(hand.slots[1]!.bindingProfileId).toBe('custom-new');
    expect(hand.slots[1]!.paletteIndex).toBe(5);
  });

  it('does not assign a saved device to a CPU, empty card, or another device-owned card', () => {
    const hand = restoreSelectionHand(undefined, players);
    expect(restoreSelectionOwners(hand, players, [
      { device: 'pad8', slot: 2 }, { device: 'pad9', slot: 4 }, { device: 'keyboard', slot: 3 },
    ]).map(owner => [owner.device, owner.slot])).toEqual([['pad0', 2], ['pad2', 3], ['keyboard', 1]]);
    expect(restoreSelectionOwners(DEFAULT_HAND_CURSOR_STATE, [], [{ device: 'pad0', slot: 1 }])).toEqual([]);
  });

  it('can restore selection-only owners at their pad identity after index changes', () => {
    const hand = restoreSelectionHand(undefined, players);
    expect(restoreSelectionOwners(hand, [], [{ device: 'pad0', slot: 2, padId: 'first' }], [{ index: 6, id: 'first' }]))
      .toContainEqual({ device: 'pad6', slot: 2, padId: 'first' });
  });

  it('keeps identical-model controllers separate instead of matching both to the first id', () => {
    const hand = restoreSelectionHand(undefined, players);
    expect(restoreSelectionOwners(hand, [], [{ device: 'pad0', slot: 2, padId: 'same model' },
      { device: 'pad2', slot: 3, padId: 'same model' }], [{ index: 0, id: 'same model' }, { index: 2, id: 'same model' }]))
      .toEqual([{ device: 'pad0', slot: 2, padId: 'same model' }, { device: 'pad2', slot: 3, padId: 'same model' }, { device: 'keyboard', slot: 1 }]);
  });
});
