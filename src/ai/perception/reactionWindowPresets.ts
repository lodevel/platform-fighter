/**
 * Difficulty-tier presets for the AI reaction window.
 *
 * The Hard tier targets the AC-mandated 15-20 frame band — roughly the
 * 250-330 ms reaction time of a competent human player at 60 FPS. Easy
 * and Medium are widened so bots feel noticeably slower in believable
 * ways (a beginner reacts in ~half a second; an intermediate in a third
 * of a second).
 *
 * Numbers are tuned for 60 FPS fixed-step. If the simulation rate ever
 * changes, the bands here are the single source of truth — adjust once
 * and every difficulty tier scales coherently.
 */

import { type ReactionWindowRange } from './ReactionWindow';

/** AI difficulty tiers used across the lobby, AI controller, and replay log. */
export type AiDifficulty = 'easy' | 'medium' | 'hard';

/**
 * Per-tier reaction-window bands.
 *
 * Frozen object so consumers can pass entries directly into
 * {@link ReactionWindow} without worrying about accidental mutation.
 * Values:
 *
 *   - `easy`   — 28-36 frames (≈ 470-600 ms). Slow-to-react beginner.
 *   - `medium` — 22-28 frames (≈ 365-465 ms). Intermediate player.
 *   - `hard`   — 15-20 frames (≈ 250-330 ms). Competent human.
 *                **Source of truth for the M2 AI Hard-tier AC**.
 */
export const REACTION_WINDOW_PRESETS: Readonly<
  Record<AiDifficulty, ReactionWindowRange>
> = Object.freeze({
  easy: Object.freeze({ minDelayFrames: 28, maxDelayFrames: 36 }),
  medium: Object.freeze({ minDelayFrames: 22, maxDelayFrames: 28 }),
  hard: Object.freeze({ minDelayFrames: 15, maxDelayFrames: 20 }),
}) satisfies Readonly<Record<AiDifficulty, ReactionWindowRange>>;

/**
 * Look up the reaction-window range for a given difficulty tier.
 *
 * Wrapper exists so callers don't have to import the dictionary
 * directly and so future tier additions (e.g. "expert") can be added
 * without breaking the call sites.
 */
export function getReactionWindowRange(
  difficulty: AiDifficulty,
): ReactionWindowRange {
  return REACTION_WINDOW_PRESETS[difficulty];
}
