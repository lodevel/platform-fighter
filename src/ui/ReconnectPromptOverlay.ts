/**
 * Reconnect-prompt overlay — AC 14 Sub-AC 3.
 *
 * Phaser-touching presentation layer for the controller-disconnect /
 * reconnect lifecycle. When {@link DisconnectPauseController} pauses
 * the simulation (Sub-AC 2), this overlay is what the affected human
 * actually sees: a centred panel that names their slot ("P1 + P3 —
 * Controllers disconnected"), spells out what to do ("Plug the
 * controller back in to resume"), and dismisses itself once the
 * controller resolves the freeze.
 *
 * Layout
 * ------
 *
 *     ┌──────────────────────────────────────────────────┐
 *     │ ▌                                                │  ← left accent strip (per-slot tint)
 *     │ ▌  P1 + P3 — Controllers disconnected            │  ← headline
 *     │ ▌                                                │
 *     │ ▌  Plug the controller back in to resume.        │  ← body line 1
 *     │ ▌  Press Start on a connected pad to continue…   │  ← body line 2
 *     │ ▌                                                │
 *     └──────────────────────────────────────────────────┘
 *
 * Why a separate overlay, not extend the M1 disconnect banner
 * -----------------------------------------------------------
 *
 * The Sub-AC 2 banner is a single-text element pinned above the
 * "GAME!" splash. It's good enough to *acknowledge* a disconnect for
 * the M1 scaffold but doesn't carry per-slot accenting, body-line
 * remediation copy, or partial-reconnect state — all of which are
 * Sub-AC 3 requirements. Extracting the prompt into a dedicated
 * overlay (mirroring `DesyncReportOverlay`) lets:
 *
 *   • the unit suite drive every UI branch through a Phaser-free
 *     scene shim — same pattern as `DamageHud` / `RebindingScreen`;
 *   • `MatchScene` swap the inline-banner code for an overlay
 *     instance without growing scene-level surface area;
 *   • a future surface (the lobby disconnect warning, the rebinding
 *     screen's "your pad just left" dialog) re-use the same prompt
 *     without copy-pasting the layout math.
 *
 * Determinism
 * -----------
 *
 * Render-only. Pure formatters in `reconnectPromptFormat.ts` produce
 * the strings; this file does Phaser text/rectangle plumbing. No
 * Matter, no RNG, no wall-clock — replays never re-enter the overlay's
 * logic. A recorded match that includes a disconnect marker will
 * deterministically repaint the overlay when the marker re-fires
 * during playback.
 */

import type Phaser from 'phaser';
import type { PlayerBindingsIndex } from '../types/inputBindings';
import {
  buildPromptLines,
  colorIntToHexString,
  formatPromptHeadline,
  formatPromptBodyLines,
  shouldShowOverlay,
  slotAccentColor,
  type ReconnectPromptPhase,
  type ReconnectPromptSnapshot,
} from './reconnectPromptFormat';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Cosmetic / layout tuning. Defaults match the M1 disconnect banner so
 * a swap-in over the existing scene reads as the same UI element with
 * extra body text — no jarring repositioning.
 */
export interface ReconnectPromptOverlayOptions {
  /** Centre X of the overlay panel. Default: scene width / 2. */
  readonly centerX?: number;
  /** Centre Y of the overlay panel. Default: scene height / 2 - 110. */
  readonly centerY?: number;
  /** Panel width in px. Default 560. */
  readonly width?: number;
  /** Padding inside the panel (all sides). Default 18. */
  readonly padding?: number;
  /** Pixel height of the headline. Default 32. */
  readonly headlineLineHeight?: number;
  /** Pixel height of one body line. Default 24. */
  readonly bodyLineHeight?: number;
  /** Headline font size. Default 24. */
  readonly headlineFontSize?: number;
  /** Body font size. Default 16. */
  readonly bodyFontSize?: number;
  /** Maximum body lines to allocate text slots for. Default 4. */
  readonly maxBodyLines?: number;
  /** Accent strip width on the left of the panel. Default 6. */
  readonly accentWidth?: number;
  /**
   * Phaser depth — pinned high so the overlay always sits over hazards,
   * stage backgrounds, and the M1 disconnect banner. Default 2100 (one
   * tier above the desync overlay's 2000).
   */
  readonly depth?: number;
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
  setAlpha(alpha: number): OverlayTextLike;
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
  destroy(): void;
  fillColor?: number;
  visible?: boolean;
}

/** Minimal scene shape — the overlay never touches anything else. */
export interface ReconnectPromptOverlaySceneShim {
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

// ---------------------------------------------------------------------------
// Defaults / palette
// ---------------------------------------------------------------------------

const DEFAULTS: Required<ReconnectPromptOverlayOptions> = {
  centerX: -1, // sentinel meaning "scene-centred"
  centerY: -1,
  width: 560,
  padding: 18,
  headlineLineHeight: 32,
  bodyLineHeight: 24,
  headlineFontSize: 24,
  bodyFontSize: 16,
  maxBodyLines: 4,
  accentWidth: 6,
  depth: 2100,
};

const PANEL_FILL = 0x000000;
const PANEL_FILL_ALPHA = 0.78;
const PANEL_STROKE_ALPHA = 0.95;

const COLOR_HEADLINE = '#ffd166';
const COLOR_BODY = '#e8e8f0';

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
// ReconnectPromptOverlay
// ---------------------------------------------------------------------------

/**
 * Overlay that paints the active reconnect prompt for the
 * controller-disconnect lifecycle. One instance per gameplay scene;
 * created in `create()` and destroyed in `shutdown`.
 *
 * Lifecycle:
 *
 *   const overlay = new ReconnectPromptOverlay(scene);
 *   // every disconnect / reconnect event from
 *   // `DisconnectPauseController.onPause` / `onResume`:
 *   overlay.update({
 *     affectedSlots: event.affectedSlotsTotal,
 *     phase: 'waiting',
 *   });
 *   // teardown:
 *   overlay.destroy();
 *
 * The overlay only ever paints — it does not subscribe to the
 * controller. The MatchScene wires controller events to
 * `overlay.update(...)` so the overlay stays a passive renderer. This
 * preserves replay determinism: a recorded disconnect marker re-fires
 * the controller path, which re-feeds the overlay, which re-paints
 * the same lines.
 */
export class ReconnectPromptOverlay {
  private readonly scene: ReconnectPromptOverlaySceneShim;
  private readonly options: Required<ReconnectPromptOverlayOptions>;

  private readonly background: OverlayRectLike;
  private readonly accentStrip: OverlayRectLike;
  private readonly headlineText: OverlayTextLike;
  private readonly bodyTexts: OverlayTextLike[] = [];

  /** Centre of the panel — resolved at construction so layout is stable. */
  private readonly centerX: number;
  private readonly centerY: number;
  /** Computed at construction so resize-driven re-layout is cheap. */
  private readonly panelHeight: number;

  private destroyed = false;
  private visible = false;
  private lastSnapshot: ReconnectPromptSnapshot | null = null;

  constructor(
    scene: Phaser.Scene | ReconnectPromptOverlaySceneShim,
    options: ReconnectPromptOverlayOptions = {},
  ) {
    this.scene = scene as unknown as ReconnectPromptOverlaySceneShim;
    this.options = { ...DEFAULTS, ...stripUndefined(options) };

    const { gameSize } = this.scene.scale;
    this.centerX =
      this.options.centerX === DEFAULTS.centerX
        ? gameSize.width / 2
        : this.options.centerX;
    this.centerY =
      this.options.centerY === DEFAULTS.centerY
        ? gameSize.height / 2 - 110
        : this.options.centerY;

    this.panelHeight = this.computeHeight(this.options.maxBodyLines);

    const { width, padding, depth, accentWidth } = this.options;
    const halfWidth = width / 2;
    const halfHeight = this.panelHeight / 2;

    // Background panel — origin centred so we can position by panel
    // centre and let the accent strip / text align off the same axis.
    this.background = this.scene.add
      .rectangle(
        this.centerX,
        this.centerY,
        width,
        this.panelHeight,
        PANEL_FILL,
        PANEL_FILL_ALPHA,
      )
      .setOrigin(0.5, 0.5)
      .setStrokeStyle(2, slotAccentColor(1), PANEL_STROKE_ALPHA)
      .setScrollFactor(0, 0)
      .setDepth(depth)
      .setVisible(false);

    // Accent strip — left-edge column tinted to the first affected
    // slot's palette colour so a player whose colour-blind setup blurs
    // the headline still gets a per-slot cue.
    const accentX = this.centerX - halfWidth + accentWidth / 2;
    this.accentStrip = this.scene.add
      .rectangle(
        accentX,
        this.centerY,
        accentWidth,
        this.panelHeight,
        slotAccentColor(1),
        1,
      )
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0, 0)
      .setDepth(depth + 1)
      .setVisible(false);

    // Headline — left-justified inside the panel, just past the accent
    // strip + padding.
    const textLeftX = this.centerX - halfWidth + accentWidth + padding;
    const headlineY =
      this.centerY - halfHeight + padding + this.options.headlineLineHeight / 2;
    this.headlineText = this.scene.add
      .text(textLeftX, headlineY, '', {
        fontFamily: 'monospace',
        fontSize: `${this.options.headlineFontSize}px`,
        color: COLOR_HEADLINE,
        align: 'left',
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0, 0)
      .setDepth(depth + 1)
      .setVisible(false);

    // Body — pre-allocated so a multi-line snapshot doesn't churn
    // Phaser text resources. Hidden text slots simply paint the empty
    // string when their snapshot has fewer lines.
    const bodyTopY =
      this.centerY -
      halfHeight +
      padding +
      this.options.headlineLineHeight +
      8;
    for (let i = 0; i < this.options.maxBodyLines; i += 1) {
      const lineY = bodyTopY + i * this.options.bodyLineHeight + this.options.bodyLineHeight / 2;
      const lineText = this.scene.add
        .text(textLeftX, lineY, '', {
          fontFamily: 'monospace',
          fontSize: `${this.options.bodyFontSize}px`,
          color: COLOR_BODY,
          align: 'left',
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0, 0)
        .setDepth(depth + 1)
        .setVisible(false);
      this.bodyTexts.push(lineText);
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Apply a fresh snapshot. Updates the headline, body lines, and
   * accent tint; toggles visibility per `shouldShowOverlay(snapshot)`.
   *
   * Idempotent — the formatter outputs are pure functions of the
   * snapshot so calling `update()` twice with the same snapshot is a
   * no-op apart from the (ignored) text writes.
   */
  update(snapshot: ReconnectPromptSnapshot): void {
    if (this.destroyed) return;
    if (snapshot === null || typeof snapshot !== 'object') {
      throw new Error(
        `ReconnectPromptOverlay.update: snapshot must be a non-null object`,
      );
    }
    this.lastSnapshot = snapshot;

    // Headline
    this.headlineText.setText(formatPromptHeadline(snapshot));

    // Body lines — paint up to maxBodyLines, blank the rest.
    const bodyLines = formatPromptBodyLines(snapshot);
    for (let i = 0; i < this.bodyTexts.length; i += 1) {
      const slot = this.bodyTexts[i];
      if (slot === undefined) continue;
      const line = bodyLines[i] ?? '';
      slot.setText(line);
    }

    // Accent — tint to the first affected slot, fall back to a neutral
    // slate when no slot is named (acknowledged / reconnected phases).
    const slots = snapshot.affectedSlots ?? [];
    const firstSlot = slots[0];
    const accent =
      firstSlot === undefined
        ? slotAccentColor(0 as PlayerBindingsIndex)
        : slotAccentColor(firstSlot);
    if (typeof this.accentStrip.setFillStyle === 'function') {
      this.accentStrip.setFillStyle(accent, 1);
    }
    this.background.setStrokeStyle(2, accent, PANEL_STROKE_ALPHA);

    // Visibility — driven by the phase predicate.
    this.setVisible(shouldShowOverlay(snapshot));
  }

  /**
   * Force the overlay's visibility on/off. The MatchScene normally
   * lets `update()` drive visibility, but a teardown / scene transition
   * can call `setVisible(false)` explicitly to clear a pending prompt.
   * Idempotent.
   */
  setVisible(visible: boolean): void {
    if (this.destroyed) return;
    if (this.visible === visible) {
      // Even when the visibility flag is already correct, the
      // headline/body text fields may still be blank from a previous
      // hide-then-show round (the constructor leaves them empty); we
      // only short-circuit when there's already an active snapshot
      // driving the same state.
      if (visible && this.lastSnapshot === null) return;
      if (!visible) return;
    }
    this.visible = visible;
    this.background.setVisible(visible);
    this.accentStrip.setVisible(visible);
    this.headlineText.setVisible(visible);
    for (const t of this.bodyTexts) {
      const hasText = t.text.length > 0;
      t.setVisible(visible && hasText);
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Convenience helper — produce a snapshot for the "match resumed"
   * phase and feed it through `update()`. The MatchScene calls this
   * on the controller's full-resume path so the overlay flashes
   * "Resuming match…" before hiding itself.
   */
  showResumed(): void {
    this.update({ affectedSlots: [], phase: 'reconnected' });
  }

  /**
   * Convenience helper — produce a snapshot for the "player chose to
   * keep playing" path and feed it through `update()`. The MatchScene
   * calls this when `acknowledgeAndResume()` fires.
   */
  showAcknowledged(): void {
    this.update({ affectedSlots: [], phase: 'acknowledged' });
  }

  /**
   * Tear down all Phaser children. Call from the scene's `shutdown`
   * hook. Idempotent — a stray late call after destroy is a no-op.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.background.destroy();
    this.accentStrip.destroy();
    this.headlineText.destroy();
    for (const t of this.bodyTexts) t.destroy();
  }

  // -------------------------------------------------------------------------
  // Test-facing accessors — mirror the DesyncReportOverlay surface
  // -------------------------------------------------------------------------

  /** Snapshot most recently fed to `update()`, or null. */
  getLastSnapshot(): ReconnectPromptSnapshot | null {
    return this.lastSnapshot;
  }

  /** Read-only snapshot of every visible body line. */
  getVisibleBodyLines(): ReadonlyArray<string> {
    const out: string[] = [];
    for (const t of this.bodyTexts) {
      if (t.visible === true) out.push(t.text);
    }
    return Object.freeze(out);
  }

  /** Read-only snapshot of every line the overlay paints (headline + body). */
  getRenderedLines(): ReadonlyArray<string> {
    if (this.lastSnapshot === null) return Object.freeze<string[]>([]);
    return buildPromptLines(this.lastSnapshot);
  }

  /** Currently-active phase, derived from the last snapshot. */
  getPhase(): ReconnectPromptPhase | null {
    return this.lastSnapshot === null ? null : this.lastSnapshot.phase;
  }

  /** Test-only: read the resolved hex colour driving the accent strip. */
  getAccentColor(): number {
    return this.accentStrip.fillColor ?? 0;
  }

  /** Test-only: read the panel-stroke colour. */
  getStrokeColorHex(): string {
    // Forwarded so a stylesheet snapshot can compare textually against
    // the format helper's `colorIntToHexString(slotAccentColor(...))`.
    return colorIntToHexString(this.getAccentColor());
  }

  // -------------------------------------------------------------------------
  // Internal layout
  // -------------------------------------------------------------------------

  private computeHeight(maxBodyLines: number): number {
    const { padding, headlineLineHeight, bodyLineHeight } = this.options;
    return (
      padding * 2 +
      headlineLineHeight +
      8 +
      maxBodyLines * bodyLineHeight
    );
  }
}
