/**
 * MoveTowardOpponentLeaf — closes the gap toward the current opponent
 * until the bot is within `preferredRangePx`. Used as the first step
 * of every offensive sequence (neutral entry + combo follow-up).
 *
 * Behaviour
 * ---------
 *   1. No opponent (`ctx.opponent == null`) → `Failure`. Lets the
 *      enclosing Selector fall through to whatever idle / defensive
 *      branch comes next.
 *   2. Already inside `preferredRangePx` → `Success`, no emit. The
 *      sequence's next step (an attack leaf) can fire immediately.
 *   3. Outside the range → emit `moveLeft` / `moveRight` toward the
 *      opponent and return `Running`. The sequence stays parked on
 *      this leaf until the bot crosses the threshold.
 *
 * Determinism
 * -----------
 * Pure read-of-snapshot, write-of-action. No `Math.random`, no
 * wall-clock. The same `(opponent.distance, preferredRangePx)`
 * inputs always produce the same status + emit sequence.
 *
 * Why a separate leaf rather than baking movement into each attack
 * leaf?
 *
 *   • Sub-AC 3 explicitly asks for "execution against opponents",
 *     which means the bot must *reach* the opponent before pressing
 *     attack. Splitting movement into a reusable leaf lets every
 *     offensive sequence (neutral, jab→tilt, jab→smash, tilt→smash)
 *     share the same gap-close logic without duplicating intent.
 *
 *   • Forthcoming defensive / recovery branches will reuse the same
 *     movement leaf with a different range (e.g. "spacing" vs.
 *     "engage"); having it stand alone matches the planned sub-tree
 *     composition.
 */

import { LeafNode, NodeStatus } from '../behaviorTree/Node';
import type { OffensiveContext } from './types';

/** Construction options for {@link MoveTowardOpponentLeaf}. */
export interface MoveTowardOpponentOptions {
  /**
   * Absolute distance in design pixels at which the bot stops
   * moving and the leaf returns `Success`. Authored per-sequence —
   * a jab branch wants ~50 px (the jab's own reach), a smash
   * branch wants ~70 px (smash's longer hitbox). Must be positive.
   */
  readonly preferredRangePx: number;
}

/**
 * Leaf that walks/runs the bot toward the active opponent.
 */
export class MoveTowardOpponentLeaf extends LeafNode<OffensiveContext> {
  private readonly preferredRangePx: number;

  /**
   * @param options Required — see {@link MoveTowardOpponentOptions}.
   * @param name Optional debug label, surfaced in tree dumps.
   */
  constructor(options: MoveTowardOpponentOptions, name?: string) {
    super(name);
    if (
      !Number.isFinite(options.preferredRangePx) ||
      options.preferredRangePx <= 0
    ) {
      throw new Error(
        `MoveTowardOpponentLeaf: preferredRangePx must be > 0, got ` +
          String(options.preferredRangePx),
      );
    }
    this.preferredRangePx = options.preferredRangePx;
  }

  protected override onTick(context: OffensiveContext): NodeStatus {
    const opponent = context.opponent;
    if (opponent === null) {
      return NodeStatus.Failure;
    }

    const distance = opponent.distance;
    const absDistance = Math.abs(distance);

    if (absDistance <= this.preferredRangePx) {
      // Already in range — do not over-commit movement; let the
      // next leaf in the sequence press its attack on the same tick.
      return NodeStatus.Success;
    }

    // Closing — emit a movement intent toward the opponent.
    if (distance > 0) {
      context.out.emit({ kind: 'moveRight' });
    } else {
      context.out.emit({ kind: 'moveLeft' });
    }
    return NodeStatus.Running;
  }

  /** Inspector for tests / debug overlays. */
  getPreferredRangePx(): number {
    return this.preferredRangePx;
  }
}
