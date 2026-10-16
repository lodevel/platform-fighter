import * as THREE from 'three';
import { STAGE_DESIGN_HEIGHT, STAGE_DESIGN_WIDTH } from '../../../src/stages/stageDefinitions';

/**
 * World space of the port renderer.
 *
 * The simulation works in design pixels (1920×1080, y down). The 3D world
 * uses 1 unit = 10 design px, y up, with the design centre at the origin.
 * Gameplay happens on the z = 0 plane; stage scenery extends in depth.
 */
export const PX_PER_UNIT = 10;

export const toWorldX = (designX: number): number => (designX - STAGE_DESIGN_WIDTH / 2) / PX_PER_UNIT;
export const toWorldY = (designY: number): number => (STAGE_DESIGN_HEIGHT / 2 - designY) / PX_PER_UNIT;
export const toWorldLength = (designPx: number): number => designPx / PX_PER_UNIT;

/** A rectangle of the design plane, in design pixels. */
export interface DesignRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const FULL_DESIGN_RECT: DesignRect = { x: 0, y: 0, width: STAGE_DESIGN_WIDTH, height: STAGE_DESIGN_HEIGHT };

/**
 * Perspective camera whose view of the z = 0 plane is exactly a given design
 * rectangle, whatever the eye position.
 *
 * The eye looks straight down -z and the frustum is shifted (off-axis) so the
 * framed rectangle fills the viewport. A plane parallel to the image plane
 * projects affinely, so the gameplay plane maps to the screen exactly like
 * Phaser's 2D camera did, while the eye can sit above the stage (showing the
 * platform tops) or sway sideways for parallax without moving a single
 * gameplay pixel.
 */
/** Default eye height above the framed rectangle's centre, in world units. */
export const EYE_ELEVATION = 16;
/** Vertical field of view the eye distance is derived from, in degrees. */
export const EYE_FOV = 35;

/** Eye distance from the gameplay plane that frames `rect` at `fov`. */
export const eyeDistance = (rect: DesignRect, fov = EYE_FOV): number =>
  toWorldLength(rect.height) / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2));

/**
 * Where the eye sits at rest (no sway) when framing `rect`. Scenery that has
 * to line up with the gameplay plane from the player's view (the Inferno
 * head behind its mustache platform) is solved against this point.
 */
export function restEye(rect: DesignRect = FULL_DESIGN_RECT): THREE.Vector3 {
  return new THREE.Vector3(toWorldX(rect.x + rect.width / 2), toWorldY(rect.y + rect.height / 2) + EYE_ELEVATION, eyeDistance(FULL_DESIGN_RECT));
}

export class PlaneCamera extends THREE.PerspectiveCamera {
  /** Eye height above the framed rectangle's centre, in world units. */
  elevation = EYE_ELEVATION;
  /** Sideways eye offset from the framed rectangle's centre, in world units. */
  sway = 0;
  private frameRect: DesignRect = FULL_DESIGN_RECT;
  /** Vertical field of view used to derive the eye distance, in degrees. */
  private readonly baseFov: number;

  constructor(fov = EYE_FOV, near = 1, far = 4000) {
    super(fov, 16 / 9, near, far);
    this.baseFov = fov;
  }

  /** Frame a design rectangle; its aspect should match the canvas. */
  frame(rect: DesignRect): void {
    this.frameRect = rect;
    this.updateProjectionMatrix();
  }

  /**
   * Eye distance from the gameplay plane: fixed at the full-stage framing, so
   * framing a smaller rectangle is a true zoom (narrower frustum, same
   * perspective and parallax), not a dolly.
   */
  get distance(): number {
    return eyeDistance(FULL_DESIGN_RECT, this.baseFov);
  }

  override updateProjectionMatrix(): void {
    // Called by the base constructor before our fields exist.
    if (!this.frameRect) {
      super.updateProjectionMatrix();
      return;
    }
    const r = this.frameRect;
    const x0 = toWorldX(r.x), x1 = toWorldX(r.x + r.width);
    const y0 = toWorldY(r.y + r.height), y1 = toWorldY(r.y);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const d = this.distance;
    const ex = cx + this.sway, ey = cy + this.elevation;
    this.position.set(ex, ey, d);
    this.quaternion.identity();
    this.updateMatrixWorld(true);
    const k = this.near / d;
    this.projectionMatrix.makePerspective((x0 - ex) * k, (x1 - ex) * k, (y1 - ey) * k, (y0 - ey) * k, this.near, this.far);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}
