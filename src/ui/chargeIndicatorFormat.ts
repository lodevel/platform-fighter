/**
 * Pure formatter helpers for the in-match charge / wind-up indicator.
 *
 * Many moves (Falcon-Punch-style neutral specials, smash finishers, the
 * heavy hammer swing) spend a long **startup** phase winding up before
 * the hitbox spawns — but the generic fighter sprites have no bespoke
 * "charging" art frames, so a player can't tell a fighter is powering up
 * a swing. This module derives a *procedural* charge visual from the
 * fighter's live charge progress (`Character.getChargeProgress()`,
 * `0..1` while winding up, `null` otherwise):
 *
 *   • A pulsing coloured **aura ring** around the body that brightens
 *     and ramps cool → hot (white → yellow → orange → red) as the swing
 *     charges. The pulse blinks faster the closer the charge is to full,
 *     reading as a "building to release" tension.
 *   • A thin **charge bar** floating above the fighter's head whose fill
 *     width tracks the charge fraction and whose colour matches the
 *     aura's hot ramp.
 *
 * Why a separate, pure-function module
 * ------------------------------------
 *
 *   • The Phaser-touching component (`ChargeIndicator.ts`) imports
 *     Phaser, which pulls in browser globals at module-eval time. The
 *     colour ramp / pulse phase / bar-width derivations that need unit
 *     coverage live behind that import line — the same split the shield
 *     bubble, damage HUD, and FPS counter follow.
 *   • Determinism — the pulse phase is driven off the **simulated frame
 *     counter** (`this.physicsEngine.getFrame()` at the scene), never a
 *     wall-clock read. No `Math.random()`, no `Date.now()`. A replayed
 *     match paints identical wind-ups on identical frames.
 *
 * Boundaries
 * ----------
 *
 *   • Pure presentation. The formatter never mutates the fighter — it
 *     only reads the `chargeProgress` snapshot the scene hands it.
 *   • A trivially-short wind-up (a 1-frame jab) would otherwise flash
 *     the aura for a single frame, which reads as visual noise rather
 *     than a charge. The {@link computeChargeIndicatorVisual} entry
 *     point therefore takes a `minProgressToShow` floor so only moves
 *     that actually spend time charging light up.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-fighter input to the charge-indicator formatter for a single
 * render frame.
 *
 *   • `chargeProgress` — `Character.getChargeProgress()`: `null` when
 *                        the fighter is not winding a move up, otherwise
 *                        the `0..1` fraction of the startup window
 *                        already elapsed.
 *   • `frame`          — current simulated physics frame. Drives the
 *                        deterministic pulse / blink phase.
 *   • `bodyRadius`     — half the largest body dimension in viewport
 *                        pixels. The aura ring sits a small padding
 *                        outside this so the fighter sits inside.
 *   • `bodyHeight`     — full body height in viewport pixels. Used to
 *                        float the charge bar above the fighter's head.
 *   • `minProgressToShow` — optional floor (default
 *                        {@link CHARGE_INDICATOR_MIN_PROGRESS_TO_SHOW}).
 *                        A wind-up whose progress never exceeds this on
 *                        any single frame stays invisible, so a 1-frame
 *                        jab doesn't strobe the aura.
 */
export interface ChargeIndicatorInput {
  readonly chargeProgress: number | null;
  readonly frame: number;
  readonly bodyRadius: number;
  readonly bodyHeight: number;
  readonly minProgressToShow?: number;
}

/**
 * Visual properties for a single render frame. The Phaser component
 * applies them verbatim — no further math at the render layer.
 *
 *   • `visible`        — true when the indicator should be drawn at all.
 *   • `ringRadius`     — outer radius of the aura ring (viewport px).
 *   • `ringColor`      — 0xRRGGBB aura tint, ramped white → red.
 *   • `ringFillAlpha`  — translucent fill alpha; modulated by the pulse.
 *   • `ringStrokeAlpha`— outline alpha; modulated by the pulse.
 *   • `ringStrokeWidth`— outline thickness (px); grows with charge.
 *   • `barCenterOffsetY` — signed vertical offset of the bar's centre
 *                        from the body centre (negative = above the
 *                        head).
 *   • `barMaxWidth`    — full width of the bar track (viewport px).
 *   • `barFillWidth`   — filled portion of the bar (`0..barMaxWidth`),
 *                        tracking the charge fraction.
 *   • `barHeight`      — bar thickness (px).
 *   • `barColor`       — 0xRRGGBB fill colour (matches `ringColor`).
 *   • `barTrackAlpha`  — alpha of the empty track behind the fill.
 *   • `barFillAlpha`   — alpha of the filled portion.
 */
export interface ChargeIndicatorVisual {
  readonly visible: boolean;
  readonly ringRadius: number;
  readonly ringColor: number;
  readonly ringFillAlpha: number;
  readonly ringStrokeAlpha: number;
  readonly ringStrokeWidth: number;
  readonly barCenterOffsetY: number;
  readonly barMaxWidth: number;
  readonly barFillWidth: number;
  readonly barHeight: number;
  readonly barColor: number;
  readonly barTrackAlpha: number;
  readonly barFillAlpha: number;
}

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/**
 * Minimum charge fraction a move must reach for the indicator to draw.
 * A 1-frame-startup jab charges from 0 straight past 1 in a single
 * frame; without this floor it would flash the aura for one frame of
 * visual noise. Set just above 0 so any move that spends even a few
 * frames in startup still lights up early.
 */
export const CHARGE_INDICATOR_MIN_PROGRESS_TO_SHOW = 0.02;

/**
 * Padding (viewport px) added to the body radius for the aura ring so
 * the fighter sprite sits visibly inside the glow.
 */
export const CHARGE_INDICATOR_RING_PADDING = 10;

/**
 * Five-stop cool → hot colour ramp keyed to charge fraction. Walked at
 * draw-time; the highest threshold whose value is `<=` the fraction
 * wins. `thresholdFraction: 0` is the catch-all "just started winding
 * up" stop so an early-charge frame always resolves to a colour.
 *
 *   ≥ 0    → white   (wind-up just started — cool)
 *   ≥ 0.25 → pale yellow
 *   ≥ 0.5  → yellow
 *   ≥ 0.75 → orange
 *   ≥ 0.95 → red     (about to release — hot)
 */
export const CHARGE_INDICATOR_COLOR_RAMP: ReadonlyArray<{
  readonly thresholdFraction: number;
  readonly color: number;
}> = [
  { thresholdFraction: 0, color: 0xffffff }, // white — cool start
  { thresholdFraction: 0.25, color: 0xfff0a0 }, // pale yellow
  { thresholdFraction: 0.5, color: 0xffd23f }, // yellow
  { thresholdFraction: 0.75, color: 0xff8c2b }, // orange
  { thresholdFraction: 0.95, color: 0xff3030 }, // red — about to fire
];

/** Aura ring fill alpha at zero charge (faint cool glow). */
export const CHARGE_INDICATOR_RING_FILL_ALPHA_MIN = 0.08;
/** Aura ring fill alpha at full charge (bright hot glow), pre-pulse. */
export const CHARGE_INDICATOR_RING_FILL_ALPHA_MAX = 0.34;

/** Aura ring stroke alpha at zero charge, pre-pulse. */
export const CHARGE_INDICATOR_RING_STROKE_ALPHA_MIN = 0.45;
/** Aura ring stroke alpha at full charge, pre-pulse. */
export const CHARGE_INDICATOR_RING_STROKE_ALPHA_MAX = 1;

/** Aura ring stroke width at zero charge (px). */
export const CHARGE_INDICATOR_RING_STROKE_WIDTH_MIN = 2;
/** Aura ring stroke width at full charge (px). */
export const CHARGE_INDICATOR_RING_STROKE_WIDTH_MAX = 5;

/**
 * Pulse blink period (frames) at the START of a charge. The aura
 * brightens / dims on this period; the period shrinks toward
 * {@link CHARGE_INDICATOR_PULSE_PERIOD_FAST} as charge approaches full
 * so the blink visibly accelerates near release.
 */
export const CHARGE_INDICATOR_PULSE_PERIOD_SLOW = 18;
/** Pulse blink period (frames) at FULL charge — fast, urgent blink. */
export const CHARGE_INDICATOR_PULSE_PERIOD_FAST = 4;

/**
 * Depth of the pulse modulation. The pulse multiplier swings between
 * `(1 - depth)` (dim trough) and `1` (bright peak); a depth of 0.55
 * gives a clearly-visible throb without ever fully extinguishing the
 * aura (so the charge stays readable in the trough).
 */
export const CHARGE_INDICATOR_PULSE_DEPTH = 0.55;

/** Charge-bar full width (viewport px). */
export const CHARGE_INDICATOR_BAR_WIDTH = 48;
/** Charge-bar thickness (viewport px). */
export const CHARGE_INDICATOR_BAR_HEIGHT = 6;
/**
 * Gap (viewport px) between the top of the fighter's head and the
 * charge bar, so the bar floats clearly clear of the silhouette.
 */
export const CHARGE_INDICATOR_BAR_GAP_ABOVE_HEAD = 14;
/** Alpha of the empty bar track. */
export const CHARGE_INDICATOR_BAR_TRACK_ALPHA = 0.5;
/** Alpha of the filled portion of the bar. */
export const CHARGE_INDICATOR_BAR_FILL_ALPHA = 0.95;

// ---------------------------------------------------------------------------
// Pure derivations
// ---------------------------------------------------------------------------

/**
 * Clamp a number to `[lo, hi]`. NaN / non-finite collapses to `lo`.
 */
function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/** Linear interpolation `a → b` by `t` (caller is responsible for clamping `t`). */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Pick the aura / bar colour for a charge fraction from the cool → hot
 * ramp. Walks the (5-entry, O(1)) ramp once and returns the highest
 * threshold whose `thresholdFraction <= fraction`.
 */
export function chargeIndicatorColor(fraction: number): number {
  const f = clamp(fraction, 0, 1);
  let chosen = CHARGE_INDICATOR_COLOR_RAMP[0]!.color;
  for (const entry of CHARGE_INDICATOR_COLOR_RAMP) {
    if (f >= entry.thresholdFraction) {
      chosen = entry.color;
    } else {
      break;
    }
  }
  return chosen;
}

/**
 * Pulse blink period (frames) for a given charge fraction. Linearly
 * shrinks from {@link CHARGE_INDICATOR_PULSE_PERIOD_SLOW} (at 0 charge)
 * toward {@link CHARGE_INDICATOR_PULSE_PERIOD_FAST} (at full charge) so
 * the blink accelerates as the swing nears release. The returned period
 * is at least 1 frame so the pulse phase math never divides by zero.
 */
export function chargeIndicatorPulsePeriod(fraction: number): number {
  const f = clamp(fraction, 0, 1);
  const period = lerp(
    CHARGE_INDICATOR_PULSE_PERIOD_SLOW,
    CHARGE_INDICATOR_PULSE_PERIOD_FAST,
    f,
  );
  // Round to a whole frame so the blink lands on integer frame
  // boundaries (matches the shield bubble's frame-quantised strobe) and
  // floor at 1 so a degenerate period can't produce a zero divisor.
  return Math.max(1, Math.round(period));
}

/**
 * Deterministic pulse multiplier in `[1 - depth, 1]` for a given frame
 * and charge fraction. The pulse is a triangular wave keyed off the
 * **simulated frame counter** (never wall-clock) so it is replay-stable:
 *
 *   • The wave period is {@link chargeIndicatorPulsePeriod}(fraction),
 *     which shrinks as the charge builds — the throb speeds up.
 *   • A triangular ramp (up then down across the period) reads as a
 *     smooth breathing glow rather than a hard on/off strobe; the
 *     amplitude `depth` keeps the trough from fully extinguishing the
 *     aura so the charge stays legible at every phase.
 *
 * Returns `1` (full brightness) for non-finite / negative frames as a
 * defensive default — a fresh match always starts at frame 0.
 */
export function chargeIndicatorPulseMultiplier(
  frame: number,
  fraction: number,
  depth: number = CHARGE_INDICATOR_PULSE_DEPTH,
): number {
  const safeFrame =
    Number.isFinite(frame) && frame >= 0 ? Math.floor(frame) : 0;
  const period = chargeIndicatorPulsePeriod(fraction);
  // Position within the current pulse cycle, in [0, 1).
  const phase = (safeFrame % period) / period;
  // Triangular wave: 0 → 1 over the first half, 1 → 0 over the second.
  const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  const d = clamp(depth, 0, 1);
  // Map the [0, 1] triangle onto [1 - d, 1] so the peak is full bright
  // and the trough is dimmed by `depth`.
  return 1 - d + d * tri;
}

/**
 * Compute the per-frame visual properties for a fighter's charge
 * indicator. The Phaser component applies the result verbatim.
 *
 *   • `chargeProgress === null` → invisible (not winding a move up).
 *   • `chargeProgress <= minProgressToShow` → invisible (a sub-threshold
 *     wind-up; e.g. a 1-frame jab that never spends a charge frame).
 *   • otherwise → a pulsing cool → hot aura ring whose brightness and
 *     stroke grow with charge, plus a head-mounted bar whose fill width
 *     tracks the charge fraction. Both modulate by the deterministic,
 *     frame-driven pulse that blinks faster near full charge.
 */
export function computeChargeIndicatorVisual(
  input: ChargeIndicatorInput,
): ChargeIndicatorVisual {
  const { chargeProgress, frame, bodyRadius, bodyHeight } = input;
  const minToShow =
    input.minProgressToShow ?? CHARGE_INDICATOR_MIN_PROGRESS_TO_SHOW;

  const hidden: ChargeIndicatorVisual = {
    visible: false,
    ringRadius: 0,
    ringColor: 0xffffff,
    ringFillAlpha: 0,
    ringStrokeAlpha: 0,
    ringStrokeWidth: 0,
    barCenterOffsetY: 0,
    barMaxWidth: 0,
    barFillWidth: 0,
    barHeight: 0,
    barColor: 0xffffff,
    barTrackAlpha: 0,
    barFillAlpha: 0,
  };

  if (
    chargeProgress === null ||
    !Number.isFinite(chargeProgress) ||
    chargeProgress <= minToShow
  ) {
    return hidden;
  }

  const fraction = clamp(chargeProgress, 0, 1);
  const color = chargeIndicatorColor(fraction);
  const pulse = chargeIndicatorPulseMultiplier(frame, fraction);

  const radius = Math.max(0, bodyRadius) + CHARGE_INDICATOR_RING_PADDING;

  // Base (pre-pulse) intensities ramp with charge; the pulse then
  // modulates the alphas so the glow throbs.
  const baseFillAlpha = lerp(
    CHARGE_INDICATOR_RING_FILL_ALPHA_MIN,
    CHARGE_INDICATOR_RING_FILL_ALPHA_MAX,
    fraction,
  );
  const baseStrokeAlpha = lerp(
    CHARGE_INDICATOR_RING_STROKE_ALPHA_MIN,
    CHARGE_INDICATOR_RING_STROKE_ALPHA_MAX,
    fraction,
  );
  const strokeWidth = lerp(
    CHARGE_INDICATOR_RING_STROKE_WIDTH_MIN,
    CHARGE_INDICATOR_RING_STROKE_WIDTH_MAX,
    fraction,
  );

  // Float the bar above the head: body centre is at offset 0, the head
  // is half the body height up, then a small gap, then half the bar's
  // own height so the bar's CENTRE sits clear of the silhouette.
  const barCenterOffsetY = -(
    Math.max(0, bodyHeight) / 2 +
    CHARGE_INDICATOR_BAR_GAP_ABOVE_HEAD +
    CHARGE_INDICATOR_BAR_HEIGHT / 2
  );

  return {
    visible: true,
    ringRadius: radius,
    ringColor: color,
    ringFillAlpha: clamp(baseFillAlpha * pulse, 0, 1),
    ringStrokeAlpha: clamp(baseStrokeAlpha * pulse, 0, 1),
    ringStrokeWidth: strokeWidth,
    barCenterOffsetY,
    barMaxWidth: CHARGE_INDICATOR_BAR_WIDTH,
    barFillWidth: CHARGE_INDICATOR_BAR_WIDTH * fraction,
    barHeight: CHARGE_INDICATOR_BAR_HEIGHT,
    barColor: color,
    barTrackAlpha: CHARGE_INDICATOR_BAR_TRACK_ALPHA,
    barFillAlpha: CHARGE_INDICATOR_BAR_FILL_ALPHA,
  };
}
