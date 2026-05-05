/**
 * AI module — public re-exports.
 *
 * Deterministic AI controller (seeded RNG) used to fill any empty player
 * slot. Difficulty tiers: easy / medium / hard. Composed from the
 * `behaviorTree` primitives, the `perception` reaction-window model
 * that gates response latency to a human-like band, the `offensive`
 * sub-tree that authors offensive play (Easy tier composes a
 * frequent-idle hesitation gate with a basic-jab branch — AC 10203
 * Sub-AC 3 — alongside the Hard-tier combo-recognition branches), and
 * the `recovery` sub-tree that authors Hard-tier off-stage recovery
 * (jump / double-jump / up-special selection plus ledge return).
 *
 * AC 10201 Sub-AC 1 surfaces the {@link AIInputProvider} abstract base
 * class — the bridge between the AI's intent verbs and the
 * {@link CharacterInput} record human players produce. The base class
 * also wires an optional `perceive(frame)` hook that produces a
 * {@link WorldSnapshot} carrying player positions, stage geometry,
 * and current move state on both self and every opponent — the
 * "perception of game state" half of Sub-AC 1.
 */
export * from './behaviorTree';
export * from './perception';
export * from './offensive';
export * from './recovery';
export * from './behaviors';
// Strategic decision FSM — AC 20202 Sub-AC 2 (approach / attack /
// defend / recover / retreat with move-selection heuristics).
export * from './decision';

export { AIInputProvider } from './AIInputProvider';
export type {
  AIInputCommand,
  AIInputProviderOptions,
  AIMoveCommand,
  AIPressCommand,
} from './AIInputProvider';

// Hard difficulty tier — full provider that composes reaction system,
// perception, target selection, offensive V2 (combo + edge-guard +
// predictive), and recovery sub-trees into one drop-in
// `PlayerInputProvider`. AC 10204 Sub-AC 4.
export {
  HardTierAI,
  translateOffensiveEmit,
  translateRecoveryEmit,
} from './HardTierAI';
export type {
  HardTierAIOptions,
  HardTierAISnapshot,
} from './HardTierAI';

// Easy difficulty tier — full provider that composes the Easy reaction
// preset, the Easy offensive sub-tree (idle / wander / basic jab), and
// the input-error mangler into one drop-in `PlayerInputProvider`.
// AC 20203 Sub-AC 3.
export {
  EasyTierAI,
  DEFAULT_EASY_INPUT_DELAY,
} from './EasyTierAI';
export type {
  EasyTierAIOptions,
  EasyTierAISnapshot,
} from './EasyTierAI';

// Medium difficulty tier — full provider that composes the Medium
// reaction preset (22-28 frames), the Medium offensive sub-tree
// (situational shield / dodge + combo follow-up + ranged attack +
// neutral jab), and the Hard recovery sub-tree into one drop-in
// `PlayerInputProvider`. AC 20204 Sub-AC 4.
export {
  MediumTierAI,
  DEFAULT_MEDIUM_INPUT_DELAY,
} from './MediumTierAI';
export type {
  MediumTierAIOptions,
  MediumTierAISnapshot,
} from './MediumTierAI';

// High-error-rate input mangler — the fourth pillar of the Easy tier.
// Re-exported so controllers can plug it into custom tier compositions.
export {
  DEFAULT_EASY_MOVE_ERROR_CHANCE,
  DEFAULT_EASY_PRESS_DROP_CHANCE,
  DEFAULT_EASY_SPURIOUS_PRESS_CHANCE,
  DEFAULT_SPURIOUS_PRESS_POOL,
  EasyInputErrorMangler,
  resolveEasyInputErrorOptions,
} from './easyInputErrors';
export type {
  EasyInputErrorOptions,
  ResolvedEasyInputErrorOptions,
} from './easyInputErrors';

// Hard-tier minimal-error contract — AC 20205 Sub-AC 5. Surfaces the
// "minimal error rates" half of the Hard-tier definition as a named
// option set + frozen defaults so callers and tests can assert the
// contract without re-deriving the constants.
export {
  DEFAULT_HARD_MOVE_ERROR_CHANCE,
  DEFAULT_HARD_PRESS_DROP_CHANCE,
  DEFAULT_HARD_SPURIOUS_PRESS_CHANCE,
  HARD_TIER_INPUT_ERROR_DEFAULTS,
  resolveHardInputErrorOptions,
} from './hardInputErrors';

// Hard-tier behavior tree definition — composes the combo-execution
// layer (hardCombos) with the offensive decision-making layer
// (HardOffensiveTreeV2) into a single named root tree. AC 19 Sub-AC 3.
export {
  buildHardTierTree,
  resolveHardTierTreeOptions,
} from './hardTierTree';
export type {
  HardTierTreeOptions,
  ResolvedHardTierTreeOptions,
} from './hardTierTree';

// Reliable recovery subtree — composes off-stage detection with the
// jump / double-jump / up-special / ledge-return priority Selector
// into a single named recovery root the controller plugs in ahead of
// the offensive surface. AC 19 Sub-AC 4.
export {
  buildReliableRecoverySubtree,
  isRecoverySituation,
  resolveReliableRecoverySubtreeOptions,
} from './recoveryBehavior';
export type {
  ReliableRecoverySubtreeOptions,
  ResolvedReliableRecoverySubtreeOptions,
} from './recoveryBehavior';

// Hard-tier reaction system — AC 18 Sub-AC 2 (state delay buffer +
// configurable 15-20 frame input delay, composing the existing
// per-event ReactionWindow as the optional `events` facet).
export {
  DEFAULT_HARD_TIER_BUFFER_CAPACITY,
  DEFAULT_HARD_TIER_INPUT_DELAY,
  HARD_TIER_INPUT_DELAY_RANGE,
  HardTierReactionSystem,
  perceiveOpponent,
} from './hardTierReaction';
export type {
  HardTierInputDelaySpec,
  HardTierReactionEntry,
  HardTierReactionOptions,
  HardTierReactionSnapshot,
} from './hardTierReaction';

// Hard-tier reaction model — AC 19 Sub-AC 2 (input delay simulation +
// perception filtering pipeline, in one drop-in component for the M2
// AI Hard-tier AC).
export {
  DEFAULT_HARD_TIER_EVENT_MISS_RATE,
  REACTION_MODEL_ZERO_STATS,
  ReactionModel,
  passThroughEventFilter,
  passThroughStateFilter,
  predicateEventFilter,
  predicateStateFilter,
  probabilisticEventMissFilter,
  probabilisticStateMissFilter,
  transformStateFilter,
} from './reactionModel';
export type {
  EventPerceptionFilter,
  EventPerceptionFilterContext,
  ReactionModelOptions,
  ReactionModelSnapshot,
  ReactionModelStats,
  StatePerceptionFilter,
  StatePerceptionFilterContext,
} from './reactionModel';
