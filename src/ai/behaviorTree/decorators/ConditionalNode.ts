/**
 * Conditional decorator — also known as a "guard". Each tick consults a
 * predicate that reads from the BT context; only when the predicate
 * returns true is the wrapped child ticked.
 *
 * Behaviour
 *
 *   - Predicate true:  forward the tick to the child and return its
 *                      status verbatim.
 *   - Predicate false: skip the child entirely and return `whenFalse`
 *                      (default `Failure`, so an enclosing Selector can
 *                      fall through cleanly).
 *
 * Interrupting a running child
 *
 *   If the predicate flips from true → false while the child was
 *   `Running` on the previous tick, the child is `reset()` so it
 *   doesn't quietly resume on the next predicate-true frame. This makes
 *   Conditional behave as a true guard — preconditions are continuously
 *   re-checked, not just at branch entry.
 *
 * Determinism contract
 *
 *   The predicate is the only side-input beyond the child's own state.
 *   Implementers must ensure the predicate is a pure function of
 *   `context` (which already carries the seeded Rng / world state in the
 *   broader engine). Conditional itself adds no internal randomness.
 */

import {
  DecoratorNode,
  NodeStatus,
  type IBehaviorNode,
} from '../Node';

/**
 * Predicate signature evaluated each tick. Must be a pure function of
 * `context` for determinism — do not read from `Math.random()` or
 * unseeded clocks.
 */
export type ConditionalPredicate<TContext> = (context: TContext) => boolean;

/** Construction options for {@link ConditionalNode}. */
export interface ConditionalOptions<TContext> {
  /** Predicate evaluated each tick to gate the child. */
  readonly predicate: ConditionalPredicate<TContext>;
  /**
   * Status returned when the predicate is false. Default `Failure`,
   * which is the right choice for "guarded branch under a Selector".
   * Override to `Success` for "skip cleanly" semantics.
   */
  readonly whenFalse?: NodeStatus;
}

/**
 * Conditional: gates the wrapped child behind a per-tick predicate.
 *
 * @typeParam TContext User-defined context shape, forwarded to both the
 *                     predicate and the wrapped child.
 */
export class ConditionalNode<TContext> extends DecoratorNode<TContext> {
  private readonly predicate: ConditionalPredicate<TContext>;
  private readonly whenFalse: NodeStatus;
  /**
   * Tracks whether the child was left in a `Running` state by the last
   * tick. Used so we can `reset()` it if the predicate flips to false
   * while a partial action is still in flight.
   */
  private childRunning = false;

  /**
   * @param child Wrapped child node. Only ticked while the predicate
   *              returns true.
   * @param options `predicate` (required) and optional `whenFalse`
   *                fallback status.
   * @param name Optional debug label.
   */
  constructor(
    child: IBehaviorNode<TContext>,
    options: ConditionalOptions<TContext>,
    name?: string,
  ) {
    super(child, name);
    this.predicate = options.predicate;
    this.whenFalse = options.whenFalse ?? NodeStatus.Failure;
  }

  protected override onTick(context: TContext): NodeStatus {
    if (this.predicate(context)) {
      const status = this.child.tick(context);
      this.childRunning = status === NodeStatus.Running;
      return status;
    }

    // Predicate failed — abort any in-progress child work so it doesn't
    // resume mid-action the next time the gate opens.
    if (this.childRunning) {
      this.child.reset();
      this.childRunning = false;
    }
    return this.whenFalse;
  }

  /**
   * Cascade reset into the child (via super) and clear our running-flag
   * so the next entry re-evaluates the predicate from scratch.
   */
  override reset(): void {
    super.reset();
    this.childRunning = false;
  }

  /** Inspector — the configured fallback status when predicate is false. */
  getWhenFalse(): NodeStatus {
    return this.whenFalse;
  }
}
