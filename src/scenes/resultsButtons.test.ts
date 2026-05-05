import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RESULTS_BUTTON_SIZE,
  RESULTS_BUTTONS,
  RESULTS_BUTTON_GAP,
  RESULTS_BUTTON_ROW_Y_FRACTION,
  getResultsButtonSpec,
  layoutResultsButtons,
} from './resultsButtons';

/**
 * AC 18 — "Rematch button and return-to-lobby button on results
 * screen." (Renumbered from AC 17 after M1.5 was inserted as AC 2.)
 *
 * The seed lists both buttons as a flat v1 acceptance criterion. The
 * Phaser-free helper `resultsButtons.ts` owns the labels, hotkeys,
 * target scenes, and layout maths that the renderer leans on. These
 * tests pin the contract:
 *
 *   1. The two buttons exist, in the canonical left-to-right order.
 *   2. Their target scenes are correct (rematch → MatchScene,
 *      back-to-lobby → CharacterSelectScene — the M2 lobby surface
 *      where Press Start to Join lives).
 *   3. Each button has a visible label, a hotkey suffix, and a
 *      shortcut hint.
 *   4. The layout maths centre the row and respect the configured gap
 *      so a future canvas-size tweak can't silently push the buttons
 *      off-screen.
 *
 * Tests are pure-function — no Phaser, no jsdom — so a regression in
 * the contract surfaces immediately under plain Node.
 */
describe('resultsButtons — AC 18 (rematch + return-to-lobby)', () => {
  describe('canonical button list', () => {
    it('exposes exactly two buttons in left-to-right order', () => {
      expect(RESULTS_BUTTONS.length).toBe(2);
      expect(RESULTS_BUTTONS[0]?.id).toBe('rematch');
      expect(RESULTS_BUTTONS[1]?.id).toBe('backToLobby');
    });

    it('rematch button restarts MatchScene with the [ENTER] hotkey', () => {
      const spec = getResultsButtonSpec('rematch');
      expect(spec).not.toBeNull();
      expect(spec?.label).toBe('REMATCH');
      expect(spec?.shortcutKey).toBe('ENTER');
      expect(spec?.shortcutHint).toBe('[ENTER]');
      expect(spec?.targetScene).toBe('MatchScene');
    });

    it('back-to-lobby button starts CharacterSelectScene with the [L] hotkey', () => {
      // The seed's "lobby" is the Press-Start-to-Join surface — that
      // scene is `CharacterSelectScene` in this codebase. This test
      // pins the mapping so a future scene rename can't silently send
      // the player to the wrong place.
      const spec = getResultsButtonSpec('backToLobby');
      expect(spec).not.toBeNull();
      expect(spec?.label).toBe('BACK TO LOBBY');
      expect(spec?.shortcutKey).toBe('L');
      expect(spec?.shortcutHint).toBe('[L]');
      expect(spec?.targetScene).toBe('CharacterSelectScene');
    });

    it('returns null for an unknown button id', () => {
      expect(getResultsButtonSpec('whatever' as 'rematch')).toBeNull();
    });

    it('every button has a non-empty visible label and hint', () => {
      for (const spec of RESULTS_BUTTONS) {
        expect(spec.label.length).toBeGreaterThan(0);
        expect(spec.shortcutHint.length).toBeGreaterThan(0);
        expect(spec.shortcutKey.length).toBeGreaterThan(0);
        expect(spec.targetScene.length).toBeGreaterThan(0);
      }
    });

    it('button hotkeys are distinct (no double-fire on a single keypress)', () => {
      const keys = RESULTS_BUTTONS.map((b) => b.shortcutKey);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  describe('layoutResultsButtons', () => {
    it('centres the row horizontally on the canvas', () => {
      const placements = layoutResultsButtons(1280, 720);
      // Sum of width + gap on either side of the centre line should be
      // symmetric — the midpoint between the two button centres is the
      // canvas mid-X.
      const midpoint = (placements[0]!.cx + placements[1]!.cx) / 2;
      expect(midpoint).toBeCloseTo(640, 5);
    });

    it('places the row at RESULTS_BUTTON_ROW_Y_FRACTION of the canvas height', () => {
      const placements = layoutResultsButtons(1280, 720);
      for (const p of placements) {
        expect(p.cy).toBeCloseTo(720 * RESULTS_BUTTON_ROW_Y_FRACTION, 5);
      }
    });

    it('spaces buttons by RESULTS_BUTTON_GAP px (centre-to-centre = width + gap)', () => {
      const placements = layoutResultsButtons(1280, 720);
      const gap = placements[1]!.cx - placements[0]!.cx;
      expect(gap).toBeCloseTo(
        DEFAULT_RESULTS_BUTTON_SIZE.width + RESULTS_BUTTON_GAP,
        5,
      );
    });

    it('respects the supplied size override', () => {
      const placements = layoutResultsButtons(1280, 720, {
        width: 200,
        height: 50,
      });
      for (const p of placements) {
        expect(p.width).toBe(200);
        expect(p.height).toBe(50);
      }
      const gap = placements[1]!.cx - placements[0]!.cx;
      expect(gap).toBeCloseTo(200 + RESULTS_BUTTON_GAP, 5);
    });

    it('attaches the canonical specs to the placements in order', () => {
      const placements = layoutResultsButtons(1280, 720);
      expect(placements[0]!.spec.id).toBe('rematch');
      expect(placements[1]!.spec.id).toBe('backToLobby');
    });

    it('clamps non-finite / negative canvas dimensions to zero', () => {
      // Defensive — a freshly-resized canvas mid-transition can hand us
      // 0 / NaN. The layout must not produce NaN coordinates.
      const placements = layoutResultsButtons(NaN, -10);
      for (const p of placements) {
        expect(Number.isFinite(p.cx)).toBe(true);
        expect(Number.isFinite(p.cy)).toBe(true);
      }
    });
  });
});
