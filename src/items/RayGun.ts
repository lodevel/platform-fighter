/**
 * Ray Gun — Super Smash Bros. Ultimate shooting item (replaces the test ray gun).
 *
 * Every value is listed with its source and label in docs/review/2026-10-11/ultimate-items/phase-4/sources.json:
 *   • sourced (SmashWiki Ray_Gun / Item, wins): 16 shots; each shot 5% with weight-independent vertical knockback;
 *     one shot per 25 frames; infinite horizontal range (the shot flies until it leaves the blast zone); fires on
 *     the neutral attack and neutral aerial, usable while walking / running / jumping; shots reflectable; the empty
 *     gun is thrown on the fire press; light shooting item;
 *   • native-derived (SmashWiki silent; WuBoytH SSBU-Dumped-Scripts LGunShoot / LGunShootAir, the motion list,
 *     ultimate-13.0.1 item_common raygun / raygunshot): the shot leaves on frame 9 (SHOOT_ITEM_BULLET), item_lgun_shoot
 *     cancel_frame 25 (= SmashWiki's 25), gravity-free shot (raygunshot gravity_accel 0), thrown kinetics;
 *   • authored (SmashWiki silent, no local native value): the numeric launch (angle 90 for "vertical", BKB / KBG
 *     chosen so it cannot KO before ~400% as SmashWiki says), shot speed and size, thrown base damage, idle TTL.
 */
import type { ItemShot } from '../characters/attacks';
import { ASSET_KEYS } from '../assets/manifest';
import type { ItemDefinition } from './ItemDefinition';
import type { SingleShotSpec } from './itemShooting';
import { ultimateItemThrowProfile } from './nativeItemThrow';

export const RAY_GUN_SHOT: ItemShot = Object.freeze({
  id: 'item.rayGun.shot',
  damage: 5,
  // "weight-independent vertical knockback": setWeight (weight 100), angle 90.
  knockback: Object.freeze({ x: 0, y: -1.2, scaling: .05,
    reference: Object.freeze({ base: 30, growth: 30, angle: 90, setWeight: true }) }),
  speed: 16,
  // Infinite horizontal range: it flies until it leaves the blast zone (MatchScene despawns it there).
  lifetimeFrames: Number.POSITIVE_INFINITY,
  width: 40,
  height: 10,
  spawnOffsetX: 40,
  spawnOffsetY: -6,
  visual: 'laser',
  // Fresh source flag binding: ordinary-item-projectile-flags.json.
  reflectable:true,absorbable:true,
});

export const RAY_GUN_SHOOTING: SingleShotSpec = Object.freeze({
  kind: 'single',
  clips: Object.freeze({ ground: 'item_lgun_shoot', upper: 'item_lgun_shoot_upper', air: 'item_lgun_shoot_air' }),
  // FAF 25 (SmashWiki "every 25 frames", native cancel_frame 25): ages 0..23, the next shot on the 25th frame.
  frames: 24,
  // LGunShoot / LGunShootAir: SHOOT_ITEM_BULLET at frame 9.
  shotFrame: 8,
  shot: RAY_GUN_SHOT,
});

export const RAY_GUN_DEFINITION: ItemDefinition = Object.freeze({
  type: 'rayGun',
  itemClass: 'shooting',
  ammo: 16,
  ammoSpentOnShot: true,
  shooting: RAY_GUN_SHOOTING,
  // Authored (Ultimate idle despawn SOURCE_SILENT), the same as the Home-Run Bat.
  ttlFrames: 1200,
  brokenDespawnFrames: 30,
  // Thrown base damage authored (SmashWiki Ray Gun throw table stops at SSB4); kinetics item_common raygun.
  throwProfile: ultimateItemThrowProfile({ damage: 5, mapBottom: 3,
    kinetics: Object.freeze({ gravity: .09, terminalFallSpeed: 2.3, airBrakeX: .0025, maxSpeedX: Number.POSITIVE_INFINITY,
      throwRebound: Object.freeze({ mul: .06, addX: .2, addY: 1.8 }) }) }),
  visual: Object.freeze({ spriteKey: ASSET_KEYS.itemRayGun, width: 14, height: 32, restAngle: 90, socketAxis: 'z' as const }),
});
