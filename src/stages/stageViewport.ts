import { STAGE_DESIGN_HEIGHT, STAGE_DESIGN_WIDTH } from './stageDefinitions';

/** A viewport size in pixels. */
export interface StageViewportSize {
  readonly width: number;
  readonly height: number;
}

/** The design→viewport transform: viewport = offset + design × viewportScale. */
export interface StageViewportTransform {
  readonly viewportScale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * The one design→viewport transform for stage geometry (Phaser-free).
 *
 * The 1920×1080 design space is scaled uniformly by the smaller ratio so it
 * never overflows, then centred. Stage bodies, hazard bodies and BaseStage's
 * cached transform all come from this function, so a headless simulation
 * that passes an explicit viewport gets the same geometry as the live game
 * (STEP5-DESIGN F8).
 */
export function computeStageViewportTransform(viewport: StageViewportSize): StageViewportTransform {
  const viewportScale = Math.min(viewport.width / STAGE_DESIGN_WIDTH, viewport.height / STAGE_DESIGN_HEIGHT);
  return {
    viewportScale,
    offsetX: (viewport.width - STAGE_DESIGN_WIDTH * viewportScale) / 2,
    offsetY: (viewport.height - STAGE_DESIGN_HEIGHT * viewportScale) / 2,
  };
}
