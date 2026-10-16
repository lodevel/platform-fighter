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
/**
 * On-screen sprite display size (px) at the base 1920×1080 viewport.
 *
 * These are the original MAP-BALANCED proportions — sized so the fighter
 * reads correctly against Stage 1's 1180px main platform and the cinematic
 * auto-zoom camera. HD sharpness comes from the 256² source cells + bilinear
 * filtering (renderer flags), NOT from inflating the on-screen footprint:
 * a 256² sprite shown at 75px is crisp AND correctly proportioned. An earlier
 * pass bumped these ~2× for "HD presence" and made characters dwarf the stage;
 * reverted here.
 *
 * Sizing rule per character: `bodyHeight / fillFraction` — ensures the
 * visible silhouette (alpha-filled pixels) matches the hurtbox dimensions.
 */
export const CHARACTER_SPRITE_DISPLAY_SIZE: Readonly<Record<CharacterId, number>> = Object.freeze({
  // AI-pack fighter (~0.96 fill fraction). display × 0.96 ≈ bodyHeight.
  link:        75, // body 72, fill 0.96 → 72/0.96 = 75
  // DK 2026-09-25 UFD pack: ONE union rect over 186 frames including the
  // Spinning Kong / smash reach, so the hunched idle stands only 96 px of the
  // 256 cell (fill 0.375). 84 / 0.375 = 224. Recalibrate after any repack.
  donkeykong: 224,
  pikachu: 179.2, // Reviewed512x384 normal cell at4*70/600 scale; per-sheet metrics drive match.
});

/**
 * Per-character base sprite facing — `true` when the source art is
 * drawn facing LEFT in its un-flipped frames, `false` when it faces
 * right.
 *
 * Art drawn facing RIGHT matches the engine's default facing of `+1`, so
 * the renderer flips only when the fighter faces left. Left-facing art
 * would run backwards without this flag. {@link shouldFlipSprite} folds
 * this base direction into the flip so
 * every fighter visually faces the way it is moving regardless of how
 * its source art was drawn.
 */
export const CHARACTER_SPRITE_FACES_LEFT: Readonly<Record<CharacterId, boolean>> =
  Object.freeze({
    // Link — the frames are authored facing right (flip when moving left).
    link: false,
    // Donkey Kong — AI sprite pack, enforced right-facing (flip when moving left).
    donkeykong: false,
    pikachu: false,
  });

/**
 * Per-character HORIZONTAL art-centring offset, as a SIGNED FRACTION of
 * the frame width: `(artCentreX - frameCentreX) / frameWidth`. Positive =
 * the drawn character sits RIGHT of the frame centre, negative = LEFT.
 *
 * Some sheets don't centre the character within the cell, so a sprite
 * placed (origin 0.5) on the body centre renders the *visible* body off to
 * one side — the hurtbox then looks un-centred under the F3 debug overlay.
 * The renderer shifts the sprite by `-offset × displayWidth` (flipped with
 * facing) to put the visible art back on the body centre.
 *
 * Measured from each sheet's idle+run alpha bounding boxes (avg of all
 * frames). 0 = already centred. Only
 * sheets with a CONSISTENT off-centre get a non-zero value — a per-frame
 * walk-cycle wobble is normal animation, not a centring error.
 */
export const CHARACTER_SPRITE_ART_OFFSET_X: Readonly<Record<CharacterId, number>> =
  Object.freeze({
    link: 0,
    donkeykong: 0,
    pikachu: 0,
  });

/** Lookup the horizontal art-centring offset fraction; 0 (centred) default. */
export function getCharacterSpriteArtOffsetX(id: CharacterId | string): number {
  return CHARACTER_SPRITE_ART_OFFSET_X[id as CharacterId] ?? 0;
}

/**
 * Per-character FOOT-PADDING offset, as a FRACTION of the frame height:
 * `bottomTransparentRows / frameHeight`. The sprite is bottom-anchored
 * (origin 0.5, 1.0) onto the body's bottom edge, so any transparent rows
 * BELOW the drawn feet leave the visible feet floating above the ground by
 * `fraction × displayHeight`. The renderer shifts the sprite DOWN by that
 * amount so the feet seat on the body bottom (the padding then hangs harmlessly
 * below, into the floor).
 *
 * Measured from each sheet's idle alpha bounding box. 0 = feet already on the
 * cell's bottom edge. Only sheets with a
 * CONSISTENT, noticeable gap get a non-zero value.
 */
export const CHARACTER_SPRITE_ART_OFFSET_Y: Readonly<Record<CharacterId, number>> =
  Object.freeze({
    // HD pack (256² cells): faint ground-shadow below the feet extends the
    // packed bbox past the real feet. Measured ~9px on idle. Seat the feet.
    link: 9 / 256,
    // DK 2026-09-25 UFD pack: the union rect's bottom is set by the frames
    // whose feet dip below the shared ground line (smash lunge, throws), so
    // the idle's feet sit 16 px above the cell bottom. Measured on idle cells.
    donkeykong: 16 / 256,
    pikachu: 0, // Registered root consumer handles transparent padding.
  });

/** Lookup the foot-padding offset fraction; 0 (feet on the bottom edge) default. */
export function getCharacterSpriteArtOffsetY(id: CharacterId | string): number {
  return CHARACTER_SPRITE_ART_OFFSET_Y[id as CharacterId] ?? 0;
}

/**
 * Resolve whether a fighter's sprite should be horizontally flipped to
 * face the given direction (`+1` right, `-1` left), accounting for the
 * source art's base facing. Right-facing art flips when the fighter
 * faces left; left-facing art flips when the fighter faces right.
 */
export function shouldFlipSprite(
  id: CharacterId | string,
  facing: 1 | -1,
): boolean {
  const facesLeft = CHARACTER_SPRITE_FACES_LEFT[id as CharacterId] ?? false;
  return facesLeft ? facing > 0 : facing < 0;
}

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
 * stretches non-square sources (e.g. a 512×384 cell) into
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
