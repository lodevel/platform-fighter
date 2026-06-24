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
  wolf:       150, // body 66, fill 0.44 → 66/0.44 = 150
  cat:        112, // body 65, fill 0.58 → 65/0.58 ≈ 112
  owl:        105, // body 68, fill 0.65 → ≈ 105
  bear:       130, // body 85, fill 0.65 → ≈ 130
  blaze:      110, // body 78, fill 0.71 → ≈ 110
  puff:        70, // body 56, fill 0.83 → ≈ 70  (round blob)
  aegis:       86, // body 76, fill 0.93 → ≈ 86
  volt:        58, // body 52, fill 0.90 → ≈ 58  (tiny chibi creature)
  nova:       100, // body 74, fill 0.74 → ≈ 100
  bruno:       80, // body 68, fill 0.86 → ≈ 80
  // AI-pack fighters (~0.96 fill fraction). display × 0.96 ≈ bodyHeight.
  link:        75, // body 72, fill 0.96 → 72/0.96 = 75
  kirby:       54, // body 52, fill 0.96 → ≈ 54
  donkeykong:  88, // body 84, fill 0.96 → ≈ 88
});

/**
 * Per-character base sprite facing — `true` when the source art is
 * drawn facing LEFT in its un-flipped frames, `false` when it faces
 * right.
 *
 * The original cast (wolf / cat / owl / bear) was authored facing
 * RIGHT, matching the engine's default facing of `+1`, so the renderer
 * historically flipped only when the fighter faced left
 * (`setFlipX(facing < 0)`). The post-M5 packs (Punk brawler, slime,
 * adventurer) are all drawn facing LEFT — without accounting for that
 * they ran backwards (sprite faced the opposite way from movement).
 * {@link shouldFlipSprite} folds this base direction into the flip so
 * every fighter visually faces the way it is moving regardless of how
 * its source art was drawn.
 */
export const CHARACTER_SPRITE_FACES_LEFT: Readonly<Record<CharacterId, boolean>> =
  Object.freeze({
    wolf: false,
    cat: false,
    owl: false,
    bear: false,
    // Blaze (Captain Falcon): the playtest reports it facing the WRONG way
    // in motion with `true`, so it's corrected to `false` (the art reads
    // right-facing in-engine, same default as wolf/cat/owl/bear) — flip
    // only when moving left. Trust the in-game report over the eyeballed
    // sheet inspection (this facing call has been wrong before).
    blaze: false,
    puff: true,
    aegis: true,
    // Post-batch-2 packs — VISUALLY INSPECTED each pack's clearest
    // directional frame (rendered upscaled, viewed directly):
    //   • Nova — the Shoot/run frames unambiguously face RIGHT: the
    //     arm-cannon and sunglasses lead to the RIGHT of the body.
    //   • Bruno — a near-symmetric front-3/4 hero with at most a faint
    //     RIGHT lean (leading hand raised on the right).
    //   • Volt — a fully front-facing chibi cat; flip is cosmetically
    //     symmetric, so the engine-default (right) is the safe choice.
    // Nova + Bruno read as right-facing art (Nova's idle unambiguously
    // aims the arm-cannon RIGHT) → flip when moving left, same default
    // as wolf/cat/owl/bear. Volt is a fully FRONT-facing chibi cat
    // (its idle looks straight at the camera, near-symmetric) — the
    // playtest reported it reading "wrong direction" in motion, so it
    // is flipped to `true`; on a symmetric front sprite this is
    // visually safe and corrects whatever subtle run-lean was reversed.
    volt: true,
    nova: false,
    bruno: false,
    // Link — first AI-generated pack. NOTE: the current v1 frames have
    // INCONSISTENT per-frame facing (some run frames face right, others left),
    // which no single flag can fix — it reads as "spinning" in motion. The
    // frames must be REGENERATED with an enforced single facing (canonical
    // right, like wolf/cat) before this flag is meaningful; until then `false`
    // is the intended end-state (flip only when moving left).
    link: false,
    // Kirby — AI sprite pack, generated with enforced right-facing (flip when
    // moving left), same default as the rest of the cast.
    kirby: false,
    // Donkey Kong — AI sprite pack, enforced right-facing (flip when moving left).
    donkeykong: false,
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
 * frames). 0 = already centred (the original cast + most packs). Only
 * sheets with a CONSISTENT off-centre get a non-zero value — a per-frame
 * walk-cycle wobble is normal animation, not a centring error.
 */
export const CHARACTER_SPRITE_ART_OFFSET_X: Readonly<Record<CharacterId, number>> =
  Object.freeze({
    wolf: 0,
    cat: 0,
    owl: 0,
    bear: 0,
    // Blaze's art sits ~0.23 of a frame LEFT of centre across every idle +
    // run frame (playtest: hurtbox read clearly off to the right).
    blaze: -0.23,
    // Puff's blob sits ~0.15 of a frame RIGHT of centre.
    puff: 0.15,
    aegis: 0,
    volt: 0,
    nova: 0,
    bruno: 0,
    link: 0, // procedural rectangle — centred by construction
    kirby: 0,
    donkeykong: 0,
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
 * cell's bottom edge (the original cast + most packs). Only sheets with a
 * CONSISTENT, noticeable gap get a non-zero value.
 */
export const CHARACTER_SPRITE_ART_OFFSET_Y: Readonly<Record<CharacterId, number>> =
  Object.freeze({
    wolf: 0,
    cat: 0,
    owl: 0,
    bear: 0,
    blaze: 0,
    puff: 0,
    // HD AI pack (256² cells): faint ground-shadow below the feet extends the
    // packed bbox ~15px past the real feet (measured on idle/shield). Seat them.
    aegis: 15 / 256,
    volt: 0,
    // Nova's idle/run cells leave ~14 of 96 px transparent below the feet, so
    // she floated ~15 px above the ground. 14 / 96 ≈ 0.146 seats her feet.
    nova: 14 / 96,
    bruno: 0,
    // HD pack (256² cells): faint ground-shadow below the feet extends the
    // packed bbox past the real feet. Polished-Smash restyle seats lower than
    // the old painterly pack — measured ~9px on idle (was 15). Seat the feet.
    link: 9 / 256,
    // HD re-pack (256² cells from original 1024 sources): same AI ground-shadow
    // below the feet. Measured gaps: Kirby ~12px, DK ~14px on idle/shield.
    kirby: 12 / 256,
    donkeykong: 14 / 256,
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
