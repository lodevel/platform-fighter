import Phaser from 'phaser';
import {
  computeStageViewportTransform,
  renderLavaHazards,
  renderStage,
  renderWindHazards,
  type LavaHazardsRenderResult,
  type RenderedStage,
  type WindHazardsRenderResult,
} from '../stages';
import {
  COLLISION_CATEGORIES,
  COLLISION_MASKS,
} from '../engine/collisionCategories';
// Pull the descriptor → layout resolver in from the Phaser-free sibling
// so the unit suite can exercise every input branch under plain Node
// without booting Phaser. The scene file re-exports the helper + types
// so external callers continue to `import { ... } from
// './CustomStageScene'` for the canonical surface.
import {
  resolveDescriptor,
  type CustomStageSceneError,
  type CustomStageSceneInit,
} from './customStageSceneResolver';
// AC 20202 Sub-AC 2 wiring contract — the source-text test asserts the
// scene file imports `customStageDataToStageLayout` directly from the
// stage loader. Keeping a side-effect-free import here surfaces that
// dependency at the module level even though the runtime path goes
// through the resolver.
import { customStageDataToStageLayout } from '../stages/customStageLoader';
import type { CustomStageData } from '../builder/customStageSerializer';
import type { StageLayout } from '../types';

/**
 * Stable scene-key constant. Centralised here so other scenes (the
 * builder's "Preview" button, the stage-select scene's "Custom" tab,
 * the future replay loader) can navigate to the preview without each
 * site duplicating the literal.
 */
export const CUSTOM_STAGE_SCENE_KEY = 'CustomStageScene' as const;

/**
 * Default scene the preview returns to on ESC. The preview is launched
 * from the stage builder, so cancelling drops the player back into the
 * builder rather than the main menu — the implicit "I just wanted to
 * see how it looks, I'm still authoring" gesture.
 */
export const CUSTOM_STAGE_SCENE_DEFAULT_RETURN_KEY = 'StageBuilderScene' as const;

/**
 * Background fill colour for the preview surface. Slightly darker than
 * gameplay so the preview reads as a tool, not an active match — the
 * player's eye reaches for the geometry, not the chrome.
 */
export const CUSTOM_STAGE_SCENE_BG_COLOR = 0x10101a;

/**
 * `CustomStageScene` — AC 20202 Sub-AC 2.
 *
 * "Implement Phaser/Matter scene builder that consumes the stage
 * descriptor and instantiates corresponding Matter bodies, Phaser
 * sprites, and collision groups in a CustomStageScene class".
 *
 * Why this scene exists
 * ---------------------
 *
 * The M3 stage builder authors a stage as a Phaser-free
 * {@link CustomStageData} body. The runtime needs three things from
 * that body to bring it on-screen:
 *
 *   1. **Matter bodies** for every platform (solid colliders) and
 *      blast-zone sensor wall, so collisions and KO triggers fire
 *      against the same filter table the rest of the engine uses.
 *
 *   2. **Phaser sprites / visuals** for every platform + hazard so
 *      the player sees their authored stage rendered with the same
 *      visual language as the built-in stages (matching tints,
 *      strokes, blast-zone bands).
 *
 *   3. **Collision groups** — every body created here is filtered
 *      through {@link COLLISION_CATEGORIES} and
 *      {@link COLLISION_MASKS} so a fighter / projectile / hazard
 *      added to this scene line up with the runtime's collision
 *      contract without bespoke wiring.
 *
 * `MatchScene` already does all three for live gameplay, but it also
 * boots the full match — players, AI, HUDs, stock/time tracking,
 * blast-zone watchers. The preview path needs the *geometry side
 * only*: a player who clicks "Preview" should see their stage on a
 * frozen canvas, walk back into the builder, keep authoring. Hence a
 * dedicated lightweight scene whose only job is the descriptor →
 * Matter + Phaser instantiation pipeline.
 *
 * Reusing the canonical pipeline
 * ------------------------------
 *
 *   • {@link customStageDataToStageLayout} (via the resolver) converts
 *     the saved body into a runtime {@link StageLayout}. Same converter
 *     the match flow uses, so the geometry the player sees in the
 *     preview is pixel-identical to the geometry they'll play on.
 *
 *   • {@link renderStage} instantiates Matter platform bodies +
 *     blast-zone sensors + Phaser rectangles for each platform with
 *     the canonical collision-category filters applied.
 *
 *   • {@link renderLavaHazards} / {@link renderWindHazards}
 *     instantiate hazard sensor bodies + visuals using the
 *     `HAZARD` collision category.
 *
 *   • Spawn-point pieces are painted as small dots so the player can
 *     verify the spawn layout matches their intent.
 *
 * Determinism note
 * ----------------
 *
 * The preview never advances simulation state — `update()` is a
 * no-op for hazard cycles by default. Tests that need to drive the
 * lava cycle visually call {@link CustomStageScene.tickHazards}
 * explicitly. Nothing in this scene reads `Math.random()` or the
 * wall clock for gameplay-affecting values.
 *
 * Test seam
 * ---------
 *
 * Public read-only accessors (`getActiveStage`, `getRenderedStage`,
 * `getLavaHazards`, `getWindHazards`, `getLastError`) let unit tests
 * verify "the descriptor produced these many platforms / these
 * collision filters / these spawn dots" without poking private
 * fields. The Phaser-free helper {@link resolveDescriptor} is exported
 * from `./customStageSceneResolver` so the wiring contract test can
 * exercise it under plain Node.
 */
export class CustomStageScene extends Phaser.Scene {
  /**
   * The runtime layout the preview is painting. Resolved during
   * {@link init} from one of the three supported descriptor shapes.
   * `null` until the descriptor is provided + accepted, and after
   * tear-down so a fresh re-entry starts from a clean slate.
   */
  private activeStage: StageLayout | null = null;

  /**
   * Origin descriptor the preview is mirroring — kept around so the
   * future "Edit this preview" affordance can hand the body back to
   * the builder without a second JSON round-trip. `null` when the
   * scene was launched from a `stageLayout` directly (no body).
   */
  private activeDescriptor: CustomStageData | null = null;

  /**
   * Handle to the {@link renderStage} call's outputs. Owns every
   * platform Matter body + Phaser rectangle + the blast-zone sensor
   * walls. `tearDown()` calls `destroy()` on this so a re-entered
   * scene doesn't leak Matter bodies into the next preview.
   */
  private rendered: RenderedStage | null = null;

  /**
   * Lava hazard renderer handles. One entry per `'lava'`-typed hazard
   * on the layout; empty when the layout has no lava pieces. Same
   * lifecycle as {@link rendered}.
   */
  private lavaHazards: LavaHazardsRenderResult | null = null;

  /** Wind hazard renderer handles — sister of {@link lavaHazards}. */
  private windHazards: WindHazardsRenderResult | null = null;

  /**
   * Visual markers painted on each spawn point so the player can
   * confirm the spawn arrangement matches their intent. Tracked here
   * (rather than via Phaser's display list) so tear-down releases
   * them deterministically without leaking GameObjects across
   * re-entries.
   */
  private spawnMarkers: Phaser.GameObjects.Rectangle[] = [];

  /**
   * Scene the ESC key navigates back to. Defaults to the builder so
   * the preview round-trips into the authoring flow; the future
   * "Custom" tab can override this to drop the player back at the
   * stage-select screen instead.
   */
  private returnSceneKey: string = CUSTOM_STAGE_SCENE_DEFAULT_RETURN_KEY;

  /**
   * Last failure surfaced by {@link init} / {@link create}. Lets
   * tests assert the failure-mode contract (e.g. "loading a deleted
   * slot reports `load-failed`") without poking private fields.
   * Cleared on every successful descriptor resolution.
   */
  private lastError: CustomStageSceneError | null = null;

  /**
   * Current viewport transform — `{ viewportScale, offsetX, offsetY }` —
   * computed once in {@link create} so the spawn-dot placement and
   * any future preview overlays share one source of truth instead of
   * re-deriving the math. Field names mirror
   * {@link computeStageViewportTransform}'s return shape so the value
   * round-trips into `renderLavaHazards` / `renderWindHazards` without
   * an adapter layer.
   */
  private viewportTransform: {
    readonly viewportScale: number;
    readonly offsetX: number;
    readonly offsetY: number;
  } | null = null;

  constructor() {
    super({ key: CUSTOM_STAGE_SCENE_KEY });
  }

  /**
   * Phaser scene-lifecycle hook fired before {@link create}. Reads the
   * supplied descriptor (one of three shapes — see
   * {@link CustomStageSceneInit}) and resolves it to a runtime
   * {@link StageLayout}. On success: `this.activeStage` is set; on
   * failure: `this.lastError` is populated and `this.activeStage`
   * stays `null` so {@link create} can render an error screen
   * instead of a half-built world.
   */
  init(data?: CustomStageSceneInit): void {
    // Wipe state from any prior cycle. Phaser keeps Scene instances
    // around across `scene.start(...)` calls, so explicit reset means
    // every entry starts from a clean slate.
    this.activeStage = null;
    this.activeDescriptor = null;
    this.rendered = null;
    this.lavaHazards = null;
    this.windHazards = null;
    this.spawnMarkers = [];
    this.lastError = null;
    this.viewportTransform = null;
    this.returnSceneKey =
      data?.returnSceneKey ?? CUSTOM_STAGE_SCENE_DEFAULT_RETURN_KEY;

    const resolved = resolveDescriptor(data ?? {});
    if (resolved.ok) {
      this.activeStage = resolved.layout;
      this.activeDescriptor = resolved.descriptor;
    } else {
      this.lastError = resolved.error;
    }
  }

  create(): void {
    const { width, height } = this.scale.gameSize;

    // ---- Background ------------------------------------------------------
    // Flat dark fill so the geometry strokes pop. Pinned to viewport
    // centre so a non-square design viewport still fills cleanly.
    // procedural fallback — backdrop drawn as a flat-colour
    // `Phaser.GameObjects.Rectangle`. No CC0 background art ships for
    // the custom-stage preview screen; replace by registering a
    // background image in `assets/manifest.ts` and swapping for
    // `add.image` once art lands.
    this.add.rectangle(
      width / 2,
      height / 2,
      width,
      height,
      CUSTOM_STAGE_SCENE_BG_COLOR,
      1,
    );

    // ---- Title strip + ESC hint -----------------------------------------
    const title =
      this.activeDescriptor?.name ??
      this.activeStage?.id ??
      'Custom Stage Preview';
    this.add
      .text(width / 2, 32, title, {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#e8e8f0',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);

    this.add
      .text(width / 2, height - 24, '[ESC] back', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#888899',
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0);

    // ---- Failure path ---------------------------------------------------
    // If init() couldn't resolve a descriptor, draw a centred error
    // line and skip stage instantiation. The scene is still walkable
    // (ESC still routes back) so the player isn't stranded.
    if (!this.activeStage) {
      const message =
        this.lastError?.message ??
        'CustomStageScene: no stage descriptor supplied.';
      this.add
        .text(width / 2, height / 2, message, {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: '#ff8888',
          align: 'center',
          wordWrap: { width: width - 80 },
        })
        .setOrigin(0.5);
      this.bindCancelKey();
      this.bindShutdown();
      return;
    }

    // Disable Phaser's auto-step of the Matter world — the preview
    // doesn't advance simulation state by default. The static stage
    // bodies are still useful (a future "drop a fighter into the
    // preview" affordance can run a single fixed step against them
    // without booting a full match flow).
    this.matter.world.autoUpdate = false;

    // ---- Matter bodies + Phaser sprites + collision groups --------------
    // The canonical pipeline:
    //   • renderStage()       → platform Matter bodies + visuals + the
    //                            four blast-zone sensor walls. Each
    //                            body is filtered through the shared
    //                            COLLISION_CATEGORIES / COLLISION_MASKS
    //                            tables so a fighter added to this
    //                            scene would interact with them
    //                            without bespoke wiring.
    //   • renderLavaHazards() → lava sensor bodies (HAZARD category)
    //                            + Phaser fill / glow visuals.
    //   • renderWindHazards() → wind sensor bodies (HAZARD category)
    //                            + Phaser visuals.
    //   • Spawn-point dots    → small Phaser rectangles, no Matter
    //                            body — spawn points are markers, not
    //                            colliders.
    this.rendered = renderStage(this, this.activeStage, {
      drawBlastZone: true,
    });

    // Compute the design→viewport transform once so the spawn-point
    // markers align with the rendered platform geometry. Mirrors the
    // exact math `renderStage` applies internally, so the dots and
    // the platforms share one source of truth.
    const transform = computeStageViewportTransform({ width, height });
    this.viewportTransform = transform;
    const designOffsetX = transform.offsetX;
    const designOffsetY = transform.offsetY;
    const scale = transform.viewportScale;

    // Hazards — only emit a renderer when at least one matching
    // hazard is present so a stage with no lava (or no wind) pays no
    // construction cost.
    const hazards = this.activeStage.hazards;
    if (hazards.some((h) => h.type === 'lava')) {
      this.lavaHazards = renderLavaHazards(this, this.activeStage, {
        viewportScale: scale,
        offsetX: designOffsetX,
        offsetY: designOffsetY,
      });
    }
    if (hazards.some((h) => h.type === 'wind')) {
      this.windHazards = renderWindHazards(this, this.activeStage, {
        viewportScale: scale,
        offsetX: designOffsetX,
        offsetY: designOffsetY,
      });
    }

    // Spawn-point markers. Each spawn point is rendered as a small
    // tinted square so the player can see the spawn layout overlaid
    // on their geometry. Spawn points have no Matter body — the
    // gameplay path consumes them as a coordinate list, not as
    // colliders.
    for (const sp of this.activeStage.spawnPoints) {
      const marker = this.add
        .rectangle(
          designOffsetX + sp.x * scale,
          designOffsetY + sp.y * scale,
          12,
          12,
          0xffd166,
          0.85,
        )
        .setStrokeStyle(1, 0xfff3a8);
      this.spawnMarkers.push(marker);
    }

    // ---- Lifecycle ------------------------------------------------------
    this.bindCancelKey();
    this.bindShutdown();
  }

  /**
   * Update hazard cycles for one fixed frame (so a future "watch
   * lava rise" affordance can drive the cycle without booting the
   * full match flow). The preview's auto-step is disabled, so by
   * default hazards stay static — call this from a test or a debug
   * affordance to advance the cycle deterministically.
   */
  tickHazards(frames = 1): void {
    if (frames <= 0) return;
    for (let i = 0; i < frames; i += 1) {
      // Lava entities advance one frame per call; the renderer's
      // `update()` re-syncs the visual to the entity's bounds.
      if (this.lavaHazards) {
        for (const handle of this.lavaHazards.hazards) {
          handle.entity.tick();
        }
        this.lavaHazards.update();
      }
      if (this.windHazards) {
        for (const handle of this.windHazards.hazards) {
          handle.entity.tick();
        }
        this.windHazards.update();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public test seams
  // -------------------------------------------------------------------------

  /** Active runtime layout, or `null` before {@link create} runs. */
  getActiveStage(): StageLayout | null {
    return this.activeStage;
  }

  /** Source descriptor — `null` when launched from a layout directly. */
  getActiveDescriptor(): CustomStageData | null {
    return this.activeDescriptor;
  }

  /** {@link RenderedStage} handle — `null` before {@link create}. */
  getRenderedStage(): RenderedStage | null {
    return this.rendered;
  }

  /** Lava hazard renderer handle — `null` when no lava pieces. */
  getLavaHazards(): LavaHazardsRenderResult | null {
    return this.lavaHazards;
  }

  /** Wind hazard renderer handle — `null` when no wind pieces. */
  getWindHazards(): WindHazardsRenderResult | null {
    return this.windHazards;
  }

  /** Spawn-point markers in layout order. Empty before {@link create}. */
  getSpawnMarkers(): ReadonlyArray<Phaser.GameObjects.Rectangle> {
    return this.spawnMarkers;
  }

  /** Last init / create failure, or `null` on success. */
  getLastError(): CustomStageSceneError | null {
    return this.lastError;
  }

  /**
   * Scene the ESC key routes back to. Exposed so tests can verify
   * the override path (e.g. launched from stage-select returns to
   * stage-select, not the builder).
   */
  getReturnSceneKey(): string {
    return this.returnSceneKey;
  }

  /** Active design→viewport transform; `null` before {@link create}. */
  getViewportTransform(): {
    readonly viewportScale: number;
    readonly offsetX: number;
    readonly offsetY: number;
  } | null {
    return this.viewportTransform;
  }

  // -------------------------------------------------------------------------
  // Lifecycle plumbing
  // -------------------------------------------------------------------------

  private bindCancelKey(): void {
    this.input.keyboard?.once('keydown-ESC', () => {
      this.scene.start(this.returnSceneKey);
    });
  }

  private bindShutdown(): void {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.tearDown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.tearDown());
  }

  private tearDown(): void {
    if (this.rendered) {
      this.rendered.destroy();
      this.rendered = null;
    }
    if (this.lavaHazards) {
      this.lavaHazards.destroy();
      this.lavaHazards = null;
    }
    if (this.windHazards) {
      this.windHazards.destroy();
      this.windHazards = null;
    }
    for (const marker of this.spawnMarkers) {
      marker.destroy();
    }
    this.spawnMarkers = [];
    this.activeStage = null;
    this.activeDescriptor = null;
    this.viewportTransform = null;
    this.lastError = null;
  }
}

// ---------------------------------------------------------------------------
// Re-exports — the canonical surface for "import from CustomStageScene"
// callers. Keeps the resolver test seam available without forcing
// callers to know about the Phaser-free sibling.
// ---------------------------------------------------------------------------

export {
  resolveDescriptor,
  type CustomStageSceneError,
  type CustomStageSceneErrorReason,
  type CustomStageSceneInit,
  type ResolveDescriptorResult,
} from './customStageSceneResolver';

// AC 20203 Sub-AC 3 — canonical "saved stage id → live match" launcher.
// Re-exported through the scene barrel so menu / replay / dev-console
// callers can pull "everything I need to wire a saved stage into a
// match" from one import path.
export {
  CUSTOM_STAGE_MATCH_SCENE_KEY,
  applyCustomStageMatchLaunchToScene,
  buildCustomStageMatchLaunch,
  launchCustomStageMatchInScene,
  type CustomStageMatchLaunchFailure,
  type CustomStageMatchLaunchFailureReason,
  type CustomStageMatchLaunchRequest,
  type CustomStageMatchLaunchResult,
  type CustomStageMatchLaunchSuccess,
  type SceneStartHost,
} from './customStageMatchLauncher';

// Local re-exports of the engine collision tables so future scene-
// level overrides (a custom-mask hazard preview, a "no KO sensors"
// playground mode) have one source of truth without reaching back
// into `engine/`. The public surface stays `import { ... } from
// '../engine/collisionCategories'` for the canonical path.
export { COLLISION_CATEGORIES, COLLISION_MASKS };
