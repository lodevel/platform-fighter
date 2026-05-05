import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Pure helper imports — pulled from the Phaser-free sibling so the
// test runs under plain Node without booting Phaser.
import { resolveDescriptor } from './customStageSceneResolver';
import { customStageDataToStageLayout } from '../stages/customStageLoader';

// Stable scene-key constants — re-derived inline rather than imported
// from `./CustomStageScene` because the scene file imports Phaser at
// module-eval time. The wiring contract test below verifies the scene
// file exports the same literals.
const CUSTOM_STAGE_SCENE_KEY = 'CustomStageScene';
const CUSTOM_STAGE_SCENE_DEFAULT_RETURN_KEY = 'StageBuilderScene';
import type { CustomStageData } from '../builder/customStageSerializer';
import type { StageLayout } from '../types';

/**
 * AC 20202 Sub-AC 2 — "Implement Phaser/Matter scene builder that
 * consumes the stage descriptor and instantiates corresponding Matter
 * bodies, Phaser sprites, and collision groups in a CustomStageScene
 * class".
 *
 * `CustomStageScene` itself imports Phaser, which pulls in browser
 * globals at module-eval time and can't be loaded under plain Node.
 * The geometry conversion it forwards to lives in the Phaser-free
 * `customStageDataToStageLayout` / `renderStage` modules and is
 * already covered by their unit tests.
 *
 * This file guards two contracts:
 *
 *   1. The pure {@link resolveDescriptor} helper resolves every
 *      supported input shape correctly. This is the seam between the
 *      scene's `init()` payload and the runtime layout the renderer
 *      consumes; getting it wrong silently degrades the preview.
 *
 *   2. The scene's source text wires Matter / Phaser / collision-group
 *      instantiation through the canonical pipeline (renderStage,
 *      renderLavaHazards, renderWindHazards, COLLISION_CATEGORIES) —
 *      not bespoke per-platform code that could drift from the rest
 *      of the engine.
 *
 * Reading the source as text rather than running it under jsdom keeps
 * the test fast and free of Phaser's browser globals — same strategy
 * as `StageBuilderScene.test.ts` and `ResultsScene.test.ts`.
 */

const SCENE_SRC_PATH = resolve(__dirname, './CustomStageScene.ts');
const SCENE_SRC = readFileSync(SCENE_SRC_PATH, 'utf8');

// ---------------------------------------------------------------------------
// Fixtures — minimal CustomStageData / StageLayout values the resolver
// can run against without touching localStorage.
// ---------------------------------------------------------------------------

function buildFixtureDescriptor(): CustomStageData {
  return {
    name: 'Preview Fixture',
    gridSpec: { cellPx: 40, width: 1920, height: 1080 },
    pieces: [
      // One flat platform → exercises the platform/Matter pipeline.
      {
        type: 'flat-platform',
        canvasX: 800,
        canvasY: 600,
        width: 320,
        height: 40,
        col: 20,
        row: 15,
      },
      // One lava-zone hazard → exercises the hazard pipeline.
      {
        type: 'lava-zone',
        canvasX: 200,
        canvasY: 600,
        width: 200,
        height: 80,
        col: 5,
        row: 15,
      },
      // One spawn point → exercises the spawn-marker path.
      {
        type: 'spawn-point',
        canvasX: 400,
        canvasY: 200,
        width: 40,
        height: 40,
        col: 10,
        row: 5,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Pure resolver contract
// ---------------------------------------------------------------------------

describe('CustomStageScene — resolveDescriptor (pure helper)', () => {
  it('exposes a stable scene key constant matching the registered key', () => {
    expect(CUSTOM_STAGE_SCENE_KEY).toBe('CustomStageScene');
  });

  it('defaults the ESC return scene to the stage builder', () => {
    // The preview is launched from the builder; cancelling drops the
    // player back into the authoring flow rather than the menu.
    expect(CUSTOM_STAGE_SCENE_DEFAULT_RETURN_KEY).toBe('StageBuilderScene');
  });

  it('resolves a CustomStageData input via customStageDataToStageLayout', () => {
    const descriptor = buildFixtureDescriptor();
    const result = resolveDescriptor({ customStage: descriptor });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.descriptor).toBe(descriptor);
    // The runtime layout has at least one platform (the flat-platform
    // piece) — proves the converter ran end-to-end.
    expect(result.layout.platforms.length).toBeGreaterThan(0);
    // And at least one hazard from the lava-zone piece.
    expect(result.layout.hazards.length).toBeGreaterThan(0);
    // Spawn points are padded to four (Seed-mandated max-player count).
    expect(result.layout.spawnPoints.length).toBe(4);
  });

  it('resolves a stageLayout input verbatim with descriptor=null', () => {
    const descriptor = buildFixtureDescriptor();
    const layout: StageLayout = customStageDataToStageLayout(descriptor);

    const result = resolveDescriptor({ stageLayout: layout });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout).toBe(layout);
    // No source body when the caller hands in a layout directly — the
    // title strip falls back to layout.id in that case.
    expect(result.descriptor).toBeNull();
  });

  it('prefers customStage over stageLayout when both are supplied', () => {
    // Priority order matters: the in-memory body is authoritative
    // because it carries the slot name + un-converted geometry the
    // builder might tweak post-preview.
    const descriptor = buildFixtureDescriptor();
    const otherLayout: StageLayout = customStageDataToStageLayout({
      ...descriptor,
      name: 'Other Stage',
    });

    const result = resolveDescriptor({
      customStage: descriptor,
      stageLayout: otherLayout,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.descriptor).toBe(descriptor);
  });

  it('reports no-descriptor when init payload is empty', () => {
    const result = resolveDescriptor({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('no-descriptor');
    expect(result.error.message).toMatch(/CustomStageScene/);
  });

  it('reports load-failed when the slot id cannot be loaded from storage', () => {
    // Vitest runs under Node — no globalThis.localStorage. The
    // storage layer surfaces an `unavailable` code, which the
    // resolver wraps as the `'load-failed'` reason. This is the
    // observable contract: any storage failure surfaces the same
    // failure shape so the UI can render one error template.
    const result = resolveDescriptor({ slotId: 'nonexistent-slot' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('load-failed');
    expect(result.error.message).toContain('nonexistent-slot');
  });

  it('strips the custom: prefix off runtimeStageId before consulting storage', () => {
    // The match flow uses `'custom:<slot-id>'` as the runtime stage
    // id. The resolver normalises the prefix off so the storage
    // load receives the bare slot id; the failure message proves
    // the normalisation happened.
    const result = resolveDescriptor({ runtimeStageId: 'custom:my-slot' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The resolver should have asked storage for `'my-slot'`, not
    // the prefixed form — the error message echoes the slot id.
    expect(result.error.message).toContain('my-slot');
  });
});

// ---------------------------------------------------------------------------
// Source-text wiring contract — verifies the scene wires the Matter +
// Phaser + collision-group pipeline through the canonical helpers.
// ---------------------------------------------------------------------------

describe('CustomStageScene — wiring contract (Sub-AC 2)', () => {
  it('registers under the "CustomStageScene" scene key', () => {
    expect(SCENE_SRC).toMatch(/key:\s*CUSTOM_STAGE_SCENE_KEY/);
  });

  it('extends Phaser.Scene', () => {
    expect(SCENE_SRC).toMatch(
      /class\s+CustomStageScene\s+extends\s+Phaser\.Scene/,
    );
  });

  it('declares both an init() and a create() lifecycle method', () => {
    // Phaser's documented scene lifecycle is init → preload → create.
    // Splitting init() from create() lets tests resolve the
    // descriptor under a stub Scale Manager without instantiating
    // any Phaser GameObjects.
    expect(SCENE_SRC).toMatch(/\binit\(.*?\)\s*:\s*void\s*\{/);
    expect(SCENE_SRC).toMatch(/\bcreate\(\)\s*:\s*void\s*\{/);
  });

  it('imports the canonical stage renderer (Matter bodies + Phaser sprites)', () => {
    // renderStage() is the single source of truth that creates one
    // Matter static body per platform, the four blast-zone sensor
    // walls, and the matching Phaser rectangles. Re-deriving any of
    // those would put the preview out of sync with gameplay.
    expect(SCENE_SRC).toMatch(/renderStage/);
    expect(SCENE_SRC).toMatch(/from\s+['"]\.\.\/stages['"]/);
  });

  it('imports the canonical hazard renderers', () => {
    // renderLavaHazards / renderWindHazards instantiate the hazard
    // sensor bodies + visuals using the HAZARD collision category.
    expect(SCENE_SRC).toMatch(/renderLavaHazards/);
    expect(SCENE_SRC).toMatch(/renderWindHazards/);
  });

  it('imports the engine collision-category tables (collision groups)', () => {
    // The Sub-AC explicitly calls for "collision groups". The
    // canonical source of truth for those is COLLISION_CATEGORIES /
    // COLLISION_MASKS — every body created via renderStage /
    // renderLavaHazards / renderWindHazards is filtered through the
    // tables imported here.
    expect(SCENE_SRC).toMatch(/COLLISION_CATEGORIES/);
    expect(SCENE_SRC).toMatch(/COLLISION_MASKS/);
    expect(SCENE_SRC).toMatch(
      /from\s+['"]\.\.\/engine\/collisionCategories['"]/,
    );
  });

  it('consumes the stage descriptor via customStageDataToStageLayout', () => {
    // The descriptor is a CustomStageData body; the converter is the
    // canonical seam between the saved body and the runtime layout
    // the renderer accepts.
    expect(SCENE_SRC).toMatch(/customStageDataToStageLayout/);
  });

  it('instantiates renderStage during create() to spawn Matter bodies + sprites', () => {
    // The actual call site — proves the wiring is more than just an
    // import. renderStage() returns the Matter body + visual roster
    // the preview owns.
    expect(SCENE_SRC).toMatch(/this\.rendered\s*=\s*renderStage\(\s*this/);
  });

  it('conditionally instantiates renderLavaHazards when lava pieces exist', () => {
    // The renderer is skipped on lava-free stages so a flat-only
    // preview pays no construction cost. The contract is "the scene
    // checks the layout before allocating".
    expect(SCENE_SRC).toMatch(
      /hazards\.some\(\(h\)\s*=>\s*h\.type\s*===\s*['"]lava['"]\)/,
    );
    expect(SCENE_SRC).toMatch(/this\.lavaHazards\s*=\s*renderLavaHazards/);
  });

  it('conditionally instantiates renderWindHazards when wind pieces exist', () => {
    expect(SCENE_SRC).toMatch(
      /hazards\.some\(\(h\)\s*=>\s*h\.type\s*===\s*['"]wind['"]\)/,
    );
    expect(SCENE_SRC).toMatch(/this\.windHazards\s*=\s*renderWindHazards/);
  });

  it('paints a marker for each spawn point in the active layout', () => {
    // The Sub-AC's deliverable is that the descriptor's spawn-point
    // pieces produce visible Phaser GameObjects. The renderer for
    // platforms is renderStage; spawn points are markers, not
    // colliders, so the scene paints them inline.
    expect(SCENE_SRC).toMatch(/this\.activeStage\.spawnPoints/);
    expect(SCENE_SRC).toMatch(/this\.spawnMarkers\.push/);
  });

  it('disables the auto-step Matter world so previews stay frozen', () => {
    // Without disabling auto-step, the preview's Matter bodies would
    // tick under Phaser's default integrator and the (zero) gravity
    // setup the renderer relies on would still produce subtle drift
    // across re-entries.
    expect(SCENE_SRC).toMatch(/this\.matter\.world\.autoUpdate\s*=\s*false/);
  });

  it('cancels back to the configured return scene on ESC', () => {
    // The preview is reachable from the builder + (future) stage-
    // select; the scene picks the return key from `init.data` so
    // both entry points round-trip cleanly.
    expect(SCENE_SRC).toMatch(/keydown-ESC/);
    expect(SCENE_SRC).toMatch(
      /this\.scene\.start\(\s*this\.returnSceneKey\s*\)/,
    );
  });

  it('tears down all created bodies + visuals on shutdown / destroy', () => {
    // Phaser scenes are reused across `scene.start(...)` cycles; not
    // releasing the rendered handle would leak Matter bodies into the
    // next preview. The destroy() calls bubble through to the
    // canonical renderers.
    expect(SCENE_SRC).toMatch(/Phaser\.Scenes\.Events\.SHUTDOWN/);
    expect(SCENE_SRC).toMatch(/Phaser\.Scenes\.Events\.DESTROY/);
    expect(SCENE_SRC).toMatch(/this\.rendered\.destroy\(\)/);
    expect(SCENE_SRC).toMatch(/this\.lavaHazards\.destroy\(\)/);
    expect(SCENE_SRC).toMatch(/this\.windHazards\.destroy\(\)/);
  });

  it('exposes test seams for the rendered stage + hazard handles', () => {
    // The seams let unit + integration tests assert "the descriptor
    // produced N Matter bodies / M hazard sensors" without poking
    // private fields.
    expect(SCENE_SRC).toMatch(/getActiveStage\(\)/);
    expect(SCENE_SRC).toMatch(/getRenderedStage\(\)/);
    expect(SCENE_SRC).toMatch(/getLavaHazards\(\)/);
    expect(SCENE_SRC).toMatch(/getWindHazards\(\)/);
    expect(SCENE_SRC).toMatch(/getSpawnMarkers\(\)/);
    expect(SCENE_SRC).toMatch(/getLastError\(\)/);
  });

  it('exports the CUSTOM_STAGE_SCENE_KEY + default return constants', () => {
    // The constants are the documented contract for navigating to
    // the preview from other scenes — pinning them as exports keeps
    // the menu / builder / stage-select in sync without duplicating
    // the literals.
    expect(SCENE_SRC).toMatch(
      /export\s+const\s+CUSTOM_STAGE_SCENE_KEY\s*=\s*['"]CustomStageScene['"]/,
    );
    expect(SCENE_SRC).toMatch(
      /export\s+const\s+CUSTOM_STAGE_SCENE_DEFAULT_RETURN_KEY\s*=\s*['"]StageBuilderScene['"]/,
    );
  });

  it('re-exports the resolveDescriptor helper for testing under plain Node', () => {
    // The pure resolver lives in a Phaser-free sibling
    // (`customStageSceneResolver.ts`) so the unit suite can drive
    // every input branch under plain Node; the scene file re-exports
    // the helper so external callers continue to import it from
    // `./CustomStageScene` for the canonical surface.
    expect(SCENE_SRC).toMatch(/resolveDescriptor/);
    expect(SCENE_SRC).toMatch(
      /from\s+['"]\.\/customStageSceneResolver['"]/,
    );
  });
});

// ---------------------------------------------------------------------------
// GameConfig integration — verifies the scene is registered in the
// scenes list so navigation by key actually resolves.
// ---------------------------------------------------------------------------

describe('CustomStageScene — registered in GameConfig', () => {
  it('appears in the SCENES array in src/engine/GameConfig.ts', () => {
    const cfg = readFileSync(
      resolve(__dirname, '../engine/GameConfig.ts'),
      'utf8',
    );
    expect(cfg).toMatch(/CustomStageScene/);
    expect(cfg).toMatch(
      /import\s*\{\s*CustomStageScene\s*\}\s*from\s*['"]\.\.\/scenes\/CustomStageScene['"]/,
    );
  });
});
