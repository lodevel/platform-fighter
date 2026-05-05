/**
 * Rebinding screen layout — AC 40101 Sub-AC 1.
 *
 * Renders the rebinding screen scaffolding required by the M5 milestone:
 *
 *   • A row of FOUR player panels (one per slot 1-4), laid out
 *     horizontally across the viewport with comfortable gutters and a
 *     consistent header → device-selector → action-list stack inside
 *     each panel.
 *   • A device selector "dropdown" chip per panel showing the current
 *     selection (`Keyboard P1 (WASD)`, `Gamepad 2`, …). The chip is
 *     interactive — clicking it cycles to the next option in
 *     `REBINDING_DEVICE_OPTIONS`. The actual side-effects (rebuilding
 *     the slot's bindings to match the chosen device) are wired in a
 *     later sub-AC; this AC just delivers the visual selector that
 *     reflects and updates the local panel state.
 *   • An action list listing every logical action (Left → Taunt) on
 *     the left and the current binding(s) on the right.
 *
 * Why this lives in `src/ui/` (mirrors `DamageHud`)
 * -------------------------------------------------
 *
 *   • Single responsibility — Phaser scene plumbing (input pre-capture,
 *     scene transitions, lifecycle hooks) belongs in
 *     `src/scenes/RebindingScene.ts`. The text/rect layout, the
 *     change-detected re-render, and the click-to-cycle dropdown all
 *     live here so they can evolve without touching the scene.
 *   • Testability — Phaser-touching code talks to a narrow `SceneShim`
 *     interface so tests can drive the renderer with a hand-rolled mock
 *     scene under plain Node + vitest.
 *   • Re-use — the pause-menu rebinding overlay (likely M5 polish work)
 *     can host the same screen without dragging the dedicated scene
 *     along.
 *
 * Determinism note
 * ----------------
 *
 * The screen is presentational. It reads bindings from a supplied
 * {@link InputBindingsStore}, formats them via the pure helpers in
 * `rebindingScreenFormat.ts`, and writes Phaser text. No Matter, no
 * RNG, no wall-clock — replays never re-enter this scene, so
 * determinism is bound by "same store + same DPI = same pixels".
 */

// Type-only import — Phaser's runtime module references `navigator` at
// import time, which crashes the Node test harness. The custom hit
// rectangle below uses `globalThis.Phaser?.Geom.Rectangle` at runtime
// (only available in the browser), so the test path skips it.
import type Phaser from 'phaser';
import { LOGICAL_ACTIONS, type LogicalAction } from '../types/inputBindings';
import type {
  InputBinding,
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';
import { DEFAULT_PLAYER_BINDINGS } from '../input/InputBindingsStore';
import {
  DEFAULT_REBINDING_DEVICE_FOR_SLOT,
  buildActionRows,
  formatBindingList,
  formatDeviceLabel,
  inferDeviceOption,
  nextDeviceOption,
  type RebindingActionRow,
  type RebindingDeviceOption,
} from './rebindingScreenFormat';
import {
  CAPTURE_PROMPT_LABEL,
  buildGamepadAxisCaptureBinding,
  buildGamepadButtonCaptureBinding,
  buildKeyboardCaptureBinding,
  isCaptureCancelGamepadButton,
  isCaptureCancelKey,
  type BindingCaptureState,
} from './bindingCapture';
import {
  conflictTintHexString,
  detectAllConflicts,
  formatConflictBannerLines,
  type BindingConflict,
  type ConflictReport,
} from './bindingConflicts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Minimal "store" surface the screen consumes. The real
 * {@link InputBindingsStore} satisfies this structurally; tests can
 * supply a plain object.
 *
 * `setAction` is required for the Sub-AC 2 capture flow — the screen
 * writes the captured binding directly to the store so the rest of the
 * runtime (dispatcher, replay, settings persister) sees the change on
 * the very next read. The store implements this; tests can supply a
 * minimal mock that records the calls.
 *
 * `reset` is required for the Sub-AC 3 reset-to-default control — the
 * per-panel Reset button asks the source to revert one slot's bindings
 * to the canonical {@link DEFAULT_PLAYER_BINDINGS} entry. The store
 * implements this directly. Tests / minimal mocks can fall back to
 * calling `setAction` for every logical action with the default values
 * — the screen does not require any specific implementation strategy
 * beyond "the next `get(slot)` returns the default profile".
 */
export interface RebindingScreenBindingsSource {
  get(slot: PlayerBindingsIndex): PlayerBindings;
  setAction(
    slot: PlayerBindingsIndex,
    action: LogicalAction,
    bindings: ReadonlyArray<InputBinding>,
  ): void;
  /**
   * Restore a single slot's bindings to its canonical default
   * (matches the Seed's per-slot device policy). Used by the per-panel
   * "Reset to Default" control surfaced in AC 40103 Sub-AC 3.
   *
   * Optional only for backwards-compat with hand-rolled mock stores in
   * older tests; when omitted, the screen falls back to per-action
   * `setAction` writes against {@link DEFAULT_PLAYER_BINDINGS}. Real
   * code paths always use {@link InputBindingsStore} which implements
   * this directly.
   */
  reset?(slot: PlayerBindingsIndex): void;
  /**
   * Optional full-snapshot accessor used by the conflict detector
   * (AC 40103 Sub-AC 3). When the source omits it, the screen falls
   * back to assembling a snapshot from four `get()` calls — the real
   * {@link InputBindingsStore} provides the optimised path.
   */
  snapshot?(): Readonly<Record<PlayerBindingsIndex, PlayerBindings>>;
}

/** Cosmetic / layout tuning. */
export interface RebindingScreenOptions {
  /** Top margin in px for the screen heading. Default 48. */
  readonly topMargin?: number;
  /** Vertical gap (px) between panels and the screen heading. Default 24. */
  readonly headingGap?: number;
  /** Width of each player panel in px. Default 240. */
  readonly panelWidth?: number;
  /** Horizontal gap between panels. Default 24. */
  readonly panelGap?: number;
  /** Padding inside each panel. Default 16. */
  readonly panelPadding?: number;
  /** Pixel height of one action-list row. Default 26. */
  readonly actionRowHeight?: number;
  /** Font size of the panel header (P1 PLAYER, …). Default 22. */
  readonly headerFontSize?: number;
  /** Font size of the device-selector chip. Default 16. */
  readonly deviceFontSize?: number;
  /** Font size of the action-list rows. Default 15. */
  readonly actionFontSize?: number;
  /**
   * Render order — usually `LOGICAL_ACTIONS` itself, but tests / future
   * UI variants can substitute (e.g. an "advanced" view that hides
   * `taunt`). Defaults to {@link LOGICAL_ACTIONS}.
   */
  readonly actionOrder?: ReadonlyArray<LogicalAction>;
}

/**
 * Per-slot snapshot of the screen's local state. Tests inspect this
 * to assert the panel rendered the right values without poking at
 * private Phaser objects.
 *
 * Sub-AC 3 of AC 40103: each row carries a `hasConflict` flag and an
 * `severity` so callers (and tests) can verify the renderer recoloured
 * the conflicted rows. The flag is a pure projection of the live
 * conflict report — no separate storage.
 *
 * Sub-AC 3 of AC 40203: each panel snapshot carries a `focused` flag so
 * tests / callers can verify which panel currently owns keyboard focus.
 * Exactly one panel is `focused: true` at any time; the others are
 * `focused: false`.
 */
export interface RebindingScreenActionRowSnapshot extends RebindingActionRow {
  readonly hasConflict: boolean;
  readonly severity: 'error' | 'warning' | null;
}

export interface RebindingScreenPanelSnapshot {
  readonly slot: PlayerBindingsIndex;
  readonly device: RebindingDeviceOption;
  readonly deviceLabel: string;
  readonly rows: ReadonlyArray<RebindingScreenActionRowSnapshot>;
  /**
   * AC 40203 Sub-AC 3 — true when this panel currently owns keyboard
   * focus. The focused panel renders with a thicker, brighter border
   * and is the implicit target of any focus-relative action (e.g.
   * "begin capture for the selected row"). Exactly one slot is focused
   * at any time.
   */
  readonly focused: boolean;
}

/**
 * Result of a single capture submission. Tests assert against this
 * instead of reaching into the screen's internals; the scene's gamepad
 * polling loop also consults `accepted` to decide whether to keep
 * polling for the same `(slot, action)` pair.
 */
export type RebindingCaptureResult =
  | { readonly accepted: true; readonly slot: PlayerBindingsIndex; readonly action: LogicalAction }
  | { readonly accepted: false; readonly reason: 'no_active_capture' | 'cancelled' | 'invalid_input' };

// ---------------------------------------------------------------------------
// Phaser-text shim — keeps tests Phaser-free (mirrors `DamageHud`)
// ---------------------------------------------------------------------------

/**
 * Minimal subset of `Phaser.GameObjects.Text` we touch. Tests fulfill
 * this with a plain object; Phaser text objects satisfy it
 * structurally.
 */
interface ScreenTextLike {
  setText(value: string): ScreenTextLike;
  setColor(color: string): ScreenTextLike;
  setOrigin(x: number, y?: number): ScreenTextLike;
  setScrollFactor(x: number, y?: number): ScreenTextLike;
  setPosition(x: number, y: number): ScreenTextLike;
  setDepth(depth: number): ScreenTextLike;
  setInteractive(): ScreenTextLike;
  on(event: string, fn: () => void): ScreenTextLike;
  destroy(): void;
  text: string;
}

/** Minimal subset of `Phaser.GameObjects.Rectangle` we touch. */
interface ScreenRectLike {
  setOrigin(x: number, y?: number): ScreenRectLike;
  setStrokeStyle(width: number, color: number, alpha?: number): ScreenRectLike;
  setScrollFactor(x: number, y?: number): ScreenRectLike;
  setPosition(x: number, y: number): ScreenRectLike;
  setDepth(depth: number): ScreenRectLike;
  destroy(): void;
}

/** Minimal scene shape — the renderer never touches anything else. */
export interface RebindingScreenSceneShim {
  scale: { gameSize: { width: number; height: number } };
  add: {
    text(
      x: number,
      y: number,
      content: string,
      style: Record<string, unknown>,
    ): ScreenTextLike;
    rectangle(
      x: number,
      y: number,
      width: number,
      height: number,
      fillColor: number,
      fillAlpha?: number,
    ): ScreenRectLike;
  };
}

// ---------------------------------------------------------------------------
// Defaults + theme
// ---------------------------------------------------------------------------

const DEFAULTS: Required<RebindingScreenOptions> = {
  topMargin: 60,
  headingGap: 32,
  panelWidth: 360,
  panelGap: 32,
  panelPadding: 22,
  actionRowHeight: 38,
  headerFontSize: 30,
  deviceFontSize: 22,
  actionFontSize: 22,
  actionOrder: LOGICAL_ACTIONS,
};

/**
 * Roster-style accent colour per slot — mirrors the colour scheme the
 * damage HUD uses so a player who plays slot 1 in match scenes
 * recognises "their" panel here without thinking.
 */
const SLOT_ACCENT: Readonly<Record<PlayerBindingsIndex, number>> = Object.freeze({
  1: 0xffb0a0, // warm peach (Wolf-aligned)
  2: 0xa0d8ff, // pale cyan  (Cat-aligned)
  3: 0xc0ffa0, // mint green (Owl-aligned)
  4: 0xffe48a, // soft amber (Bear-aligned)
});

/** Render depth so the screen sits above any background rectangles. */
const SCREEN_DEPTH = 1000;

// Panel chrome colours.
const PANEL_FILL = 0x1a1c2c;
const PANEL_FILL_ALPHA = 0.85;
const DEVICE_CHIP_FILL = 0x2a2d3f;
const DEVICE_CHIP_ALPHA = 0.95;

// Text colours.
const COLOR_HEADING = '#e8e8f0';
const COLOR_ACTION_LABEL = '#a0a0b8';
const COLOR_BINDING_VALUE = '#e8e8f0';
const COLOR_DEVICE_TEXT = '#6cf0c2';
/**
 * Per-panel "Reset to Default" button text colour. Reuses the same
 * teal-green as the device chip so the two interactive controls read
 * as belonging to the same panel-chrome family.
 */
const COLOR_RESET_BUTTON = '#6cf0c2';
/** Reset-button label shown in the per-panel chrome. */
const RESET_BUTTON_LABEL = '↺ Reset to Default';
/**
 * Per-panel "Confirm" button text colour — AC 50101 Sub-AC 1.
 *
 * A warmer, brighter green than the device-chip teal so the primary
 * "lock in this player's bindings and notify the scene" action reads
 * as the affirmative complement to the more neutral Reset control.
 * The two buttons sit side-by-side on the panel chrome so the player
 * can see "Confirm vs. Reset" at a glance without hunting.
 */
const COLOR_CONFIRM_BUTTON = '#a0ffb0';
/**
 * Confirm-button label shown in the per-panel chrome — AC 50101 Sub-AC 1.
 * Uses a leading checkmark to mirror the leading ↺ on the reset button
 * so the two read as a paired set in the panel footer.
 */
const CONFIRM_BUTTON_LABEL = '✓ Confirm';
/** Conflict warning banner — colour matches the conflict tint by default. */
const BANNER_TEXT_COLOR = '#ff5b5b';

// ---------------------------------------------------------------------------
// Internal panel struct — owns the Phaser objects for one slot
// ---------------------------------------------------------------------------

interface PanelHandles {
  readonly slot: PlayerBindingsIndex;
  readonly background: ScreenRectLike;
  readonly header: ScreenTextLike;
  readonly deviceBackground: ScreenRectLike;
  readonly deviceText: ScreenTextLike;
  readonly actionLabels: ReadonlyArray<ScreenTextLike>;
  readonly bindingTexts: ReadonlyArray<ScreenTextLike>;
  /**
   * AC 40103 Sub-AC 3 — per-panel "Reset to Default" control. Click
   * resets just this slot's bindings to the canonical default mapping
   * via {@link RebindingScreen.resetPlayerBindings}. Lives in the
   * panel chrome (rather than as a screen-wide button) so the player
   * can recover from a botched rebind on one slot without nuking the
   * other three.
   */
  readonly resetButton: ScreenTextLike;
  /**
   * AC 50101 Sub-AC 1 — per-panel "Confirm" control. Click signals
   * that the player is satisfied with this slot's bindings; the screen
   * calls every registered {@link RebindingScreenConfirmListener} with
   * the slot index. The default behaviour wired by the scene is to
   * persist the live snapshot to localStorage and (when every panel
   * has been confirmed) navigate back to the main menu — the listener
   * pattern keeps the screen presentational rather than knowing about
   * the scene's transition graph.
   *
   * Sits on the panel chrome alongside {@link resetButton} so the two
   * read as a paired confirm/reset set in the footer — matching the
   * task's "per-action binding rows including confirm/reset buttons"
   * brief.
   */
  readonly confirmButton: ScreenTextLike;
  /**
   * Action-row order frozen at panel construction. Used to map a
   * binding-text array index back to the captured action without paying
   * the cost of re-iterating `LOGICAL_ACTIONS` in the click handler.
   */
  readonly actionsByRow: ReadonlyArray<LogicalAction>;
  device: RebindingDeviceOption;
}

/**
 * AC 50101 Sub-AC 1 — listener invoked when a panel's Confirm button
 * is clicked or when a programmatic {@link RebindingScreen.confirmPlayerBindings}
 * call commits a slot. Receives the slot index that was confirmed.
 *
 * The screen exposes register / unregister helpers so the host scene can
 * subscribe at create-time and clean up at scene shutdown without
 * leaking listener closures across scene re-entries.
 */
export type RebindingScreenConfirmListener = (
  slot: PlayerBindingsIndex,
) => void;

/**
 * AC 50104 Sub-AC 4 — listener invoked when a panel's "Reset to Default"
 * button is clicked or when a programmatic
 * {@link RebindingScreen.resetPlayerBindings} call restores a slot.
 * Receives the slot index that was reset.
 *
 * Mirrors {@link RebindingScreenConfirmListener}: the screen mutates the
 * in-memory store (via `store.reset` or per-action defaults), then fans
 * out the reset event so the host scene can persist the new (default)
 * profile to localStorage. Without the fan-out, a click on Reset would
 * leave the persisted blob carrying the player's *previous* customised
 * bindings — a refresh would silently restore them.
 */
export type RebindingScreenResetListener = (
  slot: PlayerBindingsIndex,
) => void;

/**
 * While capture mode is active for a `(slot, action)` pair we hold the
 * binding-row text the prompt is painted into so we can restore it
 * verbatim if the player presses ESC/cancel without committing. The
 * "previous label" handles the "I was inspecting → click → click again
 * to back out" ergonomics without forcing a full `refreshBindings()`.
 */
interface ActiveCapture extends BindingCaptureState {
  readonly previousLabel: string;
  readonly textObject: ScreenTextLike;
}

// ---------------------------------------------------------------------------
// RebindingScreen
// ---------------------------------------------------------------------------

/**
 * Rebinding screen layout. One instance per scene `create()`; destroyed
 * on scene shutdown.
 *
 * Lifecycle:
 *
 *   const screen = new RebindingScreen(scene, store);
 *   // … user clicks the device chip on panel 3 → cycles to 'gamepad_1'
 *   const snap = screen.getPanelSnapshot(3);
 *   // teardown:
 *   screen.destroy();
 */
export class RebindingScreen {
  private readonly scene: RebindingScreenSceneShim;
  private readonly store: RebindingScreenBindingsSource;
  private readonly options: Required<RebindingScreenOptions>;
  private readonly heading: ScreenTextLike;
  private readonly subheading: ScreenTextLike;
  /**
   * Screen-wide conflict warning banner. Populated on every refresh by
   * {@link recomputeConflicts}; an empty banner is hidden by clearing
   * its text to ''. The Phaser text object always exists so the layout
   * is stable across conflict-state transitions.
   */
  private readonly bannerText: ScreenTextLike;
  private readonly panels: PanelHandles[] = [];
  private destroyed = false;
  /**
   * Latest conflict report. Refreshed on every state-mutating operation
   * (capture commit, refresh, programmatic device override). Tests
   * read this via `getConflictReport()`.
   */
  private conflictReport: ConflictReport;
  /**
   * Active capture session, if any. `null` while idle. Only one capture
   * is open at a time across all four panels — clicking a different row
   * cancels the previous one without committing.
   */
  private capture: ActiveCapture | null = null;

  /**
   * AC 40203 Sub-AC 3 — currently focused panel slot. The focused panel
   * is visually highlighted (thicker accent border + a small "FOCUSED"
   * marker is implied via the brighter chrome) and is the implicit
   * target of focus-relative actions like "begin capture on the
   * highlighted row" or "cycle device for the focused panel". Default
   * is slot 1; consumers can override via {@link setFocusedSlot}.
   *
   * Why a single `focused` slot rather than one per slot: the rebinding
   * screen is a SHARED settings UI for all four players (the seed's M5
   * milestone wording is "Each of 4 players independently rebinds…"
   * but the player driving the UI at any given moment is operating one
   * panel at a time). Modeling a single focused slot keeps the input-
   * routing surface small and matches every other "settings menu"
   * pattern in the project.
   */
  private focusedSlot: PlayerBindingsIndex = 1;

  /**
   * AC 40203 Sub-AC 3 — focused row within the focused panel. Used by
   * the keyboard-driven flow to know which action will be captured when
   * the player presses ENTER / their primary action key. Bound to a
   * valid index in `LOGICAL_ACTIONS` (the same range as
   * `panel.actionsByRow`). Default is the first row (`0`); tests and
   * scenes can override via {@link setFocusedRow}.
   */
  private focusedRowIndex = 0;

  /**
   * AC 50101 Sub-AC 1 — registered "confirm" listeners. The Confirm
   * button on each panel fans out to every listener with the slot
   * index; subscribers are notified in registration order. Cleared in
   * {@link destroy} so listener closures don't outlive the screen.
   *
   * Why a small in-memory listener list rather than an EventEmitter:
   * the screen already eschews Phaser's event surface in favour of a
   * narrow tested API, and a plain array keeps the test mocks free of
   * any third-party emitter dependency.
   */
  private readonly confirmListeners: RebindingScreenConfirmListener[] = [];

  /**
   * AC 50104 Sub-AC 4 — registered "reset" listeners, parallel to
   * {@link confirmListeners}. The per-panel "Reset to Default" button
   * (and the programmatic {@link resetPlayerBindings} entry point) fans
   * out to every listener with the slot index *after* the in-memory
   * store has already been reset. The host scene subscribes once with
   * a closure that persists the slot to localStorage so the next boot
   * sees the default profile rather than the player's previous custom
   * bindings.
   */
  private readonly resetListeners: RebindingScreenResetListener[] = [];

  constructor(
    scene: Phaser.Scene | RebindingScreenSceneShim,
    store: RebindingScreenBindingsSource,
    options: RebindingScreenOptions = {},
  ) {
    this.scene = scene as unknown as RebindingScreenSceneShim;
    this.store = store;
    this.options = { ...DEFAULTS, ...stripUndefined(options) };

    const { width } = this.scene.scale.gameSize;
    const cx = width / 2;

    // ---- Screen-level heading -------------------------------------------
    this.heading = this.scene.add
      .text(cx, this.options.topMargin, 'INPUT REBINDING', {
        fontFamily: 'monospace',
        fontSize: '52px',
        color: COLOR_HEADING,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0, 0)
      .setDepth(SCREEN_DEPTH);

    this.subheading = this.scene.add
      .text(
        cx,
        this.options.topMargin + 60,
        'Click a binding row to rebind • Click device chip to cycle • [BACKSPACE] reset all • [ESC] back to menu',
        {
          fontFamily: 'monospace',
          fontSize: '20px',
          color: '#a0a0b8',
        },
      )
      .setOrigin(0.5, 0)
      .setScrollFactor(0, 0)
      .setDepth(SCREEN_DEPTH);

    // ---- Conflict warning banner (AC 40103 Sub-AC 3) -------------------
    this.bannerText = this.scene.add
      .text(cx, this.options.topMargin + 72, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: BANNER_TEXT_COLOR,
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0, 0)
      .setDepth(SCREEN_DEPTH);

    // ---- Player panels --------------------------------------------------
    const slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
    for (const slot of slots) {
      const panel = this.createPanel(slot);
      this.panels.push(panel);
    }

    // Seed the conflict report + banner so freshly-opened screens show
    // the right state from frame 1.
    this.conflictReport = detectAllConflicts(this.acquireSnapshot());
    this.applyConflictTints();
    this.refreshBannerText();
  }

  // -------------------------------------------------------------------------
  // Public read API (used by tests + future sub-ACs)
  // -------------------------------------------------------------------------

  /** Number of player panels rendered (always 4). */
  panelCount(): number {
    return this.panels.length;
  }

  /**
   * Snapshot of one panel's local state. Used by tests to assert the
   * device dropdown / action-list contents without poking at Phaser
   * objects, and by future sub-ACs that need to read "what device did
   * the player pick on this slot?" without subscribing to events.
   *
   * Each row's `hasConflict` / `severity` reflect the *latest* conflict
   * detection pass — refreshed on every state-mutating operation.
   */
  getPanelSnapshot(slot: PlayerBindingsIndex): RebindingScreenPanelSnapshot {
    const panel = this.findPanel(slot);
    const rows = buildActionRows(
      this.store.get(slot).bindings,
      this.options.actionOrder,
    );
    const decoratedRows: RebindingScreenActionRowSnapshot[] = rows.map((row) => {
      const has = this.conflictReport.hasConflict(slot, row.action);
      return Object.freeze({
        ...row,
        hasConflict: has,
        severity: has ? this.conflictReport.severityAt(slot, row.action) : null,
      }) as RebindingScreenActionRowSnapshot;
    });
    return Object.freeze({
      slot,
      device: panel.device,
      deviceLabel: formatDeviceLabel(panel.device),
      rows: Object.freeze(decoratedRows),
      focused: this.focusedSlot === slot,
    });
  }

  /**
   * AC 40203 Sub-AC 3 — currently focused row index within the focused
   * panel. Bound to a valid index in `LOGICAL_ACTIONS`. Used by the
   * later keyboard-driven capture flow to know which action will be
   * captured when the player presses ENTER. Exposed as a getter so
   * tests / future flows can read the focus state without poking at
   * private fields.
   */
  getFocusedRowIndex(): number {
    return this.focusedRowIndex;
  }

  /**
   * Snapshot of every panel — convenience for tests / a future
   * "settings save" path. Returns a frozen array in slot order.
   */
  getAllPanelSnapshots(): ReadonlyArray<RebindingScreenPanelSnapshot> {
    return Object.freeze(
      this.panels.map((p) => this.getPanelSnapshot(p.slot)),
    );
  }

  /**
   * Force a panel to a specific device option. Mostly useful for tests
   * and for the (later) "load settings" path. Updates the chip label
   * and re-syncs nothing else — actual binding side-effects land in a
   * later sub-AC.
   */
  setPanelDevice(
    slot: PlayerBindingsIndex,
    option: RebindingDeviceOption,
  ): void {
    if (this.destroyed) return;
    const panel = this.findPanel(slot);
    panel.device = option;
    panel.deviceText.setText(formatDeviceLabel(option));
  }

  /**
   * Re-read the current bindings from the store and repaint every
   * action-list row. The dropdown selections are *not* changed — the
   * caller might be running a "Reset to Default" pass that keeps the
   * device choice but reverts the binding tables.
   *
   * If a capture session is active, the row that owns the prompt is
   * left untouched so the player still sees `Press input…`. Other rows
   * repaint as usual.
   *
   * Conflict detection (AC 40103 Sub-AC 3) re-runs on every refresh so
   * the conflict tints + warning banner stay in lockstep with the
   * binding state. Even rows that don't have new text get re-tinted in
   * case a conflict on a *different* row resolved or appeared.
   */
  refreshBindings(): void {
    if (this.destroyed) return;
    for (const panel of this.panels) {
      const bindings = this.store.get(panel.slot).bindings;
      for (let i = 0; i < this.options.actionOrder.length; i += 1) {
        const action = this.options.actionOrder[i]!;
        const text = panel.bindingTexts[i];
        if (!text) continue;
        // Don't overwrite the active-capture prompt.
        if (
          this.capture &&
          this.capture.slot === panel.slot &&
          this.capture.action === action
        ) {
          continue;
        }
        text.setText(formatBindingList(bindings[action]));
      }
    }
    this.conflictReport = detectAllConflicts(this.acquireSnapshot());
    this.applyConflictTints();
    this.refreshBannerText();
  }

  // -------------------------------------------------------------------------
  // Conflict detection — AC 40103 Sub-AC 3
  // -------------------------------------------------------------------------

  /**
   * Latest conflict report. Refreshed automatically after every
   * binding-mutating operation (capture commit, `refreshBindings`,
   * `resolveConflict`). The report is frozen — callers cannot mutate
   * it. Re-call this method to read the latest state.
   */
  getConflictReport(): ConflictReport {
    return this.conflictReport;
  }

  /**
   * Lines of the screen-wide warning banner. Empty array when no
   * conflicts are active. Used by tests to assert the banner copy
   * without poking at the Phaser text object.
   *
   * When at least one *intra-player* conflict is present (the kind
   * that blocks save), an extra footer line announces that the save
   * is blocked and points the player at the per-panel "Reset to
   * Default" control as an escape hatch — see {@link getSaveBlockReason}.
   */
  getConflictBannerLines(): ReadonlyArray<string> {
    const base = formatConflictBannerLines(this.conflictReport);
    const blockReason = this.getSaveBlockReason();
    if (blockReason === null) return base;
    return Object.freeze([...base, blockReason]);
  }

  /**
   * AC 40103 Sub-AC 3 — Are the live bindings safe to persist?
   *
   * Returns `false` when at least one *intra-player* conflict is
   * present (two unrelated actions on the same slot share a physical
   * input). Returning `false` is the explicit "block save" signal the
   * scene's auto-save path consults: a conflicted profile would be
   * written to localStorage, then re-loaded on next boot, leaving the
   * player permanently in a state where one of the conflicting actions
   * silently never fires. Refusing to persist gives the player a clear
   * "fix it before saving" loop without trapping their previous-saved
   * layout.
   *
   * Inter-player keyboard overlap (slots 1+2 sharing a key) is
   * deliberately *not* a save block here — it is still a real conflict
   * (and is still tinted/banner-flagged), but a player who genuinely
   * wants two slots on the same key (e.g. for couch-co-op pass-the-
   * controller) can persist it; the dispatcher will surface both
   * presses and the player will see the duplicate immediately. Saving
   * stays on as a release valve. The intra-player flavour is the one
   * the dispatcher *cannot* surface — one of the two actions just
   * never fires — so blocking save on it is the only way to protect
   * the player from a silent confused-input state.
   */
  canSave(): boolean {
    return this.getSaveBlockReason() === null;
  }

  /**
   * AC 40103 Sub-AC 3 — Are the live bindings for one slot safe to
   * persist? Per-slot variant of {@link canSave}.
   *
   * The "Apply just this player" save path (and the per-slot reset
   * persistence) calls this so a single-slot operation isn't blocked
   * by a conflict on a *different* slot the player isn't currently
   * editing.
   */
  canSavePlayer(slot: PlayerBindingsIndex): boolean {
    for (const conflict of this.conflictReport.conflicts) {
      if (conflict.kind !== 'intra_player') continue;
      for (const loc of conflict.locations) {
        if (loc.slot === slot) return false;
      }
    }
    return true;
  }

  /**
   * AC 40103 Sub-AC 3 — Why is save blocked? Returns `null` when save
   * is allowed; otherwise a short, human-readable reason suitable for
   * a toast or banner footer ("save blocked: 2 conflicts on P1").
   *
   * Used by the rebinding screen's banner footer and by the scene's
   * persistence guard to surface a single sentence explaining the
   * block without forcing every caller to re-walk the conflict report.
   */
  getSaveBlockReason(): string | null {
    let blocking = 0;
    const blockedSlots = new Set<PlayerBindingsIndex>();
    for (const conflict of this.conflictReport.conflicts) {
      if (conflict.kind !== 'intra_player') continue;
      blocking += 1;
      for (const loc of conflict.locations) blockedSlots.add(loc.slot);
    }
    if (blocking === 0) return null;
    const slotList = [...blockedSlots]
      .sort((a, b) => a - b)
      .map((s) => `P${s}`)
      .join(', ');
    if (blocking === 1) {
      return `Save blocked: 1 conflict on ${slotList} — fix or Reset to Default before saving`;
    }
    return `Save blocked: ${blocking} conflicts on ${slotList} — fix or Reset to Default before saving`;
  }

  /**
   * AC 40103 Sub-AC 3 — Restore one player slot to the canonical
   * default mapping (the value `InputBindingsStore.reset(slot)` would
   * produce). Per-panel "Reset to Default" control.
   *
   * After the reset the screen re-runs conflict detection and
   * repaints every row on the slot — the action-list now shows the
   * default labels, the conflict tint drops off any slot-affected
   * row, and the warning banner refreshes. Returns `true` when a
   * reset actually ran (always, except when the screen is destroyed),
   * so the scene's autosave path can persist the new profile only on
   * a successful reset.
   *
   * Why "per-slot" rather than "Reset All":
   *
   *   • The Seed's M5 milestone calls out per-player rebinding — each
   *     slot is independent and a player who customised slot 1 should
   *     be able to throw away P3's experimental remap without
   *     blast-radius on their own keys.
   *   • The full-snapshot reset path is already wired into the scene
   *     (F1) via {@link BindingsPersistenceController.resetAll}; this
   *     method is the per-slot complement.
   *
   * The store is mutated through the source's `reset` method when
   * available (`InputBindingsStore.reset` resets in one canonical
   * call); a minimal mock without `reset` falls back to per-action
   * `setAction` writes against {@link DEFAULT_PLAYER_BINDINGS}. Either
   * way the next `get(slot)` returns the slot's default profile.
   */
  resetPlayerBindings(slot: PlayerBindingsIndex): boolean {
    if (this.destroyed) return false;
    // Cancel any in-flight capture on this slot — its previous-label
    // record now points at the *pre-reset* binding, which would
    // overwrite the freshly-reset value if the player escapes the
    // capture afterwards.
    if (this.capture !== null && this.capture.slot === slot) {
      this.cancelCaptureInternal();
    }
    const reset = this.store.reset;
    if (typeof reset === 'function') {
      reset.call(this.store, slot);
    } else {
      // Fallback path for mock stores that don't implement reset:
      // walk the canonical defaults table and set each action.
      const defaults = DEFAULT_PLAYER_BINDINGS[slot].bindings;
      for (const action of LOGICAL_ACTIONS) {
        this.store.setAction(slot, action, defaults[action]);
      }
    }
    this.refreshBindings();
    // AC 50104 Sub-AC 4 — fan out to reset listeners *after* the store
    // has been mutated and the screen has repainted, so a listener that
    // calls `store.snapshot()` synchronously sees the just-reset slot
    // (per-slot defaults, including the per-slot device assignment).
    // Snapshot the listener list so a listener that unregisters during
    // its own callback does not skip a sibling listener at index i+1.
    const listeners = [...this.resetListeners];
    for (const listener of listeners) {
      listener(slot);
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Confirm flow — AC 50101 Sub-AC 1
  // -------------------------------------------------------------------------

  /**
   * AC 50101 Sub-AC 1 — Subscribe to per-panel confirm events. The
   * returned function unsubscribes; the screen also clears every
   * listener at {@link destroy}-time so a forgotten unsubscribe cannot
   * outlive the scene.
   *
   * The host scene typically registers a single listener that
   * (a) persists the slot's bindings to localStorage and
   * (b) when every slot has been confirmed, transitions back to the
   * main menu. Tests pass a counting closure to assert click → fan-out.
   */
  onConfirm(listener: RebindingScreenConfirmListener): () => void {
    this.confirmListeners.push(listener);
    return () => {
      const i = this.confirmListeners.indexOf(listener);
      if (i >= 0) this.confirmListeners.splice(i, 1);
    };
  }

  /**
   * AC 50104 Sub-AC 4 — Subscribe to per-panel reset events. Mirrors
   * {@link onConfirm}: the returned function unsubscribes; the screen
   * also clears every listener at {@link destroy}-time.
   *
   * The host scene typically registers a single listener that persists
   * the (now-default) slot to localStorage so a refresh after a click
   * on "Reset to Default" doesn't silently restore the player's
   * previous customised bindings. Tests pass a counting closure to
   * assert click → fan-out.
   */
  onReset(listener: RebindingScreenResetListener): () => void {
    this.resetListeners.push(listener);
    return () => {
      const i = this.resetListeners.indexOf(listener);
      if (i >= 0) this.resetListeners.splice(i, 1);
    };
  }

  /**
   * AC 50101 Sub-AC 1 — Programmatically confirm one slot. Click on
   * the Confirm button in the panel chrome funnels through this method
   * so click and programmatic confirmation share one implementation.
   *
   * Confirming a slot that still has an in-flight capture cancels the
   * capture first (its previous-label record would otherwise paint
   * over the just-confirmed binding when the player escapes). When
   * an intra-player conflict is present on the slot the call still
   * fans out — the listener (the scene's persistence wrapper) is the
   * sole authority on whether to write to localStorage; `canSavePlayer`
   * is what they consult for that decision.
   *
   * Returns `false` when the screen is destroyed; otherwise `true`
   * (always — confirmation itself never fails, only persistence might).
   */
  confirmPlayerBindings(slot: PlayerBindingsIndex): boolean {
    if (this.destroyed) return false;
    if (this.capture !== null && this.capture.slot === slot) {
      this.cancelCaptureInternal();
    }
    // Snapshot the listener list so a listener that unregisters during
    // its own callback does not skip a sibling listener at index i+1.
    const listeners = [...this.confirmListeners];
    for (const listener of listeners) {
      listener(slot);
    }
    return true;
  }

  /**
   * Resolve a conflict by clearing the FIRST involved location's
   * binding entry. The store is mutated through `setAction` so the
   * change propagates to the dispatcher, the replay layer, and any
   * subscribed persistence layer on the very next sample.
   *
   * Returns `true` when a binding was actually cleared, `false` if the
   * conflict no longer matches the live store (stale resolution prompt)
   * or the location's binding list was already empty.
   *
   * Why "clear the first location" rather than letting the player pick:
   * a click-driven, single-step "resolve" is the smallest UX that still
   * delivers a fix. The (later) full resolution dialog can call
   * `resolveConflictAtLocation(conflict, locationIndex)` to choose a
   * specific entry.
   */
  resolveConflict(conflict: BindingConflict): boolean {
    return this.resolveConflictAtLocation(conflict, 0);
  }

  /**
   * Resolve a conflict by clearing the binding entry at
   * `locationIndex` inside `conflict.locations`. The (future) full
   * resolution dialog calls this when the player picks a specific
   * "unbind P3 Attack" action; the simpler {@link resolveConflict}
   * defaults to the first location.
   */
  resolveConflictAtLocation(
    conflict: BindingConflict,
    locationIndex: number,
  ): boolean {
    if (this.destroyed) return false;
    const loc = conflict.locations[locationIndex];
    if (loc === undefined) return false;
    const live = this.store.get(loc.slot).bindings[loc.action];
    if (live.length === 0) return false;
    // Drop the entry at the recorded index, but tolerate a shifted
    // index (e.g. another resolve pass already trimmed the list) by
    // bounding-checking before splicing.
    const next: InputBinding[] = [];
    for (let i = 0; i < live.length; i += 1) {
      if (i === loc.bindingIndex) continue;
      next.push(live[i]!);
    }
    this.store.setAction(loc.slot, loc.action, next);
    this.refreshBindings();
    return true;
  }

  /**
   * Re-tint every binding-row text according to the current conflict
   * report. Conflicted rows go red (severity error) or yellow (warning),
   * clean rows return to the default colour.
   */
  private applyConflictTints(): void {
    for (const panel of this.panels) {
      for (let i = 0; i < panel.actionsByRow.length; i += 1) {
        const action = panel.actionsByRow[i]!;
        const text = panel.bindingTexts[i];
        if (!text) continue;
        // Don't recolour the active-capture prompt — keep its label
        // visually distinct (default colour) while the player picks an
        // input. The next refresh after commit re-runs this pass.
        if (
          this.capture &&
          this.capture.slot === panel.slot &&
          this.capture.action === action
        ) {
          continue;
        }
        const severity = this.conflictReport.severityAt(panel.slot, action);
        if (severity !== null) {
          text.setColor(conflictTintHexString(severity));
        } else {
          text.setColor(COLOR_BINDING_VALUE);
        }
      }
    }
  }

  /**
   * Refresh the screen-wide warning banner from the latest conflict
   * report. Empty when there are no conflicts; otherwise a compact
   * count headline + per-conflict resolution prompts plus, when
   * applicable, the save-blocked footer from
   * {@link getSaveBlockReason}.
   */
  private refreshBannerText(): void {
    const lines = this.getConflictBannerLines();
    this.bannerText.setText(lines.join('\n'));
  }

  /**
   * Snapshot of the bindings for the conflict detector. Prefers the
   * store's optimised `snapshot()` method when present; otherwise
   * assembles one from four `get()` calls so a minimal mock store still
   * works for tests.
   */
  private acquireSnapshot(): Readonly<Record<PlayerBindingsIndex, PlayerBindings>> {
    const fn = this.store.snapshot;
    if (typeof fn === 'function') {
      return fn.call(this.store);
    }
    return Object.freeze({
      1: this.store.get(1),
      2: this.store.get(2),
      3: this.store.get(3),
      4: this.store.get(4),
    });
  }

  // -------------------------------------------------------------------------
  // Capture flow — AC 40102 Sub-AC 2
  // -------------------------------------------------------------------------

  /**
   * Returns the active capture session, if any. `null` while idle. The
   * scene's keyboard / gamepad bridges call this every poll to know
   * whether to forward input events into the capture pipeline.
   */
  getActiveCapture(): BindingCaptureState | null {
    if (this.capture === null) return null;
    return Object.freeze({ slot: this.capture.slot, action: this.capture.action });
  }

  /**
   * Geometric hit test for a canvas-space click. Walks every panel
   * and returns a tagged target describing which control the click
   * landed on:
   *   - `'binding'` — a binding row (begin capture)
   *   - `'device'` — the device chip (cycle device)
   *   - `'reset'` — the reset button (reset slot to defaults)
   *   - `'confirm'` — the confirm button (commit + persist)
   *   - `null` — empty space
   *
   * Workaround for environments where Phaser's per-scene InputPlugin
   * doesn't dispatch pointerdown to interactive GameObjects (observed
   * after a `scene.start` from another scene with active input). The
   * RebindingScene's DOM-level mousedown listener calls this and
   * fans out to the matching action.
   */
  /**
   * Cycle the device chip for `slot` to its next option (mirrors the
   * inline pointerdown handler installed during panel construction).
   * Used by the DOM-routed click path in RebindingScene since Phaser's
   * per-element pointerdown doesn't dispatch in that scene.
   */
  cyclePlayerDevice(slot: PlayerBindingsIndex): void {
    if (this.destroyed) return;
    const panel = this.findPanel(slot);
    panel.device = nextDeviceOption(panel.device);
    panel.deviceText.setText(formatDeviceLabel(panel.device));
  }

  hitTestClick(
    x: number,
    y: number,
  ):
    | { kind: 'binding'; slot: PlayerBindingsIndex; action: LogicalAction }
    | { kind: 'device'; slot: PlayerBindingsIndex }
    | { kind: 'reset'; slot: PlayerBindingsIndex }
    | { kind: 'confirm'; slot: PlayerBindingsIndex }
    | null {
    if (this.destroyed) return null;
    for (const panel of this.panels) {
      const layout = this.computePanelLayout(panel.slot);
      const left = layout.x;
      const right = layout.x + this.options.panelWidth;
      if (x < left || x > right) continue;
      const innerLeft = layout.x + this.options.panelPadding;
      const innerRight = layout.x + this.options.panelWidth - this.options.panelPadding;

      // Device chip band.
      const chipY = layout.y + layout.deviceChipYOffset;
      const chipH = this.options.deviceFontSize + 14;
      if (y >= chipY && y <= chipY + chipH && x >= innerLeft && x <= innerRight) {
        return { kind: 'device', slot: panel.slot };
      }

      // Action rows band.
      const rowsTop = layout.y + layout.actionListYOffset;
      const rowsHeight = this.options.actionRowHeight * panel.actionsByRow.length;
      if (
        y >= rowsTop &&
        y <= rowsTop + rowsHeight &&
        x >= innerLeft &&
        x <= innerRight
      ) {
        const rowIndex = Math.floor((y - rowsTop) / this.options.actionRowHeight);
        const action = panel.actionsByRow[rowIndex];
        if (action) {
          return { kind: 'binding', slot: panel.slot, action };
        }
      }

      // Confirm / Reset footer band — confirm is on the left half,
      // reset on the right half. Same Y row.
      const footerY = layout.y + layout.resetButtonYOffset;
      const footerH = this.options.deviceFontSize + 14;
      const midX = layout.x + this.options.panelWidth / 2;
      if (y >= footerY - 4 && y <= footerY + footerH) {
        if (x >= innerLeft && x < midX) {
          return { kind: 'confirm', slot: panel.slot };
        }
        if (x >= midX && x <= innerRight) {
          return { kind: 'reset', slot: panel.slot };
        }
      }
    }
    return null;
  }

  /**
   * Begin a capture session for the given `(slot, action)` pair. If a
   * capture is already active it is implicitly cancelled (its previous
   * label restored) before the new one starts — matches the Smash-Bros
   * "click another row to switch focus" flow.
   *
   * The screen paints the {@link CAPTURE_PROMPT_LABEL} into the row's
   * binding-value text and stores enough state to undo the change if the
   * player cancels. No store mutation happens yet — the change only
   * commits when a successful capture is submitted.
   */
  beginCapture(slot: PlayerBindingsIndex, action: LogicalAction): void {
    if (this.destroyed) return;
    // Cancel any in-flight capture so its row label restores.
    if (this.capture !== null) {
      this.cancelCaptureInternal();
    }
    const panel = this.findPanel(slot);
    const rowIndex = panel.actionsByRow.indexOf(action);
    if (rowIndex < 0) {
      // Unknown action for this panel layout (e.g. a custom actionOrder
      // omitted it). Surface as a no-op rather than crashing the scene.
      return;
    }
    const text = panel.bindingTexts[rowIndex];
    if (!text) return;
    const previousLabel = text.text;
    text.setText(CAPTURE_PROMPT_LABEL);
    this.capture = {
      slot,
      action,
      previousLabel,
      textObject: text,
    };
  }

  /**
   * Cancel the active capture, restoring the previous label. Idempotent
   * when there is no active capture. The scene's ESC handler and
   * gamepad-cancel-button watcher both call this; tests use it to
   * assert the prompt rolls back without committing a binding.
   */
  cancelCapture(): RebindingCaptureResult {
    if (this.destroyed) {
      return { accepted: false, reason: 'no_active_capture' };
    }
    if (this.capture === null) {
      return { accepted: false, reason: 'no_active_capture' };
    }
    this.cancelCaptureInternal();
    return { accepted: false, reason: 'cancelled' };
  }

  private cancelCaptureInternal(): void {
    if (this.capture === null) return;
    this.capture.textObject.setText(this.capture.previousLabel);
    this.capture = null;
  }

  /**
   * Submit a captured keyboard event. ESC cancels; any other valid
   * keyCode is converted to a {@link KeyboardBinding} and written to
   * the store via `setAction`, replacing the slot+action's binding
   * list. After a successful capture the capture session ends and the
   * row repaints from the store.
   */
  submitKeyboardCapture(keyCode: number): RebindingCaptureResult {
    if (this.destroyed || this.capture === null) {
      return { accepted: false, reason: 'no_active_capture' };
    }
    if (isCaptureCancelKey(keyCode)) {
      this.cancelCaptureInternal();
      return { accepted: false, reason: 'cancelled' };
    }
    let binding;
    try {
      binding = buildKeyboardCaptureBinding(keyCode);
    } catch {
      return { accepted: false, reason: 'invalid_input' };
    }
    return this.commitCapturedBinding(binding);
  }

  /**
   * Submit a captured gamepad button press. Button 1 (B / Circle) on the
   * standard layout cancels — any other button index is converted to a
   * {@link GamepadBinding} pinned to the supplied pad and committed.
   */
  submitGamepadButtonCapture(
    gamepadIndex: number,
    buttonIndex: number,
  ): RebindingCaptureResult {
    if (this.destroyed || this.capture === null) {
      return { accepted: false, reason: 'no_active_capture' };
    }
    if (isCaptureCancelGamepadButton(buttonIndex)) {
      this.cancelCaptureInternal();
      return { accepted: false, reason: 'cancelled' };
    }
    let binding;
    try {
      binding = buildGamepadButtonCaptureBinding(gamepadIndex, buttonIndex);
    } catch {
      return { accepted: false, reason: 'invalid_input' };
    }
    return this.commitCapturedBinding(binding);
  }

  /**
   * Submit a captured gamepad half-axis deflection. Sign of `axisValue`
   * picks the half-axis direction; threshold defaults to the per-binding
   * gamepad threshold from the store defaults.
   */
  submitGamepadAxisCapture(
    gamepadIndex: number,
    axisIndex: number,
    axisValue: number,
  ): RebindingCaptureResult {
    if (this.destroyed || this.capture === null) {
      return { accepted: false, reason: 'no_active_capture' };
    }
    let binding;
    try {
      binding = buildGamepadAxisCaptureBinding(gamepadIndex, axisIndex, axisValue);
    } catch {
      return { accepted: false, reason: 'invalid_input' };
    }
    return this.commitCapturedBinding(binding);
  }

  /**
   * Common write path — replaces the capture's row binding list with a
   * single-element array of the captured binding, ends the capture
   * session, and repaints the row from the store. Centralising the
   * write keeps the keyboard / gamepad submit paths from drifting in
   * how they update the store and the display.
   */
  private commitCapturedBinding(binding: InputBinding): RebindingCaptureResult {
    /* istanbul ignore next — guarded at every call site. */
    if (this.capture === null) {
      return { accepted: false, reason: 'no_active_capture' };
    }
    const { slot, action, textObject } = this.capture;
    this.store.setAction(slot, action, [binding]);
    // Refresh just this row from the store so the new label reflects
    // exactly what `setAction` clone-and-froze.
    const newBindings = this.store.get(slot).bindings[action];
    textObject.setText(formatBindingList(newBindings));
    this.capture = null;
    // Re-run conflict detection now that the bindings changed, so the
    // newly-bound input is immediately tinted if it conflicts (and any
    // resolved-by-this-rebind conflict drops off the banner).
    // (AC 40103 Sub-AC 3.)
    this.conflictReport = detectAllConflicts(this.acquireSnapshot());
    this.applyConflictTints();
    this.refreshBannerText();
    return { accepted: true, slot, action };
  }

  /**
   * Destroy every Phaser object the screen owns. Idempotent — the
   * scene's SHUTDOWN handler can call this whether or not it has been
   * called before.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // Drop any in-flight capture without poking the (about-to-be-destroyed)
    // text object — set the field to null directly.
    this.capture = null;
    this.heading.destroy();
    this.subheading.destroy();
    this.bannerText.destroy();
    for (const panel of this.panels) {
      panel.background.destroy();
      panel.header.destroy();
      panel.deviceBackground.destroy();
      panel.deviceText.destroy();
      panel.resetButton.destroy();
      panel.confirmButton.destroy();
      for (const t of panel.actionLabels) t.destroy();
      for (const t of panel.bindingTexts) t.destroy();
    }
    this.panels.length = 0;
    // Drop every confirm subscriber so listener closures don't outlive
    // the screen. The scene tears down the screen on SHUTDOWN, so any
    // in-flight subscription would otherwise leak into the next entry.
    this.confirmListeners.length = 0;
    // AC 50104 Sub-AC 4 — same lifecycle for reset listeners.
    this.resetListeners.length = 0;
  }

  // -------------------------------------------------------------------------
  // Internal — panel construction
  // -------------------------------------------------------------------------

  private createPanel(slot: PlayerBindingsIndex): PanelHandles {
    const layout = this.computePanelLayout(slot);
    const accent = SLOT_ACCENT[slot];
    const initialDevice = this.computeInitialDevice(slot);

    // Chrome — translucent panel background + accent border.
    const background = this.scene.add
      .rectangle(
        layout.x,
        layout.y,
        this.options.panelWidth,
        layout.height,
        PANEL_FILL,
        PANEL_FILL_ALPHA,
      )
      .setOrigin(0, 0)
      .setStrokeStyle(2, accent, 1)
      .setScrollFactor(0, 0)
      .setDepth(SCREEN_DEPTH);

    // Header — "P1 PLAYER" tinted with the slot's accent colour.
    const header = this.scene.add
      .text(
        layout.x + this.options.panelWidth / 2,
        layout.y + this.options.panelPadding,
        `P${slot} PLAYER`,
        {
          fontFamily: 'monospace',
          fontSize: `${this.options.headerFontSize}px`,
          color: colorIntToHexStringLocal(accent),
        },
      )
      .setOrigin(0.5, 0)
      .setScrollFactor(0, 0)
      .setDepth(SCREEN_DEPTH);

    // Device-selector chip — interactive, click cycles options.
    const chipY = layout.y + layout.deviceChipYOffset;
    const chipHeight = this.options.deviceFontSize + 14;
    const deviceBackground = this.scene.add
      .rectangle(
        layout.x + this.options.panelPadding,
        chipY,
        this.options.panelWidth - 2 * this.options.panelPadding,
        chipHeight,
        DEVICE_CHIP_FILL,
        DEVICE_CHIP_ALPHA,
      )
      .setOrigin(0, 0)
      .setStrokeStyle(1, accent, 0.6)
      .setScrollFactor(0, 0)
      .setDepth(SCREEN_DEPTH);

    const deviceText = this.scene.add
      .text(
        layout.x + this.options.panelWidth / 2,
        chipY + chipHeight / 2,
        formatDeviceLabel(initialDevice),
        {
          fontFamily: 'monospace',
          fontSize: `${this.options.deviceFontSize}px`,
          color: COLOR_DEVICE_TEXT,
        },
      )
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0, 0)
      .setDepth(SCREEN_DEPTH)
      .setInteractive();

    // Action list — one (label, binding) pair per logical action.
    const rows = buildActionRows(
      this.store.get(slot).bindings,
      this.options.actionOrder,
    );
    const actionLabels: ScreenTextLike[] = [];
    const bindingTexts: ScreenTextLike[] = [];
    const actionsByRow: LogicalAction[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!;
      const rowY = layout.y + layout.actionListYOffset + i * this.options.actionRowHeight;

      const label = this.scene.add
        .text(
          layout.x + this.options.panelPadding,
          rowY,
          row.actionLabel,
          {
            fontFamily: 'monospace',
            fontSize: `${this.options.actionFontSize}px`,
            color: COLOR_ACTION_LABEL,
          },
        )
        .setOrigin(0, 0)
        .setScrollFactor(0, 0)
        .setDepth(SCREEN_DEPTH);

      // The binding-value text is interactive: clicking it begins a
      // capture session for this `(slot, action)` pair.
      const value = this.scene.add
        .text(
          layout.x + this.options.panelWidth - this.options.panelPadding,
          rowY,
          row.bindingLabel,
          {
            fontFamily: 'monospace',
            fontSize: `${this.options.actionFontSize}px`,
            color: COLOR_BINDING_VALUE,
          },
        )
        .setOrigin(1, 0)
        .setScrollFactor(0, 0)
        .setDepth(SCREEN_DEPTH)
        .setInteractive();
      // Without a custom hit area, the text's bbox is tiny (~10×17 px
      // for "F"), making the row almost unclickable. Set an explicit
      // rectangle covering the right column of the panel so any click
      // in that band starts the capture. Wrapped in a `globalThis`
      // runtime check so the Node test harness — which doesn't load
      // Phaser as a value (Phaser's device module references
      // `navigator` and crashes in Node) — silently skips this branch.
      const PhaserGlobal = (globalThis as { Phaser?: { Geom?: { Rectangle?: unknown } } })
        .Phaser;
      const RectCtor = (PhaserGlobal?.Geom?.Rectangle as
        | (new (x: number, y: number, w: number, h: number) => unknown)
        | undefined);
      const Contains = (PhaserGlobal?.Geom?.Rectangle as
        | { Contains?: (rect: unknown, x: number, y: number) => boolean }
        | undefined)?.Contains;
      const realValue = value as unknown as Phaser.GameObjects.Text;
      if (
        typeof realValue.setInteractive === 'function' &&
        typeof RectCtor === 'function' &&
        typeof Contains === 'function'
      ) {
        const hitW = this.options.panelWidth - this.options.panelPadding * 2;
        const hitH = this.options.actionRowHeight + 4;
        realValue.setInteractive(
          new RectCtor(-hitW, -2, hitW, hitH),
          Contains,
        );
      }

      actionLabels.push(label);
      bindingTexts.push(value);
      actionsByRow.push(row.action);
    }

    // Per-panel "Reset to Default" control (AC 40103 Sub-AC 3) — a
    // small clickable text below the action list. Sits on the right
    // half of the panel footer; the Confirm button mirrors it on the
    // left half so the two read as a paired confirm/reset set.
    const resetButton = this.scene.add
      .text(
        layout.x + this.options.panelWidth * 0.75,
        layout.y + layout.resetButtonYOffset,
        RESET_BUTTON_LABEL,
        {
          fontFamily: 'monospace',
          fontSize: `${this.options.deviceFontSize}px`,
          color: COLOR_RESET_BUTTON,
        },
      )
      .setOrigin(0.5, 0)
      .setScrollFactor(0, 0)
      .setDepth(SCREEN_DEPTH)
      .setInteractive();

    // Per-panel "Confirm" control (AC 50101 Sub-AC 1) — clicking emits
    // a confirm event for this slot (see `onConfirm`). Sits on the
    // LEFT half of the panel footer alongside the reset button so the
    // two controls share a row and the player can see them at a
    // glance. Constructed AFTER `resetButton` so the per-slot
    // interactive-text indices stay stable for the existing reset
    // tests (`findResetButton` resolves to the same offset as before).
    const confirmButton = this.scene.add
      .text(
        layout.x + this.options.panelWidth * 0.25,
        layout.y + layout.resetButtonYOffset,
        CONFIRM_BUTTON_LABEL,
        {
          fontFamily: 'monospace',
          fontSize: `${this.options.deviceFontSize}px`,
          color: COLOR_CONFIRM_BUTTON,
        },
      )
      .setOrigin(0.5, 0)
      .setScrollFactor(0, 0)
      .setDepth(SCREEN_DEPTH)
      .setInteractive();

    const panel: PanelHandles = {
      slot,
      background,
      header,
      deviceBackground,
      deviceText,
      actionLabels,
      bindingTexts,
      resetButton,
      confirmButton,
      actionsByRow,
      device: initialDevice,
    };

    // Wire each binding-row's `pointerdown` to begin capture for that
    // panel's slot + the row's action. Captured here (rather than in a
    // central handler) so the closure carries the row index without
    // having to re-derive it from the `text` reference.
    for (let i = 0; i < bindingTexts.length; i += 1) {
      const value = bindingTexts[i]!;
      const action = actionsByRow[i]!;
      value.on('pointerdown', () => {
        this.beginCapture(slot, action);
      });
    }

    // Click-to-cycle on the device chip.
    deviceText.on('pointerdown', () => {
      panel.device = nextDeviceOption(panel.device);
      panel.deviceText.setText(formatDeviceLabel(panel.device));
    });

    // Click → reset just this slot's bindings to defaults.
    resetButton.on('pointerdown', () => {
      this.resetPlayerBindings(slot);
    });

    // Click → fan out a confirm event for just this slot. The host
    // scene's listener handles persistence + scene transition; the
    // screen stays presentational.
    confirmButton.on('pointerdown', () => {
      this.confirmPlayerBindings(slot);
    });

    return panel;
  }

  // -------------------------------------------------------------------------
  // Internal — layout math
  // -------------------------------------------------------------------------

  /**
   * Compute the top-left origin and total height of a panel. Panels are
   * laid out in a row across the viewport, centred horizontally and
   * pinned just below the heading.
   */
  private computePanelLayout(slot: PlayerBindingsIndex): {
    x: number;
    y: number;
    height: number;
    deviceChipYOffset: number;
    actionListYOffset: number;
    resetButtonYOffset: number;
  } {
    const n = 4;
    const totalWidth =
      n * this.options.panelWidth + (n - 1) * this.options.panelGap;
    const viewportWidth = this.scene.scale.gameSize.width;
    const startX = (viewportWidth - totalWidth) / 2;

    // Panel index inside the row (0 → leftmost).
    const idx = slot - 1;
    const x = startX + idx * (this.options.panelWidth + this.options.panelGap);

    // Top of the panel sits below the heading + subheading + their gaps.
    const headingHeight = 40 + 16 + 16; // heading font + subheading + small breath
    const y = this.options.topMargin + headingHeight + this.options.headingGap;

    // Internal stack: header text → device chip → action list → reset btn.
    const headerHeight = this.options.headerFontSize + this.options.panelPadding;
    const deviceChipYOffset = this.options.panelPadding + headerHeight + 8;
    const deviceChipHeight = this.options.deviceFontSize + 14;
    const actionListYOffset = deviceChipYOffset + deviceChipHeight + 16;

    const actionListHeight =
      this.options.actionRowHeight * this.options.actionOrder.length;
    const resetButtonYOffset = actionListYOffset + actionListHeight + 8;
    const resetButtonHeight = this.options.deviceFontSize + 8;
    const height = resetButtonYOffset + resetButtonHeight + this.options.panelPadding;

    return {
      x,
      y,
      height,
      deviceChipYOffset,
      actionListYOffset,
      resetButtonYOffset,
    };
  }

  // -------------------------------------------------------------------------
  // Internal — small helpers
  // -------------------------------------------------------------------------

  private findPanel(slot: PlayerBindingsIndex): PanelHandles {
    const panel = this.panels.find((p) => p.slot === slot);
    /* istanbul ignore next — constructor seeds all 4 slots. */
    if (!panel) {
      throw new Error(`RebindingScreen: panel for slot ${slot} not found.`);
    }
    return panel;
  }

  /**
   * Default device label for a panel — read the stored bindings and
   * try to infer; if the inferred value isn't sensible (e.g. the slot
   * is empty), fall back to the slot's policy default.
   */
  private computeInitialDevice(slot: PlayerBindingsIndex): RebindingDeviceOption {
    const inferred = inferDeviceOption(this.store.get(slot));
    if (inferred === 'none') {
      return DEFAULT_REBINDING_DEVICE_FOR_SLOT[slot];
    }
    return inferred;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Local copy of the damage-HUD helper to avoid a transitive import cycle. */
function colorIntToHexStringLocal(value: number): string {
  const v = Math.max(0, Math.min(0xffffff, Math.floor(value)));
  return `#${v.toString(16).padStart(6, '0')}`;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    const v = obj[key];
    if (v !== undefined) {
      out[key] = v;
    }
  }
  return out;
}
