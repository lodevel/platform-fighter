/**
 * Kirby — per-fighter data + wiring coverage.
 *
 * Post-batch-3 roster expansion. Locks down the multi-jump inhale
 * puffball identity:
 *
 *   1. Movement profile — light, floaty, five jumps (run 5.5, mass 6,
 *      maxJumps 5) and the four fall-shaping fields every profile carries.
 *   2. Specials reuse existing schemas only (commandGrab / dashStrike /
 *      multiHitRising / stallAndFall) and pass their validators.
 *   3. Moveset contract + roster spec + 8-entry palette ladder.
 *   4. Constructor wiring — the signature moves fire through the shared
 *      MockScene harness; grab spec is registered.
 */

import { describe, it, expect } from 'vitest';

import {
  Kirby,
  KIRBY_TUNING,
  KIRBY_MOVEMENT_PROFILE,
  KIRBY_JAB,
  KIRBY_TILT,
  KIRBY_SMASH,
  KIRBY_NAIR,
  KIRBY_FAIR,
  KIRBY_BAIR,
  KIRBY_NEUTRAL_SPECIAL,
  KIRBY_SIDE_SPECIAL,
  KIRBY_UP_SPECIAL,
  KIRBY_DOWN_SPECIAL,
  KIRBY_GRAB,
  KIRBY_MOVESET,
  KIRBY_FIGHTER_CONTRACT,
} from './Kirby';
import { KIRBY_SPEC, KIRBY_MOVES } from './roster';
import { KIRBY_PALETTES } from './palettes';
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

describe('Kirby — movement profile (multi-jump puffball)', () => {
  it('ships the light floaty line: run 5.5, mass 7, four jumps', () => {
    expect(KIRBY_MOVEMENT_PROFILE.maxRunSpeed).toBe(5.5);
    expect(KIRBY_MOVEMENT_PROFILE.mass).toBe(7);
    expect(KIRBY_MOVEMENT_PROFILE.maxJumps).toBe(4);
    // One notch below Puff on every float axis so Puff keeps the cast's
    // float superlatives; Kirby's identity lives in the kit.
    expect(KIRBY_MOVEMENT_PROFILE.maxJumps).toBeGreaterThan(2); // multi-jump
    expect(KIRBY_MOVEMENT_PROFILE.maxJumps).toBeLessThan(5); // below Puff
  });

  it('declares all four fall-shaping fields with sane relationships', () => {
    const p = KIRBY_MOVEMENT_PROFILE;
    expect(p.fallAccel).toBeGreaterThan(0);
    expect(p.fastFallSpeed).toBeGreaterThan(p.maxFallSpeed);
    expect(p.jumpCutFactor).toBeGreaterThan(0);
    expect(p.jumpCutFactor).toBeLessThan(1);
  });

  it('KIRBY_TUNING composes the profile plus the round puffball body geometry', () => {
    expect(KIRBY_TUNING.mass).toBe(KIRBY_MOVEMENT_PROFILE.mass);
    expect(KIRBY_TUNING.width).toBe(52);
    expect(KIRBY_TUNING.height).toBe(52);
  });

  it('is frozen — the replay determinism contract', () => {
    expect(Object.isFrozen(KIRBY_MOVEMENT_PROFILE)).toBe(true);
    expect(Object.isFrozen(KIRBY_MOVESET)).toBe(true);
    expect(Object.isFrozen(KIRBY_FIGHTER_CONTRACT)).toBe(true);
  });
});

describe('Kirby — specials reuse existing schemas', () => {
  it('neutral special is a commandGrab (inhale) that ignores shield', () => {
    expect(KIRBY_NEUTRAL_SPECIAL.specialKind).toBe('commandGrab');
    expect(KIRBY_NEUTRAL_SPECIAL.grab.ignoresShield).toBe(true);
    expect(() => validateNeutralSpecialMove(KIRBY_NEUTRAL_SPECIAL)).not.toThrow();
  });

  it('side special is a dashStrike hammer dash that outruns his sprint', () => {
    expect(KIRBY_SIDE_SPECIAL.sideSpecialKind).toBe('dashStrike');
    expect(KIRBY_SIDE_SPECIAL.dashStrike.dashSpeed).toBeGreaterThan(KIRBY_MOVEMENT_PROFILE.maxRunSpeed);
    expect(KIRBY_SIDE_SPECIAL.dashStrike.helplessAfterDash).toBe(false);
    expect(() => validateSideSpecialMove(KIRBY_SIDE_SPECIAL)).not.toThrow();
  });

  it('up special is a multiHitRising final cutter with an upward rise', () => {
    expect(KIRBY_UP_SPECIAL.upSpecialKind).toBe('multiHitRising');
    expect(KIRBY_UP_SPECIAL.multiHitRising.riseImpulse).toBeLessThan(0);
    expect(() => validateUpSpecialMove(KIRBY_UP_SPECIAL)).not.toThrow();
  });

  it('down special is a stallAndFall stone with a meteor descent', () => {
    expect(KIRBY_DOWN_SPECIAL.downSpecialKind).toBe('stallAndFall');
    expect(KIRBY_DOWN_SPECIAL.knockback.y).toBeGreaterThan(0); // +y is downward
    expect(() => validateDownSpecialMove(KIRBY_DOWN_SPECIAL)).not.toThrow();
  });

  it('aerials validate', () => {
    expect(() => validateAerialMove(KIRBY_NAIR)).not.toThrow();
    expect(() => validateAerialMove(KIRBY_FAIR)).not.toThrow();
    expect(() => validateAerialMove(KIRBY_BAIR)).not.toThrow();
  });
});

describe('Kirby — moveset contract + roster spec', () => {
  it('satisfies the canonical 10-slot moveset contract', () => {
    expect(() => assertFighterMoveset('kirby', KIRBY_MOVESET)).not.toThrow();
    expect(KIRBY_FIGHTER_CONTRACT.id).toBe('kirby');
    expect(KIRBY_FIGHTER_CONTRACT.moveset).toBe(KIRBY_MOVESET);
    expect(KIRBY_FIGHTER_CONTRACT.movementProfile).toBe(KIRBY_MOVEMENT_PROFILE);
  });

  it('roster spec is sprite-wired (AI sprite pack)', () => {
    expect(KIRBY_SPEC.displayName).toBe('Kirby');
    expect(KIRBY_SPEC.role).toBe('multi-jump puffball (Kirby)');
    expect(KIRBY_SPEC.playable).toBe(true);
    // Kirby ships a full AI per-move sprite pack → spriteKey points at the idle sheet.
    expect(KIRBY_SPEC.placeholder.spriteKey).not.toBeNull();
  });

  it('ships the full 10-move table with namespaced ids', () => {
    expect(KIRBY_MOVES).toHaveLength(10);
    for (const move of KIRBY_MOVES) {
      expect(move.id.startsWith('kirby.'), move.id).toBe(true);
    }
  });

  it('grounded triplet escalates damage AND startup (jab < tilt < smash)', () => {
    expect(KIRBY_JAB.damage).toBeLessThan(KIRBY_TILT.damage);
    expect(KIRBY_TILT.damage).toBeLessThan(KIRBY_SMASH.damage);
    expect(KIRBY_JAB.startupFrames).toBeLessThan(KIRBY_TILT.startupFrames);
    expect(KIRBY_TILT.startupFrames).toBeLessThan(KIRBY_SMASH.startupFrames);
  });

  it('ships an 8-entry palette ladder with distinct primary colours', () => {
    expect(KIRBY_PALETTES).toHaveLength(8);
    expect(KIRBY_PALETTES[0]!.primaryColor).toBe(KIRBY_SPEC.placeholder.primaryColor);
    const primaries = new Set(KIRBY_PALETTES.map((p) => p.primaryColor));
    expect(primaries.size).toBe(8);
  });

  it('grab spec validates and carries all four throws', () => {
    expect(() => validateGrabSpec(KIRBY_GRAB, 'Kirby.test')).not.toThrow();
    expect(Object.keys(KIRBY_GRAB.throws).sort()).toEqual(['back', 'down', 'forward', 'up']);
  });
});

describe('Kirby — constructor wiring (MockScene smoke)', () => {
  it('constructs, registers the kit, and fires a signature move', () => {
    const m = createMockScene();
    const ch = new Kirby(m.scene, { spawnX: 100, spawnY: 200 });
    expect(ch.id).toBe('kirby');
    expect(ch.attemptAttack(KIRBY_SMASH.id)).toBe(true);
    expect(ch.getActiveAttack()?.move.id).toBe('kirby.smash');
  });

  it('registers the grab spec on construction', () => {
    const m = createMockScene();
    const ch = new Kirby(m.scene, { spawnX: 0, spawnY: 0 });
    expect(ch.getGrabSpec()).toBe(KIRBY_GRAB);
  });
});
