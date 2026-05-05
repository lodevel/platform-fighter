/**
 * Predictive-movement primitives — pure helpers consumed by the Hard-
 * tier {@link import('./PredictiveMoveLeaf').PredictiveMoveLeaf} and
 * the edge-guard branch.
 *
 * Why predictive movement is a Hard-tier concern
 * ----------------------------------------------
 *
 * The neutral {@link import('./MoveTowardOpponentLeaf').MoveTowardOpponentLeaf}
 * walks the bot toward the opponent's *current* position. That is fine
 * against a stationary or slow opponent, but a competent human reads
 * an opponent's velocity and walks toward where they *will be* a few
 * frames from now. Doing the same for the AI is the difference between
 * a bot that always trails the opponent by one frame's worth of
 * movement and a bot that intercepts.
 *
 * The helpers in this module are intentionally split into two layers:
 *
 *   1. {@link projectOpponentPosition} / {@link projectedOpponentDistance}
 *      — pure functions that take an `OpponentSnapshot` (with optional
 *      `velocity` / `position`) plus a self position and return the
 *      anticipated position / signed distance.
 *
 *   2. {@link choosePredictiveMoveDirection} — combines a projected
 *      distance with a `preferredRangePx` to decide whether to emit
 *      `'moveLeft'`, `'moveRight'`, or stop. The {@link
 *      import('./PredictiveMoveLeaf').PredictiveMoveLeaf} consumes this
 *      directly so the leaf itself stays trivially small and the
 *      decision logic is testable in isolation.
 *
 * Determinism
 * -----------
 *
 * Every helper is a pure function of its inputs — no `Math.random`,
 * no wall-clock reads, no allocation beyond the projection record.
 * Identical inputs always produce identical outputs, which is what the
 * replay system needs to reconstruct an AI's choices verbatim from
 * the snapshot stream.
 */

import type { OpponentSnapshot } from './types';

// ---------------------------------------------------------------------------
// Tunables — exported so consumers can pin / clamp lookahead ranges
// ---------------------------------------------------------------------------

/**
 * Default lookahead horizon (fixed steps) the Hard-tier predictive
 * movement uses. Tuned to roughly half a Hard-tier reaction window
 * (15-20 frames) so the bot's "where will they be" estimate moves
 * faster than its own perception delay — preventing the cascading
 * lag-on-lag effect of using the full window for both perception and
 * movement projection.
 */
export const DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES = 8;

/**
 * Maximum lookahead supported. Beyond this horizon the velocity
 * extrapolation is unreliable (gravity / hitstun / DI all bend the
 * trajectory significantly), so we clamp callers' requests instead of
 * silently producing garbage projections.
 */
export const MAX_PREDICTIVE_LOOKAHEAD_FRAMES = 30;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a caller-supplied lookahead value to the supported band.
 *
 * - `NaN` / non-finite / negative → falls back to {@link
 *   DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES}. This makes the helper
 *   tolerant of accidentally-uninitialised options without forcing
 *   every call site to defend against NaN.
 * - Above {@link MAX_PREDICTIVE_LOOKAHEAD_FRAMES} → clamps to the cap.
 */
export function clampLookaheadFrames(framesAhead: number): number {
  if (typeof framesAhead !== 'number' || !Number.isFinite(framesAhead)) {
    return DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES;
  }
  if (framesAhead < 0) return DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES;
  if (framesAhead > MAX_PREDICTIVE_LOOKAHEAD_FRAMES) {
    return MAX_PREDICTIVE_LOOKAHEAD_FRAMES;
  }
  return framesAhead;
}

/**
 * Project the opponent's absolute position `framesAhead` steps ahead.
 *
 * Falls back to the *current* position when:
 *   - The opponent has no `velocity` (legacy snapshot), OR
 *   - The opponent has no `position` (legacy snapshot), OR
 *   - The velocity components are not finite.
 *
 * Returns a fresh `{x, y}` plain object so callers can store /
 * compare it without aliasing the snapshot's interior records.
 */
export function projectOpponentPosition(
  opponent: OpponentSnapshot,
  framesAhead: number = DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES,
): { x: number; y: number } | null {
  if (!opponent.position) return null;
  const ahead = clampLookaheadFrames(framesAhead);
  const v = opponent.velocity;
  const vx = v && Number.isFinite(v.vx) ? v.vx : 0;
  const vy = v && Number.isFinite(v.vy) ? v.vy : 0;
  return {
    x: opponent.position.x + vx * ahead,
    y: opponent.position.y + vy * ahead,
  };
}

/**
 * Compute the signed horizontal distance from `selfX` to the
 * opponent's *projected* position.
 *
 * Sign convention mirrors {@link OpponentSnapshot.distance} — positive
 * means the projected opponent is to the right of the bot.
 *
 * Falls back to the snapshot's current `distance` field when:
 *   - The opponent lacks a `position` (legacy snapshot), OR
 *   - `selfX` is not finite (defensive against accidentally-
 *     uninitialised callers).
 *
 * This fallback is what lets predictive movement degrade gracefully
 * to the existing non-predictive movement on snapshot streams that
 * haven't been upgraded to the new field set.
 */
export function projectedOpponentDistance(
  selfX: number,
  opponent: OpponentSnapshot,
  framesAhead: number = DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES,
): number {
  if (typeof selfX !== 'number' || !Number.isFinite(selfX)) {
    return opponent.distance;
  }
  const projected = projectOpponentPosition(opponent, framesAhead);
  if (projected === null) return opponent.distance;
  return projected.x - selfX;
}

/**
 * Decision verb returned by {@link choosePredictiveMoveDirection}.
 *
 *   - `'left'`  — emit `moveLeft`.
 *   - `'right'` — emit `moveRight`.
 *   - `'stop'`  — emit nothing this tick (already in the preferred
 *                 band around the projected interception point).
 */
export type PredictiveMoveDirection = 'left' | 'right' | 'stop';

/**
 * Pure decision: should the bot walk left, right, or hold to intercept
 * the opponent's projected position?
 *
 * - Inside `[-preferredRangePx, +preferredRangePx]` → `'stop'`.
 * - Otherwise → `'left'` / `'right'` toward the projected target.
 *
 * Returning a verb string (rather than directly emitting) keeps the
 * decision pure-functional and trivially testable.
 */
export function choosePredictiveMoveDirection(
  projectedDistance: number,
  preferredRangePx: number,
): PredictiveMoveDirection {
  if (Math.abs(projectedDistance) <= preferredRangePx) return 'stop';
  return projectedDistance > 0 ? 'right' : 'left';
}
