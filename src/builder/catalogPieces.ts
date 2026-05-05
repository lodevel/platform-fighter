/**
 * Phaser-free piece catalog for the M3 stage builder.
 *
 * AC 20002 Sub-AC 2 — "Build catalog panel UI component displaying 8
 * piece types (including hazard pieces) with thumbnails and labels".
 *
 * The Seed's `builderPiece` ontology entry pins the catalog to exactly
 * eight piece types:
 *
 *     1. flat platform
 *     2. slope / ramp
 *     3. wall
 *     4. drop-through platform
 *     5. lava zone        (hazard)
 *     6. wind zone        (hazard)
 *     7. moving platform  (hazard, path-driven)
 *     8. spawn point
 *
 * This module is the single source of truth for that catalog. It owns:
 *
 *   • The `BuilderPieceType` string-literal union — the stable identity
 *     each piece is referenced by from save files, replay records, hit
 *     tests, and the future drag-and-drop layer.
 *
 *   • The `CATALOG_PIECES` ordered array — one entry per piece type, with
 *     the user-facing label, the catalog category (platform / hazard /
 *     spawn), the default authored size, the thumbnail glyph the panel
 *     UI paints, and the colour ramp the renderer uses.
 *
 *   • Pure helpers that the catalog panel and (later) the validator
 *     consume — `findCatalogPiece()`, `catalogPieceLabel()`, layout
 *     math, etc.
 *
 * Why Phaser-free
 * ---------------
 *
 * Per the project's `code_architecture` principle, scenes stay thin and
 * gameplay-adjacent helpers stay testable under plain Node. Pulling
 * this module Phaser-free means the unit test suite drives the catalog
 * contract (label text, ordering, thumbnail glyph picks) without booting
 * jsdom — same strategy as `damageHudFormat`, `vcrOverlayFormat`,
 * `builderGrid`, etc.
 *
 * Determinism note: every helper here is a pure function of its
 * arguments. The catalog itself is a frozen module-level constant — no
 * mutation, no `Math.random()`, no wall-clock reads. A replay that
 * records "player picked piece <id> from the catalog" can re-derive the
 * piece's geometry and tint byte-identically.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Stable identity for each catalog piece. The eight values mirror the
 * Seed's `builderPiece` enumeration verbatim.
 *
 *   - `flat-platform`        : solid floor segment, full collision.
 *   - `slope-ramp`           : 45° angled surface for ramp transitions.
 *   - `wall`                 : tall thin solid; vertical level boundary.
 *   - `drop-through-platform`: thin one-way platform (down+jump = drop).
 *   - `lava-zone`            : rising/falling instant-KO hazard column
 *                              (mirrors {@link LavaHazard}).
 *   - `wind-zone`            : directional force field — pushes fighters.
 *   - `moving-platform`      : path-driven moving solid (hazard category
 *                              in the builder because timing matters).
 *   - `spawn-point`          : authoring marker — at simulation time it's
 *                              consumed by the spawn-point allocator and
 *                              has no geometry / collision.
 */
export type BuilderPieceType =
  | 'flat-platform'
  | 'slope-ramp'
  | 'wall'
  | 'drop-through-platform'
  | 'lava-zone'
  | 'wind-zone'
  | 'moving-platform'
  | 'spawn-point';

/**
 * High-level grouping the panel uses to colour-code / band the catalog.
 * Players recognise a hazard tile from a platform tile at a glance even
 * before reading the label.
 */
export type CatalogPieceCategory = 'platform' | 'hazard' | 'spawn';

/**
 * Glyph kind painted into the thumbnail rectangle. The catalog panel
 * does not render bitmap art (the M3 sprite budget is spoken for by the
 * fighters); instead each thumbnail is a small abstract shape that
 * unambiguously communicates the piece's role.
 *
 *   - `bar`         : horizontal solid rectangle (flat-platform).
 *   - `slope`       : right-triangle filling the thumbnail (slope-ramp).
 *   - `column`      : tall vertical solid (wall).
 *   - `dashed-bar`  : horizontal bar drawn with a dashed top edge to
 *                     read as "you can pass through this from below"
 *                     (drop-through-platform).
 *   - `flame`       : stylised flame / lava silhouette (lava-zone).
 *   - `arrow-right` : large directional arrow (wind-zone).
 *   - `path-bar`    : bar with a dotted path stroke under it
 *                     (moving-platform).
 *   - `crosshair`   : crosshair / plus mark (spawn-point).
 */
export type CatalogThumbnailKind =
  | 'bar'
  | 'slope'
  | 'column'
  | 'dashed-bar'
  | 'flame'
  | 'arrow-right'
  | 'path-bar'
  | 'crosshair';

/**
 * Per-piece catalog record. Hex literals (no `#`) so they pass straight
 * into Phaser's `lineStyle` / `Rectangle` ctors when the panel paints
 * the thumbnail.
 */
export interface CatalogPiece {
  /** Stable identity. Use this when serialising piece placements. */
  readonly type: BuilderPieceType;
  /** User-facing display label. Pre-uppercased so the panel can paint
   *  it verbatim without each call site shouting at the API. */
  readonly label: string;
  /** Tooltip / accessibility description — one short sentence. */
  readonly description: string;
  /** Grouping band on the panel. */
  readonly category: CatalogPieceCategory;
  /** Default authored width in design pixels. Used by drag-spawn. */
  readonly defaultWidth: number;
  /** Default authored height in design pixels. */
  readonly defaultHeight: number;
  /** Abstract shape painted into the thumbnail rectangle. */
  readonly thumbnailKind: CatalogThumbnailKind;
  /** Primary fill / outline colour (0xRRGGBB). */
  readonly accentColor: number;
}

// ---------------------------------------------------------------------------
// Catalog data
// ---------------------------------------------------------------------------

/**
 * The eight catalog pieces in panel-display order. Order matters — the
 * panel paints them top-to-bottom, and a stable order means the
 * keyboard-navigation hotkeys (future sub-AC) bind cleanly to indices
 * 1..8.
 *
 * Grouping rationale: platforms first (the bulk of any stage), hazards
 * next (the M2 hazard family), spawn last (a single utility marker).
 * Within each band we keep the simplest piece at the top of the band so
 * a first-time player sees `flat platform` and `lava zone` before the
 * more specialised variants.
 *
 * Default dimensions follow the built-in stages' authoring patterns:
 *
 *   • Platform pieces default to 160 × 40 px (the typical pass-through
 *     ledge width on the four built-in stages).
 *   • Wall defaults to 40 × 240 px — same 40px thickness, taller silhouette.
 *   • Slope ramp defaults to 160 × 80 px so the 45° face is visible.
 *   • Hazards default to 200 × 80 px (lava / wind / moving) — large enough
 *     that the placed piece reads as "a zone" rather than a stray tile.
 *   • Spawn point is a 40 × 40 px marker — the simulation only reads its
 *     centre coordinate, but the visual marker fills one grid cell so the
 *     player can see + delete it.
 */
export const CATALOG_PIECES: ReadonlyArray<CatalogPiece> = Object.freeze([
  Object.freeze({
    type: 'flat-platform',
    label: 'FLAT PLATFORM',
    description: 'Solid floor segment. The basic building block.',
    category: 'platform',
    defaultWidth: 160,
    defaultHeight: 40,
    thumbnailKind: 'bar',
    accentColor: 0x6cf0c2,
  }),
  Object.freeze({
    type: 'slope-ramp',
    label: 'SLOPE / RAMP',
    description: 'Angled surface for ramp transitions.',
    category: 'platform',
    defaultWidth: 160,
    defaultHeight: 80,
    thumbnailKind: 'slope',
    accentColor: 0x6cf0c2,
  }),
  Object.freeze({
    type: 'wall',
    label: 'WALL',
    description: 'Tall vertical solid; level boundary.',
    category: 'platform',
    defaultWidth: 40,
    defaultHeight: 240,
    thumbnailKind: 'column',
    accentColor: 0x6cf0c2,
  }),
  Object.freeze({
    type: 'drop-through-platform',
    label: 'DROP-THROUGH PLATFORM',
    description: 'One-way platform; press down + jump to drop through.',
    category: 'platform',
    defaultWidth: 160,
    defaultHeight: 16,
    thumbnailKind: 'dashed-bar',
    accentColor: 0x9adfff,
  }),
  Object.freeze({
    type: 'lava-zone',
    label: 'LAVA ZONE',
    description: 'Rising/falling lava column. Instant KO on contact.',
    category: 'hazard',
    defaultWidth: 200,
    defaultHeight: 80,
    thumbnailKind: 'flame',
    accentColor: 0xff5a3c,
  }),
  Object.freeze({
    type: 'wind-zone',
    label: 'WIND ZONE',
    description: 'Directional force field. Pushes fighters along the arrow.',
    category: 'hazard',
    defaultWidth: 200,
    defaultHeight: 80,
    thumbnailKind: 'arrow-right',
    accentColor: 0xa6c8ff,
  }),
  Object.freeze({
    type: 'moving-platform',
    label: 'MOVING PLATFORM',
    description: 'Path-driven moving solid. Solid surface that travels.',
    category: 'hazard',
    defaultWidth: 160,
    defaultHeight: 40,
    thumbnailKind: 'path-bar',
    accentColor: 0xffd166,
  }),
  Object.freeze({
    type: 'spawn-point',
    label: 'SPAWN POINT',
    description: 'Player spawn marker. Place one per slot you support.',
    category: 'spawn',
    defaultWidth: 40,
    defaultHeight: 40,
    thumbnailKind: 'crosshair',
    accentColor: 0xffe066,
  }),
] satisfies ReadonlyArray<CatalogPiece>);

/**
 * The Seed's "exactly 8 piece types" hard constraint, frozen as an
 * exported number so the test suite + validator both reference one
 * source of truth instead of magic-number-comparing.
 */
export const CATALOG_PIECE_COUNT = 8;

// ---------------------------------------------------------------------------
// Catalog panel layout — pure geometry the Phaser host turns into
// rectangles + texts. Lives here so the unit suite can drive every
// branch under plain Node.
// ---------------------------------------------------------------------------

/**
 * Static layout tuning for the catalog panel. Sized for a 1920×1080
 * design viewport: 240 px panel pinned to the left edge with eight
 * 96-px-tall rows (96 × 8 = 768) plus a 64-px header — fits in the
 * top half of the viewport even on a 720p display.
 *
 * `Object.freeze` so a caller that mutates it doesn't accidentally
 * reshape every other consumer's panel.
 */
export const CATALOG_PANEL_LAYOUT = Object.freeze({
  /** Panel width in design pixels. */
  panelWidth: 240,
  /** Pixels from the left edge of the viewport to the panel. */
  marginLeft: 16,
  /** Pixels from the top edge of the viewport to the panel header. */
  marginTop: 80,
  /** Header strip height in design pixels. */
  headerHeight: 40,
  /** Per-piece row height in design pixels. */
  rowHeight: 92,
  /** Inner padding inside each row (around the thumbnail + label). */
  rowPadding: 12,
  /** Thumbnail box edge length in design pixels. */
  thumbnailSize: 60,
  /** Pixels of gap between the thumbnail and the label column. */
  thumbnailLabelGap: 12,
});

/**
 * Layout-derived geometry for one row in the catalog panel.
 *
 *   • `index` — 0-based row index (0..7).
 *   • `topY` / `bottomY` — panel-relative Y coordinates for the row's
 *     top / bottom edges.
 *   • `thumbnail{X,Y,Size}` — top-left corner + edge length of the
 *     thumbnail rectangle.
 *   • `labelX` / `labelTopY` — top-left of the label text block.
 *   • `descriptionTopY` — Y coordinate of the description sub-line, or
 *     `null` if the description is omitted (rows always include one in
 *     v1 — null is reserved for future "compact mode" tests).
 */
export interface CatalogRowLayout {
  readonly index: number;
  readonly piece: CatalogPiece;
  readonly topY: number;
  readonly bottomY: number;
  readonly thumbnailX: number;
  readonly thumbnailY: number;
  readonly thumbnailSize: number;
  readonly labelX: number;
  readonly labelTopY: number;
  readonly descriptionTopY: number;
}

/**
 * Total panel height (header + 8 rows). Convenient constant for the
 * scene to use when sizing the panel background rectangle.
 */
export function catalogPanelHeight(
  layout: typeof CATALOG_PANEL_LAYOUT = CATALOG_PANEL_LAYOUT,
): number {
  return layout.headerHeight + layout.rowHeight * CATALOG_PIECE_COUNT;
}

/**
 * Build the row-by-row layout for the panel. Returned in display order
 * (matching {@link CATALOG_PIECES}). Each row's coordinates are in
 * panel-relative space — the scene translates by the panel's top-left
 * world position when rendering.
 */
export function buildCatalogRowLayouts(
  layout: typeof CATALOG_PANEL_LAYOUT = CATALOG_PANEL_LAYOUT,
): ReadonlyArray<CatalogRowLayout> {
  const rows: CatalogRowLayout[] = [];
  for (let i = 0; i < CATALOG_PIECES.length; i += 1) {
    const piece = CATALOG_PIECES[i]!;
    const topY = layout.headerHeight + i * layout.rowHeight;
    const bottomY = topY + layout.rowHeight;
    const thumbnailX = layout.rowPadding;
    const thumbnailY =
      topY + (layout.rowHeight - layout.thumbnailSize) / 2;
    const labelX =
      layout.rowPadding + layout.thumbnailSize + layout.thumbnailLabelGap;
    // Label sits in the upper-half of the row; the description sits
    // directly below so a quick glance shows both without reading.
    const labelTopY = topY + layout.rowPadding + 4;
    const descriptionTopY = labelTopY + 22;
    rows.push({
      index: i,
      piece,
      topY,
      bottomY,
      thumbnailX,
      thumbnailY,
      thumbnailSize: layout.thumbnailSize,
      labelX,
      labelTopY,
      descriptionTopY,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Find a catalog piece by its stable type identity. Returns `undefined`
 * for unknown types so the caller can decide between "fall back to
 * default" and "throw a save-time validator error".
 */
export function findCatalogPiece(
  type: BuilderPieceType | string,
): CatalogPiece | undefined {
  for (const piece of CATALOG_PIECES) {
    if (piece.type === type) return piece;
  }
  return undefined;
}

/**
 * Convenience accessor for the user-facing label. Returns the piece
 * type itself (verbatim, uppercased) as a defensive fallback if the
 * type is unknown — better to print "FOO" than crash a UI render.
 */
export function catalogPieceLabel(type: BuilderPieceType | string): string {
  const piece = findCatalogPiece(type);
  if (piece) return piece.label;
  return String(type).toUpperCase();
}

/**
 * Phaser uses `'#rrggbb'` strings for `Phaser.GameObjects.Text` colours
 * and 0xRRGGBB integers for tints. The panel sets both, so we expose a
 * converter that pads the hex to a six-digit string. Mirrors the
 * `colorIntToHexString` helper used by the damage HUD — re-implemented
 * here (rather than imported) so this module stays a flat
 * single-responsibility unit with no cross-module cross-pollination.
 */
export function catalogColorHex(value: number): string {
  // NaN compares-poorly with everything, so `Math.max / Math.min`
  // happily threads it through to `toString(16)` which yields the
  // literal string `"NaN"` and produces `#000NaN` when padded. Treat
  // it (and any other non-finite input) as the conservative black
  // floor so the panel can never paint a malformed colour.
  if (!Number.isFinite(value)) return '#000000';
  const clamped = Math.max(0, Math.min(0xffffff, Math.trunc(value)));
  return `#${clamped.toString(16).padStart(6, '0')}`;
}

/**
 * Returns the catalog pieces in a stable category-banded order: every
 * platform first, then every hazard, then spawn. Exposed for the future
 * "filter by category" panel toggle and to give the test suite a way to
 * assert ordering independent of the raw `CATALOG_PIECES` index.
 */
export function catalogPiecesByCategory(
  category: CatalogPieceCategory,
): ReadonlyArray<CatalogPiece> {
  return CATALOG_PIECES.filter((p) => p.category === category);
}
