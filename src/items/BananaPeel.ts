/**
 * Banana Peel — Super Smash Bros. Ultimate throwing / setting item.
 *
 * Every value is listed with its source and label in docs/review/2026-10-11/ultimate-items/phase-5/sources.json:
 *   • sourced (SmashWiki Banana_Peel / Slip / Tripping / Item_throw, wins): thrown damage per throw kind (Ultimate
 *     column, 1–6.7%); an opponent stepping on it slips (slip = a guaranteed soft trip on a grounded target, ~30 frames);
 *     it lasts two slips and / or throws, then disappears (Ultimate); the fighter who placed it cannot slip on it; throw
 *     speed multiplier 0.85 and falling speed 2.2; light throwing item;
 *   • native-derived (SmashWiki silent; WuBoytH SSBU-Dumped-Scripts @59004685 item/banana game_Throw /
 *     game_SetSlipCallback, ultimate-13.0.1 item_common row banana): the thrown hit's launch (angle 361, KBG 0, BKB 50,
 *     size 3) and its slip on grounded targets (collision_attr_slip, situation G), the lying peel's slip box (size 3,
 *     3 units below the item origin, legs only), kinetics, pickup range 11 × 3.4 units;
 *   • authored (SmashWiki silent): idle TTL, the sideways push of a slipped-on peel, the sprite's root offsets.
 *
 * Phaser-free: the use count lives on the ItemEntity (`durability`).
 */
import type { HitInfo } from '../characters/combat';
import { ASSET_KEYS } from '../assets/manifest';
import type { ItemDefinition } from './ItemDefinition';
import { ultimateItemThrowProfile } from './nativeItemThrow';

/** game_SetSlipCallback: ATTACK 0%, angle 361, KBG 0, BKB 50, size 3 at y −3, collision_attr_slip, legs only. */
const SLIP_KNOCKBACK = Object.freeze({ base: 50, growth: 0, fixed: 0, angle: 361 });

/** The lying peel's slip box (game_SetSlipCallback size 3 at y −3 units: centred at the root, radius 15 px). */
export const BANANA_SLIP_RADIUS = 15;

/** Authored (SmashWiki: "the Banana Peel itself flies a short distance sideways", Brawl-era text): the peel's push. */
export const BANANA_SLIP_PUSH = Object.freeze({ vx: 4, vy: -5 });

/** The slip a grounded fighter takes on touching a lying peel (0%, soft trip). */
export function bananaSlipHit(facing: 1 | -1): HitInfo {
  return { damage: 0, knockback: { x: 0, y: 0, scaling: 0, reference: SLIP_KNOCKBACK }, facing,
    hitlagMultiplier: 1, sdiMultiplier: 1, direct: false, slip: true };
}

export const BANANA_PEEL_DEFINITION: ItemDefinition = Object.freeze({
  type: 'bananaPeel',
  itemClass: 'throwing',
  // Authored (Ultimate idle despawn SOURCE_SILENT), the same as the other light items.
  ttlFrames: 1200,
  brokenDespawnFrames: 0,
  // SmashWiki Item_throw unique factors (base damage modifier 1, speed damage multiplier 1.7, throw speed multiplier
  // 0.85, falling speed 2.2) = item_common banana throw_power_speed_add 1 / _mul 1.7, throw_speed_mul 0.85, gravity max
  // 2.2; game_Throw: damage 0, angle 361, KBG 0, BKB 50, size 3. The per-throw table below replaces the formula damage.
  throwProfile: Object.freeze({ ...ultimateItemThrowProfile({ damage: 0, mapBottom: 2, attackRadius: 3, speedMultiplier: .85,
    knockback: SLIP_KNOCKBACK,
    kinetics: Object.freeze({ gravity: .074, terminalFallSpeed: 2.2, airBrakeX: .005, maxSpeedX: Number.POSITIVE_INFINITY,
      throwRebound: Object.freeze({ mul: .03, addX: .2, addY: 1.9 }) }) }), damageSpeedAdd: 1, damageSpeedMultiplier: 1.7 }),
  thrownHit: Object.freeze({
    // SmashWiki Banana_Peel#Damage_output, Ultimate column.
    damageByAction: Object.freeze({
      'throw-ground-forward-ordinary': 4.1, 'throw-ground-back-ordinary': 4.1,
      'throw-ground-up-ordinary': 5.3, 'throw-ground-down-ordinary': 1,
      'dash-throw': 5,
      'throw-ground-forward-strong': 5.3, 'throw-ground-back-strong': 5.3,
      'throw-ground-up-strong': 6.7, 'throw-ground-down-strong': 4.7,
      'air-z-drop': 4.7,
      'throw-air-forward-ordinary': 4.1, 'throw-air-back-ordinary': 4.1,
      'throw-air-up-ordinary': 5.2, 'throw-air-down-ordinary': 4.7,
      'throw-air-forward-strong': 5.3, 'throw-air-back-strong': 5.3,
      'throw-air-up-strong': 6.7, 'throw-air-down-strong': 4.7,
    }),
    slipGrounded: true,
  }),
  slipsOnContact: true,
  // SmashWiki (Ultimate): "they will last for two slips and/or throws until they disappear".
  durability: 2,
  // item_common banana pickup_range 11 × 3.4 units (offsets authored: the peel lies on its root).
  pickupBounds: Object.freeze({ offsetX: 0, offsetY: -8.5, width: 55, height: 17 }),
  visual: Object.freeze({ spriteKey: ASSET_KEYS.itemBananaPeel, width: 44, height: 22, restAngle: 0 }),
});
