import { describe, it, expect } from 'vitest';
import { BehaviorTree, type BehaviorTreeContext } from './BehaviorTree';
import { Blackboard } from './Blackboard';
import { LeafNode, NodeStatus, type IBehaviorNode } from './Node';
import { SequenceNode } from './composites/SequenceNode';

// ────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ────────────────────────────────────────────────────────────────────────────

interface BotSchema {
  currentTargetId: number;
  isGrounded: boolean;
  hits: number;
}

interface BotCtx extends BehaviorTreeContext<BotSchema> {
  ticks: number;
}

/** Leaf returning a fixed status; counts ticks/resets and forwards context. */
class StubLeaf extends LeafNode<BotCtx> {
  public ticks = 0;
  public resets = 0;
  public lastTickIndex: number | null = null;
  public sawBlackboard: boolean | null = null;
  constructor(private readonly status: NodeStatus) {
    super();
  }
  protected override onTick(ctx: BotCtx): NodeStatus {
    ctx.ticks += 1;
    this.ticks += 1;
    this.lastTickIndex = ctx.tickIndex;
    this.sawBlackboard = !!ctx.blackboard;
    return this.status;
  }
  override reset(): void {
    super.reset();
    this.resets += 1;
  }
}

/** Leaf that writes to / reads from the Blackboard each tick. */
class BlackboardWriterLeaf extends LeafNode<BotCtx> {
  public ticks = 0;
  protected override onTick(ctx: BotCtx): NodeStatus {
    this.ticks += 1;
    const prev = ctx.blackboard.get('hits') ?? 0;
    ctx.blackboard.set('hits', prev + 1);
    ctx.blackboard.set('isGrounded', true);
    return NodeStatus.Success;
  }
}

/** Leaf that returns a programmable script of statuses. */
class ScriptedLeaf extends LeafNode<BotCtx> {
  public ticks = 0;
  public resets = 0;
  private cursor = 0;
  constructor(private readonly script: ReadonlyArray<NodeStatus>) {
    super();
  }
  protected override onTick(_ctx: BotCtx): NodeStatus {
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

/** Build a fresh per-tick context that wires the runner's Blackboard in. */
function buildCtx(tree: BehaviorTree<BotCtx, BotSchema>): BotCtx {
  return {
    blackboard: tree.getBlackboard(),
    tickIndex: tree.getTickCount(),
    ticks: 0,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('BehaviorTree', () => {
  describe('construction', () => {
    it('accepts a bare root with no options', () => {
      const root = new StubLeaf(NodeStatus.Success);
      const tree = new BehaviorTree<BotCtx, BotSchema>(root);
      expect(tree.getRoot()).toBe(root);
      expect(tree.getLastStatus()).toBeNull();
      expect(tree.getTickCount()).toBe(0);
      expect(tree.name).toBeUndefined();
    });

    it('accepts a name and surfaces it via the public field', () => {
      const tree = new BehaviorTree<BotCtx, BotSchema>(
        new StubLeaf(NodeStatus.Success),
        { name: 'hard-bot' },
      );
      expect(tree.name).toBe('hard-bot');
    });

    it('owns a fresh Blackboard accessible via getBlackboard()', () => {
      const tree = new BehaviorTree<BotCtx, BotSchema>(
        new StubLeaf(NodeStatus.Success),
      );
      const bb = tree.getBlackboard();
      expect(bb).toBeDefined();
      expect(bb.size).toBe(0);
    });

    it('seeds the Blackboard from initialBlackboard', () => {
      const tree = new BehaviorTree<BotCtx, BotSchema>(
        new StubLeaf(NodeStatus.Success),
        { initialBlackboard: { currentTargetId: 7, isGrounded: false } },
      );
      const bb = tree.getBlackboard();
      expect(bb.get('currentTargetId')).toBe(7);
      expect(bb.get('isGrounded')).toBe(false);
      expect(bb.size).toBe(2);
    });

    it('accepts a plain IBehaviorNode test double as the root', () => {
      let ticked = 0;
      let reset = 0;
      const stub: IBehaviorNode<BotCtx> = {
        tick: () => {
          ticked += 1;
          return NodeStatus.Success;
        },
        reset: () => {
          reset += 1;
        },
      };
      const tree = new BehaviorTree<BotCtx, BotSchema>(stub);
      tree.tick(buildCtx(tree));
      tree.reset();
      expect(ticked).toBe(1);
      expect(reset).toBe(1);
    });
  });

  describe('tick', () => {
    it('forwards the context to the root verbatim', () => {
      const root = new StubLeaf(NodeStatus.Success);
      const tree = new BehaviorTree<BotCtx, BotSchema>(root);
      const ctx = buildCtx(tree);
      tree.tick(ctx);
      expect(root.ticks).toBe(1);
      expect(ctx.ticks).toBe(1);
      expect(root.sawBlackboard).toBe(true);
    });

    it('returns the status produced by the root', () => {
      for (const status of [
        NodeStatus.Success,
        NodeStatus.Failure,
        NodeStatus.Running,
      ]) {
        const tree = new BehaviorTree<BotCtx, BotSchema>(new StubLeaf(status));
        expect(tree.tick(buildCtx(tree))).toBe(status);
      }
    });

    it('increments the tick counter after each tick', () => {
      const tree = new BehaviorTree<BotCtx, BotSchema>(
        new StubLeaf(NodeStatus.Success),
      );
      expect(tree.getTickCount()).toBe(0);
      tree.tick(buildCtx(tree));
      expect(tree.getTickCount()).toBe(1);
      tree.tick(buildCtx(tree));
      expect(tree.getTickCount()).toBe(2);
      tree.tick(buildCtx(tree));
      expect(tree.getTickCount()).toBe(3);
    });

    it('records lastStatus after each tick', () => {
      const child = new ScriptedLeaf([
        NodeStatus.Running,
        NodeStatus.Success,
        NodeStatus.Failure,
      ]);
      const tree = new BehaviorTree<BotCtx, BotSchema>(child);
      expect(tree.getLastStatus()).toBeNull();
      tree.tick(buildCtx(tree));
      expect(tree.getLastStatus()).toBe(NodeStatus.Running);
      tree.tick(buildCtx(tree));
      expect(tree.getLastStatus()).toBe(NodeStatus.Success);
      tree.tick(buildCtx(tree));
      expect(tree.getLastStatus()).toBe(NodeStatus.Failure);
    });

    it('exposes tickIndex=0 on the very first tick (pre-increment semantic)', () => {
      const root = new StubLeaf(NodeStatus.Success);
      const tree = new BehaviorTree<BotCtx, BotSchema>(root);
      // Build the ctx using getTickCount() — that should be 0 on the first tick.
      const ctx = buildCtx(tree);
      expect(ctx.tickIndex).toBe(0);
      tree.tick(ctx);
      expect(root.lastTickIndex).toBe(0);
      // Now the runner has incremented; subsequent calls see 1, 2, ….
      const ctx2 = buildCtx(tree);
      expect(ctx2.tickIndex).toBe(1);
      tree.tick(ctx2);
      expect(root.lastTickIndex).toBe(1);
    });

    it('threads a stable Blackboard reference across ticks', () => {
      const writer = new BlackboardWriterLeaf();
      const tree = new BehaviorTree<BotCtx, BotSchema>(writer);
      tree.tick(buildCtx(tree));
      tree.tick(buildCtx(tree));
      tree.tick(buildCtx(tree));
      expect(tree.getBlackboard().get('hits')).toBe(3);
      expect(tree.getBlackboard().get('isGrounded')).toBe(true);
    });

    it('drives a non-trivial composite tree end-to-end', () => {
      const a = new StubLeaf(NodeStatus.Success);
      const b = new ScriptedLeaf([NodeStatus.Running, NodeStatus.Success]);
      const c = new StubLeaf(NodeStatus.Success);
      const root = new SequenceNode<BotCtx>([a, b, c]);
      const tree = new BehaviorTree<BotCtx, BotSchema>(root);

      // Tick 1 — sequence runs a→Success, b→Running ⇒ Running, c untouched.
      expect(tree.tick(buildCtx(tree))).toBe(NodeStatus.Running);
      expect(c.ticks).toBe(0);
      // Tick 2 — sequence resumes at b→Success, ticks c→Success ⇒ Success.
      expect(tree.tick(buildCtx(tree))).toBe(NodeStatus.Success);
      expect(c.ticks).toBe(1);
      expect(tree.getLastStatus()).toBe(NodeStatus.Success);
      expect(tree.getTickCount()).toBe(2);
    });
  });

  describe('reset', () => {
    it('cascades reset() into the root', () => {
      const root = new StubLeaf(NodeStatus.Success);
      const tree = new BehaviorTree<BotCtx, BotSchema>(root);
      tree.tick(buildCtx(tree));
      tree.reset();
      expect(root.resets).toBe(1);
    });

    it('clears the tick counter', () => {
      const tree = new BehaviorTree<BotCtx, BotSchema>(
        new StubLeaf(NodeStatus.Success),
      );
      tree.tick(buildCtx(tree));
      tree.tick(buildCtx(tree));
      expect(tree.getTickCount()).toBe(2);
      tree.reset();
      expect(tree.getTickCount()).toBe(0);
    });

    it('clears the lastStatus to null', () => {
      const tree = new BehaviorTree<BotCtx, BotSchema>(
        new StubLeaf(NodeStatus.Success),
      );
      tree.tick(buildCtx(tree));
      expect(tree.getLastStatus()).toBe(NodeStatus.Success);
      tree.reset();
      expect(tree.getLastStatus()).toBeNull();
    });

    it('clears and reseeds the Blackboard by default', () => {
      const tree = new BehaviorTree<BotCtx, BotSchema>(
        new BlackboardWriterLeaf(),
        { initialBlackboard: { currentTargetId: 9 } },
      );
      tree.tick(buildCtx(tree));
      tree.tick(buildCtx(tree));
      expect(tree.getBlackboard().get('hits')).toBe(2);
      expect(tree.getBlackboard().get('currentTargetId')).toBe(9);

      tree.reset();
      const bb = tree.getBlackboard();
      // Writer's `hits` was cleared.
      expect(bb.has('hits')).toBe(false);
      // Initial seed was reapplied verbatim.
      expect(bb.get('currentTargetId')).toBe(9);
      expect(bb.size).toBe(1);
    });

    it('clears the Blackboard with no reseed when no initialBlackboard given', () => {
      const tree = new BehaviorTree<BotCtx, BotSchema>(
        new BlackboardWriterLeaf(),
      );
      tree.tick(buildCtx(tree));
      expect(tree.getBlackboard().size).toBeGreaterThan(0);
      tree.reset();
      expect(tree.getBlackboard().size).toBe(0);
    });

    it('preserves the Blackboard when resetBlackboard=false', () => {
      const tree = new BehaviorTree<BotCtx, BotSchema>(
        new BlackboardWriterLeaf(),
        {
          initialBlackboard: { currentTargetId: 4 },
          resetBlackboard: false,
        },
      );
      tree.tick(buildCtx(tree));
      tree.tick(buildCtx(tree));
      const bb = tree.getBlackboard();
      expect(bb.get('hits')).toBe(2);
      expect(bb.get('currentTargetId')).toBe(4);

      tree.reset();
      // Tick counter and last status reset, but Blackboard is intact.
      expect(tree.getTickCount()).toBe(0);
      expect(tree.getLastStatus()).toBeNull();
      expect(bb.get('hits')).toBe(2);
      expect(bb.get('currentTargetId')).toBe(4);
    });

    it('returns the same Blackboard reference after reset (binding stable)', () => {
      const tree = new BehaviorTree<BotCtx, BotSchema>(
        new StubLeaf(NodeStatus.Success),
        { initialBlackboard: { currentTargetId: 1 } },
      );
      const bbBefore = tree.getBlackboard();
      tree.tick(buildCtx(tree));
      tree.reset();
      const bbAfter = tree.getBlackboard();
      expect(bbAfter).toBe(bbBefore);
    });

    it('is idempotent — calling reset() twice is a no-op', () => {
      const root = new StubLeaf(NodeStatus.Success);
      const tree = new BehaviorTree<BotCtx, BotSchema>(root);
      tree.tick(buildCtx(tree));
      tree.reset();
      const stateA = {
        tickCount: tree.getTickCount(),
        lastStatus: tree.getLastStatus(),
        bbSize: tree.getBlackboard().size,
      };
      tree.reset();
      const stateB = {
        tickCount: tree.getTickCount(),
        lastStatus: tree.getLastStatus(),
        bbSize: tree.getBlackboard().size,
      };
      expect(stateB).toEqual(stateA);
    });

    it('cascades reset through nested composites', () => {
      const a = new StubLeaf(NodeStatus.Success);
      const b = new StubLeaf(NodeStatus.Running);
      const root = new SequenceNode<BotCtx>([a, b]);
      const tree = new BehaviorTree<BotCtx, BotSchema>(root);
      tree.tick(buildCtx(tree));
      // Sequence got pinned at index 1 because b was Running.
      expect(root.getCurrentIndex()).toBe(1);
      tree.reset();
      expect(a.resets).toBe(1);
      expect(b.resets).toBe(1);
      expect(root.getCurrentIndex()).toBe(0);
    });
  });

  describe('getters', () => {
    it('getBlackboard returns the same instance every call', () => {
      const tree = new BehaviorTree<BotCtx, BotSchema>(
        new StubLeaf(NodeStatus.Success),
      );
      expect(tree.getBlackboard()).toBe(tree.getBlackboard());
    });

    it('getRoot returns the constructed root unchanged', () => {
      const root = new StubLeaf(NodeStatus.Success);
      const tree = new BehaviorTree<BotCtx, BotSchema>(root);
      expect(tree.getRoot()).toBe(root);
    });

    it('getLastStatus is null before the first tick', () => {
      const tree = new BehaviorTree<BotCtx, BotSchema>(
        new StubLeaf(NodeStatus.Success),
      );
      expect(tree.getLastStatus()).toBeNull();
    });

    it('getTickCount is 0 before the first tick', () => {
      const tree = new BehaviorTree<BotCtx, BotSchema>(
        new StubLeaf(NodeStatus.Success),
      );
      expect(tree.getTickCount()).toBe(0);
    });
  });

  describe('determinism', () => {
    it('two trees built identically produce identical tick sequences', () => {
      const buildTree = (): BehaviorTree<BotCtx, BotSchema> =>
        new BehaviorTree<BotCtx, BotSchema>(
          new SequenceNode<BotCtx>([
            new StubLeaf(NodeStatus.Success),
            new ScriptedLeaf([
              NodeStatus.Running,
              NodeStatus.Running,
              NodeStatus.Success,
            ]),
            new StubLeaf(NodeStatus.Success),
          ]),
          { initialBlackboard: { currentTargetId: 2 } },
        );

      const a = buildTree();
      const b = buildTree();
      const statusesA: NodeStatus[] = [];
      const statusesB: NodeStatus[] = [];
      for (let i = 0; i < 6; i++) {
        statusesA.push(a.tick(buildCtx(a)));
        statusesB.push(b.tick(buildCtx(b)));
      }
      expect(statusesA).toEqual(statusesB);
      expect(a.getTickCount()).toBe(b.getTickCount());
      expect(a.getLastStatus()).toBe(b.getLastStatus());
      // Cast to the concrete `Blackboard` to access `entries()` for
      // structural comparison. `getBlackboard()` returns the `IBlackboard`
      // interface to keep the public surface minimal — tests can peek
      // inside without consumers needing the wider API.
      expect(
        Array.from((a.getBlackboard() as Blackboard<BotSchema>).entries()),
      ).toEqual(
        Array.from((b.getBlackboard() as Blackboard<BotSchema>).entries()),
      );
    });

    it('reset + replay reproduces the original tick sequence', () => {
      const buildTree = (): BehaviorTree<BotCtx, BotSchema> =>
        new BehaviorTree<BotCtx, BotSchema>(
          new SequenceNode<BotCtx>([
            new StubLeaf(NodeStatus.Success),
            new ScriptedLeaf([NodeStatus.Running, NodeStatus.Success]),
          ]),
          { initialBlackboard: { isGrounded: true } },
        );

      const tree = buildTree();
      const initial: NodeStatus[] = [];
      for (let i = 0; i < 4; i++) initial.push(tree.tick(buildCtx(tree)));

      tree.reset();
      // The leaves inside the sequence are stateful (ScriptedLeaf cursor).
      // reset() must have reset them too — replay should reproduce the
      // original sequence exactly.
      const replay: NodeStatus[] = [];
      for (let i = 0; i < 4; i++) replay.push(tree.tick(buildCtx(tree)));
      expect(replay).toEqual(initial);
    });

    it('does not mutate the supplied initialBlackboard object', () => {
      const seed: Partial<BotSchema> = { currentTargetId: 11 };
      const tree = new BehaviorTree<BotCtx, BotSchema>(
        new BlackboardWriterLeaf(),
        { initialBlackboard: seed },
      );
      tree.tick(buildCtx(tree));
      tree.reset();
      // The seed object provided by the caller is unchanged.
      expect(seed).toEqual({ currentTargetId: 11 });
    });
  });

  describe('Blackboard integration smoke', () => {
    it('uses a typed Blackboard schema end-to-end', () => {
      const tree = new BehaviorTree<BotCtx, BotSchema>(
        new BlackboardWriterLeaf(),
      );
      tree.tick(buildCtx(tree));
      const bb = tree.getBlackboard();
      // The interface accessor surfaces the schema-typed read.
      const hits: number | undefined = bb.get('hits');
      expect(hits).toBe(1);
    });

    it('exposes a Blackboard that supports the full IBlackboard API', () => {
      const tree = new BehaviorTree<BotCtx, BotSchema>(
        new StubLeaf(NodeStatus.Success),
      );
      const bb = tree.getBlackboard();
      bb.set('currentTargetId', 3);
      expect(bb.has('currentTargetId')).toBe(true);
      expect(bb.delete('currentTargetId')).toBe(true);
      expect(bb.has('currentTargetId')).toBe(false);
      expect(bb.size).toBe(0);
    });

    it('round-trips through the underlying Blackboard concrete class', () => {
      // Construction-via-options goes through the same code path as a
      // bare `new Blackboard(...)`; this test just guards against a future
      // refactor accidentally diverging the two.
      const tree = new BehaviorTree<BotCtx, BotSchema>(
        new StubLeaf(NodeStatus.Success),
        { initialBlackboard: { hits: 5 } },
      );
      const reference = new Blackboard<BotSchema>({ hits: 5 });
      expect(
        Array.from((tree.getBlackboard() as Blackboard<BotSchema>).entries()),
      ).toEqual(Array.from(reference.entries()));
    });
  });
});
