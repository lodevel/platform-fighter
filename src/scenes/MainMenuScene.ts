import Phaser from 'phaser';
import {
  MENU_COLORS,
  MENU_COLORS_CSS,
  MENU_FONT,
  addPulse,
  paintFooterHints,
  paintMenuBackground,
} from '../ui/menuTheme';
import { MenuPadNav } from '../ui/menuPadNav';

/**
 * MainMenuScene shows the title and lets the user enter a match or open
 * the input-rebinding screen.
 *
 * Navigation map:
 *
 *   • [ENTER] / Ⓐ / START — open Mode Select, then the Smash-style
 *     Character Select (join + pick + CPU setup on one screen), then
 *     Stage Select, then the match (AC 2 Sub-AC 5).
 *   • [SHIFT+ENTER] — skip every select screen and launch `MatchScene`
 *     directly with the dev-mode defaults (Stock + 3 stocks). Preserves
 *     the M1 "press ENTER to fight" path used by smoke tests.
 *   • [O] — open the input-rebinding screen (`RebindingScene`).
 *   • [C] — open the character editor (M7.6).
 *
 * Gamepad support comes from the shared {@link MenuPadNav} poller so a
 * pad-only player can reach the match without touching the keyboard.
 */
export class MainMenuScene extends Phaser.Scene {
  private padNav: MenuPadNav | undefined = undefined;

  constructor() {
    super({ key: 'MainMenuScene' });
  }

  create(): void {
    const { width, height } = this.scale.gameSize;

    paintMenuBackground(this);

    // ---- Title block --------------------------------------------------------
    const title = this.add
      .text(width / 2, height * 0.3, 'PLATFORM', {
        fontFamily: MENU_FONT,
        fontSize: '84px',
        fontStyle: 'bold',
        color: MENU_COLORS_CSS.textPrimary,
      })
      .setOrigin(0.5)
      .setShadow(0, 6, '#000000', 14, true, true);
    const title2 = this.add
      .text(width / 2, height * 0.41, 'FIGHTER', {
        fontFamily: MENU_FONT,
        fontSize: '84px',
        fontStyle: 'bold',
        color: MENU_COLORS_CSS.accent,
      })
      .setOrigin(0.5)
      .setShadow(0, 6, '#000000', 14, true, true);
    void title;
    this.add
      .rectangle(width / 2, height * 0.475, title2.width * 0.9, 4, MENU_COLORS.gold)
      .setOrigin(0.5);
    this.add
      .text(width / 2, height * 0.51, 'Pre-Alpha — M1-M5 + polish', {
        fontFamily: MENU_FONT,
        fontSize: '18px',
        color: MENU_COLORS_CSS.textSecondary,
      })
      .setOrigin(0.5);

    // ---- Primary prompt ------------------------------------------------------
    const prompt = this.add
      .text(width / 2, height * 0.64, 'PRESS  [ENTER]  OR  Ⓐ  TO START', {
        fontFamily: MENU_FONT,
        fontSize: '24px',
        fontStyle: 'bold',
        color: MENU_COLORS_CSS.gold,
      })
      .setOrigin(0.5);
    addPulse(this, prompt, { minAlpha: 0.35, duration: 800 });

    // ---- Secondary options ---------------------------------------------------
    this.add
      .text(
        width / 2,
        height * 0.74,
        '[O] input rebinding      [C] character editor',
        {
          fontFamily: MENU_FONT,
          fontSize: '16px',
          color: MENU_COLORS_CSS.textSecondary,
        },
      )
      .setOrigin(0.5);

    paintFooterHints(this, height - 16, [
      'Local multiplayer for up to 4 players — keyboard + gamepads',
    ]);

    // ENTER → ModeSelect → CharacterSelect → StageSelect → Match.
    // CharacterSelectScene is the single source of truth for player
    // setup (join, fighters, palettes, CPUs) — Smash-style, one screen.
    //
    // SHIFT+ENTER preserves the M1 "press ENTER to fight" smoke-test
    // path: it bypasses every select screen and starts a match with
    // synthesised dev-mode defaults.
    this.input.keyboard?.on('keydown-ENTER', (event: KeyboardEvent) => {
      if (event.shiftKey) {
        this.scene.start('MatchScene');
      } else {
        this.scene.start('ModeSelectScene');
      }
    });

    this.input.keyboard?.once('keydown-O', () => {
      this.scene.start('RebindingScene');
    });

    // [C] → character editor (M7.6).
    this.input.keyboard?.once('keydown-C', () => {
      this.scene.start('CharacterEditorScene');
    });

    this.padNav = new MenuPadNav(this);
  }

  update(): void {
    const pad = this.padNav?.poll();
    if (pad?.confirm) {
      this.scene.start('ModeSelectScene');
    }
  }
}
