import type { StageHazard } from '../types';

/**
 * The Inferno's giant head: a periodic stage-wide hazard. It rises from the
 * lava, its eyes brighten (the warning), then it flashes; on the flash frame
 * every fighter that is not crouching is KO'd outright (the lava-KO path).
 *
 * A stage declares it as a `{ type: 'gaze' }` StageHazard; MatchScene /
 * MatchSim calls `fightersHitByFlash` once per fixed step and KOs the indices
 * it returns through the lava-KO path.
 *
 * All timing is in frames and every value here is AUTHORED (no Smash source):
 * user request 2026-10-13, "like every minute". Pure and deterministic: one
 * integer frame counter, snapshot via `toState` / `fromState`.
 */

export type GazePhase = 'dormant' | 'rising' | 'glare' | 'flash' | 'sinking';

export interface GazeTimeline {
  /** Frames from one emergence to the next. */
  readonly cycleFrames: number;
  /** Frame of the first emergence within the cycle. */
  readonly startFrame: number;
  readonly riseFrames: number;
  /** The warning: eyes brighten for this long before the flash. */
  readonly glareFrames: number;
  /** The flash is drawn for this long; only its first frame is lethal. */
  readonly flashFrames: number;
  readonly sinkFrames: number;
}

export const GAZE_DEFAULTS: GazeTimeline = Object.freeze({
  cycleFrames: 3600,
  startFrame: 1500,
  riseFrames: 240,
  glareFrames: 150,
  flashFrames: 24,
  sinkFrames: 240,
});

export interface GazeHazardState {
  readonly frame: number;
}

/** What the flash needs to know about one fighter on its lethal frame. */
export interface GazeTarget {
  readonly crouching: boolean;
  /** Respawn / intangibility windows ignore the flash, like any hit. */
  readonly intangible: boolean;
  /** Already KO'd or off-stage fighters are skipped. */
  readonly active: boolean;
}

export class GazeHazard {
  private frame = 0;

  constructor(readonly id: string, readonly timeline: GazeTimeline = GAZE_DEFAULTS) {
    const t = timeline;
    const busy = t.riseFrames + t.glareFrames + t.flashFrames + t.sinkFrames;
    if (![t.cycleFrames, t.startFrame, t.riseFrames, t.glareFrames, t.flashFrames, t.sinkFrames].every(Number.isInteger)) {
      throw new Error('GazeHazard: every timeline value must be an integer frame count');
    }
    if (t.flashFrames < 1 || t.startFrame < 0 || t.startFrame + busy > t.cycleFrames) {
      throw new Error(`GazeHazard: the timeline (${busy} busy frames from ${t.startFrame}) must fit in the ${t.cycleFrames}-frame cycle`);
    }
  }

  tick(): void { this.frame += 1; }
  reset(toFrame = 0): void { this.frame = Math.max(0, Math.floor(toFrame)); }
  getFrame(): number { return this.frame; }

  /** Current phase and how far through it (0..1). */
  getPhase(): { readonly phase: GazePhase; readonly progress: number } {
    const t = this.timeline;
    let local = (this.frame % t.cycleFrames) - t.startFrame;
    const steps: Array<[GazePhase, number]> = [['rising', t.riseFrames], ['glare', t.glareFrames], ['flash', t.flashFrames], ['sinking', t.sinkFrames]];
    if (local < 0) return { phase: 'dormant', progress: 0 };
    for (const [phase, length] of steps) {
      if (local < length) return { phase, progress: local / length };
      local -= length;
    }
    return { phase: 'dormant', progress: 0 };
  }

  /** True on the single lethal frame (the first frame of the flash). */
  isLethalFrame(): boolean {
    const t = this.timeline;
    return (this.frame % t.cycleFrames) === t.startFrame + t.riseFrames + t.glareFrames;
  }

  /** Indices of the fighters the flash KOs this frame (none outside the lethal frame). */
  fightersHitByFlash(targets: ReadonlyArray<GazeTarget>): number[] {
    if (!this.isLethalFrame()) return [];
    return targets.flatMap((f, i) => (f.active && !f.intangible && !f.crouching ? [i] : []));
  }

  toState(): GazeHazardState { return { frame: this.frame }; }
  fromState(state: GazeHazardState): void { this.frame = state.frame; }
}

/** Build the runtime entity from a stage's `{ type: 'gaze' }` hazard record. */
export function createGazeHazardFromStageHazard(hazard: StageHazard): GazeHazard {
  if (hazard.type !== 'gaze') throw new Error(`createGazeHazardFromStageHazard: hazard.type must be 'gaze', got '${hazard.type}'.`);
  return new GazeHazard(hazard.id ?? 'gaze', hazard.gaze ?? GAZE_DEFAULTS);
}
