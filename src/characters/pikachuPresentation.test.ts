import { describe, expect, it } from 'vitest';
import { getPikachuReviewedStateClock } from './pikachuPresentation';
import { selectPikachuStateHurtboxes } from './pikachuStateHurtboxes';

describe('Pikachu accepted ordinary pose clocks', () => {
  it('holds the native nonloop idle endpoint with its reviewed receiving fit', () => {
    const clock = getPikachuReviewedStateClock('idle', 150)!;
    expect(clock).toMatchObject({ localFrame: 106, artFrameIndex: 4, frameCount: 5 });
    expect(selectPikachuStateHurtboxes('idle', clock.localFrame)).toHaveLength(12);
    expect(selectPikachuStateHurtboxes('idle', clock.localFrame))
      .toEqual(selectPikachuStateHurtboxes('idle', 106));
    // A caller bypassing normalization loses the receiving fit entirely.
    expect(selectPikachuStateHurtboxes('idle', 150)).toBeNull();
  });

  it.each([['walk_slow', 40], ['walk', 30], ['walk_fast', 15]] as const)
  ('excludes the retained native %s loop closure from actual playback', (sheet, duration) => {
    expect(getPikachuReviewedStateClock(sheet, duration - 1)).toMatchObject({ artFrameIndex: 3 });
    expect(getPikachuReviewedStateClock(sheet, duration)).toMatchObject({ localFrame: 0, artFrameIndex: 0 });
    const repeated = getPikachuReviewedStateClock(sheet, duration * 2)!;
    expect(repeated).toMatchObject({ localFrame: 0, artFrameIndex: 0 });
    expect(selectPikachuStateHurtboxes(sheet, repeated.localFrame)).toHaveLength(12);
    expect(selectPikachuStateHurtboxes(sheet, repeated.localFrame))
      .toEqual(selectPikachuStateHurtboxes(sheet, 0));
  });

  it('keeps absent accepted art explicit and rejects invalid status clocks', () => {
    expect(getPikachuReviewedStateClock('unreviewed-clip', 0)).toBeNull();
    expect(() => getPikachuReviewedStateClock('idle', Number.NaN)).toThrow('source clock');
    expect(() => getPikachuReviewedStateClock('idle', -1)).toThrow('source clock');
  });
});
