import { describe, expect, it } from 'vitest';
import { Blackboard } from '../behaviorTree/Blackboard';
import { BehaviorTree } from '../behaviorTree/BehaviorTree';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';
import {
  buildHardRecoveryTree,
  resolveHardRecoveryTreeOptions,
} from './HardRecoveryTree';
import { clearRecoveryState } from './RecoveryMoveLeaf';
import {
  DEFAULT_RECOVERY_BLACKBOARD,
  type RecoveryAction,
  type RecoveryBlackboardSchema,
  type RecoveryContext,
  type RecoverySelfSnapshot,
  type RecoveryStageGeometry,
} from './types';

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

describe('resolveHardRecoveryTreeOptions', () => {
  it('fills in defaults', () => {
    const r = resolveHardRecoveryTreeOptions();
    expect(r.jump.repressCooldownFrames).toBe(8);
    expect(r.doubleJump.repressCooldownFrames).toBe(12);
    expect(r.doubleJump.ledgeBelowThresholdPx).toBe(40);
    expect(r.doubleJump.blastZoneLookaheadFrames).toBe(30);
    expect(r.upSpecial.blastZoneLookaheadFrames).toBe(60);
    expect(r.upSpecial.emitMoveUp).toBe(true);
    expect(r.upSpecial.emitDirectionalNudge).toBe(true);
    expect(r.ledgeReturn.arrivalToleranceXPx).toBe(12);
    expect(r.ledgeReturn.overshootToleranceYPx).toBe(8);
  });

  it('honours explicit overrides', () => {
    const r = resolveHardRecoveryTreeOptions({
      jump: { repressCooldownFrames: 4 },
      doubleJump: {
        ledgeBelowThresholdPx: 80,
        blastZoneLookaheadFrames: 15,
      },
      upSpecial: { emitMoveUp: false, emitDirectionalNudge: false },
      ledgeReturn: { arrivalToleranceXPx: 4 },
    });
    expect(r.jump.repressCooldownFrames).toBe(4);
    expect(r.doubleJump.ledgeBelowThresholdPx).toBe(80);
    expect(r.doubleJump.blastZoneLookaheadFrames).toBe(15);
    expect(r.upSpecial.emitMoveUp).toBe(false);
    expect(r.upSpecial.emitDirectionalNudge).toBe(false);
    expect(r.ledgeReturn.arrivalToleranceXPx).toBe(4);
  });
});

describe('buildHardRecoveryTree — branch priority', () => {
  it('on-stage / grounded → Failure (no recovery work to do)', () => {
    const root = buildHardRecoveryTree();
    const h = makeHarness({
      isAirborne: false,
      positionX: 0,
      positionY: 200,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('off-stage with jumps available → first jump branch fires', () => {
    const root = buildHardRecoveryTree();
    const h = makeHarness({
      jumpsRemaining: 2,
      positionY: 350, // above the ledge — first jump leaf still fires
                       //  because off-stage check uses X
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([
      { kind: 'jump', recoveryStep: 'jumpRecovery' },
    ]);
  });

  it('after jumps spent and no blast danger → up-special fires', () => {
    const root = buildHardRecoveryTree();
    const h = makeHarness({
      jumpsRemaining: 0,
      upSpecialAvailable: true,
      positionY: 600,
    });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toContainEqual({
      kind: 'upSpecial',
      recoveryStep: 'upSpecial.commit',
    });
  });

  it('after up-special pressed → ledge-return takes over once aligned vertically', () => {
    const root = buildHardRecoveryTree();
    const h = makeHarness({
      jumpsRemaining: 0,
      upSpecialAvailable: false,
      positionY: 400, // aligned with ledge Y
      positionX: -900, // 100 px left of ledge X
    });
    // Stamp the up-special tick to keep RecoveryMoveLeaf inert.
    h.blackboard.set('recoveryLastUpSpecialTick', 0);
    expect(root.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([
      { kind: 'moveRight', recoveryStep: 'ledge.return' },
    ]);
    expect(h.blackboard.get('recoveryPhase')).toBe('ledgeReturn');
  });

  it('once on ledge → Success and phase resets to idle', () => {
    const root = buildHardRecoveryTree();
    const h = makeHarness({ isOnLedge: true });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.blackboard.get('recoveryPhase')).toBe('idle');
  });

  it('hitstun blocks every branch — Selector returns Failure', () => {
    const root = buildHardRecoveryTree();
    const h = makeHarness({ isInHitstun: true });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

describe('buildHardRecoveryTree — full recovery scenario', () => {
  it('jump → up-special → ledge return sequence drives the bot home', () => {
    const root = buildHardRecoveryTree();
    const h = makeHarness({
      // Bot got knocked off-stage at low height.
      positionX: -900,
      positionY: 600,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });

    // Tick 0 — first jump leaf consumes the air-jump.
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toContainEqual({
      kind: 'jump',
      recoveryStep: 'jumpRecovery',
    });
    h.emits.length = 0;

    // Simulate engine: jump consumed, bot still falling but cooldown not over.
    h.bumpTick(4);
    h.setSelf({ jumpsRemaining: 0 });
    // Ledge above threshold but air-jumps spent → up-special leaf
    // owns the next press.
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

    // Ledge grab fires.
    h.setSelf({ isOnLedge: true });
    expect(root.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.blackboard.get('recoveryPhase')).toBe('idle');
  });
});

describe('buildHardRecoveryTree — determinism', () => {
  it('two trees produce identical tick sequences across many frames', () => {
    const a = buildHardRecoveryTree();
    const b = buildHardRecoveryTree();
    const ha = makeHarness();
    const hb = makeHarness();
    for (let i = 0; i < 30; i += 1) {
      ha.bumpTick();
      hb.bumpTick();
      expect(a.tick(ha.ctx)).toBe(b.tick(hb.ctx));
      expect(ha.emits).toEqual(hb.emits);
    }
  });

  it('plays nicely with BehaviorTree runner — reset clears recovery state', () => {
    const root = buildHardRecoveryTree();
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

  it('clearRecoveryState restores the partition to defaults (idempotent landing handler)', () => {
    const root = buildHardRecoveryTree();
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
