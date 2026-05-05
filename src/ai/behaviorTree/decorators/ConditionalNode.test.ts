import { describe, it, expect } from 'vitest';
import { LeafNode, NodeStatus } from '../Node';
import { ConditionalNode } from './ConditionalNode';

interface Ctx {
  ticks: number;
  flag: boolean;
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

describe('ConditionalNode', () => {
  describe('predicate gating', () => {
    it('ticks the child and forwards its status when predicate is true', () => {
      const child = new StubLeaf(NodeStatus.Success);
      const cond = new ConditionalNode(child, { predicate: () => true });
      expect(cond.tick({ ticks: 0, flag: true })).toBe(NodeStatus.Success);
      expect(child.ticks).toBe(1);
    });

    it('returns Failure (default) without ticking the child when predicate is false', () => {
      const child = new StubLeaf(NodeStatus.Success);
      const cond = new ConditionalNode(child, { predicate: () => false });
      expect(cond.tick({ ticks: 0, flag: false })).toBe(NodeStatus.Failure);
      expect(child.ticks).toBe(0);
    });

    it('returns the configured whenFalse status (Success) when predicate is false', () => {
      const child = new StubLeaf(NodeStatus.Success);
      const cond = new ConditionalNode(child, {
        predicate: () => false,
        whenFalse: NodeStatus.Success,
      });
      expect(cond.tick({ ticks: 0, flag: false })).toBe(NodeStatus.Success);
      expect(child.ticks).toBe(0);
    });

    it('passes the context through to the predicate', () => {
      const child = new StubLeaf(NodeStatus.Success);
      const cond = new ConditionalNode(child, {
        predicate: (ctx: Ctx) => ctx.flag,
      });
      expect(cond.tick({ ticks: 0, flag: true })).toBe(NodeStatus.Success);
      expect(cond.tick({ ticks: 0, flag: false })).toBe(NodeStatus.Failure);
    });

    it('forwards Running through to the caller when predicate is true', () => {
      const child = new StubLeaf(NodeStatus.Running);
      const cond = new ConditionalNode(child, { predicate: () => true });
      expect(cond.tick({ ticks: 0, flag: true })).toBe(NodeStatus.Running);
    });

    it('re-evaluates the predicate on every tick (guard semantics)', () => {
      const child = new StubLeaf(NodeStatus.Success);
      const cond = new ConditionalNode(child, {
        predicate: (ctx: Ctx) => ctx.flag,
      });
      const ctx: Ctx = { ticks: 0, flag: true };

      expect(cond.tick(ctx)).toBe(NodeStatus.Success);
      expect(child.ticks).toBe(1);
      ctx.flag = false;
      expect(cond.tick(ctx)).toBe(NodeStatus.Failure);
      expect(child.ticks).toBe(1); // unchanged
      ctx.flag = true;
      expect(cond.tick(ctx)).toBe(NodeStatus.Success);
      expect(child.ticks).toBe(2);
    });
  });

  describe('aborting a running child', () => {
    it('resets the child if predicate flips to false while it was running', () => {
      const child = new StubLeaf(NodeStatus.Running);
      const cond = new ConditionalNode(child, {
        predicate: (ctx: Ctx) => ctx.flag,
      });
      const ctx: Ctx = { ticks: 0, flag: true };

      expect(cond.tick(ctx)).toBe(NodeStatus.Running);
      expect(child.resets).toBe(0);
      ctx.flag = false;
      expect(cond.tick(ctx)).toBe(NodeStatus.Failure);
      expect(child.resets).toBe(1);
      // A second false tick should NOT re-reset (already aborted).
      expect(cond.tick(ctx)).toBe(NodeStatus.Failure);
      expect(child.resets).toBe(1);
    });

    it('does not reset child when predicate was already false on the prior tick', () => {
      const child = new StubLeaf(NodeStatus.Running);
      const cond = new ConditionalNode(child, { predicate: () => false });
      cond.tick({ ticks: 0, flag: false });
      cond.tick({ ticks: 0, flag: false });
      cond.tick({ ticks: 0, flag: false });
      // Child was never ticked → never running → never needed reset.
      expect(child.resets).toBe(0);
    });

    it('does not reset child when predicate stays true (child still running)', () => {
      const child = new StubLeaf(NodeStatus.Running);
      const cond = new ConditionalNode(child, { predicate: () => true });
      cond.tick({ ticks: 0, flag: true });
      cond.tick({ ticks: 0, flag: true });
      expect(child.resets).toBe(0);
    });
  });

  describe('reset', () => {
    it('cascades reset into the child via DecoratorNode', () => {
      const child = new StubLeaf(NodeStatus.Success);
      const cond = new ConditionalNode(child, { predicate: () => true });
      cond.tick({ ticks: 0, flag: true });
      cond.reset();
      expect(child.resets).toBe(1);
    });

    it('clears the internal childRunning flag so post-reset abort logic re-arms', () => {
      const child = new StubLeaf(NodeStatus.Running);
      const cond = new ConditionalNode(child, {
        predicate: (ctx: Ctx) => ctx.flag,
      });
      const ctx: Ctx = { ticks: 0, flag: true };
      cond.tick(ctx); // child returns Running
      cond.reset(); // explicit reset (also resets child once)
      // Predicate flips false — but we just reset, so no extra abort.
      ctx.flag = false;
      cond.tick(ctx);
      expect(child.resets).toBe(1); // only the explicit reset, no post-reset abort
    });
  });

  describe('construction', () => {
    it('exposes the configured whenFalse for inspection', () => {
      const cond = new ConditionalNode(new StubLeaf(NodeStatus.Success), {
        predicate: () => true,
        whenFalse: NodeStatus.Success,
      });
      expect(cond.getWhenFalse()).toBe(NodeStatus.Success);
    });

    it('defaults whenFalse to Failure', () => {
      const cond = new ConditionalNode(new StubLeaf(NodeStatus.Success), {
        predicate: () => true,
      });
      expect(cond.getWhenFalse()).toBe(NodeStatus.Failure);
    });
  });

  describe('determinism', () => {
    it('produces identical results across identical contexts', () => {
      const buildTree = (): ConditionalNode<Ctx> =>
        new ConditionalNode(new StubLeaf(NodeStatus.Success), {
          predicate: (ctx: Ctx) => ctx.flag,
        });
      const a = buildTree();
      const b = buildTree();
      const ctxA: Ctx = { ticks: 0, flag: true };
      const ctxB: Ctx = { ticks: 0, flag: true };
      for (let i = 0; i < 5; i++) {
        ctxA.flag = i % 2 === 0;
        ctxB.flag = i % 2 === 0;
        expect(a.tick(ctxA)).toBe(b.tick(ctxB));
      }
      expect(ctxA.ticks).toBe(ctxB.ticks);
    });
  });
});
