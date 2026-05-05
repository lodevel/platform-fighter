import { describe, it, expect } from 'vitest';
import { LeafNode, NodeStatus, type IBehaviorNode } from '../Node';
import { InverterNode } from './InverterNode';

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

describe('InverterNode', () => {
  it('flips Success → Failure', () => {
    const inv = new InverterNode(new StubLeaf(NodeStatus.Success));
    expect(inv.tick({ ticks: 0 })).toBe(NodeStatus.Failure);
  });

  it('flips Failure → Success', () => {
    const inv = new InverterNode(new StubLeaf(NodeStatus.Failure));
    expect(inv.tick({ ticks: 0 })).toBe(NodeStatus.Success);
  });

  it('passes Running through unchanged', () => {
    const inv = new InverterNode(new StubLeaf(NodeStatus.Running));
    expect(inv.tick({ ticks: 0 })).toBe(NodeStatus.Running);
  });

  it('ticks the child exactly once per tick', () => {
    const child = new StubLeaf(NodeStatus.Success);
    const inv = new InverterNode(child);
    inv.tick({ ticks: 0 });
    inv.tick({ ticks: 0 });
    inv.tick({ ticks: 0 });
    expect(child.ticks).toBe(3);
  });

  it('forwards the same context reference to the child', () => {
    const child = new StubLeaf(NodeStatus.Success);
    const inv = new InverterNode(child);
    const ctx: Ctx = { ticks: 0 };
    inv.tick(ctx);
    expect(ctx.ticks).toBe(1);
  });

  it('cascades reset() into the child', () => {
    const child = new StubLeaf(NodeStatus.Success);
    const inv = new InverterNode(child);
    inv.tick({ ticks: 0 });
    inv.reset();
    expect(child.resets).toBe(1);
  });

  it('records its own (post-inversion) lastStatus on the base class', () => {
    const inv = new InverterNode(new StubLeaf(NodeStatus.Success));
    inv.tick({ ticks: 0 });
    expect(inv.getLastStatus()).toBe(NodeStatus.Failure);
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
    const inv = new InverterNode<Ctx>(stub);
    expect(inv.tick({ ticks: 0 })).toBe(NodeStatus.Success);
    expect(ticked).toBe(1);
    inv.reset();
    expect(reset).toBe(1);
  });

  it('produces deterministic results across identical contexts', () => {
    const a = new InverterNode(new StubLeaf(NodeStatus.Success));
    const b = new InverterNode(new StubLeaf(NodeStatus.Success));
    const ctxA: Ctx = { ticks: 0 };
    const ctxB: Ctx = { ticks: 0 };
    for (let i = 0; i < 10; i++) {
      expect(a.tick(ctxA)).toBe(b.tick(ctxB));
    }
    expect(ctxA).toEqual(ctxB);
  });

  it('double-inversion is a no-op (Inverter ∘ Inverter = identity)', () => {
    const innerStatuses = [
      NodeStatus.Success,
      NodeStatus.Failure,
      NodeStatus.Running,
    ] as const;
    for (const status of innerStatuses) {
      const doubleInv = new InverterNode(
        new InverterNode(new StubLeaf(status)),
      );
      expect(doubleInv.tick({ ticks: 0 })).toBe(status);
    }
  });
});
