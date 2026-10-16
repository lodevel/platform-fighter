import type { StageLayout } from '../../../src/types';
import { getStage } from '../../../src/stages/stageDefinitions';
import { createStageHazards, type StageHazards } from './hazards';
import { createStageView, type StageView } from './view';

/**
 * A built-in stage with its own sim-frame clock, for screens that show a
 * stage without a match (viewer, menu backdrop). Hazards step exactly like
 * the simulation's 60 Hz step; MatchSim drives them in step 6.
 */
export interface StageRuntime {
  readonly layout: StageLayout;
  readonly view: StageView;
  /** The stage's hazard entities (read-only for presentation and demos). */
  readonly hazards: StageHazards;
  readonly frame: number;
  setFrame(frame: number): void;
  step(): void;
}

export function createStageRuntime(stageId: string): StageRuntime {
  const layout = getStage(stageId);
  const hazards = createStageHazards(layout);
  const view = createStageView(layout, hazards);
  let frame = 0;
  return {
    layout, view, hazards,
    get frame() { return frame; },
    setFrame(n) {
      frame = Math.max(0, Math.floor(n));
      hazards.reset(frame);
    },
    step() {
      frame += 1;
      hazards.tick();
    },
  };
}
