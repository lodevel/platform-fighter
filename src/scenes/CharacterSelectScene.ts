import Phaser from 'phaser';
import {
  MAX_PLAYER_SLOTS,
  PALETTE_COUNT,
  SELECTABLE_CHARACTER_SPECS,
  applyLobbyHandoffToCharacterSelect,
  autoAssignDistinctPalettes,
  buildCharacterPortraitGrid,
  buildPlayerSlotsFromState,
  buildSlotPaletteSwatches,
  buildSlotPreview,
  canConfirmMatch,
  type CharacterPortraitGridCell,
  type CharacterSelectPaletteSwatch,
  type CharacterSelectSlotPreview,
  type CharacterSelectState,
} from './characterSelect';
import {
  DEFAULT_HAND_CURSOR_STATE,
  HOVERED_TARGET_NONE,
  buildPlayerSlotsFromHandCursor,
  cycleSlotMode,
  moveHand,
  selectAtCursor,
  setHandPosition,
  setHoveredTarget,
  setSlotMode,
  setSlotPalette,
  toCharacterSelectState,
  unselectSlot,
  type HandCursorBounds,
  type HandCursorState,
  type HoveredTarget,
} from './handCursorState';
import { BOOT_REGISTRY_KEYS } from './bootKeys';
import { GAME_CONFIG } from '../engine/constants';
import { FLAT_STAGE } from '../stages';
import type { CustomStageData } from '../builder';
import type { MatchConfig, PlayerSlot } from '../types';
import type { LobbyHandoffPayload } from './lobby';
// AC 10303 Sub-AC 3 — canonical palette-swap painter. The lobby preview
// runs through the **same** helper the match scene uses so what the
// player sees on the character-select tile (body fill, body stroke,
// facing-arrow accent) is byte-for-byte the same colour pipeline the
// in-match fighter renders with.
import {
  applyPaletteSwap,
  paletteSwapForCharacter,
} from '../characters/PaletteSwapRenderer';
// AC 10303 Sub-AC 3 — shader-pipeline remap descriptor type. The
// runtime palette renderer returns one of these on every paint, and a
// future sprite-atlas drop-in (`applyPaletteSwapPipeline(sprite, remap)`)
// consumes the same descriptor — keeping the type referenced here means
// a maintainer who refactors away the rectangle-painter doesn't have to
// re-derive the colour-pair shape in two places.
import type { PaletteSwapRemap } from '../characters/paletteSwapShader';
// AC 20302 Sub-AC 2 — Runtime palette renderer for the preview path.
// One renderer per scene caches per-slot swaps so the per-frame
// `paintTilePreview` call short-circuits when nothing has changed
// since the last frame.
import { RuntimePaletteRenderer } from '../characters/runtimePaletteRenderer';
import { getCharacterSpec } from '../characters/roster';
import { applySpriteDisplayHeight } from '../characters/visualScale';
// AC 20203 Sub-AC 3 — canonical "saved stage id → live match" launcher.
// The confirm path delegates the deserializer load + scene-start payload
// build to this helper so a single source of truth handles every entry
// point.
import {
  launchCustomStageMatchInScene,
  type CustomStageMatchLaunchResult,
} from './customStageMatchLauncher';

/**
 * CharacterSelectScene — Smash-Bros-style hand-cursor character select.
 *
 * Replaces the prior keyboard-driven per-slot navigation with a free-
 * roaming "hand" cursor model. Each slot owns a coloured hand sprite
 * (P1 red, P2 blue, P3 green, P4 yellow) that the player drives with
 * their gamepad d-pad / left stick. The OS mouse pointer is the
 * convenience fallback for keyboard slots — no keyboard arrow nav.
 *
 * Mechanics
 * ---------
 *   • Move hand over a roster portrait → press LIGHT ATTACK (gamepad
 *     A / mouse left-click) → that slot locks the character.
 *   • Move hand over a slot tile's MODE button → press LIGHT ATTACK
 *     → cycles `Empty → Human → Bot → Empty`. Mouse click works too.
 *   • Move hand over a slot tile's PALETTE strip → press LIGHT ATTACK
 *     → cycles palette by +1. Mouse click on a specific swatch sets
 *     the palette index directly.
 *   • Press SPECIAL ATTACK (gamepad B / mouse right-click) → un-locks
 *     the slot's pick (the slot stays human/bot, just no fighter).
 *   • Same character allowed — palettes auto-shift to stay distinct
 *     (the {@link selectAtCursor} reducer routes through
 *     {@link nextFreePaletteIndex} on collision; AC 13 Sub-AC 4).
 *
 * Contract surface preserved from the legacy keyboard scene
 * --------------------------------------------------------
 *   • `init(data?: CharacterSelectSceneData)` — same `pendingMatchConfig`
 *     / `customStage` / `lobby` payload shape.
 *   • `scene.start('MatchScene', { matchConfig })` on confirm — same
 *     `MatchConfig` shape; lineup synthesised via
 *     {@link buildPlayerSlotsFromHandCursor} (which reuses
 *     {@link buildPlayerSlotsFromState} under the hood, so the
 *     downstream `PlayerSlot[]` is byte-identical).
 *   • `scene.start('StageSelectScene', { pendingMatchConfig, lobby })`
 *     on cancel — back-nav threads the same payload (AC 20304 Sub-AC 4).
 *   • `launchCustomStageMatchInScene` for custom-stage launches.
 *   • Lobby-handoff hydration via
 *     {@link applyLobbyHandoffToCharacterSelect} so a player who
 *     pressed Start in the lobby walks in pre-joined.
 *
 * Determinism
 * -----------
 * The hand-cursor state machine is a pure reducer (see
 * `handCursorState.ts`). Two scenes that received the same gamepad /
 * mouse input frames in the same order produce byte-identical
 * `PlayerSlot[]` arrays, so the replay header / smoke-test harness
 * keeps working unchanged.
 */
export interface CharacterSelectSceneData {
  readonly pendingMatchConfig?: Omit<MatchConfig, 'players'> & {
    readonly players?: ReadonlyArray<PlayerSlot>;
  };
  readonly customStage?: CustomStageData;
  readonly lobby?: LobbyHandoffPayload;
}

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

/**
 * Per-slot hand cursor body colour. Mirrors the legacy scene's slot
 * accent palette (P1 red / P2 blue / P3 green / P4 yellow) so the
 * tile colours and the hand colours stay in lockstep.
 */
const SLOT_HAND_COLOURS: Readonly<Record<1 | 2 | 3 | 4, number>> = Object.freeze({
  1: 0xff5a5a,
  2: 0x5a8cff,
  3: 0x6cf0a8,
  4: 0xffd166,
});

/** Hand cursor outline colour — high-contrast white so the hand reads on dark backgrounds. */
const HAND_OUTLINE_COLOUR = 0xffffff;

/** Cursor speed for gamepad-driven hands, in scene px per frame at unit stick deflection. */
const HAND_GAMEPAD_SPEED_PX_PER_FRAME = 9;

/** Dead-zone for analog stick / d-pad input. Below this, no movement. */
const HAND_GAMEPAD_DEADZONE = 0.15;

// ---------------------------------------------------------------------------
// Local game-object cache types — mutated in place by refresh helpers
// ---------------------------------------------------------------------------

interface SlotTileGameObjects {
  readonly container: Phaser.GameObjects.Container;
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly nameLabel: Phaser.GameObjects.Text;
  readonly roleLabel: Phaser.GameObjects.Text;
  readonly bodyRect: Phaser.GameObjects.Rectangle;
  readonly facingMark: Phaser.GameObjects.Triangle;
  readonly paletteLabel: Phaser.GameObjects.Text;
  readonly swatches: Phaser.GameObjects.Rectangle[];
  readonly modeButton: Phaser.GameObjects.Rectangle;
  readonly modeButtonLabel: Phaser.GameObjects.Text;
  readonly inputTypeLabel: Phaser.GameObjects.Text;
  /** World-space rect for hit-testing the mode button. */
  readonly modeButtonBounds: Phaser.Geom.Rectangle;
  /** World-space rects for hit-testing palette swatches (parallel to `swatches`). */
  readonly swatchBounds: Phaser.Geom.Rectangle[];
  /** "MOUSE" badge — visible when this slot is the focused mouse target. */
  readonly mouseFocusBadge: Phaser.GameObjects.Text;
  /**
   * Real-sprite preview for the slot's picked character. Mirrors the
   * portrait grid — when the character has a loaded atlas, we paint
   * its idle frame here on top of the rect; otherwise the rect IS
   * the preview (procedural-fallback path).
   */
  readonly bodySprite: Phaser.GameObjects.Sprite;
  /** Target display height for `bodySprite` — preserved across texture swaps. */
  readonly bodySpriteDisplayHeight: number;
}

interface PortraitTileGameObjects {
  readonly container: Phaser.GameObjects.Container;
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly bodyRect: Phaser.GameObjects.Rectangle;
  /** Real-sprite portrait for characters with a loaded atlas. */
  readonly bodySprite: Phaser.GameObjects.Sprite;
  /** Target display height for `bodySprite`. */
  readonly bodySpriteDisplayHeight: number;
  readonly nameLabel: Phaser.GameObjects.Text;
  readonly hoverFrame: Phaser.GameObjects.Rectangle;
  readonly hoverBadge: Phaser.GameObjects.Text;
  readonly slotChips: Phaser.GameObjects.Rectangle[];
  /** World-space rect for hit-testing the portrait. */
  readonly bounds: Phaser.Geom.Rectangle;
}

interface HandCursorGameObjects {
  readonly container: Phaser.GameObjects.Container;
  readonly outline: Phaser.GameObjects.Triangle;
  readonly fill: Phaser.GameObjects.Triangle;
  readonly label: Phaser.GameObjects.Text;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export class CharacterSelectScene extends Phaser.Scene {
  /** Source-of-truth selection state. */
  private state: HandCursorState = DEFAULT_HAND_CURSOR_STATE;

  private pendingMatchConfig: CharacterSelectSceneData['pendingMatchConfig'] = undefined;
  private pendingCustomStage: CustomStageData | undefined = undefined;
  private pendingLobby: LobbyHandoffPayload | undefined = undefined;

  private tiles: SlotTileGameObjects[] = [];
  private portraitTiles: PortraitTileGameObjects[] = [];
  private hands: HandCursorGameObjects[] = [];

  private lobbyStatusLabel: Phaser.GameObjects.Text | undefined = undefined;

  private paletteRenderer: RuntimePaletteRenderer = new RuntimePaletteRenderer();

  /** Cached scene viewport for cursor clamp bounds. Re-derived on resize. */
  private cursorBounds: HandCursorBounds = {
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
  };

  /**
   * Per-slot gamepad button-press latches — gamepad polling is level-
   * triggered (`buttons[i].pressed` stays `true` while held), so we
   * track the previous frame's pressed state to derive an edge-trigger
   * for "press" events (vs "held").
   */
  private gamepadButtonLatches: Map<number, { light: boolean; special: boolean }> =
    new Map();

  /**
   * Slot the mouse pointer is currently acting on. Defaults to slot 1
   * so the very first mouse click already does something. Re-aimed
   * whenever the user clicks a slot tile's body area (the "I'm
   * controlling slot N now" gesture). Right-click and portrait clicks
   * route through this slot.
   */
  private focusedMouseSlotIndex: 1 | 2 | 3 | 4 = 1;

  /**
   * World-space rect for the "REBIND INPUTS" button. Hit-tested by the
   * DOM-level mousedown router so the user can navigate to the
   * `RebindingScene` from the char-select page.
   */
  private rebindButtonBounds: Phaser.Geom.Rectangle = new Phaser.Geom.Rectangle(0, 0, 0, 0);

  constructor() {
    super({ key: 'CharacterSelectScene' });
  }

  init(data?: CharacterSelectSceneData): void {
    this.pendingMatchConfig = data?.pendingMatchConfig;
    this.pendingCustomStage = data?.customStage;
    this.pendingLobby = data?.lobby;
    // Restore the last-saved selection state if one exists in the
    // registry — a player coming back from a match (or the rebinding
    // menu) should walk back into the lobby with their picks intact.
    // Falls back to the default when this is the first entry.
    const restored = this.registry.get(BOOT_REGISTRY_KEYS.lastCharacterSelectState) as
      | HandCursorState
      | undefined;
    this.state = restored ?? DEFAULT_HAND_CURSOR_STATE;
    // AC 2 Sub-AC 5 — hydrate joined / inputType from the lobby
    // hand-off payload when present so the player isn't asked to
    // Press Start a second time. The lobby handoff only touches
    // join / inputType / aiDifficulty fields, so a restored state's
    // characters and palettes survive the re-application.
    if (data?.lobby) {
      const seeded = applyLobbyHandoffToCharacterSelect(
        toCharacterSelectState(this.state),
        data.lobby,
      );
      this.state = adoptCharacterSelectState(this.state, seeded);
    }
  }

  create(): void {
    const { width, height } = this.scale.gameSize;
    this.cursorBounds = { minX: 0, maxX: width, minY: 0, maxY: height };

    // ---- Title -------------------------------------------------------------
    this.add
      .text(width / 2, height * 0.04, 'CHARACTER SELECT', {
        fontFamily: 'monospace',
        fontSize: '36px',
        color: '#e8e8f0',
      })
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        height * 0.085,
        'Move your hand with the gamepad — press LIGHT ATTACK to pick',
        {
          fontFamily: 'monospace',
          fontSize: '20px',
          color: '#888899',
        },
      )
      .setOrigin(0.5);

    // AC 10304 Sub-AC 4 — lobby-status header ("X joined, Y ready").
    this.lobbyStatusLabel = this.add
      .text(width / 2, height * 0.115, '', {
        fontFamily: 'monospace',
        fontSize: '21px',
        color: '#888899',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    // ---- Character portraits grid ------------------------------------------
    this.add
      .text(width / 2, height * 0.145, '— AVAILABLE CHARACTERS —', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#6cf0c2',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const portraitCount = SELECTABLE_CHARACTER_SPECS.length;
    const tileSize = 96;
    const tileSpacing = 8;
    const cellsPerRow = Math.max(
      1,
      Math.min(portraitCount, Math.floor((width - 80) / (tileSize + tileSpacing))),
    );
    const rowsNeeded = Math.ceil(portraitCount / cellsPerRow);
    const gridWidth = cellsPerRow * tileSize + (cellsPerRow - 1) * tileSpacing;
    const gridLeft = (width - gridWidth) / 2;
    const gridTop = height * 0.18;

    this.portraitTiles = [];
    for (let i = 0; i < portraitCount; i += 1) {
      const col = i % cellsPerRow;
      const row = Math.floor(i / cellsPerRow);
      const px = gridLeft + col * (tileSize + tileSpacing) + tileSize / 2;
      const py = gridTop + row * (tileSize + tileSpacing) + tileSize / 2;
      this.portraitTiles.push(this.buildPortraitTile(px, py, tileSize, i));
    }

    // ---- Slot tiles --------------------------------------------------------
    const tileWidth = Math.min(280, (width - 80) / MAX_PLAYER_SLOTS);
    const tileHeight = Math.min(380, height * 0.45);
    const tileGap = (width - tileWidth * MAX_PLAYER_SLOTS) / (MAX_PLAYER_SLOTS + 1);
    const tileTop = gridTop + rowsNeeded * (tileSize + tileSpacing) + 50;

    this.add
      .text(width / 2, tileTop - height * 0.025, '— YOUR PICK —', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffd166',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.tiles = [];
    for (let i = 0; i < MAX_PLAYER_SLOTS; i += 1) {
      const tileX = tileGap + i * (tileWidth + tileGap) + tileWidth / 2;
      const tileY = tileTop + tileHeight / 2;
      this.tiles.push(this.buildSlotTile(tileX, tileY, tileWidth, tileHeight, i));
    }

    // ---- Hand cursors (drawn last so they sit on top) ----------------------
    this.hands = [];
    // Park each hand in a quadrant so they don't all stack on (0, 0).
    const quadCentres: ReadonlyArray<{ x: number; y: number }> = [
      { x: width * 0.25, y: height * 0.4 },
      { x: width * 0.75, y: height * 0.4 },
      { x: width * 0.25, y: height * 0.7 },
      { x: width * 0.75, y: height * 0.7 },
    ];
    for (let i = 0; i < MAX_PLAYER_SLOTS; i += 1) {
      const slotIndex = (i + 1) as 1 | 2 | 3 | 4;
      this.hands.push(this.buildHandCursor(slotIndex));
      const start = quadCentres[i] ?? { x: width / 2, y: height / 2 };
      this.state = setHandPosition(this.state, slotIndex, start, this.cursorBounds);
    }

    // ---- Rebind-inputs button (clickable via DOM router below) -------------
    const rebindLabel = this.add
      .text(width / 2, height * 0.88, '[ REBIND INPUTS ]', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#0a0a14',
        fontStyle: 'bold',
        backgroundColor: '#6cf0c2',
        padding: { left: 10, right: 10, top: 4, bottom: 4 },
      })
      .setOrigin(0.5);
    const rebindBounds = rebindLabel.getBounds();
    this.rebindButtonBounds = new Phaser.Geom.Rectangle(
      rebindBounds.x,
      rebindBounds.y,
      rebindBounds.width,
      rebindBounds.height,
    );

    // ---- Footer hint -------------------------------------------------------
    this.add
      .text(
        width / 2,
        height * 0.93,
        'LIGHT ATTACK = add / pick    SPECIAL ATTACK = remove    [ENTER] start    [ESC] back',
        {
          fontFamily: 'monospace',
          fontSize: '18px',
          color: '#888899',
        },
      )
      .setOrigin(0.5);
    // In-match controls reminder. Dodge has its own dedicated button
    // separate from shield (a question players hit when shield + dodge
    // were the same gesture). Read from the live bindings store so
    // remapping is reflected — fall back to a generic message when
    // no store has been hydrated (smoke-test / direct-launch path).
    this.add
      .text(width / 2, height * 0.965, this.buildInMatchControlsHint(), {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#666677',
      })
      .setOrigin(0.5);

    // ---- Input wiring ------------------------------------------------------
    // Apply the same fix RebindingScene uses for the Phaser-input-after-
    // scene-start bug: explicitly re-enable the input plugin, force
    // canvas focus so DOM keydown / mousedown listeners aren't dormant,
    // and route clicks through a DOM-level mousedown handler instead of
    // Phaser's per-scene InputPlugin (which silently fails to dispatch
    // pointerdown after a `scene.start` from another scene with input
    // enabled — observed and worked around in `RebindingScene.ts`).
    if (this.input) {
      this.input.enabled = true;
      this.input.setTopOnly(false);
    }
    this.input.setDefaultCursor('default');
    // Deliberately NOT calling `disableContextMenu()` — right-click is
    // reserved for the browser's native menu (paste, inspect, etc.).
    // Cancel-pick goes through the per-slot CLEAR button and the
    // BACKSPACE keyboard shortcut instead.
    const canvas = this.game.canvas;
    if (canvas) {
      if (canvas.tabIndex < 0) canvas.tabIndex = 0;
      canvas.style.outline = 'none';
      canvas.focus();
    }

    // DOM-level click router — see RebindingScene's `domHandler` for
    // the original of this pattern. Converts client coords to canvas
    // coords (accounting for CSS scaling), routes left / right click
    // to the appropriate handler.
    const domHandler = (e: MouseEvent) => {
      if (!canvas) return;
      // Ignore non-left clicks so right-click stays available for the
      // browser's native context menu.
      if (e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;
      this.handleMouseDownAt(cx, cy);
    };
    canvas.addEventListener('mousedown', domHandler);
    // Also keep Phaser's pointerdown as a belt-and-braces fallback —
    // it'll fire when the InputPlugin IS dispatching, and our handler
    // is idempotent enough that a double-fire on the same pixel just
    // re-runs `cycleSlotMode` once (no, twice — guard against that).
    // We skip Phaser's pointerdown when the DOM handler already fired
    // by gating on a per-frame flag.

    // ---- Keyboard bindings -------------------------------------------------
    // Match RebindingScene's "single keydown handler" pattern instead of
    // per-key `keydown-ENTER` listeners. Per-key listeners suffer from
    // the same scene-transition input dormancy as pointer events; the
    // generic keydown handler stays alive across scene starts because
    // Phaser routes raw KeyboardEvent before per-key dispatch.
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') this.handleConfirm();
      else if (event.key === 'Escape') this.handleCancel();
      else if (event.key === 'Backspace' || event.key === 'Delete') {
        // Cancel the focused slot's pick — replaces the right-click
        // gesture so the browser's native context menu stays available.
        this.state = unselectSlot(this.state, this.focusedMouseSlotIndex);
        this.refreshAllTiles();
        event.preventDefault();
      }
    });

    // First paint after the tile objects exist.
    this.refreshAllTiles();

    // Clean up listeners on shutdown.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.paletteRenderer.resetCache();
      this.gamepadButtonLatches.clear();
      if (canvas) canvas.removeEventListener('mousedown', domHandler);
    });
  }

  // -------------------------------------------------------------------------
  // Per-frame update — gamepad poll + mouse drive + hit-test + repaint
  // -------------------------------------------------------------------------

  update(): void {
    let nextState = this.state;

    // Pump per-slot gamepad input.
    for (const slot of nextState.slots) {
      const padIndex = slot.index - 1;
      const pad = this.input.gamepad?.getPad(padIndex);
      if (!pad) continue;
      // Stick or d-pad.
      const dx = applyDeadzone(pad.axes[0]?.getValue() ?? 0, HAND_GAMEPAD_DEADZONE) +
        (pad.left ? -1 : 0) + (pad.right ? 1 : 0);
      const dy = applyDeadzone(pad.axes[1]?.getValue() ?? 0, HAND_GAMEPAD_DEADZONE) +
        (pad.up ? -1 : 0) + (pad.down ? 1 : 0);
      if (dx !== 0 || dy !== 0) {
        nextState = moveHand(
          nextState,
          slot.index,
          dx * HAND_GAMEPAD_SPEED_PX_PER_FRAME,
          dy * HAND_GAMEPAD_SPEED_PX_PER_FRAME,
          this.cursorBounds,
        );
      }
      // Edge-trigger A (light) / B (special).
      const lightPressed = !!pad.A;
      const specialPressed = !!pad.B;
      const latch = this.gamepadButtonLatches.get(padIndex) ?? {
        light: false,
        special: false,
      };
      if (lightPressed && !latch.light) {
        nextState = selectAtCursor(nextState, slot.index);
      }
      if (specialPressed && !latch.special) {
        nextState = unselectSlot(nextState, slot.index);
      }
      this.gamepadButtonLatches.set(padIndex, {
        light: lightPressed,
        special: specialPressed,
      });
    }

    // Mouse drives the focused mouse slot's hand. The focused slot
    // can be re-aimed by clicking any slot tile's body area, so the
    // mouse user can drive every slot — not just one. Slot 1 is the
    // default focus so the very first click on the screen already
    // does something sensible.
    const pointer = this.input.activePointer;
    if (pointer) {
      nextState = setHandPosition(
        nextState,
        this.focusedMouseSlotIndex,
        { x: pointer.x, y: pointer.y },
        this.cursorBounds,
      );
    }

    // Run the hit-test only for ACTIVE hands — the focused mouse slot
    // and any slot with a connected gamepad. Inactive hands (empty
    // slots without a pad, bots that already auto-picked, idle slots)
    // get HOVERED_TARGET_NONE so their stale cursor positions don't
    // light up phantom "P3 is hovering this character" badges on
    // portrait cells the user never aimed at.
    for (const slot of nextState.slots) {
      const isFocusedMouse = slot.index === this.focusedMouseSlotIndex;
      const padIndex = slot.index - 1;
      const hasGamepad = !!this.input.gamepad?.getPad(padIndex);
      const isActive = isFocusedMouse || (hasGamepad && slot.mode === 'human');
      const target = isActive ? this.hitTest(slot.cursor.x, slot.cursor.y) : HOVERED_TARGET_NONE;
      nextState = setHoveredTarget(nextState, slot.index, target);
    }

    // Run the auto-distinct-palette pass after every transition so a
    // duplicate-character lobby (Sub-AC 4 of AC 13) is silently
    // differentiated. Gated on a state change so we don't churn the
    // palette renderer every frame.
    if (nextState !== this.state) {
      const projected = toCharacterSelectState(nextState);
      const distinct = autoAssignDistinctPalettes(projected);
      // Adopt back if the auto-pass actually changed palettes.
      if (distinct !== projected) {
        nextState = adoptCharacterSelectState(nextState, distinct);
      }
      this.state = nextState;
      this.refreshAllTiles();
    }

    // Hands always repaint position so the cursor follows even when no
    // other state changed (gamepad held in one direction frame after
    // frame, mouse drag).
    this.refreshHandCursors();
  }

  // -------------------------------------------------------------------------
  // Mouse handling
  // -------------------------------------------------------------------------

  /**
   * Mouse-down dispatch keyed off raw canvas coords. Called by the
   * DOM-level mousedown listener (the only reliable click path on
   * this scene per the Phaser-input-after-scene-start bug worked
   * around in `RebindingScene`).
   */
  private handleMouseDownAt(cx: number, cy: number): void {
    // Update the focused slot's hand to the click position so the
    // hit-test sees the exact pixel the user clicked (the per-frame
    // `update()` hand-tracks-mouse pump may not have run between the
    // last frame and this click).
    this.state = setHandPosition(
      this.state,
      this.focusedMouseSlotIndex,
      { x: cx, y: cy },
      this.cursorBounds,
    );

    // Rebind-inputs button — navigate to the bindings menu and
    // tell it to come back here on cancel (instead of dumping the
    // player at the main menu and losing their pending lobby /
    // match-config state).
    if (this.rebindButtonBounds.contains(cx, cy)) {
      this.scene.start('RebindingScene', {
        returnTo: 'CharacterSelectScene',
        returnData: {
          pendingMatchConfig: this.pendingMatchConfig,
          customStage: this.pendingCustomStage,
          lobby: this.pendingLobby,
        },
      });
      return;
    }

    // Did the click land on a slot tile's mode button, CLEAR button,
    // or palette swatch? Route directly so a mouse user can interact
    // with any slot's UI without first focusing onto it.
    const slotTileTarget = this.hitTestSlotTileForClick(cx, cy);
    if (slotTileTarget) {
      switch (slotTileTarget.kind) {
        case 'mode':
          this.state = cycleSlotMode(this.state, slotTileTarget.slotIndex);
          this.refreshAllTiles();
          return;
        case 'palette':
          this.state = setSlotPalette(
            this.state,
            slotTileTarget.slotIndex,
            slotTileTarget.paletteIndex,
          );
          this.refreshAllTiles();
          return;
      }
    }

    // Did the click land in a slot tile's body area (anywhere on the
    // tile that isn't the mode/palette buttons)? If so, focus the
    // mouse on that slot so subsequent portrait clicks pick for it.
    const focusTarget = this.hitTestSlotTileBody(cx, cy);
    if (focusTarget !== null) {
      this.focusedMouseSlotIndex = focusTarget;
      this.refreshAllTiles();
      return;
    }

    // Otherwise route through the focused slot's selectAtCursor —
    // its hand is already at the click position via the setHandPosition
    // call above, so re-running the per-slot hit-test produces the
    // right `hovered` target for the dispatch.
    const target = this.hitTest(cx, cy);
    this.state = setHoveredTarget(this.state, this.focusedMouseSlotIndex, target);
    this.state = selectAtCursor(this.state, this.focusedMouseSlotIndex);
    this.refreshAllTiles();
  }

  /**
   * Slot-tile click hit-test that also returns *which* palette swatch
   * was hit (for direct-set behaviour). Keeps the routing in
   * {@link handleMouseDownAt} pixel-precise.
   */
  private hitTestSlotTileForClick(
    x: number,
    y: number,
  ):
    | { kind: 'mode'; slotIndex: 1 | 2 | 3 | 4 }
    | { kind: 'palette'; slotIndex: 1 | 2 | 3 | 4; paletteIndex: number }
    | null {
    for (let i = 0; i < this.tiles.length; i += 1) {
      const tile = this.tiles[i];
      if (!tile) continue;
      const slotIndex = (i + 1) as 1 | 2 | 3 | 4;
      if (tile.modeButtonBounds.contains(x, y)) {
        return { kind: 'mode', slotIndex };
      }
      for (let p = 0; p < tile.swatchBounds.length; p += 1) {
        const sb = tile.swatchBounds[p];
        if (sb && sb.contains(x, y)) {
          return { kind: 'palette', slotIndex, paletteIndex: p };
        }
      }
    }
    return null;
  }

  /**
   * Hit-test for a click landing in a slot tile's "body area" — the
   * region that isn't a mode button or a palette swatch. Used to
   * re-aim the focused mouse slot. Returns the slot index, or null
   * if the click missed every tile.
   */
  private hitTestSlotTileBody(x: number, y: number): 1 | 2 | 3 | 4 | null {
    for (let i = 0; i < this.tiles.length; i += 1) {
      const tile = this.tiles[i];
      if (!tile) continue;
      const slotIndex = (i + 1) as 1 | 2 | 3 | 4;
      // Tile's overall bounding rect, derived from the bg rectangle.
      const tileBounds = tile.bg.getBounds();
      if (!tileBounds.contains(x, y)) continue;
      // Don't catch clicks on the mode button / swatches — those have
      // their own setInteractive handlers and are filtered earlier.
      if (tile.modeButtonBounds.contains(x, y)) return null;
      for (const sb of tile.swatchBounds) {
        if (sb.contains(x, y)) return null;
      }
      return slotIndex;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Hit-test
  // -------------------------------------------------------------------------

  private hitTest(x: number, y: number): HoveredTarget {
    for (let i = 0; i < this.portraitTiles.length; i += 1) {
      const tile = this.portraitTiles[i];
      if (!tile) continue;
      if (tile.bounds.contains(x, y)) {
        return { kind: 'portrait', portraitIndex: i };
      }
    }
    const slotTile = this.hitTestSlotTile(x, y);
    if (slotTile) return slotTile;
    return HOVERED_TARGET_NONE;
  }

  private hitTestSlotTile(x: number, y: number): HoveredTarget | null {
    for (let i = 0; i < this.tiles.length; i += 1) {
      const tile = this.tiles[i];
      if (!tile) continue;
      const slotIndex = (i + 1) as 1 | 2 | 3 | 4;
      if (tile.modeButtonBounds.contains(x, y)) {
        return { kind: 'slot-tile-mode', slotIndex };
      }
      for (const swatchBounds of tile.swatchBounds) {
        if (swatchBounds.contains(x, y)) {
          return { kind: 'slot-tile-palette', slotIndex };
        }
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Build helpers
  // -------------------------------------------------------------------------

  private buildPortraitTile(
    px: number,
    py: number,
    size: number,
    portraitIndex: number,
  ): PortraitTileGameObjects {
    const container = this.add.container(px, py);
    const bg = this.add
      .rectangle(0, 0, size, size, 0x14141c)
      .setStrokeStyle(2, 0x44445a)
      .setOrigin(0.5);
    const bodyRect = this.add
      .rectangle(0, -8, size * 0.55, size * 0.55, 0x666666)
      .setOrigin(0.5);
    const spec = SELECTABLE_CHARACTER_SPECS[portraitIndex];
    // Real-sprite portrait if the character has a loaded atlas. Sized
    // to roughly the rectangle's height; if the texture isn't loaded
    // the sprite stays on `__DEFAULT` and is hidden.
    const bodySpriteDisplayHeight = size * 0.7;
    const bodySprite = this.add.sprite(0, -8, '__DEFAULT').setOrigin(0.5);
    if (spec?.placeholder.spriteKey && this.textures.exists(spec.placeholder.spriteKey)) {
      bodySprite.setTexture(spec.placeholder.spriteKey);
      applySpriteDisplayHeight(bodySprite, bodySpriteDisplayHeight);
    } else {
      bodySprite.setVisible(false);
    }
    const nameLabel = this.add
      .text(0, size * 0.36, (spec?.displayName ?? '?').toUpperCase(), {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#cfcfd8',
      })
      .setOrigin(0.5);
    const hoverFrame = this.add
      .rectangle(0, 0, size + 6, size + 6)
      .setStrokeStyle(3, 0xffd166)
      .setOrigin(0.5)
      .setVisible(false);
    const hoverBadge = this.add
      .text(0, -size * 0.42, '', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ffd166',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setVisible(false);
    const slotChips: Phaser.GameObjects.Rectangle[] = [];
    for (let s = 0; s < MAX_PLAYER_SLOTS; s += 1) {
      const chip = this.add
        .rectangle(
          -size * 0.3 + s * (size * 0.2),
          size * 0.46,
          size * 0.16,
          8,
          SLOT_HAND_COLOURS[(s + 1) as 1 | 2 | 3 | 4],
        )
        .setOrigin(0.5)
        .setVisible(false);
      slotChips.push(chip);
    }
    container.add([bg, bodyRect, bodySprite, nameLabel, hoverFrame, hoverBadge, ...slotChips]);
    return {
      container,
      bg,
      bodyRect,
      bodySprite,
      bodySpriteDisplayHeight,
      nameLabel,
      hoverFrame,
      hoverBadge,
      slotChips,
      bounds: new Phaser.Geom.Rectangle(px - size / 2, py - size / 2, size, size),
    };
  }

  private buildSlotTile(
    tx: number,
    ty: number,
    width: number,
    height: number,
    slotIdx: number,
  ): SlotTileGameObjects {
    const slotIndex = (slotIdx + 1) as 1 | 2 | 3 | 4;
    const container = this.add.container(tx, ty);
    const bg = this.add
      .rectangle(0, 0, width, height, 0x1c1c28)
      .setStrokeStyle(3, SLOT_HAND_COLOURS[slotIndex])
      .setOrigin(0.5);
    const nameLabel = this.add
      .text(0, -height * 0.4, `P${slotIndex}`, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#e8e8f0',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const roleLabel = this.add
      .text(0, -height * 0.34, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#a0a0b8',
      })
      .setOrigin(0.5);
    const inputTypeLabel = this.add
      .text(0, -height * 0.28, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888899',
      })
      .setOrigin(0.5);
    // Mode toggle button (clickable by mouse OR hand light-attack).
    const modeButtonW = width * 0.7;
    const modeButtonH = 30;
    const modeButtonY = -height * 0.18;
    // Mode button — clickable via the DOM-level mousedown router
    // (see `create()`). Phaser's per-object `setInteractive()` is
    // unreliable after a `scene.start` from another scene, so we
    // hit-test against `modeButtonBounds` in the router instead.
    const modeButton = this.add
      .rectangle(0, modeButtonY, modeButtonW, modeButtonH, 0x2a2a3c)
      .setStrokeStyle(2, 0x6cf0c2)
      .setOrigin(0.5);
    const modeButtonLabel = this.add
      .text(0, modeButtonY, 'EMPTY', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#6cf0c2',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    // Body preview rectangle + facing arrow.
    const bodyRect = this.add
      .rectangle(0, height * 0.02, width * 0.4, height * 0.32, 0x666666)
      .setOrigin(0.5);
    // Real-sprite preview of the picked character — texture swapped
    // per pick in `refreshSlotTile`. Initially `__DEFAULT` and hidden
    // so an Empty slot doesn't paint a stray Wolf placeholder.
    const bodySpriteDisplayHeight = height * 0.32;
    const bodySprite = this.add
      .sprite(0, height * 0.02, '__DEFAULT')
      .setOrigin(0.5)
      .setVisible(false);
    const facingMark = this.add
      .triangle(width * 0.25, height * 0.02, 0, -8, 0, 8, 14, 0, 0xcccccc)
      .setOrigin(0.5);
    // Palette label + swatch row.
    const paletteLabel = this.add
      .text(0, height * 0.27, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#a0a0b8',
      })
      .setOrigin(0.5);
    const swatchSize = (width * 0.85) / PALETTE_COUNT - 2;
    const swatchY = height * 0.36;
    const swatches: Phaser.GameObjects.Rectangle[] = [];
    const swatchBounds: Phaser.Geom.Rectangle[] = [];
    for (let p = 0; p < PALETTE_COUNT; p += 1) {
      const sx = -((PALETTE_COUNT - 1) * (swatchSize + 2)) / 2 + p * (swatchSize + 2);
      // Palette swatches — clickable via the DOM-level mousedown
      // router (see `create()`). Hit-tested against `swatchBounds[p]`.
      const swatch = this.add
        .rectangle(sx, swatchY, swatchSize, swatchSize, 0x444455)
        .setOrigin(0.5)
        .setStrokeStyle(1, 0x666677);
      swatches.push(swatch);
      swatchBounds.push(
        new Phaser.Geom.Rectangle(
          tx + sx - swatchSize / 2,
          ty + swatchY - swatchSize / 2,
          swatchSize,
          swatchSize,
        ),
      );
    }
    // Mouse-focus badge — visible when this slot is the focused
    // mouse target. Tells the player "left-clicking a portrait will
    // pick for THIS slot." Painted top-right of the tile so it
    // doesn't overlap the slot name.
    const mouseFocusBadge = this.add
      .text(width * 0.4, -height * 0.4, 'MOUSE', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#0a0a14',
        fontStyle: 'bold',
        backgroundColor: '#ffd166',
        padding: { left: 4, right: 4, top: 2, bottom: 2 },
      })
      .setOrigin(0.5)
      .setVisible(false);
    container.add([
      bg,
      nameLabel,
      roleLabel,
      inputTypeLabel,
      modeButton,
      modeButtonLabel,
      bodyRect,
      bodySprite,
      facingMark,
      paletteLabel,
      ...swatches,
      mouseFocusBadge,
    ]);
    return {
      container,
      bg,
      nameLabel,
      roleLabel,
      bodyRect,
      bodySprite,
      bodySpriteDisplayHeight,
      facingMark,
      paletteLabel,
      swatches,
      modeButton,
      modeButtonLabel,
      inputTypeLabel,
      mouseFocusBadge,
      modeButtonBounds: new Phaser.Geom.Rectangle(
        tx - modeButtonW / 2,
        ty + modeButtonY - modeButtonH / 2,
        modeButtonW,
        modeButtonH,
      ),
      swatchBounds,
    };
  }

  private buildHandCursor(slotIndex: 1 | 2 | 3 | 4): HandCursorGameObjects {
    const colour = SLOT_HAND_COLOURS[slotIndex];
    const container = this.add.container(0, 0).setDepth(1000);
    // Triangle pointer — outline white, fill in slot colour.
    const outline = this.add
      .triangle(0, 0, 0, 0, 0, 24, 18, 14, HAND_OUTLINE_COLOUR)
      .setOrigin(0, 0);
    const fill = this.add
      .triangle(2, 2, 0, 0, 0, 20, 14, 12, colour)
      .setOrigin(0, 0);
    const label = this.add
      .text(20, 8, `P${slotIndex}`, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ffffff',
        backgroundColor: `#${colour.toString(16).padStart(6, '0')}`,
        padding: { left: 3, right: 3, top: 1, bottom: 1 },
      })
      .setOrigin(0, 0);
    container.add([outline, fill, label]);
    return { container, outline, fill, label };
  }

  // -------------------------------------------------------------------------
  // Refresh helpers
  // -------------------------------------------------------------------------

  private refreshAllTiles(): void {
    const projected = toCharacterSelectState(this.state);
    const grid = buildCharacterPortraitGrid(projected);
    for (let i = 0; i < this.portraitTiles.length; i += 1) {
      const cell = grid[i];
      const tile = this.portraitTiles[i];
      if (!cell || !tile) continue;
      this.refreshPortraitTile(tile, cell);
    }
    for (let i = 0; i < this.tiles.length; i += 1) {
      const tile = this.tiles[i];
      const slotState = projected.slots[i];
      if (!tile || !slotState) continue;
      const preview = buildSlotPreview(slotState);
      const swatches = buildSlotPaletteSwatches(slotState);
      const handSlot = this.state.slots[i];
      if (!handSlot) continue;
      this.refreshSlotTile(tile, preview, swatches, handSlot.mode);
    }
    this.refreshLobbyStatusHeader(projected);
    // Persist every visible state change so a return-to-lobby (from
    // results, the rebinding menu, anywhere) restores the player's
    // last picks. Cheap — registry.set is just a Map write.
    this.registry.set(BOOT_REGISTRY_KEYS.lastCharacterSelectState, this.state);
  }

  private refreshPortraitTile(
    tile: PortraitTileGameObjects,
    cell: CharacterPortraitGridCell,
  ): void {
    // Paint the body with the canonical (palette 0) colour using the
    // shared swap pipeline so the portrait tile stays consistent with
    // the in-match render.
    const swap = paletteSwapForCharacter(1, cell.characterId, 0);
    applyPaletteSwap(
      { body: tile.bodyRect },
      swap,
      { bodyFillAlpha: cell.playable ? 1 : 0.4 },
    );
    tile.bg.setStrokeStyle(
      cell.selectedBySlots.length > 0 ? 3 : 2,
      cell.selectedBySlots.length > 0 ? 0xffd166 : 0x44445a,
    );
    tile.hoverFrame.setVisible(cell.hoveredBySlots.length > 0);
    if (cell.hoveredBySlots.length > 0) {
      tile.hoverBadge.setVisible(true);
      tile.hoverBadge.setText(cell.hoveredBySlots.map((s) => `P${s}`).join(' '));
    } else {
      tile.hoverBadge.setVisible(false);
    }
    for (let s = 0; s < tile.slotChips.length; s += 1) {
      const chip = tile.slotChips[s];
      if (!chip) continue;
      chip.setVisible(cell.selectedBySlots.includes((s + 1) as 1 | 2 | 3 | 4));
    }
  }

  private refreshSlotTile(
    tile: SlotTileGameObjects,
    preview: CharacterSelectSlotPreview,
    swatches: ReadonlyArray<CharacterSelectPaletteSwatch>,
    mode: 'empty' | 'human' | 'bot',
  ): void {
    const swap = paletteSwapForCharacter(
      preview.slotIndex,
      preview.characterId,
      preview.paletteIndex,
    );
    // AC 10303 Sub-AC 3 — un-joined slots dim through the helper's
    // alpha options (NOT a manual `setFillStyle` on the body), so the
    // colour math stays centralised in `applyPaletteSwap`.
    const fillAlpha = mode === 'empty' ? 0.3 : 1;
    const renderResult = this.paletteRenderer.paint(
      `slot-${preview.slotIndex}`,
      { body: tile.bodyRect, facingMark: tile.facingMark },
      {
        index: preview.slotIndex,
        characterId: preview.characterId,
        paletteIndex: preview.paletteIndex,
      },
      { bodyFillAlpha: fillAlpha, bodyStrokeAlpha: fillAlpha },
    );
    // Capture the shader remap descriptor so a future sprite drop-in
    // can consume it without re-deriving the colour pairs.
    const remap: PaletteSwapRemap = renderResult.remap;
    void remap;
    applyPaletteSwap(
      { body: tile.bodyRect, facingMark: tile.facingMark },
      swap,
      { bodyFillAlpha: fillAlpha, bodyStrokeAlpha: fillAlpha },
    );
    tile.roleLabel.setText(mode === 'empty' ? '— OPEN SLOT —' : preview.roleLabel.toUpperCase());
    tile.inputTypeLabel.setText(formatInputTypeLabel(mode, preview));
    tile.modeButtonLabel.setText(mode.toUpperCase());
    tile.paletteLabel.setText(
      mode === 'empty' ? '' : `palette ${preview.paletteIndex + 1} / ${PALETTE_COUNT}`,
    );
    for (let p = 0; p < tile.swatches.length; p += 1) {
      const swatch = tile.swatches[p];
      const data = swatches[p];
      if (!swatch || !data) continue;
      swatch.fillColor = data.primaryColor;
      swatch.setStrokeStyle(data.active ? 3 : 1, data.active ? 0xffd166 : 0x666677);
    }
    tile.mouseFocusBadge.setVisible(this.focusedMouseSlotIndex === preview.slotIndex);
    // Swap the body sprite to the picked character's idle frame.
    // Empty slots paint nothing here; the rect underneath stays as
    // the dim "no fighter yet" placeholder.
    const spec = getCharacterSpec(preview.characterId);
    const spriteKey = spec.placeholder.spriteKey;
    if (mode !== 'empty' && spriteKey && this.textures.exists(spriteKey)) {
      tile.bodySprite.setTexture(spriteKey);
      applySpriteDisplayHeight(tile.bodySprite, tile.bodySpriteDisplayHeight);
      tile.bodySprite.setVisible(true);
      // The sprite is the visible character; dim the underlying
      // colour rect so it reads as a debug hurtbox rather than a
      // duplicate body. Mirrors the MatchScene "rectAlphaWithSprite"
      // pattern.
      tile.bodyRect.setAlpha(0.15);
    } else {
      tile.bodySprite.setVisible(false);
      tile.bodyRect.setAlpha(fillAlpha);
    }
  }

  private refreshLobbyStatusHeader(projected: CharacterSelectState): void {
    if (!this.lobbyStatusLabel) return;
    const joined = projected.slots.filter((s) => s.joined).length;
    const ready = projected.slots.filter((s) => s.ready).length;
    // ENTER gate: at least 2 ready slots (MatchScene requires it),
    // every joined slot is ready, no palette collisions.
    const canStart = canConfirmMatch(projected) && ready >= 2;
    let suffix = '';
    if (canStart) suffix = '— ENTER ready';
    else if (ready < 2) suffix = `— need ${2 - ready} more ready`;
    else if (joined !== ready) suffix = '— some slot still picking';
    this.lobbyStatusLabel.setText(
      `${joined} joined  /  ${ready} ready  ${suffix}`,
    );
    this.lobbyStatusLabel.setColor(canStart ? '#6cf0a8' : '#888899');
  }

  private refreshHandCursors(): void {
    for (let i = 0; i < this.hands.length; i += 1) {
      const hand = this.hands[i];
      const slot = this.state.slots[i];
      if (!hand || !slot) continue;
      hand.container.setPosition(slot.cursor.x, slot.cursor.y);
      // The focused mouse slot's hand is ALWAYS visible — it IS the
      // mouse cursor surrogate, so hiding it would leave the user
      // with no on-screen indicator of where their click will land.
      // Other slots' hands hide while empty (no player driving them).
      const isFocusedMouse = slot.index === this.focusedMouseSlotIndex;
      hand.container.setVisible(isFocusedMouse || slot.mode !== 'empty');
    }
  }

  // -------------------------------------------------------------------------
  // Confirm / cancel / custom-stage launch
  // -------------------------------------------------------------------------

  private handleConfirm(): void {
    const projected = toCharacterSelectState(this.state);
    if (!canConfirmMatch(projected)) return;
    const matchConfig = this.buildConfirmedMatchConfig();
    // MatchScene's StockTracker indexes by player index 0..N-1 and
    // the match render path assumes ≥ 2 fighters; a 1-player lineup
    // crashes with `playerIndex 1 out of range [0, 1)`. Gate the
    // confirm path on a min-of-2 lineup so the lobby surfaces the
    // requirement instead of dumping into a broken match.
    if (matchConfig.players.length < 2) return;
    if (this.pendingCustomStage) {
      const result = launchCustomStageMatchInScene(this, {
        savedStageId: matchConfig.stageId,
        matchConfig,
        customStage: this.pendingCustomStage,
      });
      this.handleCustomStageLaunchOutcome(result);
      return;
    }
    this.scene.start('MatchScene', { matchConfig });
  }

  private handleCustomStageLaunchOutcome(
    result: CustomStageMatchLaunchResult,
  ): void {
    if (result.ok) return;
    // eslint-disable-next-line no-console
    console.warn(
      `[CharacterSelectScene] custom stage launch failed: ${result.reason} — ${result.message}`,
    );
  }

  private handleCancel(): void {
    this.scene.start('StageSelectScene', {
      pendingMatchConfig: this.pendingMatchConfig,
      lobby: this.pendingLobby,
    });
  }

  /**
   * Compose the in-match controls reminder shown in the footer.
   * Surfaces that DODGE is its own button (separate from SHIELD) — a
   * common point of confusion since shielding looked like the only
   * way to roll. Doesn't bake in specific key names because the
   * dodge binding lives in a runtime profile manager that isn't in
   * the registry; reading it from here would require either a
   * refactor or coupling the scene to the input subsystem internals.
   * The [ REBIND INPUTS ] button right above this hint shows / lets
   * the player change the live keys, so steering them there keeps
   * the hint truthful regardless of remapping.
   */
  private buildInMatchControlsHint(): string {
    return 'In-match: SHIELD anchors you in place — press DODGE (its own button) to roll. See [ REBIND INPUTS ] for current keys.';
  }

  private buildConfirmedMatchConfig(): MatchConfig {
    // Synthesise the lineup from the hand-cursor state — the helper
    // funnels through {@link buildPlayerSlotsFromState} so the legacy
    // PlayerSlot[] contract is preserved byte-for-byte.
    const players = buildPlayerSlotsFromHandCursor(this.state);
    const registrySeed = this.registry.get(BOOT_REGISTRY_KEYS.rngSeed) as
      | number
      | undefined;
    const fallbackSeed =
      typeof registrySeed === 'number' && Number.isFinite(registrySeed)
        ? registrySeed
        : GAME_CONFIG.defaultRngSeed;
    if (this.pendingMatchConfig) {
      const mode = this.pendingMatchConfig.mode;
      if (mode === 'time') {
        return Object.freeze({
          mode: 'time',
          stockCount: this.pendingMatchConfig.stockCount,
          timeLimitSeconds: this.pendingMatchConfig.timeLimitSeconds ?? 180,
          stageId: this.pendingMatchConfig.stageId,
          players,
          rngSeed: this.pendingMatchConfig.rngSeed,
        }) as MatchConfig;
      }
      return Object.freeze({
        mode: 'stocks',
        stockCount: this.pendingMatchConfig.stockCount,
        stageId: this.pendingMatchConfig.stageId,
        players,
        rngSeed: this.pendingMatchConfig.rngSeed,
      }) as MatchConfig;
    }
    return Object.freeze({
      mode: 'stocks',
      stockCount: 3,
      stageId: FLAT_STAGE.id,
      players,
      rngSeed: fallbackSeed,
    }) as MatchConfig;
  }
}

// ---------------------------------------------------------------------------
// Module-local helpers
// ---------------------------------------------------------------------------

/**
 * Adopt a {@link CharacterSelectState} (the legacy shape) onto the
 * existing {@link HandCursorState} so the lobby-handoff hydration path
 * + the auto-distinct-palette pass can both reuse the existing helpers
 * without duplicating their logic into the new shape.
 *
 * Mapping rules:
 *   • `joined: true`  → mode stays 'human' if currently empty.
 *   • `joined: false` → mode → 'empty', pick cleared.
 *   • `inputType === 'ai'` → mode → 'bot'.
 *   • Everything else copies through.
 */
function adoptCharacterSelectState(
  hand: HandCursorState,
  legacy: CharacterSelectState,
): HandCursorState {
  return Object.freeze({
    slots: Object.freeze(
      hand.slots.map((handSlot, i) => {
        const legacySlot = legacy.slots[i];
        if (!legacySlot) return handSlot;
        const nextMode = legacySlot.joined
          ? legacySlot.inputType === 'ai'
            ? 'bot'
            : 'human'
          : 'empty';
        const nextPalette = legacySlot.paletteIndex;
        const nextPicked = legacySlot.ready ? legacySlot.characterId : handSlot.pickedCharacterId;
        // Drop aiDifficulty on non-bot rows so the type invariant holds.
        const { aiDifficulty: _drop, ...stripped } = handSlot;
        void _drop;
        if (nextMode === 'bot') {
          return Object.freeze({
            ...stripped,
            mode: nextMode,
            inputType: legacySlot.inputType,
            aiDifficulty: legacySlot.aiDifficulty ?? 'medium',
            paletteIndex: nextPalette,
            pickedCharacterId: nextPicked,
          });
        }
        if (nextMode === 'human') {
          return Object.freeze({
            ...stripped,
            mode: nextMode,
            inputType: legacySlot.inputType,
            paletteIndex: nextPalette,
            pickedCharacterId: nextPicked,
          });
        }
        return Object.freeze({
          ...stripped,
          mode: 'empty' as const,
          paletteIndex: nextPalette,
          pickedCharacterId: null,
        });
      }),
    ),
  });
}

function applyDeadzone(value: number, deadzone: number): number {
  if (Math.abs(value) < deadzone) return 0;
  return value;
}

function formatInputTypeLabel(
  mode: 'empty' | 'human' | 'bot',
  preview: CharacterSelectSlotPreview,
): string {
  if (mode === 'empty') return '';
  if (mode === 'bot') {
    const tier = preview.aiDifficulty?.toUpperCase() ?? 'MEDIUM';
    return `AI BOT — ${tier}`;
  }
  switch (preview.inputType) {
    case 'keyboard_p1':
      return 'HUMAN — KB P1';
    case 'keyboard_p2':
      return 'HUMAN — KB P2';
    case 'gamepad':
      return 'HUMAN — GAMEPAD';
    case 'ai':
      return 'AI BOT';
  }
}

// Re-export the SlotMode / SlotControls type symbols some smoke tests
// import from this module's surface so a test that did
// `import { SLOT_HAND_COLOURS } from './CharacterSelectScene'` keeps
// working. Currently empty — add as needed.
export { SLOT_HAND_COLOURS };

// Suppress unused-locals lint for the legacy character-select state
// import — we keep `setSlotMode`, `setSlotPalette`, `cycleSlotMode`
// imports live because the mode-toggle / palette swatch click handlers
// use them.
void setSlotMode;
