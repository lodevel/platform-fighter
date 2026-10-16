import {sweptProjectileCapsuleEntry} from './projectileMotion';

interface Point {readonly x: number; readonly y: number}
export interface ProjectileCircleBounds {readonly min: Point; readonly max: Point}

/** First contact of a translating circle with a stationary axis-aligned box.
 * Invert relative translation to use the existing exact rectangle-vs-capsule
 * solver: the box translates against a circle at the origin. This preserves
 * rounded corners instead of expanding the box into a larger square. Native
 * article geometry/radius, target eligibility and contact ordering stay with
 * the caller; an AABB here does not establish rotated-terrain fidelity. */
export function sweptCircleBoundsEntry(from: Point, to: Point,
  bounds: ProjectileCircleBounds, radius: number): number | null {
  const coordinates = [from.x, from.y, to.x, to.y,
    bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y, radius];
  if (coordinates.some(value => !Number.isFinite(value)))
    throw new TypeError('Circle sweep requires finite geometry');
  if (radius < 0 || bounds.max.x < bounds.min.x || bounds.max.y < bounds.min.y)
    throw new TypeError('Circle sweep requires nonnegative radius and ordered bounds');
  const width = bounds.max.x - bounds.min.x, height = bounds.max.y - bounds.min.y;
  const centre = {x: bounds.min.x + width / 2, y: bounds.min.y + height / 2};
  return sweptProjectileCapsuleEntry(
    {x: centre.x - from.x, y: centre.y - from.y},
    {x: centre.x - to.x, y: centre.y - to.y},
    {start: {x: 0, y: 0}, end: {x: 0, y: 0}, radius}, {width, height});
}
