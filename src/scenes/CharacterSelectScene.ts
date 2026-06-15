import Phaser from 'phaser';
import {
  MAX_PLAYER_SLOTS,
  PALETTE_COUNT,
  SELECTABLE_CHARACTER_SPECS,
  applyLobbyHandoffToCharacterSelect,
  autoAssignDistinctPalettes,
  buildCharacterPortraitGrid,
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
  autoPickDefaultIfNeeded,
  buildPlayerSlotsFromHandCursor,
  cycleSlotAiDifficulty,
  joinNextEmptySlot,
  moveHand,
  participatingSlotCount,
  selectAtCursor,
  setHandPosition,
  setHoveredTarget,
  setSlotInputType,
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
import type { InputType, MatchConfig, PlayerSlot } from '../types';
import type { LobbyHandoffPayload } from './lobby';
// AC 10303 Sub-AC 3 — canonical palette-swap painter. The lobby preview
// runs through the **same** helper the match scene uses so what the
// player sees on the character-select card (body fill, body stroke,
// facing-arrow accent) is byte-for-byte the same colour pipeline the
// in-match fighter renders with.
import {
  applyPaletteSwap,
  paletteSwapForCharacter,
} from '../characters/PaletteSwapRenderer';
// AC 10303 Sub-AC 3 — shader-pipeline remap descriptor type (see the
// remap capture in `refreshPlayerCard`).
import type { PaletteSwapRemap } from '../characters/paletteSwapShader';
// AC 20302 Sub-AC 2 — Runtime palette renderer for the preview path.
import { RuntimePaletteRenderer } from '../characters/runtimePaletteRenderer';
import { getCharacterSpec } from '../characters/roster';
import { applySpriteDisplayHeight } from '../characters/visualScale';
import {
  MENU_COLORS,
  MENU_COLORS_CSS,
  MENU_FONT,
  PLAYER_COLORS,
  addPulse,
  paintFooterHints,
  paintMenuBackground,
  paintMenuTitle,
  playerColorCss,
} from '../ui/menuTheme';

/**
 * CharacterSelectScene — Smash-style character select with in-scene join.
 *
 * One screen handles the whole pre-match player setup, exactly like the
 * Smash Bros character select:
 *
 *   • JOIN = PICKED. Joining a slot (gamepad button press, clicking an
 *     empty card, or "+ CPU") immediately commits the slot-keyed default
 *     fighter, so every joined player always has a valid pick. There is
 *     NO separate ready/lock-in step — clicking a portrait just CHANGES
 *     the pick. (The old two-step join → confirm flow showed a fighter
 *     in the card while the match gate still said "not ready", which
 *     read as a bug; this model removes the gap entirely.)
 *
 *   • Gamepads join themselves: pressing A / START on a pad that isn't
 *     driving a slot claims the first empty slot and binds that pad to
 *     it. The pad's stick / d-pad then drives the slot's hand cursor;
 *     A picks the hovered portrait, B leaves the lobby, START confirms.
 *
 *   • Mouse / keyboard: clicking a portrait picks for the focused slot
 *     (joining it if empty); clicking an empty card joins it on the
 *     first free keyboard half; [1-4] re-aim the mouse, [C] adds a CPU,
 *     [BACKSPACE] removes the focused slot, [ENTER] starts.
 *
 *   • CPU slots are host-configured (Smash-style): "+ CPU" on an empty
 *     card adds a bot with an auto-picked fighter; the LV button cycles
 *     easy → medium → hard; ✕ removes it.
 *
 *   • A "READY TO FIGHT" banner lights up as soon as ≥ 2 slots are
 *     filled — because join = picked, there is no "someone is still
 *     picking" dead state.
 *
 * Flow position: ModeSelect → **CharacterSelect** → StageSelect → Match
 * (fighters first, arena last — the Smash ordering). Confirm forwards
 * the lineup to `StageSelectScene`; cancel returns to `ModeSelectScene`.
 *
 * Determinism: the hand-cursor state machine is a pure reducer (see
 * `handCursorState.ts`). Two scenes that received the same gamepad /
 * mouse input frames in the same order produce byte-identical
 * `PlayerSlot[]` arrays, so the replay header keeps working unchanged.
 */
export interface CharacterSelectSceneData {
  readonly pendingMatchConfig?: Omit<MatchConfig, 'players'> & {
    readonly players?: ReadonlyArray<PlayerSlot>;
  };
  /**
   * Legacy field — custom stages are picked AFTER the lineup now (the
   * stage select runs last), so this scene only tolerates the payload
   * for compatibility with older return paths; it is not consumed.
   */
  readonly customStage?: CustomStageData;
  readonly lobby?: LobbyHandoffPayload;
}

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

/**
 * Per-slot hand cursor / card accent colours (P1 red, P2 blue, P3
 * green, P4 yellow). Sourced from the shared menu theme so HUD / hands
 * / cards stay in lockstep. Re-exported under the legacy name for
 * existing import sites.
 */
const SLOT_HAND_COLOURS: Readonly<Record<1 | 2 | 3 | 4, number>> = PLAYER_COLORS;

/** Hand cursor outline colour — high-contrast white so the hand reads on dark backgrounds. */
const HAND_OUTLINE_COLOUR = 0xffffff;

/** Cursor speed for gamepad-driven hands, in scene px per frame at unit stick deflection. */
const HAND_GAMEPAD_SPEED_PX_PER_FRAME = 11;

/** Dead-zone for analog stick / d-pad input. Below this, no movement. */
const HAND_GAMEPAD_DEADZONE = 0.15;

/** Standard-mapping START button index (pause / "ready to fight"). */
const PAD_START_BUTTON_INDEX = 9;

// ---------------------------------------------------------------------------
// Local game-object cache types — mutated in place by refresh helpers
// ---------------------------------------------------------------------------

interface PortraitTileGameObjects {
  readonly container: Phaser.GameObjects.Container;
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly bodyRect: Phaser.GameObjects.Rectangle;
  readonly bodySprite: Phaser.GameObjects.Sprite;
  readonly bodySpriteDisplayHeight: number;
  readonly nameLabel: Phaser.GameObjects.Text;
  readonly hoverFrame: Phaser.GameObjects.Rectangle;
  readonly hoverBadge: Phaser.GameObjects.Text;
  readonly slotChips: Phaser.GameObjects.Rectangle[];
  /** World-space rect for hit-testing the portrait. */
  readonly bounds: Phaser.Geom.Rectangle;
}

interface PlayerCardGameObjects {
  readonly slotIndex: 1 | 2 | 3 | 4;
  readonly panel: Phaser.GameObjects.Graphics;
  readonly badge: Phaser.GameObjects.Text;
  readonly joinHint: Phaser.GameObjects.Text;
  readonly joinSubHint: Phaser.GameObjects.Text;
  readonly cpuButton: Phaser.GameObjects.Text;
  readonly bodyRect: Phaser.GameObjects.Rectangle;
  readonly bodySprite: Phaser.GameObjects.Sprite;
  readonly bodySpriteDisplayHeight: number;
  readonly facingMark: Phaser.GameObjects.Triangle;
  readonly nameLabel: Phaser.GameObjects.Text;
  readonly roleLabel: Phaser.GameObjects.Text;
  readonly inputLabel: Phaser.GameObjects.Text;
  readonly cpuChip: Phaser.GameObjects.Text;
  readonly diffButton: Phaser.GameObjects.Text;
  readonly leaveButton: Phaser.GameObjects.Text;
  readonly mouseFocusBadge: Phaser.GameObjects.Text;
  readonly swatches: Phaser.GameObjects.Rectangle[];
  /** Card geometry (centre + size) for panel redraws. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** World-space hit rects. */
  readonly cardBounds: Phaser.Geom.Rectangle;
  readonly cpuButtonBounds: Phaser.Geom.Rectangle;
  readonly diffButtonBounds: Phaser.Geom.Rectangle;
  readonly leaveButtonBounds: Phaser.Geom.Rectangle;
  readonly swatchBounds: Phaser.Geom.Rectangle[];
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
  private pendingLobby: LobbyHandoffPayload | undefined = undefined;

  private portraitTiles: PortraitTileGameObjects[] = [];
  private cards: PlayerCardGameObjects[] = [];
  private hands: HandCursorGameObjects[] = [];

  private bannerBand: Phaser.GameObjects.Rectangle | undefined = undefined;
  private bannerLabel: Phaser.GameObjects.Text | undefined = undefined;
  private bannerTween: Phaser.Tweens.Tween | undefined = undefined;

  private paletteRenderer: RuntimePaletteRenderer = new RuntimePaletteRenderer();

  /**
   * Cursor clamp bounds — derived once in create() from the logical
   * game size. Constant for the scene's lifetime: under the FIT scale
   * mode a window resize rescales the canvas without changing logical
   * coordinates, so no re-derivation happens (or is needed).
   */
  private cursorBounds: HandCursorBounds = {
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
  };

  /**
   * Physical pad → claimed slot. Built up as pads press A/START to
   * join; cleared per pad on B (leave). Multiple pads can play — each
   * claims its own slot, so the `'gamepad'` InputType can drive up to
   * four slots simultaneously.
   */
  private padAssignments: Map<number, 1 | 2 | 3 | 4> = new Map();

  /**
   * Per-pad button-press latches — gamepad polling is level-triggered
   * (`buttons[i].pressed` stays `true` while held), so we track the
   * previous frame's pressed state to derive edge-triggers.
   */
  private gamepadButtonLatches: Map<
    number,
    { light: boolean; special: boolean; start: boolean }
  > = new Map();

  /**
   * Slot the mouse pointer is currently acting on. Defaults to slot 1
   * so the very first mouse click already does something. Re-aimed by
   * clicking a card body or pressing [1-4].
   */
  private focusedMouseSlotIndex: 1 | 2 | 3 | 4 = 1;

  /**
   * Last pointer position sampled by update(), in canvas coords. NaN
   * until the first frame samples the pointer. The mouse only drives
   * its hand on frames where the pointer actually MOVED — an idle
   * mouse must not pin a hand (least of all a pad-bound one) to the
   * stale pointer position every frame.
   */
  private lastPointerX = Number.NaN;
  private lastPointerY = Number.NaN;

  /**
   * Set when pad bindings / mouse focus change WITHOUT a state
   * transition — the joinPad orphan-adoption path re-binds a pad and
   * may re-aim the mouse focus while returning the state unchanged.
   * update() repaints on it so the orphaned-gamepad input label and
   * the MOUSE focus badge never go stale.
   */
  private padBindingsDirty = false;

  /** World-space rect for the "REBIND INPUTS" button. */
  private rebindButtonBounds: Phaser.Geom.Rectangle = new Phaser.Geom.Rectangle(0, 0, 0, 0);

  constructor() {
    super({ key: 'CharacterSelectScene' });
  }

  init(data?: CharacterSelectSceneData): void {
    this.pendingMatchConfig = data?.pendingMatchConfig;
    this.pendingLobby = data?.lobby;
    this.padAssignments = new Map();
    // Stale mouse focus / pointer deltas must not survive scene
    // re-entry — the card the mouse drove last visit may now belong
    // to a restored gamepad slot.
    this.focusedMouseSlotIndex = 1;
    this.lastPointerX = Number.NaN;
    this.lastPointerY = Number.NaN;
    // Restore the last-saved selection state if one exists in the
    // registry — a player coming back from a match (or the rebinding
    // menu) walks back in with their picks intact.
    const restored = this.registry.get(BOOT_REGISTRY_KEYS.lastCharacterSelectState) as
      | HandCursorState
      | undefined;
    this.state = restored ?? DEFAULT_HAND_CURSOR_STATE;
    // AC 2 Sub-AC 5 — hydrate joined / inputType from the lobby
    // hand-off payload when present so the player isn't asked to
    // Press Start a second time. Only when nothing was restored: the
    // registry state is NEWER than the lobby payload, and re-applying
    // the payload on a Stage→Character back-nav or a Rebinding round
    // trip would wipe slots added in this scene.
    if (data?.lobby && restored === undefined) {
      const seeded = applyLobbyHandoffToCharacterSelect(
        toCharacterSelectState(this.state),
        data.lobby,
      );
      this.state = adoptCharacterSelectState(this.state, seeded);
    }
    // Join = picked: any slot that arrives joined-but-unpicked (legacy
    // lobby payloads, old persisted states) is auto-picked so the
    // Smash-style invariant holds from the first paint.
    for (const i of [1, 2, 3, 4] as const) {
      this.state = autoPickDefaultIfNeeded(this.state, i);
    }
  }

  create(): void {
    const { width, height } = this.scale.gameSize;
    this.cursorBounds = { minX: 0, maxX: width, minY: 0, maxY: height };

    // ---- Background + title -------------------------------------------------
    paintMenuBackground(this);
    paintMenuTitle(this, width / 2, height * 0.055, 'Choose Your Fighter', {
      fontSize: 40,
      subtitle:
        'Press Ⓐ on a gamepad or click a fighter to join — every player joins ready',
    });

    // ---- Character portraits grid ------------------------------------------
    const portraitCount = SELECTABLE_CHARACTER_SPECS.length;
    const tileSize = Math.min(120, height * 0.17);
    const tileSpacing = 14;
    const cellsPerRow = Math.max(
      1,
      Math.min(portraitCount, Math.floor((width - 80) / (tileSize + tileSpacing))),
    );
    const rowsNeeded = Math.ceil(portraitCount / cellsPerRow);
    const gridWidth = cellsPerRow * tileSize + (cellsPerRow - 1) * tileSpacing;
    const gridLeft = (width - gridWidth) / 2;
    const gridTop = height * 0.16;

    this.portraitTiles = [];
    for (let i = 0; i < portraitCount; i += 1) {
      const col = i % cellsPerRow;
      const row = Math.floor(i / cellsPerRow);
      const px = gridLeft + col * (tileSize + tileSpacing) + tileSize / 2;
      const py = gridTop + row * (tileSize + tileSpacing) + tileSize / 2;
      this.portraitTiles.push(this.buildPortraitTile(px, py, tileSize, i));
    }

    // ---- READY TO FIGHT banner ----------------------------------------------
    const bannerY = gridTop + rowsNeeded * (tileSize + tileSpacing) + 34;
    this.bannerBand = this.add
      .rectangle(width / 2, bannerY, width * 0.56, 42, MENU_COLORS.accent)
      .setOrigin(0.5)
      .setVisible(false);
    this.bannerLabel = this.add
      .text(width / 2, bannerY, '', {
        fontFamily: MENU_FONT,
        fontSize: '21px',
        fontStyle: 'bold',
        color: MENU_COLORS_CSS.textSecondary,
      })
      .setOrigin(0.5);
    this.bannerTween = addPulse(this, this.bannerBand, { minAlpha: 0.65, duration: 600 });
    this.bannerTween.pause();

    // ---- Player cards (Smash-style bottom strip) ----------------------------
    const cardHeight = Math.min(height * 0.34, 270);
    const cardGapY = height * 0.035;
    const cardY = height - cardHeight / 2 - cardGapY;
    const cardWidth = Math.min(300, (width - 120) / MAX_PLAYER_SLOTS);
    const cardGap = (width - cardWidth * MAX_PLAYER_SLOTS) / (MAX_PLAYER_SLOTS + 1);

    this.cards = [];
    for (let i = 0; i < MAX_PLAYER_SLOTS; i += 1) {
      const cx = cardGap + i * (cardWidth + cardGap) + cardWidth / 2;
      this.cards.push(
        this.buildPlayerCard((i + 1) as 1 | 2 | 3 | 4, cx, cardY, cardWidth, cardHeight),
      );
    }

    // ---- Hand cursors (drawn last so they sit on top) ----------------------
    this.hands = [];
    const quadCentres: ReadonlyArray<{ x: number; y: number }> = [
      { x: width * 0.3, y: height * 0.35 },
      { x: width * 0.7, y: height * 0.35 },
      { x: width * 0.4, y: height * 0.45 },
      { x: width * 0.6, y: height * 0.45 },
    ];
    for (let i = 0; i < MAX_PLAYER_SLOTS; i += 1) {
      const slotIndex = (i + 1) as 1 | 2 | 3 | 4;
      this.hands.push(this.buildHandCursor(slotIndex));
      const start = quadCentres[i] ?? { x: width / 2, y: height / 2 };
      this.state = setHandPosition(this.state, slotIndex, start, this.cursorBounds);
    }

    // ---- Rebind-inputs button (clickable via DOM router below) -------------
    const rebindLabel = this.add
      .text(width - 16, height * 0.02, '[ REBIND INPUTS ]', {
        fontFamily: MENU_FONT,
        fontSize: '14px',
        color: MENU_COLORS_CSS.panelDark,
        fontStyle: 'bold',
        backgroundColor: MENU_COLORS_CSS.accent,
        padding: { left: 10, right: 10, top: 4, bottom: 4 },
      })
      .setOrigin(1, 0);
    const rebindBounds = rebindLabel.getBounds();
    this.rebindButtonBounds = new Phaser.Geom.Rectangle(
      rebindBounds.x,
      rebindBounds.y,
      rebindBounds.width,
      rebindBounds.height,
    );

    // ---- Footer hint -------------------------------------------------------
    paintFooterHints(this, height - 14, [
      'Ⓐ join / pick',
      'Ⓑ leave',
      '[C] add CPU',
      '[1-4] aim mouse',
      '[BACKSPACE] remove',
      '[ENTER]/START fight',
      '[ESC] back',
    ]);

    // ---- Input wiring ------------------------------------------------------
    // Apply the same fix RebindingScene uses for the Phaser-input-after-
    // scene-start bug: explicitly re-enable the input plugin, force
    // canvas focus so DOM keydown / mousedown listeners aren't dormant,
    // and route clicks through a DOM-level mousedown handler instead of
    // Phaser's per-scene InputPlugin.
    if (this.input) {
      this.input.enabled = true;
      this.input.setTopOnly(false);
    }
    this.input.setDefaultCursor('default');
    const canvas = this.game.canvas;
    if (canvas) {
      if (canvas.tabIndex < 0) canvas.tabIndex = 0;
      canvas.style.outline = 'none';
      canvas.focus();
    }

    const domHandler = (e: MouseEvent) => {
      if (!canvas) return;
      if (e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;
      this.handleMouseDownAt(cx, cy);
    };
    canvas.addEventListener('mousedown', domHandler);

    // ---- Keyboard bindings -------------------------------------------------
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') this.handleConfirm();
      else if (event.key === 'Escape') this.handleCancel();
      else if (event.key === 'Backspace' || event.key === 'Delete') {
        this.removeSlot(this.focusedMouseSlotIndex);
        event.preventDefault();
      } else if (event.key === 'c' || event.key === 'C') {
        this.addCpu();
      } else if (event.key >= '1' && event.key <= '4') {
        this.focusedMouseSlotIndex = Number(event.key) as 1 | 2 | 3 | 4;
        this.refreshAllTiles();
      }
    });

    // ---- Mid-scene gamepad connects ----------------------------------------
    // A pad that connects MID-SCENE gets its latch pre-primed all-false
    // so its very first press counts as an edge (joins instantly). The
    // current-state priming in update() only covers pads already present
    // at the first poll — buttons held across a scene transition.
    const padConnectedHandler = (pad: Phaser.Input.Gamepad.Gamepad) => {
      this.gamepadButtonLatches.set(pad.index, {
        light: false,
        special: false,
        start: false,
      });
    };
    this.input.gamepad?.on(Phaser.Input.Gamepad.Events.CONNECTED, padConnectedHandler);

    // First paint after the tile objects exist.
    this.refreshAllTiles();

    // Clean up listeners on shutdown.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.paletteRenderer.resetCache();
      this.gamepadButtonLatches.clear();
      this.input.gamepad?.off(Phaser.Input.Gamepad.Events.CONNECTED, padConnectedHandler);
      if (canvas) canvas.removeEventListener('mousedown', domHandler);
    });
  }

  // -------------------------------------------------------------------------
  // Per-frame update — gamepad poll + mouse drive + hit-test + repaint
  // -------------------------------------------------------------------------

  update(): void {
    let nextState = this.state;

    // Drop pad assignments whose slot was emptied through the mouse UI.
    for (const [padIndex, slotIndex] of this.padAssignments) {
      const slot = nextState.slots[slotIndex - 1];
      if (!slot || slot.mode === 'empty') this.padAssignments.delete(padIndex);
    }

    // Pump every CONNECTED pad — not "the pad at the slot's index".
    // Unassigned pads can JOIN (A / START claims the first empty slot
    // and binds the pad); assigned pads drive their slot's hand.
    const pads = this.input.gamepad?.gamepads ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      // First sighting of a pad: prime the latch from the CURRENT
      // button state without firing edges. A button still held from
      // the previous scene (attack mashed at match end, START pressed
      // on the results screen) must not auto-join on the first frame.
      // (Pads that connect MID-SCENE skip this branch — the CONNECTED
      // handler in create() pre-primed them all-false so their first
      // press counts.)
      if (!this.gamepadButtonLatches.has(pad.index)) {
        this.gamepadButtonLatches.set(pad.index, {
          light: !!pad.A,
          special: !!pad.B,
          start: !!pad.buttons[PAD_START_BUTTON_INDEX]?.pressed,
        });
        continue;
      }
      const latch = this.gamepadButtonLatches.get(pad.index)!;
      const lightPressed = !!pad.A;
      const specialPressed = !!pad.B;
      const startPressed = !!pad.buttons[PAD_START_BUTTON_INDEX]?.pressed;
      const lightEdge = lightPressed && !latch.light;
      const specialEdge = specialPressed && !latch.special;
      const startEdge = startPressed && !latch.start;
      this.gamepadButtonLatches.set(pad.index, {
        light: lightPressed,
        special: specialPressed,
        start: startPressed,
      });

      const assigned = this.padAssignments.get(pad.index);
      if (assigned === undefined) {
        // Press-button-to-join — Smash-style.
        if (lightEdge || startEdge) {
          nextState = this.joinPad(nextState, pad.index);
        }
        continue;
      }

      // Stick or d-pad moves the slot's hand.
      const dx =
        applyDeadzone(pad.axes[0]?.getValue() ?? 0, HAND_GAMEPAD_DEADZONE) +
        (pad.left ? -1 : 0) +
        (pad.right ? 1 : 0);
      const dy =
        applyDeadzone(pad.axes[1]?.getValue() ?? 0, HAND_GAMEPAD_DEADZONE) +
        (pad.up ? -1 : 0) +
        (pad.down ? 1 : 0);
      if (dx !== 0 || dy !== 0) {
        nextState = moveHand(
          nextState,
          assigned,
          dx * HAND_GAMEPAD_SPEED_PX_PER_FRAME,
          dy * HAND_GAMEPAD_SPEED_PX_PER_FRAME,
          this.cursorBounds,
        );
      }
      if (lightEdge) {
        nextState = selectAtCursor(nextState, assigned);
      }
      if (specialEdge) {
        nextState = unselectSlot(nextState, assigned);
        this.padAssignments.delete(pad.index);
      }
      if (startEdge) {
        this.state = nextState;
        this.handleConfirm();
        nextState = this.state;
      }
    }

    // Mouse drives the focused mouse slot's hand — but only on frames
    // where the pointer actually MOVED, and never when a pad is bound
    // to the focused slot (the pad owns that hand; an idle mouse must
    // not snap it back to the pointer position every frame).
    const padSlots = new Set(this.padAssignments.values());
    const pointer = this.input.activePointer;
    if (pointer) {
      const pointerMoved =
        !Number.isNaN(this.lastPointerX) &&
        (pointer.x !== this.lastPointerX || pointer.y !== this.lastPointerY);
      this.lastPointerX = pointer.x;
      this.lastPointerY = pointer.y;
      if (pointerMoved && !padSlots.has(this.focusedMouseSlotIndex)) {
        nextState = setHandPosition(
          nextState,
          this.focusedMouseSlotIndex,
          { x: pointer.x, y: pointer.y },
          this.cursorBounds,
        );
      }
    }

    // Hit-test only ACTIVE hands — the focused mouse slot and slots
    // with a bound pad — so idle hands don't light phantom hover badges.
    for (const slot of nextState.slots) {
      const isActive =
        slot.index === this.focusedMouseSlotIndex || padSlots.has(slot.index);
      const target = isActive
        ? this.hitTest(slot.cursor.x, slot.cursor.y)
        : HOVERED_TARGET_NONE;
      nextState = setHoveredTarget(nextState, slot.index, target);
    }

    // Run the auto-distinct-palette pass after every transition so a
    // duplicate-character lobby (Sub-AC 4 of AC 13) is silently
    // differentiated. Gated on a state change so we don't churn the
    // palette renderer every frame.
    if (nextState !== this.state) {
      const projected = toCharacterSelectState(nextState);
      const distinct = autoAssignDistinctPalettes(projected);
      if (distinct !== projected) {
        nextState = adoptCharacterSelectState(nextState, distinct);
      }
      this.state = nextState;
      this.refreshAllTiles();
    } else if (this.padBindingsDirty) {
      // A pad adopted an orphaned slot / the mouse focus re-aimed
      // without a state transition — repaint so the input labels and
      // the MOUSE badge track the new bindings.
      this.refreshAllTiles();
    }
    this.padBindingsDirty = false;

    this.refreshHandCursors();
  }

  /**
   * Bind a physical pad to a slot. Prefers adopting an existing
   * orphaned human-gamepad slot (a restored lobby whose pad bindings
   * didn't survive the scene restart) before claiming a new one, so a
   * rejoining pad doesn't duplicate its old slot.
   */
  private joinPad(state: HandCursorState, padIndex: number): HandCursorState {
    const bound = new Set(this.padAssignments.values());
    for (const slot of state.slots) {
      if (slot.mode === 'human' && slot.inputType === 'gamepad' && !bound.has(slot.index)) {
        this.padAssignments.set(padIndex, slot.index);
        this.retargetMouseFocusOffPadSlots();
        this.padBindingsDirty = true;
        return state;
      }
    }
    const { state: joined, slotIndex } = joinNextEmptySlot(state, 'gamepad');
    if (slotIndex === null) return state;
    this.padAssignments.set(padIndex, slotIndex);
    this.retargetMouseFocusOffPadSlots();
    this.padBindingsDirty = true;
    // Park the new hand mid-grid so the player sees it appear.
    const { width, height } = this.scale.gameSize;
    return setHandPosition(
      joined,
      slotIndex,
      { x: width / 2, y: height * 0.3 },
      this.cursorBounds,
    );
  }

  /**
   * Re-aim the mouse focus at the first slot no pad is driving. Runs
   * after a pad claims a slot so the mouse cursor surrogate never sits
   * on (and fights over) a pad-bound hand. When every slot is
   * pad-bound the focus stays put — the pointer-moved + pad-bound
   * guards in update() keep the mouse from driving it anyway.
   */
  private retargetMouseFocusOffPadSlots(): void {
    const padSlots = new Set(this.padAssignments.values());
    if (!padSlots.has(this.focusedMouseSlotIndex)) return;
    for (const i of [1, 2, 3, 4] as const) {
      if (!padSlots.has(i)) {
        this.focusedMouseSlotIndex = i;
        return;
      }
    }
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
    this.state = setHandPosition(
      this.state,
      this.focusedMouseSlotIndex,
      { x: cx, y: cy },
      this.cursorBounds,
    );

    if (this.rebindButtonBounds.contains(cx, cy)) {
      this.scene.start('RebindingScene', {
        returnTo: 'CharacterSelectScene',
        returnData: {
          pendingMatchConfig: this.pendingMatchConfig,
          lobby: this.pendingLobby,
        },
      });
      return;
    }

    // Card controls — leave ✕ / + CPU / LV cycle / palette swatches /
    // focus-or-join on the card body.
    for (const card of this.cards) {
      const slot = this.state.slots[card.slotIndex - 1];
      if (!slot) continue;
      if (slot.mode !== 'empty' && card.leaveButtonBounds.contains(cx, cy)) {
        this.removeSlot(card.slotIndex);
        return;
      }
      if (slot.mode === 'empty' && card.cpuButtonBounds.contains(cx, cy)) {
        this.state = setSlotMode(this.state, card.slotIndex, 'bot');
        this.refreshAllTiles();
        return;
      }
      if (slot.mode === 'bot' && card.diffButtonBounds.contains(cx, cy)) {
        this.state = cycleSlotAiDifficulty(this.state, card.slotIndex);
        this.refreshAllTiles();
        return;
      }
      if (slot.mode !== 'empty') {
        for (let p = 0; p < card.swatchBounds.length; p += 1) {
          const sb = card.swatchBounds[p];
          if (sb && sb.contains(cx, cy)) {
            this.state = setSlotPalette(this.state, card.slotIndex, p);
            this.refreshAllTiles();
            return;
          }
        }
      }
      if (card.cardBounds.contains(cx, cy)) {
        if (slot.mode === 'empty') {
          // Clicking an empty card joins it as a human on the first
          // free keyboard half — join = picked, instantly valid.
          this.state = setSlotInputType(
            this.state,
            card.slotIndex,
            this.firstFreeKeyboardInputType(),
          );
          this.state = setSlotMode(this.state, card.slotIndex, 'human');
        }
        this.focusedMouseSlotIndex = card.slotIndex;
        this.refreshAllTiles();
        return;
      }
    }

    // Otherwise route through the focused slot's selectAtCursor — a
    // portrait click picks (and joins an empty focused slot).
    const target = this.hitTest(cx, cy);
    // A portrait click on an EMPTY focused slot is a join-by-pick —
    // give the slot a real device first. selectAtCursor promotes
    // empty → human keeping the slot's CURRENT inputType, and the
    // slot default ('gamepad') would mint a human slot no physical
    // pad drives.
    const focusedSlot = this.state.slots[this.focusedMouseSlotIndex - 1];
    if (target.kind === 'portrait' && focusedSlot?.mode === 'empty') {
      this.state = setSlotInputType(
        this.state,
        this.focusedMouseSlotIndex,
        this.firstFreeKeyboardInputType(),
      );
    }
    this.state = setHoveredTarget(this.state, this.focusedMouseSlotIndex, target);
    this.state = selectAtCursor(this.state, this.focusedMouseSlotIndex);
    this.refreshAllTiles();
  }

  /** First keyboard half not already driving a participating slot. */
  private firstFreeKeyboardInputType(): InputType {
    const used = new Set<InputType>();
    for (const slot of this.state.slots) {
      if (slot.mode === 'human') used.add(slot.inputType);
    }
    if (!used.has('keyboard_p1')) return 'keyboard_p1';
    if (!used.has('keyboard_p2')) return 'keyboard_p2';
    return 'gamepad';
  }

  /** Remove a slot from the lobby (mouse ✕ / BACKSPACE / pad B). */
  private removeSlot(slotIndex: 1 | 2 | 3 | 4): void {
    this.state = unselectSlot(this.state, slotIndex);
    for (const [padIndex, assigned] of this.padAssignments) {
      if (assigned === slotIndex) this.padAssignments.delete(padIndex);
    }
    this.refreshAllTiles();
  }

  /** Add a CPU to the first empty slot ([C] key). */
  private addCpu(): void {
    for (const slot of this.state.slots) {
      if (slot.mode === 'empty') {
        this.state = setSlotMode(this.state, slot.index, 'bot');
        this.refreshAllTiles();
        return;
      }
    }
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
    // Hand cursors can also cycle their card's palette strip (gamepad
    // users have no mouse to click an exact swatch — A on the strip
    // steps +1 via the reducer's slot-tile-palette dispatch).
    for (const card of this.cards) {
      for (const sb of card.swatchBounds) {
        if (sb.contains(x, y)) {
          return { kind: 'slot-tile-palette', slotIndex: card.slotIndex };
        }
      }
    }
    return HOVERED_TARGET_NONE;
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
      .rectangle(0, 0, size, size, MENU_COLORS.panel)
      .setStrokeStyle(2, MENU_COLORS.panelBorder)
      .setOrigin(0.5);
    const bodyRect = this.add
      .rectangle(0, -8, size * 0.55, size * 0.55, 0x666666)
      .setOrigin(0.5);
    const spec = SELECTABLE_CHARACTER_SPECS[portraitIndex];
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
        fontFamily: MENU_FONT,
        fontSize: '13px',
        fontStyle: 'bold',
        color: MENU_COLORS_CSS.textSecondary,
      })
      .setOrigin(0.5);
    const hoverFrame = this.add
      .rectangle(0, 0, size + 6, size + 6)
      .setStrokeStyle(3, MENU_COLORS.gold)
      .setOrigin(0.5)
      .setVisible(false);
    const hoverBadge = this.add
      .text(0, -size * 0.42, '', {
        fontFamily: MENU_FONT,
        fontSize: '11px',
        color: MENU_COLORS_CSS.gold,
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

  private buildPlayerCard(
    slotIndex: 1 | 2 | 3 | 4,
    cx: number,
    cy: number,
    width: number,
    height: number,
  ): PlayerCardGameObjects {
    const colour = SLOT_HAND_COLOURS[slotIndex];
    const panel = this.add.graphics();

    // P# badge — always visible, top-left, in the player colour.
    const badge = this.add
      .text(cx - width / 2 + 10, cy - height / 2 + 8, `P${slotIndex}`, {
        fontFamily: MENU_FONT,
        fontSize: '15px',
        fontStyle: 'bold',
        color: MENU_COLORS_CSS.panelDark,
        backgroundColor: `#${colour.toString(16).padStart(6, '0')}`,
        padding: { left: 7, right: 7, top: 2, bottom: 2 },
      })
      .setOrigin(0, 0);

    // Empty-state affordances.
    const joinHint = this.add
      .text(cx, cy - height * 0.1, 'PRESS Ⓐ\nTO JOIN', {
        fontFamily: MENU_FONT,
        fontSize: '20px',
        fontStyle: 'bold',
        color: MENU_COLORS_CSS.textSecondary,
        align: 'center',
      })
      .setOrigin(0.5);
    addPulse(this, joinHint, { minAlpha: 0.35, duration: 900 });
    const joinSubHint = this.add
      .text(cx, cy + height * 0.1, 'or click here', {
        fontFamily: MENU_FONT,
        fontSize: '13px',
        color: MENU_COLORS_CSS.textDim,
      })
      .setOrigin(0.5);
    const cpuButton = this.add
      .text(cx, cy + height * 0.3, '+ ADD CPU', {
        fontFamily: MENU_FONT,
        fontSize: '14px',
        fontStyle: 'bold',
        color: MENU_COLORS_CSS.textPrimary,
        backgroundColor: '#2a2a3e',
        padding: { left: 12, right: 12, top: 5, bottom: 5 },
      })
      .setOrigin(0.5);

    // Joined-state objects.
    const bodySpriteDisplayHeight = height * 0.42;
    const bodyRect = this.add
      .rectangle(cx, cy - height * 0.1, width * 0.34, height * 0.4, 0x666666)
      .setOrigin(0.5)
      .setVisible(false);
    const bodySprite = this.add
      .sprite(cx, cy - height * 0.1, '__DEFAULT')
      .setOrigin(0.5)
      .setVisible(false);
    const facingMark = this.add
      .triangle(cx + width * 0.22, cy - height * 0.1, 0, -8, 0, 8, 14, 0, 0xcccccc)
      .setOrigin(0.5)
      .setVisible(false);
    const nameLabel = this.add
      .text(cx, cy + height * 0.18, '', {
        fontFamily: MENU_FONT,
        fontSize: '24px',
        fontStyle: 'bold',
        color: MENU_COLORS_CSS.textPrimary,
      })
      .setOrigin(0.5)
      .setShadow(0, 2, '#000000', 4, true, true);
    const roleLabel = this.add
      .text(cx, cy + height * 0.29, '', {
        fontFamily: MENU_FONT,
        fontSize: '12px',
        color: MENU_COLORS_CSS.textSecondary,
      })
      .setOrigin(0.5);
    const inputLabel = this.add
      .text(cx, cy + height * 0.5 - 14, '', {
        fontFamily: MENU_FONT,
        fontSize: '11px',
        color: MENU_COLORS_CSS.textDim,
      })
      .setOrigin(0.5);
    const cpuChip = this.add
      .text(cx - width / 2 + 10, cy - height / 2 + 36, 'CPU', {
        fontFamily: MENU_FONT,
        fontSize: '11px',
        fontStyle: 'bold',
        color: MENU_COLORS_CSS.panelDark,
        backgroundColor: MENU_COLORS_CSS.gold,
        padding: { left: 5, right: 5, top: 1, bottom: 1 },
      })
      .setOrigin(0, 0)
      .setVisible(false);
    const diffButton = this.add
      .text(cx + width / 2 - 10, cy - height / 2 + 36, 'LV · MEDIUM', {
        fontFamily: MENU_FONT,
        fontSize: '11px',
        fontStyle: 'bold',
        color: MENU_COLORS_CSS.textPrimary,
        backgroundColor: '#2a2a3e',
        padding: { left: 6, right: 6, top: 2, bottom: 2 },
      })
      .setOrigin(1, 0)
      .setVisible(false);
    const leaveButton = this.add
      .text(cx + width / 2 - 8, cy - height / 2 + 6, '✕', {
        fontFamily: MENU_FONT,
        fontSize: '16px',
        fontStyle: 'bold',
        color: MENU_COLORS_CSS.danger,
        backgroundColor: '#1c1c2a',
        padding: { left: 7, right: 7, top: 3, bottom: 3 },
      })
      .setOrigin(1, 0)
      .setVisible(false);
    const mouseFocusBadge = this.add
      .text(cx, cy - height / 2 - 12, 'MOUSE', {
        fontFamily: MENU_FONT,
        fontSize: '11px',
        fontStyle: 'bold',
        color: MENU_COLORS_CSS.panelDark,
        backgroundColor: MENU_COLORS_CSS.gold,
        padding: { left: 5, right: 5, top: 1, bottom: 1 },
      })
      .setOrigin(0.5)
      .setVisible(false);

    // Palette swatch strip.
    const swatchSize = (width * 0.8) / PALETTE_COUNT - 3;
    const swatchY = cy + height * 0.395;
    const swatches: Phaser.GameObjects.Rectangle[] = [];
    const swatchBounds: Phaser.Geom.Rectangle[] = [];
    for (let p = 0; p < PALETTE_COUNT; p += 1) {
      const sx =
        cx - ((PALETTE_COUNT - 1) * (swatchSize + 3)) / 2 + p * (swatchSize + 3);
      const swatch = this.add
        .rectangle(sx, swatchY, swatchSize, swatchSize, 0x444455)
        .setOrigin(0.5)
        .setStrokeStyle(1, 0x666677)
        .setVisible(false);
      swatches.push(swatch);
      swatchBounds.push(
        new Phaser.Geom.Rectangle(
          sx - swatchSize / 2,
          swatchY - swatchSize / 2,
          swatchSize,
          swatchSize,
        ),
      );
    }

    const leaveBoundsRect = leaveButton.getBounds();
    const cpuBoundsRect = cpuButton.getBounds();
    const diffBoundsRect = diffButton.getBounds();

    return {
      slotIndex,
      panel,
      badge,
      joinHint,
      joinSubHint,
      cpuButton,
      bodyRect,
      bodySprite,
      bodySpriteDisplayHeight,
      facingMark,
      nameLabel,
      roleLabel,
      inputLabel,
      cpuChip,
      diffButton,
      leaveButton,
      mouseFocusBadge,
      swatches,
      x: cx,
      y: cy,
      width,
      height,
      cardBounds: new Phaser.Geom.Rectangle(cx - width / 2, cy - height / 2, width, height),
      cpuButtonBounds: new Phaser.Geom.Rectangle(
        cpuBoundsRect.x,
        cpuBoundsRect.y,
        cpuBoundsRect.width,
        cpuBoundsRect.height,
      ),
      diffButtonBounds: new Phaser.Geom.Rectangle(
        diffBoundsRect.x,
        diffBoundsRect.y,
        diffBoundsRect.width,
        diffBoundsRect.height,
      ),
      leaveButtonBounds: new Phaser.Geom.Rectangle(
        leaveBoundsRect.x,
        leaveBoundsRect.y,
        leaveBoundsRect.width,
        leaveBoundsRect.height,
      ),
      swatchBounds,
    };
  }

  private buildHandCursor(slotIndex: 1 | 2 | 3 | 4): HandCursorGameObjects {
    const colour = SLOT_HAND_COLOURS[slotIndex];
    const container = this.add.container(0, 0).setDepth(1000);
    const outline = this.add
      .triangle(0, 0, 0, 0, 0, 24, 18, 14, HAND_OUTLINE_COLOUR)
      .setOrigin(0, 0);
    const fill = this.add
      .triangle(2, 2, 0, 0, 0, 20, 14, 12, colour)
      .setOrigin(0, 0);
    const label = this.add
      .text(20, 8, `P${slotIndex}`, {
        fontFamily: MENU_FONT,
        fontSize: '11px',
        fontStyle: 'bold',
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
    for (let i = 0; i < this.cards.length; i += 1) {
      const card = this.cards[i];
      const slotState = projected.slots[i];
      const handSlot = this.state.slots[i];
      if (!card || !slotState || !handSlot) continue;
      const preview = buildSlotPreview(slotState);
      const swatches = buildSlotPaletteSwatches(slotState);
      this.refreshPlayerCard(card, preview, swatches, handSlot.mode);
    }
    this.refreshBanner(projected);
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
      cell.selectedBySlots.length > 0 ? MENU_COLORS.gold : MENU_COLORS.panelBorder,
    );
    const firstHover = cell.hoveredBySlots[0];
    tile.hoverFrame.setVisible(cell.hoveredBySlots.length > 0);
    if (firstHover !== undefined) {
      tile.hoverFrame.setStrokeStyle(3, SLOT_HAND_COLOURS[firstHover]);
      tile.hoverBadge.setVisible(true);
      tile.hoverBadge.setText(cell.hoveredBySlots.map((s) => `P${s}`).join(' '));
      tile.hoverBadge.setColor(playerColorCss(firstHover));
    } else {
      tile.hoverBadge.setVisible(false);
    }
    for (let s = 0; s < tile.slotChips.length; s += 1) {
      const chip = tile.slotChips[s];
      if (!chip) continue;
      chip.setVisible(cell.selectedBySlots.includes((s + 1) as 1 | 2 | 3 | 4));
    }
  }

  private refreshPlayerCard(
    card: PlayerCardGameObjects,
    preview: CharacterSelectSlotPreview,
    swatches: ReadonlyArray<CharacterSelectPaletteSwatch>,
    mode: 'empty' | 'human' | 'bot',
  ): void {
    const colour = SLOT_HAND_COLOURS[card.slotIndex];
    const joined = mode !== 'empty';

    // Panel redraw — player-coloured border + tinted fill when joined,
    // dim neutral when empty.
    card.panel.clear();
    card.panel.fillStyle(MENU_COLORS.panel, joined ? 0.96 : 0.55);
    card.panel.fillRoundedRect(
      card.x - card.width / 2,
      card.y - card.height / 2,
      card.width,
      card.height,
      12,
    );
    if (joined) {
      card.panel.fillStyle(colour, 0.08);
      card.panel.fillRoundedRect(
        card.x - card.width / 2,
        card.y - card.height / 2,
        card.width,
        card.height,
        12,
      );
    }
    card.panel.lineStyle(joined ? 3 : 2, joined ? colour : MENU_COLORS.panelBorder, 1);
    card.panel.strokeRoundedRect(
      card.x - card.width / 2,
      card.y - card.height / 2,
      card.width,
      card.height,
      12,
    );

    // Empty-state affordances.
    card.joinHint.setVisible(!joined);
    card.joinSubHint.setVisible(!joined);
    card.cpuButton.setVisible(!joined);

    // Joined-state objects.
    card.bodyRect.setVisible(joined);
    card.facingMark.setVisible(joined);
    card.nameLabel.setVisible(joined);
    card.roleLabel.setVisible(joined);
    card.inputLabel.setVisible(joined);
    card.leaveButton.setVisible(joined);
    card.cpuChip.setVisible(mode === 'bot');
    card.diffButton.setVisible(mode === 'bot');
    for (const swatch of card.swatches) swatch.setVisible(joined);

    if (!joined) {
      card.bodySprite.setVisible(false);
      card.mouseFocusBadge.setVisible(this.focusedMouseSlotIndex === card.slotIndex);
      return;
    }

    // AC 10303 Sub-AC 3 — the live card preview runs through the SAME
    // palette pipeline the match render uses.
    const swap = paletteSwapForCharacter(
      preview.slotIndex,
      preview.characterId,
      preview.paletteIndex,
    );
    const renderResult = this.paletteRenderer.paint(
      `slot-${preview.slotIndex}`,
      { body: card.bodyRect, facingMark: card.facingMark },
      {
        index: preview.slotIndex,
        characterId: preview.characterId,
        paletteIndex: preview.paletteIndex,
      },
      { bodyFillAlpha: 1, bodyStrokeAlpha: 1 },
    );
    // Capture the shader remap descriptor so a future sprite drop-in
    // can consume it without re-deriving the colour pairs.
    const remap: PaletteSwapRemap = renderResult.remap;
    void remap;
    applyPaletteSwap(
      { body: card.bodyRect, facingMark: card.facingMark },
      swap,
      { bodyFillAlpha: 1, bodyStrokeAlpha: 1 },
    );

    card.nameLabel.setText(preview.displayName.toUpperCase());
    card.roleLabel.setText(preview.roleLabel.toUpperCase());
    // A restored gamepad slot whose physical pad didn't survive the
    // scene restart is input-dead until a pad presses Ⓐ and re-adopts
    // it (the joinPad orphan-adoption path, Smash-style). Surface that
    // on the card in a warning tint instead of silently claiming a
    // live GAMEPAD binding — match start is deliberately NOT gated.
    const orphanedGamepad =
      mode === 'human' &&
      preview.inputType === 'gamepad' &&
      !new Set(this.padAssignments.values()).has(card.slotIndex);
    card.inputLabel.setText(formatInputTypeLabel(mode, preview, orphanedGamepad));
    card.inputLabel.setColor(
      orphanedGamepad ? MENU_COLORS_CSS.gold : MENU_COLORS_CSS.textDim,
    );
    if (mode === 'bot') {
      card.diffButton.setText(`LV · ${(preview.aiDifficulty ?? 'medium').toUpperCase()}`);
    }
    for (let p = 0; p < card.swatches.length; p += 1) {
      const swatch = card.swatches[p];
      const data = swatches[p];
      if (!swatch || !data) continue;
      swatch.fillColor = data.primaryColor;
      swatch.setStrokeStyle(data.active ? 3 : 1, data.active ? MENU_COLORS.gold : 0x666677);
    }
    card.mouseFocusBadge.setVisible(this.focusedMouseSlotIndex === card.slotIndex);

    // Swap the body sprite to the picked character's idle frame.
    const spec = getCharacterSpec(preview.characterId);
    const spriteKey = spec.placeholder.spriteKey;
    if (spriteKey && this.textures.exists(spriteKey)) {
      card.bodySprite.setTexture(spriteKey);
      applySpriteDisplayHeight(card.bodySprite, card.bodySpriteDisplayHeight);
      card.bodySprite.setVisible(true);
      // The sprite is the visible character; dim the underlying
      // colour rect so it reads as a debug hurtbox rather than a
      // duplicate body.
      card.bodyRect.setAlpha(0.15);
    } else {
      card.bodySprite.setVisible(false);
      card.bodyRect.setAlpha(1);
    }
  }

  /**
   * READY TO FIGHT banner — the single match-start status surface.
   * Because join = picked, the only gate is "are there ≥ 2 fighters?"
   * (plus the defensive palette-collision check in canConfirmMatch).
   */
  private refreshBanner(projected: CharacterSelectState): void {
    if (!this.bannerBand || !this.bannerLabel) return;
    const joined = participatingSlotCount(this.state);
    const canStart = joined >= 2 && canConfirmMatch(projected);
    if (canStart) {
      this.bannerBand.setVisible(true);
      this.bannerTween?.resume();
      this.bannerLabel.setText('READY TO FIGHT  —  PRESS ENTER OR START');
      this.bannerLabel.setColor(MENU_COLORS_CSS.panelDark);
      this.bannerLabel.setFontStyle('bold');
      return;
    }
    this.bannerBand.setVisible(false);
    this.bannerTween?.pause();
    this.bannerBand.setAlpha(1);
    this.bannerLabel.setColor(MENU_COLORS_CSS.textSecondary);
    this.bannerLabel.setText(
      joined === 0
        ? 'Press Ⓐ on a gamepad — or click a fighter — to join'
        : 'Add a second player or a CPU to start',
    );
  }

  private refreshHandCursors(): void {
    const padSlots = new Set(this.padAssignments.values());
    for (let i = 0; i < this.hands.length; i += 1) {
      const hand = this.hands[i];
      const slot = this.state.slots[i];
      if (!hand || !slot) continue;
      hand.container.setPosition(slot.cursor.x, slot.cursor.y);
      // The focused mouse slot's hand is ALWAYS visible — it IS the
      // mouse cursor surrogate. Pad-bound hands show too; idle slots
      // (bots, unbound) hide theirs.
      const isFocusedMouse = slot.index === this.focusedMouseSlotIndex;
      hand.container.setVisible(isFocusedMouse || padSlots.has(slot.index));
    }
  }

  // -------------------------------------------------------------------------
  // Confirm / cancel
  // -------------------------------------------------------------------------

  /**
   * Confirm — forward the lineup to `StageSelectScene` (fighters first,
   * arena last — the Smash flow). The stage select then launches
   * `MatchScene` with the completed config.
   */
  private handleConfirm(): void {
    const projected = toCharacterSelectState(this.state);
    if (!canConfirmMatch(projected)) return;
    const players = buildPlayerSlotsFromHandCursor(this.state);
    // MatchScene's StockTracker indexes by player index 0..N-1 and the
    // match render path assumes ≥ 2 fighters — gate on a min-of-2
    // lineup so the lobby surfaces the requirement instead of dumping
    // into a broken match.
    if (players.length < 2) return;
    const base = this.pendingMatchConfig ?? this.fallbackPendingMatchConfig();
    this.scene.start('StageSelectScene', {
      pendingMatchConfig: { ...base, players },
      lobby: this.pendingLobby,
    });
  }

  private fallbackPendingMatchConfig(): NonNullable<
    CharacterSelectSceneData['pendingMatchConfig']
  > {
    const registrySeed = this.registry.get(BOOT_REGISTRY_KEYS.rngSeed) as
      | number
      | undefined;
    const rngSeed =
      typeof registrySeed === 'number' && Number.isFinite(registrySeed)
        ? registrySeed
        : GAME_CONFIG.defaultRngSeed;
    return {
      mode: 'stocks',
      stockCount: 3,
      stageId: FLAT_STAGE.id,
      rngSeed,
    } as NonNullable<CharacterSelectSceneData['pendingMatchConfig']>;
  }

  private handleCancel(): void {
    this.scene.start('ModeSelectScene', { lobby: this.pendingLobby });
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

/**
 * Per-slot input-device label. `orphanedGamepad` marks a human gamepad
 * slot with NO physical pad currently bound (a restored lobby whose
 * pad bindings didn't survive the scene restart) — the label becomes a
 * re-adopt prompt, since one Ⓐ press re-binds the slot.
 */
function formatInputTypeLabel(
  mode: 'empty' | 'human' | 'bot',
  preview: CharacterSelectSlotPreview,
  orphanedGamepad = false,
): string {
  if (mode === 'empty') return '';
  if (mode === 'bot') {
    const tier = preview.aiDifficulty?.toUpperCase() ?? 'MEDIUM';
    return `CPU — ${tier}`;
  }
  switch (preview.inputType) {
    case 'keyboard_p1':
      return 'KEYBOARD — P1 KEYS';
    case 'keyboard_p2':
      return 'KEYBOARD — P2 KEYS';
    case 'gamepad':
      return orphanedGamepad ? 'GAMEPAD — PRESS Ⓐ' : 'GAMEPAD';
    case 'ai':
      return 'CPU';
  }
}

// Re-export under the legacy name so existing import sites keep working.
export { SLOT_HAND_COLOURS };
