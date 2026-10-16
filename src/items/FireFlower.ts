/**
 * Fire Flower — Super Smash Bros. Ultimate shooting item.
 *
 * Every value is listed with its source and label in docs/review/2026-10-11/ultimate-items/phase-4/sources.json:
 *   • sourced (SmashWiki Fire_Flower / Item / Item_throw, wins): hold attack to spit a continuous short-range stream;
 *     7 seconds of combined fire (= 420 frames of fuel); run and jump while shooting; flames reflectable; the empty
 *     flower is thrown on the fire press; thrown speed multiplier 0.7 and falling speed 0.6 (Item_throw unique
 *     factors row); light shooting item;
 *   • native-derived (SmashWiki silent; WuBoytH FFlowerShoot / FFlowerShootAir: the first flame on frame 8;
 *     ultimate-13.0.1 item sheet fire_flower_shoot_interval_frame 12, fire_flower_shoot_min 3; fireflowershot
 *     gravity_accel 0; item_common fireflower gravity 0.06): one flame every 12 frames, at least 3 flames per press,
 *     gravity-free flames, thrown kinetics;
 *   • authored: per-flame damage 2.2% (SmashWiki has no Ultimate column; the newest one, SSB4's 2.2%, is used as the
 *     least invented number), flame launch / speed / range / size, the start-to-loop motion switch, fuel spent every
 *     streaming frame, thrown base damage, idle TTL. Not modelled: the thrown flower's burning hitbox and its "cannot
 *     KO" rule (no burn effect in the engine).
 */
import type { ItemShot } from '../characters/attacks';
import { ASSET_KEYS } from '../assets/manifest';
import type { ItemDefinition } from './ItemDefinition';
import type { StreamSpec } from './itemShooting';
import { ultimateItemThrowProfile } from './nativeItemThrow';

export const FIRE_FLOWER_FLAME: ItemShot = Object.freeze({
  id: 'item.fireFlower.flame',
  damage: 2.2,
  knockback: Object.freeze({ x: .5, y: -.3, scaling: .02, reference: Object.freeze({ base: 8, growth: 25, angle: 361 }) }),
  // Short range: 20 frames at 5 px/frame (~100 px past the muzzle).
  speed: 5,
  lifetimeFrames: 20,
  width: 30,
  height: 26,
  spawnOffsetX: 34,
  spawnOffsetY: -6,
  visual: 'flame',
  // Fresh source flag binding: ordinary-item-projectile-flags.json.
  reflectable:true,absorbable:true,
});

/** SmashWiki: "The flames can be shot for a combined seven seconds" (60 frames per second). */
export const FIRE_FLOWER_FUEL_FRAMES = 7 * 60;

export const FIRE_FLOWER_SHOOTING: StreamSpec = Object.freeze({
  kind: 'stream',
  start: Object.freeze({ clips: Object.freeze({ ground: 'item_fflower_shoot', upper: 'item_fflower_shoot_upper', air: 'item_fflower_shoot_air' }),
    frames: 12 }),
  loop: Object.freeze({ clips: Object.freeze({ ground: 'item_fflower_shoot_loop', upper: 'item_fflower_shoot_loop_upper',
    air: 'item_fflower_shoot_air_loop' }) }),
  firstShotFrame: 7,
  interval: 12,
  minShots: 3,
  fuelPerFrame: 1,
  shot: FIRE_FLOWER_FLAME,
});

export const FIRE_FLOWER_DEFINITION: ItemDefinition = Object.freeze({
  type: 'fireFlower',
  itemClass: 'shooting',
  ammo: FIRE_FLOWER_FUEL_FRAMES,
  ammoSpentOnShot: true,
  shooting: FIRE_FLOWER_SHOOTING,
  ttlFrames: 1200,
  brokenDespawnFrames: 30,
  // SmashWiki Item_throw "Fire Flower | -0.4 | 3 | 0.7 | 0.6"; base damage authored; kinetics item_common fireflower.
  throwProfile: ultimateItemThrowProfile({ damage: 5, mapBottom: 4, speedMultiplier: .7,
    kinetics: Object.freeze({ gravity: .06, terminalFallSpeed: .6, airBrakeX: .0025, maxSpeedX: Number.POSITIVE_INFINITY,
      throwRebound: Object.freeze({ mul: .06, addX: .2, addY: 1 }) }) }),
  visual: Object.freeze({ spriteKey: ASSET_KEYS.itemFireFlower, width: 26, height: 36, restAngle: 90, socketAxis: 'z' as const }),
});
