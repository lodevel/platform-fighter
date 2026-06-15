/**
 * Volt (Pikachu) — per-fighter data + wiring coverage.
 *
 * Post-batch-2 roster expansion. Locks down the tiny-combo-rushdown
 * identity the fighter was authored against:
 *
 *   1. Movement profile — featherweight fast-faller stats (run 9.5,
 *      mass 7, fast fall) and the four fall-shaping fields every
 *      profile must carry.
 *   2. Combo normals — low-knockback jab/tilt scaling so the kit
 *      combos rather than sends.
 *   3. Specials reuse existing schemas only (projectile / dashStrike /
 *      multiHitRising / groundPound) and pass their validators.
 *   4. Constructor wiring — the signature moves fire through the shared
 *      MockScene harness; grab spec is registered.
 *
 * Same Phaser-free MockScene pattern as the rest of
 * `src/characters/*.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import {
  Volt,
  VOLT_TUNING,
  VOLT_MOVEMENT_PROFILE,
  VOLT_JAB,
  VOLT_TILT,
  VOLT_SMASH,
  VOLT_NAIR,
  VOLT_FAIR,
  VOLT_BAIR,
  VOLT_NEUTRAL_SPECIAL,
  VOLT_SIDE_SPECIAL,
  VOLT_UP_SPECIAL,
  VOLT_DOWN_SPECIAL,
  VOLT_GRAB,
  VOLT_MOVESET,
  VOLT_FIGHTER_CONTRACT,
} from './Volt';
import { VOLT_SPEC, VOLT_MOVES } from './roster';
import { VOLT_PALETTES } from './palettes';
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

describe('Volt — movement profile (tiny combo rushdown)', () => {
  it('ships the featherweight speedster line: run 9.5, mass 7, fast fall', () => {
    expect(VOLT_MOVEMENT_PROFILE.maxRunSpeed).toBe(9.5);
    expect(VOLT_MOVEMENT_PROFILE.mass).toBe(7);
    expect(VOLT_MOVEMENT_PROFILE.fallAccel).toBe(0.37);
    expect(VOLT_MOVEMENT_PROFILE.maxJumps).toBe(2);
  });

  it('declares all four fall-shaping fields with sane relationships', () => {
    const p = VOLT_MOVEMENT_PROFILE;
    expect(p.fallAccel).toBeGreaterThan(0);
    expect(p.fastFallSpeed).toBeGreaterThan(p.maxFallSpeed);
    expect(p.jumpCutFactor).toBeGreaterThan(0);
    expect(p.jumpCutFactor).toBeLessThan(1);
  });

  it('VOLT_TUNING composes the profile plus the tiny inline body geometry', () => {
    expect(VOLT_TUNING.maxRunSpeed).toBe(VOLT_MOVEMENT_PROFILE.maxRunSpeed);
    expect(VOLT_TUNING.mass).toBe(VOLT_MOVEMENT_PROFILE.mass);
    expect(VOLT_TUNING.width).toBe(40);
    expect(VOLT_TUNING.height).toBe(52);
  });

  it('is frozen — the replay determinism contract', () => {
    expect(Object.isFrozen(VOLT_MOVEMENT_PROFILE)).toBe(true);
    expect(Object.isFrozen(VOLT_MOVESET)).toBe(true);
    expect(Object.isFrozen(VOLT_FIGHTER_CONTRACT)).toBe(true);
  });
});

describe('Volt — low-knockback combo identity', () => {
  it('jab and tilt carry low scaling so they combo rather than send', () => {
    expect(VOLT_JAB.knockback.scaling).toBeLessThanOrEqual(0.06);
    expect(VOLT_TILT.knockback.scaling).toBeLessThanOrEqual(0.12);
  });

  it('has the fastest jab startup in the cast (2 frames)', () => {
    expect(VOLT_JAB.startupFrames).toBe(2);
  });

  it('aerials validate and stay quick (low landing lag for the weave)', () => {
    expect(() => validateAerialMove(VOLT_NAIR)).not.toThrow();
    expect(() => validateAerialMove(VOLT_FAIR)).not.toThrow();
    expect(() => validateAerialMove(VOLT_BAIR)).not.toThrow();
    expect(VOLT_NAIR.landingLagFrames).toBeLessThanOrEqual(8);
    expect(VOLT_FAIR.landingLagFrames).toBeLessThanOrEqual(8);
  });
});

describe('Volt — specials reuse existing schemas', () => {
  it('neutral special is a projectile (the spark bolt)', () => {
    expect(VOLT_NEUTRAL_SPECIAL.specialKind).toBe('projectile');
    expect(VOLT_NEUTRAL_SPECIAL.projectile.speed).toBeGreaterThan(0);
    expect(() => validateNeutralSpecialMove(VOLT_NEUTRAL_SPECIAL)).not.toThrow();
  });

  it('side special is a dashStrike that outruns his own sprint', () => {
    expect(VOLT_SIDE_SPECIAL.sideSpecialKind).toBe('dashStrike');
    expect(VOLT_SIDE_SPECIAL.dashStrike.dashSpeed).toBeGreaterThan(VOLT_MOVEMENT_PROFILE.maxRunSpeed);
    expect(VOLT_SIDE_SPECIAL.dashStrike.helplessAfterDash).toBe(false);
    expect(() => validateSideSpecialMove(VOLT_SIDE_SPECIAL)).not.toThrow();
  });

  it('up special is a multiHitRising quick-attack zip with an upward rise', () => {
    expect(VOLT_UP_SPECIAL.upSpecialKind).toBe('multiHitRising');
    expect(VOLT_UP_SPECIAL.multiHitRising.riseImpulse).toBeLessThan(0);
    expect(() => validateUpSpecialMove(VOLT_UP_SPECIAL)).not.toThrow();
  });

  it('down special is a groundPound thunder-stomp with a meteor descent', () => {
    expect(VOLT_DOWN_SPECIAL.downSpecialKind).toBe('groundPound');
    expect(VOLT_DOWN_SPECIAL.knockback.y).toBeGreaterThan(0); // +y is downward
    expect(() => validateDownSpecialMove(VOLT_DOWN_SPECIAL)).not.toThrow();
  });
});

describe('Volt — moveset contract + roster spec', () => {
  it('satisfies the canonical 10-slot moveset contract', () => {
    expect(() => assertFighterMoveset('volt', VOLT_MOVESET)).not.toThrow();
    expect(VOLT_FIGHTER_CONTRACT.id).toBe('volt');
    expect(VOLT_FIGHTER_CONTRACT.moveset).toBe(VOLT_MOVESET);
    expect(VOLT_FIGHTER_CONTRACT.movementProfile).toBe(VOLT_MOVEMENT_PROFILE);
  });

  it('roster spec displays the inspiration in parentheses + ships the sprite key', () => {
    expect(VOLT_SPEC.displayName).toBe('Volt (Pikachu)');
    expect(VOLT_SPEC.role).toBe('combo rushdown (Pikachu)');
    expect(VOLT_SPEC.playable).toBe(true);
    expect(VOLT_SPEC.placeholder.spriteKey).toBe('char.volt.idle');
  });

  it('ships the full 10-move table with namespaced ids', () => {
    expect(VOLT_MOVES).toHaveLength(10);
    for (const move of VOLT_MOVES) {
      expect(move.id.startsWith('volt.'), move.id).toBe(true);
    }
  });

  it('grounded triplet escalates damage AND startup (jab < tilt < smash)', () => {
    expect(VOLT_JAB.damage).toBeLessThan(VOLT_TILT.damage);
    expect(VOLT_TILT.damage).toBeLessThan(VOLT_SMASH.damage);
    expect(VOLT_JAB.startupFrames).toBeLessThan(VOLT_TILT.startupFrames);
    expect(VOLT_TILT.startupFrames).toBeLessThan(VOLT_SMASH.startupFrames);
  });

  it('ships an 8-entry palette ladder with distinct primary colours', () => {
    expect(VOLT_PALETTES).toHaveLength(8);
    expect(VOLT_PALETTES[0]!.primaryColor).toBe(VOLT_SPEC.placeholder.primaryColor);
    const primaries = new Set(VOLT_PALETTES.map((p) => p.primaryColor));
    expect(primaries.size).toBe(8);
  });

  it('grab spec validates and carries all four throws', () => {
    expect(() => validateGrabSpec(VOLT_GRAB, 'Volt.test')).not.toThrow();
    expect(Object.keys(VOLT_GRAB.throws).sort()).toEqual(['back', 'down', 'forward', 'up']);
  });
});

describe('Volt — constructor wiring (MockScene smoke)', () => {
  it('constructs, registers the kit, and fires a signature move', () => {
    const m = createMockScene();
    const ch = new Volt(m.scene, { spawnX: 100, spawnY: 200 });
    expect(ch.id).toBe('volt');
    expect(ch.attemptAttack(VOLT_FAIR.id)).toBe(true);
    expect(ch.getActiveAttack()?.move.id).toBe('volt.fair');
  });

  it('registers the grab spec on construction', () => {
    const m = createMockScene();
    const ch = new Volt(m.scene, { spawnX: 0, spawnY: 0 });
    expect(ch.getGrabSpec()).toBe(VOLT_GRAB);
  });
});
