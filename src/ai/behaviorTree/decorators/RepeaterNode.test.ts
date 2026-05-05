import { describe, it, expect } from 'vitest';
import { LeafNode, NodeStatus } from '../Node';
import { RepeaterNode } from './RepeaterNode';

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

class ScriptedLeaf extends LeafNode<Ctx> {
  public ticks = 0;
  public resets = 0;
  private cursor = 0;
  constructor(private readonly script: ReadonlyArray<NodeStatus>) {
    super();
  }
  protected override onTick(ctx: Ctx): NodeStatus {
    ctx.ticks += 1;
    this.ticks += 1;
    const status =
      this.script[Math.min(this.cursor, this.script.length - 1)] ??
      NodeStatus.Failure;
    this.cursor += 1;
    return status;
  }
  override reset(): void {
    super.reset();
    this.cursor = 0;
    this.resets += 1;
  }
}

/**
 * Leaf with an externally-mutable status. Useful for Repeater tests that
 * need to simulate a child whose result depends on world state (which the
 * Repeater's between-iteration `reset()` should not erase, since the
 * Repeater only resets the child node, not the world).
 */
class SwitchableLeaf extends LeafNode<Ctx> {
  public ticks = 0;
  public resets = 0;
  public status: NodeStatus;
  constructor(initial: NodeStatus) {
    super();
    this.status = initial;
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

describe('RepeaterNode', () => {
  describe('count mode', () => {
    it('returns Success after the configured number of completed iterations', () => {
      const child = new StubLeaf(NodeStatus.Success);
      const rep = new RepeaterNode(child, { count: 3 });
      const ctx: Ctx = { ticks: 0 };

      expect(rep.tick(ctx)).toBe(NodeStatus.Running);
      expect(rep.tick(ctx)).toBe(NodeStatus.Running);
      expect(rep.tick(ctx)).toBe(NodeStatus.Success);
      expect(child.ticks).toBe(3);
      expect(rep.getIterations()).toBe(0); // reset after terminal
    });

    it('resets the child between iterations so it starts fresh each pass', () => {
      const child = new StubLeaf(NodeStatus.Success);
      const rep = new RepeaterNode(child, { count: 3 });
      rep.tick({ ticks: 0 });
      rep.tick({ ticks: 0 });
      // After the 1st and 2nd Success the child should have been reset.
      // The 3rd Success terminates the Repeater so no inter-iteration reset.
      expect(child.resets).toBe(2);
    });

    it('treats Running as a non-counting in-progress iteration', () => {
      const child = new ScriptedLeaf([
        NodeStatus.Running,
        NodeStatus.Running,
        NodeStatus.Success,
      ]);
      const rep = new RepeaterNode(child, { count: 1 });
      const ctx: Ctx = { ticks: 0 };

      expect(rep.tick(ctx)).toBe(NodeStatus.Running);
      expect(rep.tick(ctx)).toBe(NodeStatus.Running);
      expect(rep.tick(ctx)).toBe(NodeStatus.Success);
    });

    it('does not break on Failure when breakOnFailure is false (default)', () => {
      const child = new StubLeaf(NodeStatus.Failure);
      const rep = new RepeaterNode(child, { count: 2 });
      const ctx: Ctx = { ticks: 0 };

      expect(rep.tick(ctx)).toBe(NodeStatus.Running);
      expect(rep.tick(ctx)).toBe(NodeStatus.Success); // count reached
    });

    it('count=1 short-circuits to Success on the first terminal', () => {
      const rep = new RepeaterNode(new StubLeaf(NodeStatus.Success), {
        count: 1,
      });
      expect(rep.tick({ ticks: 0 })).toBe(NodeStatus.Success);
    });
  });

  describe('breakOnFailure', () => {
    it('returns Failure as soon as the child fails', () => {
      const child = new SwitchableLeaf(NodeStatus.Success);
      const rep = new RepeaterNode(child, { count: 5, breakOnFailure: true });
      const ctx: Ctx = { ticks: 0 };

      expect(rep.tick(ctx)).toBe(NodeStatus.Running); // iteration 1: Success
      child.status = NodeStatus.Failure;
      expect(rep.tick(ctx)).toBe(NodeStatus.Failure); // iteration 2: break
      expect(rep.getIterations()).toBe(0);
    });

    it('continues looping when breakOnFailure is true but child succeeds', () => {
      const rep = new RepeaterNode(new StubLeaf(NodeStatus.Success), {
        count: 3,
        breakOnFailure: true,
      });
      const ctx: Ctx = { ticks: 0 };
      expect(rep.tick(ctx)).toBe(NodeStatus.Running);
      expect(rep.tick(ctx)).toBe(NodeStatus.Running);
      expect(rep.tick(ctx)).toBe(NodeStatus.Success);
    });
  });

  describe('breakOnSuccess', () => {
    it('returns Success as soon as the child succeeds', () => {
      const child = new SwitchableLeaf(NodeStatus.Failure);
      const rep = new RepeaterNode(child, { count: 5, breakOnSuccess: true });
      const ctx: Ctx = { ticks: 0 };

      expect(rep.tick(ctx)).toBe(NodeStatus.Running); // Failure (no break — only success breaks)
      expect(rep.tick(ctx)).toBe(NodeStatus.Running);
      child.status = NodeStatus.Success;
      expect(rep.tick(ctx)).toBe(NodeStatus.Success); // breaks
      expect(rep.getIterations()).toBe(0);
    });
  });

  describe('forever loop (count omitted)', () => {
    it('never returns terminal when child terminates without break flags', () => {
      const rep = new RepeaterNode(new StubLeaf(NodeStatus.Success));
      const ctx: Ctx = { ticks: 0 };
      for (let i = 0; i < 100; i++) {
        expect(rep.tick(ctx)).toBe(NodeStatus.Running);
      }
    });

    it('still honours breakOnFailure in forever mode', () => {
      const child = new SwitchableLeaf(NodeStatus.Success);
      const rep = new RepeaterNode(child, { breakOnFailure: true });
      const ctx: Ctx = { ticks: 0 };
      expect(rep.tick(ctx)).toBe(NodeStatus.Running);
      expect(rep.tick(ctx)).toBe(NodeStatus.Running);
      child.status = NodeStatus.Failure;
      expect(rep.tick(ctx)).toBe(NodeStatus.Failure);
    });
  });

  describe('reset', () => {
    it('cascades reset into the child and clears iterations', () => {
      const child = new StubLeaf(NodeStatus.Success);
      const rep = new RepeaterNode(child, { count: 5 });
      rep.tick({ ticks: 0 });
      rep.tick({ ticks: 0 });
      expect(rep.getIterations()).toBe(2);
      rep.reset();
      expect(rep.getIterations()).toBe(0);
      // 2 inter-iteration resets + 1 explicit reset.
      expect(child.resets).toBe(3);
    });
  });

  describe('construction', () => {
    it('rejects count < 1', () => {
      expect(
        () =>
          new RepeaterNode(new StubLeaf(NodeStatus.Success), {
            count: 0,
          }),
      ).toThrow(/count >= 1/i);
    });

    it('rejects non-integer count', () => {
      expect(
        () =>
          new RepeaterNode(new StubLeaf(NodeStatus.Success), {
            count: 2.5,
          }),
      ).toThrow(/count >= 1/i);
    });

    it('exposes the configured options for inspection', () => {
      const rep = new RepeaterNode(new StubLeaf(NodeStatus.Success), {
        count: 4,
        breakOnFailure: true,
        breakOnSuccess: false,
      });
      expect(rep.getCount()).toBe(4);
      expect(rep.getBreakOnFailure()).toBe(true);
      expect(rep.getBreakOnSuccess()).toBe(false);
    });

    it('returns undefined count for forever mode', () => {
      const rep = new RepeaterNode(new StubLeaf(NodeStatus.Success));
      expect(rep.getCount()).toBeUndefined();
    });
  });

  describe('determinism', () => {
    it('produces identical loop counts across identical contexts', () => {
      const buildTree = (): RepeaterNode<Ctx> =>
        new RepeaterNode(
          new ScriptedLeaf([
            NodeStatus.Running,
            NodeStatus.Success,
            NodeStatus.Running,
            NodeStatus.Success,
          ]),
          { count: 2 },
        );
      const a = buildTree();
      const b = buildTree();
      const ctxA: Ctx = { ticks: 0 };
      const ctxB: Ctx = { ticks: 0 };
      for (let i = 0; i < 8; i++) {
        expect(a.tick(ctxA)).toBe(b.tick(ctxB));
      }
      expect(ctxA).toEqual(ctxB);
    });
  });
});
