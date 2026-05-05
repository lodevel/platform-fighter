import Phaser from 'phaser';
import {
  DEFAULT_MODE_SELECT_STATE,
  buildMatchConfigFromState,
  cycleMode,
  cycleQuantity,
  formatModeLabel,
  formatQuantityLabel,
  type ModeSelectState,
} from './modeSelect';
import {
  buildPlayerSlotsFromLobby,
  type LobbyHandoffPayload,
  type LobbyState,
} from './lobby';
import { BOOT_REGISTRY_KEYS } from './bootKeys';
import { GAME_CONFIG } from '../engine/constants';
import { FLAT_STAGE } from '../stages';
import type { MatchConfig, PlayerSlot } from '../types';

/**
 * ModeSelectScene — AC 11 ("Both Stock and Time modes selectable
 * pre-match").
 *
 * Sits between `MainMenuScene` and `MatchScene` so the player explicitly
 * picks the match shape before the fight starts. The screen offers:
 *
 *   • LEFT / RIGHT — toggle the match mode (`Stock` ⇄ `Time`).
 *   • UP / DOWN     — cycle the active mode's quantity (stock count
 *                     for Stock mode, time limit for Time mode).
 *   • ENTER         — confirm and launch `MatchScene` with the
 *                     resolved `MatchConfig`.
 *   • ESC           — back out to the main menu (no match started).
 *
 * Why a dedicated scene
 * ---------------------
 *
 * Per the project's `code_architecture` evaluation principle, scenes
 * stay thin: lifecycle wiring + scene transitions only. All the
 * selection logic — "what mode is selected", "what is the next stock
 * count when the player presses RIGHT", "is this a time-mode config" —
 * lives in the Phaser-free `./modeSelect.ts` helper, which is unit-
 * tested under plain Node. This scene just:
 *
 *   1. Owns the live `ModeSelectState`.
 *   2. Maps key events onto the helper's pure transitions.
 *   3. Re-renders its three text rows from the new state each tick.
 *   4. On confirm, builds the `MatchConfig` from the helper and starts
 *      `MatchScene` with it as scene-data.
 *
 * The default state opens on Stock + 3 stocks + 3-minute timer so a
 * player who hits ENTER without changing anything gets the canonical
 * Smash Bros. match shape — the same one the M1 dev-mode "press
 * ENTER to fight" path produces.
 *
 * Determinism note: nothing in this scene reads `Math.random()` or the
 * wall clock for gameplay-affecting values. The `rngSeed` baked into
 * the resulting `MatchConfig` is the *boot* RNG seed (the same value
 * `MatchScene` would have fallen back to in dev mode), so two players
 * who pick "Stock + 3" produce byte-identical match seeds and replay
 * artefacts.
 */
/**
 * AC 2 Sub-AC 5 — payload forwarded from `LobbyScene` carrying the
 * joined slot lineup. ModeSelect threads it through to
 * `StageSelectScene` (and on to `CharacterSelectScene`) so the
 * downstream lobby tiles can pre-light up the slots the player
 * already claimed without making them Press Start a second time.
 *
 * Optional — direct-launch flows (smoke tests, headless replay
 * harnesses) skip the lobby and go straight to mode select; in that
 * case the field is `undefined` and the scene falls back to its
 * legacy "synthesise a P1+P2 default" behaviour.
 */
export interface ModeSelectSceneData {
  readonly lobby?: LobbyHandoffPayload;
}

export class ModeSelectScene extends Phaser.Scene {
  private state: ModeSelectState = DEFAULT_MODE_SELECT_STATE;

  // Cached text handles for the rows that get re-painted from the
  // live state on every key press. The static title and footer hints
  // don't change after `create()` so we don't bother caching them.
  private modeRow!: Phaser.GameObjects.Text;
  private quantityRow!: Phaser.GameObjects.Text;

  /**
   * AC 2 Sub-AC 5 — lobby payload forwarded from `LobbyScene`. Captured
   * in `init()` and threaded into the `StageSelectScene` start payload
   * on confirm so the downstream chain can pre-populate joined slots.
   */
  private pendingLobby: LobbyHandoffPayload | undefined = undefined;

  constructor() {
    super({ key: 'ModeSelectScene' });
  }

  init(data?: ModeSelectSceneData): void {
    this.pendingLobby = data?.lobby;
  }

  create(): void {
    const { width, height } = this.scale.gameSize;

    // ---- Title -------------------------------------------------------------
    this.add
      .text(width / 2, height * 0.22, 'MATCH MODE', {
        fontFamily: 'monospace',
        fontSize: '56px',
        color: '#e8e8f0',
      })
      .setOrigin(0.5);

    // ---- Mode row ----------------------------------------------------------
    // The two largest controls — mode and the active quantity — are
    // drawn as monospace lines so the "← STOCK →" / "← 3 stocks →"
    // shape reads as a wheel-style selector without any custom widgets.
    this.modeRow = this.add
      .text(width / 2, height * 0.42, '', {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: '#6cf0c2',
      })
      .setOrigin(0.5);

    this.quantityRow = this.add
      .text(width / 2, height * 0.52, '', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: '#a0a0b8',
      })
      .setOrigin(0.5);

    // ---- Help / hint footer -----------------------------------------------
    this.add
      .text(
        width / 2,
        height * 0.66,
        '< / >  toggle mode      ^ / v  change amount',
        {
          fontFamily: 'monospace',
          fontSize: '18px',
          color: '#888899',
        },
      )
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        height * 0.74,
        '[ENTER] start match     [ESC] back to menu',
        {
          fontFamily: 'monospace',
          fontSize: '18px',
          color: '#888899',
        },
      )
      .setOrigin(0.5);

    // First paint after the text objects exist.
    this.refreshLabels();

    // ---- Key bindings ------------------------------------------------------
    // Use `keydown-XXXX` listeners so each press fires exactly once
    // — `addCapture` was already done in BootScene so the browser
    // won't scroll the page when the player taps arrow keys.
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-LEFT', () => this.handleModeCycle(-1));
      kb.on('keydown-RIGHT', () => this.handleModeCycle(+1));
      kb.on('keydown-UP', () => this.handleQuantityCycle(+1));
      kb.on('keydown-DOWN', () => this.handleQuantityCycle(-1));
      kb.on('keydown-ENTER', () => this.handleConfirm());
      kb.on('keydown-ESC', () => this.handleCancel());
    }

    // SHUTDOWN runs when this scene is replaced by another; clean up
    // listeners so a re-entry doesn't double-fire.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.removeAllListeners();
    });
  }

  // -------------------------------------------------------------------------
  // Public test seam
  // -------------------------------------------------------------------------

  /**
   * Read-only snapshot of the live mode-select state. Exposed so tests
   * + a future "rematch" path can query the previously-confirmed
   * selection without poking private fields.
   */
  getState(): ModeSelectState {
    return this.state;
  }

  // -------------------------------------------------------------------------
  // Input handlers — every one is a single forward into the pure helper
  // -------------------------------------------------------------------------

  private handleModeCycle(direction: number): void {
    const next = cycleMode(this.state, direction);
    if (next === this.state) return;
    this.state = next;
    this.refreshLabels();
  }

  private handleQuantityCycle(direction: number): void {
    const next = cycleQuantity(this.state, direction);
    if (next === this.state) return;
    this.state = next;
    this.refreshLabels();
  }

  private handleConfirm(): void {
    const matchConfig = this.buildConfirmedMatchConfig();
    // AC 20104 Sub-AC 4 — funnel through `StageSelectScene` so the
    // player picks the arena (built-in OR a saved custom stage) after
    // locking in the match shape. `StageSelectScene` then forwards
    // through to `CharacterSelectScene`, which replaces the synthesised
    // default lineup with its own. The custom-stage payload (when the
    // player picks a saved stage) rides through both scenes via the
    // typed scene-data so `MatchScene` can build the runtime layout
    // without re-reading `localStorage`.
    //
    // AC 2 Sub-AC 5 — when the lobby populated `pendingLobby`, the
    // payload rides through the same scene-data chain so the
    // downstream character-select scene can pre-light up the joined
    // slots without making the player Press Start a second time.
    this.scene.start('StageSelectScene', {
      pendingMatchConfig: matchConfig,
      lobby: this.pendingLobby,
    });
  }

  private handleCancel(): void {
    this.scene.start('MainMenuScene');
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private refreshLabels(): void {
    if (this.modeRow) {
      this.modeRow.setText(`<  ${formatModeLabel(this.state.mode)}  >`);
    }
    if (this.quantityRow) {
      this.quantityRow.setText(`^  ${formatQuantityLabel(this.state)}  v`);
    }
  }

  // -------------------------------------------------------------------------
  // MatchConfig synthesis
  // -------------------------------------------------------------------------

  /**
   * Build the canonical `MatchConfig` for the confirmed selection.
   * The mode + per-mode quantity come from `this.state`; the rest of
   * the fields (stage, players, RNG seed) come from the boot defaults
   * that the M1 scaffold's `MatchScene.resolveActiveMatchConfig`
   * would synthesise — so `ModeSelectScene` only OVERRIDES mode-related
   * fields and otherwise behaves identically to dev-mode.
   *
   * Future milestones (M2 character select, M2 stage select) will
   * extend this method to read player + stage choices from earlier
   * scenes; for AC 11 the focus is on the Stock-vs-Time toggle alone.
   */
  private buildConfirmedMatchConfig(): MatchConfig {
    // AC 2 Sub-AC 5 — when a lobby hand-off is present, build the
    // initial player lineup from its joined slots so a 4-player lobby
    // is honoured all the way through. Otherwise fall back to the
    // legacy P1+P2 default for direct-launch / smoke-test paths.
    const players: ReadonlyArray<PlayerSlot> = this.pendingLobby
      ? buildPlayerSlotsFromLobby({
          // The hand-off payload only carries joined slots; the
          // helper expects a full 4-slot LobbyState to project. We
          // synthesise un-joined entries for missing indices so the
          // projection drops them deterministically.
          slots: this.expandLobbySlotsForProjection(this.pendingLobby),
        } as LobbyState)
      : Object.freeze([
          Object.freeze({
            index: 1 as const,
            characterId: 'wolf' as const,
            paletteIndex: 0,
            inputType: 'keyboard_p1' as const,
          }),
          Object.freeze({
            index: 2 as const,
            characterId: 'cat' as const,
            paletteIndex: 0,
            inputType: 'keyboard_p2' as const,
          }),
        ]);

    const registrySeed = this.registry.get(BOOT_REGISTRY_KEYS.rngSeed) as
      | number
      | undefined;
    const rngSeed =
      typeof registrySeed === 'number' && Number.isFinite(registrySeed)
        ? registrySeed
        : GAME_CONFIG.defaultRngSeed;

    return buildMatchConfigFromState(this.state, {
      stageId: FLAT_STAGE.id,
      players,
      rngSeed,
    });
  }

  /**
   * Expand a {@link LobbyHandoffPayload}'s joined-only slot list into
   * the full 4-entry `LobbyState['slots']` shape that
   * `buildPlayerSlotsFromLobby` expects. Missing indices are filled
   * with un-joined placeholders so the projection drops them.
   */
  private expandLobbySlotsForProjection(
    handoff: LobbyHandoffPayload,
  ): LobbyState['slots'] {
    const joinedByIndex = new Map<1 | 2 | 3 | 4, LobbyHandoffPayload['slots'][number]>();
    for (const slot of handoff.slots) {
      joinedByIndex.set(slot.index, slot);
    }
    return Object.freeze(
      ([1, 2, 3, 4] as const).map((index) => {
        const joined = joinedByIndex.get(index);
        if (joined) return joined;
        return Object.freeze({
          index,
          joined: false,
          inputType: null,
        }) as LobbyState['slots'][number];
      }),
    );
  }
}
