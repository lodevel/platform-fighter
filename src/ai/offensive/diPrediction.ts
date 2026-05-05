/**
 * diPrediction — Hard-tier "Directional Influence" prediction (AC 20205
 * Sub-AC 5).
 *
 * What is DI?
 * -----------
 *
 * In Smash-Bros-style platform fighters, **Directional Influence (DI)**
 * is the small directional input a player applies during hitstun to
 * alter the trajectory of their knockback. A skilled defender who has
 * been launched off the right side of the stage will hold *toward* the
 * stage during hitstun, biasing their arc back toward the ledge they
 * intend to recover to. A naive bot that anchors at the *current*
 * trajectory's projected ledge will find the opponent has DI'd to the
 * other side and slipped past.
 *
 * A competent edge-guarder anticipates DI: instead of asking "where is
 * the launched opponent now and which side of the stage are they on?",
 * the bot asks "which ledge is the opponent likely to recover to given
 * their hitstun trajectory and the stage geometry, accounting for the
 * DI input they will apply?".
 *
 * What this module provides
 * -------------------------
 *
 * Pure, deterministic helpers for predicting the opponent's probable
 * recovery target:
 *
 *   - {@link predictDIDirection} — given an opponent's current state +
 *     stage geometry, returns `'left' | 'right' | 'none'` indicating
 *     the most plausible DI direction the opponent will apply.
 *
 *   - {@link predictHitstunLandingX} — given an opponent's launched
 *     trajectory + DI prediction, projects the X coordinate at which
 *     the opponent will arrive at stage-top altitude (where they need
 *     to be to grab a ledge / land back on stage).
 *
 *   - {@link predictedRecoveryEdge} — DI-aware replacement for
 *     {@link import('./edgeGuardPolicy').nearestStageEdge}. Picks the
 *     ledge the opponent is *most likely to recover to* rather than the
 *     side they are *currently* closest to.
 *
 *   - {@link predictedEdgeGuardAnchorX} — DI-aware anchor X. Combines
 *     {@link predictedRecoveryEdge} with the existing
 *     {@link import('./edgeGuardPolicy').edgeGuardAnchorX}.
 *
 * Why not bake DI prediction into `edgeGuardPolicy.ts`?
 * -----------------------------------------------------
 *
 * The existing edge-guard policy is correct for the "naive" Hard-tier
 * surface: read the current opponent X, pick the nearest ledge, anchor
 * there. DI prediction is an *advanced tactic* that builds on top of
 * the policy without replacing it. Splitting the concerns into a
 * dedicated module:
 *
 *   1. Lets the V2 offensive tree opt into DI-aware edge-guarding via
 *      a single options flag without churning the existing tests.
 *   2. Keeps the prediction model unit-testable in isolation — DI
 *      heuristics are subtle (a competent player DIs *toward* the stage
 *      when launched away, but *away* from a corner kill threat) and
 *      deserve their own focused suite.
 *   3. Mirrors the structure of {@link
 *      import('./predictiveMovement').predictiveMovement} which
 *      exists alongside the non-predictive movement helpers as an
 *      additive Hard-tier extension rather than a replacement.
 *
 * Determinism contract
 * --------------------
 *
 * Every helper is a pure function of its inputs. No `Math.random`, no
 * wall-clock reads, no allocation beyond the small projection records.
 * Identical inputs always produce identical outputs, so the replay
 * system can reconstruct the Hard-tier edge-guard decisions verbatim
 * from the snapshot stream.
 *
 * Why no RNG?
 * -----------
 *
 * Real human DI varies — the same player will DI slightly differently
 * frame-to-frame depending on their reaction quality. We could model
 * that with an RNG-driven jitter. But for the Hard-tier prediction
 * step we are asking "what is the *most likely* DI the opponent will
 * apply", and the most-likely answer is deterministic given the
 * geometry. Adding RNG would only make the bot *less* accurate without
 * making it more competent. Easy / Medium tiers use slower reactions
 * and skip the DI prediction layer entirely.
 */

import type { PerceivedStage } from '../perception/WorldSnapshot';
import {
  edgeGuardAnchorX,
  DEFAULT_LEDGE_ANCHOR_TOLERANCE_PX,
} from './edgeGuardPolicy';
import type { OpponentSnapshot } from './types';

// ---------------------------------------------------------------------------
// Tunables — exported so consumers / tests can introspect / override
// ---------------------------------------------------------------------------

/**
 * Default DI lookahead horizon (fixed steps). Tuned to the typical
 * hitstun-to-recovery window — a launched opponent at mid-percent
 * spends ~24 frames in hitstun before they can input recovery, and
 * another ~10-15 frames coasting before their up-special / double-jump
 * fires. 30 frames is the rough midpoint of that window — short
 * enough that velocity extrapolation is still meaningful, long enough
 * that the predicted landing reflects the recovery's intended terminus.
 */
export const DEFAULT_DI_LOOKAHEAD_FRAMES = 30;

/**
 * Maximum supported DI lookahead. Beyond this horizon the projection
 * is dominated by gravity / recovery-move thrust which we cannot model
 * cleanly without reading the opponent's character state. Clamp loud,
 * not silent.
 */
export const MAX_DI_LOOKAHEAD_FRAMES = 60;

/**
 * Minimum vertical separation below the stage top before the opponent
 * counts as "launched and DI-relevant". Above this threshold the
 * opponent is essentially still on stage and the naive
 * {@link nearestStageEdge} predicate is correct — DI prediction would
 * just add noise.
 */
export const DEFAULT_DI_LAUNCH_THRESHOLD_PX = 8;

/**
 * Default gravity (design pixels per fixed step squared) used by the
 * trajectory projection. Mirrors the engine's nominal gravity so the
 * DI lookahead approximates the simulated physics. The constant is
 * deliberately exported so per-character tunings can override it
 * (e.g. heavy fighters with slower fall would feed a smaller value).
 */
export const DEFAULT_DI_GRAVITY_PX_PER_FRAME_SQ = 0.35;

/**
 * Default DI bias magnitude (design pixels per fixed step) the model
 * applies as a sustained nudge toward the predicted ledge. Real DI
 * effects in the engine are small per-frame but compound over the
 * hitstun window — 0.4 px/frame over 30 frames is ~12 px of bias, on
 * the order of a body width.
 */
export const DEFAULT_DI_BIAS_MAGNITUDE = 0.4;

// ---------------------------------------------------------------------------
// DI direction prediction
// ---------------------------------------------------------------------------

/**
 * Direction the opponent is predicted to apply DI input.
 *
 *   - `'left'`  — opponent will hold left during hitstun.
 *   - `'right'` — opponent will hold right during hitstun.
 *   - `'none'`  — no DI prediction (opponent is on stage / not in
 *                 a launchable state, or the geometry is symmetric).
 */
export type DIDirection = 'left' | 'right' | 'none';

/**
 * Inputs to {@link predictDIDirection}. Bundling them into a record so
 * call sites name the fields and the signature stays legible as the
 * predicate grows.
 */
export interface PredictDIInput {
  readonly opponent: OpponentSnapshot;
  readonly stage: PerceivedStage;
  /**
   * Optional vertical-launch threshold. Above this depth below the
   * stage top the opponent counts as "launched and DI-relevant".
   * Defaults to {@link DEFAULT_DI_LAUNCH_THRESHOLD_PX}.
   */
  readonly launchThresholdPx?: number;
}

/**
 * Predict which direction the opponent will apply DI during hitstun.
 *
 * Heuristic (mirrors the policy a competent human applies):
 *
 *   1. If the opponent is not airborne or has no `position` / no
 *      `velocity`, return `'none'` — DI prediction is only meaningful
 *      for a launched, airborne opponent.
 *
 *   2. If the opponent is in `'hitstun'` they are *forced* to commit
 *      to whatever DI they are currently applying — read the velocity
 *      direction directly. Strong horizontal velocity dominates;
 *      vertical-only knockback returns `'none'`.
 *
 *   3. Otherwise (airborne but not in hitstun) the opponent is in
 *      free-flight recovery: they will steer toward the *nearest*
 *      ledge to minimise the recovery distance. Compute the distance
 *      to each ledge from the opponent's current X and pick the
 *      shorter side.
 *
 * The two-tier policy (hitstun-driven vs recovery-driven) matches the
 * Smash-Bros DI metagame: while in hitstun the player has only
 * marginal control (they can angle the trajectory but can't reverse
 * it); once hitstun ends they have full air-control and steer
 * directly. The Hard-tier bot inspects both regimes and picks the
 * appropriate model.
 */
export function predictDIDirection(input: PredictDIInput): DIDirection {
  const { opponent, stage } = input;
  const pos = opponent.position;
  if (!pos) return 'none';
  if (!opponent.isAirborne) return 'none';

  const launchThreshold =
    input.launchThresholdPx ?? DEFAULT_DI_LAUNCH_THRESHOLD_PX;

  // Opponent is on stage (not below the launch threshold) — DI
  // prediction is moot.
  if (pos.y <= stage.stageTop + launchThreshold) return 'none';

  // ---- Hitstun-driven DI ---------------------------------------------------
  // While in hitstun the opponent is committed to whatever DI they
  // are currently applying; the velocity sign is the best estimator
  // of which direction they'll continue to bias toward.
  if (opponent.stateLabel === 'hitstun') {
    const v = opponent.velocity;
    if (!v) return 'none';
    if (!Number.isFinite(v.vx)) return 'none';
    // A small horizontal component (|vx| < 1 px/frame) is essentially
    // pure vertical knockback — no meaningful DI signal.
    if (Math.abs(v.vx) < 1) return 'none';
    return v.vx > 0 ? 'right' : 'left';
  }

  // ---- Recovery-driven DI --------------------------------------------------
  // Free-flight recovery: pick the nearest ledge. An opponent off
  // the right of the stage will recover to the right ledge; one off
  // the left will recover to the left.
  const distToLeft = Math.abs(pos.x - stage.stageLeft);
  const distToRight = Math.abs(pos.x - stage.stageRight);
  // Tie-break left-side to keep the predicate fully deterministic.
  return distToLeft <= distToRight ? 'left' : 'right';
}

// ---------------------------------------------------------------------------
// Trajectory projection — DI-aware landing X
// ---------------------------------------------------------------------------

/**
 * Inputs to {@link predictHitstunLandingX}.
 */
export interface PredictHitstunLandingInput {
  readonly opponent: OpponentSnapshot;
  readonly stage: PerceivedStage;
  /**
   * Lookahead horizon (fixed steps). Defaults to
   * {@link DEFAULT_DI_LOOKAHEAD_FRAMES}. Clamped to
   * `[0, MAX_DI_LOOKAHEAD_FRAMES]`.
   */
  readonly lookaheadFrames?: number;
  /**
   * Per-frame DI bias magnitude (design pixels). Defaults to
   * {@link DEFAULT_DI_BIAS_MAGNITUDE}. A larger value models a
   * stronger "competent player" DI assumption; 0 disables DI bias
   * entirely (the projection collapses to a pure ballistic
   * extrapolation).
   */
  readonly diBiasMagnitude?: number;
  /**
   * Per-frame gravity acceleration (design pixels per frame²). Used
   * only to determine *when* the opponent will pass through stage-top
   * altitude, not to alter the X projection. Defaults to
   * {@link DEFAULT_DI_GRAVITY_PX_PER_FRAME_SQ}.
   */
  readonly gravityPxPerFrameSq?: number;
  /**
   * Optional explicit DI direction override. When provided, skips
   * {@link predictDIDirection} and uses the supplied direction
   * directly. Useful for tests that want to assert the projection in
   * isolation, and for the controller layer that already knows the
   * direction (e.g. from a pinned target's recovery animation).
   */
  readonly diDirection?: DIDirection;
}

/**
 * Result of a hitstun-trajectory projection.
 *
 *   - `landingX`         — the projected X coordinate at which the
 *                          opponent reaches stage-top altitude (or
 *                          peaks again, whichever comes first within
 *                          the lookahead window).
 *   - `framesToLanding`  — number of fixed steps until the opponent
 *                          reaches stage-top altitude. `null` if the
 *                          projection falls off the lookahead window
 *                          (opponent is too low / too slow to recover
 *                          in time).
 *   - `diDirection`      — the DI direction the projection applied.
 *                          Surfaced so callers / replay overlays can
 *                          show the predicted DI alongside the landing.
 */
export interface HitstunLandingPrediction {
  readonly landingX: number;
  readonly framesToLanding: number | null;
  readonly diDirection: DIDirection;
}

/**
 * Project the opponent's hitstun trajectory and return the predicted
 * landing X coordinate (where they will arrive at stage-top altitude).
 *
 * Algorithm:
 *
 *   1. Resolve the predicted DI direction (caller override or
 *      {@link predictDIDirection}).
 *
 *   2. Per-frame integrate position from the opponent's current
 *      `position`/`velocity`, applying:
 *      - Gravity to vy each frame.
 *      - DI bias (`±diBiasMagnitude`) added to vx each frame.
 *
 *   3. Stop when the trajectory crosses stage-top altitude on the
 *      way *up* (recovering opponent reached the lip), or when the
 *      lookahead horizon is exhausted (returns the X at the
 *      horizon).
 *
 * Falls back to the opponent's current X when:
 *   - The opponent has no `position` (legacy snapshot).
 *   - The opponent has no `velocity`.
 *   - Velocity components are not finite.
 */
export function predictHitstunLandingX(
  input: PredictHitstunLandingInput,
): HitstunLandingPrediction {
  const { opponent, stage } = input;
  const pos = opponent.position;

  if (!pos) {
    return { landingX: 0, framesToLanding: null, diDirection: 'none' };
  }
  const v = opponent.velocity;
  if (!v || !Number.isFinite(v.vx) || !Number.isFinite(v.vy)) {
    return { landingX: pos.x, framesToLanding: null, diDirection: 'none' };
  }

  const lookahead = clampDILookahead(
    input.lookaheadFrames ?? DEFAULT_DI_LOOKAHEAD_FRAMES,
  );
  const biasMag = Number.isFinite(input.diBiasMagnitude as number)
    ? (input.diBiasMagnitude as number)
    : DEFAULT_DI_BIAS_MAGNITUDE;
  const gravity = Number.isFinite(input.gravityPxPerFrameSq as number)
    ? (input.gravityPxPerFrameSq as number)
    : DEFAULT_DI_GRAVITY_PX_PER_FRAME_SQ;

  const diDirection =
    input.diDirection ?? predictDIDirection({ opponent, stage });
  const biasSign =
    diDirection === 'right' ? 1 : diDirection === 'left' ? -1 : 0;
  const biasPerFrame = biasSign * biasMag;

  // Integrate one step at a time. We keep the loop body branchless
  // (no early exit until the altitude check) so the projection cost
  // is bounded by `lookahead` and consistent across calls.
  let x = pos.x;
  let y = pos.y;
  let vx = v.vx;
  let vy = v.vy;

  // If the opponent is already at or above the stage top, the
  // landing is trivially the current X with zero frames to landing.
  if (y <= stage.stageTop) {
    return {
      landingX: x,
      framesToLanding: 0,
      diDirection,
    };
  }

  for (let f = 1; f <= lookahead; f += 1) {
    vx += biasPerFrame;
    vy += gravity;
    x += vx;
    y += vy;
    // Crossing stage-top from below (Y growing down) — opponent has
    // recovered to the lip. Return the current X as the landing.
    if (y <= stage.stageTop) {
      return { landingX: x, framesToLanding: f, diDirection };
    }
  }

  // Lookahead exhausted without reaching stage-top altitude. Return
  // the projection at the horizon — caller decides whether to act.
  return { landingX: x, framesToLanding: null, diDirection };
}

/**
 * Clamp a caller-supplied DI lookahead value to the supported band.
 * Mirrors the same NaN/negative/over-range handling as
 * {@link clampLookaheadFrames}.
 */
export function clampDILookahead(framesAhead: number): number {
  if (typeof framesAhead !== 'number' || !Number.isFinite(framesAhead)) {
    return DEFAULT_DI_LOOKAHEAD_FRAMES;
  }
  if (framesAhead < 0) return DEFAULT_DI_LOOKAHEAD_FRAMES;
  if (framesAhead > MAX_DI_LOOKAHEAD_FRAMES) return MAX_DI_LOOKAHEAD_FRAMES;
  return framesAhead;
}

// ---------------------------------------------------------------------------
// Edge-guarding integration — DI-aware ledge selection
// ---------------------------------------------------------------------------

/**
 * Pick the ledge the opponent is most likely to recover to, accounting
 * for predicted DI. DI-aware replacement for
 * {@link import('./edgeGuardPolicy').nearestStageEdge}.
 *
 * Behaviour:
 *
 *   - When the opponent is not in a launched state (not airborne or
 *     above the launch threshold) → falls back to the side of the
 *     opponent's *current* X (matches the existing
 *     {@link nearestStageEdge} behaviour).
 *
 *   - When the opponent is launched → projects the hitstun trajectory
 *     via {@link predictHitstunLandingX} and picks the side of the
 *     stage the projected landing X belongs to.
 *
 * Tie-breaks left when the projected landing X is exactly at the
 * stage midpoint, mirroring {@link nearestStageEdge}'s convention.
 */
export function predictedRecoveryEdge(
  input: PredictHitstunLandingInput,
): 'left' | 'right' {
  const { opponent, stage } = input;
  const pos = opponent.position;
  // No position → can't predict; default to the left ledge so the
  // caller sees a deterministic answer rather than a thrown error.
  if (!pos) return 'left';

  const launchThreshold =
    DEFAULT_DI_LAUNCH_THRESHOLD_PX;
  // Not launched — fall back to the simple "which side is the
  // opponent currently closer to" predicate. This mirrors the
  // existing nearestStageEdge policy.
  if (!opponent.isAirborne || pos.y <= stage.stageTop + launchThreshold) {
    const mid = (stage.stageLeft + stage.stageRight) / 2;
    return pos.x <= mid ? 'left' : 'right';
  }

  const projection = predictHitstunLandingX(input);
  const mid = (stage.stageLeft + stage.stageRight) / 2;
  return projection.landingX <= mid ? 'left' : 'right';
}

/**
 * DI-aware anchor X for the edge-guard branch. Combines
 * {@link predictedRecoveryEdge} with the existing
 * {@link edgeGuardAnchorX}.
 *
 * The bot walks toward the *predicted* ledge corner, not the
 * *current* one — the difference is what makes a Hard-tier
 * edge-guard succeed against a competent recovery DI.
 */
export function predictedEdgeGuardAnchorX(
  input: PredictHitstunLandingInput,
  tolerancePx: number = DEFAULT_LEDGE_ANCHOR_TOLERANCE_PX,
): number {
  const side = predictedRecoveryEdge(input);
  return edgeGuardAnchorX(side, input.stage, tolerancePx);
}
