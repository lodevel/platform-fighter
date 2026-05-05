/**
 * Threat evaluation — score how dangerous an opponent is right now
 * (AC 10202 Sub-AC 2).
 *
 * Why this module exists
 * ----------------------
 *
 * Both target selection and the upper layers of the behavior tree
 * (e.g. "should I shield instead of attack") want a single number
 * that captures *how much should I worry about this opponent right
 * now*. That number is a weighted sum of several axes:
 *
 *   1. Proximity              — close opponents threaten more.
 *   2. Approach velocity      — an opponent closing in this tick
 *                                is more dangerous than one walking
 *                                away.
 *   3. Active aggression      — an opponent in `'attacking'` state
 *                                with a startup frame matters more
 *                                than one in `'recovering'`.
 *   4. KO potential           — an opponent at high damage % is also
 *                                a high-value *target* (so there's a
 *                                positive correlation between threat
 *                                and target appeal); but the bot's
 *                                own damage % is what makes the
 *                                opponent's smashes lethal.
 *   5. Off-stage handicap     — an opponent off-stage is less
 *                                threatening because they have to
 *                                recover before they can attack.
 *   6. Invincibility damper   — an opponent with respawn / dodge
 *                                i-frames cannot land hits this tick
 *                                so the immediate threat is zero,
 *                                but their *positional* threat (they
 *                                will become threatening soon) keeps
 *                                a residual.
 *
 * The output is a `ThreatScore` in `[0, 1]` along with its
 * contributing components so a debug overlay or a higher-level
 * decision (e.g. "tier-up to defensive sub-tree if total > 0.8")
 * can introspect why a particular score landed where it did.
 *
 * Pure functions only — no Phaser / Matter, no Math.random.
 */

import type {
  PerceivedOpponent,
  PerceivedSelf,
  PerceivedStage,
} from './WorldSnapshot';
import {
  computeDistance,
  projectClosingDelta,
  type DistanceMetrics,
} from './distanceEvaluation';

// ---------------------------------------------------------------------------
// Tunable weights — exposed so tests can perturb individual axes
// ---------------------------------------------------------------------------

/**
 * Weighted contribution of each threat axis to the total. The weights
 * sum to `1.0` so the resulting threat score is itself bounded in
 * `[0, 1]`. Frozen so consumers can pass directly into
 * {@link evaluateThreat} without defensive copying.
 *
 * Tuning rationale
 *   • Proximity is the dominant axis — a close, idle opponent still
 *     threatens more than a far, attacking one.
 *   • Aggression is the second-largest axis — an attacking opponent
 *     within range is the canonical "panic now" trigger.
 *   • Approach, KO, and stage-position weights are comparable third-
 *     tier modifiers.
 *   • Self-vulnerability scales the threat *up* when the bot is at
 *     high damage % (their finisher will actually kill).
 */
export const DEFAULT_THREAT_WEIGHTS = Object.freeze({
  proximityWeight: 0.35,
  aggressionWeight: 0.25,
  approachWeight: 0.15,
  koPotentialWeight: 0.1,
  stagePositionWeight: 0.1,
  selfVulnerabilityWeight: 0.05,
}) satisfies Readonly<ThreatWeights>;

/**
 * Per-call override of {@link DEFAULT_THREAT_WEIGHTS}. Consumers can
 * tweak individual axes (e.g. boost `aggressionWeight` for a
 * defensive-leaning Hard tier). Weights are *not* renormalised — if
 * you change them, ensure the sum stays in `[0, 1]` or the resulting
 * score may exceed the documented range.
 */
export interface ThreatWeights {
  readonly proximityWeight: number;
  readonly aggressionWeight: number;
  readonly approachWeight: number;
  readonly koPotentialWeight: number;
  readonly stagePositionWeight: number;
  readonly selfVulnerabilityWeight: number;
}

// ---------------------------------------------------------------------------
// Tunable shape parameters — distance / damage rolloffs
// ---------------------------------------------------------------------------

/**
 * Parameters that shape the contribution curves.
 *
 *   • `proximityFalloffPx`     — distance at which proximity drops to
 *                                roughly half. Default `192` ≈ smash
 *                                range, so an opponent at smash range
 *                                contributes a moderate proximity
 *                                threat and one in melee contributes
 *                                near-maximum.
 *   • `proximityCutoffPx`      — distance at which proximity bottoms
 *                                to `0`. Beyond this, proximity adds
 *                                nothing. Default `512` ≈ two screen
 *                                widths from the bot.
 *   • `approachLookaheadFrames`— frames to project for the approach
 *                                axis. Default `30` (half a second
 *                                at 60Hz) — long enough to detect a
 *                                dash-in, short enough to ignore
 *                                idle drift.
 *   • `approachSaturationPx`   — closing delta at which the approach
 *                                axis saturates at `1`. Default `64`
 *                                ≈ one melee-zone radius.
 *   • `koDamageThresholdPercent` — damage % above which the bot is
 *                                considered "in KO range" of the
 *                                opponent's smashes. Default `90`.
 *   • `blastZoneSafePx`        — distance to the nearest blast wall
 *                                below which the bot is considered
 *                                in danger from any incoming hit.
 *                                Default `128`.
 */
export interface ThreatShape {
  readonly proximityFalloffPx?: number;
  readonly proximityCutoffPx?: number;
  readonly approachLookaheadFrames?: number;
  readonly approachSaturationPx?: number;
  readonly koDamageThresholdPercent?: number;
  readonly blastZoneSafePx?: number;
}

const DEFAULT_THREAT_SHAPE: Required<ThreatShape> = Object.freeze({
  proximityFalloffPx: 192,
  proximityCutoffPx: 512,
  approachLookaheadFrames: 30,
  approachSaturationPx: 64,
  koDamageThresholdPercent: 90,
  blastZoneSafePx: 128,
});

// ---------------------------------------------------------------------------
// ThreatScore — the result type
// ---------------------------------------------------------------------------

/**
 * Result of {@link evaluateThreat}. Every component is in `[0, 1]`,
 * weighted contributions sum to `total` (`[0, 1]` if weights are well-
 * formed). Components are surfaced individually so debug overlays /
 * unit tests can assert specific axes without re-computing them.
 *
 *   • `proximity`        — closer = more threatening.
 *   • `aggression`       — higher when opponent is in `'attacking'`
 *                          state, damped by `'recovering'` /
 *                          `'hitstun'` / `'shielding'`.
 *   • `approach`         — higher when opponent is closing distance.
 *                          Zero when stationary or moving away.
 *   • `koPotential`      — higher when bot is at KO damage %, since
 *                          opponent's smashes will actually kill.
 *   • `stagePosition`    — higher when opponent is on stage (can press
 *                          the offence) and bot is near a blast wall.
 *                          Damped when opponent is off-stage (must
 *                          recover before threatening).
 *   • `selfVulnerability`— higher when bot is in hitstun / airborne
 *                          / on-ledge — states where the opponent
 *                          can punish freely.
 *   • `total`            — weighted sum, clamped to `[0, 1]`.
 *   • `metrics`          — the underlying {@link DistanceMetrics} so
 *                          callers don't have to recompute them
 *                          downstream.
 */
export interface ThreatScore {
  readonly proximity: number;
  readonly aggression: number;
  readonly approach: number;
  readonly koPotential: number;
  readonly stagePosition: number;
  readonly selfVulnerability: number;
  readonly total: number;
  readonly metrics: DistanceMetrics;
}

// ---------------------------------------------------------------------------
// Per-axis helpers — exposed for fine-grained testing
// ---------------------------------------------------------------------------

/**
 * Proximity sub-score. `1.0` at zero distance, decaying to `0` at
 * `proximityCutoffPx`. Uses a smooth piecewise-linear ramp through
 * `proximityFalloffPx` so the score remains visually continuous
 * across the cast's smash-radius boundary.
 *
 *   • `0..falloff`        — score linearly drops from `1.0` to `0.5`.
 *   • `falloff..cutoff`   — score linearly drops from `0.5` to `0.0`.
 *   • `>= cutoff`         — score is `0`.
 */
export function proximityScore(
  chebyshev: number,
  shape: ThreatShape = {},
): number {
  const falloff = shape.proximityFalloffPx ?? DEFAULT_THREAT_SHAPE.proximityFalloffPx;
  const cutoff = shape.proximityCutoffPx ?? DEFAULT_THREAT_SHAPE.proximityCutoffPx;
  if (!Number.isFinite(chebyshev) || chebyshev <= 0) return 1;
  if (chebyshev >= cutoff) return 0;
  if (chebyshev <= falloff) {
    return 1 - 0.5 * (chebyshev / falloff);
  }
  // Between falloff and cutoff.
  const t = (chebyshev - falloff) / (cutoff - falloff);
  return 0.5 * (1 - t);
}

/**
 * Aggression sub-score derived from the opponent's coarse state
 * label.
 *
 *   • `'attacking'`   → `1.0` — startup or active frames mean an
 *                       imminent hitbox.
 *   • `'recovering'`  → `0.15` — opponent is committed to a whiff
 *                       and is briefly safe to approach.
 *   • `'hitstun'`     → `0.0`  — opponent is being combo'd; no
 *                       offence imminent.
 *   • `'shielding'`   → `0.4`  — held shield is a counter threat
 *                       (out-of-shield smash) but no hitbox is live.
 *   • `'dodging'`     → `0.6`  — the bot can punish dodge end-lag,
 *                       but a frame-perfect roll-attack is real.
 *   • `'ledgeHang'`   → `0.2`  — getup options exist but require
 *                       a press first.
 *   • `'airborne'`    → `0.5`  — moderate baseline; aerial attack
 *                       can be initiated at any time.
 *   • `'idle'`        → `0.5`  — standing in neutral; a smash can
 *                       come out the next frame.
 */
export function aggressionScore(opponent: PerceivedOpponent): number {
  switch (opponent.stateLabel) {
    case 'attacking':
      return 1;
    case 'shielding':
      return 0.4;
    case 'dodging':
      return 0.6;
    case 'recovering':
      return 0.15;
    case 'hitstun':
      return 0;
    case 'ledgeHang':
      return 0.2;
    case 'airborne':
      return 0.5;
    case 'idle':
    default:
      return 0.5;
  }
}

/**
 * Approach sub-score: `1.0` when the opponent is closing in fast,
 * `0.0` when stationary or moving away.
 */
export function approachScore(
  self: PerceivedSelf,
  opponent: PerceivedOpponent,
  shape: ThreatShape = {},
): number {
  const lookahead =
    shape.approachLookaheadFrames ?? DEFAULT_THREAT_SHAPE.approachLookaheadFrames;
  const sat = shape.approachSaturationPx ?? DEFAULT_THREAT_SHAPE.approachSaturationPx;
  const closingDelta = projectClosingDelta(self, opponent, lookahead);
  if (closingDelta <= 0) return 0;
  if (closingDelta >= sat) return 1;
  return closingDelta / sat;
}

/**
 * KO-potential sub-score: how lethal a clean smash would be right
 * now. Mostly a function of the *bot's* own damage % (the opponent's
 * % matters for KO appeal, not threat) but caps at `1` so the
 * weight stays bounded.
 */
export function koPotentialScore(
  self: PerceivedSelf,
  shape: ThreatShape = {},
): number {
  const threshold =
    shape.koDamageThresholdPercent ?? DEFAULT_THREAT_SHAPE.koDamageThresholdPercent;
  if (!Number.isFinite(self.damagePercent) || self.damagePercent <= 0) return 0;
  if (self.damagePercent >= threshold) return 1;
  return self.damagePercent / threshold;
}

/**
 * Stage-position sub-score combining two effects:
 *
 *   • `+0.5` baseline when the opponent is on stage (between
 *     `stageLeft` and `stageRight`); `0` otherwise.
 *   • `+0.5` when the bot itself is within `blastZoneSafePx` of a
 *     blast wall — being cornered amplifies any hit's lethality.
 *
 * Capped at `1.0`.
 */
export function stagePositionScore(
  self: PerceivedSelf,
  opponent: PerceivedOpponent,
  stage: PerceivedStage,
  shape: ThreatShape = {},
): number {
  let score = 0;
  const oppOnStage =
    opponent.position.x >= stage.stageLeft &&
    opponent.position.x <= stage.stageRight &&
    opponent.position.y <= stage.stageTop + 1;
  if (oppOnStage) {
    score += 0.5;
  }
  const safePx = shape.blastZoneSafePx ?? DEFAULT_THREAT_SHAPE.blastZoneSafePx;
  const bz = stage.blastZone;
  const distLeft = self.position.x - bz.left;
  const distRight = bz.right - self.position.x;
  const distTop = self.position.y - bz.top;
  const distBottom = bz.bottom - self.position.y;
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);
  if (Number.isFinite(minDist) && minDist >= 0 && minDist < safePx) {
    score += 0.5 * (1 - minDist / safePx);
  }
  if (score > 1) return 1;
  if (score < 0) return 0;
  return score;
}

/**
 * Self-vulnerability sub-score: states the bot is in that make any
 * hit worse.
 *
 *   • `isInHitstun`  → `+1.0` (instantly maxed; cannot defend).
 *   • `isOnLedge`    → `+0.5` (limited getup options).
 *   • `isAirborne`   → `+0.25` (no shield, fewer escape options).
 *
 * Capped at `1.0`.
 */
export function selfVulnerabilityScore(self: PerceivedSelf): number {
  let score = 0;
  if (self.isInHitstun) score += 1;
  if (self.isOnLedge) score += 0.5;
  if (self.isAirborne) score += 0.25;
  if (score > 1) return 1;
  return score;
}

// ---------------------------------------------------------------------------
// Top-level evaluator
// ---------------------------------------------------------------------------

/**
 * Compute the full threat score for an opponent against the bot.
 *
 * Invincibility short-circuit: if the opponent is `isInvincible`,
 * proximity / aggression / approach axes are damped to a residual
 * (their hits won't connect this frame) but the stage-position and
 * self-vulnerability axes still contribute because the bot's
 * cornered-or-not state outlives the i-frame window.
 *
 * Returns the score components plus the `total`. `total` is a
 * weighted sum of the per-axis components, clamped to `[0, 1]`.
 *
 * Pure function; no allocation beyond the returned record and the
 * underlying metrics.
 */
export function evaluateThreat(
  self: PerceivedSelf,
  opponent: PerceivedOpponent,
  stage: PerceivedStage,
  options: {
    readonly weights?: ThreatWeights;
    readonly shape?: ThreatShape;
  } = {},
): ThreatScore {
  const weights = options.weights ?? DEFAULT_THREAT_WEIGHTS;
  const shape = options.shape ?? {};

  const metrics = computeDistance(self.position, opponent.position);

  let proximity = proximityScore(metrics.chebyshev, shape);
  let aggression = aggressionScore(opponent);
  let approach = approachScore(self, opponent, shape);
  const koPotential = koPotentialScore(self, shape);
  const stagePosition = stagePositionScore(self, opponent, stage, shape);
  const selfVulnerability = selfVulnerabilityScore(self);

  // Invincibility damper — i-framed opponent can't land hits.
  if (opponent.isInvincible) {
    proximity *= 0.25;
    aggression *= 0.0;
    approach *= 0.25;
  }

  const totalRaw =
    weights.proximityWeight * proximity +
    weights.aggressionWeight * aggression +
    weights.approachWeight * approach +
    weights.koPotentialWeight * koPotential +
    weights.stagePositionWeight * stagePosition +
    weights.selfVulnerabilityWeight * selfVulnerability;

  const total = clamp01(totalRaw);

  return {
    proximity,
    aggression,
    approach,
    koPotential,
    stagePosition,
    selfVulnerability,
    total,
    metrics,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
