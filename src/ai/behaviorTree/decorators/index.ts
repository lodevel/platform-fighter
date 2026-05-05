/**
 * Decorator nodes — public re-exports.
 *
 * Decorators wrap exactly one child and modify its result or how often
 * it gets ticked. Five primitives live here:
 *
 *   - {@link InverterNode}    — flip Success ↔ Failure (Running tunnels).
 *   - {@link RepeaterNode}    — loop the child a fixed or unbounded number
 *                               of iterations, with optional break flags.
 *   - {@link SucceederNode}   — collapse every terminal child result to
 *                               Success (Running tunnels). The "ignore
 *                               the result" decorator.
 *   - {@link CooldownNode}    — block the child for N frames after a
 *                               triggering result.
 *   - {@link ConditionalNode} — gate the child behind a per-tick predicate.
 *
 * Importers should prefer `import { InverterNode } from '@/ai/behaviorTree'`
 * (re-exported via the parent barrel) over reaching into this folder.
 */
export { InverterNode } from './InverterNode';
export { RepeaterNode } from './RepeaterNode';
export type { RepeaterOptions } from './RepeaterNode';
export { SucceederNode } from './SucceederNode';
export { CooldownNode } from './CooldownNode';
export type { CooldownOptions, CooldownTrigger } from './CooldownNode';
export { ConditionalNode } from './ConditionalNode';
export type {
  ConditionalOptions,
  ConditionalPredicate,
} from './ConditionalNode';
