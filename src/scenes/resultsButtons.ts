/**
 * AC 18 — Phaser-free helpers for the post-match action buttons rendered
 * by `ResultsScene`.
 *
 * (Originally numbered AC 17 in the pre-M1.5 seed; everything shifted +1
 * when M1.5 — the content pipeline — landed as AC 2. The behavioural
 * contract is unchanged; only the AC label differs across the doc trail.)
 *
 * The seed lists "Rematch button and return-to-lobby button on results
 * screen" as a v1 acceptance criterion. The screen needs two on-screen,
 * pointer-clickable affordances:
 *
 *   • REMATCH        — restarts `MatchScene` immediately (same hotkey
 *                      as before: [ENTER]).
 *   • BACK TO LOBBY  — returns to the `CharacterSelectScene` (the
 *                      "Press Start to join + character select" lobby
 *                      surface from the M2 milestone). Hotkey: [L].
 *
 * Why a Phaser-free helper:
 *
 *   1. **Testability.** `ResultsScene.ts` imports Phaser, which pulls
 *      browser globals at module-eval time. Anything we want to lock
 *      down with vitest under plain Node has to live in a side module
 *      — same pattern as `resultsHeadline.ts` and `resultsStats.ts`.
 *
 *   2. **Single source of truth.** Button labels, hotkey names, and
 *      target scene keys are constants here. The renderer reads them
 *      and the unit-test suite reads them, so the contract cannot
 *      drift between docs / UI / tests.
 *
 *   3. **Determinism.** Pure functions of their inputs — no clock, no
 *      RNG, no DOM. The results screen is presentational and the
 *      buttons inherit that property.
 *
 * The render layout (centre coordinates, button size) is also computed
 * here so a future visual tweak doesn't require re-running the suite
 * against a live Phaser scene.
 */

// ---------------------------------------------------------------------------
// Button identity
// ---------------------------------------------------------------------------

/**
 * One of the two action buttons on the results screen. The literal
 * union doubles as a stable id for tests and analytics — preferable
 * to passing labels around because labels are render-side strings
 * the seed could call out for restyling.
 */
export type ResultsButtonId = 'rematch' | 'backToLobby';

/**
 * Static contract for one button: visible label, the keyboard shortcut
 * Phaser uses for `keydown-${shortcutKey}`, the user-visible hint
 * appended after the label, and the target scene key the button starts.
 */
export interface ResultsButtonSpec {
  /** Stable id — never user-visible. */
  readonly id: ResultsButtonId;
  /** Big text painted on the button face (uppercase). */
  readonly label: string;
  /** Phaser key event suffix — e.g. `ENTER` → `keydown-ENTER`. */
  readonly shortcutKey: string;
  /** Visible "[ENTER]" annotation rendered under the label. */
  readonly shortcutHint: string;
  /** Phaser scene key to start when the button is activated. */
  readonly targetScene: string;
}

/**
 * The canonical pair, in the order they appear on screen
 * (rematch on the left, back-to-lobby on the right). Ordering matters
 * because: a) right-handed players reach for ENTER on the right side
 * of the keyboard, but the primary "play again" action wants to read
 * first when scanning left-to-right; b) the keyboard hotkey for the
 * first button is ENTER (already the default "confirm"), and the
 * second is `L` for "lobby" — both unambiguous and physically
 * distant from each other so a panicked tap can't fire the wrong
 * action.
 */
export const RESULTS_BUTTONS: ReadonlyArray<ResultsButtonSpec> = Object.freeze(
  [
    Object.freeze({
      id: 'rematch' as const,
      label: 'REMATCH',
      shortcutKey: 'ENTER',
      shortcutHint: '[ENTER]',
      targetScene: 'MatchScene',
    }),
    Object.freeze({
      id: 'backToLobby' as const,
      label: 'BACK TO LOBBY',
      shortcutKey: 'L',
      shortcutHint: '[L]',
      targetScene: 'CharacterSelectScene',
    }),
  ],
);

/**
 * Convenience lookup — returns the spec for the given id, or `null` if
 * the id is unknown. Tests use this to assert "the rematch button goes
 * to MatchScene" without indexing the array directly.
 */
export function getResultsButtonSpec(
  id: ResultsButtonId,
): ResultsButtonSpec | null {
  return RESULTS_BUTTONS.find((b) => b.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Visual dimensions of one rendered button. The renderer uses these
 * to draw the background rectangle; the hit region matches.
 */
export interface ResultsButtonSize {
  readonly width: number;
  readonly height: number;
}

/** A single button's centre point on the canvas, paired with its spec. */
export interface ResultsButtonPlacement {
  readonly spec: ResultsButtonSpec;
  readonly cx: number;
  readonly cy: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Default render size for the two action buttons. Sized comfortably for
 * mouse / trackpad clicks and large enough for the full `BACK TO LOBBY`
 * label at the chosen 22px font.
 */
export const DEFAULT_RESULTS_BUTTON_SIZE: ResultsButtonSize = Object.freeze({
  width: 280,
  height: 64,
});

/**
 * Vertical placement of the button row, expressed as a fraction of the
 * scene height. 0.78 mirrors the previous "Press [ENTER]" prompt's row
 * so adding the buttons doesn't shove the stats panel up.
 */
export const RESULTS_BUTTON_ROW_Y_FRACTION = 0.78;

/**
 * Horizontal gap (px) between the two buttons. Wide enough that a
 * stray drag from one button can't accidentally trigger the other.
 */
export const RESULTS_BUTTON_GAP = 32;

/**
 * Compute centre positions for the two buttons given the canvas size.
 * Buttons are arranged horizontally, centred on the canvas's mid-X,
 * with `RESULTS_BUTTON_GAP` between them. The y-coordinate is
 * `height * RESULTS_BUTTON_ROW_Y_FRACTION`.
 *
 * Defensive against zero / negative dimensions — clamps to non-negative
 * so a freshly-resized canvas mid-transition doesn't NaN the layout.
 */
export function layoutResultsButtons(
  canvasWidth: number,
  canvasHeight: number,
  size: ResultsButtonSize = DEFAULT_RESULTS_BUTTON_SIZE,
): ResultsButtonPlacement[] {
  const safeWidth = Number.isFinite(canvasWidth) && canvasWidth > 0 ? canvasWidth : 0;
  const safeHeight =
    Number.isFinite(canvasHeight) && canvasHeight > 0 ? canvasHeight : 0;
  const cy = safeHeight * RESULTS_BUTTON_ROW_Y_FRACTION;
  const totalWidth =
    size.width * RESULTS_BUTTONS.length + RESULTS_BUTTON_GAP * (RESULTS_BUTTONS.length - 1);
  const leftEdge = (safeWidth - totalWidth) / 2;
  return RESULTS_BUTTONS.map((spec, i) => {
    const cx = leftEdge + size.width / 2 + i * (size.width + RESULTS_BUTTON_GAP);
    return {
      spec,
      cx,
      cy,
      width: size.width,
      height: size.height,
    };
  });
}
