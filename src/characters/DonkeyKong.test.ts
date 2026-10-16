/**
 * Donkey Kong — sourced-kit contract tests.
 *
 * Values are checked against the evidence record
 * (docs/review/2026-09-25/donkeykong-character/README.md): UFD frame data and
 * the dumped Ultimate script records. A passing test proves the data was
 * transcribed as intended, not that the match behaves like Ultimate.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  DonkeyKong,
  DONKEYKONG_TUNING,
  DONKEYKONG_MOVEMENT_PROFILE,
  DONKEYKONG_JAB,
  DONKEYKONG_JAB2,
  DONKEYKONG_TILT,
  DONKEYKONG_UTILT,
  DONKEYKONG_DTILT,
  DONKEYKONG_DASHATTACK,
  DONKEYKONG_SMASH,
  DONKEYKONG_USMASH,
  DONKEYKONG_DSMASH,
  DONKEYKONG_NAIR,
  DONKEYKONG_FAIR,
  DONKEYKONG_BAIR,
  DONKEYKONG_UAIR,
  DONKEYKONG_DAIR,
  DONKEYKONG_NEUTRAL_SPECIAL,
  DONKEYKONG_SIDE_SPECIAL,
  DONKEYKONG_UP_SPECIAL,
  DONKEYKONG_DOWN_SPECIAL,
  DONKEYKONG_GRAB,
  DONKEYKONG_MOVESET,
  DONKEYKONG_FIGHTER_CONTRACT,
} from './DonkeyKong';
import { DONKEYKONG_UFD_STATS } from './donkeykongUfdStats';
import { DONKEYKONG_SPEC, DONKEYKONG_MOVES } from './roster';
import { DONKEYKONG_PALETTES } from './palettes';
import { assertFighterMoveset } from './movesetContract';
import { validateNeutralSpecialMove } from './specialSchema';
import { validateSideSpecialMove } from './sideSpecialSchema';
import { validateUpSpecialMove } from './upSpecialSchema';
import { validateDownSpecialMove } from './downSpecialSchema';
import { validateAerialMove } from './aerialSchema';
import { validateGrabSpec } from './grabSchema';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import type { AttackMove } from './attacks';

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

/** UFD total frames = startup + active + recovery (first actionable elapsed step). */
const total = (m: AttackMove) => m.startupFrames + m.activeFrames + m.recoveryFrames;

describe('Donkey Kong — movement profile (UFD stats at 5 px/unit)', () => {
  it('converts walk / initial dash / run / air speed from the stats table', () => {
    const p = DONKEYKONG_MOVEMENT_PROFILE;
    expect(p.locomotion?.walkMaxSpeed).toBeCloseTo(1.365 * 5, 6);
    expect(p.locomotion?.initialDashSpeed).toBeCloseTo(2.09 * 5, 6);
    expect(p.locomotion?.dashDanceWindowFrames).toBe(15);
    expect(p.maxRunSpeed).toBeCloseTo(1.873 * 5, 6);
    expect(p.maxAirSpeed).toBeCloseTo(1.208 * 5, 6);
    expect(p.airAccel).toBeCloseTo(0.06 * 5, 6);
  });

  it('keeps the reference launch profile the launch-energy tests pin (weight 127, gravity 0.085, fall 1.63)', () => {
    const p = DONKEYKONG_MOVEMENT_PROFILE;
    expect(p.referenceWeight).toBe(127);
    expect(p.referenceLaunch?.gravity).toBe(0.085);
    expect(p.referenceLaunch?.fallSpeed).toBe(1.63);
    expect(p.maxFallSpeed).toBeCloseTo(1.63 * 5, 6);
    expect(p.fastFallSpeed).toBeCloseTo(2.608 * 5, 6);
    expect(DONKEYKONG_UFD_STATS.weight).toBe(127);
  });

  it('fits sourced heights using the opt-in vertical curve and gravity, with full-hop acceleration explicitly authored', () => {
    const p = DONKEYKONG_MOVEMENT_PROFILE;
    const vertical = p.donkeykongOrdinaryVertical;
    if (!vertical) throw new Error('DK ordinary vertical consumer profile missing');
    expect(vertical.totalGravity).toBeCloseTo(.085 * 5, 12);
    expect(-vertical.fullHopStepVelocitiesY.reduce((sum, velocity) => sum + velocity, 0))
      .toBeCloseTo(18.7 * 5, 10);
    const peak = (v0: number, initial: readonly number[] = []): number => {
      let y = 0, vy = -v0, best = 0;
      for (let step = 0; step < 200; step++) {
        vy = initial[step] ?? Math.min(vy + vertical.totalGravity, p.maxFallSpeed);
        y += vy; best = Math.max(best, -y);
        if (y >= 0 && step > 0) return best;
      }
      throw new Error('Selected DK vertical trajectory did not land');
    };
    expect(Math.abs(peak(p.jumpImpulse, vertical.fullHopStepVelocitiesY) - 34 * 5)).toBeLessThan(.001);
    expect(Math.abs(peak(p.shortHopImpulse!) - 17.3 * 5)).toBeLessThan(.01);
    expect(Math.abs(peak(p.airJumpImpulse!) - 35.5 * 5)).toBeLessThan(.01);
    // The selected full-hop first-four-step curve is calibrated. Air time and
    // native initial acceleration require separate actual-match source evidence.
  });

  it('dodges follow the UFD page (spot 3–17 of 26, roll 4–15 of 30, back roll 5–16 of 35, air dodge 4–32 of 48)', () => {
    const d = DONKEYKONG_MOVEMENT_PROFILE.dodge!;
    expect(d.spot).toMatchObject({ activeFrames: 17, iframeStartFrame: 2, iframeFrames: 15, recoveryFrames: 9 });
    expect(d.roll).toMatchObject({ activeFrames: 15, iframeStartFrame: 3, iframeFrames: 12, recoveryFrames: 15 });
    expect(d.backwardRoll).toMatchObject({ activeFrames: 16, iframeStartFrame: 4, iframeFrames: 12, recoveryFrames: 19 });
    expect(d.air).toMatchObject({ activeFrames: 32, iframeStartFrame: 3, iframeFrames: 29, recoveryFrames: 16 });
    expect(d.directionalAirUpRecoveryFrames).toBe(109 - 22);
  });

  it('DONKEYKONG_TUNING composes the profile plus the 60×84 movement body', () => {
    expect(DONKEYKONG_TUNING.width).toBe(60);
    expect(DONKEYKONG_TUNING.height).toBe(84);
    expect(DONKEYKONG_TUNING.referenceWeight).toBe(127);
  });

  it('is frozen — the replay determinism contract', () => {
    expect(Object.isFrozen(DONKEYKONG_MOVEMENT_PROFILE)).toBe(true);
    expect(Object.isFrozen(DONKEYKONG_MOVESET)).toBe(true);
    expect(Object.isFrozen(DONKEYKONG_FIGHTER_CONTRACT)).toBe(true);
  });
});

describe('Donkey Kong — UFD frame data (startup = first active − 1; sum = total)', () => {
  const rows: Array<[AttackMove, number, number, number]> = [
    // [move, UFD startup, UFD active count, UFD total]
    [DONKEYKONG_JAB, 5, 2, 24],
    [DONKEYKONG_JAB2, 4, 3, 31],
    [DONKEYKONG_TILT, 7, 3, 34],
    [DONKEYKONG_UTILT, 5, 7, 38],
    [DONKEYKONG_DTILT, 6, 2, 24],
    [DONKEYKONG_DASHATTACK, 9, 16, 34],
    [DONKEYKONG_SMASH, 22, 2, 54],
    [DONKEYKONG_USMASH, 14, 2, 49],
    [DONKEYKONG_DSMASH, 11, 4, 55],
    [DONKEYKONG_NAIR, 10, 17, 38],
    [DONKEYKONG_FAIR, 18, 6, 55],
    [DONKEYKONG_BAIR, 7, 10, 31],
    [DONKEYKONG_UAIR, 6, 5, 37],
    [DONKEYKONG_DAIR, 14, 3, 54],
    [DONKEYKONG_SIDE_SPECIAL, 20, 2, 62],
    [DONKEYKONG_DOWN_SPECIAL, 12, 13, 46],
  ];
  for (const [move, startup, active, totalFrames] of rows) {
    it(`${move.id}: startup ${startup}, ${active} active, total ${totalFrames}`, () => {
      expect(move.startupFrames).toBe(startup - 1);
      expect(move.activeFrames).toBe(active);
      expect(total(move)).toBe(totalFrames);
    });
  }

  it('Giant Punch releases on 19–20 after the charge state with SmashWiki\'s 42-frame endlag', () => {
    expect(DONKEYKONG_NEUTRAL_SPECIAL.startupFrames).toBe(18);
    expect(DONKEYKONG_NEUTRAL_SPECIAL.activeFrames).toBe(2);
    expect(DONKEYKONG_NEUTRAL_SPECIAL.recoveryFrames).toBe(42);
  });

  it('grounded Spinning Kong: hits at 19, 25–27, 32–33, 40–42, 49–50, 55–58, 62 of 104', () => {
    const g = DONKEYKONG_UP_SPECIAL.groundedVariant!;
    expect(total(g)).toBe(104);
    expect(g.hitWindows!.map(w => [w.startFrame, w.endFrame])).toEqual([
      [18, 19], [24, 27], [31, 33], [39, 42], [48, 50], [54, 58], [61, 62],
    ]);
    // Linking rungs: 1.4 % (pinned SpecialHi script and SmashWiki; UFD's 1.3 is the SSB4 value).
    expect(g.hitWindows!.filter(w => w.group?.startsWith('rung')).map(w => w.damage)).toEqual([1.4, 1.4, 1.4, 1.4, 1.4]);
  });

  it('a spin that lands before special fall continues from grounded frame 63 (42-frame tail)', () => {
    expect(DONKEYKONG_UP_SPECIAL.groundedLandingFrame).toBe(62);
    expect(total(DONKEYKONG_UP_SPECIAL.groundedVariant!) - DONKEYKONG_UP_SPECIAL.groundedLandingFrame!).toBe(42);
  });

  it('aerial Spinning Kong: first hit 4–6, twelve rungs, finisher 39–43, landing lag 38', () => {
    const m = DONKEYKONG_UP_SPECIAL.multiHitRising;
    expect(m.hitCount).toBe(14);
    expect(m.hitFrames![0]).toBe(0);
    expect(m.hitFrames![13]! + DONKEYKONG_UP_SPECIAL.startupFrames).toBe(38);
    expect(m.damagePerHit).toEqual([5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2]);
    expect(DONKEYKONG_UP_SPECIAL.specialLandingLagFrames).toBe(38);
  });
});

describe('Donkey Kong — script launch records', () => {
  it('jab 1 is 4 % Sakurai BKB 25 / KBG 35 with hitlag ×1.5 and chains to jab 2 from frame 8 (no jab 3)', () => {
    expect(DONKEYKONG_JAB.damage).toBe(4);
    expect(DONKEYKONG_JAB.knockback.reference).toEqual({ base: 25, growth: 35, angle: 361 });
    expect(DONKEYKONG_JAB.hitlagMultiplier).toBe(1.5);
    expect(DONKEYKONG_JAB.jabChain).toEqual({ nextId: 'donkeykong.jab2', advanceWindowStart: 7, continuationWindowEndFrame: 28 });
    expect(DONKEYKONG_JAB2.jabChain).toBeUndefined();
    expect(DONKEYKONG_JAB2.knockback.reference).toEqual({ base: 40, growth: 100, angle: 70 });
  });

  it('up tilt escalates shoulder 8 → arm 9 → hand 10 at 100°, lowest id wins', () => {
    // One native-posed window per active age 4–10 (UFD 5–11), each with all three regions.
    expect(DONKEYKONG_UTILT.hitWindows!.map(w => [w.startFrame, w.endFrame])).toEqual([4, 5, 6, 7, 8, 9, 10].map(a => [a, a + 1]));
    for (const w of DONKEYKONG_UTILT.hitWindows!) {
      expect(w.group).toBe('swing');
      expect(w.collisionHits!.map(h => [h.id, h.damage])).toEqual([[0, 8], [1, 9], [2, 10]]);
    }
    expect(DONKEYKONG_UTILT.launchAwayFromSource).toBe(true);
  });

  it('down tilt adds five reaction frames (set_add_reaction_frame 5)', () => {
    expect(DONKEYKONG_DTILT.knockback.reference).toMatchObject({ base: 10, growth: 80, angle: 361, additionalHitstunFrames: 5 });
  });

  it('forward smash: far 22 % at 46° and close 21 % Sakurai; charge hold on frame 14', () => {
    expect(DONKEYKONG_SMASH.chargeStartFrame).toBe(13);
    expect(DONKEYKONG_SMASH.collisionHits![0]).toMatchObject({ id: 0, damage: 22 });
    expect(DONKEYKONG_SMASH.knockback.reference).toEqual({ base: 21, growth: 88, angle: 46 });
    expect(DONKEYKONG_SMASH.collisionHits![1]!.knockback!.reference).toEqual({ base: 18, growth: 86, angle: 361 });
    expect(DONKEYKONG_SMASH.charge!.maxDamage).toBeCloseTo(22 * 1.4, 6);
  });

  it('forward air: 16 % early, then a 15 % meteor (270°) plus 13 % arms', () => {
    const late = DONKEYKONG_FAIR.hitWindows![1]!;
    expect(late.knockback!.reference).toEqual({ base: 30, growth: 100, angle: 270 });
    expect(late.hitlagMultiplier).toBe(1.5);
    expect(late.collisionHits!.map(h => h.damage)).toEqual([15, 13]);
  });

  it('down air: 16 % meteor at the feet and 13 % body hit; back air early 13 / late 8', () => {
    expect(DONKEYKONG_DAIR.knockback.reference).toEqual({ base: 30, growth: 90, angle: 270 });
    expect(DONKEYKONG_DAIR.collisionHits!.map(h => h.damage)).toEqual([16, 13]);
    expect(DONKEYKONG_BAIR.hitWindows!.map(w => w.damage)).toEqual([13, 8]);
    expect(DONKEYKONG_BAIR.aerialDirection).toBe('back');
  });

  it('aerials carry UFD landing lag and autocancel windows', () => {
    expect(DONKEYKONG_NAIR.landingLagFrames).toBe(10);
    expect(DONKEYKONG_NAIR.autoCancelWindows).toEqual([{ startFrame: 0, endFrame: 9 }, { startFrame: 26, endFrame: 38 }]);
    expect(DONKEYKONG_FAIR.landingLagFrames).toBe(17);
    expect(DONKEYKONG_BAIR.landingLagFrames).toBe(11);
    expect(DONKEYKONG_UAIR.landingLagFrames).toBe(15);
    expect(DONKEYKONG_DAIR.landingLagFrames).toBe(14);
  });
});

describe('Donkey Kong — specials', () => {
  it('Giant Punch is a bankable charge from 10 % to 28 % over 110 frames with full-charge-only armour on 9–20', () => {
    expect(DONKEYKONG_NEUTRAL_SPECIAL.specialKind).toBe('charge');
    expect(DONKEYKONG_NEUTRAL_SPECIAL.charge).toMatchObject({ minDamage: 10, maxDamage: 28, maxChargeFrames: 110 });
    expect(DONKEYKONG_NEUTRAL_SPECIAL.armorWindows).toEqual([{ startFrame: 8, endFrame: 20, minChargeRatio: 1 }]);
    expect(() => validateNeutralSpecialMove(DONKEYKONG_NEUTRAL_SPECIAL)).not.toThrow();
  });

  it('Headbutt has super armour on 5–14, a 10 % grounded meteor record and an 8 % aerial record', () => {
    expect(DONKEYKONG_SIDE_SPECIAL.armorWindows).toEqual([{ startFrame: 4, endFrame: 14 }]);
    const hits = DONKEYKONG_SIDE_SPECIAL.collisionHits!;
    expect(hits.filter(h => h.situation === 'ground')).toHaveLength(2);
    expect(hits.find(h => h.situation === 'air')).toMatchObject({ damage: 8 });
    expect(() => validateSideSpecialMove(DONKEYKONG_SIDE_SPECIAL)).not.toThrow();
  });

  it('Spinning Kong validates with grounded armour 5–17', () => {
    expect(DONKEYKONG_UP_SPECIAL.groundedVariant!.armorWindows).toEqual([{ startFrame: 4, endFrame: 17 }]);
    expect(() => validateUpSpecialMove(DONKEYKONG_UP_SPECIAL)).not.toThrow();
  });

  it('Hand Slap is a ground-only shockwave with a 26-frame mash loop and a two-clap aerial variant', () => {
    expect(DONKEYKONG_DOWN_SPECIAL.downSpecialKind).toBe('shockwave');
    for (const w of DONKEYKONG_DOWN_SPECIAL.hitWindows!) {
      expect(w.collisionHits!.every(h => h.situation === 'ground')).toBe(true);
    }
    // SpecialLwStart plays once (0–6); a repeat rewinds the 26-frame SpecialLwLoop (7–32) to its start.
    // SmashWiki: presses register through the startup and loop (0–32); loop frames 20–26 (26–32) repeat twice.
    expect(DONKEYKONG_DOWN_SPECIAL.shockwave.repeat).toEqual({ windowStart: 0, windowEnd: 33, loopFrame: 33, entryFrame: 7, doubleRepeatFrom: 26 });
    const air = DONKEYKONG_DOWN_SPECIAL.shockwave.aerialVariant!;
    expect(air.hitWindows!.map(w => [w.startFrame, w.endFrame, w.damage])).toEqual([[18, 21, 5], [27, 30, 6]]);
    expect(air.specialLandingLagFrames).toBe(10);
    expect(() => validateDownSpecialMove(DONKEYKONG_DOWN_SPECIAL)).not.toThrow();
  });

  it('aerials validate', () => {
    for (const m of [DONKEYKONG_NAIR, DONKEYKONG_FAIR, DONKEYKONG_BAIR, DONKEYKONG_UAIR, DONKEYKONG_DAIR]) {
      expect(() => validateAerialMove(m)).not.toThrow();
    }
  });
});

describe('Donkey Kong — grab and throws', () => {
  it('grab 8–10 of 38 with the 19.5-unit reach; forward throw enters Cargo; Cargo throws have their own records', () => {
    expect(DONKEYKONG_GRAB.startupFrames).toBe(7);
    expect(DONKEYKONG_GRAB.activeFrames).toBe(3);
    expect(DONKEYKONG_GRAB.whiffRecoveryFrames).toBe(28);
    expect(DONKEYKONG_GRAB.throwClock).toBe('native-sample-one');
    expect(DONKEYKONG_GRAB.hitbox.offsetX + DONKEYKONG_GRAB.hitbox.width / 2).toBeCloseTo(19.5 * 5, 0);
    expect(DONKEYKONG_GRAB.throws.forward).toMatchObject({ damage: 0, animationFrames: 16 });
    expect(DONKEYKONG_GRAB.cargo!.throws.forward).toMatchObject({ damage: 12, animationFrames: 15, recoveryFrames: 30 });
    expect(DONKEYKONG_GRAB.cargo).toMatchObject({ startupFrames: 16, entryMotionFrames: 24 });
    expect(DONKEYKONG_GRAB.throws.back.knockback.reference).toEqual({ base: 60, growth: 65, angle: 40 });
    expect(DONKEYKONG_GRAB.throws.up.knockback.reference).toEqual({ base: 70, growth: 50, angle: 90 });
    expect(DONKEYKONG_GRAB.throws.down).toMatchObject({ damage: 7, animationFrames: 19 });
    expect(DONKEYKONG_GRAB.pummel).toMatchObject({ damage: 1.6, cooldownFrames: 21, motionFrames: 7, hitlagFrames: 15 });
    expect(() => validateGrabSpec(DONKEYKONG_GRAB, 'DonkeyKong.test')).not.toThrow();
  });
});

describe('Donkey Kong — moveset contract, roster and authoring', () => {
  it('satisfies the canonical 10-slot moveset contract', () => {
    expect(() => assertFighterMoveset('donkeykong', DONKEYKONG_MOVESET)).not.toThrow();
    expect(DONKEYKONG_FIGHTER_CONTRACT.id).toBe('donkeykong');
    expect(DONKEYKONG_FIGHTER_CONTRACT.movementProfile).toBe(DONKEYKONG_MOVEMENT_PROFILE);
  });

  it('roster spec is sprite-wired and lists the 10 headline moves with namespaced ids', () => {
    expect(DONKEYKONG_SPEC.displayName).toBe('Donkey Kong');
    expect(DONKEYKONG_SPEC.playable).toBe(true);
    expect(DONKEYKONG_SPEC.placeholder.spriteKey).not.toBeNull();
    expect(DONKEYKONG_MOVES).toHaveLength(10);
    for (const move of DONKEYKONG_MOVES) expect(move.id.startsWith('donkeykong.'), move.id).toBe(true);
  });

  it('ships an 8-entry palette ladder with distinct primary colours', () => {
    expect(DONKEYKONG_PALETTES).toHaveLength(8);
    expect(new Set(DONKEYKONG_PALETTES.map((p) => p.primaryColor)).size).toBe(8);
  });

  it('the compiled kit round-trips through the Character Lab serializer with armour and shockwave data intact', () => {
    const spec = getAuthorableCharacterSpec('donkeykong');
    const reloaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));
    const down = reloaded.moves!.downSpecial as unknown as typeof DONKEYKONG_DOWN_SPECIAL;
    expect(down.downSpecialKind).toBe('shockwave');
    expect(down.shockwave.repeat).toEqual(DONKEYKONG_DOWN_SPECIAL.shockwave.repeat);
    expect(down.shockwave.aerialVariant?.hitWindows).toHaveLength(2);
    const side = reloaded.moves!.sideSpecial as unknown as typeof DONKEYKONG_SIDE_SPECIAL;
    expect(side.armorWindows).toEqual([{ startFrame: 4, endFrame: 14 }]);
    const neutral = reloaded.moves!.neutralSpecial as unknown as typeof DONKEYKONG_NEUTRAL_SPECIAL;
    expect(neutral.armorWindows).toEqual([{ startFrame: 8, endFrame: 20, minChargeRatio: 1 }]);
  });
});

describe('Donkey Kong — constructor wiring (MockScene smoke)', () => {
  it('constructs, registers the kit, and fires the forward smash', () => {
    const m = createMockScene();
    const ch = new DonkeyKong(m.scene, { spawnX: 100, spawnY: 200 });
    expect(ch.id).toBe('donkeykong');
    expect(ch.attemptAttack(DONKEYKONG_SMASH.id)).toBe(true);
    expect(ch.getActiveAttack()?.move.id).toBe('donkeykong.smash');
  });

  it('an airborne Hand Slap press starts the aerial variant (mock scene has no ground contact)', () => {
    const m = createMockScene();
    const ch = new DonkeyKong(m.scene, { spawnX: 0, spawnY: 0 });
    expect(ch.attemptAttack(DONKEYKONG_DOWN_SPECIAL.id)).toBe(true);
    const active = ch.getActiveAttack()!;
    expect(active.move.id).toBe('donkeykong.down_special');
    expect(active.move.startupFrames).toBe(18);
    expect(active.move.specialLandingLagFrames).toBe(10);
  });

  it('every attack clip\'s authored animation phase counts sum to its packed cell count, with at least one active drawing', () => {
    // `selectSimulationAttackFrame` only honours the pose schedule (startup /
    // active / recovery drawings) when the authored counts equal the sheet's
    // frame count; otherwise it silently falls back to an even spread and the
    // contact frame shows the wrong drawing (caught in-game on the forward
    // smash, 2026-09-25: the clap hit displayed the wind-up).
    const framesJson = JSON.parse(
      readFileSync(new URL('../../assets/characters/donkeykong/frames.json', import.meta.url), 'utf8'),
    ) as { animations: Record<string, { frameCount: number }> };
    const clips: Array<[string, { animation?: { startupFrames: number; activeFrames: number; recoveryFrames: number } }]> = [
      ['jab', DONKEYKONG_JAB], ['jab2', DONKEYKONG_JAB2], ['tilt', DONKEYKONG_TILT], ['utilt', DONKEYKONG_UTILT],
      ['dtilt', DONKEYKONG_DTILT], ['dash_attack', DONKEYKONG_DASHATTACK], ['smash', DONKEYKONG_SMASH],
      ['usmash', DONKEYKONG_USMASH], ['dsmash', DONKEYKONG_DSMASH], ['nair', DONKEYKONG_NAIR], ['fair', DONKEYKONG_FAIR],
      ['bair', DONKEYKONG_BAIR], ['uair', DONKEYKONG_UAIR], ['dair', DONKEYKONG_DAIR],
      ['neutral_special', DONKEYKONG_NEUTRAL_SPECIAL], ['neutral_special_air', DONKEYKONG_NEUTRAL_SPECIAL.airborneVariant!],
      ['side_special', DONKEYKONG_SIDE_SPECIAL], ['side_special_air', DONKEYKONG_SIDE_SPECIAL.airborneVariant!],
      ['up_special_air', DONKEYKONG_UP_SPECIAL], ['up_special_ground', DONKEYKONG_UP_SPECIAL.groundedVariant!],
      ['down_special', DONKEYKONG_DOWN_SPECIAL], ['down_special_air', DONKEYKONG_DOWN_SPECIAL.shockwave.aerialVariant!],
    ];
    for (const [clip, move] of clips) {
      const cells = framesJson.animations[clip]?.frameCount;
      expect(cells, `${clip} strip is packed`).toBeGreaterThan(0);
      const a = move.animation;
      expect(a, `${clip} has authored animation counts`).toBeDefined();
      expect(a!.startupFrames + a!.activeFrames + a!.recoveryFrames, `${clip} phase counts vs ${cells} cells`).toBe(cells);
      expect(a!.activeFrames, `${clip} active drawings`).toBeGreaterThan(0);
    }
  });

  it('registers the grab spec on construction', () => {
    const m = createMockScene();
    const ch = new DonkeyKong(m.scene, { spawnX: 0, spawnY: 0 });
    expect(ch.getGrabSpec()).toBe(DONKEYKONG_GRAB);
  });
});
