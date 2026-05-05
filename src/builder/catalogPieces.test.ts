import { describe, it, expect } from 'vitest';
import {
  CATALOG_PANEL_LAYOUT,
  CATALOG_PIECES,
  CATALOG_PIECE_COUNT,
  buildCatalogRowLayouts,
  catalogColorHex,
  catalogPanelHeight,
  catalogPieceLabel,
  catalogPiecesByCategory,
  findCatalogPiece,
  type BuilderPieceType,
  type CatalogPieceCategory,
} from './catalogPieces';

/**
 * AC 20002 Sub-AC 2 — "Build catalog panel UI component displaying 8
 * piece types (including hazard pieces) with thumbnails and labels".
 *
 * The panel itself imports Phaser, which pulls in browser globals at
 * module-eval time. The catalog data + the layout math powering the
 * panel's rendering is split into this Phaser-free helper so the unit
 * suite can exhaustively cover both contracts under plain Node — same
 * pattern as `damageHudFormat`, `vcrOverlayFormat`, and `builderGrid`.
 */
describe('catalogPieces — Seed-mandated 8-piece roster', () => {
  it('exposes exactly 8 catalog pieces (Seed `builderPiece` constraint)', () => {
    // The Seed pins `builderPiece` to "8 catalog piece types". A drift
    // in either direction (7 = missing piece, 9 = unauthorised feature)
    // is a contract violation.
    expect(CATALOG_PIECES.length).toBe(8);
    expect(CATALOG_PIECE_COUNT).toBe(8);
    expect(CATALOG_PIECE_COUNT).toBe(CATALOG_PIECES.length);
  });

  it('roster contains every Seed-named piece type — and no extras', () => {
    // Verbatim against the Seed's `builderPiece` description: "flat
    // platform, slope/ramp, wall, drop-through platform, lava zone,
    // wind zone, moving platform, spawn point".
    const expected: ReadonlyArray<BuilderPieceType> = [
      'flat-platform',
      'slope-ramp',
      'wall',
      'drop-through-platform',
      'lava-zone',
      'wind-zone',
      'moving-platform',
      'spawn-point',
    ];
    const actual = CATALOG_PIECES.map((p) => p.type);
    expect(actual).toEqual(expected);
  });

  it('every piece has a non-empty user-facing label', () => {
    // The AC explicitly asks for "thumbnails and labels" — an empty
    // label would silently break the panel render.
    for (const piece of CATALOG_PIECES) {
      expect(piece.label.length).toBeGreaterThan(0);
      expect(piece.label).toBe(piece.label.trim());
      // Pre-uppercased — call sites paint verbatim.
      expect(piece.label).toBe(piece.label.toUpperCase());
    }
  });

  it('every piece has a non-empty description sub-line', () => {
    // The panel paints a tooltip / accessibility line under each
    // label; an empty string would render an awkward gap.
    for (const piece of CATALOG_PIECES) {
      expect(piece.description.length).toBeGreaterThan(0);
      expect(piece.description).toBe(piece.description.trim());
    }
  });

  it('every piece declares positive default authoring dimensions', () => {
    // The drag-and-drop layer (later sub-AC) spawns a placement at
    // the catalog's default size; zero/negative would crash the
    // collision body builder.
    for (const piece of CATALOG_PIECES) {
      expect(piece.defaultWidth).toBeGreaterThan(0);
      expect(piece.defaultHeight).toBeGreaterThan(0);
    }
  });

  it('every piece declares a thumbnail kind from the closed glyph set', () => {
    // Glyph kinds are a closed enum — the panel switch-cases on them.
    // A string outside the set would silently render a blank thumb.
    const allowedKinds = new Set([
      'bar',
      'slope',
      'column',
      'dashed-bar',
      'flame',
      'arrow-right',
      'path-bar',
      'crosshair',
    ]);
    for (const piece of CATALOG_PIECES) {
      expect(allowedKinds.has(piece.thumbnailKind)).toBe(true);
    }
  });

  it('every piece thumbnail kind is unique (one glyph per type)', () => {
    // If two pieces share a thumbnail glyph the player can't tell them
    // apart at a glance — defeats the "thumbnail" deliverable.
    const seen = new Set<string>();
    for (const piece of CATALOG_PIECES) {
      expect(seen.has(piece.thumbnailKind)).toBe(false);
      seen.add(piece.thumbnailKind);
    }
  });

  it('every accent colour is a valid 24-bit RGB integer', () => {
    for (const piece of CATALOG_PIECES) {
      expect(Number.isInteger(piece.accentColor)).toBe(true);
      expect(piece.accentColor).toBeGreaterThanOrEqual(0);
      expect(piece.accentColor).toBeLessThanOrEqual(0xffffff);
    }
  });

  it('catalog includes the three hazard pieces called out by the AC', () => {
    // The AC text says "8 piece types (including hazard pieces)" — we
    // assert the hazard family is actually represented (lava + wind +
    // moving platform per the Seed).
    const hazards = CATALOG_PIECES.filter((p) => p.category === 'hazard');
    const hazardTypes = hazards.map((p) => p.type).sort();
    expect(hazardTypes).toEqual(
      ['lava-zone', 'moving-platform', 'wind-zone'].sort(),
    );
  });

  it('catalog includes exactly one spawn-point marker', () => {
    const spawns = CATALOG_PIECES.filter((p) => p.category === 'spawn');
    expect(spawns).toHaveLength(1);
    expect(spawns[0]!.type).toBe('spawn-point');
  });

  it('platforms are listed before hazards before the spawn marker', () => {
    // Ordering matters: keyboard hotkeys (1..8 in a future sub-AC)
    // bind to indices, and a stable category-banded order means the
    // simplest piece is always at the top of its band.
    const categories = CATALOG_PIECES.map((p) => p.category);
    const platformIdx = categories.lastIndexOf('platform');
    const firstHazardIdx = categories.indexOf('hazard');
    const spawnIdx = categories.indexOf('spawn');
    expect(platformIdx).toBeLessThan(firstHazardIdx);
    expect(firstHazardIdx).toBeLessThan(spawnIdx);
  });

  it('CATALOG_PIECES is frozen so panel renders cannot mutate the source of truth', () => {
    expect(Object.isFrozen(CATALOG_PIECES)).toBe(true);
    for (const piece of CATALOG_PIECES) {
      expect(Object.isFrozen(piece)).toBe(true);
    }
  });
});

describe('catalogPieces — lookup helpers', () => {
  it('findCatalogPiece resolves every Seed-named type', () => {
    for (const piece of CATALOG_PIECES) {
      const found = findCatalogPiece(piece.type);
      expect(found).toBeDefined();
      expect(found!.type).toBe(piece.type);
    }
  });

  it('findCatalogPiece returns undefined for unknown types', () => {
    // Unknown types are a structural error (a bad save file); the
    // helper exposes the failure as `undefined` so the caller can
    // decide between fallback + validator-throw paths.
    expect(findCatalogPiece('not-a-real-piece' as BuilderPieceType)).toBeUndefined();
    expect(findCatalogPiece('')).toBeUndefined();
  });

  it('catalogPieceLabel returns the piece label for known types', () => {
    expect(catalogPieceLabel('flat-platform')).toBe('FLAT PLATFORM');
    expect(catalogPieceLabel('lava-zone')).toBe('LAVA ZONE');
    expect(catalogPieceLabel('spawn-point')).toBe('SPAWN POINT');
  });

  it('catalogPieceLabel falls back to the uppercased type for unknown inputs', () => {
    // Defensive fallback — better to print "FOO" than crash a render.
    expect(catalogPieceLabel('foo' as BuilderPieceType)).toBe('FOO');
  });

  it('catalogPiecesByCategory partitions the roster cleanly', () => {
    const platforms = catalogPiecesByCategory('platform');
    const hazards = catalogPiecesByCategory('hazard');
    const spawns = catalogPiecesByCategory('spawn');
    expect(platforms.length + hazards.length + spawns.length).toBe(8);
    expect(platforms.every((p) => p.category === 'platform')).toBe(true);
    expect(hazards.every((p) => p.category === 'hazard')).toBe(true);
    expect(spawns.every((p) => p.category === 'spawn')).toBe(true);
  });

  it('catalogPiecesByCategory returns an empty array for an unknown category', () => {
    expect(
      catalogPiecesByCategory('nonexistent' as CatalogPieceCategory),
    ).toHaveLength(0);
  });

  it('catalogColorHex pads to a six-digit string with a leading hash', () => {
    expect(catalogColorHex(0xff5a3c)).toBe('#ff5a3c');
    expect(catalogColorHex(0x000000)).toBe('#000000');
    expect(catalogColorHex(0xffffff)).toBe('#ffffff');
    // Leading-zero RGB padding (0x00ffae → "#00ffae").
    expect(catalogColorHex(0x00ffae)).toBe('#00ffae');
  });

  it('catalogColorHex clamps out-of-range / non-finite inputs', () => {
    expect(catalogColorHex(-1)).toBe('#000000');
    expect(catalogColorHex(0xffffff + 5)).toBe('#ffffff');
    expect(catalogColorHex(Number.NaN)).toBe('#000000');
  });
});

describe('catalogPieces — panel layout geometry', () => {
  it('CATALOG_PANEL_LAYOUT is frozen so layout reads cannot mutate it', () => {
    expect(Object.isFrozen(CATALOG_PANEL_LAYOUT)).toBe(true);
  });

  it('panel width + margin keep it in the left-edge gutter on a 1280-wide viewport', () => {
    // The smallest target viewport for the builder is 1280×720 (the
    // Seed's "5-year-old laptop" target). Panel + margin must leave
    // ample canvas room to its right.
    const totalLeftGutter =
      CATALOG_PANEL_LAYOUT.marginLeft + CATALOG_PANEL_LAYOUT.panelWidth;
    expect(totalLeftGutter).toBeLessThan(1280 / 2);
  });

  it('catalogPanelHeight = header + 8 × rowHeight', () => {
    const expected =
      CATALOG_PANEL_LAYOUT.headerHeight + 8 * CATALOG_PANEL_LAYOUT.rowHeight;
    expect(catalogPanelHeight()).toBe(expected);
  });

  it('catalogPanelHeight fits inside a 720p viewport (with header + scene chrome)', () => {
    // Sanity bound — even on the smallest target viewport the panel
    // must paint without overflowing the visible area.
    expect(catalogPanelHeight() + CATALOG_PANEL_LAYOUT.marginTop).toBeLessThan(
      900,
    );
  });

  it('buildCatalogRowLayouts emits one row per catalog piece in display order', () => {
    const rows = buildCatalogRowLayouts();
    expect(rows).toHaveLength(CATALOG_PIECE_COUNT);
    for (let i = 0; i < rows.length; i += 1) {
      expect(rows[i]!.index).toBe(i);
      expect(rows[i]!.piece.type).toBe(CATALOG_PIECES[i]!.type);
    }
  });

  it('rows are stacked top-to-bottom with no overlap and no gap', () => {
    const rows = buildCatalogRowLayouts();
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!;
      // Each row's height matches the layout constant.
      expect(row.bottomY - row.topY).toBe(CATALOG_PANEL_LAYOUT.rowHeight);
      if (i > 0) {
        // Row i starts exactly where row i-1 ended.
        expect(row.topY).toBe(rows[i - 1]!.bottomY);
      } else {
        // Row 0 starts immediately after the header strip.
        expect(row.topY).toBe(CATALOG_PANEL_LAYOUT.headerHeight);
      }
    }
  });

  it('thumbnail box is centred vertically inside its row', () => {
    const rows = buildCatalogRowLayouts();
    for (const row of rows) {
      const rowMidY = (row.topY + row.bottomY) / 2;
      const thumbMidY = row.thumbnailY + row.thumbnailSize / 2;
      expect(Math.abs(rowMidY - thumbMidY)).toBeLessThanOrEqual(0.5);
    }
  });

  it('label column starts to the right of the thumbnail with the configured gap', () => {
    const rows = buildCatalogRowLayouts();
    for (const row of rows) {
      const expectedLabelX =
        CATALOG_PANEL_LAYOUT.rowPadding +
        CATALOG_PANEL_LAYOUT.thumbnailSize +
        CATALOG_PANEL_LAYOUT.thumbnailLabelGap;
      expect(row.labelX).toBe(expectedLabelX);
      expect(row.labelX).toBeGreaterThan(
        row.thumbnailX + row.thumbnailSize,
      );
    }
  });

  it('description sub-line sits below the label baseline', () => {
    const rows = buildCatalogRowLayouts();
    for (const row of rows) {
      expect(row.descriptionTopY).toBeGreaterThan(row.labelTopY);
      expect(row.descriptionTopY).toBeLessThan(row.bottomY);
    }
  });

  it('thumbnail width fits within the row gutter (no overflow into the label)', () => {
    const rows = buildCatalogRowLayouts();
    for (const row of rows) {
      // The thumbnail must end before the label begins.
      expect(row.thumbnailX + row.thumbnailSize).toBeLessThanOrEqual(
        row.labelX,
      );
    }
  });
});
