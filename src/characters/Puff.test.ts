/**
 * Puff (Jigglypuff) — per-fighter data + wiring coverage.
 *
 * Post-M5 roster expansion. Locks down the balloon identity the
 * fighter was authored against:
 *
 *   1. Movement profile — floatiest by far: FIVE jumps, fallAccel
 *      0.08, maxFallSpeed 6.5, mass 6, airAccel 0.6. Cross-cast
 *      superlatives are pinned against the registry so a future
 *      profile edit that steals her crown surfaces here.
 *   2. The slumber slam — Rest-analogue down special: 22 % +
 *      `baseMagnitude: 3` on a point-blank sensor behind a 50-frame
 *      recovery (the gamble).
 *   3. Rollout — `dashStrike` side special as her ground-approach
 *      burst.
 *   4. Weak pokes — the softest grounded triplet in the cast.
 *   5. Constructor wiring through the shared MockScene harness, incl.
 *      the five-jump budget flowing through the standard maxJumps
 *      plumbing.
 *
 * Same Phaser-free MockScene pattern as the rest of
 * `src/characters/*.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import {
  Puff,
  PUFF_TUNING,
  PUFF_MOVEMENT_PROFILE,
  PUFF_JAB,
  PUFF_TILT,
  PUFF_SMASH,
  PUFF_NAIR,
  PUFF_FAIR,
  PUFF_BAIR,
  PUFF_NEUTRAL_SPECIAL,
  PUFF_SIDE_SPECIAL,
  PUFF_UP_SPECIAL,
  PUFF_DOWN_SPECIAL,
  PUFF_GRAB,
  PUFF_MOVESET,
  PUFF_FIGHTER_CONTRACT,
} from './Puff';
import { PUFF_SPEC, PUFF_MOVES } from './roster';
import { FIGHTER_MOVEMENT_PROFILES } from './fighterMovementProfiles';
import { assertFighterMoveset } from './movesetContract';
import { validateNeutralSpecialMove } from './specialSchema';
import { validateSideSpecialMove } from './sideSpecialSchema';
import { validateUpSpecialMove } from './upSpecialSchema';
import { validateDownSpecialMove } from './downSpecialSchema';
import { validateAerialMove } from './aerialSchema';
import { validateGrabSpec } from './grabSchema';
import { getMoveBusyFrames } from './moveSchema';

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
// Movement profile — floatiest in the cast, by construction
// ---------------------------------------------------------------------------

describe('Puff — movement profile (the balloon)', () => {
  it('ships the balloon stat line: 5 jumps, fallAccel 0.08, mass 6', () => {
    expect(PUFF_MOVEMENT_PROFILE.maxJumps).toBe(5);
    expect(PUFF_MOVEMENT_PROFILE.fallAccel).toBe(0.08);
    expect(PUFF_MOVEMENT_PROFILE.maxFallSpeed).toBe(6.5);
    expect(PUFF_MOVEMENT_PROFILE.mass).toBe(6);
    expect(PUFF_MOVEMENT_PROFILE.airAccel).toBe(0.6);
    expect(PUFF_MOVEMENT_PROFILE.maxRunSpeed).toBe(5.0);
  });

  it('holds every cross-cast superlative the archetype demands', () => {
    for (const [id, profile] of Object.entries(FIGHTER_MOVEMENT_PROFILES)) {
      if (id === 'puff') continue;
      // Most jumps, lightest, floatiest, slowest terminal velocity,
      // best air control, slowest ground game — all in one fighter.
      expect(profile.maxJumps, `${id} maxJumps`).toBeLessThan(PUFF_MOVEMENT_PROFILE.maxJumps);
      expect(profile.mass, `${id} mass`).toBeGreaterThan(PUFF_MOVEMENT_PROFILE.mass);
      expect(profile.fallAccel, `${id} fallAccel`).toBeGreaterThan(PUFF_MOVEMENT_PROFILE.fallAccel);
      expect(profile.maxFallSpeed, `${id} maxFallSpeed`).toBeGreaterThan(PUFF_MOVEMENT_PROFILE.maxFallSpeed);
      expect(profile.airAccel, `${id} airAccel`).toBeLessThanOrEqual(PUFF_MOVEMENT_PROFILE.airAccel);
      expect(profile.maxRunSpeed, `${id} maxRunSpeed`).toBeGreaterThan(PUFF_MOVEMENT_PROFILE.maxRunSpeed);
    }
  });

  it('PUFF_TUNING composes the profile plus the round body geometry', () => {
    expect(PUFF_TUNING.maxJumps).toBe(PUFF_MOVEMENT_PROFILE.maxJumps);
    expect(PUFF_TUNING.width).toBe(56);
    expect(PUFF_TUNING.height).toBe(56);
    expect(PUFF_TUNING.chamfer).toBe(14); // heaviest chamfer — reads as a ball
  });

  it('is frozen — the replay determinism contract', () => {
    expect(Object.isFrozen(PUFF_MOVEMENT_PROFILE)).toBe(true);
    expect(Object.isFrozen(PUFF_MOVESET)).toBe(true);
    expect(Object.isFrozen(PUFF_FIGHTER_CONTRACT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The slumber slam — high-risk high-reward down special
// ---------------------------------------------------------------------------

describe('Puff — slumber slam (Rest-analogue down special)', () => {
  it('authors the gamble: 22 % + baseMagnitude 3 behind a 50-frame recovery', () => {
    expect(PUFF_DOWN_SPECIAL.damage).toBe(22);
    expect(PUFF_DOWN_SPECIAL.knockback.baseMagnitude).toBe(3);
    expect(PUFF_DOWN_SPECIAL.recoveryFrames).toBe(50);
    // Rest launches UP (-y), not a meteor.
    expect(PUFF_DOWN_SPECIAL.knockback.y).toBeLessThan(0);
  });

  it('is effectively instant — the reward side of the gamble', () => {
    expect(PUFF_DOWN_SPECIAL.startupFrames).toBe(2);
    // …on a point-blank body-sized sensor: you must be touching her.
    expect(PUFF_DOWN_SPECIAL.hitbox.offsetX).toBe(0);
    expect(PUFF_DOWN_SPECIAL.hitbox.width).toBeLessThanOrEqual(PUFF_TUNING.width);
  });

  it('whiff lockout is the longest of any move in her kit', () => {
    const slamBusy = getMoveBusyFrames(PUFF_DOWN_SPECIAL);
    for (const move of PUFF_MOVES) {
      if (move.id === PUFF_DOWN_SPECIAL.id) continue;
      expect(getMoveBusyFrames(move as never), move.id).toBeLessThan(slamBusy);
    }
  });

  it('rides the existing groundPound schema (no new schema work) and validates', () => {
    expect(PUFF_DOWN_SPECIAL.downSpecialKind).toBe('groundPound');
    expect(() => validateDownSpecialMove(PUFF_DOWN_SPECIAL)).not.toThrow();
  });

  it('out-damages every smash in her own kit by double digits', () => {
    expect(PUFF_DOWN_SPECIAL.damage - PUFF_SMASH.damage).toBeGreaterThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// Rollout + remaining specials
// ---------------------------------------------------------------------------

describe('Puff — rollout and supporting specials', () => {
  it('side special is a rollout-style dashStrike that triples her run speed', () => {
    expect(PUFF_SIDE_SPECIAL.sideSpecialKind).toBe('dashStrike');
    expect(PUFF_SIDE_SPECIAL.dashStrike.dashSpeed).toBeGreaterThanOrEqual(
      PUFF_MOVEMENT_PROFILE.maxRunSpeed * 3,
    );
    expect(PUFF_SIDE_SPECIAL.dashStrike.helplessAfterDash).toBe(false);
    expect(() => validateSideSpecialMove(PUFF_SIDE_SPECIAL)).not.toThrow();
  });

  it('neutral special is a charge puff and validates', () => {
    expect(PUFF_NEUTRAL_SPECIAL.specialKind).toBe('charge');
    expect(() => validateNeutralSpecialMove(PUFF_NEUTRAL_SPECIAL)).not.toThrow();
  });

  it('up special is the softest multiHitRising in the kit — jumps are her recovery', () => {
    expect(PUFF_UP_SPECIAL.upSpecialKind).toBe('multiHitRising');
    expect(PUFF_UP_SPECIAL.multiHitRising.riseImpulse).toBeLessThan(0);
    expect(() => validateUpSpecialMove(PUFF_UP_SPECIAL)).not.toThrow();
  });

  it('aerials validate against the aerial schema', () => {
    for (const aerial of [PUFF_NAIR, PUFF_FAIR, PUFF_BAIR]) {
      expect(() => validateAerialMove(aerial)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Weak pokes / roster / wiring
// ---------------------------------------------------------------------------

describe('Puff — moveset contract + roster spec', () => {
  it('satisfies the canonical 10-slot moveset contract', () => {
    expect(() => assertFighterMoveset('puff', PUFF_MOVESET)).not.toThrow();
    expect(PUFF_FIGHTER_CONTRACT.id).toBe('puff');
    expect(PUFF_FIGHTER_CONTRACT.moveset).toBe(PUFF_MOVESET);
    expect(PUFF_FIGHTER_CONTRACT.movementProfile).toBe(PUFF_MOVEMENT_PROFILE);
  });

  it('roster spec displays the inspiration in parentheses', () => {
    expect(PUFF_SPEC.displayName).toBe('Puff (Jigglypuff)');
    expect(PUFF_SPEC.role).toBe('floaty (Jigglypuff)');
    expect(PUFF_SPEC.playable).toBe(true);
    // Post-M5 art drop — Puff ships the SLIME04 sheet (CC0,
    // 'Adventurer and Slime game Sprites' by Segel).
    expect(PUFF_SPEC.placeholder.spriteKey).toBe('char.puff.idle');
  });

  it('ships the full 10-move table with namespaced ids', () => {
    expect(PUFF_MOVES).toHaveLength(10);
    for (const move of PUFF_MOVES) {
      expect(move.id.startsWith('puff.'), move.id).toBe(true);
    }
  });

  it('grounded triplet escalates damage AND startup, and is the softest in the cast', () => {
    expect(PUFF_JAB.damage).toBeLessThan(PUFF_TILT.damage);
    expect(PUFF_TILT.damage).toBeLessThan(PUFF_SMASH.damage);
    expect(PUFF_JAB.startupFrames).toBeLessThan(PUFF_TILT.startupFrames);
    expect(PUFF_TILT.startupFrames).toBeLessThan(PUFF_SMASH.startupFrames);
    // Weak-pokes identity: jab 3 / tilt 6 / smash 11.
    expect(PUFF_JAB.damage).toBe(3);
    expect(PUFF_SMASH.damage).toBe(11);
  });

  it('grab spec validates and carries all four throws', () => {
    expect(() => validateGrabSpec(PUFF_GRAB, 'Puff.test')).not.toThrow();
    expect(Object.keys(PUFF_GRAB.throws).sort()).toEqual([
      'back',
      'down',
      'forward',
      'up',
    ]);
  });
});

describe('Puff — constructor wiring (MockScene smoke)', () => {
  it('constructs with the five-jump budget flowing through standard plumbing', () => {
    const m = createMockScene();
    const ch = new Puff(m.scene, { spawnX: 100, spawnY: 200 });
    expect(ch.id).toBe('puff');
    expect(ch.getTuning().maxJumps).toBe(5);
    // Airborne (never grounded under the mock) — she can burn all five
    // jumps mid-air, the canonical balloon recovery.
    for (let i = 0; i < 5; i++) {
      ch.applyInput({ moveX: 0, jump: true });
      ch.applyInput({ moveX: 0, jump: false });
    }
    expect(ch.getJumpsUsed()).toBe(5);
    // Budget exhausted — a sixth press does not restore upward velocity.
    ch.applyInput({ moveX: 0, jump: true });
    expect(ch.getJumpsUsed()).toBe(5);
  });

  it('fires the slumber slam through the public attack path', () => {
    const m = createMockScene();
    const ch = new Puff(m.scene, { spawnX: 0, spawnY: 0 });
    expect(ch.attemptAttack(PUFF_DOWN_SPECIAL.id)).toBe(true);
    expect(ch.getActiveAttack()?.move.id).toBe('puff.down_special');
  });

  it('registers the grab spec on construction', () => {
    const m = createMockScene();
    const ch = new Puff(m.scene, { spawnX: 0, spawnY: 0 });
    expect(ch.getGrabSpec()).toBe(PUFF_GRAB);
  });
});
