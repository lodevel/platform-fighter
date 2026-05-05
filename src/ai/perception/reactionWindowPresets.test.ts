import { describe, expect, it } from 'vitest';
import { Rng } from '../../utils/Rng';
import { ReactionWindow } from './ReactionWindow';
import {
  REACTION_WINDOW_PRESETS,
  getReactionWindowRange,
  type AiDifficulty,
} from './reactionWindowPresets';

describe('REACTION_WINDOW_PRESETS', () => {
  it('exposes all three difficulty tiers', () => {
    const keys: AiDifficulty[] = ['easy', 'medium', 'hard'];
    for (const tier of keys) {
      expect(REACTION_WINDOW_PRESETS[tier]).toBeDefined();
    }
  });

  it('Hard tier matches the AC-mandated 15-20 frame band', () => {
    expect(REACTION_WINDOW_PRESETS.hard.minDelayFrames).toBe(15);
    expect(REACTION_WINDOW_PRESETS.hard.maxDelayFrames).toBe(20);
  });

  it('every tier has min <= max', () => {
    const tiers: AiDifficulty[] = ['easy', 'medium', 'hard'];
    for (const tier of tiers) {
      const range = REACTION_WINDOW_PRESETS[tier];
      expect(range.minDelayFrames).toBeLessThanOrEqual(range.maxDelayFrames);
    }
  });

  it('every tier has positive integer bounds', () => {
    const tiers: AiDifficulty[] = ['easy', 'medium', 'hard'];
    for (const tier of tiers) {
      const range = REACTION_WINDOW_PRESETS[tier];
      expect(Number.isInteger(range.minDelayFrames)).toBe(true);
      expect(Number.isInteger(range.maxDelayFrames)).toBe(true);
      expect(range.minDelayFrames).toBeGreaterThan(0);
      expect(range.maxDelayFrames).toBeGreaterThan(0);
    }
  });

  it('tiers are ordered by difficulty: easy slower than medium slower than hard', () => {
    const easy = REACTION_WINDOW_PRESETS.easy;
    const medium = REACTION_WINDOW_PRESETS.medium;
    const hard = REACTION_WINDOW_PRESETS.hard;
    // The minimum-possible reaction time should drop monotonically as
    // difficulty rises (faster tier ⇒ smaller floor delay).
    expect(easy.minDelayFrames).toBeGreaterThan(medium.minDelayFrames);
    expect(medium.minDelayFrames).toBeGreaterThan(hard.minDelayFrames);
    // And the worst-case reaction time should also drop.
    expect(easy.maxDelayFrames).toBeGreaterThan(medium.maxDelayFrames);
    expect(medium.maxDelayFrames).toBeGreaterThan(hard.maxDelayFrames);
  });

  it('preset entries are immutable (Object.freeze)', () => {
    expect(Object.isFrozen(REACTION_WINDOW_PRESETS)).toBe(true);
    expect(Object.isFrozen(REACTION_WINDOW_PRESETS.hard)).toBe(true);
  });
});

describe('getReactionWindowRange', () => {
  it('returns the matching preset for each tier', () => {
    expect(getReactionWindowRange('hard')).toEqual(REACTION_WINDOW_PRESETS.hard);
    expect(getReactionWindowRange('medium')).toEqual(
      REACTION_WINDOW_PRESETS.medium,
    );
    expect(getReactionWindowRange('easy')).toEqual(REACTION_WINDOW_PRESETS.easy);
  });

  it('plumbs cleanly into a ReactionWindow constructor', () => {
    const range = getReactionWindowRange('hard');
    const rng = new Rng(0xfeedface);
    const window = new ReactionWindow<{ kind: string }>({ ...range, rng });
    for (let frame = 0; frame < 50; frame += 1) {
      const entry = window.observe({ kind: 'attack' }, frame);
      const delay = entry.visibleFrame - entry.observedFrame;
      expect(delay).toBeGreaterThanOrEqual(15);
      expect(delay).toBeLessThanOrEqual(20);
    }
  });
});
