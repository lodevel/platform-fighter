/** Explicit posed 2D geometry. This module performs no skeletal inference,
 * native size conversion or body-centre fallback. */
export interface CollisionPoint { readonly x: number; readonly y: number }
export interface CollisionCapsule {
  readonly start: CollisionPoint;
  readonly end: CollisionPoint;
  readonly radius: number;
}

function validateCapsule(capsule: CollisionCapsule): void {
  if (![capsule.start.x, capsule.start.y, capsule.end.x, capsule.end.y, capsule.radius].every(Number.isFinite)
    || capsule.radius < 0) throw new Error('Collision capsule requires finite points and nonnegative radius');
}

export function posedCapsule(capsule: CollisionCapsule, origin: CollisionPoint, facing: 1 | -1): CollisionCapsule {
  validateCapsule(capsule);
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y) || (facing !== 1 && facing !== -1)) {
    throw new Error('Collision capsule requires finite origin and explicit facing');
  }
  return { start: { x: origin.x + capsule.start.x * facing, y: origin.y + capsule.start.y },
    end: { x: origin.x + capsule.end.x * facing, y: origin.y + capsule.end.y }, radius: capsule.radius };
}

/** Broadphase enclosure only; exact contact still uses the capsule. */
export function capsuleBounds(capsule: CollisionCapsule) {
  validateCapsule(capsule);
  return { min: { x: Math.min(capsule.start.x, capsule.end.x) - capsule.radius,
    y: Math.min(capsule.start.y, capsule.end.y) - capsule.radius },
    max: { x: Math.max(capsule.start.x, capsule.end.x) + capsule.radius,
      y: Math.max(capsule.start.y, capsule.end.y) + capsule.radius } };
}

function pointSegmentDistanceSquared(point: CollisionPoint, start: CollisionPoint, end: CollisionPoint): number {
  const dx = end.x - start.x, dy = end.y - start.y;
  const squaredLength = dx * dx + dy * dy;
  const fraction = squaredLength === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength));
  return (point.x - start.x - fraction * dx) ** 2 + (point.y - start.y - fraction * dy) ** 2;
}

function orientation(a: CollisionPoint, b: CollisionPoint, c: CollisionPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function oppositeSigns(a: number, b: number): boolean {
  return a < 0 && b > 0 || a > 0 && b < 0;
}

/** Exact 2D capsule/capsule narrowphase under the engine's scalar arithmetic.
 * Inclusive tangency, zero-length circles, parallel/collinear segments and
 * interior crossings are supported; no AABB-corner substitution. */
export function capsulesIntersect(a: CollisionCapsule, b: CollisionCapsule): boolean {
  validateCapsule(a); validateCapsule(b);
  const crossing = oppositeSigns(orientation(a.start, a.end, b.start), orientation(a.start, a.end, b.end))
    && oppositeSigns(orientation(b.start, b.end, a.start), orientation(b.start, b.end, a.end));
  const squaredDistance = crossing ? 0 : Math.min(
    pointSegmentDistanceSquared(a.start, b.start, b.end),
    pointSegmentDistanceSquared(a.end, b.start, b.end),
    pointSegmentDistanceSquared(b.start, a.start, a.end),
    pointSegmentDistanceSquared(b.end, a.start, a.end),
  );
  return squaredDistance <= (a.radius + b.radius) ** 2;
}
