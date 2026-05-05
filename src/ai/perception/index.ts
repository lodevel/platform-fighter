/**
 * AI perception module — public re-exports.
 *
 * Houses two layers of the AI pipeline:
 *
 *   1. The reaction-window model that gates how quickly an AI bot can
 *      respond to player events. See {@link ReactionWindow} for the
 *      full design and {@link REACTION_WINDOW_PRESETS} for the per-
 *      difficulty latency bands (Hard = 15-20 frames per the M2 AC).
 *
 *   2. The tier-agnostic perception + decision-making core (AC 10202
 *      Sub-AC 2) — {@link WorldSnapshot} carries the unified per-tick
 *      world view; {@link evaluateThreat} scores how dangerous each
 *      opponent is right now; {@link selectTarget} picks the
 *      opponent every difficulty tier should focus on this tick.
 *
 * Both layers are pure-data / pure-function modules — no Phaser /
 * Matter imports, deterministic, replay-snapshot-friendly.
 */

// Reaction-window model
export { ReactionWindow } from './ReactionWindow';
export type {
  ReactionWindowEntry,
  ReactionWindowOptions,
  ReactionWindowRange,
  ReactionWindowSnapshot,
} from './ReactionWindow';

export {
  REACTION_WINDOW_PRESETS,
  getReactionWindowRange,
} from './reactionWindowPresets';
export type { AiDifficulty } from './reactionWindowPresets';

// World snapshot — unified per-tick perception record
export {
  buildWorldSnapshot,
  findOpponentBySlot,
  projectOpponentSnapshot,
} from './WorldSnapshot';
export type {
  PerceivedMovePhase,
  PerceivedMoveState,
  PerceivedOpponent,
  PerceivedOpponentStateLabel,
  PerceivedPoint,
  PerceivedSelf,
  PerceivedStage,
  PerceivedVelocity,
  WorldSnapshot,
} from './WorldSnapshot';

// Distance evaluation
export {
  classifyEngagementZone,
  computeDistance,
  DEFAULT_ENGAGEMENT_RADII,
  evaluateEngagement,
  horizontalDistance,
  projectClosingDelta,
  verticalDistance,
} from './distanceEvaluation';
export type {
  DistanceMetrics,
  EngagementRadii,
  EngagementZone,
} from './distanceEvaluation';

// Threat evaluation
export {
  aggressionScore,
  approachScore,
  DEFAULT_THREAT_WEIGHTS,
  evaluateThreat,
  koPotentialScore,
  proximityScore,
  selfVulnerabilityScore,
  stagePositionScore,
} from './threatEvaluation';
export type {
  ThreatScore,
  ThreatShape,
  ThreatWeights,
} from './threatEvaluation';

// Target selection
export { selectTarget } from './targetSelection';
export type {
  SelectTargetOptions,
  StickyPolicyOptions,
  TargetSelection,
  TargetSelectionPolicy,
  TargetSelectionReason,
} from './targetSelection';

// Hazard perception (AC 20201 Sub-AC 1) — unified per-tick view of stage
// hazards every difficulty tier consumes.
export {
  PERCEIVED_HAZARD_KINDS,
  chebyshevDistanceToHazardEdge,
  distanceToHazardCenter,
  findNearestDangerousHazard,
  findNearestHazard,
  getBlockingHazards,
  getDangerousHazards,
  getHazardAabbMinMax,
  pointInsideHazard,
  sortPerceivedHazards,
  validatePerceivedHazard,
} from './hazardPerception';
export type {
  HazardPredicate,
  PerceivedCrumblingHazard,
  PerceivedCrumblingState,
  PerceivedHazard,
  PerceivedHazardBounds,
  PerceivedLavaHazard,
  PerceivedLavaState,
  PerceivedPeriodicHazard,
  PerceivedPeriodicState,
  PerceivedWindHazard,
  PerceivedWindState,
} from './hazardPerception';
