/**
 * Phaser-free helpers for the in-match Pause overlay.
 *
 * When the player taps PAUSE mid-match (ESC / Start), `MatchScene` freezes
 * its deterministic fixed-step simulation and launches a thin overlay scene
 * on top of the still-rendered match. That overlay offers five flow actions:
 * resume, restart the match, drop to character select, bail to the main
 * menu, or open the controls rebinder. This module is the Phaser-free brain
 * behind that overlay — the cursor model, the wrap-around navigation, and
 * the option↔action mapping — with zero rendering and zero scene wiring.
 *
 * Why Phaser-free
 * ---------------
 *
 * Per the project's `code_architecture` evaluation principle, the menu
 * logic — "which option is highlighted", "what's the next option when the
 * player presses DOWN", "which action does this option resolve to" — is
 * pure state mutation. Splitting it out of the scene class lets us:
 *
 *   • Unit-test every transition under plain Node (Phaser pulls in browser
 *     globals at module-eval time and can't be loaded by a vitest worker).
 *   • Let `MatchScene` import `PAUSE_MENU_OPTIONS` / `PauseAction` to wire
 *     up its keyboard hotkeys and freeze/resume dispatch *without* pulling
 *     the overlay scene (or any Phaser) into that code path — exactly how
 *     `resultsButtons.ts` feeds both `ResultsScene`'s renderer and its
 *     tests from one source of truth.
 *   • Keep the overlay scene thin — lifecycle wiring + draw calls + a
 *     single 5-arm dispatch — in line with how `ModeSelectScene` /
 *     `ResultsScene` are already organised.
 *
 * Determinism
 * -----------
 *
 * The pause menu is *presentation / flow only*. It never touches the
 * deterministic simulation or RNG — freezing the loop is `MatchScene`'s
 * job. Accordingly every transition here is a pure function of its inputs:
 * no `Math.random()`, no wall-clock reads, no Phaser globals. The same
 * helpers can therefore be driven from a smoke-test harness or a replay
 * tool without booting a game.
 *
 * Design constraints
 * ------------------
 *
 *   • `PAUSE_MENU_OPTIONS` is the single source of truth for the visible
 *     label, the resolved action, the target scene key, and the keyboard
 *     shortcut hint. The renderer reads it, `MatchScene`'s hotkeys read it,
 *     and the unit suite reads it — so the contract cannot drift between
 *     UI / wiring / tests.
 *
 *   • Cursor navigation wraps both ways (DOWN past the last option jumps to
 *     the first, UP past the first wraps to the last) so a player who
 *     overshoots can always recover with another tap — mirroring
 *     `modeSelect.cycleMode` / `cycleQuantity`.
 *
 *   • The default cursor lands on `resume` (the safe no-op) so a panicked
 *     "confirm" right after pausing never throws the player out of the
 *     match.
 */

// ---------------------------------------------------------------------------
// Action identity
// ---------------------------------------------------------------------------

/**
 * One of the five flow actions the pause overlay can resolve to. The
 * string-literal union doubles as a stable id for tests, hotkey wiring,
 * and the scene's dispatch — preferable to passing labels around because
 * labels are render-side strings the design could call out for restyling.
 *
 *   • `resume`          — close the overlay, unfreeze the sim (no scene
 *                         transition).
 *   • `restart`         — restart `MatchScene` with the same `MatchConfig`.
 *   • `characterSelect` — drop back to the character-select lobby.
 *   • `mainMenu`        — bail all the way out to the main menu.
 *   • `controls`        — open the controls rebinder.
 */
export type PauseAction =
  | 'resume'
  | 'restart'
  | 'characterSelect'
  | 'mainMenu'
  | 'controls';

/**
 * Static contract for one pause-menu option — the single source of truth
 * binding a visible label to the action it resolves to, the scene key the
 * action transitions to, and the keyboard-shortcut hint rendered after the
 * label.
 */
export interface PauseMenuOption {
  /**
   * Stable id — never user-visible. Equals the option's `action` so the
   * scene can use it as a React-free stable list key and so hotkey wiring
   * can look an option up by the action it jumps to.
   */
  readonly id: PauseAction;
  /** Big text painted on the option row (e.g. `'Resume'`). */
  readonly label: string;
  /** The flow action this option resolves to when confirmed. */
  readonly action: PauseAction;
  /**
   * Phaser scene key to start when the option is activated, or `null` for
   * `resume` — which has no scene transition (it just closes the overlay
   * and unfreezes the sim).
   */
  readonly targetScene: string | null;
  /** Visible `[ESC]` / `[R]` annotation rendered alongside the label. */
  readonly shortcutHint: string;
}

/**
 * The canonical option list, in the order they appear top-to-bottom on the
 * overlay (and the order the UP / DOWN cursor cycles through). Ordering is
 * deliberate:
 *
 *   • `resume` is first so the default cursor lands on the safe no-op —
 *     a confirm tap right after pausing resumes rather than ejecting.
 *   • `restart` follows as the next-most-common "I want to play again,
 *     same setup" action.
 *   • `characterSelect` → `mainMenu` step progressively further from the
 *     current match, so the more destructive the action, the more
 *     deliberate the navigation to reach it.
 *   • `controls` sits last as a utility detour that doesn't abandon the
 *     match outright.
 *
 * Each option (and the array itself) is `Object.freeze`d so a careless
 * consumer can't mutate the shared contract at runtime.
 */
export const PAUSE_MENU_OPTIONS: ReadonlyArray<PauseMenuOption> = Object.freeze([
  Object.freeze({
    id: 'resume' as const,
    label: 'Resume',
    action: 'resume' as const,
    targetScene: null,
    shortcutHint: '[ESC] / Ⓑ',
  }),
  Object.freeze({
    id: 'restart' as const,
    label: 'Restart Match',
    action: 'restart' as const,
    targetScene: 'MatchScene',
    shortcutHint: '[R]',
  }),
  Object.freeze({
    id: 'characterSelect' as const,
    label: 'Character Select',
    action: 'characterSelect' as const,
    targetScene: 'CharacterSelectScene',
    shortcutHint: '[C]',
  }),
  Object.freeze({
    id: 'mainMenu' as const,
    label: 'Main Menu',
    action: 'mainMenu' as const,
    targetScene: 'MainMenuScene',
    shortcutHint: '[M]',
  }),
  Object.freeze({
    id: 'controls' as const,
    label: 'Controls',
    action: 'controls' as const,
    targetScene: 'RebindingScene',
    shortcutHint: '[K]',
  }),
]);

// ---------------------------------------------------------------------------
// Cursor state model
// ---------------------------------------------------------------------------

/**
 * The pause overlay's full state — just the highlighted-row cursor. Pure
 * data: every transition produces a brand-new `PauseMenuState` so the
 * scene can compare snapshots with `===` and early-out on no-ops, the same
 * pattern as `ModeSelectState`.
 *
 *   • `selectedIndex` — index into `PAUSE_MENU_OPTIONS`. Always valid
 *     (0 ≤ n < PAUSE_MENU_OPTIONS.length) so consumers never re-validate.
 */
export interface PauseMenuState {
  readonly selectedIndex: number;
}

/**
 * Initial state the overlay opens on every time the player pauses. Points
 * at index 0 — `resume`, the safe no-op — so an immediate confirm tap
 * resumes the match rather than ejecting the player to another scene.
 *
 * Frozen so a careless `DEFAULT_PAUSE_MENU_STATE.selectedIndex = 3` throws
 * in strict mode rather than silently corrupting every future pause.
 */
export const DEFAULT_PAUSE_MENU_STATE: PauseMenuState = Object.freeze({
  selectedIndex: 0,
});

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/**
 * Move the highlighted-row cursor. `direction` is +1 (DOWN) or -1 (UP);
 * any non-zero finite number works (it's normalised modulo the option
 * count) but the overlay only ever passes ±1.
 *
 * Wraps both ways: pressing DOWN on the last option jumps to the first,
 * pressing UP on the first wraps to the last — so an overshoot is always
 * one tap from recovery.
 *
 * Returns the SAME state reference on a no-op (direction 0 / non-finite, or
 * a single-option list where every move lands back on the same row) so the
 * scene can early-out exactly like `ModeSelectScene.handleModeCycle` does
 * and skip a redundant redraw.
 */
export function moveSelection(
  state: PauseMenuState,
  direction: number,
): PauseMenuState {
  const next = wrapIndex(
    state.selectedIndex,
    direction,
    PAUSE_MENU_OPTIONS.length,
  );
  if (next === state.selectedIndex) return state;
  return Object.freeze({ selectedIndex: next });
}

/**
 * Set the cursor to an explicit index, clamped into range. Useful when a
 * pointer hover or a direct-jump hotkey wants to move the highlight to a
 * specific row rather than stepping it.
 *
 * Returns the SAME state reference when the clamped target equals the
 * current index, so pointer-move spam over one row doesn't churn
 * equal-but-new state objects.
 */
export function setSelection(
  state: PauseMenuState,
  index: number,
): PauseMenuState {
  const next = clampIndex(index, PAUSE_MENU_OPTIONS.length);
  if (next === state.selectedIndex) return state;
  return Object.freeze({ selectedIndex: next });
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the option the cursor currently sits on. Total over every valid
 * state — the index invariant (always in range) guarantees a hit, and the
 * `?? PAUSE_MENU_OPTIONS[0]` fallback only exists to satisfy
 * `noUncheckedIndexedAccess` and would only fire if the table were ever
 * accidentally emptied (it never is — static config).
 */
export function getSelectedOption(state: PauseMenuState): PauseMenuOption {
  const idx = clampIndex(state.selectedIndex, PAUSE_MENU_OPTIONS.length);
  // `PAUSE_MENU_OPTIONS` is a non-empty static config, so index 0 — and
  // any clamped index — always resolves. The fallback satisfies the
  // checker's `T | undefined` widening only.
  return PAUSE_MENU_OPTIONS[idx] ?? (PAUSE_MENU_OPTIONS[0] as PauseMenuOption);
}

/**
 * Resolve an option by the action it performs. Used by keyboard hotkeys
 * that jump straight to an action (e.g. pressing `R` to restart) without
 * first moving the cursor. Total over the `PauseAction` union — every
 * action has exactly one option, so this never returns `undefined`.
 */
export function getOptionByAction(action: PauseAction): PauseMenuOption {
  // Every member of the union appears exactly once in the static list, so
  // the `.find` always hits; the `as` fallback is unreachable in practice
  // and exists only because `.find` is typed `T | undefined`.
  return (
    PAUSE_MENU_OPTIONS.find((o) => o.action === action) ??
    (PAUSE_MENU_OPTIONS[0] as PauseMenuOption)
  );
}

/**
 * Data-driven classifier so the overlay scene's dispatch stays a lookup
 * rather than a hard-coded `switch` the scene owns: `true` exactly when the
 * action is the safe in-place `resume` (close overlay, unfreeze sim, no
 * scene transition). Every other action drives a `scene.start` against the
 * option's `targetScene`.
 */
export function isResume(action: PauseAction): boolean {
  return action === 'resume';
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Wrap-around index helper. Returns the clamped `current` if `direction`
 * is 0 or non-finite (defensive guard against an unmapped key event firing
 * with a stray value); otherwise advances by `direction` modulo `length`,
 * normalising negatives so `-1` past `0` lands on `length - 1`.
 *
 * Lifted from `modeSelect`'s identical helper so the pause cursor wraps
 * with exactly the same semantics as the mode-select ladders.
 */
function wrapIndex(current: number, direction: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(direction) || direction === 0) {
    return clampIndex(current, length);
  }
  const safe = clampIndex(current, length);
  // The `+ length` term protects against negative `direction` values
  // (JavaScript `%` keeps the dividend's sign for negatives).
  const step = Math.trunc(direction);
  return (((safe + step) % length) + length) % length;
}

function clampIndex(idx: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(idx)) return 0;
  const i = Math.trunc(idx);
  if (i < 0) return 0;
  if (i >= length) return length - 1;
  return i;
}
