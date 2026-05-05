/**
 * ExecuteFollowUpLeaf — consumes the `comboPlannedFollowUp` written
 * by the recognition leaf and emits the corresponding attack press,
 * subject to the same gating as {@link
 * import('./FireAttackLeaf').FireAttackLeaf} (live opponent,
 * can-attack, in-range).
 *
 * Behaviour
 * ---------
 *   1. No plan staged (`comboPlannedFollowUp == null`)  → `Failure`.
 *      Sequencing constraint — the recognition leaf must run first.
 *   2. No opponent (`ctx.opponent == null`)             → clear
 *      plan, `Failure`.
 *   3. Bot can't attack (`self.canAttack === false`)    → leave the
 *      plan in place and return `Running`. Hard-tier bots commit to
 *      a plan once they've recognised it; the press will fire as
 *      soon as the engine clears recovery, provided the window
 *      hasn't expired (see step 5).
 *   4. Opponent out of range for the planned attack     → leave the
 *      plan in place and return `Running`. The enclosing Sequence
 *      already places `MoveTowardOpponentLeaf` before the recognise
 *      / execute pair; this is a defensive guard for stand-alone
 *      wirings.
 *   5. Window expired (`tick - lastLandedTick > maxFollowUpFrames`)
 *      → clear plan, drop chain, `Failure`. Mirrors the recognition
 *      leaf's window-check so out-of-window plans cannot quietly
 *      leak across many ticks of "Running" while the bot waits for
 *      `canAttack`.
 *   6. All gates open → emit the press (with `comboStepId`), clear
 *      the plan, advance no internal state (the controller's
 *      `registerLandedHit` decides the next stage on hit), return
 *      `Success`.
 *
 * Why a separate leaf rather than absorbing the press into the
 * recognition leaf?
 *
 *   • Splitting recognition (Blackboard write) from execution
 *     (Blackboard read + emit) keeps each leaf single-purpose. A
 *     forthcoming "force a chain reset on hit" leaf can sit between
 *     them without rewriting either side.
 *
 *   • The two leaves can be reused in a Parallel composite for
 *     debug overlays that want to render the *recognised* plan
 *     even on frames the press is gated.
 *
 * Determinism
 * -----------
 * Pure: reads context + blackboard, writes determinist outputs. No
 * Rng, no wall-clock; reset/replay-friendly because all state lives
 * on the Blackboard.
 */

import { LeafNode, NodeStatus } from '../behaviorTree/Node';
import { isComboWindowExpired } from './comboRecognition';
import type {
  AttackKind,
  OffensiveContext,
  PlannedFollowUp,
} from './types';

/** Optional construction parameters for {@link ExecuteFollowUpLeaf}. */
export interface ExecuteFollowUpOptions {
  /**
   * Per-attack reach map (design pixels). The leaf consults this
   * table when the planned attack arrives so the gate check uses
   * the same reach the corresponding {@link
   * import('./FireAttackLeaf').FireAttackLeaf} would have used.
   *
   * Defaults — tuned to the M2 roster's hitbox reach + slack:
   *
   *   jab     50 px   — Cat / Wolf jabs reach ~36-44 px, +slack.
   *   tilt    60 px   — tilt reach is 44-52 px, +slack.
   *   smash   72 px   — smash reach 50-58 px, +slack.
   *   special 80 px   — projectile / lunge reach varies; coarse upper.
   */
  readonly maxRangePxByAttack?: Readonly<Record<AttackKind, number>>;
}

/** Default reach map; see {@link ExecuteFollowUpOptions}. */
export const DEFAULT_FOLLOW_UP_RANGE_PX: Readonly<Record<AttackKind, number>> =
  Object.freeze({
    jab: 50,
    tilt: 60,
    smash: 72,
    special: 80,
  });

/**
 * Leaf that consumes the staged follow-up plan and emits the
 * corresponding press when the gates clear.
 */
export class ExecuteFollowUpLeaf extends LeafNode<OffensiveContext> {
  private readonly maxRangePxByAttack: Readonly<Record<AttackKind, number>>;

  /**
   * @param options Optional — see {@link ExecuteFollowUpOptions}.
   * @param name Optional debug label.
   */
  constructor(options: ExecuteFollowUpOptions = {}, name?: string) {
    super(name);
    this.maxRangePxByAttack =
      options.maxRangePxByAttack ?? DEFAULT_FOLLOW_UP_RANGE_PX;
  }

  protected override onTick(context: OffensiveContext): NodeStatus {
    const blackboard = context.blackboard;
    const plan: PlannedFollowUp | null =
      blackboard.get('comboPlannedFollowUp') ?? null;

    if (plan === null) {
      return NodeStatus.Failure;
    }

    const opponent = context.opponent;
    if (opponent === null) {
      blackboard.set('comboPlannedFollowUp', null);
      return NodeStatus.Failure;
    }

    const lastLandedTick = blackboard.get('comboLastLandedTick') ?? -1;
    if (
      isComboWindowExpired(
        context.tickIndex,
        lastLandedTick,
        plan.maxFollowUpFrames,
      )
    ) {
      // Window closed — drop the chain so the controller resumes
      // neutral on the next tick.
      blackboard.set('comboStage', 'idle');
      blackboard.set('comboLastLandedMove', null);
      blackboard.set('comboLastLandedTick', -1);
      blackboard.set('comboLastLandedOpponentPercent', 0);
      blackboard.set('comboPlannedFollowUp', null);
      return NodeStatus.Failure;
    }

    if (!context.self.canAttack) {
      // Bot is mid-recovery; commit to the plan and try again next
      // frame. Returning `Running` keeps an enclosing Sequence
      // parked here without clearing the plan.
      return NodeStatus.Running;
    }

    const reach = this.maxRangePxByAttack[plan.nextAttack];
    if (Math.abs(opponent.distance) > reach) {
      // Same logic as canAttack — keep the plan, wait for the
      // movement leaf earlier in the Sequence to close the gap.
      return NodeStatus.Running;
    }

    // All gates clear — fire the planned attack and consume the
    // plan. The controller's `registerLandedHit` will set up the
    // next stage if this hit connects.
    context.out.emit({
      kind: plan.nextAttack,
      comboStepId: plan.comboStepId,
    });
    blackboard.set('comboPlannedFollowUp', null);
    return NodeStatus.Success;
  }

  /** Inspector for tests / debug overlays. */
  getMaxRangePxByAttack(): Readonly<Record<AttackKind, number>> {
    return this.maxRangePxByAttack;
  }
}
