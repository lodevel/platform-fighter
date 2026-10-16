import { describe, expect, it } from 'vitest';
import type { PlayerSlot } from '../types';
import { InputBindingsStore, buildDefaultGamepadBindings, DEFAULT_KEYBOARD_P1_BINDINGS } from '../input/InputBindingsStore';
import { InputProfileStore } from '../input/InputProfileStore';
import { DeviceInputDispatcher } from '../input/DeviceInputDispatcher';
import { buildMatchParticipants, createMatchBindingsStore } from './matchParticipants';
import { applyControlsProfiles, applyControlsProfilesToRoster } from '../scenes/controlsProfileHandoff';
import { DEFAULT_HAND_CURSOR_STATE, buildPlayerSlotsFromHandCursor } from '../scenes/handCursorState';
import { LOGICAL_ACTIONS, type ActionBindings } from '../types/inputBindings';

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}

describe('named profiles never determine sparse fighter ownership', () => {
  it.each([false, true])('keeps arrow P2 and one controller at P3 with P1 CPU=%s despite old device-selector profiles', cpu => {
    const legacy = new InputBindingsStore();
    legacy.set(2, { playerIndex: 2, bindings: buildDefaultGamepadBindings(0) });
    legacy.set(3, { playerIndex: 3, bindings: DEFAULT_KEYBOARD_P1_BINDINGS });
    const profiles = new InputProfileStore(legacy, null);
    const original = legacy.snapshot();
    const players: PlayerSlot[] = [
      ...(cpu ? [{ index: 1 as const, characterId: 'donkeykong' as const, paletteIndex: 0, inputType: 'ai' as const }] : []),
      { index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2', bindingProfileId: 'keyboard-arrows' },
      { index: 3, characterId: 'link', paletteIndex: 2, inputType: 'gamepad', bindingProfileId: 'gamepad-standard',
        inputDevice: { kind: 'gamepad', gamepadIndex: 0 } },
    ];
    const initial = buildMatchParticipants(players, legacy, profiles);
    let key = 39;
    let axis = 0;
    for (const participants of [initial, buildMatchParticipants(initial.map(value => value.slot), legacy, profiles)]) {
      const dispatch = new DeviceInputDispatcher({ bindings: createMatchBindingsStore(participants),
        keyboard: { isDown: code => code === key },
        gamepad: { isConnected: index => index === 0, getAxis: (_index, index) => index === 0 ? axis : 0,
          getButton: () => ({ pressed: false, value: 0 }) },
      });
      const keyboard = participants.find(value => value.slot.index === 2)!;
      const controller = participants.find(value => value.slot.index === 3)!;
      const keyboardSlot = (keyboard.runtimePlayerIndex + 1) as 1 | 2 | 3 | 4;
      const controllerSlot = (controller.runtimePlayerIndex + 1) as 1 | 2 | 3 | 4;
      expect(keyboard.slot).toMatchObject({ index: 2, paletteIndex: 1, inputDevice: { kind: 'keyboard', layout: 'keyboard_p2' } });
      expect(controller.slot).toMatchObject({ index: 3, paletteIndex: 2, inputDevice: { kind: 'gamepad', gamepadIndex: 0 } });
      key = 39; axis = 0;
      expect([dispatch.sampleMoveX(keyboardSlot), dispatch.sampleMoveX(controllerSlot)]).toEqual([1, 0]);
      key = -1; axis = -0.75;
      expect([dispatch.sampleMoveX(keyboardSlot), dispatch.sampleMoveX(controllerSlot)]).toEqual([0, -0.75]);
      if (cpu) expect(Object.values(dispatch.sampleActions(1)).every(value => !value)).toBe(true);
    }
    expect(legacy.snapshot()).toEqual(original);
    expect(profiles.list().some(profile => profile.id === 'custom-imported-2-gamepad')).toBe(true);
  });

  it('shares one custom profile on different controllers without retaining its old physical pad index', () => {
    const legacy = new InputBindingsStore();
    const profiles = new InputProfileStore(legacy, memoryStorage());
    const created = profiles.create('gamepad-standard', { ...buildDefaultGamepadBindings(7),
      attack: [{ kind: 'gamepad', gamepadIndex: 7, source: { type: 'button', buttonIndex: 6 } }],
    }, 'Both players use this');
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);
    const players: PlayerSlot[] = [2, 3].map((index, pad) => ({ index: index as 2 | 3,
      characterId: 'link', paletteIndex: index - 1, inputType: 'gamepad', bindingProfileId: created.profileId,
      inputDevice: { kind: 'gamepad', gamepadIndex: pad },
    }));
    const participants = buildMatchParticipants(players, legacy, profiles);
    expect(participants.map(value => value.bindings?.bindings.attack)).toEqual([
      [{ kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 6 } }],
      [{ kind: 'gamepad', gamepadIndex: 1, source: { type: 'button', buttonIndex: 6 } }],
    ]);
    expect(profiles.get(created.profileId)?.bindings.attack[0]).toMatchObject({ gamepadIndex: null });
    let activePad = 0;
    const dispatch = new DeviceInputDispatcher({ bindings: createMatchBindingsStore(participants),
      keyboard: { isDown: () => false }, gamepad: { isConnected: index => index === 0 || index === 1,
        getAxis: () => 0, getButton: (index, button) => ({ pressed: index === activePad && button === 6, value: 1 }) },
    });
    expect([dispatch.isActionHeld(1, 'attack'), dispatch.isActionHeld(2, 'attack')]).toEqual([true, false]);
    activePad = 1;
    expect([dispatch.isActionHeld(1, 'attack'), dispatch.isActionHeld(2, 'attack')]).toEqual([false, true]);
  });

  it.each(['missing-profile', 'gamepad-standard'])('falls back to arrows for incompatible selected profile %s without reassigning P2', bindingProfileId => {
    const legacy = new InputBindingsStore();
    const profiles = new InputProfileStore(legacy, null);
    const result = buildMatchParticipants([{ index: 2, characterId: 'link', paletteIndex: 1,
      inputType: 'keyboard_p2', bindingProfileId }], legacy, profiles)[0]!;
    expect(result.slot).toMatchObject({ index: 2, bindingProfileId: 'keyboard-arrows',
      inputDevice: { kind: 'keyboard', layout: 'keyboard_p2' } });
    expect(result.bindings?.bindings.right).toEqual([{ kind: 'keyboard', keyCode: 39 }]);
  });

  it('preserves a named profile whose actions were deliberately all unbound', () => {
    const legacy = new InputBindingsStore();
    const profiles = new InputProfileStore(legacy, memoryStorage());
    const empty = Object.fromEntries(LOGICAL_ACTIONS.map(action => [action, []])) as unknown as ActionBindings;
    const created = profiles.create('keyboard-arrows', empty, 'No keyboard actions');
    if (!created.ok) throw new Error(created.error);
    const result = buildMatchParticipants([{ index: 2, characterId: 'link', paletteIndex: 1,
      inputType: 'keyboard_p2', bindingProfileId: created.profileId }], legacy, profiles)[0]!;
    expect(result.bindings?.bindings).toEqual(empty);
    expect(result.slot.inputDevice).toEqual({ kind: 'keyboard', layout: 'keyboard_p2' });
  });

  it('applies a sparse P3 profile to the original roster slot and forwards it without changing picks or hardware', () => {
    const state = { slots: DEFAULT_HAND_CURSOR_STATE.slots.map(slot => ({ ...slot,
      mode: slot.index === 2 || slot.index === 3 ? 'human' as const : 'empty' as const,
      pickedCharacterId: 'link' as const, paletteIndex: slot.index - 1,
    })) };
    const updated = applyControlsProfilesToRoster(state, [{ index: 3, bindingProfileId: 'custom-pad' }]);
    expect(updated.slots[1]).toBe(state.slots[1]);
    expect(updated.slots[2]).toEqual({ ...state.slots[2], bindingProfileId: 'custom-pad' });
    const players = buildPlayerSlotsFromHandCursor(updated);
    expect(players.map(player => [player.index, player.paletteIndex, player.bindingProfileId]))
      .toEqual([[2, 1, undefined], [3, 2, 'custom-pad']]);
    const owned = players.map(player => ({ ...player, inputDevice: player.index === 2
      ? { kind: 'keyboard' as const, layout: 'keyboard_p2' as const }
      : { kind: 'gamepad' as const, gamepadIndex: 0 } }));
    const applied = applyControlsProfiles(owned, [{ index: 3, bindingProfileId: 'gamepad-standard' }]);
    expect(applied[0]).toBe(owned[0]);
    expect(applied[1]).toEqual({ ...owned[1], bindingProfileId: 'gamepad-standard' });
  });
});
