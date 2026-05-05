/**
 * BehaviorTree — runner / orchestrator for a behavior tree.
 *
 * The composite, decorator, and (forthcoming) leaf nodes form a tree of
 * pure objects whose only API is `tick(context)`. Something has to drive
 * those ticks once per simulation frame, hand the nodes a coherent
 * working memory, and clean state up between matches and replay scrubs.
 * That something is `BehaviorTree`.
 *
 * Responsibilities
 *
 *   1. Tick the root node — exactly once per call to `tick()`. The root
 *      may be any `IBehaviorNode<TContext>`; this class makes no
 *      assumptions about the tree shape beneath it.
 *
 *   2. Manage the {@link Blackboard} lifecycle — own a single typed
 *      Blackboard for the whole controller, expose it via
 *      `getBlackboard()` so consumers can thread it into their tick
 *      context, and re-seed / clear it on `reset()` according to the
 *      caller's preference. The Blackboard is the standard pattern by
 *      which sibling nodes coordinate (perception writes
 *      `currentTarget`, locomotion reads it) and the runner is the
 *      natural owner of its lifetime.
 *
 *   3. Expose tick / status bookkeeping — every tick increments
 *      `tickCount` and stores `lastStatus`. Hard-tier AI controllers
 *      use these for diagnostics, throttling, and replay-snapshot
 *      checksums; debug overlays use them to render "current frame /
 *      result" without re-ticking the tree.
 *
 *   4. Cascade reset cleanly — `reset()` walks the root (which itself
 *      cascades into every composite/decorator child), clears the tick
 *      counter and last status, and optionally re-seeds the
 *      Blackboard to its initial contents. A replay scrub or match
 *      restart can therefore restore the controller to a pristine
 *      starting condition with a single call.
 *
 * Determinism contract
 *
 *   The runner introduces no extra randomness. It never reads
 *   `Math.random()`, never queries wall-clock time, and never mutates
 *   user-supplied state. Two `BehaviorTree`s constructed identically
 *   and ticked with identical contexts produce identical status
 *   sequences and identical Blackboard contents — a property the
 *   replay system relies on to verify drift-free simulation.
 *
 * Typical use from a Hard-tier AI controller
 *
 * ```ts
 * interface BotSchema {
 *   currentTargetId: number;
 *   isGrounded: boolean;
 * }
 *
 * interface BotContext extends BehaviorTreeContext<BotSchema> {
 *   readonly rng: Rng;
 *   readonly world: WorldSnapshot;
 *   readonly out: ActionWriter;
 * }
 *
 * const tree = new BehaviorTree<BotContext, BotSchema>(rootNode, {
 *   name: 'hard-bot',
 *   initialBlackboard: { isGrounded: false } satisfies Partial<BotSchema>,
 * });
 *
 * function onAiFrame(rng: Rng, world: WorldSnapshot, out: ActionWriter): void {
 *   tree.tick({
 *     blackboard: tree.getBlackboard(),
 *     tickIndex: tree.getTickCount(),
 *     rng,
 *     world,
 *     out,
 *   });
 * }
 *
 * // Match restart / replay scrub.
 * tree.reset();
 * ```
 */

import { Blackboard, type BlackboardSchema, type IBlackboard } from './Blackboard';
import { type IBehaviorNode, type NodeStatus } from './Node';

/**
 * Recommended shape for the per-tick context threaded through a
 * `BehaviorTree`. Consumers are free to extend it with their own fields
 * (RNG, world snapshot, action writer, …) — the runner does not consume
 * any of these properties itself, it merely promises to forward the
 * caller's context object verbatim to the root node.
 *
 * Two fields are conventional:
 *
 *   - `blackboard` — the runner's owned `Blackboard`, made available to
 *     leaves so a perception node can write `currentTarget` and a
 *     locomotion node can read it later in the same tick.
 *   - `tickIndex` — monotonically increasing tick counter. Useful for
 *     leaves that want frame-relative timing without reading the
 *     wall-clock (e.g. "fire smash on every 30th tick").
 *
 * @typeParam TSchema Optional Blackboard schema. Defaults to the loose
 *                    `Record<string, unknown>` shape so consumers without
 *                    a stable schema can still type their context.
 */
export interface BehaviorTreeContext<TSchema extends object = BlackboardSchema> {
  /** Shared scratchpad for inter-node coordination. */
  readonly blackboard: IBlackboard<TSchema>;
  /** Monotonic tick counter — `0` on the very first tick after construction or `reset()`. */
  readonly tickIndex: number;
}

/** Construction options for {@link BehaviorTree}. */
export interface BehaviorTreeOptions<TSchema extends object = BlackboardSchema> {
  /** Optional human-readable label, surfaced in error messages and debug dumps. */
  readonly name?: string;
  /**
   * Seed entries for the runner-owned Blackboard. Re-applied on every
   * `reset()` when {@link resetBlackboard} is `true` (the default).
   *
   * Stored by reference — callers that want to mutate the seed object
   * after construction should pass a defensive copy.
   */
  readonly initialBlackboard?: Partial<TSchema>;
  /**
   * Whether `reset()` should clear-and-reseed the Blackboard.
   *
   *   - `true` (default) — every `reset()` returns the Blackboard to
   *     exactly the contents it had immediately after construction.
   *     This is the right choice for match restart, replay scrub, and
   *     any other "start fresh" boundary.
   *   - `false` — `reset()` leaves the Blackboard untouched. Useful for
   *     long-running controllers that want to keep historical context
   *     across logical resets (e.g. learned weights, opponent profile).
   */
  readonly resetBlackboard?: boolean;
}

/**
 * Behavior tree runner — owns the root node, the Blackboard, and the
 * tick lifecycle. See module docstring for design rationale.
 *
 * @typeParam TContext User-defined per-tick context shape. The class
 *                     never inspects fields on the context — it just
 *                     forwards the value to `root.tick(context)` —
 *                     so extending {@link BehaviorTreeContext} is a
 *                     convention, not a requirement. Defaults to the
 *                     conventional shape so simple trees can omit the
 *                     parameter.
 * @typeParam TSchema  Optional Blackboard schema. Defaults to the
 *                     permissive `Record<string, unknown>` shape.
 */
export class BehaviorTree<
  TContext = BehaviorTreeContext,
  TSchema extends object = BlackboardSchema,
> {
  /** Optional debug label — informational only, never read by the runtime. */
  public readonly name: string | undefined;

  /** Root of the tree. Stored as the `IBehaviorNode` interface so test
   *  doubles can be substituted without extending the full base-class
   *  chain. The runner never mutates this reference after construction. */
  private readonly root: IBehaviorNode<TContext>;

  /** Runner-owned scratchpad. Concrete `Blackboard` (not the interface)
   *  because we need `clear()` and re-seed access on `reset()`. */
  private readonly blackboard: Blackboard<TSchema>;

  /** Snapshot of the constructor-supplied seed entries, retained verbatim
   *  so `reset()` can reapply them. `undefined` when no seed was given,
   *  which lets `reset()` skip the reseed pass entirely. */
  private readonly initialBlackboard: Partial<TSchema> | undefined;

  /** Whether `reset()` should clear-and-reseed the Blackboard. */
  private readonly shouldResetBlackboard: boolean;

  /** Monotonic tick counter. Cleared by `reset()`. */
  private tickCount = 0;

  /** Status of the most recent `tick()` call, or `null` before the first. */
  private lastStatus: NodeStatus | null = null;

  /**
   * @param root Root node of the tree. Ticked once per call to `tick()`.
   * @param options Optional configuration — see {@link BehaviorTreeOptions}.
   */
  constructor(
    root: IBehaviorNode<TContext>,
    options: BehaviorTreeOptions<TSchema> = {},
  ) {
    this.root = root;
    this.name = options.name;
    this.initialBlackboard = options.initialBlackboard;
    this.shouldResetBlackboard = options.resetBlackboard ?? true;
    // Construct the Blackboard once; mutate via clear()+reseed on reset.
    this.blackboard = new Blackboard<TSchema>(options.initialBlackboard);
  }

  /**
   * Advance the tree by one tick.
   *
   * Forwards `context` verbatim to the root and records the result so
   * `getLastStatus()` and `getTickCount()` stay coherent. The runner
   * never inspects fields on `context` — leaves and decorators read
   * what they need (Blackboard, RNG, world snapshot, …) directly.
   *
   * Determinism note: identical `context` values across two runners
   * configured identically yield identical `NodeStatus` results.
   */
  tick(context: TContext): NodeStatus {
    const status = this.root.tick(context);
    this.lastStatus = status;
    // Increment after the tick so the *first* tick sees `tickIndex === 0`
    // when callers thread `getTickCount()` into their context. This
    // matches the conventional "current tick number" interpretation.
    this.tickCount += 1;
    return status;
  }

  /**
   * Restore the tree to its post-construction state.
   *
   *   - Cascades `reset()` into the root (which in turn resets every
   *     composite and decorator beneath it).
   *   - Clears the tick counter and last status.
   *   - When {@link BehaviorTreeOptions.resetBlackboard} is `true`
   *     (the default), clears the Blackboard and re-applies any
   *     initial seed entries.
   *
   * Idempotent — calling `reset()` twice in a row is indistinguishable
   * from calling it once.
   */
  reset(): void {
    this.root.reset();
    this.tickCount = 0;
    this.lastStatus = null;
    if (this.shouldResetBlackboard) {
      this.blackboard.clear();
      if (this.initialBlackboard !== undefined) {
        // `Object.entries` walks own enumerable keys in insertion order,
        // matching the determinism contract of the Blackboard itself.
        for (const [key, value] of Object.entries(this.initialBlackboard)) {
          // Cast at the boundary: `Object.entries` widens to
          // `[string, unknown]`, but we know the seed was typed as
          // `Partial<TSchema>` at construction so the value is
          // assignable to `TSchema[typeof key]`.
          this.blackboard.set(
            key as keyof TSchema & string,
            value as TSchema[keyof TSchema & string],
          );
        }
      }
    }
  }

  /**
   * Direct accessor for the runner-owned Blackboard.
   *
   * The most common use is threading the same Blackboard reference
   * into every tick context so leaves can coordinate. Returned as the
   * `IBlackboard` interface so callers cannot accidentally bypass the
   * runner's lifecycle (e.g. by replacing the underlying map).
   */
  getBlackboard(): IBlackboard<TSchema> {
    return this.blackboard;
  }

  /** Read-only root accessor for tree-walking utilities and debug tooling. */
  getRoot(): IBehaviorNode<TContext> {
    return this.root;
  }

  /**
   * Status of the most recent `tick()` call.
   *
   * Returns `null` before the first tick and immediately after `reset()`,
   * letting consumers distinguish "no work yet" from "last tick was
   * Success/Failure/Running".
   */
  getLastStatus(): NodeStatus | null {
    return this.lastStatus;
  }

  /**
   * Number of `tick()` calls completed since construction or last `reset()`.
   *
   * Conventionally threaded into the per-tick context as `tickIndex`
   * (see {@link BehaviorTreeContext}) so leaves can implement
   * frame-relative timing without reading the wall-clock.
   */
  getTickCount(): number {
    return this.tickCount;
  }
}
