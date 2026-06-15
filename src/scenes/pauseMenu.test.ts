import { describe, it, expect } from 'vitest';
import {
  PAUSE_MENU_OPTIONS,
  DEFAULT_PAUSE_MENU_STATE,
  moveSelection,
  setSelection,
  getSelectedOption,
  getOptionByAction,
  isResume,
  type PauseAction,
  type PauseMenuOption,
  type PauseMenuState,
} from './pauseMenu';

/**
 * Pure-logic contract for the in-match Pause overlay.
 *
 * The overlay is a thin Phaser scene that forwards every key press / pad
 * nav to one of these helpers and rebuilds its highlighted row from the
 * returned state; `MatchScene` imports the same `PAUSE_MENU_OPTIONS` /
 * `PauseAction` to wire its freeze-resume dispatch. So if the contract
 * here holds — every action is reachable by wrap-around nav, the default
 * cursor lands on the safe no-op, exactly one option transitions to no
 * scene, and the resolution helpers are total over the union — the pause
 * system's flow layer holds, independent of any Phaser rendering.
 *
 * Determinism note: nothing here reads the clock or RNG; the pause menu is
 * presentation / flow only and never touches the deterministic sim.
 */
describe('pauseMenu (in-match pause overlay logic)', () => {
  // The four real registered scene keys a non-resume option may target.
  const REAL_SCENE_KEYS = Object.freeze([
    'MatchScene',
    'CharacterSelectScene',
    'MainMenuScene',
    'RebindingScene',
  ]) as ReadonlyArray<string>;

  const ALL_ACTIONS = Object.freeze([
    'resume',
    'restart',
    'characterSelect',
    'mainMenu',
    'controls',
  ]) as ReadonlyArray<PauseAction>;

  const LAST_INDEX = PAUSE_MENU_OPTIONS.length - 1;

  // -------------------------------------------------------------------------
  // PAUSE_MENU_OPTIONS — the single source of truth
  // -------------------------------------------------------------------------

  describe('PAUSE_MENU_OPTIONS', () => {
    it('lists exactly the five v1 pause actions', () => {
      // Guard against a silent option addition that would change the
      // wrap-around math without updating the rest of the suite.
      expect(PAUSE_MENU_OPTIONS.length).toBe(5);
    });

    it('exposes every PauseAction exactly once', () => {
      const actions = PAUSE_MENU_OPTIONS.map((o) => o.action);
      // Bijection between the union and the list: no missing arm, no dupe
      // (a dupe would make `getOptionByAction` ambiguous).
      expect([...actions].sort()).toEqual([...ALL_ACTIONS].sort());
      expect(new Set(actions).size).toBe(PAUSE_MENU_OPTIONS.length);
    });

    it('uses each option id as its own action (stable list key)', () => {
      // `id` doubles as the React-free list key and must equal `action`
      // so hotkey wiring can look an option up by the action it jumps to.
      for (const o of PAUSE_MENU_OPTIONS) {
        expect(o.id).toBe(o.action);
      }
    });

    it('opens with resume first so the default cursor is the safe no-op', () => {
      // A confirm tap right after pausing must resume, never eject.
      expect(PAUSE_MENU_OPTIONS[0]?.action).toBe('resume');
    });

    it('has exactly one targetScene === null, and it is resume', () => {
      const nullTargets = PAUSE_MENU_OPTIONS.filter((o) => o.targetScene === null);
      expect(nullTargets.length).toBe(1);
      expect(nullTargets[0]?.action).toBe('resume');
    });

    it('routes every non-resume option to a real registered scene key', () => {
      // Each destructive / detour action must land on a scene the game
      // actually registers — a typo here would dead-end the overlay.
      for (const o of PAUSE_MENU_OPTIONS) {
        if (o.action === 'resume') continue;
        expect(o.targetScene).not.toBeNull();
        expect(REAL_SCENE_KEYS).toContain(o.targetScene as string);
      }
    });

    it('matches the agreed label / action / target / hint contract', () => {
      // Lock the exact rows so the scene renderer and MatchScene wiring
      // can align against literal values without drift.
      expect(PAUSE_MENU_OPTIONS).toEqual([
        { id: 'resume', label: 'Resume', action: 'resume', targetScene: null, shortcutHint: '[ESC] / Ⓑ' },
        { id: 'restart', label: 'Restart Match', action: 'restart', targetScene: 'MatchScene', shortcutHint: '[R]' },
        { id: 'characterSelect', label: 'Character Select', action: 'characterSelect', targetScene: 'CharacterSelectScene', shortcutHint: '[C]' },
        { id: 'mainMenu', label: 'Main Menu', action: 'mainMenu', targetScene: 'MainMenuScene', shortcutHint: '[M]' },
        { id: 'controls', label: 'Controls', action: 'controls', targetScene: 'RebindingScene', shortcutHint: '[K]' },
      ]);
    });

    it('gives every option a non-empty label and shortcut hint', () => {
      for (const o of PAUSE_MENU_OPTIONS) {
        expect(o.label.length).toBeGreaterThan(0);
        expect(o.shortcutHint.length).toBeGreaterThan(0);
      }
    });

    it('is frozen, and every option object is frozen', () => {
      // A careless `PAUSE_MENU_OPTIONS[0].label = '...'` must throw in
      // strict mode rather than silently restyle the shared contract.
      expect(Object.isFrozen(PAUSE_MENU_OPTIONS)).toBe(true);
      for (const o of PAUSE_MENU_OPTIONS) {
        expect(Object.isFrozen(o)).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // DEFAULT_PAUSE_MENU_STATE
  // -------------------------------------------------------------------------

  describe('DEFAULT_PAUSE_MENU_STATE', () => {
    it('starts the cursor on index 0 (resume)', () => {
      expect(DEFAULT_PAUSE_MENU_STATE.selectedIndex).toBe(0);
      expect(getSelectedOption(DEFAULT_PAUSE_MENU_STATE).action).toBe('resume');
    });

    it('is frozen so callers cannot mutate the shared default', () => {
      expect(Object.isFrozen(DEFAULT_PAUSE_MENU_STATE)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // moveSelection — wrap-around cursor nav
  // -------------------------------------------------------------------------

  describe('moveSelection', () => {
    it('moves DOWN one row', () => {
      const next = moveSelection(DEFAULT_PAUSE_MENU_STATE, +1);
      expect(next.selectedIndex).toBe(1);
    });

    it('moves UP one row', () => {
      const mid: PauseMenuState = { selectedIndex: 2 };
      const next = moveSelection(mid, -1);
      expect(next.selectedIndex).toBe(1);
    });

    it('wraps DOWN past the last option back to the first', () => {
      const last: PauseMenuState = { selectedIndex: LAST_INDEX };
      expect(moveSelection(last, +1).selectedIndex).toBe(0);
    });

    it('wraps UP past the first option back to the last', () => {
      expect(moveSelection(DEFAULT_PAUSE_MENU_STATE, -1).selectedIndex).toBe(LAST_INDEX);
    });

    it('makes every PauseAction reachable by stepping DOWN from default', () => {
      // The core nav guarantee: a player can reach any action with the
      // DOWN key alone, wrapping as needed.
      const seen = new Set<PauseAction>();
      let state = DEFAULT_PAUSE_MENU_STATE;
      for (let i = 0; i < PAUSE_MENU_OPTIONS.length; i++) {
        seen.add(getSelectedOption(state).action);
        state = moveSelection(state, +1);
      }
      expect(seen).toEqual(new Set(ALL_ACTIONS));
      // A full lap returns to the start.
      expect(state.selectedIndex).toBe(0);
    });

    it('makes every PauseAction reachable by stepping UP from default', () => {
      const seen = new Set<PauseAction>();
      let state = DEFAULT_PAUSE_MENU_STATE;
      for (let i = 0; i < PAUSE_MENU_OPTIONS.length; i++) {
        seen.add(getSelectedOption(state).action);
        state = moveSelection(state, -1);
      }
      expect(seen).toEqual(new Set(ALL_ACTIONS));
      expect(state.selectedIndex).toBe(0);
    });

    it('returns the SAME reference on a zero-direction no-op', () => {
      // Defensive: an unmapped keypress with a stray direction must not
      // churn equal-but-new state and force a redundant redraw.
      const same = moveSelection(DEFAULT_PAUSE_MENU_STATE, 0);
      expect(same).toBe(DEFAULT_PAUSE_MENU_STATE);
    });

    it('returns the SAME reference on a non-finite direction', () => {
      expect(moveSelection(DEFAULT_PAUSE_MENU_STATE, Number.NaN)).toBe(
        DEFAULT_PAUSE_MENU_STATE,
      );
      expect(moveSelection(DEFAULT_PAUSE_MENU_STATE, Number.POSITIVE_INFINITY)).toBe(
        DEFAULT_PAUSE_MENU_STATE,
      );
    });

    it('returns a NEW frozen state on a real move', () => {
      const next = moveSelection(DEFAULT_PAUSE_MENU_STATE, +1);
      expect(next).not.toBe(DEFAULT_PAUSE_MENU_STATE);
      expect(Object.isFrozen(next)).toBe(true);
    });

    it('treats multi-step directions modulo the option count', () => {
      // ±N still lands in range and wraps; the overlay only sends ±1 but
      // the helper must not NaN on a larger value.
      const wrapped = moveSelection(DEFAULT_PAUSE_MENU_STATE, PAUSE_MENU_OPTIONS.length + 1);
      expect(wrapped.selectedIndex).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // setSelection — direct cursor placement
  // -------------------------------------------------------------------------

  describe('setSelection', () => {
    it('jumps the cursor to an explicit in-range index', () => {
      const next = setSelection(DEFAULT_PAUSE_MENU_STATE, 3);
      expect(next.selectedIndex).toBe(3);
      expect(Object.isFrozen(next)).toBe(true);
    });

    it('clamps an above-range index to the last option', () => {
      const next = setSelection(DEFAULT_PAUSE_MENU_STATE, 999);
      expect(next.selectedIndex).toBe(LAST_INDEX);
    });

    it('clamps a below-range / non-finite index to the first option', () => {
      expect(setSelection({ selectedIndex: 3 }, -5).selectedIndex).toBe(0);
      expect(setSelection({ selectedIndex: 3 }, Number.NaN).selectedIndex).toBe(0);
    });

    it('returns the SAME reference when the clamped target is unchanged', () => {
      // Pointer-move spam over one row must not churn state objects.
      const same = setSelection(DEFAULT_PAUSE_MENU_STATE, 0);
      expect(same).toBe(DEFAULT_PAUSE_MENU_STATE);
    });
  });

  // -------------------------------------------------------------------------
  // getSelectedOption — total over valid state
  // -------------------------------------------------------------------------

  describe('getSelectedOption', () => {
    it('returns the option under the cursor for every in-range index', () => {
      for (let i = 0; i < PAUSE_MENU_OPTIONS.length; i++) {
        const opt = getSelectedOption({ selectedIndex: i });
        expect(opt).toBe(PAUSE_MENU_OPTIONS[i]);
      }
    });

    it('clamps an out-of-range index rather than returning undefined', () => {
      // Defensive: a corrupted state must still resolve a real option so
      // the scene never dereferences `undefined`.
      expect(getSelectedOption({ selectedIndex: -1 })).toBe(PAUSE_MENU_OPTIONS[0]);
      expect(getSelectedOption({ selectedIndex: 999 })).toBe(
        PAUSE_MENU_OPTIONS[LAST_INDEX],
      );
    });
  });

  // -------------------------------------------------------------------------
  // getOptionByAction — total over the union
  // -------------------------------------------------------------------------

  describe('getOptionByAction', () => {
    it('returns the matching option for every action in the union', () => {
      for (const action of ALL_ACTIONS) {
        const opt: PauseMenuOption = getOptionByAction(action);
        expect(opt).toBeDefined();
        expect(opt.action).toBe(action);
      }
    });

    it('round-trips action → option → action', () => {
      for (const action of ALL_ACTIONS) {
        expect(getOptionByAction(action).action).toBe(action);
      }
    });
  });

  // -------------------------------------------------------------------------
  // isResume — data-driven dispatch classifier
  // -------------------------------------------------------------------------

  describe('isResume', () => {
    it('is true only for the resume action', () => {
      expect(isResume('resume')).toBe(true);
      for (const action of ALL_ACTIONS) {
        if (action === 'resume') continue;
        expect(isResume(action)).toBe(false);
      }
    });

    it('agrees with the null-targetScene marker', () => {
      // The two ways the scene distinguishes "no transition" must never
      // disagree: an action is resume iff its option has no target scene.
      for (const o of PAUSE_MENU_OPTIONS) {
        expect(isResume(o.action)).toBe(o.targetScene === null);
      }
    });
  });
});
