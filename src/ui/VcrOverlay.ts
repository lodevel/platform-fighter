/**
 * Replay VCR control overlay — AC 30301 Sub-AC 1.
 *
 * The Phaser-touching presentation layer for the M4 replay player's
 * VCR controls. Where `ReplayPlaybackController` owns the cursor +
 * phase state and `vcrOverlayFormat.ts` turns a `VcrPlaybackState`
 * snapshot into UI strings + colour bands, this component paints the
 * buttons + read-out and listens for click / keyboard input that
 * dispatches back into the host scene's controller wiring.
 *
 * Layout
 * ------
 *
 *     ┌────────────────────────────────────────────────────────────┐
 *     │  REPLAY PLAYBACK                                           │  ← title
 *     │  playing · 1.0x                                            │  ← phase + rate
 *     │  f1234 / f1800                                             │  ← timeline cursor
 *     │                                                            │
 *     │   [<<]   [>]   [||]   [1/4x]   [>|]                        │  ← 5 buttons
 *     │   R     Space  Space    S       F                          │  ← shortcut hints
 *     └────────────────────────────────────────────────────────────┘
 *
 * Five canonical buttons, identified by {@link VcrControl}:
 *
 *   1. Rewind          — snap cursor backwards by `rewindFrames` (default 60).
 *   2. Play            — resume playback (idempotent while playing).
 *   3. Pause           — halt playback (idempotent while paused).
 *   4. Slow-motion     — toggle 0.25x rate.
 *   5. Frame advance   — step the cursor forward exactly one frame.
 *
 * Each button has:
 *   • a glyph + accessible label                            (from `VCR_BUTTON_LAYOUT`)
 *   • an idle / hover / active / disabled visual band       (from `resolveButtonBand`)
 *   • a default keyboard shortcut                           (from `VCR_BUTTON_LAYOUT`)
 *   • a callback the host scene wires to its controller     (`VcrOverlayActions`)
 *
 * Why this lives in `src/ui/` (mirrors `DesyncReportOverlay`)
 * -----------------------------------------------------------
 *
 *   • Single responsibility — `ReplayPlaybackController` owns the cursor;
 *     this file owns the pixels + click → callback wiring.
 *   • Testability — the overlay talks to a narrow `VcrOverlaySceneShim`
 *     so the unit suite drives it under plain Node + vitest.
 *   • Re-usability — the M4 replay menu, the post-match results screen
 *     (instant replay), and the M3 stage builder's "test play" mode
 *     can all reuse this component without copying its layout.
 *
 * Determinism
 * -----------
 *
 * The overlay is render-only. Pure formatters in `vcrOverlayFormat.ts`
 * produce its strings; this file does Phaser text/rectangle plumbing
 * plus DOM-keyboard event subscription. No Matter, no RNG, no wall-clock.
 * Replays never re-enter the overlay's logic.
 */

import type Phaser from 'phaser';
import type { ReplayPlaybackPhase } from '../replay/ReplayPlaybackController';
import {
  VCR_CONTROL,
  VCR_BUTTON_LAYOUT,
  buildHeaderLines,
  buttonStateColor,
  colorIntToHexString,
  findControlForKeyCode,
  resolveButtonBand,
  resolveSpaceShortcut,
  type VcrButtonLayout,
  type VcrButtonVisualBand,
  type VcrControl,
  type VcrPlaybackState,
} from './vcrOverlayFormat';
import { KEY_CODE } from '../input/keyCodes';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Cosmetic / layout tuning. */
export interface VcrOverlayOptions {
  /** Top-left X of the overlay panel. Default 24. */
  readonly x?: number;
  /** Top-left Y of the overlay panel. Default 24. */
  readonly y?: number;
  /** Panel width in px. Default 520. */
  readonly width?: number;
  /** Panel height in px. Default 160. */
  readonly height?: number;
  /** Padding inside the panel. Default 16. */
  readonly padding?: number;
  /** Pixel width of one button. Default 64. */
  readonly buttonWidth?: number;
  /** Pixel height of one button. Default 40. */
  readonly buttonHeight?: number;
  /** Horizontal gap between buttons. Default 12. */
  readonly buttonGap?: number;
  /** Header title font size in px. Default 16. */
  readonly titleFontSize?: number;
  /** Header sub-line font size in px. Default 13. */
  readonly subFontSize?: number;
  /** Button glyph font size in px. Default 18. */
  readonly buttonFontSize?: number;
  /** Button shortcut hint font size in px. Default 11. */
  readonly hintFontSize?: number;
  /**
   * Whether the overlay registers DOM keyboard listeners on
   * construction. Default `true` for production; tests pass `false`
   * to drive `handleKeyDown(keyCode)` synthetically.
   */
  readonly enableKeyboardShortcuts?: boolean;
  /**
   * Whether the overlay starts visible. Default `true` — the replay
   * scene shows the VCR overlay as soon as it mounts. Tests pass
   * `false` to assert the explicit-show path.
   */
  readonly initiallyVisible?: boolean;
  /** Render depth — should sit above gameplay. Default 2500. */
  readonly depth?: number;
}

/**
 * Hooks the overlay calls in response to button clicks / keyboard
 * shortcuts. The replay scene wires these to the
 * `ReplayPlaybackController` so the same code path drives both the
 * pointer and the keyboard flow.
 *
 * Every callback is optional — an absent callback makes the
 * corresponding button + shortcut a no-op (the visual stays correct
 * because the band reflects the current state, not the binding).
 */
export interface VcrOverlayActions {
  readonly onPlay?: () => void;
  readonly onPause?: () => void;
  readonly onRewind?: () => void;
  readonly onFrameAdvance?: () => void;
  readonly onToggleSlowMotion?: () => void;
}

// ---------------------------------------------------------------------------
// Phaser shim — keeps tests Phaser-free
// ---------------------------------------------------------------------------

/**
 * Minimal subset of `Phaser.GameObjects.Text` we touch. Tests fulfill
 * this with a plain object; Phaser text objects satisfy it
 * structurally.
 */
interface OverlayTextLike {
  setText(value: string): OverlayTextLike;
  setColor(color: string): OverlayTextLike;
  setOrigin(x: number, y?: number): OverlayTextLike;
  setScrollFactor(x: number, y?: number): OverlayTextLike;
  setPosition(x: number, y: number): OverlayTextLike;
  setDepth(depth: number): OverlayTextLike;
  setVisible(visible: boolean): OverlayTextLike;
  setInteractive(): OverlayTextLike;
  on(event: string, fn: () => void): OverlayTextLike;
  destroy(): void;
  text: string;
  visible?: boolean;
}

/** Minimal subset of `Phaser.GameObjects.Rectangle` we touch. */
interface OverlayRectLike {
  setOrigin(x: number, y?: number): OverlayRectLike;
  setStrokeStyle(width: number, color: number, alpha?: number): OverlayRectLike;
  setFillStyle?(color: number, alpha?: number): OverlayRectLike;
  setScrollFactor(x: number, y?: number): OverlayRectLike;
  setPosition(x: number, y: number): OverlayRectLike;
  setSize?(width: number, height: number): OverlayRectLike;
  setDepth(depth: number): OverlayRectLike;
  setVisible(visible: boolean): OverlayRectLike;
  setInteractive?(): OverlayRectLike;
  on?(event: string, fn: () => void): OverlayRectLike;
  destroy(): void;
  visible?: boolean;
}

/** Minimal scene shape — the overlay never touches anything else. */
export interface VcrOverlaySceneShim {
  scale: { gameSize: { width: number; height: number } };
  add: {
    text(
      x: number,
      y: number,
      content: string,
      style: Record<string, unknown>,
    ): OverlayTextLike;
    rectangle(
      x: number,
      y: number,
      width: number,
      height: number,
      fillColor: number,
      fillAlpha?: number,
    ): OverlayRectLike;
  };
}

/**
 * One Phaser-rendered button — its background rect, glyph text, and
 * shortcut hint text. The overlay holds five of these in
 * `this.buttons[]` in canonical {@link VCR_CONTROL_ORDER} order.
 */
interface ButtonView {
  readonly control: VcrControl;
  readonly layout: VcrButtonLayout;
  readonly background: OverlayRectLike;
  readonly glyph: OverlayTextLike;
  readonly hint: OverlayTextLike;
  /** Last band painted, for hot-path skip. */
  paintedBand: VcrButtonVisualBand | null;
  /** True while the cursor is hovered over the button. */
  hovered: boolean;
  /** Computed centre coordinates so we can re-position on relayout. */
  cx: number;
  cy: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS: Required<Omit<VcrOverlayOptions, never>> = {
  x: 24,
  y: 24,
  width: 520,
  height: 160,
  padding: 16,
  buttonWidth: 64,
  buttonHeight: 40,
  buttonGap: 12,
  titleFontSize: 16,
  subFontSize: 13,
  buttonFontSize: 18,
  hintFontSize: 11,
  enableKeyboardShortcuts: true,
  initiallyVisible: true,
  depth: 2500,
};

const PANEL_FILL = 0x1a1c2c;
const PANEL_FILL_ALPHA = 0.88;
const PANEL_STROKE = 0x6cf0c2;
const PANEL_STROKE_ALPHA = 0.7;
const BUTTON_FILL = 0x2c2e3e;
const BUTTON_FILL_ALPHA = 0.95;

const COLOR_TITLE = '#e8e8f0';
const COLOR_SUB = '#a0a0b8';
const COLOR_HINT = '#808090';

// ---------------------------------------------------------------------------
// Internal — strip undefined keys so DEFAULTS shine through
// ---------------------------------------------------------------------------

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  const entries = Object.entries(obj) as Array<[keyof T, T[keyof T]]>;
  for (const [k, v] of entries) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Default playback state when no replay is loaded
// ---------------------------------------------------------------------------

const EMPTY_STATE: VcrPlaybackState = Object.freeze({
  phase: 'idle' as ReplayPlaybackPhase,
  isPlaying: false,
  isPaused: false,
  isSlowMotion: false,
  isFinished: false,
  currentFrame: 0,
  firstFrame: null,
  lastFrame: null,
  playbackRate: 1.0,
});

// ---------------------------------------------------------------------------
// Keyboard subscriber — minimal abstraction over `window.addEventListener`
// ---------------------------------------------------------------------------

/**
 * Pluggable keyboard binding. The overlay defaults to
 * `window.addEventListener('keydown', ...)` in the browser; tests
 * pass a synthetic dispatcher so they can drive `keyCode` events
 * without booting jsdom.
 */
export interface VcrKeyboardBinder {
  bind(handler: (keyCode: number) => void): () => void;
}

function defaultKeyboardBinder(): VcrKeyboardBinder | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  return {
    bind(handler) {
      const listener = (ev: KeyboardEvent): void => {
        // Reading `keyCode` keeps us aligned with `KEY_CODE` even though
        // it's marked deprecated — every browser still ships it and the
        // entire input module already keys off it.
        const code = (ev as { keyCode?: number }).keyCode ?? 0;
        handler(code);
      };
      window.addEventListener('keydown', listener);
      return () => window.removeEventListener('keydown', listener);
    },
  };
}

// ---------------------------------------------------------------------------
// VcrOverlay
// ---------------------------------------------------------------------------

/**
 * The VCR overlay component. One instance per replay session; created
 * when the playback scene mounts and destroyed when it unmounts.
 *
 * Lifecycle:
 *
 *   const overlay = new VcrOverlay(scene, {
 *     onPlay:             () => playback.start(),
 *     onPause:            () => playback.stop(),
 *     onRewind:           () => playback.seek(Math.max(0, playback.getCurrentFrame() - 60)),
 *     onFrameAdvance:     () => playback.advance(),
 *     onToggleSlowMotion: () => slowMo.toggle(),
 *   });
 *
 *   // every render frame:
 *   overlay.update(buildVcrState(playback, slowMo));
 *
 *   // teardown:
 *   overlay.destroy();
 */
export class VcrOverlay {
  private readonly scene: VcrOverlaySceneShim;
  private readonly options: Required<VcrOverlayOptions>;
  private readonly actions: VcrOverlayActions;

  private readonly background: OverlayRectLike;
  private readonly titleText: OverlayTextLike;
  private readonly phaseText: OverlayTextLike;
  private readonly timelineText: OverlayTextLike;
  private readonly buttons: ButtonView[] = [];

  /** Last state we painted — used by tests + hot-path skip on re-paint. */
  private lastState: VcrPlaybackState = EMPTY_STATE;
  /** Last header line we painted, cached so identical updates skip setText. */
  private paintedHeader: ReadonlyArray<string> | null = null;

  private destroyed = false;
  private visible = false;

  /** Unsubscribe handle for the keyboard binder. Null when shortcuts off. */
  private unbindKeyboard: (() => void) | null = null;

  constructor(
    scene: Phaser.Scene | VcrOverlaySceneShim,
    actions: VcrOverlayActions = {},
    options: VcrOverlayOptions = {},
    /**
     * Optional keyboard binder. Production callers leave this default;
     * tests pass a synthetic binder so they can fire `keyCode` events
     * deterministically.
     */
    keyboardBinder: VcrKeyboardBinder | null = defaultKeyboardBinder(),
  ) {
    this.scene = scene as unknown as VcrOverlaySceneShim;
    this.options = { ...DEFAULTS, ...stripUndefined(options) };
    this.actions = actions;

    const { x, y, width, height, padding, depth } = this.options;

    // ---- Panel background ----
    this.background = this.scene.add
      .rectangle(x, y, width, height, PANEL_FILL, PANEL_FILL_ALPHA)
      .setOrigin(0, 0)
      .setStrokeStyle(2, PANEL_STROKE, PANEL_STROKE_ALPHA)
      .setScrollFactor(0, 0)
      .setDepth(depth)
      .setVisible(false);

    // ---- Header text — three stacked lines ----
    this.titleText = this.scene.add
      .text(x + padding, y + padding, 'REPLAY PLAYBACK', {
        fontFamily: 'monospace',
        fontSize: `${this.options.titleFontSize}px`,
        color: COLOR_TITLE,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setDepth(depth)
      .setVisible(false);

    this.phaseText = this.scene.add
      .text(
        x + padding,
        y + padding + this.options.titleFontSize + 6,
        '',
        {
          fontFamily: 'monospace',
          fontSize: `${this.options.subFontSize}px`,
          color: COLOR_SUB,
        },
      )
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setDepth(depth)
      .setVisible(false);

    this.timelineText = this.scene.add
      .text(
        x + padding,
        y +
          padding +
          this.options.titleFontSize +
          6 +
          this.options.subFontSize +
          4,
        '',
        {
          fontFamily: 'monospace',
          fontSize: `${this.options.subFontSize}px`,
          color: COLOR_SUB,
        },
      )
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setDepth(depth)
      .setVisible(false);

    // ---- Buttons ----
    const totalButtonWidth =
      VCR_BUTTON_LAYOUT.length * this.options.buttonWidth +
      (VCR_BUTTON_LAYOUT.length - 1) * this.options.buttonGap;
    const buttonsStartX = x + (width - totalButtonWidth) / 2;
    const buttonsY = y + height - padding - this.options.buttonHeight - 14;

    for (let i = 0; i < VCR_BUTTON_LAYOUT.length; i += 1) {
      const layout = VCR_BUTTON_LAYOUT[i]!;
      const bx =
        buttonsStartX +
        i * (this.options.buttonWidth + this.options.buttonGap);
      const cx = bx + this.options.buttonWidth / 2;
      const cy = buttonsY + this.options.buttonHeight / 2;

      const background = this.scene.add
        .rectangle(
          bx,
          buttonsY,
          this.options.buttonWidth,
          this.options.buttonHeight,
          BUTTON_FILL,
          BUTTON_FILL_ALPHA,
        )
        .setOrigin(0, 0)
        .setStrokeStyle(1, buttonStateColor('idle'), 0.9)
        .setScrollFactor(0, 0)
        .setDepth(depth)
        .setVisible(false);
      // Some Phaser builds surface `setInteractive` / `on` on rectangles.
      // We tolerate either presence; tests always implement the optional
      // hooks so click-to-fire works in headless mode.
      if (typeof background.setInteractive === 'function') {
        background.setInteractive();
      }
      if (typeof background.on === 'function') {
        background.on('pointerover', () => {
          if (this.destroyed) return;
          const view = this.buttons.find((b) => b.background === background);
          if (view !== undefined) view.hovered = true;
          this.repaintButtons(this.lastState);
        });
        background.on('pointerout', () => {
          if (this.destroyed) return;
          const view = this.buttons.find((b) => b.background === background);
          if (view !== undefined) view.hovered = false;
          this.repaintButtons(this.lastState);
        });
        background.on('pointerdown', () => {
          this.activateControl(layout.control);
        });
      }

      const glyph = this.scene.add
        .text(cx, cy - 6, layout.glyph, {
          fontFamily: 'monospace',
          fontSize: `${this.options.buttonFontSize}px`,
          color: colorIntToHexString(buttonStateColor('idle')),
        })
        .setOrigin(0.5, 0.5)
        .setScrollFactor(0, 0)
        .setDepth(depth + 1)
        .setVisible(false)
        .setInteractive()
        .on('pointerover', () => {
          if (this.destroyed) return;
          const view = this.buttons.find((b) => b.glyph === glyph);
          if (view !== undefined) view.hovered = true;
          this.repaintButtons(this.lastState);
        })
        .on('pointerout', () => {
          if (this.destroyed) return;
          const view = this.buttons.find((b) => b.glyph === glyph);
          if (view !== undefined) view.hovered = false;
          this.repaintButtons(this.lastState);
        })
        .on('pointerdown', () => {
          this.activateControl(layout.control);
        });

      const hint = this.scene.add
        .text(cx, cy + this.options.buttonHeight / 2 + 2, layout.shortcutHint, {
          fontFamily: 'monospace',
          fontSize: `${this.options.hintFontSize}px`,
          color: COLOR_HINT,
        })
        .setOrigin(0.5, 0)
        .setScrollFactor(0, 0)
        .setDepth(depth)
        .setVisible(false);

      this.buttons.push({
        control: layout.control,
        layout,
        background,
        glyph,
        hint,
        paintedBand: null,
        hovered: false,
        cx,
        cy,
      });
    }

    // ---- Keyboard shortcuts ----
    if (this.options.enableKeyboardShortcuts && keyboardBinder !== null) {
      this.unbindKeyboard = keyboardBinder.bind((keyCode) => {
        this.handleKeyDown(keyCode);
      });
    }

    // ---- Initial visibility ----
    if (this.options.initiallyVisible) {
      this.setVisible(true);
    }

    // First paint with the empty state so the buttons / header have
    // valid text + colours even before the host calls `update()`.
    this.applyState(EMPTY_STATE, /*force*/ true);
  }

  // -------------------------------------------------------------------------
  // Public API — state updates
  // -------------------------------------------------------------------------

  /**
   * Refresh the overlay with a fresh playback state. Idempotent — the
   * formatter outputs are pure functions so calling `update()` twice
   * with the same state is a no-op apart from (skipped) text writes.
   *
   * The host scene is expected to build the `VcrPlaybackState` object
   * once per render frame from its `ReplayPlaybackController` snapshot
   * and any host-level slow-motion flag. We don't poll the controller
   * directly so the overlay stays decoupled from the playback layer's
   * concrete API surface.
   */
  update(state: VcrPlaybackState): void {
    if (this.destroyed) return;
    if (state === null || typeof state !== 'object') {
      throw new Error(`VcrOverlay.update: state must be a non-null object`);
    }
    this.applyState(state, /*force*/ false);
  }

  /**
   * Force the overlay's visibility on/off. The replay menu uses this
   * to dismiss the panel once the player has exited replay mode.
   * Idempotent.
   */
  setVisible(visible: boolean): void {
    if (this.destroyed) return;
    if (this.visible === visible) return;
    this.visible = visible;
    this.background.setVisible(visible);
    this.titleText.setVisible(visible);
    this.phaseText.setVisible(visible);
    this.timelineText.setVisible(visible);
    for (const btn of this.buttons) {
      btn.background.setVisible(visible);
      btn.glyph.setVisible(visible);
      btn.hint.setVisible(visible);
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Inject a synthetic key press. Production callers leave the
   * keyboard binder enabled and let DOM events fire this internally;
   * tests call this directly to assert the shortcut → action wiring.
   *
   * Returns the dispatched control, or `null` if the keyCode wasn't
   * bound to anything.
   */
  handleKeyDown(keyCode: number): VcrControl | null {
    if (this.destroyed) return null;
    // Space toggles play/pause based on current playback state — see
    // `resolveSpaceShortcut`.
    if (keyCode === KEY_CODE.SPACE) {
      const control = resolveSpaceShortcut(this.lastState);
      this.activateControl(control);
      return control;
    }
    const control = findControlForKeyCode(keyCode);
    if (control === null) return null;
    this.activateControl(control);
    return control;
  }

  /**
   * Programmatically fire a button's action — used by both the click
   * handler and `handleKeyDown`. Public so the host scene can wire
   * the same semantic onto e.g. a controller button without going
   * through the keyboard layer.
   */
  activateControl(control: VcrControl): void {
    if (this.destroyed) return;
    const fn = this.callbackForControl(control);
    if (fn === undefined) return;
    try {
      fn();
    } catch {
      /* swallow — overlay never crashes the scene */
    }
  }

  // -------------------------------------------------------------------------
  // Test-facing accessors
  // -------------------------------------------------------------------------

  /** The header line at index 0 (title) / 1 (phase·rate) / 2 (timeline). */
  getHeaderLine(index: number): string {
    if (index === 0) return this.titleText.text;
    if (index === 1) return this.phaseText.text;
    if (index === 2) return this.timelineText.text;
    return '';
  }

  getHeaderSnapshot(): ReadonlyArray<string> {
    return Object.freeze([
      this.titleText.text,
      this.phaseText.text,
      this.timelineText.text,
    ]);
  }

  /** Read-only snapshot of every button's painted band + glyph. */
  getButtonSnapshot(): ReadonlyArray<{
    readonly control: VcrControl;
    readonly band: VcrButtonVisualBand | null;
    readonly glyph: string;
    readonly hint: string;
  }> {
    return Object.freeze(
      this.buttons.map((b) =>
        Object.freeze({
          control: b.control,
          band: b.paintedBand,
          glyph: b.glyph.text,
          hint: b.hint.text,
        }),
      ),
    );
  }

  /** Most recent state painted, or the empty state. */
  getLastState(): VcrPlaybackState {
    return this.lastState;
  }

  /**
   * Test hook — drive a hover state for the named button. Production
   * code uses Phaser's pointerover / pointerout events; tests skip
   * those by hitting this directly.
   */
  setHoverForTest(control: VcrControl, hovered: boolean): void {
    if (this.destroyed) return;
    const view = this.buttons.find((b) => b.control === control);
    if (view !== undefined) view.hovered = hovered;
    this.repaintButtons(this.lastState);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Tear down all Phaser children + unbind keyboard listeners. Call
   * from the scene's `shutdown` hook. Idempotent.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.unbindKeyboard !== null) {
      try {
        this.unbindKeyboard();
      } catch {
        /* swallow — destroy must not throw */
      }
      this.unbindKeyboard = null;
    }
    this.background.destroy();
    this.titleText.destroy();
    this.phaseText.destroy();
    this.timelineText.destroy();
    for (const btn of this.buttons) {
      btn.background.destroy();
      btn.glyph.destroy();
      btn.hint.destroy();
    }
    this.buttons.length = 0;
  }

  // -------------------------------------------------------------------------
  // Internal painting
  // -------------------------------------------------------------------------

  private applyState(state: VcrPlaybackState, force: boolean): void {
    this.lastState = state;
    const lines = buildHeaderLines(state);
    if (
      force ||
      this.paintedHeader === null ||
      this.paintedHeader[0] !== lines[0] ||
      this.paintedHeader[1] !== lines[1] ||
      this.paintedHeader[2] !== lines[2]
    ) {
      // Title line is static today, but we still write it on first
      // paint so a future i18n pass can vary it.
      if (force || this.paintedHeader === null || this.paintedHeader[0] !== lines[0]) {
        this.titleText.setText(lines[0] ?? '');
      }
      if (force || this.paintedHeader === null || this.paintedHeader[1] !== lines[1]) {
        this.phaseText.setText(lines[1] ?? '');
      }
      if (force || this.paintedHeader === null || this.paintedHeader[2] !== lines[2]) {
        this.timelineText.setText(lines[2] ?? '');
      }
      this.paintedHeader = lines;
    }
    this.repaintButtons(state);
  }

  private repaintButtons(state: VcrPlaybackState): void {
    for (const btn of this.buttons) {
      const band = resolveButtonBand(btn.control, state, btn.hovered);
      if (band === btn.paintedBand) continue;
      btn.paintedBand = band;
      const colorInt = buttonStateColor(band);
      const colorHex = colorIntToHexString(colorInt);
      btn.glyph.setColor(colorHex);
      // Fill the rectangle with a subtly different colour so the band
      // change is legible without rendering an icon font.
      if (typeof btn.background.setStrokeStyle === 'function') {
        btn.background.setStrokeStyle(2, colorInt, 0.95);
      }
      if (typeof btn.background.setFillStyle === 'function') {
        const fillColor =
          band === 'active'
            ? colorInt
            : band === 'disabled'
              ? 0x1c1d28
              : BUTTON_FILL;
        const fillAlpha = band === 'active' ? 0.32 : BUTTON_FILL_ALPHA;
        btn.background.setFillStyle(fillColor, fillAlpha);
      }
    }
  }

  private callbackForControl(control: VcrControl): (() => void) | undefined {
    switch (control) {
      case VCR_CONTROL.PLAY:
        return this.actions.onPlay;
      case VCR_CONTROL.PAUSE:
        return this.actions.onPause;
      case VCR_CONTROL.REWIND:
        return this.actions.onRewind;
      case VCR_CONTROL.FRAME_ADVANCE:
        return this.actions.onFrameAdvance;
      case VCR_CONTROL.SLOW_MOTION:
        return this.actions.onToggleSlowMotion;
      default: {
        const exhaustive: never = control;
        void exhaustive;
        return undefined;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helper — construct a VcrPlaybackState snapshot from a controller +
// host-level slow-motion flag. Pure function; lives here so callers
// don't have to recreate the same boilerplate per scene.
// ---------------------------------------------------------------------------

/**
 * Source surface the helper reads — narrow enough that any object
 * exposing the four getters satisfies it. The real
 * `ReplayPlaybackController` does, by name match.
 */
export interface VcrPlaybackStateSource {
  getPhase(): ReplayPlaybackPhase;
  getCurrentFrame(): number;
  getFirstFrame(): number | null;
  getLastFrame(): number | null;
  isPlaying(): boolean;
  isFinished(): boolean;
}

/**
 * Build a `VcrPlaybackState` from a controller + slow-motion flag +
 * desired playback rate. Pure function — same inputs, same output.
 */
export function buildVcrPlaybackState(
  source: VcrPlaybackStateSource,
  slowMotion: boolean,
  playbackRate: number,
): VcrPlaybackState {
  const phase = source.getPhase();
  const isPlaying = source.isPlaying();
  const isFinished = source.isFinished();
  // 'paused' = we have a replay loaded but aren't currently advancing.
  const isPaused = !isPlaying && !isFinished && phase !== 'idle';
  return Object.freeze({
    phase,
    isPlaying,
    isPaused,
    isSlowMotion: slowMotion,
    isFinished,
    currentFrame: source.getCurrentFrame(),
    firstFrame: source.getFirstFrame(),
    lastFrame: source.getLastFrame(),
    playbackRate,
  });
}
