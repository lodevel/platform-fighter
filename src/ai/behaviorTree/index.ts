/**
 * Behavior tree module — public re-exports.
 *
 * Surfaces the foundational `Node.ts` primitives, the composite nodes
 * (Sequence, Selector, Parallel), the decorator nodes (Inverter,
 * Repeater, Succeeder, Cooldown, Conditional), the typed `Blackboard`
 * scratchpad, and the `BehaviorTree` runner that orchestrates them.
 * Concrete leaf types are appended here as subsequent sub-ACs land.
 */
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
} from './Node';
export type { IBehaviorNode } from './Node';

export { Blackboard, BLACKBOARD_SCOPE_SEPARATOR } from './Blackboard';
export type { BlackboardSchema, IBlackboard } from './Blackboard';

export { SequenceNode, SelectorNode, ParallelNode } from './composites';
export type { ParallelOptions, ParallelPolicy } from './composites';

export {
  InverterNode,
  RepeaterNode,
  SucceederNode,
  CooldownNode,
  ConditionalNode,
} from './decorators';
export type {
  RepeaterOptions,
  CooldownOptions,
  CooldownTrigger,
  ConditionalOptions,
  ConditionalPredicate,
} from './decorators';

export { BehaviorTree } from './BehaviorTree';
export type {
  BehaviorTreeContext,
  BehaviorTreeOptions,
} from './BehaviorTree';
