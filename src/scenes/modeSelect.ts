/**
 * Phaser-free helpers for the pre-match Mode Select screen.
 *
 * AC 11 — "Both Stock and Time modes selectable pre-match."
 *
 * The Seed's ontology splits a match into a `MatchConfig` whose `mode`
 * field is either `'stocks'` or `'time'`. Stock mode KOs everyone but
 * the survivor; time mode KOs whoever has the fewest stocks (lost) when
 * the timer runs out. Both modes share the same blast-zone / damage /
 * respawn pipeline — only the *match-end condition* differs — so the
 * pre-match selection screen only needs to:
 *
 *   1. Let the player toggle which mode the match runs in.
 *   2. Let the player pick a per-mode quantity (stock count or time
 *      limit) so the final `MatchConfig` is fully specified.
 *   3. Hand back a `MatchConfig` (or the fields needed to build one)
 *      to the caller that started the menu — typically `MainMenuScene`,
 *      which then `scene.start('MatchScene', { matchConfig })`.
 *
 * Why Phaser-free
 * ---------------
 *
 * Per the project's `code_architecture` evaluation principle, the
 * selection logic — "what mode is selected", "what is the next stock
 * count when the player presses RIGHT", "is this a time-mode config" —
 * is pure state mutation. Splitting it out of the scene class lets us:
 *
 *   • Unit-test every transition under plain Node (Phaser pulls in
 *     browser globals at module-eval time and can't be loaded by a
 *     vitest worker).
 *   • Reuse the helper from a future stage-builder preview screen, the
 *     CLI replay tooling, or a smoke-test harness without dragging
 *     Phaser scenes into those code paths.
 *   • Keep the Phaser scene file thin — lifecycle wiring + draw calls
 *     only, in line with how `RebindingScene` / `ResultsScene` are
 *     already organised.
 *
 * Design constraints
 * ------------------
 *
 *   • All transitions are *deterministic* pure functions — no
 *     `Math.random()`, no wall-clock reads, no Phaser globals. Replays
 *     and integration tests can exercise them without booting a game.
 *
 *   • `STOCK_OPTIONS` and `TIME_LIMIT_OPTIONS` are exposed as readonly
 *     ladders so the same array drives both the cycling logic and the
 *     "← 3 →" arrow UI in the scene without duplicating values.
 *
 *   • Cycling wraps both ways (LEFT past the start jumps to the end,
 *     RIGHT past the end wraps to the start) so a player who overshoots
 *     can always recover with another tap.
 */

import type { MatchConfig, MatchMode, PlayerSlot } from '../types';
import { DEFAULT_STOCK_COUNT } from '../match/StockTracker';

// ---------------------------------------------------------------------------
// Public option ladders
// ---------------------------------------------------------------------------

/**
 * Ordered list of selectable match modes. The first entry is the
 * default mode the menu opens on. Order is also the order the LEFT /
 * RIGHT cursor keys cycle through.
 *
 * Stock and time mode are the two modes the project Seed ships with.
 * Adding a future mode (e.g. "stamina") is a one-line ladder edit
 * here — every consumer that imports `MATCH_MODES` picks it up.
 */
export const MATCH_MODES: ReadonlyArray<MatchMode> = ['stocks', 'time'];

/**
 * Stock counts the player can dial through in stock mode.
 *
 * 1 / 2 / 3 / 4 / 5 covers every common Smash Bros. tournament rule
 * (1-stock blitz, 3-stock standard, 5-stock long-form) without
 * exposing absurd values that would balloon match length. The default
 * (the third entry, `3`) matches the Seed's "3 stocks each" baseline
 * and the gameplay subsystems' `DEFAULT_STOCK_COUNT`.
 */
export const STOCK_OPTIONS: ReadonlyArray<number> = [1, 2, 3, 4, 5];

/**
 * Time-limit options in *seconds*. Stored as seconds because
 * `MatchConfig.timeLimitSeconds` is in seconds — the menu UI converts
 * to "M:SS" for display, see `formatTimeLimitLabel`.
 *
 * 60 / 120 / 180 / 300 / 480 = 1 min / 2 min / 3 min / 5 min / 8 min,
 * which spans casual quick-play through tournament time-out matches.
 * The default (third entry, 180) is the Smash Bros. canonical 3-minute
 * timer.
 */
export const TIME_LIMIT_OPTIONS: ReadonlyArray<number> = [60, 120, 180, 300, 480];

/**
 * The default index into `STOCK_OPTIONS` — chosen so the initial value
 * matches the engine-wide `DEFAULT_STOCK_COUNT` constant. If the
 * stock-tracker default ever changes, this index resolves to the new
 * value automatically (no double-source-of-truth drift).
 */
const DEFAULT_STOCK_INDEX = (() => {
  const idx = STOCK_OPTIONS.indexOf(DEFAULT_STOCK_COUNT);
  return idx >= 0 ? idx : 2; // fall back to "3" if the constant ever drifts off the ladder
})();

/**
 * The default index into `TIME_LIMIT_OPTIONS`. Tracks the canonical
 * Smash Bros. 3-minute timer.
 */
const DEFAULT_TIME_INDEX = (() => {
  const idx = TIME_LIMIT_OPTIONS.indexOf(180);
  return idx >= 0 ? idx : 2;
})();

// ---------------------------------------------------------------------------
// Selection state model
// ---------------------------------------------------------------------------

/**
 * The pre-match Mode Select screen's full state. Pure data — every
 * transition produces a brand-new `ModeSelectState` so React-style
 * memoisation and replay tests can compare snapshots with `===`.
 *
 *   • `mode` — currently highlighted mode.
 *   • `stockIndex` — index into `STOCK_OPTIONS`. Always valid (0 ≤ n
 *     < STOCK_OPTIONS.length) so consumers don't have to re-validate.
 *   • `timeIndex` — index into `TIME_LIMIT_OPTIONS`. Same invariant.
 *
 * We keep both quantities live (rather than only the one matching the
 * active mode) so toggling stocks → time → stocks doesn't lose the
 * stock count the player already dialled in. This matches how Smash
 * Bros.' Rules screen behaves.
 */
export interface ModeSelectState {
  readonly mode: MatchMode;
  readonly stockIndex: number;
  readonly timeIndex: number;
}

/**
 * Initial state opened by `ModeSelectScene` on first entry. Defaults
 * to stock mode + 3 stocks + 3-minute timer so a player can hit
 * START without changing anything and get a canonical match.
 */
export const DEFAULT_MODE_SELECT_STATE: ModeSelectState = Object.freeze({
  // `MATCH_MODES` is a non-empty static config; the `?? 'stocks'`
  // fallback only exists to satisfy `noUncheckedIndexedAccess` and
  // would only trigger if the ladder were ever accidentally emptied.
  mode: MATCH_MODES[0] ?? 'stocks',
  stockIndex: DEFAULT_STOCK_INDEX,
  timeIndex: DEFAULT_TIME_INDEX,
});

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/**
 * Cycle the highlighted mode. `direction` is +1 (RIGHT) or -1 (LEFT);
 * any non-zero finite number works (it's normalised modulo the ladder
 * length) but the menu only ever passes ±1.
 *
 * Wraps both ways: pressing LEFT on the first mode jumps to the last,
 * pressing RIGHT on the last wraps to the first. Stock count / time
 * limit are preserved across the toggle.
 */
export function cycleMode(
  state: ModeSelectState,
  direction: number,
): ModeSelectState {
  const next = wrapIndex(MATCH_MODES.indexOf(state.mode), direction, MATCH_MODES.length);
  // `wrapIndex` always returns an in-range index for a non-empty
  // array, but `noUncheckedIndexedAccess` widens the read to `T |
  // undefined` — guard the lookup so the return type stays
  // `MatchMode` and falls back to the default mode if the table is
  // ever empty (defensive only; static config keeps it non-empty).
  const nextMode: MatchMode = MATCH_MODES[next] ?? state.mode;
  if (nextMode === state.mode) return state;
  return { ...state, mode: nextMode };
}

/**
 * Cycle the active mode's quantity ladder — stock count for
 * `mode === 'stocks'`, time limit for `mode === 'time'`. The other
 * mode's quantity is left untouched so a quick mode-toggle doesn't
 * scramble the unrelated value.
 */
export function cycleQuantity(
  state: ModeSelectState,
  direction: number,
): ModeSelectState {
  if (state.mode === 'stocks') {
    const next = wrapIndex(state.stockIndex, direction, STOCK_OPTIONS.length);
    if (next === state.stockIndex) return state;
    return { ...state, stockIndex: next };
  }
  // mode === 'time'
  const next = wrapIndex(state.timeIndex, direction, TIME_LIMIT_OPTIONS.length);
  if (next === state.timeIndex) return state;
  return { ...state, timeIndex: next };
}

/**
 * Convenience accessor — the live stock count for the current state.
 * Always one of `STOCK_OPTIONS`; never out of range.
 */
export function getStockCount(state: ModeSelectState): number {
  return STOCK_OPTIONS[clampIndex(state.stockIndex, STOCK_OPTIONS.length)] ?? DEFAULT_STOCK_COUNT;
}

/**
 * Convenience accessor — the live time limit (seconds) for the
 * current state. Always one of `TIME_LIMIT_OPTIONS`; never out of
 * range.
 */
export function getTimeLimitSeconds(state: ModeSelectState): number {
  // Default fallback mirrors the canonical 3-minute Smash timer used
  // for the menu's initial state, in case the config table is ever
  // empty (defensive only — static config keeps it non-empty).
  return TIME_LIMIT_OPTIONS[clampIndex(state.timeIndex, TIME_LIMIT_OPTIONS.length)] ?? 180;
}

// ---------------------------------------------------------------------------
// Display formatters
// ---------------------------------------------------------------------------

/**
 * Render a mode value as the player-facing label shown on the menu.
 * Uppercased so it pops against the lower-cased helper text in the
 * existing scene fonts.
 */
export function formatModeLabel(mode: MatchMode): string {
  return mode === 'stocks' ? 'STOCK' : 'TIME';
}

/**
 * Render a stock count as the menu's quantity label, e.g. `"3 stocks"`
 * (with the singular form `"1 stock"` when only one). Lower-cased so
 * the line reads naturally next to the uppercased mode label.
 */
export function formatStockLabel(count: number): string {
  return count === 1 ? '1 stock' : `${count} stocks`;
}

/**
 * Render a time limit (in seconds) as a `"M:SS"` clock string. We use
 * the standard timer shape so the menu reads identically to the in-
 * match countdown HUD that lands alongside time-mode end-detection.
 *
 * Negative or non-finite values clamp to `"0:00"` rather than
 * throwing, so a malformed `MatchConfig` still renders cleanly in dev
 * mode.
 */
export function formatTimeLimitLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Render the active quantity for a mode-select state — stocks or
 * time, depending on the live mode. Wraps the per-type formatters so
 * the scene only needs to call one function for the right-hand label.
 */
export function formatQuantityLabel(state: ModeSelectState): string {
  return state.mode === 'stocks'
    ? formatStockLabel(getStockCount(state))
    : formatTimeLimitLabel(getTimeLimitSeconds(state));
}

// ---------------------------------------------------------------------------
// MatchConfig synthesis
// ---------------------------------------------------------------------------

/**
 * Inputs needed to turn a `ModeSelectState` into a complete, frozen
 * `MatchConfig`. Everything that *isn't* mode-related comes from the
 * caller — typically the Mode Select scene, which already knows the
 * stage, player slots, and resolved RNG seed by the time the player
 * confirms.
 *
 * Kept as a structural interface (no class) so the headless replay
 * tooling can construct one from a JSON header without instantiating
 * any Phaser/scene state.
 */
export interface BuildMatchConfigParams {
  readonly stageId: string;
  readonly players: ReadonlyArray<PlayerSlot>;
  readonly rngSeed: number;
}

/**
 * Build the canonical `MatchConfig` from a Mode Select selection.
 *
 *   • Stock mode → `{ mode: 'stocks', stockCount, ... }` — no
 *     `timeLimitSeconds` so the post-match replay JSON stays minimal.
 *
 *   • Time mode  → `{ mode: 'time', stockCount, timeLimitSeconds, ... }`.
 *     We still emit `stockCount` (carrying the player's live ladder
 *     value) because the `MatchConfig` shape requires it and the
 *     time-mode tiebreaker uses "most stocks remaining" to decide a
 *     winner. Players who change their mind mid-match (toggle to time
 *     after dialling stocks to 5) get a 5-stock-floor time match —
 *     the same generous stock pool stock mode would have used.
 *
 * The returned object is `Object.freeze`d so callers can't mutate it
 * after the fact and silently change the live recording's header.
 */
export function buildMatchConfigFromState(
  state: ModeSelectState,
  params: BuildMatchConfigParams,
): MatchConfig {
  const stockCount = getStockCount(state);
  if (state.mode === 'time') {
    return Object.freeze({
      mode: 'time',
      stockCount,
      timeLimitSeconds: getTimeLimitSeconds(state),
      stageId: params.stageId,
      players: params.players,
      rngSeed: params.rngSeed,
    }) as MatchConfig;
  }
  return Object.freeze({
    mode: 'stocks',
    stockCount,
    stageId: params.stageId,
    players: params.players,
    rngSeed: params.rngSeed,
  }) as MatchConfig;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Wrap-around index helper. Returns `current` if `direction` is 0 or
 * non-finite (defensive guard against an unmapped key event firing
 * with a stray value); otherwise advances by `direction` modulo
 * `length`, normalising negatives so `-1` past `0` lands on
 * `length - 1`.
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
  return ((safe + step) % length + length) % length;
}

function clampIndex(idx: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(idx)) return 0;
  const i = Math.trunc(idx);
  if (i < 0) return 0;
  if (i >= length) return length - 1;
  return i;
}
