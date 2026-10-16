/**
 * Sprite animation driver — Sub-AC 2 of the M1 sprite-animation cut.
 *
 * Hooks the existing fighter state machine (movement + combat) onto the
 * loaded character spritesheets so each high-level state — `idle`,
 * `run`, `jump`, `fall`, `attack`, `hurt` — triggers the correct Phaser
 * sprite animation sequence at runtime.
 *
 * # Where this fits
 *
 * The wider animation pipeline already produces *symbolic* animation
 * keys per fixed step:
 *
 *   • `animationState.ts`             — `(character, move, phase, frame)`
 *                                        → `'wolf.jab.startup.0'` etc.
 *   • `fighterAnimationState.ts`      — composes hurt / shield / dodge /
 *                                        ledge / attack / idle into one key.
 *   • `defensiveAnimationState.ts`    — generates shield/dodge/ledge keys.
 *
 * Those modules emit per-phase, per-art-frame keys that are useful for
 * deterministic logging and the (future) full-atlas renderer. The M1
 * art delivery, however, ships **only four spritesheets per character**
 * (idle / run / jump / attack — see `assets/characters/<id>/animations/`).
 *
 * This driver is the bridge: it collapses the rich symbolic state down
 * to one of six discrete sprite animations the M1 art actually has, and
 * exposes a registry that registers the matching Phaser animations
 * against the loaded textures so a `sprite.play(animKey)` call in the
 * render loop just works.
 *
 * # Sprite-state taxonomy
 *
 * Six discrete, art-backed states:
 *
 *   • `idle`    — fighter is on the ground, not moving, not attacking,
 *                 not in hitstun. Loops the `idle` sheet.
 *   • `run`     — fighter is on the ground with horizontal velocity above
 *                 a small dead-zone OR a non-zero move-input. Loops the
 *                 `run` sheet.
 *   • `jump`    — fighter is airborne and rising (vy < 0). Plays the
 *                 `jump` sheet once and holds the last frame.
 *   • `fall`    — fighter is airborne and descending (vy >= 0). Reuses
 *                 the `jump` sheet (no separate fall art shipped); the
 *                 final frame of `jump` is the apex / fall pose.
 *   • `attack`  — an `ActiveAttack` is in flight (any move slot). Plays
 *                 the `attack` sheet once. The high-priority symbolic
 *                 key from `fighterAnimationState.ts` still drives the
 *                 hitbox spawn windows; this driver only chooses which
 *                 strip the renderer actually paints.
 *   • `hurt`    — `hitstunRemaining > 0`. M1 art has no dedicated hurt
 *                 sheet, so we hold the `idle` sheet's frame 0 and let
 *                 the existing palette-swap tint + invincibility-flicker
 *                 communicate the hurt window. The state is still
 *                 emitted distinctly so the renderer can also pulse a
 *                 tint or shake — and so a future `hurt.png` drop slots
 *                 in with one entry change here.
 *
 * # Determinism
 *
 * Every helper is a pure function over the input snapshot. No
 * `Math.random()`, no wall-clock reads. Identical snapshot → identical
 * resolved state → identical animation key. The replay system can
 * reconstruct the displayed sprite frame from a logged snapshot
 * byte-for-byte.
 *
 * # Phaser dependency
 *
 * The classifier and key composer are Phaser-free. Only
 * {@link registerCharacterSpriteAnimations} touches a Phaser scene's
 * `anims` manager — that helper is in this same file (rather than a
 * separate "registry" file) because keeping the key composition and the
 * registration call site together prevents the two halves from drifting
 * apart on a future renaming pass.
 */

import donkeykongFrames from '../../assets/characters/donkeykong/frames.json';
import pikachuFrames from '../../assets/characters/pikachu/frames.json';
import linkFrames from '../../assets/characters/link/frames.json';
import { CHARACTER_IDS, type CharacterId } from '../types';
import { ASSET_KEYS } from '../assets/manifest';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Discrete sprite-animation state. One per loaded spritesheet (with
 * `fall` collapsing onto `jump` and `hurt` collapsing onto `idle` for
 * the M1 art delivery — see module header).
 */
export type SpriteAnimationState =
  | 'idle'
  | 'run'
  | 'jump'
  | 'fall'
  | 'attack'
  | 'hurt';

/**
 * Ordered list of every sprite-animation state. Useful for tests
 * (exhaustiveness) and for the registry helper (it iterates the four
 * canonical sheet keys, not this list — but this list is the canonical
 * taxonomy).
 */
export const SPRITE_ANIMATION_STATES: ReadonlyArray<SpriteAnimationState> =
  Object.freeze(['idle', 'run', 'jump', 'fall', 'attack', 'hurt']);

/**
 * Plain-data snapshot the classifier reads. Designed so any caller —
 * a live `Character`, a `Fighter` adapter, or a replay snapshot —
 * can converge on this shape with no Phaser / Matter dependency.
 *
 * Velocity is in Matter px-per-step units; positive `velocityY` means
 * "moving downward" (Phaser's screen-Y axis).
 */
export interface SpriteAnimationSnapshot {
  readonly characterId: CharacterId;
  /** True iff the fighter is currently in startup / active / recovery. */
  readonly isAttacking: boolean;
  /** Hitstun frames remaining (0 outside hitstun). */
  readonly hitstunRemaining: number;
  /** True iff a platform body is currently supporting the fighter. */
  readonly grounded: boolean;
  /** Live horizontal velocity. Used to choose run vs idle on the ground. */
  readonly velocityX: number;
  /** Live vertical velocity. Used to choose jump (rising) vs fall (descending). */
  readonly velocityY: number;
  /**
   * Optional movement-input magnitude on the horizontal axis. Lets the
   * classifier promote "player is holding left / right but velocity has
   * not yet built up" to `run`. Ignored when missing.
   */
  readonly moveInputX?: number;
  /** Fighter destruction flag — destroyed fighters always read as idle. */
  readonly destroyed: boolean;
}

/** Velocity dead-zone (px / fixed step) below which we read horizontal motion as still. */
export const RUN_VELOCITY_DEAD_ZONE = 0.25;

/** Move-input dead-zone for the optional input-aware promotion. */
export const RUN_INPUT_DEAD_ZONE = 0.15;

// ---------------------------------------------------------------------------
// Animation key composition
// ---------------------------------------------------------------------------

/**
 * Per-character spritesheet texture key for a given sheet slot. Mirrors
 * the manifest constants so the renderer and registry agree.
 *
 * Falls back to `null` for characters without a loaded sheet (their
 * `placeholder.spriteKey` is also null, so the MatchScene renderer skips
 * the sprite track entirely for them).
 */
export function getCharacterSpritesheetKey(
  characterId: CharacterId,
  sheet: 'idle' | 'run' | 'jump' | 'attack',
): string | null {
  switch (characterId) {
    case 'link':
      return getCharacterMoveSheetKey('link', sheet);
    case 'pikachu':
      switch (sheet) {
        case 'idle': return ASSET_KEYS.charPikachuIdle;
        case 'run': return ASSET_KEYS.charPikachuRun;
        case 'jump': return ASSET_KEYS.charPikachuJump;
        case 'attack': return ASSET_KEYS.charPikachuAttack;
      }
      break;
    case 'donkeykong':
      switch (sheet) {
        case 'idle':
          return ASSET_KEYS.charDonkeykongIdle;
        case 'run':
          return ASSET_KEYS.charDonkeykongRun;
        case 'jump':
          return ASSET_KEYS.charDonkeykongJump;
        case 'attack':
          return ASSET_KEYS.charDonkeykongAttack;
      }
      break;
  }
  return null;
}

/**
 * Compose the canonical Phaser animation key for a `(character, state)`
 * pair. The `.anim` suffix prevents key collision with the manifest's
 * texture keys (which already use `char.<id>.<sheet>`); a Phaser anim
 * and a Phaser texture share separate caches but a *single* string
 * registry per scene's `anims` manager, so the suffix keeps the
 * spritesheet keys callable as textures and the animation keys callable
 * as animations.
 *
 *   getSpriteAnimationKey('donkeykong', 'run')  → 'donkeykong.run.anim'
 *   getSpriteAnimationKey('donkeykong', 'fall') → 'donkeykong.jump.anim'  (collapsed)
 *   getSpriteAnimationKey('donkeykong', 'hurt') → 'donkeykong.idle.anim'  (collapsed)
 *
 * Returns `null` if the character has no source sheet.
 */
export function getSpriteAnimationKey(
  characterId: CharacterId,
  state: SpriteAnimationState,
): string | null {
  const sheet = collapseStateToSheet(state);
  // Defensively check that the character has a loaded sheet — guards
  // the renderer from issuing a play() against a non-existent anim.
  if (getCharacterSpritesheetKey(characterId, sheet) === null) return null;
  return `${characterId}.${sheet}.anim`;
}

/**
 * Collapse the abstract sprite-animation state down to one of the four
 * actual loaded sheets for the M1 art delivery.
 *
 * Pure / deterministic. Exposed so tests can lock the collapse rule
 * down without re-deriving it from `getSpriteAnimationKey`.
 */
export function collapseStateToSheet(
  state: SpriteAnimationState,
): 'idle' | 'run' | 'jump' | 'attack' {
  switch (state) {
    case 'idle':
    case 'hurt': // M1 has no hurt sheet — hold idle pose; existing tint communicates hurt.
      return 'idle';
    case 'run':
      return 'run';
    case 'jump':
    case 'fall': // M1 has no fall sheet — reuse jump's apex frame.
      return 'jump';
    case 'attack':
      return 'attack';
  }
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Resolve the discrete sprite-animation state a fighter should display
 * this fixed step. Pure projection over the snapshot.
 *
 * # Precedence
 *
 *   1. **Destroyed** → `'idle'`        — defensive fallback.
 *   2. **Hurt**      → `'hurt'`        — `hitstunRemaining > 0`.
 *   3. **Attack**    → `'attack'`      — an active move is in flight.
 *   4. **Airborne**:
 *        - velocityY < 0 → `'jump'`   — rising.
 *        - velocityY ≥ 0 → `'fall'`   — at apex / descending.
 *   5. **Grounded movement**:
 *        - |velocityX| > RUN_VELOCITY_DEAD_ZONE → `'run'`
 *        - |moveInputX| > RUN_INPUT_DEAD_ZONE   → `'run'`  (input-aware promotion)
 *        - otherwise                            → `'idle'`
 *
 * The composition mirrors `fighterAnimationState.ts`'s priority order
 * (hurt > attack > pose) so the symbolic key and the sprite key never
 * disagree on which "layer" the fighter is in — a hurt key from the
 * symbolic resolver coincides with a `'hurt'` state here.
 */
export function classifySpriteAnimationState(
  snapshot: SpriteAnimationSnapshot,
): SpriteAnimationState {
  if (snapshot.destroyed) return 'idle';
  if (snapshot.hitstunRemaining > 0) return 'hurt';
  if (snapshot.isAttacking) return 'attack';

  if (!snapshot.grounded) {
    return snapshot.velocityY < 0 ? 'jump' : 'fall';
  }

  // Grounded. Run if either velocity OR input is past the dead-zone.
  const moving = Math.abs(snapshot.velocityX) > RUN_VELOCITY_DEAD_ZONE;
  const inputHeld =
    snapshot.moveInputX !== undefined &&
    Math.abs(snapshot.moveInputX) > RUN_INPUT_DEAD_ZONE;
  return moving || inputHeld ? 'run' : 'idle';
}

// ---------------------------------------------------------------------------
// Phaser anim registry
// ---------------------------------------------------------------------------

/**
 * Per-sheet metadata used by the registration helper. Frame counts here
 * MUST mirror the manifest's `frameCount` for each character's
 * spritesheet entry. Keeping the table local to this module lets the
 * registry decide animation cadence (frameRate, repeat) without
 * coupling the manifest to render-side concerns.
 */
interface SheetAnimSpec {
  /** Sheet slot name. */
  readonly sheet: 'idle' | 'run' | 'jump' | 'attack';
  /** Frame rate in frames per second. */
  readonly frameRate: number;
  /** Repeat count (-1 = loop forever, 0 = play once and stop). */
  readonly repeat: number;
  /**
   * Whether the animation should hold the last frame after finishing.
   * Used for `jump` / `attack` so the fighter doesn't snap back to
   * frame 0 between phase transitions.
   */
  readonly hold: boolean;
}

/**
 * Per-character animation specifications — frame rate / repeat / hold
 * tuned per sheet so the visual pacing matches the gameplay cadence
 * the symbolic state machine produces.
 *
 * Frame rates picked so:
 *   - `idle` loops at a calm 6 fps (breathing pose).
 *   - `run` loops at a brisk 12 fps to feel responsive.
 *   - `jump` plays once over ~5 frames at 12 fps (~0.4s) and holds the
 *     apex pose, matching the typical jump arc duration.
 *   - `attack` plays once at 18 fps so a 6-frame attack window covers
 *     ~0.33s — close to the median grounded-attack lockout (~20 frames
 *     @ 60fps gameplay = ~0.33s).
 *
 * The same spec table works for every fighter — the per-character
 * frame counts come from the manifest entries, not this table.
 */
export const SPRITE_ANIM_SPECS: ReadonlyArray<SheetAnimSpec> = Object.freeze([
  Object.freeze({ sheet: 'idle', frameRate: 6, repeat: -1, hold: false }),
  Object.freeze({ sheet: 'run', frameRate: 12, repeat: -1, hold: false }),
  Object.freeze({ sheet: 'jump', frameRate: 12, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'attack', frameRate: 18, repeat: 0, hold: true }),
]);

// ---------------------------------------------------------------------------
// Per-move animation sheets (the "every attack has its OWN clip" layer)
// ---------------------------------------------------------------------------

/**
 * Per-move sheets a fighter can ship beyond the collapsed `attack`. Each is a
 * one-shot clip (hold the last frame), except `crouch` which loops/holds while
 * the duck is held. Frame counts come from the manifest, like SPRITE_ANIM_SPECS.
 */
export const MOVE_SHEET_SPECS: ReadonlyArray<{
  readonly sheet: string;
  readonly frameRate: number;
  readonly repeat: number;
  readonly hold: boolean;
}> = Object.freeze([
  Object.freeze({ sheet: 'crouch', frameRate: 8, repeat: -1, hold: true }),
  Object.freeze({ sheet: 'jab', frameRate: 18, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'jab2', frameRate: 18, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'jab3', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'tilt', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'dtilt', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'smash', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'nair', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'fair', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'bair', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'uair', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'dair', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'neutral_special', frameRate: 14, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'side_special', frameRate: 14, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'up_special', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'down_special', frameRate: 14, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'hurt',   frameRate: 16, repeat: -1, hold: true }),
  Object.freeze({ sheet: 'shield', frameRate: 12, repeat: -1, hold: true }),
  Object.freeze({ sheet: 'grab',   frameRate: 16, repeat: 0,  hold: true }),
  Object.freeze({ sheet: 'pummel', frameRate: 18, repeat: 0,  hold: true }),
  Object.freeze({ sheet: 'fthrow', frameRate: 16, repeat: 0,  hold: true }),
  Object.freeze({ sheet: 'bthrow', frameRate: 16, repeat: 0,  hold: true }),
  Object.freeze({ sheet: 'uthrow', frameRate: 16, repeat: 0,  hold: true }),
  Object.freeze({ sheet: 'dthrow', frameRate: 16, repeat: 0,  hold: true }),
  // Dedicated directional / dash normals and special variants. Only fighters
  // that ship these strips register them; everyone else falls back through
  // `attackMoveToSheets` to the shared tilt / smash / special sheets.
  Object.freeze({ sheet: 'utilt', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'usmash', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'dsmash', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'dash_attack', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'up_special_ground', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'down_special_air', frameRate: 14, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'tilt_up', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'tilt_down', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'bair_landing', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'dair_landing', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'smash_charge', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'usmash_charge', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'dsmash_charge', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'up_special_first', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'up_special_second', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'up_special_end', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'down_special_hit', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'down_special_air_hit', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'neutral_special_air', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'up_special_start', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'up_special_air_start', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'up_special_air_end', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'side_special_start', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'side_special_air_start', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'side_special_hold', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'side_special_air_hold', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'side_special_ready', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'side_special_air_ready', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'side_special_hit', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'side_special_air_hit', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'side_special_end', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'side_special_air_miss_end', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'getup_attack', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'getup_attack_face_down', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'trip_attack', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'ledge_attack', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'air_dodge', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'airjump', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'airjump_back', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'captured', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'captured_hit', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'captured_release', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'crawl', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'crawl_back', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'crouch_end', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'crouch_start', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'dash', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'dash_grab', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'dash_turn', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'down_wait', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'down_wait_face_down', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'entry', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'fall', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'fall_special', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'footstool_fall', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'footstool_jump', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'footstool_pose', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'footstool_air_pose', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_carry', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_hammer_wait', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_heavy_get', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_heavy_walk', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_heavy_throw_f', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_heavy_throw_b', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_heavy_throw_hi', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_heavy_throw_lw', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'squat_wait_item', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'landing_heavy', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_light_eat', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_light_walk_eat', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_hammer_move', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_hammer_jump', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_pickup_stand', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_pickup_walk', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_throw_f', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_throw_b', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_throw_hi', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_throw_lw', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_throw_air_f', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_throw_air_b', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_throw_air_hi', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_throw_air_lw', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_throw_drop', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_bat_swing_1', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_bat_swing_3', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_bat_swing_4', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_bat_swing_dash', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_sword_swing_4', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_sword_swing_4_hold', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_lgun_shoot', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_lgun_shoot_air', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_lgun_shoot_upper', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_fflower_shoot_loop', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_fflower_shoot_loop_upper', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_fflower_shoot_air_loop', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_scope_start', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_scope_start_upper', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_scope_wait', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_scope_wait_upper', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_scope_rapid', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_scope_rapid_upper', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_scope_fire', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_scope_fire_upper', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_scope_end', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_scope_end_upper', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_scope_fall', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_scope_air_start', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_scope_air_rapid', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_scope_air_fire', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_scope_air_end', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_shoot_legs_walk_f', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_shoot_legs_walk_b', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_shoot_legs_jump_squat', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'item_shoot_legs_landing', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'getup', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'getup_face_down', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'getup_roll', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'getup_roll_back', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'getup_roll_back_face_down', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'getup_roll_face_down', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'grab_escape', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'grab_hold', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'grab_pull', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'hurt_air', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'jump_back', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'jumpsquat', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'landing_hard', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'landing_soft', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'landing_special', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'ledge', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'ledge_catch', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'ledge_getup', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'ledge_jump', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'ledge_jump_start', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'ledge_roll', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'parry', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'pivot_grab', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'roll', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'roll_back', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'run_brake', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'run_brake_left', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'run_turn', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'shield_break', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'shield_break_end', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'shield_end', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'shield_hit', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'shield_start', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'spot_dodge', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'taunt_down', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'taunt_side', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'taunt_up', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'tech', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'tech_back', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'tech_ceiling', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'tech_forward', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'tech_wall', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'trip', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'tumble', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'walk', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'walk_fast', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'walk_slow', frameRate: 16, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'wall_jump', frameRate: 16, repeat: 0, hold: true }),

]);

/** All per-move sheet names (incl. crouch) — used to detect a leftover override clip. */
export const MOVE_SHEET_NAMES: ReadonlyArray<string> = Object.freeze(
  MOVE_SHEET_SPECS.map((s) => s.sheet),
);

/**
 * Per-character per-move texture keys. A fighter only appears here once it ships
 * a per-move pack; everyone else falls back to the collapsed `attack` sheet. Keyed
 * by the same sheet names as MOVE_SHEET_SPECS.
 */
const MOVE_SHEET_KEYS: Partial<Record<CharacterId, Readonly<Record<string, string>>>> = {
  pikachu: Object.freeze({
    crouch: ASSET_KEYS.charPikachuCrouch,
    jab: ASSET_KEYS.charPikachuJab,
    tilt: ASSET_KEYS.charPikachuTilt,
    tilt_up: ASSET_KEYS.charPikachuTiltUp,
    tilt_down: ASSET_KEYS.charPikachuTiltDown,
    utilt: ASSET_KEYS.charPikachuUtilt,
    dtilt: ASSET_KEYS.charPikachuDtilt,
    smash: ASSET_KEYS.charPikachuSmash,
    smash_charge: ASSET_KEYS.charPikachuSmashCharge,
    usmash_charge: ASSET_KEYS.charPikachuUsmashCharge,
    dsmash_charge: ASSET_KEYS.charPikachuDsmashCharge,
    usmash: ASSET_KEYS.charPikachuUsmash,
    dsmash: ASSET_KEYS.charPikachuDsmash,
    dash_attack: ASSET_KEYS.charPikachuDashAttack,
    nair: ASSET_KEYS.charPikachuNair,
    fair: ASSET_KEYS.charPikachuFair,
    bair: ASSET_KEYS.charPikachuBair,
    uair: ASSET_KEYS.charPikachuUair,
    dair: ASSET_KEYS.charPikachuDair,
    bair_landing: ASSET_KEYS.charPikachuBairLanding,
    dair_landing: ASSET_KEYS.charPikachuDairLanding,
    neutral_special: ASSET_KEYS.charPikachuNeutralSpecial,
    neutral_special_air: ASSET_KEYS.charPikachuNeutralSpecialAir,
    up_special_start: ASSET_KEYS.charPikachuUpSpecialStart,
    up_special_air_start: ASSET_KEYS.charPikachuUpSpecialAirStart,
    up_special_air_end: ASSET_KEYS.charPikachuUpSpecialAirEnd,
    side_special_start: ASSET_KEYS.charPikachuSideSpecialStart,
    side_special_air_start: ASSET_KEYS.charPikachuSideSpecialAirStart,
    side_special_hold: ASSET_KEYS.charPikachuSideSpecialHold,
    side_special_air_hold: ASSET_KEYS.charPikachuSideSpecialAirHold,
    side_special_ready: ASSET_KEYS.charPikachuSideSpecialReady,
    side_special_air_ready: ASSET_KEYS.charPikachuSideSpecialAirReady,
    side_special_hit: ASSET_KEYS.charPikachuSideSpecialHit,
    side_special_air_hit: ASSET_KEYS.charPikachuSideSpecialAirHit,
    side_special_end: ASSET_KEYS.charPikachuSideSpecialEnd,
    side_special_air_miss_end: ASSET_KEYS.charPikachuSideSpecialAirMissEnd,
    side_special: ASSET_KEYS.charPikachuSideSpecial,
    up_special: ASSET_KEYS.charPikachuUpSpecial,
    up_special_first: ASSET_KEYS.charPikachuUpSpecialFirst,
    up_special_second: ASSET_KEYS.charPikachuUpSpecialSecond,
    up_special_end: ASSET_KEYS.charPikachuUpSpecialEnd,
    down_special: ASSET_KEYS.charPikachuDownSpecial,
    down_special_air: ASSET_KEYS.charPikachuDownSpecialAir,
    down_special_hit: ASSET_KEYS.charPikachuDownSpecialHit,
    down_special_air_hit: ASSET_KEYS.charPikachuDownSpecialAirHit,
    hurt: ASSET_KEYS.charPikachuHurt,
    shield: ASSET_KEYS.charPikachuShield,
    grab: ASSET_KEYS.charPikachuGrab,
    pummel: ASSET_KEYS.charPikachuPummel,
    fthrow: ASSET_KEYS.charPikachuFthrow,
    bthrow: ASSET_KEYS.charPikachuBthrow,
    uthrow: ASSET_KEYS.charPikachuUthrow,
    dthrow: ASSET_KEYS.charPikachuDthrow,
    getup_attack: ASSET_KEYS.charPikachuGetupAttack,
    getup_attack_face_down: ASSET_KEYS.charPikachuGetupAttackFaceDown,
    trip_attack: ASSET_KEYS.charPikachuTripAttack,
    ledge_attack: ASSET_KEYS.charPikachuLedgeAttack,
    air_dodge: ASSET_KEYS.charPikachuAirDodge,
    airjump: ASSET_KEYS.charPikachuAirjump,
    airjump_back: ASSET_KEYS.charPikachuAirjumpBack,
    captured: ASSET_KEYS.charPikachuCaptured,
    captured_hit: ASSET_KEYS.charPikachuCapturedHit,
    captured_release: ASSET_KEYS.charPikachuCapturedRelease,
    crawl: ASSET_KEYS.charPikachuCrawl,
    crawl_back: ASSET_KEYS.charPikachuCrawlBack,
    crouch_end: ASSET_KEYS.charPikachuCrouchEnd,
    crouch_start: ASSET_KEYS.charPikachuCrouchStart,
    dash: ASSET_KEYS.charPikachuDash,
    dash_grab: ASSET_KEYS.charPikachuDashGrab,
    dash_turn: ASSET_KEYS.charPikachuDashTurn,
    down_wait: ASSET_KEYS.charPikachuDownWait,
    down_wait_face_down: ASSET_KEYS.charPikachuDownWaitFaceDown,
    entry: ASSET_KEYS.charPikachuEntry,
    fall: ASSET_KEYS.charPikachuFall,
    fall_special: ASSET_KEYS.charPikachuFallSpecial,
    footstool_fall: ASSET_KEYS.charPikachuFootstoolFall,
    footstool_jump: ASSET_KEYS.charPikachuFootstoolJump,
    footstool_pose: ASSET_KEYS.charPikachuFootstoolPose,
    footstool_air_pose: ASSET_KEYS.charPikachuFootstoolAirPose,
    item_carry: ASSET_KEYS.charPikachuItemCarry,
    item_hammer_wait: ASSET_KEYS.charPikachuItemHammerWait,
    item_heavy_get: ASSET_KEYS.charPikachuItemHeavyGet,
    item_heavy_walk: ASSET_KEYS.charPikachuItemHeavyWalk,
    item_heavy_throw_f: ASSET_KEYS.charPikachuItemHeavyThrowF,
    item_heavy_throw_b: ASSET_KEYS.charPikachuItemHeavyThrowB,
    item_heavy_throw_hi: ASSET_KEYS.charPikachuItemHeavyThrowHi,
    item_heavy_throw_lw: ASSET_KEYS.charPikachuItemHeavyThrowLw,
    squat_wait_item: ASSET_KEYS.charPikachuSquatWaitItem,
    landing_heavy: ASSET_KEYS.charPikachuLandingHeavy,
    item_light_eat: ASSET_KEYS.charPikachuItemLightEat,
    item_light_walk_eat: ASSET_KEYS.charPikachuItemLightWalkEat,
    item_hammer_move: ASSET_KEYS.charPikachuItemHammerMove,
    item_hammer_jump: ASSET_KEYS.charPikachuItemHammerJump,
    item_pickup_stand: ASSET_KEYS.charPikachuItemPickupStand,
    item_pickup_walk: ASSET_KEYS.charPikachuItemPickupWalk,
    item_throw_f: ASSET_KEYS.charPikachuItemThrowF,
    item_throw_b: ASSET_KEYS.charPikachuItemThrowB,
    item_throw_hi: ASSET_KEYS.charPikachuItemThrowHi,
    item_throw_lw: ASSET_KEYS.charPikachuItemThrowLw,
    item_throw_air_f: ASSET_KEYS.charPikachuItemThrowAirF,
    item_throw_air_b: ASSET_KEYS.charPikachuItemThrowAirB,
    item_throw_air_hi: ASSET_KEYS.charPikachuItemThrowAirHi,
    item_throw_air_lw: ASSET_KEYS.charPikachuItemThrowAirLw,
    item_throw_drop: ASSET_KEYS.charPikachuItemThrowDrop,
    item_bat_swing_1: ASSET_KEYS.charPikachuItemBatSwing1,
    item_bat_swing_3: ASSET_KEYS.charPikachuItemBatSwing3,
    item_bat_swing_4: ASSET_KEYS.charPikachuItemBatSwing4,
    item_bat_swing_dash: ASSET_KEYS.charPikachuItemBatSwingDash,
    item_sword_swing_4: ASSET_KEYS.charPikachuItemSwordSwing4,
    item_sword_swing_4_hold: ASSET_KEYS.charPikachuItemSwordSwing4Hold,
    item_lgun_shoot: ASSET_KEYS.charPikachuItemLgunShoot,
    item_lgun_shoot_air: ASSET_KEYS.charPikachuItemLgunShootAir,
    item_lgun_shoot_upper: ASSET_KEYS.charPikachuItemLgunShootUpper,
    item_fflower_shoot_loop: ASSET_KEYS.charPikachuItemFflowerShootLoop,
    item_fflower_shoot_loop_upper: ASSET_KEYS.charPikachuItemFflowerShootLoopUpper,
    item_fflower_shoot_air_loop: ASSET_KEYS.charPikachuItemFflowerShootAirLoop,
    item_scope_start: ASSET_KEYS.charPikachuItemScopeStart,
    item_scope_start_upper: ASSET_KEYS.charPikachuItemScopeStartUpper,
    item_scope_wait: ASSET_KEYS.charPikachuItemScopeWait,
    item_scope_wait_upper: ASSET_KEYS.charPikachuItemScopeWaitUpper,
    item_scope_rapid: ASSET_KEYS.charPikachuItemScopeRapid,
    item_scope_rapid_upper: ASSET_KEYS.charPikachuItemScopeRapidUpper,
    item_scope_fire: ASSET_KEYS.charPikachuItemScopeFire,
    item_scope_fire_upper: ASSET_KEYS.charPikachuItemScopeFireUpper,
    item_scope_end: ASSET_KEYS.charPikachuItemScopeEnd,
    item_scope_end_upper: ASSET_KEYS.charPikachuItemScopeEndUpper,
    item_scope_fall: ASSET_KEYS.charPikachuItemScopeFall,
    item_scope_air_start: ASSET_KEYS.charPikachuItemScopeAirStart,
    item_scope_air_rapid: ASSET_KEYS.charPikachuItemScopeAirRapid,
    item_scope_air_fire: ASSET_KEYS.charPikachuItemScopeAirFire,
    item_scope_air_end: ASSET_KEYS.charPikachuItemScopeAirEnd,
    item_shoot_legs_walk_f: ASSET_KEYS.charPikachuItemShootLegsWalkF,
    item_shoot_legs_walk_b: ASSET_KEYS.charPikachuItemShootLegsWalkB,
    item_shoot_legs_jump_squat: ASSET_KEYS.charPikachuItemShootLegsJumpSquat,
    item_shoot_legs_landing: ASSET_KEYS.charPikachuItemShootLegsLanding,
    getup: ASSET_KEYS.charPikachuGetup,
    getup_face_down: ASSET_KEYS.charPikachuGetupFaceDown,
    getup_roll: ASSET_KEYS.charPikachuGetupRoll,
    getup_roll_back: ASSET_KEYS.charPikachuGetupRollBack,
    getup_roll_back_face_down: ASSET_KEYS.charPikachuGetupRollBackFaceDown,
    getup_roll_face_down: ASSET_KEYS.charPikachuGetupRollFaceDown,
    grab_escape: ASSET_KEYS.charPikachuGrabEscape,
    grab_hold: ASSET_KEYS.charPikachuGrabHold,
    grab_pull: ASSET_KEYS.charPikachuGrabPull,
    hurt_air: ASSET_KEYS.charPikachuHurtAir,
    idle: ASSET_KEYS.charPikachuIdle,
    jump: ASSET_KEYS.charPikachuJump,
    jump_back: ASSET_KEYS.charPikachuJumpBack,
    jumpsquat: ASSET_KEYS.charPikachuJumpsquat,
    landing_hard: ASSET_KEYS.charPikachuLandingHard,
    landing_soft: ASSET_KEYS.charPikachuLandingSoft,
    landing_special: ASSET_KEYS.charPikachuLandingSpecial,
    ledge: ASSET_KEYS.charPikachuLedge,
    ledge_catch: ASSET_KEYS.charPikachuLedgeCatch,
    ledge_getup: ASSET_KEYS.charPikachuLedgeGetup,
    ledge_jump: ASSET_KEYS.charPikachuLedgeJump,
    ledge_jump_start: ASSET_KEYS.charPikachuLedgeJumpStart,
    ledge_roll: ASSET_KEYS.charPikachuLedgeRoll,
    parry: ASSET_KEYS.charPikachuParry,
    pivot_grab: ASSET_KEYS.charPikachuPivotGrab,
    roll: ASSET_KEYS.charPikachuRoll,
    roll_back: ASSET_KEYS.charPikachuRollBack,
    run: ASSET_KEYS.charPikachuRun,
    run_brake: ASSET_KEYS.charPikachuRunBrake,
    run_brake_left: ASSET_KEYS.charPikachuRunBrakeLeft,
    run_turn: ASSET_KEYS.charPikachuRunTurn,
    shield_break: ASSET_KEYS.charPikachuShieldBreak,
    shield_break_end: ASSET_KEYS.charPikachuShieldBreakEnd,
    shield_end: ASSET_KEYS.charPikachuShieldEnd,
    shield_hit: ASSET_KEYS.charPikachuShieldHit,
    shield_start: ASSET_KEYS.charPikachuShieldStart,
    spot_dodge: ASSET_KEYS.charPikachuSpotDodge,
    taunt_down: ASSET_KEYS.charPikachuTauntDown,
    taunt_side: ASSET_KEYS.charPikachuTauntSide,
    taunt_up: ASSET_KEYS.charPikachuTauntUp,
    tech: ASSET_KEYS.charPikachuTech,
    tech_back: ASSET_KEYS.charPikachuTechBack,
    tech_ceiling: ASSET_KEYS.charPikachuTechCeiling,
    tech_forward: ASSET_KEYS.charPikachuTechForward,
    tech_wall: ASSET_KEYS.charPikachuTechWall,
    trip: ASSET_KEYS.charPikachuTrip,
    tumble: ASSET_KEYS.charPikachuTumble,
    walk: ASSET_KEYS.charPikachuWalk,
    walk_fast: ASSET_KEYS.charPikachuWalkFast,
    walk_slow: ASSET_KEYS.charPikachuWalkSlow,
    wall_jump: ASSET_KEYS.charPikachuWallJump,
  }),
  donkeykong: Object.freeze({
    crouch: ASSET_KEYS.charDonkeykongCrouch,
    jab: ASSET_KEYS.charDonkeykongJab,
    jab2: ASSET_KEYS.charDonkeykongJab2,
    tilt: ASSET_KEYS.charDonkeykongTilt,
    dtilt: ASSET_KEYS.charDonkeykongDtilt,
    smash: ASSET_KEYS.charDonkeykongSmash,
    nair: ASSET_KEYS.charDonkeykongNair,
    fair: ASSET_KEYS.charDonkeykongFair,
    bair: ASSET_KEYS.charDonkeykongBair,
    neutral_special: ASSET_KEYS.charDonkeykongNeutralSpecial,
    side_special: ASSET_KEYS.charDonkeykongSideSpecial,
    up_special: ASSET_KEYS.charDonkeykongUpSpecial,
    down_special: ASSET_KEYS.charDonkeykongDownSpecial,
    hurt: ASSET_KEYS.charDonkeykongHurt,
    shield: ASSET_KEYS.charDonkeykongShield,
    grab: ASSET_KEYS.charDonkeykongGrab,
    pummel: ASSET_KEYS.charDonkeykongPummel,
    fthrow: ASSET_KEYS.charDonkeykongFthrow,
    bthrow: ASSET_KEYS.charDonkeykongBthrow,
    uthrow: ASSET_KEYS.charDonkeykongUthrow,
    dthrow: ASSET_KEYS.charDonkeykongDthrow,
    uair: ASSET_KEYS.charDonkeykongUair,
    dair: ASSET_KEYS.charDonkeykongDair,
    utilt: ASSET_KEYS.charDonkeykongUtilt,
    usmash: ASSET_KEYS.charDonkeykongUsmash,
    dsmash: ASSET_KEYS.charDonkeykongDsmash,
    dash_attack: ASSET_KEYS.charDonkeykongDashAttack,
    up_special_ground: ASSET_KEYS.charDonkeykongUpSpecialGround,
    down_special_air: ASSET_KEYS.charDonkeykongDownSpecialAir,
  }),
};

/** Per-move texture key for a fighter+sheet, or null if it has no such per-move sheet. */
export function getCharacterMoveSheetKey(id: CharacterId, sheet: string): string | null {
  if (id === 'pikachu' && sheet.startsWith('final') && sheet in pikachuFrames.animations) return `char.pikachu.${sheet}`;
  if (id === 'donkeykong' && sheet in donkeykongFrames.animations) return `char.donkeykong.${sheet}`;
  if (id === 'link') return sheet in linkFrames.animations ? `char.link.${sheet}` : null;
  return MOVE_SHEET_KEYS[id]?.[sheet] ?? null;
}

/**
 * Map a live active-attack move to its per-move sheet name (the slot-level clip),
 * or null if it has no dedicated sheet. Mirrors the engine's 10-move model:
 * jab / tilt / smash / nair / fair / bair / 4 specials.
 */
export function attackMoveToSheet(
  move: { readonly type?: string; readonly aerialDirection?: string; readonly id?: string } | null | undefined,
): string | null {
  if (!move?.type) return null;
  switch (move.type) {
    case 'jab':
      if (move.id?.endsWith('.jab3')) return 'jab3';
      if (move.id?.endsWith('.jab2')) return 'jab2';
      return 'jab';
    case 'tilt':
      if (move.id?.endsWith('.dtilt') || move.id?.endsWith('.down-tilt')) return 'dtilt';
      return 'tilt';
    case 'smash': return 'smash';
    case 'special': // neutral special
    case 'neutralSpecial': return 'neutral_special';
    case 'sideSpecial': return 'side_special';
    case 'upSpecial': return 'up_special';
    case 'downSpecial': return 'down_special';
    case 'aerial':
      switch (move.aerialDirection) {
        case 'forward': return 'fair';
        case 'back': return 'bair';
        case 'up': return 'uair';
        case 'down': return 'dair';
        default: return 'nair';
      }
    default: return null;
  }
}

/**
 * Ordered sheet candidates for a live move, most specific first. Adds the
 * directional / dash normals (`utilt`, `usmash`, `dsmash`, `dash_attack`) and
 * the airborne / grounded special variants (`<sheet>_air`, `<sheet>_ground`,
 * from `AttackMove.sheetVariant`) that a full sprite pack can ship, each
 * followed by the shared sheet `attackMoveToSheet` returns. Consumers try the
 * names in order through `getMoveAnimKey`, so a fighter without the specific
 * strip keeps its existing art.
 */
export function attackMoveToSheets(
  move: { readonly type?: string; readonly aerialDirection?: string; readonly id?: string; readonly sheetVariant?: string }
    | null | undefined,
): string[] {
  const base = attackMoveToSheet(move);
  if (base === null) return [];
  const id = move?.id ?? '';
  let specific: string | null = null;
  if (base === 'tilt' && id.endsWith('.getupAttack')) specific = 'getup_attack';
  else if (base === 'tilt' && id.endsWith('.getupAttackFaceDown')) specific = 'getup_attack_face_down';
  else if (base === 'tilt' && id.endsWith('.tripAttack')) specific = 'trip_attack';
  else if (base === 'tilt' && id.endsWith('.ledgeAttack')) specific = 'ledge_attack';
  else if (base === 'tilt' && id.endsWith('.back-air-landing')) specific = 'bair_landing';
  else if (base === 'tilt' && id.endsWith('.down-air-landing')) specific = 'dair_landing';
  else if (base === 'tilt' && (id.endsWith('.utilt') || id.endsWith('.up-tilt'))) specific = 'utilt';
  else if (base === 'tilt' && (id.endsWith('.dashAttack') || id.endsWith('.dash-attack'))) specific = 'dash_attack';
  else if (base === 'tilt' && id.endsWith('.forward-tilt-up')) specific = 'tilt_up';
  else if (base === 'tilt' && id.endsWith('.forward-tilt-down')) specific = 'tilt_down';
  else if (base === 'smash' && (id.endsWith('.usmash') || id.endsWith('.up-smash'))) specific = 'usmash';
  else if (base === 'smash' && (id.endsWith('.dsmash') || id.endsWith('.down-smash'))) specific = 'dsmash';
  const sourceVariant = move?.sheetVariant;
  const variant = id === 'pikachu.down_special'
    ? sourceVariant === 'ground-hit' ? 'hit' : sourceVariant === 'air-hit' ? 'air_hit' : sourceVariant
    : sourceVariant;
  const withVariant = (name: string): string[] => (variant ? [`${name}_${variant}`, name] : [name]);
  const out = [...(specific ? withVariant(specific) : []), ...withVariant(base)];
  return out.filter((name, i) => out.indexOf(name) === i);
}

/** Phaser anim key for a fighter+sheet IF the per-move sheet exists, else null. */
export function getMoveAnimKey(id: CharacterId, sheet: string | null): string | null {
  if (!sheet) return null;
  return getCharacterMoveSheetKey(id, sheet) ? `${id}.${sheet}.anim` : null;
}

/**
 * Minimal Phaser anim-manager surface this module touches. Declared
 * narrowly so tests can satisfy it with a fake without faking the
 * whole `Phaser.Animations.AnimationManager`.
 *
 * Note: We *do* re-export Phaser-Anim and the underlying scene types
 * via the `Phaser` import above, but the helper takes the narrow
 * surface to keep the testing surface tight.
 */
/** Registration descriptors shared by frame catalogs and sprite sinks. */
export interface AnimationFrameDescriptor {readonly key:string;readonly frame?:number|string}
export interface AnimationRegistration {
  readonly key:string;readonly frames:readonly AnimationFrameDescriptor[];readonly frameRate:number;readonly repeat:number;
  readonly showOnStart?:boolean;readonly hideOnComplete?:boolean;
}
export interface SceneAnimSurface {
  readonly anims:{exists(key:string):boolean;create(config:AnimationRegistration):unknown;
    generateFrameNumbers(key:string,config?:{readonly start?:number;readonly end?:number;readonly frames?:readonly number[]}):AnimationFrameDescriptor[]};
  readonly textures:{exists(key:string):boolean};
}

/**
 * Register the four canonical animations for a single character on a
 * scene's `anims` manager. Idempotent — re-entry checks `anims.exists`
 * before creating, so a repeated call (HMR, scene re-entry) is a no-op.
 *
 * Returns the list of registered animation keys (in canonical order:
 * idle / run / jump / attack). Returns `[]` for characters without a
 * loaded source sheet (Owl / Bear in M1).
 *
 * Behaviour notes:
 *   • Walks {@link SPRITE_ANIM_SPECS} so adding a new sheet (e.g.
 *     `hurt.png` in M2) is one entry change here.
 *   • Skips sheets whose underlying texture isn't loaded — protects
 *     against partial asset drops blowing up scene-create.
 *   • Always wires `hideOnComplete: false` so the sprite stays visible
 *     after a one-shot (`jump` / `attack`) finishes.
 */
/** One animation the game registers for a fighter: every frame of `textureKey`. */
export interface CharacterAnimationSheet {
  readonly animKey: string;
  readonly sheet: string;
  readonly textureKey: string;
  readonly frameRate: number;
  readonly repeat: number;
}

/** The animations `registerCharacterSpriteAnimations` creates for a fighter, in its order. */
export function characterAnimationSheets(characterId: CharacterId): CharacterAnimationSheet[] {
  const out: CharacterAnimationSheet[] = [];
  const add = (sheet: string, textureKey: string | null, frameRate: number, repeat: number) => {
    const animKey = `${characterId}.${sheet}.anim`;
    if (textureKey !== null && !out.some((a) => a.animKey === animKey)) out.push({ animKey, sheet, textureKey, frameRate, repeat });
  };
  for (const spec of SPRITE_ANIM_SPECS) add(spec.sheet, getCharacterSpritesheetKey(characterId, spec.sheet), spec.frameRate, spec.repeat);
  const moveSheets = characterId === 'donkeykong'
    ? Object.keys(donkeykongFrames.animations).map((sheet) => ({ sheet, frameRate: 6, repeat: 0 }))
    : characterId === 'link'
      ? Object.keys(linkFrames.animations).map((sheet) => ({ sheet, frameRate: 60, repeat: 0 }))
      : characterId === 'pikachu'
        ? [...MOVE_SHEET_SPECS, ...Object.keys(pikachuFrames.animations).filter(sheet => sheet.startsWith('final')).map(sheet => ({ sheet, frameRate: 60, repeat: 0 }))]
        : MOVE_SHEET_SPECS;
  for (const spec of moveSheets) add(spec.sheet, getCharacterMoveSheetKey(characterId, spec.sheet), spec.frameRate, spec.repeat);
  return out;
}

export function registerCharacterSpriteAnimations(
  scene: SceneAnimSurface,
  characterId: CharacterId,
): ReadonlyArray<string> {
  const created: string[] = [];
  // Per-move clips (every attack its own animation + crouch) ride the same list; fighters
  // without a per-move pack fall through to the collapsed `attack`. Sheets whose texture
  // isn't loaded are skipped so a partial pack never blows up scene-create.
  for (const sheet of characterAnimationSheets(characterId)) {
    if (!scene.textures.exists(sheet.textureKey)) continue;
    if (scene.anims.exists(sheet.animKey)) {
      // Idempotent — already registered (HMR, scene re-entry).
      created.push(sheet.animKey);
      continue;
    }
    const result = scene.anims.create({
      key: sheet.animKey,
      frames: scene.anims.generateFrameNumbers(sheet.textureKey, {}),
      frameRate: sheet.frameRate,
      repeat: sheet.repeat,
      // `showOnStart` makes the sprite visible on play() — defensive
      // guard against an `setVisible(false)` from a parent overlay.
      showOnStart: true,
      // `hideOnComplete: false` keeps the sprite on-screen at the last
      // frame after a one-shot animation finishes (jump apex / attack
      // recovery pose).
      hideOnComplete: false,
    });
    if (result !== false) created.push(sheet.animKey);
  }
  return created;
}

/**
 * Register sprite animations for every character that ships with a
 * loaded source sheet. Walks the full roster — characters whose
 * sheets are not loaded (partial asset drops) are no-ops. Returns the
 * union of all registered animation keys.
 */
export function registerAllCharacterSpriteAnimations(
  scene: SceneAnimSurface,
  // Defaults to EVERY fighter (the canonical `CHARACTER_IDS` source of truth) so
  // a newly-added fighter is animated automatically — `registerCharacterSprite-
  // Animations` already skips any whose sheets aren't loaded, so iterating the
  // full roster is safe and removes the "forgot to add it to the list" footgun.
  characters: ReadonlyArray<CharacterId> = CHARACTER_IDS,
): ReadonlyArray<string> {
  const all: string[] = [];
  for (const id of characters) {
    for (const k of registerCharacterSpriteAnimations(scene, id)) {
      all.push(k);
    }
  }
  return all;
}

// ---------------------------------------------------------------------------
// State-machine binding — wires the classifier to a sprite.play() target
// ---------------------------------------------------------------------------

/**
 * Minimal sprite-play surface this module needs. Declared narrowly so
 * tests can satisfy the contract with a recorder fake without faking
 * Phaser's whole `GameObjects.Sprite`.
 */
export interface PlayableSprite {
  /**
   * Phaser's `play(key, ignoreIfPlaying)` signature. The driver always
   * passes `ignoreIfPlaying === true` so a same-state tick is a no-op.
   */
  play(
    key: string,
    ignoreIfPlaying?: boolean,
  ): unknown;
  /** Currently-playing animation handle (if any). */
  readonly anims?: { isPlaying?: boolean; getName?: () => string };
}

/**
 * Read-only provider of a fighter's per-frame sprite snapshot. Mirrors
 * the shape of `FighterSnapshotProvider` from `fighterAnimationState.ts`
 * so a single Fighter / Character can satisfy both contracts.
 */
export interface SpriteAnimationSnapshotProvider {
  getSpriteAnimationSnapshot(): SpriteAnimationSnapshot;
}

/**
 * Per-fighter sprite-animation state machine. Pulls a snapshot each
 * `tick()`, classifies the sprite state, and — when the resolved state
 * changes — issues a `sprite.play(animKey, true)` against the target
 * sprite. Returns the last-resolved state for callers that want to
 * mirror the choice into the HUD or debug overlay.
 */
export interface SpriteAnimationStateMachine {
  /** Re-poll, re-classify, fire the play() call on key changes. */
  tick(): SpriteAnimationState;
  /** Last-resolved sprite-state (or `null` before the first tick). */
  current(): SpriteAnimationState | null;
  /** Detach so subsequent ticks no-op (used on scene shutdown). */
  detach(): void;
}

/**
 * Build a {@link SpriteAnimationStateMachine} for a `(provider, sprite)`
 * pair. The state machine:
 *
 *   • Caches the last-emitted state so `play()` only fires on actual
 *     state transitions.
 *   • On the very first `tick()`, fires `play()` regardless so the
 *     sprite is primed to its initial pose.
 *   • Reads the per-character animation key off
 *     `getSpriteAnimationKey(characterId, state)`. If the lookup
 *     returns `null` (Owl / Bear without sheets), the state machine
 *     records the resolved state but does not call `play()`.
 *
 * Pure-data caller (recorder fake / live Phaser scene). No timer, no
 * scene event subscriptions — the host scene drives `tick()` from its
 * fixed-step update loop.
 */
export function createSpriteAnimationStateMachine(
  provider: SpriteAnimationSnapshotProvider,
  sprite: PlayableSprite,
): SpriteAnimationStateMachine {
  let last: SpriteAnimationState | null = null;
  let detached = false;
  return {
    tick(): SpriteAnimationState {
      const snap = provider.getSpriteAnimationSnapshot();
      const next = classifySpriteAnimationState(snap);
      if (detached) {
        last = next;
        return next;
      }
      const animKey = getSpriteAnimationKey(snap.characterId, next);
      // Fire play() on the first tick (last === null) OR on state change.
      // `ignoreIfPlaying = true` makes a same-key call a no-op inside
      // Phaser even if our cache is stale, so we never restart a
      // looping animation mid-cycle.
      const stateChanged = last === null || last !== next;
      if (animKey !== null && stateChanged) {
        sprite.play(animKey, true);
      }
      last = next;
      return next;
    },
    current(): SpriteAnimationState | null {
      return last;
    },
    detach(): void {
      detached = true;
    },
  };
}
