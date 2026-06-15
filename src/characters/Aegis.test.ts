/**
 * Aegis (Marth) — per-fighter data + wiring coverage.
 *
 * Post-M5 roster expansion. Locks down the sword-spacing identity the
 * fighter was authored against:
 *
 *   1. The tipper rule — EVERY normal (jab / tilt / smash / nair /
 *      fair / bair) authors a `sweetSpot` sub-region at the far end of
 *      a generous-reach hitbox, ×1.35 damage / ×1.3 knockback. The
 *      geometry invariant (tip strictly inside the parent, pinned at
 *      the leading edge) is asserted move-by-move so a balance pass
 *      that drags a tip inward or outside the parent surfaces here.
 *   2. Counter neutral special — same `counter` schema as Wolf's.
 *   3. Dolphin slash — 3-frame `multiHitRising` with the steepest rise
 *      in the cast.
 *   4. Mid stats — mass 11, run 8.0, standard double jump.
 *   5. Constructor wiring through the shared MockScene harness.
 *
 * Same Phaser-free MockScene pattern as the rest of
 * `src/characters/*.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import {
  Aegis,
  AEGIS_TUNING,
  AEGIS_MOVEMENT_PROFILE,
  AEGIS_JAB,
  AEGIS_TILT,
  AEGIS_SMASH,
  AEGIS_NAIR,
  AEGIS_FAIR,
  AEGIS_BAIR,
  AEGIS_NEUTRAL_SPECIAL,
  AEGIS_SIDE_SPECIAL,
  AEGIS_UP_SPECIAL,
  AEGIS_DOWN_SPECIAL,
  AEGIS_GRAB,
  AEGIS_MOVESET,
  AEGIS_FIGHTER_CONTRACT,
} from './Aegis';
import { AEGIS_SPEC, AEGIS_MOVES } from './roster';
import { WOLF_NEUTRAL_SPECIAL } from './Wolf';
import { FIGHTER_MOVEMENT_PROFILES } from './fighterMovementProfiles';
import { assertFighterMoveset } from './movesetContract';
import {
  isCounterSpecial,
  validateNeutralSpecialMove,
} from './specialSchema';
import { validateSideSpecialMove } from './sideSpecialSchema';
import { validateUpSpecialMove } from './upSpecialSchema';
import { validateDownSpecialMove } from './downSpecialSchema';
import { validateAerialMove } from './aerialSchema';
import { validateGrabSpec } from './grabSchema';
import type { AttackMove } from './attacks';

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

/** The six normals that must each carry a tip sweet-spot. */
const AEGIS_NORMALS: ReadonlyArray<AttackMove> = [
  AEGIS_JAB,
  AEGIS_TILT,
  AEGIS_SMASH,
  AEGIS_NAIR,
  AEGIS_FAIR,
  AEGIS_BAIR,
];

// ---------------------------------------------------------------------------
// The tipper rule
// ---------------------------------------------------------------------------

describe('Aegis — tip sweet-spot on EVERY normal (the tipper rule)', () => {
  for (const move of AEGIS_NORMALS) {
    describe(move.id, () => {
      it('authors a sweet-spot with the canonical ×1.35 / ×1.3 multipliers', () => {
        expect(move.sweetSpot, `${move.id} sweetSpot`).toBeDefined();
        expect(move.sweetSpot!.damageMultiplier).toBe(1.35);
        expect(move.sweetSpot!.knockbackMultiplier).toBe(1.3);
      });

      it('tip is a strict sub-region pinned at the far end of the blade', () => {
        const parent = move.hitbox;
        const tip = move.sweetSpot!.hitbox;
        const pLeft = parent.offsetX - parent.width / 2;
        const pRight = parent.offsetX + parent.width / 2;
        const tLeft = tip.offsetX - tip.width / 2;
        const tRight = tip.offsetX + tip.width / 2;
        // Strictly inside horizontally — a tip outside the parent
        // would simply never fire per the runtime's
        // pointInSweetSpot && pointInHitbox conjunction.
        expect(tLeft, `${move.id} tip left edge`).toBeGreaterThan(pLeft);
        expect(tRight, `${move.id} tip right edge`).toBeLessThan(pRight);
        // Pinned at the FAR end: the tip's centre sits beyond the
        // parent's centre, in the outer half of the blade.
        expect(tip.offsetX, `${move.id} tip centre`).toBeGreaterThan(parent.offsetX);
        expect(tLeft, `${move.id} tip in outer half`).toBeGreaterThanOrEqual(
          parent.offsetX,
        );
        // Vertically inside too.
        expect(tip.offsetY - tip.height / 2).toBeGreaterThanOrEqual(
          parent.offsetY - parent.height / 2,
        );
        expect(tip.offsetY + tip.height / 2).toBeLessThanOrEqual(
          parent.offsetY + parent.height / 2,
        );
      });
    });
  }

  it('grounded reach ladder out-ranges the cast convention (generous-reach hitboxes)', () => {
    // Leading edge = offsetX + width/2. Aegis's spacing identity:
    // every rung reaches further than the previous one.
    const jabReach = AEGIS_JAB.hitbox.offsetX + AEGIS_JAB.hitbox.width / 2;
    const tiltReach = AEGIS_TILT.hitbox.offsetX + AEGIS_TILT.hitbox.width / 2;
    const smashReach = AEGIS_SMASH.hitbox.offsetX + AEGIS_SMASH.hitbox.width / 2;
    expect(jabReach).toBeLessThan(tiltReach);
    expect(tiltReach).toBeLessThan(smashReach);
    // The smash's full extension is the longest grounded reach in his kit.
    expect(smashReach).toBe(61);
  });
});

// ---------------------------------------------------------------------------
// Specials
// ---------------------------------------------------------------------------

describe('Aegis — counter neutral special (Wolf-schema reuse)', () => {
  it('rides the same counter schema as Wolf and validates', () => {
    expect(AEGIS_NEUTRAL_SPECIAL.specialKind).toBe(WOLF_NEUTRAL_SPECIAL.specialKind);
    expect(isCounterSpecial(AEGIS_NEUTRAL_SPECIAL)).toBe(true);
    expect(() => validateNeutralSpecialMove(AEGIS_NEUTRAL_SPECIAL)).not.toThrow();
  });

  it('parry window spans the active phase, Smash-canonical multiplier', () => {
    const c = AEGIS_NEUTRAL_SPECIAL.counter;
    expect(c.counterWindowStart).toBe(AEGIS_NEUTRAL_SPECIAL.startupFrames);
    expect(c.counterWindowEnd).toBe(
      AEGIS_NEUTRAL_SPECIAL.startupFrames + AEGIS_NEUTRAL_SPECIAL.activeFrames,
    );
    expect(c.damageMultiplier).toBe(1.3);
    expect(c.minCounterDamage).toBeLessThan(c.maxCounterDamage);
  });

  it('the move itself deals no proactive damage — the counter IS the hit', () => {
    expect(AEGIS_NEUTRAL_SPECIAL.damage).toBe(0);
  });
});

describe('Aegis — dolphin slash + remaining specials', () => {
  it('up special is the fastest special in the cast with the steepest rise', () => {
    expect(AEGIS_UP_SPECIAL.upSpecialKind).toBe('multiHitRising');
    expect(AEGIS_UP_SPECIAL.startupFrames).toBe(3);
    expect(AEGIS_UP_SPECIAL.multiHitRising.riseImpulse).toBe(-19);
    expect(() => validateUpSpecialMove(AEGIS_UP_SPECIAL)).not.toThrow();
  });

  it('side special is a 3-hit dancing-blades multiHit with a launcher finisher', () => {
    expect(AEGIS_SIDE_SPECIAL.sideSpecialKind).toBe('multiHit');
    const m = AEGIS_SIDE_SPECIAL.multiHit;
    expect(m.hitCount).toBe(3);
    // The finisher hits hardest, in damage and launch.
    expect(m.damagePerHit[2]).toBeGreaterThan(m.damagePerHit[0]!);
    expect(Math.abs(m.knockbackPerHit[2]!.y)).toBeGreaterThan(
      Math.abs(m.knockbackPerHit[0]!.y),
    );
    expect(() => validateSideSpecialMove(AEGIS_SIDE_SPECIAL)).not.toThrow();
  });

  it('down special is a stallAndFall plunging thrust and validates', () => {
    expect(AEGIS_DOWN_SPECIAL.downSpecialKind).toBe('stallAndFall');
    expect(AEGIS_DOWN_SPECIAL.stallAndFall.helplessAfterFall).toBe(false);
    expect(() => validateDownSpecialMove(AEGIS_DOWN_SPECIAL)).not.toThrow();
  });

  it('aerials validate against the aerial schema', () => {
    for (const aerial of [AEGIS_NAIR, AEGIS_FAIR, AEGIS_BAIR]) {
      expect(() => validateAerialMove(aerial)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Mid stats / roster / wiring
// ---------------------------------------------------------------------------

describe('Aegis — movement profile (mid stats by design)', () => {
  it('ships the duelist stat line: run 8.0, mass 11, standard double jump', () => {
    expect(AEGIS_MOVEMENT_PROFILE.maxRunSpeed).toBe(8.0);
    expect(AEGIS_MOVEMENT_PROFILE.mass).toBe(11);
    expect(AEGIS_MOVEMENT_PROFILE.maxJumps).toBe(2);
  });

  it('mass sits strictly mid-cast — heavier than the lights, lighter than the heavies', () => {
    const masses = Object.values(FIGHTER_MOVEMENT_PROFILES).map((p) => p.mass);
    expect(Math.min(...masses)).toBeLessThan(AEGIS_MOVEMENT_PROFILE.mass);
    expect(Math.max(...masses)).toBeGreaterThan(AEGIS_MOVEMENT_PROFILE.mass);
  });

  it('declares all four fall-shaping fields with sane relationships', () => {
    const p = AEGIS_MOVEMENT_PROFILE;
    expect(p.fallAccel).toBeGreaterThan(0);
    expect(p.fastFallSpeed).toBeGreaterThan(p.maxFallSpeed);
    expect(p.jumpCutFactor).toBeGreaterThan(0);
    expect(p.jumpCutFactor).toBeLessThan(1);
  });

  it('AEGIS_TUNING composes the profile plus the slender body geometry', () => {
    expect(AEGIS_TUNING.mass).toBe(AEGIS_MOVEMENT_PROFILE.mass);
    expect(AEGIS_TUNING.width).toBe(46);
    expect(AEGIS_TUNING.height).toBe(76);
  });
});

describe('Aegis — moveset contract + roster spec', () => {
  it('satisfies the canonical 10-slot moveset contract', () => {
    expect(() => assertFighterMoveset('aegis', AEGIS_MOVESET)).not.toThrow();
    expect(AEGIS_FIGHTER_CONTRACT.id).toBe('aegis');
    expect(AEGIS_FIGHTER_CONTRACT.moveset).toBe(AEGIS_MOVESET);
    expect(AEGIS_FIGHTER_CONTRACT.movementProfile).toBe(AEGIS_MOVEMENT_PROFILE);
  });

  it('roster spec displays the inspiration in parentheses', () => {
    expect(AEGIS_SPEC.displayName).toBe('Aegis (Marth)');
    expect(AEGIS_SPEC.role).toBe('sword spacing (Marth)');
    expect(AEGIS_SPEC.playable).toBe(true);
    // Post-M5 art drop — Aegis ships the sword ADVENTURER sheet (CC0,
    // 'Adventurer and Slime game Sprites' by Segel).
    expect(AEGIS_SPEC.placeholder.spriteKey).toBe('char.aegis.idle');
  });

  it('ships the full 10-move table with namespaced ids', () => {
    expect(AEGIS_MOVES).toHaveLength(10);
    for (const move of AEGIS_MOVES) {
      expect(move.id.startsWith('aegis.'), move.id).toBe(true);
    }
  });

  it('grounded triplet escalates damage AND startup (jab < tilt < smash)', () => {
    expect(AEGIS_JAB.damage).toBeLessThan(AEGIS_TILT.damage);
    expect(AEGIS_TILT.damage).toBeLessThan(AEGIS_SMASH.damage);
    expect(AEGIS_JAB.startupFrames).toBeLessThan(AEGIS_TILT.startupFrames);
    expect(AEGIS_TILT.startupFrames).toBeLessThan(AEGIS_SMASH.startupFrames);
  });

  it('grab spec validates and carries all four throws', () => {
    expect(() => validateGrabSpec(AEGIS_GRAB, 'Aegis.test')).not.toThrow();
    expect(Object.keys(AEGIS_GRAB.throws).sort()).toEqual([
      'back',
      'down',
      'forward',
      'up',
    ]);
  });
});

describe('Aegis — constructor wiring (MockScene smoke)', () => {
  it('constructs, registers the kit, and fires the tipper smash', () => {
    const m = createMockScene();
    const ch = new Aegis(m.scene, { spawnX: 100, spawnY: 200 });
    expect(ch.id).toBe('aegis');
    expect(ch.attemptAttack(AEGIS_SMASH.id)).toBe(true);
    const active = ch.getActiveAttack();
    expect(active?.move.id).toBe('aegis.smash');
    // The live move carries the authored sweet-spot through to the
    // runtime — combat.ts reads it off the move record on contact.
    expect(active?.move.sweetSpot).toBe(AEGIS_SMASH.sweetSpot);
  });

  it('registers the grab spec on construction', () => {
    const m = createMockScene();
    const ch = new Aegis(m.scene, { spawnX: 0, spawnY: 0 });
    expect(ch.getGrabSpec()).toBe(AEGIS_GRAB);
  });
});
