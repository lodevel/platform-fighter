import { describe, expect, it } from 'vitest';
import { parseCharacterDataFile, serializeCharacterDataSpec } from '../characters/characterSerializer';
import { getAuthorableCharacterSpec } from '../characters/authorableCharacterRegistry';
import { snapshotCustomCharacter, snapshotMatchCharacters } from '../match/characterSnapshot';
import type { MatchConfig } from '../types';
import { deserializeReplay, serializeReplay, ReplayFileError } from './ReplayFile';
import { REPLAY_FORMAT_VERSION } from './replayTypes';
import { NEUTRAL_INPUT } from './InputCaptureBuffer';
import { NEW_MATCH_FINAL_RULES } from '../finalSmash/finalSmashSchema';
import { initialiseMatch } from '../match/MatchStart';

function config(): MatchConfig {
  const base = structuredClone(parseCharacterDataFile(serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong'))));
  const spec = { ...base, movement: { ...base.movement, maxRunSpeed: 10 } };
  return {
    mode: 'stocks', stockCount: 5, itemFrequency: 'off', itemSwitch: { homeRunBat: true, crate: false }, stageId: 'flat', rngSeed: 42,
    players: [
      { index: 1, characterId: 'donkeykong', paletteIndex: 1, inputType: 'gamepad', participantId: 'alice',
        inputDevice: { kind: 'gamepad', gamepadIndex: 5, gamepadId: 'Controller A' }, bindingProfileIndex: 3,
        customCharacter: { slotId: 'dk-fast', spec } },
      { index: 3, characterId: 'pikachu', paletteIndex: 0, inputType: 'ai', aiDifficulty: 'hard', inputDevice: { kind: 'ai' } },
    ],
  };
}
const frames = [{ frame: 0, inputs: [NEUTRAL_INPUT, NEUTRAL_INPUT] }];

describe('authored fighter match and replay snapshots', () => {
  it('keeps selected data independent of later edits to its source', () => {
    const source = config();
    const snapshot = snapshotMatchCharacters(source);
    const replay = serializeReplay({ matchConfig: source, capturedFrames: frames });
    Object.assign(source.players[0]!.customCharacter!.spec.movement, { maxRunSpeed: 19 });
    Object.assign(source.players[0]!.inputDevice!, { gamepadIndex: 7 });
    expect(snapshot.players[0]?.customCharacter?.spec.movement.maxRunSpeed).toBe(10);
    expect(replay.matchConfig.players[0]?.customCharacter?.spec.movement.maxRunSpeed).toBe(10);
    expect(Object.isFrozen(snapshot.players[0]?.customCharacter?.spec.movement)).toBe(true);
    expect(Object.isFrozen(snapshot.players[0]?.customCharacter?.spec.moves?.jab?.hitbox)).toBe(true);
    expect(snapshot.players[0]?.inputDevice).toMatchObject({ gamepadIndex: 5 });
  });

  it('canonical match initialization preserves the complete authored configuration', () => {
    const original = config();
    const started = initialiseMatch({ matchConfig: original });
    expect(started.matchConfig).toEqual({ ...original, finalSmashRules: NEW_MATCH_FINAL_RULES });
    Object.assign(original.players[0]!.customCharacter!.spec.movement, { maxRunSpeed: 20 });
    Object.assign(original.players[0]!.inputDevice!, { gamepadIndex: 9 });
    expect(started.matchConfig.players[0]?.customCharacter?.spec.movement.maxRunSpeed).toBe(10);
    expect(started.matchConfig.players[0]?.inputDevice).toMatchObject({ gamepadIndex: 5 });
  });

  it('round-trips custom data, sparse identities, physical pads, profiles and item rules', () => {
    const original = config();
    const file = serializeReplay({ matchConfig: original, capturedFrames: frames });
    const read = deserializeReplay(JSON.parse(JSON.stringify(file)));
    expect(read.version).toBe(REPLAY_FORMAT_VERSION);
    expect(read.matchConfig).toEqual({ ...original, finalSmashRules: NEW_MATCH_FINAL_RULES, linkIntroPolicy: 'none' });
    expect(read.inputTimeline.entries).toEqual(frames);
  });

  it('loads older base-fighter recordings without inventing a saved tune', () => {
    const old = JSON.parse(JSON.stringify(serializeReplay({ matchConfig: config(), capturedFrames: frames })));
    old.version = 4;
    delete old.matchConfig.players[0].customCharacter;
    delete old.matchConfig.itemFrequency;
    delete old.matchConfig.itemSwitch;
    const read = deserializeReplay(old);
    expect(read.version).toBe(REPLAY_FORMAT_VERSION);
    expect(read.matchConfig.players[0]).not.toHaveProperty('customCharacter');
    expect(read.matchConfig).not.toHaveProperty('itemFrequency');
    // A recording without the Item Switch replays with every item on (absent = on).
    expect(read.matchConfig).not.toHaveProperty('itemSwitch');
  });

  it('rejects a malformed Item Switch', () => {
    const raw = JSON.parse(JSON.stringify(serializeReplay({ matchConfig: config(), capturedFrames: frames })));
    raw.matchConfig.itemSwitch = { homeRunBat: 'yes' };
    expect(() => deserializeReplay(raw)).toThrow(/itemSwitch/);
    expect(() => serializeReplay({ matchConfig: { ...config(), itemSwitch: [] as never }, capturedFrames: frames })).toThrow(/itemSwitch/);
  });

  it('rejects a snapshot for a different base fighter at runtime and replay boundaries', () => {
    const source = config();
    expect(() => snapshotCustomCharacter(source.players[0]!.customCharacter, 'pikachu')).toThrow(/base fighter/);
    const bad = { ...source, players: [{ ...source.players[0]!, characterId: 'pikachu' as const }, source.players[1]!] };
    expect(() => serializeReplay({ matchConfig: bad, capturedFrames: frames })).toThrow(ReplayFileError);
    const raw = JSON.parse(JSON.stringify(serializeReplay({ matchConfig: source, capturedFrames: frames })));
    raw.matchConfig.players[0].characterId = 'pikachu';
    expect(() => deserializeReplay(raw)).toThrow(/customCharacter/);
  });

  it.each([
    { customCharacter: { slotId: '../invalid', spec: {} } },
    { customCharacter: { slotId: 'broken', spec: {} } },
    { inputDevice: { kind: 'gamepad', gamepadIndex: -1 } },
    { inputDevice: { kind: 'keyboard', layout: 'missing' } },
    { bindingProfileIndex: 8 },
    { participantId: '' },
  ])('rejects malformed optional player metadata on read and write: %j', change => {
    const original = config();
    const invalid = { ...original, players: [{ ...original.players[0], ...change }, original.players[1]] } as unknown as MatchConfig;
    expect(() => serializeReplay({ matchConfig: invalid, capturedFrames: frames })).toThrow(ReplayFileError);
    const raw = JSON.parse(JSON.stringify(serializeReplay({ matchConfig: original, capturedFrames: frames })));
    Object.assign(raw.matchConfig.players[0], change);
    expect(() => deserializeReplay(raw)).toThrow(ReplayFileError);
  });
});
