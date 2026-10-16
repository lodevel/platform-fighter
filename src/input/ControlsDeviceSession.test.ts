import { describe, expect, it } from 'vitest';
import type { PlayerSlot } from '../types';
import { buildMatchParticipants, createMatchBindingsStore } from '../match/matchParticipants';
import { applyControlsToRoster } from '../scenes/controlsDeviceHandoff';
import { DEFAULT_HAND_CURSOR_STATE, type HandCursorState } from '../scenes/handCursorState';
import { applyControlsDevices, ControlsDeviceSession } from './ControlsDeviceSession';
import { DeviceInputDispatcher, type GamepadSource } from './DeviceInputDispatcher';
import { buildDefaultGamepadBindings, InputBindingsStore } from './InputBindingsStore';

const KEYBOARD_PLAYERS: ReadonlyArray<PlayerSlot> = [
  { index: 1, participantId: 'hero-green', characterId: 'link', paletteIndex: 0,
    inputType: 'keyboard_p1', inputDevice: { kind: 'keyboard', layout: 'keyboard_p1' } },
  { index: 2, participantId: 'hero-blue', characterId: 'link', paletteIndex: 1,
    inputType: 'keyboard_p2', inputDevice: { kind: 'keyboard', layout: 'keyboard_p2' } },
];

function hardware() {
  const keys = new Set<number>();
  const buttons = new Set<string>();
  const axes = new Map<string, number>();
  const pads: GamepadSource = {
    isConnected: index => index === 0 || index === 1,
    getButton: (index, button) => {
      const pressed = buttons.has(`${index}:${button}`);
      return { pressed, value: pressed ? 1 : 0 };
    },
    getAxis: (index, axis) => axes.get(`${index}:${axis}`) ?? 0,
  };
  return { keys, buttons, axes,
    dispatcher: (store: InputBindingsStore) => new DeviceInputDispatcher({
      keyboard: { isDown: key => keys.has(key) }, gamepad: pads, bindings: store,
    }),
  };
}

function customPad(store: InputBindingsStore, slot: 1 | 2, pad: number, attack: number): void {
  store.set(slot, { playerIndex: slot, bindings: {
    ...buildDefaultGamepadBindings(pad),
    attack: [{ kind: 'gamepad', gamepadIndex: pad, source: { type: 'button', buttonIndex: attack } }],
    special: [],
    right: [{ kind: 'gamepad', gamepadIndex: pad,
      source: { type: 'axis', axisIndex: 2, direction: 1, threshold: 0.65 } }],
  } });
}

describe('Controls device assignments through the live binding store', () => {
  it('assigns two keyboard humans to opposite pads without either fighter reading the other pad', () => {
    const store = new InputBindingsStore();
    const session = new ControlsDeviceSession(store, KEYBOARD_PLAYERS);
    session.assign(1, 'gamepad_1');
    session.assign(2, 'gamepad_0');
    expect([session.deviceFor(1), session.deviceFor(2)]).toEqual(['gamepad_1', 'gamepad_0']);

    const input = hardware();
    const dispatcher = input.dispatcher(store);
    input.axes.set('1:0', 0.8);
    expect(dispatcher.sampleMoveX(1)).toBe(0.8);
    expect(dispatcher.sampleMoveX(2)).toBe(0);
    input.axes.clear();
    input.axes.set('0:0', -0.9);
    expect(dispatcher.sampleMoveX(1)).toBe(0);
    expect(dispatcher.sampleMoveX(2)).toBe(-0.9);
    input.axes.clear();
    input.keys.add(68); // The old P1 keyboard no longer moves either fighter.
    input.keys.add(39);
    expect([dispatcher.sampleMoveX(1), dispatcher.sampleMoveX(2)]).toEqual([0, 0]);
  });

  it('exchanges an occupied pad while keeping each player’s custom buttons, unbound actions and axes', () => {
    const store = new InputBindingsStore();
    customPad(store, 1, 0, 12);
    customPad(store, 2, 1, 13);
    const players: PlayerSlot[] = KEYBOARD_PLAYERS.map((slot, index) => ({ ...slot,
      inputType: 'gamepad', bindingProfileIndex: slot.index,
      inputDevice: { kind: 'gamepad', gamepadIndex: index },
    }));
    const session = new ControlsDeviceSession(store, players);
    session.assign(1, 'gamepad_1');
    expect([session.deviceFor(1), session.deviceFor(2)]).toEqual(['gamepad_1', 'gamepad_0']);
    expect(store.getAction(1, 'attack')).toEqual([
      { kind: 'gamepad', gamepadIndex: 1, source: { type: 'button', buttonIndex: 12 } },
    ]);
    expect(store.getAction(2, 'attack')).toEqual([
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 13 } },
    ]);
    expect(store.getAction(1, 'special')).toEqual([]);
    expect(store.getAction(2, 'special')).toEqual([]);
    expect(store.getAction(1, 'right')).toEqual([{ kind: 'gamepad', gamepadIndex: 1,
      source: { type: 'axis', axisIndex: 2, direction: 1, threshold: 0.65 } }]);
    // The right-stick smash half-axes follow the exchanged pad too.
    expect(store.getAction(1, 'smash')).toHaveLength(4);
    expect(store.getAction(1, 'smash').every(binding => binding.kind === 'gamepad' && binding.gamepadIndex === 1)).toBe(true);
    expect(store.getAction(2, 'smash').every(binding => binding.kind === 'gamepad' && binding.gamepadIndex === 0)).toBe(true);
    const input = hardware();
    const dispatcher = input.dispatcher(store);
    input.buttons.add('1:12');
    expect([dispatcher.isActionHeld(1, 'attack'), dispatcher.isActionHeld(2, 'attack')]).toEqual([true, false]);
    input.buttons.clear();
    input.buttons.add('0:13');
    expect([dispatcher.isActionHeld(1, 'attack'), dispatcher.isActionHeld(2, 'attack')]).toEqual([false, true]);
    input.axes.set('1:2', 0.7);
    expect(dispatcher.sampleMoveX(1)).toBe(0.7);
    expect(dispatcher.sampleMoveX(2)).toBe(0);
  });

  it('snapshots crossed profile sources before normalizing them to the active player columns', () => {
    const store = new InputBindingsStore();
    store.setAction(1, 'attack', [{ kind: 'keyboard', keyCode: 77 }]);
    store.setAction(2, 'attack', [{ kind: 'keyboard', keyCode: 78 }]);
    const players: PlayerSlot[] = [
      { ...KEYBOARD_PLAYERS[0]!, bindingProfileIndex: 2, inputType: 'keyboard_p2',
        inputDevice: { kind: 'keyboard', layout: 'keyboard_p2' } },
      { ...KEYBOARD_PLAYERS[1]!, bindingProfileIndex: 1, inputType: 'keyboard_p1',
        inputDevice: { kind: 'keyboard', layout: 'keyboard_p1' } },
    ];
    const session = new ControlsDeviceSession(store, players);
    expect([session.deviceFor(1), session.deviceFor(2)]).toEqual(['keyboard_p2', 'keyboard_p1']);
    const input = hardware();
    const dispatcher = input.dispatcher(store);
    input.keys.add(78);
    expect([dispatcher.isActionHeld(1, 'attack'), dispatcher.isActionHeld(2, 'attack')]).toEqual([true, false]);
    input.keys.clear();
    input.keys.add(77);
    expect([dispatcher.isActionHeld(1, 'attack'), dispatcher.isActionHeld(2, 'attack')]).toEqual([false, true]);
    const applied = applyControlsDevices(players, session.snapshot());
    expect(applied.map(player => player.bindingProfileIndex)).toEqual([1, 2]);
    const resumed = input.dispatcher(createMatchBindingsStore(buildMatchParticipants(applied, store)));
    expect([resumed.isActionHeld(1, 'attack'), resumed.isActionHeld(2, 'attack')]).toEqual([false, true]);
  });

  it('retains physical pad identity when selecting the same device or exchanging known pads', () => {
    const store = new InputBindingsStore();
    const players: PlayerSlot[] = KEYBOARD_PLAYERS.map((slot, index) => ({ ...slot,
      inputType: 'gamepad', inputDevice: { kind: 'gamepad', gamepadIndex: index,
        gamepadId: `known-controller-${index}` },
    }));
    const session = new ControlsDeviceSession(store, players);
    session.assign(1, 'gamepad_0');
    expect(session.snapshot().find(assignment => assignment.index === 1)?.inputDevice).toEqual({
      kind: 'gamepad', gamepadIndex: 0, gamepadId: 'known-controller-0',
    });
    session.assign(1, 'gamepad_1');
    expect(applyControlsDevices(players, session.snapshot()).map(player => player.inputDevice)).toEqual([
      { kind: 'gamepad', gamepadIndex: 1, gamepadId: 'known-controller-1' },
      { kind: 'gamepad', gamepadIndex: 0, gamepadId: 'known-controller-0' },
    ]);
  });

  it('resets all devices atomically after the persistence layer has already reset the store', () => {
    const store = new InputBindingsStore();
    const session = new ControlsDeviceSession(store);
    session.assign(1, 'gamepad_1');
    session.assign(2, 'gamepad_0');
    expect([1, 2, 3, 4].map(index => session.deviceFor(index as 1 | 2 | 3 | 4)))
      .toEqual(['gamepad_1', 'gamepad_0', 'keyboard_p2', 'keyboard_p1']);
    store.resetAll(); // RebindingScene's persistence.resetAll() runs first.
    session.resetAllDevices();
    expect([1, 2, 3, 4].map(index => session.deviceFor(index as 1 | 2 | 3 | 4)))
      .toEqual(['keyboard_p1', 'keyboard_p2', 'gamepad_0', 'gamepad_1']);
    for (const index of [1, 2, 3, 4] as const) expect(store.get(index)).toEqual(store.getDefault(index));
    const input = hardware();
    const dispatcher = input.dispatcher(store);
    input.keys.add(68);
    input.keys.add(37);
    input.axes.set('0:0', 0.8);
    input.axes.set('1:0', -0.9);
    expect([1, 2, 3, 4].map(index => dispatcher.sampleMoveX(index as 1 | 2 | 3 | 4)))
      .toEqual([1, -1, 0.8, -0.9]);
  });

  it('resets one player to its default pad and preserves the displaced player’s custom controls', () => {
    const store = new InputBindingsStore();
    customPad(store, 1, 0, 12);
    store.set(3, { playerIndex: 3, bindings: buildDefaultGamepadBindings(1) });
    store.setAction(3, 'attack', [{ kind: 'gamepad', gamepadIndex: 1,
      source: { type: 'button', buttonIndex: 13 } }]);
    const players: PlayerSlot[] = [
      { ...KEYBOARD_PLAYERS[0]!, inputType: 'gamepad', bindingProfileIndex: 1,
        inputDevice: { kind: 'gamepad', gamepadIndex: 0 } },
      { ...KEYBOARD_PLAYERS[1]!, index: 3, inputType: 'gamepad', bindingProfileIndex: 3,
        inputDevice: { kind: 'gamepad', gamepadIndex: 1 } },
    ];
    const session = new ControlsDeviceSession(store, players);
    store.reset(3); // RebindingScreen resets this slot before onReset.
    session.resetDevice(3);
    expect([session.deviceFor(1), session.deviceFor(3)]).toEqual(['gamepad_1', 'gamepad_0']);
    expect(store.get(3)).toEqual(store.getDefault(3));
    expect(store.getAction(1, 'attack')).toEqual([
      { kind: 'gamepad', gamepadIndex: 1, source: { type: 'button', buttonIndex: 12 } },
    ]);
    expect(store.getAction(1, 'special')).toEqual([]);
    const input = hardware();
    const dispatcher = input.dispatcher(store);
    input.buttons.add('1:12');
    input.axes.set('0:0', 0.75);
    expect([dispatcher.isActionHeld(1, 'attack'), dispatcher.isActionHeld(3, 'attack')]).toEqual([true, false]);
    expect([dispatcher.sampleMoveX(1), dispatcher.sampleMoveX(3)]).toEqual([0, 0.75]);
  });

  it('keeps sparse human slots separate from CPUs and vacant runtime slots', () => {
    const store = new InputBindingsStore();
    const cpu: PlayerSlot = { index: 1, characterId: 'link', paletteIndex: 6, inputType: 'ai' };
    const players: PlayerSlot[] = [cpu, { ...KEYBOARD_PLAYERS[0]!, index: 3 },
      { ...KEYBOARD_PLAYERS[1]!, index: 4 }];
    const cpuProfile = store.get(1);
    const session = new ControlsDeviceSession(store, players);
    session.assign(3, 'gamepad_1');
    session.assign(4, 'gamepad_0');
    expect(session.snapshot().map(assignment => assignment.index)).toEqual([3, 4]);
    expect(store.get(1)).toBe(cpuProfile);
    const applied = applyControlsDevices(players, session.snapshot());
    expect(applied[0]).toBe(cpu);
    expect(applied.map(player => player.index)).toEqual([1, 3, 4]);
    const input = hardware();
    const matchStore = createMatchBindingsStore(buildMatchParticipants(applied, store));
    const dispatcher = input.dispatcher(matchStore);
    input.axes.set('1:0', 0.8);
    input.axes.set('0:0', -0.9);
    expect([1, 2, 3, 4].map(index => dispatcher.sampleMoveX(index as 1 | 2 | 3 | 4)))
      .toEqual([0, 0.8, -0.9, 0]);
    expect(Object.values(matchStore.get(1).bindings).every(bindings => bindings.length === 0)).toBe(true);
    expect(Object.values(matchStore.get(4).bindings).every(bindings => bindings.length === 0)).toBe(true);
  });

  it('applies ownership without changing fighter identity, palette or the original launch configuration', () => {
    const store = new InputBindingsStore();
    const before = JSON.stringify(KEYBOARD_PLAYERS);
    const session = new ControlsDeviceSession(store, KEYBOARD_PLAYERS);
    session.assign(1, 'gamepad_1');
    session.assign(2, 'gamepad_0');
    const applied = applyControlsDevices(KEYBOARD_PLAYERS, session.snapshot());
    expect(applied.map(player => ({ index: player.index, participantId: player.participantId,
      characterId: player.characterId, paletteIndex: player.paletteIndex }))).toEqual([
      { index: 1, participantId: 'hero-green', characterId: 'link', paletteIndex: 0 },
      { index: 2, participantId: 'hero-blue', characterId: 'link', paletteIndex: 1 },
    ]);
    expect(applied.map(player => player.bindingProfileIndex)).toEqual([1, 2]);
    expect(applied.map(player => player.inputDevice)).toEqual([
      { kind: 'gamepad', gamepadIndex: 1 }, { kind: 'gamepad', gamepadIndex: 0 },
    ]);
    expect(JSON.stringify(KEYBOARD_PLAYERS)).toBe(before);
  });

  it('rebuilds independent match dispatchers after restart and reopening Controls without reverting ownership', () => {
    const store = new InputBindingsStore();
    const session = new ControlsDeviceSession(store, KEYBOARD_PLAYERS);
    session.assign(1, 'gamepad_1');
    session.assign(2, 'gamepad_0');
    store.setAction(1, 'attack', [{ kind: 'gamepad', gamepadIndex: 1,
      source: { type: 'button', buttonIndex: 12 } }]);
    let players = applyControlsDevices(KEYBOARD_PLAYERS, session.snapshot());
    const input = hardware();
    const projections: InputBindingsStore[] = [];
    for (let entry = 0; entry < 3; entry += 1) {
      const participants = buildMatchParticipants(players, store);
      const matchStore = createMatchBindingsStore(participants);
      projections.push(matchStore);
      const dispatcher = input.dispatcher(matchStore);
      input.axes.clear();
      input.axes.set('1:0', 0.75);
      input.buttons.add('1:12');
      expect([dispatcher.sampleMoveX(1), dispatcher.sampleMoveX(2)]).toEqual([0.75, 0]);
      expect([dispatcher.isActionHeld(1, 'attack'), dispatcher.isActionHeld(2, 'attack')]).toEqual([true, false]);
      input.axes.clear();
      input.axes.set('0:0', -0.85);
      expect([dispatcher.sampleMoveX(1), dispatcher.sampleMoveX(2)]).toEqual([0, -0.85]);
      const controls = new ControlsDeviceSession(store, participants.map(participant => participant.slot));
      expect([controls.deviceFor(1), controls.deviceFor(2)]).toEqual(['gamepad_1', 'gamepad_0']);
      players = applyControlsDevices(players, controls.snapshot());
    }
    expect(new Set(projections).size).toBe(3);
    expect(projections.every(projection => projection !== store)).toBe(true);
  });
});

describe('Controls ownership returning to the fighter roster', () => {
  function pickedRoster(): HandCursorState {
    return { slots: DEFAULT_HAND_CURSOR_STATE.slots.map(slot => ({ ...slot,
      mode: slot.index <= 2 ? 'human' as const : 'empty' as const,
      inputType: 'gamepad' as const, pickedCharacterId: 'link' as const,
      paletteIndex: slot.index - 1, cursor: { x: slot.index * 100, y: 200 },
    })) };
  }

  it('removes both old owners before applying an occupied-pad exchange', () => {
    const state = pickedRoster();
    const before = JSON.stringify(state);
    const updated = applyControlsToRoster(state, [[0, 1], [1, 2]], [
      { index: 1, inputDevice: { kind: 'gamepad', gamepadIndex: 1 } },
      { index: 2, inputDevice: { kind: 'gamepad', gamepadIndex: 0 } },
    ]);
    expect(new Map(updated.pads)).toEqual(new Map([[1, 1], [0, 2]]));
    expect(updated.state.slots.slice(0, 2).map(slot => ({ ...slot, bindingProfileIndex: undefined })))
      .toEqual(state.slots.slice(0, 2).map(slot => ({ ...slot, bindingProfileIndex: undefined })));
    expect(updated.state.slots.slice(0, 2).map(slot => slot.bindingProfileIndex)).toEqual([1, 2]);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('keeps sparse CPU and empty slots untouched while preserving human picks and palettes', () => {
    const initial = pickedRoster();
    const state: HandCursorState = { slots: initial.slots.map(slot => ({ ...slot,
      mode: slot.index === 1 ? 'bot' : slot.index === 3 ? 'human' : 'empty',
      ...(slot.index === 1 ? { aiDifficulty: 'hard' as const } : {}),
    })) };
    const result = applyControlsToRoster(state, [[0, 3]], [
      { index: 1, inputDevice: { kind: 'gamepad', gamepadIndex: 0 } },
      { index: 3, inputDevice: { kind: 'gamepad', gamepadIndex: 1 } },
    ]);
    expect(result.pads).toEqual([[1, 3]]);
    expect(result.state.slots[0]).toBe(state.slots[0]);
    expect(result.state.slots[1]).toBe(state.slots[1]);
    expect(result.state.slots[3]).toBe(state.slots[3]);
    expect(result.state.slots[2]).toEqual({ ...state.slots[2], bindingProfileIndex: 3 });
  });

  it('drops stale pad ownership when a human switches to keyboard without disturbing the other pad', () => {
    const state = pickedRoster();
    const result = applyControlsToRoster(state, [[0, 1], [1, 2]], [
      { index: 1, inputDevice: { kind: 'keyboard', layout: 'keyboard_p1' } },
    ]);
    expect(result.pads).toEqual([[1, 2]]);
    expect(result.state.slots[0]).toEqual({ ...state.slots[0], inputType: 'keyboard_p1', bindingProfileIndex: 1 });
    expect(result.state.slots[1]).toBe(state.slots[1]);
  });
});
