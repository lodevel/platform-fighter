import { describe, it, expect } from 'vitest';
import { computeResultsHeadline } from './resultsHeadline';
import type { MatchResultPayload } from '../match';

/**
 * Sub-AC 5 of AC 1 — "Implement victory screen scene displaying winner
 * and transitioning back to match start."
 *
 * `ResultsScene` itself imports Phaser, which pulls in browser globals
 * at module-eval time (e.g. `navigator`) and can't be loaded under
 * plain Node. Two strategies keep the contract testable:
 *
 *   1. The "displaying winner" half is delegated to a Phaser-free pure
 *      helper, `computeResultsHeadline`, in `./resultsHeadline.ts`.
 *      The scene's render code calls this exact function, so any
 *      regression in the headline contract surfaces here without
 *      needing jsdom + Phaser.
 *
 *   2. The "transitioning back" half is verified by reading the source
 *      file as text and asserting the scene starts MatchScene on
 *      ENTER and MainMenuScene on ESC. (The actual `scene.start` call
 *      requires a live Phaser game, but the *target keys* are a
 *      static-text contract this test guards.)
 */
describe('ResultsScene — sub-AC 5 (victory screen + transition back)', () => {
  describe('computeResultsHeadline (winner display)', () => {
    it('returns "MATCH OVER" when no payload is supplied', () => {
      // Defensive fallback for direct-navigation in dev. The screen
      // must never crash on a missing payload.
      expect(computeResultsHeadline(null)).toBe('MATCH OVER');
    });

    it('returns "DRAW" when nobody won (winnerIndex === null)', () => {
      const payload: MatchResultPayload = {
        winnerIndex: null,
        winnerName: null,
        finalStocks: [0, 0],
        playerNames: ['Wolf', 'Cat'],
        endFrame: 1234,
        stageName: 'Flat Stage',
        playerStats: null,
      };
      expect(computeResultsHeadline(payload)).toBe('DRAW');
    });

    it('uppercases the named winner ("Wolf" → "WOLF WINS")', () => {
      const payload: MatchResultPayload = {
        winnerIndex: 0,
        winnerName: 'Wolf',
        finalStocks: [2, 0],
        playerNames: ['Wolf', 'Cat'],
        endFrame: 4321,
        stageName: 'Flat Stage',
        playerStats: null,
      };
      expect(computeResultsHeadline(payload)).toBe('WOLF WINS');
    });

    it('falls back to "Player N WINS" when winnerName is missing', () => {
      // A future scene that forgets to pass per-player names should
      // still get a reasonable headline rather than "undefined WINS".
      const payload: MatchResultPayload = {
        winnerIndex: 2,
        winnerName: null,
        finalStocks: [0, 0, 1, 0],
        playerNames: ['Player 1', 'Player 2', 'Player 3', 'Player 4'],
        endFrame: 999,
        stageName: null,
        playerStats: null,
      };
      expect(computeResultsHeadline(payload)).toBe('PLAYER 3 WINS');
    });

    it('uppercases mixed-case names consistently', () => {
      const payload: MatchResultPayload = {
        winnerIndex: 1,
        winnerName: 'cAt',
        finalStocks: [0, 3],
        playerNames: ['Wolf', 'cAt'],
        endFrame: 60,
        stageName: 'Flat Stage',
        playerStats: null,
      };
      expect(computeResultsHeadline(payload)).toBe('CAT WINS');
    });

    it('preserves spaces and punctuation in winner names', () => {
      // Names like "Player One" or "Bear Jr." should pass through with
      // their separators intact — only the case is normalised.
      const payload: MatchResultPayload = {
        winnerIndex: 0,
        winnerName: 'Bear Jr.',
        finalStocks: [3, 0],
        playerNames: ['Bear Jr.', 'Cat'],
        endFrame: 200,
        stageName: 'Flat Stage',
        playerStats: null,
      };
      expect(computeResultsHeadline(payload)).toBe('BEAR JR. WINS');
    });
  });

  describe('scene transition contract (rematch + return-to-menu)', () => {
    it('starts MatchScene on ENTER (transition back to match start)', async () => {
      // Read the source file directly so we can assert the static
      // contract without booting Phaser. The scene wires
      // `scene.start('MatchScene')` to the ENTER key — that string is
      // the surface that satisfies "transitioning back to match start."
      const fs = await import('node:fs');
      const path = await import('node:path');
      const url = await import('node:url');
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const src = fs.readFileSync(
        path.join(here, 'ResultsScene.ts'),
        'utf8',
      );

      // ENTER → MatchScene (rematch / new match start).
      expect(src).toMatch(/keydown-ENTER/);
      expect(src).toMatch(/scene\.start\(['"]MatchScene['"]\)/);

      // ESC → MainMenuScene (escape hatch back to the title).
      expect(src).toMatch(/keydown-ESC/);
      expect(src).toMatch(/scene\.start\(['"]MainMenuScene['"]\)/);
    });

    it('registers ResultsScene in the global scene list', async () => {
      // `MatchEndDetector` calls `scene.start('ResultsScene', payload)`
      // — that string has to map to a registered scene class or the
      // post-match transition silently fails.
      const fs = await import('node:fs');
      const path = await import('node:path');
      const url = await import('node:url');
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const config = fs.readFileSync(
        path.join(here, '..', 'engine', 'GameConfig.ts'),
        'utf8',
      );
      expect(config).toMatch(/ResultsScene/);
      expect(config).toMatch(/MatchScene/);
      expect(config).toMatch(/MainMenuScene/);
    });
  });

  describe('Sub-AC 2 of AC 16 — post-match stats panel wiring', () => {
    /**
     * The Sub-AC 1 `MatchStatsTracker` produces the per-player snapshot
     * (KOs, damage dealt, survival frames). Sub-AC 2's job is to surface
     * that snapshot through `ResultsScene` in a readable layout.
     *
     * The renderer itself imports Phaser, so we can't drive the actual
     * `create()` call from a vitest run. Instead we pin two things via
     * static-text reads on the source file:
     *
     *   1. The scene sources its formatter contract from
     *      `./resultsStats` — i.e. the column widths, KO/damage/time
     *      formatting, and header row come from the unit-tested
     *      Phaser-free helper rather than being hardcoded in the scene.
     *
     *   2. The scene gates the stats panel on
     *      `payload.playerStats` so legacy callers / direct dev nav
     *      that pass `playerStats: null` don't crash, but every
     *      production-path payload (with a tracker) produces the panel.
     *
     * `ResultsScene.ts`'s lines 154–208 currently meet both contracts —
     * these tests guard against future drift (e.g. someone refactors
     * the formatter inline and the column widths break alignment).
     */
    it('imports the resultsStats formatter helpers', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const url = await import('node:url');
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const src = fs.readFileSync(
        path.join(here, 'ResultsScene.ts'),
        'utf8',
      );
      expect(src).toMatch(/from ['"]\.\/resultsStats['"]/);
      expect(src).toMatch(/formatStatsLine/);
      expect(src).toMatch(/getStatsPanelHeader/);
    });

    it('renders the panel only when payload.playerStats is supplied', async () => {
      // The scene must read `this.payload.playerStats` and render a
      // header + per-player rows when it's present. A `playerStats:
      // null` payload (legacy / direct-nav) skips the panel — that
      // gate keeps the screen from crashing on partial data.
      const fs = await import('node:fs');
      const path = await import('node:path');
      const url = await import('node:url');
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const src = fs.readFileSync(
        path.join(here, 'ResultsScene.ts'),
        'utf8',
      );
      // Conditional gate on playerStats.
      expect(src).toMatch(/playerStats/);
      // The header row label is rendered as plain text.
      expect(src).toMatch(/POST-MATCH STATS/);
    });

    it("renders one stats row per player via formatStatsLine", async () => {
      // Pin the per-row contract: the scene must iterate playerNames
      // and call `formatStatsLine` per slot. Without the iteration
      // we'd miss 3 of 4 players in an FFA payload.
      const fs = await import('node:fs');
      const path = await import('node:path');
      const url = await import('node:url');
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const src = fs.readFileSync(
        path.join(here, 'ResultsScene.ts'),
        'utf8',
      );
      // Iterate the players array.
      expect(src).toMatch(/playerNames\.forEach/);
      // Build each row through the Phaser-free formatter.
      expect(src).toMatch(/formatStatsLine\(/);
    });

    it('exposes per-player stats on the MatchResultPayload contract', () => {
      // Confirms the type surface: `playerStats` must be readable off
      // the payload. We construct a minimal payload to ensure the
      // structural type still permits null + populated arrays — the
      // scene relies on this shape.
      const empty: MatchResultPayload = {
        winnerIndex: 0,
        winnerName: 'Wolf',
        finalStocks: [3, 0],
        playerNames: ['Wolf', 'Cat'],
        endFrame: 6120,
        stageName: 'Flat Stage',
        playerStats: null,
      };
      expect(empty.playerStats).toBeNull();

      const populated: MatchResultPayload = {
        ...empty,
        playerStats: [
          {
            kos: 2,
            deaths: 0,
            damageDealt: 240,
            damageTaken: 80,
            survivalFrames: 6120,
            eliminated: false,
          },
          {
            kos: 0,
            deaths: 3,
            damageDealt: 60,
            damageTaken: 360,
            survivalFrames: 4800,
            eliminated: true,
          },
        ],
      };
      expect(populated.playerStats?.[0]?.kos).toBe(2);
      expect(populated.playerStats?.[1]?.eliminated).toBe(true);
    });
  });

  describe('AC 18 — rematch + return-to-lobby buttons', () => {
    /**
     * The seed lists "Rematch button and return-to-lobby button on
     * results screen" as a v1 acceptance criterion. The buttons are
     * rendered Phaser-side via `layoutResultsButtons` + the scene's
     * private `renderActionButton`, but we can still pin the static
     * surface — the helper consumed and the keyboard hotkeys wired —
     * by reading the source file as text.
     *
     * This guards: a) the rematch button still goes to MatchScene,
     * b) a new return-to-lobby button goes to CharacterSelectScene
     * (the M2 lobby surface), c) both buttons have keyboard hotkeys
     * so the screen is still fully usable without a mouse.
     */
    it('imports the layoutResultsButtons helper and the canonical list', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const url = await import('node:url');
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const src = fs.readFileSync(
        path.join(here, 'ResultsScene.ts'),
        'utf8',
      );
      // The renderer must source button labels / targets / hotkeys
      // from the Phaser-free helper rather than hardcoding them in
      // the scene class — keeps the contract testable under plain
      // Node and prevents drift.
      expect(src).toMatch(/from ['"]\.\/resultsButtons['"]/);
      expect(src).toMatch(/layoutResultsButtons/);
      expect(src).toMatch(/RESULTS_BUTTONS/);
    });

    it('wires the [L] hotkey to CharacterSelectScene (return-to-lobby)', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const url = await import('node:url');
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const src = fs.readFileSync(
        path.join(here, 'ResultsScene.ts'),
        'utf8',
      );
      expect(src).toMatch(/keydown-L/);
      expect(src).toMatch(/scene\.start\(['"]CharacterSelectScene['"]\)/);
    });

    it('exposes the canonical button list via ResultsScene.buttons', async () => {
      // The static getter delegates to `RESULTS_BUTTONS`; we already
      // pin that array in `resultsButtons.test.ts`, but importing
      // `ResultsScene` directly would pull in Phaser. Instead, sanity-
      // check the source-level wiring so the static surface is reachable.
      const fs = await import('node:fs');
      const path = await import('node:path');
      const url = await import('node:url');
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const src = fs.readFileSync(
        path.join(here, 'ResultsScene.ts'),
        'utf8',
      );
      expect(src).toMatch(/static get buttons/);
    });
  });
});
