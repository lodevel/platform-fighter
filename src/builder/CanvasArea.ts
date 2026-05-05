/**
 * Stage-builder canvas area — AC 20003 Sub-AC 3.
 *
 * This component owns the *grid-based canvas area* — the rectangle the
 * player drops pieces onto. It paints, in render order:
 *
 *   1. **Canvas surface** — a flat fill the grid + pieces sit on so
 *      the canvas reads as a discrete "play space" against the builder
 *      background.
 *   2. **Visible grid lines** — minor + major cohorts batched into two
 *      `Graphics` objects (one `lineStyle` per cohort) so the renderer
 *      issues the minimum number of GPU draw calls. Geometry from
 *      {@link enumerateGridLines}.
 *   3. **Bounds frames** — the active-canvas frame, a 1-px shadow drop
 *      under it, and (when the active canvas is smaller than the 2×
 *      cap) a dim outline marking the maximum permitted size. Geometry
 *      from {@link enumerateBoundsRects}.
 *   4. **Coordinate-system marks** — origin label, axis arrows, numeric
 *      ticks at every major line. Geometry from
 *      {@link enumerateCoordinateMarks}.
 *   5. **Snap-cursor overlay** — a translucent cell highlight + a
 *      crosshair at the snapped grid intersection that follows the
 *      pointer while it's over the canvas. Updated by
 *      {@link updateSnapCursor}; hidden via {@link hideSnapCursor}.
 *
 * Why a discrete component
 * ------------------------
 *
 * AC 20001 Sub-AC 1 (the scene skeleton) drew the grid inline. As the
 * builder grows (drag/drop ghosts, undo/redo, theme toggles, save/load
 * dialogs, pan/zoom) the scene file would balloon if every layer kept
 * threading itself into `create()`. Pulling the canvas area into its
 * own component:
 *
 *   • Concentrates the render path: one `populate()` call rebuilds
 *     every visual the canvas owns. Future resize / undo / theme
 *     paths call the same entry point — there is exactly one place
 *     that knows how the canvas paints.
 *
 *   • Gives the unit suite a stable seam: tests can construct a stub
 *     scene and assert the component issued the expected `Graphics`
 *     /`Rectangle`/`Text` calls without booting Phaser.
 *
 *   • Keeps the scene file thin — per the project's
 *     `code_architecture` evaluation principle, scenes own lifecycle
 *     wiring + transitions only; rendering belongs in modules.
 *
 * Determinism note: the component is render-only and reads no
 * `Math.random()` / wall-clock values. The snap cursor is driven by
 * deterministic pointer events — a recorded replay re-derives the
 * exact same overlay positions byte-identically.
 */

import type Phaser from 'phaser';
import {
  DEFAULT_GRID_SPEC,
  enumerateCoordinateMarks,
  enumerateGridLines,
  type CoordinateMark,
  type GridLine,
  type GridSpec,
} from './builderGrid';
import {
  CANVAS_BOUNDS_COLORS,
  CANVAS_BOUNDS_STROKES,
  buildCanvasAreaSpec,
  computeSnapCursor,
  enumerateBoundsRects,
  type BoundsRect,
  type CanvasAreaSpec,
  type SnapCursorState,
} from './canvasBounds';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-layer opt-in flags so a host that already paints (say) the grid
 * surface inline can re-use the component for just the snap-cursor +
 * bounds enhancement without double-painting. Defaults to all layers
 * enabled — pass an explicit `false` to skip a layer.
 *
 * The five layers map 1:1 onto the rendering responsibilities listed
 * in this file's header doc.
 */
export interface CanvasAreaLayerFlags {
  readonly surface?: boolean;
  readonly gridLines?: boolean;
  readonly bounds?: boolean;
  readonly coordinateMarks?: boolean;
  readonly snapCursor?: boolean;
}

/** Cosmetic / layout tuning. */
export interface CanvasAreaOptions {
  /** Render depth for the canvas surface. Grid + bounds layer above it. Default 10. */
  readonly depth?: number;
  /** Grid spec to render. Defaults to {@link DEFAULT_GRID_SPEC}. */
  readonly gridSpec?: GridSpec;
  /** Canvas top-left in viewport pixels. Defaults to (0, 0). */
  readonly originX?: number;
  /** Canvas top-left in viewport pixels. Defaults to (0, 0). */
  readonly originY?: number;
  /**
   * Per-layer rendering opt-in. Omitting the field paints every layer
   * (the standalone path); passing `{ surface: false, ... }` lets a
   * host that already draws certain layers inline reuse the component
   * for only the missing pieces.
   */
  readonly layers?: CanvasAreaLayerFlags;
}

/**
 * Visual constants — exported so the wiring contract test can verify
 * the canvas paints in the canonical palette + the depth ladder lines
 * up with the rest of the builder chrome.
 */
export const CANVAS_AREA_COLORS = Object.freeze({
  /** Canvas surface fill — a touch lighter than the builder background. */
  surface: 0x141a2c,
  /** Minor grid line stroke. */
  gridMinor: 0x1f2640,
  /** Major grid line stroke (every Nth line). */
  gridMajor: 0x39456b,
  /** Snap-cursor cell highlight fill. Translucent at paint time. */
  snapCellFill: 0x6cf0c2,
  /** Snap-cursor crosshair stroke at the snapped grid intersection. */
  snapCrosshair: 0xffd166,
  /** Origin label colour. */
  originLabel: 0xffd166,
  /** Numeric tick label colour. */
  tickLabel: 0x888899,
  /** Axis-arrow label colour. */
  axisLabel: 0x6cf0c2,
});

export const CANVAS_AREA_STROKES = Object.freeze({
  minor: 1,
  major: 2,
  crosshair: 2,
});

/** Default depth — sits above the scene background, below the catalog panel. */
const DEFAULT_DEPTH = 10;

/** Snap-cell highlight alpha. */
const SNAP_CELL_ALPHA = 0.18;
/** Snap-crosshair alpha. */
const SNAP_CROSSHAIR_ALPHA = 0.85;
/** Crosshair arm length (design pixels). */
const SNAP_CROSSHAIR_ARM = 12;

// ---------------------------------------------------------------------------
// Scene-shape shim — same pattern CatalogPanel uses so the unit suite
// can drive the component without booting Phaser.
// ---------------------------------------------------------------------------

interface CanvasTextLike {
  setOrigin(x: number, y?: number): CanvasTextLike;
  setScrollFactor(x: number, y?: number): CanvasTextLike;
  setDepth(depth: number): CanvasTextLike;
  setVisible(visible: boolean): CanvasTextLike;
  setPosition(x: number, y: number): CanvasTextLike;
  destroy(): void;
}

interface CanvasRectangleLike {
  setOrigin(x: number, y?: number): CanvasRectangleLike;
  setScrollFactor(x: number, y?: number): CanvasRectangleLike;
  setDepth(depth: number): CanvasRectangleLike;
  setStrokeStyle(width: number, color: number, alpha?: number): CanvasRectangleLike;
  setVisible(visible: boolean): CanvasRectangleLike;
  setPosition(x: number, y: number): CanvasRectangleLike;
  setSize(width: number, height: number): CanvasRectangleLike;
  setFillStyle(color: number, alpha?: number): CanvasRectangleLike;
  destroy(): void;
}

interface CanvasGraphicsLike {
  setScrollFactor(x: number, y?: number): CanvasGraphicsLike;
  setDepth(depth: number): CanvasGraphicsLike;
  setVisible(visible: boolean): CanvasGraphicsLike;
  setPosition(x: number, y: number): CanvasGraphicsLike;
  fillStyle(color: number, alpha?: number): CanvasGraphicsLike;
  lineStyle(width: number, color: number, alpha?: number): CanvasGraphicsLike;
  fillRect(x: number, y: number, w: number, h: number): CanvasGraphicsLike;
  strokeRect(x: number, y: number, w: number, h: number): CanvasGraphicsLike;
  lineBetween(x1: number, y1: number, x2: number, y2: number): CanvasGraphicsLike;
  clear(): CanvasGraphicsLike;
  destroy(): void;
}

interface CanvasSceneLike {
  add: {
    rectangle(
      x: number,
      y: number,
      width: number,
      height: number,
      color: number,
      alpha?: number,
    ): CanvasRectangleLike;
    text(
      x: number,
      y: number,
      content: string,
      style: Record<string, unknown>,
    ): CanvasTextLike;
    graphics(): CanvasGraphicsLike;
  };
}

// ---------------------------------------------------------------------------
// CanvasArea
// ---------------------------------------------------------------------------

/**
 * Grid-based canvas area for the stage builder. Construct once during
 * the scene's `create()`; call `updateSnapCursor` from pointer-move
 * handlers; call `destroy()` from the scene's SHUTDOWN/DESTROY hooks.
 *
 * The component re-renders its full visual stack via {@link populate}
 * whenever the spec changes (resize, theme switch, etc.). Snap-cursor
 * overlays live in their own pre-allocated GameObjects so the per-
 * frame update path doesn't allocate.
 *
 * Lifecycle:
 *
 *   const area = new CanvasArea(scene, { gridSpec, originX, originY });
 *   scene.input.on('pointermove', (p) => area.updateSnapCursor(p.x, p.y));
 *   scene.input.on('pointerout',  ()  => area.hideSnapCursor());
 *   // ... later:
 *   area.destroy();
 */
export class CanvasArea {
  private readonly scene: CanvasSceneLike;
  private spec: CanvasAreaSpec;
  private readonly depth: number;
  private readonly layers: Required<CanvasAreaLayerFlags>;

  /** Every Phaser GameObject the area owns — destroyed in one pass. */
  private readonly disposables: Array<{ destroy(): void }> = [];

  /** Latest computed snap-cursor state, or `null` when off-canvas. */
  private snapState: SnapCursorState | null = null;

  /** Pre-allocated cell highlight rectangle (toggled visible per move). */
  private snapCellHighlight: CanvasRectangleLike | null = null;

  /** Pre-allocated crosshair `Graphics` redrawn per pointer move. */
  private snapCrosshair: CanvasGraphicsLike | null = null;

  private destroyed = false;

  constructor(
    scene: Phaser.Scene | CanvasSceneLike,
    options: CanvasAreaOptions = {},
  ) {
    this.scene = scene as unknown as CanvasSceneLike;
    this.depth = options.depth ?? DEFAULT_DEPTH;
    this.layers = {
      surface: options.layers?.surface ?? true,
      gridLines: options.layers?.gridLines ?? true,
      bounds: options.layers?.bounds ?? true,
      coordinateMarks: options.layers?.coordinateMarks ?? true,
      snapCursor: options.layers?.snapCursor ?? true,
    };
    this.spec = buildCanvasAreaSpec(
      options.gridSpec ?? DEFAULT_GRID_SPEC,
      options.originX ?? 0,
      options.originY ?? 0,
    );
    this.populate();
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  /** Read-only snapshot of the live canvas-area spec. */
  getSpec(): CanvasAreaSpec {
    return this.spec;
  }

  /** Latest snap-cursor state (or `null` when the cursor is off-canvas). */
  getSnapCursor(): SnapCursorState | null {
    return this.snapState;
  }

  /**
   * Re-target the canvas to a new grid spec / origin and rebuild every
   * visual. Call this when the player resizes the canvas (future "canvas
   * size" control panel) or when the scene viewport changes.
   *
   * The snap cursor is hidden as part of the rebuild — the host should
   * forward the next pointer-move to repopulate it.
   */
  setSpec(spec: Partial<CanvasAreaSpec> & { gridSpec?: GridSpec }): void {
    if (this.destroyed) return;
    this.spec = buildCanvasAreaSpec(
      spec.gridSpec ?? this.spec.gridSpec,
      spec.originX ?? this.spec.originX,
      spec.originY ?? this.spec.originY,
    );
    this.populate();
  }

  /**
   * Update the snap-cursor overlay from a viewport-space pointer
   * position. Idempotent on identical inputs (the underlying state is
   * a pure function of `(vx, vy)` + the spec). When the cursor is
   * off-canvas the overlay is hidden but the latest state is still
   * stored so callers can read `getSnapCursor()` for diagnostic /
   * HUD purposes.
   */
  updateSnapCursor(viewportX: number, viewportY: number): SnapCursorState {
    const state = computeSnapCursor(viewportX, viewportY, this.spec);
    this.snapState = state;
    if (state.overCanvas) {
      this.applySnapCursorVisuals(state);
    } else {
      this.hideSnapCursorVisuals();
    }
    return state;
  }

  /**
   * Hide the snap-cursor overlay (e.g. on `pointerout`). Idempotent.
   * The stored state is preserved so a subsequent `getSnapCursor()`
   * still reports the last position the cursor visited.
   */
  hideSnapCursor(): void {
    this.hideSnapCursorVisuals();
  }

  /** Tear down every GameObject the area owns. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const obj of this.disposables) obj.destroy();
    this.disposables.length = 0;
    this.snapCellHighlight = null;
    this.snapCrosshair = null;
    this.snapState = null;
  }

  // -------------------------------------------------------------------------
  // Internal — rendering
  // -------------------------------------------------------------------------

  /**
   * Wipe + rebuild every visual the area owns. One entry point so
   * resize / theme / undo paths share exactly the same render code.
   * Per-layer flags let a host that already paints certain layers
   * inline (e.g. the `StageBuilderScene` Sub-AC 1 grid path) reuse
   * the component for just the missing pieces.
   */
  private populate(): void {
    // Clean slate — drop everything we previously created.
    for (const obj of this.disposables) obj.destroy();
    this.disposables.length = 0;
    this.snapCellHighlight = null;
    this.snapCrosshair = null;

    if (this.layers.surface) this.renderSurface();
    if (this.layers.gridLines) this.renderGridLines();
    if (this.layers.bounds) this.renderBoundsFrames();
    if (this.layers.coordinateMarks) this.renderCoordinateMarks();
    if (this.layers.snapCursor) this.renderSnapCursorLayers();
  }

  /** Canvas surface — a single rectangle the grid lines sit on. */
  private renderSurface(): void {
    // procedural fallback — builder canvas surface, grid, and snap-cursor
    // visuals all rendered from `Phaser.GameObjects.Rectangle` +
    // `Graphics` primitives (no sprite frames). The stage builder is
    // editor chrome; procedural rendering is intentional. Replace only
    // if a textured editor skin is added.
    const surface = this.scene.add
      .rectangle(
        this.spec.originX,
        this.spec.originY,
        this.spec.width,
        this.spec.height,
        CANVAS_AREA_COLORS.surface,
        1,
      )
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setDepth(this.depth);
    this.disposables.push(surface);
  }

  /** Grid lines — minor + major batched into two Graphics objects. */
  private renderGridLines(): void {
    const minor = this.scene.add
      .graphics()
      .setScrollFactor(0, 0)
      .setDepth(this.depth + 1);
    minor.lineStyle(CANVAS_AREA_STROKES.minor, CANVAS_AREA_COLORS.gridMinor, 1);
    const major = this.scene.add
      .graphics()
      .setScrollFactor(0, 0)
      .setDepth(this.depth + 2);
    major.lineStyle(CANVAS_AREA_STROKES.major, CANVAS_AREA_COLORS.gridMajor, 1);

    const lines = enumerateGridLines(this.spec.gridSpec);
    for (const line of lines) {
      this.drawGridLine(line, line.major ? major : minor);
    }
    this.disposables.push(minor);
    this.disposables.push(major);
  }

  private drawGridLine(line: GridLine, target: CanvasGraphicsLike): void {
    if (line.axis === 'vertical') {
      target.lineBetween(
        this.spec.originX + line.position,
        this.spec.originY,
        this.spec.originX + line.position,
        this.spec.originY + this.spec.height,
      );
    } else {
      target.lineBetween(
        this.spec.originX,
        this.spec.originY + line.position,
        this.spec.originX + this.spec.width,
        this.spec.originY + line.position,
      );
    }
  }

  /**
   * Bounds frames — active rectangle, shadow drop, and (when the active
   * canvas is smaller than the 2× cap) a dim max-bounds outline.
   *
   * Each rect is a separate `Graphics` so the renderer can paint them
   * with independent stroke styles in one pass each. Order is back-to-
   * front per `enumerateBoundsRects`.
   */
  private renderBoundsFrames(): void {
    const rects = enumerateBoundsRects(this.spec);
    for (const rect of rects) {
      this.disposables.push(this.drawBoundsRect(rect));
    }
  }

  private drawBoundsRect(rect: BoundsRect): CanvasGraphicsLike {
    const g = this.scene.add
      .graphics()
      .setScrollFactor(0, 0)
      .setDepth(this.depth + 3);
    g.lineStyle(rect.strokeWidth, rect.strokeColor, rect.strokeAlpha);
    g.strokeRect(
      this.spec.originX + rect.x,
      this.spec.originY + rect.y,
      rect.width,
      rect.height,
    );
    return g;
  }

  /** Coordinate-system marks — origin, axis arrows, numeric ticks. */
  private renderCoordinateMarks(): void {
    const marks = enumerateCoordinateMarks(this.spec.gridSpec);
    for (const mark of marks) {
      this.disposables.push(this.buildCoordinateMark(mark));
    }
  }

  private buildCoordinateMark(mark: CoordinateMark): CanvasTextLike {
    const colour =
      mark.kind === 'origin'
        ? toHex(CANVAS_AREA_COLORS.originLabel)
        : mark.kind === 'tick'
          ? toHex(CANVAS_AREA_COLORS.tickLabel)
          : toHex(CANVAS_AREA_COLORS.axisLabel);
    // Origin label hugs the inside corner; axis labels sit just inside
    // the far edge; numeric ticks straddle the major line.
    const offsetX = mark.kind === 'axis-x' ? -6 : 6;
    const offsetY = mark.kind === 'axis-y' ? -6 : 6;
    const originX = mark.kind === 'axis-x' ? 1 : 0;
    const originY = mark.kind === 'axis-y' ? 1 : 0;
    const text = this.scene.add
      .text(
        this.spec.originX + mark.x + offsetX,
        this.spec.originY + mark.y + offsetY,
        mark.label,
        {
          fontFamily: 'monospace',
          fontSize: mark.kind === 'tick' ? '12px' : '14px',
          color: colour,
        },
      )
      .setOrigin(originX, originY)
      .setScrollFactor(0, 0)
      .setDepth(this.depth + 4);
    return text;
  }

  /**
   * Pre-allocate the snap-cursor cell highlight + crosshair Graphics.
   * They're created hidden; `updateSnapCursor` toggles + repositions
   * them per pointer move so the per-frame path allocates nothing.
   */
  private renderSnapCursorLayers(): void {
    const cell = this.scene.add
      .rectangle(
        this.spec.originX,
        this.spec.originY,
        this.spec.gridSpec.cellPx,
        this.spec.gridSpec.cellPx,
        CANVAS_AREA_COLORS.snapCellFill,
        SNAP_CELL_ALPHA,
      )
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setDepth(this.depth + 5)
      .setVisible(false);
    this.snapCellHighlight = cell;
    this.disposables.push(cell);

    const crosshair = this.scene.add
      .graphics()
      .setScrollFactor(0, 0)
      .setDepth(this.depth + 6)
      .setVisible(false);
    this.snapCrosshair = crosshair;
    this.disposables.push(crosshair);
  }

  private applySnapCursorVisuals(state: SnapCursorState): void {
    if (this.snapCellHighlight) {
      this.snapCellHighlight
        .setPosition(state.cellX, state.cellY)
        .setSize(state.cellWidth, state.cellHeight)
        .setVisible(true);
    }
    if (this.snapCrosshair) {
      this.snapCrosshair.clear();
      this.snapCrosshair.lineStyle(
        CANVAS_AREA_STROKES.crosshair,
        CANVAS_AREA_COLORS.snapCrosshair,
        SNAP_CROSSHAIR_ALPHA,
      );
      const cx = state.viewportSnappedX;
      const cy = state.viewportSnappedY;
      this.snapCrosshair.lineBetween(cx - SNAP_CROSSHAIR_ARM, cy, cx + SNAP_CROSSHAIR_ARM, cy);
      this.snapCrosshair.lineBetween(cx, cy - SNAP_CROSSHAIR_ARM, cx, cy + SNAP_CROSSHAIR_ARM);
      this.snapCrosshair.setVisible(true);
    }
  }

  private hideSnapCursorVisuals(): void {
    this.snapCellHighlight?.setVisible(false);
    this.snapCrosshair?.setVisible(false);
  }
}

// ---------------------------------------------------------------------------
// Re-exports — surface the bounds palette + stroke widths so callers
// that import the component directly don't have to dual-import the
// pure helper module.
// ---------------------------------------------------------------------------

export { CANVAS_BOUNDS_COLORS, CANVAS_BOUNDS_STROKES };
export type { BoundsRect, CanvasAreaSpec, SnapCursorState };

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function toHex(color: number): string {
  // Phaser's `add.text` style accepts CSS-style colours; convert the
  // numeric palette entries into `#rrggbb` strings without bringing
  // in a hex-formatting dependency.
  const clamped = Math.max(0, Math.min(0xffffff, Math.floor(color)));
  return `#${clamped.toString(16).padStart(6, '0')}`;
}
