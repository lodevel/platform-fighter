/**
 * Donkey Kong — per-fighter data + wiring coverage.
 *
 * Post-batch-3 roster expansion. Locks down the mobile-heavyweight
 * bruiser identity:
 *
 *   1. Movement profile — heavy mass (18) paired with real run speed
 *      (8.0) and usable air control — the heavy who keeps up, distinct
 *      from Bear's slow immovable wall.
 *   2. Specials reuse existing schemas only (charge / dashStrike /
 *      multiHitRising / groundPound) and pass their validators.
 *   3. Moveset contract + roster spec + 8-entry palette ladder.
 *   4. Constructor wiring — the signature moves fire through the shared
 *      MockScene harness; grab spec is registered.
 */

import { describe, it, expect } from 'vitest';

import {
  DonkeyKong,
  DONKEYKONG_TUNING,
  DONKEYKONG_MOVEMENT_PROFILE,
  DONKEYKONG_JAB,
  DONKEYKONG_TILT,
  DONKEYKONG_SMASH,
  DONKEYKONG_NAIR,
  DONKEYKONG_FAIR,
  DONKEYKONG_BAIR,
  DONKEYKONG_NEUTRAL_SPECIAL,
  DONKEYKONG_SIDE_SPECIAL,
  DONKEYKONG_UP_SPECIAL,
  DONKEYKONG_DOWN_SPECIAL,
  DONKEYKONG_GRAB,
  DONKEYKONG_MOVESET,
  DONKEYKONG_FIGHTER_CONTRACT,
} from './DonkeyKong';
import { DONKEYKONG_SPEC, DONKEYKONG_MOVES } from './roster';
import { DONKEYKONG_PALETTES } from './palettes';
import { BEAR_MOVEMENT_PROFILE } from './fighterMovementProfiles';
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

describe('Donkey Kong — movement profile (mobile heavyweight)', () => {
  it('ships the heavy-but-mobile line: run 8.0, mass 18', () => {
    expect(DONKEYKONG_MOVEMENT_PROFILE.maxRunSpeed).toBe(8.0);
    expect(DONKEYKONG_MOVEMENT_PROFILE.mass).toBe(18);
    expect(DONKEYKONG_MOVEMENT_PROFILE.maxJumps).toBe(2);
  });

  it('is the MOBILE heavyweight — faster + better air control than Bear (the wall)', () => {
    expect(DONKEYKONG_MOVEMENT_PROFILE.maxRunSpeed).toBeGreaterThan(BEAR_MOVEMENT_PROFILE.maxRunSpeed);
    expect(DONKEYKONG_MOVEMENT_PROFILE.airAccel).toBeGreaterThan(BEAR_MOVEMENT_PROFILE.airAccel);
    // Still a heavyweight — heavier than Wolf (16), lighter than Bear (20).
    expect(DONKEYKONG_MOVEMENT_PROFILE.mass).toBeGreaterThan(16);
    expect(DONKEYKONG_MOVEMENT_PROFILE.mass).toBeLessThan(BEAR_MOVEMENT_PROFILE.mass);
  });

  it('declares all four fall-shaping fields with sane relationships', () => {
    const p = DONKEYKONG_MOVEMENT_PROFILE;
    expect(p.fallAccel).toBeGreaterThan(0);
    expect(p.fastFallSpeed).toBeGreaterThan(p.maxFallSpeed);
    expect(p.jumpCutFactor).toBeGreaterThan(0);
    expect(p.jumpCutFactor).toBeLessThan(1);
  });

  it('DONKEYKONG_TUNING composes the profile plus the large ape body geometry', () => {
    expect(DONKEYKONG_TUNING.mass).toBe(DONKEYKONG_MOVEMENT_PROFILE.mass);
    expect(DONKEYKONG_TUNING.width).toBe(60);
    expect(DONKEYKONG_TUNING.height).toBe(84);
  });

  it('is frozen — the replay determinism contract', () => {
    expect(Object.isFrozen(DONKEYKONG_MOVEMENT_PROFILE)).toBe(true);
    expect(Object.isFrozen(DONKEYKONG_MOVESET)).toBe(true);
    expect(Object.isFrozen(DONKEYKONG_FIGHTER_CONTRACT)).toBe(true);
  });
});

describe('Donkey Kong — specials reuse existing schemas', () => {
  it('neutral special is a charge giant punch that scales up with charge', () => {
    expect(DONKEYKONG_NEUTRAL_SPECIAL.specialKind).toBe('charge');
    expect(DONKEYKONG_NEUTRAL_SPECIAL.charge.maxDamage).toBeGreaterThan(DONKEYKONG_NEUTRAL_SPECIAL.charge.minDamage);
    expect(() => validateNeutralSpecialMove(DONKEYKONG_NEUTRAL_SPECIAL)).not.toThrow();
  });

  it('side special is a dashStrike shoulder charge that outruns his sprint', () => {
    expect(DONKEYKONG_SIDE_SPECIAL.sideSpecialKind).toBe('dashStrike');
    expect(DONKEYKONG_SIDE_SPECIAL.dashStrike.dashSpeed).toBeGreaterThan(DONKEYKONG_MOVEMENT_PROFILE.maxRunSpeed);
    expect(DONKEYKONG_SIDE_SPECIAL.dashStrike.helplessAfterDash).toBe(false);
    expect(() => validateSideSpecialMove(DONKEYKONG_SIDE_SPECIAL)).not.toThrow();
  });

  it('up special is a multiHitRising spinning kong with an upward rise', () => {
    expect(DONKEYKONG_UP_SPECIAL.upSpecialKind).toBe('multiHitRising');
    expect(DONKEYKONG_UP_SPECIAL.multiHitRising.riseImpulse).toBeLessThan(0);
    expect(() => validateUpSpecialMove(DONKEYKONG_UP_SPECIAL)).not.toThrow();
  });

  it('down special is a groundPound stomp with a meteor descent', () => {
    expect(DONKEYKONG_DOWN_SPECIAL.downSpecialKind).toBe('groundPound');
    expect(DONKEYKONG_DOWN_SPECIAL.knockback.y).toBeGreaterThan(0); // +y is downward
    expect(() => validateDownSpecialMove(DONKEYKONG_DOWN_SPECIAL)).not.toThrow();
  });

  it('aerials validate', () => {
    expect(() => validateAerialMove(DONKEYKONG_NAIR)).not.toThrow();
    expect(() => validateAerialMove(DONKEYKONG_FAIR)).not.toThrow();
    expect(() => validateAerialMove(DONKEYKONG_BAIR)).not.toThrow();
  });
});

describe('Donkey Kong — moveset contract + roster spec', () => {
  it('satisfies the canonical 10-slot moveset contract', () => {
    expect(() => assertFighterMoveset('donkeykong', DONKEYKONG_MOVESET)).not.toThrow();
    expect(DONKEYKONG_FIGHTER_CONTRACT.id).toBe('donkeykong');
    expect(DONKEYKONG_FIGHTER_CONTRACT.moveset).toBe(DONKEYKONG_MOVESET);
    expect(DONKEYKONG_FIGHTER_CONTRACT.movementProfile).toBe(DONKEYKONG_MOVEMENT_PROFILE);
  });

  it('roster spec is procedural (null sprite key)', () => {
    expect(DONKEYKONG_SPEC.displayName).toBe('Donkey Kong');
    expect(DONKEYKONG_SPEC.role).toBe('mobile heavyweight (Donkey Kong)');
    expect(DONKEYKONG_SPEC.playable).toBe(true);
    expect(DONKEYKONG_SPEC.placeholder.spriteKey).toBeNull();
  });

  it('ships the full 10-move table with namespaced ids', () => {
    expect(DONKEYKONG_MOVES).toHaveLength(10);
    for (const move of DONKEYKONG_MOVES) {
      expect(move.id.startsWith('donkeykong.'), move.id).toBe(true);
    }
  });

  it('grounded triplet escalates damage AND startup (jab < tilt < smash)', () => {
    expect(DONKEYKONG_JAB.damage).toBeLessThan(DONKEYKONG_TILT.damage);
    expect(DONKEYKONG_TILT.damage).toBeLessThan(DONKEYKONG_SMASH.damage);
    expect(DONKEYKONG_JAB.startupFrames).toBeLessThan(DONKEYKONG_TILT.startupFrames);
    expect(DONKEYKONG_TILT.startupFrames).toBeLessThan(DONKEYKONG_SMASH.startupFrames);
  });

  it('ships an 8-entry palette ladder with distinct primary colours', () => {
    expect(DONKEYKONG_PALETTES).toHaveLength(8);
    expect(DONKEYKONG_PALETTES[0]!.primaryColor).toBe(DONKEYKONG_SPEC.placeholder.primaryColor);
    const primaries = new Set(DONKEYKONG_PALETTES.map((p) => p.primaryColor));
    expect(primaries.size).toBe(8);
  });

  it('grab spec validates and carries all four throws', () => {
    expect(() => validateGrabSpec(DONKEYKONG_GRAB, 'DonkeyKong.test')).not.toThrow();
    expect(Object.keys(DONKEYKONG_GRAB.throws).sort()).toEqual(['back', 'down', 'forward', 'up']);
  });
});

describe('Donkey Kong — constructor wiring (MockScene smoke)', () => {
  it('constructs, registers the kit, and fires a signature move', () => {
    const m = createMockScene();
    const ch = new DonkeyKong(m.scene, { spawnX: 100, spawnY: 200 });
    expect(ch.id).toBe('donkeykong');
    expect(ch.attemptAttack(DONKEYKONG_SMASH.id)).toBe(true);
    expect(ch.getActiveAttack()?.move.id).toBe('donkeykong.smash');
  });

  it('registers the grab spec on construction', () => {
    const m = createMockScene();
    const ch = new DonkeyKong(m.scene, { spawnX: 0, spawnY: 0 });
    expect(ch.getGrabSpec()).toBe(DONKEYKONG_GRAB);
  });
});
