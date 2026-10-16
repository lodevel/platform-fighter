/**
 * The stage-spawnable items and the Ultimate Item Switch (universal-rules.json spawn.itemSwitchUltimate):
 * every item can be switched on or off per match (`MatchConfig.itemSwitch`, absent = on). Spawn weights
 * are SOURCE_SILENT, so each enabled item is equally likely (authored), drawn on its own `item-type`
 * MatchRng stream (spawn timing stays on `item-spawn`).
 */
import { HOME_RUN_BAT_DEFINITION } from './HomeRunBat';
import { BEAM_SWORD_DEFINITION } from './BeamSword';
import { STAR_ROD_DEFINITION } from './StarRod';
import { HAMMER_DEFINITION, GOLDEN_HAMMER_DEFINITION } from './Hammer';
import { RAY_GUN_DEFINITION } from './RayGun';
import { SUPER_SCOPE_DEFINITION } from './SuperScope';
import { FIRE_FLOWER_DEFINITION } from './FireFlower';
import { BOB_OMB_DEFINITION } from './BobOmb';
import { BANANA_PEEL_DEFINITION } from './BananaPeel';
import { CRATE_DEFINITION } from './Crate';
import { BARREL_DEFINITION } from './Barrel';
import { CAPSULE_DEFINITION } from './Capsule';
import {FOOD_DEFINITION} from './Food';
import {HEART_CONTAINER_DEFINITION} from './HeartContainer';
import {MAXIM_TOMATO_DEFINITION} from './MaximTomato';
import { isItemUseMove, type ItemDefinition } from './ItemDefinition';
import type { Rng } from '../utils/Rng';
import {SMASH_BALL_DEFINITION,type SmashBallDefinition} from './SmashBall';

export const ITEM_TYPE_RNG_STREAM = 'item-type' as const;

/** Spawn table order (stable: it is the index space of the item-type roll; new items are appended). */
export type ItemCatalogEntry=ItemDefinition|SmashBallDefinition;
/** Canonical Item Switch order; ordinary indices0..15 remain unchanged. Ball
 * appends at16, with a separate source scheduler and RNG stream. */
export const ITEM_CATALOG:readonly ItemCatalogEntry[]=Object.freeze([
  HOME_RUN_BAT_DEFINITION,
  BEAM_SWORD_DEFINITION,
  HAMMER_DEFINITION,
  RAY_GUN_DEFINITION,
  BOB_OMB_DEFINITION,
  CRATE_DEFINITION,
  STAR_ROD_DEFINITION,
  SUPER_SCOPE_DEFINITION,
  FIRE_FLOWER_DEFINITION,
  BANANA_PEEL_DEFINITION,
  GOLDEN_HAMMER_DEFINITION,
  FOOD_DEFINITION,
  HEART_CONTAINER_DEFINITION,
  MAXIM_TOMATO_DEFINITION,
  BARREL_DEFINITION,
  CAPSULE_DEFINITION,
  SMASH_BALL_DEFINITION,
]);
export function isOrdinaryItemDefinition(entry:ItemCatalogEntry):entry is ItemDefinition{
  return entry.itemClass!=='final-resource';
}
/** Ordinary spawn/held/damage consumers never receive a standalone resource. */
export const ITEM_SPAWN_TABLE:readonly ItemDefinition[]=Object.freeze(ITEM_CATALOG.filter(isOrdinaryItemDefinition));

/** Item Switch: item type → enabled. Absent entries are on. */
export type ItemSwitch = Readonly<Record<string, boolean>>;
export function enabledCatalogEntries(itemSwitch:ItemSwitch|undefined):ItemCatalogEntry[]{
  return ITEM_CATALOG.filter(def=>itemSwitch?.[def.type]!==false);
}
export function smashBallSwitchEnabled(itemSwitch:ItemSwitch|undefined):boolean{
  return itemSwitch?.smashBall!==false;
}

export function enabledSpawnItems(itemSwitch: ItemSwitch | undefined): ItemDefinition[] {
  return ITEM_SPAWN_TABLE.filter(def => itemSwitch?.[def.type] !== false);
}

/** Equal weights over the enabled items; null when every item is switched off. */
export function pickSpawnItem(rng: Rng, enabled: readonly ItemDefinition[]): ItemDefinition | null {
  return enabled.length ? enabled[rng.range(0, enabled.length - 1)]! : null;
}

/** True iff `moveId` is a battering item's own swing (weapon swing presentation keys off it). */
export function isBatteringItemMove(moveId: string): boolean {
  return ITEM_SPAWN_TABLE.some(def => def.itemClass === 'battering' && isItemUseMove(def, moveId));
}
