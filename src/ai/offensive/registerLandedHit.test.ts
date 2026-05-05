import { describe, expect, it } from 'vitest';
import { Blackboard } from '../behaviorTree/Blackboard';
import {
  registerLandedHit,
  clearOffensiveCombo,
} from './registerLandedHit';
import type { OffensiveBlackboardSchema } from './types';
import { DEFAULT_OFFENSIVE_BLACKBOARD } from './types';

function makeBlackboard(): Blackboard<OffensiveBlackboardSchema> {
  return new Blackboard<OffensiveBlackboardSchema>({
    ...DEFAULT_OFFENSIVE_BLACKBOARD,
  });
}

describe('registerLandedHit', () => {
  it('writes the four combo fields after a jab lands', () => {
    const bb = makeBlackboard();
    registerLandedHit(bb, {
      landed: 'jab',
      landedTick: 42,
      opponentPercent: 12,
    });
    expect(bb.get('comboStage')).toBe('jabConnected');
    expect(bb.get('comboLastLandedMove')).toBe('jab');
    expect(bb.get('comboLastLandedTick')).toBe(42);
    expect(bb.get('comboLastLandedOpponentPercent')).toBe(12);
  });

  it('resets stage to idle after a smash lands (smash recovery ends chain)', () => {
    const bb = makeBlackboard();
    registerLandedHit(bb, {
      landed: 'smash',
      landedTick: 90,
      opponentPercent: 80,
    });
    expect(bb.get('comboStage')).toBe('idle');
    expect(bb.get('comboLastLandedMove')).toBe('smash');
    expect(bb.get('comboLastLandedTick')).toBe(90);
  });

  it('overwrites a prior chain when a new hit lands mid-combo', () => {
    const bb = makeBlackboard();
    registerLandedHit(bb, {
      landed: 'jab',
      landedTick: 10,
      opponentPercent: 5,
    });
    // Player got jabbed mid-tilt — the more recent hit defines the chain.
    registerLandedHit(bb, {
      landed: 'jab',
      landedTick: 22,
      opponentPercent: 8,
    });
    expect(bb.get('comboLastLandedTick')).toBe(22);
    expect(bb.get('comboLastLandedOpponentPercent')).toBe(8);
  });

  it('does NOT touch comboPlannedFollowUp (recognition leaf computes it)', () => {
    const bb = makeBlackboard();
    bb.set('comboPlannedFollowUp', {
      nextAttack: 'tilt',
      maxFollowUpFrames: 12,
      comboStepId: 'pre-existing',
    });
    registerLandedHit(bb, {
      landed: 'jab',
      landedTick: 50,
      opponentPercent: 0,
    });
    // Plan field should still hold the pre-existing entry — the
    // recognition leaf will overwrite it the next tick if it
    // recomputes a fresh plan.
    expect(bb.get('comboPlannedFollowUp')).toEqual({
      nextAttack: 'tilt',
      maxFollowUpFrames: 12,
      comboStepId: 'pre-existing',
    });
  });

  it('rejects negative tick values', () => {
    const bb = makeBlackboard();
    expect(() =>
      registerLandedHit(bb, {
        landed: 'jab',
        landedTick: -1,
        opponentPercent: 0,
      }),
    ).toThrow(/landedTick/i);
  });

  it('rejects non-integer tick values', () => {
    const bb = makeBlackboard();
    expect(() =>
      registerLandedHit(bb, {
        landed: 'jab',
        landedTick: 1.5,
        opponentPercent: 0,
      }),
    ).toThrow(/landedTick/i);
  });

  it('rejects negative opponent percent', () => {
    const bb = makeBlackboard();
    expect(() =>
      registerLandedHit(bb, {
        landed: 'jab',
        landedTick: 0,
        opponentPercent: -1,
      }),
    ).toThrow(/opponentPercent/i);
  });
});

describe('clearOffensiveCombo', () => {
  it('restores the partition to the default state', () => {
    const bb = makeBlackboard();
    registerLandedHit(bb, {
      landed: 'tilt',
      landedTick: 60,
      opponentPercent: 70,
    });
    bb.set('comboPlannedFollowUp', {
      nextAttack: 'smash',
      maxFollowUpFrames: 16,
      comboStepId: 'tilt→smash',
    });

    clearOffensiveCombo(bb);

    expect(bb.get('comboStage')).toBe('idle');
    expect(bb.get('comboLastLandedMove')).toBeNull();
    expect(bb.get('comboLastLandedTick')).toBe(-1);
    expect(bb.get('comboLastLandedOpponentPercent')).toBe(0);
    expect(bb.get('comboPlannedFollowUp')).toBeNull();
  });
});
