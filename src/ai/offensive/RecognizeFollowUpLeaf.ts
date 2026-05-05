/**
 * RecognizeFollowUpLeaf — reads the offensive Blackboard partition,
 * delegates to the pure {@link recognizeFollowUp} policy, and writes
 * the resulting plan back to the Blackboard for the execute leaf to
 * consume on the same (or a subsequent) tick.
 *
 * This is the "perception" half of the combo pipeline: the
 * controller-side {@link
 * import('./registerLandedHit').registerLandedHit} populated the
 * `comboStage` / `comboLastLandedTick` fields when the prior hit
 * landed; recognition turns that history into a *forward-looking
 * plan*; execution presses the button.
 *
 * Behaviour
 * ---------
 *   1. Combo not in flight (`comboStage === 'idle'`) → clear any
 *      stale plan, return `Failure`. The enclosing Selector falls
 *      through to neutral.
 *   2. Combo in flight but window expired (frames elapsed since the
 *      last hit > planned `maxFollowUpFrames`) → clear the chain
 *      back to idle (so the controller doesn't keep consulting a
 *      stale stage), clear any stale plan, return `Failure`.
 *   3. Combo in flight, window open, and {@link recognizeFollowUp}
 *      yields `null` (e.g. tilt landed at < KO%) → clear plan,
 *      drop the chain back to idle, return `Failure`.
 *   4. Combo in flight, window open, recognition produces a plan →
 *      write the plan to `comboPlannedFollowUp`, return `Success`.
 *
 * Returning `Success` advances a `Sequence` to the execute leaf.
 * The execute leaf is the only consumer of the plan field — pairing
 * the two in a Sequence keeps the read/clear lifecycle local to one
 * branch.
 *
 * Determinism
 * -----------
 * Pure: reads from blackboard + tickIndex, writes deterministic
 * results back. No Rng, no wall-clock. Recognition leaf can be
 * snapshot-restored cleanly because all state lives on the
 * Blackboard.
 */

import { LeafNode, NodeStatus } from '../behaviorTree/Node';
import {
  recognizeFollowUp,
  isComboWindowExpired,
} from './comboRecognition';
import type {
  OffensiveBlackboardSchema,
  OffensiveContext,
  PlannedFollowUp,
} from './types';

/**
 * Leaf that consults the combo policy and stages the planned
 * follow-up into the Blackboard's `comboPlannedFollowUp` slot.
 */
export class RecognizeFollowUpLeaf extends LeafNode<OffensiveContext> {
  protected override onTick(context: OffensiveContext): NodeStatus {
    const blackboard = context.blackboard;

    const stage =
      blackboard.get('comboStage') ??
      ('idle' satisfies OffensiveBlackboardSchema['comboStage']);

    if (stage === 'idle') {
      // Nothing in flight — no plan to stage. Defensive clear in
      // case a previous tick latched a plan that never fired.
      blackboard.set('comboPlannedFollowUp', null);
      return NodeStatus.Failure;
    }

    const lastLandedPercent =
      blackboard.get('comboLastLandedOpponentPercent') ?? 0;
    const lastLandedTick = blackboard.get('comboLastLandedTick') ?? -1;
    const plan: PlannedFollowUp | null = recognizeFollowUp(
      stage,
      lastLandedPercent,
    );

    // Recognition refused (chain doesn't extend) — drop back to idle
    // so the next neutral entry starts fresh.
    if (plan === null) {
      this.dropChain(blackboard);
      return NodeStatus.Failure;
    }

    // Window check — if the bot has missed its chance, drop the
    // chain and let the controller resume neutral. Equality counts
    // as still-valid; see `isComboWindowExpired`.
    if (
      isComboWindowExpired(
        context.tickIndex,
        lastLandedTick,
        plan.maxFollowUpFrames,
      )
    ) {
      this.dropChain(blackboard);
      return NodeStatus.Failure;
    }

    // Plan committed. The execute leaf will pick it up and clear it
    // after firing (or on its own miss).
    blackboard.set('comboPlannedFollowUp', plan);
    return NodeStatus.Success;
  }

  /**
   * Reset the combo partition fields that govern in-flight chains.
   * Mirrors `clearOffensiveCombo` but stays inline so this leaf has
   * no extra dependency footprint.
   */
  private dropChain(
    blackboard: OffensiveContext['blackboard'],
  ): void {
    blackboard.set('comboStage', 'idle');
    blackboard.set('comboLastLandedMove', null);
    blackboard.set('comboLastLandedTick', -1);
    blackboard.set('comboLastLandedOpponentPercent', 0);
    blackboard.set('comboPlannedFollowUp', null);
  }
}
