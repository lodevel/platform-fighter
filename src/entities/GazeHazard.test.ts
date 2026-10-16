import { describe, expect, it } from 'vitest';
import { GAZE_DEFAULTS, GazeHazard } from './GazeHazard';

const lethalFrame = GAZE_DEFAULTS.startFrame + GAZE_DEFAULTS.riseFrames + GAZE_DEFAULTS.glareFrames;
const at = (frame: number) => { const g = new GazeHazard('gaze'); g.reset(frame); return g; };

describe('GazeHazard', () => {
  it('runs dormant → rising → glare → flash → sinking → dormant once per cycle', () => {
    expect(at(0).getPhase().phase).toBe('dormant');
    expect(at(GAZE_DEFAULTS.startFrame).getPhase()).toEqual({ phase: 'rising', progress: 0 });
    expect(at(GAZE_DEFAULTS.startFrame + GAZE_DEFAULTS.riseFrames).getPhase().phase).toBe('glare');
    expect(at(lethalFrame).getPhase().phase).toBe('flash');
    expect(at(lethalFrame + GAZE_DEFAULTS.flashFrames).getPhase().phase).toBe('sinking');
    expect(at(lethalFrame + GAZE_DEFAULTS.flashFrames + GAZE_DEFAULTS.sinkFrames).getPhase().phase).toBe('dormant');
    expect(at(GAZE_DEFAULTS.cycleFrames + GAZE_DEFAULTS.startFrame).getPhase().phase).toBe('rising');
  });

  it('is lethal on exactly one frame per cycle', () => {
    const g = new GazeHazard('gaze');
    let lethal = 0;
    for (let f = 0; f < GAZE_DEFAULTS.cycleFrames * 2; f++, g.tick()) if (g.isLethalFrame()) lethal++;
    expect(lethal).toBe(2);
  });

  it('KOs standing and airborne fighters, spares crouching, intangible and inactive ones', () => {
    const targets = [
      { crouching: false, intangible: false, active: true },
      { crouching: true, intangible: false, active: true },
      { crouching: false, intangible: true, active: true },
      { crouching: false, intangible: false, active: false },
    ];
    expect(at(lethalFrame).fightersHitByFlash(targets)).toEqual([0]);
    expect(at(lethalFrame + 1).fightersHitByFlash(targets)).toEqual([]);
    expect(at(lethalFrame - 1).fightersHitByFlash(targets)).toEqual([]);
  });

  it('restores from a snapshot', () => {
    const g = at(lethalFrame - 3);
    const copy = new GazeHazard('gaze');
    copy.fromState(g.toState());
    copy.tick(); copy.tick(); copy.tick();
    expect(copy.isLethalFrame()).toBe(true);
  });

  it('rejects a timeline that does not fit its cycle', () => {
    expect(() => new GazeHazard('g', { ...GAZE_DEFAULTS, cycleFrames: 1000 })).toThrow(/fit/);
  });
});
