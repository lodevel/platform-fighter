import { describe, it, expect } from 'vitest';
import { LeafNode, NodeStatus, type IBehaviorNode } from '../Node';
import { SequenceNode } from './SequenceNode';

// ────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ────────────────────────────────────────────────────────────────────────────

interface Ctx {
  ticks: number;
}

/** Leaf returning a fixed status; counts ticks/resets. */
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

/** Leaf that returns a programmable sequence of statuses on each tick. */
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

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('SequenceNode', () => {
  it('returns Success when every child succeeds', () => {
    const a = new StubLeaf(NodeStatus.Success);
    const b = new StubLeaf(NodeStatus.Success);
    const c = new StubLeaf(NodeStatus.Success);
    const seq = new SequenceNode([a, b, c]);
    const ctx: Ctx = { ticks: 0 };

    expect(seq.tick(ctx)).toBe(NodeStatus.Success);
    expect(ctx.ticks).toBe(3);
    expect(a.ticks).toBe(1);
    expect(b.ticks).toBe(1);
    expect(c.ticks).toBe(1);
  });

  it('short-circuits on the first Failure and skips the rest', () => {
    const a = new StubLeaf(NodeStatus.Success);
    const b = new StubLeaf(NodeStatus.Failure);
    const c = new StubLeaf(NodeStatus.Success);
    const seq = new SequenceNode([a, b, c]);
    const ctx: Ctx = { ticks: 0 };

    expect(seq.tick(ctx)).toBe(NodeStatus.Failure);
    expect(a.ticks).toBe(1);
    expect(b.ticks).toBe(1);
    expect(c.ticks).toBe(0);
  });

  it('returns Running when a child is running and stops ticking siblings', () => {
    const a = new StubLeaf(NodeStatus.Success);
    const b = new StubLeaf(NodeStatus.Running);
    const c = new StubLeaf(NodeStatus.Success);
    const seq = new SequenceNode([a, b, c]);
    const ctx: Ctx = { ticks: 0 };

    expect(seq.tick(ctx)).toBe(NodeStatus.Running);
    expect(c.ticks).toBe(0);
  });

  it('resumes from the running child on the next tick (memoized semantics)', () => {
    const a = new StubLeaf(NodeStatus.Success);
    // Returns Running first, Success second.
    const b = new ScriptedLeaf([NodeStatus.Running, NodeStatus.Success]);
    const c = new StubLeaf(NodeStatus.Success);
    const seq = new SequenceNode([a, b, c]);
    const ctx: Ctx = { ticks: 0 };

    // First tick: a → Success, b → Running. Sequence returns Running.
    expect(seq.tick(ctx)).toBe(NodeStatus.Running);
    expect(a.ticks).toBe(1);
    expect(b.ticks).toBe(1);
    expect(c.ticks).toBe(0);
    expect(seq.getCurrentIndex()).toBe(1);

    // Second tick: a should NOT be re-ticked, b runs again → Success,
    // c runs → Success, sequence terminates as Success.
    expect(seq.tick(ctx)).toBe(NodeStatus.Success);
    expect(a.ticks).toBe(1); // unchanged
    expect(b.ticks).toBe(2);
    expect(c.ticks).toBe(1);
    expect(seq.getCurrentIndex()).toBe(0); // reset after Success
  });

  it('resets the resume index after a terminal Failure', () => {
    const a = new StubLeaf(NodeStatus.Success);
    const b = new ScriptedLeaf([NodeStatus.Running, NodeStatus.Failure]);
    const seq = new SequenceNode([a, b]);
    const ctx: Ctx = { ticks: 0 };

    expect(seq.tick(ctx)).toBe(NodeStatus.Running);
    expect(seq.getCurrentIndex()).toBe(1);
    expect(seq.tick(ctx)).toBe(NodeStatus.Failure);
    expect(seq.getCurrentIndex()).toBe(0);
  });

  it('cascades reset() into all children and clears the resume index', () => {
    const a = new StubLeaf(NodeStatus.Success);
    const b = new StubLeaf(NodeStatus.Running);
    const seq = new SequenceNode([a, b]);
    seq.tick({ ticks: 0 });
    expect(seq.getCurrentIndex()).toBe(1);

    seq.reset();
    expect(a.resets).toBe(1);
    expect(b.resets).toBe(1);
    expect(seq.getCurrentIndex()).toBe(0);
  });

  it('rejects construction with zero children (inherited contract)', () => {
    expect(() => new SequenceNode<Ctx>([])).toThrow(/at least one child/i);
  });

  it('handles the single-child case', () => {
    const only = new StubLeaf(NodeStatus.Success);
    const seq = new SequenceNode([only]);
    expect(seq.tick({ ticks: 0 })).toBe(NodeStatus.Success);
    expect(seq.getCurrentIndex()).toBe(0);
  });

  it('accepts plain IBehaviorNode test doubles without extending the base class', () => {
    let ticked = 0;
    let reset = 0;
    const stub: IBehaviorNode<Ctx> = {
      tick: () => {
        ticked += 1;
        return NodeStatus.Success;
      },
      reset: () => {
        reset += 1;
      },
    };
    const seq = new SequenceNode<Ctx>([stub]);
    expect(seq.tick({ ticks: 0 })).toBe(NodeStatus.Success);
    expect(ticked).toBe(1);
    seq.reset();
    expect(reset).toBe(1);
  });

  it('produces deterministic results given identical input contexts', () => {
    const buildTree = (): SequenceNode<Ctx> =>
      new SequenceNode([
        new StubLeaf(NodeStatus.Success),
        new ScriptedLeaf([
          NodeStatus.Running,
          NodeStatus.Running,
          NodeStatus.Success,
        ]),
        new StubLeaf(NodeStatus.Success),
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
