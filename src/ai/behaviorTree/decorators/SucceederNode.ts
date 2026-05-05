/**
 * Succeeder decorator — collapses every terminal child result to `Success`.
 *
 * Wraps a single child and rewrites its terminal status:
 *
 *   - child `Success`  →  `Success`  (passes through)
 *   - child `Failure`  →  `Success`  (rewritten)
 *   - child `Running`  →  `Running`  (passes through unchanged)
 *
 * Running deliberately tunnels through unmodified for the same reason as
 * the Inverter: forcing a still-working child to a terminal value would
 * either lie about progress or interrupt long-running actions. The
 * Succeeder is concerned with the *outcome* of completed work, not the
 * progress signal.
 *
 * Why Succeeder is useful
 *
 *   The classic role is "optional sub-task in a Sequence". A Sequence
 *   aborts the moment one child fails — but sometimes you want a step to
 *   be best-effort: try to grab the ledge, but keep going either way.
 *   Wrapping that step in a Succeeder hides its Failure from the parent
 *   composite without altering the child's own logic. It is the "ignore
 *   the result" decorator.
 *
 *   Compare to Inverter: Succeeder ≠ "child Failure → Success and
 *   Success → Failure". It is "always Success on completion". It is the
 *   smaller, more direct primitive when the goal is simply to swallow a
 *   Failure rather than to negate a precondition.
 *
 * Determinism contract
 *
 *   Succeeder owns no internal mutable state of its own — every tick is
 *   a pure function of the wrapped child's result. Determinism is
 *   inherited entirely from the child plus the seeded Rng on `context`,
 *   matching the contract documented on Inverter.
 *
 * Typical use
 *
 *   - Best-effort recovery option in a Sequence:
 *     `Sequence(MoveToCenter, Succeeder(GrabLedge), Attack)`.
 *   - Logging / telemetry leaves whose Failure must not propagate.
 *   - Adapter when feeding a Failure-on-noop leaf to a parent that
 *     interprets Failure as a real abort signal.
 */

import { DecoratorNode, NodeStatus, isRunning } from '../Node';

/**
 * Succeeder: forces every terminal child result to `Success`; tunnels
 * `Running` through unchanged.
 *
 * @typeParam TContext User-defined context shape, forwarded unchanged
 *                     to the wrapped child.
 */
export class SucceederNode<TContext> extends DecoratorNode<TContext> {
  protected override onTick(context: TContext): NodeStatus {
    const status = this.child.tick(context);
    // Running tunnels — only terminal results are rewritten, so the outer
    // tree still sees "still working" while the child is mid-action.
    if (isRunning(status)) return NodeStatus.Running;
    return NodeStatus.Success;
  }
}
