import { describe, expect, it } from 'vitest';
import { Blackboard } from '../behaviorTree/Blackboard';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';
import { DoubleJumpRecoveryLeaf } from './DoubleJumpRecoveryLeaf';
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
  bumpTick(n?: number): void;
}

function makeHarness(initial: Partial<RecoverySelfSnapshot> = {}): Harness {
  const emits: RecoveryAction[] = [];
  const blackboard = new Blackboard<RecoveryBlackboardSchema>({
    ...DEFAULT_RECOVERY_BLACKBOARD,
  });
  let self: RecoverySelfSnapshot = {
    positionX: -900,
    // Below ledge by 200 px to satisfy default ledgeBelowThresholdPx (40).
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
  let tickIndex = 0;
  const ctx: RecoveryContext = {
    blackboard,
    get tickIndex() {
      return tickIndex;
    },
    get self() {
      return self;
    },
    stage: STAGE,
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
    bumpTick(n = 1) {
      tickIndex += n;
    },
  };
}

describe('DoubleJumpRecoveryLeaf — construction validation', () => {
  it('rejects negative repressCooldownFrames', () => {
    expect(
      () => new DoubleJumpRecoveryLeaf({ repressCooldownFrames: -1 }),
    ).toThrow(/repressCooldownFrames/);
  });
  it('rejects negative ledgeBelowThresholdPx', () => {
    expect(
      () => new DoubleJumpRecoveryLeaf({ ledgeBelowThresholdPx: -1 }),
    ).toThrow(/ledgeBelowThresholdPx/);
  });
  it('rejects negative blastZoneLookaheadFrames', () => {
    expect(
      () => new DoubleJumpRecoveryLeaf({ blastZoneLookaheadFrames: -1 }),
    ).toThrow(/blastZoneLookaheadFrames/);
  });
  it('rejects non-integer blastZoneLookaheadFrames', () => {
    expect(
      () => new DoubleJumpRecoveryLeaf({ blastZoneLookaheadFrames: 2.5 }),
    ).toThrow(/blastZoneLookaheadFrames/);
  });
  it('rejects negative verticalSlackPx', () => {
    expect(
      () => new DoubleJumpRecoveryLeaf({ verticalSlackPx: -1 }),
    ).toThrow(/verticalSlackPx/);
  });
});

describe('DoubleJumpRecoveryLeaf — gating', () => {
  it('returns Failure during hitstun', () => {
    const h = makeHarness({ isInHitstun: true });
    expect(new DoubleJumpRecoveryLeaf().tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when on ledge', () => {
    const h = makeHarness({ isOnLedge: true });
    expect(new DoubleJumpRecoveryLeaf().tick(h.ctx)).toBe(NodeStatus.Failure);
  });

  it('returns Failure when grounded', () => {
    const h = makeHarness({ isAirborne: false });
    expect(new DoubleJumpRecoveryLeaf().tick(h.ctx)).toBe(NodeStatus.Failure);
  });

  it('returns Failure when on-stage even if airborne', () => {
    const h = makeHarness({ positionX: 0, positionY: 200 });
    expect(new DoubleJumpRecoveryLeaf().tick(h.ctx)).toBe(NodeStatus.Failure);
  });

  it('returns Failure when no air-jumps remain', () => {
    const h = makeHarness({ jumpsRemaining: 0 });
    expect(new DoubleJumpRecoveryLeaf().tick(h.ctx)).toBe(NodeStatus.Failure);
  });

  it('returns Failure when ledge is in reach (above threshold) and not approaching blast zone', () => {
    // Bot only slightly below ledge — no need to spend air-jump.
    const h = makeHarness({ positionY: 410, velocityX: 0, velocityY: 0 });
    expect(new DoubleJumpRecoveryLeaf().tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

describe('DoubleJumpRecoveryLeaf — emit', () => {
  it('emits jump when below ledge by more than threshold', () => {
    const leaf = new DoubleJumpRecoveryLeaf();
    const h = makeHarness({ positionY: 600 }); // 200 px below ledge
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([
      { kind: 'jump', recoveryStep: 'doubleJumpRecovery' },
    ]);
    expect(h.blackboard.get('recoveryLastAirJumpTick')).toBe(0);
    expect(h.blackboard.get('recoveryPhase')).toBe('airJumping');
  });

  it('emits jump when approaching blast zone even if ledge is close', () => {
    const leaf = new DoubleJumpRecoveryLeaf();
    // Ledge above threshold (only 30 px below) but careening toward
    // the bottom blast wall.
    const h = makeHarness({
      positionY: 430,
      velocityY: 30,
    });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([
      { kind: 'jump', recoveryStep: 'doubleJumpRecovery' },
    ]);
  });

  it('honours re-press cooldown — second tick within cooldown is Failure', () => {
    const leaf = new DoubleJumpRecoveryLeaf({ repressCooldownFrames: 12 });
    const h = makeHarness({ jumpsRemaining: 2 });
    leaf.tick(h.ctx);
    h.emits.length = 0;
    h.bumpTick(5);
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('re-fires once cooldown elapses if still below threshold', () => {
    const leaf = new DoubleJumpRecoveryLeaf({ repressCooldownFrames: 12 });
    const h = makeHarness({ jumpsRemaining: 2 });
    leaf.tick(h.ctx);
    h.emits.length = 0;
    h.bumpTick(12);
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([
      { kind: 'jump', recoveryStep: 'doubleJumpRecovery' },
    ]);
  });
});

describe('DoubleJumpRecoveryLeaf — determinism', () => {
  it('two leaves with identical config produce identical status + emits', () => {
    const a = new DoubleJumpRecoveryLeaf();
    const b = new DoubleJumpRecoveryLeaf();
    const ha = makeHarness();
    const hb = makeHarness();
    expect(a.tick(ha.ctx)).toBe(b.tick(hb.ctx));
    expect(ha.emits).toEqual(hb.emits);
  });
});
