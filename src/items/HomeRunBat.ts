/**
 * Home-Run Bat — Super Smash Bros. Ultimate battering item.
 *
 * Every value is listed with its source and label in
 * docs/review/2026-10-11/ultimate-items/phase-1/sources.json:
 *   • sourced (SmashWiki, wins): damages jab 7 / ftilt 13 / dash 16 / fsmash 30,
 *     the four item swipes, forward smash = one uncharged swing on frame 51,
 *     reflects (Ultimate: a reflect interrupts the wind-up into the swing), no
 *     stated durability, light item, battering class;
 *   • native-derived (SmashWiki silent; WuBoytH SSBU-Dumped-Scripts @59004685,
 *     smashline/lua2cpp_donkey/donkey/BatSwing{1,3,4,Dash}.txt and the motion
 *     list cancel_frame): hitbox frames of jab/ftilt/dash, action totals
 *     (cancel_frame − 1), forward smash reflector start, size and multipliers
 *     (each fighter's own BatSwing4 reflector box), thrown-item kinetics
 *     (item_common homerunbat);
 *   • authored (SmashWiki silent and the common hitbox scripts
 *     game_BatSwing*Common are not dumped locally): angles, BKB/KBG, hitbox
 *     geometry, forward smash active length, reflector end, idle TTL.
 *
 * Engine convention: action frame 1 is elapsed step 0, so a first active frame
 * N is `startupFrames = N − 1`; startup + active + recovery = FAF − 1.
 */

import type { AttackMove } from '../characters/attacks';
import { ASSET_KEYS } from '../assets/manifest';
import type { ItemDefinition } from './ItemDefinition';
import { HOME_RUN_BAT_THROW_KINETICS, ultimateItemThrowProfile } from './nativeItemThrow';

/** Authored (SmashWiki silent, common hitbox script not dumped): the bat's reach in
 * front of the hand, carried over from the previous test bat. */
const BAT_HITBOX = Object.freeze({ offsetX: 36, offsetY: -4, width: 56, height: 32 });

export const HOME_RUN_BAT_JAB: AttackMove = Object.freeze({
  id: 'item.homeRunBat.jab',
  type: 'jab',
  itemClip: 'item_bat_swing_1',
  damage: 7,
  knockback: { x: 1.6, y: -1.1, scaling: 0.09, reference: { base: 30, growth: 60, angle: 361 } },
  hitbox: BAT_HITBOX,
  // BatSwing1: hitbox frames 4–5 (clear_all at 6); item_bat_swing_1 cancel_frame 26.
  startupFrames: 3,
  activeFrames: 2,
  recoveryFrames: 20,
  cooldownFrames: 0,
});

export const HOME_RUN_BAT_FTILT: AttackMove = Object.freeze({
  id: 'item.homeRunBat.ftilt',
  type: 'tilt',
  itemClip: 'item_bat_swing_3',
  damage: 13,
  knockback: { x: 2.4, y: -1.6, scaling: 0.16, reference: { base: 40, growth: 80, angle: 361 } },
  hitbox: BAT_HITBOX,
  // BatSwing3: hitbox frames 8–9 (clear_all at 10); item_bat_swing_3 cancel_frame 38.
  startupFrames: 7,
  activeFrames: 2,
  recoveryFrames: 28,
  cooldownFrames: 0,
});

export const HOME_RUN_BAT_DASH_ATTACK: AttackMove = Object.freeze({
  // `.dashAttack` suffix: a fighter without item_bat_swing_dash shows its dash_attack sheet.
  id: 'item.homeRunBat.dashAttack',
  type: 'tilt',
  itemClip: 'item_bat_swing_dash',
  damage: 16,
  knockback: { x: 2.6, y: -2.6, scaling: 0.2, reference: { base: 50, growth: 80, angle: 45 } },
  hitbox: BAT_HITBOX,
  // BatSwingDash: hitbox frames 7–13 (two common phases, clear_all at 14); cancel_frame 45.
  startupFrames: 6,
  activeFrames: 7,
  recoveryFrames: 31,
  cooldownFrames: 0,
});

export const HOME_RUN_BAT_FSMASH: AttackMove = Object.freeze({
  id: 'item.homeRunBat.fsmash',
  type: 'smash',
  itemClip: 'item_bat_swing_4',
  damage: 30,
  // Authored to satisfy SmashWiki "a one-hit KO in every one" (angle/BKB/KBG silent).
  knockback: { x: 5.5, y: -4.6, scaling: 0.6, reference: { base: 100, growth: 100, angle: 40 } },
  hitbox: BAT_HITBOX,
  // SmashWiki "Home-Run swing timing: Ultimate | All characters | 51": first hit frame 51.
  // Active length authored (BatSwing4Common2 not dumped); total from cancel_frame 81.
  startupFrames: 50,
  activeFrames: 2,
  recoveryFrames: 28,
  cooldownFrames: 0,
  // BatSwing4.txt: SEARCH from script frame 0, then shield(REFLECTOR, …, "top", 10, 0, 10, 8.5, 0, 13, 8.5,
  // 2, 2.5, 80, …): radius 10 u around top-bone (y 10→13, z 8.5), damage ×2, speed ×2.5. DK geometry at
  // 5 px/u with the feet 42 px below the body centre (DonkeyKong.ts convention). End authored = end of active.
  reflectWindow: {
    startFrame: 0,
    endFrame: 52,
    body: { offsetX: 42.5, offsetY: -15.5, width: 100, height: 115 },
    damageMultiplier: 2,
    speedMultiplier: 2.5,
    swingOnReflect: true,
  },
});

/** Pikachu's own BatSwing4 reflector (WuBoytH scripts, pikachu/BatSwing4.txt): shield(REFLECTOR, …,
 * "top", 9, 0, 7, 7, 0, 7, 8, 2, 2.5, 80, …) — radius 9 u around top-bone y 7, z 7→8. Pikachu geometry:
 * 5 px/unit, body centre 25 px above the feet (pikachu frames.json bodyCentreFromRoot). */
export const HOME_RUN_BAT_FSMASH_PIKACHU: AttackMove = Object.freeze({
  ...HOME_RUN_BAT_FSMASH,
  reflectWindow: Object.freeze({ ...HOME_RUN_BAT_FSMASH.reflectWindow!,
    body: Object.freeze({ offsetX: 37.5, offsetY: -10, width: 95, height: 90 }) }),
});

/** SmashWiki Home-Run Bat Ultimate thrown damage (drop 11.9, dash 21.8, forward smash 22.5) is the
 * Item_throw formula with base damage 12: 12/2 − 0.4 + 2.1×3 = 11.9, 12 − 0.4 + 3.4×3 = 21.8. */
export const HOME_RUN_BAT_THROW_PROFILE = ultimateItemThrowProfile({
  damage: 12, kinetics: HOME_RUN_BAT_THROW_KINETICS, mapBottom: 4,
});

export const HOME_RUN_BAT_DEFINITION: ItemDefinition = Object.freeze({
  type: 'homeRunBat',
  itemClass: 'battering',
  // Authored (Ultimate idle despawn SOURCE_SILENT), kept from the previous test bat.
  ttlFrames: 1200,
  brokenDespawnFrames: 30,
  throwProfile: HOME_RUN_BAT_THROW_PROFILE,
  uses: Object.freeze({
    jab: HOME_RUN_BAT_JAB,
    ftilt: HOME_RUN_BAT_FTILT,
    dashAttack: HOME_RUN_BAT_DASH_ATTACK,
    fsmash: HOME_RUN_BAT_FSMASH,
  }),
  usesByFighter: Object.freeze({ pikachu: Object.freeze({ fsmash: HOME_RUN_BAT_FSMASH_PIKACHU }) }),
  visual: Object.freeze({ spriteKey: ASSET_KEYS.itemBat, width: 14, height: 40, restAngle: 30, swingArc: [-60, 110] as const }),
});
