/**
 * Drag-ghost preview renderer — AC 20101 Sub-AC 1.
 *
 * Companion Phaser host for {@link DragDropController}. The controller
 * owns the pure state machine (`(pointer, catalog rects, grid spec) →
 * ghost / placed piece`); this component owns the *visual* — the
 * translucent piece-shaped rectangle the player sees while dragging,
 * tinted by the catalog piece's accent colour, with a footprint that
 * matches the piece's authored size, snapped to the grid as the cursor
 * moves over the canvas.
 *
 * What the ghost paints
 * ---------------------
 *
 *   1. **Snap rectangle** — a translucent fill + accent-coloured stroke
 *      anchored at the snapped top-left corner the controller computed.
 *      The colour matches the catalog piece's `accentColor`. Tinted red
 *      when the snapped footprint would clip the canvas bounds, so the
 *      player gets immediate "you can't drop here" feedback before
 *      committing.
 *   2. **Cursor follower** — a small dot painted at the raw pointer
 *      position (no snapping). Communicates "I am carrying a piece"
 *      even when the cursor leaves the canvas grid (e.g. dragging back
 *      towards the catalog to cancel) — without this the ghost would
 *      vanish entirely whenever the snap is `null`, which feels broken.
 *
 * Visibility states
 * -----------------
 *
 *   • Idle (no drag): every visual is hidden. The component allocates
 *     its GameObjects up-front so the per-frame update never allocates,
 *     and toggles them with `setVisible(false)`.
 *   • Dragging over the canvas: snap rectangle visible at the snap
 *     target; cursor follower visible at the raw pointer.
 *   • Dragging over the catalog (or off-canvas): snap rectangle hidden
 *     (no valid snap target); cursor follower still visible so the
 *     player can SEE the carry sprite in transit.
 *
 * Why a discrete component
 * ------------------------
 *
 *   • Per the project's `code_architecture` principle, scenes stay thin
 *     — lifecycle wiring + input forwarding only. Pulling the ghost
 *     into its own module gives the unit suite a stable seam: tests
 *     drive the component with a structurally-typed scene shim and
 *     assert the right GameObjects are created / repositioned without
 *     booting Phaser.
 *
 *   • Future sub-ACs (placement preview, deletion brush, undo cue) can
 *     mount additional overlays at the same depth tier without each
 *     having to reinvent the show/hide + position update plumbing.
 *
 * Determinism note: the component is render-only. It paints from a
 * `DragGhostState` snapshot computed by the controller — no
 * `Math.random()`, no wall-clock reads. A recorded replay re-derives
 * the same overlay positions byte-identically.
 */

import type Phaser from 'phaser';
import type { CatalogPiece } from './catalogPieces';
import type { DragGhostState, SnapTarget } from './dragDrop';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Cosmetic / layout tuning. */
export interface GhostPreviewOptions {
  /** Render depth — must beat the canvas-area + catalog tiers. Default 60. */
  readonly depth?: number;
}

/**
 * Public visual state — exposed for tests and future overlays so they
 * can read the ghost's last-applied state without poking private
 * Phaser objects.
 */
export interface GhostPreviewVisualState {
  readonly visible: boolean;
  readonly piece: CatalogPiece | null;
  readonly snap: SnapTarget | null;
  readonly pointerX: number;
  readonly pointerY: number;
}

// ---------------------------------------------------------------------------
// Visual constants — exported so the wiring contract test can verify the
// component paints in the canonical palette.
// ---------------------------------------------------------------------------

/**
 * Palette for the drag ghost. Hex literals (no `#`) so they pass
 * straight into Phaser's `lineStyle` / `Rectangle` ctors.
 *
 * AC 20103 Sub-AC 3 introduces *per-reason* invalid-drop tints so the
 * player gets a recognisable visual cue per rule — out-of-bounds is
 * still red (the original Sub-AC 1 visual), overlap is magenta (clear
 * "you'd stack two pieces" signal), and hazard-near-spawn is amber
 * (warning-yellow, "this would hurt at runtime").
 */
export const GHOST_PREVIEW_COLORS = Object.freeze({
  /**
   * Default border tint when the ghost is in-bounds — pulled from the
   * catalog piece's `accentColor` at paint time. Falls back to this
   * neutral warm tone if a piece is missing an accent (defensive).
   */
  defaultBorder: 0xffd166,
  /**
   * Stroke + fill tint when the snapped footprint would clip the
   * canvas bounds. Bright enough to read against the dark builder
   * background, distinct from the in-bounds tints so the player gets
   * immediate "drop rejected" feedback before they commit.
   */
  outOfBoundsBorder: 0xff5a3c,
  outOfBoundsFill: 0xff5a3c,
  /**
   * Tint used when the snapped footprint overlaps an existing piece
   * (AC 20103 Sub-AC 3). Magenta picks a hue distinct from both the
   * out-of-bounds red and the hazard-near-spawn amber so the player
   * can read the reason at a glance from the colour alone.
   */
  overlapBorder: 0xff3cc6,
  overlapFill: 0xff3cc6,
  /**
   * Tint for the hazard-near-spawn rule (AC 20103 Sub-AC 3). Amber
   * doubles as "warning, this piece would hurt at runtime" — the same
   * hue family used by the `moving-platform` accent so the rule's
   * visual language ties back to the offending category.
   */
  hazardWarningBorder: 0xffae3c,
  hazardWarningFill: 0xffae3c,
  /** Cursor-follower dot tint. Same warm yellow as the snap-cursor crosshair. */
  cursorDot: 0xffd166,
});

/** Translucency for the in-bounds ghost fill. */
const GHOST_FILL_ALPHA = 0.28;
/**
 * Translucency for invalid-drop ghost fills (out-of-bounds, overlap,
 * hazard-near-spawn). Slightly higher than the in-bounds alpha so the
 * tint reads as "warning" at a glance rather than blending into the
 * underlying piece on overlap rejections.
 */
const OUT_OF_BOUNDS_FILL_ALPHA = 0.42;
/** Stroke width for the ghost rectangle (design pixels). */
const GHOST_STROKE_WIDTH = 2;
/** Cursor-follower dot radius (design pixels). */
const CURSOR_DOT_RADIUS = 6;

/**
 * Default depth — sits above the catalog panel (`STAGE_BUILDER_DEPTHS.catalog
 * = 50`) so the ghost reads on top of the panel chrome while the
 * pointer transits between catalog and canvas, but below scene chrome
 * (`STAGE_BUILDER_DEPTHS.chrome = 100`) so future modal dialogs paint
 * over it.
 */
const DEFAULT_DEPTH = 60;

// ---------------------------------------------------------------------------
// Scene-shape shim — same pattern CatalogPanel / CanvasArea use so the
// unit suite drives the component without booting Phaser.
// ---------------------------------------------------------------------------

interface GhostRectangleLike {
  setOrigin(x: number, y?: number): GhostRectangleLike;
  setScrollFactor(x: number, y?: number): GhostRectangleLike;
  setDepth(depth: number): GhostRectangleLike;
  setStrokeStyle(width: number, color: number, alpha?: number): GhostRectangleLike;
  setFillStyle(color: number, alpha?: number): GhostRectangleLike;
  setVisible(visible: boolean): GhostRectangleLike;
  setPosition(x: number, y: number): GhostRectangleLike;
  setSize(width: number, height: number): GhostRectangleLike;
  destroy(): void;
}

interface GhostGraphicsLike {
  setScrollFactor(x: number, y?: number): GhostGraphicsLike;
  setDepth(depth: number): GhostGraphicsLike;
  setVisible(visible: boolean): GhostGraphicsLike;
  setPosition(x: number, y: number): GhostGraphicsLike;
  fillStyle(color: number, alpha?: number): GhostGraphicsLike;
  fillCircle(x: number, y: number, radius: number): GhostGraphicsLike;
  clear(): GhostGraphicsLike;
  destroy(): void;
}

interface GhostSceneLike {
  add: {
    rectangle(
      x: number,
      y: number,
      width: number,
      height: number,
      color: number,
      alpha?: number,
    ): GhostRectangleLike;
    graphics(): GhostGraphicsLike;
  };
}

// ---------------------------------------------------------------------------
// GhostPreview
// ---------------------------------------------------------------------------

/**
 * Phaser host for the drag ghost. Allocate once during `create()`; feed
 * it the controller's `DragGhostState` snapshot from every pointer-move
 * (or call `clear()` when the controller transitions back to idle).
 *
 * Lifecycle:
 *
 *   const ghost = new GhostPreview(scene);
 *   const dnd = new DragDropController({ ... });
 *   scene.input.on('pointermove', (p) => {
 *     dnd.pointerMove(p.x, p.y);
 *     ghost.update(dnd.getGhostState());
 *   });
 *   scene.input.on('pointerup', () => {
 *     dnd.pointerUp(p.x, p.y);
 *     ghost.clear();
 *   });
 *   // ... later:
 *   ghost.destroy();
 */
export class GhostPreview {
  private readonly scene: GhostSceneLike;
  private readonly depth: number;

  /** Pre-allocated translucent rectangle painted at the snap target. */
  private snapRect: GhostRectangleLike | null = null;

  /** Pre-allocated graphics object painted at the raw cursor position. */
  private cursorDot: GhostGraphicsLike | null = null;

  /** Latest visual state — exposed to tests via `getVisualState()`. */
  private state: GhostPreviewVisualState = {
    visible: false,
    piece: null,
    snap: null,
    pointerX: 0,
    pointerY: 0,
  };

  private destroyed = false;

  constructor(
    scene: Phaser.Scene | GhostSceneLike,
    options: GhostPreviewOptions = {},
  ) {
    this.scene = scene as unknown as GhostSceneLike;
    this.depth = options.depth ?? DEFAULT_DEPTH;
    this.allocate();
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  /**
   * Read-only snapshot of the ghost's last-applied visual state. Tests
   * and future overlays consume this to verify the ghost is showing
   * the expected piece / position without poking private fields.
   */
  getVisualState(): GhostPreviewVisualState {
    return this.state;
  }

  /** `true` when the ghost is currently rendering anything visible. */
  isVisible(): boolean {
    return this.state.visible;
  }

  /**
   * Drive the ghost from the controller's `DragGhostState` snapshot.
   * Pass `null` (or call {@link clear}) when the controller transitions
   * back to idle.
   *
   * Idempotent on identical inputs — every per-frame update path that
   * forwards the same snapshot twice does no extra paint work.
   */
  update(ghost: DragGhostState | null): void {
    if (this.destroyed) return;
    if (!ghost) {
      this.clear();
      return;
    }
    this.applyVisuals(ghost);
  }

  /**
   * Hide every overlay. Idempotent — calling `clear()` on an already-
   * hidden ghost is a no-op (no paint cost, no allocations).
   */
  clear(): void {
    if (this.destroyed) return;
    if (!this.state.visible && this.state.piece === null) return;
    this.snapRect?.setVisible(false);
    this.cursorDot?.setVisible(false);
    this.cursorDot?.clear();
    this.state = {
      visible: false,
      piece: null,
      snap: null,
      pointerX: 0,
      pointerY: 0,
    };
  }

  /** Tear down every Phaser GameObject the ghost owns. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.snapRect?.destroy();
    this.cursorDot?.destroy();
    this.snapRect = null;
    this.cursorDot = null;
    this.state = {
      visible: false,
      piece: null,
      snap: null,
      pointerX: 0,
      pointerY: 0,
    };
  }

  // -------------------------------------------------------------------------
  // Internal — rendering
  // -------------------------------------------------------------------------

  /**
   * One-shot allocation — the snap rectangle and cursor-dot graphics
   * exist for the entire lifetime of the host. Per-frame updates only
   * mutate `position` / `visible` / `fillStyle`, so the ghost never
   * allocates on the hot path (per the Seed's 60-FPS performance
   * principle).
   */
  private allocate(): void {
    // procedural fallback — drag-ghost preview rendered via
    // `Phaser.GameObjects.Rectangle` + `Graphics` primitives (no sprite
    // frames). The ghost is editor chrome that mirrors the catalog accent
    // colours; intentionally procedural — replace only if a future skin
    // ships textured drag previews.
    const rect = this.scene.add
      .rectangle(0, 0, 1, 1, GHOST_PREVIEW_COLORS.defaultBorder, GHOST_FILL_ALPHA)
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setDepth(this.depth)
      .setStrokeStyle(GHOST_STROKE_WIDTH, GHOST_PREVIEW_COLORS.defaultBorder, 1)
      .setVisible(false);
    this.snapRect = rect;

    const dot = this.scene.add
      .graphics()
      .setScrollFactor(0, 0)
      .setDepth(this.depth + 1)
      .setVisible(false);
    this.cursorDot = dot;
  }

  private applyVisuals(ghost: DragGhostState): void {
    const { piece, snap, pointerX, pointerY } = ghost;
    const accent = piece.accentColor;

    // ---- Snap rectangle -------------------------------------------------
    if (this.snapRect) {
      if (snap) {
        // AC 20103 Sub-AC 3 — pick the per-reason invalid-drop palette.
        // The unified `valid` flag covers bounds + overlap + hazard
        // rules, so a single branch chooses between "use accent" and
        // "use rejection palette" without re-running the rules here.
        const palette = pickInvalidPalette(snap);
        const useAccent = snap.valid && palette === null;
        const fillColor = useAccent ? accent : palette!.fill;
        const fillAlpha = useAccent ? GHOST_FILL_ALPHA : OUT_OF_BOUNDS_FILL_ALPHA;
        const strokeColor = useAccent ? accent : palette!.border;

        this.snapRect
          .setPosition(snap.viewportX, snap.viewportY)
          .setSize(snap.width, snap.height)
          .setFillStyle(fillColor, fillAlpha)
          .setStrokeStyle(GHOST_STROKE_WIDTH, strokeColor, 1)
          .setVisible(true);
      } else {
        // Pointer is over the catalog (or otherwise off-canvas) — no
        // valid snap target. Hide the rectangle but keep the cursor dot
        // so the player can still see the "carry" feedback.
        this.snapRect.setVisible(false);
      }
    }

    // ---- Cursor follower dot --------------------------------------------
    if (this.cursorDot) {
      this.cursorDot.clear();
      this.cursorDot.fillStyle(GHOST_PREVIEW_COLORS.cursorDot, 1);
      this.cursorDot.fillCircle(pointerX, pointerY, CURSOR_DOT_RADIUS);
      this.cursorDot.setVisible(true);
    }

    this.state = {
      visible: true,
      piece,
      snap,
      pointerX,
      pointerY,
    };
  }
}

/**
 * Pick the per-reason rejection palette for a snap target. Returns
 * `null` when the snap is valid (the renderer paints with the catalog
 * accent in that case).
 *
 * Reason → palette mapping:
 *
 *   • `out-of-bounds`     → red (the original Sub-AC 1 visual).
 *   • `overlap`           → magenta (clear "pieces would stack" cue).
 *   • `hazard-near-spawn` → amber (warning-yellow "this hurts at runtime").
 *   • Everything else (invalid type / geometry, plus the conservative
 *     fallback for an `inBounds === false` snap whose validation
 *     doesn't carry a reason) collapses to the out-of-bounds palette
 *     so the player still sees an invalid-drop signal.
 */
function pickInvalidPalette(
  snap: SnapTarget,
): { fill: number; border: number } | null {
  if (snap.valid) return null;
  switch (snap.invalidReason) {
    case 'overlap':
      return {
        fill: GHOST_PREVIEW_COLORS.overlapFill,
        border: GHOST_PREVIEW_COLORS.overlapBorder,
      };
    case 'hazard-near-spawn':
      return {
        fill: GHOST_PREVIEW_COLORS.hazardWarningFill,
        border: GHOST_PREVIEW_COLORS.hazardWarningBorder,
      };
    case 'out-of-bounds':
    case 'invalid-type':
    case 'invalid-geometry':
    default:
      return {
        fill: GHOST_PREVIEW_COLORS.outOfBoundsFill,
        border: GHOST_PREVIEW_COLORS.outOfBoundsBorder,
      };
  }
}
