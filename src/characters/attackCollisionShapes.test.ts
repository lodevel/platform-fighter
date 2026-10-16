import { describe, expect, it } from 'vitest';
import { capsuleIntersectsBounds, selectAttackCollisionHit } from './attackCollisionShapes';
import { attackSensorGeometry } from './attacks';
import { LINK_JAB, LINK_JAB2, LINK_JAB3, LINK_DTILT, LINK_FAIR } from './Link';

const bounds = (x: number, y: number, half = 0.5) => ({ min: { x: x - half, y: y - half }, max: { x: x + half, y: y + half } });
const origin = { x: 0, y: 0 };
describe('projected source capsule collision', () => {
  it('rejects a circle AABB corner and accepts exact tangency', () => {
    const capsule = { start: origin, end: origin, radius: 5 };
    expect(capsuleIntersectsBounds(capsule, origin, 1, bounds(4.8, 4.8, 0.1))).toBe(false);
    expect(capsuleIntersectsBounds(capsule, origin, 1, bounds(5.5, 0))).toBe(true);
  });
  it('handles diagonal segments, endpoint caps, and an interior crossing', () => {
    const capsule = { start: origin, end: { x: 10, y: 10 }, radius: 1 };
    expect(capsuleIntersectsBounds(capsule, origin, 1, bounds(5, 5))).toBe(true);
    expect(capsuleIntersectsBounds(capsule, origin, 1, bounds(9, 1))).toBe(false);
    expect(capsuleIntersectsBounds(capsule, origin, 1, bounds(10.9, 10.9))).toBe(true);
  });
  it('mirrors coordinates around the actual attacker origin', () => {
    const capsule = { start: { x: 4, y: -2 }, end: { x: 9, y: -2 }, radius: 1 };
    expect(capsuleIntersectsBounds(capsule, { x: 100, y: 50 }, -1, bounds(94, 48))).toBe(true);
    expect(capsuleIntersectsBounds(capsule, { x: 100, y: 50 }, -1, bounds(106, 48))).toBe(false);
  });
  it.each([LINK_JAB, LINK_JAB2])('$id selects lower IDs on overlap and the inward tip only beyond the inner reach', move => {
    const hits = move.hitWindows![0]!.collisionHits!;
    expect(selectAttackCollisionHit([...hits].reverse(), origin, 1, [bounds(45, -4)], true)?.id).toBe(0);
    const outer = move.id === LINK_JAB.id ? 94 : 104;
    const selected = selectAttackCollisionHit(hits, origin, 1, [bounds(outer, -4)], false)!;
    expect(selected.id).toBe(2);
    expect(selected.knockback!.reference).toMatchObject({ base: 20, growth: 15, angle: 180 });
    expect(selectAttackCollisionHit(hits, origin, -1, [bounds(-outer, -4)], true)?.id).toBe(2);
  });
  it('encloses the complete source tip while preserving legacy rectangle fallback', () => {
    expect(attackSensorGeometry(LINK_JAB)).toEqual({ offsetX: 62.5, offsetY: -4, width: 73, height: 18 });
    expect(attackSensorGeometry(LINK_JAB2)).toEqual({ offsetX: 67.5, offsetY: -6.5, width: 85, height: 35 });
    expect(attackSensorGeometry(LINK_JAB3)).toEqual(LINK_JAB3.hitbox);
    expect(attackSensorGeometry({ hitbox: LINK_JAB.hitbox })).toBe(LINK_JAB.hitbox);
  });
  it('uses the diagonal source down-tilt capsule instead of its entire rectangular envelope', () => {
    const capsule = LINK_DTILT.hitWindows![0]!.collisionHits![0]!.capsule;
    expect(capsuleIntersectsBounds(capsule, origin, 1, bounds(55, 20))).toBe(true);
    expect(capsuleIntersectsBounds(capsule, origin, 1, bounds(95, 2))).toBe(false);
  });
  it.each([
    { x: 100, ground: true, id: 0, angle: 43 },
    { x: 60, ground: true, id: 2, angle: 47 },
    { x: 10, ground: true, id: 4, angle: 47 },
    { x: 10, ground: false, id: 5, angle: 38 },
    { x: 100, ground: false, id: 1, angle: 367 },
  ])('fair situation and region select $id at x$x ground$ground', ({ x, ground, id, angle }) => {
    const selected = selectAttackCollisionHit(LINK_FAIR.hitWindows![0]!.collisionHits!, origin, 1,
      [bounds(x, -21.5)], ground)!;
    expect(selected.id).toBe(id);
    expect(selected.knockback?.reference?.angle).toBe(angle);
  });
});
