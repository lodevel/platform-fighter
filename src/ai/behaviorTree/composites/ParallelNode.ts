/**
 * Parallel composite — fans out to every child every tick.
 *
 * Unlike Sequence and Selector, Parallel always ticks all of its
 * children regardless of intermediate results, then aggregates their
 * statuses through a configurable success/failure policy:
 *
 *   - `successPolicy: 'one'`  — succeed as soon as any child succeeds.
 *   - `successPolicy: 'all'`  — succeed only when every child succeeds.
 *   - `failurePolicy: 'one'`  — fail as soon as any child fails.
 *   - `failurePolicy: 'all'`  — fail only when every child fails.
 *
 * Defaults match the most common BT convention used by Champagne (2007)
 * and Halo's "parallel": `successPolicy = 'all'` and
 * `failurePolicy = 'one'`. That is, "everyone has to succeed but a
 * single failure aborts the whole thing", which is the right default
 * for `[stayInRange, dodgeProjectiles, attack]`-style behaviour groups.
 *
 * Conflict resolution
 *
 *   When both policies trigger on the same tick (e.g. `successPolicy:
 *   'one'` and `failurePolicy: 'one'` both satisfied because some
 *   children succeeded and some failed), failure wins. A tree should
 *   bail out as soon as it detects something is wrong; reporting
 *   "success" alongside an observed failure would mask bugs.
 *
 * Aborting still-running children
 *
 *   When Parallel returns terminal (success or failure), any children
 *   that were still `Running` get `reset()` so they do not silently
 *   resume on a subsequent entry. This matches the BT convention that a
 *   composite "owns" the lifecycle of its descendants.
 *
 * Determinism contract
 *
 *   Children are always ticked in the same declaration order, so side
 *   effects accumulate deterministically. No internal state survives a
 *   `reset()` — Parallel is fully reactive across ticks.
 */

import {
  CompositeNode,
  NodeStatus,
  isFailure,
  isSuccess,
  type IBehaviorNode,
} from '../Node';

/**
 * Threshold flavour for Parallel's success / failure policies.
 *
 *   - `'one'` — at least one child must hit the matching status.
 *   - `'all'` — every child must hit the matching status.
 */
export type ParallelPolicy = 'one' | 'all';

/** Construction options for {@link ParallelNode}. */
export interface ParallelOptions {
  /** When this many children succeed, Parallel succeeds. Defaults to `'all'`. */
  readonly successPolicy?: ParallelPolicy;
  /** When this many children fail, Parallel fails. Defaults to `'one'`. */
  readonly failurePolicy?: ParallelPolicy;
}

/**
 * Parallel: ticks every child every frame and aggregates their results
 * through configurable success / failure policies.
 *
 * @typeParam TContext User-defined context shape, forwarded unchanged
 *                     to each child.
 */
export class ParallelNode<TContext> extends CompositeNode<TContext> {
  private readonly successPolicy: ParallelPolicy;
  private readonly failurePolicy: ParallelPolicy;

  /**
   * @param children Ordered child list (must be non-empty — enforced by
   *                 `CompositeNode`).
   * @param options Policy configuration. Defaults: success = `'all'`,
   *                failure = `'one'`.
   * @param name Optional debug label.
   */
  constructor(
    children: ReadonlyArray<IBehaviorNode<TContext>>,
    options: ParallelOptions = {},
    name?: string,
  ) {
    super(children, name);
    this.successPolicy = options.successPolicy ?? 'all';
    this.failurePolicy = options.failurePolicy ?? 'one';
  }

  protected override onTick(context: TContext): NodeStatus {
    // Tally success/failure counts and remember which children were
    // still running so we can abort them if Parallel terminates.
    let successes = 0;
    let failures = 0;

    // Stash per-index status only when needed (a running child) so the
    // hot path stays allocation-free for the common all-terminal case.
    let runningIndices: number[] | null = null;

    for (let i = 0; i < this.children.length; i++) {
      const child = this.children[i]!;
      const status = child.tick(context);

      if (isSuccess(status)) {
        successes += 1;
      } else if (isFailure(status)) {
        failures += 1;
      } else {
        // Running — remember so we can reset if Parallel terminates.
        if (runningIndices === null) runningIndices = [];
        runningIndices.push(i);
      }
    }

    const total = this.children.length;
    const failed =
      this.failurePolicy === 'one' ? failures >= 1 : failures === total;
    const succeeded =
      this.successPolicy === 'one' ? successes >= 1 : successes === total;

    // Failure takes precedence over success — see header comment.
    if (failed) {
      this.abortRunningChildren(runningIndices);
      return NodeStatus.Failure;
    }
    if (succeeded) {
      this.abortRunningChildren(runningIndices);
      return NodeStatus.Success;
    }
    return NodeStatus.Running;
  }

  /**
   * Reset any children that were still `Running` at the moment Parallel
   * returned terminal. Without this, a long-running child could resume
   * mid-action on the next entry without going through its proper
   * onEnter sequence.
   */
  private abortRunningChildren(runningIndices: number[] | null): void {
    if (runningIndices === null) return;
    for (const idx of runningIndices) {
      this.children[idx]!.reset();
    }
  }

  /** Exposed for debug tooling and tests. */
  getSuccessPolicy(): ParallelPolicy {
    return this.successPolicy;
  }

  /** Exposed for debug tooling and tests. */
  getFailurePolicy(): ParallelPolicy {
    return this.failurePolicy;
  }
}
