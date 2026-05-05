import { describe, it, expect } from 'vitest';
import { LeafNode, NodeStatus } from '../Node';
import { ParallelNode } from './ParallelNode';

// ────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ────────────────────────────────────────────────────────────────────────────

interface Ctx {
  ticks: number;
}

class StubLeaf extends LeafNode<Ctx> {
  public ticks = 0;
  public resets = 0;
  constructor(private readonly status: NodeStatus) {
    super();
  }
  protected override onTick(ctx: Ctx): NodeStatus {
    ctx.ticks += 1;
    this.ticks += 1;
    return this.status;
  }
  override reset(): void {
    super.reset();
    this.resets += 1;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('ParallelNode', () => {
  describe('default policies (success=all, failure=one)', () => {
    it('always ticks every child regardless of intermediate results', () => {
      const a = new StubLeaf(NodeStatus.Success);
      const b = new StubLeaf(NodeStatus.Failure);
      const c = new StubLeaf(NodeStatus.Running);
      const par = new ParallelNode([a, b, c]);
      par.tick({ ticks: 0 });
      expect(a.ticks).toBe(1);
      expect(b.ticks).toBe(1);
      expect(c.ticks).toBe(1);
    });

    it('returns Failure as soon as any child fails (failurePolicy="one")', () => {
      const a = new StubLeaf(NodeStatus.Success);
      const b = new StubLeaf(NodeStatus.Failure);
      const c = new StubLeaf(NodeStatus.Running);
      const par = new ParallelNode([a, b, c]);
      expect(par.tick({ ticks: 0 })).toBe(NodeStatus.Failure);
    });

    it('returns Success only when every child succeeds (successPolicy="all")', () => {
      const a = new StubLeaf(NodeStatus.Success);
      const b = new StubLeaf(NodeStatus.Success);
      const c = new StubLeaf(NodeStatus.Success);
      const par = new ParallelNode([a, b, c]);
      expect(par.tick({ ticks: 0 })).toBe(NodeStatus.Success);
    });

    it('returns Running when no policy is satisfied yet', () => {
      const a = new StubLeaf(NodeStatus.Success);
      const b = new StubLeaf(NodeStatus.Running);
      const c = new StubLeaf(NodeStatus.Success);
      const par = new ParallelNode([a, b, c]);
      expect(par.tick({ ticks: 0 })).toBe(NodeStatus.Running);
    });
  });

  describe('successPolicy="one"', () => {
    it('returns Success as soon as any child succeeds', () => {
      const a = new StubLeaf(NodeStatus.Running);
      const b = new StubLeaf(NodeStatus.Success);
      const c = new StubLeaf(NodeStatus.Running);
      const par = new ParallelNode([a, b, c], { successPolicy: 'one' });
      expect(par.tick({ ticks: 0 })).toBe(NodeStatus.Success);
    });
  });

  describe('failurePolicy="all"', () => {
    it('returns Running as long as at least one child has not failed', () => {
      const a = new StubLeaf(NodeStatus.Failure);
      const b = new StubLeaf(NodeStatus.Failure);
      const c = new StubLeaf(NodeStatus.Running);
      const par = new ParallelNode([a, b, c], { failurePolicy: 'all' });
      expect(par.tick({ ticks: 0 })).toBe(NodeStatus.Running);
    });

    it('returns Failure only when every child fails', () => {
      const a = new StubLeaf(NodeStatus.Failure);
      const b = new StubLeaf(NodeStatus.Failure);
      const c = new StubLeaf(NodeStatus.Failure);
      const par = new ParallelNode([a, b, c], { failurePolicy: 'all' });
      expect(par.tick({ ticks: 0 })).toBe(NodeStatus.Failure);
    });
  });

  describe('conflict resolution', () => {
    it('lets Failure win when both success and failure policies trigger together', () => {
      // Policies: succeed-on-one, fail-on-one. With 1 success + 1 failure
      // both fire on the same tick. Failure should take precedence.
      const a = new StubLeaf(NodeStatus.Success);
      const b = new StubLeaf(NodeStatus.Failure);
      const par = new ParallelNode([a, b], {
        successPolicy: 'one',
        failurePolicy: 'one',
      });
      expect(par.tick({ ticks: 0 })).toBe(NodeStatus.Failure);
    });
  });

  describe('aborting still-running children', () => {
    it('resets running children when Parallel terminates with Failure', () => {
      const succeed = new StubLeaf(NodeStatus.Success);
      const fail = new StubLeaf(NodeStatus.Failure);
      const running = new StubLeaf(NodeStatus.Running);
      const par = new ParallelNode([succeed, fail, running]);

      expect(par.tick({ ticks: 0 })).toBe(NodeStatus.Failure);
      // Only the running child needs aborting; terminal children do not.
      expect(running.resets).toBe(1);
      expect(succeed.resets).toBe(0);
      expect(fail.resets).toBe(0);
    });

    it('resets running children when Parallel terminates with Success', () => {
      const a = new StubLeaf(NodeStatus.Success);
      const stillRunning = new StubLeaf(NodeStatus.Running);
      const par = new ParallelNode([a, stillRunning], {
        successPolicy: 'one',
      });
      expect(par.tick({ ticks: 0 })).toBe(NodeStatus.Success);
      expect(stillRunning.resets).toBe(1);
    });

    it('does not reset anything when Parallel itself returns Running', () => {
      const a = new StubLeaf(NodeStatus.Running);
      const b = new StubLeaf(NodeStatus.Running);
      const par = new ParallelNode([a, b]);
      par.tick({ ticks: 0 });
      expect(a.resets).toBe(0);
      expect(b.resets).toBe(0);
    });
  });

  describe('cascade reset', () => {
    it('resets every child when reset() is called', () => {
      const a = new StubLeaf(NodeStatus.Running);
      const b = new StubLeaf(NodeStatus.Success);
      const par = new ParallelNode([a, b]);
      par.tick({ ticks: 0 });
      par.reset();
      expect(a.resets).toBeGreaterThanOrEqual(1);
      expect(b.resets).toBeGreaterThanOrEqual(1);
    });
  });

  describe('construction', () => {
    it('rejects zero children (inherited contract)', () => {
      expect(() => new ParallelNode<Ctx>([])).toThrow(/at least one child/i);
    });

    it('exposes the configured policies for inspection', () => {
      const par = new ParallelNode<Ctx>([new StubLeaf(NodeStatus.Success)], {
        successPolicy: 'one',
        failurePolicy: 'all',
      });
      expect(par.getSuccessPolicy()).toBe('one');
      expect(par.getFailurePolicy()).toBe('all');
    });

    it('defaults to success="all" and failure="one" when options are omitted', () => {
      const par = new ParallelNode<Ctx>([new StubLeaf(NodeStatus.Success)]);
      expect(par.getSuccessPolicy()).toBe('all');
      expect(par.getFailurePolicy()).toBe('one');
    });
  });

  describe('determinism', () => {
    it('ticks children in the same order across identical contexts', () => {
      const order: string[] = [];
      class TaggedLeaf extends LeafNode<Ctx> {
        constructor(private readonly tag: string) {
          super();
        }
        protected override onTick(): NodeStatus {
          order.push(this.tag);
          return NodeStatus.Success;
        }
      }
      const par = new ParallelNode([
        new TaggedLeaf('a'),
        new TaggedLeaf('b'),
        new TaggedLeaf('c'),
      ]);
      par.tick({ ticks: 0 });
      par.tick({ ticks: 0 });
      expect(order).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
    });
  });
});
