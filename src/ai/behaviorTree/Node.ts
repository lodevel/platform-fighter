/**
 * Behavior tree foundation — execution status + node base classes.
 *
 * The platform fighter's AI controllers are implemented as deterministic
 * behavior trees: a tick produces an exact, reproducible action given the
 * same world state and seeded Rng. This module defines only the core
 * abstractions that every node type (Sequence, Selector, Inverter, leaf
 * Action / Condition, …) is built on top of.
 *
 * Design goals
 *
 *   1. Determinism — `tick()` is the only side-effecting entry point and
 *      it never reads from `Math.random()`. Concrete leaves must pull from
 *      the seeded Rng carried inside the user-supplied context.
 *
 *   2. Stateless API, frame-stable internal state — composites and
 *      decorators may track which child is currently `Running` between
 *      ticks, but `reset()` must restore them to a "no work in progress"
 *      state so a replay scrub or match restart does not leak prior state.
 *
 *   3. Generic context — every consumer (AI controller, builder validation
 *      probe, debug runner) passes its own `TContext` shape. This file
 *      makes no assumption about gameplay structures so it can sit at the
 *      bottom of the dependency graph.
 *
 *   4. Predictable composition — three abstract base classes mirror the
 *      classic BT taxonomy:
 *
 *        - `LeafNode`       (no children, performs the actual work)
 *        - `DecoratorNode`  (exactly one child, modifies its result)
 *        - `CompositeNode`  (one or more children, sequences / selects)
 *
 * Subsequent sub-ACs build concrete node types (Sequence, Selector,
 * Inverter, Action, Condition, …) on top of these primitives.
 */

/**
 * Result of a single behavior-tree tick.
 *
 * Encoded as a string-literal union (rather than a TypeScript `enum`) so
 * it serialises cleanly through the replay log and remains friendly to
 * `noUncheckedIndexedAccess` lookups.
 */
export type NodeStatus = 'success' | 'failure' | 'running';

/**
 * Convenience constants for `NodeStatus`. Prefer importing these so
 * misspellings surface as compile errors rather than silent failures.
 *
 * The `as const` assertion preserves the literal types so destructured
 * usages (`const { Success } = NodeStatus`) stay assignable to the union.
 */
export const NodeStatus = Object.freeze({
  Success: 'success',
  Failure: 'failure',
  Running: 'running',
} as const) satisfies Record<string, NodeStatus>;

/** True iff `status` is the terminal "done this tick" value `success`. */
export function isSuccess(status: NodeStatus): boolean {
  return status === NodeStatus.Success;
}

/** True iff `status` is the terminal "done this tick" value `failure`. */
export function isFailure(status: NodeStatus): boolean {
  return status === NodeStatus.Failure;
}

/** True iff `status` is the non-terminal "still working" value `running`. */
export function isRunning(status: NodeStatus): boolean {
  return status === NodeStatus.Running;
}

/** True iff `status` is terminal (success or failure — i.e. not running). */
export function isTerminal(status: NodeStatus): boolean {
  return status !== NodeStatus.Running;
}

/**
 * Public interface every behavior tree node must implement.
 *
 * Kept minimal so consumers can swap in test doubles (e.g. a node that
 * always returns `Success`) without dragging the full base-class chain.
 */
export interface IBehaviorNode<TContext> {
  /**
   * Optional human-readable name for debugging and tree visualisation.
   * Composite nodes typically surface this in their own debug output.
   */
  readonly name?: string;

  /**
   * Advance the node by one logical tick under `context`.
   *
   * Implementations MUST be deterministic given identical context and
   * identical prior `tick`/`reset` history. Any randomness must be drawn
   * from a seeded Rng exposed through `context`.
   */
  tick(context: TContext): NodeStatus;

  /**
   * Restore the node (and any children) to a pristine "no work in
   * progress" state. Called on match start, replay scrub, and whenever
   * the tree's owner aborts the current branch.
   */
  reset(): void;
}

/**
 * Abstract foundation shared by every node type.
 *
 * Tracks the last status so debug tooling and parent composites can
 * inspect the most recent result without re-ticking. Subclasses override
 * `onTick` rather than `tick` so the base class can keep `lastStatus`
 * coherent in a single place.
 */
export abstract class BehaviorNode<TContext> implements IBehaviorNode<TContext> {
  /** Most recent status returned by `tick`, or `null` before the first tick. */
  protected lastStatus: NodeStatus | null = null;

  /**
   * @param name Optional debug label. Surfaced in tree dumps and ignored
   *             by the runtime, so keep it short and descriptive.
   */
  constructor(public readonly name?: string) {}

  /**
   * Subclass entry point — performs the actual tick logic and returns
   * the resulting status. Bookkeeping (storing `lastStatus`) is handled
   * by the public `tick` wrapper.
   */
  protected abstract onTick(context: TContext): NodeStatus;

  /**
   * Public tick — wraps `onTick` so every node, regardless of subclass,
   * keeps `lastStatus` in sync. Subclasses that need to interpose extra
   * behaviour (e.g. enter/exit hooks) should override `onTick` and
   * compose the additional logic there.
   */
  tick(context: TContext): NodeStatus {
    const status = this.onTick(context);
    this.lastStatus = status;
    return status;
  }

  /**
   * Default reset clears `lastStatus`. Composites and decorators override
   * to additionally cascade `reset()` into their children.
   */
  reset(): void {
    this.lastStatus = null;
  }

  /** Inspector hook for debug tooling. */
  getLastStatus(): NodeStatus | null {
    return this.lastStatus;
  }
}

/**
 * Terminal node — performs the actual work (an action) or evaluates a
 * predicate (a condition). Has no children by definition.
 *
 * Concrete subclasses live in `ai/behaviorTree/leaves/` and implement
 * `onTick` directly. This class exists primarily as a marker type so
 * tree-walking utilities can distinguish leaves from composites.
 */
export abstract class LeafNode<TContext> extends BehaviorNode<TContext> {
  // Intentionally empty — `BehaviorNode` already supplies the contract.
  // Marker class keeps the taxonomy explicit at the type level.
}

/**
 * Decorator node — wraps exactly one child and conditionally transforms
 * its result (Inverter flips success/failure, Repeater re-ticks, etc.).
 */
export abstract class DecoratorNode<TContext> extends BehaviorNode<TContext> {
  protected readonly child: IBehaviorNode<TContext>;

  /**
   * @param child Wrapped child node. Stored as the `IBehaviorNode`
   *              interface so test doubles can be substituted without
   *              extending the full `BehaviorNode` chain.
   * @param name Optional debug label.
   */
  constructor(child: IBehaviorNode<TContext>, name?: string) {
    super(name);
    this.child = child;
  }

  /**
   * Cascade reset into the wrapped child so nothing leaks across match
   * boundaries or replay scrubs.
   */
  override reset(): void {
    super.reset();
    this.child.reset();
  }
}

/**
 * Composite node — owns one or more children and orchestrates them
 * (Sequence ticks until a child fails, Selector ticks until a child
 * succeeds, Parallel ticks them all, …).
 *
 * Children are stored as a frozen array so concrete subclasses cannot
 * accidentally mutate the structure mid-tick — composites that need to
 * track "currently-running child" should do so via an index field.
 */
export abstract class CompositeNode<TContext> extends BehaviorNode<TContext> {
  protected readonly children: ReadonlyArray<IBehaviorNode<TContext>>;

  /**
   * @param children Ordered child list. Must contain at least one node —
   *                 a composite with no children is almost always a bug
   *                 (it cannot make progress) and is rejected eagerly.
   * @param name Optional debug label.
   */
  constructor(children: ReadonlyArray<IBehaviorNode<TContext>>, name?: string) {
    super(name);
    if (children.length === 0) {
      throw new Error(
        `CompositeNode${name ? ` "${name}"` : ''} requires at least one child`,
      );
    }
    // Defensive copy + freeze so callers cannot mutate the array after
    // construction. The cast keeps the readonly view at the type level.
    this.children = Object.freeze([...children]) as ReadonlyArray<
      IBehaviorNode<TContext>
    >;
  }

  /**
   * Cascade reset into every child. Subclasses that track per-tick state
   * (e.g. "running child index") should override and call `super.reset()`
   * before clearing their own fields.
   */
  override reset(): void {
    super.reset();
    for (const child of this.children) {
      child.reset();
    }
  }

  /** Read-only child accessor for tree-walking / debug tooling. */
  getChildren(): ReadonlyArray<IBehaviorNode<TContext>> {
    return this.children;
  }
}
