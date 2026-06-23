/**
 * Central asset manifest — single source of truth for every static
 * asset shipped with the game.
 *
 * Why this module exists
 * ----------------------
 * Prior to AC 10101 Sub-AC 1, asset keys and file paths were repeated
 * inline at the call site (PreloadScene, MatchScene's stage renderer,
 * the audio mixer). That made renames brittle and hid duplicate keys
 * behind silent texture-cache collisions.
 *
 * This module fixes that by exporting:
 *
 *   • {@link ASSET_KEYS} — frozen `as const` catalogue of every Phaser
 *     cache key the game ever asks for (textures, atlases, spritesheets,
 *     audio). Downstream code imports this object instead of hard-coding
 *     strings, so a typo becomes a TS compile error.
 *
 *   • {@link ASSET_MANIFEST} — the loader-ready descriptor: each entry
 *     carries the cache key, the public file URL, the Phaser loader
 *     method to call, and any per-loader metadata (frame size, JSON
 *     companion path). PreloadScene walks this list once and is done.
 *
 * Path convention
 * ---------------
 * Vite mounts `assets/` as `publicDir` (see `vite.config.ts`), so every
 * file in `assets/` is served at the root. We therefore reference assets
 * as `'/<sub-path>'` rather than `'assets/<sub-path>'` — this is the URL
 * Phaser's `load.*` calls receive in the browser.
 *
 * Determinism note
 * ----------------
 * Asset *load order* affects nothing the gameplay simulation depends on
 * (the sim runs off the deterministic match RNG, not the loader), but
 * cache *key collisions* would corrupt the texture cache and could cause
 * an animation frame to silently render the wrong sprite. Hence the
 * unit test that asserts every key in {@link ASSET_KEYS} is unique.
 */

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

/**
 * Namespaced kind tag used by the PreloadScene loader dispatch.
 *
 * - `image`       → single still image (Phaser `load.image`).
 * - `spritesheet` → uniform-grid frame strip (Phaser `load.spritesheet`).
 * - `atlas`       → texture atlas with companion JSON (Phaser `load.atlas`).
 * - `audio`       → short SFX clip (Phaser `load.audio`).
 * - `music`       → looping background track (Phaser `load.audio`).
 *                   Tagged separately so the audio mixer can mute / duck
 *                   music independently of one-shot SFX.
 */
export type AssetKind = 'image' | 'spritesheet' | 'atlas' | 'audio' | 'music';

/** Common fields shared by every manifest entry. */
interface AssetEntryBase {
  /** Phaser cache key consumers read with e.g. `this.add.image(_, _, key)`. */
  readonly key: string;
  /** Loader-method discriminant. */
  readonly kind: AssetKind;
}

/** Single image (e.g. a stage backdrop). */
export interface ImageAssetEntry extends AssetEntryBase {
  readonly kind: 'image';
  /** Public URL — pass directly to Phaser's `load.image(key, url)`. */
  readonly url: string;
}

/** Uniform-grid frame strip (animation stripe). */
export interface SpritesheetAssetEntry extends AssetEntryBase {
  readonly kind: 'spritesheet';
  readonly url: string;
  /** Frame width in pixels (used by `load.spritesheet` config). */
  readonly frameWidth: number;
  /** Frame height in pixels. */
  readonly frameHeight: number;
  /** Total frame count — used by tests + downstream animation builders. */
  readonly frameCount: number;
  /** Optional spacing/margin for atlases that ship with a 1px gutter. */
  readonly margin?: number;
  readonly spacing?: number;
}

/** Texture atlas (image + JSON companion). */
export interface AtlasAssetEntry extends AssetEntryBase {
  readonly kind: 'atlas';
  /** Public URL of the atlas image. */
  readonly textureUrl: string;
  /** Public URL of the JSON descriptor (Phaser-Hash or array layout). */
  readonly jsonUrl: string;
}

/** Audio cue — SFX or music, distinguished by {@link AssetKind}. */
export interface AudioAssetEntry extends AssetEntryBase {
  readonly kind: 'audio' | 'music';
  /**
   * One or more URLs in fallback order. We currently ship `.ogg` only
   * (Chrome desktop is the v1 target and has native Vorbis support),
   * but the type accepts an array so M2 can drop in `.mp3` for
   * Safari/iOS without a manifest re-shape.
   */
  readonly urls: readonly string[];
}

/** Sum type covering every manifest entry shape. */
export type AssetEntry =
  | ImageAssetEntry
  | SpritesheetAssetEntry
  | AtlasAssetEntry
  | AudioAssetEntry;

/** Top-level manifest, grouped by loader category for ergonomic iteration. */
export interface AssetManifest {
  readonly images: readonly ImageAssetEntry[];
  readonly spritesheets: readonly SpritesheetAssetEntry[];
  readonly atlases: readonly AtlasAssetEntry[];
  readonly audio: readonly AudioAssetEntry[];
  readonly music: readonly AudioAssetEntry[];
}

// ---------------------------------------------------------------------
// Cache keys
// ---------------------------------------------------------------------

/**
 * Every Phaser cache key the runtime ever asks for. Namespaced with a
 * `category.subject.variant` shape so a string match in the texture
 * cache is unambiguous and so future palette-swap variants slot in
 * naturally (e.g. `'char.cat.idle.palette3'`).
 *
 * Boot-generated procedural textures live in
 * `src/scenes/bootKeys.ts` under the `tex.boot.*` namespace and are
 * intentionally NOT duplicated here — keeping the boot keys distinct
 * from loaded-asset keys means a missing manifest entry is loud at
 * preload time instead of silently aliasing the boot pixel.
 */
export const ASSET_KEYS = {
  // ---------------- characters: cat ----------------------------------
  charCatIdle: 'char.cat.idle',
  charCatRun: 'char.cat.run',
  charCatJump: 'char.cat.jump',
  charCatAttack: 'char.cat.attack',

  // ---------------- characters: wolf ---------------------------------
  charWolfIdle: 'char.wolf.idle',
  charWolfRun: 'char.wolf.run',
  charWolfJump: 'char.wolf.jump',
  charWolfAttack: 'char.wolf.attack',

  // ---------------- characters: owl ----------------------------------
  charOwlIdle: 'char.owl.idle',
  charOwlRun: 'char.owl.run',
  charOwlJump: 'char.owl.jump',
  charOwlAttack: 'char.owl.attack',

  // ---------------- characters: bear ---------------------------------
  charBearIdle: 'char.bear.idle',
  charBearRun: 'char.bear.run',
  charBearJump: 'char.bear.jump',
  charBearAttack: 'char.bear.attack',

  // ---------------- characters: blaze --------------------------------
  charBlazeIdle: 'char.blaze.idle',
  charBlazeRun: 'char.blaze.run',
  charBlazeJump: 'char.blaze.jump',
  charBlazeAttack: 'char.blaze.attack',

  // ---------------- characters: puff ---------------------------------
  charPuffIdle: 'char.puff.idle',
  charPuffRun: 'char.puff.run',
  charPuffJump: 'char.puff.jump',
  charPuffAttack: 'char.puff.attack',

  // ---------------- characters: aegis --------------------------------
  charAegisIdle: 'char.aegis.idle',
  charAegisRun: 'char.aegis.run',
  charAegisJump: 'char.aegis.jump',
  charAegisAttack: 'char.aegis.attack',

  // ---------------- characters: volt ---------------------------------
  charVoltIdle: 'char.volt.idle',
  charVoltRun: 'char.volt.run',
  charVoltJump: 'char.volt.jump',
  charVoltAttack: 'char.volt.attack',

  // ---------------- characters: nova ---------------------------------
  charNovaIdle: 'char.nova.idle',
  charNovaRun: 'char.nova.run',
  charNovaJump: 'char.nova.jump',
  charNovaAttack: 'char.nova.attack',

  // ---------------- characters: bruno --------------------------------
  charBrunoIdle: 'char.bruno.idle',
  charBrunoRun: 'char.bruno.run',
  charBrunoJump: 'char.bruno.jump',
  charBrunoAttack: 'char.bruno.attack',

  // ---------------- characters: link ---------------------------------
  // First AI-generated sprite pack (Z-Image ControlNet pose-source pipeline,
  // see docs/ART-PIPELINE.md). 65×64 cells; attack is the collapsed sheet.
  charLinkIdle: 'char.link.idle',
  charLinkRun: 'char.link.run',
  charLinkJump: 'char.link.jump',
  charLinkAttack: 'char.link.attack',
  // Full per-move animation set + ducking (the renderer plays char.link.<move>.anim
  // by the active move; crouch replaces the procedural squash). Each move is its own
  // clip with a mechanically-correct pose (ranged specials are firing poses).
  charLinkCrouch: 'char.link.crouch',
  charLinkJab: 'char.link.jab',
  charLinkJab2: 'char.link.jab2',
  charLinkJab3: 'char.link.jab3',
  charLinkTilt: 'char.link.tilt',
  charLinkDtilt: 'char.link.dtilt',
  charLinkSmash: 'char.link.smash',
  charLinkNair: 'char.link.nair',
  charLinkFair: 'char.link.fair',
  charLinkBair: 'char.link.bair',
  charLinkUair: 'char.link.uair',
  charLinkDair: 'char.link.dair',
  charLinkNeutralSpecial: 'char.link.neutral_special',
  charLinkSideSpecial: 'char.link.side_special',
  charLinkUpSpecial: 'char.link.up_special',
  charLinkDownSpecial: 'char.link.down_special',
  charLinkHurt:    'char.link.hurt',
  charLinkShield:  'char.link.shield',
  charLinkGrab:    'char.link.grab',
  charLinkPummel:  'char.link.pummel',
  charLinkFthrow:  'char.link.fthrow',
  charLinkBthrow:  'char.link.bthrow',
  charLinkUthrow:  'char.link.uthrow',
  charLinkDthrow:  'char.link.dthrow',

  // ---------------- characters: kirby (full AI sprite set) -----------
  charKirbyIdle: 'char.kirby.idle',
  charKirbyRun: 'char.kirby.run',
  charKirbyJump: 'char.kirby.jump',
  charKirbyAttack: 'char.kirby.attack',
  charKirbyCrouch: 'char.kirby.crouch',
  charKirbyJab: 'char.kirby.jab',
  charKirbyJab2: 'char.kirby.jab2',
  charKirbyJab3: 'char.kirby.jab3',
  charKirbyTilt: 'char.kirby.tilt',
  charKirbyDtilt: 'char.kirby.dtilt',
  charKirbySmash: 'char.kirby.smash',
  charKirbyNair: 'char.kirby.nair',
  charKirbyFair: 'char.kirby.fair',
  charKirbyBair: 'char.kirby.bair',
  charKirbyNeutralSpecial: 'char.kirby.neutral_special',
  charKirbySideSpecial: 'char.kirby.side_special',
  charKirbyUpSpecial: 'char.kirby.up_special',
  charKirbyDownSpecial: 'char.kirby.down_special',
  charKirbyHurt: 'char.kirby.hurt',
  charKirbyShield: 'char.kirby.shield',
  charKirbyGrab: 'char.kirby.grab',
  charKirbyPummel: 'char.kirby.pummel',
  charKirbyFthrow: 'char.kirby.fthrow',
  charKirbyBthrow: 'char.kirby.bthrow',
  charKirbyUthrow: 'char.kirby.uthrow',
  charKirbyDthrow: 'char.kirby.dthrow',
  charKirbyUair: 'char.kirby.uair',
  charKirbyDair: 'char.kirby.dair',

  // ---------------- characters: donkeykong (full AI sprite set) ------
  charDonkeykongIdle: 'char.donkeykong.idle',
  charDonkeykongRun: 'char.donkeykong.run',
  charDonkeykongJump: 'char.donkeykong.jump',
  charDonkeykongAttack: 'char.donkeykong.attack',
  charDonkeykongCrouch: 'char.donkeykong.crouch',
  charDonkeykongJab: 'char.donkeykong.jab',
  charDonkeykongJab2: 'char.donkeykong.jab2',
  charDonkeykongJab3: 'char.donkeykong.jab3',
  charDonkeykongTilt: 'char.donkeykong.tilt',
  charDonkeykongDtilt: 'char.donkeykong.dtilt',
  charDonkeykongSmash: 'char.donkeykong.smash',
  charDonkeykongNair: 'char.donkeykong.nair',
  charDonkeykongFair: 'char.donkeykong.fair',
  charDonkeykongBair: 'char.donkeykong.bair',
  charDonkeykongNeutralSpecial: 'char.donkeykong.neutral_special',
  charDonkeykongSideSpecial: 'char.donkeykong.side_special',
  charDonkeykongUpSpecial: 'char.donkeykong.up_special',
  charDonkeykongDownSpecial: 'char.donkeykong.down_special',
  charDonkeykongHurt: 'char.donkeykong.hurt',
  charDonkeykongShield: 'char.donkeykong.shield',
  charDonkeykongGrab: 'char.donkeykong.grab',
  charDonkeykongPummel: 'char.donkeykong.pummel',
  charDonkeykongFthrow: 'char.donkeykong.fthrow',
  charDonkeykongBthrow: 'char.donkeykong.bthrow',
  charDonkeykongUthrow: 'char.donkeykong.uthrow',
  charDonkeykongDthrow: 'char.donkeykong.dthrow',
  charDonkeykongUair: 'char.donkeykong.uair',
  charDonkeykongDair: 'char.donkeykong.dair',

  // ---------------- characters: cat — palette variant sheets ---------
  // Generated by `npm run palette-swap` from the canonical
  // `assets/characters/cat/cat_source_sheet.png` + the colour mapping
  // declared in `assets/palettes/cat.json`. Sub-AC 4 of AC 10204 requires
  // that each of the 8 generated variants is registered under a
  // deterministic texture key so the runtime can fetch it by
  // `(characterId, paletteIndex)` without re-deriving the file path.
  // The naming pattern `char.<id>.palette.<index>` is the namespaced
  // form of the AC's example `${character}_palette_${index}` — same
  // determinism, same parameters (character + index), but kept under
  // the existing `char.` prefix so the manifest's namespacing test
  // stays honest.
  charCatPalette0: 'char.cat.palette.0',
  charCatPalette1: 'char.cat.palette.1',
  charCatPalette2: 'char.cat.palette.2',
  charCatPalette3: 'char.cat.palette.3',
  charCatPalette4: 'char.cat.palette.4',
  charCatPalette5: 'char.cat.palette.5',
  charCatPalette6: 'char.cat.palette.6',
  charCatPalette7: 'char.cat.palette.7',

  // ---------------- characters: wolf — palette variant sheets --------
  // Same contract as the cat block above; sourced from
  // `assets/characters/wolf/wolf_source_sheet.png` + `assets/palettes/wolf.json`.
  charWolfPalette0: 'char.wolf.palette.0',
  charWolfPalette1: 'char.wolf.palette.1',
  charWolfPalette2: 'char.wolf.palette.2',
  charWolfPalette3: 'char.wolf.palette.3',
  charWolfPalette4: 'char.wolf.palette.4',
  charWolfPalette5: 'char.wolf.palette.5',
  charWolfPalette6: 'char.wolf.palette.6',
  charWolfPalette7: 'char.wolf.palette.7',

  // ---------------- stage: m1 (flat) ---------------------------------
  /** 18×18 platform tile atlas (gutter variant — pairs with margin/spacing). */
  stageM1Tilemap: 'stage.m1.tilemap',
  /** 24×24 background tile atlas (gutter variant). */
  stageM1Background: 'stage.m1.background',

  // ---------------- stage: parallax background bands -----------------
  // Individual 24×24 Kenney background tiles from
  // `assets/stages/m1/background/`, loaded as standalone images so the
  // stage background renderer can wrap each one in a `TileSprite` band
  // (a TileSprite needs a whole texture to repeat — a spritesheet frame
  // won't tile). Referenced by the parallax layer specs in
  // `src/stages/backgroundThemes.ts`; the renderer falls back to
  // procedural silhouettes when a key is missing from the cache.
  /** Cloud band — white cloud tops on pale blue (`tile_0008`). */
  stageBgClouds: 'stage.bg.clouds',
  /** Cloud wisps — lighter broken cloud row (`tile_0010`). */
  stageBgWisps: 'stage.bg.wisps',
  /** Dune crests — warm sand hill silhouettes (`tile_0012`). */
  stageBgDunes: 'stage.bg.dunes',
  /** Hill crests — rolling green hills, tintable (`tile_0014`). */
  stageBgHills: 'stage.bg.hills',

  // ---------------- items --------------------------------------------
  /** Bomb item sprite — 40×40 PNG sourced from Kenney Particle Pack `fire_01`. */
  itemBomb: 'item.bomb.sprite',
  /** Bomb-detonation explosion strip — 3 frames @ 96×96 (flash → fireball → smoke). */
  itemExplosion: 'item.bomb.explosion',
  /** Bat item sprite — 16×48 procedural tapered baseball-bat PNG. */
  itemBat: 'item.bat.sprite',
  /** Ray-gun item sprite — 70×70 PNG from Kenney Platformer Art Deluxe (`raygun.png`). */
  itemRayGun: 'item.raygun.sprite',
  /** Sword item sprite — 96×96 RGBA. */
  itemSword: 'item.sword.sprite',
  /** Spear item sprite — 96×96 RGBA. */
  itemSpear: 'item.spear.sprite',
  /** Hammer item sprite — 96×96 RGBA. */
  itemHammer: 'item.hammer.sprite',

  // ---------------- audio: SFX ---------------------------------------
  sfxJab: 'sfx.jab',
  sfxTilt: 'sfx.tilt',
  sfxSmash: 'sfx.smash',
  sfxAerial: 'sfx.aerial',
  sfxKo: 'sfx.ko',
  sfxShield: 'sfx.shield',
  sfxDodge: 'sfx.dodge',
  // M1.5 action-audio expansion (AC 10304) — movement, connect-on-hit,
  // shield-shatter, and the charge wind-up loop. The original seven
  // cues above voice the *swing* of an attack and the defensive STATE
  // transitions; these eight voice the rest of the Smash-style action
  // vocabulary the player expects to hear. All are short CC0 Kenney
  // Interface-Sounds cuts (see ATTRIBUTION.md + sfx/README.md).
  /** Ground jump — the rising "hup" on the first jump off a platform. */
  sfxJump: 'sfx.jump',
  /** Air / multi-jump — a lighter, shorter variant for mid-air jumps. */
  sfxJumpAir: 'sfx.jump.air',
  /** Landing thud — soft cue on the airborne → grounded transition. */
  sfxLand: 'sfx.land',
  /** Light hit connect — quick pop when a low-damage hit lands. */
  sfxHitLight: 'sfx.hit.light',
  /** Heavy hit connect — meatier thud when a high-damage hit lands. */
  sfxHitHeavy: 'sfx.hit.heavy',
  /** Weapon clang — metallic ring when a held-weapon hit connects. */
  sfxClang: 'sfx.clang',
  /** Shield shatter — glass-break burst when a shield is broken. */
  sfxShieldBreak: 'sfx.shield.break',
  /** Charge wind-up loop — rising hum while a charge move winds up. */
  sfxCharge: 'sfx.charge',

  // ---------------- audio: music -------------------------------------
  musicStageDefault: 'music.stage.default',
} as const;

/** String-literal union of every cache key for type-safe consumers. */
export type AssetKey = (typeof ASSET_KEYS)[keyof typeof ASSET_KEYS];

// ---------------------------------------------------------------------
// Asset path roots
// ---------------------------------------------------------------------
//
// Centralising the roots keeps the file-tree shape (which is read by
// CI / asset-licence tooling) coupled to the manifest in one place —
// move a folder, change one constant.

// Vite's `BASE_URL` is `/` in dev and the configured `base` in
// production (e.g. `/platform-fighter/` on GitHub Pages, or `./` for
// path-agnostic builds). Prefixing every public-asset URL with it lets
// the same loader code work in dev, in a project-page deploy, and in
// any sub-path hosting without touching call sites. `BASE_URL` always
// ends with `/`, so each root strips its own leading slash.
// The optional chain + fallback keeps this module importable OUTSIDE
// Vite — `tsx` scripts (e.g. `scripts/validate-character-data.ts`)
// define `import.meta` but not `import.meta.env`, and they only need
// the key tables, not resolvable URLs.
const BASE = import.meta.env?.BASE_URL ?? '/';
const CHAR_ROOT = `${BASE}characters`;
const STAGE_ROOT = `${BASE}stages`;
const SFX_ROOT = `${BASE}audio/sfx`;
const MUSIC_ROOT = `${BASE}audio/music`;
const ITEM_SPRITES_ROOT = `${BASE}sprites/items`;

/**
 * Output root for the palette-swap script's per-character variant PNGs.
 * Mirrors `DEFAULT_GENERATED_SPRITES_DIR` in
 * `scripts/palette-swap/index.ts` — both must change together if the
 * pipeline ever moves the output folder. The Vite `publicDir` mount is
 * `assets/`, so the on-disk path `assets/generated/sprites/<id>/…`
 * resolves to the URL prefix `${BASE}generated/sprites/<id>/…` here.
 */
const GENERATED_SPRITES_ROOT = `${BASE}generated/sprites`;

// ---------------------------------------------------------------------
// Character spritesheet entries
// ---------------------------------------------------------------------
//
// Frame counts and cell sizes mirror the canonical metadata in each
// character's `frames.json`. Keeping them duplicated here is
// deliberate: the manifest is the contract Phaser sees, and the
// runtime would crash earlier if these drifted from `frames.json`
// than if the JSON were the loader's input. The unit test in
// `manifest.test.ts` cross-checks both.

const catSpritesheets: readonly SpritesheetAssetEntry[] = [
  {
    key: ASSET_KEYS.charCatIdle,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/cat/animations/idle.png`,
    frameWidth: 50,
    frameHeight: 50,
    frameCount: 4,
  },
  {
    key: ASSET_KEYS.charCatRun,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/cat/animations/run.png`,
    frameWidth: 50,
    frameHeight: 50,
    frameCount: 10,
  },
  {
    key: ASSET_KEYS.charCatJump,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/cat/animations/jump.png`,
    frameWidth: 50,
    frameHeight: 50,
    frameCount: 5,
  },
  {
    key: ASSET_KEYS.charCatAttack,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/cat/animations/attack.png`,
    frameWidth: 50,
    frameHeight: 50,
    frameCount: 10,
  },
];

const wolfSpritesheets: readonly SpritesheetAssetEntry[] = [
  {
    key: ASSET_KEYS.charWolfIdle,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/wolf/animations/idle.png`,
    frameWidth: 64,
    frameHeight: 64,
    frameCount: 4,
  },
  {
    key: ASSET_KEYS.charWolfRun,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/wolf/animations/run.png`,
    frameWidth: 64,
    frameHeight: 64,
    frameCount: 8,
  },
  {
    key: ASSET_KEYS.charWolfJump,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/wolf/animations/jump.png`,
    frameWidth: 64,
    frameHeight: 64,
    frameCount: 5,
  },
  {
    key: ASSET_KEYS.charWolfAttack,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/wolf/animations/attack.png`,
    frameWidth: 64,
    frameHeight: 64,
    // Original source had 4 cells but cell 0 was a stray-pixel artifact;
    // the real attack animation is 3 frames after the rebuild pass that
    // detected clean wolf clusters and dropped the noise cell.
    frameCount: 3,
  },
];

const owlSpritesheets: readonly SpritesheetAssetEntry[] = [
  {
    key: ASSET_KEYS.charOwlIdle,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/owl/animations/idle.png`,
    frameWidth: 15,
    frameHeight: 20,
    frameCount: 1,
  },
  {
    key: ASSET_KEYS.charOwlRun,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/owl/animations/run.png`,
    frameWidth: 15,
    frameHeight: 20,
    frameCount: 8,
  },
  {
    key: ASSET_KEYS.charOwlJump,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/owl/animations/jump.png`,
    frameWidth: 15,
    frameHeight: 20,
    frameCount: 1,
  },
  {
    key: ASSET_KEYS.charOwlAttack,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/owl/animations/attack.png`,
    frameWidth: 15,
    frameHeight: 20,
    frameCount: 1,
  },
];

const bearSpritesheets: readonly SpritesheetAssetEntry[] = [
  {
    key: ASSET_KEYS.charBearIdle,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/bear/animations/idle.png`,
    frameWidth: 60,
    frameHeight: 72,
    frameCount: 2,
  },
  {
    key: ASSET_KEYS.charBearRun,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/bear/animations/run.png`,
    frameWidth: 60,
    frameHeight: 72,
    frameCount: 4,
  },
  {
    key: ASSET_KEYS.charBearJump,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/bear/animations/jump.png`,
    frameWidth: 60,
    frameHeight: 72,
    frameCount: 3,
  },
  {
    key: ASSET_KEYS.charBearAttack,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/bear/animations/attack.png`,
    frameWidth: 60,
    frameHeight: 72,
    frameCount: 4,
  },
];

// Post-M5 roster expansion — Blaze / Puff / Aegis sprite packs.
//
// Blaze ships the *Punk* character from CraftPix.net's "Free 3 Cyberpunk
// Characters Pixel Art" (OGA-BY 3.0 — see ATTRIBUTION.md). Strips are
// verbatim copies of the upstream 48×48-cell horizontal strips
// (idle / run / jump / punch-as-attack).
const blazeSpritesheets: readonly SpritesheetAssetEntry[] = [
  {
    key: ASSET_KEYS.charBlazeIdle,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/blaze/animations/idle.png`,
    frameWidth: 48,
    frameHeight: 48,
    frameCount: 4,
  },
  {
    key: ASSET_KEYS.charBlazeRun,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/blaze/animations/run.png`,
    frameWidth: 48,
    frameHeight: 48,
    frameCount: 6,
  },
  {
    key: ASSET_KEYS.charBlazeJump,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/blaze/animations/jump.png`,
    frameWidth: 48,
    frameHeight: 48,
    frameCount: 4,
  },
  {
    key: ASSET_KEYS.charBlazeAttack,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/blaze/animations/attack.png`,
    frameWidth: 48,
    frameHeight: 48,
    frameCount: 6,
  },
];

// Puff ships the *Slime (SLIME04)* character from Segel's CC0
// "Adventurer and Slime game Sprites" pack. Upstream per-frame
// 1333×936 canvases were cropped to a fixed union bounding rect and
// box-filter downscaled ÷4 into 136×89 cells (see
// `assets/characters/puff/frames.json` for the exact mapping). The
// jump strip re-extracts the airborne hop arc of the attack lunge —
// same approach the Owl pack used for its jump frame.
const puffSpritesheets: readonly SpritesheetAssetEntry[] = [
  {
    key: ASSET_KEYS.charPuffIdle,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/puff/animations/idle.png`,
    frameWidth: 136,
    frameHeight: 89,
    frameCount: 12,
  },
  {
    key: ASSET_KEYS.charPuffRun,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/puff/animations/run.png`,
    frameWidth: 136,
    frameHeight: 89,
    frameCount: 10,
  },
  {
    key: ASSET_KEYS.charPuffJump,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/puff/animations/jump.png`,
    frameWidth: 136,
    frameHeight: 89,
    frameCount: 4,
  },
  {
    key: ASSET_KEYS.charPuffAttack,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/puff/animations/attack.png`,
    frameWidth: 136,
    frameHeight: 89,
    frameCount: 8,
  },
];

// Aegis ships the *Adventurer* (sword-wielder) from the same Segel CC0
// pack. Cropped to a fixed union rect and downscaled ÷6 into 128×130
// cells; jump = the pack's JumpUp + JumpFall poses (rise → hold fall),
// attack = the 8-frame sword slash.
const aegisSpritesheets: readonly SpritesheetAssetEntry[] = [
  {
    key: ASSET_KEYS.charAegisIdle,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/aegis/animations/idle.png`,
    frameWidth: 128,
    frameHeight: 130,
    frameCount: 12,
  },
  {
    key: ASSET_KEYS.charAegisRun,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/aegis/animations/run.png`,
    frameWidth: 128,
    frameHeight: 130,
    frameCount: 10,
  },
  {
    key: ASSET_KEYS.charAegisJump,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/aegis/animations/jump.png`,
    frameWidth: 128,
    frameHeight: 130,
    frameCount: 2,
  },
  {
    key: ASSET_KEYS.charAegisAttack,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/aegis/animations/attack.png`,
    frameWidth: 128,
    frameHeight: 130,
    frameCount: 8,
  },
];

// Post-batch-2 roster expansion — Volt / Nova / Bruno sprite packs.
//
// Volt ships Segel's CC0 *Tiny Kitten Game Sprite* (a small chibi
// creature — the Pikachu-inspired tiny fighter). Upstream per-frame
// PNGs (489×461 canvas) were cropped to a fixed union rect and
// box-filter downscaled into 64×80 cells (see frames.json +
// Link — first AI-generated pack (Z-Image ControlNet pose-source pipeline,
// tools/gen-frames.ts + tools/pack-clips.cjs). 65×64 cells. run is a generated
// 8-frame cycle; jump 5; attack is the collapsed swing (5 frames); idle is a
// 4-frame breathing loop from the ControlNet keyframe.
const linkSpritesheets: readonly SpritesheetAssetEntry[] = [
  {
    key: ASSET_KEYS.charLinkIdle,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/link/animations/idle.png`,
    frameWidth: 128,
    frameHeight: 128,
    frameCount: 4,
  },
  {
    key: ASSET_KEYS.charLinkRun,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/link/animations/run.png`,
    frameWidth: 128,
    frameHeight: 128,
    frameCount: 8,
  },
  {
    key: ASSET_KEYS.charLinkJump,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/link/animations/jump.png`,
    frameWidth: 128,
    frameHeight: 128,
    frameCount: 5,
  },
  {
    key: ASSET_KEYS.charLinkAttack,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/link/animations/attack.png`,
    frameWidth: 128,
    frameHeight: 128,
    frameCount: 5,
  },
];

// Link — full per-move + ducking set (AI ControlNet pipeline). Frame counts mirror
// assets/characters/link/frames.json (one cell per generated pose).
const linkMovesetSpritesheets: readonly SpritesheetAssetEntry[] = [
  { key: ASSET_KEYS.charLinkCrouch, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/crouch.png`, frameWidth: 128, frameHeight: 128, frameCount: 1 },
  { key: ASSET_KEYS.charLinkJab, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/jab.png`, frameWidth: 128, frameHeight: 128, frameCount: 3 },
  { key: ASSET_KEYS.charLinkJab2, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/jab2.png`, frameWidth: 128, frameHeight: 128, frameCount: 4 },
  { key: ASSET_KEYS.charLinkJab3, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/jab3.png`, frameWidth: 128, frameHeight: 128, frameCount: 4 },
  { key: ASSET_KEYS.charLinkTilt, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/tilt.png`, frameWidth: 128, frameHeight: 128, frameCount: 3 },
  { key: ASSET_KEYS.charLinkDtilt, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/dtilt.png`, frameWidth: 128, frameHeight: 128, frameCount: 4 },
  { key: ASSET_KEYS.charLinkSmash, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/smash.png`, frameWidth: 128, frameHeight: 128, frameCount: 4 },
  { key: ASSET_KEYS.charLinkNair, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/nair.png`, frameWidth: 128, frameHeight: 128, frameCount: 3 },
  { key: ASSET_KEYS.charLinkFair, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/fair.png`, frameWidth: 128, frameHeight: 128, frameCount: 3 },
  { key: ASSET_KEYS.charLinkBair, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/bair.png`, frameWidth: 128, frameHeight: 128, frameCount: 3 },
  { key: ASSET_KEYS.charLinkUair, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/uair.png`, frameWidth: 128, frameHeight: 128, frameCount: 3 },
  { key: ASSET_KEYS.charLinkDair, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/dair.png`, frameWidth: 128, frameHeight: 128, frameCount: 3 },
  { key: ASSET_KEYS.charLinkNeutralSpecial, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/neutral_special.png`, frameWidth: 128, frameHeight: 128, frameCount: 3 },
  { key: ASSET_KEYS.charLinkSideSpecial, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/side_special.png`, frameWidth: 128, frameHeight: 128, frameCount: 3 },
  { key: ASSET_KEYS.charLinkUpSpecial, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/up_special.png`, frameWidth: 128, frameHeight: 128, frameCount: 3 },
  { key: ASSET_KEYS.charLinkDownSpecial, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/down_special.png`, frameWidth: 128, frameHeight: 128, frameCount: 3 },
  { key: ASSET_KEYS.charLinkHurt,   kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/hurt.png`,   frameWidth: 128, frameHeight: 128, frameCount: 2 },
  { key: ASSET_KEYS.charLinkShield, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/shield.png`, frameWidth: 128, frameHeight: 128, frameCount: 1 },
  { key: ASSET_KEYS.charLinkGrab,   kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/grab.png`,   frameWidth: 128, frameHeight: 128, frameCount: 3 },
  { key: ASSET_KEYS.charLinkPummel, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/pummel.png`, frameWidth: 128, frameHeight: 128, frameCount: 2 },
  { key: ASSET_KEYS.charLinkFthrow, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/fthrow.png`, frameWidth: 128, frameHeight: 128, frameCount: 3 },
  { key: ASSET_KEYS.charLinkBthrow, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/bthrow.png`, frameWidth: 128, frameHeight: 128, frameCount: 3 },
  { key: ASSET_KEYS.charLinkUthrow, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/uthrow.png`, frameWidth: 128, frameHeight: 128, frameCount: 3 },
  { key: ASSET_KEYS.charLinkDthrow, kind: 'spritesheet', url: `${CHAR_ROOT}/link/animations/dthrow.png`, frameWidth: 128, frameHeight: 128, frameCount: 3 },
];

// Helper: build a fighter's spritesheet entries from (assetKey, file, frameCount)
// tuples at the standard 128x128 AI-pack cell. Cuts the per-character boilerplate for
// the full per-move sprite packs.
function charSheetEntries(
  fighter: string,
  defs: ReadonlyArray<readonly [string, string, number]>,
): readonly SpritesheetAssetEntry[] {
  return defs.map(([key, file, frameCount]) => ({
    key,
    kind: 'spritesheet' as const,
    url: `${CHAR_ROOT}/${fighter}/animations/${file}.png`,
    frameWidth: 128,
    frameHeight: 128,
    frameCount,
  }));
}

// Kirby — full AI sprite set (basic + per-move + crouch). Counts mirror
// assets/characters/kirby/frames.json.
const kirbySpritesheets: readonly SpritesheetAssetEntry[] = charSheetEntries('kirby', [
  [ASSET_KEYS.charKirbyIdle, 'idle', 4],
  [ASSET_KEYS.charKirbyRun, 'run', 8],
  [ASSET_KEYS.charKirbyJump, 'jump', 5],
  [ASSET_KEYS.charKirbyAttack, 'attack', 4],
  [ASSET_KEYS.charKirbyCrouch, 'crouch', 1],
  [ASSET_KEYS.charKirbyJab, 'jab', 3],
  [ASSET_KEYS.charKirbyJab2, 'jab2', 4],
  [ASSET_KEYS.charKirbyJab3, 'jab3', 4],
  [ASSET_KEYS.charKirbyTilt, 'tilt', 3],
  [ASSET_KEYS.charKirbyDtilt, 'dtilt', 4],
  [ASSET_KEYS.charKirbySmash, 'smash', 4],
  [ASSET_KEYS.charKirbyNair, 'nair', 3],
  [ASSET_KEYS.charKirbyFair, 'fair', 3],
  [ASSET_KEYS.charKirbyBair, 'bair', 3],
  [ASSET_KEYS.charKirbyNeutralSpecial, 'neutral_special', 3],
  [ASSET_KEYS.charKirbySideSpecial, 'side_special', 3],
  [ASSET_KEYS.charKirbyUpSpecial, 'up_special', 3],
  [ASSET_KEYS.charKirbyDownSpecial, 'down_special', 3],
  [ASSET_KEYS.charKirbyHurt, 'hurt', 2],
  [ASSET_KEYS.charKirbyShield, 'shield', 1],
  [ASSET_KEYS.charKirbyGrab, 'grab', 3],
  [ASSET_KEYS.charKirbyPummel, 'pummel', 2],
  [ASSET_KEYS.charKirbyFthrow, 'fthrow', 3],
  [ASSET_KEYS.charKirbyBthrow, 'bthrow', 3],
  [ASSET_KEYS.charKirbyUthrow, 'uthrow', 3],
  [ASSET_KEYS.charKirbyDthrow, 'dthrow', 3],
  [ASSET_KEYS.charKirbyUair, 'uair', 3],
  [ASSET_KEYS.charKirbyDair, 'dair', 3],
]);

// Donkey Kong — full AI sprite set. Counts mirror assets/characters/donkeykong/frames.json.
const donkeykongSpritesheets: readonly SpritesheetAssetEntry[] = charSheetEntries('donkeykong', [
  [ASSET_KEYS.charDonkeykongIdle, 'idle', 4],
  [ASSET_KEYS.charDonkeykongRun, 'run', 8],
  [ASSET_KEYS.charDonkeykongJump, 'jump', 5],
  [ASSET_KEYS.charDonkeykongAttack, 'attack', 4],
  [ASSET_KEYS.charDonkeykongCrouch, 'crouch', 1],
  [ASSET_KEYS.charDonkeykongJab, 'jab', 3],
  [ASSET_KEYS.charDonkeykongJab2, 'jab2', 4],
  [ASSET_KEYS.charDonkeykongJab3, 'jab3', 4],
  [ASSET_KEYS.charDonkeykongTilt, 'tilt', 3],
  [ASSET_KEYS.charDonkeykongDtilt, 'dtilt', 4],
  [ASSET_KEYS.charDonkeykongSmash, 'smash', 4],
  [ASSET_KEYS.charDonkeykongNair, 'nair', 3],
  [ASSET_KEYS.charDonkeykongFair, 'fair', 3],
  [ASSET_KEYS.charDonkeykongBair, 'bair', 3],
  [ASSET_KEYS.charDonkeykongNeutralSpecial, 'neutral_special', 3],
  [ASSET_KEYS.charDonkeykongSideSpecial, 'side_special', 3],
  [ASSET_KEYS.charDonkeykongUpSpecial, 'up_special', 3],
  [ASSET_KEYS.charDonkeykongDownSpecial, 'down_special', 3],
  [ASSET_KEYS.charDonkeykongHurt, 'hurt', 2],
  [ASSET_KEYS.charDonkeykongShield, 'shield', 1],
  [ASSET_KEYS.charDonkeykongGrab, 'grab', 3],
  [ASSET_KEYS.charDonkeykongPummel, 'pummel', 2],
  [ASSET_KEYS.charDonkeykongFthrow, 'fthrow', 3],
  [ASSET_KEYS.charDonkeykongBthrow, 'bthrow', 3],
  [ASSET_KEYS.charDonkeykongUthrow, 'uthrow', 3],
  [ASSET_KEYS.charDonkeykongDthrow, 'dthrow', 3],
  [ASSET_KEYS.charDonkeykongUair, 'uair', 3],
  [ASSET_KEYS.charDonkeykongDair, 'dair', 3],
]);

// tools/build-newchar-sprites.cjs). The 'attack' strip reuses the
// pack's JumpFall pounce pose (no dedicated attack animation).
const voltSpritesheets: readonly SpritesheetAssetEntry[] = [
  {
    key: ASSET_KEYS.charVoltIdle,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/volt/animations/idle.png`,
    frameWidth: 64,
    frameHeight: 80,
    frameCount: 12,
  },
  {
    key: ASSET_KEYS.charVoltRun,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/volt/animations/run.png`,
    frameWidth: 64,
    frameHeight: 80,
    frameCount: 10,
  },
  {
    key: ASSET_KEYS.charVoltJump,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/volt/animations/jump.png`,
    frameWidth: 64,
    frameHeight: 80,
    frameCount: 5,
  },
  {
    key: ASSET_KEYS.charVoltAttack,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/volt/animations/attack.png`,
    frameWidth: 64,
    frameHeight: 80,
    frameCount: 5,
  },
];

// Nova ships the CC0 *2D Douche Cyborg* ('CyborgMark') by Darius
// Guerrero — an armoured cyborg with an arm-cannon (the Samus-inspired
// zoner). Upstream per-frame PNGs (~114-139 px canvases) were cropped
// to a fixed union rect and box-filter downscaled into 72×96 cells. The
// 'attack' strip is the pack's Shoot animation (arm-cannon fire) —
// fitting the zoner's projectile identity.
const novaSpritesheets: readonly SpritesheetAssetEntry[] = [
  {
    key: ASSET_KEYS.charNovaIdle,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/nova/animations/idle.png`,
    frameWidth: 72,
    frameHeight: 96,
    frameCount: 15,
  },
  {
    key: ASSET_KEYS.charNovaRun,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/nova/animations/run.png`,
    frameWidth: 72,
    frameHeight: 96,
    frameCount: 15,
  },
  {
    key: ASSET_KEYS.charNovaJump,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/nova/animations/jump.png`,
    frameWidth: 72,
    frameHeight: 96,
    frameCount: 15,
  },
  {
    key: ASSET_KEYS.charNovaAttack,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/nova/animations/attack.png`,
    frameWidth: 72,
    frameHeight: 96,
    frameCount: 9,
  },
];

// Bruno ships the CC0 *Generic Platformer Pack* main character by
// bakudas — a compact cap-and-jumpsuit humanoid (the Mario-inspired
// all-rounder). Native pixel-art frames (22×32) were cropped to a
// fixed union rect and re-laid near 1:1 into 28×36 cells. The 'attack'
// strip reuses the run lunge frames (no dedicated attack animation).
const brunoSpritesheets: readonly SpritesheetAssetEntry[] = [
  {
    key: ASSET_KEYS.charBrunoIdle,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/bruno/animations/idle.png`,
    frameWidth: 28,
    frameHeight: 36,
    frameCount: 4,
  },
  {
    key: ASSET_KEYS.charBrunoRun,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/bruno/animations/run.png`,
    frameWidth: 28,
    frameHeight: 36,
    frameCount: 8,
  },
  {
    key: ASSET_KEYS.charBrunoJump,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/bruno/animations/jump.png`,
    frameWidth: 28,
    frameHeight: 36,
    frameCount: 2,
  },
  {
    key: ASSET_KEYS.charBrunoAttack,
    kind: 'spritesheet',
    url: `${CHAR_ROOT}/bruno/animations/attack.png`,
    frameWidth: 28,
    frameHeight: 36,
    frameCount: 8,
  },
];

// ---------------------------------------------------------------------
// Palette variant spritesheet entries — Sub-AC 4 of AC 10204
// ---------------------------------------------------------------------
//
// The palette-swap script (`scripts/palette-swap/index.ts`) emits one
// PNG per `(characterId, paletteIndex)` pair into
// `assets/generated/sprites/<id>/<index>_<slug>.png`. Each PNG is a
// pixel-remapped clone of the canonical source sheet (same dimensions,
// same per-cell layout) — only the pixels matching the palette JSON's
// source slot colours are recoloured to the variant's target colours.
//
// At runtime the renderer needs to fetch the right variant by slot:
//
//     const tex = scene.add.image(x, y, paletteVariantTextureKey('wolf', 3));
//
// To make that lookup deterministic and free of file-path knowledge,
// we pre-register all 16 variants (8 wolf + 8 cat) under stable
// `char.<id>.palette.<index>` cache keys here. Keys are also exposed
// via {@link paletteVariantTextureKey} so consumers don't recompute
// the string at every call site.
//
// Why these are loaded as `spritesheet` (not `image`):
//   - The variant PNGs preserve the source sheet's per-cell grid
//     (16×16 cells of 64×64 px for wolf; 10×10 cells of 50×50 px for
//     cat — see `frames.json` per character). Loading as a spritesheet
//     means the renderer can frame-index into them with the same
//     `(col, row)` offsets the canonical strips use, so a future "play
//     idle animation in palette 3" lookup is one Phaser API call away
//     rather than a custom blit.
//   - Loading as `spritesheet` also keeps these entries inside the
//     existing PreloadScene dispatch case, so Sub-AC 4 ships without
//     touching the loader switch.

/**
 * Per-character variant configuration. Slugs match what the
 * palette-swap script writes to disk (`<index>_<slug>.png`) — they are
 * the slugified `name` field from `assets/palettes/<id>.json` and are
 * also the canonical display label for that palette index in
 * `src/characters/palettes.ts`. Frame dimensions mirror the source
 * sheet's `cellWidth`/`cellHeight` from `frames.json`.
 *
 * Owl and Bear have palette JSON files but no canonical source sheet
 * yet (M2 art deliverable), so they are intentionally absent from this
 * table. The runtime falls back to `PaletteSwapRenderer`'s tint pipeline
 * for those characters until the M2 art lands and the script can emit
 * variant PNGs for them.
 */
export interface PaletteVariantSheetConfig {
  /** Character id — namespaces the texture key + the on-disk folder. */
  readonly characterId: 'wolf' | 'cat';
  /** Cell width in pixels (matches `cellWidth` in `frames.json`). */
  readonly frameWidth: number;
  /** Cell height in pixels. */
  readonly frameHeight: number;
  /** Total cells in the sheet (`sheetCols * sheetRows`). */
  readonly frameCount: number;
  /**
   * Variant slug per palette index 0..7. Matches the slugified
   * `variants[i].name` from `assets/palettes/<id>.json` and the
   * filename written by `slugifyVariantName()` in
   * `scripts/palette-swap/index.ts`.
   */
  readonly slugs: readonly [string, string, string, string, string, string, string, string];
}

/**
 * Frozen table describing every character that currently ships with
 * palette-swap variant PNGs. Iterating this table is how the manifest
 * generates its variant spritesheet entries — adding a new character
 * (Owl/Bear in M2) is a one-entry change here plus a new `ASSET_KEYS`
 * block above.
 */
export const PALETTE_VARIANT_CHARACTERS: readonly PaletteVariantSheetConfig[] =
  Object.freeze([
    Object.freeze<PaletteVariantSheetConfig>({
      characterId: 'cat',
      frameWidth: 50,
      frameHeight: 50,
      frameCount: 100, // 10 cols × 10 rows — see assets/characters/cat/frames.json
      slugs: Object.freeze([
        'sky',
        'fuchsia',
        'mint',
        'lavender',
        'coral',
        'lime',
        'teal',
        'shadow',
      ]) as PaletteVariantSheetConfig['slugs'],
    }),
    Object.freeze<PaletteVariantSheetConfig>({
      characterId: 'wolf',
      frameWidth: 64,
      frameHeight: 64,
      frameCount: 256, // 16 cols × 16 rows — see assets/characters/wolf/frames.json
      slugs: Object.freeze([
        'crimson',
        'cobalt',
        'sunburst',
        'forest',
        'royal',
        'ember',
        'lagoon',
        'rose',
      ]) as PaletteVariantSheetConfig['slugs'],
    }),
  ]);

/** Number of palette variants per character — locked to the Seed's "8". */
export const PALETTE_VARIANTS_PER_CHARACTER = 8;

/**
 * Compose the deterministic Phaser texture cache key for a palette
 * variant. The format mirrors the AC's example
 * `${character}_palette_${index}` semantically (parameterised by
 * character id + index, deterministic) while staying under the
 * existing `char.` namespace prefix the manifest contract enforces.
 *
 * Usage:
 *
 *     const key = paletteVariantTextureKey('wolf', 3);
 *     // → 'char.wolf.palette.3'
 *     const sprite = scene.add.sprite(x, y, key, frameIndex);
 *
 * Pure / deterministic — same `(id, index)` always returns the same
 * string. Index is wrapped modulo {@link PALETTE_VARIANTS_PER_CHARACTER}
 * so a stale `paletteIndex` (e.g. read from an out-of-date replay)
 * lands on a valid key rather than a `char.wolf.palette.NaN` typo.
 */
export function paletteVariantTextureKey(
  characterId: PaletteVariantSheetConfig['characterId'],
  paletteIndex: number,
): string {
  const wrapped = wrapPaletteIndex(paletteIndex);
  return `char.${characterId}.palette.${wrapped}`;
}

/**
 * Compose the public URL for a palette variant PNG. Centralised so
 * the manifest registration and any future runtime helper (e.g. a
 * lazy-load fallback for a missing variant) build identical paths.
 */
export function paletteVariantUrl(
  config: PaletteVariantSheetConfig,
  paletteIndex: number,
): string {
  const wrapped = wrapPaletteIndex(paletteIndex);
  const slug = config.slugs[wrapped];
  // `slug` is a tuple element, but TypeScript still narrows it to
  // `string | undefined` under `noUncheckedIndexedAccess`. The wrap
  // above guarantees we land in [0, 8), so the lookup is always
  // defined — fallback to slot 0 keeps the URL well-formed if the
  // tuple ever shortens by mistake.
  const safeSlug = slug ?? config.slugs[0];
  return `${GENERATED_SPRITES_ROOT}/${config.characterId}/${wrapped}_${safeSlug}.png`;
}

/**
 * Wrap a palette index into [0, PALETTE_VARIANTS_PER_CHARACTER). Mirrors
 * the same helper inside `src/characters/palettes.ts` so the manifest's
 * key composition agrees with the runtime palette table.
 */
function wrapPaletteIndex(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const i = Math.trunc(raw);
  return (
    ((i % PALETTE_VARIANTS_PER_CHARACTER) + PALETTE_VARIANTS_PER_CHARACTER) %
    PALETTE_VARIANTS_PER_CHARACTER
  );
}

/**
 * Manifest entries for every palette variant in
 * {@link PALETTE_VARIANT_CHARACTERS}, in `(characterId, paletteIndex)`
 * order. Built once at module load — the inputs are frozen, so
 * iteration here is pure.
 */
const paletteVariantSpritesheets: readonly SpritesheetAssetEntry[] = (() => {
  const out: SpritesheetAssetEntry[] = [];
  for (const config of PALETTE_VARIANT_CHARACTERS) {
    for (let i = 0; i < PALETTE_VARIANTS_PER_CHARACTER; i++) {
      out.push({
        key: paletteVariantTextureKey(config.characterId, i),
        kind: 'spritesheet',
        url: paletteVariantUrl(config, i),
        frameWidth: config.frameWidth,
        frameHeight: config.frameHeight,
        frameCount: config.frameCount,
      });
    }
  }
  return Object.freeze(out);
})();

// ---------------------------------------------------------------------
// Stage tile spritesheet entries
// ---------------------------------------------------------------------
//
// Both M1 tilemap atlases ship with a 1 px gutter between cells —
// `margin` is the outer border and `spacing` is the per-cell separator
// (Kenney's atlas convention, verified against `Tilesheet-*.txt`).

const stageM1Spritesheets: readonly SpritesheetAssetEntry[] = [
  {
    key: ASSET_KEYS.stageM1Tilemap,
    kind: 'spritesheet',
    url: `${STAGE_ROOT}/m1/tilemap/tilemap.png`,
    frameWidth: 18,
    frameHeight: 18,
    frameCount: 180, // 20 cols × 9 rows
    margin: 0,
    spacing: 1,
  },
  {
    key: ASSET_KEYS.stageM1Background,
    kind: 'spritesheet',
    url: `${STAGE_ROOT}/m1/tilemap/tilemap-backgrounds.png`,
    frameWidth: 24,
    frameHeight: 24,
    frameCount: 24, // 8 cols × 3 rows
    margin: 0,
    spacing: 1,
  },
];

// ---------------------------------------------------------------------
// Stage background band images — themed parallax layers
// ---------------------------------------------------------------------
//
// Single 24×24 tiles (not the packed atlas) because Phaser's
// `TileSprite` repeats a *texture*, not a spritesheet frame. Each tile
// is horizontally seamless, so one image yields an arbitrarily wide
// scrolling band. Tile choices were eyeballed from the Kenney
// `tilemap-backgrounds` set: 0008/0010 are cloud rows, 0012 is a sandy
// dune crest, 0014 is a rolling hill crest that tints well.

const stageBackgroundImages: readonly ImageAssetEntry[] = [
  {
    key: ASSET_KEYS.stageBgClouds,
    kind: 'image',
    url: `${STAGE_ROOT}/m1/background/tile_0008.png`,
  },
  {
    key: ASSET_KEYS.stageBgWisps,
    kind: 'image',
    url: `${STAGE_ROOT}/m1/background/tile_0010.png`,
  },
  {
    key: ASSET_KEYS.stageBgDunes,
    kind: 'image',
    url: `${STAGE_ROOT}/m1/background/tile_0012.png`,
  },
  {
    key: ASSET_KEYS.stageBgHills,
    kind: 'image',
    url: `${STAGE_ROOT}/m1/background/tile_0014.png`,
  },
];

// ---------------------------------------------------------------------
// Item entries — bomb sprite + explosion frame strip (Kenney Particle Pack)
// ---------------------------------------------------------------------

const itemSpritesheets: readonly SpritesheetAssetEntry[] = [
  {
    key: ASSET_KEYS.itemExplosion,
    kind: 'spritesheet',
    url: `${ITEM_SPRITES_ROOT}/explosion.png`,
    frameWidth: 96,
    frameHeight: 96,
    frameCount: 3, // flash → fireball → smoke
    margin: 0,
    spacing: 0,
  },
];

// Single-frame item sprites loaded as plain images, not spritesheets.
const itemImages: readonly ImageAssetEntry[] = [
  {
    key: ASSET_KEYS.itemBomb,
    kind: 'image',
    url: `${ITEM_SPRITES_ROOT}/bomb.png`,
  },
  {
    key: ASSET_KEYS.itemBat,
    kind: 'image',
    url: `${ITEM_SPRITES_ROOT}/bat.png`,
  },
  {
    key: ASSET_KEYS.itemRayGun,
    kind: 'image',
    url: `${ITEM_SPRITES_ROOT}/raygun.png`,
  },
  {
    key: ASSET_KEYS.itemSword,
    kind: 'image',
    url: `${ITEM_SPRITES_ROOT}/sword.png`,
  },
  {
    key: ASSET_KEYS.itemSpear,
    kind: 'image',
    url: `${ITEM_SPRITES_ROOT}/spear.png`,
  },
  {
    key: ASSET_KEYS.itemHammer,
    kind: 'image',
    url: `${ITEM_SPRITES_ROOT}/hammer.png`,
  },
];

// ---------------------------------------------------------------------
// Audio entries
// ---------------------------------------------------------------------
//
// All current cuts ship as `.ogg` (Vorbis @ 44.1 kHz). M2 may add
// `.mp3` companions for Safari/iOS — the array form already supports
// that without a manifest reshape.

const sfxAudio: readonly AudioAssetEntry[] = [
  { key: ASSET_KEYS.sfxJab, kind: 'audio', urls: [`${SFX_ROOT}/jab.ogg`] },
  { key: ASSET_KEYS.sfxTilt, kind: 'audio', urls: [`${SFX_ROOT}/tilt.ogg`] },
  { key: ASSET_KEYS.sfxSmash, kind: 'audio', urls: [`${SFX_ROOT}/smash.ogg`] },
  { key: ASSET_KEYS.sfxAerial, kind: 'audio', urls: [`${SFX_ROOT}/aerial.ogg`] },
  { key: ASSET_KEYS.sfxKo, kind: 'audio', urls: [`${SFX_ROOT}/ko.ogg`] },
  { key: ASSET_KEYS.sfxShield, kind: 'audio', urls: [`${SFX_ROOT}/shield.ogg`] },
  { key: ASSET_KEYS.sfxDodge, kind: 'audio', urls: [`${SFX_ROOT}/dodge.ogg`] },
  // M1.5 action-audio expansion — shipped as 44.1 kHz `.wav` (Kenney
  // Interface Sounds are distributed as WAV in the CC0 mirror; Phaser's
  // `load.audio` decodes WAV natively, so no transcode step is needed).
  { key: ASSET_KEYS.sfxJump, kind: 'audio', urls: [`${SFX_ROOT}/jump.wav`] },
  { key: ASSET_KEYS.sfxJumpAir, kind: 'audio', urls: [`${SFX_ROOT}/jump_air.wav`] },
  { key: ASSET_KEYS.sfxLand, kind: 'audio', urls: [`${SFX_ROOT}/land.wav`] },
  { key: ASSET_KEYS.sfxHitLight, kind: 'audio', urls: [`${SFX_ROOT}/hit_light.wav`] },
  { key: ASSET_KEYS.sfxHitHeavy, kind: 'audio', urls: [`${SFX_ROOT}/hit_heavy.wav`] },
  { key: ASSET_KEYS.sfxClang, kind: 'audio', urls: [`${SFX_ROOT}/clang.wav`] },
  { key: ASSET_KEYS.sfxShieldBreak, kind: 'audio', urls: [`${SFX_ROOT}/shield_break.wav`] },
  { key: ASSET_KEYS.sfxCharge, kind: 'audio', urls: [`${SFX_ROOT}/charge.wav`] },
];

const musicAudio: readonly AudioAssetEntry[] = [
  {
    key: ASSET_KEYS.musicStageDefault,
    kind: 'music',
    // Primary: the user's track re-encoded to OGG/Vorbis (44.1 kHz
    // stereo, ~160 kbps, no ID3) so `audioContext.decodeAudioData`
    // accepts it cleanly across Chromium / Firefox. The original
    // MP3 was 200-OK on the wire but rejected silently by WebAudio
    // (likely VBR / non-standard frame headers from the YouTube
    // encoder); the OGG re-encode side-steps that.
    //
    // Phaser's `load.audio(key, urls)` array is **codec-fallback**:
    // it picks the FIRST URL whose extension the browser can play
    // and never retries on failure. Order is OGG → MP3 → legacy OGG
    // so:
    //   • Chromium / Firefox / Edge → re-encoded `stage_main.ogg`
    //   • Safari (no OGG/Vorbis)    → re-encoded `stage_main.mp3`
    //   • Anything else             → `stage_8bit_loop.ogg` Kenney loop
    urls: [
      `${MUSIC_ROOT}/stage_main.ogg`,
      `${MUSIC_ROOT}/stage_main.mp3`,
      `${MUSIC_ROOT}/stage_8bit_loop.ogg`,
    ],
  },
];

// ---------------------------------------------------------------------
// Top-level manifest
// ---------------------------------------------------------------------

/**
 * Frozen, single source of truth consumed by {@link PreloadScene}.
 *
 * Every entry is a `readonly` `as const` value so accidental
 * push/splice mutations are loud (TypeScript) and runtime-safe
 * (Object.freeze recursion would be costly across ~hundreds of
 * entries; the readonly types give us static safety with zero
 * runtime cost).
 */
export const ASSET_MANIFEST: AssetManifest = {
  images: [...itemImages, ...stageBackgroundImages],
  spritesheets: [
    ...catSpritesheets,
    ...wolfSpritesheets,
    ...owlSpritesheets,
    ...bearSpritesheets,
    ...blazeSpritesheets,
    ...puffSpritesheets,
    ...aegisSpritesheets,
    ...voltSpritesheets,
    ...novaSpritesheets,
    ...brunoSpritesheets,
    ...linkSpritesheets,
    ...linkMovesetSpritesheets,
    ...kirbySpritesheets,
    ...donkeykongSpritesheets,
    ...paletteVariantSpritesheets,
    ...stageM1Spritesheets,
    ...itemSpritesheets,
  ],
  atlases: [],
  audio: sfxAudio,
  music: musicAudio,
};

/**
 * Look up a palette variant manifest entry by `(characterId, paletteIndex)`.
 *
 * Convenience wrapper around {@link findAssetEntry} that knows the
 * texture key composition rules so callers don't have to reach into
 * `paletteVariantTextureKey` themselves. Returns `undefined` when the
 * character has no variant sheets registered (Owl/Bear in M1) — that's
 * the runtime's signal to fall back to the tint pipeline.
 */
export function findPaletteVariantEntry(
  characterId: string,
  paletteIndex: number,
  manifest: AssetManifest = ASSET_MANIFEST,
): SpritesheetAssetEntry | undefined {
  // Only `wolf`/`cat` have variants today; calling
  // `paletteVariantTextureKey` for an unknown id would still produce a
  // well-formed string, but the lookup below would miss — same effect,
  // and the caller can treat `undefined` as "not registered".
  const key = `char.${characterId}.palette.${
    Number.isFinite(paletteIndex)
      ? ((Math.trunc(paletteIndex) % PALETTE_VARIANTS_PER_CHARACTER) +
          PALETTE_VARIANTS_PER_CHARACTER) %
        PALETTE_VARIANTS_PER_CHARACTER
      : 0
  }`;
  const entry = findAssetEntry(key, manifest);
  return entry?.kind === 'spritesheet' ? entry : undefined;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/**
 * Return every entry in the manifest as a flat list. Useful for tests
 * and tooling (e.g. the asset-licence audit script in M5) that don't
 * care about the per-loader split.
 */
export function getAllAssetEntries(
  manifest: AssetManifest = ASSET_MANIFEST,
): readonly AssetEntry[] {
  return [
    ...manifest.images,
    ...manifest.spritesheets,
    ...manifest.atlases,
    ...manifest.audio,
    ...manifest.music,
  ];
}

/**
 * Resolve an entry by its cache key. Returns `undefined` if the key
 * isn't in the manifest — callers can decide whether that's an error
 * (PreloadScene treats it as an unrecoverable bug; the asset-licence
 * audit treats it as a warning).
 */
export function findAssetEntry(
  key: string,
  manifest: AssetManifest = ASSET_MANIFEST,
): AssetEntry | undefined {
  return getAllAssetEntries(manifest).find((entry) => entry.key === key);
}
