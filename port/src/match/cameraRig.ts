import { STAGE_DESIGN_HEIGHT } from '../../../src/stages/stageDefinitions';
import type { StageLayout } from '../../../src/types';
import { FULL_DESIGN_RECT, type DesignRect } from '../engine/space';
import { CameraFraming, MATCH_CAMERA_OPTIONS, frameRateIndependentLerp, type CameraTarget } from '../../../src/camera/cameraFraming';
import type { SimView } from '../../../src/sim/view';

/**
 * The match camera: the game's framing (CameraFraming with MatchScene's
 * settings) turned into the design rectangle the 3D view frames. The framing
 * viewport stops above the 190 px HUD strip, as in the Phaser match; the
 * rendered view extends under the HTML HUD instead of leaving it black, so
 * the framed area itself is unchanged.
 */
export class CameraRig {
  private readonly framing: CameraFraming;
  private readonly inferno: boolean;
  private scenicRect: DesignRect = FULL_DESIGN_RECT;

  constructor(layout: StageLayout) {
    this.framing = new CameraFraming(layout, MATCH_CAMERA_OPTIONS);
    this.inferno = layout.id === 'inferno';
  }

  update(view: SimView, deltaMs: number): DesignRect {
    const { finalAnchor, targets } = view.camera;
    if (this.inferno && !finalAnchor) {
      const target = infernoSceneryFrame(targets);
      const ease = (from: number, to: number) => frameRateIndependentLerp(from, to, .98, deltaMs);
      this.scenicRect = { x: ease(this.scenicRect.x, target.x), y: ease(this.scenicRect.y, target.y),
        width: ease(this.scenicRect.width, target.width), height: ease(this.scenicRect.height, target.height) };
      return this.scenicRect;
    }
    this.framing.setTargets(finalAnchor ? [{ ...finalAnchor, active: true }] : targets);
    this.framing.update(deltaMs);
    const r = this.framing.visibleRect();
    const viewport = this.framing.getViewport();
    const rect = { x: r.x, y: r.y, width: r.width, height: r.height * (STAGE_DESIGN_HEIGHT / viewport.height) };
    this.scenicRect = rect;
    return rect;
  }

  /** Jump straight to the target framing (match start, rewinds). */
  snap(view: SimView): void {
    if (this.inferno) this.scenicRect = infernoSceneryFrame(view.camera.targets);
    this.framing.setTargets(view.camera.targets);
    this.framing.update(0);
    this.framing.snap();
  }
}

/** Keep the preview's inhabitants and cages in view. Expand only for real
 * fighters leaving that composition; close combat must not crop the scenery. */
export function infernoSceneryFrame(targets: readonly CameraTarget[]): DesignRect {
  let left = 0, top = 0, right = FULL_DESIGN_RECT.width, bottom = FULL_DESIGN_RECT.height;
  for (const target of targets) {
    if (target.active === false || (target.weight ?? 1) <= 0) continue;
    left = Math.min(left, target.x - 140);
    right = Math.max(right, target.x + 140);
    top = Math.min(top, target.y - 140);
    bottom = Math.max(bottom, target.y + 140);
  }
  const aspect = FULL_DESIGN_RECT.width / FULL_DESIGN_RECT.height;
  const width = Math.max(right - left, (bottom - top) * aspect);
  const height = width / aspect;
  return { x: (left + right - width) / 2, y: (top + bottom - height) / 2, width, height };
}
