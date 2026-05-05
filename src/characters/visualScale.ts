/**
 * Per-character visual rendering metrics — single source of truth that
 * the renderer (`MatchScene` / future scenes) and any future scaling
 * subsystem (mushroom power-ups, training-mode "Tiny / Giant", item
 * effects) read from.
 *
 * Architecture intent
 * -------------------
 * The visible sprite size, the hurtbox (collision body) dimensions,
 * and any per-attack hitbox geometry must all scale together so that
 * "the area where I get hit equals what I can see on screen" stays
 * invariant under runtime scaling.
 *
 * Right now there is no live scale multiplier in production; the base
 * factor is 1.0 for every character. To add a future power-up that
 * doubles a fighter's size:
 *
 *   1. Add an instance-level `visualScale` field to `Character` (e.g.
 *      modified by an item effect).
 *   2. In MatchScene's per-frame render loop, multiply
 *      `getCharacterSpriteDisplaySize(id)` by `character.visualScale`
 *      when calling `sprite.setDisplaySize(...)`.
 *   3. Call `Phaser.Physics.Matter.Body.scale(body, k, k)` on the
 *      Matter body so the hurtbox grows proportionally.
 *   4. Optionally scale per-move attack hitboxes by the same factor.
 *
 * The contract: hurtbox-to-visible-pixel ratio is invariant under
 * runtime scaling. Both the rendered sprite and the collision body
 * must apply the same multiplier.
 */

import type { CharacterId } from '../types';

/**
 * On-screen sprite display size (square, in CSS pixels at zoom 1.0).
 * Picked so each character reads at roughly 1.5× the legacy M1 body
 * footprint while the underlying hurtbox can shrink to match the
 * visible character pixels within the sprite frame.
 *
 * NOT to be confused with the body / hurtbox dims in `*_TUNING.width`
 * and `*_TUNING.height` — those are the COLLISION area; this is the
 * RENDER area.
 */
export const CHARACTER_SPRITE_DISPLAY_SIZE: Readonly<Record<CharacterId, number>> = Object.freeze({
  wolf: 150,
  cat: 112,
  owl: 105,
  bear: 130,
});

/**
 * Lookup the rendered sprite size for a character, with a sensible
 * default for unknown ids (e.g. dev seeds that ship a synthetic
 * character not in the M1/M2 roster).
 */
export function getCharacterSpriteDisplaySize(id: CharacterId | string): number {
  return CHARACTER_SPRITE_DISPLAY_SIZE[id as CharacterId] ?? 150;
}

/**
 * Apply a display height to a sprite, deriving width from the source
 * frame's natural aspect ratio. Phaser's `setDisplaySize(W, H)` forces
 * an exact W × H rectangle — passing the same value for both axes
 * stretches non-square sources (15×20 owl strip, 60×72 bear cell) into
 * a square, which makes them read as oversized and distorted.
 *
 * Falls back to a square scale if the frame has no natural dimensions
 * (e.g. before the texture has finished loading or `__DEFAULT`).
 */
export function applySpriteDisplayHeight(
  sprite: { frame?: { width?: number; height?: number }; setDisplaySize: (w: number, h: number) => unknown },
  displayHeight: number,
): void {
  const fw = sprite.frame?.width ?? 0;
  const fh = sprite.frame?.height ?? 0;
  if (fw > 0 && fh > 0) {
    sprite.setDisplaySize(displayHeight * (fw / fh), displayHeight);
  } else {
    sprite.setDisplaySize(displayHeight, displayHeight);
  }
}
