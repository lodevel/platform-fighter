import { createLavaHazardFromStageHazard, type LavaHazard } from '../../../../src/entities/LavaHazard';
import { createWindHazardFromStageHazard, type WindZoneHazard } from '../../../../src/entities/WindZoneHazard';
import { createGazeHazardFromStageHazard, type GazeHazard } from '../../../../src/entities/GazeHazard';
import type { StageLayout } from '../../../../src/types';

/**
 * The time-varying hazard entities of a stage, built with the game's own
 * factories and stepped like the simulation (one tick per 60 Hz frame).
 * MatchSim replaces this owner in step 6; the views only read the entities.
 */
export interface StageHazards {
  readonly lava: ReadonlyArray<LavaHazard>;
  readonly wind: ReadonlyArray<WindZoneHazard>;
  readonly gaze: GazeHazard | null;
  tick(): void;
  reset(frame: number): void;
}

export function createStageHazards(layout: StageLayout): StageHazards {
  const lava = layout.hazards.filter((h) => h.type === 'lava').map(createLavaHazardFromStageHazard);
  const wind = layout.hazards.filter((h) => h.type === 'wind').map((h) => createWindHazardFromStageHazard(h));
  const gazeRecord = layout.hazards.find((h) => h.type === 'gaze');
  const gaze = gazeRecord ? createGazeHazardFromStageHazard(gazeRecord) : null;
  const all = [...lava, ...wind, ...(gaze ? [gaze] : [])];
  return {
    lava, wind, gaze,
    tick: () => all.forEach((h) => h.tick()),
    reset: (frame) => all.forEach((h) => h.reset(frame)),
  };
}
