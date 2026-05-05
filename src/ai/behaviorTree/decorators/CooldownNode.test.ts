import { describe, it, expect } from 'vitest';
import { LeafNode, NodeStatus } from '../Node';
import { CooldownNode } from './CooldownNode';

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

describe('CooldownNode', () => {
  describe('default trigger (success)', () => {
    it('returns the child status on the triggering tick', () => {
      const child = new StubLeaf(NodeStatus.Success);
      const cd = new CooldownNode(child, { durationFrames: 3 });
      expect(cd.tick({ ticks: 0 })).toBe(NodeStatus.Success);
      expect(child.ticks).toBe(1);
    });

    it('blocks the child for durationFrames ticks after Success', () => {
      const child = new StubLeaf(NodeStatus.Success);
      const cd = new CooldownNode(child, { durationFrames: 3 });
      const ctx: Ctx = { ticks: 0 };

      // Tick 1 — child runs and succeeds → cooldown arms.
      expect(cd.tick(ctx)).toBe(NodeStatus.Success);
      // Ticks 2..4 — cooldown blocks child entirely.
      expect(cd.tick(ctx)).toBe(NodeStatus.Failure);
      expect(cd.tick(ctx)).toBe(NodeStatus.Failure);
      expect(cd.tick(ctx)).toBe(NodeStatus.Failure);
      expect(child.ticks).toBe(1); // child not touched during cooldown
      // Tick 5 — gate is open again, child runs.
      expect(cd.tick(ctx)).toBe(NodeStatus.Success);
      expect(child.ticks).toBe(2);
    });

    it('does NOT trigger cooldown on Failure when triggerOn=success', () => {
      const child = new StubLeaf(NodeStatus.Failure);
      const cd = new CooldownNode(child, { durationFrames: 5 });
      // Repeated Failure should never arm the cooldown.
      for (let i = 0; i < 10; i++) {
        expect(cd.tick({ ticks: 0 })).toBe(NodeStatus.Failure);
      }
      expect(cd.isOnCooldown()).toBe(false);
      expect(child.ticks).toBe(10);
    });

    it('passes Running through and does not arm the cooldown', () => {
      const child = new StubLeaf(NodeStatus.Running);
      const cd = new CooldownNode(child, { durationFrames: 4 });
      expect(cd.tick({ ticks: 0 })).toBe(NodeStatus.Running);
      expect(cd.isOnCooldown()).toBe(false);
    });
  });

  describe('triggerOn variants', () => {
    it('triggers on Failure when configured', () => {
      const child = new StubLeaf(NodeStatus.Failure);
      const cd = new CooldownNode(child, {
        durationFrames: 2,
        triggerOn: 'failure',
      });
      const ctx: Ctx = { ticks: 0 };
      expect(cd.tick(ctx)).toBe(NodeStatus.Failure);
      expect(cd.isOnCooldown()).toBe(true);
      // Cooldown frames return Failure but do NOT tick the child.
      expect(cd.tick(ctx)).toBe(NodeStatus.Failure);
      expect(cd.tick(ctx)).toBe(NodeStatus.Failure);
      expect(child.ticks).toBe(1);
      // Open again.
      expect(cd.tick(ctx)).toBe(NodeStatus.Failure);
      expect(child.ticks).toBe(2);
    });

    it('triggers on either terminal when configured to "terminal"', () => {
      const child = new StubLeaf(NodeStatus.Failure);
      const cd = new CooldownNode(child, {
        durationFrames: 2,
        triggerOn: 'terminal',
      });
      const ctx: Ctx = { ticks: 0 };
      cd.tick(ctx);
      expect(cd.isOnCooldown()).toBe(true);
      cd.reset();

      const child2 = new StubLeaf(NodeStatus.Success);
      const cd2 = new CooldownNode(child2, {
        durationFrames: 2,
        triggerOn: 'terminal',
      });
      cd2.tick(ctx);
      expect(cd2.isOnCooldown()).toBe(true);
    });
  });

  describe('startActive', () => {
    it('begins in cooldown when startActive is true', () => {
      const child = new StubLeaf(NodeStatus.Success);
      const cd = new CooldownNode(child, {
        durationFrames: 2,
        startActive: true,
      });
      expect(cd.isOnCooldown()).toBe(true);
      expect(cd.tick({ ticks: 0 })).toBe(NodeStatus.Failure);
      expect(cd.tick({ ticks: 0 })).toBe(NodeStatus.Failure);
      expect(child.ticks).toBe(0);
      // Cooldown drained — child is back online.
      expect(cd.tick({ ticks: 0 })).toBe(NodeStatus.Success);
      expect(child.ticks).toBe(1);
    });

    it('reset() restores startActive cooldown so post-reset behaves like a fresh node', () => {
      const child = new StubLeaf(NodeStatus.Success);
      const cd = new CooldownNode(child, {
        durationFrames: 3,
        startActive: true,
      });
      // Drain partway, then reset.
      cd.tick({ ticks: 0 });
      cd.tick({ ticks: 0 });
      expect(cd.getRemainingFrames()).toBe(1);
      cd.reset();
      expect(cd.getRemainingFrames()).toBe(3);
    });

    it('reset() restores remaining=0 when startActive is false', () => {
      const child = new StubLeaf(NodeStatus.Success);
      const cd = new CooldownNode(child, { durationFrames: 3 });
      cd.tick({ ticks: 0 }); // success → arms cooldown
      expect(cd.isOnCooldown()).toBe(true);
      cd.reset();
      expect(cd.isOnCooldown()).toBe(false);
    });
  });

  describe('reset', () => {
    it('cascades reset into the child', () => {
      const child = new StubLeaf(NodeStatus.Running);
      const cd = new CooldownNode(child, { durationFrames: 2 });
      cd.tick({ ticks: 0 });
      cd.reset();
      expect(child.resets).toBe(1);
    });
  });

  describe('construction', () => {
    it('rejects durationFrames < 1', () => {
      expect(
        () =>
          new CooldownNode(new StubLeaf(NodeStatus.Success), {
            durationFrames: 0,
          }),
      ).toThrow(/durationFrames >= 1/i);
    });

    it('rejects non-integer durationFrames', () => {
      expect(
        () =>
          new CooldownNode(new StubLeaf(NodeStatus.Success), {
            durationFrames: 1.5,
          }),
      ).toThrow(/durationFrames >= 1/i);
    });

    it('exposes the configured options for inspection', () => {
      const cd = new CooldownNode(new StubLeaf(NodeStatus.Success), {
        durationFrames: 7,
        triggerOn: 'failure',
      });
      expect(cd.getDurationFrames()).toBe(7);
      expect(cd.getTriggerOn()).toBe('failure');
    });

    it('defaults trigger to "success"', () => {
      const cd = new CooldownNode(new StubLeaf(NodeStatus.Success), {
        durationFrames: 2,
      });
      expect(cd.getTriggerOn()).toBe('success');
    });
  });

  describe('determinism', () => {
    it('produces identical cooldown sequences across identical contexts', () => {
      const buildTree = (): CooldownNode<Ctx> =>
        new CooldownNode(new StubLeaf(NodeStatus.Success), {
          durationFrames: 3,
        });
      const a = buildTree();
      const b = buildTree();
      const ctxA: Ctx = { ticks: 0 };
      const ctxB: Ctx = { ticks: 0 };
      for (let i = 0; i < 12; i++) {
        expect(a.tick(ctxA)).toBe(b.tick(ctxB));
      }
      expect(ctxA).toEqual(ctxB);
    });
  });
});
