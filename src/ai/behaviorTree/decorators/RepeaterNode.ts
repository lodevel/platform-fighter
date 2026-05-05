/**
 * Repeater decorator — loops its child either a bounded or unbounded
 * number of times, with optional early-exit policies on Success/Failure.
 *
 * Counts iterations by completed terminal results from the child:
 *
 *   - Each tick that produces `Success` or `Failure` from the child
 *     advances the iteration counter by one.
 *   - When `Running` is returned, the iteration is still in progress and
 *     the counter is left alone.
 *
 * Termination rules
 *
 *   - `breakOnFailure: true` — return `Failure` immediately if the child
 *     returns `Failure`. (Useful for "retry until something breaks".)
 *   - `breakOnSuccess: true` — return `Success` immediately if the child
 *     returns `Success`. (Useful for "keep trying until it works".)
 *   - Once iterations reach `count`, return `Success`. The decorator
 *     does not fail on count exhaustion — exceeding the budget without
 *     a break is the normal "loop completed" outcome.
 *   - When `count` is omitted, the Repeater is a forever-loop: it never
 *     returns terminal unless one of the break flags fires.
 *
 * Between iterations
 *
 *   After a non-final terminal tick, the child is reset so the next
 *   iteration starts from a clean slate (a wrapped Sequence rewinds to
 *   child[0], a wrapped Action re-enters its onEnter, etc.). The
 *   decorator itself returns `Running` between iterations so the outer
 *   tree understands the loop is still in flight.
 *
 * Determinism contract
 *
 *   The only mutable state is `iterations`, which is reset to `0` after
 *   any terminal result and on `reset()`. Replays therefore re-enter the
 *   loop in the same starting condition, and identical input contexts
 *   produce identical loop counts.
 */

import {
  DecoratorNode,
  NodeStatus,
  isFailure,
  isRunning,
  isSuccess,
  type IBehaviorNode,
} from '../Node';

/** Construction options for {@link RepeaterNode}. */
export interface RepeaterOptions {
  /**
   * Number of iterations to complete before returning `Success`. Must be
   * a positive integer. Omit for an unbounded "forever" loop.
   */
  readonly count?: number;
  /** If true, abort with `Failure` the first time the child fails. */
  readonly breakOnFailure?: boolean;
  /** If true, abort with `Success` the first time the child succeeds. */
  readonly breakOnSuccess?: boolean;
}

/**
 * Repeater: re-ticks the wrapped child according to a count and optional
 * break policies.
 *
 * @typeParam TContext User-defined context shape, forwarded unchanged to
 *                     the wrapped child.
 */
export class RepeaterNode<TContext> extends DecoratorNode<TContext> {
  /** Number of completed iterations since the last terminal / reset. */
  private iterations = 0;

  private readonly count: number | undefined;
  private readonly breakOnFailure: boolean;
  private readonly breakOnSuccess: boolean;

  /**
   * @param child Wrapped child node. Reset between iterations so each
   *              loop pass starts from a pristine state.
   * @param options Loop configuration. `count` omitted = forever.
   * @param name Optional debug label.
   */
  constructor(
    child: IBehaviorNode<TContext>,
    options: RepeaterOptions = {},
    name?: string,
  ) {
    super(child, name);
    if (options.count !== undefined) {
      if (!Number.isInteger(options.count) || options.count < 1) {
        throw new Error(
          `RepeaterNode${name ? ` "${name}"` : ''} requires count >= 1, got ${options.count}`,
        );
      }
    }
    this.count = options.count;
    this.breakOnFailure = options.breakOnFailure ?? false;
    this.breakOnSuccess = options.breakOnSuccess ?? false;
  }

  protected override onTick(context: TContext): NodeStatus {
    const status = this.child.tick(context);

    // Mid-iteration — child still working. Stay in the loop.
    if (isRunning(status)) return NodeStatus.Running;

    // Early-exit policies fire before iteration counting so they take
    // precedence over a count budget.
    if (isFailure(status) && this.breakOnFailure) {
      this.iterations = 0;
      return NodeStatus.Failure;
    }
    if (isSuccess(status) && this.breakOnSuccess) {
      this.iterations = 0;
      return NodeStatus.Success;
    }

    // Counted completion — terminal child result advances the loop.
    this.iterations += 1;
    if (this.count !== undefined && this.iterations >= this.count) {
      this.iterations = 0;
      return NodeStatus.Success;
    }

    // More iterations to go (or forever loop). Wipe the child so the
    // next pass enters fresh, then yield Running so the outer tree
    // knows we are still in flight.
    this.child.reset();
    return NodeStatus.Running;
  }

  /**
   * Cascade reset into the child (via super) and clear our iteration
   * counter so the next entry restarts the loop from zero.
   */
  override reset(): void {
    super.reset();
    this.iterations = 0;
  }

  /** Inspector — number of completed iterations in the active loop. */
  getIterations(): number {
    return this.iterations;
  }

  /** Inspector — configured iteration budget, or `undefined` for forever. */
  getCount(): number | undefined {
    return this.count;
  }

  /** Inspector — whether the decorator aborts on the first child failure. */
  getBreakOnFailure(): boolean {
    return this.breakOnFailure;
  }

  /** Inspector — whether the decorator aborts on the first child success. */
  getBreakOnSuccess(): boolean {
    return this.breakOnSuccess;
  }
}
