/**
 * Offensive-play module — public re-exports.
 *
 * Hard-tier offensive behavior-tree branches authored in AC 18
 * Sub-AC 3. Composes leaves (movement, basic attack press, combo
 * recognition, follow-up execution) into a single Selector that
 * prioritises in-flight chains over neutral jab entries. The
 * companion {@link registerLandedHit} helper keeps the Blackboard
 * in sync from the controller's hit-detection callback.
 */

// Core types
export type {
  ActionWriter,
  AttackKind,
  ComboStage,
  OffensiveAction,
  OffensiveActionKind,
  OffensiveBlackboardSchema,
  OffensiveContext,
  OpponentSnapshot,
  OpponentStateLabel,
  PlannedFollowUp,
  SelfSnapshot,
} from './types';
export { DEFAULT_OFFENSIVE_BLACKBOARD } from './types';

// Combo policy
export {
  KO_PERCENT_THRESHOLD,
  JAB_TO_TILT_FRAMES,
  JAB_TO_SMASH_FRAMES,
  TILT_TO_SMASH_FRAMES,
  recognizeFollowUp,
  advanceComboStage,
  isComboWindowExpired,
} from './comboRecognition';

// Controller-side hooks
export {
  registerLandedHit,
  clearOffensiveCombo,
} from './registerLandedHit';
export type { RegisterLandedHitInput } from './registerLandedHit';

// Leaf nodes
export {
  MoveTowardOpponentLeaf,
} from './MoveTowardOpponentLeaf';
export type { MoveTowardOpponentOptions } from './MoveTowardOpponentLeaf';

export { FireAttackLeaf } from './FireAttackLeaf';
export type { FireAttackOptions } from './FireAttackLeaf';

export { RecognizeFollowUpLeaf } from './RecognizeFollowUpLeaf';

export {
  ExecuteFollowUpLeaf,
  DEFAULT_FOLLOW_UP_RANGE_PX,
} from './ExecuteFollowUpLeaf';
export type { ExecuteFollowUpOptions } from './ExecuteFollowUpLeaf';

// Tree factory
export {
  buildHardOffensiveTree,
  resolveHardOffensiveTreeOptions,
} from './HardOffensiveTree';
export type {
  HardOffensiveTreeOptions,
  ResolvedHardOffensiveTreeOptions,
} from './HardOffensiveTree';

// Sub-AC 5 additions — predictive movement + edge-guarding
export {
  DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES,
  MAX_PREDICTIVE_LOOKAHEAD_FRAMES,
  choosePredictiveMoveDirection,
  clampLookaheadFrames,
  projectOpponentPosition,
  projectedOpponentDistance,
} from './predictiveMovement';
export type { PredictiveMoveDirection } from './predictiveMovement';

export { PredictiveMoveLeaf } from './PredictiveMoveLeaf';
export type { PredictiveMoveOptions } from './PredictiveMoveLeaf';

export {
  DEFAULT_LEDGE_ANCHOR_TOLERANCE_PX,
  DEFAULT_OFFSTAGE_HORIZONTAL_SLACK_PX,
  DEFAULT_OFFSTAGE_VERTICAL_SLACK_PX,
  DEFAULT_SMASH_VERTICAL_REACH_PX,
  chooseEdgeGuardAttack,
  edgeGuardAnchorX,
  isOpponentOffStage,
  nearestStageEdge,
  shouldCommitEdgeGuard,
} from './edgeGuardPolicy';
export type {
  EdgeGuardAttackChoice,
  EdgeGuardCommitInput,
} from './edgeGuardPolicy';

export { EdgeGuardLeaf } from './EdgeGuardLeaf';
export type { EdgeGuardOptions } from './EdgeGuardLeaf';

// AC 20205 Sub-AC 5 — DI prediction primitives. Hard-tier edge-guard
// branch consults these to anchor at the *predicted* recovery ledge
// rather than the *current* opponent side.
export {
  DEFAULT_DI_BIAS_MAGNITUDE,
  DEFAULT_DI_GRAVITY_PX_PER_FRAME_SQ,
  DEFAULT_DI_LAUNCH_THRESHOLD_PX,
  DEFAULT_DI_LOOKAHEAD_FRAMES,
  MAX_DI_LOOKAHEAD_FRAMES,
  clampDILookahead,
  predictDIDirection,
  predictedEdgeGuardAnchorX,
  predictedRecoveryEdge,
  predictHitstunLandingX,
} from './diPrediction';
export type {
  DIDirection,
  HitstunLandingPrediction,
  PredictDIInput,
  PredictHitstunLandingInput,
} from './diPrediction';

export {
  buildHardOffensiveTreeV2,
  resolveHardOffensiveTreeV2Options,
} from './HardOffensiveTreeV2';
export type {
  HardOffensiveTreeV2Options,
  ResolvedHardOffensiveTreeV2Options,
} from './HardOffensiveTreeV2';

// Easy-tier additions (AC 10203 Sub-AC 3) — frequent idle behaviour
// and a basic-jab branch composed via the existing leaves.
export { IdleChanceLeaf, DEFAULT_EASY_IDLE_CHANCE } from './IdleChanceLeaf';
export type { IdleChanceOptions } from './IdleChanceLeaf';

// Easy-tier additions (AC 20203 Sub-AC 3) — frequent wandering behaviour.
export { WanderLeaf, DEFAULT_EASY_WANDER_CHANCE } from './WanderLeaf';
export type { WanderLeafOptions } from './WanderLeaf';

export {
  buildEasyOffensiveTree,
  resolveEasyOffensiveTreeOptions,
  EASY_REACTION_WINDOW_RANGE,
} from './EasyOffensiveTree';
export type {
  EasyOffensiveTreeOptions,
  ResolvedEasyOffensiveTreeOptions,
} from './EasyOffensiveTree';

// Easy-tier additions (AC 10202 Sub-AC 2) — random-move-select leaf
// with a long inter-attack cooldown plus a tree composition that
// stitches it together with the shared idle / movement leaves.
export {
  DEFAULT_RANDOM_MOVE_COOLDOWN_FRAMES,
  DEFAULT_RANDOM_MOVE_POOL,
  DEFAULT_RANDOM_MOVE_RANGE_PX,
  RandomMoveSelectLeaf,
  resolveRandomMoveSelectOptions,
} from './RandomMoveSelectLeaf';
export type {
  RandomMoveSelectOptions,
  ResolvedRandomMoveSelectOptions,
} from './RandomMoveSelectLeaf';

export {
  buildEasyRandomMoveTree,
  resolveEasyRandomMoveTreeOptions,
  EASY_RANDOM_REACTION_WINDOW_RANGE,
} from './EasyRandomMoveTree';
export type {
  EasyRandomMoveTreeOptions,
  ResolvedEasyRandomMoveTreeOptions,
} from './EasyRandomMoveTree';

// Medium-tier additions (AC 10204 Sub-AC 4) — defensive blocking
// behaviour layered on top of combo-aware offence.
export {
  ShieldThreatLeaf,
  DEFAULT_SHIELD_RANGE_PX,
  DEFAULT_MEDIUM_SHIELD_CHANCE,
  DEFAULT_THREAT_STATE_LABELS,
} from './ShieldThreatLeaf';
export type { ShieldThreatOptions } from './ShieldThreatLeaf';

// Medium-tier additions (AC 10203 Sub-AC 3) — contextual move
// selection (close-range vs ranged) and dodge evasion layered onto
// the original Medium tree.
export {
  DodgeThreatLeaf,
  DEFAULT_DODGE_RANGE_PX,
  DEFAULT_MEDIUM_DODGE_CHANCE,
  DEFAULT_DODGE_THREAT_STATE_LABELS,
} from './DodgeThreatLeaf';
export type { DodgeThreatOptions } from './DodgeThreatLeaf';

export {
  RangedAttackLeaf,
  DEFAULT_RANGED_MIN_RANGE_PX,
  DEFAULT_RANGED_MAX_RANGE_PX,
  DEFAULT_RANGED_SKIP_STATE_LABELS,
} from './RangedAttackLeaf';
export type { RangedAttackOptions } from './RangedAttackLeaf';

export {
  buildMediumOffensiveTree,
  resolveMediumOffensiveTreeOptions,
  MEDIUM_REACTION_WINDOW_RANGE,
} from './MediumOffensiveTree';
export type {
  MediumOffensiveTreeOptions,
  ResolvedMediumOffensiveTreeOptions,
} from './MediumOffensiveTree';
