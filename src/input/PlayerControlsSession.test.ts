import { describe, expect, it, vi } from 'vitest';
import type { PlayerSlot } from '../types';
import type { InputBinding } from '../types/inputBindings';
import { InputProfileStore, INPUT_PROFILES_STORAGE_KEY, type ProfileSaveResult } from './InputProfileStore';
import { PlayerControlsSession } from './PlayerControlsSession';

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: (key: string) => { values.delete(key); } };
}
const PAD_PLAYER: PlayerSlot = { index: 3, characterId: 'link', paletteIndex: 2, inputType: 'gamepad',
  inputDevice: { kind: 'gamepad', gamepadIndex: 5, gamepadId: 'sparse-pad' }, bindingProfileId: 'gamepad-standard' };
const KEYBOARD_PLAYER: PlayerSlot = { index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2',
  inputDevice: { kind: 'keyboard', layout: 'keyboard_p2' }, bindingProfileId: 'keyboard-arrows' };
const button = (buttonIndex: number, gamepadIndex: number | null = 5): InputBinding =>
  ({ kind: 'gamepad', gamepadIndex, source: { type: 'button', buttonIndex } });
function successful(result: ProfileSaveResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('isolated player controls draft', () => {
  it('pins sparse P3 to physical pad 5 without changing player identity, skin or saved defaults', () => {
    const profiles = new InputProfileStore(undefined, memoryStorage());
    const beforePlayer = structuredClone(PAD_PLAYER);
    const beforeDefault = profiles.get('gamepad-standard');
    const session = new PlayerControlsSession(profiles, PAD_PLAYER);
    expect(session.index).toBe(3);
    expect(session.device).toEqual(PAD_PLAYER.inputDevice);
    expect(session.profileName).toBe('Standard Gamepad');
    expect(session.bindings.get(3).bindings.attack).toEqual([button(2)]);
    session.setBinding('left', button(14));
    expect(session.bindings.get(3).bindings.left).toEqual([button(14)]);
    expect(profiles.get('gamepad-standard')).toBe(beforeDefault);
    expect(PAD_PLAYER).toEqual(beforePlayer);
    expect(new PlayerControlsSession(profiles, PAD_PLAYER).bindings.get(3).bindings.left[0])
      .toMatchObject({ gamepadIndex: 5, source: { type: 'axis' } });
  });

  it('captures a stick push on the Smash row as the whole stick, saves it and restores it on reset', () => {
    const storage = memoryStorage();
    const profiles = new InputProfileStore(undefined, storage);
    const session = new PlayerControlsSession(profiles, PAD_PLAYER);
    const halves = (pad: number | null, axes: number[]) => axes.map((axisIndex, i) => ({ kind: 'gamepad', gamepadIndex: pad,
      source: { type: 'axis', axisIndex, direction: i % 2 ? 1 : -1, threshold: 0.6 } }));
    // The default already reads the right stick on this player's pad.
    expect(session.bindings.getAction(3, 'smash')).toEqual(halves(5, [2, 2, 3, 3]));
    // Pushing the left stick left on the Smash row binds all four left-stick directions.
    session.setBinding('smash', { kind: 'gamepad', gamepadIndex: 5,
      source: { type: 'axis', axisIndex: 0, direction: -1, threshold: 0.5 } });
    expect(session.bindings.getAction(3, 'smash')).toEqual(halves(5, [0, 0, 1, 1]));
    // That duplicates the movement stick, so it cannot be saved.
    expect(session.save()).toMatchObject({ ok: false });
    session.setBinding('smash', { kind: 'gamepad', gamepadIndex: 5,
      source: { type: 'axis', axisIndex: 3, direction: 1, threshold: 0.5 } });
    session.setBinding('attack', button(7));
    const saved = successful(session.save());
    expect(profiles.get(saved.profileId)?.bindings.smash).toEqual(halves(null, [2, 2, 3, 3]));
    session.setBinding('smash', button(6));
    expect(session.bindings.getAction(3, 'smash')).toEqual([button(6)]);
    session.reset();
    expect(session.bindings.getAction(3, 'smash')).toEqual(halves(5, [2, 2, 3, 3]));
  });

  it('rejects a stick push on the Smash row from another controller without changing the draft', () => {
    const session = new PlayerControlsSession(new InputProfileStore(undefined, null), PAD_PLAYER);
    const before = session.bindings.get(3);
    for (const gamepadIndex of [1, null]) {
      expect(() => session.setBinding('smash', { kind: 'gamepad', gamepadIndex,
        source: { type: 'axis', axisIndex: 2, direction: 1, threshold: 0.5 } })).toThrow(/PLAYER 3/);
    }
    expect(session.bindings.get(3)).toBe(before);
    const keyboard = new PlayerControlsSession(new InputProfileStore(undefined, null), KEYBOARD_PLAYER);
    expect(keyboard.bindings.getAction(2, 'smash')).toEqual([{ kind: 'keyboard', keyCode: 96 }]); // Numpad 0
    keyboard.setBinding('smash', { kind: 'keyboard', keyCode: 103 }); // Numpad 7
    expect(keyboard.bindings.getAction(2, 'smash')).toEqual([{ kind: 'keyboard', keyCode: 103 }]);
  });

  it('rejects CPUs and invalid physical indices before creating an editor', () => {
    const profiles = new InputProfileStore(undefined, null);
    expect(() => new PlayerControlsSession(profiles, { ...PAD_PLAYER, inputType: 'ai' })).toThrow(/human/);
    expect(() => new PlayerControlsSession(profiles, { ...PAD_PLAYER, inputDevice: { kind: 'ai' } })).toThrow(/human/);
    expect(() => new PlayerControlsSession(profiles, { ...PAD_PLAYER,
      inputDevice: { kind: 'gamepad', gamepadIndex: -1 } })).toThrow(/controller/);
  });

  it('rejects foreign controllers, any-controller bindings, and another input family without changing the draft', () => {
    const profiles = new InputProfileStore(undefined, null);
    const session = new PlayerControlsSession(profiles, PAD_PLAYER);
    const before = session.bindings.get(3);
    for (const foreign of [button(14, 1), button(14, null), { kind: 'keyboard', keyCode: 74 } as const]) {
      expect(() => session.setBinding('attack', foreign)).toThrow(/PLAYER 3/);
      expect(session.bindings.get(3)).toBe(before);
    }
    const keyboard = new PlayerControlsSession(profiles, KEYBOARD_PLAYER);
    expect(() => keyboard.setBinding('attack', button(14))).toThrow(/keyboard/);
    keyboard.setBinding('attack', { kind: 'keyboard', keyCode: 74 });
    expect(keyboard.bindings.get(2).bindings.attack).toEqual([{ kind: 'keyboard', keyCode: 74 }]);
  });

  it('cycles only compatible profiles and selects existing mappings without writing unavailable storage', () => {
    const storage = memoryStorage();
    const profiles = new InputProfileStore(undefined, storage);
    const session = new PlayerControlsSession(profiles, KEYBOARD_PLAYER);
    expect(session.profileOptions().map(profile => profile.id)).toEqual(['keyboard-wasd', 'keyboard-arrows']);
    session.cycleProfile(1);
    expect(session.profileId).toBe('keyboard-wasd');
    session.selectProfile('gamepad-standard');
    session.selectProfile('missing');
    expect(session.profileId).toBe('keyboard-wasd');
    successful(session.save());
    expect(storage.setItem).not.toHaveBeenCalled();
    session.cycleProfile(-1);
    expect(session.profileId).toBe('keyboard-arrows');
    const offline = new PlayerControlsSession(new InputProfileStore(undefined, null), PAD_PLAYER);
    expect(offline.save()).toEqual({ ok: true, profileId: 'gamepad-standard', name: 'Standard Gamepad' });
    expect(offline.save({ copy: true })).toMatchObject({ ok: false, error: expect.stringMatching(/storage/) });
  });

  it('copies a changed shared profile while preserving sibling drafts and storing hardware-neutral mappings', () => {
    const storage = memoryStorage();
    const profiles = new InputProfileStore(undefined, storage);
    const created = successful(profiles.create('gamepad-standard', profiles.get('gamepad-standard')!.bindings, 'Shared pad'));
    const player = { ...PAD_PLAYER, bindingProfileId: created.profileId };
    const own = new PlayerControlsSession(profiles, player);
    const sibling = new PlayerControlsSession(profiles, { ...player, index: 4,
      inputDevice: { kind: 'gamepad', gamepadIndex: 1 } });
    const original = profiles.get(created.profileId);
    own.setBinding('left', button(14));
    const saved = successful(own.save({ sharedProfileIds: [created.profileId], name: 'P3 D-pad' }));
    expect(saved.profileId).not.toBe(created.profileId);
    expect(own.profileId).toBe(saved.profileId);
    expect(own.profileName).toBe('P3 D-pad');
    expect(profiles.get(created.profileId)).toBe(original);
    expect(sibling.profileId).toBe(created.profileId);
    expect(sibling.bindings.get(4).bindings.left[0]).toMatchObject({ gamepadIndex: 1, source: { type: 'axis' } });
    const persisted = JSON.parse(storage.values.get(INPUT_PROFILES_STORAGE_KEY)!);
    expect(persisted.profiles.find((profile: { id: string }) => profile.id === saved.profileId).bindings.left)
      .toEqual([button(14, null)]);
    const reopened = new PlayerControlsSession(new InputProfileStore(undefined, storage), {
      ...player, inputDevice: { kind: 'gamepad', gamepadIndex: 7 }, bindingProfileId: saved.profileId,
    });
    expect(reopened.bindings.get(3).bindings.left).toEqual([button(14, 7)]);
  });

  it('keeps a shared unchanged selection and an unshared edited custom profile under their existing identities', () => {
    const storage = memoryStorage();
    const profiles = new InputProfileStore(undefined, storage);
    const created = successful(profiles.create('gamepad-standard', profiles.get('gamepad-standard')!.bindings, 'My pad'));
    const session = new PlayerControlsSession(profiles, { ...PAD_PLAYER, bindingProfileId: created.profileId });
    storage.setItem.mockClear();
    expect(successful(session.save({ sharedProfileIds: [created.profileId] })).profileId).toBe(created.profileId);
    expect(storage.setItem).not.toHaveBeenCalled();
    session.setBinding('left', button(14));
    expect(successful(session.save()).profileId).toBe(created.profileId);
    expect(profiles.get(created.profileId)?.bindings.left).toEqual([button(14, null)]);
    expect(session.profileName).toBe('My pad');
  });

  it('resets to the selected profile base in the draft and creates a copy when explicitly requested', () => {
    const profiles = new InputProfileStore(undefined, memoryStorage());
    const session = new PlayerControlsSession(profiles, PAD_PLAYER);
    session.setBinding('left', button(14));
    const customized = successful(session.save({ name: 'D-pad' }));
    session.reset();
    expect(session.profileId).toBe(customized.profileId);
    expect(session.bindings.get(3).bindings.left[0]).toMatchObject({ gamepadIndex: 5, source: { type: 'axis' } });
    expect(profiles.get(customized.profileId)?.bindings.left).toEqual([button(14, null)]);
    const copy = successful(session.save({ copy: true, name: 'Default copy' }));
    expect(copy.profileId).not.toBe(customized.profileId);
    expect(session.profileName).toBe('Default copy');
    const unchangedCopy = successful(session.save({ copy: true }));
    expect(unchangedCopy.profileId).not.toBe(copy.profileId);
  });

  it('preserves untouched multi-bindings through one-action capture, save and reopen', () => {
    const storage = memoryStorage();
    const profiles = new InputProfileStore(undefined, storage);
    const base = profiles.get('keyboard-wasd')!;
    const created = successful(profiles.create(base.id, { ...base.bindings,
      attack: [{ kind: 'keyboard', keyCode: 70 }, { kind: 'keyboard', keyCode: 75 }],
    }, 'Two attacks'));
    const player = { ...KEYBOARD_PLAYER, bindingProfileId: created.profileId };
    const session = new PlayerControlsSession(profiles, player);
    const before = session.bindings.get(2).bindings;
    session.setBinding('special', { kind: 'keyboard', keyCode: 76 });
    const saved = successful(session.save());
    const reopened = new PlayerControlsSession(new InputProfileStore(undefined, storage), { ...player, bindingProfileId: saved.profileId });
    expect(reopened.bindings.get(2).bindings.attack).toEqual(before.attack);
    expect(reopened.bindings.get(2).bindings.up).toEqual(before.up);
    expect(reopened.bindings.get(2).bindings.jump).toEqual(before.jump);
  });

  it('rejects conflicting bindings with an actionable error and accepts a repaired draft', () => {
    const storage = memoryStorage();
    const profiles = new InputProfileStore(undefined, storage);
    const session = new PlayerControlsSession(profiles, PAD_PLAYER);
    session.setBinding('attack', button(0));
    expect(session.save()).toMatchObject({ ok: false,
      error: expect.stringMatching(/not saved.*Jump.*pick a new input/i) });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(session.profileId).toBe('gamepad-standard');
    session.setBinding('attack', button(16));
    successful(session.save());
  });

  it('reports a left stick captured on Smash as one stick conflict, not four half-axes', () => {
    const session = new PlayerControlsSession(new InputProfileStore(undefined, memoryStorage()), PAD_PLAYER);
    session.setBinding('smash', { kind: 'gamepad', gamepadIndex: 5,
      source: { type: 'axis', axisIndex: 1, direction: -1, threshold: 0.5 } });
    expect(session.save()).toEqual({ ok: false, error: "Controls were not saved. • '[6] Left Stick' is shared by "
      + 'P3 Left/Right/Up/Down & Smash — unbind one or pick a new input' });
  });

  it('guards foreign hardware even when a view mutates the exposed draft store directly', () => {
    const storage = memoryStorage();
    const session = new PlayerControlsSession(new InputProfileStore(undefined, storage), PAD_PLAYER);
    session.bindings.setAction(3, 'attack', [button(16, 1)]);
    expect(session.save()).toMatchObject({ ok: false, error: expect.stringMatching(/PLAYER 3/) });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('keeps a failed save draft and its original profile intact, then permits a successful retry', () => {
    const storage = memoryStorage();
    const profiles = new InputProfileStore(undefined, storage);
    const session = new PlayerControlsSession(profiles, PAD_PLAYER);
    session.setBinding('left', button(14));
    storage.setItem.mockImplementationOnce(() => { throw new Error('quota'); });
    expect(session.save()).toMatchObject({ ok: false, error: expect.stringMatching(/storage/) });
    expect(session.profileId).toBe('gamepad-standard');
    expect(session.bindings.get(3).bindings.left).toEqual([button(14)]);
    expect(profiles.list('gamepad')).toHaveLength(1);
    const saved = successful(session.save());
    expect(new PlayerControlsSession(new InputProfileStore(undefined, storage), { ...PAD_PLAYER,
      bindingProfileId: saved.profileId }).bindings.get(3).bindings.left).toEqual([button(14)]);
  });
});
