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

import {FOOD_VARIANTS} from '../items/Food';
import {packedLayoutOf,type FrameTrim} from './packedFrames';
import pikachuFinalVisualMetadata from '../../assets/characters/pikachu/final-visual-frames.json';
import {legacySheets} from './legacyFighterSheets';

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
  /** Tight-packed sheets (see `packedFrames.ts`): the image size and one trim per drawing. */
  readonly atlas?: readonly [number, number];
  readonly trims?: readonly FrameTrim[];
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
 * cache is unambiguous.
 *
 * Boot-generated procedural textures live in
 * `src/scenes/bootKeys.ts` under the `tex.boot.*` namespace and are
 * intentionally NOT duplicated here — keeping the boot keys distinct
 * from loaded-asset keys means a missing manifest entry is loud at
 * preload time instead of silently aliasing the boot pixel.
 */
export const ASSET_KEYS = {

  // ---------------- characters: link ---------------------------------
  // The roster sprite key; every Link sheet is `char.link.<clip>` from assets/characters/link/frames.json.
  charLinkIdle: 'char.link.idle',

  // Pikachu — dedicated source kit; only reviewed packed sheets load below.
  charPikachuIdle: 'char.pikachu.idle',
  charPikachuFinal: 'char.pikachu.final',
  charPikachuFinalAir: 'char.pikachu.final_air',
  charPikachuFinalDash: 'char.pikachu.final_dash',
  charPikachuFinalDashEnd: 'char.pikachu.final_dash_end',
  charPikachuFinalAirDashEnd: 'char.pikachu.final_air_dash_end',
  charPikachuFinal2: 'char.pikachu.final2',
  charPikachuFinalAir2: 'char.pikachu.final_air2',
  charPikachuFinalVictimJungleEntry: 'char.pikachu.final_victim_jungle_entry',
  charPikachuFinalVictimJungleStaggerA: 'char.pikachu.final_victim_jungle_stagger_a',
  charPikachuFinalVictimJungleStaggerB: 'char.pikachu.final_victim_jungle_stagger_b',
  charPikachuFinalVictimJungleUppercutPre: 'char.pikachu.final_victim_jungle_uppercut_pre',
  charPikachuFinalVictimVoltCaught: 'char.pikachu.final_victim_volt_caught',
  charPikachuFinalVictimVoltVortex: 'char.pikachu.final_victim_volt_vortex',
  charPikachuFinalVictimVoltBurstPre: 'char.pikachu.final_victim_volt_burst_pre',
  // Installed source-guided noncombat Final FX own exact registered pages.
  charPikachuFinalFxElec: 'char.pikachu.fx__pikachu_final_elec',
  charPikachuFinalFxExplosion: 'char.pikachu.fx__pikachu_final_explosion',
  charPikachuFinalFxHold: 'char.pikachu.fx__pikachu_final_hold',
  charPikachuFinalFxSphereStart: 'char.pikachu.fx__pikachu_final_sphere_start',
  charPikachuRun: 'char.pikachu.run',
  charPikachuJump: 'char.pikachu.jump',
  charPikachuAttack: 'char.pikachu.attack',
  charPikachuCrouch: 'char.pikachu.crouch',
  charPikachuJab: 'char.pikachu.jab',
  charPikachuTilt: 'char.pikachu.tilt',
  charPikachuTiltUp: 'char.pikachu.tilt_up',
  charPikachuTiltDown: 'char.pikachu.tilt_down',
  charPikachuUtilt: 'char.pikachu.utilt',
  charPikachuDtilt: 'char.pikachu.dtilt',
  charPikachuSmash: 'char.pikachu.smash',
  charPikachuSmashCharge: 'char.pikachu.smash_charge',
  charPikachuUsmashCharge: 'char.pikachu.usmash_charge',
  charPikachuDsmashCharge: 'char.pikachu.dsmash_charge',
  charPikachuUsmash: 'char.pikachu.usmash',
  charPikachuDsmash: 'char.pikachu.dsmash',
  charPikachuDashAttack: 'char.pikachu.dash_attack',
  charPikachuNair: 'char.pikachu.nair',
  charPikachuFair: 'char.pikachu.fair',
  charPikachuBair: 'char.pikachu.bair',
  charPikachuUair: 'char.pikachu.uair',
  charPikachuDair: 'char.pikachu.dair',
  charPikachuBairLanding: 'char.pikachu.bair_landing',
  charPikachuDairLanding: 'char.pikachu.dair_landing',
  charPikachuNeutralSpecial: 'char.pikachu.neutral_special',
  charPikachuNeutralSpecialAir: 'char.pikachu.neutral_special_air',
  charPikachuUpSpecialStart: 'char.pikachu.up_special_start',
  charPikachuUpSpecialAirStart: 'char.pikachu.up_special_air_start',
  charPikachuUpSpecialAirEnd: 'char.pikachu.up_special_air_end',
  charPikachuSideSpecialStart: 'char.pikachu.side_special_start',
  charPikachuSideSpecialAirStart: 'char.pikachu.side_special_air_start',
  charPikachuSideSpecialHold: 'char.pikachu.side_special_hold',
  charPikachuSideSpecialAirHold: 'char.pikachu.side_special_air_hold',
  charPikachuSideSpecialReady: 'char.pikachu.side_special_ready',
  charPikachuSideSpecialAirReady: 'char.pikachu.side_special_air_ready',
  charPikachuSideSpecialHit: 'char.pikachu.side_special_hit',
  charPikachuSideSpecialAirHit: 'char.pikachu.side_special_air_hit',
  charPikachuSideSpecialEnd: 'char.pikachu.side_special_end',
  charPikachuSideSpecialAirMissEnd: 'char.pikachu.side_special_air_miss_end',
  charPikachuSideSpecial: 'char.pikachu.side_special',
  charPikachuUpSpecial: 'char.pikachu.up_special',
  charPikachuUpSpecialFirst: 'char.pikachu.up_special_first',
  charPikachuUpSpecialSecond: 'char.pikachu.up_special_second',
  charPikachuUpSpecialEnd: 'char.pikachu.up_special_end',
  charPikachuDownSpecial: 'char.pikachu.down_special',
  charPikachuDownSpecialAir: 'char.pikachu.down_special_air',
  charPikachuDownSpecialHit: 'char.pikachu.down_special_hit',
  charPikachuDownSpecialAirHit: 'char.pikachu.down_special_air_hit',
  charPikachuAirDodge: 'char.pikachu.air_dodge',
  charPikachuAirjump: 'char.pikachu.airjump',
  charPikachuAirjumpBack: 'char.pikachu.airjump_back',
  charPikachuCaptured: 'char.pikachu.captured',
  charPikachuCapturedHit: 'char.pikachu.captured_hit',
  charPikachuCapturedRelease: 'char.pikachu.captured_release',
  charPikachuCrawl: 'char.pikachu.crawl',
  charPikachuCrawlBack: 'char.pikachu.crawl_back',
  charPikachuCrouchEnd: 'char.pikachu.crouch_end',
  charPikachuCrouchStart: 'char.pikachu.crouch_start',
  charPikachuDash: 'char.pikachu.dash',
  charPikachuDashGrab: 'char.pikachu.dash_grab',
  charPikachuDashTurn: 'char.pikachu.dash_turn',
  charPikachuDownWait: 'char.pikachu.down_wait',
  charPikachuDownWaitFaceDown: 'char.pikachu.down_wait_face_down',
  charPikachuEntry: 'char.pikachu.entry',
  charPikachuFall: 'char.pikachu.fall',
  charPikachuFallSpecial: 'char.pikachu.fall_special',
  charPikachuFootstoolFall: 'char.pikachu.footstool_fall',
  charPikachuFootstoolJump: 'char.pikachu.footstool_jump',
  charPikachuFootstoolPose: 'char.pikachu.footstool_pose',
  charPikachuFootstoolAirPose: 'char.pikachu.footstool_air_pose',
  charPikachuItemCarry: 'char.pikachu.item_carry',
  charPikachuItemPickupStand: 'char.pikachu.item_pickup_stand',
  charPikachuItemPickupWalk: 'char.pikachu.item_pickup_walk',
  charPikachuItemThrowF: 'char.pikachu.item_throw_f',
  charPikachuItemThrowB: 'char.pikachu.item_throw_b',
  charPikachuItemThrowHi: 'char.pikachu.item_throw_hi',
  charPikachuItemThrowLw: 'char.pikachu.item_throw_lw',
  charPikachuItemThrowAirF: 'char.pikachu.item_throw_air_f',
  charPikachuItemThrowAirB: 'char.pikachu.item_throw_air_b',
  charPikachuItemThrowAirHi: 'char.pikachu.item_throw_air_hi',
  charPikachuItemThrowAirLw: 'char.pikachu.item_throw_air_lw',
  charPikachuItemThrowDrop: 'char.pikachu.item_throw_drop',
  charPikachuItemBatSwing1: 'char.pikachu.item_bat_swing_1',
  charPikachuItemBatSwing3: 'char.pikachu.item_bat_swing_3',
  charPikachuItemBatSwing4: 'char.pikachu.item_bat_swing_4',
  charPikachuItemBatSwingDash: 'char.pikachu.item_bat_swing_dash',
  charPikachuItemSwordSwing4: 'char.pikachu.item_sword_swing_4',
  charPikachuItemSwordSwing4Hold: 'char.pikachu.item_sword_swing_4_hold',
  charPikachuItemHammerJump: 'char.pikachu.item_hammer_jump',
  charPikachuItemHammerMove: 'char.pikachu.item_hammer_move',
  charPikachuItemHammerWait: 'char.pikachu.item_hammer_wait',
  charPikachuItemHeavyGet: 'char.pikachu.item_heavy_get',
  charPikachuItemHeavyWalk: 'char.pikachu.item_heavy_walk',
  charPikachuItemHeavyThrowF: 'char.pikachu.item_heavy_throw_f',
  charPikachuItemHeavyThrowB: 'char.pikachu.item_heavy_throw_b',
  charPikachuItemHeavyThrowHi: 'char.pikachu.item_heavy_throw_hi',
  charPikachuItemHeavyThrowLw: 'char.pikachu.item_heavy_throw_lw',
  charPikachuSquatWaitItem: 'char.pikachu.squat_wait_item',
  charPikachuLandingHeavy: 'char.pikachu.landing_heavy',
  charPikachuItemLightEat: 'char.pikachu.item_light_eat',
  charPikachuItemLightWalkEat: 'char.pikachu.item_light_walk_eat',
  charPikachuItemLgunShoot: 'char.pikachu.item_lgun_shoot',
  charPikachuItemLgunShootAir: 'char.pikachu.item_lgun_shoot_air',
  charPikachuItemLgunShootUpper: 'char.pikachu.item_lgun_shoot_upper',
  charPikachuItemFflowerShootLoop: 'char.pikachu.item_fflower_shoot_loop',
  charPikachuItemFflowerShootLoopUpper: 'char.pikachu.item_fflower_shoot_loop_upper',
  charPikachuItemFflowerShootAirLoop: 'char.pikachu.item_fflower_shoot_air_loop',
  charPikachuItemScopeStart: 'char.pikachu.item_scope_start',
  charPikachuItemScopeStartUpper: 'char.pikachu.item_scope_start_upper',
  charPikachuItemScopeWait: 'char.pikachu.item_scope_wait',
  charPikachuItemScopeWaitUpper: 'char.pikachu.item_scope_wait_upper',
  charPikachuItemScopeRapid: 'char.pikachu.item_scope_rapid',
  charPikachuItemScopeRapidUpper: 'char.pikachu.item_scope_rapid_upper',
  charPikachuItemScopeFire: 'char.pikachu.item_scope_fire',
  charPikachuItemScopeFireUpper: 'char.pikachu.item_scope_fire_upper',
  charPikachuItemScopeEnd: 'char.pikachu.item_scope_end',
  charPikachuItemScopeEndUpper: 'char.pikachu.item_scope_end_upper',
  charPikachuItemScopeFall: 'char.pikachu.item_scope_fall',
  charPikachuItemScopeAirStart: 'char.pikachu.item_scope_air_start',
  charPikachuItemScopeAirRapid: 'char.pikachu.item_scope_air_rapid',
  charPikachuItemScopeAirFire: 'char.pikachu.item_scope_air_fire',
  charPikachuItemScopeAirEnd: 'char.pikachu.item_scope_air_end',
  charPikachuItemShootLegsWalkF: 'char.pikachu.item_shoot_legs_walk_f',
  charPikachuItemShootLegsWalkB: 'char.pikachu.item_shoot_legs_walk_b',
  charPikachuItemShootLegsJumpSquat: 'char.pikachu.item_shoot_legs_jump_squat',
  charPikachuItemShootLegsLanding: 'char.pikachu.item_shoot_legs_landing',
  charPikachuGetup: 'char.pikachu.getup',
  charPikachuGetupFaceDown: 'char.pikachu.getup_face_down',
  charPikachuGetupRoll: 'char.pikachu.getup_roll',
  charPikachuGetupRollBack: 'char.pikachu.getup_roll_back',
  charPikachuGetupRollBackFaceDown: 'char.pikachu.getup_roll_back_face_down',
  charPikachuGetupRollFaceDown: 'char.pikachu.getup_roll_face_down',
  charPikachuGrabEscape: 'char.pikachu.grab_escape',
  charPikachuGrabHold: 'char.pikachu.grab_hold',
  charPikachuGrabPull: 'char.pikachu.grab_pull',
  charPikachuHurtAir: 'char.pikachu.hurt_air',
  charPikachuJumpBack: 'char.pikachu.jump_back',
  charPikachuJumpsquat: 'char.pikachu.jumpsquat',
  charPikachuLandingHard: 'char.pikachu.landing_hard',
  charPikachuLandingSoft: 'char.pikachu.landing_soft',
  charPikachuLandingSpecial: 'char.pikachu.landing_special',
  charPikachuLedge: 'char.pikachu.ledge',
  charPikachuLedgeCatch: 'char.pikachu.ledge_catch',
  charPikachuLedgeGetup: 'char.pikachu.ledge_getup',
  charPikachuLedgeJump: 'char.pikachu.ledge_jump',
  charPikachuLedgeJumpStart: 'char.pikachu.ledge_jump_start',
  charPikachuLedgeRoll: 'char.pikachu.ledge_roll',
  charPikachuParry: 'char.pikachu.parry',
  charPikachuPivotGrab: 'char.pikachu.pivot_grab',
  charPikachuRoll: 'char.pikachu.roll',
  charPikachuRollBack: 'char.pikachu.roll_back',
  charPikachuRunBrake: 'char.pikachu.run_brake',
  charPikachuRunBrakeLeft: 'char.pikachu.run_brake_left',
  charPikachuRunTurn: 'char.pikachu.run_turn',
  charPikachuShieldBreak: 'char.pikachu.shield_break',
  charPikachuShieldBreakEnd: 'char.pikachu.shield_break_end',
  charPikachuShieldEnd: 'char.pikachu.shield_end',
  charPikachuShieldHit: 'char.pikachu.shield_hit',
  charPikachuShieldStart: 'char.pikachu.shield_start',
  charPikachuSpotDodge: 'char.pikachu.spot_dodge',
  charPikachuTauntDown: 'char.pikachu.taunt_down',
  charPikachuTauntSide: 'char.pikachu.taunt_side',
  charPikachuTauntUp: 'char.pikachu.taunt_up',
  charPikachuTech: 'char.pikachu.tech',
  charPikachuTechBack: 'char.pikachu.tech_back',
  charPikachuTechCeiling: 'char.pikachu.tech_ceiling',
  charPikachuTechForward: 'char.pikachu.tech_forward',
  charPikachuTechWall: 'char.pikachu.tech_wall',
  charPikachuTrip: 'char.pikachu.trip',
  charPikachuTumble: 'char.pikachu.tumble',
  charPikachuWalk: 'char.pikachu.walk',
  charPikachuWalkFast: 'char.pikachu.walk_fast',
  charPikachuWalkSlow: 'char.pikachu.walk_slow',
  charPikachuWallJump: 'char.pikachu.wall_jump',
  charPikachuHurt: 'char.pikachu.hurt',
  charPikachuShield: 'char.pikachu.shield',
  charPikachuGrab: 'char.pikachu.grab',
  charPikachuPummel: 'char.pikachu.pummel',
  charPikachuFthrow: 'char.pikachu.fthrow',
  charPikachuBthrow: 'char.pikachu.bthrow',
  charPikachuUthrow: 'char.pikachu.uthrow',
  charPikachuDthrow: 'char.pikachu.dthrow',
  charPikachuGetupAttack: 'char.pikachu.getup_attack',
  charPikachuGetupAttackFaceDown: 'char.pikachu.getup_attack_face_down',
  charPikachuTripAttack: 'char.pikachu.trip_attack',
  charPikachuLedgeAttack: 'char.pikachu.ledge_attack',
  // ---------------- characters: donkeykong (full AI sprite set) ------
  charDonkeykongIdle: 'char.donkeykong.idle',
  charDonkeykongRun: 'char.donkeykong.run',
  charDonkeykongJump: 'char.donkeykong.jump',
  charDonkeykongAttack: 'char.donkeykong.attack',
  charDonkeykongCrouch: 'char.donkeykong.crouch',
  charDonkeykongJab: 'char.donkeykong.jab',
  charDonkeykongJab2: 'char.donkeykong.jab2',
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
  charDonkeykongGrabPull: 'char.donkeykong.grab_pull',
  charDonkeykongGrabHold: 'char.donkeykong.grab_hold',
  charDonkeykongPummel: 'char.donkeykong.pummel',
  charDonkeykongFthrow: 'char.donkeykong.fthrow',
  charDonkeykongBthrow: 'char.donkeykong.bthrow',
  charDonkeykongUthrow: 'char.donkeykong.uthrow',
  charDonkeykongDthrow: 'char.donkeykong.dthrow',
  charDonkeykongUair: 'char.donkeykong.uair',
  charDonkeykongDair: 'char.donkeykong.dair',
  charDonkeykongUtilt: 'char.donkeykong.utilt',
  charDonkeykongUsmash: 'char.donkeykong.usmash',
  charDonkeykongDsmash: 'char.donkeykong.dsmash',
  charDonkeykongDashAttack: 'char.donkeykong.dash_attack',
  charDonkeykongUpSpecialGround: 'char.donkeykong.up_special_ground',
  charDonkeykongDownSpecialAir: 'char.donkeykong.down_special_air',
  // Reworked locomotion family (native-timed, no frameWindows).
  charDonkeykongWalk: 'char.donkeykong.walk',
  charDonkeykongDash: 'char.donkeykong.dash',
  charDonkeykongDashTurn: 'char.donkeykong.dash_turn',
  charDonkeykongRunTurn: 'char.donkeykong.run_turn',
  charDonkeykongRunBrake: 'char.donkeykong.run_brake',
  charDonkeykongRunBrakeLeft: 'char.donkeykong.run_brake_left',
  charDonkeykongCrouchStart: 'char.donkeykong.crouch_start',
  charDonkeykongCrouchEnd: 'char.donkeykong.crouch_end',
  charDonkeykongJumpsquat: 'char.donkeykong.jumpsquat',
  charDonkeykongJumpShort: 'char.donkeykong.jump_short',
  charDonkeykongAirjump: 'char.donkeykong.airjump',
  charDonkeykongAirDrift: 'char.donkeykong.air_drift',
  charDonkeykongFall: 'char.donkeykong.fall',
  charDonkeykongFallFast: 'char.donkeykong.fall_fast',
  charDonkeykongJumpB: 'char.donkeykong.jump_b',
  charDonkeykongJumpShortB: 'char.donkeykong.jump_short_b',
  charDonkeykongAirjumpB: 'char.donkeykong.airjump_b',
  charDonkeykongFallB: 'char.donkeykong.fall_b',
  charDonkeykongFallAerial: 'char.donkeykong.fall_aerial',
  charDonkeykongFallAerialF: 'char.donkeykong.fall_aerial_f',
  charDonkeykongFallAerialB: 'char.donkeykong.fall_aerial_b',
  charDonkeykongLandingSoft: 'char.donkeykong.landing_soft',
  charDonkeykongLandingHard: 'char.donkeykong.landing_hard',
  // Reworked ground-attacks family: new keys (the other clips reuse existing keys).
  charDonkeykongTiltUp: 'char.donkeykong.tilt_up',
  charDonkeykongTiltDown: 'char.donkeykong.tilt_down',
  charDonkeykongSmashCharge: 'char.donkeykong.smash_charge',
  charDonkeykongUsmashCharge: 'char.donkeykong.usmash_charge',
  charDonkeykongDsmashCharge: 'char.donkeykong.dsmash_charge',
  // Reworked specials family: new keys (the other clips reuse existing keys).
  charDonkeykongNeutralSpecialCharge: 'char.donkeykong.neutral_special_charge',
  charDonkeykongNeutralSpecialCancel: 'char.donkeykong.neutral_special_cancel',
  charDonkeykongNeutralSpecialAir: 'char.donkeykong.neutral_special_air',
  charDonkeykongNeutralSpecialAirCharge: 'char.donkeykong.neutral_special_air_charge',
  charDonkeykongNeutralSpecialAirCancel: 'char.donkeykong.neutral_special_air_cancel',
  charDonkeykongSideSpecialAir: 'char.donkeykong.side_special_air',
  charDonkeykongUpSpecialAir: 'char.donkeykong.up_special_air',
  charDonkeykongUpSpecialAirLand: 'char.donkeykong.up_special_air_land',
  charDonkeykongDownSpecialAirLand: 'char.donkeykong.down_special_air_land',
  charDonkeykongAirDodge: 'char.donkeykong.air_dodge',
  charDonkeykongRoll: 'char.donkeykong.roll',
  charDonkeykongRollBack: 'char.donkeykong.roll_back',
  charDonkeykongShieldBreak: 'char.donkeykong.shield_break',
  // Ledge / recovery / downed / footstool / captured / parry art (2026-10-11).
  charDonkeykongCaptured: 'char.donkeykong.captured',
  charDonkeykongCapturedHit: 'char.donkeykong.captured_hit',
  charDonkeykongCapturedRelease: 'char.donkeykong.captured_release',
  charDonkeykongDownWait: 'char.donkeykong.down_wait',
  charDonkeykongDownWaitFaceDown: 'char.donkeykong.down_wait_face_down',
  charDonkeykongEntry: 'char.donkeykong.entry',
  charDonkeykongFallSpecial: 'char.donkeykong.fall_special',
  charDonkeykongFootstoolAirPose: 'char.donkeykong.footstool_air_pose',
  charDonkeykongFootstoolJumpMini: 'char.donkeykong.footstool_jump_mini',
  charDonkeykongFootstoolPose: 'char.donkeykong.footstool_pose',
  charDonkeykongGetup: 'char.donkeykong.getup',
  charDonkeykongGetupAttack: 'char.donkeykong.getup_attack',
  charDonkeykongGetupAttackFaceDown: 'char.donkeykong.getup_attack_face_down',
  charDonkeykongGetupRoll: 'char.donkeykong.getup_roll',
  charDonkeykongLedge: 'char.donkeykong.ledge',
  charDonkeykongLedgeAttack: 'char.donkeykong.ledge_attack',
  charDonkeykongLedgeCatch: 'char.donkeykong.ledge_catch',
  charDonkeykongLedgeGetup: 'char.donkeykong.ledge_getup',
  charDonkeykongLedgeJump: 'char.donkeykong.ledge_jump',
  charDonkeykongLedgeRoll: 'char.donkeykong.ledge_roll',
  charDonkeykongTech: 'char.donkeykong.tech',
  charDonkeykongTechBack: 'char.donkeykong.tech_back',
  charDonkeykongTechCeiling: 'char.donkeykong.tech_ceiling',
  charDonkeykongTechForward: 'char.donkeykong.tech_forward',
  charDonkeykongTechWall: 'char.donkeykong.tech_wall',
  charDonkeykongTechWallJump: 'char.donkeykong.tech_wall_jump',
  charDonkeykongTrip: 'char.donkeykong.trip',
  charDonkeykongTripAttack: 'char.donkeykong.trip_attack',
  charDonkeykongTumble: 'char.donkeykong.tumble',
  charDonkeykongParry: 'char.donkeykong.parry',
  charDonkeykongItemPickupStand: 'char.donkeykong.item_pickup_stand',
  charDonkeykongItemCarry: 'char.donkeykong.item_carry',
  charDonkeykongItemThrowF: 'char.donkeykong.item_throw_f',
  charDonkeykongTauntUpR: 'char.donkeykong.taunt_up_r',
  charDonkeykongTauntSideR: 'char.donkeykong.taunt_side_r',
  charDonkeykongTauntDownR: 'char.donkeykong.taunt_down_r',
  charDonkeykongItemThrowB: 'char.donkeykong.item_throw_b',
  charDonkeykongItemThrowHi: 'char.donkeykong.item_throw_hi',
  charDonkeykongItemThrowLw: 'char.donkeykong.item_throw_lw',
  charDonkeykongItemThrowAirF: 'char.donkeykong.item_throw_air_f',
  charDonkeykongItemThrowAirB: 'char.donkeykong.item_throw_air_b',
  charDonkeykongItemThrowAirHi: 'char.donkeykong.item_throw_air_hi',
  charDonkeykongItemThrowAirLw: 'char.donkeykong.item_throw_air_lw',
  charDonkeykongItemThrowDash: 'char.donkeykong.item_throw_dash',
  charDonkeykongItemThrowDrop: 'char.donkeykong.item_throw_drop',
  charDonkeykongItemPickupWalk: 'char.donkeykong.item_pickup_walk',
  charDonkeykongItemBatSwing1: 'char.donkeykong.item_bat_swing_1',
  charDonkeykongItemBatSwing3: 'char.donkeykong.item_bat_swing_3',
  charDonkeykongItemBatSwing4: 'char.donkeykong.item_bat_swing_4',
  charDonkeykongItemSwordSwing4: 'char.donkeykong.item_sword_swing_4',
  charDonkeykongItemHammerJump: 'char.donkeykong.item_hammer_jump',
  charDonkeykongItemHammerMove: 'char.donkeykong.item_hammer_move',
  charDonkeykongItemHammerWait: 'char.donkeykong.item_hammer_wait',
  charDonkeykongItemLightEat: 'char.donkeykong.item_light_eat',
  charDonkeykongItemLightWalkEat: 'char.donkeykong.item_light_walk_eat',
  charDonkeykongItemLgunShoot: 'char.donkeykong.item_lgun_shoot',
  charDonkeykongItemLgunShootAir: 'char.donkeykong.item_lgun_shoot_air',
  charDonkeykongItemBatSwingDash: 'char.donkeykong.item_bat_swing_dash',
  charDonkeykongItemSwordSwing4Hold: 'char.donkeykong.item_sword_swing_4_hold',
  charDonkeykongItemShootLegsWalkF: 'char.donkeykong.item_shoot_legs_walk_f',
  charDonkeykongItemShootLegsWalkB: 'char.donkeykong.item_shoot_legs_walk_b',
  charDonkeykongItemShootLegsJumpSquat: 'char.donkeykong.item_shoot_legs_jump_squat',
  charDonkeykongItemShootLegsLanding: 'char.donkeykong.item_shoot_legs_landing',
  charDonkeykongItemLgunShootUpper: 'char.donkeykong.item_lgun_shoot_upper',
  charDonkeykongItemFflowerShootLoop: 'char.donkeykong.item_fflower_shoot_loop',
  charDonkeykongItemFflowerShootLoopUpper: 'char.donkeykong.item_fflower_shoot_loop_upper',
  charDonkeykongItemFflowerShootAirLoop: 'char.donkeykong.item_fflower_shoot_air_loop',
  charDonkeykongItemScopeStart: 'char.donkeykong.item_scope_start',
  charDonkeykongItemScopeStartUpper: 'char.donkeykong.item_scope_start_upper',
  charDonkeykongItemScopeWait: 'char.donkeykong.item_scope_wait',
  charDonkeykongItemScopeWaitUpper: 'char.donkeykong.item_scope_wait_upper',
  charDonkeykongItemScopeRapid: 'char.donkeykong.item_scope_rapid',
  charDonkeykongItemScopeRapidUpper: 'char.donkeykong.item_scope_rapid_upper',
  charDonkeykongItemScopeFire: 'char.donkeykong.item_scope_fire',
  charDonkeykongItemScopeFireUpper: 'char.donkeykong.item_scope_fire_upper',
  charDonkeykongItemScopeEnd: 'char.donkeykong.item_scope_end',
  charDonkeykongItemScopeEndUpper: 'char.donkeykong.item_scope_end_upper',
  charDonkeykongItemScopeFall: 'char.donkeykong.item_scope_fall',
  charDonkeykongItemScopeAirStart: 'char.donkeykong.item_scope_air_start',
  charDonkeykongItemScopeAirRapid: 'char.donkeykong.item_scope_air_rapid',
  charDonkeykongItemScopeAirFire: 'char.donkeykong.item_scope_air_fire',
  charDonkeykongItemScopeAirEnd: 'char.donkeykong.item_scope_air_end',
  charDonkeykongItemHeavyGet: 'char.donkeykong.item_heavy_get',
  charDonkeykongItemHeavyThrowF: 'char.donkeykong.item_heavy_throw_f',
  charDonkeykongItemHeavyThrowB: 'char.donkeykong.item_heavy_throw_b',
  charDonkeykongItemHeavyThrowHi: 'char.donkeykong.item_heavy_throw_hi',
  charDonkeykongItemHeavyThrowLw: 'char.donkeykong.item_heavy_throw_lw',
  charDonkeykongSuperLiftWait: 'char.donkeykong.super_lift_wait',
  charDonkeykongSuperLiftWalkSlow: 'char.donkeykong.super_lift_walk_slow',
  charDonkeykongSuperLiftWalkMiddle: 'char.donkeykong.super_lift_walk_middle',
  charDonkeykongSuperLiftWalkFast: 'char.donkeykong.super_lift_walk_fast',
  charDonkeykongSuperLiftTurn: 'char.donkeykong.super_lift_turn',
  charDonkeykongSuperLiftJumpSquat: 'char.donkeykong.super_lift_jump_squat',
  charDonkeykongSuperLiftJump: 'char.donkeykong.super_lift_jump',
  charDonkeykongSuperLiftFall: 'char.donkeykong.super_lift_fall',
  charDonkeykongSuperLiftLanding: 'char.donkeykong.super_lift_landing',
  charDonkeykongShieldEnd: 'char.donkeykong.shield_end',
  charDonkeykongShieldHit: 'char.donkeykong.shield_hit',
  charDonkeykongSpotDodge: 'char.donkeykong.spot_dodge',
  charDonkeykongDashGrab: 'char.donkeykong.dash_grab',
  charDonkeykongPivotGrab: 'char.donkeykong.pivot_grab',
  charDonkeykongGrabEscape: 'char.donkeykong.grab_escape',
  charDonkeykongCargoBthrow: 'char.donkeykong.cargo_bthrow',
  charDonkeykongCargoDthrow: 'char.donkeykong.cargo_dthrow',
  charDonkeykongCargoFthrow: 'char.donkeykong.cargo_fthrow',
  charDonkeykongCargoHold: 'char.donkeykong.cargo_hold',
  charDonkeykongCargoHoldAir: 'char.donkeykong.cargo_hold_air',
  charDonkeykongCargoJump: 'char.donkeykong.cargo_jump',
  charDonkeykongCargoUthrow: 'char.donkeykong.cargo_uthrow',
  charDonkeykongCargoWalk: 'char.donkeykong.cargo_walk',
  charDonkeykongCargoRecipientCarried: 'char.donkeykong.cargo_recipient_carried',
  charDonkeykongCargoRecipientFthrow: 'char.donkeykong.cargo_recipient_fthrow',
  charDonkeykongCargoRecipientBthrow: 'char.donkeykong.cargo_recipient_bthrow',
  charDonkeykongCargoRecipientUthrow: 'char.donkeykong.cargo_recipient_uthrow',
  charDonkeykongCargoRecipientDthrow: 'char.donkeykong.cargo_recipient_dthrow',
  // Review-only clips apply at their exact paired contact ages.
  charDonkeykongReviewPilotJab1Contact: 'char.donkeykong.review_pilot_jab1_contact',
  charDonkeykongReviewPilotJab2Contact: 'char.donkeykong.review_pilot_jab2_contact',
  charDonkeykongReviewPilotDtiltContact: 'char.donkeykong.review_pilot_dtilt_contact',
  charDonkeykongReviewLegacyGrab: 'char.donkeykong.review_legacy_grab',
  charDonkeykongReviewPilotStandingGrabContact: 'char.donkeykong.review_pilot_standing_grab_contact',
  charDonkeykongReviewPilotDashGrabContact: 'char.donkeykong.review_pilot_dash_grab_contact',
  charDonkeykongReviewPilotPivotGrabContact: 'char.donkeykong.review_pilot_pivot_grab_contact',

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
  /** Inferno giant-head artwork, shipped with every standalone build. */
  stageInfernoHead: 'stage.inferno.head',

  // ---------------- items --------------------------------------------
  /** Bob-omb item sprite — 80×92 authored PLACEHOLDER (black bomb, wind-up key, feet), feet at the bottom (Ultimate items phase 5). */
  /** Authored Phase8 container cutouts; bottom-root display registration. */
  itemCrate: 'item.crate',
  itemBarrel: 'item.barrel',
  itemCapsule: 'item.capsule',
  itemBobOmb: 'item.bobOmb.sprite',
  /** Banana Peel item sprite — 88×44 authored PLACEHOLDER peel lying flat (Ultimate items phase 5). */
  itemBananaPeel: 'item.bananaPeel.sprite',
  /** Explosion strip (Bob-omb) — 3 frames @ 96×96 (flash → fireball → smoke). */
  itemExplosion: 'item.bomb.explosion',
  /** Bat item sprite — 16×48 procedural tapered baseball-bat PNG. */
  itemBat: 'item.bat.sprite',
  /** Ray Gun item sprite — 48×112 authored outlined cartoon, barrel up, grip at the bottom (Ultimate items phase 4). */
  itemRayGun: 'item.raygun.sprite',
  /** Super Scope item sprite — 56×168 authored outlined cartoon, barrel up, grip at the bottom. */
  itemSuperScope: 'item.superScope.sprite',
  /** Fire Flower item sprite — 80×112 authored outlined cartoon, head up, stem at the bottom. */
  itemFireFlower: 'item.fireFlower.sprite',
  /** Beam Sword item sprite — 16×64 procedural handle + glowing beam (grip at the bottom). */
  itemBeamSword: 'item.beamSword.sprite',
  /** Star Rod item sprite — 24×56 procedural rod + star (grip at the bottom). */
  itemStarRod: 'item.starRod.sprite',
  /** Hammer item sprite — 96×96 RGBA. */
  itemHammer: 'item.hammer.sprite',
  itemGoldenHammer:'item.goldenHammer.sprite',
  itemHeartContainer:'item.heartContainer.sprite',
  itemFoodApple: 'item.food.Apple.sprite',
  itemFoodBread: 'item.food.Bread.sprite',
  itemFoodCheese: 'item.food.Cheese.sprite',
  itemFoodCherries: 'item.food.Cherries.sprite',
  itemFoodCherryPie: 'item.food.Cherry pie.sprite',
  itemFoodChocolate: 'item.food.Chocolate.sprite',
  itemFoodCola: 'item.food.Cola.sprite',
  itemFoodCornDog: 'item.food.Corn dog.sprite',
  itemFoodDimSum: 'item.food.Dim sum.sprite',
  itemFoodDonut: 'item.food.Donut.sprite',
  itemFoodDumplings: 'item.food.Dumplings.sprite',
  itemFoodEggs: 'item.food.Eggs.sprite',
  itemFoodGrapes: 'item.food.Grapes.sprite',
  itemFoodHamburger: 'item.food.Hamburger.sprite',
  itemFoodHotDog: 'item.food.Hot dog.sprite',
  itemFoodKebab: 'item.food.Kebab.sprite',
  itemFoodKiwi: 'item.food.Kiwi.sprite',
  itemFoodLemons: 'item.food.Lemons.sprite',
  itemFoodLollipop: 'item.food.Lollipop.sprite',
  itemFoodMilk: 'item.food.Milk.sprite',
  itemFoodMontBlanc: 'item.food.Mont Blanc.sprite',
  itemFoodOnigiri: 'item.food.Onigiri.sprite',
  itemFoodPancakes: 'item.food.Pancakes.sprite',
  itemFoodPear: 'item.food.Pear.sprite',
  itemFoodPineapple: 'item.food.Pineapple.sprite',
  itemFoodPizza: 'item.food.Pizza.sprite',
  itemFoodPopcorn: 'item.food.Popcorn.sprite',
  itemFoodSalad: 'item.food.Salad.sprite',
  itemFoodSalisburySteak: 'item.food.Salisbury steak.sprite',
  itemFoodSpaghetti: 'item.food.Spaghetti.sprite',
  itemFoodSquashSoup: 'item.food.Squash soup.sprite',
  itemFoodSteak: 'item.food.Steak.sprite',
  itemFoodStrawberryShortcake: 'item.food.Strawberry shortcake.sprite',
  itemFoodTea: 'item.food.Tea.sprite',
  itemFoodTempura: 'item.food.Tempura.sprite',
  itemFoodTurkey: 'item.food.Turkey.sprite',
  itemMaximTomato:'item.maximTomato.sprite',
  itemHammerHead:'item.hammerHead.sprite',
  itemHammerHandle:'item.hammerHandle.sprite',

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
/** Canonical asset-relative sources resolve through the same Vite base as PNGs. */
export function manifestAssetUrl(relativePath:string):string {
  if(!relativePath||relativePath.startsWith('/')||relativePath.split('/').includes('..'))throw new TypeError('Expected canonical asset-relative path');
  return `${BASE}${relativePath}`;
}
const CHAR_ROOT = `${BASE}characters`;
const STAGE_ROOT = `${BASE}stages`;
const SFX_ROOT = `${BASE}audio/sfx`;
const MUSIC_ROOT = `${BASE}audio/music`;
const ITEM_SPRITES_ROOT = `${BASE}sprites/items`;

// ---------------------------------------------------------------------
// Character spritesheet entries
// ---------------------------------------------------------------------
//
// One entry per legacy sheet (legacyFighterSheets.ts: the layout in each
// fighter's `frames.json`, the drawing count in its `gameplay.json`).

/** One `char.<fighter>.<clip>` sheet per legacy sheet of a fighter (grid or tight-packed strips). */
function packedFighterSpritesheets(fighter: string, animations: Readonly<Record<string, {
  readonly strip: string; readonly frameWidth: number; readonly frameHeight: number; readonly frameCount: number }>>,
): readonly SpritesheetAssetEntry[] {
  return Object.entries(animations).map(([sheet, clip]) => ({ key: `char.${fighter}.${sheet}`, kind: 'spritesheet' as const,
    url: `${CHAR_ROOT}/${fighter}/${clip.strip}`, frameWidth: clip.frameWidth,
    frameHeight: clip.frameHeight, frameCount: clip.frameCount, ...packedLayoutOf(clip) }));
}

// Link — fresh native-model renders packed by tools/fighter-pack.py (tight layout).
const linkSpritesheets = packedFighterSpritesheets('link', legacySheets('link'));
// A display-only bank: the original Final frames remain the authoritative pose tracks.
const pikachuFinalVisualSpritesheets = packedFighterSpritesheets('pikachu', pikachuFinalVisualMetadata.pages);

/** The art-owner aggregate contains only actually reviewed packed strips.
 * Reserved keys are separate from acceptance: a future key without metadata
 * never causes a pending/fallback sheet to load. Dimensions/counts follow the
 * reviewed cell contract, including safe multirow atlases and loop closures.
 */
const pikachuSpritesheets: readonly SpritesheetAssetEntry[] = Object.entries(legacySheets('pikachu'))
  .map(([sheet, clip]) => {
    const route = sheet === 'ftilt' ? 'tilt' : sheet;
    const key = Object.values(ASSET_KEYS).find(candidate => candidate === `char.pikachu.${route}`);
    if (!key) throw new Error(`Reviewed Pikachu sheet lacks reserved asset key: ${sheet}`);
    return { key, kind: 'spritesheet' as const, url: `${CHAR_ROOT}/pikachu/animations/${sheet}.png`,
      frameWidth: clip.frameWidth, frameHeight: clip.frameHeight, frameCount: clip.frameCount, ...packedLayoutOf(clip) };
  });

// Donkey Kong — full AI sprite set.
const donkeykongSpritesheets = packedFighterSpritesheets('donkeykong', legacySheets('donkeykong'));

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

export const INFERNO_HEAD_IMAGE_URL = `${STAGE_ROOT}/inferno-head.png`;

const stageBackgroundImages: readonly ImageAssetEntry[] = [
  { key: ASSET_KEYS.stageInfernoHead, kind: 'image', url: INFERNO_HEAD_IMAGE_URL },
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
// Item entries — item sprites + the explosion frame strip (Kenney Particle Pack)
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
    key: ASSET_KEYS.itemBobOmb,
    kind: 'image',
    url: `${ITEM_SPRITES_ROOT}/bob-omb.png`,
  },
  {
    key: ASSET_KEYS.itemBananaPeel,
    kind: 'image',
    url: `${ITEM_SPRITES_ROOT}/banana-peel.png`,
  },
  {
    key: ASSET_KEYS.itemBat,
    kind: 'image',
    url: `${ITEM_SPRITES_ROOT}/bat.png`,
  },
  {
    key: ASSET_KEYS.itemRayGun,
    kind: 'image',
    url: `${ITEM_SPRITES_ROOT}/ray-gun.png`,
  },
  {
    key: ASSET_KEYS.itemSuperScope,
    kind: 'image',
    url: `${ITEM_SPRITES_ROOT}/super-scope.png`,
  },
  {
    key: ASSET_KEYS.itemFireFlower,
    kind: 'image',
    url: `${ITEM_SPRITES_ROOT}/fire-flower.png`,
  },
  {
    key: ASSET_KEYS.itemBeamSword,
    kind: 'image',
    url: `${ITEM_SPRITES_ROOT}/beam-sword.png`,
  },
  {
    key: ASSET_KEYS.itemStarRod,
    kind: 'image',
    url: `${ITEM_SPRITES_ROOT}/star-rod.png`,
  },
  {key:ASSET_KEYS.itemCrate,kind:'image',url:`${ITEM_SPRITES_ROOT}/crate.png`},
  {key:ASSET_KEYS.itemBarrel,kind:'image',url:`${ITEM_SPRITES_ROOT}/barrel.png`},
  {key:ASSET_KEYS.itemCapsule,kind:'image',url:`${ITEM_SPRITES_ROOT}/capsule.png`},
  {key:ASSET_KEYS.itemGoldenHammer,kind:'image',url:`${ITEM_SPRITES_ROOT}/golden-hammer.png`},
  {key:ASSET_KEYS.itemHeartContainer,kind:'image',url:`${ITEM_SPRITES_ROOT}/heart-container.png`},
  {key:ASSET_KEYS.itemMaximTomato,kind:'image',url:`${ITEM_SPRITES_ROOT}/maxim-tomato.png`},
  ...FOOD_VARIANTS.map(name=>({key:`item.food.${name}.sprite`,kind:'image' as const,url:`${ITEM_SPRITES_ROOT}/${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}.png`})),
  {key:ASSET_KEYS.itemHammerHead,kind:'image',url:`${ITEM_SPRITES_ROOT}/hammer-head.png`},
  {key:ASSET_KEYS.itemHammerHandle,kind:'image',url:`${ITEM_SPRITES_ROOT}/hammer-handle.png`},
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
    ...linkSpritesheets,
    ...donkeykongSpritesheets,
    ...pikachuSpritesheets,
    ...pikachuFinalVisualSpritesheets,
    ...stageM1Spritesheets,
    ...itemSpritesheets,
  ],
  atlases: [],
  audio: sfxAudio,
  music: musicAudio,
};

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
