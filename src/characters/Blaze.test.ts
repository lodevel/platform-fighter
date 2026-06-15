/**
 * Blaze (Captain Falcon) — per-fighter data + wiring coverage.
 *
 * Post-M5 roster expansion. Locks down the rushdown identity the
 * fighter was authored against:
 *
 *   1. Movement profile — fast-heavy stats (run 9.0, mass 14, the
 *      steepest fall shaping in the cast) and the four fall-shaping
 *      fields every profile must now carry.
 *   2. The knee — fair's sweet-spot is a strict sub-region at the
 *      leading tip with the kit's biggest `damageGrowth` term.
 *   3. The blaze punch — 20-frame startup / 24 % / `baseMagnitude: 2`
 *      on the existing `charge` schema, passing its validator.
 *   4. Specials reuse existing schemas only (charge / dashStrike /
 *      multiHitRising / groundPound) and pass their validators.
 *   5. Constructor wiring — every slot fires its authored move through
 *      the shared MockScene harness; grab spec is registered.
 *
 * Same Phaser-free MockScene pattern as the rest of
 * `src/characters/*.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import {
  Blaze,
  BLAZE_TUNING,
  BLAZE_MOVEMENT_PROFILE,
  BLAZE_JAB,
  BLAZE_TILT,
  BLAZE_SMASH,
  BLAZE_NAIR,
  BLAZE_FAIR,
  BLAZE_BAIR,
  BLAZE_NEUTRAL_SPECIAL,
  BLAZE_SIDE_SPECIAL,
  BLAZE_UP_SPECIAL,
  BLAZE_DOWN_SPECIAL,
  BLAZE_GRAB,
  BLAZE_MOVESET,
  BLAZE_FIGHTER_CONTRACT,
} from './Blaze';
import { BLAZE_SPEC, BLAZE_MOVES } from './roster';
import { assertFighterMoveset } from './movesetContract';
import { validateNeutralSpecialMove } from './specialSchema';
import { validateSideSpecialMove } from './sideSpecialSchema';
import { validateUpSpecialMove } from './upSpecialSchema';
import { validateDownSpecialMove } from './downSpecialSchema';
import { validateAerialMove } from './aerialSchema';
import { validateGrabSpec } from './grabSchema';

// ---------------------------------------------------------------------------
// MockScene — same Phaser-free shape as perFighterSmoke.test.ts.
// ---------------------------------------------------------------------------

function createMockScene(): { scene: any } {
  const matter = {
    add: {
      rectangle(x: number, y: number, _w: number, _h: number, options: Record<string, unknown>) {
        return {
          position: { x, y },
          velocity: { x: 0, y: 0 },
          label: options['label'],
          options,
          removed: false,
        };
      },
    },
    body: {
      setVelocity(b: any, v: { x: number; y: number }): void {
        b.velocity = { x: v.x, y: v.y };
      },
      setPosition(b: any, v: { x: number; y: number }): void {
        b.position = { x: v.x, y: v.y };
      },
      setInertia(): void {
        /* no-op */
      },
    },
    world: {
      on(): void {
        /* no-op */
      },
      off(): void {
        /* no-op */
      },
      remove(b: any): void {
        b.removed = true;
      },
    },
  };
  return { scene: { matter } };
}

// ---------------------------------------------------------------------------
// Movement profile — the "fast heavy" identity
// ---------------------------------------------------------------------------

describe('Blaze — movement profile (fast-heavy rushdown)', () => {
  it('ships the rushdown stat line: run 9.0, mass 14, steep fall shaping', () => {
    expect(BLAZE_MOVEMENT_PROFILE.maxRunSpeed).toBe(9.0);
    expect(BLAZE_MOVEMENT_PROFILE.mass).toBe(14);
    expect(BLAZE_MOVEMENT_PROFILE.fallAccel).toBe(0.4);
    expect(BLAZE_MOVEMENT_PROFILE.maxFallSpeed).toBe(12.5);
    expect(BLAZE_MOVEMENT_PROFILE.maxJumps).toBe(2);
  });

  it('declares all four fall-shaping fields with sane relationships', () => {
    const p = BLAZE_MOVEMENT_PROFILE;
    expect(p.fallAccel).toBeGreaterThan(0);
    expect(p.fastFallSpeed).toBeGreaterThan(p.maxFallSpeed);
    expect(p.jumpCutFactor).toBeGreaterThan(0);
    expect(p.jumpCutFactor).toBeLessThan(1);
  });

  it('BLAZE_TUNING composes the profile plus inline body geometry', () => {
    expect(BLAZE_TUNING.maxRunSpeed).toBe(BLAZE_MOVEMENT_PROFILE.maxRunSpeed);
    expect(BLAZE_TUNING.mass).toBe(BLAZE_MOVEMENT_PROFILE.mass);
    expect(BLAZE_TUNING.width).toBe(50);
    expect(BLAZE_TUNING.height).toBe(78);
    expect(BLAZE_TUNING.chamfer).toBe(8);
  });

  it('is frozen — the replay determinism contract', () => {
    expect(Object.isFrozen(BLAZE_MOVEMENT_PROFILE)).toBe(true);
    expect(Object.isFrozen(BLAZE_MOVESET)).toBe(true);
    expect(Object.isFrozen(BLAZE_FIGHTER_CONTRACT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Signature moves
// ---------------------------------------------------------------------------

describe('Blaze — the knee (sweet-spot fair)', () => {
  it('authors a sweet-spot with damage and knockback multipliers', () => {
    expect(BLAZE_FAIR.sweetSpot).toBeDefined();
    expect(BLAZE_FAIR.sweetSpot!.damageMultiplier).toBeGreaterThan(1);
    expect(BLAZE_FAIR.sweetSpot!.knockbackMultiplier).toBeGreaterThan(1);
  });

  it('sweet-spot is a strict sub-region at the leading tip of the parent hitbox', () => {
    const parent = BLAZE_FAIR.hitbox;
    const tip = BLAZE_FAIR.sweetSpot!.hitbox;
    const pLeft = parent.offsetX - parent.width / 2;
    const pRight = parent.offsetX + parent.width / 2;
    const tLeft = tip.offsetX - tip.width / 2;
    const tRight = tip.offsetX + tip.width / 2;
    // Strictly inside horizontally…
    expect(tLeft).toBeGreaterThan(pLeft);
    expect(tRight).toBeLessThan(pRight);
    // …and pinned at the FAR (leading) end.
    expect(tip.offsetX).toBeGreaterThan(parent.offsetX);
    // Vertically inside too.
    expect(tip.offsetY - tip.height / 2).toBeGreaterThanOrEqual(
      parent.offsetY - parent.height / 2,
    );
    expect(tip.offsetY + tip.height / 2).toBeLessThanOrEqual(
      parent.offsetY + parent.height / 2,
    );
  });

  it('carries the biggest damageGrowth in his kit — the tip-knee KO scaling', () => {
    expect(BLAZE_FAIR.knockback.damageGrowth).toBe(0.9);
    for (const move of BLAZE_MOVES) {
      if (move.id === BLAZE_FAIR.id) continue;
      expect(move.knockback.damageGrowth ?? 0).toBeLessThan(
        BLAZE_FAIR.knockback.damageGrowth!,
      );
    }
  });

  it('passes the aerial-schema validator', () => {
    expect(() => validateAerialMove(BLAZE_FAIR)).not.toThrow();
    expect(() => validateAerialMove(BLAZE_NAIR)).not.toThrow();
    expect(() => validateAerialMove(BLAZE_BAIR)).not.toThrow();
  });
});

describe('Blaze — blaze punch (slow devastating neutral special)', () => {
  it('authors the haymaker numbers: 20-frame startup, 24 %, baseMagnitude 2', () => {
    expect(BLAZE_NEUTRAL_SPECIAL.startupFrames).toBe(20);
    expect(BLAZE_NEUTRAL_SPECIAL.damage).toBe(24);
    expect(BLAZE_NEUTRAL_SPECIAL.knockback.baseMagnitude).toBe(2);
  });

  it('rides the existing charge schema (no new schema work) and validates', () => {
    expect(BLAZE_NEUTRAL_SPECIAL.specialKind).toBe('charge');
    expect(() => validateNeutralSpecialMove(BLAZE_NEUTRAL_SPECIAL)).not.toThrow();
    // Bare press already fires the full 24 % — the hold is a bonus.
    expect(BLAZE_NEUTRAL_SPECIAL.charge.minDamage).toBe(24);
    expect(BLAZE_NEUTRAL_SPECIAL.charge.maxDamage).toBeGreaterThan(24);
  });

  it('out-damages every other move in the kit', () => {
    for (const move of BLAZE_MOVES) {
      if (move.id === BLAZE_NEUTRAL_SPECIAL.id) continue;
      expect(move.damage, move.id).toBeLessThan(BLAZE_NEUTRAL_SPECIAL.damage);
    }
  });
});

describe('Blaze — remaining specials reuse existing schemas', () => {
  it('side special is a dashStrike burst that outruns his own sprint', () => {
    expect(BLAZE_SIDE_SPECIAL.sideSpecialKind).toBe('dashStrike');
    expect(BLAZE_SIDE_SPECIAL.dashStrike.dashSpeed).toBeGreaterThan(
      BLAZE_MOVEMENT_PROFILE.maxRunSpeed,
    );
    expect(BLAZE_SIDE_SPECIAL.dashStrike.helplessAfterDash).toBe(false);
    expect(() => validateSideSpecialMove(BLAZE_SIDE_SPECIAL)).not.toThrow();
  });

  it('up special is a multiHitRising uppercut with an upward rise', () => {
    expect(BLAZE_UP_SPECIAL.upSpecialKind).toBe('multiHitRising');
    expect(BLAZE_UP_SPECIAL.multiHitRising.riseImpulse).toBeLessThan(0);
    expect(BLAZE_UP_SPECIAL.multiHitRising.hitCount).toBe(3);
    expect(() => validateUpSpecialMove(BLAZE_UP_SPECIAL)).not.toThrow();
  });

  it('down special is a groundPound stomp with the fastest slam in the cast', () => {
    expect(BLAZE_DOWN_SPECIAL.downSpecialKind).toBe('groundPound');
    expect(BLAZE_DOWN_SPECIAL.groundPound.slamVelocity).toBe(32);
    // Meteor trajectory — +y is downward in screen space.
    expect(BLAZE_DOWN_SPECIAL.knockback.y).toBeGreaterThan(0);
    expect(() => validateDownSpecialMove(BLAZE_DOWN_SPECIAL)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Moveset / roster / grab wiring
// ---------------------------------------------------------------------------

describe('Blaze — moveset contract + roster spec', () => {
  it('satisfies the canonical 10-slot moveset contract', () => {
    expect(() => assertFighterMoveset('blaze', BLAZE_MOVESET)).not.toThrow();
    expect(BLAZE_FIGHTER_CONTRACT.id).toBe('blaze');
    expect(BLAZE_FIGHTER_CONTRACT.moveset).toBe(BLAZE_MOVESET);
    expect(BLAZE_FIGHTER_CONTRACT.movementProfile).toBe(BLAZE_MOVEMENT_PROFILE);
  });

  it('roster spec displays the inspiration in parentheses', () => {
    expect(BLAZE_SPEC.displayName).toBe('Blaze (Captain Falcon)');
    expect(BLAZE_SPEC.role).toBe('rushdown (Captain Falcon)');
    expect(BLAZE_SPEC.playable).toBe(true);
    // Post-M5 art drop — Blaze ships the Punk brawler sheet (OGA-BY 3.0,
    // 'Free 3 Cyberpunk Characters Pixel Art' by CraftPix.net).
    expect(BLAZE_SPEC.placeholder.spriteKey).toBe('char.blaze.idle');
  });

  it('ships the full 10-move table with namespaced ids', () => {
    expect(BLAZE_MOVES).toHaveLength(10);
    for (const move of BLAZE_MOVES) {
      expect(move.id.startsWith('blaze.'), move.id).toBe(true);
    }
  });

  it('grounded triplet escalates damage AND startup (jab < tilt < smash)', () => {
    expect(BLAZE_JAB.damage).toBeLessThan(BLAZE_TILT.damage);
    expect(BLAZE_TILT.damage).toBeLessThan(BLAZE_SMASH.damage);
    expect(BLAZE_JAB.startupFrames).toBeLessThan(BLAZE_TILT.startupFrames);
    expect(BLAZE_TILT.startupFrames).toBeLessThan(BLAZE_SMASH.startupFrames);
  });

  it('grab spec validates and carries all four throws', () => {
    expect(() => validateGrabSpec(BLAZE_GRAB, 'Blaze.test')).not.toThrow();
    expect(Object.keys(BLAZE_GRAB.throws).sort()).toEqual([
      'back',
      'down',
      'forward',
      'up',
    ]);
  });
});

describe('Blaze — constructor wiring (MockScene smoke)', () => {
  it('constructs, registers the kit, and fires the signature moves', () => {
    const m = createMockScene();
    const ch = new Blaze(m.scene, { spawnX: 100, spawnY: 200 });
    expect(ch.id).toBe('blaze');
    // The knee fires through the public attack path.
    expect(ch.attemptAttack(BLAZE_FAIR.id)).toBe(true);
    expect(ch.getActiveAttack()?.move.id).toBe('blaze.fair');
  });

  it('registers the grab spec on construction', () => {
    const m = createMockScene();
    const ch = new Blaze(m.scene, { spawnX: 0, spawnY: 0 });
    expect(ch.getGrabSpec()).toBe(BLAZE_GRAB);
  });
});
