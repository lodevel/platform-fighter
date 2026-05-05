import { describe, expect, it } from 'vitest';
import { Blackboard } from '../behaviorTree/Blackboard';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';
import { JumpRecoveryLeaf } from './JumpRecoveryLeaf';
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
    positionY: 200,
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

describe('JumpRecoveryLeaf — construction validation', () => {
  it('rejects negative repressCooldownFrames', () => {
    expect(
      () => new JumpRecoveryLeaf({ repressCooldownFrames: -1 }),
    ).toThrow(/repressCooldownFrames/);
  });
  it('rejects non-integer repressCooldownFrames', () => {
    expect(
      () => new JumpRecoveryLeaf({ repressCooldownFrames: 1.5 }),
    ).toThrow(/repressCooldownFrames/);
  });
  it('rejects negative verticalSlackPx', () => {
    expect(
      () => new JumpRecoveryLeaf({ verticalSlackPx: -3 }),
    ).toThrow(/verticalSlackPx/);
  });
});

describe('JumpRecoveryLeaf — gating', () => {
  it('returns Failure during hitstun', () => {
    const leaf = new JumpRecoveryLeaf();
    const h = makeHarness({ isInHitstun: true });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when on ledge', () => {
    const leaf = new JumpRecoveryLeaf();
    const h = makeHarness({ isOnLedge: true });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when grounded (no recovery needed)', () => {
    const leaf = new JumpRecoveryLeaf();
    const h = makeHarness({ isAirborne: false });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when airborne but on-stage (conserve air-jump)', () => {
    const leaf = new JumpRecoveryLeaf();
    const h = makeHarness({ positionX: 0, positionY: 200 });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when no jumps remaining', () => {
    const leaf = new JumpRecoveryLeaf();
    const h = makeHarness({ jumpsRemaining: 0 });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

describe('JumpRecoveryLeaf — emit', () => {
  it('emits jump and updates blackboard when off-stage with jumps remaining', () => {
    const leaf = new JumpRecoveryLeaf();
    const h = makeHarness();
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([
      { kind: 'jump', recoveryStep: 'jumpRecovery' },
    ]);
    expect(h.blackboard.get('recoveryLastAirJumpTick')).toBe(0);
    expect(h.blackboard.get('recoveryPhase')).toBe('airJumping');
    expect(h.blackboard.get('recoveryPhaseStartTick')).toBe(0);
  });

  it('honours re-press cooldown — second tick within cooldown is Failure', () => {
    const leaf = new JumpRecoveryLeaf({ repressCooldownFrames: 8 });
    const h = makeHarness();
    leaf.tick(h.ctx); // first jump at tick 0
    h.emits.length = 0;
    h.bumpTick(3); // tick 3, still inside cooldown
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('re-fires once cooldown elapses if still off-stage', () => {
    const leaf = new JumpRecoveryLeaf({ repressCooldownFrames: 8 });
    const h = makeHarness({ jumpsRemaining: 2 });
    leaf.tick(h.ctx); // tick 0 — fire
    h.emits.length = 0;
    h.bumpTick(8); // tick 8 — cooldown elapsed
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toEqual([
      { kind: 'jump', recoveryStep: 'jumpRecovery' },
    ]);
    expect(h.blackboard.get('recoveryLastAirJumpTick')).toBe(8);
  });
});

describe('JumpRecoveryLeaf — determinism', () => {
  it('two leaves with identical config produce identical status + emits', () => {
    const a = new JumpRecoveryLeaf();
    const b = new JumpRecoveryLeaf();
    const ha = makeHarness();
    const hb = makeHarness();
    expect(a.tick(ha.ctx)).toBe(b.tick(hb.ctx));
    expect(ha.emits).toEqual(hb.emits);
    expect(ha.blackboard.get('recoveryPhase')).toBe(
      hb.blackboard.get('recoveryPhase'),
    );
  });
});
