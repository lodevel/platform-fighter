import type { AttackCollisionHit } from './attacks';
import { capsulesIntersect, posedCapsule, type CollisionCapsule } from './capsuleGeometry';

export type CollisionBounds = { min: { x: number; y: number }; max: { x: number; y: number } };
/** World-space explicit defensive geometry; AABBs remain the legacy path. */
export type CollisionHurtbox = CollisionBounds | CollisionCapsule;
type Point = { readonly x: number; readonly y: number };

/** Exact 2D capsule/axis-aligned hurtbox intersection. A zero-length segment is a circle. */
export function capsuleIntersectsBounds(
  capsule: AttackCollisionHit['capsule'], origin: Point, facing: 1 | -1, bounds: CollisionBounds,
): boolean {
  const a = { x: origin.x + capsule.start.x * facing, y: origin.y + capsule.start.y };
  const b = { x: origin.x + capsule.end.x * facing, y: origin.y + capsule.end.y };
  const dx = b.x - a.x, dy = b.y - a.y;
  let enter = 0, exit = 1;
  for (const axis of ['x', 'y'] as const) {
    const delta = b[axis] - a[axis];
    if (delta === 0) {
      if (a[axis] < bounds.min[axis] || a[axis] > bounds.max[axis]) { enter = Infinity; break; }
    } else {
      const t1 = (bounds.min[axis] - a[axis]) / delta;
      const t2 = (bounds.max[axis] - a[axis]) / delta;
      enter = Math.max(enter, Math.min(t1, t2));
      exit = Math.min(exit, Math.max(t1, t2));
    }
  }
  if (enter <= exit) return true;
  const pointRectangleDistance = (p: Point) => {
    const x = Math.max(bounds.min.x - p.x, 0, p.x - bounds.max.x);
    const y = Math.max(bounds.min.y - p.y, 0, p.y - bounds.max.y);
    return x * x + y * y;
  };
  let distance = Math.min(pointRectangleDistance(a), pointRectangleDistance(b));
  const lengthSquared = dx * dx + dy * dy;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared));
    distance = Math.min(distance, (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2);
  }
  return distance <= capsule.radius ** 2;
}

/** Input order cannot change source priority. All supported records use native part zero. */
export function selectAttackCollisionHit(
  hits: readonly AttackCollisionHit[], origin: Point, facing: 1 | -1,
  hurtboxes: readonly CollisionHurtbox[], grounded: boolean,
): AttackCollisionHit | undefined {
  let selected: AttackCollisionHit | undefined;
  for (const hit of hits) {
    if (hit.situation === 'ground' && !grounded || hit.situation === 'air' && grounded) continue;
    if (selected && selected.id < hit.id) continue;
    if (hurtboxes.some(shape => 'radius' in shape
      ? capsulesIntersect(posedCapsule(hit.capsule, origin, facing), shape)
      : capsuleIntersectsBounds(hit.capsule, origin, facing, shape))) selected = hit;
  }
  return selected;
}
