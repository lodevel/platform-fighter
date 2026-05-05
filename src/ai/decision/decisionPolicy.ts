/**
 * decisionPolicy — pure state-transition resolver for the decision FSM
 * (AC 20202 Sub-AC 2).
 *
 * Given the per-tick {@link DecisionContext} and a fully-resolved
 * options bag, {@link resolveDecisionState} returns the state the FSM
 * should be in *this tick*. The function is pure: identical inputs
 * always produce the identical state, with no `Math.random()` / wall-
 * clock / shared-mutable-state reads.
 *
 * The resolver evaluates the five state gates in priority order
 * (`recover` > `defend` > `retreat` > `attack` > `approach`) and
 * returns the first one whose gate fires. Each gate is a small,
 * named predicate exported individually so unit tests can exercise
 * them in isolation without instantiating the full context.
 *
 * The resolver carries no per-call hysteresis: each tick is decided
 * fresh from the context. Callers that want to filter rapid
 * thrashing between states can wrap the resolver with their own
 * smoothing layer — none is required at this layer because the gate
 * predicates are themselves stable across small perturbations
 * (engagement zones are quantised, off-stage is a binary, blast-zone
 * proximity uses a margin band).
 */

import {
  DEFAULT_ENGAGEMENT_RADII,
  classifyEngagementZone,
  computeDistance,
  type EngagementRadii,
  type EngagementZone,
} from '../perception/distanceEvaluation';
import type {
  PerceivedOpponent,
  PerceivedSelf,
  PerceivedStage,
} from '../perception/WorldSnapshot';

import type { DecisionContext, DecisionState } from './types';

// ---------------------------------------------------------------------------
// Tunable knobs
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link resolveDecisionState} (and the
 * higher-level {@link import('./DecisionFSM').DecisionFSM}). Every
 * field is optional — omitted fields fall back to documented defaults
 * tuned for a "competent baseline" bot.
 */
export interface DecisionPolicyOptions {
  /**
   * Damage % above which the `retreat` gate considers the bot fragile
   * enough to bias toward backing off. Default `100` — Smash's
   * traditional "danger zone" entry threshold. Below this percent the
   * `retreat` gate only fires when the bot is *also* close to a blast
   * wall.
   */
  readonly retreatDamageThreshold?: number;
  /**
   * Distance from the nearest blast wall (in design pixels) below
   * which the `retreat` gate fires regardless of damage % — the bot
   * is in immediate KO danger and must back off. Default `120` px.
   */
  readonly retreatBlastZoneMarginPx?: number;
  /**
   * Damage % at which the `attack` state's heuristic prefers smash
   * over jab / tilt — the canonical "they're at KO percent" cue.
   * Defaults to `90` (mirrors the offensive sub-tree's
   * {@link import('../offensive/comboRecognition').KO_PERCENT_THRESHOLD}).
   * Surfaces here so the policy resolver and the move-selection
   * heuristic agree on the threshold without an import cycle.
   */
  readonly koPercent?: number;
  /**
   * Margin (in design pixels) added to the bot's centre-of-mass when
   * computing off-stage status. The bot is considered off-stage when
   * `position.x < stageLeft - margin || position.x > stageRight +
   * margin`, AND the bot is airborne. Default `8` px — the half-width
   * of a typical character hurtbox; setting it higher delays the
   * recover-state transition so the bot tries to land back on the
   * platform rather than burn an up-special at the lip.
   */
  readonly offStageMarginPx?: number;
  /**
   * Engagement zone (or stricter) at which the `defend` gate considers
   * an opponent's incoming attack a confirmed threat. Default `'tilt'`
   * — the bot raises shield when an opponent is in tilt-or-melee reach
   * AND is in startup / active frames. Set to `'melee'` for a more
   * patient tier; set to `'spaced'` for a paranoid tier that shields
   * smashes from further out.
   */
  readonly defendEngagementZone?: Exclude<EngagementZone, 'far'>;
  /**
   * Per-zone engagement radii used by the resolver. Defaults to
   * {@link DEFAULT_ENGAGEMENT_RADII}.
   */
  readonly radii?: EngagementRadii;
}

/**
 * Fully-resolved options bag with defaults filled in. Returned by
 * {@link resolveDecisionPolicyOptions} so debug overlays / tests can
 * inspect the exact tunables in play.
 */
export interface ResolvedDecisionPolicyOptions {
  readonly retreatDamageThreshold: number;
  readonly retreatBlastZoneMarginPx: number;
  readonly koPercent: number;
  readonly offStageMarginPx: number;
  readonly defendEngagementZone: Exclude<EngagementZone, 'far'>;
  readonly radii: Required<EngagementRadii>;
}

/** Default policy options. Frozen so accidental mutation surfaces. */
export const DEFAULT_DECISION_POLICY_OPTIONS: ResolvedDecisionPolicyOptions =
  Object.freeze({
    retreatDamageThreshold: 100,
    retreatBlastZoneMarginPx: 120,
    koPercent: 90,
    offStageMarginPx: 8,
    defendEngagementZone: 'tilt',
    radii: Object.freeze({
      meleeMaxPx: DEFAULT_ENGAGEMENT_RADII.meleeMaxPx,
      tiltMaxPx: DEFAULT_ENGAGEMENT_RADII.tiltMaxPx,
      spacedMaxPx: DEFAULT_ENGAGEMENT_RADII.spacedMaxPx,
    }),
  });

/**
 * Apply documented defaults to a partial {@link DecisionPolicyOptions}.
 * Pure on its inputs — allocates a new record on every call and never
 * reads shared state, so tests can call it twice with the same input
 * and assert structural equality.
 */
export function resolveDecisionPolicyOptions(
  options: DecisionPolicyOptions = {},
): ResolvedDecisionPolicyOptions {
  const radii = options.radii ?? {};
  return {
    retreatDamageThreshold:
      options.retreatDamageThreshold ??
      DEFAULT_DECISION_POLICY_OPTIONS.retreatDamageThreshold,
    retreatBlastZoneMarginPx:
      options.retreatBlastZoneMarginPx ??
      DEFAULT_DECISION_POLICY_OPTIONS.retreatBlastZoneMarginPx,
    koPercent: options.koPercent ?? DEFAULT_DECISION_POLICY_OPTIONS.koPercent,
    offStageMarginPx:
      options.offStageMarginPx ??
      DEFAULT_DECISION_POLICY_OPTIONS.offStageMarginPx,
    defendEngagementZone:
      options.defendEngagementZone ??
      DEFAULT_DECISION_POLICY_OPTIONS.defendEngagementZone,
    radii: {
      meleeMaxPx:
        radii.meleeMaxPx ?? DEFAULT_DECISION_POLICY_OPTIONS.radii.meleeMaxPx,
      tiltMaxPx:
        radii.tiltMaxPx ?? DEFAULT_DECISION_POLICY_OPTIONS.radii.tiltMaxPx,
      spacedMaxPx:
        radii.spacedMaxPx ??
        DEFAULT_DECISION_POLICY_OPTIONS.radii.spacedMaxPx,
    },
  };
}

// ---------------------------------------------------------------------------
// Per-state gate predicates — exported for direct testing
// ---------------------------------------------------------------------------

/**
 * `recover` gate — the bot is off-stage and airborne (or in hitstun
 * being launched off-stage). Highest-priority gate: nothing else
 * matters when the bot is one bad tick from a KO.
 *
 * Off-stage detection layers two checks:
 *
 *   1. Horizontally outside the stage band (with `offStageMarginPx`
 *      tolerance), OR
 *   2. Vertically *below* the stage top — a bot that is between the
 *      stage walls but below the platform is in the under-stage void
 *      and must climb back.
 *
 * The bot must also be airborne (or in hitstun, which the controller
 * treats as airborne for recovery purposes); a bot standing on a
 * platform can't be off-stage by definition. `isOnLedge` short-
 * circuits to `false` — clinging to a ledge is the *result* of a
 * successful recovery, not a recovery situation itself.
 */
export function isRecoverGate(
  self: PerceivedSelf,
  stage: PerceivedStage,
  offStageMarginPx: number,
): boolean {
  if (self.isOnLedge) return false;
  const airborneOrLaunched = self.isAirborne || self.isInHitstun;
  if (!airborneOrLaunched) return false;

  const margin = Number.isFinite(offStageMarginPx) ? offStageMarginPx : 0;
  const beyondLeftEdge = self.position.x < stage.stageLeft - margin;
  const beyondRightEdge = self.position.x > stage.stageRight + margin;
  const belowStageTop = self.position.y > stage.stageTop;

  return beyondLeftEdge || beyondRightEdge || belowStageTop;
}

/**
 * `defend` gate — opponent is in startup / active frames of an attack
 * AND within the configured engagement zone. The bot raises a shield
 * (or burst-evades with a dodge) before the swing connects.
 *
 * The gate intentionally requires both:
 *
 *   • opponent state label === `'attacking'` (the perception layer's
 *     coarse "in startup or active frames" union), and
 *   • opponent within the configured zone (default `'tilt'` — tilt or
 *     closer)
 *
 * Returning `true` for an opponent attacking from far away would
 * cause the bot to shield phantom threats; the zone gate keeps the
 * defensive response calibrated to the actual hit risk.
 */
export function isDefendGate(
  self: PerceivedSelf,
  opponent: PerceivedOpponent | null,
  options: ResolvedDecisionPolicyOptions,
): boolean {
  if (opponent === null) return false;
  if (opponent.stateLabel !== 'attacking') return false;
  // An invincible opponent's swing still hurts; we don't filter on
  // `isInvincible` here. (Targeting layer deprioritises invincible
  // opponents, but defending from one is still correct.)

  const metrics = computeDistance(self.position, opponent.position);
  const zone = classifyEngagementZone(metrics.chebyshev, options.radii);
  return zoneAtLeastAsClose(zone, options.defendEngagementZone);
}

/**
 * `retreat` gate — bot is in survival pressure: high damage AND/OR
 * close to a blast wall. Two independent triggers:
 *
 *   1. **Blast-zone proximity** — bot is within
 *      `retreatBlastZoneMarginPx` of *any* blast wall. The bot may
 *      have low damage, but a single hit at this distance KOs; back
 *      off to the centre.
 *
 *   2. **High damage with KO opponent** — bot is at or above
 *      `retreatDamageThreshold` AND the opponent is in melee / tilt
 *      reach. Trading blows in this state is suicidal; back off and
 *      bait a whiff. (When the opponent is far away the bot doesn't
 *      need to actively retreat — staying put or approaching is fine
 *      because no immediate KO risk exists.)
 */
export function isRetreatGate(
  self: PerceivedSelf,
  opponent: PerceivedOpponent | null,
  stage: PerceivedStage,
  options: ResolvedDecisionPolicyOptions,
): boolean {
  // Blast-zone proximity check.
  const margin = options.retreatBlastZoneMarginPx;
  const bz = stage.blastZone;
  const distLeft = self.position.x - bz.left;
  const distRight = bz.right - self.position.x;
  const distTop = self.position.y - bz.top;
  const distBottom = bz.bottom - self.position.y;
  if (
    distLeft <= margin ||
    distRight <= margin ||
    distTop <= margin ||
    distBottom <= margin
  ) {
    return true;
  }

  // High-damage + opponent-in-range check.
  if (opponent === null) return false;
  if (self.damagePercent < options.retreatDamageThreshold) return false;

  const metrics = computeDistance(self.position, opponent.position);
  const zone = classifyEngagementZone(metrics.chebyshev, options.radii);
  return zone === 'melee' || zone === 'tilt';
}

/**
 * `attack` gate — opponent is in attack range and the bot is not
 * defending / retreating / recovering. The gate fires when the
 * opponent is within the bot's tilt-or-closer engagement zone; further
 * out the bot prefers to approach instead of throwing whiffs.
 *
 * Intentionally generous about opponent state: an opponent in
 * `recovering` / `hitstun` / `dodging` is still a valid attack target
 * (those are exactly the openings the bot wants to capitalise on).
 * The defend / retreat gates run first in the resolver so this gate
 * only fires when neither pre-emptive state applies.
 */
export function isAttackGate(
  self: PerceivedSelf,
  opponent: PerceivedOpponent | null,
  options: ResolvedDecisionPolicyOptions,
): boolean {
  if (opponent === null) return false;
  const metrics = computeDistance(self.position, opponent.position);
  const zone = classifyEngagementZone(metrics.chebyshev, options.radii);
  return zone === 'melee' || zone === 'tilt';
}

// ---------------------------------------------------------------------------
// Public resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the strategic state for the supplied decision context.
 *
 * Evaluates the gates in priority order (`recover` > `defend` >
 * `retreat` > `attack` > `approach`) and returns the first matching
 * state. Falls through to `approach` when no gate fires — a healthy
 * bot at neutral with the opponent out of attack range walks toward
 * the opponent.
 *
 * Pure function. The same `(ctx, options)` always produces the same
 * state.
 *
 * @param ctx     Per-tick decision context.
 * @param options Either a partial {@link DecisionPolicyOptions} bag or
 *                a fully resolved {@link ResolvedDecisionPolicyOptions}.
 *                When omitted the {@link DEFAULT_DECISION_POLICY_OPTIONS}
 *                are used.
 */
export function resolveDecisionState(
  ctx: DecisionContext,
  options:
    | DecisionPolicyOptions
    | ResolvedDecisionPolicyOptions = DEFAULT_DECISION_POLICY_OPTIONS,
): DecisionState {
  const resolved = isResolvedPolicyOptions(options)
    ? options
    : resolveDecisionPolicyOptions(options);

  if (isRecoverGate(ctx.self, ctx.stage, resolved.offStageMarginPx)) {
    return 'recover';
  }
  if (isDefendGate(ctx.self, ctx.opponent, resolved)) {
    return 'defend';
  }
  if (isRetreatGate(ctx.self, ctx.opponent, ctx.stage, resolved)) {
    return 'retreat';
  }
  if (isAttackGate(ctx.self, ctx.opponent, resolved)) {
    return 'attack';
  }
  return 'approach';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Order maps so we can compare two zones by closeness. */
const ZONE_ORDER: Record<EngagementZone, number> = {
  melee: 0,
  tilt: 1,
  spaced: 2,
  far: 3,
};

/**
 * Returns true iff `actual` is at least as close as `threshold`.
 * `melee` is closer than `tilt` is closer than `spaced` is closer
 * than `far`.
 */
function zoneAtLeastAsClose(
  actual: EngagementZone,
  threshold: EngagementZone,
): boolean {
  return ZONE_ORDER[actual] <= ZONE_ORDER[threshold];
}

/**
 * Discriminator: a resolved options bag has every field present.
 * Used by {@link resolveDecisionState} to skip the resolution pass
 * when the caller already supplied a resolved bag (the FSM caches
 * one and re-uses it across ticks).
 */
function isResolvedPolicyOptions(
  options: DecisionPolicyOptions | ResolvedDecisionPolicyOptions,
): options is ResolvedDecisionPolicyOptions {
  return (
    typeof (options as ResolvedDecisionPolicyOptions).retreatDamageThreshold ===
      'number' &&
    typeof (options as ResolvedDecisionPolicyOptions)
      .retreatBlastZoneMarginPx === 'number' &&
    typeof (options as ResolvedDecisionPolicyOptions).koPercent === 'number' &&
    typeof (options as ResolvedDecisionPolicyOptions).offStageMarginPx ===
      'number' &&
    typeof (options as ResolvedDecisionPolicyOptions).defendEngagementZone ===
      'string' &&
    typeof (options as ResolvedDecisionPolicyOptions).radii === 'object' &&
    options.radii !== null &&
    typeof (options as ResolvedDecisionPolicyOptions).radii.meleeMaxPx ===
      'number' &&
    typeof (options as ResolvedDecisionPolicyOptions).radii.tiltMaxPx ===
      'number' &&
    typeof (options as ResolvedDecisionPolicyOptions).radii.spacedMaxPx ===
      'number'
  );
}
