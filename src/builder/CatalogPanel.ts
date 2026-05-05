/**
 * Stage-builder catalog panel — AC 20002 Sub-AC 2.
 *
 * Renders the eight-piece catalog (`CATALOG_PIECES`) as a vertical
 * panel pinned to the left edge of the {@link StageBuilderScene}.
 * Each row paints:
 *
 *   • A thumbnail rectangle with a piece-specific abstract glyph (bar,
 *     slope triangle, dashed bar, flame, arrow, …) so the player can
 *     identify the piece at a glance.
 *   • A user-facing label ("FLAT PLATFORM", "LAVA ZONE", …).
 *   • A short description sub-line.
 *   • A hidden "selection" overlay rectangle that becomes visible when
 *     a row is the active selection — gives the player a clear "you
 *     have this piece in hand" feedback signal independent of any
 *     drag ghost the canvas paints.
 *
 * Selection state
 * ---------------
 *
 *   • `setSelected(type)` marks one of the eight catalog rows as the
 *     active piece. The matching row paints a brighter background +
 *     thicker accent border; every other row reverts to neutral. An
 *     unknown type is a no-op so the API can't be used to push the
 *     panel into an inconsistent state.
 *
 *   • `getSelected()` returns the active piece type or `null` if no
 *     row is currently selected.
 *
 *   • `clearSelection()` deselects all rows. Idempotent.
 *
 *   • `onSelectionChange` (constructor option) — optional callback
 *     fired whenever the selection transitions (set or clear). Future
 *     sub-ACs (drag-and-drop, "click-to-arm" placement) consume this
 *     so they can mirror the panel's selection without re-implementing
 *     the visual book-keeping.
 *
 * The panel is the SOLE source of truth for the on-screen catalog —
 * including which piece is "in hand". Drag-and-drop hit-testing
 * continues to live in `dragDrop.ts`; the panel only owns the visual
 * + the `BuilderPieceType` identity of the picked piece.
 *
 * Why this lives in `src/builder/` (alongside the grid math)
 * ----------------------------------------------------------
 *
 *   • The catalog is a builder-only concept — keeping it in the same
 *     module as the grid math means consumers only need one import for
 *     "everything the stage builder offers".
 *   • Tests for the wiring contract live next door in
 *     `CatalogPanel.test.ts`; pure data + layout math lives in
 *     `catalogPieces.ts` so the unit suite covers it without booting
 *     Phaser.
 *
 * Determinism note: the panel is render-only. It paints once at
 * construction and never reads `Math.random()` or the wall clock —
 * future drag-and-drop wiring will be event-driven and deterministic.
 * Selection is a discrete state mutation triggered by deterministic
 * pointer events; no time / randomness is consulted.
 */

import type Phaser from 'phaser';
import {
  CATALOG_PANEL_LAYOUT,
  CATALOG_PIECES,
  buildCatalogRowLayouts,
  catalogColorHex,
  catalogPanelHeight,
  type BuilderPieceType,
  type CatalogPiece,
  type CatalogRowLayout,
  type CatalogThumbnailKind,
} from './catalogPieces';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Cosmetic / layout tuning. */
export interface CatalogPanelOptions {
  /** Render depth (must beat grid layer; default 50). */
  readonly depth?: number;
  /** Override panel position; default uses CATALOG_PANEL_LAYOUT margins. */
  readonly originX?: number;
  /** Override panel position; default uses CATALOG_PANEL_LAYOUT margins. */
  readonly originY?: number;
  /**
   * Optional callback fired whenever the panel's selection state
   * transitions. The callback receives the new active piece type, or
   * `null` if the selection was cleared. Fired AFTER the visual
   * highlight is updated, so the host can read the panel's `getSelected()`
   * inside the callback and see the new value.
   *
   * The callback is NOT invoked for redundant set-to-same / repeated
   * clears so consumers don't have to debounce.
   */
  readonly onSelectionChange?: (type: BuilderPieceType | null) => void;
}

/**
 * Public hit rectangle for one row — exposed so the drag-and-drop
 * layer (later sub-AC) can hit-test pointer events without poking at
 * private Phaser objects. Coordinates are in viewport space (already
 * translated by the panel's origin).
 */
export interface CatalogRowHitRect {
  readonly type: BuilderPieceType;
  readonly index: number;
  readonly piece: CatalogPiece;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// Internal — minimal scene shape so tests / shims can mock without Phaser
// ---------------------------------------------------------------------------

interface CatalogTextLike {
  setOrigin(x: number, y?: number): CatalogTextLike;
  setScrollFactor(x: number, y?: number): CatalogTextLike;
  setDepth(depth: number): CatalogTextLike;
  setPosition(x: number, y: number): CatalogTextLike;
  destroy(): void;
}

interface CatalogRectangleLike {
  setOrigin(x: number, y?: number): CatalogRectangleLike;
  setScrollFactor(x: number, y?: number): CatalogRectangleLike;
  setDepth(depth: number): CatalogRectangleLike;
  setStrokeStyle(width: number, color: number, alpha?: number): CatalogRectangleLike;
  setVisible(visible: boolean): CatalogRectangleLike;
  destroy(): void;
}

interface CatalogGraphicsLike {
  setScrollFactor(x: number, y?: number): CatalogGraphicsLike;
  setDepth(depth: number): CatalogGraphicsLike;
  fillStyle(color: number, alpha?: number): CatalogGraphicsLike;
  lineStyle(width: number, color: number, alpha?: number): CatalogGraphicsLike;
  fillRect(x: number, y: number, w: number, h: number): CatalogGraphicsLike;
  strokeRect(x: number, y: number, w: number, h: number): CatalogGraphicsLike;
  fillTriangle(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ): CatalogGraphicsLike;
  fillCircle(x: number, y: number, r: number): CatalogGraphicsLike;
  beginPath(): CatalogGraphicsLike;
  moveTo(x: number, y: number): CatalogGraphicsLike;
  lineTo(x: number, y: number): CatalogGraphicsLike;
  strokePath(): CatalogGraphicsLike;
  destroy(): void;
}

interface CatalogSceneLike {
  scale: { gameSize: { width: number; height: number } };
  add: {
    rectangle(
      x: number,
      y: number,
      width: number,
      height: number,
      color: number,
      alpha?: number,
    ): CatalogRectangleLike;
    text(
      x: number,
      y: number,
      content: string,
      style: Record<string, unknown>,
    ): CatalogTextLike;
    graphics(): CatalogGraphicsLike;
  };
}

// ---------------------------------------------------------------------------
// Visual constants — exported for test contract assertions + future
// drag-ghost work that wants to mirror the panel's palette.
// ---------------------------------------------------------------------------

/**
 * Palette for the catalog panel. Hex literals (no `#`) so they pass
 * straight into Phaser's `lineStyle` / `Rectangle` ctors. The colours
 * sit on the same cool slate / warm accent register as the rest of the
 * builder chrome (see `STAGE_BUILDER_COLORS` in `StageBuilderScene`).
 */
export const CATALOG_PANEL_COLORS = Object.freeze({
  panelFill: 0x12182a,
  panelBorder: 0x39456b,
  headerFill: 0x1c2440,
  rowDivider: 0x232b48,
  thumbnailFill: 0x0c1020,
  thumbnailBorder: 0x39456b,
  labelText: 0xe8e8f0,
  descriptionText: 0x9aa0b6,
  headerText: 0xffd166,
  categoryPlatform: 0x6cf0c2,
  categoryHazard: 0xff944d,
  categorySpawn: 0xffe066,
  /**
   * Filled overlay painted on top of the selected row. Translucent
   * warm-yellow so the selection reads as "this row is in hand"
   * regardless of the row's category accent. Alpha is applied at
   * paint time (see `SELECTED_OVERLAY_ALPHA`).
   */
  selectedOverlayFill: 0xffd166,
  /**
   * Stroke colour for the thicker border drawn around the selected
   * row. Bright enough to read against the panel background but
   * still in the same warm-yellow family as the overlay so the
   * selection cue is visually consistent.
   */
  selectedBorder: 0xffe066,
});

/**
 * Translucency for the selection overlay. Low enough that the row's
 * label / description / thumbnail remain legible underneath, high
 * enough that the highlight is unmistakable at a glance.
 */
const SELECTED_OVERLAY_ALPHA = 0.18;

/** Stroke width used for the selected-row border (design pixels). */
const SELECTED_BORDER_WIDTH = 2;

/** Default depth — sits above the grid (`STAGE_BUILDER_DEPTHS.grid`)
 *  but below scene chrome (`STAGE_BUILDER_DEPTHS.chrome`). */
const DEFAULT_DEPTH = 50;

// ---------------------------------------------------------------------------
// CatalogPanel
// ---------------------------------------------------------------------------

/**
 * Vertical catalog panel pinned to the left edge of the stage builder
 * viewport. Renders once at construction; no per-frame update loop.
 *
 * Lifecycle:
 *
 *   const panel = new CatalogPanel(scene);
 *   // ... later:
 *   const hits = panel.getRowHitRects();      // for drag/drop hit-testing
 *   panel.destroy();                          // tears down all GameObjects
 */
export class CatalogPanel {
  private readonly scene: CatalogSceneLike;
  private readonly originX: number;
  private readonly originY: number;
  private readonly depth: number;
  private readonly onSelectionChange?: (type: BuilderPieceType | null) => void;

  /** Every Phaser GameObject the panel owns — destroyed in one pass. */
  private readonly disposables: Array<{ destroy(): void }> = [];

  /** Row hit-rects exposed to the drag-and-drop layer. */
  private readonly hitRects: CatalogRowHitRect[] = [];

  /**
   * Per-piece selection-overlay handles. Each entry is a Rectangle
   * that's pre-created hidden during `render()` and toggled visible
   * by `setSelected(type)`. Map-by-type keeps the lookup O(1) without
   * having to filter the disposables list.
   */
  private readonly selectionOverlays = new Map<
    BuilderPieceType,
    CatalogRectangleLike
  >();

  /**
   * The piece type whose selection overlay is currently visible, or
   * `null` if no row is selected. Mutating this field always goes
   * through `setSelected()` / `clearSelection()` so the visuals stay
   * in lock-step with the data.
   */
  private selectedType: BuilderPieceType | null = null;

  private destroyed = false;

  constructor(
    scene: Phaser.Scene | CatalogSceneLike,
    options: CatalogPanelOptions = {},
  ) {
    this.scene = scene as unknown as CatalogSceneLike;
    this.originX = options.originX ?? CATALOG_PANEL_LAYOUT.marginLeft;
    this.originY = options.originY ?? CATALOG_PANEL_LAYOUT.marginTop;
    this.depth = options.depth ?? DEFAULT_DEPTH;
    this.onSelectionChange = options.onSelectionChange;
    this.render();
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  /** Panel-relative width in design pixels. */
  width(): number {
    return CATALOG_PANEL_LAYOUT.panelWidth;
  }

  /** Panel-relative height in design pixels. */
  height(): number {
    return catalogPanelHeight();
  }

  /**
   * Read-only snapshot of every row's hit rect — viewport-space
   * coordinates already translated by the panel origin. Use this from
   * the (later) drag-and-drop layer to figure out which piece the
   * pointer is over.
   */
  getRowHitRects(): ReadonlyArray<CatalogRowHitRect> {
    return this.hitRects;
  }

  /**
   * Find the row hit-rect for a piece by type. Returns `undefined` if
   * the piece is not in the catalog (shouldn't happen for any
   * `BuilderPieceType` literal but the helper is defensive).
   */
  findHitRect(type: BuilderPieceType): CatalogRowHitRect | undefined {
    return this.hitRects.find((r) => r.type === type);
  }

  /**
   * Number of rows the panel renders. Always 8 in v1; exposed so
   * tests can assert the panel actually painted a row per Seed piece.
   */
  rowCount(): number {
    return this.hitRects.length;
  }

  /**
   * The piece type currently shown as the active selection, or `null`
   * if no row is selected. The host (drag-drop layer, "click-to-arm"
   * placement) reads this to know which piece is "in hand".
   */
  getSelected(): BuilderPieceType | null {
    return this.selectedType;
  }

  /**
   * Mark `type` as the active selection. The matching row paints its
   * highlight overlay; every other row's overlay is hidden. If `type`
   * is not a known catalog piece the call is a no-op so the API can't
   * be used to push the panel into an inconsistent state.
   *
   * Returns `true` if the selection actually changed (so callers can
   * short-circuit re-renders on no-op transitions). Idempotent: calling
   * `setSelected(x)` twice in a row does nothing the second time and
   * returns `false`.
   *
   * If the panel was constructed with an `onSelectionChange` callback,
   * it fires AFTER the visual highlight is updated and only when the
   * selection actually changed.
   */
  setSelected(type: BuilderPieceType): boolean {
    if (this.destroyed) return false;
    // Defensive: ignore unknown types so the panel can't be driven
    // into a state where `selectedType` doesn't match any row.
    if (!this.selectionOverlays.has(type)) return false;
    if (this.selectedType === type) return false;
    this.selectedType = type;
    this.applySelectionVisuals();
    this.onSelectionChange?.(type);
    return true;
  }

  /**
   * Deselect every row. Idempotent — calling `clearSelection()` when
   * nothing is selected is a no-op and returns `false`. Returns `true`
   * if the panel previously had a selection.
   *
   * Fires the `onSelectionChange(null)` callback only when the call
   * actually transitioned from "selected" → "none".
   */
  clearSelection(): boolean {
    if (this.destroyed) return false;
    if (this.selectedType === null) return false;
    this.selectedType = null;
    this.applySelectionVisuals();
    this.onSelectionChange?.(null);
    return true;
  }

  /**
   * `true` iff `type` is the active selection. Convenience wrapper so
   * callers don't have to spell out a `getSelected() === type` check.
   */
  isSelected(type: BuilderPieceType): boolean {
    return this.selectedType === type;
  }

  /** Tear down every Phaser GameObject the panel owns. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const obj of this.disposables) obj.destroy();
    this.disposables.length = 0;
    this.hitRects.length = 0;
    this.selectionOverlays.clear();
    this.selectedType = null;
  }

  // -------------------------------------------------------------------------
  // Internal — rendering
  // -------------------------------------------------------------------------

  private render(): void {
    this.renderPanelBackground();
    this.renderHeader();
    const rows = buildCatalogRowLayouts();
    for (const row of rows) {
      this.renderRow(row);
    }
  }

  private renderPanelBackground(): void {
    const w = CATALOG_PANEL_LAYOUT.panelWidth;
    const h = catalogPanelHeight();
    // Phaser rectangles are origin-centred by default; we set 0,0
    // so coordinates read like normal CSS top-left boxes.
    const bg = this.scene.add
      .rectangle(this.originX, this.originY, w, h, CATALOG_PANEL_COLORS.panelFill, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setStrokeStyle(2, CATALOG_PANEL_COLORS.panelBorder, 1)
      .setDepth(this.depth);
    this.disposables.push(bg);
  }

  private renderHeader(): void {
    const w = CATALOG_PANEL_LAYOUT.panelWidth;
    const headerH = CATALOG_PANEL_LAYOUT.headerHeight;
    const headerBg = this.scene.add
      .rectangle(this.originX, this.originY, w, headerH, CATALOG_PANEL_COLORS.headerFill, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setDepth(this.depth + 1);
    this.disposables.push(headerBg);

    const headerText = this.scene.add
      .text(
        this.originX + CATALOG_PANEL_LAYOUT.rowPadding,
        this.originY + headerH / 2,
        'PIECES',
        {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: catalogColorHex(CATALOG_PANEL_COLORS.headerText),
        },
      )
      .setOrigin(0, 0.5)
      .setScrollFactor(0, 0)
      .setDepth(this.depth + 2);
    this.disposables.push(headerText);
  }

  private renderRow(row: CatalogRowLayout): void {
    const rowOriginX = this.originX;
    const rowOriginY = this.originY + row.topY;

    // Row divider — a 1-px line under the row so adjacent rows read
    // as separate cells. We skip the last row so the panel border
    // closes the bottom edge cleanly.
    if (row.index < CATALOG_PIECES.length - 1) {
      const divider = this.scene.add
        .rectangle(
          rowOriginX,
          rowOriginY + CATALOG_PANEL_LAYOUT.rowHeight - 1,
          CATALOG_PANEL_LAYOUT.panelWidth,
          1,
          CATALOG_PANEL_COLORS.rowDivider,
          1,
        )
        .setOrigin(0, 0)
        .setScrollFactor(0, 0)
        .setDepth(this.depth + 1);
      this.disposables.push(divider);
    }

    // Category accent strip — 4-px coloured ribbon down the left edge of
    // the row so the player sees platform/hazard/spawn at a glance even
    // before reading the label.
    const accent = this.scene.add
      .rectangle(
        rowOriginX,
        rowOriginY,
        4,
        CATALOG_PANEL_LAYOUT.rowHeight,
        accentForCategory(row.piece.category),
        1,
      )
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setDepth(this.depth + 1);
    this.disposables.push(accent);

    // Thumbnail frame.
    const thumbX = rowOriginX + row.thumbnailX;
    const thumbY = this.originY + row.thumbnailY;
    const thumbBg = this.scene.add
      .rectangle(
        thumbX,
        thumbY,
        row.thumbnailSize,
        row.thumbnailSize,
        CATALOG_PANEL_COLORS.thumbnailFill,
        1,
      )
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setStrokeStyle(1, CATALOG_PANEL_COLORS.thumbnailBorder, 1)
      .setDepth(this.depth + 2);
    this.disposables.push(thumbBg);

    // Thumbnail glyph.
    this.paintThumbnailGlyph(
      thumbX,
      thumbY,
      row.thumbnailSize,
      row.piece.thumbnailKind,
      row.piece.accentColor,
    );

    // Label.
    const label = this.scene.add
      .text(
        rowOriginX + row.labelX,
        this.originY + row.labelTopY,
        row.piece.label,
        {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: catalogColorHex(CATALOG_PANEL_COLORS.labelText),
        },
      )
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setDepth(this.depth + 2);
    this.disposables.push(label);

    // Description sub-line.
    const description = this.scene.add
      .text(
        rowOriginX + row.labelX,
        this.originY + row.descriptionTopY,
        row.piece.description,
        {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: catalogColorHex(CATALOG_PANEL_COLORS.descriptionText),
          // Wrap so a long sentence doesn't overflow the panel.
          wordWrap: {
            width:
              CATALOG_PANEL_LAYOUT.panelWidth -
              row.labelX -
              CATALOG_PANEL_LAYOUT.rowPadding,
            useAdvancedWrap: true,
          },
        },
      )
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setDepth(this.depth + 2);
    this.disposables.push(description);

    // Selection overlay — pre-created hidden. Painted ABOVE every
    // other row visual (depth + 4) so the highlight reads on top of
    // the thumbnail / label / accent. Toggled visible by
    // `setSelected(type)`.
    //
    // We use one rectangle per row with both a translucent fill AND a
    // thicker stroke: the fill softly tints the row so it reads as
    // "active", and the stroke draws a hard frame so the selection is
    // visible even on rows where the fill colour matches the row's
    // category accent (preventing the highlight from disappearing
    // when the selected piece happens to share its accent hue).
    const selectionOverlay = this.scene.add
      .rectangle(
        rowOriginX,
        rowOriginY,
        CATALOG_PANEL_LAYOUT.panelWidth,
        CATALOG_PANEL_LAYOUT.rowHeight,
        CATALOG_PANEL_COLORS.selectedOverlayFill,
        SELECTED_OVERLAY_ALPHA,
      )
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setStrokeStyle(
        SELECTED_BORDER_WIDTH,
        CATALOG_PANEL_COLORS.selectedBorder,
        1,
      )
      .setDepth(this.depth + 4)
      .setVisible(false);
    this.disposables.push(selectionOverlay);
    this.selectionOverlays.set(row.piece.type, selectionOverlay);

    // Record the hit rect for the drag-and-drop layer to consume.
    this.hitRects.push({
      type: row.piece.type,
      index: row.index,
      piece: row.piece,
      x: rowOriginX,
      y: rowOriginY,
      width: CATALOG_PANEL_LAYOUT.panelWidth,
      height: CATALOG_PANEL_LAYOUT.rowHeight,
    });
  }

  /**
   * Sync every per-row selection overlay's `visible` flag with the
   * current `selectedType`. Called on every `setSelected()` /
   * `clearSelection()` mutation so the visuals stay in lock-step
   * with the data.
   */
  private applySelectionVisuals(): void {
    for (const [type, overlay] of this.selectionOverlays) {
      overlay.setVisible(type === this.selectedType);
    }
  }

  /**
   * Paint the abstract glyph for one thumbnail. Each glyph is a small
   * Graphics object so it can use solid fills, triangles, and dashed
   * strokes without needing bitmap sprite assets.
   *
   * Coordinates are in viewport space (already translated by the
   * panel origin) and the glyph is laid out inside a `size × size`
   * box anchored at `(x, y)`.
   */
  // procedural fallback — catalog piece thumbnails composed from
  // `Phaser.Graphics` primitives (rects/triangles/circles). No catalog
  // thumbnail texture pack is registered in `assets/manifest.ts`; the
  // builder is intentionally rendered procedurally so a new piece type
  // can land without needing an artist pass. Replace by registering
  // per-piece thumbnail sprites and swapping for `add.image` if a
  // textured catalog skin ever ships.
  private paintThumbnailGlyph(
    x: number,
    y: number,
    size: number,
    kind: CatalogThumbnailKind,
    color: number,
  ): void {
    const g = this.scene.add.graphics();
    g.setScrollFactor(0, 0);
    g.setDepth(this.depth + 3);
    this.disposables.push(g);

    const pad = Math.floor(size * 0.15);
    const innerX = x + pad;
    const innerY = y + pad;
    const innerSize = size - pad * 2;
    const cx = x + size / 2;
    const cy = y + size / 2;

    switch (kind) {
      case 'bar': {
        // Solid horizontal bar centred vertically.
        const barH = Math.max(8, Math.floor(innerSize * 0.35));
        const barY = cy - barH / 2;
        g.fillStyle(color, 1);
        g.fillRect(innerX, barY, innerSize, barH);
        break;
      }
      case 'slope': {
        // Right-triangle: floor along the bottom, ramping up to the right.
        g.fillStyle(color, 1);
        g.fillTriangle(
          innerX,
          innerY + innerSize,
          innerX + innerSize,
          innerY + innerSize,
          innerX + innerSize,
          innerY,
        );
        break;
      }
      case 'column': {
        // Tall vertical solid centred horizontally.
        const colW = Math.max(8, Math.floor(innerSize * 0.35));
        const colX = cx - colW / 2;
        g.fillStyle(color, 1);
        g.fillRect(colX, innerY, colW, innerSize);
        break;
      }
      case 'dashed-bar': {
        // Thin solid bar with a dashed outline above it — reads as
        // "you can pass through this from below".
        const barH = Math.max(6, Math.floor(innerSize * 0.22));
        const barY = cy - barH / 2;
        g.fillStyle(color, 1);
        g.fillRect(innerX, barY, innerSize, barH);
        g.lineStyle(2, color, 1);
        const dashLen = 6;
        const dashGap = 4;
        let dx = innerX;
        while (dx < innerX + innerSize) {
          const segEnd = Math.min(dx + dashLen, innerX + innerSize);
          g.beginPath();
          g.moveTo(dx, barY - 6);
          g.lineTo(segEnd, barY - 6);
          g.strokePath();
          dx = segEnd + dashGap;
        }
        break;
      }
      case 'flame': {
        // Stylised flame silhouette: a triangle base with a circle for
        // the rounded tip. Communicates "lava / fire" without needing
        // bitmap art.
        g.fillStyle(color, 1);
        g.fillTriangle(
          innerX,
          innerY + innerSize,
          innerX + innerSize,
          innerY + innerSize,
          cx,
          innerY + innerSize * 0.15,
        );
        g.fillCircle(cx, innerY + innerSize * 0.55, innerSize * 0.18);
        break;
      }
      case 'arrow-right': {
        // Big right-pointing arrow: a horizontal shaft + triangle head.
        const shaftH = Math.max(6, Math.floor(innerSize * 0.22));
        const shaftY = cy - shaftH / 2;
        const shaftEndX = innerX + innerSize * 0.65;
        g.fillStyle(color, 1);
        g.fillRect(innerX, shaftY, shaftEndX - innerX, shaftH);
        g.fillTriangle(
          shaftEndX,
          innerY,
          innerX + innerSize,
          cy,
          shaftEndX,
          innerY + innerSize,
        );
        break;
      }
      case 'path-bar': {
        // Solid bar with a dotted path stroke beneath it — reads as
        // "this surface follows a path".
        const barH = Math.max(8, Math.floor(innerSize * 0.30));
        const barY = cy - barH;
        g.fillStyle(color, 1);
        g.fillRect(innerX, barY, innerSize, barH);
        // Dotted path: a row of small filled circles.
        const dotR = 2;
        const dotGap = 8;
        let dxd = innerX + 4;
        const pathY = barY + barH + 8;
        while (dxd < innerX + innerSize) {
          g.fillCircle(dxd, pathY, dotR);
          dxd += dotGap;
        }
        break;
      }
      case 'crosshair': {
        // Plus-shape crosshair: two thin rectangles forming a +.
        const armT = Math.max(4, Math.floor(innerSize * 0.18));
        g.fillStyle(color, 1);
        // Horizontal arm.
        g.fillRect(innerX, cy - armT / 2, innerSize, armT);
        // Vertical arm.
        g.fillRect(cx - armT / 2, innerY, armT, innerSize);
        // Centre dot for emphasis.
        g.fillCircle(cx, cy, Math.max(3, Math.floor(armT * 0.5)));
        break;
      }
      default: {
        // Defensive — shouldn't happen because thumbnailKind is a
        // closed union, but rendering a small "?" rectangle beats a
        // silent blank thumb if a future piece adds a glyph kind we
        // haven't handled here.
        g.fillStyle(color, 1);
        g.fillRect(innerX, innerY, innerSize, innerSize);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function accentForCategory(
  category: CatalogPiece['category'],
): number {
  switch (category) {
    case 'platform':
      return CATALOG_PANEL_COLORS.categoryPlatform;
    case 'hazard':
      return CATALOG_PANEL_COLORS.categoryHazard;
    case 'spawn':
      return CATALOG_PANEL_COLORS.categorySpawn;
    default:
      return CATALOG_PANEL_COLORS.panelBorder;
  }
}
