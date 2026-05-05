/**
 * Selector composite — the OR of behavior trees.
 *
 * Ticks its children in declaration order, looking for the first one
 * that succeeds. Returns:
 *
 *   - `Success` the moment any child returns `Success`.
 *   - `Running` the moment any child returns `Running`. The running
 *     index is remembered so the next tick resumes from the same child
 *     rather than re-ticking earlier siblings that already failed.
 *   - `Failure` only if every child fails in turn.
 *
 * Stateful semantics — also called a "memoized" selector — match the
 * textbook BT formulation. The reactive variant (re-evaluating earlier
 * children every tick to allow priority preemption) can be layered on
 * top later via a decorator; the base class keeps long-running actions
 * stable so the AI does not thrash between alternatives.
 *
 * Determinism contract
 *
 *   The internal `currentIndex` is the only piece of mutable state.
 *   `reset()` always restores it to `0` so a replay scrub or match
 *   restart cannot leak prior progress into the next match.
 */

import {
  CompositeNode,
  NodeStatus,
  isRunning,
  isSuccess,
} from '../Node';

/**
 * Selector: succeed iff any child succeeds, in order.
 *
 * @typeParam TContext User-defined context shape. The composite never
 *                     reads its fields directly — it just forwards the
 *                     same reference to each child.
 */
export class SelectorNode<TContext> extends CompositeNode<TContext> {
  /**
   * Index of the child to tick next. Advanced as children fail and
   * pinned in place when a child returns `Running`. Reset to `0` after
   * any terminal result so the next entry restarts the selector cleanly.
   */
  private currentIndex = 0;

  protected override onTick(context: TContext): NodeStatus {
    while (this.currentIndex < this.children.length) {
      const child = this.children[this.currentIndex]!;
      const status = child.tick(context);

      if (isRunning(status)) {
        // Pin the index so the next tick resumes here without reticking
        // failed predecessors.
        return NodeStatus.Running;
      }
      if (isSuccess(status)) {
        // Selector short-circuits on the first success. Reset progress
        // so the next entry starts fresh from child[0].
        this.currentIndex = 0;
        return NodeStatus.Success;
      }
      // Failure → fall through to the next alternative.
      this.currentIndex += 1;
    }

    // No child succeeded — terminal Failure, restart for the next call.
    this.currentIndex = 0;
    return NodeStatus.Failure;
  }

  /**
   * Cascade reset into children (via super) and clear our resume index
   * so the next tick begins at child[0].
   */
  override reset(): void {
    super.reset();
    this.currentIndex = 0;
  }

  /**
   * Inspector — exposes the resume index for debug tooling. Returns the
   * value of `currentIndex` as it stood at the end of the last tick (or
   * `0` if the selector has not yet ticked or just terminated).
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }
}
