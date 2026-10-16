import { describe, expect, it } from 'vitest';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';

const linkFile = () => serializeCharacterDataSpec(getAuthorableCharacterSpec('link'));

describe('ground locomotion authoring and saved tunes', () => {
  it('preserves sourced Link locomotion through JSON save/load', () => {
    const file = linkFile();
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(file)));
    expect(loaded.movement.maxRunSpeed).toBeCloseTo(7.67);
    expect(loaded.movement.locomotion).toMatchObject({
      walkMaxSpeed: 6.235, initialDashSpeed: 9.9,
      initialDashInstantStart: true, dashDanceWindowFrames: 12,
    });
    expect(loaded.movement.locomotion).toEqual(file.movement.locomotion);
  });

  it('fills omitted legacy fields while preserving explicit partial edits', () => {
    const file = linkFile();
    const loaded = parseCharacterDataFile({ ...file,
      movement: { ...file.movement, locomotion: { initialDashInstantStart: false, walkMaxSpeed: 0 } } });
    expect(loaded.movement.locomotion).toMatchObject({
      initialDashSpeed: 9.9, initialDashInstantStart: false, walkMaxSpeed: 0,
    });
    const legacy = parseCharacterDataFile({ ...file,
      movement: { ...file.movement, locomotion: undefined } });
    expect(legacy.movement.locomotion).toEqual(file.movement.locomotion);
  });

  it.each([
    { initialDashSpeed: -1 }, { dashDanceWindowFrames: 1.5 },
    { initialDashInstantStart: 'true' }, { walkStickThreshold: 2 },
    { walkMaxSpeed: NaN }, null, [],
  ])('rejects invalid imported locomotion %j', locomotion => {
    const file = linkFile();
    expect(() => parseCharacterDataFile({ ...file,
      movement: { ...file.movement, locomotion } })).toThrow('locomotion');
  });
});
