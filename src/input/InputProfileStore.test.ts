import { describe, expect, it } from 'vitest';
import type { PlayerSlot } from '../types';
import { InputProfileStore, INPUT_PROFILES_STORAGE_KEY } from './InputProfileStore';
import { ControlsProfileSession, applyControlsProfiles } from './ControlsProfileSession';
import { InputBindingsStore, buildDefaultGamepadBindings, DEFAULT_KEYBOARD_P1_BINDINGS } from './InputBindingsStore';
import { deserializeBindingsSnapshot } from './InputBindingsSerializer';
import { DeviceInputDispatcher } from './DeviceInputDispatcher';
import { buildMatchParticipants, createMatchBindingsStore } from '../match/matchParticipants';
import { initialiseMatch } from '../match/MatchStart';
import { serializeReplay, deserializeReplay } from '../replay/ReplayFile';
import { detectIntraPlayerConflicts } from '../ui/bindingConflicts';
import { KEY_CODE } from './keyCodes';
import { PlayerControlsSession } from './PlayerControlsSession';
import type { ActionBindings } from '../types/inputBindings';

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const sparsePlayers: ReadonlyArray<PlayerSlot> = [
  { index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2',
    inputDevice: { kind: 'keyboard', layout: 'keyboard_p2' }, bindingProfileId: 'keyboard-arrows' },
  { index: 3, characterId: 'link', paletteIndex: 2, inputType: 'gamepad',
    inputDevice: { kind: 'gamepad', gamepadIndex: 0 }, bindingProfileId: 'gamepad-standard' },
];

describe('reusable named input profiles', () => {
  it('edits the main-menu library without changing a previous match lineup', () => {
    const legacy = new InputBindingsStore();
    const profiles = new InputProfileStore(legacy, memoryStorage());
    const session = new ControlsProfileSession(profiles, legacy);
    expect(session.createProfile(3, 'Library controller')).toMatchObject({ ok: true });
    expect(session.snapshot()).toEqual([]);
    expect(applyControlsProfiles(sparsePlayers, session.snapshot())).toEqual(sparsePlayers);
    expect(profiles.list('gamepad').some(profile => profile.name === 'Library controller')).toBe(true);
  });

  it('opens and selects profiles without changing legacy controls, physical ownership or skins', () => {
    const legacy = new InputBindingsStore();
    const before = legacy.snapshot();
    const profiles = new InputProfileStore(legacy, memoryStorage());
    const session = new ControlsProfileSession(profiles, legacy, sparsePlayers);
    session.selectProfile(2, 'keyboard-wasd');
    session.selectProfile(3, 'keyboard-arrows'); // incompatible with its actual pad
    const selected = applyControlsProfiles(sparsePlayers, session.snapshot());
    expect(selected[0]).toEqual({ ...sparsePlayers[0], bindingProfileId: 'keyboard-wasd' });
    expect(selected[1]).toEqual(sparsePlayers[1]);
    expect(legacy.snapshot()).toEqual(before);
    expect(session.deviceFor(2)).toBe('keyboard_p2');
    expect(session.deviceFor(3)).toBe('gamepad_0');
  });

  it('copies immutable defaults, saves a named mapping and reuses it on another physical controller', () => {
    const storage = memoryStorage();
    const legacy = new InputBindingsStore();
    const profiles = new InputProfileStore(legacy, storage);
    const session = new ControlsProfileSession(profiles, legacy, sparsePlayers);
    session.bindings.setAction(3, 'left', [{ kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 14 } }]);
    const saved = session.saveProfile(3);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(session.renameProfile(3, 'D-pad fighter')).toMatchObject({ ok: true, name: 'D-pad fighter' });
    expect(profiles.get('gamepad-standard')?.bindings.left[0]).toMatchObject({ source: { type: 'axis' } });
    const reloaded = new InputProfileStore(legacy, storage);
    const otherPlayer: PlayerSlot = { ...sparsePlayers[1]!, index: 4,
      inputDevice: { kind: 'gamepad', gamepadIndex: 5 }, bindingProfileId: saved.profileId };
    const reopened = new ControlsProfileSession(reloaded, legacy, [otherPlayer]);
    expect(reopened.profileName(4)).toBe('D-pad fighter');
    expect(reopened.bindings.getAction(4, 'left')).toEqual([
      { kind: 'gamepad', gamepadIndex: 5, source: { type: 'button', buttonIndex: 14 } },
    ]);
    expect(reloaded.get(saved.profileId)?.bindings.left[0]).toMatchObject({ gamepadIndex: null });
    expect(reopened.snapshot()).toEqual([{ index: 4, bindingProfileId: saved.profileId }]);
  });

  it.each([false, true])('isolates P2 arrows and P3 one-pad with a stale legacy profile (P1 bot=%s)', bot => {
    const legacy = new InputBindingsStore();
    // Old device-selector settings must not steal P2 or replace the arrows.
    legacy.set(2, { playerIndex: 2, bindings: buildDefaultGamepadBindings(0) });
    const profiles = new InputProfileStore(legacy, memoryStorage());
    const players: ReadonlyArray<PlayerSlot> = bot
      ? [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'ai' }, ...sparsePlayers] : sparsePlayers;
    const session = new ControlsProfileSession(profiles, legacy, players);
    const matched = buildMatchParticipants(applyControlsProfiles(players, session.snapshot()), legacy, profiles);
    const bindings = createMatchBindingsStore(matched);
    let key = 0, axis = 0;
    const dispatcher = new DeviceInputDispatcher({ bindings,
      keyboard: { isDown: code => code === key },
      gamepad: { isConnected: index => index === 0, getAxis: (index, dimension) => index === 0 && dimension === 0 ? axis : 0,
        getButton: () => ({ pressed: false, value: 0 }) },
    });
    for (const input of ['keyboard', 'gamepad'] as const) {
      key = input === 'keyboard' ? 39 : 0;
      axis = input === 'gamepad' ? -1 : 0;
      for (const participant of matched) {
        const actual = dispatcher.sampleCharacterInput((participant.runtimePlayerIndex + 1) as 1 | 2 | 3 | 4);
        expect(actual.moveX).toBe(participant.slot.index === 2 ? (input === 'keyboard' ? 1 : 0)
          : participant.slot.index === 3 ? (input === 'gamepad' ? -1 : 0) : 0);
      }
    }
    expect(matched.filter(value => value.slot.inputType !== 'ai').map(value => [value.slot.index, value.slot.paletteIndex]))
      .toEqual([[2, 1], [3, 2]]);
  });

  it('imports old custom bindings as selectable names without modifying or applying them to another player', () => {
    const legacy = new InputBindingsStore();
    legacy.setAction(2, 'jump', [{ kind: 'keyboard', keyCode: 90 }]);
    const before = legacy.snapshot();
    const profiles = new InputProfileStore(legacy, memoryStorage());
    expect(profiles.list('keyboard').find(profile => profile.name === 'Imported P2 Keyboard')?.bindings.jump)
      .toEqual([{ kind: 'keyboard', keyCode: 90 }]);
    const session = new ControlsProfileSession(profiles, legacy, sparsePlayers);
    expect(session.profileId(2)).toBe('keyboard-arrows');
    expect(legacy.snapshot()).toEqual(before);
  });

  it('upgrading a pre-smash snapshot: an untouched P1 is not imported, and a P2 layout on V does not share V with P1', () => {
    const withoutSmash = (bindings: ActionBindings) => {
      const { smash: _smash, ...rest } = JSON.parse(JSON.stringify(bindings)) as Record<string, unknown>;
      return rest;
    };
    const key = (keyCode: number) => ({ kind: 'keyboard', keyCode });
    // P2 moved onto IJKL + letters with attack on V; P1, P3 and P4 untouched.
    const p2Letters = { left: [key(74)], right: [key(76)], up: [key(73)], down: [key(75)], jump: [key(73)],
      attack: [key(KEY_CODE.V)], special: [key(79)], shield: [key(80)], grab: [key(89)], taunt: [key(78)] };
    const json = JSON.stringify({ schemaVersion: 1, kind: 'bindingsSnapshot', data: {
      '1': { playerIndex: 1, bindings: withoutSmash(DEFAULT_KEYBOARD_P1_BINDINGS) },
      '2': { playerIndex: 2, bindings: p2Letters },
      '3': { playerIndex: 3, bindings: withoutSmash(buildDefaultGamepadBindings(0)) },
      '4': { playerIndex: 4, bindings: withoutSmash(buildDefaultGamepadBindings(1)) },
    } });
    const snapshot = deserializeBindingsSnapshot(json);
    expect(JSON.stringify(snapshot[1].bindings)).toBe(JSON.stringify(DEFAULT_KEYBOARD_P1_BINDINGS));
    const legacy = new InputBindingsStore();
    for (const slot of [1, 2, 3, 4] as const) legacy.set(slot, snapshot[slot]);
    const profiles = new InputProfileStore(legacy, memoryStorage());
    expect(profiles.list().map(profile => profile.id)).toEqual(
      ['keyboard-wasd', 'keyboard-arrows', 'gamepad-standard', 'custom-imported-2-keyboard']);
    expect(profiles.get('custom-imported-2-keyboard')!.bindings.attack).toEqual([key(KEY_CODE.V)]);

    const players: ReadonlyArray<PlayerSlot> = [
      { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
      { index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2', bindingProfileId: 'custom-imported-2-keyboard' },
    ];
    const participants = buildMatchParticipants(players, legacy, profiles);
    expect(participants.map(participant => participant.slot.bindingProfileId))
      .toEqual(['keyboard-wasd', 'custom-imported-2-keyboard']);
    const warnings: string[] = [];
    const session = createMatchBindingsStore(participants, message => warnings.push(message));
    const dispatcher = new DeviceInputDispatcher({ bindings: session,
      keyboard: { isDown: keyCode => keyCode === KEY_CODE.V },
      gamepad: { isConnected: () => false, getAxis: () => 0, getButton: () => ({ pressed: false, value: 0 }) } });
    expect(dispatcher.sampleActions(1).smash).toBe(false);
    expect(dispatcher.sampleActions(2).attack).toBe(true);
    expect(warnings).toHaveLength(1);
    // The library keeps P1's built-in V: only the match projection gave way.
    expect(profiles.get('keyboard-wasd')!.bindings.smash).toEqual([key(KEY_CODE.V)]);
  });

  it('rejects duplicate names and reports failed storage writes without replacing a saved profile', () => {
    const storage = memoryStorage();
    const profiles = new InputProfileStore(undefined, storage);
    const saved = profiles.create('keyboard-arrows', profiles.get('keyboard-arrows')!.bindings, 'Arrow fighter');
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(profiles.rename(saved.profileId, 'Keyboard WASD')).toMatchObject({ ok: false });
    storage.setItem = () => { throw new Error('quota'); };
    expect(profiles.rename(saved.profileId, 'Lost name')).toMatchObject({ ok: false });
    expect(profiles.get(saved.profileId)?.name).toBe('Arrow fighter');
    expect(new InputProfileStore(undefined, null).create('keyboard-arrows', profiles.get('keyboard-arrows')!.bindings))
      .toMatchObject({ ok: false });
  });

  it('retains safe defaults when the saved profile library is malformed', () => {
    const storage = memoryStorage();
    storage.setItem(INPUT_PROFILES_STORAGE_KEY, JSON.stringify({ version: 1, profiles: [
      { id: 'keyboard-arrows', name: 'Override', deviceKind: 'gamepad', bindings: {} },
      { id: 'custom-broken', name: 'Broken', deviceKind: 'keyboard', bindings: {} },
    ] }));
    const profiles = new InputProfileStore(undefined, storage);
    expect(profiles.list()).toHaveLength(3);
    expect(profiles.get('keyboard-arrows')?.bindings.left).toEqual([{ kind: 'keyboard', keyCode: 37 }]);
  });

  it('retains selected names through match initialization and replay config serialization', () => {
    const matchConfig = { mode: 'stocks' as const, stockCount: 3, stageId: 'flat', rngSeed: 1, players: sparsePlayers };
    const initialized = initialiseMatch({ matchConfig });
    expect(initialized.matchConfig.players.map(player => player.bindingProfileId)).toEqual(['keyboard-arrows', 'gamepad-standard']);
    const replay = serializeReplay({ matchConfig, capturedFrames: [] });
    expect(deserializeReplay(replay).matchConfig.players.map(player => player.bindingProfileId))
      .toEqual(['keyboard-arrows', 'gamepad-standard']);
  });
});

describe('custom profiles saved before the smash action existed', () => {
  /** A custom profile as an older build persisted it: no `smash` key. */
  function legacyProfile(id: string, name: string, baseId: string, deviceKind: 'keyboard' | 'gamepad',
    edit: (bindings: Record<string, unknown>) => void = () => {}) {
    const base = new InputProfileStore(undefined, null).get(baseId)!;
    const bindings = JSON.parse(JSON.stringify(base.bindings)) as Record<string, unknown>;
    delete bindings['smash'];
    edit(bindings);
    return { id, name, deviceKind, bindings, baseId, builtin: false };
  }

  const profiles0 = new InputProfileStore(undefined, null);

  function load(...profiles: ReadonlyArray<ReturnType<typeof legacyProfile>>) {
    const storage = memoryStorage();
    storage.setItem(INPUT_PROFILES_STORAGE_KEY, JSON.stringify({ version: 1, profiles }));
    return { storage, profiles: new InputProfileStore(undefined, storage) };
  }

  it('built-in profiles carry the default smash inputs', () => {
    const profiles = new InputProfileStore(undefined, null);
    expect(profiles.get('keyboard-wasd')?.bindings.smash).toEqual([{ kind: 'keyboard', keyCode: KEY_CODE.V }]);
    expect(profiles.get('keyboard-arrows')?.bindings.smash).toEqual([{ kind: 'keyboard', keyCode: KEY_CODE.NUMPAD_0 }]);
    expect(profiles.get('gamepad-standard')?.bindings.smash).toEqual([2, 2, 3, 3].map((axisIndex, i) => ({
      kind: 'gamepad', gamepadIndex: null,
      source: { type: 'axis', axisIndex, direction: i % 2 ? 1 : -1, threshold: 0.6 },
    })));
  });

  it('loads them with smash filled from the base and every customisation kept', () => {
    const { profiles } = load(
      legacyProfile('custom-1', 'Arrow fighter', 'keyboard-arrows', 'keyboard', b => {
        b['attack'] = [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }];
      }),
      legacyProfile('custom-2', 'D-pad pad', 'gamepad-standard', 'gamepad', b => {
        b['left'] = [{ kind: 'gamepad', gamepadIndex: null, source: { type: 'button', buttonIndex: 14 } }];
      }),
    );
    const arrows = profiles.get('custom-1')!;
    expect(arrows.name).toBe('Arrow fighter');
    expect(arrows.bindings.attack).toEqual([{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    expect(arrows.bindings.smash).toEqual([{ kind: 'keyboard', keyCode: KEY_CODE.NUMPAD_0 }]);
    expect(Object.keys(arrows.bindings)).toEqual(Object.keys(profiles.get('keyboard-arrows')!.bindings));
    const pad = profiles.get('custom-2')!;
    expect(pad.bindings.left).toEqual([{ kind: 'gamepad', gamepadIndex: null, source: { type: 'button', buttonIndex: 14 } }]);
    expect(pad.bindings.smash).toEqual(profiles.get('gamepad-standard')!.bindings.smash);
  });

  it('takes the key from the base preset even when the profile moved to the other keyboard half', () => {
    const letters = (b: Record<string, unknown>) => {
      const k = (keyCode: number) => [{ kind: 'keyboard', keyCode }];
      Object.assign(b, { left: k(74), right: k(76), up: k(73), down: k(75), jump: k(73),
        attack: k(85), special: k(79), shield: k(80), grab: k(89), taunt: k(78) });
    };
    const { profiles } = load(
      // An Arrows copy moved onto letters keeps P2's Numpad 0 (a vote would give P1's V).
      legacyProfile('custom-1', 'Arrows on letters', 'keyboard-arrows', 'keyboard', letters),
      // A WASD copy moved onto the arrows and numpad keeps V.
      legacyProfile('custom-2', 'WASD on arrows', 'keyboard-wasd', 'keyboard', b => {
        const arrows = profiles0.get('keyboard-arrows')!.bindings as unknown as Record<string, unknown>;
        for (const action of Object.keys(b)) b[action] = arrows[action];
      }),
      // No known base: the profile's own keys vote (letters → P1 half → V).
      { ...legacyProfile('custom-3', 'Unknown base', 'keyboard-arrows', 'keyboard', letters), baseId: 'missing' },
    );
    expect(profiles.get('custom-1')?.bindings.smash).toEqual([{ kind: 'keyboard', keyCode: KEY_CODE.NUMPAD_0 }]);
    expect(profiles.get('custom-2')?.bindings.smash).toEqual([{ kind: 'keyboard', keyCode: KEY_CODE.V }]);
    expect(profiles.get('custom-3')?.bindings.smash).toEqual([{ kind: 'keyboard', keyCode: KEY_CODE.V }]);
  });

  it('leaves smash unbound when its default key is already taken in the profile', () => {
    const { profiles } = load(legacyProfile('custom-1', 'V attack', 'keyboard-wasd', 'keyboard', b => {
      b['attack'] = [{ kind: 'keyboard', keyCode: KEY_CODE.V }];
    }));
    expect(profiles.get('custom-1')?.bindings.smash).toEqual([]);
    expect(detectIntraPlayerConflicts({ playerIndex: 1, bindings: profiles.get('custom-1')!.bindings })).toEqual([]);
  });

  it('does not put smash on the right stick of a profile that already moves with it', () => {
    const axis = (axisIndex: number, direction: -1 | 1) =>
      [{ kind: 'gamepad', gamepadIndex: null, source: { type: 'axis', axisIndex, direction, threshold: 0.5 } }];
    const { profiles } = load(legacyProfile('custom-1', 'Right stick walker', 'gamepad-standard', 'gamepad', b => {
      b['left'] = axis(2, -1); b['right'] = axis(2, 1); b['up'] = axis(3, -1); b['down'] = axis(3, 1);
    }));
    const profile = profiles.get('custom-1')!;
    expect(profile.bindings.smash).toEqual([]);
    expect(detectIntraPlayerConflicts({ playerIndex: 1, bindings: profile.bindings })).toEqual([]);
    // The player can open, keep and save it without a conflict blocking the save.
    const session = new PlayerControlsSession(profiles, { index: 3, characterId: 'link', paletteIndex: 0,
      inputType: 'gamepad', inputDevice: { kind: 'gamepad', gamepadIndex: 1 }, bindingProfileId: 'custom-1' });
    expect(session.bindings.getAction(3, 'smash')).toEqual([]);
    expect(session.save()).toMatchObject({ ok: true, profileId: 'custom-1' });
  });

  it('writes the filled profile back under the same key and library version', () => {
    const { storage, profiles } = load(legacyProfile('custom-1', 'Arrow fighter', 'keyboard-arrows', 'keyboard'));
    expect(profiles.rename('custom-1', 'Arrows 2')).toMatchObject({ ok: true });
    const saved = JSON.parse(storage.getItem(INPUT_PROFILES_STORAGE_KEY)!) as {
      version: number; profiles: Array<{ bindings: ActionBindings }> };
    expect(saved.version).toBe(1);
    expect(saved.profiles[0]!.bindings.smash).toEqual([{ kind: 'keyboard', keyCode: KEY_CODE.NUMPAD_0 }]);
    // An older build reading this library ignores the extra key; this build reloads it unchanged.
    expect(new InputProfileStore(undefined, storage).get('custom-1')?.bindings).toEqual(profiles.get('custom-1')!.bindings);
  });
});
