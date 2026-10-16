/** Link's passive-shield geometry, separate from his receiving body. Eligibility,
 * projectile response and pushback are caller policies; a contact here does not
 * reflect, damage or retire anything.
 */
import type { CollisionCapsule, CollisionPoint } from './capsuleGeometry';
import { sweptProjectileCapsuleEntry } from './projectileMotion';

export interface LinkPassiveShieldSurface extends CollisionCapsule {
  readonly id: string;
}

export interface LinkPassiveShieldContact {
  readonly fraction: number;
  readonly surfaceId: string;
  /** Projectile centre at the first continuous contact, not the shield grip. */
  readonly projectileCentre: CollisionPoint;
  /** Meeting point inside the posed shield and the projectile's contact shape. */
  readonly worldContact: CollisionPoint;
}

export type LinkPassiveShieldProjectileShape =
  | { readonly radius: number }
  | { readonly width: number; readonly height: number };

/** Link's passive shield blocks reflectable projectiles while he stands, walks or crouches
 * (SmashWiki Link (SSBU) Shield). One root-relative capsule per state, facing right:
 * - standing: the bounds of the authored a00wait1 shield outline (21 capsules, x 10.9..25.6,
 *   y -71.2..-35.9; rework/art-support/texture-area-statistics-v1/installedFrames.snapshot.json);
 * - walking: the standing capsule (no walk outline was authored);
 * - crouching: the standing capsule scaled to the squat drawing (a05squatwait 144 px / a00wait1 216 px tall).
 */
export type LinkPassiveShieldState = 'standing' | 'walking' | 'crouching';
const STANDING: LinkPassiveShieldSurface = Object.freeze({ id: 'shield',
  start: Object.freeze({ x: 18.25, y: -64.2 }), end: Object.freeze({ x: 18.25, y: -43.0 }), radius: 7.35 });
const CROUCH_SCALE = 144 / 216;
const LINK_PASSIVE_SHIELD: Readonly<Record<LinkPassiveShieldState, LinkPassiveShieldSurface>> = Object.freeze({
  standing: STANDING, walking: STANDING,
  crouching: Object.freeze({ id: 'shield', radius: STANDING.radius,
    start: Object.freeze({ x: STANDING.start.x, y: STANDING.start.y * CROUCH_SCALE }),
    end: Object.freeze({ x: STANDING.end.x, y: STANDING.end.y * CROUCH_SCALE }) }),
});
/** The state's capsule, mirrored by facing, still root-relative. */
export function linkPassiveShieldSurfaces(state: LinkPassiveShieldState, facing: 1 | -1): readonly LinkPassiveShieldSurface[] {
  const c = LINK_PASSIVE_SHIELD[state];
  return Object.freeze([Object.freeze({ id: c.id, radius: c.radius,
    start: Object.freeze({ x: c.start.x * facing, y: c.start.y }), end: Object.freeze({ x: c.end.x * facing, y: c.end.y }) })]);
}

function finitePoint(point: CollisionPoint, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new TypeError(`Link passive shield requires finite ${label}`);
}

/** The surfaces are already mirrored. Add the actor ROOT once, with no additional
 * LR flip, body-centre offset or fixed hull. */
export function linkPassiveShieldWorldSurfaces(
  surfaces: readonly LinkPassiveShieldSurface[], actorRoot: CollisionPoint,
): readonly LinkPassiveShieldSurface[] {
  finitePoint(actorRoot, 'actor root');
  return Object.freeze(surfaces.map(surface => {
    validateSurface(surface);
    const start = { x: actorRoot.x + surface.start.x, y: actorRoot.y + surface.start.y };
    const end = { x: actorRoot.x + surface.end.x, y: actorRoot.y + surface.end.y };
    finitePoint(start, 'world surface start'); finitePoint(end, 'world surface end');
    return Object.freeze({ id: surface.id, start: Object.freeze(start), end: Object.freeze(end), radius: surface.radius });
  }));
}

function validateSurface(surface: LinkPassiveShieldSurface): void {
  finitePoint(surface.start, 'surface start'); finitePoint(surface.end, 'surface end');
  if (typeof surface.id !== 'string' || surface.id.trim().length === 0 ||
    !Number.isFinite(surface.radius) || surface.radius <= 0)
    throw new TypeError('Link passive shield requires a named surface and positive finite radius');
}

/** Closest segment/rectangle points. Rectangle-axis crossings partition the
 * distance into convex quadratics; endpoints and each interval's minimum
 * suffice. This finds the actual meeting point without using an AABB corner
 * as the shield or sampling a fast projectile's travelled positions.
 */
function contactPoint(surface: LinkPassiveShieldSurface, centre: CollisionPoint,
  size: { readonly width: number; readonly height: number }): CollisionPoint {
  const minX = centre.x - size.width / 2, maxX = centre.x + size.width / 2;
  const minY = centre.y - size.height / 2, maxY = centre.y + size.height / 2;
  const dx = surface.end.x - surface.start.x, dy = surface.end.y - surface.start.y;
  const breaks = [0, 1];
  for (const [start, delta, lower, upper] of [
    [surface.start.x, dx, minX, maxX], [surface.start.y, dy, minY, maxY],
  ] as const) {
    if (delta === 0) continue;
    for (const bound of [lower, upper]) {
      const t = (bound - start) / delta;
      if (t > 0 && t < 1) breaks.push(t);
    }
  }
  breaks.sort((a, b) => a - b);
  const candidates = [...breaks];
  for (let i = 1; i < breaks.length; i++) {
    const lower = breaks[i - 1]!, upper = breaks[i]!, middle = (lower + upper) / 2;
    let quadratic = 0, linear = 0;
    for (const [start, delta, lo, hi] of [
      [surface.start.x, dx, minX, maxX], [surface.start.y, dy, minY, maxY],
    ] as const) {
      const value = start + middle * delta;
      const edge = value < lo ? lo : value > hi ? hi : null;
      if (edge !== null) { quadratic += delta * delta; linear += delta * (start - edge); }
    }
    if (quadratic > 0) candidates.push(Math.max(lower, Math.min(upper, -linear / quadratic)));
  }
  let best = Number.POSITIVE_INFINITY, onSegment: CollisionPoint = surface.start;
  let onProjectile: CollisionPoint = centre;
  for (const t of candidates) {
    const q = { x: surface.start.x + t * dx, y: surface.start.y + t * dy };
    const p = { x: Math.max(minX, Math.min(maxX, q.x)), y: Math.max(minY, Math.min(maxY, q.y)) };
    const distance = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
    if (distance < best) { best = distance; onSegment = q; onProjectile = p; }
  }
  if (!Number.isFinite(best)) throw new TypeError('Link passive shield derived contact must be finite');
  const distance = Math.sqrt(best);
  // At entry the two shapes touch. Initial overlap may be inside the shield;
  // retain that actual overlapping point instead of inventing a face normal.
  if (distance <= surface.radius) return Object.freeze(onProjectile);
  const ratio = surface.radius / distance;
  return Object.freeze({ x: onSegment.x + (onProjectile.x - onSegment.x) * ratio,
    y: onSegment.y + (onProjectile.y - onSegment.y) * ratio });
}

/** Earliest continuous circle/rectangle contact with an already eligible
 * shield. A prior body hit wins; an exact same-owner tie favours the shield.
 * Other players, reflectors, terrain and projectile-specific responses remain
 * in the Scene's shared contact arbitration, never reordered by this leaf.
 */
export function sweepLinkPassiveShield(input: {
  readonly surfacesWorld: readonly LinkPassiveShieldSurface[];
  readonly from: CollisionPoint;
  readonly to: CollisionPoint;
  readonly projectile: LinkPassiveShieldProjectileShape;
  readonly bodyContactFraction?: number | null;
}): LinkPassiveShieldContact | null {
  finitePoint(input.from, 'sweep start'); finitePoint(input.to, 'sweep end');
  const projectileRadius = 'radius' in input.projectile ? input.projectile.radius : 0;
  const rectangle = 'radius' in input.projectile ? { width: 0, height: 0 } : input.projectile;
  if (![projectileRadius, rectangle.width, rectangle.height].every(Number.isFinite) ||
    projectileRadius < 0 || rectangle.width < 0 || rectangle.height < 0)
    throw new TypeError('Link passive shield projectile size must be finite and nonnegative');
  const body = input.bodyContactFraction;
  if (body != null && (!Number.isFinite(body) || body < 0 || body > 1))
    throw new TypeError('Link passive shield body contact fraction must be in [0,1]');
  const ids = new Set<string>();
  let result: LinkPassiveShieldContact | null = null;
  for (const surface of input.surfacesWorld) {
    validateSurface(surface);
    if (ids.has(surface.id)) throw new TypeError('Link passive shield surface IDs must be unique');
    ids.add(surface.id);
    // Source circles dilate the capsule, rather than becoming a square and
    // falsely blocking corners. Existing rectangular articles retain their
    // actual rectangle/capsule Minkowski sweep.
    const fraction = sweptProjectileCapsuleEntry(input.from, input.to,
      { ...surface, radius: surface.radius + projectileRadius }, rectangle);
    if (fraction === null) continue;
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1)
      throw new TypeError('Link passive shield derived contact fraction must be in [0,1]');
    if ((body != null && fraction > body) || (result !== null && fraction >= result.fraction)) continue;
    const projectileCentre = Object.freeze({ x: input.from.x + (input.to.x - input.from.x) * fraction,
      y: input.from.y + (input.to.y - input.from.y) * fraction });
    finitePoint(projectileCentre, 'derived projectile centre');
    result = Object.freeze({ fraction, surfaceId: surface.id, projectileCentre,
      worldContact: contactPoint(surface, projectileCentre, rectangle) });
  }
  return result;
}
