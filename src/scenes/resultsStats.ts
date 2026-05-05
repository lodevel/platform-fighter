/**
 * Sub-AC 2 of AC 16 — Phaser-free formatter helpers for the
 * post-match stats panel rendered by `ResultsScene`.
 *
 * `MatchStatsTracker` (Sub-AC 1) emits a per-player snapshot in the
 * deterministic 60 Hz frame domain. The results scene needs to turn
 * each snapshot into a single human-readable line:
 *
 *   "★ P1  WOLF       4 KOs  240%   1:42"
 *
 * Keeping the formatter in its own module — alongside
 * `resultsHeadline.ts` — gives us:
 *
 *   • Phaser-free testability under plain Node. The scene class
 *     imports Phaser, which pulls in browser globals at module-eval
 *     time; vitest can't load it without jsdom + heavy stubs. The
 *     pure-string formatters here are exercised directly by the
 *     `ResultsScene.test.ts` suite.
 *
 *   • Determinism. Every helper is a pure function of its inputs.
 *     A replay that lands on the same final-frame stats produces a
 *     byte-identical results panel.
 *
 *   • Single source of truth for the column widths and the
 *     "MM:SS" / "M:SS" survival formatting, so the main-pass column
 *     alignment can't drift between the renderer and unit tests.
 *
 * The frame rate is parameterised (default 60 Hz) so a future port to
 * a different fixed timestep doesn't have to chase magic numbers
 * through the code.
 */

import type { PlayerMatchStats } from '../match';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default fixed-step rate used to convert `survivalFrames` into
 * mm:ss. Mirrors `TIME_MATCH_FRAME_RATE_HZ` so the results screen and
 * the time-mode HUD stay aligned.
 */
export const DEFAULT_RESULTS_FRAME_RATE_HZ = 60;

/**
 * Width of the player-name column in the rendered stats line. Names
 * shorter than this are right-padded with spaces so the KO/damage/
 * time columns line up under the headline. Names longer than this are
 * truncated to keep the row from wrapping at 4-player FFA widths.
 *
 * 10 characters comfortably fits the M2 cast (Wolf, Cat, Bear, Owl)
 * plus the longest keyboard-bound default ("Player 4").
 */
export const PLAYER_NAME_COLUMN_WIDTH = 10;

// ---------------------------------------------------------------------------
// Survival time formatting
// ---------------------------------------------------------------------------

/**
 * Convert a frame count to a human-readable "M:SS" (or "MM:SS") string
 * in the deterministic 60 Hz frame domain.
 *
 * Defensive contract:
 *   • Negative or non-finite inputs render as `"0:00"` so a buggy
 *     tracker can't crash the results screen.
 *   • Fractional inputs are floored — survival time on the results
 *     screen is reported in whole seconds.
 *   • A custom `frameRateHz` may be supplied for headless tests; it's
 *     clamped to a positive integer to avoid divide-by-zero.
 */
export function formatSurvivalTime(
  frames: number,
  frameRateHz: number = DEFAULT_RESULTS_FRAME_RATE_HZ,
): string {
  if (!Number.isFinite(frames) || frames < 0) return '0:00';
  const safeRate =
    Number.isFinite(frameRateHz) && frameRateHz > 0
      ? Math.floor(frameRateHz)
      : DEFAULT_RESULTS_FRAME_RATE_HZ;
  const totalSeconds = Math.floor(frames / safeRate);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  // Always two-digit seconds so "1:9" never renders. Minutes are not
  // zero-padded — sub-1-minute matches read as "0:42", longer matches
  // as "12:34" (no upper clamp).
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Damage formatting
// ---------------------------------------------------------------------------

/**
 * Render damage dealt as a percent string (e.g. `"240%"`).
 *
 * The match's `HitInfo.damage` units are percent points in the
 * `damageModel` ontology — so this is purely a display-side
 * concatenation. Defensive against negative / non-finite input
 * (renders as `"0%"`).
 */
export function formatDamageDealt(damage: number): string {
  if (!Number.isFinite(damage) || damage <= 0) return '0%';
  // Floor to an integer percent — fractional percent has no meaning on
  // the results screen and the move-table data is integer-valued
  // anyway. `Math.round` would be plausible too; floor matches the HUD.
  return `${Math.floor(damage)}%`;
}

// ---------------------------------------------------------------------------
// Stats line formatting
// ---------------------------------------------------------------------------

export interface StatsLineInput {
  /** 0-based slot index. Rendered as `P${index+1}`. */
  readonly index: number;
  /** Display name (truncated/padded to {@link PLAYER_NAME_COLUMN_WIDTH}). */
  readonly name: string;
  /** True iff this slot is the match winner — gets the leading star. */
  readonly isWinner: boolean;
  /** Per-player stats snapshot from `MatchStatsTracker.getStats`. */
  readonly stats: PlayerMatchStats;
  /** Optional frame rate override; defaults to 60 Hz. */
  readonly frameRateHz?: number;
}

/**
 * Render a single per-player line for the stats panel:
 *
 *   `★ P1  WOLF       4 KOs   240%   1:42`
 *
 * Columns:
 *   • `★ ` for the winner, two spaces otherwise (so non-winner rows
 *     don't shift left and the eye can scan KOs straight down).
 *   • `P${index+1}` slot tag.
 *   • Display name, padded/truncated to a fixed column.
 *   • KO count, suffixed with `KO` or `KOs`.
 *   • Damage dealt as percent.
 *   • Survival time `M:SS`.
 */
export function formatStatsLine(input: StatsLineInput): string {
  const prefix = input.isWinner ? '★ ' : '  ';
  const slot = `P${input.index + 1}`;
  const name = padOrTruncate(input.name, PLAYER_NAME_COLUMN_WIDTH);
  const kos = input.stats.kos;
  const koLabel = `${kos} ${kos === 1 ? 'KO' : 'KOs'}`;
  const damage = formatDamageDealt(input.stats.damageDealt);
  const time = formatSurvivalTime(input.stats.survivalFrames, input.frameRateHz);
  // Fixed-width gutters keep the 4-row FFA panel a clean grid.
  // KO column is min-width 6 ("4 KOs ") so the damage column lines up.
  const koCell = padOrTruncate(koLabel, 6);
  const damageCell = padOrTruncate(damage, 6);
  return `${prefix}${slot}  ${name}  ${koCell}  ${damageCell}  ${time}`;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

/**
 * Header row that lines up above the stats lines for visual scanning.
 * Column widths match {@link formatStatsLine}, so the numeric columns
 * sit directly under the labels regardless of player-name length.
 */
export function getStatsPanelHeader(): string {
  // Two-space "no winner star" prefix + "P#" slot column + name column.
  const prefix = '  ';
  const slot = '  ';
  const name = padOrTruncate('PLAYER', PLAYER_NAME_COLUMN_WIDTH);
  const koCell = padOrTruncate('KO', 6);
  const damageCell = padOrTruncate('DMG', 6);
  return `${prefix}${slot}  ${name}  ${koCell}  ${damageCell}  TIME`;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Right-pad with spaces or truncate to a fixed column width. Used so
 * every line in the stats panel has the same gutter widths regardless
 * of name / number length.
 */
function padOrTruncate(text: string, width: number): string {
  if (text.length === width) return text;
  if (text.length < width) return text.padEnd(width, ' ');
  return text.slice(0, width);
}
