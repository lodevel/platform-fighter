/**
 * Extended-slot routing helpers — post-M2 character architecture pass.
 *
 * The post-M2 character architecture introduces 6 *optional* extended
 * attack slots:
 *
 *     sideLight, upLight, downLight, nair, uair, dair
 *
 * These compose with the existing 10-slot core (jab + tilt + smash +
 * fair + 4 specials + shield + dodge) to form the full 14-slot
 * directional kit the user specified:
 *
 *     Light press, grounded:
 *       neutral stick → jab
 *       side stick    → sideLight (else tilt)
 *       up stick      → upLight   (else tilt)
 *       down stick    → downLight (else tilt)
 *
 *     Light press, airborne:
 *       neutral stick    → nair (else fair)
 *       forward / back   → fair (L/R mirrored)
 *       up stick         → uair (else fair)
 *       down stick       → dair (else fair)
 *
 * This module owns the *pure* lookup — given a {@link FighterMoveset}
 * and a stick direction, return the slot the runtime should dispatch
 * to. The existing `moveResolver.ts` stays untouched: a character that
 * has not (yet) been migrated to the extended kit produces the same
 * routing it always did, because every extended slot is `undefined`
 * and the helpers return the core fallback.
 *
 * # Why a separate file
 *
 *   • Pure-function, no Phaser, no Matter — easy unit-test surface.
 *   • Avoids touching `moveResolver.ts` (700+ lines, 100s of tests)
 *     until a character actually ships extended slots and wants the
 *     new routing.
 *   • Keeps the decision "use the extended slot or fall back?" in one
 *     place so the AI predictor, the replay tooling, and the runtime
 *     don't drift.
 *
 * # Determinism
 *
 * Pure lookups against frozen records. No `Math.random()`, no
 * `Date.now()`, no Phaser side effects. Identical inputs always
 * produce identical outputs — the property the replay system requires.
 */

import type { AttackMoveWithAnimation } from './moveSchema';
import type { AerialMove } from './aerialSchema';
import type { FighterMoveset } from './movesetContract';

/**
 * Stick directions for grounded directional light press routing.
 * `'neutral'` means the stick is in the dead zone — that routes to the
 * `jab` slot directly and is included here for symmetry of the API.
 */
export type GroundedLightDirection = 'neutral' | 'side' | 'up' | 'down';

/**
 * Stick directions for aerial light press routing. `'neutral'` means
 * the stick is in the dead zone, `'forward'` / `'back'` are
 * relative-to-facing (the routing layer mirrors L/R via the facing
 * sign — both produce the same `fair` slot).
 */
export type AerialLightDirection =
  | 'neutral'
  | 'forward'
  | 'back'
  | 'up'
  | 'down';

/**
 * Resolve a grounded directional light press to the
 * {@link AttackMoveWithAnimation} slot the runtime should dispatch.
 *
 *   • `'neutral'` → `moveset.jab`
 *   • `'side'`    → `moveset.sideLight ?? moveset.tilt`
 *   • `'up'`      → `moveset.upLight   ?? moveset.tilt`
 *   • `'down'`    → `moveset.downLight ?? moveset.tilt`
 *
 * The fallback to `tilt` keeps existing characters (Wolf / Cat / Owl /
 * Bear in their current 10-slot authoring) producing exactly the same
 * dispatch they always did. A new character that ships an extended
 * directional light overrides the fallback.
 *
 * Smash-style "tap = tilt, hold = smash" is layered on top of THIS
 * lookup by `chargeSchema.ts` — the chargeable-light spec belongs to
 * whichever slot wins the routing here.
 *
 * Pure: identical (moveset, direction) inputs always produce identical
 * output references.
 */
export function resolveGroundedLightSlot(
  moveset: FighterMoveset,
  direction: GroundedLightDirection,
): AttackMoveWithAnimation {
  switch (direction) {
    case 'neutral':
      return moveset.jab;
    case 'side':
      return moveset.sideLight ?? moveset.tilt;
    case 'up':
      return moveset.upLight ?? moveset.tilt;
    case 'down':
      return moveset.downLight ?? moveset.tilt;
  }
}

/**
 * Resolve an aerial directional light press to the {@link AerialMove}
 * slot the runtime should dispatch.
 *
 *   • `'neutral'` → `moveset.nair ?? moveset.fair`
 *   • `'forward'` → `moveset.fair`   (no extended slot — fair IS the forward aerial)
 *   • `'back'`    → `moveset.fair`   (L/R mirrored — the runtime flips facing to render bair)
 *   • `'up'`      → `moveset.uair ?? moveset.fair`
 *   • `'down'`    → `moveset.dair ?? moveset.fair`
 *
 * Unlike Smash (which has a separate `bair` move authored facing-back),
 * this game declares forward and back as the same move — the runtime
 * mirrors the hitbox via facing. The user picked this convention
 * explicitly: "always symmetry left right" for aerials.
 *
 * Pure: identical (moveset, direction) inputs always produce identical
 * output references.
 */
export function resolveAerialLightSlot(
  moveset: FighterMoveset,
  direction: AerialLightDirection,
): AerialMove {
  switch (direction) {
    case 'neutral':
      return moveset.nair ?? moveset.fair;
    case 'forward':
    case 'back':
      return moveset.fair;
    case 'up':
      return moveset.uair ?? moveset.fair;
    case 'down':
      return moveset.dair ?? moveset.fair;
  }
}

/**
 * True iff the moveset declares any extended attack slot. Useful for
 * AI / debug HUDs that want to surface "this fighter has the new
 * directional kit" without iterating each slot manually.
 */
export function hasAnyExtendedSlot(moveset: FighterMoveset): boolean {
  return (
    moveset.sideLight !== undefined ||
    moveset.upLight !== undefined ||
    moveset.downLight !== undefined ||
    moveset.nair !== undefined ||
    moveset.uair !== undefined ||
    moveset.dair !== undefined
  );
}

/**
 * Count of extended slots actually populated on this moveset (0–6).
 * Lets the balance-tooling surface "how migrated is this fighter?".
 */
export function countExtendedSlots(moveset: FighterMoveset): number {
  let n = 0;
  if (moveset.sideLight !== undefined) n += 1;
  if (moveset.upLight !== undefined) n += 1;
  if (moveset.downLight !== undefined) n += 1;
  if (moveset.nair !== undefined) n += 1;
  if (moveset.uair !== undefined) n += 1;
  if (moveset.dair !== undefined) n += 1;
  return n;
}
