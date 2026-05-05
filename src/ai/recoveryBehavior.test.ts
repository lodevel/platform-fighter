/**
 * Unit tests for {@link buildReliableRecoverySubtree} (AC 19 Sub-AC 4).
 *
 * The subtree under test composes the four recovery leaves under a
 * priority Selector wrapped in an outer off-stage gate. The tests
 * exercise five concerns:
 *
 *   1. Option resolution — {@link resolveReliableRecoverySubtreeOptions}
 *      fills documented defaults and forwards overrides verbatim.
 *   2. Outer gate — on-stage / grounded / hitstun / on-ledge tickets
 *      short-circuit to Failure WITHOUT ticking the inner Selector.
 *   3. Branch priority — once airborne and off-stage, the inner
 *      Selector runs through jump → double-jump → up-special →
 *      ledge-return in declaration order.
 *   4. End-to-end recovery — a multi-tick scenario walks the bot from
 *      "fell off the edge" to a successful ledge grab.
 *   5. Determinism — two subtrees built with identical options
 *      produce identical emit sequences across the same context
 *      schedule.
 */

import { describe, expect, it } from 'vitest';

import { Blackboard } from './behaviorTree/Blackboard';
import { BehaviorTree } from './behaviorTree/BehaviorTree';
import { NodeStatus } from './behaviorTree/Node';
import { Rng } from '../utils/Rng';
import { clearRecoveryState } from './recovery/RecoveryMoveLeaf';
import {
  DEFAULT_RECOVERY_BLACKBOARD,
  type RecoveryAction,
  type RecoveryBlackboardSchema,
  type RecoveryContext,
  type RecoverySelfSnapshot,
  type RecoveryStageGeometry,
} from './recovery/types';
import {
  buildReliableRecoverySubtree,
  isRecoverySituation,
  resolveReliableRecoverySubtreeOptions,
} from './recoveryBehavior';

const STAGE: RecoveryStageGeometry = {
  stageLeft: -800,
  stageRight: 800,
  stageTop: 400,
  blastZone: { left: -1200, right: 1200, top: -800, bottom: 900 },
  nearestLedge: { x: -800, y: 400, side: 'left' },
};

interface Harness {
  ctx: RecoveryContext;
  emits: RecoveryAction[];
  blackboard: Blackboard<RecoveryBlackboardSchema>;
  setSelf(p: Partial<RecoverySelfSnapshot>): void;
  setStage(p: Partial<RecoveryStageGeometry>): void;
  bumpTick(n?: number): void;
}

function makeHarness(initial: Partial<RecoverySelfSnapshot> = {}): Harness {
  const emits: RecoveryAction[] = [];
  const blackboard = new Blackboard<RecoveryBlackboardSchema>({
    ...DEFAULT_RECOVERY_BLACKBOARD,
  });
  let self: RecoverySelfSnapshot = {
    positionX: -900,
    positionY: 600,
    velocityX: 0,
    velocityY: 0,
    facing: 1,
    isAirborne: true,
    jumpsRemaining: 1,
    upSpecialAvailable: true,
    isInHitstun: false,
    isOnLedge: false,
    ...initial,
  };
  let stage: RecoveryStageGeometry = STAGE;
  let tickIndex = 0;
  const ctx: RecoveryContext = {
    blackboard,
    get tickIndex() {
      return tickIndex;
    },
    get self() {
      return self;
    },
    get stage() {
      return stage;
    },
    out: { emit: (a) => emits.push(a) },
    rng: new Rng(1),
  } as RecoveryContext;
  return {
    ctx,
    emits,
    blackboard,
    setSelf(p) {
      self = { ...self, ...p };
    },
    setStage(p) {
      stage = { ...stage, ...p };
    },
    bumpTick(n = 1) {
      tickIndex += n;
    },
  };
}

// ---------------------------------------------------------------------------
// resolveReliableRecoverySubtreeOptions
// ---------------------------------------------------------------------------

describe('resolveReliableRecoverySubtreeOptions', () => {
  it('fills in documented defaults for every leaf and the outer gate', () => {
    const r = resolveReliableRecoverySubtreeOptions();

    expect(r.jump.repressCooldownFrames).toBe(8);
    expect(r.jump.verticalSlackPx).toBe(0);

    expect(r.doubleJump.repressCooldownFrames).toBe(12);
    expect(r.doubleJump.ledgeBelowThresholdPx).toBe(40);
    expect(r.doubleJump.blastZoneLookaheadFrames).toBe(30);
    expect(r.doubleJump.verticalSlackPx).toBe(0);

    expect(r.upSpecial.blastZoneLookaheadFrames).toBe(60);
    expect(r.upSpecial.verticalSlackPx).toBe(0);
    expect(r.upSpecial.emitMoveUp).toBe(true);
    expect(r.upSpecial.emitDirectionalNudge).toBe(true);

    expect(r.ledgeReturn.arrivalToleranceXPx).toBe(12);
    expect(r.ledgeReturn.overshootToleranceYPx).toBe(8);

    expect(r.outerVerticalSlackPx).toBe(0);
  });

  it('honours explicit per-leaf overrides verbatim', () => {
    const r = resolveReliableRecoverySubtreeOptions({
      jump: { repressCooldownFrames: 4 },
      doubleJump: {
        ledgeBelowThresholdPx: 80,
        blastZoneLookaheadFrames: 15,
      },
      upSpecial: { emitMoveUp: false, emitDirectionalNudge: false },
      ledgeReturn: { arrivalToleranceXPx: 4 },
      outerVerticalSlackPx: 6,
    });
    expect(r.jump.repressCooldownFrames).toBe(4);
    expect(r.doubleJump.ledgeBelowThresholdPx).toBe(80);
    expect(r.doubleJump.blastZoneLookaheadFrames).toBe(15);
    expect(r.upSpecial.emitMoveUp).toBe(false);
    expect(r.upSpecial.emitDirectionalNudge).toBe(false);
    expect(r.ledgeReturn.arrivalToleranceXPx).toBe(4);
    expect(r.outerVerticalSlackPx).toBe(6);
  });

  it('rejects negative outerVerticalSlackPx', () => {
    expect(() =>
      resolveReliableRecoverySubtreeOptions({ outerVerticalSlackPx: -1 }),
    ).toThrow(/outerVerticalSlackPx/);
  });

  it('rejects non-finite outerVerticalSlackPx', () => {
    expect(() =>
      resolveReliableRecoverySubtreeOptions({
        outerVerticalSlackPx: Number.NaN,
      }),
    ).toThrow(/outerVerticalSlackPx/);
  });

  it('produces structurally-equal output on repeated calls (purity)', () => {
    const a = resolveReliableRecoverySubtreeOptions({
      jump: { repressCooldownFrames: 5 },
    });
    const b = resolveReliableRecoverySubtreeOptions({
      jump: { repressCooldownFrames: 5 },
    });
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// isRecoverySituation
// ---------------------------------------------------------------------------

describe('isRecoverySituation', () => {
  it('returns false for hitstun (lockout takes priority)', () => {
    const h = makeHarness({ isInHitstun: true });
    expect(isRecoverySituation(h.ctx)).toBe(false);
  });

  it('returns false when latched on a ledge', () => {
    const h = makeHarness({ isOnLedge: true });
    expect(isRecoverySituation(h.ctx)).toBe(false);
  });

  it('returns false when grounded (even past the stage edge)', () => {
    const h = makeHarness({
      isAirborne: false,
      positionX: -1500,
      positionY: 400,
    });
    expect(isRecoverySituation(h.ctx)).toBe(false);
  });

  it('returns false when airborne but on stage', () => {
    const h = makeHarness({
      positionX: 0,
      positionY: 200, // above stageTop=400 ⇒ on-stage Y
    });
    expect(isRecoverySituation(h.ctx)).toBe(false);
  });

  it('returns true when airborne and past the left edge', () => {
    const h = makeHarness({ positionX: -900, positionY: 200 });
    expect(isRecoverySituation(h.ctx)).toBe(true);
  });

  it('returns true when airborne and below the stage top', () => {
    const h = makeHarness({ positionX: 0, positionY: 600 });
    expect(isRecoverySituation(h.ctx)).toBe(true);
  });

  it('respects an explicit verticalSlackPx for the off-stage check', () => {
    const h = makeHarness({ positionX: 0, positionY: 405 });
    // With slack=10 the bot at y=405 is still considered on-stage
    // (stageTop=400 → off-stage threshold 410).
    expect(isRecoverySituation(h.ctx, 10)).toBe(false);
    // With slack=0 (default) the bot at y=405 is off-stage.
    expect(isRecoverySituation(h.ctx, 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildReliableRecoverySubtree — root structure
// ---------------------------------------------------------------------------

describe('buildReliableRecoverySubtree — structure', () => {
  it('returns a node named "recoveryBehavior.offStageGate"', () => {
    const root = buildReliableRecoverySubtree();
    expect(root.name).toBe('recoveryBehavior.offStageGate');
  });

  it('factory accepts no arguments and returns a tickable node', () => {
    const root = buildReliableRecoverySubtree();
    const tree = new BehaviorTree(root);
    const h = makeHarness({
      isAirborne: false,
      positionX: 0,
      positionY: 200,
    });
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildReliableRecoverySubtree — outer gate short-circuit
// ---------------------------------------------------------------------------

describe('buildReliableRecoverySubtree — outer gate', () => {
  it('on-stage / grounded → Failure (no recovery work to do)', () => {
    const root = buildReliableRecoverySubtree();
    const h = makeHarness({
      isAirborne: false,
      positionX: 0,
      positionY: 200,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('hitstun → Failure (lockout) — no inner branch can fire', () => {
    const root = buildReliableRecoverySubtree();
    const h = makeHarness({
      isInHitstun: true,
      positionX: -900,
      positionY: 600,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('on a ledge → Failure (let the ledge handler run)', () => {
    const root = buildReliableRecoverySubtree();
    const h = makeHarness({ isOnLedge: true });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('airborne but on-stage → Failure (conserve recovery resources)', () => {
    const root = buildReliableRecoverySubtree();
    const h = makeHarness({ positionX: 0, positionY: 200 });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildReliableRecoverySubtree — inner branch priority
// ---------------------------------------------------------------------------

describe('buildReliableRecoverySubtree — branch priority', () => {
  it('off-stage with jumps available → first-jump leaf fires', () => {
    const root = buildReliableRecoverySubtree();
    const h = makeHarness({
      jumpsRemaining: 2,
      positionX: -900,
      positionY: 350, // off-stage by X (left=-800)
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([
      { kind: 'jump', recoveryStep: 'jumpRecovery' },
    ]);
    // Phase advanced to airJumping per the JumpRecoveryLeaf contract.
    expect(h.blackboard.get('recoveryPhase')).toBe('airJumping');
  });

  it('off-stage with jumps spent and no blast danger → up-special fires', () => {
    const root = buildReliableRecoverySubtree();
    const h = makeHarness({
      jumpsRemaining: 0,
      upSpecialAvailable: true,
      positionX: -900,
      positionY: 600,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toContainEqual({
      kind: 'upSpecial',
      recoveryStep: 'upSpecial.commit',
    });
    expect(h.blackboard.get('recoveryPhase')).toBe('upSpecial');
  });

  it('off-stage with up-special pressed and aligned vertically → ledge-return takes over', () => {
    const root = buildReliableRecoverySubtree();
    const h = makeHarness({
      jumpsRemaining: 0,
      upSpecialAvailable: false,
      positionY: 400, // aligned with ledge Y
      positionX: -900, // 100 px left of ledge X
    });
    // Stamp the up-special tick so RecoveryMoveLeaf stays inert.
    h.blackboard.set('recoveryLastUpSpecialTick', 0);
    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([
      { kind: 'moveRight', recoveryStep: 'ledge.return' },
    ]);
    expect(h.blackboard.get('recoveryPhase')).toBe('ledgeReturn');
  });

  it('imminent blast-zone danger with air-jumps spent → up-special fires (blast escalation)', () => {
    // Documents the canonical blast-zone escalation path: once the
    // bot's air-jumps are spent and the trajectory will cross a blast
    // wall within `blastZoneLookaheadFrames`, the up-special leaf
    // commits even though the conservation gate would otherwise still
    // wait. The first-jump leaf fails (no jumps left) and the
    // double-jump leaf falls through, surfacing the up-special.
    const root = buildReliableRecoverySubtree();
    const h = makeHarness({
      jumpsRemaining: 0,
      upSpecialAvailable: true,
      positionX: -1100,
      positionY: 600,
      velocityX: -10, // streaming toward the left blast wall
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toContainEqual({
      kind: 'upSpecial',
      recoveryStep: 'upSpecial.commit',
    });
  });
});

// ---------------------------------------------------------------------------
// buildReliableRecoverySubtree — full recovery scenario
// ---------------------------------------------------------------------------

describe('buildReliableRecoverySubtree — end-to-end recovery scenario', () => {
  it('jump → up-special → ledge-return → ledge grab walks the bot home', () => {
    const root = buildReliableRecoverySubtree();
    const h = makeHarness({
      // Bot got knocked off-stage at low height.
      positionX: -900,
      positionY: 600,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });

    // Tick 0 — first-jump leaf consumes the air-jump.
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toContainEqual({
      kind: 'jump',
      recoveryStep: 'jumpRecovery',
    });
    h.emits.length = 0;

    // Engine: jump consumed, bot still falling. Cooldown over after
    // 4 ticks (DEFAULT_REPRESS_COOLDOWN_FRAMES = 8 at the leaf, but
    // we're moving to the up-special branch by spending the budget).
    h.bumpTick(4);
    h.setSelf({ jumpsRemaining: 0 });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toContainEqual({
      kind: 'upSpecial',
      recoveryStep: 'upSpecial.commit',
    });
    h.emits.length = 0;

    // Up-special boost lifted the bot to ledge height; now drift in.
    h.setSelf({
      positionY: 405, // just below ledge by 5
      upSpecialAvailable: false,
    });
    h.bumpTick(20);
    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toContainEqual({
      kind: 'moveRight',
      recoveryStep: 'ledge.return',
    });
    h.emits.length = 0;

    // Ledge grab fires — outer gate flips, subtree returns Failure
    // (let the controller's ledge-release handler run).
    h.setSelf({ isOnLedge: true });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
  });
});

// ---------------------------------------------------------------------------
// buildReliableRecoverySubtree — option propagation
// ---------------------------------------------------------------------------

describe('buildReliableRecoverySubtree — option propagation', () => {
  it('propagates a relaxed jump re-press cooldown into the first-jump leaf', () => {
    // With cooldown=0 the first-jump leaf should re-fire on the very
    // next tick. Without the override (default 8 frames) the leaf
    // would be inert — so this test catches a regression where the
    // option fails to thread into the leaf constructor.
    const root = buildReliableRecoverySubtree({
      jump: { repressCooldownFrames: 0 },
    });
    const h = makeHarness({
      jumpsRemaining: 2,
      positionX: -900,
      positionY: 350,
    });

    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toContainEqual({
      kind: 'jump',
      recoveryStep: 'jumpRecovery',
    });
    h.emits.length = 0;

    h.bumpTick(1);
    // Cooldown=0 means the leaf can re-press immediately.
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toContainEqual({
      kind: 'jump',
      recoveryStep: 'jumpRecovery',
    });
  });

  it('respects the default re-press cooldown (no override)', () => {
    // Mirror of the test above with default cooldown=8: the second
    // tick at offset=1 should NOT fire the first-jump leaf again.
    // Pinned as a regression guard so the leaf-internal default and
    // this file's documentation stay in sync.
    const root = buildReliableRecoverySubtree();
    const h = makeHarness({
      jumpsRemaining: 2,
      positionX: -900,
      positionY: 350,
    });

    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    h.emits.length = 0;

    h.bumpTick(1);
    // First-jump cooldown active → leaf returns Failure. The
    // Selector falls through to the double-jump leaf which fires
    // its own jump press (its cooldown also derives from
    // recoveryLastAirJumpTick=0 but the gates differ — DJ checks
    // ledge offset, not just the cooldown).
    const status = root.tick(h.ctx);
    // Either DJ fires or every branch fails depending on geometry —
    // the only invariant we assert is "the same first-jump press
    // does NOT re-fire" (regression guard for cooldown propagation).
    if (status === NodeStatus.Success) {
      expect(h.emits.find((e) => e.recoveryStep === 'jumpRecovery')).toBeUndefined();
    } else {
      expect(h.emits).toEqual([]);
    }
  });

  it('propagates ledgeReturn arrival tolerance into the ledge-return leaf', () => {
    // Bot is 20 px LEFT of the (left-side) ledge column (ledge x=-800,
    // bot x=-820 — past the stage edge). With a tight 1 px tolerance,
    // 20 px > 1 px so the leaf still pushes horizontally toward the
    // ledge. ledgeXOffset = -800 - (-820) = 20 (positive ⇒ ledge to
    // the right ⇒ push right). This is a regression guard: an
    // unintended override that swapped a fixed tolerance for the
    // leaf's default would break the test.
    const root = buildReliableRecoverySubtree({
      ledgeReturn: { arrivalToleranceXPx: 1 },
    });
    const h = makeHarness({
      jumpsRemaining: 0,
      upSpecialAvailable: false,
      positionX: -820, // 20 px LEFT of ledge x=-800 (off-stage)
      positionY: 400,
    });
    h.blackboard.set('recoveryLastUpSpecialTick', 0);

    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toContainEqual({
      kind: 'moveRight',
      recoveryStep: 'ledge.return',
    });
  });

  it('respects a relaxed ledgeReturn arrival tolerance (idle when within band)', () => {
    // With arrivalToleranceXPx=30, a 20 px deficit is within the
    // tolerance band and the leaf emits `idle` rather than pushing.
    // Pairs with the test above to lock the option propagation in
    // both directions.
    const root = buildReliableRecoverySubtree({
      ledgeReturn: { arrivalToleranceXPx: 30 },
    });
    const h = makeHarness({
      jumpsRemaining: 0,
      upSpecialAvailable: false,
      positionX: -820,
      positionY: 400,
    });
    h.blackboard.set('recoveryLastUpSpecialTick', 0);

    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toContainEqual({
      kind: 'idle',
      recoveryStep: 'ledge.arrive',
    });
  });

  it('honours an explicit outerVerticalSlackPx value', () => {
    // With slack=10, a bot just barely below the stage top (y=405)
    // is still considered on-stage by the outer gate; the inner
    // Selector never ticks.
    const root = buildReliableRecoverySubtree({
      outerVerticalSlackPx: 10,
    });
    const h = makeHarness({
      jumpsRemaining: 0,
      upSpecialAvailable: true,
      positionX: 0,
      positionY: 405,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildReliableRecoverySubtree — determinism
// ---------------------------------------------------------------------------

describe('buildReliableRecoverySubtree — determinism', () => {
  it('two subtrees built with identical options produce identical emits', () => {
    const a = buildReliableRecoverySubtree();
    const b = buildReliableRecoverySubtree();
    const ha = makeHarness({
      positionX: -900,
      positionY: 600,
      jumpsRemaining: 1,
    });
    const hb = makeHarness({
      positionX: -900,
      positionY: 600,
      jumpsRemaining: 1,
    });
    for (let i = 0; i < 30; i += 1) {
      ha.bumpTick();
      hb.bumpTick();
      expect(a.tick(ha.ctx)).toBe(b.tick(hb.ctx));
      expect(ha.emits).toEqual(hb.emits);
    }
  });

  it('plays nicely with the BehaviorTree runner — reset clears recovery state', () => {
    const root = buildReliableRecoverySubtree();
    const tree = new BehaviorTree<RecoveryContext, RecoveryBlackboardSchema>(
      root,
      { initialBlackboard: { ...DEFAULT_RECOVERY_BLACKBOARD } },
    );
    const h = makeHarness({
      jumpsRemaining: 0,
      upSpecialAvailable: true,
      positionY: 600,
    });
    Object.defineProperty(h.ctx, 'blackboard', {
      value: tree.getBlackboard(),
      configurable: true,
    });
    tree.tick(h.ctx);
    expect(tree.getBlackboard().get('recoveryPhase')).toBe('upSpecial');

    tree.reset();
    expect(tree.getBlackboard().get('recoveryPhase')).toBe('idle');
    expect(tree.getBlackboard().get('recoveryLastUpSpecialTick')).toBe(-1);
  });

  it('clearRecoveryState restores the partition for the standard idempotent landing handler', () => {
    const root = buildReliableRecoverySubtree();
    const h = makeHarness({
      jumpsRemaining: 0,
      upSpecialAvailable: true,
      positionY: 600,
    });
    root.tick(h.ctx);
    expect(h.blackboard.get('recoveryPhase')).toBe('upSpecial');
    clearRecoveryState(h.blackboard);
    expect(h.blackboard.get('recoveryPhase')).toBe('idle');
    expect(h.blackboard.get('recoveryPhaseStartTick')).toBe(-1);
    expect(h.blackboard.get('recoveryLastAirJumpTick')).toBe(-1);
    expect(h.blackboard.get('recoveryLastUpSpecialTick')).toBe(-1);
  });
});
