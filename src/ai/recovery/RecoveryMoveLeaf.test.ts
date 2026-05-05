import { describe, expect, it } from 'vitest';
import { Blackboard } from '../behaviorTree/Blackboard';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';
import { RecoveryMoveLeaf, clearRecoveryState } from './RecoveryMoveLeaf';
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
    positionY: 600,
    velocityX: 0,
    velocityY: 0,
    facing: -1,
    isAirborne: true,
    jumpsRemaining: 0, // air-jumps spent → up-special should fire
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

describe('RecoveryMoveLeaf — construction validation', () => {
  it('rejects negative blastZoneLookaheadFrames', () => {
    expect(
      () => new RecoveryMoveLeaf({ blastZoneLookaheadFrames: -1 }),
    ).toThrow(/blastZoneLookaheadFrames/);
  });
  it('rejects non-integer blastZoneLookaheadFrames', () => {
    expect(
      () => new RecoveryMoveLeaf({ blastZoneLookaheadFrames: 1.5 }),
    ).toThrow(/blastZoneLookaheadFrames/);
  });
  it('rejects negative verticalSlackPx', () => {
    expect(
      () => new RecoveryMoveLeaf({ verticalSlackPx: -1 }),
    ).toThrow(/verticalSlackPx/);
  });
});

describe('RecoveryMoveLeaf — gating', () => {
  it('returns Failure during hitstun', () => {
    const h = makeHarness({ isInHitstun: true });
    expect(new RecoveryMoveLeaf().tick(h.ctx)).toBe(NodeStatus.Failure);
  });

  it('returns Failure when on ledge', () => {
    const h = makeHarness({ isOnLedge: true });
    expect(new RecoveryMoveLeaf().tick(h.ctx)).toBe(NodeStatus.Failure);
  });

  it('returns Failure when grounded', () => {
    const h = makeHarness({ isAirborne: false });
    expect(new RecoveryMoveLeaf().tick(h.ctx)).toBe(NodeStatus.Failure);
  });

  it('returns Failure when on-stage', () => {
    const h = makeHarness({ positionX: 0, positionY: 200 });
    expect(new RecoveryMoveLeaf().tick(h.ctx)).toBe(NodeStatus.Failure);
  });

  it('returns Failure when up-special unavailable', () => {
    const h = makeHarness({ upSpecialAvailable: false });
    expect(new RecoveryMoveLeaf().tick(h.ctx)).toBe(NodeStatus.Failure);
  });

  it('returns Failure when air-jumps still available and not approaching blast zone', () => {
    // Defer to the double-jump leaf — air-jumps first.
    const h = makeHarness({ jumpsRemaining: 1, velocityX: 0, velocityY: 0 });
    expect(new RecoveryMoveLeaf().tick(h.ctx)).toBe(NodeStatus.Failure);
  });

  it('fires when air-jumps available BUT approaching blast wall', () => {
    const h = makeHarness({
      jumpsRemaining: 1,
      // 60-frame projection: x = -900 + (-10*60) = -1500 < blast.left -1200
      velocityX: -10,
    });
    expect(new RecoveryMoveLeaf().tick(h.ctx)).toBe(NodeStatus.Success);
  });
});

describe('RecoveryMoveLeaf — emit', () => {
  it('emits directional bias + moveUp + upSpecial when all gates clear', () => {
    const leaf = new RecoveryMoveLeaf();
    const h = makeHarness();
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    // Bot at x=-900, ledge at x=-800 → dx > 0 → moveRight nudge.
    expect(h.emits).toEqual([
      { kind: 'moveRight', recoveryStep: 'upSpecial.bias' },
      { kind: 'moveUp', recoveryStep: 'upSpecial.bias' },
      { kind: 'upSpecial', recoveryStep: 'upSpecial.commit' },
    ]);
    expect(h.blackboard.get('recoveryLastUpSpecialTick')).toBe(0);
    expect(h.blackboard.get('recoveryPhase')).toBe('upSpecial');
  });

  it('omits moveUp when emitMoveUp:false', () => {
    const leaf = new RecoveryMoveLeaf({ emitMoveUp: false });
    const h = makeHarness();
    leaf.tick(h.ctx);
    expect(h.emits.find((e) => e.kind === 'moveUp')).toBeUndefined();
    expect(h.emits).toContainEqual({
      kind: 'upSpecial',
      recoveryStep: 'upSpecial.commit',
    });
  });

  it('omits directional nudge when emitDirectionalNudge:false', () => {
    const leaf = new RecoveryMoveLeaf({ emitDirectionalNudge: false });
    const h = makeHarness();
    leaf.tick(h.ctx);
    expect(
      h.emits.find((e) => e.kind === 'moveRight' || e.kind === 'moveLeft'),
    ).toBeUndefined();
  });

  it('refuses to re-press once recoveryLastUpSpecialTick is set', () => {
    const leaf = new RecoveryMoveLeaf();
    const h = makeHarness();
    leaf.tick(h.ctx);
    h.emits.length = 0;
    h.bumpTick(60);
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('clearRecoveryState lets the leaf re-press after a landing/ledge grab', () => {
    const leaf = new RecoveryMoveLeaf();
    const h = makeHarness();
    leaf.tick(h.ctx);
    clearRecoveryState(h.blackboard);
    h.emits.length = 0;
    h.bumpTick();
    expect(leaf.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits).toContainEqual({
      kind: 'upSpecial',
      recoveryStep: 'upSpecial.commit',
    });
  });
});

describe('RecoveryMoveLeaf — determinism', () => {
  it('two leaves with identical config produce identical emits', () => {
    const a = new RecoveryMoveLeaf();
    const b = new RecoveryMoveLeaf();
    const ha = makeHarness();
    const hb = makeHarness();
    expect(a.tick(ha.ctx)).toBe(b.tick(hb.ctx));
    expect(ha.emits).toEqual(hb.emits);
  });
});
