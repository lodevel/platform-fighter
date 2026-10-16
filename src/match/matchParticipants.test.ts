import { describe, expect, it } from 'vitest';
import type { PlayerSlot } from '../types';
import { InputBindingsStore, buildDefaultGamepadBindings } from '../input/InputBindingsStore';
import { DeviceInputDispatcher } from '../input/DeviceInputDispatcher';
import { findSlotsBoundToGamepad } from '../input/GamepadConnectionMonitor';
import { KEY_CODE } from '../input/keyCodes';
import type { PlayerBindingsIndex } from '../types/inputBindings';
import { buildMatchParticipants, createMatchBindingsStore } from './matchParticipants';

const fighter = (index: 1 | 2 | 3 | 4, inputType: PlayerSlot['inputType']): PlayerSlot => ({
  index, inputType, characterId: index === 1 ? 'link' : 'pikachu', paletteIndex: index - 1,
});
const pad = (index: 1 | 2 | 3 | 4, gamepadIndex: number): PlayerSlot => ({
  ...fighter(index, 'gamepad'), inputDevice: { kind: 'gamepad', gamepadIndex },
});

describe('match participant ownership', () => {
  it.each([
    { name: 'P1 CPU and P2 human', players: [fighter(1, 'ai'), fighter(2, 'keyboard_p2')], humanRuntimeSlot: 2 },
    { name: 'sparse reordered CPU slots before P2', players: [fighter(1, 'ai'), fighter(4, 'ai'), fighter(2, 'keyboard_p2')], humanRuntimeSlot: 3 },
    { name: 'P2 at the first runtime index', players: [fighter(2, 'keyboard_p2'), fighter(1, 'ai'), fighter(4, 'ai')], humanRuntimeSlot: 1 },
  ])('keeps P2 controls through rebind and restart with $name', ({ players, humanRuntimeSlot }) => {
    const preferences = new InputBindingsStore();
    const customP1Attack = 81; // Q
    const customP2Attack = 77; // M
    // A custom P1 mapping must remain as isolated as its default keyboard keys.
    preferences.setAction(1, 'attack', [{ kind: 'keyboard', keyCode: customP1Attack }]);
    const originalP1Profile = preferences.get(1);
    const participants = buildMatchParticipants(players, preferences);
    const human = participants.find(participant => participant.slot.index === 2)!;
    expect(human.runtimePlayerIndex + 1).toBe(humanRuntimeSlot);
    expect(human.slot).toMatchObject({ inputDevice: { kind: 'keyboard', layout: 'keyboard_p2' }, bindingProfileIndex: 2 });
    const session = createMatchBindingsStore(participants);
    let pressed = new Set<number>();
    const dispatch = (bindings: InputBindingsStore) => new DeviceInputDispatcher({ bindings,
      keyboard: { isDown: keyCode => pressed.has(keyCode) },
      gamepad: { isConnected: () => false, getAxis: () => 0, getButton: () => ({ pressed: false, value: 0 }) },
    });
    const live = dispatch(session);
    const slot = humanRuntimeSlot as PlayerBindingsIndex;
    const assertP1KeysAreIsolated = (dispatcher: DeviceInputDispatcher) => {
      for (const key of [KEY_CODE.A, KEY_CODE.D, KEY_CODE.W, KEY_CODE.S, KEY_CODE.F, KEY_CODE.G, KEY_CODE.H, KEY_CODE.T, KEY_CODE.R, customP1Attack]) {
        pressed = new Set([key]);
        expect(Object.values(dispatcher.sampleActions(slot)).every(value => !value), `P1 key ${key}`).toBe(true);
      }
    };
    assertP1KeysAreIsolated(live);
    pressed = new Set([KEY_CODE.ARROW_RIGHT, KEY_CODE.NUMPAD_1]);
    expect(live.sampleCharacterInput(slot)).toMatchObject({ moveX: 1, attack: true });
    for (const participant of participants.filter(participant => participant.slot.inputType === 'ai')) {
      expect(Object.values(live.sampleActions((participant.runtimePlayerIndex + 1) as PlayerBindingsIndex)).every(value => !value)).toBe(true);
    }

    // Controls writes the original profile. WAKE refreshes the same live
    // projected store; changing runtime order must not redirect that write.
    const launchPlayers = participants.map(participant => participant.slot);
    preferences.setAction(2, 'attack', [{ kind: 'keyboard', keyCode: customP2Attack }]);
    const resumed = buildMatchParticipants(launchPlayers, preferences);
    const refreshed = createMatchBindingsStore(resumed);
    for (const participant of resumed) {
      const runtimeSlot = (participant.runtimePlayerIndex + 1) as PlayerBindingsIndex;
      session.set(runtimeSlot, refreshed.get(runtimeSlot));
    }
    const restarted = dispatch(createMatchBindingsStore(buildMatchParticipants(launchPlayers, preferences)));
    for (const dispatcher of [live, restarted]) {
      assertP1KeysAreIsolated(dispatcher);
      pressed = new Set([KEY_CODE.NUMPAD_1]);
      expect(dispatcher.sampleCharacterInput(slot).attack).toBe(false);
      pressed = new Set([customP2Attack, KEY_CODE.ARROW_LEFT]);
      expect(dispatcher.sampleCharacterInput(slot)).toMatchObject({ moveX: -1, attack: true });
    }
    expect(preferences.get(1)).toEqual(originalP1Profile);
    expect(resumed.find(participant => participant.slot.index === 2)?.slot.bindingProfileIndex).toBe(2);
  });

  it('keeps sparse slots, fighter choices and identity while compacting only runtime indices', () => {
    const players = [fighter(1, 'keyboard_p1'), fighter(3, 'keyboard_p2')];
    const participants = buildMatchParticipants(players, new InputBindingsStore());
    expect(participants.map((p) => [p.slot.index, p.slot.characterId, p.participantId, p.runtimePlayerIndex]))
      .toEqual([[1, 'link', 'player-1', 0], [3, 'pikachu', 'player-3', 1]]);
    expect(participants[1]?.bindings?.playerIndex).toBe(2);
    expect(participants[1]?.bindings?.bindings.left).toEqual([{ kind: 'keyboard', keyCode: 37 }]);
  });

  it.each([2, 3, 4])('routes %i physical pads to their joined fighters, including non-default pad indices', (count) => {
    const players = Array.from({ length: count }, (_, i) => pad((i + 1) as 1 | 2 | 3 | 4, i + 5));
    const preferences = new InputBindingsStore();
    const before = preferences.snapshot();
    const session = createMatchBindingsStore(buildMatchParticipants(players, preferences));
    let activePad = 5;
    const dispatcher = new DeviceInputDispatcher({
      bindings: session,
      keyboard: { isDown: () => false },
      gamepad: {
        isConnected: () => true,
        getAxis: (index, axis) => index === activePad && axis === 0 ? 1 : 0,
        getButton: (index, button) => ({ pressed: index === activePad && button === 2, value: 1 }),
      },
    });
    for (let i = 0; i < count; i++) {
      activePad = i + 5;
      for (let j = 0; j < count; j++) {
        const sample = dispatcher.sampleCharacterInput((j + 1) as 1 | 2 | 3 | 4);
        expect(sample.moveX).toBe(i === j ? 1 : 0);
        expect(sample.attack).toBe(i === j);
      }
    }
    expect(preferences.snapshot()).toEqual(before);
  });

  it('supports a pad versus CPU, mixed keyboard/pad and mirror-match lineups', () => {
    const preferences = new InputBindingsStore();
    for (const players of [
      [pad(1, 0), fighter(4, 'ai')],
      [fighter(2, 'keyboard_p1'), pad(3, 2), fighter(4, 'ai')],
      [pad(1, 0), { ...pad(3, 1), characterId: 'link' as const }],
    ]) {
      const result = buildMatchParticipants(players, preferences);
      expect(result.map((p) => p.slot)).toMatchObject(players);
      expect(result.at(-1)?.bindings === null).toBe(players.at(-1)?.inputType === 'ai');
    }
  });

  it('keeps a custom pad profile and retargets all of its bindings to the physical pad', () => {
    const store = new InputBindingsStore();
    store.setAction(3, 'attack', [{ kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 7 } }]);
    const selected = { ...pad(1, 6), bindingProfileIndex: 3 as const };
    const result = buildMatchParticipants([selected, fighter(2, 'ai')], store);
    expect(result[0]?.bindings?.bindings.attack).toEqual([
      { kind: 'gamepad', gamepadIndex: 6, source: { type: 'button', buttonIndex: 7 } },
    ]);
    expect(buildMatchParticipants([selected, fighter(2, 'ai')], store)).toEqual(result);
  });

  it('honors a legacy profile whose device was changed in Controls', () => {
    const store = new InputBindingsStore();
    store.set(1, { playerIndex: 1, bindings: buildDefaultGamepadBindings(6) });
    const result = buildMatchParticipants([fighter(1, 'keyboard_p1'), fighter(2, 'ai')], store);
    expect(result[0]?.bindings?.bindings.left[0]).toMatchObject({ kind: 'gamepad', gamepadIndex: 6 });
    expect(result[0]?.slot).toMatchObject({ inputType: 'gamepad', bindingProfileIndex: 1, inputDevice: { kind: 'gamepad', gamepadIndex: 6 } });
  });

  it('keeps the chosen custom profile when a controller reconnects and session bindings are projected again', () => {
    const store = new InputBindingsStore();
    store.set(3, { playerIndex: 3, bindings: buildDefaultGamepadBindings(2) });
    store.setAction(3, 'attack', [{ kind: 'gamepad', gamepadIndex: 2, source: { type: 'button', buttonIndex: 7 } }]);
    const participants = buildMatchParticipants([pad(1, 2), fighter(2, 'ai')], store);
    const player = participants[0]!.slot;
    expect(player.bindingProfileIndex).toBe(3);
    const reconnected = { ...player, inputDevice: { kind: 'gamepad' as const, gamepadIndex: 5 } };
    const resumed = buildMatchParticipants([reconnected, participants[1]!.slot], store);
    expect(resumed[0]?.bindings?.bindings.attack).toEqual([
      { kind: 'gamepad', gamepadIndex: 5, source: { type: 'button', buttonIndex: 7 } },
    ]);
  });

  it('exposes no pad ownership for unused slots or CPUs', () => {
    const store = createMatchBindingsStore(buildMatchParticipants(
      [fighter(1, 'keyboard_p1'), fighter(2, 'ai')], new InputBindingsStore(),
    ));
    expect(findSlotsBoundToGamepad(store, 0)).toEqual([]);
    expect(findSlotsBoundToGamepad(store, 1)).toEqual([]);
    expect(store.get(3).bindings.attack).toEqual([]);
    expect(store.get(4).bindings.jump).toEqual([]);
  });

  it('rejects duplicate or unclaimed devices before creating a match', () => {
    const store = new InputBindingsStore();
    expect(() => buildMatchParticipants([pad(1, 0), pad(2, 0)], store)).toThrow(/physical input/);
    expect(() => buildMatchParticipants([fighter(1, 'keyboard_p1'), fighter(3, 'keyboard_p1')], store)).toThrow(/physical input/);
    expect(() => buildMatchParticipants([pad(1, -1), fighter(2, 'ai')], store)).toThrow(/Reconnect/);
  });
});

describe('keyboard players sharing a key — the smash binding gives way', () => {
  const keyboardPair = () => [
    { ...fighter(1, 'keyboard_p1'), inputDevice: { kind: 'keyboard', layout: 'keyboard_p1' } } as PlayerSlot,
    { ...fighter(2, 'keyboard_p2'), inputDevice: { kind: 'keyboard', layout: 'keyboard_p2' } } as PlayerSlot,
  ];
  const V = { kind: 'keyboard' as const, keyCode: KEY_CODE.V };
  const live = (session: InputBindingsStore, down: number[]) => new DeviceInputDispatcher({ bindings: session,
    keyboard: { isDown: keyCode => down.includes(keyCode) },
    gamepad: { isConnected: () => false, getAxis: () => 0, getButton: () => ({ pressed: false, value: 0 }) },
  });

  it('P1 smashes on V and P2 attacks on V: V leaves P1’s Smash only, with a warning', () => {
    const preferences = new InputBindingsStore();
    preferences.setAction(2, 'attack', [V]); // a pre-smash P2 layout that used V
    const participants = buildMatchParticipants(keyboardPair(), preferences);
    const before = JSON.stringify(participants);
    const warnings: string[] = [];
    const session = createMatchBindingsStore(participants, message => warnings.push(message));
    expect(session.getAction(1, 'smash')).toEqual([]);
    expect(session.getAction(2, 'attack')).toEqual([V]);
    // Nothing else changed for either player.
    for (const action of ['left', 'right', 'up', 'down', 'jump', 'attack', 'special', 'shield', 'grab', 'taunt'] as const) {
      expect(session.getAction(1, action)).toEqual(preferences.getAction(1, action));
    }
    expect(session.getAction(2, 'smash')).toEqual(preferences.getAction(2, 'smash'));
    const actions = live(session, [KEY_CODE.V]);
    expect(actions.sampleActions(1).smash).toBe(false);
    expect(actions.sampleActions(2).attack).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`key code ${KEY_CODE.V}`);
    expect(warnings[0]).toContain("P1's Smash");
    expect(JSON.stringify(participants)).toBe(before); // the participants are not mutated
    expect(preferences.getAction(1, 'smash')).toEqual([V]); // nor the saved preferences
  });

  it('both players smashing on the same key: the later player loses it', () => {
    const preferences = new InputBindingsStore();
    preferences.setAction(2, 'smash', [V]);
    const warnings: string[] = [];
    const session = createMatchBindingsStore(buildMatchParticipants(keyboardPair(), preferences), message => warnings.push(message));
    expect(session.getAction(1, 'smash')).toEqual([V]);
    expect(session.getAction(2, 'smash')).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("P2's Smash");
  });

  it('a shared key on two non-smash actions is left alone, and default layouts are untouched', () => {
    const preferences = new InputBindingsStore();
    preferences.setAction(2, 'attack', preferences.getAction(1, 'attack'));
    const warnings: string[] = [];
    const session = createMatchBindingsStore(buildMatchParticipants(keyboardPair(), preferences), message => warnings.push(message));
    expect(session.getAction(1, 'attack')).toEqual(preferences.getAction(1, 'attack'));
    expect(session.getAction(2, 'attack')).toEqual(preferences.getAction(1, 'attack'));
    expect(session.getAction(1, 'smash')).toEqual([V]);
    expect(session.getAction(2, 'smash')).toEqual(preferences.getAction(2, 'smash'));
    expect(warnings).toEqual([]);
  });

  it('a keyboard player and a pad player never interact', () => {
    const preferences = new InputBindingsStore();
    const warnings: string[] = [];
    const session = createMatchBindingsStore(
      buildMatchParticipants([keyboardPair()[0]!, pad(3, 0)], preferences), message => warnings.push(message));
    expect(session.getAction(1, 'smash')).toEqual([V]);
    expect(session.getAction(2, 'smash')).toHaveLength(4);
    expect(warnings).toEqual([]);
  });
});
