/**
 * Distance evaluation — pure metrics + zone classification used by
 * every AI difficulty tier (AC 10202 Sub-AC 2).
 *
 * Why a dedicated module
 * ----------------------
 *
 * Target selection and threat scoring both consume *distance* — but
 * distance is not a single number. Different decisions need different
 * metrics:
 *
 *   • Target selection prefers a fast 1D check ("which opponent is
 *     horizontally closest right now?") because a 2D Euclidean
 *     distance over-rewards opponents that happen to be vertically
 *     above you on a tall stage.
 *   • Threat scoring needs a 2D check: an opponent two pixels above
 *     you is more threatening than one two pixels horizontally away
 *     across a platform gap.
 *   • Zone-of-control reasoning ("am I in melee range?") cares about
 *     a categorical bucket — `'melee'` / `'tilt'` / `'spaced'` /
 *     `'far'` — not the raw number.
 *
 * Centralising these helpers here gives each consumer a clear API and
 * lets us test the boundary conditions (NaN guarding, zero distance,
 * tie-breaking) once instead of per call site.
 *
 * Pure functions only — no Phaser / Matter, no allocation beyond the
 * {@link DistanceMetrics} record returned by {@link computeDistance}.
 */

import type {
  PerceivedOpponent,
  PerceivedPoint,
  PerceivedSelf,
} from './WorldSnapshot';

// ---------------------------------------------------------------------------
// Zone classification — categorical engagement bucket
// ---------------------------------------------------------------------------

/**
 * Coarse "how close am I" bucket consumers use to decide which move
 * vocabulary applies.
 *
 *   • `'melee'`   — within jab / grab range. Punish window for the
 *                   shortest finishers.
 *   • `'tilt'`    — too far for jab, close enough for tilt / dash
 *                   attack. Closing-the-gap pressure applies.
 *   • `'spaced'`  — outside tilt range but within smash / projectile
 *                   range. Threat scoring still considers smashes.
 *   • `'far'`     — beyond all melee / smash threat. Approach phase.
 */
export type EngagementZone = 'melee' | 'tilt' | 'spaced' | 'far';

/**
 * Per-zone radius bands (in design pixels). All AI tiers share these
 * thresholds — they encode a *spatial* fact about the cast's move
 * reach, not a difficulty knob.
 *
 * Tuning rationale
 *   • `melee  <  64`  — characters' jab disjoints reach ~48-60 px;
 *                       64 leaves a one-pixel buffer for fuzz.
 *   • `tilt   < 128`  — ftilt / dash-attack reach ~96-112 px; 128
 *                       captures the spaced ftilt some characters
 *                       extend with a reposition.
 *   • `spaced < 256`  — smashes reach ~160-200 px charged; 256 is the
 *                       full-screen-aware "still in the threat band"
 *                       cap before projectiles take over.
 *   • `far`           — any distance >= 256.
 */
export const DEFAULT_ENGAGEMENT_RADII = Object.freeze({
  meleeMaxPx: 64,
  tiltMaxPx: 128,
  spacedMaxPx: 256,
}) satisfies Readonly<{
  meleeMaxPx: number;
  tiltMaxPx: number;
  spacedMaxPx: number;
}>;

/**
 * Per-call override of {@link DEFAULT_ENGAGEMENT_RADII} for tests or
 * stage-specific tuning (e.g. a tiny "Final Destination Jr." stage
 * may want shorter `melee` / `tilt` bands).
 *
 * Each field is optional — omitted bands fall back to the default.
 */
export interface EngagementRadii {
  readonly meleeMaxPx?: number;
  readonly tiltMaxPx?: number;
  readonly spacedMaxPx?: number;
}

// ---------------------------------------------------------------------------
// Distance metrics
// ---------------------------------------------------------------------------

/**
 * Distance metrics returned by {@link computeDistance}.
 *
 *   • `dx` / `dy`         — signed component deltas (target − origin).
 *                           `dx > 0` means the target is to the right;
 *                           `dy > 0` means it is below (Y grows down).
 *   • `horizontalAbs`     — `|dx|`; the most common 1D metric used by
 *                           target selection and grounded combos.
 *   • `verticalAbs`       — `|dy|`; used by vertical-axis decisions
 *                           like "should I jump up before pressing
 *                           up-tilt".
 *   • `chebyshev`         — `max(|dx|, |dy|)`; cheaper than euclidean
 *                           and a perfectly good "how close in either
 *                           axis" approximation for zone bucketing.
 *   • `euclideanSquared`  — `dx² + dy²`; supplied so consumers that
 *                           only need *ordering* (e.g. nearest opponent)
 *                           can sort without a sqrt. The euclidean
 *                           value itself is intentionally not provided
 *                           to discourage ad-hoc sqrt-in-a-hot-loop;
 *                           callers that genuinely need the magnitude
 *                           call `Math.sqrt(euclideanSquared)`
 *                           explicitly.
 */
export interface DistanceMetrics {
  readonly dx: number;
  readonly dy: number;
  readonly horizontalAbs: number;
  readonly verticalAbs: number;
  readonly chebyshev: number;
  readonly euclideanSquared: number;
}

/**
 * Compute the bundle of distance metrics from `from` to `to`.
 *
 * Pure function. Allocates exactly one object — the returned record.
 * Sign convention: `to.x - from.x` for `dx`, `to.y - from.y` for
 * `dy`. NaN / non-finite components flow through to the metrics
 * unchanged (callers needing a guarded distance should validate
 * inputs first).
 */
export function computeDistance(
  from: PerceivedPoint,
  to: PerceivedPoint,
): DistanceMetrics {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const horizontalAbs = Math.abs(dx);
  const verticalAbs = Math.abs(dy);
  const chebyshev =
    horizontalAbs >= verticalAbs ? horizontalAbs : verticalAbs;
  const euclideanSquared = dx * dx + dy * dy;
  return { dx, dy, horizontalAbs, verticalAbs, chebyshev, euclideanSquared };
}

/**
 * Convenience: signed horizontal distance from the bot's self position
 * to the opponent. Equivalent to `opponent.position.x - self.position.x`
 * — exists so consumers that only need this one number don't have to
 * spell out the property chain. Positive = opponent to the right of
 * the bot.
 */
export function horizontalDistance(
  self: PerceivedSelf,
  opponent: PerceivedOpponent,
): number {
  return opponent.position.x - self.position.x;
}

/**
 * Convenience: signed vertical distance from the bot to the opponent.
 * Positive = opponent is below (Y grows down).
 */
export function verticalDistance(
  self: PerceivedSelf,
  opponent: PerceivedOpponent,
): number {
  return opponent.position.y - self.position.y;
}

// ---------------------------------------------------------------------------
// Zone classification
// ---------------------------------------------------------------------------

/**
 * Classify the supplied chebyshev distance into an
 * {@link EngagementZone}.
 *
 * `chebyshev` was chosen as the input rather than euclidean because:
 *
 *   • It is monotone in either axis, so an opponent diagonally up-and-
 *     to-the-right gets the same bucket as one purely horizontally
 *     across at the same axis-projected distance.
 *   • It avoids a sqrt in a per-tick hot path.
 *
 * Negative or NaN distances clamp to `'far'` defensively — those
 * should never happen given a validated snapshot but the helper
 * tolerates them so a single misbehaving consumer can't crash the
 * whole tick.
 */
export function classifyEngagementZone(
  chebyshev: number,
  radii: EngagementRadii = {},
): EngagementZone {
  const meleeMax = radii.meleeMaxPx ?? DEFAULT_ENGAGEMENT_RADII.meleeMaxPx;
  const tiltMax = radii.tiltMaxPx ?? DEFAULT_ENGAGEMENT_RADII.tiltMaxPx;
  const spacedMax = radii.spacedMaxPx ?? DEFAULT_ENGAGEMENT_RADII.spacedMaxPx;

  if (!Number.isFinite(chebyshev) || chebyshev < 0) {
    return 'far';
  }
  if (chebyshev < meleeMax) return 'melee';
  if (chebyshev < tiltMax) return 'tilt';
  if (chebyshev < spacedMax) return 'spaced';
  return 'far';
}

/**
 * Convenience compose: compute the metrics from `self` to `opponent`
 * and classify them in one call. Returns both the zone and the
 * underlying metrics so a consumer can keep both without allocating
 * twice.
 */
export function evaluateEngagement(
  self: PerceivedSelf,
  opponent: PerceivedOpponent,
  radii: EngagementRadii = {},
): { readonly zone: EngagementZone; readonly metrics: DistanceMetrics } {
  const metrics = computeDistance(self.position, opponent.position);
  const zone = classifyEngagementZone(metrics.chebyshev, radii);
  return { zone, metrics };
}

// ---------------------------------------------------------------------------
// Approach prediction — does the opponent's velocity bring it closer?
// ---------------------------------------------------------------------------

/**
 * Pure helper: project both fighters `framesAhead` steps and report
 * whether the resulting horizontal distance is *smaller* than the
 * current one.
 *
 * Used by threat scoring to amplify the danger of an opponent who is
 * actively closing in (running at the bot, falling toward it, etc.)
 * relative to one whose velocity points away.
 *
 * Returns `0` when projection would not be meaningful (zero or non-
 * finite velocity components), so the threat layer can treat the
 * `delta` as "no change" without special-casing.
 */
export function projectClosingDelta(
  self: PerceivedSelf,
  opponent: PerceivedOpponent,
  framesAhead: number,
): number {
  if (
    !Number.isFinite(framesAhead) ||
    framesAhead <= 0 ||
    !Number.isFinite(self.velocity.vx) ||
    !Number.isFinite(opponent.velocity.vx)
  ) {
    return 0;
  }
  const currentHoriz = Math.abs(opponent.position.x - self.position.x);
  const projectedSelfX = self.position.x + self.velocity.vx * framesAhead;
  const projectedOppX = opponent.position.x + opponent.velocity.vx * framesAhead;
  const projectedHoriz = Math.abs(projectedOppX - projectedSelfX);
  // Positive = closing, negative = opening, zero = parallel.
  return currentHoriz - projectedHoriz;
}
