import type { AttackCollisionHit } from './attacks';

/** Deliberate 2D projections, separate from native bone-local coordinates.
 * A region on a moving bone must never silently become a generic body anchor.
 * Source observations and remaining approximation: docs/review/2026-10-06/dk-collision/README.md.
 */
export const DK_FORWARD_TILT_REGIONS: readonly AttackCollisionHit[] = [
  { id: 0, capsule: { start: { x: 75, y: -12 }, end: { x: 105, y: -12 }, radius: 27.5 } },
  { id: 1, capsule: { start: { x: 40, y: -12 }, end: { x: 40, y: -12 }, radius: 25 } },
  { id: 2, capsule: { start: { x: 8, y: -15 }, end: { x: 8, y: -15 }, radius: 17.5 } },
];

export function dkAngledTiltRegions(direction: 'up' | 'down'): readonly AttackCollisionHit[] {
  const dy = direction === 'up' ? -18 : 27;
  return DK_FORWARD_TILT_REGIONS.map(hit => ({ ...hit, capsule: { ...hit.capsule,
    start: { ...hit.capsule.start, y: hit.capsule.start.y + dy },
    end: { ...hit.capsule.end, y: hit.capsule.end.y + dy },
  } }));
}

/** The continuing arm/hip regions survive removal of frame 10's root region.
 * Their held projection is an adaptation; native rotating bone motion is not reproduced.
 */
export const DK_NEUTRAL_AIR_BODY_REGIONS: readonly AttackCollisionHit[] = [
  { id: 0, capsule: { start: { x: 40, y: -20 }, end: { x: 40, y: -20 }, radius: 25 } },
  { id: 1, capsule: { start: { x: -30, y: 0 }, end: { x: -30, y: 0 }, radius: 25 } },
  { id: 2, capsule: { start: { x: 8, y: 12 }, end: { x: 8, y: 12 }, radius: 28.5 } },
];

/** Source frame 12 shows two outer forearm regions and two inner arm regions.
 * The native x offsets 6 and -4 are ten units (50 world pixels) apart.
 * This held, symmetric side-on projection keeps that separation; it does not
 * reproduce the animation's rotation or exact 3D transforms.
 */
export const DK_AERIAL_SPIN_ARM_REGIONS: readonly AttackCollisionHit[] = [
  { id: 0, capsule: { start: { x: 85, y: -18 }, end: { x: 85, y: -18 }, radius: 25 } },
  { id: 1, capsule: { start: { x: -85, y: -18 }, end: { x: -85, y: -18 }, radius: 25 } },
  { id: 2, capsule: { start: { x: 35, y: -18 }, end: { x: 35, y: -18 }, radius: 18.5 } },
  { id: 3, capsule: { start: { x: -35, y: -18 }, end: { x: -35, y: -18 }, radius: 18.5 } },
];
