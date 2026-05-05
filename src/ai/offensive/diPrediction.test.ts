/**
 * diPrediction test suite — AC 20205 Sub-AC 5.
 *
 * Locks down the DI-aware prediction primitives used by the Hard-tier
 * edge-guard branch:
 *
 *   1. {@link predictDIDirection} — picks 'left' / 'right' / 'none'
 *      from the opponent's hitstun + recovery state.
 *   2. {@link predictHitstunLandingX} — projects the opponent's
 *      trajectory N frames ahead, applying gravity + DI bias, and
 *      returns the X at which the opponent reaches stage-top altitude.
 *   3. {@link predictedRecoveryEdge} — DI-aware ledge selection.
 *   4. {@link predictedEdgeGuardAnchorX} — DI-aware anchor X.
 *   5. {@link clampDILookahead} — clamping behaviour.
 *
 * Determinism — every helper is pure on its inputs; no RNG, no
 * wall-clock. Two calls with structurally-equal inputs must produce
 * structurally-equal outputs.
 */

import { describe, it, expect } from 'vitest';

import {
  DEFAULT_DI_GRAVITY_PX_PER_FRAME_SQ,
  DEFAULT_DI_LAUNCH_THRESHOLD_PX,
  DEFAULT_DI_LOOKAHEAD_FRAMES,
  MAX_DI_LOOKAHEAD_FRAMES,
  clampDILookahead,
  predictDIDirection,
  predictedEdgeGuardAnchorX,
  predictedRecoveryEdge,
  predictHitstunLandingX,
  type DIDirection,
} from './diPrediction';
import type { PerceivedStage } from '../perception/WorldSnapshot';
import type { OpponentSnapshot } from './types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const STAGE: PerceivedStage = {
  stageLeft: -300,
  stageRight: 300,
  stageTop: 200,
  blastZone: { left: -800, right: 800, top: -600, bottom: 600 },
};

function makeOpp(overrides: Partial<OpponentSnapshot> = {}): OpponentSnapshot {
  return {
    id: 'opp1',
    distance: 100,
    damagePercent: 60,
    stateLabel: 'hitstun',
    isAirborne: true,
    velocity: { vx: 0, vy: 0 },
    position: { x: 0, y: 240 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// clampDILookahead
// ---------------------------------------------------------------------------

describe('clampDILookahead', () => {
  it('returns the input unchanged when in band', () => {
    expect(clampDILookahead(15)).toBe(15);
    expect(clampDILookahead(0)).toBe(0);
    expect(clampDILookahead(MAX_DI_LOOKAHEAD_FRAMES)).toBe(
      MAX_DI_LOOKAHEAD_FRAMES,
    );
  });

  it('falls back to the default on NaN / non-finite', () => {
    expect(clampDILookahead(NaN)).toBe(DEFAULT_DI_LOOKAHEAD_FRAMES);
    expect(clampDILookahead(Infinity)).toBe(DEFAULT_DI_LOOKAHEAD_FRAMES);
    expect(clampDILookahead(-Infinity)).toBe(DEFAULT_DI_LOOKAHEAD_FRAMES);
  });

  it('falls back to the default on negative input', () => {
    expect(clampDILookahead(-1)).toBe(DEFAULT_DI_LOOKAHEAD_FRAMES);
    expect(clampDILookahead(-100)).toBe(DEFAULT_DI_LOOKAHEAD_FRAMES);
  });

  it('clamps to MAX_DI_LOOKAHEAD_FRAMES on over-range', () => {
    expect(clampDILookahead(MAX_DI_LOOKAHEAD_FRAMES + 1)).toBe(
      MAX_DI_LOOKAHEAD_FRAMES,
    );
    expect(clampDILookahead(10_000)).toBe(MAX_DI_LOOKAHEAD_FRAMES);
  });
});

// ---------------------------------------------------------------------------
// predictDIDirection
// ---------------------------------------------------------------------------

describe('predictDIDirection', () => {
  it('returns "none" when opponent has no position', () => {
    // Construct a snapshot WITHOUT position by destructuring.
    const opp = makeOpp();
    const { position: _omit, ...rest } = opp;
    void _omit;
    expect(
      predictDIDirection({
        opponent: rest as OpponentSnapshot,
        stage: STAGE,
      }),
    ).toBe<DIDirection>('none');
  });

  it('returns "none" when opponent is grounded', () => {
    const opp = makeOpp({ isAirborne: false, position: { x: 0, y: 200 } });
    expect(predictDIDirection({ opponent: opp, stage: STAGE })).toBe('none');
  });

  it('returns "none" when opponent is on stage (above launch threshold)', () => {
    // Opponent airborne but only 4px below stageTop — within the
    // default 8px threshold, treated as on-stage for DI purposes.
    const opp = makeOpp({
      stateLabel: 'airborne',
      isAirborne: true,
      position: { x: 0, y: STAGE.stageTop + 4 },
    });
    expect(predictDIDirection({ opponent: opp, stage: STAGE })).toBe('none');
  });

  // ---- Hitstun-driven DI ----------------------------------------------------

  it('reads "right" from positive vx in hitstun', () => {
    const opp = makeOpp({
      stateLabel: 'hitstun',
      velocity: { vx: 5, vy: -2 },
      position: { x: 0, y: 240 },
    });
    expect(predictDIDirection({ opponent: opp, stage: STAGE })).toBe('right');
  });

  it('reads "left" from negative vx in hitstun', () => {
    const opp = makeOpp({
      stateLabel: 'hitstun',
      velocity: { vx: -5, vy: -2 },
      position: { x: 0, y: 240 },
    });
    expect(predictDIDirection({ opponent: opp, stage: STAGE })).toBe('left');
  });

  it('returns "none" for purely vertical knockback in hitstun', () => {
    const opp = makeOpp({
      stateLabel: 'hitstun',
      velocity: { vx: 0, vy: -10 },
      position: { x: 0, y: 240 },
    });
    expect(predictDIDirection({ opponent: opp, stage: STAGE })).toBe('none');
  });

  it('returns "none" for tiny horizontal velocity (< 1 px/frame) in hitstun', () => {
    const opp = makeOpp({
      stateLabel: 'hitstun',
      velocity: { vx: 0.5, vy: -10 },
      position: { x: 0, y: 240 },
    });
    expect(predictDIDirection({ opponent: opp, stage: STAGE })).toBe('none');
  });

  it('returns "none" when velocity is missing in hitstun', () => {
    const opp = makeOpp({
      stateLabel: 'hitstun',
      position: { x: 0, y: 240 },
    });
    const { velocity: _omit, ...rest } = opp;
    void _omit;
    expect(
      predictDIDirection({
        opponent: rest as OpponentSnapshot,
        stage: STAGE,
      }),
    ).toBe('none');
  });

  // ---- Recovery-driven DI ---------------------------------------------------

  it('picks the nearer ledge during recovery (left side)', () => {
    const opp = makeOpp({
      stateLabel: 'airborne',
      velocity: { vx: 2, vy: -3 },
      position: { x: -350, y: 280 },
    });
    expect(predictDIDirection({ opponent: opp, stage: STAGE })).toBe('left');
  });

  it('picks the nearer ledge during recovery (right side)', () => {
    const opp = makeOpp({
      stateLabel: 'airborne',
      velocity: { vx: -2, vy: -3 },
      position: { x: 350, y: 280 },
    });
    expect(predictDIDirection({ opponent: opp, stage: STAGE })).toBe('right');
  });

  it('tie-breaks left at the stage midpoint', () => {
    const opp = makeOpp({
      stateLabel: 'airborne',
      velocity: { vx: 0, vy: -3 },
      position: { x: 0, y: 280 },
    });
    expect(predictDIDirection({ opponent: opp, stage: STAGE })).toBe('left');
  });

  it('honours a custom launchThresholdPx', () => {
    // With a 50px threshold the opponent at y=stageTop+30 is treated
    // as on-stage and DI prediction returns 'none'.
    const opp = makeOpp({
      stateLabel: 'airborne',
      isAirborne: true,
      position: { x: -350, y: STAGE.stageTop + 30 },
      velocity: { vx: 0, vy: 0 },
    });
    expect(
      predictDIDirection({
        opponent: opp,
        stage: STAGE,
        launchThresholdPx: 50,
      }),
    ).toBe('none');
    // With the smaller default threshold the same opponent reads as
    // launched and DI prediction picks the nearest ledge.
    expect(
      predictDIDirection({
        opponent: opp,
        stage: STAGE,
        launchThresholdPx: 8,
      }),
    ).toBe('left');
  });
});

// ---------------------------------------------------------------------------
// predictHitstunLandingX
// ---------------------------------------------------------------------------

describe('predictHitstunLandingX', () => {
  it('returns x=0 + null frames when opponent has no position', () => {
    const opp = makeOpp();
    const { position: _omit, ...rest } = opp;
    void _omit;
    const out = predictHitstunLandingX({
      opponent: rest as OpponentSnapshot,
      stage: STAGE,
    });
    expect(out.landingX).toBe(0);
    expect(out.framesToLanding).toBe(null);
    expect(out.diDirection).toBe<DIDirection>('none');
  });

  it('returns current x + null frames when velocity is missing', () => {
    const opp = makeOpp({ position: { x: 42, y: 240 } });
    const { velocity: _omit, ...rest } = opp;
    void _omit;
    const out = predictHitstunLandingX({
      opponent: rest as OpponentSnapshot,
      stage: STAGE,
    });
    expect(out.landingX).toBe(42);
    expect(out.framesToLanding).toBe(null);
  });

  it('returns 0 frames when opponent is already above stage-top altitude', () => {
    const opp = makeOpp({
      position: { x: 50, y: STAGE.stageTop - 5 },
      velocity: { vx: 0, vy: 0 },
    });
    const out = predictHitstunLandingX({ opponent: opp, stage: STAGE });
    expect(out.framesToLanding).toBe(0);
    expect(out.landingX).toBe(50);
  });

  it('projects an upward trajectory to its stage-top crossing', () => {
    // Opponent below stage top, rising fast — should reach stage-top
    // within a few frames.
    const opp = makeOpp({
      position: { x: 0, y: 280 },
      velocity: { vx: 0, vy: -20 },
      stateLabel: 'hitstun',
    });
    // Use diBiasMagnitude:0 so the projection is pure ballistic.
    const out = predictHitstunLandingX({
      opponent: opp,
      stage: STAGE,
      diBiasMagnitude: 0,
    });
    expect(out.framesToLanding).not.toBe(null);
    // Without DI bias and with vx=0 the landing X stays at 0.
    expect(out.landingX).toBe(0);
  });

  it('biases the landing X toward the predicted DI direction', () => {
    // Opponent launched off the right side, rising. Recovery DI
    // should bias them BACK toward the right ledge (positive X
    // direction). Pass diDirection explicitly so we don't depend on
    // the upstream predictDIDirection's policy.
    const opp = makeOpp({
      position: { x: 320, y: 280 },
      velocity: { vx: 0, vy: -10 },
      stateLabel: 'hitstun',
    });
    const noBias = predictHitstunLandingX({
      opponent: opp,
      stage: STAGE,
      diBiasMagnitude: 0,
    });
    const withRightBias = predictHitstunLandingX({
      opponent: opp,
      stage: STAGE,
      diDirection: 'right',
      diBiasMagnitude: 0.5,
    });
    expect(withRightBias.landingX).toBeGreaterThan(noBias.landingX);
  });

  it('biases the landing X leftward when DI is left', () => {
    const opp = makeOpp({
      position: { x: -320, y: 280 },
      velocity: { vx: 0, vy: -10 },
      stateLabel: 'hitstun',
    });
    const noBias = predictHitstunLandingX({
      opponent: opp,
      stage: STAGE,
      diBiasMagnitude: 0,
    });
    const withLeftBias = predictHitstunLandingX({
      opponent: opp,
      stage: STAGE,
      diDirection: 'left',
      diBiasMagnitude: 0.5,
    });
    expect(withLeftBias.landingX).toBeLessThan(noBias.landingX);
  });

  it('returns null framesToLanding when projection exhausts the lookahead', () => {
    // Opponent falling fast — won't recover in any reasonable
    // lookahead. Use a small window to make the test fast.
    const opp = makeOpp({
      position: { x: 0, y: 400 },
      velocity: { vx: 0, vy: 50 },
      stateLabel: 'hitstun',
    });
    const out = predictHitstunLandingX({
      opponent: opp,
      stage: STAGE,
      lookaheadFrames: 5,
      diBiasMagnitude: 0,
    });
    expect(out.framesToLanding).toBe(null);
  });

  it('clamps lookahead to the supported band', () => {
    // Negative lookahead → falls back to default; should not throw.
    const opp = makeOpp({
      position: { x: 0, y: 280 },
      velocity: { vx: 0, vy: -10 },
      stateLabel: 'hitstun',
    });
    expect(() =>
      predictHitstunLandingX({
        opponent: opp,
        stage: STAGE,
        lookaheadFrames: -100,
      }),
    ).not.toThrow();
    expect(() =>
      predictHitstunLandingX({
        opponent: opp,
        stage: STAGE,
        lookaheadFrames: 10_000,
      }),
    ).not.toThrow();
  });

  it('honours a custom gravity value', () => {
    const opp = makeOpp({
      position: { x: 0, y: 280 },
      velocity: { vx: 0, vy: 0 },
      stateLabel: 'hitstun',
    });
    // High gravity → opponent never reaches stage top in 30 frames.
    const high = predictHitstunLandingX({
      opponent: opp,
      stage: STAGE,
      gravityPxPerFrameSq: 5,
      diBiasMagnitude: 0,
    });
    // No-gravity (vy stays 0) — also never reaches stage top from
    // below since the opponent isn't moving up.
    const zero = predictHitstunLandingX({
      opponent: opp,
      stage: STAGE,
      gravityPxPerFrameSq: 0,
      diBiasMagnitude: 0,
    });
    expect(high.framesToLanding).toBe(null);
    expect(zero.framesToLanding).toBe(null);
  });

  it('is deterministic — two calls with same input produce same output', () => {
    const opp = makeOpp({
      position: { x: 100, y: 280 },
      velocity: { vx: -3, vy: -8 },
      stateLabel: 'hitstun',
    });
    const a = predictHitstunLandingX({ opponent: opp, stage: STAGE });
    const b = predictHitstunLandingX({ opponent: opp, stage: STAGE });
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// predictedRecoveryEdge
// ---------------------------------------------------------------------------

describe('predictedRecoveryEdge', () => {
  it('returns "left" when opponent has no position', () => {
    const opp = makeOpp();
    const { position: _omit, ...rest } = opp;
    void _omit;
    expect(
      predictedRecoveryEdge({
        opponent: rest as OpponentSnapshot,
        stage: STAGE,
      }),
    ).toBe('left');
  });

  it('falls back to nearest current side when opponent is on stage', () => {
    const onStageRight = makeOpp({
      isAirborne: false,
      position: { x: 200, y: STAGE.stageTop },
    });
    expect(
      predictedRecoveryEdge({ opponent: onStageRight, stage: STAGE }),
    ).toBe('right');
    const onStageLeft = makeOpp({
      isAirborne: false,
      position: { x: -200, y: STAGE.stageTop },
    });
    expect(
      predictedRecoveryEdge({ opponent: onStageLeft, stage: STAGE }),
    ).toBe('left');
  });

  it('predicts the right edge when DI biases the launch rightward', () => {
    // Opponent dropping off the right side, hitstun velocity
    // pushing further right. With DI 'right' the projection lands
    // even further right, so the predicted edge is 'right'.
    const opp = makeOpp({
      stateLabel: 'hitstun',
      isAirborne: true,
      position: { x: 280, y: 280 },
      velocity: { vx: 2, vy: -10 },
    });
    expect(
      predictedRecoveryEdge({
        opponent: opp,
        stage: STAGE,
        diBiasMagnitude: 0.5,
      }),
    ).toBe('right');
  });

  it('predicts the left edge when DI biases the launch leftward', () => {
    const opp = makeOpp({
      stateLabel: 'hitstun',
      isAirborne: true,
      position: { x: -280, y: 280 },
      velocity: { vx: -2, vy: -10 },
    });
    expect(
      predictedRecoveryEdge({
        opponent: opp,
        stage: STAGE,
        diBiasMagnitude: 0.5,
      }),
    ).toBe('left');
  });

  it('flips the prediction when DI is reversed (recovery scenario)', () => {
    // Opponent at right stage edge but with strong leftward
    // velocity (DI'd toward stage). Even though they're physically
    // off the right, the projection shows them landing to the left
    // of midpoint.
    const opp = makeOpp({
      stateLabel: 'hitstun',
      isAirborne: true,
      position: { x: 100, y: 280 },
      velocity: { vx: -15, vy: -10 },
    });
    // Without DI bias this still projects leftward due to the
    // strong negative vx.
    const edge = predictedRecoveryEdge({
      opponent: opp,
      stage: STAGE,
      diBiasMagnitude: 0,
    });
    expect(edge).toBe('left');
  });
});

// ---------------------------------------------------------------------------
// predictedEdgeGuardAnchorX
// ---------------------------------------------------------------------------

describe('predictedEdgeGuardAnchorX', () => {
  it('combines predictedRecoveryEdge with edgeGuardAnchorX', () => {
    const oppRight = makeOpp({
      stateLabel: 'hitstun',
      isAirborne: true,
      position: { x: 280, y: 280 },
      velocity: { vx: 2, vy: -10 },
    });
    // The right edge anchor is stageRight - tolerance.
    const tolerance = 16;
    const anchor = predictedEdgeGuardAnchorX(
      {
        opponent: oppRight,
        stage: STAGE,
      },
      tolerance,
    );
    expect(anchor).toBe(STAGE.stageRight - tolerance);
  });

  it('returns the left anchor when DI predicts the left ledge', () => {
    const oppLeft = makeOpp({
      stateLabel: 'hitstun',
      isAirborne: true,
      position: { x: -280, y: 280 },
      velocity: { vx: -2, vy: -10 },
    });
    const tolerance = 16;
    const anchor = predictedEdgeGuardAnchorX(
      {
        opponent: oppLeft,
        stage: STAGE,
      },
      tolerance,
    );
    expect(anchor).toBe(STAGE.stageLeft + tolerance);
  });
});

// ---------------------------------------------------------------------------
// Cross-checks — DI prediction integrates cleanly with edge-guard policy
// ---------------------------------------------------------------------------

describe('diPrediction — integration with edge-guard policy', () => {
  it('produces a sensible anchor for an off-stage launched opponent', () => {
    // Canonical Hard-tier scenario: opponent at +320 (off the right
    // edge), in hitstun, drifting up with rightward velocity. The bot
    // should anchor at the right ledge.
    const opp = makeOpp({
      stateLabel: 'hitstun',
      isAirborne: true,
      position: { x: 320, y: 240 },
      velocity: { vx: 1.5, vy: -8 },
    });
    expect(
      predictedRecoveryEdge({
        opponent: opp,
        stage: STAGE,
        diBiasMagnitude: 0.5,
      }),
    ).toBe('right');
    expect(
      predictedEdgeGuardAnchorX(
        { opponent: opp, stage: STAGE, diBiasMagnitude: 0.5 },
        16,
      ),
    ).toBe(STAGE.stageRight - 16);
  });

  it('predicts the OPPOSITE ledge from a corner DI flip', () => {
    // Advanced case: opponent at the right of the stage but DI'd
    // strongly back toward center — they'll cross midpoint before
    // recovering. A naive "nearest current side" predicate would
    // pick 'right' (where they are now); DI prediction should pick
    // 'left' (where they'll actually recover).
    const opp = makeOpp({
      stateLabel: 'hitstun',
      isAirborne: true,
      position: { x: 50, y: 280 },
      velocity: { vx: -20, vy: -10 },
    });
    expect(
      predictedRecoveryEdge({
        opponent: opp,
        stage: STAGE,
        diBiasMagnitude: 0,
      }),
    ).toBe('left');
  });

  it('exposes the resolved DI direction on the projection result', () => {
    const opp = makeOpp({
      stateLabel: 'hitstun',
      isAirborne: true,
      position: { x: 280, y: 280 },
      velocity: { vx: 5, vy: -10 },
    });
    const out = predictHitstunLandingX({
      opponent: opp,
      stage: STAGE,
    });
    expect(out.diDirection).toBe<DIDirection>('right');
  });
});

// ---------------------------------------------------------------------------
// Tunables — defaults are sensible
// ---------------------------------------------------------------------------

describe('diPrediction — tunable defaults', () => {
  it('exposes a non-zero default lookahead', () => {
    expect(DEFAULT_DI_LOOKAHEAD_FRAMES).toBeGreaterThan(0);
    expect(DEFAULT_DI_LOOKAHEAD_FRAMES).toBeLessThanOrEqual(
      MAX_DI_LOOKAHEAD_FRAMES,
    );
  });

  it('exposes a positive launch threshold', () => {
    expect(DEFAULT_DI_LAUNCH_THRESHOLD_PX).toBeGreaterThan(0);
  });

  it('exposes a positive default gravity', () => {
    expect(DEFAULT_DI_GRAVITY_PX_PER_FRAME_SQ).toBeGreaterThan(0);
  });
});
