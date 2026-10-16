import { describe, expect, it } from 'vitest';
import { advanceBoomerang, orderProjectileContacts, reflectProjectile, sweptProjectileCapsuleContact, sweptProjectileCapsuleEntry, sweptProjectileContact, sweptProjectileEntry, type BoomerangFlight, type ReflectableProjectile } from './projectileMotion';
import { posedCapsule } from './capsuleGeometry';

describe('fixed-step projectile motion', () => {
  it('returns to a moving owner after its outward flight and permits one fresh return pass', () => {
    const p = { x: 30, y: 0, vx: 10, vy: 0, facing: 1 as const, damage: 8 };
    const f: BoomerangFlight = { age: 0, returning: false, outboundFrames: 3, returnSpeed: 12, returnDamage: 3, hitTargets: new Set([2]) };
    for (let i = 0; i < 3; i++) { expect(advanceBoomerang(p, f, { x: 0, y: 0 })).toBe(false); p.x += p.vx; }
    expect(f.hitTargets.has(2)).toBe(true);
    advanceBoomerang(p, f, { x: -20, y: -20 });
    expect(f.returning).toBe(true); expect(f.hitTargets.size).toBe(0);
    expect(p.damage).toBe(3); expect(p.vx).toBeLessThan(0); expect(p.vy).toBeLessThan(0);
    expect(advanceBoomerang(p, f, { x: p.x, y: p.y })).toBe(true);
  });
  it('removes a boomerang whose owner has left the match', () => {
    expect(advanceBoomerang({ x: 0, y: 0, vx: 10, vy: 0, facing: 1, damage: 8 },
      { age: 0, returning: false, outboundFrames: 10, returnSpeed: 12, returnDamage: 3, hitTargets: new Set() }, null)).toBe(true);
  });
  it('detects a fast projectile crossing a narrow fighter without endpoint overlap', () => {
    expect(sweptProjectileContact({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0, width: 10, height: 20 }, { width: 4, height: 4 })).toBe(true);
    expect(sweptProjectileContact({ x: 0, y: 30 }, { x: 100, y: 30 }, { x: 50, y: 0, width: 10, height: 20 }, { width: 4, height: 4 })).toBe(false);
  });

  it.each([false, true])('orders two crossed targets by distance regardless of roster order (reversed=%s)', reversed => {
    const targets = [{ playerIndex: 1, x: 80 }, { playerIndex: 3, x: 30 }];
    if (reversed) targets.reverse();
    const contacts = targets.map(target => ({ playerIndex: target.playerIndex, kind: 'hurtbox' as const,
      fraction: sweptProjectileEntry({ x: 0, y: 0 }, { x: 100, y: 0 },
        { x: target.x, y: 0, width: 10, height: 20 }, { width: 4, height: 4 })! }));
    expect(orderProjectileContacts(contacts).map(contact => contact.playerIndex)).toEqual([3, 1]);
    expect(orderProjectileContacts(contacts)[0]!.fraction).toBeCloseTo(0.23);
  });

  it('does not let a farther reflector preempt a nearer hurtbox, while exact ties favor reflection', () => {
    const contacts = [
      { playerIndex: 1, kind: 'reflector' as const, fraction: 0.7 },
      { playerIndex: 1, kind: 'hurtbox' as const, fraction: 0.7 },
      { playerIndex: 3, kind: 'hurtbox' as const, fraction: 0.2 },
    ];
    expect(orderProjectileContacts(contacts)).toEqual([contacts[2], contacts[0], contacts[1]]);
    expect(orderProjectileContacts([...contacts].reverse())).toEqual([contacts[2], contacts[0], contacts[1]]);
  });

  it('measures entry in either flight direction and handles initial overlap and misses', () => {
    const target = { x: 30, y: 0, width: 10, height: 20 }, size = { width: 4, height: 4 };
    expect(sweptProjectileEntry({ x: 100, y: 0 }, { x: 0, y: 0 }, target, size)).toBeCloseTo(0.63);
    expect(sweptProjectileEntry({ x: 30, y: 0 }, { x: 30, y: 0 }, target, size)).toBe(0);
    expect(sweptProjectileEntry({ x: 0, y: 30 }, { x: 100, y: 30 }, target, size)).toBeNull();
  });

  it('reflects a swept crossing, transfers ownership and retains boosts on the return pass', () => {
    const projectile: ReflectableProjectile & { x: number; y: number } = {
      x: 300, y: 10, ownerSlotIndex: 0, vx: 300, vy: 0, facing: 1, damage: 8,
      boomerang: { age: 3, returning: false, outboundFrames: 3, returnSpeed: 12, returnDamage: 3, hitTargets: new Set([2]) },
    };
    const crossedReflector = sweptProjectileContact({ x: 0, y: 10 }, projectile,
      { x: 100, y: 10, width: 30, height: 30 }, { width: 8, height: 8 });
    expect(crossedReflector).toBe(true);
    reflectProjectile(projectile, 2, 1.5, 1.2);
    expect(projectile).toMatchObject({ ownerSlotIndex: 2, vx: -360, facing: -1, damage: 12 });
    expect(projectile.boomerang?.hitTargets.size).toBe(0);
    for (let frame = 0; frame < 4; frame++) advanceBoomerang(projectile, projectile.boomerang!, { x: 100, y: 10 });
    expect(projectile.boomerang?.returning).toBe(true);
    expect(projectile.damage).toBe(4.5);
    expect(Math.hypot(projectile.vx, projectile.vy)).toBeCloseTo(14.4);
  });
});

describe('continuous projectile rectangle against an authored capsule', () => {
  const vertical = { start: { x: 0, y: -10 }, end: { x: 0, y: 10 }, radius: 2 };
  const size = { width: 2, height: 2 };

  it('rejects an enclosing-box corner contact, including an entire outward sweep', () => {
    const from = { x: 2.9, y: 12.9 }, to = { x: 102.9, y: 112.9 };
    expect(sweptProjectileEntry(from, to, { x: 0, y: 0, width: 4, height: 24 }, size)).toBe(0);
    expect(sweptProjectileCapsuleEntry(from, from, vertical, size)).toBeNull();
    expect(sweptProjectileCapsuleContact(from, to, vertical, size)).toBe(false);
  });

  it('finds rounded-end contact during a fast sweep with both endpoints outside', () => {
    const from = { x: -100, y: 12.5 }, to = { x: 100, y: 12.5 };
    expect(sweptProjectileCapsuleContact(from, from, vertical, size)).toBe(false);
    expect(sweptProjectileCapsuleContact(to, to, vertical, size)).toBe(false);
    // The nearest expanded-core corner is (-1,11), with dy=1.5 and radius2.
    expect(sweptProjectileCapsuleEntry(from, to, vertical, size)).toBeCloseTo((99 - Math.sqrt(1.75)) / 200, 12);
  });

  it('retains inclusive endpoint tangency and distinguishes a nearby miss', () => {
    const target = { start: { x: 0, y: -5 }, end: { x: 0, y: 5 }, radius: 2 };
    expect(sweptProjectileCapsuleEntry({ x: 3, y: -20 }, { x: 3, y: 20 }, target, size)).toBeCloseTo(0.35, 12);
    expect(sweptProjectileCapsuleEntry({ x: 3.0001, y: -20 }, { x: 3.0001, y: 20 }, target, size)).toBeNull();
  });

  it('handles a zero-length circle and exact rounded projectile corners', () => {
    const circle = { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 2 };
    const rectangle = { width: 4, height: 2 };
    expect(sweptProjectileCapsuleEntry({ x: -10, y: 0 }, { x: 10, y: 0 }, circle, rectangle)).toBeCloseTo(0.3, 12);
    expect(sweptProjectileCapsuleEntry({ x: -10, y: 2 }, { x: 10, y: 2 }, circle, rectangle)).toBeCloseTo((8 - Math.sqrt(3)) / 20, 12);
    expect(sweptProjectileCapsuleEntry({ x: -10, y: 3 }, { x: 10, y: 3 }, circle, rectangle)).toBeCloseTo(0.4, 12);
    expect(sweptProjectileCapsuleEntry({ x: -10, y: 3.0001 }, { x: 10, y: 3.0001 }, circle, rectangle)).toBeNull();
  });

  it.each([1, -1] as const)('sweeps a rotated capsule with mirrored facing %s', facing => {
    const target = posedCapsule({ start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, radius: 1 }, { x: 0, y: 0 }, facing);
    const from = { x: -10 * facing, y: 5 }, to = { x: 20 * facing, y: 5 };
    const entry = (13 - Math.sqrt(2)) / 30;
    expect(sweptProjectileCapsuleEntry(from, to, target, size)).toBeCloseTo(entry, 12);
    expect(sweptProjectileCapsuleEntry(from, to, { ...target, start: target.end, end: target.start }, size)).toBeCloseTo(entry, 12);
    const before = { x: from.x + (to.x - from.x) * (entry - 1e-5), y: 5 };
    const after = { x: from.x + (to.x - from.x) * (entry + 1e-5), y: 5 };
    expect(sweptProjectileCapsuleContact(before, before, target, size)).toBe(false);
    expect(sweptProjectileCapsuleContact(after, after, target, size)).toBe(true);
  });

  it('detects initial overlap, stationary contact, and reverse flight entry', () => {
    expect(sweptProjectileCapsuleEntry({ x: 0, y: 0 }, { x: 100, y: 0 }, vertical, size)).toBe(0);
    expect(sweptProjectileCapsuleEntry({ x: 3, y: 0 }, { x: 3, y: 0 }, vertical, size)).toBe(0);
    expect(sweptProjectileCapsuleEntry({ x: 100, y: 0 }, { x: -100, y: 0 }, vertical, size)).toBeCloseTo(0.485, 12);
  });

  it('handles degenerate point projectiles, zero-radius spines and thin rectangles', () => {
    const point = { width: 0, height: 0 };
    const circle = { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 2 };
    expect(sweptProjectileCapsuleEntry({ x: -1e6, y: 0 }, { x: 1e6, y: 0 }, circle, point)).toBeCloseTo((1e6 - 2) / 2e6, 12);
    expect(sweptProjectileCapsuleEntry({ x: -10, y: 2 }, { x: 10, y: 2 }, circle, point)).toBe(0.5);
    expect(sweptProjectileCapsuleEntry({ x: -10, y: 0 }, { x: 10, y: 0 }, { ...vertical, radius: 0 }, point)).toBe(0.5);
    expect(sweptProjectileCapsuleEntry({ x: -10, y: 0 }, { x: 10, y: 0 }, { ...circle, radius: 0 }, { width: 2, height: 0 })).toBeCloseTo(0.45, 12);
    expect(sweptProjectileCapsuleEntry({ x: -10, y: 1 }, { x: 10, y: 1 }, { ...circle, radius: 0 }, { width: 2, height: 0 })).toBeNull();
  });

  it.each([false, true])('orders actual capsule contacts and ignores a nearer corner miss (reversed=%s)', reversed => {
    const from = { x: 2.9, y: 12.9 }, to = { x: 102.9, y: 112.9 };
    const targets = [
      { playerIndex: 0, kind: 'hurtbox' as const, shape: vertical },
      { playerIndex: 1, kind: 'reflector' as const, shape: { start: { x: 80, y: 90 }, end: { x: 80, y: 90 }, radius: 2 } },
      { playerIndex: 2, kind: 'hurtbox' as const, shape: { start: { x: 60, y: 70 }, end: { x: 60, y: 70 }, radius: 2 } },
    ];
    if (reversed) targets.reverse();
    const contacts = targets.flatMap(target => {
      const fraction = sweptProjectileCapsuleEntry(from, to, target.shape, size);
      return fraction === null ? [] : [{ playerIndex: target.playerIndex, kind: target.kind, fraction }];
    });
    expect(orderProjectileContacts(contacts).map(contact => contact.playerIndex)).toEqual([2, 1]);
    expect(orderProjectileContacts(contacts)[0]!.fraction).toBeCloseTo((56.1 - Math.sqrt(2)) / 100, 12);
  });

  it('rejects nonfinite or negative geometry before sweeping', () => {
    expect(() => sweptProjectileCapsuleEntry({ x: NaN, y: 0 }, { x: 0, y: 0 }, vertical, size)).toThrow(/finite geometry/);
    expect(() => sweptProjectileCapsuleEntry({ x: 0, y: 0 }, { x: 1, y: 0 }, { ...vertical, radius: -1 }, size)).toThrow(/nonnegative/);
    expect(() => sweptProjectileCapsuleEntry({ x: 0, y: 0 }, { x: 1, y: 0 }, vertical, { width: -1, height: 2 })).toThrow(/nonnegative/);
  });
});
