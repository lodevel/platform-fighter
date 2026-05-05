/**
 * Phaser-free helper for `ResultsScene`'s headline string.
 *
 * Lives in its own module (rather than alongside the scene class) so
 * unit tests can import it under plain Node — Phaser pulls in browser
 * globals at module-eval time (`navigator`, `document`, etc.), so any
 * symbol that needs to be reachable from a vitest run must be
 * extractable without crossing the `import 'phaser'` line.
 *
 * Sub-AC 5 of AC 1 ("Implement victory screen scene displaying winner
 * and transitioning back to match start") relies on this function for
 * the "displaying winner" half of the contract.
 */

import type { MatchResultPayload } from '../match';

/**
 * Build the victory-screen headline string from a result payload.
 *
 * Returns:
 *   • `"MATCH OVER"` when no payload is supplied (defensive fallback
 *     for direct-navigation in dev).
 *   • `"DRAW"` when the payload reports `winnerIndex === null`.
 *   • `"<NAME> WINS"` (uppercased) for a sole-survivor win, falling
 *     back to `"Player N WINS"` when the payload didn't include a
 *     name for the winning slot.
 */
export function computeResultsHeadline(
  payload: MatchResultPayload | null,
): string {
  if (!payload) return 'MATCH OVER';
  const { winnerIndex, winnerName } = payload;
  if (winnerIndex === null) return 'DRAW';
  const name = winnerName ?? `Player ${winnerIndex + 1}`;
  return `${name.toUpperCase()} WINS`;
}
