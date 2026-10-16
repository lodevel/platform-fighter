/**
 * The single held-item input decision (Ultimate items).
 *
 * Character classifies the press exactly as without an item (grounded
 * pattern or aerial), then asks this function what the held item does with it
 * (universal-rules.json `attackInput`):
 *   • battering items turn neutral attack, forward tilt, dash attack and
 *     forward smash into item swipes (`battering`); up/down tilts and aerials
 *     are SOURCE_SILENT, so the fighter's own moves run;
 *   • a smash attack input with an item is a smash throw
 *     (`smashAttacksThrowItem`) — up/down smash always, forward smash unless
 *     the item's own forward smash swing replaces it;
 *   • shooting items fire on the neutral attack and neutral aerial
 *     (`shootingFire`) and can be used while walking, running and jumping
 *     (`shootingMovement`): a grounded attack press while walking or running is
 *     read as forward tilt / dash attack by the classifier, so those presses
 *     fire too (interpretation of the movement rule; up/down tilts and the other
 *     aerials stay native, SOURCE_SILENT); an empty shooting item is thrown on
 *     the fire press (`emptyShootingItem`).
 */

import type { AttackMove } from '../characters/attacks';
import type { ItemUseInput, ItemUseTable } from './ItemDefinition';

/** Character's classified attack press: a grounded pattern, or any aerial. */
export type ItemInputPattern =
  | 'jab' | 'tilt' | 'dashAttack' | 'smash'
  | 'utilt' | 'dtilt' | 'usmash' | 'dsmash'
  | 'nair' | 'aerial';

export type ItemInputDecision =
  | { readonly kind: 'use'; readonly move: AttackMove }
  | { readonly kind: 'fire' }
  | { readonly kind: 'empty-throw' }
  | { readonly kind: 'smash-throw'; readonly direction: 'forward' | 'back' | 'up' | 'down' };

const PATTERN_USE: Readonly<Partial<Record<ItemInputPattern, ItemUseInput>>> = Object.freeze({
  jab: 'jab',
  tilt: 'ftilt',
  dashAttack: 'dashAttack',
  smash: 'fsmash',
  nair: 'aerial',
  aerial: 'aerial',
});

/** Presses a shooting item fires on: neutral attack (also while walking / running) and neutral aerial. */
const FIRE_PATTERNS: ReadonlySet<ItemInputPattern> = new Set(['jab', 'tilt', 'dashAttack', 'nair']);

/**
 * What the held item does with `pattern`, or null when the fighter's own move runs.
 * `canUse` gates the item's uses (ammo, lifecycle); `smashBehind` marks a forward smash
 * input pointing behind the fighter (a back smash throw); `shooting` = a shooting item.
 */
export function resolveItemInput(pattern: ItemInputPattern, uses: ItemUseTable | undefined,
  canUse: boolean, smashBehind = false, shooting = false): ItemInputDecision | null {
  if (pattern === 'usmash') return { kind: 'smash-throw', direction: 'up' };
  if (pattern === 'dsmash') return { kind: 'smash-throw', direction: 'down' };
  if (shooting && FIRE_PATTERNS.has(pattern)) return canUse ? { kind: 'fire' } : { kind: 'empty-throw' };
  const input = PATTERN_USE[pattern];
  const move = canUse && input ? uses?.[input] : undefined;
  if (move) return { kind: 'use', move };
  if (pattern === 'smash') return { kind: 'smash-throw', direction: smashBehind ? 'back' : 'forward' };
  return null;
}
