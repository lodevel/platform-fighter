/**
 * Behavior tree foundation — public entry point (AC 170001 Sub-AC 1).
 *
 * The platform fighter's AI controllers are deterministic behavior trees:
 * a tick produces an exact, reproducible action given identical world
 * state and a seeded `Rng`. This file is the single canonical surface for
 * the behavior-tree module — importers reach for
 *
 *     import { BehaviorNode, NodeStatus } from '@/ai/behaviorTree';
 *
 * and never need to know that the implementation is split into focused
 * submodules under `./behaviorTree/`.
 *
 * The split keeps each concrete node type (composites, decorators, the
 * `Blackboard` scratchpad, the `BehaviorTree` runner) growing
 * independently while sharing the foundational primitives defined in
 * `./behaviorTree/Node.ts`. This barrel file pulls those primitives —
 * plus every other public symbol the module surfaces — into one stable
 * import path so downstream code (AI controllers, tests, debug tooling)
 * has a single dependency target.
 *
 * Sub-AC 1 specifically requires the following core abstractions to be
 * reachable through this path:
 *
 *   - `BehaviorNode<TContext>`   abstract base with `tick`/`reset`
 *                                plumbing and `lastStatus` bookkeeping
 *   - `LeafNode<TContext>`       terminal node (action / condition)
 *   - `DecoratorNode<TContext>`  single-child wrapper that transforms
 *                                its child's result
 *   - `CompositeNode<TContext>`  multi-child orchestrator (Sequence,
 *                                Selector, Parallel, …)
 *   - `NodeStatus`               `'success' | 'failure' | 'running'`
 *                                string-literal union plus the frozen
 *                                `{ Success, Failure, Running }`
 *                                convenience constants
 *   - `IBehaviorNode<TContext>`  minimal public interface every node
 *                                implements (lets tests substitute
 *                                stubs without extending the chain)
 *   - `isSuccess` / `isFailure` / `isRunning` / `isTerminal`
 *                                guard helpers for status comparisons
 *
 * String-literal `NodeStatus` (rather than a TypeScript `enum`) was
 * chosen so it serialises cleanly through the replay log and remains
 * friendly to `noUncheckedIndexedAccess` lookups; the `NodeStatus`
 * value object — frozen `{ Success: 'success', Failure: 'failure',
 * Running: 'running' }` — provides the SUCCESS / FAILURE / RUNNING
 * named constants the AC calls for.
 *
 * The remaining re-exports (composites, decorators, Blackboard,
 * BehaviorTree runner) are surfaced here so a single
 * `import … from '@/ai/behaviorTree'` continues to satisfy every
 * existing call site after this file shadows `./behaviorTree/index.ts`
 * in module resolution.
 */

// --- Core primitives (Sub-AC 1) -------------------------------------------
export {
  BehaviorNode,
  CompositeNode,
  DecoratorNode,
  LeafNode,
  NodeStatus,
  isFailure,
  isRunning,
  isSuccess,
  isTerminal,
} from './behaviorTree/Node';
export type { IBehaviorNode } from './behaviorTree/Node';

// --- Typed scratchpad shared across nodes ---------------------------------
export {
  Blackboard,
  BLACKBOARD_SCOPE_SEPARATOR,
} from './behaviorTree/Blackboard';
export type { BlackboardSchema, IBlackboard } from './behaviorTree/Blackboard';

// --- Composite nodes (Sequence / Selector / Parallel) ---------------------
export {
  SequenceNode,
  SelectorNode,
  ParallelNode,
} from './behaviorTree/composites';
export type {
  ParallelOptions,
  ParallelPolicy,
} from './behaviorTree/composites';

// --- Decorator nodes (Inverter / Repeater / Succeeder / Cooldown / Conditional) ---
export {
  InverterNode,
  RepeaterNode,
  SucceederNode,
  CooldownNode,
  ConditionalNode,
} from './behaviorTree/decorators';
export type {
  RepeaterOptions,
  CooldownOptions,
  CooldownTrigger,
  ConditionalOptions,
  ConditionalPredicate,
} from './behaviorTree/decorators';

// --- Tree runner ----------------------------------------------------------
export { BehaviorTree } from './behaviorTree/BehaviorTree';
export type {
  BehaviorTreeContext,
  BehaviorTreeOptions,
} from './behaviorTree/BehaviorTree';
