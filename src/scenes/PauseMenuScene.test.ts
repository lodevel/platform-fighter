import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PAUSE_MENU_OPTIONS,
  type PauseAction,
} from './pauseMenu';

/**
 * Static-text contract for the M2 in-match pause overlay (`PauseMenuScene`).
 *
 * The overlay scene imports Phaser, which pulls in browser globals at
 * module-eval time and can't be loaded under plain Node. The same two
 * strategies `ResultsScene.test.ts` uses keep its contract testable:
 *
 *   1. The flow logic — cursor model, option↔action mapping, wrap-around
 *      nav — is delegated to the Phaser-free `./pauseMenu.ts` helper, which
 *      is exhaustively unit-tested in `pauseMenu.test.ts`. The scene calls
 *      those exact functions, so a regression in the flow contract surfaces
 *      there without jsdom + Phaser.
 *
 *   2. The wiring this file owns — that the overlay consumes the pure
 *      helper + the shared menu infra, dispatches each option's action back
 *      into `MatchScene`, and is registered in the global scene list — is
 *      verified by reading the source files as text and asserting the
 *      static surface. (The actual `scene.launch` / `scene.get` calls
 *      require a live Phaser game, but the target keys + symbols are a
 *      static-text contract this test guards.)
 *
 * Determinism note: the pause overlay is presentation / flow only — it
 * never touches the deterministic sim or RNG (the freeze lives on the
 * `MatchScene` side). These assertions therefore pin only flow wiring.
 */
describe('PauseMenuScene — M2 pause overlay wiring', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sceneSrc = readFileSync(join(here, 'PauseMenuScene.ts'), 'utf8');
  const gameConfigSrc = readFileSync(
    join(here, '..', 'engine', 'GameConfig.ts'),
    'utf8',
  );

  // -------------------------------------------------------------------------
  // Scene key registration
  // -------------------------------------------------------------------------

  describe('scene key + registration', () => {
    it('declares the canonical PauseMenuScene scene key', () => {
      // `MatchScene.openPauseMenu` calls `scene.launch('PauseMenuScene')`;
      // that string must map to a class that supers with the same key or
      // the overlay never appears.
      expect(sceneSrc).toMatch(/super\(\{\s*key:\s*['"]PauseMenuScene['"]\s*\}\)/);
      expect(sceneSrc).toMatch(/class PauseMenuScene extends Phaser\.Scene/);
    });

    it('is registered in the global SCENES list (GameConfig)', () => {
      // The only wiring needed to make the overlay known to Phaser — an
      // import + an array entry alongside the other scenes.
      expect(gameConfigSrc).toMatch(
        /import\s*\{\s*PauseMenuScene\s*\}\s*from\s*['"]\.\.\/scenes\/PauseMenuScene['"]/,
      );
      expect(gameConfigSrc).toMatch(/PauseMenuScene,/);
      // Registered alongside the match scene it overlays.
      expect(gameConfigSrc).toMatch(/MatchScene/);
    });
  });

  // -------------------------------------------------------------------------
  // Consumes the pure logic + shared menu infra (no duplicated contract)
  // -------------------------------------------------------------------------

  describe('reuses pauseMenu.ts + menu infra', () => {
    it('imports the pure flow helpers from ./pauseMenu', () => {
      // The cursor model, option list, and resolution helpers come from the
      // Phaser-free module so the scene can't drift from the unit-tested
      // contract — mirrors how ResultsScene sources resultsButtons.
      expect(sceneSrc).toMatch(/from ['"]\.\/pauseMenu['"]/);
      expect(sceneSrc).toMatch(/PAUSE_MENU_OPTIONS/);
      expect(sceneSrc).toMatch(/moveSelection/);
      expect(sceneSrc).toMatch(/getSelectedOption/);
      expect(sceneSrc).toMatch(/getOptionByAction/);
      expect(sceneSrc).toMatch(/DEFAULT_PAUSE_MENU_STATE/);
    });

    it('navigates with the shared MenuPadNav gamepad poller', () => {
      // Pad nav (dpad/stick move, A/START confirm, B resume) reuses the
      // shared poller rather than re-implementing edge detection.
      expect(sceneSrc).toMatch(/from ['"]\.\.\/ui\/menuPadNav['"]/);
      expect(sceneSrc).toMatch(/new MenuPadNav\(this\)/);
      expect(sceneSrc).toMatch(/\.poll\(\)/);
    });

    it('renders with the shared menuTheme painters (themed, not bespoke)', () => {
      expect(sceneSrc).toMatch(/from ['"]\.\.\/ui\/menuTheme['"]/);
      expect(sceneSrc).toMatch(/paintMenuTitle/);
      expect(sceneSrc).toMatch(/paintPanel/);
      expect(sceneSrc).toMatch(/paintFooterHints/);
    });

    it('draws a translucent scrim instead of clearing the frozen match', () => {
      // It is launched ON TOP of the still-rendering MatchScene, so it must
      // NOT paint an opaque full-screen background. A translucent rect lets
      // the frozen frame show through. (The doc comment may *name*
      // paintMenuBackground to explain why it is skipped, so we assert it
      // is never *called* — `paintMenuBackground(...)` — rather than that
      // the identifier never appears.)
      expect(sceneSrc).not.toMatch(/paintMenuBackground\(/);
      expect(sceneSrc).not.toMatch(/import[^;]*paintMenuBackground/);
      expect(sceneSrc).toMatch(/0x07070d,\s*0\.72/);
    });

    it('titles the panel "Paused"', () => {
      expect(sceneSrc).toMatch(/paintMenuTitle\(\s*this,[^)]*['"]Paused['"]/s);
    });
  });

  // -------------------------------------------------------------------------
  // Option → action dispatch back into MatchScene
  // -------------------------------------------------------------------------

  describe('option dispatch wiring', () => {
    it('hands the chosen action back to MatchScene rather than transitioning itself', () => {
      // The overlay must not re-implement MatchScene's teardown / handoff:
      // it stops itself FIRST, then calls handlePauseAction. The per-action
      // scene.start lives in the MatchScene patch, keyed off PauseAction.
      expect(sceneSrc).toMatch(/scene\.get\(['"]MatchScene['"]\)/);
      expect(sceneSrc).toMatch(/scene\.stop\(['"]PauseMenuScene['"]\)/);
      expect(sceneSrc).toMatch(/handlePauseAction\(/);
    });

    it('closes the overlay BEFORE calling back (no lingering during scene.start)', () => {
      // The stop() must precede the handlePauseAction() callback in source
      // order so the overlay can't linger on top of the next scene.
      const stopIdx = sceneSrc.indexOf("this.scene.stop('PauseMenuScene')");
      const callIdx = sceneSrc.indexOf('match.handlePauseAction(action)');
      expect(stopIdx).toBeGreaterThanOrEqual(0);
      expect(callIdx).toBeGreaterThanOrEqual(0);
      expect(stopIdx).toBeLessThan(callIdx);
    });

    it('confirms the highlighted row via getSelectedOption', () => {
      expect(sceneSrc).toMatch(/getSelectedOption\(this\.state\)\.action/);
    });

    it('wires every PauseAction to a reachable input path', () => {
      // resume — ESC + pad back. Every other option has a direct hotkey
      // ([R]/[C]/[M]/[K]) plus is reachable by cursor + confirm. Pin the
      // direct-hotkey wiring per non-resume action so none is unreachable.
      expect(sceneSrc).toMatch(/keydown-ESC/);
      const hotkeyByAction: Readonly<Record<Exclude<PauseAction, 'resume'>, string>> = {
        restart: 'keydown-R',
        characterSelect: 'keydown-C',
        mainMenu: 'keydown-M',
        controls: 'keydown-K',
      };
      for (const option of PAUSE_MENU_OPTIONS) {
        if (option.action === 'resume') continue;
        const key = hotkeyByAction[option.action];
        expect(sceneSrc).toMatch(new RegExp(key));
        expect(sceneSrc).toMatch(
          new RegExp(`getOptionByAction\\(['"]${option.action}['"]\\)`),
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // Input: keyboard + mouse + listener cleanup
  // -------------------------------------------------------------------------

  describe('input + cleanup', () => {
    it('binds keyboard move / select / resume', () => {
      expect(sceneSrc).toMatch(/keydown-UP/);
      expect(sceneSrc).toMatch(/keydown-DOWN/);
      expect(sceneSrc).toMatch(/keydown-ENTER/);
    });

    it('routes mouse through a DOM-level mousedown listener (launch-safe)', () => {
      // Phaser pointer events are unreliable after scene.launch, so the
      // overlay hit-tests canvas-space clicks via a DOM listener — the same
      // pattern CharacterSelectScene / ResultsScene use.
      expect(sceneSrc).toMatch(/addEventListener\(['"]mousedown['"]/);
      expect(sceneSrc).toMatch(/getBoundingClientRect\(\)/);
    });

    it('detaches keyboard + DOM + pad listeners on SHUTDOWN', () => {
      expect(sceneSrc).toMatch(/Phaser\.Scenes\.Events\.SHUTDOWN/);
      expect(sceneSrc).toMatch(/removeAllListeners\(\)/);
      expect(sceneSrc).toMatch(/removeEventListener\(['"]mousedown['"]/);
    });
  });
});
