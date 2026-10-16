import { describe, expect, it } from 'vitest';
import type { CharacterInput } from '../characters/Character';
import type { MatchConfig } from '../types';
import { InputCaptureBuffer } from './InputCaptureBuffer';
import { deserializeReplay, serializeReplay } from './ReplayFile';
import { REPLAY_FORMAT_VERSION } from './replayTypes';

const CONFIG: MatchConfig = {
  mode: 'stocks', stockCount: 3, stageId: 'flat', rngSeed: 1,
  players: [{ index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' }],
};
const IDLE: Required<CharacterInput> = {
  moveX: 0, moveY: 0, jump: false, attack: false, attackHeavy: false,
  appeal: false, special: false, shield: false, dodge: false, grab: false,
  dropThrough: false, ledgeRelease: null, attackStickX: 0, attackStickY: 0,
};
const BUTTONS = ['jump', 'attack', 'attackHeavy', 'special', 'shield', 'dodge', 'grab', 'dropThrough', 'appeal'] as const;

function recorded(inputs: CharacterInput[]) {
  const buffer = new InputCaptureBuffer({ playerCount: 1 });
  inputs.forEach((input, frame) => buffer.captureFrame(frame, [input]));
  return serializeReplay({ matchConfig: CONFIG, capturedFrames: buffer.getEntries() });
}

describe('complete replay input contract', () => {
  it.each(BUTTONS)('preserves %s press, hold and release through capture and JSON', (button) => {
    const inputs = [IDLE, { ...IDLE, [button]: true }, { ...IDLE, [button]: true }, IDLE];
    const loaded = deserializeReplay(JSON.parse(JSON.stringify(recorded(inputs))));
    expect(loaded.inputTimeline.entries.map(entry => entry.inputs[0])).toEqual(inputs);
  });

  it.each(['getUp', 'roll', 'jump', 'attack', 'dropDown'] as const)('preserves ledge %s intent with analog direction', (ledgeRelease) => {
    const input = { ...IDLE, moveX: -0.35, moveY: 0.62, ledgeRelease };
    expect(deserializeReplay(recorded([input])).inputTimeline.entries[0]?.inputs[0]).toEqual(input);
  });

  it('copies all simultaneous actions before a caller reuses its input object', () => {
    const input = { ...IDLE, attackHeavy: true, shield: true, dodge: true, special: true, grab: true };
    const buffer = new InputCaptureBuffer({ playerCount: 1 });
    buffer.captureFrame(0, [input]);
    Object.assign(input, IDLE);
    expect(buffer.getFrame(0)?.inputs[0]).toEqual({ ...IDLE, attackHeavy: true, shield: true, dodge: true, special: true, grab: true });
  });

  it('migrates old omitted actions to neutral without inventing their lost history', () => {
    const old = JSON.parse(JSON.stringify(recorded([{ ...IDLE, attack: true }])));
    old.version = 3;
    const input = old.inputTimeline.entries[0].inputs[0];
    for (const field of ['attackHeavy', 'special', 'shield', 'dodge', 'grab', 'ledgeRelease']) delete input[field];
    delete input.attackStickX;
    delete input.attackStickY;
    const loaded = deserializeReplay(old);
    expect(loaded.version).toBe(REPLAY_FORMAT_VERSION);
    expect(loaded.inputTimeline.entries[0]?.inputs[0]).toEqual({ ...IDLE, attack: true });
    expect(input).not.toHaveProperty('special'); // migration does not mutate the source
  });

  it('preserves a right-stick smash direction on its press frame (v6)', () => {
    const inputs = [
      IDLE,
      { ...IDLE, attackHeavy: true, attackStickX: -1 },
      { ...IDLE, attackHeavy: true, attackStickY: 1 },
      IDLE,
    ];
    const file = JSON.parse(JSON.stringify(recorded(inputs)));
    expect(file.version).toBe(REPLAY_FORMAT_VERSION);
    expect(deserializeReplay(file).inputTimeline.entries.map(entry => entry.inputs[0])).toEqual(inputs);
  });

  it('loads a v5 file (no stick direction) with a neutral direction on every frame', () => {
    const v5 = JSON.parse(JSON.stringify(recorded([{ ...IDLE, attackHeavy: true }, IDLE])));
    v5.version = 5;
    for (const entry of v5.inputTimeline.entries) {
      delete entry.inputs[0].attackStickX;
      delete entry.inputs[0].attackStickY;
    }
    const loaded = deserializeReplay(v5);
    expect(loaded.version).toBe(REPLAY_FORMAT_VERSION);
    expect(loaded.inputTimeline.entries.map(entry => entry.inputs[0]))
      .toEqual([{ ...IDLE, attackHeavy: true }, IDLE]);
    expect(v5.inputTimeline.entries[0].inputs[0]).not.toHaveProperty('attackStickX');
  });

  it('keeps a v5 CPU player\'s heavy presses as recorded (the airborne-heavy meaning change is documented, not rewritten)', () => {
    const cpuConfig: MatchConfig = {
      ...CONFIG,
      players: [{ index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'ai', aiDifficulty: 'hard' }],
    };
    const buffer = new InputCaptureBuffer({ playerCount: 1 });
    const inputs = [IDLE, { ...IDLE, jump: true, attackHeavy: true, moveY: -1 }, { ...IDLE, attackHeavy: true }, IDLE];
    inputs.forEach((input, frame) => buffer.captureFrame(frame, [input]));
    const v5 = JSON.parse(JSON.stringify(serializeReplay({ matchConfig: cpuConfig, capturedFrames: buffer.getEntries() })));
    v5.version = 5;
    for (const entry of v5.inputTimeline.entries) {
      delete entry.inputs[0].attackStickX;
      delete entry.inputs[0].attackStickY;
    }
    const loaded = deserializeReplay(v5);
    expect(loaded.version).toBe(REPLAY_FORMAT_VERSION);
    expect(loaded.matchConfig.players[0]?.inputType).toBe('ai');
    expect(loaded.inputTimeline.entries.map(entry => entry.inputs[0]?.attackHeavy)).toEqual([false, true, true, false]);
    expect(loaded.inputTimeline.entries.map(entry => entry.inputs[0])).toEqual(inputs);
  });

  it.each(['attackStickX', 'attackStickY'])('rejects a missing or out-of-range current-format %s', (field) => {
    for (const invalid of [undefined, 'left', 2, Number.NaN]) {
      const file = JSON.parse(JSON.stringify(recorded([IDLE])));
      file.inputTimeline.entries[0].inputs[0][field] = invalid;
      expect(() => deserializeReplay(file)).toThrow(new RegExp(field));
    }
  });

  it('clamps an out-of-range captured stick direction instead of recording it raw', () => {
    const buffer = new InputCaptureBuffer({ playerCount: 1 });
    buffer.captureFrame(0, [{ ...IDLE, attackHeavy: true, attackStickX: 4, attackStickY: Number.NaN }]);
    expect(buffer.getFrame(0)?.inputs[0]).toMatchObject({ attackStickX: 1, attackStickY: 0 });
  });

  it.each(['attackHeavy', 'special', 'shield', 'dodge', 'grab', 'ledgeRelease'])('rejects malformed or missing current-format %s', (field) => {
    for (const invalid of [undefined, 'invalid']) {
      const file = JSON.parse(JSON.stringify(recorded([IDLE])));
      file.inputTimeline.entries[0].inputs[0][field] = invalid;
      expect(() => deserializeReplay(file)).toThrow(new RegExp(field));
    }
  });
});
