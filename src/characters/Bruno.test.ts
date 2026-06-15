/**
 * Bruno (Mario) — per-fighter data + wiring coverage.
 *
 * Post-batch-2 roster expansion. Locks down the balanced-all-rounder
 * identity:
 *
 *   1. Movement profile — middleweight baseline stats (run 8.0, mass
 *      11) and the four fall-shaping fields every profile must carry.
 *   2. Fireball — the neutral special is a projectile on the existing
 *      `projectile` schema.
 *   3. Specials reuse existing schemas only (projectile / dashStrike /
 *      multiHitRising / groundPound) and pass their validators.
 *   4. Constructor wiring — the signature moves fire through the shared
 *      MockScene harness; grab spec is registered.
 */

import { describe, it, expect } from 'vitest';

import {
  Bruno,
  BRUNO_TUNING,
  BRUNO_MOVEMENT_PROFILE,
  BRUNO_JAB,
  BRUNO_TILT,
  BRUNO_SMASH,
  BRUNO_NAIR,
  BRUNO_FAIR,
  BRUNO_BAIR,
  BRUNO_NEUTRAL_SPECIAL,
  BRUNO_SIDE_SPECIAL,
  BRUNO_UP_SPECIAL,
  BRUNO_DOWN_SPECIAL,
  BRUNO_GRAB,
  BRUNO_MOVESET,
  BRUNO_FIGHTER_CONTRACT,
} from './Bruno';
import { BRUNO_SPEC, BRUNO_MOVES } from './roster';
import { BRUNO_PALETTES } from './palettes';
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

describe('Bruno — movement profile (balanced all-rounder)', () => {
  it('ships the middleweight baseline line: run 8.0, mass 11', () => {
    expect(BRUNO_MOVEMENT_PROFILE.maxRunSpeed).toBe(8.0);
    expect(BRUNO_MOVEMENT_PROFILE.mass).toBe(11);
    expect(BRUNO_MOVEMENT_PROFILE.maxJumps).toBe(2);
  });

  it('declares all four fall-shaping fields with sane relationships', () => {
    const p = BRUNO_MOVEMENT_PROFILE;
    expect(p.fallAccel).toBeGreaterThan(0);
    expect(p.fastFallSpeed).toBeGreaterThan(p.maxFallSpeed);
    expect(p.jumpCutFactor).toBeGreaterThan(0);
    expect(p.jumpCutFactor).toBeLessThan(1);
  });

  it('BRUNO_TUNING composes the profile plus the compact inline body geometry', () => {
    expect(BRUNO_TUNING.mass).toBe(BRUNO_MOVEMENT_PROFILE.mass);
    expect(BRUNO_TUNING.width).toBe(46);
    expect(BRUNO_TUNING.height).toBe(68);
  });

  it('is frozen — the replay determinism contract', () => {
    expect(Object.isFrozen(BRUNO_MOVEMENT_PROFILE)).toBe(true);
    expect(Object.isFrozen(BRUNO_MOVESET)).toBe(true);
    expect(Object.isFrozen(BRUNO_FIGHTER_CONTRACT)).toBe(true);
  });
});

describe('Bruno — specials reuse existing schemas', () => {
  it('neutral special is a projectile (the fireball)', () => {
    expect(BRUNO_NEUTRAL_SPECIAL.specialKind).toBe('projectile');
    expect(BRUNO_NEUTRAL_SPECIAL.projectile.speed).toBeGreaterThan(0);
    expect(() => validateNeutralSpecialMove(BRUNO_NEUTRAL_SPECIAL)).not.toThrow();
  });

  it('side special is a dashStrike shoulder charge that outruns his sprint', () => {
    expect(BRUNO_SIDE_SPECIAL.sideSpecialKind).toBe('dashStrike');
    expect(BRUNO_SIDE_SPECIAL.dashStrike.dashSpeed).toBeGreaterThan(BRUNO_MOVEMENT_PROFILE.maxRunSpeed);
    expect(BRUNO_SIDE_SPECIAL.dashStrike.helplessAfterDash).toBe(false);
    expect(() => validateSideSpecialMove(BRUNO_SIDE_SPECIAL)).not.toThrow();
  });

  it('up special is a multiHitRising anti-air with an upward rise', () => {
    expect(BRUNO_UP_SPECIAL.upSpecialKind).toBe('multiHitRising');
    expect(BRUNO_UP_SPECIAL.multiHitRising.riseImpulse).toBeLessThan(0);
    expect(BRUNO_UP_SPECIAL.startupFrames).toBeLessThanOrEqual(5); // quick anti-air
    expect(() => validateUpSpecialMove(BRUNO_UP_SPECIAL)).not.toThrow();
  });

  it('down special is a groundPound stomp with a meteor descent', () => {
    expect(BRUNO_DOWN_SPECIAL.downSpecialKind).toBe('groundPound');
    expect(BRUNO_DOWN_SPECIAL.knockback.y).toBeGreaterThan(0); // +y is downward
    expect(() => validateDownSpecialMove(BRUNO_DOWN_SPECIAL)).not.toThrow();
  });

  it('aerials validate', () => {
    expect(() => validateAerialMove(BRUNO_NAIR)).not.toThrow();
    expect(() => validateAerialMove(BRUNO_FAIR)).not.toThrow();
    expect(() => validateAerialMove(BRUNO_BAIR)).not.toThrow();
  });
});

describe('Bruno — moveset contract + roster spec', () => {
  it('satisfies the canonical 10-slot moveset contract', () => {
    expect(() => assertFighterMoveset('bruno', BRUNO_MOVESET)).not.toThrow();
    expect(BRUNO_FIGHTER_CONTRACT.id).toBe('bruno');
    expect(BRUNO_FIGHTER_CONTRACT.moveset).toBe(BRUNO_MOVESET);
    expect(BRUNO_FIGHTER_CONTRACT.movementProfile).toBe(BRUNO_MOVEMENT_PROFILE);
  });

  it('roster spec displays the inspiration in parentheses + ships the sprite key', () => {
    expect(BRUNO_SPEC.displayName).toBe('Bruno (Mario)');
    expect(BRUNO_SPEC.role).toBe('all-rounder (Mario)');
    expect(BRUNO_SPEC.playable).toBe(true);
    expect(BRUNO_SPEC.placeholder.spriteKey).toBe('char.bruno.idle');
  });

  it('ships the full 10-move table with namespaced ids', () => {
    expect(BRUNO_MOVES).toHaveLength(10);
    for (const move of BRUNO_MOVES) {
      expect(move.id.startsWith('bruno.'), move.id).toBe(true);
    }
  });

  it('grounded triplet escalates damage AND startup (jab < tilt < smash)', () => {
    expect(BRUNO_JAB.damage).toBeLessThan(BRUNO_TILT.damage);
    expect(BRUNO_TILT.damage).toBeLessThan(BRUNO_SMASH.damage);
    expect(BRUNO_JAB.startupFrames).toBeLessThan(BRUNO_TILT.startupFrames);
    expect(BRUNO_TILT.startupFrames).toBeLessThan(BRUNO_SMASH.startupFrames);
  });

  it('ships an 8-entry palette ladder with distinct primary colours', () => {
    expect(BRUNO_PALETTES).toHaveLength(8);
    expect(BRUNO_PALETTES[0]!.primaryColor).toBe(BRUNO_SPEC.placeholder.primaryColor);
    const primaries = new Set(BRUNO_PALETTES.map((p) => p.primaryColor));
    expect(primaries.size).toBe(8);
  });

  it('grab spec validates and carries all four throws', () => {
    expect(() => validateGrabSpec(BRUNO_GRAB, 'Bruno.test')).not.toThrow();
    expect(Object.keys(BRUNO_GRAB.throws).sort()).toEqual(['back', 'down', 'forward', 'up']);
  });
});

describe('Bruno — constructor wiring (MockScene smoke)', () => {
  it('constructs, registers the kit, and fires a signature move', () => {
    const m = createMockScene();
    const ch = new Bruno(m.scene, { spawnX: 100, spawnY: 200 });
    expect(ch.id).toBe('bruno');
    expect(ch.attemptAttack(BRUNO_SMASH.id)).toBe(true);
    expect(ch.getActiveAttack()?.move.id).toBe('bruno.smash');
  });

  it('registers the grab spec on construction', () => {
    const m = createMockScene();
    const ch = new Bruno(m.scene, { spawnX: 0, spawnY: 0 });
    expect(ch.getGrabSpec()).toBe(BRUNO_GRAB);
  });
});
