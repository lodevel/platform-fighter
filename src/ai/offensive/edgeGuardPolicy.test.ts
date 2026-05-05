import { describe, expect, it } from 'vitest';
import type { PerceivedStage } from '../perception/WorldSnapshot';
import {
  DEFAULT_LEDGE_ANCHOR_TOLERANCE_PX,
  DEFAULT_OFFSTAGE_HORIZONTAL_SLACK_PX,
  DEFAULT_OFFSTAGE_VERTICAL_SLACK_PX,
  DEFAULT_SMASH_VERTICAL_REACH_PX,
  chooseEdgeGuardAttack,
  edgeGuardAnchorX,
  isOpponentOffStage,
  nearestStageEdge,
  shouldCommitEdgeGuard,
} from './edgeGuardPolicy';
import type { OpponentSnapshot } from './types';

const stage: PerceivedStage = {
  stageLeft: 100,
  stageRight: 500,
  stageTop: 200,
  blastZone: { left: 0, right: 600, top: 0, bottom: 400 },
};

const baseOpponent: OpponentSnapshot = {
  id: 'p2',
  distance: 0,
  damagePercent: 0,
  stateLabel: 'idle',
  isAirborne: true,
  position: { x: 50, y: 250 },
  velocity: { vx: 0, vy: 0 },
};

describe('edgeGuardPolicy', () => {
  describe('isOpponentOffStage', () => {
    it('returns true for opponent left of stage and airborne', () => {
      expect(isOpponentOffStage(baseOpponent, stage)).toBe(true);
    });

    it('returns true for opponent right of stage', () => {
      const opp = { ...baseOpponent, position: { x: 600, y: 100 } };
      expect(isOpponentOffStage(opp, stage)).toBe(true);
    });

    it('returns true for opponent below stage top', () => {
      const opp = { ...baseOpponent, position: { x: 300, y: 300 } };
      expect(isOpponentOffStage(opp, stage)).toBe(true);
    });

    it('returns false for opponent at stage edge within slack', () => {
      const opp = {
        ...baseOpponent,
        position: { x: stage.stageLeft - DEFAULT_OFFSTAGE_HORIZONTAL_SLACK_PX, y: 100 },
      };
      // Exactly at left - slack: NOT off stage (predicate uses strict <)
      expect(isOpponentOffStage(opp, stage)).toBe(false);
    });

    it('returns false when opponent is grounded (not airborne)', () => {
      const opp = { ...baseOpponent, isAirborne: false };
      expect(isOpponentOffStage(opp, stage)).toBe(false);
    });

    it('returns false when opponent has no position (legacy snapshot)', () => {
      const opp: OpponentSnapshot = {
        id: 'p2',
        distance: 0,
        damagePercent: 0,
        stateLabel: 'idle',
        isAirborne: true,
      };
      expect(isOpponentOffStage(opp, stage)).toBe(false);
    });

    it('honours overridden vertical slack', () => {
      const opp = {
        ...baseOpponent,
        position: { x: 300, y: stage.stageTop + 10 },
      };
      expect(
        isOpponentOffStage(opp, stage, { verticalSlackPx: 20 }),
      ).toBe(false);
      expect(
        isOpponentOffStage(opp, stage, { verticalSlackPx: 5 }),
      ).toBe(true);
    });

    it('uses default vertical slack when not overridden', () => {
      const opp = {
        ...baseOpponent,
        position: { x: 300, y: stage.stageTop + DEFAULT_OFFSTAGE_VERTICAL_SLACK_PX + 1 },
      };
      expect(isOpponentOffStage(opp, stage)).toBe(true);
    });
  });

  describe('nearestStageEdge', () => {
    it('returns left when opponent is at midpoint', () => {
      const mid = (stage.stageLeft + stage.stageRight) / 2;
      expect(nearestStageEdge(mid, stage)).toBe('left');
    });

    it('returns left when opponent is on the left half', () => {
      expect(nearestStageEdge(150, stage)).toBe('left');
      expect(nearestStageEdge(50, stage)).toBe('left');
    });

    it('returns right when opponent is on the right half', () => {
      expect(nearestStageEdge(400, stage)).toBe('right');
      expect(nearestStageEdge(700, stage)).toBe('right');
    });
  });

  describe('edgeGuardAnchorX', () => {
    it('returns stage edge pulled inward by tolerance', () => {
      expect(edgeGuardAnchorX('left', stage, 16)).toBe(stage.stageLeft + 16);
      expect(edgeGuardAnchorX('right', stage, 16)).toBe(stage.stageRight - 16);
    });

    it('uses the documented default tolerance', () => {
      expect(edgeGuardAnchorX('left', stage)).toBe(
        stage.stageLeft + DEFAULT_LEDGE_ANCHOR_TOLERANCE_PX,
      );
    });
  });

  describe('shouldCommitEdgeGuard', () => {
    it('commits when opponent is off-stage and bot can race to ledge', () => {
      // Opponent at x=50 (left of stage), bot at x=200 (on stage)
      // anchor = 116 (stage.left + 16), bot distance = |116 - 200| = 84
      // opponent distance to ledge (stage.left=100) = |100 - 50| = 50
      // 84 ≤ 50 * 2 = 100 → commit
      expect(
        shouldCommitEdgeGuard({
          opponent: { ...baseOpponent, position: { x: 50, y: 100 } },
          selfX: 200,
          selfIsAirborne: false,
          stage,
        }),
      ).toBe(true);
    });

    it('refuses to commit when bot is airborne', () => {
      expect(
        shouldCommitEdgeGuard({
          opponent: baseOpponent,
          selfX: 200,
          selfIsAirborne: true,
          stage,
        }),
      ).toBe(false);
    });

    it('refuses to commit when opponent is on stage', () => {
      expect(
        shouldCommitEdgeGuard({
          opponent: { ...baseOpponent, position: { x: 250, y: 100 }, isAirborne: false },
          selfX: 200,
          selfIsAirborne: false,
          stage,
        }),
      ).toBe(false);
    });

    it('refuses to commit when bot is much farther from anchor than opponent from ledge', () => {
      // Opponent right at the ledge (distance 1), bot far across the stage
      // anchor = 116, bot at x=490, distance = 374
      // opponent at x=99, distance to left ledge = 1
      // 374 > 1 * 2 → no commit
      expect(
        shouldCommitEdgeGuard({
          opponent: { ...baseOpponent, position: { x: 99, y: 100 } },
          selfX: 490,
          selfIsAirborne: false,
          stage,
        }),
      ).toBe(false);
    });

    it('refuses to commit when opponent has no position (legacy)', () => {
      const opp: OpponentSnapshot = {
        id: 'p2',
        distance: 0,
        damagePercent: 0,
        stateLabel: 'idle',
        isAirborne: true,
      };
      expect(
        shouldCommitEdgeGuard({
          opponent: opp,
          selfX: 200,
          selfIsAirborne: false,
          stage,
        }),
      ).toBe(false);
    });
  });

  describe('chooseEdgeGuardAttack', () => {
    it('picks smash when opponent is within smash band', () => {
      const choice = chooseEdgeGuardAttack(
        stage.stageTop + 40,
        stage.stageTop,
      );
      expect(choice.kind).toBe('smash');
      expect(choice.comboStepId).toBe('edgeGuard.smash');
    });

    it('picks smash exactly at the smash band boundary', () => {
      const choice = chooseEdgeGuardAttack(
        stage.stageTop + DEFAULT_SMASH_VERTICAL_REACH_PX,
        stage.stageTop,
      );
      expect(choice.kind).toBe('smash');
    });

    it('falls back to special when below smash band', () => {
      const choice = chooseEdgeGuardAttack(
        stage.stageTop + DEFAULT_SMASH_VERTICAL_REACH_PX + 50,
        stage.stageTop,
      );
      expect(choice.kind).toBe('special');
      expect(choice.comboStepId).toBe('edgeGuard.special');
    });

    it('returns null kind when special is disabled and below smash band', () => {
      const choice = chooseEdgeGuardAttack(
        stage.stageTop + DEFAULT_SMASH_VERTICAL_REACH_PX + 50,
        stage.stageTop,
        { enableSpecial: false },
      );
      expect(choice.kind).toBeNull();
      expect(choice.comboStepId).toBe('edgeGuard.none');
    });

    it('honours custom smash vertical reach', () => {
      const choice = chooseEdgeGuardAttack(
        stage.stageTop + 30,
        stage.stageTop,
        { smashVerticalReachPx: 20 },
      );
      expect(choice.kind).toBe('special');
    });
  });

  describe('determinism', () => {
    it('identical inputs produce identical outputs', () => {
      const opp = { ...baseOpponent, position: { x: 50, y: 100 } };
      expect(
        shouldCommitEdgeGuard({
          opponent: opp,
          selfX: 200,
          selfIsAirborne: false,
          stage,
        }),
      ).toBe(
        shouldCommitEdgeGuard({
          opponent: opp,
          selfX: 200,
          selfIsAirborne: false,
          stage,
        }),
      );
      expect(chooseEdgeGuardAttack(220, 200)).toEqual(
        chooseEdgeGuardAttack(220, 200),
      );
    });
  });
});
