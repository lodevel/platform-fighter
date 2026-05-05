/**
 * PredictiveMoveLeaf — closes the gap toward the opponent's *projected*
 * position. Hard-tier counterpart to
 * {@link import('./MoveTowardOpponentLeaf').MoveTowardOpponentLeaf}
 * (which closes to the opponent's *current* position).
 *
 * Behaviour
 * ---------
 *
 *   1. No opponent (`ctx.opponent == null`)        → `Failure`.
 *      Lets the enclosing Selector fall through to whatever idle /
 *      defensive branch comes next.
 *   2. Opponent is missing kinematic data (no `position` and/or no
 *      `velocity` in the snapshot)                 → falls back to the
 *      *current* signed distance (`opponent.distance`). The leaf
 *      degrades to `MoveTowardOpponentLeaf` semantics, which is the
 *      right behaviour against tier providers that don't ship
 *      kinematic data yet.
 *   3. Already inside `preferredRangePx` of the projected position →
 *      `Success`, no emit. The sequence's next step (typically an
 *      attack leaf) can fire immediately.
 *   4. Outside the range                           → emit `moveLeft` /
 *      `moveRight` toward the projected position and return
 *      `Running`.
 *
 * Why a separate leaf rather than parameterising the existing one?
 *
 *   • The existing `MoveTowardOpponentLeaf` is already shipped through
 *     Easy/Medium/Hard tiers and feeds into the existing combo
 *     follow-up sequences. Forking a Hard-only variant keeps those
 *     sequences from accidentally swapping in predictive logic.
 *   • Predictive movement is *only* useful when opponent velocity
 *     data is available — adding the conditional fallback inside the
 *     existing leaf would require touching every Easy/Medium test for
 *     no behaviour change. Splitting keeps blast radius small.
 *   • The two leaves can coexist in a Selector: an outer Hard-tree
 *     can prefer `PredictiveMoveLeaf` and fall through to the basic
 *     leaf as a safety net.
 *
 * Determinism
 * -----------
 *
 * Pure read-of-snapshot, write-of-action. No `Math.random`, no
 * wall-clock. The same `(opponent.distance | projected distance,
 * preferredRangePx, lookaheadFrames)` inputs always produce the same
 * status + emit sequence.
 */

import { LeafNode, NodeStatus } from '../behaviorTree/Node';
import {
  DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES,
  choosePredictiveMoveDirection,
  clampLookaheadFrames,
  projectedOpponentDistance,
} from './predictiveMovement';
import type { OffensiveContext } from './types';

/** Construction options for {@link PredictiveMoveLeaf}. */
export interface PredictiveMoveOptions {
  /**
   * Absolute distance in design pixels at which the bot stops moving
   * and the leaf returns `Success`. Authored per-sequence — a jab
   * branch wants ~50 px (the jab's own reach), a smash branch wants
   * ~70 px (smash's longer hitbox). Must be positive.
   */
  readonly preferredRangePx: number;
  /**
   * How many fixed steps ahead to extrapolate the opponent's
   * trajectory. Defaults to {@link
   * DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES}. Clamped to the supported
   * band by {@link clampLookaheadFrames} so a caller passing a
   * pathological value (NaN, Infinity, 600) cannot destabilise the
   * trajectory estimate.
   */
  readonly lookaheadFrames?: number;
}

/**
 * Leaf that walks/runs the bot toward the *projected* opponent
 * position. Prefer this over the basic {@link
 * import('./MoveTowardOpponentLeaf').MoveTowardOpponentLeaf} for
 * Hard-tier branches that have access to opponent velocity data.
 */
export class PredictiveMoveLeaf extends LeafNode<OffensiveContext> {
  private readonly preferredRangePx: number;
  private readonly lookaheadFrames: number;

  /**
   * @param options Required — see {@link PredictiveMoveOptions}.
   * @param name Optional debug label, surfaced in tree dumps.
   */
  constructor(options: PredictiveMoveOptions, name?: string) {
    super(name);
    if (
      !Number.isFinite(options.preferredRangePx) ||
      options.preferredRangePx <= 0
    ) {
      throw new Error(
        `PredictiveMoveLeaf: preferredRangePx must be > 0, got ` +
          String(options.preferredRangePx),
      );
    }
    this.preferredRangePx = options.preferredRangePx;
    this.lookaheadFrames = clampLookaheadFrames(
      options.lookaheadFrames ?? DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES,
    );
  }

  protected override onTick(context: OffensiveContext): NodeStatus {
    const opponent = context.opponent;
    if (opponent === null) {
      return NodeStatus.Failure;
    }

    // Determine `selfX`: prefer the explicit `selfPosition.x` from the
    // context (preserves predictive accuracy across stages) and fall
    // back to deriving it from `opponent.position - opponent.distance`
    // when the controller hasn't supplied a position. The fallback is
    // exact when `position` is populated and pessimistic (returns the
    // raw `opponent.distance`) when not.
    const selfX =
      context.selfPosition?.x ??
      (opponent.position
        ? opponent.position.x - opponent.distance
        : Number.NaN);

    const projectedDistance = projectedOpponentDistance(
      selfX,
      opponent,
      this.lookaheadFrames,
    );

    const decision = choosePredictiveMoveDirection(
      projectedDistance,
      this.preferredRangePx,
    );

    if (decision === 'stop') {
      return NodeStatus.Success;
    }
    context.out.emit({ kind: decision === 'right' ? 'moveRight' : 'moveLeft' });
    return NodeStatus.Running;
  }

  /** Inspector for tests / debug overlays. */
  getPreferredRangePx(): number {
    return this.preferredRangePx;
  }

  /** Inspector for tests / debug overlays. */
  getLookaheadFrames(): number {
    return this.lookaheadFrames;
  }
}
