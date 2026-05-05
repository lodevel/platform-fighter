import { describe, it, expect } from 'vitest';
import {
  MATCH_MODES,
  STOCK_OPTIONS,
  TIME_LIMIT_OPTIONS,
  DEFAULT_MODE_SELECT_STATE,
  buildMatchConfigFromState,
  cycleMode,
  cycleQuantity,
  formatModeLabel,
  formatQuantityLabel,
  formatStockLabel,
  formatTimeLimitLabel,
  getStockCount,
  getTimeLimitSeconds,
  type ModeSelectState,
} from './modeSelect';
import { DEFAULT_STOCK_COUNT } from '../match/StockTracker';
import type { PlayerSlot } from '../types';

/**
 * AC 11 — "Both Stock and Time modes selectable pre-match."
 *
 * The pre-match selection logic is decomposed into a Phaser-free helper
 * (`./modeSelect.ts`) so it can be unit-tested under plain Node. The
 * Phaser scene that hosts the screen forwards every key press to one of
 * these helpers and rebuilds its on-screen text from the returned
 * state. So if the contract here holds — every mode is reachable, the
 * resulting `MatchConfig` carries the right `mode` field, and the live
 * stock/time quantities round-trip — the AC holds.
 *
 * What the contract guarantees:
 *
 *   1. Both modes are reachable from the default state via `cycleMode`.
 *   2. `buildMatchConfigFromState` produces a `MatchConfig` whose
 *      `mode` matches the live selection and whose mode-specific
 *      fields (`stockCount`, optional `timeLimitSeconds`) are present
 *      iff the mode requires them.
 *   3. The screen's other inputs — RNG seed, stage ID, player slots —
 *      are passed through to the resulting config unchanged.
 */
describe('modeSelect (pre-match Stock / Time mode select helper) — AC 11', () => {
  // Shared test fixtures — a minimal P1+P2 lineup and a deterministic seed
  // so each test only varies the mode-select state.
  const P1: PlayerSlot = Object.freeze({
    index: 1,
    characterId: 'wolf',
    paletteIndex: 0,
    inputType: 'keyboard_p1',
  });
  const P2: PlayerSlot = Object.freeze({
    index: 2,
    characterId: 'cat',
    paletteIndex: 0,
    inputType: 'keyboard_p2',
  });
  const FIXTURE_PARAMS = Object.freeze({
    stageId: 'flat',
    players: Object.freeze([P1, P2]) as ReadonlyArray<PlayerSlot>,
    rngSeed: 0xdeadbeef,
  });

  // -------------------------------------------------------------------------
  // Mode ladder
  // -------------------------------------------------------------------------

  describe('MATCH_MODES ladder', () => {
    it('contains both modes the AC requires', () => {
      // Without these two the AC is unsatisfiable — the menu can't offer
      // both modes if the ladder doesn't list them.
      expect(MATCH_MODES).toContain('stocks');
      expect(MATCH_MODES).toContain('time');
    });

    it('lists exactly the two v1 modes (no stamina / coin / etc.)', () => {
      // Guard against silent mode additions that would change the
      // selection screen's wrap-around behaviour without updating tests.
      expect(MATCH_MODES.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Default state
  // -------------------------------------------------------------------------

  describe('DEFAULT_MODE_SELECT_STATE', () => {
    it('opens on stock mode (the canonical Smash baseline)', () => {
      // Players who hit START without touching anything should get the
      // most familiar match shape — 3 stocks, stock mode.
      expect(DEFAULT_MODE_SELECT_STATE.mode).toBe('stocks');
    });

    it('points at the engine-wide DEFAULT_STOCK_COUNT', () => {
      // The default index is computed from `DEFAULT_STOCK_COUNT` so the
      // menu's pre-selected value matches the gameplay subsystems'
      // baseline. This also guards against drift if the constant
      // changes later.
      expect(getStockCount(DEFAULT_MODE_SELECT_STATE)).toBe(DEFAULT_STOCK_COUNT);
    });

    it('points at the canonical 3-minute timer', () => {
      // 180 s = 3 min, the default Smash Bros. tournament timer.
      expect(getTimeLimitSeconds(DEFAULT_MODE_SELECT_STATE)).toBe(180);
    });

    it('is frozen so callers cannot mutate the shared default', () => {
      // The default is exported as a frozen object so a careless caller
      // doing `DEFAULT_MODE_SELECT_STATE.mode = 'time'` triggers a
      // TypeError in strict mode rather than silently corrupting every
      // future menu entry.
      expect(Object.isFrozen(DEFAULT_MODE_SELECT_STATE)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // cycleMode — both modes are reachable
  // -------------------------------------------------------------------------

  describe('cycleMode (both modes reachable from default)', () => {
    it('cycles RIGHT from stock to time', () => {
      // Pressing RIGHT once on the default state must switch to time mode —
      // this is the user-visible heart of the AC.
      const next = cycleMode(DEFAULT_MODE_SELECT_STATE, +1);
      expect(next.mode).toBe('time');
    });

    it('cycles RIGHT from time back to stock (wraps)', () => {
      const time: ModeSelectState = { ...DEFAULT_MODE_SELECT_STATE, mode: 'time' };
      const next = cycleMode(time, +1);
      expect(next.mode).toBe('stocks');
    });

    it('cycles LEFT from stock to time (wraps the other direction)', () => {
      // LEFT past the first entry must wrap to the last so a player who
      // overshoots can recover with another tap of the same key.
      const next = cycleMode(DEFAULT_MODE_SELECT_STATE, -1);
      expect(next.mode).toBe('time');
    });

    it('preserves stock count and time index when toggling modes', () => {
      // The screen behaves like Smash's Rules screen: dialling stocks
      // to 5 then toggling to time and back must restore the 5-stock
      // selection rather than reset to the default. Mirror Smash's
      // affordance so muscle memory transfers.
      const tweaked: ModeSelectState = {
        mode: 'stocks',
        stockIndex: STOCK_OPTIONS.indexOf(5),
        timeIndex: TIME_LIMIT_OPTIONS.indexOf(480),
      };
      const toTime = cycleMode(tweaked, +1);
      const back = cycleMode(toTime, +1);
      expect(back.stockIndex).toBe(tweaked.stockIndex);
      expect(back.timeIndex).toBe(tweaked.timeIndex);
    });

    it('returns the same state object on a no-op (direction 0)', () => {
      // Defensive guard — an unmapped keypress firing with a stray
      // direction shouldn't churn equal-but-new state objects.
      const same = cycleMode(DEFAULT_MODE_SELECT_STATE, 0);
      expect(same).toBe(DEFAULT_MODE_SELECT_STATE);
    });
  });

  // -------------------------------------------------------------------------
  // cycleQuantity — only the active mode's quantity changes
  // -------------------------------------------------------------------------

  describe('cycleQuantity (per-mode ladder)', () => {
    it('advances stocks in stock mode', () => {
      const next = cycleQuantity(DEFAULT_MODE_SELECT_STATE, +1);
      expect(next.mode).toBe('stocks');
      expect(getStockCount(next)).toBe(
        STOCK_OPTIONS[(STOCK_OPTIONS.indexOf(DEFAULT_STOCK_COUNT) + 1) % STOCK_OPTIONS.length],
      );
    });

    it('does not change the time index while in stock mode', () => {
      const next = cycleQuantity(DEFAULT_MODE_SELECT_STATE, +1);
      expect(next.timeIndex).toBe(DEFAULT_MODE_SELECT_STATE.timeIndex);
    });

    it('advances time in time mode and leaves stock index alone', () => {
      const time: ModeSelectState = { ...DEFAULT_MODE_SELECT_STATE, mode: 'time' };
      const next = cycleQuantity(time, +1);
      const expected =
        TIME_LIMIT_OPTIONS[(TIME_LIMIT_OPTIONS.indexOf(180) + 1) % TIME_LIMIT_OPTIONS.length];
      expect(getTimeLimitSeconds(next)).toBe(expected);
      expect(next.stockIndex).toBe(time.stockIndex);
    });

    it('wraps from the last stock entry back to the first on RIGHT', () => {
      const last: ModeSelectState = {
        mode: 'stocks',
        stockIndex: STOCK_OPTIONS.length - 1,
        timeIndex: 0,
      };
      const next = cycleQuantity(last, +1);
      expect(next.stockIndex).toBe(0);
    });

    it('wraps from the first time entry back to the last on LEFT', () => {
      const first: ModeSelectState = {
        mode: 'time',
        stockIndex: 0,
        timeIndex: 0,
      };
      const next = cycleQuantity(first, -1);
      expect(next.timeIndex).toBe(TIME_LIMIT_OPTIONS.length - 1);
    });
  });

  // -------------------------------------------------------------------------
  // buildMatchConfigFromState — the AC's payload
  // -------------------------------------------------------------------------

  describe('buildMatchConfigFromState', () => {
    it('emits a stock-mode MatchConfig for stocks state', () => {
      const cfg = buildMatchConfigFromState(DEFAULT_MODE_SELECT_STATE, FIXTURE_PARAMS);
      expect(cfg.mode).toBe('stocks');
      expect(cfg.stockCount).toBe(DEFAULT_STOCK_COUNT);
      // No time limit on a pure stock match — keeps the replay JSON
      // minimal and prevents a stale `timeLimitSeconds` from confusing
      // a future time-mode end detector.
      expect(cfg.timeLimitSeconds).toBeUndefined();
    });

    it('emits a time-mode MatchConfig (with timeLimitSeconds) for time state', () => {
      const time: ModeSelectState = { ...DEFAULT_MODE_SELECT_STATE, mode: 'time' };
      const cfg = buildMatchConfigFromState(time, FIXTURE_PARAMS);
      expect(cfg.mode).toBe('time');
      expect(cfg.timeLimitSeconds).toBe(180);
      // Even time-mode configs carry stockCount because the shape
      // requires it (and the time-mode tiebreaker uses "most stocks
      // remaining" to pick a winner).
      expect(cfg.stockCount).toBeGreaterThan(0);
    });

    it('passes through stage / players / rngSeed unchanged', () => {
      const cfg = buildMatchConfigFromState(DEFAULT_MODE_SELECT_STATE, FIXTURE_PARAMS);
      expect(cfg.stageId).toBe(FIXTURE_PARAMS.stageId);
      expect(cfg.players).toBe(FIXTURE_PARAMS.players);
      expect(cfg.rngSeed).toBe(FIXTURE_PARAMS.rngSeed);
    });

    it('produces a frozen config (immutable post-build)', () => {
      // The screen hands the config straight to `MatchScene.create` and
      // the recording controller; freezing prevents a downstream
      // mutator from changing the live header without re-emitting it.
      const cfg = buildMatchConfigFromState(DEFAULT_MODE_SELECT_STATE, FIXTURE_PARAMS);
      expect(Object.isFrozen(cfg)).toBe(true);
    });

    it('round-trips a time-mode selection: cycle → build → mode == time', () => {
      // Integration-style: simulate "player presses RIGHT once on mode,
      // then confirms" and assert the resulting config is a time match.
      const afterCycle = cycleMode(DEFAULT_MODE_SELECT_STATE, +1);
      const cfg = buildMatchConfigFromState(afterCycle, FIXTURE_PARAMS);
      expect(cfg.mode).toBe('time');
    });

    it('round-trips a stock-mode selection: cycle twice → build → mode == stocks', () => {
      // Same story for the wrap path: two RIGHT taps on a 2-mode ladder
      // returns to stock mode and the synthesised config follows.
      const afterCycle = cycleMode(cycleMode(DEFAULT_MODE_SELECT_STATE, +1), +1);
      const cfg = buildMatchConfigFromState(afterCycle, FIXTURE_PARAMS);
      expect(cfg.mode).toBe('stocks');
    });
  });

  // -------------------------------------------------------------------------
  // Display formatters
  // -------------------------------------------------------------------------

  describe('formatModeLabel', () => {
    it('uppercases stock mode as "STOCK"', () => {
      expect(formatModeLabel('stocks')).toBe('STOCK');
    });

    it('uppercases time mode as "TIME"', () => {
      expect(formatModeLabel('time')).toBe('TIME');
    });
  });

  describe('formatStockLabel', () => {
    it('singularises 1 stock', () => {
      // "1 stocks" reads wrong; "1 stock" reads right.
      expect(formatStockLabel(1)).toBe('1 stock');
    });

    it('pluralises N>1 stocks', () => {
      expect(formatStockLabel(3)).toBe('3 stocks');
      expect(formatStockLabel(5)).toBe('5 stocks');
    });
  });

  describe('formatTimeLimitLabel', () => {
    it('renders 180 s as "3:00"', () => {
      // M:SS shape with zero-padded seconds — same as the in-match
      // countdown HUD that lands alongside time-mode end detection.
      expect(formatTimeLimitLabel(180)).toBe('3:00');
    });

    it('renders 60 s as "1:00"', () => {
      expect(formatTimeLimitLabel(60)).toBe('1:00');
    });

    it('renders 90 s as "1:30"', () => {
      // Spot-check the seconds component is zero-padded (would be "1:3"
      // with naive concat).
      expect(formatTimeLimitLabel(90)).toBe('1:30');
    });

    it('clamps non-finite / non-positive to "0:00"', () => {
      // A malformed `MatchConfig` should still render cleanly in dev
      // mode rather than throwing.
      expect(formatTimeLimitLabel(0)).toBe('0:00');
      expect(formatTimeLimitLabel(-30)).toBe('0:00');
      expect(formatTimeLimitLabel(Number.NaN)).toBe('0:00');
      expect(formatTimeLimitLabel(Number.POSITIVE_INFINITY)).toBe('0:00');
    });
  });

  describe('formatQuantityLabel', () => {
    it('renders stock quantity in stock mode', () => {
      expect(formatQuantityLabel(DEFAULT_MODE_SELECT_STATE)).toBe('3 stocks');
    });

    it('renders time-limit clock in time mode', () => {
      const time: ModeSelectState = { ...DEFAULT_MODE_SELECT_STATE, mode: 'time' };
      expect(formatQuantityLabel(time)).toBe('3:00');
    });
  });
});
