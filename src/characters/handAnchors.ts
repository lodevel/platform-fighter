/**
 * Per-fighter hand anchors — where a held item visually (and
 * mechanically) sits relative to the fighter's body centre.
 *
 * Before this module, a held item was pinned to the holder's CENTRE
 * OF MASS: the bat floated at the wolf's waist, never mirrored when
 * the fighter turned around, and the throw / projectile spawn origin
 * sat in the middle of the chest. The anchor table gives every
 * fighter a grip point out in front of the body at hand height; the
 * {@link computeHeldItemPosition} helper mirrors the X offset by the
 * holder's facing so the item swaps sides when the fighter turns.
 *
 * The X offset is expressed in "facing units" — positive = in front
 * of the fighter — and multiplied by `facing` (1 = right, -1 = left)
 * at resolve time. The Y offset is screen-down positive, so a
 * negative value raises the grip above the centre line toward the
 * hands.
 *
 * Values are proportional to each fighter's body silhouette (Bear is
 * wider than Cat, so his grip sits further out). They are deliberately
 * STATIC per fighter for now — per-animation-frame hand tracking needs
 * hand-bone metadata in `assets/characters/* /frames.json` that the
 * art pipeline doesn't emit yet; when it does, this module is the seam
 * where the per-frame lookup lands without touching any call site.
 *
 * Determinism: frozen finite literals, pure helper — same inputs
 * always produce the same grip point, which the replay system
 * requires because the throw origin reads from it.
 */

import type { CharacterId } from '../types';

/** Grip offset relative to the fighter's body centre (design px). */
export interface HandAnchor {
  /** Forward offset in facing units (positive = in front). */
  readonly x: number;
  /** Vertical offset, screen-down positive (negative = above centre). */
  readonly y: number;
}

/**
 * Per-fighter grip points. Tuned against the placeholder body
 * silhouettes (Wolf 90×130-class bruiser frame, Cat a slimmer ninja,
 * Owl mid-size with high shoulders, Bear the widest grappler).
 */
export const FIGHTER_HAND_ANCHORS: Readonly<Record<CharacterId, HandAnchor>> =
  Object.freeze({
    wolf: Object.freeze({ x: 26, y: -6 }),
    cat: Object.freeze({ x: 22, y: -4 }),
    owl: Object.freeze({ x: 24, y: -8 }),
    bear: Object.freeze({ x: 30, y: -2 }),
    // Post-M5 roster expansion — derived from each fighter's body
    // half-width at chest height, same heuristic as the original cast
    // (Blaze 50×78 athletic, Puff 56×56 round — grip at her equator,
    // Aegis 46×76 slender).
    blaze: Object.freeze({ x: 27, y: -6 }),
    puff: Object.freeze({ x: 24, y: 0 }),
    aegis: Object.freeze({ x: 26, y: -6 }),
    // Post-batch-2 roster expansion — derived from each fighter's body
    // half-width at chest height (Volt 40×52 tiny creature — low grip,
    // Nova 48×74 armoured, Bruno 46×68 compact hero).
    volt: Object.freeze({ x: 20, y: -2 }),
    nova: Object.freeze({ x: 26, y: -6 }),
    bruno: Object.freeze({ x: 25, y: -5 }),
    // Post-batch-3 roster expansion — grip at body half-width, chest
    // height (Link 46×72 swordsman, Kirby 52×52 round puffball — grip at
    // his equator, Donkey Kong 60×84 heavyweight — grip further out).
    link: Object.freeze({ x: 25, y: -6 }),
    kirby: Object.freeze({ x: 24, y: 0 }),
  });

/** Fallback grip for ids missing from the table (defensive only). */
export const DEFAULT_HAND_ANCHOR: HandAnchor = Object.freeze({ x: 24, y: -4 });

/** Resolve a fighter's grip offset, defaulting defensively. */
export function getHandAnchor(id: CharacterId): HandAnchor {
  return FIGHTER_HAND_ANCHORS[id] ?? DEFAULT_HAND_ANCHOR;
}

/**
 * Compute the world-space position a held item should occupy this
 * tick: the holder's centre plus their grip offset, with the forward
 * component mirrored by facing.
 *
 * This single helper feeds BOTH the simulation (the item entity's
 * snapshot position — and therefore the throw origin and projectile
 * spawn offset) and, through that snapshot, the visual container, so
 * the rendered weapon and its mechanical position can never drift
 * apart.
 */
export function computeHeldItemPosition(
  holderCenter: { readonly x: number; readonly y: number },
  facing: 1 | -1,
  characterId: CharacterId,
): { readonly x: number; readonly y: number } {
  const anchor = getHandAnchor(characterId);
  return Object.freeze({
    x: holderCenter.x + anchor.x * facing,
    y: holderCenter.y + anchor.y,
  });
}
