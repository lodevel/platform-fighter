/**
 * Ultimate universal defense / ledge / damage rules (engine-wide; every fighter
 * inherits them). Each value cites SmashWiki (ssbwiki.com, raw wikitext fetched
 * 2026-10-11) or UltimateFrameData; SmashWiki wins disagreements. Evidence:
 * docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/install/engine-source-fixes/.
 */
import { describe, expect, it } from 'vitest';
import {
  applyShieldHit, createShieldState, resolveShieldTuning, SHIELD_DAMAGE_MULTIPLIER, SHIELD_DEFAULTS,
  shieldBreakStunFrames, tickShield, type ShieldState,
} from './shieldState';
import { computeShieldHitlag, computeShieldParryHitlag } from './combat';
import { initialCaptureMash, SHIELD_BREAK_MASH_WEIGHTS, tickCaptureMash } from './ultimateCapture';
import {
  createDodgeStaleness, DODGE_STALE_DECAY_FRAMES, resolveDodgeTuning, staleDodgeVariant, tickDodge, tickDodgeStaleness,
  spotDodgeCancelFrame, type DodgeState,
} from './dodgeState';
import { DONKEYKONG_MOVEMENT_PROFILE } from './DonkeyKong';
import { PIKACHU_MOVEMENT_PROFILE } from './pikachuMovement';
import {
  createLedgeHangState, LEDGE_HANG_DEFAULTS, tickLedgeHang, ultimateLedgeHangIntangibilityFrames,
} from './ledgeHangState';
import { oneOnOneDamageTakenMultiplier } from '../match/oneOnOneDamage';
import type { MatchConfig } from '../types';

const raised = (): ShieldState => tickShield(createShieldState(), { held: true });

describe('M19–M22 shield (SmashWiki Shield, Ultimate row: "50 (42.02)||1.19×||0.15 (9/s)||0.08 (4.8/s)||37.5")', () => {
  it('M19 regenerates 0.08 HP per frame', () => {
    let s: ShieldState = { ...createShieldState(), health: 20 };
    s = tickShield(s, { held: false });
    expect(s.health).toBeCloseTo(20.08, 10);
    expect(SHIELD_DEFAULTS.regenPerFrame).toBe(0.08);
  });

  it('M20 multiplies shield damage, including added shield damage, by 1.19 (shieldstun unchanged)', () => {
    expect(SHIELD_DAMAGE_MULTIPLIER).toBe(1.19);
    const before = raised().health; // the raise step already decays 0.15
    const hit = applyShieldHit(raised(), 10);
    expect(hit.state.health).toBeCloseTo(before - 10 * 1.19, 10);
    const withExtra = applyShieldHit(raised(), 10, SHIELD_DEFAULTS, undefined, 'normal', 2);
    expect(withExtra.state.health).toBeCloseTo(before - 12 * 1.19, 10);
    // Shieldstun reads the unmultiplied damage: floor(10 × 0.8 + 2) = 10.
    expect(hit.state.blockStunRemaining).toBe(10);
  });

  it('M21 restores 37.5 HP after the break stun ends', () => {
    let s = applyShieldHit(raised(), 999, SHIELD_DEFAULTS, undefined, 'normal', 0, 1, 399).state;
    expect(s.name).toBe('broken');
    s = tickShield(s, { held: false });
    expect(s.name).toBe('idle');
    expect(s.health).toBe(37.5);
  });

  it('M22 break stun is 400 − percent (SmashWiki Stun "From Brawl onward, the formula is 400 - p")', () => {
    expect(shieldBreakStunFrames(0, SHIELD_DEFAULTS)).toBe(400);
    expect(shieldBreakStunFrames(30, SHIELD_DEFAULTS)).toBe(370);
    expect(shieldBreakStunFrames(12.6, SHIELD_DEFAULTS)).toBe(388);
    expect(shieldBreakStunFrames(500, SHIELD_DEFAULTS)).toBe(1);
    expect(applyShieldHit(raised(), 999, SHIELD_DEFAULTS, undefined, 'normal', 0, 1, 30).state.stunRemaining).toBe(370);
    // Holding a shield until it decays also breaks it with the same stun.
    const nearlyEmpty: ShieldState = { ...raised(), health: 0.1 };
    expect(tickShield(nearlyEmpty, { held: true, percent: 55 }).stunRemaining).toBe(345);
    // An explicit per-fighter override still wins (Character Lab / tests).
    expect(shieldBreakStunFrames(30, resolveShieldTuning({ breakStunFrames: 60 }))).toBe(60);
  });

  it('M22 mashing removes 3 frames per stick input and 5.4 per button input', () => {
    expect(SHIELD_BREAK_MASH_WEIGHTS).toEqual({ stick: 3, button: 5.4 });
    const start = initialCaptureMash({ moveX: 0, jump: false });
    const stick = tickCaptureMash(start, { moveX: 1, jump: false }, 1, SHIELD_BREAK_MASH_WEIGHTS);
    expect(stick.reduction).toBe(3);
    const button = tickCaptureMash(start, { moveX: 0, jump: true }, 1, SHIELD_BREAK_MASH_WEIGHTS);
    expect(button.reduction).toBe(5.4);
    let s = applyShieldHit(raised(), 999, SHIELD_DEFAULTS, undefined, 'normal', 0, 1, 0).state;
    s = tickShield(s, { held: false, mash: 3 });
    expect(s.stunRemaining).toBe(396);
  });
});

describe('M23 parry hitlag (SmashWiki Perfect shield, Ultimate)', () => {
  // "For direct non-projectile attacks, the attacker experiences 14 extra frames of hitlag, while
  // the defender experiences 11 extra frames" / indirect: attacker 14, defender 2 / direct projectile:
  // attacker not affected, defender 8 / indirect projectile: defender 1 frame less.
  it.each([2, 3, 4])('adds +11/+14 (direct), +2/+14 (indirect), +8/0 and −1/0 (projectiles) over shield hitlag with %i players', players => {
    for (const damage of [3, 10, 30]) {
      const input = { damage, targetPercent: 0, players };
      const base = computeShieldHitlag(input);
      expect(computeShieldParryHitlag(input)).toEqual({ defender: base + 11, attacker: base + 14 });
      expect(computeShieldParryHitlag({ ...input, direct: false })).toEqual({ defender: base + 2, attacker: base + 14 });
      expect(computeShieldParryHitlag({ ...input, direct: true }, true)).toEqual({ defender: base + 8, attacker: 0 });
      expect(computeShieldParryHitlag(input, true)).toEqual({ defender: base - 1, attacker: 0 });
    }
  });
  it('zero-damage or zero-hitlag contact cannot parry-freeze', () => {
    expect(computeShieldParryHitlag({ damage: 0, targetPercent: 0 })).toEqual({ defender: 0, attacker: 0 });
    expect(computeShieldParryHitlag({ damage: 9, targetPercent: 0, multiplier: 0 })).toEqual({ defender: 0, attacker: 0 });
  });
});

describe('M26 dodge staleness (SmashWiki Spot dodge / Roll / Air dodge, Ultimate)', () => {
  const dk = resolveDodgeTuning(DONKEYKONG_MOVEMENT_PROFILE.dodge);
  const pika = resolveDodgeTuning(PIKACHU_MOVEMENT_PROFILE.dodge);
  const total = (v: { activeFrames: number; recoveryFrames: number }) => v.activeFrames + v.recoveryFrames;
  const window = (v: { iframeStartFrame?: number; iframeFrames: number }) =>
    [(v.iframeStartFrame ?? 0) + 1, (v.iframeStartFrame ?? 0) + v.iframeFrames];

  it('fully stale totals and intangibility match the SmashWiki tables for DK and Pikachu', () => {
    // DK: spot 3-17 → 6-17, 26 → 34; fwd roll 4-15 → 8-14, 30 → 40; back roll 5-16 → 9-14, 35 → 53;
    // neutral air 4-32 → 7-29 (48 total, unchanged); directional 4-22 → 7-21.
    const s = staleDodgeVariant(dk.spot, 'spot', 5);
    expect([total(s), window(s)]).toEqual([34, [6, 17]]);
    const f = staleDodgeVariant(dk.roll, 'roll', 5);
    expect([total(f), window(f)]).toEqual([40, [8, 14]]);
    const b = staleDodgeVariant(dk.backwardRoll!, 'backwardRoll', 5);
    expect([total(b), window(b)]).toEqual([53, [9, 14]]);
    const a = staleDodgeVariant(dk.air, 'air', 5);
    expect([total(a), window(a)]).toEqual([48, [7, 29]]);
    const d = staleDodgeVariant(dk.directionalAir!, 'air', 5);
    expect(window(d)).toEqual([7, 21]);
    // Pikachu: spot 3-16 → 6-16, 24 → 32; fwd 4-14 → 8-14, 28 → 37; back 4-15 → 8-13, 33 → 50;
    // neutral air 2-26 → 5-24; directional 2-19 → 5-18.
    const ps = staleDodgeVariant(pika.spot, 'spot', 5);
    expect([total(ps), window(ps)]).toEqual([32, [6, 16]]);
    const pf = staleDodgeVariant(pika.roll, 'roll', 5);
    expect([total(pf), window(pf)]).toEqual([37, [8, 14]]);
    const pb = staleDodgeVariant(pika.backwardRoll!, 'backwardRoll', 5);
    expect([total(pb), window(pb)]).toEqual([50, [8, 13]]);
    expect(window(staleDodgeVariant(pika.air, 'air', 5))).toEqual([5, 24]);
    expect(window(staleDodgeVariant(pika.directionalAir!, 'air', 5))).toEqual([5, 18]);
  });

  it('partial staleness lengthens duration by D·(1+P) (+1 frame) and keeps fresh intangibility', () => {
    // One prior dodge: P = 0.06 (spot / forward roll), 0.1 (back roll).
    expect(total(staleDodgeVariant(dk.spot, 'spot', 1))).toBe(Math.floor(26 * 1.06) + 1);
    expect(total(staleDodgeVariant(dk.backwardRoll!, 'backwardRoll', 1))).toBe(Math.floor(35 * 1.1) + 1);
    expect(window(staleDodgeVariant(dk.spot, 'spot', 4))).toEqual([3, 17]);
    expect(staleDodgeVariant(dk.spot, 'spot', 0)).toBe(dk.spot);
  });

  it('spot dodge cancels into a ground attack 5 frames early, scaled when stale (DK 21 → 28, Pikachu 19 → 25)', () => {
    expect(spotDodgeCancelFrame(dk.spot, 0)).toBe(21);
    expect(spotDodgeCancelFrame(dk.spot, 5)).toBe(28);
    expect(spotDodgeCancelFrame(pika.spot, 0)).toBe(19);
    expect(spotDodgeCancelFrame(pika.spot, 5)).toBe(25);
  });

  it('every dodge kind feeds one shared count (cap 5) that forgives one use per second without dodging', () => {
    let st = createDodgeStaleness();
    for (let i = 0; i < 7; i++) st = tickDodgeStaleness(st, { started: true, acting: true });
    expect(st.count).toBe(5);
    for (let i = 0; i < DODGE_STALE_DECAY_FRAMES - 1; i++) st = tickDodgeStaleness(st, { started: false, acting: false });
    expect(st.count).toBe(5);
    st = tickDodgeStaleness(st, { started: false, acting: false });
    expect(st.count).toBe(4);
    // Frames spent inside a dodge do not count as time without dodging.
    st = tickDodgeStaleness(st, { started: true, acting: true });
    for (let i = 0; i < 200; i++) st = tickDodgeStaleness(st, { started: false, acting: true });
    expect(st.count).toBe(5);
  });

  it('tickDodge records the staleness a dodge started with and times it from the stale variant', () => {
    const run = (count: number) => {
      let s: DodgeState = tickDodge({ name: 'idle', active: null, iframesRemaining: 0, cooldownRemaining: 0 },
        { held: true, justPressed: true, moveX: 0, grounded: true, facing: 1, staleCount: count }, dk);
      let frames = 1;
      while (s.name === 'active' || s.name === 'recovery') {
        s = tickDodge(s, { held: false, justPressed: false, moveX: 0, grounded: true, facing: 1 }, dk); frames += 1;
      }
      return frames - 1;
    };
    expect(run(0)).toBe(26);
    expect(run(5)).toBe(34);
  });
});

describe('M27 / M31 ledge hang (SmashWiki Edge, SSB4/SSBU row)', () => {
  it('M27 intangibility = 19 + 60·(a/300) + 44 − p/120·44, clamped 23..123', () => {
    expect(ultimateLedgeHangIntangibilityFrames(0, 0)).toBe(63);
    expect(ultimateLedgeHangIntangibilityFrames(300, 120)).toBe(79);
    expect(ultimateLedgeHangIntangibilityFrames(0, 120)).toBe(23);
    expect(ultimateLedgeHangIntangibilityFrames(300, 0)).toBe(123);
    expect(ultimateLedgeHangIntangibilityFrames(900, 999)).toBe(79);
    expect(ultimateLedgeHangIntangibilityFrames(150, 60)).toBe(19 + 30 + 22);
  });

  it('M27 a fresh catch arms the formula budget from airtime and percent; a regrab gets none', () => {
    const detection = { candidate: { platformId: 'p', side: 'left' as const, x: 0, y: 0 }, latchX: 0, latchY: 0 };
    const grab = tickLedgeHang(createLedgeHangState(), { detection, release: null, airborne: true, facing: 1,
      airtimeFrames: 120, percent: 48 });
    expect(grab.state.hangIframesRemaining).toBe(ultimateLedgeHangIntangibilityFrames(120, 48));
    const regrab = tickLedgeHang({ ...createLedgeHangState(), ledgeGrabsSinceGround: 1 }, { detection, release: null,
      airborne: true, facing: 1, airtimeFrames: 300, percent: 0 });
    expect(regrab.state.hangIframesRemaining).toBe(0);
  });

  it('M31 the maximum hang is 6.5 s = 390 frames', () => {
    expect(LEDGE_HANG_DEFAULTS.maxHangFrames).toBe(390);
  });
});

describe('M18 1v1 multiplier (SmashWiki 1v1 multiplier: "only two players and items off ... 1.2× damage")', () => {
  const config = (players: number, itemFrequency?: MatchConfig['itemFrequency']): MatchConfig => ({
    mode: 'stocks', stockCount: 3, stageId: 'flat', rngSeed: 1, ...(itemFrequency ? { itemFrequency } : {}),
    players: Array.from({ length: players }, (_, i) => ({ index: (i + 1) as 1, characterId: 'donkeykong',
      paletteIndex: 0, inputType: 'ai' as const })) });
  it('is 1.2 with exactly two players and items off, 1 otherwise (derived from the recorded match config)', () => {
    expect(oneOnOneDamageTakenMultiplier(config(2, 'off'))).toBe(1.2);
    expect(oneOnOneDamageTakenMultiplier(config(2, 'low'))).toBe(1);
    expect(oneOnOneDamageTakenMultiplier(config(2))).toBe(1); // omitted frequency resolves to 'med'
    expect(oneOnOneDamageTakenMultiplier(config(3, 'off'))).toBe(1);
    expect(oneOnOneDamageTakenMultiplier(config(4, 'off'))).toBe(1);
  });
});
