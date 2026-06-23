import Phaser from 'phaser';
import {
  DEFAULT_LOBBY_STATE,
  MAX_LOBBY_SLOTS,
  buildLobbyHandoffPayload,
  buildLobbySlotPreview,
  canConfirmLobby,
  canStartLobby,
  cycleSlotAiDifficulty,
  cycleSlotInputType,
  getJoinedSlotCount,
  getReadySlotCount,
  leaveSlot,
  pollGamepadPressStartJoins,
  pressStartJoinFromKeyboard,
  toggleSlotHumanAi,
  toggleSlotReady,
  type GamepadHeldButtonState,
  type LobbyHandoffPayload,
  type LobbySlotPreview,
  type LobbySlotState,
  type LobbyState,
  type PressStartGamepadSnapshot,
} from './lobby';
import {
  buildSnapshotFromGamepads,
  detectActiveInputDevice,
  getDetectedDeviceTint,
  type DetectedDeviceState,
  type DetectionGamepadSnapshot,
  type InputDeviceSnapshot,
} from './inputDeviceDetection';

/**
 * LobbyScene — AC 2 Sub-AC 5.
 *
 * "Implement lobby flow with Press Start to join for up to 4 players,
 * slot assignment, and transition into character select."
 *
 * Sits between `MainMenuScene` and `ModeSelectScene` so the player(s)
 * acquire their slots BEFORE the match shape (mode/stocks/timer) and
 * arena are picked. The sequence is:
 *
 *   MainMenuScene → LobbyScene → ModeSelectScene → StageSelectScene
 *                 → CharacterSelectScene → MatchScene
 *
 * Why a dedicated lobby scene
 * ---------------------------
 *
 * The Seed's project ontology has a `playerSlot` concept whose
 * acquisition (Press Start to Join + input device assignment) is
 * conceptually distinct from character selection (pick a fighter +
 * palette + ready up). Splitting them gives every player time to
 * grab a controller and confirm "I'm here" before anyone has to
 * decide what to play.
 *
 * The downstream `CharacterSelectScene` already supports inline
 * "Press Start to Join" semantics for backward compatibility, but the
 * canonical 4-player flow runs through this lobby first. The
 * character-select scene reads the lobby's hand-off payload when
 * present and pre-populates its `joined` / `inputType` slot fields,
 * so a player who claimed slot 3 in the lobby walks into character
 * select with slot 3 already lit up — no second Press Start needed.
 *
 * Per-slot keyboard controls
 * --------------------------
 *
 * Mirrors the `CharacterSelectScene.SLOT_CONTROLS` table so the
 * keyboard layout the player learned in the lobby carries through to
 * the next scene:
 *
 *   • Slot 1 — JOIN: [1]   CYCLE: TAB   LEAVE: [1] (toggle)
 *   • Slot 2 — JOIN: [2]   CYCLE: T     LEAVE: [2] (toggle)
 *   • Slot 3 — JOIN: [3]   CYCLE: U     LEAVE: [3] (toggle)
 *   • Slot 4 — JOIN: [4]   CYCLE: O     LEAVE: [4] (toggle)
 *   • ENTER → advance to ModeSelectScene (gated on ≥ 1 joined slot).
 *   • ESC   → back to MainMenuScene.
 *
 * The number-row key is contextual:
 *   • un-joined slot  → JOIN with the slot's default input type.
 *   • joined slot     → LEAVE (drops back to un-joined).
 *
 * The cycle key swaps between AI ↔ keyboard halves on the slot's
 * existing claim (skipping options already taken by another slot).
 *
 * Determinism
 * -----------
 *
 * Every transition is deterministic. There is no `Math.random()`, no
 * wall-clock read, no environment lookup; the only state hidden from
 * the helper layer is the live `Phaser.GameObjects` cache, which is
 * pure render and never feeds back into gameplay. The resulting
 * `LobbyHandoffPayload` is byte-identical for two lobbies that
 * joined the same devices in the same order, which keeps replays
 * reproducible.
 */
export interface LobbySceneData {
  // Reserved for forward compatibility — the lobby is currently the
  // first scene after the main menu and doesn't read any payload.
  // Including the type lets a future scene-data field land without
  // breaking the public scene API.
  readonly _reserved?: never;
}

interface SlotTileGameObjects {
  readonly container: Phaser.GameObjects.Container;
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly headerLabel: Phaser.GameObjects.Text;
  readonly statusLabel: Phaser.GameObjects.Text;
  readonly hintLabel: Phaser.GameObjects.Text;
  readonly joinedBanner: Phaser.GameObjects.Text;
  /**
   * AC 10402 Sub-AC 2 — top-of-tile badge that surfaces the slot's
   * ready state ("READY ✓" / "NOT READY") so the player can confirm
   * at a glance which slots are confirmed.
   */
  readonly readyBadge: Phaser.GameObjects.Text;
  /**
   * AC 10402 Sub-AC 2 — top-of-tile badge that classifies the slot as
   * HUMAN or AI without forcing the player to read the device label.
   */
  readonly humanAiBadge: Phaser.GameObjects.Text;
  /**
   * AC 50002 Sub-AC 2 — live "DETECTED:" chip that surfaces the
   * actively connected device for this slot. Distinct from the
   * authoring-time `statusLabel` ("KEYBOARD (WASD)") in two ways:
   *
   *   1. The chip flips to a warning state if the configured device
   *      walks off mid-lobby (e.g. a gamepad is unplugged) — the
   *      status label stays on the configured value.
   *   2. The chip is computed by polling `navigator.getGamepads()` on
   *      the same per-frame `update()` that drives Press-Start joins,
   *      so the player sees the chip flip the moment they plug a pad
   *      in (no scene reload required).
   */
  readonly deviceChip: Phaser.GameObjects.Text;
}

/**
 * Per-slot keyboard control map. Mirrors the layout used by
 * `CharacterSelectScene.SLOT_CONTROLS` so the keys the player learns
 * here keep working after the lobby hand-off.
 *
 *   • `joinKey`  — toggles join / leave on the slot's number-row key
 *                  (1, 2, 3, 4).
 *   • `cycleKey` — rotates the slot's input type between AI ↔ keyboard
 *                  halves (TAB / T / U / O for slots 1..4).
 *   • `diffKey`  — AC 10205 Sub-AC 5 — rotates the AI difficulty
 *                  through `easy → medium → hard → easy` on AI slots.
 *                  Bound on every slot but only takes effect when the
 *                  slot's `inputType === 'ai'`. Q / Y / I / P sit one
 *                  row above the cycle key so a player can quickly
 *                  alternate between "is this a bot?" and "what kind?".
 */
const SLOT_CONTROLS: ReadonlyArray<{
  readonly slotIndex: 1 | 2 | 3 | 4;
  readonly joinKey: string;
  readonly joinKeyLabel: string;
  readonly cycleKey: string;
  readonly cycleKeyLabel: string;
  readonly diffKey: string;
  readonly diffKeyLabel: string;
  /**
   * AC 10402 Sub-AC 2 — Phaser key code + printable label for the
   * per-slot READY toggle. Pressing it on a joined slot flips the
   * `ready` flag; pressing on an un-joined slot is a silent no-op
   * (the helper enforces `ready ⇒ joined`).
   */
  readonly readyKey: string;
  readonly readyKeyLabel: string;
  /**
   * AC 10402 Sub-AC 2 — per-slot human/AI binary toggle. Distinct
   * from the 4-state `cycleKey` device cycle — this key always flips
   * "is this slot a human or a bot?" in one press, which keeps the
   * UI obvious for players who don't want to walk a four-step cycle
   * just to swap a bot in for a human.
   */
  readonly humanAiKey: string;
  readonly humanAiKeyLabel: string;
}> = Object.freeze([
  Object.freeze({
    slotIndex: 1 as const,
    joinKey: 'ONE',
    joinKeyLabel: '1',
    cycleKey: 'TAB',
    cycleKeyLabel: 'TAB',
    diffKey: 'Q',
    diffKeyLabel: 'Q',
    readyKey: 'R',
    readyKeyLabel: 'R',
    humanAiKey: 'Z',
    humanAiKeyLabel: 'Z',
  }),
  Object.freeze({
    slotIndex: 2 as const,
    joinKey: 'TWO',
    joinKeyLabel: '2',
    cycleKey: 'T',
    cycleKeyLabel: 'T',
    diffKey: 'Y',
    diffKeyLabel: 'Y',
    readyKey: 'G',
    readyKeyLabel: 'G',
    humanAiKey: 'X',
    humanAiKeyLabel: 'X',
  }),
  Object.freeze({
    slotIndex: 3 as const,
    joinKey: 'THREE',
    joinKeyLabel: '3',
    cycleKey: 'U',
    cycleKeyLabel: 'U',
    diffKey: 'I',
    diffKeyLabel: 'I',
    readyKey: 'H',
    readyKeyLabel: 'H',
    humanAiKey: 'C',
    humanAiKeyLabel: 'C',
  }),
  Object.freeze({
    slotIndex: 4 as const,
    joinKey: 'FOUR',
    joinKeyLabel: '4',
    cycleKey: 'O',
    cycleKeyLabel: 'O',
    diffKey: 'P',
    diffKeyLabel: 'P',
    readyKey: 'K',
    readyKeyLabel: 'K',
    humanAiKey: 'V',
    humanAiKeyLabel: 'V',
  }),
]);

export class LobbyScene extends Phaser.Scene {
  private state: LobbyState = DEFAULT_LOBBY_STATE;

  private tiles: SlotTileGameObjects[] = [];

  /**
   * Lobby-status header that summarises "X of 4 joined — press ENTER
   * to start" so the player can see the advance gate at a glance.
   */
  private headerLabel: Phaser.GameObjects.Text | undefined = undefined;

  /**
   * AC 10401 Sub-AC 1 — tracks per-pad per-button held state across
   * frames so a Press-Start edge fires once per physical press, not
   * every frame the button stays down. Outer key = `Gamepad.index`,
   * inner key = button index. Owned by {@link pollGamepadPressStartJoins}
   * which mutates the map in place.
   *
   * Reset on `init()` so a re-entry from `MainMenuScene` always
   * starts with an empty held cache — otherwise a player who held
   * Start through the menu transition would skip past the lobby's
   * intended "fresh press" join semantic.
   */
  private padButtonHeld: GamepadHeldButtonState = new Map();

  /**
   * AC 50002 Sub-AC 2 — last device snapshot the chip row was painted
   * from. The per-frame `update()` rebuilds the snapshot, compares it
   * to this cache, and short-circuits when the snapshot is unchanged
   * so the lobby stays cheap (no string allocation when the device
   * topology is stable). Reset on `init()` so re-entering the scene
   * re-paints from a fresh poll instead of replaying a stale chip.
   */
  private lastDeviceSnapshot: InputDeviceSnapshot | null = null;

  /**
   * Separate held-state map for per-slot gamepad actions (ready/leave/
   * cycle/confirm/cancel). Kept independent of `padButtonHeld` so the
   * join-polling pass (which consumes face-button edges for new joins)
   * does not swallow the same edge before the slot-action pass can see
   * it. Both maps are reset on init() so re-entries start clean.
   */
  private padSlotButtonHeld: GamepadHeldButtonState = new Map();

  constructor() {
    super({ key: 'LobbyScene' });
  }

  init(_data?: LobbySceneData): void {
    this.state = DEFAULT_LOBBY_STATE;
    this.padButtonHeld = new Map();
    this.padSlotButtonHeld = new Map();
    this.lastDeviceSnapshot = null;
  }

  create(): void {
    const { width, height } = this.scale.gameSize;

    // ---- Title -------------------------------------------------------------
    this.add
      .text(width / 2, height * 0.08, 'PLAYER LOBBY', {
        fontFamily: 'monospace',
        fontSize: '52px',
        color: '#e8e8f0',
      })
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        height * 0.14,
        'Press [1..4] (or any gamepad button) to JOIN — TAB/T/U/O cycle device — Q/Y/I/P cycle AI difficulty',
        {
          fontFamily: 'monospace',
          fontSize: '21px',
          color: '#a0a0b8',
        },
      )
      .setOrigin(0.5);

    // AC 10402 Sub-AC 2 — surface the dedicated ready / human-AI keys
    // on a second hint row so the player sees the per-slot management
    // controls at a glance (separate row keeps the primary hint above
    // readable and avoids running off-screen on narrow viewports).
    this.add
      .text(
        width / 2,
        height * 0.165,
        'Per-slot: R/G/H/K READY UP — Z/X/C/V toggle HUMAN/AI',
        {
          fontFamily: 'monospace',
          fontSize: '20px',
          color: '#88a0d0',
        },
      )
      .setOrigin(0.5);

    this.headerLabel = this.add
      .text(width / 2, height * 0.18, '', {
        fontFamily: 'monospace',
        fontSize: '21px',
        color: '#888899',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    // ---- Slot tiles --------------------------------------------------------
    const tileWidth = Math.min(280, (width - 80) / MAX_LOBBY_SLOTS);
    const tileHeight = Math.min(260, height * 0.42);
    const tileGap = (width - tileWidth * MAX_LOBBY_SLOTS) / (MAX_LOBBY_SLOTS + 1);
    const tileTop = height * 0.28;

    this.tiles = [];
    for (let i = 0; i < MAX_LOBBY_SLOTS; i += 1) {
      const tileX = tileGap + i * (tileWidth + tileGap) + tileWidth / 2;
      const tileY = tileTop + tileHeight / 2;
      this.tiles.push(this.buildSlotTile(tileX, tileY, tileWidth, tileHeight, i));
    }

    // ---- Footer help -------------------------------------------------------
    this.add
      .text(
        width / 2,
        height * 0.84,
        '[ENTER] or [START] continue to character select',
        {
          fontFamily: 'monospace',
          fontSize: '24px',
          color: '#a0a0b8',
        },
      )
      .setOrigin(0.5);

    this.add
      .text(width / 2, height * 0.89, '[ESC] or [SELECT] back to main menu', {
        fontFamily: 'monospace',
        fontSize: '21px',
        color: '#888899',
      })
      .setOrigin(0.5);

    // First paint after tile objects exist.
    this.refreshAllTiles();

    // ---- Key bindings ------------------------------------------------------
    const kb = this.input.keyboard;
    if (kb) {
      for (const ctl of SLOT_CONTROLS) {
        kb.on(`keydown-${ctl.joinKey}`, () => this.handleJoinToggle(ctl.slotIndex));
        kb.on(`keydown-${ctl.cycleKey}`, () =>
          this.handleCycleInput(ctl.slotIndex),
        );
        // AC 10205 Sub-AC 5 — per-slot AI difficulty cycle key. The
        // helper is a silent no-op on non-AI / un-joined slots so this
        // binding is safe to wire on every slot regardless of state.
        kb.on(`keydown-${ctl.diffKey}`, () =>
          this.handleCycleAiDifficulty(ctl.slotIndex),
        );
        // AC 10402 Sub-AC 2 — per-slot READY toggle. The helper is a
        // silent no-op on un-joined slots so binding the key on every
        // slot regardless of state is safe.
        kb.on(`keydown-${ctl.readyKey}`, () =>
          this.handleToggleReady(ctl.slotIndex),
        );
        // AC 10402 Sub-AC 2 — per-slot HUMAN/AI binary toggle.
        kb.on(`keydown-${ctl.humanAiKey}`, () =>
          this.handleToggleHumanAi(ctl.slotIndex),
        );
      }
      kb.on('keydown-ENTER', () => this.handleConfirm());
      kb.on('keydown-ESC', () => this.handleCancel());
    }

    // ---- Gamepad polling ---------------------------------------------------
    // Phaser exposes `this.input.gamepad` once Phaser's input plugin is
    // wired (see `engine/GameConfig.ts` — `input.gamepad: true`). On
    // every render frame we look for a Gamepad whose button 0 (the
    // canonical "A / Start" button) just transitioned from up to down
    // and route that into a slot claim. The simulated test harness
    // mocks this away — `update()` only runs under the live game.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.removeAllListeners();
    });
  }

  /**
   * Polled per frame by Phaser. We piggy-back on the render loop to
   * sample the Gamepad API. Each unrecognised pad-button-down fires
   * a "next free slot" claim so a player who plugs a pad in mid-
   * lobby can join just by pressing any face button.
   *
   * AC 50002 Sub-AC 2 — also re-runs the active-device detection so
   * the per-tile chip flips the moment a gamepad walks off (or
   * reconnects). The detection helper is pure and the chip painter
   * short-circuits on an unchanged snapshot, so this is cheap.
   */
  update(): void {
    this.pollGamepadJoins();
    this.pollGamepadSlotActions();
    this.refreshDeviceChips();
  }

  // -------------------------------------------------------------------------
  // Public test seam
  // -------------------------------------------------------------------------

  /**
   * Read-only snapshot of the live lobby state. Exposed so tests can
   * poke at the state without reaching into private fields.
   */
  getState(): LobbyState {
    return this.state;
  }

  /**
   * Build the hand-off payload that would be forwarded on confirm.
   * Exposed so tests / debug tooling can introspect the payload
   * without having to drive a full scene transition.
   */
  getHandoffPayload(): LobbyHandoffPayload {
    return buildLobbyHandoffPayload(this.state);
  }

  // -------------------------------------------------------------------------
  // Input handlers — each one forwards into the pure helper, then
  // re-paints if anything changed.
  // -------------------------------------------------------------------------

  private handleJoinToggle(slotIndex: 1 | 2 | 3 | 4): void {
    const slot = this.state.slots[slotIndex - 1];
    if (!slot) return;
    if (!slot.joined) {
      // AC 10401 Sub-AC 1 — keyboard Press-Start. Routes through the
      // unit-tested helper so the slot's default `InputType` (and the
      // exclusivity rules around it) stay in lockstep with
      // `lobby.test.ts`.
      this.applyTransition(pressStartJoinFromKeyboard(this.state, slotIndex));
      return;
    }
    this.applyTransition(leaveSlot(this.state, slotIndex));
  }

  private handleCycleInput(slotIndex: 1 | 2 | 3 | 4): void {
    this.applyTransition(cycleSlotInputType(this.state, slotIndex));
  }

  /**
   * AC 10205 Sub-AC 5 — per-slot AI difficulty cycle dispatch. Forwards
   * to the helper which silently no-ops on non-AI / un-joined slots so
   * the player can mash the diff key without needing to track which
   * slots are AI bots.
   */
  private handleCycleAiDifficulty(slotIndex: 1 | 2 | 3 | 4): void {
    this.applyTransition(cycleSlotAiDifficulty(this.state, slotIndex));
  }

  /**
   * AC 10402 Sub-AC 2 — per-slot READY toggle dispatch. Routes
   * through the unit-tested helper so the `ready ⇒ joined` invariant
   * is enforced in one place; the scene only owns the rendering.
   */
  private handleToggleReady(slotIndex: 1 | 2 | 3 | 4): void {
    this.applyTransition(toggleSlotReady(this.state, slotIndex));
  }

  /**
   * AC 10402 Sub-AC 2 — per-slot HUMAN/AI binary toggle dispatch.
   * Distinct from the 4-state device cycle — this key always flips
   * "is this slot a human or a bot?" in one press.
   */
  private handleToggleHumanAi(slotIndex: 1 | 2 | 3 | 4): void {
    this.applyTransition(toggleSlotHumanAi(this.state, slotIndex));
  }

  private handleConfirm(): void {
    // Gate the advance on the lobby satisfying its readiness invariant.
    // A premature ENTER (no players joined) is silently ignored so the
    // lobby stays interactive without painting an error modal — the
    // header label already tells the player what's required.
    if (!canStartLobby(this.state)) return;
    const handoff = buildLobbyHandoffPayload(this.state);
    this.scene.start('ModeSelectScene', { lobby: handoff });
  }

  private handleCancel(): void {
    this.scene.start('MainMenuScene');
  }

  /**
   * Apply a candidate state. Returns the same reference (===) on a
   * no-op transition so the helper's idempotency contract feeds
   * directly into the scene's repaint short-circuit.
   */
  private applyTransition(candidate: LobbyState): void {
    if (candidate === this.state) return;
    this.state = candidate;
    this.refreshAllTiles();
  }

  // -------------------------------------------------------------------------
  // Gamepad polling
  // -------------------------------------------------------------------------

  private pollGamepadJoins(): void {
    const padPlugin = this.input.gamepad;
    if (!padPlugin) return;
    const livePads = padPlugin.gamepads;
    if (!livePads) return;

    // Project Phaser's live `Gamepad` instances onto the Phaser-free
    // {@link PressStartGamepadSnapshot} the helper consumes. We pass
    // the actual `buttons` array through — the helper only reads the
    // `.pressed` flag on each entry, which is identical between
    // `GamepadButton` and our snapshot type.
    const snapshots: PressStartGamepadSnapshot[] = [];
    for (let i = 0; i < livePads.length; i += 1) {
      const pad = livePads[i];
      if (!pad) continue;
      snapshots.push({
        index: pad.index,
        // Phaser pads expose `buttons` as a `Gamepad`-shaped array,
        // each entry having a `.pressed` boolean. The helper's
        // sparse-tolerant scan keeps us safe even on pads that
        // report a shorter button list than the standard mapping.
        buttons: pad.buttons as ReadonlyArray<{ readonly pressed: boolean }>,
      });
    }

    // AC 10401 Sub-AC 1 — broaden accepted Press-Start buttons beyond
    // the original "button 0 only" rule. The helper iterates A / B /
    // X / Y / Start so a player on any consumer pad layout can join
    // by pressing the literal "Start" button or any face button.
    const result = pollGamepadPressStartJoins(
      this.state,
      snapshots,
      this.padButtonHeld,
    );
    if (result.state !== this.state) {
      this.state = result.state;
      this.refreshAllTiles();
    }
  }

  /**
   * Per-frame poll for per-slot gamepad actions on pads that already own
   * a slot. Uses a separate held-state map so the join-polling pass does
   * not consume the edges before this pass can see them.
   *
   * Button layout (W3C standard mapping):
   *   0 A/Cross   → ready toggle for the owning slot
   *   1 B/Circle  → leave (drop the slot)
   *   2 X/Square  → cycle input type (keyboard ↔ AI variants)
   *   3 Y/Triangle→ toggle human / AI
   *   8 Select    → cancel (back to main menu) — global, any pad
   *   9 Start     → advance to ModeSelectScene — global, any pad
   */
  private pollGamepadSlotActions(): void {
    const padPlugin = this.input.gamepad;
    if (!padPlugin) return;
    const livePads = padPlugin.gamepads;
    if (!livePads) return;

    // Build pad index → Phaser Gamepad lookup.
    const padMap = new Map<number, { buttons: ReadonlyArray<{ pressed: boolean }> }>();
    for (let i = 0; i < livePads.length; i += 1) {
      const pad = livePads[i];
      if (pad) padMap.set(pad.index, pad as { buttons: ReadonlyArray<{ pressed: boolean }> });
    }

    // Helper: edge-detect a single button on a specific pad using our
    // separate slot-action held map.
    const edge = (padIdx: number, buttonIndex: number): boolean => {
      const pad = padMap.get(padIdx);
      const pressed = pad?.buttons[buttonIndex]?.pressed ?? false;
      let perPad = this.padSlotButtonHeld.get(padIdx);
      if (!perPad) {
        perPad = new Map<number, boolean>();
        this.padSlotButtonHeld.set(padIdx, perPad);
      }
      const wasHeld = perPad.get(buttonIndex) ?? false;
      perPad.set(buttonIndex, pressed);
      return pressed && !wasHeld;
    };

    // Update held state for pads with no slot (so first-press on join frame
    // doesn't re-fire next frame as a slot action after they join).
    for (const pad of livePads) {
      if (!pad) continue;
      const ownedSlot = this.state.slots.find(
        s => s.joined && s.inputType === 'gamepad' && s.gamepadIndex === pad.index,
      );
      if (!ownedSlot) {
        // Keep held state in sync even for unowned pads.
        for (const btn of [0, 1, 2, 3, 8, 9]) edge(pad.index, btn);
      }
    }

    let advanceFired = false;
    let cancelFired = false;

    for (let i = 0; i < this.state.slots.length; i += 1) {
      const slot = this.state.slots[i];
      if (!slot?.joined || slot.inputType !== 'gamepad' || slot.gamepadIndex === undefined) continue;
      const padIdx = slot.gamepadIndex;
      const slotIndex = (i + 1) as 1 | 2 | 3 | 4;

      if (edge(padIdx, 0)) this.handleToggleReady(slotIndex);   // A = ready
      if (edge(padIdx, 1)) this.handleJoinToggle(slotIndex);    // B = leave
      if (edge(padIdx, 2)) this.handleCycleInput(slotIndex);    // X = cycle device
      if (edge(padIdx, 3)) this.handleToggleHumanAi(slotIndex); // Y = human/AI

      if (!advanceFired && edge(padIdx, 9)) {
        advanceFired = true;
        this.handleConfirm(); // START = advance
      }
      if (!cancelFired && edge(padIdx, 8)) {
        cancelFired = true;
        this.handleCancel(); // SELECT = back
      }
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /**
   * Build one slot tile (background panel + header + status + hint +
   * joined banner). All `Phaser.GameObjects` references are stashed
   * on `this.tiles[i]` so `refreshTile` can mutate them in place
   * without re-creating the scene graph on every state change.
   */
  private buildSlotTile(
    cx: number,
    cy: number,
    w: number,
    h: number,
    slotArrayIndex: number,
  ): SlotTileGameObjects {
    const container = this.add.container(cx, cy);

    const bg = this.add
      .rectangle(0, 0, w, h, 0x1a1a26, 1)
      .setStrokeStyle(2, 0x44445a, 1);
    container.add(bg);

    const slotIndex = (slotArrayIndex + 1) as 1 | 2 | 3 | 4;
    const headerLabel = this.add
      .text(0, -h / 2 + 24, `P${slotIndex}`, {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: '#888899',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    container.add(headerLabel);

    // The "JOINED" banner is hidden by default; the refresh pass
    // flips it on whenever the slot reports `joined: true`.
    const joinedBanner = this.add
      .text(0, -h / 2 + 56, 'JOINED', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#6cf0c2',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setVisible(false);
    container.add(joinedBanner);

    // AC 10402 Sub-AC 2 — short HUMAN/AI classification badge sits in
    // the upper-left corner of the tile so the player can see slot
    // type independent of the specific device choice. Hidden by
    // default and lit up by the refresh pass once the slot is joined.
    const humanAiBadge = this.add
      .text(-w / 2 + 12, -h / 2 + 14, '', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#88a0d0',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0.5);
    container.add(humanAiBadge);

    // AC 10402 Sub-AC 2 — READY badge sits in the upper-right corner
    // mirroring the human/AI badge. "READY ✓" / "NOT READY" so the
    // player can see at a glance which slots have confirmed.
    const readyBadge = this.add
      .text(w / 2 - 12, -h / 2 + 14, '', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#888899',
        fontStyle: 'bold',
      })
      .setOrigin(1, 0.5);
    container.add(readyBadge);

    const statusLabel = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#a0a0b8',
        align: 'center',
      })
      .setOrigin(0.5);
    container.add(statusLabel);

    // AC 50002 Sub-AC 2 — live "DETECTED:" chip sits just below the
    // status label so the player can see at a glance which device is
    // actually wired up (vs the configured one shown above). Hidden
    // by default — `refreshDeviceChips` lights it up once a slot
    // joins and the snapshot fills in.
    const deviceChip = this.add
      .text(0, 28, '', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#a0d0e8',
        align: 'center',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setVisible(false);
    container.add(deviceChip);

    const hintLabel = this.add
      .text(0, h / 2 - 24, '', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#666677',
        align: 'center',
        wordWrap: { width: w - 16 },
      })
      .setOrigin(0.5);
    container.add(hintLabel);

    return {
      container,
      bg,
      headerLabel,
      statusLabel,
      hintLabel,
      joinedBanner,
      readyBadge,
      humanAiBadge,
      deviceChip,
    };
  }

  /**
   * Re-paint every tile from the current `LobbyState`. Cheap because
   * every paint operation is structural (`setText`, `setFillStyle`,
   * `setStrokeStyle`) and Phaser short-circuits no-op setter calls.
   */
  private refreshAllTiles(): void {
    for (let i = 0; i < this.tiles.length; i += 1) {
      const tile = this.tiles[i];
      const slot = this.state.slots[i];
      const ctl = SLOT_CONTROLS[i];
      if (!tile || !slot || !ctl) continue;
      // AC 10205 Sub-AC 5 + AC 10402 Sub-AC 2 — pass every per-slot
      // key label so the hint row enumerates every action available
      // on this slot. The preview helper drops segments whose label
      // is undefined, so a future maintainer who unbinds a key gets
      // a hint that auto-shrinks rather than referencing a phantom key.
      const preview = buildLobbySlotPreview(slot, {
        joinKey: ctl.joinKeyLabel,
        cycleKey: ctl.cycleKeyLabel,
        diffKey: ctl.diffKeyLabel,
        readyKey: ctl.readyKeyLabel,
        humanAiKey: ctl.humanAiKeyLabel,
      });
      this.paintTile(tile, slot, preview);
    }
    this.refreshHeaderLabel();
    // AC 50002 Sub-AC 2 — re-paint the per-tile device chips after a
    // state change too. Otherwise a slot that just toggled from ai
    // → keyboard would keep its old chip until the next `update()`
    // tick (a perceptible flicker on a fast input).
    // Force the chip refresh by invalidating the cached snapshot —
    // simplest way to reuse the polling path's idempotency check.
    this.lastDeviceSnapshot = null;
    this.refreshDeviceChips();
  }

  /**
   * AC 50002 Sub-AC 2 — re-paint the per-tile "DETECTED:" chip on
   * every tile from the live device topology snapshot.
   *
   * Invoked from `update()` (per-frame, picks up gamepad
   * connect/disconnect transitions) and from `refreshAllTiles()`
   * (after a lobby state change, picks up input-type cycles).
   *
   * Cheap when nothing changed — the per-frame call short-circuits on
   * an unchanged snapshot. The state-change path forcibly invalidates
   * the cache so a configured-device cycle (e.g. AI → keyboard)
   * always re-paints, even if the runtime gamepad list is unchanged.
   */
  private refreshDeviceChips(): void {
    const snapshot = this.captureDeviceSnapshot();
    if (this.snapshotsEqual(snapshot, this.lastDeviceSnapshot)) return;
    this.lastDeviceSnapshot = snapshot;
    for (let i = 0; i < this.tiles.length; i += 1) {
      const tile = this.tiles[i];
      const slot = this.state.slots[i];
      if (!tile || !slot) continue;
      const detected = detectActiveInputDevice(slot, snapshot);
      this.paintDeviceChip(tile, detected);
    }
  }

  private paintDeviceChip(
    tile: SlotTileGameObjects,
    detected: DetectedDeviceState,
  ): void {
    const visible = detected.label !== '';
    tile.deviceChip.setVisible(visible);
    if (!visible) return;
    tile.deviceChip.setText(`DETECTED: ${detected.label}`);
    tile.deviceChip.setColor(getDetectedDeviceTint(detected));
  }

  /**
   * Build an {@link InputDeviceSnapshot} from the live Phaser gamepad
   * plugin (or an empty list if the plugin is unavailable, e.g. in a
   * test harness without `input.gamepad: true`). Mirrors the read
   * pattern in {@link pollGamepadJoins} but projects through the
   * detection module's snapshot shape rather than the Press-Start one.
   */
  private captureDeviceSnapshot(): InputDeviceSnapshot {
    const padPlugin = this.input.gamepad;
    const livePads = padPlugin?.gamepads ?? [];
    const projected: DetectionGamepadSnapshot[] = [];
    for (let i = 0; i < livePads.length; i += 1) {
      const pad = livePads[i];
      if (!pad) continue;
      // Phaser's Gamepad wrapper exposes `connected` matching the
      // browser flag. Some Phaser versions omit it on the wrapper —
      // the helper tolerates undefined and treats it as connected.
      const padShape: DetectionGamepadSnapshot = {
        index: pad.index,
        ...(typeof (pad as { connected?: boolean }).connected === 'boolean'
          ? { connected: (pad as { connected: boolean }).connected }
          : {}),
      };
      projected.push(padShape);
    }
    return buildSnapshotFromGamepads(projected, true);
  }

  /**
   * Cheap structural equality check on two {@link InputDeviceSnapshot}
   * records. Avoids re-painting the chip row when the gamepad
   * topology + keyboard availability are unchanged.
   */
  private snapshotsEqual(
    a: InputDeviceSnapshot,
    b: InputDeviceSnapshot | null,
  ): boolean {
    if (b === null) return false;
    if (a.keyboardAvailable !== b.keyboardAvailable) return false;
    if (a.connectedGamepadIndices.length !== b.connectedGamepadIndices.length) {
      return false;
    }
    for (let i = 0; i < a.connectedGamepadIndices.length; i += 1) {
      if (a.connectedGamepadIndices[i] !== b.connectedGamepadIndices[i]) {
        return false;
      }
    }
    return true;
  }

  private paintTile(
    tile: SlotTileGameObjects,
    slot: LobbySlotState,
    preview: LobbySlotPreview,
  ): void {
    tile.headerLabel.setText(preview.headerLabel);
    tile.headerLabel.setColor(slot.joined ? '#e8e8f0' : '#888899');

    tile.statusLabel.setText(preview.statusLabel);
    tile.statusLabel.setColor(slot.joined ? '#e8e8f0' : '#888899');

    // For gamepad slots show button hints instead of keyboard key hints.
    const hintText =
      slot.joined && slot.inputType === 'gamepad'
        ? 'Ⓐ READY  Ⓑ LEAVE\nⓍ CYCLE  Ⓨ H/AI'
        : preview.hintLabel;
    tile.hintLabel.setText(hintText);
    tile.hintLabel.setColor(slot.joined ? '#a0a0b8' : '#6cf0c2');

    tile.joinedBanner.setVisible(slot.joined);

    // AC 10402 Sub-AC 2 — paint the ready / human-AI badges. The
    // preview helper produces empty strings for un-joined slots so
    // the badges visibly fade out when the player leaves.
    tile.readyBadge.setText(preview.readyBadge);
    tile.readyBadge.setColor(slot.ready ? '#6cf0c2' : '#d0a060');
    tile.humanAiBadge.setText(preview.humanAiBadge);
    tile.humanAiBadge.setColor(slot.inputType === 'ai' ? '#d0a0f0' : '#88a0d0');

    // Border treatment escalates with state: un-joined → grey,
    // joined-not-ready → cyan, ready → green so the player gets a
    // strong visual signal that a slot is locked in.
    let borderColor = 0x44445a;
    let borderWidth = 2;
    if (slot.joined) {
      borderColor = slot.ready ? 0x6cf0c2 : 0x88a0d0;
      borderWidth = 3;
    }
    tile.bg.setStrokeStyle(borderWidth, borderColor, 1);
  }

  private refreshHeaderLabel(): void {
    const label = this.headerLabel;
    if (!label) return;
    const joined = getJoinedSlotCount(this.state);
    const ready = getReadySlotCount(this.state);
    if (joined === 0) {
      label.setText('No players joined yet — Press Start to claim a slot');
      label.setColor('#888899');
    } else if (canConfirmLobby(this.state)) {
      // AC 10402 Sub-AC 2 — every joined slot is ready → green-light
      // the advance prompt so the player can confidently press ENTER.
      label.setText(
        `${joined} of ${MAX_LOBBY_SLOTS} joined — ${ready} ready — press [ENTER] to continue`,
      );
      label.setColor('#6cf0c2');
    } else if (canStartLobby(this.state)) {
      // Joined ≥ 1 but not all ready — surface the ready gap so the
      // player knows ENTER is still available (looser gate) but the
      // confirm path expects a ready-up first.
      label.setText(
        `${joined} of ${MAX_LOBBY_SLOTS} joined — ${ready} ready — ready up to confirm`,
      );
      label.setColor('#d0a060');
    } else {
      label.setText(`${joined} of ${MAX_LOBBY_SLOTS} joined`);
      label.setColor('#888899');
    }
  }
}
