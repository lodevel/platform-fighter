/**
 * Phaser-free formatting helpers for the in-match damage HUD.
 *
 * Sub-AC 3 of AC 60003: render each fighter's current damage percentage
 * on screen. The actual `DamageHud` Phaser component (see `DamageHud.ts`)
 * imports Phaser, which pulls in browser globals (`navigator`,
 * `document`, …) at module-eval time — so any logic that needs to be
 * exercised by the unit-test suite has to live behind that import line.
 *
 * Two pure functions live here:
 *
 *   1. {@link formatDamagePercent} — turns a numeric percent into the
 *      canonical Smash-style display string ("23%", "152%", …). One-shot
 *      truncation toward zero so a 23.7 % accumulator doesn't flicker
 *      between "23%" and "24%" between fixed steps; clamped at the
 *      ontology max (`MAX_DAMAGE_PERCENT` = 999) so an off-by-one in a
 *      damage source can't print "1000%". Negative numbers are clamped
 *      to 0 % — the percent meter is one-directional in v1 (no healing).
 *
 *   2. {@link damagePercentColor} — picks a tint that ramps from white
 *      through yellow / orange to red as the percent climbs. Mirrors the
 *      visual language of every Smash entry: low percent reads "fresh /
 *      safe", high percent reads "kill range / danger". The thresholds
 *      are chosen so the colour transitions land at intuitive milestones
 *      (50 / 100 / 150 %) without needing a gradient.
 *
 * Determinism: both functions are pure — same input → same output, no
 * `Math.random()`, no wall-clock reads. The replay system can re-run a
 * recorded match and the HUD will paint identically.
 */

import { MAX_DAMAGE_PERCENT } from '../characters/combat';

/**
 * Colour ramp keyed to damage percent thresholds.
 *
 * Hex values match the rest of the M1 HUD palette (warm yellows / reds
 * on a cool slate background) so the meter reads as part of the same
 * UI layer as the stock dots and timer.
 *
 *   0–49   %  → bright white      (fresh)
 *   50–99  %  → straw yellow      (warming up)
 *   100–149%  → orange            (kill range opens)
 *   150+   %  → red               (one good hit and you're gone)
 */
export const DAMAGE_HUD_COLOR_RAMP: ReadonlyArray<{
  readonly threshold: number;
  readonly color: number;
}> = [
  { threshold: 0, color: 0xffffff }, // white
  { threshold: 50, color: 0xffe066 }, // straw yellow
  { threshold: 100, color: 0xff944d }, // orange
  { threshold: 150, color: 0xff3b3b }, // red
];

/**
 * Format a numeric damage percent into the canonical on-screen string.
 *
 *   formatDamagePercent(0)     → "0%"
 *   formatDamagePercent(23.7)  → "23%"   (truncated toward zero)
 *   formatDamagePercent(-5)    → "0%"    (clamped — no healing in v1)
 *   formatDamagePercent(1500)  → "999%"  (clamped at MAX_DAMAGE_PERCENT)
 *   formatDamagePercent(NaN)   → "0%"    (defensive — NaN can't paint)
 *
 * Why truncate not round: a hazard tick that brings the meter from 23.0
 * to 23.4 then to 23.8 would produce 23 → 23 → 24 with rounding — the
 * jump from 23 to 24 looks like a fresh hit even though it's the same
 * source. Truncation gives the meter a single, monotonic increment per
 * 1 % of damage taken, which reads more honestly.
 */
export function formatDamagePercent(percent: number): string {
  if (!Number.isFinite(percent) || percent < 0) {
    return '0%';
  }
  const capped = percent > MAX_DAMAGE_PERCENT ? MAX_DAMAGE_PERCENT : percent;
  // Math.trunc instead of Math.floor so a hypothetical negative value
  // (already filtered above) wouldn't surprise us; equivalent for the
  // non-negative range we're in.
  return `${Math.trunc(capped)}%`;
}

/**
 * Pick a colour for the percent text based on the active threshold ramp.
 *
 * Walks {@link DAMAGE_HUD_COLOR_RAMP} once per call (4 entries — O(1)
 * for any practical purpose) and returns the highest-threshold entry
 * whose threshold is `<= percent`. NaN / negative inputs fall through
 * to the lowest band so the HUD never displays an undefined tint.
 */
export function damagePercentColor(percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) {
    return DAMAGE_HUD_COLOR_RAMP[0]!.color;
  }
  let chosen = DAMAGE_HUD_COLOR_RAMP[0]!.color;
  for (const entry of DAMAGE_HUD_COLOR_RAMP) {
    if (percent >= entry.threshold) {
      chosen = entry.color;
    } else {
      break;
    }
  }
  return chosen;
}

/**
 * Phaser uses `'#rrggbb'` strings for `Phaser.GameObjects.Text` colours
 * and 0xRRGGBB integers for tints. The HUD component sets both, so we
 * expose a converter that pads the hex to a six-digit string.
 */
export function colorIntToHexString(value: number): string {
  const clamped = Math.max(0, Math.min(0xffffff, Math.trunc(value)));
  return `#${clamped.toString(16).padStart(6, '0')}`;
}
