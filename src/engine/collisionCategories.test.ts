import { describe, it, expect } from 'vitest';
import {
  COLLISION_CATEGORIES,
  COLLISION_MASKS,
  categoriesCollide,
} from './collisionCategories';

/**
 * The collision filter tables in `collisionCategories.ts` are read by
 * the stage renderer, the (future) character controller, projectile
 * spawner, and KO handler. Silently changing a bitmask would
 * desync all of those at once, so we lock down the contract here:
 *
 *   - Every category occupies exactly one bit (no overlap).
 *   - Categories fit into 31 usable bits (no sign-bit footguns).
 *   - The default masks express the intended collision matrix:
 *       characters ↔ platforms / hazards / blast zone
 *       projectiles ↔ characters / solid platforms (NOT thin platforms)
 *       hitboxes    ↔ characters only (no friendly-fire on geometry)
 *       blast zone  ↔ characters / projectiles (sensors don't push)
 */
describe('COLLISION_CATEGORIES', () => {
  it('assigns a unique single bit to every category', () => {
    const values = Object.values(COLLISION_CATEGORIES);
    // Every value is a power of two (single bit set).
    for (const v of values) {
      expect(v).toBeGreaterThan(0);
      expect((v & (v - 1)) === 0).toBe(true);
    }
    // Every bit is unique — no two categories share a bit.
    expect(new Set(values).size).toBe(values.length);
  });

  it('keeps every category inside the safely-shiftable 31-bit range', () => {
    for (const v of Object.values(COLLISION_CATEGORIES)) {
      // Bit 31 (the sign bit in a 32-bit two's-complement int) is unsafe
      // for JS bitmask arithmetic — guard against creeping into it.
      expect(v).toBeLessThan(0x4000_0000);
    }
  });
});

describe('COLLISION_MASKS', () => {
  it('lets characters collide with both platform variants and the blast zone', () => {
    const m = COLLISION_MASKS.CHARACTER;
    expect(m & COLLISION_CATEGORIES.PLATFORM_SOLID).toBeTruthy();
    expect(m & COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH).toBeTruthy();
    expect(m & COLLISION_CATEGORIES.BLAST_ZONE).toBeTruthy();
    expect(m & COLLISION_CATEGORIES.HAZARD).toBeTruthy();
  });

  it('keeps pass-through platforms reserved for characters only', () => {
    // A pass-through platform should ignore projectiles, items, and
    // other geometry — only characters land on it.
    const m = COLLISION_MASKS.PLATFORM_PASS_THROUGH;
    expect(m & COLLISION_CATEGORIES.CHARACTER).toBeTruthy();
    expect(m & COLLISION_CATEGORIES.PROJECTILE).toBe(0);
    expect(m & COLLISION_CATEGORIES.ITEM).toBe(0);
  });

  it('blocks hitboxes from colliding with stage geometry', () => {
    const m = COLLISION_MASKS.HITBOX;
    expect(m & COLLISION_CATEGORIES.PLATFORM_SOLID).toBe(0);
    expect(m & COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH).toBe(0);
    // A hitbox must still hit a character — that's its only job.
    expect(m & COLLISION_CATEGORIES.CHARACTER).toBeTruthy();
  });

  it('lets projectiles tunnel through pass-through platforms', () => {
    const m = COLLISION_MASKS.PROJECTILE;
    expect(m & COLLISION_CATEGORIES.PLATFORM_SOLID).toBeTruthy();
    expect(m & COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH).toBe(0);
  });

  it('configures the blast-zone sensor to fire on characters and projectiles', () => {
    const m = COLLISION_MASKS.BLAST_ZONE;
    expect(m & COLLISION_CATEGORIES.CHARACTER).toBeTruthy();
    expect(m & COLLISION_CATEGORIES.PROJECTILE).toBeTruthy();
    // Blast zones must not fire when bumping platforms — that would KO
    // the world geometry on stage load.
    expect(m & COLLISION_CATEGORIES.PLATFORM_SOLID).toBe(0);
    expect(m & COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH).toBe(0);
  });
});

describe('categoriesCollide()', () => {
  const character = {
    category: COLLISION_CATEGORIES.CHARACTER,
    mask: COLLISION_MASKS.CHARACTER,
  };
  const solid = {
    category: COLLISION_CATEGORIES.PLATFORM_SOLID,
    mask: COLLISION_MASKS.PLATFORM_SOLID,
  };
  const passThrough = {
    category: COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH,
    mask: COLLISION_MASKS.PLATFORM_PASS_THROUGH,
  };
  const projectile = {
    category: COLLISION_CATEGORIES.PROJECTILE,
    mask: COLLISION_MASKS.PROJECTILE,
  };
  const hitbox = {
    category: COLLISION_CATEGORIES.HITBOX,
    mask: COLLISION_MASKS.HITBOX,
  };
  const blastZone = {
    category: COLLISION_CATEGORIES.BLAST_ZONE,
    mask: COLLISION_MASKS.BLAST_ZONE,
  };

  it('returns true for characters bumping any platform', () => {
    expect(categoriesCollide(character, solid)).toBe(true);
    expect(categoriesCollide(character, passThrough)).toBe(true);
  });

  it('returns true for characters crossing the blast zone', () => {
    expect(categoriesCollide(character, blastZone)).toBe(true);
  });

  it('returns true for hitboxes touching a character', () => {
    expect(categoriesCollide(hitbox, character)).toBe(true);
  });

  it('returns false for hitboxes touching geometry', () => {
    expect(categoriesCollide(hitbox, solid)).toBe(false);
    expect(categoriesCollide(hitbox, passThrough)).toBe(false);
  });

  it('returns false for projectiles passing thin platforms', () => {
    expect(categoriesCollide(projectile, passThrough)).toBe(false);
    // ...but they still hit solid ground.
    expect(categoriesCollide(projectile, solid)).toBe(true);
  });

  it('is symmetric for any pair of bodies', () => {
    const cases = [
      [character, solid],
      [character, passThrough],
      [character, blastZone],
      [hitbox, character],
      [hitbox, solid],
      [projectile, passThrough],
      [projectile, solid],
    ] as const;
    for (const [a, b] of cases) {
      expect(categoriesCollide(a, b)).toBe(categoriesCollide(b, a));
    }
  });
});
