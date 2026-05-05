import Phaser from 'phaser';
import { customStageRuntimeId } from '../stages';
import {
  listCustomStages,
  loadCustomStage,
  type CustomStageData,
} from '../builder';
import type { CharacterSelectSceneData } from './CharacterSelectScene';
import type { LobbyHandoffPayload } from './lobby';
import type { MatchConfig, PlayerSlot } from '../types';
import {
  buildStageSelectEntries,
  cycleStageCursor,
  type StageSelectEntry,
} from './stageSelect';

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

    // Title.
    this.add
      .text(width / 2, height * 0.1, 'STAGE SELECT', {
        fontFamily: 'monospace',
        fontSize: '48px',
        color: '#e8e8f0',
      })
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        height * 0.16,
        'Pick the arena. Custom stages from the builder list under the canonical five.',
        {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#888899',
        },
      )
      .setOrigin(0.5);

    // ---- Stage list -------------------------------------------------------
    const startY = height * 0.24;
    const lineHeight = 36;
    this.rowTexts = [];
    for (let i = 0; i < this.entries.length; i += 1) {
      const entry = this.entries[i]!;
      const txt = this.add
        .text(
          width / 2,
          startY + i * lineHeight,
          this.formatRowLabel(entry),
          {
            fontFamily: 'monospace',
            fontSize: '22px',
            color: '#a0a0b8',
          },
        )
        .setOrigin(0.5);
      this.rowTexts.push(txt);
    }

    // ---- Subtitle (description of the highlighted entry) ------------------
    this.subtitleText = this.add
      .text(width / 2, height * 0.82, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#9aa0b6',
      })
      .setOrigin(0.5);

    // ---- Footer hint ------------------------------------------------------
    this.add
      .text(
        width / 2,
        height * 0.9,
        '^ / v select stage    [ENTER] confirm    [ESC] back',
        {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#888899',
        },
      )
      .setOrigin(0.5);

    this.refreshHighlight();

    // ---- Key bindings ----------------------------------------------------
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-UP', () => this.handleCursor(-1));
      kb.on('keydown-DOWN', () => this.handleCursor(+1));
      kb.on('keydown-ENTER', () => this.handleConfirm());
      kb.on('keydown-ESC', () => this.handleCancel());
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.removeAllListeners();
    });
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
      this.startCharacterSelect(entry.id, undefined);
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
    this.startCharacterSelect(
      customStageRuntimeId(entry.slotId),
      loaded.value,
    );
  }

  /**
   * AC 20403 Sub-AC 3 — back-navigation. The stage select scene is
   * entered FROM `ModeSelectScene` (which itself was entered from
   * `LobbyScene`). The cancel transition forwards the lobby hand-off
   * payload back to `ModeSelectScene` so the player's lobby acquisition
   * (joined slots, input-type assignments, AI difficulties) survives
   * the round-trip — without this threading, ESC would silently drop
   * the persisted roster data on the floor and force the player to
   * Press Start again from the main-menu lobby.
   *
   * Determinism: pure routing — no `Math.random()`, no wall-clock.
   * Same input scene-data → same scene-start payload byte-identically.
   */
  private handleCancel(): void {
    this.scene.start('ModeSelectScene', { lobby: this.pendingLobby });
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
  // Forwarding to character select
  // -------------------------------------------------------------------------

  /**
   * Forward the picked stage into the character select scene.
   *
   * `customStage`, when supplied, is the loaded saved-stage blob the
   * match scene needs to reconstruct the runtime `StageLayout`. It is
   * carried separately from the `MatchConfig` because the config
   * itself is JSON-serialisable / replay-header-safe — embedding the
   * blob inside it would bloat replay headers and force every replay
   * tooling consumer to track the schema.
   */
  private startCharacterSelect(
    stageId: string,
    customStage: CustomStageData | undefined,
  ): void {
    const players: ReadonlyArray<PlayerSlot> =
      this.pendingMatchConfig?.players ?? [];
    const pendingMatchConfig: NonNullable<
      CharacterSelectSceneData['pendingMatchConfig']
    > = this.pendingMatchConfig
      ? {
          ...this.pendingMatchConfig,
          stageId,
          players,
        }
      : ({
          mode: 'stocks',
          stockCount: 3,
          stageId,
          players,
          rngSeed: 0,
        } as NonNullable<CharacterSelectSceneData['pendingMatchConfig']>);

    this.scene.start('CharacterSelectScene', {
      pendingMatchConfig,
      customStage,
      lobby: this.pendingLobby,
    });
  }
}
