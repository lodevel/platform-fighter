/**
 * Pure formatter helpers for melee SWING TRAILS.
 *
 * Held weapons (sword / bat / hammer / spear) and heavy attacks (smash
 * finishers) spawn a real Matter hitbox via the canonical attack path,
 * but the generic fighter sprites ship no swing-animation frames — so a
 * player sees damage land with no visible "the blade swept through
 * here" cue. This module derives a brief translucent arc / streak drawn
 * along the move's active-frame hitbox sweep: a coloured smear tied to
 * the real hitbox geometry so the swing reads truthfully.
 *
 * The trail is the visual companion to the hit spark — the spark marks
 * *where contact landed*, the trail shows *the path the weapon swept*.
 *
 * Why a separate, pure-function module
 * ------------------------------------
 *
 *   • The Phaser-touching component (`SwingTrail.ts`) imports Phaser,
 *     which pulls in browser globals at module-eval time. The
 *     classification ("is this move worth a trail?"), colour ramp, and
 *     per-active-frame alpha falloff that need unit coverage live behind
 *     that import line — the same split every other overlay follows.
 *   • Determinism — every value here is a pure function of (move type /
 *     id, damage, the active-frame index, the hitbox geometry). No
 *     `Math.random()`, no `Date.now()`. The trail is render-only, but we
 *     keep it replay-stable so a recording and its playback look
 *     identical.
 *
 * Boundaries
 * ----------
 *
 *   • Pure presentation. The formatter never spawns a hitbox or mutates
 *     a fighter — it reads the active-attack snapshot the scene hands it
 *     and returns flat visual properties.
 *   • Geometry truthfulness — the trail's footprint is derived from the
 *     SAME `move.hitbox` (offset / width / height, mirrored by facing)
 *     the runtime spawns the real sensor from, so a translucent streak
 *     never lies about the weapon's reach.
 */

import type { AttackMove } from '../characters/attacks';

// ---------------------------------------------------------------------------
// Tuning constants (frozen)
// ---------------------------------------------------------------------------

/**
 * Move ids that always get a swing trail regardless of their `type`
 * bucket — the held-weapon item moves. These read as deliberate weapon
 * swings (the sword slash especially was the user's "0 visual cue"
 * complaint) and benefit most from a visible arc.
 *
 * Frozen so a future move-data edit can't accidentally mutate the set
 * at runtime.
 */
export const SWING_TRAIL_WEAPON_MOVE_IDS: ReadonlySet<string> = new Set([
  'item.sword.slash',
  'item.bat.swing',
  'item.hammer.smash',
  'item.spear.thrust',
]);

/**
 * Move `type` buckets that get a swing trail. Smashes are the heavy
 * "wind up and crush" finishers — the same family the charge indicator
 * already lights up the wind-up for; the trail completes that arc by
 * showing the release sweep.
 *
 * Jabs / tilts / aerials are deliberately excluded — they fire fast and
 * often, and a trail on every poke would smear the screen. The hit
 * spark already covers "this poke connected".
 */
export const SWING_TRAIL_MOVE_TYPES: ReadonlySet<string> = new Set([
  'smash',
]);

/** Trail fill alpha at the start of the active window (freshest sweep). */
export const SWING_TRAIL_PEAK_ALPHA = 0.5;

/** Trail stroke alpha at the start of the active window. */
export const SWING_TRAIL_PEAK_STROKE_ALPHA = 0.85;

/** Stroke thickness (px) of the trail's outline. */
export const SWING_TRAIL_STROKE_WIDTH = 2;

/**
 * How many active frames of history the trail fades across. The trail
 * is drawn fresh each active frame; earlier frames' streaks fade out
 * over this many frames so a multi-frame active window leaves a smear
 * behind the leading edge rather than a single flat rectangle.
 */
export const SWING_TRAIL_FADE_FRAMES = 5;

/**
 * Damage value (percent) treated as the top of the trail's intensity
 * ramp (drives the hot-colour pick). Matched to the heavy end of the
 * roster's weapon / smash damage.
 */
export const SWING_TRAIL_MAX_DAMAGE = 22;

/** Damage value (percent) at the bottom of the trail's intensity ramp. */
export const SWING_TRAIL_MIN_DAMAGE = 4;

/**
 * Three-stop colour ramp keyed to trail intensity (0..1). Walked once
 * at draw-time; the highest threshold whose value is `<=` the intensity
 * wins. `threshold: 0` is the catch-all.
 *
 *   ≥ 0.66 → hot orange   (a heavy hammer / smash)
 *   ≥ 0.33 → cyan-white   (a mid weapon swing)
 *   ≥ 0    → pale steel   (a light weapon poke)
 */
export const SWING_TRAIL_COLOR_RAMP: ReadonlyArray<{
  readonly thresholdIntensity: number;
  readonly color: number;
}> = Object.freeze([
  Object.freeze({ thresholdIntensity: 0, color: 0xcfe8ff }),
  Object.freeze({ thresholdIntensity: 0.33, color: 0x9fe8ff }),
  Object.freeze({ thresholdIntensity: 0.66, color: 0xffb060 }),
]);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Snapshot the scene hands the formatter for one active-attack frame.
 *
 *   • `moveId`        — the active move's id (weapon-move lookup).
 *   • `moveType`      — the active move's `type` bucket (smash lookup).
 *   • `damage`        — the move's damage (intensity ramp).
 *   • `phase`         — the live attack phase; only `'active'` draws.
 *   • `framesIntoActive` — frames since the active window opened
 *                     (0 on the first active frame). Drives the
 *                     leading-edge alpha falloff.
 *   • `hitbox`        — the move's authored hitbox geometry. The
 *                     formatter mirrors `offsetX` by `facing` exactly as
 *                     {@link computeHitboxCenter} does so the trail sits
 *                     on the real sensor footprint.
 *   • `facing`        — the latched attack facing (1 = right, -1 left).
 */
export interface SwingTrailInput {
  readonly moveId: string;
  readonly moveType: string;
  readonly damage: number;
  readonly phase: 'startup' | 'active' | 'recovery';
  readonly framesIntoActive: number;
  readonly hitbox: AttackMove['hitbox'];
  readonly facing: 1 | -1;
}

/**
 * Per-frame trail visual. The Phaser layer paints a single translucent
 * rectangle on the hitbox footprint with these properties. (`offsetX` /
 * `offsetY` are relative to the attacker's body centre — the scene adds
 * the live body position.)
 */
export interface SwingTrailVisual {
  /** True when a trail should be drawn this frame. */
  readonly visible: boolean;
  /** Hitbox-centre offset from the body centre (px), mirrored by facing. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Footprint size (px) — equals the real hitbox width / height. */
  readonly width: number;
  readonly height: number;
  readonly fillColor: number;
  readonly fillAlpha: number;
  readonly strokeColor: number;
  readonly strokeAlpha: number;
  readonly strokeWidth: number;
}

// ---------------------------------------------------------------------------
// Pure derivations
// ---------------------------------------------------------------------------

/** Clamp a number to `[lo, hi]`, collapsing non-finite input to `lo`. */
function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/**
 * Does this move earn a swing trail? True for the held-weapon item
 * moves and for `smash`-type finishers. Everything else (jabs, tilts,
 * aerials, specials, grabs) is excluded so the screen isn't smeared by
 * a trail on every fast poke.
 */
export function swingTrailAppliesTo(moveId: string, moveType: string): boolean {
  return (
    SWING_TRAIL_WEAPON_MOVE_IDS.has(moveId) ||
    SWING_TRAIL_MOVE_TYPES.has(moveType)
  );
}

/**
 * Map a move's damage to a `0..1` trail intensity for the colour pick.
 * Below {@link SWING_TRAIL_MIN_DAMAGE} → 0; at / above
 * {@link SWING_TRAIL_MAX_DAMAGE} → 1; linear between.
 */
export function swingTrailIntensity(damage: number): number {
  const d = clamp(damage, 0, Number.MAX_SAFE_INTEGER);
  const span = SWING_TRAIL_MAX_DAMAGE - SWING_TRAIL_MIN_DAMAGE;
  if (span <= 0) return 1;
  return clamp((d - SWING_TRAIL_MIN_DAMAGE) / span, 0, 1);
}

/**
 * Pick the trail tint for a given intensity from the colour ramp. Walks
 * the ramp once (3 entries — O(1)) and returns the highest threshold
 * whose `thresholdIntensity <= intensity`.
 */
export function swingTrailColor(intensity: number): number {
  const f = clamp(intensity, 0, 1);
  let chosen = SWING_TRAIL_COLOR_RAMP[0]!.color;
  for (const entry of SWING_TRAIL_COLOR_RAMP) {
    if (f >= entry.thresholdIntensity) {
      chosen = entry.color;
    } else {
      break;
    }
  }
  return chosen;
}

/**
 * Leading-edge alpha multiplier for the trail at `framesIntoActive`
 * frames into the active window. The freshest frame is fully bright;
 * each subsequent active frame fades by `1 / SWING_TRAIL_FADE_FRAMES`
 * so a long active window leaves a tapering smear behind the swing's
 * leading edge instead of a flat constant rectangle. Floors at a small
 * value (not zero) so a long active window still shows *something* for
 * its whole duration.
 */
export function swingTrailActiveAlphaMultiplier(framesIntoActive: number): number {
  const f = clamp(framesIntoActive, 0, Number.MAX_SAFE_INTEGER);
  const fade = 1 - f / SWING_TRAIL_FADE_FRAMES;
  return clamp(fade, 0.25, 1);
}

/**
 * Compute the per-frame swing-trail visual. The Phaser layer applies
 * the result verbatim — paints a translucent rectangle on the
 * mirrored hitbox footprint, or hides it when `visible` is false.
 *
 *   • Returns `visible: false` for any move that doesn't earn a trail,
 *     or any phase other than `'active'` (no trail during startup /
 *     recovery — the weapon isn't swinging through anything yet).
 *   • The footprint matches the real hitbox: `offsetX` mirrored by
 *     `facing`, `offsetY` taken as-is, width / height verbatim — so the
 *     translucent streak never overstates the weapon's reach.
 */
export function computeSwingTrailVisual(input: SwingTrailInput): SwingTrailVisual {
  const hidden: SwingTrailVisual = {
    visible: false,
    offsetX: 0,
    offsetY: 0,
    width: 0,
    height: 0,
    fillColor: 0x000000,
    fillAlpha: 0,
    strokeColor: 0x000000,
    strokeAlpha: 0,
    strokeWidth: 0,
  };

  if (input.phase !== 'active') return hidden;
  if (!swingTrailAppliesTo(input.moveId, input.moveType)) return hidden;

  const intensity = swingTrailIntensity(input.damage);
  const color = swingTrailColor(intensity);
  const fade = swingTrailActiveAlphaMultiplier(input.framesIntoActive);

  return {
    visible: true,
    // Mirror exactly as `computeHitboxCenter` / `spawnHitbox` do:
    // authored offsetX is positive-forward, multiplied by facing;
    // offsetY is mirror-invariant.
    offsetX: input.hitbox.offsetX * input.facing,
    offsetY: input.hitbox.offsetY,
    width: input.hitbox.width,
    height: input.hitbox.height,
    fillColor: color,
    fillAlpha: SWING_TRAIL_PEAK_ALPHA * fade,
    strokeColor: color,
    strokeAlpha: SWING_TRAIL_PEAK_STROKE_ALPHA * fade,
    strokeWidth: SWING_TRAIL_STROKE_WIDTH,
  };
}
