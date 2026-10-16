import type { AttackCollisionHit, HitboxPlugin } from './attacks';

/** Published straight interframe coverage for one persistent point/sphere
 * contact. Native stretched capsules and radius changes stay unqualified. */
export function interpolatePointContactRows(
  rows: readonly AttackCollisionHit[],
  origin: { readonly x: number; readonly y: number },
  facing: 1 | -1,
  previous: HitboxPlugin['previousPointContact'],
): readonly AttackCollisionHit[] {
  if (!previous || !Number.isFinite(previous.position.x)
    || !Number.isFinite(previous.position.y) || !Number.isFinite(previous.radius)
    || !(previous.radius > 0)) return rows;
  return rows.map(row => {
    const { start, end, radius } = row.capsule;
    if (row.id !== previous.hitId || radius !== previous.radius
      || start.x !== end.x || start.y !== end.y) return row;
    return { ...row, capsule: {
      start: { x: (previous.position.x - origin.x) * facing,
        y: previous.position.y - origin.y },
      end: { ...end }, radius,
    } };
  });
}
