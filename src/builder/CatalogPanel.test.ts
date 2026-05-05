import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CatalogPanel, CATALOG_PANEL_COLORS } from './CatalogPanel';
import {
  CATALOG_PANEL_LAYOUT,
  CATALOG_PIECES,
  catalogPanelHeight,
} from './catalogPieces';

/**
 * AC 20002 Sub-AC 2 — wiring contract for the catalog panel.
 *
 * The panel itself only `import type Phaser`, so we can construct it
 * under plain Node by handing it a structurally-typed scene shim.
 * That covers the runtime behaviour (one row per piece, hit-rect
 * geometry, idempotent destroy). The static contract — colour
 * palette, render-order constants, default depth — is asserted by
 * reading the source as text.
 */

// ---------------------------------------------------------------------------
// Test scene shim — captures every `add.*` call so tests can assert
// the panel painted the expected GameObjects without booting Phaser.
// ---------------------------------------------------------------------------

interface Captured {
  kind: 'rectangle' | 'text' | 'graphics';
  args: unknown[];
}

function makeStubScene(width = 1920, height = 1080) {
  const captured: Captured[] = [];
  const destroyed: Captured[] = [];

  function rect(): Record<string, unknown> {
    // `visibleState` is a plain field rather than a method-call return
    // so the selection-state tests can read the latest visibility flag
    // any panel write set on this rectangle. Phaser's real Rectangle
    // object also exposes `visible` as a public property so the
    // contract is faithful.
    const obj: Record<string, unknown> = { visible: true };
    obj.setOrigin = () => obj;
    obj.setScrollFactor = () => obj;
    obj.setDepth = () => obj;
    obj.setStrokeStyle = () => obj;
    obj.setVisible = (v: boolean) => {
      obj.visible = v;
      return obj;
    };
    obj.destroy = () => {
      const c = captured.find((x) => x.args.includes(obj));
      // Track in destroyed list via the parent capture entry.
      if (c) destroyed.push(c);
      return undefined;
    };
    return obj;
  }
  function text(): Record<string, (...args: unknown[]) => unknown> {
    const obj: Record<string, (...args: unknown[]) => unknown> = {};
    obj.setOrigin = () => obj;
    obj.setScrollFactor = () => obj;
    obj.setDepth = () => obj;
    obj.setPosition = () => obj;
    obj.destroy = () => undefined;
    return obj;
  }
  function graphics(): Record<string, (...args: unknown[]) => unknown> {
    const obj: Record<string, (...args: unknown[]) => unknown> = {};
    obj.setScrollFactor = () => obj;
    obj.setDepth = () => obj;
    obj.fillStyle = () => obj;
    obj.lineStyle = () => obj;
    obj.fillRect = () => obj;
    obj.strokeRect = () => obj;
    obj.fillTriangle = () => obj;
    obj.fillCircle = () => obj;
    obj.beginPath = () => obj;
    obj.moveTo = () => obj;
    obj.lineTo = () => obj;
    obj.strokePath = () => obj;
    obj.destroy = () => undefined;
    return obj;
  }

  const scene = {
    scale: { gameSize: { width, height } },
    add: {
      rectangle: (...args: unknown[]) => {
        const r = rect();
        captured.push({ kind: 'rectangle', args: [...args, r] });
        return r;
      },
      text: (...args: unknown[]) => {
        const t = text();
        captured.push({ kind: 'text', args: [...args, t] });
        return t;
      },
      graphics: (...args: unknown[]) => {
        const g = graphics();
        captured.push({ kind: 'graphics', args: [...args, g] });
        return g;
      },
    },
  };

  return { scene, captured, destroyed };
}

describe('CatalogPanel — runtime behaviour', () => {
  it('paints one hit-rect row per Seed catalog piece', () => {
    const { scene } = makeStubScene();
    // SAFETY: the stub satisfies the structural type the panel uses.
    const panel = new CatalogPanel(scene as never);

    expect(panel.rowCount()).toBe(CATALOG_PIECES.length);
    expect(panel.getRowHitRects()).toHaveLength(8);
    panel.destroy();
  });

  it('exposes hit-rects in display order with one per piece type', () => {
    const { scene } = makeStubScene();
    const panel = new CatalogPanel(scene as never);

    const rects = panel.getRowHitRects();
    for (let i = 0; i < CATALOG_PIECES.length; i += 1) {
      expect(rects[i]!.index).toBe(i);
      expect(rects[i]!.type).toBe(CATALOG_PIECES[i]!.type);
      expect(rects[i]!.piece.label).toBe(CATALOG_PIECES[i]!.label);
    }
    panel.destroy();
  });

  it('hit-rects stack top-to-bottom inside the panel without overlap', () => {
    const { scene } = makeStubScene();
    const panel = new CatalogPanel(scene as never);
    const rects = panel.getRowHitRects();
    for (let i = 0; i < rects.length - 1; i += 1) {
      const cur = rects[i]!;
      const next = rects[i + 1]!;
      // Each row's height matches the layout constant.
      expect(cur.height).toBe(CATALOG_PANEL_LAYOUT.rowHeight);
      // Next row begins where the current one ends.
      expect(next.y).toBe(cur.y + cur.height);
      // X is constant across rows.
      expect(cur.x).toBe(next.x);
      expect(cur.width).toBe(next.width);
    }
    panel.destroy();
  });

  it('findHitRect returns the matching row by piece type', () => {
    const { scene } = makeStubScene();
    const panel = new CatalogPanel(scene as never);
    for (const piece of CATALOG_PIECES) {
      const hit = panel.findHitRect(piece.type);
      expect(hit).toBeDefined();
      expect(hit!.type).toBe(piece.type);
    }
    expect(panel.findHitRect('not-real' as never)).toBeUndefined();
    panel.destroy();
  });

  it('width / height return the expected layout dimensions', () => {
    const { scene } = makeStubScene();
    const panel = new CatalogPanel(scene as never);
    expect(panel.width()).toBe(CATALOG_PANEL_LAYOUT.panelWidth);
    expect(panel.height()).toBe(catalogPanelHeight());
    panel.destroy();
  });

  it('honours custom origin overrides', () => {
    const { scene } = makeStubScene();
    const panel = new CatalogPanel(scene as never, {
      originX: 500,
      originY: 200,
    });
    const rects = panel.getRowHitRects();
    expect(rects[0]!.x).toBe(500);
    // First row sits below the header strip.
    expect(rects[0]!.y).toBe(200 + CATALOG_PANEL_LAYOUT.headerHeight);
    panel.destroy();
  });

  it('paints a Rectangle background, a header, and a Graphics glyph per piece', () => {
    const { scene, captured } = makeStubScene();
    const panel = new CatalogPanel(scene as never);

    const rectangles = captured.filter((c) => c.kind === 'rectangle');
    const texts = captured.filter((c) => c.kind === 'text');
    const graphics = captured.filter((c) => c.kind === 'graphics');

    // Background + header background = 2 panel-level rectangles. Each
    // row contributes a thumbnail bg + accent strip; all rows except
    // the last add a divider — so the row total is roughly 3 × 8 - 1.
    expect(rectangles.length).toBeGreaterThanOrEqual(2 + 8);
    // Header text + label per row + description per row.
    expect(texts.length).toBeGreaterThanOrEqual(1 + 8 + 8);
    // One thumbnail glyph per piece.
    expect(graphics.length).toBe(CATALOG_PIECES.length);

    panel.destroy();
  });

  it('destroy() is idempotent and releases hit rects', () => {
    const { scene } = makeStubScene();
    const panel = new CatalogPanel(scene as never);
    expect(panel.rowCount()).toBe(8);
    panel.destroy();
    expect(panel.rowCount()).toBe(0);
    // Second call must be a no-op (no throw).
    panel.destroy();
    expect(panel.rowCount()).toBe(0);
  });
});

describe('CatalogPanel — selection state (Sub-AC 2 deliverable)', () => {
  it('starts with no selection', () => {
    const { scene } = makeStubScene();
    const panel = new CatalogPanel(scene as never);
    expect(panel.getSelected()).toBeNull();
    for (const piece of CATALOG_PIECES) {
      expect(panel.isSelected(piece.type)).toBe(false);
    }
    panel.destroy();
  });

  it('setSelected(type) records the active piece and reports a transition', () => {
    const { scene } = makeStubScene();
    const panel = new CatalogPanel(scene as never);
    expect(panel.setSelected('lava-zone')).toBe(true);
    expect(panel.getSelected()).toBe('lava-zone');
    expect(panel.isSelected('lava-zone')).toBe(true);
    expect(panel.isSelected('flat-platform')).toBe(false);
    panel.destroy();
  });

  it('setSelected(sameType) twice is a no-op the second time', () => {
    const { scene } = makeStubScene();
    const panel = new CatalogPanel(scene as never);
    expect(panel.setSelected('wall')).toBe(true);
    expect(panel.setSelected('wall')).toBe(false);
    expect(panel.getSelected()).toBe('wall');
    panel.destroy();
  });

  it('setSelected switches highlight from old row to new row', () => {
    const { scene } = makeStubScene();
    const panel = new CatalogPanel(scene as never);
    panel.setSelected('flat-platform');
    expect(panel.getSelected()).toBe('flat-platform');
    panel.setSelected('wind-zone');
    expect(panel.getSelected()).toBe('wind-zone');
    expect(panel.isSelected('flat-platform')).toBe(false);
    expect(panel.isSelected('wind-zone')).toBe(true);
    panel.destroy();
  });

  it('setSelected ignores unknown piece types so the panel stays consistent', () => {
    const { scene } = makeStubScene();
    const panel = new CatalogPanel(scene as never);
    // SAFETY: we cast to bypass the literal union to test the
    // defensive guard the runtime relies on at the API boundary.
    expect(panel.setSelected('not-real' as never)).toBe(false);
    expect(panel.getSelected()).toBeNull();
    panel.destroy();
  });

  it('clearSelection deselects the active row', () => {
    const { scene } = makeStubScene();
    const panel = new CatalogPanel(scene as never);
    panel.setSelected('moving-platform');
    expect(panel.clearSelection()).toBe(true);
    expect(panel.getSelected()).toBeNull();
    expect(panel.isSelected('moving-platform')).toBe(false);
    // Second call is a no-op.
    expect(panel.clearSelection()).toBe(false);
    panel.destroy();
  });

  it('fires onSelectionChange callback exactly once per real transition', () => {
    const { scene } = makeStubScene();
    const events: Array<string | null> = [];
    const panel = new CatalogPanel(scene as never, {
      onSelectionChange: (type) => events.push(type),
    });
    panel.setSelected('lava-zone');
    panel.setSelected('lava-zone'); // no-op
    panel.setSelected('spawn-point');
    panel.clearSelection();
    panel.clearSelection(); // no-op
    expect(events).toEqual(['lava-zone', 'spawn-point', null]);
    panel.destroy();
  });

  it('paints exactly one selection overlay per row, all initially hidden', () => {
    const { scene, captured } = makeStubScene();
    const panel = new CatalogPanel(scene as never);

    // The selection overlays are the rectangles painted with the
    // selectedOverlayFill colour. There must be exactly one per
    // catalog piece (8 in v1).
    const overlays = captured.filter(
      (c) =>
        c.kind === 'rectangle' &&
        c.args[4] === CATALOG_PANEL_COLORS.selectedOverlayFill,
    );
    expect(overlays).toHaveLength(CATALOG_PIECES.length);
    for (const overlay of overlays) {
      // The captured args list ends with the rect handle (see the
      // shim's `rectangle(...)` wrapper).
      const handle = overlay.args[overlay.args.length - 1] as {
        visible: boolean;
      };
      expect(handle.visible).toBe(false);
    }
    panel.destroy();
  });

  it('shows exactly the selected row\'s overlay and hides the rest', () => {
    const { scene, captured } = makeStubScene();
    const panel = new CatalogPanel(scene as never);

    // Capture each row's overlay handle in the order they were added
    // (matches CATALOG_PIECES order — Sub-AC 1 verifies the panel
    // paints rows top-to-bottom in catalog order).
    const overlayHandles = captured
      .filter(
        (c) =>
          c.kind === 'rectangle' &&
          c.args[4] === CATALOG_PANEL_COLORS.selectedOverlayFill,
      )
      .map((c) => c.args[c.args.length - 1] as { visible: boolean });

    // Pick a non-trivial mid-list row — wind-zone is at index 5.
    const targetIndex = CATALOG_PIECES.findIndex((p) => p.type === 'wind-zone');
    panel.setSelected('wind-zone');
    for (let i = 0; i < overlayHandles.length; i += 1) {
      expect(overlayHandles[i]!.visible).toBe(i === targetIndex);
    }

    panel.clearSelection();
    for (const h of overlayHandles) {
      expect(h.visible).toBe(false);
    }
    panel.destroy();
  });

  it('after destroy() the selection getters return null and setters are inert', () => {
    const { scene } = makeStubScene();
    const panel = new CatalogPanel(scene as never);
    panel.setSelected('flat-platform');
    panel.destroy();
    expect(panel.getSelected()).toBeNull();
    expect(panel.setSelected('flat-platform')).toBe(false);
    expect(panel.clearSelection()).toBe(false);
  });
});

describe('CatalogPanel — wiring contract (text scan)', () => {
  const SRC = readFileSync(
    resolve(__dirname, './CatalogPanel.ts'),
    'utf8',
  );

  it('imports the catalog data + layout helper rather than re-deriving them', () => {
    expect(SRC).toMatch(/from\s+['"]\.\/catalogPieces['"]/);
    expect(SRC).toMatch(/CATALOG_PIECES/);
    expect(SRC).toMatch(/buildCatalogRowLayouts/);
  });

  it('exports a colour palette so future drag-ghosts can mirror it', () => {
    // Mirrors the `STAGE_BUILDER_COLORS` pattern in `StageBuilderScene`.
    expect(SRC).toMatch(/CATALOG_PANEL_COLORS/);
    expect(CATALOG_PANEL_COLORS.panelFill).toBeGreaterThanOrEqual(0);
  });

  it('paints a Phaser rectangle background and graphics-based thumbnails', () => {
    // Source uses chained `.rectangle(...)` / `.text(...)` calls; the
    // multi-line `\s*` lets the regex match across the newline between
    // `this.scene.add` and the chained method call.
    expect(SRC).toMatch(/this\.scene\.add\s*\.\s*rectangle/);
    expect(SRC).toMatch(/this\.scene\.add\s*\.\s*graphics/);
    expect(SRC).toMatch(/this\.scene\.add\s*\.\s*text/);
  });

  it('switch-cases on every CatalogThumbnailKind glyph', () => {
    // The panel is the source of truth for "what does each glyph
    // look like"; if a glyph kind goes unhandled the row would
    // render an empty thumb, defeating the AC's "thumbnails"
    // deliverable.
    const expected = [
      "case 'bar'",
      "case 'slope'",
      "case 'column'",
      "case 'dashed-bar'",
      "case 'flame'",
      "case 'arrow-right'",
      "case 'path-bar'",
      "case 'crosshair'",
    ];
    for (const literal of expected) {
      expect(SRC).toContain(literal);
    }
  });

  it('exposes hit rects so the future drag-and-drop layer can consume them', () => {
    // The drag-and-drop sub-AC (later) reads these to start a drag;
    // pinning the public method name here means that downstream
    // change has a stable target.
    expect(SRC).toMatch(/getRowHitRects/);
    expect(SRC).toMatch(/findHitRect/);
  });

  it('destroy() routes through a single disposables collection (idempotent teardown)', () => {
    expect(SRC).toMatch(/disposables/);
    expect(SRC).toMatch(/destroyed\s*=\s*true/);
  });

  it('exposes a selection-state surface (set/get/clear/isSelected)', () => {
    // The Sub-AC 2 deliverable is "thumbnails, labels, AND selection
    // state" — pin the public API so future sub-ACs (drag/drop,
    // click-to-arm placement) have a stable target to consume.
    expect(SRC).toMatch(/setSelected\s*\(/);
    expect(SRC).toMatch(/getSelected\s*\(/);
    expect(SRC).toMatch(/clearSelection\s*\(/);
    expect(SRC).toMatch(/isSelected\s*\(/);
  });

  it('declares a selection-overlay palette for the highlight visuals', () => {
    expect(SRC).toMatch(/selectedOverlayFill/);
    expect(SRC).toMatch(/selectedBorder/);
  });

  it('paints a selection overlay rectangle hidden by default', () => {
    // The overlay is created during render() and toggled visible by
    // setSelected; if it isn't paintsetVisible(false) the highlight
    // would leak on every fresh row.
    expect(SRC).toMatch(/selectionOverlays/);
    expect(SRC).toMatch(/setVisible\(false\)/);
  });
});
