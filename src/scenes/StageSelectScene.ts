import Phaser from 'phaser';
import { customStageRuntimeId } from '../stages';
import {
  listCustomStages,
  loadCustomStage,
  type CustomStageData,
} from '../builder';
import type { LobbyHandoffPayload } from './lobby';
import type { MatchConfig, PlayerSlot } from '../types';
import {
  buildStageSelectEntries,
  cycleStageCursor,
  type StageSelectEntry,
} from './stageSelect';
// AC 20203 Sub-AC 3 — canonical "saved stage id → live match" launcher.
// The confirm path delegates the deserializer load + scene-start payload
// build to this helper so a single source of truth handles every entry
// point.
import {
  launchCustomStageMatchInScene,
  type CustomStageMatchLaunchResult,
} from './customStageMatchLauncher';
import {
  MENU_COLORS_CSS,
  MENU_FONT,
  paintFooterHints,
  paintMenuBackground,
  paintMenuTitle,
  paintPanel,
} from '../ui/menuTheme';
import { MenuPadNav } from '../ui/menuPadNav';

// Re-export the pure-helper symbols so call sites that import the
// scene file get the entry-builder + entry types without having to
// know about the helper module split.
export {
  BUILT_IN_STAGE_ENTRIES,
  buildStageSelectEntries,
  cycleStageCursor,
} from './stageSelect';
export type {
  BuiltInStageEntry,
  CustomStageEntry,
  StageSelectEntry,
} from './stageSelect';

/**
 * StageSelectScene — AC 20104 Sub-AC 4.
 *
 * Sub-AC 4 of AC 20104: "Wire saved-stage loader into match flow so a
 * custom stage can be selected and played as a live match."
 *
 * Sits between `ModeSelectScene` (mode/stocks/timer) and
 * `CharacterSelectScene` (fighter / palette pick) so the player picks
 * the arena before the lineup. The screen lists every stage the match
 * flow can launch:
 *
 *   • Five built-in stages, in canonical order:
 *       0. Flat (Battlefield-style, no hazards).
 *       1. Lava (rising/falling instant-KO pools).
 *       2. Wind (gust corridor).
 *       3. Crumbling (timed pass-through floats).
 *       4. Moving Platform (ferries across a pit).
 *
 *   • Every custom stage saved to `localStorage` via the M3 stage
 *     builder, listed below the built-ins. The list is read once at
 *     `create()` time via `listCustomStages()`, so a save the player
 *     just made through the builder appears the next time they walk
 *     into the stage select.
 *
 * Selection logic
 * ---------------
 *
 *   • UP / DOWN cycle the highlighted entry (wraps both ways).
 *   • ENTER confirms — for built-in stages we forward the registry id
 *     through to the character select scene. For a custom stage we
 *     load the saved blob via `loadCustomStage(slotId)` AND pass the
 *     loaded `CustomStageData` through the scene-data payload so the
 *     match scene doesn't have to re-read `localStorage` after the
 *     character select round-trip.
 *   • ESC backs out to the mode select.
 *
 * Why a dedicated scene
 * ---------------------
 *
 * Per the project's `code_architecture` evaluation principle, scenes
 * stay thin. This scene only owns:
 *
 *   1. The cursor index (the highlighted entry).
 *   2. The list-render hook on UP/DOWN/ENTER/ESC.
 *   3. The "load the custom stage blob" step on ENTER, which wraps
 *      the (already Phaser-free) `loadCustomStage` storage layer.
 *
 * The actual conversion from `CustomStageData` → runtime `StageLayout`
 * lives in `src/stages/customStageLoader.ts` and is unit-tested under
 * plain Node — this scene never reaches into pieces / hazards.
 *
 * Determinism note: nothing in this scene reads `Math.random()` or
 * the wall clock. The cursor index is integer arithmetic; the list of
 * custom stages is a deterministic snapshot of the storage layer at
 * the moment the scene opens.
 */
export interface StageSelectSceneData {
  /**
   * Partial `MatchConfig` carried from `ModeSelectScene`. The
   * `stageId` field is *replaced* on confirm with the picked stage's
   * id (built-in id or `'custom:<slot-id>'` for saved stages).
   */
  readonly pendingMatchConfig?: Omit<MatchConfig, 'players'> & {
    readonly players?: ReadonlyArray<PlayerSlot>;
  };
  /**
   * AC 2 Sub-AC 5 — lobby payload carried from `LobbyScene` via
   * `ModeSelectScene`. Threaded through to `CharacterSelectScene` on
   * confirm so the downstream lobby pre-lights the joined slots.
   */
  readonly lobby?: LobbyHandoffPayload;
}

export class StageSelectScene extends Phaser.Scene {
  private pendingMatchConfig: StageSelectSceneData['pendingMatchConfig'] =
    undefined;

  /**
   * AC 2 Sub-AC 5 — lobby payload forwarded from `ModeSelectScene`.
   * Threaded into the `CharacterSelectScene` start payload on confirm.
   */
  private pendingLobby: LobbyHandoffPayload | undefined = undefined;

  private entries: ReadonlyArray<StageSelectEntry> = [];

  private cursorIndex = 0;

  private rowTexts: Phaser.GameObjects.Text[] = [];

  private subtitleText!: Phaser.GameObjects.Text;

  /** Shared gamepad poller so pad-only players can navigate the menu. */
  private padNav: MenuPadNav | undefined = undefined;

  constructor() {
    super({ key: 'StageSelectScene' });
  }

  init(data?: StageSelectSceneData): void {
    this.pendingMatchConfig = data?.pendingMatchConfig;
    this.pendingLobby = data?.lobby;
    this.entries = buildStageSelectEntries(listCustomStages());
    this.cursorIndex = 0;
    this.rowTexts = [];
  }

  create(): void {
    const { width, height } = this.scale.gameSize;

    // ---- Background + title -------------------------------------------------
    paintMenuBackground(this);
    paintMenuTitle(this, width / 2, height * 0.09, 'Stage Select', {
      fontSize: 44,
      subtitle:
        'Pick the arena — custom stages from the builder list under the canonical five.',
    });

    // ---- Stage list panel ---------------------------------------------------
    const startY = height * 0.25;
    const lineHeight = 38;
    const listHeight = Math.max(1, this.entries.length) * lineHeight + 40;
    paintPanel(
      this,
      width / 2,
      startY + (this.entries.length - 1) * lineHeight * 0.5,
      Math.min(720, width * 0.6),
      listHeight,
    );
    this.rowTexts = [];
    for (let i = 0; i < this.entries.length; i += 1) {
      const entry = this.entries[i]!;
      const txt = this.add
        .text(
          width / 2,
          startY + i * lineHeight,
          this.formatRowLabel(entry),
          {
            fontFamily: MENU_FONT,
            fontSize: '22px',
            color: MENU_COLORS_CSS.textSecondary,
          },
        )
        .setOrigin(0.5);
      this.rowTexts.push(txt);
    }

    // ---- Subtitle (description of the highlighted entry) ------------------
    this.subtitleText = this.add
      .text(width / 2, height * 0.82, '', {
        fontFamily: MENU_FONT,
        fontSize: '16px',
        color: MENU_COLORS_CSS.textSecondary,
      })
      .setOrigin(0.5);

    // ---- Footer hint ------------------------------------------------------
    paintFooterHints(this, height * 0.9, [
      '˄ / ˅  select stage',
      '[ENTER] / Ⓐ  fight',
      '[ESC] / Ⓑ  back to fighters',
    ]);

    this.refreshHighlight();

    // ---- Key bindings ----------------------------------------------------
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-UP', () => this.handleCursor(-1));
      kb.on('keydown-DOWN', () => this.handleCursor(+1));
      kb.on('keydown-ENTER', () => this.handleConfirm());
      kb.on('keydown-ESC', () => this.handleCancel());
    }

    this.padNav = new MenuPadNav(this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.removeAllListeners();
    });
  }

  update(): void {
    const pad = this.padNav?.poll();
    if (!pad) return;
    if (pad.up) this.handleCursor(-1);
    if (pad.down) this.handleCursor(+1);
    if (pad.confirm) this.handleConfirm();
    else if (pad.back) this.handleCancel();
  }

  // -------------------------------------------------------------------------
  // Public test seam
  // -------------------------------------------------------------------------

  /** Read-only snapshot of the live entries list. */
  getEntries(): ReadonlyArray<StageSelectEntry> {
    return this.entries;
  }

  /** Read-only cursor position. */
  getCursorIndex(): number {
    return this.cursorIndex;
  }

  // -------------------------------------------------------------------------
  // Input handlers
  // -------------------------------------------------------------------------

  private handleCursor(direction: number): void {
    if (this.entries.length === 0) return;
    const next = cycleStageCursor(
      this.cursorIndex,
      direction,
      this.entries.length,
    );
    if (next === this.cursorIndex) return;
    this.cursorIndex = next;
    this.refreshHighlight();
  }

  private handleConfirm(): void {
    const entry = this.entries[this.cursorIndex];
    if (!entry) return;
    if (entry.kind === 'built-in') {
      this.startMatch(entry.id, undefined);
      return;
    }
    // Custom stage — eagerly load the saved blob so the match scene
    // doesn't have to re-read localStorage. A failed load surfaces in
    // the subtitle so the player can pick a different stage.
    const loaded = loadCustomStage(entry.slotId);
    if (!loaded.ok) {
      this.subtitleText.setText(
        `Could not load '${entry.displayName}': ${loaded.code}`,
      );
      this.subtitleText.setColor('#ff5a3c');
      return;
    }
    this.startMatch(customStageRuntimeId(entry.slotId), loaded.value);
  }

  /**
   * Back-navigation. The stage select is the LAST screen in the Smash-
   * style flow (Mode → Character → Stage → Match), so ESC returns to
   * `CharacterSelectScene` with the pending payload intact — the
   * lineup the player just built survives the round-trip.
   *
   * Determinism: pure routing — no `Math.random()`, no wall-clock.
   * Same input scene-data → same scene-start payload byte-identically.
   */
  private handleCancel(): void {
    this.scene.start('CharacterSelectScene', {
      pendingMatchConfig: this.pendingMatchConfig,
      lobby: this.pendingLobby,
    });
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private formatRowLabel(entry: StageSelectEntry): string {
    const tag = entry.kind === 'custom' ? '[custom] ' : '          ';
    return `${tag}${entry.displayName}`;
  }

  private refreshHighlight(): void {
    for (let i = 0; i < this.rowTexts.length; i += 1) {
      const row = this.rowTexts[i];
      if (!row) continue;
      const isActive = i === this.cursorIndex;
      row.setColor(isActive ? '#6cf0c2' : '#a0a0b8');
      const entry = this.entries[i];
      if (entry) {
        row.setText(
          isActive ? `>  ${this.formatRowLabel(entry)}  <` : this.formatRowLabel(entry),
        );
      }
    }
    if (this.subtitleText) {
      const entry = this.entries[this.cursorIndex];
      this.subtitleText.setColor('#9aa0b6');
      this.subtitleText.setText(entry ? entry.subtitle : '');
    }
  }

  // -------------------------------------------------------------------------
  // Match launch
  // -------------------------------------------------------------------------

  /**
   * Launch the match with the picked stage. The lineup arrives from
   * `CharacterSelectScene` via `pendingMatchConfig.players` (the
   * Smash-style flow runs fighters first, arena last); direct-launch /
   * smoke-test paths that skip the character select fall back to the
   * legacy P1 Wolf + P2 Cat duo.
   *
   * `customStage`, when supplied, is the loaded saved-stage blob the
   * match scene needs to reconstruct the runtime `StageLayout` — the
   * launch funnels through `launchCustomStageMatchInScene` so a single
   * source of truth handles every custom-stage entry point.
   */
  private startMatch(
    stageId: string,
    customStage: CustomStageData | undefined,
  ): void {
    const matchConfig = this.buildFinalMatchConfig(stageId);
    if (customStage) {
      const result = launchCustomStageMatchInScene(this, {
        savedStageId: stageId,
        matchConfig,
        customStage,
      });
      this.reportCustomStageLaunchOutcome(result);
      return;
    }
    this.scene.start('MatchScene', { matchConfig });
  }

  private reportCustomStageLaunchOutcome(
    result: CustomStageMatchLaunchResult,
  ): void {
    if (result.ok) return;
    this.subtitleText.setText(
      `Could not launch custom stage: ${result.reason} — ${result.message}`,
    );
    this.subtitleText.setColor('#ff5a3c');
  }

  /** Resolve the completed `MatchConfig` for the picked stage id. */
  private buildFinalMatchConfig(stageId: string): MatchConfig {
    const base = this.pendingMatchConfig;
    const players: ReadonlyArray<PlayerSlot> =
      base?.players && base.players.length >= 2
        ? base.players
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
    if (base?.mode === 'time') {
      return Object.freeze({
        mode: 'time',
        stockCount: base.stockCount,
        timeLimitSeconds: base.timeLimitSeconds ?? 180,
        stageId,
        players,
        rngSeed: base.rngSeed,
      }) as MatchConfig;
    }
    return Object.freeze({
      mode: 'stocks',
      stockCount: base?.stockCount ?? 3,
      stageId,
      players,
      rngSeed: base?.rngSeed ?? 0,
    }) as MatchConfig;
  }
}
