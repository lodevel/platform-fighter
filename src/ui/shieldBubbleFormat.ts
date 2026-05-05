/**
 * Pure formatter helpers for the in-match shield bubble overlay.
 *
 * AC 60401 Sub-AC 1 (visual half) — every fighter that raises the
 * shield key gets a translucent coloured "bubble" rendered around their
 * body for the duration of the active state. The bubble's radius
 * shrinks with shield health (so a near-broken shield reads as a tiny,
 * fragile sphere), and its tint ramps from healthy-blue → warning-amber
 * → danger-red as health drains. While the shield is `'broken'` (stun
 * lockout) we paint a different visual — a jagged red / cream
 * "shatter" ring strobing around the helpless fighter so the punisher
 * can read the window at a glance.
 *
 * Why a separate, pure-function module
 * ------------------------------------
 *
 *   • The Phaser-touching component (`ShieldBubble.ts`) imports Phaser,
 *     which pulls in browser globals at module-eval time. Logic that
 *     needs unit-test coverage (radius / colour / alpha derivations,
 *     visibility flags, strobe phase) has to live behind that import
 *     line — same pattern the damage HUD, FPS counter, and reconnect
 *     overlay follow.
 *   • Determinism — the bubble visuals are computed off the live
 *     `ShieldState` plus the simulated frame counter (for the strobe
 *     phase). No `Math.random()`, no wall-clock reads. A replayed match
 *     paints identical bubbles on identical frames.
 *
 * Boundaries
 * ----------
 *
 *   • Pure presentation. The formatter never mutates the underlying
 *     {@link ShieldState} — it only reads it.
 *   • The strobe period for the broken-state visual ticks off the
 *     simulated frame counter so the visual is replay-deterministic.
 *     Wall-clock pulses would desync between the recording machine and
 *     the playback machine; we never use them.
 */

import type { ShieldState } from '../characters/shieldState';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-fighter input to the bubble formatter for a single render frame.
 *
 *   • `state`            — the live shield state machine snapshot.
 *   • `maxHealth`        — the resolved tuning's `maxHealth`. Used to
 *                          normalise the current health into a 0..1
 *                          fraction for radius / colour ramps.
 *   • `bodyRadius`       — half the largest body dimension in viewport
 *                          pixels. The healthy bubble's outer radius
 *                          starts a few px outside the body so the
 *                          fighter sprite sits visibly inside.
 *   • `frame`            — current simulated physics frame. Drives the
 *                          deterministic strobe for the broken-state
 *                          shatter ring.
 */
export interface ShieldBubbleInput {
  readonly state: ShieldState;
  readonly maxHealth: number;
  readonly bodyRadius: number;
  readonly frame: number;
}

/**
 * Visual properties for a single render frame. The Phaser component
 * applies them verbatim — no further math at the render layer.
 *
 *   • `visible` — true when the bubble should be drawn. Idle shields
 *                 are invisible (the player's not actively defending);
 *                 active and broken shields are both visible (with
 *                 different fill / stroke / strobe behaviour).
 *   • `radius`  — outer radius in viewport pixels. Shrinks linearly
 *                 with the health fraction so a near-broken shield
 *                 reads as fragile.
 *   • `fillColor` / `strokeColor` — 0xRRGGBB ints. Ramped from blue
 *                 (healthy) → amber (mid) → red (about to break).
 *   • `fillAlpha` / `strokeAlpha` — translucency. The strobe phase on a
 *                 broken shield modulates these to flicker.
 *   • `strokeWidth` — outline thickness in px. Slightly thicker on the
 *                 broken-shield ring so the shattered visual reads
 *                 stronger than the held-up bubble.
 */
export interface ShieldBubbleVisual {
  readonly visible: boolean;
  readonly radius: number;
  readonly fillColor: number;
  readonly fillAlpha: number;
  readonly strokeColor: number;
  readonly strokeAlpha: number;
  readonly strokeWidth: number;
}

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/**
 * Padding (in viewport pixels) added to the body radius for a full-HP
 * shield so the fighter sprite sits visibly inside the bubble. The
 * smallest visible bubble (low-HP) shrinks to roughly the body radius
 * so the player can still see "I'm defending, but barely".
 */
export const SHIELD_BUBBLE_FULL_PADDING = 14;

/**
 * Floor on the bubble's outer radius (relative to body radius). Even at
 * 0 % shield HP the bubble doesn't shrink to nothing — it stays just
 * large enough to enclose the fighter's body so the bubble visual is
 * visually consistent with "a defensive shell" right up to the break.
 */
export const SHIELD_BUBBLE_MIN_PADDING = 2;

/**
 * Three-stop colour ramp keyed to shield health fraction. The ramp is
 * walked at draw-time; the highest threshold whose value is `<=` the
 * health fraction wins. `threshold: 0` is the catch-all for "almost
 * broken" so a 0 % shield (drained the same frame it broke, before
 * transitioning to `'broken'`) still resolves to a colour.
 *
 *   ≥ 0.66 → cool blue       (healthy / fresh)
 *   ≥ 0.33 → warm amber      (taken some hits)
 *   ≥ 0    → danger red      (one more hit and you're shattered)
 */
export const SHIELD_BUBBLE_HEALTH_COLOR_RAMP: ReadonlyArray<{
  readonly thresholdFraction: number;
  readonly color: number;
}> = [
  { thresholdFraction: 0, color: 0xff4040 }, // red — almost broken
  { thresholdFraction: 0.33, color: 0xffb84d }, // amber — mid
  { thresholdFraction: 0.66, color: 0x4dd0ff }, // blue — healthy
];

/**
 * Fill alpha for an active shield bubble. Translucent enough that the
 * fighter sprite reads through; opaque enough that the bubble is
 * unmistakable from across the screen.
 */
export const SHIELD_BUBBLE_ACTIVE_FILL_ALPHA = 0.32;

/** Stroke alpha for the active bubble's outline. */
export const SHIELD_BUBBLE_ACTIVE_STROKE_ALPHA = 0.85;

/** Stroke width (px) for the active bubble's outline. */
export const SHIELD_BUBBLE_ACTIVE_STROKE_WIDTH = 3;

/** Fill colour for the broken-shield "shatter" ring (cream / bone). */
export const SHIELD_BUBBLE_BROKEN_FILL_COLOR = 0xfff4d6;

/** Stroke colour for the broken-shield "shatter" ring (danger red). */
export const SHIELD_BUBBLE_BROKEN_STROKE_COLOR = 0xff2a2a;

/** Stroke width (px) for the broken-shield ring. */
export const SHIELD_BUBBLE_BROKEN_STROKE_WIDTH = 5;

/**
 * Period (frames) of the broken-shield strobe. Two on / two off feel —
 * fast enough to read as "stunned, helpless" without inducing seizure-
 * grade flicker.
 */
export const SHIELD_BUBBLE_BROKEN_STROBE_PERIOD = 6;

// ---------------------------------------------------------------------------
// Pure derivations
// ---------------------------------------------------------------------------

/**
 * Clamp a number to `[lo, hi]`. Tiny helper so the public derivations
 * read cleanly.
 */
function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/**
 * Health → 0..1 fraction. Defensive against a zero / negative
 * `maxHealth` (collapses to 0) and against a transient `health > max`
 * (clamps to 1).
 */
export function shieldHealthFraction(
  health: number,
  maxHealth: number,
): number {
  if (!Number.isFinite(maxHealth) || maxHealth <= 0) return 0;
  return clamp(health / maxHealth, 0, 1);
}

/**
 * Pick the bubble fill / stroke colour for an active shield from the
 * health-fraction colour ramp. Walks the ramp once (3 entries — O(1))
 * and returns the highest threshold whose `thresholdFraction <=
 * fraction`.
 */
export function shieldBubbleHealthColor(fraction: number): number {
  const f = clamp(fraction, 0, 1);
  let chosen = SHIELD_BUBBLE_HEALTH_COLOR_RAMP[0]!.color;
  for (const entry of SHIELD_BUBBLE_HEALTH_COLOR_RAMP) {
    if (f >= entry.thresholdFraction) {
      chosen = entry.color;
    } else {
      break;
    }
  }
  return chosen;
}

/**
 * Outer radius of the bubble for an active shield. Linearly
 * interpolates between {@link SHIELD_BUBBLE_MIN_PADDING} (at 0 % health)
 * and {@link SHIELD_BUBBLE_FULL_PADDING} (at 100 %) on top of the body
 * radius. A floor at the body radius keeps the bubble visible.
 */
export function shieldBubbleActiveRadius(
  bodyRadius: number,
  fraction: number,
): number {
  const f = clamp(fraction, 0, 1);
  const padding =
    SHIELD_BUBBLE_MIN_PADDING +
    (SHIELD_BUBBLE_FULL_PADDING - SHIELD_BUBBLE_MIN_PADDING) * f;
  return Math.max(0, bodyRadius) + padding;
}

/**
 * Strobe phase for the broken-shield ring — `true` on even periods,
 * `false` on odd. Driven by the simulated frame counter so the strobe
 * is replay-deterministic.
 */
export function shieldBubbleBrokenStrobeOn(frame: number): boolean {
  // Modulo a positive period; floor handles negative / NaN frames
  // defensively (a fresh match always starts at frame 0).
  const safeFrame = Number.isFinite(frame) && frame >= 0 ? Math.floor(frame) : 0;
  const period = SHIELD_BUBBLE_BROKEN_STROBE_PERIOD;
  return Math.floor(safeFrame / period) % 2 === 0;
}

/**
 * Compute the per-frame visual properties for a fighter's shield
 * bubble. The Phaser component applies the result verbatim.
 *
 *   • `'idle'`   → invisible. Fields default to a zero-size red bubble
 *                  so the component can paint defensively.
 *   • `'active'` → coloured bubble shrinking with health.
 *   • `'broken'` → strobing red / cream shatter ring at the broken
 *                  radius (the outer "shell" right before the shatter).
 */
export function computeShieldBubbleVisual(
  input: ShieldBubbleInput,
): ShieldBubbleVisual {
  const { state, maxHealth, bodyRadius, frame } = input;

  if (state.name === 'idle') {
    return {
      visible: false,
      radius: 0,
      fillColor: 0x000000,
      fillAlpha: 0,
      strokeColor: 0x000000,
      strokeAlpha: 0,
      strokeWidth: 0,
    };
  }

  if (state.name === 'broken') {
    const strobeOn = shieldBubbleBrokenStrobeOn(frame);
    return {
      visible: true,
      // The shatter ring sits at the bubble's outermost healthy radius
      // so the visual reads "the shell that just gave way". A constant
      // outer ring (independent of remaining health, which is zero in
      // the broken state) keeps the punish window unambiguous.
      radius: shieldBubbleActiveRadius(bodyRadius, 1),
      fillColor: SHIELD_BUBBLE_BROKEN_FILL_COLOR,
      fillAlpha: strobeOn ? 0.4 : 0.1,
      strokeColor: SHIELD_BUBBLE_BROKEN_STROKE_COLOR,
      strokeAlpha: strobeOn ? 0.95 : 0.45,
      strokeWidth: SHIELD_BUBBLE_BROKEN_STROKE_WIDTH,
    };
  }

  // 'active'
  const fraction = shieldHealthFraction(state.health, maxHealth);
  const color = shieldBubbleHealthColor(fraction);
  return {
    visible: true,
    radius: shieldBubbleActiveRadius(bodyRadius, fraction),
    fillColor: color,
    fillAlpha: SHIELD_BUBBLE_ACTIVE_FILL_ALPHA,
    strokeColor: color,
    strokeAlpha: SHIELD_BUBBLE_ACTIVE_STROKE_ALPHA,
    strokeWidth: SHIELD_BUBBLE_ACTIVE_STROKE_WIDTH,
  };
}
