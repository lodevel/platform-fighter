import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES,
  MAX_PREDICTIVE_LOOKAHEAD_FRAMES,
  choosePredictiveMoveDirection,
  clampLookaheadFrames,
  projectOpponentPosition,
  projectedOpponentDistance,
} from './predictiveMovement';
import type { OpponentSnapshot } from './types';

const baseOpponent: OpponentSnapshot = {
  id: 'p2',
  distance: 100,
  damagePercent: 0,
  stateLabel: 'idle',
  isAirborne: false,
  position: { x: 200, y: 50 },
  velocity: { vx: 4, vy: 0 },
};

describe('predictiveMovement', () => {
  describe('clampLookaheadFrames', () => {
    it('returns the supplied value when it is in range', () => {
      expect(clampLookaheadFrames(10)).toBe(10);
      expect(clampLookaheadFrames(0)).toBe(0);
      expect(
        clampLookaheadFrames(MAX_PREDICTIVE_LOOKAHEAD_FRAMES),
      ).toBe(MAX_PREDICTIVE_LOOKAHEAD_FRAMES);
    });

    it('clamps to MAX when above', () => {
      expect(clampLookaheadFrames(1000)).toBe(MAX_PREDICTIVE_LOOKAHEAD_FRAMES);
    });

    it('falls back to default for negative or non-finite', () => {
      expect(clampLookaheadFrames(-5)).toBe(DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES);
      expect(clampLookaheadFrames(Number.NaN)).toBe(
        DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES,
      );
      expect(clampLookaheadFrames(Number.POSITIVE_INFINITY)).toBe(
        DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES,
      );
    });
  });

  describe('projectOpponentPosition', () => {
    it('projects forward using velocity * frames', () => {
      // velocity 4 px/step, default lookahead 8 → +32 px
      const projected = projectOpponentPosition(baseOpponent);
      expect(projected).toEqual({
        x: 200 + 4 * DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES,
        y: 50,
      });
    });

    it('honours an explicit lookahead', () => {
      const projected = projectOpponentPosition(baseOpponent, 5);
      expect(projected).toEqual({ x: 220, y: 50 });
    });

    it('returns null when position is missing', () => {
      const opp: OpponentSnapshot = {
        id: 'p2',
        distance: 50,
        damagePercent: 0,
        stateLabel: 'idle',
        isAirborne: false,
      };
      expect(projectOpponentPosition(opp)).toBeNull();
    });

    it('treats missing velocity as zero', () => {
      const opp: OpponentSnapshot = {
        ...baseOpponent,
        velocity: undefined,
      };
      expect(projectOpponentPosition(opp, 5)).toEqual({ x: 200, y: 50 });
    });

    it('clamps oversized lookahead requests', () => {
      const projected = projectOpponentPosition(baseOpponent, 1000);
      // Clamped to MAX (30) → 200 + 4*30
      expect(projected).toEqual({
        x: 200 + 4 * MAX_PREDICTIVE_LOOKAHEAD_FRAMES,
        y: 50,
      });
    });

    it('falls back to default for non-finite lookahead', () => {
      const projected = projectOpponentPosition(baseOpponent, Number.NaN);
      expect(projected).toEqual({
        x: 200 + 4 * DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES,
        y: 50,
      });
    });

    it('treats non-finite velocity components as zero', () => {
      const opp: OpponentSnapshot = {
        ...baseOpponent,
        velocity: { vx: Number.NaN, vy: Number.POSITIVE_INFINITY },
      };
      expect(projectOpponentPosition(opp, 4)).toEqual({ x: 200, y: 50 });
    });
  });

  describe('projectedOpponentDistance', () => {
    it('returns signed projected distance from selfX', () => {
      // selfX 100, projected oppX 232 → distance 132
      expect(projectedOpponentDistance(100, baseOpponent)).toBe(
        232 - 100,
      );
    });

    it('falls back to current distance when selfX is non-finite', () => {
      expect(projectedOpponentDistance(Number.NaN, baseOpponent)).toBe(
        baseOpponent.distance,
      );
    });

    it('falls back to current distance when position is missing', () => {
      const opp: OpponentSnapshot = {
        id: 'p2',
        distance: 75,
        damagePercent: 0,
        stateLabel: 'idle',
        isAirborne: false,
      };
      expect(projectedOpponentDistance(0, opp)).toBe(75);
    });

    it('respects custom lookahead', () => {
      // selfX 100, opp.x 200 + 4*2 = 208 → distance 108
      expect(projectedOpponentDistance(100, baseOpponent, 2)).toBe(108);
    });
  });

  describe('choosePredictiveMoveDirection', () => {
    it('returns stop inside the preferred range (inclusive)', () => {
      expect(choosePredictiveMoveDirection(0, 50)).toBe('stop');
      expect(choosePredictiveMoveDirection(50, 50)).toBe('stop');
      expect(choosePredictiveMoveDirection(-50, 50)).toBe('stop');
    });

    it('returns right when projected distance is positive and outside band', () => {
      expect(choosePredictiveMoveDirection(60, 50)).toBe('right');
      expect(choosePredictiveMoveDirection(1000, 50)).toBe('right');
    });

    it('returns left when projected distance is negative and outside band', () => {
      expect(choosePredictiveMoveDirection(-60, 50)).toBe('left');
      expect(choosePredictiveMoveDirection(-1000, 50)).toBe('left');
    });
  });

  describe('determinism', () => {
    it('identical inputs produce identical outputs', () => {
      const a = projectOpponentPosition(baseOpponent, 7);
      const b = projectOpponentPosition({ ...baseOpponent }, 7);
      expect(a).toEqual(b);

      expect(projectedOpponentDistance(50, baseOpponent, 4)).toEqual(
        projectedOpponentDistance(50, { ...baseOpponent }, 4),
      );

      expect(choosePredictiveMoveDirection(75, 50)).toBe(
        choosePredictiveMoveDirection(75, 50),
      );
    });
  });
});
