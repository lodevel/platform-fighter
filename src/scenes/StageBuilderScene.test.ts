import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * AC 20001 Sub-AC 1 — "Create StageBuilderScene skeleton with grid
 * canvas rendering (snapping grid lines, coordinate system,
 * background)".
 *
 * `StageBuilderScene` itself imports Phaser, which pulls in browser
 * globals at module-eval time and can't be loaded under plain Node.
 * The grid math it forwards to lives in the Phaser-free
 * `../builder/builderGrid.ts` helper and is fully covered by
 * `builderGrid.test.ts`.
 *
 * This file guards the *wiring* — the static contract that the scene's
 * source text must satisfy for the AC to hold:
 *
 *   1. The scene is registered under the `'StageBuilderScene'` key so
 *      hosts can `scene.start('StageBuilderScene')`.
 *   2. The scene draws a background fill (the AC's "background" word
 *      is a deliverable, not just a prop).
 *   3. The scene uses the helper module's grid-line + coordinate-mark
 *      enumerators so the rendered grid matches the unit-tested
 *      geometry.
 *   4. The scene's cancel path (ESC) returns to `MainMenuScene` so a
 *      player who opens the builder isn't stranded.
 *   5. The scene tears down its grid layer on shutdown so re-entries
 *      don't leak text/graphics objects into the next session.
 *
 * Reading the source as text rather than running it under jsdom keeps
 * the test fast and free of Phaser's browser globals — same strategy
 * as `ResultsScene.test.ts` and `ModeSelectScene.test.ts`.
 */
describe('StageBuilderScene — AC 20001 Sub-AC 1 wiring contract', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './StageBuilderScene.ts'),
    'utf8',
  );

  it('registers under the "StageBuilderScene" scene key', () => {
    // Hosts navigate by string key; if this drifts the scene
    // becomes unreachable from the menu and the AC silently
    // breaks.
    expect(SCENE_SRC).toMatch(/key:\s*['"]StageBuilderScene['"]/);
  });

  it('extends Phaser.Scene', () => {
    expect(SCENE_SRC).toMatch(/class\s+StageBuilderScene\s+extends\s+Phaser\.Scene/);
  });

  it('imports the grid helper module rather than re-deriving the math', () => {
    // The Phaser-free helper is the unit-tested source of truth
    // for snapping + line enumeration. Re-deriving it inline
    // would put scene-rendering math out of sync with the
    // helper's tests.
    expect(SCENE_SRC).toMatch(
      /from\s+['"]\.\.\/builder\/builderGrid['"]/,
    );
    expect(SCENE_SRC).toMatch(/enumerateGridLines/);
    expect(SCENE_SRC).toMatch(/enumerateCoordinateMarks/);
  });

  it('renders a background rectangle (the AC asks for a background)', () => {
    // The AC explicitly calls out "background" as a deliverable.
    // The simplest contract is "the scene adds a rectangle whose
    // colour is the builder's background palette entry".
    expect(SCENE_SRC).toMatch(/this\.add\.rectangle/);
    expect(SCENE_SRC).toMatch(/STAGE_BUILDER_COLORS/);
  });

  it('draws grid lines via Phaser Graphics (lineBetween)', () => {
    // The grid is drawn by a Graphics object batching every line
    // into a single style. `lineBetween` is the canonical Phaser
    // API for endpoint-to-endpoint strokes.
    expect(SCENE_SRC).toMatch(/this\.add\.graphics\(\)/);
    expect(SCENE_SRC).toMatch(/lineBetween/);
  });

  it('emits coordinate-system text marks (origin / axis / ticks)', () => {
    // The AC asks for a "coordinate system". The contract is
    // "the scene draws Text objects from the helper's mark
    // enumeration", so origin + ticks line up with the unit-
    // tested geometry.
    expect(SCENE_SRC).toMatch(/this\.add\s*\.text/);
    expect(SCENE_SRC).toMatch(/CoordinateMark/);
  });

  it('cancel path returns to MainMenuScene on ESC', () => {
    // ESC must not strand the player on the builder. Same shape
    // as ModeSelectScene's cancel path.
    expect(SCENE_SRC).toMatch(/keydown-ESC/);
    expect(SCENE_SRC).toMatch(/scene\.start\(\s*['"]MainMenuScene['"]\s*\)/);
  });

  it('tears down the grid layer on scene shutdown / destroy', () => {
    // Phaser scenes are reused across `scene.start(...)` cycles;
    // not destroying the grid container would leak its child
    // text/graphics objects on every re-entry.
    expect(SCENE_SRC).toMatch(/Phaser\.Scenes\.Events\.SHUTDOWN/);
    expect(SCENE_SRC).toMatch(/Phaser\.Scenes\.Events\.DESTROY/);
    expect(SCENE_SRC).toMatch(/tearDown/);
  });

  it('exports a STAGE_BUILDER_SCENE_KEY constant matching the scene key', () => {
    // Future hotkey wiring (main menu shortcut) navigates by
    // string key; centralising it as an exported constant keeps
    // the menu and the scene in sync without duplicating the
    // literal.
    expect(SCENE_SRC).toMatch(
      /STAGE_BUILDER_SCENE_KEY\s*=\s*['"]StageBuilderScene['"]/,
    );
  });

  it('exposes a colour palette + depth ordering for future sub-ACs to extend', () => {
    // Sub-ACs 2+ (catalog, piece preview) layer on top of the
    // grid; pinning the depth constants here means those layers
    // can opt in without re-inventing the z-order scheme.
    expect(SCENE_SRC).toMatch(/STAGE_BUILDER_DEPTHS/);
    expect(SCENE_SRC).toMatch(/STAGE_BUILDER_GRID/);
  });
});

describe('StageBuilderScene — AC 20001 Sub-AC 1 lifecycle + base layout regions', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './StageBuilderScene.ts'),
    'utf8',
  );

  it('declares both an init() and a create() lifecycle method', () => {
    // Phaser's documented scene lifecycle is init → preload → create.
    // Sub-AC 1 specifically calls for both `init` and `create` so the
    // scene partitions "compute layout state" from "build GameObjects".
    expect(SCENE_SRC).toMatch(/\binit\(\)\s*:\s*void\s*\{/);
    expect(SCENE_SRC).toMatch(/\bcreate\(\)\s*:\s*void\s*\{/);
  });

  it('exposes a layout-regions snapshot covering catalog panel + canvas area', () => {
    // The AC asks for "base layout regions for catalog panel and
    // canvas area". The contract is "the scene exposes a typed
    // snapshot containing both rectangles".
    expect(SCENE_SRC).toMatch(/getLayoutRegions\(\)/);
    expect(SCENE_SRC).toMatch(/StageBuilderLayoutRegions/);
    expect(SCENE_SRC).toMatch(/catalogPanel:\s*\{/);
    expect(SCENE_SRC).toMatch(/canvasArea:\s*\{/);
  });

  it('exports a typed rect contract for the layout regions', () => {
    // Future sub-ACs (drag/drop, save dialogs) consume the rects;
    // pinning the type as an export keeps callers in sync without
    // re-deriving the shape.
    expect(SCENE_SRC).toMatch(/export\s+interface\s+StageBuilderLayoutRect/);
    expect(SCENE_SRC).toMatch(/export\s+interface\s+StageBuilderLayoutRegions/);
  });

  it('init() resets per-instance layout regions on scene re-entry', () => {
    // Phaser keeps Scene instances around across `scene.start(...)`
    // calls, so init() has to wipe any state left from the previous
    // session — otherwise re-entering the builder shows stale
    // regions from the prior viewport size.
    expect(SCENE_SRC).toMatch(/this\.layoutRegions\s*=\s*this\.computeLayoutRegions\(\)/);
  });

  it('teardown clears the layout regions so "scene not active" is detectable', () => {
    // Same pattern as the catalog-panel + grid-layer teardown:
    // null out the field so getLayoutRegions() returns null between
    // sessions.
    expect(SCENE_SRC).toMatch(/this\.layoutRegions\s*=\s*null/);
  });
});

describe('StageBuilderScene — AC 20002 Sub-AC 2 catalog panel wiring', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './StageBuilderScene.ts'),
    'utf8',
  );

  it('imports the CatalogPanel from the builder module', () => {
    // The catalog panel paints the eight Seed-mandated piece types;
    // not importing it leaves the scene without the AC 20002 Sub-AC
    // 2 deliverable.
    expect(SCENE_SRC).toMatch(
      /import\s*\{\s*CatalogPanel\s*\}\s*from\s*['"]\.\.\/builder\/CatalogPanel['"]/,
    );
  });

  it('instantiates a CatalogPanel during create()', () => {
    expect(SCENE_SRC).toMatch(/new\s+CatalogPanel\s*\(/);
  });

  it('mounts the panel at the dedicated catalog depth (above grid, below chrome)', () => {
    // The catalog must occlude the grid behind it but stay below
    // future modal scene chrome — the depth ladder is the contract.
    expect(SCENE_SRC).toMatch(/catalog:\s*\d+/);
    expect(SCENE_SRC).toMatch(/STAGE_BUILDER_DEPTHS\.catalog/);
  });

  it('tears the panel down on shutdown so re-entries do not leak GameObjects', () => {
    // Phaser scenes are reused across `scene.start(...)` cycles;
    // not destroying the panel would leak its 30+ child GameObjects
    // on every re-entry to the builder.
    expect(SCENE_SRC).toMatch(/this\.catalogPanel\s*=\s*null/);
    expect(SCENE_SRC).toMatch(/this\.catalogPanel\.destroy\(\)/);
  });

  it('exposes a getter for the catalog panel so future sub-ACs can read row hit-rects', () => {
    expect(SCENE_SRC).toMatch(/getCatalogPanel\(\)/);
  });
});

describe('StageBuilderScene — AC 20101 Sub-AC 1 drag-drop + ghost wiring', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './StageBuilderScene.ts'),
    'utf8',
  );

  it('imports the DragDropController + GhostPreview from the builder module', () => {
    expect(SCENE_SRC).toMatch(
      /import\s*\{\s*DragDropController\s*\}\s*from\s*['"]\.\.\/builder\/dragDrop['"]/,
    );
    expect(SCENE_SRC).toMatch(
      /import\s*\{\s*GhostPreview\s*\}\s*from\s*['"]\.\.\/builder\/GhostPreview['"]/,
    );
  });

  it('instantiates a DragDropController seeded with the catalog hit-rects', () => {
    // Drag initiation requires the controller to know which catalog
    // rows are pickable; without `getRowHitRects()` the controller
    // can never transition out of idle.
    expect(SCENE_SRC).toMatch(/new\s+DragDropController\s*\(/);
    expect(SCENE_SRC).toMatch(/catalogHitRects:\s*this\.catalogPanel\.getRowHitRects\(\)/);
  });

  it('instantiates a GhostPreview at the dedicated ghost depth tier', () => {
    expect(SCENE_SRC).toMatch(/new\s+GhostPreview\s*\(/);
    expect(SCENE_SRC).toMatch(/STAGE_BUILDER_DEPTHS\.ghost/);
    expect(SCENE_SRC).toMatch(/ghost:\s*\d+/);
  });

  it('wires pointerdown to start a drag and update the ghost preview', () => {
    // Drag initiation: pointer-down on a catalog row picks up the
    // matching piece. The scene forwards the event to the controller
    // and re-paints the ghost from the new state.
    expect(SCENE_SRC).toMatch(/Phaser\.Input\.Events\.POINTER_DOWN/);
    expect(SCENE_SRC).toMatch(/this\.dragDrop\?\.pointerDown/);
    expect(SCENE_SRC).toMatch(/this\.ghostPreview\?\.update/);
  });

  it('wires pointermove to update the ghost preview state', () => {
    expect(SCENE_SRC).toMatch(/this\.dragDrop\?\.pointerMove/);
  });

  it('wires pointerup to clear the ghost preview', () => {
    expect(SCENE_SRC).toMatch(/Phaser\.Input\.Events\.POINTER_UP/);
    expect(SCENE_SRC).toMatch(/this\.ghostPreview\?\.clear/);
  });

  it('ESC cancels an in-flight drag instead of leaving the scene', () => {
    // ESC was previously a single "back to menu" hotkey; with drag
    // active it must cancel the drag first so a player can bail out
    // of a placement without leaving the builder entirely.
    expect(SCENE_SRC).toMatch(/this\.dragDrop\.cancel\(\)/);
    expect(SCENE_SRC).toMatch(/getPhase\(\)\s*===\s*['"]dragging['"]/);
  });

  it('tears down the drag-drop controller + ghost on shutdown', () => {
    // Without teardown, re-entering the builder would leak the ghost's
    // pre-allocated GameObjects + leave a stale controller pointing at
    // dead catalog rects.
    expect(SCENE_SRC).toMatch(/this\.dragDrop\s*=\s*null/);
    expect(SCENE_SRC).toMatch(/this\.ghostPreview\.destroy\(\)/);
    expect(SCENE_SRC).toMatch(/this\.ghostPreview\s*=\s*null/);
  });

  it('exposes getter seams for tests + future sub-ACs', () => {
    expect(SCENE_SRC).toMatch(/getDragDrop\(\)/);
    expect(SCENE_SRC).toMatch(/getGhostPreview\(\)/);
  });

  it('mirrors the catalog selection when a piece is picked up', () => {
    // Visual feedback contract: when the controller transitions
    // idle → dragging the panel should highlight the picked row so the
    // player has redundant "this is what I am carrying" feedback.
    expect(SCENE_SRC).toMatch(/this\.catalogPanel\?\.setSelected/);
    expect(SCENE_SRC).toMatch(/this\.catalogPanel\?\.clearSelection\(\)/);
  });
});

describe('builder barrel — re-exports the drag/drop + ghost surface', () => {
  it('exports the DragDropController + GhostPreview from src/builder/index.ts', () => {
    const barrel = readFileSync(
      resolve(__dirname, '../builder/index.ts'),
      'utf8',
    );
    expect(barrel).toMatch(/DragDropController/);
    expect(barrel).toMatch(/GhostPreview/);
    expect(barrel).toMatch(/GHOST_PREVIEW_COLORS/);
  });
});

describe('StageBuilderScene — AC 20102 Sub-AC 2 placement commit + registry wiring', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './StageBuilderScene.ts'),
    'utf8',
  );

  it('imports the StageDataModel + PlacedPieceRenderer from the builder module', () => {
    // The data model is the canonical registry the drag-drop pipeline
    // routes successful drops into; the renderer paints one rectangle
    // per registered piece. Without these the placement commit path
    // has nowhere to land and the scene silently drops the
    // controller's placed-piece payload.
    expect(SCENE_SRC).toMatch(
      /import\s*\{[^}]*PlacedPieceRenderer[^}]*\}\s*from\s*['"]\.\.\/builder\/PlacedPieceRenderer['"]/,
    );
    expect(SCENE_SRC).toMatch(
      /import\s*\{[^}]*StageDataModel[^}]*\}\s*from\s*['"]\.\.\/builder\/stageDataModel['"]/,
    );
  });

  it('instantiates a StageDataModel during create()', () => {
    expect(SCENE_SRC).toMatch(/new\s+StageDataModel\s*\(/);
    // The model must be seeded with the active grid spec so its
    // canvas-bounds re-validation matches what the drag-drop layer
    // produced.
    expect(SCENE_SRC).toMatch(/gridSpec:\s*this\.gridSpec/);
  });

  it('instantiates a PlacedPieceRenderer at the dedicated placed-piece depth tier', () => {
    expect(SCENE_SRC).toMatch(/new\s+PlacedPieceRenderer\s*\(/);
    expect(SCENE_SRC).toMatch(/placedPiece:\s*\d+/);
    expect(SCENE_SRC).toMatch(/STAGE_BUILDER_DEPTHS\.placedPiece/);
  });

  it('subscribes the renderer to the data model so a single mutation drives a single repaint', () => {
    // The model exposes `addListener(...)`; the scene wires the
    // renderer's `repaint(...)` into that callback so every
    // successful add / remove / clear updates the canvas exactly once.
    expect(SCENE_SRC).toMatch(/this\.stageData\.addListener/);
    expect(SCENE_SRC).toMatch(/this\.placedPieceRenderer\?\.repaint/);
  });

  it('routes the controller pointerUp payload into stageData.addPiece', () => {
    // The previous Sub-AC discarded the placement payload. Sub-AC 2
    // commits it: pointerUp returns a PlacedPiece (or null) and the
    // scene forwards it to the registry.
    expect(SCENE_SRC).toMatch(/dragDrop\?\.pointerUp/);
    expect(SCENE_SRC).toMatch(/this\.stageData\.addPiece\(placed\)/);
  });

  it('paints a live count HUD line that reads from the data model', () => {
    // The Seed caps custom stages at 30 pieces. The HUD makes that cap
    // legible to the player at every drop.
    expect(SCENE_SRC).toMatch(/placedCountHud/);
    expect(SCENE_SRC).toMatch(/formatPlacedCountLabel/);
  });

  it('tears down the data-model listener + renderer on shutdown', () => {
    // Without teardown a re-entered builder would leak the prior
    // session's listener (the closure captures the old renderer +
    // count HUD GameObjects, both of which are destroyed at teardown).
    expect(SCENE_SRC).toMatch(/this\.stageDataUnsubscribe\(\)/);
    expect(SCENE_SRC).toMatch(/this\.placedPieceRenderer\.destroy\(\)/);
    expect(SCENE_SRC).toMatch(/this\.placedCountHud\.destroy\(\)/);
    expect(SCENE_SRC).toMatch(/this\.stageData\s*=\s*null/);
  });

  it('exposes getter seams for tests + future sub-ACs', () => {
    expect(SCENE_SRC).toMatch(/getStageData\(\)/);
    expect(SCENE_SRC).toMatch(/getPlacedPieceRenderer\(\)/);
    expect(SCENE_SRC).toMatch(/getPlacedPieces\(\)/);
  });
});

describe('StageBuilderScene — AC 20103 Sub-AC 3 save/load wiring', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './StageBuilderScene.ts'),
    'utf8',
  );

  it('imports the SaveLoadController + SaveLoadDialog from the builder module', () => {
    // The controller owns the state machine + storage calls; the
    // dialog is the Phaser host. Both must be reachable from the
    // scene for the toolbar + modal to render.
    expect(SCENE_SRC).toMatch(
      /import\s*\{\s*SaveLoadController\s*\}\s*from\s*['"]\.\.\/builder\/saveLoadController['"]/,
    );
    expect(SCENE_SRC).toMatch(
      /import\s*\{\s*SaveLoadDialog\s*\}\s*from\s*['"]\.\.\/builder\/SaveLoadDialog['"]/,
    );
  });

  it('imports the toPlacedPieces helper for the load-applied bulk import', () => {
    // The applyLoad hook needs to project a CustomStageData body's
    // pieces back into the PlacedPiece shape the StageDataModel
    // expects on bulk import.
    expect(SCENE_SRC).toMatch(/toPlacedPieces/);
  });

  it('instantiates the SaveLoadController during create()', () => {
    expect(SCENE_SRC).toMatch(/new\s+SaveLoadController\s*\(/);
    // Registry source must read from the live stageData / gridSpec
    // so the saved blob reflects whatever the player has placed.
    expect(SCENE_SRC).toMatch(/getGridSpec:\s*\(\)\s*=>/);
    expect(SCENE_SRC).toMatch(/getPieces:\s*\(\)\s*=>/);
    expect(SCENE_SRC).toMatch(/applyLoad:/);
  });

  it('routes a successful load into stageData.replaceAllPieces', () => {
    // The bulk-import path is what the AC mandates: a successful load
    // populates the canvas with the saved roster, and the validation
    // report is surfaced back through the controller's view so the
    // dialog can show "X of Y pieces accepted".
    expect(SCENE_SRC).toMatch(/this\.stageData\.replaceAllPieces/);
  });

  it('instantiates the SaveLoadDialog host during create()', () => {
    expect(SCENE_SRC).toMatch(/new\s+SaveLoadDialog\s*\(/);
  });

  it('ESC delegates to the dialog when the modal is open', () => {
    // The save/load modal owns Escape while it's open — the scene's
    // drag-cancel + back-to-menu paths only fire when the modal is
    // closed. Without this gate, Escape inside the save name prompt
    // would close the entire builder.
    expect(SCENE_SRC).toMatch(/saveLoadDialog\.isModalOpen\(\)/);
    expect(SCENE_SRC).toMatch(/saveLoadController\?\.cancel/);
  });

  it('tears down the dialog and drops the controller reference on shutdown', () => {
    expect(SCENE_SRC).toMatch(/this\.saveLoadDialog\.destroy\(\)/);
    expect(SCENE_SRC).toMatch(/this\.saveLoadDialog\s*=\s*null/);
    expect(SCENE_SRC).toMatch(/this\.saveLoadController\s*=\s*null/);
  });

  it('exposes getter seams for tests + future sub-ACs', () => {
    expect(SCENE_SRC).toMatch(/getSaveLoadController\(\)/);
    expect(SCENE_SRC).toMatch(/getSaveLoadDialog\(\)/);
  });

  it('reserves a depth tier for the save/load layer that sits above scene chrome', () => {
    expect(SCENE_SRC).toMatch(/saveLoad:\s*\d+/);
  });
});

describe('builder barrel — re-exports the AC 20103 Sub-AC 3 surface', () => {
  it('exports the SaveLoadController + dialog from src/builder/index.ts', () => {
    const barrel = readFileSync(
      resolve(__dirname, '../builder/index.ts'),
      'utf8',
    );
    expect(barrel).toMatch(/SaveLoadController/);
    expect(barrel).toMatch(/SaveLoadDialog/);
    expect(barrel).toMatch(/SAVE_LOAD_DIALOG_COLORS/);
    expect(barrel).toMatch(/validateNameDraft/);
    expect(barrel).toMatch(/describeSaveError/);
    expect(barrel).toMatch(/describeLoadError/);
  });
});

describe('builder barrel — re-exports the AC 20102 Sub-AC 2 surface', () => {
  it('exports the StageDataModel + PlacedPieceRenderer surface from src/builder/index.ts', () => {
    const barrel = readFileSync(
      resolve(__dirname, '../builder/index.ts'),
      'utf8',
    );
    expect(barrel).toMatch(/StageDataModel/);
    expect(barrel).toMatch(/STAGE_PIECE_LIMIT/);
    expect(barrel).toMatch(/RegisteredPiece/);
    expect(barrel).toMatch(/PlacedPieceRenderer/);
    expect(barrel).toMatch(/PLACED_PIECE_COLORS/);
  });
});

describe('formatPlacedCountLabel — Phaser-free HUD format helper', () => {
  // Imported from `stageDataModel.ts` (Phaser-free) and re-exported
  // through the scene for callers that want a single import. The
  // function's runtime contract:
  //   • returns "<count> / <max> PIECES" by default;
  //   • appends " (FULL)" once count >= max so the cap is unmistakable.
  it('formats the standard "n / max PIECES" label', async () => {
    const { formatPlacedCountLabel } = await import('../builder/stageDataModel');
    expect(formatPlacedCountLabel(0, 30)).toBe('0 / 30 PIECES');
    expect(formatPlacedCountLabel(23, 30)).toBe('23 / 30 PIECES');
  });

  it('appends " (FULL)" when the count meets or exceeds the cap', async () => {
    const { formatPlacedCountLabel } = await import('../builder/stageDataModel');
    expect(formatPlacedCountLabel(30, 30)).toBe('30 / 30 PIECES (FULL)');
    expect(formatPlacedCountLabel(31, 30)).toBe('31 / 30 PIECES (FULL)');
  });

  it('clamps non-finite / negative inputs', async () => {
    const { formatPlacedCountLabel } = await import('../builder/stageDataModel');
    expect(formatPlacedCountLabel(Number.NaN, 30)).toBe('0 / 30 PIECES');
    expect(formatPlacedCountLabel(-5, 30)).toBe('0 / 30 PIECES');
    expect(formatPlacedCountLabel(5, Number.NaN)).toBe('5 / 0 PIECES');
  });
});

describe('GameConfig — StageBuilderScene registration', () => {
  it('registers StageBuilderScene in the scene list so hosts can navigate', () => {
    const cfg = readFileSync(
      resolve(__dirname, '../engine/GameConfig.ts'),
      'utf8',
    );
    // Both the import and the SCENES array entry have to exist
    // for Phaser to know about the scene.
    expect(cfg).toMatch(/import\s*\{\s*StageBuilderScene\s*\}/);
    expect(cfg).toMatch(/StageBuilderScene,/);
  });
});

describe('builder barrel — re-exports the grid helper module', () => {
  it('exports the grid helper API from src/builder/index.ts', () => {
    const barrel = readFileSync(
      resolve(__dirname, '../builder/index.ts'),
      'utf8',
    );
    // The barrel is the public surface for builder consumers
    // (the scene + future replay / save tooling). At the very
    // least the canvas-dimension constants and the snap helper
    // need to be reachable through it.
    expect(barrel).toMatch(/builderGrid/);
  });
});
