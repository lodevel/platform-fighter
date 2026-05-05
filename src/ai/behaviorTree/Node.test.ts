import { describe, it, expect } from 'vitest';
import {
  BehaviorNode,
  CompositeNode,
  DecoratorNode,
  LeafNode,
  NodeStatus,
  isFailure,
  isRunning,
  isSuccess,
  isTerminal,
  type IBehaviorNode,
} from './Node';

// ────────────────────────────────────────────────────────────────────────────
// Test fixtures — minimal subclasses used to exercise the abstract bases.
// ────────────────────────────────────────────────────────────────────────────

interface TestContext {
  tickCount: number;
}

/** Leaf that returns a configured status and tracks how many times it ticked. */
class StubLeaf extends LeafNode<TestContext> {
  public ticks = 0;
  public resets = 0;
  constructor(
    private readonly status: NodeStatus,
    name?: string,
  ) {
    super(name);
  }
  protected override onTick(context: TestContext): NodeStatus {
    context.tickCount += 1;
    this.ticks += 1;
    return this.status;
  }
  override reset(): void {
    super.reset();
    this.resets += 1;
  }
}

/** Decorator that just forwards its child's status (identity). */
class IdentityDecorator extends DecoratorNode<TestContext> {
  protected override onTick(context: TestContext): NodeStatus {
    return this.child.tick(context);
  }
}

/** Composite that ticks every child and returns the last one's status. */
class TickAllComposite extends CompositeNode<TestContext> {
  protected override onTick(context: TestContext): NodeStatus {
    let last: NodeStatus = NodeStatus.Failure;
    for (const child of this.children) last = child.tick(context);
    return last;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// NodeStatus
// ────────────────────────────────────────────────────────────────────────────

describe('NodeStatus enum', () => {
  it('exposes Success / Failure / Running constants', () => {
    expect(NodeStatus.Success).toBe('success');
    expect(NodeStatus.Failure).toBe('failure');
    expect(NodeStatus.Running).toBe('running');
  });

  it('is frozen so consumers cannot mutate the constants', () => {
    expect(Object.isFrozen(NodeStatus)).toBe(true);
  });

  it('classifies status values correctly via predicates', () => {
    expect(isSuccess(NodeStatus.Success)).toBe(true);
    expect(isFailure(NodeStatus.Failure)).toBe(true);
    expect(isRunning(NodeStatus.Running)).toBe(true);

    expect(isSuccess(NodeStatus.Failure)).toBe(false);
    expect(isFailure(NodeStatus.Running)).toBe(false);
    expect(isRunning(NodeStatus.Success)).toBe(false);

    expect(isTerminal(NodeStatus.Success)).toBe(true);
    expect(isTerminal(NodeStatus.Failure)).toBe(true);
    expect(isTerminal(NodeStatus.Running)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BehaviorNode base
// ────────────────────────────────────────────────────────────────────────────

describe('BehaviorNode (abstract base)', () => {
  it('records lastStatus after every tick', () => {
    const leaf = new StubLeaf(NodeStatus.Success);
    expect(leaf.getLastStatus()).toBeNull();
    leaf.tick({ tickCount: 0 });
    expect(leaf.getLastStatus()).toBe(NodeStatus.Success);
  });

  it('exposes its name for debug tooling', () => {
    const leaf = new StubLeaf(NodeStatus.Failure, 'my-debug-name');
    expect(leaf.name).toBe('my-debug-name');
  });

  it('clears lastStatus on reset', () => {
    const leaf = new StubLeaf(NodeStatus.Success);
    leaf.tick({ tickCount: 0 });
    expect(leaf.getLastStatus()).not.toBeNull();
    leaf.reset();
    expect(leaf.getLastStatus()).toBeNull();
  });

  it('treats reset() as idempotent — multiple calls do not throw', () => {
    const leaf = new StubLeaf(NodeStatus.Running);
    expect(() => {
      leaf.reset();
      leaf.reset();
      leaf.reset();
    }).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// LeafNode
// ────────────────────────────────────────────────────────────────────────────

describe('LeafNode', () => {
  it('forwards ticks to the subclass onTick', () => {
    const ctx: TestContext = { tickCount: 0 };
    const leaf = new StubLeaf(NodeStatus.Success);
    expect(leaf.tick(ctx)).toBe(NodeStatus.Success);
    expect(ctx.tickCount).toBe(1);
    expect(leaf.ticks).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DecoratorNode
// ────────────────────────────────────────────────────────────────────────────

describe('DecoratorNode', () => {
  it('cascades reset into the wrapped child', () => {
    const child = new StubLeaf(NodeStatus.Success);
    const decorator = new IdentityDecorator(child);
    decorator.tick({ tickCount: 0 });
    decorator.reset();
    expect(child.resets).toBe(1);
  });

  it('lets the subclass tick the wrapped child', () => {
    const child = new StubLeaf(NodeStatus.Running);
    const decorator = new IdentityDecorator(child);
    expect(decorator.tick({ tickCount: 0 })).toBe(NodeStatus.Running);
    expect(child.ticks).toBe(1);
  });

  it('accepts test doubles that implement IBehaviorNode without extending the base class', () => {
    let ticked = 0;
    const stub: IBehaviorNode<TestContext> = {
      tick: () => {
        ticked += 1;
        return NodeStatus.Success;
      },
      reset: () => {
        /* no-op */
      },
    };
    const decorator = new IdentityDecorator(stub);
    decorator.tick({ tickCount: 0 });
    expect(ticked).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CompositeNode
// ────────────────────────────────────────────────────────────────────────────

describe('CompositeNode', () => {
  it('rejects construction with zero children', () => {
    expect(() => new TickAllComposite([])).toThrow(/at least one child/i);
  });

  it('exposes children as a frozen, read-only array', () => {
    const a = new StubLeaf(NodeStatus.Success);
    const b = new StubLeaf(NodeStatus.Success);
    const composite = new TickAllComposite([a, b]);
    const children = composite.getChildren();
    expect(children).toHaveLength(2);
    expect(Object.isFrozen(children)).toBe(true);
  });

  it('does not share the input array — caller mutations cannot affect the tree', () => {
    const a = new StubLeaf(NodeStatus.Success);
    const b = new StubLeaf(NodeStatus.Success);
    const input = [a, b];
    const composite = new TickAllComposite(input);
    // Mutate the original array — composite's view must stay stable.
    input.pop();
    expect(composite.getChildren()).toHaveLength(2);
  });

  it('cascades reset into every child', () => {
    const a = new StubLeaf(NodeStatus.Success);
    const b = new StubLeaf(NodeStatus.Success);
    const composite = new TickAllComposite([a, b]);
    composite.tick({ tickCount: 0 });
    composite.reset();
    expect(a.resets).toBe(1);
    expect(b.resets).toBe(1);
  });

  it('passes the same context through to each child', () => {
    const ctx: TestContext = { tickCount: 0 };
    const a = new StubLeaf(NodeStatus.Success);
    const b = new StubLeaf(NodeStatus.Success);
    const c = new StubLeaf(NodeStatus.Failure);
    const composite = new TickAllComposite([a, b, c]);
    const result = composite.tick(ctx);
    expect(result).toBe(NodeStatus.Failure);
    expect(ctx.tickCount).toBe(3);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Determinism guarantee
// ────────────────────────────────────────────────────────────────────────────

describe('determinism', () => {
  it('produces identical tick sequences for identical input contexts', () => {
    const buildTree = (): BehaviorNode<TestContext> =>
      new TickAllComposite([
        new IdentityDecorator(new StubLeaf(NodeStatus.Success)),
        new StubLeaf(NodeStatus.Failure),
        new IdentityDecorator(new StubLeaf(NodeStatus.Running)),
      ]);

    const treeA = buildTree();
    const treeB = buildTree();

    const ctxA: TestContext = { tickCount: 0 };
    const ctxB: TestContext = { tickCount: 0 };

    for (let i = 0; i < 10; i++) {
      expect(treeA.tick(ctxA)).toBe(treeB.tick(ctxB));
    }
    expect(ctxA).toEqual(ctxB);
  });
});
