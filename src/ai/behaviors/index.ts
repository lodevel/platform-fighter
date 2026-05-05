/**
 * AI behaviors module — public re-exports.
 *
 * Named combat-pattern subtrees authored on top of the offensive /
 * recovery / perception primitives. Each file in this directory owns a
 * single high-level pattern (combo execution, defensive bait-and-
 * punish, ledge-trap chains, …) and exposes factory functions that
 * return composed behavior-tree subtrees ready to plug into a
 * controller's top-level Selector.
 *
 * Sub-AC 3 of AC 18 — Hard-tier combo execution behaviors:
 *
 *   • Hit-confirm follow-ups (jab → tilt, jab → smash, tilt → smash)
 *   • Basic punish combos against opponents in recovery / shield /
 *     dodge / hitstun
 *   • Composed Selector that prefers in-flight chains over fresh
 *     punish openings.
 */
export {
  DEFAULT_HIT_CONFIRM_RANGE_PX,
  DEFAULT_PUNISHABLE_STATE_LABELS,
  DEFAULT_PUNISH_CLOSE_RANGE_PX,
  DEFAULT_PUNISH_SMASH_RANGE_PX,
  DEFAULT_PUNISH_TILT_RANGE_PX,
  buildHardCombosTree,
  buildHitConfirmComboSubtree,
  buildPunishComboSubtree,
  resolveHardCombosTreeOptions,
  resolveHitConfirmComboOptions,
  resolvePunishComboOptions,
} from './hardCombos';
export type {
  HardCombosTreeOptions,
  HitConfirmComboOptions,
  PunishComboOptions,
  ResolvedHardCombosTreeOptions,
  ResolvedHitConfirmComboOptions,
  ResolvedPunishComboOptions,
} from './hardCombos';

/**
 * Sub-AC 1 of AC 170301 — Hard-tier off-stage recovery decision logic.
 *
 *   • Pure {@link classifyOffStageStrategy} helper that maps a
 *     (self, stage) tuple to one of {@link OffStageStrategy}.
 *   • {@link buildOffStageDecisionSubtree} dispatcher that gates on
 *     off-stage state at the root and routes to the correct recovery
 *     leaf based on the classification.
 *
 * Sub-AC 2 of AC 170302 — Hard-tier double-jump and special-move
 * recovery selection subtree.
 *
 *   • {@link computeRecoveryResourceView} — pure helper that combines
 *     the snapshot's resource flags with the Blackboard latches into
 *     an effective "what's still pressable this airborne period" view.
 *   • {@link kinematicUpwardCoastPx} / {@link upwardTravelNeededPx} —
 *     pure helpers exposing the position+velocity reach math used by
 *     the tier classifier.
 *   • {@link selectRecoveryMoveTier} — pure helper that maps
 *     (self, stage, resources) to one of {@link RecoveryMoveTier}.
 *   • {@link buildRecoveryMoveSelectionSubtree} — dispatcher with a
 *     dedicated multi-frame execution sequence for the
 *     `'doubleJumpThenUpSpecial'` plan (DJ → apex-hold → US).
 *
 * Sub-AC 3 of AC 170303 — Hard-tier ledge-mix-up subtree.
 *
 *   • {@link chooseLedgeGetUpOption} — pure helper that picks a
 *     get-up option from a seeded {@link Rng} with opponent-aware
 *     weight bumping.
 *   • {@link mapGetUpOptionToActionKind} — pure mapping from a
 *     chosen option to the {@link RecoveryActionKind} verb the leaf
 *     emits.
 *   • {@link LedgePreGrabStallLeaf} — varies the actual ledge-grab
 *     timing when an opponent is covering the corner.
 *   • {@link LedgeTrumpLeaf} — commits the grab even when the
 *     opponent currently holds the ledge (engine awards latest
 *     grabber).
 *   • {@link LedgeGetUpLeaf} — randomises the get-up option after a
 *     jittered hang.
 *   • {@link LedgeRegrabLeaf} — drops off and lets the regular
 *     dispatcher rise back when ledge i-frames go stale.
 *   • {@link buildLedgeMixupSubtree} — composed Selector that
 *     stacks the four leaves into a single mix-up subtree.
 */
export {
  buildLedgeMixupSubtree,
  buildOffStageDecisionSubtree,
  buildRecoveryMoveSelectionSubtree,
  chooseLedgeGetUpOption,
  classifyOffStageStrategy,
  computeRecoveryResourceView,
  kinematicUpwardCoastPx,
  LedgeGetUpLeaf,
  LedgePreGrabStallLeaf,
  LedgeRegrabLeaf,
  LedgeTrumpLeaf,
  mapGetUpOptionToActionKind,
  resolveLedgeGetUpWeights,
  resolveLedgeMixupOptions,
  resolveOffStageClassificationOptions,
  resolveOffStageDecisionOptions,
  resolveRecoveryMoveSelectionClassifyOptions,
  resolveRecoveryMoveSelectionOptions,
  selectRecoveryMoveTier,
  upwardTravelNeededPx,
} from './hardRecovery';
export type {
  LedgeGetUpOptions,
  LedgeGetUpWeights,
  LedgeMixupOpponentGetter,
  LedgeMixupOpponentSnapshot,
  LedgeMixupOptions,
  LedgePreGrabStallOptions,
  LedgeRegrabOptions,
  LedgeTrumpOptions,
  OffStageClassificationOptions,
  OffStageDecisionOptions,
  OffStageStrategy,
  RecoveryApexHoldOptions,
  RecoveryMoveSelectionClassifyOptions,
  RecoveryMoveSelectionOptions,
  RecoveryMoveTier,
  RecoveryResourceView,
  ResolvedLedgeGetUpWeights,
  ResolvedLedgeMixupOptions,
  ResolvedOffStageClassificationOptions,
  ResolvedOffStageDecisionOptions,
  ResolvedRecoveryMoveSelectionClassifyOptions,
  ResolvedRecoveryMoveSelectionOptions,
} from './hardRecovery';
