/**
 * Link (Zelda) — per-fighter data + wiring coverage.
 *
 * Post-batch-3 roster expansion. Locks down the projectile-swordsman
 * zoner identity:
 *
 *   1. Movement profile — medium baseline stats (run 7.8, mass 12) and
 *      the four fall-shaping fields every profile must carry.
 *   2. Specials reuse existing schemas only (projectile / multiHit /
 *      tether / trap) and pass their validators.
 *   3. Moveset contract + roster spec + 8-entry palette ladder.
 *   4. Constructor wiring — the signature moves fire through the shared
 *      MockScene harness; grab spec is registered.
 */

import { describe, it, expect } from 'vitest';

import {
  Link,
  LINK_TUNING,
  LINK_MOVEMENT_PROFILE,
  LINK_JAB,
  LINK_TILT,
  LINK_SMASH,
  LINK_NAIR,
  LINK_FAIR,
  LINK_BAIR,
  LINK_NEUTRAL_SPECIAL,
  LINK_SIDE_SPECIAL,
  LINK_UP_SPECIAL,
  LINK_DOWN_SPECIAL,
  LINK_GRAB,
  LINK_MOVESET,
  LINK_FIGHTER_CONTRACT,
} from './Link';
import { LINK_SPEC, LINK_MOVES } from './roster';
import { LINK_PALETTES } from './palettes';
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

describe('Link — movement profile (projectile-swordsman zoner)', () => {
  it('ships the medium baseline line: run 7.8, mass 12', () => {
    expect(LINK_MOVEMENT_PROFILE.maxRunSpeed).toBe(7.8);
    expect(LINK_MOVEMENT_PROFILE.mass).toBe(12);
    expect(LINK_MOVEMENT_PROFILE.maxJumps).toBe(2);
  });

  it('declares all four fall-shaping fields with sane relationships', () => {
    const p = LINK_MOVEMENT_PROFILE;
    expect(p.fallAccel).toBeGreaterThan(0);
    expect(p.fastFallSpeed).toBeGreaterThan(p.maxFallSpeed);
    expect(p.jumpCutFactor).toBeGreaterThan(0);
    expect(p.jumpCutFactor).toBeLessThan(1);
  });

  it('LINK_TUNING composes the profile plus the tall swordsman body geometry', () => {
    expect(LINK_TUNING.mass).toBe(LINK_MOVEMENT_PROFILE.mass);
    expect(LINK_TUNING.width).toBe(46);
    expect(LINK_TUNING.height).toBe(72);
  });

  it('is frozen — the replay determinism contract', () => {
    expect(Object.isFrozen(LINK_MOVEMENT_PROFILE)).toBe(true);
    expect(Object.isFrozen(LINK_MOVESET)).toBe(true);
    expect(Object.isFrozen(LINK_FIGHTER_CONTRACT)).toBe(true);
  });
});

describe('Link — specials reuse existing schemas', () => {
  it('neutral special is a projectile (the hero’s bow arrow)', () => {
    expect(LINK_NEUTRAL_SPECIAL.specialKind).toBe('projectile');
    expect(LINK_NEUTRAL_SPECIAL.projectile.speed).toBeGreaterThan(0);
    expect(() => validateNeutralSpecialMove(LINK_NEUTRAL_SPECIAL)).not.toThrow();
  });

  it('side special is a multiHit boomerang with a launcher finisher', () => {
    expect(LINK_SIDE_SPECIAL.sideSpecialKind).toBe('multiHit');
    expect(LINK_SIDE_SPECIAL.multiHit.hitCount).toBe(3);
    expect(() => validateSideSpecialMove(LINK_SIDE_SPECIAL)).not.toThrow();
  });

  it('up special is a tether recovery whose extension geometry is consistent', () => {
    expect(LINK_UP_SPECIAL.upSpecialKind).toBe('tether');
    // Schema invariant: extensionSpeed * extensionFrames === maxRange.
    expect(LINK_UP_SPECIAL.tether.extensionSpeed * LINK_UP_SPECIAL.tether.extensionFrames)
      .toBe(LINK_UP_SPECIAL.tether.maxRange);
    expect(() => validateUpSpecialMove(LINK_UP_SPECIAL)).not.toThrow();
  });

  it('down special is a trap bomb that detonates on a fuse', () => {
    expect(LINK_DOWN_SPECIAL.downSpecialKind).toBe('trap');
    expect(LINK_DOWN_SPECIAL.trap.fuseDetonateFrames).toBeGreaterThan(0);
    expect(() => validateDownSpecialMove(LINK_DOWN_SPECIAL)).not.toThrow();
  });

  it('aerials validate', () => {
    expect(() => validateAerialMove(LINK_NAIR)).not.toThrow();
    expect(() => validateAerialMove(LINK_FAIR)).not.toThrow();
    expect(() => validateAerialMove(LINK_BAIR)).not.toThrow();
  });
});

describe('Link — moveset contract + roster spec', () => {
  it('satisfies the canonical 10-slot moveset contract', () => {
    expect(() => assertFighterMoveset('link', LINK_MOVESET)).not.toThrow();
    expect(LINK_FIGHTER_CONTRACT.id).toBe('link');
    expect(LINK_FIGHTER_CONTRACT.moveset).toBe(LINK_MOVESET);
    expect(LINK_FIGHTER_CONTRACT.movementProfile).toBe(LINK_MOVEMENT_PROFILE);
  });

  it('roster spec displays the inspiration in parentheses + is procedural (null sprite key)', () => {
    expect(LINK_SPEC.displayName).toBe('Link (Zelda)');
    expect(LINK_SPEC.role).toBe('projectile swordsman (Link)');
    expect(LINK_SPEC.playable).toBe(true);
    expect(LINK_SPEC.placeholder.spriteKey).toBeNull();
  });

  it('ships the full 10-move table with namespaced ids', () => {
    expect(LINK_MOVES).toHaveLength(10);
    for (const move of LINK_MOVES) {
      expect(move.id.startsWith('link.'), move.id).toBe(true);
    }
  });

  it('grounded triplet escalates damage AND startup (jab < tilt < smash)', () => {
    expect(LINK_JAB.damage).toBeLessThan(LINK_TILT.damage);
    expect(LINK_TILT.damage).toBeLessThan(LINK_SMASH.damage);
    expect(LINK_JAB.startupFrames).toBeLessThan(LINK_TILT.startupFrames);
    expect(LINK_TILT.startupFrames).toBeLessThan(LINK_SMASH.startupFrames);
  });

  it('ships an 8-entry palette ladder with distinct primary colours', () => {
    expect(LINK_PALETTES).toHaveLength(8);
    expect(LINK_PALETTES[0]!.primaryColor).toBe(LINK_SPEC.placeholder.primaryColor);
    const primaries = new Set(LINK_PALETTES.map((p) => p.primaryColor));
    expect(primaries.size).toBe(8);
  });

  it('grab spec validates and carries all four throws', () => {
    expect(() => validateGrabSpec(LINK_GRAB, 'Link.test')).not.toThrow();
    expect(Object.keys(LINK_GRAB.throws).sort()).toEqual(['back', 'down', 'forward', 'up']);
  });
});

describe('Link — constructor wiring (MockScene smoke)', () => {
  it('constructs, registers the kit, and fires a signature move', () => {
    const m = createMockScene();
    const ch = new Link(m.scene, { spawnX: 100, spawnY: 200 });
    expect(ch.id).toBe('link');
    expect(ch.attemptAttack(LINK_SMASH.id)).toBe(true);
    expect(ch.getActiveAttack()?.move.id).toBe('link.smash');
  });

  it('registers the grab spec on construction', () => {
    const m = createMockScene();
    const ch = new Link(m.scene, { spawnX: 0, spawnY: 0 });
    expect(ch.getGrabSpec()).toBe(LINK_GRAB);
  });
});
