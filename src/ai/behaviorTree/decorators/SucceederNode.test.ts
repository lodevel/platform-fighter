import { describe, it, expect } from 'vitest';
import { LeafNode, NodeStatus, type IBehaviorNode } from '../Node';
import { SucceederNode } from './SucceederNode';

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

describe('SucceederNode', () => {
  it('passes Success through as Success', () => {
    const succ = new SucceederNode(new StubLeaf(NodeStatus.Success));
    expect(succ.tick({ ticks: 0 })).toBe(NodeStatus.Success);
  });

  it('rewrites Failure to Success', () => {
    const succ = new SucceederNode(new StubLeaf(NodeStatus.Failure));
    expect(succ.tick({ ticks: 0 })).toBe(NodeStatus.Success);
  });

  it('passes Running through unchanged', () => {
    const succ = new SucceederNode(new StubLeaf(NodeStatus.Running));
    expect(succ.tick({ ticks: 0 })).toBe(NodeStatus.Running);
  });

  it('ticks the child exactly once per tick', () => {
    const child = new StubLeaf(NodeStatus.Failure);
    const succ = new SucceederNode(child);
    succ.tick({ ticks: 0 });
    succ.tick({ ticks: 0 });
    succ.tick({ ticks: 0 });
    expect(child.ticks).toBe(3);
  });

  it('forwards the same context reference to the child', () => {
    const child = new StubLeaf(NodeStatus.Failure);
    const succ = new SucceederNode(child);
    const ctx: Ctx = { ticks: 0 };
    succ.tick(ctx);
    expect(ctx.ticks).toBe(1);
  });

  it('cascades reset() into the child', () => {
    const child = new StubLeaf(NodeStatus.Failure);
    const succ = new SucceederNode(child);
    succ.tick({ ticks: 0 });
    succ.reset();
    expect(child.resets).toBe(1);
  });

  it('records its own (post-rewrite) lastStatus on the base class', () => {
    const succ = new SucceederNode(new StubLeaf(NodeStatus.Failure));
    succ.tick({ ticks: 0 });
    expect(succ.getLastStatus()).toBe(NodeStatus.Success);
  });

  it('records Running lastStatus when the child is still working', () => {
    const succ = new SucceederNode(new StubLeaf(NodeStatus.Running));
    succ.tick({ ticks: 0 });
    expect(succ.getLastStatus()).toBe(NodeStatus.Running);
  });

  it('accepts plain IBehaviorNode test doubles', () => {
    let ticked = 0;
    let reset = 0;
    const stub: IBehaviorNode<Ctx> = {
      tick: () => {
        ticked += 1;
        return NodeStatus.Failure;
      },
      reset: () => {
        reset += 1;
      },
    };
    const succ = new SucceederNode<Ctx>(stub);
    expect(succ.tick({ ticks: 0 })).toBe(NodeStatus.Success);
    expect(ticked).toBe(1);
    succ.reset();
    expect(reset).toBe(1);
  });

  it('produces deterministic results across identical contexts', () => {
    const a = new SucceederNode(new StubLeaf(NodeStatus.Failure));
    const b = new SucceederNode(new StubLeaf(NodeStatus.Failure));
    const ctxA: Ctx = { ticks: 0 };
    const ctxB: Ctx = { ticks: 0 };
    for (let i = 0; i < 10; i++) {
      expect(a.tick(ctxA)).toBe(b.tick(ctxB));
    }
    expect(ctxA).toEqual(ctxB);
  });

  it('collapses a mixed Success/Failure stream to all-Success', () => {
    const statuses: NodeStatus[] = [
      NodeStatus.Success,
      NodeStatus.Failure,
      NodeStatus.Failure,
      NodeStatus.Success,
      NodeStatus.Failure,
    ];
    for (const status of statuses) {
      const succ = new SucceederNode(new StubLeaf(status));
      expect(succ.tick({ ticks: 0 })).toBe(NodeStatus.Success);
    }
  });

  it('still tunnels Running even after a previous Failure → Success rewrite', () => {
    // A leaf that returns Failure, then Running, then Failure again. The
    // Succeeder should rewrite the Failures but leave the Running visible.
    class Scripted extends LeafNode<Ctx> {
      private cursor = 0;
      private readonly script: ReadonlyArray<NodeStatus> = [
        NodeStatus.Failure,
        NodeStatus.Running,
        NodeStatus.Failure,
      ];
      protected override onTick(): NodeStatus {
        const s = this.script[this.cursor] ?? NodeStatus.Failure;
        this.cursor += 1;
        return s;
      }
    }
    const succ = new SucceederNode(new Scripted());
    expect(succ.tick({ ticks: 0 })).toBe(NodeStatus.Success);
    expect(succ.tick({ ticks: 0 })).toBe(NodeStatus.Running);
    expect(succ.tick({ ticks: 0 })).toBe(NodeStatus.Success);
  });

  it('Inverter ∘ Succeeder always yields Failure on terminal results', () => {
    // Property: an Inverter wrapping a Succeeder must report Failure for
    // any terminal child result, since the inner Succeeder collapses to
    // Success and the outer Inverter flips that to Failure.
    // (We can't import Inverter here without circular intent — model it
    // as a hand-rolled inverter to keep this test focused on Succeeder.)
    const innerStatuses = [NodeStatus.Success, NodeStatus.Failure] as const;
    for (const status of innerStatuses) {
      const succ = new SucceederNode(new StubLeaf(status));
      const result = succ.tick({ ticks: 0 });
      const inverted =
        result === NodeStatus.Success
          ? NodeStatus.Failure
          : result === NodeStatus.Failure
            ? NodeStatus.Success
            : NodeStatus.Running;
      expect(inverted).toBe(NodeStatus.Failure);
    }
  });

  it('does not mutate the wrapped child between ticks', () => {
    const child = new StubLeaf(NodeStatus.Failure);
    const succ = new SucceederNode(child);
    expect(child.resets).toBe(0);
    succ.tick({ ticks: 0 });
    succ.tick({ ticks: 0 });
    // Succeeder must NOT call reset() on its child between ticks — only
    // on its own reset(). Otherwise a Running child would lose progress.
    expect(child.resets).toBe(0);
  });
});
