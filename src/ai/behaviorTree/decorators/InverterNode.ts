/**
 * Inverter decorator — the NOT of behavior trees.
 *
 * Wraps a single child and flips its terminal result:
 *
 *   - child `Success`  →  `Failure`
 *   - child `Failure`  →  `Success`
 *   - child `Running`  →  `Running`  (passed through unchanged)
 *
 * Running deliberately tunnels through unmodified: an inverted "still
 * working" status is meaningless, and clamping it to a terminal value
 * would either lie about progress or interrupt long-running actions.
 *
 * Determinism contract
 *
 *   The Inverter holds no internal mutable state of its own — every tick
 *   is a pure function of the wrapped child's result. Determinism is
 *   inherited entirely from the child plus the seeded Rng on `context`.
 *
 * Typical use
 *
 *   - Negate a precondition: `Inverter(IsEnemyClose)` → "not close".
 *   - Build a "fail unless" guard alongside a Sequence: a child that
 *     returns Success only when something is true becomes a Failure
 *     branch under an Inverter, neatly aborting the surrounding sequence.
 */

import { DecoratorNode, NodeStatus, isFailure, isSuccess } from '../Node';

/**
 * Inverter: flips Success ↔ Failure; tunnels Running through.
 *
 * @typeParam TContext User-defined context shape, forwarded unchanged
 *                     to the wrapped child.
 */
export class InverterNode<TContext> extends DecoratorNode<TContext> {
  protected override onTick(context: TContext): NodeStatus {
    const status = this.child.tick(context);
    if (isSuccess(status)) return NodeStatus.Failure;
    if (isFailure(status)) return NodeStatus.Success;
    // Running — pass through; no inversion is defined for non-terminal.
    return NodeStatus.Running;
  }
}
