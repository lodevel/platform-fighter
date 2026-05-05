/**
 * Composite nodes — public re-exports.
 *
 * Composites own one or more children and orchestrate them via classic
 * BT semantics. Three primitives live here:
 *
 *   - {@link SequenceNode} — AND: succeeds iff every child succeeds.
 *   - {@link SelectorNode} — OR:  succeeds iff any child succeeds.
 *   - {@link ParallelNode} — Fan-out: ticks every child each frame and
 *                            aggregates results via configurable policy.
 *
 * Importers should prefer `import { SequenceNode } from '@/ai/behaviorTree'`
 * (re-exported via the parent barrel) over reaching into this folder.
 */
export { SequenceNode } from './SequenceNode';
export { SelectorNode } from './SelectorNode';
export { ParallelNode } from './ParallelNode';
export type { ParallelOptions, ParallelPolicy } from './ParallelNode';
