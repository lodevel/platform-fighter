/**
 * Target selection — pick which opponent the bot should focus on this
 * tick (AC 10202 Sub-AC 2).
 *
 * Why this module exists
 * ----------------------
 *
 * In a 4-player free-for-all the AI must pick *one* opponent to
 * commit to per tick — the offensive sub-tree's
 * {@link OpponentSnapshot} only carries one fighter, and committing
 * to a target is the prerequisite for distance-conditioned decisions
 * (close in / shield / wave-dash back). Switching targets every
 * frame produces visibly schizophrenic bots, so the core also
 * exposes a *sticky* policy that biases toward the previously-
 * selected target unless a new opponent is dramatically more
 * appealing.
 *
 * Three policies ship in this module:
 *
 *   • `'nearest'`        — purely positional, ignores threat. Useful
 *                          for low-tier bots that play pure mash
 *                          ("attack the closest body").
 *   • `'threatWeighted'` — sums threat + appeal, picks the highest
 *                          score. Used by Hard tier and as the
 *                          default for Medium.
 *   • `'lowestPercent'`  — picks the opponent with the lowest %; used
 *                          by team-mode policies that prioritise
 *                          shielding the highest-damage ally (not in
 *                          the v1 cut, but the policy slot is
 *                          reserved so Sub-AC 3+ can plug in without
 *                          breaking the API).
 *
 * Pure functions only — no Phaser / Matter, no Math.random. Sticky
 * policies take the previous target as a parameter (the controller
 * stashes the previous selection on the AI provider's blackboard and
 * threads it back in next tick).
 */

import type { PlayerSlotIndex } from '../../input/InputProvider';
import type { PerceivedOpponent, WorldSnapshot } from './WorldSnapshot';
import {
  computeDistance,
  type DistanceMetrics,
} from './distanceEvaluation';
import {
  evaluateThreat,
  type ThreatScore,
  type ThreatShape,
  type ThreatWeights,
} from './threatEvaluation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Tier-agnostic policy identifier. */
export type TargetSelectionPolicy =
  | 'nearest'
  | 'threatWeighted'
  | 'lowestPercent';

/**
 * Result of {@link selectTarget}.
 *
 *   • `slotIndex`    — chosen opponent's slot, or `null` when no
 *                      opponent is alive on the field.
 *   • `opponent`     — the chosen {@link PerceivedOpponent}, or
 *                      `null`. Returned alongside `slotIndex` so
 *                      consumers don't have to look it up again.
 *   • `score`        — the policy-specific score that won. For
 *                      `'nearest'` this is the (negated) chebyshev
 *                      distance — bigger is better; for the threat-
 *                      weighted policy it is the {@link ThreatScore}
 *                      total + appeal modifier.
 *   • `reason`       — human-readable label for debug overlays /
 *                      tests. Examples: `'closest'`,
 *                      `'highestThreat'`, `'stickToPrev'`.
 *   • `metrics`      — distance metrics from the bot to the chosen
 *                      target, for callers that want to skip a
 *                      re-compute downstream.
 *   • `threat`       — full threat score for the chosen target, when
 *                      the policy computed one. `null` for purely
 *                      positional policies.
 */
export interface TargetSelection {
  readonly slotIndex: PlayerSlotIndex | null;
  readonly opponent: PerceivedOpponent | null;
  readonly score: number;
  readonly reason: TargetSelectionReason;
  readonly metrics: DistanceMetrics | null;
  readonly threat: ThreatScore | null;
}

/**
 * Closed-set reason labels — exhaustive so a switch over them stays
 * type-checked.
 */
export type TargetSelectionReason =
  | 'noOpponents'
  | 'singleOpponent'
  | 'closest'
  | 'highestThreat'
  | 'lowestPercent'
  | 'stickToPrev';

/**
 * Optional sticky policy parameters.
 *
 *   • `previousSlotIndex` — slot the bot targeted last tick. The
 *                           selection prefers it unless another
 *                           opponent's score exceeds it by at least
 *                           `switchMargin`.
 *   • `switchMargin`      — minimum *score* delta required to switch
 *                           targets. Default `0.1` (i.e. ~10% of the
 *                           threat-weighted scale). Set to `0` to
 *                           disable stickiness.
 */
export interface StickyPolicyOptions {
  readonly previousSlotIndex?: PlayerSlotIndex | null;
  readonly switchMargin?: number;
}

/**
 * Options bag for {@link selectTarget}.
 *
 *   • `policy`          — selection policy, defaults to
 *                         `'threatWeighted'`.
 *   • `sticky`          — optional bias toward last frame's target.
 *   • `appealWeight`    — for the threat-weighted policy: how much
 *                         the opponent's *appeal* (high % + low
 *                         stocks) is added to the threat score.
 *                         Default `0.25`.
 *   • `weights` / `shape` — forwarded to {@link evaluateThreat}.
 */
export interface SelectTargetOptions {
  readonly policy?: TargetSelectionPolicy;
  readonly sticky?: StickyPolicyOptions;
  readonly appealWeight?: number;
  readonly weights?: ThreatWeights;
  readonly shape?: ThreatShape;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Appeal of a target — how *valuable* killing them is, independent of
 * their threat. Pure positional / damage function:
 *
 *   • Damage % normalised by `200` (a 200% opponent is at theoretical
 *     max appeal; in practice 130-150% is already KO range).
 *   • Last-stock bonus: `+0.25` if `stocksRemaining === 1` so the bot
 *     prefers to seal a stock over chipping at someone with two left.
 *
 * Returns a `[0, 1]` score.
 */
function appealScore(opponent: PerceivedOpponent): number {
  const damageNorm = clamp01(opponent.damagePercent / 200);
  const stockBonus = opponent.stocksRemaining === 1 ? 0.25 : 0;
  return clamp01(damageNorm * 0.75 + stockBonus);
}

/**
 * Tie-break helper: lower slot index wins. Used to keep selection
 * deterministic across replays even when two opponents score
 * identically.
 */
function deterministicTieBreak(
  a: PerceivedOpponent,
  b: PerceivedOpponent,
): PerceivedOpponent {
  return a.slotIndex <= b.slotIndex ? a : b;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

// ---------------------------------------------------------------------------
// Empty / single-opponent fast paths
// ---------------------------------------------------------------------------

const EMPTY_SELECTION: TargetSelection = Object.freeze({
  slotIndex: null,
  opponent: null,
  score: 0,
  reason: 'noOpponents',
  metrics: null,
  threat: null,
}) satisfies TargetSelection;

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

/**
 * Pick the opponent the bot should focus on this tick.
 *
 * Empty-list fast path returns an `EMPTY_SELECTION` (everything
 * `null`). Single-opponent fast path returns that opponent
 * unconditionally with reason `'singleOpponent'` — the policy is
 * irrelevant when there is only one valid target and we want to
 * skip the threat computation.
 *
 * Sticky bias is applied *after* the policy picks its candidate:
 *
 *   1. Compute the candidate score by policy.
 *   2. If `sticky.previousSlotIndex` matches a still-alive opponent
 *      AND the candidate's score does not exceed the previous
 *      target's score by at least `switchMargin`, retain the previous
 *      target with reason `'stickToPrev'`.
 *
 * This ordering keeps the bot decisive at the start of a match (no
 * previous target → policy decides freely) while preventing target
 * thrashing later.
 */
export function selectTarget(
  snapshot: WorldSnapshot,
  options: SelectTargetOptions = {},
): TargetSelection {
  const { opponents, self, stage } = snapshot;

  if (opponents.length === 0) {
    return EMPTY_SELECTION;
  }
  if (opponents.length === 1) {
    const only = opponents[0]!;
    const metrics = computeDistance(self.position, only.position);
    return {
      slotIndex: only.slotIndex,
      opponent: only,
      score: 0,
      reason: 'singleOpponent',
      metrics,
      threat: null,
    };
  }

  const policy: TargetSelectionPolicy = options.policy ?? 'threatWeighted';

  let candidate: TargetSelection;
  switch (policy) {
    case 'nearest':
      candidate = pickNearest(snapshot);
      break;
    case 'lowestPercent':
      candidate = pickLowestPercent(snapshot);
      break;
    case 'threatWeighted':
    default:
      candidate = pickThreatWeighted(snapshot, options);
      break;
  }

  // Sticky bias.
  if (options.sticky?.previousSlotIndex != null) {
    const prevSlot = options.sticky.previousSlotIndex;
    const margin = options.sticky.switchMargin ?? 0.1;
    if (prevSlot !== candidate.slotIndex) {
      const prevOpp = opponents.find((o) => o.slotIndex === prevSlot) ?? null;
      if (prevOpp !== null) {
        const prevScore = scoreFor(snapshot, prevOpp, policy, options);
        if (candidate.score - prevScore < margin) {
          // Retain the previous target.
          const metrics = computeDistance(self.position, prevOpp.position);
          const threat =
            policy === 'threatWeighted'
              ? evaluateThreat(self, prevOpp, stage, {
                  weights: options.weights,
                  shape: options.shape,
                })
              : null;
          return {
            slotIndex: prevOpp.slotIndex,
            opponent: prevOpp,
            score: prevScore,
            reason: 'stickToPrev',
            metrics,
            threat,
          };
        }
      }
    }
  }

  return candidate;
}

// ---------------------------------------------------------------------------
// Per-policy implementations
// ---------------------------------------------------------------------------

function pickNearest(snapshot: WorldSnapshot): TargetSelection {
  const { opponents, self } = snapshot;
  let best: PerceivedOpponent | null = null;
  let bestMetrics: DistanceMetrics | null = null;
  let bestSquared = Number.POSITIVE_INFINITY;

  for (const opp of opponents) {
    const m = computeDistance(self.position, opp.position);
    if (
      m.euclideanSquared < bestSquared ||
      (m.euclideanSquared === bestSquared &&
        best !== null &&
        deterministicTieBreak(best, opp) === opp)
    ) {
      best = opp;
      bestMetrics = m;
      bestSquared = m.euclideanSquared;
    }
  }

  // `best` cannot be null at this point because the caller short-
  // circuits on opponents.length === 0.
  return {
    slotIndex: best!.slotIndex,
    opponent: best!,
    score: -Math.sqrt(bestSquared),
    reason: 'closest',
    metrics: bestMetrics,
    threat: null,
  };
}

function pickLowestPercent(snapshot: WorldSnapshot): TargetSelection {
  const { opponents, self } = snapshot;
  let best: PerceivedOpponent | null = null;
  let bestPercent = Number.POSITIVE_INFINITY;
  for (const opp of opponents) {
    if (
      opp.damagePercent < bestPercent ||
      (opp.damagePercent === bestPercent &&
        best !== null &&
        deterministicTieBreak(best, opp) === opp)
    ) {
      best = opp;
      bestPercent = opp.damagePercent;
    }
  }
  const metrics = computeDistance(self.position, best!.position);
  return {
    slotIndex: best!.slotIndex,
    opponent: best!,
    score: -bestPercent,
    reason: 'lowestPercent',
    metrics,
    threat: null,
  };
}

function pickThreatWeighted(
  snapshot: WorldSnapshot,
  options: SelectTargetOptions,
): TargetSelection {
  const { opponents, self, stage } = snapshot;
  const appealWeight = options.appealWeight ?? 0.25;

  let best: PerceivedOpponent | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestThreat: ThreatScore | null = null;
  let bestMetrics: DistanceMetrics | null = null;

  for (const opp of opponents) {
    const threat = evaluateThreat(self, opp, stage, {
      weights: options.weights,
      shape: options.shape,
    });
    const appeal = appealScore(opp);
    const score = threat.total + appealWeight * appeal;
    if (
      score > bestScore ||
      (score === bestScore &&
        best !== null &&
        deterministicTieBreak(best, opp) === opp)
    ) {
      best = opp;
      bestScore = score;
      bestThreat = threat;
      bestMetrics = threat.metrics;
    }
  }

  return {
    slotIndex: best!.slotIndex,
    opponent: best!,
    score: bestScore,
    reason: 'highestThreat',
    metrics: bestMetrics,
    threat: bestThreat,
  };
}

/**
 * Compute the score *that the policy would have produced* for a
 * specific opponent. Used by the sticky-bias path to compare the
 * candidate against the previous target without re-running the full
 * loop.
 */
function scoreFor(
  snapshot: WorldSnapshot,
  opp: PerceivedOpponent,
  policy: TargetSelectionPolicy,
  options: SelectTargetOptions,
): number {
  const { self, stage } = snapshot;
  switch (policy) {
    case 'nearest': {
      const m = computeDistance(self.position, opp.position);
      return -Math.sqrt(m.euclideanSquared);
    }
    case 'lowestPercent':
      return -opp.damagePercent;
    case 'threatWeighted':
    default: {
      const threat = evaluateThreat(self, opp, stage, {
        weights: options.weights,
        shape: options.shape,
      });
      const appeal = appealScore(opp);
      return threat.total + (options.appealWeight ?? 0.25) * appeal;
    }
  }
}
