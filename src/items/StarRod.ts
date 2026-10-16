/**
 * Star Rod — Super Smash Bros. Ultimate battering item that fires stars.
 *
 * Every value is listed with its source and label in
 * docs/review/2026-10-11/ultimate-items/phase-3/sources.json:
 *   • sourced (SmashWiki Star_Rod / Item, wins): battering + shooting item, the four item swipes, a star on forward
 *     tilt and forward smash only, 16 stars, the empty rod still swings, stars are reflectable, light item; the
 *     forward smash charges (SmashWiki Smash_attack: battering items charge except the Home-Run Bat; Ultimate 1.4×
 *     over 60 frames, held up to 180);
 *   • native-derived (SmashWiki silent; WuBoytH SSBU-Dumped-Scripts pikachu StarRodSwing{1,3,4,Dash}.txt, the motion
 *     list cancel_frame, ultimate-13.0.1 item_common starrod / starrodshot): hitbox frames, the star on the hitbox
 *     frame (SHOOT_ITEM_BULLET_CHARGE at 8 / 15), action totals, the charge pause, thrown kinetics, a gravity-free
 *     star with a 3-unit (15 px) radius;
 *   • authored (SmashWiki has no Ultimate column; the newest SmashWiki values, Brawl's, are used as the least
 *     invented numbers): swipe damages jab 10 / ftilt 13 / dash 15 / fsmash 18, star 8; and (no source at all)
 *     angles, BKB/KBG, rod geometry, star speed / range / spawn point, thrown base damage, idle TTL.
 */

import type { AttackMove, ItemShot } from '../characters/attacks';
import type { AttackMoveWithAnimation } from '../characters/moveSchema';
import { ULTIMATE_SMASH_MAX_HOLD_FRAMES } from '../characters/chargeSchema';
import { ASSET_KEYS } from '../assets/manifest';
import type { ItemDefinition } from './ItemDefinition';
import { ultimateItemThrowProfile } from './nativeItemThrow';

/** Authored rod reach (the Home-Run Bat's box). */
const ROD = Object.freeze({ offsetX: 36, offsetY: -4, width: 56, height: 32 });

/** One star. Native starrodshot: gravity 0 (flies straight; static height by design) and clip sphere / map
 * collision 3 units = a 30 px box at 5 px per unit. Speed, range and spawn point are authored (SmashWiki: "long-range"). */
export const STAR_ROD_STAR: ItemShot = Object.freeze({
  id: 'item.starRod.star',
  damage: 8,
  knockback: Object.freeze({ x: 1.4, y: -0.8, scaling: 0.08, reference: Object.freeze({ base: 30, growth: 60, angle: 361 }) }),
  speed: 10,
  lifetimeFrames: 90,
  width: 30,
  height: 30,
  spawnOffsetX: 44,
  spawnOffsetY: -8,
  visual: 'star',
  // Fresh source flag binding: ordinary-item-projectile-flags.json.
  reflectable:true,absorbable:true,
});

export const STAR_ROD_JAB: AttackMove = Object.freeze({
  id: 'item.starRod.jab',
  type: 'jab',
  itemClip: 'item_starrod_swing_1',
  damage: 10,
  knockback: { x: 1.4, y: -0.8, scaling: 0.08, reference: { base: 30, growth: 60, angle: 361 } },
  hitbox: ROD,
  // StarRodSwing1: hitbox frames 4–5 (clear_all at 6); item_starrod_swing_1 cancel_frame 26.
  startupFrames: 3,
  activeFrames: 2,
  recoveryFrames: 20,
  cooldownFrames: 0,
});

export const STAR_ROD_FTILT: AttackMove = Object.freeze({
  id: 'item.starRod.ftilt',
  type: 'tilt',
  itemClip: 'item_starrod_swing_3',
  damage: 13,
  knockback: { x: 1.8, y: -1.1, scaling: 0.1, reference: { base: 35, growth: 70, angle: 361 } },
  hitbox: ROD,
  // StarRodSwing3: hitbox frames 8–9 and SHOOT_ITEM_BULLET_CHARGE(0) at 8 (clear_all at 10); cancel_frame 38.
  itemShot: STAR_ROD_STAR,
  startupFrames: 7,
  activeFrames: 2,
  recoveryFrames: 28,
  cooldownFrames: 0,
});

export const STAR_ROD_DASH_ATTACK: AttackMove = Object.freeze({
  id: 'item.starRod.dashAttack',
  type: 'tilt',
  itemClip: 'item_starrod_swing_dash',
  damage: 15,
  knockback: { x: 2.2, y: -2.2, scaling: 0.14, reference: { base: 45, growth: 70, angle: 45 } },
  hitbox: ROD,
  // StarRodSwingDash: hitbox frames 7–13 (clear_all at 14); cancel_frame 45.
  startupFrames: 6,
  activeFrames: 7,
  recoveryFrames: 31,
  cooldownFrames: 0,
});

const SMASH_KNOCKBACK = Object.freeze({ x: 3, y: -2, scaling: 0.24, reference: Object.freeze({ base: 40, growth: 85, angle: 361 }) });

export const STAR_ROD_FSMASH: AttackMoveWithAnimation = Object.freeze({
  id: 'item.starRod.fsmash',
  type: 'smash',
  itemClip: 'item_starrod_swing_4',
  damage: 18,
  knockback: SMASH_KNOCKBACK,
  hitbox: ROD,
  charge: Object.freeze({
    knockbackMode: 'damage-only' as const,
    minChargeFrames: 0,
    maxChargeFrames: 60,
    maxHoldFrames: ULTIMATE_SMASH_MAX_HOLD_FRAMES,
    minDamage: 18,
    maxDamage: 18 * 1.4,
    minKnockback: SMASH_KNOCKBACK,
    maxKnockback: SMASH_KNOCKBACK,
  }),
  // StarRodSwing4: smash-hold flag at 7, hitbox frame 15 with SHOOT_ITEM_BULLET_CHARGE(1) (clear_all at 16);
  // cancel_frame 52. The star is not scaled by the charge (SmashWiki silent).
  itemShot: STAR_ROD_STAR,
  chargeStartFrame: 6,
  startupFrames: 14,
  activeFrames: 1,
  recoveryFrames: 36,
  cooldownFrames: 0,
});

export const STAR_ROD_DEFINITION: ItemDefinition = Object.freeze({
  type: 'starRod',
  itemClass: 'battering',
  ammo: 16,
  ammoSpentOnShot: true,
  // Authored (Ultimate idle despawn SOURCE_SILENT), the same as the Home-Run Bat.
  ttlFrames: 1200,
  brokenDespawnFrames: 30,
  // Thrown base damage authored (SmashWiki has no Ultimate Star Rod row); kinetics item_common starrod (native-derived).
  throwProfile: ultimateItemThrowProfile({ damage: 8,
    kinetics: Object.freeze({ gravity: .08, terminalFallSpeed: 2.4, airBrakeX: .0005, maxSpeedX: Number.POSITIVE_INFINITY,
      throwRebound: Object.freeze({ mul: .05, addX: .2, addY: 1.9 }) }) }),
  uses: Object.freeze({
    jab: STAR_ROD_JAB,
    ftilt: STAR_ROD_FTILT,
    dashAttack: STAR_ROD_DASH_ATTACK,
    fsmash: STAR_ROD_FSMASH,
  }),
  visual: Object.freeze({ spriteKey: ASSET_KEYS.itemStarRod, width: 18, height: 42, restAngle: 30, swingArc: [-60, 110] as const }),
});
