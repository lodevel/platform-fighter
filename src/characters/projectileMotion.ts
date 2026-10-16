import type { Hurtbox, KnockbackSpec } from './moveSchema';
import { posedCapsule, type CollisionCapsule, type CollisionPoint } from './capsuleGeometry';

/** Fixed-step projectile helpers. Coordinates are physical world pixels, matching Character bodies. */
export interface BoomerangFlight {
  age: number;
  returning: boolean;
  readonly outboundFrames: number;
  readonly returnSpeed: number;
  readonly returnDamage: number;
  readonly returnKnockback?: KnockbackSpec;
  readonly lateOutbound?: { readonly startFrame: number; readonly damage: number; readonly knockback: KnockbackSpec };
  readonly hitTargets: Set<number>;
}

export interface ReflectableProjectile {
  ownerSlotIndex: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  damage: number;
  knockback?: KnockbackSpec;
  attackInstance?: object;
  boomerang?: BoomerangFlight;
}

/** Reflection transfers physical ownership and keeps its boost through a boomerang's return leg. */
export function reflectProjectile(projectile: ReflectableProjectile, ownerSlotIndex: number, damageScale: number, velocityScale: number): void {
  projectile.vx = -projectile.vx * velocityScale;
  projectile.vy *= velocityScale;
  projectile.facing = projectile.facing === 1 ? -1 : 1;
  projectile.damage *= damageScale;
  projectile.ownerSlotIndex = ownerSlotIndex;
  if (projectile.attackInstance) projectile.attackInstance = {};
  if (projectile.boomerang) projectile.boomerang = {
    ...projectile.boomerang, age: 0, returning: false, hitTargets: new Set(),
    returnDamage: projectile.boomerang.returnDamage * damageScale,
    returnSpeed: projectile.boomerang.returnSpeed * velocityScale,
    ...(projectile.boomerang.lateOutbound ? { lateOutbound: {
      ...projectile.boomerang.lateOutbound,
      damage: projectile.boomerang.lateOutbound.damage * damageScale,
    } } : {}),
  };
}

export function advanceBoomerang(
  projectile: { x: number; y: number; vx: number; vy: number; facing: 1 | -1; damage: number; knockback?: KnockbackSpec },
  flight: BoomerangFlight,
  owner: { x: number; y: number } | null,
): boolean {
  flight.age += 1;
  if (!owner) return true;
  // The article's first movement/contact is frame one. Replacing the outbound
  // hit at frame ten keeps the same per-pass target set: it is not another hit.
  if (!flight.returning && flight.lateOutbound && flight.age === flight.lateOutbound.startFrame) {
    projectile.damage = flight.lateOutbound.damage;
    projectile.knockback = flight.lateOutbound.knockback;
  }
  if (!flight.returning && flight.age > flight.outboundFrames) {
    flight.returning = true;
    flight.hitTargets.clear();
    projectile.damage = flight.returnDamage;
    if (flight.returnKnockback) projectile.knockback = flight.returnKnockback;
  }
  if (!flight.returning) return false;
  const dx = owner.x - projectile.x, dy = owner.y - projectile.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= flight.returnSpeed + 12) return true;
  projectile.vx = dx / distance * flight.returnSpeed;
  projectile.vy = dy / distance * flight.returnSpeed;
  projectile.facing = dx < 0 ? -1 : 1;
  return false;
}

/** Segment against an expanded target box; fast arrows cannot tunnel between ticks. */
export function sweptProjectileEntry(
  from: { x: number; y: number }, to: { x: number; y: number },
  target: { x: number; y: number; width: number; height: number },
  projectile: { width: number; height: number },
): number | null {
  const halfX = (target.width + projectile.width) / 2, halfY = (target.height + projectile.height) / 2;
  let enter = 0, leave = 1;
  for (const [start, delta, min, max] of [
    [from.x, to.x - from.x, target.x - halfX, target.x + halfX],
    [from.y, to.y - from.y, target.y - halfY, target.y + halfY],
  ] as const) {
    if (Math.abs(delta) < 1e-9) { if (start < min || start > max) return null; continue; }
    const a = (min - start) / delta, b = (max - start) / delta;
    enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return null;
  }
  return enter;
}

export function sweptProjectileContact(
  from: { x: number; y: number }, to: { x: number; y: number },
  target: { x: number; y: number; width: number; height: number },
  projectile: { width: number; height: number },
): boolean {
  return sweptProjectileEntry(from, to, target, projectile) !== null;
}

function cross(a: CollisionPoint, b: CollisionPoint, c: CollisionPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** The segment/rectangle Minkowski sum has at most six hull vertices. */
function capsuleRectangleCore(target: CollisionCapsule, halfX: number, halfY: number): CollisionPoint[] {
  const points = [target.start, target.end].flatMap(point => [
    { x: point.x - halfX, y: point.y - halfY }, { x: point.x - halfX, y: point.y + halfY },
    { x: point.x + halfX, y: point.y - halfY }, { x: point.x + halfX, y: point.y + halfY },
  ]).sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((point, index, sorted) => index === 0 || point.x !== sorted[index - 1]!.x || point.y !== sorted[index - 1]!.y);
  if (points.length <= 1) return points;
  const halfHull = (ordered: readonly CollisionPoint[]) => {
    const hull: CollisionPoint[] = [];
    for (const point of ordered) {
      while (hull.length >= 2 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, point) <= 0) hull.pop();
      hull.push(point);
    }
    return hull.slice(0, -1);
  };
  return [...halfHull(points), ...halfHull([...points].reverse())];
}

function circleEntry(from: CollisionPoint, to: CollisionPoint, center: CollisionPoint, radius: number): number | null {
  const x = from.x - center.x, y = from.y - center.y;
  const dx = to.x - from.x, dy = to.y - from.y;
  const radiusSquared = radius * radius;
  if (x * x + y * y <= radiusSquared) return 0;
  const speedSquared = dx * dx + dy * dy;
  if (speedSquared === 0) return null;
  // Resolve the line's closest point and chord analytically. The cross product
  // avoids subtracting almost-equal squared distances in a fast tangent sweep.
  const perpendicular = x * dy - y * dx;
  const chordSquared = radiusSquared - perpendicular * perpendicular / speedSquared;
  if (chordSquared < 0) return null;
  const middle = -(x * dx + y * dy) / speedSquared;
  const halfChord = Math.sqrt(chordSquared / speedSquared);
  const enter = middle - halfChord, leave = middle + halfChord;
  return leave < 0 || enter > 1 ? null : Math.max(0, enter);
}

function stripEntry(
  from: CollisionPoint, to: CollisionPoint, start: CollisionPoint, end: CollisionPoint, radius: number,
): number | null {
  const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const x = from.x - start.x, y = from.y - start.y;
  const travelX = to.x - from.x, travelY = to.y - from.y;
  let enter = 0, leave = 1;
  for (const [value, delta, min, max] of [
    [(x * dx + y * dy) / length, (travelX * dx + travelY * dy) / length, 0, length],
    [(dx * y - dy * x) / length, (dx * travelY - dy * travelX) / length, -radius, radius],
  ] as const) {
    if (delta === 0) { if (value < min || value > max) return null; continue; }
    const a = (min - value) / delta, b = (max - value) / delta;
    enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return null;
  }
  return enter;
}

function polygonEntry(from: CollisionPoint, to: CollisionPoint, polygon: readonly CollisionPoint[]): number | null {
  let enter = 0, leave = 1;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!, b = polygon[(index + 1) % polygon.length]!;
    const value = cross(a, b, from);
    const delta = (b.x - a.x) * (to.y - from.y) - (b.y - a.y) * (to.x - from.x);
    if (delta === 0) { if (value < 0) return null; continue; }
    const boundary = -value / delta;
    if (delta > 0) enter = Math.max(enter, boundary); else leave = Math.min(leave, boundary);
    if (enter > leave) return null;
  }
  return enter;
}

/** Earliest exact continuous contact of a translating axis-aligned projectile
 * rectangle with an explicitly posed capsule. The center travels through the
 * segment/rectangle Minkowski sum dilated by the capsule radius: a convex core,
 * straight edge strips and rounded vertex circles. Analytical clipping/chord
 * roots retain genuine fast and tangent contacts without using the enclosing
 * AABB or sampled travel positions as the final contact shape. */
export function sweptProjectileCapsuleEntry(
  from: CollisionPoint, to: CollisionPoint, target: CollisionCapsule,
  projectile: { width: number; height: number },
): number | null {
  if (![from.x, from.y, to.x, to.y, target.start.x, target.start.y, target.end.x, target.end.y,
    target.radius, projectile.width, projectile.height].every(Number.isFinite)
    || target.radius < 0 || projectile.width < 0 || projectile.height < 0) {
    throw new Error('Projectile capsule sweep requires finite geometry and nonnegative sizes');
  }
  const core = capsuleRectangleCore(target, projectile.width / 2, projectile.height / 2);
  let earliest = core.length >= 3 ? polygonEntry(from, to, core) : null;
  const include = (entry: number | null) => {
    if (entry !== null && (earliest === null || entry < earliest)) earliest = entry;
  };
  for (let index = 0; index < core.length; index++) {
    const vertex = core[index]!;
    include(circleEntry(from, to, vertex, target.radius));
    if (core.length >= 2) include(stripEntry(from, to, vertex, core[(index + 1) % core.length]!, target.radius));
  }
  return earliest;
}

export function sweptProjectileCapsuleContact(
  from: CollisionPoint, to: CollisionPoint, target: CollisionCapsule,
  projectile: { width: number; height: number },
): boolean {
  return sweptProjectileCapsuleEntry(from, to, target, projectile) !== null;
}

/** Earliest entry of a circle of `radius` travelling `from` -> `to` into a fighter's tangible hurtboxes
 * (capsules, or boxes around the body centre `position`), with the struck hurtbox's damage multiplier.
 * With `from` equal to `to` it is an overlap test (fraction 0). */
export function sweptHurtboxEntry(hurtboxes: readonly Hurtbox[], position: CollisionPoint, facing: 1 | -1,
  from: CollisionPoint, to: CollisionPoint, radius: number): { fraction: number; damageMultiplier: number } | null {
  let nearest: { fraction: number; damageMultiplier: number } | null = null;
  for (const hurtbox of hurtboxes) {
    if (hurtbox.intangible) continue;
    const posed = hurtbox.capsule ? posedCapsule(hurtbox.capsule, position, facing) : null;
    const centre = { x: position.x + hurtbox.offsetX * facing, y: position.y + hurtbox.offsetY };
    const fraction = posed
      ? sweptProjectileCapsuleEntry(from, to, { ...posed, radius: posed.radius + radius }, { width: 0, height: 0 })
      : sweptProjectileCapsuleEntry(from, to, { start: centre, end: centre, radius }, { width: hurtbox.width, height: hurtbox.height });
    if (fraction !== null && (!nearest || fraction < nearest.fraction)) nearest = { fraction, damageMultiplier: hurtbox.damageMultiplier ?? 1 };
  }
  return nearest;
}

export interface ProjectileContact {
  readonly fraction: number;
  readonly kind: 'absorber' | 'reflector' | 'hurtbox' | 'container' | 'final-resource' | 'passive-shield' | 'terrain';
  readonly playerIndex: number;
}

/** Travel order wins across players and contact types; exact ties favor reflection. */
export function orderProjectileContacts<T extends ProjectileContact>(contacts: readonly T[]): T[] {
  // Exact overlap ties resolve reflection first, then the fighter receiving
  // contact, then a world item, then terrain. The item tie rank is an authored arbitration.
  const rank = { absorber:0,reflector: 0, hurtbox: 1, 'passive-shield':1, container: 2, 'final-resource': 3, terrain: 4 };
  return [...contacts].sort((a, b) => a.fraction - b.fraction
    || rank[a.kind] - rank[b.kind]
    || a.playerIndex - b.playerIndex
    || (a.kind===b.kind?0:a.kind==='absorber'?-1:b.kind==='absorber'?1:a.kind==='passive-shield'?-1:b.kind==='passive-shield'?1:0));
}
