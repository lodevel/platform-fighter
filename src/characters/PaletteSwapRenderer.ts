/**
 * Runtime palette swap rendering — Sub-AC 3 of AC 13.
 *
 * AC 13 ("Same-character selection allowed with palette swap
 * differentiation") splits into three slices:
 *
 *   • Sub-AC 1 — character-select *logic* allows duplicates
 *     (`scenes/characterSelect.ts`).
 *   • Sub-AC 2 — palette colour *data* in a config table
 *     (`characters/palettes.ts`).
 *   • Sub-AC 3 — runtime palette swap *rendering* applied to the live
 *     fighter visuals each match (this file).
 *
 * Together they fulfil the Seed promise: up to 4 players can pick the
 * same character without becoming visually indistinguishable on stage.
 * Sub-AC 1 made it possible to pick "four Wolves"; Sub-AC 2 made eight
 * distinct colour sets exist; this Sub-AC actually paints the right
 * one onto each fighter's body so the screen reads the four lineup
 * positions at a glance.
 *
 * --------------------------------------------------------------------
 * Why a dedicated module (not inline in MatchScene)
 * --------------------------------------------------------------------
 *
 *   1. **Single source of truth** — exactly one place computes "given
 *      this PlayerSlot, what colours should the fighter render?" The
 *      MatchScene's body rectangle, the facing-arrow triangle, the
 *      damage HUD label, the post-match results banner, and (later
 *      AC) the character-select preview tile all read from the same
 *      pipeline. A palette tweak in `palettes.ts` ripples through the
 *      whole game without grepping for hex literals.
 *
 *   2. **Phaser-free reasoning, Phaser-touching application** — the
 *      `resolvePaletteSwap()` function below is a pure deterministic
 *      lookup against `palettes.ts` and runs unmodified under plain
 *      Node. The `applyPaletteSwap()` paint helper takes a structural
 *      shape (anything with `setFillStyle` / `setStrokeStyle` /
 *      `setTint`), so the unit tests drive it with a hand-rolled mock
 *      and the live scene drives it with real Phaser GameObjects —
 *      identical contract.
 *
 *   3. **Stable hand-off for the M-future sprite atlas** — once real
 *      sprite textures land, the pipeline becomes "load atlas keyed by
 *      palette.spriteKey, fall back to tint when sprite missing." The
 *      caller still hands an `applyPaletteSwap` target; we just route
 *      the colour through `setTint` on the sprite instead of (or in
 *      addition to) `setFillStyle` on the placeholder rectangle. The
 *      callers don't change.
 *
 * --------------------------------------------------------------------
 * Determinism contract
 * --------------------------------------------------------------------
 *
 * Pure / Phaser-free portions of this module (`resolvePaletteSwap`,
 * `paletteSwapForSlot`, `paletteSwapEqual`) read frozen palette
 * literals from `palettes.ts` and produce deterministic outputs — the
 * same `(characterId, paletteIndex)` tuple always yields the same
 * colour record, byte-for-byte. The Phaser-touching `applyPaletteSwap`
 * is render-only and never feeds back into the simulation, so
 * replaying a match with identical inputs produces identical visuals
 * on every machine.
 *
 * --------------------------------------------------------------------
 * What this module deliberately does NOT do
 * --------------------------------------------------------------------
 *
 *   • Pick a palette automatically when two slots collide on the same
 *     character (auto-differentiation). That's a separate selection-
 *     time concern handled in `characterSelect.ts` — by the time a
 *     `PlayerSlot` reaches the renderer, the `paletteIndex` is already
 *     final.
 *
 *   • Animate / tween between palettes. A respawn keeps the palette
 *     fixed; if a future feature wants a "palette flicker" effect, it
 *     can wrap `applyPaletteSwap` with a tween — this module just
 *     applies a single instantaneous swap.
 *
 *   • Manage HUD label colours. The damage HUD owns its own per-slot
 *     `labelColor` config; consumers wire `paletteSwap.labelColor`
 *     into that config at construction time. We expose the colour
 *     value but don't reach into the HUD ourselves.
 */

import type { PlayerSlot } from '../types';
import { getCharacterPalette } from './palettes';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The colours one fighter should paint with this match. A pure
 * projection of `(characterId, paletteIndex)` onto the four colour
 * slots that drive the placeholder rectangle, the facing arrow, the
 * HUD label, and the (future) sprite tint.
 *
 * Frozen so accidental writes throw under strict mode and so the
 * replay snapshot system can hash the record without worrying about
 * mutation. Two `PaletteSwap` records compare with `paletteSwapEqual`.
 */
export interface PaletteSwap {
  /** Source slot index (1..4) — useful for tracing back to the player. */
  readonly playerIndex: 1 | 2 | 3 | 4;
  /** Source character id — mirror of `PlayerSlot.characterId`. */
  readonly characterId: PlayerSlot['characterId'];
  /** Resolved palette index (0..7), already wrapped from any raw input. */
  readonly paletteIndex: number;
  /** Body fill colour (0xRRGGBB integer). */
  readonly primaryColor: number;
  /** Outline / facing-arrow colour (0xRRGGBB integer). */
  readonly accentColor: number;
  /** HUD label / banner-tint colour (0xRRGGBB integer). */
  readonly labelColor: number;
  /** Display name of the palette ("Crimson", "Mint", …) — for accessibility readouts. */
  readonly displayName: string;
}

/**
 * Structural shape of a Phaser-renderable target the swap can paint.
 * The fields mirror the subset of `Phaser.GameObjects.Rectangle` /
 * `Phaser.GameObjects.Triangle` / `Phaser.GameObjects.Sprite` we
 * actually use, so a single helper handles all three target types.
 *
 * Every field is optional — a sprite-only target needs only `setTint`,
 * while a placeholder rectangle wants `setFillStyle` + `setStrokeStyle`.
 * `applyPaletteSwap` calls whichever methods are present and skips the
 * others, so callers don't have to special-case their object type.
 */
export interface PaletteSwapTarget {
  /** Phaser Rectangle / Triangle have this; Sprites do not. */
  setFillStyle?(color: number, alpha?: number): unknown;
  /** Phaser Rectangle / Triangle have this; Sprites do not. */
  setStrokeStyle?(lineWidth: number, color: number, alpha?: number): unknown;
  /** Phaser Sprite (and any tinted Image) has this; Shape objects do not. */
  setTint?(color: number): unknown;
  /**
   * Optional: clear the tint before applying a new one. Sprites
   * sometimes inherit a tint from a previous match; clearing first
   * ensures the new palette wins. No-op when missing.
   */
  clearTint?(): unknown;
}

/**
 * Per-fighter render targets. Optional fields so a caller can paint
 * just the body, just the sprite, or any combination. Driving all
 * targets through a single struct lets the call site pass one record
 * and have the helper paint everything in one pass.
 */
export interface FighterPaletteTargets {
  /**
   * Primary body — `Phaser.GameObjects.Rectangle` for the placeholder,
   * later a `Phaser.GameObjects.Sprite` once atlases land. The
   * `primaryColor` is applied via `setFillStyle` (rect) and
   * `setTint` (sprite); `accentColor` is applied via `setStrokeStyle`
   * (rect only — sprites inherit the outline from the texture).
   */
  readonly body?: PaletteSwapTarget;
  /**
   * Facing-direction arrow / pip. Painted with the `accentColor` so it
   * reads as "this side of me is forward" without competing with the
   * body fill.
   */
  readonly facingMark?: PaletteSwapTarget;
  /**
   * Optional auxiliary sprite (e.g. a shadow blob, weapon overlay).
   * Tinted with `primaryColor` like the body but skipped if absent.
   */
  readonly auxSprite?: PaletteSwapTarget;
}

// ---------------------------------------------------------------------------
// Pure helpers — Phaser-free, deterministic
// ---------------------------------------------------------------------------

/**
 * Build a `PaletteSwap` record from a `PlayerSlot`. Pure function of
 * the slot's `(characterId, paletteIndex)` — the same slot always
 * resolves to the same colours.
 *
 * Out-of-range / negative / non-finite `paletteIndex` is wrapped
 * modulo `PALETTES_PER_CHARACTER` (8) by the underlying
 * {@link getCharacterPalette} helper, so a malformed slot still
 * produces a valid swap rather than crashing the render hook.
 *
 * Why this returns its own record (not the raw `CharacterPalette`):
 *   • The renderer wants `playerIndex` + `characterId` echoed back so
 *     a debug overlay or a (later AC) replay header can show "Slot 3
 *     Wolf — Cobalt" without re-deriving the slot identity from a
 *     side-table.
 *   • A future Sub-AC may add slot-specific overlays (e.g. a P3 number
 *     badge in the accent colour) that need both the palette and the
 *     slot index in one record.
 */
export function resolvePaletteSwap(slot: {
  readonly index: 1 | 2 | 3 | 4;
  readonly characterId: PlayerSlot['characterId'];
  readonly paletteIndex: number;
}): PaletteSwap {
  const palette = getCharacterPalette(slot.characterId, slot.paletteIndex);
  return Object.freeze({
    playerIndex: slot.index,
    characterId: slot.characterId,
    paletteIndex: palette.index,
    primaryColor: palette.primaryColor,
    accentColor: palette.accentColor,
    labelColor: palette.labelColor,
    displayName: palette.displayName,
  });
}

/**
 * Convenience overload that accepts a full `PlayerSlot` (post-match-
 * config) directly. Equivalent to {@link resolvePaletteSwap} but
 * stronger-typed at the call site so a `MatchConfig.players` iteration
 * doesn't have to destructure first.
 */
export function paletteSwapForSlot(slot: PlayerSlot): PaletteSwap {
  return resolvePaletteSwap({
    index: slot.index,
    characterId: slot.characterId,
    paletteIndex: slot.paletteIndex,
  });
}

/**
 * Resolve a `PaletteSwap` directly from a `(playerIndex, characterId,
 * paletteIndex)` tuple. Used by the M1 scaffold paths in
 * `MatchScene.ts` that build slots inline before any `PlayerSlot[]`
 * exists, and by tests that want to spot-check a single colour swap
 * without constructing a slot wrapper.
 */
export function paletteSwapForCharacter(
  playerIndex: 1 | 2 | 3 | 4,
  characterId: PlayerSlot['characterId'],
  paletteIndex: number,
): PaletteSwap {
  return resolvePaletteSwap({ index: playerIndex, characterId, paletteIndex });
}

/**
 * Structural equality on two `PaletteSwap` records. Exposed so the
 * MatchScene's render hook can short-circuit a re-paint when nothing
 * has changed since the last frame — palettes are immutable for the
 * match's duration, so the compare is `true` 99 % of frames and the
 * helper avoids paying for `setFillStyle` calls that don't move the
 * needle.
 */
export function paletteSwapEqual(
  a: PaletteSwap,
  b: PaletteSwap,
): boolean {
  return (
    a.playerIndex === b.playerIndex &&
    a.characterId === b.characterId &&
    a.paletteIndex === b.paletteIndex &&
    a.primaryColor === b.primaryColor &&
    a.accentColor === b.accentColor &&
    a.labelColor === b.labelColor &&
    a.displayName === b.displayName
  );
}

// ---------------------------------------------------------------------------
// Phaser paint helpers
// ---------------------------------------------------------------------------

/**
 * Default stroke width applied via `setStrokeStyle`. Mirrors the
 * existing MatchScene literal so this Sub-AC drops in without
 * changing the visual weight of the outline.
 */
export const DEFAULT_PALETTE_STROKE_WIDTH = 2;

/**
 * Optional knobs for {@link applyPaletteSwap}. Defaults match the
 * existing `MatchScene` body / arrow look; callers override when a
 * different visual context (results screen, char-select preview) wants
 * a softer alpha or a thicker stroke.
 */
export interface ApplyPaletteSwapOptions {
  /** Body fill alpha (0..1). Default `1` — opaque. */
  readonly bodyFillAlpha?: number;
  /** Body stroke alpha (0..1). Default `1`. */
  readonly bodyStrokeAlpha?: number;
  /** Stroke width in pixels. Default {@link DEFAULT_PALETTE_STROKE_WIDTH}. */
  readonly strokeWidth?: number;
  /**
   * If `true`, call `clearTint()` on every target that supports it
   * before applying the new tint. Useful when a target may have
   * inherited a tint from a previous palette (e.g. a sprite atlas
   * shared across matches). Default `true` so the swap is always
   * authoritative.
   */
  readonly clearExistingTint?: boolean;
}

/**
 * Paint one fighter's render targets with a palette swap.
 *
 * The body's fill becomes `swap.primaryColor`, its stroke becomes
 * `swap.accentColor`, and any tintable target (sprite) takes
 * `primaryColor` as its tint. The facing mark's fill / tint is the
 * `accentColor` so the arrow reads as a forward-pointing accent
 * instead of a duplicate of the body. An optional `auxSprite` (e.g. a
 * weapon overlay) follows the body's `primaryColor` tint for
 * consistency.
 *
 * Method dispatch is structural — we call `setFillStyle` on whichever
 * targets expose it (rectangles, triangles), `setStrokeStyle` on the
 * same set, and `setTint` on whatever exposes that (sprites, images).
 * Targets that lack a method are silently skipped so the same call
 * works for the M1 placeholder rectangle pipeline AND the M-future
 * sprite-atlas pipeline without the caller having to branch.
 *
 * Idempotent: calling twice with the same swap produces the same
 * pixels (Phaser's setters are themselves idempotent on equal inputs).
 *
 * Returns the count of paint operations performed — useful for tests
 * that want to assert "X fillStyle + Y strokeStyle + Z tint calls",
 * and for a debug HUD that surfaces how many objects the swap touched.
 */
export function applyPaletteSwap(
  targets: FighterPaletteTargets,
  swap: PaletteSwap,
  options: ApplyPaletteSwapOptions = {},
): { fills: number; strokes: number; tints: number } {
  const fillAlpha = options.bodyFillAlpha ?? 1;
  const strokeAlpha = options.bodyStrokeAlpha ?? 1;
  const strokeWidth = options.strokeWidth ?? DEFAULT_PALETTE_STROKE_WIDTH;
  const clearExistingTint = options.clearExistingTint ?? true;

  let fills = 0;
  let strokes = 0;
  let tints = 0;

  // ---- Body — primary colour ------------------------------------------
  if (targets.body) {
    if (clearExistingTint && typeof targets.body.clearTint === 'function') {
      targets.body.clearTint();
    }
    if (typeof targets.body.setFillStyle === 'function') {
      targets.body.setFillStyle(swap.primaryColor, fillAlpha);
      fills += 1;
    }
    if (typeof targets.body.setStrokeStyle === 'function') {
      targets.body.setStrokeStyle(strokeWidth, swap.accentColor, strokeAlpha);
      strokes += 1;
    }
    if (typeof targets.body.setTint === 'function') {
      targets.body.setTint(swap.primaryColor);
      tints += 1;
    }
  }

  // ---- Facing mark — accent colour ------------------------------------
  if (targets.facingMark) {
    if (clearExistingTint && typeof targets.facingMark.clearTint === 'function') {
      targets.facingMark.clearTint();
    }
    if (typeof targets.facingMark.setFillStyle === 'function') {
      targets.facingMark.setFillStyle(swap.accentColor, fillAlpha);
      fills += 1;
    }
    if (typeof targets.facingMark.setTint === 'function') {
      targets.facingMark.setTint(swap.accentColor);
      tints += 1;
    }
  }

  // ---- Aux sprite — primary colour tint -------------------------------
  if (targets.auxSprite) {
    if (clearExistingTint && typeof targets.auxSprite.clearTint === 'function') {
      targets.auxSprite.clearTint();
    }
    if (typeof targets.auxSprite.setTint === 'function') {
      targets.auxSprite.setTint(swap.primaryColor);
      tints += 1;
    }
    if (typeof targets.auxSprite.setFillStyle === 'function') {
      targets.auxSprite.setFillStyle(swap.primaryColor, fillAlpha);
      fills += 1;
    }
  }

  return { fills, strokes, tints };
}

/**
 * Convert a `PaletteSwap` colour integer into the `'#rrggbb'` hex
 * string Phaser's text-style configs expect. Used by the damage HUD
 * label, the post-match results banner, and any other text node that
 * wants to colour-match the slot's accent without owning a separate
 * colour map.
 *
 * Pure / deterministic — every integer in [0, 0xFFFFFF] produces a
 * 7-character lowercase hex string starting with `'#'`.
 */
export function paletteColorToCss(color: number): string {
  // Floor + clamp to the legal 24-bit range so a malformed colour
  // (negative, > 0xFFFFFF, non-integer) still produces a parseable hex
  // string instead of crashing Phaser's CSS parser.
  const clamped = Math.max(0, Math.min(0xffffff, Math.floor(color)));
  return `#${clamped.toString(16).padStart(6, '0')}`;
}
