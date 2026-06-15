import Phaser from 'phaser';
import type { MatchResultPayload } from '../match';
import type { MatchConfig } from '../types';
import { BOOT_REGISTRY_KEYS } from './bootKeys';
import { computeResultsHeadline } from './resultsHeadline';
import {
  formatStatsLine,
  getStatsPanelHeader,
} from './resultsStats';
import {
  DEFAULT_RESULTS_BUTTON_SIZE,
  RESULTS_BUTTONS,
  layoutResultsButtons,
  type ResultsButtonPlacement,
} from './resultsButtons';
import {
  downloadReplayFile,
  DownloadReplayUnsupportedError,
  type ReplayFile,
} from '../replay';
import {
  MENU_COLORS_CSS,
  MENU_FONT,
  paintMenuBackground,
} from '../ui/menuTheme';
import { MenuPadNav } from '../ui/menuPadNav';

// Re-export so existing imports from `./ResultsScene` keep resolving.
export { computeResultsHeadline };

// Visual constants for the action-button row. Kept module-local so a
// future tweak (e.g. a different palette) doesn't ripple through every
// scene. Colours mirror the M5 rebinding screen for consistency.
const RESULTS_BUTTON_FILL_IDLE = 0x2c2e3e;
const RESULTS_BUTTON_FILL_HOVER = 0x3d4055;
const RESULTS_BUTTON_FILL_ALPHA = 0.95;
const RESULTS_BUTTON_STROKE_IDLE = 0x6cf0c2;
const RESULTS_BUTTON_STROKE_HOVER = 0xffd166;

/**
 * Sub-AC 4.3 of AC 303 — post-match results screen.
 *
 * `ResultsScene` is the deterministic landing pad after `MatchScene`'s
 * `MatchEndDetector` flips to READY. It renders:
 *
 *   • A big winner banner — "WOLF WINS", "PLAYER 3 WINS", or "DRAW"
 *     when no sole survivor exists.
 *   • The per-player stock breakdown, so a 4-player FFA shows everyone
 *     who came in second, third, etc.
 *   • The stage label (when the match scene supplied one), as a small
 *     subtitle.
 *   • Two clear input prompts: ENTER to rematch (re-launches the match
 *     scene), ESC to return to the main menu.
 *
 * Why a dedicated scene instead of a banner overlay:
 *
 *   • Clean separation of concerns (Seed `code_architecture` principle).
 *     Match teardown, sprite destruction, blast-zone listener removal,
 *     `Character.destroy`, and the results render live in their own
 *     scenes — each bounded by Phaser's lifecycle hooks. A banner
 *     overlay would force the gameplay scene to stay alive while the
 *     player reads the outcome.
 *
 *   • Replay friendliness. The (M4) replay system records inputs, so a
 *     replay never re-enters this scene; it just plays back the match
 *     and the recorded "scene transition" event. Decoupling the
 *     gameplay scene from the results scene keeps the replay file
 *     portable.
 *
 *   • Future-proof. The seed's milestone plan calls for a stage builder
 *     (M3), replay browser (M4), and rebinding screen (M5). A separate
 *     `ResultsScene` is the natural hub to bolt the "save replay" /
 *     "rematch with same settings" buttons onto without enlarging the
 *     match scene's responsibilities.
 *
 * Determinism note: this scene is purely presentational. No
 * `Math.random()`, no per-tick state mutation, no influence over the
 * physics simulation. The replay system can safely skip it.
 *
 * Lifecycle:
 *
 *   matchScene.scene.start('ResultsScene', resultPayload);
 *   // → user presses ENTER → scene.start('MatchScene')
 *   // → user presses ESC   → scene.start('MainMenuScene')
 */
export class ResultsScene extends Phaser.Scene {
  private payload: MatchResultPayload | null = null;

  /** Shared gamepad poller so pad-only players can navigate the menu. */
  private padNav: MenuPadNav | undefined = undefined;

  constructor() {
    super({ key: 'ResultsScene' });
  }

  /**
   * Phaser passes the data argument from `scene.start('ResultsScene', data)`
   * to `init`. We keep a typed reference so the renderer can read it in
   * `create`, and we tolerate a missing payload (e.g. when someone
   * navigates here directly during dev) by falling back to a "no data"
   * stub so the scene never crashes.
   */
  init(data: MatchResultPayload | undefined): void {
    this.payload =
      data && typeof data === 'object' && Array.isArray(data.finalStocks)
        ? data
        : null;
  }

  create(): void {
    const { width, height } = this.scale.gameSize;
    const cx = width / 2;

    paintMenuBackground(this);

    // ---- Top banner: clear next-step hint ---------------------------------
    // Players reported "no idea what to do when match is done" — the
    // bottom-row buttons + ESC hint were apparently missed. Adding a
    // high-contrast prompt at the very top of the screen so the next
    // step is the FIRST thing read.
    this.add
      .text(
        cx,
        24,
        '[ENTER] / Ⓐ REMATCH    [L] CHARACTER SELECT    [ESC] / Ⓑ MAIN MENU',
        {
          fontFamily: MENU_FONT,
          fontSize: '19px',
          fontStyle: 'bold',
          color: MENU_COLORS_CSS.accent,
          backgroundColor: '#000000aa',
          padding: { x: 10, y: 6 },
        },
      )
      .setOrigin(0.5, 0)
      .setDepth(1000);

    // ---- Title banner ------------------------------------------------------
    // The headline reads "WOLF WINS" / "PLAYER 1 WINS" / "DRAW" depending on
    // what the detector latched. We render it big and warm so it lands as
    // the screen's primary affordance.
    const headline = this.computeHeadline();
    const headlineColor = this.payload?.winnerIndex !== null && this.payload?.winnerIndex !== undefined
      ? '#ffd166'
      : '#a0a0b8';
    this.add
      .text(cx, height * 0.22, headline, {
        fontFamily: MENU_FONT,
        fontSize: '88px',
        fontStyle: 'bold',
        color: headlineColor,
      })
      .setOrigin(0.5)
      .setShadow(0, 6, '#000000', 14, true, true);

    // Optional subtitle: stage name. Keeps the eye on the headline but
    // confirms which stage the match was played on (handy when rematches
    // start landing in the post-M2 lobby flow).
    if (this.payload?.stageName) {
      this.add
        .text(cx, height * 0.32, this.payload.stageName, {
          fontFamily: 'monospace',
          fontSize: '20px',
          color: '#6cf0c2',
        })
        .setOrigin(0.5);
    }

    // ---- Per-player stock breakdown ---------------------------------------
    // Always render at least the slots in the payload so a 4-player FFA
    // shows where everyone landed. Winners get a yellow tint, losers
    // dim grey, draws plain white.
    if (this.payload) {
      const baseY = height * 0.42;
      const lineHeight = 28;
      this.payload.playerNames.forEach((name, i) => {
        const stocks = this.payload!.finalStocks[i] ?? 0;
        const isWinner = this.payload!.winnerIndex === i;
        const colour = isWinner ? '#ffd166' : stocks > 0 ? '#e8e8f0' : '#888899';
        const glyphs = stocks > 0 ? '●'.repeat(stocks) : '—';
        const prefix = isWinner ? '★ ' : '  ';
        this.add
          .text(
            cx,
            baseY + i * lineHeight,
            `${prefix}P${i + 1}  ${name.padEnd(10, ' ')}  ${glyphs}`,
            {
              fontFamily: 'monospace',
              fontSize: '22px',
              color: colour,
            },
          )
          .setOrigin(0.5);
      });

      // ---- Sub-AC 2 of AC 16: post-match stats panel ----------------------
      // KOs / damage / survival time per slot, sourced from the
      // MatchStatsTracker snapshot the detector latched on entry to
      // ENDING. Rendered below the stocks block in a fixed-width grid
      // so columns align even with mixed-length names.
      //
      // The block is gated on `playerStats` being present; legacy match
      // setups (or direct dev navigation) that don't carry stats in the
      // payload simply skip this panel — the headline + stocks block
      // already render the canonical post-match summary.
      if (this.payload.playerStats) {
        const statsBaseY =
          baseY + this.payload.playerNames.length * lineHeight + 24;
        this.add
          .text(cx, statsBaseY, 'POST-MATCH STATS', {
            fontFamily: 'monospace',
            fontSize: '16px',
            color: '#a0a0b8',
          })
          .setOrigin(0.5);
        this.add
          .text(cx, statsBaseY + 22, getStatsPanelHeader(), {
            fontFamily: 'monospace',
            fontSize: '14px',
            color: '#6cf0c2',
          })
          .setOrigin(0.5);

        const statsRowsBaseY = statsBaseY + 44;
        const statsRowHeight = 22;
        this.payload.playerNames.forEach((name, i) => {
          const stats = this.payload!.playerStats![i];
          if (!stats) return;
          const isWinner = this.payload!.winnerIndex === i;
          const stocks = this.payload!.finalStocks[i] ?? 0;
          const colour = isWinner
            ? '#ffd166'
            : stocks > 0
              ? '#e8e8f0'
              : '#888899';
          const line = formatStatsLine({
            index: i,
            name,
            isWinner,
            stats,
          });
          this.add
            .text(cx, statsRowsBaseY + i * statsRowHeight, line, {
              fontFamily: 'monospace',
              fontSize: '16px',
              color: colour,
            })
            .setOrigin(0.5);
        });
      }
    } else {
      this.add
        .text(cx, height * 0.5, '(no result data)', {
          fontFamily: 'monospace',
          fontSize: '20px',
          color: '#888899',
        })
        .setOrigin(0.5);
    }

    // ---- Action buttons (AC 18) -------------------------------------------
    // Two big on-screen buttons, both clickable and keyboard-driven:
    //
    //   • REMATCH       → MatchScene             ([ENTER] hotkey)
    //   • BACK TO LOBBY → CharacterSelectScene   ([L] hotkey)
    //
    // (Pre-M1.5 seeds called this AC 17. The renumber to AC 18 is the
    // only change — the renderer contract, button labels, hotkeys, and
    // target scenes are identical to the original landing of this work.)
    //
    // Layout, labels, and target scenes come from the Phaser-free
    // `resultsButtons` helper so the contract is unit-tested under
    // plain Node and the renderer can't drift from the contract.
    const placements = layoutResultsButtons(width, height, DEFAULT_RESULTS_BUTTON_SIZE);
    placements.forEach((placement) => {
      this.renderActionButton(placement);
    });

    // Keep a small text affordance for [ESC] → main menu so the player
    // always has an escape hatch off the results screen even if neither
    // primary button matches their goal (e.g. they want to quit out to
    // the title rather than rematch or re-pick fighters). Smaller font
    // / dim colour keeps it subordinate to the two primary buttons.
    this.add
      .text(cx, height * 0.9, 'Press [ESC] to return to menu', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#888899',
      })
      .setOrigin(0.5);

    // S → save replay file (post-match only). The MatchScene stashes a
    // pre-built ReplayFile + suggested filename in the registry under
    // 'lastReplay' on its way to ResultsScene. We use `on` (not `once`)
    // so a player can re-download if their browser dropped the first
    // file. Idempotent — same registry entry, same bytes, new download.
    const stashed = this.registry.get('lastReplay') as
      | { replayFile: ReplayFile; fileName: string }
      | null
      | undefined;
    if (stashed && stashed.replayFile) {
      this.add
        .text(cx, height * 0.85, 'Press [S] to save replay', {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: '#6cf0c2',
        })
        .setOrigin(0.5);
      this.input.keyboard?.on('keydown-S', () => {
        try {
          downloadReplayFile(stashed.replayFile, { fileName: stashed.fileName });
        } catch (err) {
          // Silently swallow unsupported-browser case; the toast lives
          // on MatchScene so we render a fallback line on next render.
          if (!(err instanceof DownloadReplayUnsupportedError)) {
            // eslint-disable-next-line no-console
            console.error('[ResultsScene] save replay failed', err);
          }
        }
      });
    }

    // ---- Input handlers ----------------------------------------------------
    // Use `once` so a held key from the match (e.g. the player's last
    // input still being read by the keyboard manager when the scene
    // boots) doesn't accidentally double-fire and skip the screen
    // before the player sees it.
    //
    // ENTER → rematch (MatchScene). Same contract as the pre-AC 18
    // results screen — only the visual representation changed (now a
    // big button instead of a single line of prompt text).
    this.input.keyboard?.once('keydown-ENTER', () => this.startRematch());
    // L → return to lobby (CharacterSelectScene). The AC 18 surface.
    this.input.keyboard?.once('keydown-L', () => {
      this.scene.start('CharacterSelectScene');
    });
    // ESC → main menu remains as the global escape hatch. Preserved
    // verbatim so the M1 contract (and existing tests) still hold.
    this.input.keyboard?.once('keydown-ESC', () => {
      this.scene.start('MainMenuScene');
    });

    this.padNav = new MenuPadNav(this);
  }

  update(): void {
    const pad = this.padNav?.poll();
    if (pad?.confirm) this.startRematch();
    else if (pad?.back) this.scene.start('MainMenuScene');
  }

  /**
   * REMATCH preserves the previous match's character + palette
   * assignments by forwarding the stashed `MatchConfig`. Without this
   * hop the rematch would re-run with default palettes and a player
   * who picked a non-default colour would suddenly see their character
   * change shade.
   */
  private startRematch(): void {
    const lastConfig = this.registry.get(
      BOOT_REGISTRY_KEYS.lastMatchConfig,
    ) as MatchConfig | undefined;
    this.scene.start('MatchScene', lastConfig ? { matchConfig: lastConfig } : undefined);
  }

  /**
   * Render one of the two action buttons. Pulled out of `create` so
   * the per-button wiring (background rect, label, hint, click +
   * hover handlers, keyboard hotkey, pulse tween for the primary
   * button) stays readable.
   *
   * The button's hit region is the background rectangle; the label
   * and hint also forward `pointerdown` so a click on either fires
   * the action (Phaser quirk: the rectangle's hit region only catches
   * pointer events on the rect itself, not nested objects).
   */
  private renderActionButton(placement: ResultsButtonPlacement): void {
    const { spec, cx, cy, width, height } = placement;
    const isPrimary = spec.id === 'rematch';

    // Background — the actual click target.
    const bg = this.add
      .rectangle(
        cx,
        cy,
        width,
        height,
        RESULTS_BUTTON_FILL_IDLE,
        RESULTS_BUTTON_FILL_ALPHA,
      )
      .setOrigin(0.5)
      .setStrokeStyle(2, RESULTS_BUTTON_STROKE_IDLE, 0.9);
    if (typeof bg.setInteractive === 'function') {
      bg.setInteractive({ useHandCursor: true });
    }

    // Big label, centred.
    const labelColour = isPrimary ? '#6cf0c2' : '#e8e8f0';
    const label = this.add
      .text(cx, cy - 8, spec.label, {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: labelColour,
      })
      .setOrigin(0.5);

    // Shortcut hint under the label, e.g. "[ENTER]".
    const hint = this.add
      .text(cx, cy + 18, spec.shortcutHint, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#a0a0b8',
      })
      .setOrigin(0.5);

    // Hover effect — repaint the rect's fill + stroke. Cheap to do
    // here because the scene is otherwise static (no per-frame work).
    if (typeof bg.on === 'function') {
      bg.on('pointerover', () => {
        bg.setFillStyle(RESULTS_BUTTON_FILL_HOVER, RESULTS_BUTTON_FILL_ALPHA);
        bg.setStrokeStyle(2, RESULTS_BUTTON_STROKE_HOVER, 1);
      });
      bg.on('pointerout', () => {
        bg.setFillStyle(RESULTS_BUTTON_FILL_IDLE, RESULTS_BUTTON_FILL_ALPHA);
        bg.setStrokeStyle(2, RESULTS_BUTTON_STROKE_IDLE, 0.9);
      });
      bg.on('pointerdown', () => {
        this.scene.start(spec.targetScene);
      });
    }

    // Click on the label / hint also fires the action so a slightly
    // off-target tap still works. Tolerant of Phaser builds where text
    // doesn't expose `setInteractive` (smoke tests, headless minimal
    // fakes) by guarding with typeof.
    [label, hint].forEach((textObj) => {
      const interactive = textObj as unknown as {
        setInteractive?: (config?: unknown) => unknown;
        on?: (event: string, fn: () => void) => unknown;
      };
      if (typeof interactive.setInteractive === 'function') {
        interactive.setInteractive({ useHandCursor: true });
      }
      if (typeof interactive.on === 'function') {
        interactive.on('pointerdown', () => {
          this.scene.start(spec.targetScene);
        });
      }
    });

    // Pulse the primary (REMATCH) button to draw the eye, mirroring the
    // main-menu prompt so the affordance feels familiar.
    if (isPrimary) {
      this.tweens.add({
        targets: label,
        alpha: 0.55,
        duration: 800,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  /**
   * Static getter exposing the canonical button list, so consumers
   * (tests, telemetry, debug overlays) can reach the contract without
   * importing the helper module directly.
   */
  static get buttons(): typeof RESULTS_BUTTONS {
    return RESULTS_BUTTONS;
  }

  /**
   * Build the headline string from the payload. Delegates to the
   * Phaser-free `computeResultsHeadline` helper so the renderer and
   * the unit-test suite cannot drift.
   */
  private computeHeadline(): string {
    return computeResultsHeadline(this.payload);
  }
}
