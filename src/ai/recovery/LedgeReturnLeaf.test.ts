import { describe, expect, it } from 'vitest';
import { Blackboard } from '../behaviorTree/Blackboard';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';
import { LedgeReturnLeaf } from './LedgeReturnLeaf';
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
    positionY: 400, // Same Y as ledge — aligned vertically.
    velocityX: 0,
    velocityY: 0,
    facing: 1,
    isAirborne: true,
    jumpsRemaining: 0,
    upSpecialAvailable: false,
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

describe('LedgeReturnLeaf — construction validation', () => {
  it('rejects negative arrivalToleranceXPx', () => {
    expect(
      () => new LedgeReturnLeaf({ arrivalToleranceXPx: -1 }),
    ).toThrow(/arrivalToleranceXPx/);
  });
  it('rejects negative overshootToleranceYPx', () => {
    expect(
      () => new LedgeReturnLeaf({ overshootToleranceYPx: -1 }),
    ).toThrow(/overshootToleranceYPx/);
  });
});

describe('LedgeReturnLeaf — gating', () => {
  it('returns Failure during hitstun', () => {
    const h = makeHarness({ isInHitstun: true });
    expect(new LedgeReturnLeaf().tick(h.ctx)).toBe(NodeStatus.Failure);
  });

  it('returns Success when on ledge (recovery complete)', () => {
    const h = makeHarness({ isOnLedge: true });
    expect(new LedgeReturnLeaf().tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.blackboard.get('recoveryPhase')).toBe('idle');
  });

  it('returns Failure when grounded', () => {
    const h = makeHarness({ isAirborne: false });
    expect(new LedgeReturnLeaf().tick(h.ctx)).toBe(NodeStatus.Failure);
  });

  it('returns Failure when bot has drifted into safe X range and above stageTop', () => {
    const h = makeHarness({ positionX: 0, positionY: 200 });
    expect(new LedgeReturnLeaf().tick(h.ctx)).toBe(NodeStatus.Failure);
  });

  it('returns Failure when no nearest ledge registered', () => {
    const h = makeHarness();
    h.setStage({ nearestLedge: null });
    expect(new LedgeReturnLeaf().tick(h.ctx)).toBe(NodeStatus.Failure);
  });

  it('returns Failure when bot is above the ledge by more than overshoot tolerance', () => {
    const h = makeHarness({ positionY: 350 }); // ledge at 400, bot 50 px above
    expect(new LedgeReturnLeaf().tick(h.ctx)).toBe(NodeStatus.Failure);
  });
});

describe('LedgeReturnLeaf — emit', () => {
  it('emits moveRight when ledge is to the right', () => {
    const leaf = new LedgeReturnLeaf();
    // Bot at -900, ledge at -800 → dx = +100 → moveRight.
    const h = makeHarness();
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([
      { kind: 'moveRight', recoveryStep: 'ledge.return' },
    ]);
    expect(h.blackboard.get('recoveryPhase')).toBe('ledgeReturn');
    expect(h.blackboard.get('recoveryPhaseStartTick')).toBe(0);
  });

  it('emits moveLeft when ledge is to the left', () => {
    const leaf = new LedgeReturnLeaf();
    const h = makeHarness();
    h.setStage({ nearestLedge: { x: 800, y: 400, side: 'right' } });
    h.setSelf({ positionX: 900 });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([
      { kind: 'moveLeft', recoveryStep: 'ledge.return' },
    ]);
  });

  it('emits idle (no horizontal push) when within arrival tolerance', () => {
    const leaf = new LedgeReturnLeaf({ arrivalToleranceXPx: 12 });
    // Bot 5 px past ledge column.
    const h = makeHarness({ positionX: -795 });
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Running);
    expect(h.emits).toEqual([
      { kind: 'idle', recoveryStep: 'ledge.arrive' },
    ]);
  });
});

describe('LedgeReturnLeaf — determinism', () => {
  it('two leaves with identical config produce identical status + emits', () => {
    const a = new LedgeReturnLeaf();
    const b = new LedgeReturnLeaf();
    const ha = makeHarness();
    const hb = makeHarness();
    expect(a.tick(ha.ctx)).toBe(b.tick(hb.ctx));
    expect(ha.emits).toEqual(hb.emits);
  });
});
