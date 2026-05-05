import { describe, it, expect } from 'vitest';
import { LeafNode, NodeStatus, type IBehaviorNode } from '../Node';
import { SelectorNode } from './SelectorNode';

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
      NodeStatus.Success;
    this.cursor += 1;
    return status;
  }
  override reset(): void {
    super.reset();
    this.cursor = 0;
    this.resets += 1;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('SelectorNode', () => {
  it('returns Success on the first child that succeeds', () => {
    const a = new StubLeaf(NodeStatus.Failure);
    const b = new StubLeaf(NodeStatus.Success);
    const c = new StubLeaf(NodeStatus.Failure);
    const sel = new SelectorNode([a, b, c]);
    const ctx: Ctx = { ticks: 0 };

    expect(sel.tick(ctx)).toBe(NodeStatus.Success);
    expect(a.ticks).toBe(1);
    expect(b.ticks).toBe(1);
    expect(c.ticks).toBe(0); // short-circuited after b
  });

  it('returns Failure only when every child fails', () => {
    const a = new StubLeaf(NodeStatus.Failure);
    const b = new StubLeaf(NodeStatus.Failure);
    const c = new StubLeaf(NodeStatus.Failure);
    const sel = new SelectorNode([a, b, c]);
    expect(sel.tick({ ticks: 0 })).toBe(NodeStatus.Failure);
    expect(a.ticks).toBe(1);
    expect(b.ticks).toBe(1);
    expect(c.ticks).toBe(1);
  });

  it('returns Running when a child is running and stops ticking siblings', () => {
    const a = new StubLeaf(NodeStatus.Failure);
    const b = new StubLeaf(NodeStatus.Running);
    const c = new StubLeaf(NodeStatus.Success);
    const sel = new SelectorNode([a, b, c]);

    expect(sel.tick({ ticks: 0 })).toBe(NodeStatus.Running);
    expect(c.ticks).toBe(0);
  });

  it('resumes from the running child on the next tick (memoized semantics)', () => {
    const a = new StubLeaf(NodeStatus.Failure);
    const b = new ScriptedLeaf([NodeStatus.Running, NodeStatus.Failure]);
    const c = new StubLeaf(NodeStatus.Success);
    const sel = new SelectorNode([a, b, c]);
    const ctx: Ctx = { ticks: 0 };

    // 1st tick: a → Failure, b → Running. Selector returns Running.
    expect(sel.tick(ctx)).toBe(NodeStatus.Running);
    expect(a.ticks).toBe(1);
    expect(b.ticks).toBe(1);
    expect(c.ticks).toBe(0);
    expect(sel.getCurrentIndex()).toBe(1);

    // 2nd tick: a should NOT be re-ticked. b → Failure, c → Success.
    expect(sel.tick(ctx)).toBe(NodeStatus.Success);
    expect(a.ticks).toBe(1); // unchanged
    expect(b.ticks).toBe(2);
    expect(c.ticks).toBe(1);
    expect(sel.getCurrentIndex()).toBe(0); // reset after Success
  });

  it('resets the resume index after a terminal Failure', () => {
    const a = new StubLeaf(NodeStatus.Failure);
    const b = new ScriptedLeaf([NodeStatus.Running, NodeStatus.Failure]);
    const sel = new SelectorNode([a, b]);
    const ctx: Ctx = { ticks: 0 };

    expect(sel.tick(ctx)).toBe(NodeStatus.Running);
    expect(sel.getCurrentIndex()).toBe(1);
    expect(sel.tick(ctx)).toBe(NodeStatus.Failure);
    expect(sel.getCurrentIndex()).toBe(0);
  });

  it('cascades reset() into all children and clears the resume index', () => {
    const a = new StubLeaf(NodeStatus.Failure);
    const b = new StubLeaf(NodeStatus.Running);
    const sel = new SelectorNode([a, b]);
    sel.tick({ ticks: 0 });
    expect(sel.getCurrentIndex()).toBe(1);

    sel.reset();
    expect(a.resets).toBe(1);
    expect(b.resets).toBe(1);
    expect(sel.getCurrentIndex()).toBe(0);
  });

  it('rejects construction with zero children (inherited contract)', () => {
    expect(() => new SelectorNode<Ctx>([])).toThrow(/at least one child/i);
  });

  it('accepts plain IBehaviorNode test doubles', () => {
    const stub: IBehaviorNode<Ctx> = {
      tick: () => NodeStatus.Success,
      reset: () => {
        /* no-op */
      },
    };
    const sel = new SelectorNode<Ctx>([stub]);
    expect(sel.tick({ ticks: 0 })).toBe(NodeStatus.Success);
  });

  it('produces deterministic results given identical input contexts', () => {
    const buildTree = (): SelectorNode<Ctx> =>
      new SelectorNode([
        new StubLeaf(NodeStatus.Failure),
        new ScriptedLeaf([
          NodeStatus.Running,
          NodeStatus.Running,
          NodeStatus.Success,
        ]),
        new StubLeaf(NodeStatus.Failure),
      ]);

    const a = buildTree();
    const b = buildTree();
    const ctxA: Ctx = { ticks: 0 };
    const ctxB: Ctx = { ticks: 0 };

    for (let i = 0; i < 6; i++) {
      expect(a.tick(ctxA)).toBe(b.tick(ctxB));
    }
    expect(ctxA).toEqual(ctxB);
  });
});
