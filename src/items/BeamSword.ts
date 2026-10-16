/**
 * Beam Sword — Super Smash Bros. Ultimate battering item (replaces the test sword).
 *
 * Every value is listed with its source and label in
 * docs/review/2026-10-11/ultimate-items/phase-3/sources.json:
 *   • sourced (SmashWiki Beam_Sword, wins): damages jab 4 (4.5 near the base), ftilt 9, dash 8 (7 near the
 *     base), fsmash "13% - 19.6%"; the four item swipes; the forward smash charges (SmashWiki Smash_attack: battering
 *     items charge except the Home-Run Bat; "A fully-charged smash attack does ... 1.4× damage in Brawl, Smash 4, and
 *     Ultimate", 1-second charge, held up to 2 s more); the blade is longest on the forward smash; light item,
 *     battering class, no stated durability;
 *   • root decision (2026-10-12, phase 4): the forward smash has two regions, tip 13 / base 14, each × the universal
 *     1.4 charge, so it spans SmashWiki's 13% (tip, uncharged) to 19.6% (= 14 × 1.4, base, fully charged);
 *   • sourced (derived): thrown base damage 8 from the SmashWiki Ultimate thrown table on the Item_throw formula;
 *   • native-derived (SmashWiki silent; WuBoytH SSBU-Dumped-Scripts donkey/pikachu SwordSwing{1,3,4,Dash}.txt and the
 *     motion list cancel_frame): hitbox frames, action totals (cancel_frame − 1), the charge pause (smash-hold flag
 *     at frame 7), thrown kinetics (item_common beamsword);
 *   • authored (SmashWiki silent; game_SwordSwing*Common hitbox scripts not dumped locally): angles, BKB/KBG, blade
 *     and base geometry, idle TTL.
 *
 * Engine convention: action frame 1 is elapsed step 0, so a first active frame N is `startupFrames = N − 1`;
 * startup + active + recovery = FAF − 1.
 */

import type { AttackMove } from '../characters/attacks';
import type { AttackMoveWithAnimation } from '../characters/moveSchema';
import { ULTIMATE_SMASH_MAX_HOLD_FRAMES } from '../characters/chargeSchema';
import { ASSET_KEYS } from '../assets/manifest';
import type { ItemDefinition } from './ItemDefinition';
import { ultimateItemThrowProfile } from './nativeItemThrow';

/** Authored blade (SmashWiki silent on length): from the hand (8 px ahead of the body centre) forward. */
const BLADE = Object.freeze({ offsetX: 44, offsetY: -4, width: 72, height: 28 });
/** Authored base of the blade: its quarter nearest the hand ("near base", SmashWiki). */
const BLADE_BASE = Object.freeze({ offsetX: 18, offsetY: -4, width: 20, height: 28 });
/** Authored forward smash blade: the longest reach of the four swipes (SmashWiki). */
const SMASH_BLADE = Object.freeze({ offsetX: 52, offsetY: -4, width: 88, height: 32 });

export const BEAM_SWORD_JAB: AttackMove = Object.freeze({
  id: 'item.beamSword.jab',
  type: 'jab',
  itemClip: 'item_sword_swing_1',
  damage: 4,
  knockback: { x: 1.2, y: -0.6, scaling: 0.06, reference: { base: 30, growth: 50, angle: 361 } },
  hitbox: BLADE,
  // SmashWiki "4% (4.5% near base)".
  sweetSpot: Object.freeze({ hitbox: BLADE_BASE, damageMultiplier: 4.5 / 4 }),
  // SwordSwing1: hitbox frames 4–5 (clear_all at 6); item_sword_swing_1 cancel_frame 26.
  startupFrames: 3,
  activeFrames: 2,
  recoveryFrames: 20,
  cooldownFrames: 0,
});

export const BEAM_SWORD_FTILT: AttackMove = Object.freeze({
  id: 'item.beamSword.ftilt',
  type: 'tilt',
  itemClip: 'item_sword_swing_3',
  damage: 9,
  knockback: { x: 1.8, y: -1.1, scaling: 0.1, reference: { base: 40, growth: 70, angle: 361 } },
  hitbox: BLADE,
  // SwordSwing3: hitbox frames 8–9 (clear_all at 10); item_sword_swing_3 cancel_frame 38.
  startupFrames: 7,
  activeFrames: 2,
  recoveryFrames: 28,
  cooldownFrames: 0,
});

export const BEAM_SWORD_DASH_ATTACK: AttackMove = Object.freeze({
  // `.dashAttack` suffix: a fighter without the item clip shows its dash_attack sheet.
  id: 'item.beamSword.dashAttack',
  type: 'tilt',
  itemClip: 'item_sword_swing_dash',
  damage: 8,
  knockback: { x: 1.8, y: -1.8, scaling: 0.1, reference: { base: 50, growth: 70, angle: 45 } },
  hitbox: BLADE,
  // SmashWiki "8% (7% near base)".
  sweetSpot: Object.freeze({ hitbox: BLADE_BASE, damageMultiplier: 7 / 8 }),
  // SwordSwingDash: hitbox frames 7–13 (two common phases, clear_all at 14); cancel_frame 45.
  startupFrames: 6,
  activeFrames: 7,
  recoveryFrames: 31,
  cooldownFrames: 0,
});

const SMASH_KNOCKBACK = Object.freeze({ x: 2.6, y: -1.8, scaling: 0.2, reference: Object.freeze({ base: 40, growth: 90, angle: 361 }) });
/** Ultimate smash charge: SmashWiki Smash_attack "1.4× damage" (native item smash_hold_attack_up 1.4 agrees). */
const SMASH_CHARGE_MULTIPLIER = 1.4;
/** Root decision: tip 13 / base 14, both × 1.4 at full charge (SmashWiki "13% - 19.6%" = 13 tip … 14 × 1.4 base). */
const FSMASH_TIP = 13, FSMASH_BASE = 14;

export const BEAM_SWORD_FSMASH: AttackMoveWithAnimation = Object.freeze({
  id: 'item.beamSword.fsmash',
  type: 'smash',
  itemClip: 'item_sword_swing_4',
  damage: FSMASH_TIP,
  knockback: SMASH_KNOCKBACK,
  hitbox: SMASH_BLADE,
  // The base region multiplies the (charged) blade damage: 13 → 18.2 at the tip, 14 → 19.6 near the base.
  sweetSpot: Object.freeze({ hitbox: BLADE_BASE, damageMultiplier: FSMASH_BASE / FSMASH_TIP }),
  // The reference launch is kept and the charged damage feeds its growth (DK's own smashes use the same mode).
  charge: Object.freeze({
    knockbackMode: 'damage-only' as const,
    minChargeFrames: 0,
    maxChargeFrames: 60,
    maxHoldFrames: ULTIMATE_SMASH_MAX_HOLD_FRAMES,
    minDamage: FSMASH_TIP,
    maxDamage: FSMASH_TIP * SMASH_CHARGE_MULTIPLIER,
    minKnockback: SMASH_KNOCKBACK,
    maxKnockback: SMASH_KNOCKBACK,
  }),
  // SwordSwing4: FIGHTER_STATUS_ITEM_SWING_WORK_FLAG_START_SMASH_HOLD at frame 7, hitbox frame 15 (clear_all at 16);
  // item_sword_swing_4 cancel_frame 52.
  chargeStartFrame: 6,
  startupFrames: 14,
  activeFrames: 1,
  recoveryFrames: 36,
  cooldownFrames: 0,
});

/** SmashWiki Beam Sword Ultimate thrown table on the Item_throw formula d·power − 0.4 + speed·3 with the
 * Home-Run Bat's toss speeds (drop 2.1, dash 3.4, forward smash 3.63): drop 9.8 → d 7.8, dash 17.8 → 8.0,
 * forward smash 18.7 → 8.2, so d = 8. Kinetics: item_common beamsword (native-derived). */
export const BEAM_SWORD_THROW_PROFILE = ultimateItemThrowProfile({ damage: 8, mapBottom: 5,
  kinetics: Object.freeze({ gravity: .075, terminalFallSpeed: 2, airBrakeX: .0001, maxSpeedX: Number.POSITIVE_INFINITY,
    throwRebound: Object.freeze({ mul: .05, addX: .2, addY: 1.9 }) }) });

export const BEAM_SWORD_DEFINITION: ItemDefinition = Object.freeze({
  type: 'beamSword',
  itemClass: 'battering',
  // Authored (Ultimate idle despawn SOURCE_SILENT), the same as the Home-Run Bat.
  ttlFrames: 1200,
  brokenDespawnFrames: 30,
  throwProfile: BEAM_SWORD_THROW_PROFILE,
  uses: Object.freeze({
    jab: BEAM_SWORD_JAB,
    ftilt: BEAM_SWORD_FTILT,
    dashAttack: BEAM_SWORD_DASH_ATTACK,
    fsmash: BEAM_SWORD_FSMASH,
  }),
  visual: Object.freeze({ spriteKey: ASSET_KEYS.itemBeamSword, width: 14, height: 56, restAngle: 30, swingArc: [-70, 100] as const }),
});
