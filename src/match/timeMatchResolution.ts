/**
 * Phaser-free helpers for resolving time-mode match end conditions.
 *
 * AC 12 — "Time-mode tie triggers sudden death."
 *
 * In time mode, a match has a fixed duration. When the clock expires:
 *
 *   • The player with the **most stocks remaining** wins.
 *   • If two or more players are tied for the most stocks remaining,
 *     the result is a *tie*; the engine triggers a sudden-death
 *     playoff between exactly the tied players.
 *   • If every player has been eliminated (zero stocks all round —
 *     extremely rare, but possible in low-stock-count time matches),
 *     the result is a *draw* with no winner.
 *
 * This file contains the pure, deterministic state-machine helpers
 * that decide which of those three outcomes a given (stocks, elapsed,
 * limit) snapshot represents. The helpers are Phaser-free, side-
 * effect-free, and replay-byte-equivalent — so they are safe to call
 * from gameplay scenes, replay tooling, AI evaluators, and headless
 * unit tests alike.
 *
 * The companion stateful coordinator that *acts on* these resolutions —
 * resetting the StockTracker into a 1-stock sudden-death playoff and
 * unlatching the match-end gate — lives in {@link SuddenDeathController}.
 *
 * Frame model
 * -----------
 *
 *   • All times are deterministic 60 Hz fixed-step frames.
 *     {@link timeLimitSecondsToFrames} converts the user-facing seconds
 *     value (`MatchConfig.timeLimitSeconds`) into the canonical frame
 *     count consumers track elapsed time against.
 *
 *   • `elapsedFrames >= timeLimitFrames` is "time-up" (inclusive lower
 *     bound). A 0-frame timer is "expired immediately"; this is only
 *     used by tests that pre-trigger end-of-time without advancing the
 *     clock.
 *
 *   • Negative or non-finite frame counts clamp defensively to 0 so a
 *     malformed config can't crash the resolver.
 */

import type { MatchConfig } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Canonical fixed-step rate in Hz. Mirrors the engine's 60 Hz integration
 * so this helper doesn't have to import the physics module to convert
 * `timeLimitSeconds` to frames.
 */
export const TIME_MATCH_FRAME_RATE_HZ = 60;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Outcome produced by {@link evaluateTimeMatch} once the timer has
 * expired. Discriminated union so consumers can branch with an
 * exhaustive `switch`:
 *
 *   • `'in-progress'` — timer hasn't expired yet; nothing to do.
 *   • `'winner'` — exactly one player has the highest stock count;
 *     they win the match outright.
 *   • `'tie'` — two or more players are tied for the highest stock
 *     count. The `tiedIndexes` array lists every tied slot, in
 *     ascending player-index order, and is the input the sudden-
 *     death controller uses to set up the 1-stock playoff.
 *   • `'draw'` — every player has been eliminated. No winner, no
 *     sudden death; the match ends as a draw and the results scene
 *     shows a "DRAW" banner.
 */
export type TimeMatchResolution =
  | { readonly kind: 'in-progress' }
  | { readonly kind: 'winner'; readonly winnerIndex: number }
  | { readonly kind: 'tie'; readonly tiedIndexes: ReadonlyArray<number> }
  | { readonly kind: 'draw' };

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

/**
 * Convert a user-facing `timeLimitSeconds` value into the canonical
 * fixed-step frame count consumers compare elapsed time against.
 *
 * Always returns a non-negative integer:
 *   • `seconds <= 0` or non-finite → `0` (timer is expired immediately).
 *   • Fractional seconds → rounded down (so a 90.7 s limit lands on
 *     the same exact frame across platforms).
 */
export function timeLimitSecondsToFrames(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(0, Math.floor(seconds * TIME_MATCH_FRAME_RATE_HZ));
}

/**
 * Pull the canonical time-limit frame count off a `MatchConfig`. For
 * non-time matches (stock mode), or time matches without a configured
 * timer, returns `null` — callers should branch on this rather than
 * silently treating "no timer" as "0 frames" (which would short-circuit
 * to instant time-up).
 */
export function getMatchConfigTimeLimitFrames(
  config: Pick<MatchConfig, 'mode' | 'timeLimitSeconds'>,
): number | null {
  if (config.mode !== 'time') return null;
  if (typeof config.timeLimitSeconds !== 'number') return null;
  if (!Number.isFinite(config.timeLimitSeconds) || config.timeLimitSeconds <= 0) {
    return null;
  }
  return timeLimitSecondsToFrames(config.timeLimitSeconds);
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Return the player indexes that are tied for the highest stock count
 * in the supplied snapshot.
 *
 *   • Eliminated players (0 stocks) are excluded from the leader pool —
 *     only "still alive" players can be a winner-or-tied-for-first.
 *   • If every player is eliminated, returns an empty array (the
 *     "everybody wiped" draw case).
 *   • If exactly one player has the highest stock count, returns a
 *     single-element array — the caller can treat this as the winner.
 *   • Returned indexes are in ascending order (defensive; callers
 *     iterate them to mutate trackers / build banners).
 */
export function findStockLeaders(
  stocksByPlayer: ReadonlyArray<number>,
): number[] {
  let highest = 0;
  for (let i = 0; i < stocksByPlayer.length; i += 1) {
    const s = stocksByPlayer[i] ?? 0;
    if (s > highest) highest = s;
  }
  if (highest <= 0) return [];
  const leaders: number[] = [];
  for (let i = 0; i < stocksByPlayer.length; i += 1) {
    if ((stocksByPlayer[i] ?? 0) === highest) leaders.push(i);
  }
  return leaders;
}

/**
 * `true` iff the configured timer has expired. Inclusive on the
 * upper bound — `elapsedFrames === timeLimitFrames` *is* time-up — so
 * a 0-frame timer fires on the very first tick (used by tests).
 *
 * Defensive against malformed inputs:
 *   • Negative / non-finite `elapsedFrames` clamp to 0 (still ticking).
 *   • Negative / non-finite `timeLimitFrames` is treated as "no timer"
 *     and returns `false` — the match never auto-ends.
 */
export function isTimeUp(
  elapsedFrames: number,
  timeLimitFrames: number,
): boolean {
  if (!Number.isFinite(timeLimitFrames) || timeLimitFrames <= 0) return false;
  const elapsed =
    !Number.isFinite(elapsedFrames) || elapsedFrames < 0
      ? 0
      : Math.floor(elapsedFrames);
  return elapsed >= Math.floor(timeLimitFrames);
}

/**
 * Resolve a time-mode match against the supplied stock snapshot. The
 * core decision tree:
 *
 *   1. Timer hasn't expired → `'in-progress'`.
 *   2. All players eliminated → `'draw'`.
 *   3. Exactly one stock-leader → `'winner'`.
 *   4. Two or more stock-leaders → `'tie'` (sudden-death trigger).
 *
 * Pure function — same inputs always produce the same output, no
 * hidden state, no Phaser/DOM globals. The replay-determinism gate
 * relies on this property.
 */
export function evaluateTimeMatch(
  stocksByPlayer: ReadonlyArray<number>,
  elapsedFrames: number,
  timeLimitFrames: number,
): TimeMatchResolution {
  if (!isTimeUp(elapsedFrames, timeLimitFrames)) {
    return { kind: 'in-progress' };
  }
  const leaders = findStockLeaders(stocksByPlayer);
  if (leaders.length === 0) return { kind: 'draw' };
  if (leaders.length === 1) {
    return { kind: 'winner', winnerIndex: leaders[0]! };
  }
  return { kind: 'tie', tiedIndexes: Object.freeze(leaders.slice()) };
}

/**
 * Frames remaining on the timer. Returns `0` once the timer has
 * expired (clamped, never negative); returns `timeLimitFrames` when
 * the match has just started (elapsed=0); returns `Infinity` for a
 * stock match (no configured timer) so consumers can render "—:—" for
 * the HUD without branching on a `null` return type.
 */
export function getTimeRemainingFrames(
  elapsedFrames: number,
  timeLimitFrames: number,
): number {
  if (!Number.isFinite(timeLimitFrames) || timeLimitFrames <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const elapsed =
    !Number.isFinite(elapsedFrames) || elapsedFrames < 0
      ? 0
      : Math.floor(elapsedFrames);
  return Math.max(0, Math.floor(timeLimitFrames) - elapsed);
}
