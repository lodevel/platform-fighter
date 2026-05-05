/**
 * Desync report overlay — AC 30203 Sub-AC 3.
 *
 * The Phaser-touching presentation layer for the M4 desync recovery
 * pipeline. Where {@link ../replay/DesyncRecoveryController} accumulates
 * the structured {@link DesyncReport} and `desyncReportFormat.ts`
 * turns that report into UI strings, this component paints those
 * strings onto the screen and toggles itself in/out of view based on
 * the controller's verdict.
 *
 * Layout
 * ------
 *
 *     ┌──────────────────────────────────────────────────────────────┐
 *     │                                                              │
 *     │   REPLAY DESYNC (halted)                                     │  ← banner verdict
 *     │   status: halted · halted at frame 5400: policy 'halt-on-…'  │  ← banner sub-line
 *     │   tolerance: halt on first divergence                        │  ← tolerance line
 *     │   frames: 5401 · pins: 18 · matches: 17 · divergences: 1     │  ← stat line
 *     │                                                              │
 *     │   f5400 · mismatch · state-fnv1a-64-v1                       │  ← row label
 *     │     expected aaaaaaaaaa…, got bbbbbbbbbb…                    │  ← row diff
 *     │   f5700 · mismatch · state-fnv1a-64-v1                       │
 *     │     expected …, got …                                        │
 *     │                                                              │
 *     │   [ Continue ]   [ Halt ]                                    │  ← recovery actions
 *     │                                                              │
 *     └──────────────────────────────────────────────────────────────┘
 *
 * The `[ Continue ] / [ Halt ]` buttons let a player override the
 * configured tolerance from the overlay itself — clicking `Halt`
 * promotes the report's verdict to `'fail-halted'` and fires the
 * controller's halt path; `Continue` is a no-op when the controller
 * is still monitoring (so the player can dismiss the overlay) and
 * relaxes the tolerance to `'continue'` once a halt has fired (so
 * the player can override "halt-on-first" to keep playing).
 *
 * Why this lives in `src/ui/` (mirrors `DamageHud` / `RebindingScreen`)
 * --------------------------------------------------------------------
 *
 *   • Single responsibility — the deterministic verifier and the
 *     recovery controller already exist; this file is presentation.
 *   • Testability — the overlay talks to a narrow `OverlaySceneShim`
 *     so the unit suite drives it under plain Node + vitest.
 *
 * Determinism
 * -----------
 *
 * The overlay is render-only. Pure formatters in
 * `desyncReportFormat.ts` produce its strings; this file does Phaser
 * text/rectangle plumbing. No Matter, no RNG, no wall-clock — replays
 * never re-enter the overlay's logic.
 */

import type Phaser from 'phaser';
import type {
  DesyncRecoveryController,
  DesyncReport,
} from '../replay/DesyncRecoveryController';
import {
  buildBannerLines,
  buildDivergenceRows,
  colorIntToHexString,
  verdictColor,
  type DivergenceRow,
} from './desyncReportFormat';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Cosmetic / layout tuning. */
export interface DesyncReportOverlayOptions {
  /** Top-left X of the overlay panel. Default 24. */
  readonly x?: number;
  /** Top-left Y of the overlay panel. Default 24. */
  readonly y?: number;
  /** Panel width in px. Default 560. */
  readonly width?: number;
  /** Pixel height of one banner line. Default 22. */
  readonly bannerLineHeight?: number;
  /** Pixel height of one row label. Default 20. */
  readonly rowLineHeight?: number;
  /** Pixel height of one row diff. Default 18. */
  readonly diffLineHeight?: number;
  /** Padding inside the panel. Default 16. */
  readonly padding?: number;
  /** Maximum divergence rows to render. Default 8. */
  readonly maxRows?: number;
  /** Banner verdict font size in px. Default 22. */
  readonly bannerFontSize?: number;
  /** Stat / tolerance line font size in px. Default 14. */
  readonly subFontSize?: number;
  /** Row label font size in px. Default 14. */
  readonly rowFontSize?: number;
  /** Row diff font size in px. Default 12. */
  readonly diffFontSize?: number;
  /**
   * When `true`, the overlay automatically shows itself the first time
   * a divergence appears (the banner flips from `pending` to a fail
   * verdict). Default `true` — the M4 menu wants the report to surface
   * automatically; tests pass `false` to assert the explicit-show path.
   */
  readonly autoShowOnDivergence?: boolean;
}

/**
 * Hooks the overlay calls in response to the player clicking the
 * `[Continue] / [Halt]` buttons. The replay menu wires these to the
 * `DesyncRecoveryController` so the buttons drive the same recovery
 * pipeline as the policy-driven path.
 *
 * Both callbacks default to no-ops; in headless mode the overlay
 * still renders the buttons but clicking them is harmless.
 */
export interface DesyncReportOverlayActions {
  readonly onContinue?: () => void;
  readonly onHalt?: () => void;
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
  setScrollFactor(x: number, y?: number): OverlayRectLike;
  setPosition(x: number, y: number): OverlayRectLike;
  setSize?(width: number, height: number): OverlayRectLike;
  setDepth(depth: number): OverlayRectLike;
  setVisible(visible: boolean): OverlayRectLike;
  destroy(): void;
  visible?: boolean;
}

/** Minimal scene shape — the overlay never touches anything else. */
export interface DesyncReportOverlaySceneShim {
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
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS: Required<DesyncReportOverlayOptions> = {
  x: 24,
  y: 24,
  width: 560,
  bannerLineHeight: 22,
  rowLineHeight: 20,
  diffLineHeight: 18,
  padding: 16,
  maxRows: 8,
  bannerFontSize: 22,
  subFontSize: 14,
  rowFontSize: 14,
  diffFontSize: 12,
  autoShowOnDivergence: true,
};

const PANEL_FILL = 0x1a1c2c;
const PANEL_FILL_ALPHA = 0.92;
const PANEL_STROKE_ALPHA = 0.95;

const COLOR_SUB_LINE = '#a0a0b8';
const COLOR_ROW_LABEL = '#e8e8f0';
const COLOR_ROW_DIFF = '#a0a0b8';
const COLOR_BUTTON_TEXT = '#e8e8f0';
const COLOR_BUTTON_HALT = '#ff6b6b';
const COLOR_BUTTON_CONTINUE = '#6cf0c2';

const OVERLAY_DEPTH = 2000;

// Constant banner-line slot count — verdict + status + tolerance + stat.
// Reflects buildBannerLines() output length. Pinned here so the layout
// helper doesn't have to call into the formatter just to measure.
const BANNER_LINE_COUNT = 4;

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
// DesyncReportOverlay
// ---------------------------------------------------------------------------

/**
 * Overlay that paints the active {@link DesyncReport} into a fixed-
 * position panel. One instance per replay session; created when the
 * playback scene mounts and destroyed when it unmounts.
 *
 * Lifecycle:
 *
 *   const overlay = new DesyncReportOverlay(scene, {
 *     onContinue: () => controller.setTolerance({ kind: 'continue' }),
 *     onHalt:     () => controller.halt('manual halt from overlay'),
 *   });
 *   // every render frame:
 *   overlay.update(controller.getReport());
 *   // teardown:
 *   overlay.destroy();
 */
export class DesyncReportOverlay {
  private readonly scene: DesyncReportOverlaySceneShim;
  private readonly options: Required<DesyncReportOverlayOptions>;
  private readonly actions: DesyncReportOverlayActions;

  private readonly background: OverlayRectLike;
  private readonly bannerTexts: OverlayTextLike[] = [];
  private readonly rowLabelTexts: OverlayTextLike[] = [];
  private readonly rowDiffTexts: OverlayTextLike[] = [];
  private readonly continueButton: OverlayTextLike;
  private readonly haltButton: OverlayTextLike;

  private destroyed = false;
  private visible = false;
  private lastReport: DesyncReport | null = null;
  /**
   * Set true once `update()` sees a non-pending verdict. Used to
   * implement `autoShowOnDivergence` without re-flipping visibility
   * on every subsequent update.
   */
  private autoShownOnce = false;

  constructor(
    scene: Phaser.Scene | DesyncReportOverlaySceneShim,
    actions: DesyncReportOverlayActions = {},
    options: DesyncReportOverlayOptions = {},
  ) {
    this.scene = scene as unknown as DesyncReportOverlaySceneShim;
    this.options = { ...DEFAULTS, ...stripUndefined(options) };
    this.actions = actions;

    const { x, y, width, padding, maxRows } = this.options;
    const height = this.computeHeight(maxRows);

    this.background = this.scene.add
      .rectangle(x, y, width, height, PANEL_FILL, PANEL_FILL_ALPHA)
      .setOrigin(0, 0)
      .setStrokeStyle(2, verdictColor('pending'), PANEL_STROKE_ALPHA)
      .setScrollFactor(0, 0)
      .setDepth(OVERLAY_DEPTH)
      .setVisible(false);

    // Banner — 4 stacked text lines.
    for (let i = 0; i < BANNER_LINE_COUNT; i += 1) {
      const lineY = y + padding + i * this.options.bannerLineHeight;
      const bannerText = this.scene.add
        .text(x + padding, lineY, '', {
          fontFamily: 'monospace',
          fontSize:
            i === 0
              ? `${this.options.bannerFontSize}px`
              : `${this.options.subFontSize}px`,
          color: i === 0 ? colorIntToHexString(verdictColor('pending')) : COLOR_SUB_LINE,
        })
        .setOrigin(0, 0)
        .setScrollFactor(0, 0)
        .setDepth(OVERLAY_DEPTH)
        .setVisible(false);
      this.bannerTexts.push(bannerText);
    }

    // Pre-allocate row text objects up to the cap. We toggle visibility
    // (rather than create / destroy) so a busy overlay doesn't churn
    // Phaser text resources.
    const rowsTopY =
      y + padding + BANNER_LINE_COUNT * this.options.bannerLineHeight + 8;
    for (let i = 0; i < maxRows; i += 1) {
      const labelY =
        rowsTopY +
        i * (this.options.rowLineHeight + this.options.diffLineHeight);
      const diffY = labelY + this.options.rowLineHeight;
      const labelText = this.scene.add
        .text(x + padding, labelY, '', {
          fontFamily: 'monospace',
          fontSize: `${this.options.rowFontSize}px`,
          color: COLOR_ROW_LABEL,
        })
        .setOrigin(0, 0)
        .setScrollFactor(0, 0)
        .setDepth(OVERLAY_DEPTH)
        .setVisible(false);
      const diffText = this.scene.add
        .text(x + padding + 16, diffY, '', {
          fontFamily: 'monospace',
          fontSize: `${this.options.diffFontSize}px`,
          color: COLOR_ROW_DIFF,
        })
        .setOrigin(0, 0)
        .setScrollFactor(0, 0)
        .setDepth(OVERLAY_DEPTH)
        .setVisible(false);
      this.rowLabelTexts.push(labelText);
      this.rowDiffTexts.push(diffText);
    }

    // Recovery action buttons — always present, visibility toggled
    // alongside the panel background.
    const buttonY = y + height - padding - 18;
    this.continueButton = this.scene.add
      .text(x + padding, buttonY, '[ Continue ]', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: COLOR_BUTTON_CONTINUE,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setDepth(OVERLAY_DEPTH)
      .setVisible(false)
      .setInteractive()
      .on('pointerdown', () => {
        if (this.destroyed) return;
        const fn = this.actions.onContinue;
        if (fn !== undefined) {
          try {
            fn();
          } catch {
            /* swallow — overlay never crashes the scene */
          }
        }
      });
    this.haltButton = this.scene.add
      .text(x + padding + 160, buttonY, '[ Halt ]', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: COLOR_BUTTON_HALT,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setDepth(OVERLAY_DEPTH)
      .setVisible(false)
      .setInteractive()
      .on('pointerdown', () => {
        if (this.destroyed) return;
        const fn = this.actions.onHalt;
        if (fn !== undefined) {
          try {
            fn();
          } catch {
            /* swallow */
          }
        }
      });

    // Render text colour/value placeholder so the constructor leaves
    // the overlay in a consistent zero-state when a future caller
    // toggles `setVisible(true)` before the first `update()`.
    this.applyButtonText('Continue', COLOR_BUTTON_CONTINUE);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Apply a fresh report. Updates the banner text + colour, the
   * divergence rows, and (when `autoShowOnDivergence` is set) toggles
   * visibility the first time the verdict moves off `'pending'`.
   *
   * Idempotent — the formatter outputs are pure functions of the
   * report so calling `update()` twice with the same report is a
   * no-op apart from the (ignored) text writes.
   */
  update(report: DesyncReport): void {
    if (this.destroyed) return;
    if (report === null || typeof report !== 'object') {
      throw new Error(
        `DesyncReportOverlay.update: report must be a non-null object`,
      );
    }
    this.lastReport = report;

    const banner = buildBannerLines(report);
    for (let i = 0; i < this.bannerTexts.length; i += 1) {
      const txt = this.bannerTexts[i];
      const line = banner[i] ?? '';
      if (txt === undefined) continue;
      txt.setText(line);
      if (i === 0) {
        txt.setColor(colorIntToHexString(verdictColor(report.verdict)));
      }
    }

    // Re-stroke the panel border to match the verdict colour. This
    // gives the overlay a colour-coded "frame" that's visible behind
    // even a packed divergence list.
    this.background.setStrokeStyle(
      2,
      verdictColor(report.verdict),
      PANEL_STROKE_ALPHA,
    );

    const rows = buildDivergenceRows(report, this.options.maxRows);
    this.applyRows(rows);

    // Decide button affordances based on report status.
    if (report.status === 'halted') {
      this.applyButtonText('Continue (force resume)', COLOR_BUTTON_CONTINUE);
    } else {
      this.applyButtonText('Dismiss', COLOR_BUTTON_TEXT);
    }

    if (
      this.options.autoShowOnDivergence &&
      !this.autoShownOnce &&
      report.verdict !== 'pending'
    ) {
      this.autoShownOnce = true;
      this.setVisible(true);
    }
  }

  /**
   * Force the overlay's visibility on/off. The replay menu uses this
   * to dismiss the panel once the player has reviewed the report.
   * Idempotent.
   */
  setVisible(visible: boolean): void {
    if (this.destroyed) return;
    if (this.visible === visible) return;
    this.visible = visible;
    this.background.setVisible(visible);
    for (const t of this.bannerTexts) t.setVisible(visible);
    for (const t of this.rowLabelTexts) t.setVisible(visible);
    for (const t of this.rowDiffTexts) t.setVisible(visible);
    this.continueButton.setVisible(visible);
    this.haltButton.setVisible(visible);
    // After hiding individual rows respect the report's row count on
    // the next show.
    if (visible && this.lastReport !== null) {
      const rows = buildDivergenceRows(this.lastReport, this.options.maxRows);
      this.applyRows(rows);
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Tear down all Phaser children. Call from the scene's `shutdown`
   * hook. Idempotent — a stray late call after destroy is a no-op.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.background.destroy();
    for (const t of this.bannerTexts) t.destroy();
    for (const t of this.rowLabelTexts) t.destroy();
    for (const t of this.rowDiffTexts) t.destroy();
    this.continueButton.destroy();
    this.haltButton.destroy();
  }

  /**
   * Convenience helper that wires an overlay to a controller — auto-
   * updates the report on every `ingest`/state change *and* dispatches
   * the overlay's continue/halt buttons through the controller.
   *
   * The controller is *not* polled — the caller still has to invoke
   * `overlay.update(controller.getReport())` once per render frame.
   * What this helper provides is the button → controller wiring; the
   * overlay never reads the controller's mutable state on its own.
   */
  static withController(
    scene: Phaser.Scene | DesyncReportOverlaySceneShim,
    controller: DesyncRecoveryController,
    options: DesyncReportOverlayOptions = {},
  ): DesyncReportOverlay {
    const overlay = new DesyncReportOverlay(
      scene,
      {
        onContinue: () => {
          // If we're halted, "continue" relaxes the policy so the
          // caller's surrounding loop can re-enter playback.
          if (controller.isHalted()) {
            controller.setTolerance({ kind: 'continue' });
            controller.reset();
          } else {
            overlay.setVisible(false);
          }
        },
        onHalt: () => {
          controller.halt('manual halt from desync overlay');
        },
      },
      options,
    );
    return overlay;
  }

  // -------------------------------------------------------------------------
  // Test-facing accessors
  // -------------------------------------------------------------------------

  /** Banner line 0 (verdict). Used by the test suite. */
  getBannerLine(index: number): string {
    const t = this.bannerTexts[index];
    return t === undefined ? '' : t.text;
  }

  /** Number of currently-visible divergence rows. Used by the test suite. */
  getVisibleRowCount(): number {
    let n = 0;
    for (const t of this.rowLabelTexts) {
      if (t.visible === true) n += 1;
    }
    return n;
  }

  /** Read-only snapshot of every banner line text. */
  getBannerSnapshot(): ReadonlyArray<string> {
    return Object.freeze(this.bannerTexts.map((t) => t.text));
  }

  /** Read-only snapshot of every visible divergence row pair. */
  getRowSnapshot(): ReadonlyArray<{ readonly label: string; readonly diff: string }> {
    const out: Array<{ label: string; diff: string }> = [];
    for (let i = 0; i < this.rowLabelTexts.length; i += 1) {
      const label = this.rowLabelTexts[i];
      const diff = this.rowDiffTexts[i];
      if (label === undefined || diff === undefined) continue;
      if (label.visible === true) {
        out.push({ label: label.text, diff: diff.text });
      }
    }
    return Object.freeze(out.map((p) => Object.freeze(p)));
  }

  /** The report most recently fed to `update()`, or null. */
  getLastReport(): DesyncReport | null {
    return this.lastReport;
  }

  // -------------------------------------------------------------------------
  // Internal layout / row painting
  // -------------------------------------------------------------------------

  private applyRows(rows: ReadonlyArray<DivergenceRow>): void {
    const cap = this.rowLabelTexts.length;
    for (let i = 0; i < cap; i += 1) {
      const label = this.rowLabelTexts[i];
      const diff = this.rowDiffTexts[i];
      if (label === undefined || diff === undefined) continue;
      const row = rows[i];
      if (row === undefined) {
        label.setText('').setVisible(false);
        diff.setText('').setVisible(false);
      } else {
        label.setText(row.label).setVisible(this.visible);
        diff.setText(row.diff).setVisible(this.visible);
      }
    }
  }

  private applyButtonText(continueLabel: string, color: string): void {
    this.continueButton.setText(`[ ${continueLabel} ]`);
    this.continueButton.setColor(color);
    this.haltButton.setText('[ Halt ]');
    this.haltButton.setColor(COLOR_BUTTON_HALT);
  }

  private computeHeight(maxRows: number): number {
    const { padding, bannerLineHeight, rowLineHeight, diffLineHeight } =
      this.options;
    return (
      padding * 2 +
      BANNER_LINE_COUNT * bannerLineHeight +
      8 +
      maxRows * (rowLineHeight + diffLineHeight) +
      32 // button row
    );
  }
}
