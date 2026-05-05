/**
 * AI decision module — public re-exports (AC 20202 Sub-AC 2).
 *
 * Exposes the strategic finite state machine that decides what the
 * bot is trying to do this moment (`approach`, `attack`, `defend`,
 * `recover`, `retreat`) plus the move-selection heuristics that pick
 * the actual press(es) for each state.
 *
 * Usage in three flavours:
 *
 *   1. **Standalone FSM** — controllers that want the FSM as the
 *      full brain for a tier construct {@link DecisionFSM}, project
 *      a {@link DecisionContext} from their per-tick world snapshot,
 *      and call `tick(ctx, out)` once per fixed step.
 *
 *   2. **Pure-function policy** — tests / diagnostic harnesses that
 *      only need the transition surface (without the class plumbing)
 *      call {@link resolveDecisionState} directly.
 *
 *   3. **Behavior-tree composition** — controllers that want to slot
 *      the FSM into an existing tier tree (e.g. as the fallback under
 *      a top-level Selector when no tactical leaf has work) wrap it
 *      in {@link DecisionFSMLeaf}.
 */

export {
  DECISION_STATE_PRIORITY,
  DecisionState,
} from './types';
export type {
  DecisionAction,
  DecisionActionKind,
  DecisionActionWriter,
  DecisionContext,
} from './types';

export {
  DEFAULT_DECISION_POLICY_OPTIONS,
  isAttackGate,
  isDefendGate,
  isRecoverGate,
  isRetreatGate,
  resolveDecisionPolicyOptions,
  resolveDecisionState,
} from './decisionPolicy';
export type {
  DecisionPolicyOptions,
  ResolvedDecisionPolicyOptions,
} from './decisionPolicy';

export {
  DEFAULT_ATTACK_VOCABULARY,
  DEFAULT_MOVE_SELECTION_OPTIONS,
  resolveMoveSelectionOptions,
  selectActionsForState,
  selectApproachActions,
  selectAttackActions,
  selectDefendActions,
  selectRecoverActions,
  selectRetreatActions,
} from './moveSelectionHeuristics';
export type {
  AttackVerb,
  AttackVocabulary,
  MoveSelectionOptions,
  ResolvedMoveSelectionOptions,
} from './moveSelectionHeuristics';

export { DecisionFSM, recordingDecisionWriter } from './DecisionFSM';
export type {
  DecisionFSMOptions,
  DecisionFSMSnapshot,
  DecisionFSMTransitionCallback,
} from './DecisionFSM';

export {
  DEFAULT_DECISION_FSM_LEAF_SUCCESS_STATES,
  DecisionFSMLeaf,
  defaultDecisionToOffensiveTranslator,
} from './DecisionFSMLeaf';
export type {
  DecisionFSMLeafOptions,
  DecisionToOffensiveTranslator,
} from './DecisionFSMLeaf';
