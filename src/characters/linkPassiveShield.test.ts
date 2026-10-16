/** Prepared for the single final verification stage; not run during authoring.
 * Analytical fixtures exercise this engine's posed-geometry adapter. They do
 * not establish native shield geometry, source eligibility or live Scene use.
 */
import { describe, expect, it } from 'vitest';
import { linkPassiveShieldSurfaces, linkPassiveShieldWorldSurfaces, sweepLinkPassiveShield,
  type LinkPassiveShieldSurface } from './linkPassiveShield';
import { linkPassiveShieldCanIntercept } from './linkEquipment';

const shield: LinkPassiveShieldSurface = {
  id: 'held-shield', start: { x: 10, y: -5 }, end: { x: 10, y: 5 }, radius: 1,
};
const base = { surfacesWorld: [shield], from: { x: 20, y: 0 }, to: { x: 0, y: 0 }, projectile: { radius: 2 } };

describe('Link posed passive-shield continuous contact', () => {
  it('admits reflectable blockable contact regardless of detached identity, without admitting nonreflectable packets', () => {
    expect(linkPassiveShieldCanIntercept({ reflectable: true, isProjectile: false, unblockable: false }, true)).toBe(true);
    expect(linkPassiveShieldCanIntercept({ reflectable: false, isProjectile: true, unblockable: false }, true)).toBe(false);
    expect(linkPassiveShieldCanIntercept({ reflectable: true, isProjectile: true, unblockable: true }, true)).toBe(false);
    expect(linkPassiveShieldCanIntercept({ reflectable: true, isProjectile: true, unblockable: false }, false)).toBe(false);
  });

  it('catches a fast circle at its first edge contact rather than its final position', () => {
    const hit = sweepLinkPassiveShield(base)!;
    expect(hit.fraction).toBeCloseTo(0.35, 12);
    expect(hit.projectileCentre.x).toBeCloseTo(13, 12);
    expect(hit.worldContact.x).toBeCloseTo(11, 12);
    expect(hit.worldContact.y).toBe(0);
    expect(hit.surfaceId).toBe('held-shield');
  });

  it('keeps rectangular projectile contact separate from its centre and the shield grip', () => {
    const hit = sweepLinkPassiveShield({ ...base, projectile: { width: 4, height: 2 } })!;
    expect(hit.fraction).toBeCloseTo(0.35, 12);
    expect(hit.projectileCentre.x).toBeCloseTo(13, 12);
    expect(hit.worldContact.x).toBeCloseTo(11, 12);
  });

  it('respects an earlier body hit, with shield priority only at an exact own-body tie', () => {
    const fraction = sweepLinkPassiveShield(base)!.fraction;
    expect(sweepLinkPassiveShield({ ...base, bodyContactFraction: fraction - 0.01 })).toBeNull();
    expect(sweepLinkPassiveShield({ ...base, bodyContactFraction: fraction })!.fraction).toBe(fraction);
    expect(sweepLinkPassiveShield({ ...base, bodyContactFraction: fraction + 0.01 })!.fraction).toBe(fraction);
  });

  it('orders a surface union by travel distance instead of supplied array order', () => {
    const near = { ...shield, id: 'near-edge', start: { x: 15, y: -5 }, end: { x: 15, y: 5 } };
    const hit = sweepLinkPassiveShield({ ...base, surfacesWorld: [shield, near] })!;
    expect(hit.surfaceId).toBe('near-edge');
    expect(hit.fraction).toBeCloseTo(0.1, 12);
    expect(hit.worldContact.x).toBeCloseTo(16, 12);
  });

  it('retains rounded circle contact and misses beyond its cap instead of using an enclosing square', () => {
    const cap = { id: 'cap', start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 1 };
    const input = { surfacesWorld: [cap], from: { x: 5, y: 1.9 }, to: { x: -5, y: 1.9 }, projectile: { radius: 1 } };
    const hit = sweepLinkPassiveShield(input)!;
    expect(hit.fraction).toBeCloseTo((5 - Math.sqrt(0.39)) / 10, 12);
    expect(Math.hypot(hit.worldContact.x, hit.worldContact.y)).toBeCloseTo(1, 12);
    expect(sweepLinkPassiveShield({ ...input, from: { x: 5, y: 2.01 }, to: { x: -5, y: 2.01 } })).toBeNull();
  });

  it('adds the actor root to already mirrored geometry once', () => {
    const left = { ...shield, start: { x: -10, y: -5 }, end: { x: -10, y: 5 } };
    const surfacesWorld = linkPassiveShieldWorldSurfaces([left], { x: 100, y: 30 });
    expect(surfacesWorld[0]!.start).toEqual({ x: 90, y: 25 });
    const hit = sweepLinkPassiveShield({ surfacesWorld, from: { x: 80, y: 30 }, to: { x: 100, y: 30 }, projectile: { radius: 2 } })!;
    expect(hit.fraction).toBeCloseTo(0.35, 12);
    expect(hit.worldContact.x).toBeCloseTo(89, 12);
    expect(hit.worldContact.y).toBe(30);
  });

  it('handles stationary actual overlap and leaves missing surface harmless', () => {
    const hit = sweepLinkPassiveShield({ ...base, from: { x: 10, y: 0 }, to: { x: 10, y: 0 } })!;
    expect(hit.fraction).toBe(0);
    expect(hit.worldContact).toEqual({ x: 10, y: 0 });
    expect(sweepLinkPassiveShield({ ...base, surfacesWorld: [] })).toBeNull();
  });

  it('rejects nonfinite operands and ambiguous surfaces before tolerance or contact acceptance', () => {
    expect(() => sweepLinkPassiveShield({ ...base, from: { x: NaN, y: 0 } })).toThrow();
    expect(() => sweepLinkPassiveShield({ ...base, projectile: { radius: Infinity } })).toThrow();
    expect(() => sweepLinkPassiveShield({ ...base, bodyContactFraction: -0.1 })).toThrow();
    expect(() => sweepLinkPassiveShield({ ...base, surfacesWorld: [shield, shield] })).toThrow();
    expect(() => sweepLinkPassiveShield({ ...base, surfacesWorld: [{ ...shield, radius: 0 }] })).toThrow();
  });
});

describe('Link passive shield: one capsule per eligible state', () => {
  it('mirrors the root-relative capsule by facing and lowers it for the crouch', () => {
    const [right] = linkPassiveShieldSurfaces('standing', 1), [left] = linkPassiveShieldSurfaces('standing', -1);
    expect(right!.start.x).toBeGreaterThan(0);
    expect(left!.start.x).toBe(-right!.start.x);
    expect(linkPassiveShieldSurfaces('walking', 1)).toEqual(linkPassiveShieldSurfaces('standing', 1));
    const [crouch] = linkPassiveShieldSurfaces('crouching', 1);
    expect(crouch!.start.y).toBeGreaterThan(right!.start.y);
    expect(crouch!.radius).toBe(right!.radius);
  });
});
