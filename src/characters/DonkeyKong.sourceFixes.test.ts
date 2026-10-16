/**
 * Donkey Kong — source-audit fixes (2026-10-11). Each expectation cites its
 * source; SmashWiki wins over UFD and native data where they disagree
 * (user rule 2026-10-11). Evidence record:
 * docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/install/source-fixes/
 */
import { describe, expect, it } from 'vitest';
import {
  DONKEYKONG_DOWN_SPECIAL, DONKEYKONG_DSMASH, DONKEYKONG_GRAB, DONKEYKONG_MOVEMENT_PROFILE,
  DONKEYKONG_NEUTRAL_SPECIAL, DONKEYKONG_SMASH, DONKEYKONG_TILT, DONKEYKONG_UP_SPECIAL, DONKEYKONG_USMASH,
} from './DonkeyKong';
import { DONKEYKONG_UFD_STATS } from './donkeykongUfdStats';
import { donkeyKongTurnBrakeNativeMarkers } from './donkeykongTurnBrake';
import { computeChargedDamageFromSpec, ULTIMATE_SMASH_MAX_HOLD_FRAMES } from './chargeSchema';
import { DONKEYKONG_PUNCH_CLOCKS } from './donkeykongPunchControls';
import { computeShieldstun } from './combat';
import { applyShieldHit, createShieldState, SHIELD_DEFAULTS } from './shieldState';
import { PIKACHU_MOVEMENT_PROFILE } from './pikachuMovement';
import { validateDownSpecialMove } from './downSpecialSchema';
import { validateGrabSpec } from './grabSchema';
import { ledgeHangPresentationClock, resolveLedgeHangTuning, tickLedgeHang, type LedgeHangState, type LedgeReleaseAction } from './ledgeHangState';

const total = (m: { startupFrames: number; activeFrames: number; recoveryFrames: number }) =>
  m.startupFrames + m.activeFrames + m.recoveryFrames;

describe('DK source fixes — movement', () => {
  it('M1 hard landing lag is 5 (UFD stats Landing "DK 5 2"; SmashWiki ellag = 5)', () => {
    expect(DONKEYKONG_UFD_STATS.hardLandingFrames).toBe(5);
    expect(DONKEYKONG_MOVEMENT_PROFILE.hardLandingFrames).toBe(5);
  });

  it('M2 the dash-turn (pivot dash) becomes run-eligible after UFD Pivot Dash Frames 17', () => {
    const dash = { sheet: 'dash_turn' as const, framesElapsed: 0, facing: 1 as const, targetFacing: -1 as const, duration: 21 };
    const firstRunAge = Array.from({ length: 21 }, (_, age) => age)
      .find(age => donkeyKongTurnBrakeNativeMarkers({ ...dash, framesElapsed: age }).dashToRunEnabled);
    expect(firstRunAge).toBe(DONKEYKONG_UFD_STATS.pivotDashFrames);
  });

  it('M3 carrying (Cargo) scales walk speed and acceleration by 1.1 (SmashWiki DK/Forward_throw)', () => {
    expect(DONKEYKONG_GRAB.cargo!.walkMultiplier).toBe(1.1);
    expect(() => validateGrabSpec(DONKEYKONG_GRAB, 'DK grab')).not.toThrow();
    expect(() => validateGrabSpec({ ...DONKEYKONG_GRAB, cargo: { ...DONKEYKONG_GRAB.cargo!, walkMultiplier: 0 } }, 'bad'))
      .toThrow(/walkMultiplier/);
  });
});

describe('DK source fixes — ground attacks', () => {
  it('M4 angled forward tilt lasts one frame longer: total 35 (SmashWiki "FAF 35 → 36"); unangled stays 34', () => {
    expect(total(DONKEYKONG_TILT)).toBe(34);
    expect(total(DONKEYKONG_TILT.angledVariants!.up!)).toBe(35);
    expect(total(DONKEYKONG_TILT.angledVariants!.down!)).toBe(35);
  });

  it('M5–M7 smash attacks can be held to 180 frames, the same mechanism as Pikachu (SmashWiki Smash attack)', () => {
    expect(ULTIMATE_SMASH_MAX_HOLD_FRAMES).toBe(180);
    for (const move of [DONKEYKONG_SMASH, DONKEYKONG_USMASH, DONKEYKONG_DSMASH]) {
      expect(move.charge!.maxChargeFrames).toBe(60);
      expect(move.charge!.maxHoldFrames).toBe(ULTIMATE_SMASH_MAX_HOLD_FRAMES);
    }
  });
});

describe('DK source fixes — specials', () => {
  it('M8 uncharged Giant Punch ends 42 frames after its hitbox (SmashWiki interruptible 70 / 63 from release)', () => {
    expect(DONKEYKONG_NEUTRAL_SPECIAL.recoveryFrames).toBe(42);
    expect(DONKEYKONG_NEUTRAL_SPECIAL.airborneVariant!.recoveryFrames).toBe(42);
    // Full charge keeps its 27-frame lag (SmashWiki fully charged strip: Lag 27).
    expect(DONKEYKONG_NEUTRAL_SPECIAL.fullChargeVariant!.recoveryFrames).toBe(27);
  });

  it('M8 Giant Punch charges fully in 110 frames; damage = base + 18·(charge/110), rounded down (SmashWiki)', () => {
    expect(DONKEYKONG_PUNCH_CLOCKS.maxChargeFrames).toBe(110);
    const ground = DONKEYKONG_NEUTRAL_SPECIAL.charge!;
    const air = (DONKEYKONG_NEUTRAL_SPECIAL.airborneVariant as typeof DONKEYKONG_NEUTRAL_SPECIAL).charge!;
    for (const [spec, base, full] of [[ground, 10, 28], [air, 6, 25]] as const) {
      expect(spec.maxChargeFrames).toBe(110);
      for (let charge = 0; charge < 110; charge++)
        expect(computeChargedDamageFromSpec(spec, charge)).toBe(base + Math.floor(18 * charge / 110));
      expect(computeChargedDamageFromSpec(spec, 110)).toBe(full);
    }
  });

  it('M9 grounded Spinning Kong hit 1 uses SmashWiki ks=30 fkv=90 on all six ids', () => {
    const first = DONKEYKONG_UP_SPECIAL.groundedVariant!.hitWindows![0]!;
    expect(first.collisionHits!.map(h => h.id)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const hit of first.collisionHits!) {
      expect(hit.knockback!.reference).toMatchObject({ base: 0, growth: 30, fixed: 90 });
    }
    expect(DONKEYKONG_UP_SPECIAL.groundedVariant!.knockback.reference).toMatchObject({ base: 0, growth: 30, fixed: 90 });
  });

  it('M10 aerial Spinning Kong animation is 70 frames before helpless (SmashWiki "Animation length 70")', () => {
    expect(total(DONKEYKONG_UP_SPECIAL)).toBe(70);
  });

  it('M11 Hand Slap registers presses through the startup and loop; loop frames 20–26 repeat twice (SmashWiki)', () => {
    expect(DONKEYKONG_DOWN_SPECIAL.shockwave.repeat).toEqual({ windowStart: 0, windowEnd: 33, loopFrame: 33,
      entryFrame: 7, doubleRepeatFrom: 26 });
    expect(() => validateDownSpecialMove(DONKEYKONG_DOWN_SPECIAL)).not.toThrow();
  });

  it('M12 Hand Slap grounded hitboxes sit 5 u up, at ±6.1 u and ±21.1 u (SmashWiki offsets [0, 5, 6.1], 15 u apart)', () => {
    for (const window of DONKEYKONG_DOWN_SPECIAL.hitWindows!) {
      const hits = window.collisionHits!;
      expect(hits.map(h => h.id)).toEqual([0, 1, 2, 3]);
      expect(hits.map(h => h.capsule.start.x)).toEqual([105.5, 30.5, -30.5, -105.5]);
      for (const h of hits) {
        expect(h.capsule.start).toEqual(h.capsule.end);
        expect(h.capsule.start.y).toBe(17);
        expect(h.capsule.radius).toBeCloseTo(51.5);
        expect(h.situation).toBe('ground');
      }
      expect(hits.map(h => h.knockback!.reference!.angle)).toEqual([78, 84, 84, 78]);
    }
  });

  it('M13 the Hand Slap 0.58 multiplier applies to shieldstun: 14 % fresh → 8 frames (UFD shieldstun 8)', () => {
    expect(DONKEYKONG_DOWN_SPECIAL.hitWindows![0]!.collisionHits![0]!.shieldSetoffMultiplier).toBe(0.58);
    expect(computeShieldstun(14 * 1.05)).toBe(13);
    expect(computeShieldstun(14 * 1.05, 'normal', 0.58)).toBe(8);
    // SmashWiki: the projectile penalty does not apply when the multiplier is not 1.
    expect(computeShieldstun(10, 'projectile', 1)).toBe(Math.floor(10 * .8 * .29 + 2));
    expect(computeShieldstun(10, 'projectile', 1.5)).toBe(Math.floor(10 * .8 * 1.5 + 2));
    const raised = { ...createShieldState(), name: 'active' as const };
    const blocked = applyShieldHit(raised, 14 * 1.05, SHIELD_DEFAULTS, undefined, 'normal', 0, 0.58);
    expect(blocked.state.blockStunRemaining).toBe(8);
  });
});

describe('DK source fixes — grabs, throws, cargo', () => {
  it('M14 normal throws are invincible: back 1–15, up 1–14, down 1–19 (SmashWiki throw pages)', () => {
    expect(DONKEYKONG_GRAB.throws.back.invincibilityFrames).toBe(15);
    expect(DONKEYKONG_GRAB.throws.up.invincibilityFrames).toBe(14);
    expect(DONKEYKONG_GRAB.throws.down.invincibilityFrames).toBe(19);
  });

  it('M15 cargo entry is invincible 1–15 (SmashWiki Forward_throw Carry)', () => {
    expect(DONKEYKONG_GRAB.throws.forward.invincibilityFrames).toBe(15);
  });

  it('M16 cargo throws carry 16-unit knockback armor, ground and air (SmashWiki Donkey Kong (SSBU))', () => {
    for (const set of [DONKEYKONG_GRAB.cargo!.throws, DONKEYKONG_GRAB.cargo!.airThrows!]) {
      for (const direction of ['forward', 'back', 'up', 'down'] as const) {
        expect(set[direction].knockbackArmor).toBe(16);
        expect(set[direction].invincibilityFrames).toBeUndefined();
      }
    }
    for (const direction of ['forward', 'back', 'up', 'down'] as const)
      expect(DONKEYKONG_GRAB.throws[direction].knockbackArmor).toBeUndefined();
  });
});

describe('DK source fixes — ledge (SmashWiki Edge / DK Edge_attack), sharing Pikachu\'s data shape', () => {
  it('M28/M29 at most 6 grabs before landing; catch slows to 0.9375×…0.75× from the 3rd grab', () => {
    expect(DONKEYKONG_MOVEMENT_PROFILE.ledge!.maxGrabsWithoutGround).toBe(6);
    expect(DONKEYKONG_MOVEMENT_PROFILE.ledge!.catchMotionRatesByGrab).toEqual([1, 1, 0.9375, 0.875, 0.8125, 0.75]);
    expect(DONKEYKONG_MOVEMENT_PROFILE.ledge!.catchMotionRatesByGrab).toEqual(PIKACHU_MOVEMENT_PROFILE.ledge!.catchMotionRatesByGrab);
    expect(DONKEYKONG_MOVEMENT_PROFILE.ledge!.maxGrabsWithoutGround).toBe(PIKACHU_MOVEMENT_PROFILE.ledge!.maxGrabsWithoutGround);
  });

  it('M30/M32 getup-option intangibility scales 1 / 0.8 / 0.5 / 0 by grab; ledge attack 25 / 20 / 12 / 0', () => {
    expect(DONKEYKONG_MOVEMENT_PROFILE.ledge!.optionIntangibilityScaleByGrab).toEqual([1, 0.8, 0.5, 0]);
    expect(DONKEYKONG_MOVEMENT_PROFILE.ledge!.attackProtectionFramesByGrab).toEqual([25, 20, 12, 0]);
    // The sourced ledge attack carries its own whole-body protection window.
    expect(DONKEYKONG_MOVEMENT_PROFILE.ledge!.attackIframes).toBe(0);
    // Pikachu keeps its existing values and does not opt in to the getup-option scale.
    expect(PIKACHU_MOVEMENT_PROFILE.ledge!.attackProtectionFramesByGrab).toEqual([25, 20, 12, 0]);
    expect(PIKACHU_MOVEMENT_PROFILE.ledge!.optionIntangibilityScaleByGrab).toBeUndefined();
  });

  const releaseIframes = (ledge: typeof DONKEYKONG_MOVEMENT_PROFILE.ledge, grabs: number, action: LedgeReleaseAction) => {
    const hanging: LedgeHangState = { name: 'hanging', hangIframesRemaining: 0, cooldownRemaining: 0, grabVulnerableRemaining: 0,
      ledgeGrabsSinceGround: grabs, active: { candidate: { platformId: 'p', side: 'left', x: 0, y: 0 }, latchX: 0, latchY: 42,
        framesElapsed: 100, facing: 1 } };
    return tickLedgeHang(hanging, { detection: null, release: action, airborne: true, facing: 1 },
      resolveLedgeHangTuning(ledge)).state.hangIframesRemaining;
  };

  it('M30 DK getup / roll / jump intangibility: full, ×0.8, ×0.5, none on the 1st–4th grab (floored)', () => {
    const ledge = DONKEYKONG_MOVEMENT_PROFILE.ledge;
    expect([1, 2, 3, 4, 6].map(g => releaseIframes(ledge, g, 'getUp'))).toEqual([33, 26, 16, 0, 0]);
    expect([1, 2, 3, 4].map(g => releaseIframes(ledge, g, 'roll'))).toEqual([28, 22, 14, 0]);
    expect([1, 2, 3, 4].map(g => releaseIframes(ledge, g, 'jump'))).toEqual([12, 9, 6, 0]);
  });

  it('M29 the catch drawing slows with the regrab rate and the hang loop starts after the slowed catch', () => {
    const { catchFrames, catchMotionRatesByGrab } = DONKEYKONG_MOVEMENT_PROFILE.ledge!;
    const clock = (age: number, grabs: number) => ledgeHangPresentationClock(age, grabs, catchFrames!, catchMotionRatesByGrab!);
    expect([clock(18, 1), clock(19, 1)]).toEqual([{ sheet: 'ledge_catch', age: 18 }, { sheet: 'ledge', age: 0 }]);
    expect(clock(20, 3)).toEqual({ sheet: 'ledge_catch', age: 18.75 });
    expect(clock(21, 3)).toEqual({ sheet: 'ledge', age: 0 });
    expect(clock(25, 6)).toEqual({ sheet: 'ledge_catch', age: 18.75 });
    expect(clock(26, 6)).toEqual({ sheet: 'ledge', age: 0 });
    // The options open on the same step as the slowed catch ends (ledgeHangState: (age + 1) · rate >= catchFrames).
    const firstOptionAge = (grabs: number) => {
      for (let age = 0; ; age++) {
        const hanging: LedgeHangState = { name: 'hanging', hangIframesRemaining: 0, cooldownRemaining: 0, grabVulnerableRemaining: 0,
          ledgeGrabsSinceGround: grabs, active: { candidate: { platformId: 'p', side: 'left', x: 0, y: 0 }, latchX: 0, latchY: 42,
            framesElapsed: age, facing: 1 } };
        if (tickLedgeHang(hanging, { detection: null, release: 'roll', airborne: true, facing: 1 },
          resolveLedgeHangTuning(DONKEYKONG_MOVEMENT_PROFILE.ledge)).state.name === 'rolling') return age;
      }
    };
    expect([1, 2, 3, 4, 5, 6].map(firstOptionAge)).toEqual([18, 18, 20, 21, 23, 25]);
  });

  it('Pikachu keeps its full getup-option intangibility on regrabs (no opt-in)', () => {
    const ledge = PIKACHU_MOVEMENT_PROFILE.ledge;
    for (const action of ['getUp', 'roll', 'jump'] as const)
      expect(new Set([1, 2, 3, 4].map(g => releaseIframes(ledge, g, action))).size).toBe(1);
  });
});
