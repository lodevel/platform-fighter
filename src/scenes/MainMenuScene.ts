import Phaser from 'phaser';

/**
 * MainMenuScene shows the title and lets the user enter a match or open
 * the input-rebinding screen. The full menu (character select, stage
 * select, options) will be fleshed out in later milestones.
 *
 * Sub-AC navigation map:
 *
 *   • [ENTER]      — open the pre-match Player Lobby (`LobbyScene`)
 *                    where 1..4 players Press Start to claim slots.
 *                    The lobby then forwards through Mode Select →
 *                    Stage Select → Character Select → Match Scene
 *                    (AC 2 Sub-AC 5).
 *   • [SHIFT+ENTER] — skip the lobby + Mode Select and launch
 *                    `MatchScene` directly with the dev-mode defaults
 *                    (Stock + 3 stocks). Preserves the M1 "press
 *                    ENTER to fight" path used by smoke tests and
 *                    quick playtests.
 *   • [O]          — open the input-rebinding screen (`RebindingScene`).
 *
 * The single-letter shortcut keeps the M1 menu lean while still giving
 * QA / playtesters a reachable path to the M5 rebinding layout. A full
 * options page with mouse-friendly buttons can fold the same scene
 * transition into a click handler later.
 */
export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MainMenuScene' });
  }

  create(): void {
    const { width, height } = this.scale.gameSize;

    this.add
      .text(width / 2, height * 0.32, 'PLATFORM FIGHTER', {
        fontFamily: 'monospace',
        fontSize: '72px',
        color: '#e8e8f0',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height * 0.42, 'Pre-Alpha — M1-M5 + polish', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#6cf0c2',
      })
      .setOrigin(0.5);

    const prompt = this.add
      .text(width / 2, height * 0.6, 'Press [ENTER] to start a match', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#a0a0b8',
      })
      .setOrigin(0.5);

    // Secondary prompt for the M5 rebinding screen. Smaller font / dim
    // colour so it doesn't compete with the primary "play now" affordance,
    // but always visible so QA can find it without reading the source.
    this.add
      .text(width / 2, height * 0.7, 'Press [O] for input rebinding · [C] for character editor', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#888899',
      })
      .setOrigin(0.5);

    this.tweens.add({
      targets: prompt,
      alpha: 0.4,
      duration: 800,
      yoyo: true,
      repeat: -1,
    });

    // ENTER → ModeSelect → StageSelect → CharacterSelect → Match.
    // The pre-match player setup was previously split between
    // LobbyScene (join/AI/device) AND CharacterSelectScene (join/AI/
    // device/character/palette/ready) — a confusing dual-screen flow
    // duplicating ~70% of controls. CharacterSelectScene already
    // covers everything LobbyScene did, so we go straight to mode
    // selection and use CharacterSelectScene as the single source of
    // truth for player setup.
    //
    // SHIFT+ENTER preserves the M1 "press ENTER to fight" smoke-test
    // path: it bypasses every select screen and starts a match with
    // synthesised dev-mode defaults so quick-iteration playtests don't
    // have to round-trip through a menu.
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

    // [C] → character editor (M7.6). Same single-letter shortcut
    // pattern as [O] for rebinding — visible to QA / playtesters
    // without growing the menu UI.
    this.input.keyboard?.once('keydown-C', () => {
      this.scene.start('CharacterEditorScene');
    });
  }
}
