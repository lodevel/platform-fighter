/**
 * Time-mode + sudden-death rules — Tier 6 (Smash-parity roadmap).
 *
 * Pure, deterministic helpers (no Phaser, no Matter, no `Math.random`, no
 * wall-clock) for the two match formats the config already declares
 * (`MatchConfig.mode: 'stocks' | 'time'`) but the runtime never wired:
 *
 *   • A frame-counted MATCH TIMER that counts down from
 *     `timeLimitSeconds`. Frame-based (not wall-clock) so a replay
 *     re-derives the exact same expiry frame.
 *   • TIME-UP RESOLUTION by score: in time mode players respawn
 *     indefinitely and the winner is whoever has the best net score
 *     (`kos − falls`, the Smash convention). A tie sends the match to
 *     SUDDEN DEATH.
 *   • SUDDEN-DEATH setup constants: both fighters drop to one stock at a
 *     high starting percent so the next clean hit ends it.
 *
 * The `MatchScene` owns the wiring (ticking the timer on the fixed step,
 * pulling KO counts from `MatchStatsTracker`, fall counts from the
 * respawn/stock flow, and triggering sudden death); this module owns only
 * the rules so they are unit-testable without a scene fixture.
 */

/** Canonical fixed-step rate — one match frame is 1/60 s. */
export const MATCH_FPS = 60;

/** Default time limit when `MatchConfig.timeLimitSeconds` is absent — 2 minutes (Smash default). */
export const DEFAULT_TIME_LIMIT_SECONDS = 120;

/** Percent both fighters start sudden death at — a clean hit launches for the KO. */
export const SUDDEN_DEATH_START_PERCENT = 150;

/** Stocks each fighter gets in sudden death — one, first KO wins. */
export const SUDDEN_DEATH_STOCKS = 1;

/** A frame-counted countdown. Immutable; advanced by {@link tickMatchTimer}. */
export interface MatchTimer {
  /** Fixed-step frames left before time-up. Never negative. */
  readonly framesRemaining: number;
}

/**
 * Build a timer from a time limit in seconds. A non-positive / non-finite
 * limit falls back to {@link DEFAULT_TIME_LIMIT_SECONDS} so a malformed
 * config still produces a playable timed match rather than an instant
 * time-up.
 */
export function createMatchTimer(
  timeLimitSeconds: number | undefined,
  fps: number = MATCH_FPS,
): MatchTimer {
  const secs =
    typeof timeLimitSeconds === 'number' &&
    Number.isFinite(timeLimitSeconds) &&
    timeLimitSeconds > 0
      ? timeLimitSeconds
      : DEFAULT_TIME_LIMIT_SECONDS;
  return Object.freeze({ framesRemaining: Math.max(0, Math.round(secs * fps)) });
}

/** Advance the timer one fixed step. Clamps at 0 (idempotent once expired). */
export function tickMatchTimer(timer: MatchTimer): MatchTimer {
  if (timer.framesRemaining <= 0) return timer;
  return Object.freeze({ framesRemaining: timer.framesRemaining - 1 });
}

/** True once the countdown has drained — the match is over (time mode). */
export function isTimeUp(timer: MatchTimer): boolean {
  return timer.framesRemaining <= 0;
}

/**
 * Whole seconds left on the clock, rounded UP — so a HUD shows "1" for the
 * final partial second rather than blinking to 0 early, and only hits 0 on
 * the exact expiry frame.
 */
export function timerSecondsRemaining(
  timer: MatchTimer,
  fps: number = MATCH_FPS,
): number {
  if (fps <= 0) return 0;
  return Math.ceil(timer.framesRemaining / fps);
}

/** Per-player time-mode tally fed to {@link resolveTimeModeResult}. */
export interface TimeModeScore {
  /** KOs this player scored on opponents (from `MatchStatsTracker`). */
  readonly kos: number;
  /** Times this player was KO'd / self-destructed (their fall count). */
  readonly falls: number;
}

/** Outcome of a timed match at time-up. */
export interface TimeModeResult {
  /** Winning player index, or `null` when tied (→ sudden death). */
  readonly winnerIndex: number | null;
  /** True iff the top score is shared (the match must go to sudden death). */
  readonly tied: boolean;
  /** Net score (`kos − falls`) per player, index-aligned to the input. */
  readonly scores: ReadonlyArray<number>;
}

/**
 * Resolve a timed match. Each player's net score is `kos − falls` (the
 * Smash time-mode convention: a fall, including a self-destruct, costs you
 * a point). The highest unique score wins; a shared top score is a tie and
 * the caller must run sudden death. Pure — same tallies always resolve the
 * same way.
 */
export function resolveTimeModeResult(
  stats: ReadonlyArray<TimeModeScore>,
): TimeModeResult {
  const scores = stats.map((s) => s.kos - s.falls);
  let best = -Infinity;
  let bestIndex = -1;
  let topCount = 0;
  for (let i = 0; i < scores.length; i += 1) {
    const s = scores[i]!;
    if (s > best) {
      best = s;
      bestIndex = i;
      topCount = 1;
    } else if (s === best) {
      topCount += 1;
    }
  }
  const tied = topCount !== 1;
  return Object.freeze({
    winnerIndex: tied ? null : bestIndex,
    tied,
    scores,
  });
}
