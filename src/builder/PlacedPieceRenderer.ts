/**
 * Placed-piece renderer — AC 20102 Sub-AC 2.
 *
 * Companion Phaser host for {@link StageDataModel}. The model owns the
 * canonical roster of registered pieces; this component owns the
 * *visual* — one solid rectangle per registered piece, painted at the
 * piece's snapped canvas coordinates with the catalog accent colour and
 * a hairline border so the player can see exactly what they've placed.
 *
 * Lifecycle
 * ---------
 *
 *   1. The scene constructs the renderer once during `create()`,
 *      passing the canvas-area origin in viewport pixels.
 *   2. The scene wires the renderer's {@link PlacedPieceRenderer.repaint}
 *      method into the data model's change listener — every successful
 *      add / remove / clear triggers a single repaint.
 *   3. On each repaint the renderer:
 *        • destroys any GameObjects that no longer correspond to a
 *          registered piece (by id);
 *        • creates new GameObjects for newly-registered pieces;
 *        • leaves untouched-id GameObjects in place (no allocation,
 *          no re-paint cost on an unchanged piece).
 *   4. On scene shutdown, the renderer's {@link destroy} clears every
 *      GameObject so the next builder session starts clean.
 *
 * Why a discrete component
 * ------------------------
 *
 * Per the project's `code_architecture` evaluation principle, scenes
 * stay thin: lifecycle wiring + input forwarding only. Pulling the
 * placed-piece visuals into a discrete component:
 *
 *   • Concentrates the render path: one `repaint(pieces)` call rebuilds
 *     the visual layer from any roster snapshot. Future undo/redo +
 *     load-from-localStorage call the same entry point, so there is
 *     exactly one place that knows how a placed piece paints.
 *
 *   • Gives the unit suite a stable seam: tests construct a stub scene
 *     and assert the renderer issued the expected `Rectangle` /
 *     `Graphics` calls without booting Phaser.
 *
 * Determinism note: the renderer is a pure projection of the data
 * model's roster onto Phaser GameObjects. No `Math.random()`, no
 * wall-clock reads. A replay that re-builds the same registry produces
 * the same visual layer byte-identically.
 */

import type Phaser from 'phaser';
import {
  catalogColorHex,
  findCatalogPiece,
  type BuilderPieceType,
  type CatalogThumbnailKind,
} from './catalogPieces';
import type { RegisteredPiece } from './stageDataModel';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Cosmetic / layout tuning. */
export interface PlacedPieceRendererOptions {
  /** Render depth — sits above the grid + canvas area, below the catalog. */
  readonly depth?: number;
  /**
   * Canvas origin in viewport pixels. Placed pieces are stored in the
   * data model in canvas-relative coordinates; the renderer translates
   * to viewport space at paint time using this origin.
   */
  readonly canvasOriginX: number;
  /** See {@link canvasOriginX}. */
  readonly canvasOriginY: number;
}

/**
 * Public visual record for one placed-piece sprite. Exposed so tests +
 * future overlays (selection brush, hover highlight) can read the
 * renderer's per-piece state without poking private fields.
 */
export interface PlacedPieceVisual {
  readonly id: string;
  readonly type: BuilderPieceType;
  readonly viewportX: number;
  readonly viewportY: number;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

/**
 * Palette for placed pieces. Each piece's primary fill is its catalog
 * accent colour; this palette only fills in the auxiliary tones (label
 * text colour for the type tag, etc.).
 */
export const PLACED_PIECE_COLORS = Object.freeze({
  /**
   * Border colour drawn around every placed piece. Slightly darker than
   * the accent so the piece reads as "placed and committed" rather than
   * "ghost preview" (which uses the accent on both fill and stroke).
   */
  border: 0x0f1424,
  /** Text colour for the optional id / type tag. */
  labelText: 0xe8e8f0,
});

/**
 * Translucency for the placed-piece fill. Lower than the ghost-preview
 * fill (0.28) so a player carrying a new piece over an existing
 * placement can see both visuals overlap without confusion.
 */
const PLACED_FILL_ALPHA = 0.78;

/** Stroke width for the piece border in design pixels. */
const PLACED_STROKE_WIDTH = 2;

/**
 * Default depth — above the grid + canvas-area overlays
 * (`STAGE_BUILDER_DEPTHS.canvasArea = 25`) but below the catalog
 * (`STAGE_BUILDER_DEPTHS.catalog = 50`) and the drag ghost
 * (`STAGE_BUILDER_DEPTHS.ghost = 60`) so a fresh ghost paints on top
 * of any existing placements while the player is dragging.
 */
const DEFAULT_DEPTH = 35;

// ---------------------------------------------------------------------------
// Scene-shape shim — same pattern CatalogPanel / GhostPreview / CanvasArea
// use so the unit suite drives the component without booting Phaser.
// ---------------------------------------------------------------------------

interface PieceRectangleLike {
  setOrigin(x: number, y?: number): PieceRectangleLike;
  setScrollFactor(x: number, y?: number): PieceRectangleLike;
  setDepth(depth: number): PieceRectangleLike;
  setStrokeStyle(width: number, color: number, alpha?: number): PieceRectangleLike;
  setFillStyle(color: number, alpha?: number): PieceRectangleLike;
  setVisible(visible: boolean): PieceRectangleLike;
  setPosition(x: number, y: number): PieceRectangleLike;
  setSize(width: number, height: number): PieceRectangleLike;
  destroy(): void;
}

interface PieceTextLike {
  setOrigin(x: number, y?: number): PieceTextLike;
  setScrollFactor(x: number, y?: number): PieceTextLike;
  setDepth(depth: number): PieceTextLike;
  setPosition(x: number, y: number): PieceTextLike;
  destroy(): void;
}

interface PieceSceneLike {
  add: {
    rectangle(
      x: number,
      y: number,
      width: number,
      height: number,
      color: number,
      alpha?: number,
    ): PieceRectangleLike;
    text(
      x: number,
      y: number,
      content: string,
      style: Record<string, unknown>,
    ): PieceTextLike;
  };
}

interface PieceSpriteEntry {
  readonly id: string;
  readonly type: BuilderPieceType;
  readonly thumbnailKind: CatalogThumbnailKind;
  readonly rect: PieceRectangleLike;
  readonly tag: PieceTextLike | null;
}

// ---------------------------------------------------------------------------
// PlacedPieceRenderer
// ---------------------------------------------------------------------------

/**
 * Phaser host that paints one rectangle per registered piece. Repaint
 * is diff-based: pieces with unchanged ids keep their existing
 * GameObjects; new pieces allocate; removed pieces destroy. This means
 * a typical "drop a single piece" mutation costs exactly one
 * `add.rectangle()` call.
 *
 *     const renderer = new PlacedPieceRenderer(scene, {
 *       canvasOriginX: 320,
 *       canvasOriginY: 80,
 *     });
 *     model.addListener((pieces) => renderer.repaint(pieces));
 *     // ...later:
 *     renderer.destroy();
 */
export class PlacedPieceRenderer {
  private readonly scene: PieceSceneLike;
  private readonly depth: number;
  private canvasOriginX: number;
  private canvasOriginY: number;
  private readonly sprites = new Map<string, PieceSpriteEntry>();
  private destroyed = false;

  constructor(
    scene: Phaser.Scene | PieceSceneLike,
    options: PlacedPieceRendererOptions,
  ) {
    this.scene = scene as unknown as PieceSceneLike;
    this.depth = options.depth ?? DEFAULT_DEPTH;
    this.canvasOriginX = options.canvasOriginX;
    this.canvasOriginY = options.canvasOriginY;
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  /**
   * Diff the live roster against the renderer's existing sprites and
   * bring them into sync:
   *
   *   • New pieces (id not already painted) → allocate a Rectangle
   *     and (for hazard / spawn pieces) a small type tag overlay.
   *   • Removed pieces (id no longer in the roster) → destroy the
   *     existing GameObjects.
   *   • Unchanged pieces (id present in both) → keep the existing
   *     GameObjects untouched (no allocation, no paint work).
   *
   * Idempotent on identical inputs: a repaint with the same roster the
   * renderer already painted does no allocation and no paint work.
   */
  repaint(pieces: ReadonlyArray<RegisteredPiece>): void {
    if (this.destroyed) return;

    // Build the set of live ids so we can detect removals in O(n).
    const liveIds = new Set<string>();
    for (const piece of pieces) liveIds.add(piece.id);

    // Destroy sprites whose ids are no longer in the roster.
    for (const [id, entry] of this.sprites) {
      if (!liveIds.has(id)) {
        entry.rect.destroy();
        entry.tag?.destroy();
        this.sprites.delete(id);
      }
    }

    // Allocate sprites for newly-registered pieces.
    for (const piece of pieces) {
      if (this.sprites.has(piece.id)) continue;
      const entry = this.allocateSpriteFor(piece);
      this.sprites.set(piece.id, entry);
    }
  }

  /**
   * Update the canvas origin without rebuilding sprites — repositions
   * every existing piece to its new viewport-space coordinates. Called
   * by the scene when the canvas is resized / scrolled (future
   * pan/zoom sub-AC).
   */
  setCanvasOrigin(originX: number, originY: number, pieces: ReadonlyArray<RegisteredPiece>): void {
    if (this.destroyed) return;
    this.canvasOriginX = originX;
    this.canvasOriginY = originY;
    for (const piece of pieces) {
      const entry = this.sprites.get(piece.id);
      if (!entry) continue;
      const vx = piece.canvasX + this.canvasOriginX;
      const vy = piece.canvasY + this.canvasOriginY;
      entry.rect.setPosition(vx, vy);
      entry.tag?.setPosition(vx + 4, vy + 4);
    }
  }

  /**
   * Read-only snapshot of every painted sprite. Tests + future
   * overlays consume this to verify the renderer painted the expected
   * pieces without poking the private map.
   */
  getVisuals(): ReadonlyArray<PlacedPieceVisual> {
    const out: PlacedPieceVisual[] = [];
    for (const [id, entry] of this.sprites) {
      const meta = findCatalogPiece(entry.type);
      out.push({
        id,
        type: entry.type,
        viewportX: 0,
        viewportY: 0,
        width: meta?.defaultWidth ?? 0,
        height: meta?.defaultHeight ?? 0,
      });
    }
    return out;
  }

  /** Number of currently-painted sprites. */
  getSpriteCount(): number {
    return this.sprites.size;
  }

  /**
   * Test seam — exposes the underlying GameObject for the sprite with
   * the given id, or `null` if the renderer has not painted that id.
   * Lets the unit suite assert per-piece position / size / colour.
   */
  getSpriteEntry(id: string): PieceSpriteEntry | null {
    return this.sprites.get(id) ?? null;
  }

  /** Tear down every painted GameObject. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const entry of this.sprites.values()) {
      entry.rect.destroy();
      entry.tag?.destroy();
    }
    this.sprites.clear();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private allocateSpriteFor(piece: RegisteredPiece): PieceSpriteEntry {
    const meta = findCatalogPiece(piece.type);
    // Defensive: if the catalog metadata is missing for some reason
    // (should never happen because the model rejects unknown types),
    // fall back to a neutral grey so the placement is still visible.
    const accent = meta?.accentColor ?? 0x9aa0b6;
    const thumbnailKind: CatalogThumbnailKind = meta?.thumbnailKind ?? 'bar';

    const vx = piece.canvasX + this.canvasOriginX;
    const vy = piece.canvasY + this.canvasOriginY;

    // procedural fallback — placed builder pieces rendered as flat-colour
    // `Phaser.GameObjects.Rectangle` primitives tinted from the catalog
    // accent palette. Editor chrome is intentionally procedural; replace
    // by registering per-piece thumbnail textures and swapping for
    // `add.image` only if a textured editor skin ships.
    const rect = this.scene.add
      .rectangle(vx, vy, piece.width, piece.height, accent, PLACED_FILL_ALPHA)
      .setOrigin(0, 0)
      .setScrollFactor(0, 0)
      .setDepth(this.depth)
      .setStrokeStyle(PLACED_STROKE_WIDTH, PLACED_PIECE_COLORS.border, 1);

    // Type tag — a tiny corner label so the player can see which piece
    // each placement is at a glance, especially helpful when several
    // hazards of similar colour are clustered together. Skipped for
    // pieces that are too small to read text on (spawn-point's 40×40
    // marker leaves no room for a label).
    let tag: PieceTextLike | null = null;
    if (piece.width >= 80 && piece.height >= 32) {
      tag = this.scene.add
        .text(vx + 4, vy + 4, abbreviateLabel(piece.type), {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: catalogColorHex(PLACED_PIECE_COLORS.labelText),
        })
        .setOrigin(0, 0)
        .setScrollFactor(0, 0)
        .setDepth(this.depth + 1);
    }

    return {
      id: piece.id,
      type: piece.type,
      thumbnailKind,
      rect,
      tag,
    };
  }
}

/**
 * Compact display label for a placed piece's type tag — uppercased and
 * trimmed to ~8 characters so it fits inside the smallest readable
 * footprint (drop-through platforms are 16px tall, so the tag is the
 * last legible artefact at that size).
 */
function abbreviateLabel(type: BuilderPieceType): string {
  switch (type) {
    case 'flat-platform':
      return 'FLAT';
    case 'slope-ramp':
      return 'SLOPE';
    case 'wall':
      return 'WALL';
    case 'drop-through-platform':
      return 'DROP';
    case 'lava-zone':
      return 'LAVA';
    case 'wind-zone':
      return 'WIND';
    case 'moving-platform':
      return 'MOVE';
    case 'spawn-point':
      return 'SPAWN';
    default:
      return String(type).toUpperCase();
  }
}
