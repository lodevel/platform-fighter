import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECOVERY_BLACKBOARD,
  isApproachingBlastZone,
  isOffStage,
  ledgeXOffset,
  ledgeYOffset,
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

function makeSelf(over: Partial<RecoverySelfSnapshot> = {}): RecoverySelfSnapshot {
  return {
    positionX: 0,
    positionY: 200,
    velocityX: 0,
    velocityY: 0,
    facing: 1,
    isAirborne: true,
    jumpsRemaining: 1,
    upSpecialAvailable: true,
    isInHitstun: false,
    isOnLedge: false,
    ...over,
  };
}

describe('DEFAULT_RECOVERY_BLACKBOARD', () => {
  it('is frozen and starts in idle phase', () => {
    expect(Object.isFrozen(DEFAULT_RECOVERY_BLACKBOARD)).toBe(true);
    expect(DEFAULT_RECOVERY_BLACKBOARD.recoveryPhase).toBe('idle');
    expect(DEFAULT_RECOVERY_BLACKBOARD.recoveryPhaseStartTick).toBe(-1);
    expect(DEFAULT_RECOVERY_BLACKBOARD.recoveryLastAirJumpTick).toBe(-1);
    expect(DEFAULT_RECOVERY_BLACKBOARD.recoveryLastUpSpecialTick).toBe(-1);
  });
});

describe('isOffStage', () => {
  it('returns false when grounded even outside the stage X range', () => {
    expect(
      isOffStage(makeSelf({ isAirborne: false, positionX: -1000 }), STAGE),
    ).toBe(false);
  });

  it('returns true when airborne and past the left edge', () => {
    expect(isOffStage(makeSelf({ positionX: -900 }), STAGE)).toBe(true);
  });

  it('returns true when airborne and past the right edge', () => {
    expect(isOffStage(makeSelf({ positionX: 900 }), STAGE)).toBe(true);
  });

  it('returns true when airborne and below the stage top', () => {
    expect(isOffStage(makeSelf({ positionY: 600 }), STAGE)).toBe(true);
  });

  it('returns false when airborne but inside safe X range and at-or-above stage top', () => {
    expect(
      isOffStage(makeSelf({ positionX: 0, positionY: 200 }), STAGE),
    ).toBe(false);
  });

  it('respects verticalSlackPx so floating-point fuzz at stageTop does not flag off-stage', () => {
    expect(
      isOffStage(
        makeSelf({ positionX: 0, positionY: 401 }),
        STAGE,
        2,
      ),
    ).toBe(false);
  });
});

describe('isApproachingBlastZone', () => {
  it('returns false for a bot drifting safely', () => {
    expect(
      isApproachingBlastZone(
        makeSelf({ positionX: 0, positionY: 0, velocityX: 1, velocityY: 0 }),
        STAGE,
      ),
    ).toBe(false);
  });

  it('returns true when projection crosses the left blast wall', () => {
    expect(
      isApproachingBlastZone(
        makeSelf({ positionX: -800, velocityX: -10 }),
        STAGE,
        60,
      ),
    ).toBe(true);
  });

  it('returns true when projection drops past the bottom blast wall', () => {
    expect(
      isApproachingBlastZone(
        makeSelf({ positionY: 500, velocityY: 20 }),
        STAGE,
        60,
      ),
    ).toBe(true);
  });
});

describe('ledgeXOffset / ledgeYOffset', () => {
  it('returns null when no ledge is registered', () => {
    const stage = { ...STAGE, nearestLedge: null };
    expect(ledgeXOffset(makeSelf(), stage)).toBeNull();
    expect(ledgeYOffset(makeSelf(), stage)).toBeNull();
  });

  it('returns signed offsets matching the convention (positive = right/below)', () => {
    expect(ledgeXOffset(makeSelf({ positionX: -1000 }), STAGE)).toBe(200);
    expect(ledgeXOffset(makeSelf({ positionX: -600 }), STAGE)).toBe(-200);
    expect(ledgeYOffset(makeSelf({ positionY: 0 }), STAGE)).toBe(400);
    expect(ledgeYOffset(makeSelf({ positionY: 600 }), STAGE)).toBe(-200);
  });
});
