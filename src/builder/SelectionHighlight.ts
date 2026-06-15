/**
 * Selection-highlight painter for the M3 stage builder.
 *
 * Companion Phaser host for `./pieceSelection.ts`. The pure module
 * owns the selection state machine (hit-test, select, clear,
 * reconcile); this component owns the *visual* — a bright outline
 * around the selected piece plus a small floating `[DEL] remove` hint
 * so the delete affordance is discoverable.
 *
 * Lifecycle
 * ---------
 *
 *   1. The scene constructs the highlight once during `create()`,
 *      passing the canvas-area origin in viewport pixels. The outline
 *      rectangle + hint text are pre-allocated hidden, so updates
 *      never allocate.
 *   2. On every selection change (and every data-model mutation, since
 *      a delete / undo can invalidate the selection) the scene calls
 *      {@link update} with the resolved piece — or `null` to hide.
 *   3. On scene shutdown {@link destroy} releases both GameObjects.
 *
 * The host accepts a structurally-typed scene (the same trick
 * `PlacedPieceRenderer.ts` / `CatalogPanel.ts` use) so unit tests can
 * assert paint behaviour against in-memory stubs without booting
 * Phaser.
 *
 * Determinism note: the highlight is a pure projection of `(selected
 * piece, canvas origin)` onto two GameObjects. No `Math.random()`, no
 * wall-clock reads.
 */

import type Phaser from 'phaser';
import { SELECTION_HINT_TEXT, type SelectablePiece } from './pieceSelection';

// ---------------------------------------------------------------------------
// Public options + visual constants
// ---------------------------------------------------------------------------

/** Construction options for {@link SelectionHighlight}. */
export interface SelectionHighlightOptions {
  /** Render depth — sits above placed pieces, below the catalog panel. */
  readonly depth?: number;
  /**
   * Canvas origin in viewport pixels. Selected pieces are stored in
   * canvas-relative coordinates; the painter translates to viewport
   * space at paint time using this origin.
   */
  readonly canvasOriginX: number;
  /** See {@link canvasOriginX}. */
  readonly canvasOriginY: number;
}

/**
 * Palette for the selection visuals. The outline reuses the builder's
 * origin-marker gold (`0xffd166`) so "selected" reads as part of the
 * editor chrome rather than another placed piece.
 */
export const SELECTION_HIGHLIGHT_COLORS = Object.freeze({
  outline: 0xffd166,
  hintText: 0xffd166,
});

/** Outline stroke width in design pixels. */
export const SELECTION_OUTLINE_STROKE_PX = 2;

/**
 * Outset between the piece bounds and the outline, in design pixels.
 * The outline straddles the piece's own 2-px border instead of
 * painting over it, so the piece's accent colour stays legible while
 * selected.
 */
export const SELECTION_OUTLINE_PAD_PX = 2;

/** Gap between the piece bounds and the floating hint, in design pixels. */
export const SELECTION_HINT_GAP_PX = 6;

/**
 * Pieces whose top edge sits within this many canvas-relative pixels
 * of the canvas top get the hint painted *below* them instead of
 * above, so the hint never floats off the playable surface.
 */
export const SELECTION_HINT_FLIP_THRESHOLD_PX = 24;

/**
 * Default depth — above the placed-piece layer
 * (`STAGE_BUILDER_DEPTHS.placedPiece = 35`) so the outline reads over
 * the piece it wraps, below the catalog (`50`) so panel chrome still
 * occludes a selection near the canvas's left edge.
 */
const DEFAULT_DEPTH = 40;

// ---------------------------------------------------------------------------
// Pure layout helper — exported so the unit suite can drive the flip
// branch without constructing the painter.
// ---------------------------------------------------------------------------

/**
 * Where the floating hint anchors relative to the selected piece.
 * `above` is the default; pieces close to the canvas top flip to
 * `below` so the hint stays on the canvas surface.
 */
export function selectionHintAnchor(canvasY: number): 'above' | 'below' {
  return Number.isFinite(canvasY) && canvasY >= SELECTION_HINT_FLIP_THRESHOLD_PX
    ? 'above'
    : 'below';
}

// ---------------------------------------------------------------------------
// Scene-shape shim — same pattern PlacedPieceRenderer / CatalogPanel use
// so the unit suite drives the component without booting Phaser.
// ---------------------------------------------------------------------------

interface HighlightRectangleLike {
  setOrigin(x: number, y?: number): HighlightRectangleLike;
  setScrollFactor(x: number, y?: number): HighlightRectangleLike;
  setDepth(depth: number): HighlightRectangleLike;
  setStrokeStyle(width: number, color: number, alpha?: number): HighlightRectangleLike;
  setFillStyle(color: number, alpha?: number): HighlightRectangleLike;
  setVisible(visible: boolean): HighlightRectangleLike;
  setPosition(x: number, y: number): HighlightRectangleLike;
  setSize(width: number, height: number): HighlightRectangleLike;
  destroy(): void;
}

interface HighlightTextLike {
  setOrigin(x: number, y?: number): HighlightTextLike;
  setScrollFactor(x: number, y?: number): HighlightTextLike;
  setDepth(depth: number): HighlightTextLike;
  setVisible(visible: boolean): HighlightTextLike;
  setPosition(x: number, y: number): HighlightTextLike;
  destroy(): void;
}

interface HighlightSceneLike {
  add: {
    rectangle(
      x: number,
      y: number,
      width: number,
      height: number,
      color: number,
      alpha?: number,
    ): HighlightRectangleLike;
    text(
      x: number,
      y: number,
      content: string,
      style: Record<string, unknown>,
    ): HighlightTextLike;
  };
}

/**
 * Read-only snapshot of the painter's visual state. Tests + future
 * overlays consume this to verify the highlight without poking the
 * private GameObject handles.
 */
export interface SelectionHighlightVisualState {
  readonly visible: boolean;
  readonly pieceId: string | null;
  readonly outlineX: number;
  readonly outlineY: number;
  readonly outlineWidth: number;
  readonly outlineHeight: number;
  readonly hintX: number;
  readonly hintY: number;
  readonly hintAnchor: 'above' | 'below';
}

// ---------------------------------------------------------------------------
// SelectionHighlight
// ---------------------------------------------------------------------------

/**
 * Phaser host that paints the selected-piece outline + delete hint.
 * Allocation-free after construction: both GameObjects are created
 * hidden up front and repositioned / toggled on every update.
 *
 *     const highlight = new SelectionHighlight(scene, {
 *       canvasOriginX: 320,
 *       canvasOriginY: 80,
 *     });
 *     highlight.update(selectedPieceOrNull);
 *     // ...later:
 *     highlight.destroy();
 */
export class SelectionHighlight {
  private readonly outline: HighlightRectangleLike;
  private readonly hint: HighlightTextLike;
  private readonly canvasOriginX: number;
  private readonly canvasOriginY: number;
  private visual: SelectionHighlightVisualState = HIDDEN_VISUAL;
  private destroyed = false;

  constructor(
    scene: Phaser.Scene | HighlightSceneLike,
    options: SelectionHighlightOptions,
  ) {
    const host = scene as unknown as HighlightSceneLike;
    const depth = options.depth ?? DEFAULT_DEPTH;
    this.canvasOriginX = options.canvasOriginX;
    this.canvasOriginY = options.canvasOriginY;

    // procedural fallback — selection chrome drawn as a stroke-only
    // `Phaser.GameObjects.Rectangle` + monospace `Text`. Editor chrome
    // is intentionally procedural; replace only if a textured editor
    // skin ships.
    this.outline = host.add
      .rectangle(0, 0, 1, 1, SELECTION_HIGHLIGHT_COLORS.outline, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setDepth(depth)
      .setFillStyle(SELECTION_HIGHLIGHT_COLORS.outline, 0)
      .setStrokeStyle(
        SELECTION_OUTLINE_STROKE_PX,
        SELECTION_HIGHLIGHT_COLORS.outline,
        1,
      )
      .setVisible(false);

    this.hint = host.add
      .text(0, 0, SELECTION_HINT_TEXT, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: hexColorString(SELECTION_HIGHLIGHT_COLORS.hintText),
      })
      .setOrigin(0, 1)
      .setScrollFactor(0, 0)
      .setDepth(depth + 1)
      .setVisible(false);
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  /**
   * Paint the highlight around `piece`, or hide everything when the
   * selection is empty (`null`). Idempotent — re-painting the same
   * piece just re-applies the same coordinates.
   */
  update(piece: SelectablePiece | null): void {
    if (this.destroyed) return;
    if (!piece) {
      this.outline.setVisible(false);
      this.hint.setVisible(false);
      this.visual = HIDDEN_VISUAL;
      return;
    }

    const vx = piece.canvasX + this.canvasOriginX;
    const vy = piece.canvasY + this.canvasOriginY;
    const outlineX = vx - SELECTION_OUTLINE_PAD_PX;
    const outlineY = vy - SELECTION_OUTLINE_PAD_PX;
    const outlineWidth = piece.width + SELECTION_OUTLINE_PAD_PX * 2;
    const outlineHeight = piece.height + SELECTION_OUTLINE_PAD_PX * 2;

    // Hint floats above the piece by default; pieces hugging the
    // canvas top flip it below so the text never leaves the surface.
    const anchor = selectionHintAnchor(piece.canvasY);
    const hintX = outlineX;
    const hintY =
      anchor === 'above'
        ? outlineY - SELECTION_HINT_GAP_PX
        : outlineY + outlineHeight + SELECTION_HINT_GAP_PX;

    this.outline
      .setPosition(outlineX, outlineY)
      .setSize(outlineWidth, outlineHeight)
      .setVisible(true);
    this.hint
      .setOrigin(0, anchor === 'above' ? 1 : 0)
      .setPosition(hintX, hintY)
      .setVisible(true);

    this.visual = Object.freeze({
      visible: true,
      pieceId: piece.id,
      outlineX,
      outlineY,
      outlineWidth,
      outlineHeight,
      hintX,
      hintY,
      hintAnchor: anchor,
    });
  }

  /** Hide the highlight. Equivalent to `update(null)`. */
  clear(): void {
    this.update(null);
  }

  /** Read-only snapshot of the current visual state. */
  getVisualState(): SelectionHighlightVisualState {
    return this.visual;
  }

  /** Tear down both GameObjects. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.outline.destroy();
    this.hint.destroy();
    this.visual = HIDDEN_VISUAL;
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Shared frozen "nothing selected" visual snapshot. */
const HIDDEN_VISUAL: SelectionHighlightVisualState = Object.freeze({
  visible: false,
  pieceId: null,
  outlineX: 0,
  outlineY: 0,
  outlineWidth: 0,
  outlineHeight: 0,
  hintX: 0,
  hintY: 0,
  hintAnchor: 'above',
});

/** `0xffd166` → `'#ffd166'` for Phaser text styles. */
function hexColorString(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
