/**
 * Per-character palette swap colour data — Sub-AC 2 of AC 13.
 *
 * AC 13 ("Same-character selection allowed with palette swap
 * differentiation") is split into two halves:
 *
 *   • Sub-AC 1 — the *selection logic* allows multiple slots to pick
 *     the same fighter (lives in `src/scenes/characterSelect.ts`).
 *
 *   • Sub-AC 2 — the *palette data itself*: per-character alternate
 *     colour sets so the selection logic can hand the renderer
 *     "Wolf-but-blue" or "Cat-but-pink" when two slots collide on the
 *     same character (this file).
 *
 * Together they fulfil the Seed contract:
 *
 *   "8 manual palette swaps per character via hue-shift batch script"
 *
 * — and the AC 13 promise that "up to 4 players" can pick the same
 * character without becoming visually indistinguishable. With 8
 * palettes per character, even a four-Wolf match has 4 palettes
 * spare for visual variety, and the auto-differentiation step (a
 * separate sub-AC) can pick distinct palette indices off this table.
 *
 * --------------------------------------------------------------------
 * Why a dedicated config file (and not a field on `CharacterSpec`)
 * --------------------------------------------------------------------
 *
 *   • Stays Phaser-free so unit tests load it under plain Node and the
 *     M-future asset pipeline can re-emit hue-shifted sprite atlases
 *     keyed off the same data without spinning up a renderer.
 *
 *   • Keeps `roster.ts` focused on the *playable* contract (stats,
 *     moves, placeholder geometry) — palette tables grow in lockstep
 *     with the M-future art pipeline; isolating them here means a hue
 *     re-balance never touches the gameplay/AI consumers of
 *     `CharacterSpec`.
 *
 *   • The `paletteIndex` field on `PlayerSlot` already references
 *     exactly this table by integer. Centralising the lookup in one
 *     module means the damage HUD, character-select swatches,
 *     in-match Fighter rendering, results-screen banner, and the
 *     (later AC) replay header all read one source of truth.
 *
 * --------------------------------------------------------------------
 * Determinism contract
 * --------------------------------------------------------------------
 *
 * Every palette is a frozen literal of integer 0xRRGGBB values. Loading
 * this module twice yields byte-identical structures; replays that
 * record `(characterId, paletteIndex)` reproduce exactly the same
 * colours on playback. There is no `Math.random()`, no wall-clock,
 * and no environment lookup anywhere in this file.
 *
 * --------------------------------------------------------------------
 * Schema invariants (locked down by the unit tests)
 * --------------------------------------------------------------------
 *
 *   1. Every character in the roster (Wolf / Cat / Owl / Bear) has
 *      exactly {@link PALETTES_PER_CHARACTER} = 8 palette entries.
 *   2. Palette `index` values are exhaustive over [0, 7] and listed
 *      in ascending order so `palettes[i].index === i`.
 *   3. Palette 0 is the "canonical" palette — its `primaryColor` and
 *      `accentColor` match the corresponding entry in
 *      `CharacterPlaceholderVisual` from `roster.ts` so existing
 *      consumers that never opted into the palette system get the
 *      same colours they always have when they default to
 *      `paletteIndex: 0`.
 *   4. Within one character's palette ladder, the eight `primaryColor`
 *      values are pairwise distinct so two slots on adjacent palette
 *      indices are visibly different on screen.
 *   5. Every colour value is an integer in [0x000000, 0xFFFFFF] —
 *      the Phaser `Rectangle` / `Text.setColor` consumers throw on
 *      out-of-range or floating-point values.
 *
 * Adding a new character (Owl/Bear get their full kit in M2) means
 * dropping a new `<NAME>_PALETTES` table here, wiring it into
 * `CHARACTER_PALETTES`, and the type system + tests will catch any
 * gap in the schema.
 */

import type { CharacterId } from '../types';
import type { CharacterPlaceholderVisual } from './roster';

// ---------------------------------------------------------------------------
// Public types & constants
// ---------------------------------------------------------------------------

/**
 * Number of palette swaps every character ships with. Mirrors the
 * `PALETTE_COUNT` constant in `src/scenes/characterSelect.ts` — both
 * derive from the Seed's "8 manual palette swaps per character" cap.
 *
 * Exposed as its own constant (rather than re-importing
 * `PALETTE_COUNT`) so this file stays free of dependencies on the
 * scene layer; `characterSelect.ts` is the consumer, `palettes.ts` is
 * the data, and the dependency arrow points one way.
 */
export const PALETTES_PER_CHARACTER = 8;

/**
 * One palette entry — a named colour set the renderer applies on top
 * of a character's placeholder visual.
 *
 *   • `index`        — 0..7. Mirrors `PlayerSlot.paletteIndex` and the
 *                      character-select cycler.
 *   • `displayName`  — short human-readable swatch label
 *                      ("Crimson", "Sky", "Mint", …) for the
 *                      character-select tooltip / accessibility readout.
 *   • `primaryColor` — body fill colour (0xRRGGBB integer). Drives the
 *                      `Phaser.GameObjects.Rectangle` body fill while
 *                      the placeholder is the active renderer; once
 *                      sprite atlases land, the M-future pipeline emits
 *                      a hue-shifted texture per palette and the
 *                      renderer switches to that.
 *   • `accentColor`  — outline / facing-arrow stroke (0xRRGGBB).
 *   • `labelColor`   — HUD percent label tint (0xRRGGBB). Defaults to
 *                      `accentColor` when omitted upstream — kept as a
 *                      separate field so a low-contrast accent colour
 *                      can pair with a brighter HUD label.
 */
export interface CharacterPalette {
  readonly index: number;
  readonly displayName: string;
  readonly primaryColor: number;
  readonly accentColor: number;
  readonly labelColor: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a frozen palette record. Centralised so future fields
 * (sprite atlas key, audio variant, …) can be added in one place
 * without rewriting every literal below.
 */
function palette(
  index: number,
  displayName: string,
  primaryColor: number,
  accentColor: number,
  labelColor: number = accentColor,
): CharacterPalette {
  return Object.freeze({
    index,
    displayName,
    primaryColor,
    accentColor,
    labelColor,
  });
}

// ---------------------------------------------------------------------------
// Per-character palette ladders
// ---------------------------------------------------------------------------

/**
 * Wolf palette ladder — bruiser red is canonical (palette 0); the
 * remaining seven are hue-shifted siblings sorted to maximise visual
 * spread between adjacent indices, so the M2 character-select cycler
 * reads as a rainbow rather than two near-identical reds in a row.
 *
 * Index 0 mirrors {@link WOLF_PLACEHOLDER} so existing consumers that
 * never read palette data still see the same fighter.
 */
export const WOLF_PALETTES: ReadonlyArray<CharacterPalette> = Object.freeze([
  // 0 — canonical wolf red (matches WOLF_PLACEHOLDER)
  palette(0, 'Crimson', 0xc24a4a, 0xffe0a0),
  // 1 — cool blue counterpart, the classic "P2" colour
  palette(1, 'Cobalt', 0x4a6ec2, 0xa0c8ff),
  // 2 — sun yellow, "P3" colour
  palette(2, 'Sunburst', 0xc2a44a, 0xfff5a0),
  // 3 — forest green, "P4" colour
  palette(3, 'Forest', 0x4ac26a, 0xb0ffb8),
  // 4 — royal purple
  palette(4, 'Royal', 0x8b4ac2, 0xd0a0ff),
  // 5 — blood orange / autumn
  palette(5, 'Ember', 0xc2784a, 0xffd6a0),
  // 6 — teal / cyan
  palette(6, 'Lagoon', 0x4ac2b8, 0xa0fff0),
  // 7 — magenta / pink
  palette(7, 'Rose', 0xc24a8a, 0xffa0d0),
]);

/**
 * Cat palette ladder — sky blue is canonical (palette 0); the
 * variants emphasise saturated jewel tones since Cat's silhouette is
 * smaller than Wolf's and washed-out hues read poorly on her ~72px
 * body. Index 7 ("Shadow") is the de-facto ninja stealth palette.
 */
export const CAT_PALETTES: ReadonlyArray<CharacterPalette> = Object.freeze([
  // 0 — canonical cat blue (matches CAT_PLACEHOLDER)
  palette(0, 'Sky', 0x4a8ec2, 0xa0d8ff),
  // 1 — magenta foil to the canonical blue
  palette(1, 'Fuchsia', 0xc24a8e, 0xffa0d8),
  // 2 — cool spring mint
  palette(2, 'Mint', 0x4ac28e, 0xa0ffd8),
  // 3 — warm lavender
  palette(3, 'Lavender', 0x8e4ac2, 0xd8a0ff),
  // 4 — coral / salmon
  palette(4, 'Coral', 0xc28e4a, 0xffd8a0),
  // 5 — neon lime
  palette(5, 'Lime', 0x8ec24a, 0xd8ffa0),
  // 6 — deep teal
  palette(6, 'Teal', 0x4ac2c2, 0xa0ffff),
  // 7 — ninja stealth: near-black body with silver accent
  palette(7, 'Shadow', 0x303040, 0xa0a0b0),
]);

/**
 * Owl palette ladder — muted indigo is canonical (palette 0); the
 * remaining variants lean into "mage robes" colour territory. Owl is
 * a placeholder-spec character in M1 (no moveset wired yet), but his
 * palette table is already populated so the character-select grid
 * doesn't have to special-case "no palettes" cells.
 */
export const OWL_PALETTES: ReadonlyArray<CharacterPalette> = Object.freeze([
  // 0 — canonical muted indigo (matches OWL_PLACEHOLDER)
  palette(0, 'Indigo', 0x6a5acd, 0xd4d0ff),
  // 1 — snowy / arctic
  palette(1, 'Snow', 0xeaeaf0, 0xffffff),
  // 2 — emerald druid
  palette(2, 'Emerald', 0x2e8a5a, 0xa8e8c0),
  // 3 — gilded gold
  palette(3, 'Gilded', 0xcd9a3a, 0xffeab0),
  // 4 — crimson sorcerer
  palette(4, 'Crimson', 0xb04a4a, 0xffd0d0),
  // 5 — aqua mage
  palette(5, 'Aqua', 0x3aa0cd, 0xb0e8ff),
  // 6 — plum / amethyst
  palette(6, 'Plum', 0x8a3a8a, 0xe8b0e8),
  // 7 — charcoal
  palette(7, 'Charcoal', 0x404048, 0xb0b0b8),
]);

/**
 * Bear palette ladder — earthy umber is canonical (palette 0); the
 * variants cover panda, polar, honey, and the canonical "P1..P4
 * tournament" hues so a four-Bear lineup reads cleanly. Bear is a
 * placeholder-spec character in M1; same reasoning as Owl applies.
 */
export const BEAR_PALETTES: ReadonlyArray<CharacterPalette> = Object.freeze([
  // 0 — canonical umber (matches BEAR_PLACEHOLDER)
  palette(0, 'Umber', 0x8b5a2b, 0xf3d6a8),
  // 1 — polar bear: near-white body with cream accent
  palette(1, 'Polar', 0xeaeaea, 0xfff0d0),
  // 2 — black bear: dark body with light accent
  palette(2, 'Onyx', 0x2a2a2a, 0xb0b0b0),
  // 3 — panda: medium grey with high-contrast accent
  palette(3, 'Panda', 0x404048, 0xf0f0f0),
  // 4 — honey / amber: warm ochre
  palette(4, 'Honey', 0xd9a04a, 0xfff0a0),
  // 5 — russet: red-brown
  palette(5, 'Russet', 0xa0552a, 0xffc0a0),
  // 6 — slate / blue-grey: tournament "P2"-equivalent
  palette(6, 'Slate', 0x556a85, 0xb0c8e0),
  // 7 — crimson / battle-scarred
  palette(7, 'Bloodied', 0xa03030, 0xffb0a0),
]);

/**
 * Blaze palette ladder — ember orange is canonical (palette 0, mirrors
 * {@link BLAZE_PLACEHOLDER}); the variants run the canonical
 * tournament-hue ladder so a four-Blaze lineup reads cleanly. Blaze
 * renders through the procedural placeholder pipeline (no sprite
 * atlas), so these colours ARE the fighter's whole on-screen identity.
 */
export const BLAZE_PALETTES: ReadonlyArray<CharacterPalette> = Object.freeze([
  // 0 — canonical ember orange (matches BLAZE_PLACEHOLDER)
  palette(0, 'Ember', 0xd9622b, 0xffe8c0),
  // 1 — cool blue counterpart, the classic "P2" colour
  palette(1, 'Cobalt', 0x2b62d9, 0xc0d8ff),
  // 2 — racing green
  palette(2, 'Circuit', 0x2bd962, 0xc0ffd8),
  // 3 — gold trim
  palette(3, 'Champion', 0xd9b22b, 0xfff4c0),
  // 4 — crimson
  palette(4, 'Scarlet', 0xd92b3b, 0xffc0c8),
  // 5 — violet
  palette(5, 'Nebula', 0x8b2bd9, 0xe4c0ff),
  // 6 — teal
  palette(6, 'Turbine', 0x2bc4d9, 0xc0f4ff),
  // 7 — blacked-out chassis with silver accent
  palette(7, 'Midnight', 0x303038, 0xb0b0c0),
]);

/**
 * Puff palette ladder — bubblegum pink is canonical (palette 0,
 * mirrors {@link PUFF_PLACEHOLDER}); the variants stay in soft pastel
 * territory because her round 56×56 silhouette reads best in light
 * hues. Index 7 ("Eclipse") is the high-contrast outlier.
 */
export const PUFF_PALETTES: ReadonlyArray<CharacterPalette> = Object.freeze([
  // 0 — canonical bubblegum pink (matches PUFF_PLACEHOLDER)
  palette(0, 'Bubblegum', 0xe88bb8, 0xfff0f8),
  // 1 — sky pastel
  palette(1, 'Daydream', 0x8bb8e8, 0xf0f8ff),
  // 2 — mint pastel
  palette(2, 'Spearmint', 0x8be8b8, 0xf0fff8),
  // 3 — butter yellow
  palette(3, 'Custard', 0xe8d88b, 0xfffce8),
  // 4 — lilac
  palette(4, 'Lilac', 0xb88be8, 0xf4ecff),
  // 5 — peach
  palette(5, 'Peach', 0xe8a88b, 0xfff0e8),
  // 6 — seafoam
  palette(6, 'Seafoam', 0x8be8e0, 0xecfffc),
  // 7 — deep plum with pink accent: the "asleep" colourway
  palette(7, 'Eclipse', 0x4a3050, 0xe0b0d0),
]);

/**
 * Aegis palette ladder — royal cobalt is canonical (palette 0, mirrors
 * {@link AEGIS_PLACEHOLDER}); the variants lean into heraldic
 * "knight's livery" colours so each swap reads as a different banner.
 */
export const AEGIS_PALETTES: ReadonlyArray<CharacterPalette> = Object.freeze([
  // 0 — canonical royal cobalt (matches AEGIS_PLACEHOLDER)
  palette(0, 'Royal', 0x4a55c2, 0xc8d0ff),
  // 1 — crimson banner
  palette(1, 'Vermilion', 0xc24a55, 0xffc8d0),
  // 2 — verdant banner
  palette(2, 'Verdant', 0x4ac255, 0xc8ffd0),
  // 3 — white-and-gold paladin
  palette(3, 'Paladin', 0xe8e8f0, 0xd9b23a),
  // 4 — regal violet
  palette(4, 'Amethyst', 0x8b4ac2, 0xe0c8ff),
  // 5 — burnished bronze
  palette(5, 'Bronze', 0xc2854a, 0xffe0c0),
  // 6 — glacial steel
  palette(6, 'Glacier', 0x4ab2c2, 0xc8f4ff),
  // 7 — blackened armour with silver accent
  palette(7, 'Oathbound', 0x383840, 0xb8b8c8),
]);

/**
 * Volt palette ladder — electric yellow is canonical (palette 0, mirrors
 * {@link VOLT_PLACEHOLDER}); the variants run the tournament-hue ladder
 * so a four-Volt lineup reads cleanly on his tiny silhouette.
 */
export const VOLT_PALETTES: ReadonlyArray<CharacterPalette> = Object.freeze([
  // 0 — canonical electric yellow (matches VOLT_PLACEHOLDER)
  palette(0, 'Voltage', 0xf2c20c, 0x3a3320, 0xfff0a0),
  // 1 — cool blue counterpart, the classic "P2" colour
  palette(1, 'Static', 0x2b8ed9, 0xc0e4ff),
  // 2 — racing green
  palette(2, 'Circuit', 0x2bd96a, 0xc0ffd0),
  // 3 — hot pink
  palette(3, 'Spark', 0xe84a9a, 0xffc0e0),
  // 4 — crimson
  palette(4, 'Scarlet', 0xd92b3b, 0xffc0c8),
  // 5 — violet
  palette(5, 'Plasma', 0x8b4ad9, 0xe0c0ff),
  // 6 — teal
  palette(6, 'Ozone', 0x2bc4c0, 0xc0fffa),
  // 7 — charcoal with amber accent (the "shadow bolt")
  palette(7, 'Blackout', 0x303028, 0xf2c20c),
]);

/**
 * Nova palette ladder — burnt orange is canonical (palette 0, mirrors
 * {@link NOVA_PLACEHOLDER}); the variants run the canonical power-suit
 * colourways (orange / fusion-blue / gravity-purple / dark-suit) so a
 * four-Nova lineup reads cleanly.
 */
export const NOVA_PALETTES: ReadonlyArray<CharacterPalette> = Object.freeze([
  // 0 — canonical burnt orange (matches NOVA_PLACEHOLDER)
  palette(0, 'Power Suit', 0xd96b2b, 0x3ad0c8, 0xc8fff4),
  // 1 — fusion blue
  palette(1, 'Fusion', 0x2b7ad9, 0xc0e0ff),
  // 2 — varia green
  palette(2, 'Varia', 0x4ab23a, 0xc8ffb8),
  // 3 — gravity purple
  palette(3, 'Gravity', 0x7a3ad9, 0xd8c0ff),
  // 4 — crimson
  palette(4, 'Phazon', 0xc23a3a, 0xffc8c8),
  // 5 — gold trim
  palette(5, 'Gold', 0xd9a82b, 0xfff0b0),
  // 6 — glacial cyan
  palette(6, 'Glacier', 0x3ab2c2, 0xc8f4ff),
  // 7 — dark suit with red accent
  palette(7, 'Dark Suit', 0x303038, 0xd96b2b),
]);

/**
 * Bruno palette ladder — fire red is canonical (palette 0, mirrors
 * {@link BRUNO_PLACEHOLDER}); the variants run the "overalls hero"
 * colourways (red / green-brother / blue / fire-flower white) so the
 * char-select grid reads as the canonical four-player set.
 */
export const BRUNO_PALETTES: ReadonlyArray<CharacterPalette> = Object.freeze([
  // 0 — canonical fire red (matches BRUNO_PLACEHOLDER)
  palette(0, 'Classic', 0xd6342b, 0xfff0f0),
  // 1 — green brother
  palette(1, 'Sibling', 0x2ba84a, 0xd0ffd8),
  // 2 — cool blue
  palette(2, 'Cobalt', 0x2b62d9, 0xc0d8ff),
  // 3 — fire flower white-and-red
  palette(3, 'Fire Flower', 0xeaeaea, 0xd6342b),
  // 4 — wario yellow-and-purple
  palette(4, 'Sunny', 0xe8c22b, 0x7a3a8a),
  // 5 — autumn orange
  palette(5, 'Pumpkin', 0xd97a2b, 0xffd8b0),
  // 6 — teal plumber
  palette(6, 'Aqua', 0x2bc4b8, 0xc0fff4),
  // 7 — shadow black with red accent
  palette(7, 'Shadow', 0x2a2a30, 0xd6342b),
]);

/**
 * Link palette ladder — hero green is canonical (palette 0, mirrors
 * {@link LINK_PLACEHOLDER}); the variants run the canonical tunic
 * colourways (green / blue / red / dark) so a four-Link lineup reads
 * cleanly on his procedural rectangle.
 */
export const LINK_PALETTES: ReadonlyArray<CharacterPalette> = Object.freeze([
  // 0 — canonical hero green (matches LINK_PLACEHOLDER)
  palette(0, 'Hero', 0x4a9e3a, 0xf0e8c0),
  // 1 — cool blue (Zora tunic)
  palette(1, 'Zora', 0x2b7ad9, 0xc0e4ff),
  // 2 — crimson (Goron tunic)
  palette(2, 'Goron', 0xc23a3a, 0xffc8c8),
  // 3 — royal purple
  palette(3, 'Twilight', 0x7a3ad9, 0xd8c0ff),
  // 4 — gilded gold
  palette(4, 'Triforce', 0xd9a82b, 0xfff0b0),
  // 5 — teal
  palette(5, 'Lagoon', 0x2bc4b8, 0xc0fff4),
  // 6 — rose / pink
  palette(6, 'Fairy', 0xd64a8a, 0xffc0e0),
  // 7 — dark tunic with silver accent (the "Fierce Deity" outlier)
  palette(7, 'Fierce', 0x303038, 0xc0c0d0),
]);

/**
 * Kirby palette ladder — bubble pink is canonical (palette 0, mirrors
 * {@link KIRBY_PLACEHOLDER}); the variants run the canonical copy-ability
 * colourways (pink / yellow / blue / green) so a four-Kirby lineup reads
 * cleanly on his round procedural rectangle.
 */
export const KIRBY_PALETTES: ReadonlyArray<CharacterPalette> = Object.freeze([
  // 0 — canonical bubble pink (matches KIRBY_PLACEHOLDER)
  palette(0, 'Bubble', 0xe87aa8, 0xfff0f6),
  // 1 — sunshine yellow (the classic alt)
  palette(1, 'Keeby', 0xe8c22b, 0xfff4c0),
  // 2 — cool blue
  palette(2, 'Cobalt', 0x2b7ad9, 0xc0e4ff),
  // 3 — spring green
  palette(3, 'Sprout', 0x4ac26a, 0xc8ffd0),
  // 4 — royal purple
  palette(4, 'Royal', 0x8b4ac2, 0xe0c8ff),
  // 5 — coral / salmon
  palette(5, 'Coral', 0xe8a04a, 0xffe0c0),
  // 6 — teal
  palette(6, 'Maxim', 0x2bc4b8, 0xc0fff4),
  // 7 — shadow grey with red accent (the "dark matter" outlier)
  palette(7, 'Shadow', 0x303038, 0xd64a6a),
]);

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Lookup record from `CharacterId` to that character's palette ladder.
 * Exhaustive over the `CharacterId` union — adding a new id will fail
 * to compile until a matching palette table is added here, by design.
 *
 * Frozen so accidental writes throw under strict mode and the replay
 * snapshot system can hash this structure without worrying that a
 * later mutation has invalidated the digest.
 */
export const CHARACTER_PALETTES: Readonly<
  Record<CharacterId, ReadonlyArray<CharacterPalette>>
> = Object.freeze({
  wolf: WOLF_PALETTES,
  cat: CAT_PALETTES,
  owl: OWL_PALETTES,
  bear: BEAR_PALETTES,
  blaze: BLAZE_PALETTES,
  puff: PUFF_PALETTES,
  aegis: AEGIS_PALETTES,
  volt: VOLT_PALETTES,
  nova: NOVA_PALETTES,
  bruno: BRUNO_PALETTES,
  link: LINK_PALETTES,
  kirby: KIRBY_PALETTES,
});

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/**
 * Look up a single palette entry by `(characterId, paletteIndex)`.
 *
 * Wraps `paletteIndex` modulo {@link PALETTES_PER_CHARACTER} so a
 * caller that increments past the last palette lands on 0 and a
 * negative / non-finite index normalises to 0. This mirrors the
 * `wrapPaletteIndex` helper inside `characterSelect.ts` so the lobby
 * cycler and the in-match renderer agree on what palette 8 means.
 *
 * Determinism: pure function of `(id, index)`. Two calls with the
 * same arguments always return the same frozen palette object.
 */
export function getCharacterPalette(
  id: CharacterId,
  paletteIndex: number,
): CharacterPalette {
  const ladder = CHARACTER_PALETTES[id];
  const wrapped = wrapPaletteIndex(paletteIndex);
  // `ladder` is exhaustive (validated at module load by the unit
  // tests) so this index is always in range — but
  // `noUncheckedIndexedAccess` requires us to handle the
  // `undefined` shape. Falling back to ladder[0] preserves the
  // "always returns a palette" contract even if a future schema
  // bug ships a short ladder.
  return ladder[wrapped] ?? ladder[0]!;
}

/**
 * Read a character's full palette ladder. Frozen, length = 8, ordered
 * by `index` ascending. Useful for the character-select swatch grid
 * and the (later) replay header that wants to render a thumbnail of
 * every palette without iterating per-id.
 */
export function getCharacterPalettes(
  id: CharacterId,
): ReadonlyArray<CharacterPalette> {
  return CHARACTER_PALETTES[id];
}

/**
 * Apply a palette to a character's `CharacterPlaceholderVisual`,
 * producing a new placeholder with the palette's `primaryColor`,
 * `accentColor`, and `labelColor` substituted in. Geometry
 * (`width`, `height`) and the `spriteKey` carry through unchanged.
 *
 * Used by the M2 in-match Fighter renderer to project
 * `(characterId, paletteIndex)` onto the rectangle it paints, and by
 * the character-select preview tile so what the player sees in the
 * lobby matches what spawns into the match.
 *
 * Pure / deterministic — does not mutate the input. Returns a frozen
 * object so consumers can pass it straight to a `useMemo`-style cache.
 */
export function applyPaletteToPlaceholder(
  placeholder: CharacterPlaceholderVisual,
  palette: CharacterPalette,
): CharacterPlaceholderVisual {
  return Object.freeze({
    primaryColor: palette.primaryColor,
    accentColor: palette.accentColor,
    labelColor: palette.labelColor,
    width: placeholder.width,
    height: placeholder.height,
    spriteKey: placeholder.spriteKey,
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Wrap a palette index into [0, PALETTES_PER_CHARACTER). Mirrors the
 * private `wrapPaletteIndex` helper inside `characterSelect.ts` so
 * the cycler and the renderer agree on out-of-range values.
 *
 * Negative or non-finite inputs normalise to 0 so a malformed
 * `paletteIndex` (e.g. a stale replay JSON) never crashes the
 * renderer.
 */
function wrapPaletteIndex(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const i = Math.trunc(raw);
  return ((i % PALETTES_PER_CHARACTER) + PALETTES_PER_CHARACTER) %
    PALETTES_PER_CHARACTER;
}
