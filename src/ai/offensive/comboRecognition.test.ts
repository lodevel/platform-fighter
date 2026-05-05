import { describe, expect, it } from 'vitest';
import {
  KO_PERCENT_THRESHOLD,
  JAB_TO_TILT_FRAMES,
  JAB_TO_SMASH_FRAMES,
  TILT_TO_SMASH_FRAMES,
  recognizeFollowUp,
  advanceComboStage,
  isComboWindowExpired,
} from './comboRecognition';

describe('comboRecognition — recognizeFollowUp', () => {
  it('returns null when no chain is in flight (idle stage)', () => {
    expect(recognizeFollowUp('idle', 0)).toBeNull();
    expect(recognizeFollowUp('idle', 999)).toBeNull();
  });

  it('chains jab → tilt at low opponent percent', () => {
    const plan = recognizeFollowUp('jabConnected', 30);
    expect(plan).toEqual({
      nextAttack: 'tilt',
      maxFollowUpFrames: JAB_TO_TILT_FRAMES,
      comboStepId: 'jab→tilt',
    });
  });

  it('chains jab → smash at and above the KO percent threshold', () => {
    const plan = recognizeFollowUp('jabConnected', KO_PERCENT_THRESHOLD);
    expect(plan).toEqual({
      nextAttack: 'smash',
      maxFollowUpFrames: JAB_TO_SMASH_FRAMES,
      comboStepId: 'jab→smash',
    });

    const planHigh = recognizeFollowUp('jabConnected', 120);
    expect(planHigh?.nextAttack).toBe('smash');
  });

  it('chains tilt → smash at KO percent', () => {
    const plan = recognizeFollowUp('tiltConnected', KO_PERCENT_THRESHOLD);
    expect(plan).toEqual({
      nextAttack: 'smash',
      maxFollowUpFrames: TILT_TO_SMASH_FRAMES,
      comboStepId: 'tilt→smash',
    });
  });

  it('drops the chain after a tilt at low percent', () => {
    expect(recognizeFollowUp('tiltConnected', 30)).toBeNull();
  });

  it('boundary check — exactly KO_PERCENT_THRESHOLD - 1 stays in tilt path', () => {
    const plan = recognizeFollowUp(
      'jabConnected',
      KO_PERCENT_THRESHOLD - 1,
    );
    expect(plan?.nextAttack).toBe('tilt');
  });

  it('is deterministic — same inputs → identical plans across calls', () => {
    const a = recognizeFollowUp('jabConnected', 45);
    const b = recognizeFollowUp('jabConnected', 45);
    expect(a).toEqual(b);
  });
});

describe('comboRecognition — advanceComboStage', () => {
  it('jab landed → jabConnected', () => {
    expect(advanceComboStage('jab')).toBe('jabConnected');
  });

  it('tilt landed → tiltConnected', () => {
    expect(advanceComboStage('tilt')).toBe('tiltConnected');
  });

  it('smash landed → idle (chain ends, smash recovery rules out follow-up)', () => {
    expect(advanceComboStage('smash')).toBe('idle');
  });

  it('special landed → idle (specials are not chain links in M2)', () => {
    expect(advanceComboStage('special')).toBe('idle');
  });
});

describe('comboRecognition — isComboWindowExpired', () => {
  it('returns false when no hit has been recorded (sentinel -1)', () => {
    expect(isComboWindowExpired(100, -1, 12)).toBe(false);
  });

  it('returns false at exactly the boundary tick (equality is still valid)', () => {
    // landed @ 100, max 12 → window covers ticks 100..112 inclusive.
    expect(isComboWindowExpired(112, 100, 12)).toBe(false);
  });

  it('returns true the tick after the window closes', () => {
    expect(isComboWindowExpired(113, 100, 12)).toBe(true);
  });

  it('returns false on the same tick as the hit', () => {
    expect(isComboWindowExpired(100, 100, 12)).toBe(false);
  });
});
