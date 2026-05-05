/**
 * Sequence composite — the AND of behavior trees.
 *
 * Ticks its children in declaration order. Returns:
 *
 *   - `Failure` the moment any child returns `Failure`.
 *   - `Running` the moment any child returns `Running`. The running
 *     index is remembered so the next tick resumes from the same child
 *     instead of re-ticking earlier siblings that already succeeded.
 *   - `Success` only if every child succeeds in turn.
 *
 * Stateful semantics — also called a "memoized" sequence — match the
 * textbook BT formulation and keep long-running actions stable across
 * ticks. Reactive sequence semantics (re-evaluating earlier children
 * every tick) can be layered on top later by wrapping with a custom
 * decorator if a controller ever needs them; this base class deliberately
 * avoids re-running succeeded children to keep AI behaviour predictable.
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
  isFailure,
  isRunning,
} from '../Node';

/**
 * Sequence: succeed iff all children succeed, in order.
 *
 * @typeParam TContext User-defined context shape. The composite never
 *                     reads its fields directly — it just forwards the
 *                     same reference to each child.
 */
export class SequenceNode<TContext> extends CompositeNode<TContext> {
  /**
   * Index of the child to tick next. Advanced as children succeed and
   * pinned in place when a child returns `Running`. Reset to `0` after
   * any terminal result so the next entry restarts the sequence cleanly.
   */
  private currentIndex = 0;

  protected override onTick(context: TContext): NodeStatus {
    // Resume from the previously-running child. Earlier siblings either
    // already succeeded (stored progress) or this is a fresh entry.
    while (this.currentIndex < this.children.length) {
      const child = this.children[this.currentIndex]!;
      const status = child.tick(context);

      if (isRunning(status)) {
        // Pin the index so the next tick resumes here without reticking
        // succeeded predecessors.
        return NodeStatus.Running;
      }
      if (isFailure(status)) {
        // Sequence short-circuits on the first failure. Reset progress so
        // the next entry starts fresh from child[0].
        this.currentIndex = 0;
        return NodeStatus.Failure;
      }
      // Success → advance to the next child.
      this.currentIndex += 1;
    }

    // All children succeeded — terminal Success, restart for the next call.
    this.currentIndex = 0;
    return NodeStatus.Success;
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
   * `0` if the sequence has not yet ticked or just terminated).
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }
}
