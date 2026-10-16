import { describe, expect, it } from 'vitest';
import { capsuleIntersectsBounds } from './attackCollisionShapes';
import { capsulesIntersect, posedCapsule, type CollisionCapsule } from './capsuleGeometry';

const circle = (x: number, y: number, radius: number): CollisionCapsule => ({ start: { x, y }, end: { x, y }, radius });
const horizontal: CollisionCapsule = { start: { x: -10, y: 0 }, end: { x: 10, y: 0 }, radius: 2 };

describe('explicit posed capsule narrowphase', () => {
  it('rejects the false bounding-box corner while keeping a genuine rounded-end contact', () => {
    const corner = circle(12, 2, 0.25);
    expect(capsuleIntersectsBounds(corner, { x: 0, y: 0 }, 1,
      { min: { x: -12, y: -2 }, max: { x: 12, y: 2 } })).toBe(true);
    expect(capsulesIntersect(corner, horizontal)).toBe(false);
    expect(capsulesIntersect(circle(11.5, 1.5, 0.25), horizontal)).toBe(true);
  });

  it('includes exact tangency and rejects a point just outside, in either operand order', () => {
    for (const [probe, expected] of [[circle(12.25, 0, 0.25), true], [circle(12.251, 0, 0.25), false]] as const) {
      expect(capsulesIntersect(probe, horizontal)).toBe(expected);
      expect(capsulesIntersect(horizontal, probe)).toBe(expected);
    }
  });

  it('handles circles, zero radii and coincident endpoints without division by zero', () => {
    expect(capsulesIntersect(circle(0, 0, 1), circle(2, 0, 1))).toBe(true);
    expect(capsulesIntersect(circle(0, 0, 1), circle(2.001, 0, 1))).toBe(false);
    expect(capsulesIntersect(circle(0, 0, 0), circle(0, 0, 0))).toBe(true);
    expect(capsulesIntersect(circle(0, 0, 0), circle(1, 0, 0))).toBe(false);
  });

  it('detects interior crossings and collinear overlaps, excluding separated parallel lines', () => {
    const line: CollisionCapsule = { ...horizontal, radius: 0 };
    expect(capsulesIntersect(line, { start: { x: 0, y: -10 }, end: { x: 0, y: 10 }, radius: 0 })).toBe(true);
    expect(capsulesIntersect(line, { start: { x: 8, y: 0 }, end: { x: 20, y: 0 }, radius: 0 })).toBe(true);
    expect(capsulesIntersect(line, { start: { x: 11, y: 0 }, end: { x: 20, y: 0 }, radius: 0 })).toBe(false);
    expect(capsulesIntersect(horizontal, { start: { x: -5, y: 4 }, end: { x: 5, y: 4 }, radius: 2 })).toBe(true);
    expect(capsulesIntersect(horizontal, { start: { x: -5, y: 4.001 }, end: { x: 5, y: 4.001 }, radius: 2 })).toBe(false);
  });

  it.each([1, -1] as const)('applies explicit defender facing%s to a rotated limb independently of attacker facing', facing => {
    const limb: CollisionCapsule = { start: { x: 30, y: -10 }, end: { x: 40, y: 0 }, radius: 2 };
    const posed = posedCapsule(limb, { x: 100, y: 50 }, facing);
    expect(posed.start).toEqual({ x: 100 + 30 * facing, y: 40 });
    expect(posed.end).toEqual({ x: 100 + 40 * facing, y: 50 });
    const contact = posedCapsule(circle(35, -5, 0.1), { x: 100, y: 50 }, facing);
    const miss = posedCapsule(circle(35, 0, 0.1), { x: 100, y: 50 }, facing);
    expect(capsulesIntersect(contact, posed)).toBe(true);
    expect(capsulesIntersect(miss, posed)).toBe(false);
    expect(limb.start).toEqual({ x: 30, y: -10 });
  });

  it('rejects missing or invalid authored geometry rather than assuming a body rectangle', () => {
    expect(() => capsulesIntersect(circle(NaN, 0, 1), horizontal)).toThrow('finite');
    expect(() => capsulesIntersect(circle(0, 0, -1), horizontal)).toThrow('nonnegative');
    expect(() => posedCapsule(horizontal, { x: Infinity, y: 0 }, 1)).toThrow('finite origin');
  });
});
