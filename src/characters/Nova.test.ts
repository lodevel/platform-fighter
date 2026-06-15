/**
 * Nova (Samus) — per-fighter data + wiring coverage.
 *
 * Post-batch-2 roster expansion. Locks down the ranged-zoner identity:
 *
 *   1. Movement profile — mid-heavy zoner stats (run 6.8, mass 13) and
 *      the four fall-shaping fields every profile must carry.
 *   2. Charge shot — the neutral special is a genuinely chargeable
 *      shot on the existing `charge` schema (bare press weak, full
 *      charge a KO threat).
 *   3. Specials reuse existing schemas only (charge / multiHit /
 *      multiHitRising / groundPound) and pass their validators.
 *   4. Constructor wiring — the signature moves fire through the shared
 *      MockScene harness; grab spec is registered.
 */

import { describe, it, expect } from 'vitest';

import {
  Nova,
  NOVA_TUNING,
  NOVA_MOVEMENT_PROFILE,
  NOVA_JAB,
  NOVA_TILT,
  NOVA_SMASH,
  NOVA_NAIR,
  NOVA_FAIR,
  NOVA_BAIR,
  NOVA_NEUTRAL_SPECIAL,
  NOVA_SIDE_SPECIAL,
  NOVA_UP_SPECIAL,
  NOVA_DOWN_SPECIAL,
  NOVA_GRAB,
  NOVA_MOVESET,
  NOVA_FIGHTER_CONTRACT,
} from './Nova';
import { NOVA_SPEC, NOVA_MOVES } from './roster';
import { NOVA_PALETTES } from './palettes';
import { assertFighterMoveset } from './movesetContract';
import { validateNeutralSpecialMove } from './specialSchema';
import { validateSideSpecialMove } from './sideSpecialSchema';
import { validateUpSpecialMove } from './upSpecialSchema';
import { validateDownSpecialMove } from './downSpecialSchema';
import { validateAerialMove } from './aerialSchema';
import { validateGrabSpec } from './grabSchema';

function createMockScene(): { scene: any } {
  const matter = {
    add: {
      rectangle(x: number, y: number, _w: number, _h: number, options: Record<string, unknown>) {
        return { position: { x, y }, velocity: { x: 0, y: 0 }, label: options['label'], options, removed: false };
      },
    },
    body: {
      setVelocity(b: any, v: { x: number; y: number }): void { b.velocity = { x: v.x, y: v.y }; },
      setPosition(b: any, v: { x: number; y: number }): void { b.position = { x: v.x, y: v.y }; },
      setInertia(): void { /* no-op */ },
    },
    world: { on(): void {}, off(): void {}, remove(b: any): void { b.removed = true; } },
  };
  return { scene: { matter } };
}

describe('Nova — movement profile (ranged zoner)', () => {
  it('ships the mid-heavy zoner line: run 6.8, mass 13', () => {
    expect(NOVA_MOVEMENT_PROFILE.maxRunSpeed).toBe(6.8);
    expect(NOVA_MOVEMENT_PROFILE.mass).toBe(13);
    expect(NOVA_MOVEMENT_PROFILE.maxJumps).toBe(2);
  });

  it('declares all four fall-shaping fields with sane relationships', () => {
    const p = NOVA_MOVEMENT_PROFILE;
    expect(p.fallAccel).toBeGreaterThan(0);
    expect(p.fastFallSpeed).toBeGreaterThan(p.maxFallSpeed);
    expect(p.jumpCutFactor).toBeGreaterThan(0);
    expect(p.jumpCutFactor).toBeLessThan(1);
  });

  it('NOVA_TUNING composes the profile plus the tall inline body geometry', () => {
    expect(NOVA_TUNING.mass).toBe(NOVA_MOVEMENT_PROFILE.mass);
    expect(NOVA_TUNING.width).toBe(48);
    expect(NOVA_TUNING.height).toBe(74);
  });

  it('is frozen — the replay determinism contract', () => {
    expect(Object.isFrozen(NOVA_MOVEMENT_PROFILE)).toBe(true);
    expect(Object.isFrozen(NOVA_MOVESET)).toBe(true);
    expect(Object.isFrozen(NOVA_FIGHTER_CONTRACT)).toBe(true);
  });
});

describe('Nova — charge beam (chargeable travelling neutral special)', () => {
  it('is a travelling projectile carrying the Samus charge-beam overlay, and validates', () => {
    expect(NOVA_NEUTRAL_SPECIAL.specialKind).toBe('projectile');
    // It IS a projectile (un-charged shot travels) AND carries the charge overlay.
    expect(NOVA_NEUTRAL_SPECIAL.projectile).toBeDefined();
    expect(NOVA_NEUTRAL_SPECIAL.chargedProjectile).toBeDefined();
    expect(() => validateNeutralSpecialMove(NOVA_NEUTRAL_SPECIAL)).not.toThrow();
  });

  it('is a genuine charge: bare press weak, full charge a KO threat', () => {
    const cp = NOVA_NEUTRAL_SPECIAL.chargedProjectile!;
    expect(cp.charge.minDamage).toBe(6);
    // Un-charged endpoint must equal the move-level (bare-press) damage.
    expect(cp.charge.minDamage).toBe(NOVA_NEUTRAL_SPECIAL.damage);
    expect(cp.charge.maxDamage).toBe(24);
    expect(cp.charge.maxChargeFrames).toBeGreaterThan(60);
  });

  it('full charge travels faster and bigger than the un-charged tap', () => {
    const cp = NOVA_NEUTRAL_SPECIAL.chargedProjectile!;
    expect(cp.maxSpeed).toBeGreaterThan(NOVA_NEUTRAL_SPECIAL.projectile.speed);
    expect(cp.maxWidth).toBeGreaterThan(NOVA_NEUTRAL_SPECIAL.projectile.width);
    expect(cp.maxHeight).toBeGreaterThan(NOVA_NEUTRAL_SPECIAL.projectile.height);
  });

  it('full-charge shot out-damages every conventional move in the kit', () => {
    const maxDamage = NOVA_NEUTRAL_SPECIAL.chargedProjectile!.charge.maxDamage;
    for (const move of NOVA_MOVES) {
      if (move.id === NOVA_NEUTRAL_SPECIAL.id) continue;
      expect(move.damage, move.id).toBeLessThanOrEqual(maxDamage);
    }
  });
});

describe('Nova — remaining specials reuse existing schemas', () => {
  it('side special is a multiHit missile barrage', () => {
    expect(NOVA_SIDE_SPECIAL.sideSpecialKind).toBe('multiHit');
    expect(NOVA_SIDE_SPECIAL.multiHit.hitCount).toBe(3);
    expect(() => validateSideSpecialMove(NOVA_SIDE_SPECIAL)).not.toThrow();
  });

  it('up special is a multiHitRising screw attack with an upward rise', () => {
    expect(NOVA_UP_SPECIAL.upSpecialKind).toBe('multiHitRising');
    expect(NOVA_UP_SPECIAL.multiHitRising.riseImpulse).toBeLessThan(0);
    expect(() => validateUpSpecialMove(NOVA_UP_SPECIAL)).not.toThrow();
  });

  it('down special is a timed morph-ball bomb (trap) with a fuse + bomb-jump', () => {
    expect(NOVA_DOWN_SPECIAL.downSpecialKind).toBe('trap');
    // Timed bomb: detonates on a fuse (not a contact mine) and bomb-jumps.
    expect(NOVA_DOWN_SPECIAL.trap.fuseDetonateFrames).toBeGreaterThan(0);
    expect(NOVA_DOWN_SPECIAL.trap.selfBounceVelocity).toBeLessThan(0); // upward pop
    expect(() => validateDownSpecialMove(NOVA_DOWN_SPECIAL)).not.toThrow();
  });

  it('aerials validate', () => {
    expect(() => validateAerialMove(NOVA_NAIR)).not.toThrow();
    expect(() => validateAerialMove(NOVA_FAIR)).not.toThrow();
    expect(() => validateAerialMove(NOVA_BAIR)).not.toThrow();
  });
});

describe('Nova — moveset contract + roster spec', () => {
  it('satisfies the canonical 10-slot moveset contract', () => {
    expect(() => assertFighterMoveset('nova', NOVA_MOVESET)).not.toThrow();
    expect(NOVA_FIGHTER_CONTRACT.id).toBe('nova');
    expect(NOVA_FIGHTER_CONTRACT.moveset).toBe(NOVA_MOVESET);
    expect(NOVA_FIGHTER_CONTRACT.movementProfile).toBe(NOVA_MOVEMENT_PROFILE);
  });

  it('roster spec displays the inspiration in parentheses + ships the sprite key', () => {
    expect(NOVA_SPEC.displayName).toBe('Nova (Samus)');
    expect(NOVA_SPEC.role).toBe('zoner (Samus)');
    expect(NOVA_SPEC.playable).toBe(true);
    expect(NOVA_SPEC.placeholder.spriteKey).toBe('char.nova.idle');
  });

  it('ships the full 10-move table with namespaced ids', () => {
    expect(NOVA_MOVES).toHaveLength(10);
    for (const move of NOVA_MOVES) {
      expect(move.id.startsWith('nova.'), move.id).toBe(true);
    }
  });

  it('grounded triplet escalates damage AND startup (jab < tilt < smash)', () => {
    expect(NOVA_JAB.damage).toBeLessThan(NOVA_TILT.damage);
    expect(NOVA_TILT.damage).toBeLessThan(NOVA_SMASH.damage);
    expect(NOVA_JAB.startupFrames).toBeLessThan(NOVA_TILT.startupFrames);
    expect(NOVA_TILT.startupFrames).toBeLessThan(NOVA_SMASH.startupFrames);
  });

  it('ships an 8-entry palette ladder with distinct primary colours', () => {
    expect(NOVA_PALETTES).toHaveLength(8);
    expect(NOVA_PALETTES[0]!.primaryColor).toBe(NOVA_SPEC.placeholder.primaryColor);
    const primaries = new Set(NOVA_PALETTES.map((p) => p.primaryColor));
    expect(primaries.size).toBe(8);
  });

  it('grab spec validates and carries all four throws', () => {
    expect(() => validateGrabSpec(NOVA_GRAB, 'Nova.test')).not.toThrow();
    expect(Object.keys(NOVA_GRAB.throws).sort()).toEqual(['back', 'down', 'forward', 'up']);
  });
});

describe('Nova — constructor wiring (MockScene smoke)', () => {
  it('constructs, registers the kit, and fires a signature move', () => {
    const m = createMockScene();
    const ch = new Nova(m.scene, { spawnX: 100, spawnY: 200 });
    expect(ch.id).toBe('nova');
    expect(ch.attemptAttack(NOVA_SMASH.id)).toBe(true);
    expect(ch.getActiveAttack()?.move.id).toBe('nova.smash');
  });

  it('registers the grab spec on construction', () => {
    const m = createMockScene();
    const ch = new Nova(m.scene, { spawnX: 0, spawnY: 0 });
    expect(ch.getGrabSpec()).toBe(NOVA_GRAB);
  });
});
