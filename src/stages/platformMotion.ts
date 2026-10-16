import type { StagePlatform } from '../types';
import { getPlatformBehavior } from './platformBehavior';
import { computeMovingPlatformOffset } from './platformVisualState';

export interface PlatformRider {
  readonly body: MatterJS.BodyType;
  /** False for hitlag, captive/ledge states, or eliminated fighters. */
  readonly canRide?: boolean;
  /** Current drop command or an already-active drop-through window. */
  readonly dropThrough?: boolean;
}

interface MotionTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** Fixed-step kinematic motion. Body positions are also the rendering source. */
export function createPlatformMotion(
  platforms: ReadonlyArray<StagePlatform>,
  bodies: ReadonlyArray<MatterJS.BodyType>,
  transform: MotionTransform,
  setPosition: (body: MatterJS.BodyType, point: { x: number; y: number }) => void,
): (frame: number, riders?: ReadonlyArray<PlatformRider>) => void {
  const moving = platforms.flatMap((platform, index) => {
    const body = bodies[index];
    return body && getPlatformBehavior(platform) === 'moving' && platform.motion
      ? [{ platform, body, motion: platform.motion }]
      : [];
  });
  let lastFrame = 0;
  return (frame, riders = []) => {
    if (!Number.isFinite(frame) || frame === lastFrame) return;
    lastFrame = frame;
    // Inspect all OLD bounds before moving either platforms or riders. A
    // fighter straddling two platforms receives at most one displacement.
    const motions = moving.map(({ platform, body, motion }) => {
      const offset = computeMovingPlatformOffset(motion, frame);
      const x = transform.offsetX + (platform.x + offset.x) * transform.scale;
      const y = transform.offsetY + (platform.y + offset.y) * transform.scale;
      return { platform, body, x, y, dx: x - body.position.x, dy: y - body.position.y };
    });
    const carried = new Set<MatterJS.BodyType>();
    for (const rider of riders) {
      if (rider.canRide === false || carried.has(rider.body)) continue;
      const support = motions.find(({ body, platform }) =>
        !(platform.passThrough && rider.dropThrough) && supportsRider(body, rider.body, transform.scale));
      if (!support) continue;
      carried.add(rider.body);
      // Matter's default setPosition shifts positionPrev too, preserving the
      // fighter's own velocity. The platform delta must not become a second
      // velocity impulse on the following physics step.
      setPosition(rider.body, {
        x: rider.body.position.x + support.dx,
        y: rider.body.position.y + support.dy,
      });
    }
    for (const motion of motions) {
      setPosition(motion.body, { x: motion.x, y: motion.y });
    }
  };
}

function supportsRider(platform: MatterJS.BodyType, rider: MatterJS.BodyType, scale: number): boolean {
  if (platform.isSensor || rider.isSensor || rider.isStatic) return false;
  const platformFilter = platform.collisionFilter;
  const riderFilter = rider.collisionFilter;
  // A crumble mask of zero and per-player pass-through masks are owned by
  // their existing controllers. Motion never changes those filters.
  if (!(platformFilter.mask & riderFilter.category) || !(riderFilter.mask & platformFilter.category)) return false;
  const surface = platform.bounds;
  const feet = rider.bounds.max.y;
  const tolerance = Math.max(1, 2 * scale);
  return rider.velocity.y >= -0.01 &&
    rider.position.y < surface.min.y &&
    Math.abs(feet - surface.min.y) <= tolerance &&
    rider.bounds.max.x > surface.min.x + 0.1 &&
    rider.bounds.min.x < surface.max.x - 0.1;
}
