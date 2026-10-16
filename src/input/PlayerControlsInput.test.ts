import { describe, expect, it } from 'vitest';
import type { PlayerSlot } from '../types';
import type { LogicalAction } from '../types/inputBindings';
import { InputProfileStore } from './InputProfileStore';
import { PlayerControlsSession } from './PlayerControlsSession';
import { PlayerControlsInput, type ControlsPadSnapshot } from './PlayerControlsInput';
import { PLAYER_CONTROLS_ROWS } from './playerControlsRows';

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
function pad(index = 5, pressed: number[] = [], axes = [0, 0]): ControlsPadSnapshot {
  return { index, buttons: Array.from({ length: 17 }, (_, button) => ({ pressed: pressed.includes(button) })), axes };
}
function actionRow(action: LogicalAction) {
  return PLAYER_CONTROLS_ROWS.findIndex(row => row.kind === 'binding' && row.action === action);
}
function player(index: 3 | 4 = 3, physical = 5): PlayerSlot {
  return { index, characterId: 'link', paletteIndex: index - 1, inputType: 'gamepad',
    inputDevice: { kind: 'gamepad', gamepadIndex: physical }, bindingProfileId: 'gamepad-standard' };
}
function fixture(owner = player()) {
  const profiles = new InputProfileStore(undefined, memoryStorage());
  const session = new PlayerControlsSession(profiles, owner);
  return { profiles, session, input: new PlayerControlsInput(session, () => []) };
}
const key = (key: string, keyCode: number, repeat = false) => ({ key, keyCode, repeat });

describe('per-player Controls input consumption', () => {
  it('quarantines opening inputs and gives A priority over simultaneous direction navigation', () => {
    const { input, session } = fixture();
    input.focusedRow = actionRow('left');
    const before = session.bindings.get(3).bindings.left;
    input.pollPad(pad(5, [0, 13]), 0);
    expect(input.capture).toBeNull(); // The button that opened the editor is still held.
    input.pollPad(pad(), 16);
    input.pollPad(pad(5, [0, 13]), 32);
    expect(input.capture).toBe('left');
    expect(input.focusedRow).toBe(actionRow('left'));
    for (let time = 48; time < 1000; time += 16) input.pollPad(pad(5, [0, 13]), time);
    expect(input.capture).toBe('left');
    expect(session.bindings.get(3).bindings.left).toEqual(before);
    input.pollPad(pad(), 1000);
    input.pollPad(pad(5, [14]), 1016);
    expect(input.capture).toBeNull();
    expect(session.bindings.get(3).bindings.left).toEqual([
      { kind: 'gamepad', gamepadIndex: 5, source: { type: 'button', buttonIndex: 14 } },
    ]);
  });

  it('binds B during capture, consumes the held release, then lets a fresh B cancel the editor', () => {
    const { input, session, profiles } = fixture();
    input.activate(actionRow('special'));
    input.pollPad(pad(), 0);
    input.pollPad(pad(5, [1]), 16);
    expect(input.capture).toBeNull();
    expect(input.closed).toBeNull();
    expect(session.bindings.get(3).bindings.special[0]).toMatchObject({ source: { type: 'button', buttonIndex: 1 } });
    for (let time = 32; time < 1000; time += 16) input.pollPad(pad(5, [1]), time);
    expect(input.closed).toBeNull();
    input.pollPad(pad(), 1000);
    input.pollPad(pad(5, [1]), 1016);
    expect(input.closed).toBe('cancelled');
    expect(new PlayerControlsSession(profiles, player()).bindings.get(3).bindings.special[0])
      .toMatchObject({ source: { buttonIndex: 3 } });
  });

  it.each(['dpad', 'axis'] as const)('consumes %s movement capture and residual stick travel until neutral', source => {
    const { input, session } = fixture();
    input.activate(actionRow('down'));
    input.pollPad(pad(), 0);
    input.pollPad(source === 'dpad' ? pad(5, [13]) : pad(5, [], [0, 1]), 16);
    expect(input.capture).toBeNull();
    expect(session.bindings.get(3).bindings.down[0]?.kind).toBe('gamepad');
    expect(session.bindings.get(3).bindings.down[0]).toMatchObject({ source: source === 'dpad'
      ? { type: 'button', buttonIndex: 13 } : { type: 'axis', axisIndex: 1, direction: 1 } });
    for (let time = 32; time < 1500; time += 16) input.pollPad(pad(5, [], [0, 0.6]), time);
    expect(input.focusedRow).toBe(actionRow('down'));
    input.pollPad(pad(), 1500);
    input.pollPad(pad(5, [], [0, 1]), 1516);
    expect(input.focusedRow).toBe(actionRow('jump'));
  });

  it('reserves Start for capture cancellation without allowing that held press to activate anything', () => {
    const { input, session } = fixture();
    const before = session.bindings.get(3);
    input.activate(actionRow('attack'));
    input.pollPad(pad(), 0);
    input.pollPad(pad(5, [9]), 16);
    expect(input.capture).toBeNull();
    expect(input.feedback).toMatch(/cancelled/);
    for (let time = 32; time < 700; time += 16) input.pollPad(pad(5, [9, 0]), time);
    expect(input.closed).toBeNull();
    expect(input.capture).toBeNull();
    expect(session.bindings.get(3)).toBe(before);
    input.pollPad(pad(), 700);
    input.pollPad(pad(5, [0]), 716);
    expect(input.capture).toBe('attack');
  });

  it('ignores foreign pad and keyboard input, including attempts to release another editor’s activation lock', () => {
    const { input, session } = fixture();
    const before = session.bindings.get(3);
    input.activate(actionRow('attack'));
    input.pollPad(pad(1), 0);
    input.releaseKeyboard(new Set());
    input.keyDown(key('Escape', 27));
    input.pollPad(pad(5, [16]), 16);
    expect(input.capture).toBe('attack');
    expect(session.bindings.get(3)).toBe(before);
    input.pollPad(pad(), 32);
    input.pollPad(pad(1, [9, 1]), 48);
    expect(input.capture).toBe('attack');
    input.pollPad(pad(5, [16]), 64);
    expect(input.capture).toBeNull();
    expect(session.bindings.get(3).bindings.attack[0]).toMatchObject({ gamepadIndex: 5, source: { buttonIndex: 16 } });
  });

  it('binds the whole right stick when the stick is pushed on the Smash row, and ignores other pads', () => {
    const { input, session } = fixture();
    session.setBinding('smash', { kind: 'gamepad', gamepadIndex: 5, source: { type: 'button', buttonIndex: 7 } });
    input.activate(actionRow('smash'));
    expect(input.capture).toBe('smash');
    input.pollPad(pad(5, [], [0, 0, 0, 0]), 0);
    input.pollPad(pad(1, [], [0, 0, 0, -1]), 16); // Another player's right stick.
    expect(input.capture).toBe('smash');
    input.pollPad(pad(5, [], [0, 0, 0, -0.9]), 32); // Push up only.
    expect(input.capture).toBeNull();
    expect(input.feedback).toMatch(/^Smash assigned/);
    expect(session.bindings.get(3).bindings.smash).toEqual([2, 2, 3, 3].map((axisIndex, i) => ({ kind: 'gamepad',
      gamepadIndex: 5, source: { type: 'axis', axisIndex, direction: i % 2 ? 1 : -1, threshold: 0.6 } })));
    // Other rows keep a pushed stick as a single half-axis.
    input.pollPad(pad(5, [], [0, 0, 0, 0]), 48);
    input.activate(actionRow('taunt'));
    input.pollPad(pad(5, [], [0, 0, 0, 0]), 64);
    input.pollPad(pad(5, [], [0, 0, 0.9, 0]), 80);
    expect(session.bindings.get(3).bindings.taunt).toEqual([
      { kind: 'gamepad', gamepadIndex: 5, source: { type: 'axis', axisIndex: 2, direction: 1, threshold: 0.5 } },
    ]);
  });

  it('pushing the right stick right on the Smash row stores its four half-axes; another pad and a trigger axis do not', () => {
    const { input, session } = fixture();
    const before = session.bindings.getAction(3, 'smash');
    input.activate(actionRow('smash'));
    input.pollPad(pad(5, [], [0, 0, 0, 0, 0]), 0); // neutral: capture armed
    input.pollPad(pad(2, [], [0, 0, 0.9, 0, 0]), 16); // someone else's right stick
    expect(input.capture).toBe('smash');
    expect(session.bindings.getAction(3, 'smash')).toBe(before);
    input.pollPad(pad(5, [], [0, 0, 0.9, 0, 0]), 32);
    expect(input.capture).toBeNull();
    expect(session.bindings.getAction(3, 'smash')).toEqual([2, 2, 3, 3].map((axisIndex, i) => ({ kind: 'gamepad',
      gamepadIndex: 5, source: { type: 'axis', axisIndex, direction: i % 2 ? 1 : -1, threshold: 0.6 } })));
    // A non-stick axis (e.g. an analog trigger on axis 4) stays a single half-axis.
    input.pollPad(pad(5, [], [0, 0, 0, 0, 0]), 48);
    input.activate(actionRow('smash'));
    input.pollPad(pad(5, [], [0, 0, 0, 0, 0]), 64);
    input.pollPad(pad(5, [], [0, 0, 0, 0, 0.9]), 80);
    expect(session.bindings.getAction(3, 'smash')).toEqual([
      { kind: 'gamepad', gamepadIndex: 5, source: { type: 'axis', axisIndex: 4, direction: 1, threshold: 0.5 } },
    ]);
  });

  it('keeps two concurrent editors independent when one binds B and the other completes its own capture', () => {
    const profiles = new InputProfileStore(undefined, memoryStorage());
    const first = new PlayerControlsInput(new PlayerControlsSession(profiles, player(3, 1)), () => ['gamepad-standard']);
    const second = new PlayerControlsInput(new PlayerControlsSession(profiles, player(4, 5)), () => ['gamepad-standard']);
    first.activate(actionRow('special')); second.activate(actionRow('left'));
    const broadcast = (snapshot: ControlsPadSnapshot, time: number) => {
      first.pollPad(snapshot, time); second.pollPad(snapshot, time);
    };
    broadcast(pad(1), 0); broadcast(pad(5), 0);
    broadcast(pad(1, [1]), 16);
    expect(first.capture).toBeNull();
    expect(second.capture).toBe('left');
    expect(first.closed).toBeNull(); expect(second.closed).toBeNull();
    broadcast(pad(5, [14]), 32);
    expect(second.capture).toBeNull();
    expect(first.session.bindings.get(3).bindings.special[0]).toMatchObject({ gamepadIndex: 1, source: { buttonIndex: 1 } });
    expect(second.session.bindings.get(4).bindings.left[0]).toMatchObject({ gamepadIndex: 5, source: { buttonIndex: 14 } });
    const done = PLAYER_CONTROLS_ROWS.findIndex(row => row.kind === 'done');
    first.activate(done); // B conflicts with this player's existing Dodge binding.
    expect(first.closed).toBeNull();
    expect(first.feedback).toMatch(/not saved/);
    second.activate(done);
    expect(second.closed).toBe('saved');
    expect(first.session.profileId).toBe('gamepad-standard');
    expect(second.session.profileId).not.toBe('gamepad-standard');
  });

  it('captures a fresh Enter only after release, and consumes held keyboard input before resuming navigation', () => {
    const { input, session } = fixture({ index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2' });
    input.focusedRow = actionRow('attack');
    input.releaseKeyboard(new Set());
    input.keyDown(key('Enter', 13));
    expect(input.capture).toBe('attack');
    input.keyDown(key('Enter', 13, true));
    input.releaseKeyboard(new Set([13]));
    input.keyDown(key('j', 74));
    expect(input.capture).toBe('attack');
    input.releaseKeyboard(new Set());
    input.keyDown(key('Enter', 13));
    expect(input.capture).toBeNull();
    expect(session.bindings.get(2).bindings.attack).toEqual([{ kind: 'keyboard', keyCode: 13 }]);
    input.keyDown(key('ArrowDown', 40));
    expect(input.focusedRow).toBe(actionRow('attack'));
    input.releaseKeyboard(new Set());
    input.keyDown(key('ArrowDown', 40));
    expect(input.focusedRow).toBe(actionRow('special'));
    expect(input.closed).toBeNull();
  });

  it('uses Escape to cancel keyboard capture first, requiring a release and fresh Escape to discard the editor', () => {
    const { input, session } = fixture({ index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2' });
    const before = session.bindings.get(2);
    input.activate(actionRow('jump'));
    input.releaseKeyboard(new Set());
    input.keyDown(key('Escape', 27));
    expect(input.capture).toBeNull();
    expect(input.closed).toBeNull();
    input.keyDown(key('Escape', 27, true));
    input.keyDown(key('Escape', 27));
    expect(input.closed).toBeNull();
    expect(session.bindings.get(2)).toBe(before);
    input.releaseKeyboard(new Set());
    input.keyDown(key('Escape', 27));
    expect(input.closed).toBe('cancelled');
  });
});
